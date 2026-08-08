import assert from "node:assert/strict";
import test from "node:test";

import {
  BUNDLED_SCENARIO_ERROR, BUNDLED_SCENARIO_IDS, analysisReadiness, analyzeBundledScenario,
} from "../src/finops-bundled-scenarios.js";

test("the boundary accepts only a registered scenario identifier", () => {
  for (const request of [
    {}, null, { scenarioId: BUNDLED_SCENARIO_IDS[0], provider: "bedrock" },
    { scenarioId: BUNDLED_SCENARIO_IDS[0], hris: [] },
    { scenarioId: BUNDLED_SCENARIO_IDS[0], records: [] },
    { scenarioId: BUNDLED_SCENARIO_IDS[0], sanitized: true },
  ]) {
    const result = analyzeBundledScenario(request);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, BUNDLED_SCENARIO_ERROR.INVALID_INPUT);
  }
});

test("an unknown stable identifier is an observable typed failure", () => {
  const result = analyzeBundledScenario({ scenarioId: "not-registered" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, BUNDLED_SCENARIO_ERROR.UNKNOWN_SCENARIO);
  assert.equal(result.error.scenarioId, "not-registered");
});

test("each supported provider-export shape produces one decision-ready finding", () => {
  assert.deepEqual(BUNDLED_SCENARIO_IDS, [
    "aws-bedrock-cur-v1", "google-vertex-detailed-v1", "azure-openai-cost-v1",
  ]);
  const shapes = [];
  for (const scenarioId of BUNDLED_SCENARIO_IDS) {
    const result = analyzeBundledScenario({ scenarioId });
    assert.equal(result.ok, true);
    assert.equal(result.finding.rank, 1);
    assert.ok(result.finding.recoverableSpend.amount >= 1000);
    assert.equal(result.finding.benchmark.comparison, "meets_or_exceeds");
    assert.equal(result.finding.provenance.scenarioId, scenarioId);
    assert.equal(result.finding.provenance.sanitized, true);
    assert.equal(result.finding.nextAction.rank, 1);
    assert.match(result.finding.nextAction.reason, /Ranked first/);
    assert.equal(result.finding.assumptions.length, 3);
    shapes.push([result.providerExportShape.providerId, result.providerExportShape.format]);
  }
  assert.deepEqual(shapes, [
    ["bedrock", "csv"], ["vertex-ai", "jsonl"], ["azure-openai", "json-envelope"],
  ]);
});

test("identical selections produce byte-identical output through the analysis entry point", () => {
  const request = { scenarioId: "aws-bedrock-cur-v1" };
  const first = analysisReadiness(request);
  const second = analysisReadiness(request);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.finding.recoverableSpend.amount, 3600);
  assert.equal(first.readiness.recommendation.id, first.finding.nextAction.id);
});
