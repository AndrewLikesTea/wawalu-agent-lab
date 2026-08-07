// The plan's one recoverable total, and the arithmetic that reconciles it by
// hand (#1287).
//
// THE DEFECT THIS CLOSES. `plan-scope.js` (#1286) computes a planned figure and
// nothing else, so a reader asking why the total is $4,000 rather than $4,437
// has one number and three lever lines and no written arithmetic joining them.
// This module publishes the LEDGER — one row per move, every factor named, the
// rounding rule stated as data — so two people adding the rendered column reach
// the rendered total and disagree about a factor, not about the answer.
//
// IT IS THE ONLY PLACE THE PLAN ARITHMETIC IS WRITTEN. `plan-scope.js` carried
// its own copy of `remainingShare` and the truncation; it now calls this, so the
// section's figure IS the ledger's total by construction, not by agreement.
//
// IT DOES NOT PRICE ANYTHING. `modelledMonthlyUsd` arrives already repriced by
// the path the rest of the page uses: the analysis is computed against the
// lead's declared card, `down-routing-candidates.js` prices the cheaper
// destination through `priceDestination`, and `routing-slate.js` truncates that
// to the rule's `expectedMonthlyUsd`. Re-deriving a price here would be a second
// opinion about a figure the slate settled — and, once a declared card can move
// a tier floor, one that could quote list prices to a lead who has a contract.
// What this module does instead is CARRY the slate's pricing provenance onto
// every row, so a plan priced off a reference card says so line by line.
//
// WHAT IT REFUSES TO ADD. No floor, no cap, no confidence haircut, no rounding
// up, no minimum contribution. The total is the sum of the rows. If that sum is
// zero, zero is the answer.
//
// PURE. No DOM, no clock, no storage, no randomness, no module-level mutable
// state. Every input is an argument and the result is a plain frozen object.

/** Bump when a factor, the rounding rule, or what the total means changes. */
export const PLAN_CONTRIBUTION_VERSION = "plan-contributions/1.0.0";

/** What the summed figure is called where it is rendered. */
export const PLAN_TOTAL_LABEL = "Recoverable at the committed scope";

/** The rounding, as an enum a caller can branch on rather than parse. */
export const PLAN_ROUNDING_MODE = "truncate-toward-zero-whole-usd";

/**
 * The rounding rule in words, returned in the result so a hand check reconciles
 * without reading this file. Stated as ONE rule applied ONCE: a second rounding
 * at the display boundary is how a rendered column stops adding up.
 */
export const PLAN_ROUNDING_RULE =
  "Each move's contribution is truncated toward zero to whole dollars before it is summed, and "
  + "the plan total is the exact sum of those whole-dollar contributions. Nothing is rounded up, "
  + "no floor, cap or confidence haircut is applied, and the display rounds a second time "
  + "nowhere.";

/** The accepted range for a stated scope, in whole percent. */
export const SCOPE_PCT_MIN = 0;
export const SCOPE_PCT_MAX = 100;

/**
 * Why one row contributes nothing, named rather than left for a reader to infer
 * from a zero. Each code is a different thing to do about it.
 */
export const ZERO_REASONS = Object.freeze({
  not_in_plan:
    "This move is not in the plan, so it contributes nothing at any scope.",
  no_stated_scope:
    "This move is in the plan with no stated scope, and an unstated scope counts as 0%.",
  scope_out_of_range:
    `The stated scope is not a whole percent from ${SCOPE_PCT_MIN} to ${SCOPE_PCT_MAX}, so it is `
    + "not a scope this plan will count.",
  all_teams_refused:
    "Every eligible team has refused this move, so its feasible scope is zero.",
  all_workloads_excluded:
    "Every eligible workload is excluded from this move, so its feasible scope is zero.",
  nothing_modelled:
    "No recoverable dollars are modelled for this move, so its share of them is zero.",
  below_one_dollar:
    "The feasible scope recovers less than a whole dollar a month, and the plan never rounds up.",
});

/** A count a lead actually stated: a finite, non-negative number and nothing else. */
export function statedCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * A stated scope, validated HERE rather than at the control.
 *
 * The control is a text field and a real browser would refuse a bad entry, but a
 * commitment can also arrive from a caller, a restored document or a test
 * harness whose selects accept any value at all. So the range check lives with
 * the arithmetic: an out-of-range or fractional percent is not clamped into
 * something plausible, it is REFUSED, and a refused scope counts as no scope —
 * which is the conservative default #1286 already documents for silence.
 */
