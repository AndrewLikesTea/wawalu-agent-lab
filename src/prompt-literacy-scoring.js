// Prompt-literacy scoring: the executable form of `prompt-literacy-rubric.json`.
//
// Every weight, credit, cutoff and rounding rule this module applies is read
// from that file. There is no second copy of a rubric number in this module, in
// `evolution.js`, in the page, or in the tests — a director who disputes a grade
// reads one JSON file and the assumption printed beside each number, and a
// rubric change surfaces as a golden-fixture diff rather than as a quiet drift.
//
// Deterministic and side-effect free: no clock, no randomness, no network, no
// I/O beyond the static import below, and no mutation of the caller's records.
//
// Classification is *not* in scope. This module consumes records that were
// already assigned a category upstream; it never inspects, infers from, or
// copies prompt text. See the `redaction` block of the rubric for the contract
// the one string-valued passthrough (the model identifier) has to satisfy.

import rubric from "./prompt-literacy-rubric.json" with { type: "json" };

/** The rubric as data, frozen so a caller cannot edit the scale it is graded on. */
export const PROMPT_LITERACY_RUBRIC = Object.freeze(rubric);

/** Derived, never written down twice: the label stamped on a published score. */
export const RUBRIC_VERSION_ID = `${rubric.rubricId}/${rubric.rubricVersion}`;

const AXES = rubric.axes;
const CATEGORIES = rubric.categories;
const ROUNDING = rubric.reporting;
const MODEL_ID = new RegExp(rubric.redaction.modelIdPattern);

if (AXES.reduce((sum, axis) => sum + axis.weightPercent, 0) !== 100) {
  throw new RangeError("prompt-literacy rubric: axis weights must sum to 100");
}

// Category weight in hundredths of a point, so the axis decomposition is summed
// in integers and reconstitutes the published weight exactly. Floating-point
// axis arithmetic would land 55 on 55.00000000000001 and move a published grade.
const WEIGHT_SCALED = new Map(CATEGORIES.map((category) => [
  category.key,
  AXES.reduce((sum, axis) => sum + axis.weightPercent * category.axisCredits[axis.key], 0),
]));

// Accepts the rubric key or the rubric's own exact label — an exact match, not
// a guess. Anything else is unclassified and is reported rather than scored.
const BY_CATEGORY = new Map(CATEGORIES.flatMap((category) => [
  [category.key, category], [category.label, category],
]));

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/** The 0-100 weight of one category, derived from its three axis credits. */
export function categoryScoreWeight(key) {
  const scaled = WEIGHT_SCALED.get(key);
  return scaled === undefined ? 0 : scaled / 100;
}

/** Letter for a 0-100 score. Cutoffs read high to low; a boundary grades up. */
export function letterGradeForScore(score) {
  const value = Number(score);
  const safe = Number.isFinite(value) ? value : 0;
  const grades = rubric.grades;
  return (grades.find((grade) => safe >= grade.minimumScore) ?? grades[grades.length - 1]).letter;
}

function unscoredResult(total, unclassified) {
  return Object.freeze({
    rubricVersion: rubric.rubricVersion,
    rubricVersionId: RUBRIC_VERSION_ID,
    scored: false,
    reason: rubric.emptyInput.behavior,
    records: Object.freeze({ total, scored: 0, unclassified }),
    subscores: Object.freeze({ intent: null, efficiency: null, modelFit: null }),
    composite: null,
    grade: null,
    categories: Object.freeze([]),
    tokens: Object.freeze({ input: 0, output: 0 }),
  });
}

/**
 * Score a list of already-classified query records.
 *
 * Each record contributes its category, its input/output token counts and its
 * model identifier. Tokens and models are reported as evidence only: rubric
 * 1.0.0 weights every scored query equally, for the reason stated in the
 * rubric's `recordWeighting` assumption.
 *
 * Zero scorable records returns `scored: false` with null subscores, a null
 * composite and a null grade — a team nobody sampled is not a team that failed.
 */
export function scorePromptLiteracy(records = []) {
  const list = Array.isArray(records) ? records : [];
  const tally = new Map(CATEGORIES.map((category) => [category.key, {
    records: 0, input: 0, output: 0, models: new Set(),
  }]));
  let scored = 0;
  let unclassified = 0;

  for (const record of list) {
    const category = BY_CATEGORY.get(record?.category);
    if (!category) {
      unclassified += 1;
      continue;
    }
    const bucket = tally.get(category.key);
    bucket.records += 1;
    bucket.input += tokenCount(record?.inputTokens);
    bucket.output += tokenCount(record?.outputTokens);
    const model = typeof record?.model === "string" && MODEL_ID.test(record.model)
      ? record.model : rubric.redaction.unrecognizedModelLabel;
    bucket.models.add(model);
    scored += 1;
  }

  if (scored === 0) return unscoredResult(list.length, unclassified);

  const categories = CATEGORIES.map((category) => {
    const bucket = tally.get(category.key);
    const scaled = WEIGHT_SCALED.get(category.key);
    return Object.freeze({
      key: category.key,
      label: category.label,
      records: bucket.records,
      share: roundTo(bucket.records / scored, ROUNDING.shareDecimals),
      subscores: Object.freeze({ ...category.axisCredits }),
      categoryScore: scaled / 100,
      contribution: roundTo((bucket.records * scaled) / (100 * scored), ROUNDING.contributionDecimals),
      tokens: Object.freeze({ input: bucket.input, output: bucket.output }),
      models: Object.freeze([...bucket.models].sort()),
    });
  });

  const subscores = Object.fromEntries(AXES.map((axis) => [axis.key, roundTo(
    CATEGORIES.reduce(
      (sum, category) => sum + tally.get(category.key).records * category.axisCredits[axis.key], 0,
    ) / scored,
    ROUNDING.subscoreDecimals,
  )]));

  const compositeScaled = CATEGORIES.reduce(
    (sum, category) => sum + tally.get(category.key).records * WEIGHT_SCALED.get(category.key), 0,
  );
  const composite = roundTo(compositeScaled / (100 * scored), ROUNDING.compositeDecimals);

  return Object.freeze({
    rubricVersion: rubric.rubricVersion,
    rubricVersionId: RUBRIC_VERSION_ID,
    scored: true,
    reason: null,
    records: Object.freeze({ total: list.length, scored, unclassified }),
    subscores: Object.freeze(subscores),
    composite,
    grade: letterGradeForScore(composite),
    categories: Object.freeze(categories),
    tokens: Object.freeze({
      input: categories.reduce((sum, category) => sum + category.tokens.input, 0),
      output: categories.reduce((sum, category) => sum + category.tokens.output, 0),
    }),
  });
}
