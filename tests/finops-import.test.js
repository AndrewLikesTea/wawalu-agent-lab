// The import execution paths: worker, main-thread fallback, and the ceilings.
//
// What these pin is not "the parser works" — `local-finops.test.js` owns that,
// unmodified — but that moving the parse off the main thread changed nothing
// about what a file means, and that every way an import can end leaves the
// panel able to start another one.

import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBytes, groupDigits, importLimitsSentence, IMPORT_LIMITS,
  MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS, reviveVerdict, runImport, serializeVerdict,
} from "../src/finops-import-core.js";
import { startFinopsImport } from "../src/finops-import-runner.js";
import { normalizeLocalFinopsHistory, parseLocalFinopsFile } from "../src/local-finops.js";
import { trustVerdict } from "../src/finops-trust-verdict.js";
import {
  fakeWorkerFactory, jsonFile, syntheticHris, syntheticProvider, validHris, validProvider,
} from "./support/finops-import-fixtures.js";

async function pair() {
  const provider = await validProvider();
  const hris = await validHris();
  return [jsonFile(provider, "provider.json"), jsonFile(hris, "roster.json")];
}

// --- semantics -------------------------------------------------------------

test("the worker path produces exactly what the reviewed parser and reconciler produce", async () => {
  const provider = await validProvider();
  const hris = await validHris();
  const outcome = await runImport([jsonFile(provider, "provider.json"), jsonFile(hris, "roster.json")]);
  assert.equal(outcome.status, "ok");

  // The same two calls the page used to make inline, made here directly.
  const parsedProvider = parseLocalFinopsFile(JSON.stringify(provider), "provider.json", "application/json");
  const parsedHris = parseLocalFinopsFile(JSON.stringify(hris), "roster.json", "application/json");
  const expected = normalizeLocalFinopsHistory({ providers: [parsedProvider], hris: parsedHris });
  assert.deepEqual(outcome.analysis, expected);

  const expectedVerdict = serializeVerdict(trustVerdict({
    providers: [parsedProvider],
    hris: parsedHris,
    quarantinedExportIds: expected.validation.quarantinedExportIds,
  }));
  assert.deepEqual(outcome.verdict, expectedVerdict);
});

test("a parser refusal crosses the boundary as the parser's own code and message", async () => {
  const outcome = await runImport([new File(["a,b"], "billing.csv", { type: "text/csv" })]);
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.error.code, "unsupported_format");
  assert.match(outcome.error.message, /Choose a \.json file/);
  assert.equal(outcome.error.ordinal, 1);
  assert.equal(outcome.error.total, 1);
  assert.equal(outcome.analysis, undefined);
});

test("the second file's failure is reported by its position, not its name", async () => {
  const provider = await validProvider();
  const outcome = await runImport([
    jsonFile(provider, "provider.json"),
    new File(["{"], "roster.json", { type: "application/json" }),
  ]);
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.error.code, "invalid_json");
  assert.equal(outcome.error.ordinal, 2);
  assert.equal(outcome.error.total, 2);
});

test("a provider without a roster is incomplete, not a number", async () => {
  const outcome = await runImport([jsonFile(await validProvider(), "provider.json")]);
  assert.equal(outcome.status, "incomplete");
  assert.equal(outcome.providers, 1);
  assert.equal(outcome.hris, false);
  assert.equal(outcome.analysis, undefined);
  assert.equal(outcome.headers.length, 1);
});

// --- the boundary ----------------------------------------------------------

