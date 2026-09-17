// Asking again for the observatory's one real number — issue #2415.
//
// tests/agent-observatory-merged-outcomes.test.js pins what the block SAYS once
// it has stopped waiting: one of live / recorded / never-counted, no spinner
// left anywhere, both feed links intact. What it could not say was what a reader
// who lands on the unanswered version is supposed to DO. The personas panel and
// the activity panel each offer a control that asks their source again; the one
// figure on this site that is not an example offered nothing, so a rate-limited
// prospect's only retry was reloading the page — which throws away the live
// activity feed beside it and re-runs every other request on the page.
//
// So this file holds the block to the same recovery contract those two panels
// already keep, and to the two rules that make it safe to offer at all:
//
//   the control appears in exactly the states a second ask could change, and
//   never while the page is already asking;
//   and no number outlives the response it was counted from — not into loading,
//   not into the unavailable sentence, and not across a retry.
//
// Every fetcher here is a stub, and only the GitHub feeds answer: the published
// record is 404 unless a test says otherwise, so the fallbacks in this file land
// on the never-counted sentence rather than on a recorded count. Nothing here
// reaches GitHub.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isRecoverableMergedFigureState, loadActivity, wireActivityControls } from "../src/agents.js";
import { EVENTS_URLS, SOURCE_REPOSITORIES, feedLinkText } from "../src/public-merges.js";
import { RETAINED_COUNT_KEY, RETAINED_COUNT_SCHEMA } from "../src/merged-count-retention.js";
import { loadPage, parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";
const TAKEN_AT = "2026-07-14T09:15:00.000Z";

// The words the control asks in. The convention is the page's own: every other
// recovery on it is "Retry " followed by the subject its loading line names, so
// "Loading the merged pull request count" is retried by this.
const RETRY_LABEL = "Retry the merged pull request count";

// The un-awaited published-record read inside loadActivity resolves on the
// microtask queue, so a settled block is one that has been given those turns.
const settle = async () => { for (let turn = 0; turn < 4; turn += 1) await Promise.resolve(); };

async function waitForState(document, done, description) {
  for (let turn = 0; turn < 500; turn += 1) {
    const state = document.querySelector("#merged-figure").dataset.state;
    if (done(state)) return state;
    await new Promise((resolve) => { setImmediate(resolve); });
  }
  throw new Error(`the block never reached this state: ${description}`);
}

const pullRequestEvent = (number) => ({
  id: String(number),
  type: "PullRequestEvent",
  created_at: "2025-07-30T14:00:00Z",
  payload: {
    action: "closed",
    pull_request: {
      number, merged: true, title: `Pull request ${number}`,
      html_url: `https://github.com/AndrewLikesTea/paint-lab/pull/${number}`,
      head: { ref: "agent/frontend/observatory" },
    },
  },
});

const MERGES = [101, 102, 105].map(pullRequestEvent);

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === "date" ? RESPONSE_DATE : null) },
  json: async () => payload,
});

/**
 * A fetcher that counts what the page actually asked GitHub for.
 *
 * `github` is re-read on every call rather than captured, so one page can be
 * taken from a failing GitHub to an answering one between presses — which is the
 * only way to test that a retry reaches a different outcome than the ask before
 * it did.
 */
function githubReader(github) {
  const calls = [];
  const fetcher = async (url) => {
    if (!String(url).includes("api.github.com")) return { ok: false, status: 404 };
    calls.push(String(url));
    return github()(url);
  };
  return { calls, fetcher };
}

const feedsAnswer = () => async (url) => okResponse(url.includes("paint-lab") ? MERGES : []);
const feedsReject = () => async () => { throw new Error("offline"); };
const feedsRefuse = (status) => () => async () => ({ ok: false, status });
const feedsEmpty = () => async () => okResponse([]);
const feedsSilent = () => () => new Promise(() => {});

const storedCount = (count = 412) => ({
  [RETAINED_COUNT_KEY]: JSON.stringify({ schemaVersion: RETAINED_COUNT_SCHEMA, count, takenAt: TAKEN_AT }),
});

const figureOf = (document) => ({
  figure: document.querySelector("#merged-figure"),
  readout: document.querySelector("#merged-figure-readout"),
  actions: document.querySelector("#merged-figure-actions"),
  control: document.querySelector("#retry-merged-count"),
});

/**
 * The control as it is offered: visible, marked as the recovery it is, and
 * reachable by keyboard.
 *
 * Reachability is asserted through the page's tab sequence rather than by
 * looking at the button alone, because what withdraws it is the `hidden` on its
 * container — a control nobody can reach is exactly as useless as one that is
 * not there, and only the sequence can tell the two apart.
 */
