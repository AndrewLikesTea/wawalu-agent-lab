// Turn an approved FinOps commitment into one durable Shiplog decision.
//
// WHAT THIS IS FOR
// ----------------
// Noor's `savings-commitment.js` builds and validates the commitment: one
// department, one routing change, one baseline month, one projected monthly
// saving, one confidence, and the provenance of the records the figure came
// from. It deliberately stops there — `DOWNSTREAM.implemented` is `false`, and
// its note says any downstream implementation must consume a validated
// commitment, must carry provenance so a later measurement can be traced back,
// and must not recompute the baseline.
//
// This module is that downstream step, and only that step: an approved
// commitment becomes a decision in the visitor's own Shiplog log, written
// through the same `saveDecisions` the record form uses, so it filters, sorts,
// links to a release, exports, and imports like every other decision. There is
// no second decision store and no second commitment model here.
//
// WHAT IS PERSISTED, AND WHAT IS NOT
// ----------------------------------
// A Shiplog decision is a durable local record; an imported analysis is not
// something this product stores. So the decision carries a bounded, closed
// metadata block — `COMMITMENT_METADATA_FIELD` — holding exactly five things:
//
//   1. the stable commitment identifier,
//   2. the money claim (baseline, projected, saving; integer USD minor units),
//   3. the confidence percent and its derived band,
//   4. a provenance summary (source id, designation, import instant, analysis
//      period, and the record ids the figure was computed from),
//   5. the recommended action (workload, department, and the two route ids).
//
// Nothing else survives. The candidate list, the evidence statements, the
// routing rationale, every per-record figure, and every row of the import
// itself are read to build the block and then dropped. `commitmentMetadata`
// below is the whole allow-list: a field that is not named there cannot reach
// storage through this path.
//
// IDEMPOTENCY
// -----------
// A commitment links to at most one decision, and that is enforced twice over.
// The decision id is derived from the commitment id (`commitmentDecisionId`),
// so two attempts produce the same id and the merge rules that already dedupe
// by id — in `mergeImport`, and in the history composition's `dedupeById` —
// skip the second copy for free. On top of that, `recordCommitmentDecision`
// scans the stored log for the commitment id before writing, so a decision that
// was given a different id still blocks a second link.
//
// DETERMINISM
// -----------
// No clock, no random source, no network, no DOM. The decision's `createdAt` is
// the approval instant the caller states, never `now`, so the same approval
// produces byte-identical records in a test and in a browser.

import {
  MAX_CONTEXT_LENGTH,
  MAX_OWNER_LENGTH,
  MAX_TITLE_LENGTH,
  loadDecisions,
  saveDecisions,
} from "./app.js";
import { confidenceBand, validateSavingsCommitment } from "./savings-commitment.js";

/** This block's own version, independent of the commitment contract's. */
export const COMMITMENT_METADATA_SCHEMA = "shiplog-finops-commitment/1.0.0";

/** The one optional decision field this metadata ever occupies. */
export const COMMITMENT_METADATA_FIELD = "finopsCommitment";

/** Prefix of the derived decision id. Stated once so a reader can grep for it. */
export const COMMITMENT_DECISION_ID_PREFIX = "finops-commitment-";

/**
 * An approved commitment cites a handful of records. A cap keeps a decision
 * bounded in a store that has no quota of its own; exceeding it is reported as
 * a refusal, never as a silent truncation of the provenance.
 */
export const MAX_PROVENANCE_RECORD_IDS = 50;

/** The decision status an approved commitment is recorded as. */
export const COMMITMENT_DECISION_STATUS = "accepted";

export class CommitmentDecisionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CommitmentDecisionError";
    this.code = code;
  }
}

const CANONICAL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DESIGNATIONS = Object.freeze(["fixture", "demo", "imported"]);

