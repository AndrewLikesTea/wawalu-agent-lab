import { SYNTHETIC_COHORT_CONTRACT } from "./synthetic-cohort-contract.js";

export const SYNTHETIC_COHORT_FIXTURE = Object.freeze({
  contractVersion: SYNTHETIC_COHORT_CONTRACT,
  snapshot: Object.freeze({ id: "synthetic-cohorts-2026-07", generatedAt: "2026-08-01T00:00:00Z" }),
  scenarios: Object.freeze([
    ["aws-bedrock-cur-v1", "bedrock", "csv", "Platform Engineering", 18000, 240000, 3600, "standard_model_routing"],
    ["google-vertex-detailed-v1", "vertex-ai", "jsonl", "Data Platform", 22500, 375000, 4500, "batch_down_routing"],
    ["azure-openai-cost-v1", "azure-openai", "json-envelope", "Developer Experience", 15000, 332000, 3000, "mini_default"],
  ].map(([scenario_id, provider_family, export_format, department_label, spend_usd, query_count,
    recoverable_spend_usd, action_code]) => Object.freeze({ scenario_id, provider_family, export_format,
    department_label, spend_usd, query_count, recoverable_spend_usd, action_code }))),
});

