// Every period inside one imported export, and the movement between the newest
// two (#977).
//
// What is pinned here is the product rule, not an object shape:
//
//   1. A period is a CALENDAR MONTH on the rows, not the file. A file covering
//      three months derives three periods, sorted on the canonical key.
//   2. A repeated period SUMS. That is the rule the single-period path already
//      uses on its rows, and last-wins would drop billed spend.
//   3. Retained history and the file merge through a keyed map, in-file wins,
//      so an overlapping month appears exactly once.
//   4. Movement names both periods, the direction and the magnitude; a genuine
//      single period names itself and blames nobody.
//   5. Derivation is deterministic: same input twice, and shuffled input, give
//      deeply-equal output.
//
// Exports are built in-test in the v1 provider contract's shape rather than
// checked in, so a twelve-month file costs no repository bytes. Page assertions
// are on counts, attributes and substrings: the harness reads text through
// collapsed containers, so visibility is held by keeping the sentence out of
// one, and the count assertions here are what catch a row that never painted.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml } from "./support/browser.js";
import {
  MOVEMENT_DIRECTION, canonicalPeriod, importedPeriodSeries, mergePeriodSeries,
  movementSentence, periodMovement, periodSeriesFromTotals,
} from "../src/finops-imported-period-series.js";
import {
  applyImportedMovement, clearImportedMovement,
} from "../src/finops-imported-movement-view.js";
import { analysisFromRetained } from "../src/finops-briefing-retention.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

// --- fixtures ---------------------------------------------------------------

let nextAggregate = 0;

/** One provider row in the v1 contract's shape, in whole dollars. */
function row(usageDate, dollars) {
  nextAggregate += 1;
  return {
    aggregate_id: `agg-${String(nextAggregate).padStart(4, "0")}`,
    revision: 1,
    usage_date: usageDate,
    org_unit_id: "unit-a",
    provider: "wawalu-model-cloud",
    cost: { amount_minor: Math.round(dollars * 100), currency: "USD", status: "final" },
    usage: { quantity: 1000, unit: "tokens" },
  };
}

/** A provider export carrying whatever rows it is given, across any months. */
function providerExport(records, {
  exportId = "3f8f2b1c-0000-4000-8000-000000000001",
  periodStart = "2026-05-01", periodEnd = "2026-08-01",
} = {}) {
  return {
    type: "provider",
    fileName: "export.json",
    document: {
      schema_version: "1.1",
      kind: "wawalu.integration.provider-usage-billing",
      export_id: exportId,
      snapshot: {
        period_start: periodStart, period_end: periodEnd,
        generated_at: "2026-08-01T00:00:00Z", completeness: "complete",
      },
      privacy: {},
      records,
    },
  };
}

/**
 * The three-month file, with 2026-06 supplied twice so the dedup rule is
 * exercised: 6,000 + 1,500 is one 2026-06 period worth 7,500.
 */
const THREE_MONTHS = () => providerExport([
  row("2026-05-04", 4_000), row("2026-05-19", 1_000),
  row("2026-06-02", 6_000), row("2026-06-27", 1_500),
  row("2026-07-11", 9_000),
]);

const SINGLE_MONTH = () => providerExport([row("2026-07-11", 9_000)],
  { periodStart: "2026-07-01", periodEnd: "2026-08-01" });

// --- 1. the parse -----------------------------------------------------------

test("a file's distinct months become a sorted series, and a repeat sums", () => {
  const series = importedPeriodSeries(THREE_MONTHS());
  assert.deepEqual(series.map((entry) => entry.period), ["2026-05", "2026-06", "2026-07"]);
  assert.deepEqual(series.map((entry) => entry.total), [5_000, 7_500, 9_000]);
  // Dedup is SUM, not last-wins: last-wins would read 1,500 for June.
  assert.equal(series[1].total, 7_500);
  assert.equal(series[1].recordCount, 2);
  assert.equal(series.reduce((sum, entry) => sum + entry.total, 0), 21_500,
    "no billed row may be dropped by the period bucketing");
});

