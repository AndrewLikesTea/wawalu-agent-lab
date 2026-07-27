// Browser-local FinOps import and normalization.
//
// This module deliberately has no fetch, storage, credential, or API path. It
// accepts parsed JSON values, keeps only fields declared by Anya's compatibility
// manifest, and returns a short-lived projection for the page and downloads.

import { analyzeModelRouting, evaluateDownRoutingCandidate } from "./down-routing-candidates.js";
import { RUBRIC_VERSION_ID } from "./prompt-literacy-scoring.js";
import {
  PREVIOUS_PROVIDER_USAGE_SCHEMA_VERSION, PROVIDER_USAGE_SCHEMA_VERSION,
  SUPPORTED_PROVIDER_USAGE_SCHEMA_VERSIONS, USAGE_DETAIL_KEYS, usageDetailProblem,
} from "./provider-usage-record.js";

export const LOCAL_KINDS = Object.freeze({
  provider: "wawalu.integration.provider-usage-billing",
  hris: "wawalu.integration.hris-org",
});

export const ACCEPTED_LOCAL_FILE = Object.freeze({
  extension: ".json",
  mediaType: "application/json",
});

const ENVELOPE_KEYS = ["schema_version", "kind", "export_id", "snapshot", "privacy", "records"];
const PROVIDER_RECORD_KEYS = [
  "aggregate_id", "revision", "usage_date", "org_unit_id", "provider",
  "service_category", "usage", "cost",
];
const HRIS_RECORD_KEYS = [
  "unit_id", "revision", "operation", "effective_at", "parent_unit_id", "unit_type", "active",
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID_PATTERN = /^psn_[A-Za-z0-9_-]{16,64}$/;

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("malformed_document", `${label} must be an object.`);
  }
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail("unknown_field", `${label} contains undeclared field “${unknown}”.`);
}

function required(value, keys, label) {
  const missing = keys.find((key) => !(key in value));
  if (missing) fail("missing_field", `${label} is missing required field “${missing}”.`);
}

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) fail("invalid_value", `${label} must be non-negative.`);
  return value;
}

function validDate(value) {
  return typeof value === "string" && DATE_PATTERN.test(value)
    && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

function validDateTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function rejectDuplicateJsonKeys(text) {
  const stack = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") stack.push({ kind: "object", keys: new Set() });
    else if (character === "[") stack.push({ kind: "array" });
    else if (character === "}" || character === "]") stack.pop();
    else if (character === '"') {
      const start = index;
      for (index += 1; index < text.length; index += 1) {
        if (text[index] === "\\") index += 1;
        else if (text[index] === '"') break;
      }
      let after = index + 1;
      while (/\s/.test(text[after] ?? "")) after += 1;
      const scope = stack.at(-1);
      if (text[after] === ":" && scope?.kind === "object") {
        let key;
        try {
          key = JSON.parse(text.slice(start, index + 1));
        } catch {
          return; // JSON.parse below owns malformed string reporting.
        }
        if (scope.keys.has(key)) fail("duplicate_key", `The JSON repeats key “${key}”.`);
        scope.keys.add(key);
      }
    }
  }
}

function validatePrivacy(document, kind) {
  const privacy = document.privacy;
  exactKeys(privacy, kind === LOCAL_KINDS.provider
    ? ["aggregation", "minimum_group_size", "direct_identifiers_included", "content_included"]
    : ["identifier_method", "direct_identifiers_included", "salt_scope"], "privacy");
  if (!privacy || privacy.direct_identifiers_included !== false) {
    fail("privacy_violation", "Direct identifiers must be explicitly excluded.");
  }
  if (kind === LOCAL_KINDS.provider) {
    if (privacy.aggregation !== "daily-org-unit-service") {
      fail("invalid_value", "Provider privacy.aggregation is unsupported.");
    }
    if (privacy.content_included !== false) {
      fail("privacy_violation", "Prompt or response content must be explicitly excluded.");
    }
    if (!Number.isInteger(privacy.minimum_group_size) || privacy.minimum_group_size < 10) {
      fail("privacy_violation", "Provider aggregates require a minimum group size of 10.");
    }
  } else if (privacy.identifier_method !== "hmac-sha256-truncated"
    || privacy.salt_scope !== "tenant-integration-v1") {
    fail("privacy_violation", "HRIS pseudonyms must use the declared tenant integration method.");
  }
}

