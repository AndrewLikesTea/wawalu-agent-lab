// The work an import actually is, with no worker and no DOM in sight.
//
// This module is imported by three callers and behaves identically for all of
// them: the worker shell (`import-worker.js`), the synchronous fallback inside
// the façade (`import-runner.js`), and the tests. That is the point — the
// fallback is not a second implementation of the import, it is this function
// called on the main thread.
//
// What it adds around Rowan's reviewed parser, and nothing more:
//   * streaming decode, so no caller ever holds the file as a string before the
//     ceiling has been checked;
//   * a byte-paced progress callback with a real records-so-far count;
//   * an incremental record guard that stops at the row ceiling instead of
//     buffering a file the parser would reject at the end anyway;
//   * a fold that drops everything unbounded before the result is returned.
//
// It does not change how a file is parsed. `parseLocalImportFile` receives the
// same text, the same name, and the same media type it receives today, and its
// output is passed through untouched apart from the bounded-problem fold.

import { parseLocalImportFile } from "./finops-tabular-import.js";
import {
  MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, PROGRESS_BYTE_STEP, progressMessage,
} from "./import-protocol.js";
import { DELIMITED_CODES } from "./delimited-text.js";

/**
 * How many located problems survive the fold. A 50,000-row export with a broken
 * date column produces 50,000 problems; retaining all of them turns a bounded
 * import into an unbounded one for the worst input rather than the best. The
 * first 200 are enough to fix a column, and the per-code counts below say how
 * many more there were, so nothing is silently hidden.
 */
export const MAX_RETAINED_PROBLEMS = 200;

/** Extensions the record guard applies to. A `.json` newline is not a row. */
const DELIMITED_EXTENSIONS = new Set([".csv", ".tsv", ".txt"]);

/** Thrown when a caller's signal aborts mid-read. Never surfaced to a reader. */
export class ImportAborted extends Error {
  constructor() {
    super("The import was cancelled.");
    this.name = "ImportAborted";
    this.code = "aborted";
  }
}

/** Raised for a ceiling. Carries the three numbers the message has to name. */
export class ImportLimitExceeded extends Error {
  constructor({ code, limit, observed, unit, message }) {
    super(message);
    this.name = "ImportLimitExceeded";
    this.code = code;
    this.limit = limit;
    this.observed = observed;
    this.unit = unit;
  }
}

