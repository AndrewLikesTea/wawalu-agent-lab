// The peer-cohort benchmark contract.
//
// What is pinned here is every decision two engineers could otherwise make
// differently: which cohort applies, what a percentile means when values tie,
// which quartile owns 25, 50 and 75, when the comparison is refused and under
// which code, and which single action follows. The fixtures are also checked
// for the property that makes them publishable at all — they carry nothing but
// synthetic ids and three declared numbers.

import test from "node:test";
import assert from "node:assert/strict";
import {
  COHORT_FAMILY, COMPARABILITY, HEADLINE_METRIC_ID, METRIC_DIRECTION, MIN_COHORT_MEMBERS,
  PEER_ACTION_CANDIDATES, PEER_COHORTS, PEER_COHORT_PROVENANCE, PEER_COHORT_VERSION,
  PEER_CONFIDENCE, PEER_INDUSTRY, PEER_METRICS, PEER_UNAVAILABLE_REASON, QUARTILE,
  evaluatePeerBenchmark, medianOf, percentileWithin, quartileFor, selectPeerCohort,
} from "../src/peer-cohort-contract.js";

const RUBRIC = PEER_COHORT_PROVENANCE.rubricVersion;

// --- the published fixtures -------------------------------------------------

test("every published cohort clears the member floor and declares one segment band", () => {
  assert.ok(PEER_COHORTS.length >= 2);
  for (const cohort of PEER_COHORTS) {
    assert.ok(cohort.members.length >= MIN_COHORT_MEMBERS, cohort.cohortId);
    assert.ok(cohort.selector.orgUnits.min <= cohort.selector.orgUnits.max);
    assert.equal(cohort.rubricVersion, RUBRIC);
    assert.ok([COHORT_FAMILY.organizationSize, COHORT_FAMILY.industry].includes(cohort.family));
  }
  // Both families the contract publishes are actually present.
  const families = new Set(PEER_COHORTS.map((cohort) => cohort.family));
  assert.equal(families.size, 2);
});

test("a cohort member carries synthetic ids and the three declared metrics, nothing else", () => {
  const allowed = new Set(["memberId", ...PEER_METRICS.map((metric) => metric.field)]);
  for (const cohort of PEER_COHORTS) {
    for (const member of cohort.members) {
      assert.deepEqual(new Set(Object.keys(member)), allowed, cohort.cohortId);
      assert.match(member.memberId, /^syn-[a-z]+-\d{2}$/);
      for (const metric of PEER_METRICS) {
        const value = member[metric.field];
        assert.ok(Number.isFinite(value) && value >= metric.domain.min && value <= metric.domain.max,
          `${cohort.cohortId}/${member.memberId}/${metric.id}`);
      }
    }
  }
});

test("the provenance statement says what the cohorts are and are not", () => {
  assert.equal(PEER_COHORT_PROVENANCE.version, PEER_COHORT_VERSION);
  assert.match(PEER_COHORT_PROVENANCE.statement, /synthetic reference data/);
  assert.match(PEER_COHORT_PROVENANCE.statement, /no customer, tenant, or provider data/);
  assert.match(PEER_COHORT_PROVENANCE.statement, /not derived from any file imported by any visitor/);
});

// --- percentile, ties, and quartile boundaries ------------------------------

test("ties count as half, so equalling every member is the 50th percentile", () => {
  assert.equal(percentileWithin([5, 5, 5, 5], 5, METRIC_DIRECTION.higherIsBetter), 50);
  // Beating everyone is 100; being beaten by everyone is 0.
  assert.equal(percentileWithin([1, 2, 3, 4], 9, METRIC_DIRECTION.higherIsBetter), 100);
  assert.equal(percentileWithin([1, 2, 3, 4], 0, METRIC_DIRECTION.higherIsBetter), 0);
  // Two worse, one equal, one better: (2 + 0.5) / 4 = 62.5 → 63, half-up.
  assert.equal(percentileWithin([1, 2, 3, 4], 3, METRIC_DIRECTION.higherIsBetter), 63);
});

