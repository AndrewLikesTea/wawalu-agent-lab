# The prose prompt-literacy rubric

This is the paper form of `src/prompt-prose-classification.js`. Everything a
score depends on is listed here with the assumption behind it, so a director who
disputes a grade can recompute it by hand from their own prompt and this page —
no code, no export, no ticket.

The published corpus is `tests/fixtures/prompt-prose/corpus.js`. Every fixture
there carries a `derivation` string doing exactly the arithmetic below.

## What gets graded

Three dimensions, on the 0-100 scale the existing rubric
(`src/prompt-literacy-rubric.json`) already publishes, weighted into one
composite by that rubric's own axis weights: **intent 50%, efficiency 30%,
model fit 20%**. The letter is that rubric's cutoff table, unchanged: A at 90,
B at 80, C at 70, D at 60, F below.

Each **user turn** is scored on its own, then the turns are combined once. See
"Aggregation" below.

## Before anything is scored: segmentation

Each turn body is split into three kinds of material.

| Kind | How it is recognised | Effect |
| --- | --- | --- |
| Code | A fenced block (```` ``` ````/`~~~`), or two or more consecutive lines indented four spaces or a tab | Removed. No pattern runs over it and it does not count toward length. |
| Pasted context | A block of 8+ lines and 600+ characters, or a block of 3+ lines where at least half look verbatim (timestamped log line, tab/comma/pipe table row, `>` quote, `key=value` dump, stack frame) | Removed from length, and fires `intent-pasted-context`. |
| Prose | Everything left | The only thing patterns run against, and the only thing length is counted from. |

**Assumption.** Eight lines and 600 characters is longer than any one paragraph
we expect somebody to type into a prompt by hand; past that, the likeliest
reading is that the block was carried in from somewhere else. A block that is
short but *shaped* like a log is a log at any length, because shape is stronger
evidence than size — but a majority of its lines has to agree, so one
comma-heavy sentence inside a paragraph stays a sentence.

Misreading composed prose as pasted removes it from the numerator *and* the
denominator at the same moment, so a wrong call here cannot quietly push a score
in one direction.

**Prose units.** Length is counted in prose units: one word of a spaced script,
or **two characters** of an unspaced one (Han, Hiragana, Katakana, Hangul,
Thai). Assumption: those scripts write no word boundaries, so splitting on
whitespace reads a 400-character Japanese request as three words and then grades
it as if the director had typed three words. Two characters per unit is a
declared approximation — it sizes a request, it does not tokenize one.

## Baselines

| Dimension | Starts at | Assumption |
| --- | --- | --- |
| Intent | **40** | A request that states nothing is a coaching gap, not leakage — the middle of the failing band, not the bottom of the scale. Intent is the only dimension a person moves by rewriting, so it is the only one that is mostly earned. |
| Efficiency | **85** | The first time you ask for something, you are efficient. Efficiency is lost to observable evidence of a re-prompt spiral and is never earned, because no prompt can prove it would not have needed a second turn. 85 is the middle of the B band: the benefit of the doubt, not full marks. |
| Model fit | **80** | Routing is presumed adequate for the same reason. It is lost to an observable mismatch and earned back only in the one case we can evidence. |
| Intent, when the language is uncertain | **58** | When we cannot read a turn we may not credit it for stating its context and may not debit it for failing to. 58 is the top of the D band — a published statement that the grader could not read this request. Layout signals still apply, so an organised request in any language can climb out of it. |

## The signals

`presence` fires once or not at all and contributes its whole weight.
`rate` contributes `weight × min(1, rate ÷ 2)`, where the rate is occurrences
per **100 prose units** against a denominator floored at **25**.

### Intent

| Signal | Kind | Weight | Assumption |
| --- | --- | --- | --- |
| `intent-states-context` | presence | **+18** | A request that supplies its own setting is the first of the three things the intent axis asks for. Equal weight with the other two because the rubric names no order among them. |
| `intent-states-constraints` | presence | **+18** | A request that states its boundaries. Equal weight, same reason. |
| `intent-states-acceptance` | presence | **+18** | A request that says what a correct answer is. Three of three carries intent from the baseline to the top of the scale. |
| `intent-structured-layout` | presence | **+18** | Two or more labelled (`Label:`) lines, or two or more list lines. Layout survives translation where vocabulary does not, so this is the signal that lets a non-English request reach a good intent score. |
| `intent-pasted-context` | presence | **+8** | Pasting the corpus is supplying context by other means. Worth less than saying what the context is *for*, because the reader still has to infer the question from the material. |
| `intent-vague-request` | rate | **−12** | Hedges and placeholder nouns leave the model to choose what was meant. Debited at a rate so a long request is not punished for containing the word "something" once. |
| `intent-out-of-scope` | presence | **−40** | Personal-life and entertainment vocabulary. Heavy enough to take intent to zero on its own, because leakage that is well written is still leakage and must not carry credit into a team's grade. |

### Efficiency

| Signal | Kind | Weight | Assumption |
| --- | --- | --- | --- |
| `efficiency-repeated-request` | rate | **−35** | The re-prompt spiral in its own words: the requester is restating a question the previous turn did not answer. The cost is the extra call. |
| `efficiency-corrected-request` | rate | **−35** | A correction turn. Same weight as a repeat, because the spend is the same and which of the two happened is not the requester's to argue. |
| `efficiency-scattered-questions` | presence | **−10** | Four or more question marks in a turn under 120 prose units. Small weight: it is a style, not a spiral. |

### Model fit

| Signal | Kind | Weight | Fires only when | Assumption |
| --- | --- | --- | --- | --- |
| `model-fit-trivial-on-premium` | presence | **−60** | model tier is `premium` **and** the turn is ≤ **60** prose units | A mechanical edit sent to a premium model, and only when the turn is short enough that the edit *is* the request. This is the routing error the axis exists to name, so it is the largest single debit on it. |
| `model-fit-substantive-on-economy` | presence | **−25** | model tier is `economy` **and** the turn is ≥ **150** prose units or carries ≥ 800 characters of code | Substantial work asked of an economy model. Well below the premium-for-trivia case because under-provisioning costs quality, which the requester absorbs, rather than money, which the company does. |
| `model-fit-substantive-on-premium` | presence | **+20** | model tier is `premium` **and** the turn is ≥ **150** prose units | Substantial work on a premium model is the routing decision the rubric calls full marks. Credited only on observable length, never assumed. |

Model tiers come from the billing contract's own table
(`classifyModelTier`), not from a second opinion about model names here.

**Rate saturation, 2 per window.** Twice in a paragraph is a habit; once is a
word choice. So one hedge per 100 units costs half the weight and three cost the
same as two. The cap exists so no dimension can be driven to zero by one signal
repeated.

**Rate denominator floor, 25 units.** Without it, a six-word turn containing one
hedge reports 16.7 hedges per 100 units and takes the full debit for a single
word. Twenty-five units is about two sentences; below that there is not enough
prose for a rate to mean anything, so the rate is stated as if there were.

The dimension score is the baseline plus every contribution, clamped to 0–100.

## Language

Coarse script detection, on derived counts only. Above **20%** non-Latin
letters, the English vocabulary table is not trusted and the turn is flagged
`language_uncertain`; the intent baseline becomes 58 and the layout and
pasted-context signals — which read counts, not words — still apply.

Between 20% and 80%, the turn is *also* `language_mixed`. There, English credit
signals still fire and English debit signals do not: a marker that matched is
real evidence, while a marker that did not match is not evidence of absence.

A non-English turn is always **scored**. It is never dropped, never silently
zeroed, and never becomes unclassified for being in another language. Both flags
travel in the reasons payload as codes.

## Aggregation

**Rule id: `prose-length-weighted-mean/1`.** Implemented in exactly one place,
`aggregateTurnScores`. Nothing else in the codebase may average, floor, or
best-of a turn score.

Each scored user turn is weighted by its prose units, floored at **20**. Each
dimension is the weighted mean of the turn scores; the composite is the rubric's
axis weighting of the unrounded means, rounded once at the end.

**Assumption.** We weight by prose length because a one-line follow-up should
not outvote the substantive opening turn that set up the work. We floor the
weight because a one-line follow-up is still a turn, and the shortest turns are
the ones the efficiency axis is looking for. A mean and not a worst-of, because
one bad turn inside a productive conversation is a moment rather than a grade; a
mean and not a best-of, because a grade that reports your best turn is not a
grade. The consequence, stated rather than hidden: a long, well-formed opening
turn can carry several sloppy follow-ups, and a director who thinks that is
wrong is arguing with this paragraph rather than with an unexplainable number.

Turns the classifier refused to grade contribute nothing in either direction.
Assistant turns are skipped entirely — an assistant turn was never a prompt.

## The category label

Derived *from* the scores, never an input to them. Read worst-first, in the same
precedence order a tied excerpt uses:

1. intent ≤ 0 → **out-of-scope**
2. efficiency < 50 → **inefficient**
3. model fit < 50 → **over-provisioned**
4. intent ≥ 70 → **high-value**
5. otherwise → **unclassified**

A conversation takes the worst label any of its scored turns earned; labels are
not averaged, because averaging names is how one leaked prompt in eight becomes
invisible. "Unclassified" here means "none of the rubric's four names fits" — a
competent request that stated no context genuinely is not one of them. It does
**not** mean the turn was ungraded: it has three scores and a letter.

## Coverage, and the number that guards it

A regression that quietly stops reading real prose shows up as prompts falling
out of `scored` and nowhere else — the scores that remain still look fine. The
guard is a ceiling on the corpus's unclassified rate, asserted in
`tests/prompt-prose-classification.test.js`.

- **Measured: 0.0333** — one user turn in thirty, and that one is a code-only
  turn with no prose in it, which *should* be refused.
- **Ceiling: 0.1** — three times the measured rate. The corpus is small enough
  that adding one honest no-prose fixture moves the rate three points, and a
  ceiling that fires on new fixtures rather than on regressions gets trained
  away within a month. It is not loose enough to hide a real failure: dropping
  one ordinary prose turn takes the rate to 0.067, and dropping the non-English
  fixtures — the regression this exists for — passes 0.1 immediately.

## Privacy

Classification runs on derived signals, in the tab, with no network call, no
server round trip, and no persistence. The reasons payload is built from an
allowlist of numbers, booleans, and identifiers this module owns; there is no
key at any depth a substring of a prompt could occupy, including in reason codes
and in anything the module throws. This mirrors Anya's conversation-export
contract, which turns a never-render prompt column into `prompt_chars` and has
no field the body could survive in.

**One divergence worth knowing.** That contract carries counts and never text,
by design, so the prose classifier cannot read prompt bodies out of an imported
export — there are none in it. Bodies are supplied by the caller from the tab's
own in-memory copy, and this module keeps them exactly as long as one function
call. The contract was not widened to carry text, and should not be.
