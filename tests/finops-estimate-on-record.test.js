// An estimate kept on the record, in the same series as the imported months (#1106).
//
// What only this file can catch: that an estimated entry is a first-class,
// marked entry of the SAME store rather than a parallel one; that a verified
// import for a month that already holds an estimate supersedes it in place —
// once, and again on a repeat import, without stacking; that the realized
// selector is what every downstream figure reads, asserted on the NUMBERS those
// figures come out as rather than on a filter having been called; that a stored
// or exported series with no basis field anywhere reads as fully verified; and
// that the estimate-against-actual sentence states direction and size, in the
// open rather than inside the collapsed disclosure.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  BRIEFING_SERIES_KEY, BRIEFING_SERIES_VERSION, ENTRY_BASIS, ESTIMATE_SCOPE,
  briefingSeriesFileText, briefingSeriesSummary, estimateComparisons, estimatedSeriesEntry,
  importBriefingSeries, readBriefingSeries, realizedSeries, recordBriefingSeriesEntry,
  recordEstimatedPeriod,
} from "../src/finops-briefing-series.js";
import { estimateFromDeclaredFacts } from "../src/finops-declared-fact-estimate.js";
import { EXAMPLE_DECLARED_FACTS } from "../src/finops-declared-fact-fixtures.js";
import { periodMovement } from "../src/finops-imported-period-series.js";
import {
  TRACK_RECORD_IDS, renderTrackRecord, trackRecordModel,
} from "../src/finops-track-record.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const HTML = await readFile(PAGE, "utf8");

function memoryStorage(seed = {}) {
  const jar = new Map(Object.entries(seed));
  return {
    jar,
    getItem: (key) => (jar.has(key) ? jar.get(key) : null),
    setItem: (key, value) => { jar.set(key, String(value)); },
    removeItem: (key) => { jar.delete(key); },
  };
}

/** The retained-briefing payload one import writes, at a chosen month. */
const briefingFor = (month, spendUsd) => ({
  version: 1,
  capturedAt: `${month}-28T09:00:00.000Z`,
  provider: { id: "openai", name: "OpenAI", confidence: 92 },
  confidence: "Medium",
  totals: { analyzedSpendUsd: spendUsd, recoverableUsd: 100, period: `${month}-01 to ${month}-28` },
});

/** A real estimate from the bundled declared facts, at a chosen monthly bill. */
const estimateFor = (monthlySpendUsd) =>
  estimateFromDeclaredFacts({ ...EXAMPLE_DECLARED_FACTS, monthlySpendUsd });

const WHEN = { period: "2026-07", capturedAt: "2026-07-02T08:00:00.000Z" };

/** The seven-field shape a browser was storing before this issue landed. */
const verifiedRow = (period, spendUsd) => ({
  period,
  scope: "openai",
  providerName: "OpenAI",
  capturedAt: `${period}-28T09:00:00.000Z`,
  spendUsd,
  recoverableUsd: 100,
  confidence: "Medium",
});

// ---------------------------------------------------------------------------
// (a) The entry itself: one store, one marked entry, the facts kept with it.
// ---------------------------------------------------------------------------

test("an estimate is kept as a marked entry of the same series, with its declared facts", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 1000));
  const series = recordEstimatedPeriod(storage, estimateFor(4000), WHEN);

  assert.equal(series.length, 2, "one store, two entries — no parallel record");
  const estimate = series.find((entry) => entry.period === "2026-07");
  assert.equal(estimate.basis, ENTRY_BASIS.estimated);
  assert.equal(estimate.scope, ESTIMATE_SCOPE);
  assert.equal(estimate.spendUsd, 4000);
  assert.equal(estimate.superseded, false);
  // The facts the figure was derived from, so the delta can be explained later.
  assert.equal(estimate.declaredFacts.monthlySpendUsd, 4000);
  assert.equal(estimate.declaredFacts.engineers, EXAMPLE_DECLARED_FACTS.engineers);
  assert.equal(estimate.declaredFacts.sizeBand, EXAMPLE_DECLARED_FACTS.sizeBand);
  // The verified entry is untouched: no basis field, exactly the seven it had.
  const imported = series.find((entry) => entry.period === "2026-06");
  assert.deepEqual(Object.keys(imported).sort(),
    ["capturedAt", "confidence", "period", "providerName", "recoverableUsd", "scope", "spendUsd"]);
});

test("a second submit in the same month replaces the estimate instead of stacking", () => {
  const storage = memoryStorage();
  recordEstimatedPeriod(storage, estimateFor(4000), WHEN);
  const series = recordEstimatedPeriod(storage, estimateFor(9000), WHEN);

  assert.equal(series.length, 1);
  assert.equal(series[0].spendUsd, 9000);
});