test("lower-is-better inverts which members count as worse", () => {
  assert.equal(percentileWithin([0.1, 0.2, 0.3, 0.4], 0.15, METRIC_DIRECTION.lowerIsBetter, 4), 75);
  assert.equal(percentileWithin([0.1, 0.2, 0.3, 0.4], 0.35, METRIC_DIRECTION.lowerIsBetter, 4), 25);
});

test("both sides are rounded to the metric's precision before a tie is decided", () => {
  // 0.30004 and 0.29996 are the same value at four decimals, so this is a tie
  // and not a win. Two engineers computing it get the same answer.
  assert.equal(percentileWithin([0.30004], 0.29996, METRIC_DIRECTION.higherIsBetter, 4), 50);
});

test("quartile bands are closed below and open above, so 25, 50 and 75 have one owner", () => {
  assert.equal(quartileFor(75), QUARTILE.top);
  assert.equal(quartileFor(74), QUARTILE.second);
  assert.equal(quartileFor(50), QUARTILE.second);
  assert.equal(quartileFor(49), QUARTILE.third);
  assert.equal(quartileFor(25), QUARTILE.third);
  assert.equal(quartileFor(24), QUARTILE.bottom);
  assert.equal(quartileFor(null), null);
});

test("an even-sized cohort's median is the mean of the two middle values", () => {
  assert.equal(medianOf([1, 2, 3, 4]), 3);
  assert.equal(medianOf([1, 2, 3, 4], 1), 2.5);
  assert.equal(medianOf([3, 1, 2]), 2);
});

// --- selection --------------------------------------------------------------

test("selection prefers the cohort constraining more segment dimensions", () => {
  const broad = selectPeerCohort({ orgUnits: 8, industry: null });
  const close = selectPeerCohort({ orgUnits: 8, industry: PEER_INDUSTRY.saas });
  assert.equal(broad.family, COHORT_FAMILY.organizationSize);
  assert.equal(close.family, COHORT_FAMILY.industry);
  assert.equal(close.selector.industry, PEER_INDUSTRY.saas);
});

test("an industry nobody publishes falls back to the size band, not to nothing", () => {
  const selected = selectPeerCohort({ orgUnits: 2, industry: "haberdashery" });
  assert.equal(selected.family, COHORT_FAMILY.organizationSize);
  assert.ok(selected.selector.orgUnits.min <= 2 && selected.selector.orgUnits.max >= 2);
});

test("selection is deterministic and refuses an org-unit count outside every band", () => {
  assert.equal(selectPeerCohort({ orgUnits: 8 }).cohortId, selectPeerCohort({ orgUnits: 8 }).cohortId);
  assert.equal(selectPeerCohort({ orgUnits: 0 }), null);
  assert.equal(selectPeerCohort({ orgUnits: 100000 }), null);
  assert.equal(selectPeerCohort({}), null);
});

// --- evaluation and its refusals -------------------------------------------

const ORG = Object.freeze({
  literacyScore: 71, highValueShare: 0.38, recoverableShare: 0.11, rubricVersion: RUBRIC,
});

test("a comparable organization is placed in its cohort with both labels", () => {
  const result = evaluatePeerBenchmark({ organization: ORG, segment: { orgUnits: 8 } });
  assert.equal(result.available, true);
  assert.equal(result.version, PEER_COHORT_VERSION);
  assert.equal(result.headline.metricId, HEADLINE_METRIC_ID);
  // 10 of the 12 published members score below 71, none equals it: 10/12 → 83.
  assert.equal(result.headline.percentile, 83);
  assert.equal(result.headline.quartile, QUARTILE.top);
  assert.equal(result.comparability, COMPARABILITY.broad);
  assert.equal(result.confidence, PEER_CONFIDENCE.medium);
  assert.equal(result.comparisons.length, PEER_METRICS.length);
  assert.equal(result.provenance.version, PEER_COHORT_VERSION);
});

