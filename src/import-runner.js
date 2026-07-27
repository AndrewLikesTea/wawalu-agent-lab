// The one call site for importing a selected file.
//
//   const summary = await runImport(file, { onProgress, signal })
//
// Callers do not know, and must not ask, whether a worker ran it. The two paths
// take the same arguments, return the same folded summary, and reject with the
// same errors carrying the same reason codes, because both call the same
// `runImportJob`. The only observable differences are the two this cannot hide:
// on the fallback path progress arrives in coarser steps and an abort is honoured
// at the next chunk boundary rather than immediately.
//
// Lifetime: one worker per import, terminated on every exit — success, failure,
// and cancel alike. A pooled worker would be cheaper and would also mean a
// cancelled import's buffers outlive the cancel, which is the bug this task
// exists to prevent.

import {
  IMPORT_MESSAGE, importRequest, isImportMessage,
} from "./import-protocol.js";
import { ImportAborted, ImportLimitExceeded, runImportJob } from "./import-worker-core.js";

export { ImportAborted, ImportLimitExceeded };

// The bundler-supported form, and the only one this build can emit: the URL is
// static and relative to this module, so the worker module ships as its own file
// next to its importer rather than as a string this file would have to inline.
function defaultCreateWorker() {
  if (typeof Worker !== "function" || typeof URL !== "function") {
    throw new TypeError("dedicated module workers are not available on this platform");
  }
  return new Worker(new URL("./import-worker.js", import.meta.url), { type: "module" });
}

/** Internal sentinel: the worker never came up, so this import owes a fallback. */
const WORKER_UNAVAILABLE = Symbol("worker-unavailable");

/**
 * Feature detection, run once when this module is first imported.
 *
 * The capability check (`Worker` present, `URL` present) lives in the factory,
 * so this is one question: does constructing the real worker succeed. That is
 * the question that catches what a capability check cannot — a
 * Content-Security-Policy without `worker-src`, a `file://` origin, an embedder
 * that blocks dedicated workers — and it is answered by construction rather than
 * by guessing. The probe is terminated immediately; it exists to throw or not.
 *
 * A browser that ignores `{ type: "module" }` and loads the shell as a classic
 * script constructs fine here and fails at its first `import`. That surfaces as
 * an `error` event before any message, which `runInWorker` reports as
 * unavailable, and `runImport` answers by finishing the same import on the
 * fallback path and never trying a worker again.
 */
function detectWorkerSupport(createWorker) {
  let probe = null;
  try {
    probe = createWorker();
    return true;
  } catch {
    return false;
  } finally {
    try {
      probe?.terminate();
    } catch { /* a probe that cannot be terminated was never a worker */ }
  }
}

function rebuildError({ code, message, problems }) {
  const error = new TypeError(message);
  error.code = code;
  if (problems?.length) error.problems = problems;
  return error;
}

function runInWorker(file, { onProgress, signal }, createWorker) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = createWorker();
    } catch {
      reject(WORKER_UNAVAILABLE);
      return;
    }
    let settled = false;
    let spoke = false;

    const release = () => {
      signal?.removeEventListener?.("abort", onAbort);
      // Terminate, always. This is what orphans nothing: no worker left running
      // a parse whose result no one will read, no accumulated text retained past
      // the moment its summary was handed over.
      try {
        worker.terminate();
      } catch { /* already gone */ }
    };
    const settle = (action, value) => {
      if (settled) return;
      settled = true;
      release();
      action(value);
    };
    function onAbort() {
      settle(reject, new ImportAborted());
    }

    worker.addEventListener?.("message", (event) => {
      const message = event.data;
      // An undeclared kind is dropped rather than guessed at. The protocol is a
      // closed union; a message outside it means the two sides have drifted, and
      // acting on it would be acting on a contract that no longer exists.
      if (!isImportMessage(message)) return;
      spoke = true;
      if (message.kind === IMPORT_MESSAGE.PROGRESS) {
        if (!settled) onProgress?.(message);
        return;
      }
      if (message.kind === IMPORT_MESSAGE.DONE) {
        settle(resolve, message.summary);
        return;
      }
      if (message.kind === IMPORT_MESSAGE.LIMIT_EXCEEDED) {
        settle(reject, new ImportLimitExceeded(message));
        return;
      }
      settle(reject, rebuildError(message));
    });
    // An error before the worker has said anything means the module never ran.
    // After it has spoken, the module is live and an error is a real failure.
    worker.addEventListener?.("error", (event) => {
      event.preventDefault?.();
      settle(reject, spoke
        ? rebuildError({ code: "unsupported_format", message: "The import worker stopped unexpectedly." })
        : WORKER_UNAVAILABLE);
    });
    worker.addEventListener?.("messageerror", () => settle(reject, WORKER_UNAVAILABLE));

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    // The File itself crosses the boundary. It is a handle, not the bytes: the
    // worker opens the stream, so nothing ever reads the file into a string on
    // this thread.
    worker.postMessage(importRequest({
      file, fileName: file?.name ?? "local.json", mediaType: file?.type ?? "",
    }));
  });
}

/**
 * Build a façade over an explicit worker factory. Production uses the default
 * instance below; a test uses this to supply a stand-in worker, or to force the
 * fallback path, without either side of the contract changing shape.
 */
export function createImportRunner({ createWorker = defaultCreateWorker } = {}) {
  let workerAvailable = detectWorkerSupport(createWorker);

  async function runImport(file, { onProgress, signal } = {}) {
    if (workerAvailable) {
      try {
        return await runInWorker(file, { onProgress, signal }, createWorker);
      } catch (error) {
        if (error !== WORKER_UNAVAILABLE) throw error;
        // The worker was detected but did not come up. Stop trying, and finish
        // *this* import rather than making the reader retry it.
        workerAvailable = false;
      }
    }
    return runImportJob(file, { onProgress, signal });
  }

  return {
    runImport,
    /** Which path is live. For diagnostics and tests; never for branching a caller. */
    get path() {
      return workerAvailable ? "worker" : "sync";
    },
  };
}

const runner = createImportRunner();

/** The façade. Same inputs, same outputs, same errors, whichever path is live. */
export function runImport(file, options) {
  return runner.runImport(file, options);
}

/** The live path, for the diagnostics copy only. */
export function importPath() {
  return runner.path;
}
