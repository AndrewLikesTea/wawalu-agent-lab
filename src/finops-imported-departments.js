// Which of the reader's OWN groups is driving their recoverable spend (#979).
//
// Importing an export used to retire the first-run region outright, and the
// department drill-down went with it — so "which team is that coming from" was
// answerable about the bundled example and unanswerable about a reader's own
// file. The region is refilled instead, and this module is what fills it.
//
// Every figure is read off the envelope `normalizeLocalFinopsHistory` already
// published: nothing is recomputed from rows, no total is re-summed, and no
// number is invented.
//
// RANK 1 IS THE HEADLINE'S NAMED DRIVER, BY CONSTRUCTION. The order is
// `topRecoverableDepartment`'s own rule in finops-imported-headline.js —
// absolute recoverable spend, then larger total spend, then name — applied to
// every group rather than only to the winner. A first row that disagreed with
// the department named above it would be two answers to one question, so
// tests/finops-imported-departments.test.js pins them equal.
//
// THE FALLBACK IS A STATEMENT, NEVER A BLANK. An export with no grouping column
// puts every row in one reserved bucket and has no team in it to rank, so the
// drill-down groups by the dimension the envelope does carry — the billing
// months on `history.periods` — and says which grouping it fell back to and
// why, in the region, in words.
//
// It builds no node, reads no clock, opens no request, and touches no storage.

import { isUnattributed } from "./attribution-units.js";
// A reader's own name for a group, resolved through the one resolver that owns
// that decision. `unitId` rides on every department row so the name a reader
// types is bound to the pseudonymous identity and not to a rank that moves.
import { orgUnitDisplayName } from "./org-unit-display-label.js";

/** Bump when a row, a rule, or a fallback changes meaning. */
export const IMPORTED_DEPARTMENTS_VERSION = "finops-imported-departments/1.0.0";

/**
 * The two dimensions this drill-down can be grouped by, and the sentence each
 * one states in the region. `basis` is visible text, not a tooltip: a reader
 * who is looking at billing months where they asked for teams has to be told
 * that, and told why, in the region itself.
 */
export const DRILLDOWN_GROUPING = Object.freeze({
  department: Object.freeze({
    id: "department",
    noun: "department",
    plural: "departments",
    fallback: false,
    basis: "Grouped by the department column in your export, ranked by recoverable spend "
      + "and then by total spend — the same rule that named the driver above.",
  }),
  month: Object.freeze({
    id: "billing-month",
    noun: "billing month",
    plural: "billing months",
    fallback: true,
    basis: "No department column in this export — grouped by billing month instead, "
      + "because every row carries the month it was billed in and none carries a team. "
      + "Ranked by recoverable spend, then by total spend.",
  }),
});

/** What the region says when the export carried neither dimension. */
export const NO_DRILLDOWN =
  "This export carries no grouping column and no complete billing month, so there is "
  + "nothing to rank. Re-import with the org-unit column included to see it by team.";

/** The heading the shared evidence disclosure carries in the imported state. */
export const DRILLDOWN_HEADING = "Every group in your export, ranked";

/** The region's question once it is answering about the reader's own file. */
export const DRILLDOWN_QUESTION = "Which team is driving this?";

const list = (value) => (Array.isArray(value) ? value : []);

const money = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null);

const filled = (value) => typeof value === "string" && value.trim() !== "";

/** `12480.4` → `"12,480 USD"`, in the export's own currency. */
const amount = (value, currency) => `${Math.round(value).toLocaleString("en-US")} ${currency}`;

/**
 * The ranking rule, in one place. Recoverable spend first because that is the
 * figure the headline names its driver by; total spend breaks a tie because a
 * larger group carrying the same recoverable amount is the bigger fact; the
 * name breaks the rest, so the order is stable for identical groups.
 */
// The last step compares PSEUDONYMS, never display names: a reader typing a
// name must not be able to re-order the ranking underneath themselves, and a
// rank that moved when a label was typed would put the label on another row.
const byRecoverable = (left, right) => (right.recoverableUsd - left.recoverableUsd)
  || (right.spendUsd - left.spendUsd)
  || String(left.pseudonym).localeCompare(String(right.pseudonym));

/**
 * The reader's attributed groups. The reserved unattributed bucket is not one:
 * it is the analysis saying a row carried no grouping value, and ranking it as
 * a team would name a department the export never had.
 */
