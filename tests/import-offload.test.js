// The offload seam: same parser, different thread.
//
// Every test here drives the real message protocol. The fake worker below is a
// transport, not a stand-in for the parser: it hands each message to the shipped
// `createImportWorkerSession`, which calls the shipped `parseLocalImportFile`.
// Messages are `structuredClone`d in both directions, so anything that would not
// survive a real `postMessage` fails here too.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CANCELLED_CODE, checkImportCeiling, createImportOffloader, DEFAULT_CHUNK_CHARS,
} from "../src/import-offload.js";
import { createImportWorkerSession, IMPORT_MESSAGES } from "../src/import-worker-core.js";
import {
  checkFileSelectionCeiling, IMPORT_LIMITS, MAX_IMPORT_BYTES, MAX_IMPORT_FILES,
  MAX_IMPORT_ROWS, MAX_IMPORT_SELECTION_BYTES, importLimitsSentence, safeDisplayFileName,
} from "../src/import-limits.js";
import { parseLocalImportFile } from "../src/finops-tabular-import.js";
import { MAX_DELIMITED_BYTES, MAX_DELIMITED_ROWS } from "../src/delimited-text.js";
import { applyImportProgress, importProgressText } from "../src/local-import-flow.js";

const FIXTURES = new URL("./fixtures/delimited/", import.meta.url);
const GENERATED_AT = "2026-07-26T09:00:00.000Z";

function fixture(name) {
  return readFile(new URL(name, FIXTURES), "utf8");
}

/**
 * A worker that is a thread boundary and nothing else.
 *
 * `ignoreOptions` models an engine that predates module workers: it never reads
 * the `type` option, which is exactly how the client detects it.
 */
function fakeWorkers({ ignoreOptions = false, failToLoad = false } = {}) {
  const created = [];
  const factory = (url, options) => {
    if (!ignoreOptions) void options.type;
    const worker = {
      url,
      terminated: false,
      onmessage: null,
      onerror: null,
      received: [],
      postMessage(message) {
        if (worker.terminated) return;
        worker.received.push(message.type);
        const copy = structuredClone(message);
        queueMicrotask(() => { if (!worker.terminated) session.handle(copy); });
      },
      terminate() { worker.terminated = true; },
    };
    const session = createImportWorkerSession((message) => {
      if (worker.terminated) return;
      const copy = structuredClone(message);
      queueMicrotask(() => { if (!worker.terminated) worker.onmessage?.({ data: copy }); });
    });
    created.push(worker);
    if (failToLoad) queueMicrotask(() => worker.onerror?.({ message: "worker failed to load" }));
    return worker;
  };
  factory.created = created;
  return factory;
}

function offloaderWith(factory, overrides = {}) {
  return createImportOffloader({
    scope: {},
    createWorker: factory,
    // Microtask yields keep the tests fast; the production default is a task
    // boundary per chunk, which is what keeps the page interactive.
    yieldToTask: () => Promise.resolve(),
    ...overrides,
  });
}

function job(text, fileName, mediaType, options) {
  return {
    text,
    fileName,
    mediaType,
    options,
    sync: () => parseLocalImportFile(text, fileName, mediaType, options),
  };
}

// --- equivalence -----------------------------------------------------------

test("the worker path and the synchronous path return deeply equal results", async () => {
  const cases = [
    ["openai-usage.csv", "text/csv"],
    ["bedrock-usage.tsv", "text/tab-separated-values"],
    ["org-roster.csv", "text/csv"],
    // A blocking failure has to agree too: same code, same message, same
    // located problems, or the surface would say two different things.
    ["anthropic-usage-missing-cost.csv", "text/csv"],
  ];
  for (const [name, mediaType] of cases) {
    const text = await fixture(name);
    const options = { generatedAt: GENERATED_AT };
    const offloader = offloaderWith(fakeWorkers());
    let expected;
    let expectedError = null;
    try {
      expected = parseLocalImportFile(text, name, mediaType, options);
    } catch (error) {
      expectedError = error;
    }
    if (expectedError) {
      await assert.rejects(
        () => offloader.run(job(text, name, mediaType, options)),
        (error) => {
          assert.equal(error.code, expectedError.code, name);
          assert.equal(error.message, expectedError.message, name);
          assert.deepStrictEqual(
            error.problems.map((problem) => ({ ...problem })),
            expectedError.problems.map((problem) => ({ ...problem })), name);
          return true;
        },
      );
      continue;
    }
    const offloaded = await offloader.run(job(text, name, mediaType, options));
    assert.deepStrictEqual(offloaded, expected, `${name} disagreed across the seam`);
  }
});

