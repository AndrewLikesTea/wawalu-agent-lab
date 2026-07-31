// Where this organization's AI spend ranks, not what it costs.
//
// THE ONE QUESTION
// ----------------
//   "Among comparable organizations, is this org's cost per successful task
//    high or low?"
//
// That is the whole contract. There is deliberately no second comparison axis,
// no trend-over-time comparison, no per-model breakdown, and no rank-among-N
// list: each of those is a different question, and a slot that answers four
// questions answers none of them at a glance.
//
// THE METRIC, defined so two engineers compute it identically
// -----------------------------------------------------------
//   cost_per_successful_task = total attributed AI spend in USD over the
//   snapshot window ÷ count of tasks in that window whose terminal outcome is
//   success.
//
//   * NUMERATOR. The page's existing headline spend total for the window,
//     handed in by the caller. This module never recomputes spend from another
//     source and never adjusts it: the number under the position is the same
//     number printed above it.
//   * DENOMINATOR. Successes only. Failed and abandoned tasks are excluded from
//     the denominator while their spend REMAINS in the numerator — that is the
//     point of the metric, and it is why a org that pays repeatedly for retries
//     ranks worse than one that does not. Tasks still in a non-terminal state
//     at the snapshot boundary are excluded from the denominator entirely: they
//     are neither successes nor failures yet, and counting them either way
//     would move the metric on nothing but the clock.
//   * WINDOW. The same snapshot window the page's other headline figures use.
//     There is no second window in this module and no way to pass one.
//   * ROUNDING. Computed at full precision. Rounding happens once, at display,
//     to cents. Band assignment reads the unrounded value, so a value that
//     rounds onto a boundary is not moved across it by the rounding.
//   * DEGENERATE CASE. A zero denominator makes the metric undefined, and an
//     undefined metric produces no position at all — never a zero, never an
//     infinity, never a dash.
//
// THE BANDS
// ---------
// Quartiles of the matched cohort's published distribution, read as the two
// boundary numbers the cohort record carries. Lower cost is better, so:
//
//     value <= p25                  → top quartile     (cheapest)
//     value >  p25 and value < p75  → middle range
//     value >= p75                  → bottom quartile  (most expensive)
//
// Both boundaries are inclusive on the favorable side as written, so p25 and
// p75 each belong to exactly one band and no value is claimed by two.
//
// WITHHOLDING
// -----------
// A position is produced only when every eligibility condition holds. When one
// fails, this module returns a null band and a readable reason as a separate
// field, so a caller can always tell "withheld, here is why" from "positioned".
// The bare word "Unavailable" is not a reason and this module never emits it.
//
// LOCALITY. Pure arithmetic over the published cohorts and one roll-up handed
// in by the caller. No storage, clock, network, credential, or DOM.

import {
  ORG_SIZE_BAND, ORG_SIZE_BAND_LABEL, PEER_COST_COHORTS, PEER_COST_PROVENANCE,
  PEER_COST_SNAPSHOT_ID, PEER_INDUSTRY, PEER_INDUSTRY_LABEL,
} from "./peer-cost-cohorts.js";

export {
  ORG_SIZE_BAND, ORG_SIZE_BAND_LABEL, PEER_COST_COHORTS, PEER_COST_PROVENANCE,
  PEER_COST_SNAPSHOT_ID, PEER_INDUSTRY, PEER_INDUSTRY_LABEL,
} from "./peer-cost-cohorts.js";

/** Bump when a metric definition, a band rule, a reason code, or a reason string changes. */
export const COST_POSITION_VERSION = "finops-cost-position/1.0.0";

/** The question this module answers. One, and it is not derived. */
export const COST_POSITION_QUESTION =
  "Among comparable organizations, is this org's cost per successful task high or low?";

