// Did last period's routing policy return what it said it would?
//
// `routing-slate.js` registers the rules: one per model or per org unit, each
// carrying an expected monthly return in whole dollars. That register is the ONLY
// source of rules here — this module never parses a policy, never invents a rule,
// and keeps no store of its own. It reads `routingSlate(...).rules` and scores
// them.
//
// WHAT IS COMPARED. The rules registered from the PRIOR period's policy, against
// the FOLLOWING period's per-org-unit cost series. Both periods come off the
// retained savings-commitment record (`monthly-department-action/1.0.0`):
// `baseline.period` is the month the policy was committed from and `reviewPeriod`
// is the month it is answerable for. Taking them from the record rather than from
// a clock or an argument means the scored window is the one the reader committed
// to, not the one whoever opened the page happened to be looking at.
//
// EVERY RULE ON THE PRIOR SLATE IS SCORED, not only the one org unit the
// commitment names. A policy is shipped as a whole; scoring one line of it and
// staying silent about the rest is how a policy gets credit for its best row.
//
// EVIDENCE BEFORE ARITHMETIC. A rule whose unit has no rows in the follow-up
// series gets `not-enough-evidence` and a sentence naming exactly what was
// absent. It never gets a zero. A zero reads as "the change returned nothing",
// which is a measurement nobody made, and it is the one number a director cannot
// argue with because it looks like a result.
//
// Pure and total: arguments in, one frozen payload out. No DOM, no storage, no
// clock, no network. Two reviewers with the same fixture and the constants below
// reach the same four verdicts.

import { canonicalPeriod, formatUsd, periodSeriesFromTotals } from "./finops-imported-period-series.js";
import { routingSlate } from "./routing-slate.js";

/** Bump when a threshold, a verdict name, or a record field changes meaning. */
export const ROUTING_RULE_SCORE_VERSION = "routing-rule-score/1.0.0";

/** The one question this surface settles. Carried so a view cannot retitle it. */
export const ROUTING_RULE_SCORE_QUESTION =
  "Did last period's routing rules return what they said they would?";

/** Four verdicts. Exactly one per rule, and the fourth carries no figure. */
export const RULE_VERDICT = Object.freeze({
  met: "met",
  partiallyMet: "partially-met",
  missed: "missed",
  notEnoughEvidence: "not-enough-evidence",
});

/**
 * THE MET TOLERANCE, as a percent of the rule's own expected return.
 *
 * ASSUMPTION: an org unit's monthly spend moves by a few percent for reasons
 * nobody routed — a price change, a quiet week, one team's experiment — so a rule
 * landing within a twentieth of its expected return is credited as met rather
 * than as a miss that happens to be small. The favourable side is unbounded on
 * purpose: beating the expectation is met, and a fifth verdict for over-delivery
 * would only give a good month something to argue about.
 *
 * Applied by integer cross-multiplication on minor units
 * (`observed * 100 >= expected * 95`), never as a float ratio, so a boundary
 * cannot move because a division rounded.
 */
export const MET_TOLERANCE_PERCENT = 95;

/**
 * THE MISSED FLOOR, in whole dollars of observed saving.
 *
 * ASSUMPTION: spend that did not fall is a missed rule, and spend that ROSE is
 * the same verdict rather than a worse one, because this module cannot tell the
 * two apart from a single pair of monthly totals. Clamping a regression to zero
 * would render the most expensive outcome observable here as the mildest one, so
 * the floor is inclusive: observed at or below zero is `missed`.
 */
export const MISSED_FLOOR_USD = 0;

/**
 * THE AGGREGATE RULE, stated once and surfaced in the view verbatim.
 *
 * ASSUMPTION: a rule with no evidence is not a failure. It is excluded from the
 * ratio and reported separately by count, because counting absent coverage as a
 * miss would let a thin export make a working policy look broken — and would give
 * anyone who dislikes the score an obvious reason to reject the whole thing.
 */
export const AGGREGATE_RULE =
  "Rules with no evidence are excluded from this verdict and counted separately. "
  + "Of the rules that could be scored: every one met is met; none above the missed "
  + "floor is missed; anything between is partially met. No rule scorable at all is "
  + "not enough evidence.";

/** Why the panel has nothing to score. Each names something a reader can fix. */
export const ROUTING_RULE_SCORE_REASONS = Object.freeze({
  no_commitment:
    "Nothing has been committed in this browser, so there is no prior period to score a "
    + "routing policy from and no follow-up period it is answerable for.",
  no_rules:
    "The prior period's analysis registered no routing rule, so there is nothing to score "
    + "against the following period.",
  period_mismatch:
    "The analysis on screen is not the period this commitment is answerable for, so scoring "
    + "the rules against it would compare a policy with a month it never covered.",
});

