// Record-for-record regression for the Shiplog JSON export.
//
// The claim under test: what the export hands back contains every record the
// visitor can see in the history, once each, with the same owner, status, and
// decision<->release links — and nothing else.
//
// Every test drives the shipped decisions page (src/index.html booted the way
// the page boots it: app.js, then shiplog-export-page.js) and captures the file
// through the browser boundary the harness models — the export builds a Blob,
// hands it to URL.createObjectURL, and clicks an anchor with a download
// attribute; the harness records the anchor activation and the blob's text.
// That is the same seam a real download uses, so the wiring between the button
// and the data is exercised rather than the serializer alone. No test here
// calls createShiplogExport() to produce an assertion.
//
// Determinism: fixed ids, fixed past timestamps, no network (the harness throws
// on an undeclared request), no sleeps — the page marks itself ready
// synchronously and every assertion waits on that state. The fixture ids are
// prefixed `parity-` so they cannot collide with another suite's storage or
// fixtures during a parallel `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { initShiplogExport } from "../src/shiplog-export.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { DomEvent, loadPage, pressEnter, pressSpace, textOf } from "./support/browser.js";
import {
  describeViolations,
  parityViolations,
  shapeViolations,
  SHIPLOG_EXPORT_SHAPE,
} from "./support/export-parity.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
// The example records are a module constant the page composes in, so a test
// that wants a history holding only its own fixtures hands the page an empty
// seed. The one test that cares about examples passes its own.
const NO_DEMO_DATA = { decisions: [], releases: [] };

// --- the fixture -----------------------------------------------------------
//
// Four decisions across three owners and three statuses, and three releases:
// one decision carries two releases, two decisions carry none, and one release
// links no decision at all. Statuses are stored in canonical form, so the word
// the row shows and the word the export carries are the same word (the legacy
// "approved" spelling is covered by tests/history-e2e.test.js).

const DECISIONS = [
  {
    id: "parity-d-cache",
    title: "Cache the read path",
    context: "Read latency spikes under load; add a short-TTL cache.",
    alternatives: "Query tuning alone.",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-01-05T09:00:00.000Z",
  },
  {
    id: "parity-d-flags",
    title: "Introduce feature flags",
    context: "Decouple deploy from release.",
    alternatives: "Long-lived release branches.",
    owner: "Priya",
    status: "pending",
    createdAt: "2026-01-04T09:00:00.000Z",
  },
  {
    id: "parity-d-queue",
    title: "Adopt a durable job queue",
    context: "Background work was lost on deploys.",
    alternatives: "Database polling and in-process retries.",
    owner: "Ari",
    status: "proposed",
    createdAt: "2026-01-03T09:00:00.000Z",
  },
  {
    id: "parity-d-retention",
    title: "Shorten log retention",
    context: "Log storage cost grew faster than traffic.",
    alternatives: "Sampling at write time.",
    owner: "Jules",
    status: "accepted",
    createdAt: "2026-01-02T09:00:00.000Z",
  },
];

const RELEASES = [
  {
    id: "parity-r-1-4-0",
    version: "v1.4.0",
    title: "Read path latency",
    description: "The read cache shipped.",
    owner: "Ari",
    status: "completed",
    createdAt: "2026-01-06T09:00:00.000Z",
    decisionIds: ["parity-d-cache"],
  },
  {
    // The same decision, shipped twice: one decision with more than one release.
    id: "parity-r-1-5-0",
    version: "v1.5.0",
    title: "Cache invalidation and flags",
    description: "Cache invalidation plus the first flagged rollout.",
    owner: "Priya",
    status: "completed",
    createdAt: "2026-01-07T09:00:00.000Z",
    decisionIds: ["parity-d-cache", "parity-d-flags"],
  },
  {
    // A release that names no decision: the association arrays must survive as
    // empty rather than being dropped or back-filled.
    id: "parity-r-1-6-0",
    version: "v1.6.0",
    title: "Dependency bumps",
    description: "Routine dependency maintenance.",
    owner: "Jules",
    status: "planned",
    createdAt: "2026-01-08T09:00:00.000Z",
    decisionIds: [],
  },
];

