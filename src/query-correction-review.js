// The lead's own corrections, one query at a time, over their own import.
//
// WHAT THIS IS, AND WHY IT IS NOT `residue-labeling.js`. That module lets a lead
// answer for a whole unclassified CLUSTER — "vendor `mid-tier-router` is
// over-provisioned" — which is the right grain for spend a lead recognises by
// its billing dimension. It cannot answer the other half of the same doubt: "the
// classifier called THIS query out-of-scope, and it is wrong." A cluster label
// cannot express that, because the row a lead is disputing is one record and the
// evidence they are disputing is the signal that voted for it. So this module is
// the per-query pass: one row per sampled query, the class the classifier gave
// it, THE SIGNAL THAT PRODUCED THAT CLASS, and an agree/relabel control.
//
// THE SEAM, AND WHY IT IS THE SAME ONE. There is one definition of coverage in
// this codebase and it is `familyCoverage()`. Nothing here re-derives a share, a
// tier, a floor, or a letter. A correction is applied to the RECORD — written
// into the same `category` field a provider export would have declared it in,
// which `classifyCorpusRecord` already treats as classified without re-deciding
// it — and then `familyCoverage()` runs again on those records. The unassisted
// and assisted figures this module reports are two invocations of that one
// function, never two formulas. `residue-labeling.js` uses the identical seam,
// and the two compose: corrections are the first override layer and cluster
// labels apply on top of the corrected records.
//
// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------
//
//   correction     one value from `QUERY_CORRECTION_CHOICES`, held against the
//                  record's ORIGINAL index in the imported array. Index, not
//                  identity and not a hash of the text: the sample is a stable
//                  ordering over that same array, so an index attaches a lead's
//                  answer to the row they answered about and to no other.
//
//   agree          the lead confirming the classifier. Recorded, and it moves
//                  no number: the class is already the one the arithmetic used.
//                  On an UNCLASSIFIED row it is the lead agreeing the row is
//                  genuinely unplaceable, which is the same fact
//                  `RESIDUE_UNCLASSIFIABLE` records one grain up — a statement,
//                  not evidence, so it adds nothing to coverage either.
//
//   relabel        the lead naming a different class, from the fixed set the
//                  classifier itself votes over. It is the only answer that
//                  moves coverage, and only when it places a row the classifier
//                  did not.
//
//   corrections included
//                  how many relabels the assisted figures actually rest on.
//                  Held by index, so relabelling one row twice replaces one
//                  answer and never counts as two.
//
// SAMPLING IS DETERMINISTIC AND STATED. No `Math.random`, no clock, no storage,
// no network, no DOM. See `SAMPLE_ORDER_RULE` below for the ordering, which is
// total: re-opening the panel shows the same queries in the same order.
//
// PRIVACY. The query text on a row is the reader's own excerpt, already in this
// tab, rendered back to them. It goes no further: this module is pure, returns a
// plain object, and the surface that paints it uses `textContent` only. Nothing
// derived from an excerpt reaches `org-query-decision.js`, whose output stays
// free of prompt text — the review travels beside that model, never inside it.

