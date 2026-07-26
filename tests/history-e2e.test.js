// End-to-end regression for the decision-and-release history.
//
// Every test here drives the shipped decisions page — the real markup from
// src/index.html, booted the way the page boots it (app.js, then
// shiplog-export-page.js) — and asserts only on what a user can see: rendered
// rows, the visible count, the empty-state copy, the disabled state of a
// control, and the file the export button hands back. No internal helper is
// called to produce an assertion, and no test reads module state.
//
// Determinism: no network (the harness throws on an undeclared request), no
// clock thresholds, no sleeps. Each test parses a fresh page and seeds its own
// browser storage, so nothing leaks between tests and order never matters.
// Generated ids and timestamps are asserted by shape, never by value.

import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { createShiplogExport, initShiplogExport } from "../src/shiplog-export.js";
import { initShiplogImport } from "../src/shiplog-import.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import {
  DomEvent,
  loadPage,
  parseHtml,
  pressEnter,
  pressKey,
  pressTab,
  tabSequence,
  textOf,
  typeText,
} from "./support/browser.js";
import { readFile } from "node:fs/promises";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const DEMO_ROUTE = "/releases-demo-data.json";
const NO_DEMO_DATA = { decisions: [], releases: [] };

// Fixtures are explicit and fixed: known ids, known past timestamps, known
// statuses. Nothing is inherited from the demo seed unless a test asks for it.
const SEEDED_DECISION = {
  id: "seed-cache",
  title: "Cache the read path",
  context: "Read latency spikes under load; add a short-TTL cache.",
  alternatives: "Query tuning alone.",
  owner: "Ari",
  status: "approved",
  createdAt: "2026-01-05T09:00:00.000Z",
};

const SEEDED_PENDING_DECISION = {
  id: "seed-flags",
  title: "Introduce feature flags",
  context: "Decouple deploy from release.",
  alternatives: "Long-lived release branches.",
  owner: "Priya",
  status: "pending",
  createdAt: "2026-01-04T09:00:00.000Z",
};

// The link under test: this release names SEEDED_DECISION as the decision
// behind it. Seeding it through the browser storage the app persists to is the
// only way a release can exist at all — see the two todo tests at the bottom.
const SEEDED_RELEASE = {
  id: "seed-r-1-4-0",
  version: "v1.4.0",
  title: "Read path latency",
  description: "The read cache shipped.",
  status: "completed",
  owner: "Ari",
  createdAt: "2026-01-06T09:00:00.000Z",
  decisionIds: [SEEDED_DECISION.id],
};

const NEW_DECISION = {
  title: "Adopt a durable job queue",
  context: "Background work was lost on deploys; move to an at-least-once queue.",
  alternatives: "Database polling and in-process retries.",
  owner: "Tess",
  status: "approved",
};

async function openHistory(t, { decisions = [], releases = [], demo = NO_DEMO_DATA } = {}) {
  const page = await loadPage(DECISIONS_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
    routes: { [DEMO_ROUTE]: demo },
  });
  t.after(() => page.restore());
  // The two module scripts src/index.html loads, in page order.
  await initDecisionLog(page.document, page.storage);
  initShiplogExport(page.document, page.storage);
  initShiplogImport(page.document, page.storage);
  // Wait on state, not on time: the page marks itself ready once the history
  // has rendered.
  assert.equal(
    page.document.documentElement.dataset.shiplog,
    "ready",
    "the history never finished rendering",
  );
  return page;
}

const list = (page) => page.document.querySelector("#decision-list");
const cards = (page) => list(page).querySelectorAll(".history-card");
const rowTitles = (page) => cards(page).map((card) => textOf(card.querySelector("h3")));
const countText = (page) => textOf(page.document.querySelector("#decision-count"));
const emptyState = (page) => list(page).querySelector(".list-state-empty");

function cardTitled(page, title) {
  const card = cards(page).find((candidate) => textOf(candidate.querySelector("h3")) === title);
  assert.ok(card, `no history row is titled "${title}"`);
  return card;
}

