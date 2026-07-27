// The query-sample import contract, exercised through its own validator.
//
// Every delimited input here is written inline: they are three-line files, and
// a fixture file per failure would be six files nobody can read side by side.
// The JSON-dialect inputs are the shipped contract fixtures, read from
// `contracts/integrations/query-sample/v1/fixtures/`, so the committed fixture
// set and the validator cannot drift apart.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CLASSIFIED_RECORD_KEYS, MAX_PROMPT_EXCERPT_LENGTH, QUERY_SAMPLE_CATEGORIES,
  QUERY_SAMPLE_CODES, QUERY_SAMPLE_CONTRACT_ID, QUERY_SAMPLE_CONTRACT_KIND,
  QUERY_SAMPLE_SCHEMA_VERSION, REFUSED_COLUMNS, REQUIRED_QUERY_SAMPLE_FIELDS,
  classifyQuerySample, detectQuerySampleDialect, parseQuerySample,
} from "../src/query-sample-contract.js";
import {
  EXAMPLE_QUERY_SAMPLE_FILE, exampleDepartmentUnitIds, exampleQuerySampleText,
  loadExampleQuerySample,
} from "../src/query-sample-example.js";
import { PROMPT_LITERACY_RUBRIC, scorePromptLiteracy } from "../src/prompt-literacy-scoring.js";
import { exampleDatasetFiles } from "../src/example-dataset.js";

const FIXTURES = new URL("../contracts/integrations/query-sample/v1/fixtures/", import.meta.url);
const SCHEMA = new URL("../contracts/integrations/query-sample/v1/schema.json", import.meta.url);
const UNIT = "psn_unit_demo_00000002";

async function fixture(name) {
  return readFile(new URL(name, FIXTURES), "utf8");
}

/** A minimal delimited gateway log. `rows` are already-joined field lists. */
function csv(rows, { delimiter = ",", header } = {}) {
  const columns = header ?? [
    "org_unit_id", "query_date", "model", "input_tokens", "output_tokens",
    "prompt_excerpt", "category",
  ];
  return [columns, ...rows].map((row) => row.join(delimiter)).join("\n");
}

const GOOD_ROW = [UNIT, "2026-06-15", "acme-sonnet-1", "1200", "800", "", "highValue"];

// --- dialects --------------------------------------------------------------

test("a comma gateway log and a tab gateway log both parse, delimiter from content", () => {
  for (const [delimiter, name] of [[",", "comma"], ["\t", "tab"]]) {
    const parsed = parseQuerySample(csv([GOOD_ROW], { delimiter }));
    assert.equal(parsed.ok, true, `${name} file should parse`);
    assert.equal(parsed.dialect, "delimited-gateway-log");
    assert.equal(parsed.delimiter, name);
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.records[0].category, "highValue");
    assert.equal(parsed.contract, QUERY_SAMPLE_CONTRACT_ID);
  }
});

test("a shipped JSON envelope fixture parses, and its snapshot is carried", async () => {
  const parsed = parseQuerySample(await fixture("valid.json"));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.dialect, "json-envelope");
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.snapshot.sequence, 7);
  assert.equal(parsed.snapshot.completeness, "complete");
  assert.equal(parsed.records[1].promptExcerpt, "rename this variable for me");
  assert.equal(parsed.records[1].category, null);
});

test("detection reads the bytes, not the extension, and names what it saw", () => {
  const notATable = "this file is a paragraph of prose with no separator at all";
  const missing = detectQuerySampleDialect(csv([[UNIT, "2026-06-15"]], {
    header: ["org_unit_id", "query_date"],
  }));
  assert.equal(missing.ok, false);
  assert.equal(missing.problem.code, QUERY_SAMPLE_CODES.UNRECOGNIZED_DIALECT);
  assert.match(missing.problem.expected, /model_raw/);
  assert.equal(missing.problem.delimiter, "comma");
  assert.deepEqual(missing.problem.missing, ["model_raw", "input_tokens", "output_tokens"]);

  const prose = detectQuerySampleDialect(notATable);
  assert.equal(prose.ok, false);
  assert.equal(prose.problem.code, QUERY_SAMPLE_CODES.UNSUPPORTED_FORMAT);

  const wrongJson = detectQuerySampleDialect('["a", "b"]');
  assert.equal(wrongJson.problem.code, QUERY_SAMPLE_CODES.UNRECOGNIZED_DIALECT);
  assert.equal(wrongJson.problem.topLevel, "array");
  assert.match(wrongJson.problem.observed, /array at the top level/);

  const empty = detectQuerySampleDialect("   \n  ");
  assert.equal(empty.problem.code, QUERY_SAMPLE_CODES.EMPTY_FILE);

  // A JSON envelope of the wrong kind is a wrong envelope, not a stray CSV.
  const wrongKind = parseQuerySample(JSON.stringify({
    schema_version: "1.0", kind: "wawalu.integration.hris-org", export_id: "x",
    snapshot: {}, privacy: {}, records: [],
  }));
  assert.equal(wrongKind.problem.code, QUERY_SAMPLE_CODES.UNSUPPORTED_CONTRACT);
  assert.match(wrongKind.problem.observed, /hris-org/);
});

