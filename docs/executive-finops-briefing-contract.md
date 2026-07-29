# Executive FinOps briefing contract

Status: contract and canonical fixture only. No view, export, share, or provider
work ships with it.

Executable form: `src/executive-finops-briefing.js`.
Canonical fixture: `src/executive-finops-briefing-fixture.json`.
Tests: `tests/executive-finops-briefing.test.js`.
Labelled state coverage: `docs/executive-briefing-fixtures.md`.

## The three questions, in order

A CTO opens this artifact to answer three questions and reads them in this
order, because each one is only worth asking if the one before it answered.

| # | Question | Answered by |
|---|----------|-------------|
| 1 | Where should we act first? | `primaryFinding` |
| 2 | How much recoverable spend is indicated, relative to the benchmark? | `recoverable`, `benchmark` |
| 3 | What should happen next, on what evidence, and with what limits? | `nextAction`, `confidence`, `provenance`, `method`, `limitations` |

The questions ship inside every briefing as `questions`, so a consumer orders
the artifact from the contract rather than from a designer's memory of it.

## What it reads, and what it cannot read

The only input is an array of **retained derived FinOps workspace periods** —
the records `finops-workspace.js` stores and `readFinopsWorkspace` reads back.
Those are aggregates: a period label, a dataset designation, a fingerprint,
counts, minor-unit totals, a coverage confidence, and one org unit id.

There is no other input. This module cannot reach an import, a provider export,
a prompt, a file, a credential, or a network endpoint, because none of them is
in the record shape it is handed. It has no DOM, no storage, no fetch, no clock,
and no formatting: `{ valueMinor: 612000, currency: "USD" }` is the output, and
`"$6,120.00"` is a view decision that belongs to the view layer.

It **operates only on browser-local derived workspace data, and it cannot create
a shareable link containing imported records.** There is no link form that could
carry one, and none is offered. `safety.shareableLinkSupported` is `false`, the
`no_shareable_link` limitation always ships, and `validateExecutiveBriefing`
rejects any briefing carrying a URL-shaped string anywhere in it.

## Metric definitions

Precise enough that two engineers compute them identically.

**`recoverable.valueMinor`** — `recoverableScenarioMinor`, read verbatim off the
selected retained period. It is *not* recomputed. The briefing contract already
selected that figure and the workspace already stored it; a second derivation of
the same number is how two surfaces show a leader two different "the" figures.
It is a **routing scenario, not a realized saving**: nothing has been banked and
no invoice has changed.

**`recoverable.sharePpm`** —
`round_half_away_from_zero(recoverableScenarioMinor ÷ analyzedSpendMinor × 1e6)`,
an integer in parts per million. `null`, never `0`, when the denominator is
absent or not positive: a share nobody could compute and a measured share of
zero are different claims, and only one of them may be benchmarked. Rounding is
half **away from zero** everywhere, so a rise and a fall of equal magnitude
round to equal magnitudes.

**`benchmark`** — this workspace's **own trailing baseline**. Prior periods are
the retained periods of the reporting period's own dataset whose label sorts
strictly before it; another dataset's periods are never averaged in, and their
exclusion is reported as the `mixed_dataset_history` limitation. The benchmark
is eligible only when the reporting period and its priors number at least three,
their labels form a gapless consecutive calendar-month sequence ending at the
reporting period, and every one carries a positive `analyzedSpendMinor` and a
finite `recoverableScenarioMinor`. Otherwise it is ineligible with a reason from
`BENCHMARK_INELIGIBILITY_REASONS` (`insufficient_history`, `period_gap`,
`null_spend`) and a `null` baseline — never a zero baseline, and never an
omitted comparison.

- `baselineSharePpm` = mean of the priors' `recoverableSharePpm`, rounded half
  away from zero to whole ppm.
- `varianceSharePpm` = `reportingSharePpm − baselineSharePpm`.
- `standing` = `in_line_with_baseline` when `|varianceSharePpm| <= 10000` (one
  percentage point of share); otherwise `more_recoverable_than_baseline` or
  `less_recoverable_than_baseline` by the sign.

No peer, industry, or market cohort is invented. Nothing this browser holds
contains one, and a percentile against a cohort nobody supplied is a guess with
a rank painted on it.

The comparison is on **share**, not on dollars: the money figure sizes the
action, and a share is the only form of it comparable across months of different
size. There is one headline figure and no second one.

## Deterministic single selection

**Exactly one reporting period**, by a total order. First non-zero comparison
wins: period label descending; then `recoverableScenarioMinor` descending; then
`recordsAnalyzed` descending; then `derivedAt` descending as an ISO-8601 string;
then `periodId` ascending, which is unique per retained period and makes the
order total. `selection.tieBreakApplied` names the step that actually decided.
Steps 2–5 are reachable when one month was derived twice — a re-import of a
corrected export — and they are implemented rather than described, because an
unimplemented tie-break is a coin flip.

