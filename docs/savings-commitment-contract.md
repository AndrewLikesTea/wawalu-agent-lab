# Savings commitment contract

`savings-commitment/1.0.0` — the contract between a locally imported AI FinOps
analysis and the one commitment a leader is asked to make from it.

Code: `src/savings-commitment.js`. View: `src/savings-commitment-view.js`.
Page: `src/savings-commitment.html`. Fixture: `src/savings-commitment-fixture.json`
(`savings-commitment-input/1.0.0`). Tests: `tests/savings-commitment.test.js`.

## The one question

> What should we commit to now?

The page answers it with exactly **one** proposed commitment, in this order:

1. **What should we commit to?** — the headline.
2. **Who is accountable?** — canonical department id, department name, owner role.
3. **What changes?** — current model route → proposed model route, with rationale.
4. **What is it worth, against what?** — projected monthly savings, then the
   baseline it is measured against, then the projected cost.
5. **How sure are we?** — confidence percent, derived band, and its stated basis.
6. **Where did this come from?** — provenance, progressively disclosed.

### What it deliberately does not answer

- **Whether the cheaper route is as good.** No cost analysis can establish output
  quality. This contract claims routing *candidacy* with the evidence behind it.
- **When the saving arrives, or whether it did.** That is a measured month, and
  it is `savings-action-center`'s question, not this one.
- **A second thing to do.** Every other candidate is `excluded`, each with the
  reason it lost. A ranked list of five is the surface this product keeps
  rebuilding away from.
- **Anything about peers, industry, or a vendor rate card.** No such data exists
  locally and none is reached for.

## Where it sits

| Contract | Question |
| --- | --- |
| `savings-commitment/1.0.0` | What should we commit to now? Nothing is running yet. |
| `savings-portfolio/1.1.0` | How is the plan already under way tracking? |
| `monthly-savings-reconciliation` / `savings-action-center` | Which running action is off-plan this month? |

## Metric definitions

Two engineers must compute the same number. **Money is integer USD minor units
(cents) everywhere.** A float dollar amount, a negative, or a non-integer is
rejected, never rounded.

**Baseline.** `baseline.monthlyCostMinor` is the imported analysis's own monthly
cost for the named workload scope in the named period. It is carried **verbatim**
from the import: never recomputed, prorated, annualized, or inferred here. If the
import did not state it, there is no commitment.

**Projected monthly savings.**

```
projectedMonthlySavings.amountMinor = max(0, baseline.monthlyCostMinor − projected.monthlyCostMinor)
```

Both costs must be stated by the imported analysis for the **identical
`workloadId` and the identical `period`**. That is not a convention: `baseline`
and `projected` each restate their own `workloadId` and `period`, and validation
rejects a candidate whose two sides disagree with each other or with
`workloadScope`. A saving computed across two scopes or two months is not a
saving, and this contract will not reconcile one. Nothing is estimated from an
input the import did not record.

`commitment.projectedMonthlySavings.formula` carries the arithmetic with the
actual numbers substituted, so the figure on screen can be checked by hand.

**Eligibility.** A candidate is committable only when the saving is **strictly
positive**. A projection that meets or exceeds its own baseline saves nothing;
that analysis reports `status: "no_commitment"` with a sentence, never a
commitment worth $0.00.

**Accountable department.** `department.departmentId` is a canonical identifier
**supplied by the imported analysis** — lower-case kebab-case, at most 64
characters, not a placeholder (`unknown`, `unassigned`, `other`, …). An
identifier containing a space or a capital is rejected precisely because it was
probably read off a heading rather than out of the import, and headings get
renamed. `department.name` is display text and identifies nothing.

**Model-routing recommendation.** `routing` is required and structured:
`currentRoute.modelId`, `proposedRoute.modelId`, the `workloadId` both apply to
(which must match `workloadScope`), a `rationale`, and at least one `evidence`
entry tying a statement to an imported `recordId`. The two routes must differ —
a recommendation to keep doing what you are doing is not a recommendation.

**Confidence.** Stored as `confidence.percent`, an **integer from 0 through 100
inclusive**, supplied by the import with a required `basis`. Storing the decimal
instead would make `0.7` and `0.70000000000000007` two different valid inputs,
and validation is meant to be deterministic. It is reported additionally as
`confidence.value` on a `0-1` scale and as a derived band:

| Band | Percent |
| --- | --- |
| `high` | ≥ 75 |
| `medium` | ≥ 50 |
| `low` | otherwise |

