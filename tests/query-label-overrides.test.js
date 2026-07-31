// The human-correction model, and the two properties it is worth nothing
// without: the sample is the same sample every time, and zero corrections
// change no published number.
//
// Every expected figure below is derived by hand from the arithmetic named
// beside it — the rubric's four category weights and `recoverableShare` — and
// never re-recorded from what the module printed. A formula that drifts fails
// here rather than quietly republishing itself.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_SAMPLE_SIZE, LOW_CONFIDENCE_CEILING, MAX_OVERRIDE_KEYS, SAMPLE_SEED, STRATUM,
  STRATUM_WEIGHT, applyOverrides, recordKey, selectSample,
} from "../src/query-label-overrides.js";
import { MINIMUM_CLASSIFICATION_CONFIDENCE } from "../src/query-classification.js";
import { QUERY_CATEGORIES } from "../src/evolution.js";

/**
 * The corpus every figure below is derived from: fifty rows, forty of them
 * carrying a category and ten the classifier declined.
 *
 * Shares over the forty scored rows are 0.5 / 0.2 / 0.2 / 0.1, so:
 *   composite  = 0.5×100 + 0.2×55 + 0.2×35 + 0.1×0 = 68
 *   coverage   = 40 scored / 50 source                = 0.8
 *   recoverable= $10,000 × (0.2×0.7 + 0.2×0.4 + 0.1×1) = $3,200
 */
const MIX = [["highValue", 20], ["overProvisioned", 8], ["inefficient", 8], ["outOfScope", 4]];
const SPEND_USD = 10_000;

function corpus() {
  const rows = MIX.flatMap(([category, count]) => Array.from({ length: count }, () => category))
    .map((category, index) => ({
      queryId: `q-${String(index).padStart(3, "0")}`,
      category,
      confidence: 0.8,
      model: "gpt-4o",
      inputTokens: 900,
      outputTokens: 400,
    }));
  const declined = Array.from({ length: 10 }, (unused, index) => ({
    queryId: `u-${String(index).padStart(3, "0")}`,
    category: null,
    confidence: 0,
    model: "gpt-4o",
    inputTokens: 120,
    outputTokens: 60,
  }));
  return [...rows, ...declined];
}

/* ------------------------------ the headline -------------------------------- */

test("zero overrides reproduces the published headline exactly", () => {
  const result = applyOverrides(corpus(), {}, { spendUsd: SPEND_USD });
  assert.equal(result.composite, 68);
  assert.equal(result.grade, "D");
  assert.equal(result.coverage, 0.8);
  assert.equal(result.recoverableSpend, 3200);
  assert.equal(result.overridesApplied, 0);
  assert.equal(result.overridesIgnored, 0);
  // The whole grade result travels, so a caller already reading
  // `gradeImportedCorpus` reads this with no call-site change.
  assert.equal(result.corpusGrade.gradeable, true);
  assert.equal(result.corpusGrade.records.source, 50);
});

test("a human label beats the classifier for the same row, and the headline moves", () => {
  const overrides = { "q-000": "outOfScope", "q-001": "outOfScope", "q-002": "outOfScope", "q-003": "outOfScope" };
  const result = applyOverrides(corpus(), overrides, { spendUsd: SPEND_USD });
  // Four high-value rows relabelled leakage: shares 0.4 / 0.2 / 0.2 / 0.2.
  //   composite   = 0.4×100 + 0.2×55 + 0.2×35 + 0.2×0 = 58
  //   recoverable = $10,000 × (0.2×0.7 + 0.2×0.4 + 0.2×1) = $4,200
  assert.equal(result.composite, 58);
  assert.equal(result.recoverableSpend, 4200);
  assert.equal(result.overridesApplied, 4);
  assert.equal(result.mix.highValue, 16);
  assert.equal(result.mix.outOfScope, 8);
  // Coverage is unmoved: relabelling a scored row does not score a new one.
  assert.equal(result.coverage, 0.8);
});

test("an override rescues an unclassified row into coverage", () => {
  const result = applyOverrides(corpus(), { "u-000": "inefficient" }, { spendUsd: SPEND_USD });
  assert.equal(result.corpusGrade.records.scored, 41);
  assert.equal(result.coverage, 0.82);
});

test("applyOverrides mutates nothing it was handed", () => {
  const records = corpus();
  const before = JSON.stringify(records);
  const overrides = { "q-000": "outOfScope" };
  applyOverrides(records, overrides, { spendUsd: SPEND_USD });
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(overrides, { "q-000": "outOfScope" });
});

test("an unknown or stale override key is ignored, counted, and never thrown", () => {
  const result = applyOverrides(corpus(), {
    "q-000": "outOfScope",
    "no-such-row": "outOfScope",
    "q-001": "notACategory",
  }, { spendUsd: SPEND_USD });
  assert.equal(result.overridesApplied, 1);
  assert.equal(result.overridesIgnored, 2);
  // One relabelled row: shares 0.475 / 0.2 / 0.2 / 0.125 over forty scored.
  //   composite = 0.475×100 + 0.2×55 + 0.2×35 + 0.125×0 = 65.5 → 66 (rubric rounds)
  assert.equal(result.composite, 66);
});

test("a prototype-polluting override key is refused by name", () => {
  const hostile = { "q-000": "outOfScope" };
  Object.defineProperty(hostile, "__proto__", { value: "outOfScope", enumerable: true, configurable: true });
  hostile.constructor = "outOfScope";
  const result = applyOverrides(corpus(), hostile, { spendUsd: SPEND_USD });
  assert.equal(result.overridesApplied, 1);
  assert.equal(result.overridesIgnored, 2);
  assert.equal(Object.prototype.category, undefined);
  assert.equal({}.__proto__, Object.prototype);
});

