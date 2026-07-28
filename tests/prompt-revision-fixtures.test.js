// The executable half of docs/prompt-revision-comparison-contract.md.
//
// WHAT THIS FILE IS. The representative inputs and literal expected outputs for
// `prompt-revision-comparison/1.0.0`. A fixture whose expected outputs were
// checked only against hand arithmetic is a fixture an implementer discovers is
// wrong on their second day, so this file pins both the engine inputs and the
// shipped comparison envelope.
//
//   * The FIXTURES below are the three representative revisions the contract
//     names — improved, unchanged, lower-scoring — plus the abstention case.
//   * The EXPECTED table is the comparison payload each pair must produce,
//     written as literal data rather than computed by a second implementation
//     of the rules. Nothing here selects, ranks, or scores.
//   * The assertions check that the engine still produces the inputs those
//     literals were derived from, and that the two definitions that are pure
//     arithmetic — the composite delta and the band delta — hold over them.
//
// FIXTURE PROVENANCE. Every string below is hand-authored for this test. No
// real prompt, customer, provider, or telemetry data was available to this
// workflow and none is used. Fixtures are built here rather than committed so a
// shape change fails a test instead of drifting in a JSON blob.

import test from "node:test";
import assert from "node:assert/strict";

import { buildCoachingSession, validateCoachingSession } from "../src/prompt-coaching-contract.js";
import { COACHING_REASON } from "../src/prompt-coaching.js";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";
import { buildRevisionComparison } from "../src/prompt-revision-comparison.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Every pair names the same tier on both sides. Both model-fit debits and the
// one model-fit credit are gated on the tier, so a pair that changed tiers would
// carry a routing move inside a figure that is supposed to measure a rewrite —
// and the contract abstains on exactly that.
const TIER = "standard";

/** An underspecified ask: no context, no constraints, no acceptance criterion. */
const VAGUE_CHECKOUT = "improve the checkout code somehow and make it better as needed";

/** The same ask, rewritten to state its setting, its boundaries and its check. */
const SPECIFIC_CHECKOUT = [
  "Context: we run a checkout service on Node 20 behind a CDN, and the retry path floods payments during a partial outage.",
  "Constraints: do not add a dependency and do not change the public API.",
  "Success: a patch to one file plus the test that fails without it.",
  "",
  "1. Explain why the retry storm starts",
  "2. Propose the smallest fix",
].join("\n");

/** A well-formed ask about a different system, used as the strong baseline. */
const SPECIFIC_LEDGER = [
  "Context: the ledger export job writes a nightly CSV that finance reconciles by hand.",
  "Constraints: keep the existing column order and do not widen the database lock.",
  "Success: the job finishes inside the nightly window and the totals match the ledger.",
  "",
  "1. Explain why the export drifts",
  "2. Propose the smallest fix",
].join("\n");

/**
 * A real edit that moves no signal: the two request lines are reordered and one
 * word is swapped for a synonym of the same length. This is the fixture that
 * proves `unchanged` is reachable from an edit somebody would actually make,
 * rather than only from pasting the identical string twice.
 */
const SPECIFIC_LEDGER_REORDERED = [
  "Context: the ledger export job writes a nightly CSV that finance reconciles by hand.",
  "Constraints: keep the existing column order and do not widen the database lock.",
  "Success: the job finishes inside the nightly window and the totals match the ledger.",
  "",
  "1. Propose the minimal fix",
  "2. Explain why the export drifts",
].join("\n");

/** The "tightening" that loses the constraints and the acceptance criterion. */
const VAGUE_LEDGER = [
  "Context: the ledger export job writes a nightly CSV that finance reconciles by hand.",
  "",
  "Have a look at the export and improve it somehow, fix whatever seems off as needed.",
].join("\n");

const EMPTY_BOX = "   \n ";

// ---------------------------------------------------------------------------
// The expected outputs, as data
// ---------------------------------------------------------------------------

