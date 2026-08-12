// The trimmed Evolution first screen, from a cold open to the next action (#1670).
//
// What only this file catches: every existing assertion about the trimmed first
// screen is made on the AUTHORED document — `parseHtml(await read(...))` — or on
// a view function called by hand. A cold visitor never meets that document.
// `/evolution-page.js` paints the figure, the basis, the trust line and the
// readiness detail at mount, and `finops-track-record.js` MOVES two blocks under
// `<main>` while this browser keeps no period. So a second figure, a second
// action, an opened disclosure or a lost region introduced by any of those
// modules is invisible to every test that reads the file off disk.
//
// Everything here therefore boots the real entry point and asserts on the page
// AFTER it has run: post-move order, counts inside the answer a reader lands on,
// the tab path from the lead finding to the recommended move, and the three
// resolved states of the load — empty browser, loading, failed fixture — in the
// wording the source constants actually ship.
//
// The harness models no layout, so "what a narrow viewport demotes" is asserted
// as the structure that produces it: the demoted line lives inside a `<details>`
// that is shut after the page has run. `textOf` reads straight through a closed
// disclosure, so the parentNode walk is the assertion, never the text. Nothing
// here compares against an element (`assert.equal(node, null)` walks the whole
// parsed page), and no selector uses `*` or a descendant combinator.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { BUNDLED_LOAD_STATE } from "../src/briefing-strings.js";
import {
  LOAD_NARRATION, LOAD_PRESENTATION, LOAD_STATUS_IDS, SECONDARY_PLACEHOLDER,
} from "../src/finops-load-status.js";
import {
  TRACK_RECORD_IDS, TRACK_RECORD_QUESTION, TRACK_RECORD_STATE,
} from "../src/finops-track-record.js";
import { FIRST_RUN_IDS } from "../src/finops-first-run.js";
import { getRecoverableSpend } from "../src/finops-answer-contract.js";
import { loadExampleDataset } from "../src/example-dataset.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const STYLES = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

