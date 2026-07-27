// Running one import off the main thread, or admitting that it could not be.
//
// The seam is `parseLocalImportFile(text, fileName, mediaType, options)` — the
// single boundary that takes raw file text and returns the validated v1 envelope
// the rest of the tab consumes. Nothing inside that boundary changes here. This
// module only decides *where* the call runs and reports how far along it is.
//
// The caller hands over both halves of the same call: a job the worker can
// reconstruct it from, and the synchronous call itself as `sync`. Exactly one of
// them runs per import. The worker imports `parseLocalImportFile` from the same
// module the page does, so there is one parser and two callers.
//
// Cancellation terminates the worker rather than setting a flag, because the
// parse is synchronous: a flag would be read after the work it was meant to stop
// had already finished. Termination drops the partial text with the thread, and
// the next run constructs a fresh worker — so the reader can immediately choose
// the same file again.
//
// Least privilege throughout: no network, no storage, no dynamic code. The
// worker URL is same-origin and static, which is what the shipped
// `script-src 'self'` policy allows; a blob-URL worker would be refused by it.

import { utf8ByteLength } from "./delimited-text.js";
import { describeProblem } from "./finops-tabular-import.js";
import { checkFileSizeCeiling, IMPORT_LIMITS } from "./import-limits.js";
import { CANCELLED_CODE, IMPORT_MESSAGES } from "./import-worker-core.js";

export { CANCELLED_CODE };

/**
 * How much text travels per message. Large enough that a 8 MB file is ~32
 * messages rather than thousands; small enough that no single post blocks a
 * frame. Slicing a string is cheap and rejoining the slices reproduces it
 * exactly, surrogate pairs included.
 */
export const DEFAULT_CHUNK_CHARS = 262_144;

function makeError(code, message, problems = []) {
  const error = new TypeError(message);
  error.code = code;
  if (problems.length) error.problems = Object.freeze(problems.map(Object.freeze));
  return error;
}

/** The error a run rejects with when the reader cancels it. Not a parse fault. */
export function cancelledError() {
  return makeError(CANCELLED_CODE, "The import was cancelled before it produced a result.");
}

/**
 * The up-front ceiling check, as the error the page already knows how to render.
 *
 * Returns `null` when the file is within the limit. Called before a worker is
 * started and before any text is decoded, so an oversized file costs nothing.
 */
export function checkImportCeiling(byteSize, limits = IMPORT_LIMITS) {
  const problem = checkFileSizeCeiling(byteSize, limits.maxBytes);
  return problem ? makeError(problem.code, describeProblem(problem), [problem]) : null;
}

/**
 * Is a worker even a possibility here?
 *
 * A straight-line capability check: does this realm expose the constructor. The
 * module-worker question cannot be answered without constructing one — engines
 * that predate module workers ignore the options bag entirely rather than
 * reporting anything — so it is answered at construction, below, by observing
 * whether the `type` option was read. No user-agent string is consulted anywhere
 * in this module.
 */
export function workerConstructorAvailable(scope = globalThis) {
  return typeof scope?.Worker === "function";
}

/**
 * Create the one offloader the page keeps for its lifetime.
 *
 * @param {{scope?: object, workerUrl?: string, createWorker?: Function,
 *   chunkChars?: number, limits?: object, yieldToTask?: () => Promise<void>}} [config]
 */
