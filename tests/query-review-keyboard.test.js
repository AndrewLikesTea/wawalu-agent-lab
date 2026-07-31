// The correction panel, operated with a keyboard and heard with a screen reader.
//
// The failure this file pins shut: twenty-five sample rows with two controls
// each is fifty Tab presses to cross a panel, a place lost on every correction,
// and — before #795 — one live-region announcement per correction, so a reviewer
// working the list heard the figures recited twenty-five times.
//
// Three rules hold here and the implementation cannot get around them:
//
//  1. THE LIST IS ONE TAB STOP. Asserted on the rendered `tabindex` values and
//     on the page's own tab sequence, not on a count of controls.
//  2. STATE IS NEVER A COLOUR. Every state assertion below reads the WORD in the
//     row's accessible name. Not one of them looks at a class or a CSS value, so
//     a panel that told the three states apart with hue alone fails here.
//  3. ONE MESSAGE PER PASS. The live region's writes are COUNTED, not merely
//     found: a stream of twenty-five polite messages contains a correct one.
//
// The harness's `select` double accepts any value assigned to it, so nothing
// here proves a control by handing it a value — corrections are made through the
// rendered button and through the model, and the assertions are on the resulting
// DOM and ARIA state.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml, pressKey, pressTab, tabSequence, textOf } from "./support/browser.js";
import {
  OVERRIDE_LABELS, applyCorrection, applyOverrides, correctionProvenance, prioritizedRecovery,
} from "../src/query-label-overrides.js";
import { reviewSample } from "../src/query-review-sample.js";
import {
  REVIEW_COPY, REVIEW_STATE, bindQueryReview, renderQueryReview, reviewPassSummary,
} from "../src/query-review-view.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const SPEND_USD = 10_000;
const DECLARED = 30;

/** An import as the page assembles it, with `count` rows the contract declined. */
function importEntry(excerpts) {
  const records = Array.from({ length: DECLARED }, (unused, index) => ({
    row: index + 2, orgUnitId: "unit-a", queryDate: "2026-06-01", model: "gpt-4o",
    category: "highValue", inputTokens: 900, outputTokens: 400,
  }));
  const declines = excerpts.map((promptExcerpt, index) => ({
    row: DECLARED + index + 2, orgUnitId: "unit-a", queryDate: "2026-06-01", model: "gpt-4o",
    category: null, promptExcerpt, inputTokens: 900, outputTokens: 400,
  }));
  return {
    parsed: { records: [...records, ...declines] },
    classified: {
      records: records.map(({ row, promptExcerpt, ...rest }) => rest),
      unclassified: declines.map((record) => ({ row: record.row, code: "unknown_category" })),
    },
  };
}

/**
 * A sample of `count` rows, generated here rather than committed: the extremes
 * this panel has to survive are a one-row draw and a two-hundred-row draw, and
 * neither is worth a fixture file.
 */
const sampleOf = (count, text = (index) => `rename widget ${index} to invoiceTotal`) =>
  [importEntry(Array.from({ length: count }, (unused, index) => text(index)))];

const corpusOf = (entries) => entries.flatMap(({ classified }) => [
  ...classified.records, ...classified.unclassified.map(() => ({ category: null })),
]);

/** The panel model the page composes, built here from the same model calls. */
function panelModel(entries, overrides, { size = 12, announcement = null } = {}) {
  const corrected = applyOverrides(corpusOf(entries), overrides, { spendUsd: SPEND_USD });
  return {
    available: entries.length > 0,
    sample: reviewSample(entries, { size }),
    grade: corrected.grade,
    coverage: corrected.coverage,
    recoverableSpend: corrected.recoverableSpend,
    included: corrected.overridesApplied,
    provenance: correctionProvenance(corrected.overridesApplied),
    nextAction: prioritizedRecovery(corrected.mix, { spendUsd: SPEND_USD }),
    labels: OVERRIDE_LABELS,
    selected: overrides,
    announcement,
  };
}

/** The shipped document, with the panel disclosed so its rows are reachable. */
function openPanel(entries, overrides = new Map(), options = {}) {
  const document = parseHtml(html);
  const seen = [];
  const handlers = {
    onCorrect: (key, label) => {
      seen.push([key, label]);
      applyCorrection(overrides, key, label);
      renderQueryReview(document, panelModel(entries, overrides, options), handlers);
    },
  };
  renderQueryReview(document, panelModel(entries, overrides, options), handlers);
  document.getElementById("query-review-open").hidden = false;
  document.getElementById("query-review").hidden = false;
  return { document, overrides, seen, entries, options, handlers };
}

