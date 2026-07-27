# Query-sample import contract

Status: **Anya-approved contract, version 1.0, 2026-07-27**. Approval covers the
schema, the fixtures, the two dialects, and the processing rules in this
document. It does not approve a gateway connection, a credential, a production
data transfer, a retention exception, or a deployment. Nothing in this
repository reads a query sample yet: what ships is the contract, its validator,
its fixtures, and a downloadable template. Connecting a real gateway is a
separate security and deployment decision.

- Kind: `wawalu.integration.query-sample`
- Version: `1.0` (contract id `wawalu.integration.query-sample/1.0`)
- Schema: `contracts/integrations/query-sample/v1/schema.json`
- Fixtures: `contracts/integrations/query-sample/v1/fixtures/`
- Validator: `src/query-sample-contract.js`
- Template: `src/query-sample-example.js` → `example-query-sample.csv`
- Tests: `tests/query-sample-contract.test.js`

Its nearer sibling is the [conversation-export import
contract](conversation-export-import-contract.md), which reads AI-assistant
conversation and audit exports. Where this contract accepts a short excerpt and
discards it after classification, that one never lets a prompt body out of the
parser at all.

It is also a sibling of the [privacy-preserving integration
contracts](privacy-preserving-integration-contracts.md); everything that
document says about transport, quarantine, pseudonym construction, retention,
and out-of-scope data applies here unchanged.

## Why it exists, and why it is this small

`local-finops.js` reports, for every department it ranks, that "the provider
billing contract contains no scored query-category sample." A billing aggregate
says what a department spent; it never says what the department asked for, so
the prompt-literacy rubric has nothing to grade. This contract is the missing
input.

Its required fields are exactly the four `scorePromptLiteracy` consumes —
category, model, input tokens, output tokens — plus the department key that
attributes a row and the day bucket that places it. Nothing else is required,
because nothing else changes a grade, and a field nobody consumes is a field
somebody has to defend to a works council.

## Required fields

Per row, all required, with the declared type:

| Field | Type | Note |
| --- | --- | --- |
| `org_unit_id` | `psn_` + 16–64 identifier characters, or a ≤64-character provider-native unit key | The HRIS org contract's `unit_id`, byte-for-byte — or the unit the billing export is grouped by. See **The key space**. |
| `query_date` | string, `YYYY-MM-DD` | UTC calendar day. Validated against the real calendar. |
| `model_raw` | string, `^[A-Za-z0-9._:@/-]{1,64}$` | The provider-usage-billing v1.1 field name and verbatim rule. |
| `input_tokens` | integer ≥ 0 | The provider-usage-billing v1.1 field name. |
| `output_tokens` | integer ≥ 0 | Same. |

Plus **exactly one** of:

| Field | Type | Note |
| --- | --- | --- |
| `prompt_excerpt` | string, 1–280 characters | Classified in the browser tab and discarded there. |
| `category` | `highValue` \| `overProvisioned` \| `inefficient` \| `outOfScope` | The rubric's own keys, read from `src/prompt-literacy-rubric.json`. |

**The department key.** `org_unit_id` is the HRIS org contract's `unit_id`, with
the same `psn_`-prefixed HMAC construction, the same tenant integration key and
`org-unit` namespace, and the same comparison rule: verbatim. There is no case
folding, no canonicalization, and no trimming beyond the surrounding whitespace
a delimited reader strips from a cell. A key that does not match the HRIS
pseudonym shape fails its row rather than being repaired into something that
would join the wrong department.

**The key space.** A reader with a provider export and a query sample but no
HRIS file has no pseudonym to key by, and demanding one dead-ends their grade.
So `org_unit_id` may instead carry the provider-native unit their bill is
grouped by — a project, workspace, account, resource group, key, or tag. Which
of the two applies is decided **once per file**, from the caller's
`groupingUnit` option, which is `detectDialect(...).groupingUnit` passed
straight through: declared, the column is validated as that unit and only that
unit; omitted, it is validated as a pseudonym and only as a pseudonym. It is
never chosen per row from the shape of a cell, because a project literally named
`psn_something` would then pick a key space by accident and move a published
grade on a regex. A provider unit key is still a bounded identifier — at most 64
characters from the rubric's own conservative identifier class — so a mis-mapped
free-text column cannot smuggle prompt text in through the join key.

