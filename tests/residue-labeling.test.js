// The lead's own labels for the unclassified residue, and the surface they are
// applied on.
//
// Five claims are checked here, each against the shipped modules rather than a
// re-implementation, and every corpus is generated in this file so the numbers
// in the assertions are arithmetic a reader can repeat by hand:
//
//   1. A label moves coverage, and it moves it THROUGH `familyCoverage` — the
//      assisted figure equals the figure that function returns for the same
//      records with the label written in.
//   2. Enough labels cross the bar and the letter appears, from the same gate
//      `org-query-decision.js` already applies.
//   3. "Genuinely unclassifiable" is a distinct, recorded answer and adds
//      nothing to coverage.
//   4. The provenance marker states the count, appears wherever an assisted
//      number is printed, and keeps the unassisted figure recoverable.
//   5. Clearing the surface, or reading a different corpus, drops every label
//      and returns the unassisted reading.
//
// The corpus is weighted in billed tokens, because a query sample carries no
// money and `familyCoverage` refuses to print a currency symbol over a token
// count. Token counts here are the weights.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, pressKey, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  RESIDUE_LABEL_CHOICES, RESIDUE_UNCLASSIFIABLE, applyLeadLabels, isResidueLabel,
  residueDimension, residueReview,
} from "../src/residue-labeling.js";
import { familyCoverage, residueClusterKey } from "../src/corpus-family-coverage.js";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";
import { ORG_QUERY_DECISION_STATE, orgQueryCoachingDecision } from "../src/org-query-decision.js";
import {
  ORG_COACHING_BODY_ID, ORG_COACHING_LIVE_ID, ORG_COACHING_RESIDUE_ID, ORG_COACHING_SECTION_ID,
  applyOrgQueryDecision, clearOrgQueryDecision, panelId, residueControlId, toggleId,
} from "../src/org-query-decision-view.js";
import { orgQueryDepartmentLiteracy } from "../src/org-query-scoring.js";
import { orgQuerySampleResult } from "../src/org-query-source.js";
import { loadExampleOrgQuerySample } from "../src/org-query-example.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

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
const residual = (vendor, tokens) => ({
  orgUnitId: "unit-a",
  vendor,
  model: "gpt-3.5-turbo",
  promptExcerpt: "zzz",
  inputTokens: tokens,
  outputTokens: 0,
});

/**
 * 100 billed tokens: 10 classified, and three residue clusters of 60, 20 and 10.
 * Unassisted coverage is 10% — under every floor — and labelling `alpha` alone
 * takes it to 70%.
 */
const CORPUS = Object.freeze([
  classifiable("keeper", 10),
  residual("alpha", 60),
  residual("beta", 20),
  residual("gamma", 10),
]);

/** A corpus whose residue is a long tail: 5 offered clusters and 40 below the cap. */
function tailCorpus() {
  return [
    classifiable("keeper", 1),
    ...Array.from({ length: 5 }, (unused, index) => residual(`offered-${index}`, 5)),
    ...Array.from({ length: 40 }, (unused, index) => residual(`tail-${index}`, 2)),
  ];
}

const FIRST_CLASS = PROMPT_LITERACY_RUBRIC.categories[0].key;
const gradeableLiteracy = () => orgQueryDepartmentLiteracy({
  results: [orgQuerySampleResult(loadExampleOrgQuerySample())],
});

/* ------------------------------- the model ---------------------------------- */

test("the control offers exactly the rubric's classes plus the two non-classes", () => {
  assert.deepEqual(RESIDUE_LABEL_CHOICES.map((choice) => choice.value), [
    "", ...PROMPT_LITERACY_RUBRIC.categories.map((category) => category.key),
    RESIDUE_UNCLASSIFIABLE,
  ]);
  // The class list is the rubric's, read from it rather than copied.
  for (const category of PROMPT_LITERACY_RUBRIC.categories) {
    assert.ok(isResidueLabel(category.key), `${category.key} must be assignable`);
  }
  assert.equal(isResidueLabel(RESIDUE_UNCLASSIFIABLE), true);
  assert.equal(isResidueLabel(""), false, "unassigned is not a label");
  assert.equal(isResidueLabel("whatever-the-lead-typed"), false);
});

