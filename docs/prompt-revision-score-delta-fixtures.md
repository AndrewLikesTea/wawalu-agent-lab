# Reproducible prompt revision score deltas

`prompt-revision-delta-fixtures/1.0.0` defines three revision pairs that show
exactly how each prompt revision score delta is calculated.

The executable form is `tests/prompt-revision-delta-fixtures.test.js`. Every
number in this document is asserted there. A number here with no assertion there
is not a claim this repository makes.

This document does not change `prompt-revision-comparison/1.0.0`. The shipped
envelope, its abstentions, and its boundary are exactly as
`docs/prompt-revision-comparison-contract.md` specifies, and
`prompt-literacy-rubric.json` is byte-identical before and after this work.

## Criterion change and composite contribution

**A criterion change and its contribution to the composite are two different
numbers.**

```
criterionDelta               = revisionCriterionScore - baselineCriterionScore
weightedCompositeContribution = criterionDelta x weightPercent / 100
```

They are equal only for a criterion weighted 100%, and no criterion is. Reported
as one figure, the larger of the two travels — a reader repeats "+72" and a
director checks the composite, finds +36, and is right to distrust every other
figure on the page.

For `intent-rewrite-gain`:

- the **intent criterion** change is **+72** (28 → 100), on the criterion's own
  0–100 scale;
- its **50%-weighted contribution to the composite** is **+36** (+72 × 50%);
- the **composite delta** is therefore **+36**, F → A.

An earlier write-up of this fixture reported a single figure where there are
two. Both are now labelled wherever either appears, and
`tests/prompt-revision-delta-fixtures.test.js` asserts each of them separately
plus `criterionDelta !== weightedCompositeContribution`, so the mislabel cannot
return through documentation no test reads.

## The assumption behind every composite weight

Every contribution above is a criterion delta multiplied by a weight, so each
weight is load-bearing on a published number. The canonical text lives in
`prompt-literacy-rubric.json`; the summary and the dispute it invites are
encoded in `COMPOSITE_WEIGHT_ASSUMPTIONS`, and a test fails if the rubric
publishes an axis that file has not stated an assumption for.

| Criterion | Weight | Assumption | What disagreeing with it means |
| --- | --- | --- | --- |
| Intent | 50% | Intent is the only axis a reader can move by rewriting the request, and coaching is this product's lever, so the axis coaching moves carries the largest single share. | Believing routing or turn count is the bigger lever. Change 50 in the rubric and every number below moves with it. |
| Efficiency | 30% | Wasted turns are real spend, but a symptom of weak intent rather than an independent skill. Above model fit so a re-prompt spiral costs more than a routing mistake; below intent so it cannot outweigh its own cause. | Believing a re-prompt spiral should fail a prompt on its own — that asks for more than 50. |
| Model fit | 20% | The smallest share, because routing is a platform fix a gateway rule makes without the requester changing anything. Not zero: reaching for a frontier model to rename a variable is a judgement the requester made. | Every fixture names one tier on both sides, so this weight contributes 0 to all three deltas. It is stated because it is part of the composite the deltas come from, not because it moved. |

The weights total 100, which is what makes a weighted contribution a
*decomposition* of the composite rather than an analogy for one.

## The three fixtures

All three name the **standard** tier on both sides, so no model-fit signal
fires and the whole delta is attributable to the rewrite. Every text is
hand-authored; no real prompt, customer, provider, or telemetry data was
available to this workflow and none is used. The fixtures are constructed in
memory in the test, not committed as a blob, so a shape change fails a test
rather than drifting.

### Composite delta and letter transition

| Fixture | Polarity | Composite | Delta | Direction | Grade | `bandDelta` |
| --- | --- | --- | --- | --- | --- | --- |
| `intent-rewrite-gain` | positive | 56 → 92 | **+36** | `improved` | F → A | +4 |
| `reordered-ask-no-signal-change` | neutral | 89 → 89 | **0** | `unchanged` | B → B | 0 |
| `constraint-loss-regression` | negative | 89 → 65 | **−24** | `regressed` | B → D | −2 |

### Criterion score changes

Criterion movement, then what that movement is worth on the composite. The two
columns are never collapsed into one.

| Fixture | Criterion | Baseline → revision | Criterion score change (`criterionDelta`) | Weighted composite contribution (`weightedCompositeContribution`) |
| --- | --- | --- | --- | --- |
| `intent-rewrite-gain` | Intent (50%) | 28 → 100 | **+72** | **+36** |
| | Efficiency (30%) | 85 → 85 | 0 | 0 |
| | Model fit (20%) | 80 → 80 | 0 | 0 |
| `reordered-ask-no-signal-change` | Intent (50%) | 94 → 94 | 0 | 0 |
| | Efficiency (30%) | 85 → 85 | 0 | 0 |
| | Model fit (20%) | 80 → 80 | 0 | 0 |
| `constraint-loss-regression` | Intent (50%) | 94 → 46 | **−48** | **−24** |
| | Efficiency (30%) | 85 → 85 | 0 | 0 |
| | Model fit (20%) | 80 → 80 | 0 | 0 |