const EXAMPLE_DECISION = {
  id: "parity-example-decision",
  title: "Example: split the monolith",
  context: "An example record shipped with the product.",
  alternatives: "Keep the monolith.",
  owner: "Shiplog",
  status: "proposed",
  createdAt: "2026-01-01T09:00:00.000Z",
};

const EXAMPLE_RELEASE = {
  id: "parity-example-release",
  version: "v0.9.0",
  title: "Example release",
  description: "An example record shipped with the product.",
  owner: "Shiplog",
  status: "completed",
  createdAt: "2026-01-01T10:00:00.000Z",
  decisionIds: ["parity-example-decision"],
};

const TOTAL_RECORDS = DECISIONS.length + RELEASES.length;

// --- the page --------------------------------------------------------------

async function openHistory(t, { decisions = DECISIONS, releases = RELEASES, demo = NO_DEMO_DATA } = {}) {
  const page = await loadPage(DECISIONS_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  // The two module scripts src/index.html loads, in page order.
  await initDecisionLog(page.document, page.storage, { seed: demo });
  initShiplogExport(page.document, page.storage);
  // Wait on state, not on time: the page marks itself ready once the history
  // has rendered.
  assert.equal(
    page.document.documentElement.dataset.shiplog,
    "ready",
    "the history never finished rendering",
  );
  return page;
}

const countText = (page) => textOf(page.document.querySelector("#decision-count"));

// What the visitor can actually see, read back off the rendered rows: each row
// is an anchor to its own record, so the id in the href is the row's identity.
function visibleIds(page) {
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

// Click the control the visitor clicks and read back the file the browser would
// have written to disk.
function exportFromPage(page) {
  const before = page.downloads.length;
  page.document.querySelector("#export-shiplog").click();
  assert.equal(page.downloads.length, before + 1, "the export button produced no download");
  const download = page.downloads.at(-1);
  assert.match(
    download.filename,
    /^shiplog-history-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/,
    "the exported filename shape changed",
  );
  return JSON.parse(download.text);
}

function assertParity(expected, payload, headline) {
  const violations = parityViolations(expected, payload);
  assert.deepEqual(violations, [], describeViolations(headline, violations));
}

// --- parity ----------------------------------------------------------------

test("the export carries every record the visitor can see, exactly once", async (t) => {
  const page = await openHistory(t);

  // First: the fixture really is what the page shows. Sorted id sets on both
  // sides, so row order is never silently load-bearing.
  const visible = visibleIds(page);
  assert.deepEqual(
    visible.decisions.toSorted(),
    DECISIONS.map((decision) => decision.id).toSorted(),
    "the history does not show the seeded decisions",
  );
  assert.deepEqual(
    visible.releases.toSorted(),
    RELEASES.map((release) => release.id).toSorted(),
    "the history does not show the seeded releases",
  );
  assert.equal(countText(page), `${TOTAL_RECORDS} records`, "the history counts the wrong number of records");

  // Then: the export matches it record for record — ids both ways, and per
  // record the title, context, alternatives, owner, status, and createdAt.
  const payload = exportFromPage(page);
  assertParity(
    { decisions: DECISIONS, releases: RELEASES },
    payload,
    "the export does not match the history the visitor is browsing:",
  );
});

test("every decision-release association survives the export, and none is invented", async (t) => {
  const page = await openHistory(t);
  const payload = exportFromPage(page);

  const linksById = new Map(payload.releases.map((release) => [release.id, release.decisionIds]));
  assert.deepEqual(
    linksById.get("parity-r-1-4-0"),
    ["parity-d-cache"],
    "the single-decision release lost its association",
  );
  assert.deepEqual(
    linksById.get("parity-r-1-5-0"),
    ["parity-d-cache", "parity-d-flags"],
    "the release linking two decisions lost an association or reordered them",
  );
  assert.deepEqual(
    linksById.get("parity-r-1-6-0"),
    [],
    "a release that names no decision came back with associations it never had",
  );

  // Every id an exported release points at is a decision in the same file, so a
  // restored export can never contain a dangling link.
  const exportedDecisions = new Set(payload.decisions.map((decision) => decision.id));
  const dangling = payload.releases
    .flatMap((release) => release.decisionIds.map((id) => `${release.id} -> ${id}`))
    .filter((link) => !exportedDecisions.has(link.split(" -> ")[1]));
  assert.deepEqual(dangling, [], "the export points at decisions it does not contain");

  // The decisions with no release keep no association of their own: the link
  // lives on the release side only, and nothing back-fills it.
  const decisionsWithReleases = new Set(payload.releases.flatMap((release) => release.decisionIds));
  assert.deepEqual(
    payload.decisions.map((decision) => decision.id).filter((id) => !decisionsWithReleases.has(id)).toSorted(),
    ["parity-d-queue", "parity-d-retention"],
    "the decisions that never shipped are not the ones the fixture left unreleased",
  );
});

test("an empty account exports an empty history rather than nothing at all", async (t) => {
  const page = await openHistory(t, { decisions: [], releases: [] });

  const payload = exportFromPage(page);
  assertParity({ decisions: [], releases: [] }, payload, "an empty account's export is not empty:");
  assert.deepEqual(shapeViolations(payload), [], "an empty export lost its envelope");
  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-status")),
    "Shiplog history exported.",
    "an empty account was told its export failed",
  );
});

// --- what the export leaves out, and whether the visitor is told ------------

test("example records the visitor can see are left out of the export, and the panel says so", async (t) => {
  const page = await openHistory(t, {
    demo: { decisions: [EXAMPLE_DECISION], releases: [EXAMPLE_RELEASE] },
  });

  // The visitor sees their own records *and* the badged examples...
  const visible = visibleIds(page);
  assert.ok(visible.decisions.includes(EXAMPLE_DECISION.id), "the example decision is not on the page");
  assert.ok(visible.releases.includes(EXAMPLE_RELEASE.id), "the example release is not on the page");

  // ...but the export is a strict subset of that: the visitor's own records
  // only. This is the export's stated scope, not a leak in either direction.
  const payload = exportFromPage(page);
  assertParity(
    { decisions: DECISIONS, releases: RELEASES },
    payload,
    "the export does not hold exactly the visitor's own records:",
  );
  const exportedIds = new Set([...payload.decisions, ...payload.releases].map((record) => record.id));
  const visibleAll = [...visible.decisions, ...visible.releases];
  assert.ok(
    visibleAll.some((id) => !exportedIds.has(id)),
    "this fixture no longer exercises the strict-subset case",
  );
  assert.deepEqual(
    visibleAll.filter((id) => !exportedIds.has(id)).toSorted(),
    [EXAMPLE_DECISION.id, EXAMPLE_RELEASE.id].toSorted(),
    "the export left out a record that is the visitor's own, or included an example",
  );

  // The scope is stated on the panel next to the button, in the visitor's own
  // numbers, so the smaller file is not a surprise after the download.
  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-counts")),
    `Ready to export ${DECISIONS.length} decisions and ${RELEASES.length} releases stored in this browser.`,
    "the export panel no longer states how many records it will write",
  );
});

