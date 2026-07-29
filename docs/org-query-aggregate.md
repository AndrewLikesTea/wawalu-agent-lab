# The sanitized organizational query aggregate

Status: **implementation contract, version `org-query-aggregate/1.0.0`**. This
document describes what leaves the reading layer when a reader imports a local
organizational query sample, and it is the prose half of
`src/org-query-aggregate.js`. It approves no connector, no credential, and no
transfer; every source it summarizes is still a file the reader chose in their
own browser tab.

- Module: `src/org-query-aggregate.js`
- Readers it consumes: `src/org-query-source.js` (the
  [source registry](org-query-source-contract.md))
- Consumer: `src/org-query-scoring.js`, which publishes it on the scored model
  as `aggregate` and digests it as `provenance.aggregateDigest`
- Tests: `tests/org-query-aggregate.test.js`

## Why it exists

The registry says which local files may be read. The scoring module classifies
what they carry and drops every prompt excerpt at `classifyRecords`. What
neither of them had was a *named, bounded, serializable object* that is the
whole of what travels onward — so "only the aggregate reaches the decision
model" was a property of who happened to read which field, not a shape anyone
could point at, digest, or assert against.

An aggregate is that shape: counts on a grid, plus the intake provenance of the
files those counts came from. It is built from allowlists — every entry is
constructed key by key rather than copied from a record and pruned — so there is
no key a prompt, a credential, or a customer identifier could survive in.
`assertOrgQueryAggregateRedacted` re-checks that from the outside, and the suite
runs it on every fixture.

## The three arrays and their cell keys

A *cell key* is what makes two rows the same cell. Rows agreeing on every field
of a cell key merge into one entry with a count, and the canonical form below
sorts each array by its cell key in the order given here.

| Array | Cell key | Values |
| --- | --- | --- |
| `cells` | `orgUnitId`, `queryDate`, `model`, `category`, `classifiedBy` | `queries`, `inputTokens`, `outputTokens`, `confidence` |
| `unclassifiedCells` | `orgUnitId`, `queryDate`, `reason` | `queries` |
| `intakeCells` | `sourceId`, `dialect`, `keySpace` | `grades`, `files`, `records`, `skippedRowCount`, `outOfOrderRowCount` |

Three deliberate absences. `intakeCells.files` is a **count**, never a file
name: a file name is the reader's own words and belongs on the surface they
typed it into, not in a digested grid. `unclassifiedCells.reason` is the
classifier's own code — "no excerpt", "no signal", "below the confidence floor"
— and carries no cell value. Token totals are `null` unless *every* record in a
cell carried one, because a partial sum is a number nobody can reproduce by
counting their own file.

## Canonical form and the digest

`orgQueryAggregateCanonicalForm(aggregate)` returns the aggregate with all three
arrays sorted by their documented cell keys and every entry rebuilt with its
keys in a fixed order. `orgQueryAggregateDigest` is a 32-bit FNV-1a over the
JSON of that form, as eight hex digits.

The sort matters because cells arrive in whatever order their producer walked
its inputs — which, for a merged multi-file selection, is the order the reader
happened to click files in. Serializing that order would make the digest a
statement about the file picker. Two aggregates that differ only in array order
are the same aggregate and digest identically;
`tests/org-query-aggregate.test.js` proves it on hand-built aggregates rather
than inferring it from a scoring result that happened to agree. The sort is
total: entries with the same cell key tie-break on their value tuple, so no two
can compare equal and leave the order to the engine. Numbers sort as numbers.

**Two digests are published, and they answer different questions.**
`provenance.inputDigest` is over the classified evidence alone, so one sample
delivered as a gateway log and as a prompt batch digests the same — the handle
for "are we arguing about the same queries". `provenance.aggregateDigest` covers
the intake provenance too, so it separates two selections with identical counts
read out of different files.

## Refusals

Every refusal is whole-selection and recoverable without leaving the tab. An
aggregate is one grid with one meaning, so a selection that is partly unreadable
is never half-aggregated.

| Code | When | Recovery |
| --- | --- | --- |
| `no_source` | nothing validated was supplied | choose one of the declared sources |
| `malformed_source` | a member of the selection did not validate | fix or deselect that file locally |
| `unsupported_source` | a result names a source the registry does not declare | re-read the file through a declared source |
| `incompatible_contract` | the selection mixes registry contract versions | aggregate each version separately |
| `mixed_key_space` | the selection mixes organization-unit key spaces | import one key space at a time |
| `aggregate_too_large` | the grid exceeds `MAX_ORG_QUERY_AGGREGATE_CELLS` (20,000 cells) | narrow the sample |

`mixed_key_space` is the one worth arguing with. A conversation archive keys
units by the department label the export itself carries (`source_label`); a
gateway log keys them by an org pseudonym or a provider unit. The same string
means different things in each, so merging them would join units nobody joined
and the digest would certify that join. The registry still documents pairing an
archive with a gateway log as the route to a grade — the grades themselves are
unaffected, because they were never computed from the aggregate. A selection the
aggregate refuses publishes `aggregate: null` beside an `aggregateProblem`
naming the code, the reason, and the local next step.

## Known deviations

- **The ceiling is on the grid, not on the file.** The byte and row ceilings
  belong to `src/delimited-text.js` and fire first. This one fires on a sample
  whose unit–day–model–category tuples barely repeat, which is per-request
  evidence wearing a grid's clothing.
- **`confidence` is a rounded mean per cell.** A sum of confidences is not a
  quantity, and the rubric's own reporting precision owns the rounding.
- **No aggregate is persisted or exported yet.** It is published on the scored
  model and digested there. Writing one to the local workspace, or into an
  exported briefing, is a separate change with its own retention question.
