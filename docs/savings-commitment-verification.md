# Savings commitment verification

`savings-commitment-verification/1.0.0`

**Question:** *Did the commitment we made actually land?*

`savings-commitment/1.0.0` proposes exactly one commitment out of one imported
month and states, in its own `downstream` block, that reconciling it against a
measured month is not implemented there. This contract is that step. It pairs a
commitment priced in month *N* against the visitor's own import of month *N+1*
and reports what was realized, how far that is from the plan, and the verdict
those two numbers support — or the reason there is no verdict.

Everything runs in the tab. No provider is contacted, no rate card is consulted,
no credential is read, no HRIS is joined, nothing is persisted, and no clock or
random source is touched. Two calls on the same pair return equal objects.

`docs/savings-commitment-verification.md` is checked against
`src/commitment-verification.js` by `tests/commitment-verification.test.js`, so
the two cannot drift apart.

## What it reads

Two inputs, and no others:

1. One commitment, exactly as `validateSavingsCommitment` accepted it. Its
   `provenance` is carried through unchanged and its baseline is never
   recomputed — the baseline is whatever the imported analysis said it was.
2. One later analysis envelope from the visitor's own import.

## The rules, and the assumption behind each one

Every rule below is also exported as data, on `VERIFICATION_METRIC_RULES`, so a
surface can print the assumption beside the number it produced.

| Rule | What it says | Assumption |
| --- | --- | --- |
| `pairing` | The observed period must be the calendar month directly after `commitment.baseline.period`. | Any later month folds in every other change made in between and credits them all to this one decision. |
| `observationScope` | The observation is the later import's row for the committed department and the committed **current-route** model, read from that unit's scored candidates and its excluded models alike. | Traffic below the routing rule's volume floor is still observed spend. Reading only the scored list would make a workload disappear at the moment it succeeded in getting smaller. |
| `identifierMatching` | Department and model are matched on canonicalized identifiers. More than one match on either is `ambiguous_observation`, and no row is selected. | Two raw identifiers that reduce to one canonical id are genuinely ambiguous. Selecting either would make the realized figure depend on row order in the exporter's file. |
| `realizedCost` | `realizedMonthlyCostMinor` is the observed month's spend on the committed current route only. | The commitment names a cheaper **tier**, not a target model, so no import can identify what the traffic moved to. This figure is an **upper bound** on net savings: spend that reappeared on a replacement model is not subtracted. |
| `realizedSavings` | `realizedMonthlySavingsMinor = baseline.monthlyCostMinor - realizedMonthlyCostMinor`, signed, never clamped at zero. | A route that got more expensive is a result worth reporting; clamping would render a regression as "saved nothing". |
| `variance` | `varianceMinor = realizedMonthlySavingsMinor - projectedMonthlySavingsMinor`, with the projected figure carried verbatim from the commitment. | The commitment's own projected saving is the plan of record. Re-deriving it would let a moved goalpost pass as a met one. |
| `attainment` | `attainmentPercent = round(realized * 100 / projected)`. | A ratio is a convenience for reading, never an input: every verdict is decided on the minor-unit figures, so rounding cannot move a verdict across a boundary. |
| `tolerance` | No tolerance band. The boundary between achieved and under-realized is exactly `varianceMinor = 0`. | Both sides are exact integers taken from imports, so there is no measurement noise for a band to absorb. Any band would be an unstated policy about how much of a miss is acceptable. |

Money is integer USD minor units end to end. Dollar fields are a rendering of the
minor units, never a second figure.

## Verdicts

| Verdict | Boundary |
| --- | --- |
| `achieved` | `varianceMinor >= 0` |
| `under_realized` | `realizedMonthlySavingsMinor > 0` and `varianceMinor < 0` |
| `not_realized` | `realizedMonthlySavingsMinor <= 0` |

## Unavailable is a state, not a zero

A variance of zero means "landed exactly on plan". Nothing below is reported as
zero; each is a code with an authored sentence.

