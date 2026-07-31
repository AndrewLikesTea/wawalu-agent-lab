// "Can this export be graded?" — the gate the answer region passes before it
// quotes a figure out of a reader's own file.
//
// THE PROBLEM THIS SOLVES. `grade-eligibility.js` already answers "is this grade
// representative of our spend?" for the score card. The answer region on
// /evolution.html asks a narrower question one step earlier: a FinOps lead has
// just imported an export and wants to know whether the page may say anything at
// all about it. Before this module the region answered that question by
// implication — it painted a recoverable figure and a named department whatever
// the import carried, so an export the rubric had barely touched produced a
// headline that looked exactly like an export it had covered end to end.
//
// So this module publishes one verdict with four states, and the region reads it
// rather than deciding per slot.
//
// ---------------------------------------------------------------------------
// Metric definition. Two engineers reading this must produce the same number.
// ---------------------------------------------------------------------------
//
//   sampled_spend_coverage
//                     `sampledSpendCoverage` in `grade-eligibility.js`, taken
//                     through `gradeEligibility(departments)` — covered spend
//                     over total imported spend, where a department is covered
//                     exactly when `departmentPerformance` returns
//                     `available: true`. NOTHING IS RECOMPUTED HERE. This module
//                     imports that verdict; it does not re-sum a department, and
//                     there is no second arithmetic path to inject one into.
//
//   COVERAGE_BAR      the coverage at or above which a grade may be published,
//                     DERIVED from `COVERAGE_TIERS` rather than typed a second
//                     time: the lowest floor among the tiers whose state is
//                     `graded`. Moving a threshold in `grade-eligibility.js`
//                     moves this bar with it, which is the only way the two
//                     surfaces can be held to one number.
//
//   rows read         every department row in the analysed set, including the
//                     rows the rubric did not score and the rows carrying no
//                     spend. It is a count of what was read, not of what
//                     counted, and the disclosure says so — a row count that
//                     silently meant "scored rows" would make a thin import look
//                     like a thorough one.
//
// A total of zero, a negative total, or a missing one is NOT a coverage of 0%.
// It is `no_baseline`: there is no denominator, so no percentage is printed and
// the state says which input is missing instead.
//
// ---------------------------------------------------------------------------
// Deliberate omissions
// ---------------------------------------------------------------------------
//
// * NO SECOND THRESHOLD. Every boundary is `grade-eligibility.js`'s, imported.
// * NO NAMED STRUCTURAL FIELD IN THE ACTION. State C tells a lead to re-pull the
//   export with the missing input and then quotes the evaluator's own reason for
//   the department that lost the most spend. It does not name the column, header
//   or field that would fix it, because no evaluator on this page publishes one:
//   inventing a plausible field name would send a lead to their provider console
//   looking for something this product never checked for.
// * NO PER-DEPARTMENT LIST. Exactly one cluster is named. The full ranking is
//   already one step away under "Every department, ranked".

import { departmentPerformance, summarize } from "./evolution.js";
import { COVERAGE_TIERS, gradeEligibility } from "./grade-eligibility.js";
// The reason copy only, for the one department the action names. The codes and
// their sentences are `query-literacy.js`'s; this module quotes them and writes
// none of its own.
import { NOT_GRADEABLE_COPY, NOT_GRADEABLE_REASONS } from "./query-gradeability-reasons.js";

/**
 * The analysis's own literacy verdict, when it published one.
 *
 * An analysis produced by this page's pipeline carries an `analyzeQueryLiteracy`
 * result: the per-department grades, the reason each ungraded department was
 * refused, the named missing input, and the organization's eligibility verdict.
 * Every one of those is the measurement this module needs, already taken. Reading
 * it is what keeps "nothing is recomputed here" true rather than aspirational;
 * the department-by-department fallback below exists only for an analysis that
 * predates it or was hand-built by a caller.
 */
function literacyOf(analysis) {
  const literacy = analysis?.literacy ?? null;
  return literacy && Array.isArray(literacy.departments) && literacy.eligibility
    ? literacy : null;
}

/** Bump when a state, the bar, or what a state means changes. Copy may be reworded. */
export const EXPORT_GRADABILITY_VERSION = "export-gradability/1.0.0";

/** The question this module answers, in the lead's own words. It answers no other. */
export const GRADABILITY_QUESTION = "Can this export be graded?";

