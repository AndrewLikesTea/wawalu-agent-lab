# Reproducible first-run coach fixtures

`first-run-coach-fixtures/1.0.0` pins the first score the prompt coach shows
anybody — the bundled example, unmodified — together with the two things a
reader does next: edit it, or clear it and paste their own work.

The executable form is `tests/first-run-coach-fixtures.test.js`. **Every number
in this document is asserted there. A number here with no assertion there is not
a claim this repository makes.**

Nothing in `src/` changed for this fixture set. Grade, revise and re-grade
semantics are exactly as `docs/prompt-coaching-session-contract.md` and
`docs/prompt-revision-comparison-contract.md` specify — Noor's first-run journey
contract and comparison envelope are read, never redefined — and
`src/prompt-literacy-rubric.json` is byte-identical before and after. A fixture
that needed the engine changed to pass would not be a fixture.

## What is pinned, and why these three states

| Fixture | The state it is | Why it is in the set |
| --- | --- | --- |
| `first-run-example` | the bundled example, unmodified, on the tier the sample itself names | the first score this product shows anybody, and the one a screenshot travels with |
| `first-run-example-edited` | the example edited in place, taking the coach's own first recommendation | proves the advice moves the number it claims to move |
| `first-run-example-replaced` | the example cleared and replaced with a different, substantive request | proves nothing of the first-run reading is left behind in any figure |

All three name the **premium** tier, because that is the tier
`COACHING_SAMPLES` gives the first-run example. No figure below moves because a
tier moved; every difference between fixtures is attributable to the text.

## The arithmetic, in full

An axis starts at a baseline, each fired signal adds its contribution, the sum
is clamped to 0–100, and the composite is the weighted sum of the three axis
scores, rounded **once**, at the end.

```
axisScore  = clamp(baseline + Σ signalContribution, 0, 100)
composite  = round(Σ axisScore x weightPercent / 100)
```

### `first-run-example` — "can you improve this…"

| Axis | Baseline | Fired signals | Sum | Score | Weight | Contribution |
| --- | --- | --- | --- | --- | --- | --- |
| Intent | 40 | `intent-vague-request` −12 | 28 | 28 | 50% | **14** |
| Efficiency | 85 | none | 85 | 85 | 30% | **25.5** |
| Model fit | 80 | none | 80 | 80 | 20% | **16** |

Unrounded composite **55.5** → published **56** · grade **F** · **4 points**
from D (D starts at 60).

Two things this fixture exists to state plainly:

- **The half point is real.** 55.5 is the arithmetic; 56 is the published
  integer. There is exactly one rounding, at the end, and the test asserts both
  the ≤ 0.5 bound and that the rounding did not move the letter. A rounding that
  ever crosses a cutoff is a disclosure a reader is owed, so it fails the test
  rather than shipping quietly.
- **`intent-vague-request` saturated.** The example contains five matches
  ("improve this", "somehow", "fix it", "make it better", "as needed"). It is a
  *rate* signal whose strength caps at 1, so the contribution is −12, the weight
  itself. The count is evidence, not a multiplier — five vague phrases cost
  exactly what one saturating rate costs.

### `first-run-example-edited`

| Axis | Baseline | Fired signals | Sum | Score | Weight | Contribution |
| --- | --- | --- | --- | --- | --- | --- |
| Intent | 40 | `intent-states-context` +18, `intent-states-constraints` +18, `intent-structured-layout` +18 | 94 | 94 | 50% | **47** |
| Efficiency | 85 | none | 85 | 85 | 30% | **25.5** |
| Model fit | 80 | none | 80 | 80 | 20% | **16** |

Unrounded **88.5** → **89** · grade **B** · **1 point** from A.

The reported movement against the example is **+33**, F → B. That is the whole
of the intent movement at its published weight: (94 − 28) × 50% = 33. No other
axis moved, and the test asserts that identity rather than only the delta.

### `first-run-example-replaced`

| Axis | Baseline | Fired signals | Sum | Score | Weight | Contribution |
| --- | --- | --- | --- | --- | --- | --- |
| Intent | 40 | four intent credits, +18 each | 112 | **100** (clamped) | 50% | **50** |
| Efficiency | 85 | none | 85 | 85 | 30% | **25.5** |
| Model fit | 80 | `model-fit-substantive-on-premium` +20 | 100 | 100 | 20% | **20** |

Unrounded **95.5** → **96** · grade **A** · nothing above this band.

