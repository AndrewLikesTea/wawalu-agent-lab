# Native grouping contract, v1.0.0

Which column in a provider's own export already says "this spend belongs to that
team", and why that column beat the others. This document is the consumer's
reference: an implementer should be able to read it and use the result without
opening the detector.

- Producer: `src/native-grouping.js` (`detectNativeGrouping`)
- Declarative data: `src/dialect-profiles.js` (`groupingCandidates`,
  `GROUPING_UNIT_PRECEDENCE`)
- Consumers: `src/finops-tabular-import.js` (attribution),
  `src/import-column-mapping.js` and `src/import-mapping-view.js` (review step)
- Pseudonymization: `src/unit-pseudonym.js` — the one helper, shared
- Executable cases: `tests/native-grouping.test.js`
- Vendor fixtures: `contracts/integrations/tabular-dialects/v1/fixtures/`

## An org file is not required

A provider export is already grouped by something the provider bills by. The
HRIS org file is **optional enrichment** that maps a grouping unit to a
department name. Dropping a provider export with a detectable native grouping
column succeeds with no org file present, and the analysis attributes spend
under the export's own labels. Nothing in the import surface reports an absent
org mapping as unresolved.

## Precedence

One ranked list, `GROUPING_UNIT_PRECEDENCE`, used by every dialect so a tie
resolves identically whatever the vendor. Index 0 wins. Column order in the file
is never consulted: candidates are matched by name and sorted by this list.

| rank | unit | why it sits here |
| --- | --- | --- |
| 1 | `tag` | A cost-allocation tag is the only unit the customer authored *for chargeback*. If a `CostCenter` tag is on the rows, finance already decided that is the attribution key, and no inference beats a decision. |
| 2 | `project` | The project a team owns, and the default team boundary in every AI provider console. Named by humans, stable. |
| 3 | `workspace` | The same tier of meaning as `project` under another vendor's spelling. Ranked below it only so the order is total; no shipped dialect carries both. |
| 4 | `resource_group` | Team-shaped, but an infrastructure artifact: one team often owns several, and platform groups are shared. |
| 5 | `api_key` | Narrower than a project and *less* recognizable. A key alias names an application, keys rotate, and many are unnamed. Specificity alone does not make `sk-prod-billing-svc` a team. |
| 6 | `account` | Linked or usage account. Coarsest, frequently one per company, so it attributes everything to one unit and answers nothing. |

The criterion is *the most specific attribution unit a finance lead would
recognize as "a team's spend"* — specific **and** recognizable, which is why this
is not simply "narrowest first".

A profile may declare `groupingPrecedence` to override the order where a
dialect's semantics genuinely differ. The override lives in the profile; the
detector carries no per-vendor branch. No shipped profile currently overrides.

## Candidate columns per dialect

Declared as data on each profile. Case, separator style, and camelCase are
folded by `normalizeColumnName`, so `ResourceGroup`, `resource_group`, and
`RESOURCE GROUP` are one entry.

| profile | candidates (unit → primary header) |
| --- | --- |
| `openai-usage-export` | project → `project`; api_key → `api_key_name` |
| `anthropic-usage-export` | workspace → `workspace`; api_key → `api_key` |
| `aws-cost-and-usage-report` | tag → `resourceTags/user:CostCenter`; account → `line_item_usage_account_id` |
| `azure-cost-management-export` | tag → `CostCenter`; resource_group → `ResourceGroup`; account → `SubscriptionId` |
| `google-cloud-billing-export` | tag → `labels.team`; project → `project.id`; account → `billing_account_id` |
| `generic-hris-roster` | none — a roster is the enrichment side and groups nothing |

## The return shape

`detectNativeGrouping(table)` always returns a whole result and never throws.
`NATIVE_GROUPING_VERSION` is `native-grouping/1.0.0`.

