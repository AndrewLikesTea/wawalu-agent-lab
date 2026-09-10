// The Releases log's distinct states — empty, no-match, failed load — and the
// one status region that announces them (issue #2268).
//
// Driven through the shipped src/releases.html. Two properties are pinned
// against the shapes that lost them: the wait is announced before every read of
// the log, and a submit made while the log is unread never writes over the
// releases already stored.
//
// Determinism: no network, no timers. Every test seeds its own storage, and the
// storage double records every setItem by key so "nothing was written" is an
// observation rather than an inference from the stored bytes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY, releaseListStateCopy } from "../src/releases.js";
import { LOG_UNREAD, initReleasesPage } from "../src/releases-page.js";
import { prepareShiplogImport } from "../src/shiplog-import.js";
import { DomEvent, loadPage, textOf, typeText } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };

const DECISION = { id: "d-queue", title: "Adopt a durable queue", context: "Retries.", owner: "Kai", status: "accepted", createdAt: "2026-01-02T09:00:00.000Z" };
const STORED = [
  { id: "r-one", version: "v1.0.0", title: "First", description: "One.", owner: "Kai", status: "completed", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: [] },
  { id: "r-two", version: "v1.1.0", title: "Second", description: "Two.", owner: "Ari", status: "completed", createdAt: "2026-03-01T00:00:00.000Z", decisionIds: ["d-queue"] },
];

const LOADING = "Loading releases…";
const EMPTY = "No releases recorded yet";
const NO_MATCH = "No releases match your search and filters";
const FAILED = "Couldn’t load releases";

// `control.refuse` makes the release key's read throw, as a blocked store does;
// `control.raw()` reads the stored bytes past that refusal.
async function openPage(t, { releases = STORED, refuse = false, boot = true } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([DECISION]), [RELEASE_STORAGE_KEY]: JSON.stringify(releases) },
  });
  t.after(() => page.restore());
  const { getItem, setItem } = page.storage;
  const control = { refuse, writes: [], raw: () => getItem(RELEASE_STORAGE_KEY) };
  page.storage.getItem = (key) => {
    if (key === RELEASE_STORAGE_KEY && control.refuse) throw new Error("storage refused the read");
    return getItem(key);
  };
  page.storage.setItem = (key, value) => {
    control.writes.push(key);
    return setItem(key, value);
  };
  if (boot) initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  return { page, control };
}

const byId = (page, id) => page.document.querySelector(`#${id}`);
const regionText = (page) => textOf(byId(page, "release-list-status"));
const activeId = (page) => page.document.activeElement?.getAttribute?.("id") ?? null;
const rows = (page) => page.document.querySelectorAll(".release-toggle").length;
const panelHeading = (page, state) => textOf(page.document.querySelector(`.list-state-${state}`).querySelector("h3"));
const releaseWrites = (control) => control.writes.filter((key) => key === RELEASE_STORAGE_KEY);
const change = (control, value) => {
  control.value = value;
  control.dispatchEvent(new DomEvent("change", { bubbles: true }));
};

// Records what the status region says at the moment the release log is read.
function listenToReads(page) {
  const heard = [];
  const read = page.storage.getItem;
  page.storage.getItem = (key) => {
    if (key === RELEASE_STORAGE_KEY) heard.push(regionText(page));
    return read(key);
  };
  return heard;
}

function fill(page, id, value) {
  byId(page, id).focus();
  typeText(page.document, value);
}

function fillRelease(page, version) {
  fill(page, "release-version", version);
  fill(page, "release-owner", "Priya");
  fill(page, "release-released-on", "2026-07-02");
  fill(page, "release-description", "The queue shipped.");
}

const submitButton = (page) => page.document.querySelectorAll("button").find((button) => textOf(button) === "Record release");

// --- blocker 1: the wait is announced, through one region ------------------

test("the log's one status region ships the loading text, and boot announces it before reading", async (t) => {
  const markup = await readFile(RELEASES_PAGE, "utf8");
  // As shipped: one role="status" for the log, never empty, and neither the
  // list nor its loading panel is a second live region.
  assert.match(markup, /<p class="visually-hidden" id="release-list-status" role="status">Loading releases…<\/p>/);
  assert.doesNotMatch(markup, /id="release-list"[^>]*aria-live/);
  assert.doesNotMatch(markup, /class="list-state list-state-loading"[^>]*role=/);
  assert.equal(releaseListStateCopy("loading")[0], LOADING);

  const { page } = await openPage(t, { boot: false });
  assert.equal(regionText(page), LOADING, "the parsed page does not announce the wait before load");

  // Emptied first, so what the read hears can only have been written by boot.
  byId(page, "release-list-status").textContent = "";
  const heard = listenToReads(page);
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  assert.equal(heard[0], LOADING, "boot read the log before announcing the wait");
});

