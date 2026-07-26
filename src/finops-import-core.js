// The DOM-free core of the browser-local FinOps import.
//
// Rowan's validator (`parseLocalFinopsFile`) and reconciler
// (`normalizeLocalFinopsHistory`) remain the single source of truth for what a
// provider or HRIS export means. Nothing in this file re-implements, relaxes,
// or duplicates any of it: this module only decides *when* those functions are
// called, *what* is allowed to reach them, and *what* is allowed back out.
//
// It touches no `document`, `window`, or DOM API, so the identical module is
// loaded by `finops-import-worker.js` inside a Web Worker and, when Workers are
// unavailable, by `finops-import-runner.js` directly on the main thread. One
// code path, two hosts.
//
// ---------------------------------------------------------------------------
// What crosses a thread boundary
// ---------------------------------------------------------------------------
//
// Only headers and aggregates. A header is a per-file summary (kind, record
// count, period, byte size, six-character export-id tail) whose size is fixed
// per file. An aggregate is the analysis envelope and the trust verdict, both
// of which are already per-department / per-finding rollups. The parsed record
// arrays never leave this module and are released before it returns, so nothing
// row-shaped is retained after aggregation.
//
// Peak memory *during* parse is still one file's records, because the reviewed
// validator takes a whole document — that is the semantics this change is
// forbidden to alter. It is bounded up front instead, by refusing any file
// larger than `MAX_IMPORT_FILE_BYTES` before a single byte is decoded.
//
// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------
//
//   { status: "ok",         headers, analysis, verdict }
//   { status: "incomplete", headers, providers, hris }   more files needed
//   { status: "rejected",   error: { code, message, ordinal, total } }
//   { status: "cancelled",  bytesRead, rowsProcessed }
//
// Every one of them is plain structured-cloneable data. A refusal is never a
// number: a run that hits a ceiling reports `rejected`, never a partial total.

import { normalizeLocalFinopsHistory, parseLocalFinopsFile } from "./local-finops.js";
import { trustVerdict } from "./finops-trust-verdict.js";

// ---------------------------------------------------------------------------
// The ceilings. Defined once, here, and read by the worker, the main-thread
// fallback, and the sentence the import panel shows before parsing starts.
// ---------------------------------------------------------------------------

/**
 * The largest single file this tab will decode. Chosen so the whole document
 * plus its parsed form fits comfortably in a browser tab's heap: a v1 provider
 * export runs roughly 250 bytes per record, so 64 MiB is a little over a
 * quarter of a million rows — past the row ceiling below, which is the limit
 * that actually binds.
 */
export const MAX_IMPORT_FILE_BYTES = 64 * 1024 * 1024;

/**
 * The largest number of records, summed across every file in one import, that
 * will be reconciled. Reconciliation and the trust verdict are both linear in
 * rows with a Map per identifier; 400,000 keeps that work inside a few seconds
 * on a laptop worker thread.
 */
export const MAX_IMPORT_ROWS = 400_000;

export const IMPORT_LIMITS = Object.freeze({
  maxFileBytes: MAX_IMPORT_FILE_BYTES,
  maxRows: MAX_IMPORT_ROWS,
});

/** Progress is reported at most this often, in bytes, to keep postMessage cheap. */
export const IMPORT_PROGRESS_BYTES = 1024 * 1024;

const MEBIBYTE = 1024 * 1024;

/** Digit grouping without ICU, so the same string is produced in every host. */
export function groupDigits(value) {
  const text = String(Math.trunc(Math.abs(value)));
  const grouped = text.replace(/\B(?=(\d{3})+$)/g, ",");
  return value < 0 ? `-${grouped}` : grouped;
}

export function formatBytes(bytes) {
  return `${(bytes / MEBIBYTE).toFixed(1)} MB`;
}

/**
 * The ceiling, in words, for the panel to show *before* a file is chosen. It is
 * derived from the constants above so the sentence and the enforcement can
 * never drift apart.
 */
export function importLimitsSentence(limits = IMPORT_LIMITS) {
  return `Ceiling: ${formatBytes(limits.maxFileBytes)} per file and `
    + `${groupDigits(limits.maxRows)} records per import. `
    + "A file over either limit is refused whole — no partial total is ever shown.";
}

