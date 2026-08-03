// A reader-classified literacy letter, and whether it can be defended (#1008).
//
// A billing-only import has no scored query sample, so the letter it earns is
// earned by a person answering a picker rather than by a judge reading prompts.
// That is a weaker claim than a judged letter, and the only thing that makes it
// publishable at all is that every step of it is reproducible and stated:
//
//   1. NO WEIGHT WITHOUT AN ASSUMPTION. Every pickable workload category maps to
//      a category already published in prompt-literacy-rubric.json, inherits its
//      weight from there rather than restating it, and carries one line saying
//      why that weight is right for the workload it describes. An entry missing
//      any of the three fails here.
//   2. THE SAME INPUTS PRODUCE THE SAME LETTER. Labelled fixtures pin the exact
//      letter and the exact covered share, and the same call twice in one run
//      produces an identical object.
//   3. THE TIER EDGES ARE PINNED, NOT INCIDENTAL. One fixture sits exactly on a
//      COVERAGE_TIERS floor and one sits a dollar under it, so a change to the
//      boundary rule fails a test instead of moving a published letter.
//   4. THE READER'S OWN SHARE STAYS DISTINGUISHABLE. Coverage is returned and
//      printed as imported-and-rubric-scored plus reader-classified, never as
//      one number.
//   5. NOTHING FROM AN IMPORTED FILE IS TRUSTED. A department named with markup
//      renders as text.
//
// Every assertion below is on a count, a string, or an attribute value. Nothing
// asserts that a queried element is absent: that walks the whole parsed page in
// this harness and outlives the test timeout.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, textOf } from "./support/browser.js";
import {
  SHORTFALL_ORDER_RULE, TOP_DEPARTMENT_COUNT, WORKLOAD_CATEGORIES,
  applyReaderClassification, applyReaderClassifiedLetter, clearReaderClassification,
  readerClassifiedGrade, workloadCategory,
} from "../src/reader-classified-grade.js";
import { COVERAGE_TIERS, gradeEligibility } from "../src/grade-eligibility.js";
import { categoryScoreWeight } from "../src/prompt-literacy-scoring.js";
import { composeFirstRunLiteracy } from "../src/finops-first-run-literacy.js";
import { loadExampleDataset } from "../src/example-dataset.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const FIXTURE = JSON.parse(await readFile(
  new URL("../src/department-workload-categories.json", import.meta.url), "utf8"));

/** A labelled department, exactly as the page hands one over. */
const dept = (name, spendUsd, extra = {}) => ({ name, spendUsd, ...extra });

// --- 1. the executable rubric fixture ---------------------------------------

test("every pickable category carries an id, a label, a published weight and its assumption", () => {
  assert.equal(WORKLOAD_CATEGORIES.length, FIXTURE.categories.length);
  assert.ok(WORKLOAD_CATEGORIES.length >= 4,
    "a picker with fewer than the four published categories cannot express the rubric");

  const ids = new Set();
  for (const category of WORKLOAD_CATEGORIES) {
    assert.match(category.id, /^[a-z][a-z0-9-]+$/, `unstable id: ${category.id}`);
    assert.equal(ids.has(category.id), false, `duplicate id: ${category.id}`);
    ids.add(category.id);
    assert.ok(category.label.length > 20, `${category.id}: label is not reader-facing`);
    // THE ASSERTION THIS FILE EXISTS FOR. A weight without a stated assumption
    // is a number a director cannot argue with, and it must not ship.
    assert.equal(typeof category.assumption, "string", `${category.id}: no assumption`);
    assert.ok(category.assumption.trim().length > 60,
      `${category.id}: the assumption behind its weight is missing or is not a sentence`);
    // The weight is joined from the published rubric, never restated here.
    assert.equal(category.weight, categoryScoreWeight(category.rubricCategory),
      `${category.id}: weight disagrees with the published rubric`);
  }
});

