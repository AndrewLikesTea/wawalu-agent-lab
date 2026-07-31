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
// derived from it but a category key, a number, rule ids, and the matched
// pattern token described next leaves this module. See `query-sample.js` for
// the type-level half of the same guarantee.
//
// THE ONE THING THAT IS NOT A NAME: `evidence.signal`. A director disputing a
// class asks "on what?", and a rule id answers it only for a reader holding this
// file. So a result now also carries the token that fired — and it is bounded by
// construction, not by hope: `matchedSignal` republishes the match only when the
// token *itself* still fires the rule that produced it, so nothing can be
// published that is not already in the language of a pattern authored in this
// file, and it is capped at `MAX_SIGNAL_LENGTH` so a pathological export cannot
// grow one. Every alternative in every pattern below is a literal English
// phrase; a signal is therefore one of those phrases, never a span of the
// requester's own text around one. Anything holding a signal renders it as text.

// SCOPE, AND THE MODULE THAT OWNS THE REST OF IT. This module grades one short
// gateway-log excerpt into one rubric category, and that is all it does. A
// director's *own* prompts are a different input — full length, several turns,
// with code and pasted material in them and not always in English — and they
// are graded by `prompt-prose-classification.js`, which produces three
// dimension scores and a letter rather than a category vote. The two answer to
// the same rubric and share this file's vocabulary (`UNCLASSIFIED_CATEGORY`,
// `CATEGORY_PRECEDENCE`, which it imports from here), but they do not share an
// input shape. Merging them would mean counting a vote designed for one
// sentence over four thousand characters, which is the exact failure the prose
// classifier exists to fix.

// STRUCTURAL FAMILIES, ADDED ALONGSIDE — not instead of. `classifyQuery` below
// reads one excerpt and votes with one family, `keyword`. `classifyThread`
// further down reads a whole normalized thread and votes with five, of which
// four never read an English word: whether the requester came back after an
// answer, how deep the thread ran, how complex it is against the tier it used,
// and whether it carries labelled or enumerated structure. A record written in
// Japanese has four families available to it and is classified rather than
// dropped for lacking the English one. Every weight either function uses is
// declared in `query-signal-families.js` with the assumption it encodes, and
// every signal that contributed is named in the result — a class this module
// cannot explain is a class it does not publish.

import { PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";
import { classifyModelTier } from "./provider-usage-record.js";
import { segmentPromptBody } from "./prompt-prose-segmentation.js";
import {
  COMPLEXITY_CODE_BLOCKS, COMPLEXITY_POINTS_FOR_SUBSTANTIVE, COMPLEXITY_PROMPT_CHARS,
  COMPLEXITY_TURN_COUNT, LABELLED_LINES_MIN, LIST_LINES_MIN, QUERY_SIGNAL_DECLARATIONS,
  QUERY_SIGNAL_FAMILIES_VERSION, SIGNAL_FAMILY, THREAD_REPEAT_SUSTAINED_TURNS,
  TRIVIAL_PROMPT_CHARS, TURN_DEPTH_BUCKETS, signalDeclaration,
} from "./query-signal-families.js";

export * from "./query-signal-families.js";

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
  // The two thread-shaped refusals. Separate codes because they are separate
  // facts: a record with no turns at all is a broken import, and a record whose
  // turns are all assistant turns is a transcript with no request in it.
  noTurns: "no_turns",
  noUserTurn: "no_user_turn",
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
 *
 * WHERE THE WEIGHTS WENT. Each rule's category and weight are spread in from
 * its declaration in `query-signal-families.js` rather than typed here. The
 * numbers are unchanged; what changed is that there is now one table a reader
 * can check every published class against, keyword and structural alike.
 */
const declared = (id) => {
  const entry = signalDeclaration(id);
  return { id, family: entry.family, category: entry.category, weight: entry.weight };
};

export const QUERY_CLASSIFICATION_RULES = Object.freeze([
  Object.freeze({
    ...declared("out-of-scope-personal"),
    pattern: /\b(recipe|birthday|vacation|horoscope|lyrics|wedding|dating|fantasy football)\b/,
    note: "Personal-life vocabulary. Weighted above the high-value signals because "
      + "leakage that also happens to be well-written is still leakage.",
  }),
  Object.freeze({
    ...declared("out-of-scope-entertainment"),
    pattern: /\b(write me a poem|tell me a joke|short story|movie recommendation)\b/,
    note: "Explicit entertainment requests, stated as whole phrases so 'joke' inside "
      + "a product discussion does not trip the rule.",
  }),
  Object.freeze({
    ...declared("inefficient-repeat"),
    pattern: /\b(try again|one more time|still (not|does ?n'?t)|as i (said|asked))\b/,
    note: "The re-prompt spiral in its own words: the requester is restating a "
      + "question the previous turn did not answer.",
  }),
  Object.freeze({
    ...declared("inefficient-correction"),
    pattern: /\b(no,? i meant|that'?s not what i|you (said|gave) that already|wrong answer)\b/,
    note: "A correction turn. Same category as a repeat: the cost is the extra call, "
      + "not the phrasing of it.",
  }),
  Object.freeze({
    ...declared("over-provisioned-trivial-on-premium"),
    requiresModelTier: "premium",
    pattern: /\b(rename|fix (the |a )?typo|capitali[sz]e|reformat|spell ?check|convert this to (json|csv|yaml))\b/,
    note: "Mechanical edits are only over-provisioned relative to the model that ran "
      + "them, so this rule abstains entirely unless Anya's tier table says premium.",
  }),
  Object.freeze({
    ...declared("high-value-context"),
    pattern: /(^|\W)(context:|background:|given the following|here is the)/,
    note: "The request supplies its own setting. Weighted 2 rather than 3 so one "
      + "structural marker alone cannot outvote an explicit leakage signal.",
  }),
  Object.freeze({
    ...declared("high-value-constraints"),
    pattern: /(^|\W)(constraints?:|requirements?:|must not|do not use|limit(ed)? to)/,
    note: "The request states its boundaries — the second of the three things the "
      + "rubric's intent axis asks for.",
  }),
  Object.freeze({
    ...declared("high-value-acceptance"),
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

/**
 * The longest signal token this module will publish.
 *
 * The authored patterns cannot match anything near this — "definition of done"
 * is the longest of them at nineteen characters — so the cap never fires on a
 * well-formed rule. It exists for the rule somebody adds later with an
 * unbounded quantifier in it: a bound stated once here is cheaper than trusting
 * every future pattern to be bounded on its own.
 */
export const MAX_SIGNAL_LENGTH = 40;

/**
 * The token that fired a rule, or null.
 *
 * Two guards, in this order. The match is trimmed of the leading non-word
 * character some patterns capture with `(^|\W)` and capped; then it is tested
 * against the rule that produced it, and republished only if it still fires.
 * That second test is the whole containment argument — a token that does not
 * match an authored pattern is not published at all, so the only strings that
 * can leave here are strings this file's own rule table describes.
 */
function matchedSignal(rule, text) {
  const match = rule.pattern.exec(text);
  if (!match) return null;
  const token = match[0].replace(/^[^\w]+/, "").trim().slice(0, MAX_SIGNAL_LENGTH);
  return token && rule.pattern.test(token) ? token : null;
}

/**
 * The evidence record, one shape for every result this module returns.
 *
 * `class` is the published category, `unclassified` included — a reader
 * switching on it never has to also read `classified`. `signal` and `patternId`
 * are both null exactly when nothing was assigned, and `unclassifiedReason` is
 * null exactly when something was. `confidence` is the same number the result
 * publishes beside it, produced by the rule weights and never per call.
 */
function evidenceRecord({ category, signal = null, patternId = null, confidence, reason = null }) {
  return Object.freeze({
    class: category,
    signal,
    patternId,
    confidence,
    unclassifiedReason: reason,
  });
}

/** Confidence is reported to four places, the rubric's own share precision. */
function roundShare(value) {
  const factor = 10 ** PROMPT_LITERACY_RUBRIC.reporting.shareDecimals;
  return Math.round(value * factor) / factor;
}

/**
 * Signal ids -> the explainable rows a result publishes.
 *
 * The whole point of the shape: a family name, the signal inside it, the class
 * it voted for, and the integer it voted with. A reader adds these up by hand
 * and lands on the same confidence the code did. Nothing here is derived from a
 * prompt — `signalDeclaration` throws on an id nobody declared, so a signal
 * that could not be named would fail the run rather than publish a bare number.
 */
function signalRows(ids) {
  return Object.freeze(ids.map((id) => {
    const entry = signalDeclaration(id);
    return Object.freeze({
      family: entry.family, signal: id, category: entry.category, weight: entry.weight,
    });
  }));
}

/** Family ids present in a row list, in declaration order. Never Set order. */
function familiesOf(rows) {
  const order = Object.values(SIGNAL_FAMILY);
  return Object.freeze(order.filter((family) => rows.some((row) => row.family === family)));
}

function unclassified(reason, category = null, ruleIds = []) {
  const signals = signalRows(ruleIds);
  return Object.freeze({
    category: UNCLASSIFIED_CATEGORY,
    classified: false,
    confidence: 0,
    reason,
    // The category the table leaned toward, for a reviewer reading a rejection.
    // Null when nothing matched, and never used as a grade.
    nearestCategory: category,
    matchedRuleIds: Object.freeze(ruleIds),
    // The evidence that was not enough, named anyway. A rejected record is the
    // one a director argues about, so it is the one that most needs its numbers.
    signals,
    families: familiesOf(signals),
    // Additive, and never a substitute for the fields above: every existing
    // caller destructures what it already destructured. A refusal publishes the
    // reason and no signal, which is the shape a surface can print without
    // first asking whether a class was assigned.
    evidence: evidenceRecord({ category: UNCLASSIFIED_CATEGORY, confidence: 0, reason }),
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
  const signals = signalRows(matched);
  // The rule that carried the decision: the first, in declaration order, that
  // voted for the winning category. Declaration order and not match order, so
  // the published pattern id does not depend on where in the excerpt a phrase
  // happened to appear.
  const decidingRule = QUERY_CLASSIFICATION_RULES.find(
    (rule) => matched.includes(rule.id) && rule.category === category,
  );
  return Object.freeze({
    category,
    classified: true,
    confidence,
    reason: null,
    nearestCategory: category,
    matchedRuleIds: Object.freeze(matched),
    signals,
    families: familiesOf(signals),
    evidence: evidenceRecord({
      category,
      signal: decidingRule ? matchedSignal(decidingRule, text) : null,
      patternId: decidingRule?.id ?? null,
      confidence,
    }),
  });
}

// ---------------------------------------------------------------------------
// The structural families, over a whole thread.
// ---------------------------------------------------------------------------

/**
 * THE RECORD THIS READS. One normalized thread, in the turn vocabulary this
 * repository already uses for a conversation — `{ turns: [{ role, body }],
 * model }`, the same shape `classifyConversation` in
 * `prompt-prose-classification.js` is handed. `role` is `"user"` or anything
 * else, and only `"user"` turns are read for content; the rest are read for
 * their position, which is what makes a follow-up a follow-up.
 *
 * PURE, AND IN MEMORY ONLY. No clock, no randomness, no network, no storage.
 * Bodies are read inside these functions and dropped when they return; nothing
 * derived from one leaves except an integer, a bucket id, and names this
 * repository authored.
 */
function userTurns(turns) {
  return turns.filter((turn) => turn && turn.role === "user" && typeof turn.body === "string");
}

/**
 * `thread-repeat`: did the requester come back after being answered?
 *
 * Counted from roles alone. A user turn that appears after any assistant turn
 * is a follow-up, which this rubric reads as rework on the same task — the
 * assumption is stated on `THREAD_REPEAT_WEIGHT` and a director who thinks
 * follow-ups are healthy iteration can dispute exactly that sentence.
 */
function threadRepeatSignals(turns) {
  let answered = false;
  let followUps = 0;
  for (const turn of turns) {
    if (!turn) continue;
    if (turn.role === "user") {
      if (answered) followUps += 1;
    } else {
      answered = true;
    }
  }
  const ids = [];
  if (followUps >= 1) ids.push("thread-repeat-followup");
  if (followUps >= THREAD_REPEAT_SUSTAINED_TURNS) ids.push("thread-repeat-sustained");
  return { ids, followUps };
}

/** `turn-depth`: which declared bucket the thread's length falls in. */
function depthBucketFor(turnCount) {
  return TURN_DEPTH_BUCKETS.find(
    (bucket) => bucket.maxTurns === null || turnCount <= bucket.maxTurns,
  );
}

/**
 * The structural measurements, summed over user turns.
 *
 * Every field is a count produced by `segmentPromptBody`, which is the same
 * segmenter the prose classifier uses — so "this thread has two code blocks"
 * means the same thing in both places, and a disagreement between the two
 * surfaces cannot come from two different definitions of a code block.
 */
function threadStructure(turns) {
  const totals = { chars: 0, codeBlocks: 0, labelledLines: 0, listLines: 0 };
  for (const turn of userTurns(turns)) {
    const { signals } = segmentPromptBody(turn.body);
    totals.chars += signals.totalChars;
    totals.codeBlocks += signals.codeBlocks;
    totals.labelledLines += signals.labelledLines;
    totals.listLines += signals.listLines;
  }
  return totals;
}

/**
 * `complexity-vs-tier`: three structural points, against the tier that ran it.
 *
 * The points are turn count, total prompt characters, and the presence of a
 * fenced block — none of which requires reading a word. Zero points on a
 * premium model is the over-provisioning claim; the substantive threshold or
 * more on a premium model is the earned-it claim. On a non-premium tier this
 * family abstains entirely, for the same reason the keyword tier rule does:
 * complexity is only over- or under-provisioned relative to what ran it.
 */
/** The one tier this family reads, named rather than spelled twice. Anya's vocabulary. */
const PREMIUM_TIER = "premium";

function complexitySignals(turnCount, structure, tier) {
  const points = (turnCount >= COMPLEXITY_TURN_COUNT ? 1 : 0)
    + (structure.chars >= COMPLEXITY_PROMPT_CHARS ? 1 : 0)
    + (structure.codeBlocks >= COMPLEXITY_CODE_BLOCKS ? 1 : 0);
  // Scoring no points is not the same as being trivial: a 500-character request
  // with three labelled lines scores none of the three and is plainly not it.
  // So the over-provisioning claim asks for the shape as well as the score.
  const trivial = points === 0 && turnCount === 1
    && structure.chars <= TRIVIAL_PROMPT_CHARS
    && structure.labelledLines === 0 && structure.listLines === 0;
  const ids = [];
  if (tier === PREMIUM_TIER) {
    if (trivial) ids.push("complexity-under-tier");
    else if (points >= COMPLEXITY_POINTS_FOR_SUBSTANTIVE) ids.push("complexity-matched-tier");
  }
  return { ids, points };
}

/**
 * `language-independent`: structure a reader can see without reading English.
 *
 * Labelled lines and enumerated lines are counted by shape, so a request
 * written in Japanese or German fires them exactly as an English one does.
 * This family is why a non-English record is classified rather than dropped:
 * the keyword table abstains on it and these two signals do not.
 */
function languageIndependentSignals(structure) {
  const ids = [];
  if (structure.labelledLines >= LABELLED_LINES_MIN) ids.push("language-independent-labelled");
  if (structure.listLines >= LIST_LINES_MIN) ids.push("language-independent-enumerated");
  return ids;
}

/** The keyword family over a thread: each rule counted once, however often it recurs. */
function keywordSignals(turns, tier) {
  const ids = [];
  for (const turn of userTurns(turns)) {
    const text = turn.body.toLowerCase();
    for (const rule of QUERY_CLASSIFICATION_RULES) {
      if (rule.requiresModelTier && rule.requiresModelTier !== tier) continue;
      if (ids.includes(rule.id) || !rule.pattern.test(text)) continue;
      ids.push(rule.id);
    }
  }
  // Declaration order, not the order the turns happened to match in, so two
  // orderings of the same thread serialize identically.
  return QUERY_SIGNAL_DECLARATIONS.filter((entry) => ids.includes(entry.id))
    .map((entry) => entry.id);
}

function threadUnclassified(reason, category, ids, extra) {
  return Object.freeze({ ...unclassified(reason, category, ids), ...extra });
}

/**
 * Classify one normalized thread on structural evidence.
 *
 * @param {{turns?: Array<{role?: string, body?: string}>, model?: string}} record
 *   an in-memory thread. Neither the bodies nor anything built from them is
 *   retained, transmitted, or stored.
 * @returns {object} frozen. The class, the confidence, and `signals`: one row
 *   per contributing signal carrying its family, its id, the class it voted
 *   for, and its integer weight. `families` lists the distinct families in
 *   declaration order. A record whose winning class falls under
 *   `MINIMUM_CLASSIFICATION_CONFIDENCE` is `unclassified` and still publishes
 *   the signals that were not enough.
 */
export function classifyThread({ turns, model } = {}) {
  const list = Array.isArray(turns) ? turns : [];
  const depth = depthBucketFor(list.length);
  const base = {
    version: QUERY_SIGNAL_FAMILIES_VERSION,
    turnCount: list.length,
    depthBucket: depth.id,
  };
  if (!list.length) {
    return threadUnclassified(UNCLASSIFIED_REASONS.noTurns, null, [], base);
  }
  if (!userTurns(list).length) {
    return threadUnclassified(UNCLASSIFIED_REASONS.noUserTurn, null, [], base);
  }

  const tier = classifyModelTier(model);
  const structure = threadStructure(list);
  const repeat = threadRepeatSignals(list);
  const complexity = complexitySignals(list.length, structure, tier);
  // Family order is fixed here, and every id below is a declared one, so the
  // rows a result publishes are in the same order on every machine and every
  // run. This is the whole of the determinism claim the corpus test checks.
  const ids = [
    ...keywordSignals(list, tier),
    ...repeat.ids,
    ...(depth.signalId ? [depth.signalId] : []),
    ...complexity.ids,
    ...languageIndependentSignals(structure),
  ];
  const evidence = {
    ...base,
    modelTier: tier,
    followUpTurns: repeat.followUps,
    complexityPoints: complexity.points,
  };
  if (!ids.length) {
    return threadUnclassified(UNCLASSIFIED_REASONS.noSignal, null, [], evidence);
  }

  const signals = signalRows(ids);
  const weights = new Map();
  for (const row of signals) {
    weights.set(row.category, (weights.get(row.category) ?? 0) + row.weight);
  }
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  const [category, weight] = [...weights.entries()].sort((left, right) =>
    right[1] - left[1]
    || CATEGORY_PRECEDENCE.indexOf(left[0]) - CATEGORY_PRECEDENCE.indexOf(right[0]))[0];
  const confidence = roundShare(weight / total);
  if (confidence < MINIMUM_CLASSIFICATION_CONFIDENCE) {
    return threadUnclassified(UNCLASSIFIED_REASONS.belowConfidenceFloor, category, ids, evidence);
  }
  return Object.freeze({
    ...evidence,
    category,
    classified: true,
    confidence,
    reason: null,
    nearestCategory: category,
    matchedRuleIds: Object.freeze(signals.filter((row) => row.family === SIGNAL_FAMILY.keyword)
      .map((row) => row.signal)),
    signals,
    families: familiesOf(signals),
    // The winning class's weight and the whole weight cast, so the confidence
    // above is arithmetic a reader can repeat rather than a number to trust.
    weight,
    totalWeight: total,
    // The same evidence shape the excerpt classifier publishes, with `signal`
    // null: four of the five families here are counted from structure — turn
    // roles, character totals, fenced blocks — and there is no token to name.
    // The id of the signal that carried the class is named all the same.
    evidence: evidenceRecord({
      category,
      patternId: signals.find((row) => row.category === category)?.signal ?? null,
      confidence,
    }),
  });
}
