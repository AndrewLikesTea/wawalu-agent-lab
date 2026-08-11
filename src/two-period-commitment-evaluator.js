// Explainable adapter over the merged committed-saving verdict contract.
// It accepts only the closed, redacted fixture shape declared next door. The
// underlying scorer remains the single owner of verdict boundaries and their
// assumptions; this adapter names those semantics for a Trends reader.

import {
  COMMITTED_SAVING_VERDICT_VERSION,
  MET_BAND_PERCENT,
  MISSED_FLOOR_PERCENT,
  VERDICT_BANDS,
  VERDICT_GRADE,
  scoreCommittedSaving,
} from "./committed-saving-verdict.js";

export const TWO_PERIOD_EVALUATOR_VERSION = "two-period-commitment-evaluator/1.0.0";
export const TWO_PERIOD_FIXTURE_VERSION = "redacted-two-period-commitment/1.0.0";

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INPUT_KEYS = Object.freeze([
  "schemaVersion", "id", "redacted", "scope", "commitment", "periods", "followUpPeriod", "expected",
]);
const COMMITMENT_KEYS = Object.freeze(["id", "period", "savingMinor", "scope"]);
const PERIOD_KEYS = Object.freeze(["period", "spendMinor"]);

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

/** Reject open or unredacted shapes before any scoring arithmetic is reached. */
export function redactedFixtureErrors(input) {
  const errors = [];
  if (!exactKeys(input, INPUT_KEYS)) return ["input must use the closed fixture shape"];
  if (input.schemaVersion !== TWO_PERIOD_FIXTURE_VERSION) errors.push("unsupported fixture schema");
  if (input.redacted !== true) errors.push("redacted must be true");
  if (!ID.test(input.id ?? "") || !ID.test(input.scope ?? "")) errors.push("id and scope must be canonical");
  if (!exactKeys(input.commitment, COMMITMENT_KEYS)) errors.push("commitment must use the closed shape");
  else {
    if (!ID.test(input.commitment.id ?? "")) errors.push("commitment id must be canonical");
    if (!PERIOD.test(input.commitment.period ?? "")) errors.push("commitment period must be YYYY-MM");
    if (!Number.isSafeInteger(input.commitment.savingMinor) || input.commitment.savingMinor <= 0)
      errors.push("committed saving must be a positive integer in USD minor units");
    if (input.commitment.scope !== input.scope) errors.push("commitment scope must match series scope");
  }
  if (!PERIOD.test(input.followUpPeriod ?? "")) errors.push("follow-up period must be YYYY-MM");
  if (!Array.isArray(input.periods) || input.periods.length > 2) errors.push("periods must contain at most two entries");
  else input.periods.forEach((entry) => {
    if (!exactKeys(entry, PERIOD_KEYS) || !PERIOD.test(entry.period ?? "")
      || !Number.isSafeInteger(entry.spendMinor) || entry.spendMinor < 0)
      errors.push("each period must contain only YYYY-MM period and non-negative integer spendMinor");
  });
  return errors;
}

const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};

/**
 * Evaluate a synthetic two-period commitment without a judge, clock, storage,
 * network, or free text. Throws on anything outside the redacted fixture shape.
 */
export function evaluateTwoPeriodCommitment(input) {
  const errors = redactedFixtureErrors(input);
  if (errors.length) throw new TypeError(`Unsafe two-period fixture: ${errors.join("; ")}`);
  const scored = scoreCommittedSaving({
    series: input.periods.map(({ period, spendMinor }) => ({ period, total: spendMinor / 100 })),
    commitment: {
      commitmentId: input.commitment.id,
      periodId: `${input.commitment.scope}:${input.commitment.period}`,
      claim: { period: input.commitment.period, monthlySavingsMinor: input.commitment.savingMinor },
    },
    followUpPeriod: input.followUpPeriod,
    seriesScope: input.scope,
  });
  const sufficient = scored.grade !== VERDICT_GRADE.notEnoughEvidence;
  return freeze({
    schemaVersion: TWO_PERIOD_EVALUATOR_VERSION,
    contractVersion: COMMITTED_SAVING_VERDICT_VERSION,
    fixtureId: input.id,
    verdict: { code: scored.grade, explanation: scored.explanation },
    movement: sufficient ? {
      fromPeriod: scored.provenance.comparedPeriods.committedFrom,
      toPeriod: scored.provenance.comparedPeriods.followUp,
      savingMinor: scored.realizedSavingMinor,
      deltaFromBenchmarkMinor: scored.deltaMinor,
      percentOfBenchmark: scored.realizedPercentOfCommitted,
    } : null,
    confidence: {
      level: sufficient ? "high" : "withheld",
      rationale: sufficient
        ? "High means both required adjacent, same-scope period totals were supplied; it is an evidence grade, not a probability."
        : "Confidence is withheld because the evidence threshold failed; no numeric movement or score is emitted.",
    },
    benchmark: {
      committedSavingMinor: scored.committedSavingMinor,
      metAtPercent: MET_BAND_PERCENT,
      missedAtOrBelowPercent: MISSED_FLOOR_PERCENT,
      rationale: "The benchmark is the commitment's recorded monthly saving, never a later recomputation.",
    },
    evidenceThreshold: {
      satisfied: sufficient,
      requiredPeriodCount: 2,
      observedPeriodCount: scored.provenance.periodCount,
      rule: "Exactly the committed month and its adjacent follow-up month must exist under the same declared scope.",
      rationale: sufficient
        ? "Both sides of the movement are present and comparable."
        : `No verdict: ${scored.reasons.join(", ")}. Missing or mismatched evidence is not scored as zero.`,
    },
    // These are policy weights, not learned coefficients. Their assumptions are
    // copied from the contract objects that the scorer itself applies.
    scoringWeights: VERDICT_BANDS.map(({ grade, fromPercent, toPercent, assumption }) =>
      ({ grade, fromPercent, toPercent, assumption })),
  });
}