/** The metric, published as data so a surface cannot restate it in its own words. */
export const COST_METRIC = Object.freeze({
  id: "cost_per_successful_task",
  label: "Cost per successful task",
  unit: "USD per successful task",
  /** Display precision only. Band assignment reads the unrounded value. */
  decimals: 2,
  definition: "Total AI spend in USD attributed to the organization over the snapshot window, "
    + "divided by the count of tasks in that window whose terminal outcome is success. Failed "
    + "and abandoned tasks are excluded from the denominator and their spend stays in the "
    + "numerator; tasks not yet in a terminal state are excluded from both.",
});

// ---------------------------------------------------------------------------
// Task outcomes. Terminal and non-terminal are named separately, because the
// denominator rule turns entirely on which is which.
// ---------------------------------------------------------------------------

/** The terminal outcomes. A task in one of these will not change again. */
export const TASK_OUTCOME = Object.freeze({
  success: "success",
  failed: "failed",
  abandoned: "abandoned",
});

/** Not yet terminal. Counted in neither the numerator's peers nor the denominator. */
export const TASK_NON_TERMINAL_OUTCOME = Object.freeze({
  running: "running",
  queued: "queued",
});

const TERMINAL = new Set(Object.values(TASK_OUTCOME));

/**
 * Count the successful tasks in a ledger.
 *
 * A row is either one task or a tally of identical ones: `count` defaults to 1,
 * so a test can hand this individual task records and the seeded sample data
 * can hand it grouped tallies without the two disagreeing about the rule.
 *
 * Anything that is not the exact success outcome contributes nothing — an
 * unrecognised outcome string is not quietly treated as a failure, it is simply
 * not a success, which is the only claim this count is entitled to make.
 */
export function countSuccessfulTasks(tasks) {
  if (!Array.isArray(tasks)) return 0;
  let total = 0;
  for (const row of tasks) {
    if (row?.outcome !== TASK_OUTCOME.success) continue;
    const count = row.count === undefined ? 1 : row.count;
    if (!Number.isInteger(count) || count < 0) continue;
    total += count;
  }
  return total;
}

/** True when a row has reached an outcome it will not leave. Published for callers. */
export function isTerminalOutcome(outcome) {
  return TERMINAL.has(outcome);
}

/**
 * The metric itself. Null — never zero, never Infinity — when it is undefined.
 *
 * Full precision on purpose: the caller rounds for display, and the band reads
 * this value.
 */
export function costPerSuccessfulTask(spendUsd, successfulTasks) {
  if (!Number.isFinite(spendUsd) || spendUsd < 0) return null;
  if (!Number.isInteger(successfulTasks) || successfulTasks <= 0) return null;
  return spendUsd / successfulTasks;
}

/** The metric as a reader sees it: cents, once, at the end. */
export function displayCostPerSuccessfulTask(value) {
  if (!Number.isFinite(value)) return null;
  return `$${value.toFixed(COST_METRIC.decimals)}`;
}

// ---------------------------------------------------------------------------
// The bands.
// ---------------------------------------------------------------------------

export const COST_BAND = Object.freeze({
  top: "top_quartile",
  middle: "middle_range",
  bottom: "bottom_quartile",
});

/**
 * The band labels.
 *
 * "Top quartile" is the CHEAPEST quartile, and every sentence this module emits
 * says which way is better in the same breath, because a leader who reads a
 * high dollar figure beside the word "top" would otherwise have every reason to
 * read it as a good result.
 */
export const COST_BAND_LABEL = Object.freeze({
  [COST_BAND.top]: "Top quartile",
  [COST_BAND.middle]: "Middle range",
  [COST_BAND.bottom]: "Bottom quartile",
});

/** The direction, stated once, so no surface has to infer it. */
export const COST_BAND_DIRECTION = "Lower cost per successful task is better.";

/**
 * The one name every surface gives this comparison.
 *
 * It lives beside the band it labels because two surfaces render it — the
 * headline region and the first-run brief below it — and they were calling one
 * number "Peer position" and "Peer comparison". Neither name told a first-time
 * reader what they were about to be told; this one does, and there is now only
 * one place to change it.
 */
export const PEER_RANK_LABEL = "Rank against similar organizations";

export const COST_BAND_MEANING = Object.freeze({
  [COST_BAND.top]: "cheapest quarter of the cohort",
  [COST_BAND.middle]: "middle half of the cohort",
  [COST_BAND.bottom]: "most expensive quarter of the cohort",
});