// The bundled analysis, and the scored-fixture panel that is not part of it.
const SERVED = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};
// The failure under test is the bundled analysis alone: everything else the page
// asks for is still served, so a red here is the analysis and not the network.
const BUNDLE_MISSING = { "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES };

const ANSWER_REGION_ID = "finops-recoverable-answer";
const ACTION_ID = "finops-recoverable-action";
const SUPPORT_ID = "finops-answer-support";

const byId = (document, id) => document.getElementById(id);

/**
 * Open the shipped page the way a visitor does, and wait out all three jobs it
 * starts on its own. Waiting only on `shiplogEvolution === "ready"` leaves a
 * paint in flight that `restore()` then pulls the globals out from under, which
 * surfaces as an unhandled rejection in whichever test runs next.
 */
async function coldOpen({ routes = SERVED, storage = {} } = {}) {
  const page = await loadPage(PAGE, { routes, storage });
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

/** The element children of a node, as ids. Text nodes live in `children` too. */
const childIds = (node) => (node?.children ?? [])
  .filter((child) => child?.nodeType === 1).map((child) => child.id);

/** True when `node` sits inside `ancestor`. The harness has no `.contains`. */
function inside(node, ancestor) {
  for (let walk = node; walk; walk = walk.parentNode) if (walk === ancestor) return true;
  return false;
}

/**
 * True when a node is the answer's OWN content rather than the supporting-detail
 * layer #1498 folded underneath it. The layer is subordinate by construction —
 * an h3 under the h2, its figure in the supporting type role — so the "one
 * question, one figure, one move" rules are about what surrounds it.
 */
const answersOwn = (node) => {
  for (let walk = node; walk; walk = walk.parentNode) if (walk.id === SUPPORT_ID) return false;
  return true;
};

/** Every heading inside a region, without a descendant selector. */
const headingsWithin = (document, region) => document
  .querySelectorAll("h1,h2,h3,h4,h5,h6").filter((heading) => inside(heading, region));

/** Every id under a node, in reading order, for a containment assertion. */
function readingOrder(root) {
  const out = [];
  const visit = (node) => {
    for (const child of node?.children ?? []) {
      if (child?.nodeType !== 1) continue;
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

/* --------------------- 1. what a cold open actually states ------------------ */

test("a cold open states one question, one headline metric, and one next action", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;

    // THE PAGE AS IT STANDS AFTER LOADING, not as it is authored. While this
    // browser keeps no period, `leadWithWorkedDecision` moves the worked example
    // and the track-record header under the hero, so an authored-order assertion
    // describes a page no cold visitor sees.
    const blocks = childIds(byId(document, "main-content"));
    assert.equal(blocks[0], "finops-hero", "the page's own name no longer comes first");
    assert.equal(blocks[1], FIRST_RUN_IDS.region,
      "the worked example no longer leads a browser that is keeping nothing");
    assert.ok(blocks.indexOf(ANSWER_REGION_ID) < blocks.indexOf("finops-stand"),
      "the answer moved below a section that supports it");
    const region = byId(document, ANSWER_REGION_ID);
    assert.equal(region.hidden, false, "the answer a reader came for was withdrawn on load");

    // ONE LEAD QUESTION, in the part of the region a reader meets without
    // pressing anything. The count is exact, so a reintroduced summary heading
    // fails here — and it is taken AFTER the page has run, because
    // `renderRecoverableSpendCoverage` paints a headed list into the Limits part
    // of the shut disclosure at boot. Those headings are behind a control and
    // are asserted as such below rather than being silently filtered out.
    const own = headingsWithin(document, region).filter(answersOwn);
    const openToTheReader = own.filter((heading) => !heading.closest("details"));
    assert.deepEqual(openToTheReader.map((heading) => heading.id), ["finops-recoverable-question"]);
    assert.equal(openToTheReader[0].tagName, "H2");
    assert.ok(textOf(openToTheReader[0]).endsWith("?"));
    for (const heading of own) {
      assert.ok(heading === openToTheReader[0] || heading.closest("details"),
        `a heading painted into the answer region sits outside every disclosure: ${textOf(heading)}`);
    }

    // ONE HEADLINE METRIC, and it is the figure the one accessor computes rather
    // than whatever the document happened to ship with.
    const figures = region.querySelectorAll(".stand-figure-value").filter(answersOwn);
    assert.deepEqual(figures.map((figure) => figure.id), ["finops-recoverable-value"],
      "a second headline figure competes with the answer");
    const recoverable = getRecoverableSpend(loadExampleDataset());
    assert.equal(textOf(figures[0]), recoverable.monthlyDisplay);
    assert.match(textOf(byId(document, "finops-recoverable-label")), /per month/);

    // ONE PRIORITIZED NEXT ACTION, and one link of any kind: a second hands the
    // ranking decision back to the reader.
    const actions = region.querySelectorAll(".stand-action").filter(answersOwn);
    assert.deepEqual(actions.map((action) => action.id), [ACTION_ID]);
    const links = region.querySelectorAll("a").filter(answersOwn);
    assert.deepEqual(links.map((link) => link.id), [ACTION_ID]);
    assert.equal(actions[0].getAttribute("href"), "/savings-action-center.html");
    assert.match(textOf(actions[0]), /^Move /,
      "the action names the move to make, not the page it lands on");
  } finally {
    page.restore();
  }
});

/* ------------------- 2. the keyboard path to that next action --------------- */

test("the next action is reached by tab from the lead finding and carries the reader to the move", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const order = tabSequence(document).map((node) => node.id);

    // The lead finding a cold visitor meets is the worked example; the answer's
    // action is downstream of it in the one tab sequence, so a reader who tabs
    // out of the finding arrives at the move rather than at a supporting panel.
    const finding = order.indexOf(FIRST_RUN_IDS.import);
    const target = order.indexOf(ACTION_ID);
    assert.ok(finding >= 0, "the lead finding's own next step is not keyboard reachable");
    assert.ok(target > finding,
      `the recommended action is reached before the finding it follows: ${order.slice(0, 6).join(", ")}`);

    // Every stop between the two is inside the content region: nothing sends a
    // keyboard reader out through the header or the footer to reach the move.
    const main = byId(document, "main-content");
    const between = tabSequence(document).slice(finding, target + 1);
    for (const stop of between) {
      assert.ok(inside(stop, main),
        `${stop.id || stop.tagName} sits outside <main> on the path to the action`);
    }

    // A REAL FOCUSABLE CONTROL WITH AN ACCESSIBLE NAME. The name is the link's
    // own text — there is no aria-label to drift from it — and the harness
    // reflects no properties to attributes, so the tagName and the href property
    // are what is asserted.
    const action = byId(document, ACTION_ID);
    assert.equal(action.tagName, "A");
    assert.ok(action.href, "a link with no href is not a tab stop at all");
    assert.ok(textOf(action).length > 10, "the action has no accessible name to announce");
    assert.equal(action.getAttribute("aria-hidden"), null);

    // A VISIBLE FOCUS AFFORDANCE. The harness computes no styles, so this is
    // asserted through the one channel it can see — the class the control
    // actually carries — joined to the rule the stylesheet ships for it.
    assert.ok(action.className.split(/\s+/).includes("stand-action"),
      "the action lost the class its focus ring is written against");
    assert.match(STYLES,
      /\.stand-action:focus-visible\s*\{[^}]*outline:3px solid var\(--focus-ring\)/);

    // AND THE PATH COMPLETES. Focus it, press Enter, and the page goes where the
    // sentence said it would rather than doing nothing.
    action.focus();
    assert.equal(document.activeElement.id, ACTION_ID);
    pressEnter(document);
    assert.equal(page.navigations.length, 1);
    assert.match(page.navigations[0], /\/savings-action-center\.html$/);
  } finally {
    page.restore();
  }
});

/* ---------------------- 3. empty, loading, and failed ----------------------- */

test("an empty browser meets no waiting language and no unmeasured slot above the answer", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;

    // Nothing kept: the header says so in its own shipped sentence rather than
    // reporting a zero, and it states no figure it has not measured.
    assert.equal(byId(document, TRACK_RECORD_IDS.region).dataset.state, TRACK_RECORD_STATE.none);
    assert.equal(textOf(byId(document, TRACK_RECORD_IDS.question)), TRACK_RECORD_QUESTION);
    assert.equal(document.querySelectorAll("[data-track-record-action]").length, 0);

    // And nothing a cold visitor reads before the answer narrates a load or sits
    // on an unavailable placeholder. Read off the page as it stands after the
    // move, so it covers the blocks that were relocated into this run of text —
    // `LOAD_NARRATION` and the placeholder wordings are the shipped constants.
    const main = byId(document, "main-content");
    const answer = byId(document, ANSWER_REGION_ID);
    const above = readingOrder(main).filter((node) => !inside(node, answer));
    const read = above
      .filter((node) => !node.hidden && !node.closest("[hidden]") && !inside(node, byId(document, "finops-stand")))
      .filter((node) => (node.children ?? []).every((child) => child?.nodeType === 3))
      .map((node) => textOf(node)).join(" ");
    // The filter above must not be able to pass by selecting nothing: what a
    // cold visitor reads before the answer is several sentences of real copy.
    assert.ok(read.length > 400, `only ${read.length} characters were read above the answer`);
    assert.ok(read.includes(TRACK_RECORD_QUESTION), "the walk missed the header it is about");
    assert.doesNotMatch(read, LOAD_NARRATION,
      "a block above the answer is still narrating the load a cold visitor already finished");
    for (const placeholder of [SECONDARY_PLACEHOLDER.score, SECONDARY_PLACEHOLDER.guidedFinding,
      SECONDARY_PLACEHOLDER.benchmark]) {
      assert.ok(!read.includes(placeholder),
        `"${placeholder}" is read above the answer on a resolved cold open`);
    }
  } finally {
    page.restore();
  }
});

