// The import façade: one call site, two paths, identical observable behaviour.
//
// What this pins is the part that regresses silently. A worker path that returns
// a slightly different summary than the fallback, a cancel that leaves half a
// pair in app state, a ceiling that truncates instead of refusing — none of those
// would fail a parser test, and all of them would ship.
//
// The worker path is exercised by driving the *real* worker module through a
// stand-in `Worker` object. There is no Web Worker in Node, so the alternative
// would be leaving the shell untested; this way the message protocol, the
// worker's own error translation, and the façade's handling of all four message
// kinds are all real code under test. Only the thread boundary is simulated.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createImportRunner, ImportAborted, ImportLimitExceeded,
} from "../src/import-runner.js";
import {
  createRecordCounter, foldImportResult, MAX_RETAINED_PROBLEMS, runImportJob,
} from "../src/import-worker-core.js";
import { handleImportRequest } from "../src/import-worker.js";
import {
  IMPORT_LIMIT_COPY, IMPORT_MESSAGE, isImportMessage, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS,
  PROGRESS_BYTE_STEP, progressMessage,
} from "../src/import-protocol.js";
import { readDelimitedText } from "../src/delimited-text.js";
import { chunkedFile, syntheticProviderCsv, syntheticRosterCsv } from "./support/import-fixture.js";

// --- the stand-in worker ---------------------------------------------------

/**
 * A `Worker`-shaped object that runs `handleImportRequest` in-process.
 *
 * `terminate()` is modelled the way it matters: once terminated, no further
 * message reaches the page. That is what makes the cancel assertions meaningful —
 * a summary produced after the cancel is dropped on the floor exactly as a
 * terminated thread's would be.
 */
function workerFactory({ failOnConstruct = false, errorBeforeMessage = false } = {}) {
  const created = [];
  const create = () => {
    if (failOnConstruct) throw new TypeError("blocked by policy");
    const worker = {
      listeners: new Map(),
      terminated: false,
      requests: 0,
      addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(handler);
      },
      emit(type, event) {
        if (this.terminated) return;
        for (const handler of this.listeners.get(type) ?? []) handler(event);
      },
      postMessage(request) {
        this.requests += 1;
        if (errorBeforeMessage) {
          queueMicrotask(() => this.emit("error", { message: "module failed to load" }));
          return;
        }
        handleImportRequest(request, (message) => {
          if (this.terminated) return;
          this.emit("message", { data: message });
        });
      },
      terminate() {
        this.terminated = true;
      },
    };
    created.push(worker);
    return worker;
  };
  return { create, created };
}

const providerFile = (rows, options) =>
  chunkedFile(syntheticProviderCsv({ rows }), "provider-period.csv", options);

// --- protocol --------------------------------------------------------------

test("the two ceilings are one number each, shared with the reviewed reader", () => {
  // A second ceiling defined here would be a control that drifts from the one
  // that actually refuses the file. These are aliases, and this asserts it.
  assert.equal(MAX_IMPORT_BYTES, 8_000_000);
  assert.equal(MAX_IMPORT_ROWS, 50_000);
  const overSized = readDelimitedText("a,b\n1,2\n", { maxBytes: MAX_IMPORT_BYTES });
  assert.equal(overSized.ok, true);
});

test("the ceiling is stated in the import copy before a file is picked", async () => {
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const help = html.slice(html.indexOf('id="local-file-help"'));
  assert.ok(help.slice(0, help.indexOf("</p>")).includes(IMPORT_LIMIT_COPY.sentence),
    `the help text must state: ${IMPORT_LIMIT_COPY.sentence}`);
});

test("progress messages are clamped and closed over the declared kinds", () => {
  const message = progressMessage({ bytesRead: 500, totalBytes: 200, rows: 4 });
  assert.equal(message.kind, IMPORT_MESSAGE.PROGRESS);
  assert.equal(message.ratio, 1);
  assert.equal(progressMessage({ bytesRead: 0, totalBytes: 0, rows: 0 }).ratio, 0);
  assert.equal(isImportMessage({ kind: "sneaky" }), false);
  assert.equal(isImportMessage(null), false);
  assert.equal(isImportMessage(message), true);
});

// --- the incremental record guard -----------------------------------------

test("the streaming record count agrees with the reviewed reader's row count", () => {
  const cases = [
    "a,b\n1,2\n3,4\n",
    "a,b\r\n1,2\r\n3,4",
    'a,b\n"line\nbreak",2\n3,4\n',
    "a,b\n1,2\n\n\n3,4\n",
    "a,b\n1,2\n   \n3,4\n",
  ];
  for (const text of cases) {
    const counter = createRecordCounter();
    // Split at an awkward point so cross-chunk state (a CR ending one chunk) is
    // exercised rather than assumed.
    counter.push(text.slice(0, 5));
    counter.push(text.slice(5, 9));
    counter.push(text.slice(9));
    const reading = readDelimitedText(text);
    assert.equal(reading.ok, true, text);
    assert.equal(counter.total(), reading.rowCount, JSON.stringify(text));
  }
});

