// The lead's own corrections, one query at a time, and the surface they land on.
//
// Every corpus is generated here so the numbers in the assertions are arithmetic
// a reader can repeat by hand, and every expectation comes from the shipped
// modules rather than from a re-implementation. Seven claims:
//
//   1. The sample is deterministic and ranked by what moves the verdict.
//   2. A row surfaces the class AND the signal the classifier voted with — the
//      classifier's own ids, not a second match against the patterns.
//   3. Enough corrections carry a WITHHELD verdict to a GRADED one, through the
//      same gate `org-query-decision.js` already applies, and the leading
//      answer and the prioritized action change wording with it.
//   4. The provenance count is the corrections the figures rest on, and
//      relabelling one row twice replaces one answer rather than counting two.
//   5. Reverting restores the exact prior numbers, not an approximation.
//   6. A query carrying markup renders as literal characters and creates no
//      element.
//   7. The demo path is unchanged: no pass, no control, same numbers.
//
// The corpus is weighted in billed tokens, because a query sample carries no
// money and `familyCoverage` refuses to print a currency symbol over a token
// count. Token counts here are the weights.

import assert from "node:assert/strict";
import test from "node:test";

import { DomEvent, loadPage, pressKey, textOf } from "./support/browser.js";
import {
  CORRECTION_AGREE, QUERY_CORRECTION_CHOICES, applyQueryCorrections, isCorrectionValue,
  queryCorrectionReview, sampleQueriesForReview,
} from "../src/query-correction-review.js";
import { classifyCorpusRecord, familyCoverage } from "../src/corpus-family-coverage.js";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";
import { ORG_QUERY_DECISION_STATE, orgQueryCoachingDecision } from "../src/org-query-decision.js";
import {
  CORRECTION_REVERT_ID, ORG_COACHING_BODY_ID, ORG_COACHING_CORRECTIONS_ID, ORG_COACHING_LIVE_ID,
  ORG_COACHING_SECTION_ID, applyOrgQueryDecision, correctionControlId, correctionQueryId,
  panelId, toggleId,
} from "../src/org-query-decision-view.js";
import { orgQueryDepartmentLiteracy } from "../src/org-query-scoring.js";
import { orgQuerySampleResult } from "../src/org-query-source.js";
import { loadExampleOrgQuerySample } from "../src/org-query-example.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const FIRST_CLASS = PROMPT_LITERACY_RUBRIC.categories[0].key;

/** A record every family can read: labelled lines are structure in any language. */
const classifiable = (vendor, tokens) => ({
  orgUnitId: "unit-a",
  vendor,
  model: "gpt-3.5-turbo",
  promptExcerpt: "Context: quarterly close. Constraints: no customer names. "
    + "Acceptance criteria: reconciles to the ledger.",
  inputTokens: tokens,
  outputTokens: 0,
});

/** A record no family can read: three characters, one turn, standard tier. */
const residual = (vendor, tokens, text = "zzz") => ({
  orgUnitId: "unit-a",
  vendor,
  model: "gpt-3.5-turbo",
  promptExcerpt: text,
  inputTokens: tokens,
  outputTokens: 0,
});

/**
 * 100 billed tokens: 10 classified, and three unreadable rows of 60, 20 and 10.
 * Unassisted coverage is 10% — under every floor — and correcting the 60-token
 * row alone takes it to 70%, which is over the bar a letter is published at.
 */
const CORPUS = Object.freeze([
  classifiable("keeper", 10),
  residual("alpha", 60),
  residual("beta", 20),
  residual("gamma", 10),
]);

const gradeableLiteracy = () => orgQueryDepartmentLiteracy({
  results: [orgQuerySampleResult(loadExampleOrgQuerySample())],
});

/* ------------------------------- the model ---------------------------------- */

