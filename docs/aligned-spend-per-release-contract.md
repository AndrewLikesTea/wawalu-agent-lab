# Period-aligned spend-per-release contract (`aligned-spend-per-release/1.0.0`)

The question, and the only one this derivation answers:

> **Over one reporting window, how much recorded AI spend was there per shipped
> release, and how did that move against the previous comparable window?**

`src/aligned-spend-per-release.js` is the authority;
`ALIGNED_SPEND_PER_RELEASE_RULES` in that module carries each rule below, and a
test asserts that this file names every state, reason code, and floor the module
can publish.

## Why this sits beside `spend-per-delivery.js`

That contract publishes one headline ratio against the **mean** of every earlier
period that clears its floor — the right baseline for "is this window unusual for
us", and the wrong one for "did this move since last time". A mean over four
windows of four different lengths cannot answer a question about two windows.

This derivation answers only the paired question, under a stricter alignment rule:
the two windows must abut and must cover the same number of days. So a difference
in window length can never be part of the movement it reports.

It reuses the sibling contract's floors, framing, confounders, and required
provenance fields rather than declaring second copies. Two definitions of "enough
releases" would be two policies, and a reader could not tell which produced the
number in front of them.

## What the figure is, and is not

An **observational ratio**: USD of recorded local AI spend divided by releases
recorded as shipped in the same window. Both sides are counts of records — dollars
a provider export billed, releases a person wrote down. Nothing here establishes
that the spend produced the releases, that a release is a quantity of work, or
that a direction is good or bad, so no consumer may present it as return on
investment, payback, productivity, efficiency, or output per dollar. The shared
`FRAMING.forbiddenClaims` list and a test over every published string enforce
that.

`caveats` adds the two limits that belong to a **two-point** comparison
specifically: it inherits the noise of both windows, and equal window length is
the only thing held constant between them.

## Windows and how the pair is chosen

A reporting window is the half-open interval `[periodStart, periodEnd)` — start
inclusive, end exclusive, both `YYYY-MM-DD` in UTC. Length in days is
`periodEnd - periodStart` and must be a positive whole number.

Windows sort ascending by `periodStart`, then `periodEnd`, then `exportId`, which
makes the order total. The **current** window is the last one. The **candidate
prior** window is the one immediately before it and nothing else: no search is
made for an older window that would compare more favourably, because a metric that
picks its own baseline is a metric that can be steered.

The candidate is comparable only when it abuts the current window
(`prior.periodEnd == current.periodStart`) and one of the two alignment bases
holds:

* `equal_length` — the two windows cover the same number of days. The clean case.
* `calendar_month` — both windows are whole calendar months (each end lands on the
  first, 28–31 days). This basis exists because provider billing arrives by month,
  so a 31-day May beside a 30-day June is the only pair most readers will ever
  have, and refusing it would make this derivation unusable on real exports. The
  residual difference is published as `alignment.lengthDifferenceDays` and added to
  `caveats`: up to three days of spend and of release cadence moves a per-release
  figure on its own, and this contract discloses that rather than adjusting for it.

A candidate that fails is not a compared window, and
`exclusions.priorWindowRejectedReason` names which check it failed. A calendar
month beside a 14-day partial export is a mismatch: neither basis holds.

## Counts and the figure

* **Releases** in a window are the supplied shipped records whose completion
  instant falls in `[periodStart, periodEnd)`. A record whose completion date
  cannot be parsed is excluded and counted in `exclusions.unreadableReleaseDates`,
  never silently dropped. Filtering to shipped records happens upstream, in
  `deliveriesFromReleases`.
* **Figure** — `spendPerReleaseUsd` = window spend ÷ releases in that window,
  rounded half away from zero to 2 decimals. Published for the current window only
  in the `eligible` state, and for the prior window only when that window clears
  the same floors. Every other state publishes `null`, never `0`.
* `periodSpendUsd` and `shippedReleases` are published in **every** state: they
  are facts about what was read, not conclusions.
