// The FinOps front-door decision, read rather than looked at.
//
// Four groups of claims, and each one is a defect this page has actually been
// able to have:
//
//   1. READING ORDER. Answer → benchmark → action → provenance, ahead of
//      supporting detail, in the DOM — which is what makes it the focus order
//      and the print order too. Held against `READING_ORDER`, so the
//      specification and the document cannot drift.
//   2. THE DISCLOSURE. Native `details`, an accessible name that says what it
//      reveals *and* whether it is open, and a state that is a word and a shape
//      before it is a colour.
//   3. EVERY STATE DRAWN. Loading, empty, error, and a figure that cannot be
//      true. The last one is the state that gets skipped, and it is the one
//      where a broken input becomes a decision.
//   4. PRINT. The regression this file exists for: a shut `details` whose
//      evidence must still print on an engine with no `::details-content`.
//      Asserted by *removing* every `::details-content` rule from the sheet and
//      checking the evidence still has a rule that reaches it.
//
// Contrast is computed here rather than eyeballed: the focus ring and the
// disclosure chip are both non-negotiable channels, so their ratios are pinned.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  auditDecisionFigures, DECISION_SPINE, DECISION_STATE, DISCLOSURE_SPEC,
  disclosureName, disclosureStateLabel, FIGURE_BOUNDS, FOCUS_SPEC,
  headingOutline, INTERACTION_SPEC_VERSION, noticeFor, OUT_OF_RANGE_VALUE,
  PRINT_SPEC, READING_ORDER, REGION_STATES,
  validateHeadingOutline, validateReadingOrder,
} from "../src/finops-decision-interaction.js";
import {
  buildFirstRunResult, composeFirstRunResult, FIRST_RUN_IDS, FIRST_RUN_STATE,
} from "../src/finops-first-run.js";
import { applyFirstRunResult, paintDisclosureState } from "../src/finops-first-run-view.js";
import { loadCanonicalDecision } from "../src/finops-decision-contract.js";
import { buildFinopsBriefing } from "../src/finops-briefing-contract.js";
import { loadExampleDataset } from "../src/example-dataset.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const SHEET = new URL("../src/evolution.css", import.meta.url);
const VIEW = new URL("../src/finops-first-run-view.js", import.meta.url);

const html = await readFile(PAGE, "utf8");
const css = await readFile(SHEET, "utf8");
const view = await readFile(VIEW, "utf8");
const byId = (document, id) => document.getElementById(id);

/** Strip CSS comments, so a rule cannot be "present" only inside prose. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

/** The stylesheet with its prose removed — every selector search runs on this. */
const CLEAN = withoutComments(css);

/** Flat author rules whose selector list contains a first-run selector. */
const FIRST_RUN_RULES = [...CLEAN.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selectors, declarations]) => ({ selectors: selectors.trim(), declarations }))
  .filter(({ selectors }) => selectors.split(",").some((selector) => selector.trim().startsWith(".first-run")));

/** The `@media print` block, brace-balanced, without its wrapper. */
function printBlock(sheet) {
  const start = sheet.indexOf("@media print");
  assert.ok(start >= 0, "the sheet has no @media print block at all");
  let depth = 0;
  for (let i = sheet.indexOf("{", start); i < sheet.length; i += 1) {
    if (sheet[i] === "{") depth += 1;
    else if (sheet[i] === "}") {
      depth -= 1;
      if (depth === 0) return sheet.slice(sheet.indexOf("{", start) + 1, i);
    }
  }
  throw new Error("unbalanced @media print block");
}

const PRINT_RULES = printBlock(CLEAN);

// --- contrast --------------------------------------------------------------

