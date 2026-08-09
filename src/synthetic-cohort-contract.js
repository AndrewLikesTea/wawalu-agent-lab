// Local, synthetic benchmark cohorts for the bundled provider-scenario entry.
// This module is deliberately pure: no fetch, storage, provider, HRIS, or clock.

export const SYNTHETIC_COHORT_CONTRACT = "synthetic-benchmark-cohorts/1.0.0";
export const SYNTHETIC_COHORT_KIND = "wawalu.integration.synthetic-benchmark-cohorts";

const SNAPSHOT_ID = /^synthetic-cohorts-(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;
const TOP_KEYS = ["schemaVersion", "kind", "snapshot", "cohorts"];
const SNAPSHOT_KEYS = ["id", "generatedAt", "source", "completeness"];
const COHORT_KEYS = ["cohortKey", "organizationSize", "industry", "memberCount", "monthlySpendUsd"];
const SPEND_KEYS = ["p25", "p50", "p75"];
const PROHIBITED = /^(?:id|identifier|email|name|prompt|response|credential|credentials|apiKey|token|secret|accountId|providerAccountId|employee|employeeId|employeeRecord|hrisRecord|records|raw|rawData|customer|customerData)$/i;

const reason = (code, valid, message) => Object.freeze({ code, valid, message });
const ownKeys = (value, allowed) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).every((key) => allowed.includes(key));

function strictUtcDateTime(value) {
  if (typeof value !== "string") return false;
  const match = DATE_TIME.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, millis = "000"] = match;
  const time = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, +millis);
  if (!Number.isFinite(time)) return false;
  const canonical = new Date(time).toISOString();
  return canonical === `${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`;
}

function prohibitedPath(value, path = "$") {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    // snapshot.id is the contract's required publication identifier. No other
    // identifier-shaped field is accepted by the allowlists below.
    if (PROHIBITED.test(key) && childPath !== "$.snapshot.id") return childPath;
    const nested = prohibitedPath(child, childPath);
    if (nested) return nested;
  }
  return null;
}

function validCohort(cohort) {
  if (!ownKeys(cohort, COHORT_KEYS) || !COHORT_KEYS.every((key) => key in cohort)) return false;
  if (!/^cohort-[a-z0-9-]+$/.test(cohort.cohortKey)) return false;
  if (!["small", "mid", "enterprise"].includes(cohort.organizationSize)) return false;
  if (!["software", "financial-services", "healthcare"].includes(cohort.industry)) return false;
  if (!Number.isInteger(cohort.memberCount) || cohort.memberCount < 20) return false;
  const spend = cohort.monthlySpendUsd;
  return ownKeys(spend, SPEND_KEYS) && SPEND_KEYS.every((key) => Number.isFinite(spend[key]) && spend[key] >= 0)
    && spend.p25 <= spend.p50 && spend.p50 <= spend.p75;
}

const finish = (eligible, reasons, snapshot = null, cohorts = []) => Object.freeze({
  contract: SYNTHETIC_COHORT_CONTRACT, eligible,
  // Named explicitly for consumers rendering why a comparison is or is not
  // allowed; `reasons` remains the compact eligibility vocabulary.
  reasons: Object.freeze(reasons), comparisonReasons: Object.freeze(reasons), snapshot,
  cohorts: Object.freeze(cohorts),
});

/** Validate before projection. Invalid or prohibited input yields no cohorts. */
export function evaluateSyntheticCohorts(input) {
  const reasons = [];
  const prohibited = prohibitedPath(input);
  reasons.push(reason("approved_aggregates_only", !prohibited,
    prohibited ? `Prohibited field at ${prohibited}; no cohort data was accepted.`
      : "Only approved aggregate cohort attributes are present."));
  if (prohibited) return finish(false, reasons);

  const envelope = ownKeys(input, TOP_KEYS) && TOP_KEYS.every((key) => key in input);
  reasons.push(reason("contract_shape", envelope,
    envelope ? "Envelope fields match the published contract."
      : "Envelope is missing required fields or contains unapproved fields."));
  if (!envelope) return finish(false, reasons);

  const compatible = input.schemaVersion === "1.0.0" && input.kind === SYNTHETIC_COHORT_KIND;
  reasons.push(reason("compatible_version", compatible,
    compatible ? "Contract version 1.0.0 and kind are supported."
      : "Contract version or kind is incompatible."));
  if (!compatible) return finish(false, reasons);

  const snapshotShape = ownKeys(input.snapshot, SNAPSHOT_KEYS)
    && SNAPSHOT_KEYS.every((key) => key in input.snapshot);
  reasons.push(reason("snapshot_shape", snapshotShape,
    snapshotShape ? "Snapshot fields match the published contract."
      : "Snapshot is missing required fields or contains unapproved fields."));
  if (!snapshotShape) return finish(false, reasons);

  const idMatch = SNAPSHOT_ID.exec(input.snapshot.id);
  const idValid = Boolean(idMatch);
  reasons.push(reason("snapshot_id", idValid,
    idValid ? "Snapshot id matches synthetic-cohorts-YYYY-MM."
      : "snapshot.id is required and must match synthetic-cohorts-YYYY-MM."));
  if (!idValid) return finish(false, reasons);

  const generatedAtValid = strictUtcDateTime(input.snapshot.generatedAt);
  reasons.push(reason("generated_at", generatedAtValid,
    generatedAtValid ? "generatedAt is a strict UTC date-time."
      : "snapshot.generatedAt must be a real RFC 3339 UTC date-time, not a date-only value."));
  if (!generatedAtValid) return finish(false, reasons);

  const publishedMonth = `${idMatch[1]}-${idMatch[2]}`;
  const monthMatches = input.snapshot.generatedAt.startsWith(publishedMonth);
  const synthetic = input.snapshot.source === "local-synthetic"
    && input.snapshot.completeness === "complete";
  reasons.push(reason("published_month", monthMatches,
    monthMatches ? "Snapshot id month matches generatedAt." : "Snapshot id month and generatedAt disagree."));
  reasons.push(reason("local_synthetic_source", synthetic,
    synthetic ? "Snapshot is complete, local synthetic reference data."
      : "Only complete local-synthetic snapshots are eligible."));
  if (!monthMatches || !synthetic) return finish(false, reasons);

  const cohortsValid = Array.isArray(input.cohorts) && input.cohorts.length > 0
    && input.cohorts.every(validCohort)
    && new Set(input.cohorts.map(({ cohortKey }) => cohortKey)).size === input.cohorts.length;
  reasons.push(reason("aggregate_cohorts", cohortsValid,
    cohortsValid ? `${input.cohorts.length} aggregate cohort(s) passed deterministic validation.`
      : "Cohorts must be unique approved aggregate records with ordered spend percentiles."));
  if (!cohortsValid) return finish(false, reasons);

  const snapshot = Object.freeze({ id: input.snapshot.id, generatedAt: input.snapshot.generatedAt });
  // Arrival order is not meaning: canonical output makes reordered deliveries
  // byte-stable and prevents callers from treating order as a ranking.
  const cohorts = [...input.cohorts].sort((left, right) => left.cohortKey.localeCompare(right.cohortKey))
    .map((cohort) => Object.freeze({ ...cohort,
      monthlySpendUsd: Object.freeze({ ...cohort.monthlySpendUsd }) }));
  return finish(true, reasons, snapshot, cohorts);
}