function validateSnapshot(document, kind) {
  const provider = kind === LOCAL_KINDS.provider;
  const requiredKeys = provider
    ? ["source_instance_id", "sequence", "generated_at", "period_start", "period_end",
      "completeness", "omitted_record_count", "issues"]
    : ["source_instance_id", "sequence", "generated_at", "mode", "completeness",
      "omitted_record_count", "issues"];
  exactKeys(document.snapshot, requiredKeys, "snapshot");
  required(document.snapshot, requiredKeys, "snapshot");
  if (!Array.isArray(document.snapshot.issues)) fail("invalid_value", "snapshot.issues must be an array.");
  if (!OPAQUE_ID_PATTERN.test(document.snapshot.source_instance_id)
    || !Number.isInteger(document.snapshot.sequence) || document.snapshot.sequence < 0
    || !validDateTime(document.snapshot.generated_at)
    || !Number.isInteger(document.snapshot.omitted_record_count)
    || document.snapshot.omitted_record_count < 0) {
    fail("invalid_value", "snapshot source, sequence, timestamp, or omitted count is malformed.");
  }
  if (!["complete", "partial"].includes(document.snapshot.completeness)) {
    fail("invalid_value", "snapshot.completeness is unsupported.");
  }
  if (provider && (!validDate(document.snapshot.period_start)
    || !validDate(document.snapshot.period_end)
    || document.snapshot.period_start >= document.snapshot.period_end)) {
    fail("malformed_period", "Provider period boundaries must be valid dates in ascending order.");
  }
  if (!provider && !["full", "delta"].includes(document.snapshot.mode)) {
    fail("invalid_value", "snapshot.mode is unsupported.");
  }
}

/**
 * Validate one provider aggregate at the version its envelope declares.
 *
 * The v1.1 fields are additive: at 1.0 they are undeclared and rejected exactly
 * as any other unknown field is, so a 1.0 document means today what it meant
 * yesterday. At 1.1 all five are required and each may be `null`, which is the
 * contract's one spelling of "the export does not report this".
 */
function validateProviderRecord(record, index, schemaVersion) {
  const allowed = schemaVersion === PROVIDER_USAGE_SCHEMA_VERSION
    ? [...PROVIDER_RECORD_KEYS, ...USAGE_DETAIL_KEYS] : PROVIDER_RECORD_KEYS;
  exactKeys(record, allowed, `provider records[${index}]`);
  required(record, PROVIDER_RECORD_KEYS, `provider records[${index}]`);
  const detail = usageDetailProblem(record, schemaVersion);
  if (detail) {
    // The field name, never the cell: a malformed model string is located for
    // the reader in their own file, not echoed back out of it.
    fail(detail.code, `provider records[${index}].${detail.field} is not valid at `
      + `schema version ${schemaVersion}.`);
  }
  if (!OPAQUE_ID_PATTERN.test(record.aggregate_id)
    || !OPAQUE_ID_PATTERN.test(record.org_unit_id)
    || !Number.isInteger(record.revision) || record.revision < 0
    || !validDate(record.usage_date)
    || !["openai", "anthropic", "google", "aws", "azure", "other"].includes(record.provider)
    || !["text-generation", "image-generation", "embedding", "storage", "other"]
      .includes(record.service_category)) {
    fail("invalid_value", `provider records[${index}] has malformed identity or dimensions.`);
  }
  exactKeys(record.cost, ["amount_minor", "currency", "status"], `provider records[${index}].cost`);
  required(record.cost, ["amount_minor", "currency", "status"], `provider records[${index}].cost`);
  if (!Number.isInteger(record.cost.amount_minor)) {
    fail("invalid_value", `provider records[${index}].cost.amount_minor must be an integer.`);
  }
  finiteNonNegative(record.cost.amount_minor, `provider records[${index}].cost.amount_minor`);
  if (record.cost.currency !== "USD") {
    fail("unsupported_currency", "Only USD records can be combined without an exchange-rate transfer.");
  }
  if (!["estimated", "final"].includes(record.cost.status)) {
    fail("invalid_value", `provider records[${index}].cost.status is unsupported.`);
  }
  exactKeys(record.usage, ["quantity", "unit"], `provider records[${index}].usage`);
  required(record.usage, ["quantity", "unit"], `provider records[${index}].usage`);
  if (!Number.isFinite(record.usage.quantity) || record.usage.quantity < 0) {
    fail("invalid_value", `provider records[${index}].usage is invalid.`);
  }
  if (!["tokens", "images", "requests", "byte-hours", "provider-units"]
    .includes(record.usage.unit)) {
    fail("invalid_value", `provider records[${index}].usage.unit is unsupported.`);
  }
}

