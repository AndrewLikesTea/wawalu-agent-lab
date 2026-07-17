import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  loadReleases,
  saveReleases,
  sortReleasesNewestFirst,
  resolveRelease,
  summarizeReleases,
  statusSummaryText,
  nextIndex,
  indexById,
  RELEASE_STORAGE_KEY,
  filterReleases,
  releaseStatus,
} from "../src/releases.js";
import { loadDecisions, STORAGE_KEY } from "../src/app.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

// Decisions the releases resolve against. Statuses and owners vary so a single
// set exercises the count breakdown and the missing-reference path.
const decisions = [
  { id: "d-queue",  title: "Durable queue", context: "c", owner: "Kai",   status: "accepted",   createdAt: "2026-05-02T00:00:00.000Z" },
  { id: "d-cache",  title: "Read cache",    context: "c", owner: "Ari",   status: "accepted",   createdAt: "2026-05-20T00:00:00.000Z" },
  { id: "d-flags",  title: "Feature flags", context: "c", owner: "Priya", status: "proposed",   createdAt: "2026-06-01T00:00:00.000Z" },
  { id: "d-csv",    title: "Sunset CSV",    context: "c", owner: "Mina",  status: "superseded", createdAt: "2026-03-10T00:00:00.000Z" },
];

const releases = [
  { id: "r-old", version: "v1.0.0", createdAt: "2026-03-15T00:00:00.000Z", decisionIds: [] },
  { id: "r-new", version: "v1.3.0", createdAt: "2026-07-01T00:00:00.000Z", decisionIds: ["d-flags", "d-queue"] },
  { id: "r-mid", version: "v1.2.0", createdAt: "2026-05-25T00:00:00.000Z", decisionIds: ["d-queue", "d-cache"] },
];

const versions = (list) => list.map((release) => release.version);

test("orders releases reverse-chronologically without mutating the input", () => {
  const before = versions(releases);
  assert.deepEqual(versions(sortReleasesNewestFirst(releases)), ["v1.3.0", "v1.2.0", "v1.0.0"]);
  assert.deepEqual(versions(releases), before);
});

test("resolveRelease links decisions in association order and counts statuses", () => {
  const resolved = resolveRelease(releases[1], indexById(decisions));
  assert.deepEqual(resolved.decisions.map((d) => d.id), ["d-flags", "d-queue"]);
  assert.deepEqual(resolved.missingIds, []);
  assert.equal(resolved.counts.total, 2);
  assert.equal(resolved.counts.linked, 2);
  assert.equal(resolved.counts.proposed, 1);
  assert.equal(resolved.counts.accepted, 1);
  assert.equal(resolved.counts.superseded, 0);
  assert.equal(resolved.counts.missing, 0);
});

test("resolveRelease surfaces dangling references instead of dropping them", () => {
  const resolved = resolveRelease(
    { id: "r-x", version: "v9", createdAt: "2026-01-01T00:00:00.000Z", decisionIds: ["d-cache", "ghost"] },
    decisions,
  );
  assert.deepEqual(resolved.decisions.map((d) => d.id), ["d-cache"]);
  assert.deepEqual(resolved.missingIds, ["ghost"]);
  assert.equal(resolved.counts.total, 2);
  assert.equal(resolved.counts.linked, 1);
  assert.equal(resolved.counts.missing, 1);
});

test("resolveRelease accepts either a Map or a decisions array", () => {
  const fromArray = resolveRelease(releases[2], decisions);
  const fromMap = resolveRelease(releases[2], indexById(decisions));
  assert.deepEqual(fromArray.decisions.map((d) => d.id), fromMap.decisions.map((d) => d.id));
});

test("summarizeReleases composes ordering and resolution", () => {
  const summarized = summarizeReleases(releases, decisions);
  assert.deepEqual(versions(summarized), ["v1.3.0", "v1.2.0", "v1.0.0"]);
  assert.equal(summarized[0].counts.linked, 2);
  assert.equal(summarized[2].counts.total, 0);
});

