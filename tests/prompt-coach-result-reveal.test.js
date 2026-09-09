// What the prompt coach draws before it has an answer, and what it reveals once
// it has one.
//
// Two halves of one claim. While the bundled example is loading the region says
// one sentence and nothing else: no result heading, no copy control, and no
// empty manual-copy box a reader could put an empty clipboard on. Once a usable
// grade exists the score, the coaching summary, the comparison guidance and an
// enabled copy action are all on screen, in that reading order and in that tab
// order. Neither transition takes anybody's focus — grading completes where the
// reader left it, on the control they pressed.
//
// The loading sentence is checked as live-region BEHAVIOUR rather than as text:
// the node that carries it is permanent and ships empty, and every write to it
// is recorded, so "announced exactly once" is a count and not an inspection.
//
// The harness's fetch throws on any request a test did not declare, and this
// file declares none.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { coachingSample } from "../src/prompt-coaching-contract.js";
import { applyCoachingFirstRun } from "../src/prompt-coaching-entry-view.js";

const PAGE = fileURLToPath(new URL("../src/coach.html", import.meta.url));

const WEAK = coachingSample("underspecified-request").text;
const STRONG = coachingSample("well-formed-request").text;

const byId = (document, id) => document.getElementById(id);

/**
 * Every write to one node's text, in order.
 *
 * A live region announces because an existing node's content changed, so the
 * assertion that matters is how many times it changed and to what — not what
 * string happens to be sitting in it when the test looks.
 */
function recordWrites(node) {
  let owner = Object.getPrototypeOf(node);
  while (owner && !Object.getOwnPropertyDescriptor(owner, "textContent")) {
    owner = Object.getPrototypeOf(owner);
  }
  const inherited = Object.getOwnPropertyDescriptor(owner, "textContent");
  const writes = [];
  Object.defineProperty(node, "textContent", {
    configurable: true,
    get: () => inherited.get.call(node),
    set: (value) => { writes.push(String(value)); inherited.set.call(node, value); },
  });
  return writes;
}

/**
 * Open the page with the bundled example held mid-load.
 *
 * The page entry mounts itself on import, so it is imported against a document
 * this helper discards. The page it drives is loaded afterwards and wired by
 * hand, because the shipped loader paints in the turn it is called in and there
 * would be no loading state to read.
 */
async function openMidLoad() {
  const booted = await loadPage(PAGE);
  const { initPromptCoaching } = await importPageModule("/prompt-coaching-page.js");
  const page = await loadPage(PAGE);
  const status = byId(page.document, "prompt-coach-sample-status");
  const writes = recordWrites(status);
  let paint;
  initPromptCoaching(page.document, {
    loadBundledExample: (document) => new Promise((resolve) => {
      paint = () => resolve(applyCoachingFirstRun(document));
    }),
  });
  const finish = async () => {
    paint();
    await waitFor(() => byId(page.document, "prompt-coach-sample-body").dataset.loadState === "ready",
      "the bundled example to finish grading");
  };
  return { page, status, writes, finish, restore: () => { page.restore(); booted.restore(); } };
}

async function openCoach() {
  const page = await loadPage(PAGE);
  await importPageModule("/prompt-coaching-page.js");
  return page;
}