/**
 * One entry per representative revision. `sides` are the engine facts an
 * implementer can rely on; `comparison` is the payload
 * `buildRevisionComparison` must return for that pair.
 */
const EXPECTED = Object.freeze([
  Object.freeze({
    id: "improved-revision",
    shows: "a rewrite that states context, constraints and a success check",
    baseline: Object.freeze({
      text: VAGUE_CHECKOUT,
      score: 56, grade: "F", improvementId: "intent-states-acceptance", points: 9,
    }),
    revision: Object.freeze({
      text: SPECIFIC_CHECKOUT,
      score: 89, grade: "B", improvementId: "intent-pasted-context", points: 3,
    }),
    comparison: Object.freeze({
      compared: true, reason: null,
      delta: 33, direction: "improved",
      gradeFrom: "F", gradeTo: "B", bandDelta: 3,
      remainingWeaknessStatus: "advanced",
      nextActionKind: "apply_remaining",
    }),
  }),
  Object.freeze({
    id: "unchanged-revision",
    shows: "an edit that reorders the ask without moving a signal",
    baseline: Object.freeze({
      text: SPECIFIC_LEDGER,
      score: 89, grade: "B", improvementId: "intent-pasted-context", points: 3,
    }),
    revision: Object.freeze({
      text: SPECIFIC_LEDGER_REORDERED,
      score: 89, grade: "B", improvementId: "intent-pasted-context", points: 3,
    }),
    comparison: Object.freeze({
      compared: true, reason: null,
      delta: 0, direction: "unchanged",
      gradeFrom: "B", gradeTo: "B", bandDelta: 0,
      remainingWeaknessStatus: "unaddressed",
      nextActionKind: "apply_remaining",
    }),
  }),
  Object.freeze({
    id: "lower-scoring-revision",
    shows: "a “tightening” that drops the constraints and the success check",
    baseline: Object.freeze({
      text: SPECIFIC_LEDGER,
      score: 89, grade: "B", improvementId: "intent-pasted-context", points: 3,
    }),
    revision: Object.freeze({
      text: VAGUE_LEDGER,
      score: 65, grade: "D", improvementId: "intent-states-acceptance", points: 9,
    }),
    comparison: Object.freeze({
      compared: true, reason: null,
      delta: -24, direction: "regressed",
      gradeFrom: "B", gradeTo: "D", bandDelta: -2,
      remainingWeaknessStatus: "advanced",
      // Not `apply_remaining`: a regressed revision still has a top-ranked
      // change, and coaching a reader deeper into a worse draft is the failure
      // the ladder puts `revert` above it to prevent.
      nextActionKind: "revert",
    }),
  }),
]);

/** The abstention case: a graded baseline and a revision the engine refused. */
const EXPECTED_ABSTENTION = Object.freeze({
  id: "refused-revision",
  baseline: Object.freeze({ text: SPECIFIC_LEDGER, score: 89, grade: "B" }),
  revision: Object.freeze({ text: EMPTY_BOX, reason: COACHING_REASON.emptyInput }),
  comparison: Object.freeze({
    compared: false, reason: "revision_not_graded",
    delta: null, direction: null, remainingWeaknessStatus: null,
    nextActionKind: "abstain_recovery",
  }),
});

const session = (id, text) => buildCoachingSession({ sessionId: id, text, modelTier: TIER });

// ---------------------------------------------------------------------------
// The fixtures produce the engine facts the expected outputs were derived from
// ---------------------------------------------------------------------------

