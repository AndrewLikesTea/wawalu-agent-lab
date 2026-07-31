// The observatory's merged count when GitHub does not answer.
//
// The page requests the public GitHub events feed unauthenticated, so being
// rate-limited is the ordinary case, not the edge one. What is pinned here is
// that a rate-limited visitor still reads a number and can still tell which
// number it is: the live count is undated, the recorded count always carries
// the date it was taken, and "nothing has ever been recorded" is one sentence
// with no digit in it. All three keep the verification links beside them.
//
// The recorder is pinned to one rule: it writes only what GitHub actually
// returned. Every failure path leaves the previous record byte-for-byte intact.
//
// Every GitHub call in this file is a mock. Nothing here opens a socket.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  EVENTS_URLS,
  RECORDED_COUNT_URL,
  formatRecordedDate,
  loadActivity,
  parseRecordedCount,
  renderMergedFigure,
} from "../src/agents.js";
import { recordMergedCount } from "../scripts/record-merged-count.mjs";
import { createElement, first, installDocument } from "./support/dom.js";
import { loadPage, textOf } from "./support/browser.js";

installDocument();

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const RECORD_URL = new URL("../src/merged-pull-request-count.json", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";
const RECORDED = Object.freeze({ schemaVersion: 1, count: 412, takenAt: "2026-07-14T09:15:00.000Z" });

function pullRequestEvent({ number, merged, action = "closed" }) {
  return {
    id: String(number),
    type: "PullRequestEvent",
    created_at: "2025-07-30T14:00:00Z",
    payload: {
      action,
      pull_request: {
        number,
        merged,
        title: `Pull request ${number}`,
        html_url: `https://github.com/AndrewLikesTea/paint-lab/pull/${number}`,
        head: { ref: "agent/backend/recorded-count" },
      },
    },
  };
}

// Three merges among four live events.
const LIVE_EVENTS = [
  pullRequestEvent({ number: 201, merged: true }),
  pullRequestEvent({ number: 202, merged: true }),
  pullRequestEvent({ number: 203, merged: false }),
  pullRequestEvent({ number: 204, merged: true }),
];

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === "date" ? RESPONSE_DATE : null) },
  json: async () => payload,
});

const RATE_LIMITED = { ok: false, status: 403 };

// The page does not make the live request wait on the record — one static file
// may never hold up the count, the rows, or the status card — so the record can
// land a tick after a fast failure. Every mock here settles in microtasks, so
// one turn of the loop drains all of them.
const flush = () => new Promise((done) => { setImmediate(done); });

/**
 * One fetcher for both destinations the page reads: the published record and
 * the public GitHub feeds. Each side is given explicitly, so no test can be
 * green because a request silently reached the other one — or the network.
 */
function observatoryFetcher({ record, github }) {
  return async (url, ...rest) => {
    const target = String(url);
    if (target.includes("merged-pull-request-count")) {
      assert.equal(rest.length, 0, "the record is read as a plain same-origin GET");
      return typeof record === "function" ? record() : record;
    }
    assert.ok(EVENTS_URLS.includes(target), `unexpected request in a test: ${target}`);
    return typeof github === "function" ? github(target) : github;
  };
}

const feed = (payload) => (url) => okResponse(url.includes("paint-lab") ? payload : []);

function observatoryRoot() {
  const nodes = {
    "#activity-list": createElement("ol"),
    "#activity-status": createElement("div"),
    ".signal-card": createElement("div"),
    "#connection-label": createElement("strong"),
    "#last-updated": createElement("span"),
    "#refresh-activity": createElement("button"),
    "#merged-figure": createElement("section"),
    "#merged-figure-readout": createElement("div"),
  };
  nodes["#activity-list"].querySelector = () => null;
  return { nodes, querySelector: (selector) => nodes[selector] ?? null };
}

test("a live response shows the live count and no recorded date, even with a record on file", async () => {
  const root = observatoryRoot();
  await loadActivity(root, observatoryFetcher({
    record: () => okResponse(RECORDED),
    github: feed(LIVE_EVENTS),
  }));
  // A record that lands after the live count may not overwrite it.
  await flush();
  const readout = root.nodes["#merged-figure-readout"];

  assert.equal(root.nodes["#merged-figure"].dataset.state, "live");
  assert.equal(first(readout, "merged-figure-count").textContent, "3", "the live response wins over the record");
  // The as-of date label is gone from the figure entirely, not hidden or greyed:
  // no element, and no date anywhere in the text a reader can see.
  assert.equal(first(readout, "merged-figure-recorded-date"), null);
  assert.doesNotMatch(readout.textContent, /\d{4}-\d{2}-\d{2}/, "a live count carries no recorded date");
  assert.doesNotMatch(readout.textContent, /412/, "the recorded count is not shown beside a live one");
});

