// How much of the log on the homepage carries its reasoning.
//
// The claim under test is a counting claim, so every assertion here drives the
// shipped page — the real markup from src/index.html, booted the way the page
// boots it — and reads the sentence out of the DOM after moving a real control.
// Nothing asserts against a number a helper handed back: the point of the line
// is that it describes the rows a visitor can actually see, and the only way to
// know it does is to change what is on screen and read it again.
//
// The fact being counted is the release's own `decisionIds`, which is why the
// fixtures below set that field explicitly rather than relying on the demo seed.

import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, releaseCoverageLine, STORAGE_KEY, toHistoryRecords } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { SEED_RELEASES } from "../src/seed-records.js";
import { DomEvent, loadPage, tabSequence, textOf, typeText } from "./support/browser.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const NO_DEMO_DATA = { decisions: [], releases: [] };

const decision = (id, title, extra = {}) => ({
  id,
  title,
  context: `Why ${title.toLocaleLowerCase()}.`,
  alternatives: "Leave it alone.",
  owner: "Ari",
  status: "accepted",
  createdAt: "2026-01-04T09:00:00.000Z",
  ...extra,
});

const DECISIONS = [
  decision("d-cache", "Cache the read path"),
  decision("d-flags", "Introduce feature flags"),
  decision("d-queue", "Adopt a durable job queue"),
];

// "shipped" appears in three of the four descriptions and in none of the
// decisions, so a search for it narrows the releases without narrowing them to
// one — which is what makes it a test of the numbers and not of the wording.
const release = (id, version, title, description, decisionIds, day) => ({
  id,
  version,
  title,
  description,
  status: "completed",
  owner: "Ari",
  createdAt: `2026-02-0${day}T09:00:00.000Z`,
  decisionIds,
});

const RELEASES = [
  release("r-1-1-0", "v1.1.0", "Read path latency", "The read cache shipped.", ["d-cache"], 1),
  release("r-1-2-0", "v1.2.0", "Flag rollout", "Flags shipped behind a gate.", ["d-flags"], 2),
  release("r-1-3-0", "v1.3.0", "Queue cutover", "The queue cutover shipped.", ["d-queue"], 3),
  release("r-1-4-0", "v1.4.0", "Housekeeping", "Dependency bumps, no behaviour change.", [], 4),
];

async function openHistory(t, { decisions = DECISIONS, releases = RELEASES } = {}) {
  const page = await loadPage(DECISIONS_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, { seed: NO_DEMO_DATA });
  assert.equal(
    page.document.documentElement.dataset.shiplog,
    "ready",
    "the history never finished rendering",
  );
  return page;
}

