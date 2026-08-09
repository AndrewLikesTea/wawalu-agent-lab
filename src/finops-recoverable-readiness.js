// "What would make this number checkable?" — asked and answered ONCE (#1480).
//
// THE DEFECT THIS CLOSES. /evolution.html's recoverable figure carried two
// independent statements about how far it may be trusted. The rate-card ladder
// (src/finops-rate-card-contract.js) graded the PRICES and wrote "Illustrative"
// beside the money. Nothing graded the COVERAGE — whether the departments the
// figure is summed over are the departments the exported spend actually sits in
// — so a figure priced at contracted rates over half the spend could be marked
// "Declared" while the other half was unattributed or ungraded. Two axes, one
// word, and no rule saying which one the word meant.
//
// This module is the one place a tier is resolved. It takes the ladder's verdict
// as an INPUT SIGNAL, adds the coverage gate, and publishes exactly one tier,
// one marker word, one hedge and one next action. `rateCardMarker`,
// `rateCardHedge` and `rateCardNextStep` are imported here and by no other
// module in src/ — pinned by name in tests/finops-recoverable-readiness.test.js,
// which greps the whole of src/ rather than the one view — so a second tier word
// cannot reach the DOM: the view layer has no other function to call.
//
// WHAT THIS DOES NOT OWN. The pricing-provenance sub-score beside the figure
// (src/finops-pricing-provenance.js) answers a different question — WHOSE prices
// these are — on a disjoint vocabulary of Absent / Weak / Partial / Adequate /
// Strong out of 100. It states no tier and must not, which is asserted of the
// rendered region rather than assumed. Folding it into this tier would collapse
// two answers into one word; keeping it beside this tier is only safe while it
// stays wordless about trust, so that is the property under test.
//
// ---------------------------------------------------------------------------
// THE METRIC, stated so two engineers compute it identically
// ---------------------------------------------------------------------------
//
//   eligibleSharePct = 100 × (eligible spend ÷ exported spend)
//
// DENOMINATOR: `analysis.spendUsd` — the total the analysis publishes and the
// page quotes. Not a re-sum of the lines: a share whose denominator is derived
// from the same rows as its numerator can never notice a missing row.
//
// NUMERATOR: the sum of `spendUsd` over ranked department lines that are
// ELIGIBLE. A line is eligible when ALL of:
//
//   1. it carries positive spend;
//   2. it is attributed — its id is not the reserved unattributed unit;
//   3. it is scored — the literacy analysis is available AND carries an entry
//      whose `departmentId` equals this line's `id`;
//   4. it is priced — the line carries a down-routing evaluation, so its
//      recoverable figure came from the rate card rather than from nothing.
//
// Both sums are in whole US dollars and cents as the analysis publishes them.
// The share is rounded half-up to one decimal place FOR DISPLAY ONLY, and is
// CLAMPED BELOW 100 whenever any dollar is ineligible (see `SHARE_CEILING_PCT`),
// so `eligibleSharePct === 100` and `state === "complete"` are the same claim.
// That equivalence is the point of the clamp: a share that rounds up to 100 over
// a department nobody graded is the exact lie this module exists to prevent.
//
// ---------------------------------------------------------------------------
// THE TIER RULE
// ---------------------------------------------------------------------------
//
//   Insufficient   Coverage is known and incomplete. The figure does not
//                  describe the spend it is quoted against, so no statement
//                  about the PRICES it was computed at can raise it.
//   Illustrative   Coverage is complete (or not yet known) and the rate-card
//                  ladder is on its Illustrative rung.
//   Declared       Coverage is complete (or not yet known) and the ladder is on
//                  a Declared rung. The ladder's own label — Medium or High —
//                  is carried through unchanged.
//
// COVERAGE NOT YET KNOWN IS NOT COVERAGE FAILED. The page paints this region
// before any analysis exists, and a first paint that shouted "Insufficient" at a
// reader who has imported nothing would be reporting on a question nobody asked.
// With no analysis the contract publishes the ladder's rung verbatim and states
// `state: "unknown"`, which is what the served document is seeded with.
//
// ---------------------------------------------------------------------------
// WHAT `state: "complete"` MAY CLAIM
// ---------------------------------------------------------------------------
//
// `state`, `blockers` and `nextAction` are computed over the ranked lines, while
// the denominator is the analysis total. Those two agree in the shipped data —
// `analysis.spendUsd` is the rounded sum of the same lines — but "they agree
// today" is not a property, so RESIDUAL SPEND IS A BLOCKER OF ITS OWN. Anything
// the total carries that no line represents blocks `complete` outright, which
// makes the "every dollar" sentence unreachable on an unproven invariant. The
// invariant itself is asserted over the bundled example dataset in
// tests/finops-recoverable-readiness.test.js rather than assumed here, and an
// analysis whose rows do not sum to its total is run through this module there
// to show the sentence does not survive it.
//
// PURE. No DOM, no clock, no storage, no network, no locale-dependent sort. The
// one locale used is the fixed "en-US" currency format below, which is the one
// currency formatter in this contract — there is not a second one anywhere in
// this file, so two sentences quoting the same dollars cannot format them
// differently.