A period is eligible only if it is well-formed, records no absence reason, has
positive analyzed spend, has a positive recoverable scenario, names an org unit,
and is not `insufficient` confidence. **The primary finding is that period's
`topDepartmentId`** — one org unit, never a list.

**Exactly one next action**, from a closed catalog, by ascending rank, first
precondition that holds:

| Rank | Action | Precondition | Accountable role |
|------|--------|--------------|------------------|
| 1 | `improve_attribution` | Period confidence is low or insufficient, a required input is missing, or under 50% of analyzed spend was attributed | FinOps Data Owner |
| 2 | `verify_prior_change` | Benchmark eligible and standing is `less_recoverable_than_baseline` | Platform Engineering Lead |
| 3 | `pilot_routing` | A finding names an org unit and the recoverable scenario is positive | Platform Engineering Lead |

`pilot_routing` is capped at the reporting period's recoverable scenario. No
action is free-typed: an executive artifact that can say anything is one nobody
can test. Roles are roles, never people — this artifact is built in a browser
that holds no roster, and a named individual in it is an identifier, not a
decision.

## Confidence

`confidence.level` is the **weakest** of three, and is never recomputed here:

1. the reporting period's own coverage confidence, as computed by the briefing
   contract and stored with the retained period;
2. a ceiling of `moderate` when the benchmark is ineligible — a figure with
   nothing to compare against cannot support a commitment;
3. a ceiling of `low` when the dataset is not the reader's own import — a
   demonstration cannot evidence a decision.

Each level ships with its `meaning`, stated as what it licenses a leader to do,
because "moderate" answers nothing on its own.

## Provenance, method, and limitations

`provenance` carries the dataset designation, `derivedAt`, the source
fingerprint, the period ids that fed the briefing, the retained-period count,
and the analyzed/total record counts. No file name, no source row, no identity.

`method` carries the note, the literal formulas, the selection rule, the
benchmark rule, the confidence rule, and the exact retained fields read — enough
for an engineer to recompute every figure from the same records.

`limitations` is a closed set. Five always ship
(`scenario_not_realized_saving`, `browser_local_derived_only`,
`no_shareable_link`, `usd_only`, `no_peer_cohort`); the rest are conditional
(`example_dataset`, `benchmark_unavailable`, `partial_coverage`,
`mixed_dataset_history`, `missing_inputs`). A limitation a reader has to infer
is one they will not.

## Progressive disclosure

Three levels, and no more.

| Level | Id | Intent | Fields |
|-------|----|--------|--------|
| 1 | `headline` | What to act on and how much is indicated | `primaryFinding`, `recoverable`, `benchmark.standing`, `nextAction` |
| 2 | `supporting` | What the claim rests on and how far it may be trusted | `benchmark`, `confidence`, `provenance`, `limitations` |
| 3 | `method` | How to recompute every figure | `method`, `selection`, `contractVersions` |

Levels 2 and 3 may be collapsed. Level 1 may not, and a level-3 field may never
be promoted into level 1 — that is how an executive briefing turns back into a
dashboard.

## Print and export requirements

`PRESENTATION_REQUIREMENTS` is the normative statement for the presentation work
that lands later, and it is embedded verbatim in the fixture's metadata so that
work has one thing to build against.

- Print: A4 or Letter, portrait. `primaryFinding`, `recoverable`, `benchmark`,
  `nextAction`, and `confidence` on the first page. `limitations`, `provenance`,
  `method`, and `contractVersions` somewhere in the artifact. **Every disclosure
  level expands for print** — a collapsed section renders expanded rather than
  being dropped. Colour is decorative: standing is stated in words, because a
  printed briefing is read in monochrome.
- Export: `application/json`,
  `executive-finops-briefing-{period}.json`, carrying the briefing verbatim plus
  nothing. It must never carry imported records, source rows, file names,
  prompts, credentials, shareable links, or network endpoints, and
  `shareableLink` is `false`.

The rule behind both: limitations and provenance may be collapsed on screen, but
they may never be absent from a printed or exported artifact. A number that
leaves the room without its caveat is the number quoted in a board deck six
weeks later.

## The canonical fixture

`src/executive-finops-briefing-fixture.json` holds the synthetic input, the
briefing built from it, and the metadata. It is deterministic — no clock, no
randomness, no locale — and a test asserts
`buildExecutiveBriefing(input.retainedPeriods)` deep-equals `briefing`, so a
contract change that the fixture no longer satisfies fails a test instead of
leaving a stale example behind.

It contains no credential, no imported or customer record, no prompt, and no
live-provider reference. Org unit ids use the `syn-` synthetic convention.

## Deliberately out of scope

No view, page, or component. No export or print implementation. No sharing. No
provider integration. No deployment change. No second headline metric, chart
series, per-record table, or per-department breakdown — those answer other
questions and belong to other surfaces.
