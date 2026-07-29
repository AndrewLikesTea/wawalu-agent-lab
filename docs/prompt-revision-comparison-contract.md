# Prompt revision comparison contract — implementation handoff

`prompt-revision-comparison/1.0.0` — the versioned envelope a client receives
when it compares a **baseline** grade with a **revision** grade of the same
prompt, in one tab, in memory.

The client-consumed implementation is
`src/prompt-revision-comparison.js`. The executable fixtures in
`tests/prompt-revision-fixtures.test.js` pin the engine facts every expected
output below is derived from, while
`tests/prompt-revision-comparison.test.js` checks the shipped envelope and its
local-only boundary.

## The one question

> **Did my revised prompt improve?**

Everything below exists to answer that and refuses to answer a second question.
`prompt-coaching.js` answers "would a model answer this prompt well?" for one
text. This contract answers whether the second text is better than the first,
and by how much, using two of that engine's answers as its only inputs.

## The decision that makes the privacy guarantee hold

**The comparison consumes two coaching sessions, never two texts.**

```
buildRevisionComparison({ comparisonId, baseline, revision })
  baseline, revision: sessions from buildCoachingSession() (prompt-coaching-contract.js)
```

A coaching session already carries measurements of the analyzed text and never
the text (`prompt-coaching-contract.js`, `FORBIDDEN_SESSION_KEYS`, and the
marker test in `tests/prompt-coaching-contract.test.js`). By taking sessions as
its inputs, the comparison module never has access to prompt text at all, so its
privacy guarantee is a consequence of its signature rather than a discipline
someone has to maintain. An implementation that accepts `{baselineText,
revisionText}` and grades internally would be rejected in review: it would put
two untrusted strings inside the one module whose job is to be shown to a
leader.

The client-side consequence, stated so it is designed rather than discovered:
between the two grades the page holds **the baseline session object in a
JavaScript variable** for the lifetime of the tab. The baseline text stays in
the textarea, where the reader edits it into the revision. Nothing else holds
either.

### Guarantees, and what makes each checkable

These are additions to — never relaxations of —
`COACHING_LOCAL_ONLY_BOUNDARY`. An implementer asserts each one in
`tests/prompt-revision-comparison.test.js`.

| Guarantee | Checked by |
| --- | --- |
| Prompt text is not sent over the network | No module reachable from the comparison entry references `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, or `EventSource`. Reuse the existing reachability scan in `tests/prompt-coaching-contract.test.js`. |
| Prompt text is not persisted | No reachable module references `localStorage`, `sessionStorage`, IndexedDB, `document.cookie`, or `location.hash`/`search` assignment. The baseline is held in a variable, and a variable is not a store. |
| Neither text is retained in the envelope | Two texts, each carrying a distinct unique marker, are graded and compared; neither marker appears anywhere in the serialized comparison, at any depth. |
| The comparison cannot see text | `buildRevisionComparison` accepts sessions only. Passing a string for `baseline` or `revision` throws rather than being coerced. |
| Rubric criteria are unchanged | The comparison imports `prompt-literacy-rubric.json` only through `prompt-literacy-scoring.js` for the grade band table, computes no score, and declares no signal, weight, threshold, or cutoff. `PROMPT_LITERACY_RUBRIC` is byte-identical before and after this issue. |
| The single-prompt contract is not duplicated | The envelope's `baseline` and `revision` are whole sessions validated by `validateCoachingSession`. No field of `GRADED_RESULT_FIELDS` is re-listed, re-typed, or re-validated here. |

**Determinism.** Pure and synchronous. No clock, no randomness, no identifier
generation, no timestamp — for the same reason a session carries none. Two
sessions in, byte-identical JSON out, on any machine.

## The envelope

```
SCHEMA_VERSION = "prompt-revision-comparison/1.0.0"

COMPARISON_FIELDS = [
  "schemaVersion", "comparisonId", "question",
  "compared", "reason",
  "baseline", "revision", "comparison", "boundary",
]

