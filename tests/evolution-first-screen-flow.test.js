// The trimmed Evolution first screen, cold open to next action (#1670).
//
// WHAT WAS ALREADY COVERED, AND WHY THAT WAS NOT ENOUGH. #1671 cut this screen
// to one question, one metric, one move, and pinned the cut in three places:
// tests/evolution.test.js counts the question, the figure and the action in the
// AUTHORED markup; tests/finops-answer-reading-flow.test.js counts them again
// after one view function is called by hand; tests/finops-pre-analysis-empty
// -state.test.js walks the authored tab order into <main>. All three read a
// document that the page entry has never touched. src/evolution-page.js paints
// this region on load — the figure, its basis sentence, the retained-rate line,
// the readiness detail — so a view that painted a SECOND action, a SECOND
// headline figure, or that opened the demoted disclosure at load time would
// leave every one of those files green and still hand a CTO two next steps.
//
// So everything here runs on the BOOTED page, and each test names the hole it
// closes:
//   1. cold open, settled — the trimmed shape survives the paint, and an empty
//      session adds nothing above the move (no file existed for this).
//   2. the keyboard path — the first Tab into the content lands on the finding's
//      own move, and Enter follows it (asserted on the authored order before,
//      never after the paint, and never activated).
//   3. loading — the answer needs no network, so it must stay readable and
//      reachable while the fixture is in flight; tests/finops-load-status.test.js
//      pins the two regions that DO get hidden, and nothing pinned this one.
//   4. a failed bundled load — the shipped failure sentence, word for word, and
//      the finding and its move still first: nothing asserted that the recovery
//      control does not overtake the answer's action in the tab order.
//   5. the demoted detail — still shut, still holding the ranking line, after
//      the page paints, and no move hidden inside a disclosure. The narrow
//      viewport is the reason this matters and the reason it is asserted as
//      STRUCTURE: this harness models no layout, and `textOf` reads straight
//      through a shut disclosure, so `open` and the parent chain are the only
//      honest evidence that the demoted detail is still demoted.
//
// HARNESS NOTES. No `assert.equal(node, element)` — comparing a parsed node
// walks the whole page and outlives the test timeout, so every claim below is a
// count, an id, a text or an attribute. No `querySelectorAll("*")` and no
// descendant selectors; structure is walked through `node.children` and
// `parentNode`. A shut `<details>` reports `open === undefined`, so `!node.open`
// rather than `equal(node.open, false)`. Text nodes live in `children` and carry
// no `dataset`, hence the `?.` guards. Three settle waits per boot, not one:
// awaiting the entry alone leaves a paint in flight that lands after the globals
// are torn down and reds CI as an unhandled rejection.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { BUNDLED_LOAD_STATE } from "../src/briefing-strings.js";
import { applyPageLoadStatus, LOAD_STATUS_IDS } from "../src/finops-load-status.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { getRecoverableSpend } from "../src/finops-answer-contract.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const ROUTES = Object.freeze({
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
});

const ANSWER_REGION = "finops-recoverable-answer";
const ACTION = "finops-recoverable-action";
const SUPPORT_LAYER = "finops-answer-support";
const ACTION_DESTINATION = "/savings-action-center.html";

const byId = (document, id) => document.getElementById(id);

