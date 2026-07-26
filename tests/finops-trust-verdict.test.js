// The metric layer of the post-import trust verdict, tested without a DOM.
//
// Every assertion here is about a number or a rank, never about a widget. The
// verdict accepts contract documents directly, which is how the states the
// parser refuses to produce — mixed currency, a non-integer amount — can still
// be pinned down: they are the two failures this readout must never paper over,
// so they are guarded whether or not the current contract can reach them.

import assert from "node:assert/strict";
import test from "node:test";
import { loadExampleDatasetInputs } from "../src/example-dataset.js";
import { trustVerdict } from "../src/finops-trust-verdict.js";

const UNIT = {
  atlas: "psn_test_unit_atlas000001",
  boreal: "psn_test_unit_boreal00001",
  ghost: "psn_test_unit_ghost000001",
  retired: "psn_test_unit_retired0001",
};

/** A provider export in contract shape. Aggregate ids are distinct so nothing is deduplicated away. */
function providerExport(rows, {
  exportId = "export-a", periodStart = "2026-06-01", periodEnd = "2026-07-01",
} = {}) {
  return {
    export_id: exportId,
    snapshot: { period_start: periodStart, period_end: periodEnd },
    records: rows.map((row, index) => ({
      aggregate_id: `psn_${exportId}_agg_${String(index).padStart(6, "0")}`,
      revision: 0,
      org_unit_id: row.unit,
      cost: {
        amount_minor: row.minor,
        currency: row.currency ?? "USD",
        status: "final",
      },
    })),
  };
}

function hrisExport(units) {
  return {
    export_id: "export-hris",
    records: units.map((unit) => ({
      unit_id: unit.id,
      revision: 0,
      operation: unit.operation ?? "upsert",
      ...(unit.operation === "delete" ? {} : { active: unit.active ?? true }),
    })),
  };
}

const ROSTER = hrisExport([
  { id: UNIT.atlas },
  { id: UNIT.boreal },
  { id: UNIT.retired, active: false },
]);

function verdict(rows, options = {}) {
  return trustVerdict({
    providers: options.providers ?? [providerExport(rows)],
    hris: options.hris ?? ROSTER,
    quarantinedExportIds: options.quarantinedExportIds ?? [],
  });
}

test("coverage is dollar-weighted, never a row-count ratio", () => {
  // One large attributed row against nine small unresolved ones. A row-count
  // ratio would report 10%; the money says 99.0%, and the money is the metric.
  const result = verdict([
    { unit: UNIT.atlas, minor: 90_000 },
    ...Array.from({ length: 9 }, () => ({ unit: UNIT.ghost, minor: 100 })),
  ]);
  assert.equal(result.state, "findings");
  assert.equal(result.headline.coverageText, "99.0%");
  assert.equal(result.headline.attributed, "900.00 USD");
  assert.equal(result.headline.total, "909.00 USD");
  assert.equal(result.headline.attributedRows, 1);
  assert.equal(result.headline.totalRows, 10);
});

test("the headline never ships the percentage without its numerator and denominator", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 2_500 },
    { unit: UNIT.ghost, minor: 2_500 },
  ]);
  for (const key of ["attributed", "total", "attributedRows", "totalRows", "coverageText"])
    assert.ok(result.headline[key] !== null && result.headline[key] !== undefined, `missing ${key}`);
  assert.equal(result.headline.coverageText, "50.0%");
  assert.equal(result.headline.attributedMinor, 2_500);
  assert.equal(result.headline.totalMinor, 5_000);
});

test("rounding happens once, at the display boundary", () => {
  // 1 of 3 attributed: 33.333…%, which must print as 33.3% and stay full
  // precision on the model.
  const result = verdict([
    { unit: UNIT.atlas, minor: 1_000 },
    { unit: UNIT.ghost, minor: 1_000 },
    { unit: UNIT.ghost, minor: 1_000 },
  ]);
  assert.equal(result.headline.coverageText, "33.3%");
  assert.ok(Math.abs(result.headline.coveragePercent - 100 / 3) < 1e-9);
});

test("money sums in integer minor units, so a large import cannot drift", () => {
  // 100,000 rows of one cent. Accumulated as dollars this is a classic float
  // drift case; in minor units it is exactly 1000.00.
  const rows = Array.from({ length: 100_000 }, () => ({ unit: UNIT.atlas, minor: 1 }));
  const result = verdict(rows);
  assert.equal(result.headline.totalMinor, 100_000);
  assert.equal(result.headline.total, "1000.00 USD");
  assert.equal(result.headline.coverageText, "100.0%");
});

test("an unconfirmed roster entry is not attributed, and is its own finding", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 7_000 },
    { unit: UNIT.retired, minor: 3_000 },
  ]);
  assert.equal(result.headline.coverageText, "70.0%");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].id, "unconfirmed_units");
  assert.equal(result.findings[0].impact, "30.00 USD");
  // The uncertainty is about the classification, and it is named, not scored.
  assert.equal(result.findings[0].confidence, "uncertain");
  assert.equal(result.findings[0].blocking, false);
});

