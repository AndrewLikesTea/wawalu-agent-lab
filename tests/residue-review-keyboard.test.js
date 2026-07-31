// The correction pass on /evolution.html, as a keyboard and screen-reader user
// meets it.
//
// The list this file drives is the residue review: the clusters the classifier
// could not place, one row each, with the reader's own class on it. Before this
// change the list was N tab stops, published no position, and read the whole
// coverage paragraph into the polite region after every single row. This file
// pins the four properties that fixed that, and it pins them on the SHIPPED
// markup of src/evolution.html painted by the shipped view module — never on a
// fixture authored here.
//
// Two harness traps this file works around deliberately:
//
//   1. `tabSequence` only walks a,button,input,select,textarea,summary — a
//      roving `<li>` is invisible to it. So the single-tab-stop claim is
//      asserted on the tabindex attributes themselves and on how the count of
//      tabbable nodes inside the list behaves as the list grows, not on the
//      harness's idea of Tab order.
//   2. The harness's `<select>` accepts values a real one would refuse. So
//      nothing here concludes "reachable" from a value that was written; the
//      assertions that matter are on `document.activeElement` and on tabindex.

import test from "node:test";
import assert from "node:assert/strict";

import { DomEvent, loadPage, pressKey, tabSequence, textOf } from "./support/browser.js";
import { orgQueryCoachingDecision } from "../src/org-query-decision.js";
import {
  ORG_COACHING_LIVE_ID, ORG_COACHING_RESIDUE_ID, RESIDUE_LIST_ID, RESIDUE_PROGRESS_ID,
  applyOrgQueryDecision, panelId, residueControlId, residueItemId, residueNameId,
  residueStateId, toggleId,
} from "../src/org-query-decision-view.js";
import {
  RESIDUE_LABEL_CHOICES, RESIDUE_STATES, RESIDUE_UNCLASSIFIABLE, isResidueLabel,
  residueProgressText, residueReview,
} from "../src/residue-labeling.js";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";
import { orgQueryDepartmentLiteracy } from "../src/org-query-scoring.js";
import { orgQuerySampleResult } from "../src/org-query-source.js";
import { loadExampleOrgQuerySample } from "../src/org-query-example.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const FIRST_CLASS = PROMPT_LITERACY_RUBRIC.categories[0].key;

const classifiable = (vendor, tokens) => ({
  orgUnitId: "unit-a",
  vendor,
  model: "gpt-3.5-turbo",
  promptExcerpt: "Context: quarterly close. Constraints: no customer names. "
    + "Acceptance criteria: reconciles to the ledger.",
  inputTokens: tokens,
  outputTokens: 0,
});

const residual = (vendor, tokens) => ({
  orgUnitId: "unit-a",
  vendor,
  model: "gpt-3.5-turbo",
  promptExcerpt: "zzz",
  inputTokens: tokens,
  outputTokens: 0,
});

/** A corpus with `count` unclassified clusters, generated here rather than committed. */
const corpusOf = (count, { name = (index) => `cluster-${index}` } = {}) => [
  classifiable("keeper", 10),
  ...Array.from({ length: count }, (unused, index) => residual(name(index), count - index)),
];

const literacyOf = () => orgQueryDepartmentLiteracy({
  results: [orgQuerySampleResult(loadExampleOrgQuerySample())],
});

const panelOf = (document) => document.getElementById(panelId(ORG_COACHING_RESIDUE_ID));
const listOf = (document) => document.getElementById(RESIDUE_LIST_ID);
const live = (document) => document.getElementById(ORG_COACHING_LIVE_ID);
const progress = (document) => document.getElementById(RESIDUE_PROGRESS_ID);
const rowsOf = (document) =>
  panelOf(document).querySelectorAll(".org-coaching-residue-row");

/**
 * The page's own wiring: one label map, one review, one decision off it.
 *
 * `limit` is passed through so a test can widen the list past the shipped cap of
 * five and drive twenty-five rows without inventing a second review model.
 */
