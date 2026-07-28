// Did the decision we recorded save what it projected?
//
// WHAT THIS ANSWERS, AND WHAT IT DOES NOT DO
// ------------------------------------------
// `finops-commitment-decision.js` turns an approved commitment into one durable
// Shiplog decision; the record form links a release to it. That is the plan and
// the shipment. This module is the third beat: a reader standing on the recorded
// decision asks whether the thing that shipped actually saved the money the
// decision promised, and gets one comparison, one status, and one next step.
//
// It writes nothing. The decision and the release are read exactly as they were
// stored — including the `finopsCommitment` metadata block prior work already
// established — and no field of either is recomputed, amended, or re-derived.
// The arithmetic is not re-implemented either: `verifyCommitment` owns the
// projected-versus-realized rules, their boundaries, and their stated
// assumptions, and this module reads its result rather than a second opinion.
//
// WHAT THIS MODULE ADDS
// ---------------------
// Three things `verifyCommitment` cannot know, because it never sees a Shiplog
// record:
//
//   1. THE SHIPMENT. A decision with no linked release describes an intention,
//      not an action. A cost that fell in a month when nothing shipped is not
//      this decision's result, so the comparison is shown and the status is
//      held at inconclusive rather than claimed as verified.
//   2. THE ORDER OF EVENTS. A release recorded after the observed month ended
//      cannot have caused that month's spend, and that is reported as its own
//      inconclusive reason rather than folded into a verdict.
//   3. THE FOUR STATES A READER ACTS ON. The verification ladder has three
//      verdicts and nine refusals; a reader has four moves. `OUTCOME_STATUS`
//      is that projection, and `OUTCOME_STATUS_FROM_REASON` is the whole map.
//
// PURITY
// ------
// No DOM, no storage, no clock, no network. Every instant compared is one the
// caller passed in, so the same records produce the same outcome in a test and
// in a browser.

import { COMMITMENT_METADATA_FIELD } from "./finops-commitment-decision.js";
import {
  VERIFICATION_METRIC_RULES,
  VERIFICATION_STATUS,
  VERIFICATION_UNAVAILABLE_REASON,
  VERIFICATION_VERDICT,
  verifyCommitment,
} from "./commitment-verification.js";

export const DECISION_OUTCOME_VERSION = "shiplog-decision-outcome/1.0.0";

/** The one question this surface leads with, carried so a view cannot retitle it. */
export const DECISION_OUTCOME_QUESTION = "Did this decision save what it projected?";

/**
 * The four states a reader acts on differently.
 *
 * `unmatched` is deliberately not a kind of `inconclusive`: it means the later
 * import was read and does not describe this decision's department, route, or
 * month, which is a data problem with a data fix. `inconclusive` means the
 * evidence needed has not arrived yet.
 */
export const OUTCOME_STATUS = Object.freeze({
  verified: "verified",
  underperforming: "underperforming",
  inconclusive: "inconclusive",
  unmatched: "unmatched",
});

/**
 * The non-colour cue for each state: a short word, a glyph, and a shape token
 * the stylesheet keys its border treatment off. Colour is an addition to these,
 * never the carrier — the status word is in the accessible name of the region
 * and the glyph is decorative.
 */
export const OUTCOME_STATUS_CUE = Object.freeze({
  [OUTCOME_STATUS.verified]: Object.freeze({
    label: "Verified", glyph: "✓", shape: "solid",
  }),
  [OUTCOME_STATUS.underperforming]: Object.freeze({
    label: "Underperforming", glyph: "▼", shape: "double",
  }),
  [OUTCOME_STATUS.inconclusive]: Object.freeze({
    label: "Inconclusive", glyph: "…", shape: "dashed",
  }),
  [OUTCOME_STATUS.unmatched]: Object.freeze({
    label: "Unmatched", glyph: "≠", shape: "dotted",
  }),
});

/** Reasons this module raises itself, about the records rather than the import. */
export const OUTCOME_REASON = Object.freeze({
  noDecision: "no_decision",
  notACommitmentDecision: "not_a_commitment_decision",
  releaseNotRecorded: "release_not_recorded",
  releaseNotBeforeObservation: "release_not_before_observation",
});

/**
 * Every verification refusal, projected onto the four states. Exported as data
 * so a test can assert the map is total: a reason with no entry here would
 * otherwise fall through to a default and be shown as the wrong kind of state.
 */
