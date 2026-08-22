// Export the release log a visitor is looking at, as one JSON file.
//
// The whole point of this module is that the file and the list agree. The page
// already computes exactly one selection — `mountReleaseList`'s render returns
// the resolved releases it drew — and this module is handed that array. It does
// not re-run `filterReleases`, does not read the rendered DOM, and does not go
// back to storage. A second filter implementation is the one way the file could
// quietly stop being what the reader was shown, so there isn't one.
//
// Split in two on purpose:
//
//   * `buildReleaseExport` is pure. Array in, plain serialisable object out. No
//     DOM, no Blob, no URL, no clock unless one is passed. Every claim this file
//     makes about its contents is asserted against this function directly.
//   * `downloadReleaseExport` is the side effect, and only the side effect. It
//     feature-detects Blob/URL/createObjectURL and returns false rather than
//     throwing where they are absent, so a browser (or a test environment)
//     without them gets a stated failure instead of a broken click handler.
//
// Records are written through the declared field lists in
// shiplog-export-schema.js, the same lists the whole-history export uses. That
// strips the resolution artifacts the renderer adds (`associations`, `counts`)
// and, more importantly, means a key another module leaves on a stored record
// cannot ride out to disk just because it happened to be on the object.

import {
  EXPORT_DECISION_FIELDS,
  EXPORT_RELEASE_FIELDS,
  normalizeExportRecord,
} from "./shiplog-export-schema.js";

/** What a consumer reads to know which file shape they are holding. */
export const RELEASE_EXPORT_SCHEMA = "shiplog-releases";
export const RELEASE_EXPORT_VERSION = 1;

// The site's own sentence about its sample data, character for character, taken
// from the record log's disclosure on the home page and pinned to it by a test.
// Reused rather than reworded: a file opened a year from now has to carry the
// same disclaimer as the page it came from, and two phrasings of one promise is
// how they drift. It rides on the payload as `notice`, before the records, so
// nothing in this file can be mistaken for customer or production data.
export const EXAMPLE_RECORDS_NOTICE =
  "Includes example records to demonstrate Shiplog. They use no customer or production data.";

/** The visible words on the control, which say what pressing it produces. */
export const RELEASE_EXPORT_BUTTON_LABEL = "Export releases as JSON";

// Static text beside the control. It is true on every render — including the
// unfiltered one, where "the releases shown" is the whole log — so it never has
// to be repainted and can never disagree with the file that was just written.
export const RELEASE_EXPORT_SCOPE_SENTENCE =
  "The JSON download includes only the releases currently shown by the active search and filters, "
  + "not the full release log. Each exported release includes its linked decisions.";

/**
 * The status line after a press, in the visitor's own number.
 *
 * Zero is a sentence like any other rather than a silent press or a disabled
 * control: the filters matched nothing, the file says so with an empty record
 * set and the same envelope, and this states the count that landed.
 */
export function releaseExportStatusText(count) {
  const number = Number.isInteger(count) && count >= 0 ? count : 0;
  const word = number === 1 ? "release" : "releases";
  return `Exported ${number} ${word} to a JSON file, matching what the filters are showing.`;
}

export const RELEASE_EXPORT_FAILED =
  "The releases could not be exported in this browser. Nothing on this page changed.";

/**
 * Build the file's contents from the releases the list rendered.
 *
 * @param shown resolved releases, in the order they are on screen — exactly what
 *   `mountReleaseList(...).render()` returned.
 * @param options.exampleIds the ids this visitor has not taken over, so a record
 *   badged "Example record" on screen is flagged in the file too.
 * @param options.generatedAt an ISO instant; defaults to now.
 */