/**
 * Said whenever the rules being scored were registered by a LATER analysis than
 * the period they are answerable from.
 *
 * This browser retains period totals and department rollups, never a whole prior
 * envelope, so in the ordinary single-import case the register on screen is the
 * only one there is. Saying so is the difference between a number a reader can
 * check and one they have to trust: the expected figure is the rule as it stands
 * now, and the two periods it was measured over are on every rule's basis.
 */
export const REGISTER_NOT_PRIOR_NOTE =
  "This browser retains no earlier policy file, so the rules scored are the register the "
  + "analysis on screen publishes for the same org units. Each rule's basis names the two "
  + "periods its figures were compared over.";

const usd = (minor) => Math.round(minor) / 100;
const minor = (dollars) => Math.round(Number(dollars) * 100);

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

/**
 * The two periods this run compares, from the retained commitment record.
 *
 * Both are canonicalized to `YYYY-MM` by the period-series helper, so a record
 * holding `2026-07` and a series holding `2026-07-01 to 2026-08-01` key the same.
 */
export function scoredPeriods(commitment) {
  const priorPeriod = canonicalPeriod(commitment?.baseline?.period);
  const followUpPeriod = canonicalPeriod(commitment?.reviewPeriod);
  return priorPeriod === null || followUpPeriod === null
    ? null : { priorPeriod, followUpPeriod };
}

/**
 * The follow-up cost series, one entry per org unit, read off an analysis
 * envelope's own per-unit trend fields.
 *
 * `previousSpendUsd` and `spendUsd` are the envelope's two period totals for that
 * unit; `trendAvailable` is the envelope's own verdict on whether the earlier one
 * exists. A unit that publishes no usable trend contributes NO ROWS rather than a
 * zero row, so it reaches the scorer as absent coverage and is named as such.
 */
export function unitSeriesFromAnalysis(analysis, { priorPeriod, followUpPeriod }) {
  return (analysis?.rankedDepartments ?? [])
    .filter((department) => department?.trendAvailable)
    .map((department) => ({
      unit: String(department.name ?? ""),
      periods: [
        { period: priorPeriod, total: Number(department.previousSpendUsd) },
        { period: followUpPeriod, total: Number(department.spendUsd) },
      ],
    }));
}

/**
 * What the follow-up series does not hold for one rule, in the words a reader
 * uses to go and fix it: which org unit, which period, which series had no rows.
 */
function missingCoverageFor(rule, entry, priorEntry, followUpEntry, periods) {
  if (!entry) {
    return `No cost rows for "${rule.unit}" anywhere in the follow-up export: the `
      + `${periods.followUpPeriod} import carries no series for this org unit, so this rule's `
      + "observed saving cannot be computed at all.";
  }
  const absent = [
    ...(priorEntry ? [] : [periods.priorPeriod]),
    ...(followUpEntry ? [] : [periods.followUpPeriod]),
  ];
  return `The series for "${rule.unit}" carries no rows for `
    + `${absent.join(" or ")}, so there is no total to measure this rule's saving `
    + (priorEntry ? "down to." : "away from.");
}

/**
 * The verdict for one rule, and the dollar threshold that produced it.
 *
 * The threshold is decided HERE and carried on the record, not recomputed when
 * the row is painted: a view that re-derives a boundary is a second place the
 * rule can be got wrong, and the number a director disputes has to be the number
 * the verdict was actually taken on.
 */
function verdictFor(observedMinor, expectedMinor) {
  if (observedMinor <= minor(MISSED_FLOOR_USD)) {
    return {
      verdict: RULE_VERDICT.missed,
      thresholdMinor: minor(MISSED_FLOOR_USD),
      thresholdRule: `Observed saving at or below the missed floor of ${formatUsd(MISSED_FLOOR_USD)}.`,
    };
  }
  const metMinor = Math.round((expectedMinor * MET_TOLERANCE_PERCENT) / 100);
  return observedMinor * 100 >= expectedMinor * MET_TOLERANCE_PERCENT
    ? {
      verdict: RULE_VERDICT.met,
      thresholdMinor: metMinor,
      thresholdRule: `Observed saving reached ${MET_TOLERANCE_PERCENT}% of the expected return.`,
    }
    : {
      verdict: RULE_VERDICT.partiallyMet,
      thresholdMinor: metMinor,
      thresholdRule: `Observed saving is above ${formatUsd(MISSED_FLOOR_USD)} but short of `
        + `${MET_TOLERANCE_PERCENT}% of the expected return.`,
    };
}