/**
 * The bar, derived from the published tiers rather than restated.
 *
 * The lowest coverage floor whose tier still calls the result graded — 0.50
 * today, because `COVERAGE_TIERS` puts `moderate` there. Nothing in this file
 * may hard-code a percentage; a reader disputing the bar should land in
 * `grade-eligibility.js`, which is where the thresholds are published as data.
 */
export const COVERAGE_BAR = Math.min(
  ...COVERAGE_TIERS.filter((tier) => tier.state === "graded").map((tier) => tier.floor));

/**
 * The four states, in the order they are selected. One state per verdict, and a
 * reader is always in exactly one of them.
 *
 *   graded       coverage at or above the bar. The figures on the answer region
 *                stand as they are.
 *   provisional  under the bar, but the evaluator still publishes a grade
 *                (`showGrade`). The figures stand, marked not actionable alone.
 *   belowBar     under the floor the evaluator publishes anything at. The
 *                figures are suppressed rather than shown with a caveat.
 *   noBaseline   no positive spend total, so coverage has no denominator. Not
 *                a coverage of zero, and never printed as 0%.
 */
export const GRADABILITY_STATE = Object.freeze({
  graded: "graded",
  provisional: "provisional",
  belowBar: "below_bar",
  noBaseline: "no_baseline",
});

const PERCENT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const percent = (ratio) => PERCENT.format(ratio);

/** The imperative each state leads with. The reason clause is appended, never woven in. */
const STATE_ACTION = Object.freeze({
  [GRADABILITY_STATE.graded]:
    "Read the answer above. Enough of this export's spend is scored to stand behind it.",
  [GRADABILITY_STATE.provisional]:
    "Treat these figures as provisional until more of this export is scored.",
  [GRADABILITY_STATE.belowBar]: "Re-pull the export with the missing input.",
  [GRADABILITY_STATE.noBaseline]:
    "Import billing data. Coverage has no denominator until a spend total exists.",
});

/** Which states may quote the figures beside them. Derived from the evaluator, not restated. */
const SHOWS_FIGURES = Object.freeze([GRADABILITY_STATE.graded, GRADABILITY_STATE.provisional]);

/**
 * Why one department produced no grade, in the words the evaluator published.
 *
 * The department's own `sampling.reason` wins when it carries one, verbatim — it
 * is the most specific true sentence anyone on this page has about that row. The
 * fallback is `query-literacy.js`'s closed copy for the two cases a sampling
 * block can be in, so even the generic path quotes an evaluator rather than
 * inventing a sentence at the surface.
 */
function clusterReason(department) {
  const published = typeof department?.sampling?.reason === "string"
    ? department.sampling.reason.trim() : "";
  if (published) return published;
  const sampled = Number(department?.sampling?.sampledQueries);
  return Number.isInteger(sampled) && sampled > 0
    ? NOT_GRADEABLE_COPY[NOT_GRADEABLE_REASONS.noClassifiedQueries]
    : NOT_GRADEABLE_COPY[NOT_GRADEABLE_REASONS.noSampledQueries];
}

/** The key the evaluator groups a department under: its name, falling back to its id. */
const clusterId = (row) => row.name ?? row.id;

/**
 * The one unscored cluster the action names.
 *
 * Preferred: the group the evaluator already ranked first, so the action and the
 * eligibility verdict cannot name two different departments. Otherwise the
 * documented tie-break — largest unscored spend, then key order — which is total
 * and gives the same sentence for the same import every time.
 */
function topCluster(eligibility, clusters) {
  // `nextAction.group` is the department NAME, not an id: `grade-eligibility.js`
  // keys its groups on `name ?? id`. A cluster carrying no name therefore cannot
  // match, and the lookup falls through to the deterministic tie-break below.
  const group = eligibility?.nextAction?.group ?? null;
  const matched = group === null ? null
    : clusters.find((row) => clusterId(row) === group) ?? null;
  if (matched) return matched;
  return [...clusters].sort((left, right) => right.spendUsd - left.spendUsd
    || String(clusterId(left)).localeCompare(String(clusterId(right))))[0] ?? null;
}

/** Which state a verdict is in. Four branches, and the bar is the only comparison. */
function stateFor(eligibility) {
  if (eligibility.coverage === null) return GRADABILITY_STATE.noBaseline;
  if (eligibility.coverage >= COVERAGE_BAR) return GRADABILITY_STATE.graded;
  return eligibility.showGrade ? GRADABILITY_STATE.provisional : GRADABILITY_STATE.belowBar;
}

