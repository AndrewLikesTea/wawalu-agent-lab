// One reproducible confidence grade beside the recoverable figure (#1186).
//
// WHAT THESE ASSERTIONS ARE FOR. A director whose team the figure implicates will
// dispute the grade. The only defence that survives that conversation is a rule
// they can re-run: named cut points, a labelled fixture, and a check that the
// same input still produces the same grade and the same stated reasons.
//
//   1. THE RUBRIC OVER THE FIXTURE. Every case in
//      tests/fixtures/finops-recoverable-confidence-cases.js is pinned to its
//      grade AND to the reason content behind it, and graded twice to prove the
//      function is idempotent. A fourth case is a row in that table.
//   2. TOTAL. Sparse, malformed and absent inputs each return a grade with a
//      stated reason. Nothing here may throw, return null, or blank the figure.
//   3. ONE SET OF THRESHOLDS. The Moderate floor IS export-gradability.js's
//      publishing bar, imported rather than typed again.
//   4. THE SURFACE. The grade is outside every disclosure in the authored
//      markup — structural, not something a layout-aware test would have to
//      catch — the explanation is inside the disclosure the region already
//      ships, and the served bytes and the paint state the same grade.
//
// No clock, no network, no sleeps.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { CONFIDENCE_CASES } from "./fixtures/finops-recoverable-confidence-cases.js";
import { COVERAGE_BAR, gradeExport } from "../src/export-gradability.js";
import {
  BUNDLED_RECOVERABLE_CONFIDENCE, CONFIDENCE_GRADES, HIGH_COVERAGE_FLOOR,
  HIGH_SCORED_CLUSTER_FLOOR, HIGH_UNPRICED_CLUSTER_CEILING, MODERATE_COVERAGE_FLOOR,
  confidenceChip, confidenceExplanation, gradeRecoverableConfidence,
} from "../src/finops-recoverable-confidence.js";
import {
  RECOVERABLE_CONFIDENCE_IDS, applyRecoverableConfidence,
} from "../src/finops-recoverable-confidence-view.js";
import { escapeText, firstScreenEdits, loadBundledSeed, seedDocument } from "../scripts/seed-first-screen.mjs";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const SOURCE = await readFile(PAGE, "utf8");
const REGION_ID = "finops-recoverable-answer";
const FIGURE_ID = "finops-recoverable-figure";
const DISCLOSURE_ID = "finops-recoverable-how-we-know";

/** Ancestor walk rather than a descendant selector, which this harness rejects. */
const ancestors = (node) => {
  const chain = [];
  for (let walk = node?.parentNode; walk; walk = walk.parentNode) chain.push(walk);
  return chain;
};

// ---------------------------------------------------------------------------
// 1. The rubric, over the labelled fixture.
// ---------------------------------------------------------------------------

