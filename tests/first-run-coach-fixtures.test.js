// Labelled first-run fixtures for the prompt coach: the example a first visit
// is shown, the same example edited, and the example replaced outright.
//
// WHAT THIS FILE IS. Three labelled first-run states, each pinning the five
// figures a director is entitled to dispute line by line:
//
//   1. the per-axis arithmetic — baseline, every fired signal's contribution,
//      the sum, whether the clamp bound it, and the reported axis score;
//   2. the weighted decomposition of the composite, the unrounded sum, and the
//      single rounding that turns it into the published integer;
//   3. the letter grade and the benchmark comparison beside it (the next band
//      and the distance to it);
//   4. the coaching evidence — which signal the ranker put first, what it is
//      worth, and the assumption key behind it;
//   5. the share summary those figures are allowed to travel in, and what that
//      summary may not contain.
//
// WHY A FIRST-RUN FIXTURE SET SEPARATELY FROM THE OTHERS.
// `prompt-coaching-fixtures.test.js` pins the engine's behaviour on hand-picked
// texts and `prompt-revision-delta-fixtures.test.js` pins the decomposition of a
// revision delta. Neither covers the one reading almost every visitor sees
// first: the bundled example, unmodified, on the tier the sample itself names.
// That number is the first score this product shows anybody, it is the one a
// screenshot travels with, and until now it was reproducible only by running
// the page. This file makes it a fixture.
//
// WHAT THIS FILE DOES NOT DO. Nothing in `src/` changed for it. The grade,
// revise and re-grade semantics are exactly as `prompt-coaching.js`,
// `prompt-coaching-contract.js` and Noor's `prompt-revision-comparison.js`
// specify, and `prompt-literacy-rubric.json` is byte-identical before and after.
// A fixture that needed the engine changed to pass would not be a fixture.
//
// FIXTURE PROVENANCE. Every string below is hand-authored for this test, or is
// the bundled sample the contract already ships. No real prompt, customer,
// provider, HRIS, or telemetry data was available to this workflow and none is
// used; the identifiers in the redaction fixture are invented markers whose only
// purpose is to be searched for in output that must not contain them.
//
// DETERMINISM. Pure and synchronous: no clock, no randomness, no network, no
// I/O. Fixtures are constructed in memory here rather than committed as a blob,
// so a shape change fails a test instead of drifting. Every session is built
// twice and compared byte for byte, which is what makes "the first-run score is
// reproducible" a checkable claim rather than a promise.

import test from "node:test";
import assert from "node:assert/strict";

import {
  COACHING_ANSWER, COACHING_QUESTION, RECOMMENDATION_STATE,
} from "../src/prompt-coaching.js";
import {
  COACHING_INPUT_SOURCE, COACHING_OUTCOME, PREVIEW_SAMPLE_ID,
  buildCoachingSession, buildSampleCoachingSession, coachingSample,
  validateCoachingSession,
} from "../src/prompt-coaching-contract.js";
import {
  DIMENSION_BASELINES, PROSE_CLASSIFIER_VERSION, PROSE_SIGNALS, SIGNAL_ASSUMPTIONS,
  classifyConversation,
} from "../src/prompt-prose-classification.js";
import {
  PROMPT_LITERACY_RUBRIC, RUBRIC_VERSION_ID, letterGradeForScore,
} from "../src/prompt-literacy-scoring.js";
import { REVISION_STATUS, buildRevisionChange } from "../src/prompt-coaching-view.js";
import { SUMMARY_BOUNDARY, SUMMARY_TITLE, buildCoachingSummary } from "../src/coaching-summary.js";

/**
 * The fixture set carries its own version, separate from every schema it reads.
 * A fixture whose expected numbers change is a different fixture set even when
 * no envelope moved, and a reviewer comparing two runs has to be able to say
 * which set produced which number.
 */
export const FIRST_RUN_COACH_FIXTURES_VERSION = "first-run-coach-fixtures/1.0.0";

/**
 * The versions every figure below was produced under, pinned rather than read
 * through, because "reproducible" without a version is a coincidence. A rubric
 * or classifier bump fails this file first, which is the intended order: the
 * numbers are re-derived and re-stated before anything ships under them.
 */
const PINNED_VERSIONS = Object.freeze({
  rubricVersionId: "literacy-mix/1.0.0",
  classifierVersion: "prompt-prose-classifier/1.0.0",
  sessionSchema: "prompt-coaching-session/1.0.0",
});

/**
 * The tier the bundled first-run example names beside the box. Every fixture in
 * this set names the same one, so no figure below moves because the tier moved
 * and every difference between fixtures is attributable to the text.
 */
const TIER = "premium";

// ---------------------------------------------------------------------------
// The assumption behind every weight these figures rest on
// ---------------------------------------------------------------------------

/**
 * The composite is `Σ axisScore × weightPercent / 100`, so all three axis
 * weights are load-bearing on the first score this product shows anyone. Each
 * is stated here in the form a director actually challenges — "why is that half
 * the grade?" — together with what disagreeing with it does to these fixtures.
 *
 * These are summaries of, never substitutes for, the canonical assumption text
 * in `prompt-literacy-rubric.json`. A test below asserts that every axis the
 * rubric publishes has an entry here at the weight the rubric publishes, so an
 * axis added there fails this file until somebody states why its weight is what
 * it is.
 */
