# Provider-usage record contract, v1.1

The record a browser-local import produces and the analysis consumes. This
document is the consumer's reference: a downstream implementer should be able to
read it and use the contract without opening the parser.

- Schema: `contracts/integrations/provider-usage-billing/v1.1/schema.json`
- Previous version: `contracts/integrations/provider-usage-billing/v1/schema.json`
- Vocabulary and reader helpers: `src/provider-usage-record.js` (single source of truth)
- Validator: `src/local-finops.js` · Producer: `src/finops-tabular-import.js`
- Executable cases: `tests/provider-usage-record.test.js`

## Versions

| | value |
| --- | --- |
| Previous `schema_version` | `1.0` |
| Current `schema_version` | `1.1` |
| `kind` (unchanged) | `wawalu.integration.provider-usage-billing` |

Both versions are accepted on import. `1.1` is what a delimited import now
produces; a stored `1.0` export — including the fixtures committed under
`v1/fixtures/` — still imports unchanged, with every new field absent. The
migration is additive only: no v1.0 field changed meaning or type, no
previously-valid document became an error, and a v1.0 document may **not**
carry a v1.1 field (that is still `unknown_field`, so 1.0 means exactly what it
meant before).

The HRIS-org contract is untouched and stays at `1.0`.

## The five new record fields

| field | type | meaning |
| --- | --- | --- |
| `model_raw` | `string \| null` | The model identifier exactly as the export emitted it, verbatim, never truncated or rewritten. |
| `model_tier` | tier \| `null` | The normalized tier for `model_raw`. `null` exactly when `model_raw` is `null`. |
| `request_count` | `integer ≥ 0 \| null` | API calls the export reported for this aggregate. |
| `input_tokens` | `number ≥ 0 \| null` | Prompt tokens. |
| `output_tokens` | `number ≥ 0 \| null` | Completion tokens. |

All five are **required keys** on a v1.1 record. A v1.0 record has none of them
and reads back as absent through `readUsageDetail(record)`, which is the one
accessor a consumer needs: it never returns `undefined` and never has to be told
which version produced the record.

### Absent is `null`, and `null` is not `0`

`null` (`ABSENT`) is the contract's single representation of "the export does
not report this", applied uniformly to all five fields. `0` means the provider
reported zero. A consumer distinguishing "this provider does not report request
counts" from "this provider reports zero requests" compares against `null`, and
`isAbsent()` exists so that comparison is written the same way everywhere.

A count column the export does not carry makes the field absent on **every**
record from that file. A column it does carry makes an empty or zero cell a
genuine `0`. A count cell the reader's file spells unparseably makes that
aggregate's count absent rather than costing the reader the row.

### Combined tokens are never split

Where a provider emits a single combined token total and no input/output split
(the Bedrock/CUR shape), the combined figure stays in `usage.quantity`, where
v1.0 already carried it, and `input_tokens` / `output_tokens` are absent.
Nothing derives a split by ratio, by heuristic, or by an assumed default: a
consumer asking for the split gets absence, not a fabrication.

### Model identity across a folded aggregate

The record grain is unchanged — day × org unit × provider × service category,
as `privacy.aggregation` declares. Model identity survives folding only while
the folded rows agree on one model string. Two models in one aggregate leave
`model_raw` and `model_tier` absent rather than electing a winner, because a
picked winner would read as a fact about spend that no row supports. The counts
still sum, as they are additive across models.

## The tier vocabulary

Declared once, in `MODEL_TIERS` in `src/provider-usage-record.js`. Closed:

`premium` · `standard` · `economy` · `unrecognized`

`unrecognized` is a first-class member, not a failure. A model string that
matches no declared rule becomes `unrecognized`; it is never coerced to the
nearest-looking tier, never dropped, and never silently defaulted. `model_raw`
stays beside it, so an unrecognized row is diagnosable by the reader who
recognizes their own model even when this build does not.

Classification is by `MODEL_TIER_RULES`: an ordered list of declared name
patterns where the first match wins and declaration order *is* the tie-break.
There is no scoring and no edit distance. The rules describe vendor **naming**
conventions (NO SOURCE — this repository ships no rate card and reaches no
vendor API); the price-derived tier in `down-routing-candidates.js` answers a
different question and this field never overrides it.

The count of source rows landing in `unrecognized` is carried out of the import
as `unrecognizedModelRows`, on both the parse result and `result.parsed`, so a
screen can say how much of a file this build could not name.
`countUnrecognizedModels(records)` derives the same number from records alone.

## Per-dialect column mapping

These are the provider dialects the record-producing import actually supports
(`SHAPES` in `src/finops-tabular-import.js`). Each name below is one accepted
header spelling; the full alias list per column lives on the shape. Header
matching is by name, case- and separator-insensitive, never by position.

| shape | `model_raw` | `request_count` | `input_tokens` | `output_tokens` |
| --- | --- | --- | --- | --- |
| `openai_usage` | `model`, `model id`, `snapshot id` | `requests`, `request count`, `num model requests`, `calls`, … | `n context tokens total`, `input tokens`, `prompt tokens` | `n generated tokens total`, `output tokens`, `completion tokens` |
| `anthropic_usage` | `model`, `model name` | same optional request aliases | `input tokens`, `uncached input tokens` | `output tokens` |
| `bedrock_usage` | `lineItem/ProductCode`, `product productname`, `lineItem/Operation` | same optional request aliases | — (absent: CUR carries one combined `lineItem/UsageAmount`) | — (absent) |

`org_roster` is the HRIS shape and produces no provider-usage record.

The request-count column is optional on every shape: no vendor export shipped in
this repository carries one, so the shipped fixtures exercise the absent path
and `tests/fixtures/delimited/openai-usage-with-requests.csv` exercises the
present path, including a row whose reported count is a genuine zero.

## Constraints this contract keeps

- Browser-local: the import path performs no fetch, XHR, socket, credential, or
  storage access. Nothing in this change adds one.
- No prompt or completion text is retained. `model_raw` is a vendor SKU string,
  bounded at 200 characters and rejected if it carries control characters, so no
  unbounded free text enters a record under the name of a model. An
  uncarryable value makes the field absent — it is never truncated into
  something that looks like a model.
- No validation message ever echoes a cell value. A rejection names the field
  and the record index; the reader looks at their own file.
