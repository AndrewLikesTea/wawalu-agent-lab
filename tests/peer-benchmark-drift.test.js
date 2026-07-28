// Drift detection for the peer benchmark.
//
// WHAT DRIFT LOOKS LIKE HERE
// --------------------------
// Nobody sets out to change a director's percentile. It happens when a cohort
// member's number is edited to make a screenshot look better, when a threshold
// is nudged to make one action fire, or when the published data changes and the
// version stamped on every exported briefing does not. The reader sees the same
// version string over a different number, and there is no way left to tell which
// briefing was computed under which rules.
//
// So this file pins three things, each with the sentence a failing assertion
// should be read as:
//
//   1. THE PUBLISHED COHORT — "you changed the reference data; bump the version."
//   2. THE SCORING RULES — "you changed how a percentile is computed; bump the
//      version and restate the assumption in tests/support/peer-fixtures.js."
//   3. PRIORITIZED-ACTION SELECTION — "you changed which single action a reader
//      is given; that is an editorial change, not a refactor."
//
// These assertions are deliberately literal and deliberately annoying to update.
// The reproducibility suite next door proves the numbers are reproducible; this
// one proves nobody moved them quietly. The assumption behind every weight named
// below is stated in `tests/support/peer-fixtures.js`.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  COHORT_FAMILY, COMPARABILITY, HEADLINE_METRIC_ID, METRIC_DIRECTION, MIN_COHORT_MEMBERS,
  PEER_ACTION_CANDIDATES, PEER_COHORTS, PEER_COHORT_PROVENANCE, PEER_COHORT_VERSION,
  PEER_CONFIDENCE, PEER_METRICS, PEER_UNAVAILABLE_REASON, QUARTILE,
  evaluatePeerBenchmark, peerConfidenceFor, percentileWithin, quartileFor,
} from "../src/peer-cohort-contract.js";
import {
  PEER_COHORT_RUBRIC_VERSION, PEER_COHORT_SNAPSHOT_DATE,
} from "../src/peer-cohort-fixtures.js";
import { IMPORTED_PEER_BENCHMARK_VERSION } from "../src/imported-peer-benchmark.js";
import { PEER_FIXTURES, RUBRIC } from "./support/peer-fixtures.js";

const DOC_URL = new URL("../docs/peer-cohort-contract.md", import.meta.url);
const doc = await readFile(DOC_URL, "utf8");

// ---------------------------------------------------------------------------
// 1. The published cohort.
// ---------------------------------------------------------------------------

test("the published versions are the ones every briefing was stamped with", () => {
  assert.equal(PEER_COHORT_VERSION, "finops-peer-cohort/1.0.0");
  assert.equal(PEER_COHORT_SNAPSHOT_DATE, "2026-06-30");
  assert.equal(PEER_COHORT_RUBRIC_VERSION, "literacy-mix/1.0.0");
  assert.equal(IMPORTED_PEER_BENCHMARK_VERSION, "imported-peer-benchmark/1.1.0");
  // The provenance block a reader is shown restates the same three, so a version
  // cannot advance in one place and stay behind in another.
  assert.equal(PEER_COHORT_PROVENANCE.version, PEER_COHORT_VERSION);
  assert.equal(PEER_COHORT_PROVENANCE.snapshotDate, PEER_COHORT_SNAPSHOT_DATE);
  assert.equal(PEER_COHORT_PROVENANCE.rubricVersion, PEER_COHORT_RUBRIC_VERSION);
});

test("the published contract document names the version the code publishes", () => {
  assert.ok(doc.includes(`\`${PEER_COHORT_VERSION}\``),
    `docs/peer-cohort-contract.md does not name ${PEER_COHORT_VERSION}`);
});