* Floors, shared with the sibling contract: at least **14** days in the window, and
  at least **3** releases inside it.

## The states

Checked in this exact order, first match wins:

| # | Condition | State | Reason code |
|---|---|---|---|
| 1 | Nothing read at all | `absent` | `nothing_read` |
| 2 | No reporting window read | `insufficient_data` | `no_spend_period` |
| 3 | Current window spend not finite and positive | `insufficient_data` | `missing_current_period_spend` |
| 4 | Current window spend above the 1 trillion USD display ceiling | `insufficient_data` | `implausible_current_period_spend` |
| 5 | The two windows overlap | `mismatched_window` | `overlapping_reporting_windows` |
| 6 | A gap between the two windows | `mismatched_window` | `non_contiguous_reporting_windows` |
| 7 | The two windows differ in length | `mismatched_window` | `unequal_reporting_window_lengths` |
| 8 | No shipped release inside the current window | `insufficient_data` | `no_releases_in_current_period` |
| 9 | Current window shorter than 14 days | `insufficient_data` | `short_reporting_window` |
| 10 | Fewer than 3 releases in the current window | `insufficient_data` | `too_few_releases_in_current_period` |
| — | otherwise | `eligible` | `null` |

Order matters twice. A pair that cannot be aligned is a mismatch even when the
current window is also empty or too short, because re-exporting a longer window
does not make an unalignable pair comparable. And a missing spend total is
reported ahead of the mismatch, because there is no figure to align at all.

`absent` means nothing has been read in this tab; the surface stays as it was.

## Movement

`deltaUsd` is current − prior (2 dp). `deltaPercent` is `deltaUsd / prior × 100`
(1 dp, half away from zero, so a rise and a fall of the same magnitude round
identically). `direction` is read off the **rounded** percentage, so the word and
the number can never disagree. `higher` means spend per recorded release rose; it
does not mean the team slowed down, and neither direction is labelled good or bad.

Movement is published only when the state is `eligible` and the prior window
clears the same floors. Otherwise `trend.available` is false with one of:
`no_published_figure`, `no_prior_period`, `missing_prior_period_spend`,
`no_releases_in_prior_period`, `too_few_releases_in_prior_period`,
`zero_prior_spend_per_release`.

## Exclusions

`exclusions.releasesOutsideComparedWindows` is computed **independently** of the
state and of the movement, by checking every parsed release against every compared
window. This is deliberate and it is the defect the first draft of this derivation
shipped: it treated the prior window as compared only when a movement was
published, so a current window with no releases reported the reader's recorded
prior-window releases as "outside the compared windows" — which is a statement
about a window that contains them.

So: when the current window holds no release and the prior window is comparable,
the prior window's releases are **inside** the compared windows and are not
counted as outside them. What a release is checked against is the pair that was
*selected*, which does not depend on whether that pair went on to produce a
figure.

Also reported: `releasesInsideComparedWindows`, `unreadableReleaseDates`,
`windowsNotCompared` (windows read but outside the pair), and
`priorWindowRejectedReason`.

## Confidence

Exactly one of `none` / `low` / `medium` / `high`, first match wins:

* `none` — no figure was published.
* `low` — a required local provenance field is missing, so part of the basis was
  never checked.
* `medium` — a compared window declares completeness other than `complete`, or no
  movement is published.
* `high` — two complete local windows that abut and cover the same number of days.

## Provenance and retention

Required fields are the sibling contract's `REQUIRED_PROVENANCE_FIELDS`, declared
from what was actually found and never asserted, so a missing side lowers
confidence instead of being invisible. Origin is recorded (`example` or `import`).

Nothing is persisted. No imported record, line item, release id, release label,
export id, or prompt text is carried into the result: the record holds windows,
counts, totals, and prose only.

## Locality

No fetch, storage, clock, randomness, or credential path. Inputs are values
already parsed in the tab — the same `spendPerDeliveryInput` shape the FinOps page
already builds — and outputs are frozen. The derivation is pure, so it carries no
`generatedAt` stamp: the same input always produces a byte-identical record.
