// The observatory's count, as something a reader can repeat out loud — #2376.
//
// The figure is the one number on this site that was not invented, so it is the
// one number a reader will quote somewhere else. A quoted figure travels without
// the page around it, which makes the label beside it the whole of what travels
// with it: how many merges, observed in what, for which repositories, retrieved
// when. What is pinned here is that all four of those are readable from the
// block as it stands, and that the block never offers a digit it cannot say all
// four things about.
//
// The state model itself (live / recorded / unavailable, and which failure earns
// which clause) belongs to tests/agent-observatory-merged-figure.test.js and
// tests/agent-observatory-merged-outcomes.test.js. This file is about what the
// two states that CAN be quoted say, and what the one that cannot says instead.
//
// Every fetcher here is a stub: loadPage's own fetch throws on any route a test
// did not declare, so nothing in this file reaches GitHub.

import assert from "node:assert/strict";
import test from "node:test";
import { loadActivity } from "../src/agents.js";
import { EVENTS_URLS, SOURCE_REPOSITORIES, feedLinkText } from "../src/public-merges.js";
import { loadPage, tabSequence, textOf } from "./support/browser.js";

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";
const RETRIEVED_AT = new Date(RESPONSE_DATE);

// The un-awaited published-record read inside loadActivity resolves on the
// microtask queue, so a settled block is one that has been given those turns.
const settle = async () => { for (let turn = 0; turn < 4; turn += 1) await Promise.resolve(); };

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

// Only the GitHub feeds answer, and only one of them carries the fixture, so a
// doubled payload cannot quietly double the count. The published record is
// simply not found, which leaves this browser — which has never stored one —
// with nothing to fall back to.
const githubAnswers = async (url) => (url.includes("api.github.com")
  ? okResponse(url.includes("paint-lab") ? MERGES : [])
  : { ok: false, status: 404 });

const githubSilent = async (url) => {
  if (url.includes("api.github.com")) throw new Error("offline");
  return { ok: false, status: 404 };
};

/** The block's own sources list, and the readout that a response replaces. */
const figureOf = (document) => ({
  figure: document.querySelector("#merged-figure"),
  readout: document.querySelector("#merged-figure-readout"),
  sources: document.querySelector(".merged-figure-sources"),
});

/**
 * The proof a reader clicks, in the block they read the number in.
 *
 * "Adjacent" is structural, not visual: the links have to hang off the block
 * itself rather than off the readout a response replaces, they must not be
 * folded into a disclosure element, and they must still be tab-reachable after
 * whatever just painted. A state that takes any of that away leaves a reader
 * holding a number with no way to check it.
 */
function assertEvidenceAdjacent(document, what) {
  const { figure, readout, sources } = figureOf(document);
  assert.equal(sources.parentNode.id, "merged-figure", `${what}: the feed links left the figure's block`);
  assert.equal(readout.querySelectorAll("a").length, 0, `${what}: the feed links moved inside the readout`);
  assert.equal(figure.querySelectorAll("details").length, 0, `${what}: the block grew a disclosure`);

  const links = sources.querySelectorAll("a");
  assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS,
    `${what}: the links no longer go to the responses the count came from`);
  assert.deepEqual(links.map(textOf), SOURCE_REPOSITORIES.map(feedLinkText),
    `${what}: the links no longer say what there is to count and where`);

  const sequence = tabSequence(document);
  for (const link of links) assert.ok(sequence.includes(link), `${what}: ${textOf(link)} is not keyboard-reachable`);
}

test("a loaded count says what it counted, in what, and for which repositories", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, githubAnswers, page.storage);
  await settle();

  const { figure, readout } = figureOf(document);
  assert.equal(figure.dataset.state, "live");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");
  assert.equal(textOf(document.querySelector(".merged-figure-unit")), "merged pull requests");

  // The scope travels with the digit: the response it was counted out of, the
  // repositories that response was returned for, and the refusal of the reading
  // a quoted number invites — that this is everything these repositories have
  // ever merged. All of it is beside the figure, in the block's own words.
  const source = textOf(document.querySelector(".merged-figure-source"));
  assert.match(source, /Counted from 3 public GitHub events returned for/,
    "the label does not say how much activity the count was taken out of");
  for (const repository of SOURCE_REPOSITORIES) {
    assert.ok(source.includes(repository), `${repository} is not named beside the figure`);
  }
  assert.match(source, /Merged pull requests in that returned activity, not an all-time total\./,
    "the label lets the figure be read as an all-time delivery total");

  // And it is one readable block of text, not a tooltip, a title, or a second
  // region: the readout a screen reader announces carries the whole of it.
  assert.ok(textOf(readout).includes(source), "the scope is not in the announced readout");
  assert.equal(readout.querySelectorAll("[title]").length, 0, "part of the scope is hidden in a title");
});

