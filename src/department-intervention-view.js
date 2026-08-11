// The computed recommendation, expressed in the fields the drill-down already
// has.
//
// `evolution.html` ships one intervention surface — `#action-result` — with a
// fixed set of labelled slots: status, title, rationale, impact, confidence,
// owner, provenance, baseline, target, estimate, realized, diagnosis. Until now
// those slots were filled from a reviewed intervention baked into the fixture,
// and were left saying "Result unavailable" whenever the fixture had none.
//
// This module fills the same slots from `scoreDepartmentIntervention` instead.
// It adds no markup, no CSS and no new vocabulary: the same reader reads the
// same twelve labels, and a computed recommendation is distinguishable from a
// reviewed one by what the status, provenance and realized fields *say*, not by
// where they sit.
//
// It computes nothing. Every number here is read off the scorer's result; the
// only thing authored is copy. If a figure looks wrong, the argument is with
// `department-intervention-scoring.js`, and the provenance line says so by
// carrying the input digest that produced it.
//
// NO PROMPT TEXT REACHES THIS FILE. Its only input is the scorer's frozen
// result, which is built from allowlisted numbers, a charset-checked org label
// and module-owned copy — so there is no path from a prompt to a painted field.

import { formatUsd } from "./evolution.js";
import { INTERVENTION_OUTCOME, INTERVENTION_REDACTION_STATEMENT } from "./department-intervention-scoring.js";
import { departmentVerdictFromResult } from "./department-verdict.js";

/**
 * Who owns the action, per kind.
 *
 * Stated here rather than derived, because getting this wrong is worse than
 * leaving it blank: routing and policy are platform levers a team cannot pull,
 * and handing a director a coaching action they are not accountable for is how
 * a recommendation gets ignored.
 */
const ACCOUNTABLE_ROLE = Object.freeze({
  routing: "AI Platform product owner",
  access_policy: "AI Platform product owner",
  rewrite: "Team tech lead",
  training_gap: "Engineering manager for this department",
});

/**
 * The status word per outcome, and the `data-status` the section already styles.
 *
 * `planned` is reused deliberately: a computed recommendation is a proposal
 * nobody has reviewed yet, which is exactly what the existing planned treatment
 * means on this surface. No new state, no new stylesheet.
 */
const OUTCOME_PRESENTATION = Object.freeze({
  [INTERVENTION_OUTCOME.recommended]: Object.freeze({
    dataStatus: "planned", status: "Computed recommendation · not yet reviewed",
  }),
  [INTERVENTION_OUTCOME.ambiguous]: Object.freeze({
    dataStatus: "unavailable", status: "No single action prioritized",
  }),
  [INTERVENTION_OUTCOME.insufficientEvidence]: Object.freeze({
    dataStatus: "unavailable", status: "Evidence insufficient",
  }),
  [INTERVENTION_OUTCOME.hold]: Object.freeze({
    dataStatus: "unavailable", status: "Hold · no intervention warranted",
  }),
});

const NOT_CLAIMED = "No dollar value is claimed for this department.";

/** The provenance line, always ending in the redaction promise. */
function provenanceLine(result) {
  const provenance = result.provenance;
  return `Computed by ${provenance.scorerVersion} · ${provenance.rubricVersion} · `
    + `${provenance.sampledQueries.toLocaleString("en-US")} scored prompts · `
    + `basis: ${provenance.basis} · input digest ${provenance.inputDigest} · `
    + INTERVENTION_REDACTION_STATEMENT;
}

/**
 * Map a scorer result onto the twelve fields `#action-result` paints.
 *
 * The title and the confidence are NOT composed here. They are the verdict and
 * the confidence a department screen shows for the same department and period,
 * so they come from `departmentVerdict` — the one function allowed to produce
 * them — and this file only decides where they sit.
 *
 * @param {object} result a frozen `scoreDepartmentIntervention` result.
 * @param {object} record the aggregate record it was scored from.
 * @returns {object} a frozen field bag, every value a string, plus `dataStatus`.
 */
export function interventionActionFields(result, record = {}) {
  const presentation = OUTCOME_PRESENTATION[result.outcome]
    ?? OUTCOME_PRESENTATION[INTERVENTION_OUTCOME.insufficientEvidence];
  const verdict = departmentVerdictFromResult(result, record);
  const recommendation = verdict.withheld ? null : result.recommendation;

  if (!recommendation) {
    const explanation = verdict.withheld ? verdict.confidenceDetail
      : result.reason?.text ?? "No intervention is recommended for this department.";
    return Object.freeze({
      dataStatus: verdict.withheld ? "unavailable" : presentation.dataStatus,
      status: presentation.status,
      title: verdict.verdict,
      rationale: explanation,
      impact: NOT_CLAIMED,
      // The candidates are still named. A reader who is told "we could not
      // separate these" and not told which ones has been given a shrug.
      confidence: verdict.confidenceDetail,
      owner: "Unassigned until an intervention is prioritized",
      provenance: provenanceLine(result),
      baseline: "Unavailable",
      target: "Unavailable",
      estimate: "Unavailable",
      realized: "Not simulated",
      diagnosis: explanation,
    });
  }

  const patternSpendUsd = Math.round(
    result.provenance.monthlySpendUsd * recommendation.rationale.shareOfScoredPrompts,
  );
  const estimate = recommendation.estimatedMonthlyValueUsd;
  return Object.freeze({
    dataStatus: presentation.dataStatus,
    status: presentation.status,
    title: verdict.verdict,
    rationale: recommendation.rationale.text,
    impact: `Recover about ${formatUsd(estimate)} of monthly AI spend`,
    confidence: verdict.confidenceDetail,
    owner: ACCOUNTABLE_ROLE[recommendation.kind] ?? "Unassigned",
    provenance: provenanceLine(result),
    // Baseline is the monthly spend sitting in the pattern; target is what is
    // left after the estimate lands. Stating both means the estimate can be
    // checked by subtraction rather than taken on trust.
    baseline: formatUsd(patternSpendUsd),
    target: formatUsd(Math.max(0, patternSpendUsd - estimate)),
    estimate: formatUsd(estimate),
    realized: "Not simulated — this is a computed recommendation, not a reviewed intervention.",
    diagnosis: `${recommendation.rationale.arithmetic}. ${recommendation.rationale.assumptions.join(" ")}`,
  });
}
