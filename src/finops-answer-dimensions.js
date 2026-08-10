// The four dimensions the consolidated FinOps answer is pinned on (#1499).
//
// WHAT THIS EXISTS TO PROVE. #1498 collapsed /evolution.html's recoverable-spend
// question into ONE answer with a supporting layer under it. Consolidation is
// only worth having if the surviving answer can be shown to have stayed
// truthful, and "the tests pass" is not that showing: the tests that guard the
// answer today each check one slot against the module that paints it, so a
// change that moved the module and the slot together would be green while the
// number a CTO quoted last quarter had silently moved.
//
// So the answer is reduced HERE to four numbers a reviewer can hold in their
// head, and those four are pinned in tests/fixtures/finops-answer-dimensions.js
// against a stamped version. The fixture is the memory; this module is the
// measurement; tests/finops-answer-dimensions.test.js is the comparison, and it
// names WHICH dimension drifted rather than reporting that two objects differ.
//
//   headline     the reconciled recoverable figure, number and rendered string
//   confidence   the graded band, and the numeric bounds that band is published at
//   provenance   how many lines behind the figure are declared, how many derived
//   coverage     how many departments were scored, out of how many, and which
//
// NOTHING IS COMPUTED TWICE. Every value below comes out of a module that
// already owns it: `getRecoverableSpend` for the figure and the department
// counts, `scoredDepartmentRows` for the exact set it summed over (the same
// predicate, exported rather than restated), and `gradeRecoverableConfidence`
// over `gradeExport` for the band. This module selects and names; it does not
// re-derive. A dimension whose number could only be produced here would pin
// nothing, because the page does not read it from here.
//
// EVERY WEIGHT CARRIES ITS ASSUMPTION. `ANSWER_ASSUMPTIONS` states, in one
// sentence per dimension, what a director disputing that dimension would have
// to argue with — because a number on an executive surface without a reachable
// assumption is a number nobody can check and therefore nobody should quote.
// The disclosure on the page renders those sentences beside the counts.
//
// Pure: no DOM, no storage, no clock, no network, no locale-dependent format.
// `Intl` is deliberately absent — a percentage that renders differently on two
// machines would make this fixture unpinnable.

import { getRecoverableSpend, scoredDepartmentRows } from "./finops-answer-contract.js";
import { gradeExport } from "./export-gradability.js";
import { loadExampleDataset } from "./example-dataset.js";
import {
  GRADE_LABEL, HIGH_COVERAGE_FLOOR, MODERATE_COVERAGE_FLOOR, gradeRecoverableConfidence,
} from "./finops-recoverable-confidence.js";

/**
 * The stamp the fixture pins against. BUMP IT when any of the four dimensions
 * changes value or meaning, in the same change that moves the value — the drift
 * test asserts the version too, so a values change that leaves this string
 * alone fails as loudly as a values change nobody meant.
 */
export const FINOPS_ANSWER_VERSION = "finops-answer-v1";

/** The dimensions, in the order the drift test reports them. */
export const ANSWER_DIMENSIONS = Object.freeze(["headline", "confidence", "provenance", "coverage"]);

/**
 * One sentence per dimension, stating the assumption behind it.
 *
 * These are the sentences the page shows, not a comment for engineers: they are
 * rendered under the counts so the assumption is reachable from the same
 * disclosure the number is.
 */
export const ANSWER_ASSUMPTIONS = Object.freeze({
  headline: "The headline is the monthly sum of the recoverable lines over scored departments; "
    + "the annual figure is that sum multiplied by 12 and is never a second measurement.",
  confidence: "The band is read off the share of analyzed spend sitting in departments the rubric "
    + "scored, at cut points this page publishes rather than at a reviewer's judgement.",
  provenance: "A line counts as declared only when it is priced from a rate card someone stated; "
    + "a list-price line is derived however precise it looks.",
  coverage: "A department counts as scored when the dataset carries a finite, non-negative "
    + "recoverable line for it, and nothing is extrapolated from a scored department to an "
    + "unscored one.",
});

/**
 * The coverage window each band is published at, as a ratio of analyzed spend.
 *
 * Derived from the rubric's own cut points rather than typed again, so moving a
 * threshold moves these bounds and reds the fixture in one step. The ceiling is
 * the floor of the band above, exclusive; `high` runs to all of it.
 */
export const CONFIDENCE_BOUNDS = Object.freeze({
  high: Object.freeze({ floor: HIGH_COVERAGE_FLOOR, ceiling: 1 }),
  moderate: Object.freeze({ floor: MODERATE_COVERAGE_FLOOR, ceiling: HIGH_COVERAGE_FLOOR }),
  low: Object.freeze({ floor: 0, ceiling: MODERATE_COVERAGE_FLOOR }),
});

