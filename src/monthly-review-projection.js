// A deterministic monthly review over the retained-period contract. This module
// has no storage, DOM, clock, or network access; callers must declare every
// aggregate it may inspect in `retainedPeriods`.
import {
  BENCHMARK_MATERIAL_VARIANCE_PPM, BENCHMARK_STANDING,
  buildExecutiveBriefing, validateExecutiveBriefing,
} from "./executive-finops-briefing.js";
import { FINOPS_PERIOD_FIELDS } from "./finops-workspace-contract.js";
import { scoreActionOutcome } from "./action-outcome-scoring.js";

export const MONTHLY_REVIEW_INPUT_VERSION = "monthly-review-input/1.0.0";
export const MONTHLY_REVIEW_VERSION = "monthly-review-projection/1.0.0";

const freeze = Object.freeze;
const INPUT_FIELDS = freeze(["schemaVersion", "retainedPeriods", "commitments"]);
const INPUT_LIMITS = freeze({ retainedPeriods: 24, commitments: 50 });

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
    if (input.retainedPeriods.length > INPUT_LIMITS.retainedPeriods) {
      errors.push(`input.retainedPeriods: maximum ${INPUT_LIMITS.retainedPeriods}`);
    }
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
  if (input.commitments !== undefined && !Array.isArray(input.commitments)) errors.push("input.commitments: expected array");
  else if (input.commitments?.length > INPUT_LIMITS.commitments) {
    errors.push(`input.commitments: maximum ${INPUT_LIMITS.commitments}`);
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}

const action = (id, statement, evidence) => freeze({
  rank: 1, id, statement, evidence: freeze(evidence),
});

const periodLabel = (period) => {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(period))) return null;
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
};

const nextCalendarMonth = (period) => {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(period))) return null;
  const [year, month] = period.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
};

const unavailableComparison = (reason, commitment = null) => freeze({
  status: "unavailable",
  reason,
  periods: freeze({
    baseline: freeze({ period: commitment?.claim?.period ?? null, label: periodLabel(commitment?.claim?.period) }),
    observed: freeze({ period: commitment?.claim?.period ? nextCalendarMonth(commitment.claim.period) : null,
      label: periodLabel(commitment?.claim?.period ? nextCalendarMonth(commitment.claim.period) : null) }),
  }),
  savings: freeze({ projectedUsd: null, realizedUsd: null, varianceUsd: null }),
  confidence: freeze({ status: "unavailable", effectiveValue: null }),
  provenance: freeze({ source: "browser-local retained derived periods and commitments", commitmentId: commitment?.commitmentId ?? null, periodIds: freeze([]), scoringPolicy: null }),
  priorAction: freeze({ status: "unavailable", commitmentId: commitment?.commitmentId ?? null }),
});

/** One compact outcome from the newest retained commitment and its exact next month. */
function retainedSavingsComparison(periods, commitments) {
  const ordered = [...commitments].sort((left, right) =>
    String(right.recordedAt).localeCompare(String(left.recordedAt))
      || String(left.commitmentId).localeCompare(String(right.commitmentId)));
  const commitment = ordered[0] ?? null;
  if (!commitment) return unavailableComparison("prior_commitment_absent");
  const baselineMonth = commitment.claim?.period;
  const observedMonth = nextCalendarMonth(baselineMonth);
  const baseline = periods.find((item) => item.period === baselineMonth) ?? null;
  const observed = periods.find((item) => item.period === observedMonth) ?? null;
  if (!baseline) return unavailableComparison("baseline_period_absent", commitment);
  if (!observed) return unavailableComparison("observed_period_absent", commitment);
  const scope = String(commitment.periodId ?? "").split(":")[0];
  if (!scope || baseline.dataset !== scope || observed.dataset !== scope) {
    return unavailableComparison("period_scope_mismatch", commitment);
  }
  const projectedMinor = commitment.claim?.monthlySavingsMinor;
  const baselineMinor = baseline.analyzedSpendMinor;
  const observedMinor = observed.analyzedSpendMinor;
  if (![projectedMinor, baselineMinor, observedMinor].every(Number.isSafeInteger)
    || projectedMinor < 0 || baselineMinor < 0 || observedMinor < 0) {
    return unavailableComparison("incomplete_savings_evidence", commitment);
  }
  const realizedMinor = baselineMinor - observedMinor;
  if (realizedMinor < 0) return unavailableComparison("negative_savings_not_scoreable", commitment);
  const scored = scoreActionOutcome({
    actionId: commitment.commitmentId,
    departmentId: commitment.recommendedAction?.departmentId,
    priorityRank: 1,
    projectedSavingsUsd: projectedMinor / 100,
    result: { status: "observed", realizedSavingsUsd: realizedMinor / 100 },
    confidence: { value: Number(commitment.confidence?.percent) / 100 },
    evidenceRefs: [baseline.periodId, observed.periodId],
  });
  return freeze({
    status: "available", reason: null,
    periods: freeze({
      baseline: freeze({ period: baselineMonth, label: periodLabel(baselineMonth) }),
      observed: freeze({ period: observedMonth, label: periodLabel(observedMonth) }),
    }),
    savings: freeze({ projectedUsd: scored.projectedSavingsUsd, realizedUsd: scored.realizedSavingsUsd, varianceUsd: scored.varianceUsd }),
    confidence: freeze({ status: scored.confidence.status, effectiveValue: scored.confidence.effectiveValue }),
    provenance: freeze({ source: "browser-local retained derived periods and commitments", commitmentId: commitment.commitmentId,
      periodIds: freeze([baseline.periodId, observed.periodId]), scoringPolicy: scored.schemaVersion }),
    priorAction: freeze({ status: scored.outcomeCode, commitmentId: commitment.commitmentId }),
  });
}

