// The routing slate: which model routing changes to ship this month, ranked, and
// what moving each one is worth. A lead reading "$51,254 is recoverable" still
// had to decide which change to raise first; this turns that diagnosis into a
// decidable list.
//
// IT DECIDES NOTHING NEW. Every dollar here is a figure `down-routing-candidates.js`
// already published on the analysis envelope. No estimation, no extrapolation, no
// new threshold. The only arithmetic performed is the one the reader is entitled
// to redo: the sum of the rows it renders.
//
// TWO SOURCES, ONE PRECEDENCE. `analysis.modelRouting.ranked[].candidates` is one
// rule per model, earned only when the import carried model identity, and it wins
// when it exists because naming the model is a sharper instruction. Otherwise
// `analysis.rankedDepartments[].downRouting` gives one rule per org unit from
// that unit's own observed blended price — what the bundled example earns, its
// export being JSON with no model field. No model name is ever fabricated.
//
// No filter, no sort control, no chart, no projection past the analysed period.
//
// LIFECYCLE. A ranked column of dollar figures cannot tell a reader which of them
// are still ideas, so every rule carries exactly one of three states — none of
// them invented here either:
//
//   proposed  a modelled ceiling and nothing else. THE DEFAULT, and what every
//             rule on the bundled example is.
//   shipped   a commitment retained in this browser names this rule's org unit.
//   scored    that unit ALSO publishes a measured period-over-period change on
//             this envelope, so the move has an observed outcome rather than a
//             model. The score is that change, truncated, and nothing else.
//
// A proposal therefore never carries a measured-looking number, which is the
// confusion the three states exist to remove.

import { classifyModelTier } from "./down-routing-candidates.js";

export const ROUTING_SLATE_VERSION = "routing-slate/1.0.0";

/** The question this surface exists to settle. Nothing else belongs in it. */
export const ROUTING_SLATE_QUESTION =
  "Which model routing changes should we ship this month?";

/**
 * The page's existing wording for the realized/modelled distinction, reused
 * rather than re-coined. It is authored in `executive-briefing-view.js` beside
 * the `scenario_not_realized_saving` limitation, and `tests/routing-slate.test.js`
 * reads that file to hold the two together: a second phrase for one distinction
 * is how a reader ends up believing the page measured what it modelled.
 */
export const MODELLED_BASIS_TAG = "Modelled potential, not realized savings";

/** The `data-basis` value the briefing already stamps on a modelled figure. */
export const MODELLED_BASIS = "modelled_potential";

/** Where one rule stands. Exactly one of these, always, on every rule. */
export const RULE_LIFECYCLE = Object.freeze({
  PROPOSED: "proposed", SHIPPED: "shipped", SCORED: "scored",
});

/** What the section as a whole is doing, for the one status line it publishes. */
export const ROUTING_SLATE_STATES = Object.freeze({
  READY: "ready", LOADING: "loading", UNAVAILABLE: "unavailable", ERROR: "error",
});

/**
 * The tie-break, in the one clause the surface prints. Rank must not depend on
 * the order rows arrived in, so the comparator below is total: after the
 * expected return, three declared string keys settle every remaining case.
 */
export const ROUTING_SLATE_TIE_BREAK =
  "Ranked by expected monthly return, highest first; equal returns break on source name, "
  + "then target tier, then org unit, each ascending in raw character order.";

/** Why the slate is empty, or unreadable, in the words a reader can act on. */
export const ROUTING_SLATE_REASONS = Object.freeze({
  no_analysis: "No analysis has been read yet, so there is no routing change to rank.",
  no_candidates: "The down-routing rule raised no candidate on these rows: nothing here is "
    + "priced above the premium-tier floor with a positive delta, so there is no routing "
    + "change to ship.",
  unreadable: "This analysis could not be read as a routing policy — the candidate lists on "
    + "it are not the shape the down-routing rule publishes, so no rule on it can be ranked. "
    + "Read the export again, or start from the bundled example.",
});

/** Said once, where the reader looks for the next move and there is not one. */
export const ROUTING_SLATE_NOTHING_LEFT =
  "Nothing is left to raise: every ranked rule below is already shipped or scored.";

/** The sentence a shipped rule owes a reader who expected a score and found none. */
export const NO_SCORE_YET =
  "This org unit has published no measured change since the commitment, so the move has "
  + "no score yet.";

/**
 * Ascending order on the raw string, comparing character by character. The ids
 * and model labels this ranks are ASCII, so this is byte order; it is written
 * with `<`/`>` rather than `localeCompare` on purpose, because a locale-aware
 * collation makes rank 1 depend on the reader's browser.
 */
