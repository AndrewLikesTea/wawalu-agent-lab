// Labelled fixtures for the peer-cohort benchmark.
//
// WHY THIS FILE EXISTS
// --------------------
// Every peer number on the executive page is a number some director will
// dispute. "83rd percentile" is only defensible if a second engineer, reading
// this repository and nothing else, can reproduce it from stated inputs and
// stated rules. Each row below is one such case: declared inputs, and the exact
// percentile, quartile, median and prioritized action they must produce.
//
// The expectations are written as literals on purpose. A fixture that recomputes
// its own expectation with the code under test proves only that the code is
// self-consistent; it cannot notice the day the rule changed. These literals
// were derived by hand from `docs/peer-cohort-contract.md` and are what a
// reviewer checks the implementation against, not the other way round.
//
// NO LIVE OR CUSTOMER DATA. Every value here is invented for this file. The
// cohorts these rows are compared against are the published synthetic fixtures
// in `src/peer-cohort-fixtures.js`, which are likewise authored in-repository
// and are not derived from any imported file.
//
// ---------------------------------------------------------------------------
// THE ASSUMPTION BEHIND EVERY WEIGHT
// ---------------------------------------------------------------------------
// The contract carries no free-floating coefficients, but it does carry six
// choices that move a reader's number. Each is stated here with the assumption
// it rests on, because a weight nobody can question is a weight nobody can
// defend.
//
// 1. HEADLINE = `literacy_score`, and no benchmark exists without it.
//    ASSUMPTION: the question "how do we compare?" is a question about how well
//    this organization uses the tool, and the two spend metrics describe the
//    invoice that follows from that. An organization with no graded sample has
//    not answered the question, and placing it in a cohort on spend alone would
//    rank it on the consequence while hiding the cause.
//
// 2. TIES COUNT AS ONE HALF (mid-rank percentile).
//    ASSUMPTION: an organization identical to every member of its cohort is
//    average by construction, so it must read 50. The two neighbouring
//    conventions (ties count as worse / as better) report 0 or 100 for that same
//    organization, which is not a defensible sentence to put in front of anyone.
//
// 3. VALUES ARE ROUNDED TO THE METRIC'S PRECISION BEFORE COMPARISON
//    (0 dp for the score, 4 dp for both shares).
//    ASSUMPTION: a tie should be a fact about the business, not about float
//    representation. Rounding after comparison lets 0.199990000001 beat
//    0.19999 and makes the tie set — and therefore the percentile — depend on
//    which arithmetic path produced the value.
//
// 4. `recoverable_share` IS LOWER-IS-BETTER; the other two are higher-is-better.
//    ASSUMPTION: recoverable share measures avoidable spend still sitting on the
//    invoice, so a large share is a large unclaimed problem. Direction is a
//    per-metric declaration rather than a global convention precisely because
//    getting it backwards would invert a director's ranking silently.
//
// 5. ACTION RANK ORDER: literacy (1) > recoverable share (2) > high-value
//    share (3) > hold (4), with the literacy trigger at percentile < 25 and both
//    spend triggers at percentile < 50.
//    ASSUMPTION: a bottom-quartile literacy score is the only finding that says
//    the work itself is the problem, so it outranks both spend findings — and it
//    fires only in the bottom quartile because "below the median" is not, on its
//    own, a reason to reorganize how an organization writes prompts. Recoverable
//    share outranks high-value share because it is already denominated in
//    dollars on this period's invoice, while the query mix is a leading
//    indicator of a future one. `hold_position` is last because it is eligible
//    only when nothing above it is.
//
// 6. MEMBER FLOOR 8, CONFIDENT COUNT 12.
//    ASSUMPTION: below eight members a percentile is a rank wearing a
//    distribution's clothes, so such a cohort is not published at all; below
//    twelve it is published but the comparison is labelled low confidence. Both
//    numbers are editorial and are stated so they can be argued with. Every
//    cohort shipped today publishes twelve members, so no reader currently sees
//    a low-confidence comparison — see the drift suite, which pins that.

import { PEER_COHORT_PROVENANCE } from "../../src/peer-cohort-contract.js";

export const RUBRIC = PEER_COHORT_PROVENANCE.rubricVersion;

