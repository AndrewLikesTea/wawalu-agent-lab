// The file a reader downloads holds every record their screen showed them.
//
// THE GUARANTEE THESE TESTS PROTECT. An auditor browses the history, presses
// Download JSON, and reads the file instead of the screen. Every decision and
// every release they could see is in it, once, with the same context,
// alternatives, owner, status, and decision<->release links they were just
// reading. A record that only exists on one of the two sides is a defect either
// way round: a missing one loses history, an extra one puts a record in an audit
// that nobody could review on screen.
//
// WHAT THIS FILE ADDS to the two suites next to it. tests/export-parity.test.js
// compares the export against a *fixture object*, and
// tests/history-share-export-parity.test.js covers the shared-link entry point.
// Both would still pass if the history and the export drifted together — if a
// field stopped rendering, or rendered something the file does not carry. This
// file compares the export against the **rendered DOM**: the browsed list for
// the record set, and each record's own detail page, read back the way a reader
// reads it, for the fields. tests/support/browsed-record-parity.js holds the
// readers, the one documented normalization, and the failure text.
//
// HOW THE FILE IS OBTAINED. Always by clicking the control a reader clicks. The
// export builds a Blob, hands it to URL.createObjectURL, and activates an anchor
// carrying a download attribute; the harness records that activation together
// with the bytes the blob actually held (tests/support/browser.js). Those bytes
// are parsed here, with the parse asserted before any parity claim, so a
// truncated or malformed download fails as "not valid JSON" rather than as a
// confusing field mismatch. No test in this file calls createShiplogExport() or
// reads an in-page variable.
//
// Determinism: fixed ids, fixed past timestamps, no network (the harness throws
// on an undeclared request), no sleeps — each page marks itself ready
// synchronously and every assertion waits on that state. Ids are prefixed
// `browsed-` so they cannot collide with another suite's storage during a
// parallel `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initShiplogExport } from "../src/shiplog-export.js";
import { initDecisionDetail } from "../src/decision-page.js";
import { initReleaseDetail } from "../src/release-page.js";
import { loadReleaseData } from "../src/releases-data.js";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { describeViolations } from "./support/export-parity.js";
import {
  exportedDecision,
  exportedRelease,
  idSetViolations,
  recordViolations,
  renderedDecision,
  renderedRelease,
} from "./support/browsed-record-parity.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const DECISION_DETAIL_PAGE = new URL("../src/decision.html", import.meta.url);
const RELEASE_DETAIL_PAGE = new URL("../src/release.html", import.meta.url);

// The example records are a module constant the pages compose in, not a fetch,
// so a history holding nothing but this file's fixtures hands every page an
// empty seed. tests/demo-path.test.js is the one that exercises the real seed.
const NO_DEMO_DATA = { decisions: [], releases: [] };

// --- the fixture -------------------------------------------------------------
//
// One set, defined once and reused by every test below, so the ids under
// assertion are the same all the way through. Five stored decisions and three
// stored releases, with four deliberately-shaped records among the ordinary
// ones:
//
//   * browsed-d-cache carries alternatives, and is the decision two different
//     releases shipped.
//   * browsed-d-queue carries alternatives: "" — genuinely empty, which is what
//     createDecision() writes when a recorder leaves the field blank. The detail
//     page renders no alternative cards at all for it and the file carries the
//     empty string, so this is the record where an over-eager normalizer would
//     quietly make two different things compare equal.
//   * browsed-d-legacy is stored under the retired status word "approved". Every
//     surface reads that as "accepted" while the file keeps the stored word, so
//     it is the one record whose status legitimately differs between the two
//     sides — and the only display rule the status comparison may apply.
//   * browsed-r-1-5-0 links two decisions, in an order that is not the order
//     they were recorded in and not alphabetical, so a comparison that sorted
//     the association list would stop proving anything.
//   * browsed-r-1-6-0 is stored with no `status` key at all. A release's status
//     is optional (src/releases.js: isRelease) and an import can legitimately
//     produce one, so this is where the data model genuinely represents "no
//     status": the row and the detail page show the documented display default
//     and the file carries no status field.
//
// The remaining records are ordinary, so the set is not entirely edge cases.

