// The Web Worker host for the browser-local FinOps import.
//
// This file is deliberately almost empty. It owns the message contract and
// nothing else; every decision about what a file means belongs to
// `finops-import-core.js`, which the main-thread fallback loads too. If logic
// appears here that is not in the core, the two execution paths have started to
// disagree, and that is the defect this split exists to prevent.
//
// ---------------------------------------------------------------------------
// Message contract
// ---------------------------------------------------------------------------
//
//   main → worker   { type: "start", files: File[], limits }
//   main → worker   { type: "cancel" }            cooperative; the runner also
//                                                 terminates, which is what
//                                                 actually guarantees a stop.
//
//   worker → main   { type: "progress", phase, bytesRead, totalBytes,
//                     rowsProcessed, fileOrdinal, fileCount }
//   worker → main   { type: "done", outcome }     ok | incomplete | rejected | cancelled
//   worker → main   { type: "failed", error }     the worker itself broke
//
// Nothing but headers and aggregates rides on `done`. File objects travel *in*
// (they are lazy handles, not bytes); no record array ever travels back out.

import { IMPORT_LIMITS, runImport } from "./finops-import-core.js";

// The worker global is captured once, at load, rather than looked up on every
// post. A long import outlives many turns of the event loop, and a captured
// reference cannot be swapped out from under a reply that is already in flight.
const host = self;

let cancelled = false;

host.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }
  if (message.type !== "start") return;
  cancelled = false;
  try {
    const outcome = await runImport(message.files ?? [], {
      limits: message.limits ?? IMPORT_LIMITS,
      isCancelled: () => cancelled,
      onProgress: (progress) => host.postMessage({ type: "progress", ...progress }),
    });
    host.postMessage({ type: "done", outcome });
  } catch (error) {
    // `runImport` turns every expected failure into a `rejected` outcome, so
    // reaching here means the worker host itself broke. Say so rather than
    // going silent and leaving the panel spinning.
    host.postMessage({
      type: "failed",
      error: { code: error?.code ?? "worker_failed", message: error?.message ?? String(error) },
    });
  }
});
