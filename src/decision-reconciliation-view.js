// The reconciliation table, painted from the model and from nothing else.
//
// One row per recorded commitment decision, in four states. Every row states its
// status as a WORD before it states it as a tint, carries the glyph and the
// dashed/solid edge the stylesheet keys off `data-status`, and shows the two
// figures a leader compares — observed against projected — plus the variance and
// the confidence in it. A row with no comparable figures says so in a sentence
// and shows no dash where a number would go, because a dash in a money column
// reads as zero.
//
// Provenance is concise and on the row: which month settled it, what designated
// the source, and — when the month came from the bundled example dataset — that
// the figures are not the reader's own spend. Nothing out of an imported file
// reaches the DOM as markup; every value is written with `textContent`.
//
// The controls are not painted here. They live in the page's markup, so the
// region can be replaced without taking focus out of the document with it.

import { RECONCILIATION_STATUS } from "./decision-reconciliation.js";

const STATUS_ORDER = Object.freeze([
  RECONCILIATION_STATUS.underperforming,
  RECONCILIATION_STATUS.verified,
  RECONCILIATION_STATUS.noComparableData,
  RECONCILIATION_STATUS.unmatchedCommitment,
]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fact(list, label, value) {
  const item = el("div", "rec-fact");
  item.append(el("dt", "rec-fact-label", label), el("dd", "rec-fact-value", value));
  list.append(item);
}

/**
 * The count line, in words. Zero of a state is stated as "none" rather than
 * omitted: a leader reading "2 verified" needs to know the other two states were
 * looked for and not found, not guess whether they were checked.
 */
export function reconciliationSummaryText(model) {
  if (model.rows.length === 0) {
    return "No recorded decision carries a FinOps commitment yet, so this import settles nothing. "
      + "Record a decision from a commitment first.";
  }
  const parts = STATUS_ORDER.map((status) => `${model.counts[status] || "none"} `
    + `${status.replace(/_/g, " ")}`);
  const months = model.openedMonths.length
    ? `against ${model.openedMonths.join(", ")}`
    : "with no month open";
  return `${model.rows.length} recorded commitment${model.rows.length === 1 ? "" : "s"} `
    + `reconciled ${months}: ${parts.join(", ")}.`;
}

function comparisonNode(row) {
  const list = el("dl", "rec-figures");
  const comparison = row.outcome?.comparison;
  if (!comparison) {
    // No figures, and no placeholder where figures would be. The sentence is the
    // model's own; this view authors no explanation of its own.
    list.dataset.available = "false";
    fact(list, "Observed against projected", "No comparable figure");
    return list;
  }
  list.dataset.available = "true";
  fact(list, "Observed monthly saving", comparison.observedText);
  fact(list, "Projected monthly saving", comparison.projectedText);
  fact(list, "Variance", `${comparison.varianceText} · ${comparison.attainmentText}`);
  return list;
}

function provenanceText(row) {
  const provenance = row.outcome?.provenance;
  const parts = [];
  if (row.observedMonth) parts.push(`Observed month ${row.observedMonth}`);
  if (row.baselinePeriod) parts.push(`baseline ${row.baselinePeriod}`);
  if (provenance?.sourceId) parts.push(`source ${provenance.sourceId} (${provenance.designation})`);
  if (provenance?.observedDataset === "example") {
    parts.push("the observed month is the bundled example dataset, not your own spend");
  }
  return parts.length ? `${parts.join(" · ")}.` : "No month has been matched to this commitment.";
}

function rowNode(row) {
  const item = el("li", "rec-row");
  item.dataset.status = row.status;
  item.dataset.shape = row.cue.shape;

  const header = el("div", "rec-row-header");
  const glyph = el("span", "rec-glyph", row.cue.glyph);
  glyph.setAttribute("aria-hidden", "true");
  const link = el("a", "rec-title", row.title);
  link.setAttribute("href", row.href);
  header.append(glyph, el("span", "rec-status", row.cue.label), link);
  item.append(header);
  // The status word is in the row's own accessible name, so a screen reader
  // hears it without reaching the visual grouping or the colour.
  item.setAttribute("aria-label", `${row.cue.label}: ${row.title}. ${row.statement}`);

  item.append(el("p", "rec-statement", row.statement));
  item.append(comparisonNode(row));

  const confidence = row.outcome?.confidence;
  if (confidence) {
    item.append(el("p", "rec-confidence", `${confidence.label}`
      + `${confidence.statedPercent === null ? "" : ` · commitment stated ${confidence.statedPercent}%`}`
      + ` · ${confidence.reasons.join(" ")}`));
  }
  item.append(el("p", "rec-provenance", provenanceText(row)));

  const evidence = row.outcome?.evidence;
  if (evidence) {
    const detail = el("details", "rec-evidence");
    detail.append(el("summary", undefined,
      `Evidence — ${evidence.baselineRecordCount} baseline `
      + `record${evidence.baselineRecordCount === 1 ? "" : "s"}, `
      + `${evidence.observedRecordCount} observed`));
    const gaps = el("ul", "rec-gaps");
    for (const gap of evidence.gaps) gaps.append(el("li", undefined, gap));
    if (evidence.gaps.length === 0) gaps.append(el("li", undefined, "No gaps: both sides are cited."));
    detail.append(gaps);
    item.append(detail);
  }
  if (row.outcome?.nextAction) {
    item.append(el("p", "rec-next",
      `Next: ${row.outcome.nextAction.label}. ${row.outcome.nextAction.rationale}`));
  }
  return item;
}

/**
 * Paint the whole reconciliation region.
 *
 * @param model from `reconcileImportedAnalysis`.
 * @returns the region node; the caller decides where it goes.
 */
export function renderDecisionReconciliation(model) {
  const section = el("section", "rec-panel");
  // Labelled by its own question rather than by a second heading: the region
  // already sits under the page's "Recorded decisions this import settles"
  // heading, and a second H2 saying nearly the same thing is one more stop in
  // the heading outline for no new information.
  section.setAttribute("aria-label", model.question);
  section.dataset.rows = String(model.rows.length);

  section.append(el("p", "rec-question", model.question));
  section.append(el("p", "rec-summary", reconciliationSummaryText(model)));

  const list = el("ul", "rec-rows");
  // Underperforming first: it is the only state with money already lost against
  // a promise, and a leader scanning the top of the list must land on it.
  const ranked = [...model.rows].sort((left, right) =>
    STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status));
  for (const row of ranked) list.append(rowNode(row));
  section.append(list);

  // The rubric, always on screen rather than behind a disclosure: a number a
  // director disputes is disputed against the rule that produced it.
  const rules = el("details", "rec-rules");
  rules.append(el("summary", undefined, "How these statuses are decided"));
  const definitions = el("dl", "rec-rule-list");
  for (const [name, entry] of Object.entries(model.rules)) {
    const wrap = el("div", "rec-rule");
    wrap.append(el("dt", undefined, name));
    const value = el("dd");
    value.append(el("p", "rec-rule-text", entry.rule));
    value.append(el("p", "rec-rule-assumption", `Assumption: ${entry.assumption}`));
    wrap.append(value);
    definitions.append(wrap);
  }
  rules.append(definitions);
  rules.append(el("p", "rec-rules-version", `Rubric ${model.schemaVersion}`));
  section.append(rules);
  return section;
}

/** The sentence the persist control reports with, from counts alone. */
export function persistedStatusText(result) {
  if (result.blocked) {
    return `Nothing was written to your decision log. ${result.blocked}`;
  }
  if (result.invalid.length > 0) {
    return `${result.invalid.length} reconciliation${result.invalid.length === 1 ? " was" : "s were"} `
      + "refused by the stored-record contract and not written; the rest of the log is unchanged.";
  }
  if (result.written === 0) {
    return `Nothing changed: ${result.unchanged} recorded decision`
      + `${result.unchanged === 1 ? "" : "s"} already carried this reconciliation.`;
  }
  return `Saved to ${result.written} recorded decision${result.written === 1 ? "" : "s"} in this `
    + `browser's log. ${result.unchanged} were already up to date. Only the derived comparison is `
    + "kept — no imported rows, and no file names.";
}