/** The period every fixture declares. Fixed so no clock reaches a fixture. */
export const FIXTURE_PERIOD = "2026-06-01 to 2026-06-30";

/** Scored-record count every graded fixture declares. */
const SCORED = 240;

/**
 * A graded corpus, shaped exactly as `gradeImportedCorpus` publishes one.
 *
 * `highValueShare` is carried as the rubric's own category row rather than
 * recomputed here: the peer panel reads the grade's share, and a fixture that
 * computed its own would stop testing the join it exists to test.
 */
export function gradeFixture({ literacyScore, highValueShare, rubricVersion = RUBRIC, graded = true }) {
  if (!graded) {
    return Object.freeze({
      gradeable: false,
      composite: null,
      rubricVersionId: rubricVersion,
      records: Object.freeze({ source: SCORED, scored: 0, unclassified: SCORED }),
      score: null,
    });
  }
  return Object.freeze({
    gradeable: true,
    composite: literacyScore,
    grade: "B",
    rubricVersionId: rubricVersion,
    records: Object.freeze({ source: SCORED, scored: SCORED, unclassified: 0 }),
    score: Object.freeze({
      categories: Object.freeze([
        Object.freeze({ key: "highValue", share: highValueShare, records: 12 }),
        Object.freeze({ key: "inefficient", share: 1 - highValueShare, records: 8 }),
      ]),
    }),
  });
}

/** A local-finops analysis, shaped as the page holds one. */
export function analysisFixture({ orgUnits, spendUsd, recoverableUsd, industry = null }) {
  return Object.freeze({
    period: FIXTURE_PERIOD,
    spendUsd,
    recoverableUsd,
    rankedDepartments: Object.freeze(Array.from({ length: orgUnits },
      (unused, index) => Object.freeze({ id: `unit-${index}`, name: `Unit ${index}` }))),
    ...(industry === null ? {} : { segment: Object.freeze({ industry }) }),
  });
}

/**
 * The organization roll-up a row declares, written out rather than derived.
 *
 * `importedPeerRollup` must produce exactly this from the same row's grade and
 * analysis; the reproducibility suite asserts that, so the two modules are held
 * to one definition of "the organization's numbers" instead of two.
 */
function rollupFor(row) {
  const graded = row.graded !== false;
  return Object.freeze({
    literacyScore: graded ? row.literacyScore : null,
    highValueShare: graded ? row.highValueShare : null,
    // Absent, never zero: an unmeasured share and a measured share of zero are
    // different claims and only one of them belongs at the bottom of a cohort.
    recoverableShare: row.spendUsd > 0 ? row.recoverableUsd / row.spendUsd : null,
    rubricVersion: row.rubricVersion ?? RUBRIC,
    sourceRecords: graded ? SCORED : 0,
    period: FIXTURE_PERIOD,
  });
}

const metrics = (literacy, highValue, recoverable) => Object.freeze({
  literacy_score: literacy === null ? null : Object.freeze(literacy),
  high_value_share: highValue === null ? null : Object.freeze(highValue),
  recoverable_share: recoverable === null ? null : Object.freeze(recoverable),
});

/** `[percentile, quartile, cohortMedian, value]`, in that order, as an object. */
const at = (value, percentile, quartile, cohortMedian) =>
  Object.freeze({ value, percentile, quartile, cohortMedian });

/**
 * The labelled cases.
 *
 * `kind` groups them for the suites: `comparable`, `boundary`, `tie`,
 * `missing_segment`, `non_comparable`, and `partial` (the benchmark stands and
 * one supporting metric does not).
 */
