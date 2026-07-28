// Fixtures for the imported-corpus grade, and the drift guard that keeps them
// honest.
//
// Every expected value in the three committed fixtures was derived by hand from
// the arithmetic printed inside the fixture, never by calling the module. The
// `authoredAgainst` block in each file copies the thresholds and weights the
// derivation used; the drift test below compares that copy with the live
// constants and fails when they part company. That is the point: a threshold or
// a weight cannot move quietly, and cannot be moved by re-recording whatever the
// module happens to output today.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CORPUS_CLASSIFIED_SHARE_FLOOR, CORPUS_CONFIDENCE_NONE, CORPUS_CONFIDENCE_TIERS,
  CORPUS_ELIGIBILITY, CORPUS_GRADE_VERSION, CORPUS_NOT_GRADEABLE, CORPUS_NOT_GRADEABLE_RULE,
  gradeImportedCorpus, redactCorpusRecords,
} from "../src/imported-corpus-grade.js";
import {
  PROMPT_LITERACY_RUBRIC, RUBRIC_VERSION_ID, categoryScoreWeight,
} from "../src/prompt-literacy-scoring.js";
import { MIN_SCORED_PROMPTS, PANELS_BY_ID, panelState } from "../src/finops-panel-contract.js";
import { PROMPT_GRADING_THRESHOLDS } from "../src/prompt-grading-eligibility.js";

const readJson = async (path) => JSON.parse(await readFile(
  new URL(`../${path}`, import.meta.url), "utf8",
));

const GOLDEN = ["gradeable-corpus", "at-threshold-corpus", "below-threshold-corpus"];
const fixtures = Object.fromEntries(await Promise.all(GOLDEN.map(async (id) => [
  id, await readJson(`tests/fixtures/imported-corpus/${id}.json`),
])));

/**
 * A corpus spec expanded into one record per prompt.
 *
 * Generated here rather than committed: 152 near-identical records across three
 * files is a diff nobody reads, and the mix — which is the only thing the rubric
 * scores — is stated exactly by the counts in the fixture. Token counts vary per
 * record so a corpus is not accidentally uniform, and they are summed, never
 * weighted, so they cannot move a score.
 */
function expand(corpus) {
  return corpus.flatMap(({ category, records }) => Array.from({ length: records }, (unused, index) => ({
    category,
    model: "acme-sonnet-1",
    inputTokens: 100 + index,
    outputTokens: 50 + index,
  })));
}

/**
 * The published fields a fixture pins.
 *
 * The prose fields — every `rule`, `assumption` and `reasonRule` — are asserted
 * separately for presence rather than copied into three files, so a reworded
 * sentence is not a failing test while a moved number always is.
 */
function pinned(result) {
  return {
    version: result.version,
    rubricVersionId: result.rubricVersionId,
    gradeable: result.gradeable,
    grade: result.grade,
    composite: result.composite,
    reason: result.reason,
    confidence: result.confidence.basis
      ? {
        level: result.confidence.level,
        label: result.confidence.label,
        basis: { ...result.confidence.basis },
      }
      : { level: result.confidence.level, label: result.confidence.label },
    records: { ...result.records },
    eligibility: {
      minScoredRecords: result.eligibility.minScoredRecords,
      comparison: result.eligibility.comparison,
      observed: result.eligibility.observed,
      met: result.eligibility.met,
    },
    score: result.score && {
      composite: result.score.composite,
      grade: result.score.grade,
      subscores: { ...result.score.subscores },
      records: { ...result.score.records },
    },
  };
}

for (const id of GOLDEN) {
  test(`labelled fixture ${id} grades exactly as committed`, () => {
    const fixture = fixtures[id];
    const result = gradeImportedCorpus(expand(fixture.corpus));
    assert.deepEqual(pinned(result), fixture.expected, fixture.label);
    // Stated twice on purpose. These two fields are what an executive reads and
    // what a director disputes, so a fixture that stopped covering them would
    // still pass the deep compare above if the shape ever loosened.
    assert.equal(result.grade, fixture.expected.grade, "grade");
    assert.equal(result.confidence.level, fixture.expected.confidence.level, "confidence");
  });
}

test("a threshold, weight, or confidence-tier change fails until a fixture is re-derived", () => {
  const live = {
    rubricVersion: PROMPT_LITERACY_RUBRIC.rubricVersion,
    eligibilityFloor: CORPUS_ELIGIBILITY.minScoredRecords,
    classifiedShareFloor: CORPUS_CLASSIFIED_SHARE_FLOOR,
    axisWeightPercent: Object.fromEntries(
      PROMPT_LITERACY_RUBRIC.axes.map((axis) => [axis.key, axis.weightPercent]),
    ),
    categoryScoreWeight: Object.fromEntries(
      PROMPT_LITERACY_RUBRIC.categories.map((category) => [category.key, categoryScoreWeight(category.key)]),
    ),
    confidenceFloorMultiple: Object.fromEntries(
      CORPUS_CONFIDENCE_TIERS.map((tier) => [tier.level, tier.minFloorMultiple]),
    ),
  };
  for (const id of GOLDEN) {
    const { why, ...authored } = fixtures[id].authoredAgainst;
    assert.deepEqual(authored, live,
      `${id} was derived against different numbers than the code now uses. Re-derive the expected `
      + "values by hand from the fixture's printed arithmetic and update authoredAgainst; do not "
      + "paste in whatever the module currently returns.");
    assert.ok(typeof why === "string" && why.length >= 40, `${id} must state why the copy exists`);
  }
});