test("the cohort roster is the published one", () => {
  const roster = PEER_COHORTS.map((cohort) => [
    cohort.cohortId, cohort.family, cohort.selector.industry,
    cohort.selector.orgUnits.min, cohort.selector.orgUnits.max, cohort.members.length,
  ]);
  assert.deepEqual(roster, [
    ["size-focused", COHORT_FAMILY.organizationSize, null, 1, 4, 12],
    ["size-scaling", COHORT_FAMILY.organizationSize, null, 5, 14, 12],
    ["size-enterprise", COHORT_FAMILY.organizationSize, null, 15, 500, 12],
    ["industry-saas", COHORT_FAMILY.industry, "saas", 5, 500, 12],
    ["industry-financial-services", COHORT_FAMILY.industry, "financial_services", 5, 500, 12],
  ]);
  // The bands tile the published range with no gap and no overlap inside a
  // family: an org-unit count cannot match two size cohorts or none of them.
  const sizes = PEER_COHORTS.filter((cohort) => cohort.family === COHORT_FAMILY.organizationSize);
  for (let index = 1; index < sizes.length; index += 1) {
    assert.equal(sizes[index].selector.orgUnits.min, sizes[index - 1].selector.orgUnits.max + 1);
  }
});

/**
 * Every published number, as one digest.
 *
 * A digest rather than a table of 180 values because the point is not to make
 * the numbers readable here — they are readable in
 * `src/peer-cohort-fixtures.js` — but to make an edit to any of them
 * impossible to land without saying so.
 */
const cohortDigest = (cohorts = PEER_COHORTS) => createHash("sha256").update(
  [...cohorts]
    .sort((left, right) => left.cohortId.localeCompare(right.cohortId))
    .map((cohort) => [
      cohort.cohortId, cohort.family, cohort.selector.industry ?? "-",
      cohort.selector.orgUnits.min, cohort.selector.orgUnits.max,
      cohort.segmentLabel, cohort.rubricVersion, cohort.snapshotDate,
      ...[...cohort.members]
        .sort((left, right) => left.memberId.localeCompare(right.memberId))
        .map((member) =>
          `${member.memberId}:${member.literacyScore}:${member.highValueShare}:${member.recoverableShare}`),
    ].join("|"))
    .join("\n"),
).digest("hex");

test("no published cohort value changed without a version bump", () => {
  assert.equal(cohortDigest(),
    "f5e73ea707651d172e79a15675ef3dd71d74612c85a49f528bc54a901a26c37e",
    `A published cohort value changed. That moves every reader's percentile: bump `
    + `PEER_COHORT_VERSION (currently ${PEER_COHORT_VERSION}) and PEER_COHORT_SNAPSHOT_DATE, `
    + "then update this digest in the same commit.");
});

test("cohort and member delivery order is not contract drift", () => {
  const reordered = [...PEER_COHORTS].reverse().map((cohort) => ({
    ...cohort,
    members: [...cohort.members].reverse(),
  }));
  assert.equal(cohortDigest(reordered), cohortDigest(),
    "canonical drift detection must describe cohort content, not serialization order");
});

test("a cohort member still carries an opaque id and the three declared metrics, nothing else", () => {
  const allowed = ["memberId", ...PEER_METRICS.map((metric) => metric.field)].sort();
  for (const cohort of PEER_COHORTS) {
    for (const member of cohort.members) {
      assert.deepEqual(Object.keys(member).sort(), allowed, `${cohort.cohortId}/${member.memberId}`);
      assert.match(member.memberId, /^syn-[a-z]+-\d{2}$/);
    }
  }
});

test("every result carries the version it was computed under", () => {
  for (const row of PEER_FIXTURES) {
    const result = evaluatePeerBenchmark({ organization: row.organization, segment: row.segment });
    assert.equal(result.version, PEER_COHORT_VERSION, row.id);
    assert.equal(result.provenance.version, PEER_COHORT_VERSION, row.id);
    assert.equal(result.provenance.snapshotDate, PEER_COHORT_SNAPSHOT_DATE, row.id);
  }
});

// ---------------------------------------------------------------------------
// 2. The scoring rules.
// ---------------------------------------------------------------------------

test("the metric table is the published one, precision and direction included", () => {
  assert.deepEqual(PEER_METRICS.map((metric) => [
    metric.id, metric.field, metric.decimals, metric.direction,
    metric.domain.min, metric.domain.max,
  ]), [
    // Precision is part of the rule, not a display choice: it decides the tie set.
    ["literacy_score", "literacyScore", 0, METRIC_DIRECTION.higherIsBetter, 0, 100],
    ["high_value_share", "highValueShare", 4, METRIC_DIRECTION.higherIsBetter, 0, 1],
    // Lower is better: a large recoverable share is avoidable spend still on the
    // invoice. Inverting this would reverse every reader's standing silently.
    ["recoverable_share", "recoverableShare", 4, METRIC_DIRECTION.lowerIsBetter, 0, 1],
  ]);
  assert.equal(HEADLINE_METRIC_ID, "literacy_score");
  // The document a reviewer reads declares the same three metrics.
  for (const metric of PEER_METRICS) assert.ok(doc.includes(`\`${metric.id}\``), metric.id);
});