export function statedScopePct(value) {
  if (value === null || value === undefined) return { stated: false, refused: false, pct: 0 };
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { stated: false, refused: true, pct: 0 };
  }
  if (value < SCOPE_PCT_MIN || value > SCOPE_PCT_MAX) {
    return { stated: false, refused: true, pct: 0 };
  }
  return { stated: true, refused: false, pct: value };
}

/**
 * A share of a declared base, floored at zero and capped at one.
 *
 * NO DECLARED BASE MEANS NO REDUCTION — the factor is 1 and the row says why.
 * That is #1286's rule, not a softening of this issue's: naming an excluded
 * workload cannot honestly shrink a figure when nothing on this page knows how
 * many workloads the move was eligible for, and a factor invented from an
 * unknown base would be arithmetic dressed as evidence. Where a base IS
 * declared, the reduction is arithmetic and it is applied — a commitment that
 * excludes every eligible workload contributes exactly nothing.
 */
export function remainingShare(base, removed) {
  const eligible = statedCount(base);
  if (eligible === null || eligible <= 0) {
    return { factor: 1, declared: false, eligible: null, removed: statedCount(removed) ?? 0 };
  }
  const gone = statedCount(removed) ?? 0;
  return {
    factor: Math.min(1, Math.max(0, (eligible - gone) / eligible)),
    declared: true,
    eligible,
    removed: gone,
  };
}

/** The four-step derivation, in the order the page's "how we know this" states it. */
function derivationFor(row, basis) {
  const scope = `${row.sharePct}% share × ${row.workloadFactor} of the eligible workloads × `
    + `${row.teamFactor} of the eligible teams`;
  return Object.freeze([
    Object.freeze({
      step: "declared rate card",
      expression: basis.statement,
      value: basis.cardId,
    }),
    Object.freeze({
      step: "modelled move",
      expression: `${row.name}, at the price that card gives it`,
      value: `${row.modelledMonthlyUsd} USD a month`,
    }),
    Object.freeze({
      step: "applied scope",
      expression: row.inPlan ? scope : "not in the plan, so no scope is applied",
      value: String(row.feasibleScope),
    }),
    Object.freeze({
      step: "contribution",
      expression: `truncate(${row.modelledMonthlyUsd} × ${row.feasibleScope})`,
      value: `${row.contributionMonthlyUsd} USD a month`,
    }),
  ]);
}

/**
 * What priced this plan, from the slate's own pricing record.
 *
 * A record that claims a declared card without naming one is a contradiction,
 * and it resolves DOWNWARD: the plan is reported as priced at reference rates,
 * because an unnamed card is a card nobody can check. The one thing this must
 * never do is the other way round — quote list rates under a declared heading.
 */
export function planRateBasis(pricing = null) {
  const cardId = pricing?.cardId ? String(pricing.cardId) : null;
  const declared = pricing?.rateSource === "declared" && cardId !== null;
  const discountApplied = declared && Boolean(pricing?.discountApplied);
  return Object.freeze({
    declared,
    cardId: cardId ?? "published-list-reference",
    rateSource: declared ? "declared" : "reference",
    discountApplied,
    statement: declared
      ? `Priced against the declared rate card ${cardId}`
        + `${discountApplied ? ", committed-use discounts applied" : ""}.`
      : "Priced at the bundled published-list reference rates: no rate card is declared, so "
        + "every figure below is a list-price ceiling.",
  });
}

/**
 * One move's row in the ledger.
 *
 * @param {object} move `{ key, rank, name, modelledMonthlyUsd, inPlan }` plus
 *   #1286's own commitment fields — `reroutedSharePct`, `eligibleWorkloads`,
 *   `excludedWorkloads`, `eligibleTeams`, `refusingTeams`. The lever names are
 *   that module's; nothing is renamed or re-defaulted here.
 * @param {{rateBasis: object}} context the basis every row on one plan shares.
 */
