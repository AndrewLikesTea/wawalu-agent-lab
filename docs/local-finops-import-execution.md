# Browser-local FinOps import: execution model and limits

The AI FinOps tab (`src/evolution.html`) lets a reader select provider usage
exports and an HRIS org mapping and get a decision brief without any upload.
This document describes **where** that work runs and **what it refuses to do**.
It does not describe parsing: the contract, the validation rules, and the output
shape are owned by `src/local-finops.js` and documented with the integration
contracts.

## Where the work runs

| Layer | File | Owns |
| --- | --- | --- |
| Wire contract | `src/finops-import-protocol.js` | The five message shapes and the two ceilings |
| The job | `src/finops-import-engine.js` | Chunked read, ceiling enforcement, cancellation |
| Worker shim | `src/finops-import-worker.js` | The message loop inside the worker |
| Page client | `src/finops-import-runner.js` | Worker construction, progress throttling, cancel, fallback |

`finops-import-engine.js` calls `parseLocalFinopsFile` and
`normalizeLocalFinopsHistory` exactly as the page called them before this
change. There is one job, run in one of two places:

- **Worker path (default).** A module worker reads each selected file in 1 MiB
  chunks, posts `progress`, parses, and posts `done` with the normalized brief.
- **Synchronous fallback.** If `Worker` is missing, if the browser ignores
  `{type: "module"}`, or if construction throws, the same job runs on the main
  thread. No browser loses the feature, and both paths produce identical
  normalized output — `tests/finops-import.test.js` asserts that on a shared
  fixture.

Removing the worker restores the prior behaviour exactly: delete the worker
branch in `finops-import-runner.js` and every import takes the fallback.

`src/_headers` carries `worker-src 'self'`. The site's CSP is `default-src
'none'`, which workers inherit, so without that directive the browser blocks the
worker and every import quietly takes the slow path. It permits same-origin
worker scripts only — no `blob:`, no remote origin — and `tests/build.test.js`
pins it.

### Messages

Main → worker: `{type:"start", files, limits}`, `{type:"cancel"}`.
Worker → main: `{type:"progress", rowsProcessed, bytesProcessed, totalBytes}`,
`{type:"done", status, result, providers, hris, rowsProcessed, bytesProcessed}`,
`{type:"error", code, message, ordinal, total}`.

Both sides build and read these through the protocol module, so a shape cannot
drift between them.

## Declared limits

| Limit | Value | Enforced |
| --- | --- | --- |
| `IMPORT_LIMITS.maxTotalBytes` | 64 MiB (67,108,864) per selection | Before the run from the declared sizes, and again against bytes actually read |
| `IMPORT_LIMITS.maxRows` | 200,000 records per selection | After each file is parsed, before the next one is read |

Sizing: the intended case is a year of provider usage for a mid-size org. The
contract aggregates per day, org unit, and service, so 60 org units × 365 days
lands between ~22,000 records (one series) and ~88,000 (two providers × two
service categories) at ~350–400 bytes each — 8 MB to 32 MB. Both ceilings sit
above the top of that band: ~2× on bytes and ~2.3× on rows in the worst case,
and ~9× at the low end. `tests/finops-import-performance.test.js` generates the
low end of the band from a seeded generator and asserts it stays comfortably
inside both.

**Nothing is ever truncated.** A run that breaches either ceiling fails whole:
no partial total reaches the page, and the message names the limit, the observed
value, and the action (split the export by date range). Both numbers appear in
the import help text on the page and are generated from the same constants.

## Progress, cancellation, and retained memory

- Progress is posted freely by the worker and throttled on the main thread to at
  most one repaint every 200 ms, so posting progress is never the bottleneck.
- Cancel terminates the worker, rejects the in-flight promise, and clears the
  progress region. Partial state dies inside the terminated worker; the page
  restores the state it had before the batch and a re-import can start
  immediately.
- The page retains **File handles and two counts** — never a parsed document and
  never a record array. When a reader adds the second half of the pair in a
  later batch, the job re-reads the accumulated handles rather than holding the
  first batch's rows in memory. The `done` payload carries the normalized brief
  only: per-department aggregates, coverage, and validation entries.
