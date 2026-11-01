import test from "node:test";
import assert from "node:assert/strict";
import { readReleaseFilters, releaseFilterSearch } from "../src/release-filter-url.js";
import { initReleasesPage } from "../src/releases-page.js";
import { readFile } from "node:fs/promises";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { loadPage, DomEvent, pressKey, tabSequence, textOf } from "./support/browser.js";

const defaults = { query: "", status: "all", decisionStatus: "all", decisionId: "all", unaccepted: "all" };
test("URL vocabulary round-trips Unicode and reserved characters, omits defaults and preserves other parameters", () => {
  const filters = { query: "queue & café + #?/%", status: "planned", decisionStatus: "accepted", decisionId: "a/b & c", unaccepted: "only" };
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

async function boot(t, search = "", clipboard, { seed, prepare } = {}) {
  const page = await loadPage(new URL("../src/releases.html", import.meta.url));
  t.after(() => page.restore());
  prepare?.(page);
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
  initReleasesPage(page.document, page.storage, { location, history, clipboard, seed,
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
  // Names the view: this page has three other copy buttons, and the decisions
  // history's bare "Link copied." could confirm any of them.
  assert.equal(textOf(feedback), "Link to this view copied. It keeps your search and filters.");
  get(page, "release-clear-filters").click();
  assert.equal(textOf(feedback), "");
  button.click();
  await settle();
  assert.equal(textOf(feedback), "Link to this view copied. No search or filters are set, so it opens the full release log.");
});

/**
 * The page's own words, with the deployment record and the check that quotes it
 * left out.
 *
 * Those two blocks recite a git commit subject, which this page neither writes
 * nor bounds — and the commit that made this label the page's only one is itself
 * titled `Make "Copy link to this view" name exactly one control on Releases`
 * (#2661). A build stamped from it therefore paints the label a second time as
 * RECORD TEXT, and the count below reported a competing label where no control
 * existed. The claim under test is about this page's controls, which the
 * per-control checks at the end of the test cover for those two regions
 * directly. tests/release-coverage-gaps.test.js excludes the same two regions
 * from its vocabulary walk, and tests/shiplog-proof.test.js from its caveat
 * walk, for the same reason.
 *
 * Excluded text is blanked rather than cut, so every index into the painted page
 * still refers to the same position.
 */
const RECITED_REGIONS = ["real-deployment", "deployment-status"];

function pageControlText(document) {
  let said = textOf(document.body);
  for (const id of RECITED_REGIONS) {
    const region = document.getElementById(id);
    const recited = region ? textOf(region) : "";
    if (recited) said = said.replace(recited, " ".repeat(recited.length));
  }
  return said;
}

test("the view-sharing action has one label, says what its link carries, and confirms in its own words", async (t) => {
  const page = await boot(t, "?q=queue", { writeText: async () => {} });
  const button = get(page, "release-copy-link");
  assert.equal(textOf(button), "Copy link to this view");
  assert.equal(button.getAttribute("aria-label"), null);
  assert.equal(button.getAttribute("title"), null);
  // The hand-copy field is a second control, so it has a name of its own
  // (#2644): it says what the box holds and what to do with it.
  assert.equal(textOf(page.document.querySelector('label[for="release-copy-url"]')), "Link to copy by hand");
  const body = pageControlText(page.document);
  assert.equal(body.split("Copy link to this view").length - 1, 1, "the button, and nothing else on the page");
  assert.equal(body.split("Link to this view").length - 1, 0, "no competing label for the same action");
  assert.equal(button.getAttribute("aria-describedby"), "release-share-scope");
  assert.equal(textOf(get(page, "release-share-scope")),
    "The link keeps your search and filters. Whoever opens it sees the releases saved in their own browser.");
  button.click();
  await settle();
  const status = textOf(get(page, "release-copy-status"));
  assert.match(status, /^Link to this view copied\./);
  // No other copy control on this page claims the view.
  for (const id of ["shipped-build-copy", "shiplog-proof-copy", "deployment-copy"]) {
    assert.doesNotMatch(textOf(get(page, id)), /this view/);
  }
});

// The name a control answers to is the only thing that tells it apart in a
// screen reader's list of controls, where nothing about position survives. Two
// controls in this one toolbar wearing the same name is the defect #2644
// reported, so the whole area is checked rather than the pair that collided.
function controlName(page, control) {
  if (control.getAttribute("aria-label")) return control.getAttribute("aria-label");
  if (control.tagName === "BUTTON") return textOf(control);
  const label = page.document.querySelector(`label[for="${control.getAttribute("id")}"]`);
  if (label) return textOf(label);
  const fieldset = control.closest("fieldset");
  return fieldset ? textOf(fieldset.querySelector("legend")) : "";
}

test("every control in the search and filter area is named, and no two share a name", async (t) => {
  const page = await boot(t, "?q=queue", { writeText: async () => { throw new Error("denied"); } });
  // With the clipboard refused, the hand-copy field is on screen: the area is
  // checked in the state where it holds the most controls.
  get(page, "release-copy-link").click();
  await settle();
  assert.equal(get(page, "release-copy-fallback").hidden, false);
  // The area is the filter panel and the share control beside it: the copy
  // button sits outside the search landmark in the markup, but a reader meets
  // the two as one toolbar.
  const areas = [page.document.querySelector(".release-filters"),
    get(page, "release-copy-link").closest(".share-control")];
  const names = areas.flatMap((area) => area.querySelectorAll("input,select,textarea,button"))
    .map((control) => controlName(page, control));
  assert.ok(names.length >= 12, `the area lost controls: ${names.join(" | ")}`);
  assert.deepEqual(names.filter((name) => name === ""), [], "an unnamed control in the area");
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual(repeated, [], `two controls answer to the same name: ${repeated.join(" | ")}`);
  assert.equal(names.filter((name) => name === "Copy link to this view").length, 1,
    "exactly one control is the copy action");
  assert.equal(names.filter((name) => name === "Link to copy by hand").length, 1,
    "and exactly one is the field to copy from by hand");
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

// --- #3077: a shared link that matches nothing in this browser says why -----
const SHARED = "This link shares search and filters only. The sender’s releases are stored in the sender’s browser and are not included. Nothing in this browser matches them.";
const sharedLinks = (page) => get(page, "release-list-status").querySelectorAll("a");
const sharedCount = (page) => textOf(page.document.body).split("shares search and filters only").length - 1;
const settled = async () => { await settle(); await settle(); await settle(); };

test("a shared link that matches nothing explains why and offers the next steps in the live region", async (t) => {
  const page = await boot(t, "?campaign=review&q=sender-only-release");
  await settled();
  const region = get(page, "release-list-status");
  assert.equal(region.getAttribute("role"), "status");
  assert.equal(region.getAttribute("aria-live"), "polite");
  assert.equal(region.hidden, false);
  assert.equal(textOf(region.querySelector("h3")), "No releases match your search and filters");
  assert.equal(textOf(region.querySelector("p")), SHARED);
  assert.equal(sharedCount(page), 1);
  assert.doesNotMatch(textOf(region), /failed to load|uncovered/i);
  assert.equal(sharedLinks(page).length, 2);
  const [importLink, demoLink] = sharedLinks(page);
  assert.equal(textOf(importLink), "import it on the Home page");
  const [path, importId] = importLink.getAttribute("href").split("#");
  assert.equal(path, "/index.html");
  const home = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(home, new RegExp(`id="${importId}">Import Shiplog records from a file<`));
  assert.equal(textOf(demoLink), "Request a Shiplog demonstration");
  assert.equal(page.document.querySelectorAll(demoLink.getAttribute("href")).length, 1);
  const button = region.querySelector("button");
  assert.equal(textOf(button), "Clear filters");
  assert.equal(button.type, "button");
  assert.equal(button.hidden, false);
  // Normal DOM order, all reachable by Tab: the import step, the clear, the demo.
  const stops = tabSequence(page.document);
  const at = [importLink, button, demoLink].map((node) => stops.indexOf(node));
  assert.ok(at.every((index) => index >= 0), `not in the tab order: ${at}`);
  assert.equal(page.writes.length, 0, "loading a shared link writes nothing");
});

test("Clear filters leaves the shared view: examples listed, params replaced, focus on the search", async (t) => {
  const page = await boot(t, "?campaign=review&q=sender-only-release&status=planned");
  await settled();
  const before = page.entries.length;
  get(page, "release-list-status").querySelector("button").click();
  assert.equal(sharedCount(page), 0);
  assert.equal(sharedLinks(page).length, 0);
  assert.ok(page.document.querySelectorAll(".release-toggle").length > 0, "the example releases are not listed");
  assert.equal(get(page, "release-list-status").hidden, true);
  assert.equal(page.location.search, "?campaign=review");
  assert.equal(page.entries.length, before, "the clear replaced the address rather than adding to history");
  assert.ok(page.document.activeElement === get(page, "release-search"), "focus left the search");
  // Narrowing by hand afterwards is the ordinary no-match state.
  change(get(page, "release-search"), "sender-only-release", "input");
  assert.equal(sharedCount(page), 0);
  assert.match(textOf(get(page, "release-list-status").querySelector("p")), /^The log still holds releases/);
  assert.equal(textOf(page.document.querySelector(".release-reset-action")), "Clear search and filters");
});

test("changing a shared view's filters by hand returns to the ordinary no-match state", async (t) => {
  const page = await boot(t, "?q=sender-only-release");
  await settled();
  assert.equal(sharedCount(page), 1);
  change(get(page, "release-search"), "sender-only-releases", "input");
  assert.equal(sharedCount(page), 0);
  assert.equal(sharedLinks(page).length, 0);
  assert.equal(textOf(page.document.querySelector(".release-reset-action")), "Clear search and filters");
});

test("shared filters that match a release list it with no message", async (t) => {
  const page = await boot(t, "?q=queue");
  await settled();
  assert.ok(page.document.querySelectorAll(".release-toggle").length > 0);
  assert.equal(get(page, "release-list-status").hidden, true);
  assert.equal(sharedCount(page), 0);
});

test("without params the message never appears; empty and failed loads keep their copy", async (t) => {
  const plain = await boot(t, "");
  await settled();
  assert.equal(sharedCount(plain), 0);
  change(get(plain, "release-search"), "sender-only-release", "input");
  assert.equal(sharedCount(plain), 0);

  const empty = await boot(t, "", undefined, { seed: { decisions: [], releases: [] } });
  await settled();
  assert.equal(textOf(get(empty, "release-list-status").querySelector("h3")), "No releases recorded yet");
  assert.equal(textOf(get(empty, "release-list-status").querySelector("p")), "Record a release, with or without linked decisions.");
  assert.equal(sharedCount(empty), 0);

  for (const search of ["", "?q=sender-only-release"]) {
    const failed = await boot(t, search, undefined, { prepare(page) {
      const { getItem } = page.storage;
      page.storage.getItem = (key) => {
        if (key === RELEASE_STORAGE_KEY) throw new Error("storage refused the read");
        return getItem(key);
      };
    } });
    await settled();
    const region = get(failed, "release-list-status");
    assert.equal(textOf(region.querySelector("h3")), "Couldn’t load releases");
    assert.equal(textOf(region.querySelector("p")), "This browser’s release log could not be read. Your saved records have not been changed.");
    assert.equal(textOf(region.querySelector("button")), "Retry");
    assert.equal(sharedCount(failed), 0);
    assert.equal(sharedLinks(failed).length, 0);
  }
});
