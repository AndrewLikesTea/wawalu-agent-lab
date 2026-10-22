// Releases that shipped a decision nobody has accepted (issue #2978).
//
// Two layers, matching src/releases.js. The pure core — which linked decisions
// count as not accepted, and the lead sentence's singular and plural — is
// asserted directly. The row line and the "Only releases with unaccepted
// decisions" checkbox are driven through the shipped src/releases.html, so what
// is pinned is what a reader sees: the line on a collapsed row, its links, the
// count in #release-count, and a title holding markup rendered as text.
//
// Determinism: no network, no timers. Every test seeds its own fixtures.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import {
  RELEASE_STORAGE_KEY,
  UNKNOWN_DECISION_LABEL,
  filterReleases,
  releaseFilterSummary,
  summarizeReleases,
  unacceptedDecisions,
  unacceptedDecisionsLead,
} from "../src/releases.js";
import { readReleaseFilters, releaseFilterSearch } from "../src/release-filter-url.js";
import { initReleasesPage } from "../src/releases-page.js";
import { loadPage, tabSequence, textOf } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };

const DECISIONS = [
  { id: "d-queue", title: "Adopt a durable queue", context: "Retries.", owner: "Kai", status: "accepted", createdAt: "2026-01-02T09:00:00.000Z" },
  { id: "d-legacy", title: "Use one region", context: "Cost.", owner: "Lee", status: "approved", createdAt: "2026-01-02T10:00:00.000Z" },
  { id: "d-cache", title: "Cache the read path", context: "Latency.", owner: "Ari", status: "pending", createdAt: "2026-01-03T09:00:00.000Z" },
  { id: "d-flags", title: "Ship behind feature flags", context: "Rollout.", status: "proposed", createdAt: "2026-01-04T09:00:00.000Z" },
  { id: "d-csv", title: "Sunset the CSV export", context: "JSON.", owner: "Mina", status: "superseded", createdAt: "2026-01-05T09:00:00.000Z" },
  { id: "d-odd", title: "Rejected idea", context: "No.", owner: "Sam", status: "rejected", createdAt: "2026-01-06T09:00:00.000Z" },
];

// Newest first once sorted: mixed, unknown, accepted, none.
const RELEASES = [
  { id: "r-none", version: "v1.0.0", title: "No links", description: "Nothing linked.", status: "completed", owner: "Kai", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: [] },
  { id: "r-clear", version: "v1.1.0", title: "All accepted", description: "Settled.", status: "completed", owner: "Kai", createdAt: "2026-03-01T00:00:00.000Z", decisionIds: ["d-queue", "d-legacy"] },
  { id: "r-gone", version: "v1.2.0", title: "Dangling", description: "One deleted.", status: "completed", owner: "Rowan", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["d-gone"] },
  { id: "r-mixed", version: "v1.3.0", title: "Mixed", description: "Several states.", status: "completed", owner: "Priya", createdAt: "2026-05-01T00:00:00.000Z", decisionIds: ["d-queue", "d-cache", "d-flags", "d-csv", "d-odd"] },
];

const resolved = (id, decisions = DECISIONS, releases = RELEASES) =>
  summarizeReleases(releases, decisions).find((release) => release.id === id);

// --- the pure core ---------------------------------------------------------

test("every status but accepted counts, in association order, with status and owner", () => {
  const entries = unacceptedDecisions(resolved("r-mixed"));
  assert.deepEqual(entries.map(({ title, status, owner }) => [title, status, owner]), [
    ["Cache the read path", "pending", "Ari"],
    ["Ship behind feature flags", "proposed", "Unassigned"],
    ["Sunset the CSV export", "superseded", "Mina"],
    ["Rejected idea", "rejected", "Sam"],
  ]);
  assert.deepEqual(entries.map((entry) => entry.href), [
    "/decision.html?id=d-cache", "/decision.html?id=d-flags", "/decision.html?id=d-csv", "/decision.html?id=d-odd",
  ]);
  assert.equal(unacceptedDecisionsLead(resolved("r-mixed")), "4 of 5 linked decisions are not accepted:");
});