/**
 * Assign a band. Boundaries are inclusive on the favorable side: a value
 * exactly at p25 is top quartile, a value exactly at p75 is bottom quartile,
 * and the middle range is the open interval strictly between them.
 */
export function bandFor(value, cohort) {
  if (!Number.isFinite(value)) return null;
  const p25 = cohort?.p25;
  const p75 = cohort?.p75;
  if (!Number.isFinite(p25) || !Number.isFinite(p75) || !(p25 < p75)) return null;
  if (value <= p25) return COST_BAND.top;
  if (value >= p75) return COST_BAND.bottom;
  return COST_BAND.middle;
}

// ---------------------------------------------------------------------------
// Eligibility. Reason codes are wire values; the sentences beside them are the
// exact strings the slot renders in place of a band.
// ---------------------------------------------------------------------------

export const COST_POSITION_WITHHELD = Object.freeze({
  missingAttributes: "missing_cohort_attributes",
  noMatchingCohort: "no_matching_cost_cohort",
  ambiguousMatch: "ambiguous_cost_cohort_match",
  noSuccessfulTasks: "no_successful_tasks",
  snapshotMismatch: "cost_cohort_snapshot_mismatch",
  noSpendTotal: "no_attributed_spend_total",
});

export const COST_POSITION_REASON = Object.freeze({
  [COST_POSITION_WITHHELD.missingAttributes]:
    "No peer position: this org has not declared its size band and industry.",
  [COST_POSITION_WITHHELD.noMatchingCohort]:
    "No peer position: no published cohort matches this org's size band and industry.",
  [COST_POSITION_WITHHELD.ambiguousMatch]:
    "No peer position: more than one published cohort matches this org's size band and industry.",
  [COST_POSITION_WITHHELD.noSuccessfulTasks]:
    "No peer position: no successful tasks in this snapshot window.",
  [COST_POSITION_WITHHELD.snapshotMismatch]:
    "No peer position: cohort reference data is from a different snapshot than this org's data.",
  // Not one of the five eligibility failures the question defines — it is the
  // case where the page itself produced no headline spend total to divide. It
  // is named separately rather than reported as "no successful tasks", because
  // telling a reader their tasks all failed when the spend figure is what went
  // missing is a false statement about their data.
  [COST_POSITION_WITHHELD.noSpendTotal]:
    "No peer position: this snapshot published no attributed AI spend total to compare.",
});

/**
 * Every published cohort matching both declared attributes.
 *
 * Reads `PEER_COST_COHORTS` from module scope and takes no cohort argument, by
 * design: there is no parameter, override, or option on this module through
 * which an imported or uploaded file could reach the cohort table.
 */
export function matchingCostCohorts(sizeBand, industry) {
  return PEER_COST_COHORTS.filter(
    (entry) => entry.sizeBand === sizeBand && entry.industry === industry);
}

function declared(value, published) {
  return typeof value === "string" && Object.values(published).includes(value) ? value : null;
}

function withheld(code, { sizeBand = null, industry = null, cohort = null, value = null } = {}) {
  return Object.freeze({
    version: COST_POSITION_VERSION,
    question: COST_POSITION_QUESTION,
    metric: COST_METRIC,
    available: false,
    /** Null, never a band value: "withheld" is not a position. */
    band: null,
    bandLabel: null,
    value,
    valueDisplay: displayCostPerSuccessfulTask(value),
    cohort: cohort ? cohortSummary(cohort) : null,
    declaredSizeBand: sizeBand,
    declaredIndustry: industry,
    reasonCode: code,
    reason: COST_POSITION_REASON[code],
    provenance: PEER_COST_PROVENANCE,
  });
}

function cohortSummary(cohort) {
  return Object.freeze({
    cohortId: cohort.cohortId,
    label: cohort.label,
    sizeBand: cohort.sizeBand,
    sizeBandLabel: ORG_SIZE_BAND_LABEL[cohort.sizeBand],
    industry: cohort.industry,
    industryLabel: PEER_INDUSTRY_LABEL[cohort.industry],
    p25: cohort.p25,
    p75: cohort.p75,
    snapshotId: cohort.snapshotId,
  });
}