test("the fixture states no number of its own, so a label cannot drift from its weight", async () => {
  const source = await readFile(
    new URL("../src/department-workload-categories.json", import.meta.url), "utf8");
  for (const entry of FIXTURE.categories) {
    assert.equal(Object.hasOwn(entry, "weight"), false,
      `${entry.id}: a second copy of a rubric weight lives in the fixture`);
    assert.equal(Object.hasOwn(entry, "assumption"), true, `${entry.id}: no assumption`);
  }
  assert.match(source, /categoryScoreWeight/,
    "the fixture must say where its weights come from");
});

test("an id the published rubric has no weight for is unclassified, never guessed at", () => {
  assert.equal(workloadCategory("not-a-category"), null);
  assert.equal(workloadCategory(""), null);
  assert.equal(workloadCategory(undefined), null);
  assert.equal(workloadCategory(WORKLOAD_CATEGORIES[0].id).weight, WORKLOAD_CATEGORIES[0].weight);

  // The harness's select double accepts any value and a restored capture is not
  // a control at all, so the rejection has to live in the scoring path: an
  // out-of-rubric id leaves the department unclassified rather than scoring it.
  const model = readerClassifiedGrade({
    departments: [dept("Platform", 100_000)],
    choices: { Platform: "definitely-an-a" },
  });
  assert.equal(model.classifiedNames.length, 0);
  assert.equal(model.letter, null);
  assert.equal(model.readerClassifiedShare, 0);
});

// --- 2. reproducibility ------------------------------------------------------

/**
 * The labelled fixture. Four departments, three classified, one left alone, so
 * the letter, the coverage split and the shortfall are all non-trivial.
 */
const LABELLED = Object.freeze({
  departments: [
    dept("Platform Engineering", 40_000),
    dept("Revenue Operations", 30_000),
    dept("Customer Support", 20_000),
    dept("Field Marketing", 10_000),
  ],
  choices: {
    "Platform Engineering": "structured-delivery-work",
    "Revenue Operations": "simple-tasks-on-frontier-models",
    "Customer Support": "repeated-reprompting",
  },
});

test("a labelled classification produces the same letter and the same covered share twice", () => {
  const first = readerClassifiedGrade(LABELLED);
  const second = readerClassifiedGrade(LABELLED);

  // Spend-weighted mean of the published weights over the classified spend:
  // (40k x 100 + 30k x 55 + 20k x 35) / 90k = 70.55…, rounded to 71.
  assert.equal(first.score, 71);
  assert.equal(first.letter, "C");
  assert.equal(first.coveredShare, 0.9);
  assert.equal(first.importedShare, 0);
  assert.equal(first.readerClassifiedShare, 0.9);
  assert.equal(first.showGrade, true);
  assert.equal(first.tier, "high");

  // Same input, identical output object — compared as bytes so a field added
  // later is covered without anyone remembering to add it to a list.
  assert.equal(JSON.stringify(second), JSON.stringify(first),
    "two runs of the same classification disagreed");
  // And again from a re-ordered department list: the ordering is total, so the
  // arithmetic cannot depend on the order the caller happened to hold.
  const reversed = readerClassifiedGrade({
    ...LABELLED, departments: [...LABELLED.departments].reverse(),
  });
  assert.equal(JSON.stringify(reversed), JSON.stringify(first));
});

test("the coverage split is printed as two halves, never as one number", () => {
  const mixed = readerClassifiedGrade({
    departments: [
      dept("Platform Engineering", 50_000, { rubricScored: true, score: 88 }),
      dept("Revenue Operations", 30_000),
      dept("Field Marketing", 20_000),
    ],
    choices: { "Revenue Operations": "simple-tasks-on-frontier-models" },
  });
  assert.equal(mixed.importedShare, 0.5);
  assert.equal(mixed.readerClassifiedShare, 0.3);
  assert.equal(mixed.coveredShare, 0.8);
  // (50k x 88 + 30k x 55) / 80k = 75.625 → 76.
  assert.equal(mixed.score, 76);
  assert.equal(mixed.letter, "C");
  assert.equal(mixed.coverageLine,
    "Coverage · 80.0% of imported spend — 50.0% imported and rubric-scored, 30.0% you classified");
  assert.match(mixed.explanation, /Coverage is 80\.0% of imported spend — 50\.0% imported and rubric-scored, 30\.0% you classified\.$/);
});

