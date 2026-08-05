// Scoring last period's registered routing rules against the following period's
// import. Every assertion below is an EXACT value — a verdict string, a dollar
// figure, a threshold — because the point of the module is that two reviewers
// reading the same fixture reach the same four verdicts. A range would pass while
// a boundary moved.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AGGREGATE_RULE, MET_TOLERANCE_PERCENT, MISSED_FLOOR_USD, ROUTING_RULE_SCORE_REASONS,
  RULE_VERDICT, scoreRoutingRules, unitSeriesFromAnalysis,
} from "../src/routing-rule-score.js";
import { routingSlate } from "../src/routing-slate.js";
import { validateMonthlyActionRecord } from "../src/monthly-department-action-store.js";
import {
  commitmentRecord, followUpExport, priorPolicy,
} from "./fixtures/routing-rule-score/shipped-policy.js";

const score = () => scoreRoutingRules({
  priorAnalysis: priorPolicy(),
  unitSeries: followUpExport(),
  commitment: commitmentRecord(),
});

const ruleFor = (payload, unit) => payload.rules.find((row) => row.unit === unit);

test("the fixture commitment is a record the product would actually have retained", () => {
  assert.equal(validateMonthlyActionRecord(commitmentRecord()).ok, true);
});

test("the scored rules are the ones the routing slate registered, in its order", () => {
  const registered = routingSlate(priorPolicy(), { commitment: commitmentRecord() }).rules;
  const payload = score();
  assert.deepEqual(payload.rules.map((row) => row.unit), registered.map((row) => row.unit));
  assert.deepEqual(payload.rules.map((row) => row.rank), [1, 2, 3, 4]);
  assert.equal(payload.priorPeriod, "2026-07");
  assert.equal(payload.followUpPeriod, "2026-08");
});

test("a rule that returned what it promised is met, at the stated threshold", () => {
  const row = ruleFor(score(), "Atlas Platform");
  assert.equal(row.verdict, RULE_VERDICT.met);
  assert.equal(row.verdict, "met");
  assert.equal(row.expectedSavings, 400);
  assert.equal(row.observedSavings, 400);
  assert.equal(row.threshold, 380);
  assert.equal(row.basis, "rule:Atlas Platform@Atlas Platform|periods:2026-07->2026-08");
  assert.equal(row.missingCoverage, null);
});

test("a rule that moved spend but fell short is partially met", () => {
  const row = ruleFor(score(), "Boreal Systems");
  assert.equal(row.verdict, "partially-met");
  assert.equal(row.expectedSavings, 200);
  assert.equal(row.observedSavings, 100);
  assert.equal(row.threshold, 190);
  assert.equal(row.basis, "rule:Boreal Systems@Boreal Systems|periods:2026-07->2026-08");
});

test("a rule whose spend rose is missed, at the floor rather than clamped to zero", () => {
  const row = ruleFor(score(), "Cirrus Data");
  assert.equal(row.verdict, "missed");
  assert.equal(row.expectedSavings, 160);
  assert.equal(row.observedSavings, -100);
  assert.equal(row.threshold, MISSED_FLOOR_USD);
  assert.equal(row.threshold, 0);
});

test("a rule with no rows in the follow-up export names the coverage it wanted", () => {
  const row = ruleFor(score(), "Delta Research");
  assert.equal(row.verdict, "not-enough-evidence");
  assert.equal(row.expectedSavings, 120);
  assert.equal(row.observedSavings, null);
  assert.equal(row.threshold, null);
  assert.equal(
    row.missingCoverage,
    'No cost rows for "Delta Research" anywhere in the follow-up export: the 2026-08 import '
    + "carries no series for this org unit, so this rule's observed saving cannot be computed "
    + "at all.",
  );
});

test("a unit present but missing the follow-up month names that month, not the unit", () => {
  const payload = scoreRoutingRules({
    priorAnalysis: priorPolicy(),
    unitSeries: [{ unit: "Atlas Platform", periods: [{ period: "2026-07", total: 5_000 }] }],
    commitment: commitmentRecord(),
  });
  const row = ruleFor(payload, "Atlas Platform");
  assert.equal(row.verdict, "not-enough-evidence");
  assert.equal(
    row.missingCoverage,
    'The series for "Atlas Platform" carries no rows for 2026-08, so there is no total to '
    + "measure this rule's saving down to.",
  );
});

