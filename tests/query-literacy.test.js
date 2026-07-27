import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RUBRIC_VERSION_ID } from "../src/prompt-literacy-scoring.js";
import {
  analyzeQueryLiteracy, BENCHMARK_REASONS, MIN_COHORT_DEPARTMENTS,
  MIN_JOINED_RECORDS_FOR_GRADE, NOT_GRADEABLE_REASONS,
} from "../src/query-literacy.js";
import { ingestQuerySample } from "../src/query-sample.js";

const FIXTURES = new URL("./fixtures/query-sample/", import.meta.url);

/** One Anya-contract v1.1 provider record, at the grain the join reads. */
function billed(department, model, amountMinor, inputTokens, outputTokens) {
  return {
    org_unit_id: department,
    cost: { amount_minor: amountMinor, currency: "USD", status: "final" },
    model_raw: model, model_tier: null, request_count: null,
    input_tokens: inputTokens, output_tokens: outputTokens,
  };
}

const PROVIDER_RECORDS = [
  billed("psn_unit_a", "gpt-4o", 3000, 300_000, 30_000),
  billed("psn_unit_a", "gpt-4o", 2000, 200_000, 20_000),
  billed("psn_unit_b", "claude-sonnet-4", 3000, 90_000, 9_000),
  billed("psn_unit_c", "gpt-4o-mini", 1000, 40_000, 4_000),
  // Billed, never sampled. Must surface as a counted miss, not as silence.
  billed("psn_unit_d", "gpt-4o", 700, 10_000, 1_000),
  // No model on the row: it cannot be joined to a model, so it joins to nothing.
  { org_unit_id: "psn_unit_a", cost: { amount_minor: 100, currency: "USD", status: "final" } },
];

const DEPARTMENTS = [
  { id: "psn_unit_a", name: "Department a", spendUsd: 50 },
  { id: "psn_unit_b", name: "Department b", spendUsd: 60 },
  { id: "psn_unit_c", name: "Department c", spendUsd: 40 },
  { id: "psn_unit_d", name: "Department d", spendUsd: 7 },
];

async function analyze(name) {
  const { rows } = JSON.parse(await readFile(new URL(name, FIXTURES), "utf8"));
  const sample = await ingestQuerySample(rows, { chunkRows: 4 });
  return {
    sample,
    result: analyzeQueryLiteracy({
      sample, providerRecords: PROVIDER_RECORDS, departments: DEPARTMENTS,
    }),
  };
}

const byId = (result) => new Map(result.departments.map((entry) => [entry.departmentId, entry]));

test("full coverage grades every sampled department and stamps Theo's version", async () => {
  const { result } = await analyze("full-coverage.json");
  const departments = byId(result);
  assert.equal(result.available, true);
  assert.equal(result.rubricVersion, RUBRIC_VERSION_ID);

  const a = departments.get("psn_unit_a");
  assert.equal(a.gradeable, true);
  assert.equal(a.score, 93);
  assert.equal(a.grade, "A");
  assert.equal(a.rubricVersion, RUBRIC_VERSION_ID);
  assert.deepEqual(a.coverage, {
    ratio: 1, sampled: 6, classified: 6, joined: 6, unclassified: 0, unjoined: 0,
  });
  // Subscores come off the rubric, not from a second calculation here.
  assert.deepEqual(Object.keys(a.subscores), ["intent", "efficiency", "modelFit"]);
  // Tokens are the billing export's own totals for the joined pairs. Nothing is
  // apportioned across sampled rows.
  assert.deepEqual(a.tokens, { input: 500_000, output: 50_000, source: "billing_aggregate" });

  assert.equal(departments.get("psn_unit_b").score, 46);
  assert.equal(departments.get("psn_unit_c").score, 17);
  assert.equal(departments.get("psn_unit_c").grade, "F");
});

test("the join publishes both directions of miss", async () => {
  const full = (await analyze("full-coverage.json")).result;
  assert.equal(full.join.billingPairs, 4);
  assert.equal(full.join.sampleRowsWithoutBillingMatch, 0);
  assert.equal(full.join.billingRowsWithoutSample, 1, "department d was billed and never sampled");

  const partial = (await analyze("partial-coverage.json")).result;
  // One row on a model billing never bills, plus one row naming a department the
  // roster does not carry. Both are counted; neither becomes a silent drop.
  assert.equal(partial.join.sampleRowsWithoutBillingMatch, 2);
  assert.equal(partial.join.sampleRowsInUnknownDepartment, 1);
  // c and d were billed and never sampled; a and b were both reached.
  assert.equal(partial.join.billingRowsWithoutSample, 2);
});

test("coverage counts unclassified and unjoined rows against the department", async () => {
  const { result } = await analyze("partial-coverage.json");
  const a = byId(result).get("psn_unit_a");
  // Denominator: seven rows survived ingest for this department. Five classified
  // and joined; one carried no signal; one named an unbilled model. The two rows
  // the parser refused are not in any department's denominator.
  assert.deepEqual(a.coverage, {
    ratio: 0.7143, sampled: 7, classified: 6, joined: 5, unclassified: 1, unjoined: 1,
  });
  assert.equal(a.gradeable, true, "exactly at the minimum joined sample");
  assert.equal(a.coverage.joined, MIN_JOINED_RECORDS_FOR_GRADE);
  assert.equal(a.score, 100, "only the five classified-and-joined rows were graded");
  assert.equal(result.sample.rejected, 2);
});