function comparisonAction(comparison, fallback) {
  const candidates = [];
  if (comparison.status === "unavailable" && !["prior_commitment_absent", "comparison_evidence_missing"].includes(comparison.reason)) candidates.push({ priority: 0, ...action("complete_comparison_evidence", "Retain the missing comparable period or commitment evidence before claiming savings.", [comparison.reason]) });
  if (comparison.priorAction.status === "under_target") candidates.push({ priority: 1, ...action("correct_missed_commitment", "Correct the missed prior commitment before starting another savings action.", ["under_target"]) });
  if (comparison.priorAction.status === "low_confidence") candidates.push({ priority: 2, ...action("strengthen_outcome_evidence", "Strengthen the retained outcome evidence before closing the prior commitment.", ["low_confidence"]) });
  candidates.push({ priority: 9, ...fallback });
  const selected = candidates.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0];
  return action(selected.id, selected.statement, selected.evidence);
}

function absentProjection(input, errors, retainedComparison = null) {
  const comparison = retainedComparison
    ?? unavailableComparison(errors.length ? "invalid_input" : "comparison_evidence_missing");
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
    provenance: freeze({ inputVersion: input?.schemaVersion ?? null, periodIds: freeze([]), errors: freeze(errors) }),
    comparison,
    nextAction: comparisonAction(comparison, action("retain_comparable_period", "Retain the immediately preceding comparable month, then rebuild this review.", ["comparison_evidence_missing"])),
  });
}

/**
 * Build one review. Improving means recoverable share fell; worsening means it
 * rose. This is directional verification, never a causal claim about an action.
 */
export function buildMonthlyReviewProjection(input) {
  const checked = validateMonthlyReviewInput(input);
  if (!checked.valid) return absentProjection(input, [...checked.errors]);
  const comparison = retainedSavingsComparison(input.retainedPeriods, input.commitments ?? []);
  const briefing = buildExecutiveBriefing(input.retainedPeriods);
  const briefingCheck = validateExecutiveBriefing(briefing);
  if (!briefingCheck.valid || !briefing.reportingPeriod || !briefing.benchmark?.eligible) {
    return absentProjection(input, briefingCheck.valid ? []
      : briefingCheck.violations.map(({ path, code }) => `${path}:${code}`), comparison);
  }

  const variance = briefing.benchmark.varianceSharePpm;
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
  const trendAction = status === "improving" && material
    ? action("verify_prior_commitment", "Verify the prior commitment against its recorded scope before closing or extending it.", ["material_improvement", "causality_not_established"])
    : status === "worsening" && material
      ? action("revise_ranked_department_action", "Revise the action for the strongest department contributor before the next review.", ["material_worsening"])
      : action("continue_measurement", "Keep the current action bounded and compare again next month.", ["no_material_change"]);
  const nextAction = comparisonAction(comparison, trendAction);

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
    provenance: freeze({
      inputVersion: input.schemaVersion,
      periodIds: freeze([...briefing.provenance.periodIds]),
      sourceFingerprint: briefing.provenance.sourceFingerprint,
      dataset: briefing.provenance.dataset,
      errors: freeze([]),
    }),
    comparison,
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
  if (!Array.isArray(review.provenance?.periodIds)) errors.push("provenance.periodIds: required array");
  if (!["available", "unavailable"].includes(review.comparison?.status)) errors.push("comparison: required explicit state");
  if (review.materialBenchmark?.status === "improving" && !(review.materialBenchmark.changeSharePpm < 0)) {
    errors.push("materialBenchmark: improving requires a negative change");
  }
  if (review.materialBenchmark?.status === "worsening" && !(review.materialBenchmark.changeSharePpm > 0)) {
    errors.push("materialBenchmark: worsening requires a positive change");
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}