test("every labelled case grades exactly as the fixture pins it", () => {
  assert.ok(CONFIDENCE_CASES.length >= 3, "the fixture must carry at least three labelled cases");
  for (const label of ["full scored coverage", "partial coverage", "billing-only export"]) {
    assert.ok(CONFIDENCE_CASES.some((row) => row.name === label),
      `the fixture no longer covers the "${label}" case`);
  }

  for (const row of CONFIDENCE_CASES) {
    const verdict = gradeRecoverableConfidence(row.input);
    assert.equal(verdict.grade, row.expected_grade, `${row.name}: graded ${verdict.grade}`);
    assert.equal(verdict.nextGrade, row.expected_next_grade, `${row.name}: wrong next grade`);

    // The reason structure is data, and it is asserted as data: which inputs are
    // holding the grade down, and which of them must move for the next grade.
    const held = verdict.reasons.filter((reason) => reason.held_down_by !== null)
      .map((reason) => reason.input);
    assert.deepEqual(held, row.expected_held_down_by, `${row.name}: wrong inputs held it down`);
    assert.equal(verdict.heldDownBy.length, row.expected_held_down_by.length,
      `${row.name}: the sentence list and the record list disagree`);

    const raising = verdict.reasons
      .filter((reason) => reason.ceiling === verdict.grade && verdict.grade !== "high")
      .map((reason) => reason.input);
    assert.deepEqual(raising, row.expected_would_raise, `${row.name}: wrong inputs would raise it`);
    assert.equal(verdict.wouldRaise.length, row.expected_would_raise.length,
      `${row.name}: a raising input carries no sentence`);

    // …and the sentences quote the measurement that produced the grade, so a
    // right grade beside a wrong number still fails here.
    const stated = [...verdict.heldDownBy, ...verdict.wouldRaise].join(" ");
    for (const fragment of row.expected_reason_fragments) {
      assert.ok(stated.includes(fragment),
        `${row.name}: the reasons never state "${fragment}"\n${stated}`);
    }
    // Every reason names an input and a ceiling, in a fixed order.
    assert.deepEqual(verdict.reasons.map((reason) => reason.input),
      ["scored_spend_coverage", "scored_departments", "priced_departments"],
      `${row.name}: the reason order moved, so it depends on something other than the list`);
  }
});

test("grading the same input twice returns the same result", () => {
  for (const row of CONFIDENCE_CASES) {
    const once = gradeRecoverableConfidence(row.input);
    const twice = gradeRecoverableConfidence(row.input);
    assert.deepEqual(twice, once, `${row.name}: grading is not idempotent`);
    assert.equal(confidenceExplanation(twice), confidenceExplanation(once),
      `${row.name}: the explanation changed between two identical grades`);
  }
  // Key order in the input may not change the answer either.
  const reordered = gradeRecoverableConfidence({
    provenance: { unpriced: 0, unscored: 2, scored: 3, rows: 5 }, coverage: 0.62,
  });
  assert.deepEqual(reordered, gradeRecoverableConfidence(CONFIDENCE_CASES[1].input),
    "the grade depends on the order the input's keys were written in");
});

// ---------------------------------------------------------------------------
// 2. Total: every input shape returns a grade with a stated reason.
// ---------------------------------------------------------------------------

test("no input shape returns null, throws, or leaves the grade unstated", () => {
  const shapes = [
    null, undefined, {}, [], "provisional", 0,
    { coverage: Number.NaN }, { coverage: "0.9" }, { coverage: 0.9 },
    { coverage: 0.9, provenance: null },
    { coverage: 0.9, provenance: { rows: "4", scored: -1, unpriced: 2.5 } },
    { coverage: 1, provenance: { rows: 4, scored: 4, unpriced: 0 } },
  ];
  for (const shape of shapes) {
    const verdict = gradeRecoverableConfidence(shape);
    const named = JSON.stringify(shape);
    assert.ok(CONFIDENCE_GRADES.includes(verdict.grade), `${named}: not a published grade`);
    assert.equal(typeof verdict.label, "string");
    assert.ok(verdict.label.length > 0, `${named}: the grade has no label to render`);
    assert.equal(verdict.reasons.length, 3, `${named}: a check reported nothing`);
    if (verdict.grade !== "high") {
      assert.ok(verdict.heldDownBy.length > 0, `${named}: a lowered grade states no reason`);
      assert.ok(verdict.wouldRaise.length > 0, `${named}: nothing is said to raise it`);
    }
    // And it renders: a chip and an explanation, both non-empty, for every shape.
    assert.match(confidenceChip(verdict), /^Confidence: (Low|Moderate|High)$/);
    assert.ok(confidenceExplanation(verdict).length > 80, `${named}: the explanation says nothing`);
  }
});

// ---------------------------------------------------------------------------
// 3. One set of thresholds, named, and none of them typed twice.
// ---------------------------------------------------------------------------

