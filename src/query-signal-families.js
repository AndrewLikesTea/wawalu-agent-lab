// The signal families a query classification may be built from, and the weight
// each one carries — as data, so a director disputing a class can read the
// number that produced it without reading the classifier.
//
// WHY THIS IS A SEPARATE FILE FROM query-classification.js. Two readers need
// these declarations and only one of them needs the classifier. The evolution
// page's reproducibility disclosure has to name the family and weight behind a
// class; it does not classify anything, and importing the classifier to say so
// would pull the rubric, the rubric JSON, the tier table and the segmenter into
// that page's initial payload for the sake of eight sentences. The declarations
// live here, the detectors live next door, and `query-classification.js`
// re-exports every constant below so a reader who opens the classifier still
// meets the weights it uses. There is exactly one copy of each number.
//
// EVERY WEIGHT STATES ITS ASSUMPTION. A weight is a judgement about what
// evidence is worth, not a measurement, and an unstated judgement is the thing
// a director is entitled to reject. Each declaration carries the sentence it
// encodes; `signalFamilyDisclosureRows` puts those sentences in front of the
// reader rather than leaving them in a comment only a maintainer sees.
//
// NOTHING HERE READS A PROMPT. This file holds identifiers, integers, and
// authored English. No value below is derived from an imported record, and the
// rows it composes carry family names, weights, and assumptions only.

/** Bump when a family, a weight, or a bucket boundary changes a published class. */
export const QUERY_SIGNAL_FAMILIES_VERSION = "query-signal-families/1.0.0";

/**
 * The families. A family is a *kind* of evidence, and the reason the set is
 * named rather than flat: "this was called rework because of a phrase" and
 * "this was called rework because the thread turned six times" are different
 * claims, and a reader who distrusts one may still accept the other.
 */
export const SIGNAL_FAMILY = Object.freeze({
  keyword: "keyword",
  threadRepeat: "thread-repeat",
  turnDepth: "turn-depth",
  complexityVsTier: "complexity-vs-tier",
  languageIndependent: "language-independent",
});

/** One line per family, for the disclosure. What it reads, in the reader's words. */
export const SIGNAL_FAMILY_DESCRIPTIONS = Object.freeze({
  keyword: "English phrasings, matched against a published table of patterns.",
  "thread-repeat":
    "Whether the requester came back after an answer — counted from turn roles, not words.",
  "turn-depth": "How many turns the thread ran, in buckets with stated boundaries.",
  "complexity-vs-tier":
    "Turn count, prompt length, and code fences, against the model tier the thread actually used.",
  "language-independent":
    "Labelled and enumerated lines, which are structure a reader can see without reading English.",
});

// ---------------------------------------------------------------------------
// The weights.
// ---------------------------------------------------------------------------
//
// Integers on one scale, so a total is countable by hand. 3 is "this evidence
// alone should decide"; 2 is "strong, but one of these must not outvote a 3";
// 1 is "corroborating only".

/** Leakage phrasing. Assumes personal or entertainment vocabulary is off-task spend. */
export const KEYWORD_LEAKAGE_WEIGHT = 3;
/** Repeat and correction phrasing. Assumes a restated question is a paid-for retry. */
export const KEYWORD_REWORK_WEIGHT = 3;
/** Mechanical edit on a premium model. Assumes the tier, not the words, is the defect. */
export const KEYWORD_TIER_WEIGHT = 3;
/** Context, constraints, acceptance criteria. Assumes a stated boundary is deliberate craft. */
export const KEYWORD_STRUCTURE_WEIGHT = 2;

/** Assumes a user turn that follows an assistant turn is rework on the same task, not a new one. */
export const THREAD_REPEAT_WEIGHT = 3;
/** Assumes repeated follow-ups are a re-prompt spiral, so they corroborate rather than re-decide. */
export const THREAD_REPEAT_SUSTAINED_WEIGHT = 2;
/** Assumes an extended thread cost more turns than the answer needed. */
export const TURN_DEPTH_EXTENDED_WEIGHT = 2;
/** Assumes a thread past the long boundary is unresolved work rather than depth. */
export const TURN_DEPTH_LONG_WEIGHT = 3;
/**
 * Assumes a structurally trivial thread on a premium model is over-provisioned — but weighted 2,
 * below a phrase the requester actually wrote, because this reading rests on shape alone.
 */
export const COMPLEXITY_UNDER_TIER_WEIGHT = 2;
/** Assumes a long, multi-turn, code-bearing thread on a premium model is substantive work. */
export const COMPLEXITY_MATCHED_TIER_WEIGHT = 2;
/** Assumes "short label, colon, value" lines are a structured request in any language. */
export const LANGUAGE_INDEPENDENT_LABEL_WEIGHT = 2;
/** Assumes an enumerated request is a scoped one, but a list alone can be a shopping list. */
export const LANGUAGE_INDEPENDENT_LIST_WEIGHT = 1;

// ---------------------------------------------------------------------------
// The boundaries.
// ---------------------------------------------------------------------------

