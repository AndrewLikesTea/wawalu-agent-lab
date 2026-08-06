// The filters a reader touches, the number the page says out loud, and the file
// the Download button hands back — held to one another, record for record.
//
// THE GUARANTEE THESE TESTS PROTECT. A reader narrows the history with the
// controls on the page — the search box, the record-type radios, the status and
// owner selects — reads the count, and presses Download JSON. The file must hold
// exactly the records that were on screen: same number, same records, and no
// record the filters had removed. A file that is larger puts records nobody
// reviewed into an audit; a file that is smaller loses history from one.
//
// WHAT THIS FILE ADDS to the suites beside it.
//   * tests/history-count-export-agreement.test.js pins the arithmetic of a
//     filtered download (count == file length == a hand-counted fixture number)
//     for one dimension at a time, and compares counts rather than identities.
//   * tests/history-share-export-parity.test.js proves identity and order for a
//     combination that arrives in a *pasted link*, with no control touched.
//   * tests/browsed-history-export-parity.test.js compares the export against
//     the rendered DOM for the whole, unfiltered history.
// None of them drives a *combination* through the real controls and then asks
// which records came out. That is what this file does: every combination below
// is applied by clicking a radio, choosing an option, or typing in the search
// box, and every one asserts the count, the file's length, and the ids — the
// same ids, in an order both sides derive from one selection.
//
// Determinism by construction: fixed ids, fixed distinct past timestamps (so no
// comparison ever reaches a tiebreak), no Date.now(), no sleeps, no clock
// thresholds, no reliance on object iteration order, and no network (the harness
// throws on an undeclared request). Each test parses a fresh page and seeds its
// own storage, so order never matters.
//
// Harness rules this file follows, learned the hard way by the suites before it:
//   * Assertions are on counts, attributes, and text. Never `assert.equal(node,
//     null)` — comparing a harness node to null walks the whole parsed page and
//     outlives the per-test timeout.
//   * No descendant selectors ("details #id" throws). Containment is walked
//     through parentNode (assertNotCollapsed below).
//   * The harness reflects no property back to an attribute, so a control's
//     state is read from the property (`node.type`, `node.checked`).
//   * The harness models no layout, and textOf reads straight through a closed
//     disclosure element, so *visibility* is not tested here. What is testable —
//     that nothing between a node and the page root is a closed disclosure, and
//     that the live region still carries its announcing attributes — is asserted;
//     whether the region is on screen still belongs in a real browser.
//   * A harness select accepts any value, including one a real control would
//     refuse, and a harness input accepts any string. So every control is proved
//     to offer the value before the result it produces is believed.

import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initShiplogExport } from "../src/shiplog-export.js";
import { DomEvent, loadPage, textOf, typeText } from "./support/browser.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);

// The example records are a module constant the page composes in, not a fetch,
// so an empty seed hands the page a history holding nothing but this fixture.
// tests/demo-path.test.js is the one that exercises the real seed.
const NO_DEMO_DATA = { decisions: [], releases: [] };

// --- the fixture --------------------------------------------------------------
//
// Six decisions and three releases, built so each dimension cuts the set a
// different way and no two dimensions are the same cut:
//   * status  — accepted (2), pending (2), proposed (1), superseded (1)
//   * owner   — Ari (3), Priya (3), Jules (3), spanning both record kinds
//   * type    — 6 decisions, 3 releases
//   * query   — "queue" is in one decision and in one release; "shiplog" is in
//               every record's own prose, which is the combination that matches
//               everything; "flags" is in one decision only.
// Every createdAt is distinct, so "newest first" on screen and "oldest first" in
// the file are both total orders and neither test depends on a tiebreak.

