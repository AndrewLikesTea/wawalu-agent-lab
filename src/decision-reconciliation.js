// Reconcile every recorded decision against a later import, in one pass.
//
// WHAT THIS IS FOR
// ----------------
// `finops-commitment-decision.js` writes an approved commitment into the
// visitor's own Shiplog log as one decision carrying a bounded
// `finopsCommitment` block. `decision-outcome.js` answers "did *this* decision
// save what it projected?" for one decision a reader has already opened, from a
// month they opened beside it.
//
// Neither closes the loop the other way round. A FinOps leader does not open
// decisions one at a time hunting for the one a new month speaks to — they
// import the month and expect the log to tell them which of their recorded
// commitments it settles. That is this module: given the months opened in the
// normal import flow and the decisions already in the log, it reports one row
// per recorded commitment, and offers the derived result for persistence.
//
// THE MATCH RULE, STATED ONCE
// ---------------------------
// A decision is matched to an imported month by the STABLE COMMITMENT
// IDENTIFIER and by nothing else. `finops-briefing-commitment.js` derives that
// id as `canonical(orgUnitId-modelId)`, so the same org unit on the same route
// carries the same id in June and in October, while a different unit or a
// different route carries a different one. No fuzzy matching, no name
// similarity, no "closest month" — an identifier is equal or it is not.
//
// The consequence is deliberate: a month that does not carry a decision's
// commitment id produces `unmatched_commitment`, never a zero and never a
// silent skip. `unmatched_commitment` says the import was read and does not
// describe this commitment, which is a data problem with a data fix.
//
// AMBIGUITY IS AN ANSWER
// ----------------------
// The action center keeps every accepted file open, so the same commitment id
// can arrive twice. Two copies of a month that agree on the observed cost are
// one observation. Two that disagree are not a tie to be broken by file order —
// they are reported as `no_comparable_data` with the ambiguity named, because a
// figure that depends on which file was chosen last is the one property a
// number shown to a director must not have.
//
// WHAT IS PERSISTED
// -----------------
// `reconciliationRecord` is the whole allow-list, and `reconciliationErrors`
// enforces it in both directions. It holds derived integers, four enum-ish
// strings, three small counts, and the provenance ids the commitment block
// already carried. It holds NO raw export, no briefing text, no prompt, no
// credential, no per-row figure, no customer identifier, and not even the name
// of the file the month came from — a file name is the reader's own and has no
// business becoming durable in a log they will export and share.
//
// DETERMINISM
// -----------
// No clock, no randomness, no network, no DOM. `reconciledAt` is the instant the
// caller states. The row order is the decision order the caller passed in, and
// the arithmetic is `verifyCommitment`'s, read through `decisionOutcome` rather
// than re-implemented here.

import { loadDecisions, saveDecisions } from "./app.js";
import { nextCalendarMonth } from "./commitment-verification.js";
import { COMMITMENT_METADATA_FIELD } from "./finops-commitment-decision.js";
import { OUTCOME_STATUS, decisionOutcome, observationFromBriefing } from "./decision-outcome.js";

export const DECISION_RECONCILIATION_VERSION = "shiplog-decision-reconciliation/1.0.0";

/** The one question this pass answers, carried so a surface cannot retitle it. */
export const DECISION_RECONCILIATION_QUESTION =
  "Which recorded decisions does this import settle?";

/** The one optional decision field a reconciliation ever occupies. */
export const RECONCILIATION_METADATA_FIELD = "finopsReconciliation";

/** The four states a FinOps leader acts on differently. */
export const RECONCILIATION_STATUS = Object.freeze({
  verified: "verified",
  underperforming: "underperforming",
  noComparableData: "no_comparable_data",
  unmatchedCommitment: "unmatched_commitment",
});

