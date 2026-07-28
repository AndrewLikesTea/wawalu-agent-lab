// The words a briefing or evidence panel says when it has no figure.
//
// `briefing-board.test.js` covers the briefing that has an answer in it. These
// cover the states that do not: what a reader is told when the bundled sample
// never loaded, when the period holds no departments, when a department was
// never graded, and when the grade covers only part of the spend.
//
// Two things are asserted about every state, and the second is the point of the
// issue this file was written for:
//
//   1. the named string reaches its real slot in the shipped `evolution.html`,
//      so a state is never an empty region under a heading promising a figure;
//   2. no state says a bare "Unavailable" — every one names the missing input,
//      and every recoverable one names the control that recovers it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  ACTION_UNAVAILABLE_FIELD,
  ACTION_UNAVAILABLE_REASON,
  applyDepartmentDetailState,
  BUNDLED_LOAD_STATE,
  BRIEFING_CONFIDENCE_LABEL,
  BRIEFING_STATE_MESSAGE,
  DEPARTMENT_DETAIL_STATE,
  DEPARTMENT_LIST_MESSAGE,
  EVIDENCE_LIST_MESSAGE,
  EVALUATION_BUNDLE_UNAVAILABLE,
  HEADLINE_BUNDLE_UNAVAILABLE,
  IMPORTED_BRIEFING_EMPTY,
  NO_COMPARABLE_PERIOD,
  NOT_GRADED,
  sampledCoverageLine,
  ungradedCoverageNote,
  ungradedDepartmentList,
} from "../src/briefing-strings.js";
import { BRIEFING_STATE_MESSAGE as FLOW_MESSAGE } from "../src/local-import-flow.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const RETRY_LABEL = "Retry bundled analysis";

/** Every user-facing sentence this module ships, flattened for a sweep. */
function everySentence() {
  const lines = [
    ...Object.values(BRIEFING_STATE_MESSAGE),
    ...Object.values(BRIEFING_CONFIDENCE_LABEL),
    ...Object.values(BUNDLED_LOAD_STATE).flatMap((copy) => Object.values(copy)),
    ...Object.values(DEPARTMENT_LIST_MESSAGE),
    ...Object.values(ACTION_UNAVAILABLE_REASON),
    ...Object.values(HEADLINE_BUNDLE_UNAVAILABLE),
    ...Object.values(IMPORTED_BRIEFING_EMPTY),
    NO_COMPARABLE_PERIOD,
    EVIDENCE_LIST_MESSAGE.noneRetained,
    EVALUATION_BUNDLE_UNAVAILABLE,
    EVIDENCE_LIST_MESSAGE.ungraded("No eligible scored sample for this period"),
  ];
  for (const copy of Object.values(DEPARTMENT_DETAIL_STATE)) {
    lines.push(copy.name, copy.sample);
  }
  return lines;
}

test("no state sentence falls back to a bare 'Unavailable'", () => {
  for (const line of everySentence()) {
    assert.equal(typeof line, "string");
    assert.ok(line.trim().length > 0, "a state with an empty sentence is an empty region");
    assert.notEqual(line.trim(), "Unavailable");
    assert.doesNotMatch(line, /^Unavailable\b/,
      `"${line}" opens on a word that names neither the missing input nor a next step`);
  }
});

test("the failed-load states name the retry control by its own label", () => {
  for (const line of [
    DEPARTMENT_DETAIL_STATE.bundleUnavailable.sample,
    DEPARTMENT_LIST_MESSAGE.bundleUnavailable,
    ACTION_UNAVAILABLE_REASON.bundleUnavailable,
    HEADLINE_BUNDLE_UNAVAILABLE.provenance,
    HEADLINE_BUNDLE_UNAVAILABLE.portfolioReason,
    BUNDLED_LOAD_STATE.firstFailure.detail,
    BUNDLED_LOAD_STATE.refreshFailure.detail,
  ]) {
    assert.match(line, /bundled sample|Bundled sample/, `"${line}" does not name the missing input`);
    assert.ok(line.includes(RETRY_LABEL), `"${line}" does not name the control that recovers it`);
  }
});