const DECISIONS = [
  {
    id: "browsed-d-cache",
    title: "Cache the read path",
    context: "Read latency spikes under load; add a short-TTL cache in front of the hot query.",
    alternatives: "Query tuning alone, which we had already tried twice.",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-02-01T09:00:00.000Z",
  },
  {
    id: "browsed-d-flags",
    title: "Introduce feature flags",
    context: "Decouple deploy from release so a bad rollout is a toggle, not a revert.",
    alternatives: "Long-lived release branches.",
    owner: "Priya",
    status: "pending",
    createdAt: "2026-02-02T09:00:00.000Z",
  },
  {
    // Alternatives genuinely empty: no cards render, and the file carries "".
    id: "browsed-d-queue",
    title: "Adopt a durable job queue",
    context: "Background work was lost on deploys; move to an at-least-once queue.",
    alternatives: "",
    owner: "Ari",
    status: "proposed",
    createdAt: "2026-02-03T09:00:00.000Z",
  },
  {
    id: "browsed-d-retention",
    title: "Shorten log retention",
    context: "Log storage cost grew faster than traffic.",
    alternatives: "Sampling at write time.",
    owner: "Jules",
    status: "accepted",
    createdAt: "2026-02-04T09:00:00.000Z",
  },
  {
    // Stored under the retired word; read as "accepted" everywhere it renders.
    id: "browsed-d-legacy",
    title: "Move the scheduler off cron",
    context: "Cron drift made the nightly report land at an unpredictable hour.",
    alternatives: "Keep cron and widen the report's window.",
    owner: "Jules",
    status: "approved",
    createdAt: "2026-02-05T09:00:00.000Z",
  },
];

// Not a decision the store will keep: an empty status is not one of the words a
// decision may hold (src/app.js: isDecision), so loadDecisions drops it. It is
// seeded anyway, because "the browse and the file drop the same record" is
// itself a parity claim worth asserting rather than assuming — see the test
// named for it below.
const UNSTORABLE_DECISION = {
  id: "browsed-d-no-status",
  title: "Rewrite the importer",
  context: "The importer predates the schema and nobody owns it.",
  alternatives: "Leave it and document the gap.",
  owner: "Ari",
  status: "",
  createdAt: "2026-02-06T09:00:00.000Z",
};

const RELEASES = [
  {
    id: "browsed-r-1-4-0",
    version: "v1.4.0",
    title: "Read path latency",
    description: "The read cache shipped.",
    owner: "Ari",
    status: "completed",
    createdAt: "2026-02-07T09:00:00.000Z",
    decisionIds: ["browsed-d-cache"],
  },
  {
    // Two decisions, in the order the release recorded them.
    id: "browsed-r-1-5-0",
    version: "v1.5.0",
    title: "Cache invalidation and flags",
    description: "Cache invalidation plus the first flagged rollout.",
    owner: "Priya",
    status: "planned",
    createdAt: "2026-02-08T09:00:00.000Z",
    decisionIds: ["browsed-d-flags", "browsed-d-cache"],
  },
  {
    // No `status` key at all.
    id: "browsed-r-1-6-0",
    version: "v1.6.0",
    title: "Dependency bumps",
    description: "Routine dependency maintenance.",
    owner: "Jules",
    createdAt: "2026-02-09T09:00:00.000Z",
    decisionIds: [],
  },
];

const STORED_DECISION_IDS = DECISIONS.map((decision) => decision.id);
const STORED_RELEASE_IDS = RELEASES.map((release) => release.id);
const TOTAL_RECORDS = DECISIONS.length + RELEASES.length;

const BROWSER = {
  [STORAGE_KEY]: JSON.stringify([...DECISIONS, UNSTORABLE_DECISION]),
  [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
};

// --- the pages ---------------------------------------------------------------

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
  return page;
}

async function openDecisionDetail(t, id) {
  const page = await loadPage(DECISION_DETAIL_PAGE, { storage: BROWSER, location: { search: `?id=${id}` } });
  t.after(() => page.restore());
  // The same empty seed the history gets, so this page shows the fixture and
  // nothing else.
  await initDecisionDetail({
    loadData: (storage) => loadReleaseData(storage, NO_DEMO_DATA),
    detailSeeds: [],
  });
  assert.equal(
    page.document.documentElement.dataset.shiplogDecisionDetail,
    "ready",
    `the decision detail page for ${id} never finished rendering`,
  );
  const container = page.document.querySelector("#decision-detail");
  assert.ok(
    container.querySelector(".decision-detail"),
    `the decision detail page for ${id} rendered no record — the browsed history offered a row the record page cannot open`,
  );
  return { page, container };
}

