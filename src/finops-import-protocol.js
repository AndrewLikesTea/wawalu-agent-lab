// The wire contract between the import page and the import worker.
//
// Both sides import this module, so a message shape cannot drift: the worker
// builds every message with the constructors below and the page reads them
// through `isImportMessage`. Nothing here parses, validates, or normalizes a
// single record — that work stays in `local-finops.js`, unchanged.
//
// The ceilings live here too, for the same reason: the page checks the size
// ceiling before it starts a run, the worker checks the row ceiling while it
// runs, and the copy a reader sees is generated from the same two numbers.

/**
 * The declared ceilings for one import selection.
 *
 * Sizing, so the numbers are auditable rather than folklore. The intended case
 * is a year of provider usage data for a mid-size org. The contract aggregates
 * per day, org unit, and service, so 60 org units × 365 days is ~22,000 records
 * for a single series and ~88,000 across two providers and two service
 * categories. A v1 provider record serializes to ~350–400 bytes, so 8–32 MB.
 *
 * - `maxTotalBytes` 64 MiB (67,108,864) — 2× the top of that band, ~9× the low end.
 * - `maxRows` 200,000 records across the whole selection — 2.3× the top of that
 *   band, ~9× the low end.
 *
 * Both are ceilings, not targets: whichever binds first stops the run, and a
 * run that hits either one fails whole. Nothing is truncated, because a
 * truncated total presented as a total is a wrong number, not a smaller one.
 */
export const IMPORT_LIMITS = Object.freeze({
  maxTotalBytes: 64 * 1024 * 1024,
  maxRows: 200_000,
});

/** Bytes read per chunk. One MiB keeps progress frequent without thrashing. */
export const IMPORT_CHUNK_BYTES = 1024 * 1024;

/** At most ~5 UI repaints a second, so posting progress is never the cost. */
export const PROGRESS_THROTTLE_MS = 200;

export const IMPORT_MESSAGE = Object.freeze({
  START: "start",
  CANCEL: "cancel",
  PROGRESS: "progress",
  DONE: "done",
  ERROR: "error",
});

/** Codes this transport owns. Parser codes pass through untouched. */
export const IMPORT_ERROR = Object.freeze({
  FILE_TOO_LARGE: "file_too_large",
  TOO_MANY_ROWS: "too_many_rows",
  CANCELLED: "cancelled",
  WORKER_FAILED: "worker_failed",
});

// --- main -> worker --------------------------------------------------------

/** @param {File[]} files @param {typeof IMPORT_LIMITS} limits */
export function startMessage(files, limits = IMPORT_LIMITS) {
  return { type: IMPORT_MESSAGE.START, files: [...files], limits: { ...limits } };
}

export function cancelMessage() {
  return { type: IMPORT_MESSAGE.CANCEL };
}

// --- worker -> main --------------------------------------------------------

export function progressMessage({ rowsProcessed = 0, bytesProcessed = 0, totalBytes = 0 } = {}) {
  return {
    type: IMPORT_MESSAGE.PROGRESS,
    rowsProcessed: Number(rowsProcessed) || 0,
    bytesProcessed: Number(bytesProcessed) || 0,
    totalBytes: Number(totalBytes) || 0,
  };
}

/**
 * `result` carries the normalized aggregates only. Raw records never cross this
 * boundary; see `finops-import-engine.js` for where they are dropped.
 */
export function doneMessage(result, {
  status = "complete", providers = 0, hris = false, rowsProcessed = 0, bytesProcessed = 0,
} = {}) {
  return {
    type: IMPORT_MESSAGE.DONE,
    status,
    result: result ?? null,
    providers: Number(providers) || 0,
    hris: Boolean(hris),
    rowsProcessed: Number(rowsProcessed) || 0,
    bytesProcessed: Number(bytesProcessed) || 0,
  };
}

export function errorMessage(code, message, { ordinal = 0, total = 0 } = {}) {
  return {
    type: IMPORT_MESSAGE.ERROR,
    code: String(code ?? IMPORT_ERROR.WORKER_FAILED),
    message: String(message ?? "The import could not be completed."),
    ordinal: Number(ordinal) || 0,
    total: Number(total) || 0,
  };
}

const KNOWN_TYPES = new Set(Object.values(IMPORT_MESSAGE));

/** True when `value` is one of the five declared messages. */
export function isImportMessage(value) {
  return Boolean(value) && typeof value === "object" && KNOWN_TYPES.has(value.type);
}

// --- ceiling copy ----------------------------------------------------------

const MIB = 1024 * 1024;

/** Bytes in the unit a reader can act on. Never "0 MB" for a real quantity. */
function sizeText(bytes) {
  return bytes < MIB
    ? `${Math.round(bytes).toLocaleString("en-US")} bytes`
    : `${(bytes / MIB).toFixed(1)} MB`;
}

/** The one sentence that states both ceilings. Rendered in the import help. */
export function importLimitCopy(limits = IMPORT_LIMITS) {
  return `One import may total at most ${Math.round(limits.maxTotalBytes / MIB)} MB `
    + `and ${limits.maxRows.toLocaleString("en-US")} records. `
    + "Split a larger export by date range and import the parts in batches.";
}

/**
 * The message shown when a ceiling is hit: which limit, what was observed, and
 * the one action that fixes it. Never a truncation notice — the run failed.
 */
export function limitExceededMessage(code, observed, limits = IMPORT_LIMITS) {
  if (code === IMPORT_ERROR.FILE_TOO_LARGE) {
    return `The selection is ${sizeText(observed)}, above the `
      + `${sizeText(limits.maxTotalBytes)} import limit, so nothing was analyzed. `
      + "Split the export by date range and import one range at a time.";
  }
  return `The selection reached ${observed.toLocaleString("en-US")} records, above the `
    + `${limits.maxRows.toLocaleString("en-US")} record import limit, so nothing was analyzed. `
    + "Split the export by date range and import one range at a time.";
}
