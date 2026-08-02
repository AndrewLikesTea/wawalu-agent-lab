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
  capturedAtLabel, readRetainedBriefing, retainedBriefingPayload,
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
    assert.deepEqual(Object.keys(payload).sort(), [
      "capturedAt", "confidence", "departments", "provider", "rankedAction", "totals", "version",
    ]);
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
