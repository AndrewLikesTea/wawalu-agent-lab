// A cold visitor gets a real number — issue #1820.
//
// THE DEFECT. A browser that had never loaded this site had no retained count,
// and the live GitHub request is unauthenticated and routinely rate-limited or
// simply slow. The one number this site offers as checkable therefore went to
// "Public GitHub has not answered yet, so there is no count to show." on the
// home page and sat on "Loading…" in the observatory, for the visitor with the
// least reason to give the site the benefit of the doubt.
//
// THE FIX THIS FILE PINS. A count committed to the repository and shipped inside
// each page's own module graph — a static import, so it needs no request and no
// storage — plus one ordered precedence rule both surfaces resolve through:
//
//   live wins outright;
//   otherwise the most recently COUNTED of this browser's retained count and the
//   committed baseline, compared by timestamp and never by origin;
//   otherwise the baseline.
//
// One number reaches the page, never two, and a number that is not live is
// always labelled with when it was counted. What survives every state is the
// pair of links inviting the reader to go and count the merges themselves.
//
// Every fetcher and every storage here is a stub; nothing reaches the network.

import assert from "node:assert/strict";
import test from "node:test";
import { loadActivity } from "../src/agents.js";
import {
  BASELINE_RECORD,
  MERGED_COUNT_BASELINE,
  asCountRecord,
  resolveMergedCount,
} from "../src/merged-count-baseline.js";
import { EVENTS_URLS, SOURCE_REPOSITORIES, feedLinkText } from "../src/public-merges.js";
import { RETAINED_COUNT_KEY, RETAINED_COUNT_SCHEMA } from "../src/merged-count-retention.js";
import { loadPublicMerges } from "../src/public-merges-view.js";
import { loadPage, textOf } from "./support/browser.js";

const OBSERVATORY_URL = new URL("../src/agents.html", import.meta.url);
const HOME_URL = new URL("../src/index.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";

// A baseline whose digits appear nowhere else in this file or on either page, so
// a rendered "4242" can only have come from the baseline and its absence is
// evidence rather than coincidence.
const BASELINE = Object.freeze({ count: 4242, takenAt: "2026-08-01T11:22:00.000Z" });
const BASELINE_SENTENCE = /did not answer just now, so this is the last count taken from/;

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
      head: { ref: "agent/backend/baseline" },
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

// Only the GitHub feeds answer; the published record file is not found, so the
// baseline is the only thing standing between a failed request and no number.
const observatoryFetcher = (github) => async (url) => (
  url.includes("api.github.com") ? github(url) : { ok: false, status: 404 }
);
const liveGithub = observatoryFetcher(async (url) => okResponse(url.includes("paint-lab") ? MERGES : []));
const rateLimited = observatoryFetcher(async () => ({ ok: false, status: 403 }));
const neverAnswers = observatoryFetcher(() => new Promise(() => {}));

const retained = (count, takenAt) => ({
  [RETAINED_COUNT_KEY]: JSON.stringify({ schemaVersion: RETAINED_COUNT_SCHEMA, count, takenAt }),
});

/** The invitation to count it yourself, which no state may take away. */
function assertFeedLinks(document, selector, what) {
  const links = document.querySelector(selector).querySelectorAll("a");
  assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS,
    `${what}: the feeds the count came from are no longer linked`);
  assert.deepEqual(links.map(textOf), SOURCE_REPOSITORIES.map(feedLinkText),
    `${what}: the links no longer say what there is to count and where`);
}

// --- the committed record itself -------------------------------------------

