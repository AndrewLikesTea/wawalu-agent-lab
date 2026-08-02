// How complete the brief an imported export earned is, against the example's.
//
// WHAT THIS FIXES. The bundled example fills every slot on this page, so a
// reader who imports their own file has no way to answer the only question they
// actually have: "is what I am looking at as complete as the demo, and if not,
// what is missing and what do I do about it?" The page already says, slot by
// slot, when it fell back — the headline contract (#983) prints a fallback
// sentence per slot, the period series (#985) states when it has one month and
// not two, and the department evidence list says when nothing was ranked. What
// nobody could do was ADD THOSE UP and get one number, one tier, and one next
// step out of them.
//
// So this module is the scoring layer over those existing verdicts. It computes
// nothing about the export itself: the five headline slots are read off
// `importedHeadline`, the movement is the summary
// `finops-imported-period-series.js` already published, and the drill-down is
// the ranked-department list the evidence panel is painted from. A second
// derivation here would put a completeness score on screen that disagrees with
// the block it is scoring.
//
// EVERY NUMBER IS TRACEABLE, WHICH IS THE POINT. A director who disputes this
// score can walk it backwards without reading any of this code:
//
//     tier  <- total  <- per-slot weight  <- per-slot satisfied/fell-back
//
// The tier thresholds and the seven weights are named constants below, each one
// carrying the assumption that justifies it in a line beside it, and each slot's
// verdict carries the reason it earned. There is no magic number inside the
// scoring logic and no weight that is only implied by an ordering.
//
// WHAT IT NEVER DOES. No DOM, no storage, no clock, no request, no randomness:
// the same analysis scores byte-identically every time, which is what makes the
// reproducibility test in tests/finops-brief-completeness.test.js meaningful.
// Nothing read out of the reader's export reaches a log or a model prompt, and
// anything quoted into a reason goes through `quoteFromExport` first — collapsed,
// stripped of the characters markup is made of, and truncated — so a reason is a
// sentence about the file rather than a channel out of it.

import {
  IMPORTED_HEADLINE_SLOT_IDS, importedHeadline,
} from "./finops-imported-headline.js";
import { PERIOD_SERIES_VERSION, periodMovement } from "./finops-imported-period-series.js";

/** Bump when a weight, a threshold, a slot, or a reason changes meaning. */
export const BRIEF_COMPLETENESS_VERSION = "finops-brief-completeness/1.0.0";

/** The two slots this module scores beyond the five the headline contract owns. */
export const TREND_SLOT_ID = "trend_movement";
export const DRILL_DOWN_SLOT_ID = "drill_down";

/**
 * The declared slot order. It is the reading order of the page, and it is also
 * the tie-break for the prioritized next action — never object key order, which
 * is an implementation detail a reader cannot see or dispute.
 */
export const SLOT_ORDER = Object.freeze([
  "recoverable_spend", "peer_position", "top_department", "rank_1_action",
  "confidence_tier", TREND_SLOT_ID, DRILL_DOWN_SLOT_ID,
]);

/**
 * What each slot is worth, out of 100. Every line states the assumption; a
 * reader who disagrees with the score is meant to argue with one of these
 * sentences rather than with the arithmetic.
 */
export const SLOT_WEIGHTS = Object.freeze({
  /** The money figure IS the brief. Without it there is no sentence to quote. */
  recoverable_spend: 25,
  /** An amount nobody owns cannot be assigned, so the brief stops one step short of a decision. */
  top_department: 20,
  /** A brief that names no first move leaves the meeting without one. */
  rank_1_action: 15,
  /** "Is this new?" is the first question asked of any cost figure; one month cannot answer it. */
  [TREND_SLOT_ID]: 15,
  /** Context rather than the answer: a brief with no cohort placement is still actionable. */
  peer_position: 10,
  /** The rows justify the headline rather than replace it — a reader who disputes it opens them. */
  [DRILL_DOWN_SLOT_ID]: 10,
  /** It restates the four headline slots above it, so its absence removes no new fact. */
  confidence_tier: 5,
});

/** The scale the weights are stated on, derived rather than retyped. */
export const MAX_COMPLETENESS_TOTAL = SLOT_ORDER
  .reduce((sum, id) => sum + SLOT_WEIGHTS[id], 0);

/** The four tiers. None of them is a compliment, and none is rounded up to. */
export const COMPLETENESS_TIER = Object.freeze({
  complete: "complete", substantial: "substantial", partial: "partial", thin: "thin",
});

/**
 * Tier thresholds, in points on the same 100-point scale, highest first. A
 * total earns the first tier whose minimum it reaches.
 */
