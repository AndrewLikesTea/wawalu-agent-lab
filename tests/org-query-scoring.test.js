// Executable rubric for organizational query scoring.
//
// Three properties, asserted rather than described:
//
//   1. REPRODUCIBLE. Every fixture in `ORG_QUERY_SCORING_FIXTURES` is validated
//      through the registry and scored, and the result is compared against the
//      expectation written beside the fixture. Scoring the same bytes twice is
//      byte-identical, and the digest is the handle for saying so.
//   2. EXPLAINABLE. Every weight is exported with the assumption behind it and
//      the module that owns it, and no weight this module does not own is
//      re-declared here.
//   3. REDACTED. A sentinel prompt body is pushed through every accepted shape
//      and must appear in no scored, decision-surface, or serialized object.
//
// Nothing here transcribes a grade. Where a number is asserted it is derived in
// the test from the module under test or from the rubric, so a weight change
// moves the expectation and the assertion together.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ORG_QUERY_SCORING_CODES,
  ORG_QUERY_SCORING_VERSION,
  ORG_QUERY_SCORING_WEIGHTS,
  ORG_QUERY_REDACTION_STATEMENT,
  classifyRecords,
  mixCounts,
  orgQueryDecisionData,
  orgQueryDecisionDepartments,
  orgQueryDepartmentLiteracy,
  orgQueryDigest,
} from "../src/org-query-scoring.js";
import {
  FIXTURE_EXCERPTS, FIXTURE_UNITS, ORG_QUERY_SCORING_FIXTURES, fixtureRecords, jsonEnvelope,
} from "../src/org-query-scoring-fixtures.js";
import { orgQuerySampleResult, validateOrgQuerySource } from "../src/org-query-source.js";
import { UNATTRIBUTED_DEPARTMENT } from "../src/conversation-literacy.js";
import { conversationExampleText } from "../src/conversation-export-example.js";
import { PROMPT_LITERACY_RUBRIC, RUBRIC_VERSION_ID } from "../src/prompt-literacy-scoring.js";
import { parseQuerySample } from "../src/query-sample-contract.js";

const REPO = new URL("../", import.meta.url);

/** Validate one fixture through the registry, exactly as the panel would. */
async function validated(fixture) {
  const text = fixture.bundled
    ? await readFile(new URL(fixture.bundled, REPO), "utf8")
    : fixture.build();
  const result = validateOrgQuerySource(text, {
    sourceId: fixture.sourceId,
    fileName: fixture.fileName ?? "organizational-sample.json",
  });
  assert.equal(result.ok, true, `${fixture.id} did not validate: ${result.message ?? ""}`);
  return result;
}

const scored = (result) => orgQueryDepartmentLiteracy({ results: [result] });

// --- the fixture table ------------------------------------------------------

test("every fixture states an expectation and the scorer meets it", async () => {
  assert.ok(ORG_QUERY_SCORING_FIXTURES.length >= 6);
  for (const fixture of ORG_QUERY_SCORING_FIXTURES) {
    assert.ok(fixture.note, `${fixture.id} says nothing about why it exists`);
    const literacy = scored(await validated(fixture));
    const where = `${fixture.id}: ${fixture.label}`;
    const graded = literacy.departments.filter((row) => row.gradeable);

    assert.equal(literacy.gradeable, fixture.expect.gradeable, `${where} — gradeable`);
    assert.equal(literacy.departments.length, fixture.expect.units, `${where} — units`);
    assert.equal(graded.length, fixture.expect.gradedUnits, `${where} — graded units`);
    assert.equal(literacy.prompts.classified, fixture.expect.classified, `${where} — classified`);
    assert.equal(literacy.prompts.unclassified, fixture.expect.unclassified,
      `${where} — unclassified`);
    assert.equal(literacy.prompts.declared, fixture.expect.declared, `${where} — declared`);
    assert.equal(literacy.confidence.level, fixture.expect.confidence, `${where} — confidence`);
    assert.equal(literacy.reasonCode, fixture.expect.reasonCode ?? null, `${where} — reason`);

    // Whatever the outcome, the sample's own denominator is the whole file.
    const counted = literacy.departments.reduce((sum, row) => sum + row.prompts.total, 0);
    assert.equal(counted, fixture.expect.classified + fixture.expect.unclassified,
      `${where} — an unclassified record left somebody's denominator`);
    // Every graded row publishes a letter the rubric recognizes, and every
    // ungraded row publishes a named reason instead of a dash.
    for (const row of literacy.departments) {
      if (row.gradeable) {
        assert.ok(PROMPT_LITERACY_RUBRIC.grades.some((entry) => entry.letter === row.grade),
          `${where} — ${row.department} published grade ${row.grade}`);
        assert.equal(row.rubricVersion, RUBRIC_VERSION_ID);
      } else {
        assert.equal(row.grade, null, `${where} — ${row.department} published an ungraded letter`);
        assert.ok(row.reasonCode && row.reasonText, `${where} — ${row.department} gave no reason`);
      }
    }
  }
});