function validateHrisRecord(record, index) {
  exactKeys(record, HRIS_RECORD_KEYS, `HRIS records[${index}]`);
  required(record, ["unit_id", "revision", "operation", "effective_at"], `HRIS records[${index}]`);
  if (!OPAQUE_ID_PATTERN.test(record.unit_id)
    || !Number.isInteger(record.revision) || record.revision < 0
    || !["upsert", "delete"].includes(record.operation)
    || !validDateTime(record.effective_at)) {
    fail("invalid_value", `HRIS records[${index}] has malformed identity, revision, or operation.`);
  }
  if (record.operation === "upsert") {
    required(record, ["parent_unit_id", "unit_type", "active"], `HRIS records[${index}]`);
    if ((record.parent_unit_id !== null && !OPAQUE_ID_PATTERN.test(record.parent_unit_id))
      || !["company", "division", "department", "team", "other"].includes(record.unit_type)
      || typeof record.active !== "boolean") {
      fail("invalid_value", `HRIS records[${index}] has malformed hierarchy fields.`);
    }
  } else if ("parent_unit_id" in record || "unit_type" in record || "active" in record) {
    fail("invalid_value", `HRIS delete records[${index}] cannot contain hierarchy fields.`);
  }
}

export function parseLocalFinopsFile(text, fileName = "local.json", mediaType = "") {
  if (!fileName.toLowerCase().endsWith(ACCEPTED_LOCAL_FILE.extension)) {
    fail("unsupported_format", "Choose a .json file; CSV, spreadsheets, and NDJSON are not declared formats.");
  }
  if (mediaType && !["application/json", "text/json"].includes(mediaType)) {
    fail("unsupported_format", `The file media type “${mediaType}” is not declared by the manifest.`);
  }
  let document;
  try {
    rejectDuplicateJsonKeys(text);
    document = JSON.parse(text);
  } catch (error) {
    if (error?.code) throw error;
    fail("invalid_json", "The file is not valid JSON.");
  }
  exactKeys(document, ENVELOPE_KEYS, "document");
  required(document, ENVELOPE_KEYS, "document");
  // The provider contract accepts every version it has ever shipped; a stored
  // 1.0 export imports under 1.1 unchanged. The HRIS contract has not moved.
  const versions = document.kind === LOCAL_KINDS.provider
    ? SUPPORTED_PROVIDER_USAGE_SCHEMA_VERSIONS
    : [PREVIOUS_PROVIDER_USAGE_SCHEMA_VERSION];
  if (!Object.values(LOCAL_KINDS).includes(document.kind)
    || !versions.includes(document.schema_version)) {
    fail("unsupported_contract", "The JSON is not a supported v1 provider or HRIS contract envelope.");
  }
  if (!UUID_PATTERN.test(document.export_id)) fail("invalid_value", "document.export_id must be a UUID.");
  if (!Array.isArray(document.records)) fail("invalid_value", "document.records must be an array.");
  validatePrivacy(document, document.kind);
  validateSnapshot(document, document.kind);
  document.records.forEach(document.kind === LOCAL_KINDS.provider
    ? (record, index) => validateProviderRecord(record, index, document.schema_version)
    : validateHrisRecord);
  if (document.kind === LOCAL_KINDS.provider) {
    const outside = document.records.find((record) =>
      record.usage_date < document.snapshot.period_start
      || record.usage_date >= document.snapshot.period_end);
    if (outside) {
      fail("record_outside_period",
        `Provider record ${outside.aggregate_id} falls outside the half-open export period.`);
    }
  }
  return Object.freeze({
    type: document.kind === LOCAL_KINDS.provider ? "provider" : "hris",
    fileName,
    document,
  });
}

/**
 * Exported so the trust verdict can count the *same* rows the analysis counts.
 * A second reconciliation would be a second definition of "the imported
 * dataset", and the two would eventually disagree in front of a reader.
 */