test("all accepted and no links produce nothing; the retired approved reads as accepted", () => {
  assert.equal(unacceptedDecisions(resolved("r-clear")).length, 0);
  assert.equal(unacceptedDecisionsLead(resolved("r-clear")), "");
  assert.equal(unacceptedDecisions(resolved("r-none")).length, 0);
  assert.equal(unacceptedDecisionsLead(resolved("r-none")), "");
});

test("a reference that resolves to nothing is an unknown decision, counted and not linked", () => {
  const [entry] = unacceptedDecisions(resolved("r-gone"));
  assert.equal(entry.title, UNKNOWN_DECISION_LABEL);
  assert.equal(entry.id, "d-gone");
  assert.equal(entry.href, null);
  assert.equal(unacceptedDecisionsLead(resolved("r-gone")), "1 of 1 linked decision is not accepted:");
});

test("singular and plural agree with each count", () => {
  const releases = [{ ...RELEASES[0], id: "r-two", decisionIds: ["d-queue", "d-cache"] },
    { ...RELEASES[0], id: "r-both", decisionIds: ["d-cache", "d-csv"] }];
  assert.equal(unacceptedDecisionsLead(resolved("r-two", DECISIONS, releases)), "1 of 2 linked decisions is not accepted:");
  assert.equal(unacceptedDecisionsLead(resolved("r-both", DECISIONS, releases)), "2 of 2 linked decisions are not accepted:");
});

test("the filter keeps only releases with an unaccepted decision and names itself when it empties the view", () => {
  const ids = (list) => list.map((release) => release.id);
  assert.deepEqual(ids(filterReleases(RELEASES, DECISIONS, { unaccepted: "only" })), ["r-mixed", "r-gone"]);
  assert.deepEqual(ids(filterReleases(RELEASES, DECISIONS, { unaccepted: "yes" })), ["r-mixed", "r-gone", "r-clear", "r-none"]);
  assert.equal(releaseFilterSummary({ unaccepted: "only" }), "a linked decision that is not accepted");
});

test("the filter rides in the shared link and survives a reload", () => {
  assert.equal(releaseFilterSearch("", { unaccepted: "only" }), "?unaccepted=only");
  assert.equal(releaseFilterSearch("?unaccepted=only", { unaccepted: "all" }), "");
  assert.equal(readReleaseFilters("?unaccepted=only").unaccepted, "only");
  assert.equal(readReleaseFilters("?unaccepted=1").unaccepted, "all");
});

// --- the page --------------------------------------------------------------

async function bootedReleases(t, { decisions = DECISIONS, releases = RELEASES } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  assert.equal(page.document.documentElement.dataset.shiplogReleases, "ready");
  return page;
}

const rows = (page) => page.document.querySelectorAll(".release-item");
const rowTitle = (row) => textOf(row.querySelector(".release-version"));
const lineOf = (row) => row.querySelectorAll(".release-unaccepted");
const countText = (page) => textOf(page.document.querySelector("#release-count"));
const checkbox = (page) => page.document.querySelector("#release-unaccepted-only");

test("a collapsed row names each unaccepted decision with status and owner, linked to its record", async (t) => {
  const page = await bootedReleases(t);
  const mixed = rows(page).find((row) => rowTitle(row) === "Mixed");
  assert.equal(lineOf(mixed).length, 1);
  const line = lineOf(mixed)[0];
  // The page's decision reader refuses a record with no owner (d-flags) or a
  // status outside the vocabulary (d-odd), so on the page those two arrive as
  // references that resolve to nothing — still named, still counted.
  assert.equal(textOf(line), "4 of 5 linked decisions are not accepted: Cache the read path (pending, owner Ari); "
    + "unknown decision (d-flags, not in this log); Sunset the CSV export (superseded, owner Mina); "
    + "unknown decision (d-odd, not in this log).");
  const links = line.querySelectorAll("a");
  assert.deepEqual(links.map((link) => link.getAttribute("href")), ["/decision.html?id=d-cache", "/decision.html?id=d-csv"]);
  assert.deepEqual(links.map(textOf), ["Cache the read path", "Sunset the CSV export"]);
  // Visible while collapsed: it sits beside the toggle, not inside the panel.
  assert.equal(line.closest(".release-panel"), null);
  assert.equal(line.closest("button"), null);
  // Secondary text, never an announcement.
  assert.equal(line.getAttribute("role"), null);
  assert.equal(line.getAttribute("aria-live"), null);
});

