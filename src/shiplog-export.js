// Download the decisions and releases this browser holds as one JSON file.
//
// The file's contract lives in shiplog-export-schema.js and is enforced here on
// the way out, not described after the fact:
//
//   * Only local Shiplog records. The two stores are read through
//     loadDecisions/loadReleases, so nothing else in localStorage — and no
//     example record, which is a module constant the page composes in and never
//     stores — can reach the file.
//   * Only records the visitor is looking at. When the history publishes a
//     filtered scope (see history-scope.js) the file follows it, because a
//     visitor who narrowed the history to two decisions and pressed Download
//     JSON should not receive the five they filtered away. With no filters
//     active — or with the panel's scope control set to the whole history — the
//     file is the whole store exactly as before.
//   * Only declared fields. Every record is rebuilt from the schema's field
//     list, so a key left on a record by another module or a hand-edited store
//     stays in the browser.
//   * Only resolvable links. A release's `decisionIds` are filtered to the
//     decisions this file actually carries; a link to a decision the browser no
//     longer holds is reported, not written as a dangling reference. This is the
//     same trade shiplog-import.js already makes on the way in, so
//     export -> import -> export is a fixed point.
//   * One order per log. Both collections are written in the schema's canonical
//     order (oldest first, ties by id) rather than in localStorage order, so the
//     same history exports to the same bytes no matter how it got into the
//     browser. A release's own `decisionIds` are left in the order the release
//     recorded them: that sequence is content the visitor authored, not an
//     artifact of storage, and re-sorting it would lose information.
//
// `buildShiplogExport` returns the payload together with what it had to leave
// out; `createShiplogExport` is the payload alone, for the callers that only
// want the file.

import { loadDecisions } from "./app.js";
import { loadReleases } from "./releases.js";
import {
  EXPORT_DECISION_FIELDS,
  EXPORT_RELEASE_FIELDS,
  SHIPLOG_EXPORT_SCHEMA,
  SHIPLOG_EXPORT_VERSION,
  canonicalExportOrder,
  normalizeExportRecord,
  undeclaredExportFields,
} from "./shiplog-export-schema.js";
import {
  normalizeHistoryScope,
  onHistoryScopeChanged,
  readHistoryScope,
  withinHistoryScope,
} from "./history-scope.js";
import { activeHistoryFilters } from "./history-filters.js";
import { onRecordsChanged } from "./shiplog-records.js";

export { SHIPLOG_EXPORT_SCHEMA, SHIPLOG_EXPORT_VERSION };

/** The two things the panel's scope control can mean. */
export const EXPORT_SCOPES = Object.freeze({ browsing: "browsing", stored: "stored" });

/**
 * Build the export payload and the report of what did not go into it.
 *
 * @param options.scope the browsed history scope (history-scope.js). Omitted, or
 *   unfiltered, means the whole store.
 * @returns `{ payload, unresolvedLinks, excludedLinks, droppedFields }`, where
 *   `unresolvedLinks` is `{ releaseId, decisionId, position }` per release link
 *   that named a decision this browser no longer holds, `excludedLinks` is the
 *   same shape for links to a decision the browser still holds but the visitor's
 *   filters hide, and `droppedFields` is `{ collection, id, field }` per
 *   undeclared key left behind.
 */
