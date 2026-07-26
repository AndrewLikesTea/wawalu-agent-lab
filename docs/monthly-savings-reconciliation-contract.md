# Monthly savings reconciliation contract

`monthly-savings-reconciliation/1.0.0` is a static, synthetic measurement
contract. It answers four questions about an action and about the portfolio, in
this order:

1. In each month, what savings were planned for work that was actually running?
2. Of that plan, how much was measured, and what did the measurement say?
3. How far is measured realized savings from the plan it can be compared to?
4. How much of the plan could not be measured at all, and why?

It deliberately does not answer whether an action is on track — that is the
leader's call, and this contract's job is to make the comparison honest enough to
support it. It also does not forecast, attribute a cause to any variance, convert
currency, change action lifecycle state, treat a simulated measurement as
verified savings, fetch external data, or persist customer data.

It links every row to an accountable `actionId` in the validated
`savings-portfolio/1.1.0` contract, and only that version.

## Record fields

Each action/month row contains:

- `actionId`: an existing accountable portfolio action identifier.
- `measurementMonth`: a calendar month in `YYYY-MM` form.
- `projectionBaseline`: the linked annualized action projection, the derived
  whole-USD monthly baseline, and the allocation rule that produced it.
- `simulatedRealizedSavingsUsd`: a whole-USD synthetic measurement when
  available, otherwise `null`.
- `varianceUsd`: simulated realized minus monthly baseline when available,
  otherwise `null`.
- `varianceReason`: `above-projection`, `below-projection`,
  `matched-projection`, or `measurement-unavailable`. The validator derives which
  measured reason is valid from the two amounts.
- `evidenceProvenance`: a named static source and evidence references.
- `availabilityState`: `available` or `unavailable`.
- `availabilityReason`: `action-not-started` or `measurement-pending` when
  unavailable, `null` when available.
- `aggregationInput`: the three amounts every total in this contract is summed
  from.

## Metric definitions

- **Monthly projection baseline (USD):** `0` for a month before the action
  entered `in-progress` (allocation rule `not-yet-active`); otherwise
  `round-half-up(annualizedSavingsUsd / 12)` (allocation rule `even-twelfth`).
  Both values are computed by the validator from the linked action's projection
  and its lifecycle audit trail, never authored freehand, so two engineers derive
  the same plan. Twelve `even-twelfth` baselines can differ from the annualized
  projection by up to 6 USD; the annualized figure stays authoritative and no
  consumer should reconstruct it by multiplying.
- **Active month:** a month at or after the action's `in-progress` transition
  month. An action that never reached `in-progress` has no active month, carries
  a zero baseline, and cannot be behind a plan it was never on.
- **Measured projection (USD):** the monthly baseline of rows whose measurement
  is `available`; `0` otherwise. This is the only plan figure variance is taken
  against.
- **Unmeasured projection (USD):** monthly baseline minus measured projection.
  It is reported as its own amount at every level and is **never** netted into
  variance. A plan nobody measured is a coverage gap, not a shortfall.
- **Credited simulated realized savings (USD):** the simulated measurement for an
  `available` row and `0` otherwise. It is the only realized figure summed, so a
  consumer never coerces `null`. It is simulated, and never credited as verified
  savings in the portfolio contract.
- **Measured variance (USD):** credited simulated realized minus measured
  projection, over `available` rows only. It is `null` for any group with no
  available row, because no measurement is a different answer from no difference.
- **Coverage:** reported as counts — window months, active months, measured
  months, unmeasured active months, and per month the available, unavailable, and
  not-started action counts. Never as a ratio, so an action that never started
  has no undefined denominator.

## Availability

Unavailable measurements are not silently converted into observations:
`simulatedRealizedSavingsUsd` and `varianceUsd` stay `null`, and both aggregation
inputs are `0`, so totals stay additive without erasing the distinction.

`availabilityReason` separates the two situations that need different action from
a leader:

| `availabilityReason` | Meaning | What a leader does |
| --- | --- | --- |
| `action-not-started` | the action had not entered `in-progress` by this month | nothing; there is no plan to chase |
| `measurement-pending` | the action was running but produced no measurement | ask the accountable owner for the measurement |

Evidence references are namespaced `syn-recon-`, disjoint from portfolio
`verificationEvidence` IDs. A simulated monthly measurement can therefore never
be read as citing the evidence that verified a saving. Available measurements
require at least one reference; unavailable ones must carry none.

## Validation and aggregation

The reconciliation is created only against a compatible validated portfolio. The
records must form a **dense, contiguous grid**: one record for every portfolio
action in every month of the window, with no month missing between the first and
last. A missing cell would be indistinguishable from an unmeasured one and would
make month-to-month totals quietly stop being comparable.

Unknown action IDs, duplicate action/month pairs, invalid months, baselines that
disagree with the derived allocation rule, availability claimed before an action
started, contradictory availability or variance fields, borrowed verification
evidence, and malformed amounts all fail before any total is returned.

Records are sorted by measurement month and then action ID.
`actionAggregationInputs` (sorted by action ID) supports the action-level review;
`monthlyAggregationInputs` (sorted by month) supports the portfolio-level review.
Every amount in both is reproducible by summing `aggregationInput` fields across
records, so a consumer can verify any total with addition alone. The complete
result is deeply frozen and JSON-serializable.

`GET /api/exports/reconciliation` returns the same validated snapshot as JSON
without a database, credential, or network call. Existing decision, release, and
portfolio exports keep their routes and contents. There is no browser loader,
because no view consumes this contract yet; adding one before a view exists would
be surface without a question.

## Acceptance criteria

- A leader asking "what did this action realize against plan last month, and the
  month before?" receives a baseline, a simulated realized amount, and a variance
  for every month the action was running and measured.
- A leader asking "how far off plan are we?" receives a variance computed only
  over work that was actually measured, alongside the unmeasured plan amount
  stated separately, so a low measurement rate can never masquerade as a
  shortfall.
- A leader asking "why can't I see this number?" receives either
  `action-not-started` or `measurement-pending`, which point at different next
  steps.
- A leader asking "can I book this?" receives no encouragement to: these are
  simulated measurements with `syn-recon-` provenance, distinct from the
  portfolio's credited verified savings.
- Sparse grids, gapped windows, authored baselines that disagree with the
  allocation rule, measurements claimed before an action started, and evidence
  borrowed from portfolio verification are rejected before consumption.
