# Import-side cohort attribution contract

Version: `import-cohort-attribution/1.1.0` (`src/cohort-attribution.js`)

A FinOps lead wants to know where their organization stands against
organizations like theirs. Selecting a cohort takes two attributes — an
organization size band and an industry — and no provider or HRIS export in the
v1 dialect contracts carries either. So the reader declares them in their own
file, and this contract decides whether what they declared is enough to select a
cohort, or says which value is absent or unaccepted and what to write instead.

Nothing identifying is needed to answer that question, and nothing identifying
is read. There is no connector, no credential, and no request: the cohorts are
bundled with the page and the decision runs in the tab.

## What a reader declares

Two columns, on a usage export or on a roster:

| Column | Accepted values | Aliases accepted for the column name |
| --- | --- | --- |
| `org_size_band` | `focused`, `scaling`, `enterprise` | `organization_size_band`, `size_band` |
| `industry` | `saas`, `financial_services` | `industry_key`, `sector` |

That accepted-values column is not prose maintained by hand. `ORG_SIZE_BAND_OPTIONS`
and `INDUSTRY_OPTIONS` are derived from the same enumeration, the declaration
control offers exactly those options, and
`tests/cohort-attribution.test.js` reads the table above back out of this file
and asserts it equals the enumeration — so the doc, the control and the contract
cannot drift into three different ideas of what is accepted.

Column names are matched by shape rather than by spelling: `Org Size Band`,
`org-size-band` and `ORG_SIZE_BAND` are one column. Values are matched the same
way, and each band and industry publishes aliases (`1-4`, `mid-market`,
`software`, `finance`, …).

**A declaration may sit on the first data row or repeat on every usage row.**
Both shapes resolve identically, and so does the shape in between: the first
non-empty value across the projected rows wins per attribute, so an export whose
first data row leaves the columns empty and whose later rows carry them still
declares them. Across several selected files, the first source in selection
order wins per attribute.

The bands are the peer cohort selector's own boundaries, restated as declared
values:

| Band | Attributed org units |
| --- | --- |
| `focused` | 1–4 |
| `scaling` | 5–14 |
| `enterprise` | 15 or more |

The declared band is a claim, not the measurement. Cohort selection uses the
count of attributed org units the export itself carries; a declared band that
does not contain that count is reported (`ORG_SIZE_BAND_MISMATCH`) rather than
trusted, and rather than silently corrected.

## Who declared it

An attribute reaches this contract two ways, and they are not the same fact.

| `COHORT_FACT_SOURCE` | What it means |
| --- | --- |
| `file-derived` | a column in the reader's own export or roster carried it |
| `reader-declared` | the reader chose it in the tab, because no column carried it |

The discriminator is carried, not inferred. It travels per attribute
(`position.orgSizeBandSource`, `position.industrySource`), as one value for the
placement (`position.source`, with `position.sourceLabel` in words), and on the
result's note (`note.positionSource`). Every surface that shows a position reads
it: the ranked-position panel prints `position source: …` on its detail line,
and the headline's anonymization disclosure carries a `Position source` entry. A
reader-declared position is never presented as file-derived.

A placement takes the reader's label as soon as **either** half does. A cohort
selected from one column and one value typed in the tab is not a placement the
export supports, and labelling it file-derived because the other half was in a
column is the mislabelling this discriminator exists to prevent.

### What the reader may declare, and when they are asked

The control is offered on exactly two states — `MISSING_ORG_SIZE_BAND` and
`MISSING_INDUSTRY` — and on no others. An import that supplies both attributes
never constructs it. `UNRECOGNIZED_*` is deliberately not among them: a value
the file wrote is answered by fixing the file, not by overruling it from the
page. Consistently, **the reader fills silence, never contradiction**: a
declared value is consulted only where the file left the column empty.

`validateDeclaredCohortFacts({ orgSizeBand, industry })` is the whole refusal
rule. A value this contract does not publish — free text included — is refused
with a message that quotes it back and names every accepted value. The rule
lives in the contract rather than in the control because a browser's own select
refuses a value that is not one of its options and a test double for one does
not, so a control-level test cannot prove the refusal;
`tests/cohort-attribution.test.js` calls the function directly with free text
instead.

