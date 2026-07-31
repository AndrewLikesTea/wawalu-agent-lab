// The structural signal families, against a labelled corpus.
//
// Three claims are made to a FinOps lead and all three are checked here:
//
//   1. An ordinary enterprise mix classifies at or above a stated share, and
//      the share is a named constant with the reason it was chosen.
//   2. The same input scored twice serializes to the same bytes, so no map
//      ordering and no float accumulation can move a published class.
//   3. Every published class names the family and weight that produced it, and
//      a record with no evidence stays unclassified rather than being guessed.
//
// The corpus labels were derived from the weights first. Where the
// implementation disagreed with a label during development the LABEL was
// checked by hand against `src/query-signal-families.js` and the weight that
// was actually wrong was changed, not the label bent to fit.

import assert from "node:assert/strict";
import test from "node:test";
import {
  MINIMUM_CLASSIFICATION_CONFIDENCE, QUERY_SIGNAL_DECLARATIONS, SIGNAL_FAMILY,
  UNCLASSIFIED_CATEGORY, UNCLASSIFIED_REASONS, classifyThread, signalDeclaration,
  signalFamilyDisclosureRows,
} from "../src/query-classification.js";
import { QUERY_SIGNAL_CORPUS } from "./fixtures/query-signals/corpus.js";

/**
 * THE CLASSIFIED-SHARE FLOOR, and why this number.
 *
 * Eight of the nine corpus records carry evidence some family can read; the
 * ninth is a routine cheap one-liner the rubric has nothing to say about and is
 * labelled unclassified on purpose. 8/9 is 0.888…, so the floor is set at 0.8:
 * high enough that losing one classifiable record fails the suite, low enough
 * that it does not silently demand the deliberately-unclassified record be
 * graded. It is a floor on COVERAGE, never a target for accuracy — a classifier
 * that met it by calling everything `inefficient` would still fail every
 * per-record assertion below.
 */
const MINIMUM_CLASSIFIED_SHARE = 0.8;

const scored = () => QUERY_SIGNAL_CORPUS.map((record) => ({
  record, result: classifyThread(record),
}));

test("the corpus classifies at or above the stated share", () => {
  const runs = scored();
  const classified = runs.filter(({ result }) => result.classified).length;
  const share = classified / runs.length;
  assert.ok(share >= MINIMUM_CLASSIFIED_SHARE,
    `classified ${classified}/${runs.length} = ${share}, floor ${MINIMUM_CLASSIFIED_SHARE}`);
  // And the share is not met by grading the record that must not be graded.
  const deliberate = runs.find(({ record }) => record.id === "trivial-on-economy");
  assert.equal(deliberate.result.classified, false);
  assert.equal(deliberate.result.category, UNCLASSIFIED_CATEGORY);
  assert.equal(deliberate.result.reason, UNCLASSIFIED_REASONS.noSignal);
  assert.deepEqual([...deliberate.result.signals], []);
});

test("every fixture lands on its labelled class", () => {
  for (const { record, result } of scored()) {
    assert.equal(result.category, record.expect.category, `${record.id}: ${record.expect.why}`);
    assert.equal(result.classified, record.expect.classified, record.id);
    assert.deepEqual([...result.families], [...record.expect.families], record.id);
  }
});

test("no class is published without a named family and a weight behind it", () => {
  for (const { record, result } of scored()) {
    if (!result.classified) continue;
    assert.ok(result.signals.length > 0, `${record.id} classified on no signal`);
    for (const signal of result.signals) {
      // The signal is declared, and the weight on the result is the declared
      // one — so the number a reader adds up is the number in the source.
      const declaration = signalDeclaration(signal.signal);
      assert.equal(signal.weight, declaration.weight);
      assert.equal(signal.category, declaration.category);
      assert.equal(signal.family, declaration.family);
      assert.ok(Object.values(SIGNAL_FAMILY).includes(signal.family));
    }
    // The confidence is the winning class's share of all weight cast, and both
    // numbers are on the result, so it is arithmetic rather than a claim.
    const total = result.signals.reduce((sum, signal) => sum + signal.weight, 0);
    const winning = result.signals.filter((signal) => signal.category === result.category)
      .reduce((sum, signal) => sum + signal.weight, 0);
    assert.equal(result.totalWeight, total, record.id);
    assert.equal(result.weight, winning, record.id);
    assert.ok(Math.abs(result.confidence - winning / total) < 1e-9, record.id);
    assert.ok(result.confidence >= MINIMUM_CLASSIFICATION_CONFIDENCE, record.id);
  }
});