test("no rule without evidence carries a numeric observed figure or threshold", () => {
  const payload = score();
  for (const row of payload.rules) {
    if (row.verdict !== "not-enough-evidence") continue;
    assert.equal(row.observedSavings, null);
    assert.equal(row.threshold, null);
    assert.equal(typeof row.missingCoverage, "string");
    assert.ok(row.missingCoverage.length > 0);
  }
  // And the converse: every scored rule carries both, so no row is a blank cell.
  for (const row of payload.rules.filter((entry) => entry.verdict !== "not-enough-evidence")) {
    assert.equal(typeof row.observedSavings, "number");
    assert.equal(typeof row.threshold, "number");
  }
});

test("the aggregate excludes absent evidence and reports it separately", () => {
  const payload = score();
  assert.equal(payload.aggregate, "partially-met");
  assert.equal(payload.scoredCount, 3);
  assert.equal(payload.notEnoughEvidenceCount, 1);
  assert.equal(payload.aggregateRule, AGGREGATE_RULE);
  assert.match(payload.aggregateRule, /excluded from this verdict/);
});

test("all rules met is met; all missed is missed; nothing scorable is no evidence", () => {
  const met = scoreRoutingRules({
    priorAnalysis: priorPolicy(),
    commitment: commitmentRecord(),
    unitSeries: followUpExport().map((entry) => ({
      ...entry,
      periods: [entry.periods[0], { period: "2026-08", total: 0 }],
    })),
  });
  assert.equal(met.aggregate, "met");
  assert.equal(met.notEnoughEvidenceCount, 1);

  const missed = scoreRoutingRules({
    priorAnalysis: priorPolicy(),
    commitment: commitmentRecord(),
    unitSeries: followUpExport().map((entry) => ({
      ...entry,
      periods: [entry.periods[0], { period: "2026-08", total: entry.periods[0].total }],
    })),
  });
  assert.equal(missed.aggregate, "missed");

  const none = scoreRoutingRules({
    priorAnalysis: priorPolicy(), commitment: commitmentRecord(), unitSeries: [],
  });
  assert.equal(none.aggregate, "not-enough-evidence");
  assert.equal(none.scoredCount, 0);
  assert.equal(none.notEnoughEvidenceCount, 4);
});

test("the met tolerance is applied at its boundary, on both sides", () => {
  const at = (total) => ruleFor(scoreRoutingRules({
    priorAnalysis: priorPolicy(),
    commitment: commitmentRecord(),
    unitSeries: [{ unit: "Atlas Platform", periods: [
      { period: "2026-07", total: 5_000 }, { period: "2026-08", total }] }],
  }), "Atlas Platform");
  assert.equal(MET_TOLERANCE_PERCENT, 95);
  // Exactly 380 observed against a 400 expectation is 95%: inclusive, so met.
  assert.equal(at(4_620).observedSavings, 380);
  assert.equal(at(4_620).verdict, "met");
  assert.equal(at(4_620.01).verdict, "partially-met");
  // One cent of saving is still a saving, so the missed floor is not reached.
  assert.equal(at(4_999.99).verdict, "partially-met");
  assert.equal(at(5_000).verdict, "missed");
  assert.equal(at(5_000).observedSavings, 0);
});

test("no commitment means no window, and the panel says so rather than scoring", () => {
  const payload = scoreRoutingRules({ priorAnalysis: priorPolicy(), unitSeries: followUpExport() });
  assert.equal(payload.available, false);
  assert.equal(payload.reason, ROUTING_RULE_SCORE_REASONS.no_commitment);
  assert.deepEqual(payload.rules, []);
  assert.equal(payload.priorPeriod, null);
});

test("a prior period that registered no rule is not scored as a failure", () => {
  const payload = scoreRoutingRules({
    priorAnalysis: { period: "2026-07-01 to 2026-08-01", rankedDepartments: [] },
    unitSeries: followUpExport(),
    commitment: commitmentRecord(),
  });
  assert.equal(payload.available, false);
  assert.equal(payload.reason, ROUTING_RULE_SCORE_REASONS.no_rules);
  assert.equal(payload.aggregate, "not-enough-evidence");
});

test("the per-unit series read off an envelope drops units with no usable trend", () => {
  const analysis = {
    rankedDepartments: [
      { name: "Atlas Platform", spendUsd: 4_600, previousSpendUsd: 5_000, trendAvailable: true },
      { name: "Delta Research", spendUsd: 900, previousSpendUsd: null, trendAvailable: false },
    ],
  };
  const series = unitSeriesFromAnalysis(analysis,
    { priorPeriod: "2026-07", followUpPeriod: "2026-08" });
  assert.deepEqual(series.map((entry) => entry.unit), ["Atlas Platform"]);
  assert.deepEqual(series[0].periods, [
    { period: "2026-07", total: 5_000 }, { period: "2026-08", total: 4_600 },
  ]);
});