export function createImportOffloader({
  scope = globalThis,
  workerUrl = "/import-worker.js",
  createWorker = null,
  chunkChars = DEFAULT_CHUNK_CHARS,
  limits = IMPORT_LIMITS,
  yieldToTask = () => new Promise((resolve) => { setTimeout(resolve, 0); }),
} = {}) {
  let worker = null;
  let workerUnavailable = false;
  let pending = null;
  let sequence = 0;

  const settle = (outcome) => {
    if (!pending) return;
    const current = pending;
    pending = null;
    outcome(current);
  };

  const dropWorker = () => {
    const current = worker;
    worker = null;
    try {
      current?.terminate?.();
    } catch {
      // A worker that cannot be terminated is already gone. Nothing to recover.
    }
  };

  const onMessage = (event) => {
    const message = event?.data;
    if (!pending || !message || message.jobId !== pending.jobId) return;
    if (message.type === IMPORT_MESSAGES.progress) {
      pending.onProgress?.({
        phase: message.phase,
        ratio: message.ratio,
        loaded: message.loaded,
        total: message.total,
        unit: message.unit,
        byteSize: message.byteSize,
        coarse: false,
      });
      return;
    }
    if (message.type === IMPORT_MESSAGES.result) {
      settle((current) => {
        current.onProgress?.({ phase: "done", ratio: 1, coarse: false });
        // Structured clone drops the parser's freezes on the way over. Restoring
        // the top-level freeze keeps the result as read-only downstream as the
        // synchronous path's is; the values themselves are already identical.
        current.resolve(Object.freeze(message.value));
      });
      return;
    }
    if (message.type === IMPORT_MESSAGES.failure) {
      settle((current) => current.reject(makeError(message.code, message.message, message.problems)));
    }
  };

  // A worker that fails to load — a 404, a syntax error, a policy refusal — must
  // not hang the import. It is retired for the life of the page and the pending
  // job finishes on the synchronous path, with the same ceilings and the same
  // messages.
  const onError = () => {
    workerUnavailable = true;
    dropWorker();
    settle((current) => current.fallback());
  };

  const ensureWorker = () => {
    if (worker) return worker;
    if (workerUnavailable) return null;
    if (!createWorker && !workerConstructorAvailable(scope)) {
      workerUnavailable = true;
      return null;
    }
    let moduleOptionRead = false;
    const options = { get type() { moduleOptionRead = true; return "module"; } };
    let created = null;
    try {
      created = createWorker ? createWorker(workerUrl, options) : new scope.Worker(workerUrl, options);
    } catch {
      workerUnavailable = true;
      return null;
    }
    if (!moduleOptionRead) {
      // The engine ignored the options bag, so it would have loaded the shim as
      // a classic script and its `import` statements would throw inside a thread
      // this page cannot see. Retire it before it is ever used.
      try {
        created.terminate?.();
      } catch { /* already gone */ }
      workerUnavailable = true;
      return null;
    }
    created.onmessage = onMessage;
    created.onerror = onError;
    worker = created;
    return worker;
  };

  /**
   * Run one import.
   *
   * @param {{text: string, kind?: string, fileName?: string, mediaType?: string,
   *   byteSize?: number, options?: object, sync: () => object}} job
   *   `kind` selects the reader at the far end (`IMPORT_KINDS`); omitted, it is
   *   the usage import. `sync` must run the same reader on the same text, since
   *   it is what a browser without workers gets.
   * @param {{onProgress?: (progress: object) => void}} [hooks]
   */
  const run = async (job, { onProgress } = {}) => {
    // Whichever path runs, the ceiling is checked first and the file is refused
    // whole. No worker is started, no text is scanned, nothing partial exists.
    const text = String(job?.text ?? "");
    const byteSize = Number.isFinite(job?.byteSize) ? job.byteSize : utf8ByteLength(text);
    const oversize = checkImportCeiling(byteSize, limits);
    if (oversize) throw oversize;

    cancel();
    const active = ensureWorker();
    if (!active) {
      // Coarse by construction: the parse is synchronous and has no progress
      // hooks, and giving it some would mean editing frozen parsing code. The
      // surface says "this browser cannot show a fraction" rather than animating
      // a number it made up.
      onProgress?.({ phase: "parse", ratio: null, coarse: true });
      // One task boundary before the blocking call, so the notice the reader is
      // about to be stalled by actually reaches the screen first.
      await yieldToTask();
      const value = job.sync();
      onProgress?.({ phase: "done", ratio: 1, coarse: true });
      return value;
    }

    sequence += 1;
    const jobId = `import-${sequence}`;
    const settled = new Promise((resolve, reject) => {
      pending = {
        jobId,
        onProgress,
        resolve,
        reject,
        fallback: () => {
          try {
            resolve(job.sync());
          } catch (error) {
            reject(error);
          }
        },
      };
    });

    active.postMessage({
      type: IMPORT_MESSAGES.begin,
      jobId,
      // Which reader runs at the far end. Absent means the usage import, so a
      // caller written before this field behaves exactly as it did.
      kind: job.kind,
      fileName: job.fileName,
      mediaType: job.mediaType,
      options: job.options ?? {},
      total: text.length,
      byteSize,
      maxBytes: limits.maxBytes,
    });
    for (let offset = 0; offset < text.length; offset += chunkChars) {
      // The job can be cancelled, or the worker retired, between two chunks.
      if (!pending || pending.jobId !== jobId || !worker) break;
      worker.postMessage({
        type: IMPORT_MESSAGES.chunk, jobId, text: text.slice(offset, offset + chunkChars),
      });
      // One task per chunk. The main thread paints, scrolls, and answers clicks
      // between them; this is what keeps the frame budget intact on a big file.
      if (offset + chunkChars < text.length) await yieldToTask();
    }
    if (pending?.jobId === jobId && worker) {
      worker.postMessage({ type: IMPORT_MESSAGES.end, jobId });
    }
    return settled;
  };

  /**
   * Stop the running import and leave nothing behind.
   *
   * The worker is terminated, not asked to stop: a synchronous parse cannot read
   * a flag mid-flight. Partial text dies with the thread, the pending promise
   * rejects with `import_cancelled`, and the next `run` builds a fresh worker —
   * so re-selecting the same file immediately afterwards is an ordinary import.
   */
  function cancel() {
    if (!pending && !worker) return false;
    const had = pending !== null;
    if (worker && had) {
      worker.postMessage?.({ type: IMPORT_MESSAGES.cancel, jobId: pending.jobId });
      dropWorker();
    }
    settle((current) => current.reject(cancelledError()));
    return had;
  }

  return {
    run,
    cancel,
    /** "worker" once one is live, "sync" once one is ruled out, else "unknown". */
    get mode() {
      if (worker) return "worker";
      return workerUnavailable ? "sync" : "unknown";
    },
    get busy() { return pending !== null; },
    limits,
  };
}
