// Executive monthly review contract. Pure, clock-free, and integer-based until
// display rounding so the same versioned fixture always produces one answer.
export const MONTHLY_FINOPS_FIXTURE_VERSION = "monthly-finops-review-fixture/1.0.0";
export const MONTHLY_FINOPS_REVIEW_VERSION = "monthly-finops-review/1.0.0";

export const MONTHLY_FINOPS_METRIC_CONTRACTS = Object.freeze({
  spendChange: Object.freeze({
    question: "How did total invoiced spend change between the two named periods?",
    formula: "changeMinor = currentPeriod.spendMinor - priorPeriod.spendMinor; changePercent = changeMinor / priorPeriod.spendMinor * 100",
    population: "All invoiced spend represented by each fixture period, in the fixture currency.",
    rounding: "Round changePercent to one decimal, with exact half-ties away from zero; do not round changeMinor.",
    excluded: "Forecasts, annualization, currency conversion, and attribution of the change to an action.",
  }),
  priorCommitment: Object.freeze({
    question: "Did the recorded prior commitment hold?",
    formula: "verified iff both comparison period IDs occur in evidencePeriodIds and observedReductionTenthsPercent >= targetReductionTenthsPercent",
    population: "Only the commitment's recorded scope and its two named evidence periods.",
    excluded: "Causal attribution and any unrecorded or differently scoped commitment.",
  }),
  confidence: Object.freeze({
    question: "Is the conclusion supported by enough comparable records to act?",
    formula: "coveragePercent = recordsComparable / recordsExpected * 100; high iff rounded coveragePercent >= minimumCoverageTenthsPercent / 10",
    population: "Expected records in the two-period comparison; comparable means present in both periods under the fixture's methodVersion.",
    excluded: "Statistical significance, forecast confidence, and evidence outside the fixture.",
  }),
  provenance: Object.freeze({
    question: "What exactly produced this answer?",
    formula: "The immutable tuple sourceType + methodVersion + generatedAt + ordered periodIds.",
    excluded: "Credentials, raw customer rows, prompts, and live integrations.",
  }),
  nextAction: Object.freeze({
    question: "What is the one action leadership should take next?",
    formula: "Select the sole candidate whose integer priority equals 1; reject zero or multiple winners.",
    excluded: "Every candidate below priority 1 and any action not encoded in the fixture.",
  }),
});

const freeze = Object.freeze;

/** One decimal, with an exact half rounded away from zero in both directions. */
export function roundOne(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const magnitude = Math.abs(value) * 10;
  // Scaling a decimal such as 10.05 can land one ulp below 100.5. The tolerance
  // corrects representation error only; floor still decides every non-half.
  const tolerance = Number.EPSILON * Math.max(1, magnitude) * 2;
  return Math.sign(value) * (Math.floor(magnitude + 0.5 + tolerance) / 10);
}

const requiredInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return value;
};

const percentChange = (current, prior) => {
  if (prior === 0) return null;
  return roundOne(((current - prior) * 100) / prior);
};

/**
 * Questions, in order:
 * 1. How did total invoiced spend change between the two named periods?
 * 2. Did the recorded, scoped prior commitment meet its threshold?
 * 3. Is comparable-record coverage sufficient to act?
 * 4. What exactly produced the answer?
 * 5. What is the single highest-priority next action?
 *
 * Deliberately excluded: forecasts, annualization, causal attribution, customer
 * data, unrecorded commitments, and every action below priority one.
 */
export function buildMonthlyFinopsReview(fixture) {
  if (fixture?.schemaVersion !== MONTHLY_FINOPS_FIXTURE_VERSION) {
    throw new TypeError("unsupported monthly FinOps fixture version");
  }
  const prior = requiredInteger(fixture.priorPeriod?.spendMinor, "priorPeriod.spendMinor");
  const current = requiredInteger(fixture.currentPeriod?.spendMinor, "currentPeriod.spendMinor");
  const changeMinor = current - prior;
  const changePercent = percentChange(current, prior);
  const comparable = requiredInteger(fixture.confidence?.recordsComparable, "confidence.recordsComparable");
  const expected = requiredInteger(fixture.confidence?.recordsExpected, "confidence.recordsExpected");
  const coveragePercent = expected === 0 ? null : roundOne((comparable * 100) / expected);
  const threshold = requiredInteger(fixture.confidence?.minimumCoverageTenthsPercent,
    "confidence.minimumCoverageTenthsPercent") / 10;
  const confident = coveragePercent !== null && coveragePercent >= threshold;

  const commitment = fixture.commitment;
  const periodsMatch = [fixture.priorPeriod.id, fixture.currentPeriod.id]
    .every((id) => commitment?.evidencePeriodIds?.includes(id));
  const commitmentMet = periodsMatch
    && Number.isSafeInteger(commitment.targetReductionTenthsPercent)
    && Number.isSafeInteger(commitment.observedReductionTenthsPercent)
    && commitment.observedReductionTenthsPercent >= commitment.targetReductionTenthsPercent;

  const winners = (fixture.candidateActions ?? []).filter((candidate) => candidate.priority === 1);
  if (winners.length !== 1) throw new TypeError("exactly one priority-1 action is required");
  const action = winners[0];
  const direction = changeMinor < 0 ? "fell" : changeMinor > 0 ? "rose" : "held steady";
  const finding = changePercent === null
    ? `Spend ${direction}, but percentage change is unavailable because prior spend was zero.`
    : `Spend ${direction} ${Math.abs(changePercent).toFixed(1)}%; the prior commitment ${commitmentMet ? "met" : "did not meet"} its recorded target.`;

  return freeze({
    schemaVersion: MONTHLY_FINOPS_REVIEW_VERSION,
    reviewId: fixture.reviewId,
    finding: freeze({ statement: finding, changeMinor, changePercent, direction }),
    commitment: freeze({
      status: commitmentMet ? "verified" : "not_verified",
      statement: commitment.statement,
      targetPercent: commitment.targetReductionTenthsPercent / 10,
      observedPercent: commitment.observedReductionTenthsPercent / 10,
      basis: periodsMatch ? "Both named comparison periods match the commitment evidence."
        : "The commitment does not name both comparison periods.",
    }),
    confidence: freeze({
      level: confident ? "high" : "insufficient", coveragePercent, thresholdPercent: threshold,
      basis: `${comparable} of ${expected} expected records are comparable.`,
    }),
    provenance: freeze({
      sourceType: fixture.provenance.sourceType,
      methodVersion: fixture.provenance.methodVersion,
      generatedAt: fixture.provenance.generatedAt,
      periodIds: freeze([fixture.priorPeriod.id, fixture.currentPeriod.id]),
      boundary: "Bundled synthetic fixture; no customer data, credentials, storage, or live integration.",
    }),
    nextAction: freeze({ rank: 1, id: action.id, statement: action.statement, evidence: action.evidence }),
  });
}