function assertRetryOffered(document, what) {
  const { actions, control } = figureOf(document);
  assert.equal(actions.hidden, false, `${what}: the retry is not offered`);
  assert.equal(control.dataset.recovery, "retry", what);
  assert.equal(textOf(control), RETRY_LABEL, what);
  assert.ok(tabSequence(document).includes(control), `${what}: the retry is not reachable by keyboard`);
}

function assertRetryWithdrawn(document, what) {
  const { actions, control } = figureOf(document);
  assert.equal(actions.hidden, true, `${what}: a state with nothing to recover still offers a retry`);
  assert.equal(control.dataset.recovery, "none", what);
  assert.equal(tabSequence(document).some((node) => node.id === "retry-merged-count"), false,
    `${what}: a withdrawn retry is still in the tab sequence`);
}

/** No digit, and no claim that a number is still coming. */
function assertNoNumber(document, what) {
  const { readout } = figureOf(document);
  assert.doesNotMatch(textOf(readout), /\d/, `${what}: a number stands where no response put one`);
  assert.equal(readout.querySelectorAll(".merged-figure-count").length, 0, `${what}: a figure element survives`);
}

/** Both ways of counting it yourself, unchanged, in whatever state. */
function assertFeedLinks(document, what) {
  const links = document.querySelector(".merged-figure-sources").querySelectorAll("a");
  assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS, what);
  assert.deepEqual(links.map(textOf), SOURCE_REPOSITORIES.map(feedLinkText), what);
}

/* ------------------------------ the markup -------------------------------- */

test("the served block carries the retry, in the shape the observatory's other controls use", async () => {
  const document = parseHtml(await readFile(PAGE_URL, "utf8"));
  const { figure, control, actions } = figureOf(document);

  // The same element, the same classes, and the same container as the control
  // the personas panel already offers. The class is the whole focus ring — it is
  // what agents.css hangs `:focus-visible` on — so it is pinned against the
  // shipped control rather than against a literal that could drift from it.
  const personas = document.querySelector("#retry-personas");
  assert.equal(control.tagName, "BUTTON", "a real button, so Enter and Space already work");
  assert.equal(control.type, "button", "a button inside no form still must not submit one");
  assert.equal(control.className, personas.className);
  assert.equal(actions.className, personas.parentNode.className);
  assert.equal(control.parentNode.id, "merged-figure-actions");

  // The visible words are the accessible name, and they name what is asked for
  // again — the convention the other two labels follow.
  assert.equal(textOf(control), RETRY_LABEL);
  assert.equal(control.getAttribute("aria-label"), null);
  assert.equal(control.getAttribute("aria-describedby"), "merged-figure-detail");
  assert.equal(document.querySelectorAll("#merged-figure-detail").length, 1,
    "the sentence the control is described by has to exist in the served markup too");

  // Nothing has failed on the served page, so the control is not offered and is
  // not a tab stop — the first screen's tab order is unchanged until it is.
  assert.equal(actions.hidden, true);
  assert.equal(control.dataset.recovery, "none");
  assert.equal(tabSequence(document).some((node) => node.id === "retry-merged-count"), false);

  // Status, then the action on it, then the evidence: the reading order both
  // panels below use. The control is beside the live region and not inside it.
  assert.deepEqual(figure.childElements.map((child) => child.id), [
    "merged-figure-title", "merged-figure-readout", "merged-figure-actions", "merged-figure-note", "",
  ]);
  assert.equal(document.querySelector("#merged-figure-readout").querySelectorAll("button").length, 0);
  assert.equal(figure.querySelectorAll("[aria-live]").length, 1,
    "the retry must not bring a second live region to a block that has one");
});

/* --------------------------- reaching the state --------------------------- */

test("the retry belongs to the two states GitHub has not answered in, and to no others", () => {
  // A control that cannot change the answer beside it is a promise the page
  // would not be keeping — the rule the panels below already hold their own
  // controls to. `recorded` is in because it is a dated number standing in for a
  // live one, and a second ask is exactly how a reader gets the live one.
  assert.deepEqual(
    ["loading", "live", "recorded", "unavailable", "nonsense"].filter(isRecoverableMergedFigureState),
    ["recorded", "unavailable"],
  );
});

