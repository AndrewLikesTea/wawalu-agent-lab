// The counted block's memory, and the promise that goes with it.
//
// The one number this site offers as checkable used to go blank whenever public
// GitHub declined to answer — which, unauthenticated, is often. It now shows the
// last count this browser saw GitHub return. That is only honest under rules,
// and this file is those rules:
//
//   a live count is shown with the moment the response arrived, and written to
//   storage;
//   a retained count is shown ONLY with the words saying GitHub did not answer
//   and with the date and time it was taken;
//   anything storage cannot be trusted to hold — absent, unparseable, the wrong
//   shape, the wrong schema, a fractional or negative count, an undated one — is
//   treated as nothing stored, and the block falls back to its honest empty
//   sentences with no digit anywhere in it;
//   and the two feed links a reader checks the number against survive all of it.
//
// Every fetch and every storage here is a stub. Nothing in this file reaches the
// network or a real browser store.

import assert from "node:assert/strict";
import test from "node:test";
import { loadActivity } from "../src/agents.js";
import { EVENTS_URLS, UNAVAILABLE_REASONS, unavailableSentences } from "../src/public-merges.js";
import {
  RETAINED_COUNT_KEY,
  RETAINED_COUNT_SCHEMA,
  RETAINED_LEAD,
  mostRecentRecord,
  readRetainedCount,
  writeRetainedCount,
} from "../src/merged-count-retention.js";
import { loadPublicMerges, renderPublicMerges } from "../src/public-merges-view.js";
import { loadPage, textOf } from "./support/browser.js";
import { createElement, installDocument, tags } from "./support/dom.js";

installDocument();

const HOME_URL = new URL("../src/index.html", import.meta.url);
const OBSERVATORY_URL = new URL("../src/agents.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";
const RESPONSE_ISO = "2025-07-30T14:32:00.000Z";
const RETAINED_ISO = "2026-07-14T09:05:00.000Z";

const mergeEvent = (number) => ({
  id: String(number),
  type: "PullRequestEvent",
  created_at: "2025-07-30T14:00:00Z",
  payload: {
    action: "closed",
    pull_request: {
      number, merged: true, title: `Pull request ${number}`,
      html_url: `https://github.com/AndrewLikesTea/paint-lab/pull/${number}`,
      head: { ref: "agent/frontend/retained-count" },
    },
  },
});

// Three merges, so a rendered "3" can only have come from this fixture.
const LIVE_EVENTS = [mergeEvent(101), mergeEvent(102), mergeEvent(103)];

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === "date" ? RESPONSE_DATE : null) },
  json: async () => payload,
});

// GitHub answers with the fixture on one feed and nothing on the other; the
// observatory's published record file is simply not there, so the only count a
// failed request can fall back to is the retained one this file is about.
const answering = async (url) => (url.includes("api.github.com")
  ? okResponse(url.includes("paint-lab") ? LIVE_EVENTS : [])
  : { ok: false, status: 404 });
const rateLimited = async (url) => (url.includes("api.github.com")
  ? { ok: false, status: 403 }
  : { ok: false, status: 404 });

const stored = (value) => ({ [RETAINED_COUNT_KEY]: value });
const retainedJson = (count = 412, takenAt = RETAINED_ISO) =>
  JSON.stringify({ schemaVersion: RETAINED_COUNT_SCHEMA, count, takenAt });

/** A storage stand-in that records what it was asked to keep. */
function fakeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

const feedLinks = (document) => document.querySelector("#public-merges-sources").querySelectorAll("a");
const readoutOf = (document) => document.querySelector("#public-merges-readout");
const flush = () => new Promise((resolve) => setImmediate(resolve));

// --- the home page ---------------------------------------------------------

test("a live count is shown with the moment it was taken, and remembered", async (t) => {
  const page = await loadPage(HOME_URL, {});
  t.after(() => page.restore());
  await loadPublicMerges(page.document, answering, page.storage);

  const section = page.document.querySelector("#public-merges");
  const readout = readoutOf(page.document);
  assert.equal(section.dataset.state, "live");
  assert.match(textOf(readout), /^3 merged pull requests/);

  // The age is legible to a reader and parseable by a machine, in one element.
  const [stamp, ...extra] = readout.querySelectorAll("time");
  assert.equal(extra.length, 0, "one figure, one timestamp");
  assert.equal(textOf(stamp), "2025-07-30");
  assert.equal(stamp.dateTime, RESPONSE_ISO);
  assert.match(textOf(readout), /as of 2025-07-30 at 14:32 UTC\./);
  // A live count is a live count: it does not carry the retained wording.
  assert.doesNotMatch(textOf(readout), /did not answer/);

  // And it is what the next visit will have to fall back on.
  assert.deepEqual(JSON.parse(page.storage.getItem(RETAINED_COUNT_KEY)),
    { schemaVersion: RETAINED_COUNT_SCHEMA, count: 3, takenAt: RESPONSE_ISO });
  assert.deepEqual(feedLinks(page.document).map((link) => link.getAttribute("href")), EVENTS_URLS);
});

