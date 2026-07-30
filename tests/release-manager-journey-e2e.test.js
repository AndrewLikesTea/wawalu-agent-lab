// End-to-end regression for the release manager's journey across the shipped
// pages: record the decision, ship it in a release, follow the association back
// to the decision, filter the history it produced, and export it.
//
// One browser, four pages. Storage is carried from page to page the way a
// browser carries localStorage across a navigation, so every step starts from
// what the previous step actually left behind — no fixture stands in for a
// page's output, and a break at any seam (the decision the recorder wrote is
// not offered by the release picker, the id the release stored is not the id
// the export writes) fails here rather than in production.
//
// Every assertion is on what a user can see or on what the browser is left
// holding: the rendered rows, the announcement, the link a keypress follows,
// the visible count, and the file the export button hands back. No internal
// helper is called to produce an assertion.
//
// Determinism: no network (the harness throws on an undeclared request), no
// clock thresholds, no sleeps. Each test starts from an empty browser and hands
// every page an empty example seed, so nothing leaks between tests and order
// never matters. Generated ids and timestamps are asserted by shape.

import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { initReleaseDetail } from "../src/release-page.js";
import { initDecisionDetail } from "../src/decision-page.js";
import { initShiplogExport } from "../src/shiplog-export.js";
import { loadReleaseData } from "../src/releases-data.js";
import {
  DomEvent,
  loadPage,
  pressEnter,
  pressKey,
  pressSpace,
  pressTab,
  tabSequence,
  textOf,
  typeText,
} from "./support/browser.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const RELEASE_DETAIL_PAGE = new URL("../src/release.html", import.meta.url);
const DECISION_DETAIL_PAGE = new URL("../src/decision.html", import.meta.url);

// The example records are module constants the pages compose in, not a fetch,
// so a journey that wants a log containing nothing but its own work hands every
// page an empty seed. tests/demo-path.test.js is the one that exercises the
// real seed.
const NO_DEMO_DATA = { decisions: [], releases: [] };
const EMPTY_BROWSER = { [STORAGE_KEY]: "[]", [RELEASE_STORAGE_KEY]: "[]" };

// What the manager types. The decision's owner and the release's owner differ
// on purpose: the history's owner filter has to tell the two records apart.
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

// The two keys a Shiplog browser holds, carried forward exactly as they are so
// the next page reads what the last page wrote and nothing else.
function browserState(page) {
  return Object.fromEntries([STORAGE_KEY, RELEASE_STORAGE_KEY]
    .map((key) => [key, page.storage.getItem(key)])
    .filter(([, value]) => value !== null));
}

// Tab forward until the wanted control has focus. Failing here is the point:
// it means the control cannot be reached with the keyboard.
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

// Reach a field with Tab and type into it, the way the manager fills a form.
function tabAndType(page, selector, value, label) {
  tabTo(page, selector, label);
  typeText(page.document, value);
}

// --- the pages -------------------------------------------------------------

async function openDecisions(t, storage = EMPTY_BROWSER) {
  const page = await loadPage(DECISIONS_PAGE, { storage });
  t.after(() => page.restore());
  // The module scripts src/index.html loads, in page order.
  await initDecisionLog(page.document, page.storage, { seed: NO_DEMO_DATA });
  initShiplogExport(page.document, page.storage);
  // Wait on state, not on time: the page marks itself ready once it rendered.
  assert.equal(page.document.documentElement.dataset.shiplog, "ready", "the history never finished rendering");
  return page;
}

async function openReleases(t, storage = EMPTY_BROWSER) {
  const page = await loadPage(RELEASES_PAGE, { storage });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, { seed: NO_DEMO_DATA });
  assert.equal(page.document.documentElement.dataset.shiplogReleases, "ready", "the releases page never finished rendering");
  return page;
}

async function openReleaseDetail(t, storage, id) {
  const page = await loadPage(RELEASE_DETAIL_PAGE, { storage, location: { search: `?id=${id}` } });
  t.after(() => page.restore());
  initReleaseDetail();
  assert.equal(page.document.documentElement.dataset.shiplogReleaseDetail, "ready", "the release detail never finished rendering");
  return page;
}

async function openDecisionDetail(t, storage, id) {
  const page = await loadPage(DECISION_DETAIL_PAGE, { storage, location: { search: `?id=${id}` } });
  t.after(() => page.restore());
  // The same empty seed the other pages get, so the linked releases on this
  // page are the manager's own and nothing else.
  await initDecisionDetail({
    loadData: (storage_) => loadReleaseData(storage_, NO_DEMO_DATA),
    detailSeeds: [],
  });
  assert.equal(page.document.documentElement.dataset.shiplogDecisionDetail, "ready", "the decision detail never finished rendering");
  return page;
}

