// Drift test for the consolidated FinOps answer (#1499).
//
// The answer on /evolution.html is one headline, one band, one provenance split
// and one coverage scope. This file is the check that all four are still what
// they were when they were reviewed — the served bytes, the render, and the
// pinned fixture held against each other.
//
// WHY IT IS NOT ONE DEEP-EQUAL. A single `deepEqual` of two whole records fails
// with "Expected values to be strictly deep-equal" and a wall of JSON, which
// tells a reviewer that something moved and nothing about what. Every assertion
// below is scoped to ONE dimension and says its name, its expected value and
// its actual value, because the first question after a red is "which number?"
// and the failure message should already have answered it.
//
// THE NAMING IS ITSELF TESTED. `driftedDimensions` is exercised against
// deliberately perturbed datasets further down, so "the message names the right
// dimension" is a property this file holds rather than something a person
// checked once by hand and wrote in a PR body.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import { FINOPS_ANSWER_FIXTURE } from "./fixtures/finops-answer-dimensions.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { getRecoverableSpend } from "../src/finops-answer-contract.js";
import {
  ANSWER_ASSUMPTIONS, ANSWER_DIMENSIONS, FINOPS_ANSWER_VERSION, finopsAnswerDimensions,
} from "../src/finops-answer-dimensions.js";
import {
  ANSWER_PROOF_IDS, renderAnswerProof, renderRecoverableSpend,
} from "../src/finops-answer-contract-view.js";
import { applyRecoverableConfidence } from "../src/finops-recoverable-confidence-view.js";

const SOURCE = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

const show = (value) => JSON.stringify(value);

/**
 * The dimensions on which two records disagree, each with both values.
 *
 * Returns records rather than throwing, so a caller can assert per dimension and
 * so the perturbation tests below can assert on WHICH names come back.
 */
const driftedDimensions = (actual, expected) => ANSWER_DIMENSIONS
  .map((dimension) => ({
    dimension,
    expected: expected?.[dimension],
    actual: actual?.[dimension],
  }))
  .filter((entry) => show(entry.actual) !== show(entry.expected));

/** One assertion per dimension, each naming itself, its expected and its actual. */
const assertNoDrift = (actual, expected, where) => {
  for (const dimension of ANSWER_DIMENSIONS) {
    assert.deepEqual(actual?.[dimension], expected?.[dimension],
      `${where}: the "${dimension}" dimension of the FinOps answer drifted.`
      + ` Expected ${show(expected?.[dimension])}, got ${show(actual?.[dimension])}.`
      + " Either restore the value or bump the fixture version with the change that moved it.");
  }
};

test("the computed answer matches the pinned fixture on every dimension", () => {
  assertNoDrift(finopsAnswerDimensions(), FINOPS_ANSWER_FIXTURE, "computed vs fixture");
});

test("a values change without a version bump reds", () => {
  // The version is the fifth thing pinned. It is asserted from BOTH sides — the
  // module's stamp and the record it stamps — so a record built with a stale
  // constant cannot pass on the constant alone.
  assert.equal(FINOPS_ANSWER_VERSION, FINOPS_ANSWER_FIXTURE.version,
    `the "version" stamp drifted. Expected ${show(FINOPS_ANSWER_FIXTURE.version)},`
    + ` got ${show(FINOPS_ANSWER_VERSION)}.`);
  assert.equal(finopsAnswerDimensions().version, FINOPS_ANSWER_FIXTURE.version);
});

test("computing the dimensions twice in one run yields identical output", () => {
  // No clock, no randomness, no key-iteration order, no locale formatter: the
  // fixture is only pinnable if the measurement is the same measurement twice.
  const first = finopsAnswerDimensions();
  const second = finopsAnswerDimensions();
  assert.equal(show(first), show(second), "the measurement is not deterministic within one run");
  // And over a second, independently-loaded copy of the same dataset, so the
  // determinism is the computation's rather than a cached object's identity.
  assert.equal(show(finopsAnswerDimensions(loadExampleDataset())), show(first));
});