export function moveContribution(move = {}, { rateBasis = planRateBasis(null) } = {}) {
  const inPlan = Boolean(move?.inPlan);
  const modelled = Number(move?.modelledMonthlyUsd);
  const modelledMonthlyUsd = Number.isFinite(modelled) ? modelled : 0;
  const scope = statedScopePct(move?.reroutedSharePct);
  const workloads = remainingShare(move?.eligibleWorkloads, move?.excludedWorkloads);
  const teams = remainingShare(move?.eligibleTeams, move?.refusingTeams);
  // Out of the plan is zero BY THE MULTIPLICATION, not by a branch that skips
  // it: the row still carries every factor, so a lead who commits the move sees
  // the same numbers move from an uncounted row into a counted one.
  const feasibleScope = inPlan ? (scope.pct / 100) * workloads.factor * teams.factor : 0;
  const exactMonthlyUsd = modelledMonthlyUsd * feasibleScope;
  // `|| 0` collapses -0 and NaN to a plain zero: a row that contributes nothing
  // must be assertable as EXACTLY 0, and `Object.is(-0, 0)` is false.
  const contributionMonthlyUsd = Math.trunc(exactMonthlyUsd) || 0;

  let zeroReason = "";
  if (contributionMonthlyUsd === 0) {
    if (!inPlan) zeroReason = ZERO_REASONS.not_in_plan;
    else if (scope.refused) zeroReason = ZERO_REASONS.scope_out_of_range;
    else if (teams.factor === 0) zeroReason = ZERO_REASONS.all_teams_refused;
    else if (workloads.factor === 0) zeroReason = ZERO_REASONS.all_workloads_excluded;
    else if (!scope.stated || scope.pct === 0) zeroReason = ZERO_REASONS.no_stated_scope;
    else if (modelledMonthlyUsd === 0) zeroReason = ZERO_REASONS.nothing_modelled;
    else zeroReason = ZERO_REASONS.below_one_dollar;
  }

  const row = {
    key: String(move?.key ?? ""),
    rank: move?.rank ?? null,
    name: String(move?.name ?? move?.key ?? ""),
    inPlan,
    modelledMonthlyUsd,
    sharePct: scope.pct,
    scopeStated: scope.stated,
    scopeRefused: scope.refused,
    workloadFactor: workloads.factor,
    workloadBaseDeclared: workloads.declared,
    excludedWorkloads: workloads.removed,
    teamFactor: teams.factor,
    teamBaseDeclared: teams.declared,
    refusingTeams: teams.removed,
    feasibleScope,
    exactMonthlyUsd,
    contributionMonthlyUsd,
    rounding: PLAN_ROUNDING_MODE,
    zeroReason,
    rateSource: rateBasis.rateSource,
    rateCardId: rateBasis.cardId,
  };
  row.derivation = derivationFor(row, rateBasis);
  return Object.freeze(row);
}

/**
 * The whole ledger: one row per move, and one total.
 *
 * @param {Array<object>} moves every modelled move, in the slate's rank order,
 *   whether or not it is in the plan. Moves that are out of the plan are
 *   RETURNED (a reader has to see the row that contributes nothing) but they are
 *   not counted, at any scope.
 * @param {{pricing?: object|null}} [options] the slate's own pricing record.
 * @returns a frozen, serialisable ledger.
 */
export function planContributions(moves = [], { pricing = null } = {}) {
  const rateBasis = planRateBasis(pricing);
  const rows = (Array.isArray(moves) ? moves : [])
    .map((move) => moveContribution(move, { rateBasis }));
  const counted = rows.filter((row) => row.inPlan);
  const totalMonthlyUsd = counted.reduce((sum, row) => sum + row.contributionMonthlyUsd, 0);
  return Object.freeze({
    version: PLAN_CONTRIBUTION_VERSION,
    label: PLAN_TOTAL_LABEL,
    rateBasis,
    rounding: Object.freeze({
      mode: PLAN_ROUNDING_MODE,
      rule: PLAN_ROUNDING_RULE,
      unit: "whole USD per month",
    }),
    contributions: Object.freeze(rows),
    inPlanCount: counted.length,
    moveCount: rows.length,
    totalMonthlyUsd,
    // The sum written out, so the rendered column and the rendered total can be
    // checked against each other without a calculator. An empty plan states the
    // empty sum rather than printing a bare zero with nothing behind it.
    reconciliation: counted.length
      ? `${counted.map((row) => row.contributionMonthlyUsd).join(" + ")} = ${totalMonthlyUsd}`
      : `no move is in the plan, so the sum is over an empty set = ${totalMonthlyUsd}`,
  });
}
