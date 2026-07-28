// Grading an imported corpus against the declared hero-panel eligibility floor.
//
// `prompt-literacy-scoring.js` answers "what does this mix of categories score?"
// It answers it for ten records as readily as for ten thousand, because that is
// the right behaviour for a rubric: arithmetic does not get a vote on whether it
// was given enough evidence. `finops-panel-contract.js` answers the other half —
// the hero grade panel declares `scoredPrompts >= MIN_SCORED_PROMPTS` before any
// grade-shaped claim may appear — but it answers it about a *panel*, and returns
// no grade.
//
// Nothing joined the two. A caller holding nine scored prompts could take a
// composite off the rubric and print a letter beside it, and the panel contract
// would never see the number that was drawn. This module is that join: one call
// that either returns a grade the declared floor permits, or a stable named
// reason why no grade exists — never a grade and a caveat, because a caveat is
// something a surface can drop.
//
// ---------------------------------------------------------------------------
// What is published, and what stands behind each number
// ---------------------------------------------------------------------------
//
//   grade, composite      the rubric's, unchanged. Every weight behind them is
//                         stated in `prompt-literacy-rubric.json` beside the
//                         number it weights.
//   confidence            a NAMED level with a published rule, not an invented
//                         0-1 score. Its one input is how many times over the
//                         declared floor the corpus is, and the arithmetic that
//                         produced it is carried in the result.
//   records.source        how many records were handed in, before redaction and
//                         before classification. The provenance number a
//                         director asks for first: "off how much of my file?"
//   reason                null when graded; otherwise one of a closed set of
//                         codes a surface switches on and never string-matches.
//
// DETERMINISM. Pure: no clock, no randomness, no network, no I/O, no mutation
// of the caller's records. Rerunning on the same input returns a byte-identical
// serialization, including record order: every reported figure is a sum or a
// count, and the one list that could vary (model identifiers) is sorted by the
// rubric module before it is returned.
//
// REDACTION. `redactCorpusRecords` is the boundary. Scoring input is built by
// allowlist — four fields, three of them numeric — so a prompt, a completion, a
// customer name or a mis-mapped column carrying any of them cannot reach the
// scorer, let alone the result. The one string that survives is a model
// identifier that matched the rubric's conservative shape; anything else
// becomes the rubric's `unrecognized` label. There is no depth at which an
// untrusted field is copied, because untrusted fields are not copied at all.

import {
  PROMPT_LITERACY_RUBRIC, RUBRIC_VERSION_ID, scorePromptLiteracy,
} from "./prompt-literacy-scoring.js";
import { MIN_SCORED_PROMPTS } from "./finops-panel-contract.js";
import { PROMPT_GRADING_THRESHOLDS } from "./prompt-grading-eligibility.js";

/** Bump when a `reason`, a confidence `level`, or the result shape changes meaning. */
export const CORPUS_GRADE_VERSION = "imported-corpus-grade/1.0.0";

/**
 * The floor a corpus has to clear before a letter is published, and where it
 * comes from.
 *
 * NOT A NEW NUMBER. It is `MIN_SCORED_PROMPTS`, the hero grade panel's declared
 * requirement, which is itself the published prompt-grading per-department
 * floor. Three surfaces now read one constant; a second copy here is exactly
 * the drift this module exists to prevent, so there is none.
 */
export const CORPUS_ELIGIBILITY = Object.freeze({
  minScoredRecords: MIN_SCORED_PROMPTS,
  /**
   * Read with `>=`, so a corpus sitting exactly on the floor is graded.
   *
   * Same direction as the panel contract, the coverage tiers and the
   * prompt-grading thresholds. A comparison that flipped between two modules
   * would put a grade on the page that the panel beneath it refuses to show.
   */
  comparison: ">=",
  source: "MIN_SCORED_PROMPTS, declared by the hero-grade panel in finops-panel-contract.js",
  assumption: "A grade is a claim about how a team works, and below the declared floor it is a "
    + "claim about a handful of afternoons. The floor is not re-derived here: the panel that "
    + "shows the letter and the module that computes it must refuse on the same number, or a "
    + "reader sees a grade above a panel that says the grade is unanswerable.",
});

