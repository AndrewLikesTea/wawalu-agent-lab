// An estimated period, kept on the record so a later real import can be scored
// against it (#1106).
//
// What only this file can catch:
//
//  (a) that `basis` is an explicit field with an absent-means-imported default,
//      so a record and a file written before this change load unchanged;
//  (b) that an import does NOT delete the estimate for its month — the estimate
//      is retained and linked to the entry that took over;
//  (c) that nothing presented as REALIZED counts an estimate, asserted the only
//      way worth asserting it: a mixed series and an imported-only series
//      produce the same figure, the same rows and the same verdict;
//  (d) that the file round-trips basis, the supersession link and the order;
//  (e) that an imported-only reader's exported file is unchanged, byte for
//      byte, by this change having landed;
//  (f) that the miss is stated in one prepared sentence, with a direction and a
//      size, and that the surface renders it as text rather than as a control.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml } from "./support/browser.js";
import {
  ENTRY_BASIS, ESTIMATED_SCOPE, SERIES_FILE_SCHEMA_VERSION,
  briefingSeriesFileText, estimateAccuracy, importBriefingSeries, parseBriefingSeriesFile,
  readBriefingSeries, realizedSeriesEntries, recordBriefingSeriesEntry, recordEstimatedPeriod,
  serializeBriefingSeries,
} from "../src/finops-briefing-series.js";
import {
  TRACK_RECORD_IDS, renderTrackRecord, trackRecordModel,
} from "../src/finops-track-record.js";
import { estimatedPeriodFacts } from "../src/finops-declared-fact-intake.js";
import { estimateFromDeclaredFacts } from "../src/finops-declared-fact-estimate.js";

const HTML = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

/** A localStorage double that keeps what it is given, in memory. */
function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

/** The retained-briefing payload shape `recordBriefingSeriesEntry` reads. */
const briefingFor = (period, spendUsd, { scope = "openai", name = "OpenAI" } = {}) => ({
  capturedAt: `${period}-28T09:00:00.000Z`,
  provider: { id: scope, name },
  confidence: "Medium",
  totals: { period, analyzedSpendUsd: spendUsd, recoverableUsd: spendUsd / 4 },
});

/** The declared-facts side: one estimate, filed as the month it was declared in. */
const declare = (storage, capturedAt, monthlySpendUsd) => recordEstimatedPeriod(storage,
  estimatedPeriodFacts(estimateFromDeclaredFacts({
    monthlySpendUsd, engineers: 12, sizeBand: "mid", industry: "software",
  }), capturedAt));

/** The commitment fields the scorer reads, so the scored path is exercised. */
const COMMITMENT = {
  commitmentId: "route-support-triage-to-haiku",
  claim: {
    baselineMonthlyCostMinor: 100_000,
    projectedMonthlyCostMinor: 40_000,
    monthlySavingsMinor: 60_000,
    currency: "USD",
    unit: "usd_minor",
    period: "2026-06",
  },
  periodId: "user:2026-06",
};

// ---------------------------------------------------------------------------
// (a) The discriminator, and what an older record means.
// ---------------------------------------------------------------------------

test("an entry says which basis it is, and one that says nothing is imported", () => {
  const storage = memoryStorage();
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-06", 1000));

  assert.equal(series[0].basis, ENTRY_BASIS.imported);
  assert.equal(series[0].supersededBy, null);
});

test("a stored record written before this change loads, defaulting to imported", () => {
  const storage = memoryStorage({
    "shiplog.finops.briefing.series.v1": JSON.stringify({
      version: 1,
      entries: [{
        period: "2026-06",
        scope: "openai",
        providerName: "OpenAI",
        capturedAt: "2026-06-28T09:00:00.000Z",
        spendUsd: 1000,
        recoverableUsd: 250,
        confidence: "Medium",
      }],
    }),
  });

  const series = readBriefingSeries(storage);
  assert.equal(series.length, 1, "a pre-#1106 record must still read");
  assert.equal(series[0].basis, ENTRY_BASIS.imported);
  assert.deepEqual(realizedSeriesEntries(series).map((entry) => entry.period), ["2026-06"],
    "and it must still count towards a realized figure");
});