export function reconcileRecords(records, idKey, exportId) {
  const revisions = new Map();
  const latest = new Map();
  const quarantine = [];
  for (const record of records) {
    const id = record[idKey];
    const revisionKey = `${id}:${record.revision}`;
    const serialized = JSON.stringify(record);
    if (revisions.has(revisionKey)) {
      quarantine.push(Object.freeze({
        code: revisions.get(revisionKey) === serialized
          ? "duplicate_record" : "conflicting_record_revision",
        scope: "record",
        exportId,
        recordId: id,
        action: revisions.get(revisionKey) === serialized
          ? "Remove the repeated record; the first identical copy was retained."
          : "Issue a corrected export with a higher revision and a new export ID.",
        message: revisions.get(revisionKey) === serialized
          ? `Record ${id} revision ${record.revision} is repeated.`
          : `Record ${id} revision ${record.revision} has conflicting content.`,
      }));
      continue;
    }
    revisions.set(revisionKey, serialized);
    const prior = latest.get(id);
    if (!prior || record.revision > prior.revision) latest.set(id, record);
  }
  return { records: [...latest.values()], quarantine };
}

function money(minor) {
  return Math.round(minor) / 100;
}

function periodMetadata(provider) {
  const document = provider.document ?? provider;
  const start = Date.parse(`${document.snapshot.period_start}T00:00:00Z`);
  const end = Date.parse(`${document.snapshot.period_end}T00:00:00Z`);
  return {
    document,
    // Carried, not recomputed: the per-model rows belong to the parsed file, so
    // a multi-period history scores each period from its own import.
    modelUsage: provider.modelUsage ?? null,
    start,
    end,
    days: Number.isFinite(start) && Number.isFinite(end)
      ? Math.round((end - start) / 86_400_000) : null,
  };
}

