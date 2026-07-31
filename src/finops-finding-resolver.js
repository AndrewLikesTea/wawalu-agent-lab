// ONE strong finding, chosen explicitly, out of the four the page already computes.
//
// THE PROBLEM THIS SOLVES. Four modules on this page each answer a different
// question correctly — where the org ranks against its cohort, which department
// is furthest behind, how spend moved against the prior month, and whether last
// month's tracked action hit its number. The headline could only ever say one
// thing, so `finops-stand.js` said *the peer position*, always, and stapled the
// recoverable figure and the lagging team onto the end of the sentence. That is
// not a ranking: it is a hardcoded preference with two footnotes, and on a month
// where the tracked action missed by five figures the lead still read a quartile
// band first.
//
// So the choice is made here, as data, by a rule anyone can read.
//
// ---------------------------------------------------------------------------
// THE IMPACT BASIS
// ---------------------------------------------------------------------------
//
// Every finding's impact is expressed in ONE unit: US DOLLARS AT STAKE OVER THE
// ANALYZED WINDOW. A ranking across four signals needs one number line, and a
// signal whose natural unit is a quartile band or a percentage has to be put
// onto it explicitly rather than compared by adjective. Each conversion is
// declared at its builder below and each is arithmetic over figures the source
// signal already published:
//
//   * peer position       (value − cohort p25) × successful tasks — the spend
//                         above the cheapest quartile boundary of the cohort.
//   * team gap            gap value × the laggard's successful tasks — what the
//                         lagging department would not have spent at the
//                         leader's rate.
//   * trend movement      |change in USD| against the prior period.
//   * tracked action      |realized − projected| on last month's tracked action.
//
// None of these is a realized saving and none is claimed as one. They are the
// size of the thing the lead would be deciding about, which is the only property
// that makes four different findings comparable at all.
//
// ---------------------------------------------------------------------------
// THE WEIGHTING
// ---------------------------------------------------------------------------
//
//   score = dollars at stake × confidence weight   (high 1.0, medium 0.6, low 0.3)
//
// Confidence is a MULTIPLIER, not an addend. The question the ranking answers is
// "how much does this change what the lead should do this month", and a large
// number nobody can defend does not change what anyone should do — it changes
// what they argue about. A multiplier lets a well-evidenced $40k finding beat a
// synthetic-boundary $60k one (40,000 > 60,000 × 0.6) without ever letting
// confidence alone promote a trivial figure.
//
// ---------------------------------------------------------------------------
// WHAT THE CLAIM MAY ASSERT
// ---------------------------------------------------------------------------
//
// Not re-derived here. `finops-decision-interaction.js` publishes the reading
// spine and the figure bounds for this decision, and this module consumes both:
// every finding kind declares the spine step its claim occupies (see
// `SPINE_STEP`, checked against `DECISION_SPINE` by `UNDECLARED_SPINE_STEPS`),
// and every candidate's figures are put through `auditDecisionFigures` before it
// is allowed to be a finding at all. A figure the manifest calls impossible is
// dropped, not printed and not rounded into range.
//
// LOCALITY. Pure. No DOM, no fetch, no storage, no clock, no randomness. Every
// timestamp, period label, and identifier in an output came in on an input.

import { DECISION_SPINE, auditDecisionFigures } from "./finops-decision-interaction.js";
import {
  INTERNAL_GAP_STATUS, bandDistanceWords, internalGapHeadline,
} from "./internal-cost-gap.js";
import { COST_METRIC, displayCostPerSuccessfulTask } from "./peer-cost-position.js";

/** Bump when a rule, a weight, a tie-break key, or the returned shape changes. */
export const FINDING_RESOLVER_VERSION = "finops-finding-resolver/1.0.0";

/** Which signal produced a finding. These are `kind`, and they are stable. */
export const FINDING_KIND = Object.freeze({
  peerPosition: "peer-position",
  teamGap: "team-gap",
  trendMovement: "trend-movement",
  trackedActionResult: "tracked-action-result",
});

/**
 * The declared signal priority: the SECOND tie-break key, applied only when two
 * findings score identically.
 *
 * It is an ordering of questions by how directly the answer is the lead's own to
 * act on this month, not a ranking of the modules. The position places the whole
 * org and is the question the view exists to answer; the team gap names someone
 * to talk to; a tracked action's result is last month's decision closing out;
 * the trend is context for all three.
 */
export const SIGNAL_PRIORITY = Object.freeze([
  FINDING_KIND.peerPosition,
  FINDING_KIND.teamGap,
  FINDING_KIND.trackedActionResult,
  FINDING_KIND.trendMovement,
]);

