// The working behind the recoverable figure, as a skeptic reads it (#1524).
//
// Four things are held here: the heading hierarchy (which genuinely fails on a
// skipped level — the skew fixture below proves it), the parity between the
// labels this module owns and what the shipped document says, the disclosure's
// keyboard state, and the rule that no chip tells its status with a colour
// class alone.
//
// HARNESS NOTES, because they change what an assertion can mean here. The test
// harness reads straight through a closed details element, so a "the detail is
// readable" assertion passes vacuously; the disclosure test below asserts on
// `open` and `aria-expanded` instead. It also reflects no properties and
// rejects the universal and descendant selectors, so every walk below recurses
// `children` and reads attributes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EVIDENCE_CLAIM, EVIDENCE_INPUTS, EVIDENCE_LABELS, EVIDENCE_RUBRIC,
  EVIDENCE_STATES, EVIDENCE_STEPS, applyEvidenceWorking,
  applyEvidenceWorkingState, evidenceState, evidenceWorkingMarkup, stepText,
} from "../src/finops-evidence-working.js";
import { parseHtml, textOf } from "./support/browser.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const HEADING = /^h([1-6])$/i;

/** Every heading inside a subtree, in document order, as level numbers. */
function headingLevels(node, found = []) {
  for (const child of node?.children ?? []) {
    const match = HEADING.exec(String(child.tagName ?? ""));
    if (match) found.push(Number(match[1]));
    headingLevels(child, found);
  }
  return found;
}

/** Every element in a subtree, in document order. Text nodes carry no dataset. */
function elements(node, found = []) {
  for (const child of node?.children ?? []) {
    if (child.tagName) found.push(child);
    elements(child, found);
  }
  return found;
}

const region = (markup) =>
  parseHtml(markup).getElementById("finops-evidence-working");

// ---------------------------------------------------------------------------
// 1. Heading hierarchy — and a skipped level really does fail.
// ---------------------------------------------------------------------------

test("the destination's headings start at h2 and never skip a level", () => {
  const levels = headingLevels(region(evidenceWorkingMarkup()));
  assert.ok(levels.length >= 4, "the working is drawn in named parts, not one slab");
  assert.equal(levels[0], 2, "the block names itself at h2, under the page's h1");
  for (let index = 1; index < levels.length; index += 1) {
    assert.ok(levels[index] - levels[index - 1] <= 1,
      `heading ${index} jumps from h${levels[index - 1]} to h${levels[index]}`);
  }
});

test("the heading walk fails when a level is skewed", () => {
  // The same walk over markup with one h3 pushed to h4 — proof the assertion
  // above is load-bearing rather than a shape that passes on anything.
  const skewed = evidenceWorkingMarkup()
    .replace('<h3 id="finops-evidence-rubric-title">', '<h5 id="finops-evidence-rubric-title">')
    .replace("Rubric version and pricing provenance</h3>", "Rubric version and pricing provenance</h5>");
  const levels = headingLevels(region(skewed));
  const skips = levels.filter((level, index) => index > 0 && level - levels[index - 1] > 1);
  assert.equal(skips.length, 1, "a skipped level is visible to the same walk");
});

// ---------------------------------------------------------------------------
// 2. Parity — one list drives the render and the assertion.
// ---------------------------------------------------------------------------

test("every hedge label this module owns is stated once, in the shipped document", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  const block = document.getElementById("finops-evidence-rubric");
  assert.ok(block, "the shipped page carries the rubric and pricing block");
  const terms = elements(block)
    .filter((node) => String(node.tagName).toLowerCase() === "dt")
    .map((node) => textOf(node).trim());
  assert.deepEqual(terms, [...EVIDENCE_LABELS],
    "the document's labels and the module's list disagree");
  assert.equal(new Set(terms).size, terms.length, "a label is stated twice");
});

test("the document ships the module's own render, byte for byte", async () => {
  const html = await read("src/evolution.html");
  assert.ok(html.includes(evidenceWorkingMarkup()),
    "src/evolution.html and evidenceWorkingMarkup() have drifted apart");
});

test("every arithmetic step names an operand, an operation and a running result", () => {
  assert.ok(EVIDENCE_STEPS.length >= 3, "an arithmetic chain is a sequence, not a claim");
  const document = parseHtml(evidenceWorkingMarkup());
  const list = document.getElementById("finops-evidence-arithmetic");
  assert.equal(String(list.tagName).toLowerCase(), "ol",
    "the chain is ordered markup, not a styled list of unordered facts");
  const items = elements(list).filter((node) => String(node.tagName).toLowerCase() === "li");
  assert.equal(items.length, EVIDENCE_STEPS.length);
  items.forEach((item, index) => {
    assert.equal(textOf(item).trim(), stepText(EVIDENCE_STEPS[index]));
    assert.match(textOf(item), /Running total:/, "a step with no running result is a remark");
  });
  assert.match(textOf(items.at(-1)), /615,048/, "the chain does not reach the figure it defends");
});

// ---------------------------------------------------------------------------
// 3. Disclosure — assert on state, never on readability.
// ---------------------------------------------------------------------------