test("a deleted roster entry is unconfirmed, not unresolved", () => {
  const result = verdict([{ unit: UNIT.ghost, minor: 1_000 }], {
    hris: hrisExport([{ id: UNIT.ghost, operation: "delete" }]),
  });
  assert.deepEqual(result.findings.map((finding) => finding.id), ["unconfirmed_units"]);
});

test("an identifier absent from the roster is unresolved, and the classification is certain", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 5_000 },
    { unit: UNIT.ghost, minor: 5_000 },
  ]);
  assert.equal(result.findings[0].id, "unresolved");
  assert.equal(result.findings[0].confidence, "certain");
  assert.equal(result.findings[0].identifierCount, 1);
  // Provenance is traceable to the upload: source columns, row count, examples.
  assert.match(result.findings[0].provenance, /org_unit_id/);
  assert.match(result.findings[0].provenance, /1 row/);
  assert.match(result.findings[0].provenance, /…000001/);
});

test("rows from a quarantined export are dropped periods, and the money is still in the denominator", () => {
  const result = trustVerdict({
    providers: [
      providerExport([{ unit: UNIT.atlas, minor: 6_000 }], { exportId: "good" }),
      providerExport([{ unit: UNIT.atlas, minor: 4_000 }], { exportId: "bad" }),
    ],
    hris: ROSTER,
    quarantinedExportIds: ["bad"],
  });
  assert.equal(result.headline.totalMinor, 10_000);
  assert.equal(result.headline.attributedMinor, 6_000);
  assert.equal(result.headline.coverageText, "60.0%");
  assert.deepEqual(result.findings.map((finding) => finding.id), ["dropped_periods"]);
});

test("findings rank by impact descending", () => {
  const result = trustVerdict({
    providers: [providerExport([
      { unit: UNIT.atlas, minor: 1_000 },
      { unit: UNIT.ghost, minor: 200 },
      { unit: UNIT.retired, minor: 900 },
    ], { exportId: "live" }), providerExport([
      { unit: UNIT.atlas, minor: 500 },
    ], { exportId: "bad" })],
    hris: ROSTER,
    quarantinedExportIds: ["bad"],
  });
  assert.deepEqual(result.findings.map((finding) => finding.id),
    ["unconfirmed_units", "dropped_periods", "unresolved"]);
});

test("equal impact breaks on row count, then on a fixed category order", () => {
  const byRows = verdict([
    { unit: UNIT.atlas, minor: 100 },
    { unit: UNIT.ghost, minor: 1_000 },
    { unit: UNIT.retired, minor: 500 },
    { unit: UNIT.retired, minor: 500 },
  ]);
  // Same 1000 minor on both sides; the two-row category wins.
  assert.deepEqual(byRows.findings.map((finding) => finding.id),
    ["unconfirmed_units", "unresolved"]);

  const byCategory = verdict([
    { unit: UNIT.atlas, minor: 100 },
    { unit: UNIT.ghost, minor: 1_000 },
    { unit: UNIT.retired, minor: 1_000 },
  ]);
  // Identical impact and identical row count: unresolved is declared first.
  assert.deepEqual(byCategory.findings.map((finding) => finding.id),
    ["unresolved", "unconfirmed_units"]);
});

test("a category with no impact is omitted entirely, not rendered empty", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 1_000 },
    { unit: UNIT.ghost, minor: 0 },
  ]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.state, "all_clear");
  // The row that resolved to nothing still exists; the sentence says so rather
  // than claiming every row was attributed.
  assert.equal(result.headline.attributedRows, 1);
  assert.equal(result.headline.totalRows, 2);
  assert.match(result.answer, /carries no spend/);
});

test("full coverage degrades to an all-clear, with no findings and no next action", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 4_000 },
    { unit: UNIT.boreal, minor: 6_000 },
  ]);
  assert.equal(result.state, "all_clear");
  assert.equal(result.headline.coverageText, "100.0%");
  assert.equal(result.headline.total, "100.00 USD");
  assert.equal(result.headline.attributedRows, 2);
  assert.deepEqual(result.findings, []);
  assert.equal(result.nextAction, null);
  assert.match(result.answer, /^Yes\./);
});

test("an empty import is its own state and never reports 100%", () => {
  const result = trustVerdict({ providers: [], hris: ROSTER });
  assert.equal(result.state, "empty");
  assert.equal(result.headline.coveragePercent, null);
  assert.equal(result.headline.coverageText, null);
  assert.equal(result.headline.available, false);
  assert.equal(result.headline.totalRows, 0);
  assert.deepEqual(result.findings, []);
  assert.equal(result.nextAction, null);
});

test("zero spend is neither an empty import nor an all-clear, and prints no percentage", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 0 },
    { unit: UNIT.ghost, minor: 0 },
  ]);
  assert.equal(result.state, "zero_spend");
  assert.equal(result.headline.coveragePercent, null);
  assert.equal(result.headline.coverageText, null);
  assert.equal(result.headline.totalRows, 2);
  assert.deepEqual(result.findings, []);
  assert.equal(result.nextAction, null);
});

