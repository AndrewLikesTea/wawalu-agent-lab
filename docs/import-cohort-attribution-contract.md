# Import-side cohort attribution contract

Version: `import-cohort-attribution/1.0.0` (`src/cohort-attribution.js`)

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
`tests/cohort-attribution.test.js` drives fixtures through that whole boundary,
and `tests/cohort-position-surface.test.js` drives it through the shipped page.