test("clusters are ranked by share, described structurally, and never by excerpt", () => {
  const review = residueReview(CORPUS);
  assert.deepEqual(review.rows.map((row) => row.key), ["alpha", "beta", "gamma"]);
  assert.deepEqual(review.rows.map((row) => row.share), [0.6, 0.2, 0.1]);
  // The description names the FIELD the cluster was grouped on and the value in
  // it. No prompt text reaches this module: `residueClusterKey` reads four
  // structural fields and none of them is the excerpt.
  assert.equal(residueDimension(CORPUS[1]).field, "vendor");
  assert.equal(review.rows[0].description, "Billed vendor · alpha");
  for (const row of review.rows) {
    assert.equal(row.description.includes("zzz"), false, "no excerpt may reach a row");
    // The control's accessible name identifies the cluster, not "Assign".
    assert.match(row.controlLabel, /^Class for Billed vendor · /);
    assert.match(row.controlLabel, /% of scored billed tokens/);
  }
  assert.equal(review.unitLabel, "billed tokens");
});

test("a label moves coverage, and it moves it through familyCoverage", () => {
  const labels = new Map([["alpha", FIRST_CLASS]]);
  const review = residueReview(CORPUS, labels);

  // The assisted result is what the ONE aggregation returns for the same
  // records with the label written in — not a second calculation beside it.
  const expected = familyCoverage(applyLeadLabels(CORPUS, labels));
  assert.equal(review.assisted.scoredShare, expected.scoredShare);
  assert.equal(review.assisted.scoredSpend, expected.scoredSpend);
  assert.deepEqual(review.assisted.residue.map((cluster) => cluster.key),
    expected.residue.map((cluster) => cluster.key));

  assert.equal(review.unassisted.scoredShare, 0.1);
  assert.equal(review.assisted.scoredShare, 0.7);
  assert.equal(review.assisted.scoredDenominator, review.unassisted.scoredDenominator,
    "a label classifies spend; it never invents or removes any");
  // The prioritized next action is recomposed off the smaller residue.
  assert.match(review.assisted.residueAction.text, /beta/);
  assert.equal(review.unassisted.residueAction.text.includes("alpha"), true);

  // Records are copied, never mutated, which is what keeps the unassisted
  // reading recoverable rather than reconstructed.
  assert.equal(CORPUS[1].category, undefined);
  assert.equal(applyLeadLabels(CORPUS, labels)[1].category, FIRST_CLASS);
  assert.equal(residueClusterKey(CORPUS[1]), "alpha");
});

test("enough coverage crosses the bar and the letter appears, on the published gate", () => {
  const literacy = gradeableLiteracy();
  const before = residueReview(CORPUS);
  assert.equal(before.unassisted.eligibility.showGrade, false);
  const withheld = orgQueryCoachingDecision(literacy,
    { origin: "import", familyCoverage: before.assisted });
  assert.equal(withheld.state, ORG_QUERY_DECISION_STATE.ungradeable);
  assert.equal(withheld.benchmark, undefined, "no letter under the coverage floor");

  const after = residueReview(CORPUS, new Map([["alpha", FIRST_CLASS]]));
  assert.equal(after.assisted.eligibility.showGrade, true);
  const graded = orgQueryCoachingDecision(literacy,
    { origin: "import", familyCoverage: after.assisted });
  assert.equal(graded.state, ORG_QUERY_DECISION_STATE.graded);
  assert.ok(graded.benchmark.grade, "the letter grade appears once coverage crosses");
  assert.equal(graded.coverage.share, after.assisted.scoredShare);
});

test("genuinely unclassifiable is recorded, is not an unanswered cluster, and adds nothing", () => {
  const review = residueReview(CORPUS, new Map([["alpha", RESIDUE_UNCLASSIFIABLE]]));
  assert.equal(review.assisted.scoredShare, review.unassisted.scoredShare,
    "declining to classify must not move coverage by a point");
  assert.equal(review.assist.count, 0, "it is not a lead-supplied label the figure rests on");
  assert.equal(review.assist.applied, false);
  assert.equal(review.assist.marker, "");
  assert.equal(review.assist.unclassifiableCount, 1);
  assert.match(review.assist.unclassifiableText, /adds nothing to coverage/);

  const row = review.rows[0];
  assert.equal(row.assigned, RESIDUE_UNCLASSIFIABLE);
  assert.equal(row.assignedLabel, "Genuinely unclassifiable");
  // And it is a different state from a row nobody has answered.
  assert.equal(review.rows[1].assigned, "");
  assert.equal(review.rows[1].assignedLabel, "Not assigned");
  assert.equal(review.assist.pending, 2);
  // It also leaves the cluster out of what this control can still reach.
  const ceiling = residueReview(CORPUS,
    new Map([["alpha", RESIDUE_UNCLASSIFIABLE]])).ceiling;
  assert.equal(Number(ceiling.share.toFixed(2)), 0.4);
});

