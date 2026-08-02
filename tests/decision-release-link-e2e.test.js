// End-to-end regression for one claim: a decision linked to a release stays
// linked on every surface a release manager reads it from.
//
// The three surfaces are the browsable history list, the same list under each
// of its filters, and the JSON file the export button hands back. The link
// itself is an identifier — the counterpart's id, carried in the `href` of the
// row's `.record-link` and in the release's `decisionIds` in the file — so
// every assertion here is on a count of links or on the value of that
// identifier, never on element identity.
//
// Nothing is seeded past the record path. The decision is typed into the
// decisions page and the release into the releases page, with browser storage
// carried between them the way a browser carries localStorage across a
// navigation, so the ids these tests follow are the ids the shipped recorders
// actually wrote. A fixture poked straight into storage would prove the
// renderer works and say nothing about the seam between the two recorders.
//
// Failure messages name the surface that lost the link — "history list",
// "filtered history", "JSON export" — because all three read the same records
// and the first question after a red run is which one dropped it.
//
// Determinism: no network (the harness throws on an undeclared request), no
// clock thresholds, no sleeps. Each test starts from an empty browser and hands
// every page an empty example seed, so nothing leaks between tests and order
// never matters. Generated ids are read back from storage, never predicted.

import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { initShiplogExport } from "../src/shiplog-export.js";
import { DomEvent, loadPage, pressKey, textOf, typeText } from "./support/browser.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);

// The example records are module constants the pages compose in, not a fetch,
// so a log containing nothing but the work these tests do is asked for with an
// empty seed. tests/demo-path.test.js is the one that exercises the real seed.
const NO_DEMO_DATA = { decisions: [], releases: [] };
const EMPTY_BROWSER = { [STORAGE_KEY]: "[]", [RELEASE_STORAGE_KEY]: "[]" };

// What the user types. The two owners differ so the owner filter can select one
// record and hide the other, which is the asymmetric case these tests are for.
const DECISION = {
  title: "Adopt a durable job queue",
  context: "Background work was lost on deploys; move to an at-least-once queue.",
  alternatives: "Database polling and in-process retries.",
  owner: "Ari",
  status: "accepted",
};

const RELEASE = {
  version: "v2.1.0",
  title: "Durable background work",
  description: "The at-least-once queue shipped behind a flag.",
  owner: "Priya",
  releasedOn: "2026-07-02",
};

const RELEASE_ROW_TITLE = `${RELEASE.version} · ${RELEASE.title}`;

const releaseHref = (id) => `/release.html?id=${id}`;
const decisionHref = (id) => `/decision.html?id=${id}`;
// The id a surface is carrying, read back out of the link it rendered, so the
// history list and the export file can be compared against each other rather
// than each against the same local constant.
const idInHref = (href) => new URLSearchParams(String(href).split("?")[1] ?? "").get("id");

// The two keys a Shiplog browser holds, carried forward exactly as they are so
// the next page reads what the last page wrote and nothing else.
function browserState(page) {
  return Object.fromEntries([STORAGE_KEY, RELEASE_STORAGE_KEY]
    .map((key) => [key, page.storage.getItem(key)])
    .filter(([, value]) => value !== null));
}

// --- the pages -------------------------------------------------------------

async function openHistory(t, storage = EMPTY_BROWSER) {
  const page = await loadPage(DECISIONS_PAGE, { storage });
  t.after(() => page.restore());
  // The module scripts src/index.html loads, in page order.
  await initDecisionLog(page.document, page.storage, { seed: NO_DEMO_DATA });
  initShiplogExport(page.document, page.storage);
  // Wait on state, not on time: the page marks itself ready once it rendered.
  assert.equal(page.document.documentElement.dataset.shiplog, "ready", "the history never finished rendering");
  return page;
}

async function openReleases(t, storage) {
  const page = await loadPage(RELEASES_PAGE, { storage });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, { seed: NO_DEMO_DATA });
  assert.equal(
    page.document.documentElement.dataset.shiplogReleases,
    "ready",
    "the releases page never finished rendering",
  );
  return page;
}

// --- the record path -------------------------------------------------------

function fill(page, id, value) {
  const control = page.document.querySelector(`#${id}`);
  assert.ok(control, `the form has no #${id} field`);
  control.focus();
  typeText(page.document, value);
  return control;
}

