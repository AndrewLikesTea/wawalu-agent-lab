# Partial evidence policy

`partial-evidence/1.1.0` — implemented in `src/partial-evidence.js`, rendered by
`src/partial-evidence-view.js` on the AI FinOps import panel.

## The question

> Given only the evidence I could import, what is the strongest finding I can
> defend, and what one thing would make it stronger?

Every other panel on that page is shaped for complete data. This one is shaped
for the first import, which is never of everything an organization pays for.

## The result is three slots, in this order

1. **One finding state.** `supported`, `partial`, or `insufficient_evidence`.
2. **Exactly one material figure** — a metric *or* a benchmark, never both and
   never zero.
3. **Exactly one prioritized next action.**

Exclusions, open review gaps, the arithmetic, and provenance labels are
progressive disclosure. They are carried in the result and shut on arrival.

## Metric definitions

A reviewer should be able to recompute every number below from the input alone.

**Admissible record.** An imported period record that clears every rule in
`EXCLUSION_ORDER`, applied in that order; the first rule a record fails is the
only reason reported for it.

| Rule | Excludes when |
| --- | --- |
| `unreadable_period` | `periodStart` or `periodEnd` is not a real ISO-8601 calendar date. `2026-02-29` is refused, never rolled into March. |
| `outside_required_period` | The record window is not inside the declared half-open `[start, end)`. |
| `incompatible_currency` | The record's currency is not the declared currency. No rate is obtained and none is invented. |
| `unreadable_amount` | `spendUsd` is not a finite number `>= 0`. A numeric *string* is not an amount. |
| `duplicate_export` | The record repeats a `source_instance_id` already counted. Different delivery IDs from one instance are duplicate imports; distinct instances remain eligible. |
| `sampled_rows` | The analyzed-row count is below the source-row count. The sample is not extrapolated into a whole-file aggregate. |

Exclusions the intake decided upstream are carried through unchanged under
`held_out_upstream` with the intake's own words.

**`observed_spend_usd`** (the metric). The sum of `spendUsd` over admissible
records, rounded half away from zero to two decimals. An excluded record
contributes *nothing* — not zero. Published whenever at least one record is
admissible.

**`partial`.** True when at least one record is admissible *and* something was
excluded or a review gap is open. A partial figure is a **floor**: the true
total is higher. It is stamped in words, not only in colour.

**`evidence_coverage`** (the benchmark). Admissible records ÷ records
considered, rounded to four decimals. It occupies the material slot only when
nothing is admissible, because a count of exports is a fact about the import and
not a claim about money.

**Finding state.**

- `insufficient_evidence` — no admissible record, or the declared window is not
  a real calendar period. No amount is published at all.
- `partial` — at least one admissible record, and `partial` is true.
- `supported` — at least one admissible record, nothing excluded, no open gap.

## The single next action

Priority order, first match wins. There is no scoring and no tie to break. The
order is "cheapest correction that changes the finding most", not "worst number
first".

1. `select_provider_export` — nothing has been imported.
2. `correct_impossible_dates` — a record declares a day that does not exist, so
   every figure from that export is unsafe.
3. `resolve_review_gaps` — the total can still move.
4. `recover_excluded_evidence` — re-exporting held-out evidence is the one
   change that raises the floor.
5. `attribute_unassigned_spend` — below `ATTRIBUTION_FLOOR` (0.8) of dollars
   joined to an org unit, naming a department is a guess with a rank on it.
6. `record_the_decision` — nothing is missing; the next move is a logged
   decision, not another export.

## Eligibility score

This is an evidence-eligibility score, never a team-performance score. Its five
earned weights are included in every result so the number can be recomputed:

| Dimension | Weight | Assumption |
| --- | ---: | --- |
| Aligned billing window | 25 | A temporal mismatch is the easiest way to create a false total. |
| USD currency | 20 | The browser has no reproducible exchange-rate source. |
| Unique source instance | 20 | One source instance may contribute once. |
| Complete row coverage | 20 | A bounded sample cannot represent a whole-file sum. |
| Org mapping | 15 | Mapping controls department actions, not provider spend. |

The aggregate threshold is 85/100: all four aggregate dimensions must pass.
Missing org mapping therefore preserves observed provider spend but suppresses
department ranking. Any excluded export also makes the aggregate ineligible,
regardless of score. This conservative override prevents one dimension from
compensating for unsupported evidence in another.

## What this policy never does

- **It never measures a peer comparison.** The caller passes availability only,
  and the result is always *not measured*. There is no code path here that can
  produce a percentile, cohort figure, or benchmark-dependent score.
- **It never repairs input.** An impossible date, a foreign currency, or an
  unreadable amount excludes the record and names it.
- **It never publishes an unlabelled total.**
- **It holds no source material.** A record contributes an id, a label, a
  window, a currency code, an amount, and a provenance *label*. Prompt text,
  account identifiers, and file bytes have no field to arrive in.

## Determinism

No clock, no network, no storage, no randomness. Identical input yields a
byte-identical result, which is what makes a disagreement about the finding a
disagreement about the rules above.
