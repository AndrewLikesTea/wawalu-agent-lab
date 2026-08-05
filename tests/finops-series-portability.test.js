// Carrying the AI FinOps track record out of one browser and into another
// (#1092), built on the keyed period series from #1089.
//
// What only this file can catch: that a file exported from a seeded series
// reproduces the SCORED figures — the count, the span and every period's spend
// — when it is read back into a browser that held nothing, rather than only
// looking like the bytes that were written; that each of the four refusals says
// which one it is and leaves the stored record byte-identical; that a corrupted
// record and a browser with no room both leave a page a reader can still act
// on; that no transport is touched across import, storage, export and scoring;
// and that the controls are labelled and their outcomes announced.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { BRIEFING_RETENTION_KEY } from "../src/finops-briefing-retention.js";
import {
  BRIEFING_SERIES_KEY, SERIES_FILE_COPY, SERIES_FILE_MAX_BYTES, SERIES_FILE_NAME,
  SERIES_FILE_SCHEMA_VERSION, briefingSeriesFileText, briefingSeriesSummary,
  briefingSeriesUnreadable, importBriefingSeries, parseBriefingSeriesFile,
  readBriefingSeries, realizedSeries, recordBriefingSeriesEntry, recordEstimatedPeriod,
  serializeBriefingSeries,
} from "../src/finops-briefing-series.js";
import { estimateFromDeclaredFacts } from "../src/finops-declared-fact-estimate.js";
import { EXAMPLE_DECLARED_FACTS } from "../src/finops-declared-fact-fixtures.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

/** The storage a browser hands the store, with the jar visible to the test. */
function memoryStorage(seed = {}) {
  const jar = new Map(Object.entries(seed));
  return {
    jar,
    getItem: (key) => (jar.has(key) ? jar.get(key) : null),
    setItem: (key, value) => { jar.set(key, String(value)); },
    removeItem: (key) => { jar.delete(key); },
  };
}

/** The retained-briefing payload shape shipping today, one period of it. */
const briefingFor = (month, spendUsd, provider = { id: "openai", name: "OpenAI" }) => ({
  version: 1,
  capturedAt: `${month}-28T09:00:00.000Z`,
  provider: { ...provider, confidence: 92 },
  confidence: "Medium",
  totals: {
    analyzedSpendUsd: spendUsd,
    recoverableUsd: Math.round(spendUsd * 0.4 * 100) / 100,
    period: `${month}-01 to ${month}-28`,
  },
  departments: [],
  rankedAction: "Pilot lower-cost routing.",
});

/** A three-period record, exactly as a reader who kept three months holds it. */
function seededStore() {
  const storage = memoryStorage();
  for (const [month, spend] of [["2026-04", 300], ["2026-05", 420], ["2026-06", 546.2]]) {
    recordBriefingSeriesEntry(storage, briefingFor(month, spend));
  }
  return storage;
}

/**
 * THE SCORED READING, recomputed from whatever a store holds.
 *
 * Every figure here is derived on read — never a field of the file — so two
 * stores agreeing on this object is the round trip actually holding.
 */
const scoredReading = (storage) => {
  const series = readBriefingSeries(storage);
  const summary = briefingSeriesSummary(series);
  return {
    label: summary.label,
    count: summary.count,
    span: [summary.firstPeriod, summary.lastPeriod],
    spendByPeriod: series.map((entry) => [entry.period, entry.scope, entry.spendUsd]),
    totalSpend: series.reduce((total, entry) => total + entry.spendUsd, 0),
    totalRecoverable: series.reduce((total, entry) => total + entry.recoverableUsd, 0),
  };
};

const validFile = (storage) => briefingSeriesFileText(readBriefingSeries(storage));

// ---------------------------------------------------------------------------
// (a) The round trip: recomputed figures, not the bytes.
// ---------------------------------------------------------------------------

test("a series exported and imported into a fresh browser scores identically", () => {
  const source = seededStore();
  const before = scoredReading(source);
  assert.equal(before.label, "3 periods on file · Apr–Jun 2026");

  const fresh = memoryStorage();
  const outcome = importBriefingSeries(fresh, validFile(source));

  assert.equal(outcome.ok, true, outcome.message);
  assert.equal(outcome.message, "Imported 3 periods. This browser now holds 3 periods.");
  // Recomputed on the far side from what the far side stored — the file's own
  // bytes are never the subject of this comparison.
  assert.deepEqual(scoredReading(fresh), before);
});