COMPARISON_BODY_FIELDS = ["headline", "grade", "remainingWeakness", "nextAction"]
```

- `comparisonId` — opaque label, `COACHING_SESSION_ID_PATTERN` reused verbatim
  (1–64 letters, numbers, dots, underscores, hyphens). Never derived from text.
- `question` — the constant above. Not configurable.
- `compared` — boolean. `true` only when both sides are `graded` and the two
  runs are comparable (see **Abstention**).
- `reason` — `null` when `compared`, otherwise the abstention code.
- `baseline`, `revision` — the two sessions, unmodified. Each must satisfy
  `validateCoachingSession`; a comparison built from an invalid session throws.
  Their `sessionId`s must differ, so a reader quoting one is quoting one.
- `comparison` — always an object, never `null`. On abstention its first three
  fields are `null` and `nextAction` is still present (see **Next action**).
- `boundary` — constant, below.

```
COMPARISON_BOUNDARY = {
  sentForComparison: "none",
  persisted: "none",
  retainsAnalyzedText: false,
  baselineRetainedAs: "session_envelope",   // counts, not text; in memory only
  integrationsContacted: "none",
}
```

## Metric definitions

Precise enough that two engineers compute them the same way.

### The one headline benchmark: composite delta

```
headline.baselineScore = baseline.result.benchmark.score   // integer, 0–100
headline.revisionScore = revision.result.benchmark.score   // integer, 0–100
headline.delta         = revisionScore - baselineScore     // integer, -100..100
```

Read, never recomputed. `benchmark.score` is the rubric's composite, already
rounded to zero decimals by `reporting.compositeDecimals`. Subtracting two
integers is the whole of the arithmetic.

**One headline, and this one.** The alternatives were considered and cut:

- *Per-axis deltas* — three headlines is no headline. The axis movement is
  already in each session's `result.detail.axes`; a reader who wants it opens
  the evidence.
- *Percent improvement* — "58% better" on a bounded 0–100 scale is a number an
  executive will repeat and cannot defend. A point delta on a stated scale is
  defensible.
- *Grade letter alone* — a 9-point gain inside one band would read as no change.

`headline.text` is composed from the two figures and the direction, e.g.
`"+33 points · 56 → 89 of 100."` Zero renders as `"No change · 89 → 89 of 100."`

### Direction

```
direction = delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged"
```

No tolerance band. The rubric already rounds the composite to an integer, and a
second threshold here would mean two places decide what counts as a change.

**Stated limitation:** `unchanged` means unchanged *at the rubric's reported
precision*. Two texts whose raw composites differ by less than half a point both
report the same integer and compare as unchanged. That is the rubric's
precision decision (`reporting.assumption`), inherited on purpose rather than
worked around here.

### Grade delta and ordering

The band table is `PROMPT_LITERACY_RUBRIC.grades`, read in its published order —
best first, A at index 0 through F at index 4. Ordering is read from that array,
never written down a second time, so a band added to the rubric cannot leave a
stale ladder here.

```
fromIndex = grades.findIndex(g => g.letter === baseline.result.benchmark.grade)
toIndex   = grades.findIndex(g => g.letter === revision.result.benchmark.grade)

