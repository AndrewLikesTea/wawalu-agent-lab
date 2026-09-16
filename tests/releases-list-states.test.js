// The Releases log's distinct states — loading, ready, empty, no-match, failed
// load — and the one region that shows and announces every one of them
// (issues #2268 and #2374).
//
// Driven through the shipped src/releases.html. Three properties are pinned
// against the shapes that lost them: each state's words exist once in the whole
// document, the wait is announced before every read of the log, and a submit
// made while the log is unread never writes over the releases already stored.
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
import { DomEvent, loadPage, tabSequence, textOf, typeText } from "./support/browser.js";

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
const region = (page) => byId(page, "release-list-status");
// The region's heading is the sentence it announces. Read through the heading
// rather than the whole node because the node now also carries the guidance
// sentence and the one action, which is the point of the change.
const regionText = (page) => textOf(region(page).querySelector("h3"));
const activeId = (page) => page.document.activeElement?.getAttribute?.("id") ?? null;
const rows = (page) => page.document.querySelectorAll(".release-toggle").length;
const panelHeading = (page, state) => textOf(page.document.querySelector(`.list-state-${state}`).querySelector("h3"));
// How many elements anywhere on the page carry this text, counted by walking
// children: the harness rejects the universal selector, and a state that is
// drawn in two places is exactly what this file exists to catch.
function countText(node, text) {
  let inChildren = 0;
  for (const child of node.children ?? []) {
    if (child.getAttribute) inChildren += countText(child, text);
  }
  // Only the innermost element holding the words is counted, so an ancestor
  // that contains nothing else is not scored as a second copy of them.
  if (inChildren > 0) return inChildren;
  return textOf(node) === text ? 1 : 0;
}
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
  // As shipped: one visible role="status" for the log, carrying the wait, and
  // the list below it is neither live nor holding a second copy of the state.
  assert.match(markup, /<div class="list-state list-state-loading" id="release-list-status" role="status" aria-live="polite">/);
  assert.match(markup, /<div id="release-list" aria-busy="true" aria-describedby="release-count"><\/div>/);
  assert.doesNotMatch(markup, /id="release-list"[^>]*aria-live/);
  // The shape this replaced: a hidden announcer beside an aria-hidden panel.
  assert.doesNotMatch(markup, /visually-hidden" id="release-list-status"/);
  assert.doesNotMatch(markup, /class="list-state list-state-loading" aria-hidden/);
  // Once in the whole document, so neither reader is told to wait twice.
  assert.equal(markup.match(/Loading releases…/g).length, 1, "the wait is stated more than once in the markup");
  assert.equal(releaseListStateCopy("loading")[0], LOADING);

  const { page } = await openPage(t, { boot: false });
  assert.equal(regionText(page), LOADING, "the parsed page does not announce the wait before load");
  assert.equal(countText(page.document.body, LOADING), 1, "the parsed page states the wait twice");

  // Emptied first, so what the read hears can only have been written by boot.
  region(page).querySelector("h3").textContent = "";
  const heard = listenToReads(page);
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  assert.equal(heard[0], LOADING, "boot read the log before announcing the wait");
});

test("every state is drawn once, in one node, and the list holds nothing but rows", async (t) => {
  // Each state in turn, through the page rather than the renderer, asserting
  // that its words exist exactly once anywhere in the document.
  const { page, control } = await openPage(t, { refuse: true, boot: false });
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  assert.equal(countText(page.document.body, FAILED), 1);
  assert.equal(rows(page), 0);

  control.refuse = false;
  page.document.querySelector(".release-retry-action").click();
  assert.equal(rows(page), 2);
  // Ready hides the region outright rather than leaving a stale sentence in a
  // live node that the next state would announce again on the way back.
  assert.equal(region(page).hidden, true);
  assert.equal(regionText(page), "");

  change(byId(page, "release-status"), "cancelled");
  assert.equal(region(page).hidden, false);
  assert.equal(countText(page.document.body, NO_MATCH), 1);
  assert.equal(byId(page, "release-list").children.length, 0, "the list kept markup under a state panel");
});

