# Canonical AI FinOps decision contract

Version `finops-decision/1.0.0`. Implemented in `src/finops-decision-contract.js`;
the shipped instance is `src/finops-decision-fixture.json`; the rules below are
executable in `tests/finops-decision-contract.test.js`.

## The question

The AI FinOps front door answers exactly one question:

> **Are we wasting money?**

Everything on that page either answers it or supports the answer. A surface that
wants to ask a different question is a different surface and needs its own
contract.

## What the view must answer, in order

1. **Are we wasting money, and how much of what we spend is recoverable?** The
   benchmark: modelled recoverable spend as a share of analyzed AI spend, over a
   named window.
2. **What is that worth?** The impact: estimated cost reduction, in a stated
   currency, over the same window, with the calculation basis beside it.
3. **What is the one thing to do about it?** The prioritized action: the single
   highest-ranked intervention and the role accountable for it.
4. **How much of this should I believe?** The confidence: a bounded score and the
   stated basis for that score.
5. **Where did this come from?** The provenance: the synthetic local source and
   its generated-at context.
6. **What supports it?** The evidence, behind progressive disclosure.

Confidence comes after the action, not before it. A caveat read before the thing
it qualifies is a caveat with nothing to qualify.

## Required fields

A record is invalid — not "partial" — without all seven.

| Field | Meaning |
| --- | --- |
| `question` | Fixed to the canonical question above. |
| `benchmark` | The material comparison baseline, the observation, the comparison between them, and the window all three were measured over. |
| `prioritizedAction` | Rank 1 only: one statement, one accountable role, one basis. |
| `impact` | Estimated cost reduction: value, currency, period, calculation basis, `realized: false`. |
| `confidence` | A score in `[0, 1]`, its band, and the stated basis for it. |
| `provenance` | Source, dataset id, generator, generated-at, generated-at basis, execution context. |
| `evidence` | Progressive-disclosure entries, explicitly distinct from the summary. |

## Exact metric definitions

Stated so that two engineers compute the same number.

- **Measurement window.** A half-open interval `[start, end)`: `start`
  inclusive, `end` exclusive, both RFC-3339 instants in UTC. Every figure in one
  record covers the same window. A record whose `benchmark.window` and
  `impact.period` differ is invalid, because the two figures would not be
  comparable.
- **Benchmark baseline.** `benchmark.baselineUsd` is analyzed AI spend in USD
  over the window: every provider record the dataset ships for that window, not
  a subset chosen after the figure was known. Must be finite and positive.
- **Benchmark comparison (recoverable share).** `observedUsd ÷ baselineUsd`,
  where `observedUsd` is modelled recoverable spend in USD over the same window.
  Unrounded quotient, stored rounded half-up to 4 decimal places, displayed
  rounded half-up to whole percent. When the baseline is not a finite positive
  number the share is `null` — never `0`. A share of nothing is unknown, not
  zero.
- **Impact.** `impact.value` is the sum of the per-department routing scenarios
  over the ranked departments, in USD, over the window, under rule version
  `down-routing-candidate/1.0.0`. It is a ceiling on what re-routing could
  recover, not a realized, invoiced, or promised saving; `realized` is
  structurally `false`.
- **Confidence score.** Bounded `[0, 1]`, rounded half-up to 2 decimal places:

  ```
  score = clamp(coverageRatio
                − 0.15 × (required aggregate inputs missing)
                − 0.15 × (distinct lowered-confidence reasons on the rank-1
                          action's routing candidate), 0, 1)
  ```

  `coverageRatio` is `recordsAnalyzed ÷ recordsTotal` from
  `finops-briefing/1.0.0`. The two penalties are equal and blunt on purpose: a
  missing input and an unverifiable call shape mean the same thing to a leader —
  part of the basis for this number was not checked.
- **Confidence band.** Read off the thresholds `finops-briefing/1.0.0` already
  publishes: `high ≥ 0.90`, `moderate ≥ 0.60`, `low > 0`, `insufficient = 0`, so
  the two contracts never disagree about what "high" means. Decision confidence
  may sit a band below briefing coverage confidence: coverage asks how many
  records were read, this asks how much of the recommendation was verified.
- **Generated-at.** An authored static instant, never a reading of the browser
  clock, so the demo shows the same figures on every open and in every timezone.

## The single-summary rule

Every decision-bearing region on the page declares its role in markup with
`data-decision-summary`:

- `complete` — answers the question on its own.
- `evidence` — supports an answer given elsewhere, and must not restate it.

**At most one `complete` summary may be visible at a time.** The front door
ships one (`#finops-first-run`, the bundled example). The reader's own headline
(`#guided-result`) is the other, and the page retires the example the moment the
reader's own result appears. Panels such as the score card, the local results
detail, the headline grade card, and the restored briefing are `evidence`.

The rule is checked against the shipped document, not against a description of
it, so adding a second full summary fails a test rather than a design review.

## The privacy boundary

A decision record is a demo artifact holding invented aggregates and nothing
else. Validation rejects a record that carries:

- a key whose name looks like a credential, a session, an address, a customer, a
  stored prompt, or a transcript;
- a value that looks like an email address, a bearer or provider token, an
  authorization header, or an `http(s)` endpoint.

This is a validator, not a scrubber. A record that trips it fails; it is not
quietly cleaned, because a cleaned record hides the code path that put the value
there.

## Acceptance criteria, as the question a leader is asking

- *Are we wasting money?* A leader reads one share and one dollar figure in the
  first viewport, before choosing a file, and can tell from the region itself
  that both are invented.
- *What do I do on Monday?* Exactly one action, ranked first, with the role
  accountable for it and a cap on the pilot.
- *How much should I believe it?* A score on a stated scale with the reason it
  is not 1.00 in the same sentence — not a colour, not a bare decimal.
- *Where did this come from?* The record names the synthetic local dataset, the
  generator, and the fact that nothing left the tab.
- *Which of these panels is the answer?* Exactly one, and the others say in
  markup that they are evidence.

## Deliberate omissions

- **No second headline metric.** Deciding which figure matters is this
  contract's job; publishing two moves it back onto the reader.
- **No peer position and no literacy grade in the record.** The bundled sample
  ships no comparable cohort and no scored query sample. Those stay unavailable
  and labelled rather than estimated.
- **No confidence interval on the impact.** The figure is a modelled ceiling
  under a stated rule, not a sampled mean; a band around it would imply a
  sampling model this page does not have.
- **No live integration, stored prompt, or reader-supplied value.** The record
  is synthetic, local, and static by construction.
