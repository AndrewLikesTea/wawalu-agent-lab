import assert from "node:assert/strict";
import test from "node:test";

import {
  BENCHMARK_FIT_STATE, PEER_COST_BENCHMARK_SCOPE, evaluatePeerCostBenchmarkFit,
} from "../src/peer-cost-benchmark-fit.js";
import { ORG_SIZE_BAND, PEER_INDUSTRY } from "../src/peer-cost-cohorts.js";

const BASE = Object.freeze({
  metricId: "cost_per_successful_task", sizeBand: ORG_SIZE_BAND.enterprise,
  industry: PEER_INDUSTRY.saas, cohortSize: 42,
  snapshotDate: "2026-06-30", decisionDate: "2026-07-31",
});

test("the consumed scope completely defines the planning decision", () => {
  const scope = PEER_COST_BENCHMARK_SCOPE;
  assert.match(scope.decisionQuestion, /^Is this synthetic peer comparison suitable/);
  for (const field of ["numerator", "denominator", "window", "calculation", "direction"])
    assert.ok(scope.metric[field], `metric.${field}`);
  assert.deepEqual(scope.permittedCohorts.sizeBands, ["small", "mid", "enterprise"]);
  assert.deepEqual(scope.permittedCohorts.industries, ["saas", "financial_services"]);
  assert.ok(Number.isInteger(scope.minimumCohortSize));
  assert.ok(Number.isInteger(scope.freshness.maximumAgeDays));
  assert.ok(scope.syntheticData.confidenceRules.length >= 3);
  assert.match(scope.syntheticData.privacy, /no customer, provider, or HRIS data/i);
});

test("fit has deterministic eligible, insufficient, stale, and incomparable answers", () => {
  const cases = [
    [BENCHMARK_FIT_STATE.eligible, BASE, true, 31],
    [BENCHMARK_FIT_STATE.insufficientCohort, { ...BASE, cohortSize: 29 }, false, 31],
    [BENCHMARK_FIT_STATE.staleCohort, { ...BASE, decisionDate: "2026-10-01" }, false, 93],
    [BENCHMARK_FIT_STATE.incomparableScenario, { ...BASE, metricId: "cost_per_request" }, false, 31],
  ];
  for (const [state, input, suitable, ageDays] of cases) {
    const result = evaluatePeerCostBenchmarkFit(input);
    assert.equal(result.state, state);
    assert.equal(result.suitable, suitable);
    assert.equal(result.ageDays, ageDays);
    assert.ok(result.answer.length > 20);
  }
});

test("confidence is selected only from the supplied configuration rules", () => {
  const changed = {
    ...PEER_COST_BENCHMARK_SCOPE,
    syntheticData: {
      ...PEER_COST_BENCHMARK_SCOPE.syntheticData,
      confidenceRules: [
        { id: "configured_eligible", states: ["eligible"], confidence: "experimental" },
        { id: "configured_refusal", states: ["insufficient_cohort", "stale_cohort", "incomparable_scenario"], confidence: "withheld_by_policy" },
      ],
    },
  };
  assert.deepEqual(evaluatePeerCostBenchmarkFit(BASE, changed).confidence,
    { level: "experimental", ruleId: "configured_eligible" });
  assert.deepEqual(evaluatePeerCostBenchmarkFit({ ...BASE, cohortSize: 1 }, changed).confidence,
    { level: "withheld_by_policy", ruleId: "configured_refusal" });
});

test("a scope with no applicable confidence rule fails instead of inventing one", () => {
  const broken = {
    ...PEER_COST_BENCHMARK_SCOPE,
    syntheticData: { ...PEER_COST_BENCHMARK_SCOPE.syntheticData, confidenceRules: [] },
  };
  assert.throws(() => evaluatePeerCostBenchmarkFit(BASE, broken), /no confidence rule/);
});