test("the file is self-describing, carries inputs only, and states its schema version", () => {
  const file = JSON.parse(validFile(seededStore()));
  assert.equal(file.schemaVersion, SERIES_FILE_SCHEMA_VERSION);
  assert.equal(Number.isInteger(file.schemaVersion), true);
  assert.equal(file.periods.length, 3);
  assert.deepEqual(Object.keys(file).sort(), ["periods", "schemaVersion"],
    "no derived figure may ride along beside the periods");
  assert.deepEqual(Object.keys(file.periods[0]).sort(), [
    "capturedAt", "confidence", "period", "providerName", "recoverableUsd", "scope", "spendUsd",
  ]);
  // Nothing identifying beyond what the store already holds: no file name, no
  // raw row, no reader-supplied context, no prompt.
  assert.doesNotMatch(JSON.stringify(file), /prompt|fileName|departments|context/i);
});

test("a hand-edited count in a file is not a figure this build will show", () => {
  const tampered = { ...serializeBriefingSeries(readBriefingSeries(seededStore())) };
  tampered.count = 99;
  tampered.label = "99 periods on file · Jan 2001";
  const fresh = memoryStorage();
  const outcome = importBriefingSeries(fresh, JSON.stringify(tampered));

  assert.equal(outcome.ok, true);
  assert.equal(briefingSeriesSummary(readBriefingSeries(fresh)).label,
    "3 periods on file · Apr–Jun 2026");
});

test("an imported month lands beside the months already here, and replaces its own", () => {
  const carried = seededStore();
  const here = memoryStorage();
  recordBriefingSeriesEntry(here, briefingFor("2026-06", 999));
  recordBriefingSeriesEntry(here, briefingFor("2026-07", 610));
  const untouched = JSON.stringify(here.jar.get(BRIEFING_SERIES_KEY));

  const outcome = importBriefingSeries(here, validFile(carried));

  assert.equal(outcome.ok, true);
  // Merge, not replace: July was not in the file and survives it. June was, and
  // the file's June is the later reading of that billed month — the same rule
  // #1089 and #1095 settled for a second import.
  assert.deepEqual(readBriefingSeries(here).map((entry) => [entry.period, entry.spendUsd]),
    [["2026-04", 300], ["2026-05", 420], ["2026-06", 546.2], ["2026-07", 610]]);
  assert.notEqual(JSON.stringify(here.jar.get(BRIEFING_SERIES_KEY)), untouched);
});

// ---------------------------------------------------------------------------
// (a2) Estimated months in the file (#1106).
//
// What only this section can catch: that an estimate and its superseded marker
// survive the trip whole, that a file of imported periods alone is the same
// seven fields it has always been — which is why format 1 still means what it
// meant — and that a file written before the basis field existed still loads
// with every one of its periods counted as imported.
// ---------------------------------------------------------------------------

const ESTIMATE = estimateFromDeclaredFacts(EXAMPLE_DECLARED_FACTS);

/** April and June imported, May and June estimated — June holds both. */
function mixedStore() {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-04", 300));
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 546.2));
  for (const month of ["2026-05", "2026-06"]) {
    recordEstimatedPeriod(storage, {
      estimate: ESTIMATE, period: month, capturedAt: `${month}-01T08:00:00.000Z`,
    });
  }
  return storage;
}

/** Basis, superseded state and figures, per entry, in read shape. */
const basisReading = (storage) => readBriefingSeries(storage).map((entry) =>
  [entry.period, entry.basis, entry.verified, entry.supersededBy, entry.spendUsd,
    entry.recoverableUsd]);

