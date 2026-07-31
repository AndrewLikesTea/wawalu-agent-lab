// What the executive briefing is built from, decided before anything is drawn.
//
// The briefing surface has exactly two things it may render: **this browser's
// own retained FinOps periods**, or the **published synthetic sample**. There is
// no third source, and in particular there is no upload, no fetch of anyone's
// figures, no credential, and no link that could carry a record — the only
// inputs this module can reach are the workspace document `finops-workspace.js`
// already keeps and the fixture the artifact already ships.
//
// Deciding it here, away from the DOM, is deliberate. "Is this the reader's own
// spend, and if not, why not?" is the first question the page has to answer
// honestly, it has six different answers, and a decision spread across render
// branches is one that gets a seventh answer nobody wrote down. Every answer is
// a code, a sentence a reader can act on, and a statement of what is *not*
// wrong, because "unavailable" on its own reads like a fault the reader caused.
//
// The sample is never a silent stand-in. When the workspace cannot be briefed
// on, the page still draws the sample — a leader can see the shape of the
// artifact they would get — but it is labelled as a sample everywhere it can be
// mistaken for a figure, including on paper.

import { FINOPS_CONSENT, readFinopsDocument } from "/finops-workspace.js";

/** The two things this surface may brief on. There is no third. */
export const BRIEFING_SOURCE = Object.freeze({
  workspace: "workspace",
  sample: "sample",
});

/** Why this browser's own periods could not be briefed on. A closed set. */
export const WORKSPACE_ABSENCE = Object.freeze({
  storageBlocked: "storage_blocked",
  unreadable: "unreadable_document",
  unsupported: "unsupported_document",
  invalidRecords: "invalid_retained_records",
  notAsked: "retention_not_chosen",
  declined: "retention_declined",
  empty: "no_retained_period",
});

/**
 * What each absence says. Three sentences, always in this order: what is true of
 * the store, what that means for this page, and the one thing the reader can do
 * about it. `remedy` never instructs an upload, because nothing on this surface
 * accepts one.
 */
export const WORKSPACE_ABSENCE_COPY = Object.freeze({
  [WORKSPACE_ABSENCE.storageBlocked]: Object.freeze({
    summary: "This browser did not let the page read its local storage",
    statement: "The briefing is built from figures kept in this browser, and this browser refused the "
      + "key they are kept under, so whether anything is retained here is unknown.",
    remedy: "Nothing was uploaded and nothing was written. Allowing site data for this site, or opening "
      + "it in a normal window rather than a private one, is what makes your own figures readable.",
  }),
  [WORKSPACE_ABSENCE.unreadable]: Object.freeze({
    summary: "The stored workspace could not be read as a workspace",
    statement: "Text is kept under this site's FinOps key that this build cannot read as a workspace "
      + "document, so no period can be briefed on from it.",
    remedy: "Your text was left exactly as it is — nothing here rewrites or deletes it. The AI FinOps "
      + "workspace page can forget the stored document if you want to start again.",
  }),
  [WORKSPACE_ABSENCE.unsupported]: Object.freeze({
    summary: "The stored workspace was written by a newer build",
    statement: "The document under this site's FinOps key declares a version this build does not know, "
      + "and reinterpreting it would mean guessing at fields it cannot see.",
    remedy: "Nothing was changed. Reloading after this site next updates is what makes those periods "
      + "readable again.",
  }),
  [WORKSPACE_ABSENCE.invalidRecords]: Object.freeze({
    summary: "One or more retained FinOps records failed their stored-data contract",
    statement: "The workspace document is readable, but at least one retained record was rejected, so "
      + "building from the remaining records could publish a partial and misleading briefing.",
    remedy: "No local figure is shown and the stored document was not changed. Run the analysis again "
      + "before using this browser's figures for an executive briefing.",
  }),
  [WORKSPACE_ABSENCE.notAsked]: Object.freeze({
    summary: "No FinOps analysis yet",
    statement: "No FinOps analysis is available in this browser.",
    remedy: "Try the bundled example, or analyze your own export. Your export and briefing figures "
      + "are not transmitted.",
  }),
  [WORKSPACE_ABSENCE.declined]: Object.freeze({
    summary: "This browser is set not to keep FinOps figures",
    statement: "You chose not to retain derived figures here, so there is no month for this briefing to "
      + "read. That choice is respected, not worked around.",
    remedy: "The AI FinOps page still analyses the files you open for as long as that tab is open. "
      + "Changing the retention choice there is what gives this page your own months to brief on.",
  }),
  [WORKSPACE_ABSENCE.empty]: Object.freeze({
    summary: "No FinOps analysis yet",
    statement: "No FinOps analysis is available in this browser.",
    remedy: "Try the bundled example, or analyze your own export. Your export and briefing figures "
      + "are not transmitted.",
  }),
});

