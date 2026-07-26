// The main thread's half of the import: start a worker, throttle its progress,
// cancel it, and fall back to the synchronous path when there is no worker.
//
// Design rules this file exists to hold:
//
// - The fallback is the same job, not a second implementation. Both branches
//   call `runImportJob`; the worker branch just runs it somewhere else. A
//   browser without module workers therefore loses latency, never a feature and
//   never a different number.
// - Cancel is terminal and immediate: the worker is terminated, the in-flight
//   promise rejects with `cancelled`, and every reference this runner held is
//   dropped. There is no "cancelling" state for a caller to get stuck in.
// - The main thread never receives a raw record. What comes back over `done` is
//   the normalized brief and two counters.

import { runImportJob, ImportJobError } from "./finops-import-engine.js";
import {
  cancelMessage, IMPORT_ERROR, IMPORT_LIMITS, IMPORT_MESSAGE, isImportMessage,
  PROGRESS_THROTTLE_MS, startMessage,
} from "./finops-import-protocol.js";

const WORKER_URL = new URL("./finops-import-worker.js", import.meta.url);

/** Cheap capability gate. Construction is still guarded — this is not a promise. */
export function workerSupported(scope = globalThis) {
  return typeof scope?.Worker === "function";
}

/**
 * Construct a module worker, or return null.
 *
 * A browser that predates module workers ignores the `type` option instead of
 * failing, and would then load an ES module as a classic script and throw at
 * the first `import`. The getter detects that: if the option bag was never
 * read, the browser is not honouring `type` and we take the fallback.
 */
function constructWorker(scope, url) {
  if (!workerSupported(scope)) return null;
  let typeRead = false;
  try {
    const worker = new scope.Worker(url, {
      get type() { typeRead = true; return "module"; },
    });
    if (typeRead) return worker;
    worker.terminate?.();
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {{scope?: object, workerUrl?: URL|string, limits?: typeof IMPORT_LIMITS,
 *   throttleMs?: number, now?: () => number}} [options]
 *   `scope` and `workerUrl` are injection points for tests; production passes
 *   neither.
 */
export function createImportRunner({
  scope = globalThis,
  workerUrl = WORKER_URL,
  limits = IMPORT_LIMITS,
  throttleMs = PROGRESS_THROTTLE_MS,
  now = () => Date.now(),
} = {}) {
  let worker = null;
  let cancelled = false;
  let settle = null;
  let mode = "idle";

  /** Drop every reference this run held. Called on done, error, and cancel. */
  const release = () => {
    worker?.terminate?.();
    worker = null;
    settle = null;
  };

  const runInWorker = (files, onProgress) => new Promise((resolve, reject) => {
    // -Infinity, not 0: the first progress message always paints, so the bar
    // appears immediately and only the repeats are throttled.
    let lastEmit = -Infinity;
    settle = { resolve, reject };
    worker.addEventListener("message", (event) => {
      const message = event?.data;
      if (!isImportMessage(message) || !settle) return;
      if (message.type === IMPORT_MESSAGE.PROGRESS) {
        // Throttled here rather than in the worker: the worker should post
        // freely, and the main thread decides how often it repaints.
        const at = now();
        if (at - lastEmit < throttleMs) return;
        lastEmit = at;
        onProgress?.(message);
        return;
      }
      if (message.type === IMPORT_MESSAGE.DONE) {
        const done = settle;
        release();
        done.resolve({
          status: message.status,
          result: message.result,
          providers: message.providers,
          hris: message.hris,
          rowsProcessed: message.rowsProcessed,
          bytesProcessed: message.bytesProcessed,
          path: "worker",
        });
        return;
      }
      const failed = settle;
      release();
      failed.reject(new ImportJobError(message.code, message.message, message));
    });
    worker.addEventListener("error", (event) => {
      if (!settle) return;
      const failed = settle;
      release();
      failed.reject(new ImportJobError(
        IMPORT_ERROR.WORKER_FAILED,
        event?.message ?? "The background import worker stopped unexpectedly.",
      ));
    });
    worker.postMessage(startMessage(files, limits));
  });

  const runInline = async (files, onProgress) => {
    // -Infinity, not 0: the first progress message always paints, so the bar
    // appears immediately and only the repeats are throttled.
    let lastEmit = -Infinity;
    const outcome = await runImportJob({
      files,
      limits,
      isCancelled: () => cancelled,
      onProgress: (progress) => {
        const at = now();
        if (at - lastEmit < throttleMs) return;
        lastEmit = at;
        onProgress?.(progress);
      },
    });
    return { ...outcome, path: "inline" };
  };

  return {
    /** "worker" or "inline" for the last started run; "idle" before the first. */
    get mode() { return mode; },

    /**
     * Run the selection. Resolves with the engine outcome plus the path taken;
     * rejects with an `ImportJobError` for a ceiling breach, a parser
     * rejection, or a cancel.
     */
    async run(files, { onProgress } = {}) {
      cancelled = false;
      worker = constructWorker(scope, workerUrl);
      mode = worker ? "worker" : "inline";
      try {
        return worker
          ? await runInWorker(files, onProgress)
          : await runInline(files, onProgress);
      } finally {
        release();
      }
    },

    /**
     * Terminate the run. The worker dies with its partial state inside it, and
     * the caller's promise rejects, so no partial total can reach the page.
     */
    cancel() {
      cancelled = true;
      if (worker) {
        // Ask first, then terminate: a worker that is mid-chunk stops at its
        // next check, and termination covers the case where it is not.
        try { worker.postMessage(cancelMessage()); } catch { /* already gone */ }
      }
      const pending = settle;
      release();
      pending?.reject(new ImportJobError(
        IMPORT_ERROR.CANCELLED, "The import was cancelled; nothing was analyzed.",
      ));
      return true;
    },
  };
}
