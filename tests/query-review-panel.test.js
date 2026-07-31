// The review-and-correct panel: what it shows, what it refuses to execute, and
// what a correction is allowed to move.
//
// Two rules this file holds and the implementation cannot get around:
//
//  1. EVERY figure comes from the override model. The expected numbers below are
//     computed by calling `applyOverrides` in the test, never re-recorded from
//     what the panel printed — a page that grew its own grading arithmetic fails
//     here rather than quietly publishing a second one.
//  2. A control is only as constrained as the model behind it. The harness's
//     `select` double accepts any value assigned to it, so "an unlisted value is
//     refused" is asserted on the RENDERED OPTIONS and on `applyCorrection`'s own
//     rejection — never by handing the double a bad value and watching it shrug.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml, pressKey, tabSequence, textOf } from "./support/browser.js";
import {
  OVERRIDE_LABELS, applyCorrection, applyOverrides, correctionProvenance, includedCorrectionCount,
  isOverrideLabel, prioritizedRecovery, revertToClassifier,
} from "../src/query-label-overrides.js";
import { REVIEW_SAMPLE_SIZE, reviewCandidates, reviewSample } from "../src/query-review-sample.js";
import { REVIEW_COPY, bindQueryReview, renderQueryReview } from "../src/query-review-view.js";
import { QUERY_CATEGORIES } from "../src/evolution.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

const SPEND_USD = 10_000;

/**
 * An import as the page assembles it: `{ parsed, classified }` per file, where
 * `parsed.records` still carry the excerpt and `classified` is what survived the
 * redaction boundary. Rows carrying an excerpt are the ones the contract
 * declines, which is exactly the set this panel reviews.
 */