function mount(document, records, { labels = new Map(), limit } = {}) {
  const literacy = literacyOf();
  const render = () => {
    const review = residueReview(records, labels, limit === undefined ? {} : { limit });
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
  const open = () => {
    const toggle = document.getElementById(toggleId(ORG_COACHING_RESIDUE_ID));
    if (toggle.getAttribute("aria-expanded") === "false") toggle.click();
  };
  return { render, open, labels };
}

async function openList(records, options = {}) {
  const { document } = await loadPage(PAGE);
  const surface = mount(document, records, options);
  const review = surface.render();
  surface.open();
  return { document, surface, review };
}

/* ------------------------------- one tab stop ------------------------------- */

test("the list is one tab stop and its size does not change how many", async () => {
  const small = await openList(corpusOf(3), { limit: 25 });
  const large = await openList(corpusOf(25), { limit: 25 });

  assert.equal(rowsOf(small.document).length, 3);
  assert.equal(rowsOf(large.document).length, 25);

  // The claim, on the attributes rather than on the harness's Tab walk: exactly
  // one row is in the page's tab order, and exactly one control inside the list
  // is, whatever the list's length. Twenty-five rows add the same two stops
  // three rows do — the reader Tabs to the row they left off at, Tabs to that
  // row's own class control, and Tabs out of the panel.
  for (const { document, size } of [
    { document: small.document, size: 3 }, { document: large.document, size: 25 },
  ]) {
    const rows = rowsOf(document);
    assert.equal(rows.length, size);
    assert.deepEqual(
      rows.map((row) => row.getAttribute("tabindex")),
      ["0", ...Array.from({ length: size - 1 }, () => "-1")],
      "the first row holds the tab stop and every other row is removed from the order");
    const selects = listOf(document).querySelectorAll(".org-coaching-residue-select");
    assert.equal(selects.filter((node) => node.getAttribute("tabindex") !== "-1").length, 1,
      "only the active row's control stays in the tab order");
  }

  // And the harness's own Tab walk agrees on the part it can see: the number of
  // tabbable controls on the whole page is the same with twenty-five rows as
  // with three, so the list is not walking the reader through its length.
  const tabbable = (document) => {
    const inside = new Set(listOf(document)
      .querySelectorAll("a,button,input,select,textarea,summary"));
    return tabSequence(document).filter((node) => inside.has(node)).length;
  };
  assert.equal(tabbable(small.document), 1);
  assert.equal(tabbable(large.document), 1,
    "twenty-two more clusters must not be twenty-two more tab stops");
});

test("arrows move the tab stop and the focus together, and do not wrap", async () => {
  const { document } = await openList(corpusOf(4), { limit: 25 });
  const rows = rowsOf(document);
  rows[0].focus();

  pressKey(document, "ArrowDown");
  assert.equal(document.activeElement, rows[1], "ArrowDown moves DOM focus, not just a class");
  assert.equal(rows[1].getAttribute("tabindex"), "0");
  assert.equal(rows[0].getAttribute("tabindex"), "-1");
  assert.equal(rows[1].querySelector(".org-coaching-residue-select").getAttribute("tabindex"), "0");
  assert.equal(rows[0].querySelector(".org-coaching-residue-select").getAttribute("tabindex"), "-1");

  // The horizontal pair reads the same way: the row reflows to name-then-control
  // across the line at wide widths, so a reader may reasonably try either.
  pressKey(document, "ArrowRight");
  assert.equal(document.activeElement, rows[2]);
  pressKey(document, "ArrowLeft");
  assert.equal(document.activeElement, rows[1]);
  pressKey(document, "ArrowUp");
  assert.equal(document.activeElement, rows[0]);

  // No wrapping, in either direction. Home and End are the way to the ends.
  pressKey(document, "ArrowUp");
  assert.equal(document.activeElement, rows[0], "ArrowUp at the top must not jump to the bottom");
  pressKey(document, "End");
  assert.equal(document.activeElement, rows[3]);
  pressKey(document, "ArrowDown");
  assert.equal(document.activeElement, rows[3], "ArrowDown at the end must not jump to the top");
  pressKey(document, "Home");
  assert.equal(document.activeElement, rows[0]);
});

test("arrow keys inside the class control still belong to the control", async () => {
  const { document, surface } = await openList(corpusOf(3), { limit: 25 });
  const rows = rowsOf(document);
  const select = document.getElementById(residueControlId(3));
  select.focus();

  // The list handler steps aside: ArrowDown walks this `<select>`'s options and
  // assigns the third cluster. It does not move the reader to another row.
  pressKey(document, "ArrowDown");
  assert.equal(surface.labels.get(rows[2].dataset.cluster), RESIDUE_LABEL_CHOICES[1].value,
    "the select's own arrow behaviour survived the list's keydown handler");
  assert.notEqual(document.activeElement, rowsOf(document)[0],
    "the arrow must not have been hijacked into moving the row");
});

/* --------------------------- focus after a label ---------------------------- */

test("labelling a row leaves the keyboard inside that row, not at the top", async () => {
  const { document } = await openList(corpusOf(4), { limit: 25 });
  const third = rowsOf(document)[2];
  const cluster = third.dataset.cluster;
  const select = third.querySelector(".org-coaching-residue-select");

  select.focus();
  select.value = FIRST_CLASS;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));

  // The panel repainted: these are new nodes. Focus is re-established on the row
  // the reader answered — found by cluster, so it survives the row moving.
  const after = rowsOf(document);
  const same = after.find((row) => row.dataset.cluster === cluster);
  assert.ok(same, "the cluster is still in the list after it was labelled");
  assert.equal(document.activeElement, same.querySelector(".org-coaching-residue-select"),
    "focus stayed on the control inside the row that was just labelled");
  assert.notEqual(document.activeElement, null, "focus did not fall to document.body");
  assert.notEqual(document.activeElement, after[0], "focus did not jump to the top of the list");
  // And the tab stop moved with it, so Tab out and back returns here.
  assert.equal(same.getAttribute("tabindex"), "0");
  assert.equal(after.filter((row) => row.getAttribute("tabindex") === "0").length, 1);
  assert.match(textOf(progress(document)), /Item 3 of 4/);

  // Clearing the same row keeps the reader in the same place.
  const cleared = document.activeElement;
  cleared.value = "";
  cleared.dispatchEvent(new DomEvent("change", { bubbles: true }));
  const back = rowsOf(document).find((row) => row.dataset.cluster === cluster);
  assert.equal(document.activeElement, back.querySelector(".org-coaching-residue-select"));
  assert.equal(back.dataset.state, RESIDUE_STATES.unreviewed.key);
});