test("a declared industry makes the same organization a close match at high confidence", () => {
  const result = evaluatePeerBenchmark({
    organization: ORG, segment: { orgUnits: 8, industry: PEER_INDUSTRY.saas },
  });
  assert.equal(result.comparability, COMPARABILITY.close);
  assert.equal(result.confidence, PEER_CONFIDENCE.high);
  assert.equal(result.cohort.family, COHORT_FAMILY.industry);
});

test("no segment input is a named refusal, not an empty comparison", () => {
  const result = evaluatePeerBenchmark({ organization: ORG, segment: null });
  assert.equal(result.available, false);
  assert.equal(result.unavailable.reason, PEER_UNAVAILABLE_REASON.noSegmentInput);
  assert.equal(result.comparability, COMPARABILITY.none);
  assert.equal(result.headline, null);
  assert.ok(result.unavailable.need.length > 0);
});

test("an organization outside every published band is refused as non-comparable", () => {
  const result = evaluatePeerBenchmark({ organization: ORG, segment: { orgUnits: 4000 } });
  assert.equal(result.unavailable.reason, PEER_UNAVAILABLE_REASON.noMatchingCohort);
});

test("a score from another rubric is refused rather than rescaled", () => {
  const result = evaluatePeerBenchmark({
    organization: { ...ORG, rubricVersion: "literacy-mix/2.0.0" }, segment: { orgUnits: 8 },
  });
  assert.equal(result.unavailable.reason, PEER_UNAVAILABLE_REASON.rubricMismatch);
  assert.match(result.unavailable.detail, /literacy-mix\/2\.0\.0/);
});

test("a cohort with no literacy score to place refuses on the headline metric", () => {
  const result = evaluatePeerBenchmark({
    organization: { highValueShare: 0.3, rubricVersion: RUBRIC }, segment: { orgUnits: 8 },
  });
  assert.equal(result.unavailable.reason, PEER_UNAVAILABLE_REASON.noComparableMetric);
});

test("one absent supporting metric leaves the benchmark available and that metric named", () => {
  const result = evaluatePeerBenchmark({
    organization: { ...ORG, recoverableShare: null }, segment: { orgUnits: 8 },
  });
  assert.equal(result.available, true);
  const recoverable = result.comparisons.find((entry) => entry.metricId === "recoverable_share");
  assert.equal(recoverable.available, false);
  assert.equal(recoverable.unavailable.reason, PEER_UNAVAILABLE_REASON.missingValue);
});

// --- the single prioritized action -----------------------------------------

test("action ranks are unique, so selection never needs a tie-break", () => {
  const ranks = PEER_ACTION_CANDIDATES.map((entry) => entry.rank);
  assert.equal(new Set(ranks).size, ranks.length);
});

test("a bottom-quartile literacy score outranks every spend finding", () => {
  const result = evaluatePeerBenchmark({
    organization: { literacyScore: 40, highValueShare: 0.10, recoverableShare: 0.40, rubricVersion: RUBRIC },
    segment: { orgUnits: 8 },
  });
  assert.equal(result.headline.quartile, QUARTILE.bottom);
  assert.equal(result.action.id, "close_literacy_gap");
  assert.equal(result.action.rank, 1);
});

test("a healthy score with worse-than-median recoverable spend selects the spend action", () => {
  const result = evaluatePeerBenchmark({
    organization: { literacyScore: 74, highValueShare: 0.10, recoverableShare: 0.31, rubricVersion: RUBRIC },
    segment: { orgUnits: 8 },
  });
  assert.equal(result.action.id, "capture_recoverable_gap");
  assert.ok(result.action.gap.length > 0);
});

test("an organization above every median is told to hold, not given a made-up step", () => {
  const result = evaluatePeerBenchmark({
    organization: { literacyScore: 79, highValueShare: 0.48, recoverableShare: 0.08, rubricVersion: RUBRIC },
    segment: { orgUnits: 8 },
  });
  assert.equal(result.action.id, "hold_position");
  assert.equal(result.action.gap, null);
});
