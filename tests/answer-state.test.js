// The one held answer: which source produced it, and what a bad import may do
// to it — which is nothing.
//
// WHAT THIS FILE PINS.
//
//   1. Determinism. The same export in produces the same headline metric out,
//      twice, and the assertion carries a literal number so a silent change to
//      a scoring formula fails here rather than in a screenshot nobody diffed.
//   2. The fallback is the same computation. An imported answer and the
//      synthetic one expose the same keys, so the renderer has one contract and
//      `getSource()` is the only observable difference.
//   3. Every failure class is a no-op. Malformed, empty, and wrong-shape inputs
//      each return their stated recoverable sentence and leave the previously
//      held answer byte-identical — compared by deep equality against a copy
//      taken before the attempt.
//
// Nothing here recomputes a figure. Every number is the one `finops-stand.js`
// already published, so a drift between the two sources fails as a mismatch
// rather than passing under a second arithmetic path.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ANSWER_SOURCE, IMPORT_CLASSIFICATION, IMPORT_REJECTION, classifyImport, createAnswerState,
} from "../src/answer-state.js";
import { buildStandHeadline, standHeadlineForImport } from "../src/finops-stand.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { validateCohortAttribution } from "../src/cohort-attribution.js";

/**
 * A parsed export in the shape the page holds it: the analysis the import
 * pipeline produced, plus the eligibility decision the cohort contract made.
 * Generated from the repository's own example dataset rather than committed, so
 * it moves with the modules under test instead of pinning a stale copy of them.
 */
const parsedExport = () => ({
  analysis: loadExampleDataset(),
  eligibility: validateCohortAttribution({}),
});

// ---------------------------------------------------------------------------
// 1. Determinism, and the literal the formula is pinned to.
// ---------------------------------------------------------------------------

test("the same export produces the same headline metric, twice", () => {
  const first = createAnswerState();
  const second = createAnswerState();
  assert.equal(first.setImport(parsedExport()).committed, true);
  assert.equal(second.setImport(parsedExport()).committed, true);
  assert.deepEqual(first.getAnswer(), second.getAnswer(),
    "two states given the same rows must hold the same answer, key for key");

  // Re-importing into the SAME state is the other half of determinism: a second
  // pass over identical rows may not accumulate anything.
  const before = structuredClone(first.getAnswer());
  first.setImport(parsedExport());
  assert.deepEqual(first.getAnswer(), before);
});

test("the headline metric is the published figure, not a number this module invented", () => {
  const analysis = loadExampleDataset();
  // The literal. `recoverableShare` publishes 51254 of 154500 analyzed, which
  // is 33% — a silent change to either side of that division fails here.
  assert.equal(analysis.spendUsd, 154500);
  assert.equal(analysis.recoverableUsd, 51254);

  const state = createAnswerState();
  state.setImport({ analysis, eligibility: validateCohortAttribution({}) });
  assert.equal(state.getAnswer().metric.value, "$51,254 · 33% of analyzed spend");
  assert.equal(state.getAnswer().metric.available, true);

  // …and it is the composer's own slot, quoted rather than paraphrased.
  const composed = standHeadlineForImport({
    analysis, eligibility: validateCohortAttribution({}),
  });
  assert.equal(state.getAnswer().metric.value, composed.recoverable.value);
  assert.equal(state.getAnswer().metric.basis, composed.recoverable.basis);
});

// ---------------------------------------------------------------------------
// 2. One contract for the renderer.
// ---------------------------------------------------------------------------

test("an imported answer and the synthetic answer expose the same keys", () => {
  const state = createAnswerState();
  const fallback = state.getAnswer();
  assert.equal(state.getSource(), ANSWER_SOURCE.synthetic);

  assert.equal(state.setImport(parsedExport()).committed, true);
  const imported = state.getAnswer();
  assert.equal(state.getSource(), ANSWER_SOURCE.imported);

  assert.deepEqual(Object.keys(imported).sort(), Object.keys(fallback).sort(),
    "the renderer reads one shape; the source is the only difference it may see");
  for (const slot of ["metric", "action", "position", "withheld"]) {
    assert.deepEqual(Object.keys(imported[slot]).sort(), Object.keys(fallback[slot]).sort(),
      `${slot} must have the same keys under both sources`);
  }
  assert.equal(Array.isArray(imported.departments), true);
  assert.equal(Array.isArray(fallback.departments), true);
  assert.notEqual(imported.source, fallback.source);
});

test("the synthetic answer is the composer's bundled headline, marker and all", () => {
  const state = createAnswerState();
  const composed = buildStandHeadline();
  assert.equal(state.getAnswer().label, composed.label,
    "the bundled marker on the answer must be the one the page already paints");
  assert.match(state.getAnswer().label, /Bundled synthetic example/);
  assert.equal(state.getHeadline().label, composed.label,
    "the record handed to the view and the bounded answer come from one commit");
});

