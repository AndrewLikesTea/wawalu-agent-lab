# Organizational query-source contract

Status: **Anya-approved contract, version 1.0, 2026-07-29**. Approval covers the
registry, its guarantees, the three supported source kinds, the bundled
synthetic fixture, and the processing rules below. It does not approve a
gateway connection, a credential, a production data transfer, a retention
exception, or a deployment. Every source in this registry is a file the reader
already has and chooses themselves; connecting a live system is a separate
security and deployment decision that this contract deliberately does not make.

- Kind: `wawalu.integration.org-query-source`
- Version: `1.0` (contract id `wawalu.integration.org-query-source/1.0`)
- Manifest: `contracts/integrations/org-query-source/v1/manifest.json`
- Fixture: `contracts/integrations/org-query-source/v1/fixtures/organizational-sample.json`
- Registry and validator: `src/org-query-source.js`
- Panel: the import panel of `/evolution.html`, painted by `src/local-import-flow.js`
- Tests: `tests/org-query-source.test.js`

## Why it exists

Two contracts already describe a query corpus. The [query-sample import
contract](query-sample-import-contract.md) reads a gateway log or a prompt
batch; the [conversation-export import
contract](conversation-export-import-contract.md) reads an assistant's own
conversation or audit export. Neither answers the question a reader asks
*before* either of them runs: which sources am I allowed to bring, what will
this product do with one, and what will it never do?

That answer lived in three panels and zero versioned documents. This registry is
the one answer. It is the sibling of the [provider export package
contract](provider-export-package-contract.md), which says the same thing about
a billing export: where the file comes from, what arrives, and what is taken out
first. Everything the [privacy-preserving integration
contracts](privacy-preserving-integration-contracts.md) say about pseudonyms,
retention, and out-of-scope data applies here unchanged.

## What every source guarantees

Stated as machine-readable fields in `guarantees`, not as prose a reader has to
take on faith, and asserted in the test suite:

| Guarantee | Value |
| --- | --- |
| `credentials` | `false` — no source needs one, and none is accepted |
| `network_calls` | `false` — the validator and everything it calls perform no I/O |
| `customer_data_transfer` | `false` — nothing is uploaded; the file never leaves the tab |
| `prompt_content_persisted` | `false` — no prompt body or excerpt is stored |
| `prompt_content_rendered` | `false` — no prompt text is drawn on the page |

Enforced, not merely stated. `tests/org-query-source.test.js` replaces `fetch`,
`XMLHttpRequest`, and `WebSocket` with traps that fail the test if they are
called, then validates every supported source and both refusal paths. A second
test reads `src/org-query-source.js` and fails on a fetch, a URL, a storage
call, a credential-shaped identifier, or an import outside the five contract
modules the registry is allowed to depend on. A promise nobody can break by
accident is worth more than a promise printed on a page.

## The supported sources

| Source | Reads | Shapes | Attributed by | What it answers |
| --- | --- | --- | --- | --- |
| `local-conversation-archive` | `wawalu.integration.conversation-export` 1.0 | the four declared conversation and audit dialects | `department`, as the export spells it | places and counts queries per unit; carries no tokens or category, so it does not grade |
| `gateway-proxy-log` | `wawalu.integration.query-sample` 1.0 | `delimited-gateway-log` | `org_unit_id` | drives a prompt-literacy grade |
| `representative-prompt-batch` | `wawalu.integration.query-sample` 1.0 | `json-envelope` | `org_unit_id` | drives a prompt-literacy grade; the bundled fixture is one of these |

The registry does not restate those contracts — it *binds* to them. Dialect ids
are read from the live profile registry and contract versions from the live
modules, so a renamed dialect or a bumped version fails the build rather than
leaving a source a reader can select and nothing can read.

**Attribution is required.** A query that cannot be placed in an organization
unit is not organizational evidence. A row with no unit is skipped and counted,
never folded into another unit's total; a conversation archive exported without
its department column is refused with `missing_attribution` and the one sentence
that fixes it, because nothing here will infer a department from anything else
in the row.

**The bucket is the day**, `YYYY-MM-DD` in UTC, for the reason the query-sample
contract gives: the rubric weights every sampled query once and publishes no
time series, so an hour bucket would carry precision no grade can use and would
narrow the crowd a single row hides in. A conversation archive's timestamp is
truncated to its UTC calendar day rather than kept.