test("a rate-limited response shows the recorded count and the date it was taken", async () => {
  for (const [name, github] of Object.entries({
    "rate limiting": () => RATE_LIMITED,
    "a non-OK status": () => ({ ok: false, status: 503 }),
    "a network failure": () => { throw new Error("offline"); },
    "a response carrying nothing countable": () => okResponse([]),
  })) {
    const root = observatoryRoot();
    await loadActivity(root, observatoryFetcher({ record: () => okResponse(RECORDED), github }));
    await flush();
    const readout = root.nodes["#merged-figure-readout"];

    assert.equal(root.nodes["#merged-figure"].dataset.state, "recorded", name);
    assert.equal(first(readout, "merged-figure-count").textContent, "412", name);
    assert.equal(first(readout, "merged-figure-unit").textContent, "merged pull requests", name);
    // Visible text, not a title, a tooltip, or a disclosure: the date is read
    // off the page as it stands.
    const date = first(readout, "merged-figure-recorded-date");
    assert.equal(date.textContent, "2026-07-14", name);
    assert.equal(date.dateTime, RECORDED.takenAt, name);
    assert.match(readout.textContent, /as of/, name);
    assert.match(readout.textContent, /2026-07-14/, `${name}: the date is part of what is rendered`);
    assert.doesNotMatch(readout.textContent, /Counting/, `${name}: a failed request is not still loading`);
  }
});

test("the recorded count keeps the GitHub feed links beside it on the shipped page", async (t) => {
  const page = await loadPage(PAGE_URL);
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, observatoryFetcher({
    record: () => okResponse(RECORDED),
    github: () => RATE_LIMITED,
  }));
  await flush();

  const figure = document.querySelector("#merged-figure");
  assert.equal(figure.dataset.state, "recorded");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "412");
  assert.equal(textOf(document.querySelector(".merged-figure-unit")), "merged pull requests");
  assert.match(textOf(figure), /as of 2026-07-14/);
  assert.deepEqual(figure.querySelectorAll("a").map((link) => link.href), EVENTS_URLS,
    "a reader can still check the count at the source it came from");
});

test("no record and no answer is one sentence, no figure, and the links stay", async (t) => {
  const page = await loadPage(PAGE_URL);
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, observatoryFetcher({
    record: () => ({ ok: false, status: 404 }),
    github: () => RATE_LIMITED,
  }));

  const figure = document.querySelector("#merged-figure");
  const readout = document.querySelector("#merged-figure-readout");
  assert.equal(figure.dataset.state, "unavailable");
  assert.doesNotMatch(textOf(readout), /\d/, "no digit stands in for a count that was never recorded");
  assert.doesNotMatch(textOf(readout), /Counting|—|--/, "no spinner, no dash");
  assert.match(textOf(readout), /no count has been recorded from it yet\.$/);
  assert.equal(readout.querySelectorAll("p").length, 1, "exactly one sentence");
  assert.deepEqual(figure.querySelectorAll("a").map((link) => link.href), EVENTS_URLS);
});

test("an unreadable or half-written record is no record at all", async () => {
  const rejected = [
    undefined,
    null,
    {},
    { count: 412 },
    { takenAt: RECORDED.takenAt },
    { count: "412", takenAt: RECORDED.takenAt },
    { count: 41.2, takenAt: RECORDED.takenAt },
    { count: -1, takenAt: RECORDED.takenAt },
    { count: 412, takenAt: "" },
    { count: 412, takenAt: "sometime last week" },
    { count: 412, takenAt: null },
  ];
  for (const payload of rejected) {
    assert.equal(parseRecordedCount(payload), null, JSON.stringify(payload) ?? "undefined");
  }

  // A recorded zero is a real answer GitHub can give, and is not "no record".
  const zero = parseRecordedCount({ count: 0, takenAt: RECORDED.takenAt });
  assert.equal(zero.count, 0);
  assert.equal(zero.takenAt.toISOString(), RECORDED.takenAt);
  assert.equal(formatRecordedDate(zero.takenAt), "2026-07-14");

  // And a record the page cannot date is never rendered as a number.
  const root = observatoryRoot();
  renderMergedFigure(root, "recorded", { count: 412, takenAt: new Date("nonsense") });
  assert.equal(root.nodes["#merged-figure"].dataset.state, "unavailable");
  assert.equal(first(root.nodes["#merged-figure-readout"], "merged-figure-count"), null);
});

test("a garbled record file falls through to the sentence rather than throwing", async () => {
  const root = observatoryRoot();
  await loadActivity(root, observatoryFetcher({
    record: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("not JSON"); } }),
    github: () => RATE_LIMITED,
  }));

  assert.equal(root.nodes["#merged-figure"].dataset.state, "unavailable");
  assert.doesNotMatch(root.nodes["#merged-figure-readout"].textContent, /\d/);
});

test("the record is read before the live request resolves, so a spinner is never the answer", async () => {
  const root = observatoryRoot();
  let answer;
  const pending = new Promise((resolve_) => { answer = resolve_; });
  const load = loadActivity(root, observatoryFetcher({
    record: () => okResponse(RECORDED),
    github: (url) => (url.includes("paint-lab") ? pending : okResponse([])),
  }));

  // The record has answered and GitHub has not: the reader is already looking at
  // a dated number rather than "Counting…".
  await new Promise((tick) => setImmediate(tick));
  assert.equal(root.nodes["#merged-figure"].dataset.state, "recorded");
  assert.equal(first(root.nodes["#merged-figure-readout"], "merged-figure-count").textContent, "412");

  // And GitHub answering upgrades it to the live count.
  answer(okResponse(LIVE_EVENTS));
  await load;
  assert.equal(root.nodes["#merged-figure"].dataset.state, "live");
  assert.equal(first(root.nodes["#merged-figure-readout"], "merged-figure-count").textContent, "3");
});