test("the marker counts the labels the figure rests on and keeps the export's own result", () => {
  const review = residueReview(CORPUS,
    new Map([["beta", FIRST_CLASS], ["gamma", FIRST_CLASS], ["alpha", RESIDUE_UNCLASSIFIABLE]]));
  assert.equal(review.assist.count, 2);
  assert.match(review.assist.marker, /Includes 2 lead-supplied labels/);
  assert.match(review.assist.marker, /Your export alone: /);
  // The unassisted reading stays recoverable, in words and as a number.
  assert.equal(review.assist.unassistedShare, 0.1);
  assert.equal(review.assist.unassistedShowGrade, false);
  assert.ok(review.assist.unassistedText.startsWith("10.0%"));
  assert.match(review.announcement, /Coverage is now 40\.0% of scored billed tokens/);
  assert.match(review.announcement, /Your export alone: 10\.0%/);

  const one = residueReview(CORPUS, new Map([["gamma", FIRST_CLASS]]));
  assert.match(one.assist.marker, /Includes 1 lead-supplied label,/);
});

test("the visible list is capped, the cap is stated, and the tail stays in the denominator", () => {
  const corpus = tailCorpus();
  const review = residueReview(corpus);
  assert.equal(review.rows.length, 5);
  assert.equal(review.cap.hidden, 40);
  assert.match(review.cap.text, /Showing the 5 largest unclassified clusters of 45/);
  assert.match(review.cap.text, /stay in the coverage denominator/);
  // The tail is in the arithmetic whether or not it is on screen: 106 tokens.
  assert.equal(review.unassisted.scoredDenominator, 106);
  assert.equal(Number(review.cap.hiddenShare.toFixed(4)),
    Number((80 / 106).toFixed(4)));

  // And labelling every cluster this control OFFERS still does not cross, which
  // is said rather than left for the reader to discover one select at a time.
  assert.equal(review.ceiling.reachable, false);
  assert.match(review.ceiling.text, /still under the bar/);
  assert.equal(Number(review.ceiling.share.toFixed(4)), Number((26 / 106).toFixed(4)));

  // On a corpus whose residue is reachable, the same sentence says so.
  assert.equal(residueReview(CORPUS).ceiling.reachable, true);
});

test("zero residue and a single cluster both render a coherent model", () => {
  const clean = residueReview([classifiable("keeper", 10)]);
  assert.deepEqual(clean.rows, []);
  assert.match(clean.empty, /Nothing is unclassified in this corpus/);
  assert.equal(clean.chip, "no residue");
  assert.equal(clean.assist.applied, false);

  const single = residueReview([classifiable("keeper", 90), residual("only", 10)]);
  assert.equal(single.rows.length, 1);
  assert.equal(single.empty, null);
  assert.match(single.cap.text, /Every unclassified cluster in this corpus is listed: 1 cluster/);

  // Nothing to review at all is null rather than an empty panel's worth of model.
  assert.equal(residueReview([]), null);
});

test("a label for a cluster this corpus does not have is ignored, not counted", () => {
  const review = residueReview(CORPUS, new Map([["a-cluster-from-another-file", FIRST_CLASS]]));
  assert.equal(review.assist.count, 0);
  assert.equal(review.assisted.scoredShare, review.unassisted.scoredShare);
  assert.equal(review.announcement, null);
});

/* ------------------------------- the surface -------------------------------- */

const section = (document) => document.getElementById(ORG_COACHING_SECTION_ID);
const body = (document) => document.getElementById(ORG_COACHING_BODY_ID);
const live = (document) => document.getElementById(ORG_COACHING_LIVE_ID);
const residueToggle = (document) => document.getElementById(toggleId(ORG_COACHING_RESIDUE_ID));
const residuePanel = (document) => document.getElementById(panelId(ORG_COACHING_RESIDUE_ID));