export const OUTCOME_STATUS_FROM_REASON = Object.freeze({
  [VERIFICATION_UNAVAILABLE_REASON.noCommitment]: OUTCOME_STATUS.inconclusive,
  [VERIFICATION_UNAVAILABLE_REASON.commitmentNotVerifiable]: OUTCOME_STATUS.inconclusive,
  [VERIFICATION_UNAVAILABLE_REASON.attributionWithheld]: OUTCOME_STATUS.inconclusive,
  [VERIFICATION_UNAVAILABLE_REASON.noObservation]: OUTCOME_STATUS.inconclusive,
  [VERIFICATION_UNAVAILABLE_REASON.observationPeriodUnreadable]: OUTCOME_STATUS.unmatched,
  [VERIFICATION_UNAVAILABLE_REASON.observationPeriodNotPaired]: OUTCOME_STATUS.unmatched,
  [VERIFICATION_UNAVAILABLE_REASON.departmentNotObserved]: OUTCOME_STATUS.unmatched,
  [VERIFICATION_UNAVAILABLE_REASON.routeNotObserved]: OUTCOME_STATUS.unmatched,
  [VERIFICATION_UNAVAILABLE_REASON.ambiguousObservation]: OUTCOME_STATUS.unmatched,
  [OUTCOME_REASON.noDecision]: OUTCOME_STATUS.inconclusive,
  [OUTCOME_REASON.notACommitmentDecision]: OUTCOME_STATUS.inconclusive,
  [OUTCOME_REASON.releaseNotRecorded]: OUTCOME_STATUS.inconclusive,
  [OUTCOME_REASON.releaseNotBeforeObservation]: OUTCOME_STATUS.inconclusive,
});

/** The sentences this module owns. Verification's own refusals are quoted as-is. */
export const OUTCOME_REASON_STATEMENT = Object.freeze({
  [OUTCOME_REASON.noDecision]:
    "No decision is open, so there is no recorded commitment to measure.",
  [OUTCOME_REASON.notACommitmentDecision]:
    "This decision was not recorded from a FinOps commitment, so it carries no projected monthly "
    + "saving to measure a later month against.",
  [OUTCOME_REASON.releaseNotRecorded]:
    "No release links to this decision, so nothing is recorded as having shipped it. A cost that "
    + "moved without a shipment is not this decision's result, so no verdict is claimed from it.",
  [OUTCOME_REASON.releaseNotBeforeObservation]:
    "The release that links to this decision was recorded during or after the observed month, so "
    + "that month is not a full post-release period. Measure the first full month after the release.",
});

/** Confidence in the comparison, weakest first, so a downgrade is an index move. */
export const OUTCOME_CONFIDENCE_ORDER = Object.freeze(["low", "medium", "high"]);

/**
 * Each rule that can lower confidence, with what it is about. A rule lowers by
 * one rung and states why; the reasons are shown beside the confidence so it is
 * never a bare adjective.
 */
export const OUTCOME_CONFIDENCE_RULES = Object.freeze({
  commitmentBand:
    "Confidence starts at the band the commitment itself recorded, never above it.",
  notShipped:
    "No linked release, so the observed month is not attributable to this decision.",
  releaseTiming:
    "The linked release was recorded after the observed month, so the month predates the change.",
  noBaselineRecords:
    "The decision carries no baseline record ids, so the projected figure cannot be traced back.",
  exampleData:
    "The observed month is the bundled example dataset rather than your own imported spend.",
});

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
});
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

// A typographic minus, not the ASCII hyphen `en-US` emits: a saving that went
// backwards and a negative variance are read side by side, and one of them
// rendering as a hyphen at small sizes is the difference a reader misses.
const money = (minor) => USD.format(Math.round(minor) / 100).replace("-", "−");

/** "2026-07" as "July 2026". Ids stay canonical everywhere they are compared. */
export function outcomeMonthLabel(month) {
  return typeof month === "string" && PERIOD.test(month)
    ? MONTH.format(new Date(`${month}-01T00:00:00Z`))
    : "an unreadable month";
}

/* ------------------------- reading the stored records ---------------------- */

/**
 * The commitment `verifyCommitment` checks, rebuilt from the decision's own
 * stored metadata block.
 *
 * This is a projection, not a recomputation: every figure below is copied out of
 * the block the decision was written with. Nothing is re-derived from an import,
 * because a moved goalpost must not be able to pass as a met one.
 *
 * @returns the commitment shape, or null when this decision carries no block.
 */
