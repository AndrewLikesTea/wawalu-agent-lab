// #3139: settled requests show current evidence or an unavailable metric.
// A silent request has a deadline; saved counts never replace its status.

import assert from "node:assert/strict";
import test from "node:test";
import { loadActivity } from "../src/agents.js";
import {
  EVENTS_URLS,
  SOURCE_REPOSITORIES,
  feedLinkText,
} from "../src/public-merges.js";
import {
  RETAINED_COUNT_KEY,
  RETAINED_COUNT_SCHEMA,
  RETAINED_LEAD,
} from "../src/merged-count-retention.js";
import { loadPublicMerges } from "../src/public-merges-view.js";
import { loadPage, textOf } from "./support/browser.js";

const OBSERVATORY_URL = new URL("../src/agents.html", import.meta.url);
const HOME_URL = new URL("../src/index.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";
const TAKEN_AT = "2026-07-14T09:15:00.000Z";

// The un-awaited published-record read inside loadActivity resolves on the
// microtask queue, so a settled block is one that has been given those turns.
const settle = async () => { for (let turn = 0; turn < 4; turn += 1) await Promise.resolve(); };

// Wait on state the page produces rather than on elapsed time, so a slow machine
// cannot fail this file and a fast one cannot hide a missing paint.
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

// Only the GitHub feeds answer. The published record is simply not found, which
// is what leaves this browser's own stored count — or nothing — as the fallback.
const observatoryFetcher = (github) => async (url) => (
  url.includes("api.github.com") ? github(url) : { ok: false, status: 404 }
);

const liveGithub = observatoryFetcher(async (url) => okResponse(url.includes("paint-lab") ? MERGES : []));
const rateLimited = observatoryFetcher(async () => ({ ok: false, status: 403 }));

const storedCount = (count = 412) => ({
  [RETAINED_COUNT_KEY]: JSON.stringify({ schemaVersion: RETAINED_COUNT_SCHEMA, count, takenAt: TAKEN_AT }),
});

/**
 * The two things that must hold in every outcome, checked in every outcome.
 *
 * A block that has settled says so — no spinner text anywhere inside it, heading
 * and links included — and it still carries both feed links, each still named by
 * the repository it goes to. The error branch replacing the block wholesale and
 * taking the links with it is the failure this guards.
 */
function assertSettledShape(document, what) {
  const figure = document.querySelector("#merged-figure");
  assert.doesNotMatch(textOf(figure), /Loading/,
    `${what}: the settled block still reads "Loading"`);

  const links = figure.querySelector(".merged-figure-sources").querySelectorAll("a");
  assert.equal(links.length, EVENTS_URLS.length, `${what}: a feed link went missing`);
  assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS,
    `${what}: the links no longer go to the responses the count came from`);
  assert.deepEqual(links.map(textOf), SOURCE_REPOSITORIES.map(feedLinkText),
    `${what}: the links no longer say what there is to count and where`);

  // The status stays a live region the resolved text lands in, and neither it
  // nor the links are folded behind a disclosure a real browser would hide.
  const readout = document.querySelector("#merged-figure-readout");
  assert.equal(readout.getAttribute("aria-live"), "polite", `${what}: the status stopped being announced`);
  assert.equal(figure.querySelectorAll("details").length, 0, `${what}: something was folded away`);
  assert.equal(figure.getAttribute("aria-labelledby"), "merged-figure-title",
    `${what}: the block lost its heading`);
}

/* -------------------------- (a) GitHub answered --------------------------- */

test("GitHub answered: the block shows the count and the time it was taken", async (t) => {
  const page = await loadPage(OBSERVATORY_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, liveGithub, page.storage);
  await settle();

  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");
  assert.equal(textOf(document.querySelector(".merged-figure-unit")), "merged pull requests");

  // The time is the response's own, readable beside the number and machine
  // readable on the element — this is the "and when" half of the outcome.
  const stamp = document.querySelector(".merged-figure-time");
  assert.equal(stamp.dateTime, new Date(RESPONSE_DATE).toISOString());
  const source = textOf(document.querySelector(".merged-figure-source"));
  assert.match(source, /Checked/);
  assert.ok(source.includes(textOf(stamp)), "the time it was taken is not in the sentence a reader reads");

  assertSettledShape(document, "a live count");
});

/* ------------------- (b) no answer, a stored count here ------------------- */