function tabTo(document, id) {
  for (let step = 0; step <= tabSequence(document).length; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot use the coach.`);
}

function gradeText(document, text) {
  byId(document, "prompt-coaching-input").value = text;
  tabTo(document, "prompt-coaching-grade");
  pressEnter(document);
}

/** How many times a sentence appears in a region, so "said once" is countable. */
const occurrences = (node, phrase) => textOf(node).split(phrase).length - 1;

/** The ids of the section's own children, in document order. */
function regionOrder(document) {
  return byId(document, "prompt-coaching").children
    .map((child) => child.getAttribute?.("id"))
    .filter(Boolean);
}

test("the loading state is one sentence, announced by one write to a live region", async () => {
  const open = await openMidLoad();
  try {
    const { page, status, writes } = open;
    const shipped = status.dataset.loading;
    assert.match(shipped, /Loading the bundled example/);

    // Introduced after initialization, into the node that shipped empty: one
    // write, with the page's own wording. A region that shipped populated would
    // have recorded no write at all and announced nothing.
    assert.deepEqual(writes, [shipped]);
    assert.equal(status.getAttribute("role"), "status");
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.equal(status.getAttribute("aria-atomic"), "true");

    // And it is the region's only loading status: the body is empty and busy,
    // not carrying a second copy of the same sentence.
    const body = byId(page.document, "prompt-coach-sample-body");
    assert.equal(body.dataset.loadState, "loading");
    assert.equal(body.getAttribute("aria-busy"), "true");
    assert.equal(textOf(body).trim(), "");
    assert.equal(occurrences(byId(page.document, "prompt-coach-sample"),
      "Loading the bundled example"), 1);

    await open.finish();
    // The claim is withdrawn once there is a grade under it, and withdrawing it
    // is not a second announcement of the loading sentence.
    assert.deepEqual(writes, [shipped, ""]);
    assert.equal(writes.filter((written) => written === shipped).length, 1);
    assert.equal(textOf(status), "");
    assert.ok(byId(page.document, "prompt-coach-sample-result"));
  } finally {
    open.restore();
  }
});

test("nothing that needs a grade is drawn while the example is loading", async () => {
  const open = await openMidLoad();
  try {
    const { document } = open.page;

    // No result in the region that is loading one, and none in the visitor's own
    // panel. The possible-results disclosure below is not in scope: it is a
    // review surface over bundled samples, closed by default, and it has its own
    // load cycle.
    const sample = byId(document, "prompt-coach-sample");
    assert.equal(byId(document, "prompt-coach-sample-result"), null);
    assert.equal(sample.querySelectorAll(".coaching-result-heading").length, 0);
    assert.equal(sample.querySelectorAll(".coaching-result-region").length, 0);
    assert.equal(byId(document, "prompt-coaching-result").hidden, true);
    assert.equal(byId(document, "prompt-coaching-change").hidden, true);

    // No coaching summary. The heading, the copy action and the manual-copy box
    // are all inside a block that has nothing to summarise yet, so the block is
    // hidden, the box is empty, and the button is not reachable by Tab: an
    // enabled copy control over an empty summary copies an empty clipboard.
    const copy = byId(document, "prompt-coaching-copy");
    assert.equal(copy.hidden, true);
    assert.equal(tabSequence(document).includes(byId(document, "prompt-coaching-copy-button")), false,
      "a copy action with no summary behind it must not be reachable");
    assert.equal(byId(document, "prompt-coaching-copy-fallback").hidden, true);
    assert.equal(byId(document, "prompt-coaching-copy-text").value, "");
    assert.equal(textOf(byId(document, "prompt-coaching-copy-status")), "");

    // And no premature announcement over the grading live region either: the
    // sample's loading state is the sample's to report.
    assert.equal(textOf(byId(document, "prompt-coaching-live")), "");
  } finally {
    open.restore();
  }
});

test("a usable grade reveals the score, the summary, the guidance and an enabled copy action", async () => {
  const page = await openCoach();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);

    // The score, as both grades, labelled.
    const change = byId(document, "prompt-coaching-change");
    assert.equal(change.hidden, false);
    const scores = change.querySelector(".prompt-coaching-change-scores");
    assert.deepEqual(scores.querySelectorAll("dt").map(textOf), ["Baseline", "Revised"]);

    // The comparison guidance: exactly one move, and it is the comparison's.
    assert.equal(document.querySelectorAll(".prompt-coaching-change-action").length, 1);
    assert.ok(textOf(change.querySelector(".prompt-coaching-change-action-guidance")).length > 0);

    // The coaching summary, with an enabled action over a box that has the text
    // the button would copy.
    const copy = byId(document, "prompt-coaching-copy");
    assert.equal(copy.hidden, false);
    assert.equal(copy.dataset.reason, "compared");
    const button = byId(document, "prompt-coaching-copy-button");
    assert.equal(button.disabled, false);
    assert.ok(byId(document, "prompt-coaching-copy-text").value.length > 0,
      "the copy action must not be offered over an empty summary");

    // Reading order: what moved, then the record of it, then the full result.
    const order = regionOrder(document);
    assert.ok(order.indexOf("prompt-coaching-change") < order.indexOf("prompt-coaching-copy"));
    assert.ok(order.indexOf("prompt-coaching-copy") < order.indexOf("prompt-coaching-result"));

    // Tab order follows it: the copy action comes after the controls that
    // produced the thing it copies.
    const sequence = tabSequence(document).map((node) => node.id);
    assert.ok(sequence.indexOf("prompt-coaching-copy-button") > sequence.indexOf("prompt-coaching-grade"));
    assert.ok(sequence.indexOf("prompt-coaching-copy-button") > sequence.indexOf("prompt-coaching-clear"));
  } finally {
    page.restore();
  }
});

test("focus stays on the control the reader activated after every grade", async () => {
  const page = await openCoach();
  try {
    const { document } = page;
    // Three grades: the first, the one that produces a comparison, and one more
    // over the same pair, because a repeated grade is where a surface that only
    // remembers to leave focus alone the first time gives itself away.
    for (const text of [WEAK, STRONG, STRONG]) {
      gradeText(document, text);
      assert.equal(document.activeElement.id, "prompt-coaching-grade",
        "grading completion must leave focus on the control that was activated");
    }
    assert.equal(byId(document, "prompt-coaching-change").hidden, false,
      "the third grade still draws the comparison it is a comparison of");
  } finally {
    page.restore();
  }
});