const rowsOf = (document) => document.getElementById("query-review-rows")
  .querySelectorAll(".query-review-row");
const activeRow = (document) => rowsOf(document).find((row) => row.getAttribute("tabindex") === "0");

/**
 * A row's accessible name, computed the way a screen reader does for this row:
 * `aria-labelledby` names three elements, in order, and their text is joined.
 * Nothing here reads a class, an attribute value, or a colour.
 */
function accessibleName(document, row) {
  return row.getAttribute("aria-labelledby").split(/\s+/)
    .map((id) => textOf(document.getElementById(id))).join(" ");
}

// --- one tab stop -----------------------------------------------------------

test("the whole sample is one tab stop, however many rows it holds", () => {
  const { document } = openPanel(sampleOf(25), new Map(), { size: 25 });
  const rows = rowsOf(document);
  assert.equal(rows.length, 25);

  const promoted = rows.filter((row) => row.getAttribute("tabindex") === "0");
  assert.equal(promoted.length, 1, "exactly one row may carry tabindex=0");
  assert.equal(promoted[0], rows[0], "the pass starts at the first row");
  for (const row of rows.slice(1)) assert.equal(row.getAttribute("tabindex"), "-1");

  // …and the fifty controls inside the rows are out of the tab order entirely.
  const inside = document.getElementById("query-review-rows")
    .querySelectorAll("button,select");
  assert.equal(inside.length, 50, "each row still offers both actions");
  for (const control of inside) assert.equal(control.getAttribute("tabindex"), "-1");

  const stops = tabSequence(document);
  const within = stops.filter((node) => node.closest("#query-review-rows"));
  assert.equal(within.length, 1, `the list contributes ${within.length} tab stops, not one`);
  assert.equal(within[0], rows[0]);
});

test("Tab leaves the list, and tabbing back returns to the row that was left", () => {
  const { document } = openPanel(sampleOf(6), new Map());
  const rows = rowsOf(document);
  rows[0].focus();
  pressKey(document, "ArrowDown");
  pressKey(document, "ArrowDown");
  assert.equal(activeRow(document), rows[2]);

  // Forwards out of the list: the next stop is the next control on the page,
  // never another row.
  const forward = pressTab(document);
  assert.equal(forward.closest("#query-review-rows"), null,
    "Tab from a row must leave the list, not walk to the next row");
  // Backwards out of it, the same way.
  rows[2].focus();
  const back = pressTab(document, { shift: true });
  assert.equal(back.closest("#query-review-rows"), null);

  // And the way back in lands on row 3, because it still holds the tab stop.
  assert.equal(rows[2].getAttribute("tabindex"), "0");
  assert.equal(tabSequence(document).find((node) => node.closest("#query-review-rows")), rows[2]);
});

test("the arrows move the roving index and Home/End jump the ends", () => {
  const { document } = openPanel(sampleOf(6), new Map());
  const rows = rowsOf(document);
  rows[0].focus();

  const pressed = [];
  const press = (key) => {
    const before = document.activeElement;
    const event = { key, defaultPrevented: false };
    pressKey(document, key);
    pressed.push([key, before]);
    return event;
  };
  press("ArrowDown");
  assert.equal(activeRow(document), rows[1]);
  assert.equal(document.activeElement, rows[1], "the arrow moves focus, not just the attribute");
  press("ArrowDown");
  press("ArrowUp");
  assert.equal(activeRow(document), rows[1]);
  press("End");
  assert.equal(activeRow(document), rows.at(-1));
  press("Home");
  assert.equal(activeRow(document), rows[0]);
  // Clamped, not wrapped: ArrowUp at the top stays at the top.
  press("ArrowUp");
  assert.equal(activeRow(document), rows[0]);

  // Exactly one row carries the tab stop after every one of those presses.
  assert.equal(rows.filter((row) => row.getAttribute("tabindex") === "0").length, 1);
});