test("a mixed file round-trips the basis, the superseded state and the figures", () => {
  const source = mixedStore();
  const before = basisReading(source);
  // The seeded state itself: June's estimate is already superseded by June's
  // import, and May's is not.
  assert.deepEqual(before, [
    ["2026-04", "imported", true, null, 300, 120],
    ["2026-05", "estimated", false, null, 154_500, ESTIMATE.recoverableMonthlyUsd.low],
    ["2026-06", "estimated", false, "2026-06 openai", 154_500, ESTIMATE.recoverableMonthlyUsd.low],
    ["2026-06", "imported", true, null, 546.2, 218.48],
  ]);

  const fresh = memoryStorage();
  const outcome = importBriefingSeries(fresh, validFile(source));

  assert.equal(outcome.ok, true, outcome.message);
  assert.deepEqual(basisReading(fresh), before);
  // And the realized side of the far store is the two imported months alone —
  // asserted on the figures, not on the absence of a word.
  assert.deepEqual(realizedSeries(readBriefingSeries(fresh)).map((one) => one.spendUsd),
    [300, 546.2]);
});

test("a file of imported periods alone carries the same fields it always has", () => {
  const file = JSON.parse(validFile(seededStore()));
  for (const record of file.periods) {
    assert.deepEqual(Object.keys(record).sort(), [
      "capturedAt", "confidence", "period", "providerName", "recoverableUsd", "scope", "spendUsd",
    ], "no basis key rides along on an imported period, so format 1 still means format 1");
  }
  assert.equal(file.schemaVersion, SERIES_FILE_SCHEMA_VERSION);
  // The two #1106 keys appear on an estimate and nowhere else.
  const mixed = JSON.parse(validFile(mixedStore()));
  assert.deepEqual(mixed.periods.filter((one) => one.basis).map((one) => one.period),
    ["2026-05", "2026-06"]);
  assert.deepEqual(mixed.periods.filter((one) => one.supersededBy).map((one) => one.period),
    ["2026-06"]);
});

test("a file written before the basis field existed loads with every period imported", () => {
  // Format 1 exactly as this page wrote it before #1106: no basis, no marker.
  const legacy = JSON.stringify({
    schemaVersion: SERIES_FILE_SCHEMA_VERSION,
    periods: [
      { period: "2026-04", scope: "openai", providerName: "OpenAI",
        capturedAt: "2026-04-28T09:00:00.000Z", spendUsd: 300, recoverableUsd: 120,
        confidence: "Medium" },
      { period: "2026-05", scope: "anthropic", providerName: "Anthropic",
        capturedAt: "2026-05-28T09:00:00.000Z", spendUsd: 420, recoverableUsd: 168,
        confidence: "Medium" },
    ],
  });
  const fresh = memoryStorage();
  const outcome = importBriefingSeries(fresh, legacy);

  assert.equal(outcome.ok, true, outcome.message);
  const series = readBriefingSeries(fresh);
  assert.deepEqual(series.map((entry) => entry.basis), ["imported", "imported"]);
  assert.equal(realizedSeries(series).length, 2);
  assert.equal(briefingSeriesSummary(realizedSeries(series)).label,
    "2 periods on file · Apr–May 2026");
  assert.equal(series.reduce((total, entry) => total + entry.spendUsd, 0), 720);
});

// ---------------------------------------------------------------------------
// (b) The four refusals: each names itself, and none of them writes.
// ---------------------------------------------------------------------------

const REFUSALS = [
  {
    name: "oversized",
    // Generated here rather than committed: a fixture this big is a file nobody
    // reads and a repository everybody pays for.
    file: () => `{"schemaVersion":1,"periods":[],"pad":"${"x".repeat(SERIES_FILE_MAX_BYTES)}"}`,
    message: (text) => SERIES_FILE_COPY.oversized(text.length),
  },
  {
    name: "unparseable",
    file: () => '{"schemaVersion": 1, "periods": [',
    message: () => SERIES_FILE_COPY.unparseable,
  },
  {
    name: "schemaVersion",
    file: () => JSON.stringify({ schemaVersion: 2, periods: [] }),
    message: () => SERIES_FILE_COPY.newerSchema(2),
  },
  {
    name: "wrong shape",
    file: () => JSON.stringify({ schemaVersion: 1, periods: "2026-06" }),
    message: () => SERIES_FILE_COPY.noPeriods,
  },
];