test("a UTF-8 BOM is stripped before the first character is read, in either dialect", async () => {
  const json = parseQuerySample(`﻿${await fixture("valid.json")}`);
  assert.equal(json.ok, true);
  assert.equal(json.dialect, "json-envelope");
  const delimited = parseQuerySample(`﻿${csv([GOOD_ROW])}`);
  assert.equal(delimited.ok, true);
  assert.equal(delimited.dialect, "delimited-gateway-log");
});

// --- per-field failures ----------------------------------------------------

const ROW_FAILURES = [
  ["missing required field", [UNIT, "", "acme-sonnet-1", "10", "10", "", "highValue"],
    QUERY_SAMPLE_CODES.MISSING_REQUIRED_FIELD],
  ["bad time bucket format", [UNIT, "15/06/2026", "acme-sonnet-1", "10", "10", "", "highValue"],
    QUERY_SAMPLE_CODES.INVALID_TIME_BUCKET],
  ["a day that is not on the calendar", [UNIT, "2026-06-31", "acme-sonnet-1", "10", "10", "", "highValue"],
    QUERY_SAMPLE_CODES.INVALID_TIME_BUCKET],
  ["an hour-precision instant", [UNIT, "2026-06-15T09:00:00Z", "acme-sonnet-1", "10", "10", "", "highValue"],
    QUERY_SAMPLE_CODES.INVALID_TIME_BUCKET],
  ["negative tokens", [UNIT, "2026-06-15", "acme-sonnet-1", "-1", "10", "", "highValue"],
    QUERY_SAMPLE_CODES.INVALID_TOKEN_COUNT],
  ["fractional tokens", [UNIT, "2026-06-15", "acme-sonnet-1", "10", "10.5", "", "highValue"],
    QUERY_SAMPLE_CODES.INVALID_TOKEN_COUNT],
  ["a department key of the wrong shape", ["dept-7", "2026-06-15", "acme-sonnet-1", "10", "10", "", "highValue"],
    QUERY_SAMPLE_CODES.INVALID_DEPARTMENT_KEY],
  ["neither excerpt nor category", [UNIT, "2026-06-15", "acme-sonnet-1", "10", "10", "", ""],
    QUERY_SAMPLE_CODES.MISSING_CLASSIFICATION],
  ["both excerpt and category", [UNIT, "2026-06-15", "acme-sonnet-1", "10", "10", "a request", "highValue"],
    QUERY_SAMPLE_CODES.AMBIGUOUS_CLASSIFICATION],
  ["a category outside the rubric vocabulary", [UNIT, "2026-06-15", "acme-sonnet-1", "10", "10", "", "pretty good"],
    QUERY_SAMPLE_CODES.UNKNOWN_CATEGORY],
];

for (const [label, badRow, code] of ROW_FAILURES) {
  test(`a row with ${label} is skipped with a located ${code} and the rest of the file lands`, () => {
    const parsed = parseQuerySample(csv([GOOD_ROW, badRow]));
    assert.equal(parsed.ok, true, "the file is not rejected for one bad row");
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.skippedRowCount, 1);
    const issue = parsed.issues.find((entry) => entry.code === code);
    assert.ok(issue, `expected a ${code} issue, saw ${parsed.issues.map((i) => i.code)}`);
    assert.equal(issue.row, 3, "the issue carries the spreadsheet row number");
    assert.ok(issue.message.length > 0);
    assert.equal(issue.message.includes("a request"), false, "no message echoes a cell value");
  });
}

