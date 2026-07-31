// Lead-supplied labels over the unclassified residue, folded back into the SAME
// coverage arithmetic.
//
// WHY THIS EXISTS. `corpus-family-coverage.js` names the clusters the classifier
// could not place and says how many points of coverage each one is holding. A
// FinOps lead reading that list usually knows what three of them are — a batch
// job, an evaluation harness, a team's sandbox — and had no way to say so.
//
// THE ONE RULE THAT KEEPS THIS HONEST. Nothing here scores, ranks, or formats a
// coverage figure. A lead label becomes a `category` on a COPY of the record and
// `familyCoverage` is called again: same entry point, same tiers, same residue
// ranking. `classifyCorpusRecord` already treats a declared category as the
// customer's own statement about their row, which is exactly what a lead label
// is. The recomputed number is not "coverage plus a correction"; it is coverage,
// over a corpus the lead corrected.
//
// SAMPLE-FREE BY CONSTRUCTION. A cluster is described from the STRUCTURAL field
// that produced its key — vendor, declared category, model, organization unit —
// and never from an excerpt or any free text the import carried.
// `residueClusterKey` is the only thing here that reads a record's fields, and
// it reads those four. When the value keying a cluster does not look like an
// identifier, the description names the FIELD and the row count and prints no
// value at all: a lead can act on "eleven rows share one unmatched declared
// category" without anyone being shown a sentence somebody typed.
//
// LOCAL-ONLY. Labels are `{clusterKey: assignment}` and nothing else — no row
// identifier, no excerpt, no file name. They live in the coaching section's own
// in-memory store beside the open-disclosure set, and they die with the tab, the
// reset, or the next import.

