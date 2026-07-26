// The import job, written once and run in both places.
//
// The worker runs it off the main thread; the fallback runs it on the main
// thread when a browser has no module worker. Both call `runImportJob`, so the
// two paths cannot produce different numbers — there is only one path.
//
// What this module owns: reading a File in chunks so progress can be reported,
// enforcing the two declared ceilings, and dropping raw records as soon as the
// aggregates that replace them exist.
//
// What it does not own, and must never learn: parsing, column handling,
// rounding, or output shape. Those belong to `local-finops.js` and are called
// here exactly as the page called them before — same functions, same
// arguments, same order.

import { normalizeLocalFinopsHistory, parseLocalFinopsFile } from "./local-finops.js";
import {
  IMPORT_CHUNK_BYTES, IMPORT_ERROR, IMPORT_LIMITS, limitExceededMessage,
} from "./finops-import-protocol.js";

/**
 * An error that already knows how it should be reported: a stable code, the
 * sentence a reader sees, and which file in the selection produced it.
 */
export class ImportJobError extends Error {
  constructor(code, message, { ordinal = 0, total = 0 } = {}) {
    super(message);
    this.name = "ImportJobError";
    this.code = code;
    this.ordinal = ordinal;
    this.total = total;
  }
}

const cancelled = () => new ImportJobError(
  IMPORT_ERROR.CANCELLED, "The import was cancelled; nothing was analyzed.",
);

/**
 * Read one File to text in chunks, reporting bytes as it goes.
 *
 * `onChunk` receives the running byte count for this file and may throw to
 * abort — that is how the byte ceiling stops a file whose declared size lied.
 * The decoder is fed with `stream: true` so a multi-byte character split across
 * a chunk boundary still decodes to the same text a single read would produce.
 */
export async function readFileChunked(file, { onChunk, isCancelled } = {}) {
  const total = Number(file?.size ?? 0);
  if (typeof file?.slice !== "function" || !Number.isFinite(total)) {
    return String(await file.text());
  }
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let read = 0;
  while (read < total) {
    if (isCancelled?.()) throw cancelled();
    const end = Math.min(read + IMPORT_CHUNK_BYTES, total);
    const buffer = await file.slice(read, end).arrayBuffer();
    text += decoder.decode(new Uint8Array(buffer), { stream: end < total });
    read = end;
    onChunk?.(read);
  }
  return text;
}

/**
 * Parse and normalize a selection of files.
 *
 * @param {{files: File[], limits?: typeof IMPORT_LIMITS,
 *   onProgress?: (progress: {rowsProcessed: number, bytesProcessed: number, totalBytes: number}) => void,
 *   isCancelled?: () => boolean}} job
 * @returns {Promise<{status: "complete"|"incomplete", result: object|null,
 *   providers: number, hris: boolean, rowsProcessed: number, bytesProcessed: number}>}
 *
 * `incomplete` is not a failure: the shipped flow lets a reader add the
 * provider periods and the HRIS mapping in separate batches, and the caller
 * re-runs the job over the accumulated selection. Only counts come back in that
 * case, never documents, so the caller cannot accumulate rows by accident.
 *
 * Throws `ImportJobError` for a ceiling breach, a cancel, or a parser
 * rejection. A breach fails the whole run: no partial total is ever returned.
 */
export async function runImportJob({
  files = [], limits = IMPORT_LIMITS, onProgress, isCancelled,
} = {}) {
  const list = [...files];
  const total = list.length;
  const totalBytes = list.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
  if (totalBytes > limits.maxTotalBytes) {
    throw new ImportJobError(
      IMPORT_ERROR.FILE_TOO_LARGE,
      limitExceededMessage(IMPORT_ERROR.FILE_TOO_LARGE, totalBytes, limits),
      { total },
    );
  }

  const providers = [];
  let hris = null;
  let rowsProcessed = 0;
  let bytesProcessed = 0;
  let ordinal = 0;

  for (const file of list) {
    ordinal += 1;
    if (isCancelled?.()) throw cancelled();
    const before = bytesProcessed;
    let text = await readFileChunked(file, {
      isCancelled,
      onChunk: (read) => {
        // A File's declared size is a claim; the bytes actually read are the
        // fact. Check the ceiling against the fact, mid-file.
        if (before + read > limits.maxTotalBytes) {
          throw new ImportJobError(
            IMPORT_ERROR.FILE_TOO_LARGE,
            limitExceededMessage(IMPORT_ERROR.FILE_TOO_LARGE, before + read, limits),
            { ordinal, total },
          );
        }
        bytesProcessed = before + read;
        onProgress?.({ rowsProcessed, bytesProcessed, totalBytes });
      },
    });
    if (isCancelled?.()) throw cancelled();

    let parsed;
    try {
      // The frozen boundary: same call the synchronous page made.
      parsed = parseLocalFinopsFile(text, file.name, file.type);
    } catch (error) {
      throw new ImportJobError(
        error?.code ?? "invalid_json",
        error?.message ?? "The file could not be parsed.",
        { ordinal, total },
      );
    } finally {
      text = null; // The source text is dead the moment it is parsed.
    }

    rowsProcessed += parsed.document.records.length;
    if (rowsProcessed > limits.maxRows) {
      throw new ImportJobError(
        IMPORT_ERROR.TOO_MANY_ROWS,
        limitExceededMessage(IMPORT_ERROR.TOO_MANY_ROWS, rowsProcessed, limits),
        { ordinal, total },
      );
    }
    if (parsed.type === "provider") providers.push(parsed);
    else hris = parsed;
    onProgress?.({ rowsProcessed, bytesProcessed, totalBytes });
  }

  if (!providers.length || !hris) {
    return {
      status: "incomplete",
      result: null,
      providers: providers.length,
      hris: Boolean(hris),
      rowsProcessed,
      bytesProcessed,
    };
  }

  if (isCancelled?.()) throw cancelled();
  const providerCount = providers.length;
  let result;
  try {
    result = normalizeLocalFinopsHistory({ providers, hris });
  } catch (error) {
    throw new ImportJobError(
      error?.code ?? "incomplete_pair",
      error?.message ?? "The selection could not be normalized.",
      { total },
    );
  } finally {
    // Aggregates exist; the documents that produced them do not need to.
    providers.length = 0;
    hris = null;
  }

  return {
    status: "complete",
    result,
    providers: providerCount,
    hris: true,
    rowsProcessed,
    bytesProcessed,
  };
}
