// Labelled score-delta fixtures for `prompt-revision-comparison/1.0.0`.
//
// WHAT THIS FILE IS. Three labelled pairs — a positive, a neutral and a
// negative revision — each pinning four figures a director is entitled to
// dispute line by line:
//
//   1. the composite score delta,
//   2. the letter-grade transition,
//   3. the criterion-level (axis) score changes and what each one contributes
//      to the composite at its published weight,
//   4. the prioritized remaining weakness and the single coaching action that
//      follows from it.
//
// WHY IT IS SEPARATE FROM `prompt-revision-fixtures.test.js`. That file pins
// the shipped envelope's own fields. This one pins the *decomposition* of the
// headline number: which criterion moved, by how much, and how much of the
// headline that criterion is responsible for. The envelope deliberately does
// not carry per-axis deltas (see "What this contract deliberately leaves out"
// in docs/prompt-revision-comparison-contract.md) because three deltas beside
// a headline is three headlines. That decision does not excuse the score from
// being decomposable on demand — it moves the decomposition here, into
// evaluation material, where a dispute is settled without adding a second
// figure to a reader's screen.
//
// FIXTURE PROVENANCE. Every string below is hand-authored for this test. No
// real prompt, customer, provider, or telemetry data was available to this
// workflow and none is used. Fixtures are constructed in memory here rather
// than committed as a blob so a shape change fails a test instead of drifting.
//
// DETERMINISM. Pure and synchronous: no clock, no randomness, no network, no
// I/O beyond reading module source for the capability scan at the bottom. The
// same two texts produce byte-identical output on any machine, which is what
// makes "the score is reproducible" a checkable claim rather than a promise.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCoachingSession } from "../src/prompt-coaching-contract.js";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";
import { buildRevisionComparison } from "../src/prompt-revision-comparison.js";

/**
 * The fixture set carries its own version, separate from the comparison
 * schema's. A fixture whose expected numbers change is a different fixture set
 * even when the envelope shape did not move, and a reviewer comparing two runs
 * needs to be able to say which set produced which number.
 */
export const PROMPT_REVISION_DELTA_FIXTURES_VERSION = "prompt-revision-delta-fixtures/1.0.0";

/** The rubric and classifier both sides of every pair were graded under. */
const TIER = "standard";

// ---------------------------------------------------------------------------
// The assumption behind every composite weight
// ---------------------------------------------------------------------------

/**
 * Every criterion contribution below is `criterionDelta x weightPercent / 100`,
 * so each weight is load-bearing on a published number and each one is stated
 * here in the form a director will actually challenge: "why is that half the
 * score?"
 *
 * These are summaries of, never substitutes for, the full assumption text in
 * `prompt-literacy-rubric.json`. The tests assert that every axis the rubric
 * publishes has an entry here, so an axis added to the rubric fails this file
 * until somebody states why its weight is what it is.
 */
const COMPOSITE_WEIGHT_ASSUMPTIONS = Object.freeze({
  intent: Object.freeze({
    weightPercent: 50,
    assumption: "Half the score, because intent is the only axis a reader can "
      + "move by rewriting the request. Coaching is this product's lever, so the "
      + "axis coaching moves carries the largest single share. The direct "
      + "consequence, visible in every fixture below: a revision that changes "
      + "nothing but its intent criterion moves the composite by exactly half "
      + "the criterion change.",
    disputeIf: "A reader who believes routing or turn count is the bigger lever "
      + "is disputing this weight, not the arithmetic. They change 50 in the "
      + "rubric and every fixture number here moves with it.",
  }),
  efficiency: Object.freeze({
    weightPercent: 30,
    assumption: "Thirty, because wasted turns are real spend but they are a "
      + "symptom of weak intent rather than an independent skill. Above model "
      + "fit so a re-prompt spiral costs more than a routing mistake, below "
      + "intent so it cannot outweigh the cause it follows from.",
    disputeIf: "A reader who thinks a re-prompt spiral should be able to fail a "
      + "prompt on its own is asking for this to exceed 50.",
  }),
  modelFit: Object.freeze({
    weightPercent: 20,
    assumption: "Twenty, the smallest share, because routing is a platform fix: "
      + "a gateway rule corrects a mis-modelled request without the requester "
      + "changing anything, so it says least about literacy. Not zero, because "
      + "reaching for a frontier model to rename a variable is a judgement the "
      + "requester made.",
    disputeIf: "Every fixture here names one tier on both sides, so this weight "
      + "contributes 0 to all three deltas. It is stated because it is part of "
      + "the composite the deltas are taken from, not because it moved.",
  }),
});

