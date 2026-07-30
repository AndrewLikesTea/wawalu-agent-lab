// Where an organization's AI spend ranks, not what it costs.
//
// What is pinned here is every decision two engineers could otherwise make
// differently: which tasks reach the denominator, what happens at the exact p25
// and p75 boundaries, when a position is withheld and under which sentence, and
// whether anything a visitor imports can reach the published cohort table.
//
// The cohorts are reference data, so the fixture invariants are tested as
// fixture invariants — a record that publishes p25 at or above p75 is a bug in
// the file, and it fails here rather than producing a band nobody can defend.

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublishableCostCohorts, costCohortProblem, ORG_SIZE_BAND, PEER_COST_COHORTS,
  PEER_COST_SNAPSHOT_ID,
} from "../src/peer-cost-cohorts.js";
import {
  bandFor, COST_BAND, COST_BAND_LABEL, COST_METRIC, COST_POSITION_QUESTION,
  COST_POSITION_REASON, COST_POSITION_WITHHELD, costPerSuccessfulTask, countSuccessfulTasks,
  displayCostPerSuccessfulTask, matchingCostCohorts, PEER_INDUSTRY, resolveCostPosition,
  TASK_NON_TERMINAL_OUTCOME, TASK_OUTCOME,
} from "../src/peer-cost-position.js";
import {
  EXAMPLE_ORG_COHORT_PROFILE, EXAMPLE_TASK_LEDGER, loadExampleDataset,
} from "../src/example-dataset.js";
import { buildFirstRunResult } from "../src/finops-first-run.js";

/** The cohort the bundled example is placed in, by its declared attributes. */
const EXAMPLE_COHORT = PEER_COST_COHORTS.find(
  (entry) => entry.sizeBand === EXAMPLE_ORG_COHORT_PROFILE.sizeBand
    && entry.industry === EXAMPLE_ORG_COHORT_PROFILE.industry);

const task = (outcome, count) => ({ outcome, count });

/** One org that matches a published cohort, so a case can vary one thing at a time. */
const ORG = Object.freeze({
  sizeBand: ORG_SIZE_BAND.enterprise,
  industry: PEER_INDUSTRY.saas,
  snapshotId: PEER_COST_SNAPSHOT_ID,
});

/** Spend that lands the metric exactly on a chosen value, given 100 successes. */
const spendFor = (perTask) => perTask * 100;
const HUNDRED_SUCCESSES = Object.freeze([task(TASK_OUTCOME.success, 100)]);

// --- the published reference data -------------------------------------------

test("every published cohort declares two attributes and p25 strictly below p75", () => {
  assert.ok(PEER_COST_COHORTS.length >= 2, "one row would make matching a fallback, not a lookup");
  for (const cohort of PEER_COST_COHORTS) {
    assert.equal(costCohortProblem(cohort), null, cohort.cohortId);
    assert.ok(cohort.p25 < cohort.p75, cohort.cohortId);
    assert.equal(cohort.snapshotId, PEER_COST_SNAPSHOT_ID, cohort.cohortId);
  }
});

test("a cohort record with p25 at or above p75 is rejected as a fixture bug", () => {
  const broken = { ...PEER_COST_COHORTS[0], cohortId: "cost-broken", p25: 40, p75: 40 };
  assert.match(costCohortProblem(broken), /p25 strictly below p75/);
  assert.throws(() => assertPublishableCostCohorts([broken]), /p25 strictly below p75/);
  // Strictly, not loosely: an inverted pair is a bug too.
  assert.match(costCohortProblem({ ...broken, p25: 41, p75: 40 }), /p25 strictly below p75/);
});

test("two cohorts on one segment are rejected, because they would withhold every position", () => {
  const twin = { ...PEER_COST_COHORTS[0], cohortId: "cost-twin" };
  assert.throws(() => assertPublishableCostCohorts([PEER_COST_COHORTS[0], twin]),
    /two cohorts published for segment/);
});

test("exactly one published cohort matches any declared pair of attributes", () => {
  for (const cohort of PEER_COST_COHORTS) {
    assert.equal(matchingCostCohorts(cohort.sizeBand, cohort.industry).length, 1, cohort.cohortId);
  }
});

