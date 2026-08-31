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
  focusRelease,
  handleReleaseListKeydown,
  releaseStatus,
  releaseListHref,
  createReleaseListState,
  toggleReleaseExpanded,
} from "../src/releases.js";
import { loadDecisions, STORAGE_KEY } from "../src/app.js";
import { initReleasesPage } from "../src/releases-page.js";
import { REAL_RECORD_LINK_LABEL } from "../src/deployed-release.js";
import { loadPage, textOf } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

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

test("release summaries count the current decision workflow statuses", () => {
  const release = { id: "current", version: "v3", createdAt: "2026-07-01T00:00:00.000Z", decisionIds: ["pending", "approved"] };
  const current = [
    { id: "pending", title: "Queue", context: "c", owner: "Mina", status: "pending", createdAt: release.createdAt },
    { id: "approved", title: "Cache", context: "c", owner: "Mina", status: "approved", createdAt: release.createdAt },
  ];
  const resolved = resolveRelease(release, current);
  assert.equal(resolved.counts.pending, 1);
  // The record stored under the retired "approved" is counted and reported as
  // accepted, so a release breakdown never shows a word the filter dropped.
  assert.equal(resolved.counts.accepted, 1);
  assert.equal(resolved.counts.approved, undefined);
  assert.equal(statusSummaryText(resolved), "2 decisions · 1 pending, 1 accepted");
});

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

test("nextIndex moves within bounds and leaves activation to Enter", () => {
  assert.equal(nextIndex(0, "ArrowDown", 3), 1);
  assert.equal(nextIndex(2, "ArrowDown", 3), 2); // clamps at last
  assert.equal(nextIndex(1, "ArrowUp", 3), 0);
  assert.equal(nextIndex(0, "ArrowUp", 3), 0); // clamps at first
  assert.equal(nextIndex(-1, "ArrowDown", 3), 0); // nothing focused yet
  assert.equal(nextIndex(1, "Home", 3), 0);
  assert.equal(nextIndex(1, "End", 3), 2);
  assert.equal(nextIndex(1, "Enter", 3), 1); // Enter activates; it does not move focus
  assert.equal(nextIndex(0, "ArrowDown", 0), -1); // empty list
});

test("release disclosure state survives rendering changes and rejects stale ids", () => {
  const initial = createReleaseListState(releases, ["r-new", "missing", "r-new"]);
  assert.deepEqual(initial.expandedIds, ["r-new"]);

  const opened = toggleReleaseExpanded(initial, "r-mid", releases);
  assert.deepEqual(opened.expandedIds, ["r-new", "r-mid"]);
  assert.deepEqual(toggleReleaseExpanded(opened, "r-new", releases).expandedIds, ["r-mid"]);
  assert.equal(toggleReleaseExpanded(opened, "missing", releases), opened);

  // A data refresh prunes a release that no longer exists without throwing.
  assert.deepEqual(createReleaseListState([releases[0]], opened.expandedIds), { expandedIds: [] });
});

function keyboardFixture() {
  const calls = { prevented: 0, selected: 0, focused: [] };
  const items = [0, 1, 2].map((index) => {
    const link = { click: () => { calls.selected += 1; } };
    const item = { querySelector: () => link };
    return {
      dataset: { releaseId: `r-${index}` },
      focus: () => calls.focused.push(index),
      scrollIntoView: () => {},
      closest(selector) {
        if (selector === ".release-toggle") return this;
        return selector === ".release-item" ? item : null;
      },
    };
  });
  const container = { querySelectorAll: () => items };
  const event = (key, target = items[1]) => ({
    key,
    target,
    preventDefault: () => { calls.prevented += 1; },
  });
  return { calls, items, container, event };
}