test("all-accepted rows and rows with no linked decisions render no line", async (t) => {
  const page = await bootedReleases(t);
  for (const title of ["All accepted", "No links"]) {
    const row = rows(page).find((candidate) => rowTitle(candidate) === title);
    assert.equal(lineOf(row).length, 0, `${title} drew a line`);
  }
  assert.equal(page.document.querySelectorAll(".release-unaccepted").length, 2);
});

test("a deleted decision shows as an unknown decision, unlinked, with its id", async (t) => {
  const page = await bootedReleases(t);
  const row = rows(page).find((candidate) => rowTitle(candidate) === "Dangling");
  const line = lineOf(row)[0];
  assert.equal(textOf(line), "1 of 1 linked decision is not accepted: unknown decision (d-gone, not in this log).");
  assert.equal(line.querySelectorAll("a").length, 0);
});

test("the checkbox narrows and restores the list, and the existing count says so both times", async (t) => {
  const page = await bootedReleases(t);
  assert.equal(checkbox(page).checked, false);
  assert.equal(textOf(page.document.querySelector('label[for="release-unaccepted-only"]')), "Only releases with unaccepted decisions");
  assert.ok(tabSequence(page.document).includes(checkbox(page)), "the checkbox is a tab stop");
  assert.equal(countText(page), "Showing 4 releases, newest first.");

  checkbox(page).click();
  assert.equal(checkbox(page).checked, true);
  assert.deepEqual(rows(page).map(rowTitle), ["Mixed", "Dangling"]);
  assert.equal(countText(page), "Showing 2 of 4 releases, newest first.");

  checkbox(page).click();
  assert.equal(checkbox(page).checked, false);
  assert.deepEqual(rows(page).map(rowTitle), ["Mixed", "Dangling", "All accepted", "No links"]);
  assert.equal(countText(page), "Showing 4 releases, newest first.");
});

test("Clear filters unticks the checkbox", async (t) => {
  const page = await bootedReleases(t);
  checkbox(page).click();
  page.document.querySelector("#release-clear-filters").click();
  assert.equal(checkbox(page).checked, false);
  assert.equal(countText(page), "Showing 4 releases, newest first.");
});

test("markup in a decision title renders as literal text, never as an element", async (t) => {
  const title = "<img src=x onerror=alert(1)>Ship";
  const page = await bootedReleases(t, {
    decisions: [{ id: "d-xss", title, context: "x", owner: "<b>Eve</b>", status: "proposed", createdAt: "2026-01-02T09:00:00.000Z" }],
    releases: [{ ...RELEASES[0], decisionIds: ["d-xss"] }],
  });
  const line = page.document.querySelector(".release-unaccepted");
  assert.equal(textOf(line.querySelector("a")), title);
  assert.ok(textOf(line).includes("(proposed, owner <b>Eve</b>)"));
  assert.equal(line.querySelectorAll("img").length, 0);
  assert.equal(line.querySelectorAll("b").length, 0);
});

test("the line's renderer builds nodes, never markup strings", async () => {
  const source = await readFile(new URL("../src/releases.js", import.meta.url), "utf8");
  const start = source.indexOf("function renderUnacceptedLine(");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assert.ok(start > 0 && body.includes("createTextNode"));
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML/.test(body), false);
  assert.equal(/innerHTML|insertAdjacentHTML/.test(source), false, "releases.js writes no HTML strings anywhere");
});
