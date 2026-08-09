import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BENCHMARK_ELIGIBILITY_CODE, validateBenchmarkComparisonInput, validateSyntheticCohortSnapshot,
} from "../src/synthetic-benchmark-contract.js";
import {
  BENCHMARK_COMPARISON_FIXTURES, comparisonInput, SYNTHETIC_COHORT_FIXTURE,
} from "../src/synthetic-benchmark-fixture.js";
import { importedPeerBenchmark } from "../src/imported-peer-benchmark.js";

const input = comparisonInput({
  organization: { literacyScore: 70, recoverableShare: 0.2 },
  segment: { orgUnits: 8, industry: "saas" },
});
const copy = (value) => structuredClone(value);

test("bundled aggregate snapshot and comparison input are eligible", () => {
  assert.equal(validateSyntheticCohortSnapshot(SYNTHETIC_COHORT_FIXTURE).eligible, true);
  assert.equal(validateBenchmarkComparisonInput(input, SYNTHETIC_COHORT_FIXTURE).code,
    BENCHMARK_ELIGIBILITY_CODE.eligible);
});

test("snapshot id is required and matches synthetic-cohorts-YYYY-MM", () => {
  for (const id of [undefined, "cohorts-2026-06", "synthetic-cohorts-2026-6", "synthetic-cohorts-2026-13"])
    assert.equal(validateSyntheticCohortSnapshot({ ...copy(SYNTHETIC_COHORT_FIXTURE),
      snapshot: { ...SYNTHETIC_COHORT_FIXTURE.snapshot, id } }).eligible, false);
});

test("generatedAt uses strict RFC 3339 date-time, not Date.parse", () => {
  for (const generatedAt of ["2026-06-30", "June 30 2026", "2026-06-30 00:00:00Z",
    "2026-02-30T00:00:00Z"])
    assert.equal(validateSyntheticCohortSnapshot({ ...copy(SYNTHETIC_COHORT_FIXTURE),
      snapshot: { ...SYNTHETIC_COHORT_FIXTURE.snapshot, generatedAt } }).eligible, false);
  assert.equal(validateSyntheticCohortSnapshot(SYNTHETIC_COHORT_FIXTURE).eligible, true);
});

test("missing, incompatible, and prohibited inputs have deterministic codes", () => {
  assert.equal(validateBenchmarkComparisonInput(BENCHMARK_COMPARISON_FIXTURES.missing,
    SYNTHETIC_COHORT_FIXTURE).code, BENCHMARK_ELIGIBILITY_CODE.missing);
  assert.equal(validateBenchmarkComparisonInput(BENCHMARK_COMPARISON_FIXTURES.incompatible,
    SYNTHETIC_COHORT_FIXTURE).code, BENCHMARK_ELIGIBILITY_CODE.incompatible);
  assert.equal(validateBenchmarkComparisonInput(BENCHMARK_COMPARISON_FIXTURES.prohibited,
    SYNTHETIC_COHORT_FIXTURE).code, BENCHMARK_ELIGIBILITY_CODE.prohibited);
  for (const extra of [{ prompt: "secret" }, { provider_account_id: "acct" },
    { hris_employee_record: {} }, { api_key: "secret" }, { raw_customer_data: [] }])
    assert.equal(validateBenchmarkComparisonInput({ ...input, ...extra },
      SYNTHETIC_COHORT_FIXTURE).code, BENCHMARK_ELIGIBILITY_CODE.prohibited);
});

test("reordered approved aggregate fields produce the same result", () => {
  const reordered = { measures: input.measures, taskVolumeBand: input.taskVolumeBand,
    organizationSizeBand: input.organizationSizeBand, industryBand: input.industryBand,
    kind: input.kind, schemaVersion: input.schemaVersion };
  assert.deepEqual(validateBenchmarkComparisonInput(reordered, SYNTHETIC_COHORT_FIXTURE),
    validateBenchmarkComparisonInput(input, SYNTHETIC_COHORT_FIXTURE));
});

test("the shipped FinOps analysis exposes inspectable comparison eligibility", () => {
  const result = importedPeerBenchmark({
    grade: { gradeable: true, composite: 70, rubricVersionId: "literacy-mix/1.0.0",
      records: { scored: 20 }, score: { categories: [{ key: "highValue", share: 0.4 }] } },
    analysis: { spendUsd: 100, recoverableUsd: 20, rankedDepartments: Array(8).fill({}) },
  });
  assert.equal(result.comparisonEligibility.eligible, true);
  assert.equal(result.comparisonEligibility.version, "finops-synthetic-benchmark/1.0.0");
});

test("contract implementation is client-side-only with no live provider or HRIS path", async () => {
  const source = await Promise.all(["synthetic-benchmark-contract.js", "synthetic-benchmark-fixture.js"]
    .map((name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8")));
  assert.doesNotMatch(source.join("\n"), /\bfetch\s*\(|XMLHttpRequest|https?:\/\//i);
});