// ---------------------------------------------------------------------------
// Fixture texts
// ---------------------------------------------------------------------------

/** An underspecified ask: no context, no constraints, no acceptance criterion. */
const VAGUE_CHECKOUT = "improve the checkout code somehow and make it better as needed";

/**
 * The same ask rewritten to state its setting, its boundaries, its acceptance
 * criterion and its steps — every intent credit the rubric offers on prose.
 */
const ACCEPTANCE_CHECKOUT = [
  "Context: we run a checkout service on Node 20 behind a CDN, and the retry path floods payments during a partial outage.",
  "Constraints: do not add a dependency and do not change the public API.",
  "Acceptance criteria: a patch to one file plus the test that fails without it.",
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

/** A real edit that moves no signal: the two request lines are reordered and one
 * word is swapped for a synonym. The neutral fixture has to be an edit somebody
 * would actually make, not the identical string pasted twice. */
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

// ---------------------------------------------------------------------------
// The labelled fixtures, as data
// ---------------------------------------------------------------------------

/**
 * `criteria` entries are `[axisKey, baselineScore, revisionScore,
 * criterionDelta, weightedContribution]`.
 *
 * READ THE LAST TWO COLUMNS AS TWO DIFFERENT NUMBERS. `criterionDelta` is the
 * movement on the criterion's own 0-100 scale. `weightedContribution` is what
 * that movement is worth on the 0-100 composite, which is the criterion delta
 * times the criterion's published weight. They are equal only for a criterion
 * weighted 100%, and no criterion here is. Conflating them is the specific
 * documentation error this fixture set exists to make impossible to repeat:
 * `intent-rewrite-gain` moves the intent criterion by +72 (28 -> 100) and
 * contributes +36 to the composite (+72 x 50%). Neither number is "the intent
 * gain" on its own; both are labelled, every time, wherever either is shown.
 */
const DELTA_FIXTURES = Object.freeze([
  Object.freeze({
    id: "intent-rewrite-gain",
    polarity: "positive",
    shows: "a rewrite that supplies context, constraints, an acceptance "
      + "criterion and a numbered ask, saturating the intent criterion",
    baseline: Object.freeze({
      text: VAGUE_CHECKOUT, score: 56, grade: "F",
      improvementId: "intent-states-acceptance", improvementPoints: 9,
    }),
    revision: Object.freeze({
      text: ACCEPTANCE_CHECKOUT, score: 92, grade: "A",
      improvementId: null, improvementPoints: null,
    }),
    // Composite delta and letter transition.
    compositeDelta: 36,
    direction: "improved",
    gradeFrom: "F",
    gradeTo: "A",
    bandDelta: 4,
    // Criterion-level changes. Intent is the only criterion that moved.
    criteria: Object.freeze([
      Object.freeze(["intent", 28, 100, 72, 36]),
      Object.freeze(["efficiency", 85, 85, 0, 0]),
      Object.freeze(["modelFit", 80, 80, 0, 0]),
    ]),
    // Coaching priority after the revision.
    remainingWeaknessStatus: "none",
    remainingWeaknessSignalId: null,
    nextActionKind: "stop",
  }),
  Object.freeze({
    id: "reordered-ask-no-signal-change",
    polarity: "neutral",
    shows: "an edit that reorders the ask and swaps a word without moving a "
      + "signal on any criterion",
    baseline: Object.freeze({
      text: SPECIFIC_LEDGER, score: 89, grade: "B",
      improvementId: "intent-pasted-context", improvementPoints: 3,
    }),
    revision: Object.freeze({
      text: SPECIFIC_LEDGER_REORDERED, score: 89, grade: "B",
      improvementId: "intent-pasted-context", improvementPoints: 3,
    }),
    compositeDelta: 0,
    direction: "unchanged",
    gradeFrom: "B",
    gradeTo: "B",
    bandDelta: 0,
    criteria: Object.freeze([
      Object.freeze(["intent", 94, 94, 0, 0]),
      Object.freeze(["efficiency", 85, 85, 0, 0]),
      Object.freeze(["modelFit", 80, 80, 0, 0]),
    ]),
    // The score did not move and the coach is still naming the same first move.
    // `unaddressed` is the field that says so; a zero delta alone cannot.
    remainingWeaknessStatus: "unaddressed",
    remainingWeaknessSignalId: "intent-pasted-context",
    nextActionKind: "apply_remaining",
  }),
  Object.freeze({
    id: "constraint-loss-regression",
    polarity: "negative",
    shows: "a “tightening” that drops the constraints and the success check",
    baseline: Object.freeze({
      text: SPECIFIC_LEDGER, score: 89, grade: "B",
      improvementId: "intent-pasted-context", improvementPoints: 3,
    }),
    revision: Object.freeze({
      text: VAGUE_LEDGER, score: 65, grade: "D",
      improvementId: "intent-states-acceptance", improvementPoints: 9,
    }),
    compositeDelta: -24,
    direction: "regressed",
    gradeFrom: "B",
    gradeTo: "D",
    bandDelta: -2,
    criteria: Object.freeze([
      Object.freeze(["intent", 94, 46, -48, -24]),
      Object.freeze(["efficiency", 85, 85, 0, 0]),
      Object.freeze(["modelFit", 80, 80, 0, 0]),
    ]),
    // A regressed revision still has a top-ranked change. Presenting it would
    // coach the reader deeper into a worse draft, so `revert` outranks it.
    remainingWeaknessStatus: "advanced",
    remainingWeaknessSignalId: "intent-states-acceptance",
    nextActionKind: "revert",
  }),
]);

// ---------------------------------------------------------------------------
// Helpers. Nothing here scores, ranks, or selects.
// ---------------------------------------------------------------------------

const session = (id, text) => buildCoachingSession({ sessionId: id, text, modelTier: TIER });

const pair = (fixture) => ({
  baseline: session(`${fixture.id}-baseline`, fixture.baseline.text),
  revision: session(`${fixture.id}-revision`, fixture.revision.text),
});

const axisScore = (built, key) =>
  built.result.detail.axes.find((axis) => axis.key === key).score;

/** Rounded to two decimals so a float artefact cannot fail an exact comparison.
 * The rubric reports contributions to two decimals for the same reason. */
const roundTo2 = (value) => Math.round(value * 100) / 100;

/**
 * The judge-facing decomposition of one comparison: the headline figures plus
 * one row per rubric criterion. Derived from two sessions and the rubric's own
 * weight table — it copies no text, reads no criterion the rubric does not
 * publish, and writes no weight down a second time.
 */
function decomposeComparison(comparison, baseline, revision) {
  return Object.freeze({
    fixtureSetVersion: PROMPT_REVISION_DELTA_FIXTURES_VERSION,
    schemaVersion: comparison.schemaVersion,
    comparisonId: comparison.comparisonId,
    compositeDelta: comparison.comparison.headline.delta,
    direction: comparison.comparison.headline.direction,
    grade: Object.freeze({ ...comparison.comparison.grade }),
    criteria: Object.freeze(PROMPT_LITERACY_RUBRIC.axes.map((axis) => {
      const from = axisScore(baseline, axis.key);
      const to = axisScore(revision, axis.key);
      const criterionDelta = roundTo2(to - from);
      return Object.freeze({
        key: axis.key,
        label: axis.label,
        weightPercent: axis.weightPercent,
        baselineScore: from,
        revisionScore: to,
        // Two separately named numbers, never one. See DELTA_FIXTURES.
        criterionDelta,
        weightedCompositeContribution: roundTo2((criterionDelta * axis.weightPercent) / 100),
        weightAssumption: axis.assumption,
      });
    })),
    coachingPriority: Object.freeze({
      status: comparison.comparison.remainingWeakness.status,
      signalId: comparison.comparison.remainingWeakness.signalId,
      nextActionKind: comparison.comparison.nextAction.kind,
    }),
  });
}

/** Every string reachable in a value, keys included, at any depth. */
function everyString(value, into = []) {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const entry of value) everyString(entry, into);
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      into.push(key);
      everyString(entry, into);
    }
  }
  return into;
}

