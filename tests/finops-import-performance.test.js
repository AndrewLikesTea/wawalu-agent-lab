// A reproducible check that a real-sized export completes and stays bounded.
//
// The fixture is generated, never committed: `finops-import-fixture.js` builds
// it from a seeded generator, so the same bytes are produced on every machine
// and a failure here is reproducible from the seed rather than from an artifact
// somebody has to keep in the repo.
//
// The size below — 60 org units × 365 days = 21,900 daily provider aggregates,
// roughly 8 MB of JSON — is the low end of the intended "year of usage data"
// band the ceilings were sized against (one series per unit-day rather than one
// per provider and service category). It is well under both ceilings, which is
// the point: the case a reader actually has must not be near a limit.

import assert from "node:assert/strict";
import test from "node:test";
import { hrisExport, jsonFile, providerExport } from "./support/finops-import-fixture.js";
import { runImportJob } from "../src/finops-import-engine.js";
import { IMPORT_LIMITS } from "../src/finops-import-protocol.js";

const UNITS = 60;
const DAYS = 365;
const EXPECTED_ROWS = UNITS * DAYS + UNITS + 1;

/**
 * The time budget: 20 seconds for a year of usage data.
 *
 * A local run of this fixture — generate, read in chunks, parse, normalize —
 * lands around 350ms, so the budget is roughly 55× the observed cost. That
 * ratio is deliberate: this test shares a CI machine with a build and other
 * suites, and a wall-clock assertion tight enough to be a useful benchmark is
 * also tight enough to fail for reasons that have nothing to do with this code.
 * What it catches is a change in the *shape* of the work — a quadratic join, a
 * re-read per record, a whole-file buffer per chunk — which overruns 20 seconds
 * rather than nudging 400ms.
 */
const TIME_BUDGET_MS = 20_000;

/**
 * Retention ceiling: the normalized brief may carry per-department aggregates
 * and a bounded set of validation entries, never per-record data. One row per
 * unit plus fixed envelope fields is a few hundred values; 5,000 leaves room
 * for the envelope while still being ~4× smaller than the 21,900 input rows.
 */
const MAX_RETAINED_VALUES = 5_000;

/** Count every leaf value in the payload, to bound what the page holds. */
function leafCount(value, seen = 0) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + leafCount(item), seen);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((sum, item) => sum + leafCount(item), seen);
  }
  return seen + 1;
}

test("a year of usage data completes inside the budget and retains only aggregates", async () => {
  const files = [
    jsonFile(providerExport({ days: DAYS, units: UNITS, seed: 20260726 }), "provider-year.json"),
    jsonFile(hrisExport({ units: UNITS }), "org.json"),
  ];
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  // The intended case must sit comfortably inside both declared ceilings.
  assert.ok(bytes < IMPORT_LIMITS.maxTotalBytes / 2,
    `a year of data is ${bytes} bytes, which is not comfortably under the ${IMPORT_LIMITS.maxTotalBytes}-byte ceiling`);
  assert.ok(EXPECTED_ROWS < IMPORT_LIMITS.maxRows / 2,
    `a year of data is ${EXPECTED_ROWS} rows, which is not comfortably under the ${IMPORT_LIMITS.maxRows}-row ceiling`);

  const progress = [];
  const started = process.hrtime.bigint();
  const outcome = await runImportJob({
    files,
    onProgress: (item) => progress.push(item),
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(outcome.status, "complete");
  assert.equal(outcome.rowsProcessed, EXPECTED_ROWS);
  assert.ok(elapsedMs < TIME_BUDGET_MS,
    `import took ${Math.round(elapsedMs)}ms, over the ${TIME_BUDGET_MS}ms budget`);

  // Progress was incremental rather than one message at the end.
  assert.ok(progress.length > 2, `only ${progress.length} progress messages were posted`);
  const byteSeries = progress.map((item) => item.bytesProcessed);
  assert.deepEqual(byteSeries, [...byteSeries].sort((left, right) => left - right));
  assert.equal(byteSeries.at(-1), bytes);

  // Bounded retention, asserted on shape rather than on a memory reading: the
  // payload holds one row per department and no record-level field survives.
  const retained = leafCount(outcome.result);
  assert.ok(retained < MAX_RETAINED_VALUES,
    `the result retains ${retained} values, above the ${MAX_RETAINED_VALUES} ceiling`);
  assert.equal(outcome.result.rankedDepartments.length, UNITS);
  const serialized = JSON.stringify(outcome.result);
  for (const recordField of ["aggregate_id", "amount_minor", "usage_date", "org_unit_id"]) {
    assert.equal(serialized.includes(recordField), false,
      `the retained payload leaked the record field ${recordField}`);
  }
});
