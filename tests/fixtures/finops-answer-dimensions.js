// The version-stamped pin for /evolution.html's consolidated FinOps answer (#1499).
//
// WHAT A PIN IS FOR. `src/finops-answer-dimensions.js` MEASURES the answer;
// this file REMEMBERS what it measured when the numbers below were reviewed and
// agreed. Without a remembered copy, every check on this page compares the page
// to the module that paints it — so a change that moved both together would be
// green while the figure a CTO quoted last quarter had silently moved. The
// literals below are the second opinion that makes that impossible.
//
// THEY ARE LITERALS ON PURPOSE. A "fixture" that imports the computation and
// re-exports it pins nothing. Every number here was produced by the computation
// and then written down, so the drift test compares two independently-stored
// copies of the same claim.
//
// REGENERATING IT. Run, from the repository root:
//
//   node -e "import('./src/finops-answer-dimensions.js').then((m) => \
//     console.log(JSON.stringify(m.finopsAnswerDimensions(), null, 2)))"
//
// and transcribe the output below. `assumptions` is deliberately NOT copied
// here — the sentences live with the rubric in the source module, and a second
// copy of prose is a second thing to keep in step. What this file pins is the
// NUMBERS and the VERSION.
//
// BUMPING THE VERSION. Any change to a value below is a change to what the page
// claims, so `version` moves with it, in the same commit. The drift test asserts
// the version as a fifth thing, which is what makes "the numbers changed and
// nobody said so" a failure rather than a diff nobody reads.
//
// WHAT EACH DIMENSION ASSUMES is stated once, in `ANSWER_ASSUMPTIONS` in
// src/finops-answer-dimensions.js, and rendered on the page beside the counts.
// A reader disputing a number below should be arguing with one of those four
// sentences; if they are arguing with anything else, the assumption is missing
// and this fixture is the wrong shape.

/**
 * The reviewed values, as of `finops-answer-v1`, over the bundled synthetic
 * example — the dataset the shipped page reads. Not customer data, no
 * credential, no live integration.
 */
export const FINOPS_ANSWER_FIXTURE = Object.freeze({
  version: "finops-answer-v1",

  /**
   * The one reconciled recoverable figure, as the exact number AND the exact
   * rendered string. Both, because a formatter that started grouping digits
   * differently would move what a reader sees while the arithmetic sat still.
   */
  headline: Object.freeze({
    monthlyUsd: 51254,
    display: "$51,254",
    basis: "monthly",
  }),

  /**
   * The graded band and the coverage window it is published at. `floor` and
   * `ceiling` are ratios of analyzed spend, not percentages, because that is
   * the unit the rubric's cut points are stated in; `measuredPercent` is where
   * this answer actually sits inside that window, rounded once.
   */
  confidence: Object.freeze({
    grade: "high",
    label: "High",
    floor: 0.8,
    ceiling: 1,
    measuredPercent: 93,
  }),

  /**
   * The declared/derived split over the recoverable lines behind the figure.
   * All five are derived today: the bundled example is priced from the
   * published list, and no rate card has been declared against it. The split
   * moves the moment one is, which is the point of counting it.
   */
  provenance: Object.freeze({ declared: 0, derived: 5 }),

  /**
   * How many departments were scored, out of how many read, and WHICH — sorted
   * by id, so a set that changed membership without changing size still reds.
   */
  coverage: Object.freeze({
    scored: 5,
    total: 5,
    departmentIds: Object.freeze([
      "psn_example_unit_atlas0",
      "psn_example_unit_boreal",
      "psn_example_unit_cinder",
      "psn_example_unit_ember0",
      "psn_example_unit_quartz",
    ]),
  }),
});
