# Guided-result composition contract

`finops-guided-result/1.0.0` — `src/finops-guided-result.js`

The AI FinOps tab answered nine questions and led with none of them. This
contract composes one answer to the question a leader actually arrives with, and
demotes everything else to progressive disclosure.

Client-side only, by construction: the module is pure selection over figures
other modules already published. No DOM, no fetch, no storage, no clock, no
credential, no prompt text, no customer record, no live integration.

## The primary leadership question

> **What should we do now?**

Fixed. It is not derived from the data, not templated, and there is exactly one.

## Slots

A composition has five slots and no others.

| Slot | Cardinality | Required |
| --- | --- | --- |
| `benchmark` | one | published or refused with a reason |
| `action` | one | published or refused with a reason |
| `trust` | one | **always present** — a composition never publishes without it |
| `disclosures` | ordered set | every support-only panel, permitted or not |
| `primaryFinding` | one sentence | the action's text, or the reason there is none |

## Source precedence

`composeGuidedResult({ imported, bundled })` reads **exactly one side**. When
`imported` is supplied it is the only side read: the bundled synthetic seed
supplies no fallback figure, no benchmark, and no action. A `verdict` handed to
the `bundled` side is discarded — synthetic data cannot earn a trust verdict.

`basis` is `imported` or `synthetic`. There is no blend and no third value.

## `decisionReady`

`decisionReady === true` **iff** `basis === "imported"` **and**
`trust.state === "verified"`. Everything else — an unattributable import, the
bundled sample, the example dataset — is readable and is not a basis for a
decision. The page writes the same fact to `#guided-result[data-decision-ready]`.

## Metric definitions

### Trust verdict (required)

| Field | Definition |
| --- | --- |
| `coverage` | The trust verdict's dollar-weighted attributed share, repeated as a fraction in `[0,1]`. **Never** row-weighted, never recomputed here. |
| `coveragePercent` | `coverage × 100`, rounded once to one decimal. `null` when the ratio is undefined — never `0`. |
| `coverageFloor` | `MIN_ATTRIBUTED_SHARE`, imported from the published attribution policy. Not a new number. |
| `attributedUsd`, `totalUsd` | The verdict's integer minor units ÷ 100. Major USD. |
| `findingCount` | Count of the verdict's ranked findings. |

`trust.state`:

- `verified` — imported, `coverage >= MIN_ATTRIBUTED_SHARE`. The only
  decision-ready state.
- `below_floor` — imported, coverage defined and under the floor.
- `unmeasurable` — imported, **no** coverage percentage exists: the verdict's
  state is `empty`, `zero_spend`, or `mixed_currency`. An undefined ratio, which
  is a different claim from 0%.
- `synthetic` — bundled. Internally complete by construction and invented by
  construction; `satisfied` is `true` and `decisionReady` is still `false`.

### Headline benchmark (one, grade-backed)

| Field | Definition |
| --- | --- |
| `metricId` | `ai_literacy_composite` |
| `value` | The prompt-literacy rubric's composite over the scored records of the dataset on screen. Integer. Repeated from the grade result; not re-rounded, not re-banded. |
| `unit` | `points (0-100)` |
| `letter` | The rubric's own letter grade. |
| `scoredRecords` / `sourceRecords` | Records the rubric scored / records handed to it. |
| `floor` | `grade.eligibility.minScoredRecords`, defaulting to `MIN_SCORED_PROMPTS`. |
| `confidenceLevel` | The corpus grade's named confidence level. `null` on the synthetic path — a named confidence over invented records would be a second, softer claim about the same thing. |

**Source.** `imported` → `gradeImportedCorpus()` over the reader's own query
sample. `synthetic` → the bundled seed's spend-weighted roll-up
(`summarize()`), adapted in `evolution-page.js`. Never one filling in for the
other.

**Availability.** Published iff the grade result says `gradeable`. The refusal
reason is the **hero panel's own**, read off `finops-panel-contract.js` from the
same scored-prompt count that decided the panel, so the benchmark and the panel
around it cannot refuse for two different reasons.

**Deliberately not gated on trust.** The composite is computed from scored
queries, not attributed dollars, so thin attribution is not evidence against it.
What thin attribution gates is `decisionReady`, which is the honest place for
that qualifier.

