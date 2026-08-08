/**
 * The savings-commitment contract.
 *
 * One question, asked by one person, once: *what should we commit to now?*
 *
 * `savings-portfolio` answers how a plan already under way is tracking.
 * `savings-action-center` answers which running action is off-plan this month.
 * Neither answers the step before both: an analysis has just been imported, and
 * nothing has been committed to yet. This contract turns that imported analysis
 * into exactly one proposed commitment — one department, one routing change, one
 * baseline, one projected monthly saving, one confidence, and the provenance of
 * the records it came from — or into a plain sentence saying there is nothing
 * worth committing to.
 *
 * WHAT THIS CONTRACT REFUSES TO CARRY.
 *
 *   - No credential of any kind. `validateSavingsCommitment` walks the whole
 *     payload and rejects any key or value shaped like a token, key, cookie,
 *     bearer header, or private key. There is nothing here to authenticate to.
 *   - No prompt, completion, transcript, or conversation text. The analysis this
 *     contract consumes is cost and routing figures. A prompt body is neither,
 *     and a field carrying one is rejected at any depth.
 *   - No customer-data persistence. This module reads and writes no storage, no
 *     cookie, no clock, and no origin but its own bundled fixture. Every figure
 *     lives for as long as the tab does.
 *   - No live integration. No provider is contacted, no rate card is consulted,
 *     and no number here is estimated from anything the imported analysis did
 *     not already state.
 *   - No second commitment. A list of five things to maybe do is the surface
 *     this product keeps rebuilding away from. Exactly one is proposed; the rest
 *     are `excluded`, each with the reason it lost.
 *
 * Money is integer USD minor units end to end, so two engineers with the same
 * imported analysis and a calculator reproduce every figure exactly.
 *
 * The downstream action implementation — accepting a commitment, tracking it,
 * and reconciling it against a measured month — is deliberately NOT in this
 * change and is documented as depending on this contract. See `downstream` on
 * the built preview and `docs/savings-commitment-contract.md`.
 */

export const SAVINGS_COMMITMENT_VERSION = "savings-commitment/1.0.0";
export const SAVINGS_COMMITMENT_INPUT_VERSION = "savings-commitment-input/1.0.0";

/** The one question. Carried in the payload so the UI cannot retitle the answer. */
export const SAVINGS_COMMITMENT_QUESTION = "What should we commit to now?";

/** Exactly one is reported. There is no third shape. */
export const SAVINGS_COMMITMENT_STATUSES = Object.freeze(["ok", "no_commitment"]);

/**
 * How the imported analysis reached this build. Required, and rendered, so a
 * bundled demo figure is never mistaken for a leader's own imported number.
 */
export const SAVINGS_COMMITMENT_DESIGNATIONS = Object.freeze(["fixture", "demo", "imported"]);

/**
 * Confidence is stored as an integer percent and reported on an explicit 0-to-1
 * scale. Storing the decimal instead would make `0.7` and `0.70000000000000007`
 * two different valid inputs, and validation is meant to be deterministic.
 */
export const CONFIDENCE_SCALE = Object.freeze({
  field: "confidence.percent",
  min: 0,
  max: 100,
  step: 1,
  reportedAs: "0-1",
});

/** Band thresholds, stated once. A band is derived, never supplied. */
export const CONFIDENCE_BANDS = Object.freeze([
  Object.freeze({ band: "high", minPercent: 75 }),
  Object.freeze({ band: "medium", minPercent: 50 }),
  Object.freeze({ band: "low", minPercent: 0 }),
]);

/**
 * The metric definitions, as data rather than prose in a wiki, so the code and
 * `docs/savings-commitment-contract.md` cannot drift apart.
 */
