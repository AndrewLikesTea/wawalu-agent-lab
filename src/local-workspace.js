// What this browser is keeping, said in one place.
//
// WHY THIS EXISTS
// ---------------
// Shiplog writes every decision and release a visitor records into this
// browser's local storage and nowhere else. That is the product's whole privacy
// story, and until now it was told in a sentence under an export button. A
// visitor could not answer three ordinary questions from the page: what is
// actually retained, how sure is the page about that, and what should I do next.
//
// This module answers all three from storage alone, and it answers them as data
// rather than as markup — `local-workspace-view.js` owns the DOM, and the tests
// can pin the sentences without a browser.
//
// WHAT IT READS AND WHAT IT NEVER READS
// -------------------------------------
// Three keys of this browser's local storage: the decision store, the release
// store, and one small record of the visitor's own retention choice. No fetch,
// no cookie, no analytics call, no clock beyond the one the caller passes in.
// Everything it reports is derivable from those three keys, which is what makes
// the provenance block at the foot of the page checkable rather than a promise.
//
// A COUNT IS NOT A CERTAINTY
// -------------------------
// Storage can be unavailable (private modes disable it outright), it can hold
// text that is not JSON, and it can hold JSON entries this build no longer
// recognises. Those are three different answers, not one failure, so the status
// carries a confidence grade beside the counts: `verified` when both stores
// parsed and every entry was recognised, `partial` when something was dropped or
// one store is unreadable, `unknown` when storage cannot be reached at all. A
// page that prints "0 decisions" over unreachable storage is lying, and this is
// the distinction that stops it.
//
// EXACTLY ONE NEXT ACTION
// -----------------------
// `nextAction` is a single object, never a list. The ladder in `nextAction()`
// is ordered by what a visitor stands to lose: unreadable storage first,
// then unreadable records (restore before erase — erasing is what loses the
// data), then records stranded by a declined choice, then the ordinary backup
// hygiene. Whatever the state, there is one prioritized thing to do, and the
// page renders exactly it.

import { STORAGE_KEY, loadDecisions } from "./app.js";
import { RELEASE_STORAGE_KEY, loadReleases } from "./releases.js";
import {
  RETENTION, RETENTION_OUTCOME, WORKSPACE_KEY, dayOf, readWorkspaceRecord, writeWorkspaceRecord,
} from "./local-retention.js";

// The choice itself lives in local-retention.js, which the record stores import
// and this module must not duplicate. Re-exported here so the page has one
// import surface rather than two.
export { RETENTION, WORKSPACE_KEY, dayOf, readWorkspaceRecord, retentionDeclined, setRetention }
  from "./local-retention.js";

/** Every state this surface draws. `loading` is the view's, before a read. */
export const WORKSPACE_STATE = Object.freeze({
  loading: "loading",
  unavailable: "unavailable",
  corrupted: "corrupted",
  declined: "declined",
  empty: "empty",
  retaining: "retaining",
});

export const CONFIDENCE = Object.freeze({
  verified: "verified",
  partial: "partial",
  unknown: "unknown",
});

/**
 * The boundary claim, authored once. It is true by construction rather than by
 * promise: this module has no transport, and the two record stores it reads are
 * written by `saveDecisions`/`saveReleases`, which have none either.
 */
export const PRIVACY_BOUNDARY = Object.freeze({
  headline: "Everything below stays in this browser.",
  body: "Shiplog has no account and keeps no server-side copy. The decisions and releases you record "
    + "are held in this browser's local storage, on this device, under the two keys named in "
    + "“Where these numbers come from”. Nothing on this page is uploaded, and no cookie, analytics "
    + "call, or telemetry reads it. Clearing this browser's site data — or erasing below — removes "
    + "the records, and no copy survives anywhere else.",
});

/**
 * The sentence each outcome reports, authored here so the visible notice and the
 * screen-reader announcement are the same words. Every one of them says what
 * happened to the stored records, because that is the fact a visitor is checking.
 */
