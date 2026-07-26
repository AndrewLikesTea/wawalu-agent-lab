# Savings portfolio contract

This static contract answers four executive questions, in this order:

1. Which department needs attention now, and why?
2. What annualized savings are projected across all actions?
3. What annualized savings have been verified and may be credited?
4. What is the variance between credited realized savings and the full projection?

It deliberately does not answer when savings will arrive, whether an action caused
an outcome, how currency should be converted, or how the answers should be
displayed. Those questions require data and decisions outside this bounded fixture.

## Metric definitions

- **Projected savings (USD):** the expected annualized amount for an action,
  stored as a non-negative whole-US-dollar integer. Portfolio and department
  totals include `planned`, `in-progress`, `completed`, and `verified` actions.
- **Realized savings (USD):** the measured annualized amount supported by
  verification evidence. It is a non-negative whole-US-dollar integer for a
  `verified` action. Every other lifecycle must store `null` — never `0`, which
  would claim a measurement nobody took.
- **Credited realized savings (USD):** what a leader may actually book. It equals
  `realizedSavingsUsd` for a `verified` action and `0` for every other lifecycle.
  This is the only field summed into realized totals, so `null` never has to be
  coerced by a consumer.
- **Variance (USD):** credited realized savings minus projected savings, reported
  on each action, each department, and the portfolio using one rule. Unverified
  projections stay in the denominator, so variance is more negative until
  verified. Action variances sum to their department's; department variances sum
  to the portfolio's.
- **Confidence:** a finite decimal from 0 through 1 describing support for the
  projection. It does not change totals or substitute for verification.
- **Updated date:** the real ISO calendar date (`YYYY-MM-DD`) on which the static
  action record last changed. There is no runtime clock interpretation.

## Attention ranking

Verified actions are excluded. Departments are compared lexicographically by:

1. completed projected USD, descending;
2. in-progress projected USD, descending;
3. planned projected USD, descending;
4. oldest unverified updated date, ascending; and
5. department ID, ascending.

This makes completed-but-unverified claims the first intervention: a leader can
ask for evidence before treating them as realized. If all actions are verified,
attention is `null`.

The selected department reports one `reasonCode`, chosen by the first unverified
lifecycle it has work in, alongside `projectedSavingsUsd` for that lifecycle and
`oldestUnverifiedUpdatedDate`. Every reason states the amount that earned it:

| `reasonCode` | Selected when the department has |
| --- | --- |
| `completed-awaiting-verification` | at least one `completed` action |
| `work-in-progress` | no `completed` action, at least one `in-progress` |
| `planned-not-started` | only `planned` unverified work |

## Consumption guarantees

- The returned portfolio is deeply frozen, including per-lifecycle counts and
  totals. Two reads of the same fixture always produce equal summaries.
- Departments are returned in ascending department-ID order; ranking never
  reorders them.
- The fixture is synthetic by test, not by review: a check rejects email
  addresses, URLs, credential-shaped tokens, credential field names, live
  provider names, and government identifiers, and requires every owner to be a
  `Synthetic ` role rather than a named person.

## Acceptance criteria

- Given the fixture, a leader asking “what can I claim as realized?” receives
  only the sum of verified outcomes with evidence.
- A leader asking “how are we tracking against the plan?” receives credited
  realized minus projected using the same lifecycle rules at action, department,
  and portfolio level, with the levels reconciling exactly.
- A leader asking “where do I intervene now?” receives exactly one department
  selected by the stable ranking above, plus an explanation.
- Invalid lifecycle states, unverified realized values, verified actions without
  evidence, malformed dates, duplicate action IDs, and conflicting department
  names are rejected before consumption.