/**
 * The projection from the outcome model's four states onto this surface's four.
 * Exported as data so a test can assert it is total: a state with no entry here
 * would fall through to a default and be shown as the wrong kind of row.
 *
 * It is 1:1 on purpose. Two vocabularies for the same ladder is how the decision
 * page and this page end up disagreeing about the same decision.
 */
export const RECONCILIATION_STATUS_FROM_OUTCOME = Object.freeze({
  [OUTCOME_STATUS.verified]: RECONCILIATION_STATUS.verified,
  [OUTCOME_STATUS.underperforming]: RECONCILIATION_STATUS.underperforming,
  [OUTCOME_STATUS.inconclusive]: RECONCILIATION_STATUS.noComparableData,
  [OUTCOME_STATUS.unmatched]: RECONCILIATION_STATUS.unmatchedCommitment,
});

/** Reasons this module raises itself, about the match rather than the arithmetic. */
export const RECONCILIATION_REASON = Object.freeze({
  commitmentNotObserved: "commitment_not_observed",
  ambiguousCommitmentMatch: "ambiguous_commitment_match",
});

export const RECONCILIATION_REASON_STATEMENT = Object.freeze({
  [RECONCILIATION_REASON.commitmentNotObserved]:
    "No imported month carries this decision's commitment identifier, so this import observes a "
    + "different org unit or a different route. Import the month that covers the committed route.",
  [RECONCILIATION_REASON.ambiguousCommitmentMatch]:
    "Two opened files claim the same commitment identifier for the same month and disagree about "
    + "the observed cost, so neither is used. Close one of them and open the month once.",
});

/**
 * The non-colour cue per state: a word, a glyph, and a shape token. The word is
 * what a screen reader reads and what a greyscale print carries; colour is added
 * on top of these three and is never the carrier.
 */
export const RECONCILIATION_STATUS_CUE = Object.freeze({
  [RECONCILIATION_STATUS.verified]: Object.freeze({
    label: "Verified", glyph: "✓", shape: "solid",
  }),
  [RECONCILIATION_STATUS.underperforming]: Object.freeze({
    label: "Underperforming", glyph: "▼", shape: "double",
  }),
  [RECONCILIATION_STATUS.noComparableData]: Object.freeze({
    label: "No comparable data", glyph: "?", shape: "dashed",
  }),
  [RECONCILIATION_STATUS.unmatchedCommitment]: Object.freeze({
    label: "Unmatched commitment", glyph: "≠", shape: "dotted",
  }),
});

/**
 * Every rule this module adds, with the assumption behind it written down beside
 * it. These are the sentences a director disputes, so they are data a surface
 * renders rather than prose buried in a comment.
 */
export const RECONCILIATION_RULES = Object.freeze({
  match: Object.freeze({
    rule: "An imported month settles a decision when the month's commitment identifier equals the "
      + "identifier stored on the decision. Equality only; nothing is matched by name.",
    assumption: "The identifier is canonical(orgUnitId-modelId) and is stable across months, so the "
      + "same unit on the same route is the same commitment in every period.",
  }),
  pairing: Object.freeze({
    rule: "Where a commitment id matches more than one opened month, the month directly after the "
      + "decision's baseline is used; otherwise the earliest matching month is used and the "
      + "pairing rule reports it as unpaired.",
    assumption: "A monthly commitment is settled by the month after the one it was priced in. Any "
      + "other month's difference is not this commitment's result.",
  }),
  ambiguity: Object.freeze({
    rule: "Two opened files claiming the same commitment id and month with different observed costs "
      + "produce no observation at all.",
    assumption: "A figure that depends on which duplicate file was read last is not reproducible, "
      + "and an unreproducible figure is worse than an absent one.",
  }),
  status: Object.freeze({
    rule: "The four states are a 1:1 projection of the decision outcome model's four states; this "
      + "module invents no fifth verdict and softens none of the four.",
    assumption: "The projected-versus-realized arithmetic, its boundaries, and its refusals belong "
      + "to verifyCommitment; a second opinion computed here would be a second rubric.",
  }),
  amounts: Object.freeze({
    rule: "Every persisted amount is an integer of USD minor units copied from the comparison; no "
      + "rounding, scaling, or currency conversion happens here.",
    assumption: "The import states one currency, and the commitment block already refused anything "
      + "that was not USD minor units.",
  }),
});