async function openReleaseDetail(t, id) {
  const page = await loadPage(RELEASE_DETAIL_PAGE, { storage: BROWSER, location: { search: `?id=${id}` } });
  t.after(() => page.restore());
  initReleaseDetail();
  assert.equal(
    page.document.documentElement.dataset.shiplogReleaseDetail,
    "ready",
    `the release detail page for ${id} never finished rendering`,
  );
  const container = page.document.querySelector("#release-detail");
  assert.ok(
    container.querySelector(".release-detail"),
    `the release detail page for ${id} rendered no record — the browsed history offered a row the record page cannot open`,
  );
  return { page, container };
}

// --- browsing and downloading -------------------------------------------------

const countText = (page) => textOf(page.document.querySelector("#decision-count"));

// What the reader can actually see, read off the rendered rows: each row is an
// anchor to its own record, so the id in the href is the row's identity.
function browsedIds(page) {
  const seen = { decisions: [], releases: [] };
  for (const card of page.document.querySelectorAll(".history-card")) {
    const href = new URL(card.getAttribute("href"), "https://labs.wawalu.org");
    const id = href.searchParams.get("id");
    assert.ok(id, `a history row links to ${href.pathname} with no record id`);
    seen[card.className.includes("release-card") ? "releases" : "decisions"].push(id);
  }
  return seen;
}

function chooseOption(page, selector, value) {
  const select = page.document.querySelector(selector);
  assert.ok(select, `the history has no ${selector} control`);
  select.value = value;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return select;
}

// Press the control a reader presses, then read back the bytes the browser
// would have written to disk. The parse is asserted here, before anything asks
// the payload a question, so a truncated download is reported as what it is.
function downloadExport(page) {
  const before = page.downloads.length;
  page.document.querySelector("#export-shiplog").click();
  assert.equal(page.downloads.length, before + 1, "the Download JSON control produced no download");

  const download = page.downloads.at(-1);
  assert.match(
    download.filename,
    /^shiplog-history-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/,
    "the exported filename shape changed",
  );
  assert.ok(
    typeof download.text === "string" && download.text.length > 0,
    "the download was delivered with no bytes at all",
  );
  try {
    return JSON.parse(download.text);
  } catch (error) {
    return assert.fail(
      `the downloaded file is not valid JSON (${error.message}). `
      + `It is ${download.text.length} bytes and starts ${JSON.stringify(download.text.slice(0, 80))}`,
    );
  }
}

function assertNoViolations(violations, headline) {
  assert.deepEqual(violations, [], describeViolations(headline, violations));
}

// --- set-level parity ---------------------------------------------------------

test("every record the browsed history shows is in the download, and nothing else is", async (t) => {
  const page = await openHistory(t);

  const browsed = browsedIds(page);
  // The browse really is showing the whole set — a listing that silently paged
  // would make the comparison below a comparison of first pages.
  assert.equal(
    countText(page),
    `${TOTAL_RECORDS} records`,
    "the unfiltered history does not report the whole fixture, so the id sets below would be partial",
  );
  assert.equal(
    browsed.decisions.length + browsed.releases.length,
    TOTAL_RECORDS,
    "the history rendered fewer rows than it counted",
  );

  const payload = downloadExport(page);
  assertNoViolations(
    idSetViolations(browsed.decisions, payload.decisions.map((record) => record.id), "decision"),
    "the browsed decisions and the downloaded decisions are not the same set:",
  );
  assertNoViolations(
    idSetViolations(browsed.releases, payload.releases.map((record) => record.id), "release"),
    "the browsed releases and the downloaded releases are not the same set:",
  );
});

// --- field-level parity, rendered record against exported record --------------

test("each browsed decision's detail page and its exported record agree field for field", async (t) => {
  const payload = downloadExport(await openHistory(t));
  const exportedById = new Map(payload.decisions.map((record) => [record.id, record]));

  const violations = [];
  for (const id of STORED_DECISION_IDS) {
    const exported = exportedById.get(id);
    assert.ok(exported, `record ${JSON.stringify(id)} is browsable but absent from the export`);
    const { container } = await openDecisionDetail(t, id);
    violations.push(...recordViolations(id, renderedDecision(container), exportedDecision(exported)));
  }
  assertNoViolations(violations, "a decision reads differently on screen and in the downloaded file:");
});

