/**
 * Deterministic evaluation contract for FinOps recommendations.
 *
 * The scorer does not infer labels from prose. A reviewer supplies explicit
 * criterion levels and evidence; this module validates, weights, gates, and
 * explains them. Raw recommendation text is sanitized before it can enter the
 * returned score record or any judge/presentation path.
 */
import { prepareContentForJudge } from "./content-evaluation.js";

export const FINOPS_RUBRIC = Object.freeze({
  version: "finops-recommendation/1.0.0",
  scale: Object.freeze({
    min: 0,
    max: 4,
    anchors: Object.freeze({
      0: "Absent, contradicted, or unsafe.",
      1: "Weak; major evidence or correction is required.",
      2: "Partial; usable only with material caveats.",
      3: "Good; specific and reviewable with minor gaps.",
      4: "Strong; complete, traceable, and independently checkable.",
    }),
  }),
  criteria: Object.freeze([
    Object.freeze({
      key: "recommendationQuality", label: "Recommendation quality", weight: 0.30,
      assumption: "A FinOps score is useful only when it leads to a specific, feasible action.",
      weightRationale: "Largest weight because actionability is the primary outcome, but it cannot override privacy.",
    }),
    Object.freeze({
      key: "costEvidence", label: "Cost evidence", weight: 0.25,
      assumption: "Savings claims need a baseline, comparable period, and checkable arithmetic.",
      weightRationale: "Second-largest weight because unsupported savings are not safe to fund or report.",
    }),
    Object.freeze({
      key: "uncertainty", label: "Uncertainty", weight: 0.15,
      assumption: "Forecasts should state confidence, limitations, and what would change the estimate.",
      weightRationale: "Material but below action and evidence because uncertainty qualifies rather than creates the claim.",
    }),
    Object.freeze({
      key: "privacySafety", label: "Privacy safety", weight: 0.20,
      assumption: "Prompt content is untrusted and credentials, identity, or customer data must never reach a judge or executive.",
      weightRationale: "High visible weight plus a separate minimum gate; the gate makes severe privacy failure disqualifying.",
    }),
    Object.freeze({
      key: "departmentAttribution", label: "Department attribution", weight: 0.10,
      assumption: "A recommendation needs a traceable accountable department without identifying an individual.",
      weightRationale: "Smallest weight because attribution enables ownership but should not dominate recommendation merit.",
    }),
  ]),
  thresholds: Object.freeze({
    executiveReady: 70,
    privacyMinimum: 3,
    rule: "Executive-ready at >=70 only when privacy safety is >=3; otherwise withhold.",
  }),
  rounding: "Sum unrounded weighted contributions, then round once to one decimal.",
});

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