test("the declared floor has exactly one definition", () => {
  // Three modules, one number. If the panel contract's floor and the
  // prompt-grading floor ever part, a page can show a grade above a panel that
  // declares the grade unanswerable.
  assert.equal(CORPUS_ELIGIBILITY.minScoredRecords, MIN_SCORED_PROMPTS);
  assert.equal(MIN_SCORED_PROMPTS, PROMPT_GRADING_THRESHOLDS.minPromptsPerDepartment);
  assert.equal(CORPUS_CLASSIFIED_SHARE_FLOOR, PROMPT_GRADING_THRESHOLDS.minClassifiedPromptShare);
});

test("this module and the hero grade panel agree on every corpus size", () => {
  // The agreement check the fixtures cannot make on their own: the panel decides
  // whether the letter may be on screen, this module decides whether a letter
  // exists, and the two must never disagree about one corpus.
  const hero = PANELS_BY_ID["hero-grade"];
  for (const scoredPrompts of [0, 1, 24, 25, 26, 100]) {
    const corpus = expand([{ category: "highValue", records: scoredPrompts }]);
    const panel = panelState(hero, { scoredPrompts, gradedDepartments: scoredPrompts > 0 ? 1 : 0 });
    assert.equal(gradeImportedCorpus(corpus).gradeable, panel.available,
      `${scoredPrompts} scored prompts: the grade and the panel disagree`);
  }
});

test("the floor is read with >=, so the boundary corpus grades and one record short does not", () => {
  const at = gradeImportedCorpus(expand(fixtures["at-threshold-corpus"].corpus));
  const below = gradeImportedCorpus(expand(fixtures["below-threshold-corpus"].corpus));
  assert.equal(at.records.scored, CORPUS_ELIGIBILITY.minScoredRecords);
  assert.equal(below.records.scored, CORPUS_ELIGIBILITY.minScoredRecords - 1);
  assert.equal(at.gradeable, true);
  assert.equal(below.gradeable, false);
  assert.equal(below.reason, CORPUS_NOT_GRADEABLE.belowFloor);
});

test("a refusal carries a named reason and no number a surface could print as a grade", () => {
  const cases = [
    [[], CORPUS_NOT_GRADEABLE.noSourceRecords],
    ["not a corpus", CORPUS_NOT_GRADEABLE.noSourceRecords],
    [[{ category: "needsHumanReview" }, { category: null }], CORPUS_NOT_GRADEABLE.noneClassified],
    [expand([{ category: "highValue", records: 24 }]), CORPUS_NOT_GRADEABLE.belowFloor],
  ];
  const letters = new Set(PROMPT_LITERACY_RUBRIC.grades.map((grade) => grade.letter));

  for (const [records, reason] of cases) {
    const result = gradeImportedCorpus(records);
    assert.equal(result.gradeable, false, reason);
    assert.equal(result.reason, reason);
    assert.equal(result.reasonRule, CORPUS_NOT_GRADEABLE_RULE[reason]);
    assert.equal(result.grade, null);
    assert.equal(result.composite, null);
    assert.equal(result.score, null, "a refusal publishes no decomposition to reach into");
    assert.deepEqual(result.confidence, CORPUS_CONFIDENCE_NONE);

    // The 24-record corpus would score 100 on this rubric. Nothing in the
    // result may be that number, or a letter, at any depth.
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === "object") return Object.values(value).forEach(walk);
      assert.equal(typeof value === "string" && letters.has(value), false, `letter leaked: ${value}`);
      assert.equal(value === 100 && reason === CORPUS_NOT_GRADEABLE.belowFloor, false,
        "the withheld composite leaked");
    };
    walk(result);
    assert.equal(JSON.stringify(result).includes("NaN"), false);
  }
});

test("confidence is named from the record count, and steps down on a thin classified share", () => {
  const floor = CORPUS_ELIGIBILITY.minScoredRecords;
  const corpusOf = (scored, unreadable = 0) => expand([
    { category: "highValue", records: scored },
    { category: "needsHumanReview", records: unreadable },
  ]);

  assert.equal(gradeImportedCorpus(corpusOf(floor)).confidence.level, "low");
  assert.equal(gradeImportedCorpus(corpusOf(floor * 2 - 1)).confidence.level, "low");
  assert.equal(gradeImportedCorpus(corpusOf(floor * 2)).confidence.level, "moderate");
  assert.equal(gradeImportedCorpus(corpusOf(floor * 4 - 1)).confidence.level, "moderate");
  assert.equal(gradeImportedCorpus(corpusOf(floor * 4)).confidence.level, "high");

  // 100 scored is high on record count alone; half the file unreadable steps it
  // down one, and says in the result that it did.
  const thin = gradeImportedCorpus(corpusOf(floor * 4, floor * 4));
  assert.ok(thin.records.classifiedShare < CORPUS_CLASSIFIED_SHARE_FLOOR);
  assert.equal(thin.confidence.level, "moderate");
  assert.equal(thin.confidence.basis.downgradedForClassifiedShare, true);

  // The step-down is one level and never below the floor's own tier: a corpus
  // that cleared the record floor still has a grade.
  const thinAtFloor = gradeImportedCorpus(corpusOf(floor, floor * 2));
  assert.equal(thinAtFloor.gradeable, true);
  assert.equal(thinAtFloor.confidence.level, "low");
  assert.equal(thinAtFloor.confidence.basis.downgradedForClassifiedShare, false);
});