/**
 * Why no grade was published. A closed set: a surface switches on these codes.
 *
 * Precedence is the order declared here, and it is total — exactly one applies.
 * `no_source_records` outranks the rest because "you imported nothing" and "we
 * could read none of what you imported" are different conversations, and the
 * second one is an accusation to level at a file that exists.
 */
export const CORPUS_NOT_GRADEABLE = Object.freeze({
  noSourceRecords: "no_source_records",
  noneClassified: "no_classified_records",
  belowFloor: "scored_records_below_eligibility_floor",
});

/** The published sentence behind each reason. Data, so a surface writes no copy of its own. */
export const CORPUS_NOT_GRADEABLE_RULE = Object.freeze({
  [CORPUS_NOT_GRADEABLE.noSourceRecords]:
    "No records were handed to the rubric, so there is nothing to grade. This is not a score of "
    + "zero and not a failing letter: it is the absence of a measurement.",
  [CORPUS_NOT_GRADEABLE.noneClassified]:
    "Records were read, but none carried a category this rubric recognises. Classification "
    + "happens upstream; grading a record whose category was guessed would move a letter with "
    + "no evidence behind it.",
  [CORPUS_NOT_GRADEABLE.belowFloor]:
    `Fewer than ${MIN_SCORED_PROMPTS} records scored, which is the floor the hero grade panel `
    + "declares. The rubric would return arithmetic for this corpus; the arithmetic would be a "
    + "claim about a sample too small to describe how the team works.",
});

/**
 * How far over the declared floor a corpus has to sit before its letter is
 * called confident, read high to low with `>=`.
 *
 * WHY THESE MULTIPLES AND NOT A SCORE. Every tier here is a statement about one
 * quantity a reader can check: how far one record can move the published
 * composite. On a corpus of n scored records that is 100/n points, so the floor
 * (25 records) gives one record four points — most of a letter band — 2x gives
 * it two, and 4x gives it one. The tiers double because that influence halves;
 * `high` is named at the point where no single record can move the reported
 * whole number by more than a point, which is the smallest change the composite
 * can even express.
 *
 * A 0-1 confidence number was deliberately not invented. This repository has
 * refused one twice already (the trust verdict, and prompt-grading eligibility)
 * for the same reason: a director can dispute "one record moves this four
 * points" and cannot dispute "0.62".
 */
export const CORPUS_CONFIDENCE_TIERS = Object.freeze([
  Object.freeze({
    level: "high",
    minFloorMultiple: 4,
    label: "High confidence",
    rule: `At least ${MIN_SCORED_PROMPTS * 4} scored records: one record moves the composite by `
      + "at most one point, so no single prompt can change the letter.",
  }),
  Object.freeze({
    level: "moderate",
    minFloorMultiple: 2,
    label: "Moderate confidence",
    rule: `At least ${MIN_SCORED_PROMPTS * 2} scored records: one record moves the composite by `
      + "about two points, well inside the ten-point letter bands.",
  }),
  Object.freeze({
    level: "low",
    minFloorMultiple: 1,
    label: "Low confidence",
    rule: `At least ${MIN_SCORED_PROMPTS} scored records — the declared floor, and no further. `
      + "One record moves the composite by about four points, so the letter is reportable but a "
      + "one-band move between periods is inside the noise.",
  }),
]);

/** The confidence of a result that has no grade. Named, so the field is never absent. */
export const CORPUS_CONFIDENCE_NONE = Object.freeze({
  level: "none",
  label: "Not gradeable",
  rule: "No grade was published, so there is no confidence in one. Confidence is a statement "
    + "about a letter, never a consolation number offered in place of it.",
});

