// Can a leader honestly use the synthetic peer-cost comparison?
//
// This contract is evaluated before a benchmark band is presented as useful.
// Its order is deliberate: incomparable beats insufficient, insufficient beats
// stale, and only a comparable, large-enough, fresh cohort is eligible.

import {
  ORG_SIZE_BAND, PEER_COST_PROVENANCE, PEER_COST_RUBRIC_VERSION, PEER_INDUSTRY,
} from "./peer-cost-cohorts.js";

export const BENCHMARK_FIT_STATE = Object.freeze({
  incomparable: "incomparable",
  insufficient: "insufficient_cohort",
  stale: "stale_cohort",
  eligible: "eligible",
});

export const PEER_COST_BENCHMARK_SCOPE = Object.freeze({
  version: "peer-cost-benchmark-scope/1.0.0",
  decisionQuestion: "Is this synthetic peer cohort fit to judge whether our cost per successful task is high or low?",
  metric: Object.freeze({
    id: "cost_per_successful_task",
    unit: "USD per successful task",
    definition: "Total AI spend in USD attributed to the organization during the analysis window divided by the integer count of tasks in that same window whose terminal outcome is success. All attributed spend remains in the numerator regardless of task outcome; failed, abandoned, and non-terminal tasks contribute no denominator units. Compute at full precision; round only the displayed result to two decimal places. A denominator of zero makes the metric incomparable.",
  }),
  permittedCohorts: Object.freeze({
    sizeBands: Object.freeze(Object.values(ORG_SIZE_BAND)),
    industries: Object.freeze(Object.values(PEER_INDUSTRY)),
    match: "The declared size band and declared industry must each match one published cohort exactly; neither may be inferred from spend or imported data.",
  }),
  minimumCohortSize: 30,
  freshness: Object.freeze({
    maximumAgeDays: 90,
    definition: "Whole UTC calendar days from the cohort snapshot date through the evaluation date, inclusive of neither endpoint; negative ages are incomparable.",
  }),
  // First matching rule wins. Every outcome, including no confidence, is data.
  confidenceRules: Object.freeze([
    Object.freeze({ id: "synthetic_current_large", confidence: "moderate", eligibleOnly: true,
      minimumCohortSize: 30, maximumAgeDays: 45,
      basis: "Synthetic boundaries are current and based on at least 30 invented members; useful for directional comparison, never a measured market claim." }),
    Object.freeze({ id: "synthetic_current", confidence: "low", eligibleOnly: true,
      minimumCohortSize: 30, maximumAgeDays: 90,
      basis: "Synthetic boundaries meet the publication floor but are too old for the stronger synthetic-data rule." }),
    Object.freeze({ id: "not_eligible", confidence: "none", eligibleOnly: false,
      minimumCohortSize: 0, maximumAgeDays: null,
      basis: "No confidence is assigned when the cohort is incomparable, too small, or stale." }),
  ]),
  methodology: Object.freeze({
    rubricVersion: PEER_COST_RUBRIC_VERSION,
    provenance: PEER_COST_PROVENANCE,
    statement: "The repository publishes synthetic p25 and p75 boundaries for each permitted segment; the unrounded organization metric is placed against those fixed boundaries. Lower is better.",
  }),
  exclusions: "Cohorts are synthetic and privacy-preserving. They do not imply access to customer, provider, or HRIS data, and they are not measured market performance.",
});

const utcDay = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
};

function confidenceFor(scope, state, cohortSize, ageDays) {
  const eligible = state === BENCHMARK_FIT_STATE.eligible;
  return scope.confidenceRules.find((rule) => rule.eligibleOnly === eligible
    && cohortSize >= rule.minimumCohortSize
    && (rule.maximumAgeDays === null || ageDays <= rule.maximumAgeDays));
}

/** Pure evaluation; callers may provide a scope to prove policy controls outcomes. */
export function evaluatePeerCostBenchmarkFit({
  metricId, sizeBand, industry, cohort = null, asOfDate,
} = {}, scope = PEER_COST_BENCHMARK_SCOPE) {
  const snapshotTime = utcDay(cohort?.snapshotId);
  const asOfTime = utcDay(asOfDate);
  const ageDays = snapshotTime === null || asOfTime === null
    ? null : Math.floor((asOfTime - snapshotTime) / 86_400_000);
  const comparable = metricId === scope.metric.id
    && scope.permittedCohorts.sizeBands.includes(sizeBand)
    && scope.permittedCohorts.industries.includes(industry)
    && cohort?.sizeBand === sizeBand && cohort?.industry === industry
    && cohort?.rubricVersion === scope.methodology.rubricVersion
    && Number.isInteger(cohort?.memberCount) && ageDays !== null && ageDays >= 0;

  let state;
  if (!comparable) state = BENCHMARK_FIT_STATE.incomparable;
  else if (cohort.memberCount < scope.minimumCohortSize) state = BENCHMARK_FIT_STATE.insufficient;
  else if (ageDays > scope.freshness.maximumAgeDays) state = BENCHMARK_FIT_STATE.stale;
  else state = BENCHMARK_FIT_STATE.eligible;

  const rule = confidenceFor(scope, state, cohort?.memberCount ?? 0, ageDays ?? Infinity);
  if (!rule) throw new Error(`peer cost benchmark scope has no confidence rule for ${state}`);
  const outcome = {
    [BENCHMARK_FIT_STATE.incomparable]: "Do not use this cohort: the metric, segment, rubric, date, or cohort facts are not comparable.",
    [BENCHMARK_FIT_STATE.insufficient]: `Do not use this cohort: ${cohort?.memberCount} synthetic members is below the minimum of ${scope.minimumCohortSize}.`,
    [BENCHMARK_FIT_STATE.stale]: `Do not use this cohort: it is ${ageDays} days old, beyond the ${scope.freshness.maximumAgeDays}-day limit.`,
    [BENCHMARK_FIT_STATE.eligible]: `Eligible: ${cohort?.memberCount} synthetic members match the declared size and industry; the snapshot is ${ageDays} days old.`,
  }[state];
  return Object.freeze({
    question: scope.decisionQuestion, state, eligible: state === BENCHMARK_FIT_STATE.eligible,
    outcome, cohortId: cohort?.cohortId ?? null, cohortSize: cohort?.memberCount ?? null,
    snapshotDate: cohort?.snapshotId ?? null, ageDays, confidence: rule.confidence,
    confidenceRuleId: rule.id, confidenceBasis: rule.basis,
    methodology: scope.methodology.statement, provenance: scope.methodology.provenance,
    exclusions: scope.exclusions,
  });
}

export function benchmarkFitAnswer(fit) {
  const freshness = fit.snapshotDate && fit.ageDays !== null
    ? `Freshness: snapshot ${fit.snapshotDate}, ${fit.ageDays} days old. `
    : "Freshness: no comparable snapshot date. ";
  return `${fit.outcome} ${freshness}Confidence: ${fit.confidence} — ${fit.confidenceBasis} `
    + `Method: ${fit.methodology} Provenance: ${fit.provenance.label}. ${fit.exclusions}`;
}
