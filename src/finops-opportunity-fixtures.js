// Synthetic aggregate fixtures shipped with the AI FinOps page. They contain
// no prompt text or identifiers from a provider/customer system.
export const BUNDLED_FINOPS_OPPORTUNITY_FIXTURES = Object.freeze([
  Object.freeze({
    id: "syn-commit-support-triage", name: "Synthetic Customer Operations",
    // 124,205 × 40% × 0.70 recoverable × 0.90 attainment = 31,299.66,
    // rounded once to $31,300: the amount the destination fixture commits to.
    spendUsd: 124205, periodDays: 30,
    mix: { highValue: 0.5, overProvisioned: 0.4, inefficient: 0.08, outOfScope: 0.02 },
    sampling: { status: "available", sampledQueries: 600 },
    patterns: { repeatedShapeShare: 0.5 },
  }),
  Object.freeze({
    id: "syn-commit-batch-summaries", name: "Synthetic Data Platform",
    spendUsd: 42000, periodDays: 30,
    mix: { highValue: 0.44, overProvisioned: 0.12, inefficient: 0.42, outOfScope: 0.02 },
    sampling: { status: "available", sampledQueries: 480 },
    patterns: { repeatedShapeShare: 0.85 },
  }),
  // Failed/retried calls distributed across shapes: coaching, not a template.
  Object.freeze({
    id: "syn-retry-failed-calls", name: "Synthetic Reliability",
    spendUsd: 24000, periodDays: 30,
    mix: { highValue: 0.42, overProvisioned: 0.04, inefficient: 0.52, outOfScope: 0.02 },
    sampling: { status: "available", sampledQueries: 250 },
    patterns: { repeatedShapeShare: 0 },
  }),
  // Explicit abstention: no sample means no executive number.
  Object.freeze({
    id: "syn-insufficient", name: "Synthetic Research",
    spendUsd: 90000, periodDays: 30,
    mix: { highValue: 0.2, overProvisioned: 0.6, inefficient: 0.2, outOfScope: 0 },
    sampling: { status: "unavailable", sampledQueries: 0 },
    patterns: { repeatedShapeShare: 0.5 },
  }),
]);