for (const fixture of EXPECTED) {
  test(`fixture ${fixture.id}: the engine produces the pinned facts`, () => {
    for (const side of ["baseline", "revision"]) {
      const expected = fixture[side];
      const built = session(`${fixture.id}-${side}`, expected.text);

      assert.equal(validateCoachingSession(built).valid, true,
        `${side} must be a session the single-prompt contract already accepts`);
      assert.equal(built.outcome, "graded");
      assert.equal(built.result.benchmark.score, expected.score,
        `${fixture.id}/${side} composite`);
      assert.equal(built.result.benchmark.grade, expected.grade,
        `${fixture.id}/${side} letter`);
      assert.equal(built.result.improvement.available, true);
      assert.equal(built.result.improvement.id, expected.improvementId,
        `${fixture.id}/${side} top-ranked change`);
      assert.equal(built.result.improvement.points, expected.points,
        `${fixture.id}/${side} what that change is worth`);
      // The tier is named on both sides and identical, so no model-fit signal
      // fires and the whole delta is attributable to the rewrite.
      assert.equal(built.input.modelTier, TIER);
      assert.equal(built.result.recommendation.evidenced, false,
        `${fixture.id}/${side} must carry no routing move inside a rewrite delta`);
    }
  });
}

test("fixture refused-revision: a graded baseline and a refused revision", () => {
  const baseline = session("refused-revision-baseline", EXPECTED_ABSTENTION.baseline.text);
  const revision = session("refused-revision-revision", EXPECTED_ABSTENTION.revision.text);

  assert.equal(baseline.outcome, "graded");
  assert.equal(baseline.result.benchmark.score, EXPECTED_ABSTENTION.baseline.score);
  assert.equal(revision.outcome, "empty");
  assert.equal(revision.reason, EXPECTED_ABSTENTION.revision.reason);
  assert.equal(revision.result.scored, false);
  assert.equal(revision.result.benchmark, null,
    "there is no second figure to subtract, which is the whole reason to abstain");
  // The refusal's own recovery stays on the revision session. The comparison
  // points at it rather than restating it, so the copy lives in one place.
  assert.ok(revision.result.recovery.control);
});

test("representative fixtures produce their committed comparison outputs", () => {
  for (const fixture of EXPECTED) {
    const built = buildRevisionComparison({
      comparisonId: fixture.id,
      baseline: session(`${fixture.id}-baseline`, fixture.baseline.text),
      revision: session(`${fixture.id}-revision`, fixture.revision.text),
    });
    const { headline, grade, remainingWeakness, nextAction } = built.comparison;
    assert.deepEqual({
      compared: built.compared,
      reason: built.reason,
      delta: headline.delta,
      direction: headline.direction,
      gradeFrom: grade.from,
      gradeTo: grade.to,
      bandDelta: grade.bandDelta,
      remainingWeaknessStatus: remainingWeakness.status,
      nextActionKind: nextAction.kind,
    }, fixture.comparison, fixture.id);
  }

  const refused = buildRevisionComparison({
    comparisonId: EXPECTED_ABSTENTION.id,
    baseline: session("refused-output-baseline", EXPECTED_ABSTENTION.baseline.text),
    revision: session("refused-output-revision", EXPECTED_ABSTENTION.revision.text),
  });
  assert.deepEqual({
    compared: refused.compared,
    reason: refused.reason,
    delta: refused.comparison.headline?.delta ?? null,
    direction: refused.comparison.headline?.direction ?? null,
    remainingWeaknessStatus: refused.comparison.remainingWeakness?.status ?? null,
    nextActionKind: refused.comparison.nextAction.kind,
  }, EXPECTED_ABSTENTION.comparison);
});

// ---------------------------------------------------------------------------
// The two definitions that are pure arithmetic
// ---------------------------------------------------------------------------

test("the headline delta is the two composites subtracted, and nothing else", () => {
  for (const fixture of EXPECTED) {
    const baseline = session(`${fixture.id}-baseline`, fixture.baseline.text);
    const revision = session(`${fixture.id}-revision`, fixture.revision.text);
    const delta = revision.result.benchmark.score - baseline.result.benchmark.score;

    assert.equal(delta, fixture.comparison.delta, `${fixture.id} delta`);
    assert.equal(Number.isInteger(delta), true,
      "the rubric rounds the composite to a whole number, so a delta is a whole number");
    const direction = delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged";
    assert.equal(direction, fixture.comparison.direction, `${fixture.id} direction`);
  }
});