export const TIER_THRESHOLDS = Object.freeze([
  /** Earned, never awarded: "complete" means nothing fell back, so it is the whole scale. */
  Object.freeze({ tier: COMPLETENESS_TIER.complete, min: MAX_COMPLETENESS_TOTAL }),
  /** The figure, its owner and one action together clear 60, which is a brief a leader can act on. */
  Object.freeze({ tier: COMPLETENESS_TIER.substantial, min: 60 }),
  /** The headline figure survived but the context around it did not. */
  Object.freeze({ tier: COMPLETENESS_TIER.partial, min: 30 }),
  /** Below the money figure's own weight, nothing quotable was earned. */
  Object.freeze({ tier: COMPLETENESS_TIER.thin, min: 0 }),
]);

/** The next-action value for a brief with nothing missing. Never null, never "". */
export const NOTHING_MISSING = "nothing_missing";

/** Labels for the two slots the headline contract does not name. */
const SLOT_LABELS = Object.freeze({
  [TREND_SLOT_ID]: "Period-over-period movement",
  [DRILL_DOWN_SLOT_ID]: "Department drill-down rows",
});

/**
 * What a reader can do on THIS page to satisfy each slot. One sentence each,
 * written as an instruction rather than as an apology, and kept here beside the
 * weight so the highest-value gap and its remedy cannot drift apart.
 */
export const SLOT_INSTRUCTIONS = Object.freeze({
  recoverable_spend: "Import an export that covers at least one complete billing month — "
    + "a partial month is skipped rather than summed.",
  peer_position: "The cohort position needs one complete month carrying both a spend total "
    + "and a recoverable total; supply the recoverable classification and it is placed.",
  top_department: "Select your HRIS org export beside the provider export, or re-export with "
    + "the department column included, so recoverable spend can be grouped.",
  rank_1_action: "The first action is ranked off the department carrying the most recoverable "
    + "spend; supply the grouping above and it is ranked from your own rows.",
  confidence_tier: "The tier restates the four headline slots and is stated as soon as an "
    + "analysis is on screen.",
  [TREND_SLOT_ID]: "Import an export covering two or more calendar months — the movement is "
    + "computed from the months already inside one file, not from a second visit.",
  [DRILL_DOWN_SLOT_ID]: "Department evidence lists your own rows once provider aggregates join "
    + "active HRIS units; select the org export to make the join possible.",
});

/** The instruction when nothing is missing. A state, not the absence of one. */
export const NOTHING_MISSING_INSTRUCTION =
  "Every scored slot was earned from your own export. Nothing on this brief is a fallback.";

/**
 * How much of the reader's own text may appear inside a reason.
 *
 * Long enough to be recognisable, short enough that a reason stays a sentence.
 */
export const MAX_QUOTE_CHARS = 160;

/**
 * Quote something out of the imported export into a reason, safely.
 *
 * The page paints reasons with textContent, so this is not the only defence —
 * it is the one that travels. A reason is also a string a caller may put in a
 * verdict object, so whitespace is collapsed, the characters markup is made of
 * are removed rather than encoded, and the result is truncated. Nothing from an
 * export is trusted enough to be passed through whole.
 */
