// The finding resolver: which of the four signals the headline states, and why.
//
// The contract this holds is determinism. Same inputs, same winner, same
// runners-up order, on every machine and in every input order — because the
// alternative is a headline that changes when a caller reorders an object
// literal, and nobody would ever see it happen.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CONFIDENCE, CONFIDENCE_WEIGHT, FINDING_KIND, PROVENANCE_KIND, SIGNAL_PRIORITY,
  SPINE_STEP, UNDECLARED_SPINE_STEPS, classifyProvenance, compareFindings,
  downgradeConfidence, resolveHeadlineFinding, scoreFinding,
} from "../src/finops-finding-resolver.js";
import { DECISION_SPINE } from "../src/finops-decision-interaction.js";
import { INTERNAL_GAP_STATUS } from "../src/internal-cost-gap.js";
import { buildStandHeadline } from "../src/finops-stand.js";

// ---------------------------------------------------------------------------
// Signal builders. Each produces the shape the real module publishes, with only
// the fields the resolver reads; the defaults are a usable signal and every
// override is named at its call site.
// ---------------------------------------------------------------------------

const SYNTHETIC_COHORT_PROVENANCE = Object.freeze({
  label: "Published synthetic cost cohorts",
  statement: "Cost cohorts are published synthetic reference data authored in this repository.",
  snapshotId: "2026-01-15",
  rubricVersion: "finops-cost-rubric/v2",
});

const IMPORTED_PROVENANCE = Object.freeze({
  source: "imported export",
  sourceKind: "imported export",
  fixtureId: "",
  snapshotId: "2026-01-15",
});

function peerPosition({ value = 38.63, p25 = 18.4, successfulTasks = 4000,
  provenance = SYNTHETIC_COHORT_PROVENANCE, cohortId = "cohort-mid-saas" } = {}) {
  return {
    available: true,
    band: "bottom_quartile",
    bandLabel: "Bottom quartile",
    value,
    valueDisplay: `$${value.toFixed(2)}`,
    successfulTasks,
    cohort: { cohortId, label: "Mid-market SaaS", p25, p75: 31.5, snapshotId: "2026-01-15" },
    provenance,
  };
}

function teamGap({ gapValue = 10, successfulTasks = 1000, gapBands = 2,
  provenance = { rubricVersion: "finops-cost-rubric/v2", cohortId: "cohort-mid-saas",
    snapshotId: "2026-01-15" }, departmentId = "syn-atlas" } = {}) {
  return {
    status: INTERNAL_GAP_STATUS.finding,
    gapValue,
    gapBands,
    leader: { department: "Beacon", departmentId: "syn-beacon" },
    laggard: { department: "Atlas", departmentId, successfulTasks },
    provenance,
  };
}

function trendMovement({ changeUsd = 12000, changePercent = 8.4 } = {}) {
  return {
    available: true,
    changeUsd,
    changePercent,
    reportingPeriod: "2026-06",
    reportingLabel: "June 2026",
    priorLabel: "May 2026",
    metric: "+12,000.00 USD (+8.4%) versus May 2026",
    action: { available: false, text: "" },
  };
}

function trackedAction({ realizedSavingsUsd = 2350, projectedSavingsUsd = 2439,
  outcomeCode = "successful", comparisonCode = "successful", actionId = "action-a" } = {}) {
  return {
    actionId,
    outcomeCode,
    comparisonCode,
    projectedSavingsUsd,
    realizedSavingsUsd,
    varianceUsd: realizedSavingsUsd - projectedSavingsUsd,
    toleranceUsd: 122,
    provenance: { source: "bundled deterministic synthetic fixture", actionId,
      scoringPolicy: "action-outcome/1.0.0" },
  };
}

// ---------------------------------------------------------------------------
// The manifest, and the shape of a finding
// ---------------------------------------------------------------------------

test("every claim occupies a step the shipped reading spine actually declares", () => {
  // The spine is consumed, not re-derived. A step renamed in the manifest fails
  // here rather than silently letting a claim assert something unspecified.
  assert.deepEqual([...UNDECLARED_SPINE_STEPS], []);
  for (const [kind, step] of Object.entries(SPINE_STEP)) {
    assert.ok(DECISION_SPINE.includes(step), `${kind} claims undeclared step ${step}`);
  }
});

test("a finding carries exactly the published shape, with an impact that has a unit", () => {
  const { winner } = resolveHeadlineFinding({ peerPosition: peerPosition() });
  assert.deepEqual(Object.keys(winner).sort(),
    ["claim", "confidence", "id", "impact", "kind", "provenance", "recommendedAction"]);
  assert.equal(winner.kind, FINDING_KIND.peerPosition);
  assert.equal(winner.id, "peer-position/cohort-mid-saas");
  // A number and its unit, never a bare adjective.
  assert.equal(typeof winner.impact.value, "number");
  assert.equal(winner.impact.unit, "usd");
  assert.ok(winner.impact.basis.length > 0);
  // (38.63 − 18.40) × 4000 successful tasks.
  assert.equal(winner.impact.value, 80920);
  assert.ok(CONFIDENCE.includes(winner.confidence));
  assert.equal(typeof winner.recommendedAction, "string");
  assert.ok(winner.recommendedAction.length > 0);
});

