const base = () => ({
  schema_version: "1.0.0", kind: "wawalu.integration.synthetic-cohort",
  snapshot: { snapshot_id: "syn_2026_07", generated_at: "2026-07-31T12:00:00Z", completeness: "complete" },
  contract_metadata: { publisher: "Wawalu Agent Lab", license: "synthetic-demo-only", method_version: "cost-performance/1" },
  cohorts: [{ industry_band: "software", organization_size_band: "large", task_volume_band: "high",
    member_count: 40, measures: { task_success_rate: 0.91, cost_per_successful_task_usd: 1.8, monthly_cost_usd: 18000 } }],
});
const make = (change) => Object.freeze(change(base()));
export const SYNTHETIC_COHORT_FIXTURES = Object.freeze({
  valid: make((x) => x),
  missing: make((x) => { x.snapshot.completeness = "partial"; return x; }),
  incompatible: make((x) => { x.schema_version = "2.0.0"; return x; }),
  prohibited_field: make((x) => { x.cohorts[0].provider_account_id = "acct_real"; return x; }),
  stale: make((x) => { x.snapshot.generated_at = "2025-01-01T00:00:00Z"; return x; }),
  malformed: make((x) => { x.snapshot.generated_at = "2026-02-30T12:00:00Z"; return x; }),
  reordered: make((x) => { x.cohorts.push({ ...structuredClone(x.cohorts[0]), organization_size_band: "medium" }); x.cohorts.reverse(); return x; }),
});
