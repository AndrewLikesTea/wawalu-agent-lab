// What a cold visitor sees, on both surfaces, before anything has answered.
//
// A cold visitor is the ordinary case: no stored count, and a public GitHub
// request that is unauthenticated and routinely rate-limited. Both the home
// page's counted-figure block and the Agent observatory's headline figure used
// to answer that with no number — and the previous attempt at fixing it gave
// them DIFFERENT answers, because the observatory read the published record and
// the home page did not. So what is pinned here is not "each page shows
// something" but "the two pages show the SAME something", asserted by comparing
// the two rendered surfaces to each other rather than to a literal typed here.
//
// AND THE NUMBER ITSELF IS PINNED TO THE RECORDER'S OUTPUT. The two generated
// artifacts are asserted equal field by field. Shape-only checks — an integer,
// a parseable instant — are exactly what let a hand-written baseline pass green
// last time. Equality between the JSON the recorder writes and the module it
// writes in the same call is what catches a number that was typed rather than
// counted.
//
// Every fetch in this file is a stub. Nothing here opens a socket.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadActivity } from "../src/agents.js";
import { MERGED_COUNT_BASELINE } from "../src/merged-count-baseline.js";
import {
  COUNTED_SOURCE_ORDER,
  SHIPPED_BASELINE,
  guardCountedRecord,
  resolveCountedFigure,
} from "../src/merged-count-figure.js";
import { EVENTS_URLS } from "../src/public-merges.js";
import { loadPublicMerges } from "../src/public-merges-view.js";
import { installDocument } from "./support/dom.js";
import { loadPage, textOf } from "./support/browser.js";

installDocument();

const HOME_URL = new URL("../src/index.html", import.meta.url);
const OBSERVATORY_URL = new URL("../src/agents.html", import.meta.url);
const RECORD_URL = new URL("../src/merged-pull-request-count.json", import.meta.url);

// A cold load: nothing in storage, and public GitHub refusing the page's
// unauthenticated request. The published record is served, because it is a
// static file on this origin and cannot be rate-limited.
const recordPayload = async () => JSON.parse(await readFile(RECORD_URL, "utf8"));

function coldFetcher(record) {
  return async (url) => {
    if (url.includes("api.github.com")) return { ok: false, status: 403 };
    return { ok: true, status: 200, json: async () => record };
  };
}

const settle = () => new Promise((done) => setTimeout(done, 0));
const digitsIn = (text) => text.match(/\d+/g) ?? [];

/* ------------------------- the drift guard ------------------------------- */

test("the compiled baseline and the published record are the same record", async () => {
  const published = await recordPayload();

  // Field-by-field equality, not "both look like a count". One run of
  // scripts/record-merged-count.mjs writes both files; if these ever differ,
  // one of them was written by something else, and a number nobody counted is
  // exactly what this assertion exists to refuse.
  assert.equal(MERGED_COUNT_BASELINE.count, published.count,
    "the shipped baseline count is not the recorded count");
  assert.equal(MERGED_COUNT_BASELINE.countedAt, published.takenAt,
    "the shipped baseline instant is not the recorded instant");
  assert.equal(MERGED_COUNT_BASELINE.schemaVersion, published.schemaVersion);

  // And the pair is coherent: either both halves are recorded or neither is.
  if (published.count === null) {
    assert.equal(published.takenAt, null, "a count with no instant is not a record");
    assert.equal(SHIPPED_BASELINE, null, "an unrecorded build must resolve to no baseline");
  } else {
    assert.ok(Number.isInteger(published.count) && published.count >= 0);
    assert.equal(new Date(published.takenAt).toISOString(), published.takenAt,
      "the instant is ISO-8601 exactly as the recorder wrote it");
    assert.equal(SHIPPED_BASELINE.count, published.count);
    assert.equal(SHIPPED_BASELINE.countedAt.toISOString(), published.takenAt);
  }
});

/* ------------------- one cold load, two surfaces, one number -------------- */

