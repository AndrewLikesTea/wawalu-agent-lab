// Executable contract for the sanitized organizational query aggregate.
//
// Four properties, asserted rather than described:
//
//   1. ORDER-INDEPENDENT. `cells`, `unclassifiedCells` and `intakeCells` are
//      canonicalized by their documented cell keys before anything serializes
//      or digests them, so two otherwise-identical aggregates whose arrays
//      arrive in different orders produce the same eight hex digits. This is
//      asserted directly, on hand-built aggregates, rather than inferred from a
//      scoring result that happened to agree.
//   2. REDACTED. Every accepted shape is pushed through carrying a sentinel
//      prompt body, a refused identifier column, or both. Nothing but counts and
//      declared keys may appear in the aggregate, its canonical form, or its
//      JSON.
//   3. REPRODUCIBLE. Every scoring fixture aggregates to the same cells whether
//      it arrived as a gateway log or as a prompt batch, and the bundled
//      synthetic sample aggregates identically twice.
//   4. RECOVERABLE. Malformed, oversized, unsupported and mixed-key-space
//      selections each come back with a stable code and a sentence naming what
//      the reader can do locally — never a throw and never a half-grid.
//
// Nothing here transcribes a digest. Where two digests are compared they are
// both computed in the test from the module under test, so a canonical-form
// change moves both sides together and a canonicalization *regression* still
// fails.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAX_ORG_QUERY_AGGREGATE_CELLS,
  ORG_QUERY_AGGREGATE_CODES,
  ORG_QUERY_AGGREGATE_VERSION,
  ORG_QUERY_CELL_KEYS,
  ORG_QUERY_INTAKE_CELL_KEYS,
  ORG_QUERY_UNCLASSIFIED_CELL_KEYS,
  assertOrgQueryAggregateRedacted,
  orgQueryAggregate,
  orgQueryAggregateCanonicalForm,
  orgQueryAggregateDigest,
} from "../src/org-query-aggregate.js";
import {
  FIXTURE_EXCERPTS, ORG_QUERY_SCORING_FIXTURES, delimitedLog, fixtureRecords, jsonEnvelope,
} from "../src/org-query-scoring-fixtures.js";
import { classifyRecords, orgQueryDepartmentLiteracy } from "../src/org-query-scoring.js";
import {
  readOrgQuerySource, validateOrgQuerySource,
} from "../src/org-query-source.js";
import { conversationExampleText } from "../src/conversation-export-example.js";
import { CONVERSATION_DIALECT_PROFILES } from "../src/dialect-profiles.js";

const REPO = new URL("../", import.meta.url);
const MODULE = new URL("../src/org-query-aggregate.js", import.meta.url);
const BUNDLED = "contracts/integrations/org-query-source/v1/fixtures/organizational-sample.json";

/** One fixture's bytes, read exactly as the panel would hand them over. */
async function fixtureText(fixture) {
  return fixture.bundled
    ? readFile(new URL(fixture.bundled, REPO), "utf8")
    : fixture.build();
}

/** Validate through the registry, then aggregate past the redaction boundary. */
function aggregateOf(results) {
  const list = [].concat(results);
  const records = list.flatMap((entry) => entry.records);
  const built = orgQueryAggregate({ results: list, classification: classifyRecords(records) });
  assert.equal(built.ok, true, `aggregate refused: ${built.code ?? ""} ${built.message ?? ""}`);
  return built.aggregate;
}

const batch = (text, fileName = "batch.json") => validateOrgQuerySource(text,
  { sourceId: "representative-prompt-batch", fileName });
const log = (text, fileName = "gateway.csv") => validateOrgQuerySource(text,
  { sourceId: "gateway-proxy-log", fileName });

// --- 1. the canonical form, asserted directly -------------------------------

/**
 * The same aggregate twice, with every array walked in the opposite direction.
 *
 * Built by hand rather than parsed from a file, because the property under test
 * is about array order alone: nothing else differs between these two, so a
 * digest that disagrees can only be reading the order.
 */