const DECISIONS = [
  {
    id: "ctrl-d-cache",
    title: "Cache the read path",
    context: "Read latency spikes under load. Shiplog records the short-TTL cache.",
    alternatives: "Query tuning alone.",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-02-03T09:00:00.000Z",
  },
  {
    id: "ctrl-d-queue",
    title: "Adopt a durable job queue",
    context: "Background work was lost on deploys. Shiplog records the at-least-once queue.",
    alternatives: "Database polling and in-process retries.",
    owner: "Priya",
    status: "accepted",
    createdAt: "2026-02-10T09:00:00.000Z",
  },
  {
    id: "ctrl-d-flags",
    title: "Introduce feature flags",
    context: "Decouple deploy from release. Shiplog records the rollout.",
    alternatives: "Long-lived release branches.",
    owner: "Jules",
    status: "pending",
    createdAt: "2026-03-05T09:00:00.000Z",
  },
  {
    id: "ctrl-d-rollback",
    title: "Automate the rollback drill",
    context: "A bad deploy took an hour to undo. Shiplog records the drill.",
    alternatives: "A written runbook only.",
    owner: "Ari",
    status: "pending",
    createdAt: "2026-03-12T09:00:00.000Z",
  },
  {
    id: "ctrl-d-schema",
    title: "Freeze the export schema",
    context: "Consumers broke on a renamed field. Shiplog records the freeze.",
    alternatives: "Version every field separately.",
    owner: "Priya",
    status: "proposed",
    createdAt: "2026-04-02T09:00:00.000Z",
  },
  {
    id: "ctrl-d-index",
    title: "Retire the legacy index",
    context: "The old index doubled write cost. Shiplog records its retirement.",
    alternatives: "Keep both indexes indefinitely.",
    owner: "Jules",
    status: "superseded",
    createdAt: "2026-04-20T09:00:00.000Z",
  },
];

const RELEASES = [
  {
    id: "ctrl-r-1-4-0",
    version: "v1.4.0",
    title: "Read path",
    description: "Shiplog release notes: the read cache shipped.",
    owner: "Ari",
    status: "completed",
    createdAt: "2026-02-20T09:00:00.000Z",
    decisionIds: ["ctrl-d-cache"],
  },
  {
    id: "ctrl-r-1-5-0",
    version: "v1.5.0",
    title: "Queue and rollout",
    description: "Shiplog release notes: the durable queue shipped.",
    owner: "Priya",
    status: "completed",
    createdAt: "2026-03-20T09:00:00.000Z",
    decisionIds: ["ctrl-d-queue", "ctrl-d-flags"],
  },
  {
    id: "ctrl-r-1-6-0",
    version: "v1.6.0",
    title: "Index retirement",
    description: "Shiplog release notes: the legacy index is gone.",
    owner: "Jules",
    status: "planned",
    createdAt: "2026-04-25T09:00:00.000Z",
    decisionIds: [],
  },
];

const TOTAL_RECORDS = DECISIONS.length + RELEASES.length;

const BY_ID = new Map([...DECISIONS, ...RELEASES].map((record) => [record.id, record]));