test("the series is sorted on the canonical key, never on file order", () => {
  const shuffled = importedPeriodSeries(providerExport([
    row("2026-07-11", 9_000), row("2026-05-04", 4_000),
    row("2026-06-27", 1_500), row("2026-06-02", 6_000), row("2026-05-19", 1_000),
  ]));
  assert.deepEqual(shuffled.map((entry) => entry.period), ["2026-05", "2026-06", "2026-07"]);
  assert.deepEqual(shuffled.map((entry) => entry.total), [5_000, 7_500, 9_000]);
});

test("only the exports the reconciler accepted are read", () => {
  const kept = providerExport([row("2026-07-02", 9_000)],
    { exportId: "3f8f2b1c-0000-4000-8000-00000000000a" });
  const quarantined = providerExport([row("2026-07-03", 4_000)],
    { exportId: "3f8f2b1c-0000-4000-8000-00000000000b" });
  const series = importedPeriodSeries([kept, quarantined],
    { acceptedExportIds: [kept.document.export_id] });
  assert.equal(series.length, 1);
  assert.equal(series[0].total, 9_000, "a quarantined export cannot re-enter the total");
});

test("a superseded revision does not double a month", () => {
  const first = row("2026-07-02", 9_000);
  const corrected = { ...first, revision: 2, cost: { ...first.cost, amount_minor: 500_000 } };
  const series = importedPeriodSeries(providerExport([first, corrected]));
  assert.equal(series.length, 1);
  assert.equal(series[0].total, 5_000, "the latest revision wins, as it does in the analysis");
});

test("an undated or non-provider input contributes nothing rather than a bucket", () => {
  assert.equal(importedPeriodSeries(null).length, 0);
  assert.equal(importedPeriodSeries({ document: { kind: "wawalu.integration.hris-org" } }).length, 0);
  assert.equal(importedPeriodSeries(providerExport([row("not-a-date", 900)])).length, 0);
  assert.equal(canonicalPeriod("2026-13-01"), null, "month 13 is not a period");
  assert.equal(canonicalPeriod("2026-07-01 to 2026-08-01"), "2026-07",
    "an envelope window keys on the month it bills");
});

// --- 2. the derivation ------------------------------------------------------

test("movement names both periods, the direction and the magnitude", () => {
  const summary = periodMovement(importedPeriodSeries(THREE_MONTHS()));
  assert.equal(summary.available, true);
  assert.equal(summary.periodCount, 3);
  assert.equal(summary.latestPeriod, "2026-07");
  assert.equal(summary.priorPeriod, "2026-06");
  assert.equal(summary.latestTotal, 9_000);
  assert.equal(summary.priorTotal, 7_500);
  assert.equal(summary.delta, 1_500);
  assert.equal(summary.direction, MOVEMENT_DIRECTION.increase);
  const sentence = movementSentence(summary);
  assert.match(sentence, /2026-07 vs 2026-06/);
  assert.match(sentence, /up 1,500 USD/);
});

test("a decrease and a flat month are both findings, not missing ones", () => {
  const down = periodMovement([
    { period: "2026-06", total: 7_500 }, { period: "2026-07", total: 6_000 },
  ]);
  assert.equal(down.direction, MOVEMENT_DIRECTION.decrease);
  assert.equal(down.delta, -1_500);
  assert.match(movementSentence(down), /down 1,500 USD/);
  const flat = periodMovement([
    { period: "2026-06", total: 7_500 }, { period: "2026-07", total: 7_500 },
  ]);
  assert.equal(flat.direction, MOVEMENT_DIRECTION.flat);
  assert.equal(flat.delta, 0);
  assert.match(movementSentence(flat), /2026-07 vs 2026-06: flat at 7,500 USD/);
});