// --- the denominator --------------------------------------------------------

test("only terminal successes reach the denominator; failures keep their spend in the numerator", () => {
  const ledger = [
    task(TASK_OUTCOME.success, 60),
    task(TASK_OUTCOME.failed, 30),
    task(TASK_OUTCOME.abandoned, 10),
    task(TASK_NON_TERMINAL_OUTCOME.running, 25),
    task(TASK_NON_TERMINAL_OUTCOME.queued, 5),
  ];
  assert.equal(countSuccessfulTasks(ledger), 60);
  // The spend is unchanged by which tasks succeeded — that is the whole point
  // of the metric, so it is asserted rather than assumed: 100 tasks were paid
  // for and 60 of them worked.
  assert.equal(costPerSuccessfulTask(6000, countSuccessfulTasks(ledger)), 100);
});

test("a row with no count is one task, so a record list and a tally agree", () => {
  assert.equal(countSuccessfulTasks([
    { taskId: "syn-task-1", outcome: TASK_OUTCOME.success },
    { taskId: "syn-task-2", outcome: TASK_OUTCOME.success },
    { taskId: "syn-task-3", outcome: TASK_OUTCOME.failed },
  ]), 2);
  assert.equal(countSuccessfulTasks([task(TASK_OUTCOME.success, 2)]), 2);
});

test("an unrecognised outcome is not a success and is not quietly a failure either", () => {
  assert.equal(countSuccessfulTasks([task("succeeded", 40), task(TASK_OUTCOME.success, 1)]), 1);
  assert.equal(countSuccessfulTasks(null), 0);
});

test("the metric is undefined rather than zero or infinite when nothing succeeded", () => {
  assert.equal(costPerSuccessfulTask(154_500, 0), null);
  assert.equal(costPerSuccessfulTask(154_500, -1), null);
  assert.equal(costPerSuccessfulTask(Number.NaN, 10), null);
});

test("the value is computed at full precision and rounded only for display", () => {
  const value = costPerSuccessfulTask(154_500, 4_000);
  assert.equal(value, 38.625);
  assert.equal(displayCostPerSuccessfulTask(value), "$38.63");
});

// --- the bands, at their exact boundaries -----------------------------------

test("p25 is inclusive on the favorable side: exactly p25 is the top quartile", () => {
  const cohort = { p25: 18.40, p75: 31.50 };
  assert.equal(bandFor(18.40, cohort), COST_BAND.top);
  assert.equal(bandFor(18.399999, cohort), COST_BAND.top);
  assert.equal(bandFor(18.400001, cohort), COST_BAND.middle);
});

test("p75 is inclusive on the unfavorable side: exactly p75 is the bottom quartile", () => {
  const cohort = { p25: 18.40, p75: 31.50 };
  assert.equal(bandFor(31.50, cohort), COST_BAND.bottom);
  assert.equal(bandFor(31.499999, cohort), COST_BAND.middle);
  assert.equal(bandFor(31.500001, cohort), COST_BAND.bottom);
});

test("the middle range is the open interval strictly between the two boundaries", () => {
  const cohort = { p25: 10, p75: 20 };
  assert.equal(bandFor(15, cohort), COST_BAND.middle);
  assert.equal(bandFor(0.01, cohort), COST_BAND.top);
  assert.equal(bandFor(1_000, cohort), COST_BAND.bottom);
  // No value is claimed by two bands, and none by none.
  for (const value of [9.99, 10, 10.01, 19.99, 20, 20.01]) {
    assert.ok(Object.values(COST_BAND).includes(bandFor(value, cohort)), String(value));
  }
});

test("a resolved position reads its band from the unrounded value", () => {
  // Rounds to $18.40, which is p25 — but it is above p25 unrounded, so it is
  // the middle range. Rounding must not move a value across a boundary.
  const position = resolveCostPosition({
    org: ORG, spendUsd: spendFor(18.404), tasks: HUNDRED_SUCCESSES,
  });
  assert.equal(position.valueDisplay, "$18.40");
  assert.equal(position.band, COST_BAND.middle);
});