import { UNATTRIBUTED_KEY } from "./attribution-units.js";
import {
  BUNDLED_RATE_CARD_CONFIDENCE, rateCardHedge, rateCardMarker, rateCardNextStep,
} from "./finops-rate-card-contract.js";

/** Bump when a field, a rule, or what a tier means changes. Copy may be reworded. */
export const RECOVERABLE_READINESS_CONTRACT = "finops-recoverable-readiness/1.0.0";

/** What is known about coverage. `unknown` is "no analysis yet", not "failed". */
export const READINESS_STATE = Object.freeze({
  unknown: "unknown", empty: "empty", partial: "partial", complete: "complete",
});

/** The rung a figure lands on when the spend behind it is not fully represented. */
export const INSUFFICIENT_RUNG = Object.freeze({
  tier: "insufficient", marker: "Insufficient", label: "None",
});

/** Every word this page may use to say how far the figure may be trusted. */
export const TIER_WORDS = Object.freeze(["Insufficient", "Illustrative", "Declared"]);

/**
 * The highest share a partly-covered figure may DISPLAY. Rounding to one decimal
 * would print 100.0 for 99.96, and a reader who is told 100% has been told the
 * blockers below do not exist. So an incomplete figure stops here.
 */
export const SHARE_CEILING_PCT = 99.9;

/**
 * How close the lines must sum to the published total before the difference is
 * treated as representation rather than arithmetic. One cent: both sides are
 * published in cents, so the difference is rounded to cents before it is
 * compared — anything larger is a row this contract cannot see, and anything
 * smaller is the last binary digit of a decimal sum.
 */
export const RESIDUAL_EPSILON_USD = 0.01;

/**
 * The blockers, MOST CONSEQUENTIAL FIRST. `blockers` is ordered by this list and
 * `nextAction` is the first one's ask, so two readers agree on what to do first
 * when a figure trips several at once.
 *
 * The order is by how much of the answer the blocker withholds. Spend nobody can
 * name is worse than spend nobody graded, which is worse than spend nobody
 * priced; residual spend sits last because it is a defect in this contract's own
 * inputs rather than something a reader can go and fix.
 */
export const BLOCKER_ORDER = Object.freeze([
  "no-spend", "unattributed-spend", "unscored-departments", "unpriced-departments",
  "residual-spend",
]);

/** The one currency formatter in this contract. Whole dollars, en-US grouping. */
const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/** Money as a reader-facing string. Every sentence below goes through it. */
export const usd = (value) => USD.format(Math.round(Number(value) || 0));

/** "1 department" / "3 departments". Counted, never named: a name is a reader's data. */
const departments = (count) => `${count} department${count === 1 ? "" : "s"}`;

/**
 * What each blocker says and what it asks for. One sentence each, generated from
 * the counts and the withheld spend, so there is no second copy of the wording.
 */
