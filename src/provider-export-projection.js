// Deterministic, browser-local projection for one provider billing export.
//
// This module has no I/O: no fetch, credentials, logging, storage, clock, or
// retained upload. The page may pass File text to `parseProviderExport`, or an
// already-validated document to `projectProviderExport`; both return data only.
//
// WHAT THE EXPORT SAYS ABOUT ITSELF IS PART OF THE ANSWER. A provider export
// declares its own `snapshot.completeness`, `omitted_record_count`, `issues`,
// and a per-row `cost.status`. Summing rows without reading those four fields
// produces a total that looks whole and is not, so each one is carried into the
// result, weakens confidence, and can claim the single prioritized action.
// Nothing here infers an omitted record, finalizes an estimated charge, or
// treats absence as zero.
//
// DETERMINISM IS THE CONTRACT. Ordering uses code-unit comparison rather than
// `localeCompare`, whose result depends on the host's collation; the same file
// projects identically on every machine, in any record order.

import { BLANK_GROUP_PSEUDONYM } from "./attribution-units.js";
import { MAX_IMPORT_BYTES } from "./import-limits.js";
import { LOCAL_KINDS, parseLocalFinopsFile } from "./local-finops.js";
import {
  EVIDENCE_PREFLIGHT_OUTCOME, OWN_DATA_PREFLIGHT_BOUNDARY, OWN_DATA_PREFLIGHT_QUESTION,
  REQUIRED_SPEND_COVERAGE_BENCHMARK,
} from "./own-data-evidence-preflight.js";
import { readUsageDetail } from "./provider-usage-record.js";
import { buildModelOverspendFinding } from "./model-overspend-finding.js";
import { spendOnlyFigures } from "./spend-only-tier.js";

export const PROVIDER_EXPORT_PROJECTION_VERSION = "provider-export-projection/1.0.0";
export const MODEL_OVERSPEND_PROJECTION_VERSION = "model-overspend-projection/1.0.0";

/** The validated provider fields consumed by the model-overspend producer. */
export const MODEL_OVERSPEND_SOURCE_COLUMNS = Object.freeze({
  period: "usage_date",
  segment: "org_unit_id",
  model: "model_raw",
  requests: "request_count",
  spend: "cost.amount_minor",
});

export const PROVIDER_EXPORT_ERROR = Object.freeze({
  MALFORMED: "malformed_file",
  OVERSIZED: "oversized_file",
  UNSUPPORTED: "unsupported_file",
});

const ERROR_COPY = Object.freeze({
  [PROVIDER_EXPORT_ERROR.MALFORMED]: Object.freeze({
    message: "The provider export is malformed and was not analyzed.",
    recovery: "Re-export valid JSON and choose the new file.",
  }),
  [PROVIDER_EXPORT_ERROR.OVERSIZED]: Object.freeze({
    message: "The provider export is larger than the browser-local limit and was not read.",
    recovery: "Choose a provider export within the stated file-size limit.",
  }),
  [PROVIDER_EXPORT_ERROR.UNSUPPORTED]: Object.freeze({
    message: "The selected file is not a supported provider billing export.",
    recovery: "Choose a supported provider-usage JSON export in USD.",
  }),
});

function errorResult(code) {
  return Object.freeze({ ok: false, error: Object.freeze({ code, ...ERROR_COPY[code] }) });
}

function utf8Bytes(text) {
  return new TextEncoder().encode(typeof text === "string" ? text : "").byteLength;
}

function errorCode(error) {
  if (["unsupported_format", "unsupported_contract", "unsupported_currency"]
    .includes(error?.code)) return PROVIDER_EXPORT_ERROR.UNSUPPORTED;
  return PROVIDER_EXPORT_ERROR.MALFORMED;
}

/**
 * Parse one bounded JSON provider export without throwing or echoing file data.
 * `byteSize` should be File.size; UTF-8 text is measured when it is unavailable.
 */