function metaValue(card, label) {
  const pair = card.querySelectorAll(".meta-pair")
    .find((candidate) => textOf(candidate.querySelector(".meta-label")) === `${label}:`);
  assert.ok(pair, `the row shows no "${label}" field`);
  return textOf(pair.querySelector(".meta-value"));
}

// Filling a form field the way a user does: focus it, then type.
function fillDecisionForm(page, values) {
  for (const [field, value] of Object.entries(values)) {
    const control = page.document.querySelector(`#${field}`);
    assert.ok(control, `the decision form has no "${field}" control`);
    if (control.tagName === "SELECT") {
      control.value = value;
      continue;
    }
    control.focus();
    typeText(page.document, value);
  }
}

function submitDecisionForm(page) {
  const submit = page.document.querySelector("#decision-form").querySelector('button[type="submit"]');
  assert.equal(textOf(submit), "Record decision", "the decision form's submit action was renamed");
  submit.click();
}

function chooseRecordType(page, value) {
  page.document.querySelector(`#record-type-${value}`).click();
}

function chooseOption(page, selector, value) {
  const select = page.document.querySelector(selector);
  select.value = value;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return select;
}

function search(page, query) {
  const input = page.document.querySelector("#decision-search");
  input.focus();
  typeText(page.document, query);
}

// Tab forward until the wanted control has focus. Failing here is the point of
// the keyboard test: it means the control cannot be reached with the keyboard.
function tabTo(page, target, label) {
  const wanted = typeof target === "string" ? page.document.querySelector(target) : target;
  assert.ok(wanted, `${label} is not on the page at all`);
  const stops = tabSequence(page.document).length + 1;
  for (let step = 0; step < stops; step += 1) {
    if (page.document.activeElement === wanted) return wanted;
    pressTab(page.document);
  }
  assert.fail(`${label} is not reachable by keyboard`);
}

test("a first-run history shows the no-records-yet empty state", async (t) => {
  const page = await openHistory(t);

  const state = emptyState(page);
  assert.ok(state, "no-records-yet empty state is missing");
  assert.equal(
    textOf(state.querySelector("h3")),
    "No decisions yet",
    "no-records-yet empty state heading changed",
  );
  assert.equal(
    textOf(state.querySelector("p")),
    "Record the title, context, owner, and status behind a useful decision. You can link it to a release when that work ships.",
    "no-records-yet empty state copy changed",
  );
  assert.equal(
    textOf(state.querySelector("button")),
    "Record your first decision",
    "no-records-yet empty state action changed",
  );
  assert.equal(countText(page), "0 records", "empty history reports the wrong record count");
});

test("recording a decision shows it in the history with context, alternatives, owner, and status", async (t) => {
  const page = await openHistory(t);

  fillDecisionForm(page, NEW_DECISION);
  submitDecisionForm(page);

  const card = cardTitled(page, NEW_DECISION.title);
  assert.equal(metaValue(card, "Type"), "Decision", "the recorded row is not labelled as a decision");
  assert.equal(metaValue(card, "Status"), NEW_DECISION.status, "the recorded decision shows the wrong status");
  assert.equal(textOf(card.querySelector(".context")), NEW_DECISION.context, "the recorded context is not shown");
  assert.ok(
    textOf(card.querySelector(".alternatives")).includes(NEW_DECISION.alternatives),
    "the recorded alternatives are not shown",
  );
  assert.match(textOf(card.querySelector(".owner")), /Tess$/, "the recorded owner is not shown");
  assert.equal(countText(page), "1 record", "the count did not follow the recorded decision");
  assert.equal(emptyState(page), null, "the empty state is still shown after recording a decision");
});

test("a recorded release appears in the history with the decision it is linked to", async (t) => {
  const page = await openHistory(t, {
    decisions: [SEEDED_DECISION],
    releases: [SEEDED_RELEASE],
  });

  const card = cardTitled(page, "v1.4.0 · Read path latency");
  assert.equal(metaValue(card, "Type"), "Release", "the release row is not labelled as a release");
  assert.equal(metaValue(card, "Status"), "completed", "the release row shows the wrong status");
  assert.equal(
    textOf(card.querySelector(".release-linked")),
    "Linked decisions1 decision · 1 approved",
    "the release row no longer states the decisions it is linked to",
  );
  assert.equal(countText(page), "2 records", "the history count does not include both record kinds");
});