test("the empty states name the missing input and one next action", () => {
  // No department records: the input is the period, and the action is the one
  // control on this page that produces departments of the reader's own.
  assert.match(DEPARTMENT_DETAIL_STATE.noDepartments.sample, /no department records/);
  assert.match(DEPARTMENT_DETAIL_STATE.noDepartments.sample, /Import a provider export/);
  assert.match(DEPARTMENT_LIST_MESSAGE.noDepartments, /no department records/);
  assert.match(DEPARTMENT_LIST_MESSAGE.noDepartments, /Import a provider export/);
  // No briefing yet: name the absent provider export and the single action.
  assert.match(BRIEFING_STATE_MESSAGE.empty, /Import a provider export/);
  assert.doesNotMatch(BRIEFING_STATE_MESSAGE.empty, /\bor\b/);
  assert.match(BRIEFING_STATE_MESSAGE.error, /Check the column mapping/);
  // An ungraded department is not a broken one, and the evidence list says so
  // rather than reading as a failure.
  const ungraded = EVIDENCE_LIST_MESSAGE.ungraded("Fewer than 30 scored queries");
  assert.match(ungraded, /^Not graded, so there is no scored evidence to show\./);
  assert.match(ungraded, /Fewer than 30 scored queries\./);
  assert.match(ungraded, /Import a provider export with eligible sampling metadata/);
  // A reason that arrived without one still ends as a sentence.
  assert.match(EVIDENCE_LIST_MESSAGE.ungraded("No eligible sample."), /No eligible sample\./);
  assert.match(EVIDENCE_LIST_MESSAGE.ungraded(""), /no eligible sample for this period\./);
});

test("a slot with no value names the input it lacks, not its own absence", () => {
  // A department slot: the import carried no department column, which is a fact
  // about the file rather than a fault in the product.
  assert.match(IMPORTED_BRIEFING_EMPTY.department, /^No department attributed$/);
  assert.match(IMPORTED_BRIEFING_EMPTY.benchmarkSummary, /No compatible peer cohort/);
  // A comparison row: which half is missing, not one word for both halves.
  assert.equal(NO_COMPARABLE_PERIOD, "No comparable period");
});

test("the score slot says what it is instead of what it is not", () => {
  assert.equal(NOT_GRADED, "Not graded");
  for (const key of ["noDepartments", "bundleUnavailable"]) {
    assert.equal(DEPARTMENT_DETAIL_STATE[key].score, NOT_GRADED);
  }
});

test("an unavailable action names each missing figure separately", () => {
  const measures = [
    ACTION_UNAVAILABLE_FIELD.impact, ACTION_UNAVAILABLE_FIELD.confidence,
    ACTION_UNAVAILABLE_FIELD.baseline, ACTION_UNAVAILABLE_FIELD.target,
    ACTION_UNAVAILABLE_FIELD.estimate, ACTION_UNAVAILABLE_FIELD.realized,
  ];
  for (const measure of measures) assert.doesNotMatch(measure, /Unavailable/);
  // A reader scanning the list can tell an unestimated action from an
  // unsimulated one, which one repeated word never allowed.
  assert.ok(new Set(measures).size >= 5, "the measurement slots repeat one word");
});

// --- partial coverage -------------------------------------------------------

test("partial coverage names the ungraded departments and what their absence costs", () => {
  const note = ungradedCoverageNote(["Support", "Legal"]);
  assert.match(note, /Not graded: Support, Legal\./);
  assert.match(note, /Their spend was not scored/);
  assert.match(note, /cannot be read as a verdict on the whole organization/);

  const line = sampledCoverageLine({
    coverageText: "37.5%",
    label: "Partial · provisional grade",
    ungradedNames: ["Support", "Legal"],
  });
  assert.match(line, /^37\.5% of spend scored · Partial · provisional grade\./);
  assert.ok(line.includes(note), "the coverage line drops the confidence limitation");
});

test("a fully graded import gains no ungraded sentence", () => {
  const line = sampledCoverageLine({ coverageText: "100.0%", label: "Available · high confidence" });
  assert.equal(line, "100.0% of spend scored · Available · high confidence");
  assert.equal(ungradedCoverageNote([]), "");
  assert.equal(ungradedDepartmentList([]), "");
  // Blanks and non-strings are not departments and are never named as one.
  assert.equal(ungradedDepartmentList([" ", null, 7]), "");
});

test("an import with no spend denominator states the tier without a percentage", () => {
  assert.equal(
    sampledCoverageLine({ label: "Needs review · no spend baseline" }),
    "Needs review · no spend baseline",
  );
});

test("the named list is capped and the overflow is counted, never dropped", () => {
  const names = ["Support", "Legal", "Design", "Ops", "Sales"];
  assert.equal(ungradedDepartmentList(names), "Support, Legal, Design, and 2 more");
  assert.equal(ungradedDepartmentList(names.slice(0, 3)), "Support, Legal, Design");
  assert.match(ungradedCoverageNote(names), /and 2 more\./);
});

// --- the strings reach the shipped page -------------------------------------

test("each department-detail state renders its named string into the real slots", async () => {
  const { document } = await loadPage(PAGE);
  for (const [key, copy] of Object.entries(DEPARTMENT_DETAIL_STATE)) {
    const applied = applyDepartmentDetailState(document, key);
    assert.equal(applied, copy, `${key} was not applied`);
    for (const [id, expected] of [["detail-name", copy.name], ["detail-score", copy.score],
      ["detail-sample", copy.sample]]) {
      const node = document.getElementById(id);
      assert.ok(node, `#${id} is missing from evolution.html`);
      assert.equal(textOf(node), expected, `#${id} does not say the ${key} string`);
      assert.ok(textOf(node).trim().length > 0, `#${id} is an empty region in ${key}`);
    }
  }
  // The panel keeps its heading and its landmark through every state: a state
  // with no figure is the same region saying a different sentence.
  assert.ok(document.getElementById("department-detail"));
  assert.equal(document.getElementById("detail-name").tagName, "H3");
});