test("a cold visitor reads the same figure and the same date on both surfaces", async (t) => {
  const record = await recordPayload();
  if (record.count === null) {
    t.skip("this build has never recorded a count, so there is no cold figure to compare");
    return;
  }
  const fetcher = coldFetcher(record);

  const home = await loadPage(HOME_URL, { storage: {} });
  t.after(() => home.restore());
  await loadPublicMerges(home.document, fetcher, home.storage);

  const observatory = await loadPage(OBSERVATORY_URL, { storage: {} });
  t.after(() => observatory.restore());
  await loadActivity(observatory.document, fetcher, observatory.storage);
  await settle();

  const homeText = textOf(home.document.querySelector("#public-merges-readout"));
  const observatoryText = textOf(observatory.document.querySelector("#merged-figure-readout"));

  // Both are showing a figure at all, and it is the recorded one.
  assert.equal(home.document.querySelector("#public-merges").dataset.state, "retained");
  assert.equal(observatory.document.querySelector("#merged-figure").dataset.state, "recorded");

  // The same integer, and the same one the recorder wrote.
  const [homeCount] = digitsIn(homeText);
  const [observatoryCount] = digitsIn(observatoryText);
  assert.equal(homeCount, String(record.count));
  assert.equal(observatoryCount, homeCount,
    "the two pages disagree about the one number neither of them invented");

  // And the same counted-at wording: the date is on the page as text, not only
  // in a datetime attribute, so a reader knows this is an earlier real count.
  const day = record.takenAt.slice(0, 10);
  for (const [where, text] of [["home page", homeText], ["observatory", observatoryText]]) {
    assert.match(text, new RegExp(day), `the ${where} shows a figure with no date beside it`);
    assert.match(text, /did not answer just now, so this is the last count taken from/,
      `the ${where} does not say this is an earlier count rather than a live one`);
  }
  assert.equal(
    homeText.slice(homeText.indexOf("did not answer just now")),
    observatoryText.slice(observatoryText.indexOf("did not answer just now")),
    "one earlier count is described in two sets of words",
  );
});

test("the observatory's cold figure never changes from one number to another", async (t) => {
  const record = await recordPayload();
  if (record.count === null) {
    t.skip("this build has never recorded a count, so there is no cold figure to watch");
    return;
  }
  const page = await loadPage(OBSERVATORY_URL, { storage: {} });
  t.after(() => page.restore());

  // Every distinct figure the slot holds, sampled across the whole load: the
  // synchronous first paint, the published record landing, and GitHub failing.
  const seen = [];
  const sample = () => {
    const readout = page.document.querySelector("#merged-figure-readout");
    const [digit] = digitsIn(textOf(readout));
    if (digit !== undefined && seen.at(-1) !== digit) seen.push(digit);
  };

  const load = loadActivity(page.document, coldFetcher(record), page.storage);
  sample();
  // The first paint is already a number: not blank, and not "Loading…".
  assert.deepEqual(seen, [String(record.count)],
    "the cold first paint was not the recorded figure");
  for (let tick = 0; tick < 4; tick += 1) {
    await settle();
    sample();
  }
  await load;
  await settle();
  sample();

  assert.deepEqual(seen, [String(record.count)],
    "the figure flipped from one non-empty number to a different one during a cold load");
});