for (const refusal of REFUSALS) {
  test(`a ${refusal.name} file is refused by name and writes nothing`, () => {
    const storage = seededStore();
    const before = storage.jar.get(BRIEFING_SERIES_KEY);
    const text = refusal.file();

    const outcome = importBriefingSeries(storage, text);

    assert.equal(outcome.ok, false);
    assert.equal(outcome.series, null, "a refusal repaints nothing, so it reads nothing");
    assert.equal(outcome.message, refusal.message(text));
    assert.doesNotMatch(outcome.message, /invalid file/i,
      "a refusal must name its own reason rather than a generic one");
    // Byte-identical: the stored record is the string that was there before.
    assert.equal(storage.jar.get(BRIEFING_SERIES_KEY), before);
    assert.equal(briefingSeriesSummary(readBriefingSeries(storage)).label,
      "3 periods on file · Apr–Jun 2026");
  });
}

test("the remaining malformed shapes each say which one they are", () => {
  const cases = [
    [JSON.stringify([1, 2]), SERIES_FILE_COPY.notARecord],
    [JSON.stringify({ periods: [] }), SERIES_FILE_COPY.noSchemaVersion],
    [JSON.stringify({ schemaVersion: "1", periods: [] }), SERIES_FILE_COPY.noSchemaVersion],
    [JSON.stringify({ schemaVersion: 0, periods: [] }), SERIES_FILE_COPY.unknownSchema(0)],
    [JSON.stringify({
      schemaVersion: 1,
      periods: [{ period: "2026-04", capturedAt: "2026-04-28T09:00:00.000Z", spendUsd: 300 },
        { period: "2026-05", spendUsd: 420 }],
    }), SERIES_FILE_COPY.malformedPeriod(2)],
  ];
  for (const [text, message] of cases) {
    const outcome = parseBriefingSeriesFile(text);
    assert.equal(outcome.ok, false, `${text} must be refused`);
    assert.equal(outcome.message, message);
  }
  // One malformed row refuses the whole file, so a partial series is impossible.
  const storage = memoryStorage();
  importBriefingSeries(storage, cases.at(-1)[0]);
  assert.equal(storage.jar.has(BRIEFING_SERIES_KEY), false);
});

test("a file at the ceiling is read and one byte over it is not", () => {
  const under = { schemaVersion: 1, periods: [] };
  assert.equal(parseBriefingSeriesFile(JSON.stringify(under), SERIES_FILE_MAX_BYTES).ok, true);
  const over = parseBriefingSeriesFile(JSON.stringify(under), SERIES_FILE_MAX_BYTES + 1);
  assert.equal(over.ok, false);
  assert.equal(over.message, SERIES_FILE_COPY.oversized(SERIES_FILE_MAX_BYTES + 1));
});

// ---------------------------------------------------------------------------
// (c) Degradation: a corrupt record and a browser with no room.
// ---------------------------------------------------------------------------

test("a corrupted record reads as empty, is reported as unreadable, and imports over", () => {
  const storage = memoryStorage({ [BRIEFING_SERIES_KEY]: '{"version":1,"entries":' });
  assert.deepEqual(readBriefingSeries(storage), [], "a corrupt record must not throw into a read");
  assert.equal(briefingSeriesUnreadable(storage), true);
  assert.match(SERIES_FILE_COPY.unreadable, /forget control|Import a file/);

  // The way forward works: an import over a corrupt record commits cleanly.
  const outcome = importBriefingSeries(storage, validFile(seededStore()));
  assert.equal(outcome.ok, true);
  assert.equal(briefingSeriesUnreadable(storage), false);
  assert.equal(briefingSeriesSummary(readBriefingSeries(storage)).count, 3);
});

test("a browser with no room refuses the write whole and keeps what was here", () => {
  const storage = seededStore();
  const before = storage.jar.get(BRIEFING_SERIES_KEY);
  storage.setItem = () => { throw new Error("QuotaExceededError"); };

  const outcome = importBriefingSeries(storage, JSON.stringify({
    schemaVersion: 1,
    periods: [{
      period: "2026-07", scope: "openai", providerName: "OpenAI",
      capturedAt: "2026-07-28T09:00:00.000Z", spendUsd: 610, recoverableUsd: 200,
      confidence: "Medium",
    }],
  }));

  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, SERIES_FILE_COPY.writeRefused);
  assert.equal(storage.jar.get(BRIEFING_SERIES_KEY), before,
    "a refused write must leave no part of the imported series behind");
  assert.equal(briefingSeriesSummary(outcome.series).count, 3,
    "and the caller is handed the series that is still on file, to repaint");
});

