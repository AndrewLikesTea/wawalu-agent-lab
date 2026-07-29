// The server-side Shiplog snapshot: every decision, every release, and the
// release-to-decision associations stated as their own records.
//
// `/api/exports` used to hand back whatever rows the tables held, in whatever
// order SQLite returned them, with the associations reachable only by reading
// `decisionIds` off each release. That is a database dump, not a snapshot an
// engineering lead can rely on. This module turns it into a closed record:
//
//   * Closed field set. Every exported record is rebuilt from the shipped
//     export contract (`EXPORT_DECISION_FIELDS` / `EXPORT_RELEASE_FIELDS` in
//     shiplog-export-schema.js), so a column the table grows later — an
//     internal flag, an imported identifier, anything PRODUCT.md rules out of
//     this product — is not carried into the file by a `SELECT *`. The
//     allowlist is the only version of that promise that survives a schema
//     change nobody re-reviewed.
//   * One order. Both collections are written in the canonical export order
//     (oldest `createdAt` first, ties by id) that the browser exporter already
//     uses, so the same tables produce the same bytes and two snapshots diff
//     cleanly. Links follow release order and then the position the release
//     recorded them in.
//   * Explicit associations. `links` is a flat list of
//     `{ releaseId, decisionId, position }`. A consumer joining the two logs no
//     longer has to know that the join lives inside a release field, and the
//     association survives formats (CSV, a table, a spreadsheet) that flatten
//     nested arrays away. `release.decisionIds` stays as it was — the same
//     facts, in the shape the rest of the product already reads.
//   * No dangling reference. A release naming a decision the tables no longer
//     hold is reported in `unresolvedLinks` rather than written as a link that
//     resolves to nothing, matching what the browser exporter and importer
//     already do. A reader holding only this file can resolve every association
//     it claims.
//   * No loss at the edges. A decision no release mentions and a release that
//     names no decision are both ordinary records here; only the `links` list
//     is empty for them. `counts` states how many of each there are, so
//     "nothing links to this" is visible in the file instead of being inferred
//     from an absence.
//
// Nothing here touches storage, the clock, or the network: it takes rows and
// returns a payload.

import {
  EXPORT_DECISION_FIELDS,
  EXPORT_RELEASE_FIELDS,
  canonicalExportOrder,
  normalizeExportRecord,
} from "./shiplog-export-schema.js";

/** The columns of a decision row that may leave the server, in file order. */
export const SNAPSHOT_DECISION_FIELDS = EXPORT_DECISION_FIELDS;

/** The columns of a release row that may leave the server, in file order. */
export const SNAPSHOT_RELEASE_FIELDS = EXPORT_RELEASE_FIELDS;

function claimedDecisionIds(release) {
  // A release row that lost its array — an unparsed JSON column, a NULL, a
  // hand-written row — claims no association rather than exporting a shape the
  // contract does not allow.
  return Array.isArray(release?.decisionIds) ? release.decisionIds : [];
}

/** Decision rows as export records: allowlisted fields, canonical order. */
export function snapshotDecisions(rows) {
  return canonicalExportOrder(rows)
    .map((row) => normalizeExportRecord(row, SNAPSHOT_DECISION_FIELDS));
}

/**
 * Release rows as export records: allowlisted fields, canonical order, and a
 * `decisionIds` array even when the row carried none.
 */
export function snapshotReleases(rows) {
  return canonicalExportOrder(rows).map((row) => {
    const release = normalizeExportRecord(row, SNAPSHOT_RELEASE_FIELDS);
    release.decisionIds = claimedDecisionIds(release)
      .filter((decisionId) => typeof decisionId === "string");
    return release;
  });
}

/**
 * Join both logs into one snapshot.
 *
 * @returns `{ decisions, releases, links, unresolvedLinks, counts }`.
 *   `links` holds one `{ releaseId, decisionId, position }` per association
 *   that resolves inside this snapshot; `unresolvedLinks` holds the same shape
 *   for every id that does not, and those ids are removed from the release's
 *   own `decisionIds` so the two views of the association never disagree.
 */
export function linkShiplogRecords(decisionRows, releaseRows) {
  const decisions = snapshotDecisions(decisionRows);
  const known = new Set(decisions.map((decision) => decision.id));

  const links = [];
  const unresolvedLinks = [];
  const linkedDecisions = new Set();
  let releasesWithoutDecisions = 0;

  const releases = snapshotReleases(releaseRows).map((release) => {
    const resolved = [];
    // Position is the index the release recorded, not the index in the
    // filtered list, so an unresolved link names where it sat in the original
    // record.
    release.decisionIds.forEach((decisionId, position) => {
      if (!known.has(decisionId)) {
        unresolvedLinks.push({ releaseId: release.id, decisionId, position });
        return;
      }
      resolved.push(decisionId);
      links.push({ releaseId: release.id, decisionId, position });
      linkedDecisions.add(decisionId);
    });
    release.decisionIds = resolved;
    if (resolved.length === 0) releasesWithoutDecisions += 1;
    return release;
  });

  return {
    decisions,
    releases,
    links,
    unresolvedLinks,
    counts: {
      decisions: decisions.length,
      releases: releases.length,
      links: links.length,
      decisionsWithoutReleases: decisions.length - linkedDecisions.size,
      releasesWithoutDecisions,
    },
  };
}