test("an over-long excerpt is a prompt body, and is refused as one", () => {
  const parsed = parseQuerySample(csv([GOOD_ROW, [
    UNIT, "2026-06-15", "acme-sonnet-1", "10", "10", "x".repeat(MAX_PROMPT_EXCERPT_LENGTH + 1), "",
  ]]));
  assert.equal(parsed.issues[0].code, QUERY_SAMPLE_CODES.EXCERPT_TOO_LONG);
});

test("a file where no row validates is refused whole, not returned empty", () => {
  const parsed = parseQuerySample(csv([[UNIT, "2026-06-15", "acme-sonnet-1", "10", "10", "", ""]]));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.problem.code, QUERY_SAMPLE_CODES.NO_USABLE_ROWS);
  assert.equal(parsed.problem.issues[0].code, QUERY_SAMPLE_CODES.MISSING_CLASSIFICATION);
});

// --- the refused set -------------------------------------------------------

test("a refused column rejects the whole file, naming the column and the reason", () => {
  for (const column of ["user_email", "prompt", "response_text", "api_key", "Request ID"]) {
    const header = [
      "org_unit_id", "query_date", "model", "input_tokens", "output_tokens", "category", column,
    ];
    const parsed = parseQuerySample(csv([[...GOOD_ROW.slice(0, 5), "highValue", "x"]], { header }));
    assert.equal(parsed.ok, false, `${column} must not be accepted`);
    assert.equal(parsed.problem.code, QUERY_SAMPLE_CODES.REFUSED_COLUMN);
    assert.equal(parsed.problem.column, column.toLowerCase().replace(" ", "_"));
    assert.ok(parsed.problem.reason.length > 0);
    assert.match(parsed.problem.detail, /refused whole/);
  }
});

test("a refused field inside a JSON record rejects the file too", () => {
  const document = {
    schema_version: QUERY_SAMPLE_SCHEMA_VERSION,
    kind: QUERY_SAMPLE_CONTRACT_KIND,
    export_id: "40000000-0000-4000-8000-00000000000a",
    snapshot: {
      source_instance_id: "psn_gateway_demo_000001", sequence: 1,
      generated_at: "2026-07-25T12:00:00Z", bucket_granularity: "day",
      completeness: "complete", omitted_record_count: 0, issues: [],
    },
    privacy: {
      classification_site: "browser-tab", prompt_text_retained: false,
      direct_identifiers_included: false,
    },
    records: [{
      org_unit_id: UNIT, query_date: "2026-06-15", model_raw: "acme-sonnet-1",
      input_tokens: 10, output_tokens: 10, category: "highValue", user_id: "u-1",
    }],
  };
  const parsed = parseQuerySample(JSON.stringify(document));
  assert.equal(parsed.problem.code, QUERY_SAMPLE_CODES.REFUSED_COLUMN);
  assert.equal(parsed.problem.column, "user_id");
});

test("the refused set names identifiers, bodies, response text, and credentials", () => {
  const reasons = new Set(Object.values(REFUSED_COLUMNS));
  assert.ok(Object.keys(REFUSED_COLUMNS).length >= 20);
  assert.ok([...reasons].some((reason) => reason.includes("identifies the person")));
  assert.ok([...reasons].some((reason) => reason.includes("raw prompt body")));
  assert.ok([...reasons].some((reason) => reason.includes("model output text")));
  assert.ok([...reasons].some((reason) => reason.includes("credential")));
});

// --- partial, stale, reordered, unknown ------------------------------------

test("a delimited file's unknown extra column is ignored and reported, not fatal", () => {
  const header = [
    "org_unit_id", "query_date", "model", "input_tokens", "output_tokens", "category", "cost_center",
  ];
  const parsed = parseQuerySample(csv([[...GOOD_ROW.slice(0, 5), "highValue", "CC-12"]], { header }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.records.length, 1);
  const notice = parsed.issues.find((entry) => entry.code === QUERY_SAMPLE_CODES.UNMAPPED_COLUMN);
  assert.equal(notice.field, "cost_center");
  assert.equal(notice.row, null);
});

test("a JSON envelope's undeclared record field rejects the file", async () => {
  const document = JSON.parse(await fixture("valid.json"));
  document.records[0].seat_count = 3;
  const parsed = parseQuerySample(JSON.stringify(document));
  assert.equal(parsed.problem.code, QUERY_SAMPLE_CODES.UNKNOWN_FIELD);
  assert.match(parsed.problem.detail, /seat_count/);
});

test("a partial delivery still lands, carrying its own omission count", async () => {
  const parsed = parseQuerySample(await fixture("partial.json"));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.snapshot.completeness, "partial");
  assert.equal(parsed.snapshot.omittedRecordCount, 4);
});