/* ------------------------------ item N of M --------------------------------- */

test("position is published to assistive tech and drawn in the panel", async () => {
  const { document } = await openList(corpusOf(6), { limit: 25 });
  const list = listOf(document);
  assert.equal(list.getAttribute("role"), "list",
    "the position each row publishes is only meaningful inside a list that says it is one");

  const rows = rowsOf(document);
  assert.deepEqual(rows.map((row) => row.getAttribute("role")),
    Array.from({ length: 6 }, () => "listitem"),
    "aria-posinset is on the role that carries it, not bolted onto a div");
  assert.deepEqual(rows.map((row) => row.getAttribute("aria-posinset")),
    ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(new Set(rows.map((row) => row.getAttribute("aria-setsize"))), new Set(["6"]));
  assert.deepEqual(rows.map((row) => row.id), rows.map((row, index) => residueItemId(index + 1)));

  // Visible, in the panel, on the meta type role — not screen-reader-only.
  const line = progress(document);
  assert.equal(textOf(line), "Item 1 of 6");
  assert.notEqual(line.hidden, true);
  assert.equal(line.tagName, "P", "position is supporting meta, not a heading");
  assert.equal(line.getAttribute("aria-live"), null,
    "the position follows focus; a live region would announce it twice");

  rows[0].focus();
  pressKey(document, "ArrowDown");
  pressKey(document, "ArrowDown");
  assert.equal(textOf(progress(document)), "Item 3 of 6", "the visible line follows the active row");
  pressKey(document, "End");
  assert.equal(textOf(progress(document)), "Item 6 of 6");
});

test("an empty list degrades rather than counting to zero", async () => {
  // Zero clusters: nothing is unclassified in this corpus.
  const { document } = await openList([classifiable("keeper", 10)]);
  assert.equal(rowsOf(document).length, 0);
  assert.equal(listOf(document), null, "no list is drawn when there is nothing to list");
  assert.equal(textOf(progress(document)), "No clusters to review.");
  assert.doesNotMatch(textOf(panelOf(document)), /Item 0 of 0/);
  assert.match(textOf(panelOf(document).querySelector(".org-coaching-residue-empty")),
    /Nothing is unclassified in this corpus/);
  // Nothing was corrected, so leaving produces no summary rather than an empty one.
  assert.doesNotMatch(live(document).textContent, /lead-supplied label/);

  // And the model says the same thing on its own, with no DOM in the way.
  assert.equal(residueProgressText(0, 0), "No clusters to review.");
  assert.equal(residueProgressText(1, 0), "No clusters to review.");
  assert.equal(residueProgressText(1, 1), "Item 1 of 1");
  assert.equal(residueProgressText(99, 4), "Item 4 of 4", "a position past the end is clamped");
});

test("a one-row list reads as a list of one", async () => {
  const { document } = await openList(corpusOf(1), { limit: 25 });
  const rows = rowsOf(document);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].getAttribute("aria-posinset"), "1");
  assert.equal(rows[0].getAttribute("aria-setsize"), "1");
  assert.equal(rows[0].getAttribute("tabindex"), "0");
  assert.equal(textOf(progress(document)), "Item 1 of 1");

  // Every traversal key is a no-op on a list of one, and none of them lose focus.
  rows[0].focus();
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    pressKey(document, key);
    assert.equal(document.activeElement, rowsOf(document)[0], `${key} lost the only row`);
  }
});

