// The join key the prompt-literacy grade is computed on, pinned to fixtures.
//
// WHAT THESE FIXTURES DEFEND. A director with a provider export and a query
// sample but no HRIS file keys the sample the way their provider groups their
// bill — by project, workspace, account, resource group. The grade used to be
// unreachable for them. It is reachable now, and the thing that must never
// happen is that reaching it moved somebody else's already-published number.
//
// So there are two kinds of test here and they are not interchangeable:
//
//   * the regression pin, which restates every grade the suite published before
//     provider-native keys existed, captured from the shipped fixtures. Any
//     drift in it is a defect, never a rebaseline.
//   * the equivalence pair, which asserts one sample scores identically whether
//     it arrives keyed by a provider unit or by an org pseudonym. That is the
//     test that stops an enrichment upgrade — an HRIS file landing later and
//     re-keying the same queries — from silently moving a score.
//
// Sample rows are generated here rather than committed, so the excerpt strings
// that drive classification sit beside the grade they are claimed to produce.
// No expected value below was read out of the module: each is derived from the
// rubric's own arithmetic and stated in the comment above it.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { detectDialect } from "../src/dialect-detection.js";
import {
  analyzeQueryLiteracy, JOIN_KEY_SPACES, MISSING_INPUTS, NOT_GRADEABLE_REASONS,
  resolveJoinKeySpace,
} from "../src/query-literacy.js";
import { ingestQuerySample } from "../src/query-sample.js";

// --- the billing side, shared by every case -------------------------------

/** One Anya-contract provider record, at the grain the join reads. */
const billed = (department, model, amountMinor, inputTokens, outputTokens) => ({
  org_unit_id: department,
  cost: { amount_minor: amountMinor, currency: "USD", status: "final" },
  model_raw: model, model_tier: null, request_count: null,
  input_tokens: inputTokens, output_tokens: outputTokens,
});

const PROVIDER_RECORDS = [
  billed("psn_unit_a", "gpt-4o", 3000, 300_000, 30_000),
  billed("psn_unit_b", "claude-sonnet-4", 3000, 90_000, 9_000),
  billed("psn_unit_c", "gpt-4o-mini", 1000, 40_000, 4_000),
];

/**
 * Three departments, each declaring the provider-native project the export
 * bills it under. `unitKeys` is the reader's own mapping, not an inference.
 */
const DEPARTMENTS = [
  { id: "psn_unit_a", name: "Department a", spendUsd: 30, unitKeys: ["atlas-prod"] },
  { id: "psn_unit_b", name: "Department b", spendUsd: 30, unitKeys: ["borealis-api"] },
  { id: "psn_unit_c", name: "Department c", spendUsd: 10, unitKeys: ["cadmus-batch"] },
];

/** The same departments before an HRIS file ever landed: id *is* the project. */
const UNIT_ONLY_DEPARTMENTS = [
  { id: "atlas-prod", name: "atlas-prod", spendUsd: 30 },
  { id: "borealis-api", name: "borealis-api", spendUsd: 30 },
  { id: "cadmus-batch", name: "cadmus-batch", spendUsd: 10 },
];

// --- Anya's detection result, used as the authority, never re-derived ------

/**
 * A header row from an OpenAI organization usage export. It is fed to
 * `detectDialect` rather than hand-written into a fake result, so this suite
 * fails if the profile registry stops reporting a grouping unit for it.
 */
const OPENAI_TABLE = Object.freeze({
  columns: Object.freeze([
    "usage_date", "model", "project", "n_context_tokens_total",
    "n_generated_tokens_total", "amount", "currency",
  ]),
  rows: Object.freeze([]),
});

const GROUPING = detectDialect(OPENAI_TABLE);

test("Anya's detection names the provider-native grouping unit this join resolves against", () => {
  assert.equal(GROUPING.status, "matched");
  assert.equal(GROUPING.profileId, "openai-usage-export");
  assert.equal(GROUPING.groupingUnit, "project");
  // An unmatched table states the absence rather than omitting the key, so a
  // consumer reads null instead of undefined and cannot fall through to a guess.
  const unmatched = detectDialect({ columns: ["a", "b"], rows: [] });
  assert.equal(unmatched.status, "unidentified");
  assert.equal(unmatched.groupingUnit, null);
});

