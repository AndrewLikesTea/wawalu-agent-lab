// Sampling a classified corpus for human review, and re-grading it when a human
// disagrees with the classifier.
//
// Two functions: hand a FinOps lead a bounded set of rows worth checking, and
// move the published headline when they correct one. Neither reads a clock, a
// random source, storage, or the network; neither mutates its input; and neither
// invents arithmetic — the letter, the coverage share and the recoverable
// dollars come from the modules the import path already publishes them from
// (`imported-corpus-grade.js` and `evolution.js`).
//
// WHY A SEEDED SAMPLE AND NOT A SLICE. The first N rows of an export are the
// first N rows of one team's morning. Stratifying is the only way to hand a
// reviewer the rows that most need a human — the unclassified and the barely
// decided — without letting file order pick them. And determinism is a
// requirement, not a nicety: a reviewer who labels 40 rows and comes back has to
// be handed the same 40, or their labels describe a sample that no longer
// exists. Same records plus same seed yields a byte-identical ordered sample on
// any machine, and — because every score is derived from the row's own stable
// key rather than its position — under any ordering of the input.

import { gradeImportedCorpus } from "./imported-corpus-grade.js";
import { QUERY_CATEGORIES, categorySpendUsd, recoverableSpendUsd } from "./evolution.js";
import { MINIMUM_CLASSIFICATION_CONFIDENCE } from "./query-classification.js";

/** Bump when a stratum weight, the seed, or the returned shape changes meaning. */
export const QUERY_OVERRIDE_MODEL_VERSION = "query-label-overrides/1.0.0";

/**
 * The sampling seed, fixed in source rather than chosen by a surface: two runs
 * of this page over one file have to agree, and a seed the surface picks is a
 * seed it can fail to persist. Callers may pass one for testing; the page does not.
 */
export const SAMPLE_SEED = 0x51_7d_2b_09;

/** How many rows a review pass hands a human, unless the caller says otherwise. */
export const DEFAULT_SAMPLE_SIZE = 40;

export const STRATUM = Object.freeze({
  unclassified: "unclassified", lowConfidence: "low_confidence", confident: "confident",
});

/**
 * Relative selection odds per row, not shares: an unclassified row is six times
 * as likely to be drawn as a confidently classified one at equal counts. The
 * ratio states where a human's attention is worth most — a row the classifier
 * refused, and a row it decided by one vote, are the two the published letter is
 * least entitled to. A reader who disagrees disputes three integers.
 */
export const STRATUM_WEIGHT = Object.freeze({
  [STRATUM.unclassified]: 6,
  [STRATUM.lowConfidence]: 3,
  [STRATUM.confident]: 1,
});

/**
 * The confidence at or above which a classified row counts as confident.
 *
 * Derived, not invented: the classifier's floor is 0.6 and the next value its
 * keyword table can produce above a two-signal split is 0.75 — three votes
 * against one. A row under it was decided by a margin one more matched rule
 * would have erased, which is exactly the row worth showing a human.
 */
export const LOW_CONFIDENCE_CEILING = 0.75;

/** Keys an override map may never carry, whatever the restored workspace says. */
const FORBIDDEN_OVERRIDE_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

/**
 * The most override entries this module reads in one call. Past it the extra
 * keys are ignored and counted — a bounded refusal a caller can see, rather than
 * an unbounded loop it cannot.
 */
export const MAX_OVERRIDE_KEYS = 10_000;

const CATEGORY_KEYS = Object.freeze(QUERY_CATEGORIES.map((category) => category.key));

/**
 * The stable identity of a row, and the tie-break of last resort. A caller's own
 * `queryId` wins; otherwise the row's index is the identity, which is stable for
 * one parse of one file and is stated here rather than assumed — it is the
 * difference between an override that survives a reload and one that silently
 * relabels a different row.
 */
export function recordKey(record, index) {
  const declared = record?.queryId ?? record?.id;
  return typeof declared === "string" && declared ? declared : `row-${index}`;
}