test("one period names itself, states the figure, and blames nobody", () => {
  const summary = periodMovement(importedPeriodSeries(SINGLE_MONTH()));
  assert.equal(summary.available, false);
  assert.equal(summary.periodCount, 1);
  assert.equal(summary.onlyPeriod, "2026-07");
  assert.equal(summary.priorPeriod, null);
  assert.equal(summary.delta, null);
  const sentence = movementSentence(summary);
  assert.match(sentence, /2026-07 is the only period in this export/);
  assert.match(sentence, /9,000 USD/);
  for (const blame of [/re-?export/i, /only one period was retained/i, /you (must|should|need)/i]) {
    assert.doesNotMatch(sentence, blame, "the single-period sentence must not blame the reader");
  }
});

test("an empty series is still a total function, not a null", () => {
  const summary = periodMovement([]);
  assert.equal(summary.available, false);
  assert.equal(summary.periodCount, 0);
  assert.equal(summary.onlyPeriod, null);
  assert.equal(typeof movementSentence(summary), "string");
});

// --- 3. the merge -----------------------------------------------------------

test("retained history and the file merge by period, in-file wins, one entry each", () => {
  const retained = [
    { period: "2026-04-01 to 2026-05-01", spendUsd: 3_000 },
    { period: "2026-05-01 to 2026-06-01", spendUsd: 999 },
  ];
  const merged = mergePeriodSeries(retained, importedPeriodSeries(THREE_MONTHS()));
  assert.deepEqual(merged.map((entry) => entry.period),
    ["2026-04", "2026-05", "2026-06", "2026-07"]);
  const may = merged.filter((entry) => entry.period === "2026-05");
  assert.equal(may.length, 1, "an overlapping period appears exactly once");
  assert.equal(may[0].total, 5_000, "in-file wins over the retained capture of the same month");
  assert.equal(merged[0].total, 3_000, "a retained-only period survives the merge");
  // Movement now compares two real months rather than reporting a single one.
  assert.equal(periodMovement(merged).priorPeriod, "2026-06");
});

test("repeated periods on the retained side sum under the same rule", () => {
  const series = periodSeriesFromTotals([
    { period: "2026-07", spendUsd: 1_000 }, { period: "2026-07-14", spendUsd: 250 },
  ]);
  assert.equal(series.length, 1);
  assert.equal(series[0].total, 1_250);
});

// --- 4. determinism ---------------------------------------------------------

test("the same file parsed twice is deeply equal, and order cannot change it", () => {
  assert.deepEqual(importedPeriodSeries(THREE_MONTHS()), importedPeriodSeries(THREE_MONTHS()));
  const rows = THREE_MONTHS().document.records;
  const reversed = providerExport([...rows].reverse());
  assert.deepEqual(importedPeriodSeries(reversed), importedPeriodSeries(THREE_MONTHS()));
  assert.deepEqual(periodMovement(importedPeriodSeries(reversed)),
    periodMovement(importedPeriodSeries(THREE_MONTHS())));
  const retained = [{ period: "2026-04", spendUsd: 3_000 }];
  assert.deepEqual(mergePeriodSeries(retained, importedPeriodSeries(reversed)),
    mergePeriodSeries(retained, importedPeriodSeries(THREE_MONTHS())));
});

// --- 5. the rendered surface ------------------------------------------------

test("the shipped page states the movement in text, naming both periods", () => {
  const document = parseHtml(html);
  const painted = applyImportedMovement(document, { exports: [THREE_MONTHS()] });
  const region = document.getElementById("finops-imported-movement");
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.state, "movement");
  assert.equal(region.dataset.direction, "increase");
  assert.equal(region.dataset.periodCount, "3");
  const answer = document.getElementById("finops-imported-movement-answer").textContent;
  assert.ok(answer.includes("2026-07"), "the latest period is named in the movement text");
  assert.ok(answer.includes("2026-06"), "the prior period is named in the movement text");
  assert.ok(answer.includes("up"), "the direction is a word, not only an attribute");
  assert.ok(answer.includes("1,500 USD"), "the magnitude is in the text");
  const rows = document.querySelectorAll("li.stand-imported-period");
  assert.equal(rows.length, 3, "the series is painted as a multi-point series, not one row");
  assert.deepEqual([...rows].map((node) => node.dataset.period),
    ["2026-05", "2026-06", "2026-07"]);
  assert.equal(painted.movement.periodCount, 3);
});

