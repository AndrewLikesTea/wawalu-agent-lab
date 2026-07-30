// Bounded client-side join for reopening one retained monthly FinOps action.
import { validateMonthlyActionRecord } from "./monthly-department-action-store.js";

export const REVIEW_READINESS_VERSION = "finops-recurring-review/2.0.0";
export const REVIEW_EVIDENCE_KEY = "shiplog.finops.current-review-evidence.v1";
// The retained handoff payload carries its own version, deliberately separate
// from the result contract above. They are two schemas with two reasons to
// change, and sharing one string means a wording change to the *result* silently
// discards evidence a visitor already retained: the reader rejects the payload,
// the assembler reports `analysis_missing`, and nothing anywhere says why.
export const REVIEW_EVIDENCE_VERSION = "finops-current-review-evidence/1.0.0";
export const REVIEW_STATE = Object.freeze({
  blocked: "blocked", insufficient: "insufficient_evidence", ready: "ready",
});

// What the current side of the comparison actually is. The local analysis ranks
// departments by the down-routing rule's own monthly recoverable figure, which
// is the same quantity the priced decision takes its baseline from — so the two
// are comparable, and this names the assumption rather than implying it by
// borrowing the baseline's label for the current value.
const CURRENT_METRIC = Object.freeze({
  unit: "USD/month",
  definition: "Monthly recoverable spend for the department, from the local down-routing analysis",
});

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const monthOf = (period) => /^(\d{4}-\d{2})/.exec(String(period ?? ""))?.[1] ?? null;
// Live analyses declare `schemaVersion`; the retained projection below stores it
// as `version`. Reading only one of the two records a placeholder as provenance.
const contractOf = (analysis) =>
  analysis?.schemaVersion ?? analysis?.version ?? null;