export function normalizeLocalFinops({ provider, hris }) {
  if (!provider || !hris) fail("incomplete_pair", "Add one provider export and one HRIS mapping.");
  const providerDoc = provider.document ?? provider;
  const hrisDoc = hris.document ?? hris;
  if (providerDoc.kind !== LOCAL_KINDS.provider || hrisDoc.kind !== LOCAL_KINDS.hris) {
    fail("wrong_pair", "The import needs one provider export and one HRIS mapping.");
  }
  const hrisReconciliation = reconcileRecords(hrisDoc.records, "unit_id", hrisDoc.export_id);
  const providerReconciliation = reconcileRecords(
    providerDoc.records, "aggregate_id", providerDoc.export_id,
  );
  const units = hrisReconciliation.records;
  const active = new Map(units
    .filter((unit) => unit.operation === "upsert" && unit.active)
    .map((unit) => [unit.unit_id, unit]));
  const departments = new Set(units
    .filter((unit) => unit.operation === "upsert" && unit.active && unit.unit_type === "department")
    .map((unit) => unit.unit_id));
  const aggregates = providerReconciliation.records;
  const warnings = [];
  const quarantine = [
    ...hrisReconciliation.quarantine,
    ...providerReconciliation.quarantine,
  ];
  let quarantinedRecords = 0;
  const grouped = new Map();
  for (const record of aggregates) {
    if (!active.has(record.org_unit_id)) {
      quarantinedRecords += 1;
      continue;
    }
    const current = grouped.get(record.org_unit_id) ?? {
      id: record.org_unit_id, spendUsd: 0, records: 0, estimatedCosts: 0, contractRecords: [],
    };
    const spendUsd = money(record.cost.amount_minor);
    current.spendUsd += spendUsd;
    current.records += 1;
    if (record.cost.status !== "final") current.estimatedCosts += 1;
    // Recoverable spend is not accumulated here. It is a property of the unit's
    // whole record set — price per token, call shape, and volume together — so
    // it is computed once per unit below, by the rule the fixtures pin.
    current.contractRecords.push(record);
    grouped.set(record.org_unit_id, current);
  }
  if (quarantinedRecords) {
    warnings.push(`${quarantinedRecords} provider record${quarantinedRecords === 1 ? "" : "s"} quarantined because no active HRIS unit matched.`);
  }
  if (quarantine.length) {
    warnings.push(`${quarantine.length} duplicate or conflicting record revision${
      quarantine.length === 1 ? " was" : "s were"
    } quarantined; review validation details.`);
  }
  if (providerDoc.snapshot.completeness !== "complete" || hrisDoc.snapshot.completeness !== "complete") {
    warnings.push("At least one export is partial; totals are directional and omitted records were not inferred.");
  }
  if (providerDoc.snapshot.issues.length || hrisDoc.snapshot.issues.length) {
    warnings.push("A source declared data-quality issues; review the source export before acting.");
  }
  const ranked = [...grouped.values()]
    .map(({ contractRecords, ...item }) => {
      const downRouting = evaluateDownRoutingCandidate({
        unitId: item.id, records: contractRecords,
      });
      return {
        ...item,
        name: departments.has(item.id)
          ? `Department …${item.id.slice(-6)}` : `Active unit …${item.id.slice(-6)}`,
        spendUsd: Math.round(item.spendUsd * 100) / 100,
        recoverableUsd: downRouting.recoverableUsd,
        downRouting,
      };
    })
    .sort((left, right) => right.recoverableUsd - left.recoverableUsd
      || right.spendUsd - left.spendUsd || left.id.localeCompare(right.id));
  const spendUsd = Math.round(ranked.reduce((sum, item) => sum + item.spendUsd, 0) * 100) / 100;
  const recoverableUsd = Math.round(
    ranked.reduce((sum, item) => sum + item.recoverableUsd, 0) * 100,
  ) / 100;
  const estimatedCosts = ranked.reduce((sum, item) => sum + item.estimatedCosts, 0);
  if (estimatedCosts) warnings.push(`${estimatedCosts} cost record${estimatedCosts === 1 ? " is" : "s are"} estimated, not final.`);
  if (!ranked.length) warnings.push("No provider records joined to an active HRIS unit.");
  // Per-model exposure, over the rows that carry a model identifier. This is a
  // separate published figure from the blended `recoverableUsd` above, and it
  // separates "nothing to recover" from "we could not look": a unit with no
  // model dimension in its export is not scored zero into the ranking, it goes
  // to `insufficientData` with a reason code.
  const modelRouting = analyzeModelRouting({
    modelUsage: (provider.modelUsage ?? []).filter((row) => active.has(row.orgUnitId)),
    unitIds: ranked.map((item) => item.id),
  });
  const top = ranked[0] ?? null;
  const confidence = warnings.length || !top || top.records < 2 ? "Low" : "Medium";
  return Object.freeze({
    schemaVersion: "local-finops/1.0.0",
    generatedAt: new Date().toISOString(),
    period: `${providerDoc.snapshot.period_start} to ${providerDoc.snapshot.period_end}`,
    spendUsd,
    recoverableUsd,
    rankedDepartments: ranked,
    topDepartment: top,
    modelRouting,
    confidence,
    provenance: `Browser-local projection of provider export ${providerDoc.export_id} and HRIS export ${hrisDoc.export_id}.`,
    action: top && top.recoverableUsd > 0
      ? `Pilot lower-cost routing for text-generation in ${top.name}; cap the pilot at ${money(top.recoverableUsd * 100).toFixed(2)} USD and verify against a like-for-like period.`
      : "Resolve data-quality gaps before selecting a cost action.",
    assumptions: [
      "Exact pseudonymous org-unit IDs are the only attribution key; no default department is assigned.",
      "Recoverable spend is a scenario, not a measured saving: token-billed text-generation spend "
      + "priced above the premium-tier floor is repriced at the standard-tier reference rate. "
      + "The per-unit worked example shows the arithmetic; see DOWN_ROUTING_ASSUMPTIONS for every "
      + "threshold and the fact that neither reference price has a published source.",
      "Unit names are not present in the privacy-safe HRIS contract, so shortened opaque labels are shown.",
    ],
    warnings,
    limits: [
      "No benchmark is calculated: the imported contracts contain no compatible peer cohort.",
      "No trend is calculated: a single provider period cannot establish a like-for-like change.",
      "No prompt-quality claim is made: provider content and direct identifiers are excluded.",
    ],
    evidence: top ? [
      `${top.records} deduplicated provider aggregate${top.records === 1 ? "" : "s"} joined to ${top.id}.`,
      `${top.spendUsd.toFixed(2)} USD observed; ${top.recoverableUsd.toFixed(2)} USD is the disclosed routing scenario `
      + `(${top.downRouting.decisionCode}, confidence ${top.downRouting.confidence.level}).`,
      `${quarantinedRecords} unmatched aggregate${quarantinedRecords === 1 ? "" : "s"} excluded from results.`,
    ] : ["No joined aggregate supports a recommendation."],
    quality: {
      providerCompleteness: providerDoc.snapshot.completeness,
      hrisCompleteness: hrisDoc.snapshot.completeness,
      joinedRecords: ranked.reduce((sum, item) => sum + item.records, 0),
      quarantinedRecords: quarantinedRecords + quarantine.length,
      quarantine: Object.freeze(quarantine),
      warnings,
    },
  });
}