test("a basis this build does not know is treated as imported, not dropped", () => {
  const parsed = parseBriefingSeriesFile(JSON.stringify({
    schemaVersion: SERIES_FILE_SCHEMA_VERSION,
    periods: [{
      period: "2026-06",
      scope: "openai",
      providerName: "OpenAI",
      capturedAt: "2026-06-28T09:00:00.000Z",
      spendUsd: 1000,
      recoverableUsd: 250,
      confidence: "Medium",
      basis: "conjured",
    }],
  }));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries[0].basis, ENTRY_BASIS.imported,
    "a real figure must never be withheld because a discriminator was misspelt");
});

// ---------------------------------------------------------------------------
// (b) The estimate is retained, and linked, rather than overwritten.
// ---------------------------------------------------------------------------

test("a declared estimate is kept under its own scope with its own timestamp", () => {
  const storage = memoryStorage();
  const series = declare(storage, "2026-06-04T08:30:00.000Z", 6000);

  assert.equal(series.length, 1);
  assert.equal(series[0].period, "2026-06", "the month comes off the capture instant");
  assert.equal(series[0].scope, ESTIMATED_SCOPE);
  assert.equal(series[0].basis, ENTRY_BASIS.estimated);
  assert.equal(series[0].capturedAt, "2026-06-04T08:30:00.000Z");
  assert.equal(series[0].spendUsd, 6000);
});

test("an import for the estimated month retains the estimate and links it", () => {
  const storage = memoryStorage();
  declare(storage, "2026-06-04T08:30:00.000Z", 6000);
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-06", 5000));

  assert.equal(series.length, 2, "the import must not delete the estimate it disproves");
  const estimated = series.find((entry) => entry.basis === ENTRY_BASIS.estimated);
  const imported = series.find((entry) => entry.basis === ENTRY_BASIS.imported);
  assert.equal(estimated.supersededBy, "2026-06 openai",
    "the estimate must name the entry that took over");
  assert.equal(imported.supersededBy, null, "a billed figure is superseded by nothing here");
});

test("the link is recomputed, so forgetting the import puts the estimate back live", () => {
  const storage = memoryStorage();
  declare(storage, "2026-06-04T08:30:00.000Z", 6000);
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 5000));

  const withoutImport = readBriefingSeries(storage)
    .filter((entry) => entry.basis === ENTRY_BASIS.estimated);
  const reparsed = parseBriefingSeriesFile(
    JSON.stringify(serializeBriefingSeries(withoutImport)));

  assert.equal(reparsed.entries[0].supersededBy, null,
    "a link whose other half is gone is not a link");
});

// ---------------------------------------------------------------------------
// (c) Nothing presented as realized counts an estimate.
// ---------------------------------------------------------------------------

test("the realized figure over a mixed series equals the imported-only figure", () => {
  const storage = memoryStorage();
  declare(storage, "2026-06-04T08:30:00.000Z", 6000);
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 1000));
  recordBriefingSeriesEntry(storage, briefingFor("2026-07", 400));
  const mixed = readBriefingSeries(storage);

  const imported = memoryStorage();
  recordBriefingSeriesEntry(imported, briefingFor("2026-06", 1000));
  recordBriefingSeriesEntry(imported, briefingFor("2026-07", 400));
  const onlyImported = readBriefingSeries(imported);

  const total = (series) => realizedSeriesEntries(series)
    .reduce((sum, entry) => sum + entry.spendUsd, 0);
  assert.equal(mixed.length, 3, "the estimate is on file");
  assert.equal(total(mixed), total(onlyImported));
  assert.equal(total(mixed), 1400, "and the declared 6,000 is in none of it");
});