test("the tie convention is mid-rank and rounds before it compares", () => {
  // Each line is one arm of the rule, with the answer the documented formula
  // gives: (worse + equal / 2) / members, rounded half-up.
  assert.equal(percentileWithin([5, 5, 5, 5], 5, METRIC_DIRECTION.higherIsBetter), 50);
  assert.equal(percentileWithin([1, 2, 3, 4], 3, METRIC_DIRECTION.higherIsBetter), 63);
  assert.equal(percentileWithin([1, 2, 3, 4], 9, METRIC_DIRECTION.higherIsBetter), 100);
  assert.equal(percentileWithin([1, 2, 3, 4], 0, METRIC_DIRECTION.higherIsBetter), 0);
  assert.equal(percentileWithin([0.1, 0.2, 0.3, 0.4], 0.15, METRIC_DIRECTION.lowerIsBetter, 4), 75);
  // Round-before-compare: these two differ by 8e-5 and are one value at 4 dp.
  assert.equal(percentileWithin([0.30004], 0.29996, METRIC_DIRECTION.higherIsBetter, 4), 50);
  assert.equal(percentileWithin([], 1, METRIC_DIRECTION.higherIsBetter), null);
});

test("quartile edges belong to exactly one band", () => {
  assert.deepEqual([100, 75, 74, 50, 49, 25, 24, 0].map(quartileFor), [
    QUARTILE.top, QUARTILE.top, QUARTILE.second, QUARTILE.second,
    QUARTILE.third, QUARTILE.third, QUARTILE.bottom, QUARTILE.bottom,
  ]);
  assert.equal(quartileFor(null), null);
});

test("the member floor and the confidence thresholds are the published ones", () => {
  assert.equal(MIN_COHORT_MEMBERS, 8);
  assert.deepEqual([
    peerConfidenceFor(COMPARABILITY.close, 12), peerConfidenceFor(COMPARABILITY.broad, 12),
    peerConfidenceFor(COMPARABILITY.close, 11), peerConfidenceFor(COMPARABILITY.broad, 11),
  ], [PEER_CONFIDENCE.high, PEER_CONFIDENCE.medium, PEER_CONFIDENCE.low, PEER_CONFIDENCE.low]);
  for (const cohort of PEER_COHORTS) {
    assert.ok(cohort.members.length >= MIN_COHORT_MEMBERS, cohort.cohortId);
  }
});

test("the refusal codes are wire values and none of them disappeared", () => {
  assert.deepEqual(Object.values(PEER_UNAVAILABLE_REASON).sort(), [
    "no_comparable_peer_metric", "no_matching_peer_cohort", "no_organization_metric_value",
    "no_peer_segment_input", "peer_cohort_below_member_floor", "peer_rubric_version_mismatch",
  ]);
  for (const code of Object.values(PEER_UNAVAILABLE_REASON)) {
    assert.ok(doc.includes(`\`${code}\``), `docs/peer-cohort-contract.md does not document ${code}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Prioritized-action selection.
// ---------------------------------------------------------------------------

test("the action table is the published one, rank and accountable role included", () => {
  assert.deepEqual(PEER_ACTION_CANDIDATES.map((entry) => [
    entry.rank, entry.id, entry.metricId, entry.accountableRole, entry.trigger,
  ]), [
    [1, "close_literacy_gap", "literacy_score", "Platform Engineering Lead",
      "literacy percentile below the 25th"],
    [2, "capture_recoverable_gap", "recoverable_share", "FinOps Data Owner",
      "recoverable share worse than the cohort median"],
    [3, "raise_high_value_share", "high_value_share", "Platform Engineering Lead",
      "high-value share worse than the cohort median"],
    [4, "hold_position", "literacy_score", "Platform Engineering Lead",
      "no published metric sits below the cohort median"],
  ]);
  const ranks = PEER_ACTION_CANDIDATES.map((entry) => entry.rank);
  assert.equal(new Set(ranks).size, ranks.length, "ranks must stay unique: selection has no tie-break");
  for (const entry of PEER_ACTION_CANDIDATES) {
    assert.ok(doc.includes(`\`${entry.id}\``), `docs/peer-cohort-contract.md does not list ${entry.id}`);
  }
});