const PRIORITY_RANK = Object.freeze(Object.fromEntries(
  SIGNAL_PRIORITY.map((kind, index) => [kind, index])));

/**
 * The spine step each kind's claim occupies, from the manifest's own vocabulary.
 *
 * A claim may assert what its step is specified to carry and nothing further — a
 * peer-position claim states a position, a team-gap claim names a department and
 * a distance. Neither may reach for the other's content, which is what stops the
 * headline from silently becoming four sentences again.
 */
export const SPINE_STEP = Object.freeze({
  [FINDING_KIND.peerPosition]: "peer",
  [FINDING_KIND.teamGap]: "internal",
  [FINDING_KIND.trackedActionResult]: "action",
  [FINDING_KIND.trendMovement]: "benchmark",
});

/** Empty, or this module declared a step the shipped spine does not have. */
export const UNDECLARED_SPINE_STEPS = Object.freeze(
  Object.values(SPINE_STEP).filter((step) => !DECISION_SPINE.includes(step)));

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/** The confidence scale, ascending. A finding carries one of these words. */
export const CONFIDENCE = Object.freeze(["low", "medium", "high"]);

/** The multiplier each step contributes to the score. See THE WEIGHTING above. */
export const CONFIDENCE_WEIGHT = Object.freeze({ high: 1, medium: 0.6, low: 0.3 });

