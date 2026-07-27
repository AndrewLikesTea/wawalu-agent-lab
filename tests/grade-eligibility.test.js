// Grade eligibility: when a letter grade may be shown at all.
//
// Every assertion is about a ratio, a tier, or the one action — never a widget.
// Boundary cases are built from exact whole-dollar spends (80 of 100, not
// 0.8 * 100) so a threshold assertion can never pass or fail on float drift.

import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAMPED_REASON, COVERAGE_TIERS, gradeEligibility, gradeEligibilityFromCoverage,
  sampledSpendCoverage,
} from "../src/grade-eligibility.js";

/** A department the rubric scored: sampling available, a real mix, real spend. */
function scored(name, spendUsd, { sampledQueries = 100 } = {}) {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    spendUsd,
    mix: { highValue: 6, overProvisioned: 2, inefficient: 1, outOfScope: 1 },
    sampling: { status: "available", sampledQueries },
  };
}

/** Same shape, but the rubric produced no score for it. */
function unscored(name, spendUsd, overrides = {}) {
  return {
    ...scored(name, spendUsd),
    sampling: { status: "unavailable", sampledQueries: 0, reason: "No eligible scored sample.", ...overrides },
  };
}

/**
 * A department list whose covered spend is exactly `coveredUsd` out of exactly
 * `totalUsd`. Both figures are whole dollars, so the ratio is exact.
 */
function population(coveredUsd, totalUsd) {
  const list = [];
  if (coveredUsd > 0) list.push(scored("Covered", coveredUsd));
  if (totalUsd - coveredUsd > 0) list.push(unscored("Uncovered", totalUsd - coveredUsd));
  return list;
}

test("coverage is covered spend over total imported spend, as a raw ratio", () => {
  const result = gradeEligibility(population(3, 4));
  assert.equal(result.coverage, 0.75);
  assert.equal(result.coveredUsd, 3);
  assert.equal(result.totalUsd, 4);
  // Raw, not a rounded percentage: presentation owns the formatting.
  assert.equal(result.coverage * 100, 75);
});

test("only departments the rubric actually scored count as covered", () => {
  // Each of these fails one clause of the availability rule, so none is covered
  // and the letter is withheld even though every row carries spend.
  const list = [
    unscored("No sampling status", 100, { status: "pending" }),
    unscored("Zero sampled queries", 100, { status: "available", sampledQueries: 0 }),
    { id: "empty-mix", name: "Empty mix", spendUsd: 100, mix: {}, sampling: { status: "available", sampledQueries: 50 } },
  ];
  const result = gradeEligibility(list);
  assert.equal(result.coverage, 0);
  assert.equal(result.tier, "insufficient");
  assert.equal(result.showGrade, false);
});

test("thresholds are inclusive at the lower bound", () => {
  // 80 of 100 is exactly 0.80 and belongs to `high`.
  assert.equal(gradeEligibility(population(80, 100)).tier, "high");
  assert.equal(gradeEligibility(population(50, 100)).tier, "moderate");
  assert.equal(gradeEligibility(population(25, 100)).tier, "provisional");
});

test("just below each threshold falls to the lower tier", () => {
  // Constructed as whole dollars one unit under the boundary — 7999/10000 is
  // exactly 0.7999, so "just below" is an exact value rather than a near miss.
  assert.equal(gradeEligibility(population(7999, 10000)).tier, "moderate");
  assert.equal(gradeEligibility(population(4999, 10000)).tier, "provisional");
  assert.equal(gradeEligibility(population(2499, 10000)).tier, "insufficient");
});

test("each tier carries its state, its showGrade flag, and a stable reason", () => {
  const high = gradeEligibility(population(90, 100));
  assert.deepEqual(
    [high.state, high.showGrade, high.provisional, high.reason],
    ["graded", true, false, "sufficient_coverage"],
  );
  const moderate = gradeEligibility(population(60, 100));
  assert.deepEqual(
    [moderate.state, moderate.showGrade, moderate.provisional, moderate.reason],
    ["graded", true, false, "sufficient_coverage"],
  );
  const provisional = gradeEligibility(population(30, 100));
  assert.deepEqual(
    [provisional.state, provisional.showGrade, provisional.provisional, provisional.reason],
    ["provisional", true, true, "provisional_coverage"],
  );
  const insufficient = gradeEligibility(population(10, 100));
  assert.deepEqual(
    [insufficient.state, insufficient.showGrade, insufficient.provisional, insufficient.reason],
    ["not_gradeable", false, false, "insufficient_coverage"],
  );
});

test("the letter is suppressed in both not-gradeable states", () => {
  assert.equal(gradeEligibility(population(10, 100)).showGrade, false);
  assert.equal(gradeEligibility([]).showGrade, false);
  for (const result of [gradeEligibility(population(10, 100)), gradeEligibility([])])
    assert.equal(result.state, "not_gradeable");
});