/**
 * The drift threshold for a regression check, in USD minor units.
 *
 * A labelled fixture's status must never move at all. An amount is allowed to be
 * re-expressed — a formatter change, a rounding boundary — but a move of a dollar
 * or more on a fixture whose inputs did not change is a rubric change, and a
 * rubric change has to be argued for rather than merged quietly.
 */
export const MATERIAL_AMOUNT_MINOR = 100;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ------------------------------ matching months ---------------------------- */

/** The commitment identifier an opened briefing observes, or null. */
export function entryCommitmentId(entry) {
  const block = entry?.commitment;
  if (!block || block.status !== "ok" || !block.commitment) return null;
  const id = block.commitment.commitmentId;
  return typeof id === "string" && id !== "" ? id : null;
}

// The observed cost this entry states for its own route, in minor units. Two
// files that agree on this agree on the only figure the comparison reads out of
// them; two that disagree are the ambiguity case.
function entryObservedMinor(entry) {
  return entry?.commitment?.commitment?.baseline?.monthlyCostMinor ?? null;
}

/**
 * Group the opened months by the commitment identifier each one observes.
 *
 * @returns a Map of id → `{ months: Map<month, {entry, conflicting}> }`. Entries
 *   carrying no readable commitment block are dropped here rather than at the
 *   call site: a briefing with no block observes nothing, not zero.
 */
export function observationsByCommitment(entries = []) {
  const byId = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = entryCommitmentId(entry);
    const month = entry?.month;
    if (!id || !PERIOD.test(String(month ?? ""))) continue;
    if (!byId.has(id)) byId.set(id, new Map());
    const months = byId.get(id);
    const seen = months.get(month);
    if (!seen) {
      months.set(month, { entry, conflicting: false });
      continue;
    }
    // Agreeing copies are one observation; a disagreement is recorded on the
    // month and settled as an absence rather than by file order.
    if (entryObservedMinor(seen.entry) !== entryObservedMinor(entry)) seen.conflicting = true;
  }
  return byId;
}

/**
 * The one month used to settle this commitment, under the stated pairing rule.
 *
 * @returns `{ entry, conflicting }`, or null when no opened month carries the id.
 */
export function selectObservation(months, baselinePeriod) {
  if (!months || months.size === 0) return null;
  const paired = PERIOD.test(String(baselinePeriod ?? ""))
    ? nextCalendarMonth(baselinePeriod) : null;
  if (paired && months.has(paired)) return months.get(paired);
  // Deterministic fallback: the earliest matching month, sorted as text — which
  // for `YYYY-MM` is chronological. The pairing rule inside verifyCommitment
  // then refuses it by name instead of this module guessing at an answer.
  const earliest = [...months.keys()].sort()[0];
  return months.get(earliest);
}

/* ------------------------------ the persisted block ------------------------ */

const RECONCILIATION_KEYS = Object.freeze([
  "schemaVersion", "commitmentId", "status", "verdict", "reason", "baselinePeriod",
  "observedPeriod", "projectedMonthlySavingsMinor", "observedMonthlySavingsMinor",
  "varianceMinor", "attainmentPercent", "confidence", "evidence", "provenance", "reconciledAt",
]);

function isIntegerOrNull(value) {
  return value === null || Number.isSafeInteger(value);
}

function objectErrors(value, path) {
  return value === null || typeof value !== "object" || Array.isArray(value)
    ? [`${path}: expected an object`] : [];
}

/**
 * Every rule about the persisted block, in one place, run in both directions:
 * before a write, and over a block that arrived in an imported log.
 *
 * @returns a list of human-readable errors; empty means the block is storable.
 */