The same sample scores identically whichever key space it arrives in; that is
asserted by a fixture pair in `tests/query-sample-contract.test.js` and again,
at the join, in `tests/query-literacy-join.test.js`.

**The bucket granularity.** Day, stated in `snapshot.bucket_granularity` and
enforced per row. Rubric 1.0.0 weights every sampled query once and publishes no
time series, so an hour bucket would carry a precision no grade can use, and it
would narrow the crowd a single row hides in. `query_date` is the same type and
format as the provider contract's `usage_date`, so a sample and a billing
aggregate bucket alike.

**The token split.** `input_tokens` and `output_tokens` reuse the
provider-usage-billing v1.1 names and meanings. One difference is deliberate:
there they are *absent-or-count* (nullable), because an aggregate may fold rows
that report only a combined total. A query sample is one query, so there is
nothing for `null` to mean and both fields are required non-negative integers.

**Excerpt or category, never both.** A row carrying both is **rejected at row
level** with `ambiguous_classification`. The two statements can disagree about
the same query and this layer has no evidence with which to pick a winner;
`dialect-detection.js` already refuses to resolve an ambiguous match by
declaration order, and silently preferring one would move a published grade on
a rule nobody read. A row carrying neither is rejected with
`missing_classification`.

## The redaction boundary

In plain language, for forwarding:

> A query sample carries a short excerpt of a request only so that the reader's
> own browser can label it. The labelling happens in the browser tab, on the
> reader's machine. The excerpt is then discarded. Only the derived label — one
> of four category words — the model name, the token counts, and the department
> pseudonym survive that step, and only those are ever shown, stored, or sent
> anywhere. Raw prompt text is never stored and never transmitted. Response
> text, end-user identities, and credentials are not merely unused: a file that
> contains them is rejected in full and no part of it is read.

Enforced, not merely stated:

- `REFUSED_COLUMNS` in `src/query-sample-contract.js` is the explicit,
  reviewable set of columns whose presence rejects the file whole with
  `refused_column`, naming the offending column and why it is refused. It covers
  end-user identifiers (`user_id`, `user_email`, `email`, `username`, `actor_id`,
  `subject_id`, `employee_id`, `account_id`, `ip_address`), raw prompt bodies
  (`prompt`, `prompt_text`, `prompt_body`, `full_prompt`, `input_text`,
  `messages`), response text (`response`, `response_text`, `output_text`,
  `completion`), credentials (`api_key`, `api_token`, `authorization`), and
  per-request or per-session identifiers (`request_id`, `session_id`). Column
  names are normalized before the check, so `User Email`, `user_email`, and
  `userEmail` are one column. Refusal is whole-file on purpose: a row-level skip
  would keep the rest of a file that should never have left the gateway.
- An excerpt longer than 280 characters is a prompt body, and is refused as one
  (`excerpt_too_long`).
- `classifyQuerySample` is the only door out of the parsed shape, and it
  *builds* its result from an allowlist (`CLASSIFIED_RECORD_KEYS`) rather than
  deleting the excerpt from a copy. A classified record has no excerpt key to
  leak because nothing ever writes one. Its keys are exactly what
  `scorePromptLiteracy` reads, so nothing sits between the two to reintroduce
  one.
- No error message this contract emits carries a cell value. Messages name
  columns, codes, and coordinates.

## Dialects

Recognition is content-based; the file name is never consulted.

1. **`delimited-gateway-log`** — CSV or TSV. The delimiter is voted on from
   field-count consistency across the leading records by `delimited-text.js`,
   which also handles RFC 4180 quoting, a UTF-8 BOM, and CRLF/LF/CR endings. A
   file matches when its header carries an accepted spelling of every required
   field; common gateway spellings (`prompt_tokens`, `tokens_in`, `model`,
   `date`, `department_id`, …) are accepted aliases.
2. **`json-envelope`** — the same envelope shape as the provider-usage and HRIS
   exports: a single JSON object with `schema_version`, `kind`, `export_id`,
   `snapshot`, `privacy`, and a `records` array of objects. Not NDJSON, because
   no sibling uses it.

