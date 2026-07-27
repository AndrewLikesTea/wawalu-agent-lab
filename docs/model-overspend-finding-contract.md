# Model-overspend finding contract

`model-overspend-finding/1.0.0` — the contract between the per-model analysis
result and the panel that renders it. Code: `src/model-overspend-finding.js`.
Fixture: `src/model-overspend-finding-fixture.json`. Tests:
`tests/model-overspend-finding.test.js`.

## The one question

> In the reporting month, where am I paying for a model that a cheaper tier one
> of my own teams already runs would have handled, and how much is that worth?

A leader gets one answer: one headline, one number, one action, a derived
confidence, and the provenance of their own columns behind it. The per-model
table is `evidence`, marked `disclosure: "progressive"` — what they open second,
never what they are shown first.

The contract deliberately does not answer: whether a cheaper model is *as good*
(no usage export can establish that), how spend is trending, what peers pay, or
how any of this is laid out.

## Metric definitions

Two engineers must compute the same number. Money is integer USD minor units
throughout; the only division happens where stated.

**Denominator — requests.** Not tokens, not sessions, not invoice line items.
Every rate in this contract is spend per *request*, for one model, in one
segment, in one calendar month. A file with no request column has no
denominator, and therefore no rate and no metric.

**Period normalization — calendar month.** A month observed for fewer days than
it contains is prorated: `normalized = round(observed × daysInPeriod /
observedDays)`, applied identically to spend and to requests, so proration
changes the size of the month and never the rate. Every prorated month is listed
in `provenance.proration.months`; an unprorated month records `prorated: false`.

**Observed rate.** A model's rate in a period is its own observed cost per
request *in this file*: normalized spend pooled over every segment clearing the
request floor, divided by those segments' normalized requests. There is no
vendor rate card here. This repository ships none and reaches none.

**Candidate cheaper tier.** Among models in the same period clearing eligibility
whose observed cost per request is strictly lower than the named model's, the
one with the **highest** such rate — the nearest cheaper tier, not the cheapest
in the file, which would inflate the saving. Ties break on model identifier
ascending, so the winner does not depend on row order.

**Downgrade-eligible volume.** A segment's requests on model M in period P are
downgrade-eligible when, in that same segment and that same period, the file
shows at least `MIN_REQUESTS_PER_MODEL_PERIOD` requests already served by
candidate model C. The evidence is the customer's own traffic: this team
demonstrably runs C at production volume. Eligibility is all-or-nothing per
(model, segment, period), because an aggregated row carries no per-request
detail to split on. **This is a claim of routing candidacy for review, not of
quality equivalence.** The action text says so to the reader.

**Estimated monthly overspend** (the one headline metric):

```
projectedSpendMinor = round(eligibleRequests × candidateSpendMinor / candidateRequests)
amountMinor         = observedSpendMinor − projectedSpendMinor
```

Reported only when positive. A non-positive result means there is nothing to
move, and is reported as that sentence — never as a saving of zero.
`metric.formula` carries the arithmetic with the actual numbers substituted.

## Benchmark honesty

A single customer's export contains one customer. It supports **self-comparison
across that customer's own segments and periods, and nothing else.**

It does not support a peer benchmark, an industry median, a percentile, or a
cohort. The contract therefore has exactly one benchmark field, scoped
`intra_tenant`: the named segment's cost per request on the named model against
the pooled cost per request of this file's *other* segments on the same model in
the same month. `validateModelOverspendFinding` allowlists the benchmark's keys
and rejects any key at any depth in the payload matching
`peer|industry|market|competitor|percentile|cohort`. If a future version needs
such a number it needs a second data source first, not a new field.

## Eligibility rule

`evaluateEligibility()` is the executable form. Each claim is gated
independently, and a gate that fails yields a reason string for the UI to
display — never a silently omitted or zeroed field.

| Claim | Requires |
| --- | --- |
| Overspend metric | recognized model identifier; known request count; ≥ 1000 requests on the model; a candidate cheaper tier in the same month; ≥ 1000 requests already on that candidate **in the same segment** |
| Intra-tenant benchmark | recognized identifier; known request counts; ≥ 2 segments clearing the floor on that model |
| Any trend claim | ≥ 2 comparable periods |

The 1000-request floor is a stated policy line about the cost of changing
routing, not a measurement — the same floor and the same reasoning as the
down-routing rule in `src/down-routing-candidates.js`.

A model identifier is recognized **structurally**, never by matching a vendor
catalogue: a non-empty token, at most 64 characters from an identifier-safe
class, containing a letter or digit, and not a placeholder (`unknown`, `n/a`,
`other`, …). A catalogue would embed a third party's content and would silently
drop every model released after it was written.

No trend field exists. Two periods gate a trend claim, and this contract makes
none: the overspend question is answerable from one month. The second period is
used only as a confidence input — it distinguishes a standing pattern from one
unusual month. **The UI must not imply direction.**

## Confidence

Derived, never set. Starts at `high` and steps down one level per distinct
reason, floored at `low`: `metric_unavailable`, `single_period`,
`unrecognized_models_present`, `prorated_partial_month`,
`candidate_rate_pooled_across_segments`. The machine-readable reasons travel
with the level as `confidence.reasons` (the repository's camelCase convention),
and the validator recomputes the level from them and rejects a mismatch.

## Degraded shapes

Each renders. None is a blank panel. `status` reports the most limiting shape,
in this precedence:

| `status` | Still answerable | Withheld, and why |
| --- | --- | --- |
| `degraded_no_request_counts` | Where the money is: the largest block of model spend, exact. | Every rate and the overspend metric — there is no denominator. Action: re-import with the request column mapped. |
| `degraded_unrecognized_models` | How much spend cannot be attributed to any model, and to which segments. | Any headline naming a model. Action: map the model/SKU column or correct placeholder values. |
| `unavailable` | The largest block of spend, and which gate the metric failed. | The overspend metric — eligibility failed. The reason names the specific gate. |
| `degraded_single_period` | The full overspend metric for that month. | Any direction of travel; confidence drops one level. |
| `ok` | Everything the contract claims. | — |

Partly unrecognized spend does not degrade the status: it is excluded from the
ranking, reported in `evidence.unattributedRows` and
`provenance.unrecognizedModelSpendMinor`, and it lowers confidence.

## What this contract cannot yet be fed — read before wiring the UI

**No producer exists in this repository today.** Two gaps, both in the import
path, both outside this change:

1. **The model identifier is discarded on import.**
   `src/finops-tabular-import.js` reads the model column only to derive a
   service category, then groups rows by day, org unit, provider, and category.
   The v1 provider-usage-billing record carries no model field, and
   `src/local-finops.js` validates records against an exact key allowlist, so
   carrying one is an integration-contract change, not a local edit.
2. **There is no request-count column anywhere in the mapping vocabulary.**
   `MAPPING_TARGETS.provider` in `src/import-column-mapping.js` offers input
   tokens, output tokens, and a bulk quantity — no requests. The delimited
   import emits `usage.unit` of `tokens` or `provider-units` and never
   `requests`, so today's imports land in `degraded_no_request_counts` by
   construction, not by accident.

That is why the degraded shapes are first-class here rather than edge cases: the
contract is honest against the data that actually exists, and it names exactly
what the import must start carrying before the headline metric can appear. Until
gap 2 closes, no honest per-request rate can be computed from a customer file at
all, and no amount of contract design changes that.
