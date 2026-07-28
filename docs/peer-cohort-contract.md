# Peer-cohort benchmark contract

Version: `finops-peer-cohort/1.0.0` ·
Implementation: [`src/peer-cohort-contract.js`](../src/peer-cohort-contract.js) ·
Published data: [`src/peer-cohort-fixtures.js`](../src/peer-cohort-fixtures.js)

## The question

**How do we compare with organizations like us?**

The AI FinOps page has always carried that question and, for a visitor who
imported their own files, always refused it: no cohort could be built from one
organization's export. The refusal was honest and permanent, which made the
panel a question with no path to an answer.

The path is published reference data. This product ships a fixed set of
synthetic peer cohorts. An imported organization is compared **against** them.
It never joins them, and no import changes them for anyone.

## What the cohorts are, and are not

- Published synthetic reference data, authored in this repository.
- They contain **no customer, tenant, or provider data**.
- They are **not derived from any file imported by any visitor**, in this
  session or any other. Nothing about a visitor's import is retained anywhere.
- A member record carries exactly four fields: an opaque synthetic id and the
  three declared metrics below. There is no name, region, headcount, or
  free-text field.
- Two families ship: **organization size** and **industry**.

## The metrics

All three are computed over the organization on screen, from figures other
modules already publish. Every value — the organization's and every member's —
is rounded to the metric's declared precision **before** any comparison, so a
tie is a fact rather than a floating-point accident.

| Metric | Definition | Precision | Direction |
| --- | --- | --- | --- |
| `literacy_score` | The prompt-literacy rubric's composite over the scored prompts of the organization, on a 0–100 integer scale. | 0 dp | higher is better |
| `high_value_share` | Scored prompts the rubric classified high value ÷ all scored prompts, in [0,1]. A query mix, not a dollar mix. | 4 dp | higher is better |
| `recoverable_share` | Disclosed down-routing scenario USD ÷ observed spend USD, same period, same attributed rows, in [0,1]. A scenario, never a realized saving. | 4 dp | **lower** is better |

`literacy_score` is the **headline metric**. If it is not comparable there is no
benchmark; the other two are support and each may be individually unavailable
while the benchmark stands.

## Segment inputs and cohort selection

Two inputs select a cohort:

- **Organization size** — the count of org units the analysis attributed and
  ranked. It is **not headcount**: no contract this product imports carries one,
  and a size band derived from a number nobody supplied would be a guess with a
  percentile on top of it.
- **Industry** — read only when the analysis declares one under
  `segment.industry` and it matches a published key. No v1 provider or HRIS
  export carries an industry, so an ordinary import declares none and is
  compared on size alone.

Selection: candidates are the published cohorts whose org-unit band contains the
organization and whose industry (if the cohort constrains one) equals the
declared industry. Candidates are ordered by how many dimensions they constrain,
descending, then by `cohortId` ascending. Ids are unique, so the order is total.

## Percentile, ties, and quartiles

Percentile answers "what share of this cohort does the organization beat?"

    percentile = round( (worse + equal / 2) / members × 100 )

- **worse** — members strictly worse on this metric (direction-aware).
- **equal** — members equal to it after rounding; each counts as one half.
- Rounded half-up to a whole percentile, clamped to [0, 100].

The mid-rank convention is chosen because it is the only one that reports
exactly 50 for an organization equal to every member of its cohort — a result
that is average by construction. The neighbouring conventions would report 0
or 100.

Quartile bands are closed below and open above, so 25, 50 and 75 each belong to
exactly one band:

| Percentile | Band |
| --- | --- |
| ≥ 75 | `top_quartile` |
| 50–74 | `second_quartile` |
| 25–49 | `third_quartile` |
| < 25 | `bottom_quartile` |

The cohort median beside the percentile is the middle value; for an even member
count it is the mean of the two middle values, rounded once to the metric's
precision.

## Partial, stale, malformed, and reordered data

The cohort snapshot is immutable, repository-published reference data rather
than a live feed. Its version and snapshot date identify its meaning; the
consumer does not read a clock or silently replace it from a network response.

| Condition | Contract behavior |
| --- | --- |
| Partial organization import | A missing headline `literacy_score` refuses the benchmark with `no_comparable_peer_metric`. A missing supporting value leaves the benchmark available but marks only that metric unavailable with `no_organization_metric_value`. Missing is never coerced to zero. |
| Stale or incompatible scoring input | A literacy score produced under a different rubric version is refused with `peer_rubric_version_mismatch`; it is never rescaled. The cohort snapshot date is provenance, not a freshness timeout, because the versioned snapshot is intentionally fixed until publication changes it. |
| Malformed organization value | A non-finite or out-of-domain metric is unavailable with `no_organization_metric_value`. An invalid or absent segment refuses selection; no percentile, quartile, ordinal, or action is published. |
| Reordered inputs or reference members | Result order and arrival order have no meaning. Cohort selection uses specificity then `cohortId`; percentile and median operate on value sets; the drift digest canonicalizes cohorts by `cohortId` and members by `memberId`. Reordering alone changes neither a result nor the published-content digest. |

Malformed published reference data is a build-time defect, not a recoverable
visitor state: load-time invariants and contract tests require unique cohort
ids, declared metric fields, valid selectors, and the member floor before this
snapshot can ship. Deployment never fetches replacement cohort data and needs no
enterprise credential.

## Comparability and confidence

`comparability` describes the cohort, not the data quality:

- `close` — the selected cohort constrains **industry and size**.
- `broad` — it constrains **size only**.
- `none` — no cohort applies.

`confidence` follows from comparability and the published member count:

- `high` — `close` and at least 12 members.
- `medium` — at least 12 members, any comparability.
- `low` — otherwise. A cohort below 8 members is never published at all.

