import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SavingsActionError, createSavingsActionStore, savingsVariance,
} from "../src/savings-actions.js";

const fixtureText = await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8",
);
const fixture = JSON.parse(fixtureText);

test("the static fixture produces deterministic prioritized actions and periods", () => {
  const first = createSavingsActionStore(fixture);
  const second = createSavingsActionStore(JSON.parse(fixtureText));
  assert.deepEqual(first.selectReportingPeriods(), second.selectReportingPeriods());
  assert.deepEqual(first.selectPrioritizedActions(), second.selectPrioritizedActions());
  assert.deepEqual(
    first.selectPrioritizedActions().map(({ actionId }) => actionId),
    second.selectPrioritizedActions().map(({ actionId }) => actionId),
  );
});

test("actions retain diagnosis, ownership, metrics, confidence, and provenance", () => {
  const action = createSavingsActionStore(fixture).selectPrioritizedActions("quality")[0];
  assert.equal(action.departmentId, "quality");
  assert.ok(action.diagnosis);
  assert.ok(action.evidenceRefs.length);
  assert.ok(action.accountableRole);
  assert.ok(action.baseline.value > action.target.value);
  assert.ok(action.estimatedImpactUsd > 0);
  assert.equal(action.realizedImpact, null);
  assert.equal(action.status, "planned");
  assert.ok(action.confidence.provenance);
  assert.match(action.provenance.plan, /synthetic/i);
});

test("only planned to in-progress to completed is valid", () => {
  const store = createSavingsActionStore(fixture);
  const actionId = store.selectPrioritizedActions()[0].actionId;
  assert.equal(store.transition(actionId, "in_progress").status, "in_progress");
  const completed = store.transition(actionId, "completed", { value: 4_870 });
  assert.equal(completed.status, "completed");
  assert.equal(completed.realizedImpact.value, 4_870);
  assert.throws(() => store.transition(actionId, "planned"),
    (error) => error instanceof SavingsActionError && error.code === "INVALID_TRANSITION");
});

test("estimated-versus-realized variance is explicit and deterministic", () => {
  assert.deepEqual(savingsVariance(5_214, 4_870), { amountUsd: 344, percent: 6.6 });
  assert.deepEqual(savingsVariance(2_000, 2_400), { amountUsd: -400, percent: -20 });
  assert.deepEqual(savingsVariance(0, 0), { amountUsd: 0, percent: null });
});

test("missing results stay missing and cannot complete an action", () => {
  const store = createSavingsActionStore(fixture);
  const actionId = store.selectPrioritizedActions()[0].actionId;
  assert.equal(store.varianceFor(actionId), null);
  store.transition(actionId, "in_progress");
  assert.throws(() => store.transition(actionId, "completed"),
    (error) => error instanceof SavingsActionError && error.code === "MISSING_RESULT");
  assert.equal(store.selectAction(actionId).status, "in_progress");
  assert.equal(store.selectAction(actionId).realizedImpact, null);
});

test("every action must reference an existing department-scoped diagnosis", () => {
  const broken = structuredClone(fixture);
  broken.actionPlan.actions[0].evidenceRefs = ["missing-evidence"];
  assert.throws(() => createSavingsActionStore(broken),
    (error) => error instanceof SavingsActionError && error.code === "MISSING_DIAGNOSIS");
});