/**
 * The selection truth table.
 *
 * Every row is evaluated against the same published cohort (`size-scaling`), so
 * only the organization's three numbers vary and the selected action is the only
 * thing under test. The percentile each value produces is in the comment beside
 * it; those placements are proved in the reproducibility suite.
 */
const SELECTION = [
  // literacy, high-value, recoverable, expected action
  [50, 0.40, 0.10, "close_literacy_gap"], //  21 / 83 / 92 — bottom quartile fires rank 1
  [52, 0.40, 0.10, "hold_position"], //       25 / 83 / 92 — exactly 25 does NOT fire rank 1
  [68, 0.40, 0.22, "capture_recoverable_gap"], // 75 / 83 / 46 — below the median fires rank 2
  [68, 0.40, 0.21, "hold_position"], //       75 / 83 / 50 — exactly at the median does not
  [68, 0.28, 0.10, "raise_high_value_share"], // 75 / 46 / 92 — rank 3 when rank 2 is clear
  [68, 0.30, 0.10, "hold_position"], //       75 / 50 / 92 — exactly at the median does not
  [68, 0.20, 0.30, "capture_recoverable_gap"], // rank 2 outranks rank 3 when both are behind
  [50, 0.20, 0.30, "close_literacy_gap"], //  rank 1 outranks both spend findings
];

test("action selection is the published rank order at every trigger edge", () => {
  for (const [literacyScore, highValueShare, recoverableShare, expected] of SELECTION) {
    const result = evaluatePeerBenchmark({
      organization: { literacyScore, highValueShare, recoverableShare, rubricVersion: RUBRIC },
      segment: { orgUnits: 8 },
    });
    assert.equal(result.cohort.cohortId, "size-scaling");
    assert.equal(result.action.id, expected,
      `${literacyScore}/${highValueShare}/${recoverableShare} selected ${result.action.id}`);
    assert.equal(result.action.rank,
      PEER_ACTION_CANDIDATES.find((entry) => entry.id === expected).rank);
  }
});

test("exactly one action is published, and never one with no measurement under it", () => {
  for (const row of PEER_FIXTURES) {
    const result = evaluatePeerBenchmark({ organization: row.organization, segment: row.segment });
    if (!result.available) {
      // A refused benchmark publishes no action at all: a suggestion with no
      // comparison under it is not an action.
      assert.equal(result.action, null, row.id);
      continue;
    }
    assert.equal(result.action.available, true, row.id);
    assert.equal(typeof result.action.text, "string", row.id);
    assert.ok(result.action.text.length > 0, row.id);
    const comparison = result.comparisons.find(
      (entry) => entry.metricId === result.action.metricId);
    assert.equal(comparison.available, true, `${row.id} acts on an unavailable metric`);
  }
});

test("the hold action is the only one that publishes no gap", () => {
  for (const row of PEER_FIXTURES) {
    const result = evaluatePeerBenchmark({ organization: row.organization, segment: row.segment });
    if (!result.available) continue;
    assert.equal(result.action.gap === null, result.action.id === "hold_position", row.id);
  }
});

// ---------------------------------------------------------------------------
// The fixture set itself, so coverage cannot quietly shrink.
// ---------------------------------------------------------------------------

test("the labelled fixture set still covers every case this suite was built for", () => {
  const kinds = new Set(PEER_FIXTURES.map((row) => row.kind));
  for (const required of ["comparable", "boundary", "tie", "partial", "missing_segment", "non_comparable"]) {
    assert.ok(kinds.has(required), `no labelled fixture covers "${required}"`);
  }
  const ids = PEER_FIXTURES.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, "fixture ids must be unique");
  // Every published cohort is exercised by at least one comparable fixture, so a
  // cohort cannot be edited with nothing asserting what it produces.
  const exercised = new Set(PEER_FIXTURES.map((row) => row.expect.cohortId).filter(Boolean));
  for (const cohortId of ["size-focused", "size-scaling", "size-enterprise", "industry-saas"]) {
    assert.ok(exercised.has(cohortId), `no fixture is placed in ${cohortId}`);
  }
});
