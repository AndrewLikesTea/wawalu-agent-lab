// A shared filtered link and the file exported from it describe the same view.
//
// THE GUARANTEE THESE TESTS PROTECT. A release manager narrows the history,
// pastes the URL into a review, and the reader presses Download JSON. The file
// they get must hold exactly the records the link put on their screen — every
// one of them, only those, and in the one order the export contract documents.
// If the two ever disagree, the number in the review and the number in the file
// disagree too, and neither reader can tell which is wrong.
//
// tests/export-parity.test.js already covers the export against filters set by
// *touching the controls*. This file covers the other entry point, which is the
// one a link uses: the filter state arrives in the query string, before any
// control has been touched, and several dimensions arrive at once. That is the
// combination a single-dimension test cannot see — a link that carries a query,
// a status, a record type, and a date window together goes through
// parseHistoryFilters, the control sync, and the boot render before the export
// panel ever reads a scope.
//
// ORDER, STATED ONCE. The rendered list is newest-first (the history's default
// sort) and each exported collection is in the canonical export order that
// shiplog-export.js pins — oldest first, ties by id — so the same history always
// exports to the same bytes. So "same order" here is asserted as: the exported
// sequence is exactly the rendered rows put through that one documented rule,
// with nothing added, nothing dropped, and no second selection of its own. A
// test demanding the export repeat the DOM's order verbatim would be asserting
// a requirement this product does not have, and would break re-import
// determinism if anyone satisfied it.
//
// Determinism: the fixture is hand-authored with fixed ids and fixed past
// timestamps, every filter bound is a pinned calendar day (no window computed
// from the clock), the page renders synchronously and every assertion waits on
// state rather than time, and the harness throws on any network request. Ids are
// prefixed `share-` so they cannot collide with another suite's fixtures during
// a parallel `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { initShiplogExport } from "../src/shiplog-export.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { activeHistoryFilters, parseHistoryFilters } from "../src/history-filters.js";
import { canonicalExportOrder } from "../src/shiplog-export-schema.js";
import { loadPage, textOf } from "./support/browser.js";
import { shapeViolations } from "./support/export-parity.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
// The example records are a module constant the page composes in; a history
// holding only this file's fixtures is what makes the counts below arithmetic
// somebody can check by eye.
const NO_DEMO_DATA = { decisions: [], releases: [] };

// --- the fixture -------------------------------------------------------------
//
// Hand-authored and deliberately small, but with enough variety that every case
// below is genuinely exercised rather than accidentally passing:
//
//   * three decision statuses (accepted, pending, proposed) and two release
//     statuses (completed, planned), so a status filter is a real narrowing;
//   * both record types, so a `type=` in a link changes the answer;
//   * createdAt spanning 2026-01-15 to 2026-06-02, so a pinned date window keeps
//     some records and drops others at both ends;
//   * the word "queue" spread across titles, contexts, and a release
//     description, so a text query crosses records of both types.
//
// The combination filter the main test uses (q=queue, status=accepted,
// type=decision, 2026-02-01..2026-04-30) keeps exactly two of the nine records,
// and each of its four dimensions is load-bearing: dropping any one of them
// admits at least one record the others exclude.

const DECISIONS = [
  {
    id: "share-d-legacy",
    title: "Retry the queue by hand",
    context: "Before the cutover, failed jobs were replayed manually.",
    alternatives: "Leave the jobs dropped.",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-01-15T09:00:00.000Z",
  },
  {
    id: "share-d-cache",
    title: "Cache the read path",
    context: "Read latency spikes under load.",
    alternatives: "Query tuning alone.",
    owner: "Priya",
    status: "accepted",
    createdAt: "2026-02-10T09:00:00.000Z",
  },
  {
    id: "share-d-queue",
    title: "Adopt a durable job queue",
    context: "Background work was lost on deploys.",
    alternatives: "Database polling.",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-03-05T09:00:00.000Z",
  },
  {
    id: "share-d-flags",
    title: "Flag the queue rollout",
    context: "Decouple deploy from release.",
    alternatives: "Long-lived branches.",
    owner: "Jules",
    status: "pending",
    createdAt: "2026-03-20T09:00:00.000Z",
  },
  {
    id: "share-d-workers",
    title: "Scale the queue workers",
    context: "Peak backlog outran one worker.",
    alternatives: "A bigger single worker.",
    owner: "Priya",
    status: "accepted",
    createdAt: "2026-04-15T09:00:00.000Z",
  },
  {
    id: "share-d-retention",
    title: "Shorten log retention",
    context: "Storage cost grew faster than traffic.",
    alternatives: "Sampling at write time.",
    owner: "Jules",
    status: "proposed",
    createdAt: "2026-06-02T09:00:00.000Z",
  },
];

