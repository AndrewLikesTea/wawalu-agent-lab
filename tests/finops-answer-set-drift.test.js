// ONE COMPUTED ANSWER, AND EVERY PLACE THAT STATES IT (#1184).
//
// The recoverable figure, the total it is a share of, the destination it is
// recovered from, and the coverage the confidence claim rests on were four facts
// restated by hand in a dozen places: the answer block, the supporting panels,
// the provenance sentences under both, the canonical decision record, and the
// homepage's proof point. Nothing tied them together, so a dataset edit moved
// some of them and left the rest saying the old number.
//
// This file is the tie. Every expectation below is COMPUTED by calling
// `exampleAnswerSet()` — no expected dollar figure is typed anywhere in it, so a
// dataset change moves the expectation and reds every surface that did not move
// with it. A test that restated the number would be the same bug wearing a test
// harness.
//
// HARNESS RULES THIS FILE KEEPS. `textOf` reads THROUGH a shut details element,
// so nothing here treats text presence as visibility — the visibility claims are
// made on attributes elsewhere and this file only checks what the words SAY.
// Descendant selectors throw, so subtrees are walked through `parentNode` and
// `children`. Nothing is asserted equal to null: counts and attributes only.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, textOf } from "./support/browser.js";
import {
  EXAMPLE_ANSWER_SET_VERSION, exampleAnswerSet, loadExampleDataset,
} from "../src/example-dataset.js";
import { EXAMPLE_FIGURE_SOURCES } from "../src/finops-example-figure-sources.js";
import { applyExampleFigureSources } from "../src/finops-example-figure-sources.js";
import { applyFirstRunResult } from "../src/finops-first-run-view.js";
import { buildFirstRunResult } from "../src/finops-first-run.js";
import { loadCanonicalDecision } from "../src/finops-decision-contract.js";

const EVOLUTION = new URL("../src/evolution.html", import.meta.url);
const ACTION_CENTER = new URL("../src/savings-action-center.html", import.meta.url);
const HOMEPAGE = new URL("../src/index.html", import.meta.url);

const evolutionHtml = await readFile(EVOLUTION, "utf8");
const actionCenterHtml = await readFile(ACTION_CENTER, "utf8");
const homepageHtml = await readFile(HOMEPAGE, "utf8");

const ANSWER = exampleAnswerSet();

/** Every whole-dollar figure in a string, in the shape this site formats them. */
const dollarsIn = (text) => String(text ?? "").match(/\$\d[\d,]*(?!\.\d)\b/g) ?? [];

/** Every element under a node, in document order. No descendant selectors. */
function walk(node, found = []) {
  for (const child of node.children ?? []) {
    if (child.nodeType === 1) {
      found.push(child);
      walk(child, found);
    }
  }
  return found;
}

/**
 * The ids on `evolution.html` that publish an answer-set figure, and which
 * derived string each one must carry.
 *
 * Named per id rather than scanned across the region on purpose: the region also
 * carries figures that are NOT in this answer set — the peer cost per successful
 * task, the declared-fact estimate's modelled range, the cohort boundaries — and
 * a blanket scan would either fail on those or be widened until it proved
 * nothing. Every id below states one of the four facts; every one of them is
 * checked for the derived value AND for carrying no dollar figure the derivation
 * did not produce.
 */
const ANSWER_SET_SLOTS = () => [
  ["finops-first-run-answer", [ANSWER.recoverableShareDisplay]],
  ["finops-first-run-answer-detail", [ANSWER.recoverableDisplay]],
  ["finops-first-run-answer-source-detail",
    [ANSWER.recoverableDisplay, ANSWER.analyzedSpendDisplay]],
  ["finops-first-run-benchmark-value", [ANSWER.recoverableShareDisplay]],
  ["finops-first-run-benchmark-detail",
    [ANSWER.recoverableDisplay, ANSWER.analyzedSpendDisplay]],
  ["finops-first-run-benchmark-source-detail",
    [ANSWER.recoverableDisplay, ANSWER.analyzedSpendDisplay]],
  ["finops-first-run-impact-value", [ANSWER.recoverableDisplay]],
  ["finops-first-run-literacy-detail",
    [ANSWER.confidenceCoverage.scoredSpendDisplay, ANSWER.analyzedSpendDisplay]],
  ["finops-first-run-literacy-source-detail",
    [ANSWER.confidenceCoverage.scoredSpendDisplay, ANSWER.analyzedSpendDisplay]],
  ["finops-first-run-action", [ANSWER.recoverableDisplay]],
];