export function reconciliationErrors(block, path = RECONCILIATION_METADATA_FIELD) {
  const shape = objectErrors(block, path);
  if (shape.length > 0) return shape;
  const errors = [];
  // Closed both ways. An undeclared field is exactly how a raw export row gets
  // carried into durable storage by a later change nobody reviewed.
  for (const key of Object.keys(block)) {
    if (!RECONCILIATION_KEYS.includes(key)) {
      errors.push(`${path}.${key}: unknown field; this block carries only `
        + `${RECONCILIATION_KEYS.join(", ")}`);
    }
  }
  if (block.schemaVersion !== DECISION_RECONCILIATION_VERSION) {
    errors.push(`${path}.schemaVersion: expected ${JSON.stringify(DECISION_RECONCILIATION_VERSION)}`);
  }
  if (typeof block.commitmentId !== "string" || block.commitmentId === "") {
    errors.push(`${path}.commitmentId: expected the stable commitment identifier`);
  }
  if (!Object.values(RECONCILIATION_STATUS).includes(block.status)) {
    errors.push(`${path}.status: expected one of ${Object.values(RECONCILIATION_STATUS).join(", ")}`);
  }
  for (const key of ["verdict", "reason", "baselinePeriod", "observedPeriod"]) {
    if (block[key] !== null && typeof block[key] !== "string") {
      errors.push(`${path}.${key}: expected a string or null`);
    }
  }
  for (const key of ["projectedMonthlySavingsMinor", "observedMonthlySavingsMinor",
    "varianceMinor", "attainmentPercent"]) {
    if (!isIntegerOrNull(block[key])) {
      errors.push(`${path}.${key}: expected a safe integer or null`);
    }
  }
  if (typeof block.reconciledAt !== "string" || !INSTANT.test(block.reconciledAt)) {
    errors.push(`${path}.reconciledAt: expected an ISO-8601 UTC instant; this module reads no clock`);
  }
  errors.push(...nestedErrors(block, path));
  return errors;
}

function nestedErrors(block, path) {
  const errors = [];
  const confidence = block.confidence;
  if (objectErrors(confidence, `${path}.confidence`).length > 0) {
    errors.push(`${path}.confidence: expected an object`);
  } else {
    if (typeof confidence.level !== "string") {
      errors.push(`${path}.confidence.level: expected a string`);
    }
    if (!isIntegerOrNull(confidence.statedPercent)) {
      errors.push(`${path}.confidence.statedPercent: expected a safe integer or null`);
    }
  }
  const evidence = block.evidence;
  if (objectErrors(evidence, `${path}.evidence`).length > 0) {
    errors.push(`${path}.evidence: expected an object`);
  } else {
    for (const key of ["baselineRecordCount", "observedRecordCount"]) {
      if (!Number.isSafeInteger(evidence[key]) || evidence[key] < 0) {
        errors.push(`${path}.evidence.${key}: expected a non-negative safe integer`);
      }
    }
    if (typeof evidence.complete !== "boolean") {
      errors.push(`${path}.evidence.complete: expected a boolean`);
    }
  }
  const provenance = block.provenance;
  if (objectErrors(provenance, `${path}.provenance`).length > 0) {
    errors.push(`${path}.provenance: expected an object`);
  } else {
    for (const key of ["sourceId", "designation", "observedDataset", "observedSavedOn"]) {
      if (provenance[key] !== null && typeof provenance[key] !== "string") {
        errors.push(`${path}.provenance.${key}: expected a string or null`);
      }
    }
  }
  return errors;
}

/**
 * The derived block a reconciled row is persisted as. Every value is copied out
 * of the outcome model; nothing here is recomputed and nothing raw is carried.
 */