test("every way the request can fail lands on the unavailable state, with a retry and both links", async (t) => {
  const failures = {
    "a network failure": feedsReject,
    "a non-OK status": feedsRefuse(503),
    "rate limiting": feedsRefuse(403),
    "an empty payload": feedsEmpty,
    "a payload with nothing usable in it": () => async () => okResponse({ message: "Not Found" }),
  };

  for (const [what, github] of Object.entries(failures)) {
    const page = await loadPage(PAGE_URL, { storage: {} });
    t.after(() => page.restore());
    const { document } = page;

    await loadActivity(document, githubReader(github).fetcher, page.storage);
    await settle();

    assert.equal(figureOf(document).figure.dataset.state, "unavailable", what);
    assert.doesNotMatch(textOf(figureOf(document).figure), /Loading/,
      `${what}: the block is still sitting on its loading line`);
    assert.match(textOf(figureOf(document).readout), /unavailable/i,
      `${what}: the block does not say the count could not be had`);
    assertNoNumber(document, what);
    assertRetryOffered(document, what);
    assertFeedLinks(document, what);
  }
});

test("a GitHub that never answers settles onto the retry rather than onto the loading line", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  // The request is left open. Only the block's own display deadline can settle
  // it, and that deadline is what a reader who is merely being ignored gets.
  loadActivity(document, githubReader(feedsSilent).fetcher, page.storage, { settleAfterMs: 1 });
  const state = await waitForState(document, (name) => name !== "loading", "settled while GitHub was silent");

  assert.equal(state, "unavailable");
  assertNoNumber(document, "a silent GitHub");
  assertRetryOffered(document, "a silent GitHub");
  assertFeedLinks(document, "a silent GitHub");
});

/* -------------------------------- retrying -------------------------------- */

test("the retry asks GitHub again, and an answer paints this load's own count", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  let github = feedsReject;
  const { calls, fetcher } = githubReader(() => github());
  wireActivityControls(document, fetcher);

  await loadActivity(document, fetcher, page.storage);
  await settle();
  const asked = calls.length;
  assert.equal(figureOf(document).figure.dataset.state, "unavailable");

  // Reached and pressed the way a keyboard reader reaches and presses it.
  const control = tabSequence(document).find((node) => node.id === "retry-merged-count");
  assert.ok(control, "the retry must be in the tab sequence while it is offered");
  github = feedsAnswer;
  control.focus();
  pressEnter(document);

  // The press puts the block back on its loading line before anything can have
  // answered, so what a reader sees is the request they asked for, not the old
  // failure sitting there until it resolves.
  assert.equal(figureOf(document).figure.dataset.state, "loading");
  assertNoNumber(document, "a retry in flight");
  assertRetryWithdrawn(document, "a retry in flight");

  await waitForState(document, (name) => name === "live", "the retry reached a live count");
  await settle();

  assert.ok(calls.length > asked, "the retry asked GitHub again");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");
  assert.equal(textOf(document.querySelector(".merged-figure-unit")), "merged pull requests");
  assertRetryWithdrawn(document, "a live count");
  assertFeedLinks(document, "a live count");
  // The control the reader was standing on is withdrawn by the state it
  // produced, so focus lands on what replaced it rather than at the top of the
  // document — the same landing the personas panel's retry makes.
  assert.equal(document.activeElement, figureOf(document).readout);
});

test("a retry that fails again offers the same retry again, however many times", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  const { calls, fetcher } = githubReader(feedsReject);
  wireActivityControls(document, fetcher);

  await loadActivity(document, fetcher, page.storage);
  await settle();

  for (const attempt of [1, 2, 3]) {
    const asked = calls.length;
    const control = tabSequence(document).find((node) => node.id === "retry-merged-count");
    assert.ok(control, `attempt ${attempt}: the retry must still be offered after the failure before it`);
    control.focus();
    pressEnter(document);
    await waitForState(document, (name) => name === "unavailable", `attempt ${attempt} settled`);
    await settle();

    assert.ok(calls.length > asked, `attempt ${attempt}: a real request went out`);
    assertNoNumber(document, `attempt ${attempt}`);
    assertRetryOffered(document, `attempt ${attempt}`);
    assertFeedLinks(document, `attempt ${attempt}`);
    assert.equal(document.activeElement, figureOf(document).readout,
      `attempt ${attempt}: focus stays in the block that explains itself`);
  }
});