test("scoring the same corpus twice is byte-identical", () => {
  // Deep-compared as SERIALIZED text, not as objects: an object comparison
  // passes when two runs put the same keys in a different order, and key order
  // is exactly what a Map iteration or an accumulation change would move.
  const first = JSON.stringify(QUERY_SIGNAL_CORPUS.map(classifyThread));
  for (let run = 0; run < 3; run += 1) {
    assert.equal(JSON.stringify(QUERY_SIGNAL_CORPUS.map(classifyThread)), first);
  }
  // Reversed input order, then reversed back: a record's own class must not
  // depend on what was scored before it.
  const reversed = [...QUERY_SIGNAL_CORPUS].reverse().map(classifyThread).reverse();
  assert.equal(JSON.stringify(reversed), first);
  // And the floats are exact, not near: 0.6 must serialize as 0.6 forever.
  assert.ok(!first.includes("0.6000000000000001"), "an accumulated float reached the output");
});

test("a non-English record is classified on structure, not dropped", () => {
  const runs = scored();
  for (const id of ["japanese-structured-review", "german-structured-single-turn"]) {
    const { result } = runs.find(({ record }) => record.id === id);
    assert.equal(result.classified, true, `${id} was dropped`);
    // The point of the claim: the family that reads English contributed nothing.
    assert.deepEqual([...result.matchedRuleIds], [], `${id} was carried by a keyword rule`);
    assert.ok(result.families.includes(SIGNAL_FAMILY.languageIndependent), id);
  }
});

test("thread refusals are named, and never a category", () => {
  assert.equal(classifyThread().reason, UNCLASSIFIED_REASONS.noTurns);
  assert.equal(classifyThread({ turns: [] }).category, UNCLASSIFIED_CATEGORY);
  const noUser = classifyThread({ turns: [{ role: "assistant", body: "Context: here." }] });
  assert.equal(noUser.reason, UNCLASSIFIED_REASONS.noUserTurn);
  assert.equal(noUser.classified, false);
});

test("no turn text survives into a thread result", () => {
  const sentinel = "ZQX-THREAD-SENTINEL-4417";
  const result = classifyThread({
    model: "gpt-4o",
    turns: [{ role: "user", body: `Context: ${sentinel}\nConstraints: none\nDone: yes` }],
  });
  assert.equal(result.classified, true);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(sentinel));
  assert.ok(!serialized.includes("Constraints"));
});

test("the declaration table is the only place a weight is written down", () => {
  const seen = new Set();
  for (const declaration of QUERY_SIGNAL_DECLARATIONS) {
    assert.ok(!seen.has(declaration.id), `${declaration.id} is declared twice`);
    seen.add(declaration.id);
    assert.ok(Number.isInteger(declaration.weight) && declaration.weight > 0);
    assert.ok(Object.values(SIGNAL_FAMILY).includes(declaration.family));
    // Every weight states the assumption it encodes. A weight without one is a
    // number a director cannot argue with, which is the failure mode this
    // whole module exists to prevent.
    assert.ok(declaration.assumption.trim().length >= 30,
      `${declaration.id} states no assumption`);
  }
  assert.throws(() => signalDeclaration("not-a-signal"), RangeError);
});

test("the disclosure names every class, its families, and its weights", () => {
  const rows = signalFamilyDisclosureRows();
  const text = rows.map((row) => `${row.term} ${row.detail}`).join("\n");
  for (const declaration of QUERY_SIGNAL_DECLARATIONS) {
    assert.ok(text.includes(declaration.id), `${declaration.id} is not disclosed`);
    assert.ok(text.includes(`weight ${declaration.weight}`));
    assert.ok(text.includes(declaration.family));
  }
  for (const category of ["outOfScope", "inefficient", "overProvisioned", "highValue"]) {
    assert.ok(rows.some((row) => row.term.includes(category)), `${category} has no row`);
  }
  // The disclosure takes no record and can therefore carry nothing from one.
  assert.equal(signalFamilyDisclosureRows.length, 0);
  assert.equal(JSON.stringify(rows), JSON.stringify(signalFamilyDisclosureRows()));
});