test("each browsed release's detail page and its exported record agree, links included", async (t) => {
  const payload = downloadExport(await openHistory(t));
  const exportedById = new Map(payload.releases.map((record) => [record.id, record]));

  const violations = [];
  for (const id of STORED_RELEASE_IDS) {
    const exported = exportedById.get(id);
    assert.ok(exported, `record ${JSON.stringify(id)} is browsable but absent from the export`);
    const { container } = await openReleaseDetail(t, id);
    violations.push(...recordViolations(id, renderedRelease(container), exportedRelease(exported)));
  }
  assertNoViolations(violations, "a release reads differently on screen and in the downloaded file:");

  // The association order the comparison above enforces is a real order and not
  // an accident of sorting: the release that links two decisions lists them
  // newest-recorded first, which is neither the order the decisions were
  // recorded in nor alphabetical.
  const twoLinked = payload.releases.find((release) => release.id === "browsed-r-1-5-0");
  assert.deepEqual(
    twoLinked.decisionIds,
    ["browsed-d-flags", "browsed-d-cache"],
    "the release linking two decisions lost an association or reordered them in the file",
  );
});

// --- the deliberately-shaped records ------------------------------------------

test("an empty alternatives list and an absent release status survive the round trip as themselves", async (t) => {
  const payload = downloadExport(await openHistory(t));

  // Empty stays empty on both sides: no alternative cards on screen, an empty
  // string in the file. Neither side invents a placeholder.
  const { container } = await openDecisionDetail(t, "browsed-d-queue");
  assert.deepEqual(
    container.querySelectorAll(".alternative-summary").map(textOf),
    [],
    "the decision recorded with no alternatives rendered an alternative anyway",
  );
  assert.equal(
    textOf(container.querySelector(".detail-empty-copy")),
    "No alternatives were recorded for this decision.",
    "the empty alternatives state is no longer stated on the record",
  );
  assert.equal(
    payload.decisions.find((record) => record.id === "browsed-d-queue").alternatives,
    "",
    "the export turned an empty alternatives field into something else",
  );

  // A release the store holds no status for: the page shows the documented
  // display default, the file carries no status key. Both are pinned here in the
  // open, so the normalization that lets them compare equal cannot quietly grow
  // to cover a status that really did drift.
  const release = await openReleaseDetail(t, "browsed-r-1-6-0");
  assert.equal(
    textOf(release.container.querySelectorAll(".detail-meta-row")
      .find((row) => textOf(row.querySelector(".detail-meta-label")) === "Status")
      .querySelector(".detail-meta-value")),
    "completed",
    "the display default for a release with no stored status changed",
  );
  assert.equal(
    Object.hasOwn(payload.releases.find((record) => record.id === "browsed-r-1-6-0"), "status"),
    false,
    "the export invented a status for a release whose store holds none",
  );
});

test("a decision the store refuses is missing from the browse and from the export alike", async (t) => {
  const page = await openHistory(t);
  const browsed = browsedIds(page);
  const payload = downloadExport(page);

  // An empty status is not a status a decision may hold, so this record is not
  // in the log at all. What matters for parity is that both sides agree about
  // that: a record dropped from the list but written to the file would put a
  // record into an audit that nobody could review on screen.
  assert.ok(
    !browsed.decisions.includes(UNSTORABLE_DECISION.id),
    "a decision with an empty status is being browsed as though it were a record",
  );
  assertNoViolations(
    idSetViolations(browsed.decisions, payload.decisions.map((record) => record.id), "decision"),
    "the browse and the export disagree about the decision the store refuses:",
  );
});

// --- a filtered browse must not truncate the whole-history download ------------
//
// The shipped contract, documented in src/shiplog-export.js: the button follows
// the browsed history by default — a reader who narrowed to two records and
// pressed Download JSON should not receive the five they filtered away — and the
// scope control beside it is how PRODUCT.md's "Export all records as JSON" stays
// reachable. So "a filter cannot truncate the export" is asserted where the
// product makes that promise: with the filter still applied, the whole-history
// scope hands back the complete set, id for id and field for field.

async function assertWholeHistorySurvives(t, { control, value, expected }) {
  const page = await openHistory(t);
  const unfiltered = downloadExport(page);
  const before = browsedIds(page);

  chooseOption(page, control, value);
  const after = browsedIds(page);
  const narrowed = [...after.decisions, ...after.releases];
  const all = [...before.decisions, ...before.releases];

  // The filter must actually narrow the list, or every assertion after this one
  // passes without proving anything.
  assert.deepEqual(
    narrowed.toSorted(),
    expected.toSorted(),
    `the ${control} filter set to ${JSON.stringify(value)} shows the wrong rows`,
  );
  assert.ok(
    narrowed.length > 0 && narrowed.length < all.length,
    `the ${control} filter set to ${JSON.stringify(value)} did not narrow the browsed history`,
  );

  // With the filter still applied, ask for the whole history.
  chooseOption(page, "#export-shiplog-scope", "stored");
  const complete = downloadExport(page);

  assertNoViolations(
    idSetViolations(before.decisions, complete.decisions.map((record) => record.id), "decision"),
    `a ${control} filter truncated the whole-history export's decisions:`,
  );
  assertNoViolations(
    idSetViolations(before.releases, complete.releases.map((record) => record.id), "release"),
    `a ${control} filter truncated the whole-history export's releases:`,
  );
  // Same records is not enough: the values have to be the same values too.
  assert.deepEqual(
    complete.decisions,
    unfiltered.decisions,
    `a ${control} filter changed the decision fields the whole-history export carries`,
  );
  assert.deepEqual(
    complete.releases,
    unfiltered.releases,
    `a ${control} filter changed the release fields the whole-history export carries`,
  );
  return page;
}

