// "Accepted, not yet released" in the decision history (#2979).
//
// The row already answers "which release shipped this?" (#1085, pinned by
// tests/history-shipped-in.test.js). This suite pins the gap #2979 added: a
// status-filter option that leaves only the accepted decisions whose row says
// "Not yet shipped", ANDed with every other filter, counted in the existing
// count and summary, and invisible to the exported records.
//
// Harness rules followed here: options are proved present before a select is
// set (a harness select takes any value), assertions are on counts and text
// rather than `equal(node, null)`, and no descendant selectors are used.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { STORAGE_KEY, awaitingRelease, initDecisionLog, selectHistory, toHistoryRecords } from "../src/app.js";
import {
  UNRELEASED_LABEL,
  UNRELEASED_STATUS,
  historyFilterChips,
  historyFilterSearch,
  parseHistoryFilters,
} from "../src/history-filters.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initShiplogExport } from "../src/shiplog-export.js";
import { DomEvent, loadPage, textOf } from "./support/browser.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const NO_DEMO_DATA = { decisions: [], releases: [] };
const XSS_VERSION = "<img src=x onerror=alert(1)>v2";

const decision = (id, title, owner, status = "accepted") => ({
  id: `unrel-${id}`,
  title,
  context: `Why ${title.toLowerCase()}.`,
  alternatives: "None considered",
  owner,
  status,
  createdAt: "2026-03-01T09:00:00.000Z",
});

// queue: accepted, shipped twice (once under a version that is markup).
// cache, cron: accepted, in no release — the two the filter must leave.
// flags: pending, in no release — unreleased but not accepted.
const DECISIONS = [
  decision("queue", "Adopt a durable queue", "Mina"),
  decision("cache", "Cache the read path", "Mina"),
  decision("cron", "Retire the cron worker", "Kai"),
  decision("flags", "Introduce feature flags", "Mina", "pending"),
];

const release = (id, version, createdAt, decisionIds) => ({
  id: `unrel-r-${id}`,
  version,
  title: `Release ${id}`,
  description: "Shipped.",
  owner: "Kai",
  status: "completed",
  createdAt,
  decisionIds,
});

const RELEASES = [
  release("1", "v1.0.0", "2026-03-05T09:00:00.000Z", ["unrel-queue"]),
  release("2", XSS_VERSION, "2026-04-05T09:00:00.000Z", ["unrel-queue"]),
];

const titles = (records) => records.map((record) => record.title);

// --- the predicate and the pure view ----------------------------------------

test("only accepted decisions with no readable release survive the filter", () => {
  const records = toHistoryRecords(DECISIONS, RELEASES);
  assert.deepEqual(
    titles(selectHistory(records, { status: UNRELEASED_STATUS, sort: "title" })),
    ["Cache the read path", "Retire the cron worker"],
  );
});

test("an unreadable release and a repository record are not 'not yet released'", () => {
  // A release that names the decision but cannot be named itself (no version)
  // leaves the row "unresolved": the association exists, so it is not unreleased.
  const [ghost] = toHistoryRecords(
    [decision("ghost", "Ghost", "Kai")],
    [{ ...release("3", "", "2026-03-05T09:00:00.000Z", ["unrel-ghost"]) }],
  );
  assert.equal(ghost.shipped.state, "unresolved");
  assert.equal(awaitingRelease(ghost), false);
  // A repository record shipped through its pull request.
  const [repo] = toHistoryRecords([{ ...decision("repo", "Repo", "Kai"), repository: { pullRequest: 1 } }], []);
  assert.equal(awaitingRelease(repo), false);
  assert.equal(awaitingRelease({ type: "release", status: "completed" }), false);
});

test("the filter ANDs with owner, text and record type", () => {
  const records = toHistoryRecords(DECISIONS, RELEASES);
  const select = (view) => titles(selectHistory(records, { status: UNRELEASED_STATUS, sort: "title", ...view }));
  assert.deepEqual(select({ owner: "Kai" }), ["Retire the cron worker"]);
  assert.deepEqual(select({ query: "cache" }), ["Cache the read path"]);
  assert.deepEqual(select({ query: "queue" }), []);
  assert.deepEqual(select({ type: "release" }), []);
});

test("the option survives a shared link and names itself on its chip", () => {
  assert.equal(historyFilterSearch({ status: UNRELEASED_STATUS }), "?status=unreleased");
  assert.equal(parseHistoryFilters("?status=unreleased").status, UNRELEASED_STATUS);
  const [chip] = historyFilterChips({ status: UNRELEASED_STATUS });
  assert.equal(chip.text, `Status: ${UNRELEASED_LABEL}`);
});