test("the movement sentence is not inside a collapsed disclosure", () => {
  const document = parseHtml(html);
  applyImportedMovement(document, { exports: [THREE_MONTHS()] });
  // The harness reads text through a closed details element, so the guard is
  // structural: the region ships as a div with no summary in it, and the
  // paragraph is its own child.
  const region = document.getElementById("finops-imported-movement");
  assert.equal(region.querySelectorAll("summary").length, 0);
  assert.equal(region.querySelectorAll("details").length, 0);
  assert.equal(document.querySelectorAll("#finops-imported-movement-answer").length, 1);
});

test("a single-period file says so on the page and names that period", () => {
  const document = parseHtml(html);
  applyImportedMovement(document, { exports: [SINGLE_MONTH()] });
  const region = document.getElementById("finops-imported-movement");
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.state, "single-period");
  assert.equal(region.dataset.periodCount, "1");
  const answer = document.getElementById("finops-imported-movement-answer").textContent;
  assert.ok(answer.includes("2026-07"), "the one period is named");
  assert.equal(/re-?export/i.test(answer), false);
  assert.equal(document.querySelectorAll("li.stand-imported-period").length, 1);
});

test("a retained period merges into the rendered series", () => {
  const document = parseHtml(html);
  applyImportedMovement(document, {
    exports: [SINGLE_MONTH()],
    retainedPeriods: [{ period: "2026-06-01 to 2026-07-01", spendUsd: 7_500 }],
  });
  const region = document.getElementById("finops-imported-movement");
  assert.equal(region.dataset.state, "movement");
  assert.equal(region.dataset.periodCount, "2");
  const answer = document.getElementById("finops-imported-movement-answer").textContent;
  assert.ok(answer.includes("2026-07 vs 2026-06"), "the retained month is the prior period");
});

test("clearing the import takes the block off screen and leaves no stale row", () => {
  const document = parseHtml(html);
  applyImportedMovement(document, { exports: [THREE_MONTHS()] });
  clearImportedMovement(document);
  const region = document.getElementById("finops-imported-movement");
  assert.equal(region.hidden, true);
  assert.equal(region.dataset.state, "unavailable");
  assert.equal(document.querySelectorAll("li.stand-imported-period").length, 0);
  assert.equal(document.getElementById("finops-imported-movement-answer").textContent, "");
});

test("the example headline's own nodes are untouched by this block", () => {
  const document = parseHtml(html);
  const before = document.getElementById("finops-stand-answer").textContent;
  applyImportedMovement(document, { exports: [THREE_MONTHS()] });
  assert.equal(document.getElementById("finops-stand-answer").textContent, before);
  assert.equal(document.querySelectorAll("dd.imported-headline-slot").length, 0);
});

// --- 6. the retained briefing's own single-period sentence -------------------

test("a one-period retained briefing names its period and does not blame the reader", () => {
  const analysis = analysisFromRetained({
    version: 1,
    capturedAt: "2026-08-01T00:00:00Z",
    provider: { id: "wawalu-model-cloud", name: "Model Cloud", confidence: 90 },
    confidence: "Medium",
    totals: {
      analyzedSpendUsd: 9_000, recoverableUsd: 900, recordsAnalyzed: 5, recordsExcluded: 0,
      period: "2026-07-01 to 2026-08-01", previousPeriod: null,
      periods: [{ period: "2026-07-01 to 2026-08-01", spendUsd: 9_000 }],
    },
    departments: [{ id: "unit-a", name: "Platform", spendUsd: 9_000, recoverableUsd: 900 }],
    rankedAction: "Pilot lower-cost routing in Platform.",
  });
  assert.equal(analysis.history.state, "missing");
  assert.ok(analysis.history.message.includes("2026-07-01 to 2026-08-01"),
    "the retained single-period sentence names the period it has");
  assert.equal(/only one period was retained/i.test(analysis.history.message), false);
});