export function commitmentFromDecision(decision) {
  const block = decision?.[COMMITMENT_METADATA_FIELD];
  if (!block || typeof block !== "object") return null;
  const { claim, confidence, provenance, recommendedAction: action } = block;
  if (!claim || !action) return null;
  return {
    commitmentId: block.commitmentId,
    department: { departmentId: action.departmentId },
    routing: {
      currentRoute: { modelId: action.fromModelId },
      proposedRoute: { modelId: action.toModelId },
    },
    baseline: { period: claim.period, monthlyCostMinor: claim.baselineMonthlyCostMinor },
    projected: { monthlyCostMinor: claim.projectedMonthlyCostMinor },
    projectedMonthlySavings: { amountMinor: claim.monthlySavingsMinor },
    confidence: { percent: confidence?.percent ?? null, band: confidence?.band ?? null },
    provenance: {
      recordIds: Array.isArray(provenance?.recordIds) ? [...provenance.recordIds] : [],
      sourceId: provenance?.sourceId ?? null,
      designation: provenance?.designation ?? null,
      importedAt: provenance?.importedAt ?? null,
      analysisPeriod: provenance?.analysisPeriod ?? null,
    },
  };
}

/**
 * The observation envelope for a refreshed briefing that has been read by
 * `readEvidenceFile`.
 *
 * A saved briefing's `results` projection carries no per-model routing detail,
 * so the later month's own commitment block is the only place its per-route
 * spend is stated — the same reading `savings-evidence.js` makes of a later
 * month. A briefing whose block is unavailable observes nothing here rather
 * than observing zero.
 */
export function observationFromBriefing(entry) {
  const block = entry?.commitment;
  if (!block || block.status !== "ok" || !block.commitment) return null;
  const { commitment } = block;
  return {
    period: entry.periodText,
    modelRouting: {
      ranked: [{
        unitId: commitment.department?.departmentId,
        candidates: [{
          model: commitment.routing?.currentRoute?.modelId,
          currentSpendUsd: commitment.baseline?.monthlyCostUsd,
        }],
        excludedModels: [],
      }],
      insufficientData: [],
    },
  };
}

/**
 * The release that shipped this decision: the earliest linked one.
 *
 * Earliest, not newest. A decision can be re-referenced by every later release
 * that touches the same area, and the month to measure is the one after the
 * change first went out, not after the most recent mention of it.
 */
export function shippingRelease(decision, releases = []) {
  const linked = (releases ?? []).filter((release) => Array.isArray(release?.decisionIds)
    && release.decisionIds.includes(decision?.id));
  if (linked.length === 0) return null;
  return [...linked].sort((left, right) =>
    String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))[0];
}

/** The calendar month an ISO instant falls in, or null. */
function instantMonth(instant) {
  const month = typeof instant === "string" ? instant.slice(0, 7) : "";
  return PERIOD.test(month) ? month : null;
}

/* ------------------------------ the comparison ----------------------------- */

// Exactly one comparison is material here: what the decision projected to save
// each month against what the observed month actually saved on the same route.
// Cost, spend share, attainment and variance are all derivable from it, and each
// one shown as a peer would be a second answer to the one question.
function comparison(verification) {
  const { projected, realized, variance } = verification;
  return {
    label: "Observed monthly saving against projected",
    projectedMinor: projected.monthlySavingsMinor,
    projectedText: money(projected.monthlySavingsMinor),
    observedMinor: realized.monthlySavingsMinor,
    observedText: money(realized.monthlySavingsMinor),
    varianceMinor: variance.amountMinor,
    varianceText: `${variance.amountMinor >= 0 ? "+" : "−"}${money(Math.abs(variance.amountMinor))}`,
    attainmentPercent: variance.attainmentPercent,
    attainmentText: `${variance.attainmentPercent}% of the projected saving`,
    direction: variance.amountMinor >= 0 ? "at_or_above" : "below",
    baselinePeriod: verification.baselinePeriod,
    observedPeriod: verification.observedPeriod,
  };
}