/**
 * The page's own wiring, in the shape `evolution-page.js` uses it: one label
 * map, one review off the records, one decision off the review's assisted
 * result. A test that assembled the state differently would be testing a
 * surface the product does not ship.
 */
function mount(document, records, { labels = new Map() } = {}) {
  const literacy = gradeableLiteracy();
  const render = () => {
    const review = residueReview(records, labels);
    applyOrgQueryDecision(document, orgQueryCoachingDecision(literacy, {
      origin: "import", fileNames: ["my-export.csv"], familyCoverage: review?.assisted ?? null,
    }), {
      review,
      onAssign: (key, value) => {
        if (isResidueLabel(value)) labels.set(key, value); else labels.delete(key);
        render();
      },
    });
    return review;
  };
  // Idempotent: the disclosure keeps its open state across a repaint of the same
  // sample, which is the behaviour this region already had.
  const open = () => {
    const toggle = residueToggle(document);
    if (toggle.getAttribute("aria-expanded") === "false") toggle.click();
  };
  return { render, labels, open };
}

test("the residue review is a sibling disclosure inside the region, not a new panel", async () => {
  const { document } = await loadPage(PAGE);
  const surface = mount(document, CORPUS);
  surface.render();

  // It is inside the existing disclosure group, beside the four read-only ones.
  const group = body(document).querySelector(".org-coaching-disclosures");
  assert.ok(group, "the disclosure group must still be the only home for these");
  const blocks = group.querySelectorAll(".org-coaching-disclosure");
  assert.equal(blocks[blocks.length - 1].dataset.disclosure, ORG_COACHING_RESIDUE_ID);
  assert.equal(document.querySelectorAll("dialog").length, 0, "no modal is introduced");

  const toggle = residueToggle(document);
  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), panelId(ORG_COACHING_RESIDUE_ID));
  assert.equal(residuePanel(document).hidden, true);
  assert.match(textOf(toggle), /Can I classify the residue myself\?/);
  assert.match(textOf(toggle), /3 clusters · 0 labelled/);

  surface.open();
  assert.equal(residueToggle(document).getAttribute("aria-expanded"), "true");
  assert.equal(residuePanel(document).hidden, false);
  // Opening a panel is not a recompute and must not speak.
  assert.equal(live(document).textContent.includes("lead-supplied"), false);
});

test("each cluster has a keyboard-operable control named for the cluster it assigns", async () => {
  const { document } = await loadPage(PAGE);
  const surface = mount(document, CORPUS);
  const review = surface.render();
  surface.open();

  const rows = residuePanel(document).querySelectorAll(".org-coaching-residue-row");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.dataset.cluster), ["alpha", "beta", "gamma"]);

  const select = document.getElementById(residueControlId(1));
  assert.equal(select.tagName, "SELECT", "a native control, not a custom listbox");
  // The trap this harness sets: its `<select>` accepts any value a real one
  // would refuse, so the OPTION SET is what gets asserted, not just a write.
  assert.deepEqual(select.options.map((option) => option.getAttribute("value")),
    RESIDUE_LABEL_CHOICES.map((choice) => choice.value));
  assert.deepEqual(select.options.map((option) => textOf(option)),
    RESIDUE_LABEL_CHOICES.map((choice) => choice.label));
  assert.equal(select.value, "", "an unanswered cluster starts unassigned");

  // The accessible name is a real `<label for>` carrying the cluster, its share
  // and its record count — visible text, so it is also the name a speech-control
  // user says.
  const label = residuePanel(document).querySelector(".org-coaching-residue-name");
  assert.equal(label.getAttribute("for"), select.id);
  assert.equal(textOf(label), review.rows[0].controlLabel);
  assert.match(textOf(label), /Billed vendor · alpha/);
  assert.equal(textOf(rows[0].querySelector(".org-coaching-residue-state-text")),
    "Assigned: Not assigned");
});

