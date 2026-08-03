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
import { parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";
import {
  MOVEMENT_DIRECTION, canonicalPeriod, comparisonWindow, importedPeriodSeries,
  mergePeriodSeries, monthLabel, movementSentence, periodMovement, periodSeriesFromTotals,
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

test("one period says what is withheld, why, and which control supplies it", () => {
  const summary = periodMovement(importedPeriodSeries(SINGLE_MONTH()));
  assert.equal(summary.available, false);
  assert.equal(summary.periodCount, 1);
  assert.equal(summary.onlyPeriod, "2026-07");
  assert.equal(summary.priorPeriod, null);
  assert.equal(summary.delta, null);
  const sentence = movementSentence(summary);
  // Three jobs, three sentences. What is not on screen…
  assert.match(sentence, /^No movement figure yet\./);
  // …the one input that is missing, with the month and the figure named…
  assert.match(sentence,
    /covers one month — 2026-07, at 9,000 USD — and a movement needs at least two months/);
  // …and the control that supplies it, by the label it carries in evolution.html.
  assert.match(sentence,
    /Under "Choose your export files", re-import a longer export covering an earlier month/);
  // And no movement figure stands in for the one that was not computed.
  assert.doesNotMatch(sentence, /%/, "no percentage is printed for a movement that has no pair");
  assert.doesNotMatch(sentence, /\b(up|down|flat)\b/i, "and no direction word either");
  for (const blame of [/re-?export/i, /only one period was retained/i, /you (must|should|need)/i]) {
    assert.doesNotMatch(sentence, blame, "the single-period sentence must not blame the reader");
  }
});

test("the comparison window is the first month, the last month, and the count", () => {
  const window = comparisonWindow(importedPeriodSeries(THREE_MONTHS()));
  assert.equal(window.monthCount, 3);
  assert.equal(window.firstPeriod, "2026-05");
  assert.equal(window.lastPeriod, "2026-07");
  assert.equal(window.label, "May 2026 → Jul 2026, 3 months");
  // It is derived from the series, so a shuffled input and a merged retained
  // month cannot move it off the months the movement was computed from.
  assert.deepEqual(comparisonWindow([...importedPeriodSeries(THREE_MONTHS())].reverse()), window);
  assert.equal(comparisonWindow(mergePeriodSeries(
    [{ period: "2026-04", spendUsd: 3_000 }], importedPeriodSeries(THREE_MONTHS()))).label,
  "Apr 2026 → Jul 2026, 4 months");
  // One month is a window too, and zero months is not a range anyone may print.
  assert.equal(comparisonWindow(importedPeriodSeries(SINGLE_MONTH())).label, "Jul 2026 only, 1 month");
  assert.deepEqual(comparisonWindow([]),
    Object.freeze({
      monthCount: 0, firstPeriod: null, lastPeriod: null,
      firstLabel: null, lastLabel: null, label: "",
    }));
  assert.equal(monthLabel("2026-01-31"), "Jan 2026");
  assert.equal(monthLabel("2026-13"), null, "an impossible month is not labelled");
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

test("the sentence and its window are outside the one disclosure, which ships closed", () => {
  const document = parseHtml(html);
  applyImportedMovement(document, { exports: [THREE_MONTHS()] });
  // The harness reads text through a closed details element, so the guard is
  // structural rather than textual: the answer and the window label are not
  // descendants of the disclosure, and the disclosure is exactly one.
  const region = document.getElementById("finops-imported-movement");
  assert.equal(region.querySelectorAll("details").length, 1, "one disclosure, not two");
  assert.equal(region.querySelectorAll("summary").length, 1, "and one control to open it");
  for (const id of ["finops-imported-movement-answer", "finops-imported-movement-window",
    "finops-imported-movement-basis", "finops-imported-movement-provenance"]) {
    const node = document.getElementById(id);
    assert.equal(node.closest("details") === null, true,
      `${id} must stay readable while the disclosure is closed`);
  }
  // The rows are the only thing behind it, and it is closed until pressed.
  const detail = document.getElementById("finops-imported-movement-detail");
  assert.equal(detail.hasAttribute("open"), false, "collapsed is the default state");
  assert.equal(detail.dataset.disclosure, "collapsed");
  assert.equal(detail.querySelectorAll("li.stand-imported-period").length, 3);
});

test("the disclosure is the native one: one tab stop, operable from the keyboard", () => {
  const document = parseHtml(html);
  applyImportedMovement(document, { exports: [THREE_MONTHS()] });
  const summary = document.getElementById("finops-imported-movement-summary");
  assert.equal(summary.tagName.toLowerCase(), "summary");
  assert.equal(summary.parentNode.id, "finops-imported-movement-detail");
  assert.equal(summary.getAttribute("tabindex"), null, "the tab stop is the native one");
  assert.equal(summary.getAttribute("role"), null, "and so is the role");
  assert.equal(summary.getAttribute("aria-controls"), "finops-imported-movement-series");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  // It is reachable in document order, and its name says what is behind it.
  assert.equal(tabSequence(document).filter((node) => node.id === summary.id).length, 1,
    "the control is in the tab sequence exactly once");
  assert.match(textOf(summary), /Month-by-month values: 3 months/);

  summary.focus();
  pressEnter(document);
  const detail = document.getElementById("finops-imported-movement-detail");
  assert.equal(detail.hasAttribute("open"), true, "Enter on the summary opens it");
  assert.equal(summary.getAttribute("aria-expanded"), "true", "and the state is mirrored");
  pressEnter(document);
  assert.equal(detail.hasAttribute("open"), false, "and Enter again closes it");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
});

test("the window label names the first month, the last month, and how many", () => {
  const document = parseHtml(html);
  // Four months with a known first and last, generated here rather than checked in.
  const painted = applyImportedMovement(document, {
    exports: [providerExport([
      row("2026-03-04", 1_000), row("2026-04-04", 1_100),
      row("2026-05-04", 1_200), row("2026-06-04", 1_300),
    ], { periodStart: "2026-03-01", periodEnd: "2026-07-01" })],
  });
  assert.equal(painted.window.label, "Mar 2026 → Jun 2026, 4 months");
  assert.equal(painted.window.firstPeriod, "2026-03");
  assert.equal(painted.window.lastPeriod, "2026-06");
  assert.equal(painted.window.monthCount, 4);

  const label = document.getElementById("finops-imported-movement-window");
  assert.equal(label.hidden, false, "the window is stated in the open, not on hover");
  assert.equal(label.dataset.monthCount, "4");
  // The arrow is decoration; the word beside it is what a screen reader reads,
  // so the spoken label is the same sentence without a glyph in it.
  assert.equal(textOf(label), "Mar 2026 to → Jun 2026, 4 months");
  const arrow = label.querySelector(".stand-imported-window-arrow");
  assert.equal(arrow.getAttribute("aria-hidden"), "true");
  assert.equal(label.querySelectorAll(".visually-hidden").length, 1,
    "one spoken stand-in for the arrow, not one per repaint");
});

test("fewer than two months prints no movement figure, and says what to do instead", () => {
  const document = parseHtml(html);
  applyImportedMovement(document, { exports: [SINGLE_MONTH()] });
  const region = document.getElementById("finops-imported-movement");
  assert.equal(region.hidden, false, "the block keeps its place in the reading order");
  assert.equal(region.dataset.state, "single-period");
  assert.equal(region.dataset.direction, "none");

  // No figure stands where the movement would have been: no percentage, no
  // direction, and no dash pretending to be a computed value.
  const answer = document.getElementById("finops-imported-movement-answer");
  const said = textOf(answer);
  assert.doesNotMatch(said, /%/);
  assert.doesNotMatch(said, /\b(up|down|flat)\b/i);
  assert.equal(answer.closest("details") === null, true);
  // The message does both jobs: how many months a movement needs, and the step.
  assert.match(said, /at least two months/);
  assert.match(said, /re-import a longer export/);
  // The window is still stated, so the one month read is named where the label
  // for four would have been.
  const label = document.getElementById("finops-imported-movement-window");
  assert.equal(label.hidden, false);
  assert.equal(textOf(label), "Jul 2026 only, 1 month");
  assert.equal(label.closest("details") === null, true);
});

test("an import with no dated month keeps the block and states the same next step", () => {
  const document = parseHtml(html);
  applyImportedMovement(document, { exports: [providerExport([row("not-a-date", 1_000)])] });
  const region = document.getElementById("finops-imported-movement");
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.state, "no-period");
  assert.equal(region.dataset.periodCount, "0");
  const said = textOf(document.getElementById("finops-imported-movement-answer"));
  assert.match(said, /at least two months/);
  assert.match(said, /re-import a longer export/);
  assert.doesNotMatch(said, /%/);
  // Nothing is offered to disclose, and no window is claimed.
  assert.equal(document.getElementById("finops-imported-movement-detail").hidden, true);
  assert.equal(document.getElementById("finops-imported-movement-window").hidden, true);
  assert.equal(document.querySelectorAll("li.stand-imported-period").length, 0);
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