/** Ascending by code unit. `localeCompare` would let two machines pin two sets. */
const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/** Whole percent, half up, with no `Intl` and therefore no locale in it. */
const wholePercent = (ratio) =>
  (Number.isFinite(ratio) ? Math.floor(ratio * 100 + 0.5) : null);

/** A line is DECLARED when the rate card behind its price was stated by someone
 *  rather than read off the published list. The flag is the analyzer's own —
 *  `downRouting.pricing.declaredCard` — so no second rule decides this. */
const isDeclaredLine = (row) => row?.downRouting?.pricing?.declaredCard === true;

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * Reduce the consolidated answer to its four pinnable dimensions.
 *
 * @param dataset the analysis envelope the answer is stated over. Defaults to
 *   the bundled synthetic example, which is what the shipped page reads.
 * @returns a frozen record: `{ version, headline, confidence, provenance,
 *   coverage, assumptions }`. Deterministic — the same dataset yields a
 *   byte-identical record every time, which the drift test asserts rather than
 *   assumes.
 */
export function finopsAnswerDimensions(dataset = loadExampleDataset()) {
  const recoverable = getRecoverableSpend(dataset);
  const scored = scoredDepartmentRows(dataset);
  const verdict = gradeRecoverableConfidence(gradeExport({ analysis: dataset, source: "example" }));
  const bounds = CONFIDENCE_BOUNDS[verdict.grade] ?? CONFIDENCE_BOUNDS.low;
  const declared = scored.filter(isDeclaredLine).length;

  return Object.freeze({
    version: FINOPS_ANSWER_VERSION,
    headline: Object.freeze({
      monthlyUsd: recoverable.monthly,
      display: recoverable.monthlyDisplay,
      basis: recoverable.basis,
    }),
    confidence: Object.freeze({
      grade: verdict.grade,
      label: verdict.label ?? GRADE_LABEL[verdict.grade],
      floor: bounds.floor,
      ceiling: bounds.ceiling,
      measuredPercent: wholePercent(verdict.measured.coverage),
    }),
    provenance: Object.freeze({ declared, derived: scored.length - declared }),
    coverage: Object.freeze({
      scored: recoverable.scoredDepartments,
      total: recoverable.totalDepartments,
      departmentIds: Object.freeze(scored.map((row) => row.id).sort(byCodeUnit)),
    }),
    assumptions: ANSWER_ASSUMPTIONS,
  });
}

/**
 * The provenance-and-coverage sentence the supporting-detail layer shows.
 *
 * Executive-readable on purpose: counts, no identifiers, no version string, no
 * money (the money is the headline above it and is stated once). A CTO should
 * be able to quote this line into a board pack without opening anything.
 */
export function answerProofSentence(dimensions) {
  const { coverage, provenance, confidence } = dimensions;
  const unscored = coverage.total - coverage.scored;
  const scope = unscored === 0
    ? `All ${plural(coverage.total, "department", "departments")} behind this answer carry a `
      + "completed FinOps score, so none of them contributed zero to it."
    : `${coverage.scored} of ${plural(coverage.total, "department", "departments")} behind this `
      + `answer carry a completed FinOps score; the other ${unscored} contributed zero and were `
      + "not extrapolated from.";
  const priced = `Of the ${plural(coverage.scored, "recoverable line", "recoverable lines")} that `
    + `make up the figure, ${provenance.declared} ${provenance.declared === 1 ? "is" : "are"} `
    + `priced at rates someone declared and ${provenance.derived} `
    + `${provenance.derived === 1 ? "is" : "are"} derived from published list prices.`;
  const graded = `Confidence is graded ${confidence.label} — the band published from `
    + `${wholePercent(confidence.floor)}% to ${wholePercent(confidence.ceiling)}% of analyzed `
    + `spend scored, and this answer measures ${confidence.measuredPercent}%.`;
  return `${scope} ${priced} ${graded}`;
}

/**
 * The assumptions behind those counts, in the same disclosure as the counts.
 *
 * Not a footnote and not a link: a reader who can see the number can see what
 * it assumes without a second press, which is the whole reason the assumption
 * map is shipped rather than kept in a rubric doc.
 */
export function answerAssumptionSentence(dimensions) {
  const { assumptions, version } = dimensions;
  return `What those numbers assume. ${assumptions.coverage} ${assumptions.provenance} `
    + `${assumptions.confidence} ${assumptions.headline} `
    + `Pinned for review as ${version}.`;
}
