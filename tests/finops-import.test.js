// The offloaded import path: protocol, ceilings, cancel, and fallback parity.
//
// What is deliberately *not* tested here is parsing. `local-finops.js` is
// frozen and has its own suite; every assertion below is about where and how
// that parser runs, never about what it decides.
//
// The worker is stood up as a fake whose scope is wired by the shipped
// `attachImportWorker`, so both sides of the protocol are the real code. Only
// the transport is a stand-in — Node has no DOM Worker — and messages are
// delivered without a structured clone, which is why the payload-shape
// assertions below check the message object itself.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml } from "./support/browser.js";
import { hrisExport, jsonFile, providerExport } from "./support/finops-import-fixture.js";
import { applyImportProgress } from "../src/local-import-flow.js";
import { createImportRunner } from "../src/finops-import-runner.js";
import { attachImportWorker } from "../src/finops-import-worker.js";
import {
  cancelMessage, doneMessage, errorMessage, IMPORT_ERROR, IMPORT_LIMITS, importLimitCopy,
  isImportMessage, progressMessage, startMessage,
} from "../src/finops-import-protocol.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

function selection() {
  return [
    jsonFile(providerExport({ days: 4, units: 3 }), "provider.json"),
    jsonFile(hrisExport({ units: 3 }), "hris.json"),
  ];
}

/**
 * A Worker stand-in whose other side is the shipped worker shim.
 * `readsType` false models a browser that ignores `{type:"module"}`.
 */
function fakeWorkerClass({ readsType = true, constructThrows = false, seen = [] } = {}) {
  return class FakeWorker {
    constructor(url, options) {
      if (constructThrows) throw new Error("SecurityError");
      if (readsType) seen.push(options.type);
      this.terminated = false;
      this.listeners = {};
      const scope = {
        handler: null,
        addEventListener: (name, fn) => { if (name === "message") scope.handler = fn; },
        postMessage: (data) => {
          if (this.terminated) return;
          for (const fn of this.listeners.message ?? []) fn({ data });
        },
      };
      this.scope = scope;
      attachImportWorker(scope);
    }

    addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
    postMessage(data) { if (!this.terminated) this.scope.handler?.({ data }); }
    terminate() { this.terminated = true; }
  };
}

const runnerWith = (Worker, options = {}) => createImportRunner({
  scope: { Worker },
  workerUrl: "about:blank",
  throttleMs: 0,
  ...options,
});

/** Timestamps are the one field that legitimately differs between two runs. */
function scrubClock(value) {
  if (Array.isArray(value)) return value.map(scrubClock);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, key === "generatedAt" ? "<clock>" : scrubClock(item)]));
  }
  return value;
}

// --- protocol --------------------------------------------------------------

test("every message on the wire is one of the five declared shapes", () => {
  const files = selection();
  assert.equal(isImportMessage(startMessage(files, IMPORT_LIMITS)), true);
  assert.equal(isImportMessage(cancelMessage()), true);
  assert.equal(isImportMessage(progressMessage({ rowsProcessed: 3, bytesProcessed: 9, totalBytes: 90 })), true);
  assert.equal(isImportMessage(doneMessage(null, { status: "incomplete" })), true);
  assert.equal(isImportMessage(errorMessage(IMPORT_ERROR.CANCELLED, "stopped")), true);
  assert.equal(isImportMessage({ type: "resume" }), false);
  assert.equal(isImportMessage(null), false);

  // Progress coerces rather than forwarding undefined, so the bar can never be
  // handed NaN by a worker that posted a partial object.
  assert.deepEqual(progressMessage(), {
    type: "progress", rowsProcessed: 0, bytesProcessed: 0, totalBytes: 0,
  });
});

test("the declared ceilings are stated once and rendered into user copy", () => {
  assert.equal(IMPORT_LIMITS.maxTotalBytes, 64 * 1024 * 1024);
  assert.equal(IMPORT_LIMITS.maxRows, 200_000);
  const copy = importLimitCopy();
  assert.match(copy, /64 MB/);
  assert.match(copy, /200,000 records/);
  assert.match(copy, /Split a larger export by date range/);
});