The band is **derived, never supplied**; a candidate that asserts one is rejected.

**Provenance.** Required and immutable, sufficient to identify both the analysis
and the exact records used: `sourceId`, `analysisSchemaVersion`, `importedAt`
(ISO-8601 UTC instant), `analysisPeriod` (or `null` when the import recorded
none), `designation`, `recordIds`, and `recordCount`. Every cited record id must
appear in the analysis's own `source.recordIds`; a commitment citing a record the
import does not contain is rejected.

**Designation** is one of `fixture`, `demo`, or `imported`, and it is rendered.
A bundled synthetic figure must never be mistaken for a leader's own number.

**Ranking.** Eligible candidates are ordered by `projectedMonthlySavings`
descending, then `confidence.percent` descending, then `candidateId` ascending.
Every step is total, so the same analysis produces the same winner in any input
order. `rank` is always `1`, because there is always exactly one.

## What the contract refuses to carry

`validateSavingsCommitment` and `validateImportedAnalysis` walk the whole payload,
keys and string values, at every depth:

| Refused | Why |
| --- | --- |
| Any key matching `token`, `secret`, `password`, `credential`, `apikey`, `authorization`, `bearer`, `cookie`, `sessionid`, `privatekey` | This contract authenticates to nothing and stores no secret. |
| Any key matching `prompt`, `completion`, `transcript`, `conversation`, `messagebody`, `chatlog` | The analysis consumed here is cost and routing figures. A prompt body is neither. |
| Any key matching `customeremail`, `customername`, `enduser`, `personalname`, `emailaddress` | Customer and personal data are never carried. |
| Any string containing a PEM private key, a `Bearer …` header, or an API-key-shaped token | A clean field name can still hold a credential. |
| Any undeclared top-level or commitment field | An allowlist, so a future field cannot arrive unreviewed. |

**No persistence, no clock, no integration.** `src/savings-commitment.js`,
`-view.js`, and `-page.js` use no `localStorage`, `sessionStorage`, `indexedDB`,
`document.cookie`, `Date.now()`, `new Date()`, or absolute URL — asserted by
test. The only I/O is one same-origin, no-store read of the bundled fixture with
fetch credentials explicitly omitted, so ambient cookies are not sent. Every figure
lives as long as the tab does.

## Degraded and refused shapes

| `status` | What a leader gets |
| --- | --- |
| `ok` | One commitment, fully specified, plus the set-aside candidates and why each lost. |
| `no_commitment` | A sentence: no candidate projects a monthly cost below its own baseline for the same workload and month. `commitment` is `null` and `reason` is required. |
| *(throws)* | An incomplete or ambiguous analysis is refused outright. The page renders the error state and shows no commitment rather than one with the gaps filled in. |

A commitment and an excuse for having none are never both present: `reason` must
be `null` whenever `commitment` is not.

## Downstream dependency

**Accepting a commitment is not implemented here, and depends on this contract.**
The built preview says so in `downstream`:

- `downstream.dependsOnContract` — `savings-commitment/1.0.0`
- `downstream.implemented` — `false`
- `downstream.requiredFieldsForDownstream` — the fields any acceptance,
  lifecycle, or reconciliation implementation must consume

Whatever builds that next step must:

1. consume `commitment` as returned by `validateSavingsCommitment`, not a
   hand-assembled object;
2. carry `commitment.provenance` **unchanged**, so a later measured month can be
   traced back to the exact imported records; and
3. **not recompute the baseline.** The baseline is whatever the imported analysis
   said it was. A later re-derivation would silently move the goalposts a
   commitment was made against.

There is deliberately no button on the preview page. The missing control is a
product fact stated on the surface, not an oversight.

## Acceptance criteria

- A leader asking “what should we commit to now?” receives exactly one
  commitment naming an accountable department id, an owner role, a current and
  proposed model route, a baseline, a projected monthly saving, a confidence, and
  the records behind it — or one sentence saying there is nothing to commit to.
- Two engineers handed the same imported analysis compute the same projected
  monthly saving, to the cent, in any input order.
- An analysis missing a department id, an owner, a routing recommendation, a
  baseline, a confidence, or provenance produces no commitment at all.
- An analysis whose projection is scoped to a different workload or month than
  its baseline is rejected rather than reconciled.
- The bundled fixture is designated `fixture` on screen, and the page states that
  nothing is saved, sent, or acted on.
