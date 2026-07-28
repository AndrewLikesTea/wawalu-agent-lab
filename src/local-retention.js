// One small record of one choice: does this browser keep Shiplog records?
//
// This module is deliberately dependency-free. `saveDecisions` in app.js and
// `saveReleases` in releases.js both ask it before they write, and releases.js
// says in its own header that it will not import app.js — so the guard cannot
// live in either of them, and it cannot import either of them. It reads and
// writes exactly one storage key, has no DOM, no transport, and no clock beyond
// the one a caller passes in.
//
// UNDECIDED IS NOT DECLINED
// -------------------------
// Shiplog kept records in this browser long before there was a control for it,
// and a visitor who has never seen that control has not turned anything off. So
// the absence of a record means the default — keep retaining — and only an
// explicit `declined` stops a write. `chosen` is what lets the workspace page
// say the state is a default rather than claiming a decision nobody made.

export const WORKSPACE_KEY = "shiplog.workspace.v1";

export const RETENTION = Object.freeze({ retaining: "retaining", declined: "declined" });

/** The sentence each retention outcome reports, authored once. */
export const RETENTION_OUTCOME = Object.freeze({
  opted_in: "New records will be kept in this browser again.",
  declined: "New records will no longer be kept in this browser. Records already stored here "
    + "were not erased.",
  choice_not_saved: "That choice could not be saved in this browser, so retention is unchanged.",
});

/** The message a refused write carries back to the caller that attempted it. */
export const RETENTION_DECLINED_MESSAGE =
  "This browser is set not to keep Shiplog records, so nothing was saved.";

const DEFAULT_RECORD = Object.freeze({
  retention: RETENTION.retaining,
  chosen: false,
  decidedAt: null,
  exportedAt: null,
  erasedAt: null,
  available: true,
});

const isoOrNull = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

/** Day precision. A stored instant is an implementation detail; a date is read. */
export const dayOf = (instant) => (instant ? instant.slice(0, 10) : null);

/**
 * Read the retention record. Never throws: a browser that refuses storage
 * outright reports `available: false`, which the workspace page draws as a state
 * rather than propagating as an error.
 */
export function readWorkspaceRecord(storage) {
  let raw;
  try {
    raw = storage?.getItem(WORKSPACE_KEY) ?? null;
  } catch {
    return Object.freeze({ ...DEFAULT_RECORD, available: false });
  }
  if (raw === null) return DEFAULT_RECORD;

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_RECORD;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_RECORD;

  const declined = value.retention === RETENTION.declined;
  return Object.freeze({
    retention: declined ? RETENTION.declined : RETENTION.retaining,
    chosen: declined || value.retention === RETENTION.retaining,
    decidedAt: isoOrNull(value.decidedAt),
    exportedAt: isoOrNull(value.exportedAt),
    erasedAt: isoOrNull(value.erasedAt),
    available: true,
  });
}

/**
 * Merge a patch into the retention record.
 *
 * @returns true when the write landed. False is an answer the page shows:
 *   telling a visitor their choice was saved when the browser refused it is the
 *   one failure a consent surface cannot afford.
 */
export function writeWorkspaceRecord(storage, patch) {
  const current = readWorkspaceRecord(storage);
  if (!current.available) return false;
  try {
    storage.setItem(WORKSPACE_KEY, JSON.stringify({
      retention: patch.retention ?? current.retention,
      decidedAt: patch.decidedAt ?? current.decidedAt,
      exportedAt: patch.exportedAt ?? current.exportedAt,
      erasedAt: patch.erasedAt ?? current.erasedAt,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Has the visitor turned retention off?
 *
 * The record stores ask this before every write, so the control on the workspace
 * page governs storage rather than merely describing it.
 */
export function retentionDeclined(storage) {
  return readWorkspaceRecord(storage).retention === RETENTION.declined;
}

/** The error a refused write raises, tagged so a caller can recognise it. */
export function retentionRefusal() {
  const error = new TypeError(RETENTION_DECLINED_MESSAGE);
  error.code = "retention_declined";
  return error;
}

export function setRetention(storage, retention, { now = new Date() } = {}) {
  const target = retention === RETENTION.declined ? RETENTION.declined : RETENTION.retaining;
  const saved = writeWorkspaceRecord(storage, {
    retention: target,
    decidedAt: now.toISOString(),
  });
  if (!saved) {
    return Object.freeze({
      ok: false,
      code: "choice_not_saved",
      message: RETENTION_OUTCOME.choice_not_saved,
    });
  }
  const code = target === RETENTION.declined ? "declined" : "opted_in";
  return Object.freeze({ ok: true, code, message: RETENTION_OUTCOME[code] });
}