// The resolved contract, replacing a pinned "everything, always" and the todo
// that contradicted it: the file follows the browsed history, and PRODUCT.md's
// "Export all records as JSON" stays reachable through the panel's own scope
// control rather than being the only behaviour. A visitor who narrowed the
// history to two records and pressed Download JSON now gets two, and the count
// above the button says so before they press it.
test("the export follows the history the visitor is browsing", async (t) => {
  const page = await openHistory(t);

  // Narrow the browsed history to a strict subset: two of the four decisions.
  chooseOption(page, "#filter-status", "accepted");
  const visible = visibleIds(page);
  assert.deepEqual(
    visible.decisions.toSorted(),
    ["parity-d-cache", "parity-d-retention"],
    "the accepted status filter shows the wrong rows",
  );
  assert.deepEqual(visible.releases, [], "the status filter left releases in the history");
  assert.equal(countText(page), `2 of ${TOTAL_RECORDS} records`, "the filtered count is wrong");

  // The panel restates the file in the filtered numbers before the download, so
  // the smaller file is never a surprise either.
  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-counts")),
    "Ready to export 2 decisions and 0 releases matching your history filters.",
    "the export panel does not tell a filtered visitor how many records the file will hold",
  );

  const payload = exportFromPage(page);
  assertParity(
    {
      decisions: DECISIONS.filter((decision) => decision.status === "accepted"),
      releases: [],
    },
    payload,
    "the export does not follow the filtered history:",
  );
  assert.deepEqual(shapeViolations(payload), [], "a filtered export lost its envelope");
});

