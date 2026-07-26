/**
 * Browser-local normalization of user-selected export files into the exact
 * input the static FinOps scoring rubric already consumes.
 *
 * The one question this module answers: **given the provider and HRIS export
 * files a finance leader picked in this tab, what is the scoring-model input
 * that those files support, and what can it not tell them?**
 *
 * Contract boundaries, deliberately narrow:
 *
 * - Output shape is owned by `scoreFinopsFixture` in `finops-evaluation.js`.
 *   The payload is the same envelope the static sample file uses
 *   (`schemaVersion`, `source`, `fixtures[]`), so `renderFinopsEvaluationPanel`
 *   consumes an imported payload and the bundled sample without a branch. The
 *   scoring model's signature is unchanged; the extra `provenance`, `quality`,
 *   and `coverage` keys ride alongside the rubric fields it reads.
 * - Schema and privacy validation is **not** re-derived here. `parseExports`
 *   delegates to `parseLocalFinopsFile` (the reviewed v1 validator) and then
 *   cross-checks the document against the required-field lists Anya's
 *   compatibility manifest declares. The manifest is authoritative: if its
 *   version, contract kinds, or `validation_reasons` codes drift away from what
 *   this module was written against, the whole selection is rejected with
 *   `unsupported_manifest` rather than silently mis-validated.
 * - Locality: no fetch, XHR, socket, credential, storage, or clock path. Files
 *   arrive as text already read at the page boundary; results live in memory
 *   for the session and are never persisted.
 * - Determinism: the same logical set of documents produces a byte-identical
 *   payload regardless of the order files were selected in or the order records
 *   appear inside a file. See DETERMINISM below.
 * - Totality: nothing here throws on bad input. Every adverse case comes back
 *   as a structured outcome in `result.outcomes`.
 *
 * DETERMINISM
 * -----------
 * 1. A document's identity digest is computed over a *canonical* form: object
 *    keys sorted, and the `records` array sorted by each record's canonical
 *    JSON. Reordering rows therefore cannot change a source's identity.
 * 2. Sources are ordered by `(contract, export_id, -sequence, -generated_at,
 *    digest, fileName)`; records by `(identity key, -revision, -source
 *    sequence, -source generated_at, source digest, canonical JSON)`. Neither
 *    key contains an array index or an arrival position.
 * 3. Record-level outcomes name the offending record by its identity key, not
 *    by its array index, because the index is not part of the logical input.
 * 4. Outcomes are sorted before they are returned.
 * 5. Reordering is never itself a warning. Out-of-order revisions resolve
 *    silently under the precedence rule below, which is the guarantee Mina's
 *    workflow can rely on: a reordered selection produces no extra outcome and
 *    no different figure.
 *
 * DEDUPE IDENTITY AND PRECEDENCE
 * ------------------------------
 * - Source identity is `(contract, export_id)`.
 *   - Same identity, same digest  -> `duplicate_delivery`; the copy whose file
 *     name sorts first is retained and the other is reported.
 *   - Same identity, different digest -> `conflicting_source_document`; the
 *     candidate with the greatest `snapshot.sequence` wins, then the latest
 *     `snapshot.generated_at`, then the lexicographically smallest digest.
 * - Record identity is `records[].aggregate_id` for provider exports and
 *   `records[].unit_id` for HRIS mappings, across every accepted source.
 *   - Greatest `revision` wins, independent of file or array order.
 *   - Equal revision, identical canonical content -> `duplicate_delivery`; one
 *     copy is retained.
 *   - Equal revision, different content -> `conflicting_record_revision`; the
 *     record from the source with the greatest sequence wins, then the latest
 *     `generated_at`, then the smallest source digest.
 *
 * Out of scope: any view, route, download, or page state; a peer benchmark (the
 * imported contracts carry no cohort); a forecast; currency conversion; and
 * sequence-gap detection, which is a delivery-transport concern and not a
 * property of a set of files a user selected.
 */

import { LOCAL_KINDS, parseLocalFinopsFile } from "./local-finops.js";
import { FINOPS_RUBRIC } from "./finops-evaluation.js";

/** This module's contract version. Bump on any output-shape change. */
export const FINOPS_EXPORT_NORMALIZATION_VERSION = "finops-export-normalization/1.0.0";

/**
 * The payload envelope version. Identical to the bundled sample payload
 * (`src/finops-evaluation-fixtures.json`) on purpose: the panel must not need
 * to know whether it was handed sample data or an import.
 */
export const ANALYSIS_INPUT_SCHEMA_VERSION = "finops-fixtures/1.0.0";

/** The manifest revision this module was written against. */
export const SUPPORTED_MANIFEST_VERSION = "1.0";

/** The contract revision this module was written against. */
export const SUPPORTED_CONTRACT_SCHEMA_VERSION = "1.0";

/**
 * Freshness target used when neither the caller nor the manifest supplies one.
 *
 * The compatibility manifest declares a `stale` validation reason but no
 * numeric target, so the default is read from `privacy.raw_quarantine_max_days`
 * (7 in v1) and falls back to this constant. Callers override it with
 * `options.freshnessMaxAgeDays`.
 */
export const DEFAULT_FRESHNESS_MAX_AGE_DAYS = 7;

/**
 * The disclosed routing scenario: the share of joined text-generation spend
 * treated as a re-routing candidate. It is a scenario, not a measured saving,
 * and it matches the share the existing local FinOps projection discloses.
 */
export const ROUTING_SCENARIO_SHARE = 0.2;

/** Every stable code this module can emit. This set is the public contract. */
export const NORMALIZATION_CODES = Object.freeze({
  ACCEPTED: "accepted",
  UNSUPPORTED_MANIFEST: "unsupported_manifest",
  UNSUPPORTED_FILE_FORMAT: "unsupported_file_format",
  INVALID_JSON: "invalid_json",
  DUPLICATE_JSON_KEY: "duplicate_json_key",
  UNSUPPORTED_CONTRACT: "unsupported_contract",
  SCHEMA_OR_PRIVACY_VIOLATION: "schema_or_privacy_violation",
  DUPLICATE_DELIVERY: "duplicate_delivery",
  CONFLICTING_SOURCE_DOCUMENT: "conflicting_source_document",
  CONFLICTING_RECORD_REVISION: "conflicting_record_revision",
  INCOMPATIBLE_SOURCE_INSTANCE: "incompatible_source_instance",
  PARTIAL_EXPORT: "partial_export",
  STALE_EXPORT: "stale_export",
  FRESHNESS_NOT_EVALUATED: "freshness_not_evaluated",
  UNATTRIBUTED_PROVIDER_RECORD: "unattributed_provider_record",
  MISSING_PROVIDER_EXPORT: "missing_provider_export",
  MISSING_HRIS_MAPPING: "missing_hris_mapping",
  NO_SCOREABLE_UNIT: "no_scoreable_unit",
});

/** Severity drives presentation, not control flow. `error` never yields a payload. */
export const NORMALIZATION_SEVERITIES = Object.freeze(["info", "warning", "error"]);

/**
 * The displayable description of every code.
 *
 * `manifestReason` names the `validation_reasons` entry in Anya's manifest the
 * code is derived from, or null where this module owns the reason. Codes that
 * carry a `manifestReason` are asserted against the manifest at parse time.
 */