function importEntry({ declared = 0, excerpts = [] } = {}) {
  const records = Array.from({ length: declared }, (unused, index) => ({
    row: index + 2, orgUnitId: "unit-a", queryDate: "2026-06-01", model: "gpt-4o",
    category: "highValue", inputTokens: 900, outputTokens: 400,
  }));
  const declines = excerpts.map((promptExcerpt, index) => ({
    row: declared + index + 2, orgUnitId: "unit-a", queryDate: "2026-06-01", model: "gpt-4o",
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

/** The corpus array the page hands `applyOverrides`, rebuilt here from the entry. */
const corpusOf = (entries) => entries.flatMap(({ classified }) => [
  ...classified.records, ...classified.unclassified.map(() => ({ category: null })),
]);

const EXCERPTS = [
  "rename this variable to invoiceTotal",
  "try again, that did not work",
  "give me a recipe for dinner",
  "Context: the ledger reconciliation fails. Constraints: idempotent. Expected output: a patch.",
  "zzzz",
];

/** Thirty declared rows, so the corpus clears the grade floor and a letter can move. */
const DECLARED = 30;
const ENTRIES = [importEntry({ declared: DECLARED, excerpts: EXCERPTS })];

// --- the rows a human is handed --------------------------------------------

test("a reviewable row carries the query, the class, and the token that decided it", () => {
  const rows = reviewCandidates(ENTRIES);
  assert.equal(rows.length, EXCERPTS.length);
  const rename = rows.find((row) => row.text.startsWith("rename this"));
  assert.equal(rename.category, "overProvisioned");
  assert.equal(rename.signal, "rename", "the matched token must be republished, not re-derived");
  assert.equal(rename.patternId, "over-provisioned-trivial-on-premium");
  // A refusal says why instead of showing an empty class.
  const refused = rows.find((row) => row.text === "zzzz");
  assert.equal(refused.category, null);
  assert.equal(refused.signal, null);
  assert.ok(refused.reason, "a declined row must name the reason, not print a blank class");
});

test("a reviewable row is keyed by the same key the override model grades by", () => {
  // The declared rows come first in the corpus, so the five excerpt rows are
  // corpus indices 30…34. Correcting `row-30` must move `row-30` in the grade.
  const rows = reviewCandidates(ENTRIES);
  assert.deepEqual(rows.map((row) => row.queryId),
    ["row-30", "row-31", "row-32", "row-33", "row-34"]);
  const corrected = applyOverrides(corpusOf(ENTRIES), { "row-30": "outOfScope" }, { spendUsd: SPEND_USD });
  assert.equal(corrected.overridesApplied, 1, "the panel's key must name a row the model holds");
  assert.equal(corrected.mix.outOfScope, 1);
});

test("the drawn sample is bounded, deterministic, and drawn by the model's sampler", () => {
  const wide = [importEntry({ declared: 0, excerpts: Array.from({ length: 40 }, (u, i) => `prompt ${i}`) })];
  const first = reviewSample(wide);
  assert.equal(first.total, 40);
  assert.equal(first.rows.length, REVIEW_SAMPLE_SIZE);
  assert.deepEqual(reviewSample(wide).rows.map((row) => row.key), first.rows.map((row) => row.key),
    "two draws over one corpus must hand a reviewer the same rows");
});

// --- the model is the only place a correction lands ------------------------

test("the model refuses a label no control offered, and says which refusal it was", () => {
  const overrides = new Map();
  assert.equal(applyCorrection(overrides, "row-30", "notACategory").ok, false);
  assert.equal(applyCorrection(overrides, "row-30", "notACategory").reason, "unknown_label");
  assert.equal(overrides.size, 0, "a refused label must not reach the arithmetic");
  assert.equal(applyCorrection(overrides, "__proto__", "outOfScope").reason, "unknown_row");
  assert.equal(applyCorrection(overrides, "row-30", "outOfScope").ok, true);
  assert.equal(overrides.get("row-30"), "outOfScope");
  // Clearing a row is the same call with no label, not a second control.
  assert.equal(applyCorrection(overrides, "row-30", "").reason, "cleared");
  assert.equal(overrides.size, 0);
});

test("the offered label set is the rubric's own, and nothing else validates", () => {
  assert.deepEqual(OVERRIDE_LABELS.map((entry) => entry.key), QUERY_CATEGORIES.map((c) => c.key));
  for (const entry of OVERRIDE_LABELS) assert.equal(isOverrideLabel(entry.key), true);
  for (const rogue of ["unclassified", "UNKNOWN", "", null, "__proto__"]) {
    assert.equal(isOverrideLabel(rogue), false, `"${rogue}" must not be an applicable label`);
  }
});

test("the provenance count is what is folded in, not what was clicked", () => {
  const records = corpusOf(ENTRIES);
  const overrides = new Map();
  applyCorrection(overrides, "row-30", "outOfScope");
  applyCorrection(overrides, "row-31", "inefficient");
  // A third click naming a row this corpus does not hold changes nothing, and
  // must not be counted as though it did.
  applyCorrection(overrides, "row-900", "outOfScope");
  assert.equal(overrides.size, 3);
  assert.equal(includedCorrectionCount(records, overrides, { spendUsd: SPEND_USD }), 2);
  assert.equal(correctionProvenance(2), "2 of your corrections included");
  assert.equal(correctionProvenance(0), null, "no corrections earns no provenance line at all");
  assert.equal(revertToClassifier(overrides).cleared, 3);
  assert.equal(includedCorrectionCount(records, overrides, { spendUsd: SPEND_USD }), 0);
});

test("a revert restores the classifier-only numbers exactly", () => {
  const records = corpusOf(ENTRIES);
  const before = applyOverrides(records, new Map(), { spendUsd: SPEND_USD });
  const overrides = new Map();
  applyCorrection(overrides, "row-30", "outOfScope");
  const during = applyOverrides(records, overrides, { spendUsd: SPEND_USD });
  assert.notEqual(during.composite, before.composite, "a correction that moves nothing is not a correction");
  revertToClassifier(overrides);
  const after = applyOverrides(records, overrides, { spendUsd: SPEND_USD });
  assert.equal(after.composite, before.composite);
  assert.equal(after.coverage, before.coverage);
  assert.equal(after.recoverableSpend, before.recoverableSpend);
  assert.equal(after.grade, before.grade);
});

test("the prioritized action ranks published figures rather than inventing one", () => {
  const mix = { highValue: 0, overProvisioned: 10, inefficient: 0, outOfScope: 1 };
  const action = prioritizedRecovery(mix, { spendUsd: 11_000 });
  // 10/11 of $11,000 is $10,000 of over-provisioned spend, 70% of which the
  // rubric calls recoverable; leakage is 1/11 = $1,000 at 100%.
  assert.equal(action.key, "overProvisioned");
  assert.equal(action.recoverableUsd, 7000);
  assert.equal(prioritizedRecovery(mix, { spendUsd: null }), null,
    "no spend, no action — never a dollar figure standing in for one");
});

// --- the panel ---------------------------------------------------------------

const doc = () => parseHtml(html);

/** The panel model the page composes, built here from the same model calls. */
function panelModel(entries, overrides, { spendUsd = SPEND_USD, announcement = null } = {}) {
  const corrected = applyOverrides(corpusOf(entries), overrides, { spendUsd });
  return {
    available: entries.length > 0,
    sample: reviewSample(entries),
    grade: corrected.grade,
    coverage: corrected.coverage,
    recoverableSpend: corrected.recoverableSpend,
    included: corrected.overridesApplied,
    provenance: correctionProvenance(corrected.overridesApplied),
    nextAction: prioritizedRecovery(corrected.mix, { spendUsd }),
    labels: OVERRIDE_LABELS,
    selected: overrides,
    announcement,
  };
}

test("the panel ships hidden, so a visitor on the bundled example never meets it", () => {
  const document = doc();
  assert.equal(document.getElementById("query-review-open").hidden, true);
  assert.equal(document.getElementById("query-review").hidden, true);
  assert.equal(tabSequence(document).some((node) => node.id === "query-review-open"), false,
    "a hidden entry point must not be a tab stop on the demo path");
  // …and an empty import takes it back off the page rather than leaving a shell.
  const painted = renderQueryReview(document, panelModel([], new Map()), {});
  assert.equal(painted.available, false);
  assert.equal(document.getElementById("query-review-open").hidden, true);
});

test("an imported export reveals the entry point, and it is a real disclosure", () => {
  const document = doc();
  renderQueryReview(document, panelModel(ENTRIES, new Map()), {});
  const open = document.getElementById("query-review-open");
  assert.equal(open.hidden, false);
  assert.equal(open.tagName, "BUTTON");
  assert.equal(open.getAttribute("aria-controls"), "query-review");
  bindQueryReview(document, {});
  assert.equal(open.getAttribute("aria-expanded"), "false");
  open.click();
  assert.equal(open.getAttribute("aria-expanded"), "true");
  assert.equal(document.getElementById("query-review").hidden, false);
  open.click();
  assert.equal(open.getAttribute("aria-expanded"), "false");
  assert.equal(document.getElementById("query-review").hidden, true);
});

test("the relabel control offers the model's labels and no others", () => {
  const document = doc();
  renderQueryReview(document, panelModel(ENTRIES, new Map()), {});
  const select = document.getElementById("query-review-rows").children[0].querySelector("select");
  const values = select.options.map((option) => option.getAttribute("value"));
  // The rendered options ARE the assertion: the harness's select double would
  // accept an unlisted value, so what a real control refuses is checked here and
  // in `applyCorrection`'s own rejection above, never by assigning to the double.
  assert.deepEqual(values, ["", ...OVERRIDE_LABELS.map((entry) => entry.key)]);
  for (const value of values.slice(1)) assert.equal(isOverrideLabel(value), true);
  // Every control is labelled and reachable by keyboard alone.
  const label = document.getElementById("query-review-rows").children[0].querySelector("label");
  assert.equal(label.getAttribute("for"), select.id);
  document.getElementById("query-review").hidden = false;
  document.getElementById("query-review-open").hidden = false;
  const stops = tabSequence(document).map((node) => node.id);
  assert.ok(stops.includes("query-review-open"), "the open control must be reachable by Tab");
  // NOT by Tab any more, and that is the point of #795: the sample is one tab
  // stop, and the per-query control is reached from its row with Left/Right.
  // Reachability by keyboard alone is asserted in query-review-keyboard.test.js.
  assert.equal(stops.includes(select.id), false,
    "twenty-five rows must not put fifty controls in the page's tab order");
  assert.equal(select.getAttribute("tabindex"), "-1");
});

test("a relabel reaches the model, and the keyboard alone can make one", () => {
  const document = doc();
  const overrides = new Map();
  const seen = [];
  renderQueryReview(document, panelModel(ENTRIES, overrides), {
    onCorrect: (key, label) => { seen.push([key, label]); applyCorrection(overrides, key, label); },
  });
  const row = document.getElementById("query-review-rows").children[0];
  const select = row.querySelector("select");
  // ArrowDown on a select is the harness's real keyboard model for one: it moves
  // to the next OPTION and fires change. No mouse, and no value assigned by hand.
  document.activeElement = select;
  pressKey(document, "ArrowDown");
  assert.equal(seen.length, 1, "a keyboard-only relabel must reach the model");
  assert.equal(seen[0][0], row.dataset.key);
  assert.equal(isOverrideLabel(seen[0][1]), true, "the control may only emit a label the model applies");
  assert.equal(overrides.get(row.dataset.key), seen[0][1]);
});

test("agreeing with the classifier applies the classifier's own class", () => {
  const document = doc();
  const overrides = new Map();
  renderQueryReview(document, panelModel(ENTRIES, overrides), {
    onCorrect: (key, label) => applyCorrection(overrides, key, label),
  });
  const rows = document.getElementById("query-review-rows").children;
  const classified = rows.find((row) => row.dataset.classified === "true");
  const agree = classified.querySelector("button");
  assert.equal(textOf(agree), REVIEW_COPY.agree);
  agree.click();
  const drawn = reviewSample(ENTRIES).rows.find((row) => row.key === classified.dataset.key);
  assert.equal(overrides.get(classified.dataset.key), drawn.category);
  // …and the row the classifier declined offers no agree button, because there
  // is nothing there to agree with.
  const declined = rows.find((row) => row.dataset.classified === "false");
  assert.equal(declined.querySelector("button"), null);
});

test("a relabel moves the headline number and the recoverable figure on screen", () => {
  const document = doc();
  const before = applyOverrides(corpusOf(ENTRIES), new Map(), { spendUsd: SPEND_USD });
  renderQueryReview(document, panelModel(ENTRIES, new Map()), {});
  const figuresBefore = textOf(document.getElementById("query-review-figures"));
  assert.ok(figuresBefore.includes(`$${before.recoverableSpend.toLocaleString("en-US")}`));
  assert.equal(document.getElementById("query-review-provenance").hidden, true,
    "classifier-only output must carry no provenance line");
  assert.equal(document.getElementById("query-review-revert").hidden, true,
    "there is nothing to revert to before a correction is made");

  const overrides = new Map([["row-30", "outOfScope"], ["row-31", "outOfScope"]]);
  const after = applyOverrides(corpusOf(ENTRIES), overrides, { spendUsd: SPEND_USD });
  renderQueryReview(document, panelModel(ENTRIES, overrides), {});
  const figuresAfter = textOf(document.getElementById("query-review-figures"));
  assert.notEqual(figuresAfter, figuresBefore, "two corrections must move the figures");
  assert.ok(figuresAfter.includes(`$${after.recoverableSpend.toLocaleString("en-US")}`));
  assert.ok(after.recoverableSpend > before.recoverableSpend);
  // The provenance line counts what is folded in, and one control takes it away.
  assert.equal(textOf(document.getElementById("query-review-provenance")),
    "2 of your corrections included");
  assert.equal(document.getElementById("query-review-provenance").hidden, false);
  assert.equal(document.getElementById("query-review-revert").hidden, false);
  assert.equal(textOf(document.getElementById("query-review-revert")), REVIEW_COPY.revert);

  // Revert, through the model, restores the classifier-only paint exactly.
  revertToClassifier(overrides);
  renderQueryReview(document, panelModel(ENTRIES, overrides), {});
  assert.equal(textOf(document.getElementById("query-review-figures")), figuresBefore);
  assert.equal(document.getElementById("query-review-provenance").hidden, true);
  assert.equal(document.getElementById("query-review-revert").hidden, true);
});

test("a correction repaints the figures without speaking over the reviewer", () => {
  const document = doc();
  const live = document.getElementById("query-review-live");
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");
  // #795: a per-correction figures announcement is twenty-five interruptions in
  // a twenty-five row pass. The figures still move on screen; the region waits
  // for the one message the caller decides to make.
  renderQueryReview(document, panelModel(ENTRIES, new Map([["row-30", "outOfScope"]])), {});
  assert.equal(textOf(live), "", "a single correction must not announce anything");
  assert.match(textOf(document.getElementById("query-review-provenance")),
    /1 of your corrections included/);
  renderQueryReview(document, panelModel(ENTRIES, new Map(), { announcement: REVIEW_COPY.reverted }), {});
  assert.equal(textOf(live), REVIEW_COPY.reverted);
});

// --- containment -------------------------------------------------------------

test("markup in a query renders as literal text: no element, no handler, no request", () => {
  const hostile = [
    '<img src=x onerror="alert(1)">',
    "<script>fetch('https://example.invalid')</script>",
    "</li><button onclick=alert(2)>click</button>",
  ];
  const document = doc();
  renderQueryReview(document, panelModel([importEntry({ declared: DECLARED, excerpts: hostile })], new Map()), {});
  const list = document.getElementById("query-review-rows");
  for (const query of hostile) {
    const cell = list.querySelectorAll("p").find((node) => node.textContent === query);
    assert.ok(cell, `"${query}" must appear as visible literal text`);
    assert.equal(cell.children.length, 1, "the query must be one text node, never a parsed subtree");
    assert.equal(cell.children[0].nodeType, 3);
    assert.equal(cell.getAttribute("onerror"), null);
    assert.equal(cell.listeners.size ?? cell.listeners.length ?? 0, 0,
      "no handler may be attached to the node holding a reader's own text");
  }
  // Nothing the query text could have become exists in the tree, and no attribute
  // anywhere in the panel carries it.
  assert.equal(list.querySelectorAll("img").length, 0);
  assert.equal(list.querySelectorAll("script").length, 0);
  for (const node of list.querySelectorAll("select")) {
    for (const [, value] of node.attributes) {
      assert.ok(!hostile.some((query) => String(value).includes(query.slice(0, 12))),
        "no attribute may be built out of a reader's own query text");
    }
  }
});