test("a UTF-8 BOM, CRLF endings, and quoted fields cross the seam unchanged", async () => {
  // Reassembled slices must be byte-identical, including a BOM the reader
  // reports on and a quoted field the slicing could otherwise have split.
  const text = "﻿date,project_name,model,amount,currency\r\n"
    + '2026-07-24,"Atlas, Platform",gpt-4o,10.00,USD\r\n'
    + '2026-07-25,"Atlas ""Core""",gpt-4o,12.50,USD\r\n';
  const options = { generatedAt: GENERATED_AT };
  const offloaded = await offloaderWith(fakeWorkers(), { chunkChars: 7 })
    .run(job(text, "bom.csv", "text/csv", options));
  assert.deepStrictEqual(offloaded, parseLocalImportFile(text, "bom.csv", "text/csv", options));
  assert.equal(offloaded.document.records.length, 2);
});

test("a v1 JSON envelope crosses the seam unchanged, and a rejected one carries its code", async () => {
  const envelope = (await fixture("openai-usage.csv"))
    && JSON.stringify(parseLocalImportFile(
      await fixture("openai-usage.csv"), "openai-usage.csv", "text/csv",
      { generatedAt: GENERATED_AT },
    ).document);
  const offloader = offloaderWith(fakeWorkers());
  const offloaded = await offloader.run(job(envelope, "billing.json", "application/json"));
  assert.deepStrictEqual(offloaded, parseLocalImportFile(envelope, "billing.json", "application/json"));

  // The failure path is data, not an exception: code, message, and problems all
  // survive, because `diagnosticFor` in the page reads exactly those.
  await assert.rejects(
    () => offloader.run(job("{not json", "billing.json", "application/json")),
    (error) => error.code === "invalid_json" && /valid JSON/.test(error.message),
  );
});

// --- progress --------------------------------------------------------------

test("progress is incremental, monotonic, throttled, and never per row", async () => {
  const rows = Array.from({ length: 4_000 },
    (_, index) => `2026-07-24,Atlas Platform,gpt-4o,${(index % 90) + 1}.00,USD`);
  const text = ["date,project_name,model,amount,currency", ...rows].join("\n");
  const samples = [];
  let yields = 0;
  const offloader = offloaderWith(fakeWorkers(), {
    chunkChars: 4_096,
    yieldToTask: () => { yields += 1; return Promise.resolve(); },
  });
  await offloader.run(job(text, "usage.csv", "text/csv", { generatedAt: GENERATED_AT }),
    { onProgress: (progress) => samples.push(progress) });

  assert.ok(samples.length >= 3, "progress reports more than a start and an end");
  // Far fewer messages than rows: the throttle plus the chunking is the point.
  assert.ok(samples.length < rows.length / 10, `${samples.length} messages for ${rows.length} rows`);
  const read = samples.filter((sample) => sample.phase === "read");
  assert.ok(read.length >= 2, "the read phase reports a fraction of a known total");
  for (const sample of read) {
    assert.equal(sample.total, text.length);
    assert.ok(sample.ratio >= 0 && sample.ratio <= 1);
  }
  const ratios = read.map((sample) => sample.ratio);
  assert.deepEqual(ratios, [...ratios].sort((left, right) => left - right), "progress never goes backwards");
  assert.equal(read.at(-1).ratio, 1);
  assert.equal(samples.at(-1).phase, "done");
  assert.ok(samples.every((sample) => sample.coarse === false));
  // One task boundary per chunk is what keeps the page painting during a big
  // import; the count is the structural proof that the loop actually yields.
  assert.ok(yields >= Math.ceil(text.length / 4_096) - 1);
});

test("progress copy states a fraction, or says plainly that it cannot", () => {
  assert.match(importProgressText({ phase: "read", ratio: 0.42 }), /Reading the file — 42% of the file\./);
  assert.match(importProgressText({ phase: "parse", ratio: 1 }), /Parsing and validating — 100%/);
  const coarse = importProgressText({ phase: "parse", ratio: null, coarse: true });
  assert.match(coarse, /on the page thread/);
  assert.match(coarse, /progress is coarse/);
  assert.doesNotMatch(coarse, /%/);
});

