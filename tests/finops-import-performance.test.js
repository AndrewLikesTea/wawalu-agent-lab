// A real-sized import, generated in process, run through the shipped path.
//
// Why the numbers below are what they are:
//
//   ROWS = 150,000        A hundred and fifty thousand v1 provider records is
//                         ~43 MB of JSON — the scale this change exists for, and
//                         comfortably inside both shipped ceilings, so the run
//                         exercises the success path rather than a refusal.
//   SMALL_ROWS = 25,000   The same import at one sixth the size. Retention is
//                         asserted as a *ratio* between the two, which is the
//                         only way to show the payload does not scale with rows
//                         rather than merely being small on one machine.
//   BUDGET_MS = 30,000    The measured run is ~2 s on a 2024 laptop with nothing
//                         else running. The budget is fifteen times that because
//                         `npm test` runs every suite in parallel and this one is
//                         CPU-bound: a tight budget here would fail on load, not
//                         on regression. A genuine regression in this path is an
//                         order of magnitude, not a factor of two, and 30 s still
//                         catches it.
//   PAYLOAD_CEILING       64 KB. The measured aggregate is ~23 KB and grows by
//                         tens of bytes, not megabytes, between the two sizes.
//
// Nothing large is committed: the fixture is built from the reviewed v1 export
// at test time and discarded with the process.

import assert from "node:assert/strict";
import test from "node:test";
import { runImport } from "../src/finops-import-core.js";
import {
  jsonFile, syntheticHris, syntheticProvider, validHris, validProvider,
} from "./support/finops-import-fixtures.js";

const ROWS = 150_000;
const SMALL_ROWS = 25_000;
const BUDGET_MS = 30_000;
const PAYLOAD_CEILING_BYTES = 64 * 1024;

/** What actually crosses a thread boundary, measured the way a worker sends it. */
function payloadBytes(outcome) {
  return JSON.stringify({
    headers: outcome.headers,
    analysis: outcome.analysis,
    verdict: outcome.verdict,
  }).length;
}

async function importOf(rows) {
  const base = await validProvider();
  const files = [
    jsonFile(syntheticProvider(base, { rows }), "provider.json"),
    jsonFile(syntheticHris(await validHris()), "roster.json"),
  ];
  const started = performance.now();
  const outcome = await runImport(files);
  return { outcome, elapsed: performance.now() - started, bytes: files[0].size };
}

test("a real-sized export completes inside its budget and returns bounded aggregates", async (t) => {
  const large = await importOf(ROWS);
  assert.equal(large.outcome.status, "ok");
  assert.equal(large.outcome.rowsProcessed, ROWS + 24);
  assert.ok(large.bytes > 40 * 1024 * 1024, "the generated fixture must actually be large");
  t.diagnostic(`${ROWS} rows / ${(large.bytes / (1024 * 1024)).toFixed(1)} MB in `
    + `${large.elapsed.toFixed(0)} ms; ${payloadBytes(large.outcome)} bytes returned`);
  assert.ok(large.elapsed < BUDGET_MS,
    `import took ${large.elapsed.toFixed(0)} ms, over the ${BUDGET_MS} ms budget`);

  // The number is real, not a truncated one: every generated row is attributed
  // to a roster unit, so coverage must be complete.
  assert.equal(large.outcome.verdict.headline.totalRows, ROWS);
  assert.equal(large.outcome.verdict.headline.attributedRows, ROWS);

  const small = await importOf(SMALL_ROWS);
  assert.equal(small.outcome.status, "ok");

  const largePayload = payloadBytes(large.outcome);
  const smallPayload = payloadBytes(small.outcome);
  assert.ok(largePayload < PAYLOAD_CEILING_BYTES,
    `the returned aggregate was ${largePayload} bytes, over the ${PAYLOAD_CEILING_BYTES} byte ceiling`);
  // Six times the rows must not mean six times the payload. Aggregates are sized
  // by department and finding, not by record.
  assert.ok(largePayload < smallPayload * 1.25,
    `the returned aggregate grew from ${smallPayload} to ${largePayload} bytes when rows grew `
    + `${ROWS / SMALL_ROWS}x — something row-shaped is crossing the boundary`);

  // Headers stay one fixed-size row per file at any scale.
  assert.equal(large.outcome.headers.length, 2);
  assert.deepEqual(
    large.outcome.headers.map((header) => Object.keys(header).length),
    small.outcome.headers.map((header) => Object.keys(header).length),
  );
});