// ---------------------------------------------------------------------------
// Empty and partial evidence
// ---------------------------------------------------------------------------

test("no usable evidence resolves to no winner, no runners-up, and no throw", () => {
  for (const input of [
    undefined,
    {},
    { peerPosition: { available: false, reason: "no cohort" } },
    { teamGap: { status: INTERNAL_GAP_STATUS.suppressed, gapValue: null } },
    { trendMovement: { available: true, changeUsd: 0 } },
    { trackedActionResult: { actionId: "a", varianceUsd: null } },
    { peerPosition: null, teamGap: null, trendMovement: null, trackedActionResult: null },
  ]) {
    const resolution = resolveHeadlineFinding(input);
    assert.equal(resolution.winner, null);
    assert.deepEqual([...resolution.runnersUp], []);
  }
});

test("partial evidence still resolves over whatever is usable", () => {
  const resolution = resolveHeadlineFinding({
    peerPosition: { available: false, reason: "no declared size band" },
    teamGap: teamGap(),
    trendMovement: null,
    trackedActionResult: trackedAction(),
  });
  assert.equal(resolution.winner.kind, FINDING_KIND.teamGap);
  assert.equal(resolution.runnersUp.length, 1);
  assert.equal(resolution.runnersUp[0].kind, FINDING_KIND.trackedActionResult);
});

// ---------------------------------------------------------------------------
// Tie-breaking
// ---------------------------------------------------------------------------

test("a score tie falls back to declared signal priority, then to id", () => {
  // Two findings, deliberately equal: the peer position clears its lower
  // quartile by $10 across 1,000 tasks, the team gap is $10 across 1,000 tasks,
  // and both are downgraded from high to medium on synthetic provenance.
  const inputs = {
    peerPosition: peerPosition({ value: 28.4, p25: 18.4, successfulTasks: 1000 }),
    teamGap: teamGap({ gapValue: 10, successfulTasks: 1000 }),
  };
  const resolution = resolveHeadlineFinding(inputs);
  assert.equal(scoreFinding(resolution.winner), scoreFinding(resolution.runnersUp[0]),
    "the two candidates must actually tie for this to be a tie-break test");
  // Declared priority: peer position precedes the team gap.
  assert.ok(SIGNAL_PRIORITY.indexOf(FINDING_KIND.peerPosition)
    < SIGNAL_PRIORITY.indexOf(FINDING_KIND.teamGap));
  assert.equal(resolution.winner.kind, FINDING_KIND.peerPosition);
  assert.equal(resolution.runnersUp[0].kind, FINDING_KIND.teamGap);
});

test("the winner and the runners-up order are stable under every input permutation", () => {
  const signals = {
    peerPosition: peerPosition(),
    teamGap: teamGap(),
    trendMovement: trendMovement(),
    trackedActionResult: trackedAction(),
  };
  const keys = Object.keys(signals);
  const expected = resolveHeadlineFinding(signals);
  const order = (resolution) => [resolution.winner.id, ...resolution.runnersUp.map((f) => f.id)];
  // Every one of the 24 key orders. An object literal's key order is the only
  // thing changing, which is exactly the input-order dependence being ruled out.
  const permute = (rest, prefix = []) => (rest.length === 0 ? [prefix]
    : rest.flatMap((key, index) =>
      permute([...rest.slice(0, index), ...rest.slice(index + 1)], [...prefix, key])));
  const permutations = permute(keys);
  assert.equal(permutations.length, 24);
  for (const permutation of permutations) {
    const shuffled = Object.fromEntries(permutation.map((key) => [key, signals[key]]));
    assert.deepEqual(order(resolveHeadlineFinding(shuffled)), order(expected),
      `input order ${permutation.join(",")} changed the ranking`);
  }
});

test("two distinct findings never compare equal, so the order is total", () => {
  const { winner, runnersUp } = resolveHeadlineFinding({
    peerPosition: peerPosition({ value: 28.4, p25: 18.4, successfulTasks: 1000 }),
    teamGap: teamGap({ gapValue: 10, successfulTasks: 1000 }),
  });
  assert.ok(compareFindings(winner, runnersUp[0]) < 0);
  assert.ok(compareFindings(runnersUp[0], winner) > 0);
});

// ---------------------------------------------------------------------------
// Confidence downgrade
// ---------------------------------------------------------------------------

test("synthetic-cohort provenance is one confidence step below the same imported finding", () => {
  const synthetic = resolveHeadlineFinding({ peerPosition: peerPosition() }).winner;
  const imported = resolveHeadlineFinding({
    peerPosition: peerPosition({ provenance: IMPORTED_PROVENANCE }),
  }).winner;
  // Identical numbers, so only the provenance can be moving the confidence.
  assert.equal(synthetic.impact.value, imported.impact.value);
  assert.equal(imported.confidence, "high");
  assert.equal(synthetic.confidence, "medium");
  assert.equal(synthetic.confidence, downgradeConfidence(imported.confidence));
  assert.ok(CONFIDENCE_WEIGHT[synthetic.confidence] < CONFIDENCE_WEIGHT[imported.confidence]);
  assert.ok(scoreFinding(synthetic) < scoreFinding(imported));
});

