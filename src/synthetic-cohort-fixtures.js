// Checked-in invented aggregates. No person, account, prompt, credential,
// provider export row, HRIS employee record, or customer datum is represented.
export const VALID_SYNTHETIC_COHORT_SNAPSHOT = Object.freeze({
  schemaVersion: "1.0.0",
  kind: "wawalu.integration.synthetic-benchmark-cohorts",
  snapshot: Object.freeze({
    id: "synthetic-cohorts-2026-07",
    generatedAt: "2026-07-31T12:00:00.000Z",
    source: "local-synthetic",
    completeness: "complete",
  }),
  cohorts: Object.freeze([Object.freeze({
    cohortKey: "cohort-enterprise-software",
    organizationSize: "enterprise",
    industry: "software",
    memberCount: 40,
    monthlySpendUsd: Object.freeze({ p25: 12000, p50: 18000, p75: 26000 }),
  })]),
});

