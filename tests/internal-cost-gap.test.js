// The internal department drill-down of the peer position.
//
// What is pinned here is every decision two engineers could otherwise make
// differently: that the internal metric and the org metric are the same
// function against the same cohort boundaries, which pair a tie resolves to
// regardless of input order, and — the half that actually protects a reader —
// that each of the four suppression outcomes is reached rather than thrown, and
// carries the real numbers in its sentence.
//
// The fixtures are built here rather than committed: every case is the bundled
// example's shape with one thing varied, so a case that stops discriminating is
// visible in the diff.

import test from "node:test";
import assert from "node:assert/strict";
import {
  BAND_ORDER, bandDistanceWords, DEPARTMENT_ROW_SELECTOR, INTERNAL_GAP_STATUS,
  INTERNAL_GAP_SUPPRESSED, INTERNAL_MINIMUM_SUCCESSFUL_TASKS, internalGapDetail,
  internalGapHeadline, resolveInternalCostGap,
} from "../src/internal-cost-gap.js";
import {
  bandFor, COST_BAND, COST_METRIC, COST_POSITION_VERSION, costPerSuccessfulTask,
  PEER_COST_COHORTS,
} from "../src/peer-cost-position.js";
import {
  EXAMPLE_ORG_COHORT_PROFILE, EXAMPLE_TASK_LEDGER, loadExampleDataset,
} from "../src/example-dataset.js";

const ORG = EXAMPLE_ORG_COHORT_PROFILE;

/** The cohort the bundled org is placed in — the boundaries both scopes read. */
const COHORT = PEER_COST_COHORTS.find(
  (entry) => entry.sizeBand === ORG.sizeBand && entry.industry === ORG.industry);

const PERIOD = "2026-06-01 to 2026-07-01";

/** One department row in the shape `local-finops.js` publishes. */
const department = (id, spendUsd, records = 3) => ({ id, name: id, spendUsd, records });

/** One ledger tally, in the shape `example-dataset.js` publishes. */
const successes = (id, count) => ({ [DEPARTMENT_ROW_SELECTOR]: id, outcome: "success", count });

/** An envelope with only the fields this module reads. */
const envelope = (rankedDepartments) => ({
  period: PERIOD,
  spendUsd: rankedDepartments.reduce((sum, item) => sum + item.spendUsd, 0),
  rankedDepartments,
});

/** Spend that lands a department exactly on a chosen metric value. */
const spendFor = (perTask, tasks) => perTask * tasks;

// --- the normal worst-gap case ----------------------------------------------

test("the widest gap is the best and worst eligible department, as one pair", () => {
  // Three bands represented on purpose, so "worst gap" is a real discrimination
  // rather than the only pair available.
  const cheap = spendFor(COHORT.p25 - 2, 100);
  const middle = spendFor((COHORT.p25 + COHORT.p75) / 2, 100);
  const dear = spendFor(COHORT.p75 + 5, 100);
  const gap = resolveInternalCostGap({
    analysis: envelope([
      department("unit-dear", dear), department("unit-cheap", cheap),
      department("unit-middle", middle),
    ]),
    org: ORG,
    tasks: [successes("unit-dear", 100), successes("unit-cheap", 100), successes("unit-middle", 100)],
  });

  assert.equal(gap.status, INTERNAL_GAP_STATUS.finding);
  assert.equal(gap.leader.departmentId, "unit-cheap");
  assert.equal(gap.laggard.departmentId, "unit-dear");
  // One consolidated result, never a list: the middle department is eligible and
  // counted, and it is still not a third entry anywhere in the shape.
  assert.equal(gap.eligibleCount, 3);
  assert.equal(gap.gapBands, BAND_ORDER.indexOf(COST_BAND.bottom) - BAND_ORDER.indexOf(COST_BAND.top));
  assert.equal(gap.gapValue, Math.round((dear / 100 - cheap / 100) * 100) / 100);
  assert.equal(gap.suppressedReason, null);

  // Both sides carry their record counts and their denominators.
  for (const face of [gap.leader, gap.laggard]) {
    assert.equal(face.recordCount, 3);
    assert.equal(face.successfulTasks, 100);
    assert.equal(face.band, bandFor(face.metricValue, COHORT));
  }

  // The provenance is sufficient to re-derive the finding without re-importing.
  assert.equal(gap.provenance.rubricVersion, COST_POSITION_VERSION);
  assert.equal(gap.provenance.metricId, COST_METRIC.id);
  assert.equal(gap.provenance.rowSelector.field, DEPARTMENT_ROW_SELECTOR);
  assert.deepEqual([...gap.provenance.rowSelector.values], ["unit-cheap", "unit-dear"]);
  assert.equal(gap.provenance.rowCount, 2);
  assert.deepEqual({ ...gap.provenance.dateRange }, { start: "2026-06-01", end: "2026-07-01" });
  assert.equal(gap.provenance.cohortId, COHORT.cohortId);
  assert.equal(gap.provenance.snapshotId, COHORT.snapshotId);

  // Recomputing from the provenance alone reproduces both sides' values.
  assert.equal(costPerSuccessfulTask(dear, 100), gap.laggard.metricValue);
  assert.equal(costPerSuccessfulTask(cheap, 100), gap.leader.metricValue);
});