// ---------------------------------------------------------------------------
// 0. The assumption behind every composite weight is stated and encoded
// ---------------------------------------------------------------------------

test("every composite weight the deltas depend on has a stated assumption", () => {
  const stated = Object.keys(COMPOSITE_WEIGHT_ASSUMPTIONS);
  assert.deepEqual(PROMPT_LITERACY_RUBRIC.axes.map((axis) => axis.key), stated,
    "an axis added to the rubric must state why its weight is what it is before "
    + "a delta decomposed with it is shown to anyone");

  let total = 0;
  for (const axis of PROMPT_LITERACY_RUBRIC.axes) {
    const entry = COMPOSITE_WEIGHT_ASSUMPTIONS[axis.key];
    assert.equal(entry.weightPercent, axis.weightPercent,
      `${axis.key}: the assumption must be stated against the weight actually applied`);
    assert.ok(entry.assumption.length > 80, `${axis.key}: assumption is too thin to dispute`);
    assert.ok(entry.disputeIf.length > 40, `${axis.key}: name what disagreeing with it means`);
    // The rubric owns the canonical text; this file summarises, never replaces.
    assert.ok(typeof axis.assumption === "string" && axis.assumption.length > 80,
      `${axis.key}: the rubric itself must carry the full assumption`);
    total += axis.weightPercent;
  }
  assert.equal(total, 100, "a weighted contribution only decomposes a composite if the weights total it");
});

