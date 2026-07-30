# Spend-per-delivery contract (`spend-per-delivery/1.0.0`)

The question, and the only one this metric answers:

> **Is local AI spend keeping pace with shipped delivery, and can I trust this
> comparison?**

`src/spend-per-delivery.js` is the authority; this file is the same rules in prose
for a reader who is not reading code. `SPEND_PER_DELIVERY_RULES` in that module
carries each rule below verbatim, and a test pins the two together.

## What the figure is, and is not

The figure is an **observational ratio**: USD of recorded local AI spend divided by
releases recorded as completed in the same window. Both sides are counts of things
that were *recorded* — dollars a provider export billed, releases a person wrote
down.

Nothing in this contract establishes that the spend produced the releases, that a
release is a unit of value, or that a lower ratio is better. So no consumer may
present it as return on investment, payback, productivity, efficiency, or output
per dollar. `FRAMING.forbiddenClaims` lists those words and a test asserts that no
string the contract or its view produces contains any of them.

Out of scope on purpose: peer or industry benchmarks (no imported local contract
carries a cohort, so the only honest baseline is the reader's own history);
forecasts; targets; currency conversion; per-person attribution; release size,
scope or quality; and any claim of realized saving.

## The window

A spend period is the half-open interval `[periodStart, periodEnd)` — start
inclusive, end exclusive, both `YYYY-MM-DD` in UTC. This is already the
provider-export contract's interval: `local-finops.js` excludes a `usage_date >=
period_end`. No boundary day is counted twice and none is dropped. Period length in
days is `periodEnd - periodStart` and must be a positive whole number.

Periods sort ascending by `periodStart`, then `periodEnd`, then `exportId`, which
makes the order total. **The headline is the most recent period**, never a pooled
figure across periods: a mean over windows of different lengths is not the number a
leader is asking about this month.

## Numerator and denominator

* **Numerator** — `spendUsd` of the headline period as the analysis reported it,
  rounded half away from zero to 2 decimals and bounded by the briefing's supported
  1 trillion USD display ceiling. Nothing is re-derived from line items.
* **Denominator** — releases whose completion instant falls in
  `[periodStart, periodEnd)`. Only releases recorded as `completed` count: planned
  and cancelled releases are not delivery evidence, and a stored release with **no**
  declared status is not counted either. The release list treats a missing status as
  completed so it has something to show; that is a display convenience, not a record
  that the work shipped. A release whose completion date cannot be parsed is
  excluded and counted, never silently dropped.
* **Ratio** — numerator ÷ denominator, rounded half away from zero to 2 decimals.
  Published only in the eligible state; every other state publishes `null`, never
  `0`.

## The three publishable states

Checked in this exact order, first match wins:

| # | Condition | State | Reason code |
|---|---|---|---|
| 1 | No spend period, or headline spend not finite and positive | `insufficient_data` | `no_local_spend` |
| 2 | Headline spend exceeds the briefing's 1 trillion USD display ceiling | `insufficient_data` | `implausible_local_spend` |
| 3 | No completed release recorded at all | `insufficient_data` | `no_delivery_evidence` |
| 4 | Spend periods overlap | `mismatched_period` | `overlapping_spend_periods` |
| 5 | A gap between consecutive spend periods | `mismatched_period` | `non_contiguous_spend_periods` |
| 6 | No delivery inside the full spend window | `mismatched_period` | `no_delivery_in_spend_window` |
| 7 | Headline period shorter than 14 days | `insufficient_data` | `short_spend_period` |
| 8 | Fewer than 3 deliveries in the headline period | `insufficient_data` | `too_few_deliveries_in_period` |
| — | otherwise | `eligible` | `null` |

Order matters. A window that cannot be aligned is reported as a mismatch even when
it is also too short, because re-exporting a longer period does not fix an
unalignable one.

`absent` is a fourth state and not a reading: it means nothing has been read in this
tab yet, and the surface stays as it was.

### Minimum-data floors

Three deliveries, because a per-release mean over one or two releases describes
those releases and not a period. Fourteen days, because a shorter window cannot
contain a fortnightly cadence and would move by a large factor on the timing of one
merge.

## Benchmark and how to read it

The baseline is **the reader's own trailing history**, because no imported local
contract carries a peer cohort to compare against.

It is the mean of the per-period ratios of every period before the headline that
clears the same floor as the headline (positive spend, ≥ 14 days, ≥ 3 deliveries),
rounded half away from zero to 2 decimals. Mean of per-period ratios, not pooled
spend over pooled deliveries: each period gets one vote, so one unusually large
month cannot dominate the baseline and the baseline does not shift when a period's
length changes. A period that fails the floor is excluded and counted in
`baselineExcludedPeriods` — never counted as zero. Fewer than **2** qualifying
periods leaves the comparison unavailable with `insufficient_baseline_periods`.

`deltaUsd` is headline ratio − baseline (2 dp). `deltaPercent` is
`deltaUsd / baseline × 100` (1 dp, half away from zero, so a rise and a fall of the
same size round identically). `direction` is read off the **rounded** percentage, so
the word and the number can never disagree. A zero baseline yields
`zero_baseline_ratio` and a null percentage.

`higher` means spend per recorded release rose. It does not mean the team slowed
down, and no direction is labelled good or bad.

## Confidence

Exactly one of `none` / `low` / `medium` / `high`, first match wins:

* `none` — the state is not eligible. Nothing was published to be confident about.
* `low` — a required local provenance field is missing, so part of the basis was
  never checked.
* `medium` — a contributing period declares completeness other than `complete`, or
  there is no trailing baseline yet.
* `high` — complete local records over one aligned window, compared against the
  reader's own earlier periods.

Confidence describes the comparison, not the size of the number.

## Provenance

Required fields: `provider_export.snapshot.period_start`,
`provider_export.snapshot.period_end`, `provider_export.cost.amount_minor`,
`shiplog.release.created_at`, `shiplog.release.status`. Fields are declared from
what was actually found, never asserted, so a missing side lowers confidence
instead of being invisible. Origin is recorded (`example` or `import`) and the
delivery side is always named, because a reader has to know whose release log
produced the denominator.

## Confounders, always rendered

`CONFOUNDERS` lists the six reasons the ratio moves with no change in how much was
delivered: a release is an event and not a quantity of work; the log is written by
hand and unrecorded releases raise the ratio; spend includes work that never
shipped and releases include work with no AI spend; provider prices and model mix
move the numerator alone; team size and non-AI tooling are not held constant; and
release cadence is a policy choice, so batching raises the ratio on its own.

## Locality

No fetch, storage, clock, randomness, or credential path. Inputs are values already
parsed in the tab; outputs are frozen. The module is pure, so the same inputs always
produce the same record — which is why it carries no `generatedAt` stamp.
