# Department fix-pack contract

`department-fix-pack/1.0.0` — `src/department-fix-pack.js`

The department drill-down said what was weak and what one next step was. This
contract says what a leader can *do* about the pattern, ranked, priced where a
price exists, and refused where one does not.

Client-side only and derived only: no DOM, no fetch, no storage, no clock, no
randomness, no credential. It recommends nothing new.

## What it consumes, and from whom

| Input | Source | What is read |
| --- | --- | --- |
| `department` | one row of `aggregateConversationLiteracy().departments` | `signals`, `coverage`, `confidence`, `gradeable`, `rubricVersion` |
| Theo's rubric | `prompt-literacy-rubric.json` via the department row | category severity (`100 − categoryScoreWeight`), the model-id pattern |
| query classifications | `query-classification.js` | the classifier version, and the categories already on the row |
| `routing` | `evaluateUnitModelRouting()` (`down-routing-candidates.js`) | `status`, `recoverableUsd`, `candidates`, `confidence`, `unitLabel` |
| `basis` | the caller | `spendUsd`, `periodMonths`, `source` |

The module authors exactly three things: the action names, the rationale
sentences, and the ranking rule. No second severity scale, no second
recoverability number, no saving that is not either a routing figure or an
apportionment of a stated spend basis.

## The interventions

One per rubric weakness signal, because `RUBRIC_SIGNALS` is where this
repository already decided what the weaknesses are. `highValue` is the reference
class and has no action.

| Signal | Kind | Action | Savings basis |
| --- | --- | --- | --- |
| `model_fit` | `routing` | Route short lookups to the standard tier | `down_routing_delta` |
| `iteration_cost` | `rewrite` | Ship a re-prompt rewrite template | `apportioned_recoverable_share` |
| `intent_clarity` | `training` | Run an intent-framing workshop | `apportioned_recoverable_share` |

A signal whose numerator is 0 is **excluded by name** with
`signal_did_not_fire`, never shown at zero.

## Money

- `down_routing_delta` — the routing rule's own `recoverableUsd`, verbatim. No
  apportionment and no multiplier. A routing result whose status is
  `insufficient_data` is **unpriced**, not scored zero.
- `apportioned_recoverable_share` — `spendUsd × (numerator ÷ classified) ×
  recoverability`. Both ratios belong to modules that already published them.
  Without a spend basis there is no number at all.

Everything is summed in integer minor units and divided once.
`monthlySavingsUsd = round(windowSavings ÷ periodMonths)`; `periodMonths`
describes the window both the routing result and the spend basis cover, and
defaults to 1.

`totals.monthlySavingsUsd` sums the **priced** actions only. An unpriced action
is counted in `unpricedCount`, its reason lands in `unpricedReasonCodes`, and
`complete` is false. It is never folded in as a zero.

## Ranking

A named dollar figure outranks an unpriced action — an unpriced action is not a
smaller number, it is no number, and sorting it against real money at zero would
bury it. Within each tier: savings descending, then recoverable prompt-points
descending, then confidence tier, then `actionId`. Total order, no ties, and
`rank` is a unique integer.

## Confidence

Computed from completeness, never asserted. High → Medium → Low, one tier per
reason, floored at Low. The routing action **starts from the routing rule's own
tier**, so a lowered routing confidence cannot be laundered back up here; its
inherited reasons travel in `confidence.inheritedReasons`.

| Code | Costs a tier when |
| --- | --- |
| `unpriced_saving` | no dollar figure could be derived |
| `thin_classification_coverage` | department coverage below 0.8 |
| `unmeasured_classifier_confidence` | the row reports no mean classifier confidence |
| `estimated_saving` | the saving is apportioned rather than measured |

## Privacy

Redaction is a **step**, not an absence.

- A fix pack is built from an allow-list of known fields. Every other top-level
  field on `department` or `routing` is dropped unread and named in
  `redaction.droppedInputFields`, so a caller who attaches a prompt body, an
  email column or a token sees it named rather than finding it downstream.
- `routing.unitId` is deliberately off the list. Only the routing rule's own
  redacted `unitLabel` ships.
- A model identifier passes through the rubric's `redaction.modelIdPattern` or
  becomes `unrecognized`. Only the routing action names models at all.
- A department label is published only if it is a short noun phrase (≤ 48
  characters, ≤ 6 words, no address or markup characters). Anything else becomes
  `(department label withheld)` — this surface cannot tell a very long
  department name from a pasted sentence, so it withholds both.

`tests/department-fix-pack.test.js` generates every corpus in-test through the
shipped parser, classifier, aggregate and routing rule, and searches the
serialized pack for sentinel prompt markers in every state.

## Wiring

`departmentEvidenceModel()` takes optional `routing` and `basis` and puts the
pack on its **loaded** result as `fixPack`. Loading, error and empty models carry
`fixPack: null` — actions beside no result would be actions about nothing. The
pack inherits the panel's provenance rather than deciding its own, so the panel
and the actions can never describe two different departments.

## Deliberate omissions

- No view. This ships the model; painting it is a separate change.
- No new panel, metric or threshold beyond the coverage floor and the two label
  limits, each stated above.
- No blended "priority score". Dollars, prompt-points and confidence stay three
  separate published numbers.
