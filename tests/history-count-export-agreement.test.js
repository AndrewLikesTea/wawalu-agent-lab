// The number on the screen, the number in the file, and the number somebody
// counted by hand are the same number.
//
// THE GUARANTEE THESE TESTS PROTECT. A reader narrows the history — by status,
// by owner, by the window a quarter ran in — reads the count above the list, and
// presses Download JSON. The file holds exactly those records. A count that is
// larger than the file loses history from an audit; a count that is smaller puts
// records into an audit that nobody reviewed on screen. Either way the reader
// cannot trust the number they were shown.
//
// WHAT THIS FILE ADDS to the suites beside it. tests/export-parity.test.js
// compares an export against a fixture object;
// tests/browsed-history-export-parity.test.js compares the export against the
// rendered DOM for the *unfiltered* history and proves a filter cannot truncate
// the whole-history scope. Neither pins the arithmetic of a *filtered* download:
// both sides could agree on the wrong number and still pass. So every assertion
// here is made three ways — the rendered count, the length of the downloaded
// array, and a number written down in tests/fixtures/history-count-export.json
// before either side ran. A bug that breaks the page and the export identically
// still fails, because the third number does not move.
//
// The fixture is a static committed file. It is never generated, never randomized,
// and never derived from the code under test; the expected totals in it were
// counted by reading its own two arrays, and every failure message names the
// number that changed.
//
// Determinism: fixed ids, fixed past timestamps, no network (the harness throws
// on an undeclared request), no sleeps, no clock thresholds. Each test parses a
// fresh page and seeds its own storage, so order never matters.
//
// Harness rules this file follows, learned the hard way by the suites before it:
//   * Assertions are on counts, attributes, and text. Never `assert.equal(node,
//     null)` — comparing a harness node to null walks the whole parsed page and
//     outlives the per-test timeout.
//   * No descendant selectors ("details #id" throws). Containment is walked
//     through parentNode.
//   * The harness models no layout, so textOf reads straight through a closed
//     disclosure. Anything a reader has to see is checked against the open state
//     of every disclosure above it (assertNotCollapsed below).
//   * A harness select accepts any value, including one a real control would
//     refuse. Every option is proved present in the control before the filtered
//     result it produces is believed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initShiplogExport } from "../src/shiplog-export.js";
import { SHIPLOG_EXPORT_VERSION } from "../src/shiplog-export-schema.js";
import { shapeViolations } from "./support/export-parity.js";
import { DomEvent, loadPage, pressEnter, pressSpace, tabSequence, textOf } from "./support/browser.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const FIXTURE_FILE = new URL("./fixtures/history-count-export.json", import.meta.url);

const FIXTURE = JSON.parse(await readFile(FIXTURE_FILE, "utf8"));
const { decisions: DECISIONS, releases: RELEASES, expected: EXPECTED } = FIXTURE;

// The example records are a module constant the page composes in, not a fetch,
// so a history holding nothing but this fixture hands the page an empty seed.
// tests/demo-path.test.js is the one that exercises the real seed.
const NO_DEMO_DATA = { decisions: [], releases: [] };

