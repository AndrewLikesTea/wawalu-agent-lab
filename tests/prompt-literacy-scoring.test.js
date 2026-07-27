import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PROMPT_LITERACY_RUBRIC, RUBRIC_VERSION_ID, categoryScoreWeight, letterGradeForScore,
  scorePromptLiteracy,
} from "../src/prompt-literacy-scoring.js";
import { QUERY_CATEGORIES, literacyScore, summarize } from "../src/evolution.js";

const readJson = async (path) => JSON.parse(await readFile(
  new URL(`../${path}`, import.meta.url), "utf8",
));

const GOLDEN = ["high-literacy", "low-literacy", "mixed-signal"];
const fixtures = Object.fromEntries(await Promise.all(GOLDEN.map(async (id) => [
  id, await readJson(`tests/fixtures/prompt-literacy/${id}.json`),
])));
const demo = await readJson("src/evolution-demo-data.json");

// Every expected value in these files was written by hand from the arithmetic
// printed in the fixture, never by calling the module. A rubric change has to
// show up here as a diff, which is the only reason the fixtures exist.
for (const id of GOLDEN) {
  test(`golden fixture ${id} scores exactly as committed`, () => {
    const fixture = fixtures[id];
    assert.equal(fixture.rubricVersion, PROMPT_LITERACY_RUBRIC.rubricVersion,
      `${id} was authored against a different rubric version; re-derive it by hand`);
    assert.deepEqual(scorePromptLiteracy(fixture.records), fixture.expected);
  });
}

test("the composite is the axis weights applied to the reported subscores", () => {
  // If this drifts, the three published subscores no longer explain the one
  // published number, and the grade stops being reproducible on paper.
  for (const id of GOLDEN) {
    const { subscores, composite } = fixtures[id].expected;
    const recomposed = PROMPT_LITERACY_RUBRIC.axes.reduce(
      (sum, axis) => sum + axis.weightPercent * subscores[axis.key], 0,
    ) / 100;
    assert.equal(Math.round(recomposed), composite, id);
  }
});

test("the fixtures separate the axes rather than moving together", () => {
  // The mixed-signal fixture is the one that catches a weight change the other
  // two mask: strong intent, weak model fit, on the same records.
  const mixed = fixtures["mixed-signal"].expected.subscores;
  assert.ok(mixed.intent - mixed.modelFit >= 20,
    `intent ${mixed.intent} and model fit ${mixed.modelFit} are too close to detect a reweighting`);
  assert.notEqual(fixtures["high-literacy"].expected.grade, fixtures["low-literacy"].expected.grade);
});

test("no prompt text reaches the result at any depth", () => {
  const sentinel = "ZZZ-SENTINEL-9137 customer secret sentence that must never be published";
  const result = scorePromptLiteracy([
    {
      category: "highValue", model: "acme-sonnet-1", inputTokens: 10, outputTokens: 5,
      prompt: sentinel, redactedPrompt: sentinel,
      metadata: { nested: { deeper: { promptText: sentinel } } },
    },
    // A mis-mapped column that lands prompt text in the one string-valued field
    // the result passes through must not leak it either.
    { category: "inefficient", model: sentinel, inputTokens: 4, outputTokens: 2 },
    { category: "outOfScope", model: `m-${"x".repeat(80)}`, inputTokens: 1, outputTokens: 1 },
  ]);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(sentinel), false);
  assert.equal(serialized.includes("ZZZ-SENTINEL"), false);
  assert.equal(serialized.includes("customer secret"), false);

  const label = PROMPT_LITERACY_RUBRIC.redaction.unrecognizedModelLabel;
  const byKey = Object.fromEntries(result.categories.map((entry) => [entry.key, entry]));
  assert.deepEqual(byKey.inefficient.models, [label]);
  assert.deepEqual(byKey.outOfScope.models, [label]);
  assert.deepEqual(byKey.highValue.models, ["acme-sonnet-1"]);
});

test("no scorable record is unscored, not a zero", () => {
  const rule = PROMPT_LITERACY_RUBRIC.emptyInput.behavior;
  const empty = scorePromptLiteracy([]);
  assert.deepEqual(empty, {
    rubricVersion: "1.0.0",
    rubricVersionId: RUBRIC_VERSION_ID,
    scored: false,
    reason: rule,
    records: { total: 0, scored: 0, unclassified: 0 },
    subscores: { intent: null, efficiency: null, modelFit: null },
    composite: null,
    grade: null,
    categories: [],
    tokens: { input: 0, output: 0 },
  });

  // A list of records this rubric cannot score is the same claim as no records:
  // it is not a grade of F, which would read as a measurement nobody made.
  const unknown = scorePromptLiteracy([{ category: "needsHumanReview" }, { category: null }]);
  assert.equal(unknown.scored, false);
  assert.equal(unknown.composite, null);
  assert.equal(unknown.grade, null);
  assert.deepEqual(unknown.records, { total: 2, scored: 0, unclassified: 2 });

  for (const result of [empty, unknown, scorePromptLiteracy(undefined), scorePromptLiteracy("nope")]) {
    assert.equal(JSON.stringify(result).includes("NaN"), false);
    assert.equal(Number.isNaN(result.composite), false);
  }
});