test("a rerun of the bundled analysis reads as the page's own loading state", async () => {
  // The only way to observe the loading state through the shipped wiring rather
  // than by repainting the helper by hand: fail the first load, then press the
  // retry the failure offers and read the region before the second one resolves.
  const page = await coldOpen({ routes: BUNDLE_MISSING });
  try {
    const { document } = page;
    const region = byId(document, LOAD_STATUS_IDS.region);
    assert.equal(region.dataset.state, "error", "the bundled analysis was expected to fail");

    byId(document, LOAD_STATUS_IDS.retry).click();
    assert.equal(region.dataset.state, LOAD_PRESENTATION.loading.state);
    assert.equal(region.getAttribute("aria-busy"), "true");
    // The shipped words, copied from the constant the page passes rather than
    // paraphrased: a reader is told what is being prepared, that no file of
    // theirs is needed, and what they can do instead of waiting.
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.title)), BUNDLED_LOAD_STATE.loading.title);
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.copy)), BUNDLED_LOAD_STATE.loading.detail);
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.word)), LOAD_PRESENTATION.loading.word);
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.shape)), LOAD_PRESENTATION.loading.shape);
    // The one next action survives the wait; the retry does not offer itself twice.
    assert.equal(byId(document, LOAD_STATUS_IDS.choose).hidden, false);
    assert.equal(byId(document, LOAD_STATUS_IDS.retry).hidden, true);

    // Settle the rerun before the globals go: an in-flight load outlives restore().
    await waitFor(() => region.dataset.state === "error", "the rerun to resolve");
  } finally {
    page.restore();
  }
});

