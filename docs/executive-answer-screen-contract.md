# The executive answer screen contract

**Version:** `finops-screen-contract/1.0.0` ·
**Executable form:** [`src/finops-screen-contract.js`](../src/finops-screen-contract.js) ·
**Surface:** `/evolution.html`

A CTO opens `/evolution.html` to settle one thing and then leave. This document
names the five destinations that page has, the single question each one answers,
and the single metric that answers it. The strings a reader sees are exported
from the module above and painted from it, so this document and the screen
cannot say different things.

The rule this contract exists to enforce: **a destination answers one question
with one metric.** A destination that would need two metrics is two
destinations, and a metric that answers no destination's question is not shipped.

---

## 1. `answer` — the block above everything

> **Question.** Is our AI spend classification trustworthy enough to act on?

**The single metric: Spend we can stand behind** (`stand-behind share`, and that
label is the one rendered on screen). The percentage of the spend in scope
that sits in departments the scoring rubric actually scored — the share of the
money this page's grade is standing on.

| | |
| --- | --- |
| **Numerator** | `summarize(scored).spendUsd`, where `scored` is every department in the population for which `departmentPerformance(department).available === true` — sampling status `available`, a positive integer sampled-query count, and at least one non-zero category share. No partial credit is invented for a department the rubric skipped, declined, or reported a reason for. |
| **Denominator** | `summarize(population).spendUsd` — the same accessor over the whole population, so numerator and denominator are the same field measured the same way. |
| **Population** | The analysed department set behind the answer currently held on screen: `analysis.rankedDepartments` for a reader's own import, the bundled example's departments otherwise. It is the same list the printed spend total rolls up. |
| **Filter** | None. Not filtered by period, department, model, or provider. A negative or non-finite `spendUsd` on a row is coerced exactly the way the printed total coerces it. |
| **Rounding** | `formatPercent(ratio, { digits: 1 })` — that is `(ratio * 100).toFixed(1)` with a `%` suffix. One decimal, half-up at the last digit, the same call the score card's coverage line already makes. Never rounded before this point; the ratio is carried raw in `[0, 1]`. |
| **Unit** | Percent of US dollars of spend in scope. Not a percent of queries, departments, or people. |
| **Guard** | A denominator that is missing, non-finite, zero, or negative has **no** ratio. It is not 0% and it is not a bad score: the figure is withheld and the block says there is no spend baseline. |
| **As-of basis** | The dataset the answer was composed from (`Bundled synthetic example` or `Imported`) and the analysis period, rendered together with the figure in one announcement. Both come from the held answer, never from a clock. |

**The grade threshold is a publication gate, not a numerator filter.** See
§5 — this is the one place this contract departs from the wording it was
commissioned with, and the departure is deliberate. The figure is published only
when `gradeExport().state` is `graded` or `provisional`. In `below_bar` and
`no_baseline` no percentage is shown at all; the block states which state it is
in and what would resolve it.

**Deliberately excluded from this destination.** The peer rank band, the
recoverable-dollar figure, the letter grade itself, the classifier-agreement
rate, and every trend. Each is a real figure this page already publishes
elsewhere, and none of them answers *is this trustworthy enough to act on*. They
would be a second number beside the one number, which is the defect this block
was written to remove.

### The confidence sentence

One sentence, naming the actual inputs the figure was computed from and their
as-of basis. It names, in this order:

1. **coverage** — the covered and total spend in dollars, so the percentage can
   be re-divided by hand;
2. **grade** — the coverage tier the eligibility evaluator assigned and the
   published rule for that tier (`COVERAGE_TIERS[].rule` in
   `src/grade-eligibility.js`), so the bar the figure was judged against is on
   screen with it;
3. **residue** — the spend in scope that no scored query covers, in dollars,
   and the single largest unscored department;
4. the dataset and period it is all as of.

