// The evidence gate before a department-spend claim. This module is pure: it
// receives already-local rows, performs no I/O, and retains nothing.

export const REQUIRED_SPEND_COVERAGE_BENCHMARK = 0.9;

export const EVIDENCE_PREFLIGHT_OUTCOME = Object.freeze({
  COMPLETE: "complete",
  PROVIDER_EXPORT_ONLY: "provider-export-only",
  INSUFFICIENT: "insufficient-evidence",
});

export const OWN_DATA_PREFLIGHT_QUESTION =
  "Can this export support a trustworthy department-spend decision?";

// The static-demo boundary and the analysis this view stops short of, stated
// once. It is returned with every assessment and rendered on the page, so
// widening what the preflight does means editing the contract it displays.
export const OWN_DATA_PREFLIGHT_BOUNDARY = Object.freeze([
  "No credentials are requested, held, or transmitted.",
  "No customer data is persisted; rows live only in this tab and disappear on refresh.",
  "No prompt content is read or stored.",
  "No live provider or HRIS call is made; absent evidence is never inferred.",
  "No department rankings, savings estimates, or provider comparisons are produced here.",
]);

function nonEmptyClassification(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validCost(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Required spend coverage has a row denominator, not a dollar denominator.
 * A covered row has both a finite, non-negative Number in `costAmount` and a
 * non-empty trimmed String in `classification`. Numeric strings do not count.
 */
export function requiredSpendCoverage(rows = []) {
  const records = Array.isArray(rows) ? rows : [];
  const coveredRows = records.filter((row) => validCost(row?.costAmount)
    && nonEmptyClassification(row?.classification)).length;
  const totalRows = records.length;
  return Object.freeze({
    coveredRows,
    totalRows,
    ratio: totalRows === 0 ? 0 : coveredRows / totalRows,
    percent: totalRows === 0 ? 0 : (coveredRows / totalRows) * 100,
  });
}

/**
 * Query rows corroborate classification, so they are held to the same
 * classification rule as provider rows. A row carrying no usable
 * classification corroborates nothing and is not counted; presence in the
 * array is not evidence.
 */
function corroboratingQueryRows(rows) {
  const records = Array.isArray(rows) ? rows : [];
  return records.filter((row) => nonEmptyClassification(row?.classification)).length;
}

function percent(ratio) {
  // Floored to the printed precision: a coverage figure below the benchmark
  // must never round up onto it and contradict the verdict beside it.
  return new Intl.NumberFormat("en-US", {
    style: "percent", maximumFractionDigits: 1,
  }).format(Math.floor(ratio * 1000) / 1000);
}

/**
 * Decide the strongest claim supported by the supplied, in-memory evidence.
 * Query evidence can corroborate a sufficient provider export; it can never
 * repair provider billing coverage or trigger a lookup.
 */
export function assessOwnDataEvidence({ providerRows = [], querySampleRows = [] } = {}) {
  const coverage = requiredSpendCoverage(providerRows);
  const sufficient = coverage.coveredRows > 0
    && coverage.ratio >= REQUIRED_SPEND_COVERAGE_BENCHMARK;
  const corroboratingRows = corroboratingQueryRows(querySampleRows);
  const hasQueryEvidence = corroboratingRows > 0;
  const outcome = !sufficient
    ? EVIDENCE_PREFLIGHT_OUTCOME.INSUFFICIENT
    : hasQueryEvidence
      ? EVIDENCE_PREFLIGHT_OUTCOME.COMPLETE
      : EVIDENCE_PREFLIGHT_OUTCOME.PROVIDER_EXPORT_ONLY;

  const copy = {
    [EVIDENCE_PREFLIGHT_OUTCOME.COMPLETE]: {
      verdict: "Decision-ready within this export",
      finding: `${percent(coverage.ratio)} of spend rows carry both a valid cost and a department classification, and the bundled query sample corroborates classification evidence.`,
      confidence: "Department-spend findings may be described as decision-ready within the supplied export; this does not establish completeness beyond it.",
      nextAction: "Proceed to the department-spend decision using only the supplied export's scope.",
    },
    [EVIDENCE_PREFLIGHT_OUTCOME.PROVIDER_EXPORT_ONLY]: {
      verdict: "Provider export supports a bounded decision",
      finding: `${percent(coverage.ratio)} of spend rows carry both a valid cost and a department classification; no query-sample corroboration is present.`,
      confidence: "Department attribution is limited to fields present in the provider export; query-sample corroboration is absent.",
      nextAction: "Add one optional query sample to corroborate the provider export's department classifications.",
    },
    [EVIDENCE_PREFLIGHT_OUTCOME.INSUFFICIENT]: {
      verdict: "Insufficient evidence",
      finding: `${percent(coverage.ratio)} of spend rows carry both a valid cost and a department classification, below the evidence required for a trustworthy decision.`,
      confidence: "No trustworthy department-spend decision should be claimed from this evidence.",
      nextAction: "Correct missing or invalid cost and department values until at least 90% of spend rows are covered.",
    },
  }[outcome];

  return Object.freeze({
    question: OWN_DATA_PREFLIGHT_QUESTION,
    boundary: OWN_DATA_PREFLIGHT_BOUNDARY,
    outcome,
    sufficient,
    coverage,
    benchmark: Object.freeze({
      ratio: REQUIRED_SPEND_COVERAGE_BENCHMARK,
      label: "90% required spend coverage",
      rule: "Covered spend-record rows ÷ all spend-record rows; zero rows equals 0% and is insufficient."
        + " 90% is a stated assumption, not a measured constant: under it the unclassified remainder"
        + " can be larger than the gap between the departments this view would rank, so the ranking"
        + " is not defensible against the director it grades.",
    }),
    provenance: Object.freeze([
      Object.freeze({ source: "Bundled provider export", available: coverage.totalRows > 0,
        detail: `${coverage.totalRows} spend rows read in this tab.` }),
      Object.freeze({ source: "Bundled optional query sample", available: hasQueryEvidence,
        detail: hasQueryEvidence
          ? `${corroboratingRows} query-sample rows carry a department classification and corroborate it.`
          : "No classified query rows supplied; no provider billing evidence is inferred and no lookup is attempted." }),
    ]),
    ...copy,
  });
}

// A small invented package makes the gate legible before a visitor selects a
// file. It is not reused by the existing demo analysis and changes none of its
// figures or behavior.
export const BUNDLED_OWN_DATA_EVIDENCE = Object.freeze({
  providerRows: Object.freeze([
    { costAmount: 128.4, classification: "Engineering" },
    { costAmount: 84.2, classification: "Engineering" },
    { costAmount: 63.1, classification: "Product" },
    { costAmount: 41.8, classification: "Support" },
    { costAmount: 32.5, classification: "Finance" },
    { costAmount: 29.9, classification: "Product" },
    { costAmount: 17.3, classification: "Support" },
    { costAmount: 11.2, classification: "Finance" },
    { costAmount: 0, classification: "Engineering" },
    { costAmount: 9.6, classification: "" },
  ]),
  querySampleRows: Object.freeze([
    { classification: "Engineering" },
    { classification: "Product" },
    { classification: "Support" },
  ]),
});
