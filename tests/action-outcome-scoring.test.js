import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ACTION_OUTCOME_POLICY, scoreActionOutcome, scoreAndRankActionOutcomes,
} from "../src/action-outcome-scoring.js";

const readJson = async (path) => JSON.parse(await readFile(
  new URL(`../${path}`, import.meta.url), "utf8",
));
const fixtures = await readJson("src/action-outcome-fixtures.json");
const evaluation = await readJson("src/evolution-demo-data.json");

test("labelled fixtures cover each disputed outcome and link existing evidence", () => {
  const scored = scoreAndRankActionOutcomes(fixtures.actions);
  assert.deepEqual(Object.fromEntries(scored.map((item) => [item.fixtureId, item.outcomeCode])), {
    "successful-savings": "successful",
    "under-target-savings": "under_target",
    "awaiting-no-result": "awaiting_result",
    "low-confidence-conflict": "low_confidence",
    "zero-projected-savings": "successful",
  });

  const evidenceIds = new Set(evaluation.evidence.map((item) => item.sampleId));
  for (const fixture of fixtures.actions) {
    assert.ok(fixture.evidenceRefs.length > 0, fixture.fixtureId);
    for (const evidenceRef of fixture.evidenceRefs)
      assert.ok(evidenceIds.has(evidenceRef), `${fixture.fixtureId}: ${evidenceRef}`);
  }
});

test("classification uses the documented tolerance at exact boundaries", () => {
  const base = {
    fixtureId: "boundary", actionId: "action-boundary", departmentId: "quality",
    priorityRank: 1, projectedSavingsUsd: 2_000,
    confidence: { value: 0.9 }, evidenceRefs: ["syn-qa-014"], prompt: "",
  };
  const atTolerance = scoreActionOutcome({
    ...base, result: { status: "observed", realizedSavingsUsd: 1_900 },
  });
  const outsideTolerance = scoreActionOutcome({
    ...base, result: { status: "observed", realizedSavingsUsd: 1_899 },
  });
  assert.equal(atTolerance.toleranceUsd, 100);
  assert.equal(atTolerance.outcomeCode, "successful");
  assert.equal(outsideTolerance.outcomeCode, "under_target");

  const percentageTolerance = scoreActionOutcome({
    ...base, projectedSavingsUsd: 10_000,
    result: { status: "observed", realizedSavingsUsd: 9_500 },
  });
  assert.equal(percentageTolerance.toleranceUsd, 500);
  assert.equal(percentageTolerance.outcomeCode, "successful");
});

test("zero projections and missing realized results never create misleading percentages", () => {
  const zero = scoreActionOutcome(fixtures.actions.find(
    (item) => item.fixtureId === "zero-projected-savings",
  ));
  assert.equal(zero.toleranceUsd, 0);
  assert.equal(zero.attainmentPercent, null);
  assert.equal(zero.varianceUsd, 0);

  const awaiting = scoreActionOutcome(fixtures.actions.find(
    (item) => item.fixtureId === "awaiting-no-result",
  ));
  assert.equal(awaiting.outcomeLabel, "Awaiting result");
  assert.equal(awaiting.realizedSavingsUsd, null);
  assert.equal(awaiting.varianceUsd, null);
  assert.equal(awaiting.attainmentPercent, null);
});

test("conflicting confidence is resolved conservatively and remains explainable", () => {
  const result = scoreActionOutcome(fixtures.actions.find(
    (item) => item.fixtureId === "low-confidence-conflict",
  ));
  assert.equal(result.comparisonCode, "successful");
  assert.equal(result.outcomeCode, "low_confidence");
  assert.equal(result.outcomeLabel, "Low-confidence estimate");
  assert.equal(result.confidence.effectiveValue, 0.42);
  assert.equal(result.confidence.threshold, ACTION_OUTCOME_POLICY.minimumConfidence);
  assert.equal(result.confidence.resolutionRule, "minimum valid signal");
  assert.deepEqual(result.confidence.signals.map((item) => item.source),
    ["stated", "aggregate-judge", "retained-evidence"]);
});

test("provenance survives scoring while untrusted prompt text is redacted", () => {
  const fixture = fixtures.actions[0];
  const result = scoreActionOutcome(fixture);
  assert.deepEqual(result.evidenceRefs, fixture.evidenceRefs);
  assert.deepEqual(result.provenance.evidenceRefs, fixture.evidenceRefs);
  assert.equal(result.provenance.fixtureId, fixture.fixtureId);
  assert.equal(result.provenance.actionId, fixture.actionId);
  assert.equal(result.provenance.scoringPolicy, ACTION_OUTCOME_POLICY.version);
  assert.equal(result.judgeInput.redactionStatus, "redacted_before_scoring");

  const serialized = JSON.stringify(result);
  for (const secret of [
    "qa.owner@northwind.example", "internal.northwind.example",
    "demo-quality-token-000",
  ]) assert.ok(!serialized.includes(secret), secret);
  for (const placeholder of ["[email]", "[url]", "[secret]"])
    assert.ok(result.judgeInput.prompt.includes(placeholder), placeholder);
  assert.ok(!Object.hasOwn(result, "prompt"));
});

test("UI-consumed fields and priority order are identical across fixture reloads", async () => {
  const reloaded = await readJson("src/action-outcome-fixtures.json");
  const first = scoreAndRankActionOutcomes(fixtures.actions);
  const second = scoreAndRankActionOutcomes(reloaded.actions);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map((item) => item.actionId), [
    "action-quality-down-route-v1",
    "action-frontend-retry-workshop-v1",
    "action-data-ml-acceptable-use-v1",
    "action-backend-down-route-v1",
    "action-zero-projection-control-v1",
  ]);
  for (const item of first) {
    for (const field of [
      "outcomeCode", "outcomeLabel", "projectedSavingsUsd", "realizedSavingsUsd",
      "varianceUsd", "attainmentPercent", "toleranceUsd", "priorityRank",
      "evidenceRefs", "provenance",
    ]) assert.ok(Object.hasOwn(item, field), `${item.fixtureId}: ${field}`);
  }
});

test("scoring rejects an invalid projection instead of emitting an unexplainable number", () => {
  assert.throws(() => scoreActionOutcome({ projectedSavingsUsd: "unknown" }),
    /projectedSavingsUsd/);
  assert.throws(() => scoreActionOutcome({ projectedSavingsUsd: -1 }),
    /projectedSavingsUsd/);
});