test("the committed baseline is a whole count of both repositories, taken at a stated moment", () => {
  const record = BASELINE_RECORD;
  assert.ok(record, "the committed baseline does not parse as a count record");
  assert.ok(Number.isInteger(record.count) && record.count > 0,
    "a baseline that is null, fractional, or zero is not a count anybody took");

  // The total is the breakdown's sum, so neither can be edited without the
  // other and the number on the page is always the one the parts add up to.
  const breakdown = MERGED_COUNT_BASELINE.repositories;
  assert.deepEqual(Object.keys(breakdown).sort(), [...SOURCE_REPOSITORIES].sort(),
    "the breakdown names repositories the page does not count");
  assert.equal(Object.values(breakdown).reduce((sum, value) => sum + value, 0), MERGED_COUNT_BASELINE.count,
    "the committed total is not what its per-repository counts add up to");
  for (const [repository, count] of Object.entries(breakdown)) {
    assert.ok(Number.isInteger(count) && count >= 0, `${repository}: not a whole count`);
  }

  // Taken, not guessed: a real instant, in the past, carried as UTC.
  assert.equal(record.takenAt.toISOString(), MERGED_COUNT_BASELINE.takenAt);
  assert.ok(record.takenAt.getTime() < Date.now(), "the baseline claims to have been counted in the future");
});

test("a baseline edited into nonsense is no baseline, and never a digit", () => {
  for (const broken of [
    null, undefined, {}, { count: 3 }, { takenAt: BASELINE.takenAt },
    { count: null, takenAt: BASELINE.takenAt },
    { count: "3", takenAt: BASELINE.takenAt },
    { count: 3.5, takenAt: BASELINE.takenAt },
    { count: -1, takenAt: BASELINE.takenAt },
    { count: 3, takenAt: "sometime in August" },
  ]) {
    assert.equal(asCountRecord(broken), null, JSON.stringify(broken) ?? "undefined");
    // `?? null` because an omitted baseline is the committed one, by design: only
    // a baseline that is present and unusable is the case under test here.
    assert.equal(resolveMergedCount({ baseline: broken ?? null }), null,
      "a broken baseline still reached the page");
  }
  // A Date is accepted as readily as an ISO string, and an invalid one is not.
  assert.equal(asCountRecord({ count: 3, takenAt: new Date(BASELINE.takenAt) }).count, 3);
  assert.equal(asCountRecord({ count: 3, takenAt: new Date("nonsense") }), null);
});

// --- the one precedence rule ------------------------------------------------

test("live wins over everything, and says so", () => {
  const resolved = resolveMergedCount({
    live: { count: 7, takenAt: new Date("2020-01-01T00:00:00.000Z") },
    cached: { count: 412, takenAt: "2026-07-14T09:15:00.000Z" },
    baseline: BASELINE,
  });
  // Even an older live response wins: it is this request's own answer, and
  // nothing counted earlier can be truer than what GitHub just said.
  assert.equal(resolved.count, 7);
  assert.equal(resolved.source, "live");
});

test("of the two earlier counts, the more recently counted one wins", () => {
  const older = { count: 100, takenAt: "2026-07-01T00:00:00.000Z" };
  const newer = { count: 900, takenAt: "2026-09-01T00:00:00.000Z" };

  // A stale cache loses to a newer baseline...
  const staleCache = resolveMergedCount({ cached: older, baseline: BASELINE });
  assert.equal(staleCache.count, BASELINE.count, "a stale cached count outranked a newer baseline");
  assert.equal(staleCache.source, "earlier");

  // ...and a cache newer than the baseline wins, which is what makes a returning
  // visitor's own last answer worth keeping.
  const freshCache = resolveMergedCount({ cached: newer, baseline: BASELINE });
  assert.equal(freshCache.count, 900, "a cached count taken after the baseline lost to it");
  assert.equal(freshCache.source, "earlier");

  // With nothing cached at all — the cold browser this exists for — the baseline
  // is the answer, and it is labelled as an earlier count, never as live.
  const cold = resolveMergedCount({ cached: null, baseline: BASELINE });
  assert.equal(cold.count, BASELINE.count);
  assert.equal(cold.source, "earlier");
  assert.equal(cold.takenAt.toISOString(), BASELINE.takenAt);
});

// --- the home page ----------------------------------------------------------

