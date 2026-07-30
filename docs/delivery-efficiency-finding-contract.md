# Delivery finding contract (`delivery-efficiency-finding/1.0.0`)

`src/delivery-efficiency-finding.js` is the authority; this file is the same rules
in prose for a reader who is not reading code, and a test pins the thresholds and
the priority bands in both.

## What this layer adds, and what it deliberately does not touch

`docs/spend-per-delivery-contract.md` derives one figure — USD of recorded AI spend
per completed release — and decides whether that figure may be published at all.
It stops before the judgement a leader acts on: **is this move large enough to read
as a change, or is it inside the range this ratio moves through on its own?**

That judgement needs thresholds, and a threshold is a policy someone will dispute.
So it lives here, once, with the assumption behind each number stated beside it and
echoed onto every finding, and the derivation below it is unchanged: this layer
re-derives no figure, moves no boundary, and publishes no number the derivation
withheld.

### The name

The commissioning issue calls this subject "delivery efficiency". The finding never
uses that word and neither does its view. The derivation's `FRAMING.forbiddenClaims`
rules out presenting this ratio as efficiency, productivity, or return, and a
finding that adopted the routing name would have re-introduced exactly the claim the
derivation refuses. The word survives in the module and schema-version identifiers
so the issue can be traced to the code; a test asserts that no other string on a
finding contains it.

## The five classifications, checked in this order

| # | Condition | Classification | Reason code |
|---|---|---|---|
| 1 | Derivation state is `mismatched_period` | `invalid_period_alignment` | the derivation's own code |
| 2 | Derivation state is not `eligible` | `insufficient_evidence` | the derivation's own code |
| 3 | A required local provenance field is missing | `insufficient_evidence` | `incomplete_local_provenance` |
| 4 | No trailing baseline is available | `insufficient_evidence` | the comparison's own code |
| 5 | \|move\| < material threshold | `stable_ratio` | `within_material_band` |
| 6 | \|move\| ≤ single-release swing | `insufficient_evidence` | `within_single_release_sensitivity` |
| 7 | otherwise, move up / move down | `material_ratio_increase` / `_decrease` | `material_move_past_both_thresholds` |

Order matters twice.

Provenance (3) is checked before the comparison (4) because a figure whose basis was
never fully checked cannot support a direction however good the comparison looks.

The material band (5) is checked before the single-release swing (6) so that a
genuinely small move is reported as stable rather than as indeterminate: a move the
swing cannot distinguish from noise is *consistent* with stability, and classifying
it as insufficient would hide a complete reading behind a data-collection action.

Only rows 7 publish a `direction`. The other three classifications set it to `null`
structurally — the field is unreachable outside the two material outcomes rather
than blanked afterwards — so an insufficient or mismatched sample cannot emit an
unqualified positive or negative conclusion.

Note that `insufficient_evidence` withholds the **direction**, not the figure. When
the derivation published a ratio and only the comparison is unsupported, the ratio
stays on the record; what is withheld is the reading of it as a change.

## The two thresholds, and the assumption behind each

**Material change: 15% of the reader's own trailing baseline.** Assumption: a move
smaller than 15% is inside the range ordinary provider price and model-mix drift
moves this ratio through with no change in recorded delivery. 15 is a round number
chosen for that reason and is not measured from any dataset. Lowering it makes the
finding report drift as a change. Dispute it by changing
`materialChangePercent`; nothing else in the module reads a percentage floor.

**Single-release sensitivity: 100 / (deliveries + 1) percent.** Assumption: the
release log is written by hand, so one release nobody recorded is the cheapest
explanation for a move. One more release in the headline period moves the ratio by
that percentage, so a move no larger than it is never reported as material, at any
size. At the derivation's three-release floor that is 25%, which is why a short
period buys a wide indeterminate band and a long one buys a narrow band. Dispute it
by arguing unrecorded releases are rare in the log being read, or by raising
`MINIMUM_DELIVERIES` in the derivation so the band narrows.

## Priority

Rank is derived from the classification alone, so the same classification always
places the finding at the same rank; no figure, dollar amount, or confidence level
moves it.

| Rank | Band | Classification | Assumption |
|---|---|---|---|
| 1 | `resolve_period_alignment` | `invalid_period_alignment` | The only outcome where the next reading is guaranteed wrong the same way until the exports are fixed. |
| 2 | `review_recorded_change` | both material outcomes | The only outcome asking a reader to look at something today. A fall ranks identically to a rise, because ranking one above the other would label a direction good or bad. |
| 3 | `collect_evidence` | `insufficient_evidence` | Collecting records is real work with a known next step. |
| 4 | `monitor` | `stable_ratio` | A complete, unremarkable reading is ranked last rather than omitted. |

## Confidence

Carried from the derivation unchanged, with its rank against
`CONFIDENCE_LEVELS` added so a queue can sort on it. This layer does not raise or
lower confidence: two modules that both adjust one number produce a number neither
of them can explain.

## Caveats

`requiredCaveats` is never empty. Three universal caveats ride on every finding —
the derivation's framing statement, that both sides are counts of things *recorded*,
and that no peer or cohort baseline exists — plus one keyed to the classification.
The stable one says in as many words that "no material change" is not a claim that
nothing changed. The two material ones say that a higher or lower ratio is not
evidence either figure moved the other.

## Untrusted source content

Provider exports and the release log arrive from files and forms, so every string
carried out of the derivation passes the repository's one sanitizer
(`sanitizeFinopsRecommendation`, which layers instruction-neutralization over
`redactForScoring`) before it reaches a finding. There is no second, unredacted
representation for a judge or an executive view to read: the finding is the
representation.

Three real vectors on this path are covered by test: the `completeness` string a
provider export declares, which the derivation quotes into its own confidence
sentence; the provenance source line a caller supplies; and secrets or contact
details pasted into either.

Release versions, release ids, and export ids are **excluded outright** rather than
sanitized — `redaction.excludedFields` names them on every finding. They identify
nothing a reader needs in order to judge a ratio, so excluding them removes the
whole class of injection through a release name rather than one shape of it.

Redaction is idempotent, and a test asserts every string on every fixture finding is
already a fixed point of it, so a later edit that appends raw source text to a
sentence fails rather than ships.

## Reproducibility

Pure: no fetch, storage, clock, randomness, or credential path, and no `generatedAt`
stamp — a timestamp would break the guarantee that equivalent inputs serialize
identically. A test builds a structurally equal input from fresh objects with the
releases reversed and the period keys inserted in a different order and asserts the
two findings are byte-identical under `JSON.stringify`.

## Labelled fixtures

`src/delivery-efficiency-finding-fixtures.js` carries one fixture per reachable
classification plus the band between the two thresholds, and each declares the
`expected` classification, reason, direction, and rank that a reviewer reading the
numbers by hand assigned before the code ran. The agreement check asserts the module
reproduces every label and that all five classifications are reached, so a rule that
stopped being reachable fails loudly instead of going quiet. Fixture *labels* use the
commissioning issue's words ("material deterioration", "material improvement") so
the issue can be traced to the case; the finding those fixtures produce does not.

## Where it is consumed

`src/evolution-page.js` scores the same decision it paints and passes the finding to
`applySpendPerDelivery`, which renders the classification, the priority, the ordered
rules that fired, the thresholds with their assumptions, and the caveats. When a
caller does not supply a finding the view scores the state itself, so the panel has
no state in which the figure appears without them.
