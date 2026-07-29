# Reproducible executive briefing fixtures

`executive-briefing-fixtures/1.0.0` pins what an executive briefing claims in
every state a presentation consumer has to render differently, so the surfaces
that land later build against a stable expected output rather than against
whatever `buildExecutiveBriefing` happened to return the day they were written.

Executable form: `tests/executive-briefing-fixtures.test.js`.
Labelled cases: `tests/support/executive-briefing-cases.js`.
The contract they read: `docs/executive-finops-briefing-contract.md`.

**Every figure in this document is asserted there. A figure here with no
assertion there is not a claim this repository makes.** Nothing in `src/`
changed for this fixture set: a fixture that needed the engine changed to pass
would not be a fixture.

## How to run

```
node --test tests/executive-briefing-fixtures.test.js   # this file alone
npm test                                                # the whole suite
npm run check                                           # tests + build + verify
```

The cases are generated in the test process from one builder rather than
committed as JSON. They are three or four aggregate records apiece, and a
builder that states only what a case varies is the thing a disputed number gets
read against. `src/executive-finops-briefing-fixture.json` remains the canonical
*sample* — one briefing, whole — and Noor's suite still asserts it deep-equals
what the contract builds. This set is the *coverage*: twelve labelled states,
each pinned to the claims a consumer binds to.

The executive briefing page no longer fetches that file. Its three input periods
are carried in the bundle by `src/executive-briefing-sample.js`, so a browser
with nothing retained paints a whole briefing on the first screen rather than
waiting on a request that can fail. The fixture is still the published record the
module is held to: `tests/executive-briefing-local.test.js` asserts the module's
periods deep-equal `input.retainedPeriods` and rebuild `briefing`, and
`scripts/verify-build.mjs` repeats both against the built artifact. Change one
without the other and the build fails rather than two samples shipping.

## The labelled set

`grade` is the eligibility verdict the reader is shown: **eligible** when a
retained period can found the finding, **ineligible** when none can. It is the
same predicate `buildExecutiveBriefing` applies; naming it lets the set be read
as coverage of both verdicts.

| Case | Grade | Primary metric | Confidence | Benchmark | Action |
| --- | --- | --- | --- | --- | --- |
| `eligible-benchmarked-in-line` | eligible | 480,000 · 120,000 ppm | high | in line (baseline 117,500, variance +2,500) | `pilot_routing`, capped 480,000 |
| `eligible-benchmark-less-verify` | eligible | 200,000 · 50,000 ppm | high | less (variance −67,500) | `verify_prior_change` |
| `low-confidence-missing-inputs` | eligible | 480,000 · 120,000 ppm | low | in line | `improve_attribution` |
| `low-confidence-attribution-below-floor` | eligible | 480,000 · 120,000 ppm | moderate | in line | `improve_attribution` |
| `action-rank-tie-all-preconditions` | eligible | 200,000 · 50,000 ppm | low | less | `improve_attribution` (rank 1 of 3 that qualify) |
| `benchmark-unavailable-insufficient-history` | eligible | 480,000 · 120,000 ppm | moderate (ceiling) | `insufficient_history` | `pilot_routing`, capped |
| `benchmark-unavailable-period-gap` | eligible | 480,000 · 120,000 ppm | moderate (ceiling) | `period_gap` | `pilot_routing`, capped |
| `benchmark-unavailable-null-spend` | eligible | 480,000 · 120,000 ppm | moderate (ceiling) | `null_spend` | `pilot_routing`, capped |
| `example-dataset-mixed-history` | eligible | 480,000 · 120,000 ppm | low (ceiling) | in line | `pilot_routing`, capped |
| `tied-period-selection` | eligible | 480,000 · 120,000 ppm | moderate (ceiling) | `insufficient_history` | `pilot_routing`, capped |
| `ineligible-no-period-can-found-a-finding` | ineligible | absent: `no_eligible_period` | insufficient | absent | absent: `no_primary_finding` |
| `ineligible-empty-workspace` | ineligible | absent: `no_retained_periods` | insufficient | absent | absent: `no_primary_finding` |

Money is `usd_minor`; a share is an integer in parts per million.

Each case pins the *claims projection* — reporting period, primary metric,
benchmark, primary finding, prioritized action, confidence, provenance,
limitation codes, selection tie-break, and absence reasons. Wording is not
pinned per case: every limitation statement, action statement, confidence
meaning, and absence statement is asserted to be the module's own catalogue
entry verbatim, so a reworded sentence fails once instead of in twelve places.

## The arithmetic, so a reviewer can check a number by reading it

Every period analyzes **4,000,000** usd_minor, so a recoverable scenario of `r`
has a share of exactly `r ÷ 4` ppm and no rounding step hides in any case. The
two priors sit at 115,000 and 120,000 ppm, so the baseline is their mean —
**117,500 ppm**, already an integer, so no case depends on how a mean rounds.

