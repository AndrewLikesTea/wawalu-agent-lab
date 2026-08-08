// End-to-end regression for one claim: every word a person types into Shiplog
// comes back out of the export file unchanged, and the filter they were looking
// through is the one the file was written against.
//
// tests/decision-release-link-e2e.test.js already pins the *identifier* that
// joins a decision to its release across the three surfaces. This file pins the
// other half — the payload. A link that survives while the context, the
// alternatives, or the status quietly changes on the way out is an export a
// release manager cannot audit, and nothing that asserts only on ids would see
// it. So every assertion here compares three states of the same field: what was
// typed, what the browser stored, and what the downloaded file carries.
//
// Everything is driven from the keyboard. PRODUCT.md names accessible keyboard
// navigation as non-negotiable, and the whole chain — record, link, filter,
// export — is walked with Tab, the arrow keys, Space, and Enter, on the controls
// the pages actually ship. A field a keyboard user cannot reach in order, or a
// submit that only answers a pointer, fails here rather than in somebody's
// browser. The tab walks stay inside the controls of this flow; whole-page tab
// order belongs to the audits that already own it.
//
// The second decision is what makes the filter assertion mean anything. It is
// recorded by a different owner, so the owner filter must keep one record and
// drop the other: a filter that silently returned everything would pass a suite
// that only checked the matching row is present.
//
// Nothing is poked into storage. Both decisions are typed into the decisions
// page and the release into the releases page, with browser storage carried
// between them the way a browser carries localStorage across a navigation, so
// the values these tests follow are the values the shipped recorders wrote.
//
// Failure messages name the broken link in the chain — "alternatives lost in
// export", "release recorded but not associated with decision" — because the
// first question after a red run is which hop dropped the field, not which line
// number compared unequal.
//
// Determinism: no network (the harness throws on an undeclared request), no
// clock thresholds, no sleeps. Each test starts from an empty browser and hands
// every page an empty example seed, so nothing leaks between tests and order
// never matters. Generated ids and timestamps are read back from storage, never
// predicted.

import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { initShiplogExport } from "../src/shiplog-export.js";
import { shiplogExportViolations } from "../src/shiplog-export-schema.js";
import { loadPage, pressEnter, pressKey, pressSpace, pressTab, textOf, typeText } from "./support/browser.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);

// The example records are module constants the pages compose in, not a fetch,
// so a log containing nothing but the work these tests do is asked for with an
// empty seed. tests/demo-path.test.js is the one that exercises the real seed.
const NO_DEMO_DATA = { decisions: [], releases: [] };
const EMPTY_BROWSER = { [STORAGE_KEY]: "[]", [RELEASE_STORAGE_KEY]: "[]" };

// The decision that shipped. Two alternatives are named in the one field the
// form offers, because "what else was considered" is the part of a decision
// record that a lossy export destroys most quietly: the title and the owner are
// obviously wrong when they go missing, a dropped second option is not.
const SHIPPED = {
  title: "Move image resizing to a worker",
  context: "Uploads over 8 MB blocked the request thread and timed out for mobile users on hotel wifi.",
  alternatives: "Resize in the browser before upload, which loses the original; and cap uploads at 4 MB, which rejects real photos.",
  owner: "Ada Vance",
  status: "accepted",
};

// Recorded by somebody else, so the owner filter has one record to keep and one
// to drop. Nothing links it to the release.
const UNSHIPPED = {
  title: "Retire the legacy thumbnail cache",
  context: "The cache predates the CDN and nobody has measured whether it still earns its keep.",
  alternatives: "Leave it in place; or measure first and decide next quarter.",
  owner: "Bo Ellis",
  status: "pending",
};

// The release carries the same owner as the decision it shipped, which is what
// lets one owner filter select both sides of the association at once.
const RELEASE = {
  version: "v3.4.0",
  title: "Off-thread image resizing",
  description: "Resizing moved to a background worker; uploads return as soon as the original is stored.",
  owner: SHIPPED.owner,
  status: "completed",
  releasedOn: "2026-07-14",
};

const RELEASE_ROW_TITLE = `${RELEASE.version} · ${RELEASE.title}`;

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

// --- keyboard ---------------------------------------------------------------

// Tab once and say where it landed. The id is asserted rather than the element,
// so a form that reorders its fields — or drops one out of the sequence — is
// reported as the stop it skipped.
function tabTo(page, id, what) {
  const landed = pressTab(page.document);
  assert.equal(landed?.id, id, `${what}: Tab does not reach the ${id} control in form order, so a keyboard user cannot fill this form`);
  return landed;
}