export const BLOCKER_COPY = Object.freeze({
  "no-spend": () =>
    "This export carries no priced spend, so there is no denominator to recover against "
    + "and no figure to check.",
  "unattributed-spend": (blocker) =>
    `${usd(blocker.spendUsd)} of exported spend joined no active org unit, so no department `
    + "owns it. Map those provider records to a unit before this figure is quoted.",
  "unscored-departments": (blocker) =>
    `${departments(blocker.departments)} carrying ${usd(blocker.spendUsd)} have no graded query `
    + "sample, so nothing scores how that spend is being used. Import a query sample covering them.",
  "unpriced-departments": (blocker) =>
    `${departments(blocker.departments)} carrying ${usd(blocker.spendUsd)} were not priced against `
    + "a destination, so no part of that spend was tested for a cheaper route.",
  "residual-spend": (blocker) =>
    `${usd(blocker.spendUsd)} of the exported total is represented by no department line at all, `
    + "so this figure describes less spend than it is quoted against.",
});

/**
 * The one thing left to say when nothing is left to do. Reachable only when
 * coverage is complete AND the rate-card ladder is on its top rung, so every
 * clause in it has been checked rather than assumed.
 */
export const NEXT_ACTION_SENTENCE =
  "Nothing further. Every dollar of exported spend is priced from a declared rate and sits in "
  + "a department that carries a score.";

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(value) ? value : 0);
const cents = (value) => Math.round(value * 100) / 100;
const roundHalfUpTenth = (value) => Math.floor(value * 10 + 0.5) / 10;

/**
 * The page's analysis, read as this contract's signal set.
 *
 * It restates nothing and recomputes nothing: every value is carried through
 * from what `analyzeLocalFinops` already published and the regions above already
 * paint.
 *
 * THE JOIN IS NAMED HERE AND PINNED IN A TEST. Literacy entries are keyed on
 * `departmentId` and ranked lines on `id`. Those are two key spaces that happen
 * to agree; if they ever stop agreeing, every line reads unscored and the metric
 * collapses silently to zero, which looks exactly like a real coverage failure.
 * tests/finops-recoverable-readiness.test.js asserts, against the real dataset,
 * that a department the literacy record grades reads `scored === true` and a
 * department it does not grade reads `scored === false`, so a divergence fails
 * loudly instead.
 */
export function finopsReadinessSignals(analysis) {
  if (!isRecord(analysis)) return null;
  const literacy = analysis.literacy;
  const scored = new Set(literacy?.available === true
    ? list(literacy.departments).map((entry) => entry?.departmentId).filter(Boolean) : []);
  return {
    verdict: analysis.modelRouting?.rateCardConfidence ?? BUNDLED_RATE_CARD_CONFIDENCE,
    totalSpendUsd: money(analysis.spendUsd),
    lines: list(analysis.rankedDepartments).map((line) => ({
      id: line?.id ?? null,
      spendUsd: money(line?.spendUsd),
      attributed: line?.id !== UNATTRIBUTED_KEY,
      scored: scored.has(line?.id),
      priced: isRecord(line?.downRouting),
    })),
  };
}

/** One blocker record, with its published order, its counts and its sentence. */
function blockerFor(code, spendUsd, count) {
  const blocker = {
    code,
    order: BLOCKER_ORDER.indexOf(code),
    spendUsd: cents(spendUsd),
    departments: count,
  };
  return Object.freeze({ ...blocker, sentence: BLOCKER_COPY[code](blocker) });
}

/** The rung the ladder graded, normalised. An absent verdict is the bundled one. */
const rungOf = (verdict) => Object.freeze({
  tier: verdict?.tier ?? BUNDLED_RATE_CARD_CONFIDENCE.tier,
  marker: rateCardMarker(verdict),
  label: verdict?.label ?? BUNDLED_RATE_CARD_CONFIDENCE.label,
});

/**
 * Resolve the ONE readiness tier for the recoverable figure.
 *
 * @param signals `{ verdict, totalSpendUsd, lines }` — see `finopsReadinessSignals`.
 *   Anything that is not a record, or that carries no `lines` array, is coverage
 *   NOT YET KNOWN: the ladder's rung is published verbatim and `state` is
 *   `"unknown"`. That is the shipped first-paint path.
 * @returns a frozen `finops-recoverable-readiness/1.0.0` record. Always a record.
 */