test("the delimited and JSON shapes of one sample grade identically", async () => {
  const [log, batch] = ["gateway-log-declared-categories", "prompt-batch-declared-categories"]
    .map((id) => ORG_QUERY_SCORING_FIXTURES.find((fixture) => fixture.id === id));
  const fromLog = scored(await validated(log));
  const fromBatch = scored(await validated(batch));
  // The two shapes carry the same records, so the digest — the handle two
  // disputing readers compare — has to be the same eight hex digits.
  assert.equal(fromLog.provenance.inputDigest, fromBatch.provenance.inputDigest);
  assert.deepEqual(fromLog.departments.map((row) => [row.department, row.grade, row.score]),
    fromBatch.departments.map((row) => [row.department, row.grade, row.score]));
  assert.deepEqual(fromLog.mix, fromBatch.mix);
});

// --- reproducibility and provenance -----------------------------------------

test("scoring the same bytes twice is identical, and says which versions did it", async () => {
  const fixture = ORG_QUERY_SCORING_FIXTURES.find((entry) => entry.id === "bundled-prompt-batch");
  const first = scored(await validated(fixture));
  const second = scored(await validated(fixture));
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.equal(first.provenance.inputDigest, second.provenance.inputDigest);
  assert.equal(first.provenance.scorerVersion, ORG_QUERY_SCORING_VERSION);
  assert.equal(first.provenance.rubricVersion, RUBRIC_VERSION_ID);
  assert.match(first.provenance.registryContract, /^wawalu\.integration\.org-query-source\/1\.0$/);
  // Row order must not move the answer: the same records reversed are the same
  // sample, and a digest that disagreed would be a digest nobody could use.
  const records = [...first.departments];
  assert.deepEqual(records.map((row) => row.department), [...records]
    .map((row) => row.department).sort((left, right) => left.localeCompare(right)));
});

test("the digest separates two samples and joins one sample seen twice", () => {
  const base = fixtureRecords({ count: 12 }).map(intoValidatedShape);
  assert.equal(orgQueryDigest(classifyRecords(base).records),
    orgQueryDigest(classifyRecords([...base].reverse()).records),
    "row order changed the digest");
  const changed = classifyRecords([...base.slice(1),
    { ...base[0], category: base[0].category === "highValue" ? "outOfScope" : "highValue" }]);
  assert.notEqual(orgQueryDigest(classifyRecords(base).records), orgQueryDigest(changed.records),
    "a changed category left the digest alone");
});

test("every weight is exported with its assumption and the module that owns it", () => {
  assert.ok(ORG_QUERY_SCORING_WEIGHTS.length >= 8);
  for (const weight of ORG_QUERY_SCORING_WEIGHTS) {
    assert.ok(weight.id && weight.owner, `${weight.id} names no owner`);
    assert.match(weight.assumption, /[\s\S]{40}/, `${weight.id} states no assumption`);
  }
  const ids = ORG_QUERY_SCORING_WEIGHTS.map((weight) => weight.id);
  assert.equal(new Set(ids).size, ids.length, "weight ids are not unique");
  // Only one weight is this module's own; the rest are borrowed and say so.
  const owned = ORG_QUERY_SCORING_WEIGHTS.filter((w) => w.owner === "org-query-scoring.js");
  assert.deepEqual(owned.map((weight) => weight.id), ["declared_category_confidence"]);
});