// Choose a value in the focused select with the arrow keys, the way somebody
// who never touches the mouse chooses it. This harness would accept an
// assignment of any value, including one the control does not list, so the
// option has to be arrived at rather than set.
function chooseByArrowKeys(page, value, what) {
  const control = page.document.activeElement;
  assert.ok(control, `${what}: nothing is focused, so the value cannot be chosen from the keyboard`);
  for (let step = 0; step < control.options.length && control.value !== value; step += 1) {
    pressKey(page.document, "ArrowDown");
  }
  assert.equal(control.value, value, `${what}: the arrow keys never reach “${value}”, so a keyboard user cannot record it`);
  return control;
}

// Tab forward until the wanted control has focus. Bounded by the number of stops
// this flow could plausibly cross, so an unreachable control fails with the
// sentence below instead of spinning.
function tabUntil(page, wanted, message, limit = 12) {
  for (let step = 0; step < limit && page.document.activeElement !== wanted; step += 1) {
    pressTab(page.document);
  }
  assert.equal(page.document.activeElement === wanted, true, message);
  return wanted;
}

// The submit button of the form being filled, reached by Tab and pressed with
// Enter — the two halves of "this form can be completed without a pointer".
function submitByKeyboard(page, label, message) {
  const button = page.document.querySelectorAll("button").find((candidate) => textOf(candidate) === label);
  assert.ok(button, `no button on this page is labelled “${label}”`);
  tabUntil(page, button, message);
  pressEnter(page.document);
}

// --- the record path -------------------------------------------------------

// Type one decision into the shipped recorder, entirely from the keyboard: the
// first field is focused, every field after it is reached with Tab, the status
// is chosen with the arrow keys, and the save is an Enter press on the submit
// button the same Tab sequence reaches.
function recordDecisionByKeyboard(page, decision) {
  const what = "record decision";
  const title = page.document.querySelector("#title");
  assert.ok(title, "the decision recorder has no #title field");
  title.focus();
  typeText(page.document, decision.title);

  for (const field of ["context", "alternatives", "owner"]) {
    tabTo(page, field, what);
    typeText(page.document, decision[field]);
  }

  tabTo(page, "status", what);
  chooseByArrowKeys(page, decision.status, "record decision: status");
  // Past the supersede control, which this flow leaves alone. It is a stop on
  // the way to the button, so a keyboard user crosses it and so does this test.
  tabTo(page, "supersedes", what);
  submitByKeyboard(page, "Record decision", "record-decision submit is not reachable by keyboard");
}

// Both decisions, typed one after the other into the same page the way a person
// records two calls in one sitting. Returns what the browser is left holding:
// the ids and timestamps the rest of the chain follows are the persisted ones.
async function recordBothDecisions(t) {
  const page = await openHistory(t);
  recordDecisionByKeyboard(page, SHIPPED);
  recordDecisionByKeyboard(page, UNSHIPPED);

  const decisions = JSON.parse(page.storage.getItem(STORAGE_KEY) ?? "[]");
  assert.equal(decisions.length, 2, "the two recorded decisions were not both saved in this browser");
  const shipped = decisions.find((record) => record.title === SHIPPED.title);
  const unshipped = decisions.find((record) => record.title === UNSHIPPED.title);
  assert.ok(shipped, "the decision that shipped was not saved under the title it was recorded with");
  assert.ok(unshipped, "the second decision was not saved under the title it was recorded with");
  return { page, shipped, unshipped };
}

// Record the release, linking it to the decision that shipped by ticking that
// decision's own checkbox with Space — found by the title on its label, which
// is how a user finds it, and reached by Tab from the last text field.
async function recordReleaseByKeyboard(t, storage) {
  const page = await openReleases(t, storage);
  const what = "record release";
  const version = page.document.querySelector("#release-version");
  assert.ok(version, "the release recorder has no #release-version field");
  version.focus();
  typeText(page.document, RELEASE.version);

  tabTo(page, "release-released-on", what);
  typeText(page.document, RELEASE.releasedOn);
  tabTo(page, "release-owner", what);
  typeText(page.document, RELEASE.owner);
  tabTo(page, "release-title", what);
  typeText(page.document, RELEASE.title);
  tabTo(page, "release-form-status", what);
  chooseByArrowKeys(page, RELEASE.status, "record release: status");
  tabTo(page, "release-description", what);
  typeText(page.document, RELEASE.description);

  const label = page.document.querySelectorAll(".decision-picker-label")
    .find((candidate) => textOf(candidate) === SHIPPED.title);
  assert.ok(label, `the release recorder offers no decision titled “${SHIPPED.title}”`);
  const option = page.document.getElementById(label.getAttribute("for"));
  assert.ok(option, `the option for “${SHIPPED.title}” has no control`);
  tabUntil(page, option, "the decision this release shipped cannot be reached by keyboard in the release recorder");
  pressSpace(page.document);
  assert.equal(
    option.checked,
    true,
    "Space does not link the decision in focus, so a keyboard user cannot associate a release with a decision",
  );

  submitByKeyboard(page, "Record release", "record-release submit is not reachable by keyboard");

  const releases = JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY) ?? "[]");
  assert.equal(releases.length, 1, "the recorded release was not saved in this browser");
  return { page, release: releases[0] };
}