test("a failed request shows the retained count, says it is not live, and dates it", async (t) => {
  const page = await loadPage(HOME_URL, { storage: stored(retainedJson()) });
  t.after(() => page.restore());
  const result = await loadPublicMerges(page.document, rateLimited, page.storage);

  assert.equal(result.ok, false, "nothing about this run reached a live count");
  const section = page.document.querySelector("#public-merges");
  const readout = readoutOf(page.document);
  assert.equal(section.dataset.state, "retained");

  // The figure, and then — in the same status region, in plain words a reader
  // gets at a glance — that GitHub did not answer and when this number is from.
  const [figure, sentence] = readout.querySelectorAll("p").map(textOf);
  assert.equal(figure, "412 merged pull requests");
  assert.equal(sentence, `${RETAINED_LEAD}2026-07-14 at 09:05 UTC.`.replace(/\s+/g, " ").trim());
  assert.match(sentence, /did not answer just now/);
  assert.match(sentence, /last count/);

  const [stamp] = readout.querySelectorAll("time");
  assert.equal(textOf(stamp), "2026-07-14");
  assert.equal(stamp.dateTime, RETAINED_ISO);

  // Nothing about a stale number is folded away or hover-only.
  assert.equal(section.querySelectorAll("details").length, 0, "the stale wording is not behind a disclosure");
  assert.equal(readout.querySelectorAll("time").filter((node) => node.getAttribute("title")).length, 0);
  assert.equal(readout.getAttribute("aria-live"), "polite", "the change is announced");
  assert.equal(readout.getAttribute("role"), "status");

  // A failed request may not overwrite what it failed to replace.
  assert.equal(page.storage.getItem(RETAINED_COUNT_KEY), retainedJson());
  assert.deepEqual(feedLinks(page.document).map((link) => link.getAttribute("href")), EVENTS_URLS);
});

test("a retained zero is a real answer and is shown like any other count", async (t) => {
  const page = await loadPage(HOME_URL, { storage: stored(retainedJson(0)) });
  t.after(() => page.restore());
  await loadPublicMerges(page.document, rateLimited, page.storage);

  assert.equal(page.document.querySelector("#public-merges").dataset.state, "retained");
  assert.match(textOf(readoutOf(page.document)), /^0 merged pull requests/);
});