function validation(code, scope, message, action, details = {}) {
  return Object.freeze({ code, scope, message, action, ...details });
}

function periodKey(document) {
  return `${document.snapshot.period_start}:${document.snapshot.period_end}`;
}

function isCalendarMonth({ periodStart, periodEnd, start, end }) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const startDate = new Date(start);
  const expectedEnd = Date.UTC(
    startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1,
  );
  return startDate.getUTCDate() === 1 && end === expectedEnd
    && periodStart.endsWith("-01") && periodEnd.endsWith("-01");
}

function compatibleAdjacentPeriods(previous, current) {
  const contiguous = previous.end === current.start;
  const bothMonthly = isCalendarMonth(previous) && isCalendarMonth(current);
  const equalLength = previous.days > 0 && previous.days === current.days;
  return {
    compatible: contiguous && (bothMonthly || equalLength),
    contiguous,
    basis: bothMonthly ? "calendar_month" : equalLength ? "equal_days" : null,
  };
}

function deterministicSourceGroup(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const source = entry.document.snapshot.source_instance_id;
    const group = groups.get(source) ?? [];
    group.push(entry);
    groups.set(source, group);
  }
  return [...groups.entries()].sort((left, right) =>
    right[1].length - left[1].length || left[0].localeCompare(right[0]))[0];
}

/**
 * Reconcile browser-local provider periods without broadening the v1 contract.
 *
 * The newest two compatible periods are the decision window. Calendar months
 * are comparable despite differing day counts; non-monthly periods must be
 * contiguous and equal length. Quarantined inputs never affect totals.
 */