test("confidence is the weakest factor and names the one that capped it", async () => {
  const thin = ORG_QUERY_SCORING_FIXTURES.find((f) => f.id === "prompt-batch-below-letter-floor");
  const literacy = scored(await validated(thin));
  assert.equal(literacy.confidence.level, "low");
  const levels = literacy.confidence.factors.map((factor) => factor.level);
  assert.ok(levels.includes("high"), "no factor was high, so weakest-wins proves nothing here");
  assert.equal(literacy.confidence.rule, "the weakest of the three factors, never their average");
  for (const factor of literacy.confidence.factors) {
    assert.ok(Number.isFinite(factor.observed) && Number.isFinite(factor.target));
    assert.match(factor.detail, /\d/, `${factor.key} states no number`);
  }
});

// --- attribution ------------------------------------------------------------

test("a record that cannot be placed in a unit is counted apart, never folded in", () => {
  const records = [
    ...fixtureRecords({ count: 20 }).map(intoValidatedShape),
    ...Array.from({ length: 7 }, (unused, index) => ({
      row: 100 + index, orgUnitId: index % 2 ? "" : "(ungrouped)", queryDate: "2026-06-02",
      model: "acme-sonnet-1", inputTokens: 1, outputTokens: 1, category: "highValue",
      promptExcerpt: null,
    })),
  ];
  const literacy = orgQueryDepartmentLiteracy({
    results: [{ ok: true, grades: "prompt_literacy", records, sourceId: "x", sourceLabel: "X" }],
  });
  const unattributed = literacy.departments.find((row) => row.department === UNATTRIBUTED_DEPARTMENT);
  assert.ok(unattributed, "the unplaceable records vanished");
  assert.equal(unattributed.prompts.total, 7);
  assert.equal(unattributed.gradeable, false, "an unattributed bucket was graded");
  for (const unit of FIXTURE_UNITS) {
    assert.equal(literacy.departments.find((row) => row.department === unit).prompts.total, 10,
      "an unattributed record was folded into a named unit's total");
  }
  // And it is not offered as a department a reader can drill into.
  assert.equal(orgQueryDecisionDepartments(literacy)
    .some((entry) => entry.id === UNATTRIBUTED_DEPARTMENT), false);
});

test("a conversation archive places and counts queries but never grades them", async () => {
  const text = conversationExampleText("chatgpt-enterprise-conversation-export");
  const result = validateOrgQuerySource(text, {
    sourceId: "local-conversation-archive", fileName: "archive.csv",
  });
  assert.equal(result.ok, true, result.message ?? "");
  const literacy = orgQueryDepartmentLiteracy({ results: [result] });
  assert.equal(literacy.gradeable, false);
  assert.equal(literacy.reasonCode, ORG_QUERY_SCORING_CODES.SOURCE_DOES_NOT_GRADE);
  assert.ok(literacy.departments.length > 0, "the archive placed no query at all");
  assert.equal(literacy.departments.every((row) => row.gradeable === false), true);
});

// --- redaction --------------------------------------------------------------

const SENTINEL = "SENTINEL-PROMPT-BODY-9f2c";

test("prompt text reaches the classifier and nothing else", () => {
  const records = fixtureRecords({ count: 30, excerptKey: "inefficient" })
    .map(intoValidatedShape)
    .map((record) => ({ ...record, promptExcerpt: `${FIXTURE_EXCERPTS.inefficient} ${SENTINEL}` }));
  const classification = classifyRecords(records);
  assert.equal(classification.records.length, 30, "the excerpts stopped classifying");
  assert.equal(JSON.stringify(classification).includes(SENTINEL), false,
    "an excerpt survived the classification boundary");
  // Every classified record carries exactly the declared keys and no others.
  for (const record of classification.records) {
    assert.deepEqual(Object.keys(record).sort(), ["category", "classifiedBy", "confidence",
      "inputTokens", "model", "orgUnitId", "outputTokens", "queryDate"]);
  }
  const literacy = orgQueryDepartmentLiteracy({
    results: [{ ok: true, grades: "prompt_literacy", records, sourceId: "x", sourceLabel: "X" }],
  });
  // The three objects that get persisted, exported, or rendered.
  for (const [name, value] of [["literacy", literacy],
    ["decision departments", orgQueryDecisionDepartments(literacy)],
    ["decision data", orgQueryDecisionData(literacy)]]) {
    assert.equal(JSON.stringify(value).includes(SENTINEL), false, `${name} carried prompt text`);
  }
  assert.ok(literacy.redaction.statement === ORG_QUERY_REDACTION_STATEMENT);
});