test("GitHub did not answer: a stored count cannot supply the metric", async (t) => {
  const page = await loadPage(OBSERVATORY_URL, { storage: storedCount() });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, rateLimited, page.storage);
  await settle();

  assert.equal(document.querySelector("#merged-figure").dataset.state, "unavailable");
  assert.equal(document.querySelector(".merged-figure-count"), null);
  assert.doesNotMatch(textOf(document.querySelector("#merged-figure-readout")), /412|Checked/);

  assertSettledShape(document, "a stored count");
});

/* --------------- (c) no answer and nothing was ever counted --------------- */

test("GitHub did not answer and nothing was ever counted: the home page's wording, no digit", async (t) => {
  const page = await loadPage(OBSERVATORY_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, rateLimited, page.storage);
  await settle();

  const readout = document.querySelector("#merged-figure-readout");
  assert.equal(document.querySelector("#merged-figure").dataset.state, "unavailable");
  assert.deepEqual(readout.querySelectorAll("p").map(textOf), [
    "Public GitHub activity unavailable.",
    `We could not fetch public GitHub activity from ${SOURCE_REPOSITORIES.join(" and ")}.`,
  ]);
  // No zero, no dash, no remembered figure standing in for a count nobody took.
  assert.doesNotMatch(textOf(readout), /\d/, "something a reader could quote as a count was left behind");

  assertSettledShape(document, "a count that was never taken");
});

/* -------------------- a GitHub that never answers at all ------------------ */

for (const [what, storage, expected] of [
  ["nothing stored", {}, "unavailable"],
  ["a stored count", storedCount(), "unavailable"],
]) {
  test(`a GitHub that never answers still settles the block, with ${what}`, async (t) => {
    const page = await loadPage(OBSERVATORY_URL, { storage });
    t.after(() => page.restore());
    const { document } = page;

    // A request that is merely slow and one that will never answer look the
    // same from this page, and this is the one the block used to park on.
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    const silent = observatoryFetcher(async (url) => {
      await held;
      return okResponse(url.includes("paint-lab") ? MERGES : []);
    });

    const loading = loadActivity(document, silent, page.storage, { settleAfterMs: 1 });
    const settled = await waitForState(document, (state) => state !== "loading", "settled while GitHub was silent");
    assert.equal(settled, expected, `${what}: the block settled onto the wrong outcome`);
    assertSettledShape(document, `a silent GitHub with ${what}`);

    // And a response that arrives after the deadline is still the better answer.
    answer();
    await loading;
    await settle();
    assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
    assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");
    assertSettledShape(document, `a late answer with ${what}`);
  });
}

/* ------------------- one outcome, one set of words, twice ----------------- */

// The structural guarantee behind acceptance criterion 6. Both surfaces are
// rendered here and their text compared to each other — not to a literal typed
// into this file — so the only way to keep this green is for both to keep
// reading their wording out of src/public-merges.js and
// src/merged-count-retention.js.
async function observatoryReadout(storage) {
  const page = await loadPage(OBSERVATORY_URL, { storage });
  try {
    await loadActivity(page.document, rateLimited, page.storage);
    await settle();
    const readout = page.document.querySelector("#merged-figure-readout");
    return { state: page.document.querySelector("#merged-figure").dataset.state, said: readout.querySelectorAll("p").map(textOf) };
  } finally {
    page.restore();
  }
}

async function homeReadout(storage) {
  const page = await loadPage(HOME_URL, { storage });
  try {
    await loadPublicMerges(page.document, async () => ({ ok: false, status: 403 }), page.storage);
    const readout = page.document.querySelector("#public-merges-readout");
    return { state: page.document.querySelector("#public-merges").dataset.state, said: readout.querySelectorAll("p").map(textOf) };
  } finally {
    page.restore();
  }
}

test("the observatory turns the never-counted outcome into buyer-readable unavailable copy", async () => {
  const observatory = await observatoryReadout({});
  const home = await homeReadout({});

  assert.equal(observatory.state, "unavailable");
  assert.equal(home.state, "unavailable");
  assert.deepEqual(observatory.said, [
    "Public GitHub activity unavailable.",
    `We could not fetch public GitHub activity from ${SOURCE_REPOSITORIES.join(" and ")}.`,
  ]);
  assert.notDeepEqual(observatory.said, home.said,
    "the observatory intentionally replaces transport-specific detail with one buyer-readable state");
});

test("the observatory requires current evidence even when the home page retains a count", async () => {
  const observatory = await observatoryReadout(storedCount());
  const home = await homeReadout(storedCount());
  assert.equal(observatory.state, "unavailable");
  assert.doesNotMatch(observatory.said.join(" "), /412|Checked/);
  assert.equal(home.state, "retained");
});