test("a failed request with nothing stored keeps the honest empty wording", async (t) => {
  const page = await loadPage(HOME_URL, {});
  t.after(() => page.restore());
  await loadPublicMerges(page.document, rateLimited, page.storage);

  const section = page.document.querySelector("#public-merges");
  assert.equal(section.dataset.state, "unavailable");
  assert.match(textOf(section), /rate limiting this page's unauthenticated requests, so there is no count to show\./);
  // No zero, no dash, no seeded constant: the whole block holds no numeral.
  assert.doesNotMatch(textOf(section), /\d/, "something a reader could read as a count was invented");
  assert.equal(readoutOf(page.document).querySelectorAll("time").length, 0);
  assert.deepEqual(feedLinks(page.document).map((link) => link.getAttribute("href")), EVENTS_URLS);
});

// Every way a stored value can be untrustworthy. All of them mean the same
// thing: this browser has never counted, so the block says so and shows nothing.
const UNUSABLE = {
  "not JSON at all": "{ count: 412 ",
  "an empty string": "",
  "a JSON array": JSON.stringify([{ count: 412, takenAt: RETAINED_ISO }]),
  "a JSON string": JSON.stringify("412"),
  "a JSON null": JSON.stringify(null),
  "no schema version": JSON.stringify({ count: 412, takenAt: RETAINED_ISO }),
  "a schema this version does not know": JSON.stringify({ schemaVersion: 99, count: 412, takenAt: RETAINED_ISO }),
  "a count with no time": JSON.stringify({ schemaVersion: 1, count: 412 }),
  "a time with no count": JSON.stringify({ schemaVersion: 1, takenAt: RETAINED_ISO }),
  "a count written as text": JSON.stringify({ schemaVersion: 1, count: "412", takenAt: RETAINED_ISO }),
  "a fractional count": JSON.stringify({ schemaVersion: 1, count: 41.2, takenAt: RETAINED_ISO }),
  "a negative count": JSON.stringify({ schemaVersion: 1, count: -1, takenAt: RETAINED_ISO }),
  "an unparseable time": JSON.stringify({ schemaVersion: 1, count: 412, takenAt: "sometime last week" }),
  "a time that is not a string": JSON.stringify({ schemaVersion: 1, count: 412, takenAt: 1752483900000 }),
};

for (const [what, value] of Object.entries(UNUSABLE)) {
  test(`${what} in storage is nothing stored`, async (t) => {
    assert.equal(readRetainedCount(fakeStorage(stored(value))), null, `${what} parsed into a figure`);

    const page = await loadPage(HOME_URL, { storage: stored(value) });
    t.after(() => page.restore());
    await loadPublicMerges(page.document, rateLimited, page.storage);

    const section = page.document.querySelector("#public-merges");
    assert.equal(section.dataset.state, "unavailable", what);
    assert.doesNotMatch(textOf(section), /\d/, `${what} became a number on the page`);
    assert.deepEqual(feedLinks(page.document).map((link) => link.getAttribute("href")), EVENTS_URLS, what);
  });
}

test("a browser that refuses storage neither throws nor invents", async (t) => {
  const refusing = {
    getItem() { throw new Error("site data is disabled"); },
    setItem() { throw new Error("site data is disabled"); },
  };
  assert.equal(readRetainedCount(refusing), null);
  assert.equal(writeRetainedCount(refusing, { count: 3, asOf: new Date(RESPONSE_ISO) }), null);
  assert.equal(readRetainedCount(null), null);
  assert.equal(readRetainedCount(undefined), null);

  const page = await loadPage(HOME_URL, {});
  t.after(() => page.restore());
  await loadPublicMerges(page.document, answering, refusing);
  assert.equal(page.document.querySelector("#public-merges").dataset.state, "live",
    "a store that will not answer must not cost the reader the live count");
});

test("only a whole, dated count is ever written", () => {
  const storage = fakeStorage();
  const refused = [
    { count: 3 },
    { count: 3, asOf: new Date("nonsense") },
    { count: 3, asOf: RESPONSE_ISO },
    { count: -1, asOf: new Date(RESPONSE_ISO) },
    { count: 1.5, asOf: new Date(RESPONSE_ISO) },
    { count: "3", asOf: new Date(RESPONSE_ISO) },
    {},
  ];
  for (const attempt of refused) {
    assert.equal(writeRetainedCount(storage, attempt), null, JSON.stringify(attempt));
  }
  assert.equal(storage.values.size, 0, "a figure with no time behind it reached storage");

  // A zero counted from a real response is a real answer, and is kept.
  assert.deepEqual(writeRetainedCount(storage, { count: 0, asOf: new Date(RESPONSE_ISO) }),
    { schemaVersion: RETAINED_COUNT_SCHEMA, count: 0, takenAt: RESPONSE_ISO });
  assert.equal(readRetainedCount(storage).count, 0);
});

test("of two dated counts, the later one is the one a reader is shown", () => {
  const older = { count: 1, takenAt: new Date("2026-07-14T09:05:00.000Z") };
  const newer = { count: 2, takenAt: new Date("2026-08-01T09:05:00.000Z") };
  assert.equal(mostRecentRecord(older, newer).count, 2);
  assert.equal(mostRecentRecord(newer, older).count, 2);
  assert.equal(mostRecentRecord(null, older).count, 1);
  assert.equal(mostRecentRecord(older, null).count, 1);
  assert.equal(mostRecentRecord(null, null), null);
});

// --- the Agent observatory -------------------------------------------------

test("the observatory writes the live count and reads it back when GitHub stops answering", async (t) => {
  const first_ = await loadPage(OBSERVATORY_URL, {});
  t.after(() => first_.restore());
  await loadActivity(first_.document, answering, first_.storage);
  await flush();

  assert.equal(first_.document.querySelector("#merged-figure").dataset.state, "live");
  const kept = JSON.parse(first_.storage.getItem(RETAINED_COUNT_KEY));
  assert.deepEqual(kept, { schemaVersion: RETAINED_COUNT_SCHEMA, count: 3, takenAt: RESPONSE_ISO });

  // The next visit, with the same browser store and a GitHub that declines.
  const later = await loadPage(OBSERVATORY_URL, { storage: stored(JSON.stringify(kept)) });
  t.after(() => later.restore());
  await loadActivity(later.document, rateLimited, later.storage);
  await flush();

  const figure = later.document.querySelector("#merged-figure");
  const readout = later.document.querySelector("#merged-figure-readout");
  assert.equal(figure.dataset.state, "recorded");
  assert.equal(textOf(later.document.querySelector(".merged-figure-count")), "3");
  assert.match(textOf(readout), /did not answer just now, so this is the last count taken from/);
  assert.match(textOf(readout), /as of 2025-07-30 at 14:32 UTC\./);
  const [stamp] = readout.querySelectorAll("time");
  assert.equal(stamp.dateTime, RESPONSE_ISO);
  assert.equal(figure.querySelectorAll("details").length, 0);
  assert.equal(readout.getAttribute("aria-live"), "polite");
  // The feeds a reader checks it against are still beside it.
  assert.deepEqual(figure.querySelectorAll("a").map((link) => link.href), EVENTS_URLS);
});

test("the observatory with an unusable stored value states that nothing was ever counted", async (t) => {
  const page = await loadPage(OBSERVATORY_URL, { storage: stored("{ not json") });
  t.after(() => page.restore());
  await loadActivity(page.document, rateLimited, page.storage);
  await flush();

  const figure = page.document.querySelector("#merged-figure");
  const readout = page.document.querySelector("#merged-figure-readout");
  assert.equal(figure.dataset.state, "unavailable");
  // The same two sentences the home page shows for the same outcome, from the
  // one module that holds them.
  assert.deepEqual(readout.querySelectorAll("p").map(textOf),
    unavailableSentences(UNAVAILABLE_REASONS.rateLimited));
  assert.doesNotMatch(textOf(readout), /\d/, "an unreadable store became a number on the page");
  assert.deepEqual(figure.querySelectorAll("a").map((link) => link.href), EVENTS_URLS);
});

test("the retained figure is on screen before GitHub has answered at all", async (t) => {
  const page = await loadPage(OBSERVATORY_URL, { storage: stored(retainedJson()) });
  t.after(() => page.restore());
  let answer;
  const held = new Promise((resolve) => { answer = resolve; });
  const load = loadActivity(page.document, async (url) => {
    if (url.includes("paint-lab")) return held;
    return url.includes("api.github.com") ? okResponse([]) : { ok: false, status: 404 };
  }, page.storage);

  // No request has resolved, and the block is already a dated number rather
  // than a spinner — which is the whole point of remembering.
  await flush();
  assert.equal(page.document.querySelector("#merged-figure").dataset.state, "recorded");
  assert.equal(textOf(page.document.querySelector(".merged-figure-count")), "412");

  answer(okResponse(LIVE_EVENTS));
  await load;
  assert.equal(page.document.querySelector("#merged-figure").dataset.state, "live");
  assert.equal(textOf(page.document.querySelector(".merged-figure-count")), "3");
  assert.equal(JSON.parse(page.storage.getItem(RETAINED_COUNT_KEY)).count, 3,
    "the live response replaces what the page had remembered");
});

test("a render given a figure with no time behind it refuses to show a number", () => {
  // The dom stub, so this is the render layer alone: no page, no store, no fetch.
  const nodes = {
    "#public-merges": createElement("section"),
    "#public-merges-readout": createElement("div"),
  };
  const root = { nodes, querySelector: (selector) => nodes[selector] ?? null };
  for (const attempt of [
    { ok: true, count: 3 },
    { ok: true, count: 3, asOf: new Date("nonsense") },
    { ok: false, retained: { count: 3, takenAt: "2026-07-14" } },
    { ok: false, retained: { count: 3.5, takenAt: new Date(RETAINED_ISO) } },
  ]) {
    renderPublicMerges(root, attempt);
    assert.equal(nodes["#public-merges"].dataset.state, "unavailable", JSON.stringify(attempt));
    assert.equal(tags(nodes["#public-merges-readout"], "STRONG").length, 0, "an undated figure was rendered");
    assert.equal(tags(nodes["#public-merges-readout"], "TIME").length, 0, "a stamp with no instant behind it");
  }
});