test("filtering by record type narrows the history to decisions or releases", async (t) => {
  const page = await openHistory(t, {
    decisions: [SEEDED_DECISION],
    releases: [SEEDED_RELEASE],
  });

  chooseRecordType(page, "release");
  assert.deepEqual(rowTitles(page), ["v1.4.0 · Read path latency"], "the Releases filter did not hide decisions");
  assert.equal(countText(page), "1 of 2 records", "the filtered count is wrong for Releases");

  chooseRecordType(page, "decision");
  assert.deepEqual(rowTitles(page), [SEEDED_DECISION.title], "the Decisions filter did not hide releases");
  assert.equal(countText(page), "1 of 2 records", "the filtered count is wrong for Decisions");

  chooseRecordType(page, "all");
  assert.equal(cards(page).length, 2, "clearing the record type filter did not restore the history");
  assert.equal(countText(page), "2 records", "the unfiltered count did not come back");
});

test("filtering by decision status narrows the history and is unavailable for releases", async (t) => {
  const page = await openHistory(t, {
    decisions: [SEEDED_DECISION, SEEDED_PENDING_DECISION],
    releases: [SEEDED_RELEASE],
  });

  chooseOption(page, "#filter-status", "approved");
  assert.deepEqual(rowTitles(page), [SEEDED_DECISION.title], "the approved status filter shows the wrong records");
  assert.equal(countText(page), "1 of 3 records", "the status-filtered count is wrong");

  chooseOption(page, "#filter-status", "pending");
  assert.deepEqual(rowTitles(page), [SEEDED_PENDING_DECISION.title], "the pending status filter shows the wrong records");

  chooseRecordType(page, "release");
  const status = page.document.querySelector("#filter-status");
  assert.equal(status.disabled, true, "the status filter stays enabled for releases, where it can never match");
  assert.equal(status.value, "all", "the inapplicable status selection was left in place");
  assert.equal(
    textOf(page.document.querySelector("#filter-status-hint")),
    "Unavailable while the record type is set to Releases — a release has no decision status.",
    "the unavailable status hint copy changed",
  );

  chooseRecordType(page, "all");
  assert.equal(status.disabled, false, "the status filter did not become available again");
  assert.equal(
    textOf(page.document.querySelector("#filter-status-hint")),
    "Applies to decisions. Choosing a status shows decision records only.",
    "the status hint copy changed",
  );
});

test("a filter that matches nothing shows the no-results empty state and can be reset", async (t) => {
  const page = await openHistory(t, {
    decisions: [SEEDED_DECISION],
    releases: [SEEDED_RELEASE],
  });

  search(page, "nothing in this log matches");
  assert.equal(cards(page).length, 0, "a search matching nothing still rendered rows");

  const state = emptyState(page);
  assert.ok(state, "no-results-after-filter empty state is missing");
  assert.equal(
    textOf(state.querySelector("h3")),
    "No records match your filters",
    "no-results-after-filter empty state heading changed",
  );
  assert.equal(
    textOf(state.querySelector("p")),
    "No decision or release matches the current record type, status, owner, and search. Reset the filters to see the full history.",
    "no-results-after-filter empty state copy changed",
  );

  const reset = state.querySelector("button");
  assert.equal(textOf(reset), "Reset filters", "no-results-after-filter empty state action changed");
  reset.click();

  assert.equal(page.document.querySelector("#decision-search").value, "", "reset did not clear the search");
  assert.equal(cards(page).length, 2, "reset did not restore the full history");
  assert.equal(countText(page), "2 records", "reset did not restore the full count");
});