The contributions sum to the composite delta exactly for all three.

**Stated limitation on that exactness.** The composite is rounded to a whole
number once, at the end, on each side (`reporting.compositeDecimals`). Two
roundings of at most half a point each can separate the sum of contributions
from the reported integer delta by up to **1 point**. The test asserts that
1-point bound as the general invariant *and* exact equality for these three, so
a fixture that stops decomposing exactly is noticed rather than absorbed by the
tolerance.

### Remaining coaching priority

| Fixture | Baseline top signal | Revision top signal | `status` | `nextAction.kind` |
| --- | --- | --- | --- | --- |
| `intent-rewrite-gain` | `intent-states-acceptance` | none available | `none` | `stop` |
| `reordered-ask-no-signal-change` | `intent-pasted-context` | `intent-pasted-context` | `unaddressed` | `apply_remaining` |
| `constraint-loss-regression` | `intent-pasted-context` | `intent-states-acceptance` | `advanced` | `revert` |

Three things worth stating about that table:

- `intent-rewrite-gain` **answers the open question in the comparison
  contract**, which asked an implementer to add a `status: "none"` pair *if a
  text reaching `NOTHING_TO_IMPROVE` can be authored inside the input ceilings*.
  It can: a prose ask that states context, constraints, an acceptance criterion
  and a numbered structure saturates the intent criterion at 100, leaving no
  penalty fired and no credit with headroom worth points. The `none` branch is
  reachable from reader text, not only from a constructed session.
- `reordered-ask-no-signal-change` is a real edit — the request lines are
  reordered and one word swapped for a synonym — that moves no signal. It is
  what makes `unchanged` and `unaddressed` reachable rather than theoretical,
  and it is the case a score delta alone cannot describe: nothing moved *and*
  the coach is still naming the same first move.
- `constraint-loss-regression` still has a top-ranked change available, and the
  action is `revert` anyway. Coaching a reader deeper into a worse draft is the
  failure the ladder puts `revert` above `apply_remaining` to prevent.

## What is judge-facing, and what it may contain

The comparison envelope deliberately carries no per-axis deltas — three deltas
beside a headline is three headlines, and that decision stands. The
decomposition above is therefore **evaluation material**, derived on demand from
the two sessions and the rubric's weight table, not a second figure added to a
reader's screen.

Being derived from sessions is what makes it safe. A coaching session already
carries measurements and never the analyzed text, so neither the comparison nor
its decomposition has access to prompt content at any point. The regression
tests prove that rather than asserting it:

| Guarantee | How it is checked |
| --- | --- |
| No prompt content is retained | Each side is graded with a unique marker appended. Every string in the comparison **and** in the decomposition — object keys included, at any depth — is scanned for both markers. |
| No prompt content is echoed by another route | Every 24-character window of both fixture prompts is searched for in the serialized comparison and decomposition. A marker scan proves nothing new is copied; the window scan proves nothing old is either. |
| Only rubric-owned strings escape | Every string in the decomposition must be a version, a fixture-named id, a grade letter, a rubric axis key/label/assumption, or an object key. Anything else fails. |
| No network | The static import graph reachable from `src/prompt-revision-comparison.js` is walked, comments and string literals blanked, and checked for `fetch(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, `navigator.connection`. |
| No browser-local storage | The same walk is checked for `localStorage`, `sessionStorage`, `indexedDB`, `openDatabase`, `document.cookie`, and assignment to `location.hash`/`location.search`. |
| Determinism | Each fixture is built twice and the serialized decompositions must be byte-identical. No clock, no randomness, no I/O in the path. |

## What this fixture set deliberately leaves out

- **A change to the shipped envelope.** Nothing in `src/` changed. Adding
  per-axis deltas to what a reader sees is the decision the comparison contract
  already made, and reversing it is a product call, not a fixture call.
- **Per-signal deltas.** Which of the four intent signals supplied the +72 is in
  each session's `detail`. Naming it in the delta record would restate the
  engine's ranking in a second place, which is how two screens name different
  first moves for the same text.
- **A pass/fail threshold on the delta.** "Is +36 good?" needs a population this
  workflow has no access to. Three hand-authored pairs are fixtures, not a
  baseline distribution, and treating them as one would be the kind of
  unexplainable number this repository refuses to publish.
- **Inter-rater agreement figures.** The rubric is a deterministic function, not
  a panel; there is nothing to agree. The reproducibility claim it *can* make —
  same input, byte-identical output — is the one asserted above.
