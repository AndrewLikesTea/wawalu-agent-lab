import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateTwoPeriodCommitment, redactedFixtureErrors,
} from "../src/two-period-commitment-evaluator.js";
import { TWO_PERIOD_COMMITMENT_FIXTURES } from "../src/two-period-commitment-fixtures.js";

test("all labelled fixtures reproduce their expected verdict and movement", () => {
  for (const fixture of Object.values(TWO_PERIOD_COMMITMENT_FIXTURES)) {
    const result = evaluateTwoPeriodCommitment(fixture);
    assert.equal(result.verdict.code, fixture.expected.verdict, fixture.id);
    assert.equal(result.movement?.savingMinor ?? null, fixture.expected.movementMinor, fixture.id);
    assert.deepEqual(evaluateTwoPeriodCommitment(fixture), result, `${fixture.id} must be deterministic`);
    assert.equal(Object.isFrozen(result), true);
  }
});

test("verified and unmet fixtures expose the merged benchmark boundaries", () => {
  const verified = evaluateTwoPeriodCommitment(TWO_PERIOD_COMMITMENT_FIXTURES.verified);
  const unmet = evaluateTwoPeriodCommitment(TWO_PERIOD_COMMITMENT_FIXTURES.unmet);
  assert.deepEqual([verified.verdict.code, verified.movement.percentOfBenchmark], ["met", 100]);
  assert.deepEqual([unmet.verdict.code, unmet.movement.percentOfBenchmark], ["missed", 10]);
  assert.equal(verified.benchmark.metAtPercent, 95);
  assert.equal(verified.benchmark.missedAtOrBelowPercent, 25);
  for (const weight of verified.scoringWeights) assert.match(weight.assumption, /\S/);
});

test("insufficient evidence emits no movement and explains the threshold", () => {
  const result = evaluateTwoPeriodCommitment(TWO_PERIOD_COMMITMENT_FIXTURES.insufficientEvidence);
  assert.equal(result.verdict.code, "not_enough_evidence");
  assert.equal(result.movement, null);
  assert.equal(result.confidence.level, "withheld");
  assert.equal(result.evidenceThreshold.satisfied, false);
  assert.deepEqual([result.evidenceThreshold.observedPeriodCount,
    result.evidenceThreshold.requiredPeriodCount], [1, 2]);
  assert.match(result.evidenceThreshold.rationale, /follow_up_period_missing/);
});

test("unredacted or open inputs are rejected before scoring", () => {
  const fixture = structuredClone(TWO_PERIOD_COMMITMENT_FIXTURES.verified);
  fixture.redacted = false;
  fixture.prompt = "untrusted prompt";
  assert.ok(redactedFixtureErrors(fixture).length > 0);
  assert.throws(() => evaluateTwoPeriodCommitment(fixture), /Unsafe two-period fixture/);
});

test("the Trends page imports and renders the fixture-backed evaluator", async () => {
  const { readFile } = await import("node:fs/promises");
  const [page, script] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id="two-period-commitment-example"/);
  assert.match(page, /Synthetic worked verdict · no prompt content/);
  assert.match(script, /renderTwoPeriodCommitmentExample\(document\)/);
});
