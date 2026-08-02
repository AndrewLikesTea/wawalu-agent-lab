// The department drill-down an imported export earns, in the region the
// bundled example already owns.
//
// WHAT THIS FIXES (#979). The first-run region is the richest thing on this
// page — a headline, a ranked internal comparison, and the evidence behind both
// one keystroke away — and it was the first thing to go. Importing your own
// export de-ranked and hid the whole region, so the reader who supplied real
// data got LESS structure than the visitor who supplied none.
//
// Retiring it was half right. A synthetic headline must never stand beside a
// real one; that is the rule the retirement existed to keep. But the drill-down
// under that headline is not an answer, it is a SHAPE — which group carries the
// money — and that shape is exactly what a reader's own export can fill. So the
// example's summary is withheld (the one-summary rule holds, the imported
// headline in `#finops-imported-headline` is it) and the drill-down beneath it
// is recomputed from the import.
//
// THE RANK-1 IDENTITY. `rankDepartments` is the function whose first element
// that headline names as the driving department. Rank 1 here and the named
// driver there are the same call, not two that agree today.
//
// It builds no node, reads no storage, opens no request, reads no clock, and
// re-analyzes nothing: every figure is read off the envelope
// `normalizeLocalFinopsHistory` already published.

import { BAND_PRESENTATION, BAND_STATE } from "./finops-first-run.js";
import { rankDepartments } from "./finops-imported-headline.js";

/** Bump when a row, a state word, or the grouping rule changes meaning. */
export const IMPORTED_DRILLDOWN_VERSION = "finops-imported-drilldown/1.0.0";

/** The eyebrow, the question, and the disclosure heading, authored once. */
export const DRILLDOWN_COPY = Object.freeze({
  word: "Your export",
  question: "Where is your recoverable spend concentrated?",
  heading: "How this drill-down was computed and what it cannot tell you",
  slotLabel: "Drill-down · groups ranked by recoverable spend",
  provenance:
    "Every figure below is computed in this browser from the export you imported. "
    + "It is your spend, not the bundled example's, and nothing here was uploaded.",
});

/**
 * The grouping words, so the fallback sentence and its tests cannot disagree.
 *
 * A department here is an org-roster fact: `local-finops.js` types a unit as one
 * only when an HRIS export named it. An import with no roster still groups
 * perfectly well — by whatever the provider's own export groups by — and the
 * region's job then is to SAY SO rather than print unlabelled rows under a
 * heading that promises departments.
 */
export const DRILLDOWN_GROUPING = Object.freeze({
  department: "department",
  /** What the sentence says when the provider dialect named no grouping unit. */
  unnamed: "the grouping column in your export",
});

/** The one reason a group ranking can be absent, in the words it uses. */
export const DRILLDOWN_UNAVAILABLE =
  "No group in this export carries recoverable spend, so there is nothing to rank.";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

const money = (value) => (Number.isFinite(Number(value)) ? USD.format(Number(value)) : null);

/** A whole-percent share, or null. A share of nothing is unknown, not 0%. */
function share(part, whole) {
  const top = Number(part);
  const bottom = Number(whole);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return null;
  return `${Math.round((top / bottom) * 100)}%`;
}

/** A band descriptor in the shape `paintBand` already draws. */
function band(state, label) {
  return Object.freeze({ state, label, ...BAND_PRESENTATION[state] });
}

/**
 * Which grouping this ranking is on, and — when it is not departments — why.
 *
 * The fallback sentence names the grouping it fell back to AND the reason in
 * one breath, because a reader who is told only "grouped by project" cannot
 * tell a product decision from a missing column in their own file.
 */
export function drilldownGrouping({ departmentDimension = false, groupingUnit = null } = {}) {
  if (departmentDimension) {
    return Object.freeze({
      fellBack: false,
      unit: DRILLDOWN_GROUPING.department,
      statement: "Grouped by department, from the org roster export you imported beside it.",
    });
  }
  const unit = typeof groupingUnit === "string" && groupingUnit.trim()
    ? groupingUnit.trim() : DRILLDOWN_GROUPING.unnamed;
  return Object.freeze({
    fellBack: true,
    unit,
    statement: `No department field in this export — grouped by ${unit} instead. `
      + "Departments come from an org roster export, and this import carried none, so the "
      + `rows below are the ${unit} values the provider export itself already carries.`,
  });
}

/** One ranked row: the rank, the name, and the two figures that ordered it. */
function row(entry, index) {
  const recoverable = money(entry.recoverableUsd);
  const spend = money(entry.spendUsd);
  const portion = share(entry.recoverableUsd, entry.spendUsd);
  const figures = [`${recoverable} recoverable`];
  if (spend) figures.push(`${spend} spend`);
  if (portion) figures.push(`${portion} of this group's spend`);
  return Object.freeze({
    rank: index + 1,
    name: String(entry.name),
    recoverableUsd: Number(entry.recoverableUsd),
    spendUsd: Number(entry.spendUsd),
    term: `Rank ${index + 1} · ${entry.name}`,
    detail: `${figures.join(" · ")}.`,
  });
}

/**
 * Compose the drill-down from an imported analysis envelope.
 *
 * Total, like every other region on this first screen: a null envelope, a
 * malformed one, and one whose groups carry no recoverable spend all resolve to
 * a labelled unavailable state with the reason in it, never to an empty list
 * under a populated heading.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`, or null.
 * @param departmentDimension true when an org roster typed the groups.
 * @param groupingUnit the provider dialect's grouping word, when it has one.
 */
export function importedDrilldown({
  analysis = null, departmentDimension = false, groupingUnit = null,
} = {}) {
  const grouping = drilldownGrouping({ departmentDimension, groupingUnit });
  const ranked = rankDepartments(analysis).map(row);
  const base = { version: IMPORTED_DRILLDOWN_VERSION, ...DRILLDOWN_COPY, grouping };
  if (ranked.length === 0) {
    return Object.freeze({
      ...base,
      available: false,
      driver: null,
      rows: Object.freeze([]),
      headline: DRILLDOWN_UNAVAILABLE,
      band: band(BAND_STATE.withheld, "Nothing to rank"),
      entries: Object.freeze([Object.freeze({ term: "Grouping", detail: grouping.statement })]),
    });
  }
  const top = ranked[0];
  const portion = share(top.recoverableUsd, top.spendUsd);
  return Object.freeze({
    ...base,
    available: true,
    // The name and nothing else, so a caller can compare it against the
    // headline's driver without parsing a sentence.
    driver: top.name,
    rows: Object.freeze(ranked),
    headline: `${top.name} carries the most recoverable spend in your export: `
      + `${money(top.recoverableUsd)} of ${money(top.spendUsd)}${portion ? ` (${portion})` : ""}.`,
    band: band(BAND_STATE.behind, `Rank 1 of ${ranked.length}`),
    // The grouping first, then every ranked row. The evidence behind the
    // drill-down IS the ranking, so the disclosure holds the whole list rather
    // than a description of it.
    entries: Object.freeze([
      Object.freeze({ term: "Grouping", detail: grouping.statement }),
      Object.freeze({
        term: "Order",
        detail: "Recoverable spend, descending; ties broken by larger total spend, then by name. "
          + "A group with no recoverable spend is not ranked, because a zero is not a finding.",
      }),
      ...ranked.map((entry) => Object.freeze({ term: entry.term, detail: entry.detail })),
    ]),
  });
}
