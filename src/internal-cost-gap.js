// Which internal department is furthest behind, in the same units as the peer
// position.
//
// THE ONE QUESTION
// ----------------
//   "Inside this organization, how far apart are the cheapest and the most
//    expensive department on cost per successful task?"
//
// It is the org-level peer question turned inward, and it is deliberately ONE
// consolidated answer — a leader and a laggard and the distance between them —
// rather than a list of per-department alerts. A list of alerts is a queue
// nobody works; one pair is a decision.
//
// NOTHING HERE IS A SECOND RUBRIC
// -------------------------------
// The metric, the band boundaries, and the eligibility ordering are imported
// from `peer-cost-position.js` and used unmodified, so an internal gap and a
// peer gap are literally in the same units:
//
//   * THE METRIC is `costPerSuccessfulTask` — the same function, with the same
//     null-not-zero contract. Spend per department is the analysis envelope's
//     own `spendUsd` for that department; successes are counted with
//     `countSuccessfulTasks` over the ledger rows that carry that department's
//     id. Nothing here recomputes spend and nothing here re-counts successes by
//     a different rule.
//   * THE BANDS come from `bandFor` against the SAME cohort record the org was
//     placed in. The cohort is not re-selected here: this module calls
//     `resolveCostPosition` and reads the cohort off the resolved position, so
//     there is exactly one cohort-matching rule on the page and no way for the
//     two answers to be banded against different boundaries.
//   * THE ELIGIBILITY FLOOR is the org path's own: a department whose metric
//     comes back null from `costPerSuccessfulTask` is not eligible, for the same
//     reason the org is not positioned when its denominator is zero.
//
// The one rule that is NOT inherited is `INTERNAL_MINIMUM_SUCCESSFUL_TASKS`. The
// org path has no sample floor because it has exactly one subject; splitting the
// same window across departments makes a per-department denominator small enough
// that a single retried task moves a band. So a minimum is declared here, as a
// number rather than as a judgement call in prose, it applies only to this
// internal comparison, and the org-level result is untouched by it.
//
// SUPPRESSION IS AN OUTCOME, NOT AN EXCEPTION
// -------------------------------------------
// This function does not throw. A partial import, an envelope with no department
// dimension, a window where only one department clears the floor, and a spread
// that never leaves one band all resolve to `status: "suppressed"` with a
// specific sentence naming the real numbers involved. "Suppressed" with no
// reason is not a state this module can reach.
//
// LOCALITY. Pure arithmetic over an already-normalized envelope and a task
// ledger. No storage, clock, network, credential, or DOM.

import {
  bandFor, COST_BAND, COST_BAND_DIRECTION, COST_BAND_LABEL, COST_METRIC,
  COST_POSITION_VERSION, costPerSuccessfulTask, countSuccessfulTasks,
  displayCostPerSuccessfulTask, resolveCostPosition,
} from "./peer-cost-position.js";

/** Bump when a suppression rule, a reason string, or the returned shape changes. */
export const INTERNAL_GAP_VERSION = "finops-internal-cost-gap/1.0.0";

/** The question this module answers. One, and it is the peer question turned inward. */
export const INTERNAL_GAP_QUESTION =
  "Inside this organization, which department is furthest behind on cost per successful task?";

/**
 * The per-department sample floor.
 *
 * Twelve successful tasks, not one: at a denominator of a handful, one retried
 * task moves the metric by more than the width of a band, and a "finding" that
 * turns over on a single row is noise wearing a rubric's clothes. It is stated
 * as a number so the suppression sentence can quote it back rather than saying
 * "not enough data", and it is scoped to this internal comparison only — the
 * org-level position published by `resolveCostPosition` does not read it.
 */
export const INTERNAL_MINIMUM_SUCCESSFUL_TASKS = 12;

/** The two statuses. There is no third, and no exception path. */
export const INTERNAL_GAP_STATUS = Object.freeze({
  finding: "finding",
  suppressed: "suppressed",
});

/** Suppression reason codes. Wire values; the sentences are composed per case. */
export const INTERNAL_GAP_SUPPRESSED = Object.freeze({
  orgPositionWithheld: "org_position_withheld",
  noDepartmentField: "no_department_field",
  tooFewEligible: "too_few_eligible_departments",
  withinOneBand: "gap_within_one_band",
});

/**
 * Band order, worst last. Published as data because `gapBands` is the difference
 * of two positions in it, and an implicit ordering is one a surface can invert.
 */
export const BAND_ORDER = Object.freeze([COST_BAND.top, COST_BAND.middle, COST_BAND.bottom]);

const BAND_RANK = Object.freeze(Object.fromEntries(BAND_ORDER.map((band, index) => [band, index])));

/** The field every ledger row is grouped by. Published so provenance can name it. */
export const DEPARTMENT_ROW_SELECTOR = "orgUnitId";