// --- 3. the tier edges ------------------------------------------------------

const floorOf = (tier) => COVERAGE_TIERS.find((entry) => entry.tier === tier).floor;

test("a fixture sitting exactly on a coverage floor takes the better tier", () => {
  assert.equal(floorOf("moderate"), 0.5, "the fixture below is written against a 50% floor");
  const onTheLine = readerClassifiedGrade({
    departments: [dept("Platform Engineering", 50_000), dept("Field Marketing", 50_000)],
    choices: { "Platform Engineering": "structured-delivery-work" },
  });
  assert.equal(onTheLine.coveredShare, 0.5);
  assert.equal(onTheLine.tier, "moderate");
  assert.equal(onTheLine.showGrade, true);
  assert.equal(onTheLine.letter, "A");
});

test("a fixture one dollar under the same floor takes the lower tier", () => {
  const justUnder = readerClassifiedGrade({
    departments: [dept("Platform Engineering", 49_999), dept("Field Marketing", 50_001)],
    choices: { "Platform Engineering": "structured-delivery-work" },
  });
  assert.equal(justUnder.coveredShare, 0.49999);
  assert.equal(justUnder.tier, "provisional");
  assert.equal(justUnder.provisional, true);
  // Still a letter — provisional shows one and marks it. The tier is what moved.
  assert.equal(justUnder.showGrade, true);
});

test("under the lowest floor the letter is withheld, and the shortfall names the gap", () => {
  const withheld = readerClassifiedGrade({
    departments: [dept("Platform Engineering", 20_000), dept("Field Marketing", 80_000)],
    choices: { "Platform Engineering": "structured-delivery-work" },
  });
  assert.equal(floorOf("provisional"), 0.25);
  assert.equal(withheld.coveredShare, 0.2);
  assert.equal(withheld.tier, "insufficient");
  assert.equal(withheld.showGrade, false);
  assert.equal(withheld.shortfall.targetTier, "provisional");
  // 5% of spend, and the sentence says where the 5% came from and who closes it.
  assert.match(withheld.shortfall.sentence, /5\.0% more of imported spend/);
  assert.match(withheld.shortfall.sentence, /Field Marketing \(80\.0% of spend\)/);
  assert.match(withheld.shortfall.sentence, new RegExp(SHORTFALL_ORDER_RULE));
  assert.deepEqual(withheld.shortfall.departments, ["Field Marketing"]);
});

test("the shortfall list is largest-unclassified-spend-first and stops when the gap closes", () => {
  const model = readerClassifiedGrade({
    departments: [
      dept("Alpha", 10_000), dept("Bravo", 40_000), dept("Charlie", 30_000), dept("Delta", 20_000),
    ],
    choices: {},
  });
  assert.equal(model.coveredShare, 0);
  // 25% needed; Bravo alone is 40% and closes it, so nothing else is listed.
  assert.deepEqual(model.shortfall.departments, ["Bravo"]);
  assert.equal(model.shortfall.closes, true);
  assert.match(model.shortfall.sentence, /^No letter yet: classify the departments below/);
});

test("every dollar is rubric-scored, reader-classified, or named in the shortfall", () => {
  // The property the coverage split rests on: the three buckets partition the
  // total, so a reader can check the printed percentages by adding them up.
  const model = readerClassifiedGrade({
    departments: [
      dept("Alpha", 10_000, { rubricScored: true, score: 70 }),
      // Marked scored but with no number behind it — covered by nothing, so it
      // is offered to the reader rather than quietly leaving the accounting.
      dept("Bravo", 40_000, { rubricScored: true }),
      dept("Charlie", 30_000),
      dept("Delta", 20_000),
    ],
    choices: { Charlie: "repeated-reprompting" },
  });
  const unclassifiedShare = model.unclassified.reduce((sum, entry) => sum + entry.share, 0);
  assert.equal(Number((model.coveredShare + unclassifiedShare).toFixed(10)), 1);
  assert.equal(model.importedShare, 0.1);
  assert.equal(model.readerClassifiedShare, 0.3);
  assert.deepEqual(model.unclassified.map((entry) => entry.name), ["Bravo", "Delta"]);
  assert.equal(model.shortfall.closes, true);
});