const COMPOSITE_WEIGHT_ASSUMPTIONS = Object.freeze({
  intent: Object.freeze({
    weightPercent: 50,
    assumption: "Half the score, because intent is the only axis a reader moves "
      + "by rewriting the request, and rewriting is the whole of what this coach "
      + "asks for. Visible directly in this set: the only axis that moves between "
      + "the first-run example and its edit is intent, and half of that movement "
      + "is the whole reported change.",
    disputeIf: "A reader who believes routing or turn count is the bigger lever "
      + "is disputing this weight rather than the arithmetic. Change 50 in the "
      + "rubric and every composite in this file moves with it.",
  }),
  efficiency: Object.freeze({
    weightPercent: 30,
    assumption: "Thirty, because wasted turns are real spend but are a symptom of "
      + "weak intent rather than an independent skill. Above model fit so a "
      + "re-prompt spiral costs more than a routing mistake, below intent so it "
      + "cannot outweigh the cause it follows from.",
    disputeIf: "Every fixture here is a single turn, so no efficiency signal can "
      + "fire and this axis contributes its baseline — 25.5 points — to all three "
      + "composites. It is stated because it is a quarter of the published number, "
      + "not because it moved.",
  }),
  modelFit: Object.freeze({
    weightPercent: 20,
    assumption: "Twenty, the smallest share, because routing is a platform fix: a "
      + "gateway rule corrects a mis-modelled request without the requester "
      + "changing anything, so it says least about literacy. Not zero, because "
      + "reaching for a frontier model to rename a variable is a judgement the "
      + "requester made.",
    disputeIf: "It is the axis that separates the replaced fixture from the edited "
      + "one: same intent ceiling, but 20 points of model-fit credit the edit did "
      + "not earn. A reader who thinks length is poor evidence of substance is "
      + "disputing that credit, and it is named as the source of the difference.",
  }),
});

/**
 * Each axis starts a turn at a baseline and is moved by signals. The baselines
 * are as load-bearing as the weights — two of the three axes in the first-run
 * example are their baseline and nothing else — so each one is stated too.
 */
const BASELINE_ASSUMPTIONS = Object.freeze({
  intent: Object.freeze({
    value: 40,
    assumption: "A request earns intent credit by stating things; it starts below "
      + "the passing line because a prompt that states none of them has told the "
      + "model nothing. 40 is the assertion that an unadorned ask is a failing "
      + "request, not a neutral one.",
  }),
  efficiency: Object.freeze({
    value: 85,
    assumption: "The first time you ask for something you are efficient. "
      + "Efficiency is lost to evidence of a re-prompt spiral and never earned, "
      + "because no single prompt can prove it would not have needed a second "
      + "turn. 85 is the benefit of the doubt, not full marks.",
  }),
  modelFit: Object.freeze({
    value: 80,
    assumption: "Routing is presumed adequate for the same reason, lost to an "
      + "observable mismatch and earned back only in the one case this rubric can "
      + "evidence: substantial work on a premium model.",
  }),
});

// ---------------------------------------------------------------------------
// Fixture texts
// ---------------------------------------------------------------------------

/** The example a first visit is shown, quoted from the shipped contract. */
const EXAMPLE_TEXT = coachingSample(PREVIEW_SAMPLE_ID).text;

/**
 * The example edited in place: the same ask, with its setting, its boundaries
 * and its acceptance criterion stated. This is the edit the coach's own first
 * recommendation asks a reader to make, so the fixture is the coaching advice
 * taken rather than an unrelated second prompt.
 */
const EDITED_TEXT = [
  "Context: our checkout service retries failed payments, and the retry path floods the payments API during a partial outage.",
  "Request: change the retry loop to back off instead of retrying immediately.",
  "Constraints: do not add a dependency and do not change the public API.",
  "A correct answer is a patch to one file plus the test that fails without it.",
].join("\n");

/** Enough plain prose to clear the rubric's substantive-work threshold. */
const LEDGER_DETAIL = Array.from({ length: 22 }, (unused, at) =>
  `Step ${at} of the ledger export writes one account block and leaves the read path untouched.`)
  .join(" ");

/**
 * The example cleared and replaced with the reader's own work: a different
 * subject, structured, and long enough that the one model-fit credit the rubric
 * awards can fire. It is the fixture that proves replacing the example does not
 * leave the first-run reading behind in any figure.
 */
const REPLACED_TEXT = [
  "Context: the nightly ledger export writes a CSV that finance reconciles by hand, and last week it drifted by two rows.",
  "Constraints: keep the existing column order and do not widen the database lock.",
  "The answer should be one patch plus the test that fails without it.",
  "",
  "1. Explain why the export drifts",
  "2. Propose the smallest fix",
  "",
  LEDGER_DETAIL,
].join("\n");

// ---------------------------------------------------------------------------
// The three first-run fixtures
// ---------------------------------------------------------------------------

/**
 * Every number in `expected` is hand-derived from the rubric constants and
 * asserted against the engine below. The point of writing them out rather than
 * reading them off the result is that a fixture computed from the thing it
 * checks proves nothing: these are the arithmetic a reviewer can redo on paper.
 *
 * `axes[key]` reads: the axis starts at `baseline`, each entry in `signals`
 * adds its `contribution`, that sums to `sum`, the clamp binds when `clamped`
 * is true, and the axis is reported as `score`.
 */