export const NORMALIZATION_CODE_CATALOG = Object.freeze({
  [NORMALIZATION_CODES.ACCEPTED]: Object.freeze({
    code: NORMALIZATION_CODES.ACCEPTED,
    severity: "info",
    category: "outcome",
    manifestReason: "valid",
    message: "The source matches the allowlisted schema and passed the privacy, join, and freshness checks.",
    recovery: "No action required.",
  }),
  [NORMALIZATION_CODES.UNSUPPORTED_MANIFEST]: Object.freeze({
    code: NORMALIZATION_CODES.UNSUPPORTED_MANIFEST,
    severity: "error",
    category: "manifest",
    manifestReason: null,
    message: "The compatibility manifest is not the revision this normalizer validates against, so no file was read.",
    recovery: "Ship a normalizer built against the current manifest revision; do not edit the manifest to fit the client.",
  }),
  [NORMALIZATION_CODES.UNSUPPORTED_FILE_FORMAT]: Object.freeze({
    code: NORMALIZATION_CODES.UNSUPPORTED_FILE_FORMAT,
    severity: "error",
    category: "format",
    manifestReason: null,
    message: "The file is not one of the formats the manifest declares.",
    recovery: "Export the data as a UTF-8 JSON contract envelope and select the .json file.",
  }),
  [NORMALIZATION_CODES.INVALID_JSON]: Object.freeze({
    code: NORMALIZATION_CODES.INVALID_JSON,
    severity: "error",
    category: "format",
    manifestReason: "malformed",
    message: "The file is not valid JSON, so nothing in it was read.",
    recovery: "Re-export the file and confirm it parses before selecting it.",
  }),
  [NORMALIZATION_CODES.DUPLICATE_JSON_KEY]: Object.freeze({
    code: NORMALIZATION_CODES.DUPLICATE_JSON_KEY,
    severity: "error",
    category: "format",
    manifestReason: "malformed",
    message: "The JSON repeats an object key, so the intended value is ambiguous and the document was rejected.",
    recovery: "Correct the producer so each object key appears once, then issue a new export_id.",
  }),
  [NORMALIZATION_CODES.UNSUPPORTED_CONTRACT]: Object.freeze({
    code: NORMALIZATION_CODES.UNSUPPORTED_CONTRACT,
    severity: "error",
    category: "schema",
    manifestReason: "malformed",
    message: "The document is not a provider-usage-billing or HRIS-org envelope at the manifest's schema version.",
    recovery: "Select an export produced against the manifest-declared contract and schema version.",
  }),
  [NORMALIZATION_CODES.SCHEMA_OR_PRIVACY_VIOLATION]: Object.freeze({
    code: NORMALIZATION_CODES.SCHEMA_OR_PRIVACY_VIOLATION,
    severity: "error",
    category: "schema",
    manifestReason: "malformed",
    message: "The document violates the allowlisted schema or the privacy contract, so the whole document was rejected.",
    recovery: "Remove prohibited data, correct the mapping, validate against the exact schema, and issue a new export_id.",
  }),
  [NORMALIZATION_CODES.DUPLICATE_DELIVERY]: Object.freeze({
    code: NORMALIZATION_CODES.DUPLICATE_DELIVERY,
    severity: "warning",
    category: "duplication",
    manifestReason: "duplicated",
    message: "An identical copy was collapsed to one; it did not affect any total.",
    recovery: "Acknowledge identical retries; remove the repeated copy from the selection.",
  }),
  [NORMALIZATION_CODES.CONFLICTING_SOURCE_DOCUMENT]: Object.freeze({
    code: NORMALIZATION_CODES.CONFLICTING_SOURCE_DOCUMENT,
    severity: "warning",
    category: "duplication",
    manifestReason: "duplicated",
    message: "Two documents share an export_id but differ in content; the greatest sequence was retained and the other discarded.",
    recovery: "Stop the source and issue a corrected export with a higher revision and a new export_id.",
  }),
  [NORMALIZATION_CODES.CONFLICTING_RECORD_REVISION]: Object.freeze({
    code: NORMALIZATION_CODES.CONFLICTING_RECORD_REVISION,
    severity: "warning",
    category: "duplication",
    manifestReason: "duplicated",
    message: "Two records share an identity and revision but differ in content; the greatest source sequence was retained.",
    recovery: "Stop the source and issue a corrected record at a higher revision.",
  }),
  [NORMALIZATION_CODES.INCOMPATIBLE_SOURCE_INSTANCE]: Object.freeze({
    code: NORMALIZATION_CODES.INCOMPATIBLE_SOURCE_INSTANCE,
    severity: "warning",
    category: "coverage",
    manifestReason: null,
    message: "The source belongs to a different producer instance than the accepted majority, so it was excluded from every total.",
    recovery: "Analyze each source instance separately, or select exports from one instance.",
  }),
  [NORMALIZATION_CODES.PARTIAL_EXPORT]: Object.freeze({
    code: NORMALIZATION_CODES.PARTIAL_EXPORT,
    severity: "warning",
    category: "coverage",
    manifestReason: "partial",
    message: "The export declares partial completeness, omitted records, or a data-quality issue; totals are estimate-only.",
    recovery: "Retry the missing page, then request a complete closed-period export.",
  }),
  [NORMALIZATION_CODES.STALE_EXPORT]: Object.freeze({
    code: NORMALIZATION_CODES.STALE_EXPORT,
    severity: "warning",
    category: "freshness",
    manifestReason: "stale",
    message: "The export is older than the freshness target, so it cannot reconcile an invoice.",
    recovery: "Verify the producer clock and request a new complete export.",
  }),
  [NORMALIZATION_CODES.FRESHNESS_NOT_EVALUATED]: Object.freeze({
    code: NORMALIZATION_CODES.FRESHNESS_NOT_EVALUATED,
    severity: "info",
    category: "freshness",
    manifestReason: null,
    message: "No reference timestamp was supplied, so staleness was not evaluated; this module never reads a clock.",
    recovery: "Pass options.referenceTimestamp as an ISO 8601 string at the call boundary.",
  }),
  [NORMALIZATION_CODES.UNATTRIBUTED_PROVIDER_RECORD]: Object.freeze({
    code: NORMALIZATION_CODES.UNATTRIBUTED_PROVIDER_RECORD,
    severity: "warning",
    category: "attribution",
    manifestReason: null,
    message: "The provider aggregate matched no active HRIS unit, so it was excluded rather than assigned a default unit.",
    recovery: "Supply the HRIS mapping that contains the unit, pseudonymized with the same key and salt scope.",
  }),
  [NORMALIZATION_CODES.MISSING_PROVIDER_EXPORT]: Object.freeze({
    code: NORMALIZATION_CODES.MISSING_PROVIDER_EXPORT,
    severity: "error",
    category: "coverage",
    manifestReason: null,
    message: "No provider usage export was accepted, so there is no spend to analyze.",
    recovery: "Select at least one schema-valid provider-usage-billing export.",
  }),
  [NORMALIZATION_CODES.MISSING_HRIS_MAPPING]: Object.freeze({
    code: NORMALIZATION_CODES.MISSING_HRIS_MAPPING,
    severity: "error",
    category: "coverage",
    manifestReason: null,
    message: "No HRIS mapping was accepted, and the manifest forbids assigning a default unit, so no spend can be attributed.",
    recovery: "Select the HRIS-org mapping export that covers the provider period.",
  }),
  [NORMALIZATION_CODES.NO_SCOREABLE_UNIT]: Object.freeze({
    code: NORMALIZATION_CODES.NO_SCOREABLE_UNIT,
    severity: "error",
    category: "attribution",
    manifestReason: null,
    message: "No provider aggregate joined an active HRIS unit, so no scoring input could be built.",
    recovery: "Confirm the provider org_unit_id values match HRIS unit_id values produced with the same tenant key.",
  }),
});