## Unavailable reasons

Wire values. Reword the sentence beside one freely; changing a code is a version
bump.

| Code | Meaning |
| --- | --- |
| `no_peer_segment_input` | Nothing in the import says how large the organization is. |
| `no_matching_peer_cohort` | Segment inputs read; they fall outside every published band. |
| `peer_rubric_version_mismatch` | The score was computed under a different rubric than the cohort's. Two rubrics are two scales. |
| `no_comparable_peer_metric` | A cohort applies and no literacy score was published to place inside it. |
| `no_organization_metric_value` | One metric's own value is absent or outside its domain. |
| `peer_cohort_below_member_floor` | The cohort publishes fewer than 8 members carrying that metric. |

## The single prioritized action

Exactly one action is published, selected by unique rank over the comparable
metrics. Ranks are unique, so selection is total and there is never a tie-break.

| Rank | Action | Eligible when |
| --- | --- | --- |
| 1 | `close_literacy_gap` | literacy percentile < 25 |
| 2 | `capture_recoverable_gap` | recoverable-share percentile < 50 |
| 3 | `raise_high_value_share` | high-value-share percentile < 50 |
| 4 | `hold_position` | the benchmark is available and nothing above is eligible |

A bottom-quartile literacy score outranks both spend findings because it is the
only one that says the work itself is the problem. Recoverable share outranks
high-value share because it is already denominated in dollars on this period's
invoice. A benchmark that is unavailable publishes **no** action — a suggestion
with no measurement under it is not an action.

## The imported finding, and where the action is rendered

`imported-peer-benchmark.js` joins the selected action to the import it was
computed from and publishes it as `result.finding`:

| Field | What it holds |
| --- | --- |
| `standing` | `behind_cohort` or `at_or_above_cohort`, from the action's id |
| `gap` | the comparison **the action names** — value, cohort median, quartile, and the contract's own distance-to-median phrase |
| `action` | the contract's action, repeated verbatim: text, gap, accountable role |
| `evidence` | the import's own savings figures, repeated: recoverable total, largest recoverable unit, and the analysis's own next step |

The gap is reported against the action's metric, not against the headline: a
`capture_recoverable_gap` action states recoverable share, so the sentence and
the next step name one measurement.

The finding is **rendered**, not merely returned. `applyImportedExecutive`
writes it into `#kpi-peer-finding` under the percentile — gap, action, and
accountable role plus evidence. A comparison that recommends one thing in a
result object and shows nothing on screen is the defect this contract's
consumer is tested against; the block is hidden and its text cleared whenever
there is no available finding, so no stale action survives a cleared import.

## Reproducibility, and the assumption behind each weight

Every figure here will be disputed by the director whose organization it grades,
so each one is reproducible from stated inputs under stated rules. The contract
carries no free coefficients, but it does carry six choices that move a reader's
number. Each is listed with the assumption it rests on; a weight nobody can
question is a weight nobody can defend.

| Choice | Assumption it rests on |
| --- | --- |
| `literacy_score` is the headline, and without it there is no benchmark | The question is about how well the organization uses the tool; the two spend metrics describe the invoice that follows. Placing an ungraded import on spend alone would rank the consequence and hide the cause. |
| Ties count as one half (mid-rank) | An organization equal to every member of its cohort is average by construction and must read 50. The neighbouring conventions report 0 or 100 for it. |
| Round to the metric's precision **before** comparing | A tie should be a fact about the business, not about float representation. Rounding afterwards lets `0.199990000001` beat `0.19999`. |
| `recoverable_share` is lower-is-better | A large recoverable share is avoidable spend still sitting on the invoice. Direction is declared per metric because inverting it would reverse a ranking silently. |
| Action ranks 1–4, literacy triggering at percentile < 25 and both spend metrics at < 50 | Bottom-quartile literacy is the only finding that says the work itself is the problem, so it outranks both spend findings — and it fires only in the bottom quartile because "below the median" is not on its own a reason to change how an organization writes prompts. Recoverable share outranks the query mix because it is already denominated in dollars on this period's invoice. |
| Member floor 8, confident count 12 | Below eight members a percentile is a rank wearing a distribution's clothes, so such a cohort is not published; below twelve it is published and labelled low confidence. Both numbers are editorial. Every cohort shipped today publishes twelve, so no reader currently sees a low-confidence comparison. |

Three suites hold this up, over labelled synthetic fixtures in
`tests/support/peer-fixtures.js` — comparable, non-comparable, missing-segment,
boundary-percentile and tied-score imports, with hand-derived expectations:

- `tests/peer-cohort-contract.test.js` — the rules, unit by unit.
- `tests/peer-benchmark-reproducibility.test.js` — each labelled case reproduces
  its documented percentile, quartile, median and action; the contract seam and
  the import seam agree; an independently written reference reproduces every
  placement; and unavailable or broad-match results keep their provenance while
  carrying no placement value and no ordinal a reader could take for a rank.
- `tests/peer-benchmark-drift.test.js` — the published cohort (as a digest over
  every member value), the scoring rules, and prioritized-action selection are
  pinned as literals. A failure there means the reference data or an editorial
  rule changed and the version stamped on every exported briefing must change
  with it.

No fixture in any of them is live, customer, tenant or provider data.

## Deliberate omissions

- No cohort built from visitor data. A cohort a reader's import can move is a
  cohort that carries the previous reader's import into this one.
- No blended peer set. One cohort is selected and named; two cohorts averaged is
  a comparison against a group that does not exist.
- No second headline figure, and no ranked backlog of actions.
- No storage, clock, network, credential, or DOM anywhere in the contract.
