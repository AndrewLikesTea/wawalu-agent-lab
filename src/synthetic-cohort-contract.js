// Versioned, local-only synthetic comparison data. Pure by construction: the
// caller supplies both the snapshot and reference time; this module does no I/O.
export const SYNTHETIC_COHORT_CONTRACT = "synthetic-cohort/1.0.0";
export const SYNTHETIC_COHORT_KIND = "wawalu.integration.synthetic-cohort";
export const SYNTHETIC_COHORT_MAX_AGE_DAYS = 90;

const ENVELOPE_KEYS = ["schema_version", "kind", "snapshot", "contract_metadata", "cohorts"];
const SNAPSHOT_KEYS = ["snapshot_id", "generated_at", "completeness"];
const META_KEYS = ["publisher", "license", "method_version"];
const COHORT_KEYS = ["industry_band", "organization_size_band", "task_volume_band", "member_count", "measures"];
const MEASURE_KEYS = ["task_success_rate", "cost_per_successful_task_usd", "monthly_cost_usd"];
const UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;
const PROHIBITED = /(?:email|name|employee|hris|prompt|response|credential|secret|token|api.?key|provider.?account|customer|raw.?data|request.?id|subject.?id)/i;

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key))
  && keys.every((key) => key in value);
const outcome = (eligible, code, message, cohorts = []) => Object.freeze({
  contract: SYNTHETIC_COHORT_CONTRACT,
  comparison_eligible: eligible,
  code,
  message,
  cohorts: Object.freeze(cohorts),
});

function prohibitedPath(value, path = "$") {
  if (!object(value) && !Array.isArray(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED.test(key)) return `${path}.${key}`;
    const nested = prohibitedPath(child, `${path}.${key}`);
    if (nested) return nested;
  }
  return null;
}

// Date.parse normalizes February 30. Component round-tripping makes such input
// malformed rather than allowing it to reach the freshness calculation.
export function strictUtcTimestamp(value) {
  const match = typeof value === "string" && UTC.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, ms = "000"] = match;
  const time = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() + 1 !== +mo
      || date.getUTCDate() !== +d || date.getUTCHours() !== +h
      || date.getUTCMinutes() !== +mi || date.getUTCSeconds() !== +s
      || date.getUTCMilliseconds() !== +ms) return null;
  return time;
}

function validCohort(row) {
  if (!exact(row, COHORT_KEYS) || !exact(row.measures, MEASURE_KEYS)) return false;
  if (!["software", "financial_services", "healthcare", "other"].includes(row.industry_band)
      || !["small", "medium", "large"].includes(row.organization_size_band)
      || !["low", "medium", "high"].includes(row.task_volume_band)
      || !Number.isInteger(row.member_count) || row.member_count < 20) return false;
  const { task_success_rate: success, cost_per_successful_task_usd: unitCost,
    monthly_cost_usd: monthlyCost } = row.measures;
  return Number.isFinite(success) && success >= 0 && success <= 1
    && Number.isFinite(unitCost) && unitCost >= 0
    && Number.isFinite(monthlyCost) && monthlyCost >= 0;
}

/** Total, deterministic validation. Invalid input never returns comparison rows. */
export function evaluateSyntheticCohort(input, { reference_time = "2026-08-09T00:00:00Z" } = {}) {
  const prohibited = prohibitedPath(input);
  if (prohibited) return outcome(false, "prohibited_field", `Rejected prohibited field ${prohibited}.`);
  if (!exact(input, ENVELOPE_KEYS) || !exact(input?.snapshot, SNAPSHOT_KEYS)
      || !exact(input?.contract_metadata, META_KEYS) || !Array.isArray(input?.cohorts)) {
    return outcome(false, "malformed_input", "Required fields are missing, malformed, or unapproved.");
  }
  if (input.schema_version !== "1.0.0" || input.kind !== SYNTHETIC_COHORT_KIND) {
    return outcome(false, "incompatible_version", "Only synthetic-cohort schema 1.0.0 is supported.");
  }
  if (input.snapshot.completeness !== "complete") {
    return outcome(false, "missing_data", "Partial snapshots are not comparison eligible.");
  }
  const generated = strictUtcTimestamp(input.snapshot.generated_at);
  const reference = strictUtcTimestamp(reference_time);
  if (generated === null || reference === null || generated > reference) {
    return outcome(false, "malformed_input", "snapshot.generated_at and reference_time must be real RFC 3339 UTC timestamps.");
  }
  if ((reference - generated) / 86_400_000 > SYNTHETIC_COHORT_MAX_AGE_DAYS) {
    return outcome(false, "stale_input", `Snapshot exceeds the ${SYNTHETIC_COHORT_MAX_AGE_DAYS}-day freshness window.`);
  }
  if (!/^syn_[a-z0-9_-]+$/.test(input.snapshot.snapshot_id)
      || !Object.values(input.contract_metadata).every((value) => typeof value === "string" && value.length > 0)
      || input.cohorts.length === 0 || !input.cohorts.every(validCohort)) {
    return outcome(false, "malformed_input", "Snapshot metadata or aggregate cohort rows are malformed.");
  }
  const keys = input.cohorts.map((row) => [row.industry_band, row.organization_size_band,
    row.task_volume_band].join("/"));
  if (new Set(keys).size !== keys.length) {
    return outcome(false, "malformed_input", "Duplicate aggregate cohort bands are ambiguous.");
  }
  const cohorts = input.cohorts.map((row) => structuredClone(row))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    .map((row) => Object.freeze({ ...row, measures: Object.freeze(row.measures) }));
  return outcome(true, "eligible", `${cohorts.length} local synthetic cohort(s) are comparison eligible.`, cohorts);
}