test("an excerpt smuggled through the real parser cannot reach a scored object", () => {
  const records = fixtureRecords({ count: 30, excerptKey: "highValue" })
    .map((record) => ({ ...record, prompt_excerpt: `${record.prompt_excerpt} ${SENTINEL}` }));
  const parsed = parseQuerySample(jsonEnvelope(records));
  assert.equal(parsed.ok, true, "the fixture stopped parsing");
  assert.equal(JSON.stringify(parsed.records).includes(SENTINEL), true,
    "the parser dropped the excerpt already, so this test would prove nothing");
  const literacy = orgQueryDepartmentLiteracy({ results: [orgQuerySampleResult(parsed)] });
  assert.equal(literacy.gradeable, true);
  assert.equal(JSON.stringify(literacy).includes(SENTINEL), false);
});

// --- the decision surface's input -------------------------------------------

test("the decision records carry a mix and a sample and invent no money", async () => {
  const fixture = ORG_QUERY_SCORING_FIXTURES.find((entry) => entry.id === "bundled-prompt-batch");
  const literacy = scored(await validated(fixture));
  const departments = orgQueryDecisionDepartments(literacy);
  assert.equal(departments.length, 2);
  for (const entry of departments) {
    assert.equal(entry.spendUsd, null, "a dollar figure was invented from a query sample");
    assert.equal(entry.previousPeriod, null);
    assert.equal(entry.actionPlan, undefined, "a reviewed intervention was invented");
    assert.equal(entry.sampling.status, "available");
    assert.equal(entry.sampling.sampledQueries, 30);
    assert.ok(entry.sampling.sampledThrough, "no day bucket was reported");
    // The mix is counts of the reader's own classified prompts, and it sums to
    // the sample this unit actually contributed.
    const total = Object.values(entry.mix).reduce((sum, count) => sum + count, 0);
    assert.equal(total, 30);
  }
  assert.deepEqual(Object.keys(mixCounts(literacy.mix)).sort(),
    PROMPT_LITERACY_RUBRIC.categories.map((category) => category.key).sort());
  const data = orgQueryDecisionData(literacy);
  assert.match(data.provenance.label, /^Your imported query sample/);
  assert.match(data.provenance.billingSource, /no provider export/);
  assert.ok(data.provenance.orgSource.includes(literacy.provenance.inputDigest));
  assert.deepEqual(data.evidence, []);
});

test("the coaching gap names one unit, one signal, and the arithmetic behind it", async () => {
  const fixture = ORG_QUERY_SCORING_FIXTURES
    .find((entry) => entry.id === "prompt-batch-excerpts-classified");
  const literacy = scored(await validated(fixture));
  const gap = literacy.coachingGap;
  assert.ok(gap.department, "no coaching gap was named for a graded sample");
  const row = literacy.departments.find((entry) => entry.department === gap.department);
  // Derived from the row, not transcribed: the gap must be that row's own driver.
  assert.equal(gap.signal, row.driver.key);
  assert.equal(gap.numerator, row.driver.numerator);
  assert.equal(gap.impact, row.impact);
  assert.match(gap.text, new RegExp(`${gap.numerator} of ${gap.denominator}`));
  // Every graded unit is at least as weak as the one named, by impact.
  for (const graded of literacy.departments.filter((entry) => entry.gradeable)) {
    assert.ok(graded.impact <= row.impact, "a weaker unit was passed over");
  }
});

test("no gradeable unit means no coaching gap and no letter", async () => {
  const fixture = ORG_QUERY_SCORING_FIXTURES
    .find((entry) => entry.id === "prompt-batch-excerpts-ambiguous");
  const literacy = scored(await validated(fixture));
  assert.equal(literacy.coachingGap.department, null);
  assert.match(literacy.coachingGap.text, /until at least one unit is graded/);
  assert.equal(orgQueryDecisionDepartments(literacy)
    .every((entry) => entry.sampling.status === "unavailable"), true);
});

/** A fixture row in the shape `validateOrgQuerySource` hands records over in. */
function intoValidatedShape(record, index) {
  return {
    row: index + 1,
    orgUnitId: record.org_unit_id,
    queryDate: record.query_date,
    model: record.model_raw,
    inputTokens: record.input_tokens,
    outputTokens: record.output_tokens,
    category: record.category ?? null,
    promptExcerpt: record.prompt_excerpt ?? null,
  };
}