### Prioritized action (exactly one)

Candidates are declared with **unique integer ranks**, so selection is total:
the eligible candidate with the lowest rank wins and there is never a tie to
break. Priority is a property of the contract, not of the order a reader
selected files in.

| Rank | Id | Eligible when | `expectedEffect` (USD) |
| --- | --- | --- | --- |
| 1 | `trust_repair` | `basis === "imported"`, `!trust.satisfied`, and the verdict named a next action | `verdict.nextAction.recoverableMinor ÷ 100` — spend the step would move into an attributed org unit |
| 2 | `spend_driver` | `decisionReady` and `leadingFinding()` published a driver whose department the top-ranked recommendation names | the driver's period-over-period delta |
| 3 | `routing_pilot` | `decisionReady` and `topDepartment.recoverableUsd > 0` | `topDepartment.recoverableUsd` (routing scenario, not a realized saving) |
| 4 | `import_own_export` | `basis === "synthetic"` | none — no dollar effect is claimed for invented data |

Money is major USD, rounded once at two decimals (`Math.round(v * 100) / 100`).

`actionable` is the verdict's own for rank 1: some repairs (a quarantined
period, two source instances) are steps a human takes outside this product, and
saying so is more useful than linking to a control that would not fix them.

Ranks 2 and 3 require `decisionReady`, not merely `trust.satisfied`. **Spend
advice is never prioritized over invented data or over data the page has just
said it cannot attribute.** On the synthetic path the answer is always rank 4.

When nothing is eligible the action is unavailable with
`no_eligible_action_candidate` (trust unsatisfied) or `no_spend_driver_published`
(trust satisfied, nothing recoverable and no driver). No softened suggestion.

### Supporting disclosures (ordered)

`hero-grade` is the **only** panel permitted as primary content — it is the
headline benchmark's own panel. Every other declared executive panel is
**support-only progressive disclosure**, in this declared rank order:

| Rank | Panel |
| --- | --- |
| 1 | `spend-and-recovery` |
| 2 | `department-priority` |
| 3 | `spend-mix` |
| 4 | `high-value-share` |
| 5 | `model-overspend` |
| 6 | `savings-portfolio` |
| 7 | `recommendation-evidence` |
| 8 | `peer-benchmark` |

Order is `rank` ascending and nothing else. Ranks are unique integers, so the
order never depends on which panels happen to be answerable. A panel added to
`finops-panel-contract.js` and not classified here throws at module load rather
than shipping as accidental primary content.

`permitted` is the panel contract's own availability decision, repeated. A panel
that cannot be computed is **still listed**, with its question and the one input
that would answer it — dropping it would tell a leader the question does not
exist.

The page writes the same classification onto the panels themselves:
`data-panel-role="primary" | "support"` and `data-disclosure-rank`.

## Availability behaviour, uniformly

Every slot is either published or carries `unavailable: { reason, needLabel,
need }`. Reason codes for a missing declared input are **quoted from the panel
contract**, so the same gap is named the same way here, on a KPI card, and in an
exported briefing. This contract authors only four codes of its own:

| Code | Meaning |
| --- | --- |
| `no_result_composed` | Neither an import nor a bundled seed was supplied. |
| `no_trust_verdict_supplied` | An imported dataset arrived with no trust verdict. |
| `no_eligible_action_candidate` | Every declared candidate was ineligible. |
| `no_spend_driver_published` | Trust is satisfied and the analysis ranked nothing recoverable and published no driver. |

## Boundary

No credential, customer-data transmission, prompt storage, or live integration.
The contract's slots are counts, ratios, letters, and authored sentences.
`tests/finops-guided-result.test.js` asserts that no composition serializes a
whole opaque org identifier, an email address, or a credential-shaped string.

## Deliberate omissions

- No second benchmark. Two headline figures makes the reader decide which one
  matters, and deciding that is this contract's whole job.
- No second action. A ranked backlog is not a next step.
- No new panel, chart, or metric. Every figure already existed; what did not
  exist was an order over them.
- No "how guided" score. A composition either names a primary finding or says
  which input would let it.
