// Which supporting panel backs the headline figure — and how a reader is told.
//
// THE DEFECT THIS PINS. The answer screen put three supporting layers under the
// answer block at the same weight, and none of them said which one a reader
// should open to check the figure above. A FinOps lead reading "Spend we can
// stand behind — X% of spend in scope" had to know the page to find the
// evidence for it. Exactly one panel now carries the marking, the figure points
// at that panel's own line with `aria-describedby`, and the promotion is
// composed from scales evolution.css already ships.
//
// WHAT THESE ASSERTIONS ARE FOR.
//
//   * EXACTLY ONE. Two promoted panels is worse than none: it says the page
//     cannot tell either. Asserted in the shipped document AND after a paint,
//     because the marking is authored in markup and re-set by the view.
//   * THE ASSOCIATION RESOLVES. An `aria-describedby` pointing at an id nothing
//     resolves is announced as nothing, so a reader is told the figure has a
//     description they can never reach. The id is checked against the DOM, not
//     against a constant.
//   * EVIDENCE STATE AND EXPANSION STATE ARE SEPARATE. Opening a supporting
//     layer is a reader's business; which panel backs the number is the data's.
//     They live on different attributes and on different elements, and the
//     expansion is driven here through the harness's native `summary` keyboard
//     path so the assertion is about the resulting DOM rather than about a
//     setter having been called.
//   * EVERY STATE IS DRAWN. Loading, a payload naming no panel, a malformed
//     payload, and an implausible one — a 400-character provenance and a wall of
//     supporting panels — all end in a document with a coherent answer block and
//     never in a half-promoted panel or a thrown exception.
//
// No clock, no network, no sleeps.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";
import {
  ANSWER_BLOCK_IDS, ANSWER_EVIDENCE_IDS, applyAnswerBlock, applyAnswerEvidence,
} from "../src/finops-stand-view.js";
import { FINOPS_ANSWER_SUMMARY } from "../src/finops-answer-summary.js";
import { ANSWER_EVIDENCE_PANEL, answerBlock } from "../src/finops-screen-contract.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

const doc = () => parseHtml(html);
const byId = (document, id) => document.getElementById(id);
const marked = (document) => document.querySelectorAll('[data-headline-evidence="true"]');

/** The two supporting layers on the answer screen that are NOT the evidence. */
const OTHER_SUPPORT_PANELS = ["disclosure-next-step", "disclosure-journey"];

// ---------------------------------------------------------------------------
// 1. Exactly one panel is the evidence, in the document and after a paint.
// ---------------------------------------------------------------------------

test("exactly one supporting panel carries the evidence marking, before and after a paint", () => {
  const document = doc();

  const authored = marked(document);
  assert.equal(authored.length, 1,
    `${authored.length} panels claim to back the headline in the shipped document`);
  assert.equal(authored[0].id, ANSWER_EVIDENCE_PANEL.panelId,
    "the authored marking is not on the panel the payload names");

  assert.ok(applyAnswerBlock(document), "the answer block did not paint");

  const painted = marked(document);
  assert.equal(painted.length, 1,
    `${painted.length} panels carry the marking after the paint`);
  assert.equal(painted[0].id, ANSWER_EVIDENCE_PANEL.panelId);
  for (const id of OTHER_SUPPORT_PANELS) {
    assert.equal(byId(document, id).dataset.headlineEvidence, "false",
      `${id} was promoted beside the panel that actually backs the figure`);
  }
});

test("the payload carries the link, so the surface reads it rather than knowing it", () => {
  const evidence = FINOPS_ANSWER_SUMMARY.evidence;
  assert.ok(evidence, "the answer summary publishes no evidence link");
  assert.equal(evidence.panelId, ANSWER_EVIDENCE_PANEL.panelId);
  assert.ok(html.includes(`id="${evidence.panelId}"`),
    "the payload names a panel that is not in the document");
  // Both halves of the line come off the same verdict the figure came from.
  assert.equal(evidence.provenance, FINOPS_ANSWER_SUMMARY.basis.replace(/^as of /, ""),
    "the provenance is not the figure's own as-of basis");
  assert.match(evidence.line, /Source: /);
  assert.ok(Object.isFrozen(evidence));
});