test("spend past the offered cap stays in the denominator and is named", () => {
  const many = Array.from({ length: TOP_DEPARTMENT_COUNT + 2 },
    (_, index) => dept(`Team ${index}`, 10_000 * (index + 1)));
  const model = readerClassifiedGrade({ departments: many, choices: {} });
  assert.equal(model.offered.length, TOP_DEPARTMENT_COUNT);
  assert.equal(model.unclassified.length, many.length);
  assert.equal(model.totalUsd, many.reduce((sum, entry) => sum + entry.spendUsd, 0));
  assert.equal(model.offered[0].name, "Team 6", "the offered list is largest spend first");
});

// --- 4. eligibility keeps the reader's share separable -----------------------

test("gradeEligibility counts a reader-classified department and keeps it distinguishable", () => {
  const departments = [
    { name: "Platform Engineering", spendUsd: 60_000 },
    { name: "Field Marketing", spendUsd: 40_000 },
  ];
  const before = gradeEligibility(departments);
  assert.equal(before.coveredShare, 0);
  assert.equal(before.readerClassifiedShare, 0);
  assert.equal(before.showGrade, false);

  const after = gradeEligibility(departments, {
    readerClassifiedNames: ["Platform Engineering"],
  });
  assert.equal(after.importedShare, 0);
  assert.equal(after.readerClassifiedShare, 0.6);
  assert.equal(after.coveredShare, 0.6);
  assert.equal(after.coverage, 0.6, "the pre-existing field keeps its meaning for current callers");
  assert.equal(after.tier, "moderate");
  assert.equal(after.showGrade, true);
  // The department the reader dealt with is no longer the thing to go and widen.
  assert.equal(after.nextAction.group, "Field Marketing");
});

test("the example brief's letter is unchanged by any of this", () => {
  const literacy = composeFirstRunLiteracy(loadExampleDataset());
  assert.equal(literacy.available, true);
  assert.equal(literacy.grade, "B", "the example company's published letter moved");
});

// --- 5. the surface ----------------------------------------------------------

/** The page wiring, in miniature: choices in a Map, recomposed on every change. */
function mountClassifier(document, departments) {
  const choices = new Map();
  const paint = () => {
    const model = readerClassifiedGrade({ departments, choices });
    applyReaderClassification(document, model, {
      onChange: (name, id) => {
        if (id) choices.set(name, id);
        else choices.delete(name);
        paint();
      },
    });
    return applyReaderClassifiedLetter(document, model);
  };
  return { paint, choices };
}

const choose = (select, value) => {
  select.value = value;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
};

/** Ancestor tag names as strings, so nesting can be asserted without probing for absence. */
function ancestorTags(node) {
  const tags = [];
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (parent.tagName) tags.push(parent.tagName);
  }
  return tags;
}

test("the control renders one row per offered department, each with the whole rubric", async () => {
  const { document } = await loadPage(PAGE);
  const { paint } = mountClassifier(document, [
    dept("Platform Engineering", 60_000), dept("Field Marketing", 40_000),
  ]);
  paint();

  const root = document.getElementById("score-classify");
  assert.equal(root.hasAttribute("hidden"), false, "the control is hidden on a billing-only import");
  assert.equal(document.getElementById("score-classify-list").querySelectorAll("li").length, 2);
  const first = document.getElementById("score-classify-choice-0");
  assert.equal(first.getAttribute("data-department"), "Platform Engineering");
  // Every published category, plus the "not classified yet" entry.
  assert.equal(first.querySelectorAll("option").length, WORKLOAD_CATEGORIES.length + 1);
  assert.equal(textOf(document.getElementById("score-classify-choice-0").parentNode)
    .includes("60.0% of imported spend"), true);

  // The grade explanation and the instruction are on the card, not folded into
  // a disclosure a real browser would hide from the reader.
  for (const id of ["score-classify", "score-why", "score-input-need"]) {
    assert.deepEqual(ancestorTags(document.getElementById(id)).filter((tag) => tag === "DETAILS"), [],
      `#${id} is inside a collapsed disclosure`);
  }
});

