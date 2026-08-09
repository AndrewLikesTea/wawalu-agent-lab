import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeBundledScenario } from "../src/finops-bundled-scenarios.js";
import { evaluateSyntheticCohort, strictUtcTimestamp } from "../src/synthetic-cohort-contract.js";
import { SYNTHETIC_COHORT_FIXTURES as FIXTURES } from "../src/synthetic-cohort-fixtures.js";

test("fixture matrix has deterministic fail-closed outcomes", () => {
  const expected = { valid: "eligible", missing: "missing_data", incompatible: "incompatible_version",
    prohibited_field: "prohibited_field", stale: "stale_input", malformed: "malformed_input", reordered: "eligible" };
  assert.deepEqual(Object.keys(FIXTURES), Object.keys(expected));
  for (const [name, code] of Object.entries(expected)) {
    const result = evaluateSyntheticCohort(structuredClone(FIXTURES[name]));
    assert.equal(result.code, code, name);
    assert.equal(result.comparison_eligible, code === "eligible", name);
    if (code !== "eligible") assert.deepEqual(result.cohorts, [], name);
  }
});

test("generated_at is strict UTC and rejects normalized-invalid dates", () => {
  for (const value of ["2026-02-30T12:00:00Z", "2026-04-31T00:00:00Z", "2026-07-31",
    "2026-07-31T12:00:00+00:00", "July 31 2026"]) assert.equal(strictUtcTimestamp(value), null, value);
  assert.equal(strictUtcTimestamp("2024-02-29T12:00:00.000Z"), 1709208000000);
  const result = evaluateSyntheticCohort({ ...structuredClone(FIXTURES.valid),
    snapshot: { ...FIXTURES.valid.snapshot, generated_at: "2026-02-30T12:00:00Z" } });
  assert.equal(result.code, "malformed_input");
});

test("only approved aggregate attributes survive and ordering is canonical", () => {
  const forward = evaluateSyntheticCohort(FIXTURES.reordered);
  const reversed = evaluateSyntheticCohort({ ...structuredClone(FIXTURES.reordered), cohorts: [...FIXTURES.reordered.cohorts].reverse() });
  assert.deepEqual(forward.cohorts, reversed.cohorts);
  assert.deepEqual(Object.keys(forward.cohorts[0]).sort(),
    ["cohorts"].flatMap(() => ["industry_band", "organization_size_band", "task_volume_band", "member_count", "measures"]).sort());
});

test("provider-scenario entry exposes eligibility and introduces no live request path", async () => {
  const analysis = analyzeBundledScenario({ scenarioId: "aws-bedrock-cur-v1" });
  assert.equal(analysis.comparisonEligibility.code, "eligible");
  assert.match(analysis.comparisonEligibility.message, /comparison eligible/);
  const sources = await Promise.all(["../src/synthetic-cohort-contract.js", "../src/synthetic-cohort-fixtures.js",
    "../src/finops-bundled-scenarios.js"].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const executable = sources.join("\n").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(executable, /\bfetch\s*\(|XMLHttpRequest|https?:\/\//);
  assert.doesNotMatch(executable, /from ["'][^"']*(?:provider|hris)[^"']*(?:client|gateway|api)[^"']*["']/i);
});

test("published schema is closed and pins strict generated_at", async () => {
  const schema = JSON.parse(await readFile(new URL("../contracts/integrations/synthetic-cohort/v1/schema.json", import.meta.url), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schema_version.const, "1.0.0");
  assert.equal(schema.properties.snapshot.properties.generated_at.format, "date-time");
  assert.equal(schema.$defs.cohort.additionalProperties, false);
});