// ---------------------------------------------------------------------------
// 2. The figure is programmatically associated with that panel.
// ---------------------------------------------------------------------------

test("the headline figure points at the evidence panel's own line, and the id resolves", () => {
  const document = doc();
  applyAnswerBlock(document);

  const figure = byId(document, ANSWER_BLOCK_IDS.figure);
  const described = figure.getAttribute("aria-describedby");
  assert.ok(described, "the headline figure describes itself with nothing");

  const target = byId(document, described);
  assert.ok(target, `aria-describedby points at "${described}", which is not in the DOM`);
  assert.equal(target.closest(`#${ANSWER_EVIDENCE_PANEL.panelId}`)?.id,
    ANSWER_EVIDENCE_PANEL.panelId,
    "the figure's description is not inside the panel it is supposed to name");

  // Read aloud on its own it has to say what the relationship IS, then the two
  // things a skeptic wants: how confident, and from what.
  const spoken = textOf(target);
  assert.match(spoken, /^Evidence for the headline figure/,
    `the description does not state its relationship to the figure: "${spoken}"`);
  assert.match(spoken, /Confidence: /);
  assert.match(spoken, /Source: /);
});

test("the label is text a reader can see, not an accessible name only they can hear", () => {
  const document = doc();
  applyAnswerBlock(document);
  const chip = byId(document, ANSWER_EVIDENCE_IDS.chip);
  assert.equal(textOf(chip), ANSWER_EVIDENCE_PANEL.label);
  assert.equal(chip.hidden, false, "the one non-colour carrier of the promotion is hidden");
  assert.equal(chip.getAttribute("aria-label"), null,
    "the chip hides its meaning in an attribute the eye cannot read");
});

// ---------------------------------------------------------------------------
// 3. Expanded by default; the others shut by default.
// ---------------------------------------------------------------------------

test("the evidence panel is open by default and the other supporting layers are not", () => {
  const document = doc();
  const panel = byId(document, ANSWER_EVIDENCE_PANEL.panelId);

  // Open by construction rather than by an `open` attribute: it is a section, so
  // there is nothing to unfold and no press between a reader and the evidence.
  assert.equal(panel.tagName, "SECTION");
  assert.equal(panel.closest("details"), null,
    "the evidence for the headline is folded inside a disclosure");
  assert.equal(panel.hidden, false);

  for (const id of OTHER_SUPPORT_PANELS) {
    const layer = byId(document, id);
    assert.equal(layer.tagName, "DETAILS", `${id} is not a native disclosure`);
    assert.equal(layer.hasAttribute("open"), false, `${id} ships expanded`);
  }
});

// ---------------------------------------------------------------------------
// 4. Expansion state and evidence state are independent.
// ---------------------------------------------------------------------------

test("expanding a non-evidence layer leaves the marking on the same panel", () => {
  const document = doc();
  applyAnswerBlock(document);
  const before = marked(document)[0];

  const layer = byId(document, "disclosure-next-step");
  const summary = layer.querySelector("summary");
  summary.focus();
  pressEnter(document);

  assert.equal(layer.hasAttribute("open"), true, "the layer did not expand");
  assert.equal(layer.dataset.headlineEvidence, "false",
    "opening a supporting layer moved the evidence marking onto it");

  const after = marked(document);
  assert.equal(after.length, 1, `${after.length} panels carry the marking after an expansion`);
  assert.equal(after[0], before, "the evidence marking moved to a different panel");

  // And it survives the next paint, which is when a shared "active panel"
  // variable would quietly hand the marking to whatever was opened last.
  applyAnswerBlock(document);
  assert.equal(layer.hasAttribute("open"), true,
    "a repaint shut a disclosure the reader had opened");
  assert.equal(marked(document)[0], before);
});

// ---------------------------------------------------------------------------
// 5. Loading, empty, error.
// ---------------------------------------------------------------------------

