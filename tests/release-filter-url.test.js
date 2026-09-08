import test from "node:test";
import assert from "node:assert/strict";
import { readReleaseFilters, releaseFilterSearch } from "../src/release-filter-url.js";
import { initReleasesPage } from "../src/releases-page.js";
import { COPY_LINK_SUCCESS } from "../src/history-filter-view.js";
import { loadPage, DomEvent, pressKey, textOf } from "./support/browser.js";

const defaults = { query: "", status: "all", decisionStatus: "all", decisionId: "all" };
test("URL vocabulary round-trips Unicode and reserved characters, omits defaults and preserves other parameters", () => {
  const filters = { query: "queue & café + #?/%", status: "planned", decisionStatus: "accepted", decisionId: "a/b & c" };
  const search = releaseFilterSearch("?focus=r1&campaign=review&campaign=team", filters);
  assert.deepEqual(readReleaseFilters(search, new Set([filters.decisionId])), filters);
  assert.match(search, /q=queue/);
  assert.equal(releaseFilterSearch(search, defaults), "?focus=r1&campaign=review&campaign=team");
  assert.equal(releaseFilterSearch("", { query: "  " }), "");
});
test("invalid, duplicate and obsolete parameters normalize deterministically without throwing", () => {
  const filters = readReleaseFilters("?status=obsolete&status=planned&decision=deleted&decision-status=approved&q=%20hello%20", new Set());
  assert.deepEqual(filters, { ...defaults, query: "hello" });
  assert.equal(releaseFilterSearch("?status=obsolete&status=planned", filters), "?q=hello");
  assert.doesNotThrow(() => readReleaseFilters("?q=%E0%A4%A&status=%"));
});

async function boot(t, search = "", clipboard) {
  const page = await loadPage(new URL("../src/releases.html", import.meta.url));
  t.after(() => page.restore());
  const location = { pathname: "/releases.html", search, hash: "#releases-title", origin: "https://labs.wawalu.org" };
  const entries = [search];
  let cursor = 0;
  let pop;
  const writes = [];
  const write = (url) => { const parsed = new URL(url, location.origin); location.search = parsed.search; writes.push(url); };
  const history = {
    state: { preserved: true },
    pushState(state, title, url) { assert.deepEqual(state, this.state); write(url); entries.splice(++cursor); entries.push(location.search); },
    replaceState(state, title, url) { write(url); entries[cursor] = location.search; },
  };
  initReleasesPage(page.document, page.storage, { location, history, clipboard,
    navigation: { addEventListener(name, fn) { assert.equal(name, "popstate"); pop = fn; } } });
  return { ...page, location, writes, entries,
    navigate(delta) { cursor += delta; location.search = entries[cursor]; pop(); } };
}
const get = (page, id) => page.document.querySelector(`#${id}`);
const change = (node, value, type = "change") => { node.value = value; node.dispatchEvent(new DomEvent(type, { bubbles: true })); };
const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); };

test("shipped page hydrates, filters, restores Back/Forward and refresh, and clears without loops", async (t) => {
  const page = await boot(t, "?campaign=review&status=planned&q=does-not-match&decision-status=accepted");
  assert.equal(get(page, "release-search").value, "does-not-match");
  assert.equal(get(page, "release-status").value, "planned");
  assert.equal(get(page, "release-decision-status-accepted").checked, true);
  assert.ok(page.document.querySelector(".release-reset-action"));
  assert.equal(page.writes.length, 0);
  get(page, "release-clear-filters").click();
  assert.equal(page.location.search, "?campaign=review");
  assert.ok(page.document.querySelector(".release-toggle"));
  page.navigate(-1);
  assert.equal(get(page, "release-search").value, "does-not-match");
  assert.ok(page.document.querySelector(".release-reset-action"));
  page.navigate(1);
  assert.equal(get(page, "release-status").value, "all");
  assert.equal(page.writes.length, 1, "popstate does not push or replace canonical state");
  change(get(page, "release-search"), "café & queue", "input");
  const refreshed = await boot(t, page.location.search);
  assert.equal(get(refreshed, "release-search").value, "café & queue");
  assert.equal(textOf(get(refreshed, "release-count")), textOf(get(page, "release-count")));
  page.document.querySelector(".release-reset-action").click();
  assert.equal(page.location.search, "?campaign=review");
});

test("copy is keyboard operable and copies current canonical filters with accessible, honest feedback", async (t) => {
  const copied = [];
  const page = await boot(t, "?status=planned&focus=r1", { writeText: async (url) => copied.push(url) });
  change(get(page, "release-search"), "a & b", "input");
  const button = get(page, "release-copy-link");
  button.focus();
  pressKey(page.document, "Enter");
  await settle();
  assert.equal(copied[0], `https://labs.wawalu.org/releases.html${page.location.search}#releases-title`);
  const feedback = get(page, "release-copy-status");
  assert.equal(feedback.getAttribute("role"), "status");
  assert.equal(feedback.getAttribute("aria-live"), "polite");
  // The same sentence the decisions history says for the same control. The page
  // module cannot import it — history-filter-view.js drags the decisions filter
  // vocabulary into the releases bundle — so the equality is held here instead,
  // and the two "Copy link to this view" buttons cannot drift apart unnoticed.
  assert.equal(textOf(feedback), COPY_LINK_SUCCESS);
  get(page, "release-clear-filters").click();
  assert.equal(textOf(feedback), "");
  button.click();
  await settle();
  assert.equal(textOf(feedback), "Link copied. It opens the full release log.");
});

for (const clipboard of [{}, { writeText: async () => { throw new Error("denied"); } }]) {
  test("clipboard unavailable or rejected exposes a labelled, focused manual link", async (t) => {
    const page = await boot(t, "?q=queue", clipboard);
    get(page, "release-copy-link").click();
    await settle();
    assert.equal(get(page, "release-copy-fallback").hidden, false);
    assert.equal(page.document.activeElement, get(page, "release-copy-url"));
    assert.equal(get(page, "release-copy-url").value, "https://labs.wawalu.org/releases.html?q=queue#releases-title");
    // Names the field it just revealed, not the address bar the shared failure
    // line points at — this control has a better next step than that one.
    assert.match(textOf(get(page, "release-copy-status")), /Copy it from the field below instead\.$/);
    assert.equal(get(page, "release-copy-link").disabled, false);
  });
}

test("late clipboard completion cannot announce an outdated view as current", async (t) => {
  let resolve;
  const page = await boot(t, "", { writeText: () => new Promise((done) => { resolve = done; }) });
  get(page, "release-copy-link").click();
  change(get(page, "release-status"), "planned");
  resolve();
  await settle();
  assert.equal(textOf(get(page, "release-copy-status")), "");
});

test("direct navigation canonicalizes stale filters with one replacement", async (t) => {
  const page = await boot(t, "?status=retired&decision=deleted&decision-status=obsolete&q=%20%20&campaign=review");
  assert.equal(page.location.search, "?campaign=review");
  assert.equal(page.entries.length, 1);
  assert.equal(page.writes.length, 1);
  assert.equal(get(page, "release-status").value, "all");
  assert.equal(get(page, "release-decision").value, "all");
  assert.equal(get(page, "release-decision-status-all").checked, true);
});