// The disclosure behind the headline figure: the two formulas verification
// computed, and the assumptions it stated for them. Quoted, never paraphrased —
// a surface that restates a rule in its own words is a second rule.
function calculation(verification) {
  return {
    steps: [
      {
        label: "Observed monthly saving",
        formula: verification.realized.formula,
        rule: VERIFICATION_METRIC_RULES.realizedSavings.rule,
        assumption: VERIFICATION_METRIC_RULES.realizedSavings.assumption,
      },
      {
        label: "Variance against the projection",
        formula: verification.variance.formula,
        rule: VERIFICATION_METRIC_RULES.variance.rule,
        assumption: VERIFICATION_METRIC_RULES.variance.assumption,
      },
      {
        label: "Where the verdict boundary falls",
        formula: verification.variance.verdictRule,
        rule: VERIFICATION_METRIC_RULES.tolerance.rule,
        assumption: VERIFICATION_METRIC_RULES.tolerance.assumption,
      },
    ],
    caveat: VERIFICATION_METRIC_RULES.realizedCost.assumption,
  };
}

// The second disclosure: the two months side by side, as costs rather than as
// savings, because that is the pair a finance reader reconciles against a bill.
function periodComparison(verification) {
  const { projected, realized } = verification;
  return {
    rows: [
      {
        period: verification.baselinePeriod,
        periodLabel: outcomeMonthLabel(verification.baselinePeriod),
        role: "Baseline month",
        costText: money(projected.baselineMonthlyCostMinor),
        note: "The month the commitment was priced in.",
      },
      {
        period: verification.observedPeriod,
        periodLabel: outcomeMonthLabel(verification.observedPeriod),
        role: "Observed month",
        costText: money(realized.monthlyCostMinor),
        note: `Spend on ${realized.routeModelId} in the same org unit.`,
      },
      {
        period: null,
        periodLabel: "Planned for the observed month",
        role: "Projection",
        costText: money(projected.monthlyCostMinor),
        note: "What the commitment said the month would cost.",
      },
    ],
  };
}

/* ------------------------------- the evidence ------------------------------ */

// Cited on screen, never summarised away: both sides of the comparison, plus
// every gap that makes the citation incomplete. An incomplete evidence set is a
// rendered state with named gaps, not a missing panel.
function evidenceSummary(verification, commitment, release, observationMeta) {
  const cited = verification?.status === VERIFICATION_STATUS.ok ? verification.evidence : [];
  const baselineIds = commitment?.provenance?.recordIds ?? [];
  const gaps = [];
  if (baselineIds.length === 0) {
    gaps.push("The decision carries no baseline record ids, so the projected figure cannot be "
      + "traced back to the rows it was computed from.");
  }
  if (!release) {
    gaps.push("No linked release names what shipped, so nothing connects the recorded decision to "
      + "a change in the observed month.");
  }
  if (observationMeta?.dataset === "example") {
    gaps.push("The observed month came from the bundled example dataset, so its figures describe "
      + "the example rather than your own spend.");
  }
  if (!observationMeta) {
    gaps.push("No later month has been opened, so only the decision's own side of the comparison "
      + "is cited.");
  }
  return {
    citations: cited.map((entry) => ({
      recordId: entry.recordId, side: entry.side, statement: entry.statement,
    })),
    baselineRecordCount: baselineIds.length,
    observedRecordCount: cited.filter((entry) => entry.side === "observed").length,
    complete: gaps.length === 0,
    gaps,
  };
}

/* ------------------------------ the confidence ----------------------------- */

function confidence(commitment, { release, releaseTooLate, observationMeta, evidence }) {
  const band = commitment?.confidence?.band;
  const start = OUTCOME_CONFIDENCE_ORDER.includes(band) ? band : "low";
  const reasons = [OUTCOME_CONFIDENCE_RULES.commitmentBand];
  let level = start;
  // Every rule lowers by exactly one rung and never raises: confidence in this
  // comparison cannot exceed the confidence the commitment itself recorded.
  const drop = (rule) => {
    level = OUTCOME_CONFIDENCE_ORDER[Math.max(0, OUTCOME_CONFIDENCE_ORDER.indexOf(level) - 1)];
    reasons.push(rule);
  };
  if (!release) drop(OUTCOME_CONFIDENCE_RULES.notShipped);
  if (releaseTooLate) drop(OUTCOME_CONFIDENCE_RULES.releaseTiming);
  if (evidence.baselineRecordCount === 0) drop(OUTCOME_CONFIDENCE_RULES.noBaselineRecords);
  if (observationMeta?.dataset === "example") drop(OUTCOME_CONFIDENCE_RULES.exampleData);
  return {
    level,
    label: `${level.charAt(0).toUpperCase()}${level.slice(1)} confidence`,
    statedPercent: commitment?.confidence?.percent ?? null,
    startedAt: start,
    reasons,
  };
}