test("a failed bundled analysis leaves the answer whole, with its one figure and one action", async () => {
  const page = await coldOpen({ routes: BUNDLE_MISSING });
  try {
    const { document } = page;
    assert.equal(byId(document, LOAD_STATUS_IDS.region).dataset.state, "error");
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.title)), BUNDLED_LOAD_STATE.firstFailure.title);

    // The recoverable answer is computed from a module in the bundle, so a fetch
    // that never resolved must not cost a reader the question they came for.
    const region = byId(document, ANSWER_REGION_ID);
    assert.equal(region.hidden, false, "a failed fixture withdrew the answer it does not feed");
    const recoverable = getRecoverableSpend(loadExampleDataset());
    assert.equal(textOf(byId(document, "finops-recoverable-value")), recoverable.monthlyDisplay);
    assert.deepEqual(region.querySelectorAll(".stand-action").filter(answersOwn)
      .map((action) => action.id), [ACTION_ID]);
    assert.match(textOf(byId(document, "finops-recoverable-trust")), /Illustrative/,
      "the failure left the figure standing without the line that grades it");

    // The recovery control is a real, enabled, keyboard-reachable button rather
    // than a sentence telling a reader to reload the page.
    const retry = byId(document, LOAD_STATUS_IDS.retry);
    assert.equal(retry.tagName, "BUTTON");
    assert.equal(retry.hidden, false);
    assert.equal(retry.disabled, false);
    assert.ok(tabSequence(document).map((node) => node.id).includes(LOAD_STATUS_IDS.retry));
  } finally {
    page.restore();
  }
});

/* ------- 4. the answer reads as one finding, and nothing rivals it ---------- */