test("a filtered visitor can still export every stored record, and the panel states that count", async (t) => {
  const page = await openHistory(t);
  chooseOption(page, "#filter-status", "accepted");

  // The other scope, chosen deliberately through the control beside the button.
  chooseOption(page, "#export-shiplog-scope", "stored");
  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-counts")),
    `Ready to export ${DECISIONS.length} decisions and ${RELEASES.length} releases stored in this browser.`,
    "choosing the whole-history scope does not restate the full count",
  );

  const payload = exportFromPage(page);
  assertParity(
    { decisions: DECISIONS, releases: RELEASES },
    payload,
    "the whole-history scope no longer exports the whole stored history:",
  );
});

test("a filtered export keeps its links resolvable and says which links it left out", async (t) => {
  const page = await openHistory(t);

  // v1.5.0 links two decisions; the owner filter keeps the release and hides one
  // of them, which is the case where a filtered file could go dangling.
  chooseOption(page, "#filter-owner", "Priya");
  const visible = visibleIds(page);
  assert.deepEqual(visible.releases, ["parity-r-1-5-0"], "the owner filter shows the wrong releases");
  assert.deepEqual(visible.decisions, ["parity-d-flags"], "the owner filter shows the wrong decisions");

  const payload = exportFromPage(page);
  assertParity(
    {
      decisions: DECISIONS.filter((decision) => decision.owner === "Priya"),
      releases: [{ ...RELEASES[1], decisionIds: ["parity-d-flags"] }],
    },
    payload,
    "the filtered export does not hold exactly the browsed records:",
  );

  // The dropped link is reported as hidden, not as missing from the browser: the
  // decision is still there and clearing the filter brings the link back.
  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-status")),
    "Exported 2 filtered records. 1 release link to a decision your filters hide was left out.",
    "the filtered export does not say what it wrote and which link it left out, or blames the wrong cause",
  );
});

// --- shape -----------------------------------------------------------------

test("the export matches the pinned envelope, decision, and release shape", async (t) => {
  const page = await openHistory(t);
  const payload = exportFromPage(page);

  const violations = shapeViolations(payload);
  assert.deepEqual(violations, [], describeViolations("the exported JSON drifted from its pinned shape:", violations));

  assert.equal(payload.schema, "shiplog-history", "the export schema name changed");
  assert.equal(payload.version, 1, "the export version changed");
  assert.ok(
    !Number.isNaN(Date.parse(payload.generatedAt)),
    "the export is missing a parseable generatedAt stamp",
  );
});

// --- the checkers themselves ------------------------------------------------
//
// Proof that the two checkers above would actually fail on drift. Each mutation
// is made on an in-memory copy of a real export; the application is untouched
// and the e2e tests above still run for real.

async function goodPayload(t) {
  return exportFromPage(await openHistory(t));
}

test("the parity check rejects an export with a record removed, and names it", async (t) => {
  const payload = await goodPayload(t);
  const mutated = structuredClone(payload);
  mutated.decisions = mutated.decisions.filter((decision) => decision.id !== "parity-d-flags");

  const violations = parityViolations({ decisions: DECISIONS, releases: RELEASES }, mutated);
  assert.ok(violations.length > 0, "a dropped decision passed the parity check");
  assert.ok(
    violations.some((violation) => violation.includes("export.decisions: missing 1 record(s)")
      && violation.includes("parity-d-flags")),
    `the parity failure does not name the missing record: ${violations.join(" | ")}`,
  );
});

