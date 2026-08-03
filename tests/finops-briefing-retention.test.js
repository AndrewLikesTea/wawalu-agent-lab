// Opt-in local retention for the AI FinOps import result (#959), driven through
// the shipped page entry.
//
// What only this file can catch: that the control is OFF on arrival and writes
// nothing until a reader turns it on, that what it does write carries the
// derived values and none of the export's own text or rows, that a retained
// payload comes back through the same briefing renderer a fresh import uses,
// that forgetting removes the key rather than blanking it, and that no storage
// condition — blocked, full, corrupt, or written by another version — reaches
// the page as an exception.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  BRIEFING_RETENTION_KEY, BRIEFING_RETENTION_VERSION, RETENTION_COPY, RETENTION_STATE,
  briefingFromRetained, capturedAtLabel, readRetainedBriefing, retainedBriefingPayload,
  retainedSuppliedContext, suppliedContextLabel,
} from "../src/finops-briefing-retention.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
// A supported native export: it bypasses the mapping step, so one file selection
// is a complete import and a produced briefing.
const NATIVE_OPENAI = await readFile(new URL(
  "../contracts/integrations/native-provider-exports/v1/fixtures/openai-supported.csv",
  import.meta.url), "utf8");

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

async function openFinopsTab(storage = {}, { breakStorage = false } = {}) {
  const page = await loadPage(PAGE, {
    storage,
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  if (breakStorage) {
    // A browser with site data disabled: every accessor throws, before any
    // caller can guard the call it was about to make.
    for (const method of ["getItem", "setItem", "removeItem"]) {
      page.storage[method] = () => { throw new DOMException("denied", "SecurityError"); };
    }
  }
  await importPageModule("/evolution-page.js");
  const { document } = page;
  // Every asynchronous surface of the page settles before a test touches it;
  // one left in flight would run on into the next test.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => textOf(byId(document, "integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

/** One file selection through the real control, exactly as a browse does. */
function chooseFiles(document, files) {
  const input = byId(document, "local-finops-files");
  input.files = files.map(({ name, text }) => ({ name, type: "text/csv", text: async () => text }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const importNativeExport = async (document) => {
  chooseFiles(document, [{ name: "openai-native.csv", text: NATIVE_OPENAI }]);
  await waitFor(() => !byId(document, "local-results").hidden,
    "the imported briefing to render");
};

/** A payload of the shape the page writes, from figures no file was read for. */
const seededPayload = (overrides = {}) => ({
  version: BRIEFING_RETENTION_VERSION,
  capturedAt: "2026-08-01T09:00:00.000Z",
  provider: { id: "openai", name: "OpenAI", confidence: 92 },
  confidence: "Medium",
  totals: {
    analyzedSpendUsd: 546.2,
    recoverableUsd: 402.75,
    recordsAnalyzed: 3,
    recordsExcluded: 0,
    period: "2026-06-01 to 2026-07-01",
    previousPeriod: "2026-05-01 to 2026-06-01",
    periods: [
      { period: "2026-05-01 to 2026-06-01", spendUsd: 400 },
      { period: "2026-06-01 to 2026-07-01", spendUsd: 546.2 },
    ],
  },
  departments: [
    { id: "atlas-platform", name: "Atlas Platform", spendUsd: 412.75, previousSpendUsd: 300, recoverableUsd: 300 },
    { id: "boreal-support", name: "Boreal Support", spendUsd: 133.45, previousSpendUsd: 100, recoverableUsd: 102.75 },
  ],
  rankedAction: "Pilot lower-cost routing for text-generation in Atlas Platform.",
  ...overrides,
});

const seed = (payload) => ({ [BRIEFING_RETENTION_KEY]: JSON.stringify(payload) });

// ---------------------------------------------------------------------------
// (a) Off by default, and nothing written until it is turned on.
// ---------------------------------------------------------------------------

test("the retention control is absent before a briefing and off after one, writing nothing", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    // Before any import there is nothing of the reader's to keep, so the block
    // is not offered at all — and no key exists.
    assert.equal(byId(document, "local-lead-retention").hidden, true);
    assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null);

    await importNativeExport(document);

    const block = byId(document, "local-lead-retention");
    assert.equal(block.hidden, false, "a produced briefing must offer the retention control");
    assert.equal(block.dataset.state, RETENTION_STATE.off);
    assert.equal(byId(document, "local-lead-retention-toggle").checked, false,
      "retention must be unchecked on arrival");
    assert.equal(byId(document, "local-lead-retention-forget").hidden, true,
      "there is nothing to forget until something is kept");
    // The label says what is kept and where, before consent.
    assert.match(shownText(document, "local-lead-retention-label"),
      /Keep this briefing in this browser, on this device/);
    assert.match(shownText(document, "local-lead-retention-detail"),
      /Derived values only.*No file contents, no individual usage rows, and no file names/s);
    // The import completed, the briefing is on screen — and this browser still
    // holds nothing.
    assert.equal(byId(document, "local-lead-finding").hidden, false);
    assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null,
      "an import alone must never write the retention key");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// (b) What a reader's opt-in actually writes.
// ---------------------------------------------------------------------------

test("turning retention on writes derived values and none of the export's own content", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importNativeExport(document);
    byId(document, "local-lead-retention-toggle").click();

    const raw = page.storage.getItem(BRIEFING_RETENTION_KEY);
    assert.notEqual(raw, null, "the opt-in must write the versioned key");
    const payload = JSON.parse(raw);

    assert.equal(payload.version, BRIEFING_RETENTION_VERSION);
    assert.match(payload.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof payload.totals.analyzedSpendUsd, "number");
    assert.equal(typeof payload.totals.recoverableUsd, "number");
    assert.ok(payload.departments.length > 0, "department rollups must be retained");
    // The recognition verdict is painted beside the analysis rather than in
    // front of it (#958), so which provider is named depends on whether the
    // detection entry point claimed this file. Either way the slot is a named
    // string and a number rather than a pass-through of anything read.
    assert.equal(typeof payload.provider.id, "string");
    assert.equal(typeof payload.provider.name, "string");
    assert.equal(typeof payload.provider.confidence, "number");
    assert.deepEqual(Object.keys(payload.provider).sort(), ["confidence", "id", "name"]);
    assert.equal(typeof payload.confidence, "string");

    // The exact key set, so a field added upstream cannot ride in unnoticed.
    // `attribution` is the one deliberate widening (#997): the suppression the
    // live import applied, and the file presence it was decided against, kept
    // with the figures so a restore cannot state a figure the page withheld.
    // `context` is the second (#1010): what the reader typed here themselves,
    // in the record of the import it was typed about, and null on this payload
    // because this caller supplied none.
    assert.deepEqual(Object.keys(payload).sort(), [
      "attribution", "capturedAt", "confidence", "context", "departments",
      "provider", "rankedAction", "totals", "version",
    ]);
    assert.equal(payload.context, null,
      "a reader who supplied nothing must not get a context field with anything in it");
    // Three derived booleans and nothing else — not a copy of the decision's
    // inputs, and no room for a file name or a share to arrive in this slot.
    assert.deepEqual(Object.keys(payload.attribution).sort(),
      ["conversationExport", "spendExport", "withheld"]);
    for (const key of ["conversationExport", "spendExport", "withheld"]) {
      assert.equal(typeof payload.attribution[key], "boolean",
        `attribution.${key} must be a derived boolean, not a value read from the export`);
    }
    assert.deepEqual(Object.keys(payload.departments[0]).sort(), [
      "id", "name", "previousSpendUsd", "recoverableUsd", "spendUsd",
    ]);

    // THE ABSENCE ASSERTIONS. Not "the good fields are here" — "the export's own
    // content is not", checked against the serialized bytes this browser holds.
    for (const forbidden of ["records", "rows", "aggregates", "modelUsageRows", "fileName",
      "files", "querySample", "assumptions", "warnings", "provenance", "generatedAt"]) {
      assert.equal(forbidden in payload, false,
        `${forbidden} must never be retained at the top level`);
    }
    const header = NATIVE_OPENAI.split("\n")[0];
    for (const column of header.split(",")) {
      assert.equal(raw.includes(column.trim()), false,
        `the retained payload must not carry the export's own column "${column.trim()}"`);
    }
    // The row's own identifiers — model names, account ids, usage types. Dates
    // and bare numbers are excluded from this check on purpose: the retained
    // totals legitimately carry the analyzed PERIOD and the summed figures, and
    // a period boundary is a window, not a record.
    const firstRow = NATIVE_OPENAI.split("\n")[1] ?? "";
    const identifiers = firstRow.split(",").map((value) => value.trim())
      .filter((value) => value.length > 3 && !/^[\d.-]+$/.test(value) && !/^\d{4}-\d{2}/.test(value));
    assert.ok(identifiers.length > 0, "the fixture must contain row identifiers to check against");
    for (const cell of identifiers) {
      assert.equal(raw.includes(cell), false,
        `the retained payload must not carry the row-level value "${cell}"`);
    }
    assert.equal(raw.includes("openai-native.csv"), false,
      "the chosen file's name must never be retained");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// (c) Rehydration on load.
// ---------------------------------------------------------------------------

test("a retained payload rehydrates into the result region with provenance and capture time", async () => {
  const page = await openFinopsTab(seed(seededPayload()));
  const { document } = page;
  try {
    assert.equal(byId(document, "local-results").hidden, false,
      "a retained briefing must open the import result region on load");
    assert.equal(byId(document, "local-results").dataset.retained, "true");
    const lead = byId(document, "local-lead-finding");
    assert.equal(lead.hidden, false);
    assert.equal(lead.dataset.state, "available",
      "the restored payload must produce a briefing with a figure in it");
    // The same renderer as a fresh import: the contract version and the
    // provenance line are the ones `applyBriefing` writes, not a second copy.
    assert.equal(lead.dataset.contractVersion, "finops-briefing/1.0.0");
    assert.match(shownText(document, "local-lead-provenance"), /\S/);
    assert.match(shownText(document, "local-lead-rubric"), /briefing contract finops-briefing\/1\.0\.0/);
    assert.match(shownText(document, "local-lead-question"), /\?$/);

    const block = byId(document, "local-lead-retention");
    assert.equal(block.dataset.state, RETENTION_STATE.retained);
    assert.equal(byId(document, "local-lead-retention-toggle").checked, true);
    assert.equal(byId(document, "local-lead-retention-forget").hidden, false);
    assert.equal(byId(document, "local-lead-retention-captured").hidden, false);
    assert.match(shownText(document, "local-lead-retention-captured"),
      /Captured .* ago · 2026-08-01 09:00 UTC/);
  } finally {
    page.restore();
  }
});

test("with nothing retained the page keeps its sample state and its result region shut", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    assert.equal(byId(document, "local-results").hidden, true);
    assert.equal(byId(document, "local-lead-finding").hidden, true);
    assert.equal(byId(document, "local-lead-retention").hidden, true);
    // The sample-company answer above is exactly what it always was.
    assert.equal(byId(document, "finops-stand").dataset.source, "example");
    assert.match(shownText(document, "finops-stand-label"), /Bundled synthetic example/);
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// (d) Forget.
// ---------------------------------------------------------------------------

test("forgetting removes the key outright and returns the page to its sample state", async () => {
  const page = await openFinopsTab(seed(seededPayload()));
  const { document } = page;
  try {
    byId(document, "local-lead-retention-forget").click();

    assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null,
      "forget must REMOVE the key, not blank it");
    assert.equal(page.storage.length, 0, "no entry may be left behind under this key");
    assert.equal(byId(document, "local-results").hidden, true);
    assert.equal(byId(document, "local-lead-finding").hidden, true);
    assert.equal(byId(document, "local-lead-retention").hidden, true);
    assert.equal(byId(document, "finops-stand").dataset.source, "example");
    // The folded result panels came back with the sample state.
    assert.equal(byId(document, "local-export-actions").hidden, false);
  } finally {
    page.restore();
  }
});

test("turning the control off erases what was already stored", async () => {
  const page = await openFinopsTab(seed(seededPayload()));
  const { document } = page;
  try {
    byId(document, "local-lead-retention-toggle").click();
    assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null);
    assert.equal(byId(document, "local-lead-retention").dataset.state, RETENTION_STATE.off);
    assert.equal(byId(document, "local-lead-retention-forget").hidden, true);
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// (e) Every storage condition, on the page rather than in a unit.
// ---------------------------------------------------------------------------

test("a browser that refuses storage loads its sample state and says retention is unavailable", async () => {
  const page = await openFinopsTab({}, { breakStorage: true });
  const { document } = page;
  try {
    assert.equal(document.documentElement.dataset.shiplogEvolution, "ready",
      "a throwing store must not break the boot");
    assert.equal(byId(document, "local-results").hidden, true);
    assert.equal(byId(document, "finops-stand").dataset.source, "example");

    await importNativeExport(document);

    const block = byId(document, "local-lead-retention");
    assert.equal(block.dataset.state, RETENTION_STATE.unavailable);
    assert.equal(byId(document, "local-lead-retention-toggle").disabled, true);
    assert.equal(shownText(document, "local-lead-retention-status"),
      RETENTION_COPY[RETENTION_STATE.unavailable]);
    assert.equal(shownText(document, "local-lead-retention-status").includes("SecurityError"), false,
      "a raw exception string must never reach the page");
  } finally {
    page.restore();
  }
});

test("a full browser refuses the write, keeps the briefing on screen, and leaves the box off", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importNativeExport(document);
    const before = byId(document, "local-lead-finding").dataset.state;
    page.storage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    byId(document, "local-lead-retention-toggle").click();

    assert.equal(byId(document, "local-lead-retention").dataset.state, RETENTION_STATE.writeRefused);
    assert.equal(byId(document, "local-lead-retention-toggle").checked, false,
      "a refused write must not leave the box claiming the briefing was kept");
    assert.equal(shownText(document, "local-lead-retention-status"),
      RETENTION_COPY[RETENTION_STATE.writeRefused]);
    assert.equal(shownText(document, "local-lead-retention-status").includes("Quota"), false);
    // The just-imported briefing is untouched.
    assert.equal(byId(document, "local-lead-finding").hidden, false);
    assert.equal(byId(document, "local-lead-finding").dataset.state, before,
      "a refused write must leave the briefing exactly as the import painted it");
  } finally {
    page.restore();
  }
});

for (const [label, stored] of [
  ["unparseable JSON", "{ this is not json"],
  ["a payload from another version", JSON.stringify(seededPayload({ version: 99 }))],
  ["a payload with no totals", JSON.stringify({ version: BRIEFING_RETENTION_VERSION, capturedAt: "2026-08-01T09:00:00.000Z" })],
]) {
  test(`${label} is discarded, reported in words, and never restored`, async () => {
    const page = await openFinopsTab({ [BRIEFING_RETENTION_KEY]: stored });
    const { document } = page;
    try {
      assert.equal(document.documentElement.dataset.shiplogEvolution, "ready");
      assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null,
        "a payload this page cannot render must be cleared, not left to fail again");
      assert.equal(byId(document, "local-lead-finding").dataset.state, "empty",
        "no briefing may be restored from a payload that was discarded");
      assert.equal(byId(document, "local-lead-retention").dataset.state, RETENTION_STATE.discarded);
      assert.equal(shownText(document, "local-lead-retention-status"),
        RETENTION_COPY[RETENTION_STATE.discarded]);
      // The sample-company answer is exactly what it always was.
      assert.equal(byId(document, "finops-stand").dataset.source, "example");
      assert.match(shownText(document, "finops-stand-label"), /Bundled synthetic example/);
    } finally {
      page.restore();
    }
  });
}

// ---------------------------------------------------------------------------
// The store on its own: the two properties that are cheaper to pin here.
// ---------------------------------------------------------------------------

test("the payload builder picks fields rather than copying the envelope it was handed", () => {
  const payload = retainedBriefingPayload({
    analysis: {
      spendUsd: 100,
      recoverableUsd: 10,
      confidence: "Medium",
      action: "Do the thing.",
      rankedDepartments: [{ id: "a", name: "A", spendUsd: 100, previousSpendUsd: 50, recoverableUsd: 10, records: [{ prompt: "secret" }] }],
      // Everything below is what an envelope actually carries and what must not
      // survive the pick.
      records: [{ prompt: "summarise this contract", cost: 1 }],
      aggregates: [{ org_unit_id: "u-1", cost: 1 }],
      provenance: "Browser-local projection of provider export export-9.",
      quality: { joinedRecords: 3, quarantinedRecords: 1, importEvidence: ["billing-june.csv"] },
    },
    provider: { id: "openai", name: "OpenAI", confidence: 92 },
    capturedAt: "2026-08-01T09:00:00.000Z",
  });
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["secret", "summarise", "org_unit_id", "billing-june.csv", "export-9"]) {
    assert.equal(serialized.includes(forbidden), false,
      `"${forbidden}" must not survive the pick`);
  }
  assert.equal(payload.totals.recordsAnalyzed, 3);
  assert.equal(payload.totals.recordsExcluded, 1);
  assert.deepEqual(Object.keys(payload.departments[0]).sort(),
    ["id", "name", "previousSpendUsd", "recoverableUsd", "spendUsd"]);
});

test("the capture label states both a relative and an absolute time", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  assert.equal(capturedAtLabel("2026-08-02T09:00:00.000Z", now),
    "Captured 3 hours ago · 2026-08-02 09:00 UTC");
  assert.equal(capturedAtLabel("2026-08-01T12:00:00.000Z", now),
    "Captured 1 day ago · 2026-08-01 12:00 UTC");
  assert.equal(capturedAtLabel("not a time", now), "Captured at an unrecorded time");
});

test("a store whose accessor throws reads as unavailable rather than raising", () => {
  const thrower = { getItem() { throw new Error("blocked"); } };
  const held = readRetainedBriefing(thrower);
  assert.equal(held.state, RETENTION_STATE.unavailable);
  assert.equal(held.message, RETENTION_COPY[RETENTION_STATE.unavailable]);
  assert.equal(held.message.includes("blocked"), false);
});

// ---------------------------------------------------------------------------
// The context the reader supplied, in the same record (#1010)
// ---------------------------------------------------------------------------

/** The smallest analysis this store will build a payload from. */
const ANALYSIS = Object.freeze({
  spendUsd: 100,
  recoverableUsd: 10,
  confidence: "Medium",
  action: "Do the thing.",
  period: "2026-06",
  rankedDepartments: Object.freeze([
    Object.freeze({ id: "psn-atlas0", name: "psn-atlas0", spendUsd: 60, recoverableUsd: 6 }),
    Object.freeze({ id: "psn-borea1", name: "psn-borea1", spendUsd: 40, recoverableUsd: 4 }),
  ]),
});

const withContext = (context) => retainedBriefingPayload({
  analysis: ANALYSIS,
  provider: { id: "openai", name: "OpenAI", confidence: 92 },
  capturedAt: "2026-08-01T09:00:00.000Z",
  context,
});

const SUPPLIED = Object.freeze({
  unitLabels: Object.freeze({ "psn-atlas0": "Platform Engineering" }),
  departments: Object.freeze({ "psn-atlas0": "product-engineering" }),
  cohort: Object.freeze({ orgSizeBand: "band-201-1000", industry: "software" }),
  editedAt: "2026-08-01T10:30:00.000Z",
});

/** Read one hand-written record back, and say what the store did with the key. */
function readStored(record) {
  const store = new Map([[BRIEFING_RETENTION_KEY, JSON.stringify(record)]]);
  const held = readRetainedBriefing({
    getItem: (key) => store.get(key) ?? null,
    removeItem: (key) => store.delete(key),
  });
  return { held, kept: store.has(BRIEFING_RETENTION_KEY) };
}

test("the record carries the names, categories and cohort facts a reader supplied", () => {
  const payload = withContext(SUPPLIED);
  assert.deepEqual(Object.keys(payload.context).sort(),
    ["cohort", "departments", "editedAt", "unitLabels"]);
  assert.equal(payload.context.unitLabels["psn-atlas0"], "Platform Engineering");
  assert.equal(payload.context.departments["psn-atlas0"], "product-engineering");
  assert.deepEqual({ ...payload.context.cohort },
    { orgSizeBand: "band-201-1000", industry: "software" });
  // The edit time is the reader's, and it is NOT the capture time: two instants
  // that answer different questions have to be storable as different values.
  assert.equal(payload.context.editedAt, "2026-08-01T10:30:00.000Z");
  assert.notEqual(payload.context.editedAt, payload.capturedAt);
  // Still one record and one version. The context is a field of the import's
  // own payload, not a second entry with a lifetime of its own.
  assert.equal(payload.version, BRIEFING_RETENTION_VERSION);
});

test("a reader's own unit name is what the restored rollup is called", () => {
  const { analysis } = briefingFromRetained(withContext(SUPPLIED));
  assert.equal(analysis.rankedDepartments[0].name, "Platform Engineering",
    "a restored brief must name the team the reader named, not the export's pseudonym");
  // Renamed, never re-ranked or re-totalled: the figures are the import's.
  assert.equal(analysis.rankedDepartments[0].spendUsd, 60);
  assert.equal(analysis.rankedDepartments[1].name, "psn-borea1");
});

test("supplied context with no edit time, and empty supplied context, are not written", () => {
  assert.equal(withContext({ ...SUPPLIED, editedAt: null }).context, null);
  assert.equal(withContext({ editedAt: "2026-08-01T10:30:00.000Z" }).context, null,
    "a stamp with nothing supplied under it would be an edit that never happened");
});

test("a record whose supplied context does not validate is discarded whole", () => {
  for (const broken of [
    { ...SUPPLIED, editedAt: 17 },
    { unitLabels: ["Platform Engineering"], departments: null, cohort: null, editedAt: "x" },
    "a string where an object was written",
  ]) {
    const { held, kept } = readStored({ ...withContext(SUPPLIED), context: broken });
    // Discarded, not half-read: a record that came back with figures and
    // without the names they were read under is a brief that disagrees with the
    // one this browser was asked to keep.
    assert.equal(held.state, RETENTION_STATE.discarded);
    assert.equal(held.payload, null);
    assert.equal(kept, false,
      "an unreadable record must be removed rather than left to fail on every load");
  }
  // And the same for a version this page does not render: unrecognized is
  // discarded whatever the rest of the shape says.
  const newer = readStored({ ...withContext(SUPPLIED), version: BRIEFING_RETENTION_VERSION + 1 });
  assert.equal(newer.held.state, RETENTION_STATE.discarded);
  assert.equal(newer.kept, false);
});

test("a record written before this field existed still restores", () => {
  const { context, ...older } = withContext(SUPPLIED);
  assert.equal(context === null, false, "the fixture must have had a context to drop");
  const { held } = readStored(older);
  assert.equal(held.state, RETENTION_STATE.retained);
  assert.equal(retainedSuppliedContext(held.payload), null);
  assert.equal(briefingFromRetained(held.payload).analysis.rankedDepartments[0].name, "psn-atlas0");
});

test("the supplied-context line dates the reader's own edit and says what it is not", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  assert.equal(suppliedContextLabel(withContext(SUPPLIED).context, now),
    "You last edited the names and facts you supplied yourself 1 day ago · 2026-08-01 10:30 UTC. "
    + "Every figure in this brief was derived from the file you imported.");
  // Nothing supplied is no line at all, rather than a sentence about an absence.
  assert.equal(suppliedContextLabel(null, now), "");
  // The two lines a restored brief shows are about two different moments, and
  // neither sentence can be read as the other.
  assert.equal(suppliedContextLabel(withContext(SUPPLIED).context, now).includes("Captured"), false);
});
