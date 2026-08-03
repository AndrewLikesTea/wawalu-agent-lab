// One ordered pass through a reader's own imported brief (#981).
//
// WHAT THIS FILE HOLDS, and what no other file on this page holds:
//
//   1. ONE reading order. The headline question, the recoverable figure, the one
//      action, then the support — in the DOM, which on this block is also the
//      visual order and the tab order, because nothing in it is a control and
//      nothing in the stylesheet re-orders it.
//   2. ONE provenance marker, in three states, on EVERY region of the brief:
//      the headline rows, the movement block, the completeness score and its
//      working, and the ranked cohort position — the only region that can be
//      reader-declared.
//   3. Colour is never the carrier. Each state is asserted on its WORDS and on
//      its SILHOUETTE, which is what survives grayscale, and the mark is
//      asserted to be aria-hidden decoration that can be deleted without loss.
//   4. One announcement. The brief adds no live region of its own — the stand
//      region owns the page's only one — so a repaint cannot queue a second
//      utterance behind the answer, and nothing that announces sits inside a
//      disclosure a real browser can close.
//   5. Every state, including the ones that do not demo well: no import,
//      cleared, a figure long enough to break a column, a negative recoverable
//      total, and a missing cohort.
//
// Assertions are on counts, attributes and text. The harness is a double, not a
// browser: `textOf` reads through a collapsed details element and a select here
// accepts a value a real control would refuse, so nothing below stands on
// visibility — where the criterion is a real-browser one (a live region that a
// closed disclosure would hide), it is asserted structurally, as "no live region
// is inside the disclosure at all".

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, textOf } from "./support/browser.js";
import {
  FIGURE_SOURCE, PROVENANCE_MARKERS, provenanceText,
} from "../src/finops-brief-provenance.js";
import { IMPORTED_HEADLINE_SLOT_IDS } from "../src/finops-imported-headline.js";
import {
  applyImportedHeadline, clearImportedHeadline,
} from "../src/finops-imported-headline-view.js";
import { applyImportedMovement } from "../src/finops-imported-movement-view.js";
import { applyBriefCompleteness } from "../src/finops-brief-completeness-view.js";
import { applyCohortAttribution } from "../src/cohort-attribution-view.js";
import {
  mergeCohortSources, projectCohortSource, validateCohortAttribution,
} from "../src/cohort-attribution.js";
import { readDelimitedText } from "../src/delimited-text.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

// --- fixtures, generated here rather than committed -------------------------

/** An import that earns every slot: a complete month, both figures, grouped. */
const richImport = (overrides = {}) => ({
  period: "2026-01-01 to 2026-02-01",
  spendUsd: 240_000,
  recoverableUsd: 36_000,
  rankedDepartments: [
    { id: "unit-a", name: "Platform", spendUsd: 120_000, recoverableUsd: 21_000 },
  ],
  action: "Pilot lower-cost routing for text-generation in Platform.",
  history: {
    state: "available",
    periods: [
      { period: "2025-12", spendUsd: 210_000, recoverableUsd: 30_000, completeness: "complete" },
      { period: "2026-01", spendUsd: 240_000, recoverableUsd: 36_000, completeness: "complete" },
    ],
  },
  ...overrides,
});

/** An export with usage rows and neither cohort column in it. */
const undeclaredExport = ({ units = 6 } = {}) => [
  ["usage_date", "department_key", "amount"].join(","),
  ...Array.from({ length: units }, (_, index) =>
    ["2026-06-05", `unit-${index + 1}`, String(100 + index)].join(",")),
].join("\n");

/** The same export with both attributes carried by its own columns. */
const declaredExport = ({ units = 6 } = {}) => [
  ["usage_date", "department_key", "amount", "org_size_band", "industry"].join(","),
  ...Array.from({ length: units }, (_, index) =>
    ["2026-06-05", `unit-${index + 1}`, String(100 + index), "scaling", "saas"].join(",")),
].join("\n");

