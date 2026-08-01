import { MONTHLY_FINOPS_REVIEW_FIXTURE_VERSION } from "./monthly-finops-review-fixture.js";

export const MONTHLY_FINOPS_REVIEW_VERSION = "monthly-finops-review/1.0.0";

// Executable metric contract. Amounts are integer USD cents (`Minor`).
export const MONTHLY_FINOPS_METRIC_DEFINITIONS = Object.freeze({
  monthOverMonthChange: "current total minus prior total; percentage change is that difference divided by prior total; when prior total is zero, percentage change is null",
  priorCommitmentResult: "achieved only when the current observed value satisfies the explicit target using at_most (value <= target), at_least (value >= target), or exactly (value === target)",
  confidence: "high when both periods are complete and observed on each month end, medium when both are complete but either is not month-end fresh, otherwise low",
  prioritizedNextAction: "score = impact * 3 + urgency * 2 + evidence; highest score wins; ties resolve by lexicographically ascending action id",
});

const monthEnd = (month) => {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
};

function commitmentResult(commitment, observed) {
  const comparisons = {
    at_most: (value, target) => value <= target,
    at_least: (value, target) => value >= target,
    exactly: (value, target) => value === target,
  };
  const compare = comparisons[commitment.comparison];
  if (!compare) throw new TypeError(`Unsupported commitment comparison: ${commitment.comparison}`);
  return Object.freeze({
    status: compare(observed, commitment.targetMinor) ? "achieved" : "not_achieved",
    observedMinor: observed,
    targetMinor: commitment.targetMinor,
    comparison: commitment.comparison,
    statement: commitment.statement,
  });
}

function confidence(periods) {
  const complete = periods.every((period) => period.complete === true);
  const fresh = periods.every((period) => period.observedAt === monthEnd(period.month));
  return Object.freeze({
    label: complete && fresh ? "high" : complete ? "medium" : "low",
    complete,
    fresh,
    rule: "fixture_completeness_and_month_end_freshness",
  });
}

function nextAction(actions) {
  if (!Array.isArray(actions) || actions.length === 0) throw new TypeError("At least one action is required");
  const ranked = actions.map((action) => ({
    ...action,
    priorityScore: action.impact * 3 + action.urgency * 2 + action.evidence,
  })).sort((left, right) => right.priorityScore - left.priorityScore || left.id.localeCompare(right.id));
  return Object.freeze(ranked[0]);
}

/** Build the complete static preview. Exactly two ordered monthly periods are accepted. */
export function buildMonthlyFinopsReview(fixture) {
  if (fixture?.schemaVersion !== MONTHLY_FINOPS_REVIEW_FIXTURE_VERSION) throw new TypeError("Unsupported monthly review fixture version");
  if (!Array.isArray(fixture.periods) || fixture.periods.length !== 2) throw new TypeError("Monthly review requires exactly two periods");
  const [prior, current] = fixture.periods;
  if (prior.month >= current.month) throw new TypeError("Monthly review periods must be ordered prior then current");
  for (const period of fixture.periods) {
    if (!Number.isInteger(period.totalMinor) || period.totalMinor < 0) throw new TypeError("Period totals must be non-negative integer minor units");
  }
  const differenceMinor = current.totalMinor - prior.totalMinor;
  return Object.freeze({
    schemaVersion: MONTHLY_FINOPS_REVIEW_VERSION,
    sourceVersion: fixture.schemaVersion,
    evidenceAsOf: fixture.evidenceAsOf,
    periods: Object.freeze({ prior, current }),
    change: Object.freeze({
      differenceMinor,
      percentage: prior.totalMinor === 0 ? null : differenceMinor / prior.totalMinor,
    }),
    finding: fixture.finding,
    commitment: commitmentResult(fixture.priorCommitment, current.totalMinor),
    confidence: confidence(fixture.periods),
    nextAction: nextAction(fixture.actions),
  });
}