grade.from      = baseline letter
grade.to        = revision letter
grade.bandDelta = fromIndex - toIndex     // positive = moved up, negative = down
grade.moved     = bandDelta !== 0
```

`bandDelta` is positive for improvement because the array runs best-first and a
reader should never have to hold "negative means better" in their head. The sign
of `bandDelta` and the sign of `headline.delta` can disagree only in that
`bandDelta` may be `0` while `delta` is not; they can never point in opposite
directions, because the cutoff table is monotonic. An implementation asserts
that rather than assuming it.

### Abstention

Four codes. `compared` is `false` and `comparison.headline`, `.grade` and
`.remainingWeakness` are `null` whenever any fires. Checked in this order, first
match wins, so an abstention is a single stable code:

| `reason` | Condition | Why it is not comparable |
| --- | --- | --- |
| `baseline_not_graded` | `baseline.outcome !== "graded"` | There is no first figure. |
| `revision_not_graded` | `revision.outcome !== "graded"` | There is no second figure. The revision's own refusal reason stays on its session; a reader quotes that. |
| `rubric_changed` | `baseline.result.rubricVersionId !== revision.result.rubricVersionId`, or the two `classifierVersion`s differ | Two scores from two rubrics subtract to a number that measures the rubric change, not the rewrite. |
| `tier_changed` | `baseline.input.modelTier !== revision.input.modelTier` | Both model-fit debits and the one model-fit credit are gated on the tier the reader named. The model-fit axis can move from 20 to 100 on the tier alone — **up to 16 composite points**, at 20% axis weight — so a delta across a tier change mixes a rewrite with a routing change and attributes neither. Re-grade both on one tier. |

`tier_changed` treats `null` (no tier named) as a value: `null → "premium"` is a
tier change. Abstaining is the honest answer and it is cheap to recover from;
reporting a confounded delta is not recoverable, because the reader has already
repeated the number.

Abstention output carries its own short recovery — `{title, guidance, control}`,
the same shape `COACHING_RECOVERY` uses, with `control` naming an in-page
control so a surface can move focus instead of describing a fix. It does **not**
restate the single-prompt recovery copy: when the revision was refused, the
comparison points the reader at the revision session's own `result.recovery`.

### Remaining highest-priority weakness

The revision's own top-ranked improvement, **read and never re-ranked**.
`rankImprovements` already ordered every candidate by composite points, broke
ties measured-before-projected and then on signal id, and `gradeMyPrompt` put
the winner in `result.improvement`. Re-ranking here is how two screens name
different first moves for the same text.

```
remainingWeakness.signalId  = revision.result.improvement.id
remainingWeakness.axis      = revision.result.improvement.axis
remainingWeakness.title     = revision.result.improvement.title
remainingWeakness.guidance  = revision.result.improvement.guidance
remainingWeakness.rewrite   = revision.result.improvement.rewrite
remainingWeakness.points    = revision.result.improvement.points
remainingWeakness.baselineSignalId = baseline.result.improvement.id   // may be null
```

The one derived field is `status`, four states, total over the inputs:

| `status` | When |
| --- | --- |
| `none` | `revision.result.improvement.available === false` — nothing the rubric penalises fired and no intent credit is left worth points. Every copied field above is `null`. |
| `unaddressed` | Both sides have an available improvement and the ids are equal. The coach is still naming the same move. |
| `advanced` | Both sides have an available improvement and the ids differ. The named move changed, whatever the score did. |
| `emerged` | The baseline had none available and the revision does. |

`status` is the field that answers "am I making progress on the thing I was
told to fix?", which a score delta alone does not: a reader can gain four points
and still be told the same thing.

### Next action, prioritization and tie-breaks

**Exactly one**, in every state including abstention — the same discipline
`presentCoachingResult` enforces, for the same reason: two next steps of equal
weight hands the reader the ranking job. An implementation throws if it ever
builds a comparison with zero or two.

Selected from a fixed ladder, first match wins. The ladder is total and ordered,
so there is no tie to break between kinds:

| Rank | `kind` | Fires when | What it says |
| --- | --- | --- | --- |
| 1 | `abstain_recovery` | `compared === false` | What made the two runs incomparable, and the control that fixes it. |
| 2 | `revert` | `direction === "regressed"` | Keep the baseline. The revision scored lower, and the reader's next move is to go back, not to edit further. |
| 3 | `apply_remaining` | `remainingWeakness.status !== "none"` | The revision's own top-ranked change, its guidance and its ready-to-edit rewrite. Covers `improved` and `unchanged`. |
| 4 | `stop` | otherwise | Nothing higher-value is left to name; stop iterating on this prompt. |

**Why `revert` outranks `apply_remaining`.** A regressed revision still has a
top-ranked improvement, and presenting it first would coach the reader deeper
into a worse draft. The remaining weakness is still carried in the payload — it
is simply not the action.

**Tie-breaks.** There are none at this level, by construction. The only ranking
inside `apply_remaining` is the engine's, and this contract does not restate it:
points descending, then measured-before-projected, then signal id ascending
(`rankImprovements`). Where the ladder rank derives from a number, the number is
`headline.delta`, whose ties are exactly `direction === "unchanged"`, which the
ladder handles as an ordinary case rather than a tie.

## Executable representative fixtures

Every text below is hand-authored for this handoff and contains no real prompt,
customer, provider, or telemetry data — this workflow never had access to any.
The fixtures are written in the test file, not committed as a blob, so a shape
change fails a test rather than drifting.

All three pairs name the **standard** tier on both sides, so no model-fit signal
fires and the whole delta is attributable to the rewrite. That is deliberate: a
fixture whose delta was partly a routing change would not demonstrate the metric
it is a fixture for.

The engine facts in the last four columns are asserted in
`tests/prompt-revision-fixtures.test.js` against the shipped
`gradeMyPrompt`.

| Fixture | Side | Composite | Grade | `improvement.id` | `improvement.points` |
| --- | --- | --- | --- | --- | --- |
| `improved-revision` | baseline | 56 | F | `intent-states-acceptance` | 9 |
| | revision | 89 | B | `intent-pasted-context` | 3 |
| `unchanged-revision` | baseline | 89 | B | `intent-pasted-context` | 3 |
| | revision | 89 | B | `intent-pasted-context` | 3 |
| `lower-scoring-revision` | baseline | 89 | B | `intent-pasted-context` | 3 |
| | revision | 65 | D | `intent-states-acceptance` | 9 |
| `refused-revision` | baseline | 89 | B | `intent-pasted-context` | 3 |
| | revision | — | — | refused, `empty_input` | — |

Expected comparison output:

| Fixture | `compared` | `reason` | `delta` | `direction` | `grade` | `bandDelta` | `remainingWeakness.status` | `nextAction.kind` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `improved-revision` | `true` | `null` | `+33` | `improved` | F → B | `+3` | `advanced` | `apply_remaining` |
| `unchanged-revision` | `true` | `null` | `0` | `unchanged` | B → B | `0` | `unaddressed` | `apply_remaining` |
| `lower-scoring-revision` | `true` | `null` | `-24` | `regressed` | B → D | `-2` | `advanced` | `revert` |
| `refused-revision` | `false` | `revision_not_graded` | `null` | `null` | `null` | `null` | `null` | `abstain_recovery` |

Two of these are load-bearing beyond their arithmetic:

- `unchanged-revision` is a real edit — the two numbered request lines are
  reordered and one word is swapped for a synonym — that moves no signal. It is
  the fixture that proves `unchanged` is reachable and that `unaddressed` is
  distinguishable from `advanced` at an identical score.
- `improved-revision` gains 33 points and still returns an available
  improvement with a *different* id, which is the case that would be silently
  wrong if an implementation reported "no weakness remaining" on a large gain.

An implementer adds one more pair for `remainingWeakness.status === "none"` if
a text reaching `NOTHING_TO_IMPROVE` can be authored inside the input ceilings;
if it cannot, the `none` branch is covered by a constructed session and the
handoff's claim is that it is unreachable from reader text, not that it is
untested.

**Answered.** It can. `intent-rewrite-gain` in
`docs/prompt-revision-score-delta-fixtures.md` is a prose ask that saturates the
intent criterion at 100, returns `status: "none"` and `nextAction.kind: "stop"`,
and is graded from reader text rather than a constructed session. The fixture
guide breaks down all three deltas into two clearly labeled values: the
criterion score change and its weighted contribution to the composite. It does
not add per-axis figures to this envelope.

## Acceptance criteria

Written as the question a leader is asking, not the widget that displays it.

1. **"Did my revised prompt improve?"** — The comparison returns one signed
   integer on a stated 0–100 scale and one word (`improved` / `unchanged` /
   `regressed`), derived only from the two composites, with no second figure of
   equal weight beside them.
2. **"By enough to matter?"** — The band movement is reported alongside the
   delta, using the rubric's own cutoff table and ordering, so a 9-point gain
   inside a band is visibly not a letter change and a 2-point gain across a
   cutoff visibly is.
3. **"Am I fixing what I was told to fix?"** — The comparison says whether the
   coach is still naming the same first move (`unaddressed`), a different one
   (`advanced`), a newly surfaced one (`emerged`), or none (`none`) — without
   re-ranking anything.
4. **"What do I do next?"** — Exactly one next action, in every state including
   every abstention, and it is `revert` rather than more coaching whenever the
   revision scored lower.
5. **"When should I not trust this number?"** — The comparison refuses to
   produce a delta at all when a side was not graded, when the rubric or
   classifier version moved, or when the model tier changed between runs, and it
   names which of the four in a stable code a reader can quote.
6. **"What happened to my text?"** — The comparison module is structurally
   incapable of seeing prompt text: it accepts sessions, throws on a string, and
   a two-marker test finds neither marker anywhere in the serialized output.
7. **"Is this still the same rubric?"** — `prompt-literacy-rubric.json` is
   unchanged by this issue, and no criterion, weight, threshold or cutoff is
   declared in the comparison module.

Each criterion is met by a test, not by review. A criterion with no test is not
met.

## Reading order, for the surface that comes later

Stated here so the later UI issue inherits a decision rather than making one,
and matching `PRESENTATION_ORDER`'s logic: the answer, then what makes the
answer mean something, then exactly one thing to do, then the dispute material.

```
["headline", "grade", "action", "evidence"]
```

`evidence` is a disclosure holding the two sessions — which means the
single-prompt presentation model (`presentCoachingResult`) renders each side
unchanged rather than a second, thinner rendering of a result being written.

## What this contract deliberately leaves out

Each of these was considered and cut because it adds surface without answering
"Did my revised prompt improve?".

- **A revision history.** The envelope holds exactly two sides. The loop is
  achieved by promoting the revision to baseline and grading again; what carries
  across that promotion is one session object and nothing else. A list of past
  attempts is a store, and a store needs a consent decision this issue does not
  grant.
- **A text diff of the two prompts.** It is the single most requested feature
  here and it is the one thing that cannot be built: rendering a diff requires
  holding both texts in the comparison, which is exactly the guarantee this
  contract exists to make. Said plainly rather than deferred.
- **Per-axis and per-signal deltas.** "You gained `intent-states-context`" is
  the rubric's detail, already on each session. Three deltas beside the headline
  is three headlines.
- **A percentage improvement.** See the metric definition; a percent of a
  bounded scale is a number that travels further than its evidence.
- **Any claim that the revision will get a better answer from a model.**
  `ROUTING_CLAIM_LIMIT` governs here unchanged: this workflow reads the text and
  the tier named. It measures no answer, no follow-up turn, and no spend, and
  claims none. A comparison of two rubric scores is a comparison of two rubric
  scores.
- **Time-to-improve, edit distance, or attempt counts.** All three require
  either a clock or retained text, and none of them changes what the reader does
  next.
- **A "coaching works" aggregate across readers.** That is a telemetry claim,
  and the boundary forbids the telemetry that would back it. The honest version
  of that metric does not exist in this product and should not be approximated.
- **A team or organization reading.** Two texts is not a corpus. The floor
  stays `prompt-grading-eligibility.js`'s `minPromptsPerDepartment`, and each
  session's `result.basis` already says so.