export function buildReleaseExport(shown, options = {}) {
  const source = Array.isArray(shown) ? shown : [];
  const exampleIds = options.exampleIds instanceof Set
    ? options.exampleIds
    : new Set(Array.isArray(options.exampleIds) ? options.exampleIds : []);
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const releases = source.map((resolved) => ({
    ...normalizeExportRecord(resolved, EXPORT_RELEASE_FIELDS),
    // The badge the row carries, as a field. Per record rather than per file,
    // because a filtered view can hold the visitor's own releases and the
    // shipped examples at once.
    example: exampleIds.has(resolved?.id),
    // The linkage the page renders, not the ids alone: the row names each
    // decision and shows its status, so a file that carried only ids would be
    // less than what the reader was looking at. Association order is preserved
    // — that sequence is content the visitor authored.
    decisions: (resolved?.decisions ?? [])
      .map((decision) => normalizeExportRecord(decision, EXPORT_DECISION_FIELDS)),
    // A link naming a decision this browser no longer holds is reported rather
    // than dropped, so the file cannot claim a release carried fewer decisions
    // than it recorded. The row says the same thing.
    missingDecisionIds: [...(resolved?.missingIds ?? [])],
  }));

  return {
    schema: RELEASE_EXPORT_SCHEMA,
    version: RELEASE_EXPORT_VERSION,
    generatedAt,
    notice: EXAMPLE_RECORDS_NOTICE,
    // The size of what was actually written, taken from the array below rather
    // than counted a second time, so the envelope cannot disagree with it.
    release_count: releases.length,
    releases,
  };
}

/**
 * The name the file lands under: `shiplog-releases-2026-08-15T18-30-00Z.json`.
 *
 * Named for the instant, so two exports of two filter states do not collide.
 * No visitor text reaches it — the whole name is a constant prefix plus digits,
 * `T`, `-` and `Z` — so there is nothing to escape and nothing a filesystem
 * refuses. The ISO colons are replaced because Windows rejects them.
 */
export function releaseExportFilename(payload = {}) {
  const parsed = Date.parse(payload?.generatedAt);
  if (Number.isNaN(parsed)) return "shiplog-releases.json";
  return `shiplog-releases-${new Date(parsed).toISOString().slice(0, 19).replace(/:/g, "-")}Z.json`;
}

/**
 * Hand the visitor the file. Returns whether one was actually written.
 *
 * Every capability is looked up before it is used. An environment without Blob
 * or createObjectURL gets `false` and the caller says so out loud, which is the
 * difference between a stated failure and a click handler that throws.
 */
export function downloadReleaseExport(payload, options = {}) {
  const documentRef = options.document ?? globalThis.document;
  const urlApi = options.urlApi ?? globalThis.URL;
  const BlobRef = options.Blob ?? globalThis.Blob;
  if (typeof documentRef?.createElement !== "function") return false;
  if (typeof BlobRef !== "function") return false;
  if (typeof urlApi?.createObjectURL !== "function") return false;

  // One serialization of one plain object. Nothing here is markup and no record
  // text is concatenated into a string, so a release holding `<`, `&` or a quote
  // survives as those characters and re-parses to the record it came from.
  const href = urlApi.createObjectURL(
    new BlobRef([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }),
  );
  const link = documentRef.createElement("a");
  link.href = href;
  link.download = releaseExportFilename(payload);
  link.click();
  urlApi.revokeObjectURL?.(href);
  return true;
}

/**
 * Wire the control on the Releases page.
 *
 * `options.shown` is a getter the page owns, returning the array its last render
 * drew. The button reads it at press time rather than holding a copy, so a
 * filter changed between load and press exports the new selection and never a
 * stale one.
 */
export function initReleaseExport(root, options = {}) {
  const button = root.querySelector("#release-export");
  const status = root.querySelector("#release-export-status");
  if (!button) return;
  const download = options.download ?? downloadReleaseExport;

  button.addEventListener("click", () => {
    const shown = options.shown?.() ?? [];
    let written = false;
    try {
      const payload = buildReleaseExport(shown, {
        exampleIds: options.exampleIds,
        generatedAt: options.now?.().toISOString(),
      });
      written = download(payload, { document: root.ownerDocument ?? root }) !== false;
      // The count is the length of what went into the file, not a second count
      // of the rows, so the sentence and the payload cannot disagree.
      if (status && written) status.textContent = releaseExportStatusText(payload.releases.length);
    } catch {
      written = false;
    }
    if (status && !written) status.textContent = RELEASE_EXPORT_FAILED;
  });
}
