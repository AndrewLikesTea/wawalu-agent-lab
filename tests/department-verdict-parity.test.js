// One department, one period, one verdict — whichever screen it is read on.
//
// A CTO forwarded a department deep link has no way to check it against the
// organization-wide review, so the two must be provably identical rather than
// plausibly similar. Every assertion below is three-way: the DEPARTMENT
// SCREEN'S RENDERED TEXT, the ORGANIZATION-WIDE REVIEW'S OWN FIELDS, and the
// COMMITTED PIN in src/department-verdict-fixtures.js. A change to one side
// alone reds this file; a change to both sides still has to answer to the pin.
//
// The cells are the committed fixture's — two synthetic departments across two
// periods — served to the shipped page as its analysis, so the values under
// assertion are the ones a reader would actually see.
//
// HARNESS. This is a DOM double, not a browser: no `assert.equal(node, null)`,
// no `querySelectorAll("*")`, no descendant selectors, properties rather than
// reflected attributes, and `!node.open` for a shut disclosure. The verdict
// slots sit outside every disclosure, so no text asserted here is read through
// a fold.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import { scoreDepartmentIntervention } from "../src/department-intervention-scoring.js";
import { interventionActionFields } from "../src/department-intervention-view.js";
import {
  DEPARTMENT_VERDICT_FIXTURES,
  VERDICT_FIXTURES_VERSION,
  VERDICT_WEIGHT_ASSUMPTIONS,
} from "../src/department-verdict-fixtures.js";
import { VERDICT_RUBRIC_SENTENCE, departmentVerdict } from "../src/department-verdict.js";

const PAGE = new URL("../src/departments.html", import.meta.url);
const DATA_URL = "/evolution-demo-data.json";

/** The fixture cells, served to the page exactly as the bundled analysis is. */
const ANALYSIS = { departments: DEPARTMENT_VERDICT_FIXTURES.map((cell) => cell.record) };

const shown = (document, id) => textOf(document.getElementById(id));
const addressOf = (cell) => `?department=${cell.record.departmentId}&period=${cell.record.periodId}`;

/** Open the shipped screen on one cell and read what it painted. */
async function render(cell) {
  const page = await loadPage(PAGE, {
    routes: { [DATA_URL]: ANALYSIS },
    location: { search: addressOf(cell) },
  });
  try {
    const module = await importPageModule("/department-screen-page.js");
    await module.ready;
    return {
      state: page.document.getElementById("department-answer").getAttribute("data-state"),
      verdict: shown(page.document, "department-verdict-value"),
      confidence: shown(page.document, "department-verdict-confidence"),
      evidence: shown(page.document, "department-verdict-evidence"),
      basis: shown(page.document, "department-verdict-basis"),
      action: shown(page.document, "department-action-text"),
      main: textOf(page.document.getElementById("main-content")),
    };
  } finally {
    page.restore();
  }
}

/**
 * The organization-wide review's own answer for the same record.
 *
 * These are the exact call and the exact arguments src/evolution-page.js makes
 * when it paints `#action-result`, so this is the org path's output rather than
 * a test's restatement of it.
 */
const orgReview = (cell) =>
  interventionActionFields(scoreDepartmentIntervention(cell.record), cell.record);

const capitalized = (value) => `${value[0].toUpperCase()}${value.slice(1)}`;

/* --------------------------------- parity --------------------------------- */