A leading `{` or `[` after optional whitespace and BOM means the producer wrote
JSON, so JSON owns the diagnosis from there: an envelope of the wrong kind is a
wrong envelope, not a stray CSV.

A file matching neither returns `unrecognized_dialect` with what was expected
and what was seen — the chosen delimiter, the header names found, the required
fields missing, or the top-level JSON type. Header names are column metadata,
which this repository already surfaces; cell values are not echoed.

## Partial, stale, malformed, reordered

The failure policy follows both siblings, each for the case it already settled:

- **File-level rejection** for anything that indicts the whole file:
  unrecognized dialect, empty file, unsupported kind or version, a malformed
  envelope, a refused column, a stale delivery, or no usable rows. Precedent:
  `local-finops.js`, which rejects an envelope outright rather than salvaging
  records out of it.
- **Row-level skip with a collected, coordinate-bearing issue** for anything
  wrong with one row. A file with three bad dates yields the other rows plus
  three located problems. Precedent: `finops-tabular-import.js`, where partial
  success is the normal case.

| Situation | Behaviour |
| --- | --- |
| Missing optional column (`prompt_excerpt` or `category`) | Fine, as long as each row still states exactly one of the two. |
| Unknown extra column, delimited | Ignored, reported as an `unmapped_column` notice. Precedent: `finops-tabular-import.js`, where a vendor's spare column is normal. |
| Unknown extra field, JSON envelope | File rejected with `unknown_field`. Precedent: `local-finops.js` and the schema's `additionalProperties: false` — a declared envelope that grew a field is a contract change. |
| Rows out of `query_date` order | Kept, counted in `outOfOrderRowCount`, and reported. Rubric 1.0.0 buckets by day and weights each query once, so row order carries no meaning; it is reported because a shuffled file is usually an unintended concatenation. |
| Re-delivered or reordered *deliveries* | `snapshot.sequence` decides, not arrival. A sequence at or below the last accepted one from the same source is refused with `stale_delivery`. |
| Partial delivery | Accepted. `snapshot.completeness`, `omitted_record_count`, and `issues` are carried through so a consumer can say what it is missing. |
| Empty file | `empty_file`. |
| Every row invalid | `no_usable_rows`, carrying the row issues, rather than an empty success. |

## Error codes

Stable; downstream switches on the code and never string-matches a message.

File-level: `empty_file`, `file_too_large`, `too_many_rows`,
`malformed_quoted_field`, `unsupported_format`, `unrecognized_dialect`,
`refused_column`, `unsupported_contract`, `unknown_field`, `stale_delivery`,
`no_usable_rows`.

Row-level: `missing_required_field`, `invalid_department_key`,
`invalid_time_bucket`, `invalid_token_count`, `invalid_model_identifier`,
`missing_classification`, `ambiguous_classification`, `unknown_category`,
`excerpt_too_long`.

Notices (reported, never fatal): `unmapped_column`, `out_of_order_row`.

## The template

`Download the query-sample template` on the import panel of `/evolution.html`
produces `example-query-sample.csv` through the same local blob download every
other artifact on that page uses. Nothing is uploaded.

The template is generated by `src/query-sample-example.js`, not committed as
bytes, and it is validated in the tests by `parseQuerySample` — the real
validator, not a copy. Its department keys are read out of the HRIS export the
bundled example dataset already ships, so every row joins a department a reader
can already see. Nine rows cover both classification paths, three models, three
day buckets, and three departments.

## Known deviations from the sibling contracts

- **No per-record `revision`.** The HRIS and provider records carry one because
  a unit and an aggregate are mutable and restatable. A sampled query is an
  event that happened once; without a record identity a revision would be a
  field nobody could act on. Freshness is a delivery-level question, answered by
  `snapshot.sequence`. The consequence is that this contract is not covered by
  the shared reordered-fixture assertion in
  `tests/privacy-integration-contracts.test.js`; the same six delivery states
  are asserted in `tests/query-sample-contract.test.js` instead.
- **No `sample_id`.** Same reason: the rubric aggregates, it does not address
  individual rows, and an id per sampled query is one more thing a producer
  would have to pseudonymize.
- **Tokens are required integers, not absent-or-count.** Stated above.
