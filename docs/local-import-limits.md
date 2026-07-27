# Local import: ceilings, offload, and cancellation

The AI FinOps tab reads provider exports in the reader's own browser. Nothing is
uploaded, and nothing is stored. This page describes the two enforced ceilings,
where the work runs, and what a reader sees when either ceiling is hit.

## The ceilings

| Limit | Value | Where it is checked |
| --- | --- | --- |
| File size | 8 MB (8,000,000 UTF-8 bytes) | Before any decoding, from `File.size`, and again inside the reader |
| Row count | 50,000 records, header row included | During the parse, by the delimited reader |

Both numbers are defined once, in `src/delimited-text.js`
(`MAX_DELIMITED_BYTES` / `MAX_DELIMITED_ROWS`), and re-exported for the import
surface by `src/import-limits.js` as `MAX_IMPORT_BYTES` / `MAX_IMPORT_ROWS`.
Nothing else — not the markup, not this page's prose, not the worker — repeats
them. The sentence under the file picker is rendered from
`importLimitsSentence()`, so raising a limit is a one-line edit and the copy
follows.

**A ceiling is a whole-file refusal, never a truncation.** An import over either
limit produces zero records, no aggregate, and one message naming both the limit
and the observed value:

- `file_too_large` — "The file is 9,400,000 bytes; the limit is 8,000,000 bytes."
- `too_many_rows` — "The file has 62,110 rows; the limit is 50,000 rows."

A short total is indistinguishable from a real one on the surface that renders
it, so no partial result is ever surfaced. The recovery offered at the control is
to split the export into smaller periods.

## Where the parse runs

The offload seam is one function:
`parseLocalImportFile(text, fileName, mediaType, options)` in
`src/finops-tabular-import.js`. It takes raw file text and returns the validated
v1 envelope the rest of the tab consumes. Parsing behaviour — dialect detection,
quoting, header inference, column mapping, normalization, aggregate maths — is
unchanged by the offload and lives entirely inside that boundary.

- **Worker path.** `src/import-worker.js` is a shim over
  `src/import-worker-core.js`, which imports and calls that same function from
  that same module. There is no second copy of the parser.
- **Synchronous path.** `src/import-offload.js` feature-detects the `Worker`
  constructor and, at construction, whether the engine reads the `type: "module"`
  option. If either check fails the worker is retired for the life of the page
  and the page runs the identical call on the page thread. The check is a
  straight-line capability probe; no user-agent string is consulted.

Exactly one of the two runs per import.

## Progress and cancellation

The file text is sent to the worker in 256 KB slices, so progress is a real
fraction of a known total rather than a spinner, throttled to one message per
100 ms. Rejoining the slices reproduces the original string exactly, so the
parser sees byte-for-byte what the synchronous path would have handed it.

The parse itself is synchronous and has no progress hooks. Adding some would mean
editing frozen parsing code, so the parse is reported as one determinate step,
and on the synchronous fallback the surface says progress is coarse instead of
animating a fraction nobody measured.

**Cancel terminates the worker.** A synchronous parse cannot read a stop flag
mid-flight, so the thread is ended, the partial text dies with it, and the queued
files are dropped. The file picker is cleared on the way out — a file input does
not fire `change` for an unchanged value — so the reader can immediately choose
the same file again. The next run builds a fresh worker.

## Streaming

The file is read to text on the page thread before it is offloaded. Streaming the
bytes straight into the worker is not available here: the column-review step
(step 2 of the import flow) reads the same text on the page thread to show the
reader what each of their columns became, so a streamed parse would have to
restructure that step. It is read once, sliced, and offloaded.