test("an empty log settles the region on the empty state without moving focus", async (t) => {
  const { page } = await openPage(t, { releases: [], boot: false });
  byId(page, "release-export").focus();
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });

  assert.equal(regionText(page), EMPTY);
  assert.equal(panelHeading(page, "empty"), EMPTY);
  assert.equal(page.document.querySelector(".list-state-empty").getAttribute("role"), null);
  assert.equal(activeId(page), "release-export", "the empty state took focus on its own");
  assert.equal(textOf(page.document.querySelector(".release-empty-action")), "Record a release");
});

test("a failed load settles the region on the error state without moving focus", async (t) => {
  const { page } = await openPage(t, { refuse: true, boot: false });
  byId(page, "release-export").focus();
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });

  assert.equal(regionText(page), FAILED);
  const panel = page.document.querySelector(".list-state-error");
  assert.equal(panelHeading(page, "error"), FAILED, "the loading message was not replaced by a visible error label");
  assert.equal(panel.getAttribute("role"), null);
  assert.equal(page.document.querySelectorAll(".list-state-loading").length, 0);
  assert.equal(activeId(page), "release-export", "the error state took focus on its own");
  assert.equal(textOf(byId(page, "release-count")), "");
});

test("rows clear the region, and a filter that empties the view announces no-match without moving focus", async (t) => {
  const { page } = await openPage(t, { boot: false });
  byId(page, "release-export").focus();
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  assert.equal(rows(page), 2);
  assert.equal(regionText(page), "", "a loaded list left a state sentence in the region");

  change(byId(page, "release-status"), "cancelled");
  assert.equal(regionText(page), NO_MATCH);
  assert.equal(panelHeading(page, "empty"), NO_MATCH);
  assert.equal(activeId(page), "release-export");
});

// --- acceptance 2: clearing search and filters -----------------------------

test("no-match clears the search and every filter, announces the count, and lands on the search", async (t) => {
  const { page } = await openPage(t);
  const search = byId(page, "release-search");
  search.focus();
  typeText(page.document, "nothing like this");
  change(byId(page, "release-status"), "planned");
  change(byId(page, "release-decision"), "d-queue");
  byId(page, "release-decision-status-superseded").click();
  assert.equal(regionText(page), NO_MATCH);

  const clear = page.document.querySelector(".release-reset-action");
  assert.equal(clear.tagName, "BUTTON");
  assert.equal(clear.type, "button");
  assert.equal(textOf(clear), "Clear search and filters");
  clear.focus();
  clear.click();

  assert.equal(search.value, "");
  assert.equal(byId(page, "release-status").value, "all");
  assert.equal(byId(page, "release-decision").value, "all");
  assert.equal(byId(page, "release-decision-status-all").checked, true);
  assert.equal(byId(page, "release-decision-status-superseded").checked, false);
  assert.equal(rows(page), 2);
  // The restored count, in the count's own polite region.
  assert.equal(textOf(byId(page, "release-count")), "Showing 2 releases, newest first.");
  assert.equal(byId(page, "release-count").getAttribute("aria-live"), "polite");
  assert.equal(page.document.querySelectorAll(".release-reset-action").length, 0);
  assert.equal(activeId(page), "release-search", "focus was lost with the button the reset removed");
});

// --- acceptance 3: Retry ---------------------------------------------------

test("Retry re-reads the log: a repeated failure keeps focus on Retry, a load lands on the log heading", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  const retry = page.document.querySelector(".release-retry-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(textOf(retry), "Retry");

  retry.focus();
  const heard = listenToReads(page);
  retry.click();
  assert.equal(heard[0], LOADING, "a retry re-read the log without announcing the wait");
  assert.equal(regionText(page), FAILED);
  assert.ok(page.document.querySelector(".release-retry-action") === retry, "a failed retry re-drew the panel under Retry");
  assert.ok(page.document.activeElement === retry, "a failed retry moved focus off Retry");

  control.refuse = false;
  retry.click();
  assert.equal(rows(page), 2);
  assert.equal(regionText(page), "");
  assert.equal(textOf(byId(page, "release-count")), "Showing 2 releases, newest first.");
  assert.equal(byId(page, "releases-title").getAttribute("tabindex"), "-1");
  assert.equal(activeId(page), "releases-title", "a successful retry left focus on a removed button");
  assert.deepEqual(releaseWrites(control), [], "reading the log wrote to it");
});