test("the control offers exactly the classifier's classes, plus agree and unreviewed", () => {
  assert.deepEqual(QUERY_CORRECTION_CHOICES.map((choice) => choice.value), [
    "", CORRECTION_AGREE, ...PROMPT_LITERACY_RUBRIC.categories.map((entry) => entry.key),
  ]);
  for (const category of PROMPT_LITERACY_RUBRIC.categories) {
    assert.ok(isCorrectionValue(category.key), `${category.key} must be selectable`);
  }
  assert.equal(isCorrectionValue(CORRECTION_AGREE), true);
  assert.equal(isCorrectionValue(""), false, "unreviewed is not an answer");
  assert.equal(isCorrectionValue("whatever-the-lead-typed"), false,
    "the panel cannot add a class the classifier does not vote over");
});

test("the sample is deterministic and leads with the rows that move the verdict", () => {
  const first = sampleQueriesForReview(CORPUS).map((entry) => entry.index);
  const second = sampleQueriesForReview(CORPUS).map((entry) => entry.index);
  assert.deepEqual(first, second, "re-opening the pass must give the same order");
  // Unclassified first, heaviest first inside that group, then the classified
  // row. No index is dropped and none is invented.
  assert.deepEqual(first, [1, 2, 3, 0]);

  const review = queryCorrectionReview(CORPUS);
  assert.deepEqual(review.rows.map((row) => row.index), [1, 2, 3, 0]);
  assert.deepEqual(review.rows.map((row) => row.classified), [false, false, false, true]);
  assert.equal(review.rows[0].text, "zzz", "the row carries the reader's own query text");
  assert.equal(review.unitLabel, "billed tokens");
});

test("a row surfaces the class and the classifier's own matched signal", () => {
  const review = queryCorrectionReview(CORPUS);
  const classified = review.rows.find((row) => row.classified);
  // The ids are the ones `classifyCorpusRecord` carried out, not a second match
  // against the rule table by this module.
  const decided = classifyCorpusRecord(CORPUS[0], (record) => record.inputTokens);
  assert.deepEqual(classified.signalIds, decided.signals.map((row) => row.signal));
  assert.ok(classified.signalIds.length > 0, "a classified row names what voted for it");
  for (const id of classified.signalIds) {
    assert.ok(classified.signalText.includes(id), `${id} must appear in the row's signal text`);
  }
  assert.equal(classified.classLabel, "High-value");
  assert.match(classified.classText, /^Classifier read this as High-value\./);

  const unplaced = review.rows[0];
  assert.deepEqual(unplaced.signalIds, []);
  assert.match(unplaced.signalText, /No signal matched/);
  assert.match(unplaced.classText, /could not place this query/);
});

test("corrections carry a withheld verdict to a graded one, through the published gate", () => {
  const literacy = gradeableLiteracy();
  const before = queryCorrectionReview(CORPUS);
  assert.equal(before.unassisted.eligibility.showGrade, false);
  const withheld = orgQueryCoachingDecision(literacy,
    { origin: "import", familyCoverage: before.assisted });
  assert.equal(withheld.state, ORG_QUERY_DECISION_STATE.ungradeable);
  assert.equal(withheld.benchmark, undefined, "no letter under the coverage floor");

  // One correction on the heaviest unclassified row: 10% -> 70%.
  const corrections = new Map([[1, FIRST_CLASS]]);
  const after = queryCorrectionReview(CORPUS, corrections);
  // Assisted is what the ONE aggregation returns for the same records with the
  // correction written in — not a second calculation beside it.
  const expected = familyCoverage(applyQueryCorrections(CORPUS, corrections));
  assert.equal(after.assisted.scoredShare, expected.scoredShare);
  assert.equal(after.unassisted.scoredShare, 0.1);
  assert.equal(after.assisted.scoredShare, 0.7);
  assert.equal(after.assisted.scoredDenominator, after.unassisted.scoredDenominator,
    "a correction classifies weight; it never invents or removes any");

  const graded = orgQueryCoachingDecision(literacy,
    { origin: "import", familyCoverage: after.assisted });
  assert.equal(graded.state, ORG_QUERY_DECISION_STATE.graded);
  assert.ok(graded.benchmark.grade, "the letter appears once coverage crosses");
  // The leading answer and the prioritized action change WORDING, rather than
  // staying frozen at the withheld copy.
  assert.equal(withheld.answer, "No department can be named yet.");
  assert.notEqual(graded.answer, withheld.answer);
  assert.match(graded.answer, /coach this department first\./);
  assert.notEqual(graded.action.title, withheld.action.title);
  assert.equal(graded.action.available, true);
  assert.equal(withheld.action.available, false);
  // …and the recoverable-weight figure the residue action names moves with it.
  assert.match(after.assisted.residueAction.text, /beta/);
  assert.match(before.assisted.residueAction.text, /alpha/);
  assert.equal(after.shortfall, null, "the verdict cleared, so there is nothing to explain");

  // Records are copied, never mutated.
  assert.equal(CORPUS[1].category, undefined);
  assert.equal(applyQueryCorrections(CORPUS, corrections)[1].category, FIRST_CLASS);
});

