// One finding, and everything else visibly under it (#1678).
//
// WHAT THIS FILE PINS, and why each assertion is written the way it is.
//
//   * ONE FINDING. #finops-recoverable-answer is the canonical answer: its
//     question is the label, the money is the largest type role in the block,
//     confidence and provenance are the smallest, and the next action is the one
//     filled control. The five elements are asserted as an ORDER, because on
//     this page source order is reading order, focus order and print order.
//   * EVERY SURVIVING RIVAL IS SUBORDINATE. #1676 named three regions that had
//     each grown an answer of their own. A rival is demoted here by heading rank
//     and by the page's own `data-subordinate` rung — not by colour, and not by
//     deletion.
//   * THE EVIDENCE IS ONE PRESS AWAY. The answer's own "How we know this" is a
//     native details element, so Enter and Space are the browser's and the state
//     a screen reader announces is `open`. It ships shut, and it is the tab stop
//     directly after the action.
//   * THE ORDER IS READ OFF THE PAGE A VISITOR GETS. `leadWithWorkedDecision`
//     moves two blocks on load, so an authored-order assertion describes a page
//     no cold visitor sees. Every ordering assertion below runs against the
//     post-load DOM.
//
// Harness notes, because two of these would pass for the wrong reason: a closed
// details element has `open === undefined` rather than `false`, so the assertion
// is `!node.open`; and the harness reads text straight through a shut disclosure,
// so "the announcement is outside the control" is asserted as CONTAINMENT rather
// than as the presence of text.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { LOAD_STATUS_IDS } from "../src/finops-load-status.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const SERVED = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

const ANSWER = "finops-recoverable-answer";
const QUESTION = "finops-recoverable-question";
const FIGURE = "finops-recoverable-figure";
const VALUE = "finops-recoverable-value";
const TRUST = "finops-recoverable-trust";
const ACTION = "finops-recoverable-action";
const EVIDENCE = "finops-recoverable-how-we-know";

/** The three regions #1676 named, minus the one the answer spine owns. */
const DEMOTED = ["finops-first-run", "finops-readiness-loop"];

const byId = (document, id) => document.getElementById(id);
const at = (id) => html.indexOf(`id="${id}"`);