test("the shipped import help states both ceilings", async () => {
  const doc = parseHtml(await readFile(PAGE, "utf8"));
  const help = doc.getElementById("local-file-help").textContent;
  assert.match(help, /64 MB/);
  assert.match(help, /200,000 records/);
});

// --- offloaded execution ---------------------------------------------------

test("the worker path parses off the main thread and reports incremental progress", async () => {
  const seen = [];
  const runner = runnerWith(fakeWorkerClass({ seen }));
  const progress = [];
  const outcome = await runner.run(selection(), { onProgress: (item) => progress.push(item) });

  assert.equal(runner.mode, "worker");
  assert.deepEqual(seen, ["module"]);
  assert.equal(outcome.path, "worker");
  assert.equal(outcome.status, "complete");
  assert.equal(outcome.rowsProcessed, 4 * 3 + 4);
  assert.ok(progress.length >= 1, "at least one progress message reached the page");
  for (const item of progress) {
    assert.equal(item.type, "progress");
    assert.ok(item.bytesProcessed > 0 && item.bytesProcessed <= item.totalBytes);
  }
});

test("progress is throttled so posting it is not the bottleneck", async () => {
  let clock = 0;
  const runner = runnerWith(fakeWorkerClass(), { throttleMs: 200, now: () => clock });
  const progress = [];
  // The clock never advances, so every message after the first is dropped by
  // the throttle rather than repainting the bar.
  await runner.run(selection(), { onProgress: (item) => progress.push(item) });
  assert.equal(progress.length, 1);

  clock = 0;
  const ticking = runnerWith(fakeWorkerClass(), { throttleMs: 0, now: () => (clock += 1000) });
  const all = [];
  await ticking.run(selection(), { onProgress: (item) => all.push(item) });
  assert.ok(all.length > progress.length);
});

test("the done payload carries aggregates, never the raw rows", async () => {
  const runner = runnerWith(fakeWorkerClass());
  const outcome = await runner.run([
    jsonFile(providerExport({ days: 20, units: 5 }), "provider.json"),
    jsonFile(hrisExport({ units: 5 }), "hris.json"),
  ]);
  assert.equal(outcome.rowsProcessed, 20 * 5 + 6);

  // 100 provider aggregates went in; five department rows and two totals came
  // back. `records` on a department is a count, not an array.
  assert.equal(outcome.result.rankedDepartments.length, 5);
  for (const department of outcome.result.rankedDepartments) {
    assert.equal(typeof department.records, "number");
  }
  const serialized = JSON.stringify(outcome.result);
  assert.equal(serialized.includes("aggregate_id"), false);
  assert.equal(serialized.includes("amount_minor"), false);
});

// --- ceilings --------------------------------------------------------------

test("a selection above the byte ceiling fails whole and names the limit", async () => {
  const runner = runnerWith(fakeWorkerClass(), { limits: { maxTotalBytes: 512, maxRows: 100_000 } });
  await assert.rejects(runner.run(selection()), (error) => {
    assert.equal(error.code, IMPORT_ERROR.FILE_TOO_LARGE);
    assert.match(error.message, /above the 512 bytes import limit/);
    assert.match(error.message, /nothing was analyzed/);
    assert.match(error.message, /Split the export by date range/);
    return true;
  });
});

test("a selection above the row ceiling fails whole rather than truncating", async () => {
  const runner = runnerWith(fakeWorkerClass(), {
    limits: { maxTotalBytes: IMPORT_LIMITS.maxTotalBytes, maxRows: 10 },
  });
  await assert.rejects(runner.run([
    jsonFile(providerExport({ days: 10, units: 6 }), "provider.json"),
    jsonFile(hrisExport({ units: 6 }), "hris.json"),
  ]), (error) => {
    assert.equal(error.code, IMPORT_ERROR.TOO_MANY_ROWS);
    assert.match(error.message, /60 records, above the 10 record import limit/);
    assert.match(error.message, /nothing was analyzed/);
    return true;
  });
});