/**
 * The classified-share floor a corpus must also clear to keep its confidence
 * tier, borrowed rather than declared: it is prompt-grading's published
 * `minClassifiedPromptShare`.
 *
 * WHY A DOWNGRADE AND NOT A REFUSAL. Below this share the scored records are
 * still scored correctly — but they are a sample of whatever happened to
 * classify, and the mix between categories is not measured. That weakens the
 * claim about the letter without invalidating the arithmetic behind it, which
 * is precisely what a confidence level is for. The downgrade is one step and
 * never below `low`: a corpus that cleared the record floor has a grade, and a
 * grade always carries at least the confidence its record count earned.
 */
export const CORPUS_CLASSIFIED_SHARE_FLOOR = PROMPT_GRADING_THRESHOLDS.minClassifiedPromptShare;

/**
 * Decimals on the two derived ratios this module publishes.
 *
 * The share reuses the rubric's own share rounding so one number is not rounded
 * two ways on one screen. The floor multiple keeps two decimals because it is
 * shown as a multiplier ("2.40x the declared floor") and a reader recomputes it
 * from the two integers printed beside it.
 */
const SHARE_DECIMALS = PROMPT_LITERACY_RUBRIC.reporting.shareDecimals;
const MULTIPLE_DECIMALS = 2;

const CATEGORY_NAMES = new Set(PROMPT_LITERACY_RUBRIC.categories.flatMap(
  (category) => [category.key, category.label],
));
const MODEL_ID = new RegExp(PROMPT_LITERACY_RUBRIC.redaction.modelIdPattern);
const UNRECOGNIZED_MODEL = PROMPT_LITERACY_RUBRIC.redaction.unrecognizedModelLabel;

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/**
 * One record, reduced to the four fields scoring is allowed to see.
 *
 * Built by allowlist, in this direction on purpose: a denylist of known-unsafe
 * field names would pass the next field somebody adds upstream. A category that
 * is not one the rubric published becomes `null` rather than being forwarded —
 * the scorer would set it aside anyway, but an unrecognized category is a string
 * from the import, and this module does not hand strings from the import to
 * anything.
 */
export function redactCorpusRecord(record) {
  const raw = record?.category;
  return Object.freeze({
    category: typeof raw === "string" && CATEGORY_NAMES.has(raw) ? raw : null,
    model: typeof record?.model === "string" && MODEL_ID.test(record.model)
      ? record.model : UNRECOGNIZED_MODEL,
    inputTokens: tokenCount(record?.inputTokens),
    outputTokens: tokenCount(record?.outputTokens),
  });
}

/** The scoring input for a whole corpus. The only thing `gradeImportedCorpus` scores. */
export function redactCorpusRecords(records = []) {
  const list = Array.isArray(records) ? records : [];
  return Object.freeze(list.map(redactCorpusRecord));
}

function confidenceFor(scoredRecords, classifiedShare) {
  const multiple = roundTo(scoredRecords / CORPUS_ELIGIBILITY.minScoredRecords, MULTIPLE_DECIMALS);
  const earnedIndex = CORPUS_CONFIDENCE_TIERS.findIndex(
    (tier) => multiple >= tier.minFloorMultiple,
  );
  // findIndex never returns -1 here: the caller only asks once the record floor
  // is cleared, and the last tier's multiple is that floor. Clamped anyway, so a
  // future tier table cannot make this throw on a surface.
  const earned = CORPUS_CONFIDENCE_TIERS[earnedIndex] ?? CORPUS_CONFIDENCE_TIERS.at(-1);
  const thin = classifiedShare < CORPUS_CLASSIFIED_SHARE_FLOOR;
  const index = Math.min(
    (earnedIndex === -1 ? CORPUS_CONFIDENCE_TIERS.length - 1 : earnedIndex) + (thin ? 1 : 0),
    CORPUS_CONFIDENCE_TIERS.length - 1,
  );
  const tier = CORPUS_CONFIDENCE_TIERS[index];
  return Object.freeze({
    level: tier.level,
    label: tier.label,
    rule: tier.rule,
    basis: Object.freeze({
      scoredRecords,
      minScoredRecords: CORPUS_ELIGIBILITY.minScoredRecords,
      floorMultiple: multiple,
      arithmetic: `${scoredRecords} scored records / ${CORPUS_ELIGIBILITY.minScoredRecords} `
        + `declared floor = ${multiple.toFixed(MULTIPLE_DECIMALS)}x`,
      classifiedShare,
      classifiedShareFloor: CORPUS_CLASSIFIED_SHARE_FLOOR,
      // Stated whether or not it fired, so a reader comparing two periods can
      // see that the level moved for this reason and not for a record count.
      downgradedForClassifiedShare: thin && earned.level !== tier.level,
    }),
  });
}

