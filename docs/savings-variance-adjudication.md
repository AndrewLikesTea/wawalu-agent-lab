# Savings variance adjudication

`savings-variance-adjudication/1.0.0` is a deterministic review layer over one
validated Rowan `savings-portfolio/1.1.0` action. It does not alter or replace
the separate `action-outcome/1.0.0` rubric and does not produce a weighted score.

The four stable statuses are:

| Status | Explainable rule |
| --- | --- |
| `verified_delivery` | Verified savings with evidence and confidence at least 0.75; any shortfall is no greater than tolerance. |
| `material_shortfall` | The same verification gate, with a shortfall greater than tolerance. |
| `ambiguous_variance` | A measurement is completed but unverified, or verified with confidence below 0.75. |
| `unavailable_measurement` | No completed measurement exists; missing is never converted to zero. |

Tolerance is the greater of 5% of projected savings or $100 (zero for a zero
projection). The 5% assumption allows ordinary annualization and measurement
noise; the $100 floor allows whole-dollar aggregation noise for small actions.
The 0.75 resolution gate assumes an executive claim needs three quarters of its
declared support and is not a calibrated probability. Resolved claims at 0.85
or above are labelled `high`; the ten-point margin prevents a barely resolved
claim receiving the strongest label. Other resolved claims are `moderate`,
ambiguous claims are `limited`, and absent measurements are `unavailable`.
Lifecycle and evidence are gates rather than numerical weights because combining
them would create an unexplainable score.

The output is a fixed whitelist. It excludes action titles, owner and department
names, evidence descriptions, prompts, and unknown fields. The remaining action
and evidence identifiers are redacted before entering `reviewProvenance`.
Provenance contains only reconciliation schema, redacted source references,
lifecycle state, update date, and policy version derived from the supplied
reconciliation record. The executable fixture contains only synthetic records;
tests reject prompt fields, customer markers, credentials, provider names, URLs,
and email addresses.

