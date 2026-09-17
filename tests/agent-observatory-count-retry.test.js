// The count's own way back — #2415.
//
// Every other region on the observatory could already be asked again where it
// stood: the personas, the prompt trace, and the activity feed each carry a
// control beside the status it recovers. The headline count did not. A reader
// whose GitHub request failed in the hero — which is where this page puts the
// one number on the site that was not invented — had to find the activity
// panel's button most of a screen below it, or reload the whole page.
//
// What is pinned here is the control and the cycle around it: that a settled
// request with no count offers it, that a response carrying nothing countable is
// the same settled state rather than a zero, that pressing it asks GitHub again
// and paints whatever comes back, that a second failure still leaves no number
// behind, and that the region announces each state once while all of it happens.
//
// The state model itself (which failure earns which clause, what a stored count
// may say) belongs to tests/agent-observatory-merged-figure.test.js and
// tests/agent-observatory-merged-outcomes.test.js. Every fetcher here is a stub:
// loadPage's own fetch throws on any route a test did not declare, so nothing in
// this file reaches GitHub.

import assert from "node:assert/strict";
import test from "node:test";
import { MERGED_FIGURE_RETRY_LABEL, loadActivity, wireActivityControls } from "../src/agents.js";
import { EVENTS_URLS, SOURCE_REPOSITORIES, feedLinkText } from "../src/public-merges.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";

// A macrotask turn drains the microtasks behind it, which is what the published
// record's un-awaited read inside loadActivity resolves on.
const settle = async () => {
  for (let turn = 0; turn < 3; turn += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
};

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

const isFeed = (url) => String(url).includes("api.github.com");

/**
 * A fetcher that answers the feeds differently on each attempt, and counts them.
 *
 * The published record is never found, so a browser that has stored nothing has
 * nothing to fall back to and every failure here lands on the state with no
 * number at all. `feedCalls` is what makes "the retry asked again" checkable:
 * one load requests both feeds, so it moves in twos.
 */
function githubFetcher(...attempts) {
  const calls = { feedCalls: 0, loads: 0 };
  const fetcher = async (url) => {
    if (!isFeed(url)) return { ok: false, status: 404 };
    calls.feedCalls += 1;
    const attempt = attempts[Math.min(calls.loads, attempts.length - 1)];
    // Both feeds of one load are the same attempt; the second of them ends it.
    if (calls.feedCalls % 2 === 0) calls.loads += 1;
    return attempt(url);
  };
  return { calls, fetcher };
}

const refused = () => { throw new Error("offline"); };
const answered = (url) => okResponse(url.includes("paint-lab") ? MERGES : []);

const figureOf = (document) => ({
  figure: document.querySelector("#merged-figure"),
  readout: document.querySelector("#merged-figure-readout"),
  heading: document.querySelector("#merged-figure-title"),
  actions: document.querySelector("#merged-figure-actions"),
  control: document.querySelector("#retry-merged-figure"),
  sources: document.querySelector(".merged-figure-sources"),
});

/**
 * The block holds no number, and still holds its proof.
 *
 * Both halves matter in the same breath: the state with no count is the state
 * where the feed links are the whole of what a reader has, so a failure that
 * cleared the digit and the evidence together would pass a "no digit" check and
 * still leave a reader with nothing.
 */
function assertNoNumberAndStillCheckable(document, what) {
  const { figure, readout, sources } = figureOf(document);
  assert.equal(figure.dataset.state, "unavailable", `${what}: the block is not in its settled empty state`);
  assert.doesNotMatch(textOf(figure), /\d/, `${what}: a digit a reader could quote as the count is on screen`);
  assert.equal(figure.querySelectorAll(".merged-figure-count").length, 0, `${what}: a figure element survived`);
  assert.equal(figure.querySelectorAll(".merged-figure-time").length, 0, `${what}: a live stamp survived`);
  assert.equal(figure.querySelectorAll(".merged-figure-recorded-date").length, 0, `${what}: a stored date survived`);
  assert.match(textOf(readout), /^Public GitHub activity unavailable\./, `${what}: it does not say so in words`);
  assert.doesNotMatch(textOf(readout), /Loading/, `${what}: a settled request still claims to be running`);

  const links = sources.querySelectorAll("a");
  assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS,
    `${what}: the feed links no longer go to the responses the count comes from`);
  assert.deepEqual(links.map(textOf), SOURCE_REPOSITORIES.map(feedLinkText),
    `${what}: the feed links no longer say what there is to count and where`);
  const sequence = tabSequence(document);
  for (const link of links) assert.ok(sequence.includes(link), `${what}: ${textOf(link)} is not keyboard-reachable`);
}