function notGradeable(reason, { source, scored, unclassified, classifiedShare }) {
  return Object.freeze({
    version: CORPUS_GRADE_VERSION,
    rubricVersionId: RUBRIC_VERSION_ID,
    gradeable: false,
    grade: null,
    composite: null,
    reason,
    reasonRule: CORPUS_NOT_GRADEABLE_RULE[reason],
    confidence: CORPUS_CONFIDENCE_NONE,
    records: Object.freeze({ source, scored, unclassified, classifiedShare }),
    eligibility: Object.freeze({
      minScoredRecords: CORPUS_ELIGIBILITY.minScoredRecords,
      comparison: CORPUS_ELIGIBILITY.comparison,
      observed: scored,
      met: false,
      source: CORPUS_ELIGIBILITY.source,
      assumption: CORPUS_ELIGIBILITY.assumption,
    }),
    // No decomposition, on purpose. A `score` block on a refusal is a grade a
    // surface can still reach for, and the first thing a page under deadline
    // does with a reachable number is print it.
    score: null,
  });
}

/**
 * Grade an imported corpus, or refuse and say why.
 *
 * @param records already-classified records: `{ category, model, inputTokens,
 *   outputTokens }`. Extra fields are permitted and discarded — see
 *   `redactCorpusRecords`, which is applied before anything is scored.
 * @returns a frozen result. `gradeable` is the only branch a caller needs:
 *   `true` carries `grade`, `composite`, a named `confidence` and the full
 *   rubric decomposition under `score`; `false` carries a `reason` from
 *   `CORPUS_NOT_GRADEABLE`, the published sentence behind it, and nulls
 *   everywhere a number would otherwise be inferred.
 */
export function gradeImportedCorpus(records = []) {
  const list = Array.isArray(records) ? records : [];
  const source = list.length;
  const scored = scorePromptLiteracy(redactCorpusRecords(list));
  const scoredRecords = scored.records.scored;
  const unclassified = scored.records.unclassified;
  const classifiedShare = source === 0 ? 0 : roundTo(scoredRecords / source, SHARE_DECIMALS);
  const counts = { source, scored: scoredRecords, unclassified, classifiedShare };

  if (source === 0) return notGradeable(CORPUS_NOT_GRADEABLE.noSourceRecords, counts);
  if (scoredRecords === 0) return notGradeable(CORPUS_NOT_GRADEABLE.noneClassified, counts);
  if (scoredRecords < CORPUS_ELIGIBILITY.minScoredRecords) {
    return notGradeable(CORPUS_NOT_GRADEABLE.belowFloor, counts);
  }

  return Object.freeze({
    version: CORPUS_GRADE_VERSION,
    rubricVersionId: RUBRIC_VERSION_ID,
    gradeable: true,
    grade: scored.grade,
    composite: scored.composite,
    reason: null,
    reasonRule: null,
    confidence: confidenceFor(scoredRecords, classifiedShare),
    records: Object.freeze(counts),
    eligibility: Object.freeze({
      minScoredRecords: CORPUS_ELIGIBILITY.minScoredRecords,
      comparison: CORPUS_ELIGIBILITY.comparison,
      observed: scoredRecords,
      met: true,
      source: CORPUS_ELIGIBILITY.source,
      assumption: CORPUS_ELIGIBILITY.assumption,
    }),
    /**
     * The rubric's own output, so the published letter can be taken apart into
     * the three subscores and the four category rows that produced it. Present
     * only on a graded result, and identical to what `scorePromptLiteracy`
     * returns for the redacted records — this module recomputes nothing.
     */
    score: scored,
  });
}