test("a very long cluster name does not break the reading order", async () => {
  const long = "a".repeat(600);
  const { document } = await openList(corpusOf(2, { name: (index) => (index ? "short" : long) }),
    { limit: 25 });
  const rows = rowsOf(document);
  assert.equal(rows.length, 2);

  // The name is long; the structure around it is unchanged. Position, state and
  // the tab stop all still read, and the row order is still share order.
  assert.ok(textOf(rows[0].querySelector(".org-coaching-residue-name")).includes(long),
    "the whole name is rendered rather than truncated into the DOM");
  assert.deepEqual(rows.map((row) => row.getAttribute("aria-posinset")), ["1", "2"]);
  assert.equal(textOf(progress(document)), "Item 1 of 2");
  assert.equal(rows[0].getAttribute("aria-labelledby"),
    `${residueNameId(1)} ${residueStateId(1)}`);
  rows[0].focus();
  pressKey(document, "End");
  assert.equal(document.activeElement, rowsOf(document)[1], "traversal still reaches the last row");
});

/* -------------------------- state without colour ---------------------------- */

test("each of the three states is a word and a shape, not a tint", async () => {
  const { document, surface } = await openList(corpusOf(3), { limit: 25 });
  const clusters = rowsOf(document).map((row) => row.dataset.cluster);

  const assign = (index, value) => {
    const select = rowsOf(document)[index].querySelector(".org-coaching-residue-select");
    select.value = value;
    select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  };
  assign(0, FIRST_CLASS);
  assign(1, RESIDUE_UNCLASSIFIABLE);

  const rows = rowsOf(document);
  assert.deepEqual(rows.map((row) => row.dataset.state),
    [RESIDUE_STATES.labelled.key, RESIDUE_STATES.unclassifiable.key,
      RESIDUE_STATES.unreviewed.key]);
  assert.deepEqual(clusters, rows.map((row) => row.dataset.cluster),
    "answering a row must not reorder the list underneath the reader");

  const seenWords = new Set();
  const seenShapes = new Set();
  for (const row of rows) {
    const chip = row.querySelector(".org-coaching-residue-state");
    const words = textOf(chip.querySelector(".org-coaching-residue-state-text"));
    const shape = chip.querySelector(".org-coaching-shape");

    // 1. A word. Delete every colour on this page and the row still says which
    //    of the three states it is in.
    assert.ok(words.length > 0, "the state chip carries no text at all");
    seenWords.add(words);
    // 2. A shape, and it is decoration over that word rather than the meaning.
    assert.equal(shape.getAttribute("aria-hidden"), "true");
    assert.ok(textOf(shape).length > 0);
    seenShapes.add(textOf(shape));
    // 3. It reaches assistive tech as text: the row's accessible name is
    //    composed of the visible cluster name and the visible state.
    assert.equal(row.getAttribute("aria-labelledby"),
      `${residueNameId(Number(row.getAttribute("aria-posinset")))} `
      + `${residueStateId(Number(row.getAttribute("aria-posinset")))}`);
    assert.equal(chip.id, residueStateId(Number(row.getAttribute("aria-posinset"))));
  }
  assert.equal(seenWords.size, 3, "two states read the same with colour removed");
  assert.equal(seenShapes.size, 3, "two states draw the same shape");

  // The shapes are the page's squares, with the meanings it already publishes —
  // no provenance diamond is doing a status job here.
  assert.deepEqual([...seenShapes].sort(),
    [RESIDUE_STATES.labelled.shape, RESIDUE_STATES.unclassifiable.shape,
      RESIDUE_STATES.unreviewed.shape].sort());
  for (const shape of seenShapes) {
    assert.ok(!"◇◆◈".includes(shape), `${shape} is a provenance diamond, not a review state`);
  }
  assert.equal(surface.labels.size, 2);
});