/**
 * The rating rules.
 *
 * Each rubric criterion carries exactly four requirements, each worth one
 * point, so the rating is the count of satisfied requirements on the rubric's
 * own 0–4 scale. The evidence string the scoring model requires is generated
 * from the same list, which is why a reader can always see which requirement
 * cost a point. Requirements are pure predicates over the normalized unit and
 * the coverage descriptor — no clock, no randomness, no ordering.
 */
export const RATING_RULES = Object.freeze([
  Object.freeze({
    key: "recommendationQuality",
    requirements: Object.freeze([
      Object.freeze({
        id: "attributed_spend",
        label: "the unit has attributed spend above zero",
        satisfied: (unit) => unit.spendMinor > 0,
      }),
      Object.freeze({
        id: "routable_candidate",
        label: "some joined spend falls in a re-routable service category",
        satisfied: (unit) => unit.routableMinor > 0,
      }),
      Object.freeze({
        id: "bounded_period",
        label: "the action is bounded by a closed export period",
        satisfied: (unit, coverage) => coverage.periodDays > 0,
      }),
      Object.freeze({
        id: "measurable_baseline",
        label: "every joined cost is final, so the trial can be measured against it",
        satisfied: (unit) => unit.recordCount > 0 && unit.estimatedCount === 0,
      }),
    ]),
  }),
  Object.freeze({
    key: "costEvidence",
    requirements: Object.freeze([
      Object.freeze({
        id: "accepted_aggregate",
        label: "at least one accepted provider aggregate supports the figure",
        satisfied: (unit) => unit.recordCount >= 1,
      }),
      Object.freeze({
        id: "complete_provider_coverage",
        label: "every accepted provider export is complete with no omitted records",
        satisfied: (unit, coverage) => coverage.providerCompleteness === "complete"
          && coverage.providerOmittedRecordCount === 0,
      }),
      Object.freeze({
        id: "final_costs",
        label: "no joined cost is an estimate",
        satisfied: (unit) => unit.recordCount > 0 && unit.finalCount === unit.recordCount,
      }),
      Object.freeze({
        id: "single_comparison_window",
        label: "the accepted exports describe one comparable period",
        satisfied: (unit, coverage) => coverage.periodCount === 1 && coverage.periodDays > 0,
      }),
    ]),
  }),
  Object.freeze({
    key: "uncertainty",
    requirements: Object.freeze([
      Object.freeze({
        id: "bounded_scenario",
        label: "the recoverable figure is a disclosed share of observed spend and never exceeds it",
        satisfied: (unit) => unit.recoverableMinor <= unit.spendMinor,
      }),
      Object.freeze({
        id: "declared_limits",
        label: "the payload enumerates what the analysis cannot answer",
        satisfied: (unit, coverage) => coverage.cannotAnswer.length > 0,
      }),
      Object.freeze({
        id: "complete_sources",
        label: "no accepted source declared partial coverage",
        satisfied: (unit, coverage) => coverage.state === "complete",
      }),
      Object.freeze({
        id: "fresh_sources",
        label: "every accepted source is within the freshness target",
        satisfied: (unit, coverage) => coverage.freshness.state === "fresh",
      }),
    ]),
  }),
  Object.freeze({
    key: "privacySafety",
    requirements: Object.freeze([
      Object.freeze({
        id: "no_direct_identifiers",
        label: "every accepted source excludes direct identifiers",
        satisfied: (unit, coverage) => coverage.privacy.directIdentifiersExcluded,
      }),
      Object.freeze({
        id: "no_provider_content",
        label: "every provider source excludes prompt and response content",
        satisfied: (unit, coverage) => coverage.privacy.providerContentExcluded,
      }),
      Object.freeze({
        id: "group_threshold",
        label: "provider aggregation meets the minimum group size of 10",
        satisfied: (unit, coverage) => coverage.privacy.minimumGroupSize >= 10,
      }),
      Object.freeze({
        id: "pseudonymous_join",
        label: "the join uses the declared pseudonymization method and salt scope",
        satisfied: (unit, coverage) => coverage.privacy.pseudonymousJoin,
      }),
    ]),
  }),
  Object.freeze({
    key: "departmentAttribution",
    requirements: Object.freeze([
      Object.freeze({
        id: "exact_unit_join",
        label: "spend joined an active HRIS unit on an exact opaque-ID match",
        satisfied: (unit) => unit.recordCount >= 1,
      }),
      Object.freeze({
        id: "department_unit_type",
        label: "the joined unit is typed as a department",
        satisfied: (unit) => unit.unitType === "department",
      }),
      Object.freeze({
        id: "known_parent",
        label: "the unit's parent is a root or is present in the accepted mapping",
        satisfied: (unit) => unit.parentKnown,
      }),
      Object.freeze({
        id: "complete_hris_coverage",
        label: "every accepted HRIS mapping is complete with no omitted records",
        satisfied: (unit, coverage) => coverage.hrisCompleteness === "complete"
          && coverage.hrisOmittedRecordCount === 0,
      }),
    ]),
  }),
]);

const PROVIDER_CONTRACT = "provider_export";
const HRIS_CONTRACT = "hris_mapping";
const CONTRACT_BY_KIND = Object.freeze({
  [LOCAL_KINDS.provider]: PROVIDER_CONTRACT,
  [LOCAL_KINDS.hris]: HRIS_CONTRACT,
});
const IDENTITY_KEY = Object.freeze({
  [PROVIDER_CONTRACT]: "aggregate_id",
  [HRIS_CONTRACT]: "unit_id",
});
/** Coarse categories whose spend the routing scenario may apply to. */
const ROUTABLE_SERVICE_CATEGORIES = Object.freeze(["text-generation"]);
const DAY_MS = 86_400_000;
const FIXTURE_ID_LIMIT = 64;

/** Underlying parser codes that all mean "the document violated the contract". */
const SCHEMA_VIOLATION_CODES = Object.freeze([
  "malformed_document", "unknown_field", "missing_field", "invalid_value",
  "privacy_violation", "unsupported_currency", "record_outside_period",
  "malformed_period", "duplicate_record",
]);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Stable serialization: object keys sorted, arrays kept in place. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

/**
 * A non-cryptographic content fingerprint (two interleaved FNV-1a style 32-bit
 * lanes). It is used only to compare and label documents that are already in
 * the tab; it is never a security control and never leaves the session.
 */