function twinAggregates() {
  const cells = [
    {
      orgUnitId: "psn_unit_b", queryDate: "2026-06-02", model: "acme-haiku-1",
      category: "inefficient", classifiedBy: "browser_local_classifier",
      queries: 4, inputTokens: 400, outputTokens: 90, confidence: 1,
    },
    {
      orgUnitId: "psn_unit_a", queryDate: "2026-06-01", model: "acme-sonnet-1",
      category: "highValue", classifiedBy: "declared_by_source",
      queries: 11, inputTokens: 4100, outputTokens: 1200, confidence: 0.9,
    },
    {
      orgUnitId: "psn_unit_a", queryDate: "2026-06-01", model: "acme-sonnet-1",
      category: "outOfScope", classifiedBy: "declared_by_source",
      queries: 2, inputTokens: 700, outputTokens: 210, confidence: 0.9,
    },
  ];
  const unclassifiedCells = [
    { orgUnitId: "psn_unit_b", queryDate: "2026-06-02", reason: "no_signal", queries: 3 },
    { orgUnitId: "psn_unit_a", queryDate: "2026-06-01", reason: "no_excerpt", queries: 1 },
  ];
  const intakeCells = [
    {
      sourceId: "gateway-proxy-log", dialect: "delimited-gateway-log", keySpace: "org_pseudonym",
      grades: "prompt_literacy", files: 1, records: 12, skippedRowCount: 0, outOfOrderRowCount: 0,
    },
    {
      sourceId: "representative-prompt-batch", dialect: "json-envelope", keySpace: "org_pseudonym",
      grades: "prompt_literacy", files: 2, records: 9, skippedRowCount: 1, outOfOrderRowCount: 0,
    },
  ];
  const shell = {
    version: ORG_QUERY_AGGREGATE_VERSION,
    registryContract: "wawalu.integration.org-query-source/1.0",
    classifierVersion: "query-classification/1.0.0",
    keySpace: "org_pseudonym",
    totals: { classified: 17, unclassified: 4, cellCount: 7 },
  };
  return [
    { ...shell, cells, unclassifiedCells, intakeCells },
    {
      ...shell,
      cells: [...cells].reverse(),
      unclassifiedCells: [...unclassifiedCells].reverse(),
      intakeCells: [...intakeCells].reverse(),
    },
  ];
}

test("otherwise-identical aggregates with reordered arrays produce the same digest", () => {
  const [asBuilt, shuffled] = twinAggregates();
  // The arrays really are in different orders, or the assertion below is empty.
  assert.notDeepEqual(asBuilt.cells, shuffled.cells);
  assert.notDeepEqual(asBuilt.unclassifiedCells, shuffled.unclassifiedCells);
  assert.notDeepEqual(asBuilt.intakeCells, shuffled.intakeCells);

  assert.deepEqual(orgQueryAggregateCanonicalForm(shuffled),
    orgQueryAggregateCanonicalForm(asBuilt));
  assert.equal(orgQueryAggregateDigest(shuffled), orgQueryAggregateDigest(asBuilt));
  assert.match(orgQueryAggregateDigest(asBuilt), /^[0-9a-f]{8}$/);
});

test("the canonical form orders each array by its own documented cell key", () => {
  const [asBuilt] = twinAggregates();
  const canonical = orgQueryAggregateCanonicalForm(asBuilt);
  const sortedBy = (entries, keys) => entries.map((entry) => keys.map((key) => entry[key]).join("|"));
  for (const [entries, keys] of [
    [canonical.cells, ORG_QUERY_CELL_KEYS],
    [canonical.unclassifiedCells, ORG_QUERY_UNCLASSIFIED_CELL_KEYS],
    [canonical.intakeCells, ORG_QUERY_INTAKE_CELL_KEYS],
  ]) {
    const keyed = sortedBy(entries, keys);
    assert.deepEqual(keyed, [...keyed].sort(), `${keys.join("+")} is not in cell-key order`);
    // Key order inside every entry is fixed too, so JSON.stringify cannot vary
    // with the order a producer happened to assign fields in.
    for (const entry of entries) {
      assert.deepEqual(Object.keys(entry).slice(0, keys.length), [...keys]);
    }
  }
});