test("release Enter activates details and arrows move focus", () => {
  const { calls, container, event } = keyboardFixture();
  assert.equal(handleReleaseListKeydown(event("Enter"), container), true);
  assert.equal(calls.selected, 1);
  assert.deepEqual(calls.focused, []);
  assert.equal(handleReleaseListKeydown(event("ArrowDown"), container), true);
  assert.deepEqual(calls.focused, [2]);
  assert.equal(calls.prevented, 2);
});

test("Space and unhandled keys fall through so the disclosure still expands", () => {
  // Space (and any non-nav key) must NOT be intercepted: the native <button>
  // click is the single source of truth for inline expansion. If a future edit
  // adds " " to NAV_KEYS, preventDefault would swallow the toggle click.
  const { calls, container, event } = keyboardFixture();
  for (const key of [" ", "Tab", "a"]) {
    assert.equal(handleReleaseListKeydown(event(key), container), false);
  }
  assert.equal(calls.prevented, 0);
  assert.equal(calls.selected, 0);
  assert.deepEqual(calls.focused, []);
});

test("nested release controls retain native keyboard behavior", () => {
  const { calls, items, container, event } = keyboardFixture();
  const link = { closest: () => items[1] };
  assert.equal(handleReleaseListKeydown(event("Enter", link), container), false);
  assert.equal(calls.prevented, 0);
  assert.equal(calls.selected, 0);
});

test("returning from detail restores focus only for a visible release", () => {
  const { calls, container } = keyboardFixture();
  assert.equal(focusRelease(container, "r-1"), true);
  assert.deepEqual(calls.focused, [1]);
  assert.equal(focusRelease(container, "missing"), false);
  assert.equal(focusRelease(container, "%"), false);
  assert.equal(releaseListHref("r/1"), "/releases.html?focus=r%2F1");
  assert.equal(releaseListHref(""), "/releases.html");
});