export function buildShiplogExport(storage, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new TypeError("Export generatedAt must be an ISO date.");
  }

  const droppedFields = [];
  const collect = (collection, record, fields) => {
    for (const field of undeclaredExportFields(record, fields)) {
      droppedFields.push({ collection, id: record.id, field });
    }
    return normalizeExportRecord(record, fields);
  };

  const scope = normalizeHistoryScope(options.scope);
  const storedDecisions = loadDecisions(storage);
  // Every decision the browser holds, whether or not the filters show it. A link
  // is only "unresolved" against this set: a decision the visitor filtered away
  // still exists, and reporting it as gone would be a lie about their data.
  const held = new Set(storedDecisions.map((decision) => decision.id));

  // Canonical order first, so everything downstream — the records, the
  // unresolved-link report, the dropped-field report — is a function of what
  // the browser holds and not of the order it happened to hold it in.
  const decisions = withinHistoryScope(canonicalExportOrder(storedDecisions), scope.decisionIds, scope)
    .map((decision) => collect("decisions", decision, EXPORT_DECISION_FIELDS));
  const known = new Set(decisions.map((decision) => decision.id));

  const unresolvedLinks = [];
  const excludedLinks = [];
  const associations = [];
  const releases = withinHistoryScope(canonicalExportOrder(loadReleases(storage)), scope.releaseIds, scope)
    .map((stored) => {
      const release = collect("releases", stored, EXPORT_RELEASE_FIELDS);
      release.decisionIds = release.decisionIds.filter((decisionId, position) => {
        if (known.has(decisionId)) return true;
        // The file stays internally consistent either way — no dangling link
        // survives — but the two reasons a link was dropped are kept apart, so
        // the panel can say which one happened.
        (held.has(decisionId) ? excludedLinks : unresolvedLinks)
          .push({ releaseId: release.id, decisionId, position });
        return false;
      });
      // Positions are indices into the list above — the one this file carries —
      // and so run 0,1,2… with no gaps. A dropped link leaves no hole here: the
      // entry it would have numbered is not in the file, and a consumer holding
      // only the file could not say what a missing index meant. That a link was
      // dropped is reported to the visitor by the panel, which is the surface
      // that can also say *which* of the two reasons it was.
      release.decisionIds.forEach((decisionId, position) => {
        associations.push({ decisionId, releaseId: release.id, position });
      });
      return release;
    });

  const filter = activeHistoryFilters(scope.filters);
  return {
    payload: {
      schema: SHIPLOG_EXPORT_SCHEMA,
      version: SHIPLOG_EXPORT_VERSION,
      generatedAt,
      // The file states its own size and its own provenance, before the records
      // rather than after them, so a reader knows what they are holding without
      // counting it: `record_count` is both arrays together, and `filter` names
      // the filters that produced them ({} when none were active).
      //
      // Neither is derived from the store a second time. The count is the length
      // of what was actually written, and the filter block is the state the
      // history published with the very ids above — so a file cannot claim a
      // count or a filter that disagrees with its own records.
      record_count: decisions.length + releases.length,
      filter,
      decisions,
      releases,
      // The decision-to-release join, stated once as its own collection so a
      // consumer can answer "which decisions shipped in which release, in what
      // order" by reading one flat list. It is derived — exactly
      // `releases[].decisionIds` flattened in file order — and `decisionIds`
      // stays on the release because the importer reads it; the schema check
      // holds the two to agreement rather than letting them drift.
      associations,
    },
    unresolvedLinks,
    excludedLinks,
    droppedFields,
    // The two facts the panel says out loud after a download. `filtered` is
    // "records were left out", which is the promise the button made — not
    // "a filter was set", which the block above already states.
    filtered: scope.filtered,
    recordCount: decisions.length + releases.length,
  };
}

export function createShiplogExport(storage, options = {}) {
  return buildShiplogExport(storage, options).payload;
}

export function shiplogExportCounts(storage, scopeInput) {
  const scope = normalizeHistoryScope(scopeInput);
  return {
    decisions: withinHistoryScope(loadDecisions(storage), scope.decisionIds, scope).length,
    releases: withinHistoryScope(loadReleases(storage), scope.releaseIds, scope).length,
    filtered: scope.filtered,
  };
}

/**
 * The sentence beside the button, in the visitor's own numbers.
 *
 * Two sentences rather than one with a clause bolted on: the filtered file is a
 * different promise from the stored file, and the phrase that ends the sentence
 * is the one a visitor scanning it will remember.
 */