import {
  classifyCorpusRecord, corpusSpendReader, coverageHeadline, familyCoverage, recordTurns,
} from "./corpus-family-coverage.js";
import { PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";
import { signalDeclaration } from "./query-signal-families.js";

/** Bump when a choice, the sample rule, or the shape below changes meaning. */
export const QUERY_CORRECTION_VERSION = "query-correction-review/1.0.0";

/** The question this pass answers, in the lead's own words. */
export const QUERY_CORRECTION_QUESTION = "Did the classifier read my queries correctly?";

/** The value of the "no answer yet" choice. */
export const CORRECTION_UNREVIEWED = "";

/** The lead confirming the classifier's own reading. Never a rubric class key. */
export const CORRECTION_AGREE = "agree";

/**
 * How many queries the pass offers.
 *
 * A real export runs to thousands of rows and a review nobody finishes is a
 * review that moves nothing. The cap is stated on the surface, and every row
 * outside it stays in the coverage denominator either way.
 */
export const DEFAULT_CORRECTION_LIMIT = 8;

/**
 * THE SAMPLE ORDER, stated here because a lead has to be able to check it.
 *
 * Unclassified rows first, because a row the classifier placed already counts
 * toward coverage and relabelling it moves the mix but not the share — while a
 * row it could not place is exactly the spend holding the verdict back. Inside
 * each group: the classifier's own confidence ascending, so the readings it was
 * least sure of come before the ones it was certain of; then the row's own
 * weight descending, so the query that moves the number most is nearer the top;
 * then the original row index, which makes the order total.
 */
export const SAMPLE_ORDER_RULE =
  "Unclassified queries first, then the classifier's least confident readings, then the "
  + "heaviest rows, then original file order. No sampling is random and no clock is read, so "
  + "re-opening this pass shows the same queries in the same order.";

/**
 * The choices the control offers: the rubric's own classes, read from the
 * rubric, plus the two answers the rubric has no key for.
 *
 * NEVER A SECOND COPY OF THE CLASS LIST. `query-classification.js` validates
 * every rule it ships against these same categories, so the set a lead may pick
 * from and the set the classifier may vote for cannot drift apart: a class added
 * to the rubric appears here on the next load, and one removed disappears from
 * both at once.
 */
export const QUERY_CORRECTION_CHOICES = Object.freeze([
  Object.freeze({ value: CORRECTION_UNREVIEWED, label: "Not reviewed" }),
  Object.freeze({ value: CORRECTION_AGREE, label: "Agree with the classifier" }),
  ...PROMPT_LITERACY_RUBRIC.categories.map((category) => Object.freeze({
    value: category.key, label: `Relabel as ${category.label}`,
  })),
]);

/** The rubric class keys, for deciding whether an answer moves coverage. */
const CLASS_VALUES = new Set(PROMPT_LITERACY_RUBRIC.categories.map((entry) => entry.key));

const CLASS_LABELS = new Map(PROMPT_LITERACY_RUBRIC.categories
  .map((entry) => [entry.key, entry.label]));

/** True for a value the control may hold. Anything else is refused, not guessed. */
export function isCorrectionValue(value) {
  return value === CORRECTION_AGREE || CLASS_VALUES.has(value);
}

/**
 * The records with the lead's corrections written into them.
 *
 * Copied, never mutated: the caller's import state is left exactly as it was,
 * which is what makes reverting a restoration of the prior numbers rather than a
 * reconstruction of them. Only a rubric class is written — an agreement is the
 * lead confirming a reading, and writing it would let "I checked this" register
 * as evidence the classifier never produced.
 */
export function applyQueryCorrections(records = [], corrections = new Map()) {
  const list = (Array.isArray(records) ? records : []).filter(Boolean);
  if (!corrections || corrections.size === 0) return list;
  return list.map((record, index) => {
    const answer = corrections.get(index);
    return CLASS_VALUES.has(answer) ? { ...record, category: answer } : record;
  });
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const percentText = (share) => (typeof share === "number" && Number.isFinite(share)
  ? `${(share * 100).toFixed(1)}%` : "an unavailable share");

/** The excerpt a row shows, read through the same accessor the classifier reads. */
function queryTextOf(record) {
  return recordTurns(record)
    .map((turn) => (typeof turn?.body === "string" ? turn.body : ""))
    .filter((body) => body.trim())
    .join(" ⏎ ")
    .trim();
}

/**
 * The signals behind one class, in the classifier's own words.
 *
 * The ids are `classifyThread`'s, carried out of `classifyCorpusRecord`
 * unchanged. They are not matched a second time here: a panel that re-derived
 * the reason could disagree with the class printed beside it, which is the one
 * thing a lead disputing a reading must never be shown.
 */
function signalTextOf(decided) {
  if (decided.families.includes("declared")) {
    return "Your export declared this class. The classifier did not re-decide it.";
  }
  if (!decided.signals.length) {
    return "No signal matched this query, so no class could be voted for.";
  }
  return decided.signals
    .map((row) => `${row.signal} (${row.family}, weight ${row.weight} for `
      + `${CLASS_LABELS.get(row.category) ?? row.category})`)
    .join(" · ");
}

/** The assumption behind each matched signal, so a lead can dispute the rule itself. */
function assumptionsOf(decided) {
  return Object.freeze(decided.signals.map((row) => Object.freeze({
    signal: row.signal,
    assumption: signalDeclaration(row.signal).assumption,
  })));
}

/**
 * Rank the corpus into the review sample. See `SAMPLE_ORDER_RULE`.
 *
 * @returns frozen array of `{record, index, decided}`, longest-standing doubt
 *   first, capped at `limit`.
 */
export function sampleQueriesForReview(records = [], { limit = DEFAULT_CORRECTION_LIMIT } = {}) {
  const list = (Array.isArray(records) ? records : []).filter(Boolean);
  const { spendOf } = corpusSpendReader(list);
  const cap = Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_CORRECTION_LIMIT);
  return Object.freeze(list
    .map((record, index) => ({ record, index, decided: classifyCorpusRecord(record, spendOf) }))
    // A row with no readable query text is not reviewable: there is nothing for
    // a lead to read and agree or disagree with. It stays in the denominator.
    .filter((entry) => queryTextOf(entry.record) !== "")
    .sort((left, right) =>
      Number(left.decided.classified) - Number(right.decided.classified)
      || (left.decided.confidence ?? 1) - (right.decided.confidence ?? 1)
      || right.decided.spend - left.decided.spend
      || left.index - right.index)
    .slice(0, cap));
}

/**
 * The review the surface renders, and the coverage result it hands onward.
 *
 * Pure and total: no clock, no randomness, no storage, no DOM. Every string is
 * composed here so the view formats nothing, and every number in them comes out
 * of `familyCoverage` or out of `coverageHeadline`'s reading of it.
 *
 * @param records in-memory imported records. Copied, never mutated.
 * @param corrections Map of original row index to a value `isCorrectionValue`
 *   accepts.
 * @returns null when there is nothing to review, otherwise a frozen model whose
 *   `assisted` field is the coverage result a caller hands to the decision.
 */
export function queryCorrectionReview(records = [], corrections = new Map(),
  { limit = DEFAULT_CORRECTION_LIMIT } = {}) {
  const list = (Array.isArray(records) ? records : []).filter(Boolean);
  if (!list.length) return null;

  const sample = sampleQueriesForReview(list, { limit });
  // Only answers for rows that are actually in this sample count. An answer left
  // over from a wider sample would otherwise inflate the provenance count over
  // figures it did not touch.
  const live = new Map();
  for (const entry of sample) {
    const answer = corrections?.get?.(entry.index);
    if (isCorrectionValue(answer)) live.set(entry.index, answer);
  }

  const unassisted = familyCoverage(list);
  const assisted = live.size ? familyCoverage(applyQueryCorrections(list, live)) : unassisted;
  const unassistedHeadline = coverageHeadline(unassisted);
  const assistedHeadline = coverageHeadline(assisted);

  const rows = Object.freeze(sample.map((entry, position) => {
    const answer = live.get(entry.index) ?? CORRECTION_UNREVIEWED;
    const assignedClass = entry.decided.classified ? entry.decided.category : null;
    const classLabel = assignedClass
      ? CLASS_LABELS.get(assignedClass) ?? assignedClass : "Unclassified";
    return Object.freeze({
      index: entry.index,
      rank: position + 1,
      /** The reader's own query text, verbatim. Rendered as inert text and nowhere else. */
      text: queryTextOf(entry.record),
      classified: entry.decided.classified,
      category: assignedClass,
      classLabel,
      classText: entry.decided.classified
        ? `Classifier read this as ${classLabel}.`
        : "The classifier could not place this query, so its weight is outside coverage.",
      signalText: signalTextOf(entry.decided),
      signalIds: Object.freeze(entry.decided.signals.map((row) => row.signal)),
      assumptions: assumptionsOf(entry.decided),
      answer,
      answerLabel: QUERY_CORRECTION_CHOICES
        .find((choice) => choice.value === answer)?.label ?? "Not reviewed",
      reviewed: answer !== CORRECTION_UNREVIEWED,
      corrected: CLASS_VALUES.has(answer),
      /**
       * What the control is FOR, in words. The row's query text is the other
       * half of the control's accessible name and is never concatenated into
       * this string: the surface points `aria-labelledby` at both nodes, so the
       * name identifies which query without this module ever building markup.
       */
      controlLabel: `Your reading of query ${position + 1} of ${sample.length}`,
      detail: `Weight in this corpus: ${entry.decided.spend} ${unassisted.unitLabel}.`,
    });
  }));

  const correctionCount = [...live.values()].filter((value) => CLASS_VALUES.has(value)).length;
  const agreedCount = [...live.values()].filter((value) => value === CORRECTION_AGREE).length;
  const pending = rows.filter((row) => !row.reviewed).length;
  const skipped = list.length - sample.length;

  return Object.freeze({
    version: QUERY_CORRECTION_VERSION,
    question: QUERY_CORRECTION_QUESTION,
    /** The result a caller hands to the decision. Unassisted when nothing is corrected. */
    assisted,
    unassisted,
    unitLabel: unassisted.unitLabel,
    rows,
    choices: QUERY_CORRECTION_CHOICES,
    orderRule: SAMPLE_ORDER_RULE,
    chip: rows.length
      ? `${rows.length - pending} of ${plural(rows.length, "query", "queries")} reviewed`
      : "no reviewable query",
    intro: "These are your own queries, in the order that most moves the verdict. Each row shows "
      + "the class the classifier gave it and the signal that produced that class. Agree, or "
      + "relabel it with one of the classes the classifier itself votes over. Your answers stay "
      + "in this browser tab, are never uploaded, and are dropped when you revert or import a "
      + "different export.",
    cap: Object.freeze({
      limit: Math.max(1, Math.trunc(limit)),
      shown: rows.length,
      skipped: Math.max(0, skipped),
      text: skipped > 0
        ? `Showing ${plural(rows.length, "query", "queries")} of ${list.length}. The rest stay in `
          + "the coverage denominator whether or not they are reviewed, so the figures below "
          + "already account for them."
        : `Every reviewable query in this import is listed: ${plural(rows.length, "query",
          "queries")}.`,
    }),
    /**
     * Import present, nothing reviewable. An honest sentence rather than a blank
     * panel: a reader who opens this and finds nothing cannot tell "there was
     * nothing to review" from "this is broken".
     */
    empty: rows.length ? null
      : "None of the rows in this import carries query text, so there is nothing to review. The "
        + "classifier read them on their declared category alone, and a correction here could "
        + "not change that.",
    /** Every row answered. The panel stays open so the lead can change their mind. */
    complete: rows.length && pending === 0
      ? `Every query in this pass is reviewed — ${plural(correctionCount, "relabelled",
        "relabelled")}, ${agreedCount} agreed. The pass stays open: changing an answer replaces `
        + "it and recomputes the figures above."
      : null,
    corrections: Object.freeze({
      count: correctionCount,
      agreed: agreedCount,
      pending,
      applied: correctionCount > 0,
      /**
       * The provenance line, wherever an assisted figure is printed. Not a
       * footnote and not a tooltip: a number that rests on the reader's own
       * corrections says so in the same block it is printed in, with the count
       * and with what the export earned alone.
       */
      marker: correctionCount > 0
        ? `${correctionCount} of your corrections included, applied in this tab and never `
          + `uploaded. Your export alone: ${unassistedHeadline.text}.`
        : "",
      unassistedText: unassistedHeadline.text,
      unassistedShare: unassisted.scoredShare,
      unassistedShowGrade: unassistedHeadline.showGrade,
      assistedShare: assisted.scoredShare,
      assistedShowGrade: assistedHeadline.showGrade,
      agreedText: agreedCount > 0
        ? `${plural(agreedCount, "query is", "queries are")} confirmed as the classifier read `
          + "them. That answer is recorded and moves no figure."
        : "",
    }),
    /**
     * Corrections applied and the verdict still withheld. Said plainly, with the
     * distance left, rather than leaving the withheld copy standing over a lead
     * who has just done the work and cannot tell whether it counted.
     */
    shortfall: correctionCount > 0 && assistedHeadline.showGrade !== true
      ? `${percentText(assisted.scoredShare)} of this corpus is classified with your corrections `
        + `in, up from ${percentText(unassisted.scoredShare)}. That is still under the bar a `
        + `letter grade is published at. ${assistedHeadline.rule} Relabelling the remaining `
        + `${plural(pending, "query", "queries")} in this pass, or widening the export, is what `
        + "closes the rest."
      : null,
    /** The one control back to classifier-only output. Offered only when there is one. */
    revert: Object.freeze({
      available: live.size > 0,
      label: "Revert to classifier-only output",
      text: "Drops every answer in this pass. The figures above return to what your export "
        + "earned on the classifier alone.",
    }),
    /** What the polite region says after a recompute. Null when nothing is corrected. */
    announcement: correctionCount > 0
      ? `Coverage is now ${percentText(assisted.scoredShare)} of scored ${assisted.unitLabel} `
        + `with ${correctionCount} of your corrections included. ${assistedHeadline.showGrade
          ? "A letter grade is shown." : "That is still under the bar for a letter grade."} `
        + `Your export alone: ${percentText(unassisted.scoredShare)}.`
      : null,
  });
}