function digestOf(text) {
  let low = 0x811c9dc5;
  let high = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193) >>> 0;
    high = Math.imul(high ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${low.toString(16).padStart(8, "0")}${high.toString(16).padStart(8, "0")}`;
}

function compare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Compare two arrays of primitives element by element. */
function compareKeys(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const order = compare(left[index], right[index]);
    if (order !== 0) return order;
  }
  return 0;
}

function epochOf(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dayEpoch(date) {
  return epochOf(`${date}T00:00:00Z`);
}

function money(minor) {
  return Math.round(minor) / 100;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

function makeOutcome(code, {
  file = null, contract = null, exportId = null, recordId = null,
  row = null, field = null, detail = null,
} = {}) {
  const entry = NORMALIZATION_CODE_CATALOG[code];
  return Object.freeze({
    code,
    severity: entry.severity,
    category: entry.category,
    manifestReason: entry.manifestReason,
    message: detail ? `${entry.message} ${detail}` : entry.message,
    recovery: entry.recovery,
    source: Object.freeze({ file, contract, exportId, recordId, row, field }),
  });
}

function sortOutcomes(outcomes) {
  return [...outcomes].sort((left, right) => compareKeys(
    [left.code, left.source.file ?? "", left.source.exportId ?? "",
      left.source.recordId ?? "", left.source.field ?? "",
      left.source.row ?? -1, left.message],
    [right.code, right.source.file ?? "", right.source.exportId ?? "",
      right.source.recordId ?? "", right.source.field ?? "",
      right.source.row ?? -1, right.message],
  ));
}

function statusFor(outcomes, hasPayload) {
  if (!hasPayload) return "rejected";
  return outcomes.some((item) => item.severity !== "info") ? "partially_accepted" : "accepted";
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * Confirm the manifest is the revision this module validates against.
 *
 * The manifest owns the contract; this module only consumes it. Anything that
 * does not match is reported instead of guessed, so a manifest change is a
 * loud, testable failure rather than a silently wrong analysis.
 *
 * @returns {string|null} a displayable reason, or null when the manifest is usable.
 */
function manifestProblem(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return "No compatibility manifest object was supplied.";
  }
  if (manifest.kind !== "wawalu.integration.browser-compatibility") {
    return `Manifest kind "${String(manifest.kind)}" is not the browser-compatibility manifest.`;
  }
  if (manifest.manifest_version !== SUPPORTED_MANIFEST_VERSION) {
    return `Manifest version "${String(manifest.manifest_version)}" is not the supported ${SUPPORTED_MANIFEST_VERSION}.`;
  }
  const json = (manifest.supported_file_formats ?? []).find((item) => item?.format === "json");
  if (!json || json.duplicate_keys !== "reject") {
    return "The manifest no longer declares a JSON format that rejects duplicate keys.";
  }
  for (const [contract, kind] of [[PROVIDER_CONTRACT, LOCAL_KINDS.provider],
    [HRIS_CONTRACT, LOCAL_KINDS.hris]]) {
    const spec = manifest.contracts?.[contract];
    if (!spec) return `The manifest declares no "${contract}" contract.`;
    if (spec.kind !== kind) return `Manifest contract "${contract}" no longer declares kind "${kind}".`;
    if (spec.schema_version !== SUPPORTED_CONTRACT_SCHEMA_VERSION) {
      return `Manifest contract "${contract}" moved to schema version "${String(spec.schema_version)}".`;
    }
    if (!Array.isArray(spec.envelope_required) || !Array.isArray(spec.snapshot_required)
      || !Array.isArray(spec.record_required)) {
      return `Manifest contract "${contract}" is missing its required-field lists.`;
    }
  }
  for (const entry of Object.values(NORMALIZATION_CODE_CATALOG)) {
    if (!entry.manifestReason) continue;
    const declared = manifest.validation_reasons?.[entry.manifestReason]?.code;
    const expected = entry.manifestReason === "valid" ? NORMALIZATION_CODES.ACCEPTED
      : entry.manifestReason === "malformed" ? NORMALIZATION_CODES.SCHEMA_OR_PRIVACY_VIOLATION
        : entry.manifestReason === "partial" ? NORMALIZATION_CODES.PARTIAL_EXPORT
          : entry.manifestReason === "stale" ? NORMALIZATION_CODES.STALE_EXPORT
            : NORMALIZATION_CODES.DUPLICATE_DELIVERY;
    if (declared !== expected) {
      return `Manifest validation reason "${entry.manifestReason}" declares code `
        + `"${String(declared)}" but this normalizer emits "${expected}".`;
    }
  }
  return null;
}

/** The manifest's declared formats, as an accept test over a file name and media type. */
function unsupportedFormat(manifest, fileName, mediaType) {
  const lower = String(fileName).toLowerCase();
  const declared = manifest.supported_file_formats ?? [];
  const match = declared.find((format) =>
    (format.extensions ?? []).some((extension) => lower.endsWith(extension)));
  if (!match) {
    const rejected = (manifest.unsupported_file_formats ?? []).find((format) =>
      lower.endsWith(`.${format}`));
    return rejected
      ? `The manifest lists "${rejected}" as an unsupported format.`
      : `"${fileName}" does not use a manifest-declared extension.`;
  }
  if (mediaType && mediaType !== match.media_type && mediaType !== "text/json") {
    return `Media type "${mediaType}" is not the declared "${match.media_type}".`;
  }
  return null;
}

/** Cross-check a parsed document against the manifest's required-field lists. */
function missingRequiredField(document, spec) {
  for (const key of spec.envelope_required) {
    if (!(key in document)) return { field: key, row: null, label: `envelope field "${key}"` };
  }
  for (const key of spec.snapshot_required) {
    if (!(key in document.snapshot)) {
      return { field: `snapshot.${key}`, row: null, label: `snapshot field "${key}"` };
    }
  }
  for (let row = 0; row < document.records.length; row += 1) {
    const record = document.records[row];
    for (const key of spec.record_required) {
      if (!(key in record)) return { field: `records[].${key}`, row, label: `record field "${key}"` };
    }
    for (const [parent, keys] of Object.entries(spec.nested_required ?? {})) {
      for (const key of keys) {
        if (!record[parent] || !(key in record[parent])) {
          return { field: `records[].${parent}.${key}`, row, label: `record field "${parent}.${key}"` };
        }
      }
    }
    if (spec.upsert_required && record.operation === "upsert") {
      for (const key of spec.upsert_required) {
        if (!(key in record)) return { field: `records[].${key}`, row, label: `upsert field "${key}"` };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// parseExports
// ---------------------------------------------------------------------------

/**
 * Validate user-selected files against the compatibility manifest.
 *
 * @param {Array<{name: string, mediaType?: string, text: string}>} files
 *   Files already read to text at the page boundary. This module performs no
 *   I/O of any kind, so the caller owns the `File.text()` await.
 * @param {object} manifest Anya's parsed browser-compatibility manifest.
 * @param {{allowPartialAcceptance?: boolean}} [options]
 *   `allowPartialAcceptance` (default true) is the explicit decision that a
 *   rejected file does not reject the files beside it. Set it to false to
 *   require that every selected file is accepted or none is.
 * @returns {{ok: boolean, status: string, sources: Array, outcomes: Array, manifest: object|null}}
 *   Never throws.
 */
export function parseExports(files, manifest, options = {}) {
  const { allowPartialAcceptance = true } = options ?? {};
  const problem = manifestProblem(manifest);
  if (problem) {
    return Object.freeze({
      ok: false,
      status: "rejected",
      sources: Object.freeze([]),
      outcomes: Object.freeze([
        makeOutcome(NORMALIZATION_CODES.UNSUPPORTED_MANIFEST, { detail: problem }),
      ]),
      manifest: null,
      allowPartialAcceptance,
    });
  }

  const list = Array.isArray(files) ? files : [];
  const outcomes = [];
  const candidates = [];

  for (const file of list) {
    const fileName = String(file?.name ?? "");
    const mediaType = file?.mediaType ? String(file.mediaType) : "";
    const at = { file: fileName, contract: null, exportId: null };
    if (typeof file?.text !== "string") {
      outcomes.push(makeOutcome(NORMALIZATION_CODES.UNSUPPORTED_FILE_FORMAT, {
        ...at, detail: "No readable UTF-8 text was supplied for this selection.",
      }));
      continue;
    }
    const formatProblem = unsupportedFormat(manifest, fileName, mediaType);
    if (formatProblem) {
      outcomes.push(makeOutcome(NORMALIZATION_CODES.UNSUPPORTED_FILE_FORMAT, {
        ...at, detail: formatProblem,
      }));
      continue;
    }

    let parsed;
    try {
      parsed = parseLocalFinopsFile(file.text, fileName, mediaType);
    } catch (error) {
      const code = error?.code;
      const mapped = code === "invalid_json" ? NORMALIZATION_CODES.INVALID_JSON
        : code === "duplicate_key" ? NORMALIZATION_CODES.DUPLICATE_JSON_KEY
          : code === "unsupported_format" ? NORMALIZATION_CODES.UNSUPPORTED_FILE_FORMAT
            : code === "unsupported_contract" ? NORMALIZATION_CODES.UNSUPPORTED_CONTRACT
              // Anything else the reviewed validator rejects is a schema or
              // privacy violation. An unlisted code still fails closed, and the
              // detail says so rather than pretending the mapping was known.
              : NORMALIZATION_CODES.SCHEMA_OR_PRIVACY_VIOLATION;
      outcomes.push(makeOutcome(mapped, {
        ...at,
        detail: `${error?.message ?? "The validator rejected the document."} `
          + `(validator code ${String(code ?? "unknown")}`
          + `${SCHEMA_VIOLATION_CODES.includes(code) || mapped !== NORMALIZATION_CODES.SCHEMA_OR_PRIVACY_VIOLATION
            ? "" : ", unrecognized by this normalizer"})`,
      }));
      continue;
    }

    const document = parsed.document;
    const contract = CONTRACT_BY_KIND[document.kind];
    const spec = manifest.contracts[contract];
    const missing = missingRequiredField(document, spec);
    if (missing) {
      outcomes.push(makeOutcome(NORMALIZATION_CODES.SCHEMA_OR_PRIVACY_VIOLATION, {
        file: fileName, contract, exportId: document.export_id,
        row: missing.row, field: missing.field,
        detail: `The manifest requires ${missing.label}.`,
      }));
      continue;
    }

    // Canonicalize before fingerprinting so row order cannot change identity.
    const records = [...document.records]
      .map((record) => ({ record, canonical: canonicalJson(record) }))
      .sort((left, right) => compare(left.canonical, right.canonical))
      .map((item) => item.record);
    const canonicalDocument = { ...document, records };
    const digest = digestOf(canonicalJson(canonicalDocument));
    candidates.push({
      sourceId: `${contract}:${document.export_id}:${digest}`,
      fileName,
      mediaType,
      contract,
      kind: document.kind,
      exportId: document.export_id,
      sequence: document.snapshot.sequence,
      generatedAt: document.snapshot.generated_at,
      generatedAtMs: epochOf(document.snapshot.generated_at),
      completeness: document.snapshot.completeness,
      omittedRecordCount: document.snapshot.omitted_record_count,
      issues: document.snapshot.issues,
      sourceInstanceId: document.snapshot.source_instance_id,
      digest,
      document: canonicalDocument,
    });
  }

  // Source-level reconciliation. Order-independent by construction: the sort
  // key contains no arrival position.
  candidates.sort((left, right) => compareKeys(
    [left.contract, left.exportId, -left.sequence, -left.generatedAtMs, left.digest, left.fileName],
    [right.contract, right.exportId, -right.sequence, -right.generatedAtMs, right.digest, right.fileName],
  ));
  const retained = new Map();
  for (const candidate of candidates) {
    const identity = `${candidate.contract}:${candidate.exportId}`;
    const winner = retained.get(identity);
    if (!winner) {
      retained.set(identity, candidate);
      continue;
    }
    outcomes.push(makeOutcome(
      winner.digest === candidate.digest
        ? NORMALIZATION_CODES.DUPLICATE_DELIVERY
        : NORMALIZATION_CODES.CONFLICTING_SOURCE_DOCUMENT,
      {
        file: candidate.fileName,
        contract: candidate.contract,
        exportId: candidate.exportId,
        field: "export_id",
        detail: winner.digest === candidate.digest
          ? `The identical copy in "${winner.fileName}" was retained.`
          : `"${winner.fileName}" at sequence ${winner.sequence} was retained instead.`,
      },
    ));
  }

  const sources = [...retained.values()].sort((left, right) => compareKeys(
    [left.contract, left.exportId, left.digest],
    [right.contract, right.exportId, right.digest],
  ));
  const rejectedFiles = outcomes.filter((item) => item.severity === "error").length;
  const ok = sources.length > 0 && (allowPartialAcceptance || rejectedFiles === 0);

  return Object.freeze({
    ok,
    status: statusFor(outcomes, ok),
    sources: Object.freeze(sources.map((source) => deepFreeze({ ...source }))),
    outcomes: Object.freeze(sortOutcomes(outcomes)),
    manifest,
    allowPartialAcceptance,
  });
}

// ---------------------------------------------------------------------------
// Record reconciliation
// ---------------------------------------------------------------------------

/**
 * Collapse records across accepted sources to one per identity key.
 *
 * Precedence: greatest revision, then greatest source sequence, then latest
 * source `generated_at`, then smallest source digest. Array position is never
 * consulted, which is what makes a reordered selection produce identical
 * output and no extra outcome.
 */
function reconcileRecords(sources, contract, outcomes) {
  const key = IDENTITY_KEY[contract];
  const candidates = [];
  for (const source of sources) {
    for (const record of source.document.records) {
      candidates.push({
        id: record[key],
        revision: record.revision,
        canonical: canonicalJson(record),
        record,
        source,
      });
    }
  }
  candidates.sort((left, right) => compareKeys(
    [left.id, -left.revision, -left.source.sequence, -left.source.generatedAtMs,
      left.source.digest, left.canonical],
    [right.id, -right.revision, -right.source.sequence, -right.source.generatedAtMs,
      right.source.digest, right.canonical],
  ));

  const winners = new Map();
  const reported = new Set();
  for (const candidate of candidates) {
    const winner = winners.get(candidate.id);
    if (!winner) {
      winners.set(candidate.id, candidate);
      continue;
    }
    if (candidate.revision !== winner.revision) continue; // Superseded: silent by design.
    const duplicate = candidate.canonical === winner.canonical;
    const signature = `${candidate.id}:${candidate.revision}:${duplicate}:${candidate.canonical}`;
    if (reported.has(signature)) continue;
    reported.add(signature);
    outcomes.push(makeOutcome(
      duplicate ? NORMALIZATION_CODES.DUPLICATE_DELIVERY
        : NORMALIZATION_CODES.CONFLICTING_RECORD_REVISION,
      {
        file: winner.source.fileName,
        contract,
        exportId: winner.source.exportId,
        recordId: candidate.id,
        field: `records[].${key}`,
        detail: duplicate
          ? `Revision ${candidate.revision} of ${candidate.id} was repeated; one copy was counted.`
          : `Revision ${candidate.revision} of ${candidate.id} differs between sources; `
            + `the copy from export ${winner.source.exportId} was retained.`,
      },
    ));
  }
  return [...winners.values()].sort((left, right) => compare(left.id, right.id));
}

/**
 * Keep one producer instance. Mixing instances would silently double-count or
 * split a unit, so the majority instance wins and the rest are reported.
 * Ties break on the lexicographically smallest instance id.
 */
function selectSourceInstance(sources, contract, outcomes) {
  if (sources.length <= 1) return sources;
  const groups = new Map();
  for (const source of sources) {
    const group = groups.get(source.sourceInstanceId) ?? [];
    group.push(source);
    groups.set(source.sourceInstanceId, group);
  }
  if (groups.size === 1) return sources;
  const [accepted] = [...groups.entries()].sort((left, right) =>
    right[1].length - left[1].length || compare(left[0], right[0]));
  for (const source of sources) {
    if (source.sourceInstanceId === accepted[0]) continue;
    outcomes.push(makeOutcome(NORMALIZATION_CODES.INCOMPATIBLE_SOURCE_INSTANCE, {
      file: source.fileName,
      contract,
      exportId: source.exportId,
      field: "snapshot.source_instance_id",
      detail: `Instance ${source.sourceInstanceId} was excluded; ${accepted[0]} is the accepted instance.`,
    }));
  }
  return accepted[1];
}

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

function fixtureIdFor(unitId, taken) {
  const slug = `local-${String(unitId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    .replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, FIXTURE_ID_LIMIT);
  const base = /^[a-z0-9]/.test(slug) ? slug : `local-unit-${taken.size + 1}`;
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, FIXTURE_ID_LIMIT - String(suffix).length - 1)}-${suffix}`;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    return candidate;
  }
}

function unitLabel(unit) {
  const short = String(unit.unitId).slice(-8);
  return unit.unitType === "department" ? `Department ${short}` : `Unit ${short}`;
}

function ratingsFor(unit, coverage) {
  const ratings = {};
  const evidence = {};
  const requirements = {};
  for (const rule of RATING_RULES) {
    const met = [];
    const unmet = [];
    for (const requirement of rule.requirements) {
      (requirement.satisfied(unit, coverage) ? met : unmet).push(requirement);
    }
    ratings[rule.key] = met.length;
    evidence[rule.key] = `${met.length}/4 requirements met. `
      + (met.length ? `Met: ${met.map((item) => item.label).join("; ")}. ` : "Met: none. ")
      + (unmet.length ? `Unmet: ${unmet.map((item) => item.label).join("; ")}.` : "No unmet requirement.");
    requirements[rule.key] = Object.freeze({
      met: Object.freeze(met.map((item) => item.id)),
      unmet: Object.freeze(unmet.map((item) => item.id)),
    });
  }
  return { ratings, evidence, requirements };
}

function recommendationFor(unit, coverage) {
  const department = unitLabel(unit);
  const window = coverage.periodStart && coverage.periodEnd
    ? `the ${coverage.periodStart} to ${coverage.periodEnd} period` : "the accepted export period";
  if (unit.recoverableMinor <= 0) {
    return `Hold routing changes for ${department}: the accepted exports show `
      + `${money(unit.spendMinor).toFixed(2)} USD observed over ${window} with no re-routable `
      + "text-generation spend. Collect a complete closed-period export before acting.";
  }
  return `Pilot lower-cost routing for text-generation spend in ${department} over ${window}; `
    + `cap the pilot at ${money(unit.recoverableMinor).toFixed(2)} USD against `
    + `${money(unit.spendMinor).toFixed(2)} USD observed, and re-measure over an equal-length period.`;
}

function buildCoverage({
  providerSources, hrisSources, rejectedSourceCount, freshness,
  acceptedProviderRecords, unattributedRecords, activeUnitCount, scoredUnits,
  estimatedRecords,
}) {
  const periods = [...new Set(providerSources.map((source) =>
    `${source.document.snapshot.period_start} to ${source.document.snapshot.period_end}`))].sort();
  const starts = providerSources.map((source) => source.document.snapshot.period_start).sort();
  const ends = providerSources.map((source) => source.document.snapshot.period_end).sort();
  const periodStart = starts[0] ?? null;
  const periodEnd = ends.at(-1) ?? null;
  const periodDays = periodStart && periodEnd
    ? Math.round((dayEpoch(periodEnd) - dayEpoch(periodStart)) / DAY_MS) : 0;
  const providerOmitted = providerSources.reduce((sum, s) => sum + s.omittedRecordCount, 0);
  const hrisOmitted = hrisSources.reduce((sum, s) => sum + s.omittedRecordCount, 0);
  const providerCompleteness = providerSources.every((s) => s.completeness === "complete")
    ? "complete" : "partial";
  const hrisCompleteness = hrisSources.every((s) => s.completeness === "complete")
    ? "complete" : "partial";
  const declaredIssues = [...providerSources, ...hrisSources]
    .reduce((sum, source) => sum + source.issues.length, 0);
  const state = providerCompleteness === "complete" && hrisCompleteness === "complete"
    && providerOmitted === 0 && hrisOmitted === 0 && declaredIssues === 0 ? "complete" : "partial";

  const cannotAnswer = [
    "No peer benchmark: the imported contracts carry no cohort scored with this rubric.",
    "No prompt-quality claim: provider content and direct identifiers are excluded by contract.",
  ];
  if (periods.length < 2) {
    cannotAnswer.push("No like-for-like trend: only one provider period was accepted.");
  }
  if (state === "partial") {
    cannotAnswer.push(`Incomplete coverage: ${providerOmitted} provider and ${hrisOmitted} HRIS `
      + `records were declared omitted and ${declaredIssues} data-quality issue`
      + `${declaredIssues === 1 ? " was" : "s were"} declared; totals are estimate-only.`);
  }
  if (freshness.state === "stale") {
    cannotAnswer.push(`Stale sources: ${freshness.staleSourceIds.length} accepted export`
      + `${freshness.staleSourceIds.length === 1 ? " is" : "s are"} older than `
      + `${freshness.maxAgeDays} days as of ${freshness.referenceTimestamp}; figures cannot reconcile an invoice.`);
  }
  if (freshness.state === "not_evaluated") {
    cannotAnswer.push("No freshness claim: no reference timestamp was supplied, so staleness was not evaluated.");
  }
  if (unattributedRecords > 0) {
    cannotAnswer.push(`Excluded spend: ${unattributedRecords} provider aggregate`
      + `${unattributedRecords === 1 ? "" : "s"} matched no active HRIS unit and `
      + `${unattributedRecords === 1 ? "is" : "are"} absent from every figure.`);
  }
  if (estimatedRecords > 0) {
    cannotAnswer.push(`Unsettled cost: ${estimatedRecords} joined cost record`
      + `${estimatedRecords === 1 ? " is" : "s are"} estimated, not final.`);
  }
  if (rejectedSourceCount > 0) {
    cannotAnswer.push(`Rejected input: ${rejectedSourceCount} selected file`
      + `${rejectedSourceCount === 1 ? " was" : "s were"} rejected and contributed nothing.`);
  }

  const providerPrivacy = providerSources.map((source) => source.document.privacy);
  const hrisPrivacy = hrisSources.map((source) => source.document.privacy);
  return {
    state,
    periods,
    periodCount: periods.length,
    periodStart,
    periodEnd,
    periodDays,
    acceptedProviderSources: providerSources.length,
    acceptedHrisSources: hrisSources.length,
    rejectedSourceCount,
    providerCompleteness,
    providerOmittedRecordCount: providerOmitted,
    hrisCompleteness,
    hrisOmittedRecordCount: hrisOmitted,
    declaredIssueCount: declaredIssues,
    acceptedProviderRecords,
    unattributedProviderRecords: unattributedRecords,
    estimatedCostRecords: estimatedRecords,
    activeUnits: activeUnitCount,
    scoredUnits,
    freshness,
    privacy: {
      directIdentifiersExcluded: [...providerPrivacy, ...hrisPrivacy]
        .every((privacy) => privacy.direct_identifiers_included === false),
      providerContentExcluded: providerPrivacy.every((privacy) => privacy.content_included === false),
      minimumGroupSize: providerPrivacy.length
        ? Math.min(...providerPrivacy.map((privacy) => privacy.minimum_group_size)) : 0,
      pseudonymousJoin: hrisPrivacy.length > 0 && hrisPrivacy.every((privacy) =>
        privacy.identifier_method === "hmac-sha256-truncated"
        && privacy.salt_scope === "tenant-integration-v1"),
    },
    cannotAnswer,
  };
}

/**
 * Turn a parse result into the scoring model's input payload.
 *
 * @param {ReturnType<typeof parseExports>} parsed
 * @param {{referenceTimestamp?: string, freshnessMaxAgeDays?: number}} [options]
 *   `referenceTimestamp` is the injected "now" used for staleness. This module
 *   never reads a clock; when the caller omits it, staleness is reported as not
 *   evaluated rather than guessed.
 * @returns {{ok: boolean, status: string, analysisInput: object|null, outcomes: Array}}
 *   Never throws.
 */
export function normalize(parsed, options = {}) {
  const outcomes = [...(parsed?.outcomes ?? [])];
  const reject = (code, detail) => {
    if (code) outcomes.push(makeOutcome(code, detail ? { detail } : {}));
    return Object.freeze({
      ok: false,
      status: "rejected",
      analysisInput: null,
      outcomes: Object.freeze(sortOutcomes(outcomes)),
    });
  };

  if (!parsed?.manifest) return reject(null);
  if (!parsed.ok) {
    // Either every file was rejected, or the caller disabled partial
    // acceptance and at least one was. Both are already explained by the parse
    // outcomes; only name the missing provider export when that is the gap.
    const hasProvider = parsed.sources.some((source) => source.contract === PROVIDER_CONTRACT);
    return reject(hasProvider ? null : NORMALIZATION_CODES.MISSING_PROVIDER_EXPORT);
  }

  const manifest = parsed.manifest;
  const rejectedSourceCount = parsed.outcomes.filter((item) => item.severity === "error").length;
  let providerSources = parsed.sources.filter((source) => source.contract === PROVIDER_CONTRACT);
  let hrisSources = parsed.sources.filter((source) => source.contract === HRIS_CONTRACT);
  if (!providerSources.length) return reject(NORMALIZATION_CODES.MISSING_PROVIDER_EXPORT);
  if (!hrisSources.length) return reject(NORMALIZATION_CODES.MISSING_HRIS_MAPPING);

  providerSources = selectSourceInstance(providerSources, PROVIDER_CONTRACT, outcomes);
  hrisSources = selectSourceInstance(hrisSources, HRIS_CONTRACT, outcomes);

  for (const source of [...providerSources, ...hrisSources]) {
    if (source.completeness === "partial" || source.omittedRecordCount > 0 || source.issues.length) {
      outcomes.push(makeOutcome(NORMALIZATION_CODES.PARTIAL_EXPORT, {
        file: source.fileName,
        contract: source.contract,
        exportId: source.exportId,
        field: "snapshot.completeness",
        detail: `Completeness "${source.completeness}" with ${source.omittedRecordCount} omitted `
          + `record${source.omittedRecordCount === 1 ? "" : "s"} and ${source.issues.length} declared `
          + `issue${source.issues.length === 1 ? "" : "s"}.`,
      }));
    }
  }

  // Freshness. The reference timestamp is injected; the module owns no clock.
  const maxAgeDays = Number.isFinite(options?.freshnessMaxAgeDays)
    ? options.freshnessMaxAgeDays
    : Number.isFinite(manifest.privacy?.raw_quarantine_max_days)
      ? manifest.privacy.raw_quarantine_max_days
      : DEFAULT_FRESHNESS_MAX_AGE_DAYS;
  const referenceTimestamp = typeof options?.referenceTimestamp === "string"
    && Number.isFinite(Date.parse(options.referenceTimestamp))
    ? options.referenceTimestamp : null;
  const staleSourceIds = [];
  if (!referenceTimestamp) {
    outcomes.push(makeOutcome(NORMALIZATION_CODES.FRESHNESS_NOT_EVALUATED));
  } else {
    const referenceMs = Date.parse(referenceTimestamp);
    for (const source of [...providerSources, ...hrisSources]) {
      const ageDays = (referenceMs - source.generatedAtMs) / DAY_MS;
      if (ageDays <= maxAgeDays) continue;
      staleSourceIds.push(source.sourceId);
      outcomes.push(makeOutcome(NORMALIZATION_CODES.STALE_EXPORT, {
        file: source.fileName,
        contract: source.contract,
        exportId: source.exportId,
        field: "snapshot.generated_at",
        detail: `Generated ${source.generatedAt}, which is ${ageDays.toFixed(1)} days before `
          + `${referenceTimestamp} and beyond the ${maxAgeDays}-day target.`,
      }));
    }
  }
  staleSourceIds.sort();
  const freshness = {
    state: !referenceTimestamp ? "not_evaluated" : staleSourceIds.length ? "stale" : "fresh",
    referenceTimestamp,
    maxAgeDays,
    staleSourceIds,
  };

  const units = reconcileRecords(hrisSources, HRIS_CONTRACT, outcomes);
  const aggregates = reconcileRecords(providerSources, PROVIDER_CONTRACT, outcomes);
  const knownUnitIds = new Set(units
    .filter((item) => item.record.operation === "upsert")
    .map((item) => item.id));
  const activeUnits = new Map(units
    .filter((item) => item.record.operation === "upsert" && item.record.active === true)
    .map((item) => [item.id, item]));

  const grouped = new Map();
  let unattributedRecords = 0;
  for (const candidate of aggregates) {
    const record = candidate.record;
    const unitEntry = activeUnits.get(record.org_unit_id);
    if (!unitEntry) {
      unattributedRecords += 1;
      outcomes.push(makeOutcome(NORMALIZATION_CODES.UNATTRIBUTED_PROVIDER_RECORD, {
        file: candidate.source.fileName,
        contract: PROVIDER_CONTRACT,
        exportId: candidate.source.exportId,
        recordId: candidate.id,
        field: "records[].org_unit_id",
        detail: `org_unit_id ${record.org_unit_id} matched no active HRIS unit.`,
      }));
      continue;
    }
    const unit = grouped.get(record.org_unit_id) ?? {
      unitId: record.org_unit_id,
      unitType: unitEntry.record.unit_type,
      unitRevision: unitEntry.record.revision,
      parentUnitId: unitEntry.record.parent_unit_id,
      parentKnown: unitEntry.record.parent_unit_id === null
        || knownUnitIds.has(unitEntry.record.parent_unit_id),
      hrisSource: unitEntry.source,
      spendMinor: 0,
      routableMinor: 0,
      recoverableMinor: 0,
      recordCount: 0,
      estimatedCount: 0,
      finalCount: 0,
      records: [],
    };
    unit.spendMinor += record.cost.amount_minor;
    unit.recordCount += 1;
    if (record.cost.status === "final") unit.finalCount += 1;
    else unit.estimatedCount += 1;
    if (ROUTABLE_SERVICE_CATEGORIES.includes(record.service_category)) {
      unit.routableMinor += record.cost.amount_minor;
    }
    unit.records.push({
      recordId: candidate.id,
      revision: record.revision,
      usageDate: record.usage_date,
      provider: record.provider,
      serviceCategory: record.service_category,
      amountMinor: record.cost.amount_minor,
      costStatus: record.cost.status,
      usageQuantity: record.usage.quantity,
      usageUnit: record.usage.unit,
      sourceId: candidate.source.sourceId,
      exportId: candidate.source.exportId,
      file: candidate.source.fileName,
    });
    grouped.set(record.org_unit_id, unit);
  }

  const ranked = [...grouped.values()].map((unit) => {
    unit.recoverableMinor = Math.round(unit.routableMinor * ROUTING_SCENARIO_SHARE);
    unit.records.sort((left, right) => compareKeys(
      [left.recordId, left.exportId], [right.recordId, right.exportId],
    ));
    return unit;
  }).sort((left, right) => compareKeys(
    [-left.recoverableMinor, -left.spendMinor, left.unitId],
    [-right.recoverableMinor, -right.spendMinor, right.unitId],
  ));

  if (!ranked.length) return reject(NORMALIZATION_CODES.NO_SCOREABLE_UNIT);

  const coverage = buildCoverage({
    providerSources,
    hrisSources,
    rejectedSourceCount,
    freshness,
    acceptedProviderRecords: aggregates.length - unattributedRecords,
    unattributedRecords,
    activeUnitCount: activeUnits.size,
    scoredUnits: ranked.length,
    estimatedRecords: ranked.reduce((sum, unit) => sum + unit.estimatedCount, 0),
  });

  const takenIds = new Set();
  const fixtures = ranked.map((unit) => {
    const { ratings, evidence, requirements } = ratingsFor(unit, coverage);
    const unitOutcomes = outcomes.filter((item) =>
      item.source.recordId === unit.unitId
      || unit.records.some((record) => record.recordId === item.source.recordId));
    return {
      id: fixtureIdFor(unit.unitId, takenIds),
      recommendation: recommendationFor(unit, coverage),
      department: unitLabel(unit),
      ratings,
      evidence,
      provenance: {
        processing: "browser_local_ephemeral",
        normalizer: FINOPS_EXPORT_NORMALIZATION_VERSION,
        manifestVersion: manifest.manifest_version,
        contractSchemaVersion: SUPPORTED_CONTRACT_SCHEMA_VERSION,
        unitId: unit.unitId,
        unitType: unit.unitType,
        parentUnitId: unit.parentUnitId,
        hrisSource: {
          sourceId: unit.hrisSource.sourceId,
          file: unit.hrisSource.fileName,
          exportId: unit.hrisSource.exportId,
          recordId: unit.unitId,
          revision: unit.unitRevision,
        },
        providerRecords: unit.records,
        observedSpendUsd: money(unit.spendMinor),
        routableSpendUsd: money(unit.routableMinor),
        recoverableScenarioUsd: money(unit.recoverableMinor),
        routingScenarioShare: ROUTING_SCENARIO_SHARE,
      },
      quality: {
        coverageState: coverage.state,
        freshnessState: freshness.state,
        acceptedRecords: unit.recordCount,
        estimatedCostRecords: unit.estimatedCount,
        requirements,
        flags: [...new Set(unitOutcomes.map((item) => item.code))].sort(),
        outcomes: sortOutcomes(unitOutcomes),
      },
    };
  });

  const analysisInput = deepFreeze({
    schemaVersion: ANALYSIS_INPUT_SCHEMA_VERSION,
    source: "browser-local normalization of user-selected provider and HRIS exports; "
      + "no upload, credential, network transfer, or persistence",
    origin: "local_import",
    normalizer: FINOPS_EXPORT_NORMALIZATION_VERSION,
    rubricVersion: FINOPS_RUBRIC.version,
    provenance: {
      processing: "browser_local_ephemeral",
      manifestVersion: manifest.manifest_version,
      manifestKind: manifest.kind,
      providerSourceInstanceId: providerSources[0].sourceInstanceId,
      hrisSourceInstanceId: hrisSources[0].sourceInstanceId,
      acceptedSources: [...providerSources, ...hrisSources]
        .map((source) => ({
          sourceId: source.sourceId,
          contract: source.contract,
          file: source.fileName,
          exportId: source.exportId,
          sequence: source.sequence,
          generatedAt: source.generatedAt,
          digest: source.digest,
        }))
        .sort((left, right) => compare(left.sourceId, right.sourceId)),
    },
    coverage,
    fixtures,
  });

  return Object.freeze({
    ok: true,
    status: statusFor(outcomes, true),
    analysisInput,
    outcomes: Object.freeze(sortOutcomes(outcomes)),
  });
}

/**
 * Parse and normalize in one call. The single entry point a page needs.
 *
 * @param {Array<{name: string, mediaType?: string, text: string}>} files
 * @param {object} manifest
 * @param {{referenceTimestamp?: string, freshnessMaxAgeDays?: number, allowPartialAcceptance?: boolean}} [options]
 */
export function normalizeFinopsExports(files, manifest, options = {}) {
  return normalize(parseExports(files, manifest, options), options);
}

// ---------------------------------------------------------------------------
// Sample fallback
// ---------------------------------------------------------------------------

/**
 * The single explicit state transition between bundled sample data and an
 * imported analysis.
 *
 * "Completed import" means exactly: `normalize` returned `ok: true` with at
 * least one fixture and at least one accepted provider source. Nothing else
 * flips the mode — not selecting files, not a partially accepted parse that
 * produced no fixture.
 *
 * Sample and imported data are never blended: `current().analysisInput` is
 * either the sample payload the caller supplied or the imported payload, never
 * a merge. Once in local mode a failed import does **not** restore the sample;
 * the mode stays `local` and the failure is surfaced on `failure`, because
 * silently reverting to sample numbers is how a leader reads demo data as
 * their own. Only `reset()` — an explicit user action — returns to sample.
 */
export function createFinopsAnalysisSource(samplePayload) {
  let mode = "sample";
  let imported = null;
  let outcomes = [];
  let failure = null;

  const snapshot = () => Object.freeze({
    mode,
    analysisInput: mode === "local" ? imported : samplePayload,
    outcomes: Object.freeze([...outcomes]),
    failure,
  });

  return Object.freeze({
    /** @returns the current analysis input and why it is the current one. */
    current: snapshot,

    /**
     * Apply a normalize result. Returns the snapshot after the transition.
     * @param {ReturnType<typeof normalize>} result
     */
    completeImport(result) {
      const completed = Boolean(result?.ok)
        && (result.analysisInput?.fixtures?.length ?? 0) > 0
        && (result.analysisInput?.coverage?.acceptedProviderSources ?? 0) > 0;
      outcomes = [...(result?.outcomes ?? [])];
      if (completed) {
        mode = "local";
        imported = result.analysisInput;
        failure = null;
        return snapshot();
      }
      failure = Object.freeze({
        status: result?.status ?? "rejected",
        retainedMode: mode,
        outcomes: Object.freeze([...(result?.outcomes ?? [])]),
      });
      return snapshot();
    },

    /** Explicit user action: discard the import and return to sample data. */
    reset() {
      mode = "sample";
      imported = null;
      outcomes = [];
      failure = null;
      return snapshot();
    },
  });
}