const FIXTURES = Object.freeze([
  Object.freeze({
    id: "first-run-example",
    label: "The example, unmodified",
    purpose: "The first score this product shows anybody. It is a failing grade on "
      + "purpose: the example is an underspecified request, and the coach's value is "
      + "that it says so and names the one move.",
    text: EXAMPLE_TEXT,
    expected: Object.freeze({
      chars: 65,
      turns: 1,
      proseUnits: 13,
      turnWeights: Object.freeze([20]),
      axes: Object.freeze({
        intent: Object.freeze({
          baseline: 40,
          signals: Object.freeze([Object.freeze({ id: "intent-vague-request", contribution: -12 })]),
          sum: 28,
          clamped: false,
          score: 28,
        }),
        efficiency: Object.freeze({
          baseline: 85, signals: Object.freeze([]), sum: 85, clamped: false, score: 85,
        }),
        modelFit: Object.freeze({
          baseline: 80, signals: Object.freeze([]), sum: 80, clamped: false, score: 80,
        }),
      }),
      weighted: Object.freeze({ intent: 14, efficiency: 25.5, modelFit: 16 }),
      unroundedComposite: 55.5,
      composite: 56,
      grade: "F",
      next: Object.freeze({ letter: "D", minimumScore: 60, pointsAway: 4 }),
      improvement: Object.freeze({
        available: true,
        id: "intent-states-acceptance",
        kind: "add",
        points: 9,
        assumptionKey: "statesAcceptance",
      }),
      ranked: Object.freeze([
        Object.freeze({ id: "intent-states-acceptance", kind: "add", points: 9 }),
        Object.freeze({ id: "intent-states-constraints", kind: "add", points: 9 }),
        Object.freeze({ id: "intent-states-context", kind: "add", points: 9 }),
        Object.freeze({ id: "intent-structured-layout", kind: "add", points: 9 }),
        Object.freeze({ id: "intent-vague-request", kind: "fix", points: 6 }),
        Object.freeze({ id: "intent-pasted-context", kind: "add", points: 4 }),
      ]),
      recommendation: Object.freeze({
        state: RECOMMENDATION_STATE.noEvidence, signalId: null, points: 0,
      }),
    }),
  }),
  Object.freeze({
    id: "first-run-example-edited",
    label: "The example, edited in place",
    purpose: "The reader takes the coach's advice and edits the box rather than "
      + "clearing it. Three intent credits fire; nothing else on the page moves.",
    text: EDITED_TEXT,
    expected: Object.freeze({
      chars: 346,
      turns: 1,
      proseUnits: 60,
      turnWeights: Object.freeze([60]),
      axes: Object.freeze({
        intent: Object.freeze({
          baseline: 40,
          signals: Object.freeze([
            Object.freeze({ id: "intent-states-context", contribution: 18 }),
            Object.freeze({ id: "intent-states-constraints", contribution: 18 }),
            Object.freeze({ id: "intent-structured-layout", contribution: 18 }),
          ]),
          sum: 94,
          clamped: false,
          score: 94,
        }),
        efficiency: Object.freeze({
          baseline: 85, signals: Object.freeze([]), sum: 85, clamped: false, score: 85,
        }),
        modelFit: Object.freeze({
          baseline: 80, signals: Object.freeze([]), sum: 80, clamped: false, score: 80,
        }),
      }),
      weighted: Object.freeze({ intent: 47, efficiency: 25.5, modelFit: 16 }),
      unroundedComposite: 88.5,
      composite: 89,
      grade: "B",
      next: Object.freeze({ letter: "A", minimumScore: 90, pointsAway: 1 }),
      improvement: Object.freeze({
        available: true,
        id: "intent-pasted-context",
        kind: "add",
        points: 3,
        assumptionKey: "pastedContextSupplied",
      }),
      ranked: Object.freeze([
        Object.freeze({ id: "intent-pasted-context", kind: "add", points: 3 }),
        Object.freeze({ id: "intent-states-acceptance", kind: "add", points: 3 }),
      ]),
      recommendation: Object.freeze({
        state: RECOMMENDATION_STATE.noEvidence, signalId: null, points: 0,
      }),
    }),
  }),
  Object.freeze({
    id: "first-run-example-replaced",
    label: "The example, replaced outright",
    purpose: "The reader clears the box and pastes their own work. Every intent "
      + "credit fires and the clamp binds, and the one routing credit the rubric "
      + "awards fires with it — the case where no coaching move is left to name.",
    text: REPLACED_TEXT,
    expected: Object.freeze({
      chars: 2299,
      turns: 1,
      proseUnits: 410,
      turnWeights: Object.freeze([410]),
      axes: Object.freeze({
        intent: Object.freeze({
          baseline: 40,
          signals: Object.freeze([
            Object.freeze({ id: "intent-states-context", contribution: 18 }),
            Object.freeze({ id: "intent-states-constraints", contribution: 18 }),
            Object.freeze({ id: "intent-states-acceptance", contribution: 18 }),
            Object.freeze({ id: "intent-structured-layout", contribution: 18 }),
          ]),
          sum: 112,
          clamped: true,
          score: 100,
        }),
        efficiency: Object.freeze({
          baseline: 85, signals: Object.freeze([]), sum: 85, clamped: false, score: 85,
        }),
        modelFit: Object.freeze({
          baseline: 80,
          signals: Object.freeze([
            Object.freeze({ id: "model-fit-substantive-on-premium", contribution: 20 }),
          ]),
          sum: 100,
          clamped: false,
          score: 100,
        }),
      }),
      weighted: Object.freeze({ intent: 50, efficiency: 25.5, modelFit: 20 }),
      unroundedComposite: 95.5,
      composite: 96,
      grade: "A",
      next: null,
      improvement: Object.freeze({
        available: false, id: null, kind: "none", points: 0, assumptionKey: null,
      }),
      ranked: Object.freeze([]),
      recommendation: Object.freeze({
        state: RECOMMENDATION_STATE.fitEvidenced,
        signalId: "model-fit-substantive-on-premium",
        points: 20,
      }),
    }),
  }),
]);