test("releases page is wired and linked from the decisions page", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [home, page, wiring] = await Promise.all([
    read("src/index.html"), read("src/releases.html"), read("src/releases-page.js"),
  ]);
  assert.match(home, /href="\/releases\.html"/);
  assert.match(home, /id="sample-release-list"/);
  assert.match(home, /Representative release/);
  assert.match(home, /use no customer or production data/);
  // One description of what these records are, in the same words on both
  // surfaces, and said once per page. The Releases page says it beside the
  // worked example it describes, so a visitor reads it where the example
  // records are; the intro no longer says the same thing a second way.
  const provenance = "These invented records demonstrate Shiplog. "
    + "They use no customer or production data";
  assert.ok(home.includes(`${provenance}.`), "the home page's provenance sentence moved");
  assert.ok(
    page.includes(`${provenance}, and no such decision or release shipped.`),
    "the releases example dropped the provenance sentence",
  );
  assert.doesNotMatch(page, /Includes example records to demonstrate Shiplog/);
  assert.doesNotMatch(page, /shipping history of this Shiplog demo/);
  assert.match(page, /<title>Releases · Shiplog<\/title>/);
  // The form's name is the heading, once. It used to be printed twice in a row,
  // as an eyebrow and then as the heading it labelled.
  assert.match(page, /<div class="section-heading">\s*<h2 id="release-form-title">Record a release<\/h2>\s*<\/div>/);
  assert.doesNotMatch(page, /<p class="eyebrow">Record a release<\/p>/);
  assert.match(page, /id="release-list"/);
  assert.match(page, /id="release-search"/);
  assert.match(page, /id="release-status"/);
  assert.match(page, /id="release-list" aria-live="polite" aria-busy="true"/);
  // One loading message on the page: the list states the wait, and the summary
  // ships empty rather than repeating it or claiming a number it cannot know.
  assert.match(page, /id="release-count" aria-live="polite"><\/p>/);
  assert.doesNotMatch(page, /id="release-count"[^>]*>[^<]*releases?[^<]*<\/p>[\s\S]*?<h3>Loading releases…<\/h3>/);
  assert.match(page, /<h3>Loading releases…<\/h3>/);
  assert.equal(page.match(/Loading releases/g).length, 1, "the wait is stated once");
  assert.match(page, /src="\/releases-page\.js"/);
  // No innerHTML anywhere in the interactive layers (no user-generated HTML).
  const component = await read("src/releases.js");
  assert.match(component, /const heading = el\("h3", "release-heading"\)/);
  assert.match(component, /labelledValue\("Status", releaseStatus\(release\)/);
  assert.match(component, /labelledValue\("Owner", decision\.owner/);
  assert.match(component, /state === "error" \? "alert" : "status"/);
  assert.doesNotMatch(`${component}\n${wiring}`, /innerHTML/);
});

// One name per concept, in two directions. The order is "newest first"
// everywhere else on the site — the home page card, the About block, People —
// so this page says it that way too instead of "in reverse chronological
// order". And the destination is "Releases" in the nav item, the title and the
// h1, so the log inside it is named after what it holds: a reader scanning
// headings used to meet "Releases" a fourth time with nothing to tell the list
// apart from the page it sits on. Read from the shipped markup, because that is
// where these strings live.
test("the releases page states its order in the site's words and repeats no heading", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [page, home] = await Promise.all([read("src/releases.html"), read("src/index.html")]);

  const ordering = "Every release, newest first, with the decisions it carried.";
  assert.ok(home.includes(ordering), "the home page card's wording moved");
  assert.ok(page.includes(ordering), "the releases intro no longer says newest first in the card's words");
  assert.doesNotMatch(page, /reverse chronological/i, "the page invented a second phrase for newest first");

  // The destination keeps one name in all three places it names itself.
  assert.match(page, /<title>Releases · Shiplog<\/title>/);
  assert.match(page, /<a aria-current="page" href="\/releases\.html">Releases<\/a>/);
  assert.match(page, /<h1 id="page-title">See what shipped,<br \/>and why\.<\/h1>/);
  // The order moved off the heading and onto the log's summary sentence, which
  // is the line that also carries the count — one line, both facts, the shape
  // Social's feed summary already uses. The heading names the panel, once, and
  // the eyebrow that named it a second time is gone.
  assert.match(page, /<h2 id="releases-title">Release log<\/h2>/);
  assert.doesNotMatch(page, /<p class="eyebrow">Release log<\/p>/);
  const { releaseSummarySentence } = await import("../src/releases.js");
  assert.equal(releaseSummarySentence(4, 4), "Showing 4 releases, newest first.");
  assert.equal(releaseSummarySentence(1, 4), "Showing 1 of 4 releases, newest first.");

  // Every heading on the page, h1 through h6, whatever region it sits in.
  const headings = [...page.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)]
    .map((match) => match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  assert.ok(headings.length >= 6, `only ${headings.length} headings found; the markup shape changed`);
  const repeated = [...new Set(headings.filter((text, index) => headings.indexOf(text) !== index))];
  assert.deepEqual(repeated, [], `two headings read the same: ${repeated.join(" · ")}`);
});