test("an unknown state paints nothing rather than blanking the panel", async () => {
  const { document } = await loadPage(PAGE);
  applyDepartmentDetailState(document, "loading");
  assert.equal(applyDepartmentDetailState(document, "not-a-state"), null);
  assert.equal(applyDepartmentDetailState(null, "loading"), null);
  assert.equal(textOf(document.getElementById("detail-name")), DEPARTMENT_DETAIL_STATE.loading.name);
});

test("the page ships the loading copy this module authors", async () => {
  const html = await readFile(PAGE, "utf8");
  assert.ok(html.includes(DEPARTMENT_DETAIL_STATE.loading.name));
  assert.ok(html.includes(DEPARTMENT_DETAIL_STATE.loading.sample));
  // The label the recovery copy points at has to exist, spelled that way.
  assert.ok(html.includes(`>${RETRY_LABEL}</button>`));
});

test("the import flow re-exports this copy rather than keeping its own", () => {
  assert.equal(FLOW_MESSAGE, BRIEFING_STATE_MESSAGE);
});

test("the state copy is plain text, never markup", () => {
  for (const line of everySentence()) assert.doesNotMatch(line, /[<>&]/);
});

// --- the real page ----------------------------------------------------------
//
// The blocks above prove the strings exist and reach the slots. These drive the
// shipped `evolution.html` with the shipped entry module, so a string that is
// correct in isolation and never painted by the page still fails.

const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

/** The one department the bundled sample never scored. */
const UNGRADED = "Security Engineering";

test("the coverage line on the shipped page names the department that was not graded", async () => {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");

  const coverage = textOf(document.getElementById("score-coverage"));
  assert.match(coverage, /of spend scored/);
  assert.ok(coverage.includes(`Not graded: ${UNGRADED}.`),
    `the coverage line does not name the ungraded department: "${coverage}"`);
  assert.match(coverage, /this grade describes the scored spend only/);

  // Selecting that department reads the same way in the detail panel: a score
  // slot that says what it is, and an evidence list that says why it is empty.
  const choice = document.querySelectorAll(".department-choice")
    .find((button) => textOf(button).includes(UNGRADED));
  assert.ok(choice, "the ungraded department is missing from the priority list");
  choice.click();
  assert.equal(textOf(document.getElementById("detail-score")), NOT_GRADED);
  const evidence = textOf(document.getElementById("department-evidence"));
  assert.match(evidence, /^Not graded, so there is no scored evidence to show\./);
  assert.match(evidence, /omitted sampling metadata/);
});

test("a bundled sample that never loads names the file and the retry control", async () => {
  // The executive fixture arrives; the bundled analysis does not.
  const page = await loadPage(PAGE, { routes: { "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES } });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.getElementById("finops-load-state")?.dataset.state === "error",
    "the load state to give up");

  for (const [id, expected] of [
    ["detail-name", DEPARTMENT_DETAIL_STATE.bundleUnavailable.name],
    ["detail-score", DEPARTMENT_DETAIL_STATE.bundleUnavailable.score],
    ["detail-sample", DEPARTMENT_DETAIL_STATE.bundleUnavailable.sample],
    ["department-priority", DEPARTMENT_LIST_MESSAGE.bundleUnavailable],
    ["action-rationale", ACTION_UNAVAILABLE_REASON.bundleUnavailable],
    ["action-diagnosis", ACTION_UNAVAILABLE_REASON.bundleUnavailable],
    ["finops-provenance", HEADLINE_BUNDLE_UNAVAILABLE.provenance],
    ["score-value", HEADLINE_BUNDLE_UNAVAILABLE.score],
    ["score-peer", HEADLINE_BUNDLE_UNAVAILABLE.peer],
    ["portfolio-count", HEADLINE_BUNDLE_UNAVAILABLE.portfolioCount],
  ]) {
    const node = document.getElementById(id);
    assert.ok(node, `#${id} is missing from evolution.html`);
    assert.equal(textOf(node), expected, `#${id} does not say its failed-load string`);
  }
  // The four KPI slots stop saying a word that names nothing.
  for (const id of ["kpi-spend-value", "kpi-recoverable-value", "kpi-productive-value", "kpi-peer-value"]) {
    assert.equal(textOf(document.getElementById(id)), "Not loaded");
  }
  // The panel keeps its heading and its landmark through the failure.
  assert.ok(document.getElementById("department-decision-panel"));
  assert.ok(textOf(document.getElementById("department-title")).length > 0);
});