/** The control is on offer, and is the kind of control a keyboard can use. */
function assertRetryOffered(document, what) {
  const { actions, control } = figureOf(document);
  assert.equal(actions.hidden, false, `${what}: the retry is not offered`);
  assert.equal(control.dataset.recovery, "retry", `${what}: the control does not report itself as a recovery`);
  assert.ok(tabSequence(document).includes(control), `${what}: the retry is not in the tab sequence`);
}

/* ------------------------------ the empty states -------------------------- */

test("a request GitHub refused leaves the sentence, the proof, and a way to ask again", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, async (url) => (isFeed(url) ? refused() : { ok: false, status: 404 }), page.storage);
  await settle();

  assertNoNumberAndStillCheckable(document, "a refused request");
  assertRetryOffered(document, "a refused request");
});

test("a non-OK status and a response with nothing countable settle the same way", async (t) => {
  const answers = {
    "a non-OK status": async () => ({ ok: false, status: 503 }),
    // The branch most easily missed: GitHub answered, so nothing threw, and the
    // payload carries nothing to count. That is not a zero — a zero is an answer
    // GitHub can give about merges — so it may not reach the success renderer,
    // and a reader may not be left on a loading line that never resolves.
    "an empty event list": async () => okResponse([]),
    "a payload that is not event data": async () => okResponse({ message: "Not Found" }),
  };

  for (const [what, answer] of Object.entries(answers)) {
    const page = await loadPage(PAGE_URL, { storage: {} });
    try {
      await loadActivity(page.document, async (url) => (isFeed(url) ? answer() : { ok: false, status: 404 }),
        page.storage);
      await settle();

      assertNoNumberAndStillCheckable(page.document, what);
      assertRetryOffered(page.document, what);
    } finally {
      page.restore();
    }
  }
});

/* -------------------------------- the control ----------------------------- */

test("the control is the page's own recovery control, named the way the others are", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  const { figure, control, actions, readout } = figureOf(document);

  // A real button, typed so it cannot submit anything, with the visible words as
  // its accessible name rather than a label only some readers get.
  assert.equal(control.tagName, "BUTTON");
  assert.equal(control.getAttribute("type"), "button");
  assert.equal(control.getAttribute("aria-label"), null);
  assert.equal(textOf(control), MERGED_FIGURE_RETRY_LABEL);
  assert.equal(textOf(control), "Retry the merged pull request count");
  // The construction the page's other recovery controls use: the verb, then the
  // thing it asks for again, so a reader meeting it alone knows which of the
  // four regions on this page it belongs to.
  for (const id of ["retry-merged-figure", "retry-personas", "retry-trace"]) {
    assert.match(textOf(document.querySelector(`#${id}`)), /^Retry \S/,
      `${id}: the page's recovery controls no longer read alike`);
  }

  // It buys no style of its own: src/styles.css and its observatory mirror are
  // both against a hard build-time size gate, so a control that grew a class
  // would have to be paid for in bytes somewhere else.
  assert.equal(control.getAttribute("class"), document.querySelector("#refresh-activity").getAttribute("class"));
  assert.equal(actions.getAttribute("class"), document.querySelector("#persona-actions").getAttribute("class"));

  // Inside the region it recovers, after the status it acts on, and outside the
  // live region: a control that lived in the readout would be replaced by every
  // render, and unhiding it would be an announcement of its own.
  assert.equal(actions.parentNode.id, "merged-figure");
  assert.equal(readout.querySelectorAll("button").length, 0);
  assert.equal(figure.querySelectorAll("[aria-live]").length, 1);

  // Nothing is offered before a request has settled: the shipped page is the
  // loading state, and a retry for a request still in flight is a button that
  // cannot change what is on screen.
  assert.equal(figure.dataset.state, "loading");
  assert.equal(actions.hidden, true);
  assert.equal(tabSequence(document).some((node) => node.id === "retry-merged-figure"), false,
    "a hidden retry is out of the tab sequence too");
});

test("a count that arrived withdraws the control instead of offering a way out of a success", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, async (url) => (isFeed(url) ? answered(url) : { ok: false, status: 404 }), page.storage);
  await settle();

  const { figure, actions, control } = figureOf(document);
  assert.equal(figure.dataset.state, "live");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");
  assert.equal(actions.hidden, true, "a successful count still offers a retry");
  assert.equal(control.dataset.recovery, "none");
});

/* --------------------------- the retry, on the keyboard -------------------- */