// --- cancellation ----------------------------------------------------------

test("cancel terminates the worker, and the same file imports again immediately", async () => {
  const factory = fakeWorkers();
  const offloader = offloaderWith(factory, { chunkChars: 64 });
  const text = await fixture("openai-usage.csv");
  const running = offloader.run(job(text, "openai-usage.csv", "text/csv", { generatedAt: GENERATED_AT }));
  const stopped = offloader.cancel();

  assert.equal(stopped, true);
  await assert.rejects(() => running, (error) => error.code === CANCELLED_CODE);
  assert.equal(factory.created.length, 1);
  assert.equal(factory.created[0].terminated, true, "the thread is ended, not asked to stop");
  assert.equal(offloader.busy, false);

  // Re-importability, asserted as an actual import rather than as a cleared
  // spinner: the same text, through a fresh worker, to the same result.
  const again = await offloader.run(
    job(text, "openai-usage.csv", "text/csv", { generatedAt: GENERATED_AT }));
  assert.equal(factory.created.length, 2, "a fresh worker is built for the next run");
  assert.deepStrictEqual(
    again, parseLocalImportFile(text, "openai-usage.csv", "text/csv", { generatedAt: GENERATED_AT }));

  // And a different file right after, so nothing from the cancelled run leaked
  // into the offloader's state.
  const roster = await fixture("org-roster.csv");
  const other = await offloader.run(job(roster, "org-roster.csv", "text/csv", { generatedAt: GENERATED_AT }));
  assert.equal(other.type, "hris");
});

test("cancelling with nothing running is a no-op, and starting a run supersedes the last", async () => {
  const factory = fakeWorkers();
  const offloader = offloaderWith(factory);
  assert.equal(offloader.cancel(), false);

  const text = await fixture("openai-usage.csv");
  const first = offloader.run(job(text, "a.csv", "text/csv", { generatedAt: GENERATED_AT }));
  const second = offloader.run(job(text, "b.csv", "text/csv", { generatedAt: GENERATED_AT }));
  await assert.rejects(() => first, (error) => error.code === CANCELLED_CODE);
  assert.equal((await second).fileName, "b.csv");
});

test("the progress region clears on cancel and never shows a made-up percentage", () => {
  const doc = fakeDocument();
  applyImportProgress(doc, { phase: "read", ratio: 0.5, coarse: false });
  assert.equal(doc.nodes["local-import-progress"].hidden, false);
  assert.equal(doc.nodes["local-import-progress-bar"].attributes.value, "50");

  applyImportProgress(doc, { phase: "parse", ratio: null, coarse: true });
  assert.equal(doc.nodes["local-import-progress"].dataset.coarse, "true");
  assert.equal(doc.nodes["local-import-progress-bar"].attributes.value, undefined,
    "an unmeasured phase is indeterminate, not a guess");

  applyImportProgress(doc, null);
  assert.equal(doc.nodes["local-import-progress"].hidden, true);
  assert.equal(doc.nodes["local-import-progress-text"].textContent, "");
});

// --- the ceilings ----------------------------------------------------------

test("the size ceiling is refused before any work starts, naming limit and observed", async () => {
  const factory = fakeWorkers();
  const offloader = offloaderWith(factory);
  const observed = MAX_IMPORT_BYTES + 1;
  await assert.rejects(
    () => offloader.run({ ...job("date,a\n1,2\n", "huge.csv", "text/csv"), byteSize: observed }),
    (error) => {
      assert.equal(error.code, "file_too_large");
      assert.equal(error.message, `The file is ${observed} bytes; the limit is ${MAX_IMPORT_BYTES} bytes.`);
      assert.equal(error.problems[0].limit, MAX_IMPORT_BYTES);
      assert.equal(error.problems[0].observed, observed);
      return true;
    },
  );
  assert.equal(factory.created.length, 0, "no worker is started for a file already over the ceiling");

  // The same check the page runs off `File.size`, before a byte is decoded.
  assert.equal(checkImportCeiling(MAX_IMPORT_BYTES), null);
  assert.equal(checkImportCeiling(MAX_IMPORT_BYTES + 1).code, "file_too_large");
  assert.equal(checkImportCeiling(Number.NaN), null);
});