const BROWSER = {
  [STORAGE_KEY]: JSON.stringify(DECISIONS),
  [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
};

async function openHistory(t) {
  const page = await loadPage(DECISIONS_PAGE, { storage: BROWSER });
  t.after(() => page.restore());
  // The module scripts src/index.html loads, in page order.
  await initDecisionLog(page.document, page.storage, { seed: NO_DEMO_DATA });
  initShiplogExport(page.document, page.storage);
  // Wait on state, not on time: the page marks itself ready once it rendered.
  assert.equal(
    page.document.documentElement.dataset.shiplog,
    "ready",
    "the history never finished rendering",
  );
  // The fixture really is the history under test. Without this, a storage shape
  // the loader silently refuses would turn every count below into a comparison
  // of two zeroes.
  assert.equal(
    visibleRows(page),
    EXPECTED.total,
    `the unfiltered history does not show the fixture's ${EXPECTED.total} records`,
  );
  // The file follows the browsed history only while the panel is on its default
  // scope. If that default ever changes, these tests are measuring the store and
  // not the view, so it is asserted rather than assumed.
  const scope = page.document.querySelector("#export-shiplog-scope");
  assert.ok(scope, "the export panel has no scope control");
  assert.equal(
    scope.value,
    "browsing",
    "the export panel no longer defaults to the history being browsed, so a filtered download is not what these tests measure",
  );
  return page;
}

// --- reading the page ---------------------------------------------------------

const list = (page) => page.document.querySelector("#decision-list");
const cards = (page) => list(page).querySelectorAll(".history-card");
const countText = (page) => textOf(page.document.querySelector("#decision-count"));
const exportButton = (page) => page.document.querySelector("#export-shiplog");
// The sentence beside the button: what the file will hold, said before any
// download rather than after one.
const exportSummary = (page) => textOf(page.document.querySelector("#export-shiplog-counts"));

/**
 * The count the reader can see, as a number.
 *
 * "3 of 9 records" and "9 records" are the two shapes the header writes, so the
 * leading integer is the visible count in both. The rendered rows are held to
 * the same number here: a header that says three above five rows is a defect on
 * its own, and every comparison below would inherit it.
 */
function visibleCount(page) {
  const text = countText(page);
  const match = /^(\d+)\b/.exec(text);
  assert.ok(match, `the history count reads ${JSON.stringify(text)}, which states no number`);
  const counted = Number(match[1]);
  assert.equal(
    cards(page).length,
    counted,
    `the history says ${JSON.stringify(text)} but rendered ${cards(page).length} rows`,
  );
  return counted;
}

const visibleRows = (page) => cards(page).length;

/**
 * Nothing between `node` and the page root is a collapsed disclosure.
 *
 * The harness models no layout: textOf reads straight through a closed details
 * element, so text inside one passes an assertion here and is silent in a real
 * browser. Walked through parentNode because the selector engine rejects a
 * descendant selector. A disclosure that is open is fine — the point is that the
 * state is checked rather than assumed.
 */
function assertNotCollapsed(node, label) {
  let ancestor = node?.parentNode;
  while (ancestor && ancestor.nodeType === 1) {
    if (ancestor.tagName === "DETAILS") {
      assert.equal(
        ancestor.getAttribute("open") !== null,
        true,
        `${label} sits inside a closed disclosure, so a real browser does not show it`,
      );
    }
    ancestor = ancestor.parentNode;
  }
}

function articleTitled(page, title) {
  const article = list(page).querySelectorAll("article")
    .find((candidate) => textOf(candidate.querySelector("h3")) === title);
  assert.ok(article, `no history row is titled ${JSON.stringify(title)}`);
  return article;
}

function metaValue(article, label) {
  const pair = article.querySelectorAll(".meta-pair")
    .find((candidate) => textOf(candidate.querySelector(".meta-label")) === `${label}:`);
  assert.ok(pair, `the row shows no "${label}" field`);
  return textOf(pair.querySelector(".meta-value"));
}

// The row prints a field's own label immediately before its value and with no
// separator between them ("OwnerAri"), so the label is stripped to get back the
// value a reader reads. Stated once, here, rather than repeated per field.
function labelledText(article, selector, label) {
  const element = article.querySelector(selector);
  assert.ok(element, `the row shows no ${selector} field`);
  assertNotCollapsed(element, `the row's ${selector} field`);
  const text = textOf(element);
  assert.ok(text.startsWith(label), `the ${selector} field no longer opens with the label ${JSON.stringify(label)}`);
  return text.slice(label.length).trim();
}

const recordId = (href) => new URL(href, "https://labs.wawalu.org").searchParams.get("id");

// --- driving the filters ------------------------------------------------------

function chooseOption(page, selector, value) {
  const select = page.document.querySelector(selector);
  assert.ok(select, `the history has no ${selector} control`);
  // A harness select accepts any value; a real one refuses a value no option
  // carries. So the option is proved present before the result it produces is
  // treated as a filtered view rather than as a silently ignored assignment.
  assert.ok(
    [...select.options].some((option) => option.value === value),
    `${selector} offers no option with value ${JSON.stringify(value)}, so a real control would refuse it`,
  );
  assert.equal(select.disabled, false, `${selector} is disabled, so a reader cannot set it`);
  select.value = value;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return select;
}

// Both date bounds are one filter: the page's handler reads the pair, so the
// values are placed and then one change is fired, which is what a reader
// committing the second field does.
function chooseDateRange(page, from, to) {
  const fromControl = page.document.querySelector("#filter-from");
  const toControl = page.document.querySelector("#filter-to");
  assert.ok(fromControl && toControl, "the history has no recorded-between controls");
  fromControl.value = from;
  toControl.value = to;
  toControl.dispatchEvent(new DomEvent("change", { bubbles: true }));
  // The page repairs an impossible window on the way in, so the controls are
  // read back: a window the view did not accept would make the count below a
  // count of something else.
  assert.equal(fromControl.value, from, "the From bound was not accepted");
  assert.equal(toControl.value, to, "the To bound was not accepted");
}

// Press the control a reader presses, then read back the bytes the browser would
// have written. The parse is asserted before anything asks the payload a
// question, so a truncated download fails as "not valid JSON" rather than as a
// confusing count mismatch.
function downloadExport(page) {
  const before = page.downloads.length;
  page.document.querySelector("#export-shiplog").click();
  assert.equal(page.downloads.length, before + 1, "the Download JSON control produced no download");

  const download = page.downloads.at(-1);
  assert.ok(
    typeof download.text === "string" && download.text.length > 0,
    "the download was delivered with no bytes at all",
  );
  let payload;
  try {
    payload = JSON.parse(download.text);
  } catch (error) {
    return assert.fail(
      `the downloaded file is not valid JSON (${error.message}). `
      + `It is ${download.text.length} bytes and starts ${JSON.stringify(download.text.slice(0, 80))}`,
    );
  }
  assert.ok(Array.isArray(payload.decisions), "the download carries no decisions array");
  assert.ok(Array.isArray(payload.releases), "the download carries no releases array");
  return payload;
}

const exportedRecordCount = (payload) => payload.decisions.length + payload.releases.length;

// --- the three filter combinations --------------------------------------------
//
// Each one: apply the filter, read the count off the page, download under the
// same filter, and hold the page, the file, and the fixture's hand-counted number
// to one another.

async function assertCountAndExportAgree(t, { describe, apply, expected, key }) {
  const page = await openHistory(t);

  apply(page);

  const visible = visibleCount(page);
  assert.equal(
    visible,
    expected,
    `${describe}: the history shows ${visible} records, and the fixture holds ${expected} (expected.${key})`,
  );
  // A filter that changed nothing would make every assertion below pass without
  // proving anything.
  assert.ok(
    expected < EXPECTED.total,
    `${describe}: expected.${key} is the whole history, so this combination is not a filter`,
  );

  const payload = downloadExport(page);
  assert.equal(
    exportedRecordCount(payload),
    visible,
    `${describe}: the page counted ${visible} records and the downloaded file carries `
    + `${exportedRecordCount(payload)} (${payload.decisions.length} decisions, ${payload.releases.length} releases)`,
  );
  assert.equal(
    exportedRecordCount(payload),
    expected,
    `${describe}: the downloaded file carries ${exportedRecordCount(payload)} records, `
    + `and the fixture holds ${expected} (expected.${key})`,
  );
  // The envelope states the same size as its own arrays. A reader who trusts the
  // stated count without counting the records is reading this number.
  assert.equal(
    payload.record_count,
    expected,
    `${describe}: the file's record_count says ${payload.record_count}, and it carries ${exportedRecordCount(payload)} records`,
  );
  return { page, payload };
}

test("a status filter's count, its download, and the fixture's own number all agree", async (t) => {
  const { payload } = await assertCountAndExportAgree(t, {
    describe: "filtered to accepted decisions",
    key: "statusAccepted",
    expected: EXPECTED.statusAccepted,
    apply: (page) => chooseOption(page, "#filter-status", "accepted"),
  });
  // A decision status can only describe a decision, so the file that follows this
  // view carries no releases at all. Named here so the count above cannot be
  // satisfied by the wrong mix of records.
  assert.equal(
    payload.releases.length,
    0,
    "a status-filtered download carries releases, which the status filter cannot match",
  );
});

test("an owner filter's count, its download, and the fixture's own number all agree", async (t) => {
  const { payload } = await assertCountAndExportAgree(t, {
    describe: "filtered to records owned by Priya",
    key: "ownerPriya",
    expected: EXPECTED.ownerPriya,
    apply: (page) => chooseOption(page, "#filter-owner", "Priya"),
  });
  // The owner filter reaches both kinds, which is the half of the count a
  // decisions-only reading would get wrong.
  assert.equal(payload.decisions.length, 2, "the owner-filtered download carries the wrong number of decisions");
  assert.equal(payload.releases.length, 1, "the owner-filtered download carries the wrong number of releases");
});

test("a date-range filter's count, its download, and the fixture's own number all agree", async (t) => {
  await assertCountAndExportAgree(t, {
    describe: "filtered to records recorded in March 2026",
    key: "recordedInMarch",
    expected: EXPECTED.recordedInMarch,
    apply: (page) => chooseDateRange(page, "2026-03-01", "2026-03-31"),
  });
});

// --- field completeness --------------------------------------------------------

test("every field the history row shows for a decision is in that decision's exported record", async (t) => {
  const page = await openHistory(t);
  const decision = DECISIONS.find((record) => record.id === "count-d-cache");
  const article = articleTitled(page, decision.title);

  // What the row shows, read off the row.
  const shownStatus = metaValue(article, "Status");
  const shownContext = labelledText(article, ".context", "");
  const shownAlternatives = labelledText(article, ".alternatives", "Alternatives");
  const shownOwner = labelledText(article, ".owner", "Owner");

  // The releases this row associates the decision with live inside a disclosure.
  // The harness reads through a closed one, so the state is driven rather than
  // assumed: the summary is what a reader sees on arrival, and the ids are behind
  // one keypress.
  const disclosure = article.querySelector(".shipped-releases");
  assert.ok(disclosure, "the decision row states no releases at all");
  assert.equal(
    disclosure.getAttribute("open"),
    null,
    "the shipped-in disclosure now starts open, so this test is no longer opening it",
  );
  const summary = disclosure.querySelector("summary");
  assert.ok(
    textOf(summary).includes("v1.5.0"),
    "the always-visible summary no longer names the most recent release that shipped this decision",
  );
  summary.focus();
  pressEnter(page.document);
  assert.equal(
    disclosure.getAttribute("open") !== null,
    true,
    "the shipped-in disclosure could not be opened from the keyboard",
  );
  const shownReleaseIds = disclosure.querySelectorAll(".record-link")
    .map((link) => recordId(link.getAttribute("href")));
  for (const link of disclosure.querySelectorAll(".record-link")) {
    assertNotCollapsed(link, "an associated release link");
  }
  // Sorted on both sides: which releases the row names is what this test pins.
  // The order they are listed in is pinned by
  // tests/browsed-history-export-parity.test.js, against the detail page.
  assert.deepEqual(
    shownReleaseIds.toSorted(),
    EXPECTED.cacheReleaseIds.toSorted(),
    "the row names different releases from the ones the fixture records",
  );

  // What the file carries for the same record.
  const payload = downloadExport(page);
  const exported = payload.decisions.find((record) => record.id === decision.id);
  assert.ok(exported, `the decision ${JSON.stringify(decision.id)} the history shows is missing from the download`);

  assert.equal(exported.context, shownContext, "the exported decision's context differs from the one the row shows");
  assert.equal(
    exported.alternatives,
    shownAlternatives,
    "the exported decision's alternatives differ from the ones the row shows",
  );
  assert.equal(exported.owner, shownOwner, "the exported decision's owner differs from the one the row shows");
  assert.equal(exported.status, shownStatus, "the exported decision's status differs from the one the row shows");

  const exportedReleaseIds = payload.releases
    .filter((release) => release.decisionIds.includes(decision.id))
    .map((release) => release.id);
  assert.deepEqual(
    exportedReleaseIds.toSorted(),
    shownReleaseIds.toSorted(),
    "the releases the file associates with this decision are not the ones the row shows",
  );
  // The same join stated the other way in the file. Both are read, so an export
  // that dropped a displayed association from one of them still fails.
  assert.deepEqual(
    payload.associations.filter((entry) => entry.decisionId === decision.id)
      .map((entry) => entry.releaseId).toSorted(),
    shownReleaseIds.toSorted(),
    "the file's association list does not carry the releases the row shows",
  );
});

// --- the empty result ----------------------------------------------------------

test("a filter that matches nothing says so, and downloads an empty array rather than the last one", async (t) => {
  const page = await openHistory(t);

  // A non-empty filter first, in the same page state, so a download that served
  // the previous payload would be caught rather than being unreachable.
  chooseOption(page, "#filter-owner", "Jules");
  assert.equal(
    visibleCount(page),
    EXPECTED.ownerJules,
    `the owner filter shows a different number from the fixture's ${EXPECTED.ownerJules} (expected.ownerJules)`,
  );
  const first = downloadExport(page);
  assert.equal(
    exportedRecordCount(first),
    EXPECTED.ownerJules,
    `the first download carries ${exportedRecordCount(first)} records, and the fixture holds ${EXPECTED.ownerJules}`,
  );

  // Now narrow it to a combination that legitimately matches nothing: both of
  // Jules's decisions are accepted.
  chooseOption(page, "#filter-status", "pending");

  const countElement = page.document.querySelector("#decision-count");
  assertNotCollapsed(countElement, "the record count");
  assert.equal(
    visibleCount(page),
    EXPECTED.ownerJulesStatusPending,
    "the history counts records for a filter combination that matches none of the fixture's records",
  );

  const state = list(page).querySelector(".list-state-empty");
  assert.ok(state, "a filter matching nothing rendered no empty state at all");
  assertNotCollapsed(state, "the no-results empty state");
  assert.equal(
    textOf(state.querySelector("h3")),
    "No records match your filters",
    "the no-results empty state no longer says that nothing matched",
  );

  // Since #1247 the panel writes no file at all here. The guarantee this test
  // was protecting is unchanged and stated the other way round: pressing Download
  // JSON under a filter matching nothing must never hand back the previous
  // payload, and the strongest form of that is handing back nothing.
  const before = page.downloads.length;
  exportButton(page).click();
  assert.equal(
    page.downloads.length,
    before,
    "a filter matching nothing produced a download, which is either an empty file or the stale one before it",
  );
  const announcement = page.document.querySelector("#export-shiplog-status");
  assertNotCollapsed(announcement, "the export panel's status line");
  assert.equal(
    textOf(announcement),
    "No records match your history filters, so nothing was downloaded. "
    + "Clear the filters to export your history.",
    "the panel did not say why nothing was downloaded",
  );

  // The way out, and the count it restores. The control is in the panel, is a
  // native button, and clears through the history's own reset path.
  const clear = page.document.querySelector("#export-shiplog-clear-filters");
  assert.ok(clear, "the panel offers no way out of a filter combination matching nothing");
  assert.equal(clear.getAttribute("hidden"), null, "the way out is hidden at zero results");
  assertNotCollapsed(clear, "the clear-filters control");
  clear.click();
  assert.equal(
    visibleCount(page),
    EXPECTED.total,
    "clearing the filters from the export panel did not restore the whole history",
  );
  const restored = downloadExport(page);
  assert.equal(
    exportedRecordCount(restored),
    EXPECTED.total,
    `the download after clearing carries ${exportedRecordCount(restored)} records, and the fixture holds ${EXPECTED.total}`,
  );
  assert.notEqual(
    page.downloads[0].text,
    page.downloads.at(-1).text,
    "the download after clearing handed back the bytes of the filtered one",
  );
});

// --- the manifest, and the summary beside the button ---------------------------
//
// The file states what it is, and the page states it before the download. Both
// are derived from the one selection the list renders from, so the three numbers
// the tests above hold together — page, file, fixture — extend to the manifest
// without introducing a fourth way of counting.

/** Every way a manifest can disagree with the records in its own file. */
function manifestDisagreements(payload) {
  const found = [];
  const manifest = payload.manifest;
  if (!manifest || typeof manifest !== "object") return ["the file carries no manifest object"];
  const decisions = payload.decisions.length;
  const releases = payload.releases.length;
  if (manifest.totalCount !== decisions + releases) {
    found.push(`manifest.totalCount says ${manifest.totalCount}, the file carries ${decisions + releases} records`);
  }
  if (manifest.counts?.decision !== decisions) {
    found.push(`manifest.counts.decision says ${manifest.counts?.decision}, the file carries ${decisions}`);
  }
  if (manifest.counts?.release !== releases) {
    found.push(`manifest.counts.release says ${manifest.counts?.release}, the file carries ${releases}`);
  }
  if (manifest.counts?.decision + manifest.counts?.release !== manifest.totalCount) {
    found.push(`manifest.counts sum to ${manifest.counts?.decision + manifest.counts?.release}, `
      + `and manifest.totalCount says ${manifest.totalCount}`);
  }
  if (manifest.schemaVersion !== SHIPLOG_EXPORT_VERSION) {
    found.push(`manifest.schemaVersion says ${JSON.stringify(manifest.schemaVersion)}`);
  }
  if (typeof manifest.generatedAt !== "string" || Number.isNaN(Date.parse(manifest.generatedAt))) {
    found.push(`manifest.generatedAt is not an ISO instant: ${JSON.stringify(manifest.generatedAt)}`);
  }
  return found;
}

/**
 * Every record in the file satisfies the criteria the manifest states.
 *
 * Read off the records themselves rather than off the selection that produced
 * them: a manifest naming a filter its own records do not satisfy is the failure
 * worth catching, and a check that re-ran the page's selector could not see it.
 */
function criteriaBreaches(payload) {
  const criteria = payload.manifest.criteria;
  const breaches = [];
  for (const decision of payload.decisions) {
    if (criteria.status && decision.status !== criteria.status) {
      breaches.push(`${decision.id} is ${decision.status}, and the criteria name ${criteria.status}`);
    }
    if (criteria.owner && decision.owner !== criteria.owner) {
      breaches.push(`${decision.id} is owned by ${decision.owner}, and the criteria name ${criteria.owner}`);
    }
    if (criteria.type === "release") breaches.push(`${decision.id} is a decision in a releases-only file`);
  }
  for (const release of payload.releases) {
    if (criteria.owner && release.owner !== criteria.owner) {
      breaches.push(`${release.id} is owned by ${release.owner}, and the criteria name ${criteria.owner}`);
    }
    if (criteria.status) breaches.push(`${release.id} is a release in a file filtered by decision status`);
    if (criteria.type === "decision") breaches.push(`${release.id} is a release in a decisions-only file`);
  }
  return breaches;
}

test("a filtered file's manifest counts exactly the records it carries, and every one satisfies its criteria", async (t) => {
  const page = await openHistory(t);
  chooseOption(page, "#filter-owner", "Jules");

  const payload = downloadExport(page);
  assert.deepEqual(manifestDisagreements(payload), [], "the manifest describes a file other than its own");
  assert.equal(
    payload.manifest.totalCount,
    visibleCount(page),
    "the manifest counts a different number of records from the one the reader was shown",
  );
  assert.equal(
    payload.manifest.totalCount,
    EXPECTED.ownerJules,
    `the manifest counts ${payload.manifest.totalCount} records, and the fixture holds `
    + `${EXPECTED.ownerJules} (expected.ownerJules)`,
  );
  assert.deepEqual(payload.manifest.criteria, { owner: "Jules" }, "the manifest names the wrong criteria");
  assert.deepEqual(criteriaBreaches(payload), [], "the file carries a record its own criteria exclude");
  // The manifest is a sibling key: the records are the records the file always
  // carried, field for field.
  assert.deepEqual(shapeViolations(payload), [], "the manifest changed the shape of the file around it");

  // A second dimension, so the per-type counts are proved on a file holding
  // decisions only rather than only on a mixed one.
  chooseOption(page, "#filter-status", "accepted");
  const accepted = downloadExport(page);
  assert.deepEqual(manifestDisagreements(accepted), []);
  assert.equal(accepted.manifest.counts.release, 0, "a status-filtered file counts releases it cannot hold");
  assert.deepEqual(criteriaBreaches(accepted), []);
});

test("an unfiltered file's manifest counts the whole dataset and names no criteria", async (t) => {
  const page = await openHistory(t);

  const payload = downloadExport(page);
  assert.deepEqual(manifestDisagreements(payload), [], "the manifest describes a file other than its own");
  assert.equal(payload.manifest.totalCount, EXPECTED.total, "the unfiltered manifest is not the whole dataset");
  assert.equal(payload.manifest.totalCount, DECISIONS.length + RELEASES.length);
  assert.equal(payload.manifest.counts.decision, DECISIONS.length);
  assert.equal(payload.manifest.counts.release, RELEASES.length);
  // `{}` and nothing else means "no criterion was active": no dimension is
  // written as null, "", or "all", so a reader needs no sentinel table.
  assert.deepEqual(payload.manifest.criteria, {}, "an unfiltered file claims a criterion");
  assert.deepEqual(criteriaBreaches(payload), []);
});

test("the summary beside the export button follows the filters, before any download", async (t) => {
  const page = await openHistory(t);

  // No filters: the whole store, in the wording the panel has always used for
  // "every record".
  assert.equal(
    exportSummary(page),
    `Ready to export ${DECISIONS.length} decisions and ${RELEASES.length} releases stored in this browser.`,
    "the unfiltered summary does not say the file is every record",
  );
  assert.equal(page.downloads.length, 0, "the summary was produced by downloading a file");

  // A filter changes it, and it names the criterion that changed it.
  chooseOption(page, "#filter-owner", "Jules");
  assert.equal(
    exportSummary(page),
    "Ready to export 2 decisions and 1 release matching your history filters (Owner: Jules).",
    "the summary did not follow the filter",
  );
  assert.equal(page.downloads.length, 0, "the summary was produced by downloading a file");

  // A second criterion is named beside the first, and the count stays the count
  // the list is showing.
  chooseOption(page, "#filter-status", "accepted");
  assert.equal(
    exportSummary(page),
    "Ready to export 2 decisions and 0 releases matching your history filters (Status: accepted, Owner: Jules).",
    "the summary names one criterion where two are active",
  );

  // And back: clearing every filter restores the "every record" wording rather
  // than leaving the last filtered sentence on screen.
  page.document.querySelector("#clear-decision-filters").click();
  assert.equal(visibleCount(page), EXPECTED.total);
  assert.equal(
    exportSummary(page),
    `Ready to export ${DECISIONS.length} decisions and ${RELEASES.length} releases stored in this browser.`,
    "the filtered summary outlived the filter",
  );
});

test("the export control and the way out of a dead end are both reachable from the keyboard", async (t) => {
  const page = await openHistory(t);
  const button = exportButton(page);

  // The harness reflects no property to an attribute, so the property is what is
  // asserted here.
  assert.equal(button.tagName, "BUTTON", "the export control is not a native button");
  assert.equal(button.type, "button", "the export control would submit a form");
  button.focus();
  assert.equal(page.document.activeElement, button, "the export control cannot take focus");
  const before = page.downloads.length;
  pressEnter(page.document);
  pressSpace(page.document);
  assert.equal(page.downloads.length, before + 2, "Enter and Space do not both activate the export control");

  // The dead end, reached through the combination the fixture pins as empty.
  chooseOption(page, "#filter-owner", "Jules");
  chooseOption(page, "#filter-status", "pending");
  assert.equal(visibleCount(page), EXPECTED.ownerJulesStatusPending);

  const clear = page.document.querySelector("#export-shiplog-clear-filters");
  assert.ok(clear, "the panel offers no way out of a view that matches nothing");
  assert.equal(clear.tagName, "BUTTON", "the clear-filters control is not a native button");
  assert.equal(clear.type, "button", "the clear-filters control would submit a form");
  // A hidden control is not a tab stop and a revealed one is. Both states are
  // checked: a control that is always in the sequence puts a dead-end recovery
  // on every ordinary visitor's path through the page.
  assert.ok(
    tabSequence(page.document).includes(clear),
    "the way out of a dead end is not in the tab sequence while the dead end is on screen",
  );
  clear.focus();
  assert.equal(page.document.activeElement, clear, "the clear-filters control cannot take focus");
  pressEnter(page.document);
  assert.equal(visibleCount(page), EXPECTED.total, "Enter on the clear-filters control did not restore the history");
  assert.equal(
    tabSequence(page.document).filter((node) => node === clear).length,
    0,
    "the way out is still a tab stop once there is nothing to recover from",
  );
});