// --- the page ----------------------------------------------------------------

async function openHistory(t) {
  const page = await loadPage(DECISIONS_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify(DECISIONS), [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES) },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, { seed: NO_DEMO_DATA });
  initShiplogExport(page.document, page.storage);
  assert.equal(page.document.documentElement.dataset.shiplog, "ready");
  return page;
}

const rowTitles = (page) => page.document.querySelector("#decision-list").querySelectorAll("article")
  .map((article) => textOf(article.querySelector("h3")));
const count = (page) => textOf(page.document.querySelector("#decision-count"));
const summary = (page) => textOf(page.document.querySelector("#history-filter-summary"));

function chooseOption(page, selector, value) {
  const select = page.document.querySelector(selector);
  assert.ok([...select.options].some((option) => option.value === value), `${selector} offers no ${value}`);
  select.value = value;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

function typeSearch(page, value) {
  const search = page.document.querySelector("#decision-search");
  search.value = value;
  search.dispatchEvent(new DomEvent("input", { bubbles: true }));
}

test("the status select offers the option, and the count follows each AND", async (t) => {
  const page = await openHistory(t);
  const option = [...page.document.querySelector("#filter-status").options]
    .find((candidate) => candidate.value === UNRELEASED_STATUS);
  assert.equal(textOf(option), UNRELEASED_LABEL);
  assert.equal(rowTitles(page).length, 6);

  chooseOption(page, "#filter-status", UNRELEASED_STATUS);
  assert.deepEqual(rowTitles(page).sort(), ["Cache the read path", "Retire the cron worker"]);
  assert.match(count(page), /^2 of 6 records/);
  assert.match(summary(page), /^2 of 6 records/);

  chooseOption(page, "#filter-owner", "Kai");
  assert.deepEqual(rowTitles(page), ["Retire the cron worker"]);
  assert.match(count(page), /^1 of 6 records/);
  assert.match(summary(page), /^1 of 6 records/);

  chooseOption(page, "#filter-owner", "all");
  typeSearch(page, "cache");
  assert.deepEqual(rowTitles(page), ["Cache the read path"]);
  assert.match(summary(page), /^1 of 6 records/);

  // Switching back to a stored status replaces it: one select, one status.
  chooseOption(page, "#filter-status", "accepted");
  assert.deepEqual(rowTitles(page), ["Cache the read path"]);
  typeSearch(page, "");
  assert.equal(rowTitles(page).length, 3);
  assert.match(summary(page), /^3 of 6 records/);
});

test("a release version that is markup renders as its literal characters", async (t) => {
  const page = await openHistory(t);
  const queue = page.document.querySelector("#decision-list").querySelectorAll("article")
    .find((article) => textOf(article.querySelector("h3")) === "Adopt a durable queue");
  const latest = queue.querySelector(".shipped-latest-version");
  assert.equal(latest.textContent, XSS_VERSION);
  assert.equal(queue.querySelectorAll("img").length, 0);
  assert.match(textOf(queue.querySelector(".shipped-more")), /^\+1 more$/);
  // The row's renderer builds the line from text nodes only.
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function appendShippedIn("), source.indexOf("function appendShippedIn(") + 4000);
  assert.doesNotMatch(body, /innerHTML|insertAdjacentHTML/);
});

test("exported records keep their key set under the filter", async (t) => {
  const page = await openHistory(t);
  const download = () => {
    page.document.querySelector("#export-shiplog").click();
    return JSON.parse(page.downloads.at(-1).text);
  };
  const keysOf = (payload, id) => Object.keys(payload.decisions.find((record) => record.id === id)).sort();
  const before = download();
  chooseOption(page, "#filter-status", UNRELEASED_STATUS);
  const after = download();
  assert.deepEqual(after.decisions.map((record) => record.id).sort(), ["unrel-cache", "unrel-cron"]);
  assert.deepEqual(keysOf(after, "unrel-cache"), keysOf(before, "unrel-cache"));
  assert.deepEqual(keysOf(after, "unrel-cache"), Object.keys(DECISIONS[1]).sort());
});

test("the shipped line wraps at any width and keeps touch-sized links when narrow", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.record-links \{ display:flex; flex-wrap:wrap;/);
  assert.match(css, /@media\(max-width:520px\) \{ \.record-links\{padding:0 16px 4px\}\.record-link,\.record-link-missing\{min-height:44px\} \}/);
});