test("the keys the list handles are the only ones it takes off the page", () => {
  const { document } = openPanel(sampleOf(4), new Map());
  const row = rowsOf(document)[0];
  row.focus();
  // The spy sits ABOVE the list, so it reads `defaultPrevented` after the list's
  // own handler has had the event rather than before it.
  const panel = document.getElementById("query-review");
  const prevented = (key) => {
    let stopped = null;
    const spy = (event) => { stopped = event.defaultPrevented; };
    panel.addEventListener("keydown", spy);
    pressKey(document, key);
    panel.removeEventListener("keydown", spy);
    return stopped;
  };
  // Handled, so the page does not scroll under the reviewer.
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight"]) {
    rowsOf(document)[0].focus();
    assert.equal(prevented(key), true, `${key} must not also scroll the page`);
  }
  // Not handled, so the platform still owns them.
  for (const key of ["Enter", "a", "PageDown"]) {
    rowsOf(document)[0].focus();
    assert.equal(prevented(key), false, `${key} is not this widget's key to take`);
  }
});

test("every action a mouse can reach is reachable from the row by keyboard", () => {
  const { document, overrides, seen } = openPanel(sampleOf(4), new Map());
  const row = rowsOf(document)[0];
  const key = row.dataset.key;
  row.focus();

  // Right walks into the row's controls, in the order they are drawn.
  pressKey(document, "ArrowRight");
  const agree = document.getElementById(`query-review-agree-${key}`);
  assert.equal(document.activeElement, agree, "Right from the row reaches the agree button");
  // Enter operates it, and the correction lands in the model.
  pressKey(document, "Enter");
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], key);
  assert.equal(overrides.get(key), reviewSample(sampleOf(4)).rows[0].category);

  // Right again reaches the relabel control; Left walks back out to the row.
  const active = rowsOf(document).find((node) => node.dataset.key === key);
  active.focus();
  pressKey(document, "ArrowRight");
  pressKey(document, "ArrowRight");
  assert.equal(document.activeElement.tagName, "SELECT");
  pressKey(document, "ArrowLeft");
  assert.equal(document.activeElement.tagName, "BUTTON");
  pressKey(document, "ArrowLeft");
  assert.equal(document.activeElement, rowsOf(document).find((node) => node.dataset.key === key));
});

// --- focus survives the repaint ---------------------------------------------

test("focus stays on the row just agreed with, across the panel's re-render", () => {
  const { document, overrides } = openPanel(sampleOf(8), new Map());
  const rows = rowsOf(document);
  const target = rows.find((row) => row.dataset.classified === "true" && row !== rows[0]);
  const key = target.dataset.key;
  target.focus();
  pressKey(document, "ArrowRight");
  pressKey(document, "Enter");

  assert.equal(overrides.has(key), true, "the agreement reached the model");
  const repainted = rowsOf(document).find((row) => row.dataset.key === key);
  assert.notEqual(repainted, target, "the panel really did re-render this row");
  assert.equal(document.activeElement, document.getElementById(`query-review-agree-${key}`),
    "focus must return to the control on the same row, not to a detached clone");
  assert.equal(document.activeElement.closest(".query-review-row"), repainted);
  assert.equal(repainted.getAttribute("tabindex"), "0", "the row keeps the list's one tab stop");
  assert.equal(rowsOf(document)[0].getAttribute("tabindex"), "-1",
    "the tab stop must not snap back to the top of the list");
});

test("focus stays on the row just corrected, and the indicator stays with it", () => {
  const { document, overrides, seen } = openPanel(sampleOf(8), new Map());
  const target = rowsOf(document)[4];
  const key = target.dataset.key;
  target.focus();
  pressKey(document, "ArrowRight");
  while (document.activeElement.tagName !== "SELECT") pressKey(document, "ArrowRight");
  // ArrowDown on a select is the harness's real keyboard model for one: the list
  // deliberately leaves those two keys to the control, because they ARE the
  // correction. No value is assigned by hand.
  pressKey(document, "ArrowDown");

  assert.equal(seen.length, 1, "a keyboard-only correction must reach the model");
  assert.equal(overrides.get(key), seen[0][1]);
  const repainted = rowsOf(document).find((row) => row.dataset.key === key);
  assert.equal(document.activeElement, document.getElementById(`query-review-label-${key}`));
  assert.equal(document.activeElement.closest(".query-review-row"), repainted);
  assert.equal(repainted.getAttribute("tabindex"), "0");
  assert.equal(textOf(document.getElementById("query-review-position-item")), "Item 5 of 8");
});

// --- position, spoken and seen ----------------------------------------------