test("the internal metric and the org metric are the same units", () => {
  const gap = resolveInternalCostGap({
    analysis: loadExampleDataset(), org: ORG, tasks: EXAMPLE_TASK_LEDGER,
  });
  assert.equal(gap.status, INTERNAL_GAP_STATUS.finding);
  assert.equal(gap.metric, COST_METRIC);
  assert.equal(gap.provenance.rubricVersion, COST_POSITION_VERSION);
  // The band on each side is exactly what the shared assignment returns for that
  // value against the shared cohort. No local boundary table, no rounding step
  // of its own.
  assert.equal(gap.leader.band, bandFor(gap.leader.metricValue, COHORT));
  assert.equal(gap.laggard.band, bandFor(gap.laggard.metricValue, COHORT));
  assert.ok(gap.gapBands >= 1, "the bundled example produces a real internal gap");
  assert.match(internalGapHeadline(gap), /behind .+ on cost per successful task$/);
  assert.match(internalGapDetail(gap), /successful tasks across \d+ records/);
  assert.match(internalGapDetail(gap), /2026-06-01 to 2026-07-01/);
});

// --- ties --------------------------------------------------------------------

test("a tie resolves the same way whichever order the rows arrive in", () => {
  const cheap = spendFor(COHORT.p25 - 2, 100);
  const dear = spendFor(COHORT.p75 + 5, 100);
  // Two departments tied at the cheap end and two tied at the dear end: every
  // position in the pair is contested, so nothing can be settled by luck.
  const rows = [
    department("unit-b-cheap", cheap), department("unit-a-cheap", cheap),
    department("unit-d-dear", dear), department("unit-c-dear", dear),
  ];
  const tasks = rows.map((row) => successes(row.id, 100));
  const forward = resolveInternalCostGap({ analysis: envelope(rows), org: ORG, tasks });
  const reversed = resolveInternalCostGap({
    analysis: envelope([...rows].reverse()), org: ORG, tasks: [...tasks].reverse(),
  });

  assert.equal(forward.status, INTERNAL_GAP_STATUS.finding);
  // The tie-break is the department id, not the input order: lowest id wins the
  // leader slot and highest id wins the laggard slot, both ways round.
  assert.equal(forward.leader.departmentId, "unit-a-cheap");
  assert.equal(forward.laggard.departmentId, "unit-d-dear");
  assert.deepEqual(
    { leader: reversed.leader.departmentId, laggard: reversed.laggard.departmentId },
    { leader: forward.leader.departmentId, laggard: forward.laggard.departmentId });
  assert.equal(reversed.gapValue, forward.gapValue);
  assert.equal(reversed.gapBands, forward.gapBands);
});

// --- suppression, which is an outcome and not an exception -------------------

test("fewer than two departments over the sample floor suppresses, naming the shortfall", () => {
  const cheap = spendFor(COHORT.p25 - 2, 100);
  const short = INTERNAL_MINIMUM_SUCCESSFUL_TASKS - 8;
  const gap = resolveInternalCostGap({
    analysis: envelope([
      department("unit-cheap", cheap),
      department("unit-platform", spendFor(COHORT.p75 + 5, short)),
    ]),
    org: ORG,
    tasks: [successes("unit-cheap", 100), successes("unit-platform", short)],
  });

  assert.equal(gap.status, INTERNAL_GAP_STATUS.suppressed);
  assert.equal(gap.suppressedCode, INTERNAL_GAP_SUPPRESSED.tooFewEligible);
  assert.equal(gap.leader, null);
  assert.equal(gap.laggard, null);
  assert.equal(gap.gapBands, null);
  // The real threshold value and the real shortfall, in the sentence — not
  // "insufficient data", which tells a reader nothing they can close.
  assert.match(gap.suppressedReason,
    new RegExp(`unit-platform has ${short} successful tasks; ${INTERNAL_MINIMUM_SUCCESSFUL_TASKS} needed\\.`));
  assert.match(gap.suppressedReason,
    new RegExp(`${INTERNAL_MINIMUM_SUCCESSFUL_TASKS}-successful-task floor`));
  assert.equal(gap.minimumSuccessfulTasks, INTERNAL_MINIMUM_SUCCESSFUL_TASKS);
});