const freeze = Object.freeze;
function scopeKey(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function projectVerdict(verdict) {
  if (verdict?.measured !== undefined) return verdict;
  return freeze({
    state: verdict?.state ?? null,
    measured: Boolean(verdict?.headline?.available),
    coveragePercent: verdict?.headline?.coveragePercent ?? null,
    rows: verdict?.headline?.totalRows ?? null,
    confidence: verdict?.state === "all_clear" ? "high"
      : verdict?.headline?.available ? "bounded" : "insufficient",
  });
}

function reviewResult(state, code, { action = null, current = null, verdict = null, gaps = [] } = {}) {
  const headline = {
    absent_action: "No retained monthly action is available to resume.",
    analysis_missing: "The retained action is waiting for a current local analysis.",
    verdict_missing: "The current analysis has no Theo evidence verdict.",
    department_changed: "The current analysis covers a different department.",
    period_not_later: "The current analysis is not from a later comparable period.",
    metric_changed: "The retained benchmark is not stated in the unit this analysis measures.",
    verdict_insufficient: "Theo’s verdict does not support an evidence-bounded review.",
    ready: "The retained action and current local evidence are ready for review.",
  }[code];
  return freeze({
    schemaVersion: REVIEW_READINESS_VERSION,
    question: "Is this month’s review ready to act on?",
    state,
    ready: state === REVIEW_STATE.ready,
    code,
    headline,
    benchmark: freeze({
      value: finite(action?.baseline?.value) ? action.baseline.value : null,
      unit: action?.baseline?.unit ?? null,
      period: action?.baseline?.period ?? null,
      definition: action?.baseline?.calculation ?? null,
    }),
    current: freeze({
      value: finite(current?.value) ? current.value : null,
      unit: CURRENT_METRIC.unit,
      definition: CURRENT_METRIC.definition,
      period: current?.period ?? null,
      department: current?.department ?? null,
    }),
    confidence: freeze({
      action: action?.confidence ?? null,
      theo: verdict?.confidence ?? null,
      coveragePercent: finite(verdict?.coveragePercent) ? verdict.coveragePercent : null,
    }),
    provenance: freeze({
      actionReferences: freeze([...(action?.provenanceReferences ?? [])]),
      analysisContract: current?.contract ?? null,
      verdictState: verdict?.state ?? null,
      verdictRows: Number.isInteger(verdict?.rows) ? verdict.rows : null,
    }),
    evidenceBoundary: freeze({
      joined: freeze(["retained_monthly_action", "current_local_analysis", "theo_verdict"]),
      excluded: freeze(["source_rows", "prompt_text", "file_names", "credentials", "customer_identifiers"]),
      gaps: freeze([...gaps]),
    }),
    recommendation: state === REVIEW_STATE.ready
      ? freeze({
        status: "available",
        change: current.value - action.baseline.value,
        basis: "same_department_later_period_with_theo_verdict",
      })
      : null,
  });
}

/**
 * @param {object} input
 * @param {object|null} input.retainedAction monthly-department-action/1.0.0
 * @param {object|null} input.currentAnalysis current local-finops analysis
 * @param {object|null} input.theoVerdict finops-trust-verdict result
 */
export function assembleRecurringReview({
  retainedAction = null, currentAnalysis = null, theoVerdict = null,
} = {}) {
  if (!retainedAction || !validateMonthlyActionRecord(retainedAction).ok) {
    return reviewResult(REVIEW_STATE.blocked, "absent_action", {
      gaps: ["retained_action_missing"],
    });
  }
  if (!currentAnalysis) {
    return reviewResult(REVIEW_STATE.blocked, "analysis_missing", {
      action: retainedAction, gaps: ["current_analysis_missing"],
    });
  }
  if (!theoVerdict) {
    return reviewResult(REVIEW_STATE.insufficient, "verdict_missing", {
      action: retainedAction, gaps: ["theo_verdict_missing"],
    });
  }
  const department = (currentAnalysis.rankedDepartments ?? [])
    .find((entry) => entry?.name === retainedAction.department
      || entry?.scopeKey === scopeKey(retainedAction.department));
  const current = department && {
    value: department.recoverableUsd,
    department: retainedAction.department,
    period: monthOf(currentAnalysis.period),
    contract: contractOf(currentAnalysis),
  };
  const verdict = projectVerdict(theoVerdict);
  if (!current || !finite(current.value)) {
    return reviewResult(REVIEW_STATE.blocked, "department_changed", {
      action: retainedAction, current, verdict, gaps: ["department_scope_mismatch"],
    });
  }
  // Two figures in the same unit or no subtraction. A retained baseline written
  // in some other unit is not a benchmark for this analysis, and differencing it
  // anyway is how an executive finding ends up defending a number nobody
  // computed. This blocks rather than converts: the review holds no rate table.
  if (retainedAction.baseline.unit !== CURRENT_METRIC.unit) {
    return reviewResult(REVIEW_STATE.blocked, "metric_changed", {
      action: retainedAction, current, verdict, gaps: ["metric_unit_mismatch"],
    });
  }
  if (!current.period || current.period <= retainedAction.baseline.period) {
    return reviewResult(REVIEW_STATE.blocked, "period_not_later", {
      action: retainedAction, current, verdict, gaps: ["later_period_missing"],
    });
  }
  if (!verdict.measured || ["empty", "mixed_currency", "zero_spend"].includes(verdict.state)) {
    return reviewResult(REVIEW_STATE.insufficient, "verdict_insufficient", {
      action: retainedAction, current, verdict, gaps: ["theo_evidence_insufficient"],
    });
  }
  return reviewResult(REVIEW_STATE.ready, "ready", { action: retainedAction, current, verdict });
}

/** Retain only derived fields needed after navigation; never source evidence. */
export function retainCurrentReviewEvidence(storage, { currentAnalysis, theoVerdict } = {}) {
  const period = monthOf(currentAnalysis?.period);
  const rankedDepartments = (currentAnalysis?.rankedDepartments ?? []).map((entry) => ({
    scopeKey: scopeKey(entry?.name), recoverableUsd: entry?.recoverableUsd,
  })).filter((entry) => finite(entry.recoverableUsd));
  if (!period || !rankedDepartments.length || !theoVerdict) return false;
  const payload = {
    schemaVersion: REVIEW_EVIDENCE_VERSION,
    currentAnalysis: {
      version: contractOf(currentAnalysis), period, rankedDepartments,
    },
    theoVerdict: projectVerdict(theoVerdict),
  };
  try {
    storage?.setItem(REVIEW_EVIDENCE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function readCurrentReviewEvidence(storage) {
  try {
    const value = JSON.parse(storage?.getItem(REVIEW_EVIDENCE_KEY));
    return value?.schemaVersion === REVIEW_EVIDENCE_VERSION
      ? freeze({ currentAnalysis: value.currentAnalysis, theoVerdict: value.theoVerdict })
      : freeze({ currentAnalysis: null, theoVerdict: null });
  } catch {
    return freeze({ currentAnalysis: null, theoVerdict: null });
  }
}

export function clearCurrentReviewEvidence(storage) {
  try {
    storage?.removeItem(REVIEW_EVIDENCE_KEY);
  } catch {
    // Clearing remains total when storage is unavailable.
  }
}