function clickButton(page, label) {
  const button = page.document.querySelectorAll("button").find((candidate) => textOf(candidate) === label);
  assert.ok(button, `no button on this page is labelled "${label}"`);
  button.click();
}

// Record the decision through the shipped form, then hand back what the browser
// is holding: the id the rest of the link follows is the persisted one.
async function recordDecision(t) {
  const page = await openHistory(t);
  fill(page, "title", DECISION.title);
  fill(page, "context", DECISION.context);
  fill(page, "alternatives", DECISION.alternatives);
  fill(page, "owner", DECISION.owner);
  // The status is chosen with the arrow keys, so the option has to be one the
  // control really lists — this harness would accept an assignment of any value.
  page.document.querySelector("#status").focus();
  pressKey(page.document, "ArrowDown");
  assert.equal(
    page.document.activeElement.value,
    DECISION.status,
    "the decision status control does not offer accepted as the next option",
  );
  clickButton(page, "Record decision");

  const stored = JSON.parse(page.storage.getItem(STORAGE_KEY) ?? "[]");
  assert.equal(stored.length, 1, "the recorded decision was not saved in this browser");
  return { page, decision: stored[0] };
}

// Link the decision the way a user finds it — by the title on the picker's
// label, not by an id the page never shows them.
function linkDecision(page, title) {
  const label = page.document.querySelectorAll(".decision-picker-label")
    .find((candidate) => textOf(candidate) === title);
  assert.ok(label, `the release recorder offers no decision titled "${title}"`);
  const option = page.document.getElementById(label.getAttribute("for"));
  assert.ok(option, `the option for "${title}" has no control`);
  option.click();
  assert.equal(option.checked, true, `"${title}" could not be linked to the release`);
}

async function recordRelease(t, storage) {
  const page = await openReleases(t, storage);
  fill(page, "release-version", RELEASE.version);
  fill(page, "release-released-on", RELEASE.releasedOn);
  fill(page, "release-owner", RELEASE.owner);
  fill(page, "release-title", RELEASE.title);
  fill(page, "release-description", RELEASE.description);
  linkDecision(page, DECISION.title);
  clickButton(page, "Record release");

  const stored = JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY) ?? "[]");
  assert.equal(stored.length, 1, "the recorded release was not saved in this browser");
  return { page, release: stored[0] };
}

// Both records, through both recorders, ending on the history page that has to
// show the association. Returns the ids the recorders wrote, so a test asserts
// against what was stored rather than against a value it invented.
async function shipTheDecision(t) {
  const recorder = await recordDecision(t);
  const { decision } = recorder;
  const afterDecision = browserState(recorder.page);
  recorder.page.restore();

  const shipper = await recordRelease(t, afterDecision);
  const { release } = shipper;
  const afterRelease = browserState(shipper.page);
  shipper.page.restore();

  assert.deepEqual(
    release.decisionIds,
    [decision.id],
    "the release recorder stored no link to the decision the user ticked",
  );
  return { page: await openHistory(t, afterRelease), decision, release };
}

// --- the history surface ---------------------------------------------------

const historyList = (page) => page.document.querySelector("#decision-list");
const historyCards = (page) => historyList(page).querySelectorAll(".history-card");
const rowTitles = (page) => historyCards(page).map((card) => textOf(card.querySelector("h3")));
const historyCount = (page) => textOf(page.document.querySelector("#decision-count"));
const linksInList = (page) => historyList(page).querySelectorAll(".record-link");

// The whole row for a record, addressed the way a reader finds it: by its
// title. The relationship line is a sibling of the card's own link — an anchor
// cannot nest — so the row, not the card, is what carries the counterpart.
function rowFor(page, title) {
  const card = historyCards(page).find((candidate) => textOf(candidate.querySelector("h3")) === title);
  assert.ok(card, `no history row is titled "${title}"`);
  return card.parentNode;
}

const linksOn = (row) => row.querySelectorAll(".record-link");

// One link, carrying one identifier, labelled by the counterpart's own words.
function assertLink(row, { href, label, surface, from }) {
  const links = linksOn(row);
  assert.equal(links.length, 1, `${surface}: the ${from} row carries no link to its counterpart`);
  assert.equal(
    idInHref(links[0].getAttribute("href")),
    idInHref(href),
    `${surface}: the ${from} row's link no longer carries the counterpart's id`,
  );
  assert.equal(
    textOf(links[0].querySelector(".record-link-label")),
    label,
    `${surface}: the ${from} row's link no longer names its counterpart`,
  );
  return links[0];
}

