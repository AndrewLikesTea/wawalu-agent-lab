// The execution wrapper for the browser-local FinOps import.
//
// One call, one interface, two hosts:
//
//   const run = startFinopsImport(files, { onProgress });
//   run.cancel();                 // terminates the worker, settles "cancelled"
//   const outcome = await run.settled;
//
// `outcome` is the same shape whichever host ran it — the four statuses
// documented in `finops-import-core.js` — and the caller is not expected to
// know, or allowed to branch on, which one it was. `outcome.via` exists for the
// performance test and for a bug report; nothing in the UI reads it.
//
// Selection happens at call time by feature detection, never by user-agent:
// a Worker is used when `Worker` exists and can be constructed, and the same
// core runs inline on the calling thread when it cannot. A worker that dies
// before producing its first message (a Content-Security-Policy refusal, a
// missing asset, a browser that constructs Workers but cannot load modules into
// them) is treated as "unavailable" and the inline path takes over, so a
// deployment mistake degrades to a slower import rather than to no import.

import { IMPORT_LIMITS, reviveVerdict, runImport } from "./finops-import-core.js";

/** Modules cannot be loaded into a Worker on every browser; this is checked, not assumed. */
function defaultCreateWorker() {
  if (typeof globalThis.Worker !== "function" || typeof globalThis.URL !== "function") return null;
  try {
    return new globalThis.Worker(new URL("./finops-import-worker.js", import.meta.url), {
      type: "module",
      name: "finops-import",
    });
  } catch {
    return null;
  }
}

/** The one place an outcome is finished for the caller, so both hosts agree. */
function finish(outcome, via) {
  if (outcome.status === "ok") return Object.freeze({ ...outcome, verdict: reviveVerdict(outcome.verdict), via });
  return Object.freeze({ ...outcome, via });
}

function runInline(files, { limits, onProgress, state }) {
  return runImport(files, {
    limits,
    onProgress,
    isCancelled: () => state.cancelled,
  }).then((outcome) => finish(outcome, "main"));
}

/**
 * Start an import.
 *
 * @param {Array<File>} files the selection, in the order it was made.
 * @param {object} options
 * @param {object} options.limits ceilings to enforce; defaults to `IMPORT_LIMITS`.
 * @param {Function} options.onProgress receives every progress event, in order.
 * @param {Function} options.createWorker test seam; returns a Worker or null.
 * @returns {{ settled: Promise<object>, cancel: Function }}
 */
export function startFinopsImport(files, {
  limits = IMPORT_LIMITS,
  onProgress = () => {},
  createWorker = defaultCreateWorker,
} = {}) {
  const list = [...files];
  const state = { cancelled: false, settled: false };
  let cancel = () => { state.cancelled = true; };

  const worker = state.cancelled ? null : createWorker();
  if (!worker) {
    return { settled: runInline(list, { limits, onProgress, state }), cancel };
  }

  const settled = new Promise((resolve) => {
    let spoke = false;
    const settle = (outcome) => {
      if (state.settled) return;
      state.settled = true;
      try {
        worker.terminate();
      } catch { /* already gone */ }
      resolve(outcome);
    };
    // The worker is terminated rather than politely asked to stop. A cooperative
    // flag cannot interrupt a `JSON.parse` already in flight; termination can,
    // and it is the mechanism that makes cancel a promise the UI can keep.
    cancel = () => {
      state.cancelled = true;
      settle(finish({ status: "cancelled", bytesRead: 0, rowsProcessed: 0 }, "worker"));
    };
    worker.addEventListener("message", (event) => {
      const message = event.data ?? {};
      spoke = true;
      if (message.type === "progress") {
        const { type, ...progress } = message;
        onProgress(progress);
        return;
      }
      if (message.type === "done") {
        settle(finish(message.outcome, "worker"));
        return;
      }
      if (message.type === "failed") {
        settle(finish({
          status: "rejected",
          headers: [],
          bytesRead: 0,
          rowsProcessed: 0,
          error: { ...message.error, ordinal: 0, total: list.length },
        }, "worker"));
      }
    });
    const unavailable = () => {
      if (state.settled) return;
      if (spoke) {
        // It had started work and then died. Re-running the same files inline
        // could double the wait after an already-long import, so this is a
        // failure, reported as one.
        settle(finish({
          status: "rejected",
          headers: [],
          bytesRead: 0,
          rowsProcessed: 0,
          error: {
            code: "worker_failed",
            message: "The background import thread stopped before it produced a result. "
              + "Select the files again.",
            ordinal: 0,
            total: list.length,
          },
        }, "worker"));
        return;
      }
      state.settled = true;
      try {
        worker.terminate();
      } catch { /* already gone */ }
      // Cancellation has to follow the work. Once the inline path owns the run,
      // `cancel` sets the flag that path polls instead of terminating a worker
      // that is already gone.
      cancel = () => { state.cancelled = true; };
      resolve(runInline(list, { limits, onProgress, state }));
    };
    worker.addEventListener("error", unavailable);
    worker.addEventListener("messageerror", unavailable);
    worker.postMessage({ type: "start", files: list, limits });
  });

  return { settled, cancel: () => cancel() };
}
