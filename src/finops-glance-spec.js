// The four figures the FinOps glance is allowed to lead with, and the rule that
// picks one of them.
//
// THE QUESTION THIS ANSWERS. A lead landing above the fold has about five
// seconds to decide whether this page is worth another minute. Four figures
// compete for that decision. This module says which four, in what order, what
// each one is measured in, which already-shipped model computes it, and the
// numeric line above which it is worth interrupting someone for. Nothing here
// computes a figure: every `source` below is an exported function this page
// already runs, and every measurement reads that function's published result.
//
// WHY A SPEC AND NOT FOUR RENDERERS. "Which number leads?" was a judgement call
// made at paint time, which means two engineers reading the page could disagree
// about it and both be right. The order below is fixed, the thresholds are
// numbers, and `composeFinopsGlance` is a `find` over them — so the lead is a
// consequence of the data and nothing else.
//
// WHAT IS DELIBERATELY NOT HERE. No fifth figure, no drill-down, no filter, no
// chart, no second data source. A line that does not answer one of the four
// questions below does not belong on this block.

import { QUERY_CATEGORIES, summarize } from "./evolution.js";
import { buildSpendMix } from "./attribution-units.js";
import { monthLabel, periodMovement } from "./finops-imported-period-series.js";
import { evaluateRankingReproducibility } from "./ranking-reproducibility.js";
import { COST_BAND, COST_BAND_MEANING } from "./peer-cost-position.js";

/** Bump when a figure, a question, a unit, or a threshold below changes meaning. */
export const GLANCE_VERSION = "finops-glance/1.0.0";

/** The block's own heading — the decision it exists to make, in the lead's words. */
export const GLANCE_QUESTION = "Which of these four is the reason to keep reading?";

/**
 * The four keys, in the ONE order the selection rule walks them.
 *
 * Order is part of the contract, not presentation: the lead is the first
 * measured figure in this order that crosses, so moving an entry changes which
 * number a leader is interrupted by.
 */
export const GLANCE_FIGURE_KEYS = Object.freeze([
  "spendMix", "departmentRank", "movement", "peerPosition",
]);

/** The element ids the glance owns on `src/evolution.html`. Nothing else writes them. */
export const GLANCE_IDS = Object.freeze({
  block: "finops-glance",
  lead: "finops-glance-lead",
  next: "finops-glance-next",
  supporting: "finops-glance-supporting",
});

/** What the block says when every measured figure sits under its threshold. */
export const GLANCE_NO_LEAD = Object.freeze({
  lead: "Nothing crossed its threshold this period.",
  action: "No figure crossed the line that would make it worth acting on now. Read the four "
    + "below for context, and check again when the next period's export lands.",
});

/**
 * How an unmeasured figure states itself.
 *
 * Never a zero, never a band, never a blank. A figure this page could not
 * measure says so and says why, and — see `measureGlanceFigures` — it is not
 * eligible to cross a threshold or to lead.
 */
export const GLANCE_UNMEASURED = "Not yet measured";

/** Reported to one decimal, and compared against the threshold at that precision. */
const oneDecimal = (value) => Math.round(Number(value) * 10) / 10;

const PERCENT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
});

