# Down-routing savings: a worked example

This page exists so a director who is shown a recommended monthly saving can
reproduce it by hand from their own rows, and can disagree with a specific
number rather than with "the model".

The block below is not written by hand. It is the output of the labelled fixture
`premium tier, high volume, short calls` in `tests/down-routing-candidates.test.js`,
rendered by `downRoutingWorkedExample()` in `src/down-routing-candidates.js`. If
the rule changes and this page is not updated, that test fails, so the page
cannot silently drift from the code.

## The rows

Two records from a v1 provider-usage-billing export, both for the same org unit,
both `service_category: "text-generation"`:

| record | usage | cost |
| --- | --- | --- |
| token billing | `40,000,000 tokens` | `120,000 minor (1,200.00 USD)`, final |
| request count | `20,000 requests` | `0 minor` |

The second row is where request volume comes from. The contract has no
request-count field on the token row, so a provider that reports volume does it
as a sibling record billed in `requests`. Records billed in requests contribute
volume and never spend, so nothing is counted twice.

## The arithmetic

```
Down-routing worked example — unit …000001
Rule down-routing-candidate/1.0.0

candidate spend: sum of cost.amount_minor over text-generation records billed in tokens = 1200.00 USD
candidate tokens: sum of usage.quantity over those same records = 40000000 tokens
observed blended price: round(120000 minor × 1,000,000 ÷ 40000000 tokens) = 3000 minor per million tokens
premium-tier test: 3000 ≥ 2000 (premium floor) = premium
call shape: 40000000 tokens ÷ 20000 requests = 2000 tokens per call (ceiling 2000)
decision: Premium-tier price, short calls, and enough volume: the token-billed text-generation spend is a down-routing candidate. = candidate
cost on the cheaper tier: round(40000000 tokens × 1500 ÷ 1,000,000) = 600.00 USD
recoverable: 1200.00 − 600.00 = 600.00 USD
confidence: no completeness penalty applied = High
```

Every figure is integer arithmetic in currency minor units and whole tokens.
There is no share of spend anywhere in it: the saving is what the unit paid
minus what the same tokens would have cost at the reference rate. Two units with
identical spend and different token counts get different savings, which is the
whole reason the previous flat 20% share was replaced.

## What the confidence tier means

The tier is computed from data completeness, never set. It starts at `High` and
drops one step per penalty, floored at `Low`. The penalties are:

| code | what it means |
| --- | --- |
| `missing_request_counts` | no `requests` record, so tokens per call was never checked against the ceiling |
| `unrecognized_provider` | a candidate record names a vendor outside the contract's known list |
| `unpriceable_usage_units` | a text-generation record is billed in neither tokens nor requests |
| `estimated_costs` | a candidate record's cost is estimated, not final |

The reasons travel with the tier on `result.confidence.reasons`, so a reader can
see what cost the unit a step rather than being told a letter grade.

## The assumptions you are being asked to accept

These are the only judgements in the rule. Each is a named constant in
`src/down-routing-candidates.js`; changing one changes the figure visibly.

- Premium-tier floor ($20.00 per million blended tokens): at or above this observed price the unit is assumed to be buying a premium text tier. NO SOURCE — this repository ships no provider rate card and cannot reach one. The value sits just below the blended rate the bundled example export implies, and must be replaced with the organisation's own contracted rates before any figure here means money.
- Standard-tier reference price ($15.00 per million blended tokens): what the cheaper tier is assumed to charge for the same tokens. NO SOURCE, same caveat as the premium floor. The recoverable figure is the difference between what the unit paid and this price applied to the same token count, so an error in this number moves the saving proportionally and visibly.
- Short-call ceiling (2,000 tokens per call): a text call whose total tokens are at or below this is assumed to carry no long retrieved context and to be servable by the cheaper tier at equal quality. NO SOURCE — it is a stated policy line, not a measured quality result, and no quality evaluation in this repository supports it.
- Minimum request volume (1,000 requests in the period): below this, the saving is assumed to be smaller than the engineering cost of changing routing, so no candidate is raised. NO SOURCE — it is a judgement about change cost, not a measurement.
- SUBSTITUTION — model tier: the contract carries no model identifier, so tier is derived from the unit's own observed blended price per million tokens (candidate spend divided by candidate tokens). A director can redo this division from their invoice.
- SUBSTITUTION — per-call token shape: the contract carries no input/output token split, so call shape is total tokens per request, taken from a sibling record whose usage unit is 'requests'. Without such a record the shape is unknown, the unit is still costed, and the confidence tier is lowered rather than the number being hidden.
- Candidate spend is the cost of text-generation records billed in tokens only. A record billed in requests contributes volume and never spend, so a provider that reports both cannot double-count into the saving.

## What this figure is not

It is a repricing scenario, not a measured saving. Nothing here evaluates
whether the cheaper tier answers these calls as well; the short-call ceiling is
a stated policy line standing in for a quality result that does not exist yet.
A unit whose calls exceed that ceiling is returned at `0.00 USD` recoverable
rather than at a reduced share, because a smaller number would imply a partial
quality claim that is equally unsupported.