export const OUTCOME = Object.freeze({
  ...RETENTION_OUTCOME,
  exported: "Backup downloaded. Nothing in this browser was changed.",
  export_failed: "The backup could not be written, so nothing was downloaded. "
    + "Your stored records were not changed.",
  restored: "Records restored into this browser from the file you chose.",
  restore_failed: "That file was not restored. Your stored records were not changed.",
  erased: "Erased. This browser now holds no Shiplog decisions or releases, and the erase "
    + "cannot be undone from here.",
  erase_failed: "The records could not be erased, so they are still stored in this browser.",
  erase_incomplete: "The browser failed partway through erasing and could not restore every "
    + "record. Check the storage status below before doing anything else.",
});

function plural(count, noun) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

const isoOrNull = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

/**
 * The size line. Character count of the stored JSON, not disk usage — the
 * provenance block says so, because no browser exposes the second one.
 */
export function formatSize(characters) {
  if (!Number.isFinite(characters) || characters <= 0) return "no stored text";
  if (characters < 1024) return "under 1 KB";
  return `about ${Math.round(characters / 1024)} KB`;
}

/* ------------------------------ the records ------------------------------- */

/**
 * One store, inspected twice: the raw text for "can this be read at all", and
 * the module that owns the shape for "how many of these are records".
 *
 * The two together are what produce a confidence grade. `loadDecisions` alone
 * cannot distinguish an empty store from an unreadable one — it answers `[]` to
 * both, which is correct for a list and useless for a status.
 */
function inspectStore(storage, key, valid) {
  let raw;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {
    return { access: "unavailable", characters: 0, stored: 0, valid: 0, dropped: 0 };
  }
  if (raw === null) return { access: "ok", characters: 0, stored: 0, valid: 0, dropped: 0 };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { access: "corrupt", characters: raw.length, stored: 0, valid: valid.length, dropped: 0 };
  }
  if (!Array.isArray(parsed)) {
    return { access: "corrupt", characters: raw.length, stored: 0, valid: valid.length, dropped: 0 };
  }
  return {
    access: "ok",
    characters: raw.length,
    stored: parsed.length,
    valid: valid.length,
    dropped: Math.max(0, parsed.length - valid.length),
  };
}

/** The newest instant any stored record carries, or null when none does. */
function newestRecordAt(decisions, releases) {
  let newest = null;
  for (const record of [...decisions, ...releases]) {
    const at = isoOrNull(record?.createdAt);
    if (at && (!newest || Date.parse(at) > Date.parse(newest))) newest = at;
  }
  return newest;
}

/* ------------------------------- the status ------------------------------- */

function storageChip(state) {
  // Filled wash = dynamic signal, per the Claude Design foundations card: this
  // chip reports a live state, so it takes a wash. The confidence chip below is
  // a static classification and takes an outline. Neither carries meaning in its
  // colour — the word in the chip is the whole message, and the tone only
  // reinforces it.
  switch (state) {
    case WORKSPACE_STATE.unavailable:
      return { label: "Storage unavailable", tone: "blocked" };
    case WORKSPACE_STATE.corrupted:
      return { label: "Stored text unreadable", tone: "warn" };
    case WORKSPACE_STATE.declined:
      return { label: "Not retaining", tone: "off" };
    case WORKSPACE_STATE.empty:
      return { label: "Retaining · nothing stored", tone: "quiet" };
    default:
      return { label: "Retaining", tone: "on" };
  }
}

