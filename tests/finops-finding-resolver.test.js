// The finding resolver: what wins, why it wins, and that it wins every time.
//
// The contract under test is that the headline of the AI FinOps page is chosen
// by a rule rather than by construction. So the assertions here are about the
// RULE: a tie resolves the same way on every run and in every input order, an
// empty input is a shape rather than a throw, and a number that rests on
// synthetic cohort boundaries is confessed as one in the confidence level and
// in a reason code beside it.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CONFIDENCE_LEVELS, CONFIDENCE_REASON, FINDING_REJECTED, PROVENANCE_KIND, RANKING_RULE_ORDER,
  applyProvenanceConfidence, decidingRule, materialityOf, resolveFinding, sentenceCount,
} from "../src/finops-finding-resolver.js";
import {
  FINOPS_SPINE_MANIFEST, SPINE_CLAIM_KIND, SPINE_DIRECTION, SPINE_ROLE, SPINE_UNIT,
  headlineClaimKind, headlineKindPriority,
} from "../src/finops-spine-manifest.js";
import { STAND_IDS } from "../src/finops-stand.js";

/** A well-formed signal. Tests override only the field under test. */
const signal = (overrides = {}) => ({
  id: "peer-position",
  signalKind: SPINE_CLAIM_KIND.peerPosition,
  claim: "Your AI spend is in the most expensive quarter of organizations like yours.",
  impact: {
    value: 2,
    unit: SPINE_UNIT.quartilesFromCheapest,
    direction: SPINE_DIRECTION.worseThanPeers,
  },
  confidence: { level: "high", reasons: [] },
  provenance: { kind: PROVENANCE_KIND.imported, label: "Your own export", id: "2026-06" },
  recommendedAction: "Open the routing candidates.",
  ...overrides,
});

// ---------------------------------------------------------------------------
// The manifest is consumed, not re-derived.
// ---------------------------------------------------------------------------

test("the headline region the manifest declares is the region the composer publishes", () => {
  assert.equal(FINOPS_SPINE_MANIFEST.headline.role, SPINE_ROLE.headline);
  // Neither module imports the other: the manifest may not depend on a composer
  // it constrains. This assertion is what keeps the one decision one decision.
  assert.equal(FINOPS_SPINE_MANIFEST.headline.regionId, STAND_IDS.region);
  assert.equal(FINOPS_SPINE_MANIFEST.headline.maxClaims, 1);
});

test("a claim kind the manifest does not declare cannot reach the headline", () => {
  const resolved = resolveFinding([signal({ signalKind: "vendor_gossip" })]);
  assert.equal(resolved.winner, null);
  assert.deepEqual(resolved.rejected.map((row) => row.code),
    [FINDING_REJECTED.kindNotPermitted]);
});

test("an impact in the wrong unit or a direction the kind does not admit is refused", () => {
  const wrongUnit = resolveFinding([signal({
    impact: { value: 2, unit: SPINE_UNIT.usdPerMonth, direction: SPINE_DIRECTION.worseThanPeers },
  })]);
  assert.equal(wrongUnit.rejected[0].code, FINDING_REJECTED.unitNotPermitted);
  const wrongDirection = resolveFinding([signal({
    impact: {
      value: 2, unit: SPINE_UNIT.quartilesFromCheapest, direction: SPINE_DIRECTION.recoverable,
    },
  })]);
  assert.equal(wrongDirection.rejected[0].code, FINDING_REJECTED.directionNotPermitted);
});

test("a claim longer than the manifest's sentence limit is refused, not truncated", () => {
  const long = "One. Two. Three. Four.";
  assert.equal(sentenceCount(long), 4);
  assert.ok(sentenceCount(long) > FINOPS_SPINE_MANIFEST.headline.maxSentences);
  const resolved = resolveFinding([signal({ claim: long })]);
  assert.equal(resolved.winner, null);
  assert.equal(resolved.rejected[0].code, FINDING_REJECTED.claimTooLong);
});

// ---------------------------------------------------------------------------
// Empty evidence.
// ---------------------------------------------------------------------------

for (const [name, input] of [
  ["no argument at all", undefined],
  ["an empty array", []],
  ["null", null],
  ["a non-iterable", 7],
  ["only unavailable signals", [signal({ available: false })]],
  ["only refused signals", [signal({ claim: "  " })]],
]) {
  test(`empty evidence — ${name} — returns a well-formed empty result and does not throw`, () => {
    const resolved = resolveFinding(input);
    assert.equal(resolved.winner, null);
    assert.deepEqual(resolved.runnersUp, []);
    assert.ok(Array.isArray(resolved.rejected), "rejections are always an array");
    assert.deepEqual(resolved.ruleOrder, RANKING_RULE_ORDER);
    // Explicitly: not undefined, and not a throw the caller has to catch.
    assert.notEqual(resolved, undefined);
  });
}

test("a signal with no id is refused rather than ranked against an unstable tiebreak", () => {
  const resolved = resolveFinding([signal({ id: "" })]);
  assert.equal(resolved.winner, null);
  assert.equal(resolved.rejected[0].code, FINDING_REJECTED.noId);
});