It is never "based on recent data", and it never names an input that did not
enter the computation. **Classifier agreement is not named here**, because it
does not: the agreement rate measures `classifyQuery` against a hand-labelled
corpus of invented queries and is not an input to stand-behind share. Naming it
in a provenance sentence would claim an evidential link that does not exist.

### The next action, and how its priority is chosen

One action. When more than one is arguably first, it is chosen by **the largest
correctable residue**: the unscored department with the greatest unscored spend,
ties broken lexicographically on the department key, which is
`topCluster()` in `src/export-gradability.js` and the same ranking
`gradeEligibility().nextAction` already publishes. The two states with no
residue to rank are handled ahead of it:

| Gradability state | Priority rule | Where the action goes |
| --- | --- | --- |
| `no_baseline` | Nothing can be ranked without a denominator. | `#local-import` — the page's own file picker |
| `below_bar` | Largest unscored spend | `#department-decision-panel` — the `departments` destination |
| `provisional` | Largest unscored spend | `#department-decision-panel` — the `departments` destination |
| `graded` | No residue worth correcting; the figure stands. | `/savings-action-center.html` — the `act-and-verify` destination |

The action is a real anchor with a real `href`, operable before any script runs,
and its accessible name says what it does and where it goes.

---

## 2. `evidence` — what was this computed from?

> **Question.** What was this computed from?

**The single metric: Sampled-query coverage of the scored sample**, published as
the score card's coverage line — the same `sampledSpendCoverage` ratio as above,
rendered at one decimal beside the tier label and the names of the departments
that produced no grade.

* **Computation.** Identical to §1's numerator and denominator; this destination
  shows the *inputs* rather than the verdict, so it may not compute a second
  version of the number. It reads `gradeEligibility(departments)` and renders
  `formatPercent(coverage, { digits: 1 })`.
* **As-of basis.** The same dataset and period as the answer. Evidence for an
  answer composed from another dataset is not evidence.
* **Target.** `#recommendation-evidence`.
* **Deliberately excludes.** Any recommendation, any dollar projection, and any
  claim about what to do. This destination is allowed to say what was read and
  what was skipped, and nothing about what follows from it.

---

## 3. `departments` — where is the problem concentrated?

> **Question.** Where is the problem concentrated?

**The single metric: Unscored spend per department**, in US dollars, ranked
descending — `summarize([department]).spendUsd` for each department where
`departmentPerformance(department).available === false`, ties broken
lexicographically on the department's name (falling back to its id).

* **Rounding.** Whole dollars, `formatUsd` — `maximumFractionDigits: 0`.
* **As-of basis.** The same dataset and period as the answer.
* **Target.** `#department-decision-panel`.
* **Deliberately excludes.** Per-department letter grades. A department the
  rubric did not score has no grade, and printing one derived from the
  organization roll-up would attribute a number to a team it was never measured
  on. It also excludes headcount-normalised spend: this destination ranks the
  correctable residue, not efficiency.

---

## 4. `act-and-verify` — what do I do next, and how will I know it worked?

> **Question.** What do I do next, and how will I know it worked?

**The single metric: Monthly savings committed against monthly savings verified**,
in US dollars, as the Savings Action Center already publishes it
(`monthlySavingsMinor` on a recorded commitment, against the reconciled figure
for the same period).

* **Rounding.** Whole dollars, `formatUsd`.
* **As-of basis.** The commitment's own `analysisPeriod`, which may be older
  than the answer above — a commitment is verified against the period it was
  made for, not against the period currently on screen.
* **Target.** `/savings-action-center.html`. It is the one destination that
  leaves this document, and it is never marked as the current one here.
* **Deliberately excludes.** Modelled ceilings. A routing scenario is not a
  realized saving, and this destination is the one place on the product that is
  only allowed to speak about money that was committed to and money that was
  checked.

---

## 5. `monthly-review` — what changed this month?

> **Question.** What changed this month, and what should we do next?

**The single metric: Recoverable share against the retained baseline.** The
percentage of analyzed spend marked recoverable in the newest retained derived
month, compared with the immediately preceding comparable retained month. Its
unit is percent of analyzed spend. The executable projection owns comparison
selection, direction, materiality, and the ranked next action.