test("a cold browser and a failing request still get a number on the home page", async (t) => {
  const page = await loadPage(HOME_URL, { storage: {} });
  t.after(() => page.restore());

  const result = await loadPublicMerges(page.document, async () => ({ ok: false, status: 403 }),
    page.storage, { baseline: BASELINE });

  assert.equal(result.ok, false, "nothing in this run reached a live count");
  const section = page.document.querySelector("#public-merges");
  const readout = page.document.querySelector("#public-merges-readout");
  assert.equal(section.dataset.state, "retained");
  assert.match(textOf(readout), /^4242 merged pull requests/);

  // The sentence the issue is named after is gone, and so is every other reading
  // of "there is no number here".
  assert.doesNotMatch(textOf(section), /has not answered yet/);
  assert.doesNotMatch(textOf(section), /no count to show/);
  assert.doesNotMatch(textOf(section), /Loading/);

  // The number is labelled as an earlier count and dated, in the site's own
  // sentence rather than a badge, and the date is machine-readable too.
  assert.match(textOf(readout), BASELINE_SENTENCE);
  assert.match(textOf(readout), /as of 2026-08-01 at 11:22 UTC\./);
  const [stamp, ...extra] = readout.querySelectorAll("time");
  assert.equal(extra.length, 0, "one number, one timestamp");
  assert.equal(stamp.dateTime, BASELINE.takenAt);

  // A count nobody's browser produced is not written back as one this browser saw.
  assert.equal(page.storage.getItem(RETAINED_COUNT_KEY), null);
  assertFeedLinks(page.document, "#public-merges-sources", "a baseline count");
});

test("the home page's baseline needs no request and no storage to be on screen", async (t) => {
  const page = await loadPage(HOME_URL, { storage: {} });
  t.after(() => page.restore());
  // A browser with site data disabled and a network that refuses outright: the
  // baseline is a static import, so neither can take the number away.
  const refusing = {
    getItem() { throw new Error("site data is disabled"); },
    setItem() { throw new Error("site data is disabled"); },
  };

  await loadPublicMerges(page.document, async () => { throw new TypeError("Failed to fetch"); },
    refusing, { baseline: BASELINE });

  assert.equal(page.document.querySelector("#public-merges").dataset.state, "retained");
  assert.match(textOf(page.document.querySelector("#public-merges-readout")), /^4242 merged pull requests/);
});

test("a live answer replaces the baseline outright, and the baseline is nowhere on the page", async (t) => {
  const page = await loadPage(HOME_URL, { storage: {} });
  t.after(() => page.restore());

  await loadPublicMerges(page.document, async (url) => okResponse(url.includes("paint-lab") ? MERGES : []),
    page.storage, { baseline: BASELINE });

  const section = page.document.querySelector("#public-merges");
  assert.equal(section.dataset.state, "live");
  assert.match(textOf(section), /3 merged pull requests/);
  assert.match(textOf(section), /Counted from public GitHub activity in/);
  assert.match(textOf(section), /as of 2025-07-30 at 14:32 UTC\./);

  // One number, not two: no second figure, no "and previously", no baseline
  // digit anywhere in the block, and none of the earlier-count wording.
  assert.doesNotMatch(textOf(section), /4242/, "the baseline was rendered beside a live count");
  assert.doesNotMatch(textOf(section), /2026-08-01/, "the baseline's date outlived the live answer");
  assert.doesNotMatch(textOf(section), BASELINE_SENTENCE);
  assert.equal(page.document.querySelector("#public-merges-readout").querySelectorAll("time").length, 1);
  assertFeedLinks(page.document, "#public-merges-sources", "a live count");
});

// --- the Agent observatory --------------------------------------------------

