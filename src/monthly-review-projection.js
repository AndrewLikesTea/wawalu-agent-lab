// A deterministic monthly review over the retained-period contract. This module
// has no storage, DOM, clock, or network access; callers must declare every
// aggregate it may inspect in `retainedPeriods`.
import {
  BENCHMARK_MATERIAL_VARIANCE_PPM, BENCHMARK_STANDING,
  buildExecutiveBriefing, validateExecutiveBriefing,
} from "./executive-finops-briefing.js";
import { FINOPS_PERIOD_FIELDS } from "./finops-workspace-contract.js";
import { scoreRetainedSavingsComparison } from "./retained-savings-score.js";

export const MONTHLY_REVIEW_INPUT_VERSION = "monthly-review-input/1.0.0";
export const MONTHLY_REVIEW_VERSION = "monthly-review-projection/1.1.0";

const freeze = Object.freeze;
const INPUT_FIELDS = freeze(["schemaVersion", "retainedPeriods"]);

function closedObject(value, fields, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path}: expected object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) errors.push(`${path}.${key}: undeclared field`);
  }
  return true;
}

/** Validate the complete, bounded input model. Total: failures are data. */
export function validateMonthlyReviewInput(input) {
  const errors = [];
  if (!closedObject(input, INPUT_FIELDS, "input", errors)) {
    return freeze({ valid: false, errors: freeze(errors) });
  }
  if (input.schemaVersion !== MONTHLY_REVIEW_INPUT_VERSION) {
    errors.push("input.schemaVersion: unsupported version");
  }
  if (!Array.isArray(input.retainedPeriods)) {
    errors.push("input.retainedPeriods: expected array");
  } else {
    input.retainedPeriods.forEach((period, index) => {
      const path = `input.retainedPeriods[${index}]`;
      if (!closedObject(period, FINOPS_PERIOD_FIELDS, path, errors)) return;
      if (typeof period.periodId !== "string" || !period.periodId) {
        errors.push(`${path}.periodId: required string`);
      }
      if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(period.period))) {
        errors.push(`${path}.period: expected YYYY-MM`);
      }
    });
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}

function absentProjection(input, errors) {
  const { nextAction, ...claim } = scoreRetainedSavingsComparison([]);
  const savingsClaim = freeze(claim);
  return freeze({
    schemaVersion: MONTHLY_REVIEW_VERSION,
    inputVersion: input?.schemaVersion ?? null,
    status: errors.length ? "invalid_input" : "missing_comparison_evidence",
    materialBenchmark: freeze({
      status: "unavailable", material: null, currentSharePpm: null,
      baselineSharePpm: null, changeSharePpm: null,
      thresholdPpm: BENCHMARK_MATERIAL_VARIANCE_PPM,
      reason: errors.length ? "invalid_input" : "comparison_evidence_missing",
    }),
    strongestDepartmentContributor: null,
    priorCommitmentVerification: freeze({
      status: "not_verifiable", basis: "No comparable prior retained periods establish an outcome to verify.",
    }),
    confidence: freeze({ level: "insufficient", basis: "comparison_evidence_missing" }),
    savingsClaim,
    provenance: freeze({ inputVersion: input?.schemaVersion ?? null, periodIds: freeze([]), errors: freeze(errors) }),
    nextAction,
  });
}

/**
 * Build one review. Improving means recoverable share fell; worsening means it
 * rose. This is directional verification, never a causal claim about an action.
 */
