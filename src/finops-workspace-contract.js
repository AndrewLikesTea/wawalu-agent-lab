// The executable, versioned contract behind the local FinOps workspace preview.
//
// This module deliberately does not read or write storage. Persistence can land
// independently, but it must import these names instead of copying field lists
// out of the accompanying design document. The workspace page consumes the same
// sample and allowlists, making the pre-consent explanation inspectable today.

export const FINOPS_WORKSPACE_VERSION = "finops-workspace/1.1.0";
export const FINOPS_WORKSPACE_KEY = "shiplog.finops.workspace.v1";
export const FINOPS_LABELS_KEY = "shiplog.finops.orgUnitLabels";
export const OPERATING_CYCLE_STORAGE_KEY = "shiplog.finops.syntheticOperatingCycle";

/**
 * Every document version this build can read, oldest first. A store written by
 * one of them is migrated forward on read (see `finops-workspace-migrations.js`);
 * a store written by anything else is refused rather than reinterpreted, because
 * a reader that guesses at an unknown version is a reader that silently drops
 * fields it does not understand.
 */
export const FINOPS_WORKSPACE_VERSION_1_0_0 = "finops-workspace/1.0.0";
export const FINOPS_SUPPORTED_WORKSPACE_VERSIONS = Object.freeze([
  FINOPS_WORKSPACE_VERSION_1_0_0,
  FINOPS_WORKSPACE_VERSION,
]);

export const FINOPS_WORKSPACE_FIELDS = Object.freeze([
  "schemaVersion", "consent", "periods", "commitments", "meta",
]);

export const FINOPS_CONSENT_FIELDS = Object.freeze([
  "state", "decidedAt", "grantedAgainst",
]);

export const FINOPS_META_FIELDS = Object.freeze(["lastWriteAt"]);

export const FINOPS_PERIOD_FIELDS = Object.freeze([
  "periodId", "period", "dataset", "briefingContractVersion", "derivedAt",
  "sourceFingerprint", "analyzedSpendMinor", "attributedSpendMinor",
  "recoverableScenarioMinor", "recordsTotal", "recordsAnalyzed",
  "coverageRatioPpm", "confidence", "missingInputs", "materialMetricId",
  "materialMetricMinor", "absenceReason", "topDepartmentId",
]);

export const FINOPS_COMMITMENT_ENVELOPE_FIELDS = Object.freeze([
  "schemaVersion", "commitmentId", "claim", "confidence", "provenance",
  "recommendedAction", "recordedAt", "status", "decisionId", "periodId",
]);

/** The sub-objects of a retained commitment, each closed the same way. */
export const FINOPS_COMMITMENT_CLAIM_FIELDS = Object.freeze([
  "baselineMonthlyCostMinor", "projectedMonthlyCostMinor", "monthlySavingsMinor",
  "currency", "unit", "period",
]);

export const FINOPS_COMMITMENT_CONFIDENCE_FIELDS = Object.freeze(["percent", "band"]);

/**
 * Deliberately narrower than the decision block's provenance: `sourceId`,
 * `importedAt`, and `recordIds` are dropped at the door. Source-row identifiers
 * are a prohibited class below, and a count answers "how much evidence" without
 * naming a single row of anyone's file.
 */
export const FINOPS_COMMITMENT_PROVENANCE_FIELDS = Object.freeze([
  "designation", "analysisPeriod", "recordCount",
]);

export const FINOPS_COMMITMENT_ACTION_FIELDS = Object.freeze([
  "workloadId", "departmentId", "fromModelId", "toModelId",
]);

/** What a retained commitment can say about itself. `recorded` has no decision. */
export const FINOPS_COMMITMENT_STATUSES = Object.freeze(["recorded", "decision_linked"]);

export const FINOPS_PROHIBITED_CLASSES = Object.freeze([
  {
    label: "Credentials and identities",
    detail: "No API keys, tokens, cookies, account numbers, organization IDs, email addresses, or user names.",
  },
  {
    label: "Prompts and model content",
    detail: "No prompts, completions, excerpts, conversations, embeddings, or samples.",
  },
  {
    label: "Raw imports",
    detail: "No files, filenames, headers, cells, source rows, sheet names, or source-row IDs.",
  },
  {
    label: "Network transfer",
    detail: "No URLs, endpoints, request IDs, telemetry, sync cursors, or queued payloads.",
  },
]);

// Normative synthetic fixture. A future persistence adapter projects real
// derived data into precisely this shape; the preview never needs a credential,
// a raw import, or a network request.
export const SAMPLE_FINOPS_WORKSPACE = Object.freeze({
  schemaVersion: FINOPS_WORKSPACE_VERSION,
  consent: Object.freeze({
    state: "granted",
    decidedAt: "2026-07-02T09:14:00Z",
    grantedAgainst: FINOPS_WORKSPACE_VERSION,
  }),
  periods: Object.freeze([Object.freeze({
    periodId: "example:2026-06",
    period: "2026-06",
    dataset: "example",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-07-02T09:14:00Z",
    sourceFingerprint: "c1daf8d2",
    analyzedSpendMinor: 4820000,
    attributedSpendMinor: 4577000,
    recoverableScenarioMinor: 612000,
    recordsTotal: 1840,
    recordsAnalyzed: 1748,
    coverageRatioPpm: 950000,
    confidence: "high",
    missingInputs: Object.freeze([]),
    materialMetricId: "recoverable_scenario",
    materialMetricMinor: 612000,
    topDepartmentId: "customer-support",
  })]),
  commitments: Object.freeze([Object.freeze({
    schemaVersion: "shiplog-finops-commitment/1.0.0",
    commitmentId: "route-support-triage-to-haiku",
    claim: Object.freeze({
      baselineMonthlyCostMinor: 1840000,
      projectedMonthlyCostMinor: 1228000,
      monthlySavingsMinor: 612000,
      currency: "USD",
      unit: "usd_minor",
      period: "2026-06",
    }),
    confidence: Object.freeze({ percent: 78, band: "high" }),
    provenance: Object.freeze({
      designation: "demo",
      analysisPeriod: "2026-06",
      recordCount: 2,
    }),
    recommendedAction: Object.freeze({
      workloadId: "support-triage",
      departmentId: "customer-support",
      fromModelId: "opus-tier",
      toModelId: "haiku-tier",
    }),
    recordedAt: "2026-07-02T09:15:00Z",
    status: "decision_linked",
    decisionId: "finops-commitment-route-support-triage-to-haiku",
    periodId: "example:2026-06",
  })]),
  meta: Object.freeze({ lastWriteAt: "2026-07-02T09:15:00Z" }),
});

export function serializeFinopsWorkspacePreview() {
  return JSON.stringify(SAMPLE_FINOPS_WORKSPACE, null, 2);
}