// --- blocker 2: no write over an unread log --------------------------------

test("recording while the log is unread writes nothing, keeps the entry, and saves over the real log after Retry", async (t) => {
  // 1–2. Two stored releases, and a store that refuses to read them.
  const { page, control } = await openPage(t, { refuse: true });
  const before = control.raw();

  // 3. Fill and submit.
  fillRelease(page, "v2.0.0");
  submitButton(page).click();

  // 4. The stored log is byte-for-byte what it was, and no write was attempted.
  assert.equal(control.raw(), before, "a submit over an unread log changed the stored releases");
  assert.deepEqual(JSON.parse(control.raw()).map(({ id }) => id), ["r-one", "r-two"]);
  assert.deepEqual(releaseWrites(control), [], "setItem was called for the release key");

  // 5. Said inline, in the form's own alert, with every typed value kept.
  const error = byId(page, "release-form-error");
  assert.equal(error.hidden, false);
  assert.equal(error.getAttribute("role"), "alert");
  assert.equal(textOf(error), "Couldn’t save: the release log didn’t load. Retry loading releases, then record again.");
  assert.equal(textOf(error), LOG_UNREAD);
  assert.equal(byId(page, "release-version").value, "v2.0.0");
  assert.equal(byId(page, "release-owner").value, "Priya");
  assert.equal(byId(page, "release-released-on").value, "2026-07-02");
  assert.equal(byId(page, "release-description").value, "The queue shipped.");
  assert.equal(byId(page, "release-record-next").hidden, true);
  // Refused, not disabled: the control that sent it is still operable.
  assert.notEqual(submitButton(page).disabled, true);

  // 6. The store recovers; Retry shows the two releases.
  control.refuse = false;
  page.document.querySelector(".release-retry-action").click();
  assert.equal(rows(page), 2);

  // 7. The same entry, submitted again, joins the originals.
  submitButton(page).click();
  const after = JSON.parse(control.raw());
  assert.equal(after.length, 3);
  assert.equal(after[0].version, "v2.0.0");
  assert.deepEqual(after.slice(1), STORED, "the original releases were not kept intact");
  assert.equal(rows(page), 3);
  assert.equal(error.hidden, true);
});

test("a save that succeeds on an unread page reads the log back instead of showing only the new record", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  control.refuse = false;
  fillRelease(page, "v3.0.0");
  submitButton(page).click();

  assert.equal(JSON.parse(control.raw()).length, 3);
  assert.equal(rows(page), 3, "the list did not load the log the save proved readable");
  assert.equal(page.document.querySelectorAll(".list-state-error").length, 0);
});

test("an import plan is not drawn up over a release log the store refused to read", () => {
  const writes = [];
  const storage = {
    getItem: (key) => {
      if (key === RELEASE_STORAGE_KEY) throw new Error("storage refused the read");
      return null;
    },
    setItem: (key) => writes.push(key),
  };
  // The tolerant loader would plan the import against an empty log, and the
  // commit would write that plan over every stored release.
  assert.throws(() => prepareShiplogImport(storage, "{}"), /refused the read/);
  assert.deepEqual(writes, []);
});

// --- acceptance 4–5: styling at a phone width -------------------------------

test("at a phone width the state text and its action wrap inside the panel, with the site's focus ring", async () => {
  const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const [sheet, site, markup] = await Promise.all([read("releases-proof.css"), read("styles.css"), read("releases.html")]);
  const rule = (source, selector) => {
    const escaped = selector.replace(/[.#()]/g, "\\$&");
    return source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  };

  assert.match(markup, /href="\/releases-proof\.css"/);
  assert.match(rule(sheet, "#release-list .list-state"), /overflow-wrap:anywhere/);
  assert.match(rule(sheet, "#release-list .list-state"), /min-width:0/);
  assert.match(rule(sheet, "#release-list .empty-action"), /max-width:100%/);
  assert.doesNotMatch(rule(site, ".empty-action"), /white-space:\s*nowrap/);
  assert.match(rule(site, ".empty-action:focus-visible"), /outline:3px solid var\(--focus-ring\)/);
  // The error is a bordered shape as well as a label, not a colour alone.
  assert.match(rule(site, ".list-state-error"), /border:1px solid/);
});