/* ----------------------------- the one next step --------------------------- */

// One action, never a menu. Each entry names the thing to do, the reason it is
// the next thing rather than a later thing, and — where the product has one —
// the surface that does it.
const step = (label, rationale, href = null) => ({ label, rationale, href });
const UNAVAILABLE = VERIFICATION_UNAVAILABLE_REASON;

const NEXT_ACTION = Object.freeze({
  [OUTCOME_REASON.noDecision]: step("Open a recorded decision",
    "An outcome is measured against one recorded decision.", "/"),
  [OUTCOME_REASON.notACommitmentDecision]: step("Record a decision from a FinOps commitment",
    "Only a decision carrying a projected monthly saving can be measured against a later month.",
    "/savings-commitment.html"),
  [OUTCOME_REASON.releaseNotRecorded]: step("Record the release that shipped this decision",
    "Until a release links to it, a saving observed later cannot be attributed to this decision "
    + "rather than to everything else that changed.", "/releases.html"),
  [OUTCOME_REASON.releaseNotBeforeObservation]: step("Open the first full month after the release",
    "The month on screen is not wholly after the release, so its spend cannot be attributed to "
    + "the shipped change for the full period."),
  [UNAVAILABLE.noObservation]: step("Open the month after the baseline",
    "The comparison needs the first full month after the month this decision was priced in."),
  [UNAVAILABLE.attributionWithheld]: step("Improve the observed month's attribution",
    "Too little of that month's spend is attributed for a figure to be stated, and a verdict from "
    + "it would be a number the attribution policy already withheld.", "/evolution.html"),
  [UNAVAILABLE.commitmentNotVerifiable]: step("Re-record this decision from its commitment",
    "The stored metadata does not carry the baseline, route, and projected saving the comparison "
    + "needs.", "/savings-commitment.html"),
  [UNAVAILABLE.noCommitment]: step("Record a decision from a FinOps commitment",
    "There is no commitment here to check a later month against.", "/savings-commitment.html"),
  [UNAVAILABLE.observationPeriodNotPaired]: step("Open the month directly after the baseline",
    "The month that was opened is not the one this decision's baseline pairs with, so the "
    + "difference between them is not this decision's result."),
  [UNAVAILABLE.observationPeriodUnreadable]: step("Open a single calendar month",
    "A monthly commitment can only be checked against a monthly observation."),
  [UNAVAILABLE.departmentNotObserved]: step("Open a month that covers this org unit",
    "The month that was opened contains no org unit matching the one this decision names, so the "
    + "committed workload was not observed at all."),
  [UNAVAILABLE.routeNotObserved]: step("Open a month that reports this route",
    "The observed org unit reports no usage for the model this decision moves traffic away from, "
    + "and absence is not the same as zero."),
  [UNAVAILABLE.ambiguousObservation]: step("Disambiguate the identifiers in the observed month",
    "More than one org unit or model reduces to the identifier this decision names, so a figure "
    + "taken from either could be the wrong one."),
});

const VERDICT_ACTION = Object.freeze({
  [VERIFICATION_VERDICT.achieved]: step("Record the next month to confirm it held",
    "One paired month can be a holiday or a stalled job; a second month is what turns a result "
    + "into a trend.", "/savings-action-center.html"),
  [VERIFICATION_VERDICT.underRealized]: step("Review the route with the accountable owner",
    "The route did get cheaper, but by less than this decision promised, so the gap is the thing "
    + "to explain before the next commitment is priced."),
  [VERIFICATION_VERDICT.notRealized]: step("Check whether the change actually reached production",
    "The committed route cost at least as much as its own baseline, which is what a change that "
    + "never took effect looks like."),
});

/* --------------------------------- the model ------------------------------- */

/**
 * The outcome of one recorded decision.
 *
 * @param input.decision the stored decision, as `loadDecisions` returns it.
 * @param input.releases the visitor's releases, for the linked-release lookup.
 * @param input.observation a later month's envelope, from
 *   `observationFromBriefing` — or null when none has been opened.
 * @param input.observationMeta `{ month, dataset, savedOn, name }` describing the
 *   file the observation came from, for provenance and the evidence gaps.
 * @param input.attributionWithheld true when the attribution policy already
 *   suppressed that month's money figure.
 * @returns a frozen model. Total: it never throws, and every refusal is a state
 *   with a status, a statement, and one next action.
 */