test("no spend baseline is undefined coverage, never zero percent", () => {
  for (const list of [
    [],
    [unscored("Zero spend", 0)],
    [scored("Negative", -500)],
    [{ id: "missing", name: "Missing spend", mix: { highValue: 1 }, sampling: { status: "available", sampledQueries: 10 } }],
    [{ id: "nan", name: "NaN spend", spendUsd: Number.NaN, mix: { highValue: 1 }, sampling: { status: "available", sampledQueries: 10 } }],
  ]) {
    const result = gradeEligibility(list);
    assert.equal(result.coverage, null, `coverage for ${JSON.stringify(list)}`);
    assert.equal(result.tier, "no_baseline");
    assert.equal(result.state, "not_gradeable");
    assert.equal(result.showGrade, false);
    assert.equal(result.reason, "no_spend_baseline");
  }
});

test("coverage above the baseline is clamped and reported, never accepted", () => {
  const coverage = sampledSpendCoverage({ coveredUsd: 150, totalUsd: 100 });
  assert.equal(coverage.ratio, 1);
  assert.equal(coverage.clamped, true);
  const result = gradeEligibilityFromCoverage(coverage);
  assert.equal(result.coverage, 1);
  assert.equal(result.reason, CLAMPED_REASON);
  // The tier is still computed and still shown; only the reason records the bug.
  assert.equal(result.tier, "high");
  assert.equal(result.tierReason, "sufficient_coverage");
});

test("the metric never divides by a missing or non-positive denominator", () => {
  for (const totalUsd of [0, -1, undefined, Number.NaN, "not a number"]) {
    const coverage = sampledSpendCoverage({ coveredUsd: 10, totalUsd });
    assert.equal(coverage.ratio, null, `total ${String(totalUsd)}`);
    assert.equal(coverage.clamped, false);
  }
});

test("coverage is weighted by spend, not by department or query count", () => {
  // One scored department holding $40,000 outranks five unscored departments
  // holding $1,000 between them, even though the sample is one row of six.
  const list = [
    scored("Data & ML", 40_000, { sampledQueries: 12 }),
    ...["A", "B", "C", "D", "E"].map((name) => unscored(name, 200)),
  ];
  const result = gradeEligibility(list);
  assert.equal(result.coverage, 40_000 / 41_000);
  assert.equal(result.tier, "high");
});

test("the action names the grouping value whose uncovered spend is largest", () => {
  const result = gradeEligibility([
    scored("Backend Platform", 30_000),
    unscored("Security Engineering", 25_000),
    unscored("Mobile", 40_000),
    unscored("QA & Release", 5_000),
  ]);
  assert.equal(result.nextAction.kind, "widen_group");
  assert.equal(result.nextAction.group, "Mobile");
  assert.equal(result.nextAction.uncoveredUsd, 40_000);
  assert.match(result.nextAction.text, /^Widen the sample for Mobile: /);
});

test("equal uncovered spend breaks the tie lexicographically, every time", () => {
  const list = [
    scored("Covered", 40_000),
    unscored("Zephyr", 30_000),
    unscored("Atlas", 30_000),
  ];
  const first = gradeEligibility(list);
  const reversed = gradeEligibility([...list].reverse());
  assert.equal(first.nextAction.group, "Atlas");
  assert.equal(reversed.nextAction.group, "Atlas");
});

test("with no grouping value in the data the action is the generic widen", () => {
  const result = gradeEligibility([
    scored("Covered", 20_000),
    { spendUsd: 60_000, mix: { highValue: 1 }, sampling: { status: "unavailable", sampledQueries: 0 } },
  ]);
  assert.equal(result.nextAction.kind, "widen");
  assert.equal(result.nextAction.group, null);
});

test("with no baseline the action is to import billing data", () => {
  const action = gradeEligibility([]).nextAction;
  assert.equal(action.kind, "import_billing");
  assert.equal(action.available, true);
  assert.equal(action.control, "local-finops-files");
});

test("high coverage still carries exactly one action, typed the same way", () => {
  const action = gradeEligibility(population(95, 100)).nextAction;
  assert.equal(action.kind, "none");
  assert.deepEqual(Object.keys(action).sort(),
    Object.keys(gradeEligibility(population(30, 100)).nextAction).sort());
  // Never a list: callers render one sentence and never branch on absence.
  assert.equal(typeof action.text, "string");
});

test("every result carries a machine-readable reason and a human label", () => {
  for (const coveredUsd of [95, 60, 30, 10]) {
    const result = gradeEligibility(population(coveredUsd, 100));
    assert.match(result.reason, /^[a-z]+(_[a-z]+)*$/);
    assert.equal(result.version, "sampled-spend-coverage/1.0.0");
    assert.ok(result.label.length > 0);
    // The label is display copy; it must not be mistaken for the contract.
    assert.notEqual(result.label, result.reason);
  }
});

test("the published thresholds are the ones the tiers are read with", () => {
  assert.deepEqual(COVERAGE_TIERS.map((entry) => [entry.tier, entry.floor]), [
    ["high", 0.80], ["moderate", 0.50], ["provisional", 0.25], ["insufficient", 0],
  ]);
});
