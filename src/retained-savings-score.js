// Deterministic scoring for two privacy-safe retained monthly aggregates.
// No prose enters this module: callers project onto the numeric retained-period
// allowlist first, so prompts cannot be stored, logged, or sent to a judge.

export const RETAINED_SAVINGS_SCORE_VERSION = "retained-savings-score/1.0.0";

/**
 * Executable weight ledger. Each weight states the assumption it represents;
 * the score is evidence strength, not a probability or causal attribution.
 */
export const RETAINED_SAVINGS_POLICY = Object.freeze({
  version: RETAINED_SAVINGS_SCORE_VERSION,
  confidenceWeights: Object.freeze([
    Object.freeze({ id: "coverage", points: 50, assumption: "Row coverage is the largest source of measurement error, so it carries half the score." }),
    Object.freeze({ id: "completeness", points: 30, assumption: "Both months need analyzed spend and opportunity values; completeness carries thirty points." }),
    Object.freeze({ id: "comparability", points: 20, assumption: "Matching dataset and metric establish a like-for-like comparison, but cannot outweigh missing rows." }),
  ]),
  confidenceBands: Object.freeze({ high: 85, medium: 65 }),
  assumptions: Object.freeze({
    projected: "Prior-month recoverable scenario is the projection available before the follow-up month.",
    realized: "Realized savings is prior analyzed spend minus current analyzed spend, floored at zero; it is observed movement, not causal credit.",
    emerging: "An opportunity is newly emerging when the prior projection was zero and the current recoverable scenario is positive.",
    priority: "Missing evidence outranks a miss, which outranks a new opportunity, which outranks closing a success; exactly one first action is emitted.",
  }),
});

const action = (id, statement, reason) => Object.freeze({ rank: 1, id, statement, reason });
const safeMinor = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

function confidence(prior, current) {
  const coverage = [prior.coverageRatioPpm, current.coverageRatioPpm]
    .every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000)
    ? Math.min(prior.coverageRatioPpm, current.coverageRatioPpm) : 0;
  const coveragePoints = Math.round(50 * coverage / 1_000_000);
  const completenessPoints = [prior, current].every((period) =>
    safeMinor(period.analyzedSpendMinor) !== null && safeMinor(period.recoverableScenarioMinor) !== null) ? 30 : 0;
  const comparable = prior.dataset === current.dataset
    && prior.materialMetricId === current.materialMetricId;
  const comparabilityPoints = comparable ? 20 : 0;
  const score = coveragePoints + completenessPoints + comparabilityPoints;
  const band = score >= 85 ? "high" : score >= 65 ? "medium" : "low";
  return Object.freeze({
    score, band,
    components: Object.freeze({ coverage: coveragePoints, completeness: completenessPoints, comparability: comparabilityPoints }),
    formula: `${coveragePoints} coverage + ${completenessPoints} completeness + ${comparabilityPoints} comparability = ${score}`,
  });
}

/** Score exactly the two latest periods supplied in chronological order. */
export function scoreRetainedSavingsComparison(periods = []) {
  if (!Array.isArray(periods) || periods.length < 2) {
    return Object.freeze({
      schemaVersion: RETAINED_SAVINGS_SCORE_VERSION, label: "incomplete_comparison_evidence",
      projectedSavingsMinor: null, realizedSavingsMinor: null, varianceMinor: null,
      attainmentPercent: null, confidence: Object.freeze({ score: 0, band: "insufficient", components: Object.freeze({ coverage: 0, completeness: 0, comparability: 0 }), formula: "No comparable pair = 0" }),
      nextAction: action("retain_comparable_period", "Retain the immediately preceding comparable month, then rebuild this review.", "comparison_evidence_missing"),
      assumptions: RETAINED_SAVINGS_POLICY.assumptions,
    });
  }
  const [prior, current] = [...periods]
    .sort((left, right) => String(left.period).localeCompare(String(right.period)))
    .slice(-2);
  const confidenceResult = confidence(prior, current);
  const projected = safeMinor(prior.recoverableScenarioMinor);
  const priorSpend = safeMinor(prior.analyzedSpendMinor);
  const currentSpend = safeMinor(current.analyzedSpendMinor);
  const comparable = confidenceResult.components.comparability === 20;
  if (projected === null || priorSpend === null || currentSpend === null || !comparable) {
    return scoreRetainedSavingsComparison([]);
  }
  const realized = Math.max(0, priorSpend - currentSpend);
  const variance = realized - projected;
  const emerging = projected === 0 && current.recoverableScenarioMinor > 0;
  const label = emerging ? "newly_emerging_opportunity"
    : realized >= projected ? "successful_commitment" : "missed_commitment";
  const nextAction = label === "missed_commitment"
    ? action("revise_commitment", "Revise the missed commitment before the next review.", "realized_below_projected")
    : label === "newly_emerging_opportunity"
      ? action("investigate_emerging_opportunity", "Investigate the newly emerging recoverable opportunity.", "new_recoverable_amount")
      : action("verify_and_close_commitment", "Verify scope, then close or extend the successful commitment.", "realized_met_projection");
  return Object.freeze({
    schemaVersion: RETAINED_SAVINGS_SCORE_VERSION, label,
    projectedSavingsMinor: projected, realizedSavingsMinor: realized,
    varianceMinor: variance,
    attainmentPercent: projected === 0 ? null : Math.round(realized * 10_000 / projected) / 100,
    confidence: confidenceResult, nextAction, assumptions: RETAINED_SAVINGS_POLICY.assumptions,
  });
}
