import assert from "node:assert/strict";
import test from "node:test";
import { headlineTrust, metricState } from "../src/finops-display.js";

test("executive metrics accept bounded values and reject implausible results", () => {
  assert.deepEqual(metricState(72, "score"), {
    plausible: true, value: 72, label: "Available",
  });
  for (const value of [-1, 101, Infinity, Number.NaN])
    assert.equal(metricState(value, "score").label, "Needs review");
  assert.equal(metricState(2.5, "queries", { integer: true }).plausible, false);
  assert.equal(metricState(1_000_000_000_001, "spendUsd").plausible, false);
});

test("recoverable spend cannot be reliable above total spend", () => {
  const trust = headlineTrust({
    score: 80, spendUsd: 100, recoverableUsd: 101, queries: 10,
    headcount: 2, departments: 1, mix: { highValue: 0.5 },
  }, { peerPercentile: 101 });
  assert.equal(trust.score.plausible, true);
  assert.equal(trust.recoverable.label, "Needs review");
  assert.equal(trust.percentile.label, "Needs review");
});