test("exporting downloads one JSON record that preserves the decision-release link", async (t) => {
  const page = await openHistory(t, {
    decisions: [SEEDED_DECISION],
    releases: [SEEDED_RELEASE],
    // A demo record is on the page but is not the user's data: the export
    // contract is "only what is stored in this browser".
    demo: {
      decisions: [{ ...SEEDED_PENDING_DECISION, id: "demo-only" }],
      releases: [],
    },
  });

  fillDecisionForm(page, NEW_DECISION);
  submitDecisionForm(page);
  page.document.querySelector("#export-shiplog").click();

  assert.equal(page.downloads.length, 1, "the export button produced no download");
  const [download] = page.downloads;
  assert.match(
    download.filename,
    /^shiplog-history-\d{4}-\d{2}-\d{2}\.json$/,
    "the exported filename shape changed",
  );

  const payload = JSON.parse(download.text);
  assert.equal(payload.schema, "shiplog-history", "the export schema name changed");
  assert.equal(payload.version, 1, "the export version changed");
  assert.ok(
    typeof payload.generatedAt === "string" && !Number.isNaN(Date.parse(payload.generatedAt)),
    "the export is missing a parseable generatedAt stamp",
  );

  const exported = payload.decisions.find((decision) => decision.title === NEW_DECISION.title);
  assert.ok(exported, "the decision the user just recorded is missing from the export");
  assert.equal(exported.context, NEW_DECISION.context, "the exported decision lost its context");
  assert.equal(exported.alternatives, NEW_DECISION.alternatives, "the exported decision lost its alternatives");
  assert.equal(exported.owner, NEW_DECISION.owner, "the exported decision lost its owner");
  assert.equal(exported.status, NEW_DECISION.status, "the exported decision lost its status");
  assert.ok(typeof exported.id === "string" && exported.id !== "", "the exported decision has no id");
  assert.ok(!Number.isNaN(Date.parse(exported.createdAt)), "the exported decision has no parseable createdAt");

  assert.ok(
    payload.decisions.some((decision) => decision.id === SEEDED_DECISION.id),
    "the previously recorded decision is missing from the export",
  );
  assert.ok(
    !payload.decisions.some((decision) => decision.id === "demo-only"),
    "the export leaked example records that are not the user's own",
  );

  const release = payload.releases.find((candidate) => candidate.id === SEEDED_RELEASE.id);
  assert.ok(release, "the release is missing from the export");
  assert.deepEqual(
    release.decisionIds,
    [SEEDED_DECISION.id],
    "the decision-release association did not survive the export",
  );
  assert.ok(
    payload.decisions.some((decision) => decision.id === release.decisionIds[0]),
    "the exported release points at a decision that is not in the same export",
  );

  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-status")),
    "Shiplog history exported.",
    "the export confirmation copy changed",
  );
});