test("the self-count links survive every state the figure can be in", async (t) => {
  const record = await recordPayload();
  const live = [{
    id: "1",
    type: "PullRequestEvent",
    created_at: "2026-08-01T09:00:00Z",
    payload: { action: "closed", pull_request: { merged: true, number: 1, title: "One", html_url: "https://example.test/1" } },
  }];
  const answering = async (url) => (url.includes("api.github.com")
    ? { ok: true, status: 200, headers: { get: () => "Fri, 01 Aug 2026 09:00:00 GMT" }, json: async () => live }
    : { ok: true, status: 200, json: async () => record });

  // Cold baseline, this browser's cached count, a live answer, and a build that
  // never recorded anything: the four states, and the same links in all of them.
  const states = [
    ["cold baseline", coldFetcher(record), {}, undefined],
    ["a cached count", coldFetcher(record), {
      "shiplog.merged-pull-request-count": JSON.stringify({ schemaVersion: 1, count: 7, takenAt: "2026-08-02T00:00:00.000Z" }),
    }, undefined],
    ["a live answer", answering, {}, undefined],
    ["nothing ever counted", coldFetcher({ schemaVersion: 1, count: null, takenAt: null }), {}, null],
  ];

  for (const [what, fetcher, storage, baseline] of states) {
    const page = await loadPage(HOME_URL, { storage });
    try {
      await loadPublicMerges(page.document, fetcher, page.storage, { baseline });
      const links = page.document.querySelector("#public-merges-sources").querySelectorAll("a");
      assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS,
        `${what}: the feeds a reader counts for themselves are not beside the figure`);
      for (const link of links) {
        assert.equal(link.tagName, "A", `${what}: the self-count link is not a real anchor`);
        assert.match(textOf(link), /Count the merged pull requests yourself/, what);
      }
    } finally {
      page.restore();
    }
  }
});

/* ------------------------- the resolver itself ---------------------------- */

test("precedence is total: one source wins outright and the rest are not shown", () => {
  assert.deepEqual(COUNTED_SOURCE_ORDER, ["live", "cached", "published", "baseline"]);

  const at = (iso) => ({ takenAt: iso });
  const live = { count: 1, asOf: new Date("2020-01-01T00:00:00.000Z") };
  const cached = { count: 2, ...at("2030-01-01T00:00:00.000Z") };
  const published = { count: 3, ...at("2040-01-01T00:00:00.000Z") };
  const baseline = { count: 4, countedAt: "2050-01-01T00:00:00.000Z" };

  // The live count wins even though every other source was taken later: this is
  // precedence, not recency, and there is no merging of one source into another.
  assert.deepEqual(resolveCountedFigure({ live, cached, published, baseline }),
    { count: 1, countedAt: new Date("2020-01-01T00:00:00.000Z"), source: "live" });
  assert.equal(resolveCountedFigure({ cached, published, baseline }).source, "cached");
  assert.equal(resolveCountedFigure({ published, baseline }).source, "published");
  assert.equal(resolveCountedFigure({ baseline }).source, "baseline");
  assert.equal(resolveCountedFigure({ baseline: null }), null);
});

test("a zero is a record and an unusable source is discarded, not rendered", () => {
  // Truthiness would drop this, and 0 is a real answer public GitHub can give.
  const zero = resolveCountedFigure({ cached: { count: 0, takenAt: "2026-01-01T00:00:00.000Z" }, baseline: null });
  assert.equal(zero.count, 0);
  assert.equal(zero.source, "cached");

  // Each unusable source falls through to the next one rather than reaching a
  // page: a page that renders a half-written record renders a number nobody
  // counted, which is the whole failure this module exists to prevent.
  const usable = { count: 9, takenAt: "2026-01-01T00:00:00.000Z" };
  const unusable = [
    null,
    undefined,
    "412",
    [{ count: 1, takenAt: "2026-01-01T00:00:00.000Z" }],
    { count: 1 },
    { takenAt: "2026-01-01T00:00:00.000Z" },
    { count: 1.5, takenAt: "2026-01-01T00:00:00.000Z" },
    { count: -1, takenAt: "2026-01-01T00:00:00.000Z" },
    { count: "1", takenAt: "2026-01-01T00:00:00.000Z" },
    { count: 1, takenAt: "sometime last week" },
    { count: 1, takenAt: 1752483900000 },
    { count: null, countedAt: null },
  ];
  for (const cached of unusable) {
    assert.equal(guardCountedRecord(cached, "cached"), null, `${JSON.stringify(cached)} parsed into a figure`);
    const resolved = resolveCountedFigure({ cached, published: usable, baseline: null });
    assert.equal(resolved.count, 9, `${JSON.stringify(cached)} reached the page`);
    assert.equal(resolved.source, "published");
  }
});