test("a recorded decision and the release that shipped it link to each other in the history, unaided", async (t) => {
  const { page, decision, release } = await shipTheDecision(t);

  // No filter set, no state poked: this is the list as it renders on arrival.
  assert.deepEqual(
    rowTitles(page).toSorted(),
    [DECISION.title, RELEASE_ROW_TITLE].toSorted(),
    "history list: the recorded decision and release are not both in the history",
  );
  assert.equal(historyCount(page), "2 records", "history list: the history miscounts what was recorded");
  assert.equal(
    linksInList(page).length,
    2,
    "history list: the association is not stated on both rows — a decision and the release that shipped it are one link seen from two sides",
  );

  assertLink(rowFor(page, DECISION.title), {
    href: releaseHref(release.id),
    label: RELEASE.version,
    surface: "history list",
    from: "decision",
  });
  assertLink(rowFor(page, RELEASE_ROW_TITLE), {
    href: decisionHref(decision.id),
    label: DECISION.title,
    surface: "history list",
    from: "release",
  });

  // Nothing is filtered, so no counterpart is out of view and no link says it is.
  assert.equal(
    historyList(page).querySelectorAll(".record-link-hidden").length,
    0,
    "history list: an unfiltered history marked a counterpart as out of view",
  );
});

// The behaviour a release manager auditing the log needs, and the behaviour the
// page already implements (app.js: "filtering narrows the list, never the
// relationship"): the surviving row keeps the identifier of the counterpart the
// filter removed, and the link says the counterpart is not in this view. A
// filter that dropped the link instead would make an audit read as though the
// decision had never shipped.
test("a filter that hides one side keeps the identifier on the surviving row, marked not in this view", async (t) => {
  const { page, decision, release } = await shipTheDecision(t);
  const { document } = page;

  // The link that survives a filter, and the note that says its counterpart
  // left the list. Both are asserted every time: the identifier alone would
  // pass on a view that silently claims the release is on screen.
  function assertSurvivingLink(row, { href, label, from, filter }) {
    const surface = `filtered history (${filter})`;
    const link = assertLink(row, { href, label, surface, from });
    assert.equal(
      link.classList.contains("record-link-hidden"),
      true,
      `${surface}: the link to a counterpart the filter removed is not marked as out of view`,
    );
    assert.match(
      textOf(link.querySelector(".record-link-note")),
      /not in this view/,
      `${surface}: the link says nothing about the counterpart having left the list`,
    );
  }

  // 1. Record type, both ways round. Each direction hides exactly one side.
  document.querySelector("#record-type-release").click();
  assert.deepEqual(rowTitles(page), [RELEASE_ROW_TITLE], "filtered history (record type: Releases): the wrong rows survived");
  assert.equal(historyCount(page), "1 of 2 records", "filtered history (record type: Releases): a link was counted as a record");
  assertSurvivingLink(rowFor(page, RELEASE_ROW_TITLE), {
    href: decisionHref(decision.id),
    label: DECISION.title,
    from: "release",
    filter: "record type: Releases",
  });

  document.querySelector("#record-type-decision").click();
  assert.deepEqual(rowTitles(page), [DECISION.title], "filtered history (record type: Decisions): the wrong rows survived");
  assertSurvivingLink(rowFor(page, DECISION.title), {
    href: releaseHref(release.id),
    label: RELEASE.version,
    from: "decision",
    filter: "record type: Decisions",
  });
  document.querySelector("#record-type-all").click();

  // 2. Decision status. Only a decision has one, so choosing a status hides
  //    every release — the asymmetric case, reached without touching the
  //    record type control at all.
  const status = document.querySelector("#filter-status");
  status.value = DECISION.status;
  status.dispatchEvent(new DomEvent("change", { bubbles: true }));
  assert.deepEqual(rowTitles(page), [DECISION.title], "filtered history (status: accepted): the wrong rows survived");
  assertSurvivingLink(rowFor(page, DECISION.title), {
    href: releaseHref(release.id),
    label: RELEASE.version,
    from: "decision",
    filter: "status: accepted",
  });
  clickButton(page, "Clear filters");

  // 3. Owner. The two records were recorded by different people, so this hides
  //    one side without naming a record type or a status.
  const owner = document.querySelector("#filter-owner");
  owner.value = RELEASE.owner;
  owner.dispatchEvent(new DomEvent("change", { bubbles: true }));
  assert.deepEqual(rowTitles(page), [RELEASE_ROW_TITLE], "filtered history (owner: Priya): the wrong rows survived");
  assertSurvivingLink(rowFor(page, RELEASE_ROW_TITLE), {
    href: decisionHref(decision.id),
    label: DECISION.title,
    from: "release",
    filter: "owner: Priya",
  });
  clickButton(page, "Clear filters");

  // 4. Search, typed a character at a time. The version is what a release
  //    manager types, and it matches the release only.
  const search = document.querySelector("#decision-search");
  search.focus();
  typeText(document, RELEASE.version);
  assert.deepEqual(rowTitles(page), [RELEASE_ROW_TITLE], "filtered history (search: v2.1.0): the wrong rows survived");
  assertSurvivingLink(rowFor(page, RELEASE_ROW_TITLE), {
    href: decisionHref(decision.id),
    label: DECISION.title,
    from: "release",
    filter: "search: v2.1.0",
  });

  // Clearing every filter restores both rows and unmarks both links: the note
  // is a fact about the view, and it goes when the view does.
  clickButton(page, "Clear filters");
  assert.equal(historyCount(page), "2 records", "filtered history: clearing the filters did not restore the history");
  assert.equal(linksInList(page).length, 2, "filtered history: clearing the filters did not restore both links");
  assert.equal(
    historyList(page).querySelectorAll(".record-link-hidden").length,
    0,
    "filtered history: a link is still marked as out of view after the filters were cleared",
  );
});