test("scoring is deterministic and leaves the caller's records untouched", () => {
  const records = fixtures["mixed-signal"].records;
  const before = structuredClone(records);
  const first = scorePromptLiteracy(records);
  const second = scorePromptLiteracy(records);
  assert.deepEqual(records, before);
  assert.deepEqual(second, first);
  assert.deepEqual(scorePromptLiteracy([...records].reverse()), first);
});

test("the rubric publishes an assumption beside every number it grades with", () => {
  const rubric = PROMPT_LITERACY_RUBRIC;
  assert.equal(rubric.rubricVersion, "1.0.0");
  assert.equal(RUBRIC_VERSION_ID, `${rubric.rubricId}/${rubric.rubricVersion}`);

  const stated = (value) => typeof value === "string" && value.length >= 40;
  assert.equal(rubric.axes.reduce((sum, axis) => sum + axis.weightPercent, 0), 100);
  for (const axis of rubric.axes) assert.ok(stated(axis.assumption), axis.key);
  for (const category of rubric.categories) {
    assert.ok(stated(category.assumption), category.key);
    for (const axis of rubric.axes) {
      const credit = category.axisCredits[axis.key];
      assert.ok(Number.isInteger(credit) && credit >= 0 && credit <= 100,
        `${category.key}.${axis.key} must be a whole 0-100 credit`);
    }
  }
  for (const block of [rubric.scale, rubric.recordWeighting, rubric.unclassifiedRecords,
    rubric.emptyInput, rubric.reporting, rubric.redaction]) {
    assert.ok(stated(block.assumption));
  }

  // Cutoffs read high to low with >=, and the table has to total or a score
  // could fall through it with no letter at all.
  const cutoffs = rubric.grades.map((grade) => grade.minimumScore);
  assert.deepEqual([...cutoffs].sort((a, b) => b - a), cutoffs);
  assert.equal(cutoffs[cutoffs.length - 1], 0);
  for (const grade of rubric.grades) assert.ok(stated(grade.assumption), grade.letter);
  for (const grade of rubric.grades) {
    assert.equal(letterGradeForScore(grade.minimumScore), grade.letter);
  }
  assert.equal(letterGradeForScore("not a score"), "F");
});

test("the published category weights have exactly one definition", () => {
  // evolution.js declares no weight of its own: each QUERY_CATEGORIES entry
  // reads its 0-100 weight back from the rubric's three axis credits, so the
  // decomposition has to reconstitute the published weight exactly.
  for (const category of QUERY_CATEGORIES) {
    const rubricEntry = PROMPT_LITERACY_RUBRIC.categories.find((entry) => entry.key === category.key);
    const derived = PROMPT_LITERACY_RUBRIC.axes.reduce(
      (sum, axis) => sum + axis.weightPercent * rubricEntry.axisCredits[axis.key], 0,
    ) / 100;
    assert.equal(category.scoreWeight, derived, category.key);
    assert.equal(categoryScoreWeight(category.key), derived, category.key);
    assert.equal(literacyScore({ [category.key]: 1 }), Math.round(derived), category.key);
  }
  assert.equal(categoryScoreWeight("noSuchCategory"), 0);
});

// Expand a published department mix into one record per query. The mixes are
// stated to two decimals, so 100 records reproduce them exactly.
function recordsForMix(mix) {
  return Object.entries(mix).flatMap(([category, share]) => Array.from(
    { length: Math.round(share * 100) },
    (unused, index) => ({
      category, model: "acme-sonnet-1", inputTokens: 100 + index, outputTokens: 50 + index,
    }),
  ));
}

test("the module reproduces the bundled sample's published score exactly", () => {
  const published = summarize(demo.departments);

  for (const department of demo.departments) {
    const records = recordsForMix(department.mix);
    assert.equal(records.length, 100, department.id);
    const result = scorePromptLiteracy(records);
    assert.equal(result.composite, literacyScore(department.mix), department.id);
    assert.equal(result.rubricVersionId, published.scoreExplanation.version, department.id);
  }

  // The organization headline is spend-weighted across departments, exactly as
  // `summarize` states in its own arithmetic string.
  const spend = demo.departments.reduce((sum, department) => sum + department.spendUsd, 0);
  const weighted = demo.departments.reduce((sum, department) => sum
    + scorePromptLiteracy(recordsForMix(department.mix)).composite * department.spendUsd, 0);
  assert.equal(Math.round(weighted / spend), published.score);

  // The anchor, spelled out: this is the number on the page before this change.
  assert.equal(published.score, 75);
  assert.equal(published.grade, "C");
  assert.equal(letterGradeForScore(published.score), published.grade);
});