import { formatUsd } from "./evolution.js";
import {
  RESIDUE_UNKEYED, coverageHeadline, residueClusterKey,
} from "./corpus-family-coverage.js";
import { PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";

export const RESIDUE_REVIEW_VERSION = "residue-review/1.0.0";

/** No statement from the lead. The default, and the only value that is not a label. */
export const RESIDUE_UNASSIGNED = "";

/**
 * The lead's statement that a cluster genuinely belongs in no rubric class.
 *
 * It is a label — counted, marked, cleared by reset — but it moves no spend into
 * the numerator, because the honest consequence of "this cannot be classified"
 * is that coverage does not improve. What it does change is the next action,
 * which stops naming a cluster the lead has already ruled on.
 */
export const RESIDUE_UNCLASSIFIABLE = "unclassifiable";

/** The option set, rendered in this order: default, the rubric's own classes, then the refusal. */
export const RESIDUE_ASSIGNMENT_OPTIONS = Object.freeze([
  Object.freeze({ value: RESIDUE_UNASSIGNED, label: "Unassigned — leave in the residue" }),
  ...PROMPT_LITERACY_RUBRIC.categories.map((entry) => Object.freeze({
    value: entry.key, label: entry.label,
  })),
  Object.freeze({ value: RESIDUE_UNCLASSIFIABLE, label: "Genuinely unclassifiable" }),
]);

const RUBRIC_VALUES = new Set(PROMPT_LITERACY_RUBRIC.categories.map((entry) => entry.key));

/** The four fields `residueClusterKey` reads, in its order, with the noun a reader knows. */
const SIGNATURE_FIELDS = Object.freeze([
  Object.freeze({ field: "vendor", noun: "vendor" }),
  Object.freeze({ field: "category", noun: "declared category" }),
  Object.freeze({ field: "model", noun: "model" }),
  Object.freeze({ field: "orgUnitId", noun: "organization unit" }),
]);

/**
 * An identifier a surface may print verbatim: short, few words, made of the
 * characters a vendor code, a model name or an org pseudonym is made of.
 * Deliberately strict — a declared-category column is free text in practice, so
 * anything that is not obviously a code is described rather than quoted.
 */
function printableIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 40
    && value.split(" ").length <= 4 && /^[\w .:/@+-]+$/.test(value);
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * Which of the four structural fields carries this cluster's key.
 *
 * The key is never recomputed: `residueClusterKey` is asked for the record's
 * published key, then asked again with ONE field in isolation, and the field
 * whose isolated key equals the published one is the one that named the cluster.
 * If the upstream field order ever changes, this still reports the truth.
 */
function signatureFor(records, keys) {
  const found = new Map();
  for (const record of records) {
    const key = residueClusterKey(record);
    if (!keys.has(key) || found.has(key)) continue;
    const entry = SIGNATURE_FIELDS.find(({ field }) =>
      residueClusterKey({ [field]: record?.[field] }) === key);
    if (entry) found.set(key, entry);
  }
  return found;
}

/** The row count and the structural field, and the value only when it is a code. */
function describeCluster(cluster, signature) {
  const rows = plural(cluster.records, "row", "rows");
  if (!signature || cluster.key === RESIDUE_UNKEYED) {
    return `${rows} carrying no vendor, declared category, model, or organization unit`;
  }
  return printableIdentifier(cluster.key)
    ? `${rows} sharing ${signature.noun} “${cluster.key}”`
    : `${rows} sharing one unmatched ${signature.noun}`;
}

/** The cluster's own spend, in the unit the corpus was weighted in. */
function amountOf(spend, result) {
  return result.unit === "usd" ? formatUsd(spend)
    : `${Math.round(spend).toLocaleString("en-US")} ${result.unitLabel}`;
}

/** Labels the lead actually made. An empty string is the absence of a statement. */
export function leadLabelCount(labels = {}) {
  return Object.values(labels ?? {}).filter((value) =>
    value === RESIDUE_UNCLASSIFIABLE || RUBRIC_VALUES.has(value)).length;
}

/**
 * The corpus as the lead corrected it: records unchanged, except that a record
 * in a cluster the lead placed in a rubric class now carries that class as its
 * declared category.
 *
 * `RESIDUE_UNCLASSIFIABLE` is deliberately NOT applied — it is a statement that
 * no class fits, and writing a class for it would let a refusal raise coverage.
 * Records are copied, never mutated: the caller's array is the same array after
 * this returns, so the unassisted result stays recomputable from it.
 */
export function applyLeadLabels(records = [], labels = {}) {
  const list = Array.isArray(records) ? records : [];
  if (!leadLabelCount(labels)) return list;
  return list.map((record) => {
    const assigned = labels?.[residueClusterKey(record)];
    return RUBRIC_VALUES.has(assigned) ? { ...record, category: assigned } : record;
  });
}

/**
 * The next action, once the lead has ruled on part of the residue.
 *
 * Three cases, and the middle one is the reason this function exists: a cluster
 * the lead has called unclassifiable must stop being the thing the page tells
 * them to go resolve. The numbers are read off the recomputed result and none
 * is calculated here.
 */
function nextAction(labeled, labels, headline) {
  const remaining = labeled.residue.filter((cluster) =>
    labels?.[cluster.key] !== RESIDUE_UNCLASSIFIABLE);
  if (!labeled.residue.length || remaining[0] === labeled.residue[0]) return headline.action;
  if (!remaining.length) {
    return `Every cluster still unclassified is marked genuinely unclassifiable, so coverage `
      + `stays at ${((labeled.scoredShare ?? 0) * 100).toFixed(1)}% and no label here will move `
      + `it. Widen the export or fill the category column at the source.`;
  }
  const top = remaining[0];
  return `Resolve “${top.key}” next: ${plural(top.records, "unclassified record",
    "unclassified records")} holding ${top.coveragePoints.toFixed(1)} points of coverage. `
    + `Clusters above it are marked genuinely unclassifiable.`;
}

/**
 * Everything the review control paints, composed once.
 *
 * @param records the in-memory corpus. Read only for the structural field that
 *   names each cluster; no excerpt is read and none is returned.
 * @param unassisted `familyCoverage(records)` — what the import earned on its
 *   own. It supplies the cluster LIST, so the rows a lead is working through
 *   keep their identity and their order as they assign them, and so the
 *   unassisted headline stays legible beside the corrected one.
 * @param labeled the same function over the corrected corpus. Every recomputed
 *   figure comes from here.
 * @returns a frozen model, or null when there is no coverage result at all.
 */
export function residueReview({ records = [], unassisted = null, labeled = null, labels = {} } = {}) {
  if (!unassisted) return null;
  const result = labeled ?? unassisted;
  const count = leadLabelCount(labels);
  const clusters = unassisted.residue ?? [];
  const signature = signatureFor(Array.isArray(records) ? records : [],
    new Set(clusters.map((cluster) => cluster.key)));
  const headline = coverageHeadline(result);
  const word = plural(count, "lead-supplied label", "lead-supplied labels");
  return Object.freeze({
    version: RESIDUE_REVIEW_VERSION,
    count,
    /** Visible provenance. Null at zero, so the marker disappears rather than reading "0". */
    marker: count ? `This reading includes ${word}.` : null,
    /** What the import earned with no help, kept legible beside the corrected reading. */
    unassisted: `Unassisted: ${coverageHeadline(unassisted).text}.`,
    heading: "Unclassified clusters you can label",
    intro: clusters.length
      ? "Ranked by share of spend, largest first. Assigning a class re-runs the same coverage "
        + "arithmetic with your label folded in; nothing is uploaded or stored."
      : "Nothing to review — every record in this corpus was placed, so there is no residue to "
        + "label.",
    options: RESIDUE_ASSIGNMENT_OPTIONS,
    action: nextAction(result, labels, headline),
    announcement: count
      ? `Recomputed with ${word}. ${headline.text}.`
      : `Lead-supplied labels cleared. ${headline.text}.`,
    rows: Object.freeze(clusters.map((cluster) => Object.freeze({
      key: cluster.key,
      description: describeCluster(cluster, signature.get(cluster.key)),
      amount: amountOf(cluster.spend, unassisted),
      percent: `${(cluster.share * 100).toFixed(1)}%`,
      points: `${cluster.coveragePoints.toFixed(1)} points of coverage`,
      assigned: RUBRIC_VALUES.has(labels?.[cluster.key])
        || labels?.[cluster.key] === RESIDUE_UNCLASSIFIABLE
        ? labels[cluster.key] : RESIDUE_UNASSIGNED,
    }))),
  });
}