test("assigning a cluster recomputes coverage, the headline, and the next action in place", async () => {
  const { document } = await loadPage(PAGE);
  const surface = mount(document, CORPUS);
  surface.render();
  surface.open();

  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.ungradeable);
  const before = textOf(body(document).querySelector(".org-coaching-coverage-text"));
  assert.ok(before.startsWith("10.0%"), `expected the unassisted share, got: ${before}`);

  const select = document.getElementById(residueControlId(1));
  select.value = FIRST_CLASS;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));

  // Same region, no reload: the number, the letter and the action all moved.
  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.graded);
  assert.ok(textOf(body(document).querySelector(".org-coaching-coverage-text")).startsWith("70.0%"));
  assert.ok(textOf(body(document).querySelector(".org-coaching-letter")).length > 0,
    "the letter grade appears in the same region");
  assert.match(textOf(body(document).querySelector(".org-coaching-coverage-action")), /beta/);
  // ONE label is not an announcement. Two clusters are still open, so the pass
  // is not over and the polite region says nothing — the change reached the
  // reader through the row they are standing in, not through an interruption.
  assert.doesNotMatch(live(document).textContent, /Coverage is now 70\.0%/,
    "a per-item label must not write the whole coverage paragraph into the live region");

  // The panel stayed open and the keyboard stayed on the control it was on.
  assert.equal(residuePanel(document).hidden, false);
  assert.equal(document.activeElement?.id, residueControlId(1));
  assert.equal(document.getElementById(residueControlId(1)).value, FIRST_CLASS);
  assert.equal(textOf(residuePanel(document).querySelector(".org-coaching-residue-state-text")),
    "Assigned: High-value");

  // Leaving the pass — collapsing the panel — is where the one summary lands,
  // and it carries the count and the figure it produced.
  residueToggle(document).click();
  assert.match(live(document).textContent, /Coverage is now 70\.0% of scored billed tokens/);
  assert.match(live(document).textContent, /1 lead-supplied label/);
  assert.match(live(document).textContent, /A letter grade is shown/);
});

test("the keyboard alone can assign a cluster", async () => {
  const { document } = await loadPage(PAGE);
  const surface = mount(document, CORPUS);
  surface.render();
  surface.open();

  document.getElementById(residueControlId(3)).focus();
  pressKey(document, "ArrowDown");

  assert.equal(surface.labels.get("gamma"), RESIDUE_LABEL_CHOICES[1].value);
  assert.ok(textOf(body(document).querySelector(".org-coaching-coverage-text")).startsWith("20.0%"));
  assert.equal(document.activeElement?.id, residueControlId(3));
});

test("the lead-supplied marker rides with every assisted number in the region", async () => {
  const { document } = await loadPage(PAGE);
  const surface = mount(document, CORPUS, { labels: new Map([["alpha", FIRST_CLASS]]) });
  surface.render();
  surface.open();

  const markers = body(document).querySelectorAll(".org-coaching-assist");
  assert.ok(markers.length >= 3,
    "the marker belongs on the lead, on the coverage line, and in the review");
  for (const marker of markers) {
    assert.equal(marker.dataset.labelCount, "1");
    assert.match(textOf(marker), /Includes 1 lead-supplied label,/);
    // The unassisted result stays visible beside the assisted one.
    assert.match(textOf(marker), /Your export alone: 10\.0%/);
  }
  // It is in the lead block itself, beside the letter, and not in a tooltip.
  const lead = body(document).querySelector(".org-coaching-lead");
  assert.ok(lead.querySelector(".org-coaching-assist"), "the graded lead must carry the marker");
  assert.equal(body(document).querySelector(".org-coaching-coverage").dataset.assisted, "true");
  assert.equal(document.querySelectorAll("[title]").length, 0, "no marker hides in a tooltip");
});

test("a cluster called unclassifiable is shown as answered and inflates nothing", async () => {
  const { document } = await loadPage(PAGE);
  const surface = mount(document, CORPUS);
  surface.render();
  surface.open();

  const select = document.getElementById(residueControlId(1));
  select.value = RESIDUE_UNCLASSIFIABLE;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));

  assert.ok(textOf(body(document).querySelector(".org-coaching-coverage-text")).startsWith("10.0%"),
    "coverage is exactly what the export earned alone");
  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.ungradeable);
  assert.equal(body(document).querySelectorAll(".org-coaching-assist").length, 0,
    "there is no assisted figure to mark");
  const row = residuePanel(document).querySelector(".org-coaching-residue-row");
  assert.equal(row.dataset.assigned, RESIDUE_UNCLASSIFIABLE);
  assert.equal(textOf(row.querySelector(".org-coaching-residue-state-text")),
    "Assigned: Genuinely unclassifiable");
  assert.match(textOf(residuePanel(document).querySelector(".org-coaching-residue-unclassifiable")),
    /1 cluster is marked genuinely unclassifiable/);
});