test("clearing the import restores the synthetic fallback", () => {
  const state = createAnswerState();
  const fallback = structuredClone(state.getAnswer());
  state.setImport(parsedExport());
  assert.equal(state.getSource(), ANSWER_SOURCE.imported);

  state.clearImport();
  assert.equal(state.getSource(), ANSWER_SOURCE.synthetic);
  assert.deepEqual(state.getAnswer(), fallback,
    "a clear restores the bundled answer exactly, not an approximation of it");
  assert.match(state.getAnswer().label, /Bundled synthetic example/);
});

// ---------------------------------------------------------------------------
// 3. Every failure class: stated message, and no change to what is held.
// ---------------------------------------------------------------------------

const FAILURES = [
  {
    name: "malformed",
    classification: IMPORT_CLASSIFICATION.malformed,
    inputs: ["not an export", 42, true, [], [{ analysis: {} }], { analysis: "rows" },
      { analysis: [] }],
  },
  {
    name: "empty",
    classification: IMPORT_CLASSIFICATION.empty,
    inputs: [null, undefined, {}, { analysis: null }, { analysis: null, eligibility: null },
      { analysis: { spendUsd: 0, rankedDepartments: [] } }],
  },
  {
    name: "wrong-shape",
    classification: IMPORT_CLASSIFICATION.wrongShape,
    inputs: [{ analysis: { spendUsd: 100 } },
      { analysis: { rankedDepartments: [{ name: "Data" }] } },
      { analysis: { spendUsd: "154500", rankedDepartments: [{ name: "Data" }] } }],
  },
];

for (const failure of FAILURES) {
  test(`${failure.name} input returns its stated message and commits nothing`, () => {
    for (const input of failure.inputs) {
      const verdict = classifyImport(input);
      assert.equal(verdict.valid, false, `${JSON.stringify(input)} must not validate`);
      assert.equal(verdict.classification, failure.classification,
        `${JSON.stringify(input)} was classified ${verdict.classification}`);
      assert.equal(verdict.message, IMPORT_REJECTION[failure.classification]);
      assert.match(verdict.message, /The answer on screen is unchanged\./,
        "every recoverable message must say the reader lost nothing");
    }
  });

  test(`${failure.name} input leaves the synthetic answer byte-identical`, () => {
    const state = createAnswerState();
    const before = structuredClone(state.getAnswer());
    for (const input of failure.inputs) {
      const outcome = state.setImport(input);
      assert.equal(outcome.committed, false);
      assert.equal(outcome.message, IMPORT_REJECTION[failure.classification]);
      assert.equal(state.getSource(), ANSWER_SOURCE.synthetic);
      assert.deepEqual(state.getAnswer(), before,
        "a rejected import may not move a single field of the held answer");
    }
  });

  test(`${failure.name} input leaves a previously imported answer byte-identical`, () => {
    const state = createAnswerState();
    assert.equal(state.setImport(parsedExport()).committed, true);
    const before = structuredClone(state.getAnswer());
    for (const input of failure.inputs) {
      assert.equal(state.setImport(input).committed, false);
      assert.equal(state.getSource(), ANSWER_SOURCE.imported,
        "a rejected import may not silently drop the reader back to the example");
      assert.deepEqual(state.getAnswer(), before);
    }
  });
}

test("a composer that throws is a no-op, with its own stated sentence", () => {
  const state = createAnswerState({
    imported: () => { throw new Error("composer failed"); },
  });
  const before = structuredClone(state.getAnswer());
  const outcome = state.setImport(parsedExport());
  assert.equal(outcome.committed, false);
  assert.equal(outcome.classification, IMPORT_CLASSIFICATION.unreadable);
  assert.equal(outcome.message, IMPORT_REJECTION[IMPORT_CLASSIFICATION.unreadable]);
  assert.equal(state.getSource(), ANSWER_SOURCE.synthetic);
  assert.deepEqual(state.getAnswer(), before,
    "a mid-computation throw may not leave a half-updated answer behind");
});

test("an eligibility decision with no analysis is still the reader's own answer", () => {
  // The page's own path: a selection whose rows could not be analyzed can still
  // have declared its cohort attributes, and the placement contract's sentence
  // about THAT FILE must not be replaced by the bundled example's headline.
  const state = createAnswerState();
  const outcome = state.setImport({ analysis: null, eligibility: validateCohortAttribution({}) });
  assert.equal(outcome.committed, true);
  assert.equal(state.getSource(), ANSWER_SOURCE.imported);
  assert.equal(state.getAnswer().withheld.available, true,
    "an answer with no analysis behind it must state what is missing and one next step");
  assert.notEqual(state.getAnswer().withheld.nextStep, "");
});

test("a valid import commits and reports no message", () => {
  const state = createAnswerState();
  const outcome = state.setImport(parsedExport());
  assert.equal(outcome.committed, true);
  assert.equal(outcome.classification, IMPORT_CLASSIFICATION.valid);
  assert.equal(outcome.message, "");
});