/** Every element under `node`, in document order, through `children` only. */
function descendants(node) {
  const found = [];
  const walk = (current) => {
    for (const child of current?.children ?? []) {
      if (child.nodeType !== 1) continue;
      found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}

/** True when `node` is the answer's own content, not the #1498 support layer. */
const answersOwn = (node) => {
  for (let up = node; up; up = up.parentNode) if (up.id === SUPPORT_LAYER) return false;
  return true;
};

/** True when any ancestor of `node` is a details element. */
const insideDisclosure = (node) => {
  for (let up = node.parentNode; up; up = up.parentNode) if (up.tagName === "DETAILS") return true;
  return false;
};

const hasClass = (node, name) => node.classList?.contains(name) === true;

/** Ids of the tab stops that sit inside the page's content region. */
const contentStops = (document) => tabSequence(document)
  .filter((stop) => {
    for (let up = stop; up; up = up.parentNode) if (up.id === "main-content") return true;
    return false;
  })
  .map((stop) => stop.id);

/**
 * The shipped page in a cold session: nothing stored, nothing imported, and
 * exactly the routes a caller names — every other request throws, so a test can
 * never quietly depend on the network.
 *
 * Three waits. The first is the page's own settle marker (or the load region's
 * error state, for the run where the fixture never arrives); the two after it
 * are the state the gateway and the evaluation panel write when their own paints
 * have landed.
 */
async function coldOpen({ routes = ROUTES } = {}) {
  const page = await loadPage(PAGE, { storage: {}, routes });
  assert.equal(page.storage.length, 0, "the session under test was not cold");
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready"
    || byId(document, LOAD_STATUS_IDS.region)?.dataset.state === "error",
  "the page never settled into a resolved load state");
  // "Gateway completed", not "Gateway": the authored text already begins
  // "Gateway unavailable until the bundled sample starts", so the looser prefix
  // returns before the gateway has painted and leaves its chain in flight.
  await waitFor(() => textOf(byId(document, "integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result")
    ?.getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

// ---------------------------------------------------------------------------
// 1. Cold open: the shape survives the paint
// ---------------------------------------------------------------------------

test("a settled cold open states one question, one headline figure, one move", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const region = byId(document, ANSWER_REGION);
    const own = descendants(region).filter(answersOwn);

    // FIRST, AT RUN TIME. tests/evolution.test.js makes this claim about the
    // authored file; src/finops-track-record.js moves blocks between regions on
    // load, so the claim has to hold after the page has painted or the reader
    // meets a different page from the one the source describes.
    const blocks = region.parentNode.children.filter((node) => node.nodeType === 1)
      .map((node) => node.id);
    assert.equal(blocks[0], "finops-hero", "the page's own name no longer comes first");
    assert.equal(blocks[1], ANSWER_REGION,
      `a block moved in front of the answer on load: ${JSON.stringify(blocks.slice(0, 4))}`);

    // ONE QUESTION. A second heading in this region is a second question, and
    // after the paint is exactly where one would appear unnoticed.
    // ONE QUESTION ON THE SCREEN. The paint adds six recovery-class headings
    // inside the shut "How we know this" disclosure; those are the demoted
    // working, so the count is taken at the level a reader actually meets.
    const headings = own.filter((node) => /^H[1-6]$/.test(node.tagName));
    const asked = headings.filter((node) => !insideDisclosure(node));
    assert.deepEqual(asked.map((node) => node.id), ["finops-recoverable-question"]);
    assert.equal(asked[0].tagName, "H2", "the one question sits directly under the page h1");
    assert.equal(textOf(asked[0]), "How much of our AI spend can we recover?");
    assert.ok(headings.length > asked.length,
      "the recovery-class working stopped being painted behind the disclosure");

    // ONE HEADLINE METRIC, and it is the accessor's own figure rather than a
    // number this page arrived at while painting.
    const recoverable = getRecoverableSpend(loadExampleDataset());
    const figures = own.filter((node) => hasClass(node, "stand-figure-value"));
    assert.deepEqual(figures.map((node) => node.id), ["finops-recoverable-value"]);
    assert.equal(textOf(figures[0]), recoverable.monthlyDisplay);
    assert.match(textOf(byId(document, "finops-recoverable-label")), /per month/);

    // ONE MOVE, named as the move and pointing at where it is carried out.
    const actions = own.filter((node) => hasClass(node, "stand-action"));
    assert.deepEqual(actions.map((node) => node.id), [ACTION],
      "the paint added a second next step to a screen that states one");
    assert.equal(actions[0].tagName, "A");
    assert.equal(actions[0].href, ACTION_DESTINATION);
    assert.match(textOf(actions[0]), /^Move /);

    // AND THE EMPTY SESSION ADDS NOTHING. A browser keeping nothing has no
    // retained rate to report: the slot stays empty, hidden, and out of the
    // reading order rather than announcing its own absence above the move.
    const retained = byId(document, "finops-retained-state");
    assert.equal(retained.hidden, true);
    assert.equal(textOf(retained), "");
    assert.equal(retained.dataset.state, "unretained");
    assert.equal(page.storage.length, 0, "a cold read of this screen wrote to storage");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. The keyboard path: lead finding → the move it recommends
// ---------------------------------------------------------------------------

test("the first Tab into the content lands on the finding's move, and Enter follows it", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    const stops = contentStops(document);
    assert.equal(stops[0], ACTION,
      `the first stops into the content are ${JSON.stringify(stops.slice(0, 4))}, `
      + `and the finding's own move is stop ${stops.indexOf(ACTION) + 1} of ${stops.length}`);

    // One Tab, from the last stop before the content: nothing the paint added
    // sits between the finding a reader has just read and the move it names.
    const sequence = tabSequence(document);
    const action = byId(document, ACTION);
    const before = sequence[sequence.indexOf(action) - 1];
    assert.ok(before, "the action is the document's first tab stop, so the header is gone");
    before.focus();
    const landed = pressTab(document);
    assert.equal(landed.id, ACTION);
    assert.equal(document.activeElement.id, ACTION, "focus did not move with the Tab");

    // The affordance a keyboard reader sees is the site's existing token, and
    // this change adds no rule of its own to either stylesheet.
    const evolutionCss = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
    const rule = evolutionCss.match(/\.stand-action:focus-visible \{([^}]*)\}/)?.[1];
    assert.ok(rule, "the one action publishes no focus-visible rule at all");
    assert.match(rule, /outline:3px solid var\(--focus-ring\)/);
    assert.match(rule, /outline-offset:3px/);
    assert.match(await readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
      /--focus-ring:#155f9e/, "the focus token moved; the ring above is stale");

    // And the move is activatable from the keyboard, not only clickable.
    assert.deepEqual(page.navigations, [], "the page navigated before anything was pressed");
    pressEnter(document);
    assert.deepEqual(page.navigations, [ACTION_DESTINATION],
      "pressing Enter on the one action did not take the reader to it");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. Loading: the answer needs no network, so it may not wait on one
// ---------------------------------------------------------------------------

test("while the bundled fixture loads, the answer and its move stay readable", async () => {
  const page = await loadPage(PAGE, { storage: {}, routes: ROUTES });
  try {
    const { document } = page;
    // The words the page ships, quoted rather than paraphrased: a rewrite in
    // src/briefing-strings.js reds this line by name.
    assert.equal(BUNDLED_LOAD_STATE.loading.title, "Preparing the Bundled synthetic example…");
    assert.equal(BUNDLED_LOAD_STATE.loading.detail,
      "Invented example data is being prepared. No personal file is needed. "
      + "You can wait, or choose files to analyze your own provider export.");

    applyPageLoadStatus(document, {
      state: "loading",
      title: BUNDLED_LOAD_STATE.loading.title,
      detail: BUNDLED_LOAD_STATE.loading.detail,
    });
    const region = byId(document, LOAD_STATUS_IDS.region);
    assert.equal(region.dataset.state, "loading");
    assert.equal(region.hidden, false);
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.title)), BUNDLED_LOAD_STATE.loading.title);
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.copy)), BUNDLED_LOAD_STATE.loading.detail);

    // The two regions composed from the fixture are hidden while it is in
    // flight. The answer above them is not: it is authored, it needs no
    // network, and a reader who can see the figure must still be able to act.
    assert.equal(byId(document, "finops-stand").hidden, true);
    assert.equal(byId(document, ANSWER_REGION).hidden, false);
    assert.equal(byId(document, "finops-recoverable-value").hidden, false);
    assert.equal(contentStops(document)[0], ACTION,
      "the load took the finding's move out of the reading order");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. A failed bundled load
// ---------------------------------------------------------------------------

test("a failed bundled load states the shipped failure and keeps the move first", async () => {
  // Every route except the analysis fixture, so the fetch behind the supporting
  // panels is the one thing that fails.
  const page = await coldOpen({ routes: { "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES } });
  try {
    const { document } = page;
    const region = byId(document, LOAD_STATUS_IDS.region);
    assert.equal(region.dataset.state, "error");

    // Word for word, both halves: the failure names what it cost — the panels —
    // and says the answer above is complete, which is the claim a reader acts on.
    assert.equal(BUNDLED_LOAD_STATE.firstFailure.title, "The supporting panels below could not load");
    assert.equal(BUNDLED_LOAD_STATE.firstFailure.detail,
      "The example decision above is complete and needed no network. "
      + "The bundled sample file behind the panels below could not be loaded, so they stay "
      + "unmeasured. Press “Retry bundled analysis” to fill them, or choose your own files.");
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.title)),
      BUNDLED_LOAD_STATE.firstFailure.title);
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.copy)),
      BUNDLED_LOAD_STATE.firstFailure.detail);

    // The screen a failure leaves behind is still the trimmed one: one figure,
    // one move, and the recovery control after them rather than in front.
    const own = descendants(byId(document, ANSWER_REGION)).filter(answersOwn);
    assert.deepEqual(own.filter((node) => hasClass(node, "stand-figure-value"))
      .map((node) => node.id), ["finops-recoverable-value"]);
    assert.deepEqual(own.filter((node) => hasClass(node, "stand-action"))
      .map((node) => node.id), [ACTION]);

    const stops = contentStops(document);
    assert.equal(stops[0], ACTION, "the failure put a control in front of the answer's move");
    const retry = byId(document, LOAD_STATUS_IDS.retry);
    assert.equal(retry.hidden, false, "the failure offers no way back");
    assert.ok(stops.indexOf(retry.id) > stops.indexOf(ACTION),
      "the recovery control overtook the finding's move in the tab order");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 5. The demoted detail, after the paint
// ---------------------------------------------------------------------------

test("the demoted detail is still shut, and no move is hidden inside a disclosure", async () => {
  const page = await coldOpen();
  try {
    const { document } = page;
    // A closed details reports `open === undefined` in this harness, never false.
    for (const id of ["analysis-readiness-detail", "finops-recoverable-how-we-know"]) {
      const details = byId(document, id);
      assert.ok(!details.open, `${id} was opened by the paint`);
      assert.equal(details.dataset.disclosure, "collapsed");
    }

    // The ranking line #1671 demoted is still inside the disclosure it moved
    // to. Asserted by walking `parentNode`: this harness has no layout and
    // `textOf` reads straight through a shut details, so the parent chain is the
    // only honest evidence that the line is still folded away on a narrow
    // screen rather than back in the first screen's height.
    const basis = byId(document, "finops-canonical-answer-action-basis");
    assert.ok(basis, "the demoted ranking line was deleted rather than demoted");
    assert.equal(insideDisclosure(basis), true, "the ranking line came back out onto the screen");

    // And nothing a reader is asked to DO is behind a control they must open
    // first: a move inside a shut disclosure is a move nobody makes, and on a
    // narrow viewport that is the difference between demoting the detail and
    // demoting the answer.
    const buried = descendants(byId(document, ANSWER_REGION))
      .filter((node) => hasClass(node, "stand-action") && insideDisclosure(node));
    assert.deepEqual(buried.map((node) => node.id), []);

    // The disclosures in this region are read after the move, not before it.
    const stops = contentStops(document);
    assert.ok(stops.indexOf("finops-recoverable-how-we-know-summary") > stops.indexOf(ACTION));
    assert.ok(stops.indexOf("analysis-readiness-detail-summary") > stops.indexOf(ACTION));
  } finally {
    page.restore();
  }
});
