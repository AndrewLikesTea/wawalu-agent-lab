# Portfolio comparability contract

**Contract id:** `wawalu.finops.portfolio-comparability/1.0`
**Implementation:** `src/portfolio-comparability.js`
**Local samples:** `src/portfolio-comparability-samples.js`
**Surface:** the comparability region on the AI FinOps import panel
(`src/portfolio-comparability-view.js`, painted by `src/evolution-page.js`).

## The question this answers

The multi-provider intake answers a question about files: which exports were
read side by side, and what happened to the ones that were not. A FinOps lead
asks a question one level above it, and asks it before choosing any file:

> Can I responsibly combine this portfolio now?

The failure modes that make the answer "no" are mostly invisible to an intake. A
provider that was never in the selection is not a parse error. Neither is a
fortnight straddling everyone else's month, nor a euro figure among dollars.
Each makes a combined figure indefensible, and a panel that only reports what it
read shows three green rows and leaves the reader to notice an absence.

## Metric definitions

Stated so two engineers compute the same values.

* **Evaluation unit.** One provider delivery record:
  `{ providerId, periodStart, periodEnd, currencyCode, deliveryCount, provenance: { label } }`.
  `deliveryCount` is a non-negative integer count of delivered AI requests for
  that provider over the stated period. A value that is not a non-negative
  integer is unreadable, never coerced and never zero.

* **Required comparison period.** The single half-open interval
  `[requiredPeriodStart, requiredPeriodEnd)` — start inclusive, end exclusive —
  with `start < end`, both ISO-8601 calendar dates. Validated by hand: this
  module reads no clock, and `2026-02-30` is a refusal rather than a silent roll
  into March.

* **Period-aligned.** `periodStart` and `periodEnd` equal the required period
  exactly. A record that overlaps without matching is *misaligned* and
  contributes nothing to coverage. Overlap is `start < requiredEnd && end >
  requiredStart`; a record entirely outside the period is ignored rather than
  faulted — a February export is not a defect in a January portfolio.

* **Required providers.** The distinct provider ids declared in
  `requiredProviders`. Declaration order is the tie-break order everywhere
  below, so the same input always produces the same action.

* **Covered.** A required provider with exactly one period-aligned record, in
  the portfolio currency, with a readable `deliveryCount`.

* **Coverage.** covered ÷ required, stored rounded half-up to 4 decimal places.
  With no required providers declared, coverage is **unavailable** — not 100%.
  A portfolio nobody has described is the one case where a percentage would be
  a guess with a number on it.

* **Comparable.** True only when every required provider is covered, no provider
  has a duplicate or overlapping record within or intersecting the required
  period, and every period-aligned record — declared provider or not — uses the
  portfolio currency. Otherwise false.

* **Confidence / provenance.** Covered providers carrying a non-empty
  provenance label ÷ covered providers, same rounding. Unavailable when no
  provider is covered. Only the **label** is read; the record's source material
  is never copied into the result, rendered, or exported.

Coverage and comparability are deliberately separate tests. A provider with one
aligned record *and* a second straddling window is covered — the required window
is reported exactly once — while the portfolio is not comparable, because the
overlapping days cannot be separated by arithmetic. Collapsing the two would
either hide a real defect behind 100% or report a plainly-present provider as
absent.

## Verdict

| Verdict | Meaning |
| --- | --- |
| `yes` | Every required provider covered, one window, one currency, nothing duplicated or overlapping. |
| `not_yet` | The declaration is answerable and the answer is currently no. A different set of records fixes it. |
| `no` | The declaration cannot support a judgment — no required providers, no valid period, no portfolio currency. No record supplied later fixes that. |

## The single next action

Exactly one action is ever offered. The first tier with any provider in it wins;
within a tier the earliest-declared provider wins.

1. `missing_provider`
2. `duplicate_record`, `overlapping_period`, `misaligned_period`
3. `incompatible_currency`
4. `unreadable_count`
5. otherwise no action is needed.

A missing provider outranks the rest because it is the only fault that changes
the *size* of the portfolio rather than its shape. A window fault outranks a
currency fault because re-exporting the right window commonly fixes both.
`undeclared_provider` is never an action: the fix is to change the declaration,
which is the reader's decision and not this contract's to recommend.

## What the region shows, and in what order

1. The verdict, as a word, a glyph, and a tint — in that order of priority.
2. The coverage benchmark.
3. The evidence: period, currency, provider attribution, provenance.
4. One action, as a control that returns focus to the file chooser.

Per-provider detail sits behind one native disclosure, shut on arrival. The
markup carries no provider name, no percentage, no verdict, and no remediation
sentence; all of it is painted from the result.

## Deliberately not here

* **No cost.** The contract carries no money field. Portfolio spend aggregation
  is a different question and is not answered on this surface.
* **No ranking.** A portfolio is not a league table. The question is whether the
  set is combinable, not who is worst.
* **No adapters, no credentials, no live integration, no prompts, no customer
  data.** The evaluation is pure: given records in, verdict out. The record
  shape is deliberately adapter-shaped so a later adapter or aggregation layer
  can produce and consume it unchanged — neither is implemented here.
* **No change to single-provider analysis.** Nothing on the existing import path
  reads this module; it adds a judgment beside that panel and takes nothing
  away from it.

## Samples

Four bundled sample portfolios — complete, missing provider, overlapping period,
incompatible currency — exist so the judgment is readable before a reader has
assembled anything. Every value in them is invented: a provider id, a window, a
currency, a count, and a provenance label. No customer, account, key, prompt,
cost, or file appears in any of them. The counts are deliberately unremarkable,
because a sample built to look impressive invites a comparison this contract
refuses to make.
