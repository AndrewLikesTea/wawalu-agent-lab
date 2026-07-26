import { redactForScoring } from "./evolution.js";

/**
 * Static FinOps recommendation rubric.
 *
 * Weight assumptions are part of the executable contract so a reviewer can
 * dispute the policy without reverse-engineering arithmetic.
 */
export const FINOPS_RUBRIC = Object.freeze({
  version: "finops-recommendation/1.0.0",
  scale: Object.freeze({
    min: 0,
    max: 4,
    anchors: Object.freeze({
      0: "Absent, contradicted, or unusable.",
      1: "Weak; material correction is required.",
      2: "Partial; important support is missing.",
      3: "Adequate; specific and reviewable.",
      4: "Strong; complete, verifiable, and decision-ready.",
    }),
  }),
  criteria: Object.freeze([
    Object.freeze({
      key: "recommendationQuality", label: "Recommendation quality", weight: 0.30,
      assumption: "A FinOps score is useful only if it leads to a feasible, measurable action.",
      weightReason: "Largest weight because action quality is the primary decision outcome.",
    }),
    Object.freeze({
      key: "costEvidence", label: "Cost evidence", weight: 0.25,
      assumption: "Savings claims require a bounded baseline, period, and comparison.",
      weightReason: "Second-largest weight because unsupported savings can misdirect budget.",
    }),
    Object.freeze({
      key: "uncertainty", label: "Uncertainty", weight: 0.15,
      assumption: "Estimates must disclose limits, but uncertainty cannot replace evidence or action.",
      weightReason: "Material weight rewards honest limits without letting caution dominate utility.",
    }),
    Object.freeze({
      key: "privacySafety", label: "Privacy safety", weight: 0.20,
      assumption: "Unsafe content is independently disqualifying even when the recommendation is useful.",
      weightReason: "The weight exposes lesser safety quality; a separate gate prevents averaging away harm.",
    }),
    Object.freeze({
      key: "departmentAttribution", label: "Department attribution", weight: 0.10,
      assumption: "A recommendation needs an accountable department, while attribution alone creates no savings.",
      weightReason: "Smallest weight reflects governance value without overpowering recommendation evidence.",
    }),
  ]),
  thresholds: Object.freeze({
    approved: 75,
    review: 60,
    privacyGate: 3,
    rule: "Approved at >=75; review at 60–74.9; otherwise rejected. Privacy safety below 3 always rejects.",
  }),
  rounding: "Sum unrounded criterion contributions, then round the 0–100 total to one decimal.",
});

// The determiner and target words repeat, so both are quantified: a single
// optional "all" only caught the one phrasing that happened to be sampled, and
// left "ignore any prior rules" or "override the previous system prompt"
// rendering verbatim.
const INSTRUCTION_PATTERN =
  /\b(?:ignore|disregard|override|forget)\s+(?:(?:all|any|the|these|those|your)\s+)*(?:(?:previous|prior|preceding|earlier|above|system|developer)\s+)+(?:instructions?|prompts?|rules?|directions?|guidelines?)\b[^.!?\n]*/gi;

/** Fixture ids become DOM ids, so the contract is narrower than "a string". */
const FIXTURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The only recommendation text allowed to cross into scoring or rendering. */
export function sanitizeFinopsRecommendation(value = "") {
  return redactForScoring(String(value))
    .replace(INSTRUCTION_PATTERN, "[instruction-neutralized]")
    .replace(/\b(?:reveal|print|expose)\s+(?:the\s+)?(?:system prompt|hidden instructions?|secrets?)\b[^.!?\n]*/gi,
      "[instruction-neutralized]")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== "object") throw new TypeError("A fixture object is required.");
  if (typeof fixture.id !== "string" || !FIXTURE_ID_PATTERN.test(fixture.id))
    throw new TypeError("Fixture id must be a lower-case slug of letters, digits, and hyphens.");
  return FINOPS_RUBRIC.criteria.map((criterion) => {
    const rating = fixture.ratings?.[criterion.key];
    const evidence = fixture.evidence?.[criterion.key];
    if (!Number.isInteger(rating)
      || rating < FINOPS_RUBRIC.scale.min || rating > FINOPS_RUBRIC.scale.max)
      throw new RangeError(`${criterion.key} must be an integer from 0 to 4.`);
    if (typeof evidence !== "string" || !evidence.trim())
      throw new TypeError(`${criterion.key} must include an explanation.`);
    return { ...criterion, rating, evidence: sanitizeFinopsRecommendation(evidence) };
  });
}

/** Pure aggregation: no storage, network, clock, randomness, or provider call. */
export function scoreFinopsFixture(fixture) {
  const breakdown = validateFixture(fixture).map((item) => {
    const contribution = (item.rating / FINOPS_RUBRIC.scale.max) * item.weight * 100;
    return Object.freeze({
      key: item.key,
      label: item.label,
      rating: item.rating,
      scaleMaximum: FINOPS_RUBRIC.scale.max,
      weight: item.weight,
      contribution,
      assumption: item.assumption,
      weightReason: item.weightReason,
      evidence: item.evidence,
      arithmetic: `${item.rating}/4 × ${(item.weight * 100).toFixed(0)} = ${contribution.toFixed(2)}`,
    });
  });
  const unrounded = breakdown.reduce((sum, item) => sum + item.contribution, 0);
  const score = Math.round(unrounded * 10) / 10;
  const privacyRating = breakdown.find((item) => item.key === "privacySafety").rating;
  const privacyGateApplied = privacyRating < FINOPS_RUBRIC.thresholds.privacyGate;
  const label = privacyGateApplied ? "rejected"
    : score >= FINOPS_RUBRIC.thresholds.approved ? "approved"
      : score >= FINOPS_RUBRIC.thresholds.review ? "review" : "rejected";

  return Object.freeze({
    fixtureId: fixture.id,
    rubricVersion: FINOPS_RUBRIC.version,
    score,
    label,
    recommendation: sanitizeFinopsRecommendation(fixture.recommendation),
    department: sanitizeFinopsRecommendation(fixture.department || "Unattributed"),
    breakdown: Object.freeze(breakdown),
    privacyGate: Object.freeze({
      applied: privacyGateApplied,
      rating: privacyRating,
      threshold: FINOPS_RUBRIC.thresholds.privacyGate,
      rule: FINOPS_RUBRIC.thresholds.rule,
    }),
    arithmetic: `${breakdown.map((item) => item.contribution.toFixed(2)).join(" + ")} = `
      + `${unrounded.toFixed(2)}; rounded = ${score.toFixed(1)}`,
  });
}