const fixture = (id) => FIXTURES.find((entry) => entry.id === id);

/**
 * Grade one fixture through the shipped session envelope. `source` defaults to
 * reader text because that is what the box produces once anybody has touched it;
 * the bundled-sample path is exercised separately below.
 */
function sessionFor(entry, { source = COACHING_INPUT_SOURCE.readerText } = {}) {
  return buildCoachingSession({
    sessionId: entry.id, text: entry.text, modelTier: TIER, source,
  });
}

/** The classifier's per-turn dimension record for a single-turn fixture. */
function turnDimensions(session) {
  const turns = session.result.detail.aggregation.turnWeights;
  assert.equal(turns.length, 1, "the fixtures in this set are single-turn by construction");
  return session.result.detail;
}

// ---------------------------------------------------------------------------
// Every scoring weight this set rests on has a stated assumption
// ---------------------------------------------------------------------------

test("every published axis weight has a stated assumption and a stated dispute", () => {
  const axes = PROMPT_LITERACY_RUBRIC.axes;
  assert.equal(axes.reduce((sum, axis) => sum + axis.weightPercent, 0), 100,
    "a weighted decomposition of a composite requires the weights to total 100");
  assert.deepEqual(axes.map((axis) => axis.key).sort(),
    Object.keys(COMPOSITE_WEIGHT_ASSUMPTIONS).sort(),
    "an axis the rubric publishes with no assumption stated here is an unexplained weight");

  for (const axis of axes) {
    const stated = COMPOSITE_WEIGHT_ASSUMPTIONS[axis.key];
    assert.equal(stated.weightPercent, axis.weightPercent,
      `${axis.key}: the assumption is written for a weight the rubric no longer publishes`);
    assert.ok(stated.assumption.length > 80, `${axis.key}: assumption is too short to be one`);
    assert.ok(stated.disputeIf.length > 40, `${axis.key}: no stated way to disagree with it`);
    // The rubric's own text is the canonical version and must still be there:
    // this file summarises it, and a summary of nothing is a claim.
    assert.ok(typeof axis.assumption === "string" && axis.assumption.length > 80,
      `${axis.key}: the rubric itself must carry the canonical assumption`);
  }
});

test("every axis baseline has a stated assumption at the value the classifier uses", () => {
  assert.deepEqual(Object.keys(DIMENSION_BASELINES).sort(),
    Object.keys(BASELINE_ASSUMPTIONS).sort());
  for (const [axis, baseline] of Object.entries(DIMENSION_BASELINES)) {
    assert.equal(BASELINE_ASSUMPTIONS[axis].value, baseline,
      `${axis}: the baseline moved and the assumption beside it did not`);
    assert.ok(BASELINE_ASSUMPTIONS[axis].assumption.length > 80);
  }
});