test("only headers and aggregates cross the boundary", async () => {
  const outcome = await runImport(await pair());
  assert.equal(outcome.status, "ok");

  // Structured-cloneable, or a real Worker could not have posted it.
  assert.doesNotThrow(() => structuredClone(outcome));

  for (const header of outcome.headers) {
    assert.deepEqual(Object.keys(header).sort(), [
      "bytes", "completeness", "exportId", "ordinal", "periodEnd", "periodStart",
      "recordCount", "schemaVersion", "sourceInstanceId", "type",
    ]);
    // The header states how many records there were; it never carries them, and
    // the opaque ids on it are the six-character tails the page already shows.
    assert.equal(typeof header.recordCount, "number");
    assert.match(header.exportId, /^…/);
  }

  // No record array, under any name, anywhere in the payload.
  const walk = (value, path) => {
    if (Array.isArray(value)) return value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      // `records` appears in the envelope as a *count* of joined aggregates.
      // What must never appear is an array of them.
      if (key === "records") {
        assert.equal(Array.isArray(entry), false, `a raw record array reached the boundary at ${path}`);
      }
      assert.equal(entry?.aggregate_id, undefined, `a raw provider row reached the boundary at ${path}.${key}`);
      assert.equal(entry?.org_unit_id, undefined, `a raw provider row reached the boundary at ${path}.${key}`);
      walk(entry, `${path}.${key}`);
    }
  };
  walk(outcome, "outcome");
});

test("the verdict's lazy detail survives the round trip as a thunk", async () => {
  const outcome = await runImport(await pair());
  const revived = reviveVerdict(outcome.verdict);
  for (const finding of revived.findings) {
    assert.equal(typeof finding.detail, "function");
    assert.ok(Array.isArray(finding.detail()));
  }
});

// --- ceilings --------------------------------------------------------------

test("the ceilings are named once and stated in words from the same constants", () => {
  assert.equal(IMPORT_LIMITS.maxFileBytes, MAX_IMPORT_FILE_BYTES);
  assert.equal(IMPORT_LIMITS.maxRows, MAX_IMPORT_ROWS);
  const sentence = importLimitsSentence();
  assert.ok(sentence.includes(formatBytes(MAX_IMPORT_FILE_BYTES)));
  assert.ok(sentence.includes(groupDigits(MAX_IMPORT_ROWS)));
  assert.equal(groupDigits(400000), "400,000");
  assert.equal(formatBytes(64 * 1024 * 1024), "64.0 MB");
});

test("an oversized file is refused by its declared size, before a byte is read", async () => {
  const file = jsonFile(await validProvider(), "provider.json");
  let read = false;
  const guarded = {
    name: file.name, type: file.type, size: 90 * 1024 * 1024,
    stream: () => { read = true; return file.stream(); },
    text: () => { read = true; return file.text(); },
  };
  const outcome = await runImport([guarded]);
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.error.code, "file_too_large");
  // The observed value and the limit are both named, so the message says what
  // to do about it rather than only that something was too big.
  assert.match(outcome.error.message, /90\.0 MB/);
  assert.match(outcome.error.message, /64\.0 MB/);
  assert.equal(read, false, "an oversized file must not be decoded at all");
  assert.equal(outcome.analysis, undefined);
});

test("a file that outgrows the ceiling mid-stream is aborted mid-stream", async () => {
  const file = jsonFile(await validProvider(), "provider.json");
  // A stream whose `size` under-reports: the only guard left is the running
  // byte count, which must fire without waiting for the end of the file.
  const lying = { name: "provider.json", type: "application/json", size: 10, stream: () => file.stream() };
  const outcome = await runImport([lying], { limits: { maxFileBytes: 64, maxRows: MAX_IMPORT_ROWS } });
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.error.code, "file_too_large");
  assert.match(outcome.error.message, /while reading/);
});

test("passing the row ceiling refuses the import instead of reporting a partial total", async () => {
  const base = await validProvider();
  const files = [
    jsonFile(syntheticProvider(base, { rows: 40 }), "provider.json"),
    jsonFile(syntheticHris(await validHris()), "roster.json"),
  ];
  const outcome = await runImport(files, { limits: { maxFileBytes: MAX_IMPORT_FILE_BYTES, maxRows: 25 } });
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.error.code, "too_many_rows");
  assert.match(outcome.error.message, /40 records/);
  assert.match(outcome.error.message, /25/);
  assert.equal(outcome.analysis, undefined, "a truncated import must never produce a number");
});

// --- progress and cancellation ---------------------------------------------