test("the loading state draws the line rather than reserving a blank row", () => {
  const document = doc();
  const line = byId(document, ANSWER_EVIDENCE_IDS.line);

  assert.ok(line, "the evidence line is not in the document before data arrives");
  assert.equal(line.hidden, false, "the line is hidden until data lands, so the panel jumps");
  assert.match(textOf(line), /^Evidence for the headline figure/);
  assert.match(textOf(byId(document, ANSWER_EVIDENCE_IDS.text)), /not available until .* is prepared/,
    "the pending line says nothing about why it has no figures yet");
});

test("a payload that identifies no evidence panel promotes nothing and dangles nothing", () => {
  for (const evidence of [null, undefined, { panelId: "", label: "x", line: "y" },
    { panelId: "a-panel-this-page-does-not-have", label: "x", line: "y" }]) {
    const document = doc();
    const summary = { ...FINOPS_ANSWER_SUMMARY, evidence };
    assert.ok(applyAnswerBlock(document, summary), "the answer block did not paint");

    assert.equal(marked(document).length, 0,
      `a payload with evidence ${JSON.stringify(evidence)} left a panel promoted`);
    assert.equal(byId(document, ANSWER_BLOCK_IDS.figure).getAttribute("aria-describedby"), null,
      "the figure still points at a description the payload could not supply");
    assert.equal(byId(document, ANSWER_EVIDENCE_IDS.line).hidden, true,
      "an unbacked line is still on screen under the panel heading");
    // The headline itself still renders: the evidence link is not a gate on it.
    assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.value)), FINOPS_ANSWER_SUMMARY.figure);
  }
});

test("a superseded evidence panel takes the promotion and the association with it", () => {
  const document = doc();
  applyAnswerBlock(document);
  const panel = byId(document, ANSWER_EVIDENCE_PANEL.panelId);
  assert.equal(marked(document).length, 1, "the fixture did not start from a promoted panel");

  // Exactly what supersedeWorkspaceDestinations does when a reader's own export
  // retires the ranking: `hidden` takes the panel out of the accessibility tree.
  panel.hidden = true;
  applyAnswerBlock(document);

  assert.equal(marked(document).length, 0,
    "a hidden panel is still promoted, so the screen promotes something nobody can read");
  assert.equal(byId(document, ANSWER_BLOCK_IDS.figure).getAttribute("aria-describedby"), null,
    "the figure still describes itself with a line inside a hidden subtree");
});

test("a summary that failed to load, or arrived malformed, throws nothing and promotes nothing", () => {
  // `undefined` is deliberately absent: omitting the argument means "paint the
  // bundled summary", which is the loading path above, not a failure.
  for (const summary of [null, {}, { evidence: "not an object" }]) {
    const document = doc();
    assert.doesNotThrow(() => applyAnswerBlock(document, summary),
      `a ${JSON.stringify(summary) ?? "missing"} payload took the answer block down`);
    assert.equal(marked(document).length, 0, "a malformed payload left a half-promoted panel");
    assert.equal(byId(document, ANSWER_BLOCK_IDS.figure).getAttribute("aria-describedby"), null);
    // The authored pending action is still operable, so the screen is never dead.
    assert.equal(byId(document, ANSWER_BLOCK_IDS.action).getAttribute("href"), "#local-import");
  }
});

test("a repaint that states no direction clears the last one rather than keep it", () => {
  // The reading a stale direction produces is the dangerous one: this paint's
  // number under the previous paint's "a higher share is better". Every slot
  // that qualifies the number is checked the same way, because a label or an
  // as-of phrase left over from a different export misreads just as badly.
  const document = doc();
  applyAnswerBlock(document);
  for (const key of ["label", "value", "direction", "basis"]) {
    assert.ok(textOf(byId(document, ANSWER_BLOCK_IDS[key])).length > 0,
      `#${ANSWER_BLOCK_IDS[key]} did not paint, so this test would pass vacuously`);
  }

  for (const missing of [undefined, null, 0, {}, ["a higher share is better"]]) {
    const document = doc();
    applyAnswerBlock(document);
    const painted = textOf(byId(document, ANSWER_BLOCK_IDS.direction));
    applyAnswerBlock(document, { ...FINOPS_ANSWER_SUMMARY, direction: missing });

    const now = textOf(byId(document, ANSWER_BLOCK_IDS.direction));
    assert.notEqual(now, painted,
      `direction ${JSON.stringify(missing) ?? "undefined"} left the last paint's direction standing`);
    assert.match(now, /Results will appear when preparation is complete/i,
      "the slot says something other than the authored pending wording");
    assert.equal(now.includes("[object Object]"), false, "a non-string was stringified onto the page");
  }
});

