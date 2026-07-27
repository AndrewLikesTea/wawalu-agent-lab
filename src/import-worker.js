// The worker shell. Deliberately the thinnest file in the import path.
//
// Everything an import does lives in `import-worker-core.js`, which knows nothing
// about workers; this file is only the translation between that function and the
// message protocol. Keeping it this small is what makes the synchronous fallback
// honest — the fallback calls the same function, so there is no second
// implementation to keep in step, only a different way of being called.
//
// There is no cancel message. Cancellation terminates the worker from the page
// side, which is the only cancel that is guaranteed to interrupt a synchronous
// parse already in progress; a cooperative flag would be checked after the parse
// it was meant to stop. The page owns the worker's lifetime, so terminate is
// also what releases the file handle and every buffer this thread accumulated.

import { runImportJob } from "./import-worker-core.js";
import {
  doneMessage, errorMessage, IMPORT_REQUEST, limitExceededMessage,
} from "./import-protocol.js";

/**
 * Handle one request against a `postMessage`-shaped sink.
 *
 * Exported and injectable so a test can drive the real message sequence without
 * a browser: the shell below is the only worker-global code in the module, and
 * it does nothing but forward.
 */
export async function handleImportRequest(request, post) {
  try {
    const summary = await runImportJob(request.file, {
      fileName: request.fileName,
      mediaType: request.mediaType,
      // The core already emits protocol progress messages; forwarding them
      // verbatim is what keeps the two paths' progress shape identical.
      onProgress: (progress) => post(progress),
    });
    post(doneMessage(summary));
  } catch (error) {
    if (error?.name === "ImportLimitExceeded") {
      post(limitExceededMessage({
        code: error.code, limit: error.limit, observed: error.observed,
        unit: error.unit, message: error.message,
      }));
      return;
    }
    // Every other failure is a reviewed reason code from the parser, or an
    // unexpected throw. Both travel as `error`; neither carries a cell value,
    // because the parser's messages are built from coordinates only.
    post(errorMessage({
      code: error?.code ?? "unsupported_format",
      message: error?.message ?? "The file could not be read.",
      problems: Array.isArray(error?.problems) ? error.problems.slice(0, 200) : [],
    }));
  }
}

// Worker global. Absent when this module is imported on a main thread by a test.
if (typeof self !== "undefined" && typeof self.addEventListener === "function"
  && typeof self.postMessage === "function") {
  self.addEventListener("message", (event) => {
    if (event.data?.kind !== IMPORT_REQUEST) return;
    handleImportRequest(event.data, (message) => self.postMessage(message));
  });
}