test("the parity check rejects an extra record, a duplicate, and an invented association", async (t) => {
  const payload = await goodPayload(t);
  const mutated = structuredClone(payload);
  mutated.decisions.push({ ...mutated.decisions[0], id: "parity-d-smuggled" });
  mutated.decisions.push(structuredClone(mutated.decisions[0]));
  mutated.releases.find((release) => release.id === "parity-r-1-6-0").decisionIds = ["parity-d-cache"];

  const violations = parityViolations({ decisions: DECISIONS, releases: RELEASES }, mutated);
  assert.ok(
    violations.some((violation) => violation.includes("extra record(s)") && violation.includes("parity-d-smuggled")),
    `the parity failure does not name the extra record: ${violations.join(" | ")}`,
  );
  assert.ok(
    violations.some((violation) => violation.includes("appears 2 times")
      && violation.includes(mutated.decisions[0].id)),
    `the parity failure does not name the duplicated record: ${violations.join(" | ")}`,
  );
  assert.ok(
    violations.some((violation) => violation.includes("spurious association")
      && violation.includes("parity-r-1-6-0") && violation.includes("parity-d-cache")),
    `the parity failure does not name the invented association: ${violations.join(" | ")}`,
  );
});

test("the parity check rejects a changed owner or status, and names the field", async (t) => {
  const payload = await goodPayload(t);
  const mutated = structuredClone(payload);
  mutated.decisions.find((decision) => decision.id === "parity-d-cache").owner = "Somebody else";
  mutated.releases.find((release) => release.id === "parity-r-1-4-0").status = "cancelled";

  const violations = parityViolations({ decisions: DECISIONS, releases: RELEASES }, mutated);
  assert.ok(
    violations.some((violation) => violation.includes('export.decisions[id="parity-d-cache"].owner')
      && violation.includes('expected "Ari"')),
    `the parity failure does not name the changed owner: ${violations.join(" | ")}`,
  );
  assert.ok(
    violations.some((violation) => violation.includes('export.releases[id="parity-r-1-4-0"].status')),
    `the parity failure does not name the changed status: ${violations.join(" | ")}`,
  );
});

test("the shape check rejects a renamed field, and names both the old and new name", async (t) => {
  const payload = await goodPayload(t);
  const mutated = structuredClone(payload);
  const [first] = mutated.decisions;
  first.decisionOwner = first.owner;
  delete first.owner;

  const violations = shapeViolations(mutated);
  assert.ok(
    violations.includes('export.decisions[0]: missing field "owner"'),
    `the shape failure does not name the dropped field: ${violations.join(" | ")}`,
  );
  assert.ok(
    violations.some((violation) => violation.includes('unexpected field "decisionOwner"')),
    `the shape failure does not name the field that replaced it: ${violations.join(" | ")}`,
  );
});

test("the shape check rejects a retyped field and a broken envelope, and names them", async (t) => {
  const payload = await goodPayload(t);
  const mutated = structuredClone(payload);
  mutated.decisions[0].status = 3;
  mutated.releases[0].decisionIds = [7];
  delete mutated.schema;
  mutated.version = "1";

  const violations = shapeViolations(mutated);
  for (const expected of [
    "export.decisions[0].status: expected string, got number",
    "export.releases[0].decisionIds[0]: expected string, got number",
    'export: missing field "schema"',
    "export.version: expected number, got string",
  ]) {
    assert.ok(
      violations.includes(expected),
      `the shape failure does not report "${expected}": ${violations.join(" | ")}`,
    );
  }
});