test("reordering changes no digit, but changing one count changes the digest", () => {
  const [asBuilt, shuffled] = twinAggregates();
  const moved = {
    ...shuffled,
    cells: shuffled.cells.map((cell, index) =>
      (index === 0 ? { ...cell, queries: cell.queries + 1 } : cell)),
  };
  assert.equal(orgQueryAggregateDigest(shuffled), orgQueryAggregateDigest(asBuilt));
  assert.notEqual(orgQueryAggregateDigest(moved), orgQueryAggregateDigest(asBuilt));
});

test("two cells sharing a cell key still order deterministically", () => {
  // Same key tuple, different counts: the value tuple is the tie-break, so the
  // sort is total and the digest cannot depend on the engine's stability.
  const key = {
    orgUnitId: "psn_unit_a", queryDate: "2026-06-01", model: null,
    category: "highValue", classifiedBy: "declared_by_source",
  };
  const shell = { version: ORG_QUERY_AGGREGATE_VERSION, totals: {}, unclassifiedCells: [], intakeCells: [] };
  const one = { ...shell, cells: [{ ...key, queries: 2 }, { ...key, queries: 10 }] };
  const other = { ...shell, cells: [{ ...key, queries: 10 }, { ...key, queries: 2 }] };
  assert.equal(orgQueryAggregateDigest(other), orgQueryAggregateDigest(one));
  // And ordered as numbers, not as text: 2 before 10.
  assert.deepEqual(orgQueryAggregateCanonicalForm(one).cells.map((cell) => cell.queries), [2, 10]);
});

// --- 2. redaction -----------------------------------------------------------

test("an excerpt-bearing sample aggregates to counts and nothing else", () => {
  const excerpt = FIXTURE_EXCERPTS.inefficient;
  const result = batch(jsonEnvelope(fixtureRecords({ count: 60, excerptKey: "inefficient" })));
  assert.equal(result.ok, true);
  // The excerpt really was in the file the reader chose.
  assert.ok(result.records.some((record) => record.promptExcerpt === excerpt));

  const aggregate = aggregateOf(result);
  assert.equal(assertOrgQueryAggregateRedacted(aggregate), true);
  for (const serialized of [
    JSON.stringify(aggregate),
    JSON.stringify(orgQueryAggregateCanonicalForm(aggregate)),
  ]) {
    assert.ok(!serialized.includes(excerpt), "a prompt excerpt reached the aggregate");
    assert.ok(!/promptExcerpt|prompt_excerpt/.test(serialized));
  }
  // The evidence survived as a category count, which is the whole point.
  assert.equal(aggregate.totals.classified, 60);
  assert.ok(aggregate.cells.every((cell) => cell.category === "inefficient"));
});

test("every declared cell key is a key and every declared cell value is a count", () => {
  const aggregate = aggregateOf(batch(jsonEnvelope(fixtureRecords({ count: 12 }))));
  for (const cell of aggregate.cells) {
    for (const key of ORG_QUERY_CELL_KEYS) {
      assert.ok(cell[key] === null || typeof cell[key] === "string", `${key} is not a key`);
    }
    assert.equal(typeof cell.queries, "number");
  }
  // An undeclared key anywhere is a leak, whoever wrote it.
  assert.throws(() => assertOrgQueryAggregateRedacted({
    ...aggregate,
    cells: [{ ...aggregate.cells[0], promptExcerpt: "anything at all" }],
  }), /promptExcerpt is not declared/);
  // As is a string long enough to be a sentence rather than a key.
  assert.throws(() => assertOrgQueryAggregateRedacted({
    ...aggregate,
    cells: [{ ...aggregate.cells[0], category: "x".repeat(400) }],
  }), /longer than a key may be/);
});