// --- the contract ------------------------------------------------------------

test("the answer set is a named, versioned contract over the four facts", () => {
  assert.equal(ANSWER.version, EXAMPLE_ANSWER_SET_VERSION);

  // The total, the recoverable amount, and the share between them.
  assert.ok(Number.isFinite(ANSWER.analyzedSpendUsd) && ANSWER.analyzedSpendUsd > 0);
  assert.ok(Number.isFinite(ANSWER.recoverableUsd) && ANSWER.recoverableUsd >= 0);
  assert.equal(ANSWER.recoverableShare, ANSWER.recoverableUsd / ANSWER.analyzedSpendUsd);

  // The destination, named rather than ranked-and-left-to-the-reader.
  assert.equal(typeof ANSWER.topDestination.name, "string");
  assert.ok(ANSWER.topDestination.name.length > 0);
  assert.ok(ANSWER.topDestination.spendUsd <= ANSWER.analyzedSpendUsd);

  // The coverage the confidence claim is bounded by. The SCORE is the canonical
  // decision record's; these are its inputs, which is why they are named for
  // what they measure rather than for the sentence they appear in.
  const coverage = ANSWER.confidenceCoverage;
  assert.equal(coverage.scoredShare, coverage.scoredSpendUsd / ANSWER.analyzedSpendUsd);
  assert.ok(coverage.departmentsScored <= coverage.departmentsTotal);
  assert.ok(coverage.promptsScored <= coverage.promptsTotal);
  assert.equal(coverage.departmentsTotal, ANSWER.departmentCount);
});

test("the derivation is a pure, deterministic function of the dataset", () => {
  const analysis = loadExampleDataset();
  const first = exampleAnswerSet(analysis);
  const second = exampleAnswerSet(analysis);
  assert.deepEqual(first, second);
  // And the same object the bundled default produces: the cached default is not
  // a second derivation with a life of its own.
  assert.deepEqual(first, exampleAnswerSet());
  // Frozen on the way out, so no surface can edit the answer for the next one.
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.confidenceCoverage), true);
});

test("an analysis with nothing to divide produces no answer set, not zeroes", () => {
  assert.equal(exampleAnswerSet({ spendUsd: 0, recoverableUsd: 0, rankedDepartments: [] }), null);
  assert.equal(exampleAnswerSet({ rankedDepartments: [] }), null);
});

test("rounding happens once, at the derivation, and every display is one of its own", () => {
  // Each display string is the formatter's output for its own field, so no
  // caller can re-round and land somewhere else.
  assert.equal(dollarsIn(ANSWER.recoverableDisplay).length, 1);
  assert.equal(dollarsIn(ANSWER.analyzedSpendDisplay).length, 1);
  assert.match(ANSWER.recoverableShareDisplay, /^\d+%$/);
  // The published money set is exactly the distinct dollar strings above it.
  assert.deepEqual([...ANSWER.moneyDisplays].sort(), [...new Set([
    ANSWER.analyzedSpendDisplay, ANSWER.recoverableDisplay,
    ANSWER.confidenceCoverage.scoredSpendDisplay,
  ])].sort());
});

// --- the figure-source markers ----------------------------------------------

test("every provenance marker states the derivation's figures, never its own copy", () => {
  const money = new Set(ANSWER.moneyDisplays);
  const answerSetMarkers = ["answer", "benchmark", "impact", "literacy"];
  for (const id of answerSetMarkers) {
    const entry = EXAMPLE_FIGURE_SOURCES.find((found) => found.id === id);
    assert.ok(entry, `${id} lost its marker`);
    for (const found of [...dollarsIn(entry.value), ...dollarsIn(entry.origin)]) {
      assert.ok(money.has(found),
        `marker ${id} states ${found}, which the derivation does not produce`);
    }
  }
  // The recoverable figure and the total it divides are both spoken by the two
  // markers that show the working, so a reader can check the ratio.
  const working = EXAMPLE_FIGURE_SOURCES.find((entry) => entry.id === "benchmark").origin;
  assert.ok(working.includes(ANSWER.recoverableDisplay));
  assert.ok(working.includes(ANSWER.analyzedSpendDisplay));
  assert.ok(working.includes(ANSWER.period));
});