test("a browser that refuses storage outright imports nothing and never throws", () => {
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  const outcome = importBriefingSeries(blocked, validFile(seededStore()));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, SERIES_FILE_COPY.writeRefused);
  assert.equal(briefingSeriesUnreadable(blocked), false);
});

// ---------------------------------------------------------------------------
// (d) The page, wired.
// ---------------------------------------------------------------------------

async function openFinopsTab(storage = {}) {
  const page = await loadPage(PAGE, {
    storage,
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  // Every asynchronous surface settles before a test touches the page; one left
  // in flight would run on into the next test.
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => textOf(page.document.getElementById("integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => page.document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

/** The file a reader chooses, in the shape the picker hands the page. */
const chosenFile = (text, name = SERIES_FILE_NAME) => ({
  name,
  type: "application/json",
  size: Buffer.byteLength(text, "utf8"),
  text: async () => text,
});

test("the controls are labelled, the locality sentence is in the open, and export downloads", async () => {
  const seeded = seededStore();
  const page = await openFinopsTab({ [BRIEFING_SERIES_KEY]: seeded.jar.get(BRIEFING_SERIES_KEY) });
  const { document } = page;
  try {
    // Labelled: the file input by a label bound to its id, the button by its own
    // text, and both described by the locality sentence.
    const input = document.getElementById("local-lead-portability-import");
    assert.equal(input.getAttribute("type"), "file");
    assert.equal(document.querySelectorAll('label[for="local-lead-portability-import"]').length, 1);
    assert.equal(input.getAttribute("aria-describedby"), "local-lead-portability-locality");
    assert.equal(textOf(document.getElementById("local-lead-portability-export")),
      "Export track record");

    // The locality statement: visible, plain, and NOT folded into a disclosure —
    // a closed details element is read by this harness and silent to a person.
    const locality = document.getElementById("local-lead-portability-locality");
    assert.match(textOf(locality), /lives in this browser, on this device/);
    assert.match(textOf(locality), /Neither one sends anything anywhere/);
    let node = locality.parentNode;
    let hiddenAncestors = 0;
    while (node) {
      assert.notEqual(node.tagName?.toLowerCase(), "details",
        "the locality sentence must not be nested inside a disclosure");
      if (node.hidden === true) hiddenAncestors += 1;
      node = node.parentNode;
    }
    assert.equal(hiddenAncestors, 0, "the control area must be visible without an analysis");

    // Announced: both lines are live regions that exist before they are painted.
    for (const id of ["local-lead-portability-count", "local-lead-portability-status"]) {
      assert.equal(document.getElementById(id).getAttribute("role"), "status");
    }
    assert.equal(textOf(document.getElementById("local-lead-portability-count")),
      "3 periods on file · Apr–Jun 2026");

    document.getElementById("local-lead-portability-export").click();
    assert.equal(page.downloads.length, 1);
    assert.equal(page.downloads[0].filename, SERIES_FILE_NAME);
    assert.equal(JSON.parse(page.downloads[0].text).periods.length, 3);
    assert.match(textOf(document.getElementById("local-lead-portability-status")),
      /^Exported 3 periods to /);

    // And the exported file scores the same in a browser that held nothing.
    const fresh = memoryStorage();
    importBriefingSeries(fresh, page.downloads[0].text);
    assert.deepEqual(scoredReading(fresh), scoredReading(seeded));
  } finally {
    page.restore();
  }
});

test("importing through the control updates the count, and a refusal leaves it alone", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    assert.equal(textOf(document.getElementById("local-lead-portability-count")),
      SERIES_FILE_COPY.nothingOnFile);

    const input = document.getElementById("local-lead-portability-import");
    input.files = [chosenFile(validFile(seededStore()))];
    input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => textOf(document.getElementById("local-lead-portability-status")) !== "",
      "the import to report an outcome");

    assert.equal(textOf(document.getElementById("local-lead-portability-count")),
      "3 periods on file · Apr–Jun 2026");
    assert.equal(JSON.parse(page.storage.getItem(BRIEFING_SERIES_KEY)).entries.length, 3);
    // The count above the answer is the same figure, from the same read.
    assert.equal(textOf(document.getElementById("local-lead-series")),
      "3 periods on file · Apr–Jun 2026");

    // Now a refusal: the message changes, the count and the stored bytes do not.
    const before = page.storage.getItem(BRIEFING_SERIES_KEY);
    input.files = [chosenFile('{"schemaVersion":9,"periods":[]}')];
    input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => textOf(document.getElementById("local-lead-portability-status"))
      .startsWith("That file was written by a newer version"), "the refusal to be announced");

    assert.equal(textOf(document.getElementById("local-lead-portability-count")),
      "3 periods on file · Apr–Jun 2026");
    assert.equal(page.storage.getItem(BRIEFING_SERIES_KEY), before,
      "a refused import must leave the stored record byte-identical");
  } finally {
    page.restore();
  }
});

test("a corrupted record leaves a page that says so and still offers a way out", async () => {
  const page = await openFinopsTab({ [BRIEFING_SERIES_KEY]: "{not json" });
  const { document } = page;
  try {
    assert.equal(document.documentElement.dataset.shiplogEvolution, "ready",
      "a corrupt record must not leave the page mid-render");
    assert.equal(textOf(document.getElementById("local-lead-portability-status")),
      SERIES_FILE_COPY.unreadable);
    assert.equal(textOf(document.getElementById("local-lead-portability-count")),
      SERIES_FILE_COPY.nothingOnFile);

    // Export refuses rather than writing an empty file that would import cleanly.
    document.getElementById("local-lead-portability-export").click();
    assert.equal(page.downloads.length, 0);
    assert.equal(textOf(document.getElementById("local-lead-portability-status")),
      SERIES_FILE_COPY.nothingToExport);

    // And the way forward works from exactly this state.
    const input = document.getElementById("local-lead-portability-import");
    input.files = [chosenFile(validFile(seededStore()))];
    input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => textOf(document.getElementById("local-lead-portability-count"))
      .startsWith("3 periods"), "the import to recover the page");
  } finally {
    page.restore();
  }
});