test("the provenance count is the corrections the figures rest on, and never doubles", () => {
  const corrections = new Map();
  corrections.set(1, FIRST_CLASS);
  assert.equal(queryCorrectionReview(CORPUS, corrections).corrections.count, 1);
  assert.match(queryCorrectionReview(CORPUS, corrections).corrections.marker,
    /^1 of your corrections included/);

  // The same row, relabelled a second time. One answer, replaced.
  corrections.set(1, PROMPT_LITERACY_RUBRIC.categories[1].key);
  const again = queryCorrectionReview(CORPUS, corrections);
  assert.equal(again.corrections.count, 1, "re-relabelling one row must not count twice");
  assert.equal(again.rows[0].answer, PROMPT_LITERACY_RUBRIC.categories[1].key);

  // Agreeing is recorded and moves no figure.
  corrections.set(2, CORRECTION_AGREE);
  const agreed = queryCorrectionReview(CORPUS, corrections);
  assert.equal(agreed.corrections.count, 1, "an agreement is not a correction");
  assert.equal(agreed.corrections.agreed, 1);
  assert.equal(agreed.assisted.scoredShare, again.assisted.scoredShare);
  assert.match(agreed.corrections.agreedText, /moves no figure/);
  assert.equal(agreed.rows[1].reviewed, true);
  assert.equal(agreed.rows[1].corrected, false);

  // An answer for a row outside this pass is ignored rather than counted.
  const stray = queryCorrectionReview(CORPUS, new Map([[99, FIRST_CLASS]]));
  assert.equal(stray.corrections.count, 0);
  assert.equal(stray.announcement, null);
  assert.equal(stray.revert.available, false);
});

test("reverting restores the exact prior numbers", () => {
  const literacy = gradeableLiteracy();
  const before = queryCorrectionReview(CORPUS);
  const beforeDecision = orgQueryCoachingDecision(literacy,
    { origin: "import", familyCoverage: before.assisted });

  queryCorrectionReview(CORPUS, new Map([[1, FIRST_CLASS]]));
  // Revert is the empty map on the SAME untouched records.
  const after = queryCorrectionReview(CORPUS, new Map());
  const afterDecision = orgQueryCoachingDecision(literacy,
    { origin: "import", familyCoverage: after.assisted });

  assert.equal(after.assisted.scoredShare, before.assisted.scoredShare);
  assert.equal(after.assisted.scoredSpend, before.assisted.scoredSpend);
  assert.equal(after.assisted.scoredDenominator, before.assisted.scoredDenominator);
  assert.deepEqual(after.assisted.residue.map((cluster) => cluster.key),
    before.assisted.residue.map((cluster) => cluster.key));
  assert.equal(afterDecision.state, beforeDecision.state);
  assert.equal(afterDecision.answer, beforeDecision.answer);
  assert.equal(afterDecision.action.title, beforeDecision.action.title);
  assert.equal(afterDecision.coverage.text, beforeDecision.coverage.text);
  assert.equal(after.corrections.count, 0);
  assert.equal(after.corrections.marker, "");
  assert.equal(after.revert.available, false);
});

test("corrections that do not clear the bar say so, and say what would close it", () => {
  // Correcting the 10-token row alone takes coverage to 20% — still withheld.
  const review = queryCorrectionReview(CORPUS, new Map([[3, FIRST_CLASS]]));
  assert.equal(review.assisted.scoredShare, 0.2);
  assert.equal(review.corrections.assistedShowGrade, false);
  assert.match(review.shortfall, /20\.0% of this corpus is classified with your corrections in/);
  assert.match(review.shortfall, /up from 10\.0%/);
  assert.match(review.shortfall, /still under the bar/);
  assert.match(review.shortfall, /Relabelling the remaining 3 queries/);
});