test("an estimate with no figure in it is not a period", () => {
  const storage = memoryStorage();
  // No headcount: the estimator withholds the figure, so there is nothing to keep.
  const withheld = estimateFromDeclaredFacts({ monthlySpendUsd: 4000 });
  assert.deepEqual(recordEstimatedPeriod(storage, withheld, WHEN), []);
  assert.equal(storage.jar.has(BRIEFING_SERIES_KEY), false);
  assert.equal(estimatedSeriesEntry(null, WHEN), null);
});

// ---------------------------------------------------------------------------
// (b) Supersession: the import wins, the estimate stays, and a repeat is a no-op.
// ---------------------------------------------------------------------------

test("an import for a month holding an estimate supersedes it in place, idempotently", () => {
  const storage = memoryStorage();
  recordEstimatedPeriod(storage, estimateFor(4000), WHEN);
  const after = recordBriefingSeriesEntry(storage, briefingFor("2026-07", 3200));

  assert.equal(after.length, 2, "the estimate is kept, not deleted or overwritten");
  const estimate = after.find((entry) => entry.scope === ESTIMATE_SCOPE);
  assert.equal(estimate.superseded, true);
  assert.equal(estimate.spendUsd, 4000, "the estimate's own figure is unchanged");
  // Verified takes precedence for the period: it is the only realized figure.
  assert.deepEqual(realizedSeries(after).map((entry) => entry.spendUsd), [3200]);

  // The same import again: still two entries, still marked once.
  const repeat = recordBriefingSeriesEntry(storage, briefingFor("2026-07", 3200));
  assert.equal(repeat.length, 2);
  assert.equal(repeat.filter((entry) => entry.superseded === true).length, 1);
  assert.deepEqual(repeat.map((entry) => entry.spendUsd), [4000, 3200]);
});

// ---------------------------------------------------------------------------
// (c) Downstream: the numbers, not the filter.
// ---------------------------------------------------------------------------

test("aggregates, trends and the commitment verdict exclude the estimate", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 1000));
  recordBriefingSeriesEntry(storage, briefingFor("2026-07", 400));
  const series = recordEstimatedPeriod(storage, estimateFor(9000), WHEN);
  const realized = realizedSeries(series);

  // AGGREGATE: two periods on file, not three — and the span ends at July.
  assert.equal(briefingSeriesSummary(realized).count, 2);
  assert.equal(briefingSeriesSummary(realized).label, "2 periods on file · Jun–Jul 2026");

  // TREND: 400 against 1,000 is down 600. Summed with the 9,000 estimate July
  // would read 9,400 and the movement would be up 8,400 — this is that number
  // not happening.
  const movement = periodMovement(realized.map((entry) => ({
    period: entry.period, total: entry.spendUsd,
  })));
  assert.equal(movement.latestTotal, 400);
  assert.equal(movement.delta, -600);
  assert.equal(movement.direction, "decrease");

  // VERDICT: 600 USD realized of 600 USD committed, from the same series that
  // holds the estimate — the header filters, the caller does not have to.
  const commitment = {
    commitmentId: "route-support-triage-to-haiku",
    claim: {
      baselineMonthlyCostMinor: 100_000, projectedMonthlyCostMinor: 40_000,
      monthlySavingsMinor: 60_000, currency: "USD", unit: "usd_minor", period: "2026-06",
    },
    periodId: "user:2026-06",
  };
  const model = trackRecordModel({ series, commitment });
  assert.equal(model.state, "scored");
  assert.equal(model.figure.text, "600 USD realized of 600 USD committed");
  assert.equal(model.summary, "2 periods on file · Jun–Jul 2026");
  // And the estimate is still on the record, labelled, in the per-period rows.
  const estimateRow = model.rows.find((row) => row.estimated);
  assert.equal(estimateRow.providerName, "Estimated from declared facts");
  assert.equal(estimateRow.movement, "Estimated, not measured");
  assert.match(estimateRow.verdict, /^Estimate · superseded/);
  assert.equal(model.rows.filter((row) => row.estimated).length, 1);
});

// ---------------------------------------------------------------------------
// (d) Export and import, both ways.
// ---------------------------------------------------------------------------