/**
 * Turn-depth buckets, stated as boundaries rather than a formula. `maxTurns` is
 * inclusive; the last bucket is unbounded and says so with null.
 *
 * WHY 3 AND 8. Three turns is ask, answer, confirm — the shape of a question
 * that worked. Past eight, a thread has cost more than any single answer is
 * worth on this product's own spend-per-task figures. Both are judgements about
 * ordinary enterprise use, not measurements, and a reader may move them.
 */
export const TURN_DEPTH_BUCKETS = Object.freeze([
  Object.freeze({ id: "single", maxTurns: 1, signalId: null }),
  Object.freeze({ id: "short", maxTurns: 3, signalId: null }),
  Object.freeze({ id: "extended", maxTurns: 8, signalId: "turn-depth-extended" }),
  Object.freeze({ id: "long", maxTurns: null, signalId: "turn-depth-long" }),
]);

/** Follow-up user turns before the spiral signal corroborates the first one. */
export const THREAD_REPEAT_SUSTAINED_TURNS = 3;
/** Turns at or above which a thread counts one structural-complexity point. */
export const COMPLEXITY_TURN_COUNT = 4;
/** Prompt characters, summed over user turns, worth one structural-complexity point. */
export const COMPLEXITY_PROMPT_CHARS = 600;
/** Code-fenced or otherwise fenced blocks worth one structural-complexity point. */
export const COMPLEXITY_CODE_BLOCKS = 1;
/** Points at which a thread is read as substantive rather than trivial. Of three available. */
export const COMPLEXITY_POINTS_FOR_SUBSTANTIVE = 2;
/**
 * Characters at or below which a single-turn thread is read as trivial.
 *
 * The over-provisioning claim needs more than "scored no complexity points": a
 * 500-character request with three labelled lines scores none of the three
 * points and is plainly not trivial. So the claim additionally requires a short,
 * single-turn thread with no labelled line, no enumerated line, and no fenced
 * block in it — the shape of "rename this variable", in any language.
 */
export const TRIVIAL_PROMPT_CHARS = 200;

/** Labelled lines before the language-independent structure signal fires. */
export const LABELLED_LINES_MIN = 2;
/** Enumerated lines before the language-independent list signal fires. */
export const LIST_LINES_MIN = 3;

// ---------------------------------------------------------------------------
// The declarations.
// ---------------------------------------------------------------------------

/**
 * Every signal any family may contribute, with the family it belongs to, the
 * rubric category it votes for, its weight, and the assumption that weight
 * encodes. This is the single table: `query-classification.js` reads a keyword
 * rule's weight and category from here rather than typing them a second time,
 * and the disclosure below reads the same rows.
 *
 * Order is the order a reader meets them, and the order signals appear in a
 * result — declaration order, never Map or object iteration order.
 */