function confidenceOf({ state, dropped, oneStoreUnreadable }) {
  if (state === WORKSPACE_STATE.unavailable) {
    return {
      grade: CONFIDENCE.unknown,
      label: "Unknown",
      detail: "This browser refused access to local storage, so this page cannot say what, if "
        + "anything, is stored here. The counts above are not zero — they are unavailable.",
    };
  }
  if (state === WORKSPACE_STATE.corrupted || dropped > 0 || oneStoreUnreadable) {
    const because = state === WORKSPACE_STATE.corrupted || oneStoreUnreadable
      ? "one of the two stores does not hold a readable list, so its records are not counted above"
      : `${plural(dropped, "stored entry")} did not match the record shape this build reads and `
        + "were left out of the counts above";
    return { grade: CONFIDENCE.partial, label: "Partial", detail: `Partial: ${because}.` };
  }
  return {
    grade: CONFIDENCE.verified,
    label: "Verified",
    detail: "Verified: both stores parsed, and every entry in them is a record this page can read.",
  };
}

/**
 * The one thing to do next, chosen by what a visitor stands to lose.
 *
 * `kind` is what the control does, not what it looks like: the view maps it to a
 * button or a link, and `local-workspace-view.js` is the only place that knows
 * which. `href` is present only for `kind: "link"`.
 */
function nextAction({ state, record, total, decisions, releases, newestAt }) {
  if (state === WORKSPACE_STATE.unavailable) {
    return {
      code: "recheck_storage",
      headline: "Check this browser again",
      why: "Local storage is switched off or blocked here — often a private window, or a site-data "
        + "setting. Nothing can be recorded or read until it is available. Allow site data for "
        + "labs.wawalu.org, then check again.",
      label: "Check storage again",
      kind: "recheck",
    };
  }
  if (state === WORKSPACE_STATE.corrupted) {
    return {
      code: "restore_unreadable",
      headline: "Restore from a JSON backup",
      why: "Text is stored under a Shiplog key that is not a readable list of records, so this page "
        + "cannot count what is there. Restoring a backup rewrites the store from a file you "
        + "choose. Restore before erasing — erasing is the step that loses whatever survived.",
      label: "Choose a JSON backup",
      kind: "restore",
    };
  }
  if (state === WORKSPACE_STATE.declined && total > 0) {
    return {
      code: "erase_after_decline",
      headline: `Erase the ${plural(total, "record")} still stored here`,
      why: "You turned retention off, so nothing new is being kept — but records written before "
        + "that choice are still in this browser. Download a backup first if you want to keep "
        + "them; erasing cannot be undone from here.",
      label: `Erase ${plural(decisions, "decision")} and ${plural(releases, "release")}`,
      kind: "erase",
    };
  }
  if (state === WORKSPACE_STATE.declined) {
    return {
      code: "opt_in",
      headline: "Keep new records in this browser",
      why: "Nothing is stored here and nothing new will be. Turning retention back on lets "
        + "decisions and releases you record persist between visits, on this device only.",
      label: "Keep records in this browser",
      kind: "opt-in",
    };
  }
  if (state === WORKSPACE_STATE.empty) {
    return {
      code: "first_record",
      headline: "Record your first decision",
      why: "This browser is set to keep records and is holding none. A decision recorded on the "
        + "home page appears here, and in the export, from the moment you save it.",
      label: "Record a decision",
      kind: "link",
      href: "/#decision-form",
    };
  }
  if (!record.exportedAt) {
    return {
      code: "first_backup",
      headline: "Download a JSON backup",
      why: `${plural(total, "record")} exist only in this browser. Clearing site data, a new device, `
        + "or a different browser leaves you with none of them. The backup is a file you keep.",
      label: "Download JSON backup",
      kind: "export",
    };
  }
  if (newestAt && Date.parse(newestAt) > Date.parse(record.exportedAt)) {
    return {
      code: "stale_backup",
      headline: "Download an updated backup",
      why: `Records have been written since your last backup on ${dayOf(record.exportedAt)}. `
        + "Those newer records exist only in this browser until you take another one.",
      label: "Download JSON backup",
      kind: "export",
    };
  }
  return {
    code: "settled",
    headline: "Nothing needs doing here",
    why: `Every stored record is covered by the backup you took on ${dayOf(record.exportedAt)}, `
      + "and this browser is keeping new ones. Browse the history, or come back after recording more.",
    label: "Browse your history",
    kind: "link",
    href: "/",
  };
}

