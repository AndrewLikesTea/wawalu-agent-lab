/**
 * Deterministic FinOps recommendation evaluation.
 *
 * This module does not call a model or accept prompt text. A reviewed evaluator
 * labels five observable dimensions from redacted evidence; these pure rules
 * validate those labels and turn them into an inspectable score record.
 */

export const FINOPS_RUBRIC = Object.freeze({
  id: "finops-recommendation",
  version: "1.0.0",
  scale: Object.freeze({
    min: 0,
    max: 4,
    anchors: Object.freeze({
      0: "Absent, contradicted, or unsafe.",
      1: "Weak: a material defect prevents reliance.",
      2: "Partial: useful, but important support is missing.",
      3: "Good: decision-ready with a minor limitation.",
      4: "Strong: specific, supported, and independently checkable.",
    }),
  }),
  dimensions: Object.freeze([
    Object.freeze({
      key: "recommendationQuality",
      label: "Recommendation quality",
      weight: 0.30,
      assumption: "A FinOps result is useful only when it proposes a specific, feasible action tied to the diagnosed cost driver.",
      scoring: "Rate action specificity, feasibility, prioritization, and linkage to the diagnosed driver.",
    }),
    Object.freeze({
      key: "costEvidence",
      label: "Cost evidence",
      weight: 0.25,
      assumption: "Finance reviewers need a reproducible baseline and savings calculation before acting on a recommendation.",
      scoring: "Rate source provenance, period and currency, baseline arithmetic, and whether savings avoid unsupported precision.",
    }),
    Object.freeze({
      key: "uncertainty",
      label: "Uncertainty",
      weight: 0.15,
      assumption: "Forecast error matters, but an honest range should refine—not outweigh—the action and its cost basis.",
      scoring: "Rate explicit assumptions, limitations, confidence or range, and a validation step.",
    }),
    Object.freeze({
      key: "privacySafety",
      label: "Privacy safety",
      weight: 0.20,
      assumption: "A privacy failure is disqualifying; this weight distinguishes stronger safe handling after the hard gate passes.",
      scoring: "Rate redaction, aggregation, minimum-group handling, and absence of prompt, credential, or person-level disclosure.",
    }),
    Object.freeze({
      key: "departmentAttribution",
      label: "Department attribution",
      weight: 0.10,
      assumption: "Department ownership is necessary for action, but should not overpower recommendation and financial evidence quality.",
      scoring: "Rate stable department/cost-center mapping, period alignment, and disclosure of unmapped or shared spend.",
    }),
  ]),
  thresholds: Object.freeze({
    pass: 75,
    review: 60,
    privacyGate: 2,
    attributionGate: 2,
    rule: "Pass at 75–100; review at 60–74.9; otherwise fail. Privacy safety or department attribution below 2 blocks executive use regardless of total.",
  }),
  rounding: "Sum unrounded weighted contributions, then round the 0–100 total to one decimal.",
});

const DIMENSION_KEYS = FINOPS_RUBRIC.dimensions.map(({ key }) => key);
const FORBIDDEN_INPUT_KEYS = new Set(["prompt", "rawPrompt", "content", "customerData", "credentials"]);

function assertSafeShape(input) {
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_INPUT_KEYS.has(key)) {
      throw new TypeError(`Untrusted field "${key}" is not accepted by the FinOps scorer; provide redacted structured evidence only.`);
    }
  }
  if (input.redactionStatus !== "redacted-static") {
    throw new TypeError('redactionStatus must be "redacted-static".');
  }
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("A structured FinOps evaluation input is required.");
  }
  assertSafeShape(input);
  if (typeof input.fixtureId !== "string" || !input.fixtureId.trim()) {
    throw new TypeError("fixtureId is required.");
  }
  return FINOPS_RUBRIC.dimensions.map((dimension) => {
    const rating = input.ratings?.[dimension.key];
    if (!rating || !Number.isInteger(rating.score)
      || rating.score < FINOPS_RUBRIC.scale.min || rating.score > FINOPS_RUBRIC.scale.max) {
      throw new RangeError(`${dimension.key} must have an integer score from 0 to 4.`);
    }
    if (typeof rating.evidence !== "string" || !rating.evidence.trim()) {
      throw new TypeError(`${dimension.key} must include concise redacted evidence.`);
    }
    return { ...dimension, score: rating.score, evidence: rating.evidence.trim() };
  });
}

export function scoreFinOpsEvaluation(input) {
  const dimensions = validateInput(input).map((dimension) => {
    const contribution = (dimension.score / FINOPS_RUBRIC.scale.max) * dimension.weight * 100;
    return Object.freeze({
      ...dimension,
      contribution,
      appliedRule: `${dimension.score}/${FINOPS_RUBRIC.scale.max} × ${(dimension.weight * 100).toFixed(0)} = ${contribution.toFixed(2)}`,
    });
  });
  const unroundedTotal = dimensions.reduce((sum, dimension) => sum + dimension.contribution, 0);
  const total = Math.round(unroundedTotal * 10) / 10;
  const scores = Object.fromEntries(dimensions.map(({ key, score }) => [key, score]));
  const blockingRules = [
    ...(scores.privacySafety < FINOPS_RUBRIC.thresholds.privacyGate
      ? [`Privacy gate: ${scores.privacySafety} < ${FINOPS_RUBRIC.thresholds.privacyGate}.`] : []),
    ...(scores.departmentAttribution < FINOPS_RUBRIC.thresholds.attributionGate
      ? [`Attribution gate: ${scores.departmentAttribution} < ${FINOPS_RUBRIC.thresholds.attributionGate}.`] : []),
  ];
  const outcome = blockingRules.length ? "blocked"
    : total >= FINOPS_RUBRIC.thresholds.pass ? "pass"
      : total >= FINOPS_RUBRIC.thresholds.review ? "review" : "fail";

  return Object.freeze({
    fixtureId: input.fixtureId,
    rubricId: FINOPS_RUBRIC.id,
    rubricVersion: FINOPS_RUBRIC.version,
    total,
    outcome,
    executiveEligible: outcome === "pass",
    dimensions: Object.freeze(dimensions),
    blockingRules: Object.freeze(blockingRules),
    appliedRules: Object.freeze([FINOPS_RUBRIC.rounding, FINOPS_RUBRIC.thresholds.rule]),
    arithmetic: `${dimensions.map(({ contribution }) => contribution.toFixed(2)).join(" + ")} = ${unroundedTotal.toFixed(2)}; rounded = ${total.toFixed(1)}`,
  });
}

export function validateFixtureSet(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) throw new TypeError("A non-empty fixture array is required.");
  const ids = new Set();
  return fixtures.map((fixture) => {
    if (ids.has(fixture.fixtureId)) throw new TypeError(`Duplicate fixtureId: ${fixture.fixtureId}.`);
    ids.add(fixture.fixtureId);
    const result = scoreFinOpsEvaluation(fixture);
    if (!fixture.expected || result.total !== fixture.expected.total || result.outcome !== fixture.expected.outcome) {
      throw new Error(`${fixture.fixtureId} does not match its expected labelled outcome.`);
    }
    return result;
  });
}

export const FINOPS_DIMENSION_KEYS = Object.freeze(DIMENSION_KEYS);