On an accepted submission the position is recomputed from the projected sources
already in memory and the analysis already on screen. **No file is re-read and
nothing is re-imported** — this page holds a reader's bytes for the length of
the tab and no longer.

### Where declared values live

In the page's own session state, beside the projected imports, for the lifetime
of the tab. Nothing writes them to `localStorage`, `sessionStorage` or IndexedDB,
and nothing transmits them: there is no connector, no credential and no request
on this path. Clearing the import drops them, and so does "Forget this
briefing", because that control runs the same reset — a declaration is a
statement about the import that was open, and carrying it into the next one
would place a different export against a cohort nobody chose for it.

## What is read, and what is not

Two projections, both fixed allowlists, both applied before anything is counted:

| Source | Fields copied out |
| --- | --- |
| roster | `department_key`, `unit_type`, `active` |
| usage row | `department_key`, `org_size_band`, `industry` |

The allowlist is applied by copying the named fields out, not by deleting the
rest, so a column nobody anticipated is dropped by default. A real HRIS roster
carries full names, work emails, job titles and manager identifiers in the same
file; none of them reach this module's output. Amounts are not read at all —
this contract counts units, it does not measure money.

A source is a **roster** when it carries a `unit_type` column, and only then. A
bare `type` column is read as a unit type *inside* a roster, but it never
classifies a file: a usage export carrying a billing-line `type` column is a
usage export.

An org unit is counted when at least one usage row carries it and the roster —
if one was selected — does not mark it inactive or as an external unit type
(`contractor`, `vendor`, `external`, `agency`, `partner`). Units are counted
over normalized keys, so `atlas-platform` in a provider export and
`Atlas Platform` in a roster are one unit. Units with no roster entry are
counted and reported as `unmappedUnits`; a missing roster never blocks a
position.

## Published reasons

A withheld position always carries a code, a sentence, and one next step.

| Code | When |
| --- | --- |
| `NO_VALID_ROWS` | no row carries an org unit |
| `NO_ACTIVE_ORG_UNITS` | every unit is inactive or an external unit type |
| `MISSING_ORG_SIZE_BAND` | no `org_size_band` value anywhere in the selection |
| `UNRECOGNIZED_ORG_SIZE_BAND` | a band was declared that this contract does not publish |
| `MISSING_INDUSTRY` | no `industry` value anywhere in the selection |
| `UNRECOGNIZED_INDUSTRY` | an industry was declared that this contract does not publish |
| `ORG_SIZE_BAND_MISMATCH` | the declared band does not contain the counted units |
| `NO_PUBLISHED_COHORT` | no cohort covers this size and industry |

`MISSING_*` and `UNRECOGNIZED_*` are deliberately separate: one tells the reader
to add a column, the other quotes their own value back and tells them which
values are accepted. Reporting an unaccepted value as a missing column instructs
the reader to add a column their file already contains.

## Staleness and reproducibility

`asOf` is supplied by the caller — the analysed period's own end on
`evolution.html` — and recorded on the result's note. Nothing here reads a
clock, so the same files produce the same answer on any day.

## Boundary

`projectCohortSource` (one file) → `mergeCohortSources` (one selection) →
`validateCohortAttribution` (one decision). The declaration travels through it
raw, keyed by accepted field names, so validation resolves it exactly as it
resolves a row; the resolved shape is an output and is never fed back in.
Reader-declared facts join at the last step only, as
`validateCohortAttribution({ …, readerDeclared })`, already resolved by
`validateDeclaredCohortFacts`. They are never folded into a projected source: a
projection describes a file, and a value nobody's file contains has no business
appearing inside one.

`tests/cohort-attribution.test.js` drives fixtures through that whole boundary,
and `tests/cohort-position-surface.test.js` drives it through the shipped page —
including the control being absent on a cohort-complete import, the placement
labelled reader-declared at the surface, and the forget control taking the
declared values with it.