// ---------------------------------------------------------------------------
// Tie-breaking and determinism.
// ---------------------------------------------------------------------------

/**
 * Two signals of the same kind, the same confidence, the same impact and the
 * same provenance: every rule in the chain ties except the last one.
 */
const TIED_A = signal({ id: "aardvark-gap", signalKind: SPINE_CLAIM_KIND.departmentGap,
  claim: "Aardvark is 2 quarters behind.",
  impact: { value: 2, unit: SPINE_UNIT.quartilesBehind, direction: SPINE_DIRECTION.behind } });
const TIED_B = signal({ id: "zebra-gap", signalKind: SPINE_CLAIM_KIND.departmentGap,
  claim: "Zebra is 2 quarters behind.",
  impact: { value: 2, unit: SPINE_UNIT.quartilesBehind, direction: SPINE_DIRECTION.behind } });

test("two equally scoring signals resolve on the stable signal id, in both input orders", () => {
  const forward = resolveFinding([TIED_A, TIED_B]);
  const reverse = resolveFinding([TIED_B, TIED_A]);
  // The specific deterministic answer, not merely "a winner exists": ids
  // ascending, so the lower id leads.
  assert.equal(forward.winner.id, "aardvark-gap");
  assert.equal(reverse.winner.id, "aardvark-gap");
  assert.deepEqual(forward.runnersUp.map((row) => row.id), ["zebra-gap"]);
  assert.deepEqual(reverse.runnersUp.map((row) => row.id), ["zebra-gap"]);
  // And the rule that separated them is named, so the tiebreak is traceable.
  assert.equal(decidingRule(forward.winner, forward.runnersUp[0]), "signal_id");
});

test("a repeated signal id is refused on both sides rather than resolved by position", () => {
  const resolved = resolveFinding([TIED_A, { ...TIED_B, id: TIED_A.id }]);
  assert.equal(resolved.winner, null);
  assert.deepEqual(resolved.rejected.map((row) => row.code),
    [FINDING_REJECTED.duplicateId, FINDING_REJECTED.duplicateId]);
});

test("the same input resolves to the same winner however the input is ordered", () => {
  const pool = [
    signal({ id: "peer-position" }),
    signal({ id: "spend-trend", signalKind: SPINE_CLAIM_KIND.spendTrend,
      claim: "Analyzed AI spend moved +$9,000.00 versus May 2026.",
      impact: { value: 9000, unit: SPINE_UNIT.usdPerMonth, direction: SPINE_DIRECTION.increase } }),
    signal({ id: "department-gap", signalKind: SPINE_CLAIM_KIND.departmentGap,
      claim: "Boreal is 1 quarter behind.",
      impact: { value: 1, unit: SPINE_UNIT.quartilesBehind, direction: SPINE_DIRECTION.behind } }),
    signal({ id: "recoverable-spend", signalKind: SPINE_CLAIM_KIND.recoverableSpend,
      claim: "$51,254 is modelled as recoverable.",
      impact: { value: 51254, unit: SPINE_UNIT.usdPerMonth,
        direction: SPINE_DIRECTION.recoverable } }),
  ];
  const baseline = resolveFinding(pool);
  const order = baseline.runnersUp.map((row) => row.id);
  // Every rotation of the input is a different iteration order into the sort.
  for (let shift = 0; shift < pool.length; shift += 1) {
    const shuffled = [...pool.slice(shift), ...pool.slice(0, shift)];
    const again = resolveFinding(shuffled);
    assert.equal(again.winner.id, baseline.winner.id, `rotation ${shift} moved the winner`);
    assert.deepEqual(again.runnersUp.map((row) => row.id), order,
      `rotation ${shift} moved the runners-up`);
  }
  // Resolving the identical input twice is identical, field for field.
  assert.deepEqual(resolveFinding(pool), baseline);
  // And the manifest's declared priority is what put the position first.
  assert.equal(baseline.winner.signalKind, SPINE_CLAIM_KIND.peerPosition);
  assert.equal(headlineKindPriority(SPINE_CLAIM_KIND.peerPosition), 0);
});

test("materiality outranks manifest priority, and confidence outranks both", () => {
  // An immaterial position (already in the cheapest quarter, distance 0) loses
  // to a material trend even though the manifest ranks position first.
  const immaterialPosition = signal({
    impact: { value: 0, unit: SPINE_UNIT.quartilesFromCheapest,
      direction: SPINE_DIRECTION.betterThanPeers },
  });
  const materialTrend = signal({ id: "spend-trend", signalKind: SPINE_CLAIM_KIND.spendTrend,
    claim: "Analyzed AI spend moved +$40,000.00 versus May 2026.",
    impact: { value: 40000, unit: SPINE_UNIT.usdPerMonth, direction: SPINE_DIRECTION.increase } });
  const byMateriality = resolveFinding([immaterialPosition, materialTrend]);
  assert.equal(byMateriality.winner.id, "spend-trend");
  assert.equal(decidingRule(byMateriality.winner, byMateriality.runnersUp[0]), "materiality");

  // Both material, but the position is only "low" confidence: confidence is
  // checked before the manifest's kind order.
  const weakPosition = signal({ confidence: { level: "low", reasons: [] } });
  const byConfidence = resolveFinding([weakPosition, materialTrend]);
  assert.equal(byConfidence.winner.id, "spend-trend");
  assert.equal(decidingRule(byConfidence.winner, byConfidence.runnersUp[0]), "confidence");

  assert.equal(materialityOf({ value: 1 }, headlineClaimKind(SPINE_CLAIM_KIND.peerPosition)),
    "major");
  assert.equal(materialityOf({ value: 0 }, headlineClaimKind(SPINE_CLAIM_KIND.peerPosition)),
    "none");
});

