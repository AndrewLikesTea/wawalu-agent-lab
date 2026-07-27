# Conversation-export import contract

Status: **Anya-approved contract, version 1.0, 2026-07-27**. Approval covers the
four dialect profiles, the fixtures, the never-render rule, and the processing
rules in this document. It does not approve a vendor API client, a credential, a
live admin connection, or a production data transfer. Every byte this contract
reads comes from a file the visitor picked themselves, in their own browser tab.

- Kind: `wawalu.integration.conversation-export`
- Version: `1.0` (bumped independently of a dialect profile version)
- Profiles: `CONVERSATION_DIALECT_PROFILES` in `src/dialect-profiles.js`
- Reader: `src/conversation-export.js`
- Examples: `src/conversation-export-example.js` → `contracts/integrations/conversation-export/v1/fixtures/`
- Tests: `tests/conversation-export-contract.test.js`

It is a sibling of the [query-sample import
contract](query-sample-import-contract.md) and of the [privacy-preserving
integration contracts](privacy-preserving-integration-contracts.md); everything
those say about local-only processing, refused columns, and out-of-scope data
applies here unless this document states otherwise.

## Why it exists

A billing export says what a department spent. A roster says who is in it.
Neither says how the assistant was actually used, so nothing in the product can
tell a heavy department from a wasteful one. An admin conversation or audit
export is the missing input — and it is also the most sensitive file this product
has ever been pointed at, because it carries the text people typed.

So the contract is written the other way round from the usual one: instead of
asking what we may read, it starts from what may never leave the parser.

## The dialects

Four vendor-shaped profiles, all `kind: "conversation"`, all detected by the same
header-sniffing path (`detectDialect`) the usage and roster dialects use. The
file name is never consulted.

| Dialect id | Shape it reads |
| --- | --- |
| `chatgpt-enterprise-conversation-export` | ChatGPT-Enterprise-style admin conversation export |
| `claude-enterprise-conversation-export` | Claude-style organization conversation export |
| `copilot-conversation-export` | Copilot-style interaction export |
| `workspace-audit-conversation-export` | Workspace-style assistant audit export |

They live in `CONVERSATION_DIALECT_PROFILES`, a registry beside
`DIALECT_PROFILES` rather than inside it. That is a contract statement, not
filing: the billing fixtures are asserted to carry no content-bearing column at
all, and a conversation export is defined by carrying one. `ALL_DIALECT_PROFILES`
is the union a surface that accepts both families detects against, so nothing
about how a usage or roster file is recognized changes.

**Tie-breaking, stated.** No two conversation profiles share a required column
name, and each names the others' identifier columns in `match.forbidden`, so a
file shaped like two vendors at once is excluded from both. Beyond that, the
existing rule is unchanged and unweakened: every candidate is scored, the
best-confidence candidate wins, and an exact tie is `unidentified` rather than
resolved by declaration order. An unrecognized file is never an error — it comes
back with its columns and rows for the existing manual-mapping flow.

## Fields

Per row, in each profile:

| Field | Required | Coercion | Note |
| --- | --- | --- | --- |
| `conversation_id` | yes | `string` | The vendor's turn, thread, interaction, or event identifier. |
| `actor_id` | yes | `emailAddress` | The vendor-native actor. Pseudonymization is a downstream step, deliberately not this layer's job. |
| `occurred_at` | yes | `instant` | ISO 8601, with or without a clock, with or without a zone (absent means UTC). Normalized to `YYYY-MM-DDTHH:MM:SSZ`. |
| `department` | no | `string` | Vendor group, cost centre, or org unit. See the degradation rule below. |
| `prompt_signals` | yes | `promptSignals` | The prompt/message body column. **Never rendered.** See below. |

Each profile additionally declares signal-only columns (role/sender, model,
application) that vote in detection and are never emitted.

**The profile version field.** Every profile carries `version` (integer, from 1)
and one `changelog` entry per version. A bump means *the meaning of a mapping
changed* — a column now maps to a different field, a coercion changed what it
accepts or produces, or a required column became optional. Adding an accepted
alias for a header that already meant the same thing is not a bump. A shipped
mapping is never silently mutated, because a stored mapping from an earlier
import would then mean something else. `CONVERSATION_CONTRACT_VERSION` (`1.0`) is
separate and covers the record shape itself.

## The never-render rule