const RELEASES = [
  {
    id: "share-r-1-4-0",
    version: "v1.4.0",
    title: "Queue rollout",
    description: "The durable queue shipped.",
    owner: "Ari",
    status: "completed",
    createdAt: "2026-03-10T09:00:00.000Z",
    decisionIds: ["share-d-queue"],
  },
  {
    id: "share-r-1-5-0",
    version: "v1.5.0",
    title: "Cache invalidation",
    description: "Cache invalidation plus the flagged rollout.",
    owner: "Priya",
    status: "completed",
    createdAt: "2026-04-01T09:00:00.000Z",
    decisionIds: ["share-d-cache", "share-d-flags"],
  },
  {
    id: "share-r-1-6-0",
    version: "v1.6.0",
    title: "Dependency bumps",
    description: "Routine maintenance.",
    owner: "Jules",
    status: "planned",
    createdAt: "2026-05-20T09:00:00.000Z",
    decisionIds: [],
  },
];

const TOTAL_RECORDS = DECISIONS.length + RELEASES.length;

// The link the tests paste. Every dimension the view carries in a URL that this
// task is about — text query, status, record type, and both date bounds — set at
// once, with pinned days rather than a window derived from the clock.
const COMBINED_SEARCH = "?q=queue&type=decision&status=accepted&from=2026-02-01&to=2026-04-30";

// --- the page ----------------------------------------------------------------

// Hold one `<select>` to the rule a real browser holds it to: a value no option
// carries is refused, and the control stays at "". The shared harness models a
// select as a value slot that accepts anything, which is fine for the controls
// whose options ship in the markup — every filter here except one. The owner
// list is built from the visitor's own data, so it is empty at boot, and a
// harness that lets it hold "Priya" anyway reports a filter the page could not
// really have applied. Applied per element, in this file only: the shared
// harness is left alone so no other suite changes meaning.
function pinToItsOptions(select) {
  let value = select.value;
  Object.defineProperty(select, "value", {
    configurable: true,
    get: () => value,
    set(next) {
      const candidate = String(next);
      value = select.options.some((option) => option.value === candidate) ? candidate : "";
    },
  });
  return select;
}

// Open the shipped decisions page at a URL, booting the two module scripts
// src/index.html loads, in page order. No control is touched: the filter state
// arrives the way a pasted link delivers it.
async function openSharedLink(t, search = "") {
  const page = await loadPage(DECISIONS_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(DECISIONS),
      [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
    },
    location: { search, pathname: "/" },
  });
  t.after(() => page.restore());
  pinToItsOptions(page.document.querySelector("#filter-owner"));
  await initDecisionLog(page.document, page.storage, { seed: NO_DEMO_DATA, announceDelay: 0 });
  initShiplogExport(page.document, page.storage);
  assert.equal(
    page.document.documentElement.dataset.shiplog,
    "ready",
    "the history never finished rendering",
  );
  return page;
}

// What the visitor can see, read off the rendered rows in DOM order: each row is
// an anchor to its own record, so the id in the href is the row's identity.
function renderedRows(page) {
  return [...page.document.querySelectorAll(".history-card")].map((card) => {
    const href = new URL(card.getAttribute("href"), "https://labs.wawalu.org");
    const id = href.searchParams.get("id");
    assert.ok(id, `a history row links to ${href.pathname} with no record id`);
    return { id, kind: card.className.includes("release-card") ? "releases" : "decisions" };
  });
}

