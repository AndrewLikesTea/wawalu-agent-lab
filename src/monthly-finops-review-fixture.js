// Bundled, invented two-period evidence for the static monthly-review preview.
// This file contains no customer data and is never replaced by a fetch or import.
export const MONTHLY_FINOPS_REVIEW_FIXTURE_VERSION = "monthly-finops-review-fixture/1.0.0";

export const MONTHLY_FINOPS_REVIEW_FIXTURE = Object.freeze({
  schemaVersion: MONTHLY_FINOPS_REVIEW_FIXTURE_VERSION,
  evidenceAsOf: "2026-07-31",
  periods: Object.freeze([
    Object.freeze({ id: "synthetic-2026-06", month: "2026-06", totalMinor: 12_000_000, complete: true, observedAt: "2026-06-30" }),
    Object.freeze({ id: "synthetic-2026-07", month: "2026-07", totalMinor: 10_500_000, complete: true, observedAt: "2026-07-31" }),
  ]),
  priorCommitment: Object.freeze({
    id: "synthetic-commitment-01",
    statement: "Reduce monthly AI spend to $108,000 or less.",
    metric: "period_total_minor",
    targetMinor: 10_800_000,
    comparison: "at_most",
  }),
  finding: Object.freeze({
    statement: "AI spend fell by $15,000; the prior cost-control commitment cleared its target.",
    evidencePeriodIds: Object.freeze(["synthetic-2026-06", "synthetic-2026-07"]),
  }),
  actions: Object.freeze([
    Object.freeze({ id: "lock_routing_policy", statement: "Lock the successful routing policy for the next month.", impact: 5, urgency: 4, evidence: 5 }),
    Object.freeze({ id: "audit_remaining_spend", statement: "Audit the remaining high-cost model usage.", impact: 4, urgency: 4, evidence: 4 }),
    Object.freeze({ id: "expand_provider_coverage", statement: "Expand provider coverage before changing policy.", impact: 3, urgency: 2, evidence: 3 }),
  ]),
});
