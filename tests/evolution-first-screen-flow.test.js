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

import {
  loadPage, parseHtml, pressEnter, pressSpace, tabSequence, textOf,
} from "./support/browser.js";
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
const BASE_STYLES = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const PAGE_SOURCE = await readFile(PAGE, "utf8");
const PAGE_MODULE = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
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
    // and the track-record header up the page, so an authored-order assertion
    // describes a page no cold visitor sees.
    //
    // #1687 moved the anchor of that hoist from the hero to the answer. The pair
    // used to land between the page name and the canonical answer, which put a
    // second worked finding — its own question at heading rank, its own figure,
    // its own confidence and its own action — ahead of the one the page is for.
    // The first three blocks are asserted by position, not by relative order,
    // because "the answer is somewhere above the supporting sections" is the
    // weaker claim that let the rival sit above it in the first place.
    const blocks = childIds(byId(document, "main-content"));
    assert.equal(blocks[0], "finops-hero", "the page's own name no longer comes first");
    assert.equal(blocks[1], ANSWER_REGION_ID,
      "a block a cold visitor did not come for sits between the page name and the answer");
    assert.equal(blocks[2], FIRST_RUN_IDS.region,
      "the worked example no longer reads directly under the answer it illustrates");
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

    // The lead finding a cold visitor meets is the ANSWER (#1687), so its action
    // is the first move offered and the worked example's own next step is
    // downstream of it. Before this the order ran the other way: a reader tabbing
    // out of the page name reached the illustration's step first and the move the
    // page recommends second.
    const finding = order.indexOf(FIRST_RUN_IDS.import);
    const target = order.indexOf(ACTION_ID);
    assert.ok(finding >= 0, "the lead finding's own next step is not keyboard reachable");
    assert.ok(target >= 0 && target < finding,
      `the worked example's step is reached before the move the answer recommends: ${order.slice(0, 6).join(", ")}`);

    // Every stop between the two is inside the content region: nothing sends a
    // keyboard reader out through the header or the footer between the move and
    // the illustration that supports it.
    const main = byId(document, "main-content");
    const between = tabSequence(document).slice(target, finding + 1);
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

/* --------------- 4. what stays behind the disclosure on load ---------------- */

test("the canonical finding keeps one closed supporting disclosure after load", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    // A closed details reports `open === undefined` in this harness, never false.
    // The answer's own working is shut on load too, so the first screen a reader
    // meets is the question, the figure and the move — not three open panels.
    const howWeKnow = byId(document, "finops-recoverable-how-we-know");
    assert.ok(!howWeKnow.open);
    const summary = byId(document, "finops-recoverable-how-we-know-summary");
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.match(textOf(summary), /How we know this$/);
    assert.deepEqual(byId(document, ANSWER_REGION_ID).querySelectorAll("details")
      .map((node) => node.id), ["finops-recoverable-how-we-know"]);
  } finally {
    page.restore();
  }
});

test("keyboard-opening provenance, confidence, and calculation detail preserves one finding", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const answer = byId(document, ANSWER_REGION_ID);
    const details = byId(document, "finops-recoverable-how-we-know");
    const summary = byId(document, "finops-recoverable-how-we-know-summary");
    const visibleCompleteAnswers = () => document
      .querySelectorAll('[data-decision-summary="complete"]').filter((node) => !node.hidden).length;
    const completeAnswersBefore = visibleCompleteAnswers();

    assert.ok(!details.open, "supporting evidence is exposed on a cold load");
    assert.deepEqual(details.querySelectorAll("dt").map(textOf).slice(0, 3),
      ["Provenance", "Basis", "Limits"],
      "the disclosure no longer names the three checks a reader opens it for");
    for (const id of ["finops-recoverable-trust", "finops-recoverable-confidence-detail",
      "finops-recoverable-provenance-detail"]) {
      assert.ok(inside(byId(document, id), details), `${id} escaped progressive disclosure`);
    }

    const order = tabSequence(document);
    assert.equal(order.indexOf(summary), order.indexOf(byId(document, ACTION_ID)) + 1,
      "the disclosure is not the next logical stop after the recommended action");
    summary.focus();
    pressEnter(document);
    assert.ok(details.hasAttribute("open"), "Enter did not open the native disclosure");
    assert.equal(document.activeElement, summary, "opening evidence moved focus unexpectedly");

    assert.equal(answer.querySelectorAll('[data-primary-benchmark="true"]').length, 1,
      "opening evidence created a second headline benchmark");
    assert.equal(answer.querySelectorAll('[data-next-action="true"]').length, 1,
      "opening evidence created a second prioritized action");
    assert.equal(visibleCompleteAnswers(), completeAnswersBefore,
      "opening evidence exposed a duplicate complete-answer region");

    pressSpace(document);
    assert.ok(!details.hasAttribute("open"), "Space did not close the native disclosure");
  } finally {
    page.restore();
  }
});

test("at a narrow viewport the action and its disclosure remain reachable without answer duplication", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const answer = byId(document, ANSWER_REGION_ID);
    const action = byId(document, ACTION_ID);
    const summary = byId(document, "finops-recoverable-how-we-know-summary");
    const order = tabSequence(document);

    // This harness has no layout engine, so the viewport failure is pinned at
    // both seams: the shipped wrapping rules and the live, post-boot tab order.
    assert.match(BASE_STYLES,
      /@media\(max-width:520px\) \{ main,\.page\{width:calc\(100% - 24px\)/,
      "the page column does not fit a phone-width viewport");
    assert.match(STYLES, /\.stand-action\s*\{[^}]*display:inline-block/,
      "the recommended action lost its wrapping inline-block layout");
    assert.ok(order.includes(action), "the action fell out of the narrow flow's tab order");
    assert.equal(order.indexOf(summary), order.indexOf(action) + 1,
      "narrow layout inserted a control between the action and its evidence");

    summary.focus();
    pressEnter(document);
    assert.ok(byId(document, "finops-recoverable-how-we-know").hasAttribute("open"));
    assert.equal(answer.querySelectorAll('[data-primary-benchmark="true"]').length, 1);
    assert.equal(answer.querySelectorAll('[data-next-action="true"]').length, 1);
  } finally {
    page.restore();
  }
});

test("retired answer wording, duplicate cards, and the obsolete renderer stay absent", () => {
  const document = parseHtml(PAGE_SOURCE);
  for (const id of ["finops-recoverable-annual", "finops-recoverable-card",
    "finops-recoverable-confidence-card", "finops-recoverable-provenance-card"]) {
    assert.equal(byId(document, id), null, `retired duplicate #${id} returned`);
  }
  for (const rival of ["How much of our AI spend can we recover?",
    "How much AI spend is recoverable?", "What should we do about AI spend?"]) {
    assert.equal(PAGE_SOURCE.includes(rival), false, `retired rival heading returned: ${rival}`);
  }
  assert.doesNotMatch(PAGE_MODULE, /\brenderRecoverableSpend\b/,
    "the live page imported the retired second renderer");
});