test("no transport is touched across import, storage, export and scoring", async () => {
  const seeded = seededStore();
  const page = await openFinopsTab({ [BRIEFING_RETENTION_KEY]: JSON.stringify(briefingFor("2026-06", 546.2)) });
  const { document } = page;
  // Spies over the real thing, installed after boot: the page fetches its own
  // bundled fixtures on load, and a recorder that throws would be swallowed by
  // a `catch` in page code and read as a green test.
  const calls = [];
  const saved = Object.fromEntries(["fetch", "XMLHttpRequest", "navigator"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const install = (key, value) => Object.defineProperty(globalThis, key,
    { value, writable: true, configurable: true, enumerable: false });
  const realFetch = globalThis.fetch;
  install("fetch", async (...args) => { calls.push(`fetch ${args[0]}`); return realFetch(...args); });
  install("XMLHttpRequest", class RecordingXhr {
    open(method, url) { calls.push(`xhr ${method} ${url}`); }
    send() { calls.push("xhr send"); }
    setRequestHeader() {}
    addEventListener() {}
  });
  install("navigator", {
    ...globalThis.navigator,
    sendBeacon: (url) => { calls.push(`beacon ${url}`); return true; },
  });
  const navigationsBefore = page.navigations.length;
  try {
    const input = document.getElementById("local-lead-portability-import");
    input.files = [chosenFile(validFile(seeded))];
    input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => textOf(document.getElementById("local-lead-portability-count"))
      .startsWith("3 periods"), "the import to settle");
    document.getElementById("local-lead-portability-export").click();

    assert.deepEqual(calls, [], `a transport was reached: ${calls.join(", ")}`);
    assert.equal(page.navigations.length, navigationsBefore,
      "navigation is egress with no script in it");
    assert.equal(page.downloads.length, 1, "and the export still happened, locally");
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    page.restore();
  }
});
