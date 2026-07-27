// A reproducible gate on the two properties a large import has to hold.
//
// The numbers, and why they are these numbers:
//
//   Fixture: 40,000 data rows (~2.2 MB). Large enough to be meaningful — it is
//   80% of the row ceiling and a realistic year of daily per-team provider usage
//   — and small enough to generate and parse in a couple of seconds on a loaded
//   CI box. 50,000 would sit exactly on the ceiling, where a guard-boundary
//   change would look like a perf failure.
//
//   Time budget: 20,000 ms for the full import, generation excluded. The measured
//   run is well under a second on a developer machine. The budget is deliberately
//   ~20× that, because this suite runs in parallel with everything else and a
//   perf gate that fails on a busy machine gets deleted, which is strictly worse
//   than a loose one that catches an order-of-magnitude regression. It is a gate
//   on "did the import become quadratic", not a benchmark.
//
//   Retention: 400 KB of serialized summary. The aggregation is daily × org unit
//   × provider × service category, so the retained size is a function of that
//   cardinality and not of the row count. The assertion that carries the weight
//   is the second one: ten times the rows must not produce a materially larger
//   summary. Process memory is not asserted on — it is too noisy to gate.
//
// Nothing is committed and nothing is fetched: the fixture is built from a seeded
// generator at test time.

import assert from "node:assert/strict";
import test from "node:test";
import { runImportJob } from "../src/import-worker-core.js";
import { MAX_IMPORT_ROWS, PROGRESS_BYTE_STEP } from "../src/import-protocol.js";
import { chunkedFile, syntheticProviderCsv } from "./support/import-fixture.js";

const FIXTURE_ROWS = 40_000;
const TIME_BUDGET_MS = 20_000;
const RETAINED_BYTE_BUDGET = 400_000;

const retainedBytes = (summary) => Buffer.byteLength(JSON.stringify(summary), "utf8");

test("a 40,000-row import completes inside the time budget", async () => {
  const file = chunkedFile(syntheticProviderCsv({ rows: FIXTURE_ROWS }), "year.csv");
  assert.ok(FIXTURE_ROWS < MAX_IMPORT_ROWS, "the fixture must sit under the row ceiling");

  const progress = [];
  const started = process.hrtime.bigint();
  const summary = await runImportJob(file, { onProgress: (tick) => progress.push(tick) });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(summary.type, "provider");
  assert.equal(summary.records, FIXTURE_ROWS + 1, "every row was read, header included");
  assert.ok(elapsedMs < TIME_BUDGET_MS,
    `import took ${elapsedMs.toFixed(0)}ms against a ${TIME_BUDGET_MS}ms budget`);

  // Progress is paced by bytes, not by rows: 40,000 rows must not mean 40,000
  // messages. This is the assertion that catches a throttle being removed.
  const ceiling = Math.ceil(file.size / PROGRESS_BYTE_STEP) + 1;
  assert.ok(progress.length <= ceiling,
    `${progress.length} progress messages for ${file.size} bytes exceeds ${ceiling}`);
  assert.ok(progress.length >= 2, "progress is reported during the read, not only at the end");
  assert.equal(progress.at(-1).ratio, 1);
});

test("what the import retains is bounded by the aggregation, not by the row count", async () => {
  const small = await runImportJob(
    chunkedFile(syntheticProviderCsv({ rows: FIXTURE_ROWS / 10 }), "month.csv"));
  const large = await runImportJob(
    chunkedFile(syntheticProviderCsv({ rows: FIXTURE_ROWS }), "year.csv"));

  assert.equal(large.records, FIXTURE_ROWS + 1);
  assert.ok(retainedBytes(large) < RETAINED_BYTE_BUDGET,
    `retained ${retainedBytes(large)} bytes against a ${RETAINED_BYTE_BUDGET} budget`);

  // Ten times the input, the same aggregation cardinality, so the retained
  // structure must not grow with it. A folding layer that started keeping rows
  // would fail here and nowhere else.
  assert.ok(retainedBytes(large) < retainedBytes(small) * 1.5,
    `${retainedBytes(small)} bytes for ${FIXTURE_ROWS / 10} rows grew to `
    + `${retainedBytes(large)} for ${FIXTURE_ROWS}`);
  assert.equal(large.recordCount, small.recordCount);
  // No raw row survives the fold: the summary holds aggregates, headers, and a
  // bounded problem list, and nothing keyed by an input row.
  assert.equal(Object.keys(large).includes("rows"), false);
  assert.ok(large.problems.length <= 1, "one informational note, no per-row retention");
});

test("the fixture is deterministic, so a regression is a regression", () => {
  assert.equal(syntheticProviderCsv({ rows: 200 }), syntheticProviderCsv({ rows: 200 }));
  assert.notEqual(syntheticProviderCsv({ rows: 200 }),
    syntheticProviderCsv({ rows: 200, seed: 7 }));
});
