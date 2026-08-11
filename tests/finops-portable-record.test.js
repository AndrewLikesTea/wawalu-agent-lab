import test from "node:test";
import assert from "node:assert/strict";

import { FINOPS_WORKSPACE_KEY } from "../src/finops-workspace-contract.js";
import { ORG_UNIT_LABEL_STORAGE_KEY } from "../src/org-unit-labels.js";
import { RETAINED_STATE_KEY } from "../src/finops-retained-state.js";
import { MONTHLY_ACTION_KEY } from "../src/monthly-department-action-store.js";
import {
  FINOPS_PORTABLE_VERSION, buildFinopsPortableRecord, importFinopsPortableRecord,
  parseFinopsPortableRecord, serializeFinopsPortableRecord,
} from "../src/finops-portable-record.js";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const storageOf = (seed = {}) => {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

const period = (month = "2026-06") => ({
  periodId: `user:${month}`, period: month, dataset: "user",
  briefingContractVersion: "finops-briefing/1.0.0", derivedAt: `${month}-28T12:00:00.000Z`,
  sourceFingerprint: "abcdef12", analyzedSpendMinor: 10000, attributedSpendMinor: 9000,
  recoverableScenarioMinor: 2000, recordsTotal: 10, recordsAnalyzed: 9,
  coverageRatioPpm: 900000, confidence: "high", missingInputs: [],
  materialMetricId: "recoverable_scenario", materialMetricMinor: 2000,
  topDepartmentId: "support", departmentAllocations: [{ departmentId: "support", recoverableMinor: 2000 }],
});
const commitment = () => ({
  schemaVersion: "shiplog-finops-commitment/1.0.0", commitmentId: "route-support",
  claim: { baselineMonthlyCostMinor: 10000, projectedMonthlyCostMinor: 8000,
    monthlySavingsMinor: 2000, currency: "USD", unit: "usd_minor", period: "2026-06" },
  confidence: { percent: 80, band: "high" },
  provenance: { designation: "imported", analysisPeriod: "2026-06", recordCount: 10 },
  recommendedAction: { workloadId: "chat", departmentId: "support", fromModelId: "large", toModelId: "small" },
  recordedAt: "2026-07-01T00:00:00.000Z", status: "recorded", periodId: "user:2026-06",
});
const monthly = () => ({
  schemaVersion: "monthly-department-action/1.0.0", decisionVersion: "monthly-department-decision/1.0.0",
  actionId: "route-support", actionLabel: "Route support", department: "Support", ownerLabel: "FinOps",
  baseline: { value: 100, unit: "usd", period: "2026-06", aggregation: "sum", calculation: "provider total" },
  target: { value: 80, unit: "usd", deadline: "2026-08-31", calculation: "same provider total" },
  reviewPeriod: "2026-08", confidence: "high", provenanceReferences: ["period:2026-06"],
  committedAt: "2026-07-01T00:00:00.000Z",
});

function seeded({ periods = [period()], labels = { support: "Customer support" } } = {}) {
  return storageOf({
    [FINOPS_WORKSPACE_KEY]: JSON.stringify({ schemaVersion: "finops-workspace/1.1.0",
      consent: { state: "granted", decidedAt: NOW.toISOString(), grantedAgainst: "finops-workspace/1.1.0" },
      periods, commitments: [commitment()], meta: { lastWriteAt: NOW.toISOString() } }),
    [ORG_UNIT_LABEL_STORAGE_KEY]: JSON.stringify(labels),
    [RETAINED_STATE_KEY]: JSON.stringify({ version: 2, capturedAt: NOW.toISOString(),
      declaredRates: [{ model: "gpt-small", unit: "usd_per_million_tokens", rate: 2,
        effectiveDate: "2026-06-01", sourceLabel: "Contract" }],
      scoredCoverage: { coverage: 0.9, departmentIds: ["support"] } }),
    [MONTHLY_ACTION_KEY]: JSON.stringify(monthly()),
  });
}

test("portable record round-trips summaries, labels, declared rates, and commitment inputs", () => {
  const source = seeded();
  const parsed = parseFinopsPortableRecord(serializeFinopsPortableRecord(source));
  assert.equal(parsed.ok, true, parsed.errors?.join("\n"));
  const target = storageOf();
  const result = importFinopsPortableRecord(target, parsed, { now: NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(buildFinopsPortableRecord(target), buildFinopsPortableRecord(source));
});

test("output is deterministic across insertion order and does not carry unapproved state", () => {
  const a = seeded({ periods: [period("2026-06"), period("2026-05")], labels: { z: "Zulu", a: "Alpha" } });
  const b = seeded({ periods: [period("2026-05"), period("2026-06")], labels: { a: "Alpha", z: "Zulu" } });
  assert.equal(serializeFinopsPortableRecord(a), serializeFinopsPortableRecord(b));
  const text = serializeFinopsPortableRecord(a);
  for (const forbidden of ["cookie", "prompt", "sourceRows", "scoredCoverage"]) assert.doesNotMatch(text, new RegExp(forbidden, "i"));
});

test("malformed JSON, unknown versions, invalid values, and prohibited fields are actionable refusals", () => {
  assert.deepEqual(parseFinopsPortableRecord("{").errors, ["File: malformed JSON"]);
  const valid = buildFinopsPortableRecord(seeded());
  const future = parseFinopsPortableRecord(JSON.stringify({ ...valid, schemaVersion: "finops-portable-record/9.0.0" }));
  assert.equal(future.ok, false);
  assert.match(future.errors.join(" "), /unsupported version/);
  const invalid = parseFinopsPortableRecord(JSON.stringify({ ...valid, periods: [{ ...valid.periods[0], recordsTotal: "ten" }] }));
  assert.match(invalid.errors.join(" "), /recordsTotal/);
  for (const field of ["apiKey", "rawPrompt", "customerRows"]) {
    const refused = parseFinopsPortableRecord(JSON.stringify({ ...valid, [field]: "secret" }));
    assert.equal(refused.ok, false);
    assert.match(refused.errors.join(" "), /unsupported or prohibited field/);
  }
});

test("an incompatible existing record requires confirmation and remains byte-identical until confirmed", () => {
  const existing = seeded({ periods: [period("2026-05")] });
  const before = existing.getItem(FINOPS_WORKSPACE_KEY);
  const incoming = parseFinopsPortableRecord(serializeFinopsPortableRecord(seeded()));
  const blocked = importFinopsPortableRecord(existing, incoming, { now: NOW });
  assert.equal(blocked.code, "confirmation_required");
  assert.equal(existing.getItem(FINOPS_WORKSPACE_KEY), before);
  assert.match(blocked.message, /Confirm replacement or cancel/);
  assert.equal(importFinopsPortableRecord(existing, incoming, { confirm: true, now: NOW }).ok, true);
  assert.deepEqual(buildFinopsPortableRecord(existing), incoming.record);
});

test("the contract rejects nested unknown fields rather than silently dropping them", () => {
  const valid = buildFinopsPortableRecord(seeded());
  valid.periods[0].credential = "not-allowed";
  valid.commitmentInputs.approvedCommitments[0].claim.rawPrompt = "hello";
  const result = parseFinopsPortableRecord(JSON.stringify(valid));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /periods\[0\]\.credential/);
  assert.match(result.errors.join("\n"), /claim\.rawPrompt/);
});

test("the schema literal is explicit", () => {
  assert.equal(FINOPS_PORTABLE_VERSION, "finops-portable-record/1.0.0");
});