test("the pinned shape covers every field the export actually writes", async (t) => {
  const payload = await goodPayload(t);

  // A field that appears in a real export but not in the pinned shape would
  // otherwise be invisible to this suite forever.
  assert.deepEqual(
    Object.keys(payload).toSorted(),
    Object.keys(SHIPLOG_EXPORT_SHAPE.envelope).toSorted(),
    "the export envelope has fields the pinned shape does not declare (or vice versa)",
  );
  for (const kind of ["decisions", "releases"]) {
    for (const record of payload[kind]) {
      const undeclared = Object.keys(record).filter((field) => !(field in SHIPLOG_EXPORT_SHAPE[kind]));
      assert.deepEqual(undeclared, [], `export.${kind} writes fields the pinned shape does not declare`);
    }
  }
});

// --- the envelope a filtered file carries ----------------------------------
//
// The claim under test: the file says how many records it holds and which
// filter produced them, and both agree with what the visitor was looking at
// when they pressed the button. The count is asserted against the *rendered
// rows*, not against a second filter run — that is the drift these tests exist
// to catch, and it is why the exporter follows the ids the history published
// rather than re-deriving a selection of its own.

// Set a control the visitor types into (search, a date bound) and let the page
// react the way it does for a person: value, then the event the page binds.
function setControl(page, selector, value) {
  const control = page.document.querySelector(selector);
  assert.ok(control, `the history has no ${selector} control`);
  control.value = value;
  control.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return control;
}

// How many rows the visitor can actually see, counted off the rendered list.
function visibleCount(page) {
  const seen = visibleIds(page);
  return seen.decisions.length + seen.releases.length;
}

const exportButton = (page) => page.document.querySelector("#export-shiplog");

test("a filtered file states the filter that produced it and counts its own records", async (t) => {
  const page = await openHistory(t);

  // Dimension one: status.
  chooseOption(page, "#filter-status", "accepted");
  let payload = exportFromPage(page);
  assert.deepEqual(payload.filter, { status: "accepted" }, "the file names the wrong filter");
  assert.equal(payload.record_count, visibleCount(page), "the exported count is not the rendered count");
  assert.equal(payload.record_count, payload.decisions.length + payload.releases.length);
  assert.equal(countText(page), `${payload.record_count} of ${TOTAL_RECORDS} records`);

  // Dimension two: owner. Chosen after clearing the first, so the block is a
  // statement about the current view and never accumulates a stale dimension.
  chooseOption(page, "#filter-status", "all");
  chooseOption(page, "#filter-owner", "Ari");
  payload = exportFromPage(page);
  assert.deepEqual(payload.filter, { owner: "Ari" });
  assert.equal(payload.record_count, visibleCount(page), "the exported count is not the rendered count");

  // Combined: owner and a date window together, which is where a second filter
  // implementation would most easily disagree with the first.
  setControl(page, "#filter-from", "2026-01-04");
  setControl(page, "#filter-to", "2026-01-07");
  payload = exportFromPage(page);
  assert.deepEqual(payload.filter, { owner: "Ari", from: "2026-01-04", to: "2026-01-07" });
  assert.equal(payload.record_count, visibleCount(page), "the combined filter exported the wrong count");
  assert.deepEqual(shapeViolations(payload), [], "a filtered export lost its envelope");
});

test("a search filter rides in the block as the text the visitor typed", async (t) => {
  const page = await openHistory(t);
  setControl(page, "#decision-search", "cache");

  const payload = exportFromPage(page);
  assert.deepEqual(payload.filter, { query: "cache" });
  assert.equal(payload.record_count, visibleCount(page));
});

test("an unfiltered file carries an empty filter block and the whole history", async (t) => {
  const page = await openHistory(t);
  const payload = exportFromPage(page);

  // `{}` is the only thing a file says to mean "no filter was active": no key
  // is written as null, "", or "all", so a reader needs no sentinel table.
  assert.deepEqual(payload.filter, {}, "an unfiltered file claims a filter");
  assert.equal(payload.record_count, TOTAL_RECORDS);
  assert.equal(payload.record_count, visibleCount(page));
  // One level in, the arrays are exactly the pre-existing full export: a
  // consumer that reads payload.decisions/payload.releases keeps working.
  assertParity({ decisions: DECISIONS, releases: RELEASES }, payload, "the unfiltered export changed:");
});