test("a stale delivery is refused by sequence, not by arrival order", async () => {
  const stale = await fixture("stale.json");
  assert.equal(parseQuerySample(stale).ok, true, "stale only means stale against a known sequence");
  const parsed = parseQuerySample(stale, { lastAcceptedSequence: 7 });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.problem.code, QUERY_SAMPLE_CODES.STALE_DELIVERY);
  assert.match(parsed.problem.observed, /sequence 6/);
});

test("rows out of day order are kept and counted, because order carries no meaning", async () => {
  const [newer] = JSON.parse(await fixture("reordered.json"));
  const parsed = parseQuerySample(JSON.stringify(newer));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.outOfOrderRowCount, 1);
  assert.equal(parsed.issues[0].code, QUERY_SAMPLE_CODES.OUT_OF_ORDER_ROW);
});

test("the malformed fixture fails per row without taking the file with it", async () => {
  const parsed = parseQuerySample(await fixture("malformed.json"));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.problem.code, QUERY_SAMPLE_CODES.NO_USABLE_ROWS);
  const codes = parsed.problem.issues.map((issue) => issue.code);
  assert.ok(codes.includes(QUERY_SAMPLE_CODES.INVALID_TIME_BUCKET));
  assert.ok(codes.includes(QUERY_SAMPLE_CODES.INVALID_TOKEN_COUNT));
  assert.ok(codes.includes(QUERY_SAMPLE_CODES.AMBIGUOUS_CLASSIFICATION));
});

// --- the redaction boundary ------------------------------------------------

test("no classified record can carry prompt text", () => {
  const parsed = parseQuerySample(csv([
    GOOD_ROW,
    [UNIT, "2026-06-15", "acme-opus-1", "90", "40", "rename this variable", ""],
  ]));
  const classified = classifyQuerySample(parsed, () => "overProvisioned");
  assert.equal(classified.records.length, 2);
  for (const record of classified.records) {
    assert.deepEqual(Object.keys(record), CLASSIFIED_RECORD_KEYS);
    assert.equal(Object.hasOwn(record, "promptExcerpt"), false);
  }
  assert.equal(JSON.stringify(classified).includes("rename this variable"), false);
  assert.equal(classified.records[1].category, "overProvisioned");
});

test("a classifier that returns nothing usable leaves the row unclassified, never guessed", () => {
  const parsed = parseQuerySample(csv([
    GOOD_ROW,
    [UNIT, "2026-06-15", "acme-opus-1", "90", "40", "a request", ""],
  ]));
  const classified = classifyQuerySample(parsed, () => "probablyFine");
  assert.equal(classified.records.length, 1);
  assert.equal(classified.unclassified[0].code, QUERY_SAMPLE_CODES.UNKNOWN_CATEGORY);
});

test("classified records are exactly what the rubric consumes", () => {
  const classified = classifyQuerySample(loadExampleQuerySample(), () => "highValue");
  const scored = scorePromptLiteracy(classified.records);
  assert.equal(scored.scored, true);
  assert.equal(scored.records.unclassified, 0, "the rubric recognizes every derived record");
  assert.equal(scored.records.scored, classified.records.length);
  assert.ok(scored.composite >= 0 && scored.composite <= 100);
});

// --- the shipped template --------------------------------------------------

test("the downloadable example validates through the real validator", () => {
  const parsed = loadExampleQuerySample();
  assert.equal(parsed.ok, true);
  assert.equal(parsed.dialect, "delimited-gateway-log");
  assert.equal(parsed.skippedRowCount, 0);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.records.length, 9);
  assert.equal(EXAMPLE_QUERY_SAMPLE_FILE.fileName.endsWith(".csv"), true);
});

test("the example exercises both classification paths, several models and buckets", () => {
  const { records } = loadExampleQuerySample();
  assert.ok(records.some((record) => record.promptExcerpt && record.category === null));
  assert.ok(records.some((record) => record.category && record.promptExcerpt === null));
  assert.ok(new Set(records.map((record) => record.model)).size >= 3);
  assert.ok(new Set(records.map((record) => record.queryDate)).size >= 3);
  assert.ok(new Set(records.map((record) => record.orgUnitId)).size >= 3);
});

