// The pinned expectations behind every ranking claim this page makes.
//
// WHY THESE ARE FIXTURES AND NOT ASSERTIONS IN A TEST FILE
// -------------------------------------------------------
// A director whose team is graded by these numbers is entitled to ask two
// questions: "what exactly did you claim?" and "what would have to change for
// the claim to move?". Both are answerable only if the claimed values live in
// one hand-authored place that the scoring path itself points at. So the pinned
// values are data here — in the same `src/*-fixtures.js` shape
// `peer-cohort-fixtures.js` and `finops-journey-fixtures.js` already use — the
// test asserts the running code against them, and
// `finops-position-reproducibility.js` publishes their count and their
// verification date into the executive view. An expectation nobody can find is
// an expectation nobody can dispute.
//
// WHAT IS PINNED
// --------------
//   1. Every band boundary of every published cohort, with a case sitting
//      EXACTLY on the boundary and one a cent inside each adjacent band. A
//      boundary that moves without this file moving fails by name.
//   2. The bundled example export's fully resolved position — band, numeric
//      value, and the provenance fields it was derived from.
//   3. The department worst-gap finding — who is worst, by how much, and who is
//      the runner-up, so a tie-break or sort change is caught rather than
//      silently re-ranking the demo.
//
// WHAT IS NOT IN IT
// -----------------
// No customer, tenant, provider, or visitor data, and no credential. Every
// figure here is either a hand-authored synthetic number or the resolved output
// of the bundled synthetic example, which is itself invented in
// `example-dataset.js`.
//
// LOCALITY. Frozen data only. No storage, clock, network, credential, or DOM.

/**
 * The date these expectations were last re-derived and hand-checked.
 *
 * It is authored, not computed: a verification date that a clock produces is a
 * date that says only "the code ran", which is the one thing a failing pin would
 * already have told the reader. Bump it in the same commit that re-pins a value.
 */
export const FIXTURES_VERIFIED_ON = "2026-06-30";

/** What these fixtures are, stated once so no surface restates it. */
export const FIXTURE_PROVENANCE = Object.freeze({
  label: "Hand-authored in-repo expectations",
  statement: "Every figure published beside a position is pinned to a hand-authored expectation in "
    + "this repository. The fixtures contain no customer, tenant, or provider data and no "
    + "credential; editing a boundary or the bundled example fails the pinned expectation by name.",
});

/**
 * One band-boundary case.
 *
 * `value` is a literal rather than `p25 + 0.01`, on purpose: a case derived from
 * the boundary it is testing moves with the boundary and pins nothing.
 */
const bandCase = (cohortId, value, band, note) => Object.freeze({ cohortId, value, band, note });

/** The three band wire values, repeated here so a fixture never imports a rule. */
const TOP = "top_quartile";
const MIDDLE = "middle_range";
const BOTTOM = "bottom_quartile";

/**
 * Six cases per cohort: a cent below p25, exactly p25, a cent above p25, a cent
 * below p75, exactly p75, a cent above p75.
 *
 * The two exact cases are the ones the rule's wording turns on — both boundaries
 * are inclusive on the favorable side — and the four neighbours are what catch a
 * boundary that was nudged rather than redefined.
 */
const boundarySet = (cohortId, p25, p75, belowP25, aboveP25, belowP75, aboveP75) => [
  bandCase(cohortId, belowP25, TOP, "a cent under p25 is inside the cheapest quarter"),
  bandCase(cohortId, p25, TOP, "exactly p25 belongs to the top quartile, not the middle"),
  bandCase(cohortId, aboveP25, MIDDLE, "a cent over p25 has left the cheapest quarter"),
  bandCase(cohortId, belowP75, MIDDLE, "a cent under p75 is still the middle half"),
  bandCase(cohortId, p75, BOTTOM, "exactly p75 belongs to the bottom quartile, not the middle"),
  bandCase(cohortId, aboveP75, BOTTOM, "a cent over p75 is inside the most expensive quarter"),
];