function departmentGroups(analysis, labels) {
  return list(analysis?.rankedDepartments)
    .filter((entry) => filled(entry?.name) && !isUnattributed(entry?.unit))
    .map((entry) => ({
      unitId: filled(entry?.id) ? entry.id.trim() : null,
      pseudonym: entry.name.trim(),
      name: orgUnitDisplayName(labels, entry?.id, entry.name),
      recoverableUsd: money(entry.recoverableUsd) ?? 0,
      spendUsd: money(entry.spendUsd) ?? 0,
    }));
}

/**
 * The complete billing months in the same envelope, as groups. Complete only,
 * on the period record's own `completeness`: a partial month ranked beside
 * complete ones reads as a quiet month rather than as one the export stops
 * halfway through. It is the rule `latestCompleteMonth` applies to the headline.
 */
function monthGroups(analysis) {
  return list(analysis?.history?.periods)
    .filter((entry) => entry?.completeness === "complete" && filled(entry?.period))
    .map((entry) => ({
      unitId: null,
      pseudonym: entry.period.trim(),
      name: entry.period.trim(),
      recoverableUsd: money(entry.recoverableUsd) ?? 0,
      spendUsd: money(entry.spendUsd) ?? 0,
    }));
}

/** One ranked row: the position, the name, and the two figures behind it. */
function row(group, index, total, currency) {
  const share = total > 0 ? Math.round((group.recoverableUsd / total) * 100) : null;
  return Object.freeze({
    rank: index + 1,
    name: group.name,
    // The identity the label is keyed on, and the pseudonym it is standing in
    // for. Both travel to the view: it renders a field per identity and has to
    // name the unit in that field's accessible name without inventing a second
    // display rule.
    unitId: group.unitId ?? null,
    pseudonym: group.pseudonym,
    recoverableUsd: group.recoverableUsd,
    spendUsd: group.spendUsd,
    share,
    term: `${index + 1}. ${group.name}`,
    detail: `${amount(group.recoverableUsd, currency)} recoverable of `
      + `${amount(group.spendUsd, currency)} spent`
      + (share === null ? "." : ` · ${share}% of this export's recoverable total.`),
  });
}

/**
 * Rank one imported analysis into a drill-down of the reader's own groups.
 *
 * Total: a null, malformed, or empty envelope resolves to an unavailable
 * drill-down carrying the reason, because the region it fills stays on screen
 * in every one of those states.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`, or null.
 * @param {{labels?: object}} [options] the reader's own org-unit names, from
 *   page state. Absent renders every row under its pseudonym, as today.
 * @returns `{ version, available, grouping, headline, detail, rows, count }`
 */
export function importedDepartmentDrilldown(analysis = null, { labels = null } = {}) {
  const currency = filled(analysis?.currency) ? analysis.currency : "USD";
  const departments = departmentGroups(analysis, labels);
  const groups = departments.length > 0 ? departments : monthGroups(analysis);
  const grouping = departments.length > 0
    ? DRILLDOWN_GROUPING.department : DRILLDOWN_GROUPING.month;
  if (groups.length === 0) {
    return Object.freeze({
      version: IMPORTED_DEPARTMENTS_VERSION,
      available: false,
      grouping: DRILLDOWN_GROUPING.department,
      headline: NO_DRILLDOWN,
      detail: "",
      rows: Object.freeze([]),
      count: 0,
    });
  }
  const ranked = groups.slice().sort(byRecoverable);
  const total = ranked.reduce((sum, entry) => sum + entry.recoverableUsd, 0);
  const rows = ranked.map((group, index) => row(group, index, total, currency));
  const top = rows[0];
  return Object.freeze({
    version: IMPORTED_DEPARTMENTS_VERSION,
    available: true,
    grouping,
    // The headline number is in this sentence and not only in the rows behind
    // the disclosure: the collapsed state has to answer the question on its
    // own, or the answer is one keystroke away from a reader who never presses
    // it. `finops-first-run-view.js` paints it outside the `details`.
    headline: `${top.name} is driving it: ${amount(top.recoverableUsd, currency)} recoverable `
      + `of ${amount(top.spendUsd, currency)} spent.`,
    detail: `${top.share === null ? "" : `${top.share}% of the recoverable total across `}`
      + `${rows.length} ${rows.length === 1 ? grouping.noun : grouping.plural} in your export. `
      + grouping.basis,
    rows: Object.freeze(rows),
    count: rows.length,
  });
}