/* ------------------------- the announcement budget -------------------------- */

test("a pass over many rows is quiet per row and one sentence at the end", async () => {
  const { document } = await openList(corpusOf(8), { limit: 25 });
  const before = live(document).textContent;

  const labelled = [];
  for (let index = 0; index < 5; index += 1) {
    const row = rowsOf(document)[index];
    labelled.push(row.dataset.cluster);
    const select = row.querySelector(".org-coaching-residue-select");
    select.value = FIRST_CLASS;
    select.dispatchEvent(new DomEvent("change", { bubbles: true }));
    // Five labels, and the polite region has not been rewritten once: a reader
    // working the list is not interrupted per row.
    assert.equal(live(document).textContent, before,
      `row ${index + 1} wrote its own sentence into the live region`);
  }

  // Leaving the pass — collapsing the panel — writes exactly one consolidated
  // update, and it carries both the count of corrections and the figure they
  // produced. One write, so a screen reader has one thing to say.
  document.getElementById(toggleId(ORG_COACHING_RESIDUE_ID)).click();
  const summary = live(document).textContent;
  assert.notEqual(summary, before);
  assert.match(summary, /5 lead-supplied labels/);
  assert.match(summary, /Coverage is now \d+\.\d%/);
  assert.match(summary, /Your export alone: \d+\.\d%/);
  assert.equal(summary.match(/lead-supplied label/g).length, 1,
    "the corrections are named once, not once per row queued behind each other");
  assert.equal(summary.match(/Coverage is now/g).length, 1);

  // The region it was written into is the one the page already ships, present in
  // the document before anything was written to it, and polite.
  const region = live(document);
  assert.equal(region.getAttribute("aria-live"), "polite");
  assert.equal(region.getAttribute("aria-atomic"), "true");
  assert.equal(labelled.length, 5);
});

test("answering the last open cluster completes the pass and speaks once", async () => {
  const { document } = await openList(corpusOf(2), { limit: 25 });
  const before = live(document).textContent;

  const assign = (index) => {
    const select = rowsOf(document)[index].querySelector(".org-coaching-residue-select");
    select.value = FIRST_CLASS;
    select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  };
  assign(0);
  assert.equal(live(document).textContent, before, "one of two open: still mid-pass, still quiet");
  assign(1);
  // Nothing is left open, so the pass is complete and the summary lands without
  // the reader having to leave the panel to earn it.
  assert.match(live(document).textContent, /2 lead-supplied labels/);
  assert.match(live(document).textContent, /Coverage is now/);
});

test("a pass that only marks clusters unclassifiable still gets its one summary", async () => {
  const { document } = await openList(corpusOf(2), { limit: 25 });
  for (const index of [0, 1]) {
    const select = rowsOf(document)[index].querySelector(".org-coaching-residue-select");
    select.value = RESIDUE_UNCLASSIFIABLE;
    select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  }
  // "Your answers moved nothing" is a result, not silence for the reader to
  // interpret — and the figure is still named.
  assert.match(live(document).textContent, /2 clusters marked genuinely unclassifiable/);
  assert.match(live(document).textContent, /Coverage is \d+\.\d% of scored/);
});
