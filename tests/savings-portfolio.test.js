import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SAVINGS_LIFECYCLE_STATES,
  SavingsPortfolioValidationError,
  createSavingsPortfolio,
  validateSavingsAction,
} from "../src/savings-portfolio.js";

const fixtureText = await readFile(
  new URL("../src/savings-portfolio-fixture.json", import.meta.url), "utf8",
);
const fixture = JSON.parse(fixtureText);

/** Select by lifecycle, never by index: fixture order is not part of the contract. */
function fixtureAction(lifecycleState) {
  const action = fixture.actions.find((item) => item.lifecycleState === lifecycleState);
  assert.ok(action, `fixture must contain a ${lifecycleState} action`);
  return structuredClone(action);
}

/** Minimal valid action; overrides isolate the one rule under test. */
function syntheticAction(overrides = {}) {
  return {
    actionId: "syn-example",
    title: "Synthetic example action",
    owner: "Synthetic Example Role",
    department: { id: "alpha", name: "Alpha" },
    lifecycleState: "planned",
    projectedSavingsUsd: 10,
    realizedSavingsUsd: null,
    verificationEvidence: [],
    confidence: 0.5,
    updatedDate: "2026-07-20",
    ...overrides,
  };
}

function portfolioOf(...actions) {
  return createSavingsPortfolio({ schemaVersion: fixture.schemaVersion, actions });
}

const sumBy = (items, key) => items.reduce((total, item) => total + item[key], 0);

test("the synthetic fixture validates every required action field and lifecycle", () => {
  const portfolio = createSavingsPortfolio(fixture);
  assert.equal(portfolio.actions.length, 4);
  for (const action of portfolio.actions) {
    assert.ok(action.owner);
    assert.ok(action.department.id);
    assert.ok(action.updatedDate);
    assert.ok(Number.isInteger(action.projectedSavingsUsd));
    assert.ok(action.confidence >= 0 && action.confidence <= 1);
  }
});

test("the fixture exercises every lifecycle state the contract defines", () => {
  // Guards the acceptance criterion directly: dropping a state from the fixture
  // would otherwise leave planned/in-progress/completed/verified untested.
  const present = new Set(fixture.actions.map((action) => action.lifecycleState));
  assert.deepEqual([...present].sort(), [...SAVINGS_LIFECYCLE_STATES].sort());
});

test("the shipped fixture stays synthetic, with no credentials or live-provider data", () => {
  const forbidden = [
    [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "an email address"],
    [/https?:\/\//i, "a live URL"],
    [/\b(?:sk|pk|ghp|xox[bp])[-_][A-Za-z0-9]{8,}/, "a credential-shaped token"],
    [/\b(?:api[_-]?key|secret|password|bearer|authorization)\b/i, "a credential field"],
    [/\b(?:openai|anthropic|aws|azure|gcp|snowflake|databricks)\b/i, "a live provider name"],
    [/\b\d{3}-\d{2}-\d{4}\b/, "a government identifier"],
  ];
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(fixtureText), false, `fixture must not contain ${label}`);
  }
  for (const action of fixture.actions) {
    assert.match(action.owner, /^Synthetic /,
      "owners must be synthetic roles, never named people");
  }
});

test("realized savings is credited only for verified outcomes with evidence", () => {
  const portfolio = createSavingsPortfolio(fixture);
  assert.equal(portfolio.summary.projectedSavingsUsd, 294000);
  assert.equal(portfolio.summary.realizedSavingsUsd, 21000);
  assert.equal(portfolio.summary.varianceUsd, -273000);

  const completed = fixtureAction("completed");
  completed.realizedSavingsUsd = 70000;
  assert.throws(() => validateSavingsAction(completed),
    (error) => error instanceof SavingsPortfolioValidationError
      && error.path.endsWith("realizedSavingsUsd"));

  const verified = fixtureAction("verified");
  verified.verificationEvidence = [];
  assert.throws(() => validateSavingsAction(verified), /require evidence/);
});

test("each action carries its own credited realized amount and variance", () => {
  // Rowan renders per-action rows; deriving these downstream is exactly the
  // interpretation the contract promises to remove.
  const portfolio = createSavingsPortfolio(fixture);
  const verified = portfolio.actions.find((item) => item.lifecycleState === "verified");
  assert.equal(verified.realizedSavingsUsd, 21000);
  assert.equal(verified.creditedRealizedSavingsUsd, 21000);
  assert.equal(verified.varianceUsd, 21000 - verified.projectedSavingsUsd);

  const completed = portfolio.actions.find((item) => item.lifecycleState === "completed");
  assert.equal(completed.realizedSavingsUsd, null, "unmeasured savings stay unmeasured");
  assert.equal(completed.creditedRealizedSavingsUsd, 0, "nothing is credited without evidence");
  assert.equal(completed.varianceUsd, -completed.projectedSavingsUsd);
});

test("action, department, and portfolio levels agree on totals and variance", () => {
  const portfolio = createSavingsPortfolio(fixture);
  const { summary } = portfolio;
  assert.equal(sumBy(portfolio.actions, "projectedSavingsUsd"), summary.projectedSavingsUsd);
  assert.equal(sumBy(portfolio.actions, "creditedRealizedSavingsUsd"), summary.realizedSavingsUsd);
  assert.equal(sumBy(portfolio.actions, "varianceUsd"), summary.varianceUsd);
  assert.equal(sumBy(summary.departments, "projectedSavingsUsd"), summary.projectedSavingsUsd);
  assert.equal(sumBy(summary.departments, "realizedSavingsUsd"), summary.realizedSavingsUsd);
  assert.equal(sumBy(summary.departments, "varianceUsd"), summary.varianceUsd);
});