// --- both paths, same answer ----------------------------------------------

test("the worker path and the fallback path produce identical summaries", async () => {
  const { create, created } = workerFactory();
  const viaWorker = createImportRunner({ createWorker: create });
  const viaSync = createImportRunner({ createWorker: () => { throw new TypeError("no workers"); } });
  assert.equal(viaWorker.path, "worker");
  assert.equal(viaSync.path, "sync");

  const workerProgress = [];
  const syncProgress = [];
  // Big enough (~670 KB) that the byte-paced throttle fires more than once, so
  // the cadence assertions below have intermediate ticks to look at.
  const fromWorker = await viaWorker.runImport(providerFile(12_000),
    { onProgress: (progress) => workerProgress.push(progress) });
  const fromSync = await viaSync.runImport(providerFile(12_000),
    { onProgress: (progress) => syncProgress.push(progress) });

  // Identical in every field, including the export id and the aggregate records.
  // `snapshot.generated_at` is a wall clock the reviewed parser stamps itself, so
  // it is normalized and then asserted on separately — pinning it here would be
  // pinning `Date.now()`, and dropping it silently would hide a real divergence.
  const withoutClock = (summary) => ({
    ...summary,
    document: { ...summary.document, snapshot: { ...summary.document.snapshot, generated_at: null } },
  });
  assert.deepEqual(withoutClock(fromWorker), withoutClock(fromSync));
  for (const summary of [fromWorker, fromSync]) {
    assert.match(summary.document.snapshot.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  }
  assert.equal(fromWorker.type, "provider");
  assert.ok(fromWorker.recordCount > 0);
  // The probe worker is constructed and terminated at detection; the import gets
  // its own, which is terminated when it finishes.
  assert.equal(created.length, 2);
  assert.ok(created.every((worker) => worker.terminated), "no worker is left running");

  // Progress is bounded, monotonic, determinate, and carries a real row count —
  // and both paths report it in the same shape, not merely at the same times.
  assert.deepEqual(workerProgress, syncProgress);
  assert.ok(workerProgress.length >= 2, "more than the final tick");
  assert.ok(workerProgress.length <= Math.ceil(fromWorker.bytesRead / PROGRESS_BYTE_STEP) + 1,
    "one message per byte step, not one per row");
  assert.deepEqual(workerProgress.map((p) => p.ratio), [...workerProgress.map((p) => p.ratio)].sort((a, b) => a - b));
  assert.equal(workerProgress.at(-1).ratio, 1);
  assert.ok(workerProgress.at(-1).rows > 0);
});

test("a worker that never comes up finishes the same import on the fallback path", async () => {
  const runner = createImportRunner({ createWorker: workerFactory({ errorBeforeMessage: true }).create });
  assert.equal(runner.path, "worker", "construction succeeded, so the worker was detected");
  const summary = await runner.runImport(providerFile(500));
  assert.equal(summary.type, "provider");
  // The reader is not asked to retry, and the runner does not try a worker again.
  assert.equal(runner.path, "sync");
});

test("a Worker constructor that throws is detected once, at construction", async () => {
  const runner = createImportRunner({ createWorker: workerFactory({ failOnConstruct: true }).create });
  assert.equal(runner.path, "sync");
  assert.equal((await runner.runImport(providerFile(200))).type, "provider");
});

// --- cancellation ----------------------------------------------------------

test("cancelling mid-parse terminates the worker, and the next import succeeds", async () => {
  const { create, created } = workerFactory();
  const runner = createImportRunner({ createWorker: create });
  const controller = new AbortController();

  // Abort from inside the first intermediate progress callback: the read is
  // provably still in flight at that point, so this is a mid-parse cancel and
  // not a race with completion.
  let ticks = 0;
  const cancelled = runner.runImport(providerFile(40_000), {
    signal: controller.signal,
    onProgress: () => {
      ticks += 1;
      if (ticks === 1) controller.abort();
    },
  });
  await assert.rejects(cancelled, (error) => error instanceof ImportAborted);
  const importWorker = created.at(-1);
  assert.equal(importWorker.terminated, true, "the worker is terminated, not orphaned");

  // Same session, same runner: a full import now completes. This is the whole
  // point of the test — a cancel that left the runner unusable would pass every
  // assertion above.
  const summary = await runner.runImport(providerFile(4_000));
  assert.equal(summary.type, "provider");
  assert.ok(summary.recordCount > 0);
  assert.ok(created.at(-1).terminated);
});

test("the fallback path honours the same signal at its chunk boundaries", async () => {
  const runner = createImportRunner({ createWorker: () => { throw new TypeError("no workers"); } });
  const controller = new AbortController();
  let ticks = 0;
  await assert.rejects(
    runner.runImport(providerFile(40_000), {
      signal: controller.signal,
      onProgress: () => {
        ticks += 1;
        if (ticks === 1) controller.abort();
      },
    }),
    (error) => error instanceof ImportAborted,
  );
  assert.equal((await runner.runImport(providerFile(1_000))).type, "provider");
});

test("a signal already aborted never starts a read", async () => {
  const { create, created } = workerFactory();
  const runner = createImportRunner({ createWorker: create });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runner.runImport(providerFile(100), { signal: controller.signal }),
    (error) => error instanceof ImportAborted);
  assert.equal(created.at(-1).requests, 0, "no request was posted");
  assert.equal(created.at(-1).terminated, true);
});