test("the page reads the record from its own origin", () => {
  assert.equal(RECORDED_COUNT_URL, "/merged-pull-request-count.json");
  assert.ok(RECORDED_COUNT_URL.startsWith("/"), "a same-origin path, so the fallback cannot be rate-limited");
});

test("the record published with the repository is either a real record or none", async () => {
  const payload = JSON.parse(await readFile(RECORD_URL, "utf8"));
  assert.equal(payload.schemaVersion, 1);
  const record = parseRecordedCount(payload);
  if (record === null) {
    // Never recorded is a state, spelled out rather than left to an absent key.
    assert.equal(payload.count, null);
    assert.equal(payload.takenAt, null);
  } else {
    assert.ok(Number.isInteger(record.count) && record.count >= 0);
    assert.equal(record.takenAt.toISOString(), payload.takenAt, "the date is ISO-8601 as stored");
  }
});

// --- The recorder ----------------------------------------------------------

async function recordFile(t, contents) {
  const directory = await mkdtemp(resolve(tmpdir(), "merged-count-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, "merged-pull-request-count.json");
  await writeFile(path, contents);
  return path;
}

const UNRECORDED = `${JSON.stringify({ schemaVersion: 1, count: null, takenAt: null }, null, 2)}\n`;

test("the recorder writes the count GitHub returned, with that response's own date", async (t) => {
  const path = await recordFile(t, UNRECORDED);
  const result = await recordMergedCount({ fetcher: async (url) => feed(LIVE_EVENTS)(url), path });

  assert.equal(result.written, true);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    schemaVersion: 1,
    count: 3,
    takenAt: new Date(RESPONSE_DATE).toISOString(),
  });
  assert.equal(result.record.count, 3);
});

test("the recorder writes nothing on a failed, rate-limited, or empty response", async (t) => {
  const failures = {
    "rate limiting": async () => RATE_LIMITED,
    "a non-OK status": async () => ({ ok: false, status: 503 }),
    "a network failure": async () => { throw new Error("offline"); },
    "an unreadable payload": async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("not JSON"); } }),
    "a payload with nothing countable": async () => okResponse([]),
    "a payload of synthetic-looking records": async () => okResponse([{ persona: "Sam · Manager", type: "PullRequestEvent", created_at: "2025-07-30T14:00:00Z", payload: { action: "closed", pull_request: { merged: true } } }]),
  };

  // The previously recorded value has to survive every one of them, unchanged.
  const previous = `${JSON.stringify({ schemaVersion: 1, count: 412, takenAt: RECORDED.takenAt }, null, 2)}\n`;
  for (const [name, fetcher] of Object.entries(failures)) {
    const path = await recordFile(t, previous);
    const result = await recordMergedCount({ fetcher, path });

    assert.equal(result.written, false, name);
    assert.ok(result.reason, `${name}: the reason is reported, not swallowed`);
    assert.equal(await readFile(path, "utf8"), previous, `${name}: the recorded value is untouched`);
  }

  // And a never-recorded file stays never-recorded rather than gaining a zero.
  const fresh = await recordFile(t, UNRECORDED);
  await recordMergedCount({ fetcher: async () => RATE_LIMITED, path: fresh });
  assert.equal(await readFile(fresh, "utf8"), UNRECORDED);
});

test("the recorder counts merges only, from the live records of the feeds the page reads", async (t) => {
  const path = await recordFile(t, UNRECORDED);
  const requested = [];
  await recordMergedCount({
    fetcher: async (url, options) => {
      requested.push(url);
      assert.equal(options.headers.Accept, "application/vnd.github+json");
      return okResponse(url.includes("paint-lab")
        ? [pullRequestEvent({ number: 1, merged: true }), pullRequestEvent({ number: 2, merged: false })]
        : [pullRequestEvent({ number: 3, merged: true }), pullRequestEvent({ number: 4, merged: true, action: "opened" })]);
    },
    path,
  });

  assert.deepEqual(requested, EVENTS_URLS, "the recorder reads exactly the feeds the figure links to");
  assert.equal(JSON.parse(await readFile(path, "utf8")).count, 2);
});

test("one repository answering is still a real count", async (t) => {
  const path = await recordFile(t, UNRECORDED);
  const result = await recordMergedCount({
    fetcher: async (url) => (url.includes("paint-lab") ? okResponse(LIVE_EVENTS) : RATE_LIMITED),
    path,
  });

  assert.equal(result.written, true, "a count from the feeds that answered is still counted from GitHub");
  assert.equal(JSON.parse(await readFile(path, "utf8")).count, 3);
});
