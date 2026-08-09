// Browser-local contract for published synthetic benchmark inputs. This module
// has no fetch, storage, provider, identity, or HRIS dependency: callers hand it
// an already-bundled object and receive an inspectable eligibility decision.

export const SYNTHETIC_COHORT_CONTRACT = "synthetic-cohort-snapshot/1.0.0";
export const SYNTHETIC_COHORT_ID = /^synthetic-cohorts-(\d{4})-(0[1-9]|1[0-2])$/;

export const SYNTHETIC_COHORT_REASON = Object.freeze({
  eligible: "eligible",
  missing: "missing_required_field",
  incompatible: "incompatible_contract_version",
  malformed: "malformed_synthetic_cohort_snapshot",
  prohibited: "prohibited_input",
});

// Aggregates only. These are the complete attributes a future fixture may add
// without a contract-version change.
export const SYNTHETIC_COHORT_ATTRIBUTES = Object.freeze([
  "scenario_id", "provider_family", "export_format", "department_label",
  "spend_usd", "query_count", "recoverable_spend_usd", "action_code",
]);

const REQUIRED = Object.freeze(["contractVersion", "snapshot", "scenarios"]);
const SCENARIO_REQUIRED = Object.freeze(SYNTHETIC_COHORT_ATTRIBUTES);
const FORBIDDEN_KEY = /(^|_)(id(entifier)?|email|name|employee|account|tenant|customer|prompt|credential|secret|token|api_?key|raw_?data)(_|$)/i;
const STRICT_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

const result = (eligible, reason, issues = [], snapshotId = null) => Object.freeze({
  contract: SYNTHETIC_COHORT_CONTRACT,
  eligible,
  reason,
  snapshotId,
  issues: Object.freeze([...issues].sort()),
  execution: Object.freeze({ location: "client", networkRequired: false }),
});

function strictDateTime(value) {
  const match = typeof value === "string" && value.match(STRICT_DATE_TIME);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , zone] = match;
  if (+month < 1 || +month > 12 || +hour > 23 || +minute > 59 || +second > 59) return false;
  if (zone !== "Z") {
    const [, zh, zm] = zone.match(/[+-](\d{2}):(\d{2})/) ?? [];
    if (+zh > 23 || +zm > 59) return false;
  }
  const days = new Date(Date.UTC(+year, +month, 0)).getUTCDate();
  return +day >= 1 && +day <= days;
}

function prohibitedPaths(value, path = "$", found = []) {
  if (!value || typeof value !== "object") return found;
  for (const key of Object.keys(value).sort()) {
    const next = `${path}.${key}`;
    if (FORBIDDEN_KEY.test(key) && key !== "scenario_id" && next !== "$.snapshot.id") found.push(next);
    prohibitedPaths(value[key], next, found);
  }
  return found;
}

/** Validate a bundled snapshot without throwing, mutation, I/O, or clock use. */
export function inspectSyntheticCohort(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return result(false, SYNTHETIC_COHORT_REASON.malformed, ["$: expected an object"]);
  }
  const prohibited = prohibitedPaths(input);
  if (prohibited.length) {
    return result(false, SYNTHETIC_COHORT_REASON.prohibited,
      prohibited.map((path) => `${path}: prohibited attribute`), input.snapshot?.id ?? null);
  }
  const missing = REQUIRED.filter((key) => input[key] === undefined);
  if (missing.length) return result(false, SYNTHETIC_COHORT_REASON.missing,
    missing.map((key) => `$.${key}: required`), input.snapshot?.id ?? null);
  if (input.contractVersion !== SYNTHETIC_COHORT_CONTRACT) {
    return result(false, SYNTHETIC_COHORT_REASON.incompatible,
      [`$.contractVersion: expected ${SYNTHETIC_COHORT_CONTRACT}`], input.snapshot?.id ?? null);
  }

  const issues = [];
  const snapshot = input.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    issues.push("$.snapshot: expected an object");
  } else {
    if (typeof snapshot.id !== "string" || !SYNTHETIC_COHORT_ID.test(snapshot.id)) {
      issues.push("$.snapshot.id: required and must match synthetic-cohorts-YYYY-MM");
    }
    if (!strictDateTime(snapshot.generatedAt)) {
      issues.push("$.snapshot.generatedAt: required strict RFC 3339 date-time");
    }
    for (const key of Object.keys(snapshot)) {
      if (!["id", "generatedAt"].includes(key)) issues.push(`$.snapshot.${key}: attribute not allowlisted`);
    }
  }
  if (!Array.isArray(input.scenarios) || input.scenarios.length === 0) {
    issues.push("$.scenarios: expected at least one aggregate scenario");
  } else {
    const ids = new Set();
    input.scenarios.forEach((entry, index) => {
      const path = `$.scenarios[${index}]`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        issues.push(`${path}: expected an object`); return;
      }
      for (const key of Object.keys(entry)) {
        if (!SYNTHETIC_COHORT_ATTRIBUTES.includes(key)) issues.push(`${path}.${key}: attribute not allowlisted`);
      }
      for (const key of SCENARIO_REQUIRED) if (entry[key] === undefined) issues.push(`${path}.${key}: required`);
      for (const key of ["scenario_id", "provider_family", "export_format", "department_label", "action_code"]) {
        if (typeof entry[key] !== "string" || !entry[key]) issues.push(`${path}.${key}: non-empty string required`);
      }
      if (typeof entry.scenario_id !== "string" || !entry.scenario_id) { /* reported above */ }
      else if (ids.has(entry.scenario_id)) issues.push(`${path}.scenario_id: duplicate`);
      else ids.add(entry.scenario_id);
      for (const key of ["spend_usd", "query_count", "recoverable_spend_usd"]) {
        if (!Number.isFinite(entry[key]) || entry[key] < 0) issues.push(`${path}.${key}: non-negative finite number required`);
      }
      if (Number.isFinite(entry.recoverable_spend_usd) && Number.isFinite(entry.spend_usd)
        && entry.recoverable_spend_usd > entry.spend_usd) issues.push(`${path}.recoverable_spend_usd: exceeds spend_usd`);
    });
  }
  for (const key of Object.keys(input)) {
    if (!REQUIRED.includes(key)) issues.push(`$.${key}: attribute not allowlisted`);
  }
  return issues.length
    ? result(false, SYNTHETIC_COHORT_REASON.malformed, issues, snapshot?.id ?? null)
    : result(true, SYNTHETIC_COHORT_REASON.eligible, [], snapshot.id);
}