| Reason | When |
| --- | --- |
| `no_commitment` | Nothing has been committed to yet. |
| `commitment_not_verifiable` | The commitment does not carry the baseline, route, and projected saving the check compares against. |
| `attribution_withheld` | The attribution policy already suppressed the observed month's money figure. |
| `no_observation` | No later month has been imported. |
| `observation_period_unreadable` | The later import's window is not one calendar month. |
| `observation_period_not_paired` | The later import is not the month directly after the baseline. |
| `department_not_observed` | No org unit in the later import matches the committed department. |
| `route_not_observed` | The department is observed but publishes no row for the committed model. An absent row is not evidence that its traffic cost nothing. |
| `ambiguous_observation` | More than one org unit or model row reduces to the committed identifier. |

An unavailable result carries `verdict`, `projected`, `realized`, and `variance`
as `null` and an empty `evidence` list, so no figure can be read out of a state
that has none — including any figure belonging to one of the colliding rows.

## More than one month

`savings-commitment-verification-series/1.0.0`

**Question:** *Did the savings we projected actually show up in the months we measured?*

`verifySustainedCommitment` checks one commitment against every later month the
visitor supplied. It is built from the per-month check above and adds no new
arithmetic about a month — only rules about which months count.

| Rule | What it says | Assumption |
| --- | --- | --- |
| `deduplication` | Observations are keyed by their own calendar month before anything is counted. Repeats of one month that agree on the realized figure count once; repeats that disagree count as no month at all. | The same month supplied twice is one month of evidence, not two. Counting copies would let opening one file twice turn a single anecdote into a verified saving. |
| `consecutiveMonths` | Counted months are the unbroken run starting at the month directly after the baseline. A gap, an unverifiable month, or a conflicting duplicate ends the run. | A run with a hole in it is not evidence that the saving held through the hole. |
| `sustainedTotals` | `realizedSavingsMinor` is the sum over counted months; `expectedSavingsMinor` is the commitment's projected monthly saving times `monthsCounted`. Every counted month is compared against the same baseline. | The baseline is the commitment's own and is never re-derived, so each month carries the same upper-bound caveat the per-month `realizedCost` rule states. |
| `verdictFloor` | A verdict needs at least two distinct counted months. Below that the result is `insufficient_evidence` and the months read are carried as provisional. | One month can be a holiday, a stalled batch, or a migration that was reverted. |

| Sustained verdict | Boundary |
| --- | --- |
| `verified` | Every counted month is `achieved`. |
| `partially_realized` | At least one counted month is `achieved` and at least one is not. |
| `not_realized` | No counted month is `achieved`. |

| Unavailable reason | When |
| --- | --- |
| `no_commitment` | Nothing has been committed to yet. |
| `commitment_not_verifiable` | The commitment carries no baseline, route, and projected saving to compare against. |
| `no_observation` | No later month was supplied. |
| `insufficient_evidence` | Fewer than `monthsRequired` distinct months were counted. |

Observations that were read but not counted are carried on `ignored`, each with
the reason it was set aside: `observation_period_unreadable`,
`conflicting_duplicate_observation`, `period_not_in_sequence`, or
`month_not_verifiable` (which carries the per-month reason on `monthReason`).
Repeated months are also reported on `duplicatePeriods` with their copy count, so
a surface can say plainly that a month was opened twice and counted once.

## Labelled fixtures

`tests/fixtures/commitment-verification/paired-periods.js` carries one labelled
case per outcome — achieved (over plan and exactly on plan), under-realized, not
realized, both missing-evidence unavailables, an unpaired window, no observation
at all, and both levels of canonical-id collision. Each case states the expected
realized figure, variance, attainment, and verdict, plus the assumption it exists
to defend.

The envelopes are built from `analyzeModelRouting` rather than committed as JSON,
so a change to the routing rule's published shape fails the fixtures instead of
leaving a stale file that agrees only with itself.