// The whole chain up to the point a filter is applied: two decisions and the
// release that shipped one of them, all typed, ending on a fresh history page
// that holds exactly what the two recorders wrote.
async function shipTheDecision(t) {
  const recorder = await recordBothDecisions(t);
  const { shipped, unshipped } = recorder;
  const afterDecisions = browserState(recorder.page);
  recorder.page.restore();

  const shipper = await recordReleaseByKeyboard(t, afterDecisions);
  const { release } = shipper;
  const afterRelease = browserState(shipper.page);
  shipper.page.restore();

  assert.deepEqual(
    release.decisionIds,
    [shipped.id],
    "release recorded but not associated with decision",
  );
  return { page: await openHistory(t, afterRelease), shipped, unshipped, release };
}

// --- the history surface ---------------------------------------------------

const historyList = (page) => page.document.querySelector("#decision-list");
const historyCards = (page) => historyList(page).querySelectorAll(".history-card");
const rowTitles = (page) => historyCards(page).map((card) => textOf(card.querySelector("h3")));
const historyCount = (page) => textOf(page.document.querySelector("#decision-count"));

// Narrow the history to one owner, from the keyboard. The owner options are
// built from the visitor's own records, so arriving at the value with the arrow
// keys also asserts the log offers the person who recorded the decision.
function filterByOwner(page, owner) {
  const control = page.document.querySelector("#filter-owner");
  assert.ok(control, "the history has no owner filter");
  control.focus();
  chooseByArrowKeys(page, owner, `history filter: owner “${owner}”`);
  return control;
}

// --- the tests -------------------------------------------------------------

test("a decision, a release, and the link between them are all recordable from the keyboard alone", async (t) => {
  const { shipped, unshipped, release } = await shipTheDecision(t);

  // What the recorders stored, field by field against what was typed. This is
  // the first hop of the chain: a field mangled here is never in the file.
  assert.equal(shipped.title, SHIPPED.title, "title changed value between recording and storage");
  assert.equal(shipped.context, SHIPPED.context, "context changed value between recording and storage");
  assert.equal(shipped.alternatives, SHIPPED.alternatives, "alternatives changed value between recording and storage");
  assert.equal(shipped.owner, SHIPPED.owner, "owner changed value between recording and storage");
  assert.equal(shipped.status, SHIPPED.status, "status changed value between recording and storage");
  assert.equal(typeof shipped.id, "string", "the recorded decision was stored without an id to link a release to");

  assert.equal(release.version, RELEASE.version, "release version changed value between recording and storage");
  assert.equal(release.title, RELEASE.title, "release title changed value between recording and storage");
  assert.equal(release.description, RELEASE.description, "release description changed value between recording and storage");
  assert.equal(release.owner, RELEASE.owner, "release owner changed value between recording and storage");
  assert.equal(release.status, RELEASE.status, "release status changed value between recording and storage");
  assert.equal(
    release.createdAt.slice(0, 10),
    RELEASE.releasedOn,
    "the release ships under a different date than the one that was recorded",
  );

  // The second decision was recorded through the same keyboard path and is not
  // linked to anything, which is what makes it usable as the filter's negative.
  assert.equal(unshipped.owner, UNSHIPPED.owner, "the second decision was stored under the wrong owner");
  assert.equal(
    release.decisionIds.includes(unshipped.id),
    false,
    "the release is associated with a decision the user never ticked",
  );
});