test("every example department key resolves against the bundled HRIS export", () => {
  const hris = JSON.parse(exampleDatasetFiles()
    .find((file) => file.fileName === "example-hris-org.json").text);
  const active = new Set(hris.records
    .filter((record) => record.operation === "upsert" && record.active
      && record.unit_type === "department")
    .map((record) => record.unit_id));
  assert.ok(active.size > 0);
  for (const record of loadExampleQuerySample().records) {
    assert.ok(active.has(record.orgUnitId), `${record.orgUnitId} is not an active department`);
  }
  for (const unitId of exampleDepartmentUnitIds()) assert.ok(active.has(unitId));
});

test("the example carries no field the contract refuses", () => {
  const [header] = exampleQuerySampleText().split("\n");
  for (const column of header.split(",")) {
    assert.equal(Object.hasOwn(REFUSED_COLUMNS, column), false, `${column} is a refused column`);
  }
});

// --- the contract and the rubric stay pinned to each other -----------------

test("the schema declares the same version, key shape, and vocabulary as the module", async () => {
  const schema = JSON.parse(await readFile(SCHEMA, "utf8"));
  assert.equal(schema.properties.schema_version.const, QUERY_SAMPLE_SCHEMA_VERSION);
  assert.equal(schema.properties.kind.const, QUERY_SAMPLE_CONTRACT_KIND);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.$defs.sample.required, [...REQUIRED_QUERY_SAMPLE_FIELDS]);
  assert.deepEqual(schema.$defs.sample.properties.category.enum, [...QUERY_SAMPLE_CATEGORIES]);
  assert.equal(schema.$defs.sample.properties.prompt_excerpt.maxLength, MAX_PROMPT_EXCERPT_LENGTH);
  assert.equal(schema.$defs.sample.properties.model_raw.pattern,
    PROMPT_LITERACY_RUBRIC.redaction.modelIdPattern);
  const hris = JSON.parse(await readFile(
    new URL("../contracts/integrations/hris-org/v1/schema.json", import.meta.url), "utf8"));
  assert.equal(schema.$defs.opaqueId.pattern, hris.$defs.opaqueId.pattern,
    "the department key is the HRIS key, not a lookalike");
});

// The sibling contracts' shared delivery-state suite
// (`privacy-integration-contracts.test.js`) asserts a per-record `revision` on
// every reordered fixture, and this contract deliberately has none: a sampled
// query is an event that happened once, not a mutable unit or a restatable
// aggregate, and a revision without a record identity would be a field nobody
// could act on. The delivery-level `snapshot.sequence` carries the reorder rule
// instead. So the same six delivery states are asserted here, minus that one.
test("the six delivery-state fixtures match the sibling contracts' conventions", async () => {
  const [valid, partial, stale, malformed, duplicated, reordered] = await Promise.all(
    ["valid", "partial", "stale", "malformed", "duplicated", "reordered"]
      .map(async (name) => JSON.parse(await fixture(`${name}.json`))));

  assert.equal(valid.schema_version, QUERY_SAMPLE_SCHEMA_VERSION);
  assert.equal(valid.kind, QUERY_SAMPLE_CONTRACT_KIND);
  assert.equal(valid.snapshot.completeness, "complete");
  assert.equal(partial.snapshot.completeness, "partial");
  assert.ok(partial.snapshot.omitted_record_count > 0);
  assert.ok(partial.snapshot.issues.length > 0);
  assert.ok(Date.parse(stale.snapshot.generated_at) < Date.parse(valid.snapshot.generated_at));
  assert.equal(malformed.export_id, "not-a-uuid");
  assert.ok(Array.isArray(duplicated));
  assert.deepEqual(duplicated[0], duplicated[1]);
  assert.deepEqual(duplicated[0].records[0], duplicated[0].records[1]);
  assert.ok(Array.isArray(reordered));
  assert.ok(reordered[0].snapshot.sequence > reordered[1].snapshot.sequence);
});

// --- the key space the department column is stated in -----------------------

// A reader with a provider export and a query sample but no HRIS file has no
// pseudonym to key by. `groupingUnit` is the unit their bill is grouped by, read
// off Anya's detection result and passed in; it is never inferred from a cell.