export const SAVINGS_COMMITMENT_METRIC_RULES = Object.freeze({
  unit:
    "Integer USD minor units (cents). Every monetary field in this contract is minor units. "
    + "A non-integer, a negative, or a float dollar amount is rejected, never rounded.",
  baseline:
    "baseline.monthlyCostMinor is the imported analysis's own monthly cost for the named "
    + "workload scope in the named period. It is carried verbatim from the import and is never "
    + "recomputed, prorated, annualized, or inferred here.",
  projectedMonthlySavings:
    "projectedMonthlySavingsMinor = max(0, baseline.monthlyCostMinor - "
    + "projected.monthlyCostMinor), where both costs are stated by the imported analysis for the "
    + "IDENTICAL workloadId and the IDENTICAL period. A candidate whose two sides name different "
    + "scopes or periods is rejected, not reconciled. No figure is estimated from an input the "
    + "import did not record.",
  eligibility:
    "A candidate is committable only when projectedMonthlySavingsMinor is strictly greater than "
    + "zero. A projection that meets or exceeds its own baseline saves nothing, and is reported "
    + "as that sentence rather than as a commitment worth zero.",
  department:
    "department.departmentId is a canonical identifier supplied by the imported analysis. It is "
    + "lower-case kebab-case, never a display label: an identifier carrying spaces or capitals "
    + "is rejected precisely because it was probably read off the UI rather than out of the "
    + "import. department.name is display text and is never used to identify anything.",
  routing:
    "routing names currentRoute.modelId, proposedRoute.modelId, the workloadId both apply to, a "
    + "rationale, and at least one evidence statement tied to an imported record id. The two "
    + "routes must differ; a recommendation to keep doing what you are doing is not a "
    + "recommendation.",
  confidence:
    "confidence.percent is an integer from 0 through 100 inclusive, supplied by the imported "
    + "analysis with a stated basis. It is reported additionally as confidence.value on a 0-to-1 "
    + "scale and as a derived band (high >= 75, medium >= 50, low otherwise). The band is never "
    + "supplied; supplying one is rejected.",
  provenance:
    "provenance carries the imported analysis's sourceId, its import timestamp, its analysis "
    + "period where the import recorded one, its designation (fixture, demo, or imported), and "
    + "the exact record ids the commitment was computed from. A commitment whose record ids are "
    + "missing, empty, or not present in the source's record index is rejected.",
  ranking:
    "Exactly one commitment is proposed. Eligible candidates are ordered by "
    + "projectedMonthlySavingsMinor descending, then confidence.percent descending, then "
    + "candidateId ascending. Every step is total, so the same import produces the same winner "
    + "in any input order.",
});

export class SavingsCommitmentValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "SavingsCommitmentValidationError";
    this.path = path;
  }
}

function invalid(path, message) {
  throw new SavingsCommitmentValidationError(path, message);
}

/* -------------------------------- primitives ------------------------------ */

const CANONICAL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MAX_ID_LENGTH = 64;
const MAX_TEXT_LENGTH = 400;

const PLACEHOLDER_IDS = Object.freeze([
  "unknown", "unassigned", "none", "null", "undefined", "n-a", "na", "other", "tbd", "default",
]);

function text(value, path, { max = MAX_TEXT_LENGTH } = {}) {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    invalid(path, "must be a non-empty trimmed string");
  }
  if (value.length > max) invalid(path, `must be at most ${max} characters`);
  return value;
}

/**
 * A canonical identifier out of the imported analysis, not a label off a screen.
 * The shape is the check: an id with a space or a capital in it came from a
 * heading, and a heading is renamed by whoever is designing that week.
 */
function canonicalId(value, path) {
  text(value, path, { max: MAX_ID_LENGTH });
  if (!CANONICAL_ID.test(value)) {
    invalid(path, "must be a canonical lower-case kebab-case identifier supplied by the imported "
      + "analysis, never a display label");
  }
  if (PLACEHOLDER_IDS.includes(value)) {
    invalid(path, `must identify something; “${value}” is a placeholder the exporter writes when `
      + "it does not know");
  }
  return value;
}

function minorUnits(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalid(path, "must be a non-negative safe integer in USD minor units");
  }
  return value;
}

function period(value, path) {
  if (typeof value !== "string" || !PERIOD.test(value)) invalid(path, "must be a YYYY-MM period");
  return value;
}

function plainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "must be an object");
  return value;
}

function nonEmptyArray(value, path) {
  if (!Array.isArray(value) || value.length === 0) invalid(path, "must be a non-empty array");
  return value;
}