test("the one status region is the one live region, and its action is inside it", async (t) => {
  const { page } = await openPage(t, { releases: [] });
  const node = region(page);
  assert.equal(node.getAttribute("role"), "status");
  assert.equal(node.getAttribute("aria-live"), "polite");
  assert.equal(node.getAttribute("aria-hidden"), null, "the panel a reader sees is hidden from assistive technology");
  assert.equal(byId(page, "release-list").getAttribute("aria-live"), null);

  // The action is a real child of the region, so it is in the same accessibility
  // tree as the heading that explains it.
  const action = node.querySelector(".release-empty-action");
  assert.equal(action.tagName, "BUTTON");
  assert.equal(action.hidden, false);
  assert.equal(node.querySelectorAll("button").length, 1, "the region offers more than one next step");
});

test("an empty log settles the region on the empty state without moving focus", async (t) => {
  const { page } = await openPage(t, { releases: [], boot: false });
  byId(page, "release-export").focus();
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });

  assert.equal(regionText(page), EMPTY);
  assert.equal(panelHeading(page, "empty"), EMPTY);
  assert.equal(countText(page.document.body, EMPTY), 1, "the empty state is drawn twice");
  assert.equal(activeId(page), "release-export", "the empty state took focus on its own");
  // Its next step, and the words that send a reader to it, are the recorder's
  // own — the same control the page offers below the log.
  const record = page.document.querySelector(".release-empty-action");
  assert.equal(textOf(record), "Record a release");
  assert.equal(record.getAttribute("aria-controls"), "release-form");
  assert.match(textOf(region(page).querySelector("p")), /^Record a release, with or without linked decisions\./);
  // A shape, not a colour, carries the state alongside the words.
  const glyph = region(page).querySelector(".list-state-glyph");
  assert.equal(glyph.getAttribute("aria-hidden"), "true");
  assert.equal(textOf(glyph), "+");

  record.click();
  assert.equal(activeId(page), "release-version", "the empty state's next step did not reach the recorder");
});

test("a failed load settles the region on the error state without moving focus", async (t) => {
  const { page } = await openPage(t, { refuse: true, boot: false });
  byId(page, "release-export").focus();
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });

  assert.equal(regionText(page), FAILED);
  assert.equal(panelHeading(page, "error"), FAILED, "the loading message was not replaced by a visible error label");
  assert.equal(countText(page.document.body, FAILED), 1, "the failure is stated twice");
  assert.equal(page.document.querySelectorAll(".list-state-loading").length, 0);
  assert.equal(activeId(page), "release-export", "the error state took focus on its own");
  assert.equal(textOf(byId(page, "release-count")), "");
  // Plain words about what failed, and no raw exception text.
  assert.match(textOf(region(page).querySelector("p")), /^This browser’s release log could not be read\./);
  assert.doesNotMatch(textOf(region(page)), /storage refused the read/);
  // Named by a shape as well as by colour, and by a control a keyboard reaches.
  assert.equal(textOf(region(page).querySelector(".list-state-glyph")), "⚠");
  assert.equal(textOf(page.document.querySelector(".release-retry-action")), "Retry");
});