for (const cell of DEPARTMENT_VERDICT_FIXTURES) {
  test(`parity: the screen, the org review and the pin agree on ${cell.cellId}`, async () => {
    const screen = await render(cell);
    const org = orgReview(cell);
    const scored = scoreDepartmentIntervention(cell.record);
    const { expect } = cell;

    assert.equal(screen.state, "resolved", `${cell.cellId}: the screen never resolved`);

    // Verdict string: rendered, org-rendered, and pinned.
    assert.equal(screen.verdict, expect.verdict,
      `${cell.cellId}: the RENDERED VERDICT drifted from the committed expectation`);
    assert.equal(org.title, expect.verdict,
      `${cell.cellId}: the ORG REVIEW'S VERDICT drifted from the committed expectation`);
    assert.equal(screen.verdict, org.title,
      `${cell.cellId}: the screen and the org review state different verdicts`);

    // Confidence value: the level word, and the whole line beneath it.
    const level = expect.confidence === "not_scored" ? "Not scored" : capitalized(expect.confidence);
    assert.ok(org.confidence.startsWith(level),
      `${cell.cellId}: the ORG REVIEW'S CONFIDENCE is not "${level}" but "${org.confidence}"`);
    assert.equal(screen.confidence, `Confidence: ${org.confidence}`,
      `${cell.cellId}: the screen's CONFIDENCE line is not the org review's`);
    assert.equal(departmentVerdict(cell.record).confidence, expect.confidence,
      `${cell.cellId}: the CONFIDENCE VALUE drifted from the committed expectation`);

    // Evidence count: the same number on both surfaces and in the pin.
    const counted = expect.evidenceCount.toLocaleString("en-US");
    assert.equal(scored.provenance.sampledQueries, expect.evidenceCount,
      `${cell.cellId}: the EVIDENCE COUNT drifted from the committed expectation`);
    assert.ok(screen.evidence.includes(`${counted} scored prompt`),
      `${cell.cellId}: the screen's EVIDENCE COUNT is not ${counted}: "${screen.evidence}"`);
    assert.ok(org.provenance.includes(`${counted} scored prompt`),
      `${cell.cellId}: the ORG REVIEW'S EVIDENCE COUNT is not ${counted}`);

    // Rubric identity, pinned alongside the numbers it produced.
    assert.equal(expect.rubricBasisId, "spend-intervention",
      `${cell.cellId}: the pinned RUBRIC BASIS is not the one the screen states`);
    assert.ok(screen.basis.includes(`${expect.rubricBasisId} rubric, version ${expect.rubricVersion}`),
      `${cell.cellId}: the screen's RUBRIC LINE is "${screen.basis}"`);
  });
}

test("every weight and threshold the verdict rule reads carries a stated assumption", () => {
  const required = [
    "attainment.routing", "attainment.access_policy", "attainment.rewrite",
    "attainment.training_gap", "recoverable.overProvisioned", "recoverable.inefficient",
    "recoverable.outOfScope", "recoverable.highValue", "evidenceFloor",
    "materialityFloorUsd", "ambiguityRelativeMargin", "ambiguityAbsoluteMarginUsd",
    "daysPerMonth", "confidence.sampleHigh", "confidence.sampleMedium",
    "confidence.separationHigh", "confidence.separationMedium", "confidence.rule",
  ];
  const stated = new Map(VERDICT_WEIGHT_ASSUMPTIONS.map((row) => [row.key, row]));
  for (const key of required) {
    const row = stated.get(key);
    assert.ok(row, `no assumption is stated for the weight or threshold "${key}"`);
    assert.notEqual(row.value, undefined, `"${key}" states an assumption but pins no value`);
    assert.ok(row.assumption.length > 40,
      `"${key}" states an assumption too short to disagree with: "${row.assumption}"`);
  }
  assert.equal(stated.size, required.length,
    "the assumption table names a weight the required list does not");
  assert.match(VERDICT_FIXTURES_VERSION, /^department-verdict-fixtures\/\d+\.\d+\.\d+$/);
});

test("the fixture covers at least two departments across two periods", () => {
  const departments = new Set(DEPARTMENT_VERDICT_FIXTURES.map((cell) => cell.record.departmentId));
  const periods = new Set(DEPARTMENT_VERDICT_FIXTURES.map((cell) => cell.record.periodId));
  assert.ok(departments.size >= 2, `only ${departments.size} department is pinned`);
  assert.ok(periods.size >= 2, `only ${periods.size} period is pinned`);
  assert.ok(DEPARTMENT_VERDICT_FIXTURES.length >= departments.size * periods.size,
    "the pinned cells do not cover every department across every period");
});

/* ---------------------- determinism across entry points ---------------------- */

test("a cold deep link and an arrival from the org answer produce the same verdict", async () => {
  // Two entry orders, in one process, on one cell. "Reached by navigating from
  // the org answer" is modelled as the organization-wide review running for the
  // same department and period BEFORE the screen's entry module is imported —
  // which is what that navigation does — plus a second screen opened first, so
  // a module that memoized the previous department would be caught here rather
  // than by a reader.
  const cell = DEPARTMENT_VERDICT_FIXTURES[0];
  const other = DEPARTMENT_VERDICT_FIXTURES[2];

  const cold = await render(cell);

  const org = orgReview(cell);
  const afterOrgAnswer = await render(cell);

  await render(other);
  const afterAnotherDepartment = await render(cell);

  for (const [order, painted] of [
    ["reached from the org answer", afterOrgAnswer],
    ["opened after another department", afterAnotherDepartment],
  ]) {
    assert.equal(painted.verdict, cold.verdict, `${order}: the VERDICT differs from a cold deep link`);
    assert.equal(painted.confidence, cold.confidence, `${order}: the CONFIDENCE differs from a cold deep link`);
    assert.equal(painted.evidence, cold.evidence, `${order}: the EVIDENCE COUNT differs from a cold deep link`);
    assert.equal(painted.action, cold.action, `${order}: the NEXT MOVE differs from a cold deep link`);
  }
  assert.equal(cold.verdict, org.title, "a cold deep link states a verdict the org review does not");
});

