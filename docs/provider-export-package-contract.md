# Provider export package contract

Status: **Anya-approved contract, version 1.0, 2026-07-29**. Approval covers the
six package entries, the accepted and refused formats, the unsupported-package
path, and the delivery behaviour below. It does not approve a vendor API client,
a credential, an admin connection, a live billing integration, or a production
data transfer. There is no code path in this repository that contacts a provider
console, and this contract does not add one.

- Kind: `wawalu.integration.provider-export-package`
- Version: `1.0`
- Source: `src/provider-export-package.js`
- Published bytes: `contracts/integrations/provider-export-package/v1/manifest.json`
- Consumers: `src/finops-tabular-import.js` (routing, refusal, provider
  attribution), `src/local-import-flow.js` (the guidance beside the file picker)
- Tests: `tests/provider-export-package.test.js`

It sits above the [privacy-preserving integration
contracts](privacy-preserving-integration-contracts.md), which govern the v1
envelopes, and above the column-level dialect profiles in
`src/dialect-profiles.js`. The [conversation-export import
contract](conversation-export-import-contract.md) governs the one family of
exports that carries prompt text; nothing in this document weakens it.

## Why it exists

Everything this product declared about a provider export started at the header
row. Nothing declared the step before it: *where do I get that file, what will
it arrive as, and what do I take out of it first?* That was answered in a help
sentence, a panel paragraph, and an error message — three answers, versioned
zero times, none of them readable by the parser.

This contract is the one answer. The importer reads it for the extensions it
accepts, the media types it accepts, the vendor a row is attributed to, and the
sentence an undeclared file is refused with. The import panel paints its
guidance from it. Neither restates a vendor rule of its own.

## The intake, once

Stated in `intake`, and true of every package:

| Property | Value |
| --- | --- |
| Where the file is read | The reader's own browser tab |
| Uploads | None |
| Network calls during intake | None |
| Credentials | None — no token, no OAuth redirect, no console session |
| Prompt storage | None. A usage export carries no prompt column; a conversation export is read under the never-render rule and is a different contract |
| Browser storage | Only the opt-in workspace, and never a raw file or a cell value |
| Retained from a file | Column headers, aggregate totals per day/org unit/model, pseudonymous org-unit and model identifiers |
| Never retained | The file itself, any cell value (including inside an error message), any free-text column, any per-person or per-request row |

## Formats

Accepted: `.csv`, `.tsv`, `.txt` (delimited text, UTF-8), and `.json` for the
reviewed v1 envelope, which keeps its own validator. `ACCEPTED_DELIMITED_EXTENSIONS`
and the delimited media-type list in `src/finops-tabular-import.js` are both
derived from `accepted_formats`; the markup's `accept` attribute is the same set.

The delimited formats share one media-type set deliberately: a browser types a
`.tsv` as `text/plain` as readily as a `.txt`, and the dialect is decided by
sniffing the header, never by the file name or the media type.

## The packages

Six, each binding to the dialect profile that reads its columns and, where one
exists, to the normalizer shape that turns them into the v1 envelope. Both
bindings are asserted against the live registries, so a renamed profile fails the
suite rather than silently orphaning its guidance.

| Package | Dialect | Shape | Delivery |
| --- | --- | --- | --- |
| `openai-usage-export` | `openai-usage-export` | `openai_usage` | Single file, browser download |
| `anthropic-usage-export` | `anthropic-usage-export` | `anthropic_usage` | Single file, browser download |
| `aws-cost-and-usage-report` | `aws-cost-and-usage-report` | `bedrock_usage` | Archive in a bucket you own; choose the CSV part file |
| `google-cloud-billing-export` | `google-cloud-billing-export` | — | Single file, browser download |
| `azure-cost-management-export` | `azure-cost-management-export` | — | Storage account you own; sometimes zipped |
| `generic-hris-roster` | `generic-hris-roster` | `org_roster` | Single file |

Each entry carries four things the panel renders as the same four rows for every
vendor: **what to ask for** (including who can request it and what to ask for
*instead of* — an invoice PDF is not a usage export), **what it arrives as**
(container, where it lands, which member to choose, what the rows should look
like), **which formats are accepted here**, and **what to take out first**.