export function parseProviderExport({
  text = "", fileName = "provider.json", mediaType = "", byteSize,
} = {}) {
  const observed = Number.isFinite(byteSize) ? byteSize : utf8Bytes(text);
  if (observed > MAX_IMPORT_BYTES) return errorResult(PROVIDER_EXPORT_ERROR.OVERSIZED);
  try {
    const parsed = parseLocalFinopsFile(text, fileName, mediaType);
    if (parsed.type !== "provider") return errorResult(PROVIDER_EXPORT_ERROR.UNSUPPORTED);
    const result = projectProviderExport(parsed.document);
    return result.ok ? Object.freeze({ ok: true, parsed, result }) : result;
  } catch (error) {
    return errorResult(errorCode(error));
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Code-unit order. Host collation settings cannot change this answer. */
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/** The fields this projection reads. A record missing any of them fails closed. */
const readable = (row) => typeof row?.aggregate_id === "string"
  && Number.isInteger(row?.revision) && Number.isInteger(row?.cost?.amount_minor);

/**
 * Highest revision per aggregate, in a stable order, plus what was dropped.
 *
 * A superseded or byte-identical row is an expected consequence of a reordered
 * or re-sent export and is dropped quietly. Two rows sharing an aggregate *and*
 * a revision while differing in content are not: one of them is wrong, the
 * export does not say which, and the count is reported rather than swallowed.
 */
function normalizedRecords(records) {
  const ordered = [...records].sort((left, right) =>
    compare(left.aggregate_id, right.aggregate_id) || right.revision - left.revision
    || compare(canonical(left), canonical(right)));
  const kept = [];
  let supersededRows = 0;
  let conflictingRevisions = 0;
  for (const row of ordered) {
    const previous = kept.at(-1);
    if (previous?.aggregate_id !== row.aggregate_id) kept.push(row);
    else if (previous.revision !== row.revision || canonical(previous) === canonical(row)) {
      supersededRows += 1;
    } else conflictingRevisions += 1;
  }
  return { records: kept, supersededRows, conflictingRevisions };
}

const calendarMonth = (date) => /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)
  ? date.slice(0, 7) : null;

function daysInMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Produce the existing model-overspend contract solely from accepted provider
 * rows. Missing v1.1 evidence is a withheld result, not an exception or zero.
 */
export function projectModelOverspendFinding(document) {
  const base = { version: MODEL_OVERSPEND_PROJECTION_VERSION };
  if (!document || document.kind !== LOCAL_KINDS.provider || !Array.isArray(document.records)) {
    return Object.freeze({ ...base, finding: null, confidence: "unavailable",
      provenance: null, withholding: Object.freeze([{ code: "unsupported_export",
        fields: Object.freeze(Object.values(MODEL_OVERSPEND_SOURCE_COLUMNS)) }]) });
  }
  const malformed = document.records.filter((row) => !readable(row)
    || calendarMonth(row.usage_date) === null || typeof row.org_unit_id !== "string");
  if (malformed.length) {
    return Object.freeze({ ...base, finding: null, confidence: "unavailable",
      provenance: Object.freeze({ source: "selected_provider_export",
        sourceRows: document.records.length, acceptedRows: 0, rejectedRows: malformed.length,
        processing: "in_browser_memory_only" }),
      withholding: Object.freeze([{ code: "malformed_source_rows",
        count: malformed.length, fields: Object.freeze(Object.values(MODEL_OVERSPEND_SOURCE_COLUMNS)) }]) });
  }
  const { records, supersededRows, conflictingRevisions } = normalizedRecords(document.records);
  if (conflictingRevisions) {
    return Object.freeze({ ...base, finding: null, confidence: "unavailable",
      provenance: Object.freeze({ source: "selected_provider_export",
        sourceRows: document.records.length, acceptedRows: records.length,
        rejectedRows: conflictingRevisions, supersededRows, processing: "in_browser_memory_only" }),
      withholding: Object.freeze([{ code: "conflicting_revisions", count: conflictingRevisions }]) });
  }
  const groups = new Map();
  for (const record of records) {
    const detail = readUsageDetail(record);
    const period = calendarMonth(record.usage_date);
    const model = detail.model_raw ?? "";
    const key = `${period}\u0000${record.org_unit_id}\u0000${model}`;
    const group = groups.get(key) ?? { period, segmentId: record.org_unit_id,
      segmentLabel: record.org_unit_id || "segment (unnamed)", model, requests: 0,
      spendMinor: 0, observed: new Set(), daysInPeriod: daysInMonth(period), rowCount: 0,
      requestsMissing: false };
    group.spendMinor += record.cost.amount_minor;
    if (detail.request_count === null) group.requestsMissing = true;
    else group.requests += detail.request_count;
    group.observed.add(record.usage_date);
    group.rowCount += 1;
    groups.set(key, group);
  }
  if (!groups.size || [...groups.values()].some((group) =>
    !Number.isSafeInteger(group.spendMinor) || !Number.isSafeInteger(group.requests))) {
    return Object.freeze({ ...base, finding: null, confidence: "unavailable",
      provenance: Object.freeze({ source: "selected_provider_export", sourceRows: records.length,
        acceptedRows: 0, rejectedRows: records.length, supersededRows,
        processing: "in_browser_memory_only" }),
      withholding: Object.freeze([{ code: groups.size ? "unsafe_aggregate" : "no_source_rows" }]) });
  }
  const rows = [...groups.values()].map((group) => ({
    period: group.period, segmentId: group.segmentId, segmentLabel: group.segmentLabel,
    model: group.model, requests: group.requestsMissing ? null : group.requests,
    spendMinor: group.spendMinor, observedDays: group.observed.size,
    daysInPeriod: group.daysInPeriod, rowCount: group.rowCount,
  }));
  const finding = buildModelOverspendFinding({ columns: MODEL_OVERSPEND_SOURCE_COLUMNS, rows });
  const missingModels = records.filter((row) => readUsageDetail(row).model_raw === null).length;
  const missingRequests = records.filter((row) => readUsageDetail(row).request_count === null).length;
  const withholding = [
    missingModels ? Object.freeze({ code: "model_identifier_missing", count: missingModels,
      field: MODEL_OVERSPEND_SOURCE_COLUMNS.model }) : null,
    missingRequests ? Object.freeze({ code: "request_count_missing", count: missingRequests,
      field: MODEL_OVERSPEND_SOURCE_COLUMNS.requests }) : null,
  ].filter(Boolean);
  return Object.freeze({ ...base, finding, confidence: finding.confidence.level,
    provenance: Object.freeze({ source: "selected_provider_export", sourceRows: document.records.length,
      acceptedRows: records.length, rejectedRows: 0, supersededRows,
      columns: MODEL_OVERSPEND_SOURCE_COLUMNS, processing: "in_browser_memory_only" }),
    withholding: Object.freeze(withholding) });
}

const cents = (records) => records.reduce((sum, row) => sum + row.cost.amount_minor, 0);
const dollars = (minor) => Math.round(minor) / 100;
const attributed = (row) => {
  const value = String(row?.org_unit_id ?? "").trim();
  return value !== "" && value !== BLANK_GROUP_PSEUDONYM;
};

function classificationCoverage(records) {
  const complete = records.filter((row) => {
    const detail = readUsageDetail(row);
    return detail.model_raw !== null && detail.model_tier !== null
      && detail.request_count !== null;
  });
  return Object.freeze({
    completeRows: complete.length,
    totalRows: records.length,
    ratio: records.length ? complete.length / records.length : 0,
  });
}

/**
 * What the export declares about its own coverage, read from the snapshot the
 * validator already accepted. `complete` is the conjunction: a partial export,
 * an omitted-record count, or any declared issue all mean the same thing to a
 * reader, which is that rows are missing from this total.
 */
function declaredCompleteness(snapshot) {
  const issueCodes = Object.freeze([...new Set((snapshot.issues ?? [])
    .map((issue) => String(issue?.code ?? "")).filter(Boolean))].sort());
  const omittedRecordCount = Number.isInteger(snapshot.omitted_record_count)
    ? snapshot.omitted_record_count : 0;
  return Object.freeze({
    declared: snapshot.completeness === "complete" ? "complete" : "partial",
    omittedRecordCount,
    issueCodes,
    complete: snapshot.completeness === "complete" && omittedRecordCount === 0
      && issueCodes.length === 0,
  });
}

/** Estimated charges are summed like any other row and named, never dropped. */
function costBasis(records) {
  const estimated = records.filter((row) => row.cost?.status !== "final");
  return Object.freeze({
    basis: estimated.length ? "mixed_estimated" : "final",
    finalRows: records.length - estimated.length,
    estimatedRows: estimated.length,
    estimatedSpendUsd: dollars(cents(estimated)),
  });
}

/**
 * The single prioritized action, chosen by the first unmet condition. The
 * order is the order in which a gap invalidates the figure above it: rows the
 * export admits it omitted make the total wrong, missing grouping makes the
 * split wrong, missing model fields make the mix unknown, and estimated
 * charges make the total provisional. Only the last rung is a corroboration
 * ask rather than a repair.
 */
const ACTION_LADDER = Object.freeze([
  Object.freeze({ code: "collect_complete_export", met: (gate) => gate.complete,
    text: "Re-export the period once the provider reports it complete; this export declares omitted records or data-quality issues, so the total is directional." }),
  Object.freeze({ code: "collect_department_attribution", met: (gate) => gate.attribution,
    text: "Add provider grouping values for the unattributed spend rows, then export again." }),
  Object.freeze({ code: "collect_classification_evidence", met: (gate) => gate.classification,
    text: "Add one bounded query sample to verify query-level classification before acting on model mix." }),
  Object.freeze({ code: "collect_final_costs", met: (gate) => gate.finalCosts,
    text: "Re-export after the provider finalizes the estimated charges; the total is provisional until then." }),
  Object.freeze({ code: "collect_query_corroboration", met: () => false,
    text: "Add one bounded query sample to corroborate provider-side classifications." }),
]);

function limitationsFor(gate, completeness, basis) {
  const notes = [];
  if (!gate.complete) {
    notes.push(`The export declares completeness "${completeness.declared}" with `
      + `${completeness.omittedRecordCount} omitted records and `
      + `${completeness.issueCodes.length} data-quality issues; omitted rows are not inferred.`);
  }
  if (!gate.attribution) notes.push("Some rows carry no provider grouping value, so the department split covers less than the total.");
  if (!gate.classification) notes.push("Model and call-shape fields are absent on some rows, so model mix is not established.");
  if (!gate.finalCosts) notes.push(`${basis.estimatedRows} rows carry estimated rather than final charges.`);
  return Object.freeze(notes);
}

/**
 * Project a document already accepted by the provider-usage validator.
 *
 * Spend is summed in integer minor units and converted once. Coverage is both
 * row- and spend-weighted. Classification coverage means only that model and
 * call-shape fields are present; it never means query content was classified.
 */
export function projectProviderExport(document) {
  if (!document || document.kind !== LOCAL_KINDS.provider
    || !Array.isArray(document.records) || !document.snapshot) {
    return errorResult(PROVIDER_EXPORT_ERROR.UNSUPPORTED);
  }
  if (!document.records.every(readable)) return errorResult(PROVIDER_EXPORT_ERROR.MALFORMED);
  const { records, supersededRows, conflictingRevisions } = normalizedRecords(document.records);
  const totalMinor = cents(records);
  const attributedRows = records.filter(attributed);
  const attributedMinor = cents(attributedRows);
  if (!Number.isSafeInteger(totalMinor) || !Number.isSafeInteger(attributedMinor)) {
    return errorResult(PROVIDER_EXPORT_ERROR.MALFORMED);
  }
  const departmentCoverage = Object.freeze({
    attributedRows: attributedRows.length,
    totalRows: records.length,
    rowRatio: records.length ? attributedRows.length / records.length : 0,
    attributedSpendUsd: dollars(attributedMinor),
    totalSpendUsd: dollars(totalMinor),
    spendRatio: totalMinor > 0 ? attributedMinor / totalMinor : null,
  });
  const classification = classificationCoverage(records);
  const completeness = declaredCompleteness(document.snapshot);
  const basis = costBasis(records);
  const gate = Object.freeze({
    complete: completeness.complete && conflictingRevisions === 0,
    attribution: departmentCoverage.rowRatio === 1,
    classification: classification.ratio === 1,
    finalCosts: basis.estimatedRows === 0,
  });
  const rung = ACTION_LADDER.find((entry) => !entry.met(gate));
  const bounded = gate.complete && gate.attribution && gate.classification && gate.finalCosts;
  // A BILLING-ONLY EXPORT IS NOT A REFUSAL (#1168). Rows priced and grouped
  // nowhere — not one grouping value in the file — used to fall out of the
  // benchmark comparison below as `insufficient-evidence`, which reads as "this
  // file bought you nothing". Spend alone still answers what the period cost and
  // how that divides by model, so the downgraded tier is computed here and the
  // figures it cannot reach are withheld BY NAME rather than left blank.
  // Deliberately the zero case only: a partly attributed export has a coverage
  // percentage to be judged against the benchmark, and that judgment is unchanged.
  const spendOnly = records.length > 0 && attributedRows.length === 0
    ? spendOnlyFigures(records) : null;
  // The merged preflight owns the vocabulary this region is styled from, so the
  // projection answers in it. `complete` is deliberately unreachable here: it
  // requires query-sample corroboration, which a billing export cannot supply.
  const preflightOutcome = spendOnly ? EVIDENCE_PREFLIGHT_OUTCOME.SPEND_ONLY
    : !completeness.complete || records.length === 0
      || departmentCoverage.rowRatio < REQUIRED_SPEND_COVERAGE_BENCHMARK
      ? EVIDENCE_PREFLIGHT_OUTCOME.INSUFFICIENT
      : EVIDENCE_PREFLIGHT_OUTCOME.PROVIDER_EXPORT_ONLY;

  return Object.freeze({
    ok: true,
    version: PROVIDER_EXPORT_PROJECTION_VERSION,
    input: Object.freeze({ kind: document.kind, schemaVersion: document.schema_version,
      exportId: document.export_id, periodStart: document.snapshot?.period_start ?? null,
      periodEnd: document.snapshot?.period_end ?? null }),
    spend: Object.freeze({ amountMinor: totalMinor, amountUsd: dollars(totalMinor), currency: "USD" }),
    departmentCoverage,
    completeness,
    costBasis: basis,
    classificationEvidence: Object.freeze({ ...classification,
      queryLevelCertainty: "not_claimed",
      limitation: "Provider billing fields do not establish query-level classification certainty." }),
    confidence: Object.freeze({
      level: bounded ? "bounded" : "limited",
      basis: bounded
        ? "Spend total, provider grouping coverage, and model fields are computed from validated export rows the export declares complete."
        : "Spend total is computed from the accepted rows, but the export does not support every figure beside it.",
      limitations: limitationsFor(gate, completeness, basis),
      limitation: "Confidence is limited to this export; no completeness beyond it is inferred.",
    }),
    preflightOutcome,
    /** The downgraded tier's two lists, or null when this is not that tier. */
    spendOnly,
    provenance: Object.freeze({
      source: "selected_provider_export", recordCount: records.length,
      schemaVersion: document.schema_version, exportId: document.export_id,
      generatedAt: document.snapshot?.generated_at ?? null,
      sequence: document.snapshot?.sequence ?? null,
      supersededRows, conflictingRevisions,
      processing: "in_browser_memory_only",
    }),
    actions: Object.freeze([Object.freeze({ code: rung.code, text: rung.text })]),
  });
}

const percent = (ratio) => new Intl.NumberFormat("en-US", {
  // Floored to the printed precision, matching the preflight: a coverage figure
  // below the benchmark must never round up onto it and contradict the verdict.
  style: "percent", maximumFractionDigits: 1,
}).format(Math.floor(ratio * 1000) / 1000);

const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(value);

/**
 * The projection restated in the merged preflight's own contract.
 *
 * The shipped region has one closed outcome vocabulary, one benchmark, and one
 * render function. Painting it from a second vocabulary would leave a
 * below-benchmark export styled like a passing one, so the adapter lives here —
 * beside the data — rather than in the DOM layer.
 */
export function providerExportPreflight(projection) {
  const { departmentCoverage: coverage, completeness, provenance } = projection;
  const spendOnly = projection.spendOnly ?? null;
  // A downgraded result is not a sufficient one. It carries figures, which is
  // the whole point of it, and it still cannot answer the department-spend
  // question this region asks — so it never claims the bounded verdict.
  const sufficient = !spendOnly
    && projection.preflightOutcome !== EVIDENCE_PREFLIGHT_OUTCOME.INSUFFICIENT;
  const conflicts = provenance.conflictingRevisions;
  return Object.freeze({
    question: OWN_DATA_PREFLIGHT_QUESTION,
    boundary: OWN_DATA_PREFLIGHT_BOUNDARY,
    outcome: projection.preflightOutcome,
    sufficient,
    coverage: Object.freeze({
      coveredRows: coverage.attributedRows,
      totalRows: coverage.totalRows,
      ratio: coverage.rowRatio,
      percent: coverage.rowRatio * 100,
    }),
    benchmark: Object.freeze({
      ratio: REQUIRED_SPEND_COVERAGE_BENCHMARK,
      label: "90% required spend coverage",
      rule: "Attributed spend rows ÷ all accepted spend rows; zero rows equals 0% and is insufficient.",
    }),
    provenance: Object.freeze([
      Object.freeze({ source: "Selected provider export", available: coverage.totalRows > 0,
        detail: `${provenance.recordCount} rows accepted at schema ${provenance.schemaVersion}, `
          + `processed in browser memory only. ${provenance.supersededRows} superseded and `
          + `${conflicts} conflicting revisions were not counted.` }),
      Object.freeze({ source: "Export's own completeness declaration",
        available: completeness.complete,
        detail: completeness.complete
          ? "The export declares itself complete with no omitted records or issues."
          : `Declared "${completeness.declared}" with ${completeness.omittedRecordCount} omitted `
            + `records and ${completeness.issueCodes.length} issues; omitted rows are not inferred.` }),
      Object.freeze({ source: "Query sample", available: false,
        detail: "A billing export carries no query content; query-level classification is not claimed and no lookup is attempted." }),
    ]),
    // The downgraded tier's two lists, carried on the assessment the region
    // already renders so the DOM layer never has to re-derive which figures are
    // missing. Null on every other outcome, which is how the renderer knows.
    tier: spendOnly?.tier ?? null,
    computed: spendOnly?.computed ?? null,
    withheld: spendOnly?.withheld ?? null,
    verdict: spendOnly
      ? "Spend computed · the rest is withheld"
      : sufficient
        ? "Provider export supports a bounded decision"
        : "Insufficient evidence",
    finding: spendOnly
      ? `${money(projection.spend.amountUsd)} total spend across ${coverage.totalRows} accepted `
        + `rows, split across ${spendOnly.computed.length - 1} model bucket`
        + `${spendOnly.computed.length === 2 ? "" : "s"}. No row carries a provider grouping `
        + `value, so ${spendOnly.withheld.length} figures are withheld by name below rather `
        + "than estimated."
      : `${money(projection.spend.amountUsd)} total spend across `
        + `${coverage.totalRows} accepted rows; ${percent(coverage.rowRatio)} of rows and `
        + `${coverage.spendRatio === null ? "no" : percent(coverage.spendRatio)} of dollars carry `
        + `department attribution. ${projection.costBasis.estimatedRows} rows are estimated, not final.`,
    confidence: [
      spendOnly ? "Downgraded tier: every figure listed as computed is derived from spend alone "
        + "and may not be quoted as a full-import figure." : null,
      projection.confidence.basis, ...projection.confidence.limitations,
      projection.classificationEvidence.limitation, projection.confidence.limitation,
    ].filter(Boolean).join(" "),
    nextAction: projection.actions[0].text,
  });
}