export function reconciliationRecord(row, reconciledAt) {
  const { outcome } = row;
  const comparison = outcome?.comparison ?? null;
  return {
    schemaVersion: DECISION_RECONCILIATION_VERSION,
    commitmentId: row.commitmentId,
    status: row.status,
    verdict: outcome?.verdict ?? null,
    reason: row.reason ?? null,
    baselinePeriod: outcome?.provenance?.baselinePeriod ?? null,
    observedPeriod: outcome?.provenance?.observedPeriod ?? null,
    projectedMonthlySavingsMinor: comparison?.projectedMinor ?? null,
    observedMonthlySavingsMinor: comparison?.observedMinor ?? null,
    varianceMinor: comparison?.varianceMinor ?? null,
    attainmentPercent: comparison?.attainmentPercent ?? null,
    confidence: {
      level: outcome?.confidence?.level ?? "low",
      statedPercent: outcome?.confidence?.statedPercent ?? null,
    },
    evidence: {
      baselineRecordCount: outcome?.evidence?.baselineRecordCount ?? 0,
      observedRecordCount: outcome?.evidence?.observedRecordCount ?? 0,
      complete: Boolean(outcome?.evidence?.complete),
    },
    // Provenance is the commitment's own source designation plus what the
    // observed month declared about itself. The file's name is deliberately
    // absent: it is the reader's own and does not belong in a durable record.
    provenance: {
      sourceId: outcome?.provenance?.sourceId ?? null,
      designation: outcome?.provenance?.designation ?? null,
      observedDataset: outcome?.provenance?.observedDataset ?? null,
      observedSavedOn: outcome?.provenance?.observedSavedOn ?? null,
    },
    reconciledAt,
  };
}

/** True when two blocks say the same thing, ignoring when they were computed. */
export function sameReconciliation(left, right) {
  if (!left || !right) return false;
  const strip = (block) => JSON.stringify({ ...block, reconciledAt: null });
  return strip(left) === strip(right);
}

/* --------------------------------- the model -------------------------------- */

/**
 * Reconcile every recorded commitment decision against the opened months.
 *
 * @param input.decisions the stored decisions, as `loadDecisions` returns them.
 * @param input.releases the stored releases, for the linked-release lookup.
 * @param input.entries the months opened by the import flow, as
 *   `readEvidenceFiles` produced them.
 * @param input.reconciledAt an ISO-8601 UTC instant the caller states.
 * @returns a frozen model. Total: it never throws, and a decision that cannot be
 *   settled is a row with a status and a sentence, never an omission.
 */
export function reconcileImportedAnalysis(input = {}) {
  const {
    decisions = [], releases = [], entries = [], reconciledAt = null,
    attributionWithheld = false,
  } = input;
  const grouped = observationsByCommitment(entries);
  const openedMonths = [...new Set((Array.isArray(entries) ? entries : [])
    .map((entry) => entry?.month).filter((month) => PERIOD.test(String(month ?? ""))))].sort();

  const rows = (Array.isArray(decisions) ? decisions : [])
    .filter((decision) => decision?.[COMMITMENT_METADATA_FIELD]?.commitmentId)
    .map((decision) => reconcileOne({
      decision, releases, grouped, reconciledAt, attributionWithheld, anyOpened: openedMonths.length > 0,
    }));

  const counts = Object.fromEntries(Object.values(RECONCILIATION_STATUS)
    .map((status) => [status, rows.filter((row) => row.status === status).length]));

  return Object.freeze({
    schemaVersion: DECISION_RECONCILIATION_VERSION,
    question: DECISION_RECONCILIATION_QUESTION,
    reconciledAt,
    openedMonths: Object.freeze(openedMonths),
    counts: Object.freeze(counts),
    rows: Object.freeze(rows),
    rules: RECONCILIATION_RULES,
  });
}