**Sampling is bounded.** At most 50,000 rows and 8 MB, the ceilings the
delimited reader already enforces, and at most a 280-character excerpt — longer
is a prompt body and is refused as one. A source is a sample; this contract
never asks for a full corpus.

**Gradeability is reported, not assumed.** `organizationalSampleSummary` reads
its floors from `PROMPT_GRADING_THRESHOLDS` rather than restating them: 25
queries per unit, a classified share of 0.6, and a 14-day window. A sample that
clears them is `gradeable: true`; one that does not carries a named shortfall
per dimension with the observed value and the target, so a reader is told what
to add rather than that their file was not good enough.

## Sources that are not read here

Declared, with the reason and the local alternative, because "why can't I just
connect the gateway" is a question that deserves one versioned answer:
`live-gateway-api`, `provider-admin-api`, `hris-live-connector`,
`browser-session-capture`, and `raw-prompt-dump`. Each is refused for the same
structural reason — it would need a credential, a network call, or data this
product refuses to hold at any granularity — and each names the bounded local
export to bring instead.

## Partial, stale, malformed, reordered

Inherited from the contracts beneath, which already settled each case:

| Situation | Behaviour |
| --- | --- |
| Partial delivery | Accepted. `completeness`, `omitted_record_count`, and one located issue per skipped row are carried through; the summary counts what was read, never what was sent. |
| Stale delivery | Refused whole with `stale_delivery`. `snapshot.sequence` decides freshness, never arrival order. |
| Malformed delivery | Refused whole, before a row is read: a wrong kind, a truncated envelope, or broken quoting yields a code and a coordinate and no records. |
| Reordered rows | Kept, counted in `outOfOrderRowCount`, reported. A reversed delivery produces the same units, the same window, and the same verdict. |
| Reordered columns | Kept. Columns are mapped by name, so a permuted header parses identically. |
| Wrong source selected | `dialect_mismatch`, naming the source to choose instead. |
| Unsupported format | `unsupported_format`, naming the formats that source reads. |

Codes are stable; a surface switches on the code and never string-matches a
message. No message carries a cell value — they name sources, columns, codes,
and counts.

## The bundled fixture

`organizational-sample.json` is 60 synthetic records across two pseudonymous
units and twenty day buckets. Every value is invented: the unit keys are
`psn_`-shaped pseudonyms of nothing, the model names are of a vendor that does
not exist, and every record carries a rubric category rather than an excerpt, so
there is no prompt text in the shipped bytes at all. The suite asserts that —
no `prompt_excerpt` column, no address-shaped value, no person-shaped field
name — and then asserts it grades: it validates, classifies with no
unclassified rows, scores through the rubric, and clears the eligibility gate
into `own_grade`. A fixture that only parsed would prove the parser; this one
proves the path.

## The panel

The import panel of `/evolution.html` carries a disclosure beside the
provider-export guidance: a chooser of supported sources, a compatibility
sentence for the selected one, five guidance rows, and the declined sources with
their alternatives. Every word of it is painted from this registry — the markup
holds slots and no source label, format, or refusal sentence, asserted by the
test — so a source cannot appear on the page without a validator behind it.

Selecting a source repaints the verdict and the guidance and does nothing else.
No file is chosen, nothing is read, and the provider-export workflow beside it
is untouched.

## Known deviations

- **No per-source schema file.** The two contracts this registry binds to own
  their schemas and fixtures; a third copy would be a second place to disagree
  about the same shape. The manifest names the contract and version each source
  reads, and the tests assert that binding against the live modules.
- **The conversation archive does not grade.** It carries no token counts and no
  rubric category, so it reports `attribution_and_volume` and its samples are
  never marked gradeable. Pairing one with a gateway log or a prompt batch is
  the documented route to a grade.
- **The file picker routes by shape, not by the chooser.** The panel's source
  chooser paints guidance and a compatibility verdict; it selects no file. The
  import path decides what a chosen file is from its own envelope or header —
  the two query-sample shapes first, then the conversation dialects, then the
  existing provider-export and mapping paths, untouched. `readOrgQuerySource`
  is that same order as one callable function, for a caller that has a file and
  no parse of it yet; the import surface, which has already parsed for the
  query-sample shapes, asks the registry for the archive half directly so
  nothing is parsed twice. A file no declared source reads is handed straight
  back rather than claimed.
- **What travels onward is the aggregate, not the records.** Counts on a grid
  plus the intake provenance of the files behind them, with its own cell keys,
  canonical form, digest, and refusals: see the [sanitized organizational query
  aggregate](org-query-aggregate.md).