test("the retrieval time is readable as a date and a clock, and machine-readable beside it", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, githubAnswers, page.storage);
  await settle();

  const stamp = document.querySelector(".merged-figure-time");
  const readable = textOf(stamp);

  // The instant is the response's own, whole, on the element a machine reads.
  assert.equal(stamp.dateTime, RETRIEVED_AT.toISOString(),
    "the stamp is not the moment the counted response was retrieved");

  // What a person reads is that same instant placed on the calendar — a stamp
  // that says only "14:32" is one a reader can repeat but cannot date, which is
  // the whole of what a quotable observation window needs.
  const clockOnly = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(RETRIEVED_AT);
  assert.ok(readable.includes(clockOnly), `the stamp dropped the clock: ${readable}`);
  assert.notEqual(readable, clockOnly, "the stamp is a clock with no day behind it");
  assert.ok(readable.includes(String(RETRIEVED_AT.getFullYear())), `the stamp names no year: ${readable}`);
  assert.ok(readable.includes(String(RETRIEVED_AT.getDate())), `the stamp names no calendar day: ${readable}`);

  // Rendered, not authored: nothing about the retrieval moment is a constant in
  // the shipped markup that a real response could disagree with.
  assert.ok(textOf(document.querySelector(".merged-figure-source")).includes(readable),
    "the time a reader reads is not part of the sentence beside the figure");

  assertEvidenceAdjacent(document, "a live count");
});

test("a count that could not be retrieved is unavailable, never a number", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, githubSilent, page.storage);
  await settle();

  const { figure, readout } = figureOf(document);
  assert.equal(figure.dataset.state, "unavailable");

  // No zero, no dash, no stale digit, and no stamp element left behind saying
  // when a number that is not on screen was taken.
  assert.doesNotMatch(textOf(readout), /\d/, "a digit a reader could quote as the count survived the failure");
  assert.equal(figure.querySelectorAll(".merged-figure-count").length, 0);
  assert.equal(figure.querySelectorAll(".merged-figure-time").length, 0);
  assert.equal(figure.querySelectorAll(".merged-figure-recorded-date").length, 0);

  // It says so in words, and it is not still claiming to be on its way.
  assert.match(textOf(readout), /^Public GitHub activity unavailable\./);
  assert.doesNotMatch(textOf(readout), /Loading|Counting/i, "a request that failed is not still running");

  // The state change lands in the region the page already announces updates in
  // — one of them, so a reader hears the outcome once — and the proof a reader
  // most needs when there is no number is still one tab away.
  assert.equal(readout.getAttribute("role"), "status");
  assert.equal(readout.getAttribute("aria-live"), "polite");
  assert.equal(figure.querySelectorAll("[aria-live]").length, 1);
  assertEvidenceAdjacent(document, "a count that could not be retrieved");
});

test("a failed refresh takes the previous count and its window off the page together", async (t) => {
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, githubAnswers, page.storage);
  await settle();
  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");

  // The same browser, now rate-limited. It has a stored count from the response
  // above, so what it may show is that count WITH the date it was taken — never
  // the live label, whose window belongs to a response that is gone.
  await loadActivity(document, async (url) => (url.includes("api.github.com")
    ? { ok: false, status: 403 }
    : { ok: false, status: 404 }), page.storage);
  await settle();

  const { figure } = figureOf(document);
  const source = textOf(document.querySelector(".merged-figure-source"));
  assert.equal(figure.dataset.state, "recorded", "a stored count is what a rate-limited reload has to show");
  assert.doesNotMatch(source, /Counted from/,
    "the previous response's observation window outlived the response");
  assert.match(source, /did not answer just now/, "a stored count is not labelled as a live one");
  assert.ok(SOURCE_REPOSITORIES.every((repository) => source.includes(repository)),
    "the stored count names neither repository it was counted from");
  assertEvidenceAdjacent(document, "a stored count");
});