/** All three settle waits: `ready` alone leaves a paint in flight. */
async function coldOpen() {
  const page = await loadPage(PAGE, { routes: SERVED, storage: {} });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready"
    || byId(document, LOAD_STATUS_IDS.region)?.dataset.state === "error",
  "the page never settled into a resolved load state");
  await waitFor(() => textOf(byId(document, "integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result")
    ?.getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

/** True when `node` sits inside `ancestor`. The harness has no `.contains`. */
function inside(node, ancestor) {
  for (let walk = node; walk; walk = walk.parentNode) if (walk === ancestor) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 1. Five elements, one block, one hierarchy.
// ---------------------------------------------------------------------------

test("the answer's five elements are one block, in the order a reader needs them", () => {
  const document = parseHtml(html);
  const region = byId(document, ANSWER);

  // Question, money, confidence-and-provenance, next action. Source position
  // rather than child index, because the supporting-detail group #1498 folded
  // under the action is a sibling of none of them.
  const order = [QUESTION, FIGURE, VALUE, TRUST, ACTION].map(at);
  for (const position of order) assert.ok(position > 0, "an element of the answer is not authored");
  assert.deepEqual([...order].sort((a, b) => a - b), order,
    "the answer no longer reads question, money, confidence, action");

  // Every one of them is in the ONE block, not scattered across the region.
  for (const id of [QUESTION, VALUE, TRUST, ACTION]) {
    assert.ok(inside(byId(document, id), region), `#${id} left the answer block`);
  }
  // The question is the label above the money: they are one paragraph apart, and
  // the money and its label are the same paragraph, so a screen reader speaks
  // the number with what it means.
  assert.equal(byId(document, VALUE).parentNode.id, FIGURE);
  assert.equal(byId(document, TRUST).parentNode.id, FIGURE);
});

test("the money carries the largest type role and the metadata the smallest", () => {
  const document = parseHtml(html);
  // Composed from the roles the page already ships. `.stand-figure-value` is
  // this page's one largest-number role; `.stand-figure-basis` is its smallest
  // readable role, and confidence and provenance both wear it.
  assert.equal(byId(document, VALUE).className, "stand-figure-value");
  assert.equal(byId(document, TRUST).className, "stand-figure-basis");
  assert.match(byId(document, QUESTION).tagName, /^H2$/);

  // One largest-role figure in the answer's own block: a second is a second
  // answer. The supporting-detail group is excluded, since #1498 put a narrower
  // figure in it deliberately, in the supporting role.
  const support = byId(document, "finops-answer-support");
  const figures = byId(document, ANSWER).querySelectorAll(".stand-figure-value")
    .filter((node) => !inside(node, support));
  assert.deepEqual(figures.map((node) => node.id), [VALUE]);
});

test("confidence is never carried by colour alone", () => {
  const document = parseHtml(html);
  // Each graded signal names what it grades, in words a monochrome print and a
  // screen reader both carry. design-system/claude-design/review-08-foundations.html
  // gives the chip silhouette one job — filled wash for a dynamic signal, outline
  // for a static classification — so the silhouette cannot also carry the grade,
  // and the grade has to be a value on the chip.
  const trust = textOf(byId(document, TRUST));
  for (const named of ["Confidence:", "Pricing provenance:", "Illustrative"]) {
    assert.ok(trust.includes(named), `the trust line never says ${named}: ${trust}`);
  }
  for (const id of ["finops-recoverable-grade", "finops-recoverable-provenance"]) {
    const chip = byId(document, id);
    assert.ok(textOf(chip).trim().length > 0, `#${id} states its grade as a value`);
    assert.ok(chip.getAttribute("data-grade") || chip.getAttribute("data-band"),
      `#${id} carries no machine-readable band beside its word`);
  }
});

// ---------------------------------------------------------------------------
// 2. Nothing else on the page reads as a second answer.
// ---------------------------------------------------------------------------

test("every surviving rival is demoted by rank and by the page's own rung", () => {
  const document = parseHtml(html);
  for (const id of DEMOTED) {
    assert.equal(byId(document, id).dataset.subordinate, "true",
      `#${id} still draws at the answer's weight`);
  }
  // The readiness loop asked its own question at the answer's rank. It is one
  // level under the answer now, which is a claim about the outline rather than
  // about a font size.
  assert.equal(byId(document, "readiness-loop-question").tagName, "H3");
  assert.equal(byId(document, QUESTION).tagName, "H2",
    "the answer's own question left the top rung");
});

test("the demotion changed no words, no control and no destination", () => {
  const document = parseHtml(html);
  const region = byId(document, "finops-readiness-loop");
  assert.match(textOf(byId(document, "readiness-loop-question")), /\?$/);
  // Demoted is not deleted: the region keeps its metric, its recheck control and
  // its own disclosure, and its announcement stays outside that disclosure.
  for (const id of ["readiness-loop-metric", "readiness-loop-recheck",
    "readiness-loop-detail", "readiness-loop-live"]) {
    assert.ok(inside(byId(document, id), region), `#${id} left the demoted region`);
  }
  assert.equal(byId(document, "readiness-loop-live").closest("details"), null,
    "the region's announcement was folded into a control, where a browser is silent");
  assert.ok(!byId(document, "readiness-loop-detail").open, "the demoted detail ships open");
});

// ---------------------------------------------------------------------------
// 3. The evidence, one keyboard press from the answer.
// ---------------------------------------------------------------------------

test("the answer's evidence is a native disclosure that ships shut", () => {
  const document = parseHtml(html);
  const evidence = byId(document, EVIDENCE);
  assert.equal(evidence.tagName, "DETAILS");
  assert.ok(!evidence.open, "the evidence ships open, so the answer is not the only finding");
  const summary = evidence.querySelector("summary");
  assert.equal(summary.tagName, "SUMMARY");
  assert.equal(summary.querySelector("button"), null,
    "a button inside the summary takes Enter and Space away from the browser");
  assert.equal(summary.getAttribute("tabindex"), null,
    "the control was taken out of the natural tab order");
});

test("on the page a cold visitor gets, tab runs answer, next action, evidence", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    // The post-load DOM, not the authored one: `leadWithWorkedDecision` moves
    // two blocks while this browser keeps no period.
    const order = tabSequence(document);
    const positionOf = (id) => order.findIndex((node) => node.id === id);
    const action = positionOf(ACTION);
    const evidence = positionOf(`${EVIDENCE}-summary`);
    assert.ok(action >= 0, "the next action is not reachable by keyboard");
    assert.ok(evidence > action,
      "the evidence is reached before the action it qualifies");

    // ONE PRESS: no control of the answer's own stands between them.
    const between = order.slice(action + 1, evidence)
      .filter((node) => inside(node, byId(document, ANSWER)));
    assert.deepEqual(between.map((node) => node.id), [],
      "a control of the answer's own sits between the action and its evidence");

    // NOTHING NEW ABOVE THE ANSWER. This screen has no spare tab stop, so the
    // claim is not "no controls above it" — `leadWithWorkedDecision` moves the
    // demoted worked example there on a cold open, and it brings its own. The
    // claim is that every one of them belongs to that one demoted region, so
    // this change put no control of its own above the finding.
    const answerAt = order.findIndex((node) => inside(node, byId(document, ANSWER)));
    assert.ok(answerAt > 0, "the answer carries no control at all");
    const worked = byId(document, "finops-first-run");
    const strays = order.slice(0, answerAt)
      .filter((node) => inside(node, byId(document, "main-content")))
      .filter((node) => !inside(node, worked));
    assert.deepEqual(strays.map((node) => node.id), [],
      "a control that is neither the answer's nor the demoted example's sits above the finding");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. The implausible extremes, which are where a one-block hierarchy breaks.
// ---------------------------------------------------------------------------

test("a far longer figure, question and missing provenance still wrap rather than overflow", async () => {
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  // A ten-digit money string and a question twice its authored length are both
  // longer than any column this page lays out. Every role that can carry one is
  // allowed to break inside a word, which is what keeps a narrow viewport from
  // scrolling sideways instead of wrapping.
  for (const role of ["\\.stand-figure-value", "\\.stand-figure-basis", "\\.stand-answer"]) {
    const rule = new RegExp(`${role} \\{[^}]*overflow-wrap:anywhere`);
    assert.match(css, rule, `${role} cannot break a string longer than its column`);
  }
  // …and the block is a single column at every width, so the evidence stacks
  // beneath the answer rather than beside it.
  assert.match(css, /\.stand-figure \{[^}]*display:grid/);
  assert.doesNotMatch(css, /\.stand-figure \{[^}]*grid-template-columns/);

  // A missing provenance string is a state, not a blank: the slot is authored
  // with the sentence it shows when nothing has been scored.
  const document = parseHtml(html);
  assert.match(textOf(byId(document, "finops-recoverable-provenance")), /not scored/);
  assert.match(textOf(byId(document, "finops-recoverable-grade")), /not graded/);
  assert.ok(textOf(byId(document, "finops-recoverable-provenance-reason")).trim().length > 0,
    "the reason slot ships empty, so an unscored figure states no reason at all");
});

// ---------------------------------------------------------------------------
// 5. The first screen a cold visitor is actually given (#1687).
//
// #1685 made the answer read as one finding. It did not decide what a reader
// meets BEFORE it, and the answer to that was: two other findings. On a cold
// open `leadWithWorkedDecision` hoisted the worked example and the empty track
// record to just under the page name, so the reading order ran hero, worked
// example, empty record, answer — three questions at heading rank, two figures
// and two actions ahead of the one the page is for.
//
// Nothing here can assert "fits in one screen": the harness models no layout.
// What it can hold is everything the screen claim rests on — which block is
// first, which type role each question and figure is drawn at, and the order the
// tab key visits them in.
// ---------------------------------------------------------------------------

/**
 * The element children of a node, in order, as ids.
 *
 * `children` in this harness carries text nodes too, and their `tagName` is the
 * truthy string "#text" — so the filter is on `nodeType`, not on having a tag.
 */
const childIds = (node) => [...(node?.children ?? [])]
  .filter((child) => child?.nodeType === 1).map((child) => child.id);

/** True when `node` sits inside a region the page has declared subordinate. */
function underSubordinate(node) {
  for (let walk = node; walk; walk = walk.parentNode) {
    if (walk.dataset?.subordinate === "true") return true;
  }
  return false;
}

test("a cold visitor meets the answer under the page name, before any illustration", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const blocks = childIds(byId(document, "main-content"));
    assert.equal(blocks[0], "finops-hero", "the page's own name no longer opens the page");
    assert.equal(blocks[1], ANSWER,
      `a block a reader did not come for leads the page: ${blocks.slice(0, 3).join(", ")}`);

    // The two blocks that move are the worked example and the empty record, and
    // they land in that order directly under the answer. Asserted as adjacency
    // rather than as "somewhere below", because the defect this replaces was a
    // block sliding into a gap nobody had claimed.
    assert.equal(blocks[2], "finops-first-run");
    assert.equal(blocks[3], "finops-track-record");

    // And every other region that asks a question of its own is below all four.
    for (const id of ["finops-stand", "finops-readiness-loop", "finops-destinations"]) {
      assert.ok(blocks.indexOf(id) > blocks.indexOf(ANSWER),
        `#${id} still reads above the answer it supports`);
    }
  } finally {
    page.restore();
  }
});

test("the answer's question owns the headline rung and every rival is stepped off it", async () => {
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  const document = parseHtml(html);

  // COMPOSED, NOT INVENTED. `.answer-question` is the rung this page already
  // ships for a region's own question; the canonical question wore no class at
  // all and fell to the browser default, which is a fixed 24px — smaller at a
  // laptop width than three rival questions below it.
  assert.equal(byId(document, QUESTION).className, "answer-question");
  assert.match(css, /\.answer-question \{[^}]*font-size:clamp\(24px,3\.6vw,34px\)/,
    "the headline rung moved, so the answer is no longer drawn at the page's largest question size");

  // …and a demoted region cannot keep drawing at it. The rung a subordinate
  // region gets is the one every other subordinate heading already uses, so no
  // size is introduced here either.
  assert.match(css, /\[data-subordinate="true"\] \.answer-question \{[^}]*font-size:clamp\(18px,2\.2vw,22px\)/,
    "a region demoted by rank can still out-draw the answer by size");

  // The regions #1676 demoted are on that rung by rank AND by size now, because
  // either on its own is a half-demotion. `finops-stand` is deliberately absent:
  // src/finops/answer-spine-view.js still declares it the spine's `headline`, and
  // its `.stand-head h2` rung of clamp(26px,4vw,38px) is still the largest
  // question on this page. That is a product contradiction between the spine and
  // #1676, not a CSS defect, and it is left standing rather than settled here.
  for (const id of ["finops-first-run", "finops-readiness-loop"]) {
    assert.equal(byId(document, id).dataset.subordinate, "true",
      `#${id} still draws at the answer's weight`);
  }
  assert.equal(byId(document, ANSWER).dataset.subordinate, undefined,
    "the answer demoted itself along with its evidence");
});

test("no region below the answer states a figure at the answer's largest-number role", () => {
  const document = parseHtml(html);
  const answer = byId(document, ANSWER);
  // `.stand-figure-value` is this page's one largest-number role. Outside the
  // answer it may still be USED — the same role in a subordinate region is how a
  // supporting figure stays legible — but it may not be drawn at full size, and
  // the rule that steps it down keys off the region rather than off each id.
  //
  // The exception is named rather than filtered out: `finops-stand` is still the
  // answer spine's declared `headline`, so its figures still draw at the full
  // role. Listing them by id is what makes a FOURTH region growing a headline
  // figure fail here instead of joining a silent allowance.
  const strays = document.querySelectorAll(".stand-figure-value")
    .filter((node) => !inside(node, answer))
    .filter((node) => !underSubordinate(node));
  assert.deepEqual(strays.map((node) => node.id),
    ["finops-stand-recoverable-value", "finops-stand-floor-value", "finops-peer-answer",
      "finops-glance-lead"],
    "a figure below the answer is drawn at the answer's own emphasis");
  for (const node of strays) {
    assert.ok(node.closest("#finops-stand"),
      `${node.id} states a headline figure outside both the answer and the declared headline`);
  }
});

test("the focus order runs answer, action, evidence before the illustration's controls", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const order = tabSequence(document);
    const positionOf = (id) => order.findIndex((node) => node.id === id);

    // Question and figure carry no control — they are read, not tabbed to — so
    // the keyboard claim is about what comes after them: the answer's own move,
    // then its evidence, then anything belonging to the worked example.
    const action = positionOf(ACTION);
    const evidence = positionOf(`${EVIDENCE}-summary`);
    assert.ok(action >= 0 && evidence > action, "the answer's evidence no longer follows its action");

    const worked = byId(document, "finops-first-run");
    const firstIllustrationStop = order.findIndex((node) => inside(node, worked));
    assert.ok(firstIllustrationStop > evidence,
      "a control of the worked example is reached before the answer's own action and evidence");

    // NO NEW TAB STOP. The first screen's budget is full, so this change adds no
    // focusable of its own: everything a keyboard reader reaches inside <main>
    // before the illustration belongs to the answer.
    const main = byId(document, "main-content");
    const leading = order.slice(0, firstIllustrationStop).filter((node) => inside(node, main));
    for (const node of leading) {
      assert.ok(inside(node, byId(document, ANSWER)),
        `${node.id || node.tagName} is neither the answer's nor the illustration's, and it leads the page`);
    }
  } finally {
    page.restore();
  }
});