test("the top quartile is the cheapest and the copy never lets a high number read as good", () => {
  const position = resolveCostPosition({
    org: ORG, spendUsd: spendFor(9.10), tasks: HUNDRED_SUCCESSES,
  });
  assert.equal(position.band, COST_BAND.top);
  assert.equal(position.bandLabel, COST_BAND_LABEL[COST_BAND.top]);
  assert.match(position.direction, /Lower cost per successful task is better/);
  assert.match(position.bandMeaning, /cheapest/);
});

// --- withholding ------------------------------------------------------------

test("a withheld position carries a null band and a reason, never a band value", () => {
  const position = resolveCostPosition({ org: null, spendUsd: 100, tasks: HUNDRED_SUCCESSES });
  assert.equal(position.available, false);
  assert.equal(position.band, null);
  assert.equal(position.bandLabel, null);
  assert.ok(position.reason.length > 0);
  assert.equal(position.reason, COST_POSITION_REASON[COST_POSITION_WITHHELD.missingAttributes]);
});

test("each withholding cause has its own sentence, and the first failing condition wins", () => {
  const cases = [
    ["missing attributes", { org: { snapshotId: PEER_COST_SNAPSHOT_ID } },
      COST_POSITION_WITHHELD.missingAttributes],
    ["no matching cohort", {
      org: { ...ORG, sizeBand: ORG_SIZE_BAND.mid, industry: PEER_INDUSTRY.financialServices },
    }, COST_POSITION_WITHHELD.noMatchingCohort],
    ["snapshot mismatch", { org: { ...ORG, snapshotId: "1999-01-01" } },
      COST_POSITION_WITHHELD.snapshotMismatch],
    ["no successful tasks", {
      org: ORG,
      tasks: [task(TASK_OUTCOME.failed, 90), task(TASK_NON_TERMINAL_OUTCOME.running, 10)],
    }, COST_POSITION_WITHHELD.noSuccessfulTasks],
  ];
  for (const [name, input, code] of cases) {
    const position = resolveCostPosition({
      spendUsd: 154_500, tasks: HUNDRED_SUCCESSES, ...input,
    });
    assert.equal(position.available, false, name);
    assert.equal(position.reasonCode, code, name);
    assert.equal(position.reason, COST_POSITION_REASON[code], name);
    assert.doesNotMatch(position.reason, /^Unavailable$/, name);
  }
});

test("an ambiguous match is reported as ambiguity, not as no match", () => {
  // The shipped table publishes one cohort per segment, so ambiguity is proved
  // against the rule rather than against a fixture that cannot produce it.
  const twin = { ...PEER_COST_COHORTS[0], cohortId: "cost-twin" };
  assert.throws(() => assertPublishableCostCohorts([PEER_COST_COHORTS[0], twin]));
  assert.equal(COST_POSITION_REASON[COST_POSITION_WITHHELD.ambiguousMatch],
    "No peer position: more than one published cohort matches this org's size band and industry.");
});

test("a missing spend total is not reported as a missing denominator", () => {
  const position = resolveCostPosition({ org: ORG, spendUsd: null, tasks: HUNDRED_SUCCESSES });
  assert.equal(position.reasonCode, COST_POSITION_WITHHELD.noSpendTotal);
  assert.notEqual(position.reasonCode, COST_POSITION_WITHHELD.noSuccessfulTasks);
});

test("the bare word Unavailable is not a reason this contract can emit", () => {
  for (const reason of Object.values(COST_POSITION_REASON)) {
    assert.match(reason, /^No peer position: /);
    assert.notEqual(reason, "Unavailable");
  }
});

// --- reference data is unmovable --------------------------------------------

test("nothing a caller passes can add to, replace, or move the cohort table", () => {
  const before = JSON.stringify(PEER_COST_COHORTS);
  const hostile = {
    org: { ...ORG, cohorts: [{ cohortId: "imported", sizeBand: ORG.sizeBand, industry: ORG.industry, p25: 1, p75: 2, snapshotId: PEER_COST_SNAPSHOT_ID }] },
    spendUsd: spendFor(38.63),
    tasks: HUNDRED_SUCCESSES,
    // Every plausible name an import could smuggle a table in under. None of
    // them is a parameter of this contract, so none of them is read.
    cohorts: [{ cohortId: "imported", p25: 900, p75: 1_000 }],
    peerCostCohorts: [{ cohortId: "imported", p25: 900, p75: 1_000 }],
    PEER_COST_COHORTS: [{ cohortId: "imported", p25: 900, p75: 1_000 }],
  };
  const position = resolveCostPosition(hostile);
  assert.equal(position.cohort.cohortId, EXAMPLE_COHORT.cohortId);
  assert.equal(position.cohort.p25, EXAMPLE_COHORT.p25);
  assert.equal(JSON.stringify(PEER_COST_COHORTS), before, "the table did not move");
});

