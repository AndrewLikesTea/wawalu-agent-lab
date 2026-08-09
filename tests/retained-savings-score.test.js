import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RETAINED_SAVINGS_POLICY, scoreRetainedSavingsComparison,
} from "../src/retained-savings-score.js";

const fixtureSet = JSON.parse(await readFile(
  new URL("../src/retained-savings-fixtures.json", import.meta.url), "utf8",
));

test("four privacy-safe two-period labels are executable", () => {
  assert.deepEqual(fixtureSet.fixtures.map(({ id }) => id), [
    "successful-commitment", "missed-commitment",
    "incomplete-comparison-evidence", "newly-emerging-opportunity",
  ]);
  for (const fixture of fixtureSet.fixtures) {
    const score = scoreRetainedSavingsComparison(fixture.periods);
    assert.equal(score.label, fixture.expectedLabel, fixture.id);
    assert.equal(score.nextAction.rank, 1);
    const serialized = JSON.stringify(fixture);
    for (const prohibited of ["prompt", "email", "token", "customer", "credential"])
      assert.equal(serialized.toLowerCase().includes(prohibited), false, `${fixture.id}: ${prohibited}`);
  }
});

test("realized versus projected arithmetic is cents-exact and explainable", () => {
  const successful = scoreRetainedSavingsComparison(fixtureSet.fixtures[0].periods);
  assert.equal(successful.projectedSavingsMinor, 100_000);
  assert.equal(successful.realizedSavingsMinor, 110_000);
  assert.equal(successful.varianceMinor, 10_000);
  assert.equal(successful.attainmentPercent, 110);
  assert.match(successful.assumptions.realized, /prior analyzed spend minus current/);
});

test("every confidence weight publishes its assumption and sums to 100", () => {
  assert.equal(RETAINED_SAVINGS_POLICY.confidenceWeights.reduce((sum, item) => sum + item.points, 0), 100);
  for (const weight of RETAINED_SAVINGS_POLICY.confidenceWeights)
    assert.ok(weight.assumption.length > 20, weight.id);
  const score = scoreRetainedSavingsComparison(fixtureSet.fixtures[1].periods);
  assert.deepEqual(score.confidence.components,
    { coverage: 45, completeness: 30, comparability: 20 });
  assert.equal(score.confidence.score, 95);
  assert.equal(score.confidence.formula, "45 coverage + 30 completeness + 20 comparability = 95");
});

test("identical fixture inputs always reproduce scores and priority", () => {
  for (const fixture of fixtureSet.fixtures) {
    const snapshot = JSON.stringify(scoreRetainedSavingsComparison(fixture.periods));
    for (let run = 0; run < 20; run += 1)
      assert.equal(JSON.stringify(scoreRetainedSavingsComparison(structuredClone(fixture.periods))), snapshot);
  }
  assert.deepEqual(fixtureSet.fixtures.map(({ periods }) =>
    scoreRetainedSavingsComparison(periods).nextAction.id), [
    "verify_and_close_commitment", "revise_commitment",
    "retain_comparable_period", "investigate_emerging_opportunity",
  ]);
  const forward = fixtureSet.fixtures[0].periods;
  assert.deepEqual(scoreRetainedSavingsComparison([...forward].reverse()),
    scoreRetainedSavingsComparison(forward), "input order must not alter the score");
});

test("prompt-derived fields have no scoring path", () => {
  const poisoned = structuredClone(fixtureSet.fixtures[0].periods);
  poisoned[0].prompt = "Bearer secret@example.test";
  const clean = fixtureSet.fixtures[0].periods;
  assert.deepEqual(scoreRetainedSavingsComparison(poisoned), scoreRetainedSavingsComparison(clean));
  assert.equal(JSON.stringify(scoreRetainedSavingsComparison(poisoned)).includes("secret@example"), false);
});