function requiredText(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${path} must be non-empty text.`);
  return value.trim();
}

/** Returns only sanitized recommendation content, safe handling metadata, and no raw input. */
export function prepareFinOpsRecommendation(input) {
  return deepFreeze(prepareContentForJudge(typeof input === "string" ? input : ""));
}

/**
 * A fixture publishes an `expected` block so a reviewer can reproduce its score
 * by hand. That contract is only worth publishing if it is enforced here: a
 * fixture whose computed score drifts from its published label must fail loudly
 * rather than render a number the fixture itself contradicts.
 */
function verifyPublishedExpectation(record, expected) {
  if (expected === undefined) return record;
  if (!expected || typeof expected !== "object")
    throw new TypeError(`${record.fixtureId}.expected must be an object when it is present.`);
  for (const [key, score] of Object.entries(expected.scores ?? {})) {
    const criterion = record.criteria.find((item) => item.key === key);
    if (!criterion)
      throw new RangeError(`${record.fixtureId}: expected names unknown criterion "${key}".`);
    if (criterion.score !== score)
      throw new RangeError(`${record.fixtureId}: computed ${key} ${criterion.score} does not match published expected ${score}.`);
  }
  if (expected.total !== undefined && expected.total !== record.total)
    throw new RangeError(`${record.fixtureId}: computed total ${record.total} does not match published expected total ${expected.total}.`);
  if (expected.status !== undefined && expected.status !== record.status)
    throw new RangeError(`${record.fixtureId}: computed status "${record.status}" does not match published expected status "${expected.status}".`);
  return record;
}

export function scoreFinOpsEvaluation(input) {
  if (!input || typeof input !== "object") throw new TypeError("Evaluation must be an object.");
  const evaluatedRecommendation = prepareFinOpsRecommendation(input.recommendation);
  const criteria = FINOPS_RUBRIC.criteria.map((criterion) => {
    const assessment = input.assessments?.[criterion.key];
    if (!assessment || !Number.isInteger(assessment.score)
      || assessment.score < FINOPS_RUBRIC.scale.min
      || assessment.score > FINOPS_RUBRIC.scale.max) {
      throw new RangeError(`${criterion.key} must have an integer score from 0 to 4.`);
    }
    const rationale = requiredText(assessment.rationale, `${criterion.key}.rationale`);
    const contribution = (assessment.score / FINOPS_RUBRIC.scale.max) * criterion.weight * 100;
    return {
      ...criterion,
      score: assessment.score,
      rationale,
      contribution,
      arithmetic: `${assessment.score}/4 × ${criterion.weight * 100} = ${contribution.toFixed(2)}`,
    };
  });
  const unroundedTotal = criteria.reduce((total, criterion) => total + criterion.contribution, 0);
  const total = Math.round(unroundedTotal * 10) / 10;
  const privacyScore = criteria.find(({ key }) => key === "privacySafety").score;
  const privacyGateApplied = privacyScore < FINOPS_RUBRIC.thresholds.privacyMinimum;
  const executiveReady = total >= FINOPS_RUBRIC.thresholds.executiveReady && !privacyGateApplied;

  const record = {
    fixtureId: requiredText(input.id, "id"),
    label: requiredText(input.label, "label"),
    rubricVersion: FINOPS_RUBRIC.version,
    total,
    status: executiveReady ? "executive-ready" : "withheld",
    executiveReady,
    privacyGateApplied,
    evaluatedRecommendation,
    criteria,
    explanation: {
      formula: criteria.map(({ contribution }) => contribution.toFixed(2)).join(" + "),
      arithmetic: `${unroundedTotal.toFixed(2)} → ${total.toFixed(1)}/100`,
      threshold: privacyGateApplied
        ? `Withheld: privacy safety ${privacyScore}/4 is below ${FINOPS_RUBRIC.thresholds.privacyMinimum}/4.`
        : `${total.toFixed(1)} ${total >= 70 ? "meets" : "does not meet"} the 70-point threshold.`,
      rounding: FINOPS_RUBRIC.rounding,
    },
  };
  return deepFreeze(verifyPublishedExpectation(record, input.expected));
}

export function scoreFinOpsFixtures(fixtureSet) {
  if (fixtureSet?.schemaVersion !== "finops-evaluation-fixtures/1.0.0")
    throw new TypeError("Unsupported FinOps fixture schema.");
  // An empty fixture list is a broken deliverable, not a legitimate state: the
  // rubric would ship with nothing a reviewer could reproduce. Fail closed so
  // the panel reports an outage instead of rendering a confident blank.
  if (!Array.isArray(fixtureSet.fixtures) || fixtureSet.fixtures.length === 0)
    throw new TypeError("fixtures must be a non-empty array.");
  const results = fixtureSet.fixtures.map((fixture) => scoreFinOpsEvaluation(fixture));
  const seen = new Set();
  for (const { fixtureId } of results) {
    // Reviewers cite a score by id; two fixtures sharing one makes a dispute unresolvable.
    if (seen.has(fixtureId)) throw new TypeError(`Fixture ids must be unique: "${fixtureId}" repeats.`);
    seen.add(fixtureId);
  }
  return deepFreeze(results);
}