/**
 * Where every number above came from, as term/detail pairs. Progressive
 * disclosure: the page keeps this behind a closed `<details>`, because it
 * answers "can I check this?" rather than "what should I do?" — and only one of
 * those two questions belongs above the fold.
 */
function provenance({ decisionStore, releaseStore, record, checkedAt, newestAt }) {
  const rows = [
    {
      term: "Decision count",
      detail: `Read from this browser's local storage under “${STORAGE_KEY}” — `
        + `${plural(decisionStore.stored, "stored entry")}, ${decisionStore.valid} readable as decisions.`,
    },
    {
      term: "Release count",
      detail: `Read from this browser's local storage under “${RELEASE_STORAGE_KEY}” — `
        + `${plural(releaseStore.stored, "stored entry")}, ${releaseStore.valid} readable as releases.`,
    },
    {
      term: "Size",
      detail: "The number of characters of JSON text in those two keys. It is not disk usage: no "
        + "browser exposes that, so this page reports what it can actually count.",
    },
    {
      term: "Retention choice",
      detail: record.chosen
        ? `Stored under “${WORKSPACE_KEY}”, chosen on ${dayOf(record.decidedAt) ?? "an unrecorded date"}.`
        : `No choice is stored under “${WORKSPACE_KEY}”. Shiplog keeps records by default, so this `
          + "page shows the default rather than a decision you made.",
    },
    {
      term: "Last backup",
      detail: record.exportedAt
        ? `A backup was downloaded from this page on ${dayOf(record.exportedAt)}. This page records `
          + "the date only — it cannot see the file afterwards, or know whether you still have it."
        : "No backup has been downloaded from this page. A backup taken elsewhere is not visible here.",
    },
    {
      term: "Newest record",
      detail: newestAt
        ? `The most recent record in these stores is dated ${dayOf(newestAt)}, from the record's own `
          + "createdAt field rather than from a clock read now."
        : "No stored record carries a date this page can read.",
    },
    {
      term: "Checked",
      detail: `${checkedAt.toISOString().slice(0, 16).replace("T", " ")} UTC, in this tab. `
        + "Reading this page sends no request: there is no network call, cookie, or analytics "
        + "event behind any number above.",
    },
  ];
  if (record.erasedAt) {
    rows.push({
      term: "Last erase",
      detail: `Records were erased from this page on ${dayOf(record.erasedAt)}.`,
    });
  }
  return rows;
}

/**
 * The whole status, from storage alone.
 *
 * @param storage this browser's `localStorage`, or a stand-in.
 * @param options.now the instant to stamp the read with. Injectable so a test
 *   pins a sentence rather than racing a clock.
 * @returns a frozen status. Total: it never throws, and every failure storage
 *   can produce arrives as a state with words attached.
 */