// --- the authored page ------------------------------------------------------

test("every answer-set figure authored on evolution.html equals the derivation", () => {
  const document = parseHtml(evolutionHtml);
  const money = new Set(ANSWER.moneyDisplays);
  for (const [id, expected] of ANSWER_SET_SLOTS()) {
    const node = document.getElementById(id);
    assert.ok(node, `${id} is not authored on the page`);
    const spoken = textOf(node);
    for (const value of expected) {
      assert.ok(spoken.includes(value),
        `${id} does not state ${value}; it says: ${spoken}`);
    }
    for (const found of dollarsIn(spoken)) {
      assert.ok(money.has(found),
        `${id} states ${found}, which the derivation does not produce`);
    }
  }
});

test("the homepage's proof point restates nothing the derivation did not compute", () => {
  const document = parseHtml(homepageHtml);
  const proof = walk(document).filter((node) =>
    node.classList?.contains?.("hero-proof-point"));
  assert.equal(proof.length, 1);
  const spoken = textOf(proof[0]);
  assert.ok(spoken.includes(ANSWER.recoverableShareDisplay));
  assert.ok(spoken.includes(ANSWER.recoverableDisplay));
  assert.ok(spoken.includes(ANSWER.analyzedSpendDisplay));
  assert.ok(spoken.includes(ANSWER.topDestination.name));
  const money = new Set(ANSWER.moneyDisplays);
  for (const found of dollarsIn(spoken)) {
    assert.ok(money.has(found), `the proof point states ${found}, which is not derived`);
  }
});

test("the canonical decision record quotes the derivation rather than a second answer", () => {
  const loaded = loadCanonicalDecision();
  assert.equal(loaded.valid, true);
  const money = new Set(ANSWER.moneyDisplays);
  const stated = [
    loaded.decision.benchmark?.headline, loaded.decision.impact?.headline,
    loaded.decision.benchmark?.detail, loaded.decision.impact?.detail,
  ].filter(Boolean).join(" ");
  assert.ok(stated.includes(ANSWER.recoverableShareDisplay));
  assert.ok(stated.includes(ANSWER.recoverableDisplay));
  for (const found of dollarsIn(stated)) {
    assert.ok(money.has(found),
      `the canonical record states ${found}, which the derivation does not produce`);
  }
});

test("the savings action center publishes no answer-set figure of its own", () => {
  // It carries none of the four facts: its figures come from a reader's own
  // restored evidence and from the journey fixtures, which are a different
  // dataset with their own numbers. So the guard here is that it never grows a
  // hardcoded copy of this answer — the drift this issue closes, arriving by a
  // door nobody was watching.
  assert.deepEqual(dollarsIn(actionCenterHtml), []);
});

// --- the painted page -------------------------------------------------------

test("the painted region states the same figures the authored one does", async () => {
  const page = await loadPage(EVOLUTION);
  try {
    const { document } = page;
    applyFirstRunResult(document, buildFirstRunResult());
    applyExampleFigureSources(document);
    const money = new Set(ANSWER.moneyDisplays);
    for (const [id, expected] of ANSWER_SET_SLOTS()) {
      const node = document.getElementById(id);
      assert.ok(node, `${id} left the page on paint`);
      const spoken = textOf(node);
      for (const value of expected) {
        assert.ok(spoken.includes(value),
          `after paint, ${id} does not state ${value}; it says: ${spoken}`);
      }
      for (const found of dollarsIn(spoken)) {
        assert.ok(money.has(found),
          `after paint, ${id} states ${found}, which the derivation does not produce`);
      }
    }
  } finally {
    page.restore();
  }
});