test("the track record scores a mixed series exactly as an imported-only one", () => {
  const storage = memoryStorage();
  declare(storage, "2026-06-04T08:30:00.000Z", 6000);
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 1000));
  recordBriefingSeriesEntry(storage, briefingFor("2026-07", 400));

  const imported = memoryStorage();
  recordBriefingSeriesEntry(imported, briefingFor("2026-06", 1000));
  recordBriefingSeriesEntry(imported, briefingFor("2026-07", 400));

  const mixed = trackRecordModel({
    series: readBriefingSeries(storage), commitment: COMMITMENT,
  });
  const clean = trackRecordModel({
    series: readBriefingSeries(imported), commitment: COMMITMENT,
  });

  assert.equal(mixed.state, clean.state);
  assert.equal(mixed.summary, clean.summary, "the periods on file must not count the estimate");
  assert.equal(mixed.summary.startsWith("2 periods on file"), true);
  assert.deepEqual(mixed.rows, clean.rows);
  assert.deepEqual(mixed.figure, clean.figure);
  assert.deepEqual(mixed.verdict, clean.verdict);
  assert.equal(mixed.context, clean.context);
});

test("a browser holding only an estimate has no track record, not a zero one", () => {
  const storage = memoryStorage();
  const model = trackRecordModel({ series: declare(storage, "2026-06-04T08:30:00.000Z", 6000) });

  assert.equal(model.state, "no-track-record");
  assert.equal(model.figure, null);
  assert.equal(model.rows.length, 0);
  assert.equal(model.estimateDelta, "", "nothing has arrived to score the estimate against");
});

// ---------------------------------------------------------------------------
// (d) and (e) The file.
// ---------------------------------------------------------------------------

test("an imported-only export is unchanged by this feature having landed", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 1000));

  const file = JSON.parse(briefingSeriesFileText(readBriefingSeries(storage)));
  assert.equal(file.schemaVersion, 1, "the version must still mean what it meant");
  assert.deepEqual(Object.keys(file.periods[0]).sort(), [
    "capturedAt", "confidence", "period", "providerName", "recoverableUsd", "scope", "spendUsd",
  ], "neither new field is written when it carries nothing");
});

test("a mixed series round-trips its basis, its supersession link and its order", () => {
  const storage = memoryStorage();
  declare(storage, "2026-06-04T08:30:00.000Z", 6000);
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 5000));
  recordBriefingSeriesEntry(storage, briefingFor("2026-07", 400, {
    scope: "anthropic", name: "Anthropic",
  }));
  const before = readBriefingSeries(storage);

  const file = briefingSeriesFileText(before);
  assert.equal(JSON.parse(file).periods.some((record) => record.basis === "estimated"), true,
    "an estimate must say so in the file");
  assert.equal(JSON.parse(file).periods.some((record) => record.supersededBy === "2026-06 openai"),
    true, "and the link must be written");

  const elsewhere = memoryStorage();
  const outcome = importBriefingSeries(elsewhere, file);

  assert.equal(outcome.ok, true, outcome.message);
  assert.deepEqual(outcome.series.map((entry) => [entry.period, entry.scope, entry.basis]),
    before.map((entry) => [entry.period, entry.scope, entry.basis]));
  assert.deepEqual(outcome.series.map((entry) => entry.supersededBy),
    before.map((entry) => entry.supersededBy));
  assert.deepEqual(outcome.series.map((entry) => entry.spendUsd),
    before.map((entry) => entry.spendUsd));
  assert.deepEqual(realizedSeriesEntries(outcome.series).map((entry) => entry.spendUsd),
    [5000, 400], "and the far side still counts only what was billed");
});

// ---------------------------------------------------------------------------
// (f) The miss, in one sentence.
// ---------------------------------------------------------------------------

test("the delta names a direction and a size, in the model", () => {
  const under = estimateAccuracy([
    { period: "2026-06", basis: ENTRY_BASIS.estimated, spendUsd: 4000 },
    { period: "2026-06", basis: ENTRY_BASIS.imported, spendUsd: 5000 },
  ]);
  assert.equal(under.length, 1);
  assert.equal(under[0].direction, "below");
  assert.equal(under[0].deltaUsd, -1000);
  assert.equal(under[0].percent, 20);
  assert.equal(under[0].sentence,
    "Your estimate was 1,000 USD (20%) below the imported figure for Jun 2026 — "
    + "4,000 USD against 5,000 USD.");

  const over = estimateAccuracy([
    { period: "2026-06", basis: ENTRY_BASIS.estimated, spendUsd: 6000 },
    { period: "2026-06", basis: ENTRY_BASIS.imported, spendUsd: 5000 },
  ]);
  assert.equal(over[0].direction, "above");
  assert.match(over[0].sentence, /^Your estimate was 1,000 USD \(20%\) above /);
});