/** One scored rule, or one honest abstention with the coverage it wanted named. */
function scoreRule(rule, seriesByUnit, periods) {
  const basis = `rule:${rule.source}@${rule.unit}|periods:${periods.priorPeriod}->`
    + `${periods.followUpPeriod}`;
  const expectedMinor = minor(rule.expectedMonthlyUsd);
  const shape = {
    rank: rule.rank,
    rule: rule.source,
    unit: rule.unit,
    targetTier: rule.targetTier,
    expectedSavings: usd(expectedMinor),
    observedSavings: null,
    threshold: null,
    thresholdRule: null,
    basis,
    missingCoverage: null,
  };

  const entry = seriesByUnit.get(rule.unit) ?? null;
  const series = entry ? periodSeriesFromTotals(entry.periods) : [];
  const priorEntry = series.find((row) => row.period === periods.priorPeriod) ?? null;
  const followUpEntry = series.find((row) => row.period === periods.followUpPeriod) ?? null;
  if (!priorEntry || !followUpEntry) {
    return deepFreeze({
      ...shape,
      verdict: RULE_VERDICT.notEnoughEvidence,
      missingCoverage: missingCoverageFor(rule, entry, priorEntry, followUpEntry, periods),
    });
  }

  // A saving is spend that FELL, so the earlier total leads. The subtraction is on
  // integer minor units, so the figure is exact to the cent in every browser.
  const observedMinor = minor(priorEntry.total) - minor(followUpEntry.total);
  const decided = verdictFor(observedMinor, expectedMinor);
  return deepFreeze({
    ...shape,
    verdict: decided.verdict,
    observedSavings: usd(observedMinor),
    threshold: usd(decided.thresholdMinor),
    thresholdRule: decided.thresholdRule,
  });
}

/** The workspace verdict, by AGGREGATE_RULE and nothing else. */
export function aggregateVerdict(scored) {
  const judged = scored.filter((row) => row.verdict !== RULE_VERDICT.notEnoughEvidence);
  if (judged.length === 0) return RULE_VERDICT.notEnoughEvidence;
  if (judged.every((row) => row.verdict === RULE_VERDICT.met)) return RULE_VERDICT.met;
  if (judged.every((row) => row.verdict === RULE_VERDICT.missed)) return RULE_VERDICT.missed;
  return RULE_VERDICT.partiallyMet;
}

/**
 * Score last period's registered routing rules against the following period.
 *
 * @param options.priorAnalysis the PRIOR period's analysis envelope. Its rules are
 *   read through `routingSlate`, the one register, so a rule scored here is a rule
 *   that surface ranked.
 * @param options.unitSeries the follow-up cost series, per org unit:
 *   `[{ unit, periods: [{ period, total }] }]`. Build it from an envelope with
 *   `unitSeriesFromAnalysis`, or hand it in directly.
 * @param options.commitment the retained savings-commitment record, which supplies
 *   both scored periods. Without one there is no window and nothing is scored.
 * @param options.seriesPeriod the period the series was read for, when the caller
 *   knows it. A series read for any month other than the follow-up is refused
 *   outright rather than scored — a caller that does not say vouches for it.
 * @returns a deeply frozen payload. Never throws, never returns null.
 */
export function scoreRoutingRules({
  priorAnalysis = null, unitSeries = [], commitment = null, seriesPeriod = null,
} = {}) {
  const periods = scoredPeriods(commitment);
  const registerPeriod = canonicalPeriod(priorAnalysis?.period);
  const empty = (reason) => deepFreeze({
    version: ROUTING_RULE_SCORE_VERSION,
    question: ROUTING_RULE_SCORE_QUESTION,
    available: false,
    reason,
    priorPeriod: periods?.priorPeriod ?? null,
    followUpPeriod: periods?.followUpPeriod ?? null,
    registerPeriod,
    registerNote: null,
    aggregate: RULE_VERDICT.notEnoughEvidence,
    aggregateRule: AGGREGATE_RULE,
    scoredCount: 0,
    notEnoughEvidenceCount: 0,
    rules: [],
  });
  if (!periods) return empty(ROUTING_RULE_SCORE_REASONS.no_commitment);
  const read = canonicalPeriod(seriesPeriod);
  if (seriesPeriod !== null && read !== periods.followUpPeriod) {
    return empty(ROUTING_RULE_SCORE_REASONS.period_mismatch);
  }

  const registered = routingSlate(priorAnalysis, { commitment }).rules;
  if (registered.length === 0) return empty(ROUTING_RULE_SCORE_REASONS.no_rules);

  const seriesByUnit = new Map();
  for (const entry of Array.isArray(unitSeries) ? unitSeries : []) {
    if (entry?.unit) seriesByUnit.set(String(entry.unit), entry);
  }
  const rules = registered.map((rule) => scoreRule(rule, seriesByUnit, periods));
  const notEnough = rules.filter((row) => row.verdict === RULE_VERDICT.notEnoughEvidence).length;

  return deepFreeze({
    version: ROUTING_RULE_SCORE_VERSION,
    question: ROUTING_RULE_SCORE_QUESTION,
    available: true,
    reason: null,
    priorPeriod: periods.priorPeriod,
    followUpPeriod: periods.followUpPeriod,
    registerPeriod,
    registerNote: registerPeriod === periods.priorPeriod ? null : REGISTER_NOT_PRIOR_NOTE,
    aggregate: aggregateVerdict(rules),
    aggregateRule: AGGREGATE_RULE,
    scoredCount: rules.length - notEnough,
    notEnoughEvidenceCount: notEnough,
    rules,
  });
}