test("the cohort table is frozen, so a direct write cannot alter it either", () => {
  assert.ok(Object.isFrozen(PEER_COST_COHORTS));
  assert.ok(PEER_COST_COHORTS.every((entry) => Object.isFrozen(entry)));
  assert.throws(() => { PEER_COST_COHORTS[0].p25 = 0.01; }, TypeError);
  assert.throws(() => { PEER_COST_COHORTS.push({ cohortId: "imported" }); }, TypeError);
});

// --- the bundled example, on first load -------------------------------------

test("the bundled example declares both cohort attributes and matches one cohort", () => {
  assert.ok(EXAMPLE_COHORT, "the seeded profile must match a published cohort");
  assert.equal(EXAMPLE_ORG_COHORT_PROFILE.snapshotId, PEER_COST_SNAPSHOT_ID);
  assert.equal(matchingCostCohorts(
    EXAMPLE_ORG_COHORT_PROFILE.sizeBand, EXAMPLE_ORG_COHORT_PROFILE.industry).length, 1);
});

test("the bundled example resolves to the bottom quartile on first load", () => {
  const analysis = loadExampleDataset();
  const position = resolveCostPosition({
    org: EXAMPLE_ORG_COHORT_PROFILE,
    spendUsd: analysis.spendUsd,
    tasks: EXAMPLE_TASK_LEDGER,
  });
  assert.equal(position.available, true);
  assert.equal(position.band, COST_BAND.bottom);
  assert.equal(position.successfulTasks, 4_000);
  // The numerator is the page's own headline spend total, unchanged.
  assert.equal(position.spendUsd, analysis.spendUsd);
  assert.equal(position.value, analysis.spendUsd / 4_000);
  assert.ok(position.value >= position.cohort.p75, "bottom quartile is at or above p75");
});

test("the non-terminal rows in the seeded ledger move nothing", () => {
  const terminalOnly = EXAMPLE_TASK_LEDGER.filter(
    (row) => !Object.values(TASK_NON_TERMINAL_OUTCOME).includes(row.outcome));
  assert.ok(terminalOnly.length < EXAMPLE_TASK_LEDGER.length, "the fixture carries running tasks");
  assert.equal(countSuccessfulTasks(terminalOnly), countSuccessfulTasks(EXAMPLE_TASK_LEDGER));
});

test("the answer card's comparison slot states band, metric to cents, and cohort", () => {
  const result = buildFirstRunResult();
  assert.equal(result.peer.available, true);
  assert.match(result.peer.value, /^Bottom quartile · \$\d+\.\d{2} per successful task$/);
  // The cohort is named in words a leader can repeat to a peer without hunting.
  assert.match(result.peer.detail, /Enterprise · 2,000\+ employees/);
  assert.match(result.peer.detail, /Software-as-a-service/);
  assert.match(result.peer.detail, /Lower cost per successful task is better/);
});

test("an analysis with no declared attributes is withheld with the reason that says so", () => {
  const analysis = loadExampleDataset();
  const position = resolveCostPosition({ spendUsd: analysis.spendUsd, tasks: EXAMPLE_TASK_LEDGER });
  assert.equal(position.available, false);
  assert.equal(position.reason,
    "No peer position: this org has not declared its size band and industry.");
});

test("the contract answers one question and publishes one metric", () => {
  assert.equal(COST_POSITION_QUESTION,
    "Among comparable organizations, is this org's cost per successful task high or low?");
  assert.equal(COST_METRIC.id, "cost_per_successful_task");
  assert.equal(COST_METRIC.unit, "USD per successful task");
  assert.equal(COST_METRIC.decimals, 2);
});
