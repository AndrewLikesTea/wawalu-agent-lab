// Prompt-literacy scoring for real prose: a director's own conversation in,
// three dimension scores, a letter, and a disclosable reasons payload out.
//
// `query-classification.js` grades one short gateway-log excerpt into one
// rubric category. That is the right shape for a sampled excerpt and the wrong
// shape for what a director actually asks to be graded: four turns, half of one
// of them a stack trace, a third of another a pasted spreadsheet, and some of
// it not in English. This module is that second door. The two share the rubric
// they answer to; they do not share an input shape, and pretending otherwise is
// how a 4,000-character prompt would win a vote counted over one sentence.
//
// FOUR RULES, STATED ONCE HERE SO NOTHING BELOW HAS TO RE-ARGUE THEM.
//
//   1. Length cannot buy a score. Credit signals fire on *presence*, at most
//      once per turn, so restating "Context:" nine times is worth what saying
//      it once is worth. Debit signals fire on a *rate* per fixed window of
//      prose, so a 1,000-word request is not punished for one hedge and a
//      40-word request is not excused for three.
//   2. Code and pasted material are neither prose nor invisible. They are cut
//      out before any pattern runs and before any length is counted, and the
//      fact that they were there is itself a recorded signal.
//   3. A turn we cannot read in English is scored on structure and *said to be*
//      unreadable. It never becomes a silent zero and never becomes
//      unclassified for being in another language.
//   4. Aggregation happens in exactly one function. If a number in an executive
//      view came from combining turns, `aggregateTurnScores` made it.
//
// EXECUTION. Pure, synchronous, and dependency-free beyond the two local
// imports: no clock, no randomness, no network, no storage, no worker of its
// own. It runs wherever the import path already runs the excerpt classifier.
//
// PRIVACY. Same rule as the excerpt door, enforced the same way. Bodies are
// arguments; every result is built from an allowlist of numbers, booleans, and
// identifiers this module chose; there is no key at any depth a substring of a
// prompt could occupy, including in the reason codes and including in anything
// this module throws. It mirrors `conversation-export.js`, which turns a
// never-render prompt column into `prompt_chars` and has no field the body
// could survive in.

