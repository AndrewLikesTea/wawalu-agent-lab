// Compact comparison of retained, browser-local monthly aggregates and the
// commitment retained against the baseline month. No storage, clock, row-level
// data, prompt, or network source is available to this module.

export const RETAINED_SAVINGS_SCORE_VERSION = "retained-savings-comparison/2.0.0";

export const RETAINED_SAVINGS_POLICY = Object.freeze({
  version: RETAINED_SAVINGS_SCORE_VERSION,
  actionPriority: Object.freeze([
    "retain_comparable_period", "repair_comparison_evidence", "record_commitment",
    "revise_commitment", "verify_and_close_commitment",
  ]),
  assumptions: Object.freeze({
    realized: "Realized savings is baseline analyzed spend minus current analyzed spend, floored at zero; it is observed movement, not causal credit.",
    projected: "Projected savings is read from the commitment retained against the baseline period; a recoverable scenario is not substituted.",
    priority: "Missing baseline outranks incomplete evidence, which outranks a missing commitment, which outranks a miss, which outranks closing a success.",
  }),
});

const freeze = Object.freeze;
const action = (id, statement, reason) => freeze({ rank: 1, id, statement, reason });
const safeMinor = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const unavailableMoney = (reason) => freeze({ status: "unavailable", minor: null, reason });
const availableMoney = (minor) => freeze({ status: "available", minor, reason: null });
const unavailablePeriod = (reason) => freeze({ status: "unavailable", label: null, periodId: null, reason });
const availablePeriod = (period) => freeze({
  status: "available", label: period.period, periodId: period.periodId, reason: null,
});

function unavailable(reason, periods, nextAction, priorActionReason = reason) {
  return freeze({
    schemaVersion: RETAINED_SAVINGS_SCORE_VERSION,
    status: "unavailable",
    reason,
    periods: freeze(periods),
    realizedSavings: unavailableMoney(reason),
    projectedSavings: unavailableMoney(reason),
    variance: unavailableMoney(reason),
    confidence: freeze({ status: "unavailable", score: null, band: "insufficient", reason }),
    provenance: freeze({ source: "browser_local_retained_records", periodIds: freeze(
      Object.values(periods).map(({ periodId }) => periodId).filter(Boolean),
    ), commitmentId: null, scoringPolicy: RETAINED_SAVINGS_SCORE_VERSION }),
    priorAction: freeze({ status: "unavailable", commitmentId: null, reason: priorActionReason }),
    nextAction,
    assumptions: RETAINED_SAVINGS_POLICY.assumptions,
  });
}

function comparablePeriods(periods) {
  return (Array.isArray(periods) ? periods : [])
    .filter((period) => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(period?.period)))
    .sort((left, right) => String(left.period).localeCompare(String(right.period))
      || String(left.periodId).localeCompare(String(right.periodId)))
    .slice(-2);
}

function matchingCommitment(commitments, baseline) {
  return (Array.isArray(commitments) ? commitments : [])
    .filter((entry) => entry?.periodId === baseline.periodId
      || entry?.claim?.period === baseline.period)
    .sort((left, right) => {
      const status = Number(right.status === "decision_linked") - Number(left.status === "decision_linked");
      return status || String(right.recordedAt).localeCompare(String(left.recordedAt))
        || String(left.commitmentId).localeCompare(String(right.commitmentId));
    })[0] ?? null;
}

/** Build exactly one comparison and exactly one deterministically ranked action. */
export function scoreRetainedSavingsComparison(periods = [], commitments = []) {
  const pair = comparablePeriods(periods);
  if (pair.length < 2) {
    const current = pair.at(-1);
    return unavailable("missing_baseline", {
      baseline: unavailablePeriod("missing_baseline"),
      current: current ? availablePeriod(current) : unavailablePeriod("missing_current_period"),
    }, action("retain_comparable_period",
      "Retain the immediately preceding comparable month, then rebuild this review.", "missing_baseline"));
  }
  const [baseline, current] = pair;
  const periodModel = { baseline: availablePeriod(baseline), current: availablePeriod(current) };
  const comparable = baseline.dataset === current.dataset
    && baseline.materialMetricId === current.materialMetricId;
  const baselineSpend = safeMinor(baseline.analyzedSpendMinor);
  const currentSpend = safeMinor(current.analyzedSpendMinor);
  if (!comparable || baselineSpend === null || currentSpend === null) {
    return unavailable("incomplete_evidence", periodModel,
      action("repair_comparison_evidence",
        "Retain complete like-for-like period evidence, then rebuild this review.", "incomplete_evidence"));
  }
  const commitment = matchingCommitment(commitments, baseline);
  const projected = safeMinor(commitment?.claim?.monthlySavingsMinor);
  if (!commitment || projected === null) {
    return unavailable("missing_prior_commitment", periodModel,
      action("record_commitment",
        `Record a savings commitment for ${baseline.period} before evaluating ${current.period}.`,
        "missing_prior_commitment"), "missing_prior_commitment");
  }

  const realized = Math.max(0, baselineSpend - currentSpend);
  const variance = realized - projected;
  const coverage = [baseline.coverageRatioPpm, current.coverageRatioPpm]
    .every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000)
    ? Math.min(baseline.coverageRatioPpm, current.coverageRatioPpm) : 0;
  const commitmentConfidence = Number.isInteger(commitment.confidence?.percent)
    ? Math.max(0, Math.min(100, commitment.confidence.percent)) : 0;
  const score = Math.min(Math.round(coverage / 10_000), commitmentConfidence);
  const band = score >= 85 ? "high" : score >= 65 ? "medium" : "low";
  const status = realized >= projected ? "successful_commitment" : "missed_commitment";
  const nextAction = status === "missed_commitment"
    ? action("revise_commitment", "Revise the missed commitment before the next review.", "realized_below_projected")
    : action("verify_and_close_commitment", "Verify scope, then close or extend the successful commitment.", "realized_met_projection");

  return freeze({
    schemaVersion: RETAINED_SAVINGS_SCORE_VERSION, status, reason: null,
    periods: freeze(periodModel),
    realizedSavings: availableMoney(realized),
    projectedSavings: availableMoney(projected),
    variance: availableMoney(variance),
    confidence: freeze({
      status: score >= 65 ? "available" : "incomplete", score, band,
      reason: score >= 65 ? null : "weak_retained_evidence",
    }),
    provenance: freeze({
      source: "browser_local_retained_records",
      periodIds: freeze([baseline.periodId, current.periodId]),
      commitmentId: commitment.commitmentId,
      scoringPolicy: RETAINED_SAVINGS_SCORE_VERSION,
    }),
    priorAction: freeze({
      status: commitment.status, commitmentId: commitment.commitmentId,
      reason: commitment.status === "decision_linked" ? null : "commitment_not_linked_to_decision",
    }),
    nextAction, assumptions: RETAINED_SAVINGS_POLICY.assumptions,
  });
}