test("the band delta is read from the rubric's own ordering, best first", () => {
  const letters = PROMPT_LITERACY_RUBRIC.grades.map((grade) => grade.letter);
  assert.deepEqual(letters, ["A", "B", "C", "D", "F"],
    "the ladder is the rubric's published order; a band added there reorders this");

  for (const fixture of EXPECTED) {
    const from = letters.indexOf(fixture.comparison.gradeFrom);
    const to = letters.indexOf(fixture.comparison.gradeTo);
    assert.equal(from - to, fixture.comparison.bandDelta, `${fixture.id} bandDelta`);
    // Positive is up, because the array runs best-first and no reader should
    // have to hold "negative means better" in their head. The cutoff table is
    // monotonic, so a moved band always points the same way as the delta; a
    // band that did not move is the one legitimate disagreement between them.
    assert.equal(
      fixture.comparison.bandDelta === 0
        || Math.sign(fixture.comparison.bandDelta) === Math.sign(fixture.comparison.delta),
      true, `${fixture.id}: band movement must not oppose the delta`);
  }
});

// ---------------------------------------------------------------------------
// The claims the contract rests on
// ---------------------------------------------------------------------------

test("an identical score can still leave a different remaining weakness open", () => {
  // The distinction `unaddressed` vs `advanced` is the one thing a score delta
  // cannot say, which is why the contract carries it as its own field.
  const unchanged = EXPECTED.find((entry) => entry.id === "unchanged-revision");
  const improved = EXPECTED.find((entry) => entry.id === "improved-revision");

  assert.equal(unchanged.baseline.improvementId, unchanged.revision.improvementId);
  assert.equal(unchanged.comparison.remainingWeaknessStatus, "unaddressed");

  assert.notEqual(improved.baseline.improvementId, improved.revision.improvementId);
  assert.equal(improved.comparison.remainingWeaknessStatus, "advanced");
  // A 33-point gain still returns an available improvement: an implementation
  // that reported "nothing left" on a large gain would be silently wrong.
  assert.equal(improved.comparison.delta > 30, true);
});

test("a tier change can move the composite far enough to be worth abstaining on", () => {
  const modelFit = PROMPT_LITERACY_RUBRIC.axes.find((axis) => axis.key === "modelFit");
  // Both routing debits and the one routing credit are gated on the named tier.
  // The axis baseline is 80; the largest debit is -60 and the credit is +20, so
  // the tier alone can place the axis anywhere in 20..100.
  const axisRange = 100 - 20;
  const compositeRange = (axisRange * modelFit.weightPercent) / 100;
  assert.equal(compositeRange, 16,
    "a delta across a tier change mixes a rewrite with a routing move worth up to this many points");
});

test("this issue changes no rubric criterion", () => {
  // The comparison reads the band table and nothing else. Weights and cutoffs
  // are pinned here so a comparison implementation cannot quietly tune the
  // numbers its own headline is computed from.
  assert.equal(PROMPT_LITERACY_RUBRIC.rubricVersion, "1.0.0");
  assert.deepEqual(
    PROMPT_LITERACY_RUBRIC.axes.map((axis) => [axis.key, axis.weightPercent]),
    [["intent", 50], ["efficiency", 30], ["modelFit", 20]],
  );
  assert.deepEqual(
    PROMPT_LITERACY_RUBRIC.grades.map((grade) => [grade.letter, grade.minimumScore]),
    [["A", 90], ["B", 80], ["C", 70], ["D", 60], ["F", 0]],
  );
});

test("neither fixture text survives into the session a comparison would consume", () => {
  // The comparison consumes sessions, never text. That guarantee is only worth
  // anything if a session carries no text, so it is asserted at the boundary
  // the comparison will actually read from.
  const marker = "ZZQX-marker-9137";
  const built = session("marker-check", `${SPECIFIC_LEDGER}\nAlso ${marker}.`);
  assert.equal(JSON.stringify(built).includes(marker), false);
  assert.equal(built.boundary.retainsAnalyzedText, false);
});