test("a spread that never leaves one band is suppressed, not reported as a gap", () => {
  const inside = (COHORT.p25 + COHORT.p75) / 2;
  const gap = resolveInternalCostGap({
    analysis: envelope([
      department("unit-a", spendFor(inside - 0.5, 100)),
      department("unit-b", spendFor(inside + 0.5, 100)),
    ]),
    org: ORG,
    tasks: [successes("unit-a", 100), successes("unit-b", 100)],
  });

  assert.equal(gap.status, INTERNAL_GAP_STATUS.suppressed);
  assert.equal(gap.suppressedCode, INTERNAL_GAP_SUPPRESSED.withinOneBand);
  assert.match(gap.suppressedReason, /sit in the same band \(Middle range\)/);
  assert.match(gap.suppressedReason, /inside one band/);
  // The provenance survives suppression: the rubric and the window are still
  // what a later pass would recompute against.
  assert.equal(gap.provenance.rubricVersion, COST_POSITION_VERSION);
  assert.deepEqual({ ...gap.provenance.dateRange }, { start: "2026-06-01", end: "2026-07-01" });
});

test("a malformed or partial import is suppressed with a reason, never thrown", () => {
  const cases = [
    ["nothing at all", resolveInternalCostGap()],
    ["an empty call", resolveInternalCostGap({})],
    ["no declared org", resolveInternalCostGap({
      analysis: loadExampleDataset(), org: null, tasks: EXAMPLE_TASK_LEDGER,
    })],
    ["no department dimension", resolveInternalCostGap({
      analysis: { period: PERIOD, spendUsd: 1000, rankedDepartments: [] },
      org: ORG,
      tasks: [{ outcome: "success", count: 100 }],
    })],
    ["a ledger with no department selector", resolveInternalCostGap({
      analysis: envelope([department("unit-a", 1000), department("unit-b", 2000)]),
      org: ORG,
      tasks: [{ outcome: "success", count: 100 }],
    })],
    ["rows that are not rows", resolveInternalCostGap({
      analysis: { period: 17, spendUsd: "many", rankedDepartments: [null, 4, { id: 9 }] },
      org: ORG,
      tasks: [null, "success", { outcome: "success", count: -3 }],
    })],
    ["a department with no successes at all", resolveInternalCostGap({
      analysis: envelope([department("unit-a", 1000), department("unit-b", 2000)]),
      org: ORG,
      tasks: [successes("unit-a", 0), successes("unit-b", 0)],
    })],
  ];

  for (const [name, gap] of cases) {
    assert.equal(gap.status, INTERNAL_GAP_STATUS.suppressed, name);
    assert.equal(gap.leader, null, name);
    assert.ok(gap.suppressedCode, `${name} names a code`);
    assert.ok(gap.suppressedReason?.length > 20, `${name} states a readable reason`);
    // "Suppressed" with no reason is not a state this module can reach, and a
    // suppressed result still publishes the rubric it would have used.
    assert.equal(gap.provenance.rubricVersion, COST_POSITION_VERSION);
    assert.equal(gap.provenance.rowSelector.values.length, 0, name);
    assert.equal(internalGapHeadline(gap), null, name);
    assert.equal(internalGapDetail(gap), null, name);
  }

  // The department dimension being absent is its own named cause, distinct from
  // the sample floor: telling a reader their departments are too small when the
  // records carry no department at all is a false statement about their data.
  assert.equal(cases[3][1].suppressedCode, INTERNAL_GAP_SUPPRESSED.noDepartmentField);
  assert.equal(cases[4][1].suppressedCode, INTERNAL_GAP_SUPPRESSED.noDepartmentField);
  // And an undeclared org is the org path's own withholding, quoted verbatim.
  assert.equal(cases[2][1].suppressedCode, INTERNAL_GAP_SUPPRESSED.orgPositionWithheld);
  assert.match(cases[2][1].suppressedReason, /has not declared its size band and industry/);
});

test("the band distance is worded rather than left as an integer for a surface to pluralize", () => {
  assert.equal(bandDistanceWords(1), "a full band");
  assert.equal(bandDistanceWords(2), "2 full bands");
  assert.equal(bandDistanceWords(0), null);
  assert.equal(bandDistanceWords(null), null);
});
