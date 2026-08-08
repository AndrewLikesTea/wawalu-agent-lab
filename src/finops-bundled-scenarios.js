// Closed, bundled-only input boundary for the first-analysis answer. Callers
// choose one stable scenario id; provider shape, sanitized records and the
// canonical projection are private registry facts, never request fields.
import { analysisReadinessForDataset } from "./finops-analysis-readiness.js";

export const BUNDLED_SCENARIO_CONTRACT = "finops-bundled-scenario/1.0.0";
export const BUNDLED_SCENARIO_ERROR = Object.freeze({
  INVALID_INPUT: "invalid_bundled_scenario_input",
  UNKNOWN_SCENARIO: "unknown_bundled_scenario",
});

const PERIOD = Object.freeze({
  periodId: "fixture-period", label: "1–31 July 2026",
  startDate: "2026-07-01", endDate: "2026-07-31",
});

const scenario = ({ id, providerId, format, department, spendUsd, queries, recoverable,
  action, evidenceId }) => Object.freeze({
  id, providerExportShape: Object.freeze({ providerId, format, contractVersion: "1.0.0" }),
  sanitized: true,
  dataset: Object.freeze({
    provenance: Object.freeze({
      label: `Bundled sanitized ${providerId} fixture`,
      source: `${format} provider-export-shaped records; invented values; no customer or HRIS data`,
    }),
    departments: Object.freeze([Object.freeze({ name: department, spendUsd, queries })]),
    evidence: Object.freeze([Object.freeze({ sampleId: evidenceId, category: "Over-provisioned" })]),
    actionPlan: Object.freeze({
      benchmarkPeriods: Object.freeze([PERIOD]),
      actions: Object.freeze([Object.freeze({
        actionId: `${id}-rank-1`, departmentName: department, action,
        isTopNextAction: true, evidenceRefs: Object.freeze([evidenceId]),
        baseline: Object.freeze({
          metricName: "recoverable_spend_usd", value: recoverable, unit: "USD",
          periodRef: PERIOD.periodId,
        }),
        confidence: Object.freeze({ value: 0.75, scale: "0_to_1" }),
      })]),
    }),
  }),
});

const SCENARIOS = Object.freeze([
  scenario({ id: "aws-bedrock-cur-v1", providerId: "bedrock", format: "csv",
    department: "Platform Engineering", spendUsd: 18000, queries: 240000,
    recoverable: 3600, action: "Pilot standard-model routing for routine requests.",
    evidenceId: "bedrock-sanitized-1" }),
  scenario({ id: "google-vertex-detailed-v1", providerId: "vertex-ai", format: "jsonl",
    department: "Data Platform", spendUsd: 22500, queries: 375000,
    recoverable: 4500, action: "Route low-complexity batch requests to the lower-cost model.",
    evidenceId: "vertex-sanitized-1" }),
  scenario({ id: "azure-openai-cost-v1", providerId: "azure-openai", format: "json-envelope",
    department: "Developer Experience", spendUsd: 15000, queries: 332000,
    recoverable: 3000, action: "Default one-step transformations to the mini deployment.",
    evidenceId: "azure-sanitized-1" }),
]);

const BY_ID = new Map(SCENARIOS.map((item) => [item.id, item]));
export const BUNDLED_SCENARIO_IDS = Object.freeze(SCENARIOS.map((item) => item.id));

const failure = (code, message, scenarioId = null) => Object.freeze({
  ok: false, contract: BUNDLED_SCENARIO_CONTRACT,
  error: Object.freeze({ code, message, scenarioId }),
});

/** Resolve and analyze one approved scenario. No other request field is valid. */
export function analyzeBundledScenario(request) {
  const keys = request && typeof request === "object" && !Array.isArray(request)
    ? Object.keys(request) : [];
  if (keys.length !== 1 || keys[0] !== "scenarioId" || typeof request.scenarioId !== "string") {
    return failure(BUNDLED_SCENARIO_ERROR.INVALID_INPUT,
      "Expected exactly { scenarioId }. Provider, HRIS, canonical records and sanitization are registry-owned.");
  }
  const selected = BY_ID.get(request.scenarioId);
  if (!selected) return failure(BUNDLED_SCENARIO_ERROR.UNKNOWN_SCENARIO,
    `No bundled scenario is registered as ${request.scenarioId}.`, request.scenarioId);

  const readiness = analysisReadinessForDataset(selected.dataset);
  const next = readiness.recommendation;
  const threshold = 1000;
  return Object.freeze({
    ok: true, contract: BUNDLED_SCENARIO_CONTRACT, scenarioId: selected.id,
    providerExportShape: selected.providerExportShape, readiness,
    finding: Object.freeze({
      id: `${selected.id}-finding-1`, rank: 1,
      statement: `${next.department} has ${next.figure.text} in modelled recoverable spend.`,
      recoverableSpend: Object.freeze({ amount: next.figure.value, currency: "USD", period: next.figure.period }),
      benchmark: Object.freeze({
        name: "Bundled demo materiality floor", value: threshold, currency: "USD",
        comparison: next.figure.value >= threshold ? "meets_or_exceeds" : "below",
        rule: "A bundled finding is material at $1,000 recoverable spend per fixture period.",
      }),
      provenance: Object.freeze({
        scenarioId: selected.id, providerExportShape: selected.providerExportShape,
        source: selected.dataset.provenance.source, sanitized: true,
      }),
      nextAction: Object.freeze({ rank: 1, id: next.id, action: next.action, reason: next.reason }),
      assumptions: Object.freeze([
        "Provider-export values are invented, sanitized fixture records.",
        "Department attribution is bundled fixture data, not an HRIS lookup.",
        "Recoverable spend is modelled for the stated fixture period, not realized savings.",
      ]),
    }),
  });
}

// The page's analysis entry point. Named for the question it answers while the
// lower-level alias remains explicit for callers handling registry errors.
export const analysisReadiness = analyzeBundledScenario;