test("every not-gradeable outcome is named, and no department is omitted", async () => {
  const partial = byId((await analyze("partial-coverage.json")).result);
  assert.equal(partial.size, DEPARTMENTS.length);
  const b = partial.get("psn_unit_b");
  assert.equal(b.gradeable, false);
  assert.equal(b.reason, NOT_GRADEABLE_REASONS.insufficientJoinedSample);
  assert.equal(b.score, null, "not gradeable is null, never zero");
  assert.equal(b.grade, null);
  assert.equal(partial.get("psn_unit_c").reason, NOT_GRADEABLE_REASONS.noSampledQueries);

  const none = byId((await analyze("no-usable-sample.json")).result);
  assert.equal(none.size, DEPARTMENTS.length);
  assert.equal(none.get("psn_unit_a").reason, NOT_GRADEABLE_REASONS.noClassifiedQueries);
  assert.equal(none.get("psn_unit_b").reason, NOT_GRADEABLE_REASONS.noClassifiedQueries);
  assert.equal(none.get("psn_unit_d").reason, NOT_GRADEABLE_REASONS.noSampledQueries);
  for (const department of none.values()) assert.equal(department.score, null);
});

test("a department with no billing match is named for that, not for its sample", async () => {
  const sample = await ingestQuerySample([
    { department: "psn_unit_b", model: "gpt-4o", timestamp: "2026-07-01T09:00:00Z",
      excerpt: "Context: real. Requirements: stated. Expected output: named." },
  ]);
  const result = analyzeQueryLiteracy({
    sample, providerRecords: PROVIDER_RECORDS, departments: DEPARTMENTS,
  });
  const b = byId(result).get("psn_unit_b");
  assert.equal(b.reason, NOT_GRADEABLE_REASONS.noBillingMatch);
  assert.equal(b.coverage.unjoined, 1);
});

test("each department carries Noor's tier over its own spend", async () => {
  const { result } = await analyze("full-coverage.json");
  const departments = byId(result);
  assert.equal(departments.get("psn_unit_a").confidence.tier, "high");
  assert.equal(departments.get("psn_unit_a").confidence.showGrade, true);
  assert.equal(departments.get("psn_unit_b").confidence.tier, "moderate");
  assert.equal(departments.get("psn_unit_c").confidence.tier, "provisional");
  assert.equal(departments.get("psn_unit_c").confidence.provisional, true);
  // Department d has spend and no scored query at all.
  assert.equal(departments.get("psn_unit_d").confidence.tier, "insufficient");
  assert.equal(departments.get("psn_unit_d").confidence.showGrade, false);
  // The organization verdict is the same module over the whole analysed set.
  assert.equal(result.eligibility.state, "graded");
  assert.equal(result.eligibility.tier, "high");
});

test("the benchmark produces a real cohort when the reader's own data grades", async () => {
  const { result } = await analyze("full-coverage.json");
  assert.equal(result.benchmark.state, "available");
  assert.equal(result.benchmark.eligible, true);
  assert.equal(result.benchmark.reasonCode, BENCHMARK_REASONS.intraTenantCohort);
  assert.equal(result.benchmark.cohort.kind, "intra_tenant");
  assert.equal(result.benchmark.cohort.size, MIN_COHORT_DEPARTMENTS);
  assert.equal(result.benchmark.cohort.medianScore, 46);
  assert.equal(result.benchmark.rubricVersion, RUBRIC_VERSION_ID);
  // Each department is compared against the median of the *others*, so nothing
  // is compared to itself.
  assert.deepEqual(result.benchmark.comparisons.map((entry) =>
    [entry.departmentId, entry.peerMedian, entry.deltaPoints, entry.position]), [
    ["psn_unit_a", 32, 61, "above"],
    ["psn_unit_b", 55, -9, "below"],
    ["psn_unit_c", 70, -53, "below"],
  ]);
  assert.match(result.benchmark.methodology, /Intra-tenant/);
});

test("an ungradeable benchmark degrades with a code and copy, never free text", async () => {
  const partial = (await analyze("partial-coverage.json")).result;
  assert.equal(partial.benchmark.state, "unavailable");
  assert.equal(partial.benchmark.eligible, false);
  assert.equal(partial.benchmark.reasonCode, BENCHMARK_REASONS.insufficientGradeableDepartments);
  assert.match(partial.benchmark.message, /\S/);
  assert.equal(partial.benchmark.cohort, null);
  assert.deepEqual(partial.benchmark.comparisons, []);

  // No sample at all is a different code, and it is the code this build already
  // published before a sample could be imported.
  const none = analyzeQueryLiteracy({
    sample: null, providerRecords: PROVIDER_RECORDS, departments: DEPARTMENTS,
  });
  assert.equal(none.available, false);
  assert.equal(none.benchmark.reasonCode, BENCHMARK_REASONS.noCompatibleCohort);
  assert.match(none.benchmark.message, /no compatible peer cohort/);
  // Reason codes are enum members, not sentences assembled anywhere.
  for (const code of Object.values(BENCHMARK_REASONS)) assert.match(code, /^[a-z_]+$/);
  for (const code of Object.values(NOT_GRADEABLE_REASONS)) assert.match(code, /^[a-z_]+$/);
});

test("the whole analysis is a pure function of its inputs", async () => {
  const { sample } = await analyze("full-coverage.json");
  const once = analyzeQueryLiteracy({
    sample, providerRecords: PROVIDER_RECORDS, departments: DEPARTMENTS,
  });
  const twice = analyzeQueryLiteracy({
    sample, providerRecords: [...PROVIDER_RECORDS].reverse(), departments: DEPARTMENTS,
  });
  assert.deepEqual(twice.departments, once.departments);
  assert.deepEqual(twice.benchmark, once.benchmark);
});