/** How the masthead names the origin of what is drawn, for screen and paper. */
export const WORKSPACE_ORIGIN =
  "Your own retained FinOps periods, read from this browser and rebuilt in this tab — not uploaded, "
  + "not shared, not linkable.";

export const SAMPLE_ORIGIN =
  "Published synthetic sample — no import, no customer data, and not your workspace's figures.";

/**
 * What the reader is owed about how the figures on screen were produced.
 * Stated per source, because "rebuilt in this tab" means something different
 * when the periods came out of the reader's own store.
 */
export const WORKSPACE_PROVENANCE_NOTE =
  "Rebuilt in this tab from the retained periods named above, read out of this browser's own FinOps "
  + "workspace. No clock, no random value, no network request, and no server took part.";

/**
 * Read this browser's retained periods, and say why there are none when there
 * are none.
 *
 * @param storage this browser's `localStorage`, or a stand-in. A missing one is
 *   `storage_blocked` rather than "empty": a browser that has no store and a
 *   browser that has an empty one are different facts about the reader.
 * @returns `{ code, periods, retainedCount, consentState }`. `code` is `null`
 *   exactly when `periods` is non-empty. Total: it never throws.
 */
export function readWorkspacePeriods(storage, { read = readFinopsDocument } = {}) {
  if (!storage || typeof storage.getItem !== "function") {
    return frozenRead(WORKSPACE_ABSENCE.storageBlocked, [], null);
  }
  let result;
  try {
    result = read(storage);
  } catch {
    return frozenRead(WORKSPACE_ABSENCE.storageBlocked, [], null);
  }
  const { access, document, dropped = 0 } = result ?? {};
  if (access === "unavailable") return frozenRead(WORKSPACE_ABSENCE.storageBlocked, [], null);
  if (access === "unreadable") return frozenRead(WORKSPACE_ABSENCE.unreadable, [], null);
  if (access === "unsupported") return frozenRead(WORKSPACE_ABSENCE.unsupported, [], null);

  const consentState = document?.consent?.state ?? FINOPS_CONSENT.notAsked;
  const periods = Array.isArray(document?.periods) ? document.periods : [];
  if (consentState === FINOPS_CONSENT.notAsked) {
    return frozenRead(WORKSPACE_ABSENCE.notAsked, [], consentState);
  }
  if (consentState === FINOPS_CONSENT.declined) {
    return frozenRead(WORKSPACE_ABSENCE.declined, [], consentState);
  }
  // A partial workspace is not a valid briefing source. The shared reader
  // deliberately drops invalid records so other workspace views remain usable,
  // but an executive artifact must not silently quote the surviving subset.
  if (dropped > 0) return frozenRead(WORKSPACE_ABSENCE.invalidRecords, [], consentState);
  if (periods.length === 0) return frozenRead(WORKSPACE_ABSENCE.empty, [], consentState);
  return frozenRead(null, periods, consentState);
}

function frozenRead(code, periods, consentState) {
  return Object.freeze({
    code,
    periods: Object.freeze([...periods]),
    retainedCount: periods.length,
    consentState,
  });
}

/**
 * Choose what the page briefs on.
 *
 * The reader's own workspace wins whenever it holds a period. Otherwise the
 * source is the published sample and the absence travels with it, so the page
 * can say — in the same breath — that these are not your figures and why.
 */
export function chooseBriefingSource(storage, options = {}) {
  const read = readWorkspacePeriods(storage, options);
  if (read.code === null) {
    return Object.freeze({
      source: BRIEFING_SOURCE.workspace,
      periods: read.periods,
      retainedCount: read.retainedCount,
      absence: null,
      origin: WORKSPACE_ORIGIN,
      provenanceNote: WORKSPACE_PROVENANCE_NOTE,
    });
  }
  return Object.freeze({
    source: BRIEFING_SOURCE.sample,
    periods: Object.freeze([]),
    retainedCount: 0,
    absence: Object.freeze({ code: read.code, ...WORKSPACE_ABSENCE_COPY[read.code] }),
    origin: SAMPLE_ORIGIN,
    provenanceNote: null,
  });
}