// --- the steps -------------------------------------------------------------

const decisionRows = (page) => page.document.querySelector("#decision-list").querySelectorAll(".history-card");
const decisionRowTitles = (page) => decisionRows(page).map((card) => textOf(card.querySelector("h3")));
const historyCount = (page) => textOf(page.document.querySelector("#decision-count"));

// Record the decision with the keyboard alone, then hand back what the browser
// is holding. Storage is read rather than the form, because the id the rest of
// the journey follows is the one that was persisted.
async function recordDecision(t, storage = EMPTY_BROWSER) {
  const page = await openDecisions(t, storage);
  const { document } = page;

  tabAndType(page, "#title", DECISION.title, "the decision title field");
  tabAndType(page, "#context", DECISION.context, "the decision context field");
  tabAndType(page, "#alternatives", DECISION.alternatives, "the decision alternatives field");
  tabAndType(page, "#owner", DECISION.owner, "the decision owner field");
  tabTo(page, "#status", "the decision status control");
  pressKey(document, "ArrowDown"); // pending -> accepted
  assert.equal(document.activeElement.value, DECISION.status, "the status control cannot be set with the arrow keys");
  const submit = document.querySelector("#decision-form").querySelector('button[type="submit"]');
  tabTo(page, submit, "the record-decision button");
  pressEnter(document);

  const stored = JSON.parse(page.storage.getItem(STORAGE_KEY) ?? "[]");
  assert.equal(stored.length, 1, "the decision recorded with the keyboard was not saved in this browser");
  return { page, decision: stored[0] };
}

const pickerLabels = (page) => page.document.querySelectorAll(".decision-picker-label").map(textOf);

function pickerOptionFor(page, title) {
  const label = page.document.querySelectorAll(".decision-picker-label")
    .find((candidate) => textOf(candidate) === title);
  assert.ok(label, `no linkable decision is titled "${title}"`);
  const input = page.document.getElementById(label.getAttribute("for"));
  assert.ok(input, `the option for "${title}" has no control`);
  return input;
}

const submitReleaseButton = (page) => page.document.querySelectorAll("button")
  .find((button) => textOf(button) === "Record release");

// Record the release with the keyboard alone, linking the decision by title —
// the way the manager finds it — rather than by an id the page never shows.
async function recordRelease(t, storage, { linkTitle }) {
  const page = await openReleases(t, storage);

  tabAndType(page, "#release-version", RELEASE.version, "the release version field");
  tabAndType(page, "#release-released-on", RELEASE.releasedOn, "the release date field");
  tabAndType(page, "#release-owner", RELEASE.owner, "the release owner field");
  tabAndType(page, "#release-title", RELEASE.title, "the release title field");
  tabAndType(page, "#release-description", RELEASE.description, "the release description field");

  const option = pickerOptionFor(page, linkTitle);
  tabTo(page, option, `the "${linkTitle}" link option`);
  pressSpace(page.document);
  assert.equal(option.checked, true, "Space did not link the decision in focus");

  tabTo(page, submitReleaseButton(page), "the record-release button");
  pressEnter(page.document);

  const stored = JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY) ?? "[]");
  assert.equal(stored.length, 1, "the release recorded with the keyboard was not saved in this browser");
  return { page, release: stored[0] };
}

// Steps one and two, as one call, for the tests that are about what comes
// after them. Each returns the browser the two steps left behind.
async function shipTheDecision(t) {
  const recorder = await recordDecision(t);
  const decision = recorder.decision;
  const afterDecision = browserState(recorder.page);
  recorder.page.restore();

  const releaseStep = await recordRelease(t, afterDecision, { linkTitle: DECISION.title });
  const state = browserState(releaseStep.page);
  return { decision, release: releaseStep.release, releasesPage: releaseStep.page, state };
}

// --- the journey -----------------------------------------------------------