test("a file carrying a refused identifier column never reaches an aggregate", () => {
  const withEmail = [
    "org_unit_id,query_date,model_raw,input_tokens,output_tokens,category,user_email",
    "psn_unit_a,2026-06-01,acme-sonnet-1,10,10,highValue,person@example.test",
  ].join("\n");
  const refused = log(withEmail);
  assert.equal(refused.ok, false);
  const built = orgQueryAggregate({ results: [refused], classification: classifyRecords([]) });
  assert.equal(built.ok, false);
  assert.equal(built.code, ORG_QUERY_AGGREGATE_CODES.MALFORMED_SOURCE);
  assert.ok(!JSON.stringify(built).includes("person@example.test"));
});

test("the aggregate module holds no credential, endpoint, or storage call", async () => {
  const source = await readFile(MODULE, "utf8");
  const code = source.split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  for (const forbidden of [
    /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /localStorage/, /sessionStorage/,
    /indexedDB/, /https?:\/\//, /api[_-]?key/i, /authorization/i, /Bearer /,
    /Date\.now/, /Math\.random/,
  ]) {
    assert.ok(!forbidden.test(code), `org-query-aggregate.js contains ${forbidden}`);
  }
  const imports = [...source.matchAll(/from "\.\/([\w.-]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(imports)].sort(), ["org-query-source.js"]);
});

test("reading and aggregating every shape touches no network or storage primitive", async () => {
  const calls = [];
  const trap = (name) => (...args) => {
    calls.push({ name, args: args.length });
    throw new Error(`${name} was called by a local aggregation`);
  };
  const saved = {
    fetch: globalThis.fetch,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    WebSocket: globalThis.WebSocket,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
  };
  const store = { getItem: trap("getItem"), setItem: trap("setItem"), removeItem: trap("removeItem") };
  globalThis.fetch = trap("fetch");
  globalThis.XMLHttpRequest = trap("XMLHttpRequest");
  globalThis.WebSocket = trap("WebSocket");
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: store, configurable: true });
  try {
    const bundled = await readFile(new URL(BUNDLED, REPO), "utf8");
    for (const text of [bundled, jsonEnvelope(fixtureRecords({ count: 20 })),
      delimitedLog(fixtureRecords({ count: 20 })),
      conversationExampleText(CONVERSATION_DIALECT_PROFILES[0].id)]) {
      const read = readOrgQuerySource(text, { fileName: "chosen" });
      assert.equal(read.ok, true, `${read.code ?? ""} ${read.message ?? ""}`);
      assertOrgQueryAggregateRedacted(aggregateOf(read));
    }
    // Refusal paths too: an error must not be the thing that phones home.
    readOrgQuerySource("nonsense that is not any declared shape", { fileName: "x.csv" });
    orgQueryAggregate({ results: [], classification: null });
    assert.deepEqual(calls, []);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (key === "localStorage" || key === "sessionStorage") {
        Object.defineProperty(globalThis, key, { value, configurable: true });
      } else if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

// --- 3. reproducibility -----------------------------------------------------

test("every scoring fixture aggregates reproducibly and stays redacted", async () => {
  for (const fixture of ORG_QUERY_SCORING_FIXTURES) {
    const text = await fixtureText(fixture);
    const read = () => validateOrgQuerySource(text,
      { sourceId: fixture.sourceId, fileName: fixture.fileName ?? "organizational-sample.json" });
    const first = aggregateOf(read());
    const second = aggregateOf(read());
    assert.deepEqual(orgQueryAggregateCanonicalForm(second),
      orgQueryAggregateCanonicalForm(first), `${fixture.id} is not reproducible`);
    assert.equal(orgQueryAggregateDigest(second), orgQueryAggregateDigest(first));
    assert.equal(assertOrgQueryAggregateRedacted(first), true);
    assert.equal(first.totals.classified, fixture.expect.classified);
    assert.equal(first.totals.unclassified, fixture.expect.unclassified);
    // No fixture is anywhere near the ceiling, and one that became so would be
    // a sample this contract no longer describes.
    assert.ok(first.totals.cellCount <= MAX_ORG_QUERY_AGGREGATE_CELLS);
  }
});

test("one sample delivered as a log and as a batch aggregates to identical cells", () => {
  const records = fixtureRecords({ count: 60 });
  const fromLog = aggregateOf(log(delimitedLog(records)));
  const fromBatch = aggregateOf(batch(jsonEnvelope(records)));
  assert.deepEqual(orgQueryAggregateCanonicalForm(fromBatch).cells,
    orgQueryAggregateCanonicalForm(fromLog).cells);
  // The intake provenance is the one thing that differs, and it must: these are
  // the same queries read out of two different files.
  assert.notDeepEqual(fromBatch.intakeCells, fromLog.intakeCells);
  assert.notEqual(orgQueryAggregateDigest(fromBatch), orgQueryAggregateDigest(fromLog));
});

test("the bundled synthetic sample aggregates, stays redacted, and grades", async () => {
  const text = await readFile(new URL(BUNDLED, REPO), "utf8");
  const result = batch(text, "organizational-sample.json");
  assert.equal(result.ok, true);
  const aggregate = aggregateOf(result);
  assert.equal(assertOrgQueryAggregateRedacted(aggregate), true);
  assert.equal(aggregate.keySpace, "org_pseudonym");
  assert.deepEqual(aggregate.intakeCells.map((cell) => cell.sourceId),
    ["representative-prompt-batch"]);

  // And the same bytes through the scoring contract that consumes it.
  const literacy = orgQueryDepartmentLiteracy({ results: [result] });
  assert.equal(literacy.gradeable, true);
  assert.equal(literacy.aggregateProblem, null);
  assert.equal(assertOrgQueryAggregateRedacted(literacy.aggregate), true);
  assert.equal(literacy.provenance.aggregateDigest, orgQueryAggregateDigest(aggregate));
  assert.deepEqual(orgQueryAggregateCanonicalForm(literacy.aggregate),
    orgQueryAggregateCanonicalForm(aggregate));
});

test("a conversation archive aggregates as attribution and volume, not as a grade", () => {
  const result = readOrgQuerySource(
    conversationExampleText(CONVERSATION_DIALECT_PROFILES[0].id), { fileName: "archive.csv" });
  assert.equal(result.ok, true);
  assert.equal(result.sourceId, "local-conversation-archive");
  const aggregate = aggregateOf(result);
  assert.equal(assertOrgQueryAggregateRedacted(aggregate), true);
  assert.equal(aggregate.keySpace, "source_label");
  assert.deepEqual(aggregate.intakeCells.map((cell) => cell.grades), ["attribution_and_volume"]);
  // An archive carries no category and no excerpt, so every record is declined
  // by the classifier and counted rather than guessed at.
  assert.equal(aggregate.totals.classified, 0);
  assert.ok(aggregate.totals.unclassified > 0);
});

// --- 4. recoverable local errors --------------------------------------------

test("an empty selection is refused with a code and a local next step", () => {
  const built = orgQueryAggregate({ results: [], classification: null });
  assert.equal(built.ok, false);
  assert.equal(built.code, ORG_QUERY_AGGREGATE_CODES.NO_SOURCE);
  assert.match(built.recovery, /conversation archive|gateway log|prompt batch/i);
});

test("a selection carrying an unread source is never partly aggregated", () => {
  const good = batch(jsonEnvelope(fixtureRecords({ count: 10 })));
  const bad = batch("{ not json at all", "broken.json");
  assert.equal(bad.ok, false);
  const built = orgQueryAggregate({
    results: [good, bad], classification: classifyRecords(good.records),
  });
  assert.equal(built.ok, false);
  assert.equal(built.code, ORG_QUERY_AGGREGATE_CODES.MALFORMED_SOURCE);
  assert.ok(built.recovery.length > 0);
});

test("a result naming an undeclared source is refused rather than described", () => {
  const good = batch(jsonEnvelope(fixtureRecords({ count: 10 })));
  const forged = { ...good, sourceId: "live-gateway-api" };
  const built = orgQueryAggregate({
    results: [forged], classification: classifyRecords(good.records),
  });
  assert.equal(built.ok, false);
  assert.equal(built.code, ORG_QUERY_AGGREGATE_CODES.UNSUPPORTED_SOURCE);
});

test("a selection mixing organization-unit key spaces is refused, not merged", () => {
  const sample = batch(jsonEnvelope(fixtureRecords({ count: 10 })));
  const archive = validateOrgQuerySource(
    conversationExampleText(CONVERSATION_DIALECT_PROFILES[0].id),
    { sourceId: "local-conversation-archive", fileName: "archive.csv" });
  assert.equal(archive.ok, true);
  assert.notEqual(archive.keySpace, sample.keySpace);
  const built = orgQueryAggregate({
    results: [sample, archive],
    classification: classifyRecords([...sample.records, ...archive.records]),
  });
  assert.equal(built.ok, false);
  assert.equal(built.code, ORG_QUERY_AGGREGATE_CODES.MIXED_KEY_SPACE);
  assert.deepEqual([...built.keySpaces].sort(), ["org_pseudonym", "source_label"]);
  assert.match(built.recovery, /one key space at a time/i);
});

test("a selection read under two registry contracts is refused", () => {
  const good = batch(jsonEnvelope(fixtureRecords({ count: 10 })));
  const older = { ...good, registryContract: "wawalu.integration.org-query-source/0.9" };
  const built = orgQueryAggregate({
    results: [good, older], classification: classifyRecords(good.records),
  });
  assert.equal(built.ok, false);
  assert.equal(built.code, ORG_QUERY_AGGREGATE_CODES.INCOMPATIBLE_CONTRACT);
});

test("a grid over the cell ceiling is refused with the count and the ceiling", () => {
  // Generated here rather than committed: one distinct unit-day pair per record
  // is the shape that makes an aggregate as large as its sample.
  const over = MAX_ORG_QUERY_AGGREGATE_CELLS + 10;
  const good = batch(jsonEnvelope(fixtureRecords({ count: 10 })));
  const records = Array.from({ length: over }, (unused, index) => ({
    orgUnitId: `psn_unit_${index}`,
    queryDate: "2026-06-01",
    model: "acme-sonnet-1",
    category: "highValue",
    confidence: 0.9,
    classifiedBy: "declared_by_source",
    inputTokens: 1,
    outputTokens: 1,
  }));
  const built = orgQueryAggregate({
    results: [good],
    classification: { classifierVersion: "x", records, unclassified: [] },
  });
  assert.equal(built.ok, false);
  assert.equal(built.code, ORG_QUERY_AGGREGATE_CODES.AGGREGATE_TOO_LARGE);
  assert.equal(built.ceiling, MAX_ORG_QUERY_AGGREGATE_CELLS);
  assert.ok(built.cellCount > MAX_ORG_QUERY_AGGREGATE_CELLS);
  assert.match(built.recovery, /narrow the sample/i);
});

test("an oversized or malformed file is refused by the reader before an aggregate exists", () => {
  // Bigger than the delimited reader's byte ceiling, generated in this test.
  const oversized = `org_unit_id,query_date,model_raw,input_tokens,output_tokens,category\n${
    "psn_unit_a,2026-06-01,acme-sonnet-1,10,10,highValue\n".repeat(200_000)}`;
  const big = readOrgQuerySource(oversized, { fileName: "huge.csv" });
  assert.equal(big.ok, false);
  assert.ok(["file_too_large", "too_many_rows"].includes(big.code), big.code);
  assert.ok(big.recovery.length > 0);

  const malformed = readOrgQuerySource(
    "org_unit_id,query_date,model_raw,input_tokens,output_tokens,category\n\"unclosed,2026-06-01",
    { fileName: "broken.csv" });
  assert.equal(malformed.ok, false);
  assert.ok(malformed.recovery.length > 0);
});

test("a file no declared source reads is handed back, not claimed", () => {
  const providerExport = [
    "usage_date,model,cost_usd,project",
    "2026-06-01,acme-sonnet-1,12.50,platform",
  ].join("\n");
  const read = readOrgQuerySource(providerExport, { fileName: "invoice.csv" });
  assert.equal(read.ok, false);
  assert.equal(read.code, "unrecognized_source_shape");
  assert.match(read.recovery, /Representative prompt batch|Gateway or proxy log/);
  // The name of the file the reader chose is echoed; nothing from inside it is.
  assert.ok(!read.message.includes("acme-sonnet-1"));
});

test("readOrgQuerySource recognizes each declared shape from its bytes alone", () => {
  const cases = [
    [jsonEnvelope(fixtureRecords({ count: 10 })), "representative-prompt-batch"],
    [delimitedLog(fixtureRecords({ count: 10 })), "gateway-proxy-log"],
  ];
  for (const [text, sourceId] of cases) {
    // Deliberately the wrong extension: the shape decides, never the name.
    assert.equal(readOrgQuerySource(text, { fileName: "chosen.dat" }).sourceId, sourceId);
  }
  for (const profile of CONVERSATION_DIALECT_PROFILES) {
    assert.equal(readOrgQuerySource(conversationExampleText(profile.id),
      { fileName: "chosen.dat" }).sourceId, "local-conversation-archive");
  }
});

// --- the scoring contract's own use of the aggregate -------------------------

test("the scored model publishes the aggregate and both digests", () => {
  const result = batch(jsonEnvelope(fixtureRecords({ count: 60 })));
  const literacy = orgQueryDepartmentLiteracy({ results: [result] });
  assert.equal(assertOrgQueryAggregateRedacted(literacy.aggregate), true);
  assert.match(literacy.provenance.inputDigest, /^[0-9a-f]{8}$/);
  assert.match(literacy.provenance.aggregateDigest, /^[0-9a-f]{8}$/);
  // The evidence digest ignores which file the sample arrived in; the aggregate
  // digest does not. Both are published so a reader can say which they mean.
  const asLog = orgQueryDepartmentLiteracy({ results: [log(delimitedLog(fixtureRecords({ count: 60 })))] });
  assert.equal(asLog.provenance.inputDigest, literacy.provenance.inputDigest);
  assert.notEqual(asLog.provenance.aggregateDigest, literacy.provenance.aggregateDigest);
});

test("a selection the aggregate refuses still grades, and says why it has no aggregate", () => {
  const sample = batch(jsonEnvelope(fixtureRecords({ count: 60 })));
  const archive = validateOrgQuerySource(
    conversationExampleText(CONVERSATION_DIALECT_PROFILES[0].id),
    { sourceId: "local-conversation-archive", fileName: "archive.csv" });
  const literacy = orgQueryDepartmentLiteracy({ results: [sample, archive] });
  assert.equal(literacy.aggregate, null);
  assert.equal(literacy.aggregateProblem.code, ORG_QUERY_AGGREGATE_CODES.MIXED_KEY_SPACE);
  assert.equal(literacy.provenance.aggregateDigest, null);
  // The rest of the model is untouched: the departments are still there and the
  // evidence digest still identifies the sample.
  assert.ok(literacy.departments.length > 0);
  assert.match(literacy.provenance.inputDigest, /^[0-9a-f]{8}$/);
});