test("one picker selection is bounded before its files are decoded", () => {
  const tooMany = Array.from({ length: MAX_IMPORT_FILES + 1 }, () => ({ size: 1 }));
  assert.equal(checkFileSelectionCeiling(tooMany).code, "too_many_files");

  const tooLarge = [
    { size: MAX_IMPORT_BYTES },
    { size: MAX_IMPORT_BYTES },
    { size: 1 },
  ];
  assert.equal(checkFileSelectionCeiling(tooLarge).code, "selection_too_large");
  assert.equal(checkFileSelectionCeiling([
    { size: MAX_IMPORT_BYTES },
    { size: MAX_IMPORT_SELECTION_BYTES - MAX_IMPORT_BYTES },
  ]), null, "the aggregate ceiling is inclusive");
});

test("displayed filenames cannot reorder or hide their extension", () => {
  const shown = safeDisplayFileName("quarterly\u202Efdp.csv\u0000");
  assert.equal(shown, "quarterly\uFFFDfdp.csv\uFFFD");
  assert.doesNotMatch(shown,
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
  assert.equal(safeDisplayFileName("\u202E"), "\uFFFD");
  assert.equal(safeDisplayFileName("usage.csv"), "usage.csv");
});

test("the row ceiling fails the import whole and surfaces no partial total", async () => {
  const header = "date,project_name,model,amount,currency";
  const rows = Array.from({ length: MAX_IMPORT_ROWS },
    (_, index) => `2026-07-24,Atlas Platform,gpt-4o,${(index % 90) + 1}.00,USD`);
  const text = [header, ...rows].join("\n");
  // header + MAX_IMPORT_ROWS data rows is one record over the ceiling.
  const offloader = offloaderWith(fakeWorkers());
  await assert.rejects(
    () => offloader.run(job(text, "big.csv", "text/csv", { generatedAt: GENERATED_AT })),
    (error) => {
      assert.equal(error.code, "too_many_rows");
      assert.equal(error.message,
        `The file has ${MAX_IMPORT_ROWS + 1} rows; the limit is ${MAX_IMPORT_ROWS} rows.`);
      assert.equal(error.problems[0].limit, MAX_IMPORT_ROWS);
      assert.equal(error.problems[0].observed, MAX_IMPORT_ROWS + 1);
      // Nothing partial rides along: no document, no records, no total. A short
      // number is indistinguishable from a real one once it is on the page.
      assert.equal(error.document, undefined);
      assert.equal(error.totals, undefined);
      assert.equal(error.value, undefined);
      return true;
    },
  );
});

test("the bounded sampling ceiling and analyzed-row ceiling are rendered from one contract", () => {
  assert.ok(MAX_IMPORT_BYTES > MAX_DELIMITED_BYTES);
  assert.equal(MAX_IMPORT_ROWS, MAX_DELIMITED_ROWS);
  assert.deepEqual(IMPORT_LIMITS, {
    maxBytes: MAX_IMPORT_BYTES,
    maxRows: MAX_IMPORT_ROWS,
    maxFiles: MAX_IMPORT_FILES,
    maxSelectionBytes: MAX_IMPORT_SELECTION_BYTES,
  });
  const sentence = importLimitsSentence();
  assert.match(sentence, /32 MB/);
  assert.match(sentence, /50,000 data rows/);
  assert.match(sentence, /sampled evenly/);
  assert.match(sentence, /byte ceiling are refused whole/);
});

test("the markup carries no ceiling number of its own", async () => {
  const [markup, page] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(markup, /id="local-file-limits"/);
  assert.doesNotMatch(markup, /8 MB|8,000,000|50,000 rows/);
  assert.match(page, /applyImportLimits\(document\)/);
  assert.match(page, /sampleOversized: true/);
  assert.match(page, /readDelimitedText\(file\.text, boundedDelimitedOptions\(\)\)/);
});

// --- fallback --------------------------------------------------------------

test("no Worker constructor falls back to the synchronous call, with coarse progress", async () => {
  const offloader = createImportOffloader({ scope: {} });
  const text = await fixture("openai-usage.csv");
  const samples = [];
  const result = await offloader.run(
    job(text, "openai-usage.csv", "text/csv", { generatedAt: GENERATED_AT }),
    { onProgress: (progress) => samples.push(progress) },
  );
  assert.equal(offloader.mode, "sync");
  assert.deepStrictEqual(
    result, parseLocalImportFile(text, "openai-usage.csv", "text/csv", { generatedAt: GENERATED_AT }));
  assert.ok(samples.every((sample) => sample.coarse === true));
  assert.equal(samples[0].ratio, null, "no fraction is invented where none is measured");
});

test("an engine that ignores the module option is detected without sniffing a user agent", async () => {
  const factory = fakeWorkers({ ignoreOptions: true });
  const offloader = offloaderWith(factory);
  const text = await fixture("org-roster.csv");
  const result = await offloader.run(job(text, "org-roster.csv", "text/csv", { generatedAt: GENERATED_AT }));
  assert.equal(offloader.mode, "sync");
  assert.equal(factory.created.length, 1);
  assert.equal(factory.created[0].terminated, true, "the classic-script worker is retired, not used");
  assert.deepStrictEqual(
    result, parseLocalImportFile(text, "org-roster.csv", "text/csv", { generatedAt: GENERATED_AT }));

  const source = await readFile(new URL("../src/import-offload.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /userAgent|navigator|Chrome|Safari|Firefox/);
});

test("a worker that fails to load finishes the import on the page thread", async () => {
  const factory = fakeWorkers({ failToLoad: true });
  const offloader = offloaderWith(factory);
  const text = await fixture("openai-usage.csv");
  const result = await offloader.run(job(text, "openai-usage.csv", "text/csv", { generatedAt: GENERATED_AT }));
  assert.deepStrictEqual(
    result, parseLocalImportFile(text, "openai-usage.csv", "text/csv", { generatedAt: GENERATED_AT }));
  assert.equal(offloader.mode, "sync");
});

test("the fallback path enforces the same ceilings with the same messages", async () => {
  const offloader = createImportOffloader({ scope: {} });
  await assert.rejects(
    () => offloader.run({ ...job("date,a\n1,2\n", "huge.csv", "text/csv"), byteSize: MAX_IMPORT_BYTES + 5 }),
    (error) => error.code === "file_too_large"
      && error.message === `The file is ${MAX_IMPORT_BYTES + 5} bytes; the limit is ${MAX_IMPORT_BYTES} bytes.`,
  );
  const header = "date,project_name,model,amount,currency";
  const text = [header, ...Array.from({ length: 12 },
    () => "2026-07-24,Atlas Platform,gpt-4o,1.00,USD")].join("\n");
  await assert.rejects(
    () => createImportOffloader({ scope: {}, limits: { maxBytes: MAX_IMPORT_BYTES, maxRows: 10 } })
      .run(job(text, "big.csv", "text/csv", { generatedAt: GENERATED_AT, maxRows: 10 })),
    (error) => error.code === "too_many_rows" && /the limit is 10 rows/.test(error.message),
  );
});

// --- one parser, two callers ----------------------------------------------

test("the worker runs the shipped parser rather than a copy of it", async () => {
  const [core, shim] = await Promise.all([
    readFile(new URL("../src/import-worker-core.js", import.meta.url), "utf8"),
    readFile(new URL("../src/import-worker.js", import.meta.url), "utf8"),
  ]);
  assert.match(core, /import \{[^}]*parseLocalImportFile[^}]*\} from "\.\/finops-tabular-import\.js"/);
  assert.match(shim, /from "\.\/import-worker-core\.js"/);
  // No parsing of its own: no delimiter, quote, or header handling in either.
  for (const source of [core, shim]) {
    assert.doesNotMatch(source, /detectShape|readDelimitedText|normalizeHeader|toMinorUnits/);
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|localStorage|indexedDB/);
  }
  assert.ok(shim.split("\n").filter((line) => line.trim() && !line.trim().startsWith("//")).length <= 6);
});