test("every published number carries its arithmetic or its rule", () => {
  const result = gradeImportedCorpus(expand(fixtures["gradeable-corpus"].corpus));
  const stated = (value) => typeof value === "string" && value.length >= 40;

  assert.ok(stated(result.confidence.rule));
  assert.ok(stated(result.eligibility.assumption));
  assert.ok(stated(CORPUS_ELIGIBILITY.assumption));
  assert.equal(result.confidence.basis.arithmetic, "100 scored records / 25 declared floor = 4.00x");
  assert.equal(
    result.confidence.basis.floorMultiple,
    result.records.scored / CORPUS_ELIGIBILITY.minScoredRecords,
  );
  assert.equal(result.records.classifiedShare, result.records.scored / result.records.source);
  // The letter is the rubric's, decomposed into the numbers that produced it.
  assert.equal(result.composite, result.score.composite);
  assert.equal(result.grade, result.score.grade);
  assert.equal(Math.round(PROMPT_LITERACY_RUBRIC.axes.reduce(
    (sum, axis) => sum + axis.weightPercent * result.score.subscores[axis.key], 0,
  ) / 100), result.composite);

  for (const tier of CORPUS_CONFIDENCE_TIERS) assert.ok(stated(tier.rule), tier.level);
  for (const reason of Object.values(CORPUS_NOT_GRADEABLE)) {
    assert.ok(stated(CORPUS_NOT_GRADEABLE_RULE[reason]), reason);
  }
  assert.ok(stated(CORPUS_CONFIDENCE_NONE.rule));
  assert.equal(result.version, CORPUS_GRADE_VERSION);
  assert.equal(result.rubricVersionId, RUBRIC_VERSION_ID);
});

test("no prompt or content field reaches the scoring input or the result", () => {
  const sentinel = "ZZZ-SENTINEL-4408 customer sentence that must never be published";
  const records = expand(fixtures["at-threshold-corpus"].corpus).map((record, index) => ({
    ...record,
    prompt: sentinel,
    completion: sentinel,
    // A mis-mapped column landing prompt text in the one string-valued field
    // the rubric passes through, and a category field carrying free text.
    model: index % 3 === 0 ? sentinel : record.model,
    category: index === 0 ? `${record.category} ${sentinel}` : record.category,
    metadata: { nested: { deeper: { promptText: sentinel } } },
  }));

  const redacted = redactCorpusRecords(records);
  for (const record of redacted) {
    assert.deepEqual(Object.keys(record).sort(),
      ["category", "inputTokens", "model", "outputTokens"]);
  }
  assert.equal(JSON.stringify(redacted).includes(sentinel), false);
  assert.equal(JSON.stringify(redacted).includes("ZZZ-SENTINEL"), false);
  // The free-text category became `null`, so an import string never reaches the
  // scorer even as a value it would have set aside.
  assert.equal(redacted[0].category, null);
  assert.equal(redacted[0].model, PROMPT_LITERACY_RUBRIC.redaction.unrecognizedModelLabel);

  const result = gradeImportedCorpus(records);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(sentinel), false);
  assert.equal(serialized.includes("ZZZ-SENTINEL"), false);
  assert.equal(serialized.includes("customer sentence"), false);
  // One record lost its category to redaction, so 24 of 25 scored — the corpus
  // drops under the floor and the result says so rather than grading 24.
  assert.equal(result.records.scored, 24);
  assert.equal(result.gradeable, false);
});

test("grading is deterministic, byte-identical on rerun, and leaves the caller's records alone", () => {
  const records = expand(fixtures["gradeable-corpus"].corpus);
  const before = structuredClone(records);

  const first = gradeImportedCorpus(records);
  const second = gradeImportedCorpus(records);
  assert.deepEqual(records, before, "the caller's records were mutated");
  assert.equal(JSON.stringify(second), JSON.stringify(first), "rerun was not byte-identical");
  // Record order is not a scoring input: a re-exported file with the rows in a
  // different order must publish the same letter and the same confidence.
  assert.equal(JSON.stringify(gradeImportedCorpus([...records].reverse())), JSON.stringify(first));
  // A refusal is byte-stable too, or a surface diffing two runs sees churn.
  const refusal = gradeImportedCorpus(expand(fixtures["below-threshold-corpus"].corpus));
  assert.equal(
    JSON.stringify(gradeImportedCorpus(expand(fixtures["below-threshold-corpus"].corpus))),
    JSON.stringify(refusal),
  );
});