test("a release manager records a decision, ships it, and reaches it again from the release", async (t) => {
  // 1. The decision, with the context, alternatives, owner, and status
  //    PRODUCT.md promises, recorded from the keyboard.
  const { page: decisionsPage, decision } = await recordDecision(t);
  assert.equal(decision.title, DECISION.title);
  assert.equal(decision.context, DECISION.context, "the recorded decision lost its context");
  assert.equal(decision.alternatives, DECISION.alternatives, "the recorded decision lost its alternatives");
  assert.equal(decision.owner, DECISION.owner, "the recorded decision lost its owner");
  assert.equal(decision.status, DECISION.status, "the recorded decision lost its status");
  assert.ok(typeof decision.id === "string" && decision.id.trim() !== "", "the recorded decision has no id");
  assert.deepEqual(decisionRowTitles(decisionsPage), [DECISION.title], "the recorded decision is not in the history");

  const afterDecision = browserState(decisionsPage);
  decisionsPage.restore();

  // 2. The release, on the next page, linked to that decision. The picker
  //    offering it at all is the cross-page seam: a decision recorded on the
  //    decisions page has to be linkable on the releases page.
  const releasesPage = await openReleases(t, afterDecision);
  assert.deepEqual(
    pickerLabels(releasesPage),
    [DECISION.title],
    "the decision recorded a moment ago is not offered to link to a release",
  );
  releasesPage.restore();

  const { page: recorder, release } = await recordRelease(t, afterDecision, { linkTitle: DECISION.title });
  assert.equal(release.version, RELEASE.version);
  assert.equal(release.owner, RELEASE.owner, "the recorded release lost its owner");
  assert.equal(release.description, RELEASE.description, "the recorded release lost its description");
  assert.deepEqual(
    release.decisionIds,
    [decision.id],
    "the release was not associated with the decision the manager linked",
  );
  assert.equal(
    textOf(recorder.document.querySelector("#release-record-status")),
    `Recorded ${RELEASE.version} with 1 linked decision.`,
    "recording the release was not announced",
  );

  // 3. The row for the release the manager just recorded states the link, and
  //    the linked decision is reachable from it with the keyboard: expand the
  //    row, then follow the decision it names.
  const toggle = tabTo(recorder, ".release-toggle", "the new release's row");
  assert.match(textOf(toggle), new RegExp(RELEASE.title), "the new release is not at the top of the list");
  assert.match(textOf(toggle), /1 decision · 1 accepted/, "the row does not summarise the decision it carried");
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "the row starts expanded");
  // Space, not Enter: this row's Enter is bound to "open the detail view"
  // instead of to the expansion the button announces. See the two tests at the
  // bottom of this file.
  pressSpace(recorder.document);
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "Space did not expand the release row");

  const decisionLink = tabTo(recorder, ".release-decision-link", "the linked decision inside the release row");
  assert.equal(textOf(decisionLink), DECISION.title, "the release row does not name the decision it carried");
  pressEnter(recorder.document);
  assert.deepEqual(
    recorder.navigations,
    [`/decision.html?id=${decision.id}`],
    "the linked decision could not be opened from the release row",
  );

  // 4. The same association from the release's own page, which is where a
  //    manager who arrived by a shared link starts.
  const detailLink = tabTo(recorder, ".release-detail-link", "the release's detail link");
  assert.equal(detailLink.getAttribute("href"), `/release.html?id=${release.id}`);
  const state = browserState(recorder);
  recorder.restore();

  const detail = await openReleaseDetail(t, state, release.id);
  const linked = detail.document.querySelectorAll(".detail-decision");
  assert.equal(linked.length, 1, "the release's own page does not list the decision it carried");
  assert.equal(textOf(linked[0].querySelector(".detail-decision-title")), DECISION.title);
  assert.match(textOf(detail.document.querySelector(".detail-summary")), /1 decision · 1 accepted/);
  tabTo(detail, ".detail-decision", "the linked decision on the release detail page");
  pressEnter(detail.document);
  assert.deepEqual(
    detail.navigations,
    [`/decision.html?id=${decision.id}`],
    "the linked decision could not be opened from the release detail page",
  );
  detail.restore();

  // 5. And the loop closes: the decision the manager landed on names the
  //    release that shipped it, so the association reads in both directions.
  const decisionDetail = await openDecisionDetail(t, state, decision.id);
  const back = decisionDetail.document.querySelector(".linked-release-link");
  assert.ok(back, "the decision does not name the release that shipped it");
  assert.match(textOf(back), new RegExp(RELEASE.version.replace(".", "\\.")), "the linked release is not named by version");
  tabTo(decisionDetail, ".linked-release-link", "the linked release on the decision page");
  pressEnter(decisionDetail.document);
  assert.deepEqual(
    decisionDetail.navigations,
    [`/release.html?id=${release.id}`],
    "the release could not be reopened from the decision it shipped",
  );
});