/** `4820000` to `"48,200.00"`. Hand-grouped so no assertion depends on a locale. */
function money(minor) {
  const [whole, fraction] = (Math.round(minor) / 100).toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

/* ------------------------------ the block's shape -------------------------- */
//
// One validator, used in both directions: the builder asserts against it before
// anything is written, and the importer runs it over a block that arrived in a
// file. Two copies of this rule would be two rules.

function objectErrors(value, path) {
  return value === null || typeof value !== "object" || Array.isArray(value)
    ? [`${path}: expected an object`]
    : [];
}

function idError(value, path) {
  if (typeof value !== "string" || !CANONICAL_ID.test(value) || value.length > 64) {
    return `${path}: expected a canonical lower-case kebab-case identifier`;
  }
  return null;
}

function minorError(value, path) {
  return Number.isSafeInteger(value) && value >= 0
    ? null
    : `${path}: expected a non-negative safe integer in USD minor units`;
}

function push(errors, ...results) {
  for (const result of results) if (result) errors.push(result);
  return errors;
}

function claimErrors(claim, path) {
  const shape = objectErrors(claim, path);
  if (shape.length > 0) return shape;
  const errors = push(
    [],
    minorError(claim.baselineMonthlyCostMinor, `${path}.baselineMonthlyCostMinor`),
    minorError(claim.projectedMonthlyCostMinor, `${path}.projectedMonthlyCostMinor`),
    minorError(claim.monthlySavingsMinor, `${path}.monthlySavingsMinor`),
    claim.currency === "USD" ? null : `${path}.currency: expected "USD"`,
    claim.unit === "usd_minor" ? null : `${path}.unit: expected "usd_minor"`,
    typeof claim.period === "string" && PERIOD.test(claim.period)
      ? null : `${path}.period: expected a YYYY-MM period`,
  );
  if (errors.length > 0) return errors;
  // The claim carries all three figures, so it states its own arithmetic and a
  // hand-edited saving is caught here rather than trusted back into the log.
  const expected = Math.max(0, claim.baselineMonthlyCostMinor - claim.projectedMonthlyCostMinor);
  if (claim.monthlySavingsMinor !== expected) {
    errors.push(`${path}.monthlySavingsMinor: expected max(0, baseline - projected) = ${expected}`);
  }
  if (claim.monthlySavingsMinor <= 0) {
    errors.push(`${path}.monthlySavingsMinor: expected a positive saving`);
  }
  return errors;
}

function confidenceErrors(confidence, path) {
  const shape = objectErrors(confidence, path);
  if (shape.length > 0) return shape;
  if (!Number.isInteger(confidence.percent)
    || confidence.percent < 0 || confidence.percent > 100) {
    return [`${path}.percent: expected an integer from 0 through 100`];
  }
  // The band is derived, never taken on trust: a block whose band disagrees
  // with its own percent would let two readers report different confidence.
  return confidence.band === confidenceBand(confidence.percent)
    ? []
    : [`${path}.band: expected ${confidenceBand(confidence.percent)} for ${confidence.percent}%`];
}

function provenanceErrors(provenance, path) {
  const shape = objectErrors(provenance, path);
  if (shape.length > 0) return shape;
  const errors = push(
    [],
    idError(provenance.sourceId, `${path}.sourceId`),
    DESIGNATIONS.includes(provenance.designation)
      ? null : `${path}.designation: expected one of ${DESIGNATIONS.join(", ")}`,
    typeof provenance.importedAt === "string" && INSTANT.test(provenance.importedAt)
      ? null : `${path}.importedAt: expected an ISO-8601 UTC instant`,
    provenance.analysisPeriod === null
      || (typeof provenance.analysisPeriod === "string" && PERIOD.test(provenance.analysisPeriod))
      ? null : `${path}.analysisPeriod: expected a YYYY-MM period or null`,
  );
  if (!Array.isArray(provenance.recordIds) || provenance.recordIds.length === 0) {
    errors.push(`${path}.recordIds: expected a non-empty array`);
    return errors;
  }
  if (provenance.recordIds.length > MAX_PROVENANCE_RECORD_IDS) {
    errors.push(`${path}.recordIds: expected at most ${MAX_PROVENANCE_RECORD_IDS} ids, got ${provenance.recordIds.length}`);
  }
  provenance.recordIds.forEach((id, index) => push(errors, idError(id, `${path}.recordIds[${index}]`)));
  if (provenance.recordCount !== provenance.recordIds.length) {
    errors.push(`${path}.recordCount: expected ${provenance.recordIds.length}`);
  }
  return errors;
}

function actionErrors(action, path) {
  const shape = objectErrors(action, path);
  if (shape.length > 0) return shape;
  const errors = push(
    [],
    idError(action.workloadId, `${path}.workloadId`),
    idError(action.departmentId, `${path}.departmentId`),
    idError(action.fromModelId, `${path}.fromModelId`),
    idError(action.toModelId, `${path}.toModelId`),
  );
  if (errors.length === 0 && action.fromModelId === action.toModelId) {
    errors.push(`${path}.toModelId: expected a route that differs from fromModelId`);
  }
  return errors;
}

const METADATA_KEYS = Object.freeze([
  "schemaVersion", "commitmentId", "claim", "confidence", "provenance", "recommendedAction",
]);

/**
 * Every rule about the persisted block, in one place. Returns a list of
 * human-readable errors; empty means the block is storable.
 *
 * @param {unknown} metadata the block as it arrived (from a builder or a file).
 * @param {string} path prefix for the error messages.
 * @returns {string[]}
 */
export function commitmentMetadataErrors(metadata, path = COMMITMENT_METADATA_FIELD) {
  const shape = objectErrors(metadata, path);
  if (shape.length > 0) return shape;

  const errors = [];
  // A closed shape both ways: an undeclared field is exactly how raw import
  // data would get carried into storage by a later change nobody reviewed.
  for (const key of Object.keys(metadata)) {
    if (!METADATA_KEYS.includes(key)) {
      errors.push(`${path}.${key}: unknown field; this block carries only ${METADATA_KEYS.join(", ")}`);
    }
  }
  if (metadata.schemaVersion !== COMMITMENT_METADATA_SCHEMA) {
    errors.push(`${path}.schemaVersion: expected ${JSON.stringify(COMMITMENT_METADATA_SCHEMA)}`);
  }
  push(errors, idError(metadata.commitmentId, `${path}.commitmentId`));
  errors.push(
    ...claimErrors(metadata.claim, `${path}.claim`),
    ...confidenceErrors(metadata.confidence, `${path}.confidence`),
    ...provenanceErrors(metadata.provenance, `${path}.provenance`),
    ...actionErrors(metadata.recommendedAction, `${path}.recommendedAction`),
  );
  return errors;
}

/* --------------------------------- building -------------------------------- */

/**
 * The decision id a commitment always maps to. Deterministic on purpose: it is
 * the cheap half of the idempotency rule, and it survives an export/import into
 * another browser where a scan of local records would find nothing.
 */
export function commitmentDecisionId(commitmentId) {
  return `${COMMITMENT_DECISION_ID_PREFIX}${commitmentId}`;
}

/**
 * The decision already linked to this commitment, or null. Matches on the
 * metadata first — that is the real link — and on the derived id second, so a
 * record written with a caller-supplied id is still found.
 */
export function findCommitmentDecision(decisions, commitmentId) {
  const derivedId = commitmentDecisionId(commitmentId);
  return (decisions ?? []).find((decision) => decision?.[COMMITMENT_METADATA_FIELD]?.commitmentId
    === commitmentId || decision?.id === derivedId) ?? null;
}

function projectMetadata(commitment) {
  const { routing, provenance } = commitment;
  return {
    schemaVersion: COMMITMENT_METADATA_SCHEMA,
    commitmentId: commitment.commitmentId,
    claim: {
      baselineMonthlyCostMinor: commitment.baseline.monthlyCostMinor,
      projectedMonthlyCostMinor: commitment.projected.monthlyCostMinor,
      monthlySavingsMinor: commitment.projectedMonthlySavings.amountMinor,
      currency: "USD",
      unit: "usd_minor",
      period: commitment.workloadScope.period,
    },
    confidence: {
      percent: commitment.confidence.percent,
      band: commitment.confidence.band,
    },
    provenance: {
      sourceId: provenance.sourceId,
      designation: provenance.designation,
      importedAt: provenance.importedAt,
      analysisPeriod: provenance.analysisPeriod ?? null,
      recordIds: [...provenance.recordIds],
      recordCount: provenance.recordIds.length,
    },
    recommendedAction: {
      workloadId: commitment.workloadScope.workloadId,
      departmentId: commitment.department.departmentId,
      fromModelId: routing.currentRoute.modelId,
      toModelId: routing.proposedRoute.modelId,
    },
  };
}

// The title the log shows. The preferred sentence names the route; a pair of
// long canonical ids can exceed the field's own maximum, and in that case the
// commitment id is the one thing guaranteed to fit.
function commitmentTitle(action, commitmentId) {
  const preferred = `Route ${action.workloadId} to ${action.toModelId}`;
  return preferred.length <= MAX_TITLE_LENGTH ? preferred : `FinOps commitment ${commitmentId}`;
}

// The context a reader sees without opening the metadata: the money claim, the
// confidence, and where the figures came from. Derived from the block that was
// just built, so the prose and the stored figures cannot disagree.
function commitmentContext(metadata) {
  const { claim, confidence, provenance, recommendedAction: action } = metadata;
  return [
    `Approved FinOps commitment ${metadata.commitmentId}: route ${action.workloadId} for `
      + `${action.departmentId} from ${action.fromModelId} to ${action.toModelId}.`,
    `The imported analysis projects $${money(claim.monthlySavingsMinor)} a month against a `
      + `$${money(claim.baselineMonthlyCostMinor)} ${claim.period} baseline, at `
      + `${confidence.percent}% confidence (${confidence.band}).`,
    `Provenance: source ${provenance.sourceId} (${provenance.designation}), imported `
      + `${provenance.importedAt}, ${provenance.recordCount} `
      + `${provenance.recordCount === 1 ? "record" : "records"}.`,
  ].join(" ");
}

function reject(code, message) {
  throw new CommitmentDecisionError(code, message);
}

/**
 * Build the decision an approved commitment becomes. Pure: no storage, no
 * clock, no id generator.
 *
 * @param {object} approval
 * @param {object} approval.preview a `savings-commitment/1.0.0` preview.
 * @param {string} approval.approvedBy who approved it; becomes the decision owner.
 * @param {string} approval.approvedAt ISO-8601 UTC instant; becomes `createdAt`.
 * @param {string} [approval.id] an explicit decision id, for a caller that has one.
 * @returns {object} a decision record `loadDecisions` accepts.
 */
export function buildCommitmentDecision(approval = {}) {
  const { preview, approvedBy, approvedAt } = approval;
  if (objectErrors(preview, "preview").length > 0) {
    reject("INVALID_COMMITMENT", "An approved commitment preview is required.");
  }
  // Noor's gate, not a second one: the whole contract — arithmetic, eligibility,
  // confidence band, and the refusal to carry a credential or prompt text — is
  // re-checked here before anything of it is made durable. Its failure is
  // re-raised as this module's error so one caller catches one type.
  try {
    validateSavingsCommitment(preview, "preview");
  } catch (error) {
    reject("INVALID_COMMITMENT", `The commitment does not satisfy its own contract. ${error.message}`);
  }
  if (preview.status !== "ok" || !preview.commitment) {
    reject("NO_COMMITMENT",
      "This analysis proposes no commitment, so there is nothing to record as a decision.");
  }
  if (typeof approvedBy !== "string" || approvedBy.trim() === ""
    || approvedBy.trim().length > MAX_OWNER_LENGTH) {
    reject("INVALID_APPROVER",
      `An approval names who approved it, in at most ${MAX_OWNER_LENGTH} characters.`);
  }
  if (typeof approvedAt !== "string" || !INSTANT.test(approvedAt)) {
    reject("INVALID_APPROVED_AT",
      "An approval states its own instant as an ISO-8601 UTC instant (…Z); this module reads no clock.");
  }

  const metadata = projectMetadata(preview.commitment);
  const errors = commitmentMetadataErrors(metadata);
  if (errors.length > 0) reject("INVALID_METADATA", errors.join("; "));

  const context = commitmentContext(metadata);
  if (context.length > MAX_CONTEXT_LENGTH) {
    reject("INVALID_METADATA",
      `The commitment summary exceeds the ${MAX_CONTEXT_LENGTH}-character decision context.`);
  }

  return {
    id: approval.id ?? commitmentDecisionId(metadata.commitmentId),
    title: commitmentTitle(metadata.recommendedAction, metadata.commitmentId),
    context,
    // The one alternative this commitment was chosen over, stated plainly.
    alternatives: `Keep routing ${metadata.recommendedAction.workloadId} on `
      + `${metadata.recommendedAction.fromModelId}.`,
    owner: approvedBy.trim(),
    status: COMMITMENT_DECISION_STATUS,
    createdAt: approvedAt,
    [COMMITMENT_METADATA_FIELD]: metadata,
  };
}

/* -------------------------------- durability ------------------------------- */

/**
 * Record an approved commitment as a decision in this browser's log.
 *
 * The write goes through `saveDecisions`, so the decision is exactly as durable
 * — and as exportable — as one typed into the record form. At most one decision
 * is ever linked to a commitment: an approval whose commitment is already in
 * the log returns the decision that exists and writes nothing at all.
 *
 * @returns {{created: boolean, reason: string|null, decision: object}}
 */
export function recordCommitmentDecision(storage, approval = {}) {
  const decision = buildCommitmentDecision(approval);
  const commitmentId = decision[COMMITMENT_METADATA_FIELD].commitmentId;
  const decisions = loadDecisions(storage);

  const existing = findCommitmentDecision(decisions, commitmentId);
  if (existing) {
    return { created: false, reason: "already_linked", decision: existing };
  }
  // Newest first, matching what the record form does, so an approval lands
  // where a visitor expects to find it.
  saveDecisions(storage, [decision, ...decisions]);
  return { created: true, reason: null, decision };
}