test("the JSON export carries the same decision-release identifier the history list showed", async (t) => {
  const { page, decision, release } = await shipTheDecision(t);

  // The identifiers as the history list states them, read through the same
  // check Test 1 makes so a list that has already lost the link fails here
  // naming the list rather than throwing on a missing node. Everything below is
  // compared against these rather than against the stored records, so the file
  // and the list disagreeing is a failure even when both are self-consistent.
  const shownReleaseId = idInHref(assertLink(rowFor(page, DECISION.title), {
    href: releaseHref(release.id),
    label: RELEASE.version,
    surface: "history list",
    from: "decision",
  }).getAttribute("href"));
  const shownDecisionId = idInHref(assertLink(rowFor(page, RELEASE_ROW_TITLE), {
    href: decisionHref(decision.id),
    label: DECISION.title,
    surface: "history list",
    from: "release",
  }).getAttribute("href"));

  page.document.querySelector("#export-shiplog").click();
  assert.equal(page.downloads.length, 1, "JSON export: the export button produced no download");
  const payload = JSON.parse(page.downloads[0].text);
  assert.equal(payload.schema, "shiplog-history", "JSON export: the export schema name changed");
  assert.equal(payload.record_count, 2, "JSON export: the file does not carry both records");

  const exportedDecisions = payload.decisions.filter((candidate) => candidate.id === shownDecisionId);
  assert.equal(exportedDecisions.length, 1, "JSON export: the decision the history list showed is not in the file");
  assert.equal(exportedDecisions[0].title, DECISION.title, "JSON export: the exported decision is not the one that was recorded");

  const exportedReleases = payload.releases.filter((candidate) => candidate.id === shownReleaseId);
  assert.equal(exportedReleases.length, 1, "JSON export: the release the history list showed is not in the file");
  assert.equal(exportedReleases[0].version, RELEASE.version, "JSON export: the exported release is not the one that was recorded");

  // The identifier itself, on the release record and again in the file's own
  // join collection. Both are the id the history list rendered.
  assert.deepEqual(
    exportedReleases[0].decisionIds,
    [shownDecisionId],
    "JSON export: the exported release no longer names the decision the history list linked it to",
  );
  assert.deepEqual(
    payload.associations,
    [{ decisionId: shownDecisionId, releaseId: shownReleaseId, position: 0 }],
    "JSON export: the decision-to-release join the history list showed is missing from the file",
  );
  assert.equal(
    payload.decisions.filter((candidate) => candidate.id === exportedReleases[0].decisionIds[0]).length,
    1,
    "JSON export: the exported release points at a decision that is not in the same file",
  );
});
