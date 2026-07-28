// The one place the local-import ceilings are named.
//
// The numbers live where the reader that enforces them lives
// (`delimited-text.js`, which has refused an oversized file and an overlong file
// since the delimited path shipped). This module re-exports them under
// import-facing names, turns them into the one sentence the file picker and the
// docs both carry, and answers the single question the offload client asks
// before it starts any work at all: is this file already too big to read?
//
// Two properties matter and are asserted by tests:
//   1. There is exactly one definition of each number. A second copy in the
//      markup, the docs, or the worker would drift away from the enforced value
//      and start promising a ceiling nobody checks.
//   2. A ceiling is a whole-file refusal, never a truncation. A short total is
//      indistinguishable from a real one on the surface that renders it, so an
//      import that hits either limit produces zero records and one message.
//
// No DOM, no I/O, no parsing.

import { DELIMITED_CODES, MAX_DELIMITED_BYTES, MAX_DELIMITED_ROWS } from "./delimited-text.js";

/** Largest accepted file, in UTF-8 bytes. Checked before any record is built. */
export const MAX_IMPORT_BYTES = MAX_DELIMITED_BYTES;

/** Largest accepted record count, header row included. Checked during parse. */
export const MAX_IMPORT_ROWS = MAX_DELIMITED_ROWS;

/** Bound one picker action as well as each individual file. */
export const MAX_IMPORT_FILES = 20;
export const MAX_IMPORT_SELECTION_BYTES = MAX_IMPORT_BYTES * 2;

export const IMPORT_LIMITS = Object.freeze({
  maxBytes: MAX_IMPORT_BYTES,
  maxRows: MAX_IMPORT_ROWS,
  maxFiles: MAX_IMPORT_FILES,
  maxSelectionBytes: MAX_IMPORT_SELECTION_BYTES,
});

const MEGABYTE = 1_000_000;

/** Decimal megabytes, because that is what a file manager shows the reader. */
export function formatLimitBytes(bytes = MAX_IMPORT_BYTES) {
  const megabytes = bytes / MEGABYTE;
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

export function formatLimitRows(rows = MAX_IMPORT_ROWS) {
  return rows.toLocaleString("en-US");
}

/**
 * The ceiling sentence, written once. The file-picker help text and
 * `docs/local-import-limits.md` both render this string rather than repeating
 * the numbers, so raising a limit is a one-line edit in `delimited-text.js`.
 */
export function importLimitsSentence(limits = IMPORT_LIMITS) {
  return `Each file may be up to ${formatLimitBytes(limits.maxBytes)} and `
    + `${formatLimitRows(limits.maxRows)} rows. Select up to ${limits.maxFiles} files totaling `
    + `${formatLimitBytes(limits.maxSelectionBytes)}. A selection over a ceiling is refused whole — `
    + "no rows are kept and no total is shown, so a short number can never reach you.";
}

/**
 * The up-front size check, run before a byte is decoded or a worker is started.
 *
 * `byteSize` is `File.size` when the picker knows it — the exact UTF-8 length of
 * the file on disk — and `utf8ByteLength(text)` when only text is in hand. A
 * size that is not a finite number is not a failure here; the reader inside the
 * parse measures the text itself and enforces the same limit again.
 *
 * @returns {null | {code: string, limit: number, observed: number, unit: string}}
 */
export function checkFileSizeCeiling(byteSize, limit = MAX_IMPORT_BYTES) {
  if (!Number.isFinite(byteSize) || byteSize <= limit) return null;
  return Object.freeze({
    code: DELIMITED_CODES.FILE_TOO_LARGE,
    limit,
    observed: Math.trunc(byteSize),
    unit: "bytes",
  });
}

/**
 * Refuse a picker selection before any Blob is decoded.
 *
 * A per-file ceiling alone still permits an attacker to select hundreds of
 * individually valid files and make `Promise.all(file.text())` retain all of
 * them at once. The normal demo path needs only a handful of exports, so a
 * count and aggregate-byte bound are both understandable and comfortably above
 * ordinary use.
 */
export function checkFileSelectionCeiling(files = [], limits = IMPORT_LIMITS) {
  const count = files.length;
  const bytes = files.reduce((sum, file) =>
    sum + (Number.isFinite(file?.size) && file.size > 0 ? file.size : 0), 0);
  if (count > limits.maxFiles) {
    return Object.freeze({
      code: "too_many_files",
      message: `Select at most ${limits.maxFiles} files at a time; ${count} were selected.`,
    });
  }
  if (bytes > limits.maxSelectionBytes) {
    return Object.freeze({
      code: "selection_too_large",
      message: `The selection is ${bytes} bytes; the combined limit is ${limits.maxSelectionBytes} bytes.`,
    });
  }
  return null;
}

/**
 * Make an OS-provided filename safe to display as a left-to-right label.
 *
 * DOM text APIs already prevent markup execution. Replacing control and bidi
 * formatting characters additionally prevents a filename from hiding or
 * visually reordering its extension in provenance and review labels.
 */
export function safeDisplayFileName(value, fallback = "selected file") {
  const cleaned = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "\uFFFD")
    .trim();
  return cleaned || fallback;
}