test("rows clear the region, and a filter that empties the view announces no-match without moving focus", async (t) => {
  const { page } = await openPage(t, { boot: false });
  byId(page, "release-export").focus();
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  assert.equal(rows(page), 2);
  assert.equal(regionText(page), "", "a loaded list left a state sentence in the region");

  change(byId(page, "release-status"), "cancelled");
  assert.equal(regionText(page), NO_MATCH);
  assert.equal(panelHeading(page, "no-match"), NO_MATCH);
  assert.equal(activeId(page), "release-export");
  // The narrowed view is its own state, never the first-run one: the words say
  // the log still holds releases, and the next step clears rather than records.
  assert.equal(page.document.querySelectorAll(".list-state-empty").length, 0);
  assert.match(textOf(region(page).querySelector("p")), /^The log still holds releases; none of them matches/);
  assert.equal(textOf(region(page).querySelector(".list-state-glyph")), "⊘");
  assert.equal(page.document.querySelectorAll(".release-empty-action").length, 0, "a narrowed view offered the first-run next step");
  assert.equal(textOf(page.document.querySelector(".release-reset-action")), "Clear search and filters");
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

test("Retry keeps the search and every filter the reader set while the log was unread", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  assert.equal(regionText(page), FAILED);

  // Narrowed while the log is down. The controls are above the region and the
  // region holds the whole state, so nothing a failure draws can replace them.
  const search = byId(page, "release-search");
  search.focus();
  typeText(page.document, "Second");
  change(byId(page, "release-status"), "completed");
  change(byId(page, "release-decision"), "d-queue");
  byId(page, "release-decision-status-accepted").click();
  assert.equal(regionText(page), FAILED, "a filter change overwrote the failure with a no-match");

  control.refuse = false;
  page.document.querySelector(".release-retry-action").click();

  // What came back is the narrowed view, not the whole log re-widened.
  assert.equal(search.value, "Second");
  assert.equal(byId(page, "release-status").value, "completed");
  assert.equal(byId(page, "release-decision").value, "d-queue");
  assert.equal(byId(page, "release-decision-status-accepted").checked, true);
  assert.equal(rows(page), 1);
  assert.equal(textOf(byId(page, "release-count")), "Showing 1 of 2 releases, newest first.");
  assert.equal(region(page).hidden, true);

  // And the search that now excludes everything is the no-match state, not a
  // second failure and not a claim that the log is empty.
  change(byId(page, "release-status"), "cancelled");
  assert.equal(regionText(page), NO_MATCH);
  assert.equal(page.document.querySelectorAll(".list-state-error").length, 0);
});

// The keyboard order the three states share: the reader reaches the controls
// that narrow the log, then the log's own state and the one way out of it.
// Asserted by document order rather than by simulated tabbing — this harness
// restarts pressTab at the first stop and never blurs a control it disables.
test("the state's action is the last stop after the search and the filters", async (t) => {
  const { page } = await openPage(t, { releases: [] });
  const order = tabSequence(page.document).map((node) => node.getAttribute("id") ?? node.className);
  const at = (value) => order.findIndex((entry) => entry === value);

  assert.ok(at("release-search") >= 0, "the search is not a tab stop");
  assert.ok(at("release-search") < at("release-status"), "the filters come before the search");
  assert.ok(at("release-status") < at("empty-action release-empty-action"),
    "the state's next step is reachable before the filters that narrow the log");
  assert.ok(at("empty-action release-empty-action") < at("release-version"),
    "the state's next step sits after the recorder it points at");
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
  assert.match(rule(sheet, "#release-list-status"), /overflow-wrap:anywhere/);
  assert.match(rule(sheet, "#release-list-status"), /min-width:0/);
  assert.match(rule(sheet, "#release-list-status .empty-action"), /max-width:100%/);
  assert.doesNotMatch(rule(site, ".empty-action"), /white-space:\s*nowrap/);
  assert.match(rule(site, ".empty-action:focus-visible"), /outline:3px solid var\(--focus-ring\)/);
  // At a phone width the one next step fills the column it sits in.
  assert.match(sheet, /@media\(max-width:520px\) \{ #release-list-status \.empty-action\{width:100%\} \}/);
  // The error is a bordered shape as well as a label, not a colour alone, and
  // the ink it states itself in is the pairing styles.css already ships:
  // #713b37 on #fbf1f1.
  assert.match(rule(site, ".list-state-error"), /border:1px solid/);
  assert.match(rule(site, ".list-state-error"), /background:#fbf1f1/);
  assert.match(rule(site, ".list-state-error h3"), /color:#713b37/);
  // The glyph takes the panel's own ink rather than introducing a hue, and a
  // state with no glyph does not leave a blank line where one would be.
  assert.doesNotMatch(rule(sheet, ".list-state-glyph"), /color:/);
  assert.match(rule(sheet, ".list-state-glyph:empty"), /display:none/);
});