/** "2026-06-01 to 2026-07-01" → the two days. Nulls rather than guesses. */
function periodRange(period) {
  const match = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(String(period ?? "").trim());
  return Object.freeze({ start: match ? match[1] : null, end: match ? match[2] : null });
}

function provenanceFor(period, cohort, values) {
  return Object.freeze({
    rubricVersion: COST_POSITION_VERSION,
    metricId: COST_METRIC.id,
    /** The rule that selected the rows, not a copy of them. */
    rowSelector: Object.freeze({ field: DEPARTMENT_ROW_SELECTOR, values: Object.freeze(values) }),
    rowCount: values.length,
    dateRange: periodRange(period),
    cohortId: cohort?.cohortId ?? null,
    snapshotId: cohort?.snapshotId ?? null,
  });
}

function suppressed(code, reason, { period = null, cohort = null } = {}) {
  return Object.freeze({
    version: INTERNAL_GAP_VERSION,
    question: INTERNAL_GAP_QUESTION,
    metric: COST_METRIC,
    status: INTERNAL_GAP_STATUS.suppressed,
    leader: null,
    laggard: null,
    gapBands: null,
    gapValue: null,
    suppressedCode: code,
    suppressedReason: reason,
    eligibleCount: 0,
    minimumSuccessfulTasks: INTERNAL_MINIMUM_SUCCESSFUL_TASKS,
    provenance: provenanceFor(period, cohort, []),
  });
}

/**
 * Successful tasks per department id.
 *
 * The rows are filtered by department and then handed to the shared
 * `countSuccessfulTasks`, rather than re-implementing the outcome rule here: a
 * second copy of "which outcome counts" is exactly how an internal figure and an
 * org figure start disagreeing.
 */
function successesByDepartment(tasks) {
  const byId = new Map();
  if (!Array.isArray(tasks)) return byId;
  for (const row of tasks) {
    const id = row?.[DEPARTMENT_ROW_SELECTOR];
    if (typeof id !== "string" || !id.trim()) continue;
    const bucket = byId.get(id) ?? [];
    bucket.push(row);
    byId.set(id, bucket);
  }
  return new Map([...byId].map(([id, rows]) => [id, countSuccessfulTasks(rows)]));
}

/** One side of the pair, in the shape both sides use. */
function side(department, metricValue, band, successfulTasks) {
  return Object.freeze({
    department: department.name,
    departmentId: department.id,
    metricValue,
    metricDisplay: displayCostPerSuccessfulTask(metricValue),
    band,
    bandLabel: COST_BAND_LABEL[band],
    /** Contributing billing rows — the provenance count, not the denominator. */
    recordCount: Number.isInteger(department.records) ? department.records : 0,
    successfulTasks,
  });
}

/**
 * Resolve the one consolidated internal gap, or suppress it with a reason.
 *
 * The conditions are checked in a fixed order and the FIRST failure wins, so two
 * engineers reading the same broken input report the same cause:
 *
 *   1. the shared rubric can place the ORG at all (same cohort, same metric),
 *   2. the envelope carries a department dimension and the ledger carries the
 *      department selector,
 *   3. at least two departments clear the sample floor, and
 *   4. the best and worst of them are not in the same band.
 *
 * @param analysis the already-normalized envelope the org-level path consumes.
 * @param org `{ sizeBand, industry, snapshotId }` — declared, never inferred.
 * @param tasks the window's task ledger; rows carry `orgUnitId`, `outcome`, `count`.
 */
