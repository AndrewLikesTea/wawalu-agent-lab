// Prove, on the page, that the export describes the history the reader is
// looking at.
//
// WHY THIS EXISTS. Every other proof that the file matches the screen lives in
// a test suite. A reader about to hand a JSON file to an auditor cannot run
// those, and the two failure directions are both silent: a file missing a
// record loses history from the audit, and a file carrying a record nobody
// reviewed on screen puts an unreviewed record into it. So the page answers the
// question itself, in the reader's browser, against the reader's records.
//
// WHAT IT DOES NOT DO. No network, no fetch, and no download: the payload comes
// from buildShiplogExport() — the same function the Download JSON button calls,
// called rather than re-implemented, because a check with its own copy of the
// serialization would agree with itself and prove nothing. The check writes
// nothing to storage and changes no record.
//
// THE COMPARISON. One side is the payload; the other is the rendered history
// rows, read back off the DOM the way a reader reads them. Records are matched
// by kind and id rather than by position, because the history sorts for a
// reader and the file sorts canonically, and a difference in order is not a
// difference in content. Three fields per record are compared: the title a row
// leads with, its status badge, and its owner. Those are the fields a row
// prints in its own words, which is what makes this a comparison of two
// independent readings rather than of one value against itself.
//
// TWO DOCUMENTED NORMALIZATIONS, both applied to the exported side so that it
// speaks the rendered vocabulary, and both deliberately narrow:
//
//   1. The retired decision status "approved". Every surface reads it as
//      "accepted" while the file keeps the stored word (decision-status.js).
//   2. A release with no stored status, and a release whose owner is stored
//      under the older `author` key. releases.js renders a documented value for
//      both, and the row shows that value.
//
// Nothing else is folded. Whitespace is collapsed on both sides because the DOM
// collapses it when it renders, and a row that shows a different word, a
// dropped clause, or a different owner still differs.
//
// EXAMPLE ROWS ARE NOT COMPARED. The example records are a module constant the
// history composes in and never stores, so the file does not carry them and
// must not. They are identified by the badge the row itself prints, so a row
// that stops being badged as an example starts being compared.

import { buildShiplogExport } from "./shiplog-export.js";
import { readHistoryScope } from "./history-scope.js";
import { historyFilterChips } from "./history-filters.js";
import { canonicalDecisionStatus } from "./decision-status.js";
import { releaseOwner, releaseStatus } from "./releases.js";

/** The fields compared per record kind, named once. */
export const CHECKED_FIELDS = Object.freeze({
  decision: Object.freeze(["title", "status", "owner"]),
  release: Object.freeze(["version", "status", "owner"]),
});

/** The pseudo-field for a record that is on one side only. */
export const PRESENCE = "presence";

const collapse = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const text = (node) => collapse(node?.textContent);

const keyOf = (record) => `${record.type}:${record.id}`;

// --- reading the rendered history ---------------------------------------------

// A row prints a field's own label immediately before its value and with no
// separator between them ("OwnerAri"), so the label is stripped to get back the
// value a reader reads.
function labelled(card, selector, label) {
  const value = text(card.querySelector(selector));
  return value.startsWith(label) ? value.slice(label.length).trim() : value;
}

function metaValue(card, label) {
  const pair = [...card.querySelectorAll(".meta-pair")]
    .find((candidate) => text(candidate.querySelector(".meta-label")) === `${label}:`);
  return pair ? text(pair.querySelector(".meta-value")) : "";
}

// Both rows link to their own detail page and carry the record id in the query,
// which is the one place a row states its id in a form neither kind ambiguates.
function linkedId(card) {
  try {
    return new URL(card.getAttribute("href") ?? "", "https://labs.wawalu.org").searchParams.get("id") ?? "";
  } catch {
    return "";
  }
}

// A release row leads with its version, and adds its title after a separator
// when the two differ (app.js: renderReleaseRow). The version is the part the
// file carries under that name, so it is the part compared.
const VERSION_SEPARATOR = " · ";

/**
 * Every history row on the page, as the fields under comparison.
 *
 * Selected by the two row classes rather than by a descendant selector: the
 * classes are carried only by history rows, and the test harness this runs
 * under rejects combinators.
 */
export function renderedHistoryRecords(root) {
  return [...root.querySelectorAll(".decision-card,.release-card")]
    .filter((card) => card.querySelector(".badge-example") === null)
    .map((card) => {
      const heading = text(card.querySelector("h3"));
      const release = card.classList.contains("release-card");
      const record = {
        type: release ? "release" : "decision",
        id: linkedId(card),
        status: metaValue(card, "Status"),
        owner: labelled(card, ".owner", "Owner"),
      };
      if (release) [record.version] = heading.split(VERSION_SEPARATOR);
      else record.title = heading;
      return record;
    });
}

// --- reading the export --------------------------------------------------------

/** The same fields, read off the payload the download would carry. */
export function exportedHistoryRecords(payload) {
  const decisions = (payload?.decisions ?? []).map((record) => ({
    type: "decision",
    id: record.id,
    title: collapse(record.title),
    status: canonicalDecisionStatus(collapse(record.status)),
    owner: collapse(record.owner),
  }));
  const releases = (payload?.releases ?? []).map((record) => ({
    type: "release",
    id: record.id,
    version: collapse(record.version),
    status: releaseStatus(record),
    owner: collapse(releaseOwner(record)),
  }));
  return [...decisions, ...releases];
}

