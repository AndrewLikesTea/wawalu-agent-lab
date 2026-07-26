// Browser-local FinOps import and normalization.
//
// This module deliberately has no fetch, storage, credential, or API path. It
// accepts parsed JSON values, keeps only fields declared by Anya's compatibility
// manifest, and returns a short-lived projection for the page and downloads.

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
const ROUTING_CANDIDATE_SHARE = 0.2;

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
    if (privacy.content_included !== false) {
      fail("privacy_violation", "Prompt or response content must be explicitly excluded.");
    }
    if (!Number.isInteger(privacy.minimum_group_size) || privacy.minimum_group_size < 10) {
      fail("privacy_violation", "Provider aggregates require a minimum group size of 10.");
    }
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
  if (!["complete", "partial"].includes(document.snapshot.completeness)) {
    fail("invalid_value", "snapshot.completeness is unsupported.");
  }
}

function validateProviderRecord(record, index) {
  exactKeys(record, PROVIDER_RECORD_KEYS, `provider records[${index}]`);
  required(record, PROVIDER_RECORD_KEYS, `provider records[${index}]`);
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
}

function validateHrisRecord(record, index) {
  exactKeys(record, HRIS_RECORD_KEYS, `HRIS records[${index}]`);
  required(record, ["unit_id", "revision", "operation", "effective_at"], `HRIS records[${index}]`);
  if (record.operation === "upsert") {
    required(record, ["parent_unit_id", "unit_type", "active"], `HRIS records[${index}]`);
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
  if (document.schema_version !== "1.0" || !Object.values(LOCAL_KINDS).includes(document.kind)) {
    fail("unsupported_contract", "The JSON is not a supported v1 provider or HRIS contract envelope.");
  }
  if (!Array.isArray(document.records)) fail("invalid_value", "document.records must be an array.");
  validatePrivacy(document, document.kind);
  validateSnapshot(document, document.kind);
  document.records.forEach(document.kind === LOCAL_KINDS.provider
    ? validateProviderRecord : validateHrisRecord);
  return Object.freeze({
    type: document.kind === LOCAL_KINDS.provider ? "provider" : "hris",
    fileName,
    document,
  });
}

function latestRecords(records, idKey) {
  const latest = new Map();
  for (const record of records) {
    const prior = latest.get(record[idKey]);
    if (!prior || record.revision > prior.revision) latest.set(record[idKey], record);
  }
  return [...latest.values()];
}

function money(minor) {
  return Math.round(minor) / 100;
}

export function normalizeLocalFinops({ provider, hris }) {
  if (!provider || !hris) fail("incomplete_pair", "Add one provider export and one HRIS mapping.");
  const providerDoc = provider.document ?? provider;
  const hrisDoc = hris.document ?? hris;
  if (providerDoc.kind !== LOCAL_KINDS.provider || hrisDoc.kind !== LOCAL_KINDS.hris) {
    fail("wrong_pair", "The import needs one provider export and one HRIS mapping.");
  }
  const units = latestRecords(hrisDoc.records, "unit_id");
  const active = new Map(units
    .filter((unit) => unit.operation === "upsert" && unit.active)
    .map((unit) => [unit.unit_id, unit]));
  const departments = new Set(units
    .filter((unit) => unit.operation === "upsert" && unit.active && unit.unit_type === "department")
    .map((unit) => unit.unit_id));
  const aggregates = latestRecords(providerDoc.records, "aggregate_id");
  const warnings = [];
  let quarantinedRecords = 0;
  const grouped = new Map();
  for (const record of aggregates) {
    if (!active.has(record.org_unit_id)) {
      quarantinedRecords += 1;
      continue;
    }
    const current = grouped.get(record.org_unit_id) ?? {
      id: record.org_unit_id, spendUsd: 0, recoverableUsd: 0, records: 0, estimatedCosts: 0,
    };
    const spendUsd = money(record.cost.amount_minor);
    current.spendUsd += spendUsd;
    current.records += 1;
    if (record.cost.status !== "final") current.estimatedCosts += 1;
    // The contract has no prompt classification. Only coarse text-generation
    // spend is treated as a candidate, under a disclosed 20% routing scenario.
    if (record.service_category === "text-generation") {
      current.recoverableUsd += spendUsd * ROUTING_CANDIDATE_SHARE;
    }
    grouped.set(record.org_unit_id, current);
  }
  if (quarantinedRecords) {
    warnings.push(`${quarantinedRecords} provider record${quarantinedRecords === 1 ? "" : "s"} quarantined because no active HRIS unit matched.`);
  }
  if (providerDoc.snapshot.completeness !== "complete" || hrisDoc.snapshot.completeness !== "complete") {
    warnings.push("At least one export is partial; totals are directional and omitted records were not inferred.");
  }
  if (providerDoc.snapshot.issues.length || hrisDoc.snapshot.issues.length) {
    warnings.push("A source declared data-quality issues; review the source export before acting.");
  }
  const ranked = [...grouped.values()]
    .map((item) => ({
      ...item,
      name: departments.has(item.id)
        ? `Department …${item.id.slice(-6)}` : `Active unit …${item.id.slice(-6)}`,
      spendUsd: Math.round(item.spendUsd * 100) / 100,
      recoverableUsd: Math.round(item.recoverableUsd * 100) / 100,
    }))
    .sort((left, right) => right.recoverableUsd - left.recoverableUsd
      || right.spendUsd - left.spendUsd || left.id.localeCompare(right.id));
  const spendUsd = Math.round(ranked.reduce((sum, item) => sum + item.spendUsd, 0) * 100) / 100;
  const recoverableUsd = Math.round(
    ranked.reduce((sum, item) => sum + item.recoverableUsd, 0) * 100,
  ) / 100;
  const estimatedCosts = ranked.reduce((sum, item) => sum + item.estimatedCosts, 0);
  if (estimatedCosts) warnings.push(`${estimatedCosts} cost record${estimatedCosts === 1 ? " is" : "s are"} estimated, not final.`);
  if (!ranked.length) warnings.push("No provider records joined to an active HRIS unit.");
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
    confidence,
    provenance: `Browser-local projection of provider export ${providerDoc.export_id} and HRIS export ${hrisDoc.export_id}.`,
    action: top && top.recoverableUsd > 0
      ? `Pilot lower-cost routing for text-generation in ${top.name}; cap the pilot at ${money(top.recoverableUsd * 100).toFixed(2)} USD and verify against a like-for-like period.`
      : "Resolve data-quality gaps before selecting a cost action.",
    assumptions: [
      "Exact pseudonymous org-unit IDs are the only attribution key; no default department is assigned.",
      "Recoverable spend is a scenario: 20% of joined text-generation spend may be routable to a lower-cost service.",
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
      `${top.spendUsd.toFixed(2)} USD observed; ${top.recoverableUsd.toFixed(2)} USD is the disclosed routing scenario.`,
      `${quarantinedRecords} unmatched aggregate${quarantinedRecords === 1 ? "" : "s"} excluded from results.`,
    ] : ["No joined aggregate supports a recommendation."],
    quality: {
      providerCompleteness: providerDoc.snapshot.completeness,
      hrisCompleteness: hrisDoc.snapshot.completeness,
      joinedRecords: ranked.reduce((sum, item) => sum + item.records, 0),
      quarantinedRecords,
      warnings,
    },
  });
}

export function localFinopsJsonExport(result) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), results: result }, null, 2);
}

export function localFinopsMeetingSummary(result) {
  const department = result.topDepartment?.name ?? "Unavailable";
  return [
    "LOCAL FINOPS MEETING SUMMARY",
    `Period: ${result.period}`,
    `Observed spend: ${result.spendUsd.toFixed(2)} USD`,
    `Recoverable scenario: ${result.recoverableUsd.toFixed(2)} USD`,
    `Ranked department: ${department}`,
    `Confidence: ${result.confidence}`,
    `Priority action: ${result.action}`,
    `Data quality: ${result.warnings.length ? result.warnings.join(" ") : "No declared warnings."}`,
    `Limits: ${result.limits.join(" ")}`,
    `Provenance: ${result.provenance}`,
    "Privacy: processed locally; no upload, credentials, network transfer, or persistence after refresh.",
  ].join("\n");
}