test("an import with no reviewable query is an honest empty state, and a full pass completes", () => {
  assert.equal(queryCorrectionReview([]), null, "nothing at all is null, not an empty panel");

  const declaredOnly = [{ orgUnitId: "unit-a", vendor: "v", model: "gpt-3.5-turbo",
    category: FIRST_CLASS, inputTokens: 5, outputTokens: 0 }];
  const empty = queryCorrectionReview(declaredOnly);
  assert.equal(empty.rows.length, 0);
  assert.match(empty.empty, /nothing to review/);
  assert.equal(empty.chip, "no reviewable query");

  const all = new Map([[0, CORRECTION_AGREE], [1, FIRST_CLASS], [2, CORRECTION_AGREE],
    [3, CORRECTION_AGREE]]);
  const complete = queryCorrectionReview(CORPUS, all);
  assert.equal(complete.corrections.pending, 0);
  assert.match(complete.complete, /Every query in this pass is reviewed/);
  assert.match(complete.complete, /stays open/);
});

/* ------------------------------- the surface -------------------------------- */

const section = (document) => document.getElementById(ORG_COACHING_SECTION_ID);
const body = (document) => document.getElementById(ORG_COACHING_BODY_ID);
const live = (document) => document.getElementById(ORG_COACHING_LIVE_ID);
const passToggle = (document) => document.getElementById(toggleId(ORG_COACHING_CORRECTIONS_ID));
const passPanel = (document) => document.getElementById(panelId(ORG_COACHING_CORRECTIONS_ID));

/**
 * The page's own wiring, in the shape `evolution-page.js` uses it: one
 * correction map, one review off the records, the corrected records handed to
 * the coverage the decision reads. A test that assembled it differently would
 * be testing a surface the product does not ship.
 */
function mount(document, records, { origin = "import" } = {}) {
  const literacy = gradeableLiteracy();
  const corrections = new Map();
  const render = () => {
    const pass = origin === "import" && records.length
      ? queryCorrectionReview(records, corrections) : null;
    const corrected = pass ? applyQueryCorrections(records, corrections) : records;
    applyOrgQueryDecision(document, orgQueryCoachingDecision(literacy, {
      origin, fileNames: ["my-export.csv"], familyCoverage: familyCoverage(corrected),
    }), {
      corrections: pass,
      onCorrect: (index, value) => {
        if (isCorrectionValue(value)) corrections.set(index, value);
        else corrections.delete(index);
        render();
      },
      onRevert: () => { corrections.clear(); render(); },
    });
    return pass;
  };
  const open = () => {
    const toggle = passToggle(document);
    if (toggle.getAttribute("aria-expanded") === "false") toggle.click();
  };
  return { render, open, corrections };
}

test("the pass is a sibling disclosure with aria-expanded, not a second summary", async () => {
  const { document } = await loadPage(PAGE);
  const surface = mount(document, CORPUS);
  surface.render();

  const group = body(document).querySelector(".org-coaching-disclosures");
  const blocks = group.querySelectorAll(".org-coaching-disclosure");
  assert.equal(blocks[blocks.length - 1].dataset.disclosure, ORG_COACHING_CORRECTIONS_ID);
  assert.equal(document.querySelectorAll("dialog").length, 0, "no modal is introduced");

  const toggle = passToggle(document);
  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), panelId(ORG_COACHING_CORRECTIONS_ID));
  assert.equal(passPanel(document).hidden, true);
  assert.match(textOf(toggle), /Did the classifier read my queries correctly\?/);
  assert.match(textOf(toggle), /0 of 4 queries reviewed/);

  surface.open();
  assert.equal(passToggle(document).getAttribute("aria-expanded"), "true");
  assert.equal(passPanel(document).hidden, false);
  assert.equal(passPanel(document).getAttribute("role"), "region");
  // Opening a panel is not a recompute and must not speak.
  assert.equal(live(document).textContent.includes("of your corrections"), false);
});