function channel(part) {
  const value = part / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// ---------------------------------------------------------------------------
// 1. Reading order
// ---------------------------------------------------------------------------

test("the specification is one ordered spine, decision before supporting detail", () => {
  assert.match(INTERACTION_SPEC_VERSION, /^finops-decision-interaction\/\d+\.\d+\.\d+$/);
  // Answer, then what sizes it, then where that leaves this org against
  // comparable ones, then which of its own teams that is coming from, then what
  // to do about it, then how to check it. The position and the named lagging
  // team precede the action because they are the facts that justify it: read
  // linearly, an action ahead of its evidence is an instruction a reader has no
  // way to weigh, and a screen-reader user cannot scan back the way a sighted
  // reader can.
  assert.deepEqual(DECISION_SPINE.slice(3),
    ["answer", "benchmark", "impact", "peer", "internal", "action", "confidence", "provenance"]);
  // Steps are numbered in reading order and nothing repeats an id.
  assert.deepEqual(READING_ORDER.map((step) => step.step),
    READING_ORDER.map((_, index) => index + 1));
  assert.equal(new Set(READING_ORDER.map((step) => step.id)).size, READING_ORDER.length);
  // No supporting step is declared before the last decision step.
  const lastDecision = READING_ORDER.filter((s) => s.rank === "decision").at(-1).step;
  for (const step of READING_ORDER.filter((s) => s.rank === "supporting")) {
    assert.ok(step.step > lastDecision, `${step.key} is supporting but precedes the spine`);
  }
});

test("the shipped document is in the specified reading order, before any script", () => {
  const report = validateReadingOrder(parseHtml(html));
  assert.deepEqual(report.missing, [], "a specified step has no element in the document");
  assert.deepEqual(report.outOfOrder, [], "the DOM contradicts the specified order");
  assert.deepEqual(report.demoted, [], "supporting detail precedes part of the decision");
  assert.equal(report.ok, true);
});

test("the region's heading outline is unbroken and starts under the page h1", () => {
  const document = parseHtml(html);
  const region = byId(document, "finops-first-run");
  const report = validateHeadingOutline(region, { startLevel: 2 });
  assert.deepEqual(report.skips, [], "the region skips a heading level");
  // One h2 — the decision question — and every part of the answer under it.
  const levels = report.outline.map((heading) => heading.level);
  assert.equal(levels.filter((level) => level === 2).length, 1);
  assert.equal(levels[0], 2, "the region opens with its own h2");
  assert.ok(levels.slice(1).every((level) => level === 3), "every part sits at h3");
  // And that h2 is under the page's single h1 rather than competing with it.
  assert.equal(headingOutline(document).filter((h) => h.level === 1).length, 1);
  assert.ok(html.indexOf('id="page-title"') < html.indexOf('id="finops-first-run-title"'));

  // Every specified heading step really is a heading element, not a styled p.
  for (const step of READING_ORDER.filter((entry) => entry.level)) {
    assert.equal(byId(document, step.id).tagName.toLowerCase(), `h${step.level}`,
      `${step.key} is specified as h${step.level}`);
  }
});

test("reading order is focus order: DOM order, and no positive tabindex", () => {
  const document = parseHtml(html);
  const region = byId(document, "finops-first-run");
  const inRegion = (node) => {
    for (let walk = node; walk; walk = walk.parentNode) if (walk === region) return true;
    return false;
  };
  const reachable = tabSequence(document).filter(inRegion).map((node) => node.id).filter(Boolean);
  // The summary is focusable by being a summary — the browser owns that, and no
  // attribute here can add or remove it — so the sequence is checked for the
  // controls this page authors, and the summary's place in it is checked as the
  // DOM position it is reached from.
  assert.deepEqual(reachable, FOCUS_SPEC.order.filter((id) => id !== DISCLOSURE_SPEC.summaryId),
    "every authored control in the region is reachable, in the order it is read");
  assert.ok(html.indexOf(`id="${DISCLOSURE_SPEC.summaryId}"`) < html.indexOf(`id="${FOCUS_SPEC.order[1]}"`),
    "the evidence control is reached before the two next steps");
  // A positive tabindex is the one way an author makes focus order disagree
  // with reading order, so the document is held to not containing one.
  assert.doesNotMatch(html, /tabindex="[1-9]/);
  // And nothing in the region is reordered visually away from where it is read.
  for (const { selectors, declarations } of FIRST_RUN_RULES) {
    assert.doesNotMatch(declarations, /(?:flex-direction:\s*\w+-reverse|(?:^|;)\s*order:\s*-?\d)/,
      `${selectors} visually reorders the decision`);
  }
});

test("every focusable control in the region has a visible, high-contrast ring", () => {
  for (const id of FOCUS_SPEC.order) {
    const selector = id === DISCLOSURE_SPEC.summaryId ? ".first-run-method>summary" : null;
    if (!selector) continue;
    assert.match(css, new RegExp(`${selector.replace(/[.>]/g, "\\$&")}:focus-visible \\{[^}]*outline:3px solid var\\(--focus-ring\\)`));
  }
  assert.match(css, /\.first-run-choice button:focus-visible \{[^}]*outline:3px solid var\(--focus-ring\)/);
  assert.ok(FOCUS_SPEC.minOutlineWidthPx >= 3);
  // WCAG 2.2 asks 3:1 for a non-text indicator. The ring is checked against the
  // page, the region's own wash, and the white the gradient resolves to.
  for (const background of ["#f3f1eb", "#eef6f2", "#ffffff"]) {
    const ratio = contrast(FOCUS_SPEC.color, background);
    assert.ok(ratio >= 3, `focus ring is ${ratio.toFixed(2)}:1 on ${background}`);
  }
});

// ---------------------------------------------------------------------------
// 2. The disclosure
// ---------------------------------------------------------------------------

test("the evidence disclosure is native, so the keyboard is the browser's job", () => {
  const document = parseHtml(html);
  const details = byId(document, DISCLOSURE_SPEC.id);
  assert.equal(details.tagName.toLowerCase(), "details");
  const summary = byId(document, DISCLOSURE_SPEC.summaryId);
  assert.equal(summary.tagName.toLowerCase(), "summary");
  assert.equal(summary.parentNode, details, "the summary is the details' own child");
  // The heading lives inside the summary, which is where the outline and the
  // control become one line rather than two competing ones.
  assert.equal(byId(document, DISCLOSURE_SPEC.headingId).tagName.toLowerCase(), "h3");
  // Nothing re-handles a key. Enter, Space, and the pointer all go through the
  // native control; a view that listened for keys would be a second, worse
  // implementation of behaviour the element already ships.
  assert.doesNotMatch(view, /keydown|keypress|keyup/);
});

test("the disclosure states its state in a word and a shape, not only a chevron", () => {
  assert.equal(disclosureStateLabel(false, 6), "Show evidence · 6");
  assert.equal(disclosureStateLabel(true, 6), "Hide evidence · 6");
  assert.equal(disclosureStateLabel(false), "Show evidence");
  assert.notEqual(DISCLOSURE_SPEC.expanded.shape, DISCLOSURE_SPEC.collapsed.shape);
  assert.notEqual(DISCLOSURE_SPEC.expanded.action, DISCLOSURE_SPEC.collapsed.action);
  // The accessible name is the visible text, so a speech-control user can say
  // what they can see. No aria-label anywhere near this control.
  assert.equal(disclosureName(false, 6),
    `${DISCLOSURE_SPEC.heading} Show evidence · 6`);
  assert.doesNotMatch(view, /aria-label/);
  // The chip is a filled wash because expanded/collapsed is a dynamic signal —
  // the silhouette rule the Claude Design foundations card sets. Both fills are
  // checked against their own text.
  assert.ok(contrast("#244c3c", "#e2ebe6") >= 4.5, "collapsed chip text is under 4.5:1");
  assert.ok(contrast("#ffffff", "#315f50") >= 4.5, "expanded chip text is under 4.5:1");
});

test("expanded and collapsed are painted into name, aria-expanded, and shape", () => {
  const document = parseHtml(html);
  const details = byId(document, DISCLOSURE_SPEC.id);
  const summary = byId(document, DISCLOSURE_SPEC.summaryId);

  paintDisclosureState(document, 6);
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(details.dataset.disclosure, "collapsed");
  assert.equal(textOf(byId(document, DISCLOSURE_SPEC.stateId)),
    `${DISCLOSURE_SPEC.collapsed.shape} Show evidence · 6`);

  details.setAttribute("open", "");
  paintDisclosureState(document, 6);
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.equal(details.dataset.disclosure, "expanded");
  assert.equal(textOf(byId(document, DISCLOSURE_SPEC.stateId)),
    `${DISCLOSURE_SPEC.expanded.shape} Hide evidence · 6`);
});

test("the state chip stays in step with `open` on a real toggle", async () => {
  const page = await loadPage(PAGE, { modules: false });
  try {
    const { document } = page;
    const { bindFirstRunDisclosure } = await importPageModule("/finops-first-run-view.js");
    const details = byId(document, DISCLOSURE_SPEC.id);
    bindFirstRunDisclosure(document);
    assert.equal(byId(document, DISCLOSURE_SPEC.summaryId).getAttribute("aria-expanded"), "false");
    details.setAttribute("open", "");
    details.dispatchEvent({ type: "toggle", bubbles: false });
    assert.equal(byId(document, DISCLOSURE_SPEC.summaryId).getAttribute("aria-expanded"), "true");
    assert.match(textOf(byId(document, DISCLOSURE_SPEC.stateId)), /Hide evidence/);
  } finally {
    page.restore?.();
  }
});

// ---------------------------------------------------------------------------
// 3. Every state drawn
// ---------------------------------------------------------------------------

test("every state carries a word and a shape, so colour is never the channel", () => {
  const shapes = new Set();
  for (const [key, state] of Object.entries(DECISION_STATE)) {
    assert.ok(state.word.trim().length > 0, `${key} has no word`);
    assert.ok(state.shape.trim().length > 0, `${key} has no shape`);
    assert.ok(state.statement.trim().length > 0, `${key} has no sentence`);
    assert.ok(!shapes.has(state.shape), `${key} reuses a shape another state owns`);
    shapes.add(state.shape);
  }
  // Loading is specified, and specified as somebody else's: the front door is
  // composed from a module in the bundle and waits on nothing.
  assert.equal(DECISION_STATE.loading.owner, "finops-load-state");
  assert.deepEqual(REGION_STATES, ["pending", "ready", "empty", "unavailable"]);
  assert.equal(FIRST_RUN_STATE.empty.state, "empty");
  // Empty is not error. Same region, different question for the reader.
  assert.notEqual(FIRST_RUN_STATE.empty.tone, FIRST_RUN_STATE.unavailable.tone);
  assert.match(css, /\.first-run\[data-state="empty"\]/);
  assert.match(css, /\.first-run\[data-state="unavailable"\]/);
});

test("an analysis that read nothing is empty, not an error", () => {
  const analysis = { schemaVersion: "x", spendUsd: 0, recoverableUsd: 0, rankedDepartments: [] };
  const result = composeFirstRunResult({
    analysis, briefing: { coverage: { recordsTotal: 0, recordsAnalyzed: 0 } }, decision: null,
  });
  assert.equal(result.presentation.state, "empty");
  assert.equal(result.presentation.tone, "neutral", "an empty dataset is not drawn as a failure");
  assert.match(result.answer.value, /No spend was recorded/);
  // The two next steps survive it, which is the whole reason it is not blank.
  assert.equal(result.actions.demo.label.length > 0, true);
});

test("a figure that cannot be true is refused rather than formatted", () => {
  // Each bound, one at a time, so a failure names the figure that broke.
  assert.deepEqual(auditDecisionFigures({}), []);
  assert.equal(noticeFor(auditDecisionFigures({ share: 4.12 }), "share").code, "share_out_of_range");
  assert.equal(noticeFor(auditDecisionFigures({ share: -0.1 }), "share").code, "share_out_of_range");
  assert.equal(noticeFor(auditDecisionFigures({ impactUsd: -5 }), "impactUsd").code,
    "impactUsd_out_of_range");
  assert.equal(noticeFor(auditDecisionFigures({ confidence: 1.4 }), "confidence").code,
    "confidence_out_of_range");
  assert.equal(noticeFor(auditDecisionFigures({ rank: 0 }), "rank").code, "rank_out_of_range");
  assert.equal(noticeFor(auditDecisionFigures({ share: Number.NaN }), "share").code,
    "share_not_a_number");
  assert.equal(noticeFor(auditDecisionFigures({ share: Infinity }), "share").code,
    "share_not_a_number");
  // A figure inside its bounds is not a notice, and neither is an absent one.
  assert.deepEqual(auditDecisionFigures({ share: 0.33, confidence: 0.85, rank: 1 }), []);
  assert.deepEqual(auditDecisionFigures({ share: null, impactUsd: undefined }), []);
  // The one relationship rule: a scenario cannot recover more than was analyzed.
  const crossed = auditDecisionFigures({ impactUsd: 900, analyzedUsd: 100 });
  assert.equal(crossed[0].code, "impact_exceeds_analyzed");
  assert.ok(FIGURE_BOUNDS.share.max === 1 && FIGURE_BOUNDS.confidence.max === 1);
  // Total: no shape of input throws.
  for (const input of [null, undefined, 0, "x", [], { share: {} }]) {
    assert.ok(Array.isArray(auditDecisionFigures(input)));
  }
});

test("an implausible impact is drawn as out of range, with the value that broke", () => {
  const analysis = loadExampleDataset();
  const briefing = buildFinopsBriefing(analysis);
  const broken = {
    ...briefing,
    materialMetric: { ...briefing.materialMetric, unit: "USD", value: analysis.spendUsd * 10 },
  };
  const result = composeFirstRunResult({
    analysis, briefing: broken, decision: loadCanonicalDecision().decision,
  });
  // The benchmark still stands — only the figure that broke is withheld.
  assert.equal(result.benchmark.available, true);
  assert.equal(result.impact.available, false);
  assert.match(result.impact.value, new RegExp(`^${OUT_OF_RANGE_VALUE}: `));
  assert.match(result.impact.detail, /larger than the spend/);
  assert.notEqual(result.impact.value, "Unavailable",
    "an impossible figure and an absent one are different facts");
  assert.equal(result.notices.length, 1);
});

test("a refused figure is flagged on the region, not only inside the slot", async () => {
  const page = await loadPage(PAGE, { modules: false });
  try {
    const { document } = page;
    const clean = buildFirstRunResult();
    applyFirstRunResult(document, clean);
    assert.equal(byId(document, "finops-first-run").dataset.figures, "in-range");
    applyFirstRunResult(document, { ...clean, notices: [{ key: "share", value: "4.12" }] });
    assert.equal(byId(document, "finops-first-run").dataset.figures, "out-of-range");
  } finally {
    page.restore?.();
  }
});

// ---------------------------------------------------------------------------
// 4. Print — the regression this file exists for
// ---------------------------------------------------------------------------

test("no disclosure anywhere on this surface falls back to `display:revert`", () => {
  // `revert` rolls a property back to the user-agent origin, which is the
  // origin hiding a shut `details`. As a fallback it resolves to the rule it
  // was meant to beat, so it may not appear at all.
  for (const forbidden of PRINT_SPEC.forbiddenDeclarations) {
    assert.ok(!CLEAN.includes(forbidden),
      `the sheet still ships \`${forbidden}\` as a disclosure fallback`);
  }
  // And the honest version of that attempt is present in its place.
  assert.match(PRINT_RULES, /details:not\(\[open\]\)>\*:not\(summary\) \{ display:block; \}/);
});

test("the printed evidence does not depend on ::details-content", () => {
  // The proof: delete every rule whose selector mentions the pseudo-element,
  // then check the evidence still has a rule that reaches it. This is the exact
  // engine the earlier fix left with a blank page.
  const withoutPseudo = PRINT_RULES
    .split("}")
    .filter((rule) => !rule.includes("::details-content"))
    .join("}");
  assert.ok(!withoutPseudo.includes("::details-content"));
  assert.match(withoutPseudo, /\.first-run-method \{ display:none; \}/);
  assert.match(withoutPseudo, /\.first-run-method-print \{ display:block/);
  assert.equal(PRINT_SPEC.independentOfDetailsContent, true);
  assert.equal(PRINT_SPEC.strategy, "static-print-sibling");
});

test("the print copy is a sibling of the disclosure, so no UA rule can reach it", () => {
  const document = parseHtml(html);
  const print = byId(document, DISCLOSURE_SPEC.printId);
  const details = byId(document, DISCLOSURE_SPEC.id);
  assert.ok(print, "there is no print rendering of the evidence at all");
  // Not inside a `details`, at any depth: that is what makes it unsuppressable.
  for (let node = print.parentNode; node; node = node.parentNode) {
    assert.notEqual(node.tagName?.toLowerCase(), "details",
      "the print evidence is inside a details, so a UA rule can hide it");
  }
  assert.equal(print.parentNode, details.parentNode, "it is the disclosure's sibling");
  // Hidden on screen and revealed in print entirely by author CSS. Depending on
  // the HTML `hidden` rule would put the fallback back in the UA cascade that
  // made the closed-details workaround unreliable in the first place.
  assert.equal(print.hasAttribute("hidden"), false);
  assert.match(CLEAN, /\.first-run-method-print \{ display:none; \}/);
  assert.match(PRINT_RULES, /\.first-run-method-print \{ display:block;/);
  assert.equal(print.getAttribute("aria-hidden"), "true",
    "the disclosure above is the copy the accessibility tree reads");
  assert.equal(print.querySelectorAll("a,button,input,summary,[tabindex]").length, 0,
    "the print copy holds nothing focusable");
  // Authored with content, so it is not blank if this page's script never runs.
  assert.ok(textOf(print).length > 80);
});

test("the printed evidence carries the same entries the disclosure does", async () => {
  const page = await loadPage(PAGE, { modules: false });
  try {
    const { document } = page;
    applyFirstRunResult(document, buildFirstRunResult());
    const terms = (id) => byId(document, id).querySelectorAll("dt").map((node) => textOf(node));
    const shown = terms(FIRST_RUN_IDS.methodList);
    assert.ok(shown.length >= 4, "the disclosure was not painted");
    assert.deepEqual(terms(FIRST_RUN_IDS.methodPrint), shown,
      "paper and screen disagree about what the evidence is");
    assert.match(textOf(byId(document, FIRST_RUN_IDS.methodPrint)), /How this example was calculated/);
  } finally {
    page.restore?.();
  }
});

test("paper keeps the reading order, and drops only the dead controls", () => {
  // The order is the DOM order, so print inherits it — what print must not do
  // is reorder, split the answer from the action, or keep a button nobody can
  // press. Each of those is a rule rather than a hope.
  for (const { selectors, declarations } of FIRST_RUN_RULES) {
    assert.doesNotMatch(declarations, /(?:^|;)\s*order:\s*-?\d/,
      `${selectors} visually reorders the printed decision`);
  }
  assert.match(PRINT_RULES, /\.first-run-answer \{ break-after:avoid; \}/);
  assert.match(PRINT_RULES, /\.first-run-choice button \{ display:none; \}/);
  // The action notes are not controls, and they say what the buttons would have
  // done, so they stay.
  assert.ok(!PRINT_RULES.includes(".first-run-action-note { display:none"));
  assert.deepEqual([...PRINT_SPEC.order], [...DECISION_SPINE]);
});

test("the narrow layout collapses the grids without reordering them", () => {
  const collapse = ".first-run-slots,.first-run-actions,.first-run-support { grid-template-columns:1fr; }";
  const collapseAt = CLEAN.indexOf(collapse);
  const narrowAt = CLEAN.lastIndexOf("@media (max-width:640px)", collapseAt);
  assert.ok(narrowAt >= 0 && narrowAt < collapseAt,
    "the one-column first-run rule is not inside a narrow-media section");
  for (const { selectors, declarations } of FIRST_RUN_RULES) {
    assert.doesNotMatch(declarations, /(?:^|;)\s*order:\s*-?\d|column-reverse/,
      `${selectors} reorders the narrow decision`);
  }
});

// ---------------------------------------------------------------------------
// The composed answer
// ---------------------------------------------------------------------------

test("the answer is one sentence from the canonical record, before any figure", async () => {
  const page = await loadPage(PAGE, { modules: false });
  try {
    const { document } = page;
    const result = buildFirstRunResult();
    // `announce` opted into here because this test asserts on the live region's
    // wording. A repaint announces; the first paint of a page load does not.
    applyFirstRunResult(document, result, { announce: true });
    const decision = loadCanonicalDecision().decision;
    assert.equal(result.answer.available, true);
    assert.equal(result.answer.value, decision.benchmark.headline);
    assert.equal(textOf(byId(document, FIRST_RUN_IDS.answer)), decision.benchmark.headline);
    assert.equal(textOf(byId(document, FIRST_RUN_IDS.answerDetail)), decision.impact.headline);
    // And it is what the live region leads with, so a reader who cannot see the
    // block hears the decision rather than assembling one from three slots.
    assert.match(textOf(byId(document, FIRST_RUN_IDS.live)),
      new RegExp(decision.benchmark.headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    page.restore?.();
  }
});

test("a broken fixture costs the headline sentence, not the answer", () => {
  const analysis = loadExampleDataset();
  const result = composeFirstRunResult({
    analysis, briefing: buildFinopsBriefing(analysis), decision: null,
  });
  // The composed benchmark is an independent input, so the region still says
  // something true rather than falling silent with the fixture.
  assert.equal(result.answer.available, true);
  assert.match(result.answer.value, /% of analyzed AI spend is recoverable/);
});

await waitFor(() => true);
