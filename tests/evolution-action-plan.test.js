import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { recommendationFor, recoverableSpendUsd } from "../src/evolution.js";

const fixture = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8",
));
const plan = fixture.actionPlan;
const departments = new Map(fixture.departments.map((item) => [item.id, item]));
const evidence = new Map(fixture.evidence.map((item) => [item.sampleId, item]));
const periods = new Map(plan.benchmarkPeriods.map((item) => [item.periodId, item]));

test("the product-consumed action plan is versioned and states its deterministic contract", () => {
  assert.equal(plan.schemaVersion, "action-plan/1.0.0");
  assert.match(plan.provenance, /synthetic/i);
  assert.match(plan.eligibilityRule, /available sampling/i);
  assert.match(plan.orderingRule, /priorityRank/);
  assert.deepEqual(Object.keys(plan.metricDefinitions), ["recoverable_spend_usd"]);
  assert.equal(plan.metricDefinitions.recoverable_spend_usd.unit, "USD");
  assert.match(plan.metricDefinitions.recoverable_spend_usd.calculation, /0\.70/);
  assert.match(plan.metricDefinitions.recoverable_spend_usd.comparisonRule, /same formula/i);
});

test("benchmark periods are unique, equal length, contiguous where measurement follows baseline, and reuse fixture dates", () => {
  assert.equal(periods.size, plan.benchmarkPeriods.length);
  for (const period of plan.benchmarkPeriods) {
    const inclusiveDays = (Date.parse(period.endDate) - Date.parse(period.startDate)) / 86_400_000 + 1;
    assert.equal(inclusiveDays, period.inclusiveDays, period.periodId);
    assert.equal(period.inclusiveDays, 31, period.periodId);
  }

  const baseline = periods.get("period-2026-06-25-2026-07-25");
  const historical = periods.get("period-2026-05-25-2026-06-24");
  const after = periods.get("period-2026-07-26-2026-08-25");
  assert.ok(fixture.departments.every((item) => item.period === baseline.label));
  assert.ok(fixture.departments.every((item) => item.previousPeriod.period === historical.label));
  assert.equal(Date.parse(after.startDate) - Date.parse(baseline.endDate), 86_400_000);
});

test("each action has required ownership, evidence, confidence, rationale, metrics, and valid references", () => {
  const actionIds = new Set();
  for (const action of plan.actions) {
    assert.ok(action.actionId);
    assert.ok(!actionIds.has(action.actionId), action.actionId);
    actionIds.add(action.actionId);

    const department = departments.get(action.departmentId);
    assert.ok(department, `${action.actionId} department`);
    assert.equal(action.departmentName, department.name);
    assert.equal(action.accountableRole, department.leader);
    assert.ok(action.action);
    assert.ok(action.rationale);
    assert.ok(action.savingsCalculationBasis);
    assert.ok(Number.isInteger(action.estimatedSavingsUsd));
    assert.ok(action.estimatedSavingsUsd >= 0);
    assert.ok(action.confidence.value >= 0 && action.confidence.value <= 1);
    assert.equal(action.confidence.scale, "0_to_1");
    assert.ok(action.confidence.provenance);
    assert.ok(action.evidenceRefs.length > 0);
    for (const evidenceRef of action.evidenceRefs)
      assert.equal(evidence.get(evidenceRef)?.departmentId, action.departmentId, evidenceRef);

    for (const periodRef of Object.values(action.benchmarkPeriodRefs))
      assert.ok(periods.has(periodRef), `${action.actionId} ${periodRef}`);
    for (const measurement of [
      action.baseline, action.target, action.tracking.before, action.tracking.after,
    ]) {
      assert.equal(measurement.metricName, "recoverable_spend_usd");
      assert.equal(measurement.unit, "USD");
      assert.ok(periods.has(measurement.periodRef), `${action.actionId} ${measurement.periodRef}`);
    }
    assert.equal(action.baseline.periodRef, action.benchmarkPeriodRefs.baseline);
    assert.equal(action.target.periodRef, action.benchmarkPeriodRefs.after);
    assert.deepEqual(action.tracking.before, {
      ...action.baseline, status: "observed",
    });
    assert.equal(action.tracking.after.value, null);
    assert.equal(action.tracking.after.status, "pending");
    assert.equal(action.tracking.after.periodRef, action.target.periodRef);
  }
});

test("money and targets use the established recoverability semantics exactly", () => {
  for (const action of plan.actions) {
    const department = departments.get(action.departmentId);
    assert.equal(action.baseline.value, recoverableSpendUsd(department), action.actionId);
    assert.equal(action.estimatedSavingsUsd, recommendationFor(department).lostUsd, action.actionId);
    assert.equal(action.target.value,
      action.baseline.value - action.estimatedSavingsUsd, action.actionId);
    assert.ok(action.target.value >= 0);
    assert.equal(action.target.comparison, "less_than_or_equal");
  }
});

test("eligible evidence-backed departments get exactly one unambiguous top action in stable order", () => {
  const eligibleDepartmentIds = fixture.departments
    .filter((department) => department.sampling.status === "available"
      && fixture.evidence.some((item) => item.departmentId === department.id))
    .map((department) => department.id);
  assert.deepEqual(plan.actions.map((action) => action.departmentId), eligibleDepartmentIds);

  for (const departmentId of eligibleDepartmentIds) {
    const actions = plan.actions.filter((action) => action.departmentId === departmentId);
    assert.equal(actions.filter((action) => action.isTopNextAction).length, 1);
    assert.equal(actions.filter((action) => action.priorityRank === 1).length, 1);
    const ordered = [...actions].sort((left, right) =>
      left.priorityRank - right.priorityRank || left.actionId.localeCompare(right.actionId));
    assert.deepEqual(actions, ordered);
    assert.equal(actions[0].isTopNextAction, true);
  }

  assert.ok(!plan.actions.some((action) => action.departmentId === "mobile"),
    "mobile has no retained evidence and must not receive invented support");
  assert.ok(!plan.actions.some((action) => action.departmentId === "security"),
    "security sampling is unavailable and must not receive an evidence-backed action");
});
