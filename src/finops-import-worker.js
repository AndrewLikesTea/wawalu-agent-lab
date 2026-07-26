// The worker side of the import. A shim and nothing else.
//
// It owns the message loop and a cancel flag. Every byte of parsing and
// normalization comes from `finops-import-engine.js`, which calls the same
// `local-finops.js` functions the synchronous fallback calls. No parsing logic
// is duplicated here, and none may be added.

import { runImportJob } from "./finops-import-engine.js";
import {
  doneMessage, errorMessage, IMPORT_ERROR, IMPORT_MESSAGE, progressMessage,
} from "./finops-import-protocol.js";

/** Wire a worker scope to the job. Exported so a test can drive it directly. */
export function attachImportWorker(scope) {
  let cancelling = false;
  scope.addEventListener("message", async (event) => {
    const message = event?.data;
    if (message?.type === IMPORT_MESSAGE.CANCEL) {
      // The page terminates the worker as well; this only stops the job early
      // if termination has not landed yet.
      cancelling = true;
      return;
    }
    if (message?.type !== IMPORT_MESSAGE.START) return;
    cancelling = false;
    try {
      const outcome = await runImportJob({
        files: message.files,
        limits: message.limits,
        isCancelled: () => cancelling,
        onProgress: (progress) => scope.postMessage(progressMessage(progress)),
      });
      // Only aggregates and counts cross back. `outcome.result` is the
      // normalized brief; the parsed documents were dropped in the engine.
      scope.postMessage(doneMessage(outcome.result, outcome));
    } catch (error) {
      scope.postMessage(errorMessage(
        error?.code ?? IMPORT_ERROR.WORKER_FAILED,
        error?.message,
        { ordinal: error?.ordinal, total: error?.total },
      ));
    }
  });
}

// Only self-wire inside an actual worker scope, so importing this module in a
// test (or in a build check) has no side effect.
if (typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined"
  && self instanceof WorkerGlobalScope) {
  attachImportWorker(self);
}