// --- generated sample rows -------------------------------------------------

// Excerpts chosen for one property each and nothing else. They are the same
// shapes the shipped `tests/fixtures/query-sample` files use, restated here so
// a reader can see which text produces which category without opening a fixture.
const HIGH_VALUE = [
  "Context: the billing service returns 500s under load. Constraints: must not change the schema. Acceptance criteria: a passing regression test.",
  "Background: nightly export job. Requirements: idempotent reruns. Expected output: a diff of changed rows.",
  "Given the following stack trace, do not use a retry loop. Definition of done: the handler returns 409.",
  "Context: migration 0007 is slow. Constraints: limited to one lock. Success looks like a sub-second apply.",
  "Here is the failing test. Requirements: keep the public signature. Expected output: the minimal patch.",
  "Context: on-call rota. Requirements: two engineers per shift. Expected output: a table.",
];

const OUT_OF_SCOPE = [
  "give me a recipe for a birthday dinner",
  "write me a poem about the sprint",
  "movie recommendation for tonight",
  "fantasy football waiver advice",
  "vacation policy horoscope joke",
  "planning a wedding playlist",
];

/** Six rows for one key, all drawn from one excerpt set. */
function rowsFor(key, model, excerpts) {
  return excerpts.map((excerpt, position) => ({
    department: key,
    model,
    timestamp: `2026-07-01T0${position}:00:00Z`,
    excerpt,
  }));
}

const ingest = (rows) => ingestQuerySample(rows, { chunkRows: 4 });

const byId = (result) => new Map(result.departments.map((entry) => [entry.departmentId, entry]));

// --- 1. full sample: every grouping unit covered ---------------------------

test("full sample: every grouping unit is covered and every covered unit grades", async () => {
  const sample = await ingest([
    ...rowsFor("atlas-prod", "gpt-4o", HIGH_VALUE),
    ...rowsFor("borealis-api", "claude-sonnet-4", HIGH_VALUE),
    ...rowsFor("cadmus-batch", "gpt-4o-mini", OUT_OF_SCOPE),
  ]);
  const result = analyzeQueryLiteracy({
    sample, providerRecords: PROVIDER_RECORDS, departments: DEPARTMENTS, grouping: GROUPING,
  });

  assert.equal(result.joinKey.space, JOIN_KEY_SPACES.providerUnit);
  assert.equal(result.joinKey.unit, "project");
  assert.equal(result.joinKey.declaredUnitKeys, 3);
  assert.equal(result.missingInput, null);
  assert.equal(result.join.sampleRowsInUnknownDepartment, 0);

  const departments = byId(result);
  // Six high-value queries: every axis credit is 100, so the composite is
  // 100 and the letter is A by the >=90 cutoff. Hand-derived from the rubric.
  for (const id of ["psn_unit_a", "psn_unit_b"]) {
    assert.equal(departments.get(id).score, 100, id);
    assert.equal(departments.get(id).grade, "A", id);
    assert.deepEqual(departments.get(id).subscores,
      { intent: 100, efficiency: 100, modelFit: 100 });
    assert.equal(departments.get(id).coverage.ratio, 1);
  }
  // Six out-of-scope queries: zero credit on all three axes, composite 0, F.
  assert.equal(departments.get("psn_unit_c").score, 0);
  assert.equal(departments.get("psn_unit_c").grade, "F");
  assert.deepEqual(departments.get("psn_unit_c").subscores,
    { intent: 0, efficiency: 0, modelFit: 0 });

  // Every department in the analysed set is graded, so coverage is total.
  assert.equal(result.eligibility.coverage, 1);
  assert.equal(result.eligibility.showGrade, true);
});

// --- 2. partial sample: only some units covered ----------------------------