/**
 * Resolve one organization's position, or withhold it with a reason.
 *
 * The conditions are checked in a fixed order and the FIRST failure wins, so
 * two engineers reading the same broken input report the same cause:
 *
 *   1. both cohort attributes declared,
 *   2. exactly one published cohort matches them,
 *   3. the snapshot identifiers agree,
 *   4. a spend total exists, and
 *   5. the denominator is above zero.
 *
 * Conditions 3–5 are checked after a cohort is selected because each of them
 * needs one: a snapshot cannot disagree with a record that was never found.
 *
 * @param org `{ sizeBand, industry, snapshotId }` — declared, never inferred.
 * @param spendUsd the page's existing headline spend total for the window.
 * @param tasks the window's task ledger; rows carry `outcome` and optional `count`.
 */
export function resolveCostPosition({ org = null, spendUsd = null, tasks = null } = {}) {
  const sizeBand = declared(org?.sizeBand, ORG_SIZE_BAND);
  const industry = declared(org?.industry, PEER_INDUSTRY);
  if (!sizeBand || !industry) {
    return withheld(COST_POSITION_WITHHELD.missingAttributes, { sizeBand, industry });
  }
  const matches = matchingCostCohorts(sizeBand, industry);
  if (matches.length === 0) {
    return withheld(COST_POSITION_WITHHELD.noMatchingCohort, { sizeBand, industry });
  }
  if (matches.length > 1) {
    return withheld(COST_POSITION_WITHHELD.ambiguousMatch, { sizeBand, industry });
  }
  const cohort = matches[0];
  if (org?.snapshotId !== cohort.snapshotId) {
    return withheld(COST_POSITION_WITHHELD.snapshotMismatch, { sizeBand, industry, cohort });
  }
  if (!Number.isFinite(spendUsd) || spendUsd < 0) {
    return withheld(COST_POSITION_WITHHELD.noSpendTotal, { sizeBand, industry, cohort });
  }
  const successfulTasks = countSuccessfulTasks(tasks);
  const value = costPerSuccessfulTask(spendUsd, successfulTasks);
  if (value === null) {
    return withheld(COST_POSITION_WITHHELD.noSuccessfulTasks, { sizeBand, industry, cohort });
  }
  const band = bandFor(value, cohort);
  return Object.freeze({
    version: COST_POSITION_VERSION,
    question: COST_POSITION_QUESTION,
    metric: COST_METRIC,
    available: true,
    band,
    bandLabel: COST_BAND_LABEL[band],
    bandMeaning: COST_BAND_MEANING[band],
    direction: COST_BAND_DIRECTION,
    /** Full precision. `valueDisplay` is the only rounded form. */
    value,
    valueDisplay: displayCostPerSuccessfulTask(value),
    successfulTasks,
    spendUsd,
    cohort: cohortSummary(cohort),
    declaredSizeBand: sizeBand,
    declaredIndustry: industry,
    reasonCode: null,
    reason: null,
    provenance: PEER_COST_PROVENANCE,
  });
}

/**
 * The position as one line a leader can repeat to a peer without hunting: the
 * band, the metric to cents, and the cohort it was compared against.
 */
export function costPositionHeadline(position) {
  if (!position?.available) return null;
  return `${position.bandLabel} · ${position.valueDisplay} per successful task`;
}

/** The sentence under it: which cohort, and which way is better. */
export function costPositionDetail(position) {
  if (!position?.available) return null;
  const { cohort } = position;
  return `Compared against the published cohort ${cohort.label} — quartile boundaries `
    + `${displayCostPerSuccessfulTask(cohort.p25)} and ${displayCostPerSuccessfulTask(cohort.p75)} `
    + `per successful task. ${COST_BAND_DIRECTION} `
    + `This org sits in the ${COST_BAND_MEANING[position.band]}.`;
}