/**
 * The boundaries every published cohort is expected to carry, as literals.
 *
 * The test asserts these against the shipped `PEER_COST_COHORTS` records before
 * it asserts any band, so editing 31.50 to 31.00 in the reference data fails
 * here — naming the cohort — instead of quietly re-ranking the demo.
 */
export const PINNED_COHORT_BOUNDARIES = Object.freeze([
  Object.freeze({ cohortId: "cost-enterprise-saas", p25: 18.40, p75: 31.50 }),
  Object.freeze({ cohortId: "cost-enterprise-financial-services", p25: 22.10, p75: 38.75 }),
  Object.freeze({ cohortId: "cost-mid-saas", p25: 12.75, p75: 24.60 }),
  Object.freeze({ cohortId: "cost-small-saas", p25: 9.20, p75: 19.80 }),
]);

/** Every band boundary, on the boundary and a cent to each side of it. */
export const PINNED_BAND_CASES = Object.freeze([
  ...boundarySet("cost-enterprise-saas", 18.40, 31.50, 18.39, 18.41, 31.49, 31.51),
  ...boundarySet("cost-enterprise-financial-services", 22.10, 38.75, 22.09, 22.11, 38.74, 38.76),
  ...boundarySet("cost-mid-saas", 12.75, 24.60, 12.74, 12.76, 24.59, 24.61),
  ...boundarySet("cost-small-saas", 9.20, 19.80, 9.19, 9.21, 19.79, 19.81),
]);

/**
 * The bundled example export's fully resolved position.
 *
 * `value` is the unrounded metric, because the band reads the unrounded value
 * and a fixture that pinned only the rounded display would let a change of a
 * third of a cent move a band without failing anything.
 */
export const PINNED_EXAMPLE_POSITION = Object.freeze({
  band: BOTTOM,
  bandLabel: "Bottom quartile",
  value: 38.625,
  valueDisplay: "$38.63",
  successfulTasks: 4000,
  spendUsd: 154500,
  /** Provenance: which cohort, which snapshot, and the two boundaries it was banded against. */
  cohortId: "cost-enterprise-saas",
  snapshotId: "2026-06-30",
  rubricVersion: "finops-cost-rubric/v2",
  positionContract: "finops-cost-position/1.0.0",
  metricId: "cost_per_successful_task",
  p25: 18.40,
  p75: 31.50,
  period: "2026-06-01 to 2026-07-01",
});

/**
 * The department worst-gap finding, including the runner-up.
 *
 * The runner-up is pinned for one reason: the finding names a single laggard,
 * and the only way to notice that a sort or a tie-break rule changed which one
 * it names is to pin the department that was second-worst as well. Without it, a
 * reordered comparator that promotes Ember over Atlas produces a different
 * headline and passes every other assertion in this file.
 */
export const PINNED_EXAMPLE_GAP = Object.freeze({
  laggardId: "psn_example_unit_atlas0",
  laggardValue: 52.666666666666664,
  laggardDisplay: "$52.67",
  laggardBand: BOTTOM,
  laggardSuccessfulTasks: 1500,
  leaderId: "psn_example_unit_boreal",
  leaderValue: 24.444444444444443,
  leaderDisplay: "$24.44",
  leaderBand: MIDDLE,
  leaderSuccessfulTasks: 900,
  /** Rounded to cents once, by the gap module, exactly as the surface shows it. */
  gapValue: 28.22,
  gapBands: 1,
  eligibleCount: 5,
  /** Second-worst by the same metric: the tie-break canary described above. */
  runnerUpId: "psn_example_unit_ember0",
  runnerUpValue: 36.666666666666664,
});

/**
 * How many expectations this file pins, published so the executive view can say
 * how much of the claim beside it is checked rather than asserted.
 */
export const PINNED_EXPECTATION_COUNT = PINNED_BAND_CASES.length
  + PINNED_COHORT_BOUNDARIES.length
  + Object.keys(PINNED_EXAMPLE_POSITION).length
  + Object.keys(PINNED_EXAMPLE_GAP).length;
