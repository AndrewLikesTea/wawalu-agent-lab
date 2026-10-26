// THE RELEASE LOG LEADS RELEASES (#3018).
//
// A visitor can browse, filter or record a release straight after the hero,
// without first passing the deployment evidence, the example records, the
// walkthrough, the sales prompts and the coverage review. Those still ship,
// below the log, in that order, and every address that used to land on them
// still does.
//
// Driven through the shipped src/releases.html. The harness models no layout,
// so the 390px shape is pinned on the rules and classes that produce it, not on
// a viewport shim. Counts and ids throughout, never assert.equal on an element.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import { readReleaseFilters } from "../src/release-filter-url.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { DomEvent, loadPage, tabSequence, textOf } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };
const DECISION = { id: "d-queue", title: "Adopt a durable queue", context: "Retries.", owner: "Kai", status: "accepted", createdAt: "2026-01-02T09:00:00.000Z" };
const release = (n) => ({
  id: `r-${n}`, version: `v1.${n}.0`, title: `Release ${n}`, description: "Shipped.", owner: "Kai",
  status: n % 2 ? "completed" : "planned", createdAt: new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString(), decisionIds: ["d-queue"],
});

async function openPage(t, { releases = [release(1), release(2)], refuse = false, boot = true, search = "" } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([DECISION]), [RELEASE_STORAGE_KEY]: JSON.stringify(releases) },
  });
  t.after(() => page.restore());
  const { getItem } = page.storage;
  page.storage.getItem = (key) => {
    if (key === RELEASE_STORAGE_KEY && refuse) throw new Error("storage refused the read");
    return getItem(key);
  };
  const location = { pathname: "/releases.html", origin: "https://labs.wawalu.org", search, hash: "" };
  const history = {
    state: null,
    pushState(state, title, url) { location.search = new URL(url, location.origin).search; },
    replaceState(state, title, url) { location.search = new URL(url, location.origin).search; },
  };
  if (boot) {
    initReleasesPage(page.document, page.storage, {
      seed: NO_SEED, location, history, readHealth: async () => { throw new Error("no network in tests"); },
    });
  }
  return { page, location };
}

const byId = (page, id) => page.document.querySelector(`#${id}`);

// Every id in document order, by walking children (no universal selector).
function documentIds(node, out = []) {
  const id = node.getAttribute?.("id");
  if (id) out.push(id);
  for (const child of node.children ?? []) if (child.getAttribute) documentIds(child, out);
  return out;
}

// Neither hidden itself nor inside a hidden or folded region.
function shown(node) {
  for (let cursor = node; cursor; cursor = cursor.parentNode) {
    if (cursor.hidden || (cursor.getAttribute?.("hidden") ?? null) !== null) return false;
  }
  return true;
}

const LOG_FIRST = ["page-title", "record-release-link", "deployment-check-link", "releases-title", "release-search", "release-status",
  "release-decision", "release-unaccepted-only", "release-list-status", "release-list", "record-release", "release-form"];
const BELOW_THE_LOG = ["real-deployment", "shiplog-proof", "evaluation-path", "ask-about-shiplog-actions",
  "release-discussion-actions", "reasoning-proof"];

test("the log's heading, filters, results and recorder come before every supporting block, in order", async (t) => {
  const { page } = await openPage(t);
  const ids = documentIds(byId(page, "main-content"));
  const at = (id) => {
    const index = ids.indexOf(id);
    assert.ok(index >= 0, `#${id} is missing from the page`);
    return index;
  };
  const expected = [...LOG_FIRST, ...BELOW_THE_LOG];
  for (let i = 1; i < expected.length; i += 1) {
    assert.ok(at(expected[i - 1]) < at(expected[i]), `#${expected[i - 1]} is not read before #${expected[i]}`);
  }
  // Tab order follows: the filters and a release row are reached before any
  // control of the deployment check, the example, the guide, the ask or the count.
  const sequence = tabSequence(page.document);
  const stop = (id) => sequence.findIndex((node) => node.getAttribute?.("id") === id);
  const firstRow = sequence.findIndex((node) => node.classList?.contains?.("release-toggle"));
  assert.ok(firstRow > stop("release-search"), "no release row is reached after the search");
  for (const later of ["deployment-evidence-summary", "shiplog-proof-copy", "evaluation-path-action", "ask-about-shiplog", "reasoning-proof-copy"]) {
    assert.ok(stop(later) > firstRow, `#${later} is tabbed to before the log's rows`);
  }
});