The two entries with no `shape_id` say so in `support`: their columns are
recognized by the dialect layer, and a file of that shape reaches the manual
column-mapping step rather than a normalizer. That is stated in the contract and
painted on the page rather than left for a reader to discover by importing.

### Redaction expectations

Per package, `redaction` states three lists:

- `before_import` — what the reader removes or declines to request. It is always
  the same shape of instruction: do not ask for the per-person breakdown, and
  delete the columns that identify an individual or a resource.
- `never_read` — columns the parser does not read even when present. The
  normalizer builds its records from a declared field list rather than copying a
  row and pruning it, so an undeclared column has no key to survive in.
- `pseudonymized_on_read` — the columns that do enter the envelope, and do so as
  HMAC-derived pseudonyms (`unit-pseudonym.js`), never as the label typed in a
  vendor console.

## The unsupported-package path

An extension this contract does not declare is refused **before any parse**, with
code `unsupported_format`. Nothing about the file is read, kept, or reported
beyond its extension and media type, and it is never partially parsed to see what
it might have been.

Five containers are declared as refused-with-a-next-step rather than merely
unknown, because a reader is handed them by real consoles:

| Container | What the refusal says to do |
| --- | --- |
| `.zip` | Open the archive locally and choose the CSV member the package names |
| `.gz`, `.tgz`, `.bz2` | Decompress locally, then choose the CSV |
| `.xlsx`, `.xls`, `.numbers`, `.ods` | Save the usage sheet as CSV |
| `.pdf`, `.html`, `.htm` | Request the usage export, not the invoice |
| `.ndjson`, `.jsonl`, `.xml`, `.parquet`, `.avro` | Re-export as CSV, or convert it yourself first |

Anything else gets the general sentence. The recovery line under the file picker
is the contract's `unsupported_package.recovery`, so the refusal and the guidance
are one statement.

## Partial, stale, malformed, reordered, duplicated

`delivery_behaviour` states each case as observable behaviour, and
`tests/provider-export-package.test.js` drives the real parser to assert it.

| Situation | Behaviour | Never |
| --- | --- | --- |
| **Partial** — some rows unreadable | The readable rows import; every rejected row is reported with a code, a row number, and a column name | A row is never silently dropped or repaired by guessing |
| **Stale** — an older period, or one already imported | It imports. A delimited export carries no delivery sequence, so freshness is the reader's own file-picking decision; overlapping periods from one source reconcile by date and the provenance label states the period read | A stale file never replaces a newer period's totals under a fresh-looking label |
| **Malformed** — unclosed quoted field, header with no rows, ceiling breach | Whole-file refusal with one code and one located coordinate | No partial total is ever shown |
| **Reordered** — rows or periods out of date order | Accepted; every aggregate derives from the date column, so row order changes no figure | Row order is never treated as chronology |
| **Duplicated** — a period chosen twice, or repeated rows | Identical aggregates collapse; a repeated period from one source reconciles rather than summing twice | A duplicate is never added into a total on the quiet |

Note the deliberate difference from the envelope contracts: a v1 envelope carries
`snapshot.sequence`, so a stale *delivery* there is a rejected replay. A CSV
downloaded from a console carries no sequence at all, so staleness cannot be
detected — only disclosed. Claiming otherwise would be a promise no code keeps.

## Versioning

`manifest_version` is `major.minor`. A new package, a new refused container, or a
clarified sentence is a minor bump. Changing what a package binds to, removing a
package, changing an accepted format, or weakening an intake property is a major
bump and a new `v2` directory. Consumers allowlist the exact version.

The committed manifest is `contractDocument()` serialized — the same object the
shipped code reads — and the test asserts the two are equal, so the published
bytes cannot drift from the behaviour.

## What is not here

No credential, no endpoint, no vendor SDK, no scheduled fetch, no example file
containing real usage. Every fixture used by the tests is generated in-test from
invented values. Connecting any of these packages to a live console is a
deployment decision that belongs to someone else, under a separate review.
