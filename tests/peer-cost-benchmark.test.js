import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePeerCostBenchmark, lowerCostPercentile,
} from "../src/peer-cost-benchmark.js";
import {
  evaluatePeerCostBenchmarkFit, PEER_COST_BENCHMARK_SCOPE,
} from "../src/peer-cost-benchmark-scope.js";
import {
  ORG_SIZE_BAND, PEER_COST_COHORTS, PEER_COST_SNAPSHOT_ID, PEER_INDUSTRY,
  TASK_OUTCOME,
} from "../src/peer-cost-position.js";

const org = Object.freeze({
  sizeBand: ORG_SIZE_BAND.enterprise,
  industry: PEER_INDUSTRY.saas,
  snapshotId: PEER_COST_SNAPSHOT_ID,
});
const input = (changes = {}) => ({
  org, spendUsd: 2_500, tasks: [{ outcome: TASK_OUTCOME.success, count: 100 }],
  asOfDate: "2026-07-31", ...changes,
});

test("the bundled contract returns the same complete benchmark on every evaluation", () => {
  const first = calculatePeerCostBenchmark(input());
  const second = calculatePeerCostBenchmark(input());
  assert.deepEqual(first, second);
  assert.equal(first.available, true);
  assert.equal(Number.isInteger(first.percentile), true);
  assert.deepEqual(first.range, { p25: 18.4, p75: 31.5, unit: "USD per successful task" });
  assert.equal(first.cohortSize, 40);
  assert.deepEqual(first.freshness, {
    snapshotDate: "2026-06-30", ageDays: 31, state: "eligible",
  });
  assert.equal(first.confidence.level, "moderate");
  assert.equal(first.eligibility.eligible, true);
  assert.equal(first.finding.priority, 1);
  assert.match(first.finding.evidence, /100 successful tasks.*40 bundled observations/);
});

test("ties use mid-rank, including the all-tied boundary", () => {
  assert.equal(lowerCostPercentile([10, 10, 20, 30], 10), 75);
  assert.equal(lowerCostPercentile([10, 10, 10, 10], 10), 50);
  assert.equal(lowerCostPercentile([10, 20, 30, 40], 25), 50);
});

test("stale and non-comparable cohorts never return a percentile or finding", () => {
  for (const result of [
    calculatePeerCostBenchmark(input({ asOfDate: "2026-09-29" })),
    calculatePeerCostBenchmark(input({ org: { ...org, snapshotId: "2025-01-01" } })),
  ]) {
    assert.equal(result.available, false);
    assert.equal(result.percentile, null);
    assert.equal(result.range, null);
    assert.equal(result.finding, null);
    assert.equal(result.confidence.level, "none");
    assert.notEqual(result.eligibility.status, "eligible");
  }
});

test("eligibility and confidence change on the declared size and freshness boundaries", () => {
  const cohort = PEER_COST_COHORTS[0];
  const fit = (memberCount, asOfDate) => evaluatePeerCostBenchmarkFit({
    metricId: "cost_per_successful_task", sizeBand: cohort.sizeBand,
    industry: cohort.industry, cohort: { ...cohort, memberCount }, asOfDate,
  });
  const floor = PEER_COST_BENCHMARK_SCOPE.minimumCohortSize;
  assert.equal(fit(floor - 1, "2026-07-01").state, "insufficient_cohort");
  assert.equal(fit(floor, "2026-07-01").state, "eligible");
  assert.equal(fit(floor, "2026-08-14").confidence, "moderate"); // 45 days
  assert.equal(fit(floor, "2026-08-15").confidence, "low"); // 46 days
  assert.equal(fit(floor, "2026-09-28").state, "eligible"); // 90 days
  assert.equal(fit(floor, "2026-09-29").state, "stale_cohort"); // 91 days
});

test("fixture member counts are executable observations, not asserted metadata", () => {
  for (const cohort of PEER_COST_COHORTS) {
    assert.equal(cohort.memberValues.length, cohort.memberCount, cohort.cohortId);
    assert.equal(Object.isFrozen(cohort.memberValues), true, cohort.cohortId);
  }
});
