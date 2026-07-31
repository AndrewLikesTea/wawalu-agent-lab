// The lead's own labels for the unclassified residue, and the coverage they buy.
//
// WHAT THIS IS FOR. `corpus-family-coverage.js` names the clusters the
// classifier could not place and ranks them by the coverage each one is holding
// back. A FinOps lead reading that list usually KNOWS what three of those
// clusters are — it is their own export, and "vendor `mid-tier-router`" is a
// workload they can name in a second. Before this module the only thing they
// could do with that knowledge was widen the sample and re-import. Now they can
// state the class, and the same coverage arithmetic runs again with their
// statement in it.
//
// THE SEAM, AND WHY IT IS THIS ONE. There is exactly one definition of coverage
// in this codebase and it is `familyCoverage()`. Nothing here re-derives a
// share, a tier, a floor, or a letter. A lead-supplied label is applied to the
// RECORDS — `classifyCorpusRecord` already treats a category the source
// declared as classified without re-deciding it, so a label is written into the
// same field a provider export would have carried it in — and then
// `familyCoverage()` is invoked again on those records. The three results this
// module reports (unassisted, assisted, ceiling) are three invocations of that
// one function, never three formulas.
//
// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------
//
//   label            a rubric class key the lead assigned to a whole cluster,
//                    or `RESIDUE_UNCLASSIFIABLE`. Held by cluster key in a Map
//                    the caller owns, in memory, for this session only. Nothing
//                    here reads or writes a file, a network, or storage.
//
//   unassisted       `familyCoverage(records)` — what the export earned alone.
//                    It stays computed and stays reported for as long as any
//                    label exists, because a figure a lead cannot compare
//                    against their own export's is a figure they cannot defend.
//
//   assisted         `familyCoverage(labelled records)`. Identical to the
//                    unassisted result when no label is set, which is why a
//                    surface can hand this one to the decision unconditionally.
//
//   ceiling          `familyCoverage(records)` with every cluster this control
//                    OFFERS assigned. It answers "if I label everything on this
//                    list, does a letter appear?" without the lead having to
//                    find out by doing it. Clusters below the display cap and
//                    clusters the lead called unclassifiable are not in it, so
//                    the ceiling is what this control can actually reach.
//
// A cluster marked `RESIDUE_UNCLASSIFIABLE` is left in the residue on purpose:
// it is a lead saying "this spend is genuinely unplaceable", which is a
// different fact from "I have not looked at it yet" and must not move coverage
// by a single point. It changes the row's state and the count of open clusters,
// and it changes nothing in the arithmetic.

