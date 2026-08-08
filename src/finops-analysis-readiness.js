// Static decision model for “Can I get a trustworthy savings recommendation now?”
// It reads only the bundled provider-export-shaped scenario passed by the page.
//
// IT RANKS NOTHING. #1020 closed a defect where several regions each answered
// “what do I do first?” with a ranking rule of their own, over the same table,
// and named different departments and different money. So the one action quoted
// here is the `finops-bundled-next-step/1.0.0` record the page already derives
// and already paints; this module looks up that action's own fixture row by id
// for its confidence and its reason, and adds no ordering of its own.
//
// What IS derived here is readiness: which required evidence categories the
// passed dataset actually carries, what those can support, and what a later
// category would upgrade. Every one of those is a function of the dataset —
// nothing about the evidence held is authored as a constant, because a
// readiness benchmark that answers the same way for a dataset it never read is
// not a benchmark.
import { bundledFirstAction } from "./finops-bundled-next-step.js";

export const READINESS_MODEL_VERSION = "finops-analysis-readiness/2.0.0";

// `reliability` is the quality of the evidence that stands in for the category
// when it is held: full aggregates 1.00, a sampled scoring 0.75, an effective
// blended rate implied by billed spend 0.25 (it cannot show rate mix or
// committed-use discounts), a realized post-change measurement 1.00. A category
// the dataset does not carry contributes nothing, and only evidence at or above
// SUFFICIENT_RELIABILITY can carry an organization-specific claim.
export const SUFFICIENT_RELIABILITY = 0.75;
export const EVIDENCE_CATEGORIES = Object.freeze([
  Object.freeze({
    id: "usage_cost", weight: 35, reliability: 1,
    label: "Per-department usage and cost aggregates",
    reduces: "uncertainty about where the spend sits",
    enables: "a ranked recoverable line per department",
    held: (data) => rows(data?.departments).some((row) => Number.isFinite(row?.spendUsd)),
  }),
  Object.freeze({
    id: "workload_classification", weight: 30, reliability: 0.75,
    label: "Scored workload classifications",
    reduces: "uncertainty about which spend is recoverable at all",
    enables: "an out-of-scope share behind a recoverable estimate",
    held: (data) => rows(data?.evidence).some((row) => filled(row?.category)),
  }),
  Object.freeze({
    id: "applicable_pricing", weight: 20, reliability: 0.25,
    label: "Organization-applicable contracted pricing",
    reduces: "uncertainty that list-price deltas match the rates actually paid",
    enables: "a savings estimate priced at the organization's declared commercial terms",
    held: (data) => rows(data?.departments)
      .some((row) => Number.isFinite(row?.spendUsd) && row?.queries > 0),
  }),
  Object.freeze({
    id: "observed_validation", weight: 15, reliability: 1,
    label: "Observed post-change usage and cost",
    reduces: "uncertainty that routing causes the modelled reduction without offsetting usage",
    enables: "a verified realized-savings conclusion for the observed period",
    held: (data) => rows(data?.actionPlan?.actions)
      .some((row) => Number.isFinite(row?.observed?.realizedSavingsUsd)),
  }),
]);

export const READINESS_RULE = "100 × sufficient categories ÷ total required categories,"
  + " rounded half up. A category is sufficient when the dataset carries it and its evidence"
  + " reliability is at least 0.75.";
export const CONFIDENCE_RULE = "Round half up the sum, over the categories the dataset carries,"
  + " of each category's integer weight multiplied by its evidence reliability: usage/cost 1.00,"
  + " classification 0.75, applicable pricing 0.25, observed validation 1.00. A category the"
  + " dataset does not carry contributes 0. Weights sum to 100.";

const rows = (value) => (Array.isArray(value) ? value : []);
const roundHalfUp = (value) => Math.floor(value + 0.5);
const filled = (value) => typeof value === "string" && value.trim().length > 0;

/** Evaluate every required category against `dataset`. Pure, order-preserving. */
export function evidenceHeld(dataset, categories = EVIDENCE_CATEGORIES) {
  return Object.freeze(categories.map((category) => {
    const present = category.held(dataset) === true;
    return Object.freeze({
      id: category.id, label: category.label, weight: category.weight,
      reliability: category.reliability, reduces: category.reduces, enables: category.enables,
      present, sufficient: present && category.reliability >= SUFFICIENT_RELIABILITY,
    });
  }));
}

export function readinessScore(held) {
  const sufficient = held.filter((item) => item.sufficient).length;
  return Object.freeze({
    value: held.length ? roundHalfUp(100 * sufficient / held.length) : 0,
    numerator: sufficient, denominator: held.length, rule: READINESS_RULE,
  });
}

export function evidenceConfidence(held) {
  return Object.freeze({
    value: roundHalfUp(held.reduce(
      (sum, item) => sum + (item.present ? item.weight * item.reliability : 0), 0)),
    rule: CONFIDENCE_RULE,
  });
}

export function analysisReadiness(dataset) {
  const held = evidenceHeld(dataset);
  const score = readinessScore(held);
  const confidence = evidenceConfidence(held);
  // The page's one derived action, not a second ranking of the same table.
  const step = bundledFirstAction(dataset);
  const source = rows(dataset?.actionPlan?.actions)
    .find((row) => row?.actionId === step?.actionId);
  const level = score.value === 100 ? "ready"
    : score.value >= 50 ? "illustrative_only" : "insufficient";
  const sufficient = held.filter((item) => item.sufficient);
  return Object.freeze({
    version: READINESS_MODEL_VERSION, level, score, confidence, categories: held,
    currentEvidence: `${score.numerator} of ${score.denominator} required categories are`
      + ` sufficient: ${sufficient.map((item) => item.label).join("; ") || "none"}.`
      + " These are invented provider-export-shaped scenarios, not your data.",
    // A verdict is about the evidence AND about having something to recommend:
    // "yes, an illustrative recommendation" beside "no action" is not an answer.
    supportedConclusion: !step
      ? "No savings recommendation is supported: the bundled scenario yielded no action."
      : level === "ready" ? "Yes, the evidence supports an organization-specific recommendation."
        : level === "illustrative_only"
          ? "Yes for an illustrative scenario recommendation; no for an organization-specific"
            + " savings commitment."
          : "No savings recommendation is supported.",
    limitation: "The figure is a modelled recoverable line in a fixture period, not a realized"
      + " saving and not evidence about your organization.",
    recommendation: step ? Object.freeze({
      id: step.actionId, action: step.action, department: step.department,
      figure: step.figure, reason: step.rationale,
      confidence: Number.isFinite(source?.confidence?.value)
        ? roundHalfUp(source.confidence.value * 100) : null,
      provenance: `${dataset?.provenance?.label ?? "Bundled synthetic fixture"}; action`
        + ` ${step.actionId}; the same ${step.contract} record the rest of this page reads.`,
    }) : null,
    // Derived from the categories that fell short, so the upgrades on offer can
    // never disagree with the benchmark that says why they are needed.
    upgrades: Object.freeze(held.filter((item) => !item.sufficient).map((item) => Object.freeze({
      category: item.label, reduces: item.reduces, enables: item.enables,
    }))),
  });
}