test("each row's control is keyboard-operable and named for its own query", async () => {
  const { document } = await loadPage(PAGE);
  const surface = mount(document, CORPUS);
  const pass = surface.render();
  surface.open();

  const rows = passPanel(document).querySelectorAll(".org-coaching-corrections-row");
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.dataset.index), ["1", "2", "3", "0"]);

  const select = document.getElementById(correctionControlId(1));
  assert.equal(select.tagName, "SELECT", "a native control, not a free-text field");
  // The trap this harness sets: its `<select>` accepts any value a real one
  // would refuse, so the OPTION SET is what gets asserted, not just a write.
  assert.deepEqual(select.options.map((option) => option.getAttribute("value")),
    QUERY_CORRECTION_CHOICES.map((choice) => choice.value));
  assert.deepEqual(select.options.map((option) => textOf(option)),
    QUERY_CORRECTION_CHOICES.map((choice) => choice.label));
  assert.equal(select.value, "", "an unanswered query starts unreviewed");
  assert.equal(passPanel(document).querySelectorAll("input[type=\"text\"]").length, 0,
    "a class may never be typed");

  // Named by what it does AND by the query it is about — not "Agree" four times.
  assert.equal(select.getAttribute("aria-labelledby"),
    `org-coaching-correction-purpose-1 ${correctionQueryId(1)}`);
  assert.equal(textOf(document.getElementById(correctionQueryId(1))), pass.rows[0].text);
  assert.match(textOf(rows[0].querySelector(".org-coaching-corrections-purpose")),
    /Your reading of query 1 of 4/);
  assert.equal(textOf(rows[0].querySelector(".org-coaching-corrections-state")),
    "Your answer: Not reviewed");

  // The keyboard alone answers a row: the control is in the tab order and an
  // arrow key moves it, with no pointer anywhere in this test.
  document.getElementById(correctionControlId(2)).focus();
  pressKey(document, "ArrowDown");
  assert.equal(surface.corrections.get(2), CORRECTION_AGREE,
    "arrowing down one step selects the next option and applies it");
  assert.equal(document.activeElement?.id, correctionControlId(2),
    "focus never moves on recompute");
});

test("a query carrying markup renders as literal characters and creates no element", async () => {
  const { document } = await loadPage(PAGE);
  const hostile = "<img src=x onerror=alert(1)><script>alert(2)</script>";
  const records = [classifiable("keeper", 10), residual("alpha", 60, hostile)];
  const surface = mount(document, records);
  surface.render();
  surface.open();

  const node = document.getElementById(correctionQueryId(1));
  assert.equal(node.tagName, "P");
  // The whole payload is the node's text, and the node has no element children.
  assert.equal(textOf(node), hostile);
  assert.equal(node.childElements.length, 0, "no element may be created from a query");
  assert.equal(node.firstChild.nodeType, 3, "the payload is one text node and nothing else");
  assert.equal(passPanel(document).querySelectorAll("img").length, 0);
  assert.equal(passPanel(document).querySelectorAll("script").length, 0);

  // …and nothing derived from it reached an attribute that can execute or navigate.
  const walk = (element) => [element, ...element.childElements.flatMap(walk)];
  for (const element of walk(passPanel(document))) {
    for (const [name, value] of element.attributes) {
      assert.equal(value.includes("onerror") || value.includes("<img"), false,
        `${name} must not carry query text`);
      assert.equal(name.startsWith("on"), false, "no event-handler attribute is authored");
    }
  }
});

