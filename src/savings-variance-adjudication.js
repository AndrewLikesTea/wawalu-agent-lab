import { redactForScoring } from "./evolution.js";
import { validateSavingsAction } from "./savings-portfolio.js";

/**
 * Deterministic adjudication of one Rowan savings-portfolio/1.1.0 action.
 *
 * Assumptions, not calibrated probabilities:
 * - 5% of projection represents ordinary annualization/measurement noise.
 * - A $100 floor prevents whole-dollar aggregation noise dominating small plans.
 * - 0.75 is the minimum authored support for resolving an executive claim. It
 *   means three quarters of the declared support, not a 75% chance of truth.
 * - 0.85 separates "high" from "moderate" confidence so high requires a clear
 *   ten-point margin over the resolution gate.
 * - Lifecycle and evidence are gates, not weights: averaging them would create
 *   an opaque score. Only verified records with evidence can resolve variance.
 */
export const SAVINGS_VARIANCE_POLICY = Object.freeze({
  version: "savings-variance-adjudication/1.0.0",
  reconciliationSchema: "savings-portfolio/1.1.0",
  relativeTolerance: 0.05,
  absoluteToleranceUsd: 100,
  minimumResolvableConfidence: 0.75,
  highConfidenceThreshold: 0.85,
});

const REASONS = Object.freeze({
  verified_delivery: ({ varianceUsd, toleranceUsd }) =>
    `Verified savings are ${Math.abs(varianceUsd)} USD ${varianceUsd < 0 ? "below" : "at or above"}`
    + ` projection; the ${toleranceUsd} USD measurement tolerance is not exceeded.`,
  material_shortfall: ({ varianceUsd, toleranceUsd }) =>
    `Verified savings are ${Math.abs(varianceUsd)} USD below projection, exceeding the`
    + ` ${toleranceUsd} USD measurement tolerance.`,
  ambiguous_unverified: () =>
    "A completed measurement exists, but verification evidence has not reconciled it for an executive claim.",
  ambiguous_confidence: ({ confidence }) =>
    `Verification exists, but declared confidence ${confidence.toFixed(2)} is below the 0.75 resolution gate.`,
  unavailable_measurement: () =>
    "No completed measurement is available; missing savings are not treated as zero.",
});

function safeReference(value) {
  return redactForScoring(String(value ?? "")).slice(0, 160);
}

function confidenceLevel(status, confidence) {
  if (status === "unavailable_measurement") return "unavailable";
  if (status === "ambiguous_variance") return "limited";
  return confidence >= SAVINGS_VARIANCE_POLICY.highConfidenceThreshold ? "high" : "moderate";
}

function toleranceFor(projectedSavingsUsd) {
  if (projectedSavingsUsd === 0) return 0;
  return Math.max(
    SAVINGS_VARIANCE_POLICY.absoluteToleranceUsd,
    Math.round(projectedSavingsUsd * SAVINGS_VARIANCE_POLICY.relativeTolerance),
  );
}

/**
 * Returns a whitelist-only review surface. Narrative fields (title, owner,
 * department name, evidence descriptions, and any prompt-like extras) never
 * cross the adjudication boundary. Identifiers are redacted before output.
 */
export function adjudicateSavingsVariance(reconciliationInput) {
  const action = validateSavingsAction(reconciliationInput);
  const toleranceUsd = toleranceFor(action.projectedSavingsUsd);
  const measuredSavingsUsd = action.completedSavingsUsd;
  const verifiedSavingsUsd = action.verifiedSavingsUsd;
  const hasResolvableConfidence =
    action.confidence >= SAVINGS_VARIANCE_POLICY.minimumResolvableConfidence;

  let status;
  let reasonKey;
  if (measuredSavingsUsd === null) {
    status = "unavailable_measurement";
    reasonKey = "unavailable_measurement";
  } else if (action.lifecycleState !== "verified") {
    status = "ambiguous_variance";
    reasonKey = "ambiguous_unverified";
  } else if (!hasResolvableConfidence) {
    status = "ambiguous_variance";
    reasonKey = "ambiguous_confidence";
  } else {
    const shortfallUsd = action.projectedSavingsUsd - verifiedSavingsUsd;
    status = shortfallUsd > toleranceUsd ? "material_shortfall" : "verified_delivery";
    reasonKey = status;
  }

  const adjudicatedSavingsUsd = action.lifecycleState === "verified"
    ? verifiedSavingsUsd : measuredSavingsUsd;
  const varianceUsd = adjudicatedSavingsUsd === null
    ? null : adjudicatedSavingsUsd - action.projectedSavingsUsd;
  const context = { varianceUsd, toleranceUsd, confidence: action.confidence };

  return Object.freeze({
    schemaVersion: SAVINGS_VARIANCE_POLICY.version,
    status,
    confidenceLevel: confidenceLevel(status, action.confidence),
    varianceReason: REASONS[reasonKey](context),
    projectedSavingsUsd: action.projectedSavingsUsd,
    adjudicatedSavingsUsd,
    varianceUsd,
    toleranceUsd,
    reviewProvenance: Object.freeze({
      reconciliationSchema: SAVINGS_VARIANCE_POLICY.reconciliationSchema,
      sourceActionId: safeReference(action.actionId),
      lifecycleState: action.lifecycleState,
      updatedDate: action.updatedDate,
      verificationEvidenceRefs: Object.freeze(
        action.verificationEvidence.map(({ evidenceId }) => safeReference(evidenceId)),
      ),
      policyVersion: SAVINGS_VARIANCE_POLICY.version,
    }),
  });
}

