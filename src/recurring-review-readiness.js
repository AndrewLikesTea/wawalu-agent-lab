// The decision contract for a recurring FinOps review.
//
// It deliberately knows nothing about providers, storage, or UI. Records are
// comparable only when every declared dimension is equal. A missing dimension
// is a refusal, never an invitation to infer one.

import { calendarDate } from "./calendar-date.js";

export const REVIEW_READINESS_VERSION = "finops-recurring-review/2.0.0";

export const REVIEW_STATE = Object.freeze({
  first: "first_review",
  awaiting: "action_awaiting_outcome",
  ready: "outcome_ready_review",
});

export const OPTIMIZATION_DIRECTION = Object.freeze({
  minimize: "minimize",
  maximize: "maximize",
});

export const REVIEW_VERDICT = Object.freeze({
  improvement: "improvement",
  regression: "regression",
  incomparable: "incomparable_periods",
  missingPrior: "missing_prior_evidence",
});

export const REVIEW_CONFIDENCE = Object.freeze({
  high: "high",
  moderate: "moderate",
  insufficient: "insufficient",
});

// Confidence is evidence completeness, not probability. Comparability carries
// 50% because a differently defined metric, scope, currency, or duration makes
// the sign uninterpretable. Sampling carries 30% because incomplete observation
// can reverse an otherwise comparable result. A retained baseline carries 20%
// because it is required to judge change after the action, but cannot repair
// incomparable or unrepresentative periods. The 0.90 high threshold requires
// all three; 0.70 moderate permits a complete comparable sample with no causal
// baseline. A failed comparability or sampling gate is always insufficient,
// irrespective of the arithmetic score.
export const CONFIDENCE_POLICY = Object.freeze({
  weights: Object.freeze({ comparability: 0.5, sampling: 0.3, baseline: 0.2 }),
  thresholds: Object.freeze({ high: 0.9, moderate: 0.7 }),
  assumptions: Object.freeze([
    "Comparability is half the evidence because mismatched definitions can reverse meaning.",
    "Sampling is thirty percent because partial observation can reverse the measured direction.",
    "Baseline is twenty percent because it supports before/after description, not causation.",
    "High confidence requires every evidence gate; no numeric score overrides a failed gate.",
  ]),
});

const REQUIRED = Object.freeze([
  "metricDefinition", "unit", "scopeId", "periodDurationDays",
]);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A period boundary is a real calendar day or it is nothing.
 *
 * These dates arrive off imported exports, where `"2026-02-30"`, a timestamp,
 * and a sentence that merely starts with a date are all just strings. Each one
 * has to be refused for its own reason: a day nobody billed for, a value that
 * sorts after the plain date it means, and free text that would otherwise be
 * copied verbatim into a verdict which declares it excludes prompt content.
 * `calendarDate` is the site-wide rule for the question, so this contract asks
 * it rather than writing a fourth spelling of the check. Once every boundary
 * has passed it, `<` and `>` on these strings are exact chronological order.
 */
const periodBoundary = (record) => calendarDate(record?.periodEnd);

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
  if (!periodBoundary(left) || !periodBoundary(right)) gaps.push("period_end_invalid");
  return [...new Set(gaps)];
}

/**
 * The benchmark is the earlier period by definition. A benchmark dated on or
 * after the current period reverses the meaning of every delta computed from
 * it, so it is named as a gap rather than left as a sign nobody reads twice.
 */
function benchmarkOrderGaps(current, benchmark) {
  const later = periodBoundary(current);
  const earlier = periodBoundary(benchmark);
  return later && earlier && later <= earlier ? ["benchmark_period_not_earlier"] : [];
}

export function areComparable(left, right) {
  return comparisonGaps(left, right).length === 0;
}

function afterReviewPeriod(action) {
  const end = calendarDate(action?.reviewPeriodEnd);
  const measured = periodBoundary(action?.outcome);
  return Boolean(end && measured && measured > end);
}

function signedDelta(rawDelta, direction) {
  return direction === OPTIMIZATION_DIRECTION.minimize ? -rawDelta : rawDelta;
}

function sampleComplete(record) {
  const observed = record?.sample?.observed;
  const eligible = record?.sample?.eligible;
  return Number.isInteger(observed) && Number.isInteger(eligible)
    && eligible > 0 && observed === eligible;
}

const WORDING = Object.freeze({
  [REVIEW_VERDICT.improvement]: Object.freeze([
    "The comparable observed periods improved.",
    "The measured value moved in the declared improvement direction.",
  ]),
  [REVIEW_VERDICT.regression]: Object.freeze([
    "The comparable observed periods regressed.",
    "The measured value moved against the declared improvement direction.",
  ]),
  [REVIEW_VERDICT.incomparable]: Object.freeze([
    "These periods are not comparable; no direction is reported.",
    "Reconcile metric, scope, duration, currency, and sampling before interpreting change.",
  ]),
  [REVIEW_VERDICT.missingPrior]: Object.freeze([
    "Prior evidence is missing; this period establishes or extends a baseline.",
    "No recurring outcome or causal success is claimed.",
  ]),
});

