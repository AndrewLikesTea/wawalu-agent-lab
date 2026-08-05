// Two verdicts, side by side, each saying what it is a verdict ON (#1113).
//
// /evolution.html carries a spend-classification verdict ("Not enough scored to
// stand behind") a few inches above a circulation verdict ("Ready to
// circulate"). Both are true, about different questions, and a reader who met
// them together had nothing on the screen telling them so. One sentence beside
// each now names its own question and points at the other one.
//
// WHAT THIS FILE HOLDS, and why each rule is here rather than assumed:
//
//   * BOTH SENTENCES ARE IN THE SERVED BYTES, once each. Painted scope arrives
//     after the two verdicts a reader is already trying to reconcile.
//   * NEITHER IS INSIDE A DISCLOSURE OR A HIDDEN BLOCK. The text harness in this
//     repo reads straight through a shut details element, so a sentence tucked
//     into one passes a text assertion and is still invisible in a real browser.
//     `closest` is what catches it; grepping the text never would.
//   * NEITHER IS FOCUSABLE. The first screen has no spare tab stop, and a
//     focusable added above the first-run region reds a test in another file.
//   * THE DECISION SUMMARY IS STILL FOUR ELEMENTS. This is the rule the
//     classification sentence had to be placed AROUND: it belongs beside that
//     block, not inside it, and tests/finops-answer-block.test.js fails the
//     moment a fifth child is authored. Asserting it here too keeps the reason
//     next to the sentence whose placement depends on it.
//   * NO FIGURE ENTERED EITHER SENTENCE. This change labels scope; it moves no
//     dollar amount, no percentage, no confidence label and no tier name.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const document = parseHtml(html);

const byId = (id) => document.getElementById(id);

/** The two sentences, by the region whose verdict each one scopes. */
const SCOPE = Object.freeze([
  Object.freeze({
    id: "finops-answer-scope",
    verdict: "the spend classification",
    within: "finops-stand",
    // What it covers, and the other question named in the page's own words.
    covers: /how much of the spend in scope the rubric has scored/,
    names: /separate question from whether this analysis is ready to circulate/,
  }),
  Object.freeze({
    id: "briefing-readiness-scope",
    verdict: "circulation",
    within: "briefing-readiness",
    covers: /the finding, the comparison, and the first action/,
    names: /not a claim about how much of the spend in scope the rubric has scored/,
  }),
]);

test("each verdict ships one sentence naming what it covers, in the served bytes", () => {
  for (const scope of SCOPE) {
    const node = byId(scope.id);
    assert.ok(node, `#${scope.id} scopes ${scope.verdict} verdict and is not in the document`);
    assert.equal(html.split(`id="${scope.id}"`).length - 1, 1,
      `#${scope.id} is authored once; a second copy is a second answer to read`);
    const sentence = textOf(node);
    assert.match(sentence, scope.covers, `#${scope.id} must name what its verdict covers`);
    assert.match(sentence, scope.names,
      `#${scope.id} must name the other question as a separate one`);
  }
});

test("both sentences are on the screen in the default state, not behind a control", () => {
  for (const scope of SCOPE) {
    const node = byId(scope.id);
    // A shut details element is off the screen of a real browser while this
    // repo's text harness still reads through it, so text alone proves nothing.
    assert.equal(node.closest("details"), null,
      `#${scope.id} is inside a disclosure and a reader would never open it`);
    assert.equal(node.closest("[hidden]"), null,
      `#${scope.id} ships hidden, so the two verdicts still meet unreconciled`);
    assert.equal(node.hasAttribute("hidden"), false);
    assert.equal(node.closest(`#${scope.within}`)?.id, scope.within,
      `#${scope.id} must sit in the region whose verdict it scopes`);
  }
});

test("neither sentence costs the first screen a tab stop", () => {
  for (const scope of SCOPE) {
    const node = byId(scope.id);
    assert.equal(node.tagName.toLowerCase(), "p", "a scope note is prose, not a widget");
    assert.equal(node.hasAttribute("tabindex"), false);
    assert.deepEqual([...node.querySelectorAll("a,button,input,select,textarea,[tabindex]")], [],
      `#${scope.id} authors a focusable above the first-run region`);
  }
});

test("the classification sentence sits beside the decision summary, never inside it", () => {
  // The reason this sentence is a sibling: the summary is four elements and
  // nothing else in the shipped document. A fifth child here is a red build.
  const block = byId("finops-answer");
  const children = [...block.children].filter((node) => node.nodeType === 1);
  assert.equal(children.length, 4,
    "the decision summary is four elements; scope belongs beside it, not in it");
  assert.equal(byId("finops-answer-scope").parentNode.id, "finops-stand");

  // And it is met immediately after the block it scopes, ahead of the entry
  // points, so the reader reconciles the two verdicts before choosing a door.
  const order = [...byId("finops-stand").children].map((node) => node.id).filter(Boolean);
  assert.deepEqual(
    order.slice(order.indexOf("finops-answer"), order.indexOf("finops-answer") + 3),
    ["finops-answer", "finops-answer-scope", "finops-answer-doors"]);
});

test("scope labelling introduced no figure and no verdict word of its own", () => {
  for (const scope of SCOPE) {
    const sentence = textOf(byId(scope.id));
    assert.doesNotMatch(sentence, /\d|%|\$/,
      `#${scope.id} states a figure; this change labels scope and moves no number`);
    // Neither sentence may hedge a verdict it only exists to explain.
    assert.doesNotMatch(sentence, /\b(may|might|roughly|approximately|caveat)\b/i,
      `#${scope.id} softens a verdict instead of scoping it`);
  }
});