export const QUERY_SIGNAL_DECLARATIONS = Object.freeze([
  Object.freeze({
    id: "out-of-scope-personal", family: SIGNAL_FAMILY.keyword,
    category: "outOfScope", weight: KEYWORD_LEAKAGE_WEIGHT,
    assumption: "Personal-life vocabulary means the spend was not on company work.",
  }),
  Object.freeze({
    id: "out-of-scope-entertainment", family: SIGNAL_FAMILY.keyword,
    category: "outOfScope", weight: KEYWORD_LEAKAGE_WEIGHT,
    assumption: "An explicit entertainment request is off-task however well it is written.",
  }),
  Object.freeze({
    id: "inefficient-repeat", family: SIGNAL_FAMILY.keyword,
    category: "inefficient", weight: KEYWORD_REWORK_WEIGHT,
    assumption: "A restated question means the previous paid turn did not land.",
  }),
  Object.freeze({
    id: "inefficient-correction", family: SIGNAL_FAMILY.keyword,
    category: "inefficient", weight: KEYWORD_REWORK_WEIGHT,
    assumption: "A correction is a second call for one answer; the cost is the call.",
  }),
  Object.freeze({
    id: "over-provisioned-trivial-on-premium", family: SIGNAL_FAMILY.keyword,
    category: "overProvisioned", weight: KEYWORD_TIER_WEIGHT,
    assumption: "A mechanical edit is over-provisioned only relative to the model that ran it.",
  }),
  Object.freeze({
    id: "high-value-context", family: SIGNAL_FAMILY.keyword,
    category: "highValue", weight: KEYWORD_STRUCTURE_WEIGHT,
    assumption: "A request that supplies its own setting was thought about first.",
  }),
  Object.freeze({
    id: "high-value-constraints", family: SIGNAL_FAMILY.keyword,
    category: "highValue", weight: KEYWORD_STRUCTURE_WEIGHT,
    assumption: "A stated boundary is craft, but one marker must not outvote leakage.",
  }),
  Object.freeze({
    id: "high-value-acceptance", family: SIGNAL_FAMILY.keyword,
    category: "highValue", weight: KEYWORD_STRUCTURE_WEIGHT,
    assumption: "A request that says what a correct answer is can be checked.",
  }),
  Object.freeze({
    id: "thread-repeat-followup", family: SIGNAL_FAMILY.threadRepeat,
    category: "inefficient", weight: THREAD_REPEAT_WEIGHT,
    assumption: "A user turn after an assistant turn is rework on the same task, not a new one.",
  }),
  Object.freeze({
    id: "thread-repeat-sustained", family: SIGNAL_FAMILY.threadRepeat,
    category: "inefficient", weight: THREAD_REPEAT_SUSTAINED_WEIGHT,
    assumption: `${THREAD_REPEAT_SUSTAINED_TURNS} or more follow-ups is a spiral, `
      + "so it corroborates the first signal rather than deciding again.",
  }),
  Object.freeze({
    id: "turn-depth-extended", family: SIGNAL_FAMILY.turnDepth,
    category: "inefficient", weight: TURN_DEPTH_EXTENDED_WEIGHT,
    assumption: "A thread past 3 turns cost more turns than the answer needed.",
  }),
  Object.freeze({
    id: "turn-depth-long", family: SIGNAL_FAMILY.turnDepth,
    category: "inefficient", weight: TURN_DEPTH_LONG_WEIGHT,
    assumption: "A thread past 8 turns is unresolved work rather than depth.",
  }),
  Object.freeze({
    id: "complexity-under-tier", family: SIGNAL_FAMILY.complexityVsTier,
    category: "overProvisioned", weight: COMPLEXITY_UNDER_TIER_WEIGHT,
    assumption: `A single turn under ${TRIVIAL_PROMPT_CHARS} characters with no labelled line, `
      + "list line or code fence, on a premium model, is over-provisioned — and weighted below "
      + "an explicit phrase, because this reading is about shape rather than about what was asked.",
  }),
  Object.freeze({
    id: "complexity-matched-tier", family: SIGNAL_FAMILY.complexityVsTier,
    category: "highValue", weight: COMPLEXITY_MATCHED_TIER_WEIGHT,
    assumption: "A long, multi-turn or code-bearing thread earns the premium model it used.",
  }),
  Object.freeze({
    id: "language-independent-labelled", family: SIGNAL_FAMILY.languageIndependent,
    category: "highValue", weight: LANGUAGE_INDEPENDENT_LABEL_WEIGHT,
    assumption: "Label-and-colon lines are a structured request in any language.",
  }),
  Object.freeze({
    id: "language-independent-enumerated", family: SIGNAL_FAMILY.languageIndependent,
    category: "highValue", weight: LANGUAGE_INDEPENDENT_LIST_WEIGHT,
    assumption: "An enumerated request is a scoped one, but a list alone can be a shopping list.",
  }),
]);

const BY_ID = new Map(QUERY_SIGNAL_DECLARATIONS.map((entry) => [entry.id, entry]));

/**
 * The declaration for one signal id, or a throw. Deliberately not a lookup that
 * returns undefined: a detector naming a signal this table does not declare
 * would publish a weight nobody can read, which is the one outcome this whole
 * file exists to prevent.
 */
export function signalDeclaration(id) {
  const found = BY_ID.get(id);
  if (!found) throw new RangeError(`query signals: no declaration for ${id}`);
  return found;
}

/** The classes any signal can vote for, in declaration order. Never sorted by name. */
export function declaredCategories() {
  const seen = [];
  for (const entry of QUERY_SIGNAL_DECLARATIONS) {
    if (!seen.includes(entry.category)) seen.push(entry.category);
  }
  return seen;
}

/**
 * The reproducibility rows: per class, which family can produce it and at what
 * weight, plus the assumption each weight encodes.
 *
 * Returned as `{term, detail}` pairs rather than as markup — the caller shapes
 * them into whatever the surrounding disclosure already uses, so this file
 * cannot introduce a second visual language. Both strings are authored here or
 * read off the table above; neither can carry anything from a prompt.
 */
export function signalFamilyDisclosureRows() {
  const rows = [{
    term: "What decides a query's class",
    detail: "Five families of evidence, each voting for one class with the weight below. The "
      + "class with the most weight wins and its share of all weight cast is the confidence; a "
      + "record whose winner falls under the floor is left unclassified rather than graded on a "
      + "coin toss. Four of the five families read structure — turn roles, turn count, prompt "
      + "length, code fences, labelled and enumerated lines, and the model tier — so a thread "
      + "written in any language is still classified rather than dropped.",
  }];
  for (const category of declaredCategories()) {
    const entries = QUERY_SIGNAL_DECLARATIONS.filter((row) => row.category === category);
    rows.push({
      term: `Signals that produce “${category}”`,
      detail: entries.map((row) => `${row.family} · ${row.id} · weight ${row.weight} — `
        + row.assumption).join(" · "),
    });
  }
  rows.push({
    term: "What classification never reads",
    detail: "No prompt text is sent anywhere, stored, or shown here. A prompt body exists only "
      + "inside the classifying call; what leaves it is a class name, a family name, an integer "
      + "weight, and a confidence. Every number above is a constant in "
      + `src/query-signal-families.js (${QUERY_SIGNAL_FAMILIES_VERSION}), so a reader can `
      + "check a class by adding the weights up themselves.",
  });
  return rows;
}