// The demo seed is hand-authored data that ships to production and renders the
// list/detail views in review. It is edited by hand (this task renamed release
// `author` -> `owner` and added `alternatives`), so guard it the same way the
// social seed is guarded: a bad status, an over-length field, a mistyped
// decisionId, or a broken shape should fail the build, not ship silently.
test("releases demo seed is valid and internally consistent", async () => {
  const { SEED_DECISIONS, SEED_RELEASES } = await import("../src/seed-records.js");
  const seed = { decisions: SEED_DECISIONS, releases: SEED_RELEASES };
  assert.ok(Array.isArray(seed.decisions) && seed.decisions.length > 0);
  assert.ok(Array.isArray(seed.releases) && seed.releases.length > 0);
  assert.ok(seed.decisions.some(({ title, context, owner, status }) =>
    title && context && owner && status), "the index has a complete representative decision");
  assert.ok(seed.releases.some(({ title, createdAt, decisionIds }) =>
    title && !Number.isNaN(Date.parse(createdAt)) && decisionIds.length > 0),
  "the index has a dated representative release with associated decisions");

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

/* ------------------- one name, one label per destination ------------------ */
//
// (#1961) This page used to call the same thing four names — "the build this
// site is running", "the running deployment", "the version this site is running
// right now", "the running build's version or commit identifier" — across the
// two regions that talk about it, and it put two labels on one address and one
// label on two addresses. These tests boot the shipped markup the way the
// browser boots it, so what is asserted is what a visitor reads.

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const PAGE_SHA = "0123456789abcdef0123456789abcdef01234567";
const PAGE_STAMP = Object.freeze({
  schemaVersion: 1,
  commitSha: PAGE_SHA,
  builtAt: "2026-08-17T08:00:00.000Z",
});

// The stamp and the health read are both injected, so nothing opens a socket
// and the record is the same one in every run. `settle: false` stops at the
// state a visitor meets while the probe is outstanding — which is where the
// waiting line still says what is being retrieved.
async function openReleasesPage(t, { settle = true } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify([]) },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    location: { pathname: "/releases.html", origin: "https://labs.wawalu.org", search: "", hash: "" },
    history: { replaceState() {} },
    buildStamp: PAGE_STAMP,
    readHealth: settle
      ? async () => ({ status: "healthy", version: PAGE_SHA })
      : () => new Promise(() => {}),
    now: () => "2026-08-17T12:00:00.000Z",
  });
  await waitFor(
    () => page.document.documentElement.dataset[settle ? "shiplogDeployment" : "shiplogReleases"] === "ready",
    settle ? "the deployment check never answered" : "the releases page never finished rendering",
  );
  return page;
}

// Every anchor inside <main>, collected the only way this harness allows: one
// tag per querySelectorAll call (a comma selector matches nothing without
// throwing, a descendant selector throws), then filtered by walking parentNode.
// A withdrawn control is not a label a visitor can read, so hidden links are
// left out.
function mainLinks(document, { without = [] } = {}) {
  const main = document.querySelector("#main-content");
  return document.querySelectorAll("a").filter((node) => {
    if (node.hidden === true) return false;
    let inside = false;
    for (let current = node; current; current = current.parentNode) {
      if (without.includes(current.id)) return false;
      if (current === main) inside = true;
    }
    return inside;
  });
}

// The name a link is offered under. An aria-label overrides the visible words,
// and the log's rows use one so four rows drawing "View release details" still
// name four different releases.
const linkLabel = (link) => link.getAttribute("aria-label") ?? textOf(link);

function labelMap(links, key, value) {
  const map = new Map();
  for (const link of links) {
    const from = key(link);
    if (!map.has(from)) map.set(from, new Set());
    map.get(from).add(value(link));
  }
  return map;
}

// What the search field narrows to, in the shape the two filters beside it
// already use. The sentence is a claim about filterReleases, so it is held to
// that function rather than to itself: every field it names has to find a
// release, and the fields it leaves out have to find nothing.
const SEARCH_SCOPE_HINT = "Shows releases matching your text in their title or summary, "
  + "or in the title or context of a linked decision.";