**Deliberately excluded.** Causal attribution. A retained-period comparison does not prove an action caused the change.

---

## 6. Where this contract departs from the brief, and why

The brief asked for a headline figure defined as *"classified spend that meets
the current grade threshold, over total spend in scope."* The page's existing
data does not support that computation as written, and the closest defensible
definition it does support is the one in §1. Two facts force it:

1. **There is no per-dollar grade.** Grading happens per department, and a
   department is either scored or not scored. There is no dollar-level
   classification to filter a numerator by, so "classified spend that meets the
   threshold" has no denominator-compatible numerator to be built from.
2. **The grade threshold on this page *is* a coverage threshold.**
   `COVERAGE_BAR` in `src/export-gradability.js` is derived — never restated —
   as the lowest floor in `COVERAGE_TIERS` whose tier is still called graded.
   Comparing coverage against that bar and then multiplying coverage by itself
   would be applying the same test twice.

So the threshold is applied where it actually lives: as the gate that decides
whether the figure may be published at all. A reader in `below_bar` sees no
percentage, which is the honest reading — not a small percentage, which would
invite them to act on it.

Nothing was invented to fill a slot. Where the data cannot answer, the block
says which input is missing and which control resolves it.

---

## 6. What the whole screen deliberately leaves out

* **A trend on the headline figure.** The page carries no stored history of
  stand-behind share, and a delta computed against a figure nobody retained is a
  delta against nothing.
* **A confidence interval on the percentage.** Coverage is a census of the
  analysed set, not a sample of it. An interval would imply sampling error that
  the computation does not have.
* **A second headline.** The answer block asks one question. Every other region
  on `/evolution.html` keeps its own question, its own content, and its own
  behaviour, reachable from the four named entry points above.

## 7. One decision summary, and how that is checked

A first-time reader — a CTO who has never opened this product — must meet the
question, the number, the one next action and the hedge **once**, in one region,
above and before any working area. That region is `#finops-answer`, and it is
the only one on the page that may claim to answer on its own.

The claim is authored, not inferred: `#finops-answer` carries
`data-decision-summary-region="authored"`, and `DECISION_SUMMARY` in
`src/finops-screen-contract.js` declares the region id, the four parts in
reading order, the element id each part is painted into, and the wording each
ships before any script runs. `auditDecisionSummary()` checks a document against
that declaration and fails on a second region carrying the claim, on the claim
sitting anywhere but the declared region, on a part that left the region, and on
the parts being met out of order. `tests/finops-page-structure.test.js` runs it
against the shipped markup and against a constructed second summary.

**Reading order is question → metric → confidence → action**, and confidence
sits ahead of the action deliberately. An action read before the reader knows
how far to trust the number under it is an instruction with no argument behind
it, and a reader who cannot see both lines at once has no way to scan back for
the reason. `READING_ORDER` in `src/finops-decision-interaction.js` orders the
first-run region on the same rule.

**What this retired.** The headline region used to carry a second rendering of
the same gradability verdict: a three-slot line — its own question, its own
coverage figure, its own next step, whose text was "Read the answer above" —
twenty lines under the answer block that is painted from that verdict. Two
renderings of one verdict are two decision summaries. The verdict is unchanged
and is still stated twice over, once in the answer block's confidence sentence
(§1) and once at length in the "Can this export be graded?" disclosure, which
carries the bar, the coverage, the rows read and the next step. That is
progressive disclosure, not a peer of the answer.

**Still open.** `#finops-first-run` also declares itself a complete decision
summary — a different question ("Are we wasting money?"), a different number
(recoverable share) and its own ranked action, one screen below this block. Its
claim is refereed by `refereeCompleteSummaries()` in
`src/finops-decision-contract.js`, which enforces one *visible* complete summary
at a time but does not fold it into this one. Consolidating the two is a
separate change; this section is the standard it will be held to.
