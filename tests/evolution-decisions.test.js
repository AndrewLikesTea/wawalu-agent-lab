import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  actionPlanFor, benchmarkComparison, departmentPerformance, departmentTrend,
  evidenceForDepartment, rankDepartmentsForHelp,
} from "../src/evolution.js";

const department = (overrides = {}) => ({
  id: "quality", name: "QA & Release", spendUsd: 12_000, periodDays: 30,
  period: "1–30 Jun 2026",
  mix: { highValue: 0.4, overProvisioned: 0.3, inefficient: 0.2, outOfScope: 0.1 },
  sampling: { status: "available", sampledQueries: 100, sampledThrough: "2026-06-30" },
  previousPeriod: { period: "2–31 May 2026", spendUsd: 10_000, score: 70 },
  ...overrides,
});

test("a leader gets one reproducible department score and uncertainty", () => {
  const result = departmentPerformance(department());
  assert.deepEqual(result, {
    available: true, score: 64, uncertaintyPoints: 6.6, reason: null,
    rubricVersion: "literacy-mix/1.0.0",
  });
});

test("a leader sees benchmark difference only for a compatible eligible score", () => {
  const benchmark = { medianScore: 61, rubricVersion: "literacy-mix/1.0.0" };
  assert.deepEqual(benchmarkComparison(department(), benchmark),
    { available: true, deltaPoints: 3, reason: null });
  assert.match(benchmarkComparison(department(), { ...benchmark, rubricVersion: "2.0.0" }).reason,
    /does not match/);
});

test("a leader can tell when cost and performance jointly worsen across equal periods", () => {
  assert.deepEqual(departmentTrend(department()), {
    period: "1–30 Jun 2026", comparisonPeriod: "2–31 May 2026", equalLengthDays: 30,
    costChangePercent: 20, performanceChangePoints: -6,
    costAvailable: true, performanceAvailable: true, worsening: true,
  });
  const noBasis = departmentTrend(department({ previousPeriod: { period: "prior", spendUsd: 0 } }));
  assert.equal(noBasis.costChangePercent, null);
  assert.equal(noBasis.worsening, null);
});

test("department drill-down never leaks another department's evidence", () => {
  const evidence = [
    { id: "a", departmentId: "quality" },
    { id: "b", departmentId: "backend" },
    { id: "c", departmentId: "quality" },
  ];
  assert.deepEqual(evidenceForDepartment(evidence, "quality").map((item) => item.id), ["a", "c"]);
  assert.deepEqual(evidenceForDepartment(evidence, "missing"), []);
  assert.deepEqual(evidenceForDepartment(evidence), []);
});

test("a department exposes one truthful action result and only completed simulations realize savings", () => {
  const planned = actionPlanFor(department({
    actionPlan: {
      status: "planned", title: "Down-route simple work", baselineUsd: 4000,
      targetUsd: 1500, estimatedSavingsUsd: 2500, realizedSavingsUsd: 2000,
    },
  }));
  assert.equal(planned.statusLabel, "Planned");
  assert.equal(planned.estimatedSavingsUsd, 2500);
  assert.equal(planned.realizedSavingsUsd, null);

  const completed = actionPlanFor(department({
    actionPlan: {
      status: "completed", title: "Down-route simple work", baselineUsd: 4000,
      targetUsd: 1500, estimatedSavingsUsd: 2500, realizedSavingsUsd: 2200,
    },
  }));
  assert.equal(completed.statusLabel, "Simulation completed");
  assert.equal(completed.realizedSavingsUsd, 2200);
});

test("a missing or unavailable action never implies a result", () => {
  assert.deepEqual(actionPlanFor(department()), {
    available: false, status: "unavailable", statusLabel: "Result unavailable",
    reason: "No reviewed intervention is included in this static fixture.",
    realizedSavingsUsd: null,
  });
  assert.match(actionPlanFor(department({
    actionPlan: { status: "unavailable", unavailableReason: "Sample omitted." },
  })).reason, /omitted/);
});

test("unavailable sampling is not converted into poor performance or a benchmark claim", () => {
  const unavailable = department({
    id: "missing", mix: {}, sampling: {
      status: "unavailable", sampledQueries: 0, reason: "Provider export omitted sampling metadata.",
    },
  });
  assert.deepEqual(departmentPerformance(unavailable), {
    available: false, score: null, uncertaintyPoints: null,
    reason: "Provider export omitted sampling metadata.", rubricVersion: "literacy-mix/1.0.0",
  });
  assert.equal(benchmarkComparison(unavailable,
    { medianScore: 61, rubricVersion: "literacy-mix/1.0.0" }).available, false);
  assert.deepEqual(rankDepartmentsForHelp([unavailable, department()]).map((item) => item.id),
    ["quality", "missing"]);
});

test("the bundled decision surface explains empty evidence and unavailable sampling", async () => {
  const [page, script, strings, fixtureText] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/briefing-strings.js", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"),
  ]);
  const fixture = JSON.parse(fixtureText);
  assert.match(page, /Which department needs help\?/);
  assert.match(page, /Priority 01 · recommended intervention/);
  assert.match(page, /<details class="evidence-disclosure">/);
  // The authored rationale states what is missing rather than narrating a read:
  // only #finops-load-state may say a load is in progress. See
  // tests/finops-load-status.test.js.
  assert.match(page, /No intervention has been prioritized from the bundled example yet\. No live analysis is running\./);
  assert.ok(page.indexOf("Which department needs help?")
    < page.indexOf("Is cost/performance worsening?"));
  assert.ok(page.indexOf("Is cost/performance worsening?")
    < page.indexOf("How does it compare with the peer benchmark?"));
  // The two empty-evidence sentences live in briefing-strings.js, with every
  // other state string this page paints; the page module only chooses between
  // them. `briefing-strings.test.js` covers what they say.
  assert.match(strings, /retains no per-query evidence rows/);
  assert.match(strings, /no scored evidence to show/);
  assert.match(script, /Not yet simulated/);
  assert.ok(fixture.departments.some((item) => item.sampling.status === "unavailable"));
  assert.ok(fixture.departments.some((item) =>
    item.actionPlan.status === "completed"
    && Number.isFinite(item.actionPlan.realizedSavingsUsd)));
  assert.ok(fixture.departments.some((item) => item.actionPlan.status === "unavailable"));
  assert.ok(fixture.departments.some((item) =>
    item.sampling.status === "available"
    && evidenceForDepartment(fixture.evidence, item.id).length === 0));
});