test("the search field says which parts of a release it matches, and matches those", async (t) => {
  const page = await openReleasesPage(t);
  const input = page.document.querySelector("#release-search");
  const label = [...page.document.querySelectorAll("label")].find((node) => node.getAttribute("for") === "release-search");
  assert.equal(textOf(label), "Search releases");

  // Described by the line, not merely printed beside it — the association the
  // linked-decision filter below it already carries.
  assert.equal(input.getAttribute("aria-describedby"), "release-search-hint");
  assert.equal(textOf(page.document.getElementById("release-search-hint")), SEARCH_SCOPE_HINT);

  // One term per field, sharing no word with any other, so a hit names the
  // field it came through. The release is titled, which is what keeps its
  // version out of the search: an untitled release falls back to it.
  const scopeDecisions = [
    { id: "d-scope", title: "Zephyr", context: "Quilting", owner: "Ari", status: "accepted", createdAt: "2026-06-01T00:00:00.000Z" },
  ];
  const scoped = [{
    id: "r-scope",
    version: "v9.9.9-perihelion",
    title: "Nightjar",
    description: "Cormorant",
    owner: "Wolstenholme",
    status: "completed",
    createdAt: "2026-06-02T00:00:00.000Z",
    decisionIds: ["d-scope"],
  }];
  const finds = (query) => filterReleases(scoped, scopeDecisions, { query }).length === 1;
  for (const term of ["Nightjar", "Cormorant", "Zephyr", "Quilting"]) {
    assert.ok(finds(term), `search no longer matches "${term}", which the help line promises it does`);
  }
  for (const term of ["perihelion", "Wolstenholme"]) {
    assert.equal(finds(term), false, `search matches "${term}", which the help line does not name`);
  }
});

const RETIRED_NAMES = [
  "the running deployment",
  "the version this site is running right now",
  "the running build’s version or commit identifier",
  // The three names this page used to give the one record it does not invent,
  // beside the name it kept: the block was headed "The running build", its copy
  // control offered "this real release", and the check's evidence called the
  // thing it compared against "the release record". A reader met four names for
  // one artifact on one screen and had to work out that they were one.
  "The running build",
  "this real release",
  "the release record it was compared with",
];

test("the real record of this deployment has one name everywhere the page names it", async (t) => {
  const page = await openReleasesPage(t);
  const record = textOf(page.document.querySelector("#shipped-build"));
  const check = textOf(page.document.querySelector("#deployment-status"));

  // The name, in the three places the page offers the record: the heading a
  // reader scanning headings meets first, the link that opens it, and the
  // control that hands over its address.
  assert.equal(textOf(page.document.querySelector("#shipped-build-title")), "Real record of this deployment");
  assert.equal(textOf(page.document.querySelector("#shipped-build-marking")), "Build-generated record");
  assert.equal(
    record.match(/Real record of this deployment/g)?.length,
    1,
    "the deployment-proof heading is the record block's only full-name occurrence",
  );
  assert.equal(textOf(page.document.querySelector("#deployment-release-record")), REAL_RECORD_LINK_LABEL);
  assert.equal(
    textOf(page.document.querySelector("#shipped-build-copy")),
    "Copy link to the real record of this deployment",
  );
  assert.equal(REAL_RECORD_LINK_LABEL, "Open the real record of this deployment");

  // The check keeps its own name and still says in one sentence what it
  // compares — naming the compared-against record in those same words, in its
  // question, its waiting line, its verdict and the heading of its evidence.
  assert.match(check, /^Deployment check /);
  assert.match(check, /Does the real record of this deployment name the running build’s version\?/);
  assert.match(check, /the version the real record of this deployment names\./);
  assert.match(check, /Evidence: what the running build answered, and the real record of this deployment it was compared with/);

  // "The running build" is now only ever the deployment the check reads a
  // version from, never the record it is compared with.
  assert.match(check, /It reads the running build when the page loads\./);
  assert.doesNotMatch(record, /running build/i, "the record is named after the build again");
  for (const region of [record, check]) {
    assert.match(region, /real record of this deployment/, "a region reaches for a second name for the record");
  }

  // Gone from everything the page renders, not just from the two regions —
  // including the evidence disclosure, which this harness reads through, and
  // which prints the record's own title.
  const rendered = textOf(page.document.querySelector("#main-content"));
  for (const retired of RETIRED_NAMES) {
    assert.equal(rendered.includes(retired), false, `the rendered page still says "${retired}"`);
  }
  // And gone from the bytes, so no state this test did not drive can bring one
  // back: the waiting line and the unstamped state's words are in here too.
  const markup = await readFile(RELEASES_PAGE, "utf8");
  for (const retired of RETIRED_NAMES) {
    assert.equal(markup.includes(retired), false, `src/releases.html still ships "${retired}"`);
  }
});

