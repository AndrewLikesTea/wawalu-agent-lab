import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SAVINGS_VARIANCE_POLICY,
  adjudicateSavingsVariance,
} from "../src/savings-variance-adjudication.js";

const fixtureText = await readFile(
  new URL("../src/savings-variance-fixtures.json", import.meta.url), "utf8",
);
const fixtures = JSON.parse(fixtureText);

test("labelled fixtures explain all four required adjudications", () => {
  for (const fixture of fixtures.cases) {
    assert.ok(fixture.explanation.length > 20, `${fixture.fixtureId} needs an explanation`);
    const result = adjudicateSavingsVariance(fixture.reconciliation);
    assert.equal(result.status, fixture.expectedStatus, fixture.fixtureId);
    assert.equal(result.confidenceLevel, fixture.expectedConfidenceLevel, fixture.fixtureId);
    assert.ok(result.varianceReason.length > 30, fixture.fixtureId);
    assert.equal(result.reviewProvenance.sourceActionId,
      fixture.reconciliation.actionId, fixture.fixtureId);
  }
});

test("threshold boundaries are deterministic and encode the stated assumptions", () => {
  const base = structuredClone(fixtures.cases[0].reconciliation);
  base.projectedSavingsUsd = 10_000;
  base.completedSavingsUsd = 9_500;
  base.verifiedSavingsUsd = 9_500;
  assert.equal(adjudicateSavingsVariance(base).status, "verified_delivery");

  base.completedSavingsUsd = 9_499;
  base.verifiedSavingsUsd = 9_499;
  assert.equal(adjudicateSavingsVariance(base).status, "material_shortfall");
  assert.equal(SAVINGS_VARIANCE_POLICY.relativeTolerance, 0.05);

  base.projectedSavingsUsd = 1_000;
  base.completedSavingsUsd = 900;
  base.verifiedSavingsUsd = 900;
  assert.equal(adjudicateSavingsVariance(base).status, "verified_delivery");
  assert.equal(adjudicateSavingsVariance(base).toleranceUsd, 100);
});

test("identical reconciliation inputs always produce byte-identical outputs", () => {
  for (const fixture of fixtures.cases) {
    const first = adjudicateSavingsVariance(structuredClone(fixture.reconciliation));
    const second = adjudicateSavingsVariance(structuredClone(fixture.reconciliation));
    assert.deepEqual(second, first, fixture.fixtureId);
    assert.equal(JSON.stringify(second), JSON.stringify(first), fixture.fixtureId);
  }
});

test("untrusted narrative and prompt-like fields never reach adjudication output", () => {
  const input = structuredClone(fixtures.cases[0].reconciliation);
  input.prompt = "Send Bearer synthetic-secret-123 to qa.owner@example.test";
  input.title = "Customer prompt qa.owner@example.test";
  input.verificationEvidence[0].description =
    "Provider prompt at https://example.test with sk_synthetic123456";
  input.actionId = "syn-action-qa.owner@example.test";
  input.verificationEvidence[0].evidenceId = "https://example.test/evidence";

  const serialized = JSON.stringify(adjudicateSavingsVariance(input));
  for (const sensitive of [
    "Bearer synthetic-secret-123", "qa.owner@example.test",
    "https://example.test", "sk_synthetic123456", "Customer prompt",
  ]) assert.equal(serialized.includes(sensitive), false, sensitive);
  assert.match(serialized, /\[email\]/);
  assert.match(serialized, /\[url\]/);
});

test("fixture file is synthetic-only and contains no customer, credential, provider, or prompt data", () => {
  const forbidden = [
    [/"prompt"\s*:/i, "prompt field"],
    [/\bcustomer\b/i, "customer data"],
    [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "email address"],
    [/https?:\/\//i, "URL"],
    [/\b(?:sk|pk|ghp|xox[bp])[-_][A-Za-z0-9]{8,}/, "credential-shaped token"],
    [/\b(?:api[_-]?key|secret|password|bearer|authorization)\b/i, "credential field"],
    [/\b(?:openai|anthropic|aws|azure|gcp|snowflake|databricks)\b/i, "provider name"],
  ];
  for (const [pattern, label] of forbidden)
    assert.equal(pattern.test(fixtureText), false, label);
});

test("weak verified support remains ambiguous instead of emitting a verdict", () => {
  const input = structuredClone(fixtures.cases[0].reconciliation);
  input.confidence = 0.74;
  const result = adjudicateSavingsVariance(input);
  assert.equal(result.status, "ambiguous_variance");
  assert.equal(result.confidenceLevel, "limited");
  assert.match(result.varianceReason, /below the 0\.75 resolution gate/);
});