function extensionOf(fileName) {
  const name = String(fileName ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
}

function tooLarge(observed) {
  return new ImportLimitExceeded({
    code: DELIMITED_CODES.FILE_TOO_LARGE, limit: MAX_IMPORT_BYTES, observed, unit: "bytes",
    message: `The file is ${observed} bytes; the limit is ${MAX_IMPORT_BYTES} bytes. `
      + "Split the export by date range and import each period.",
  });
}

function tooManyRows(observed) {
  return new ImportLimitExceeded({
    code: DELIMITED_CODES.TOO_MANY_ROWS, limit: MAX_IMPORT_ROWS, observed, unit: "rows",
    message: `The file has more than ${MAX_IMPORT_ROWS} rows (${observed} counted before the read `
      + "stopped). Split the export by date range and import each period.",
  });
}

/**
 * Count records the way the reviewed reader counts them, one chunk at a time.
 *
 * Three rules have to match `readDelimitedText` or the guard would reject files
 * the parser accepts: a newline inside a quoted field does not end a record, a
 * record whose only content is whitespace is not a record, and the final record
 * counts even without a trailing newline. Quote state is tracked by toggling on
 * `"`, which is exactly right for well-formed RFC4180 text.
 *
 * Where it is deliberately conservative: a record consisting solely of a quoted
 * whitespace field is blank to the parser and one record to this counter, so the
 * count is an upper bound rather than an equality. That direction is the safe
 * one for a guard — it can only stop early on a file already at the ceiling, and
 * it can never let one through. The parser remains the authority on the final
 * row count; this count exists for two things and no third: the rows-so-far the
 * reader sees, and stopping at the ceiling.
 */
export function createRecordCounter() {
  let records = 0;
  let inQuotes = false;
  let lineHasContent = false;
  let pendingCarriageReturn = false;
  return {
    /** Fold one decoded chunk in. Returns the running record count. */
    push(chunk) {
      for (let index = 0; index < chunk.length; index += 1) {
        const character = chunk[index];
        if (character === '"') {
          inQuotes = !inQuotes;
          lineHasContent = true;
          pendingCarriageReturn = false;
          continue;
        }
        if (inQuotes) {
          pendingCarriageReturn = false;
          continue;
        }
        if (character === "\n" || character === "\r") {
          // CRLF is one terminator. A bare LF following a counted CR must not
          // count a second, empty record.
          const swallowed = character === "\n" && pendingCarriageReturn;
          pendingCarriageReturn = character === "\r";
          if (!swallowed && lineHasContent) records += 1;
          lineHasContent = false;
          continue;
        }
        pendingCarriageReturn = false;
        if (character !== " " && character !== "\t") lineHasContent = true;
      }
      return records;
    },
    /** The count including a final record with no trailing terminator. */
    total() {
      return records + (lineHasContent ? 1 : 0);
    },
    /** The count of complete records seen so far, for progress reporting. */
    counted() {
      return records;
    },
  };
}

function abortedBy(signal) {
  return Boolean(signal?.aborted);
}

/**
 * Stream the file into a string, guarding both ceilings on the way.
 *
 * The whole point of the stream is that the ceiling is enforced *while* reading:
 * a file whose declared size is a lie, or whose record count blows past the
 * limit in its first megabyte, costs one chunk rather than a full decode. The
 * accumulated string is bounded by `MAX_IMPORT_BYTES` by construction.
 */
async function readWithGuards(file, { onProgress, signal, applyRecordGuard }) {
  const totalBytes = Number(file.size) || 0;
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  const counter = createRecordCounter();
  let text = "";
  let bytesRead = 0;
  let reportedAt = 0;

  try {
    for (;;) {
      if (abortedBy(signal)) throw new ImportAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      // A stream that overruns the declared size is a ceiling breach whether or
      // not `file.size` was honest about it.
      if (bytesRead > MAX_IMPORT_BYTES) throw tooLarge(bytesRead);
      const chunk = decoder.decode(value, { stream: true });
      text += chunk;
      const records = applyRecordGuard ? counter.push(chunk) : 0;
      if (applyRecordGuard && records > MAX_IMPORT_ROWS) throw tooManyRows(records);
      if (bytesRead - reportedAt >= PROGRESS_BYTE_STEP) {
        reportedAt = bytesRead;
        // A protocol message, not a bare object: the worker forwards this
        // verbatim, so the fallback path hands its caller the identical shape
        // rather than something the UI has to normalize differently.
        onProgress?.(progressMessage({ bytesRead, totalBytes, rows: counter.counted() }));
      }
    }
    const tail = decoder.decode();
    if (tail) {
      text += tail;
      if (applyRecordGuard) counter.push(tail);
    }
    if (applyRecordGuard && counter.total() > MAX_IMPORT_ROWS) throw tooManyRows(counter.total());
    if (abortedBy(signal)) throw new ImportAborted();
    onProgress?.(progressMessage({ bytesRead, totalBytes, rows: counter.total() }));
    return { text, bytesRead, records: counter.total() };
  } finally {
    // Cancelling the reader is what releases the underlying file handle on the
    // abort and ceiling paths. Without it the blob stays pinned until GC and a
    // cancelled 8 MB import is still holding 8 MB.
    await reader.cancel().catch(() => {});
  }
}

/**
 * Drop everything the downstream analysis does not consume.
 *
 * The parser already hands back an aggregated envelope rather than rows, so the
 * only unbounded field left is the located-problem list. It is capped here, with
 * the per-code totals kept so a truncated list never reads as a complete one.
 * `type`, `fileName`, and `document` pass through byte-identical, because that
 * is the shape `normalizeLocalFinopsHistory` already reads.
 */
export function foldImportResult(parsed, { bytesRead = 0, records = 0 } = {}) {
  const problems = Array.isArray(parsed.problems) ? parsed.problems : [];
  const problemCounts = {};
  for (const problem of problems) {
    problemCounts[problem.code] = (problemCounts[problem.code] ?? 0) + 1;
  }
  return {
    type: parsed.type,
    fileName: parsed.fileName,
    document: parsed.document,
    shape: parsed.shape ?? null,
    problems: problems.slice(0, MAX_RETAINED_PROBLEMS),
    problemCounts,
    problemsTotal: problems.length,
    problemsTruncated: problems.length > MAX_RETAINED_PROBLEMS,
    bytesRead,
    records,
    recordCount: Array.isArray(parsed.document?.records) ? parsed.document.records.length : 0,
  };
}

/**
 * Run one import end to end.
 *
 * Always either resolves with a folded summary or rejects with an
 * `ImportAborted`, an `ImportLimitExceeded`, or whatever `parseLocalImportFile`
 * already throws — the same error, with the same `code`, that the page's
 * diagnostic surface handles today.
 */
export async function runImportJob(file, { onProgress, signal, fileName, mediaType } = {}) {
  const name = fileName ?? file?.name ?? "local.json";
  const type = mediaType ?? file?.type ?? "";
  if (abortedBy(signal)) throw new ImportAborted();
  // The declared size is checked before a byte is read, so an oversized file
  // never reaches the stream at all.
  const declared = Number(file?.size) || 0;
  if (declared > MAX_IMPORT_BYTES) throw tooLarge(declared);

  const { text, bytesRead, records } = await readWithGuards(file, {
    onProgress, signal, applyRecordGuard: DELIMITED_EXTENSIONS.has(extensionOf(name)),
  });
  if (abortedBy(signal)) throw new ImportAborted();
  const parsed = parseLocalImportFile(text, name, type);
  return foldImportResult(parsed, { bytesRead, records });
}