export function formatShiplogExportCounts({ decisions, releases, filtered = false }) {
  const decisionLabel = decisions === 1 ? "decision" : "decisions";
  const releaseLabel = releases === 1 ? "release" : "releases";
  const counted = `${decisions} ${decisionLabel} and ${releases} ${releaseLabel}`;
  return filtered
    ? `Ready to export ${counted} matching your history filters.`
    : `Ready to export ${counted} stored in this browser.`;
}

const recordWord = (count) => (count === 1 ? "record" : "records");

/** The visible words on the download button, which never change. */
export const EXPORT_BUTTON_LABEL = "Download JSON";

/**
 * The button's accessible name, or "" when the visible label already says it.
 *
 * "Download JSON" is a fine label for a button that downloads the history and a
 * poor one for a button that downloads *eleven of the forty records* — the
 * sentence carrying that fact sits above the button, and a screen reader reading
 * the button alone would not hear it. So the scope rides on the control itself
 * when the file is narrower than the store, and the count is the same number the
 * history's own summary shows because both come from one selection.
 *
 * The visible label is kept at the front of the name: a speech-input user says
 * the words they can see, and a name that drops them stops answering to them.
 * Unfiltered returns "" so the caller *removes* the attribute rather than
 * restating the visible label in a second place that can go stale.
 */
export function shiplogExportLabel({ decisions = 0, releases = 0, filtered = false } = {}) {
  if (!filtered) return "";
  const total = decisions + releases;
  return `${EXPORT_BUTTON_LABEL}: export ${total} filtered ${recordWord(total)}`;
}

export const EXPORT_STATUS = Object.freeze({
  exported: "Shiplog history exported.",
  failed: "Shiplog history could not be exported. Your browser data was not changed.",
});

/**
 * The sentence a download adds when it had to leave a link out, or "".
 *
 * A dropped link is stated rather than swallowed: the visitor's file is smaller
 * than their store in a way they did not ask for, and the count is the only
 * place they would find that out. Split from the status line above because the
 * two download surfaces — this panel and the workspace backup — open with
 * different sentences and end with the same one.
 */
export function unresolvedLinkSentence({ unresolvedLinks = [] } = {}) {
  const count = unresolvedLinks.length;
  if (count === 0) return "";
  return count === 1
    ? "1 release link to a decision this browser no longer holds was left out."
    : `${count} release links to decisions this browser no longer holds were left out.`;
}

/**
 * The sentence a filtered download adds when a kept release pointed at a
 * decision the filters hide, or "".
 *
 * Separate from the sentence above because the fact is different: the decision is
 * still in the browser, and clearing the filters brings the link back. Saying "a
 * decision this browser no longer holds" here would send somebody looking for
 * data loss that did not happen.
 */
export function excludedLinkSentence({ excludedLinks = [] } = {}) {
  const count = excludedLinks.length;
  if (count === 0) return "";
  return count === 1
    ? "1 release link to a decision your filters hide was left out."
    : `${count} release links to decisions your filters hide were left out.`;
}

/**
 * What just landed on disk, in the visitor's own numbers.
 *
 * A filtered download says how many records it wrote, because "Shiplog history
 * exported" is the one sentence that would let a filtered visitor believe they
 * had backed up their history. Unfiltered keeps the sentence it always had:
 * the count is already beside the button and the file is everything.
 */
export function exportedRecordSentence({ recordCount, filtered = false } = {}) {
  if (filtered !== true || !Number.isInteger(recordCount)) return EXPORT_STATUS.exported;
  return `Exported ${recordCount} filtered ${recordWord(recordCount)}.`;
}

/** What the export panel's status line says after a successful download. */
export function describeShiplogExport(report) {
  return [exportedRecordSentence(report), unresolvedLinkSentence(report), excludedLinkSentence(report)]
    .filter(Boolean)
    .join(" ");
}