test("dollars are never compared with quartiles when the magnitude rule is reached", () => {
  // Same materiality, same confidence, same kind priority is impossible across
  // kinds — so the magnitude rule is asserted directly on its own contract.
  const dollars = resolveFinding([
    signal({ id: "trend-small", signalKind: SPINE_CLAIM_KIND.spendTrend,
      claim: "Spend moved +$6,000.00.",
      impact: { value: 6000, unit: SPINE_UNIT.usdPerMonth, direction: SPINE_DIRECTION.increase } }),
    signal({ id: "trend-large", signalKind: SPINE_CLAIM_KIND.spendTrend,
      claim: "Spend moved +$60,000.00.",
      impact: { value: 60000, unit: SPINE_UNIT.usdPerMonth, direction: SPINE_DIRECTION.increase } }),
  ]);
  assert.equal(dollars.winner.id, "trend-large");
  assert.equal(decidingRule(dollars.winner, dollars.runnersUp[0]), "impact_magnitude");
});

// ---------------------------------------------------------------------------
// The confidence downgrade.
// ---------------------------------------------------------------------------

test("the same signal drops a confidence level on synthetic cohorts and records why", () => {
  const imported = resolveFinding([signal({
    provenance: { kind: PROVENANCE_KIND.imported, label: "Your own export", id: "2026-06" },
  })]).winner;
  const synthetic = resolveFinding([signal({
    provenance: {
      kind: PROVENANCE_KIND.synthetic, label: "Published synthetic cost cohorts", id: "2026-06-30",
    },
  })]).winner;

  // Same stated level in, one level apart out.
  assert.equal(imported.confidence.statedLevel, "high");
  assert.equal(synthetic.confidence.statedLevel, "high");
  assert.equal(imported.confidence.level, "high");
  assert.equal(synthetic.confidence.level, "moderate");
  assert.equal(CONFIDENCE_LEVELS.indexOf(imported.confidence.level)
    - CONFIDENCE_LEVELS.indexOf(synthetic.confidence.level), 1, "exactly one level");

  // And the reason travels with the level, so the downgrade is traceable rather
  // than merely visible in the outcome.
  assert.ok(synthetic.confidence.reasons.includes(CONFIDENCE_REASON.syntheticCohortBoundaries));
  assert.ok(!imported.confidence.reasons.includes(CONFIDENCE_REASON.syntheticCohortBoundaries));
  assert.ok(imported.confidence.reasons.includes(CONFIDENCE_REASON.importedExport));
  // The provenance itself is on the finding, so the number is traceable to its
  // source without re-running anything.
  assert.equal(synthetic.provenance.id, "2026-06-30");
  assert.equal(synthetic.provenance.label, "Published synthetic cost cohorts");
});

test("the downgrade steps down the ladder once and stops at the floor", () => {
  const cases = [["high", "moderate"], ["moderate", "low"], ["low", "unavailable"],
    ["unavailable", "unavailable"]];
  for (const [stated, expected] of cases) {
    const applied = applyProvenanceConfidence({ level: stated },
      { kind: PROVENANCE_KIND.synthetic });
    assert.equal(applied.level, expected, `${stated} should downgrade to ${expected}`);
    assert.ok(applied.reasons.includes(CONFIDENCE_REASON.syntheticCohortBoundaries));
  }
  const floored = applyProvenanceConfidence({ level: "unavailable" },
    { kind: PROVENANCE_KIND.synthetic });
  assert.ok(floored.reasons.includes(CONFIDENCE_REASON.alreadyAtFloor));
  // A signal that states no level has one claimed for it, and says so.
  const unstated = applyProvenanceConfidence({}, { kind: PROVENANCE_KIND.imported });
  assert.equal(unstated.level, "unavailable");
  assert.ok(unstated.reasons.includes(CONFIDENCE_REASON.notStated));
});

test("the reasons a signal states are kept, in order, ahead of the derived ones", () => {
  const applied = applyProvenanceConfidence(
    { level: "high", reasons: ["ranking_reproducible", "verified_this_month"] },
    { kind: PROVENANCE_KIND.synthetic });
  assert.deepEqual([...applied.reasons], ["ranking_reproducible", "verified_this_month",
    CONFIDENCE_REASON.syntheticCohortBoundaries]);
});