const objectsFrom = (csv) => {
  const reading = readDelimitedText(csv, { maxBytes: 8_000_000, maxRows: 50_000 });
  assert.equal(reading.ok, true, "fixture must be readable by the shipped delimited reader");
  return reading.rows.map((row) => Object.fromEntries(
    reading.header.map((name, index) => [name, row.values[index] ?? ""])));
};

const decide = (csv, readerDeclared = null) => validateCohortAttribution({
  ...mergeCohortSources([projectCohortSource({ objects: objectsFrom(csv) })]),
  asOf: "2026-06-30",
  readerDeclared,
});

/** True when `node` sits inside the element with this id. `parentNode`, because
 *  the harness rejects a descendant selector. */
function inRegion(node, id) {
  for (let held = node; held; held = held.parentNode) if (held.id === id) return true;
  return false;
}

/**
 * Every provenance chip the IMPORTED brief drew.
 *
 * #1025 put the same chip on the bundled example's own figures, in a region this
 * file never paints and which is populated before any import exists — so the
 * count is scoped to everything outside it rather than being every chip on the
 * page. "An unimported page marks nothing" is a claim about the imported brief.
 */
const markers = (doc) => [...doc.querySelectorAll(".brief-provenance")]
  .filter((node) => !inRegion(node, "finops-first-run"));
const rowsOf = (doc) => [...doc.querySelectorAll("dd.imported-headline-slot")];

/** Paint the whole brief for one analysis, the way the page entry does. */
function paintBrief(doc, analysis, { retainedPeriods = [] } = {}) {
  const headline = applyImportedHeadline(doc, analysis);
  const movement = applyImportedMovement(doc, analysis ? { exports: [], retainedPeriods } : null);
  const score = applyBriefCompleteness(doc, analysis, { movement: movement.movement });
  return { headline, movement, score };
}

// --- 1. one reading order ---------------------------------------------------

test("the brief leads with the question, the recoverable figure, then the one action", () => {
  const doc = parseHtml(html);
  applyImportedHeadline(doc, richImport());

  const region = doc.getElementById("finops-imported-headline");
  // The question is painted above the rows, in the region's own first slots.
  const order = region.children.filter((node) => node.nodeType === 1).map((node) => node.id || node.className);
  assert.equal(order[0], "eyebrow", "the eyebrow names whose export this is, first");
  assert.equal(order[1], "finops-imported-headline-question", "then the answerable question");
  assert.equal(order[2], "finops-imported-headline-slots", "then the ordered slots");

  const rows = rowsOf(doc);
  assert.equal(rows.length, 5, "five rows, always five");
  assert.deepEqual(rows.map((row) => row.dataset.slot), [...IMPORTED_HEADLINE_SLOT_IDS]);
  assert.deepEqual(rows.map((row) => row.dataset.slot).slice(0, 2),
    ["recoverable_spend", "rank_1_action"],
    "the recoverable figure and the action to take about it lead, in that order");
  assert.deepEqual(rows.map((row) => row.dataset.role),
    ["lead", "action", "support", "support", "support"],
    "everything after the action is painted as support, one step down the scale");
});

