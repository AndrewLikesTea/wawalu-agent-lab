// Local-only contract for synthetic benchmark reference data and comparison inputs.
// It is deliberately pure: no fetch, storage, credential, provider, or HRIS path.

export const SYNTHETIC_BENCHMARK_VERSION = "finops-synthetic-benchmark/1.0.0";
export const SYNTHETIC_COHORT_KIND = "wawalu.finops.synthetic-cohorts";
export const COMPARISON_INPUT_KIND = "wawalu.finops.benchmark-comparison-input";

export const BENCHMARK_ELIGIBILITY_CODE = Object.freeze({
  eligible: "eligible",
  missing: "missing_aggregate_attribute",
  incompatible: "incompatible_contract",
  malformed: "malformed_contract",
  prohibited: "prohibited_field",
});

const COHORT_ID = /^synthetic-cohorts-\d{4}-(0[1-9]|1[0-2])$/;
// JSON Schema date-time profile: full date + T + time + mandatory offset. Date-only
// values and implementation-dependent Date.parse extensions are refused.
const RFC3339 = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const PROHIBITED = /(^|_)(id|identifier|email|name|employee|hris|account|tenant|customer|prompt|response|credential|secret|token|api[_-]?key|raw)(_|$)/i;
const TOP = new Set(["schemaVersion", "kind", "snapshot", "cohorts"]);
const SNAPSHOT = new Set(["id", "generatedAt"]);
const COHORT = new Set(["industryBand", "organizationSizeBand", "taskVolumeBand", "measures"]);
const MEASURES = new Set(["performance", "cost"]);
const INPUT = new Set(["schemaVersion", "kind", "industryBand", "organizationSizeBand", "taskVolumeBand", "measures"]);

function fields(value, path = "$", found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    // The envelope's versioned snapshot id is metadata, never a person/account
    // identifier. No other `id` field is accepted anywhere in either schema.
    if (PROHIBITED.test(key) && !(path === "$.snapshot" && key === "id")) found.push(`${path}.${key}`);
    fields(child, `${path}.${key}`, found);
  }
  return found;
}

function exact(value, allowed, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`); return;
  }
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not approved`);
}

function band(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{1,39}$/.test(value);
}

function jsonDateTime(value) {
  const match = RFC3339.exec(value ?? "");
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function measures(value, path, errors) {
  exact(value, MEASURES, path, errors);
  if (!value || !Number.isFinite(value.performance) || value.performance < 0 || value.performance > 100)
    errors.push(`${path}.performance must be a number in [0,100]`);
  if (!value || !Number.isFinite(value.cost) || value.cost < 0)
    errors.push(`${path}.cost must be a non-negative number`);
}

function result(errors, missing = []) {
  const prohibited = errors.find((entry) => entry.includes("prohibited"));
  const incompatible = errors.find((entry) => entry.includes("schemaVersion") || entry.includes("kind"));
  const code = prohibited ? BENCHMARK_ELIGIBILITY_CODE.prohibited
    : incompatible ? BENCHMARK_ELIGIBILITY_CODE.incompatible
      : missing.length ? BENCHMARK_ELIGIBILITY_CODE.missing
        : errors.length ? BENCHMARK_ELIGIBILITY_CODE.malformed : BENCHMARK_ELIGIBILITY_CODE.eligible;
  return Object.freeze({ version: SYNTHETIC_BENCHMARK_VERSION, eligible: !errors.length,
    code, errors: Object.freeze(errors), missing: Object.freeze(missing) });
}

export function validateSyntheticCohortSnapshot(document) {
  const errors = [];
  for (const path of fields(document)) errors.push(`${path} is prohibited`);
  exact(document, TOP, "$", errors);
  if (document?.schemaVersion !== SYNTHETIC_BENCHMARK_VERSION) errors.push("$.schemaVersion is incompatible");
  if (document?.kind !== SYNTHETIC_COHORT_KIND) errors.push("$.kind is incompatible");
  exact(document?.snapshot, SNAPSHOT, "$.snapshot", errors);
  if (!COHORT_ID.test(document?.snapshot?.id ?? ""))
    errors.push("$.snapshot.id must match synthetic-cohorts-YYYY-MM");
  if (!jsonDateTime(document?.snapshot?.generatedAt))
    errors.push("$.snapshot.generatedAt must be an RFC 3339 JSON date-time");
  if (!Array.isArray(document?.cohorts) || !document.cohorts.length) errors.push("$.cohorts must be non-empty");
  for (const [index, cohort] of (document?.cohorts ?? []).entries()) {
    const path = `$.cohorts[${index}]`; exact(cohort, COHORT, path, errors);
    for (const key of ["industryBand", "organizationSizeBand", "taskVolumeBand"])
      if (!band(cohort?.[key])) errors.push(`${path}.${key} must be an aggregate band`);
    measures(cohort?.measures, `${path}.measures`, errors);
  }
  return result(errors);
}

export function validateBenchmarkComparisonInput(input, snapshot) {
  const errors = [];
  for (const path of fields(input)) errors.push(`${path} is prohibited`);
  exact(input, INPUT, "$", errors);
  if (input?.schemaVersion !== SYNTHETIC_BENCHMARK_VERSION) errors.push("$.schemaVersion is incompatible");
  if (input?.kind !== COMPARISON_INPUT_KIND) errors.push("$.kind is incompatible");
  const missing = [];
  for (const key of ["industryBand", "organizationSizeBand", "taskVolumeBand"])
    if (!band(input?.[key])) missing.push(key);
  if (!Number.isFinite(input?.measures?.performance)) missing.push("measures.performance");
  if (!Number.isFinite(input?.measures?.cost)) missing.push("measures.cost");
  if (!missing.includes("measures.performance") && !missing.includes("measures.cost"))
    measures(input.measures, "$.measures", errors);
  const snapshotResult = validateSyntheticCohortSnapshot(snapshot);
  if (!snapshotResult.eligible) errors.push(...snapshotResult.errors.map((error) => `snapshot: ${error}`));
  return result(errors, missing);
}