In plain language, for forwarding:

> A conversation export is read in the reader's own browser tab so it can be
> measured. The prompt text is counted — how many characters, roughly how many
> tokens — and the counts are all that survive. The text itself is never drawn on
> the page, never written into an export file, never put in browser storage, and
> never sent anywhere. It is not shown back to the reader even once, not even as
> a sample value in the mapping step, and not even inside an error message about
> the row it is on.

Enforced, not merely stated:

- The prompt column declares `sensitivity: "never-render"` — the one flag name,
  used consistently — and is mapped through `promptSignals`, a coercion that
  returns `{ chars, token_estimate, empty }` and never the text.
  `assertProfileRegistry` refuses either half without the other: a never-render
  column must use a deriving coercion, and a deriving coercion may be used
  nowhere else. Downstream code asks the schema (`neverRenderColumns`) which
  column is sensitive; it never matches a header spelling of its own.
- A parsed record is **built** from `CONVERSATION_RECORD_KEYS`, never copied from
  a row and pruned. There is no key a message body could survive in.
- `conversationExportPayload` (JSON) and `conversationExportCsv` build from the
  same allowlist, so an internal field added later cannot ride out into an export.
- `assertNeverRenderClean` is the executable form: every value derived from a
  never-render column is a number or a boolean.
- Row issues name the row by index, by 1-based row number, and by the row's own
  `conversation_id`. No message is ever built from a cell value — including, and
  especially, when the field that failed sits on a row that carries a prompt.

**Derived signals exposed instead.** `prompt_chars` (trimmed character count),
`prompt_token_estimate` (a declared four-characters-per-token approximation, not
a tokenizer and not a provider's own count), and `prompt_empty`. Per department:
conversation count and the sums of both counts. These are the inputs a future
classifier gets; if it needs more, the addition is a contract change reviewed
here, not a field someone reads off the row.

## Partial, stale, malformed, reordered

Every case below is asserted in `tests/conversation-export-contract.test.js`.

| Situation | Behaviour |
| --- | --- |
| Missing optional department column | **Import proceeds.** Every row lands in one `(ungrouped)` bucket, `grouped` is `false`, and the summary says so. An empty department cell degrades identically, because a reader cannot tell the two apart from the result. |
| Missing a required column | The file is **not detected as that dialect**. It falls through to `unrecognized`, carrying its columns and rows to the existing manual-mapping flow. It is never forced onto a half-matching profile and never an error. |
| Malformed or unparseable timestamp | The **row is skipped and counted**: one entry in `skipped` with code `invalid_timestamp`, the row number, and the row's identifier. Never silently dropped, never fatal to the file. The remaining rows import. |
| Rows out of chronological order | **Accepted.** Ordering is derived from the timestamps, so `span` is identical whatever the row order. `outOfOrderRowCount` reports the shuffle because a shuffled file is usually an unintended concatenation; it changes nothing. |
| Empty prompt cell | **Valid row.** Derived signals are `0`, `0`, `empty: true`. A blank message is a fact about the export, not a broken row. |
| Empty required non-prompt cell | Row skipped and counted, code `missing_required_value`. |
| Unknown extra column | Ignored. It votes in nothing and is never emitted. |
| Stale or re-delivered file | Out of scope at this layer: a conversation export is a stream of events with no delivery envelope, so there is no sequence to compare. Freshness is the reader's own file-picking decision, as it is for every other local import on this page. |

## Error codes

Stable; downstream switches on the code and never string-matches a message.

Row-level: `missing_required_value`, `invalid_timestamp`, `invalid_value`.

File-level: an unrecognized file carries `status: "unrecognized"` and the
detector's own `reason` (which names columns and profiles, never cell values).

## The examples

`Download an example conversation export` on the import panel of
`/evolution.html` offers one file per dialect through the same local blob
download every other artifact on that page uses. Nothing is uploaded, and
nothing is imported: no surface in this repository consumes a conversation export
yet, so what ships is the contract, its reader, its fixtures, and the examples.

The examples are generated by `src/conversation-export-example.js` from one
executable source, and the committed fixtures under
`contracts/integrations/conversation-export/v1/fixtures/` are those exact bytes —
asserted, so the shipped file, the download, and the parser cannot drift. Every
organisation, identifier, address, and sentence in them is invented; the
addresses are in the reserved `.invalid` domain.