export function buildMonthlyReviewProjection(input) {
  const checked = validateMonthlyReviewInput(input);
  if (!checked.valid) return absentProjection(input, [...checked.errors]);
  const briefing = buildExecutiveBriefing(input.retainedPeriods);
  const briefingCheck = validateExecutiveBriefing(briefing);
  if (!briefingCheck.valid || !briefing.reportingPeriod || !briefing.benchmark?.eligible) {
    return absentProjection(input, briefingCheck.valid ? []
      : briefingCheck.violations.map(({ path, code }) => `${path}:${code}`));
  }

  const variance = briefing.benchmark.varianceSharePpm;
  const { nextAction, ...claim } = scoreRetainedSavingsComparison(briefing.periods ?? input.retainedPeriods);
  const savingsClaim = freeze(claim);
  const status = briefing.benchmark.standing === BENCHMARK_STANDING.less ? "improving"
    : briefing.benchmark.standing === BENCHMARK_STANDING.more ? "worsening" : "stable";
  const material = Math.abs(variance) > BENCHMARK_MATERIAL_VARIANCE_PPM;
  const verification = status === "improving" && material
    ? freeze({
      status: "candidate_supported",
      basis: "Recoverable share materially improved against retained history; this supports checking the prior commitment, not attributing causality to it.",
    })
    : freeze({
      status: "not_supported",
      basis: status === "worsening"
        ? "The retained outcome worsened, so prior-commitment success is not supported."
        : "The movement did not clear the materiality threshold.",
    });
  // One scorer owns priority. Trend remains evidence, never a competing action.

  return freeze({
    schemaVersion: MONTHLY_REVIEW_VERSION,
    inputVersion: input.schemaVersion,
    status,
    materialBenchmark: freeze({
      status, material,
      currentSharePpm: briefing.recoverable.sharePpm,
      baselineSharePpm: briefing.benchmark.baselineSharePpm,
      changeSharePpm: variance,
      thresholdPpm: BENCHMARK_MATERIAL_VARIANCE_PPM,
      reason: null,
    }),
    strongestDepartmentContributor: freeze({
      departmentId: briefing.primaryFinding.orgUnitId,
      periodId: briefing.primaryFinding.periodId,
      basis: briefing.primaryFinding.basis,
    }),
    priorCommitmentVerification: verification,
    confidence: freeze({ level: briefing.confidence.level, basis: briefing.confidence.meaning }),
    savingsClaim,
    provenance: freeze({
      inputVersion: input.schemaVersion,
      periodIds: freeze([...briefing.provenance.periodIds]),
      sourceFingerprint: briefing.provenance.sourceFingerprint,
      dataset: briefing.provenance.dataset,
      errors: freeze([]),
    }),
    nextAction,
  });
}

/** Reject malformed or self-contradictory output before a view paints it. */
export function validateMonthlyReviewProjection(review) {
  const errors = [];
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return freeze({ valid: false, errors: freeze(["review: expected object"]) });
  }
  if (review.schemaVersion !== MONTHLY_REVIEW_VERSION) errors.push("schemaVersion: unsupported version");
  if (review.nextAction?.rank !== 1 || typeof review.nextAction?.id !== "string") {
    errors.push("nextAction: exactly one rank-1 action is required");
  }
  if (!review.materialBenchmark || !("material" in review.materialBenchmark)) {
    errors.push("materialBenchmark: required");
  }
  if (!(review.strongestDepartmentContributor === null
    || typeof review.strongestDepartmentContributor?.departmentId === "string")) {
    errors.push("strongestDepartmentContributor: invalid");
  }
  if (typeof review.priorCommitmentVerification?.status !== "string") errors.push("priorCommitmentVerification: required");
  if (typeof review.confidence?.level !== "string") errors.push("confidence: required");
  if (typeof review.savingsClaim?.confidence?.score !== "number") errors.push("savingsClaim: score is required");
  if (!Array.isArray(review.provenance?.periodIds)) errors.push("provenance.periodIds: required array");
  if (review.materialBenchmark?.status === "improving" && !(review.materialBenchmark.changeSharePpm < 0)) {
    errors.push("materialBenchmark: improving requires a negative change");
  }
  if (review.materialBenchmark?.status === "worsening" && !(review.materialBenchmark.changeSharePpm > 0)) {
    errors.push("materialBenchmark: worsening requires a positive change");
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}
