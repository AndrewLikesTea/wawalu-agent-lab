// Which group is driving the spend in the reader's OWN export.
//
// WHAT THIS FIXES. #finops-first-run is the richest block on this page: a
// headline, a department drill-down, and the supporting evidence behind both
// under one disclosure. Until now it was RETIRED the moment any analysis
// landed, so the drill-down died exactly when a reader finally had their own
// numbers in it — the example got the persuasive block and the customer got a
// hidden one. This module is the computation that lets the region be
// repopulated instead of retired.
//
// ONE COMPUTATION, TWO CONSUMERS. The headline names a driver and the table
// ranks the groups. Those cannot be derived in two places or they will
// eventually disagree, and a headline naming a team that is not row 1 of the
// table under it is worse than no table at all. So `ownDataDrilldown` returns
// `rows` sorted once and `driver` as `rows[0]` — the same object, not a second
// search — and the headline sentence is built from that object.
//
// THE RANKING IS BY SPEND. "Which team is driving this?" is a question about
// where the money is, so the order is total spend, descending, ties broken by
// name so the same export always ranks the same way. That is deliberately NOT
// the order `rankedDepartments` arrives in — the analysis sorts that by
// RECOVERABLE amount — and the difference is the point: the largest bill and
// the largest headroom are different findings, and this block owns the first.
//
// THE FALLBACK IS DECLARED, NOT GUESSED. Plenty of real exports carry no
// department or org-unit column at all. `GROUPING_PRECEDENCE` below is the
// order this module tries dimensions in, and it is the whole list: the first
// dimension the envelope actually carries wins, and the region says in visible
// text which one it landed on and why the one above it was not available. An
// export that carries none of them returns `available: false` rather than a
// table of one row called "Total", and the caller retires the region as before.
//
// This module builds no nodes, reads no document, opens no request and reads no
// clock. Every figure comes off the envelope `normalizeLocalFinopsHistory`
// already published — the same envelope the single-drop import path hands the
// rest of the page.

/** Bump when a dimension, the ranking rule, or a rendered sentence changes. */
export const OWN_DRILLDOWN_VERSION = "finops-own-drilldown/1.0.0";

/**
 * THE PRECEDENCE ORDER, most specific first.
 *
 *   1. department — the org unit the export (or the org roster joined to it)
 *      attributes spend to. It is first because it is the only dimension that
 *      answers "which TEAM is driving this" rather than "which of something
 *      else"; every other entry here is a consolation prize.
 *   2. billing month — the calendar periods inside the same import. Second
 *      because an export with no attribution key still tells a reader WHEN the
 *      money went, which is the next most actionable cut of one file.
 *
 * A provider list is deliberately not a candidate: the intake summary names who
 * was read but publishes no spend per provider, and a grouping with no figure
 * to rank by is a list, not a drill-down.
 */
export const GROUPING_PRECEDENCE = Object.freeze([
  Object.freeze({ id: "department", label: "department", plural: "departments", field: "department" }),
  Object.freeze({ id: "billing-month", label: "billing month", plural: "billing months", field: "billing period" }),
]);

const list = (value) => (Array.isArray(value) ? value : []);

const named = (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

const money = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);

/** "79000" → "79,000 USD". The currency is the envelope's own, or USD. */
function amount(value, currency) {
  return `${Math.round(value).toLocaleString("en-US")} ${currency}`;
}

/** The candidate rows one dimension can supply, already filtered to usable ones. */
function candidateRows(analysis, id) {
  if (id === "department") {
    return list(analysis?.rankedDepartments)
      .map((entry) => ({ name: named(entry?.name), spendUsd: money(entry?.spendUsd) }));
  }
  return list(analysis?.history?.periods)
    .map((entry) => ({ name: named(entry?.period), spendUsd: money(entry?.spendUsd) }));
}

/**
 * The one ranked view of an imported analysis.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`, or null.
 * @returns a frozen `{ available, grouping, rows, driver, headline, totalUsd }`.
 *   `driver` IS `rows[0]`, so the headline and the table cannot name different
 *   groups. `available` is false for a null analysis and for an export that
 *   carries none of the dimensions above, and every other field is then empty.
 */
export function ownDataDrilldown(analysis = null) {
  const currency = named(analysis?.currency) ?? "USD";
  let chosen = null;
  const missing = [];
  for (const dimension of GROUPING_PRECEDENCE) {
    const usable = candidateRows(analysis, dimension.id)
      .filter((row) => row.name !== null && row.spendUsd !== null);
    if (usable.length === 0) { missing.push(dimension); continue; }
    chosen = { dimension, usable };
    break;
  }
  if (!chosen) {
    return Object.freeze({
      version: OWN_DRILLDOWN_VERSION,
      available: false,
      grouping: null,
      rows: Object.freeze([]),
      driver: null,
      headline: null,
      totalUsd: null,
    });
  }

  const totalUsd = chosen.usable.reduce((sum, row) => sum + row.spendUsd, 0);
  // Sorted ONCE. Everything below reads this array, including the driver.
  const rows = Object.freeze(chosen.usable
    .slice()
    .sort((left, right) => right.spendUsd - left.spendUsd
      || left.name.localeCompare(right.name))
    .map((row, index) => Object.freeze({
      rank: index + 1,
      name: row.name,
      spendUsd: row.spendUsd,
      spend: amount(row.spendUsd, currency),
      sharePercent: Math.round((row.spendUsd / totalUsd) * 100),
    })));
  const driver = rows[0];
  const fallback = missing.length > 0;
  const grouping = Object.freeze({
    id: chosen.dimension.id,
    label: chosen.dimension.label,
    plural: chosen.dimension.plural,
    fallback,
    // Both halves of the sentence the region is required to say out loud: WHICH
    // grouping it fell back to, and WHY the one above it was not available.
    note: fallback
      ? `Grouped by ${chosen.dimension.label} — this export has no `
        + `${missing.map((entry) => entry.field).join(" or ")} field.`
      : `Grouped by ${chosen.dimension.label} — the dimension your export carries.`,
  });

  return Object.freeze({
    version: OWN_DRILLDOWN_VERSION,
    available: true,
    grouping,
    rows,
    driver,
    totalUsd,
    headline: Object.freeze({
      driverName: driver.name,
      // The figure is in the headline sentence itself rather than in a slot
      // under it, because this line stays on screen when the drill-down below
      // is collapsed. A headline number a reader has to open a disclosure to
      // see is not a headline.
      value: `${driver.name} is driving ${driver.spend} of ${amount(totalUsd, currency)} `
        + `— ${driver.sharePercent}% of the spend in your export.`,
      detail: `Ranked 1 of ${rows.length} ${rows.length === 1 ? grouping.label : grouping.plural} `
        + "by total spend. Computed in this browser tab from the file you chose.",
    }),
  });
}
