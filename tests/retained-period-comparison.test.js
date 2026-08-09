import test from "node:test";
import assert from "node:assert/strict";
import { buildRetainedPeriodComparison } from "../src/retained-period-comparison.js";

const period = (period, spend, overrides = {}) => ({
  periodId: `local:${period}`, period, dataset: "local", analyzedSpendMinor: spend,
  coverageRatioPpm: 900_000, ...overrides,
});
const commitment = (overrides = {}) => ({
  commitmentId: "commit-2026-06", periodId: "local:2026-06",
  claim: { period: "2026-06", baselineMonthlyCostMinor: 1_000_000, monthlySavingsMinor: 100_000 },
  confidence: { percent: 85 }, recordedAt: "2026-06-30T00:00:00Z", ...overrides,
});

test("successful retained comparison publishes explicit periods, money, confidence, and provenance", () => {
  const result = buildRetainedPeriodComparison({
    periods: [period("2026-06", 1_000_000), period("2026-07", 880_000)],
    commitments: [commitment()],
  });
  assert.equal(result.state, "available");
  assert.deepEqual(result.periods, { baseline: "2026-06", current: "2026-07" });
  assert.deepEqual(result.savings, { state: "available", projectedMinor: 100_000, realizedMinor: 120_000, varianceMinor: 20_000 });
  assert.deepEqual(result.priorAction, { status: "met", commitmentId: "commit-2026-06" });
  assert.equal(result.confidence.score, 85);
  assert.equal(result.provenance.source, "browser_local_retained_records");
  assert.equal(result.nextAction.id, "verify_and_close_commitment");
});

test("missed commitment is observable without inventing realized savings", () => {
  const result = buildRetainedPeriodComparison({
    periods: [period("2026-06", 1_000_000), period("2026-07", 960_000)],
    commitments: [commitment()],
  });
  assert.equal(result.priorAction.status, "missed");
  assert.equal(result.savings.realizedMinor, 40_000);
  assert.equal(result.savings.varianceMinor, -60_000);
  assert.equal(result.nextAction.id, "revise_missed_commitment");
});

test("missing commitment baseline is an explicit unavailable state", () => {
  const result = buildRetainedPeriodComparison({
    periods: [period("2026-06", 1_000_000), period("2026-07", 900_000)], commitments: [],
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.unavailableReason, "missing_commitment_baseline");
  assert.equal(result.savings.realizedMinor, null);
  assert.equal(result.priorAction.status, "unavailable");
});

test("action priority is deterministic across commitment order and incomplete evidence wins", () => {
  const older = commitment({ commitmentId: "z", recordedAt: "2026-06-01T00:00:00Z" });
  const newer = commitment({ commitmentId: "a", recordedAt: "2026-06-30T00:00:00Z" });
  const input = { periods: [period("2026-06", 1_000_000), period("2026-07", 900_000)], commitments: [older, newer] };
  assert.deepEqual(buildRetainedPeriodComparison(input),
    buildRetainedPeriodComparison({ ...input, commitments: [...input.commitments].reverse() }));
  const incomplete = buildRetainedPeriodComparison({
    ...input, periods: [period("2026-06", 1_000_000), period("2026-07", null)],
  });
  assert.equal(incomplete.nextAction.id, "repair_local_evidence");
  assert.equal(incomplete.unavailableReason, "incomplete_local_evidence");
});