test("an override map over the declared ceiling is bounded, not looped", () => {
  const huge = new Map(Array.from({ length: MAX_OVERRIDE_KEYS + 25 },
    (unused, index) => [`q-${String(index).padStart(3, "0")}`, "outOfScope"]));
  const result = applyOverrides(corpus(), huge, { spendUsd: SPEND_USD });
  // The forty `q-` rows are relabelled; every key past the ceiling is refused.
  assert.equal(result.overridesApplied, 40);
  assert.ok(result.overridesIgnored >= 25);
});

test("no spend, no recoverable figure — never a zero standing in for one", () => {
  assert.equal(applyOverrides(corpus(), {}).recoverableSpend, null);
  assert.equal(applyOverrides([], {}, { spendUsd: SPEND_USD }).grade, null);
});

/* ------------------------------- the sample --------------------------------- */

test("the same seed and the same corpus draw a byte-identical sample twice", () => {
  const first = selectSample(corpus(), { size: 12 });
  const second = selectSample(corpus(), { size: 12 });
  assert.equal(JSON.stringify(first.rows.map((row) => row.key)),
    JSON.stringify(second.rows.map((row) => row.key)));
  assert.equal(first.size, 12);
  assert.equal(first.seed, SAMPLE_SEED);
});

test("a shuffled but equivalent corpus draws the same sample, in the same order", () => {
  const straight = selectSample(corpus(), { size: 15 });
  // A deterministic shuffle — no clock, no randomness in the test either.
  const shuffled = corpus()
    .map((record, index) => ({ record, rank: (index * 37) % 53 }))
    .sort((left, right) => left.rank - right.rank || left.record.queryId.localeCompare(right.record.queryId))
    .map((entry) => entry.record);
  assert.notEqual(JSON.stringify(shuffled.map((r) => r.queryId)),
    JSON.stringify(corpus().map((r) => r.queryId)));
  const drawn = selectSample(shuffled, { size: 15 });
  assert.deepEqual(drawn.rows.map((row) => row.key), straight.rows.map((row) => row.key));
});

test("a different seed draws a different sample; the seed is the only input that moves it", () => {
  const drawn = selectSample(corpus(), { size: 15, seed: SAMPLE_SEED + 1 });
  assert.notDeepEqual(drawn.rows.map((row) => row.key),
    selectSample(corpus(), { size: 15 }).rows.map((row) => row.key));
});

test("unclassified and low-confidence rows are oversampled against their corpus share", () => {
  const records = [
    ...corpus(),
    // Ten rows classified, but barely: under the ceiling, over the floor.
    ...Array.from({ length: 10 }, (unused, index) => ({
      queryId: `l-${String(index).padStart(3, "0")}`,
      category: "inefficient",
      confidence: MINIMUM_CLASSIFICATION_CONFIDENCE,
      model: "gpt-4o",
      inputTokens: 300,
      outputTokens: 200,
    })),
  ];
  const drawn = selectSample(records, { size: 20 });
  const { strata } = drawn;
  assert.equal(strata[STRATUM.unclassified].corpus, 10);
  assert.equal(strata[STRATUM.lowConfidence].corpus, 10);
  assert.equal(strata[STRATUM.confident].corpus, 40);
  const share = (stratum) => strata[stratum].drawn / drawn.size;
  assert.ok(share(STRATUM.unclassified) > 10 / 60,
    `unclassified drawn at ${share(STRATUM.unclassified)}, no better than its corpus share`);
  assert.ok(share(STRATUM.lowConfidence) > 10 / 60,
    `low-confidence drawn at ${share(STRATUM.lowConfidence)}, no better than its corpus share`);
  assert.ok(STRATUM_WEIGHT[STRATUM.unclassified] > STRATUM_WEIGHT[STRATUM.lowConfidence]);
  assert.ok(STRATUM_WEIGHT[STRATUM.lowConfidence] > STRATUM_WEIGHT[STRATUM.confident]);
  assert.ok(LOW_CONFIDENCE_CEILING > MINIMUM_CLASSIFICATION_CONFIDENCE);
});

test("a row with no id of its own gets a stable one, and ties break on it", () => {
  const records = Array.from({ length: 5 }, () => ({ category: "highValue", confidence: 0.9 }));
  assert.equal(recordKey(records[0], 3), "row-3");
  assert.deepEqual(selectSample(records, { size: 5 }).rows.map((row) => row.key),
    selectSample(records, { size: 5 }).rows.map((row) => row.key));
  assert.equal(selectSample(records).size, 5, "a sample never exceeds the corpus");
  assert.ok(DEFAULT_SAMPLE_SIZE > 0);
});

test("every stratum weight names a category key the rubric published", () => {
  const keys = QUERY_CATEGORIES.map((category) => category.key);
  const result = applyOverrides(corpus(), {}, { spendUsd: SPEND_USD });
  assert.deepEqual(Object.keys(result.mix).sort(), [...keys].sort());
});

/* ------------------------------- the seam ----------------------------------- */

test("the page's own grade routes through the override model, not around it", async () => {
  const source = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  assert.ok(source.includes('import { applyOverrides } from "/query-label-overrides.js"'),
    "evolution-page.js no longer imports the override model");
  assert.ok(/applyOverrides\(/.test(source), "the imported corpus is not routed through applyOverrides");
  assert.ok(!/gradeImportedCorpus\(/.test(source),
    "evolution-page.js grades a corpus around the override seam");
});