const usd = (minor) => Math.round(minor) / 100;

/**
 * `4820000` to `"48,200.00"`. Grouped by hand rather than through `Intl`, so a
 * string asserted by a test does not depend on the machine's default locale.
 */
function money(minor) {
  const [whole, fraction] = usd(minor).toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

/** Canonical ids are ASCII; code-unit order is stable across runtimes and locales. */
function compareCanonicalIds(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/* --------------------------- the refusal boundary -------------------------- */

/**
 * Field names this contract will not carry, matched without word boundaries
 * because the field that smuggles a secret back in will be named
 * `providerApiKeyRef`, not `key`.
 */
const FORBIDDEN_KEY_PATTERNS = Object.freeze([
  Object.freeze({
    pattern: /token|secret|password|passphrase|credential|apikey|api_key|authorization|bearer|cookie|sessionid|session_id|privatekey|private_key/i,
    reason: "names a credential; this contract authenticates to nothing and stores no secret",
  }),
  Object.freeze({
    pattern: /prompt|completion|transcript|conversation|messagebody|chatlog/i,
    reason: "names prompt or conversation content; this contract consumes cost and routing "
      + "figures only",
  }),
  Object.freeze({
    pattern: /customeremail|customername|enduser|personalname|emailaddress/i,
    reason: "names customer or personal data, which this contract never carries",
  }),
]);

/** Value shapes that are a credential no matter what the field is called. */
const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  Object.freeze({ pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: "a private key" }),
  Object.freeze({ pattern: /\bBearer\s+[A-Za-z0-9._-]{8,}/, reason: "a bearer token" }),
  Object.freeze({ pattern: /\b(sk|pk|ghp|gho|ghs|xox[baprs])[-_][A-Za-z0-9]{12,}/, reason: "an API key" }),
]);

/**
 * Walk every key and every string in the payload. Both directions matter: a
 * clean field name can still hold a key, and a clean value can still sit under
 * a field name that invites one.
 */