export function resolveInternalCostGap({ analysis = null, org = null, tasks = null } = {}) {
  const period = analysis?.period ?? null;
  // The org position first, and not as a formality: it is what selects the
  // cohort. A page that cannot place the org against published boundaries cannot
  // place a department against them either, and saying so in the org path's own
  // words is more useful than inventing a second sentence for the same fact.
  const position = resolveCostPosition({
    org, spendUsd: Number(analysis?.spendUsd), tasks,
  });
  if (!position.available) {
    return suppressed(INTERNAL_GAP_SUPPRESSED.orgPositionWithheld,
      `No internal comparison: the shared peer rubric could not place this organization. ${position.reason}`,
      { period });
  }
  const cohort = position.cohort;

  const departments = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments : [];
  const successes = successesByDepartment(tasks);
  if (!departments.length || successes.size === 0) {
    return suppressed(INTERNAL_GAP_SUPPRESSED.noDepartmentField,
      "No internal comparison: these records carry no department dimension, so there is nothing "
      + `to compare inside the organization. The ledger rows must carry ${DEPARTMENT_ROW_SELECTOR}.`,
      { period, cohort });
  }

  const eligible = [];
  const shortfalls = [];
  for (const department of departments) {
    const id = department?.id;
    if (typeof id !== "string" || !id.trim()) continue;
    const successfulTasks = successes.get(id) ?? 0;
    // The org path's own predicate: an undefined metric is not a zero and not a
    // low score, it is a department that cannot be ranked at all.
    const metricValue = costPerSuccessfulTask(Number(department.spendUsd), successfulTasks);
    if (metricValue === null || successfulTasks < INTERNAL_MINIMUM_SUCCESSFUL_TASKS) {
      shortfalls.push({ name: department.name ?? id, successfulTasks });
      continue;
    }
    const band = bandFor(metricValue, cohort);
    if (band === null) continue;
    eligible.push(side(department, metricValue, band, successfulTasks));
  }

  if (eligible.length < 2) {
    // The nearest miss, named with its real numbers. "Not enough data" tells a
    // reader nothing they can act on; "Ember has 4 successful tasks; 12 needed"
    // tells them exactly how far off the floor they are and in which unit.
    const nearest = shortfalls
      .sort((left, right) => right.successfulTasks - left.successfulTasks
        || String(left.name).localeCompare(String(right.name)))[0] ?? null;
    const detail = nearest
      ? ` ${nearest.name} has ${nearest.successfulTasks} successful task${
        nearest.successfulTasks === 1 ? "" : "s"}; ${INTERNAL_MINIMUM_SUCCESSFUL_TASKS} needed.`
      : "";
    return suppressed(INTERNAL_GAP_SUPPRESSED.tooFewEligible,
      `No internal comparison: ${eligible.length} of ${departments.length} departments clear the `
      + `${INTERNAL_MINIMUM_SUCCESSFUL_TASKS}-successful-task floor, and two are needed to state a gap.${detail}`,
      { period, cohort });
  }

  // Deterministic without reference to input order: cheapest first, ties broken
  // by department id. Two runs over the same rows in any order pick the same
  // pair, which is what makes the finding re-derivable from the provenance.
  const ranked = [...eligible].sort((left, right) => left.metricValue - right.metricValue
    || left.departmentId.localeCompare(right.departmentId));
  const leader = ranked[0];
  const laggard = ranked[ranked.length - 1];
  const gapBands = BAND_RANK[laggard.band] - BAND_RANK[leader.band];
  const gapValue = Math.round((laggard.metricValue - leader.metricValue) * 100) / 100;

  if (gapBands < 1) {
    return suppressed(INTERNAL_GAP_SUPPRESSED.withinOneBand,
      `No internal comparison: all ${eligible.length} eligible departments sit in the same band `
      + `(${leader.bandLabel}), so the spread of ${displayCostPerSuccessfulTask(gapValue)} per `
      + "successful task is inside one band and is not a difference this rubric can call a gap.",
      { period, cohort });
  }

  return Object.freeze({
    version: INTERNAL_GAP_VERSION,
    question: INTERNAL_GAP_QUESTION,
    metric: COST_METRIC,
    status: INTERNAL_GAP_STATUS.finding,
    leader,
    laggard,
    gapBands,
    gapValue,
    suppressedCode: null,
    suppressedReason: null,
    eligibleCount: eligible.length,
    minimumSuccessfulTasks: INTERNAL_MINIMUM_SUCCESSFUL_TASKS,
    provenance: provenanceFor(period, cohort, [leader.departmentId, laggard.departmentId]),
  });
}

/** "a full band" / "two full bands", so no surface has to pluralize a rubric. */
export function bandDistanceWords(gapBands) {
  if (!Number.isInteger(gapBands) || gapBands < 1) return null;
  return gapBands === 1 ? "a full band" : `${gapBands} full bands`;
}

/**
 * The finding as one line, in the same register as the org-level position: who
 * is behind whom, by how far, on which metric.
 */
export function internalGapHeadline(result) {
  if (result?.status !== INTERNAL_GAP_STATUS.finding) return null;
  return `${result.laggard.department} is ${bandDistanceWords(result.gapBands)} behind `
    + `${result.leader.department} on ${COST_METRIC.label.toLowerCase()}`;
}

/**
 * The sentence under it: both sides with their record counts, which way is
 * better, and the provenance a later pass needs to recompute this without
 * re-importing anything.
 */
export function internalGapDetail(result) {
  if (result?.status !== INTERNAL_GAP_STATUS.finding) return null;
  const { leader, laggard, provenance } = result;
  const window = provenance.dateRange.start && provenance.dateRange.end
    ? ` over ${provenance.dateRange.start} to ${provenance.dateRange.end}`
    : "";
  return `${laggard.department} ${laggard.metricDisplay} · ${laggard.bandLabel} · `
    + `${laggard.successfulTasks} successful tasks across ${laggard.recordCount} records. `
    + `${leader.department} ${leader.metricDisplay} · ${leader.bandLabel} · `
    + `${leader.successfulTasks} successful tasks across ${leader.recordCount} records. `
    + `${COST_BAND_DIRECTION} `
    + `Same rubric as the peer position above: ${provenance.metricId} · ${provenance.rubricVersion} · `
    + `cohort ${provenance.cohortId} · snapshot ${provenance.snapshotId}${window}.`;
}