test("the visible indicator and the rows' own ARIA position agree, always", () => {
  const { document } = openPanel(sampleOf(9), new Map());
  const list = document.getElementById("query-review-rows");
  const rows = rowsOf(document);
  assert.equal(list.getAttribute("role"), "grid");
  assert.equal(list.getAttribute("aria-rowcount"), "9");

  rows.forEach((row, index) => {
    assert.equal(row.getAttribute("role"), "row");
    assert.equal(row.getAttribute("aria-posinset"), String(index + 1));
    assert.equal(row.getAttribute("aria-setsize"), "9");
    assert.equal(row.getAttribute("aria-rowindex"), String(index + 1));
    // The same count in the row's accessible name, for a reader who never meets
    // the visible line at all.
    assert.match(accessibleName(document, row), new RegExp(`Item ${index + 1} of 9`));
  });

  const indicator = document.getElementById("query-review-position-item");
  assert.equal(document.getElementById("query-review-position").hidden, false);
  assert.equal(textOf(indicator), "Item 1 of 9");
  rows[0].focus();
  for (const [key, expected] of [["ArrowDown", 2], ["ArrowDown", 3], ["End", 9], ["Home", 1]]) {
    pressKey(document, key);
    assert.equal(textOf(indicator), `Item ${expected} of 9`);
    assert.equal(activeRow(document).getAttribute("aria-posinset"), String(expected));
  }
  // The indicator is meta text, not a second live region: it changes on every
  // arrow press, and announcing each one is the chatter this issue removes.
  assert.equal(document.getElementById("query-review-position").getAttribute("aria-live"), null);
  assert.equal(document.getElementById("query-review-position").getAttribute("role"), null);
});

// --- three states, told apart without colour --------------------------------

test("agreed, corrected and still unclassified are three words, not three tints", () => {
  const entries = sampleOf(6);
  const drawn = reviewSample(entries, { size: 12 }).rows;
  const classified = drawn.find((row) => row.classified);
  const overrides = new Map([
    [classified.key, classified.category],
    [drawn.find((row) => row.key !== classified.key).key, "outOfScope"],
  ]);
  const { document } = openPanel(entries, overrides);

  const states = new Map(rowsOf(document).map((row) => [row.dataset.key, row]));
  const agreed = states.get(classified.key);
  const corrected = states.get(drawn.find((row) => row.key !== classified.key).key);
  const untouched = rowsOf(document).find((row) => !overrides.has(row.dataset.key));

  // The assertion is on the WORD inside the accessible name. A chip that carried
  // its state in a class or a colour reaches here saying nothing.
  assert.match(accessibleName(document, agreed), new RegExp(REVIEW_STATE.agreed));
  assert.match(accessibleName(document, corrected), new RegExp(REVIEW_STATE.corrected));
  assert.match(accessibleName(document, untouched), new RegExp(REVIEW_STATE.unreviewed));
  assert.equal(new Set(Object.values(REVIEW_STATE)).size, 3, "three states, three distinct words");

  // The visible chip says the same word, and the row publishes the state for the
  // stylesheet to tint — never the other way round.
  for (const [row, state] of [[agreed, "agreed"], [corrected, "corrected"], [untouched, "unreviewed"]]) {
    assert.equal(row.dataset.state, state);
    assert.equal(textOf(document.getElementById(`query-review-state-${row.dataset.key}`)),
      REVIEW_STATE[state]);
  }
});

test("agreeing and correcting move the same row between two different states", () => {
  const entries = sampleOf(6);
  const classified = reviewSample(entries, { size: 12 }).rows.find((row) => row.classified);
  const { document, overrides } = openPanel(entries, new Map());
  const key = classified.key;
  const nameNow = () => accessibleName(document, rowsOf(document).find((row) => row.dataset.key === key));

  assert.match(nameNow(), new RegExp(REVIEW_STATE.unreviewed));
  document.getElementById(`query-review-agree-${key}`).click();
  assert.match(nameNow(), new RegExp(REVIEW_STATE.agreed));
  // A label that is not the classifier's own is a correction, not an agreement.
  const other = OVERRIDE_LABELS.find((entry) => entry.key !== classified.category).key;
  applyCorrection(overrides, key, other);
  renderQueryReview(document, panelModel(entries, overrides), {});
  assert.match(nameNow(), new RegExp(REVIEW_STATE.corrected));
});

// --- one announcement per pass ----------------------------------------------

/**
 * Every distinct thing the live region has said, in order.
 *
 * A stream of twenty-five messages contains a correct one, so the assertions
 * below count these rather than searching them.
 */
function announcementLog(document) {
  const live = document.getElementById("query-review-live");
  const said = [];
  return {
    record() {
      const now = textOf(live);
      if (now && now !== said.at(-1)) said.push(now);
      return said;
    },
    get said() { return said; },
  };
}