const percent = (value) => `${PERCENT.format(value)}%`;
const signedPercent = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}`
  + `${PERCENT.format(Math.abs(value))}%`;

const unmeasured = (reason) => ({
  measured: false, value: null, display: GLANCE_UNMEASURED, reason, series: [],
});

/**
 * `series` is the picture of this reading, in the figure's own units.
 *
 * It is read off the SAME published result the value was, never recomputed from
 * a literal nearby: a picture whose shape disagreed with the number beside it
 * would be worse than no picture. It is plain numbers so that the renderer in
 * glance-figure-charts.js knows nothing about FinOps, and an unmeasured figure
 * carries none — see `unmeasured` above.
 */
const measured = (value, display, series = []) => ({
  measured: true, value, display, reason: null, series,
});

/**
 * The query-class mix, from the departments the prompt-literacy pass actually
 * graded.
 *
 * `summarize` already publishes an org-wide, SPEND-WEIGHTED mix over the four
 * classes; this hands it the graded departments in the shape it consumes — the
 * class shares the rubric published, weighted by the spend those graded queries
 * were joined to. A department the rubric could not grade contributes nothing
 * rather than contributing zeros, because a zeroed department would drag the
 * largest class's share down and quietly move it under the threshold.
 */
function measureSpendMix(analysis) {
  const graded = (analysis?.literacy?.departments ?? [])
    .filter((entry) => entry?.gradeable && Array.isArray(entry.categories)
      && entry.categories.length > 0 && Number(entry.spend?.joinedUsd) > 0)
    .map((entry) => ({
      spendUsd: Number(entry.spend.joinedUsd),
      mix: Object.fromEntries(entry.categories.map((category) => [category.key, category.share])),
    }));
  if (graded.length === 0) {
    return unmeasured("No department in this period has a query sample graded against its spend, "
      + "so no class of query can be named as the one consuming the budget.");
  }
  const totals = summarize(graded);
  const largest = QUERY_CATEGORIES
    .map((category) => ({ category, share: totals.mix[category.key] ?? 0 }))
    .reduce((best, entry) => (entry.share > best.share ? entry : best));
  if (!(largest.share > 0)) {
    return unmeasured("Every graded query class holds none of the graded spend in this period, "
      + "so no class can be named.");
  }
  const value = oneDecimal(largest.share * 100);
  // The four class shares off the same `totals.mix` the value came from, in
  // declared category order, so the drawn slice and the printed share are one
  // reading of one object.
  return measured(value, `${largest.category.label} · ${percent(value)} of graded spend`,
    QUERY_CATEGORIES.map((category) => totals.mix[category.key] ?? 0));
}

/**
 * The rank-1 department and the share it holds.
 *
 * Read straight off `buildSpendMix`'s published result, which the analysis
 * envelope carries under `attribution.spendMix`. That function documents its own
 * order — spend descending, then unit key — so "rank 1" is `units[0]` and no
 * second sort is taken here.
 */
function measureDepartmentRank(analysis) {
  const mix = analysis?.attribution?.spendMix ?? null;
  const total = Number(mix?.totalSpendUsd);
  const leader = mix?.units?.[0] ?? null;
  if (!leader || !(total > 0) || !Number.isFinite(Number(leader.spendUsd))) {
    return unmeasured("This period's spend is not attributed to any department, so there is no "
      + "rank-1 department to talk to.");
  }
  const value = oneDecimal((Number(leader.spendUsd) / total) * 100);
  const name = leader.unit?.label ?? leader.unit?.key ?? "the rank-1 department";
  // `units` in the order that function published — spend descending — so row 0
  // of the drawn ranking is the same leader this line names, and each entry is
  // that unit's SHARE of the same denominator the percent above was taken over.
  // Shares rather than dollars because the picture is drawn against a track that
  // stands for the whole period: publishing dollars would leave the renderer to
  // invent a denominator, and the width beside the sentence would then be a
  // share of something the sentence never mentions. Spend the model attributed
  // to no department is simply undrawn track, which is what it is.
  return measured(value, `1. ${name} · ${percent(value)} of period spend`,
    mix.units.map((unit) => (Number(unit.spendUsd) || 0) / total));
}

/**
 * Period against the period before it, from the movement model.
 *
 * `periodMovement` publishes the two totals and their difference; the percent is
 * that published difference over that published prior total, which is the same
 * conversion `departmentTrend` applies at the department grain. A prior period
 * of zero is unmeasured rather than infinite.
 */
function measureMovement(analysis) {
  const movement = periodMovement(analysis?.history?.periods ?? []);
  if (!movement.available || !(Number(movement.priorTotal) > 0)) {
    return unmeasured("This analysis covers one period, so there is no prior full month to "
      + "compare it against.");
  }
  const value = oneDecimal((Number(movement.delta) / Number(movement.priorTotal)) * 100);
  const against = monthLabel(movement.priorPeriod) ?? movement.priorPeriod;
  // The two published totals this percent is the difference between, in time
  // order. A fall draws as a fall because the second one is lower, not because
  // anything downstream reads the sign.
  return measured(value, `${signedPercent(value)} against ${against}`,
    [Number(movement.priorTotal), Number(movement.latestTotal)]);
}

/**
 * The quartile band, and only when the ranking model says the claim is supported.
 *
 * THE REFUSAL IS THE POINT. `evaluateRankingReproducibility` refuses to publish
 * a ranking when the successful-task sample is under the floor, when no cohort
 * matches the declared organization, or when the peer snapshot was built for
 * other scoring rules. A refused result still carries a `position` object, so a
 * caller that reads `position.band` without reading `reproducible` first will
 * put a band on the surface in exactly the states the model declined to make a
 * claim in. This reads the refusal signal FIRST, and a refused figure is
 * unmeasured — which also makes it ineligible to lead.
 *
 * The published model has three bands, not four: the cheapest quartile, the
 * middle HALF, and the most expensive quartile. So this names a single quartile
 * only when the band is one — 1 or 4 — and reports the middle half as the two
 * quartiles it spans, with no numeric value. That figure can therefore never
 * cross a threshold of 4, which is the correct answer for a band that does not
 * say whether the organization is in quartile 2 or quartile 3.
 */
const BAND_QUARTILE = Object.freeze({
  [COST_BAND.top]: 1, [COST_BAND.middle]: null, [COST_BAND.bottom]: 4,
});

function measurePeerPosition(_analysis, reproducibility) {
  if (!reproducibility) {
    return unmeasured("No peer ranking was evaluated for this analysis, so this view claims no "
      + "position against comparable organisations.");
  }
  if (reproducibility.reproducible !== true) {
    return unmeasured(reproducibility.reason
      ?? "The peer ranking was refused for this analysis, so no position is claimed.");
  }
  const band = reproducibility.position?.band ?? reproducibility.record?.band ?? null;
  if (!band || !(band in BAND_QUARTILE)) {
    return unmeasured("The peer ranking published no band for this analysis, so no position is "
      + "claimed.");
  }
  const value = BAND_QUARTILE[band];
  const meaning = COST_BAND_MEANING[band];
  // The quartiles this band occupies, one-based. The middle band occupies two
  // and names neither, so it marks both rather than picking one.
  return measured(value, value === null
    ? `Quartiles 2–3 of 4 · ${meaning}`
    : `Quartile ${value} of 4 · ${meaning}`, value === null ? [2, 3] : [value]);
}

/**
 * The four figures, declared once.
 *
 * `source` is the exported model function that already computes the figure —
 * the function itself, not its name, so a rename cannot leave this table
 * pointing at nothing. `threshold` is a number in the figure's own unit, and
 * `crosses` compares the REPORTED value against it, so a figure that reads
 * 39.95% and prints "40.0%" is judged on the number a leader can see.
 */
export const GLANCE_FIGURES = Object.freeze([
  Object.freeze({
    key: "spendMix",
    name: "Spend mix by query class",
    question: "Which class of query is consuming the budget?",
    // The denominator is the spend the rubric actually GRADED in the period, not
    // the period total. `summarize` weights each class by the spend its graded
    // queries joined to, so calling this a share of total period spend would
    // report a share of a denominator no part of the arithmetic used — and would
    // overstate every class whenever part of the period went ungraded.
    unit: "Share of the period's graded AI spend held by the largest query class, percent, "
      + "one decimal. Departments the rubric could not grade are outside the denominator.",
    source: summarize,
    sourceModule: "evolution.js",
    threshold: 40,
    thresholdRule: "Called out when the largest query class holds at least 40.0% of graded spend.",
    action: "Take the largest class to the teams producing it before any other line on this page.",
    measure: measureSpendMix,
    crosses: (value) => value >= 40,
  }),
  Object.freeze({
    key: "departmentRank",
    name: "Department rank",
    question: "Which department should the lead talk to first?",
    unit: "Rank position (integer, 1 = highest spend), reported with that department's share of "
      + "period spend, percent, one decimal.",
    source: buildSpendMix,
    sourceModule: "attribution-units.js",
    threshold: 30,
    thresholdRule: "Called out when the rank-1 department holds at least 30.0% of period spend.",
    action: "Book the rank-1 department first; it holds enough of the budget to move the total.",
    measure: measureDepartmentRank,
    crosses: (value) => value >= 30,
  }),
  Object.freeze({
    key: "movement",
    name: "Month-over-month movement",
    question: "Is spend accelerating or settling?",
    unit: "Signed percent change of period spend against the prior full month, one decimal.",
    source: periodMovement,
    sourceModule: "finops-imported-period-series.js",
    threshold: 10,
    thresholdRule: "Called out when the absolute change is at least 10.0%.",
    action: "Find what changed between the two months before committing to a savings target.",
    measure: measureMovement,
    crosses: (value) => Math.abs(value) >= 10,
  }),
  Object.freeze({
    key: "peerPosition",
    name: "Peer position",
    question: "Are we out of line with comparable organisations?",
    unit: "Quartile 1–4 of cost per unit against the matched peer cohort, 4 = worst. Reported "
      + "only when the ranking model reports the claim as supported.",
    source: evaluateRankingReproducibility,
    sourceModule: "ranking-reproducibility.js",
    threshold: 4,
    thresholdRule: "Called out when the quartile is 4, and only when the ranking model reports the "
      + "claim as supported.",
    action: "Compare cost per successful task with the cohort boundaries before defending the "
      + "current run rate.",
    measure: measurePeerPosition,
    crosses: (value) => value === 4,
  }),
]);

/**
 * Measure all four, in spec order.
 *
 * An unmeasured figure is forced to `crossed: false` here rather than at each
 * call site: "an unmeasured figure never crosses and never leads" is one rule,
 * and a rule spread over four `if`s is four chances to forget one.
 */
export function measureGlanceFigures({ analysis = null, reproducibility = null } = {}) {
  return Object.freeze(GLANCE_FIGURES.map((figure) => {
    const reading = figure.measure(analysis, reproducibility);
    const crossed = reading.measured && reading.value !== null && figure.crosses(reading.value);
    return Object.freeze({
      key: figure.key,
      name: figure.name,
      question: figure.question,
      unit: figure.unit,
      threshold: figure.threshold,
      action: figure.action,
      measured: reading.measured,
      value: reading.value,
      display: reading.display,
      reason: reading.reason,
      crossed,
      /** The plain numbers this figure can be drawn from. Empty when unmeasured. */
      series: Object.freeze(reading.series ?? []),
      /** The one line this figure renders as, lead or supporting. */
      line: reading.measured
        ? `${figure.name} · ${figure.question} ${reading.display}.`
        : `${figure.name} · ${figure.question} ${GLANCE_UNMEASURED}: ${reading.reason}`,
    });
  }));
}

/**
 * The block: one lead, one next action, and the rest as supporting lines.
 *
 * THE SELECTION RULE, in full: the lead is the first figure in `GLANCE_FIGURES`
 * order that is measured AND crosses its own threshold. There is no weighting,
 * no severity score and no tie-break, because there is nothing to tie: the order
 * is total. When no measured figure crosses, the block says so and that is the
 * next action; all four then render as supporting lines.
 */
export function composeFinopsGlance({ analysis = null, reproducibility = null } = {}) {
  const figures = measureGlanceFigures({ analysis, reproducibility });
  const lead = figures.find((figure) => figure.crossed) ?? null;
  return Object.freeze({
    version: GLANCE_VERSION,
    question: GLANCE_QUESTION,
    figures,
    leadKey: lead?.key ?? null,
    lead: lead ? lead.line : GLANCE_NO_LEAD.lead,
    nextAction: lead ? lead.action : GLANCE_NO_LEAD.action,
    crossed: Boolean(lead),
    supporting: Object.freeze(figures.filter((figure) => figure !== lead).map((f) => f.line)),
  });
}