test("the whole flow — record, filter, export — works with the keyboard alone", async (t) => {
  const page = await openHistory(t, {
    decisions: [SEEDED_DECISION, SEEDED_PENDING_DECISION],
    releases: [SEEDED_RELEASE],
  });
  const { document } = page;

  // Record a decision: every field reached by Tab, submitted with Enter.
  tabTo(page, "#title", "the decision title field");
  typeText(document, NEW_DECISION.title);
  tabTo(page, "#context", "the decision context field");
  typeText(document, NEW_DECISION.context);
  tabTo(page, "#alternatives", "the decision alternatives field");
  typeText(document, NEW_DECISION.alternatives);
  tabTo(page, "#owner", "the decision owner field");
  typeText(document, NEW_DECISION.owner);
  tabTo(page, "#status", "the decision status control");
  pressKey(document, "ArrowDown"); // pending -> approved
  assert.equal(document.activeElement.value, "approved", "the status control cannot be changed with the arrow keys");
  const submit = document.querySelector("#decision-form").querySelector('button[type="submit"]');
  tabTo(page, submit, "the record-decision button");
  pressEnter(document);

  assert.ok(
    rowTitles(page).includes(NEW_DECISION.title),
    "the decision recorded with the keyboard is not in the history",
  );

  // Filter by record type: the radio group is one tab stop, arrows move within it.
  tabTo(page, "#record-type-all", "the record type filter");
  pressKey(document, "ArrowDown");
  assert.equal(document.activeElement.id, "record-type-decision", "the record type options are not reachable by arrow keys");
  assert.ok(
    !rowTitles(page).includes("v1.4.0 · Read path latency"),
    "filtering to decisions with the keyboard still shows releases",
  );
  pressKey(document, "ArrowDown");
  assert.equal(document.activeElement.id, "record-type-release", "the Releases option is not reachable by arrow keys");
  assert.deepEqual(rowTitles(page), ["v1.4.0 · Read path latency"], "the keyboard-driven Releases filter shows the wrong rows");

  // Filter by status: back to all records first, then arrow through the select.
  pressKey(document, "ArrowUp");
  pressKey(document, "ArrowUp");
  assert.equal(document.activeElement.id, "record-type-all", "the All records option is not reachable by arrow keys");
  tabTo(page, "#filter-status", "the decision status filter");
  pressKey(document, "ArrowDown"); // all -> approved
  assert.deepEqual(
    rowTitles(page).toSorted(),
    [NEW_DECISION.title, SEEDED_DECISION.title].toSorted(),
    "the keyboard-driven status filter shows the wrong rows",
  );

  // Reset, then export.
  tabTo(page, "#clear-decision-filters", "the clear-filters button");
  pressEnter(document);
  assert.equal(countText(page), "4 records", "clearing the filters with the keyboard did not restore the history");

  tabTo(page, "#export-shiplog", "the export button");
  pressEnter(document);
  assert.equal(page.downloads.length, 1, "the export button cannot be activated with the keyboard");

  const payload = JSON.parse(page.downloads[0].text);
  assert.ok(
    payload.decisions.some((decision) => decision.title === NEW_DECISION.title),
    "the keyboard-recorded decision is missing from the keyboard-triggered export",
  );
  assert.deepEqual(
    payload.releases[0].decisionIds,
    [SEEDED_DECISION.id],
    "the decision-release association did not survive the keyboard-driven export",
  );
});

test("opening a history row with Enter follows it to the record's detail page", async (t) => {
  const page = await openHistory(t, { decisions: [SEEDED_DECISION] });

  tabTo(page, ".decision-detail-link", "the decision row");
  pressEnter(page.document);

  assert.deepEqual(
    page.navigations,
    [`/decision.html?id=${SEEDED_DECISION.id}`],
    "pressing Enter on a history row did not open its detail page",
  );
});

// Hand the page a chosen file the way the file picker would, then let the
// module's own change handler run. Nothing here reaches the network: the
// harness throws on an undeclared request, so a POST would fail this test.
async function chooseImportFile(page, text) {
  const input = page.document.querySelector("#import-shiplog-file");
  assert.ok(input, "the history page has no import file control");
  input.files = [{ text: async () => text }];
  await input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return input;
}

const importHeadline = (page) => textOf(page.document.querySelector("#import-shiplog-headline"));

test("the import control is reachable by keyboard and summarises before writing", async (t) => {
  const page = await openHistory(t, { decisions: [SEEDED_DECISION], releases: [SEEDED_RELEASE] });
  const file = JSON.stringify(createShiplogExport({
    getItem: () => JSON.stringify([SEEDED_PENDING_DECISION]),
  }, { generatedAt: "2026-02-01T00:00:00.000Z" }));

  // A real label/input pair, so the picker is in the document tab sequence.
  tabTo(page, "#import-shiplog-file", "the import file control");
  assert.ok(
    textOf(page.document.querySelector('label[for="import-shiplog-file"]')).startsWith("Choose JSON file"),
    "the import control has no visible label",
  );

  await chooseImportFile(page, file);

  assert.equal(
    importHeadline(page),
    "Found 1 decision and 0 releases in this file. 1 record new, 0 already in this browser and skipped. 0 records rejected, 0 release links dropped.",
    "the pre-commit summary does not state what would be written",
  );
  assert.equal(
    textOf(page.document.querySelector("#import-shiplog-commit")),
    "Restore 1 record",
    "the primary action does not name the number of records it would write",
  );
  assert.deepEqual(
    JSON.parse(page.storage.getItem(STORAGE_KEY)).map((decision) => decision.id),
    [SEEDED_DECISION.id],
    "records were written to storage before the user confirmed",
  );

  // Confirming from the keyboard writes once, and the restored record shows up
  // in the very next export.
  tabTo(page, "#import-shiplog-commit", "the restore button");
  pressEnter(page.document);

  assert.deepEqual(
    JSON.parse(page.storage.getItem(STORAGE_KEY)).map((decision) => decision.id),
    [SEEDED_DECISION.id, SEEDED_PENDING_DECISION.id],
    "confirming the import did not restore the record",
  );
  assert.equal(
    page.document.querySelector("#import-shiplog-summary").hidden,
    true,
    "the spent plan is still on screen",
  );
  assert.equal(
    textOf(page.document.querySelector("#import-shiplog-status")),
    "Restored 1 record. Reload to see them in your history.",
  );
});