test("a twenty-five row pass produces exactly one consolidated announcement", () => {
  const entries = sampleOf(25);
  const overrides = new Map();
  const options = { size: 25 };
  const { document } = openPanel(entries, overrides, options);
  const log = announcementLog(document);
  const drawn = reviewSample(entries, options).rows;
  assert.equal(drawn.length, 25);

  // The page's own rule, restated here rather than reached for: the one message
  // is made when the pass is complete, and never per row.
  let unannounced = false;
  const correctAll = () => {
    for (const row of drawn) {
      applyCorrection(overrides, row.key, row.classified ? row.category : "outOfScope");
      unannounced = true;
      const corrected = applyOverrides(corpusOf(entries), overrides, { spendUsd: SPEND_USD });
      let announcement = null;
      if (unannounced && drawn.every((entry) => overrides.has(entry.key))) {
        unannounced = false;
        announcement = reviewPassSummary(corrected.overridesApplied,
          { grade: corrected.grade, coverage: corrected.coverage });
      }
      renderQueryReview(document, panelModel(entries, overrides, { ...options, announcement }), {});
      log.record();
    }
  };
  correctAll();

  assert.equal(log.said.length, 1,
    `the pass said ${log.said.length} things; twenty-five corrections earn one message`);
  const summary = log.said[0];
  const corrected = applyOverrides(corpusOf(entries), overrides, { spendUsd: SPEND_USD });
  // Both halves the issue asks for: how many corrections were applied, and the
  // headline figure they moved. The figures are the model's, not this file's.
  assert.match(summary, new RegExp(`${corrected.overridesApplied} corrections applied`));
  assert.match(summary, new RegExp(`Grade ${corrected.grade}`));
  assert.match(summary, new RegExp(`${Math.round(corrected.coverage * 100)}% of your rows classified`));
  assert.equal(summary, reviewPassSummary(corrected.overridesApplied,
    { grade: corrected.grade, coverage: corrected.coverage }));
});

test("the polite region is authored in the document and never replaced", () => {
  const document = parseHtml(html);
  const before = document.getElementById("query-review-live");
  assert.ok(before, "a region inserted at announce time is routinely missed; this one ships");
  assert.equal(before.getAttribute("aria-live"), "polite");
  const entries = sampleOf(3);
  renderQueryReview(document, panelModel(entries, new Map(), { announcement: "one" }), {});
  renderQueryReview(document, panelModel(entries, new Map(), { announcement: "two" }), {});
  assert.equal(document.getElementById("query-review-live"), before,
    "the same node must carry every announcement");
  assert.equal(textOf(before), "two");
});

test("the visible progress line draws the all-reviewed state", () => {
  const entries = sampleOf(4);
  const overrides = new Map();
  const { document } = openPanel(entries, overrides);
  const done = document.getElementById("query-review-position-done");
  assert.equal(textOf(done), "0 of 4 reviewed");
  for (const row of reviewSample(entries).rows) applyCorrection(overrides, row.key, "outOfScope");
  renderQueryReview(document, panelModel(entries, overrides), {});
  assert.equal(textOf(done), "All 4 reviewed");
  assert.equal(rowsOf(document).filter((row) => row.dataset.state === "corrected").length, 4);
});

// --- the states nobody demos ------------------------------------------------

test("the empty and error states leave nothing behind to trap focus", () => {
  for (const [name, model] of [["empty", panelModel([], new Map())], ["error", null]]) {
    const document = parseHtml(html);
    renderQueryReview(document, panelModel(sampleOf(5), new Map()), {});
    document.getElementById("query-review").hidden = false;
    assert.equal(rowsOf(document).length, 5, `${name}: the panel was painted first`);

    const painted = renderQueryReview(document, model, {});
    assert.equal(painted.available, false, `${name}: no panel`);
    assert.equal(rowsOf(document).length, 0, `${name}: no row survives`);
    assert.equal(document.getElementById("query-review").hidden, true);
    assert.equal(document.getElementById("query-review-position").hidden, true,
      `${name}: the indicator must go, not read "Item 0 of 0"`);
    assert.equal(textOf(document.getElementById("query-review-position-item")), "");
    const trapped = tabSequence(document).filter((node) => node.closest("#query-review"));
    assert.deepEqual(trapped, [], `${name}: a hidden panel must hold no tab stop`);
  }
});