test("the hero's deployment link targets the existing check and lands focus on it", async (t) => {
  const { page } = await openPage(t);
  const link = byId(page, "deployment-check-link");
  assert.equal(textOf(link), "Go to the deployment check");
  assert.equal(link.getAttribute("href"), "#deployment-status");
  const target = byId(page, "deployment-status");
  assert.equal(target.getAttribute("tabindex"), "-1", "the target is not a focus target");
  assert.equal(target.getAttribute("aria-labelledby"), "deployment-status-title");
  link.click();
  assert.equal(page.document.activeElement?.getAttribute("id"), "deployment-status");
  // Only a summary link: the deployment check's own copy is still said once.
  assert.equal(page.document.querySelectorAll("h3").filter((node) => textOf(node) === "Deployment check").length, 1);
});

test("every preserved anchor still exists, and every in-page link on the page resolves", async (t) => {
  const { page } = await openPage(t);
  const ids = new Set(documentIds(page.document.documentElement ?? page.document));
  for (const id of ["shipped-build", "real-deployment", "deployment-status", "shiplog-proof", "repository-proof",
    "evaluation-path", "reasoning-proof", "coverage-gap-definition", "coverage-gap-worklist", "record-release",
    "release-form", "releases-title", "site-footer-panel"]) {
    assert.ok(ids.has(id), `#${id} no longer exists`);
  }
  const fragments = page.document.querySelectorAll("a")
    .map((link) => link.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("#") && href.length > 1);
  assert.ok(fragments.length >= 4, "the page lost its in-page links");
  for (const href of fragments) assert.ok(ids.has(href.slice(1)), `${href} points at nothing`);
});

test("a shared filter URL still hydrates the filters and round-trips after the move", async (t) => {
  const { page, location } = await openPage(t, { search: "?campaign=review&status=planned&decision-status=accepted" });
  assert.equal(byId(page, "release-status").value, "planned");
  assert.equal(byId(page, "release-decision-status-accepted").checked, true);
  assert.equal(page.document.querySelectorAll(".release-toggle").length, 1, "the shared view did not narrow the log");

  const search = byId(page, "release-search");
  search.value = "Release 2";
  search.dispatchEvent(new DomEvent("input", { bubbles: true }));
  assert.match(location.search, /campaign=review/, "an unrelated parameter was dropped");
  assert.deepEqual(readReleaseFilters(location.search, new Set(["d-queue"])),
    { query: "Release 2", status: "planned", decisionStatus: "accepted", decisionId: "all", unaccepted: "all" });

  // Reopening that address restores the same view.
  const { page: reopened } = await openPage(t, { search: location.search });
  assert.equal(byId(reopened, "release-search").value, "Release 2");
  assert.equal(byId(reopened, "release-status").value, "planned");
  assert.equal(reopened.document.querySelectorAll(".release-toggle").length, 1);
});

const STATES = [
  ["loading", { boot: false }, "Loading releases…"],
  ["empty", { releases: [] }, "No releases recorded yet"],
  ["error", { refuse: true }, "Couldn’t load releases"],
  ["no match", { search: "?q=nothing-matches-this" }, "No releases match your search and filters"],
  ["large count", { releases: Array.from({ length: 400 }, (_, i) => release(i + 1)) }, null],
];

for (const [name, options, heading] of STATES) {
  test(`the ${name} state keeps the filters and the record action on the page`, async (t) => {
    const { page } = await openPage(t, options);
    const status = byId(page, "release-list-status");
    if (heading) assert.equal(textOf(status.querySelector("h3")), heading);
    else assert.equal(page.document.querySelectorAll(".release-toggle").length, 400);
    for (const id of ["release-search", "release-status", "release-decision", "release-decision-status-all",
      "release-unaccepted-only", "record-release-link", "record-release", "release-form"]) {
      const node = byId(page, id);
      assert.ok(node, `#${id} is gone in the ${name} state`);
      assert.ok(shown(node), `#${id} is hidden in the ${name} state`);
    }
    // And still ahead of the rows, whatever their number.
    const ids = documentIds(byId(page, "main-content"));
    assert.ok(ids.indexOf("release-search") < ids.indexOf("release-list"));
    assert.ok(ids.indexOf("release-list") < ids.indexOf("real-deployment"));
  });
}

// The harness lays nothing out, so the phone layout is pinned on the shipped
// rules the reordered blocks use: no new rule was added for the move.
test("at 390px the hero's routes and the filters stack using the existing rules", async (t) => {
  const { page } = await openPage(t);
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.hero-actions \{[^}]*flex-wrap:wrap/);
  assert.match(styles, /\.hero-actions\{align-items:stretch;flex-direction:column\}/);
  assert.match(styles, /\.release-filters\{align-items:stretch;flex-direction:column\}/);
  assert.match(styles, /\.workspace-single \{ grid-template-columns:1fr; \}/);
  for (const id of ["record-release-link", "deployment-check-link"]) {
    assert.equal(byId(page, id).getAttribute("class"), "text-link");
    assert.equal(byId(page, id).parentNode.getAttribute("class"), "hero-actions");
  }
  assert.match(byId(page, "releases-title").parentNode.parentNode.parentNode.parentNode.getAttribute("class"), /workspace-single/);
});
