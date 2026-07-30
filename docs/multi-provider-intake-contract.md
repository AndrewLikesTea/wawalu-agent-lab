# Multi-provider local intake contract

**Contract id:** `wawalu.integration.multi-provider-intake/1.0`
**Implementation:** `src/multi-provider-intake.js`
**Consumers:** `src/local-finops.js` (reconciliation), `src/finops-tabular-import.js`
(sensitivity screen), `src/import-column-mapping.js` (withheld samples),
`src/local-import-flow.js` (the coverage panel on the import surface).

## What it answers

A FinOps lead usually pays more than one provider. Before this contract the
import read each provider's export correctly and then combined them wrongly:
every delimited import declares the same translation-layer source instance, so
an OpenAI January and an Anthropic January looked like one period supplied
twice. The second was quarantined as `duplicate_period` and its spend silently
left the total, under a message telling the reader to remove a duplicate they
did not have.

The rule is now explicit: **two exports are the same period only if the same
adapter produced both.** Different adapters covering the identical billing
window are two halves of one period, and are merged into it.

## Adapters

One entry per provider export this build reads. Each declares its own
`adapterVersion`, bumped when what it says about that provider's export changes
meaning — a stored reading is interpreted by the version that produced it.

| Adapter | Version | Provider | Delimited shape | Grouping unit | Cost basis |
| --- | --- | --- | --- | --- | --- |
| `openai-usage` | 1.0 | `openai` | `openai_usage` | project | billed amount |
| `anthropic-usage` | 1.0 | `anthropic` | `anthropic_usage` | workspace | billed amount |
| `bedrock-cost-and-usage` | 1.0 | `aws` | `bedrock_usage` | cost-allocation tag | unblended cost |

Bedrock's basis is deliberately named as different: unblended cost excludes
savings-plan and credit adjustments that land on separate CUR rows, so a
combined total reads slightly high against an invoice. That sentence is on the
adapter, and the coverage panel prints it beside the provider rather than
letting a reader assume three identical bases.

## Comparability

A combined figure is only produced when every accepted export shares:

- the **identical billing window** — same `period_start` and `period_end`;
- one **currency**, `USD`, unconverted (see below);
- its own **billed cost**, with any deviation from that basis stated.

The resulting `comparability.state` is one of `single_provider`, `combined`, or
`combined_bounded` — the last when the total is real but bounded, with the
bound named: a partial export makes the total a floor; an export generated
before its own period closed is provisional; a non-billed cost basis is called
out. Notes name providers, never files or cells.

## Failure behaviour

| Input | Code | What happens |
| --- | --- | --- |
| Non-USD records | `unsupported_currency` | The export is held out of the total, whatever else was selected. No rate is applied; a converted total nobody can reproduce is worse than a named refusal. |
| Two exports, same provider, same window | `duplicate_period` | The first in export-id order is kept. Unchanged from before this contract. |
| The same export chosen twice | `duplicate_export` | The repeat is held out. |
| Windows that overlap without matching | `misaligned_period` | The window covering more providers wins; ties break by earlier start, then period key. The loser is held out — overlapping days cannot be separated by arithmetic. |
| Two source instances of one provider | `incompatible_source` | The larger group is kept. The rule the reconciler applied across the whole selection now applies inside each adapter, where it means what it always meant. |
| A prompt or completion column | `sensitive_field_present` | The file is refused at the header row, before a cell is read. |
| A partial export | note `partial_export` | Read. The combined total is stated as a floor. |
| An export generated before its window closed | note `provisional_export` | Read, and marked provisional. |
| Reordered columns | — | Header-name matching upstream; column order does not matter. |
| Malformed rows | — | Located and skipped upstream; the file still imports. |

Every rejection carries the **provider's own remediation**: what recovers an
Anthropic window is not what recovers a CUR. The coverage panel renders that
sentence with a control that returns focus to the file chooser.

## Sensitive fields

Each adapter declares its sensitive columns with a policy:

- `reject` — message bodies (`prompt`, `completion`, and their aliases). The
  file is refused whole at the header row. Nothing is parsed, nothing is
  sampled into the mapping review, nothing reaches the DOM.
- `redact` — per-person identity, key aliases, resource ARNs, payer account
  ids. These map to no normalized field in any dialect profile, so they are
  dropped at the parse boundary rather than filtered later, and their values are
  withheld from the mapping review's sample column.

The redaction guarantee is structural, and `tests/multi-provider-intake.test.js`
asserts it: no `redact` header appears in any dialect profile's column mapping.

## Merged documents

A merged period is a provider-usage-billing envelope like any other, emitted at
the highest schema version present in the merge, with older records upgraded
through `ABSENT_USAGE_DETAIL` — the contract's own representation of "this
export did not carry that field", never a zero.

The merged snapshot states the **weakest** claim any input made: the oldest
`generated_at`, `partial` if any input was partial, the summed
`omitted_record_count`, and the smallest declared group-size floor. Combining
two files never improves either one's claim.

The merged `source_instance_id` is `psn_multi_provider_intake_v1_0001` — what
the merge is: one translation layer over several providers' exports. When a
selection combines providers, every accepted window carries it, including a
window only one provider covered, so a "January has two providers, February has
one" selection is not quarantined for mixing sources.

## Guarantees

- No fetch, storage, credential, clock, or randomness in this module.
- A **single-provider selection passes through untouched**, entry for entry, so
  adding this layer changed nothing for a reader importing one provider.
- Every emitted string names a provider, a code, a period, an export id, or a
  count. No cell value, no file name, no prompt text.