// --- comparing them ------------------------------------------------------------

/**
 * Compare the two readings.
 *
 * @returns `{ matched, comparedCount, differences }`, where `comparedCount` is
 *   the number of rows the reader can see — the set this walked — and each
 *   difference is `{ type, id, field, shown, carried }`. A record on one side
 *   only is reported once, as the `PRESENCE` field, rather than as one
 *   difference per field it could not be compared on.
 */
export function compareHistoryExport(rendered, exported) {
  const differences = [];
  const carried = new Map(exported.map((record) => [keyOf(record), record]));
  const shown = new Set(rendered.map((record) => keyOf(record)));

  for (const row of rendered) {
    const file = carried.get(keyOf(row));
    if (!file) {
      differences.push({ type: row.type, id: row.id, field: PRESENCE, shown: "shown", carried: "missing" });
      continue;
    }
    for (const field of CHECKED_FIELDS[row.type]) {
      if (row[field] !== file[field]) {
        differences.push({ type: row.type, id: row.id, field, shown: row[field], carried: file[field] });
      }
    }
  }
  for (const file of exported) {
    if (!shown.has(keyOf(file))) {
      differences.push({ type: file.type, id: file.id, field: PRESENCE, shown: "missing", carried: "carried" });
    }
  }

  return { matched: differences.length === 0, comparedCount: rendered.length, differences };
}

// --- saying it -----------------------------------------------------------------

/**
 * Which filter was in effect, in the words the filter chips use.
 *
 * An unfiltered view says so rather than saying nothing: "no filters are
 * active" is the fact that makes the count above it mean the whole history.
 */
export function describeCheckedFilters(filters) {
  const chips = historyFilterChips(filters);
  return chips.length === 0
    ? "no filters are active"
    : `your filters are ${chips.map((chip) => chip.text).join(", ")}`;
}

// "stored" earns its place: the history also shows example rows, which are a
// module constant the file never carries and this check never counts. Without
// the word, a first visit reads "the same 0 records" above five visible rows.
const recordWord = (count) => (count === 1 ? "stored record" : "stored records");

function describeDifference({ id, field, shown, carried }) {
  if (field === PRESENCE) {
    return carried === "missing"
      ? `record ${id} is shown here and is not in the export`
      : `record ${id} is in the export and is not shown here`;
  }
  return `record ${id} differs on ${field} (shown as ${shown}, exported as ${carried})`;
}

/**
 * The one sentence the reader gets.
 *
 * One material number, always the same one: how many records were compared.
 * A second count — how many differed, how many the file held — would make the
 * reader work out which number answers their question. The first difference is
 * named in full because "something differs" is not an answer anybody can act
 * on; the rest are one disclosure away.
 */
export function describeHistoryExportCheck(result, filters) {
  const counted = `${result.comparedCount} ${recordWord(result.comparedCount)}`;
  const filterPhrase = describeCheckedFilters(filters);
  if (result.matched) {
    return `Matched: the export carries the same ${counted} this history is showing, and ${filterPhrase}.`;
  }
  return `Not matched: ${counted} checked while ${filterPhrase}, and ${describeDifference(result.differences[0])}.`;
}

/** One line per difference, for the disclosure under the sentence. */
export function differenceLines(result) {
  return result.differences.map(describeDifference);
}

export const CHECK_FAILED =
  "The export could not be checked. Your records were not changed. Try again, or reload this page.";

// --- the control ---------------------------------------------------------------

export function initHistoryExportCheck(root, storage, options = {}) {
  const button = root.querySelector("#verify-shiplog");
  const result = root.querySelector("#verify-shiplog-result");
  const detail = root.querySelector("#verify-shiplog-detail");
  const list = root.querySelector("#verify-shiplog-differences");
  if (!button || !result || !list) return;
  // `root` is the document on the history page and an element in a test that
  // mounts the panel alone, so the owning document is resolved rather than
  // assumed.
  const documentRef = typeof root.createElement === "function" ? root : root.ownerDocument;

  button.addEventListener("click", () => {
    list.replaceChildren();
    try {
      // The scope the history published for the rows on screen, so a filtered
      // view checks the filtered file. Read at press time rather than held,
      // because the reader may have changed a filter since the page loaded.
      const scope = readHistoryScope(root);
      const { payload } = buildShiplogExport(storage, {
        generatedAt: options.now?.().toISOString(),
        scope,
      });
      const comparison = compareHistoryExport(renderedHistoryRecords(root), exportedHistoryRecords(payload));
      result.textContent = describeHistoryExportCheck(comparison, scope.filters);
      for (const line of differenceLines(comparison)) {
        const item = documentRef.createElement("li");
        item.textContent = line;
        list.append(item);
      }
      if (detail) detail.hidden = comparison.matched;
    } catch {
      result.textContent = CHECK_FAILED;
      if (detail) detail.hidden = true;
    }
  });
}
