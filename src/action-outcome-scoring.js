import { redactForScoring } from "./evolution.js";

/**
 * Executable and reviewable policy for projected-versus-realized savings.
 *
 * Assumptions:
 * - A 5% projection tolerance covers whole-dollar rounding and ordinary
 *   measurement noise without redefining a materially missed target as success.
 * - The $100 floor keeps the same rounding allowance useful for small non-zero
 *   projections. Zero projections are exact because a percentage is undefined.
 * - Confidence below 0.75 is not strong enough for an executive outcome claim.
 *   0.75 means at least three quarters of the stated support survives the most
 *   conservative confidence signal; it is a disclosure gate, not a probability.
 * - Conflicting confidence signals resolve to their minimum. An average could
 *   hide weak evidence behind a strong model or analyst assertion.
 * - Priority is authored evidence, not recomputed from outcomes. Ascending
 *   priorityRank then actionId is stable and avoids outcome-driven reshuffling.
 */
export const ACTION_OUTCOME_POLICY = Object.freeze({
  version: "action-outcome/1.0.0",
  relativeTolerance: 0.05,
  absoluteToleranceUsd: 100,
  minimumConfidence: 0.75,
  priorityRule: "ascending priorityRank, then actionId",
});

const LABELS = Object.freeze({
  successful: "Target met",
  under_target: "Below target",
  awaiting_result: "Awaiting result",
  low_confidence: "Low-confidence estimate",
});

function nonNegativeMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function confidenceSignals(confidence = {}) {
  const candidates = [
    { source: "stated", value: confidence.value },
    ...(Array.isArray(confidence.signals) ? confidence.signals : []),
  ];
  return candidates.map((signal) => ({
    source: String(signal?.source || "unspecified"),
    value: Number(signal?.value),
  })).filter((signal) => Number.isFinite(signal.value)
    && signal.value >= 0 && signal.value <= 1);
}

/**
 * Return the complete UI contract. Raw fixture text is deliberately omitted:
 * only the redacted prompt can cross this scoring/judge-facing boundary.
 */
export function scoreActionOutcome(action = {}) {
  const projectedSavingsUsd = nonNegativeMoney(action.projectedSavingsUsd);
  if (projectedSavingsUsd === null)
    throw new TypeError("projectedSavingsUsd must be a non-negative finite amount");

  const resultStatus = action.result?.status;
  const realizedSavingsUsd = resultStatus === "observed"
    ? nonNegativeMoney(action.result?.realizedSavingsUsd) : null;
  const signals = confidenceSignals(action.confidence);
  const effectiveConfidence = signals.length
    ? Math.min(...signals.map((signal) => signal.value)) : 0;
  const toleranceUsd = projectedSavingsUsd === 0 ? 0
    : Math.max(ACTION_OUTCOME_POLICY.absoluteToleranceUsd,
      Math.round(projectedSavingsUsd * ACTION_OUTCOME_POLICY.relativeTolerance));

  let comparisonCode = "awaiting_result";
  if (realizedSavingsUsd !== null) {
    comparisonCode = realizedSavingsUsd + toleranceUsd >= projectedSavingsUsd
      ? "successful" : "under_target";
  }
  const outcomeCode = comparisonCode !== "awaiting_result"
    && effectiveConfidence < ACTION_OUTCOME_POLICY.minimumConfidence
    ? "low_confidence" : comparisonCode;
  const varianceUsd = realizedSavingsUsd === null
    ? null : realizedSavingsUsd - projectedSavingsUsd;
  const attainmentPercent = realizedSavingsUsd === null || projectedSavingsUsd === 0
    ? null : Math.round((realizedSavingsUsd / projectedSavingsUsd) * 1000) / 10;

  return {
    schemaVersion: ACTION_OUTCOME_POLICY.version,
    fixtureId: String(action.fixtureId || ""),
    actionId: String(action.actionId || ""),
    departmentId: String(action.departmentId || ""),
    priorityRank: Number.isInteger(action.priorityRank) ? action.priorityRank : null,
    outcomeCode,
    outcomeLabel: LABELS[outcomeCode],
    comparisonCode,
    projectedSavingsUsd,
    realizedSavingsUsd,
    varianceUsd,
    attainmentPercent,
    toleranceUsd,
    confidence: {
      effectiveValue: effectiveConfidence,
      threshold: ACTION_OUTCOME_POLICY.minimumConfidence,
      status: effectiveConfidence >= ACTION_OUTCOME_POLICY.minimumConfidence ? "sufficient" : "low",
      resolutionRule: "minimum valid signal",
      signals,
    },
    evidenceRefs: [...new Set(Array.isArray(action.evidenceRefs) ? action.evidenceRefs : [])],
    provenance: {
      source: "bundled deterministic synthetic fixture",
      fixtureId: String(action.fixtureId || ""),
      actionId: String(action.actionId || ""),
      evidenceRefs: [...new Set(Array.isArray(action.evidenceRefs) ? action.evidenceRefs : [])],
      scoringPolicy: ACTION_OUTCOME_POLICY.version,
    },
    judgeInput: {
      prompt: redactForScoring(action.prompt || ""),
      redactionStatus: "redacted_before_scoring",
    },
  };
}

/** Stable action order for reloads; the scorer never consults a live source. */
export function scoreAndRankActionOutcomes(actions = []) {
  return (Array.isArray(actions) ? actions : [])
    .map(scoreActionOutcome)
    .sort((left, right) => {
      const leftRank = left.priorityRank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.priorityRank ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.actionId.localeCompare(right.actionId);
    });
}