test("the cut points are named constants and the Moderate floor is the published bar", () => {
  assert.equal(MODERATE_COVERAGE_FLOOR, COVERAGE_BAR,
    "the Moderate floor is a second copy of the publishing bar rather than the bar");
  assert.ok(HIGH_COVERAGE_FLOOR > MODERATE_COVERAGE_FLOOR, "the two coverage floors crossed");
  assert.equal(HIGH_SCORED_CLUSTER_FLOOR, 2);
  assert.equal(HIGH_UNPRICED_CLUSTER_CEILING, 0);

  // A grade exactly ON a floor is at that grade: the cut points are inclusive,
  // stated here so "at 80%" cannot quietly become "above 80%".
  const at = (coverage) => gradeRecoverableConfidence({
    coverage, provenance: { rows: 4, scored: 4, unpriced: 0 },
  }).grade;
  assert.equal(at(HIGH_COVERAGE_FLOOR), "high");
  assert.equal(at(HIGH_COVERAGE_FLOOR - 0.01), "moderate");
  assert.equal(at(MODERATE_COVERAGE_FLOOR), "moderate");
  assert.equal(at(MODERATE_COVERAGE_FLOOR - 0.01), "low");

  // The rubric it grades is the page's own gradability verdict, not a private one.
  const bundled = gradeRecoverableConfidence(gradeExport({ analysis: null, source: "example" }));
  assert.ok(CONFIDENCE_GRADES.includes(bundled.grade));
});

// ---------------------------------------------------------------------------
// 4. The surface: the grade is a headline fact, its explanation is one press down.
// ---------------------------------------------------------------------------

test("the grade is authored as disclosure-only support", () => {
  const document = parseHtml(SOURCE);
  const grade = document.getElementById(RECOVERABLE_CONFIDENCE_IDS.grade);
  assert.ok(grade, "the answer region authors no confidence grade");

  const chain = ancestors(grade);
  assert.equal(chain.filter((node) => node.tagName === "DETAILS").length, 1,
    "the grade competes with the primary benchmark outside its disclosure");
  assert.equal(chain.filter((node) => node.id === FIGURE_ID).length, 0);
  assert.equal(chain.filter((node) => node.id === REGION_ID).length, 1);

  // Static text, not a control: the first screen has no tab stop to spare.
  assert.equal(grade.tagName, "SPAN");
  assert.equal(grade.getAttribute("tabindex"), null);
  assert.equal(grade.querySelectorAll("button").length, 0);
  assert.equal(grade.querySelectorAll("a").length, 0);
  // It reuses the chip class the marker beside it already ships.
  assert.ok(grade.className.includes("figure-source-state"),
    "the grade forks a new class, which this page's stylesheets have no room for");
});

test("the explanation is inside the one disclosure the region already ships", () => {
  const document = parseHtml(SOURCE);
  const region = document.getElementById(REGION_ID);
  // The answer's OWN disclosures. #1498 folded the readiness region into this
  // one, under a labelled supporting-detail group, and that region brings its
  // own single control with it — which is one fewer than the page carried
  // before, not one more. The rule this asserts is unchanged: the canonical
  // answer itself offers exactly one place to open.
  const own = [...region.querySelectorAll("details")].filter((node) => {
    for (let up = node; up; up = up.parentNode) if (up.id === "finops-answer-support") return false;
    return true;
  });
  assert.equal(own.length, 1, "the answer region grew a second disclosure");

  const detail = document.getElementById(RECOVERABLE_CONFIDENCE_IDS.detail);
  const chain = ancestors(detail);
  assert.equal(chain.filter((node) => node.id === DISCLOSURE_ID).length, 1,
    "the explanation is not inside the how-we-know disclosure");
  // The three labelled parts are untouched: no fourth term, no fourth definition.
  const disclosure = document.getElementById(DISCLOSURE_ID);
  assert.deepEqual(disclosure.querySelectorAll("dt").map((node) => textOf(node).trim()),
    ["Provenance", "Basis", "Limits"]);
  assert.equal(disclosure.querySelectorAll("dd").length, 3);
});

