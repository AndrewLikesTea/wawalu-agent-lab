// Download the decisions and releases this browser holds as one JSON file.
//
// The file's contract lives in shiplog-export-schema.js and is enforced here on
// the way out, not described after the fact:
//
//   * Only local Shiplog records. The two stores are read through
//     loadDecisions/loadReleases, so nothing else in localStorage — and no
//     example record, which is a module constant the page composes in and never
//     stores — can reach the file.
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
import { onRecordsChanged } from "./shiplog-records.js";

export { SHIPLOG_EXPORT_SCHEMA, SHIPLOG_EXPORT_VERSION };

/**
 * Build the export payload and the report of what did not go into it.
 *
 * @returns `{ payload, unresolvedLinks, droppedFields }`, where
 *   `unresolvedLinks` is `{ releaseId, decisionId, position }` per release link
 *   that named a decision this browser no longer holds, and `droppedFields` is
 *   `{ collection, id, field }` per undeclared key left behind.
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

  // Canonical order first, so everything downstream — the records, the
  // unresolved-link report, the dropped-field report — is a function of what
  // the browser holds and not of the order it happened to hold it in.
  const decisions = canonicalExportOrder(loadDecisions(storage))
    .map((decision) => collect("decisions", decision, EXPORT_DECISION_FIELDS));
  const known = new Set(decisions.map((decision) => decision.id));

  const unresolvedLinks = [];
  const releases = canonicalExportOrder(loadReleases(storage)).map((stored) => {
    const release = collect("releases", stored, EXPORT_RELEASE_FIELDS);
    release.decisionIds = release.decisionIds.filter((decisionId, position) => {
      if (known.has(decisionId)) return true;
      unresolvedLinks.push({ releaseId: release.id, decisionId, position });
      return false;
    });
    return release;
  });

  return {
    payload: {
      schema: SHIPLOG_EXPORT_SCHEMA,
      version: SHIPLOG_EXPORT_VERSION,
      generatedAt,
      decisions,
      releases,
    },
    unresolvedLinks,
    droppedFields,
  };
}

export function createShiplogExport(storage, options = {}) {
  return buildShiplogExport(storage, options).payload;
}

export function shiplogExportCounts(storage) {
  return {
    decisions: loadDecisions(storage).length,
    releases: loadReleases(storage).length,
  };
}

export function formatShiplogExportCounts({ decisions, releases }) {
  const decisionLabel = decisions === 1 ? "decision" : "decisions";
  const releaseLabel = releases === 1 ? "release" : "releases";
  return `Ready to export ${decisions} ${decisionLabel} and ${releases} ${releaseLabel} stored in this browser.`;
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

/** What the export panel's status line says after a successful download. */
export function describeShiplogExport(report) {
  return [EXPORT_STATUS.exported, unresolvedLinkSentence(report)].filter(Boolean).join(" ");
}

export function downloadShiplogExport(payload, options = {}) {
  const documentRef = options.document ?? document;
  const urlApi = options.urlApi ?? URL;
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const href = urlApi.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = href;
  link.download = `shiplog-history-${payload.generatedAt.slice(0, 10)}.json`;
  link.click();
  urlApi.revokeObjectURL(href);
}

export function initShiplogExport(root, storage, options = {}) {
  const button = root.querySelector("#export-shiplog");
  const counts = root.querySelector("#export-shiplog-counts");
  const status = root.querySelector("#export-shiplog-status");
  if (!button || !counts) return;

  // Repainted on every write, not only at load. The button always exported what
  // the store held; until this subscription the sentence beside it kept
  // advertising the count from the moment the page opened, so a visitor who had
  // just recorded a decision was told the file would not contain it.
  const paintCounts = () => {
    counts.textContent = formatShiplogExportCounts(shiplogExportCounts(storage));
  };
  paintCounts();
  onRecordsChanged(root, paintCounts);
  button.addEventListener("click", () => {
    try {
      const report = buildShiplogExport(storage, {
        generatedAt: options.now?.().toISOString(),
      });
      (options.download ?? downloadShiplogExport)(report.payload);
      if (status) status.textContent = describeShiplogExport(report);
    } catch {
      if (status) status.textContent = EXPORT_STATUS.failed;
    }
  });
}