test("a correction recomputes the answer, the figure and the action, then reverts exactly",
  async () => {
    const { document } = await loadPage(PAGE);
    const surface = mount(document, CORPUS);
    surface.render();
    surface.open();

    assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.ungradeable);
    const beforeAnswer = textOf(body(document).querySelector(".org-coaching-answer-text"));
    const beforeCoverage = textOf(body(document).querySelector(".org-coaching-coverage-text"));
    const beforeAction = textOf(body(document).querySelector(".org-coaching-action-title"));
    assert.ok(beforeCoverage.startsWith("10.0%"), `expected 10.0%, got: ${beforeCoverage}`);
    assert.equal(body(document).querySelector(".org-coaching-correction-marker"), null,
      "no provenance line before a correction lands");

    const select = document.getElementById(correctionControlId(1));
    select.value = FIRST_CLASS;
    select.dispatchEvent(new DomEvent("change", { bubbles: true }));

    // Same region, no reload: the leading answer, the headline figure and the
    // prioritized action all moved, and the provenance line appeared.
    assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.graded);
    const afterAnswer = textOf(body(document).querySelector(".org-coaching-answer-text"));
    assert.notEqual(afterAnswer, beforeAnswer);
    assert.ok(textOf(body(document).querySelector(".org-coaching-coverage-text"))
      .startsWith("70.0%"));
    assert.notEqual(textOf(body(document).querySelector(".org-coaching-action-title")),
      beforeAction);
    assert.ok(textOf(body(document).querySelector(".org-coaching-letter")).length > 0);
    const marker = body(document).querySelector(".org-coaching-correction-marker");
    assert.match(textOf(marker), /1 of your corrections included/);
    assert.equal(marker.dataset.correctionCount, "1");
    // One live region, one coherent announcement.
    assert.equal(passPanel(document).querySelectorAll("[aria-live]").length, 0,
      "the panel adds no competing live region");
    assert.match(live(document).textContent, /1 of your corrections included/);
    assert.match(live(document).textContent, /A letter grade is shown/);
    // The pass stayed open and the keyboard stayed where it was.
    assert.equal(passPanel(document).hidden, false);
    assert.equal(document.activeElement?.id, correctionControlId(1));

    // Revert: the exact prior numbers, the provenance line gone.
    const revert = document.getElementById(CORRECTION_REVERT_ID);
    assert.equal(revert.tagName, "BUTTON");
    assert.match(textOf(revert), /Revert to classifier-only output/);
    revert.click();

    assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.ungradeable);
    assert.equal(textOf(body(document).querySelector(".org-coaching-answer-text")), beforeAnswer);
    assert.equal(textOf(body(document).querySelector(".org-coaching-coverage-text")),
      beforeCoverage);
    assert.equal(textOf(body(document).querySelector(".org-coaching-action-title")), beforeAction);
    assert.equal(body(document).querySelector(".org-coaching-correction-marker"), null);
    assert.equal(document.getElementById(CORRECTION_REVERT_ID), null,
      "with nothing corrected there is nothing to revert");
    assert.equal(passPanel(document).hidden, false, "the pass stays open after a revert");
  });

test("the bundled demo path is unchanged: no pass, no control, same numbers", async () => {
  const { document } = await loadPage(PAGE);
  const literacy = gradeableLiteracy();
  const coverage = familyCoverage(CORPUS);

  // The page's example branch, painted with no correction pass attached.
  const expected = orgQueryCoachingDecision(literacy,
    { origin: "example", fileNames: ["bundled"], familyCoverage: coverage });
  mount(document, CORPUS, { origin: "example" }).render();

  assert.equal(passToggle(document), null, "no entry point on the demo path");
  assert.equal(passPanel(document), null, "and no empty container to shift the layout");
  assert.equal(document.getElementById(CORRECTION_REVERT_ID), null);
  assert.equal(body(document).querySelectorAll(".org-coaching-corrections").length, 0);
  assert.equal(body(document).querySelector(".org-coaching-correction-marker"), null);
  // The figures are the ones the decision publishes with no pass in play.
  assert.equal(textOf(body(document).querySelector(".org-coaching-answer-text")), expected.answer);
  assert.equal(textOf(body(document).querySelector(".org-coaching-coverage-text")),
    expected.coverage.text);
  assert.equal(textOf(body(document).querySelector(".org-coaching-action-title")),
    expected.action.title);
  assert.equal(live(document).textContent, expected.announcement);
  // The four read-only disclosures are exactly what they were.
  assert.deepEqual(body(document).querySelectorAll(".org-coaching-disclosure")
    .map((block) => block.dataset.disclosure), expected.disclosures.map((entry) => entry.id));
});