test("the canonical answer owns the only question at its rank on the first screen", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const main = byId(document, "main-content");
    const blocks = (main.children ?? []).filter((child) => child?.nodeType === 1);
    const answer = byId(document, FIRST_RUN_IDS.region);

    // The block a cold visitor meets under the hero, and the block the reorder
    // parks directly beneath it. Read off the moved page, because in authored
    // order the header is a CHILD of the hero and inherits the hero's own
    // subordinate rung — the rank it paints at once it is a sibling is a
    // different question, and it is the one a reader actually meets.
    assert.equal(blocks[1].id, FIRST_RUN_IDS.region);
    assert.equal(blocks[2].id, TRACK_RECORD_IDS.region);

    // ONE HEADING AT THE ANSWER'S RANK, from the top of `<main>` down to the end
    // of the block that follows it. `renderTrackRecord` used to paint an h2 here
    // on load; the authored markup had demoted the same question to a paragraph
    // for exactly this reason, so the painter is what the count catches.
    const first = [blocks[0], blocks[1], blocks[2]];
    const rank2 = document.querySelectorAll("h2")
      .filter((heading) => first.some((block) => inside(heading, block)));
    assert.deepEqual(rank2.map((heading) => heading.id), [FIRST_RUN_IDS.question],
      "a second h2 asks its own question above or beside the canonical answer");
    assert.equal(byId(document, TRACK_RECORD_IDS.question).tagName, "P",
      "the track-record question is back in the heading outline as a rival");

    // And the answer's own evidence is subordinate BY LEVEL, not by tint: every
    // heading inside the region other than its question is h3 or lower.
    const within = headingsWithin(document, answer)
      .filter((heading) => heading.id !== FIRST_RUN_IDS.question);
    assert.ok(within.length >= 5, `only ${within.length} evidence headings found in the answer`);
    for (const heading of within) {
      assert.ok(["H3", "H4", "H5", "H6"].includes(heading.tagName),
        `${heading.id || textOf(heading)} opens at the answer's own rank inside it`);
    }
  } finally {
    page.restore();
  }
});

test("the answer sentence is the dominant value in its own block, in both rungs", () => {
  // The harness computes no styles, so the assertion is on the rules that
  // produce the hierarchy: the answer's step must be the larger of the pair at
  // its floor and at its ceiling, in the full-weight rule AND in the demoted one
  // the region actually ships with. Five evidence figures used to outrank it.
  // Anchored to the start of a line: `.first-run-value {` is a substring of the
  // demoted rule above it, so an unanchored match would read the same rung twice
  // and the inverted pair would pass by comparing itself.
  const step = (selector) => {
    const rule = new RegExp(`^${selector} \\{([^}]*)\\}`, "m").exec(STYLES);
    assert.ok(rule, `${selector} is gone, so the answer has no rung at all`);
    const clamp = /font-size:clamp\((\d+(?:\.\d+)?)px,[^,]+,(\d+(?:\.\d+)?)px\)/.exec(rule[1]);
    assert.ok(clamp, `${selector} no longer sizes itself with a clamp step`);
    return { floor: Number(clamp[1]), ceiling: Number(clamp[2]) };
  };

  for (const [answerSelector, valueSelector] of [
    ["\\.first-run-answer", "\\.first-run-value"],
    ["\\.first-run\\[data-subordinate=\"true\"\\] \\.first-run-answer",
      "\\.first-run\\[data-subordinate=\"true\"\\] \\.first-run-value"],
  ]) {
    const sentence = step(answerSelector);
    const figure = step(valueSelector);
    assert.ok(sentence.floor > figure.floor,
      `${answerSelector}: the evidence figures outrank the answer at the narrow floor`);
    assert.ok(sentence.ceiling > figure.ceiling,
      `${answerSelector}: the evidence figures outrank the answer at the wide ceiling`);
  }

  // And the heading above the sentence still outranks it, so the block descends
  // question → answer → evidence rather than peaking in the middle.
  const heading = step("\\.first-run-head h2");
  const sentence = step("\\.first-run-answer");
  assert.ok(heading.floor > sentence.floor && heading.ceiling > sentence.ceiling,
    "the answer sentence has grown past the question it answers");
});

test("the journey's live region announces from outside the disclosure that folds it", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const live = byId(document, "finops-journey-live");
    assert.equal(live.getAttribute("role"), "status");

    // The structure IS the assertion: `textOf` reads straight through a shut
    // disclosure, so a live region inside one looks announced to this harness
    // and announces to nobody in a browser. Walk the ancestors instead.
    for (let walk = live.parentNode; walk; walk = walk.parentNode) {
      assert.notEqual(walk.tagName, "DETAILS",
        `the journey's announcement is folded inside #${walk.id || "an unnamed disclosure"}`);
    }
    // The disclosure it was folded into is still shut, so the fix is a move and
    // not an accidental unfolding of the evidence layer.
    const disclosure = byId(document, "disclosure-journey");
    assert.ok(!disclosure.open, "the evidence layer opened itself on load");
    assert.equal(inside(byId(document, "finops-journey"), disclosure), true,
      "the region the live line speaks for left its disclosure too");
    // And the announcer that carries this content's voice for the answer block
    // is outside every disclosure too: the echo was silenced, not the message.
    const announcer = byId(document, "finops-stand-live");
    for (let walk = announcer.parentNode; walk; walk = walk.parentNode) {
      assert.notEqual(walk.tagName, "DETAILS",
        "the page's one announcer is folded inside a disclosure");
    }
  } finally {
    page.restore();
  }
});