test("department totals use the same deterministic lifecycle inclusion rules", () => {
  const portfolio = createSavingsPortfolio(fixture);
  const platform = portfolio.summary.departments.find(
    (item) => item.department.id === "platform",
  );
  assert.equal(platform.projectedSavingsUsd, 96000);
  assert.equal(platform.realizedSavingsUsd, 21000);
  assert.equal(platform.varianceUsd, -75000);
  assert.deepEqual(platform.projectedByLifecycleUsd, {
    planned: 0, "in-progress": 0, completed: 72000, verified: 24000,
  });
});

test("the summary is deeply immutable so repeated reads cannot drift", () => {
  const portfolio = createSavingsPortfolio(fixture);
  const [department] = portfolio.summary.departments;
  assert.throws(() => { department.projectedByLifecycleUsd.completed = 0; }, TypeError);
  assert.throws(() => { department.actionCountByLifecycle.verified = 99; }, TypeError);
  assert.throws(() => { portfolio.summary.departments.push({}); }, TypeError);
  assert.throws(() => { portfolio.actions[0].department.name = "Renamed"; }, TypeError);
  assert.throws(() => { portfolio.summary.attention.reasonCode = "none"; }, TypeError);
});

test("attention prioritizes completed claims before larger unfinished exposure", () => {
  const first = createSavingsPortfolio(fixture);
  const second = createSavingsPortfolio(JSON.parse(fixtureText));
  assert.deepEqual(second.summary, first.summary);
  assert.equal(first.summary.attention.department.id, "platform");
  assert.equal(first.summary.attention.reasonCode, "completed-awaiting-verification");
  assert.match(first.summary.attention.explanation, /72000 USD/);
  assert.equal(first.summary.attention.oldestUnverifiedUpdatedDate, "2026-07-18");
});

test("every attention reason code names the amount that earned it", () => {
  const inProgress = portfolioOf(
    syntheticAction({ lifecycleState: "in-progress", projectedSavingsUsd: 4200 }),
  ).summary.attention;
  assert.equal(inProgress.reasonCode, "work-in-progress");
  assert.match(inProgress.explanation, /Alpha/);
  assert.match(inProgress.explanation, /4200 USD/);

  const planned = portfolioOf(
    syntheticAction({ projectedSavingsUsd: 3100 }),
  ).summary.attention;
  assert.equal(planned.reasonCode, "planned-not-started");
  assert.match(planned.explanation, /3100 USD/);
});

test("attention tie-breaks by oldest update before department ID", () => {
  // Equal exposure, different dates: the older unverified claim must win even
  // though its department sorts last alphabetically.
  const byDate = portfolioOf(
    syntheticAction({ actionId: "syn-alpha", updatedDate: "2026-07-20" }),
    syntheticAction({
      actionId: "syn-zulu",
      department: { id: "zulu", name: "Zulu" },
      updatedDate: "2026-01-05",
    }),
  ).summary.attention;
  assert.equal(byDate.department.id, "zulu");
  assert.equal(byDate.oldestUnverifiedUpdatedDate, "2026-01-05");

  const byId = portfolioOf(
    syntheticAction({ actionId: "syn-alpha" }),
    syntheticAction({ actionId: "syn-zulu", department: { id: "zulu", name: "Zulu" } }),
  ).summary.attention;
  assert.equal(byId.department.id, "alpha");
});

test("a fully verified portfolio reports no department needing attention", () => {
  const allVerified = structuredClone(fixture);
  allVerified.actions = allVerified.actions.map((action, index) => ({
    ...action,
    lifecycleState: "verified",
    realizedSavingsUsd: index,
    verificationEvidence: [{
      evidenceId: `syn-evidence-${index}`,
      description: "Synthetic verification comparison.",
    }],
  }));
  assert.equal(createSavingsPortfolio(allVerified).summary.attention, null);
});

test("invalid state, dates, duplicates, and department identity conflicts fail closed", () => {
  const invalidState = fixtureAction("completed");
  invalidState.lifecycleState = "done";
  assert.throws(() => validateSavingsAction(invalidState), /lifecycleState/);

  const invalidDate = fixtureAction("completed");
  invalidDate.updatedDate = "2026-02-30";
  assert.throws(() => validateSavingsAction(invalidDate), /real calendar date/);

  const duplicate = structuredClone(fixture);
  duplicate.actions.push(structuredClone(duplicate.actions[0]));
  assert.throws(() => createSavingsPortfolio(duplicate), /must be unique/);

  const conflictingName = structuredClone(fixture);
  const platform = conflictingName.actions.filter(
    (action) => action.department.id === "platform",
  );
  platform[1].department.name = "Different Platform";
  assert.throws(() => createSavingsPortfolio(conflictingName), /must match/);
});

test("an unusable fixture envelope is rejected before any total is reported", () => {
  assert.throws(() => createSavingsPortfolio({
    schemaVersion: fixture.schemaVersion, actions: [],
  }), /non-empty/);
  assert.throws(() => createSavingsPortfolio({
    schemaVersion: "savings-portfolio/2.0.0", actions: fixture.actions,
  }), /schemaVersion/);
  assert.throws(() => createSavingsPortfolio(null), /fixture/);
});