test("filters releases by lifecycle status while retaining newest-first order", () => {
  const records = [
    { ...releases[0], status: "cancelled" },
    { ...releases[1], status: "planned" },
    { ...releases[2], status: "planned" },
  ];
  assert.deepEqual(versions(filterReleases(records, decisions, { status: "planned" })), ["v1.3.0", "v1.2.0"]);
  assert.deepEqual(versions(filterReleases(records, decisions, { status: "completed" })), []);
  assert.equal(releaseStatus(releases[0]), "completed", "legacy release records remain visible as completed");
});

test("searches release titles, descriptions, and associated decision context", () => {
  const records = [
    { ...releases[0], title: "Legacy cleanup", description: "Removed old endpoints", status: "cancelled" },
    { ...releases[1], title: "Safe delivery", description: "Dark launches", status: "planned" },
    { ...releases[2], title: "Fast reads", description: "Lower latency", status: "completed" },
  ];
  const searchableDecisions = decisions.map((decision) => decision.id === "d-queue"
    ? { ...decision, context: "Background work needs durable delivery" }
    : decision);
  assert.deepEqual(versions(filterReleases(records, decisions, { query: "LEGACY" })), ["v1.0.0"]);
  assert.deepEqual(versions(filterReleases(records, decisions, { query: "dark launches" })), ["v1.3.0"]);
  assert.deepEqual(versions(filterReleases(records, searchableDecisions, { query: "background work" })), ["v1.3.0", "v1.2.0"]);
  assert.deepEqual(versions(filterReleases(records, decisions, { query: "  " })), ["v1.3.0", "v1.2.0", "v1.0.0"]);
  assert.deepEqual(versions(filterReleases(records, decisions, { query: "latency", status: "planned" })), []);
  // A decision's title is surfaced on the row, so search must match it too, not
  // only its context. "Durable queue" (d-queue) rides on both v1.3.0 and v1.2.0.
  assert.deepEqual(versions(filterReleases(records, decisions, { query: "durable queue" })), ["v1.3.0", "v1.2.0"]);
});

test("statusSummaryText renders counts, singular/plural, and missing", () => {
  const [newest, , oldest] = summarizeReleases(releases, decisions);
  assert.equal(statusSummaryText(newest), "2 decisions · 1 proposed, 1 accepted");
  assert.equal(statusSummaryText(oldest), "No linked decisions");

  const one = resolveRelease({ id: "r1", version: "v", createdAt: "2026-01-01T00:00:00.000Z", decisionIds: ["d-queue"] }, decisions);
  assert.equal(statusSummaryText(one), "1 decision · 1 accepted");

  const missing = resolveRelease({ id: "r2", version: "v", createdAt: "2026-01-01T00:00:00.000Z", decisionIds: ["d-cache", "ghost"] }, decisions);
  assert.equal(statusSummaryText(missing), "2 decisions · 1 accepted, 1 missing");
});

test("loadReleases tolerates malformed or invalid stored data", () => {
  assert.deepEqual(loadReleases(memoryStorage()), []);
  assert.deepEqual(loadReleases(memoryStorage({ [RELEASE_STORAGE_KEY]: "not json" })), []);
  assert.deepEqual(loadReleases(memoryStorage({ [RELEASE_STORAGE_KEY]: JSON.stringify({}) })), []);
  assert.deepEqual(loadReleases(memoryStorage({
    [RELEASE_STORAGE_KEY]: JSON.stringify([
      { id: "ok", version: "v1", createdAt: "2026-01-01T00:00:00.000Z", decisionIds: ["a"] },
      { id: "", version: "v2", createdAt: "2026-01-01T00:00:00.000Z", decisionIds: [] },
      { id: "bad-date", version: "v3", createdAt: "never", decisionIds: [] },
      { id: "bad-ids", version: "v4", createdAt: "2026-01-01T00:00:00.000Z", decisionIds: [1, 2] },
      { id: "no-array", version: "v5", createdAt: "2026-01-01T00:00:00.000Z", decisionIds: "x" },
    ]),
  })).map((r) => r.id), ["ok"]);
});

