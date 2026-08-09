import { PEER_COST_BENCHMARK_SCOPE } from "./peer-cost-cohorts.js";

export { PEER_COST_BENCHMARK_SCOPE } from "./peer-cost-cohorts.js";

export const BENCHMARK_FIT_STATE = Object.freeze({
  eligible: "eligible",
  insufficientCohort: "insufficient_cohort",
  staleCohort: "stale_cohort",
  incomparableScenario: "incomparable_scenario",
});

const DAY_MS = 86_400_000;
const utcDay = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
};

function confidenceFor(state, cohortSize, ageDays, scope) {
  const rule = scope.syntheticData.confidenceRules.find((candidate) =>
    candidate.states.includes(state)
    && (candidate.minimumCohortSize === undefined || cohortSize >= candidate.minimumCohortSize)
    && (candidate.maximumAgeDays === undefined || ageDays <= candidate.maximumAgeDays));
  if (!rule) throw new Error(`PEER_COST_BENCHMARK_SCOPE has no confidence rule for ${state}.`);
  return Object.freeze({ level: rule.confidence, ruleId: rule.id });
}

/** Pure suitability decision. Failure precedence: incomparable, size, freshness. */
export function evaluatePeerCostBenchmarkFit(input, scope = PEER_COST_BENCHMARK_SCOPE) {
  const snapshot = utcDay(input?.snapshotDate);
  const decision = utcDay(input?.decisionDate);
  const ageDays = snapshot === null || decision === null ? null : (decision - snapshot) / DAY_MS;
  const comparable = input?.metricId === scope.metric.id
    && scope.permittedCohorts.sizeBands.includes(input?.sizeBand)
    && scope.permittedCohorts.industries.includes(input?.industry)
    && snapshot !== null && decision !== null && Number.isInteger(ageDays) && ageDays >= 0;
  const state = !comparable ? BENCHMARK_FIT_STATE.incomparableScenario
    : !Number.isInteger(input?.cohortSize) || input.cohortSize < scope.minimumCohortSize
      ? BENCHMARK_FIT_STATE.insufficientCohort
      : ageDays > scope.freshness.maximumAgeDays
        ? BENCHMARK_FIT_STATE.staleCohort : BENCHMARK_FIT_STATE.eligible;
  const confidence = confidenceFor(state, input?.cohortSize, ageDays, scope);
  const answers = {
    [BENCHMARK_FIT_STATE.eligible]: "Yes—for a directional planning target within this declared cohort.",
    [BENCHMARK_FIT_STATE.insufficientCohort]: `No—the cohort has fewer than ${scope.minimumCohortSize} synthetic organizations.`,
    [BENCHMARK_FIT_STATE.staleCohort]: `No—the cohort is older than ${scope.freshness.maximumAgeDays} days.`,
    [BENCHMARK_FIT_STATE.incomparableScenario]: "No—the metric, declared cohort, or decision date is not comparable under this scope.",
  };
  return Object.freeze({
    state, suitable: state === BENCHMARK_FIT_STATE.eligible, answer: answers[state],
    confidence, cohortSize: Number.isInteger(input?.cohortSize) ? input.cohortSize : null,
    snapshotDate: input?.snapshotDate ?? null, decisionDate: input?.decisionDate ?? null,
    ageDays, question: scope.decisionQuestion, metric: scope.metric,
    methodology: `${scope.metric.window} ${scope.permittedCohorts.matchRule} ${scope.freshness.rule}`,
    provenance: scope.syntheticData.privacy, limitation: scope.syntheticData.limitation,
    scopeVersion: scope.version,
  });
}