export function readWorkspace(storage, { now = new Date() } = {}) {
  const record = readWorkspaceRecord(storage);
  const decisions = loadDecisions(storage ?? {});
  const releases = loadReleases(storage ?? {});
  const decisionStore = inspectStore(storage, STORAGE_KEY, decisions);
  const releaseStore = inspectStore(storage, RELEASE_STORAGE_KEY, releases);

  const unreachable = decisionStore.access === "unavailable" && releaseStore.access === "unavailable";
  const corrupt = decisionStore.access === "corrupt" || releaseStore.access === "corrupt";
  const oneStoreUnreadable = !unreachable
    && (decisionStore.access === "unavailable" || releaseStore.access === "unavailable");
  const total = decisions.length + releases.length;

  let state;
  if (unreachable) state = WORKSPACE_STATE.unavailable;
  else if (corrupt) state = WORKSPACE_STATE.corrupted;
  else if (record.retention === RETENTION.declined) state = WORKSPACE_STATE.declined;
  else if (total === 0) state = WORKSPACE_STATE.empty;
  else state = WORKSPACE_STATE.retaining;

  const dropped = decisionStore.dropped + releaseStore.dropped;
  const characters = decisionStore.characters + releaseStore.characters;
  const newestAt = newestRecordAt(decisions, releases);

  const summary = state === WORKSPACE_STATE.unavailable
    ? "This browser did not let the page read its local storage, so what is retained here is unknown."
    : `${plural(decisions.length, "decision")} and ${plural(releases.length, "release")} `
      + `retained in this browser`
      + (characters > 0 ? `, ${formatSize(characters)} of JSON text.` : ".");

  return Object.freeze({
    state,
    retention: record.retention,
    retentionChosen: record.chosen,
    storage: Object.freeze(storageChip(state)),
    confidence: Object.freeze(confidenceOf({ state, dropped, oneStoreUnreadable })),
    records: Object.freeze({
      decisions: decisions.length,
      releases: releases.length,
      total,
      dropped,
      characters,
      newestOn: dayOf(newestAt),
    }),
    summary,
    boundary: PRIVACY_BOUNDARY,
    canErase: state !== WORKSPACE_STATE.unavailable && (total > 0 || corrupt),
    canExport: state !== WORKSPACE_STATE.unavailable && total > 0,
    exportedOn: dayOf(record.exportedAt),
    erasedOn: dayOf(record.erasedAt),
    nextAction: Object.freeze(nextAction({
      state, record, total, decisions: decisions.length, releases: releases.length, newestAt,
    })),
    provenance: Object.freeze(provenance({ decisionStore, releaseStore, record, checkedAt: now, newestAt })
      .map((row) => Object.freeze(row))),
  });
}

/* -------------------------------- erasing --------------------------------- */

function clear(storage, key) {
  if (typeof storage.removeItem === "function") storage.removeItem(key);
  else storage.setItem(key, "[]");
}

function restore(storage, key, value) {
  if (value === null) clear(storage, key);
  else storage.setItem(key, value);
}

function keyIsCleared(storage, key) {
  const value = storage.getItem(key);
  return value === null || value === "[]";
}

/**
 * Erase both record stores.
 *
 * The retention record itself is deliberately kept: a visitor who declined
 * retention and then erased has not un-declined, and rewriting their choice as a
 * side effect of a delete is the kind of surprise this surface exists to avoid.
 *
 * @returns `{ ok, code, message }`. A store that refuses the write leaves the
 *   records in place and says so, rather than reporting an erase that did not
 *   happen.
 */
export function eraseWorkspace(storage, { now = new Date() } = {}) {
  const keys = [STORAGE_KEY, RELEASE_STORAGE_KEY];
  let before;
  try {
    before = new Map(keys.map((key) => [key, storage.getItem(key)]));
    for (const key of keys) clear(storage, key);
    if (!keys.every((key) => keyIsCleared(storage, key))) {
      throw new Error("storage did not persist the erase");
    }
  } catch {
    if (!before) {
      return Object.freeze({ ok: false, code: "erase_failed", message: OUTCOME.erase_failed });
    }
    try {
      for (const key of keys) restore(storage, key, before.get(key));
      const restored = keys.every((key) => storage.getItem(key) === before.get(key));
      if (restored) {
        return Object.freeze({ ok: false, code: "erase_failed", message: OUTCOME.erase_failed });
      }
    } catch {
      // Fall through to the honest partial-failure result. We cannot promise
      // that both original values survived when rollback itself was refused.
    }
    return Object.freeze({
      ok: false,
      code: "erase_incomplete",
      message: OUTCOME.erase_incomplete,
    });
  }
  writeWorkspaceRecord(storage, { erasedAt: now.toISOString() });
  return Object.freeze({ ok: true, code: "erased", message: OUTCOME.erased });
}

/** Record that a backup landed. Never blocks the download it follows. */
export function noteExport(storage, { now = new Date() } = {}) {
  return writeWorkspaceRecord(storage, { exportedAt: now.toISOString() });
}