// The same page with the shipped demonstration records composed in behind the
// visitor's own, which is what a real visitor who has recorded something sees.
async function openMixedHistory(t) {
  const page = await loadPage(DECISIONS_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(DECISIONS),
      [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
    },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  assert.equal(page.document.documentElement.dataset.shiplog, "ready");
  return page;
}

const coverage = (page) => textOf(page.document.querySelector("#release-coverage"));
const rows = (page) => page.document.querySelector("#decision-list").querySelectorAll(".history-card");
const rowTitles = (page) => rows(page).map((card) => textOf(card.querySelector("h3")));

function search(page, query) {
  const input = page.document.querySelector("#decision-search");
  input.focus();
  typeText(page.document, query);
}

function chooseOption(page, selector, value) {
  const select = page.document.querySelector(selector);
  select.value = value;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const NO_RELEASES = "No releases are listed here, so there are none to count.";

// The figure names the records it counted, in the line itself (#2539), from the
// same helper as the split count in the heading. Every release in these fixtures
// is stored in this browser and the demonstration seed is switched off, so the
// example half of the note is empty here; the mixed log is exercised by its own
// test below, which boots the page with the shipped seed in it.
const yoursOnly = (releases) => ` Counted here: no example records and ${releases} you added.`;

test("the history says how many of the releases it lists carry a linked decision", async (t) => {
  const page = await openHistory(t);

  assert.equal(rows(page).length, 7, "all three decisions and all four releases are listed");
  assert.equal(
    coverage(page),
    "Of the 4 releases shown by the current filters, 3 carry at least one linked decision and 1 does not."
    + yoursOnly(4),
  );
});

test("searching narrows the list and both numbers with it", async (t) => {
  const page = await openHistory(t);

  // Three of the four releases describe themselves as shipped; the fourth does
  // not, and it is the one with no decision behind it.
  search(page, "shipped");
  assert.deepEqual(rowTitles(page), [
    "v1.3.0 · Queue cutover",
    "v1.2.0 · Flag rollout",
    "v1.1.0 · Read path latency",
  ]);
  assert.equal(
    coverage(page),
    "All 3 releases shown by the current filters carry at least one linked decision." + yoursOnly(3),
  );

  page.document.querySelector("#clear-decision-filters").click();
  assert.equal(
    coverage(page),
    "Of the 4 releases shown by the current filters, 3 carry at least one linked decision and 1 does not."
    + yoursOnly(4),
    "clearing the search restores the count over the whole log",
  );
});

test("a search that leaves one release says so in the singular", async (t) => {
  const page = await openHistory(t);

  search(page, "Housekeeping");
  assert.deepEqual(rowTitles(page), ["v1.4.0 · Housekeeping"]);
  assert.equal(
    coverage(page),
    "The one release shown by the current filters carries no linked decision." + yoursOnly(1),
  );

  page.document.querySelector("#clear-decision-filters").click();
  search(page, "v1.1");
  assert.deepEqual(rowTitles(page), ["v1.1.0 · Read path latency"]);
  assert.equal(
    coverage(page),
    "The one release shown by the current filters carries at least one linked decision." + yoursOnly(1),
  );
});

test("filtering to decisions leaves no releases to count, and never counts zero of zero", async (t) => {
  const page = await openHistory(t);

  page.document.querySelector("#record-type-decision").click();
  assert.equal(rowTitles(page).length, 3, "only the decisions are listed");
  assert.equal(coverage(page), NO_RELEASES);

  page.document.querySelector("#record-type-release").click();
  assert.equal(
    coverage(page),
    "Of the 4 releases shown by the current filters, 3 carry at least one linked decision and 1 does not."
    + yoursOnly(4),
    "filtering to releases counts the same four",
  );
});

test("the decisions-in-release filter leaves no releases to count", async (t) => {
  const page = await openHistory(t);

  // This filter answers "which decisions did this release carry?", so the
  // release rows themselves drop out of the list — and the line must follow the
  // list rather than keep describing the releases that are no longer on it.
  chooseOption(page, "#filter-release", "r-1-1-0");
  assert.deepEqual(rowTitles(page), ["Cache the read path"]);
  assert.equal(coverage(page), NO_RELEASES);
});

test("current only hides superseded decisions and leaves the release count honest", async (t) => {
  const page = await openHistory(t, {
    decisions: [
      ...DECISIONS,
      decision("d-poll", "Poll the database"),
      decision("d-queue-2", "Move the queue to the edge", { supersedes: "d-poll" }),
    ],
  });

  assert.ok(rowTitles(page).includes("Poll the database"));
  const before = coverage(page);
  assert.equal(
    before,
    "Of the 4 releases shown by the current filters, 3 carry at least one linked decision and 1 does not."
    + yoursOnly(4),
  );

  page.document.querySelector("#filter-current-only").click();

  assert.equal(
    rowTitles(page).includes("Poll the database"),
    false,
    "the superseded decision left the list",
  );
  // A release is never superseded, so this filter cannot remove one. The line
  // is still recomputed on this render and still describes exactly the releases
  // on screen — which, here, are the same four.
  assert.equal(coverage(page), before);
});

// The half that the fixtures above cannot exercise: a log with both kinds of
// record in it. The note is derived from the same rows the claim counts, so it
// follows a filter rather than describing the whole log (#2539).
test("the coverage figure names both kinds of record it counted, and follows the filters", async (t) => {
  const page = await openMixedHistory(t);
  const examples = SEED_RELEASES.length;

  assert.match(
    coverage(page),
    new RegExp(`^(Of|All|None of) the ${examples + RELEASES.length} releases `),
    "the claim stopped counting the whole visible set of releases",
  );
  assert.match(
    coverage(page),
    new RegExp(` Counted here: ${examples} example records and ${RELEASES.length} you added\\.$`),
  );

  // Narrowing to the visitor's own release notes leaves the examples out of the
  // figure, and the note says so instead of still claiming them.
  search(page, "Dependency bumps");
  assert.deepEqual(rowTitles(page), ["v1.4.0 · Housekeeping"]);
  assert.match(coverage(page), / Counted here: no example records and 1 you added\.$/);
});

test("a log with no releases in it says there are none to count", async (t) => {
  const page = await openHistory(t, { decisions: [], releases: [] });

  assert.equal(coverage(page), NO_RELEASES);
  assert.doesNotMatch(textOf(page.document.getElementById("main-content")), /0 of 0/);
});

test("the plural and all-or-nothing wordings read as English", async (t) => {
  const records = (releases) => toHistoryRecords(DECISIONS, releases);

  assert.equal(
    releaseCoverageLine(records([...RELEASES, release("r-1-5-0", "v1.5.0", "Chores", "More bumps.", [], 5)])),
    "Of the 5 releases shown by the current filters, 3 carry at least one linked decision and 2 do not."
    + yoursOnly(5),
  );
  assert.equal(
    releaseCoverageLine(records(RELEASES.slice(0, 3))),
    "All 3 releases shown by the current filters carry at least one linked decision." + yoursOnly(3),
  );
  assert.equal(
    releaseCoverageLine(records([
      release("r-a", "v2.0.0", "One", "No decision.", [], 1),
      release("r-b", "v2.1.0", "Two", "No decision either.", [], 2),
    ])),
    "None of the 2 releases shown by the current filters carries a linked decision." + yoursOnly(2),
  );
  assert.equal(releaseCoverageLine(records([])), NO_RELEASES);
  assert.equal(releaseCoverageLine(), NO_RELEASES);

  // A release whose decision went missing in an import still named one: the row
  // reports the dangling reference itself, and this line is about the releases
  // that never recorded a reason at all.
  assert.equal(
    releaseCoverageLine(records([release("r-c", "v3.0.0", "Three", "Gone.", ["no-such-decision"], 1)])),
    "The one release shown by the current filters carries at least one linked decision." + yoursOnly(1),
  );
});

test("the line sits with the list it describes, adds no tab stop, and names its own records", async (t) => {
  const page = await openHistory(t);
  const node = page.document.querySelector("#release-coverage");

  // Reachable with the list rather than announced away from it. It used to lean
  // on the panel's caveat for whose records it counted and was pinned against
  // restating it; #2539 reverses that — a counted figure names its own records,
  // so a reader who meets the number first still knows what is inside it. The
  // page-level sentence is untouched and still said exactly once, so nothing
  // counting that statement moves.
  const panel = page.document.querySelector(".list-panel");
  const disclosure = "Includes example records to demonstrate Shiplog. They use no customer or production data.";
  assert.equal(textOf(panel).split(disclosure).length - 1, 1);
  assert.match(coverage(page), /Counted here: no example records and 4 you added\.$/);
  // The caveat itself is not repeated per figure: the line names the records it
  // counted and says nothing about customer data, which the panel already owns.
  assert.doesNotMatch(coverage(page), /customer or production data/);
  assert.equal(node.getAttribute("role"), null, "the list's own status region carries the announcement");
  assert.equal(node.getAttribute("aria-live"), null);

  // No control of any kind: index.html's first screen is at its tab-stop budget.
  assert.equal(node.children.filter((child) => child.getAttribute).length, 0);
  assert.equal(
    tabSequence(page.document).filter((stop) => stop.getAttribute?.("id") === "release-coverage").length,
    0,
  );

  const markup = await (await import("node:fs/promises")).readFile(DECISIONS_PAGE, "utf8");
  assert.ok(markup.indexOf('id="release-coverage"') < markup.indexOf('id="decision-list"'));
  assert.ok(markup.indexOf('id="history-timelines"') < markup.indexOf('id="release-coverage"'));
});
