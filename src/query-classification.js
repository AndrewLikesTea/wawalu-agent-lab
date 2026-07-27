// Deterministic query classification: an excerpt in, a rubric category out.
//
// Theo's rubric (`prompt-literacy-scoring.js`) grades records that already carry
// a category and refuses to guess one. This module is the missing upstream step,
// and it is deliberately the dumbest thing that can work: an ordered table of
// literal patterns, each declaring the category it votes for and the weight of
// that vote. No model, no scoring network, no randomness, no clock, no I/O. The
// same excerpt and the same model string always produce the same category and
// the same confidence, on any machine, forever.
//
// WHY A TABLE AND NOT AN ALGORITHM. A director disputing a grade has to be able
// to read the reason their query was called out-of-scope. `QUERY_CLASSIFICATION_RULES`
// is exported as data for exactly that: the rules are readable without reading
// `classifyQuery`, and a matched rule's id travels out on every result.
//
// WHY WEIGHTS AND NOT FIRST-MATCH. A first-match table makes rule order the
// whole answer and gives no way to say "this excerpt looks like two things at
// once". Weighted votes let that ambiguity surface as a low confidence, which is
// what routes the record to `unclassified` instead of grading it on a coin toss.
//
// PRIVACY. The excerpt is a function argument. It is lower-cased into a local,
// tested against the patterns, and dropped when this function returns. Nothing
// derived from it but a category key, a number, and rule ids leaves this module,
// and no result field ever carries a substring of it. See `query-sample.js` for
// the type-level half of the same guarantee.

import { PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";
import { classifyModelTier } from "./provider-usage-record.js";

/** Bump when a rule, weight, or the floor changes a category anyone published. */
export const QUERY_CLASSIFIER_VERSION = "query-classifier/1.0.0";

/** The bucket for a record this table could not place. Not a rubric category. */
export const UNCLASSIFIED_CATEGORY = "unclassified";

/**
 * The single confidence floor. A record at or above it carries the category the
 * table chose; a record below it is `unclassified` and counts against coverage.
 *
 * 0.6 and not 0.5 on purpose: confidence is the winning category's share of all
 * votes cast, so a straight two-way tie scores exactly 0.5. A tie is the case
 * this floor exists to catch, so the floor has to sit above it.
 */
export const MINIMUM_CLASSIFICATION_CONFIDENCE = 0.6;

/** Why a record is unclassified. Machine-readable; never assembled for display. */
export const UNCLASSIFIED_REASONS = Object.freeze({
  noExcerpt: "no_excerpt",
  noSignal: "no_signal",
  belowConfidenceFloor: "below_confidence_floor",
});

/**
 * Tie-break order, worst-outcome first.
 *
 * Only consulted when two categories draw the same total weight — and a draw is
 * already below the floor, so this decides which category name is *reported*
 * beside an unclassified record, never which category is graded. Leakage sorts
 * first so an ambiguous record is never described as the better of its readings.
 */
export const CATEGORY_PRECEDENCE = Object.freeze([
  "outOfScope", "inefficient", "overProvisioned", "highValue",
]);

const RUBRIC_CATEGORY_KEYS = new Set(PROMPT_LITERACY_RUBRIC.categories.map((c) => c.key));

/**
 * THE RULES. Read top to bottom; every rule whose pattern matches contributes
 * `weight` votes to its category. Patterns are tested against the lower-cased
 * excerpt, so no rule carries a case variant.
 *
 * NO SOURCE. These are phrasings this repository chose as observable proxies for
 * the four rubric categories. They are a judgement about English, not a measured
 * classifier, and a reader who disagrees with one can name the rule id.
 *
 * `requiresModelTier` reads Anya's contract vocabulary (`classifyModelTier`), so
 * "trivial work sent to a premium model" is decided by the same tier table the
 * billing import uses rather than by a second opinion about model names here.
 */
export const QUERY_CLASSIFICATION_RULES = Object.freeze([
  Object.freeze({
    id: "out-of-scope-personal",
    category: "outOfScope",
    weight: 3,
    pattern: /\b(recipe|birthday|vacation|horoscope|lyrics|wedding|dating|fantasy football)\b/,
    note: "Personal-life vocabulary. Weighted above the high-value signals because "
      + "leakage that also happens to be well-written is still leakage.",
  }),
  Object.freeze({
    id: "out-of-scope-entertainment",
    category: "outOfScope",
    weight: 3,
    pattern: /\b(write me a poem|tell me a joke|short story|movie recommendation)\b/,
    note: "Explicit entertainment requests, stated as whole phrases so 'joke' inside "
      + "a product discussion does not trip the rule.",
  }),
  Object.freeze({
    id: "inefficient-repeat",
    category: "inefficient",
    weight: 3,
    pattern: /\b(try again|one more time|still (not|does ?n'?t)|as i (said|asked))\b/,
    note: "The re-prompt spiral in its own words: the requester is restating a "
      + "question the previous turn did not answer.",
  }),
  Object.freeze({
    id: "inefficient-correction",
    category: "inefficient",
    weight: 3,
    pattern: /\b(no,? i meant|that'?s not what i|you (said|gave) that already|wrong answer)\b/,
    note: "A correction turn. Same category as a repeat: the cost is the extra call, "
      + "not the phrasing of it.",
  }),
  Object.freeze({
    id: "over-provisioned-trivial-on-premium",
    category: "overProvisioned",
    weight: 3,
    requiresModelTier: "premium",
    pattern: /\b(rename|fix (the |a )?typo|capitali[sz]e|reformat|spell ?check|convert this to (json|csv|yaml))\b/,
    note: "Mechanical edits are only over-provisioned relative to the model that ran "
      + "them, so this rule abstains entirely unless Anya's tier table says premium.",
  }),
  Object.freeze({
    id: "high-value-context",
    category: "highValue",
    weight: 2,
    pattern: /(^|\W)(context:|background:|given the following|here is the)/,
    note: "The request supplies its own setting. Weighted 2 rather than 3 so one "
      + "structural marker alone cannot outvote an explicit leakage signal.",
  }),
  Object.freeze({
    id: "high-value-constraints",
    category: "highValue",
    weight: 2,
    pattern: /(^|\W)(constraints?:|requirements?:|must not|do not use|limit(ed)? to)/,
    note: "The request states its boundaries — the second of the three things the "
      + "rubric's intent axis asks for.",
  }),
  Object.freeze({
    id: "high-value-acceptance",
    category: "highValue",
    weight: 2,
    pattern: /(^|\W)(acceptance criteria|expected output|success looks like|definition of done)/,
    note: "The request says what a correct answer is. Three high-value signals total "
      + "six votes and beat any single competing rule, which is the intended shape: "
      + "a well-formed request that mentions a birthday is still well-formed.",
  }),
]);

for (const rule of QUERY_CLASSIFICATION_RULES) {
  if (!RUBRIC_CATEGORY_KEYS.has(rule.category)) {
    throw new RangeError(`query classifier: rule ${rule.id} names no rubric category`);
  }
}

/** Confidence is reported to four places, the rubric's own share precision. */
function roundShare(value) {
  const factor = 10 ** PROMPT_LITERACY_RUBRIC.reporting.shareDecimals;
  return Math.round(value * factor) / factor;
}

function unclassified(reason, category = null, ruleIds = []) {
  return Object.freeze({
    category: UNCLASSIFIED_CATEGORY,
    classified: false,
    confidence: 0,
    reason,
    // The category the table leaned toward, for a reviewer reading a rejection.
    // Null when nothing matched, and never used as a grade.
    nearestCategory: category,
    matchedRuleIds: Object.freeze(ruleIds),
  });
}

/**
 * Classify one excerpt.
 *
 * @param {{excerpt?: string, model?: string}} input the in-flight parse record's
 *   transient fields. Neither is retained.
 * @returns {{category: string, classified: boolean, confidence: number,
 *   reason: string|null, nearestCategory: string|null, matchedRuleIds: string[]}}
 *   `category` is a rubric category key when `classified`, and
 *   `UNCLASSIFIED_CATEGORY` otherwise. Confidence is the winning category's share
 *   of all votes cast, in [0, 1].
 */
export function classifyQuery({ excerpt, model } = {}) {
  if (typeof excerpt !== "string" || !excerpt.trim()) {
    return unclassified(UNCLASSIFIED_REASONS.noExcerpt);
  }
  const text = excerpt.toLowerCase();
  const tier = classifyModelTier(model);
  const weights = new Map();
  const matched = [];
  for (const rule of QUERY_CLASSIFICATION_RULES) {
    if (rule.requiresModelTier && rule.requiresModelTier !== tier) continue;
    if (!rule.pattern.test(text)) continue;
    weights.set(rule.category, (weights.get(rule.category) ?? 0) + rule.weight);
    matched.push(rule.id);
  }
  if (!matched.length) return unclassified(UNCLASSIFIED_REASONS.noSignal);

  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  // Highest weight wins; a draw falls to declaration order in CATEGORY_PRECEDENCE,
  // so the winner never depends on Map iteration order or on input order.
  const [category, weight] = [...weights.entries()].sort((left, right) =>
    right[1] - left[1]
    || CATEGORY_PRECEDENCE.indexOf(left[0]) - CATEGORY_PRECEDENCE.indexOf(right[0]))[0];
  const confidence = roundShare(weight / total);
  if (confidence < MINIMUM_CLASSIFICATION_CONFIDENCE) {
    return unclassified(UNCLASSIFIED_REASONS.belowConfidenceFloor, category, matched);
  }
  return Object.freeze({
    category,
    classified: true,
    confidence,
    reason: null,
    nearestCategory: category,
    matchedRuleIds: Object.freeze(matched),
  });
}