/**
 * The name the file lands under: `shiplog-history-2026-07-26T18-30-00Z.json`.
 *
 * Named for the *instant* rather than the day, because two exports of the same
 * history an hour apart — the whole store, then the filtered view — are two
 * different files, and a name that collides makes the second one silently
 * overwrite or become "(1)". Seconds are enough to separate two downloads a
 * person made; milliseconds would be noise in a name they have to read.
 *
 * Cross-platform safe by construction, not by sanitizing after the fact: the
 * whole name is a constant prefix plus digits, `T`, `-`, and `Z` derived from
 * the timestamp. The ISO colons are replaced, which is what Windows refuses and
 * what macOS shows back to a visitor as a slash. No visitor text reaches it —
 * not the search box, not an owner's name — so there is no user string to
 * escape, no length to cap, and no filter that can name the file something
 * embarrassing or something the filesystem rejects.
 *
 * An unparseable stamp drops the suffix rather than writing "Invalid Date" or
 * "NaN" into a filename. buildShiplogExport refuses one on the way in, so this
 * only answers for a hand-built payload.
 */
export function shiplogExportFilename(payload = {}) {
  const parsed = Date.parse(payload?.generatedAt);
  if (Number.isNaN(parsed)) return "shiplog-history.json";
  const stamp = new Date(parsed).toISOString().slice(0, 19).replace(/:/g, "-");
  return `shiplog-history-${stamp}Z.json`;
}

export function downloadShiplogExport(payload, options = {}) {
  const documentRef = options.document ?? document;
  const urlApi = options.urlApi ?? URL;
  // One serialization of one plain object. The payload is data all the way
  // down — no record text is ever concatenated into this string, and nothing
  // here or in the filename above is markup — so a record holding `<`, `&`, or a
  // quote survives as those characters and re-parses to the record it came from.
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const href = urlApi.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = href;
  link.download = shiplogExportFilename(payload);
  link.click();
  urlApi.revokeObjectURL(href);
}

export function initShiplogExport(root, storage, options = {}) {
  const button = root.querySelector("#export-shiplog");
  const counts = root.querySelector("#export-shiplog-counts");
  const status = root.querySelector("#export-shiplog-status");
  const scopeControl = root.querySelector("#export-shiplog-scope");
  if (!button || !counts) return;

  // The file follows the browsed history by default, and the control lets a
  // visitor ask for the whole store instead. Default rather than only choice
  // because a filtered file is what the button appears to promise, and the
  // widest-possible file is the one whose surprise is silent.
  const activeScope = () => (scopeControl?.value === EXPORT_SCOPES.stored
    ? undefined
    : readHistoryScope(root));

  // Repainted on every write and on every filter change, not only at load. The
  // button always exported what the store held; until these subscriptions the
  // sentence beside it kept advertising the count from the moment the page
  // opened, so a visitor who had just recorded a decision was told the file
  // would not contain it.
  const paintCounts = () => {
    const scoped = shiplogExportCounts(storage, activeScope());
    counts.textContent = formatShiplogExportCounts(scoped);
    // The button's own name follows the same numbers, repainted on the same
    // events. A visitor reading the button by itself — with a screen reader, or
    // with voice control — hears the scope of the file it will write, and the
    // attribute is removed rather than left behind when the filters clear.
    const label = shiplogExportLabel(scoped);
    if (label) button.setAttribute?.("aria-label", label);
    else button.removeAttribute?.("aria-label");
  };
  paintCounts();
  onRecordsChanged(root, paintCounts);
  onHistoryScopeChanged(root, paintCounts);
  scopeControl?.addEventListener?.("change", paintCounts);
  button.addEventListener("click", () => {
    try {
      const report = buildShiplogExport(storage, {
        generatedAt: options.now?.().toISOString(),
        scope: activeScope(),
      });
      (options.download ?? downloadShiplogExport)(report.payload);
      if (status) status.textContent = describeShiplogExport(report);
    } catch {
      if (status) status.textContent = EXPORT_STATUS.failed;
    }
  });
}