test("a signal that publishes no provenance is classified unknown and downgraded with it", () => {
  const trail = classifyProvenance(null);
  assert.equal(trail.kind, PROVENANCE_KIND.unknown);
  const { winner } = resolveHeadlineFinding({ trendMovement: trendMovement() });
  assert.equal(winner.kind, FINDING_KIND.trendMovement);
  assert.equal(winner.provenance.kind, PROVENANCE_KIND.unknown);
  assert.equal(winner.confidence, "medium", "high, downgraded once for an unfollowable trail");
});

test("the downgrade decides the winner when the bigger number is the synthetic one", () => {
  // $100,000 on synthetic boundaries against $70,000 on the reader's own export.
  // Raw magnitude says the peer position; the weighting says otherwise, because
  // 100,000 × 0.6 = 60,000 is less than 70,000 × 1.0.
  const big = peerPosition({ value: 118.4, p25: 18.4, successfulTasks: 1000 });
  const smallerButReal = teamGap({ gapValue: 70, successfulTasks: 1000,
    provenance: { source: "imported export", snapshotId: "2026-01-15" } });
  assert.equal(resolveHeadlineFinding({ peerPosition: big }).winner.impact.value, 100000);
  assert.equal(resolveHeadlineFinding({ teamGap: smallerButReal }).winner.impact.value, 70000);

  const resolution = resolveHeadlineFinding({ peerPosition: big, teamGap: smallerButReal });
  assert.equal(resolution.winner.kind, FINDING_KIND.teamGap);
  assert.equal(resolution.winner.confidence, "high");
  assert.equal(resolution.runnersUp[0].kind, FINDING_KIND.peerPosition);
  assert.equal(resolution.runnersUp[0].confidence, "medium");

  // And the downgrade is doing the work: with the same team gap on synthetic
  // provenance, the larger peer figure wins instead.
  const bothSynthetic = resolveHeadlineFinding({
    peerPosition: big, teamGap: teamGap({ gapValue: 70, successfulTasks: 1000 }),
  });
  assert.equal(bothSynthetic.winner.kind, FINDING_KIND.peerPosition);
});

// ---------------------------------------------------------------------------
// Provenance is a trail, not a boolean
// ---------------------------------------------------------------------------

test("the winner carries the source kind and identifier of the signal it came from", () => {
  const { winner } = resolveHeadlineFinding({ peerPosition: peerPosition() });
  assert.equal(winner.provenance.signal, FINDING_KIND.peerPosition);
  assert.equal(winner.provenance.kind, PROVENANCE_KIND.syntheticCohort);
  assert.equal(winner.provenance.sourceKind, SYNTHETIC_COHORT_PROVENANCE.label);
  assert.equal(winner.provenance.identifier, SYNTHETIC_COHORT_PROVENANCE.snapshotId);
  assert.ok(winner.provenance.statement.includes("published synthetic reference data"));
  // The record itself is carried, so the trail does not stop at this module.
  assert.equal(winner.provenance.record, SYNTHETIC_COHORT_PROVENANCE);
});

test("each signal's own provenance travels with its own finding, not the winner's", () => {
  const resolution = resolveHeadlineFinding({
    peerPosition: peerPosition(),
    trackedActionResult: trackedAction({ realizedSavingsUsd: 0, projectedSavingsUsd: 40000,
      outcomeCode: "under_target", comparisonCode: "under_target", actionId: "action-b" }),
  });
  const byKind = Object.fromEntries(
    [resolution.winner, ...resolution.runnersUp].map((f) => [f.kind, f]));
  assert.equal(byKind[FINDING_KIND.trackedActionResult].provenance.identifier, "action-b");
  assert.equal(byKind[FINDING_KIND.peerPosition].provenance.identifier, "2026-01-15");
});

// ---------------------------------------------------------------------------
// Purity, and the surface
// ---------------------------------------------------------------------------

test("the resolver is pure: same input object, same result, twice", () => {
  const signals = { peerPosition: peerPosition(), teamGap: teamGap(),
    trendMovement: trendMovement(), trackedActionResult: trackedAction() };
  const first = resolveHeadlineFinding(signals);
  const second = resolveHeadlineFinding(signals);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.winner));
});

test("the /evolution.html headline states the resolver's winner and nothing else", () => {
  const headline = buildStandHeadline();
  assert.ok(headline.resolution.winner, "the bundled example must resolve a finding");
  assert.equal(headline.answer, headline.resolution.winner.claim);
  // Runners-up are returned for a later disclosure and are not in the sentence.
  assert.ok(headline.resolution.runnersUp.length > 0);
  for (const runnerUp of headline.resolution.runnersUp) {
    assert.notEqual(headline.answer, runnerUp.claim);
  }
});