test("the deployment proof renders one record heading without losing its verification path", async (t) => {
  const page = await openReleasesPage(t);
  const headings = page.document.querySelectorAll("h1, h2, h3, h4, h5, h6")
    .filter((heading) => textOf(heading) === "Real record of this deployment");

  assert.equal(headings.length, 1, "the rendered page repeats the deployment-record heading");
  assert.equal(headings[0].getAttribute("id"), "shipped-build-title");
  assert.equal(
    textOf(page.document.querySelector("#shipped-build-note")),
    "This record is not an example. The build that produced the page you are reading wrote it,"
      + " from the commit that build was made from. Open that commit below and check it against"
      + " the public repository.",
  );

  const source = page.document.querySelector("#shipped-build-source");
  assert.match(textOf(source), /^Open commit [0-9a-f]{12} in the public repository$/);
  assert.match(source.getAttribute("href"), /github\.com\/AndrewLikesTea\/wawalu-agent-lab\/commit\/[0-9a-f]{40}$/);

  assert.equal(textOf(page.document.querySelector("#deployment-status-title")), "Deployment check");
  assert.equal(
    textOf(page.document.querySelector("#deployment-status-proof")),
    "Does the real record of this deployment name the running build’s version? It reads the"
      + " running build when the page loads. The example decision and release above are invented;"
      + " that record and this answer are not.",
  );
});

test("the waiting line names the running build's version, before the check answers", async (t) => {
  const page = await openReleasesPage(t, { settle: false });
  assert.equal(
    textOf(page.document.querySelector("#deployment-verdict")),
    "Retrieving the running build’s version… That version is compared with"
    + " the real record of this deployment, not with the invented example records.",
  );
});

test("no label in main content serves two destinations", async (t) => {
  const page = await openReleasesPage(t);
  const links = mainLinks(page.document);
  assert.ok(links.length >= 8, `only ${links.length} links found in main; the markup shape changed`);
  for (const link of links) {
    // Both hrefs the modules write are assigned as attributes as well as
    // properties, so the attribute is the whole truth here.
    const href = link.getAttribute("href") ?? "";
    assert.notEqual(linkLabel(link), "", `a link to ${href} has no label`);
    assert.notEqual(href, "", `the link "${linkLabel(link)}" names no destination`);
  }

  // The whole of main, the log's rows included: a reader who meets the same
  // words twice must land in the same place both times. The log's rows are the
  // reason this direction is asserted over all of main and the other direction
  // is not — the example record and a row of the log can both offer the same
  // decision, in the same words, and that is one destination named once.
  const spread = [...labelMap(links, linkLabel, (link) => link.getAttribute("href") ?? "")]
    .filter(([, hrefs]) => hrefs.size > 1)
    .map(([label, hrefs]) => `"${label}" → ${[...hrefs].join(" and ")}`);
  assert.deepEqual(spread, [], `one label serves more than one destination: ${spread.join("; ")}`);
});