import {
  RESIDUE_UNKEYED, coverageHeadline, familyCoverage, residueClusterKey,
} from "./corpus-family-coverage.js";
import { PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";

/** Bump when a choice, the cap rule, or the shape below changes meaning. */
export const RESIDUE_LABELING_VERSION = "residue-labeling/1.0.0";

/** The lead's answer for a cluster that genuinely cannot be classified. */
export const RESIDUE_UNCLASSIFIABLE = "genuinely-unclassifiable";

/** The value of the "no answer yet" choice. Distinct from unclassifiable. */
export const RESIDUE_UNASSIGNED = "";

/**
 * How many clusters the control offers. The residue on a real export has a long
 * tail of one-record clusters worth a fraction of a point each; offering all of
 * them is a list nobody finishes and a keyboard walk nobody wants. The cap is
 * stated in the UI and the tail stays in the coverage denominator either way.
 */
export const DEFAULT_RESIDUE_LIMIT = 5;

/**
 * The choices the control offers: the rubric's own classes, read from the
 * rubric, plus the two answers the rubric has no key for. Never a second copy of
 * the class list — a class the rubric adds appears here on the next load.
 */
export const RESIDUE_LABEL_CHOICES = Object.freeze([
  Object.freeze({ value: RESIDUE_UNASSIGNED, label: "Not assigned" }),
  ...PROMPT_LITERACY_RUBRIC.categories.map((category) => Object.freeze({
    value: category.key, label: category.label,
  })),
  Object.freeze({ value: RESIDUE_UNCLASSIFIABLE, label: "Genuinely unclassifiable" }),
]);

/**
 * The three states a row can be in, as a word and a shape — never as a tint.
 *
 * The shapes are the page's own square vocabulary, with the meanings
 * `panel-status-view.js` already publishes: ▢ nothing yet, ▣ resolved, ◧ partly.
 * A reviewed-but-unplaceable cluster is genuinely "partly": the reader answered,
 * and the answer moved no coverage. Nothing here is a diamond — those are
 * provenance on this page and a review state is not provenance.
 */
export const RESIDUE_STATES = Object.freeze({
  unreviewed: Object.freeze({ key: "unreviewed", label: "Not reviewed", shape: "▢" }),
  labelled: Object.freeze({ key: "labelled", label: "Labelled", shape: "▣" }),
  unclassifiable: Object.freeze({ key: "unclassifiable", label: "Unclassifiable", shape: "◧" }),
});

/** The state one assigned value puts a row in. Total: every value maps. */
export function residueRowState(assigned) {
  if (assigned === RESIDUE_UNCLASSIFIABLE) return RESIDUE_STATES.unclassifiable;
  return CLASS_VALUES.has(assigned) ? RESIDUE_STATES.labelled : RESIDUE_STATES.unreviewed;
}

/**
 * "Item 3 of 12", and what a list with nothing in it says instead.
 *
 * Composed here rather than in the view for the same reason every other string
 * on this surface is: an empty residue must never render "Item 0 of 0", and the
 * one place that decision is made is the one place it can be tested.
 */
export function residueProgressText(position, total) {
  const size = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  if (!size) return "No clusters to review.";
  const at = Math.min(Math.max(1, Math.trunc(position) || 1), size);
  return `Item ${at} of ${size}`;
}

/** The rubric class keys, for deciding whether a label moves coverage. */
const CLASS_VALUES = new Set(PROMPT_LITERACY_RUBRIC.categories.map((entry) => entry.key));

/** The first rubric class, used only to model the ceiling. Any class classifies. */
const CEILING_CLASS = PROMPT_LITERACY_RUBRIC.categories[0]?.key ?? null;

/** True for a value the control may hold. Anything else is refused, not guessed. */
export function isResidueLabel(value) {
  return value === RESIDUE_UNCLASSIFIABLE || CLASS_VALUES.has(value);
}

/**
 * Which of the record's OWN fields the cluster key came from, in the order
 * `residueClusterKey` reads them. This is what the row is described by: a field
 * name and the value that grouped it, never a prompt, an excerpt, or anything
 * derived from one. `residueClusterKey` never reads prompt text, so no path here
 * can reach it.
 */
const DIMENSIONS = Object.freeze([
  Object.freeze({ field: "vendor", label: "Billed vendor" }),
  Object.freeze({ field: "category", label: "Source-declared category" }),
  Object.freeze({ field: "model", label: "Model" }),
  Object.freeze({ field: "orgUnitId", label: "Org unit" }),
]);

const UNKEYED_DIMENSION = Object.freeze({
  field: null, label: "No grouping field", key: RESIDUE_UNKEYED,
});

/** The dimension one record was clustered on. Mirrors `residueClusterKey`'s order. */
export function residueDimension(record) {
  const key = residueClusterKey(record);
  if (key === RESIDUE_UNKEYED) return UNKEYED_DIMENSION;
  for (const dimension of DIMENSIONS) {
    const value = record?.[dimension.field];
    if (typeof value === "string" && value.trim().replace(/\s+/g, " ").toLowerCase() === key) {
      return Object.freeze({ ...dimension, key });
    }
  }
  return Object.freeze({ ...UNKEYED_DIMENSION, key });
}

/**
 * The records with the lead's labels written into them.
 *
 * The cluster a label is looked up by is derived from the ORIGINAL record, so a
 * label written into `category` cannot move a record into a different cluster
 * than the one the lead was looking at. Records are copied, never mutated: the
 * caller's import state is left exactly as it was, which is what makes
 * "unassisted" recoverable rather than reconstructed.
 */
export function applyLeadLabels(records = [], labels = new Map()) {
  const list = (Array.isArray(records) ? records : []).filter(Boolean);
  if (!labels || labels.size === 0) return list;
  return list.map((record) => {
    const label = labels.get(residueClusterKey(record));
    // Unclassifiable is deliberately not written: it is the lead declining to
    // classify, and a coverage figure that rose because of it would be this
    // page counting "I do not know" as evidence.
    return label && CLASS_VALUES.has(label) ? { ...record, category: label } : record;
  });
}

// A corpus with no positive spend has no denominator, so its share is null
// rather than zero — and it is said in words rather than printed as "0.0%",
// which a reader would read as a measurement.
const percentText = (share) => (typeof share === "number" && Number.isFinite(share)
  ? `${(share * 100).toFixed(1)}%` : "an unavailable share");
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * The review the surface renders, and the coverage result it hands onward.
 *
 * Pure and total: no clock, no randomness, no storage, no DOM. Every string is
 * composed here so the view can format nothing, and every number in them comes
 * out of `familyCoverage` or out of `coverageHeadline`'s reading of it.
 *
 * @param records in-memory imported records. Copied, never mutated.
 * @param labels Map of cluster key to a value `isResidueLabel` accepts.
 * @returns null when there is nothing to review, otherwise a frozen model whose
 *   `assisted` field is the coverage result a caller hands to the decision.
 */
export function residueReview(records = [], labels = new Map(),
  { limit = DEFAULT_RESIDUE_LIMIT } = {}) {
  const list = (Array.isArray(records) ? records : []).filter(Boolean);
  if (!list.length) return null;

  // Only labels for clusters that are actually in this corpus count. A label
  // left over from a different import would otherwise inflate the marker's
  // count over figures it did not touch.
  const unassisted = familyCoverage(list);
  const live = new Map();
  for (const cluster of unassisted.residue) {
    const label = labels?.get?.(cluster.key);
    if (isResidueLabel(label)) live.set(cluster.key, label);
  }
  const assisted = live.size ? familyCoverage(applyLeadLabels(list, live)) : unassisted;

  // The rows are ranked off the UNASSISTED residue, so the list a lead is
  // working through does not reorder or lose a row underneath them the moment
  // they answer one. Their answer shows up in the row's state, not by the row
  // disappearing.
  const dimensions = new Map();
  for (const record of list) {
    const key = residueClusterKey(record);
    if (!dimensions.has(key)) dimensions.set(key, residueDimension(record));
  }
  const cap = Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_RESIDUE_LIMIT);
  const shown = unassisted.residue.slice(0, cap);
  const hidden = unassisted.residue.slice(cap);
  const rows = Object.freeze(shown.map((cluster, index) => {
    const dimension = dimensions.get(cluster.key) ?? UNKEYED_DIMENSION;
    const assigned = live.get(cluster.key) ?? RESIDUE_UNASSIGNED;
    const description = dimension.field
      ? `${dimension.label} · ${cluster.key}`
      : `${dimension.label} · these records carry no vendor, category, model, or org unit`;
    return Object.freeze({
      key: cluster.key,
      rank: index + 1,
      dimension: dimension.field,
      description,
      records: cluster.records,
      share: cluster.share,
      coveragePoints: cluster.coveragePoints,
      assigned,
      assignedLabel: RESIDUE_LABEL_CHOICES
        .find((choice) => choice.value === assigned)?.label ?? "Not assigned",
      // The row's state as a word and a shape, so "answered" and "not answered"
      // differ by more than a tint at 12px. The view renders both and adds no
      // third carrier of its own.
      state: residueRowState(assigned),
      // The control's accessible name, and it is also the row's visible text:
      // one string, so the name a speech-control user says is the name a
      // sighted reader reads and the name a screen reader announces.
      controlLabel: `Class for ${description} — ${percentText(cluster.share)} of scored `
        + `${unassisted.unitLabel}, ${plural(cluster.records, "record", "records")}`,
      detail: `${percentText(cluster.share)} of scored ${unassisted.unitLabel} · `
        + `resolving it returns ${cluster.coveragePoints.toFixed(1)} points of coverage`,
    });
  }));

  const hiddenShare = hidden.reduce((sum, cluster) => sum + cluster.share, 0);
  const capText = hidden.length
    ? `Showing the ${plural(rows.length, "largest unclassified cluster",
      "largest unclassified clusters")} of ${unassisted.residue.length}. The other `
      + `${plural(hidden.length, "cluster", "clusters")} hold ${percentText(hiddenShare)} of `
      + `scored ${unassisted.unitLabel}; they stay in the coverage denominator whether or not `
      + "they are labelled, so coverage below already accounts for them."
    : `Every unclassified cluster in this corpus is listed: ${plural(rows.length, "cluster",
      "clusters")}.`;

  // The ceiling: this control's reach, not the corpus's. Clusters under the cap
  // and clusters the lead called unclassifiable are not in it, because neither
  // is something the lead can label from here.
  const ceilingLabels = new Map(live);
  for (const row of rows) {
    if (!ceilingLabels.has(row.key) && CEILING_CLASS) ceilingLabels.set(row.key, CEILING_CLASS);
  }
  const ceilingResult = ceilingLabels.size
    ? familyCoverage(applyLeadLabels(list, ceilingLabels)) : unassisted;
  const ceilingHeadline = coverageHeadline(ceilingResult);
  const assistedHeadline = coverageHeadline(assisted);
  const unassistedHeadline = coverageHeadline(unassisted);

  const classCount = [...live.values()].filter((value) => CLASS_VALUES.has(value)).length;
  const unclassifiableCount = [...live.values()]
    .filter((value) => value === RESIDUE_UNCLASSIFIABLE).length;
  const pending = rows.filter((row) => row.assigned === RESIDUE_UNASSIGNED).length;

  return Object.freeze({
    version: RESIDUE_LABELING_VERSION,
    /** The result a caller hands to the decision. Unassisted when no label is set. */
    assisted,
    unassisted,
    unitLabel: unassisted.unitLabel,
    rows,
    choices: RESIDUE_LABEL_CHOICES,
    question: "Can I classify the residue myself?",
    chip: rows.length
      ? `${plural(rows.length, "cluster", "clusters")} · ${classCount} labelled`
      : "no residue",
    intro: "These are the clusters the classifier could not place, largest first. Assigning one "
      + "applies your label to that whole cluster and re-runs the same coverage arithmetic. "
      + "Labels stay in this browser tab, are never uploaded, and are dropped when you reset "
      + "or import a different export.",
    cap: Object.freeze({
      limit: cap, shown: rows.length, hidden: hidden.length, hiddenShare, text: capText,
    }),
    empty: rows.length ? null
      : "Nothing is unclassified in this corpus, so there is no cluster to label. Coverage is "
        + "not being held back by residue.",
    assist: Object.freeze({
      /** Labels the assisted figures actually rest on. Unclassifiable is not one. */
      count: classCount,
      unclassifiableCount,
      pending,
      applied: classCount > 0,
      marker: classCount > 0
        ? `Includes ${plural(classCount, "lead-supplied label", "lead-supplied labels")}, `
          + "applied in this tab and never uploaded. Your export alone: "
          + `${unassistedHeadline.text}.`
        : "",
      unassistedText: unassistedHeadline.text,
      unassistedShare: unassisted.scoredShare,
      unassistedShowGrade: unassistedHeadline.showGrade,
      assistedShare: assisted.scoredShare,
      assistedShowGrade: assistedHeadline.showGrade,
      unclassifiableText: unclassifiableCount > 0
        ? `${plural(unclassifiableCount, "cluster is", "clusters are")} marked genuinely `
          + "unclassifiable. That answer is recorded and adds nothing to coverage."
        : "",
    }),
    ceiling: Object.freeze({
      share: ceilingResult.scoredShare,
      showGrade: ceilingHeadline.showGrade,
      reachable: ceilingHeadline.showGrade === true,
      text: ceilingHeadline.showGrade === true
        ? `Labelling every cluster listed here would take coverage to `
          + `${percentText(ceilingResult.scoredShare)}, which is over the bar a letter grade is `
          + "published at."
        : `Labelling every cluster listed here would take coverage to `
          + `${percentText(ceilingResult.scoredShare)} — still under the bar, so no letter grade `
          + "would appear from this control alone. " + ceilingHeadline.rule,
    }),
    /**
     * The ONE sentence the polite region says at the end of a review pass.
     *
     * Not per row. A reader working down twenty-five clusters must not be
     * interrupted twenty-five times with a re-reading of the whole coverage
     * figure — the row's own state carries the per-item change, and this is what
     * the pass adds up to: how many corrections were applied and the figure they
     * produced. Null when the reader touched nothing, so leaving an untouched
     * list is silent rather than announcing an empty result.
     *
     * A pass that only marked clusters unclassifiable still has a summary: the
     * reader answered, and "your answers moved nothing" is the result they need
     * to hear rather than silence they have to interpret.
     */
    announcement: classCount > 0
      ? `Coverage is now ${percentText(assisted.scoredShare)} of scored ${assisted.unitLabel} `
        + `with ${plural(classCount, "lead-supplied label", "lead-supplied labels")}. `
        + `${assistedHeadline.showGrade
          ? "A letter grade is shown." : "That is still under the bar for a letter grade."} `
        + `Your export alone: ${percentText(unassisted.scoredShare)}.`
      : (unclassifiableCount > 0
        ? `${plural(unclassifiableCount, "cluster", "clusters")} marked genuinely `
          + "unclassifiable, which adds nothing to coverage. Coverage is "
          + `${percentText(unassisted.scoredShare)} of scored ${unassisted.unitLabel}.`
        : null),
  });
}