test("a month billed by two providers is compared against their sum", () => {
  const scored = estimateAccuracy([
    { period: "2026-06", basis: ENTRY_BASIS.estimated, spendUsd: 5000 },
    { period: "2026-06", scope: "openai", basis: ENTRY_BASIS.imported, spendUsd: 3000 },
    { period: "2026-06", scope: "anthropic", basis: ENTRY_BASIS.imported, spendUsd: 2000 },
  ]);
  assert.equal(scored.length, 1);
  assert.equal(scored[0].importedUsd, 5000);
  assert.equal(scored[0].direction, "matched");
  assert.match(scored[0].sentence, /matched the imported figure for Jun 2026, at 5,000 USD\./);
});

test("a period with only one of the two is not scored", () => {
  assert.deepEqual(estimateAccuracy([
    { period: "2026-06", basis: ENTRY_BASIS.estimated, spendUsd: 4000 },
    { period: "2026-07", basis: ENTRY_BASIS.imported, spendUsd: 5000 },
  ]), []);
});

test("the header renders the delta as text, not as a control", () => {
  const storage = memoryStorage();
  declare(storage, "2026-06-04T08:30:00.000Z", 6000);
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 1000));
  recordBriefingSeriesEntry(storage, briefingFor("2026-07", 400));
  const model = trackRecordModel({
    series: readBriefingSeries(storage), commitment: COMMITMENT,
  });

  assert.match(model.estimateDelta, /above the imported figure for Jun 2026/);

  const document = parseHtml(HTML);
  renderTrackRecord(document, model);
  const line = document.getElementById(TRACK_RECORD_IDS.estimate);
  assert.ok(line, "the header must state the miss");
  assert.equal(String(line.tagName).toLowerCase(), "p",
    "it is a paragraph, so it adds no tab stop to a first screen with none to spare");
  assert.equal(line.getAttribute("href"), null);
  assert.equal(line.getAttribute("tabindex"), null);
  assert.equal(line.textContent, model.estimateDelta,
    "the view renders the prepared string and words nothing itself");
});

test("no delta line is rendered when nothing has been estimated", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 1000));
  recordBriefingSeriesEntry(storage, briefingFor("2026-07", 400));
  const document = parseHtml(HTML);
  renderTrackRecord(document, trackRecordModel({
    series: readBriefingSeries(storage), commitment: COMMITMENT,
  }));

  // A count, never `assert.equal(node, null)`: an identity assertion on a node
  // this harness parsed walks the whole page and takes minutes to fail.
  assert.equal(document.getElementById(TRACK_RECORD_IDS.region)
    .querySelectorAll(`#${TRACK_RECORD_IDS.estimate}`).length, 0);
});

// ---------------------------------------------------------------------------
// The storage boundary this change must not move.
// ---------------------------------------------------------------------------

test("recording an estimate writes one key and nothing else", () => {
  const writes = [];
  const removals = [];
  const storage = memoryStorage();
  const watched = {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => { writes.push(key); storage.setItem(key, value); },
    removeItem: (key) => { removals.push(key); storage.removeItem(key); },
  };

  declare(watched, "2026-06-04T08:30:00.000Z", 6000);

  assert.deepEqual([...new Set(writes)], ["shiplog.finops.briefing.series.v1"],
    "one key, and it is the series' own");
  assert.deepEqual(removals, []);
});

test("a store that refuses the write leaves the page a series to paint", () => {
  const denied = {
    getItem: () => null,
    setItem: () => { throw new Error("quota"); },
    removeItem: () => {},
  };

  assert.deepEqual(declare(denied, "2026-06-04T08:30:00.000Z", 6000)
    .map((entry) => entry.period), ["2026-06"],
    "the refusal is swallowed by the one writer, as every other path here is");
});

test("an estimate the estimator withheld is not written as a period", () => {
  assert.equal(estimatedPeriodFacts(
    estimateFromDeclaredFacts({ engineers: 12 }), "2026-06-04T08:30:00.000Z"), null,
  "a declaration with no spend figure is not a month");
});