test("the inputs disclosure is a native control that carries its own state", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  const details = document.getElementById("finops-evidence-inputs");
  const summary = document.getElementById("finops-evidence-inputs-summary");
  assert.equal(String(details.tagName).toLowerCase(), "details",
    "a native disclosure is focusable and Enter-operable with no script");
  assert.equal(String(summary.tagName).toLowerCase(), "summary");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(details.getAttribute("open"), null, "it ships collapsed");
  assert.equal(details.getAttribute("data-disclosure"), "collapsed");
  // The summary says what is behind it while it is shut. A summary that only
  // says "more" is a control a reader cannot decide about.
  assert.match(textOf(summary), /Source of record/);
});

test("nothing canonical and nothing live is inside the disclosure", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  const inside = elements(document.getElementById("finops-evidence-inputs"));
  const LIVE_ROLES = ["status", "alert", "log", "timer", "marquee"];
  for (const node of inside) {
    assert.ok(!LIVE_ROLES.includes(String(node.getAttribute?.("role") ?? "")),
      "a live role folded into a shut disclosure is silent in a browser");
    assert.ok(!node.getAttribute?.("aria-live"), "a live region is folded into the disclosure");
  }
  // The figure being defended is a sibling of the disclosure, not a child.
  const claim = document.getElementById("finops-evidence-working-claim");
  assert.match(textOf(claim), new RegExp(EVIDENCE_CLAIM.display.replace("$", "\\$")));
  assert.equal(inside.filter((node) => node.getAttribute?.("id") === "finops-evidence-working-claim").length, 0);
});

// ---------------------------------------------------------------------------
// 4. Every state is drawn, and no state is told by colour.
// ---------------------------------------------------------------------------

test("all four states carry a word, a shape and a sentence", () => {
  assert.deepEqual([...EVIDENCE_STATES], ["ready", "loading", "empty", "error"]);
  for (const state of EVIDENCE_STATES) {
    const line = evidenceState(state);
    assert.ok(line.word.length > 0, `${state} has no word`);
    assert.ok(line.shape.length > 0, `${state} has no shape`);
    assert.ok(line.summary.length > 20, `${state} does not say what it means`);
  }
  assert.match(evidenceState("loading").summary, /Recomputing/,
    "the loading state is labelled, not a bare spinner");
  assert.match(evidenceState("empty").summary, /Import a provider export/,
    "the empty state does not say what would populate it");
  assert.match(evidenceState("error").summary, /rate card is the source to check first/,
    "the error state does not say what to do next");
});

test("every state keeps the heading structure and the figure being defended", () => {
  for (const state of EVIDENCE_STATES) {
    const markup = evidenceWorkingMarkup("      ", state);
    const levels = headingLevels(region(markup));
    assert.deepEqual(levels, [2, 3, 3, 3], `${state} changed the heading structure`);
    assert.ok(markup.includes(EVIDENCE_CLAIM.display), `${state} dropped the canonical figure`);
  }
});

test("no chip states its status with a class and no text", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  const chip = document.getElementById("finops-evidence-working-chip");
  const word = document.getElementById("finops-evidence-working-word");
  const shape = document.getElementById("finops-evidence-working-shape");
  assert.ok(textOf(word).trim().length > 0, "the chip's status is a readable word");
  assert.equal(shape.getAttribute("aria-hidden"), "true",
    "the glyph is decoration beside the word, never the word's replacement");
  // Silhouette, per the chip rule in design-system/claude-design: a filled wash
  // is a dynamic signal and an outline is a static classification. It is a
  // third channel, never the only one.
  assert.ok(["filled", "outline"].includes(chip.getAttribute("data-silhouette")));
  for (const state of EVIDENCE_STATES) {
    assert.ok(["filled", "outline"].includes(evidenceState(state).silhouette));
  }
});

// ---------------------------------------------------------------------------
// 5. The repaint writes the same strings the document ships.
// ---------------------------------------------------------------------------

test("repainting the region from the module changes nothing on an ordinary open", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  assert.equal(applyEvidenceWorking(document), true);
  const rubric = document.getElementById("finops-evidence-rubric");
  const terms = elements(rubric)
    .filter((node) => String(node.tagName).toLowerCase() === "dt")
    .map((node) => textOf(node).trim());
  assert.deepEqual(terms, EVIDENCE_RUBRIC.map((row) => row.term));
  const inputs = document.getElementById("finops-evidence-inputs-detail");
  assert.equal(
    elements(inputs).filter((node) => String(node.tagName).toLowerCase() === "dt").length,
    EVIDENCE_INPUTS.length,
  );
});

test("painting a state moves all three channels, and an unknown state falls back", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  applyEvidenceWorkingState(document, "error");
  assert.equal(document.getElementById("finops-evidence-working").getAttribute("data-state"), "error");
  assert.equal(textOf(document.getElementById("finops-evidence-working-word")).trim(),
    evidenceState("error").word);
  assert.equal(evidenceState("nonsense").state, "ready");
});

test("neither painter throws on a page that does not carry the region", () => {
  const document = parseHtml("<!doctype html><html><body><p>nothing here</p></body></html>");
  assert.equal(applyEvidenceWorking(document), false);
  assert.equal(applyEvidenceWorkingState(document, "loading"), null);
});