test("a lower grade still leaves a figure and a grade on the page", () => {
  for (const row of CONFIDENCE_CASES) {
    const document = parseHtml(SOURCE);
    applyRecoverableConfidence(document, gradeRecoverableConfidence(row.input));

    // The figure is never suppressed, blanked, or replaced by the caveat.
    assert.match(textOf(document.getElementById("finops-recoverable-value")), /^\$[\d,]+$/,
      `${row.name}: the figure was taken off the page by a lower grade`);
    const grade = document.getElementById(RECOVERABLE_CONFIDENCE_IDS.grade);
    assert.match(textOf(grade), /^Confidence: (Low|Moderate|High)$/,
      `${row.name}: the grade slot is empty`);
    assert.equal(grade.dataset.grade, row.expected_grade);
    // …and the lower grade carries its stated reason, one press down.
    const detail = textOf(document.getElementById(RECOVERABLE_CONFIDENCE_IDS.detail));
    assert.ok(detail.length > 80, `${row.name}: the explanation is missing`);
    if (row.expected_grade !== "high") {
      assert.match(detail, /What holds it there:/, `${row.name}: no reason is stated`);
      assert.match(detail, /What would raise it to/, `${row.name}: no way up is stated`);
    }
    for (const fragment of row.expected_reason_fragments) {
      assert.ok(detail.includes(fragment), `${row.name}: the page drops "${fragment}"`);
    }
  }
});

test("the served bytes and the paint state the same grade", async () => {
  const seeded = parseHtml(seedDocument(SOURCE, firstScreenEdits(await loadBundledSeed())));
  const seededGrade = textOf(seeded.getElementById(RECOVERABLE_CONFIDENCE_IDS.grade));
  const seededDetail = textOf(seeded.getElementById(RECOVERABLE_CONFIDENCE_IDS.detail));

  assert.equal(seededGrade, confidenceChip(BUNDLED_RECOVERABLE_CONFIDENCE));
  assert.equal(seeded.getElementById(RECOVERABLE_CONFIDENCE_IDS.grade).dataset.grade,
    BUNDLED_RECOVERABLE_CONFIDENCE.grade);
  assert.equal(seededDetail, confidenceExplanation(BUNDLED_RECOVERABLE_CONFIDENCE));

  // A boot onto the served document rewrites what it already says.
  applyRecoverableConfidence(seeded);
  assert.equal(textOf(seeded.getElementById(RECOVERABLE_CONFIDENCE_IDS.grade)), seededGrade,
    "the grade drifted between the seed and the paint");
  assert.equal(textOf(seeded.getElementById(RECOVERABLE_CONFIDENCE_IDS.detail)), seededDetail,
    "the explanation drifted between the seed and the paint");
  // The pre-seed wording is gone from the shipped document.
  assert.equal(seededGrade.includes("not graded"), false);
});

test("nothing reaches the page as markup, on either path", () => {
  // The strings this module produces are its own copy plus formatted numbers.
  // If a value that originated in input data ever joined them, both paths have
  // to keep it inert: the paint writes text, and the seed escapes it.
  const hostile = { ...gradeRecoverableConfidence(CONFIDENCE_CASES[1].input),
    label: '<img src=x onerror="1">', grade: '"><script>' };
  const document = parseHtml(SOURCE);
  applyRecoverableConfidence(document, hostile);
  const grade = document.getElementById(RECOVERABLE_CONFIDENCE_IDS.grade);
  assert.equal(grade.querySelectorAll("img").length, 0, "the paint parsed a value as markup");
  assert.equal(grade.querySelectorAll("script").length, 0);
  assert.ok(textOf(grade).includes("<img"), "the value did not arrive as text");

  assert.equal(escapeText('<img src=x onerror="1">'), "&lt;img src=x onerror=\"1\"&gt;");
  assert.ok(escapeText(confidenceChip(hostile)).includes("&lt;img"),
    "the seed writes an unescaped value into the served document");
});