test("a request that never answers still leaves the observatory on a stated number", async (t) => {
  const page = await loadPage(OBSERVATORY_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  // Nothing in this load will ever resolve, so a page that reaches a number can
  // only have got it from the baseline shipped with the document.
  loadActivity(document, neverAnswers, page.storage, { settleAfterMs: 1, baseline: BASELINE });
  await settle();

  const figure = document.querySelector("#merged-figure");
  assert.equal(figure.dataset.state, "recorded", "the block was left waiting on a request that never answers");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "4242");
  assert.equal(textOf(document.querySelector(".merged-figure-unit")), "merged pull requests");
  assert.doesNotMatch(textOf(figure), /Loading/, "the block is still telling a reader to wait");
  assert.doesNotMatch(textOf(figure), /no count to show/);

  // Dated in words and in markup, as an earlier count rather than a live one.
  assert.match(textOf(document.querySelector(".merged-figure-source")), BASELINE_SENTENCE);
  assert.match(textOf(figure), /as of 2026-08-01 at 11:22 UTC\./);
  assert.equal(document.querySelector(".merged-figure-recorded-date").dateTime, BASELINE.takenAt);
  assertFeedLinks(document, ".merged-figure-sources", "a request that never answers");
});

test("a cold observatory whose request fails shows the baseline, not the empty sentence", async (t) => {
  const page = await loadPage(OBSERVATORY_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, rateLimited, page.storage, { baseline: BASELINE });
  await settle();

  assert.equal(document.querySelector("#merged-figure").dataset.state, "recorded");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "4242");
  assert.doesNotMatch(textOf(document.querySelector("#merged-figure")), /no count to show/);
  assertFeedLinks(document, ".merged-figure-sources", "a failed request");
});

test("a live observatory response wins over the baseline and leaves none of it behind", async (t) => {
  const page = await loadPage(OBSERVATORY_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  await loadActivity(document, liveGithub, page.storage, { baseline: BASELINE });
  await settle();

  const figure = document.querySelector("#merged-figure");
  assert.equal(figure.dataset.state, "live");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");
  assert.doesNotMatch(textOf(figure), /4242/, "the baseline stood beside the live count");
  assert.doesNotMatch(textOf(figure), /2026-08-01/);
  assert.equal(document.querySelector(".merged-figure-recorded-date"), null,
    "a live count carried the earlier count's date");
  assertFeedLinks(document, ".merged-figure-sources", "a live count");
});

test("a stored count older than the baseline loses to it, and a newer one beats it", async (t) => {
  const stale = await loadPage(OBSERVATORY_URL, { storage: retained(11, "2026-07-01T00:00:00.000Z") });
  t.after(() => stale.restore());
  await loadActivity(stale.document, rateLimited, stale.storage, { baseline: BASELINE });
  await settle();
  assert.equal(textOf(stale.document.querySelector(".merged-figure-count")), "4242",
    "a count this browser took before the baseline was still shown as the later one");

  const fresh = await loadPage(OBSERVATORY_URL, { storage: retained(77, "2026-09-01T00:00:00.000Z") });
  t.after(() => fresh.restore());
  await loadActivity(fresh.document, rateLimited, fresh.storage, { baseline: BASELINE });
  await settle();
  assert.equal(textOf(fresh.document.querySelector(".merged-figure-count")), "77",
    "a count this browser took after the baseline lost to it");
  assert.equal(fresh.document.querySelector(".merged-figure-recorded-date").dateTime,
    "2026-09-01T00:00:00.000Z");
});

test("both surfaces resolve one cold outcome to one number, in the same words", async () => {
  const observatory = await loadPage(OBSERVATORY_URL, { storage: {} });
  const home = await loadPage(HOME_URL, { storage: {} });
  try {
    await loadActivity(observatory.document, rateLimited, observatory.storage, { baseline: BASELINE });
    await settle();
    await loadPublicMerges(home.document, async () => ({ ok: false, status: 403 }),
      home.storage, { baseline: BASELINE });

    assert.equal(textOf(observatory.document.querySelector(".merged-figure-count")), "4242");
    assert.match(textOf(home.document.querySelector("#public-merges-readout")), /^4242 /);
    // The qualifying sentence is compared surface to surface rather than against
    // a literal, so one page reworded without the other reds this.
    const said = (document, selector) => textOf(document.querySelector(selector))
      .replace(/^.*?Public GitHub/, "Public GitHub");
    assert.equal(said(observatory.document, ".merged-figure-source"),
      said(home.document, "#public-merges-readout"),
      "the two surfaces describe one earlier count in different words");
  } finally {
    observatory.restore();
    home.restore();
  }
});