**The clamp binds here and is stated rather than hidden.** The intent signals
add 72 points to a baseline of 40; 12 of those points are unrealised because the
axis stops at 100. A reader comparing "four credits fired" with "+60 on intent"
is looking at the clamp, not at a bug, and the fixture records `sum: 112`
beside `score: 100` so the difference has a name.

This is also the only fixture where the coach names **no** move — every penalty
is unfired and no credit has headroom worth points — and the only one carrying a
routing reading: `fit_evidenced`, worth the same 20 points the model-fit axis
gained. The recommendation's points are asserted to *be* that signal's
contribution, so a tier claim can never be worth more than the evidence under it.

## The assumption behind every weight

Every figure above is a baseline or a signal contribution multiplied by an axis
weight, so all three families of weight are load-bearing on a published number.

### Axis weights

| Axis | Weight | Assumption | Disagreeing with it means |
| --- | --- | --- | --- |
| Intent | 50% | Half the score, because intent is the only axis a reader moves by rewriting the request, and rewriting is the whole of what this coach asks for. | Believing routing or turn count is the bigger lever. Change 50 in the rubric and every composite here moves with it. |
| Efficiency | 30% | Wasted turns are real spend, but a symptom of weak intent rather than an independent skill. Above model fit, below intent. | Every fixture here is a single turn, so no efficiency signal can fire and this axis contributes its baseline — 25.5 points — to all three composites. It is stated because it is a quarter of the published number, not because it moved. |
| Model fit | 20% | The smallest share, because routing is a platform fix a gateway rule makes without the requester changing anything. Not zero: reaching for a frontier model to rename a variable is a judgement the requester made. | It is what separates the replaced fixture from the edited one — same intent ceiling, 20 points of model-fit credit the edit did not earn. |

### Axis baselines

Two of the three axes in the first-run example are their baseline and nothing
else, which makes the baselines as load-bearing as the weights.

| Axis | Baseline | Assumption |
| --- | --- | --- |
| Intent | 40 | A request earns intent credit by stating things, and starts below the passing line because a prompt that states none of them has told the model nothing. 40 asserts that an unadorned ask is a failing request, not a neutral one. |
| Efficiency | 85 | The first time you ask for something you are efficient. Efficiency is lost to evidence of a re-prompt spiral and never earned, because no single prompt can prove it would not have needed a second turn. The benefit of the doubt, not full marks. |
| Model fit | 80 | Routing is presumed adequate, lost to an observable mismatch, and earned back only in the one case this rubric can evidence: substantial work on a premium model. |

### Signal weights

The canonical text lives in `PROSE_SIGNALS`/`SIGNAL_ASSUMPTIONS` in
`src/prompt-prose-classification.js`. Rather than copy it, the test asserts, for
every signal any fixture depends on, that it is filed under the axis the
arithmetic credits it to, that its contribution never exceeds its weight, that
its sign matches its weight's, and that it carries an assumption key with text
behind it. **A signal that moved one of these published numbers with no stated
assumption fails the fixture set.**

## Coaching evidence and the ranking rule

| Fixture | First move | Kind | Worth | Runners-up |
| --- | --- | --- | --- | --- |
| `first-run-example` | `intent-states-acceptance` | credit | 9 | constraints 9, context 9, layout 9, `intent-vague-request` (fix) 6, pasted-context 4 |
| `first-run-example-edited` | `intent-pasted-context` | credit | 3 | `intent-states-acceptance` 3 |
| `first-run-example-replaced` | none available | — | 0 | — |

A move's worth is its weight on the composite scale: signal weight (capped by
the axis's remaining headroom, for a credit) × axis weight × the turn's share of
the conversation. These fixtures are single-turn, so the turn share is 1 and the
first-run example's four 18-point intent credits are each worth 18 × 50% = 9.

Ties break **points descending, measured before projected, then signal id**, and
the test re-derives that ordering across the whole ranking rather than trusting
the head of it. It is the rule that makes "the one move" the same move on two
machines — including the `first-run-example-edited` tie, where two credits are
each worth 3 and `intent-pasted-context` wins on the id alone.

Worth stating because it is disputable: in the first-run example a **projected**
credit worth 9 outranks a **measured** debit worth 6. The estimate is labelled
one, and the ranking prefers the larger number over the better-evidenced one.
A reader who thinks measured evidence should lead regardless of size is
disputing that ordering, not the arithmetic.

## Reproducibility, refresh, edit and replace