test("a file that is not a Shiplog export is refused as a whole and changes nothing", async (t) => {
  const page = await openHistory(t, { decisions: [SEEDED_DECISION] });

  await chooseImportFile(page, "not a shiplog file");

  assert.match(importHeadline(page), /^This file could not be read as a Shiplog export\. file: expected JSON/);
  assert.equal(page.document.querySelector("#import-shiplog-commit").hidden, true);
  assert.deepEqual(
    JSON.parse(page.storage.getItem(STORAGE_KEY)).map((decision) => decision.id),
    [SEEDED_DECISION.id],
    "an unreadable file changed stored records",
  );
});

// --------------------------------------------------------------------------
// Product gaps found while writing this suite. These tests describe the
// behaviour PRODUCT.md promises, fail against what is shipped today, and are
// marked todo so the suite stays green while the gap stays visible. They are
// the evidence; the fix belongs to the owning engineer (see PR follow-ups).
// --------------------------------------------------------------------------

// FOLLOW-UP 1: PRODUCT.md — "Record a release and associate it with decisions."
// No shipped page has a release form. Releases only ever come from the
// read-only demo seed or from browser storage that no UI writes to
// (saveReleases() has no production caller), so a user cannot record one.
test("a release can be recorded from the UI", { todo: "no shipped page records a release" }, async () => {
  const pages = await Promise.all([DECISIONS_PAGE, RELEASES_PAGE]
    .map(async (url) => parseHtml(await readFile(url, "utf8"))));
  const controls = pages.flatMap((document) => document.querySelectorAll("button,a,input,summary"))
    .map((control) => textOf(control));
  assert.ok(
    controls.some((label) => /record .*release|new release|add .*release/i.test(label)),
    "no control on the decisions or releases page lets a user record a release",
  );
});

// FOLLOW-UP 2: same gap, association half. A release's decisionIds can only be
// set outside the product, so the "associate" step of the flow is untestable at
// the user-visible level; the suite pins the association's *rendering* and its
// survival through export instead.
test("a release can be associated with a decision from the UI", { todo: "no shipped page links a release to a decision" }, async () => {
  const document = parseHtml(await readFile(RELEASES_PAGE, "utf8"));
  const controls = document.querySelectorAll("button,a,input,select,label")
    .map((control) => textOf(control));
  assert.ok(
    controls.some((label) => /link .*decision|associate .*decision/i.test(label)),
    "no control on the releases page lets a user link a decision to a release",
  );
});

// FOLLOW-UP 3: the export panel's count is computed once at page load, so after
// recording a decision the panel still offers to export the old number while
// the button downloads the new one.
test("the export panel count follows the records the user just recorded", { todo: "the export count is only computed at page load" }, async (t) => {
  const page = await openHistory(t);

  fillDecisionForm(page, NEW_DECISION);
  submitDecisionForm(page);

  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-counts")),
    "Ready to export 1 decision and 0 releases stored in this browser.",
    "the export panel still advertises the record count from page load",
  );
});