function reconcileOne({
  decision, releases, grouped, reconciledAt, attributionWithheld, anyOpened,
}) {
  const block = decision[COMMITMENT_METADATA_FIELD];
  const commitmentId = block.commitmentId;
  const months = grouped.get(commitmentId);
  const selected = selectObservation(months, block.claim?.period);

  // A conflict between two copies of the same month is settled as an absence,
  // and it is settled here rather than by handing verification one of the two.
  const conflicting = Boolean(selected?.conflicting);
  const matchedEntry = conflicting ? null : selected?.entry ?? null;

  const outcome = decisionOutcome({
    decision,
    releases,
    observation: matchedEntry ? observationFromBriefing(matchedEntry) : null,
    observationMeta: matchedEntry
      ? {
        month: matchedEntry.month,
        dataset: matchedEntry.dataset ?? null,
        savedOn: matchedEntry.savedOn ?? null,
        name: matchedEntry.name ?? null,
      }
      : null,
    attributionWithheld,
  });

  // Precedence: this module's own two reasons come first, because both are about
  // which month was used and neither is a statement about the arithmetic.
  let status = RECONCILIATION_STATUS_FROM_OUTCOME[outcome.status]
    ?? RECONCILIATION_STATUS.noComparableData;
  let reason = null;
  let statement = outcome.statement;
  if (conflicting) {
    status = RECONCILIATION_STATUS.noComparableData;
    reason = RECONCILIATION_REASON.ambiguousCommitmentMatch;
    statement = RECONCILIATION_REASON_STATEMENT[reason];
  } else if (!matchedEntry && anyOpened) {
    status = RECONCILIATION_STATUS.unmatchedCommitment;
    reason = RECONCILIATION_REASON.commitmentNotObserved;
    statement = RECONCILIATION_REASON_STATEMENT[reason];
  } else if (outcome.reason) {
    reason = outcome.reason;
  }

  const row = {
    decisionId: decision.id,
    title: decision.title,
    owner: decision.owner ?? null,
    commitmentId,
    status,
    cue: RECONCILIATION_STATUS_CUE[status],
    reason,
    statement,
    observedMonth: matchedEntry?.month ?? null,
    baselinePeriod: block.claim?.period ?? null,
    href: `/decision.html?id=${encodeURIComponent(decision.id)}`,
    outcome,
  };
  row.record = reconciliationRecord(row, reconciledAt);
  return Object.freeze(row);
}

/* -------------------------------- durability -------------------------------- */

/**
 * Write each row's derived block onto the decision it belongs to.
 *
 * The write goes through `saveDecisions`, so a reconciliation is exactly as
 * durable — and as exportable — as the decision that carries it, and a browser
 * that has declined retention refuses it the same way it refuses everything
 * else. A row whose block already says the same thing is left alone: rewriting
 * it would move `reconciledAt` and make an unchanged log look freshly touched.
 *
 * @returns `{ written, unchanged, invalid, blocked }` — counts plus, when the
 *   store refused, the message it refused with.
 */
export function persistReconciliations(storage, model) {
  const stored = loadDecisions(storage);
  const rowsById = new Map((model?.rows ?? []).map((row) => [row.decisionId, row]));
  let written = 0;
  let unchanged = 0;
  const invalid = [];

  const next = stored.map((decision) => {
    const row = rowsById.get(decision?.id);
    if (!row) return decision;
    const errors = reconciliationErrors(row.record);
    if (errors.length > 0) {
      invalid.push({ decisionId: decision.id, errors });
      return decision;
    }
    if (sameReconciliation(decision[RECONCILIATION_METADATA_FIELD], row.record)) {
      unchanged += 1;
      return decision;
    }
    written += 1;
    return { ...decision, [RECONCILIATION_METADATA_FIELD]: row.record };
  });

  if (written === 0) return { written: 0, unchanged, invalid, blocked: null };
  try {
    saveDecisions(storage, next);
  } catch (error) {
    return {
      written: 0, unchanged, invalid, blocked: error?.message ?? "The decision log was not written.",
    };
  }
  return { written, unchanged, invalid, blocked: null };
}