/** One step down the scale, floored. `low` cannot be downgraded further. */
export function downgradeConfidence(level) {
  const index = CONFIDENCE.indexOf(level);
  return index <= 0 ? CONFIDENCE[0] : CONFIDENCE[index - 1];
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** What a finding's numbers rest on. Derived, never passed in. */
export const PROVENANCE_KIND = Object.freeze({
  importedExport: "imported-export",
  syntheticCohort: "synthetic-cohort",
  unknown: "unknown",
});

/**
 * The words that identify a provenance record, in the shapes the four signal
 * modules actually publish.
 *
 * The IMPORTED test runs first: a record that names a reader's own export is an
 * imported one even when it also names the cohort snapshot it was compared
 * against. Everything else that names published reference data, a bundled
 * fixture, or a cohort snapshot is synthetic — including the internal gap, whose
 * band boundaries come from the published cohorts even though its spend figures
 * came out of the envelope.
 */
const IMPORTED_MARKER = /imported export|own export|uploaded|user import|reader's file/i;
const SYNTHETIC_MARKER = /synthetic|bundled|fixture|published cohort|hand-authored|invented/i;

const PROVENANCE_TEXT_KEYS = Object.freeze(["label", "statement", "source", "sourceKind",
  "description"]);
const PROVENANCE_ID_KEYS = Object.freeze(["fixtureId", "actionId", "cohortId", "snapshotId",
  "scoringPolicy", "rubricVersion"]);

function provenanceText(provenance) {
  if (typeof provenance === "string") return provenance;
  if (!provenance || typeof provenance !== "object") return "";
  return PROVENANCE_TEXT_KEYS
    .map((key) => (typeof provenance[key] === "string" ? provenance[key] : ""))
    .join(" ");
}

function provenanceIdentifier(provenance) {
  if (typeof provenance === "string") return provenance.trim() || null;
  if (!provenance || typeof provenance !== "object") return null;
  for (const key of PROVENANCE_ID_KEYS) {
    const value = provenance[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Classify one signal's own provenance record.
 *
 * `unknown` is what a signal that publishes no provenance resolves to, and it is
 * treated as NOT imported by the downgrade rule below. That is deliberate and it
 * is the conservative direction: a claim whose trail cannot be followed is not a
 * claim backed by the reader's own file, and pretending otherwise is how a weak
 * number reaches a headline.
 */
export function classifyProvenance(provenance, { signal = null } = {}) {
  const text = provenanceText(provenance);
  let kind = PROVENANCE_KIND.unknown;
  if (IMPORTED_MARKER.test(text)) kind = PROVENANCE_KIND.importedExport;
  else if (SYNTHETIC_MARKER.test(text)) kind = PROVENANCE_KIND.syntheticCohort;
  else if (provenance && typeof provenance === "object"
    && (provenance.cohortId || provenance.snapshotId)) kind = PROVENANCE_KIND.syntheticCohort;
  return Object.freeze({
    signal,
    kind,
    /** The source's own word for what it is, when it published one. */
    sourceKind: typeof provenance === "object" && provenance
      ? (provenance.source ?? provenance.sourceKind ?? provenance.label ?? null) : null,
    identifier: provenanceIdentifier(provenance),
    statement: text.trim() || null,
    /** The record as the signal published it, so the trail does not stop here. */
    record: provenance ?? null,
  });
}

/** True when the downgrade applies: anything not traceable to a reader's export. */
function restsOnSynthetic(provenance) {
  return provenance.kind !== PROVENANCE_KIND.importedExport;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const money = (value) => Math.round(Number(value) * 100) / 100;
const finite = (value) => Number.isFinite(Number(value));

/**
 * The score of one finding, re-derivable from the finding alone.
 *
 * Deliberately not a field on the returned finding: a score is a function of the
 * impact and the confidence that are already there, and storing it would create
 * a second place for it to be wrong.
 */
export function scoreFinding(finding) {
  const value = Number(finding?.impact?.value);
  const weight = CONFIDENCE_WEIGHT[finding?.confidence];
  if (!Number.isFinite(value) || !Number.isFinite(weight)) return 0;
  return money(value * weight);
}

/**
 * The total order. Three keys, applied in this sequence, and the last of them is
 * total over distinct findings, so there is no input-order-dependent winner:
 *
 *   1. score, descending;
 *   2. declared signal priority (`SIGNAL_PRIORITY`), ascending;
 *   3. `id`, lexicographic ascending.
 */
export function compareFindings(left, right) {
  const byScore = scoreFinding(right) - scoreFinding(left);
  if (byScore !== 0) return byScore;
  const byPriority = (PRIORITY_RANK[left?.kind] ?? Number.MAX_SAFE_INTEGER)
    - (PRIORITY_RANK[right?.kind] ?? Number.MAX_SAFE_INTEGER);
  if (byPriority !== 0) return byPriority;
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

// ---------------------------------------------------------------------------
// Candidates. One builder per signal; each reads figures its source already
// published and computes nothing the source owns.
// ---------------------------------------------------------------------------

function finding({ kind, subject, claim, impactValue, impactBasis, baseConfidence, provenance,
  recommendedAction }) {
  const trail = classifyProvenance(provenance, { signal: kind });
  const confidence = restsOnSynthetic(trail)
    ? downgradeConfidence(baseConfidence) : baseConfidence;
  const impact = Object.freeze({
    value: money(impactValue),
    unit: "usd",
    basis: impactBasis,
  });
  // The manifest's own bounds decide whether these figures may be drawn at all.
  const notices = auditDecisionFigures({
    impactUsd: impact.value, confidence: CONFIDENCE_WEIGHT[confidence],
  });
  if (notices.length > 0) return null;
  return Object.freeze({
    id: `${kind}/${subject}`,
    kind,
    claim,
    impact,
    confidence,
    provenance: trail,
    recommendedAction,
  });
}

/** Where this org ranks, and what sitting above the cheapest quartile costs. */
function peerPositionFinding(position) {
  if (!position?.available) return null;
  const p25 = Number(position.cohort?.p25);
  const value = Number(position.value);
  const tasks = Number(position.successfulTasks);
  if (!finite(p25) || !finite(value) || !finite(tasks) || tasks <= 0) return null;
  const excess = Math.max(0, value - p25) * tasks;
  return finding({
    kind: FINDING_KIND.peerPosition,
    subject: position.cohort?.cohortId ?? "cohort",
    claim: `This organization is in the ${String(position.bandLabel).toLowerCase()} of `
      + `${position.cohort.label} at ${position.valueDisplay} per successful task.`,
    impactValue: excess,
    impactBasis: `${displayCostPerSuccessfulTask(Math.max(0, value - p25))} above the cohort's `
      + `${displayCostPerSuccessfulTask(p25)} lower quartile boundary, across `
      + `${tasks} successful tasks in the analyzed window.`,
    baseConfidence: "high",
    provenance: position.provenance,
    recommendedAction: `Take ${displayCostPerSuccessfulTask(p25)} per successful task — the `
      + `${position.cohort.label} lower quartile — to the next review as the target for `
      + `${COST_METRIC.label.toLowerCase()}.`,
  });
}

/** Which department is behind, and what closing the gap is worth. */
function teamGapFinding(gap) {
  if (gap?.status !== INTERNAL_GAP_STATUS.finding) return null;
  const headline = internalGapHeadline(gap);
  const spread = Number(gap.gapValue);
  const tasks = Number(gap.laggard?.successfulTasks);
  if (!headline || !finite(spread) || !finite(tasks) || tasks <= 0) return null;
  return finding({
    kind: FINDING_KIND.teamGap,
    subject: gap.laggard?.departmentId ?? "department",
    claim: `${headline}.`,
    impactValue: Math.max(0, spread) * tasks,
    impactBasis: `${displayCostPerSuccessfulTask(spread)} per successful task between `
      + `${gap.laggard.department} and ${gap.leader.department}, across `
      + `${tasks} successful tasks — ${bandDistanceWords(gap.gapBands)} on the shared rubric.`,
    baseConfidence: "high",
    provenance: gap.provenance,
    recommendedAction: `Bring ${gap.laggard.department} onto ${gap.leader.department}'s routing `
      + "before the next review.",
  });
}

/** How spend moved against the prior period, and by how much. */
function trendMovementFinding(movement) {
  if (!movement?.available) return null;
  const change = Number(movement.changeUsd);
  if (!finite(change) || change === 0) return null;
  const direction = change > 0 ? "rose" : "fell";
  const window = movement.reportingLabel ?? "the reporting month";
  return finding({
    kind: FINDING_KIND.trendMovement,
    subject: movement.reportingPeriod ?? "period",
    claim: `AI spend ${direction} in ${window}: ${movement.metric}.`,
    impactValue: Math.abs(change),
    impactBasis: `${movement.metric}, against `
      + `${movement.priorLabel ?? "the prior period"}.`,
    // The movement is measured, not modelled — but only a movement with a
    // percentage behind it has a prior total to divide by, and one without is a
    // change nobody can size.
    baseConfidence: movement.changePercent === null ? "medium" : "high",
    provenance: movement.provenance ?? null,
    recommendedAction: movement.action?.available
      ? movement.action.text
      : `Open the department evidence for ${window} before choosing an action.`,
  });
}

/** Whether last month's tracked action hit its number, and by how much it missed. */
function trackedActionFinding(outcome) {
  const variance = Number(outcome?.varianceUsd);
  if (!outcome || !finite(variance)) return null;
  if (!finite(outcome.realizedSavingsUsd) || !finite(outcome.projectedSavingsUsd)) return null;
  const met = outcome.comparisonCode === "successful";
  return finding({
    kind: FINDING_KIND.trackedActionResult,
    subject: outcome.actionId || "action",
    claim: `Last month's tracked action ${met ? "met" : "missed"} its target: `
      + `$${Math.round(outcome.realizedSavingsUsd)} realized against `
      + `$${Math.round(outcome.projectedSavingsUsd)} projected.`,
    impactValue: Math.abs(variance),
    impactBasis: `$${Math.abs(Math.round(variance))} between realized and projected savings on `
      + `${outcome.actionId || "the tracked action"}, at a `
      + `$${Math.round(outcome.toleranceUsd ?? 0)} tolerance.`,
    // The scorer's own gate: an outcome it declared low-confidence does not get
    // to arrive here as a confident one.
    baseConfidence: outcome.outcomeCode === "low_confidence" ? "low" : "high",
    provenance: outcome.provenance ?? null,
    recommendedAction: met
      ? `Close ${outcome.actionId || "the tracked action"} and commit the next one.`
      : `Re-scope ${outcome.actionId || "the tracked action"} before committing to it again.`,
  });
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

const NOTHING = Object.freeze({ winner: null, runnersUp: Object.freeze([]) });

/**
 * Resolve the one finding the headline states, and the order the rest would be
 * disclosed in.
 *
 * Total. Every argument is optional and every unusable signal is simply not a
 * candidate: partial evidence resolves over whatever is usable, and no evidence
 * at all resolves to `{ winner: null, runnersUp: [] }` rather than a fabricated
 * finding or a thrown exception. Nothing here recomputes a figure — each builder
 * reads what its source module already published.
 *
 * @param peerPosition a `resolveCostPosition` result, or null.
 * @param teamGap a `resolveInternalCostGap` result, or null.
 * @param trendMovement a `leadingFinding` result, or null.
 * @param trackedActionResult a `scoreActionOutcome` result, or null.
 */
export function resolveHeadlineFinding({
  peerPosition = null, teamGap = null, trendMovement = null, trackedActionResult = null,
} = {}) {
  const candidates = [
    peerPositionFinding(peerPosition),
    teamGapFinding(teamGap),
    trendMovementFinding(trendMovement),
    trackedActionFinding(trackedActionResult),
  ].filter(Boolean);
  if (candidates.length === 0) return NOTHING;
  const ranked = [...candidates].sort(compareFindings);
  return Object.freeze({
    winner: ranked[0],
    runnersUp: Object.freeze(ranked.slice(1)),
  });
}