export function normalizeLocalFinopsHistory({ providers = [], hris }) {
  const list = Array.isArray(providers) ? providers : [providers];
  if (!hris || list.length === 0)
    fail("incomplete_pair", "Add at least one provider export and one HRIS mapping.");

  const candidates = list.map(periodMetadata).sort((left, right) =>
    left.start - right.start || left.end - right.end
    || left.document.export_id.localeCompare(right.document.export_id));
  const validations = [];
  const quarantinedExports = [];
  const validDates = candidates.filter((entry) => {
    if (Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.end > entry.start)
      return true;
    validations.push(validation(
      "malformed_period", "export", "The provider period has invalid or reversed boundaries.",
      "Correct period_start and period_end and issue a new export ID.",
      { exportId: entry.document.export_id, period: periodKey(entry.document) },
    ));
    quarantinedExports.push(entry.document.export_id);
    return false;
  });
  if (!validDates.length)
    fail("malformed_period", "No provider export has a valid positive period.");

  const [acceptedSource, sourceEntries] = deterministicSourceGroup(validDates);
  let ordered = sourceEntries;
  for (const entry of validDates) {
    if (entry.document.snapshot.source_instance_id === acceptedSource) continue;
    quarantinedExports.push(entry.document.export_id);
    validations.push(validation(
      "incompatible_source", "export",
      "The provider export belongs to a different source instance.",
      `Use exports from source ${acceptedSource}, or analyze this source separately.`,
      { exportId: entry.document.export_id, period: periodKey(entry.document) },
    ));
  }

  const seenExports = new Set();
  const seenPeriods = new Set();
  ordered = ordered.filter((entry) => {
    const exportId = entry.document.export_id;
    const period = periodKey(entry.document);
    const code = seenExports.has(exportId) ? "duplicate_export"
      : seenPeriods.has(period) ? "duplicate_period" : null;
    if (!code) {
      seenExports.add(exportId);
      seenPeriods.add(period);
      return true;
    }
    quarantinedExports.push(exportId);
    validations.push(validation(
      code, "export",
      code === "duplicate_export"
        ? `Export ${exportId} is repeated.`
        : `Period ${period} is supplied by more than one export.`,
      "Remove the duplicate and retain the first export in deterministic export-ID order.",
      { exportId, period },
    ));
    return false;
  });
  if (!ordered.length)
    fail("incompatible_periods", "No unique provider period remains after reconciliation.");

  const periods = ordered.map(({ document, modelUsage, ...metadata }) => ({
    ...metadata,
    periodStart: document.snapshot.period_start,
    periodEnd: document.snapshot.period_end,
    exportId: document.export_id,
    generatedAt: document.snapshot.generated_at,
    completeness: document.snapshot.completeness,
    result: normalizeLocalFinops({ provider: { document, modelUsage }, hris }),
  }));
  const current = periods.at(-1);
  const previous = periods.at(-2) ?? null;
  let historyState = "missing";
  let historyMessage = "Add the immediately preceding provider period to calculate a trend.";
  if (previous) {
    const compatibility = compatibleAdjacentPeriods(previous, current);
    if (!compatibility.compatible) {
      historyState = "incompatible";
      historyMessage = !compatibility.contiguous
        ? "The newest provider periods are not contiguous; the missing interval prevents a defensible trend."
        : "The newest periods are neither calendar months nor equal-length windows; a like-for-like trend is unavailable.";
      validations.push(validation(
        "incompatible_periods", "history", historyMessage,
        "Supply adjacent calendar-month exports or adjacent windows with the same number of days.",
        { previousPeriod: previous.result.period, currentPeriod: current.result.period },
      ));
    } else {
      historyState = "available";
      historyMessage = compatibility.basis === "calendar_month"
        ? "Adjacent calendar-month exports use the same provider source."
        : `${current.days}-day periods are contiguous and use the same provider source.`;
    }
  }
  if (!previous) validations.push(validation(
    "insufficient_history", "history",
    "One accepted provider period cannot establish a trend.",
    "Add the immediately preceding compatible provider period.",
    { currentPeriod: current.result.period },
  ));

  const priorById = new Map(previous?.result.rankedDepartments
    .map((department) => [department.id, department]) ?? []);
  const departments = current.result.rankedDepartments.map((department) => {
    const prior = priorById.get(department.id) ?? null;
    const trendAvailable = historyState === "available" && prior && prior.spendUsd > 0;
    return Object.freeze({
      ...department,
      previousSpendUsd: prior?.spendUsd ?? null,
      spendChangeUsd: trendAvailable
        ? Math.round((department.spendUsd - prior.spendUsd) * 100) / 100 : null,
      spendChangePercent: trendAvailable
        ? Math.round(((department.spendUsd - prior.spendUsd) / prior.spendUsd) * 1000) / 10
        : null,
      trendAvailable: Boolean(trendAvailable),
      trendReason: trendAvailable ? null
        : historyState !== "available" ? historyMessage
          : "This department has no positive spend in the preceding period.",
    });
  });
  const top = departments[0] ?? null;
  const organizationTrendAvailable = historyState === "available"
    && previous.result.spendUsd > 0;
  const organizationSpendChangePercent = organizationTrendAvailable
    ? Math.round(((current.result.spendUsd - previous.result.spendUsd)
      / previous.result.spendUsd) * 1000) / 10 : null;
  const reconciliationWarnings = [
    ...current.result.warnings,
    ...validations.map((item) => `${item.message} ${item.action}`),
  ];

  return Object.freeze({
    ...current.result,
    schemaVersion: "local-finops-history/1.0.0",
    generatedAt: current.generatedAt,
    rankedDepartments: Object.freeze(departments),
    topDepartment: top,
    warnings: Object.freeze(reconciliationWarnings),
    quality: Object.freeze({
      ...current.result.quality,
      warnings: Object.freeze(reconciliationWarnings),
      quarantinedRecords: periods.reduce(
        (sum, entry) => sum + entry.result.quality.quarantinedRecords, 0,
      ),
    }),
    history: Object.freeze({
      state: historyState,
      message: historyMessage,
      periodCount: periods.length,
      previousPeriod: previous?.result.period ?? null,
      currentPeriod: current.result.period,
      organizationTrendAvailable,
      organizationSpendChangePercent,
      periods: Object.freeze(periods.map((entry) => Object.freeze({
        period: entry.result.period,
        spendUsd: entry.result.spendUsd,
        recoverableUsd: entry.result.recoverableUsd,
        exportId: entry.exportId,
        completeness: entry.completeness,
      }))),
    }),
    benchmark: Object.freeze({
      state: "unavailable",
      eligible: false,
      reasonCode: "no_compatible_cohort",
      message: "Unavailable: the imported contracts contain no compatible peer cohort or benchmark methodology.",
    }),
    decisionInputs: Object.freeze({
      trends: Object.freeze({
        organization: Object.freeze({
          eligible: organizationTrendAvailable,
          changePercent: organizationSpendChangePercent,
          reason: organizationTrendAvailable ? null : historyMessage,
        }),
        departments: Object.freeze(departments.map((department) => Object.freeze({
          departmentId: department.id,
          eligible: department.trendAvailable,
          spendChangeUsd: department.spendChangeUsd,
          spendChangePercent: department.spendChangePercent,
          reason: department.trendReason,
        }))),
      }),
      departmentComparisons: Object.freeze(departments.map((department, index) =>
        Object.freeze({
          departmentId: department.id,
          rank: index + 1,
          observedSpendUsd: department.spendUsd,
          recoverableScenarioUsd: department.recoverableUsd,
          performance: Object.freeze({
            eligible: false,
            score: null,
            reason: "The provider billing contract contains no scored query-category sample.",
            rubricVersion: RUBRIC_VERSION_ID,
          }),
        }))),
      benchmarkEligibility: Object.freeze({
        eligible: false,
        reasonCode: "no_compatible_cohort",
        reason: "The imported contracts contain no peer cohort scored with the same rubric.",
      }),
      provenance: Object.freeze({
        processing: "browser_local_ephemeral",
        providerSourceInstanceId: acceptedSource,
        acceptedProviderExportIds: Object.freeze(periods.map((entry) => entry.exportId)),
        hrisExportId: hris.document?.export_id ?? hris.export_id,
        reconciliationVersion: "local-finops-history/1.0.0",
      }),
      confidence: Object.freeze({
        level: current.result.confidence,
        basis: Object.freeze([
          "provider and HRIS completeness",
          "record reconciliation and active-unit joins",
          "compatible adjacent-period history",
        ]),
        historyEligible: historyState === "available",
      }),
    }),
    validation: Object.freeze({
      state: validations.length ? "needs_review" : "valid",
      results: Object.freeze(validations),
      quarantinedExportIds: Object.freeze([...new Set(quarantinedExports)]),
      quarantinedRecords: Object.freeze(periods.flatMap(
        (entry) => entry.result.quality.quarantine ?? [],
      )),
    }),
  });
}