/* ------------------------------ state leakage ------------------------------ */

test("opening one department leaves nothing of it on the next department's screen", async () => {
  // A recommended cell with a large sample, then a cell with no verdict at all
  // and twelve scored prompts. If any of the first survives, it survives here.
  const first = DEPARTMENT_VERDICT_FIXTURES[0];
  const second = DEPARTMENT_VERDICT_FIXTURES[3];

  const before = await render(first);
  await render(first);
  const after = await render(second);

  assert.equal(after.verdict, second.expect.verdict,
    "the second department's VERDICT is not its own");
  assert.ok(!after.verdict.includes(before.verdict),
    `the first department's verdict survived: "${after.verdict}"`);
  assert.ok(after.evidence.includes("12 scored prompt"),
    `the second department's EVIDENCE COUNT is not its own: "${after.evidence}"`);
  assert.ok(!after.evidence.includes(first.expect.evidenceCount.toLocaleString("en-US")),
    `the first department's evidence count survived: "${after.evidence}"`);
  assert.ok(!after.confidence.startsWith("Confidence: High"),
    `the first department's confidence survived: "${after.confidence}"`);
  assert.ok(!after.action.includes("down-routing"),
    `the first department's next move survived: "${after.action}"`);

  // And the whole rendered screen carries no trace of the department before it.
  assert.ok(!after.main.includes(first.record.name),
    "the previous department's name is still on the screen");
});

/* ----------------------------- vocabulary guard ---------------------------- */

test("the screen states the rubric in a reader's words and names no file, module or fixture", async () => {
  const forbidden = [
    /\.js\b/, /\.json\b/, /\.test\b/, /\bsrc\//, /\btests?\//,
    /department-verdict/, /department-intervention/, /fixtures\//,
    ...DEPARTMENT_VERDICT_FIXTURES.map((cell) => new RegExp(cell.cellId.replace("/", "\\/"))),
    new RegExp(VERDICT_FIXTURES_VERSION.replace(/[/.]/g, "\\$&")),
  ];

  for (const cell of DEPARTMENT_VERDICT_FIXTURES) {
    const screen = await render(cell);
    assert.ok(screen.main.includes("spend-intervention rubric, version 1"),
      `${cell.cellId}: the rubric basis and version are not stated in reader vocabulary`);
    assert.equal(screen.basis, VERDICT_RUBRIC_SENTENCE,
      `${cell.cellId}: the rubric line is "${screen.basis}"`);
    for (const pattern of forbidden) {
      assert.doesNotMatch(screen.main, pattern,
        `${cell.cellId}: an internal identifier reached the reader (${pattern})`);
    }
  }
});

/* ------------------------- the pin is load-bearing ------------------------- */

test("a verdict that disagrees with its committed expectation is withheld, not published", async () => {
  // The guard that makes the pin more than documentation: hand the shared
  // function a record addressed to a pinned cell whose numbers would score
  // differently, and neither surface publishes the number.
  const cell = DEPARTMENT_VERDICT_FIXTURES[0];
  const tampered = { ...cell.record, mix: { highValue: 0.05, overProvisioned: 0.05, inefficient: 0.1, outOfScope: 0.8 } };
  const verdict = departmentVerdict(tampered);
  assert.ok(verdict.withheld, "a verdict that contradicts its committed expectation was published");
  assert.match(verdict.verdict, /^Verdict withheld/);
  assert.equal(verdict.confidence, "withheld");
  assert.equal(interventionActionFields(scoreDepartmentIntervention(tampered), tampered).title,
    verdict.verdict, "the org review published a verdict the pin refused");

  // And an unpinned department is unaffected: no pin is not a failed pin.
  const unpinned = departmentVerdict({ ...cell.record, departmentId: "unpinned-example", id: "unpinned-example" });
  assert.equal(unpinned.withheld, false, "a department with no committed expectation was withheld");
  assert.equal(unpinned.pinned, false);
});