const BROWSER = {
  [STORAGE_KEY]: JSON.stringify(DECISIONS),
  [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
};

// --- the page -----------------------------------------------------------------

async function openHistory(t) {
  const page = await loadPage(DECISIONS_PAGE, { storage: BROWSER });
  t.after(() => page.restore());
  // The module scripts src/index.html loads, in page order. The count
  // announcement is debounced in the product; zero delay keeps it on the
  // macrotask queue without putting a duration in a test (see settle below).
  await initDecisionLog(page.document, page.storage, { seed: NO_DEMO_DATA, announceDelay: 0 });
  initShiplogExport(page.document, page.storage);
  // Wait on state, not on time: the page marks itself ready once it rendered.
  assert.equal(
    page.document.documentElement.dataset.shiplog,
    "ready",
    "the history never finished rendering",
  );
  // The fixture really is the history under test. Without this, a storage shape
  // the loader silently refuses would turn every comparison below into a
  // comparison of two zeroes.
  assert.equal(
    renderedRows(page).length,
    TOTAL_RECORDS,
    `the unfiltered history does not show the fixture's ${TOTAL_RECORDS} records`,
  );
  // The file follows the browsed history only while the panel is on its default
  // scope. If that default ever changes, these tests measure the store and not
  // the view, so it is asserted rather than assumed.
  const scope = page.document.querySelector("#export-shiplog-scope");
  assert.ok(scope, "the export panel has no scope control");
  assert.equal(
    scope.value,
    "browsing",
    "the export panel no longer defaults to the history being browsed, so a filtered download is not what these tests measure",
  );
  return page;
}

// The announcement is debounced, so it settles on a later macrotask. This waits
// for *ordering*, not for a duration: the announcer's timer was queued during
// the render, this one is queued after it, and equal-delay timers fire in the
// order they were scheduled. No test here depends on how long anything takes.
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

// --- reading the page ---------------------------------------------------------

const list = (page) => page.document.querySelector("#decision-list");

/**
 * What the reader can see, in DOM order.
 *
 * Every row is an anchor to its own record, so the id in the href is the row's
 * identity — the id-bearing attribute the markup already carries. The kind comes
 * off the card's own class, which is what the row uses to badge itself.
 */
function renderedRows(page) {
  return page.document.querySelectorAll(".history-card").map((card) => {
    const href = new URL(card.getAttribute("href"), "https://labs.wawalu.org");
    const id = href.searchParams.get("id");
    assert.ok(id, `a history row links to ${href.pathname} with no record id`);
    return {
      id,
      kind: card.className.includes("release-card") ? "releases" : "decisions",
      title: textOf(card.querySelector("h3")),
      owner: labelledText(card, ".owner", "Owner"),
    };
  });
}

const renderedIds = (page, kind) => renderedRows(page)
  .filter((row) => !kind || row.kind === kind)
  .map((row) => row.id);

// A row prints a field's own label immediately before its value and with no
// separator between them ("OwnerAri"), so the label is stripped to get back the
// value a reader reads.
function labelledText(card, selector, label) {
  const element = card.querySelector(selector);
  assert.ok(element, `a history row shows no ${selector} field`);
  const text = textOf(element);
  assert.ok(text.startsWith(label), `the ${selector} field no longer opens with the label ${JSON.stringify(label)}`);
  return text.slice(label.length).trim();
}

/**
 * Nothing between `node` and the page root is a collapsed disclosure.
 *
 * The harness models no layout: textOf reads straight through a closed
 * disclosure element, so text inside one passes an assertion here and is silent
 * in a real browser. Walked through parentNode because the selector engine
 * rejects a descendant selector. This is the containment half of "the reader can
 * see it" — whether the region is scrolled into view or painted at all is not
 * something this harness can answer, and no assertion here pretends otherwise.
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

/** The leading integer of a count line: "3 of 9 records" and "9 records" both. */
function leadingCount(text, where) {
  const match = /^(\d+)\b/.exec(text);
  assert.ok(match, `${where} reads ${JSON.stringify(text)}, which states no number`);
  return Number(match[1]);
}

/**
 * The number the page's live region says out loud, as a number.
 *
 * Three shapes, all of them from historyCountMessage: "Showing all 9 records.",
 * "Showing 3 of 9 records.", and the no-match sentence, which states zero in
 * words rather than in digits. Anything else fails here rather than being
 * coerced into a number the reader never heard.
 */
function announcedCount(page) {
  const region = page.document.querySelector("#history-announcement");
  assert.ok(region, "the history has no live region for its count");
  assertNotCollapsed(region, "the count live region");
  // The region announces only while it keeps the attributes that make it one.
  // The harness cannot tell whether it is painted, so its role is what is
  // checked here; a browser-level check of the announcement belongs elsewhere.
  assert.equal(region.getAttribute("role"), "status", "the count live region is no longer a status region");
  assert.equal(region.getAttribute("aria-live"), "polite", "the count live region no longer announces politely");
  const text = textOf(region);
  if (text === "No records match the current filters.") return 0;
  const match = /^Showing (?:all )?(\d+)\b/.exec(text);
  assert.ok(match, `the count live region says ${JSON.stringify(text)}, which states no number`);
  return Number(match[1]);
}

// --- driving the controls -----------------------------------------------------

/**
 * Choose an option the way a reader does, after proving the control offers it.
 *
 * A harness select accepts any value; a real one refuses a value no option
 * carries. Without the check below, a control-refusal bug — an owner missing
 * from the list, a status the page dropped — would pass green as a filter that
 * silently did nothing.
 */
function chooseOption(page, selector, value) {
  const select = page.document.querySelector(selector);
  assert.ok(select, `the history has no ${selector} control`);
  assert.equal(select.disabled, false, `${selector} is disabled, so a reader cannot set it`);
  assert.ok(
    select.options.some((option) => option.value === value),
    `${selector} offers no option with value ${JSON.stringify(value)} `
    + `(it offers ${JSON.stringify(select.options.map((option) => option.value))}), so a real control would refuse it`,
  );
  select.value = value;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  assert.equal(select.value, value, `${selector} did not keep the chosen value`);
  return select;
}

/**
 * Click one of the record-type radios, after proving the group offers exactly
 * the three kinds the view can filter by.
 *
 * The type filter is a radio group rather than a select, so "the control offers
 * this value" means the input exists, is a radio, and ends up the only checked
 * one in its group. Read from the properties: the harness reflects nothing back
 * to an attribute, so `getAttribute("checked")` would answer for the markup and
 * not for the control.
 */
function chooseRecordType(page, value) {
  const group = page.document.querySelectorAll('input[name="record-type"]');
  assert.deepEqual(
    group.map((input) => input.value),
    ["all", "decision", "release"],
    "the record-type group no longer offers exactly the three record kinds the view filters by",
  );
  const wanted = group.find((input) => input.value === value);
  assert.ok(wanted, `the record-type group offers no ${JSON.stringify(value)} option`);
  assert.equal(wanted.type, "radio", "the record-type control is not a radio, so clicking it does not choose one kind");
  assert.equal(wanted.disabled, false, "the record-type option is disabled, so a reader cannot choose it");
  wanted.click();
  assert.equal(wanted.checked, true, `clicking the ${value} record type did not select it`);
  assert.equal(
    group.filter((input) => input.checked).length,
    1,
    "more than one record type is selected at once",
  );
  return wanted;
}

/** Type into the search box, character by character, the way a reader does. */
function searchFor(page, query) {
  const input = page.document.querySelector("#decision-search");
  assert.ok(input, "the history has no search control");
  assert.equal(input.type, "search", "the record search is no longer a search input");
  assert.equal(input.disabled, false, "the search box is disabled, so a reader cannot type in it");
  input.focus();
  typeText(page.document, query);
  assert.equal(input.value, query, "the search box did not keep what was typed into it");
  return input;
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

// --- the two orders, re-derived from the fixture ------------------------------
//
// Neither is imported from the code under test. The page shows newest first; the
// file is written oldest first with ties broken by id (the export contract).
// Both are computed here from the fixture's own timestamps, so a change to
// either rule fails rather than being absorbed.

const timeOf = (id) => Date.parse(BY_ID.get(id).createdAt);
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const newestFirst = (ids) => [...ids].sort((a, b) => timeOf(b) - timeOf(a) || byId(a, b));
const oldestFirst = (ids) => [...ids].sort((a, b) => timeOf(a) - timeOf(b) || byId(a, b));

// --- the assertion every combination makes ------------------------------------

/**
 * One filter combination, checked in order: what the page counted, what the file
 * counted, and which records each of them holds.
 *
 * `expected` is written out by hand from the fixture above — ids, not just a
 * number — so a bug that moves the page and the file together still fails.
 */
async function assertControlsAndExportAgree(t, { describe, apply, expected }) {
  const page = await openHistory(t);
  apply(page);
  await settle();

  const wanted = [...expected.decisions, ...expected.releases];
  const count = wanted.length;

  // 1. The count the reader is given, in all three places the page states it.
  const rows = renderedRows(page);
  assert.equal(rows.length, count, `${describe}: the history rendered ${rows.length} rows, and the fixture names ${count}`);
  const counter = page.document.querySelector("#decision-count");
  assertNotCollapsed(counter, "the record count");
  assert.equal(
    leadingCount(textOf(counter), "the record count"),
    count,
    `${describe}: the record count says ${JSON.stringify(textOf(counter))} above ${rows.length} rows`,
  );
  const summary = page.document.querySelector("#history-filter-summary");
  assertNotCollapsed(summary, "the filter summary");
  assert.equal(
    leadingCount(textOf(summary), "the filter summary"),
    count,
    `${describe}: the filter summary says ${JSON.stringify(textOf(summary))} above ${rows.length} rows`,
  );
  assert.equal(
    announcedCount(page),
    count,
    `${describe}: the live region announced a different number from the ${count} records on screen`,
  );

  // 2. The file the same filter state produces, counted.
  const payload = downloadExport(page);
  const exportedCount = payload.decisions.length + payload.releases.length;
  assert.equal(
    exportedCount,
    count,
    `${describe}: the page counted ${count} records and the downloaded file carries `
    + `${exportedCount} (${payload.decisions.length} decisions, ${payload.releases.length} releases)`,
  );
  // The envelope states the same size as its own arrays. A reader who trusts the
  // stated count without counting the records is reading these numbers.
  assert.equal(payload.record_count, count, `${describe}: the file's record_count says ${payload.record_count}`);
  assert.equal(payload.decision_count, payload.decisions.length, `${describe}: the file's decision_count is not its own array's length`);
  assert.equal(payload.release_count, payload.releases.length, `${describe}: the file's release_count is not its own array's length`);

  // 3. Identity, not cardinality: the same records, id for id, and each side in
  //    the order its own contract pins.
  for (const kind of ["decisions", "releases"]) {
    const shown = renderedIds(page, kind);
    const exported = payload[kind].map((record) => record.id);
    assert.deepEqual(
      shown.toSorted(),
      [...expected[kind]].toSorted(),
      `${describe}: the history rendered different ${kind} from the ones the fixture names`,
    );
    assert.deepEqual(
      exported.toSorted(),
      shown.toSorted(),
      `${describe}: the exported ${kind} are not the ${kind} the page rendered`,
    );
    assert.deepEqual(
      exported,
      oldestFirst(shown),
      `${describe}: the exported ${kind} are not in the order the export contract pins (oldest first, ties by id)`,
    );
  }
  assert.deepEqual(
    renderedIds(page),
    newestFirst(wanted),
    `${describe}: the rows are not in the newest-first order the default sort promises`,
  );

  // 4. Record for record, not id for id: what the row shows is what the file
  //    carries for that same record.
  for (const row of rows) {
    const exported = payload[row.kind].find((record) => record.id === row.id);
    assert.ok(exported, `${describe}: the row for ${row.id} is missing from the download`);
    assert.equal(exported.owner, row.owner, `${describe}: the file's owner for ${row.id} is not the one the row shows`);
    const heading = row.kind === "releases" ? `${exported.version} · ${exported.title}` : exported.title;
    assert.equal(heading, row.title, `${describe}: the file's title for ${row.id} is not the one the row shows`);
  }

  return { page, payload };
}

// --- the combinations ---------------------------------------------------------

test("a status chosen from the control counts and exports the same two decisions", async (t) => {
  await assertControlsAndExportAgree(t, {
    describe: "status: accepted",
    // A decision status can only describe a decision, so the file that follows
    // this view carries no releases — the expected releases list is empty, and
    // the assertion above holds the file to it.
    expected: { decisions: ["ctrl-d-cache", "ctrl-d-queue"], releases: [] },
    apply: (page) => chooseOption(page, "#filter-status", "accepted"),
  });
});

test("an owner chosen from the control counts and exports the same records of both kinds", async (t) => {
  await assertControlsAndExportAgree(t, {
    describe: "owner: Priya",
    // The owner filter reaches both kinds, which is the half of the count a
    // decisions-only reading would get wrong.
    expected: { decisions: ["ctrl-d-queue", "ctrl-d-schema"], releases: ["ctrl-r-1-5-0"] },
    apply: (page) => chooseOption(page, "#filter-owner", "Priya"),
  });
});

test("free text typed into the search box counts and exports the same records", async (t) => {
  await assertControlsAndExportAgree(t, {
    describe: 'search: "queue"',
    // One decision by its own words and one release by the decision it carried:
    // an export that ignored the query, or applied it to decisions only, lands
    // on a different set and fails here.
    expected: { decisions: ["ctrl-d-queue"], releases: ["ctrl-r-1-5-0"] },
    apply: (page) => searchFor(page, "queue"),
  });
});

test("a record type and an owner together count and export the one record they share", async (t) => {
  await assertControlsAndExportAgree(t, {
    describe: "type: releases + owner: Jules",
    expected: { decisions: [], releases: ["ctrl-r-1-6-0"] },
    apply: (page) => {
      chooseRecordType(page, "release");
      chooseOption(page, "#filter-owner", "Jules");
    },
  });
});

test("a combination every record matches counts and exports the whole history", async (t) => {
  const { page, payload } = await assertControlsAndExportAgree(t, {
    describe: 'search: "shiplog" — every record matches',
    expected: {
      decisions: DECISIONS.map((decision) => decision.id),
      releases: RELEASES.map((release) => release.id),
    },
    // Every record's own prose carries the word, so this is an active filter
    // that removes nothing — the case where the page and the file can disagree
    // by falling back to two different "everything"s.
    apply: (page) => searchFor(page, "shiplog"),
  });
  assert.equal(payload.record_count, TOTAL_RECORDS, "the match-everything download is not the whole history");
  // The filter is active even though it hid nothing, and the file says so: the
  // block names the query the reader typed rather than claiming no filter.
  assert.equal(
    payload.filter.query,
    "shiplog",
    "the file does not name the query that produced it, so a reader cannot tell which view it came from",
  );
  assert.equal(
    renderedIds(page).length,
    TOTAL_RECORDS,
    "a filter every record matches removed a row",
  );
});

// --- the empty result ----------------------------------------------------------

test("a combination matching nothing counts zero, exports an empty file, and names the filters in effect", async (t) => {
  const page = await openHistory(t);

  // A non-empty download first, in the same page state, so a second download
  // that served the first payload again is caught rather than unreachable — and
  // so the empty file's envelope has a non-empty file of the same run to be
  // compared against.
  chooseOption(page, "#filter-owner", "Priya");
  await settle();
  const populated = downloadExport(page);
  assert.equal(populated.record_count, 3, "the owner filter did not produce the three records the fixture names");

  // Now a combination that legitimately matches nothing: Jules owns no accepted
  // decision, and the only record carrying "flags" is his pending one.
  chooseRecordType(page, "decision");
  chooseOption(page, "#filter-status", "accepted");
  chooseOption(page, "#filter-owner", "Jules");
  searchFor(page, "flags");
  await settle();

  assert.equal(renderedIds(page).length, 0, "a filter combination matching nothing still rendered rows");
  const counter = page.document.querySelector("#decision-count");
  assertNotCollapsed(counter, "the record count");
  assert.equal(
    leadingCount(textOf(counter), "the record count"),
    0,
    `the record count says ${JSON.stringify(textOf(counter))} above an empty list`,
  );
  assert.equal(announcedCount(page), 0, "the live region did not say that nothing matched");

  // The empty state says what happened and — the part a reader needs to recover —
  // which filters produced it. A generic "no results" leaves them to reconstruct
  // four controls from memory.
  const state = list(page).querySelector(".list-state-empty");
  assert.ok(state, "a filter matching nothing rendered no empty state at all");
  assertNotCollapsed(state, "the no-results empty state");
  assert.equal(
    textOf(state.querySelector("h3")),
    "No records match your filters",
    "the no-results empty state no longer says that nothing matched",
  );
  const stated = textOf(state);
  for (const [dimension, value] of [
    ["search", "flags"],
    ["record type", "Decisions"],
    ["status", "accepted"],
    ["owner", "Jules"],
  ]) {
    assert.ok(
      stated.includes(value),
      `the empty state does not name the ${dimension} filter in effect (${JSON.stringify(value)}); it reads ${JSON.stringify(stated)}`,
    );
  }

  // The file is still a whole file: valid JSON, empty collections, and the same
  // envelope the populated download carried.
  const empty = downloadExport(page);
  assert.deepEqual(empty.decisions, [], "the download under a filter matching nothing carries decisions");
  assert.deepEqual(empty.releases, [], "the download under a filter matching nothing carries releases");
  assert.deepEqual(empty.associations, [], "the empty download carries decision-release associations");
  assert.equal(empty.record_count, 0, `the empty download's record_count says ${empty.record_count}`);
  assert.equal(empty.decision_count, 0, `the empty download's decision_count says ${empty.decision_count}`);
  assert.equal(empty.release_count, 0, `the empty download's release_count says ${empty.release_count}`);
  assert.deepEqual(
    Object.keys(empty).toSorted(),
    Object.keys(populated).toSorted(),
    "the empty download has a different envelope from a populated one, so a consumer has to special-case it",
  );
  assert.equal(empty.schema, populated.schema, "the empty download states a different schema");
  assert.equal(empty.version, populated.version, "the empty download states a different schema version");
  assert.equal(empty.source, populated.source, "the empty download names a different source surface");
  // The block names the filters that emptied it, so the file explains itself.
  assert.deepEqual(
    empty.filter,
    { query: "flags", type: "decision", status: "accepted", owner: "Jules" },
    "the empty file does not name the filter combination that produced it",
  );

  // Not the previous file handed back a second time.
  assert.equal(page.downloads.length, 2, "the second download did not produce a second file");
  assert.notEqual(
    page.downloads[0].text,
    page.downloads[1].text,
    "the second download handed back the bytes of the first, so the file is stale rather than empty",
  );
});