// Example numbers must never be mistakable for a reader's own once they leave
// the page. Blocking the download instead would have removed the one capability
// an evaluator is here to inspect, so the provenance travels into the artifact:
// a declared field in the JSON and the first line of the summary, both derived
// from the same flag the page uses on screen.
const EXAMPLE_DATASET_NOTICE =
  "EXAMPLE DATA — computed from a bundled synthetic provider export and org roster. "
  + "Not your data and not a report about any real organization.";

export function localFinopsJsonExport(result, { exampleDataset = false } = {}) {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    dataset: exampleDataset ? "example" : "user",
    ...(exampleDataset ? { datasetNotice: EXAMPLE_DATASET_NOTICE } : {}),
    results: result,
  }, null, 2);
}

export function localFinopsMeetingSummary(result, { exampleDataset = false } = {}) {
  const department = result.topDepartment?.name ?? "Unavailable";
  return [
    ...(exampleDataset ? [EXAMPLE_DATASET_NOTICE] : []),
    "LOCAL FINOPS MEETING SUMMARY",
    `Period: ${result.period}`,
    `Observed spend: ${result.spendUsd.toFixed(2)} USD`,
    `Recoverable scenario: ${result.recoverableUsd.toFixed(2)} USD`,
    `Ranked department: ${department}`,
    `Confidence: ${result.confidence}`,
    `Trend: ${result.history?.organizationTrendAvailable
      ? `${result.history.organizationSpendChangePercent > 0 ? "+" : ""}${result.history.organizationSpendChangePercent}% organization spend versus ${result.history.previousPeriod}`
      : result.history?.message ?? "Unavailable from a single provider period."}`,
    `Benchmark: ${result.benchmark?.message ?? "Unavailable from the imported contracts."}`,
    `Priority action: ${result.action}`,
    `Data quality: ${result.warnings.length ? result.warnings.join(" ") : "No declared warnings."}`,
    `Limits: ${result.limits.join(" ")}`,
    `Provenance: ${result.provenance}`,
    "Privacy: processed locally; no upload, credentials, network transfer, or persistence after refresh.",
  ].join("\n");
}