```
sharePpm    = round_half_away_from_zero(recoverableScenarioMinor ÷ analyzedSpendMinor × 1e6)
baseline    = round_half_away_from_zero(mean(prior sharePpm))
variance    = reporting sharePpm − baseline
standing    = in_line_with_baseline when |variance| ≤ 10,000
```

## Assumptions behind every weight and ordering

Stated because each one is the thing a graded director will dispute first.

1. **The action catalogue is ranked ordinally, not scored.** Rank 1
   `improve_attribution` < rank 2 `verify_prior_change` < rank 3
   `pilot_routing`, and the selected action is the lowest rank whose
   precondition holds. The assumption: a figure whose inputs are thin cannot be
   acted on at all, and a shrinking pool asks for verification of the last
   change before a new commitment. No numeric weight is combined, because a
   combined score would let two weak signals outvote a disqualifying one.
2. **A tied ranking resolves to the lowest rank, always.** Preconditions are not
   exclusive: `action-rank-tie-all-preconditions` satisfies all three at once.
   The test asserts that case yields rank 1, and that the same input with only
   `confidence` relaxed yields rank 2, and with only
   `recoverableScenarioMinor` relaxed yields rank 3 — so the ordering, not the
   input, is what moved.
3. **Period selection is recency-first.** Label descending, then
   `recoverableScenarioMinor`, then `recordsAnalyzed`, then `derivedAt`, then
   `periodId` ascending. The assumption: a leader acts on the current month, not
   on the largest month ever recorded. `periodId` is unique per retained period,
   so the order is total and arrival order cannot decide a winner — every case
   is asserted against all orderings of its input, and each of the five steps
   has its own test naming the step that decided.
4. **The material variance band is 10,000 ppm** — one percentage point of
   recoverable share. The assumption: month-over-month moves smaller than a
   point are derivation noise, not a change in behaviour, and a briefing that
   called them a move would ask for a pilot every month.
5. **The attribution floor is 50%** and **full coverage is 900,000 ppm**, both
   imported from `finops-attribution-policy.js` and the briefing contract rather
   than restated here. One vocabulary, one threshold.
6. **Three periods minimum, gapless, all with positive analyzed spend**, or the
   benchmark is ineligible with a reason and a `null` baseline — never a zero
   baseline and never an omitted comparison. A share nobody could compute is
   `null`, never `0`.
7. **Confidence is the weakest of the period's own level and two ceilings**
   (`moderate` when the benchmark is ineligible, `low` when the dataset is not
   the reader's own import) and is never recomputed here. The tests assert a
   briefing never claims *more* confidence than the record it read, and that a
   ceiling never ships without its reason.

## Redaction and the allowlist

Three separate claims, each with its own test, because they fail differently.

- **Undeclared fields cannot propagate.** A retained period carrying a prompt,
  an imported row, a file name, an API key, a customer email, and a provider
  payload produces a briefing that contains none of those values and none of
  those field names, while still producing the correct figures from the same
  record. A companion test asserts the poisoned record is itself refused by
  `scanRetainedContent`, so the redaction check cannot pass vacuously.
- **Only the closed record shape is readable.** Every name in
  `method.readFields`, plus the two further fields provenance emits
  (`periodId`, `sourceFingerprint`), is a member of `FINOPS_PERIOD_FIELDS` — the
  retained-period contract's closed field list. An import-shaped field is not
  nameable, not merely unused.
- **No briefing in the set carries a link or free-form prose.** Every leaf
  string is checked against `FORBIDDEN_LINK_PATTERN` and the 400-character
  limit, and `safety.shareableLinkSupported` is `false` in all twelve.

### The limit of the allowlist, stated

Allowlisting a field *name* is not sanitizing its *value*. `sourceFingerprint`
and `topDepartmentId` are read verbatim, so a workspace that stored a credential
or an email address in one produces a briefing that **carries** it — and
`validateExecutiveBriefing` rejects that briefing (`bearer_token`,
`email_address`, `free_form_text`). That is asserted, and it is the reason for
the consumer rule below.

## What a presentation consumer may rely on

- Render only a briefing `validateExecutiveBriefing` accepted. The value-level
  scan lives in the validator, not in the builder.
- Render `confidence.meaning` beside `nextAction`. The rank-1 precondition reads
  the period's *stored* confidence while `confidence.level` also applies the
  dataset and benchmark ceilings, so a briefing can read `low` while
  recommending a capped pilot — `example-dataset-mixed-history` is exactly that
  state, and it is pinned so the pairing is a decision rather than a surprise.
- Treat an absent slot as a sentence, not a zero. Every absence carries the
  contract's authored statement, asserted verbatim.