import { letterGradeForScore, PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";
import { classifyModelTier } from "./provider-usage-record.js";
import { segmentPromptBody } from "./prompt-prose-segmentation.js";
import { CATEGORY_PRECEDENCE, UNCLASSIFIED_CATEGORY } from "./query-classification.js";

/** Bump when a signal, weight, baseline, or the aggregation rule changes. */
export const PROSE_CLASSIFIER_VERSION = "prompt-prose-classifier/1.0.0";

/**
 * The window a debit rate is stated over: occurrences per 100 prose units.
 *
 * ASSUMPTION: 100 prose units is roughly one substantive paragraph — the
 * smallest span over which repeating yourself is evidence rather than noise.
 * Rates are quoted per window so signal strength is a property of the writing
 * and not of the word count. A "prose unit" is a word of a spaced script or two
 * characters of an unspaced one; see `prompt-prose-segmentation.js`.
 */
export const PROSE_RATE_WINDOW_UNITS = 100;

/**
 * The smallest denominator a rate may be computed against.
 *
 * ASSUMPTION: without a floor, a six-word turn containing one hedge reports
 * 16.7 hedges per 100 units and takes the full debit for a single word.
 * Twenty-five units is about two sentences; below that there is not enough
 * prose for a rate to mean anything, so the rate is stated as if there were.
 */
export const MINIMUM_RATE_DENOMINATOR_UNITS = 25;

/**
 * The rate, per window, at which a debit signal reaches its full weight.
 *
 * ASSUMPTION: twice in a paragraph is a habit; once is a word choice. Strength
 * is `min(1, rate / 2)`, so one hedge per 100 units costs half the weight and
 * three cost the same as two. The cap exists so no dimension can be driven to
 * zero by one signal repeated.
 */
export const RATE_SATURATION_PER_WINDOW = 2;

/**
 * Prose units at or above which a turn counts as substantive work, and at or
 * below which it counts as a mechanical errand.
 *
 * ASSUMPTION: length is the only evidence of substance that survives
 * translation, so the model-fit signals lean on it rather than on English
 * vocabulary. 150 units is a page-ish request; 60 is a paragraph or less.
 * Between them the model-fit signals abstain, which is the intended shape: a
 * routing call we cannot evidence is not a routing call we report.
 */
export const SUBSTANTIVE_PROSE_UNITS = 150;
export const TRIVIAL_PROSE_UNITS = 60;

/**
 * Where each dimension starts before any signal fires.
 *
 * ASSUMPTION, intent (40): a request that states nothing is a coaching gap, not
 * leakage, so it starts in the middle of the failing band rather than at the
 * bottom of the scale. Intent is the only dimension a person moves by
 * rewriting, so it is the only one that is mostly *earned*.
 *
 * ASSUMPTION, efficiency (85): the first time you ask for something, you are
 * efficient. Efficiency is lost to observable evidence of a re-prompt spiral
 * and is never earned, because no prompt can prove it would not have needed a
 * second turn. 85 is the middle of the B band — the benefit of the doubt, not
 * full marks.
 *
 * ASSUMPTION, model fit (80): routing is presumed adequate for the same reason.
 * It is lost to an observable mismatch and earned back only in the one case we
 * can evidence: substantial work on a premium model.
 */
export const DIMENSION_BASELINES = Object.freeze({
  intent: 40, efficiency: 85, modelFit: 80,
});

/**
 * The intent baseline used when the vocabulary table cannot read the turn.
 *
 * ASSUMPTION: when we cannot read a turn we may not credit it for stating its
 * context, and we may not debit it for failing to. 58 is the top of the D band
 * — a published statement that the grader could not read this request, sitting
 * deliberately below any score structure alone can reach. Layout signals still
 * apply, so an organised request in any language can climb out of it.
 */
export const LANGUAGE_AGNOSTIC_INTENT_BASE = 58;

/**
 * Every assumption a weight rests on, as a stable key. The reasons payload
 * carries the key; a surface that wants the sentence looks it up here. Static
 * strings — never generated, never derived from a prompt.
 */
export const SIGNAL_ASSUMPTIONS = Object.freeze({
  statesContext: "A request that supplies its own setting is the first of the three "
    + "things the rubric's intent axis asks for. Weighted equally with the other two "
    + "because the rubric names no order among them.",
  statesConstraints: "A request that states its boundaries. Equal weight with context "
    + "and acceptance, for the same reason.",
  statesAcceptance: "A request that says what a correct answer is. Equal weight; three "
    + "of three carries intent from the baseline to the top of the scale.",
  structuredLayout: "Labelled sections or a numbered list show the request was "
    + "organised into parts. Layout survives translation where vocabulary does not, so "
    + "this is the signal that lets a non-English request reach a good intent score.",
  pastedContextSupplied: "Pasting the corpus is supplying context by other means. "
    + "Worth less than saying what the context is for, because the reader still has to "
    + "infer the question from the material.",
  vagueRequest: "Hedges and placeholder nouns leave the model to choose what was "
    + "meant. Debited at a rate, not a count, so a long request is not punished for "
    + "containing the word 'something' once.",
  outOfScopeVocabulary: "Personal-life and entertainment vocabulary. Weighted heavily "
    + "enough to take intent to zero on its own, because leakage that is well written "
    + "is still leakage and must not carry credit into a team's grade.",
  repeatedRequest: "The re-prompt spiral in its own words: the requester is restating "
    + "a question the previous turn did not answer. The cost is the extra call.",
  correctedRequest: "A correction turn. Same weight as a repeat, because the spend is "
    + "the same and which of the two happened is not the requester's to argue.",
  scatteredQuestions: "Four or more questions inside a short turn produce one answer "
    + "that addresses none of them fully. Small weight: it is a style, not a spiral.",
  trivialOnPremium: "A mechanical edit sent to a premium model, and only when the turn "
    + "is short enough that the edit *is* the request. This is the routing error the "
    + "model-fit axis exists to name, so it is the largest single debit on the axis.",
  substantiveOnEconomy: "Substantial work asked of an economy model. Weighted well "
    + "below the premium-for-trivia case because under-provisioning costs quality, "
    + "which the requester absorbs, rather than money, which the company does.",
  substantiveOnPremium: "Substantial work on a premium model is the routing decision "
    + "the rubric calls full marks. Credited only on observable length, never assumed, "
    + "because an unevidenced credit is exactly the number a director is right to "
    + "dispute.",
  aggregation: "See AGGREGATION_ASSUMPTION.",
});

/**
 * THE PROSE SIGNAL TABLE. Read top to bottom; this is the whole rubric.
 *
 * `kind: "presence"` fires once or not at all and contributes its whole weight.
 * `kind: "rate"` contributes `weight x min(1, ratePerWindow / saturation)`.
 * `derived` reads segmentation counts instead of matching text, and a signal
 * with `derived` is language-agnostic by construction. `guard` lets a signal
 * abstain on evidence it does not have.
 *
 * NO SOURCE. These are phrasings and shapes this repository chose as proxies.
 * They are a judgement about how requests are written, not a measured
 * classifier, and a reader who disagrees with one can name the signal id.
 */
export const PROSE_SIGNALS = Object.freeze([
  Object.freeze({
    id: "intent-states-context", dimension: "intent", kind: "presence", weight: 18,
    assumptionKey: "statesContext",
    pattern: /(^|\W)(context:|background:|given the following|here is the|we are (currently )?(building|running|seeing)|i am working on)/,
  }),
  Object.freeze({
    id: "intent-states-constraints", dimension: "intent", kind: "presence", weight: 18,
    assumptionKey: "statesConstraints",
    pattern: /(^|\W)(constraints?:|requirements?:|must not|do not use|limit(ed)? to|without changing)/,
  }),
  Object.freeze({
    id: "intent-states-acceptance", dimension: "intent", kind: "presence", weight: 18,
    assumptionKey: "statesAcceptance",
    pattern: /(^|\W)(acceptance criteria|expected output|success looks like|definition of done|the answer should|return (exactly|only))/,
  }),
  Object.freeze({
    id: "intent-structured-layout", dimension: "intent", kind: "presence", weight: 18,
    assumptionKey: "structuredLayout", languageAgnostic: true,
    derived: (segments) => (segments.labelledLines >= 2 || segments.listLines >= 2 ? 1 : 0),
  }),
  Object.freeze({
    id: "intent-pasted-context", dimension: "intent", kind: "presence", weight: 8,
    assumptionKey: "pastedContextSupplied", languageAgnostic: true,
    derived: (segments) => (segments.pastedBlocks > 0 ? 1 : 0),
  }),
  Object.freeze({
    id: "intent-vague-request", dimension: "intent", kind: "rate", weight: -12,
    assumptionKey: "vagueRequest",
    pattern: /\b(something|somehow|whatever|make it better|improve this|fix it|as needed|etc)\b/g,
  }),
  Object.freeze({
    id: "intent-out-of-scope", dimension: "intent", kind: "presence", weight: -40,
    assumptionKey: "outOfScopeVocabulary",
    pattern: /\b(recipe|birthday|vacation|horoscope|lyrics|wedding|dating|fantasy football|write me a poem|tell me a joke|short story|movie recommendation)\b/,
  }),
  Object.freeze({
    id: "efficiency-repeated-request", dimension: "efficiency", kind: "rate", weight: -35,
    assumptionKey: "repeatedRequest",
    pattern: /\b(try again|one more time|still (not|does ?n'?t)|as i (said|asked)|again,? please)\b/g,
  }),
  Object.freeze({
    id: "efficiency-corrected-request", dimension: "efficiency", kind: "rate", weight: -35,
    assumptionKey: "correctedRequest",
    pattern: /\b(no,? i meant|that'?s not what i|you (said|gave) that already|wrong answer|not what i asked)\b/g,
  }),
  Object.freeze({
    id: "efficiency-scattered-questions", dimension: "efficiency", kind: "presence", weight: -10,
    assumptionKey: "scatteredQuestions", languageAgnostic: true,
    derived: (segments) => (segments.questionMarks >= 4 && segments.proseUnits < 120 ? 1 : 0),
  }),
  Object.freeze({
    id: "model-fit-trivial-on-premium", dimension: "modelFit", kind: "presence", weight: -60,
    assumptionKey: "trivialOnPremium", requiresModelTier: "premium",
    guard: (segments) => segments.proseUnits <= TRIVIAL_PROSE_UNITS,
    pattern: /\b(rename|fix (the |a )?typo|capitali[sz]e|reformat|spell ?check|convert this to (json|csv|yaml)|make this uppercase)\b/,
  }),
  Object.freeze({
    id: "model-fit-substantive-on-economy", dimension: "modelFit", kind: "presence", weight: -25,
    assumptionKey: "substantiveOnEconomy", requiresModelTier: "economy", languageAgnostic: true,
    derived: (segments) => (segments.proseUnits >= SUBSTANTIVE_PROSE_UNITS
      || segments.codeChars >= 800 ? 1 : 0),
  }),
  Object.freeze({
    id: "model-fit-substantive-on-premium", dimension: "modelFit", kind: "presence", weight: 20,
    assumptionKey: "substantiveOnPremium", requiresModelTier: "premium", languageAgnostic: true,
    derived: (segments) => (segments.proseUnits >= SUBSTANTIVE_PROSE_UNITS ? 1 : 0),
  }),
]);

/** The rubric's three axes, in the rubric's own order. Never restated by hand. */
export const DIMENSION_KEYS = Object.freeze(PROMPT_LITERACY_RUBRIC.axes.map((axis) => axis.key));

for (const signal of PROSE_SIGNALS) {
  if (!DIMENSION_KEYS.includes(signal.dimension)) {
    throw new RangeError(`prose classifier: ${signal.id} names no rubric axis`);
  }
  if (!SIGNAL_ASSUMPTIONS[signal.assumptionKey]) {
    throw new RangeError(`prose classifier: ${signal.id} states no assumption`);
  }
}

/** Turn-level reason codes. Machine-readable; never assembled for display. */
export const TURN_REASON_CODES = Object.freeze({
  notAUserTurn: "not_a_user_turn",
  noProse: "no_prose",
  languageUncertain: "language_uncertain",
  languageMixed: "language_mixed",
  codeHeavy: "code_heavy",
  pasteHeavy: "paste_heavy",
});

/** Conversation-level refusals. A conversation with one of these has no grade. */
export const CONVERSATION_REASON_CODES = Object.freeze({
  noTurns: "no_turns",
  noScorableTurn: "no_scorable_turn",
});

/**
 * THE SHAPE OF A REASONS PAYLOAD, declared rather than described because two
 * consumers — the disclosure UI and the fixture corpus — both depend on it.
 *
 * Every leaf is a number, a boolean, a null, or an identifier this module chose
 * from a closed set. There is no string field a caller supplies and no field
 * derived from prompt text at any depth. That is the whole point of the shape,
 * and it is asserted rather than promised in the corpus test.
 */
export const PROSE_REASONS_SCHEMA = Object.freeze({
  version: "string, equal to PROSE_CLASSIFIER_VERSION",
  turns: "array of Turn",
  Turn: "{ index:int, role:'user'|'other', scored:bool, "
    + "reasonCodes:string[] drawn from TURN_REASON_CODES, modelTier:string, "
    + "segments:Segments, dimensions:{ [axis]:Dimension }|null, category:string }",
  Segments: "{ totalChars, proseChars, proseUnits, proseLines, codeBlocks, codeChars, "
    + "pastedBlocks, pastedChars, labelledLines, listLines, questionMarks, letters, "
    + "nonLatinLetters, nonLatinLetterShare, dominantNonLatinScript, "
    + "languageUncertain, languageMixed } — numbers, booleans, and one script id",
  Dimension: "{ baseline:number, score:number, signals:Signal[] }",
  Signal: "{ id, dimension, kind:'presence'|'rate', weight:number, occurrences:int, "
    + "ratePerWindow:number|null, strength:number, contribution:number, assumptionKey }",
  aggregation: "{ rule, assumptionKey, weightFloor, turnWeights:number[], "
    + "dimensions:{ [axis]:number }, composite:number, grade:string }|null",
  guarantee: "No field, at any depth, carries prompt text, a matched substring, a "
    + "filename read out of a prompt, or anything from which one could be rebuilt.",
});

const SUBSCORE_DECIMALS = PROMPT_LITERACY_RUBRIC.reporting.subscoreDecimals;
const CONTRIBUTION_DECIMALS = PROMPT_LITERACY_RUBRIC.reporting.contributionDecimals;

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const clampScore = (value) => Math.min(100, Math.max(0, value));

/**
 * May this signal read this turn?
 *
 * A derived or language-agnostic signal always may: it reads counts, and a
 * count means the same thing in every script. A vocabulary signal may not read
 * a turn the script check flagged — with one deliberate asymmetry. In a *mixed*
 * turn there is still Latin prose, so a vocabulary signal that matched is real
 * evidence, while a vocabulary signal that did not match is not evidence of
 * absence. Credits therefore still fire in a mixed turn and debits do not.
 */
function signalIsEligible(signal, segments) {
  if (signal.languageAgnostic || signal.derived) return true;
  if (!segments.languageUncertain) return true;
  return segments.languageMixed && signal.weight > 0;
}

function occurrencesOf(signal, proseText, segments) {
  if (signal.derived) return signal.derived(segments);
  if (!signal.pattern) return 0;
  if (signal.kind === "rate") return (proseText.match(signal.pattern) ?? []).length;
  return signal.pattern.test(proseText) ? 1 : 0;
}

/** One signal's reading of one turn, or null when it abstained or did not fire. */
function evaluateSignal(signal, { proseText, segments, modelTier }) {
  if (signal.requiresModelTier && signal.requiresModelTier !== modelTier) return null;
  if (signal.guard && !signal.guard(segments)) return null;
  if (!signalIsEligible(signal, segments)) return null;
  const occurrences = occurrencesOf(signal, proseText, segments);
  if (occurrences <= 0) return null;
  let ratePerWindow = null;
  let strength = 1;
  if (signal.kind === "rate") {
    const denominator = Math.max(segments.proseUnits, MINIMUM_RATE_DENOMINATOR_UNITS);
    ratePerWindow = roundTo((occurrences / denominator) * PROSE_RATE_WINDOW_UNITS,
      CONTRIBUTION_DECIMALS);
    strength = roundTo(Math.min(1, ratePerWindow / RATE_SATURATION_PER_WINDOW),
      CONTRIBUTION_DECIMALS);
  }
  return Object.freeze({
    id: signal.id,
    dimension: signal.dimension,
    kind: signal.kind,
    weight: signal.weight,
    occurrences,
    ratePerWindow,
    strength,
    contribution: roundTo(signal.weight * strength, CONTRIBUTION_DECIMALS),
    assumptionKey: signal.assumptionKey,
  });
}

function reasonCodesFor(segments) {
  const codes = [];
  if (segments.languageUncertain) codes.push(TURN_REASON_CODES.languageUncertain);
  if (segments.languageMixed) codes.push(TURN_REASON_CODES.languageMixed);
  // Reported, never acted on. A turn that is mostly code or mostly paste is
  // still graded on the prose it has; these codes exist so a director reading a
  // low intent score can see that most of what they sent was not prose.
  if (segments.codeChars > segments.proseChars) codes.push(TURN_REASON_CODES.codeHeavy);
  if (segments.pastedChars > segments.proseChars) codes.push(TURN_REASON_CODES.pasteHeavy);
  return codes;
}

/**
 * The bands that turn three scores into one of the rubric's four category
 * names. Read worst-outcome first, in `CATEGORY_PRECEDENCE` order, so an
 * ambiguous turn is never described as the better of its readings.
 *
 * ASSUMPTION: these are labels derived from the scores, never inputs to them.
 * The scores are the published number; the category exists so a prose-scored
 * turn can be named in the same four words the record-count rubric already
 * uses. A turn that lands in none of the four bands is named unclassified
 * rather than pushed into the nearest one — the rubric has four categories, and
 * a competent request that stated no context is genuinely not one of them. Note
 * that this does not make the turn unscored: it has three scores and a letter.
 */
export const CATEGORY_BANDS = Object.freeze({
  outOfScopeIntentAtOrBelow: 0,
  inefficientEfficiencyBelow: 50,
  overProvisionedModelFitBelow: 50,
  highValueIntentAtOrAbove: 70,
});

function deriveTurnCategory(dimensions) {
  if (dimensions.intent.score <= CATEGORY_BANDS.outOfScopeIntentAtOrBelow) return "outOfScope";
  if (dimensions.efficiency.score < CATEGORY_BANDS.inefficientEfficiencyBelow) return "inefficient";
  if (dimensions.modelFit.score < CATEGORY_BANDS.overProvisionedModelFitBelow) {
    return "overProvisioned";
  }
  if (dimensions.intent.score >= CATEGORY_BANDS.highValueIntentAtOrAbove) return "highValue";
  return UNCLASSIFIED_CATEGORY;
}

/**
 * Score one turn.
 *
 * @param {{body?: string, role?: string, model?: string}} turn one turn in the
 *   vocabulary of a conversation export. The body is untrusted and is never
 *   retained, published, or copied into any field of the result.
 * @param {{index?: number, model?: string}} [options] position in the
 *   conversation and the conversation-level model to fall back to.
 * @returns {object} frozen. `scored` is false only when there is nothing to
 *   read — a non-user turn, or a turn with no prose left once code and pasted
 *   material are removed. A turn in another language is always scored.
 */
export function classifyPromptTurn(turn = {}, { index = 0, model: fallbackModel } = {}) {
  const rawRole = turn?.role === undefined || turn?.role === null ? "user" : String(turn.role);
  const isUser = ["user", "human", "requester"].includes(rawRole.trim().toLowerCase());
  const modelTier = classifyModelTier(turn?.model ?? fallbackModel);
  const { proseText, signals: segments } = segmentPromptBody(turn?.body);
  const unscored = (code) => Object.freeze({
    index,
    role: isUser ? "user" : "other",
    scored: false,
    reasonCodes: Object.freeze([code, ...reasonCodesFor(segments)]),
    modelTier,
    segments,
    dimensions: null,
    category: UNCLASSIFIED_CATEGORY,
  });
  if (!isUser) return unscored(TURN_REASON_CODES.notAUserTurn);
  if (segments.proseUnits === 0) return unscored(TURN_REASON_CODES.noProse);

  const context = { proseText: proseText.toLowerCase(), segments, modelTier };
  const dimensions = {};
  for (const axis of DIMENSION_KEYS) {
    const baseline = axis === "intent" && segments.languageUncertain
      ? LANGUAGE_AGNOSTIC_INTENT_BASE
      : DIMENSION_BASELINES[axis];
    const fired = PROSE_SIGNALS
      .filter((signal) => signal.dimension === axis)
      .map((signal) => evaluateSignal(signal, context))
      .filter(Boolean);
    dimensions[axis] = Object.freeze({
      baseline,
      score: roundTo(clampScore(
        fired.reduce((sum, signal) => sum + signal.contribution, baseline),
      ), SUBSCORE_DECIMALS),
      signals: Object.freeze(fired),
    });
  }
  return Object.freeze({
    index,
    role: "user",
    scored: true,
    reasonCodes: Object.freeze(reasonCodesFor(segments)),
    modelTier,
    segments,
    dimensions: Object.freeze(dimensions),
    category: deriveTurnCategory(dimensions),
  });
}

/**
 * The weight floor a turn cannot fall below when turns are averaged.
 *
 * ASSUMPTION: a terse "try again" is exactly the evidence the efficiency axis
 * exists to catch, so it must not be weightless. Twenty prose units is about
 * one sentence — the smallest turn we are willing to let count as a turn.
 */
export const CONVERSATION_TURN_WEIGHT_FLOOR = 20;

/** The id the reasons payload carries so a reader can look the rule up. */
export const AGGREGATION_RULE_ID = "prose-length-weighted-mean/1";

export const AGGREGATION_ASSUMPTION = "A conversation score is the prose-length-weighted "
  + "mean of its scored turn scores, each turn weighted by its prose units floored at "
  + `${CONVERSATION_TURN_WEIGHT_FLOOR}. We weight by prose length because a one-line `
  + "follow-up should not outvote the substantive opening turn that set up the work. We "
  + "floor the weight because a one-line follow-up is still a turn, and the shortest "
  + "turns are the ones the efficiency axis is looking for. A mean and not a worst-of, "
  + "because one bad turn inside a productive conversation is a moment rather than a "
  + "grade; a mean and not a best-of, because a grade that reports your best turn is not "
  + "a grade. The consequence, stated rather than hidden: a long, well-formed opening "
  + "turn can carry several sloppy follow-ups, and a director who thinks that is wrong "
  + "is arguing with this sentence rather than with an unexplainable number.";

/**
 * THE ONLY PLACE TURNS ARE COMBINED.
 *
 * Nothing else in this repository may average, floor, or best-of a turn score.
 * If a number in an executive view came from more than one turn, it came from
 * here, and the sentence above is the whole of why it is that number.
 *
 * @param {object[]} turns results from `classifyPromptTurn`. Unscored turns are
 *   ignored: a turn we could not read is evidence in neither direction, and
 *   that decision is stated here rather than in three call sites.
 * @returns {object|null} frozen dimension means, composite and grade, or null
 *   when no turn was scorable.
 */
export function aggregateTurnScores(turns = []) {
  const scored = (Array.isArray(turns) ? turns : []).filter((turn) => turn?.scored);
  if (!scored.length) return null;
  const weights = scored.map((turn) =>
    Math.max(turn.segments.proseUnits, CONVERSATION_TURN_WEIGHT_FLOOR));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  // One unrounded weighted mean per axis, reused by both the reported subscore
  // and the composite, so the headline is never computed from a rounded part.
  const means = Object.fromEntries(DIMENSION_KEYS.map((axis) => [axis, scored.reduce(
    (sum, turn, at) => sum + turn.dimensions[axis].score * weights[at], 0,
  ) / total]));
  const composite = roundTo(
    PROMPT_LITERACY_RUBRIC.axes.reduce(
      (sum, axis) => sum + axis.weightPercent * means[axis.key], 0,
    ) / 100,
    PROMPT_LITERACY_RUBRIC.reporting.compositeDecimals,
  );
  return Object.freeze({
    rule: AGGREGATION_RULE_ID,
    assumptionKey: "aggregation",
    weightFloor: CONVERSATION_TURN_WEIGHT_FLOOR,
    turnWeights: Object.freeze(weights),
    dimensions: Object.freeze(Object.fromEntries(
      DIMENSION_KEYS.map((axis) => [axis, roundTo(means[axis], SUBSCORE_DECIMALS)]),
    )),
    composite,
    grade: letterGradeForScore(composite),
  });
}

const RUBRIC_VERSION_ID =
  `${PROMPT_LITERACY_RUBRIC.rubricId}/${PROMPT_LITERACY_RUBRIC.rubricVersion}`;

function conversationRefusal(code, turns) {
  return Object.freeze({
    version: PROSE_CLASSIFIER_VERSION,
    rubricVersionId: RUBRIC_VERSION_ID,
    scored: false,
    reason: code,
    category: UNCLASSIFIED_CATEGORY,
    dimensions: null,
    composite: null,
    grade: null,
    reasons: Object.freeze({
      version: PROSE_CLASSIFIER_VERSION,
      turns: Object.freeze(turns),
      aggregation: null,
    }),
  });
}

/**
 * Score a whole conversation.
 *
 * @param {{turns?: object[], model?: string}} conversation turns in the
 *   vocabulary of the conversation export: an ordered list, each with a `role`,
 *   a `body`, and optionally its own `model`. See `docs/prompt-prose-rubric.md`
 *   for why the body is supplied by the caller rather than read out of the
 *   export contract, which by design carries counts and never text.
 * @returns {object} frozen. Scores, a letter, and a reasons payload of numbers,
 *   booleans, and identifiers. No prompt text, at any depth.
 */
export function classifyConversation({ turns, model } = {}) {
  const list = Array.isArray(turns) ? turns : [];
  if (!list.length) return conversationRefusal(CONVERSATION_REASON_CODES.noTurns, []);
  const scoredTurns = list.map((turn, index) => classifyPromptTurn(turn, { index, model }));
  const aggregate = aggregateTurnScores(scoredTurns);
  if (!aggregate) {
    return conversationRefusal(CONVERSATION_REASON_CODES.noScorableTurn, scoredTurns);
  }
  // The conversation's category is the worst reading any scored turn produced,
  // in the same precedence order a tied excerpt uses. Deliberately not averaged:
  // a category is a name, and averaging names is how one leaked prompt in eight
  // becomes invisible.
  const named = scoredTurns.filter((turn) => turn.scored).map((turn) => turn.category);
  return Object.freeze({
    version: PROSE_CLASSIFIER_VERSION,
    rubricVersionId: RUBRIC_VERSION_ID,
    scored: true,
    reason: null,
    category: CATEGORY_PRECEDENCE.find((key) => named.includes(key)) ?? UNCLASSIFIED_CATEGORY,
    dimensions: aggregate.dimensions,
    composite: aggregate.composite,
    grade: aggregate.grade,
    reasons: Object.freeze({
      version: PROSE_CLASSIFIER_VERSION,
      turns: Object.freeze(scoredTurns),
      aggregation: aggregate,
    }),
  });
}

/**
 * Coverage over a corpus: the share of user turns the classifier could not
 * grade at all.
 *
 * A regression that quietly stops reading real prose shows up as prompts
 * falling out of `scored`, and it shows up nowhere else — the scores that
 * remain still look fine. This is the number that stops that being invisible.
 * Counted over *user* turns only: an assistant turn was never a prompt, and
 * counting it would dilute the rate toward whatever shape the transcript has.
 *
 * @param {object[]} conversations results from `classifyConversation`.
 * @returns {{turns:number, unclassifiedTurns:number, unclassifiedRate:number}}
 */
export function promptCorpusCoverage(conversations = []) {
  let turns = 0;
  let unclassifiedTurns = 0;
  for (const conversation of conversations) {
    for (const turn of conversation?.reasons?.turns ?? []) {
      if (turn.role !== "user") continue;
      turns += 1;
      if (!turn.scored) unclassifiedTurns += 1;
    }
  }
  return Object.freeze({
    turns,
    unclassifiedTurns,
    unclassifiedRate: turns === 0
      ? 0
      : roundTo(unclassifiedTurns / turns, PROMPT_LITERACY_RUBRIC.reporting.shareDecimals),
  });
}