test("progress reports bytes read and rows parsed, in order, and never exceeds the total", async () => {
  const base = await validProvider();
  const files = [
    jsonFile(syntheticProvider(base, { rows: 5000 }), "provider.json"),
    jsonFile(syntheticHris(await validHris()), "roster.json"),
  ];
  const events = [];
  const outcome = await runImport(files, { onProgress: (event) => events.push(event) });
  assert.equal(outcome.status, "ok");
  assert.ok(events.length >= 2, "an import must report progress before it finishes");
  let previous = -1;
  for (const event of events) {
    assert.ok(event.bytesRead >= previous, "bytes read must not go backwards");
    assert.ok(event.bytesRead <= event.totalBytes);
    assert.ok(event.rowsProcessed >= 0);
    previous = event.bytesRead;
  }
  assert.equal(events.at(-1).rowsProcessed, outcome.rowsProcessed);
  assert.equal(outcome.rowsProcessed, 5000 + 24);
});

test("cancelling between files resolves to a cancelled state with no number", async () => {
  const files = await pair();
  let cancelled = false;
  const outcome = await runImport(files, {
    isCancelled: () => cancelled,
    onProgress: ({ phase }) => { if (phase === "parsed") cancelled = true; },
  });
  assert.equal(outcome.status, "cancelled");
  assert.equal(outcome.analysis, undefined);
  assert.ok(outcome.rowsProcessed >= 0);
});

// --- the wrapper -----------------------------------------------------------

test("the worker path and the main-thread fallback return the same outcome", async () => {
  const viaWorker = await startFinopsImport(await pair(), {
    createWorker: await fakeWorkerFactory(),
  }).settled;
  const viaMain = await startFinopsImport(await pair(), { createWorker: () => null }).settled;

  assert.equal(viaWorker.via, "worker");
  assert.equal(viaMain.via, "main");
  assert.equal(viaWorker.status, "ok");
  assert.equal(viaMain.status, "ok");
  assert.deepEqual(viaWorker.analysis, viaMain.analysis);
  assert.deepEqual(
    viaWorker.verdict.findings.map((finding) => finding.detail()),
    viaMain.verdict.findings.map((finding) => finding.detail()),
  );
  assert.deepEqual(viaWorker.headers, viaMain.headers);
  // The caller is handed a thunk on both paths; nothing downstream can tell
  // which host ran without reading `via`.
  for (const outcome of [viaWorker, viaMain])
    for (const finding of outcome.verdict.findings) assert.equal(typeof finding.detail, "function");
});

test("a worker that dies before speaking falls back to the main thread", async () => {
  const outcome = await startFinopsImport(await pair(), {
    createWorker: await fakeWorkerFactory({ failBeforeSpeaking: true }),
  }).settled;
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.via, "main");
});

test("a worker that dies mid-import is reported, not silently re-run", async () => {
  const outcome = await startFinopsImport(await pair(), {
    createWorker: await fakeWorkerFactory({ dieAfterFirstMessage: true }),
  }).settled;
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.error.code, "worker_failed");
});

test("cancel terminates the worker and settles cancelled", async () => {
  let terminated = false;
  const factory = await fakeWorkerFactory();
  const run = startFinopsImport(await pair(), {
    createWorker: () => {
      const worker = factory();
      const terminate = worker.terminate;
      worker.terminate = () => { terminated = true; terminate.call(worker); };
      return worker;
    },
  });
  run.cancel();
  const outcome = await run.settled;
  assert.equal(outcome.status, "cancelled");
  assert.equal(terminated, true, "cancel must terminate the worker, not merely ask it to stop");
});

test("cancel on the fallback path settles cancelled too", async () => {
  const base = await validProvider();
  const files = [
    jsonFile(syntheticProvider(base, { rows: 4000 }), "provider.json"),
    jsonFile(syntheticHris(await validHris()), "roster.json"),
  ];
  const run = startFinopsImport(files, {
    createWorker: () => null,
    onProgress: () => run.cancel(),
  });
  const outcome = await run.settled;
  assert.equal(outcome.status, "cancelled");
  assert.equal(outcome.via, "main");
  assert.equal(outcome.analysis, undefined);
});