test("a missing or non-integer amount contributes zero and is counted, never coerced", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 1_000 },
    { unit: UNIT.atlas, minor: "12.50" },
    { unit: UNIT.atlas, minor: undefined },
  ]);
  assert.equal(result.headline.totalMinor, 1_000);
  assert.equal(result.headline.attributedMinor, 1_000);
  assert.equal(result.headline.unparseableAmountRows, 2);
  assert.equal(result.headline.totalRows, 3);
});

test("mixed currencies block instead of producing a fake total", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 1_000, currency: "USD" },
    { unit: UNIT.boreal, minor: 1_000, currency: "EUR" },
  ]);
  assert.equal(result.state, "mixed_currency");
  assert.equal(result.currency, null);
  assert.equal(result.headline.available, false);
  assert.equal(result.headline.coverageText, null);
  assert.equal(result.headline.total, null);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].blocking, true);
  assert.equal(result.findings[0].impact, "Not summable");
  assert.equal(result.nextAction.available, false);
  assert.equal(result.nextAction.control, null);
});

test("exactly one next action is offered, and it names the money and the step", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 1_000 },
    { unit: UNIT.ghost, minor: 9_000 },
  ]);
  assert.equal(result.nextAction.available, true);
  assert.equal(result.nextAction.step, "roster");
  assert.equal(result.nextAction.control, "local-finops-files");
  assert.equal(result.nextAction.recoverable, "90.00 USD");
  assert.match(result.nextAction.text, /90\.00 USD/);
});

test("a gap this product cannot close says so instead of linking to a step that would not fix it", () => {
  const result = trustVerdict({
    providers: [
      providerExport([{ unit: UNIT.atlas, minor: 1_000 }], { exportId: "good" }),
      providerExport([{ unit: UNIT.atlas, minor: 9_000 }], { exportId: "bad" }),
    ],
    hris: ROSTER,
    quarantinedExportIds: ["bad"],
  });
  assert.equal(result.findings[0].id, "dropped_periods");
  assert.equal(result.nextAction.available, false);
  assert.equal(result.nextAction.control, null);
  assert.equal(result.nextAction.step, null);
  assert.match(result.nextAction.text, /cannot repair a period boundary/i);
});

test("per-row detail is a thunk: nothing is grouped until a finding is expanded", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 1_000 },
    { unit: UNIT.ghost, minor: 300 },
    { unit: UNIT.ghost, minor: 200 },
    { unit: UNIT.retired, minor: 400 },
  ]);
  const [finding] = result.findings;
  assert.equal(typeof finding.detail, "function");
  // The collapsed verdict carries counts and examples only — no row list is
  // reachable from the finding itself.
  assert.equal(finding.rows, 2);
  assert.equal(Array.isArray(finding.detailRows), false);
  const detail = finding.detail();
  assert.equal(detail.length, 1);
  assert.equal(detail[0].label, "…000001");
  assert.equal(detail[0].rows, 2);
  assert.equal(detail[0].impact, "5.00 USD");
});

test("detail groups descend by impact and are deterministic", () => {
  const result = verdict([
    { unit: "psn_test_unit_alpha000001", minor: 100 },
    { unit: "psn_test_unit_bravo000002", minor: 900 },
    { unit: "psn_test_unit_delta000003", minor: 900 },
  ]);
  assert.deepEqual(result.findings[0].detail().map((group) => group.label),
    ["…000002", "…000003", "…000001"]);
});

test("full-precision opaque identifiers never leave the model whole", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 100 },
    { unit: UNIT.ghost, minor: 900 },
  ]);
  const serialized = JSON.stringify(result)
    + result.findings.map((finding) => JSON.stringify(finding.detail())).join("");
  assert.ok(!serialized.includes(UNIT.ghost));
});

test("the bundled example dataset produces a real verdict through the real parser", () => {
  const inputs = loadExampleDatasetInputs();
  const result = trustVerdict(inputs);
  assert.equal(result.currency, "USD");
  assert.ok(result.headline.totalMinor > 0);
  assert.equal(result.headline.attributedMinor, result.headline.totalMinor);
  assert.equal(result.headline.coverageText, "100.0%");
  assert.equal(result.state, "all_clear");
  assert.deepEqual(result.findings, []);
  assert.equal(result.nextAction, null);
});

test("no external benchmark or comparison is asserted anywhere in the copy", () => {
  const result = verdict([
    { unit: UNIT.atlas, minor: 1_000 },
    { unit: UNIT.ghost, minor: 9_000 },
  ]);
  const copy = [
    result.answer, result.question, result.nextAction.text,
    ...result.findings.flatMap((finding) =>
      [finding.title, finding.provenance, finding.confidenceReason]),
  ].join(" ");
  assert.doesNotMatch(copy, /typical|industry|average compan|peer|benchmark|competitor/i);
});