test("a verdict with no coverage tier gets the provenance alone, never an invented confidence", () => {
  const withheld = answerBlock({ label: "Your own export · analyzed in this browser",
    period: null, gradability: { state: "no_baseline", tier: "no_baseline", coverage: null } });

  assert.equal(withheld.evidence.confidence, null,
    "a verdict in no published tier was given a confidence level anyway");
  assert.match(withheld.evidence.line, /^Source: /);
  assert.doesNotMatch(withheld.evidence.line, /Confidence:/);
  assert.equal(withheld.evidence.panelId, ANSWER_EVIDENCE_PANEL.panelId,
    "the withheld state also drops the evidence link, so the reader loses the source too");
});

// ---------------------------------------------------------------------------
// 6. Implausible extremes.
// ---------------------------------------------------------------------------

test("an implausible provenance, figure, and panel count leave exactly one promoted panel", () => {
  const document = doc();
  const main = byId(document, "main-content");

  // A wall of supporting layers, generated here rather than committed.
  for (let index = 0; index < 60; index += 1) {
    const extra = document.createElement("details");
    extra.className = "support-disclosure";
    extra.id = `generated-support-${index}`;
    extra.dataset.headlineEvidence = "true";
    extra.dataset.workspaceRegion = "answer";
    main.append(extra);
  }
  assert.equal(marked(document).length, 61, "the fixture did not set up the contested state");

  const provenance = `${"Bundled synthetic example ".repeat(16)}· June 2026`;
  const summary = {
    ...FINOPS_ANSWER_SUMMARY,
    figure: `${"9".repeat(40)}.0% of spend in scope`,
    evidence: { ...FINOPS_ANSWER_SUMMARY.evidence, provenance,
      line: `Confidence: Available · high confidence. Source: ${provenance}.` },
  };
  applyAnswerBlock(document, summary);

  const painted = marked(document);
  assert.equal(painted.length, 1,
    `${painted.length} panels survived a paint that may promote only one`);
  assert.equal(painted[0].id, ANSWER_EVIDENCE_PANEL.panelId);
  // The long strings land in the slots that are allowed to wrap, and nowhere
  // else: the chip keeps its own short label whatever the provenance does.
  assert.ok(textOf(byId(document, ANSWER_EVIDENCE_IDS.text)).includes(provenance.trim()));
  assert.equal(textOf(byId(document, ANSWER_EVIDENCE_IDS.chip)), ANSWER_EVIDENCE_PANEL.label);
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.value)), summary.figure);
});

// ---------------------------------------------------------------------------
// 7. Keyboard order is DOM order, and the promotion adds no tab stop.
// ---------------------------------------------------------------------------

test("the promotion adds no tab stop and no positive tabindex anywhere on the screen", () => {
  const document = doc();
  const before = tabSequence(document).length;
  applyAnswerEvidence(document);

  assert.equal(tabSequence(document).length, before,
    "promoting a panel changed how many controls a reader has to Tab through");
  for (const node of tabSequence(document)) {
    const index = Number(node.getAttribute("tabindex") ?? 0);
    assert.ok(!(index > 0), `${node.id || node.tagName} uses a positive tabindex`);
  }
  // The line and its chip are text, not controls: nothing new to Tab past on the
  // way from the headline to the panel's own doors.
  for (const id of [ANSWER_EVIDENCE_IDS.line, ANSWER_EVIDENCE_IDS.chip, ANSWER_EVIDENCE_IDS.text]) {
    assert.equal(byId(document, id).getAttribute("tabindex"), null);
  }
});