test("a browse filtered by status still exports the whole history when asked for it", async (t) => {
  await assertWholeHistorySurvives(t, {
    control: "#filter-status",
    value: "accepted",
    // browsed-d-legacy is stored as "approved" and is reached by this filter,
    // which is the only word for that state now.
    expected: ["browsed-d-cache", "browsed-d-retention", "browsed-d-legacy"],
  });
});

test("a browse filtered by owner still exports the whole history when asked for it", async (t) => {
  await assertWholeHistorySurvives(t, {
    control: "#filter-owner",
    value: "Priya",
    expected: ["browsed-d-flags", "browsed-r-1-5-0"],
  });
});

// --- the checkers themselves --------------------------------------------------
//
// The failure text is an acceptance criterion, so it is asserted rather than
// assumed. Each mutation is made on an in-memory copy of a real export; the
// application is untouched and every test above still runs against real
// behaviour.

test("a drifted field fails with the record, the field, and both values named", async (t) => {
  const payload = downloadExport(await openHistory(t));
  const { container } = await openDecisionDetail(t, "browsed-d-cache");

  const exported = structuredClone(payload.decisions.find((record) => record.id === "browsed-d-cache"));
  exported.owner = "Jules";
  const violations = recordViolations("browsed-d-cache", renderedDecision(container), exportedDecision(exported));

  assert.deepEqual(violations, [
    'record "browsed-d-cache": field owner differs — browsed "Ari", exported "Jules"',
  ], "a drifted owner no longer fails with the record, the field, and both values");
});

test("a dropped alternative and a reordered association each fail as a collection", async (t) => {
  const payload = downloadExport(await openHistory(t));
  const decision = await openDecisionDetail(t, "browsed-d-cache");
  const release = await openReleaseDetail(t, "browsed-r-1-5-0");

  const strippedAlternatives = { ...payload.decisions.find((record) => record.id === "browsed-d-cache"), alternatives: "" };
  assert.deepEqual(
    recordViolations("browsed-d-cache", renderedDecision(decision.container), exportedDecision(strippedAlternatives)),
    [
      'record "browsed-d-cache": field alternatives differs — '
      + 'browsed ["Query tuning alone, which we had already tried twice."], exported []',
    ],
    "a dropped alternative does not fail as a collection with both sides named",
  );

  const reordered = payload.releases.find((record) => record.id === "browsed-r-1-5-0");
  const flipped = { ...reordered, decisionIds: [...reordered.decisionIds].reverse() };
  assert.deepEqual(
    recordViolations("browsed-r-1-5-0", renderedRelease(release.container), exportedRelease(flipped)),
    [
      'record "browsed-r-1-5-0": field decisionIds differs — '
      + 'browsed ["browsed-d-flags","browsed-d-cache"], exported ["browsed-d-cache","browsed-d-flags"]',
    ],
    "a reordered association list does not fail with the two orders named",
  );
});

test("a record on only one side is named, with the side it is missing from", async (t) => {
  const browsed = ["browsed-d-cache", "browsed-d-flags"];

  assert.deepEqual(
    idSetViolations(browsed, ["browsed-d-cache"], "decision"),
    ['1 decision(s) missing from the export that the browsed history shows: ["browsed-d-flags"]'],
    "a record the export dropped is not named, or the side is not stated",
  );
  assert.deepEqual(
    idSetViolations(browsed, [...browsed, "browsed-d-smuggled"], "decision"),
    ['1 decision(s) missing from the browsed history that the export carries: ["browsed-d-smuggled"]'],
    "a record only the export holds is not named, or the side is not stated",
  );
  assert.deepEqual(
    idSetViolations(browsed, [...browsed, "browsed-d-cache"], "decision"),
    ['decision "browsed-d-cache" appears 2 times in the export, expected exactly once'],
    "a record written twice into the export is not reported",
  );
});