// --- performance and bounded retention -------------------------------------

/**
 * A deterministic synthetic export. Pure generation from a fixed seed, so the
 * fixture is reproducible without committing megabytes of CSV to the repo.
 */
function syntheticExport(rows, seed = 20_260_726) {
  const units = ["Atlas Platform", "Beacon Data", "Corvus Research", "Delta Ops"];
  const models = ["gpt-4o", "text-embedding-3-large", "dall-e-3", "gpt-4o-mini"];
  let state = seed;
  const next = (modulus) => {
    // A plain 32-bit LCG. Not random, and not meant to be — only repeatable.
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % modulus;
  };
  const lines = ["date,project_name,model,amount,currency,input_tokens,output_tokens"];
  for (let index = 0; index < rows; index += 1) {
    const day = String(10 + next(18)).padStart(2, "0");
    lines.push([
      `2026-06-${day}`, units[next(units.length)], models[next(models.length)],
      `${next(900) + 1}.${String(next(100)).padStart(2, "0")}`, "USD",
      String(next(90_000) + 100), String(next(20_000) + 50),
    ].join(","));
  }
  return lines.join("\n");
}

// Keys that would mean raw source rows were retained on the result. `values` is
// the delimited reader's own per-record field array; if one of those ever
// reaches the returned envelope, the import is holding the whole file.
const RAW_ROW_KEYS = new Set(["values", "rows", "rawRows", "cells", "lines", "records_raw", "text"]);