test("the retry the keyboard reaches asks GitHub again and paints what it answers with", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  const { calls, fetcher } = githubFetcher(refused, answered);

  const load = wireActivityControls(document, fetcher, page.storage);
  await load();
  await settle();
  assert.equal(calls.feedCalls, 2, "the first load requests both feeds");
  assertNoNumberAndStillCheckable(document, "the first attempt");

  const retry = tabSequence(document).find((node) => node.id === "retry-merged-figure");
  assert.ok(retry, "the retry must be in the tab sequence while it is offered");
  retry.focus();
  pressEnter(document);
  await settle();

  assert.equal(calls.feedCalls, 4, "Enter must re-request the count from both feeds");
  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");
  assert.equal(textOf(document.querySelector(".merged-figure-unit")), "merged pull requests");
  assert.match(textOf(document.querySelector(".merged-figure-source")), /Counted from 3 public GitHub events/);

  // The control the reader was standing on is gone, and they are not at the top
  // of the document: the press put them on the figure's heading, which is where
  // the number they asked for now is.
  assert.equal(figureOf(document).actions.hidden, true);
  assert.equal(tabSequence(document).some((node) => node.id === "retry-merged-figure"), false);
  assert.ok(document.activeElement === figureOf(document).heading,
    "the reader was dropped somewhere other than the block they asked from");
  assert.equal(figureOf(document).heading.getAttribute("tabindex"), "-1",
    "the landing has to be focusable without joining the tab sequence");
});

test("a retry that fails again leaves no number and offers itself again", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  const { calls, fetcher } = githubFetcher(refused);

  const load = wireActivityControls(document, fetcher, page.storage);
  await load();
  await settle();

  const retry = tabSequence(document).find((node) => node.id === "retry-merged-figure");
  retry.focus();
  pressEnter(document);
  await settle();

  assert.equal(calls.feedCalls, 4, "the second attempt was not made");
  assertNoNumberAndStillCheckable(document, "a second failure");
  assertRetryOffered(document, "a second failure");
  // Still one tab stop away from where the press left them.
  const sequence = tabSequence(document);
  assert.ok(sequence.indexOf(figureOf(document).control) > -1);
  assert.ok(document.activeElement === figureOf(document).heading,
    "a second failure moved the reader out of the block they asked from");
});

test("a count that arrived and then a failed retry is not a count that survives", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  // A browser that cannot retain anything, so the second attempt has nothing
  // dated to fall to: what the first attempt painted is all there is, and it may
  // not outlive the response it came from. (A browser that CAN retain shows that
  // count again with the date it was taken and the words saying it is not live —
  // tests/agent-observatory-quotable-count.test.js holds that path.)
  const amnesiac = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { fetcher } = githubFetcher(answered, refused);

  const load = wireActivityControls(document, fetcher, amnesiac);
  await load();
  await settle();
  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");

  await load();
  await settle();
  assertNoNumberAndStillCheckable(document, "a failure after a count");
  assertRetryOffered(document, "a failure after a count");
});

/* ------------------------------ announcements ----------------------------- */

test("loading, the count, and the empty state are each announced once through a retry cycle", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  const readout = document.querySelector("#merged-figure-readout");

  // Every replacement of the live region's contents is one announcement, so
  // counting them is counting what a screen reader is told.
  const announcements = [];
  const replaceChildren = readout.replaceChildren.bind(readout);
  readout.replaceChildren = (...nodes) => {
    announcements.push(nodes.map((node) => node.textContent).join(" ").replace(/\s+/g, " ").trim());
    return replaceChildren(...nodes);
  };

  const { fetcher } = githubFetcher(refused, answered);
  const load = wireActivityControls(document, fetcher, page.storage);
  await load();
  await settle();

  assert.equal(announcements.length, 2, `the first load said: ${JSON.stringify(announcements)}`);
  assert.match(announcements[0], /^Loading the merged pull request count/);
  assert.match(announcements[1], /^Public GitHub activity unavailable\./);

  document.querySelector("#retry-merged-figure").focus();
  pressEnter(document);
  await settle();

  assert.equal(announcements.length, 4, `the retry said: ${JSON.stringify(announcements)}`);
  assert.match(announcements[2], /^Loading the merged pull request count/);
  assert.match(announcements[3], /^3\s*merged pull requests/);
  // No state is said twice in a row: the render refuses to replace the region
  // with the words already in it, so an intermediate paint that lands on the
  // same sentences is not a second announcement of them.
  for (let index = 1; index < announcements.length; index += 1) {
    assert.notEqual(announcements[index], announcements[index - 1], `announced twice: ${announcements[index]}`);
  }
});
