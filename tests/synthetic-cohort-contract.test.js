import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeBundledScenario } from "../src/finops-bundled-scenarios.js";
import { evaluateSyntheticCohorts } from "../src/synthetic-cohort-contract.js";
import { VALID_SYNTHETIC_COHORT_SNAPSHOT as VALID } from "../src/synthetic-cohort-fixtures.js";

const copy = () => structuredClone(VALID);
const codes = (result) => result.reasons.map(({ code }) => code);

test("valid local aggregate fixture is eligible with inspectable reasons", () => {
  const result = evaluateSyntheticCohorts(copy());
  assert.equal(result.eligible, true);
  assert.equal(result.snapshot.id, "synthetic-cohorts-2026-07");
  assert.deepEqual(codes(result), ["approved_aggregates_only", "contract_shape", "compatible_version",
    "snapshot_shape", "snapshot_id", "generated_at", "published_month",
    "local_synthetic_source", "aggregate_cohorts"]);
  assert.ok(result.reasons.every(({ valid, message }) => valid && message.length > 0));
  assert.deepEqual(result.comparisonReasons, result.reasons);
});

test("missing and incompatible envelopes are refused without projection", () => {
  const missing = copy(); delete missing.cohorts;
  const incompatible = copy(); incompatible.schemaVersion = "2.0.0";
  for (const input of [missing, incompatible]) {
    const result = evaluateSyntheticCohorts(input);
    assert.equal(result.eligible, false);
    assert.deepEqual(result.cohorts, []);
    assert.ok(result.reasons.some(({ valid }) => !valid));
  }
});

test("prohibited identifiers, credentials, prompts, account, HRIS and raw customer fields fail closed", () => {
  for (const field of ["employeeId", "credentials", "prompt", "providerAccountId", "hrisRecord", "customerData"]) {
    const input = copy(); input.cohorts[0][field] = "prohibited";
    const result = evaluateSyntheticCohorts(input);
    assert.equal(result.eligible, false, field);
    assert.equal(result.reasons[0].code, "approved_aggregates_only");
    assert.match(result.reasons[0].message, new RegExp(field));
  }
});

test("snapshot.id is required and must match synthetic-cohorts-YYYY-MM", () => {
  for (const id of [undefined, "cohorts-2026-07", "synthetic-cohorts-2026-13", "synthetic-cohorts-26-07"]) {
    const input = copy();
    if (id === undefined) delete input.snapshot.id; else input.snapshot.id = id;
    const result = evaluateSyntheticCohorts(input);
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.some(({ code, valid }) => !valid
      && ["snapshot_shape", "snapshot_id"].includes(code)));
  }
});

test("generatedAt rejects date-only, rollover and permissively parseable values", () => {
  for (const generatedAt of ["2026-07-31", "2026-02-30T12:00:00.000Z",
    "July 31, 2026 12:00:00 UTC", "2026-07-31T12:00:00+00:00", "invalid"]) {
    const input = copy(); input.snapshot.generatedAt = generatedAt;
    const result = evaluateSyntheticCohorts(input);
    assert.equal(result.eligible, false, generatedAt);
    assert.ok(result.reasons.some(({ code, valid }) => code === "generated_at" && !valid));
  }
});

test("reordered cohorts produce canonical comparison input", () => {
  const input = copy();
  input.cohorts.push({ ...input.cohorts[0], cohortKey: "cohort-mid-software",
    organizationSize: "mid", monthlySpendUsd: { ...input.cohorts[0].monthlySpendUsd } });
  const forward = evaluateSyntheticCohorts(input);
  input.cohorts.reverse();
  const reversed = evaluateSyntheticCohorts(input);
  assert.deepEqual(forward.cohorts, reversed.cohorts);
  assert.deepEqual(forward.cohorts.map(({ cohortKey }) => cohortKey),
    ["cohort-enterprise-software", "cohort-mid-software"]);
});

test("provider-scenario entry consumes cohort eligibility and remains local-only", async () => {
  const result = analyzeBundledScenario({ scenarioId: "aws-bedrock-cur-v1" });
  assert.equal(result.benchmarkCohortEligibility.eligible, true);
  assert.ok(result.benchmarkCohortEligibility.reasons.length > 0);
  const sources = await Promise.all([
    "../src/synthetic-cohort-contract.js", "../src/synthetic-cohort-fixtures.js",
    "../src/finops-bundled-scenarios.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /\bfetch\s*\(|XMLHttpRequest|https?:\/\//);
  assert.doesNotMatch(joined, /provider.*(?:request|client)|hris.*(?:request|client)/i);
});

test("published JSON schema pins snapshot id and strict date-time", async () => {
  const schema = JSON.parse(await readFile(new URL("../contracts/integrations/synthetic-benchmark-cohorts/v1/schema.json", import.meta.url), "utf8"));
  assert.equal(schema.properties.snapshot.required.includes("id"), true);
  assert.match(schema.properties.snapshot.properties.id.pattern, /synthetic-cohorts/);
  assert.equal(schema.properties.snapshot.properties.generatedAt.format, "date-time");
  assert.ok(schema.properties.snapshot.properties.generatedAt.pattern);
  assert.equal(schema.additionalProperties, false);
});