test("an empty residue and a capped one both render something to read", async () => {
  const { document } = await loadPage(PAGE);
  const clean = mount(document, [classifiable("keeper", 10)]);
  clean.render();
  clean.open();
  assert.equal(residuePanel(document).querySelectorAll(".org-coaching-residue-row").length, 0);
  assert.match(textOf(residuePanel(document).querySelector(".org-coaching-residue-empty")),
    /Nothing is unclassified in this corpus/);

  const capped = mount(document, tailCorpus());
  capped.render();
  capped.open();
  assert.equal(residuePanel(document).querySelectorAll(".org-coaching-residue-row").length, 5);
  assert.match(textOf(residuePanel(document).querySelector(".org-coaching-residue-cap")),
    /Showing the 5 largest unclassified clusters of 45/);
  assert.match(textOf(residuePanel(document).querySelector(".org-coaching-residue-ceiling")),
    /still under the bar/);
});

test("clearing the surface drops the labels, the marker, and the assisted figure", async () => {
  const { document } = await loadPage(PAGE);
  const surface = mount(document, CORPUS, { labels: new Map([["alpha", FIRST_CLASS]]) });
  surface.render();
  assert.equal(body(document).querySelectorAll(".org-coaching-assist").length > 0, true);

  clearOrgQueryDecision(document);
  assert.equal(section(document).hidden, true);
  assert.equal(textOf(body(document)), "");

  // Reading a different corpus afterwards starts from the unassisted result: the
  // page drops the map with the files, and a label that survived would be an
  // answer about an export that is no longer loaded.
  const next = mount(document, CORPUS);
  next.render();
  assert.equal(body(document).querySelectorAll(".org-coaching-assist").length, 0);
  assert.ok(textOf(body(document).querySelector(".org-coaching-coverage-text")).startsWith("10.0%"));
  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.ungradeable);
});

/* ------------------------------ the front door ------------------------------- */

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

const coverageText = (document) =>
  textOf(body(document).querySelector(".org-coaching-coverage-text"));

test("the shipped page carries the control, recomputes on it, and drops it on discard",
  async () => {
    const { document } = await openFinopsTab();
    document.getElementById("grade-example-org-query-sample").click();

    // The disclosure the page paints, on the page's own wiring — not on a state
    // this file assembled.
    const toggle = residueToggle(document);
    assert.ok(toggle, "the page entry must render the residue review");
    assert.match(textOf(toggle), /2 clusters · 0 labelled/);
    const unassisted = coverageText(document);
    assert.ok(unassisted.startsWith("96.4%"), `unexpected unassisted share: ${unassisted}`);
    assert.equal(body(document).querySelectorAll(".org-coaching-assist").length, 0);

    toggle.click();
    const select = document.getElementById(residueControlId(1));
    assert.match(textOf(residuePanel(document).querySelector(".org-coaching-residue-name")),
      /^Class for Model · /);
    select.value = FIRST_CLASS;
    select.dispatchEvent(new DomEvent("change", { bubbles: true }));

    assert.ok(coverageText(document).startsWith("99.4%"),
      `the label must move the page's own coverage figure: ${coverageText(document)}`);
    const markers = body(document).querySelectorAll(".org-coaching-assist");
    assert.ok(markers.length >= 3, "every assisted figure in the region carries the marker");
    assert.equal(markers[0].dataset.labelCount, "1");
    assert.match(textOf(markers[0]), /Your export alone: 96\.4%/);
    // Silent per row, one sentence on the way out: the figures above moved
    // without the region re-reading the whole paragraph at the reader.
    assert.doesNotMatch(live(document).textContent, /1 lead-supplied label/);
    residueToggle(document).click();
    assert.match(live(document).textContent, /1 lead-supplied label/);

    // Discarding everything hands the section back, and reading the same corpus
    // again earns exactly what it earned alone.
    document.getElementById("local-file-discard").click();
    assert.equal(section(document).hidden, true);

    document.getElementById("grade-example-org-query-sample").click();
    assert.equal(coverageText(document), unassisted);
    assert.equal(body(document).querySelectorAll(".org-coaching-assist").length, 0,
      "the provenance marker disappears with the labels");
    assert.match(textOf(residueToggle(document)), /2 clusters · 0 labelled/);
  });
