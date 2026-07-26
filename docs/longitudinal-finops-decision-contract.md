# Longitudinal FinOps decision contract

`longitudinal-finops/1.0.0` is the decision contract for the browser-local
multi-period FinOps view. It is a handoff to the dependent dashboard task: it
defines and asserts, it does not display. The executable form is
`src/longitudinal-finops-metrics.js`, exercised against
`src/longitudinal-finops-fixture.json` by `tests/longitudinal-finops-metrics.test.js`.

## The one question this view exists to answer

**"Which department's spending has moved far enough from its own recent baseline
that I should intervene this period — and can I trust that number?"**

Everything else is subordinate to that question. The view ranks departments,
states a movement, states a benchmark, and names one action. A widget that does
not serve that sentence does not belong in it.

## The material benchmark

A finding is measured against **the department's own trailing baseline**: the
mean of every supplied period before the current one, rounded half away from zero
to whole USD. It is deliberately a self-benchmark. The imported local contracts
carry no peer cohort and no cohort methodology, so any "industry" or "peer
median" comparison here would be invented. A department earns a benchmark only
when it has at least three reporting periods, its period labels form a gapless
consecutive calendar-month sequence, and every period carries non-null spend.
Failing that predicate produces an explicit `eligible: false` result with a
reason code — `insufficient_history`, `period_gap`, or `null_spend` — never a
zero benchmark and never a dropped row.

## The prioritized action

The contract emits one ordered action queue and one `topAction`. Ordering is
confidence rank (descending), then benchmark variance in USD (descending, nulls
last), then current-period spend (descending, nulls last), then department ID
(ascending, and unique — so the order is total and the same fixture always yields
the same top action). A finding whose benchmark is ineligible or whose provenance
is incomplete keeps its rank but is given a **data-resolution** action naming the
blocking reason code, not a spend action. A leader is never asked to act on a
number the supplied fields cannot support.

## Metric definitions

The exact formulas, rounding rules, and tie behaviours live in
`LONGITUDINAL_METRIC_RULES` in the metrics module, so the definition and the code
that computes it cannot drift apart. In summary:

- **Trend** — the two most recent period labels in ascending ISO order.
  `(current − prior) ÷ prior × 100`, one decimal, rounded half away from zero, so
  a rise and a fall of the same magnitude print the same magnitude. Positive
  always means spend increased. A zero prior period yields a null percentage with
  reason `zero_prior_period_spend`; the absolute change still stands.
- **Department comparison** — current-period spend, descending; ties break on
  ascending department ID. A null current period is not comparable and sorts
  last, with reason `null_current_period_spend`.
- **Confidence** — the ordered set `none < low < medium < high`. `high` needs an
  eligible benchmark, an available trend, and complete provenance; `medium` is an
  eligible benchmark missing one of the other two; `low` is an ineligible
  benchmark with at least two non-null periods; `none` is anything else. Every
  record resolves to exactly one level.
- **Provenance** — the intersection of `derivedFromFields` across every record of
  the department. A field absent from any contributing period cannot support a
  figure spanning them. An incomplete finding renders a sentence naming each
  missing field instead of presenting a bare number.

## Locality

Imported records stay in the tab for the session. The metrics module has no
`fetch`, `XMLHttpRequest`, `sendBeacon`, `localStorage`, `sessionStorage`,
`indexedDB`, cookie, clock, or randomness path; this is asserted against the
module source, not merely asserted in prose. The projection is deep-frozen,
JSON-serializable, and never mutates its input. The dependent dashboard inherits
this constraint: it may render the projection, but it may not transmit or persist
record contents.

## What this contract deliberately leaves out

No view, chart, route, or export surface — those belong to the dependent
dashboard task, and adding them here would be surface without a question. No peer
or industry benchmark, because no cohort was imported. No forecast and no causal
claim: three synthetic periods establish direction, not cause. No currency
conversion — records must all be USD, or validation fails. No per-employee or
per-user detail, and no free-text record field at all: the only strings a record
carries are a synthetic department slug, an ISO month, a currency code, and
enumerated local field paths. No claim of realized savings; these are synthetic
amounts. There is no browser loader, because no view consumes this contract yet.

## Acceptance criteria as leader questions

- A leader asking "who should I look at first?" gets one ranked department, with
  the tie rule stated, and no sort mode to choose.
- A leader asking "how far off is it?" gets a variance against a named baseline
  built from named periods, or an explicit reason no baseline exists.
- A leader asking "is it getting worse?" gets a signed, one-decimal
  period-over-period change over two named adjacent months, or a reason code.
- A leader asking "can I trust this?" gets one of four confidence levels and the
  exact fields that support the figure — or a statement that they do not.
- A leader asking "what do I do?" gets one action: intervene, or resolve a named
  data gap first.