test("the owner filter keeps the decision that matches it and drops the one that does not", async (t) => {
  const page = await shipTheDecision(t).then((flow) => flow.page);

  // Unfiltered first, so "the matching row is present" below cannot pass on a
  // history that was already showing one record for some other reason.
  assert.equal(rowTitles(page).length, 3, "the history does not list both decisions and the release before filtering");

  filterByOwner(page, SHIPPED.owner);
  const titles = rowTitles(page);
  assert.equal(
    titles.includes(SHIPPED.title),
    true,
    "the filtered history hides a decision that matches the active filter",
  );
  assert.equal(
    titles.includes(RELEASE_ROW_TITLE),
    true,
    "the filtered history hides the release that matches the active filter",
  );
  assert.equal(
    titles.includes(UNSHIPPED.title),
    false,
    "filter returned a decision that does not match the active filter",
  );
  assert.equal(historyCount(page), "2 of 3 records", "the filtered history miscounts what the filter kept");
});

test("every field typed into the decision and the release survives the trip into the exported JSON", async (t) => {
  const { page, shipped, unshipped, release } = await shipTheDecision(t);
  filterByOwner(page, SHIPPED.owner);

  // The export is taken the way the rest of this flow was: with the keyboard.
  const button = page.document.querySelector("#export-shiplog");
  assert.ok(button, "the history has no export control");
  button.focus();
  pressEnter(page.document);
  assert.equal(
    page.downloads.length,
    1,
    "the export control does not answer Enter, so the history cannot be exported from the keyboard",
  );

  const payload = JSON.parse(page.downloads[0].text);
  assert.deepEqual(
    shiplogExportViolations(payload),
    [],
    "the exported file does not satisfy the Shiplog export contract",
  );

  // --- the decision, field by field ---
  const exported = payload.decisions.filter((candidate) => candidate.id === shipped.id);
  assert.equal(exported.length, 1, "the recorded decision is missing from the export");
  const exportedDecision = exported[0];
  assert.equal(exportedDecision.title, SHIPPED.title, "decision title changed value between recording and export");
  assert.equal(exportedDecision.context, SHIPPED.context, "context lost in export");
  assert.equal(exportedDecision.alternatives, SHIPPED.alternatives, "alternatives lost in export");
  // Both options by name, so an export that carried the first alternative and
  // truncated the rest of the field is a failure rather than a pass.
  assert.equal(
    exportedDecision.alternatives.includes("Resize in the browser before upload"),
    true,
    "alternatives lost in export: the first option considered is not in the file",
  );
  assert.equal(
    exportedDecision.alternatives.includes("cap uploads at 4 MB"),
    true,
    "alternatives lost in export: the second option considered is not in the file",
  );
  assert.equal(exportedDecision.owner, SHIPPED.owner, "decision owner changed value between recording and export");
  assert.equal(exportedDecision.status, SHIPPED.status, "status field changed value between recording and export");
  assert.equal(exportedDecision.createdAt, shipped.createdAt, "the exported decision is dated differently than the record it came from");

  // --- the release, field by field ---
  const exportedReleases = payload.releases.filter((candidate) => candidate.id === release.id);
  assert.equal(exportedReleases.length, 1, "the recorded release is missing from the export");
  const exportedRelease = exportedReleases[0];
  assert.equal(exportedRelease.version, RELEASE.version, "release version changed value between recording and export");
  assert.equal(exportedRelease.title, RELEASE.title, "release title changed value between recording and export");
  assert.equal(exportedRelease.description, RELEASE.description, "release description lost in export");
  assert.equal(exportedRelease.owner, RELEASE.owner, "release owner changed value between recording and export");
  assert.equal(exportedRelease.status, RELEASE.status, "release status changed value between recording and export");
  assert.equal(exportedRelease.createdAt, release.createdAt, "the exported release is dated differently than the record it came from");

  // --- the association, stated twice in the file and asserted both ways ---
  assert.deepEqual(
    exportedRelease.decisionIds,
    [shipped.id],
    "release recorded but not associated with decision in the export",
  );
  assert.deepEqual(
    payload.associations,
    [{ decisionId: shipped.id, releaseId: release.id, position: 0 }],
    "the decision-to-release association is missing from the exported join",
  );

  // --- the filter the file was written against ---
  assert.equal(
    payload.decisions.filter((candidate) => candidate.id === unshipped.id).length,
    0,
    "the export carries a decision that does not match the active filter",
  );
  assert.deepEqual(
    payload.filter,
    { owner: SHIPPED.owner },
    "the exported file does not name the filter that produced it",
  );
  assert.equal(payload.record_count, 2, "the export miscounts the records it carries");
});