function verdictContract({
  current, benchmark, priorAction, optimizationDirection, benchmarkGaps, outcomeQualifies,
}) {
  const priorMissing = !priorAction?.baseline || !priorAction?.outcome;
  const priorGaps = outcomeQualifies
    ? comparisonGaps(current, priorAction.outcome) : ["qualifying_prior_outcome_missing"];
  const comparable = benchmarkGaps.length === 0 && (priorMissing || priorGaps.length === 0)
    && Boolean(optimizationDirection);
  const sampling = [current, benchmark, priorAction?.baseline, priorAction?.outcome]
    .filter(Boolean).every(sampleComplete);
  const baseline = Boolean(priorAction?.baseline && priorAction?.outcome && outcomeQualifies);
  const rawDirection = comparable ? signedDelta(current.value - benchmark.value,
    optimizationDirection) : null;
  const verdict = priorMissing
    ? REVIEW_VERDICT.missingPrior
    : !comparable || !sampling
      ? REVIEW_VERDICT.incomparable
      : rawDirection > 0 ? REVIEW_VERDICT.improvement
        : rawDirection < 0 ? REVIEW_VERDICT.regression : REVIEW_VERDICT.incomparable;
  const score = CONFIDENCE_POLICY.weights.comparability * Number(comparable)
    + CONFIDENCE_POLICY.weights.sampling * Number(sampling)
    + CONFIDENCE_POLICY.weights.baseline * Number(baseline);
  const confidence = (!comparable || !sampling)
    ? REVIEW_CONFIDENCE.insufficient
    : score >= CONFIDENCE_POLICY.thresholds.high ? REVIEW_CONFIDENCE.high
      : score >= CONFIDENCE_POLICY.thresholds.moderate
        ? REVIEW_CONFIDENCE.moderate : REVIEW_CONFIDENCE.insufficient;

  return Object.freeze({
    verdict,
    confidence,
    statement: WORDING[verdict][0],
    permittedWording: WORDING[verdict],
    causalClaimPermitted: false,
    evidenceBoundaries: Object.freeze({
      // Validated, not copied. These four are the only imported strings the
      // verdict carries, so each is a real calendar day or it is `null`; that
      // is what keeps "prompt content" below an excluded field rather than a
      // claim the boundary itself disproves.
      currentPeriod: periodBoundary(current),
      benchmarkPeriod: periodBoundary(benchmark),
      priorBaselinePeriod: periodBoundary(priorAction?.baseline),
      priorOutcomePeriod: periodBoundary(priorAction?.outcome),
      comparable,
      completeSampling: sampling,
      retainedBaseline: baseline,
      excluded: Object.freeze([
        "causal attribution", "unobserved records", "other scopes", "prompt content",
      ]),
    }),
    confidenceBasis: Object.freeze({
      // Kept inspectable for audit, but the executive sentence uses the named
      // rung so an unexplained decimal never becomes the conclusion.
      score,
      policy: CONFIDENCE_POLICY,
    }),
  });
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

  const benchmarkGaps = [
    ...comparisonGaps(current, benchmark),
    ...benchmarkOrderGaps(current, benchmark),
  ];
  const currentOutcomeGaps = outcomeQualifies
    ? comparisonGaps(current, priorAction.outcome) : ["qualifying_prior_outcome_missing"];
  const recommendationGaps = [
    ...(current ? [] : ["current_import_missing"]),
    ...(benchmark ? [] : ["benchmark_missing"]),
    ...benchmarkGaps,
    ...currentOutcomeGaps,
    ...(optimizationDirection ? [] : ["optimization_direction_missing"]),
    ...([current, benchmark, priorAction?.baseline, priorAction?.outcome].every(sampleComplete)
      ? [] : ["complete_sampling_missing"]),
  ];
  const comparable = recommendationGaps.length === 0;
  const ready = state === REVIEW_STATE.ready && comparable;

  const benchmarkDelta = benchmarkGaps.length === 0
    ? current.value - benchmark.value : null;
  const outcomeDelta = outcomeQualifies
    ? priorAction.outcome.value - priorAction.baseline.value : null;

  const verdict = verdictContract({
    current, benchmark, priorAction, optimizationDirection, benchmarkGaps, outcomeQualifies,
  });

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
    verdict,
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
  sample: Object.freeze({ observed: 30, eligible: 30 }),
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