function rawAscending(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * The rank, in one comparator, total by construction: expected return
 * descending, then the three declared string keys ascending.
 * `(source, targetTier, unit)` is unique in both source forms — one candidate
 * per model per unit, one candidate per unit — so no pair of rules reaches the
 * end of this function equal and the sort cannot depend on input order.
 *
 * Lifecycle is deliberately NOT in it. Rank is what a move is worth; shipping
 * one does not make the next one worth more, and a list that reshuffles when a
 * reader commits to something is a list they cannot learn.
 */
function byRank(left, right) {
  return right.expectedMonthlyUsd - left.expectedMonthlyUsd
    || rawAscending(left.source, right.source)
    || rawAscending(left.targetTier, right.targetTier)
    || rawAscending(left.unit, right.unit);
}

/**
 * Expected monthly return for one rule, as an exact integer dollar figure.
 *
 * The source figure is the candidate's own recoverable dollars. A fractional
 * source figure is TRUNCATED TOWARD ZERO, never rounded and never widened into a
 * range: the rendered column has to add up to the rendered headline, and a
 * reader who adds a rounded column reaches a different number than the page.
 * Truncating also means the slate never claims a dollar the rule did not find.
 */
function expectedMonthly(recoverableUsd) {
  const amount = Number(recoverableUsd);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
}

/** One rule from a per-model candidate: the model is named, so name it. */
function ruleFromModelCandidate(unit, candidate) {
  const inputs = candidate.inputs ?? {};
  return {
    source: String(candidate.model),
    unit: String(unit.unitLabel ?? ""),
    sourceTier: String(candidate.tier ?? ""),
    targetTier: String(candidate.proposedTier ?? ""),
    expectedMonthlyUsd: expectedMonthly(candidate.recoverableUsd),
    evidence: `${unit.unitLabel} paid ${candidate.currentSpendUsd.toFixed(2)} USD for `
      + `${candidate.model} over ${inputs.tokens ?? 0} tokens; the same tokens on the `
      + `${candidate.proposedTier} tier cost ${candidate.projectedSpendUsd.toFixed(2)} USD.`,
    confidence: String(unit.confidence?.level ?? ""),
    basis: MODELLED_BASIS_TAG,
  };
}

/**
 * One rule from a per-unit candidate. The unit's tier is not asserted here: it
 * is looked up in the same price table the rule itself used, from the observed
 * price the rule already published, so the slate and the rule cannot name
 * different tiers.
 *
 * The evidence line is the rule's own `recoverable` step, verbatim. It is the
 * line the figure was derived from, and it is the line a reader disputes.
 */
function ruleFromUnitCandidate(department) {
  const routing = department.downRouting;
  const tier = classifyModelTier(routing.observedMinorPerMillionTokens ?? 0);
  const step = routing.workedExample?.find((line) => line.step === "recoverable") ?? null;
  return {
    source: String(department.name ?? routing.unitLabel ?? ""),
    unit: String(department.name ?? routing.unitLabel ?? ""),
    sourceTier: String(tier?.tier ?? ""),
    targetTier: String(tier?.cheaperTier ?? ""),
    expectedMonthlyUsd: expectedMonthly(routing.recoverableUsd),
    evidence: step
      ? `${step.step}: ${step.expression} = ${step.value}`
      : routing.decisionReason,
    confidence: String(routing.confidence?.level ?? ""),
    basis: MODELLED_BASIS_TAG,
  };
}

/** Every per-model candidate on the envelope, flattened across scored units. */
function modelRules(analysis) {
  const rules = [];
  for (const unit of analysis?.modelRouting?.ranked ?? []) {
    for (const candidate of unit.candidates ?? []) {
      rules.push(ruleFromModelCandidate(unit, candidate));
    }
  }
  return rules;
}

/** Every per-unit candidate the blended rule flagged. */
function unitRules(analysis) {
  return (analysis?.rankedDepartments ?? [])
    .filter((department) => department?.downRouting?.flagged)
    .map(ruleFromUnitCandidate);
}

/**
 * The measured change for one org unit, or no score and the reason there is
 * none. `spendChangeUsd` is the envelope's own period-over-period figure and
 * `trendAvailable` is the envelope's own verdict on whether that figure exists.
 * Neither is recomputed here, and a unit that publishes no usable trend yields
 * NO SCORE rather than a zero — a zero would read as "the move changed nothing",
 * which is a measurement nobody made.
 */
function observedChange(analysis, unit) {
  const department = (analysis?.rankedDepartments ?? [])
    .find((entry) => entry?.name === unit);
  if (!department?.trendAvailable) {
    return { value: null, reason: department?.trendReason || NO_SCORE_YET };
  }
  // `Number(null)` is 0, so an absent figure is refused before it is coerced. A
  // unit that claims a trend and then publishes no figure contradicts itself,
  // and gets the plain sentence rather than a reason written for a different case.
  const raw = department.spendChangeUsd;
  const change = raw == null ? NaN : Number(raw);
  return Number.isFinite(change)
    ? { value: Math.trunc(change), reason: "" }
    : { value: null, reason: NO_SCORE_YET };
}

/**
 * One rule, with the state it is in. A commitment names an org unit; a rule that
 * unit did not raise is untouched by it, which is why the match is on `unit` and
 * not on the rule's source.
 */
function withLifecycle(rule, analysis, commitment) {
  const committed = Boolean(commitment?.department) && commitment.department === rule.unit;
  if (!committed) {
    return { ...rule, lifecycle: RULE_LIFECYCLE.PROPOSED, observedChangeUsd: null, lifecycleReason: "" };
  }
  const observed = observedChange(analysis, rule.unit);
  return observed.value === null
    ? { ...rule, lifecycle: RULE_LIFECYCLE.SHIPPED, observedChangeUsd: null, lifecycleReason: observed.reason }
    : { ...rule, lifecycle: RULE_LIFECYCLE.SCORED, observedChangeUsd: observed.value, lifecycleReason: "" };
}

/**
 * An envelope the page cannot read AT ALL — wrong shape, not merely empty. It is
 * a different sentence from "nothing qualified" because the reader does a
 * different thing about it: one is an answer, the other is a broken input.
 */
function unreadable(analysis) {
  if (typeof analysis !== "object") return true;
  const departments = analysis.rankedDepartments;
  const ranked = analysis.modelRouting?.ranked;
  return (departments != null && !Array.isArray(departments))
    || (ranked != null && !Array.isArray(ranked));
}

/**
 * The action to take, phrased as the move rather than as the metric. A reader
 * who has already read the figure above it needs the instruction, not the figure
 * a second time.
 */
function nextActionFor(rule) {
  if (!rule) return null;
  return rule.source === rule.unit
    ? `Move ${rule.source}'s ${rule.sourceTier}-tier text generation to the ${rule.targetTier} tier.`
    : `Move ${rule.source} in ${rule.unit} from the ${rule.sourceTier} tier to the `
      + `${rule.targetTier} tier.`;
}

/**
 * Build the slate from an analysis envelope.
 *
 * @param {object|null} analysis A `local-finops` envelope, or null before one exists.
 * @param {{commitment?: object|null}} [options] The action this browser retained,
 *   if any. Absent — the ordinary case, and the whole of the bundled example —
 *   every rule is a proposal.
 * @returns a frozen slate: the ranked rules, the headline total, and one action.
 */
export function routingSlate(analysis = null, { commitment = null } = {}) {
  const empty = (reason, state) => Object.freeze({
    version: ROUTING_SLATE_VERSION,
    available: false,
    state,
    reason,
    basis: null,
    period: analysis?.period ?? null,
    source: null,
    rules: Object.freeze([]),
    counts: Object.freeze({ proposed: 0, shipped: 0, scored: 0 }),
    lead: null,
    totalExpectedMonthlyUsd: 0,
    nextAction: null,
    nextActionRank: null,
    tieBreak: ROUTING_SLATE_TIE_BREAK,
  });
  if (!analysis) return empty(ROUTING_SLATE_REASONS.no_analysis, ROUTING_SLATE_STATES.UNAVAILABLE);
  if (unreadable(analysis)) {
    return empty(ROUTING_SLATE_REASONS.unreadable, ROUTING_SLATE_STATES.ERROR);
  }

  const fromModels = modelRules(analysis);
  const source = fromModels.length ? "per-model" : "per-unit";
  // A rule worth zero dollars after truncation is not a change to ship, so it is
  // not rendered — and, because the headline is the sum of what IS rendered, it
  // is not in the total either.
  const rules = (fromModels.length ? fromModels : unitRules(analysis))
    .filter((rule) => rule.expectedMonthlyUsd > 0 && rule.targetTier)
    .sort(byRank)
    .map((rule, index) => Object.freeze({
      ...withLifecycle(rule, analysis, commitment), rank: index + 1,
    }));
  if (!rules.length) {
    return empty(ROUTING_SLATE_REASONS.no_candidates, ROUTING_SLATE_STATES.UNAVAILABLE);
  }

  // The next move is the best rule STILL PROPOSED. Telling a reader to ship what
  // they already shipped is the one instruction this surface must never print.
  const next = rules.find((rule) => rule.lifecycle === RULE_LIFECYCLE.PROPOSED) ?? null;
  const counts = { proposed: 0, shipped: 0, scored: 0 };
  for (const rule of rules) counts[rule.lifecycle] += 1;

  return Object.freeze({
    version: ROUTING_SLATE_VERSION,
    available: true,
    state: ROUTING_SLATE_STATES.READY,
    reason: null,
    basis: MODELLED_BASIS_TAG,
    period: analysis.period ?? null,
    source,
    rules: Object.freeze(rules),
    counts: Object.freeze(counts),
    lead: rules[0],
    // The headline is the arithmetic sum of the rows above, and nothing else. A
    // reader adding the rendered column reaches this number exactly.
    totalExpectedMonthlyUsd: rules.reduce((sum, rule) => sum + rule.expectedMonthlyUsd, 0),
    nextAction: nextActionFor(next),
    nextActionRank: next?.rank ?? null,
    tieBreak: ROUTING_SLATE_TIE_BREAK,
  });
}
