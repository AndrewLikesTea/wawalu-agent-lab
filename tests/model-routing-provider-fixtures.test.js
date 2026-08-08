import assert from "node:assert/strict";
import test from "node:test";

import { parseLocalImportFile } from "../src/finops-tabular-import.js";
import { normalizeLocalFinops } from "../src/local-finops.js";
import { MODEL_ROUTING_PROVIDER_FIXTURES } from "../src/model-routing-provider-fixtures.js";

const GENERATED_AT = "2026-04-01T00:00:00.000Z";

function execute(fixture, text = fixture.text) {
  const provider = parseLocalImportFile(text, fixture.filename, fixture.mediaType,
    { generatedAt: GENERATED_AT });
  assert.equal(provider.type, "provider", `${fixture.id}: must import as provider data`);
  const analysis = normalizeLocalFinops({ provider });
  const unit = analysis.modelRouting.ranked[0] ?? analysis.modelRouting.insufficientData[0];
  return { provider, analysis, unit };
}

for (const fixture of MODEL_ROUTING_PROVIDER_FIXTURES) {
  test(`labelled provider fixture: ${fixture.label}`, () => {
    const { provider, analysis, unit } = execute(fixture);
    assert.ok(fixture.assumption.length > 50, "the gate must state its assumption");
    assert.equal(unit.status, fixture.expected.status);
    assert.equal(unit.reasonCode, fixture.expected.reasonCode);
    assert.equal(unit.recoverableUsd, fixture.expected.recoverableUsd);
    assert.equal(unit.confidence.level, fixture.expected.confidence);
    assert.equal(unit.candidates.length, fixture.expected.candidateCount);
    assert.equal(unit.qualityClaim, fixture.expected.qualityClaim);
    assert.equal(analysis.modelRouting.qualityClaim, null);

    const exposed = JSON.stringify({ provider, analysis });
    assert.doesNotMatch(exposed, /ignore previous instructions|<script>|Example Dept/i);
    assert.doesNotMatch(exposed, /quality (is|was|remains|improves)|equal quality/i,
      "billing evidence must not become a quality claim");
  });
}

test("eligible arithmetic and source-field provenance are inspectable", () => {
  const { unit } = execute(MODEL_ROUTING_PROVIDER_FIXTURES[0]);
  const [candidate] = unit.candidates;
  assert.deepEqual({ current: candidate.currentSpendUsd,
    projected: candidate.projectedSpendUsd, recoverable: candidate.recoverableUsd },
  { current: 405, projected: 150, recoverable: 255 });
  assert.equal(candidate.currentSpendUsd - candidate.projectedSpendUsd,
    candidate.recoverableUsd);
  assert.deepEqual(candidate.sourceFields, {
    model: "modelUsage.model", spendMinor: "modelUsage.spendMinor",
    inputTokens: "modelUsage.inputTokens", outputTokens: "modelUsage.outputTokens",
    requests: "modelUsage.requests",
  });
  assert.deepEqual(candidate.inputs, {
    tier: "premium", observedMinorPerMillionTokens: 4050,
    inputTokens: 7_500_000, outputTokens: 2_500_000, tokens: 10_000_000,
    tokensPerCall: 2000, requests: 5000, sourceRows: 1,
  });
});

test("sorting is deterministic under source-row reversal", () => {
  const fixture = MODEL_ROUTING_PROVIDER_FIXTURES[0];
  const rows = fixture.text.trimEnd().split("\n");
  const reversed = `${[rows[0], ...rows.slice(1).reverse()].join("\n")}\n`;
  assert.deepEqual(execute(fixture).analysis.modelRouting,
    execute(fixture, reversed).analysis.modelRouting);
});

test("withheld cases never enter ranking or contribute recoverable spend", () => {
  for (const fixture of MODEL_ROUTING_PROVIDER_FIXTURES.slice(1)) {
    const { analysis, unit } = execute(fixture);
    assert.equal(analysis.modelRouting.ranked.length, 0);
    assert.equal(analysis.modelRouting.insufficientData.length, 1);
    assert.equal(analysis.modelRouting.recoverableUsd, 0);
    assert.equal(unit.qualityClaim, null);
  }
});