test("every evidence disclosure on the first screen opens on one press", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const ids = ["disclosure-next-step", "disclosure-journey",
      "finops-first-run-how-we-know", "finops-first-run-method"];

    for (const id of ids) {
      const details = byId(document, id);
      assert.equal(details.tagName, "DETAILS", `#${id} is not a native disclosure`);
      assert.ok(!details.open, `#${id} is already open, so it costs nothing to reach`);
      const summary = (details.children ?? [])
        .find((child) => child?.tagName === "SUMMARY");
      assert.ok(summary, `#${id} has no summary, so it has no control`);

      // One press on the focused summary. A native summary is the control, so
      // Enter is the browser's — the harness models the same contract.
      summary.focus();
      assert.equal(document.activeElement, summary, `#${id}'s summary is not focusable`);
      // The harness reflects no properties to attributes, so the state is read
      // through the attribute the toggle actually writes.
      pressEnter(document);
      assert.equal(details.hasAttribute("open"), true,
        `#${id} needed more than one press to open`);
      pressEnter(document);
      assert.equal(details.hasAttribute("open"), false,
        `#${id} would not shut again on the same press`);
    }
  } finally {
    page.restore();
  }
});

/* --------------- 5. what stays behind the disclosure on load ---------------- */

test("the demoted readiness detail is still shut after the page has run", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const details = byId(document, "analysis-readiness-detail");

    // A closed details reports `open === undefined` in this harness, never false.
    assert.ok(!details.open, "the demoted detail opened itself on load");
    assert.equal(details.dataset.disclosure, "collapsed");
    assert.equal(details.tagName, "DETAILS");

    // The line that ranked the actions is INSIDE it — the structure is the
    // assertion, because `textOf` reads straight through a shut disclosure and
    // would report the text either way.
    assert.equal(inside(byId(document, "finops-canonical-answer-action-basis"), details), true,
      "the demoted line is no longer inside the disclosure that holds it");

    // Its summary is the control, and it still says what opening it gives you.
    const summary = byId(document, "analysis-readiness-detail-summary");
    assert.equal(summary.tagName, "SUMMARY");
    assert.equal(summary.parentNode, details);
    // The shipped wording, after the glyph that is `aria-hidden` and before the
    // score the readiness view paints into the summary's own slot on load.
    assert.match(textOf(summary),
      /Readiness verdict, evidence, and limits — the figure behind them, and what later evidence would enable/);
    assert.match(textOf(byId(document, "analysis-readiness-detail-score")), /readiness \d+\/100$/,
      "the summary's score slot is still sitting on its authored placeholder");
    assert.equal(summary.getAttribute("aria-expanded"), "false");

    // The answer's own working is shut on load too, so the first screen a reader
    // meets is the question, the figure and the move — not three open panels.
    const howWeKnow = byId(document, "finops-recoverable-how-we-know");
    assert.ok(!howWeKnow.open);
    assert.match(textOf(byId(document, "finops-recoverable-how-we-know-summary")),
      /How we know this$/);
    // And no disclosure inside the answer region opened itself: the count is of
    // those with the attribute set, so one springing open fails by number.
    const opened = byId(document, ANSWER_REGION_ID).querySelectorAll("details")
      .filter((node) => node.hasAttribute("open"));
    assert.deepEqual(opened.map((node) => node.id), []);
  } finally {
    page.restore();
  }
});