class Cancelled extends Error {}

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Everything the streaming read path needs, checked at call time, never sniffed. */
export function canStreamFiles(file) {
  return typeof file?.stream === "function"
    && typeof globalThis.TextDecoder === "function"
    && typeof globalThis.ReadableStream === "function";
}

/**
 * Read one file to text in chunks, reporting bytes as they arrive and checking
 * for cancellation between chunks. The file is never read whole into a single
 * buffer first, and the byte ceiling aborts mid-stream rather than after.
 */
async function readFileText(file, { maxBytes, onBytes, isCancelled, baseBytes }) {
  const declared = Number(file?.size);
  // The cheapest refusal available: `size` is metadata, so an oversized file is
  // turned away before a byte is decoded.
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw refusal("file_too_large",
      `The selected file is ${formatBytes(declared)}; this tab refuses anything over `
      + `${formatBytes(maxBytes)}. Split the export by period and import the parts.`);
  }
  if (!canStreamFiles(file)) {
    // No streams in this host: the size check above is the only ceiling that can
    // be applied, and progress is reported once, on completion.
    const text = await file.text();
    onBytes(baseBytes + (Number.isFinite(declared) ? declared : text.length));
    return text;
  }
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();
  const chunks = [];
  let bytes = 0;
  let announced = 0;
  try {
    for (;;) {
      if (isCancelled()) throw new Cancelled();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw refusal("file_too_large",
          `The selected file passed ${formatBytes(bytes)} while reading; this tab refuses `
          + `anything over ${formatBytes(maxBytes)}. Split the export by period and import the parts.`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
      if (bytes - announced >= IMPORT_PROGRESS_BYTES) {
        announced = bytes;
        onBytes(baseBytes + bytes);
      }
    }
    chunks.push(decoder.decode());
  } finally {
    // Releases the underlying source on every exit, including the refusals
    // above, so an aborted read does not leave the file handle open.
    try {
      await reader.cancel();
    } catch { /* the stream is already closed; nothing to release. */ }
  }
  onBytes(baseBytes + bytes);
  const text = chunks.join("");
  chunks.length = 0;
  return text;
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** Opaque ids never travel whole; the page's convention is a six-character tail. */
function tail(id) {
  const text = String(id ?? "");
  return text ? `…${text.slice(-6)}` : "(no identifier)";
}

/**
 * The fixed-size summary of one parsed file. This, and the aggregates below,
 * are the only things that cross a thread boundary.
 */
function headerFor(parsed, ordinal, bytes) {
  const document = parsed.document;
  return {
    ordinal,
    type: parsed.type,
    schemaVersion: document.schema_version,
    exportId: tail(document.export_id),
    sourceInstanceId: tail(document.snapshot?.source_instance_id),
    periodStart: document.snapshot?.period_start ?? null,
    periodEnd: document.snapshot?.period_end ?? null,
    completeness: document.snapshot?.completeness ?? null,
    recordCount: document.records.length,
    bytes,
  };
}

// ---------------------------------------------------------------------------
// Verdict serialization
// ---------------------------------------------------------------------------
//
// `trustVerdict` hands each finding's per-identifier breakdown over as a thunk
// so a collapsed verdict costs nothing. A function cannot be structured-cloned,
// so the boundary materializes it and the receiving side rebuilds the thunk.
// Both execution paths run both halves, so the object the caller sees is the
// same object either way — the price is that the breakdown is now computed once
// per import rather than on first expand. It is O(rows) once, into groups sized
// by distinct identifier, which is the same order the verdict already paid.

export function serializeVerdict(verdict) {
  return {
    ...verdict,
    findings: (verdict.findings ?? []).map((finding) => ({
      ...finding,
      detail: typeof finding.detail === "function" ? [...finding.detail()] : [...(finding.detail ?? [])],
    })),
  };
}

export function reviveVerdict(verdict) {
  return Object.freeze({
    ...verdict,
    findings: Object.freeze((verdict.findings ?? []).map((finding) => {
      const groups = Object.freeze([...(finding.detail ?? [])].map((group) => Object.freeze({ ...group })));
      return Object.freeze({ ...finding, detail: () => groups });
    })),
  });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Parse, validate, reconcile, and aggregate a selection of files.
 *
 * @param {Array<File|Blob>} files the selection, in the order it was made.
 * @param {object} options
 * @param {object} options.limits the ceilings to enforce; defaults to `IMPORT_LIMITS`.
 * @param {Function} options.onProgress called with `{ bytesRead, totalBytes, rowsProcessed, ... }`.
 * @param {Function} options.isCancelled polled between chunks and between files.
 * @returns {Promise<object>} one of the four outcomes documented at the top.
 */
export async function runImport(files, {
  limits = IMPORT_LIMITS,
  onProgress = () => {},
  isCancelled = () => false,
} = {}) {
  const list = [...files];
  const totalBytes = list.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
  const headers = [];
  // The only row-shaped state in this module. Both are released in the
  // `finally` below, before any outcome is returned, so nothing row-shaped
  // survives the aggregation that consumed it.
  const providers = [];
  let hris = null;
  let bytesRead = 0;
  let rowsProcessed = 0;
  let ordinal = 0;

  const report = (phase) => onProgress({
    phase, bytesRead, totalBytes, rowsProcessed,
    fileOrdinal: ordinal, fileCount: list.length,
  });

  try {
    for (const file of list) {
      ordinal += 1;
      if (isCancelled()) return { status: "cancelled", bytesRead, rowsProcessed };
      const base = bytesRead;
      const text = await readFileText(file, {
        maxBytes: limits.maxFileBytes,
        isCancelled,
        baseBytes: base,
        onBytes: (value) => {
          bytesRead = value;
          report("reading");
        },
      });
      if (isCancelled()) return { status: "cancelled", bytesRead, rowsProcessed };
      report("parsing");

      // The reviewed validator, unmodified, on the whole document. Every error
      // object it throws is passed through untouched.
      const parsed = parseLocalFinopsFile(text, file.name ?? "local.json", file.type ?? "");

      const rows = parsed.document.records.length;
      if (rowsProcessed + rows > limits.maxRows) {
        throw refusal("too_many_rows",
          `This import reached ${groupDigits(rowsProcessed + rows)} records; this tab reconciles at `
          + `most ${groupDigits(limits.maxRows)}. No total is produced from a truncated import — `
          + "import fewer periods at a time.");
      }
      rowsProcessed += rows;
      headers.push(headerFor(parsed, ordinal, bytesRead - base));
      // Exactly the accumulation the shipped input handler already performed:
      // provider periods collect, and the most recent HRIS mapping wins.
      if (parsed.type === "provider") providers.push(parsed);
      else hris = parsed;
      report("parsed");
    }

    if (isCancelled()) return { status: "cancelled", bytesRead, rowsProcessed };

    if (!providers.length || !hris) {
      return {
        status: "incomplete",
        headers,
        providers: providers.length,
        hris: Boolean(hris),
        bytesRead,
        rowsProcessed,
      };
    }

    report("aggregating");
    const analysis = normalizeLocalFinopsHistory({ providers, hris });
    const verdict = serializeVerdict(trustVerdict({
      providers,
      hris,
      quarantinedExportIds: analysis.validation?.quarantinedExportIds ?? [],
    }));
    return {
      status: "ok",
      headers,
      analysis,
      verdict,
      providers: providers.length,
      hris: true,
      bytesRead,
      rowsProcessed,
    };
  } catch (error) {
    if (error instanceof Cancelled) return { status: "cancelled", bytesRead, rowsProcessed };
    return {
      status: "rejected",
      headers,
      bytesRead,
      rowsProcessed,
      error: {
        code: error?.code ?? "",
        message: error?.message ?? String(error),
        ordinal,
        total: list.length,
      },
    };
  } finally {
    // Aggregation is over; the records that fed it are not kept alive by this
    // module for one instruction longer than the call that needed them.
    providers.length = 0;
    hris = null;
  }
}