// The other direction, over the regions this page authors rather than lists.
//
// It is deliberately not asserted over the release log: a row in an index, a
// prioritised follow-up naming the work to do, and the worked example naming a
// release by its version all legitimately offer the same record in their own
// words, and flattening those to one label would take the follow-up's words
// away from the action it is asking for. The regions below have no such
// excuse — they sit on one screen, and two of them drew a second name for a
// record already named beside them.
test("no destination in the page's authored regions is offered under two labels", async (t) => {
  const page = await openReleasesPage(t);
  const links = mainLinks(page.document, { without: ["release-list", "release-followup"] });
  assert.ok(links.length >= 6, `only ${links.length} links found; the markup shape changed`);

  const renamed = [...labelMap(links, (link) => link.getAttribute("href") ?? "", linkLabel)]
    .filter(([, labels]) => labels.size > 1)
    .map(([href, labels]) => `${href} ← ${[...labels].map((l) => `"${l}"`).join(" and ")}`);
  assert.deepEqual(renamed, [], `one destination is offered under more than one label: ${renamed.join("; ")}`);

  // And no destination is offered twice under the one label it has, which is
  // what a reader actually meets: a link list that reads "Open the real record
  // of this deployment" twice and "Open commit 0123456789ab in the public
  // repository" twice, four entries for two places. One label per destination
  // AND one link per label, so those two rules together make the labels in
  // these regions a set of distinct names for a set of distinct places.
  const labels = links.map(linkLabel);
  const twice = labels.filter((label, index) => labels.indexOf(label) !== index);
  assert.deepEqual(twice, [], `two links read as the same thing: ${twice.map((l) => `"${l}"`).join(", ")}`);
  const hrefs = links.map((link) => link.getAttribute("href"));
  assert.equal(new Set(hrefs).size, hrefs.length, "two links in these regions go to the same place");

  // The record is still offered, once, by the deployment check — the band that
  // needs to say which record it compared against. Read off the rendered DOM,
  // because deployment-status-view.js writes that label rather than the markup.
  const checkRecord = page.document.querySelector("#deployment-release-record");
  assert.equal(textOf(checkRecord), REAL_RECORD_LINK_LABEL);
  assert.equal(checkRecord.getAttribute("href"), "/releases.html#shipped-build");
  assert.equal(page.document.querySelectorAll("#shipped-build-detail").length, 0);
  assert.equal(page.document.querySelectorAll("#deployment-commit").length, 0);
});

test("the loading page clearly discloses one actionable invented release with both detail routes", async (t) => {
  const page = await loadPage(RELEASES_PAGE);
  t.after(() => page.restore());
  const loading = page.document.querySelector(".list-state-loading");
  const demo = page.document.querySelector("#shiplog-proof");
  const real = page.document.querySelector("#shipped-build");

  assert.ok(loading, "the release log is visibly pending before its module boots");
  assert.equal(page.document.querySelectorAll("#shiplog-proof").length, 1);
  assert.equal(demo.getAttribute("aria-labelledby"), "shiplog-proof-title");
  assert.equal(demo.getAttribute("aria-describedby"), "shiplog-proof-note");
  assert.match(textOf(demo), /Example records/);
  assert.match(textOf(demo), /invented records demonstrate Shiplog/);
  assert.match(textOf(demo), /demonstration data, not live release-log data/i);
  for (const value of ["Versionv1.3.0", "Release statusCompleted", "Release ownerKai", "SummaryThroughput and latency", "Linked decisionAdopt a durable job queue"]) {
    assert.match(textOf(demo), new RegExp(value));
  }

  assert.ok(demo.classList.contains("shiplog-demo"), "the demonstration has its own visual treatment");
  assert.ok(real.classList.contains("shiplog-real"), "the running build retains its real-record treatment");
  assert.equal(demo.classList.contains("shiplog-real"), false);
  const links = demo.querySelectorAll("a");
  assert.ok(links.some((link) => link.getAttribute("href") === "/release.html?id=demo-r-1-3-0"));
  assert.ok(links.some((link) => link.getAttribute("href") === "/decision.html?id=demo-queue"));
});

test("the example record's completed status is cased the way its filter option is", async (t) => {
  const page = await openReleasesPage(t);
  assert.match(textOf(page.document.querySelector("#shiplog-proof")), /Release statusCompleted/);

  const option = page.document.querySelectorAll("option")
    .find((node) => node.getAttribute("value") === "completed");
  assert.ok(option, "the release status filter lost its completed option");
  assert.equal(textOf(option), "Completed");

  const markup = await readFile(RELEASES_PAGE, "utf8");
  const badge = markup.match(/<dt>Release status<\/dt><dd><span class="badge badge-release-completed">([^<]+)</);
  assert.ok(badge, "the example record no longer renders a release status badge");
  assert.equal(badge[1], textOf(option), "the example record and the filter case the same status differently");
});