export function resolveRecoverableReadiness(signals) {
  const input = isRecord(signals) ? signals : {};
  const verdict = input.verdict ?? BUNDLED_RATE_CARD_CONFIDENCE;
  const rung = rungOf(verdict);
  const publish = (state, tier, blockers, share, eligibleSpendUsd, totalSpendUsd) => {
    const nextAction = blockers.length > 0 ? blockers[0].sentence
      : (state === READINESS_STATE.complete && rung.label === "High"
        ? NEXT_ACTION_SENTENCE : rateCardNextStep(verdict));
    return Object.freeze({
      contract: RECOVERABLE_READINESS_CONTRACT,
      state,
      tier: tier.tier,
      marker: tier.marker,
      label: tier.label,
      eligibleSharePct: share,
      eligibleSpendUsd,
      totalSpendUsd,
      blockers: Object.freeze(blockers),
      nextAction,
      hedge: tier === INSUFFICIENT_RUNG
        ? `A ceiling over ${share}% of exported spend: the rest is unnamed, ungraded or unpriced.`
        : rateCardHedge(verdict),
      rateCardTier: rung.tier,
      rateCardLabel: rung.label,
    });
  };

  if (!Array.isArray(input.lines)) {
    return publish(READINESS_STATE.unknown, rung, [], null, null, null);
  }

  const total = money(input.totalSpendUsd);
  if (total <= 0) {
    return publish(READINESS_STATE.empty, INSUFFICIENT_RUNG,
      [blockerFor("no-spend", 0, 0)], 0, 0, total);
  }

  const lines = input.lines.filter((line) => isRecord(line) && money(line.spendUsd) > 0);
  const summed = lines.reduce((sum, line) => sum + money(line.spendUsd), 0);
  // The three coverage gates, evaluated over the same lines so a line that fails
  // two of them is counted once against each and never twice against the share.
  const gates = [
    { code: "unattributed-spend", failed: lines.filter((line) => line.attributed !== true) },
    { code: "unscored-departments", failed: lines.filter((line) => line.scored !== true) },
    { code: "unpriced-departments", failed: lines.filter((line) => line.priced !== true) },
  ];
  const eligible = lines.filter((line) =>
    line.attributed === true && line.scored === true && line.priced === true);
  const eligibleSpend = eligible.reduce((sum, line) => sum + money(line.spendUsd), 0);
  // Rounded to cents before it is compared: both sides are published in cents,
  // so a difference smaller than one is the binary tail of a decimal sum.
  const residual = cents(total - summed);

  const blockers = gates
    .filter((gate) => gate.failed.length > 0)
    .map((gate) => blockerFor(gate.code,
      gate.failed.reduce((sum, line) => sum + money(line.spendUsd), 0), gate.failed.length));
  if (Math.abs(residual) > RESIDUAL_EPSILON_USD) {
    blockers.push(blockerFor("residual-spend", Math.abs(residual), 0));
  }
  blockers.sort((left, right) => left.order - right.order);

  const complete = blockers.length === 0;
  // Clamped, not merely rounded: see SHARE_CEILING_PCT. An incomplete figure
  // never prints 100, so `eligibleSharePct === 100` is `state === "complete"`.
  const share = complete ? 100
    : Math.min(SHARE_CEILING_PCT, roundHalfUpTenth((eligibleSpend * 100) / total));
  return publish(complete ? READINESS_STATE.complete : READINESS_STATE.partial,
    complete ? rung : INSUFFICIENT_RUNG, Object.freeze(blockers), share,
    cents(eligibleSpend), cents(total));
}

/**
 * The readiness sentence, for the slot inside the disclosure the region already
 * ships. States the tier word this contract resolved, the share it resolved it
 * from, and HOW MANY asks are outstanding — a count, not a wall of alerts. The
 * one that matters is published separately as `nextAction`, which is the first
 * blocker's own sentence; the rest of the `blockers` records are available to a
 * caller that wants them and are not painted by this page.
 */
export function readinessSentence(contract) {
  if (!isRecord(contract)) return "";
  if (contract.state === READINESS_STATE.unknown) {
    return `Readiness: ${contract.marker}. This grades the rate card only; coverage is graded `
      + "once an export of your own is analyzed.";
  }
  const outstanding = contract.blockers.length;
  return `Readiness: ${contract.marker}. ${contract.eligibleSharePct}% of exported spend is named, `
    + `graded and priced; ${outstanding === 0 ? "nothing is outstanding"
      : `${outstanding} thing${outstanding === 1 ? "" : "s"} outstanding`}.`;
}