const renderedIds = (page, kind) => renderedRows(page).filter((row) => row.kind === kind).map((row) => row.id);

// Press the control the visitor presses and read back the file the browser would
// have written to disk.
function exportFromPage(page) {
  const before = page.downloads.length;
  page.document.querySelector("#export-shiplog").click();
  assert.equal(page.downloads.length, before + 1, "the export button produced no download");
  return JSON.parse(page.downloads.at(-1).text);
}

// The rendered rows, put through the one reordering the export contract
// documents. Built from the stored records the rows name, so this is a
// projection of what was on screen and never a second selection.
function canonicalRenderedIds(page, kind) {
  const stored = kind === "decisions" ? DECISIONS : RELEASES;
  const shown = new Set(renderedIds(page, kind));
  return canonicalExportOrder(stored.filter((record) => shown.has(record.id))).map((record) => record.id);
}

// The whole assertion, in one place, so every test below states the same
// guarantee: shared link and export list the same records, in the same order.
function assertLinkExportParity(page, payload, headline) {
  for (const kind of ["decisions", "releases"]) {
    const exported = payload[kind].map((record) => record.id);
    assert.deepEqual(
      exported.toSorted(),
      renderedIds(page, kind).toSorted(),
      `${headline} the exported ${kind} are not the ${kind} the shared link rendered`,
    );
    assert.deepEqual(
      exported,
      canonicalRenderedIds(page, kind),
      `${headline} the exported ${kind} are not in the order the export contract pins`,
    );
  }
  assert.equal(
    payload.record_count,
    renderedRows(page).length,
    `${headline} the file counts a different number of records than the link rendered`,
  );
  assert.deepEqual(shapeViolations(payload), [], `${headline} the file is not a whole export`);
}

// --- the combination a single-dimension test cannot see ----------------------

test("a shared link carrying four filters at once exports exactly the records it rendered, in order", async (t) => {
  const page = await openSharedLink(t, COMBINED_SEARCH);

  // The link really did narrow the view: two of nine records, and the two the
  // fixture says are the only ones matching all four dimensions.
  const rows = renderedRows(page);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["share-d-workers", "share-d-queue"],
    "the shared combination link does not render the rows the fixture describes",
  );
  assert.ok(rows.length < TOTAL_RECORDS, "the combination link did not narrow the history at all");

  // The file the reader downloads from that link: same records, same order.
  const payload = exportFromPage(page);
  assertLinkExportParity(page, payload, "a shared combination link:");

  // Reversed on purpose, and asserted rather than assumed: the rendered list is
  // newest-first and the export is oldest-first, so a test that compared the two
  // sequences verbatim would be pinning an order this product does not promise.
  assert.deepEqual(payload.decisions.map((decision) => decision.id), ["share-d-queue", "share-d-workers"]);

  // And the file names the filter it came from, in the link's own words.
  assert.deepEqual(payload.filter, activeHistoryFilters(parseHistoryFilters(COMBINED_SEARCH)));
});

test("a shared link that keeps both record types exports both, and links stay resolvable", async (t) => {
  // Same entry point, without the type and status dimensions, so releases are in
  // the answer too: the parity claim has to hold for the collection the
  // combination test above filters away.
  const page = await openSharedLink(t, "?q=queue&from=2026-02-01&to=2026-04-30");

  const rows = renderedRows(page);
  assert.ok(
    rows.some((row) => row.kind === "releases") && rows.some((row) => row.kind === "decisions"),
    "this link no longer exercises a mixed-type result",
  );

  const payload = exportFromPage(page);
  assertLinkExportParity(page, payload, "a shared mixed-type link:");

  // No exported release points at a decision the same file does not carry: a
  // filtered file a reader re-imports can never contain a dangling link.
  const exportedDecisions = new Set(payload.decisions.map((decision) => decision.id));
  const dangling = payload.releases
    .flatMap((release) => release.decisionIds.map((id) => ({ release: release.id, id })))
    .filter((link) => !exportedDecisions.has(link.id));
  assert.deepEqual(dangling, [], "the filtered file points at decisions it does not contain");
});