test("classifying a department recomputes the letter, the split, and the stated assumption", async () => {
  const { document } = await loadPage(PAGE);
  const { paint } = mountClassifier(document, [
    dept("Platform Engineering", 60_000), dept("Field Marketing", 40_000),
  ]);
  paint();
  assert.equal(textOf(document.getElementById("score-grade")), "…");

  choose(document.getElementById("score-classify-choice-0"), "structured-delivery-work");
  assert.equal(textOf(document.getElementById("score-grade")), "A");
  assert.equal(textOf(document.getElementById("score-coverage")),
    "Coverage · 60.0% of imported spend — 0.0% imported and rubric-scored, 60.0% you classified");
  assert.match(textOf(document.getElementById("score-why")),
    /1 department you classified was scored — Platform Engineering/);
  // The assumption behind the weight the reader just applied, on the surface.
  assert.equal(textOf(document.getElementById("score-classify-choice-0-assumption")),
    workloadCategory("structured-delivery-work").assumption);
  assert.equal(document.getElementById("score-card").getAttribute("data-reader-classified"), "true");
  assert.equal(document.getElementById("score-card").getAttribute("data-coverage-tier"), "moderate");

  // Still short of the top tier, so the reason line is the shortfall — visible,
  // and naming both the remaining share and who would supply it.
  const need = document.getElementById("score-input-need");
  assert.equal(need.hasAttribute("hidden"), false);
  assert.match(textOf(need), /20\.0% more of imported spend/);
  assert.match(textOf(need), /Field Marketing \(40\.0% of spend\)/);

  // Taking the category back off returns the pending mark rather than a letter.
  choose(document.getElementById("score-classify-choice-0"), "");
  assert.equal(textOf(document.getElementById("score-grade")), "…");
  assert.equal(document.getElementById("score-card").getAttribute("data-reader-classified"), "false");
});

test("a department name from an imported file is rendered as text, never as markup", async () => {
  const { document } = await loadPage(PAGE);
  const hostile = "<img src=x onerror=alert(1)> & Co";
  const { paint } = mountClassifier(document, [dept(hostile, 90_000), dept("Field Marketing", 10_000)]);
  paint();

  const list = document.getElementById("score-classify-list");
  assert.equal(list.querySelectorAll("li").length, 2);
  assert.equal(list.querySelectorAll("img").length, 0, "an imported name became an element");
  assert.equal(list.querySelectorAll("script").length, 0);
  assert.equal(document.getElementById("score-classify-choice-0").getAttribute("data-department"), hostile);
  assert.equal(textOf(list).includes(hostile), true, "the name is shown, as text");
});

test("the control is hidden again when the state is not a billing-only import", async () => {
  const { document } = await loadPage(PAGE);
  const { paint } = mountClassifier(document, [dept("Platform Engineering", 60_000)]);
  paint();
  assert.equal(document.getElementById("score-classify").hasAttribute("hidden"), false);
  clearReaderClassification(document);
  assert.equal(document.getElementById("score-classify").hasAttribute("hidden"), true);
});

test("the scoring path reads no clock, no PRNG, and opens no request", async () => {
  const source = await readFile(new URL("../src/reader-classified-grade.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Math\.random|Date\.now|new Date\(/,
    "a letter computed off a clock or a PRNG is not reproducible");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|localStorage|sessionStorage/,
    "classification is client-side and session-only");
});