export function quoteFromExport(value) {
  const text = (typeof value === "string" ? value : String(value ?? ""))
    .replace(/\s+/g, " ").trim()
    .replace(/[<>&"'`]/g, "");
  return text.length > MAX_QUOTE_CHARS ? `${text.slice(0, MAX_QUOTE_CHARS - 1)}…` : text;
}

const list = (value) => (Array.isArray(value) ? value : []);

const filled = (value) => typeof value === "string" && value.trim() !== "";

/** One scored slot. `earned` is the weight or zero — never a partial credit. */
const verdict = (id, label, satisfied, reason) => Object.freeze({
  id,
  label,
  weight: SLOT_WEIGHTS[id],
  satisfied,
  earned: satisfied ? SLOT_WEIGHTS[id] : 0,
  reason,
});

/** The five headline slots, scored off the contract rather than re-derived. */
function headlineVerdicts(headline) {
  return IMPORTED_HEADLINE_SLOT_IDS.map((id) => {
    const slot = headline.slots.find((entry) => entry.id === id);
    if (!slot) {
      return verdict(id, id, false, "This slot is not present in the headline contract.");
    }
    return verdict(id, slot.label, slot.supported,
      slot.supported
        ? `Earned from your export: ${quoteFromExport(slot.value)}`
        : `Fell back to the headline contract's own sentence: ${quoteFromExport(slot.fallback)}`);
  });
}

/**
 * Movement, scored against the derivation that produced it.
 *
 * A summary that does not carry `PERIOD_SERIES_VERSION` did not come out of
 * `periodMovement`, so it is a placeholder rather than a comparison of real
 * imported periods, and it cannot satisfy this slot however complete it looks.
 */
function trendVerdict(summary) {
  const label = SLOT_LABELS[TREND_SLOT_ID];
  if (!summary || summary.version !== PERIOD_SERIES_VERSION) {
    return verdict(TREND_SLOT_ID, label, false,
      "Fell back to no comparison: no period series was derived for this analysis.");
  }
  if (summary.available) {
    return verdict(TREND_SLOT_ID, label, true,
      `Earned from your export: ${quoteFromExport(summary.latestPeriod)} against `
      + `${quoteFromExport(summary.priorPeriod)}, over ${summary.periodCount} imported periods.`);
  }
  if (summary.periodCount === 1) {
    return verdict(TREND_SLOT_ID, label, false,
      `Fell back to a single named period, ${quoteFromExport(summary.onlyPeriod)}: `
      + "one month cannot be compared against a prior one.");
  }
  return verdict(TREND_SLOT_ID, label, false,
    "Fell back to no comparison: no dated period was read from this export.");
}

/** The drill-down, scored on the same ranked list the evidence panel paints. */
function drillDownVerdict(analysis) {
  const label = SLOT_LABELS[DRILL_DOWN_SLOT_ID];
  const rows = list(analysis?.rankedDepartments).filter((entry) => filled(entry?.name));
  if (rows.length === 0) {
    return verdict(DRILL_DOWN_SLOT_ID, label, false,
      "Fell back to the empty-evidence sentence: no active unit matched a provider aggregate, "
      + "so there is no row to expand.");
  }
  return verdict(DRILL_DOWN_SLOT_ID, label, true,
    `Earned from your export: ${rows.length} ranked department row`
    + `${rows.length === 1 ? "" : "s"}, led by ${quoteFromExport(rows[0].name)}.`);
}

/** The first tier whose minimum the total reaches. The table is the rule. */
function tierFor(total) {
  return (TIER_THRESHOLDS.find((entry) => total >= entry.min) ?? TIER_THRESHOLDS.at(-1)).tier;
}

/**
 * The single highest-value unsatisfied slot, or the explicit nothing-missing one.
 *
 * Ties break on `SLOT_ORDER` — the declared reading order — so two slots of
 * equal weight always resolve the same way for the same analysis.
 */
function nextActionFor(slots) {
  const missing = slots.filter((slot) => !slot.satisfied);
  if (missing.length === 0) {
    return Object.freeze({
      slot: NOTHING_MISSING,
      label: "Nothing missing",
      weight: 0,
      nothingMissing: true,
      instruction: NOTHING_MISSING_INSTRUCTION,
    });
  }
  const chosen = missing.slice().sort((left, right) => (right.weight - left.weight)
    || (SLOT_ORDER.indexOf(left.id) - SLOT_ORDER.indexOf(right.id)))[0];
  return Object.freeze({
    slot: chosen.id,
    label: chosen.label,
    weight: chosen.weight,
    nothingMissing: false,
    instruction: SLOT_INSTRUCTIONS[chosen.id] ?? "",
  });
}

/**
 * Score one imported analysis for completeness against the example's brief.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`, or null when
 *   the reader is on the bundled example or has cleared an import.
 * @param movement the summary `periodMovement` published for this import — the
 *   page hands in the one it painted, so the score and the movement block on
 *   screen cannot disagree. Omitted, it is derived from the envelope's own
 *   periods through the same function.
 * @returns `{ version, available, tier, total, maxTotal, satisfiedCount,
 *   slotCount, slots, nextAction }`, in slot order, in every state including
 *   the one with no analysis at all.
 */
export function scoreBriefCompleteness(analysis = null, { movement = null } = {}) {
  const headline = importedHeadline(analysis ?? null);
  const summary = movement ?? periodMovement(analysis?.history?.periods ?? []);
  const slots = Object.freeze([
    ...headlineVerdicts(headline),
    trendVerdict(analysis === null ? null : summary),
    drillDownVerdict(analysis),
  ].sort((left, right) => SLOT_ORDER.indexOf(left.id) - SLOT_ORDER.indexOf(right.id)));
  const total = slots.reduce((sum, slot) => sum + slot.earned, 0);
  return Object.freeze({
    version: BRIEF_COMPLETENESS_VERSION,
    available: analysis !== null,
    tier: analysis === null ? null : tierFor(total),
    total,
    maxTotal: MAX_COMPLETENESS_TOTAL,
    satisfiedCount: slots.filter((slot) => slot.satisfied).length,
    slotCount: slots.length,
    slots,
    nextAction: nextActionFor(slots),
  });
}

/** The tier line, in the words the page prints. One sentence, no markup. */
export function completenessSentence(score) {
  if (!score?.available) {
    return "No export has been analyzed, so this brief has no completeness score.";
  }
  return `Brief completeness: ${score.tier} — ${score.total} of ${score.maxTotal} points, `
    + `${score.satisfiedCount} of ${score.slotCount} slots earned from your own export.`;
}

/** The prioritized next action, in the words the page prints. */
export function nextActionSentence(score) {
  const next = score?.nextAction;
  if (!next || next.nothingMissing) return `Nothing missing: ${NOTHING_MISSING_INSTRUCTION}`;
  return `Highest-value gap (${next.weight} points): ${next.label}. ${next.instruction}`;
}
