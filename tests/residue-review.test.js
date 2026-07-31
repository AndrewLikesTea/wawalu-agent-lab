// The residue review control, as a FinOps lead meets it.
//
// Every test here boots the real page entry against the shipped markup of
// src/evolution.html and imports a file through the page's own file input, so
// what is checked is the wiring that ships: the import path, the recompute
// closure it hands the view, the aggregation entry point behind that, and the
// control the reader actually operates. Nothing calls the view directly.
//
// The corpus is generated in this file rather than committed. It is built to
// separate two things the page has to keep separate: the literacy model is
// gradeable (thirty-two small classified rows across two units) while coverage
// is not (thirteen unclassified rows carrying almost all of the billed tokens).
// That is the state a lead is in when the residue control is worth anything.
//
// HARNESS NOTE, and it decides how the assignment tests below are written: this
// repo's DOM double lets any string be written to a `<select>`, including one
// the control never offered. So the option set is asserted explicitly against
// the rubric, and every assignment that matters is made through the keyboard —
// `pressKey` walks the control's OWN option list, so a value the page never
// rendered cannot be the reason a test passes.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, pressKey, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { DISCLOSURE_IDS, ORG_QUERY_DECISION_STATE } from "../src/org-query-decision.js";
import {
  ORG_COACHING_BODY_ID, ORG_COACHING_LIVE_ID, ORG_COACHING_SECTION_ID,
  panelId, residueSelectId, toggleId,
} from "../src/org-query-decision-view.js";
import { RESIDUE_UNCLASSIFIABLE } from "../src/residue-review.js";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const STYLESHEET = new URL("../src/evolution.css", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

/** The one string that must never reach the DOM: it is per-record prompt text. */
const PROMPT_SENTINEL = "zzq-raw-prompt-sentinel-quarterly-ledger";
const UNITS = ["psn_zzq_unit_alpha_000001", "psn_zzq_unit_beta_0000001"];
const CATEGORY_KEYS = PROMPT_LITERACY_RUBRIC.categories.map((entry) => entry.key);
const HEADER = "org_unit_id,query_date,model,input_tokens,output_tokens,prompt_excerpt,category";

/**
 * A query sample with a gradeable literacy model and an uncoverable denominator.
 *
 * `residue` is a list of `[model, rowCount, tokensPerSide]`: those rows carry no
 * declared category and an excerpt the classifier places nowhere, so each model
 * becomes one residue cluster keyed on a structural field.
 */
function sampleText(residue = [["vendor-y-max", 6, 900], ["vendor-z-turbo", 4, 600],
  ["vendor-q-nano", 3, 300]]) {
  const rows = [HEADER];
  for (const unit of UNITS) {
    for (let index = 0; index < 16; index += 1) {
      rows.push([unit, `2026-06-${String(1 + Math.floor(index / 2)).padStart(2, "0")}`,
        "vendor-x-mini", 10, 10, "", CATEGORY_KEYS[index % CATEGORY_KEYS.length]].join(","));
    }
  }
  for (const [model, count, tokens] of residue) {
    for (let index = 0; index < count; index += 1) {
      rows.push([UNITS[0], `2026-06-${String(20 + (index % 8)).padStart(2, "0")}`,
        model, tokens, tokens, PROMPT_SENTINEL, ""].join(","));
    }
  }
  return `${rows.join("\n")}\n`;
}

const section = (document) => document.getElementById(ORG_COACHING_SECTION_ID);
const body = (document) => document.getElementById(ORG_COACHING_BODY_ID);
const live = (document) => document.getElementById(ORG_COACHING_LIVE_ID);
// The control lives in the panel that already named the residue: "What are the
// limits of this sample?" is where the clusters and the points each one holds
// were published, so it is where a lead resolves them.
const reviewPanel = (document) => document.getElementById(panelId(DISCLOSURE_IDS.sampling));
const coverageText = (document) =>
  textOf(body(document).querySelector(".org-coaching-coverage-text"));
const marker = (document) => body(document).querySelector(".org-coaching-coverage-marker");
const selectAt = (document, index) => document.getElementById(residueSelectId(index));

/** Boot the shipped page, import one generated sample through its own input, open the review. */
async function openReview(text = sampleText(), { open = true } = {}) {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  const input = page.document.getElementById("local-finops-files");
  input.files = [{ name: "lead-corpus.csv", type: "text/csv", text: async () => text }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  await waitFor(() => !section(page.document).hidden, "the coaching decision to be painted");
  if (open) page.document.getElementById(toggleId(DISCLOSURE_IDS.sampling)).click();
  return page;
}

/**
 * Change a control the way a keyboard user does: one arrow key at a time,
 * through the option list the page actually rendered. A value the control never
 * offered has no key sequence that reaches it, which is the property this
 * harness's permissive `select.value` setter would otherwise hide.
 */
function chooseByKeyboard(document, index, value) {
  const options = selectAt(document, index).options.map((option) => option.value);
  const target = options.indexOf(value);
  assert.notEqual(target, -1, `"${value}" is not among the options this control rendered`);
  while (selectAt(document, index).value !== value) {
    const control = selectAt(document, index);
    const at = control.options.map((option) => option.value).indexOf(control.value);
    control.focus();
    pressKey(document, at < target ? "ArrowDown" : "ArrowUp");
  }
  return selectAt(document, index);
}

/* ------------------------------ the option set ------------------------------- */

test("the control offers the rubric's classes, one refusal, and an unassigned default", async () => {
  const { document } = await openReview();
  const control = selectAt(document, 0);
  assert.equal(control.tagName, "SELECT", "an assignment control must be a real form control");

  // Read off the rendered control, not off the model: the harness would accept a
  // value this option list never contained, so the list itself is the assertion.
  const values = control.options.map((option) => option.value);
  assert.deepEqual(values, ["", ...CATEGORY_KEYS, RESIDUE_UNCLASSIFIABLE]);
  assert.equal(control.value, "", "the default is unassigned, not a guess");
  assert.ok(control.options.every((option) => textOf(option).length > 0),
    "every option needs a visible name");

  // Real label association, and the name identifies WHICH cluster.
  const label = reviewPanel(document).querySelector("label");
  assert.equal(label.getAttribute("for"), control.id);
  const description = textOf(
    reviewPanel(document).querySelector(".org-coaching-residue-description"));
  assert.ok(textOf(label).includes(description),
    `the control's label must name its cluster, not repeat "Class"`);

  // A real list with an accessible name, inside a region that has one.
  const list = reviewPanel(document).querySelector(".org-coaching-residue-list");
  assert.equal(list.tagName, "UL");
  assert.equal(list.getAttribute("aria-labelledby"),
    reviewPanel(document).querySelector("h4").id);
  assert.ok(reviewPanel(document).getAttribute("aria-label").length > 0);
});

/* ------------------------------ live recompute -------------------------------- */

test("assigning one cluster recomputes coverage and the headline", async () => {
  const { document } = await openReview();
  const before = coverageText(document);
  assert.match(before, /^3\.5% of this corpus's billed tokens/);
  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.ungradeable);

  // The smallest cluster: enough to move the number, not enough to cross the bar.
  chooseByKeyboard(document, 2, "highValue");

  assert.match(coverageText(document), /^13\.5% of this corpus's billed tokens/);
  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.ungradeable,
    "10 points of coverage does not reach the letter floor and must not pretend to");
  // The number moved through the aggregation, so the ranked next action moved with it.
  assert.match(textOf(body(document).querySelector(".org-coaching-coverage-action")),
    /vendor-y-max/);
});

test("assigning enough clusters crosses the bar and the letter appears", async () => {
  const { document } = await openReview();
  const lead = () => body(document).querySelector(".org-coaching-lead");
  assert.equal(lead().dataset.gradeStatus, "ungradeable");
  assert.equal(body(document).querySelector(".org-coaching-letter"), null,
    "no letter is published under the coverage floor");

  chooseByKeyboard(document, 0, "inefficient");

  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.graded);
  assert.equal(lead().dataset.gradeStatus, "graded");
  const letter = body(document).querySelector(".org-coaching-letter");
  assert.ok(letter && textOf(letter).length === 1, "the letter grade unlocks with the coverage");
  assert.match(coverageText(document), /^63\.4% of this corpus's billed tokens/);
  // And the live region says so, once, on the committed change.
  assert.match(textOf(live(document)), /Recomputed with 1 lead-supplied label\. 63\.4%/);
});

/* -------------------------------- provenance ---------------------------------- */

test("the lead-supplied marker carries the count and disappears at zero", async () => {
  const { document } = await openReview();
  assert.equal(marker(document), null, "an unassisted reading is not marked as assisted");

  chooseByKeyboard(document, 0, "inefficient");
  assert.match(textOf(marker(document)), /includes 1 lead-supplied label\./);
  // Visible text in the flow, never a tooltip.
  assert.equal(marker(document).getAttribute("title"), null);
  // What the import earned on its own stays legible beside the corrected reading.
  assert.match(textOf(body(document).querySelector(".org-coaching-coverage-unassisted")),
    /^Unassisted: 3\.5% of this corpus's billed tokens/);

  chooseByKeyboard(document, 1, "highValue");
  assert.match(textOf(marker(document)), /includes 2 lead-supplied labels\./);
  assert.equal(
    body(document).querySelector(".org-coaching-coverage-lead").dataset.leadLabels, "2");

  // Back to unassigned on both, and the marker is gone rather than reading zero.
  chooseByKeyboard(document, 0, "");
  chooseByKeyboard(document, 1, "");
  assert.equal(marker(document), null);
  assert.match(coverageText(document), /^3\.5% of this corpus's billed tokens/);
});

/* ------------------------------ reset and re-import --------------------------- */

test("the page's own clear and a re-import both drop every lead label", async () => {
  const { document } = await openReview();
  chooseByKeyboard(document, 0, "inefficient");
  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.graded);

  // The page's existing reset, not a control this feature added.
  document.getElementById("clear-local-analysis").click();
  assert.equal(section(document).hidden, true);

  const input = document.getElementById("local-finops-files");
  input.files = [{ name: "lead-corpus.csv", type: "text/csv", text: async () => sampleText() }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  await waitFor(() => !section(document).hidden, "the re-import to paint");

  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.ungradeable);
  assert.match(coverageText(document), /^3\.5% of this corpus's billed tokens/);
  assert.equal(marker(document), null, "a label cannot outlive the corpus it described");
  document.getElementById(toggleId(DISCLOSURE_IDS.sampling)).click();
  assert.equal(selectAt(document, 0).value, "");
});

/* -------------------------------- no sample text ------------------------------ */

test("no per-record prompt text reaches the disclosure, only structural signatures", async () => {
  const { document } = await openReview();
  // The fixture put this string on every unclassified row, which is exactly the
  // set of rows this control describes.
  assert.ok(!textOf(section(document)).includes(PROMPT_SENTINEL),
    "a per-record excerpt was echoed into the review");
  assert.ok(!section(document).innerHTML?.includes?.(PROMPT_SENTINEL));

  const descriptions = reviewPanel(document)
    .querySelectorAll(".org-coaching-residue-description").map((node) => textOf(node));
  assert.equal(descriptions.length, 3);
  // Row count plus the structural field that keyed the cluster, largest first.
  assert.deepEqual(descriptions, [
    "6 rows sharing model “vendor-y-max”",
    "4 rows sharing model “vendor-z-turbo”",
    "3 rows sharing model “vendor-q-nano”",
  ]);
  // Share as an absolute amount and a percentage, in the corpus's own unit.
  assert.match(textOf(reviewPanel(document).querySelector(".org-coaching-residue-share")),
    /^10,800 billed tokens · 59\.9% of the scored denominator/);
});

/* --------------------------------- keyboard ----------------------------------- */

test("the control is operable by keyboard and keeps focus across the recompute", async () => {
  const { document } = await openReview();
  const control = selectAt(document, 1);
  control.focus();
  assert.equal(document.activeElement.id, residueSelectId(1));

  pressKey(document, "ArrowDown");

  // The region re-rendered — and focus is on the control the lead just used, not
  // on the top of the page and not on a node that no longer exists.
  assert.notEqual(coverageText(document), "");
  assert.equal(document.activeElement.id, residueSelectId(1));
  assert.equal(document.activeElement.value, CATEGORY_KEYS[0]);
  assert.equal(reviewPanel(document).hidden, false, "the panel the reader was in stays open");
});

/* ------------------------------- edge states ---------------------------------- */

test("a corpus with no residue says so instead of rendering an empty list", async () => {
  const { document } = await openReview(sampleText([]));
  assert.match(textOf(reviewPanel(document)), /Nothing to review/);
  assert.equal(reviewPanel(document).querySelector(".org-coaching-residue-list"), null);
  assert.equal(reviewPanel(document).querySelector("select"), null);
  // And the panel's own rows say the same thing in the aggregation's words, so
  // the two statements sharing one panel cannot disagree.
  assert.match(textOf(reviewPanel(document)), /no cluster is holding coverage back/);
});

test("clusters marked unclassifiable do not raise coverage and end the loop", async () => {
  const { document } = await openReview();
  for (const index of [0, 1, 2]) chooseByKeyboard(document, index, RESIDUE_UNCLASSIFIABLE);

  // The honest consequence of "no class fits": the number does not move.
  assert.match(coverageText(document), /^3\.5% of this corpus's billed tokens/);
  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.ungradeable);
  // They are still lead-supplied statements, so they are still marked.
  assert.match(textOf(marker(document)), /includes 3 lead-supplied labels\./);
  // And the next action stops sending the reader back to a cluster they ruled on.
  const action = textOf(body(document).querySelector(".org-coaching-coverage-action"));
  assert.match(action, /marked genuinely unclassifiable/);
  assert.ok(!/^Resolve/.test(action), "the action must not loop on a resolved cluster");

  // One of them reconsidered: the action names the largest cluster still open.
  chooseByKeyboard(document, 1, "");
  assert.match(textOf(body(document).querySelector(".org-coaching-coverage-action")),
    /Resolve “vendor-z-turbo” next/);
});

/* -------------------------------- responsive ---------------------------------- */

test("the residue rows stack at narrow widths and only gain a column at the breakpoint",
  async () => {
    const css = await readFile(STYLESHEET, "utf8");
    const block = css.slice(css.indexOf(".org-coaching-coverage-lead {"),
      css.indexOf("The one-page department"));
    const breakpoint = block.indexOf("@media (min-width:52rem)");
    assert.notEqual(breakpoint, -1);
    const narrow = block.slice(0, breakpoint);
    assert.match(narrow, /\.org-coaching-residue-item \{[^}]*display:grid/);
    assert.ok(!/grid-template-columns/.test(narrow),
      "a column template before the breakpoint forces horizontal scrolling on a phone");
    // The description has to wrap, and nothing may be pinned wider than its box.
    assert.match(narrow, /\.org-coaching-residue-description[^{]*\{[^}]*overflow-wrap:anywhere/);
    assert.match(narrow, /\.org-coaching-residue-select \{[^}]*max-width:100%/);
    assert.ok(!/[^-]width:\s*\d+px/.test(block), "a fixed pixel width would clip at small sizes");
  });