test("basis, supersession and declared facts survive a round trip", () => {
  const here = memoryStorage();
  recordBriefingSeriesEntry(here, briefingFor("2026-06", 1000));
  recordEstimatedPeriod(here, estimateFor(4000), WHEN);
  recordBriefingSeriesEntry(here, briefingFor("2026-07", 3200));

  const there = memoryStorage();
  const outcome = importBriefingSeries(there, briefingSeriesFileText(readBriefingSeries(here)));
  assert.equal(outcome.ok, true, outcome.message);
  assert.deepEqual(readBriefingSeries(there), readBriefingSeries(here));

  const estimate = readBriefingSeries(there).find((entry) => entry.scope === ESTIMATE_SCOPE);
  assert.equal(estimate.basis, ENTRY_BASIS.estimated);
  assert.equal(estimate.superseded, true);
  assert.equal(estimate.declaredFacts.monthlySpendUsd, 4000);
  assert.equal(estimate.declaredFacts.industry, EXAMPLE_DECLARED_FACTS.industry);
  // And the delta the far side computes is the delta this side computes.
  assert.deepEqual(estimateComparisons(readBriefingSeries(there)),
    estimateComparisons(readBriefingSeries(here)));
});

test("a file from a browser holding only imports is unchanged by this issue", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 1000));
  const file = JSON.parse(briefingSeriesFileText(readBriefingSeries(storage)));

  assert.equal(file.schemaVersion, 1, "the schema version means what it meant");
  assert.deepEqual(Object.keys(file.periods[0]).sort(),
    ["capturedAt", "confidence", "period", "providerName", "recoverableUsd", "scope", "spendUsd"]);
});

test("a stored or exported series with no basis field reads as fully verified", () => {
  const stored = memoryStorage({
    [BRIEFING_SERIES_KEY]: JSON.stringify({
      version: BRIEFING_SERIES_VERSION,
      entries: [verifiedRow("2026-06", 1000), verifiedRow("2026-07", 400)],
    }),
  });
  const series = readBriefingSeries(stored);
  assert.equal(series.length, 2);
  assert.deepEqual(realizedSeries(series), series, "every entry is realized");
  assert.deepEqual(estimateComparisons(series), [], "nothing to compare against");
  assert.equal(briefingSeriesSummary(realizedSeries(series)).count, 2);

  // The same series as an older export: no basis anywhere, imports as verified.
  const fresh = memoryStorage();
  const outcome = importBriefingSeries(fresh, JSON.stringify({
    schemaVersion: 1, periods: [verifiedRow("2026-06", 1000), verifiedRow("2026-07", 400)],
  }));
  assert.equal(outcome.ok, true, outcome.message);
  assert.deepEqual(realizedSeries(outcome.series), outcome.series);
  assert.equal(trackRecordModel({ series: outcome.series }).estimate, null);
});

// ---------------------------------------------------------------------------
// (e) The sentence, in the open.
// ---------------------------------------------------------------------------

test("the delta sentence states direction and size, and renders outside the disclosure", () => {
  const storage = memoryStorage();
  recordEstimatedPeriod(storage, estimateFor(4000), WHEN);
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-07", 3200));

  assert.deepEqual(estimateComparisons(series), [{
    period: "2026-07", estimatedUsd: 4000, verifiedUsd: 3200, deltaUsd: 800, direction: "over",
  }]);

  const model = trackRecordModel({ series });
  assert.equal(model.estimate,
    "Estimate against actual for Jul 2026: the estimate was over by 800 USD — "
    + "4,000 USD estimated against 3,200 USD imported.");

  const document = parseHtml(HTML);
  renderTrackRecord(document, model);
  const line = document.getElementById(TRACK_RECORD_IDS.estimate);
  assert.equal(document.getElementById(TRACK_RECORD_IDS.region)
    .querySelectorAll(`#${TRACK_RECORD_IDS.estimate}`).length, 1);
  assert.match(textOf(line), /over by 800 USD/);
  // Not folded away: the harness reads through a closed details element, so the
  // ancestor walk is the assertion a real browser would make.
  for (let node = line.parentNode; node; node = node.parentNode) {
    assert.notEqual(node.tagName?.toLowerCase(), "details",
      "the miss must not be hidden behind a disclosure");
  }
});

test("an estimate under its import reads as under, by the size of the miss", () => {
  const storage = memoryStorage();
  recordEstimatedPeriod(storage, estimateFor(4000), WHEN);
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-07", 5500));

  assert.equal(estimateComparisons(series)[0].direction, "under");
  assert.match(trackRecordModel({ series }).estimate,
    /^Estimate against actual for Jul 2026: the estimate was under by 1,500 USD/);
});

test("with no import for its month the estimate is kept, and no miss is stated", () => {
  const storage = memoryStorage();
  const series = recordEstimatedPeriod(storage, estimateFor(4000), WHEN);
  const model = trackRecordModel({ series });

  assert.equal(model.estimate, null, "there is no miss until an import arrives");
  assert.equal(model.state, "no-track-record", "an estimate is not a track record");
  assert.equal(model.rows.length, 1);
  assert.match(model.rows[0].verdict, /^Estimate · no import/);
  assert.match(model.context, /labelled as an estimate; it is not a measurement\.$/);
});
