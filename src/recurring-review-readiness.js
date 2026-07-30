// The decision contract for a recurring FinOps review.
//
// It deliberately knows nothing about providers, storage, or UI. Records are
// comparable only when every declared dimension is equal. A missing dimension
// is a refusal, never an invitation to infer one.

export const REVIEW_READINESS_VERSION = "finops-recurring-review/1.0.0";

export const REVIEW_STATE = Object.freeze({
  first: "first_review",
  awaiting: "action_awaiting_outcome",
  ready: "outcome_ready_review",
});

export const OPTIMIZATION_DIRECTION = Object.freeze({
  minimize: "minimize",
  maximize: "maximize",
});

const REQUIRED = Object.freeze([
  "metricDefinition", "unit", "scopeId", "periodDurationDays",
]);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A value record is `{ value, metricDefinition, unit, currency, scopeId,
 * periodDurationDays, periodEnd }`. Currency is required for monetary units and
 * must otherwise be explicitly null.
 */
export function comparisonGaps(left, right) {
  const gaps = [];
  if (!left || !right) return ["record_missing"];
  for (const field of REQUIRED) {
    if (left[field] === undefined || left[field] === null || left[field] === ""
      || right[field] === undefined || right[field] === null || right[field] === "") {
      gaps.push(`${field}_missing`);
    } else if (left[field] !== right[field]) {
      gaps.push(`${field}_mismatch`);
    }
  }
  if (!Object.hasOwn(left, "currency") || !Object.hasOwn(right, "currency")) {
    gaps.push("currency_missing");
  } else if (left.currency !== right.currency) {
    gaps.push("currency_mismatch");
  }
  if (!finite(left.value) || !finite(right.value)) gaps.push("value_missing");
  return [...new Set(gaps)];
}

export function areComparable(left, right) {
  return comparisonGaps(left, right).length === 0;
}

function afterReviewPeriod(action) {
  const end = action?.reviewPeriodEnd;
  const measured = action?.outcome?.periodEnd;
  return typeof end === "string" && typeof measured === "string" && measured > end;
}

function signedDelta(rawDelta, direction) {
  return direction === OPTIMIZATION_DIRECTION.minimize ? -rawDelta : rawDelta;
}

const ACTIONS = Object.freeze({
  [REVIEW_STATE.first]: Object.freeze({
    label: "Complete and retain the first review",
    rationale: "There is no comparable completed action yet. Record this period as the baseline; do not claim a recurring-review recommendation.",
  }),
  [REVIEW_STATE.awaiting]: Object.freeze({
    label: "Retain a post-action measurement",
    rationale: "A prior action exists, but no comparable measurement after its review period is retained locally. Measure the same metric and scope before judging it.",
  }),
  [REVIEW_STATE.ready]: Object.freeze({
    label: "Review the measured outcome before approving the next action",
    rationale: "The prior action has a comparable post-period outcome and this import uses the same metric contract. The review evidence is ready for an executive decision.",
  }),
});

// A measured prior outcome does not by itself make a review actionable: the
// current import, its benchmark, or the declared direction can still be
// incomparable. Without this the surface answers "No, not ready" in the headline
// and then hands the leader an action that says the evidence is ready — the one
// contradiction that would get a recommendation acted on anyway.
const BLOCKED_ACTION = Object.freeze({
  label: "Reconcile the mismatched evidence before recommending",
  rationale: "The prior action has a measured outcome, but the current import, its benchmark, or the metric's declared direction is not comparable with it. Resolve the dimensions listed below; this review cannot support a recommendation until they agree.",
});

/**
 * Answer “Is this month’s review ready to act on?”
 *
 * Metric definitions:
 * - current value: `current.value` for the current review period.
 * - benchmark delta: `current.value - benchmark.value`.
 * - prior-action outcome delta: `priorAction.outcome.value -
 *   priorAction.baseline.value`.
 * A positive interpreted delta means improvement; a negative one means
 * deterioration, after applying the metric's declared optimization direction.
 */
export function recurringReviewReadiness({
  current = null, benchmark = null, priorAction = null, optimizationDirection = null,
} = {}) {
  if (!Object.values(OPTIMIZATION_DIRECTION).includes(optimizationDirection)) {
    optimizationDirection = null;
  }

  const outcomeQualifies = Boolean(priorAction?.baseline && priorAction?.outcome
    && afterReviewPeriod(priorAction)
    && areComparable(priorAction.baseline, priorAction.outcome));
  const state = !priorAction
    ? REVIEW_STATE.first
    : outcomeQualifies ? REVIEW_STATE.ready : REVIEW_STATE.awaiting;

  const benchmarkGaps = comparisonGaps(current, benchmark);
  const currentOutcomeGaps = outcomeQualifies
    ? comparisonGaps(current, priorAction.outcome) : ["qualifying_prior_outcome_missing"];
  const recommendationGaps = [
    ...(current ? [] : ["current_import_missing"]),
    ...(benchmark ? [] : ["benchmark_missing"]),
    ...benchmarkGaps,
    ...currentOutcomeGaps,
    ...(optimizationDirection ? [] : ["optimization_direction_missing"]),
  ];
  const comparable = recommendationGaps.length === 0;
  const ready = state === REVIEW_STATE.ready && comparable;

  const benchmarkDelta = benchmarkGaps.length === 0
    ? current.value - benchmark.value : null;
  const outcomeDelta = outcomeQualifies
    ? priorAction.outcome.value - priorAction.baseline.value : null;

  return Object.freeze({
    schemaVersion: REVIEW_READINESS_VERSION,
    question: "Is this month’s review ready to act on?",
    state,
    ready,
    nextAction: state === REVIEW_STATE.ready && !ready ? BLOCKED_ACTION : ACTIONS[state],
    metrics: Object.freeze({
      currentValue: finite(current?.value) ? current.value : null,
      benchmarkDelta,
      benchmarkDirection: benchmarkDelta === null || !optimizationDirection
        ? null : signedDelta(benchmarkDelta, optimizationDirection),
      priorActionOutcomeDelta: outcomeDelta,
      priorActionOutcomeDirection: outcomeDelta === null || !optimizationDirection
        ? null : signedDelta(outcomeDelta, optimizationDirection),
      optimizationDirection,
    }),
    evidence: Object.freeze({
      benchmarkAvailable: benchmarkGaps.length === 0,
      priorResultAvailable: outcomeQualifies,
      gaps: Object.freeze([...new Set(recommendationGaps)]),
    }),
    recommendation: comparable
      ? Object.freeze({ status: "available", basis: "current_benchmark_and_prior_outcome_comparable" })
      : null,
  });
}

const MONTH_DAYS = 30;
const record = (value, periodEnd) => Object.freeze({
  value,
  metricDefinition: "monthly_avoidable_cost_v1",
  unit: "currency_minor",
  currency: "USD",
  scopeId: "demo-routing-action",
  periodDurationDays: MONTH_DAYS,
  periodEnd,
});

/** Invented, local-only evidence used when no visitor file is open. */
export function demoRecurringReviewReadiness() {
  return recurringReviewReadiness({
    current: record(810000, "2026-07-31"),
    benchmark: record(900000, "2026-06-30"),
    priorAction: {
      reviewPeriodEnd: "2026-05-31",
      baseline: record(1000000, "2026-05-31"),
      outcome: record(900000, "2026-06-30"),
    },
    optimizationDirection: OPTIMIZATION_DIRECTION.minimize,
  });
}