test("the served page states the same four dimensions as the fixture", () => {
  const document = parseHtml(SOURCE);
  const proof = document.getElementById(ANSWER_PROOF_IDS.sentence);
  assert.ok(proof, "the supporting layer carries no proof line");

  // The served bytes, before any script runs. A reader on a slow connection, a
  // printed page and a reader with JavaScript off all live here.
  assertNoDrift(readDimensions(document), FINOPS_ANSWER_FIXTURE, "served bytes vs fixture");

  // And after the paint the page actually performs at boot.
  const dataset = loadExampleDataset();
  renderRecoverableSpend(document, getRecoverableSpend(dataset));
  renderAnswerProof(document, finopsAnswerDimensions(dataset));
  applyRecoverableConfidence(document);
  assertNoDrift(readDimensions(document), FINOPS_ANSWER_FIXTURE, "rendered page vs fixture");
});

/**
 * The four dimensions, read back OFF THE PAGE.
 *
 * Deliberately read from the slots a reader meets — the headline value, the
 * grade chip, the figure's scope attributes and the proof line — rather than
 * from one convenient blob, so a slot that stopped being written reds here
 * instead of passing on a sibling's value.
 */
function readDimensions(document) {
  const proof = document.getElementById(ANSWER_PROOF_IDS.sentence);
  const figure = document.getElementById("finops-recoverable-figure");
  const said = textOf(proof);
  const number = (value) => Number(value);
  // The band and the share a reader is asked to compare are stated in WORDS,
  // so they are read back out of the words. A sentence that stopped naming its
  // own cut points would red here rather than passing on an attribute nobody
  // sees.
  const percent = (pattern) => {
    const found = said.match(pattern);
    return found ? Number(found[1]) / 100 : Number.NaN;
  };
  return {
    headline: {
      monthlyUsd: number(proof.dataset.headlineUsd),
      display: textOf(document.getElementById("finops-recoverable-value")),
      basis: figure.dataset.basis,
    },
    confidence: {
      grade: proof.dataset.confidenceGrade,
      label: (said.match(/graded (\S+) —/) ?? [])[1],
      floor: percent(/published from (\d+)%/),
      ceiling: percent(/to (\d+)% of analyzed/),
      measuredPercent: Number((said.match(/measures (\d+)%/) ?? [])[1]),
    },
    provenance: {
      declared: number(proof.dataset.provenanceDeclared),
      derived: number(proof.dataset.provenanceDerived),
    },
    coverage: {
      // The scope attributes the FIGURE carries are the counts a reader sees
      // beside the number, so they are the ones read here — the coverage
      // dimension reds if the figure and the proof line ever disagree.
      scored: number(figure.dataset.scoredDepartments),
      total: number(figure.dataset.totalDepartments),
      departmentIds: String(proof.dataset.coverageDepartments ?? "").split(" ").filter(Boolean),
    },
  };
}

test("the proof line and the figure state one set of coverage counts", () => {
  const document = parseHtml(SOURCE);
  const proof = document.getElementById(ANSWER_PROOF_IDS.sentence);
  const figure = document.getElementById("finops-recoverable-figure");
  assert.equal(proof.dataset.coverageScored, figure.dataset.scoredDepartments);
  assert.equal(proof.dataset.coverageTotal, figure.dataset.totalDepartments);
});

test("the grade chip beside the figure states the pinned band", () => {
  const document = parseHtml(SOURCE);
  applyRecoverableConfidence(document);
  const grade = document.getElementById("finops-recoverable-grade");
  assert.equal(grade.dataset.grade, FINOPS_ANSWER_FIXTURE.confidence.grade,
    `the "confidence" dimension drifted at the chip. Expected`
    + ` ${show(FINOPS_ANSWER_FIXTURE.confidence.grade)}, got ${show(grade.dataset.grade)}.`);
  assert.ok(textOf(grade).includes(FINOPS_ANSWER_FIXTURE.confidence.label),
    "the chip states a grade word the fixture does not pin");
});