test("saveReleases round-trips through loadReleases", () => {
  const storage = memoryStorage();
  const record = { id: "r", version: "v2.0.0", notes: "n", createdAt: "2026-07-01T00:00:00.000Z", decisionIds: ["d-queue"] };
  saveReleases(storage, [record]);
  assert.deepEqual(loadReleases(storage), [record]);
});

test("nextIndex moves within bounds and clamps; Enter is not a nav key", () => {
  assert.equal(nextIndex(0, "ArrowDown", 3), 1);
  assert.equal(nextIndex(2, "ArrowDown", 3), 2); // clamps at last
  assert.equal(nextIndex(1, "ArrowUp", 3), 0);
  assert.equal(nextIndex(0, "ArrowUp", 3), 0); // clamps at first
  assert.equal(nextIndex(-1, "ArrowDown", 3), 0); // nothing focused yet
  assert.equal(nextIndex(1, "Home", 3), 0);
  assert.equal(nextIndex(1, "End", 3), 2);
  assert.equal(nextIndex(1, "Enter", 3), 1); // Enter toggles the button, not nav
  assert.equal(nextIndex(0, "ArrowDown", 0), -1); // empty list
});

test("releases page is wired and linked from the decisions page", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [home, page, wiring] = await Promise.all([
    read("src/index.html"), read("src/releases.html"), read("src/releases-page.js"),
  ]);
  assert.match(home, /href="\/releases\.html"/);
  assert.match(page, /<title>Releases · Shiplog<\/title>/);
  assert.match(page, /id="release-list"/);
  assert.match(page, /id="release-search"/);
  assert.match(page, /id="release-status"/);
  assert.match(page, /src="\/releases-page\.js"/);
  // No innerHTML anywhere in the interactive layers (no user-generated HTML).
  const component = await read("src/releases.js");
  assert.doesNotMatch(`${component}\n${wiring}`, /innerHTML/);
});

// The demo seed is hand-authored data that ships to production and renders the
// list/detail views in review. It is edited by hand (this task renamed release
// `author` -> `owner` and added `alternatives`), so guard it the same way the
// social seed is guarded: a bad status, an over-length field, a mistyped
// decisionId, or a broken shape should fail the build, not ship silently.
test("releases demo seed is valid and internally consistent", async () => {
  const raw = await readFile(new URL("../src/releases-demo-data.json", import.meta.url), "utf8");
  const seed = JSON.parse(raw);
  assert.ok(Array.isArray(seed.decisions) && seed.decisions.length > 0);
  assert.ok(Array.isArray(seed.releases) && seed.releases.length > 0);

  // Every seed decision must survive the same validation stored decisions do.
  // This covers the status enum, field lengths, and the new `alternatives` type.
  const decisionStore = memoryStorage({ [STORAGE_KEY]: JSON.stringify(seed.decisions) });
  assert.equal(loadDecisions(decisionStore).length, seed.decisions.length);

  // Same for releases (id / version / createdAt / decisionIds shape).
  const releaseStore = memoryStorage({ [RELEASE_STORAGE_KEY]: JSON.stringify(seed.releases) });
  assert.equal(loadReleases(releaseStore).length, seed.releases.length);

  // The seed documents exactly one dangling reference (an archived decision) to
  // exercise the missing-reference path. Any other unresolved decisionId is a
  // typo that would render as a silent "missing" row in production.
  const missing = summarizeReleases(seed.releases, seed.decisions)
    .flatMap((release) => release.missingIds);
  assert.deepEqual(missing, ["demo-archived-legacy"]);
});