test("with no grouping unit declared, the department column is a pseudonym and only a pseudonym", () => {
  const parsed = parseQuerySample(csv([
    ["atlas-prod", "2026-06-15", "acme-sonnet-1", "1200", "800", "", "highValue"],
  ]));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.problem.code, QUERY_SAMPLE_CODES.NO_USABLE_ROWS);
  assert.equal(parsed.problem.issues[0].code, QUERY_SAMPLE_CODES.INVALID_DEPARTMENT_KEY);
});

test("with a grouping unit declared, the department column is that unit and only that unit", () => {
  const parsed = parseQuerySample(csv([
    ["atlas-prod", "2026-06-15", "acme-sonnet-1", "1200", "800", "", "highValue"],
  ]), { groupingUnit: "project" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.keySpace, "provider_unit");
  assert.equal(parsed.groupingUnit, "project");
  assert.equal(parsed.records[0].orgUnitId, "atlas-prod");
  // Declared, the pseudonym is not a second accepted shape: the key space is
  // decided once for the file, so a row is never matched against both patterns.
  const both = parseQuerySample(csv([GOOD_ROW]), { groupingUnit: "project" });
  assert.equal(both.ok, true);
  assert.equal(both.keySpace, "provider_unit");
  assert.equal(both.records[0].orgUnitId, UNIT);
});

test("a provider unit key is still a bounded identifier, so prompt text cannot ride in on it", () => {
  const smuggled = "Context: the billing service returns 500s under load, and the retry budget is gone";
  const parsed = parseQuerySample(csv([
    [smuggled, "2026-06-15", "acme-sonnet-1", "1200", "800", "", "highValue"],
  ], { delimiter: "\t" }), { groupingUnit: "project" });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.problem.issues[0].code, QUERY_SAMPLE_CODES.INVALID_DEPARTMENT_KEY);
  // The refusal names the column and the unit, never the cell it refused.
  assert.doesNotMatch(parsed.problem.issues[0].message, /billing service|retry budget/);
  assert.match(parsed.problem.issues[0].message, /project/);
});

test("the key space survives the redaction boundary and the omitted default is the pseudonym", () => {
  const parsed = parseQuerySample(csv([
    ["atlas-prod", "2026-06-15", "acme-sonnet-1", "1200", "800", "", "highValue"],
  ]), { groupingUnit: "workspace" });
  const classified = classifyQuerySample(parsed);
  assert.equal(classified.keySpace, "provider_unit");
  assert.equal(classified.groupingUnit, "workspace");
  assert.deepEqual(Object.keys(classified.records[0]), CLASSIFIED_RECORD_KEYS);

  const pseudonymous = classifyQuerySample(parseQuerySample(csv([GOOD_ROW])));
  assert.equal(pseudonymous.keySpace, "org_pseudonym");
  assert.equal(pseudonymous.groupingUnit, null);
});

test("the same sample scores identically keyed by provider unit or by pseudonym", () => {
  // The equivalence guarantee at the ingest layer: only the join key differs, so
  // the rubric must not be able to tell the two files apart.
  const rows = [
    ["2026-06-15", "acme-sonnet-1", "1200", "800", "", "highValue"],
    ["2026-06-15", "acme-sonnet-1", "900", "400", "", "overProvisioned"],
    ["2026-06-16", "acme-haiku-1", "300", "100", "", "outOfScope"],
  ];
  const byUnit = classifyQuerySample(parseQuerySample(
    csv(rows.map((row) => ["atlas-prod", ...row])), { groupingUnit: "project" },
  ));
  const byPseudonym = classifyQuerySample(parseQuerySample(
    csv(rows.map((row) => [UNIT, ...row])),
  ));
  assert.deepEqual(scorePromptLiteracy(byUnit.records), scorePromptLiteracy(byPseudonym.records));
  assert.equal(scorePromptLiteracy(byUnit.records).grade,
    scorePromptLiteracy(byPseudonym.records).grade);
});

test("the required field list is exactly what a grade needs, and no more", () => {
  assert.deepEqual([...REQUIRED_QUERY_SAMPLE_FIELDS], [
    "org_unit_id", "query_date", "model_raw", "input_tokens", "output_tokens",
  ]);
  assert.deepEqual([...QUERY_SAMPLE_CATEGORIES],
    PROMPT_LITERACY_RUBRIC.categories.map((category) => category.key));
});
