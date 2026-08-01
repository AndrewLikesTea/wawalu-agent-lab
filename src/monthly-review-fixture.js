// Bundled, invented decision evidence. This module is the static fixture: it
// contains no customer data, credentials, browser storage, or network source.
export const MONTHLY_REVIEW_FIXTURE = Object.freeze({
  schemaVersion: "finops-monthly-review-fixture/1.0.0",
  fixtureId: "synthetic-northstar-2026-07",
  synthetic: true,
  periods: Object.freeze([
    Object.freeze({ id: "2026-06", observedRecoverableSpendUsd: 12840 }),
    Object.freeze({ id: "2026-07", observedRecoverableSpendUsd: 9340 }),
  ]),
  metric: Object.freeze({
    id: "monthly_recoverable_spend_usd",
    label: "Monthly recoverable spend",
    unit: "USD/month",
    numerator: "Sum of recoverable USD across eligible synthetic provider-usage rows in the period",
    denominator: "Not applicable: this is an absolute monthly USD amount, not a rate",
  }),
  priorCommitment: Object.freeze({
    id: "commitment-route-short-requests",
    statement: "Reduce monthly recoverable spend to $10,000 or less",
    metricId: "monthly_recoverable_spend_usd",
    operator: "<=",
    target: 10000,
  }),
  confidence: Object.freeze({
    level: "high",
    assessment: "High confidence",
    basis: "Both declared monthly periods are complete and all included values trace to the bundled synthetic provider-usage fixture.",
    completeness: Object.freeze({ expectedPeriods: 2, completePeriods: 2, attributedRows: 240, totalRows: 240 }),
  }),
  actions: Object.freeze([
    Object.freeze({ id: "enforce-routing-policy", rank: 1, label: "Enforce the approved model-routing policy for Support summaries", evidence: "Support summaries remain the largest recoverable line at $4,100/month." }),
    Object.freeze({ id: "coach-reprompting", rank: 2, label: "Coach repeated re-prompting in Product Operations", evidence: "Repeated re-prompting represents $2,900/month." }),
    Object.freeze({ id: "review-seat-access", rank: 3, label: "Review inactive seat access", evidence: "Inactive seats represent $1,240/month." }),
  ]),
  provenance: Object.freeze({
    source: "Bundled synthetic two-period provider-usage fixture",
    generatedBy: "Hand-authored deterministic demonstration data",
    observedThrough: "2026-07-31",
    exclusions: Object.freeze(["live integrations", "customer data", "prompt text", "credentials"]),
  }),
});