/** Which stratum a row falls in. Unclassified first: a null category is not a low score. */
export function stratumOf(record) {
  const category = record?.category;
  if (typeof category !== "string" || !CATEGORY_KEYS.includes(category)) return STRATUM.unclassified;
  const confidence = Number(record?.confidence);
  // No confidence recorded is treated as confident rather than oversampled: that
  // category was declared by the file, not decided by a margin.
  if (!Number.isFinite(confidence)) return STRATUM.confident;
  if (confidence < MINIMUM_CLASSIFICATION_CONFIDENCE) return STRATUM.unclassified;
  return confidence < LOW_CONFIDENCE_CEILING ? STRATUM.lowConfidence : STRATUM.confident;
}

// FNV-1a over the row's stable key, mixed with the seed, then one mulberry32
// step to spread the low bits. Integer arithmetic only, so two engines agree bit
// for bit; keyed by the row rather than by draw order, so the nth row's score
// does not depend on what the first n-1 rows were.

const FNV_OFFSET_BASIS = 0x81_1c_9d_c5;
const FNV_PRIME = 0x01_00_01_93;
const UINT32 = 4_294_967_296;

function hashKey(seed, key) {
  let hash = (FNV_OFFSET_BASIS ^ (seed >>> 0)) >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash ^ key.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function unitFloat(hash) {
  let state = (hash + 0x6d_2b_79_f5) >>> 0;
  state = Math.imul(state ^ (state >>> 15), state | 1) >>> 0;
  state = (state ^ (state + Math.imul(state ^ (state >>> 7), state | 61))) >>> 0;
  return ((state ^ (state >>> 14)) >>> 0) / UINT32;
}

/**
 * Draw a deterministic stratified sample.
 *
 * Weighted sampling without replacement by exponential key: a row's score is
 * `u ** (1 / weight)` for a `u` derived only from the seed and the row's stable
 * key, and the highest scores are taken. A heavier stratum wins more often
 * without being guaranteed the sample, and reordering the input reorders nothing.
 *
 * @param records already-parsed rows: `{ category, confidence, ... }`. Read for
 *   nothing else, not mutated, not retained.
 * @param options `{ size, seed }`, both bounded here rather than trusted.
 * @returns frozen `{ version, seed, size, rows, strata }` — the drawn rows in
 *   draw order with their key, index and stratum, and the corpus and drawn count
 *   per stratum so the oversampling claim is checkable on the reader's own file.
 */
export function selectSample(records = [], { size = DEFAULT_SAMPLE_SIZE, seed = SAMPLE_SEED } = {}) {
  const list = Array.isArray(records) ? records : [];
  const limit = Number.isInteger(size) && size > 0 ? Math.min(size, list.length) : 0;
  const scored = list.map((record, index) => {
    const key = recordKey(record, index);
    const stratum = stratumOf(record);
    return {
      key,
      index,
      stratum,
      record,
      score: unitFloat(hashKey(seed >>> 0, key)) ** (1 / STRATUM_WEIGHT[stratum]),
    };
  });
  // Ties break on the stable key and then the index — never on object identity,
  // never on the iteration order of a Map or Set built out of user data.
  scored.sort((left, right) => right.score - left.score
    || (left.key < right.key ? -1 : left.key > right.key ? 1 : left.index - right.index));
  const drawn = scored.slice(0, limit);
  const strata = Object.fromEntries(Object.values(STRATUM).map((stratum) => [stratum, Object.freeze({
    weight: STRATUM_WEIGHT[stratum],
    corpus: scored.filter((row) => row.stratum === stratum).length,
    drawn: drawn.filter((row) => row.stratum === stratum).length,
  })]));
  return Object.freeze({
    version: QUERY_OVERRIDE_MODEL_VERSION,
    seed: seed >>> 0,
    size: limit,
    rows: Object.freeze(drawn.map((row) => Object.freeze({
      key: row.key, index: row.index, stratum: row.stratum, record: row.record,
    }))),
    strata: Object.freeze(strata),
  });
}

/**
 * The override map, read into a keyed lookup.
 *
 * A plain object from a restored workspace can carry `__proto__` or
 * `constructor` as a key, and an unguarded `lookup[key]` on one of those walks
 * the prototype chain rather than the data. So the lookup is a `Map`, the three
 * dangerous names are refused by name whatever they hold, and every refusal is
 * counted rather than swallowed.
 */
function readOverrides(overrides) {
  const entries = overrides instanceof Map
    ? [...overrides.entries()]
    : Object.entries(overrides && typeof overrides === "object" ? overrides : {});
  const lookup = new Map();
  let ignored = 0;
  for (const [key, label] of entries) {
    // A label that is not a rubric category is a stale or hand-edited entry: the
    // grader would set it aside anyway, and counting it here is what makes the
    // discrepancy visible instead of silent.
    if (lookup.size >= MAX_OVERRIDE_KEYS
      || typeof key !== "string" || !key || FORBIDDEN_OVERRIDE_KEYS.includes(key)
      || typeof label !== "string" || !CATEGORY_KEYS.includes(label)) {
      ignored += 1;
      continue;
    }
    lookup.set(key, label);
  }
  return { lookup, ignored };
}

/**
 * Re-grade a corpus with a human's corrections applied over the classifier.
 *
 * @param records already-parsed rows carrying at least `{ category }`, plus the
 *   token counts and model string the rubric reads. Never mutated: the labelled
 *   copies are new objects and the input array is not written to.
 * @param overrides `queryId -> rubric category key`, a `Map` or a plain object.
 *   A human label wins over the classifier's for the same row.
 * @param options `{ spendUsd }` — the corpus's own spend. Absent,
 *   `recoverableSpend` is null rather than a zero standing in for one.
 * @returns frozen `{ version, corpusGrade, grade, composite, coverage,
 *   recoverableSpend, mix, overridesApplied, overridesIgnored, records }`.
 *   `corpusGrade` is the whole `gradeImportedCorpus` result, so a caller already
 *   reading that shape reads this one with no call-site change.
 */
export function applyOverrides(records = [], overrides = {}, { spendUsd = null } = {}) {
  const list = Array.isArray(records) ? records : [];
  const { lookup, ignored } = readOverrides(overrides);
  const matched = new Set();
  const labelled = list.map((record, index) => {
    const override = lookup.get(recordKey(record, index));
    if (override === undefined) return record;
    matched.add(recordKey(record, index));
    return { ...record, category: override };
  });
  const corpusGrade = gradeImportedCorpus(labelled);
  const mix = Object.fromEntries(CATEGORY_KEYS.map((key) => [
    key, labelled.filter((record) => record?.category === key).length,
  ]));
  const spend = Number(spendUsd);
  return Object.freeze({
    version: QUERY_OVERRIDE_MODEL_VERSION,
    corpusGrade,
    grade: corpusGrade.grade,
    composite: corpusGrade.composite,
    coverage: corpusGrade.records.classifiedShare,
    // The published formula, called rather than copied: `recoverableSpendUsd` is
    // where every other recoverable figure on this page comes from.
    recoverableSpend: Number.isFinite(spend) && spend > 0
      ? recoverableSpendUsd({ mix, spendUsd: spend }) : null,
    mix: Object.freeze(mix),
    overridesApplied: matched.size,
    // Keys that named no row, carried no rubric category, or were refused by
    // name — surfaced as a count, so a stale override set is observable rather
    // than a total that quietly stopped adding up.
    overridesIgnored: ignored + (lookup.size - matched.size),
    records: corpusGrade.records,
  });
}

/* --------------------------- the correction seam ---------------------------- */
//
// A surface that lets a reviewer disagree with the classifier needs four things
// this module already had the parts for: the label set a control may offer, a
// validated way to record one choice, a way to take every choice back, and an
// honest count of how many of them are actually inside the numbers on screen.
// They live here rather than in the page so that a correction, the grade it
// moves, and the recoverable figure beside it are one definition — the page
// calls; it does not decide.

/**
 * The classes a correction control may offer, in the rubric's own order and with
 * the rubric's own words. A control built from anything else can offer a label
 * `applyOverrides` would then silently discard.
 */
export const OVERRIDE_LABELS = Object.freeze(QUERY_CATEGORIES.map((category) => Object.freeze({
  key: category.key, label: category.label, description: category.description,
})));

/** Whether a value is a class this model will actually apply. */
export function isOverrideLabel(value) {
  return typeof value === "string" && CATEGORY_KEYS.includes(value);
}

/**
 * Record one reviewer's correction, or take it back.
 *
 * The rejection is the point: a control that offers an unlisted value — or a
 * harness whose control double accepts one — must not be able to put it into the
 * arithmetic. An empty label clears the row rather than storing a blank, and
 * every refusal names itself so a caller can say what happened.
 *
 * @param overrides the live `Map` the page hands `applyOverrides`. Mutated here,
 *   which is why this is the only writer.
 * @returns frozen `{ ok, reason, applied }` — `applied` is the label now
 *   standing for the row, or null when the row was cleared.
 */
export function applyCorrection(overrides, key, label) {
  if (!(overrides instanceof Map)) return Object.freeze({ ok: false, reason: "no_store", applied: null });
  if (typeof key !== "string" || !key || FORBIDDEN_OVERRIDE_KEYS.includes(key)) {
    return Object.freeze({ ok: false, reason: "unknown_row", applied: null });
  }
  if (label === null || label === undefined || label === "") {
    const had = overrides.delete(key);
    return Object.freeze({ ok: true, reason: had ? "cleared" : "unchanged", applied: null });
  }
  if (!isOverrideLabel(label)) {
    return Object.freeze({ ok: false, reason: "unknown_label", applied: overrides.get(key) ?? null });
  }
  if (overrides.size >= MAX_OVERRIDE_KEYS && !overrides.has(key)) {
    return Object.freeze({ ok: false, reason: "at_ceiling", applied: null });
  }
  overrides.set(key, label);
  return Object.freeze({ ok: true, reason: "applied", applied: label });
}

/**
 * Back to classifier-only output. One control, one call: the corrections go and
 * the next `applyOverrides` reproduces the numbers the export earned on its own.
 */
export function revertToClassifier(overrides) {
  const cleared = overrides instanceof Map ? overrides.size : 0;
  if (overrides instanceof Map) overrides.clear();
  return Object.freeze({ ok: true, reason: cleared ? "reverted" : "unchanged", cleared });
}

/**
 * How many corrections are actually folded into the current numbers.
 *
 * Not the number of times a control was used: a correction naming a row this
 * corpus does not hold changes nothing, and a provenance line counting it would
 * overstate what a reader is looking at. Derived from `applyOverrides` rather
 * than counted beside it, so the two can never disagree.
 */
export function includedCorrectionCount(records, overrides, options) {
  return applyOverrides(records, overrides, options).overridesApplied;
}

/**
 * The provenance line for a corrected figure, or null when nothing is corrected.
 * Null rather than "0 of your corrections included": a reader looking at the
 * classifier's own output is owed no sentence about corrections at all.
 */
export function correctionProvenance(count) {
  const included = Number(count);
  if (!Number.isInteger(included) || included <= 0) return null;
  return `${included} of your corrections included`;
}

/**
 * The one slice worth acting on next, under the corrections now applied.
 *
 * Both halves are published figures called rather than copied: `categorySpendUsd`
 * for what a class costs, and the rubric's own `recoverableShare` for how much of
 * that is reclaimable. This ranks; it does not invent. Ties break on the category
 * key so two runs over one corpus name the same action.
 *
 * @returns frozen `{ key, label, action, recoverableUsd }`, or null when there is
 *   no spend to divide or nothing recoverable in the mix.
 */
export function prioritizedRecovery(mix, { spendUsd = null } = {}) {
  const spend = Number(spendUsd);
  if (!Number.isFinite(spend) || spend <= 0) return null;
  const ranked = QUERY_CATEGORIES
    .filter((category) => category.recoverableShare > 0)
    .map((category) => Object.freeze({
      key: category.key,
      label: category.label,
      action: category.systemAction,
      recoverableUsd: Math.round(
        categorySpendUsd({ mix, spendUsd: spend }, category.key) * category.recoverableShare,
      ),
    }))
    .sort((left, right) => right.recoverableUsd - left.recoverableUsd
      || (left.key < right.key ? -1 : 1));
  return ranked[0] && ranked[0].recoverableUsd > 0 ? ranked[0] : null;
}