function rawRowPaths(value, path = "$", found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rawRowPaths(item, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    if (RAW_ROW_KEYS.has(key)) found.push(`${path}.${key}`);
    rawRowPaths(child, `${path}.${key}`, found);
  }
  return found;
}

// Budget and margin. The measured section — generation excluded, the chunked
// hand-off plus the full parse and contract validation of 25,000 rows —
// completes in roughly 0.35 s on an unloaded developer machine. The assertion
// below is 20 s, a margin of about 55×. This repo has known load-flaky timing
// tests under parallel runs, so the budget is deliberately set to catch an
// order-of-magnitude regression rather than to police jitter; anything inside
// that margin is scheduling noise, not a change in the import's cost.
const PERFORMANCE_ROWS = 25_000;
const PERFORMANCE_BUDGET_MS = 20_000;

test("a large synthetic export completes within budget and retains no raw rows", async () => {
  const text = syntheticExport(PERFORMANCE_ROWS);
  assert.ok(text.length > 1_000_000, "the fixture is genuinely large");
  assert.ok(text.length / DEFAULT_CHUNK_CHARS > 4, "and crosses the seam in several chunks");

  const offloader = offloaderWith(fakeWorkers());
  const started = process.hrtime.bigint();
  const result = await offloader.run(job(text, "synthetic.csv", "text/csv", { generatedAt: GENERATED_AT }));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < PERFORMANCE_BUDGET_MS,
    `import of ${PERFORMANCE_ROWS} rows took ${elapsedMs.toFixed(0)} ms, budget ${PERFORMANCE_BUDGET_MS} ms`);

  // Bounded retention, asserted structurally rather than by measuring a heap:
  // what comes back is headers and aggregates, and the aggregate count is bound
  // by the grouping key rather than by the row count.
  assert.deepEqual(rawRowPaths(result), []);
  const records = result.document.records;
  assert.ok(records.length > 0);
  assert.ok(records.length < PERFORMANCE_ROWS / 100,
    `${records.length} aggregates retained for ${PERFORMANCE_ROWS} rows`);
  for (const record of records) {
    // The v1.0 fields plus the five provider-usage-billing v1.1 added. Still
    // bounded per aggregate: nothing here grows with the row count.
    assert.deepEqual(Object.keys(record).sort(), [
      "aggregate_id", "cost", "input_tokens", "model_raw", "model_tier", "org_unit_id",
      "output_tokens", "provider", "request_count", "revision", "service_category",
      "usage", "usage_date",
    ]);
  }
  // And it is still the same answer the page thread would have produced.
  assert.deepStrictEqual(
    result, parseLocalImportFile(text, "synthetic.csv", "text/csv", { generatedAt: GENERATED_AT }));
});

test("the synthetic fixture is deterministic", () => {
  assert.equal(syntheticExport(50), syntheticExport(50));
  assert.notEqual(syntheticExport(50), syntheticExport(50, 7));
});

// --- a minimal document stand-in -------------------------------------------

function fakeDocument() {
  const nodes = {};
  const make = (id) => {
    const node = {
      id,
      hidden: false,
      textContent: "",
      dataset: {},
      attributes: {},
      setAttribute(name, value) { node.attributes[name] = String(value); },
      removeAttribute(name) { delete node.attributes[name]; },
    };
    nodes[id] = node;
    return node;
  };
  for (const id of ["local-import-progress", "local-import-progress-bar", "local-import-progress-text"])
    make(id);
  return { nodes, getElementById: (id) => nodes[id] ?? null };
}

test("the wire protocol names both directions once", () => {
  assert.deepEqual(Object.keys(IMPORT_MESSAGES).sort(),
    ["begin", "cancel", "chunk", "end", "failure", "progress", "result"]);
});