test("the history the journey produced narrows to the release and back", async (t) => {
  const { release, releasesPage, state } = await shipTheDecision(t);
  releasesPage.restore();

  const page = await openDecisions(t, state);
  assert.equal(historyCount(page), "2 records", "the history does not hold both the decision and the release");

  // Record type: the two halves of the log, one at a time.
  page.document.querySelector("#record-type-release").click();
  assert.deepEqual(decisionRowTitles(page), [RELEASE_ROW_TITLE], "the Releases filter did not hide the decision");
  assert.equal(historyCount(page), "1 of 2 records", "the filtered count is wrong for Releases");

  page.document.querySelector("#record-type-decision").click();
  assert.deepEqual(decisionRowTitles(page), [DECISION.title], "the Decisions filter did not hide the release");

  // The filtered decision row still states the release that shipped it: a
  // filter hides rows, it does not rewrite what a record is linked to.
  const relationship = page.document.querySelector("#decision-list").querySelector(".record-links");
  assert.ok(relationship, "the filtered decision row states no relationship");
  assert.match(textOf(relationship), /v2\.1\.0/, "the row no longer names the release that shipped it");
  const link = tabTo(page, ".record-link", "the release link on the filtered decision row");
  assert.equal(link.getAttribute("href"), `/release.html?id=${release.id}`);
  pressEnter(page.document);
  assert.deepEqual(page.navigations, [`/release.html?id=${release.id}`], "the linked release could not be opened from the history");

  page.document.querySelector("#record-type-all").click();
  assert.equal(historyCount(page), "2 records", "clearing the record type filter did not restore the history");

  // Search: the version is what a release manager types, and it finds the
  // release without needing the record-type filter first.
  const search = page.document.querySelector("#decision-search");
  search.focus();
  typeText(page.document, RELEASE.version);
  assert.deepEqual(decisionRowTitles(page), [RELEASE_ROW_TITLE], "searching the version did not find the release");
  page.document.querySelector("#clear-decision-filters").click();

  // Owner: the release's owner is not the decision's owner, so each name
  // selects exactly one record.
  const owner = page.document.querySelector("#filter-owner");
  owner.value = RELEASE.owner;
  owner.dispatchEvent(new DomEvent("change", { bubbles: true }));
  assert.deepEqual(decisionRowTitles(page), [RELEASE_ROW_TITLE], "the owner filter did not select the release by its owner");

  owner.value = DECISION.owner;
  owner.dispatchEvent(new DomEvent("change", { bubbles: true }));
  assert.deepEqual(decisionRowTitles(page), [DECISION.title], "the owner filter did not select the decision by its owner");
});

test("the journey exports as one JSON file carrying the decision, the release, and the link", async (t) => {
  const { decision, release, releasesPage, state } = await shipTheDecision(t);
  releasesPage.restore();

  const page = await openDecisions(t, state);
  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-counts")),
    "Ready to export 1 decision and 1 release stored in this browser.",
    "the export panel miscounts what the journey recorded",
  );

  tabTo(page, "#export-shiplog", "the export button");
  pressEnter(page.document);
  assert.equal(page.downloads.length, 1, "the export button produced no download");

  const [download] = page.downloads;
  assert.match(download.filename, /^shiplog-history-\d{4}-\d{2}-\d{2}\.json$/, "the exported filename shape changed");
  const payload = JSON.parse(download.text);
  assert.equal(payload.schema, "shiplog-history", "the export schema name changed");

  const exportedDecision = payload.decisions.find((candidate) => candidate.id === decision.id);
  assert.ok(exportedDecision, "the decision the manager recorded is missing from the export");
  assert.equal(exportedDecision.title, DECISION.title);
  assert.equal(exportedDecision.context, DECISION.context, "the exported decision lost its context");
  assert.equal(exportedDecision.alternatives, DECISION.alternatives, "the exported decision lost its alternatives");
  assert.equal(exportedDecision.owner, DECISION.owner, "the exported decision lost its owner");
  assert.equal(exportedDecision.status, DECISION.status, "the exported decision lost its status");

  const exportedRelease = payload.releases.find((candidate) => candidate.id === release.id);
  assert.ok(exportedRelease, "the release the manager recorded is missing from the export");
  assert.equal(exportedRelease.version, RELEASE.version);
  assert.equal(exportedRelease.owner, RELEASE.owner, "the exported release lost its owner");
  assert.equal(exportedRelease.createdAt, "2026-07-02T00:00:00.000Z", "the exported release is not dated by the day it shipped");
  assert.deepEqual(
    exportedRelease.decisionIds,
    [decision.id],
    "the decision-release association did not survive the export",
  );
  assert.ok(
    payload.decisions.some((candidate) => candidate.id === exportedRelease.decisionIds[0]),
    "the exported release points at a decision that is not in the same file",
  );
  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-status")),
    "Shiplog history exported.",
    "the export confirmation copy changed",
  );
});

