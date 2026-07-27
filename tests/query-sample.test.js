import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CLASSIFIED_SAMPLE_FIELDS, ingestQuerySample, MAX_EXCERPT_LENGTH,
  parseQuerySampleRow, QUERY_SAMPLE_REJECTIONS,
} from "../src/query-sample.js";

const FIXTURES = new URL("./fixtures/query-sample/", import.meta.url);

async function rowsOf(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURES), "utf8")).rows;
}

test("the parse record is the only type that carries an excerpt", async () => {
  const [row] = await rowsOf("full-coverage.json");
  const parsed = parseQuerySampleRow(row, 1);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.record.excerpt, row.excerpt);

  const { records } = await ingestQuerySample([row]);
  assert.deepEqual(Object.keys(records[0]), CLASSIFIED_SAMPLE_FIELDS);
  assert.ok(!CLASSIFIED_SAMPLE_FIELDS.includes("excerpt"));
  assert.equal("excerpt" in records[0], false);
  assert.equal(records[0].department, row.department);
  assert.equal(records[0].modelTier, "premium");
});

test("malformed rows are counted, named, and located — never dropped", async () => {
  const rows = await rowsOf("no-usable-sample.json");
  const result = await ingestQuerySample(rows);
  assert.equal(result.counts.total, rows.length);
  assert.equal(result.counts.accepted + result.counts.rejected, rows.length);
  const byCode = Object.fromEntries(result.rejections.byCode.map((e) => [e.code, e.count]));
  assert.deepEqual(byCode, {
    [QUERY_SAMPLE_REJECTIONS.malformedRow]: 2,
    [QUERY_SAMPLE_REJECTIONS.missingExcerpt]: 2,
    [QUERY_SAMPLE_REJECTIONS.invalidTimestamp]: 1,
    [QUERY_SAMPLE_REJECTIONS.missingDepartment]: 1,
    [QUERY_SAMPLE_REJECTIONS.missingModel]: 1,
  });
  assert.equal(result.rejections.total, 7);
  // Row numbers are 1-based against the reader's own file.
  assert.deepEqual(result.rejections.samples.map((entry) => entry.row), [4, 5, 6, 7, 8, 9, 10]);
  // Nothing that was refused carries a cell value out with it.
  assert.deepEqual(Object.keys(result.rejections.samples[0]), ["code", "row"]);
});

test("each validation rule refuses exactly what it names", () => {
  const valid = {
    department: "psn_unit_a", model: "gpt-4o",
    timestamp: "2026-07-01T09:00:00Z", excerpt: "Context: something. Requirements: none.",
  };
  const code = (patch) => parseQuerySampleRow({ ...valid, ...patch }, 3).rejection.code;
  assert.equal(parseQuerySampleRow(valid, 3).ok, true);
  assert.equal(code({ department: "" }), QUERY_SAMPLE_REJECTIONS.missingDepartment);
  assert.equal(code({ department: "x".repeat(201) }), QUERY_SAMPLE_REJECTIONS.missingDepartment);
  assert.equal(code({ model: 17 }), QUERY_SAMPLE_REJECTIONS.missingModel);
  assert.equal(code({ timestamp: "yesterday" }), QUERY_SAMPLE_REJECTIONS.invalidTimestamp);
  assert.equal(code({ excerpt: "  " }), QUERY_SAMPLE_REJECTIONS.missingExcerpt);
  assert.equal(code({ excerpt: "x".repeat(MAX_EXCERPT_LENGTH + 1) }),
    QUERY_SAMPLE_REJECTIONS.excerptTooLong);
  assert.equal(parseQuerySampleRow("a string", 3).rejection.code,
    QUERY_SAMPLE_REJECTIONS.malformedRow);
  // Timestamps normalize to ISO so two spellings of one instant compare equal.
  assert.equal(parseQuerySampleRow({ ...valid, timestamp: "2026-07-01T11:00:00+02:00" }, 3)
    .record.timestamp, "2026-07-01T09:00:00.000Z");
});

test("unclassified records are kept, counted, and never carry a rubric category", async () => {
  const result = await ingestQuerySample(await rowsOf("no-usable-sample.json"));
  assert.equal(result.counts.accepted, 3);
  assert.equal(result.counts.classified, 0);
  assert.equal(result.counts.unclassified, 3);
  for (const record of result.records) {
    assert.equal(record.classified, false);
    assert.equal(record.category, "unclassified");
    assert.match(record.reason, /^(no_signal|below_confidence_floor|no_excerpt)$/);
  }
});

test("a tens-of-thousands-row sample yields between chunks and reports progress", async () => {
  // Generated here rather than committed: the point is the row count, and a
  // 40,000-row fixture would be a large file that says nothing a loop cannot.
  const rows = Array.from({ length: 40_000 }, (unused, index) => ({
    department: `psn_unit_${index % 4}`,
    model: index % 2 ? "gpt-4o" : "claude-sonnet-4",
    timestamp: "2026-07-01T09:00:00Z",
    excerpt: index % 3
      ? "Context: a real request. Requirements: stated. Expected output: named."
      : "still not working, try again",
  }));

  const yields = [];
  const progress = [];
  const result = await ingestQuerySample(rows, {
    chunkRows: 500,
    // No wall-clock assertion anywhere in this test: this repo already has
    // timing-flaky tests. What is asserted is the shape of the work — that it
    // was cut into chunks, that control was handed back between them, and that
    // progress moved forward and finished.
    yieldToTask: () => { yields.push(yields.length); return Promise.resolve(); },
    onProgress: (entry) => progress.push(entry),
  });

  assert.equal(result.chunks, 80);
  assert.equal(yields.length, 79, "one yield between chunks, none after the last");
  assert.equal(result.counts.total, 40_000);
  assert.equal(result.counts.accepted, 40_000);
  assert.equal(result.counts.rejected, 0);

  const ratios = progress.map((entry) => entry.ratio);
  assert.equal(ratios[0], 0);
  assert.equal(ratios.at(-1), 1);
  assert.equal(progress.at(-1).phase, "done");
  for (let index = 1; index < ratios.length; index += 1) {
    assert.ok(ratios[index] >= ratios[index - 1], "progress never goes backwards");
  }
  assert.ok(progress.some((entry) => entry.ratio > 0 && entry.ratio < 1),
    "progress advances rather than jumping from nothing to done");
  assert.equal(progress.at(-1).loaded, 40_000);
});

test("an empty sample completes without a chunk, a yield, or a divide by zero", async () => {
  const yields = [];
  const result = await ingestQuerySample([], { yieldToTask: () => { yields.push(1); } });
  assert.equal(result.chunks, 0);
  assert.equal(yields.length, 0);
  assert.equal(result.counts.total, 0);
  assert.deepEqual(result.records, []);
});