const CASES = [
  // --- comparable imports, one per published cohort family ------------------
  {
    id: "comparable-broad-mid",
    kind: "comparable",
    note: "An ordinary import: eight attributed org units, no declared industry.",
    orgUnits: 8, literacyScore: 71, highValueShare: 0.38, spendUsd: 10000, recoverableUsd: 1100,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "hold_position", actionGap: null,
      // 10 of 12 members score below 71 and none equals it: 10/12 → 83.
      metrics: metrics(at(71, 83, "top_quartile", 60), at(0.38, 75, "top_quartile", 0.295),
        at(0.11, 88, "top_quartile", 0.21)),
    },
  },
  {
    id: "comparable-close-saas",
    kind: "comparable",
    note: "The same numbers with an industry declared: a closer cohort, and a lower percentile in it.",
    orgUnits: 8, industry: "saas",
    literacyScore: 71, highValueShare: 0.38, spendUsd: 10000, recoverableUsd: 1100,
    expect: {
      available: true, cohortId: "industry-saas", comparability: "close", confidence: "high",
      actionId: "hold_position", actionGap: null,
      metrics: metrics(at(71, 58, "second_quartile", 68), at(0.38, 67, "second_quartile", 0.335),
        at(0.11, 75, "top_quartile", 0.17)),
    },
  },
  {
    id: "comparable-focused-small",
    kind: "comparable",
    note: "Two attributed org units selects the smallest published band.",
    orgUnits: 2, literacyScore: 60, highValueShare: 0.30, spendUsd: 500, recoverableUsd: 50,
    expect: {
      available: true, cohortId: "size-focused", comparability: "broad", confidence: "medium",
      actionId: "hold_position", actionGap: null,
      metrics: metrics(at(60, 63, "second_quartile", 56), at(0.30, 58, "second_quartile", 0.275),
        at(0.10, 92, "top_quartile", 0.22)),
    },
  },
  {
    id: "comparable-enterprise",
    kind: "comparable",
    note: "The same organization numbers in the largest band place lower: the band is the comparison.",
    orgUnits: 20, literacyScore: 60, highValueShare: 0.30, spendUsd: 500, recoverableUsd: 50,
    expect: {
      available: true, cohortId: "size-enterprise", comparability: "broad", confidence: "medium",
      actionId: "raise_high_value_share", actionGap: "1.5 points of share",
      metrics: metrics(at(60, 38, "third_quartile", 65), at(0.30, 46, "third_quartile", 0.315),
        at(0.10, 88, "top_quartile", 0.19)),
    },
  },
  {
    id: "comparable-unknown-industry",
    kind: "comparable",
    note: "An industry no cohort publishes is compared on size alone, and the label says broad.",
    orgUnits: 8, industry: "haberdashery",
    literacyScore: 71, highValueShare: 0.38, spendUsd: 10000, recoverableUsd: 1100,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "hold_position", actionGap: null,
      metrics: metrics(at(71, 83, "top_quartile", 60), at(0.38, 75, "top_quartile", 0.295),
        at(0.11, 88, "top_quartile", 0.21)),
    },
  },

  // --- percentile boundaries ------------------------------------------------
  // Each row sits exactly on a published edge. With twelve members a percentile
  // moves in steps of 100/24, so the achievable values around each edge are the
  // ones named here; a rule that drifted by one point would land on the other
  // side of a quartile name or of an action trigger.
  {
    id: "boundary-literacy-p75",
    kind: "boundary",
    note: "Exactly 75: the top quartile is closed at its lower edge.",
    orgUnits: 8, literacyScore: 68, highValueShare: 0.40, spendUsd: 10000, recoverableUsd: 1000,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "hold_position", actionGap: null,
      metrics: metrics(at(68, 75, "top_quartile", 60), at(0.40, 83, "top_quartile", 0.295),
        at(0.10, 92, "top_quartile", 0.21)),
    },
  },
  {
    id: "boundary-literacy-p50",
    kind: "boundary",
    note: "Exactly 50 belongs to the second quartile, never to the top one.",
    orgUnits: 8, literacyScore: 59, highValueShare: 0.40, spendUsd: 10000, recoverableUsd: 1000,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "hold_position", actionGap: null,
      metrics: metrics(at(59, 50, "second_quartile", 60), at(0.40, 83, "top_quartile", 0.295),
        at(0.10, 92, "top_quartile", 0.21)),
    },
  },
  {
    id: "boundary-literacy-p25",
    kind: "boundary",
    note: "Exactly 25 is the third quartile and does NOT fire the literacy action: the trigger is < 25.",
    orgUnits: 8, literacyScore: 52, highValueShare: 0.40, spendUsd: 10000, recoverableUsd: 1000,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "hold_position", actionGap: null,
      metrics: metrics(at(52, 25, "third_quartile", 60), at(0.40, 83, "top_quartile", 0.295),
        at(0.10, 92, "top_quartile", 0.21)),
    },
  },
  {
    id: "boundary-literacy-below-p25",
    kind: "boundary",
    note: "The next reachable percentile below 25 is 21, and there the literacy action fires.",
    orgUnits: 8, literacyScore: 50, highValueShare: 0.40, spendUsd: 10000, recoverableUsd: 1000,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "close_literacy_gap", actionGap: "10 points",
      metrics: metrics(at(50, 21, "bottom_quartile", 60), at(0.40, 83, "top_quartile", 0.295),
        at(0.10, 92, "top_quartile", 0.21)),
    },
  },
  {
    id: "boundary-recoverable-p50",
    kind: "boundary",
    note: "Recoverable share sitting exactly at the cohort median reads 50 and takes no spend action.",
    orgUnits: 8, literacyScore: 68, highValueShare: 0.40, spendUsd: 10000, recoverableUsd: 2100,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "hold_position", actionGap: null,
      metrics: metrics(at(68, 75, "top_quartile", 60), at(0.40, 83, "top_quartile", 0.295),
        at(0.21, 50, "second_quartile", 0.21)),
    },
  },
  {
    id: "boundary-recoverable-below-p50",
    kind: "boundary",
    note: "One member worse of the edge: 46, and the recoverable action fires on a one-point gap.",
    orgUnits: 8, literacyScore: 68, highValueShare: 0.40, spendUsd: 10000, recoverableUsd: 2200,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "capture_recoverable_gap", actionGap: "1.0 points of share",
      metrics: metrics(at(68, 75, "top_quartile", 60), at(0.40, 83, "top_quartile", 0.295),
        at(0.22, 46, "third_quartile", 0.21)),
    },
  },

  // --- ties -----------------------------------------------------------------
  {
    id: "tie-literacy-equals-member",
    kind: "tie",
    note: "A score equal to one member: five worse plus half of one equal is 5.5/12 → 46.",
    orgUnits: 8, literacyScore: 58, highValueShare: 0.40, spendUsd: 10000, recoverableUsd: 1000,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "hold_position", actionGap: null,
      metrics: metrics(at(58, 46, "third_quartile", 60), at(0.40, 83, "top_quartile", 0.295),
        at(0.10, 92, "top_quartile", 0.21)),
    },
  },
  {
    id: "tie-recoverable-rounds-into-member",
    kind: "tie",
    note: "19999/100000 is 0.19999, which is 0.2000 at the metric's declared four decimals — "
      + "a tie with syn-scl-07, not a win over it.",
    orgUnits: 8, literacyScore: 68, highValueShare: 0.40, spendUsd: 100000, recoverableUsd: 19999,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "hold_position", actionGap: null,
      metrics: metrics(at(68, 75, "top_quartile", 60), at(0.40, 83, "top_quartile", 0.295),
        at(0.2, 54, "second_quartile", 0.21)),
    },
  },
  {
    id: "tie-high-value-equals-member",
    kind: "tie",
    note: "A tied high-value share still lands below the median, so the spend-mix action fires.",
    orgUnits: 8, literacyScore: 68, highValueShare: 0.28, spendUsd: 10000, recoverableUsd: 1000,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "raise_high_value_share", actionGap: "1.5 points of share",
      metrics: metrics(at(68, 75, "top_quartile", 60), at(0.28, 46, "third_quartile", 0.295),
        at(0.10, 92, "top_quartile", 0.21)),
    },
  },

  // --- the spend metrics as the reported finding ----------------------------
  {
    id: "spend-mix-behind",
    kind: "comparable",
    note: "A healthy score with a poor query mix: the reported finding is the mix, not the score.",
    orgUnits: 8, literacyScore: 68, highValueShare: 0.20, spendUsd: 10000, recoverableUsd: 1000,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "raise_high_value_share", actionGap: "9.5 points of share",
      metrics: metrics(at(68, 75, "top_quartile", 60), at(0.20, 17, "bottom_quartile", 0.295),
        at(0.10, 92, "top_quartile", 0.21)),
    },
  },
  {
    id: "recoverable-share-behind",
    kind: "comparable",
    note: "Recoverable share far worse than the median outranks a worse-than-median query mix.",
    orgUnits: 8, literacyScore: 68, highValueShare: 0.20, spendUsd: 10000, recoverableUsd: 3000,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "capture_recoverable_gap", actionGap: "9.0 points of share",
      metrics: metrics(at(68, 75, "top_quartile", 60), at(0.20, 17, "bottom_quartile", 0.295),
        at(0.30, 13, "bottom_quartile", 0.21)),
    },
  },
  {
    id: "literacy-outranks-both-spend-findings",
    kind: "comparable",
    note: "All three metrics behind: rank 1 wins and the other two are not reported as the action.",
    orgUnits: 8, literacyScore: 50, highValueShare: 0.20, spendUsd: 10000, recoverableUsd: 3000,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "close_literacy_gap", actionGap: "10 points",
      metrics: metrics(at(50, 21, "bottom_quartile", 60), at(0.20, 17, "bottom_quartile", 0.295),
        at(0.30, 13, "bottom_quartile", 0.21)),
    },
  },

  // --- the benchmark stands, one supporting metric does not -----------------
  {
    id: "partial-no-spend-denominator",
    kind: "partial",
    note: "No observed spend: the ratio has no denominator, so recoverable share is absent — not zero, "
      + "and not a bottom-of-cohort placement.",
    orgUnits: 8, literacyScore: 71, highValueShare: 0.38, spendUsd: 0, recoverableUsd: 0,
    expect: {
      available: true, cohortId: "size-scaling", comparability: "broad", confidence: "medium",
      actionId: "hold_position", actionGap: null,
      unavailableMetrics: { recoverable_share: "no_organization_metric_value" },
      metrics: metrics(at(71, 83, "top_quartile", 60), at(0.38, 75, "top_quartile", 0.295), null),
    },
  },

  // --- refusals -------------------------------------------------------------
  {
    id: "missing-segment-no-org-units",
    kind: "missing_segment",
    note: "Nothing in the import says how large the organization is, so no cohort is selected at all.",
    orgUnits: 0, literacyScore: 71, highValueShare: 0.38, spendUsd: 10000, recoverableUsd: 1100,
    expect: { available: false, reason: "no_peer_segment_input", cohortNamed: false },
  },
  {
    id: "non-comparable-outside-every-band",
    kind: "non_comparable",
    note: "A segment outside every published band. No import can close this gap.",
    orgUnits: 4000, literacyScore: 71, highValueShare: 0.38, spendUsd: 10000, recoverableUsd: 1100,
    expect: { available: false, reason: "no_matching_peer_cohort", cohortNamed: false },
  },
  {
    id: "non-comparable-other-rubric",
    kind: "non_comparable",
    note: "A score from another rubric is two scales, not one comparison. Refused, never rescaled.",
    orgUnits: 8, rubricVersion: "literacy-mix/2.0.0",
    literacyScore: 71, highValueShare: 0.38, spendUsd: 10000, recoverableUsd: 1100,
    expect: { available: false, reason: "peer_rubric_version_mismatch", cohortNamed: true },
  },
  {
    id: "non-comparable-ungraded-import",
    kind: "non_comparable",
    note: "A cohort applies and the import published no literacy score to place inside it.",
    orgUnits: 8, graded: false,
    literacyScore: 71, highValueShare: 0.38, spendUsd: 10000, recoverableUsd: 1100,
    expect: { available: false, reason: "no_comparable_peer_metric", cohortNamed: true },
  },
];

/** Every case, frozen, each carrying the grade, analysis and roll-up it declares. */
export const PEER_FIXTURES = Object.freeze(CASES.map((row) => Object.freeze({
  ...row,
  grade: gradeFixture(row),
  analysis: analysisFixture(row),
  organization: rollupFor(row),
  segment: Object.freeze({ orgUnits: row.orgUnits > 0 ? row.orgUnits : null, industry: row.industry ?? null }),
})));

export const fixturesOfKind = (...kinds) => PEER_FIXTURES.filter((row) => kinds.includes(row.kind));

export const fixtureById = (id) => {
  const found = PEER_FIXTURES.find((row) => row.id === id);
  if (!found) throw new Error(`no peer fixture named "${id}"`);
  return found;
};