test("this fixture set changes no rubric criterion, weight, or cutoff", () => {
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

// ---------------------------------------------------------------------------
// 1. The engine reproduces the facts each fixture's expected numbers came from
// ---------------------------------------------------------------------------

for (const fixture of DELTA_FIXTURES) {
  test(`fixture ${fixture.id} (${fixture.polarity}): the engine produces the pinned per-side facts`, () => {
    const built = pair(fixture);
    for (const side of ["baseline", "revision"]) {
      const expected = fixture[side];
      const result = built[side].result;
      assert.equal(built[side].outcome, "graded", `${side} must be graded`);
      assert.equal(result.benchmark.score, expected.score, `${fixture.id}/${side} composite`);
      assert.equal(result.benchmark.grade, expected.grade, `${fixture.id}/${side} letter`);
      assert.equal(result.improvement.id, expected.improvementId,
        `${fixture.id}/${side} top-ranked change`);
      assert.equal(result.improvement.points, expected.improvementPoints ?? 0,
        `${fixture.id}/${side} what that change is worth`);
      // One tier on both sides, so no model-fit signal fires and the whole
      // delta is attributable to the rewrite rather than to a routing move.
      assert.equal(built[side].input.modelTier, TIER);
      assert.equal(result.recommendation.evidenced, false,
        `${fixture.id}/${side} must carry no routing move inside a rewrite delta`);
    }
    for (const [key, baselineScore, revisionScore] of fixture.criteria) {
      assert.equal(axisScore(built.baseline, key), baselineScore, `${fixture.id}/baseline ${key}`);
      assert.equal(axisScore(built.revision, key), revisionScore, `${fixture.id}/revision ${key}`);
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Composite delta, letter transition, criterion changes, coaching priority
// ---------------------------------------------------------------------------

for (const fixture of DELTA_FIXTURES) {
  test(`fixture ${fixture.id} (${fixture.polarity}): the four disputed figures reproduce`, () => {
    const { baseline, revision } = pair(fixture);
    const comparison = buildRevisionComparison({ comparisonId: fixture.id, baseline, revision });
    const record = decomposeComparison(comparison, baseline, revision);

    // 1. Composite score delta.
    assert.equal(record.compositeDelta, fixture.compositeDelta, `${fixture.id} composite delta`);
    assert.equal(record.direction, fixture.direction, `${fixture.id} direction`);
    assert.equal(Number.isInteger(record.compositeDelta), true,
      "the rubric rounds the composite to a whole number, so a delta is a whole number");

    // 2. Letter-grade transition.
    assert.deepEqual(
      [record.grade.from, record.grade.to, record.grade.bandDelta, record.grade.moved],
      [fixture.gradeFrom, fixture.gradeTo, fixture.bandDelta, fixture.bandDelta !== 0],
      `${fixture.id} letter transition`);

    // 3. Criterion-level score changes, and the two numbers kept apart.
    assert.deepEqual(
      record.criteria.map((row) => [
        row.key, row.baselineScore, row.revisionScore,
        row.criterionDelta, row.weightedCompositeContribution,
      ]),
      fixture.criteria.map((row) => [...row]),
      `${fixture.id} criterion-level changes`);

    // 4. Prioritized remaining weakness and the one coaching action.
    assert.deepEqual(record.coachingPriority, {
      status: fixture.remainingWeaknessStatus,
      signalId: fixture.remainingWeaknessSignalId,
      nextActionKind: fixture.nextActionKind,
    }, `${fixture.id} coaching priority`);
  });
}

test("running a fixture twice produces byte-identical output", () => {
  for (const fixture of DELTA_FIXTURES) {
    const first = pair(fixture);
    const second = pair(fixture);
    const serialize = (built) => JSON.stringify(decomposeComparison(
      buildRevisionComparison({ comparisonId: fixture.id, ...built }), built.baseline, built.revision,
    ));
    assert.equal(serialize(first), serialize(second), `${fixture.id} is not reproducible`);
  }
});

// ---------------------------------------------------------------------------
// 3. The arithmetic that ties a criterion change to the headline
// ---------------------------------------------------------------------------

test("a weighted contribution is the criterion delta times its published weight, and is never the same number", () => {
  for (const fixture of DELTA_FIXTURES) {
    for (const [key, , , criterionDelta, contribution] of fixture.criteria) {
      const weightPercent = COMPOSITE_WEIGHT_ASSUMPTIONS[key].weightPercent;
      assert.equal(contribution, roundTo2((criterionDelta * weightPercent) / 100),
        `${fixture.id}/${key}: contribution must be the delta at its stated weight`);
      // The two figures coincide only at zero, because no axis is weighted 100%.
      assert.equal(criterionDelta === contribution, criterionDelta === 0,
        `${fixture.id}/${key}: a non-zero criterion delta and its composite `
        + "contribution are two different numbers and must be labelled as two");
    }
  }
});

test("intent-rewrite-gain is labelled +72 on the criterion and +36 on the composite", () => {
  // The named correction. A previous write-up of this fixture reported one
  // figure where there are two; both are asserted here so the mislabel cannot
  // return through documentation that no test reads.
  const fixture = DELTA_FIXTURES.find((entry) => entry.id === "intent-rewrite-gain");
  const intent = fixture.criteria.find(([key]) => key === "intent");
  const [, from, to, criterionDelta, contribution] = intent;

  assert.deepEqual([from, to], [28, 100], "the intent criterion moves 28 -> 100");
  assert.equal(criterionDelta, 72, "the intent criterion change is +72 on the criterion's own scale");
  assert.equal(contribution, 36, "its 50%-weighted contribution to the composite is +36");
  assert.equal(fixture.compositeDelta, 36, "and the composite delta is +36, not +72");
  assert.notEqual(criterionDelta, contribution);

  const { baseline, revision } = pair(fixture);
  const record = decomposeComparison(
    buildRevisionComparison({ comparisonId: fixture.id, baseline, revision }), baseline, revision);
  const row = record.criteria.find((entry) => entry.key === "intent");
  assert.equal(row.criterionDelta, 72);
  assert.equal(row.weightedCompositeContribution, 36);
  assert.equal(row.weightPercent, 50);
});

test("the weighted contributions account for the whole composite delta", () => {
  for (const fixture of DELTA_FIXTURES) {
    const summed = roundTo2(fixture.criteria.reduce((sum, [, , , , part]) => sum + part, 0));
    // The composite is rounded to zero decimals once, at the end, on each side.
    // Two roundings of at most half a point each can therefore separate the sum
    // of contributions from the reported integer delta by at most 1 point.
    assert.ok(Math.abs(summed - fixture.compositeDelta) <= 1,
      `${fixture.id}: contributions (${summed}) cannot explain the delta (${fixture.compositeDelta})`);
    // For these three, both sides round the same direction, so it is exact —
    // pinned so a fixture that stops being exactly decomposable is noticed
    // rather than absorbed by the tolerance above.
    assert.equal(summed, fixture.compositeDelta,
      `${fixture.id}: this fixture is meant to decompose exactly`);
  }
});

test("the band transition is read from the rubric's own ordering, best first", () => {
  const letters = PROMPT_LITERACY_RUBRIC.grades.map((grade) => grade.letter);
  assert.deepEqual(letters, ["A", "B", "C", "D", "F"],
    "the ladder is the rubric's published order; a band added there reorders this");
  for (const fixture of DELTA_FIXTURES) {
    assert.equal(letters.indexOf(fixture.gradeFrom) - letters.indexOf(fixture.gradeTo),
      fixture.bandDelta, `${fixture.id} bandDelta`);
    assert.ok(fixture.bandDelta === 0
      || Math.sign(fixture.bandDelta) === Math.sign(fixture.compositeDelta),
      `${fixture.id}: band movement must not oppose the composite movement`);
  }
});

test("the three polarities are all present and distinct", () => {
  assert.deepEqual(DELTA_FIXTURES.map((fixture) => fixture.polarity),
    ["positive", "neutral", "negative"]);
  assert.deepEqual(DELTA_FIXTURES.map((fixture) => fixture.direction),
    ["improved", "unchanged", "regressed"]);
  // A neutral fixture that scored identically for a different reason would not
  // test what it claims to: the ids must match on the neutral pair and differ
  // on both moving pairs.
  const [positive, neutral, negative] = DELTA_FIXTURES;
  assert.equal(neutral.baseline.improvementId, neutral.revision.improvementId);
  assert.notEqual(positive.baseline.improvementId, positive.revision.improvementId);
  assert.notEqual(negative.baseline.improvementId, negative.revision.improvementId);
});

// ---------------------------------------------------------------------------
// 4. Redaction: nothing judge-facing carries prompt content
// ---------------------------------------------------------------------------

test("no fixture prompt text survives into the comparison or its decomposition", () => {
  const baselineMarker = "BASELINE-QZXV-4417";
  const revisionMarker = "REVISION-QZXV-9082";
  for (const fixture of DELTA_FIXTURES) {
    const baseline = session(`${fixture.id}-marked-baseline`,
      `${fixture.baseline.text}\nInternal note ${baselineMarker}.`);
    const revision = session(`${fixture.id}-marked-revision`,
      `${fixture.revision.text}\nInternal note ${revisionMarker}.`);
    const comparison = buildRevisionComparison({ comparisonId: fixture.id, baseline, revision });
    const record = decomposeComparison(comparison, baseline, revision);

    for (const [label, value] of [["comparison", comparison], ["decomposition", record]]) {
      // Strings at any depth, keys included — a marker hidden in an object key
      // is still a leak, and a shallow scan would miss it.
      const strings = everyString(value);
      assert.ok(strings.length > 0, `${label} produced nothing to scan`);
      for (const marker of [baselineMarker, revisionMarker]) {
        assert.equal(strings.some((entry) => entry.includes(marker)), false,
          `${fixture.id}: ${label} retained a ${marker} marker`);
      }
      // Markers prove nothing new is copied; the window scan proves nothing old
      // is either. Any 24-character run of either prompt appearing in the output
      // would be prompt content, whatever produced it.
      const serialized = JSON.stringify(value);
      for (const text of [fixture.baseline.text, fixture.revision.text]) {
        for (let at = 0; at + 24 <= text.length; at += 1) {
          assert.equal(serialized.includes(text.slice(at, at + 24)), false,
            `${fixture.id}: ${label} echoes prompt text at offset ${at}`);
        }
      }
    }
  }
});

test("the decomposition reports only numbers, rubric labels and stable ids", () => {
  const fixture = DELTA_FIXTURES[0];
  const { baseline, revision } = pair(fixture);
  const record = decomposeComparison(
    buildRevisionComparison({ comparisonId: fixture.id, baseline, revision }), baseline, revision);

  // Every string the record carries is either a version, an id the fixture
  // named, a grade letter, or rubric-owned copy. None of it is reader input.
  const rubricStrings = new Set(PROMPT_LITERACY_RUBRIC.axes
    .flatMap((axis) => [axis.key, axis.label, axis.assumption]));
  const allowed = new Set([
    ...rubricStrings,
    ...PROMPT_LITERACY_RUBRIC.grades.map((grade) => grade.letter),
    PROMPT_REVISION_DELTA_FIXTURES_VERSION, record.schemaVersion,
    fixture.id, fixture.direction, fixture.remainingWeaknessStatus, fixture.nextActionKind,
    // Object keys.
    "fixtureSetVersion", "schemaVersion", "comparisonId", "compositeDelta", "direction",
    "grade", "from", "to", "bandDelta", "moved", "criteria", "key", "label", "weightPercent",
    "baselineScore", "revisionScore", "criterionDelta", "weightedCompositeContribution",
    "weightAssumption", "coachingPriority", "status", "signalId", "nextActionKind",
  ]);
  for (const entry of everyString(record)) {
    assert.equal(allowed.has(entry), true, `unexpected string in the judge-facing record: ${entry}`);
  }
});

// ---------------------------------------------------------------------------
// 5. No network, no browser-local storage, anywhere the comparison can reach
// ---------------------------------------------------------------------------

const SOURCE_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

/** Source with comments and string literals blanked, so a word inside prose or
 * a boundary constant cannot be mistaken for a call. */
function executableCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** Every module the comparison entry can reach, by walking its static imports. */
async function comparisonModules() {
  const seen = new Map();
  const queue = ["prompt-revision-comparison.js"];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name) || !name.endsWith(".js")) continue;
    const source = await readFile(join(SOURCE_ROOT, name), "utf8");
    seen.set(name, executableCode(source));
    for (const match of source.matchAll(/from\s+"\.\/([^"]+)"/g)) queue.push(match[1]);
  }
  return seen;
}

test("no module a comparison reaches can send a request", async () => {
  const modules = await comparisonModules();
  assert.ok(modules.size > 1, "the import walk found nothing to check");
  const network = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.connection/;
  for (const [name, source] of modules) {
    assert.equal(network.test(source), false, `${name} references a network API`);
  }
});

test("no module a comparison reaches can read or write browser-local storage", async () => {
  const modules = await comparisonModules();
  const storage = /localStorage|sessionStorage|indexedDB|openDatabase|document\.cookie|location\.(hash|search)\s*=/i;
  for (const [name, source] of modules) {
    assert.equal(storage.test(source), false, `${name} references browser-local storage`);
  }
});

test("a comparison declares that it sent, persisted and retained nothing", () => {
  const fixture = DELTA_FIXTURES[0];
  const { baseline, revision } = pair(fixture);
  const comparison = buildRevisionComparison({ comparisonId: fixture.id, baseline, revision });
  assert.deepEqual({ ...comparison.boundary }, {
    sentForComparison: "none",
    persisted: "none",
    retainsAnalyzedText: false,
    baselineRetainedAs: "session_envelope",
    integrationsContacted: "none",
  });
});