test("a reload between the steps loses nothing the manager recorded", async (t) => {
  // Reload after the decision: the picker on a freshly loaded releases page
  // still offers it, because it came from storage and not from page state.
  const recorder = await recordDecision(t);
  const afterDecision = browserState(recorder.page);
  recorder.page.restore();

  const firstVisit = await openReleases(t, afterDecision);
  assert.deepEqual(pickerLabels(firstVisit), [DECISION.title]);
  firstVisit.restore();

  // Reload after the release: the row, its link, and the history all come back
  // from the same browser storage on a page that was never told about them.
  const { page: releasesPage, release } = await recordRelease(t, afterDecision, { linkTitle: DECISION.title });
  const state = browserState(releasesPage);
  releasesPage.restore();

  const reloaded = await openReleases(t, state);
  const rows = reloaded.document.querySelectorAll(".release-toggle");
  assert.equal(rows.length, 1, "the recorded release did not survive a reload");
  assert.match(textOf(rows[0]), /1 decision · 1 accepted/, "the association did not survive a reload");
  assert.equal(textOf(reloaded.document.querySelector("#release-count")), "1 of 1 release");
  reloaded.restore();

  const history = await openDecisions(t, state);
  assert.equal(historyCount(history), "2 records", "the reloaded history lost a record");
  assert.deepEqual(
    decisionRowTitles(history).toSorted(),
    [DECISION.title, RELEASE_ROW_TITLE].toSorted(),
    "the reloaded history shows the wrong records",
  );
  assert.equal(
    JSON.parse(history.storage.getItem(RELEASE_STORAGE_KEY))[0].id,
    release.id,
    "the reloaded release is not the one that was recorded",
  );
});

// --------------------------------------------------------------------------
// Found while walking the journey with the keyboard: the release row's
// disclosure button answers Enter and Space with two different actions.
//
// User impact: the row is a <button> carrying aria-expanded="false", so a
// keyboard or screen reader user is told it is a collapsed disclosure. Space
// expands it as announced; Enter leaves the page for the release detail view
// instead. A release manager tabbing the list to skim what each release
// carried is navigated away from the list on the first Enter, and the row
// state they were told about never changes. Enter and Space on the same button
// are meant to do the same thing (ARIA's disclosure pattern), and every other
// row in this product — the history rows on the decisions page — opens on
// Enter without also claiming to expand.
//
// The behaviour is deliberate (src/releases.js: handleReleaseListKeydown) and
// unit-tested, so it is reported here rather than patched: the fix is a product
// decision — either the row stops announcing itself as a disclosure, or Enter
// toggles it like Space does and the detail link stays the way out.
// --------------------------------------------------------------------------

test("the release row expands on Space, and the detail link inside it is what leaves the page", async (t) => {
  const { releasesPage } = await shipTheDecision(t);

  const toggle = tabTo(releasesPage, ".release-toggle", "the release row");
  pressSpace(releasesPage.document);
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "Space did not expand the release row");
  assert.deepEqual(releasesPage.navigations, [], "expanding a row navigated away from the list");

  pressSpace(releasesPage.document);
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "Space did not collapse the release row again");
});

test("the release row expands when its button is activated with Enter", { todo: true }, async (t) => {
  const { releasesPage } = await shipTheDecision(t);

  const toggle = tabTo(releasesPage, ".release-toggle", "the release row");
  pressEnter(releasesPage.document);

  assert.equal(
    toggle.getAttribute("aria-expanded"),
    "true",
    "Enter on a button announced as a collapsed disclosure did not expand it",
  );
  assert.deepEqual(
    releasesPage.navigations,
    [],
    "Enter on the disclosure button left the list instead of expanding the row",
  );
});

test("pressing record twice on the release form records the release once", async (t) => {
  const recorder = await recordDecision(t);
  const afterDecision = browserState(recorder.page);
  recorder.page.restore();

  const { page, release } = await recordRelease(t, afterDecision, { linkTitle: DECISION.title });
  // The double press: the manager who did not see the announcement and hit the
  // button again. The form is empty and nothing is linked, so the second press
  // must not write a second release — a duplicated release is a duplicated
  // association, and the export would then claim the decision shipped twice.
  submitReleaseButton(page).click();

  const stored = JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY) ?? "[]");
  assert.deepEqual(
    stored.map((candidate) => candidate.id),
    [release.id],
    "pressing record a second time wrote a duplicate release",
  );
  assert.equal(
    page.document.querySelectorAll(".release-toggle").length,
    1,
    "the release list shows a release that was recorded twice",
  );
});