| field | type | stability |
| --- | --- | --- |
| `version` | `string` | The contract version. Minor bump = field added; major = field changed meaning. |
| `status` | `"native" \| "none" \| "unidentified"` | Closed set. Switch on it exhaustively. |
| `dialect` | `{id, label, version, kind, confidence} \| null` | `null` when unidentified. |
| `column` | `{header, index, normalized} \| null` | `header` is the source header **verbatim**, padding included. Non-null exactly when `status` is `"native"`. |
| `unit` | grouping-unit kind \| `null` | A member of `PROVIDER_GROUPING_UNITS`. |
| `precedence.order` | `string[]` | The ranking actually applied. |
| `precedence.source` | `"global" \| "profile"` | Whether a profile override was used. |
| `precedence.rank` | `number \| null` | Index of the chosen unit in `order`. |
| `precedence.code` | `"sole_candidate" \| "outranked_others" \| "no_candidate"` | Machine-readable reason. |
| `precedence.beat` | `string[]` | Units that were present, usable, and lost. |
| `precedence.text` | `string` | Prose. **Never switch on it**; it may be reworded freely. |
| `units.distinct` | `number` | Distinct grouping units found. |
| `units.labels` | `string[]` | Pseudonyms (`psn_unit_*`), sorted. Never the customer's strings. |
| `rows.total` / `rows.grouped` / `rows.ungrouped` | `number` | Data rows read, rows with a value, rows with none. |
| `candidates[]` | see below | Every candidate considered, chosen and rejected. |
| `gradingState` | `string` | A state imported from `src/grade-eligibility.js`, not restated here. |
| `enrichment` | object | See *Enrichment* below. |
| `text` | `string` | One renderable sentence. Prose; not switched on. |

Each `candidates[]` entry carries `unit`, `rank`, `header`, `index`, `status`
(`"chosen" | "rejected"`), `code`, `valueRows`, `blankRows`, and `text`.
Rejection codes (`CANDIDATE_REJECTIONS`) are stable:

- `column_absent` — no column under any accepted spelling.
- `column_empty` — present, but every cell blank. Not a grouping column; the
  next candidate is tried.
- `outranked` — usable, but a higher-precedence candidate is also usable.

`assertNativeGrouping(value)` is the runtime shape check.

## Defensive behaviour

| input | outcome |
| --- | --- |
| Candidate present, entirely empty | Rejected `column_empty`; fall through to the next candidate. |
| Candidate present, some blanks | Chosen. Blank rows counted on `rows.ungrouped` and reported — never dropped, never pooled into an invented "Unassigned" unit. |
| No candidate at all | `status: "none"` with a renderable sentence. Not a throw, and not a "missing org file" message. |
| Duplicate / renamed / padded / case-shifted headers | Normalized before matching; the leftmost copy of a repeated header wins. |
| Reordered columns | Irrelevant by construction — ranking is over declared profile data. |
| Unmatched file | `status: "unidentified"`, `unit: null`, no candidates. |

## Enrichment

`applyGroupingEnrichment(grouping, rows)` takes `{unit, department}[]`, where
`unit` is the provider-native label. It is pseudonymized with the same helper the
export went through, so the two sides join without either raw string being
retained. Statuses (`ENRICHMENT_CODES`):

- `enrichment_absent` — none supplied. Native labels stand.
- `enrichment_complete` — every unit mapped, no unknown rows.
- `enrichment_partial` — some units unmapped, or some rows named unknown units.
  Unmapped units keep their native label and are listed on `unmapped`. Unknown
  rows are listed on `unknown` with `enrichment_unknown_unit`. Neither is fatal.
- `enrichment_malformed` — the file is not a list of `{unit, department}` rows.
  `applied` is `false` and the native grouping is returned untouched: a bad org
  file never costs the drop.

A repeated unit is deterministic — the first row wins — and the duplicate is
reported as a problem rather than silently overwriting.

## Privacy

A grouping label is a customer-chosen project or key name. Every label this
contract publishes has been through `orgUnitPseudonym`, the same helper the
shipped delimited importer uses, imported rather than reimplemented — there is
exactly one `psn_unit_*` digest in this repository. No raw grouping label is
persisted, logged, or placed in an exported artifact; `tests/native-grouping.test.js`
asserts this for the native-grouping path specifically, by scanning every string
on the result and in the produced envelope.

Headers are published verbatim, because the column-review step already shows the
reader their own header row. Cell values never are.

No I/O of any kind: no fetch, no storage, no credential, no network.