test("the visual order is the DOM order: nothing in the block is re-ordered in CSS", async () => {
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  // The rules for the brief's own blocks, isolated from the rest of the sheet.
  const rules = css.split("\n").filter((line) =>
    /^\.(imported-headline|stand-imported|completeness|brief-provenance)/.test(line.trim()));
  assert.ok(rules.length >= 10, "the brief's rules were found in the sheet");
  for (const rule of rules) {
    assert.doesNotMatch(rule, /(^|[;{ ])order\s*:/,
      `a CSS 'order' would desynchronise what is seen from what is read: ${rule.trim()}`);
    assert.doesNotMatch(rule, /flex-direction\s*:\s*[a-z-]*reverse/,
      `a reversed flex direction would desynchronise reading order: ${rule.trim()}`);
    assert.doesNotMatch(rule, /position\s*:\s*absolute/,
      `absolute positioning would desynchronise reading order: ${rule.trim()}`);
  }
  assert.match(css, /\.completeness-detail>summary:focus-visible\s*\{[^}]*outline:3px solid var\(--focus-ring\)/,
    "the one control in the brief shows a focus ring of the page's own token");
});

// --- 2. one marker, three states, none of them carried by colour ------------

test("the three provenance states differ in words and in silhouette, not only in colour", () => {
  const states = Object.values(PROVENANCE_MARKERS);
  assert.equal(states.length, 3, "three states, and there is no fourth");
  assert.equal(new Set(states.map((state) => state.label)).size, 3,
    "each state says the whole thing in its own words");
  assert.equal(new Set(states.map((state) => state.silhouette)).size, 3,
    "each state keeps its own silhouette, which is what survives grayscale");
  for (const state of states) {
    assert.ok(state.label.trim().length > 0, `${state.source} has a readable label`);
    assert.ok(!/\b(colour|color|green|amber|red)\b/i.test(state.label),
      `${state.source} does not name a colour as its meaning`);
  }
  assert.equal(PROVENANCE_MARKERS[FIGURE_SOURCE.file].shape, "◆",
    "the file state draws the mark this page already publishes for the reader's own file");
  assert.equal(provenanceText(FIGURE_SOURCE.fallback, { qualifies: "Peer position" }),
    "Peer position: Not in your file",
    "the label reaches assistive tech with the figure it qualifies, never orphaned");
});

test("every region of the brief carries the marker, and the mark is deletable decoration", () => {
  const doc = parseHtml(html);
  paintBrief(doc, richImport(), {
    retainedPeriods: [
      { period: "2025-12", total: 210_000 }, { period: "2026-01", total: 240_000 },
    ],
  });

  // Five headline rows, the movement block, the completeness score, and one row
  // per scored slot inside the working.
  const painted = markers(doc);
  assert.ok(painted.length >= 8,
    `every region of the brief marks its figures, found ${painted.length}`);
  for (const id of ["finops-imported-movement-provenance", "finops-brief-completeness-provenance"]) {
    assert.equal(doc.getElementById(id).querySelectorAll(".brief-provenance").length, 1,
      `${id} carries exactly one marker`);
  }
  for (const row of rowsOf(doc)) {
    assert.equal(row.querySelectorAll(".brief-provenance").length, 1,
      `${row.dataset.slot} carries exactly one marker`);
  }
  for (const mark of doc.querySelectorAll(".brief-provenance-shape")) {
    assert.equal(mark.getAttribute("aria-hidden"), "true",
      "the mark is decoration: a screen reader reads the words, never the diamond");
  }
  // Delete every mark from the text and the marker still says what it means.
  for (const marker of painted) {
    const words = textOf(marker).replace(/◆/gu, "").trim();
    assert.ok(words.length > 0, "the marker's words survive its mark being deleted");
  }
});

test("a fallen-back slot is marked as an absence, not as a figure from the file", () => {
  const doc = parseHtml(html);
  applyImportedHeadline(doc, {
    period: "2026-01-01 to 2026-02-01",
    spendUsd: 240_000,
    rankedDepartments: [],
    action: "",
    history: { state: "unavailable", periods: [] },
  });
  const rows = rowsOf(doc);
  const fallen = rows.filter((row) => row.dataset.supported === "false");
  assert.equal(fallen.length, 4, "four slots fall back on a total-only export");
  for (const row of fallen) {
    const marker = row.querySelector(".brief-provenance");
    assert.equal(marker.dataset.provenance, FIGURE_SOURCE.fallback);
    assert.equal(marker.dataset.silhouette, "dashed");
    assert.match(textOf(marker), /Not in your file/);
  }
  assert.equal(rows.filter((row) =>
    row.querySelector(".brief-provenance").dataset.provenance === FIGURE_SOURCE.file).length, 1,
  "only the tier, derived from the four above, is still file-derived");
});

test("the cohort position is the region that can be reader-declared, and it says so", () => {
  const doc = parseHtml(html);

  applyCohortAttribution(doc, decide(declaredExport()));
  const fromFile = doc.getElementById("local-cohort-provenance").querySelector(".brief-provenance");
  assert.equal(fromFile.dataset.provenance, FIGURE_SOURCE.file);
  assert.match(textOf(fromFile), /Peer position: From your file/);

  applyCohortAttribution(doc, decide(undeclaredExport(), { orgSizeBand: "scaling", industry: "saas" }));
  const declared = doc.getElementById("local-cohort-provenance").querySelector(".brief-provenance");
  assert.equal(declared.dataset.provenance, FIGURE_SOURCE.reader,
    "a position placed on values the reader typed is never presented as file-derived");
  assert.equal(declared.dataset.silhouette, "outline");
  assert.match(textOf(declared), /You entered this/);

  applyCohortAttribution(doc, decide(undeclaredExport()));
  const withheld = doc.getElementById("local-cohort-provenance").querySelector(".brief-provenance");
  assert.equal(withheld.dataset.provenance, FIGURE_SOURCE.fallback);
  assert.match(textOf(withheld), /Not in your file/);
  assert.equal(doc.getElementById("local-cohort-provenance").querySelectorAll(".brief-provenance").length, 1,
    "three paints leave one marker, not three");
});

// --- 3. keyboard and announcement -------------------------------------------

test("the brief's one control is reachable in document order and names its target", () => {
  const doc = parseHtml(html);
  paintBrief(doc, richImport());

  for (const region of ["finops-imported-headline", "finops-imported-movement",
    "finops-brief-completeness"]) {
    assert.equal(doc.getElementById(region).querySelectorAll("[tabindex]").length, 0,
      `${region} adds no tabindex, so the tab order is the document order`);
  }
  const summary = doc.getElementById("finops-brief-completeness-summary");
  assert.equal(summary.getAttribute("aria-controls"), "finops-brief-completeness-slots",
    "the control names what it opens");
  assert.equal(summary.getAttribute("aria-expanded"), "false",
    "and states its state, mirrored from the disclosure rather than authored once");
  const name = textOf(summary);
  assert.match(name, /Slot-by-slot working/);
  assert.match(name, /earned|fell back/,
    "the accessible name says what is behind the control before it is pressed");
});

test("the brief adds no live region: one import is one announcement", () => {
  const doc = parseHtml(html);
  paintBrief(doc, richImport());

  for (const region of ["finops-imported-headline", "finops-imported-movement",
    "finops-brief-completeness"]) {
    assert.equal(doc.getElementById(region).querySelectorAll(
      '[aria-live], [role="status"], [role="alert"]').length, 0,
    `${region} announces nothing of its own; the stand region owns the page's one announcer`);
  }
  // And nothing that announces is inside a disclosure. A closed details element
  // is hidden from a real browser while this harness still reads through it, so
  // a live region in there would never fire where it matters.
  assert.equal(doc.getElementById("finops-brief-completeness-detail").querySelectorAll(
    '[aria-live], [role="status"]').length, 0,
  "no announcement is placed inside a disclosure that can be closed");
});

test("a recompute over the same import repaints once and duplicates nothing", () => {
  const doc = parseHtml(html);
  const retained = [{ period: "2025-12", total: 210_000 }, { period: "2026-01", total: 240_000 }];
  paintBrief(doc, richImport(), { retainedPeriods: retained });
  const first = markers(doc).length;
  const answer = textOf(doc.getElementById("finops-imported-movement-answer"));

  paintBrief(doc, richImport(), { retainedPeriods: retained });
  assert.equal(markers(doc).length, first, "a second identical paint adds no second marker");
  assert.equal(rowsOf(doc).length, 5, "and no sixth row");
  assert.equal(textOf(doc.getElementById("finops-imported-movement-answer")), answer,
    "the sentence a reader would hear again is the same sentence, written once");
});

// --- 4. every state, including the ones that do not demo well ----------------

test("no import, then a cleared import, leave the brief off screen and empty", () => {
  const doc = parseHtml(html);
  // The empty state as the document ships it: hidden, and nothing painted.
  assert.equal(doc.querySelectorAll("dd.imported-headline-slot").length, 0);
  assert.equal(markers(doc).length, 0, "an unimported page marks nothing, because it has nothing");

  paintBrief(doc, richImport());
  clearImportedHeadline(doc);
  const region = doc.getElementById("finops-imported-headline");
  assert.equal(region.hidden, true);
  assert.equal(region.dataset.state, "unavailable");
  assert.equal(doc.querySelectorAll("dd.imported-headline-slot").length, 0,
    "a cleared brief keeps no row, and therefore no marker, for a file that is gone");
  assert.equal(textOf(doc.getElementById("finops-imported-headline-question")), "");
});

test("implausible extremes render whole: a huge figure, a negative one, a long label", () => {
  const doc = parseHtml(html);
  const long = "Consolidate the seventeen separate text-generation routing policies that the "
    + "platform, support, research and data-engineering groups each maintain independently";
  paintBrief(doc, richImport({
    recoverableUsd: 9_876_543_210,
    action: long,
    history: {
      state: "available",
      periods: [{
        period: "2026-01", spendUsd: 98_765_432_100, recoverableUsd: 9_876_543_210,
        completeness: "complete",
      }],
    },
  }));
  const rows = rowsOf(doc);
  assert.equal(rows.length, 5, "the row count does not move for a large figure");
  const lead = textOf(rows[0].querySelector(".imported-headline-value"));
  assert.match(lead, /9,876,543,210/, "the figure is printed whole, never truncated");
  assert.doesNotMatch(lead, /…|\.\.\./, "and never ellipsised");
  assert.equal(textOf(rows[1].querySelector(".imported-headline-value")), long,
    "a very long action is printed whole and wraps rather than clipping the headline");
  assert.equal(rows[0].querySelectorAll(".brief-provenance").length, 1,
    "the headline figure keeps its provenance label beside it at any length");

  // A negative recoverable total is not a figure this contract will present as
  // one: it falls back and says so, rather than printing a negative headline.
  const negative = parseHtml(html);
  applyImportedHeadline(negative, richImport({
    history: {
      state: "available",
      periods: [{
        period: "2026-01", spendUsd: 240_000, recoverableUsd: -36_000, completeness: "complete",
      }],
    },
  }));
  const first = [...negative.querySelectorAll("dd.imported-headline-slot")][0];
  assert.equal(first.dataset.supported, "false");
  assert.equal(first.querySelector(".brief-provenance").dataset.provenance, FIGURE_SOURCE.fallback);
  assert.doesNotMatch(textOf(first.querySelector(".imported-headline-value")), /-36,000/,
    "a negative recoverable total is never printed as the headline figure");
});

test("a missing peer cohort withholds the position without swallowing the headline", () => {
  const doc = parseHtml(html);
  applyImportedHeadline(doc, richImport({
    history: {
      state: "available",
      periods: [{ period: "2026-01", recoverableUsd: 36_000, completeness: "complete" }],
    },
  }));
  const rows = rowsOf(doc);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].dataset.supported, "true", "the recoverable figure still leads");
  const position = rows.find((row) => row.dataset.slot === "peer_position");
  assert.equal(position.dataset.supported, "false");
  assert.equal(position.querySelector(".brief-provenance").dataset.silhouette, "dashed",
    "a withheld position is an absence, and it is marked as one");
});