// THE PARTIAL-COVERAGE ASSUMPTION, stated once and asserted below.
//
// A partial sample grades the units it covers and states the coverage beside
// the grade. It does not suppress.
//
// Why: suppression is already Noor's job, and Noor decides it on *spend*, not
// on unit count — the tier and its `showGrade` flag are computed from the share
// of imported spend that sits under a graded unit. Suppressing here as well
// would apply a second, unstated rule on a different denominator, so a sample
// covering one small unit and one covering four-fifths of the money would both
// vanish. The grade for a covered unit is a real measurement of that unit; what
// a partial sample makes unsafe is the *roll-up*, and that is exactly what the
// eligibility tier withholds.
test("partial sample: covered units grade, uncovered units are named, coverage is stated", async () => {
  const sample = await ingest([
    ...rowsFor("atlas-prod", "gpt-4o", HIGH_VALUE),
  ]);
  const result = analyzeQueryLiteracy({
    sample, providerRecords: PROVIDER_RECORDS, departments: DEPARTMENTS, grouping: GROUPING,
  });
  const departments = byId(result);

  // Covered: graded, exactly as it would be in a full sample.
  assert.equal(departments.get("psn_unit_a").gradeable, true);
  assert.equal(departments.get("psn_unit_a").score, 100);
  assert.equal(departments.get("psn_unit_a").grade, "A");

  // Uncovered: a named reason and a null score. Never a zero, never absent.
  for (const id of ["psn_unit_b", "psn_unit_c"]) {
    const entry = departments.get(id);
    assert.equal(entry.gradeable, false, id);
    assert.equal(entry.score, null, id);
    assert.equal(entry.grade, null, id);
    assert.equal(entry.reason, NOT_GRADEABLE_REASONS.noSampledQueries, id);
  }

  // Coverage is stated, not implied: $30 of $70 graded is under a half, which is
  // Noor's provisional band, and the letter is shown marked provisional.
  assert.equal(result.eligibility.coverage, 30 / 70);
  assert.equal(result.eligibility.tier, "provisional");
  assert.equal(result.eligibility.showGrade, true);
  assert.equal(result.eligibility.provisional, true);
  assert.equal(result.missingInput, null);
});

// --- 3. no-match sample: keys name no billed unit --------------------------

