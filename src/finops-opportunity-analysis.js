// Portfolio ranking for the department intervention scorer. This module does
// not invent another score: it runs the shipped per-department scorer, removes
// idempotent repeats, and orders its publishable recommendations.
import {
  DEPARTMENT_INTERVENTION_VERSION, INTERVENTION_OUTCOME,
  scoreDepartmentIntervention,
} from "./department-intervention-scoring.js";

export const FINOPS_OPPORTUNITY_VERSION = "finops-opportunity-portfolio/1.0.0";

/**
 * Confidence caps translate the scorer's ordinal evidence finding into the
 * integer percent required by the commitment handoff. They are caps, not
 * probabilities and never change opportunity dollars.
 */
export const OPPORTUNITY_CONFIDENCE_CAPS = Object.freeze({
  high: Object.freeze({ percent: 90, assumption: "ASSUMPTION 90% cap: even complete, well-separated aggregate evidence is observational; 10 points are reserved for an unrun outcome test." }),
  medium: Object.freeze({ percent: 70, assumption: "ASSUMPTION 70% cap: one evidence factor is only medium, so at least 30 points remain for sampling, completeness, or separation uncertainty." }),
  low: Object.freeze({ percent: 40, assumption: "ASSUMPTION 40% cap: a publishable but weak factor may rank an opportunity, but must remain below the commitment contract's medium band." }),
});

const compareText = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};

/** Score a local, aggregate-only department portfolio. */
export function analyzeFinopsOpportunities(departments = []) {
  const scored = (Array.isArray(departments) ? departments : [])
    .map(scoreDepartmentIntervention);
  const accepted = new Map();
  const insufficientEvidence = [];
  const excluded = [];

  for (const result of scored) {
    const id = result.department.id;
    if (!id) {
      insufficientEvidence.push({ departmentId: null, code: "missing_department_id" });
      continue;
    }
    const prior = accepted.get(id);
    if (prior) {
      if (prior.provenance.inputDigest === result.provenance.inputDigest) {
        excluded.push({ departmentId: id, code: "duplicate_repeat" });
      } else {
        accepted.delete(id);
        insufficientEvidence.push({ departmentId: id, code: "conflicting_repeat" });
      }
      continue;
    }
    if (result.outcome !== INTERVENTION_OUTCOME.recommended) {
      insufficientEvidence.push({ departmentId: id, code: result.reason?.code ?? result.outcome });
      continue;
    }
    accepted.set(id, result);
  }

  const ranked = [...accepted.values()].map((result) => {
    const recommendation = result.recommendation;
    const cap = OPPORTUNITY_CONFIDENCE_CAPS[recommendation.confidence.level];
    return {
      opportunityId: result.department.id,
      departmentLabel: result.department.label,
      action: recommendation.kind,
      actionLabel: recommendation.title,
      amountUsd: recommendation.estimatedMonthlyValueUsd,
      confidence: { level: recommendation.confidence.level, percentCap: cap.percent,
        assumption: cap.assumption, factors: recommendation.confidence.factors },
      provenance: { scorerVersion: DEPARTMENT_INTERVENTION_VERSION,
        portfolioVersion: FINOPS_OPPORTUNITY_VERSION,
        inputDigest: result.provenance.inputDigest, basis: result.provenance.basis },
    };
  }).sort((a, b) => b.amountUsd - a.amountUsd
    || b.confidence.percentCap - a.confidence.percentCap
    || compareText(a.opportunityId, b.opportunityId)
    || compareText(a.action, b.action));

  return freeze({
    version: FINOPS_OPPORTUNITY_VERSION,
    ranked,
    portfolioTotalUsd: ranked.reduce((sum, item) => sum + item.amountUsd, 0),
    primaryRecommendation: ranked[0] ?? null,
    insufficientEvidence: insufficientEvidence.sort((a, b) => compareText(a.departmentId ?? "", b.departmentId ?? "")),
    excluded: excluded.sort((a, b) => compareText(a.departmentId, b.departmentId)),
  });
}

export function opportunityCommitmentHref(opportunity) {
  if (!opportunity) return "/savings-commitment.html";
  const query = new URLSearchParams({ opportunity: opportunity.opportunityId,
    action: opportunity.action });
  return `/savings-commitment.html?${query}`;
}