function assertNoForbiddenContent(value, path) {
  if (typeof value === "string") {
    for (const { pattern, reason } of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) invalid(path, `carries what looks like ${reason}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenContent(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    for (const { pattern, reason } of FORBIDDEN_KEY_PATTERNS) {
      if (pattern.test(key)) invalid(`${path}.${key}`, reason);
    }
    assertNoForbiddenContent(nested, `${path}.${key}`);
  }
}

/* ------------------------------ input validation --------------------------- */

/**
 * @typedef {object} ImportedAnalysisSource
 * @property {string} sourceId Canonical id of the imported analysis.
 * @property {string} importedAt ISO instant the analysis was imported.
 * @property {string|null} analysisPeriod `YYYY-MM`, or null when the import recorded none.
 * @property {"fixture"|"demo"|"imported"} designation How this analysis reached the build.
 * @property {string[]} recordIds Every input record id the analysis exposes.
 */

/** Validate the imported-analysis envelope. Malformed input fails loudly. */
export function validateImportedAnalysis(input, path = "analysis") {
  plainObject(input, path);
  if (input.schemaVersion !== SAVINGS_COMMITMENT_INPUT_VERSION) {
    invalid(`${path}.schemaVersion`, `must be ${SAVINGS_COMMITMENT_INPUT_VERSION}`);
  }
  assertNoForbiddenContent(input, path);

  const source = plainObject(input.source, `${path}.source`);
  canonicalId(source.sourceId, `${path}.source.sourceId`);
  if (typeof source.importedAt !== "string" || !INSTANT.test(source.importedAt)) {
    invalid(`${path}.source.importedAt`, "must be an ISO-8601 UTC instant (…Z)");
  }
  if (source.analysisPeriod !== null) period(source.analysisPeriod, `${path}.source.analysisPeriod`);
  if (!SAVINGS_COMMITMENT_DESIGNATIONS.includes(source.designation)) {
    invalid(`${path}.source.designation`,
      `must be one of ${SAVINGS_COMMITMENT_DESIGNATIONS.join(", ")}`);
  }
  if (source.currency !== "USD") invalid(`${path}.source.currency`, "must be USD");
  if (source.unit !== "usd_minor") {
    invalid(`${path}.source.unit`, "must be usd_minor; this contract carries no other unit");
  }
  nonEmptyArray(source.recordIds, `${path}.source.recordIds`)
    .forEach((id, index) => canonicalId(id, `${path}.source.recordIds[${index}]`));

  nonEmptyArray(input.candidates, `${path}.candidates`);
  const known = new Set(source.recordIds);
  const seen = new Set();
  input.candidates.forEach((candidate, index) => {
    validateCandidate(candidate, known, `${path}.candidates[${index}]`);
    if (seen.has(candidate.candidateId)) {
      invalid(`${path}.candidates[${index}].candidateId`,
        `repeats “${candidate.candidateId}”; a candidate is proposed once`);
    }
    seen.add(candidate.candidateId);
  });
  return input;
}

/**
 * Validate one candidate commitment. Every rule here exists to reject the
 * incomplete or the ambiguous: a missing owner, a projection measured against a
 * different month than its own baseline, a routing change that changes nothing.
 */
export function validateCandidate(candidate, knownRecordIds, path = "candidate") {
  plainObject(candidate, path);
  canonicalId(candidate.candidateId, `${path}.candidateId`);

  const scope = plainObject(candidate.workloadScope, `${path}.workloadScope`);
  canonicalId(scope.workloadId, `${path}.workloadScope.workloadId`);
  text(scope.description, `${path}.workloadScope.description`);
  period(scope.period, `${path}.workloadScope.period`);

  const department = plainObject(candidate.department, `${path}.department`);
  canonicalId(department.departmentId, `${path}.department.departmentId`);
  text(department.name, `${path}.department.name`, { max: 120 });

  const owner = plainObject(candidate.accountableOwner, `${path}.accountableOwner`);
  text(owner.role, `${path}.accountableOwner.role`, { max: 120 });

  const candidateRecordIds = nonEmptyArray(candidate.recordIds, `${path}.recordIds`);
  const candidateRecordIdSet = new Set();
  candidateRecordIds.forEach((id, index) => {
    canonicalId(id, `${path}.recordIds[${index}]`);
    if (!knownRecordIds.has(id)) {
      invalid(`${path}.recordIds[${index}]`,
        `names record “${id}”, which this imported analysis does not contain`);
    }
    if (candidateRecordIdSet.has(id)) {
      invalid(`${path}.recordIds[${index}]`, `repeats record “${id}”`);
    }
    candidateRecordIdSet.add(id);
  });

  validateRouting(candidate.routing, scope.workloadId, candidateRecordIdSet, `${path}.routing`);
  validateCost(candidate.baseline, scope, `${path}.baseline`);
  validateCost(candidate.projected, scope, `${path}.projected`);

  const confidence = plainObject(candidate.confidence, `${path}.confidence`);
  if ("band" in confidence) {
    invalid(`${path}.confidence.band`, "is derived from the percent and must not be supplied");
  }
  if (!Number.isInteger(confidence.percent)
    || confidence.percent < CONFIDENCE_SCALE.min || confidence.percent > CONFIDENCE_SCALE.max) {
    invalid(`${path}.confidence.percent`,
      `must be an integer from ${CONFIDENCE_SCALE.min} through ${CONFIDENCE_SCALE.max} inclusive`);
  }
  text(confidence.basis, `${path}.confidence.basis`);

  return candidate;
}

function validateRouting(routing, workloadId, provenanceRecordIds, path) {
  plainObject(routing, path);
  const current = plainObject(routing.currentRoute, `${path}.currentRoute`);
  const proposed = plainObject(routing.proposedRoute, `${path}.proposedRoute`);
  canonicalId(current.modelId, `${path}.currentRoute.modelId`);
  canonicalId(proposed.modelId, `${path}.proposedRoute.modelId`);
  if (current.modelId === proposed.modelId) {
    invalid(`${path}.proposedRoute.modelId`,
      "must differ from the current route; keeping the current route is not a recommendation");
  }
  if (routing.workloadId !== workloadId) {
    invalid(`${path}.workloadId`, "must name the same workload as workloadScope.workloadId");
  }
  text(routing.rationale, `${path}.rationale`);
  nonEmptyArray(routing.evidence, `${path}.evidence`).forEach((item, index) => {
    plainObject(item, `${path}.evidence[${index}]`);
    canonicalId(item.recordId, `${path}.evidence[${index}].recordId`);
    if (!provenanceRecordIds.has(item.recordId)) {
      invalid(`${path}.evidence[${index}].recordId`,
        "must be included in the candidate recordIds carried into provenance");
    }
    text(item.statement, `${path}.evidence[${index}].statement`);
  });
}

/**
 * A cost side of the comparison. Both sides restate their own workload and
 * period so the "identical scope and period" rule is mechanically checkable
 * rather than a comment somebody has to remember.
 */
function validateCost(cost, scope, path) {
  plainObject(cost, path);
  minorUnits(cost.monthlyCostMinor, `${path}.monthlyCostMinor`);
  if (cost.workloadId !== scope.workloadId) {
    invalid(`${path}.workloadId`,
      "must name the same workload as workloadScope.workloadId; a saving computed across two "
      + "scopes is not a saving");
  }
  if (cost.period !== scope.period) {
    invalid(`${path}.period`,
      "must name the same period as workloadScope.period; a saving computed across two months is "
      + "not a saving");
  }
}

/* -------------------------------- derivation ------------------------------- */

/**
 * The one arithmetic rule, isolated so a test can hold it on its own.
 *
 * @returns {number} `max(0, baseline - projected)` in USD minor units.
 */
export function projectedMonthlySavingsMinor(baselineMinor, projectedMinor) {
  minorUnits(baselineMinor, "baselineMonthlyCostMinor");
  minorUnits(projectedMinor, "projectedMonthlyCostMinor");
  return Math.max(0, baselineMinor - projectedMinor);
}

/** Derived from the percent, never supplied. */
export function confidenceBand(percent) {
  return CONFIDENCE_BANDS.find((entry) => percent >= entry.minPercent).band;
}

function buildProvenance(source, candidate) {
  return {
    sourceId: source.sourceId,
    analysisSchemaVersion: SAVINGS_COMMITMENT_INPUT_VERSION,
    importedAt: source.importedAt,
    analysisPeriod: source.analysisPeriod,
    designation: source.designation,
    recordIds: [...candidate.recordIds],
    recordCount: candidate.recordIds.length,
  };
}

function buildCommitment(source, candidate, savingsMinor) {
  const { workloadScope: scope, confidence } = candidate;
  return {
    commitmentId: candidate.candidateId,
    rank: 1,
    headline: `Route ${scope.description} from ${candidate.routing.currentRoute.modelId} to `
      + `${candidate.routing.proposedRoute.modelId}, saving `
      + `$${money(savingsMinor)} a month against a `
      + `$${money(candidate.baseline.monthlyCostMinor)} ${scope.period} baseline.`,
    workloadScope: { ...scope },
    department: { ...candidate.department },
    accountableOwner: { ...candidate.accountableOwner },
    routing: {
      currentRoute: { ...candidate.routing.currentRoute },
      proposedRoute: { ...candidate.routing.proposedRoute },
      workloadId: candidate.routing.workloadId,
      rationale: candidate.routing.rationale,
      evidence: candidate.routing.evidence.map((item) => ({ ...item })),
    },
    baseline: {
      monthlyCostMinor: candidate.baseline.monthlyCostMinor,
      monthlyCostUsd: usd(candidate.baseline.monthlyCostMinor),
      workloadId: candidate.baseline.workloadId,
      period: candidate.baseline.period,
      currency: "USD",
      unit: "usd_minor",
    },
    projected: {
      monthlyCostMinor: candidate.projected.monthlyCostMinor,
      monthlyCostUsd: usd(candidate.projected.monthlyCostMinor),
      workloadId: candidate.projected.workloadId,
      period: candidate.projected.period,
      currency: "USD",
      unit: "usd_minor",
    },
    projectedMonthlySavings: {
      amountMinor: savingsMinor,
      amountUsd: usd(savingsMinor),
      currency: "USD",
      unit: "usd_minor",
      formula: `max(0, ${candidate.baseline.monthlyCostMinor} - `
        + `${candidate.projected.monthlyCostMinor}) = ${savingsMinor} minor units, for `
        + `${scope.workloadId} in ${scope.period}`,
    },
    confidence: {
      percent: confidence.percent,
      value: confidence.percent / 100,
      scale: CONFIDENCE_SCALE.reportedAs,
      band: confidenceBand(confidence.percent),
      basis: confidence.basis,
    },
    provenance: buildProvenance(source, candidate),
  };
}

/**
 * Why this contract stops here, stated in the payload rather than in a ticket.
 * The next step — a leader accepting the commitment, it entering the portfolio,
 * and a measured month reconciling against it — reads these fields, and cannot
 * be built before this contract exists.
 */
const DOWNSTREAM = Object.freeze({
  dependsOnContract: SAVINGS_COMMITMENT_VERSION,
  documentation: "docs/savings-commitment-contract.md",
  implemented: false,
  note: "Accepting a commitment, tracking its lifecycle, and reconciling it against a measured "
    + "month are downstream of this contract and are not implemented here. Any such "
    + "implementation must consume `commitment` as validated by "
    + "`validateSavingsCommitment`, must carry `commitment.provenance` unchanged so a "
    + "later measurement can be traced to the exact imported records, and must not "
    + "recompute the baseline: the baseline is whatever the imported analysis said it was.",
  requiredFieldsForDownstream: Object.freeze([
    "commitment.commitmentId",
    "commitment.department.departmentId",
    "commitment.accountableOwner.role",
    "commitment.routing",
    "commitment.baseline.monthlyCostMinor",
    "commitment.projectedMonthlySavings.amountMinor",
    "commitment.confidence.percent",
    "commitment.provenance",
  ]),
});

/**
 * Build the one commitment this imported analysis supports.
 *
 * @param {object} analysis an imported-analysis envelope, `savings-commitment-input/1.0.0`.
 * @returns a deeply frozen preview matching SAVINGS_COMMITMENT_VERSION.
 */
export function buildSavingsCommitment(analysis, selection = {}) {
  validateImportedAnalysis(analysis);
  const { source } = analysis;

  const scored = analysis.candidates.map((candidate) => ({
    candidate,
    savingsMinor: projectedMonthlySavingsMinor(
      candidate.baseline.monthlyCostMinor, candidate.projected.monthlyCostMinor,
    ),
  }));

  // Strictly positive, because a projection that meets its own baseline saves
  // nothing and "commit to saving $0.00" is not a sentence to show a leader.
  const eligible = scored.filter((entry) => entry.savingsMinor > 0)
    .sort((left, right) => right.savingsMinor - left.savingsMinor
      || right.candidate.confidence.percent - left.candidate.confidence.percent
      || compareCanonicalIds(left.candidate.candidateId, right.candidate.candidateId));

  const requestedId = selection?.opportunityId ?? null;
  if (requestedId !== null) canonicalId(requestedId, "selection.opportunityId");
  if (selection?.action !== undefined && selection.action !== "routing") {
    invalid("selection.action", "must be routing for a routing commitment fixture");
  }
  const winner = requestedId === null
    ? (eligible[0] ?? null)
    : (eligible.find((entry) => entry.candidate.candidateId === requestedId) ?? null);
  if (requestedId !== null && !winner) {
    invalid("selection.opportunityId",
      "must name an eligible opportunity in this destination analysis fixture");
  }
  const excluded = scored
    .filter((entry) => entry !== winner)
    .map((entry) => ({
      candidateId: entry.candidate.candidateId,
      reason: entry.savingsMinor > 0
        ? `A larger monthly saving is proposed first: this candidate projects $${money(entry.savingsMinor)} a month.`
        : "The imported analysis projects no monthly cost reduction for this workload, so there "
          + "is nothing here to commit to.",
    }))
    .sort((left, right) => compareCanonicalIds(left.candidateId, right.candidateId));

  const preview = {
    schemaVersion: SAVINGS_COMMITMENT_VERSION,
    question: SAVINGS_COMMITMENT_QUESTION,
    status: winner ? "ok" : "no_commitment",
    designation: source.designation,
    source: {
      sourceId: source.sourceId,
      importedAt: source.importedAt,
      analysisPeriod: source.analysisPeriod,
    },
    commitment: winner ? buildCommitment(source, winner.candidate, winner.savingsMinor) : null,
    reason: winner ? null
      : "No candidate in this imported analysis projects a monthly cost below its own baseline "
        + "for the same workload and month, so there is nothing to commit to yet.",
    consideredCount: scored.length,
    eligibleCount: eligible.length,
    excluded,
    downstream: DOWNSTREAM,
  };
  return validateSavingsCommitment(deepFreeze(preview));
}

/* ------------------------------ output validation -------------------------- */

const PREVIEW_KEYS = Object.freeze([
  "schemaVersion", "question", "status", "designation", "source", "commitment", "reason",
  "consideredCount", "eligibleCount", "excluded", "downstream",
]);

const COMMITMENT_KEYS = Object.freeze([
  "commitmentId", "rank", "headline", "workloadScope", "department", "accountableOwner",
  "routing", "baseline", "projected", "projectedMonthlySavings", "confidence", "provenance",
]);

/**
 * The gate a consumer can trust. A payload that passes has exactly the declared
 * fields, one commitment or an explicit reason for none, arithmetic that
 * reproduces from its own inputs, and no credential or prompt content at any
 * depth.
 */
export function validateSavingsCommitment(preview, path = "preview") {
  plainObject(preview, path);
  if (preview.schemaVersion !== SAVINGS_COMMITMENT_VERSION) {
    invalid(`${path}.schemaVersion`, `must be ${SAVINGS_COMMITMENT_VERSION}`);
  }
  assertNoForbiddenContent(preview, path);

  const unknown = Object.keys(preview).find((key) => !PREVIEW_KEYS.includes(key));
  if (unknown) invalid(path, `carries undeclared field “${unknown}”`);
  const missing = PREVIEW_KEYS.find((key) => !(key in preview));
  if (missing) invalid(path, `is missing required field “${missing}”`);

  if (preview.question !== SAVINGS_COMMITMENT_QUESTION) {
    invalid(`${path}.question`, `must be “${SAVINGS_COMMITMENT_QUESTION}”`);
  }
  if (!SAVINGS_COMMITMENT_STATUSES.includes(preview.status)) {
    invalid(`${path}.status`, "is not a declared status");
  }
  if (!SAVINGS_COMMITMENT_DESIGNATIONS.includes(preview.designation)) {
    invalid(`${path}.designation`, "is not a declared designation");
  }
  if (!Array.isArray(preview.excluded)) invalid(`${path}.excluded`, "must be an array");
  if (preview.downstream?.dependsOnContract !== SAVINGS_COMMITMENT_VERSION) {
    invalid(`${path}.downstream.dependsOnContract`,
      "must name this contract: the downstream action implementation depends on it");
  }

  if (preview.status === "no_commitment") {
    if (preview.commitment !== null) {
      invalid(`${path}.commitment`, "must be null when no commitment is proposed");
    }
    text(preview.reason, `${path}.reason`, { max: 600 });
    return preview;
  }

  if (preview.reason !== null) {
    invalid(`${path}.reason`, "must be null when a commitment is proposed; a commitment and an "
      + "excuse for having none are never both shown");
  }

  const commitment = plainObject(preview.commitment, `${path}.commitment`);
  const strayKey = Object.keys(commitment).find((key) => !COMMITMENT_KEYS.includes(key));
  if (strayKey) invalid(`${path}.commitment.${strayKey}`, "is not a declared commitment field");
  const absent = COMMITMENT_KEYS.find((key) => !(key in commitment));
  if (absent) invalid(`${path}.commitment`, `is missing required field “${absent}”`);
  if (commitment.rank !== 1) {
    invalid(`${path}.commitment.rank`, "must be 1: exactly one commitment is proposed");
  }

  const commitmentPath = `${path}.commitment`;
  canonicalId(commitment.commitmentId, `${commitmentPath}.commitmentId`);
  text(commitment.headline, `${commitmentPath}.headline`);
  canonicalId(commitment.department.departmentId, `${commitmentPath}.department.departmentId`);
  text(commitment.accountableOwner.role, `${commitmentPath}.accountableOwner.role`, { max: 120 });
  const provenanceRecordIds = new Set(commitment.provenance?.recordIds ?? []);
  validateRouting(commitment.routing, commitment.workloadScope.workloadId, provenanceRecordIds,
    `${commitmentPath}.routing`);
  validateCost(commitment.baseline, commitment.workloadScope, `${commitmentPath}.baseline`);
  validateCost(commitment.projected, commitment.workloadScope, `${commitmentPath}.projected`);

  const savings = commitment.projectedMonthlySavings;
  const expected = projectedMonthlySavingsMinor(
    commitment.baseline.monthlyCostMinor, commitment.projected.monthlyCostMinor,
  );
  if (savings.amountMinor !== expected) {
    invalid(`${commitmentPath}.projectedMonthlySavings.amountMinor`,
      "does not equal max(0, baseline - projected) for its own stated costs");
  }
  if (savings.amountMinor <= 0) {
    invalid(`${commitmentPath}.projectedMonthlySavings.amountMinor`,
      "must be positive; a commitment that saves nothing is reported as no_commitment");
  }
  if (savings.amountUsd !== usd(savings.amountMinor)) {
    invalid(`${commitmentPath}.projectedMonthlySavings.amountUsd`, "does not match amountMinor");
  }
  text(savings.formula, `${commitmentPath}.projectedMonthlySavings.formula`);

  const { confidence } = commitment;
  if (!Number.isInteger(confidence.percent)
    || confidence.percent < CONFIDENCE_SCALE.min || confidence.percent > CONFIDENCE_SCALE.max) {
    invalid(`${commitmentPath}.confidence.percent`,
      `must be an integer from ${CONFIDENCE_SCALE.min} through ${CONFIDENCE_SCALE.max} inclusive`);
  }
  if (confidence.scale !== CONFIDENCE_SCALE.reportedAs) {
    invalid(`${commitmentPath}.confidence.scale`, `must be ${CONFIDENCE_SCALE.reportedAs}`);
  }
  if (confidence.value !== confidence.percent / 100) {
    invalid(`${commitmentPath}.confidence.value`, "does not match its own percent");
  }
  if (confidence.band !== confidenceBand(confidence.percent)) {
    invalid(`${commitmentPath}.confidence.band`, "is not derived from its own percent");
  }
  text(confidence.basis, `${commitmentPath}.confidence.basis`);

  const { provenance } = commitment;
  canonicalId(provenance.sourceId, `${commitmentPath}.provenance.sourceId`);
  if (!INSTANT.test(String(provenance.importedAt))) {
    invalid(`${commitmentPath}.provenance.importedAt`, "must be an ISO-8601 UTC instant");
  }
  if (!SAVINGS_COMMITMENT_DESIGNATIONS.includes(provenance.designation)) {
    invalid(`${commitmentPath}.provenance.designation`, "is not a declared designation");
  }
  nonEmptyArray(provenance.recordIds, `${commitmentPath}.provenance.recordIds`);
  if (provenance.recordCount !== provenance.recordIds.length) {
    invalid(`${commitmentPath}.provenance.recordCount`, "does not match recordIds");
  }
  return preview;
}

/* ------------------------------ browser boundary --------------------------- */

/** The bundled fixture path. Same-origin, no credential, no cache, no storage. */
export const SAVINGS_COMMITMENT_FIXTURE_URL = "/savings-commitment-fixture.json";

/**
 * Read the bundled synthetic analysis and build its preview. This is the only
 * I/O in the module, it is same-origin, and nothing it returns is persisted.
 */
export async function loadSavingsCommitment(fetcher = fetch, selection = {}) {
  const response = await fetcher(SAVINGS_COMMITMENT_FIXTURE_URL, {
    cache: "no-store",
    credentials: "omit",
  });
  if (!response?.ok) {
    throw new Error("The bundled savings-commitment analysis could not be loaded.");
  }
  return buildSavingsCommitment(await response.json(), selection);
}