test("no-match sample: a named missing input, not a zero", async () => {
  const sample = await ingest([
    ...rowsFor("some-other-project", "gpt-4o", HIGH_VALUE),
  ]);
  const result = analyzeQueryLiteracy({
    sample, providerRecords: PROVIDER_RECORDS, departments: DEPARTMENTS, grouping: GROUPING,
  });

  // Not one department scores. None of them scores zero either.
  for (const entry of result.departments) {
    assert.equal(entry.score, null, entry.departmentId);
    assert.equal(entry.grade, null, entry.departmentId);
    assert.equal(entry.reason, NOT_GRADEABLE_REASONS.noSampledQueries);
  }
  assert.equal(result.join.sampleRowsInUnknownDepartment, 6);

  // The missing input is named, with the one action that supplies it, and the
  // grade is suppressed through Noor's tier rather than by a second rule here.
  assert.equal(result.missingInput.kind, "unresolvedSample");
  assert.equal(result.missingInput.input, MISSING_INPUTS.unresolvedSample.input);
  assert.match(result.missingInput.text, /grouped by project/);
  assert.equal(result.eligibility.showGrade, false);
  assert.equal(result.eligibility.tier, "insufficient");

  // Nothing a reader cannot act on: no internal identifier, no rubric id, no
  // sample key, and no prompt text reaches the sentence.
  assert.doesNotMatch(result.missingInput.text, /psn_|unresolvedSample|openai-usage-export|_id\b/);
  for (const excerpt of [...HIGH_VALUE, "some-other-project"]) {
    assert.doesNotMatch(result.missingInput.text, new RegExp(excerpt.slice(0, 24)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("no sample at all: the same shape, naming the sample itself as the missing input", () => {
  const result = analyzeQueryLiteracy({
    providerRecords: PROVIDER_RECORDS, departments: DEPARTMENTS, grouping: GROUPING,
  });
  assert.equal(result.available, false);
  assert.equal(result.missingInput.kind, "noSample");
  assert.equal(result.missingInput.input, MISSING_INPUTS.noSample.input);
  assert.match(result.missingInput.action, /Import a query sample/);
  assert.equal(result.eligibility.showGrade, false);
  assert.deepEqual(result.departments.map((entry) => entry.score), [null, null, null]);
});

// --- 4. the equivalence pair -----------------------------------------------

test("the same sample grades identically keyed by provider unit or by org pseudonym", async () => {
  const CATEGORIES = [
    ["atlas-prod", "psn_unit_a", "gpt-4o", HIGH_VALUE],
    ["borealis-api", "psn_unit_b", "claude-sonnet-4", HIGH_VALUE],
    ["cadmus-batch", "psn_unit_c", "gpt-4o-mini", OUT_OF_SCOPE],
  ];

  // Arm one: keyed by the provider's project, resolved through Anya's detection.
  const byUnit = analyzeQueryLiteracy({
    sample: await ingest(CATEGORIES.flatMap(([unit, , model, excerpts]) =>
      rowsFor(unit, model, excerpts))),
    providerRecords: PROVIDER_RECORDS,
    departments: DEPARTMENTS,
    grouping: GROUPING,
  });

  // Arm two: the same queries keyed by the org pseudonym, no detection at all —
  // the pre-existing path, unchanged.
  const byPseudonym = analyzeQueryLiteracy({
    sample: await ingest(CATEGORIES.flatMap(([, pseudonym, model, excerpts]) =>
      rowsFor(pseudonym, model, excerpts))),
    providerRecords: PROVIDER_RECORDS,
    departments: DEPARTMENTS,
  });

  assert.equal(byUnit.joinKey.space, JOIN_KEY_SPACES.providerUnit);
  assert.equal(byPseudonym.joinKey.space, JOIN_KEY_SPACES.orgPseudonym);

  // Identical grade, identical sub-scores, identical everything the rubric
  // produced — including the category rows a director recomputes the composite
  // from, and the coverage figures printed beside it.
  assert.deepEqual(byUnit.departments, byPseudonym.departments);
  // Identical explanation strings: the eligibility rule and label a reader is
  // shown, and the benchmark sentence beside the letter.
  assert.equal(byUnit.eligibility.rule, byPseudonym.eligibility.rule);
  assert.equal(byUnit.eligibility.label, byPseudonym.eligibility.label);
  assert.equal(byUnit.benchmark.message, byPseudonym.benchmark.message);
  assert.deepEqual(byUnit.benchmark, byPseudonym.benchmark);
  assert.equal(byUnit.missingInput, byPseudonym.missingInput);

  // The one documented difference is the join key itself, which is a statement
  // about how the sample arrived and not a component of any score.
  assert.notDeepEqual(byUnit.joinKey, byPseudonym.joinKey);
});

test("a sample keyed to units grades identically with or without an HRIS file", async () => {
  // The enrichment upgrade this guards against: the same export, the same
  // sample, once with departments that are bare projects and once with
  // pseudonymous departments that declare those projects.
  const rows = [
    ...rowsFor("atlas-prod", "gpt-4o", HIGH_VALUE),
    ...rowsFor("borealis-api", "claude-sonnet-4", HIGH_VALUE),
    ...rowsFor("cadmus-batch", "gpt-4o-mini", OUT_OF_SCOPE),
  ];
  const enriched = analyzeQueryLiteracy({
    sample: await ingest(rows),
    providerRecords: PROVIDER_RECORDS,
    departments: DEPARTMENTS,
    grouping: GROUPING,
  });
  const bare = analyzeQueryLiteracy({
    sample: await ingest(rows),
    providerRecords: PROVIDER_RECORDS.map((record, position) => ({
      ...record, org_unit_id: UNIT_ONLY_DEPARTMENTS[position].id,
    })),
    departments: UNIT_ONLY_DEPARTMENTS,
    grouping: GROUPING,
  });

  const strip = (result) => result.departments.map((entry) => ({
    score: entry.score, grade: entry.grade, subscores: entry.subscores,
    categories: entry.categories, coverage: entry.coverage,
  }));
  assert.deepEqual(strip(bare), strip(enriched));
  assert.equal(bare.eligibility.label, enriched.eligibility.label);
  assert.equal(bare.benchmark.message, enriched.benchmark.message);
});

// --- the resolution rule itself --------------------------------------------

test("the key space is decided by detection, never by the shape of a sample key", async () => {
  // A project literally named like a pseudonym must not flip the key space, and
  // must not be mistaken for the department whose id it resembles.
  const departments = [
    { id: "psn_unit_a", name: "Department a", spendUsd: 30, unitKeys: ["psn_unit_b"] },
    { id: "psn_unit_b", name: "Department b", spendUsd: 30, unitKeys: ["borealis-api"] },
  ];
  const resolved = resolveJoinKeySpace({ grouping: GROUPING, departments });
  // `psn_unit_b` is claimed by department b as its id and by department a as a
  // unit key. It resolves to neither, and the collision is reported.
  assert.equal(resolved.keys.get("psn_unit_b"), null);
  assert.deepEqual(resolved.collisions, ["psn_unit_b"]);
  assert.equal(resolved.keys.get("psn_unit_a"), "psn_unit_a");
  assert.equal(resolved.keys.get("borealis-api"), "psn_unit_b");

  const result = analyzeQueryLiteracy({
    sample: await ingest(rowsFor("psn_unit_b", "claude-sonnet-4", HIGH_VALUE)),
    providerRecords: PROVIDER_RECORDS, departments, grouping: GROUPING,
  });
  assert.equal(result.joinKey.ambiguousKeys, 1);
  assert.equal(result.join.sampleRowsInUnknownDepartment, 6);
  assert.deepEqual(result.departments.map((entry) => entry.score), [null, null]);
});

test("a detected unit with no declared keys is not a key space", () => {
  const resolved = resolveJoinKeySpace({
    grouping: GROUPING,
    departments: [{ id: "psn_unit_a" }, { id: "psn_unit_b" }],
  });
  assert.equal(resolved.space, JOIN_KEY_SPACES.orgPseudonym);
  assert.equal(resolved.unit, null);
  // The unit is still reported, so a surface can say what the export is grouped
  // by even when nothing declares a key in that space.
  assert.equal(resolved.detectedUnit, "project");
});

test("declared unit keys are ignored when no export was detected", () => {
  const resolved = resolveJoinKeySpace({ grouping: null, departments: DEPARTMENTS });
  assert.equal(resolved.space, JOIN_KEY_SPACES.orgPseudonym);
  assert.equal(resolved.declaredUnitKeys, 0);
  assert.equal(resolved.keys.has("atlas-prod"), false);
  assert.equal(resolved.keys.get("psn_unit_a"), "psn_unit_a");
});

// --- 5. the regression pin --------------------------------------------------

/**
 * Every grade the shipped query-sample fixtures published before provider-native
 * join keys existed, captured from the pre-change build. These are not
 * re-derivable from the rubric by hand — they are what the product printed —
 * and that is exactly why they are pinned verbatim. A diff here is a defect.
 */
const PUBLISHED_GRADES = Object.freeze({
  "full-coverage": Object.freeze({
    departments: [
      ["psn_unit_a", 93, "A", null, { intent: 96.7, efficiency: 91.7, modelFit: 83.3 }, 1],
      ["psn_unit_b", 46, "F", null, { intent: 58.3, efficiency: 16.7, modelFit: 58.3 }, 1],
      ["psn_unit_c", 17, "F", null, { intent: 16.7, efficiency: 16.7, modelFit: 16.7 }, 1],
      ["psn_unit_d", null, null, "no_sampled_queries", null, 0],
    ],
    tier: "high", showGrade: true, benchmark: "intra_tenant_cohort",
    join: { billingPairs: 4, sampleRowsWithoutBillingMatch: 0, sampleRowsInUnknownDepartment: 0, billingRowsWithoutSample: 1 },
  }),
  "partial-coverage": Object.freeze({
    departments: [
      ["psn_unit_a", 100, "A", null, { intent: 100, efficiency: 100, modelFit: 100 }, 0.7143],
      ["psn_unit_b", null, null, "insufficient_joined_sample", null, 0.3333],
      ["psn_unit_c", null, null, "no_sampled_queries", null, 0],
      ["psn_unit_d", null, null, "no_sampled_queries", null, 0],
    ],
    tier: "provisional", showGrade: true, benchmark: "insufficient_gradeable_departments",
    join: { billingPairs: 4, sampleRowsWithoutBillingMatch: 2, sampleRowsInUnknownDepartment: 1, billingRowsWithoutSample: 2 },
  }),
  "no-usable-sample": Object.freeze({
    departments: [
      ["psn_unit_a", null, null, "no_classified_queries", null, 0],
      ["psn_unit_b", null, null, "no_classified_queries", null, 0],
      ["psn_unit_c", null, null, "no_sampled_queries", null, 0],
      ["psn_unit_d", null, null, "no_sampled_queries", null, 0],
    ],
    tier: "insufficient", showGrade: false, benchmark: "insufficient_gradeable_departments",
    join: { billingPairs: 4, sampleRowsWithoutBillingMatch: 0, sampleRowsInUnknownDepartment: 0, billingRowsWithoutSample: 2 },
  }),
});

/** The department list and billing rows those grades were published against. */
const BASELINE_RECORDS = [
  billed("psn_unit_a", "gpt-4o", 3000, 300_000, 30_000),
  billed("psn_unit_a", "gpt-4o", 2000, 200_000, 20_000),
  billed("psn_unit_b", "claude-sonnet-4", 3000, 90_000, 9_000),
  billed("psn_unit_c", "gpt-4o-mini", 1000, 40_000, 4_000),
  billed("psn_unit_d", "gpt-4o", 700, 10_000, 1_000),
  { org_unit_id: "psn_unit_a", cost: { amount_minor: 100, currency: "USD", status: "final" } },
];
const BASELINE_DEPARTMENTS = [
  { id: "psn_unit_a", name: "Department a", spendUsd: 50 },
  { id: "psn_unit_b", name: "Department b", spendUsd: 60 },
  { id: "psn_unit_c", name: "Department c", spendUsd: 40 },
  { id: "psn_unit_d", name: "Department d", spendUsd: 7 },
];

for (const [name, expected] of Object.entries(PUBLISHED_GRADES)) {
  test(`regression: ${name} publishes the grades it published before`, async () => {
    const { rows } = JSON.parse(await readFile(
      new URL(`./fixtures/query-sample/${name}.json`, import.meta.url), "utf8"));
    const result = analyzeQueryLiteracy({
      sample: await ingest(rows),
      providerRecords: BASELINE_RECORDS,
      departments: BASELINE_DEPARTMENTS,
    });
    assert.deepEqual(result.departments.map((entry) => [
      entry.departmentId, entry.score, entry.grade, entry.reason,
      entry.subscores, entry.coverage.ratio,
    ]), expected.departments);
    assert.equal(result.eligibility.tier, expected.tier);
    assert.equal(result.eligibility.showGrade, expected.showGrade);
    assert.equal(result.benchmark.reasonCode, expected.benchmark);
    assert.deepEqual({ ...result.join }, expected.join);
  });

  test(`regression: ${name} is unmoved by a detected grouping unit`, async () => {
    // Detection alone must not change a grade. Only a department that declares a
    // unit key opens the provider-native space, and these do not.
    const { rows } = JSON.parse(await readFile(
      new URL(`./fixtures/query-sample/${name}.json`, import.meta.url), "utf8"));
    const result = analyzeQueryLiteracy({
      sample: await ingest(rows),
      providerRecords: BASELINE_RECORDS,
      departments: BASELINE_DEPARTMENTS,
      grouping: GROUPING,
    });
    assert.equal(result.joinKey.space, JOIN_KEY_SPACES.orgPseudonym);
    assert.deepEqual(result.departments.map((entry) => [entry.score, entry.grade]),
      expected.departments.map(([, score, grade]) => [score, grade]));
  });
}