| Guarantee | How it is checked |
| --- | --- |
| Same text, same score | Each fixture is graded twice and the serialized sessions must be byte-identical. No clock, no randomness, no I/O in the path. |
| Refresh shows the same first-run figure | The shipped `buildSampleCoachingSession(PREVIEW_SAMPLE_ID)` path — the one a first visit actually takes — is built twice, compared byte for byte, and asserted against the fixture's composite, grade and first move. |
| The example is still the example | The fixture quotes `coachingSample("underspecified-request")`; a change to the bundled text or its tier fails here before it reaches a reader. |
| Editing is scored on the same scale as being shown it | Each fixture is graded once as a bundled sample and once as reader text; the envelope records the different source and the two `result` objects must be deeply equal. |
| Editing and replacing use the versioned path | The edited and replaced sessions must carry the example's own schema version, result version, rubric version id, classifier version, and aggregation rule id. |
| The versions are the ones these numbers were derived under | `literacy-mix/1.0.0`, `prompt-prose-classifier/1.0.0` and `prompt-coaching-session/1.0.0` are pinned literals. A bump fails this file first, which is the intended order: the numbers are re-derived and re-stated before anything ships under them. |
| The comparison still compares | The example/edit pair is run through `buildRevisionChange` and must be `compared`, +33, F → B, withholding nothing. |

## The share summary, and what it may not contain

The copyable summary is nine lines of labelled figures and static rubric copy.
It is pinned line by line in the test, so a share record cannot change shape
without a reviewer seeing it.

```
Prompt coaching — did my revised prompt improve?
Baseline: 56 / 100 · grade F
Revised: 89 / 100 · grade B
Change: Material change · improved · +33 points · 56 → 89 of 100.
Grade band: Grade band moved F → B.
Answer: Yes, with one thing left implicit.
Do this next: <static rubric copy for the remaining move>
Both grades: rubric literacy-mix/1.0.0 · classifier prompt-prose-classifier/1.0.0 · model tier premium
Both grades ran in this browser tab against a bundled rubric. No prompt text was sent, stored, or included in this summary.
```

| Guarantee | How it is checked |
| --- | --- |
| Text only | Every element of `lines` must be a string, and `text` must be exactly `lines.join("\n")`. A line that is a structure is a structure somebody will serialize. |
| Every figure traces to fixture evidence | Every number in the summary — the provenance line held out and checked whole, because its digits are version identifiers rather than measurements — must be one of the fixture's own figures. An untraceable number fails. |
| No submitted prompt text | A revision carrying an invented marker of each excluded class is graded and summarised; each marker is asserted present in the prompt and absent, in any case, from the summary, the change model and the session. |
| No prompt text by another route | Every distinct 24-character window of **both** sides of the comparison — the submitted revision and the first-run example it was compared against — is searched for in the summary and the change model. The marker scan proves nothing new is copied; the window scan proves nothing old is either. |
| The boundary travels with the record | The last line is always the boundary sentence, and the session states the same thing as data: `sentForCoaching: none`, `persisted: none`, `retainsAnalyzedText: false`, `integrationsContacted: none`. |
| Two people get the same record | The summary is built twice and compared. |

The excluded classes, each with an invented marker in the fixture prompt:

| Class | Markers searched for |
| --- | --- |
| Provider | `acme-cloud`, `INV-90210` |
| Credential | `ACME_API_KEY`, `sk-live-FIXTUREONLY-4Q7Z` |
| HRIS | `E-448812` |
| Customer | `Northwind Traders`, `ops@northwind.example`, `CU-55219` |

Every one of them is fictional and was written for this test. They are searched
for, never displayed, and the prompt around them is a real request so the
fixture grades rather than refusing — a redaction proof on a refusal proves only
that a refusal carries no text.

## What this fixture set deliberately leaves out

- **A change to any shipped surface.** No `src/` file moved. Prefilling the box
  with the example, or offering a "reset to the example" control, is a product
  decision for the coach's owner; this set pins what the shipped example already
  scores.
- **A pass/fail threshold on 56.** "Is a first-run F bad?" needs a population
  this workflow has no access to. Three hand-authored states are fixtures, not a
  baseline distribution, and treating them as one would publish exactly the kind
  of unexplainable number this repository refuses to show an executive.
- **Inter-rater agreement figures.** The rubric is a deterministic function, not
  a panel; there is nothing to agree. The reproducibility claim it *can* make —
  same input, byte-identical output — is the one asserted above.
- **A network or storage capability scan.** The static import graph reachable
  from the coaching entry is already walked for `fetch`, storage and cookie APIs
  in `tests/prompt-coaching-contract.test.js` and
  `tests/prompt-revision-delta-fixtures.test.js`. Repeating it here would add a
  third place for that claim to drift.