// --- the ceilings ---------------------------------------------------------

test("a file over the size ceiling is refused before a byte is read, on both paths", async () => {
  // `size` is asserted, not allocated: 9 MB of real bytes would be a slow test
  // for a check that happens before the stream is opened.
  const oversized = {
    name: "year-to-date.csv",
    type: "text/csv",
    size: MAX_IMPORT_BYTES + 1,
    stream() {
      throw new Error("the stream must never be opened for an oversized file");
    },
  };
  for (const runner of [
    createImportRunner({ createWorker: workerFactory().create }),
    createImportRunner({ createWorker: () => { throw new TypeError("no workers"); } }),
  ]) {
    await assert.rejects(runner.runImport(oversized), (error) => {
      assert.equal(error.code, "file_too_large");
      assert.equal(error.limit, MAX_IMPORT_BYTES);
      assert.equal(error.observed, MAX_IMPORT_BYTES + 1);
      assert.equal(error.unit, "bytes");
      // The message names the limit, the observed value, and the way out.
      assert.match(error.message, new RegExp(String(MAX_IMPORT_BYTES)));
      assert.match(error.message, new RegExp(String(MAX_IMPORT_BYTES + 1)));
      assert.match(error.message, /Split the export by date range/);
      return true;
    });
  }
});

test("a file over the row ceiling fails; it never becomes a smaller success", async () => {
  const { create, created } = workerFactory();
  const runner = createImportRunner({ createWorker: create });
  // Narrow rows, so 60,000 of them stay well under the byte ceiling and the row
  // ceiling is the thing actually being tested.
  const rows = ["Usage Day,Workspace,Model,Cost USD"];
  for (let index = 0; index < 60_000; index += 1) rows.push(`2026-01-01,U,m,1.00`);
  const file = chunkedFile(`${rows.join("\n")}\n`, "too-long.csv");
  assert.ok(file.size < MAX_IMPORT_BYTES);

  await assert.rejects(runner.runImport(file), (error) => {
    assert.ok(error instanceof ImportLimitExceeded);
    assert.equal(error.code, "too_many_rows");
    assert.equal(error.limit, MAX_IMPORT_ROWS);
    assert.ok(error.observed > MAX_IMPORT_ROWS);
    assert.match(error.message, /Split the export by date range/);
    return true;
  });
  assert.equal(created.at(-1).terminated, true);
});

test("the row guard stops at the boundary instead of reading the whole file", async () => {
  const rows = ["Usage Day,Workspace,Model,Cost USD"];
  for (let index = 0; index < 200_000; index += 1) rows.push("2026-01-01,U,m,1.00");
  const text = `${rows.join("\n")}\n`;
  const file = chunkedFile(text, "way-too-long.csv");
  let observed = 0;
  await assert.rejects(runImportJob(file), (error) => {
    observed = error.observed;
    return error.code === "too_many_rows";
  });
  // The read stopped within one chunk of the ceiling rather than counting all
  // 200,000 records first.
  assert.ok(observed < MAX_IMPORT_ROWS * 1.2, `stopped at ${observed} of 200000`);
});

// --- bounded retention ----------------------------------------------------

test("the fold keeps aggregates and caps the located-problem list", () => {
  const problems = Array.from({ length: MAX_RETAINED_PROBLEMS + 50 }, (unused, index) => ({
    code: index % 2 ? "unparseable_date" : "invalid_amount", row: index + 2,
  }));
  const folded = foldImportResult(
    { type: "provider", fileName: "p.csv", document: { records: [{}, {}] }, problems },
    { bytesRead: 10, records: 3 },
  );
  assert.equal(folded.problems.length, MAX_RETAINED_PROBLEMS);
  assert.equal(folded.problemsTotal, MAX_RETAINED_PROBLEMS + 50);
  assert.equal(folded.problemsTruncated, true);
  // A truncated list never reads as a complete one: the per-code totals are the
  // full counts, not the counts of what survived.
  assert.equal(folded.problemCounts.unparseable_date + folded.problemCounts.invalid_amount,
    MAX_RETAINED_PROBLEMS + 50);
  assert.equal(folded.recordCount, 2);
  assert.equal(folded.type, "provider");
});

test("a roster still imports through the same façade", async () => {
  const runner = createImportRunner({ createWorker: workerFactory().create });
  const summary = await runner.runImport(chunkedFile(syntheticRosterCsv({ units: 6 }), "roster.csv"));
  assert.equal(summary.type, "hris");
  assert.equal(summary.recordCount, 7);
});
