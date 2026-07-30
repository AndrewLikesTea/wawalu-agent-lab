# Ranking reproducibility contract

A FinOps lead repeats a band — "we are in the bottom quartile" — to a director
whose team it grades. This contract is what makes that claim defensible: the
rubric version is named, the cohort snapshot declares the rubric it was built
for, the sample floor is a published number, and the derived record is a fixed
value a second run reproduces exactly.

Code: `src/ranking-reproducibility.js`. Surface: the "Can this ranking be
reproduced?" disclosure in `#finops-stand` on `src/evolution.html`. Pins:
`tests/fixtures/ranking-reproducibility-fixtures.json`, asserted in
`tests/ranking-reproducibility.test.js`.

## The three gates, in order

1. **The snapshot declares a rubric version.** `PEER_COST_RUBRIC_VERSION` in
   `src/peer-cost-cohorts.js` travels with the published boundaries; an
   unversioned snapshot is scored against nothing.
2. **It is the version this path implements** (`RUBRIC_VERSION`). On a
   disagreement the position is withheld entirely — no band, no percentile, no
   widened estimate — and the refusal names both versions.
3. **The sample clears `MINIMUM_RANKED_SUCCESSFUL_TASKS`** (30). Under it, the
   claim is refused rather than published with a caveat.

`peer-cost-position.js` still owns the metric, the boundaries, and the cohort
match; `internal-cost-gap.js` still owns the department pair. Nothing here
re-scores anything, and a refusal is never a weaker number.

## Assumptions, and who disputes them

| Value | Assumption | Who disputes it |
| --- | --- | --- |
| `RUBRIC_VERSION` / `PEER_COST_RUBRIC_VERSION` | Boundaries and the metric they band are one versioned unit. | An analyst who wants last quarter's snapshot scored against this quarter's rubric to keep a trend line unbroken. |
| `MINIMUM_RANKED_SUCCESSFUL_TASKS = 30` | Below 30 successful tasks one retried task moves the metric by more than 3%, which is narrower than any published cohort's boundary gap. | The lead of a four-person team whose month has eight successful tasks and wants a position anyway. |
| `CONFIDENCE_MULTIPLE` (4× high, 2× moderate) | Confidence in a band is distance from the point the band stops being stable, expressed in the only unit this rubric has for it — the floor. | A statistician who wants an interval on the metric rather than a tier. |
| Quartile boundaries on each cohort | Published, not recomputed per load; inclusive on the favorable side. | Stated in `src/peer-cost-cohorts.js`, which owns them. |

## Reproducing the bundled example by hand

From `tests/fixtures/ranking-reproducibility-fixtures.json` alone:

1. **The metric.** `bundledExample.spendCents` 15,450,000 (= $154,500 attributed
   spend for the window) ÷ `bundledExample.successfulTasks` 4,000 = $38.625 per
   successful task. Failed and abandoned tasks stay out of the denominator and
   their spend stays in the numerator; running tasks are in neither.
2. **The band.** The matched cohort is `cost-enterprise-saas`, whose pinned
   boundaries are p25 $18.40 and p75 $31.50. $38.625 ≥ p75, so the band is
   `bottom_quartile` — the most expensive quarter of the cohort. Rounding to
   cents happens at display only, so $38.63 is shown and $38.625 is banded.
3. **Confidence.** 4,000 ÷ the 30-task floor is 133.3×, at or above the 4× high
   threshold, so the tier is `high`.
4. **Verification.** `2026-07-01`, the analysed window's end. It is shown to
   readers and deliberately kept outside the compared record.
5. **The department gap.** Boreal $22,000 ÷ 900 successes = $24.44 (between the
   boundaries, `middle_range`); Atlas $79,000 ÷ 1,500 successes = $52.67 (above
   p75, `bottom_quartile`). One band apart, $28.22 per successful task.
6. **The fingerprint.** FNV-1a/32 over the fifteen `RECORD_FIELDS` in their
   published order — `b0ef5412`. A change detector, not a cryptographic digest.
   It covers no date and no clock reading, which is why two runs, and a review
   resumed out of local storage, produce the same value.

Every one of those numbers is a named assertion in the test file: a moved
boundary, weight, threshold, or bundled figure fails with the pin it moved
named in the message, not as an opaque object diff.

## What never reaches the record

Department names, org unit labels, and any other free text out of a reader's own
export. The compared record is keyed on department ids; names are neutralized by
`finops-journey-redaction.js` at the point they are rendered. Redacting a name
therefore cannot move a band, and a hostile one could not have raised one.