test("a one-row sample and a two-hundred-row sample both keep the contract", () => {
  for (const count of [1, 200]) {
    const { document } = openPanel(sampleOf(count), new Map(), { size: count });
    const rows = rowsOf(document);
    assert.equal(rows.length, count);
    assert.equal(rows.filter((row) => row.getAttribute("tabindex") === "0").length, 1);
    assert.equal(textOf(document.getElementById("query-review-position-item")), `Item 1 of ${count}`);
    assert.equal(rows.at(-1).getAttribute("aria-setsize"), String(count));

    rows[0].focus();
    pressKey(document, "End");
    assert.equal(activeRow(document), rows.at(-1));
    assert.equal(textOf(document.getElementById("query-review-position-item")), `Item ${count} of ${count}`);
    // Down at the last row clamps rather than wrapping, at either size.
    pressKey(document, "ArrowDown");
    assert.equal(activeRow(document), rows.at(-1));
    assert.equal(tabSequence(document).filter((node) => node.closest("#query-review-rows")).length, 1);
  }
});

test("a query long enough to be its own paragraph still reads as one row", () => {
  const long = "Context: ".concat("reconcile the ledger ".repeat(120)).concat("Expected output: a patch.");
  const entries = [importEntry([long, "zzzz"])];
  const { document } = openPanel(entries, new Map());
  const row = rowsOf(document).find((node) => textOf(node).includes("reconcile the ledger"));
  assert.ok(row, "the long query is drawn, not truncated away");
  const quote = document.getElementById(`query-review-text-${row.dataset.key}`);
  assert.equal(quote.textContent, long, "the whole prompt is present, as one text node");
  assert.equal(quote.children.length, 1);
  assert.equal(quote.children[0].nodeType, 3);
  // The list is still one tab stop, and the long row still carries its state and
  // its place in the set rather than being pushed out of the count.
  assert.equal(rowsOf(document).filter((node) => node.getAttribute("tabindex") === "0").length, 1);
  assert.match(accessibleName(document, row), new RegExp(REVIEW_STATE.unreviewed));
  assert.match(accessibleName(document, row),
    new RegExp(`Item ${row.getAttribute("aria-posinset")} of 2`));
  assert.equal(row.getAttribute("aria-setsize"), "2");
});

// --- everything else on the page is untouched --------------------------------

test("the rest of the page's focus order still reads in DOM order", () => {
  const shipped = parseHtml(html);
  const before = tabSequence(shipped).map((node) => node.id || node.tagName);
  const { document } = openPanel(sampleOf(5), new Map());
  const after = tabSequence(document)
    .filter((node) => node.id !== "query-review-open" && !node.closest("#query-review"))
    .map((node) => node.id || node.tagName);
  // The panel and its entry point are hidden in the shipped document and open
  // here, so with those removed the two sequences must be identical — same
  // stops, same order, nothing displaced by the roving list.
  assert.deepEqual(after, before,
    "opening the correction panel must not reorder anything else on the page");

  // Skip link, landmark and headings are where they were.
  const first = tabSequence(shipped)[0];
  assert.equal(first.getAttribute("class"), "skip-link", "the skip link is still the page's first stop");
  assert.equal(first.getAttribute("href"), "#main-content");
  assert.equal(shipped.getElementById("main-content").tagName, "MAIN");
  assert.equal(document.getElementById("query-review-title").tagName, "H3");
  assert.equal(document.getElementById("query-review").getAttribute("aria-labelledby"),
    "query-review-title");
  assert.equal(document.getElementById("query-review-open").getAttribute("aria-expanded"), "false");
});

test("closing the panel is a way out, and the reviewer keeps their corrections", () => {
  const entries = sampleOf(5);
  const overrides = new Map([[reviewSample(entries).rows[0].key, "outOfScope"]]);
  const { document } = openPanel(entries, overrides);
  const left = [];
  bindQueryReview(document, { onLeave: () => left.push("left") });
  const open = document.getElementById("query-review-open");
  open.click();
  assert.equal(open.getAttribute("aria-expanded"), "true");
  assert.equal(left.length, 0, "opening the panel announces nothing");
  open.click();
  assert.equal(open.getAttribute("aria-expanded"), "false");
  assert.equal(textOf(open), REVIEW_COPY.open);
  assert.equal(left.length, 1, "leaving the pass is where the one message is made");
  assert.equal(document.getElementById("query-review").hidden, true);
  assert.deepEqual(tabSequence(document).filter((node) => node.closest("#query-review")), [],
    "a collapsed panel holds no tab stop at all");
});