test("a filter matching nothing still downloads a valid, explicitly empty file", async (t) => {
  const page = await openHistory(t);
  setControl(page, "#decision-search", "no record says this");
  assert.equal(visibleCount(page), 0, "the fixture accidentally matches this search");

  // Nothing short-circuits: a zero-result export is a file the visitor asked
  // for, and a button that silently does nothing reads as broken.
  const payload = exportFromPage(page);
  assert.equal(payload.record_count, 0);
  assert.deepEqual(payload.decisions, []);
  assert.deepEqual(payload.releases, []);
  assert.deepEqual(payload.filter, { query: "no record says this" });
  assert.deepEqual(shapeViolations(payload), [], "the empty filtered file is not a whole export");
  assert.equal(exportButton(page).disabled, false, "the export control was disabled at zero results");
  assert.equal(
    exportButton(page).getAttribute("aria-label"),
    "Download JSON: export 0 filtered records",
    "the control does not say it will write an empty file",
  );
  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-status")),
    "Exported 0 filtered records.",
    "the empty export was not announced",
  );
});

test("the export control names its filtered scope and is operable from the keyboard", async (t) => {
  const page = await openHistory(t);
  const button = exportButton(page);

  // Unfiltered, the visible label is the whole name: nothing is added that
  // could go stale, and the sentence beside the button already says the rest.
  assert.equal(button.tagName, "BUTTON", "the export control is not a native button");
  assert.equal(button.getAttribute("aria-label"), null, "an unfiltered export names a scope it does not have");

  chooseOption(page, "#filter-status", "accepted");
  assert.equal(
    button.getAttribute("aria-label"),
    "Download JSON: export 2 filtered records",
    "the accessible name does not describe the filtered scope",
  );

  // Clearing the filter takes the name with it rather than leaving the old
  // count on a button that now writes the whole history.
  chooseOption(page, "#filter-status", "all");
  assert.equal(button.getAttribute("aria-label"), null, "the accessible name outlived the filter");

  chooseOption(page, "#filter-owner", "Ari");
  const before = page.downloads.length;
  button.focus();
  assert.equal(page.document.activeElement, button, "the export control cannot take focus");
  pressEnter(page.document);
  pressSpace(page.document);
  assert.equal(page.downloads.length, before + 2, "Enter and Space do not both activate the export control");
  assert.equal(
    textOf(page.document.querySelector("#export-shiplog-status")),
    `Exported ${visibleCount(page)} filtered records.`,
    "a keyboard-activated export announced the wrong thing",
  );
});

test("record text survives the export byte for byte, however it is punctuated", async (t) => {
  // Every character a serializer that built JSON by concatenation, or a view
  // that routed a value through innerHTML, would mangle.
  const hostile = {
    id: "parity-d-hostile",
    title: `<script>alert("x")</script> & 'quotes' "both" \\backslash\\`,
    context: "A </div> in the context, plus a tab\tand a newline\nand <b>markup</b>.",
    alternatives: "5 > 3 && 3 < 5",
    owner: "O'Brien & Co <ops>",
    status: "accepted",
    createdAt: "2026-01-09T09:00:00.000Z",
  };
  const page = await openHistory(t, { decisions: [...DECISIONS, hostile], releases: RELEASES });

  const payload = exportFromPage(page);
  const exported = payload.decisions.find((decision) => decision.id === hostile.id);
  assert.deepEqual(exported, hostile, "the record did not round-trip through the file unchanged");

  // And it still round-trips once a filter has narrowed the file to it alone.
  chooseOption(page, "#filter-owner", hostile.owner);
  const filtered = exportFromPage(page);
  assert.deepEqual(filtered.decisions, [hostile]);
  assert.deepEqual(filtered.filter, { owner: hostile.owner });
  assert.equal(filtered.record_count, visibleCount(page));
});