test("the undated count never outlives the response it was counted from", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  let github = feedsAnswer;
  const { fetcher } = githubReader(() => github());
  wireActivityControls(document, fetcher);

  await loadActivity(document, fetcher, page.storage);
  await settle();
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");
  assert.equal(document.querySelectorAll(".merged-figure-time").length, 1,
    "a live count is stamped with its own response's arrival time");
  const retained = page.storage.getItem(RETAINED_COUNT_KEY);
  assert.ok(retained, "a live count is what this browser remembers for its next visit");

  github = feedsRefuse(500);
  document.querySelector("#retry-merged-count").click();

  // The undated number is the one that can only ever be live, so the press takes
  // it off the page before anything can have answered. What the block falls back
  // to is a response this browser did receive, and it is dated as that — never
  // the digit that was standing there a moment ago, wearing a live stamp.
  assert.equal(document.querySelectorAll(".merged-figure-time").length, 0,
    "the live stamp survived a request that had not answered yet");
  await waitForState(document, (name) => name !== "loading", "the retry settled");
  await settle();

  assert.equal(figureOf(document).figure.dataset.state, "recorded");
  assert.equal(document.querySelectorAll(".merged-figure-time").length, 0,
    "a failed retry left an undated number on the page");
  assert.equal(document.querySelectorAll(".merged-figure-recorded-date").length, 1,
    "the number a failed retry falls back to has to carry the date it was taken on");
  assert.equal(page.storage.getItem(RETAINED_COUNT_KEY), retained,
    "a failed retry must not rewrite what this browser remembers");
});

/* ------------------------- while it is already asking ---------------------- */

test("the retry is not offered while the page is already asking, and cannot start a second request", async (t) => {
  // This browser has a count from a previous visit, so the block paints that
  // dated number while the live request is still on its way. It is the one state
  // that reads like an answer and is not one — and the one place a retry could
  // otherwise be offered for a request that is already in flight.
  const page = await loadPage(PAGE_URL, { storage: storedCount() });
  t.after(() => page.restore());
  const { document } = page;
  // Both feeds are held open — the block is waiting on the pair of them, so
  // releasing one of the two would leave the load pending forever.
  const waiting = [];
  const { calls, fetcher } = githubReader(() => () => new Promise((resolve) => { waiting.push(resolve); }));
  wireActivityControls(document, fetcher);

  const loading = loadActivity(document, fetcher, page.storage);
  await waitForState(document, (name) => name === "recorded", "the dated count painted under the live request");

  const asked = calls.length;
  assertRetryWithdrawn(document, "a request already in flight");
  // Pressed anyway — a control that is merely hidden is still clickable, and the
  // guard that matters is the one in the code, not the one in the stylesheet.
  document.querySelector("#retry-merged-count").click();
  await settle();
  assert.equal(calls.length, asked, "a press while the page is already asking started a second request");
  assert.equal(figureOf(document).figure.dataset.state, "recorded",
    "and it did not take the dated count off the page either");

  // Once that request has answered, the block is back to being askable.
  waiting.forEach((resolve) => resolve({ ok: false, status: 503 }));
  await loading;
  await settle();
  assert.equal(figureOf(document).figure.dataset.state, "recorded",
    "a browser that has a dated count keeps showing it when GitHub does not answer");
  assertRetryOffered(document, "a request that has settled on a dated count");
});

/* ------------------------------ announcements ------------------------------ */

test("each state the block passes through is announced exactly once", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  const { readout } = figureOf(document);

  // The readout is the block's one live region, so every announcement a reader
  // hears is one replacement of its contents. Recording them is therefore
  // recording the announcements themselves, in order.
  const announced = [];
  const replace = readout.replaceChildren.bind(readout);
  readout.replaceChildren = (...nodes) => {
    announced.push(nodes.map((node) => textOf(node)).join(" "));
    return replace(...nodes);
  };

  let github = feedsReject;
  const { fetcher } = githubReader(() => github());
  wireActivityControls(document, fetcher);

  await loadActivity(document, fetcher, page.storage);
  await settle();
  // Loading, then what the request turned out to be: one announcement each, and
  // no third one from a control or a container repainting beside them.
  assert.equal(announced.length, 2, `the first load announced: ${JSON.stringify(announced)}`);
  assert.match(announced[0], /^Loading the merged pull request count/);
  assert.match(announced[1], /unavailable/i);

  github = feedsAnswer;
  document.querySelector("#retry-merged-count").click();
  await waitForState(document, (name) => name === "live", "the retry reached a live count");
  await settle();

  // And the retry is the same two: back to loading, then the count it reached.
  assert.equal(announced.length, 4, `the retry announced: ${JSON.stringify(announced)}`);
  assert.match(announced[2], /^Loading the merged pull request count/);
  assert.match(announced[3], /^3merged pull requests Counted from 3 public GitHub events/);

  // No state is announced twice, and none of them is announced by a second
  // region: a repaint that would say what is already on screen is not made.
  for (let index = 1; index < announced.length; index += 1) {
    assert.notEqual(announced[index], announced[index - 1], `state ${index} was announced twice`);
  }
  assert.equal(figureOf(document).figure.querySelectorAll("[aria-live]").length, 1);
  assert.equal(readout.querySelectorAll("button").length, 0,
    "the retry must not be rebuilt inside the announcement it belongs beside");
});