export function decisionOutcome(input = {}) {
  const {
    decision = null, releases = [], observation = null,
    observationMeta = null, attributionWithheld = false,
  } = input;

  const commitment = commitmentFromDecision(decision);
  const release = decision ? shippingRelease(decision, releases) : null;
  const verification = commitment
    ? verifyCommitment(commitment, observation, { attributionWithheld })
    : null;
  const verified = verification?.status === VERIFICATION_STATUS.ok;

  // A monthly result is attributable only when the entire observed month is
  // after the linked release. Counting a same-month release would assign spend
  // from before the change shipped to its outcome, and the stored record does
  // not carry enough deployment timing detail to prorate that mixed period.
  const releaseMonth = instantMonth(release?.createdAt);
  const releaseTooLate = Boolean(verified && releaseMonth
    && releaseMonth >= verification.observedPeriod);

  // Precedence. The record-level refusals come first because their fix is
  // upstream of importing anything: telling a reader to open next month, when
  // nothing has shipped, is advice that cannot help them.
  let reason = null;
  if (!decision) reason = OUTCOME_REASON.noDecision;
  else if (!commitment) reason = OUTCOME_REASON.notACommitmentDecision;
  else if (!release) reason = OUTCOME_REASON.releaseNotRecorded;
  else if (!verified) reason = verification.reason;
  else if (releaseTooLate) reason = OUTCOME_REASON.releaseNotBeforeObservation;

  const status = reason
    ? OUTCOME_STATUS_FROM_REASON[reason] ?? OUTCOME_STATUS.inconclusive
    : verification.verdict === VERIFICATION_VERDICT.achieved
      ? OUTCOME_STATUS.verified
      : OUTCOME_STATUS.underperforming;

  const statement = reason
    ? OUTCOME_REASON_STATEMENT[reason] ?? verification?.statement ?? null
    : verification.verdictStatement;

  const evidence = evidenceSummary(verification, commitment, release, observationMeta);
  const action = reason ? NEXT_ACTION[reason] : VERDICT_ACTION[verification.verdict];

  return Object.freeze({
    schemaVersion: DECISION_OUTCOME_VERSION,
    question: DECISION_OUTCOME_QUESTION,
    status,
    cue: OUTCOME_STATUS_CUE[status],
    reason,
    statement,
    // The verification verdict is carried verbatim beside the projected status,
    // so a reader who knows the three-rung ladder can still see which rung this
    // landed on rather than only the four-state projection of it.
    verdict: verified ? verification.verdict : null,
    decision: decision
      ? {
        id: decision.id,
        title: decision.title,
        owner: decision.owner ?? null,
        status: decision.status ?? null,
        createdAt: decision.createdAt ?? null,
        commitmentId: commitment?.commitmentId ?? null,
      }
      : null,
    linkedRelease: release
      ? {
        id: release.id,
        version: release.version ?? null,
        title: release.title ?? release.version ?? null,
        owner: release.owner ?? null,
        createdAt: release.createdAt ?? null,
        month: releaseMonth,
        href: release.id ? `/release.html?id=${encodeURIComponent(release.id)}` : null,
      }
      : null,
    // Exactly one comparison, present only when there is one to make.
    comparison: verified ? comparison(verification) : null,
    calculation: verified ? calculation(verification) : null,
    periodComparison: verified ? periodComparison(verification) : null,
    confidence: commitment
      ? confidence(commitment, { release, releaseTooLate, observationMeta, evidence })
      : null,
    provenance: commitment
      ? {
        sourceId: commitment.provenance.sourceId,
        designation: commitment.provenance.designation,
        importedAt: commitment.provenance.importedAt,
        analysisPeriod: commitment.provenance.analysisPeriod,
        baselinePeriod: commitment.baseline.period,
        observedPeriod: verified ? verification.observedPeriod : observationMeta?.month ?? null,
        observedFrom: observationMeta?.name ?? null,
        observedDataset: observationMeta?.dataset ?? null,
        observedSavedOn: observationMeta?.savedOn ?? null,
      }
      : null,
    evidence,
    nextAction: action
      ? { label: action.label, rationale: action.rationale, href: action.href ?? null }
      : null,
  });
}