test("every signal a fixture depends on carries the weight and assumption it is filed under", () => {
  const byId = new Map(PROSE_SIGNALS.map((signal) => [signal.id, signal]));
  for (const entry of FIXTURES) {
    for (const [axis, expected] of Object.entries(entry.expected.axes)) {
      for (const fired of expected.signals) {
        const signal = byId.get(fired.id);
        assert.ok(signal, `${entry.id}: no signal "${fired.id}" in the rubric`);
        assert.equal(signal.dimension, axis,
          `${entry.id}: ${fired.id} is not a ${axis} signal`);
        // A contribution is `weight × strength`, and strength is 1 for a
        // presence signal and a saturating rate for a rate signal. Either way
        // the contribution may never exceed the weight it came from.
        assert.ok(Math.abs(fired.contribution) <= Math.abs(signal.weight) + 1e-9,
          `${entry.id}: ${fired.id} contributed more than its weight`);
        assert.equal(Math.sign(fired.contribution), Math.sign(signal.weight),
          `${entry.id}: ${fired.id} contributed against its own polarity`);
        assert.ok(SIGNAL_ASSUMPTIONS[signal.assumptionKey],
          `${entry.id}: ${fired.id} moved a published score with no stated assumption`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The arithmetic, per fixture
// ---------------------------------------------------------------------------

for (const entry of FIXTURES) {
  test(`${entry.id}: the axis arithmetic is the baseline plus each fired signal`, () => {
    const session = sessionFor(entry);
    assert.equal(session.outcome, COACHING_OUTCOME.graded);
    const detail = turnDimensions(session);
    const turn = session.result.detail.turns[0];

    assert.equal(session.input.chars, entry.expected.chars);
    assert.equal(session.input.turns, entry.expected.turns);
    assert.equal(turn.proseUnits, entry.expected.proseUnits);
    assert.deepEqual([...detail.aggregation.turnWeights], [...entry.expected.turnWeights]);

    for (const axis of PROMPT_LITERACY_RUBRIC.axes) {
      const expected = entry.expected.axes[axis.key];
      const reported = detail.axes.find((published) => published.key === axis.key);
      const sum = expected.signals.reduce(
        (total, signal) => total + signal.contribution, expected.baseline,
      );
      assert.equal(sum, expected.sum,
        `${entry.id}/${axis.key}: the stated sum is not the stated addition`);
      const clamped = Math.min(100, Math.max(0, sum));
      assert.equal(clamped !== sum, expected.clamped,
        `${entry.id}/${axis.key}: the clamp claim does not match the arithmetic`);
      assert.equal(clamped, expected.score,
        `${entry.id}/${axis.key}: the reported score is not the clamped sum`);
      assert.equal(reported.score, expected.score,
        `${entry.id}/${axis.key}: the engine disagrees with the fixture`);
      assert.equal(reported.weightPercent, axis.weightPercent);
    }
  });

  test(`${entry.id}: the composite is the weighted sum, rounded exactly once`, () => {
    const session = sessionFor(entry);
    const { benchmark } = session.result;
    const expected = entry.expected;

    let unrounded = 0;
    for (const axis of PROMPT_LITERACY_RUBRIC.axes) {
      const contribution = expected.axes[axis.key].score * axis.weightPercent / 100;
      assert.equal(contribution, expected.weighted[axis.key],
        `${entry.id}/${axis.key}: stated contribution is not score × weight`);
      unrounded += contribution;
    }
    assert.equal(unrounded, expected.unroundedComposite,
      `${entry.id}: the three contributions do not sum to the stated unrounded composite`);
    assert.equal(Math.round(unrounded), expected.composite,
      `${entry.id}: the published integer is not the rounded sum`);
    assert.equal(benchmark.score, expected.composite,
      `${entry.id}: the engine's composite disagrees with the fixture`);

    // The reported figure is at most half a point from the arithmetic it came
    // from — one rounding, at the end, never per axis.
    assert.ok(Math.abs(expected.composite - unrounded) <= 0.5,
      `${entry.id}: more than one rounding happened somewhere`);
    // And that rounding never moved a band. Stated as an assertion rather than
    // as a hope: 55.5 → 56 is a real half-point step in this very set, and the
    // day it steps across a cutoff a reader is owed the disclosure.
    assert.equal(letterGradeForScore(unrounded), letterGradeForScore(expected.composite),
      `${entry.id}: rounding moved the letter grade`);
  });

  test(`${entry.id}: the grade and the benchmark comparison beside it`, () => {
    const session = sessionFor(entry);
    const { benchmark, answer } = session.result;
    const expected = entry.expected;
    const band = PROMPT_LITERACY_RUBRIC.grades.find((grade) => grade.letter === expected.grade);

    assert.equal(benchmark.grade, expected.grade);
    assert.equal(letterGradeForScore(expected.composite), expected.grade,
      `${entry.id}: the letter is not the rubric's own cutoff reading of the score`);
    assert.ok(expected.composite >= band.minimumScore,
      `${entry.id}: ${expected.composite} is below the floor of band ${expected.grade}`);
    assert.equal(benchmark.scoreText, `${expected.composite} / 100`);
    assert.equal(benchmark.bandRule, `${expected.grade} starts at ${band.minimumScore}.`);
    assert.equal(answer, COACHING_ANSWER[expected.grade],
      `${entry.id}: the plain answer is not the one filed under this letter`);

    if (expected.next === null) {
      assert.equal(benchmark.next, null, `${entry.id}: there is no band above ${expected.grade}`);
      assert.match(benchmark.text, /Nothing above this band\.$/);
      return;
    }
    assert.equal(benchmark.next.letter, expected.next.letter);
    assert.equal(benchmark.next.minimumScore, expected.next.minimumScore);
    assert.equal(benchmark.next.pointsAway, expected.next.pointsAway);
    assert.equal(expected.next.minimumScore - expected.composite, expected.next.pointsAway,
      `${entry.id}: the stated distance is not the stated subtraction`);
  });

  test(`${entry.id}: the coaching evidence is ranked by what it is worth`, () => {
    const session = sessionFor(entry);
    const { improvement, detail } = session.result;
    const expected = entry.expected;

    assert.equal(improvement.available, expected.improvement.available);
    assert.equal(improvement.id, expected.improvement.id);
    assert.equal(improvement.kind, expected.improvement.kind);
    assert.equal(improvement.points, expected.improvement.points);
    assert.equal(improvement.assumptionKey, expected.improvement.assumptionKey);
    if (expected.improvement.assumptionKey) {
      assert.ok(detail.assumptions[expected.improvement.assumptionKey],
        `${entry.id}: the first move carries an assumption key with no text behind it`);
    }

    assert.deepEqual(
      detail.improvements.map(({ id, kind, points }) => ({ id, kind, points })),
      expected.ranked.map(({ id, kind, points }) => ({ id, kind, points })),
      `${entry.id}: the ranking is not the fixture's`,
    );
    // The ordering rule, re-derived rather than trusted: points descending,
    // measured evidence before a projection, then the signal id. It is the rule
    // that makes "the one move" the same move on two machines.
    for (let at = 1; at < detail.improvements.length; at += 1) {
      const previous = detail.improvements[at - 1];
      const current = detail.improvements[at];
      const ordered = previous.points > current.points
        || (previous.points === current.points
          && (Number(previous.measured) > Number(current.measured)
            || (previous.measured === current.measured && previous.id < current.id)));
      assert.ok(ordered, `${entry.id}: ${previous.id} is ranked above ${current.id} by no stated rule`);
    }
    // Nothing is offered that is worth nothing: a suggestion with a zero
    // estimate beside it is a suggestion a reader cannot rank.
    assert.ok(detail.improvements.every((move) => move.points > 0));
    // And the top move is the head of the ranking, never a second opinion.
    if (expected.improvement.available) {
      assert.equal(improvement.id, detail.improvements[0].id);
    }
  });

  test(`${entry.id}: the routing recommendation says only what a signal evidenced`, () => {
    const session = sessionFor(entry);
    const { recommendation } = session.result;
    const expected = entry.expected.recommendation;

    assert.equal(recommendation.state, expected.state);
    assert.equal(recommendation.signalId, expected.signalId);
    assert.equal(recommendation.points, expected.points);
    assert.equal(recommendation.evidenced, expected.signalId !== null,
      `${entry.id}: a recommendation is evidenced exactly when a signal fired`);
    if (expected.signalId) {
      const fired = entry.expected.axes.modelFit.signals
        .find((signal) => signal.id === expected.signalId);
      assert.ok(fired, `${entry.id}: the recommendation names a signal the arithmetic does not`);
      assert.equal(expected.points, Math.abs(fired.contribution),
        `${entry.id}: the recommendation's points are not the signal's contribution`);
      assert.ok(SIGNAL_ASSUMPTIONS[recommendation.assumptionKey],
        `${entry.id}: a tier recommendation with no stated assumption behind it`);
    } else {
      assert.equal(recommendation.assumptionKey, null);
      assert.equal(recommendation.to, null);
    }
  });
}

test("the first-run example's vague-request debit is a saturated rate, not a count", () => {
  const session = sessionFor(fixture("first-run-example"));
  const graded = classifyConversation({
    turns: [{ role: "user", body: EXAMPLE_TEXT }], model: "ultra",
  });
  const fired = graded.reasons.turns[0].dimensions.intent.signals
    .find((signal) => signal.id === "intent-vague-request");

  // Five vague phrases — "improve this", "somehow", "fix it", "make it better",
  // "as needed" — and a strength that caps at 1. The count is evidence, not a
  // multiplier: five cost exactly what one saturating rate costs.
  assert.equal(fired.occurrences, 5);
  assert.equal(fired.strength, 1);
  assert.equal(fired.contribution, fired.weight);
  assert.equal(fired.contribution, -12);
  assert.equal(session.result.detail.axes[0].score, 40 - 12);
});

test("the replaced fixture leaves 12 points of intent credit unrealised at the clamp", () => {
  const expected = fixture("first-run-example-replaced").expected.axes.intent;
  const sum = expected.signals.reduce(
    (total, signal) => total + signal.contribution, expected.baseline,
  );
  assert.equal(sum, 112);
  assert.equal(expected.score, 100);
  assert.equal(sum - expected.score, 12,
    "the clamp's cost is stated so nobody reads four fired credits as +72 on the axis");
  assert.equal(sessionFor(fixture("first-run-example-replaced")).result.detail.axes[0].score, 100);
});

// ---------------------------------------------------------------------------
// Reproducibility, refresh, and editing or replacing the example
// ---------------------------------------------------------------------------

test("a fixture graded twice is byte-identical, which is what refresh does", () => {
  for (const entry of FIXTURES) {
    const first = JSON.stringify(sessionFor(entry));
    const second = JSON.stringify(sessionFor(entry));
    assert.equal(first, second, `${entry.id}: two runs of the same text disagree`);
  }
});

test("the shipped first-run example is the fixture, on the tier the sample names", () => {
  const sample = coachingSample(PREVIEW_SAMPLE_ID);
  const entry = fixture("first-run-example");
  assert.equal(sample.text, entry.text, "the fixture no longer quotes the shipped example");
  assert.equal(sample.modelTier, TIER,
    "the example's tier moved, so every model-fit figure in this set needs re-deriving");

  // The path a first visit actually takes: the bundled sample, through the
  // sample builder, with no reader input at all.
  const shipped = buildSampleCoachingSession(PREVIEW_SAMPLE_ID);
  assert.equal(shipped.input.source, COACHING_INPUT_SOURCE.bundledSample);
  assert.equal(shipped.result.benchmark.score, entry.expected.composite);
  assert.equal(shipped.result.benchmark.grade, entry.expected.grade);
  assert.equal(shipped.result.improvement.id, entry.expected.improvement.id);
  assert.equal(JSON.stringify(shipped), JSON.stringify(buildSampleCoachingSession(PREVIEW_SAMPLE_ID)),
    "the example is not stable across two builds, so a refresh could show two scores");
});

test("the score is a function of the text and the tier, not of how the text arrived", () => {
  for (const entry of FIXTURES) {
    const asReader = sessionFor(entry);
    const asSample = sessionFor(entry, { source: COACHING_INPUT_SOURCE.bundledSample });
    // The envelope records where the text came from; the grade may not depend
    // on it. Editing the example must not be scored on a different scale from
    // being shown it.
    assert.notEqual(asReader.input.source, asSample.input.source);
    assert.deepEqual(asReader.result, asSample.result,
      `${entry.id}: the grade changed with the source of the text`);
  }
});

test("every fixture session is valid under the shipped contract and its versions", () => {
  for (const entry of FIXTURES) {
    const session = sessionFor(entry);
    const report = validateCoachingSession(session);
    assert.deepEqual(report.errors, [], `${entry.id}: ${JSON.stringify(report.errors)}`);
    assert.equal(report.valid, true);
    assert.equal(session.schemaVersion, PINNED_VERSIONS.sessionSchema);
    assert.equal(session.question, COACHING_QUESTION);
    assert.equal(session.result.rubricVersionId, PINNED_VERSIONS.rubricVersionId);
    assert.equal(session.result.classifierVersion, PINNED_VERSIONS.classifierVersion);
    assert.equal(session.result.detail.rubricVersionId, RUBRIC_VERSION_ID);
    assert.equal(PROSE_CLASSIFIER_VERSION, PINNED_VERSIONS.classifierVersion);
  }
});

test("editing and replacing the example are graded by the same versioned path", () => {
  const example = sessionFor(fixture("first-run-example"));
  const edited = sessionFor(fixture("first-run-example-edited"));
  const replaced = sessionFor(fixture("first-run-example-replaced"));

  for (const session of [edited, replaced]) {
    assert.equal(session.schemaVersion, example.schemaVersion);
    assert.equal(session.result.version, example.result.version);
    assert.equal(session.result.rubricVersionId, example.result.rubricVersionId);
    assert.equal(session.result.classifierVersion, example.result.classifierVersion);
    assert.equal(session.result.detail.aggregation.rule,
      example.result.detail.aggregation.rule,
      "a replaced example is combined by a different rule from the one it replaced");
  }

  // The movement each fixture is filed under, so "editing raised it" and
  // "replacing raised it further" are figures rather than adjectives.
  assert.equal(edited.result.benchmark.score - example.result.benchmark.score, 33);
  assert.equal(replaced.result.benchmark.score - example.result.benchmark.score, 40);
  // Half of the intent movement is the whole of the edit's reported change:
  // (94 − 28) × 50% = 33. The other two axes did not move.
  assert.equal((94 - 28) * 0.5, 33);
});

test("Noor's comparison contract compares the example with its edit and abstains on nothing", () => {
  const baseline = sessionFor(fixture("first-run-example"));
  const revision = sessionFor(fixture("first-run-example-edited"));
  const change = buildRevisionChange({ comparisonId: "first-run-edit", baseline, revision });

  assert.equal(change.status, REVISION_STATUS.compared);
  assert.equal(change.delta.direction, "improved");
  assert.equal(change.delta.value, "+33 points · 56 → 89 of 100.");
  assert.equal(change.delta.band, "Grade band moved F → B.");
  assert.deepEqual([...change.notices], [], "a first-run comparison withholds nothing");
  assert.equal(change.provenance,
    `Both grades: rubric ${PINNED_VERSIONS.rubricVersionId} · `
    + `classifier ${PINNED_VERSIONS.classifierVersion} · model tier ${TIER}`);
});

// ---------------------------------------------------------------------------
// The share summary: text only, and what it may not contain
// ---------------------------------------------------------------------------

/**
 * A prompt carrying one invented marker of every class this workflow must never
 * let out: a provider invoice, a credential, an HRIS employee record, and a
 * customer identity with a contact address on it.
 *
 * Every marker is fictional and was written for this test. They are searched
 * for, never displayed. The prompt around them is a real request so the fixture
 * grades rather than refusing — a redaction proof on a refusal proves only that
 * a refusal carries no text.
 */
const SENSITIVE_MARKERS = Object.freeze({
  provider: Object.freeze(["acme-cloud", "INV-90210"]),
  credential: Object.freeze(["ACME_API_KEY", "sk-live-FIXTUREONLY-4Q7Z"]),
  hris: Object.freeze(["E-448812"]),
  customer: Object.freeze(["Northwind Traders", "ops@northwind.example", "CU-55219"]),
});

const SENSITIVE_TEXT = [
  "Context: our billing team reconciles the acme-cloud invoice INV-90210 against the ledger every month, and the totals drifted last week.",
  "Constraints: do not change the public API, and keep the credential ACME_API_KEY=sk-live-FIXTUREONLY-4Q7Z out of the export.",
  "The answer should be one patch plus the test that fails without it.",
  "Employee E-448812 in the HRIS owns this job, and customer Northwind Traders (ops@northwind.example, contract CU-55219) is waiting on it.",
].join("\n");

const ALL_MARKERS = Object.freeze(Object.values(SENSITIVE_MARKERS).flat());

/** Every distinct window of `size` characters in a text. */
function windowsOf(text, size) {
  const windows = new Set();
  for (let at = 0; at + size <= text.length; at += 1) windows.add(text.slice(at, at + size));
  return windows;
}

function summaryFor(revisionText, { sessionId = "revised" } = {}) {
  const baseline = sessionFor(fixture("first-run-example"));
  const revision = buildCoachingSession({
    sessionId, text: revisionText, modelTier: TIER,
  });
  const change = buildRevisionChange({ comparisonId: "first-run-share", baseline, revision });
  return {
    change, revision, summary: buildCoachingSummary({ change, result: revision.result }),
  };
}

test("the share summary is text only, and every line is a labelled figure", () => {
  const { summary } = summaryFor(EDITED_TEXT);

  assert.equal(summary.available, true);
  assert.equal(summary.reason, null);
  assert.ok(summary.lines.every((entry) => typeof entry === "string"),
    "a summary line that is not a string is a structure somebody will serialize");
  assert.equal(summary.text, summary.lines.join("\n"));
  assert.equal(summary.lines[0], SUMMARY_TITLE);
  assert.equal(summary.lines.at(-1), SUMMARY_BOUNDARY);

  // The whole summary, pinned. A share record whose lines can change without a
  // test noticing is a share record nobody can audit twice.
  assert.deepEqual([...summary.lines], [
    SUMMARY_TITLE,
    "Baseline: 56 / 100 · grade F",
    "Revised: 89 / 100 · grade B",
    "Change: Material change · improved · +33 points · 56 → 89 of 100.",
    "Grade band: Grade band moved F → B.",
    "Answer: Yes, with one thing left implicit.",
    "Do this next: Paste the material you are talking about. The error, the row, the paragraph. "
      + "It is worth less than saying what the material is for, so pair it with a sentence naming the question.",
    "Both grades: rubric literacy-mix/1.0.0 · classifier prompt-prose-classifier/1.0.0 · model tier premium",
    SUMMARY_BOUNDARY,
  ]);
});

test("every figure in the share summary traces to a figure in the fixture", () => {
  const example = fixture("first-run-example").expected;
  const edited = fixture("first-run-example-edited").expected;
  const { summary } = summaryFor(EDITED_TEXT);

  assert.ok(summary.text.includes(`Baseline: ${example.composite} / 100 · grade ${example.grade}`));
  assert.ok(summary.text.includes(`Revised: ${edited.composite} / 100 · grade ${edited.grade}`));
  assert.ok(summary.text.includes(`+${edited.composite - example.composite} points`));
  assert.ok(summary.text.includes(`${example.grade} → ${edited.grade}`));
  assert.ok(summary.text.includes(COACHING_ANSWER[edited.grade]));

  // Every number printed in the summary is one of the fixture's own. A figure
  // in a shared record that no fixture accounts for is exactly the kind of
  // executive-visible number this repository refuses to publish.
  //
  // The provenance line is held out and checked whole rather than scanned: the
  // digits in it are version identifiers, not measurements, and a scan that
  // accepted "1.0.0" as a figure would accept a real one that looked like it.
  const provenance = summary.lines.filter((entry) => entry.startsWith("Both grades:"));
  assert.deepEqual(provenance, [
    `Both grades: rubric ${PINNED_VERSIONS.rubricVersionId} · `
    + `classifier ${PINNED_VERSIONS.classifierVersion} · model tier ${TIER}`,
  ]);

  const traceable = new Set([
    String(example.composite), String(edited.composite), "100",
    String(edited.composite - example.composite),
  ]);
  const measured = summary.lines.filter((entry) => !entry.startsWith("Both grades:")).join("\n");
  for (const number of measured.match(/\d+(\.\d+)?/g) ?? []) {
    assert.ok(traceable.has(number), `untraceable figure "${number}" in the share summary`);
  }
});

test("the share summary excludes provider, HRIS, credential and customer markers", () => {
  const { summary, change, revision } = summaryFor(SENSITIVE_TEXT, { sessionId: "sensitive" });
  assert.equal(summary.available, true);

  const serialized = [
    JSON.stringify(summary), JSON.stringify(change), JSON.stringify(revision),
  ].join("\n");
  for (const [kind, markers] of Object.entries(SENSITIVE_MARKERS)) {
    for (const marker of markers) {
      assert.ok(SENSITIVE_TEXT.includes(marker),
        `the ${kind} marker "${marker}" is not in the fixture, so finding it proves nothing`);
      assert.ok(!serialized.includes(marker),
        `${kind} marker "${marker}" reached a shared record`);
      assert.ok(!serialized.toLowerCase().includes(marker.toLowerCase()),
        `${kind} marker "${marker}" reached a shared record in another case`);
    }
  }
  assert.equal(ALL_MARKERS.length, 8, "the marker set shrank; redaction is proven over fewer classes");
});

test("no window of a submitted prompt survives into the share summary", () => {
  // The marker scan proves nothing new is copied. This proves nothing *old* is
  // either: any 24-character run of either prompt appearing in the summary is a
  // leak by some route the marker list did not anticipate.
  for (const revised of [SENSITIVE_TEXT, EDITED_TEXT, REPLACED_TEXT]) {
    const { summary, change } = summaryFor(revised);
    const haystack = `${JSON.stringify(summary)}\n${JSON.stringify(change)}`;
    // Both sides of the comparison: the revision just submitted, and the
    // first-run example it was compared against.
    for (const text of [revised, EXAMPLE_TEXT]) {
      for (const window of windowsOf(text, 24)) {
        assert.ok(!haystack.includes(window),
          `a 24-character window of a submitted prompt reached the shared record: ${JSON.stringify(window)}`);
      }
    }
  }
});

test("the boundary sentence travels with every summary and claims only what is true", () => {
  const { summary } = summaryFor(SENSITIVE_TEXT, { sessionId: "sensitive" });
  assert.equal(summary.lines.at(-1), SUMMARY_BOUNDARY);
  assert.match(SUMMARY_BOUNDARY, /No prompt text was sent, stored, or included in this summary\./);
  // A summary that says "nothing was sent" from a module that could send is a
  // sentence, not a boundary. The session envelope states the same thing as
  // data, and it is the data that is checkable.
  const { revision } = summaryFor(SENSITIVE_TEXT, { sessionId: "sensitive" });
  assert.equal(revision.boundary.sentForCoaching, "none");
  assert.equal(revision.boundary.persisted, "none");
  assert.equal(revision.boundary.retainsAnalyzedText, false);
  assert.equal(revision.boundary.integrationsContacted, "none");
});

test("a share summary built twice is identical, including after a re-grade", () => {
  const first = summaryFor(SENSITIVE_TEXT, { sessionId: "sensitive" }).summary;
  const second = summaryFor(SENSITIVE_TEXT, { sessionId: "sensitive" }).summary;
  assert.equal(first.text, second.text);
  assert.deepEqual([...first.lines], [...second.lines]);
});

test("the fixture set names its own version", () => {
  assert.match(FIRST_RUN_COACH_FIXTURES_VERSION, /^first-run-coach-fixtures\/\d+\.\d+\.\d+$/);
  assert.equal(FIXTURES.length, 3);
  assert.deepEqual(FIXTURES.map((entry) => entry.id), [
    "first-run-example", "first-run-example-edited", "first-run-example-replaced",
  ]);
  for (const entry of FIXTURES) {
    assert.ok(entry.purpose.length > 40, `${entry.id}: a fixture with no stated purpose`);
  }
});