/** The verdict sentence: whether it can be graded, then the figure that decided it. */
function answerFor(state, eligibility) {
  const measured = `${percent(eligibility.coverage ?? 0)} of imported spend sits in departments `
    + `the rubric scored; the bar is ${percent(COVERAGE_BAR)}.`;
  if (state === GRADABILITY_STATE.noBaseline) {
    return "This export cannot be graded: it publishes no spend total, so there is nothing to "
      + "measure coverage against.";
  }
  if (state === GRADABILITY_STATE.graded) return `This export can be graded. ${measured}`;
  if (state === GRADABILITY_STATE.provisional) {
    return `This export can be graded provisionally. ${measured}`;
  }
  return `This export cannot be graded. ${measured}`;
}

/**
 * Answer the question for one analysis.
 *
 * @param analysis an analysis carrying `rankedDepartments`, or null.
 * @param source `"import"` or `"example"`. It changes ONE thing:
 *   `figuresSuppressed`. The bundled example is a worked example whose figures
 *   are declared invented on the same screen, so withholding them would take
 *   away the only complete reading of this region a first-time visitor has. A
 *   reader's own export gets no such licence — a figure taken out of a file the
 *   rubric barely touched is the one a lead would forward to a director.
 */
export function gradeExport({ analysis = null, source = "example" } = {}) {
  const departments = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments : [];
  const literacy = literacyOf(analysis);
  const eligibility = literacy ? literacy.eligibility : gradeEligibility(departments);
  const rows = literacy
    ? literacy.departments.map((department) => Object.freeze({
      id: department.departmentId ?? null,
      name: department.name ?? null,
      spendUsd: Number(department.spend?.totalUsd) || 0,
      scored: Boolean(department.gradeable),
      // The evaluator's own sentence for its own code, quoted whole.
      reason: department.gradeable ? null : NOT_GRADEABLE_COPY[department.reason] ?? null,
    }))
    : departments.map((department) => Object.freeze({
      id: typeof department?.id === "string" ? department.id : null,
      name: typeof department?.name === "string" ? department.name : null,
      // The same accessor the denominator was measured with, one row wide.
      spendUsd: summarize([department]).spendUsd,
      scored: departmentPerformance(department).available,
      reason: departmentPerformance(department).available ? null : clusterReason(department),
    }));
  const unscored = rows.filter((row) => !row.scored);
  const cluster = topCluster(eligibility, unscored.filter((row) => row.spendUsd > 0));
  const state = stateFor(eligibility);
  const showFigures = SHOWS_FIGURES.includes(state);
  // The reason clause is a SENTENCE OF ITS OWN after the imperative, so the step
  // a lead has to take leads and the evaluator's explanation follows it. The
  // graded state names no cluster: there is nothing to re-pull.
  const reason = state === GRADABILITY_STATE.graded ? null : cluster?.reason ?? null;

  return Object.freeze({
    version: EXPORT_GRADABILITY_VERSION,
    question: GRADABILITY_QUESTION,
    state,
    source,
    bar: COVERAGE_BAR,
    /** The evaluator's own tier, carried so a surface can trace this verdict to it. */
    tier: eligibility.tier,
    /** Raw ratio in [0, 1], or null when there is no denominator. Never rounded here. */
    coverage: eligibility.coverage,
    coveredUsd: eligibility.coveredUsd,
    totalUsd: eligibility.totalUsd,
    answer: answerFor(state, eligibility),
    /** Whether the figures beside this verdict may be quoted at all. */
    showFigures,
    /** …and whether THIS render must take them off the screen. See `source` above. */
    figuresSuppressed: source === "import" && !showFigures,
    action: Object.freeze({
      text: reason ? `${STATE_ACTION[state]} ${reason}` : STATE_ACTION[state],
      /** The department the action is about, or null when it is about the whole export. */
      cluster: cluster ? clusterId(cluster) : null,
      uncoveredUsd: cluster?.spendUsd ?? 0,
    }),
    /**
     * The input the evaluator named as missing, verbatim, or null when it named
     * none. It is not folded into the action above: the action leads with the
     * step, and this is the sentence that says which input the step supplies.
     */
    missingInput: literacy?.missingInput?.text ?? null,
    /** What was read, as opposed to what counted. `rows` includes every row. */
    provenance: Object.freeze({
      rows: rows.length,
      scored: rows.length - unscored.length,
      unscored: unscored.length,
      unpriced: rows.filter((row) => !(row.spendUsd > 0)).length,
    }),
  });
}