test("a perturbed value names its own dimension and leaves the others alone", () => {
  const dataset = loadExampleDataset();

  // A recoverable line that moved: the headline follows it. Provenance and
  // coverage do not, because the same five departments are still scored and
  // still priced the same way.
  const richer = {
    ...dataset,
    rankedDepartments: dataset.rankedDepartments.map((row, index) => (index === 0
      ? { ...row, recoverableUsd: row.recoverableUsd + 1000 } : row)),
  };
  assert.deepEqual(driftedDimensions(finopsAnswerDimensions(richer), FINOPS_ANSWER_FIXTURE)
    .map((entry) => entry.dimension), ["headline"]);

  // A department that lost its score: coverage and the headline move together,
  // and so does the provenance split, because one fewer line is behind the
  // figure. Confidence is graded off spend, not off the recoverable line, so it
  // is the one dimension that holds.
  const unscored = {
    ...dataset,
    rankedDepartments: dataset.rankedDepartments.map((row, index) => (index === 0
      ? { ...row, recoverableUsd: null } : row)),
  };
  assert.deepEqual(driftedDimensions(finopsAnswerDimensions(unscored), FINOPS_ANSWER_FIXTURE)
    .map((entry) => entry.dimension), ["headline", "provenance", "coverage"]);

  // A rate card someone declared: only the provenance split moves. The figure
  // is unchanged because declaring a card changes where a price came from, not
  // what it was.
  const declared = {
    ...dataset,
    rankedDepartments: dataset.rankedDepartments.map((row, index) => (index === 0
      ? { ...row, downRouting: { ...row.downRouting, pricing: { ...row.downRouting.pricing, declaredCard: true } } }
      : row)),
  };
  const moved = driftedDimensions(finopsAnswerDimensions(declared), FINOPS_ANSWER_FIXTURE);
  assert.deepEqual(moved.map((entry) => entry.dimension), ["provenance"]);
  assert.deepEqual(moved[0].actual, { declared: 1, derived: 4 },
    "the declared/derived split did not follow the declaration");
});

test("no count in the proof layer is stated without its assumption beside it", () => {
  const document = parseHtml(SOURCE);
  const proof = document.getElementById(ANSWER_PROOF_IDS.sentence);
  const assumptions = document.getElementById(ANSWER_PROOF_IDS.assumptions);
  assert.ok(assumptions, "the counts ship without the assumptions they stand on");

  // Every dimension's assumption is reachable in the SAME layer, unfolded: an
  // assumption behind a control is an assumption a reader is not told, and this
  // harness reads through a shut disclosure so no other test here would notice.
  const stated = textOf(assumptions);
  for (const dimension of ANSWER_DIMENSIONS) {
    assert.ok(stated.includes(ANSWER_ASSUMPTIONS[dimension]),
      `the "${dimension}" dimension is stated with no assumption a reader can argue with`);
  }
  for (const node of [proof, assumptions]) {
    for (let up = node.parentNode; up; up = up.parentNode) {
      assert.notEqual(up.tagName, "DETAILS", "the answer's proof was folded into a disclosure");
    }
    assert.equal(nearestIdAbove(node), "finops-answer-support",
      "the proof left the answer's supporting-detail layer");
  }

  // It restates no money — the headline is stated once, above — and it takes no
  // tab stop on a first screen that has none to spare.
  assert.equal(/\$[\d,]+/.test(textOf(proof)), false,
    "the proof line states a second money figure in the answer region");
  const focusable = tabSequence(document).filter((node) =>
    node.id === ANSWER_PROOF_IDS.sentence || node.id === ANSWER_PROOF_IDS.assumptions);
  assert.equal(focusable.length, 0, "the proof layer added a tab stop to the first screen");
});

/** The id of the nearest ancestor that has one. Walked, because this harness
 *  rejects descendant selectors. */
function nearestIdAbove(node) {
  for (let up = node.parentNode; up; up = up.parentNode) if (up.id) return up.id;
  return null;
}