test("a shared link filtering by owner renders that owner's records, and the file follows", async (t) => {
  // The owner list is built from the data, so at boot the control holds nothing
  // but "all" — and a control that cannot hold the link's value is how a shared
  // filter goes missing between the sender's screen and the reader's. Owner is
  // the one filter whose options do not ship in the markup, so it is the only
  // dimension where this can happen; the assertion is here rather than in the
  // combination test because the failure is in the link, not in the export.
  const page = await openSharedLink(t, "?owner=Priya&status=accepted");

  assert.deepEqual(
    renderedIds(page, "decisions"),
    ["share-d-workers", "share-d-cache"],
    "a shared owner link did not render that owner's records",
  );

  const payload = exportFromPage(page);
  assertLinkExportParity(page, payload, "a shared owner link:");
  assert.deepEqual(payload.filter, { status: "accepted", owner: "Priya" });
});

// --- the three boundaries that previously hid a mismatch ---------------------

test("a shared link matching zero records writes no file, and does not fall back to the whole log", async (t) => {
  // The zero case is where a mismatch hides best: an export that quietly fell
  // back to the whole store looks like a working button. So does one that hands
  // back an empty file under a link the reader did not write — which is why the
  // press is refused here and answered in words instead.
  const page = await openSharedLink(t, "?q=no%20record%20says%20this&status=accepted&from=2026-02-01&to=2026-04-30");

  assert.deepEqual(renderedRows(page), [], "the fixture accidentally matches this link");

  const before = page.downloads.length;
  page.document.querySelector("#export-shiplog").click();
  assert.equal(page.downloads.length, before, "a zero-result link still wrote a file");
  assert.equal(
    page.document.querySelector("#export-shiplog").disabled,
    false,
    "the export control was disabled at zero results",
  );
  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-counts")),
    "No records match your history filters, so there is nothing to export. "
    + "Clear the filters, or choose every stored record above.",
    "the panel did not say why the shared link has nothing to export",
  );
  const clear = page.document.querySelector("#export-shiplog-clear");
  assert.ok(clear, "a reader who opened a zero-result link is offered no way back");
  assert.equal(clear.hidden, false, "the clear-filters control stayed hidden with nothing to export");
});

test("a shared link matching every record exports the whole log, and says it counted them all", async (t) => {
  // Both bounds sit outside the fixture's span, so the window is a real filter
  // that happens to admit everything — not an absent one.
  const page = await openSharedLink(t, "?from=2026-01-01&to=2026-12-31");

  assert.equal(renderedRows(page).length, TOTAL_RECORDS, "the match-everything link hid a record");

  const payload = exportFromPage(page);
  assertLinkExportParity(page, payload, "a match-everything link:");
  assert.equal(payload.record_count, TOTAL_RECORDS);
  assert.deepEqual(
    [...payload.decisions, ...payload.releases].map((record) => record.id).toSorted(),
    [...DECISIONS, ...RELEASES].map((record) => record.id).toSorted(),
    "the match-everything file is not the whole stored log",
  );
  assert.deepEqual(payload.filter, { from: "2026-01-01", to: "2026-12-31" });
});

test("a shared link matching a strict subset exports fewer records than the unfiltered log", async (t) => {
  // Measured against the unfiltered history rather than against a number typed
  // into the test, so this case cannot silently degenerate into the
  // match-everything one if the fixture or the filter rule changes.
  const unfiltered = await openSharedLink(t, "");
  const total = renderedRows(unfiltered).length;
  assert.equal(total, TOTAL_RECORDS);
  const unfilteredExport = exportFromPage(unfiltered);
  assert.equal(unfilteredExport.record_count, total);

  const page = await openSharedLink(t, COMBINED_SEARCH);
  const visible = renderedRows(page).length;
  assert.ok(visible > 0, "the subset link matches nothing, which is the zero case, not this one");
  assert.ok(visible < total, "the subset link matches the whole log, so this test proves nothing");

  const payload = exportFromPage(page);
  assert.ok(
    payload.record_count < unfilteredExport.record_count,
    "the filtered file is no smaller than the unfiltered one",
  );
  assertLinkExportParity(page, payload, "a strict-subset link:");
});