// --- cancellation ----------------------------------------------------------

/** The part of the surface an import is allowed to touch, as plain values. */
function surfaceState(doc) {
  const bar = doc.getElementById("local-import-progress-bar");
  return {
    progressHidden: doc.getElementById("local-import-progress").hidden,
    progressText: doc.getElementById("local-import-progress-text").textContent,
    cancelHidden: doc.getElementById("cancel-local-import").hidden,
    bar: bar.value,
    errorHidden: doc.getElementById("local-file-error").hidden,
  };
}

test("cancel terminates the worker, restores the pre-import state, and a re-import succeeds", async () => {
  const doc = parseHtml(await readFile(PAGE, "utf8"));
  applyImportProgress(doc, null);
  const before = surfaceState(doc);

  const workers = [];
  const Worker = fakeWorkerClass();
  const runner = runnerWith(class extends Worker {
    constructor(...args) { super(...args); workers.push(this); }
  });

  const pending = runner.run(selection(), {
    onProgress: (item) => applyImportProgress(doc, item),
  });
  runner.cancel();
  await assert.rejects(pending, (error) => error.code === IMPORT_ERROR.CANCELLED);

  // No leaked worker, and no half-drawn surface.
  assert.equal(workers.length, 1);
  assert.equal(workers[0].terminated, true);
  applyImportProgress(doc, null);
  assert.deepEqual(surfaceState(doc), before);

  // The runner is immediately reusable: the same instance runs a fresh import.
  const outcome = await runner.run(selection());
  assert.equal(outcome.status, "complete");
  assert.equal(workers.length, 2);
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[1].terminated, true, "the completed run releases its worker too");
});

// --- fallback --------------------------------------------------------------

test("a browser without module workers falls back to the synchronous path", async () => {
  const noWorkerAtAll = createImportRunner({ scope: {}, workerUrl: "about:blank", throttleMs: 0 });
  assert.equal((await noWorkerAtAll.run(selection())).path, "inline");
  assert.equal(noWorkerAtAll.mode, "inline");

  const classicOnly = runnerWith(fakeWorkerClass({ readsType: false }));
  assert.equal((await classicOnly.run(selection())).path, "inline");

  const throwsOnConstruct = runnerWith(fakeWorkerClass({ constructThrows: true }));
  assert.equal((await throwsOnConstruct.run(selection())).path, "inline");
});

test("both paths produce byte-identical normalized output for the same input", async () => {
  const files = selection();
  const worker = await runnerWith(fakeWorkerClass()).run(files);
  const inline = await createImportRunner({
    scope: {}, workerUrl: "about:blank", throttleMs: 0,
  }).run(files);

  assert.equal(worker.path, "worker");
  assert.equal(inline.path, "inline");
  assert.equal(worker.rowsProcessed, inline.rowsProcessed);
  assert.equal(
    JSON.stringify(scrubClock(worker.result)),
    JSON.stringify(scrubClock(inline.result)),
  );
});

test("an incomplete selection reports counts only, so no document reaches the page", async () => {
  const runner = runnerWith(fakeWorkerClass());
  const outcome = await runner.run([jsonFile(providerExport({ days: 2, units: 2 }), "provider.json")]);
  assert.equal(outcome.status, "incomplete");
  assert.equal(outcome.result, null);
  assert.equal(outcome.providers, 1);
  assert.equal(outcome.hris, false);
});

test("a parser rejection crosses the boundary with its code and file position", async () => {
  const runner = runnerWith(fakeWorkerClass());
  await assert.rejects(runner.run([
    jsonFile(hrisExport({ units: 2 }), "hris.json"),
    new File(["{"], "broken.json", { type: "application/json" }),
  ]), (error) => {
    assert.equal(error.code, "invalid_json");
    assert.equal(error.ordinal, 2);
    assert.equal(error.total, 2);
    return true;
  });
});
