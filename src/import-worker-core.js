// What the import worker does, without the worker.
//
// `import-worker.js` is a six-line shim that binds this session to `self`. The
// logic lives here so a test can drive the exact message protocol the browser
// drives, in-process, and so there is one protocol implementation rather than
// one per caller.
//
// This module parses nothing itself. It calls `parseLocalImportFile` — the same
// export, from the same module, that the synchronous page path calls. Moving
// execution is the whole point of this task; a second copy of the parser here
// would be the hidden coupling the move is supposed to avoid, and the two copies
// would disagree the first time either was touched.
//
// The transfer is chunked so progress is a real fraction of a known total rather
// than a spinner. The parse itself is synchronous and has no progress hooks, and
// giving it some would mean editing frozen parsing code — so the parse phase is
// reported as one determinate step, and the surface says so.
//
// No network, no storage, no DOM. The worker holds the file text for exactly as
// long as one parse takes and drops it before it posts the result.

import { describeProblem, parseLocalImportFile } from "./finops-tabular-import.js";
import { checkFileSizeCeiling, MAX_IMPORT_BYTES } from "./import-limits.js";

/** The wire protocol. Both directions, named once. */
export const IMPORT_MESSAGES = Object.freeze({
  begin: "import:begin",
  chunk: "import:chunk",
  end: "import:end",
  cancel: "import:cancel",
  progress: "import:progress",
  result: "import:result",
  failure: "import:failure",
});

/** The reason code a cancelled run rejects with. Not a parse problem. */
export const CANCELLED_CODE = "import_cancelled";

/** Progress is posted at most this often. Never per row, never per chunk. */
export const PROGRESS_INTERVAL_MS = 100;

function failurePayload(jobId, error) {
  return {
    type: IMPORT_MESSAGES.failure,
    jobId,
    code: typeof error?.code === "string" ? error.code : "import_failed",
    message: String(error?.message ?? "The file could not be read."),
    // The located problems travel as data. The surface renders coordinates, not
    // an exception, and nothing read out of a cell is ever on this wire.
    problems: Array.isArray(error?.problems) ? error.problems.map((problem) => ({ ...problem })) : [],
  };
}

/**
 * One import session.
 *
 * @param {(message: object) => void} post how a message reaches the main thread.
 * @param {{now?: () => number}} [hooks] injectable clock, for tests.
 */
export function createImportWorkerSession(post, { now = () => Date.now() } = {}) {
  let job = null;

  const emitProgress = (phase, loaded, total, { force = false } = {}) => {
    if (!job) return;
    const stamp = now();
    // Always emit the first sample, a phase change, and the closing sample. In
    // between, the interval throttle holds. A 50,000-row file therefore costs a
    // handful of messages, not 50,000.
    if (!force && phase === job.lastPhase && stamp - job.lastPostedAt < PROGRESS_INTERVAL_MS) return;
    job.lastPhase = phase;
    job.lastPostedAt = stamp;
    post({
      type: IMPORT_MESSAGES.progress,
      jobId: job.jobId,
      phase,
      loaded,
      total,
      unit: "characters",
      byteSize: job.byteSize,
      ratio: total > 0 ? Math.min(1, loaded / total) : 0,
    });
  };

  const begin = (message) => {
    job = {
      jobId: message.jobId,
      fileName: message.fileName ?? "local.json",
      mediaType: message.mediaType ?? "",
      options: message.options ?? {},
      total: Number.isFinite(message.total) ? message.total : 0,
      byteSize: Number.isFinite(message.byteSize) ? message.byteSize : null,
      parts: [],
      received: 0,
      lastPhase: null,
      lastPostedAt: 0,
    };
    // Belt and braces: the client refuses an oversized file before it starts a
    // worker at all, and the reader inside the parse measures the text again.
    // This is the third check and the cheapest, and it costs one comparison.
    const oversize = checkFileSizeCeiling(job.byteSize, message.maxBytes ?? MAX_IMPORT_BYTES);
    if (oversize) {
      const failed = job.jobId;
      job = null;
      post(failurePayload(failed, {
        code: oversize.code, message: describeProblem(oversize), problems: [oversize],
      }));
      return;
    }
    emitProgress("read", 0, job.total, { force: true });
  };

  const chunk = (message) => {
    if (!job || message.jobId !== job.jobId) return;
    const part = String(message.text ?? "");
    job.parts.push(part);
    job.received += part.length;
    emitProgress("read", job.received, job.total);
  };

  const end = (message) => {
    if (!job || message.jobId !== job.jobId) return;
    const current = job;
    emitProgress("read", current.received, current.total, { force: true });
    // Concatenation, not re-decoding: the slices the client cut out of the text
    // reassemble into the identical string, so the parser sees byte-for-byte
    // what the synchronous path would have handed it.
    const text = current.parts.join("");
    current.parts.length = 0;
    emitProgress("parse", current.total, current.total, { force: true });
    let value;
    try {
      value = parseLocalImportFile(text, current.fileName, current.mediaType, current.options);
    } catch (error) {
      job = null;
      post(failurePayload(current.jobId, error));
      return;
    }
    job = null;
    post({ type: IMPORT_MESSAGES.result, jobId: current.jobId, value });
  };

  const cancel = (message) => {
    // Cancelling during the transfer drops the partial text here. Cancelling
    // during the parse cannot be observed by this thread — the parse is
    // synchronous — which is exactly why the client terminates the worker rather
    // than trusting a flag. Nothing is posted for a cancelled job either way.
    if (job && (message.jobId === undefined || message.jobId === job.jobId)) job = null;
  };

  return {
    handle(message) {
      switch (message?.type) {
        case IMPORT_MESSAGES.begin: return begin(message);
        case IMPORT_MESSAGES.chunk: return chunk(message);
        case IMPORT_MESSAGES.end: return end(message);
        case IMPORT_MESSAGES.cancel: return cancel(message);
        default: return undefined;
      }
    },
    /** Test/diagnostic view. Never used to make a decision. */
    get busy() { return job !== null; },
  };
}
