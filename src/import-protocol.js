// The one contract between the import worker and the page that owns it.
//
// Both sides import this module. Neither side writes a message literal, and
// neither side reads a field this file does not name — a protocol that lives in
// two places drifts the first time one side grows a field, and the failure mode
// is a silently ignored message rather than a build error.
//
// Four outbound message kinds, one inbound. The union is closed on purpose:
// anything the worker cannot express as `progress`, `done`, `error`, or
// `limit-exceeded` is a defect in the worker, not a fifth kind.

import { MAX_DELIMITED_BYTES, MAX_DELIMITED_ROWS } from "./delimited-text.js";

/**
 * The import ceiling, in UTF-8 bytes, checked against `file.size` before a byte
 * is read.
 *
 * This is an alias, not a second number. The reviewed delimited reader already
 * refuses a file above `MAX_DELIMITED_BYTES`, and a separate ceiling here would
 * be a second control that drifts from the one that actually rejects the file:
 * the loose one would let the worker buffer past what the parser accepts, and
 * the tight one would reject files the parser would have taken. One number,
 * named twice, checked in two places.
 *
 * 8 MB is roughly a year of daily per-team provider usage rows. It is also about
 * the largest text a browser tab can hold as a string, decode, and parse without
 * the parse itself becoming the user's problem — above it, splitting the export
 * by date range is faster for the reader than waiting.
 */
export const MAX_IMPORT_BYTES = MAX_DELIMITED_BYTES;

/**
 * The import ceiling in records, header row included. Also an alias of the
 * reviewed reader's own limit, for the same reason as above.
 *
 * 50,000 records is the point where the aggregation stops paying for itself: a
 * daily × org-unit × provider × category export that large is nearly always
 * several periods concatenated, and analyzing them one period at a time gives a
 * reader a trend instead of one undifferentiated total. The streaming guard
 * stops at the boundary so a 5,000,000-row file costs one chunk, not a parse.
 */
export const MAX_IMPORT_ROWS = MAX_DELIMITED_ROWS;

/** Human-facing statement of both ceilings, for help text and for tests. */
export const IMPORT_LIMIT_COPY = Object.freeze({
  bytes: `${MAX_IMPORT_BYTES / 1_000_000} MB`,
  rows: MAX_IMPORT_ROWS.toLocaleString("en-US"),
  sentence: `Each file may be up to ${MAX_IMPORT_BYTES / 1_000_000} MB and `
    + `${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows; split a larger export by date range.`,
});

/**
 * How often the worker is allowed to speak. Progress is derived from bytes
 * consumed against `file.size` because the row count is unknown until the file
 * has been read, so a byte step is the only cadence available before the end.
 *
 * 256 KiB is a message roughly every 100–250 ms on the streams these files
 * arrive on, and it is deterministic — a byte step reproduces in a test, a
 * wall-clock throttle does not.
 */
export const PROGRESS_BYTE_STEP = 262_144;

/** The closed set of message kinds. Downstream switches on these, never strings. */
export const IMPORT_MESSAGE = Object.freeze({
  PROGRESS: "progress",
  DONE: "done",
  ERROR: "error",
  LIMIT_EXCEEDED: "limit-exceeded",
});

/** The one inbound kind: the page hands the worker a file and nothing else. */
export const IMPORT_REQUEST = "import";

export function importRequest({ file, fileName, mediaType }) {
  return { kind: IMPORT_REQUEST, file, fileName, mediaType };
}

/**
 * Bytes consumed against the total, plus the records the streaming guard has
 * counted so far. `ratio` is clamped: a stream that reports more bytes than
 * `file.size` must not paint a determinate bar past its end.
 */
export function progressMessage({ bytesRead, totalBytes, rows }) {
  const total = Number(totalBytes) > 0 ? Number(totalBytes) : 0;
  const read = Math.max(0, Number(bytesRead) || 0);
  return {
    kind: IMPORT_MESSAGE.PROGRESS,
    bytesRead: read,
    totalBytes: total,
    rows: Math.max(0, Number(rows) || 0),
    ratio: total ? Math.min(1, read / total) : 0,
  };
}

/** The whole successful result: the folded summary, and nothing else. */
export function doneMessage(summary) {
  return { kind: IMPORT_MESSAGE.DONE, summary };
}

/**
 * A failure the reader can act on. `code` is one of the reviewed reason codes
 * the existing diagnostic surface already maps to a recovery; `message` is the
 * sentence that surface shows. No cell value ever travels on either.
 */
export function errorMessage({ code, message, problems = [] }) {
  return { kind: IMPORT_MESSAGE.ERROR, code: String(code ?? ""), message: String(message ?? ""), problems };
}

/**
 * A ceiling was hit. This is a *failed* import that happens to know exactly
 * why: it carries the limit, the observed value, and the unit, so the message
 * the reader sees names all three. It is never a smaller successful import —
 * there is no partial summary on this message, by construction.
 */
export function limitExceededMessage({ code, limit, observed, unit, message }) {
  return {
    kind: IMPORT_MESSAGE.LIMIT_EXCEEDED,
    code: String(code), limit: Number(limit), observed: Number(observed),
    unit: String(unit), message: String(message ?? ""),
  };
}

const KINDS = new Set(Object.values(IMPORT_MESSAGE));

/** True for a message this protocol declares. An unknown kind is dropped loudly. */
export function isImportMessage(value) {
  return Boolean(value) && typeof value === "object" && KINDS.has(value.kind);
}
