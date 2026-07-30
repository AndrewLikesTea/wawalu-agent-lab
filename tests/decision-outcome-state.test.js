// What the recorded-outcome region on a decision page offers while its records
// are pending, absent, or unreadable.
//
// The region reads from the visitor's own log, so it has three ways to be
// wordless — still reading, nothing recorded to read, and the read failed — and
// only the last one can be answered by trying again. These run against the
// shipped markup and the shipped page module, on the keyboard, because the
// reading order, the retry rule, and the focus move are the parts that regress
// silently.

import assert from "node:assert/strict";
import test from "node:test";
import { initDecisionOutcome } from "../src/decision-outcome-page.js";
import {
  DECISION_OUTCOME_DETAIL_ID,
  DECISION_OUTCOME_RETRY_LABEL,
  DECISION_OUTCOME_STATE_COPY,
  isRecoverableOutcomeState,
  renderDecisionOutcomeState,
} from "../src/decision-outcome-view.js";
import { loadPage, pressEnter, pressSpace, tabSequence, textOf } from "./support/browser.js";

const DECISION_PAGE = new URL("../src/decision.html", import.meta.url);

const RECORD = {
  id: "decision-outcome-state",
  title: "Route summarisation to the cheaper model",
  status: "accepted",
  owner: "Mina",
  context: "The first read of the log can fail without the record being gone.",
  alternatives: "",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const emptyLog = () => ({
  decisions: [],
  releases: [],
  publicDecisionIds: new Set(),
  exampleDecisionIds: new Set(),
});

// A read that throws on its first N attempts, exactly the way an unreadable
// store does, and then answers. `attempts` is the proof that Retry re-ran the
// read rather than redrawing the last one.
function flakyLog(failures, decisions = [RECORD]) {
  const calls = { attempts: 0 };
  const loadData = () => {
    calls.attempts += 1;
    if (calls.attempts <= failures) throw new Error("decision log unreadable");
    return { ...emptyLog(), decisions };
  };
  return { calls, loadData };
}

async function outcomePage(t, { search = `?id=${RECORD.id}`, loadData } = {}) {
  const page = await loadPage(DECISION_PAGE, { storage: {}, location: { search } });
  t.after(() => page.restore());
  const { document } = page;
  const container = document.querySelector("#decision-outcome");
  return {
    document,
    container,
    boot: () => initDecisionOutcome({ loadData, detailSeeds: [] }),
    get state() { return container.querySelector(".dout-state"); },
    get outcome() { return container.querySelector(".dout"); },
    get retry() { return container.querySelector(".dout-retry"); },
  };
}

/* ----------------------------- pending, not blank -------------------------- */

test("the shipped loading state keeps the page's hierarchy and announces politely", async (t) => {
  const page = await outcomePage(t);
  const { document } = page;

  // The page around a pending region is untouched: its title, its navigation,
  // and the heading of the region itself are all still there to read.
  assert.equal(textOf(document.querySelector("title")), "Decision · Shiplog");
  assert.ok(document.querySelector(".site-nav").querySelectorAll("a").length >= 5,
    "the navigation is still on the page");
  assert.ok(document.querySelector("h1"), "the page still has its own heading");
  assert.equal(textOf(document.querySelector("#dout-panel-title")),
    "Recorded outcome and optional evidence");

  const state = page.state;
  assert.equal(state.dataset.state, "loading");
  assert.equal(state.getAttribute("role"), "status");
  assert.equal(page.container.getAttribute("aria-busy"), "true");

  // One compact status, in the reading order the region re-renders in: the
  // label, the heading, the status chip, then the sentence explaining it.
  const order = state.childElements.map((child) => child.className);
  assert.deepEqual(order,
    ["dout-kicker", "dout-state-title", "dout-status", "dout-state-body"]);
  assert.equal(textOf(state.querySelector(".dout-status-label")),
    DECISION_OUTCOME_STATE_COPY.loading.word);
  assert.equal(state.querySelector(".dout-cue").getAttribute("aria-hidden"), "true");
  assert.equal(state.querySelector(".dout-state-body").id, DECISION_OUTCOME_DETAIL_ID);

  // Nothing in a pending region promises a recovery from a failure that has not
  // happened, so there is no control in it at all.
  assert.equal(state.dataset.recoverable, "false");
  assert.equal(page.container.querySelectorAll("button").length, 0);
});

test("the markup and the module say the same thing about loading", async (t) => {
  const page = await outcomePage(t);
  assert.equal(textOf(page.state.querySelector(".dout-state-title")),
    DECISION_OUTCOME_STATE_COPY.loading.title);
  assert.equal(textOf(page.state.querySelector(".dout-state-body")),
    DECISION_OUTCOME_STATE_COPY.loading.body);

  // Re-rendering the same state must not move anything: the static markup is
  // the module's own output, not a hand-written approximation of it.
  const rendered = renderDecisionOutcomeState(page.container, "loading");
  assert.deepEqual(rendered.childElements.map((child) => child.className),
    ["dout-kicker", "dout-state-title", "dout-status", "dout-state-body"]);
});

/* ------------------------- the three states are distinct ------------------- */

test("loading, reading, and a failed read are told apart without colour", async (t) => {
  const page = await outcomePage(t);
  const words = new Set();
  const glyphs = new Set();
  const shapes = new Set();

  for (const state of ["loading", "reading", "error"]) {
    const panel = renderDecisionOutcomeState(page.container, state, { onRetry: () => {} });
    words.add(textOf(panel.querySelector(".dout-status-label")));
    glyphs.add(textOf(panel.querySelector(".dout-cue")));
    shapes.add(panel.dataset.shape);
    assert.equal(panel.dataset.state, state);
    assert.equal(panel.getAttribute("role"), state === "error" ? "alert" : "status");
    assert.equal(page.container.getAttribute("aria-busy"), state === "error" ? "false" : "true");
  }

  assert.equal(words.size, 3, "each state needs its own status word");
  assert.equal(glyphs.size, 3, "each state needs its own glyph");
  assert.equal(shapes.size, 3, "each state needs its own border treatment");

  // An unknown state is the error state, never an empty region.
  assert.equal(renderDecisionOutcomeState(page.container, "nonsense").dataset.state, "error");
});

test("only the failed read offers a retry, and it is described by its own reason", async (t) => {
  const page = await outcomePage(t);

  for (const state of ["loading", "reading"]) {
    const panel = renderDecisionOutcomeState(page.container, state, { onRetry: () => {} });
    assert.equal(isRecoverableOutcomeState(state), false);
    assert.equal(panel.dataset.recoverable, "false");
    assert.equal(panel.querySelectorAll("button").length, 0, `${state} must not offer a retry`);
  }

  assert.equal(isRecoverableOutcomeState("error"), true);
  const failed = renderDecisionOutcomeState(page.container, "error", { onRetry: () => {} });
  assert.equal(failed.dataset.recoverable, "true");
  const retry = failed.querySelector(".dout-retry");
  assert.equal(textOf(retry), DECISION_OUTCOME_RETRY_LABEL);
  assert.equal(retry.type, "button");
  // The action comes before the long explanation in reading order, and carries
  // that explanation as its description, so a reader who tabs straight onto it
  // still hears why it is being offered.
  assert.equal(retry.getAttribute("aria-describedby"), DECISION_OUTCOME_DETAIL_ID);
  const classes = failed.childElements.map((child) => child.className);
  assert.ok(classes.indexOf("dout-state-actions") < classes.indexOf("dout-state-body"));

  // The failure names itself and never asks for a page reload.
  assert.match(textOf(failed), /no outcome is stated/);
  assert.match(textOf(failed), /reading them again is safe/);
  assert.doesNotMatch(textOf(failed), /reload/i);
});

/* --------------------------- nothing recorded is not an error -------------- */

test("a decision that is not recorded here is a stated outcome, not a failure", async (t) => {
  const page = await outcomePage(t, { search: "?id=never-recorded", loadData: () => emptyLog() });
  page.boot();

  assert.equal(page.state, null, "a resolved read leaves no waiting state behind");
  assert.equal(page.retry, null, "nothing to retry: the records were read");
  assert.equal(page.container.getAttribute("aria-busy"), "false");
  assert.notEqual(page.container.dataset.state, "error");
  // Its own sentence, which is not the failure's sentence.
  assert.doesNotMatch(textOf(page.outcome), /could not be read/);
  assert.match(textOf(page.outcome), /decision/i);
});

/* ------------------------------ retry, on the keyboard --------------------- */

test("a failed read offers a retry the keyboard can reach, and re-reads on Enter", async (t) => {
  const { calls, loadData } = flakyLog(1);
  const page = await outcomePage(t, { loadData });
  page.boot();

  assert.equal(calls.attempts, 1);
  assert.equal(page.state.dataset.state, "error");

  // Reached by tabbing, not by a synthetic click on an unreachable node.
  const tabbable = tabSequence(page.document);
  const retry = tabbable.find((node) => node.classList.contains("dout-retry"));
  assert.ok(retry, "the retry must be in the page's tab sequence");
  retry.focus();
  pressEnter(page.document);

  assert.equal(calls.attempts, 2, "Enter must re-run the read");
  assert.equal(page.state, null, "the second read resolved, so no state panel remains");
  assert.ok(page.outcome, "the outcome replaced the failure");
  assert.equal(page.container.getAttribute("aria-busy"), "false");
  // The control the reader was standing on is gone, so focus lands on what
  // replaced it rather than at the top of the document.
  assert.equal(page.document.activeElement, page.outcome);
});

test("Space activates the same retry, and a second failure keeps offering it", async (t) => {
  const { calls, loadData } = flakyLog(2);
  const page = await outcomePage(t, { loadData });
  page.boot();

  page.retry.focus();
  pressSpace(page.document);

  assert.equal(calls.attempts, 2);
  assert.equal(page.state.dataset.state, "error", "a second failure is still a failure");
  assert.ok(page.retry, "a read that could still succeed keeps its retry");
  assert.equal(page.document.activeElement, page.state, "focus lands on the reason, never nowhere");

  page.retry.focus();
  pressEnter(page.document);
  assert.equal(calls.attempts, 3);
  assert.ok(page.outcome, "the third read answered");
});
