import test from "node:test";
import assert from "node:assert/strict";
import {
  RETAINED_SAVINGS_POLICY, scoreRetainedSavingsComparison,
} from "../src/retained-savings-score.js";

const period = (label, spend, overrides = {}) => ({
  period: label, periodId: `user:${label}`, dataset: "user",
  materialMetricId: "recoverable_scenario", analyzedSpendMinor: spend,
  coverageRatioPpm: 900_000, ...overrides,
});
const commitment = (overrides = {}) => ({
  commitmentId: "commit-a", periodId: "user:2026-05", recordedAt: "2026-05-31T00:00:00Z",
  status: "decision_linked", claim: { period: "2026-05", monthlySavingsMinor: 100_000 },
  confidence: { percent: 85 }, ...overrides,
});

test("successful comparison publishes the compact local-record contract", () => {
  const result = scoreRetainedSavingsComparison([
    period("2026-05", 1_000_000), period("2026-06", 850_000),
  ], [commitment()]);
  assert.equal(result.status, "successful_commitment");
  assert.deepEqual(result.periods.baseline, {
    status: "available", label: "2026-05", periodId: "user:2026-05", reason: null,
  });
  assert.equal(result.realizedSavings.minor, 150_000);
  assert.equal(result.projectedSavings.minor, 100_000);
  assert.equal(result.variance.minor, 50_000);
  assert.equal(result.priorAction.status, "decision_linked");
  assert.equal(result.provenance.source, "browser_local_retained_records");
  assert.equal(result.nextAction.id, "verify_and_close_commitment");
});

test("missed commitment remains observed movement rather than causal credit", () => {
  const result = scoreRetainedSavingsComparison([
    period("2026-05", 1_000_000), period("2026-06", 960_000),
  ], [commitment()]);
  assert.equal(result.status, "missed_commitment");
  assert.equal(result.realizedSavings.minor, 40_000);
  assert.equal(result.variance.minor, -60_000);
  assert.equal(result.nextAction.id, "revise_commitment");
  assert.match(result.assumptions.realized, /not causal credit/);
});

test("missing baseline is explicitly unavailable and never fabricates money", () => {
  const result = scoreRetainedSavingsComparison([period("2026-06", 960_000)], [commitment()]);
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "missing_baseline");
  assert.equal(result.periods.baseline.status, "unavailable");
  assert.deepEqual(result.projectedSavings,
    { status: "unavailable", minor: null, reason: "missing_baseline" });
  assert.equal(result.confidence.score, null);
  assert.equal(result.nextAction.id, "retain_comparable_period");
});

test("action and commitment selection are deterministic", () => {
  assert.deepEqual(RETAINED_SAVINGS_POLICY.actionPriority, [
    "retain_comparable_period", "repair_comparison_evidence", "record_commitment",
    "revise_commitment", "verify_and_close_commitment",
  ]);
  const periods = [period("2026-06", 850_000), period("2026-05", 1_000_000)];
  const records = [
    commitment({ commitmentId: "recorded", status: "recorded", recordedAt: "2026-06-02T00:00:00Z" }),
    commitment({ commitmentId: "linked", status: "decision_linked", recordedAt: "2026-06-01T00:00:00Z" }),
  ];
  const forward = scoreRetainedSavingsComparison(periods, records);
  const reversed = scoreRetainedSavingsComparison([...periods].reverse(), [...records].reverse());
  assert.deepEqual(reversed, forward);
  assert.equal(forward.priorAction.commitmentId, "linked");
  assert.equal(Object.keys(forward).filter((key) => key === "nextAction").length, 1);
  assert.equal(forward.nextAction.rank, 1);
});
