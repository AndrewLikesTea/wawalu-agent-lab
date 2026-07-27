// Contract tests for provider-usage-billing v1.1.
//
// Every case here drives the real import path — the shipped delimited reader
// and the shipped JSON validator — against a checked-in fixture. The subject is
// the contract, so the assertions are about what a downstream consumer is
// guaranteed: which version, which fields, and the difference between a zero
// and an absence.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseDelimitedFinopsFile } from "../src/finops-tabular-import.js";
import { LOCAL_KINDS, parseLocalFinopsFile } from "../src/local-finops.js";
import {
  ABSENT_USAGE_DETAIL, MODEL_TIERS, PREVIOUS_PROVIDER_USAGE_SCHEMA_VERSION,
  PROVIDER_USAGE_SCHEMA_VERSION, USAGE_DETAIL_KEYS, carryableModelString,
  classifyModelTier, countUnrecognizedModels, isAbsent, readUsageDetail,
} from "../src/provider-usage-record.js";

const DELIMITED = new URL("./fixtures/delimited/", import.meta.url);
const CONTRACTS = new URL("../contracts/integrations/provider-usage-billing/", import.meta.url);
const GENERATED_AT = "2026-07-26T09:00:00.000Z";

async function delimited(name) {
  const text = await readFile(new URL(name, DELIMITED), "utf8");
  return parseDelimitedFinopsFile(text, name, { generatedAt: GENERATED_AT });
}

async function contractFixture(path) {
  return readFile(new URL(path, CONTRACTS), "utf8");
}

function records(result) {
  return result.parsed.document.records;
}

/** The record for one model string, by its verbatim value. */
function forModel(result, modelRaw) {
  const found = records(result).find((record) => record.model_raw === modelRaw);
  assert.ok(found, `no record carries model_raw ${modelRaw}`);
  return found;
}

// --- the tier vocabulary ---------------------------------------------------

test("the tier vocabulary is closed and declares unrecognized as a member", () => {
  assert.deepEqual(MODEL_TIERS, ["premium", "standard", "economy", "unrecognized"]);
  const classifications = [
    ["gpt-4o", "premium"], ["claude-opus-4", "premium"], ["o1-pro", "premium"],
    ["claude-sonnet-4", "standard"], ["gemini-1.5-pro", "standard"],
    ["gpt-4o-mini", "economy"], ["claude-haiku-3-5", "economy"], ["gemini-2.0-flash", "economy"],
  ];
  for (const [model, tier] of classifications) {
    assert.equal(classifyModelTier(model), tier, `${model} should be ${tier}`);
  }
});

test("a model string matching no rule is unrecognized, never the nearest tier", () => {
  for (const unknown of ["orion-preview-9", "AmazonBedrock", "dall-e-3", "internal-router-v2"]) {
    assert.equal(classifyModelTier(unknown), "unrecognized");
    // Diagnosable: the raw string survives beside the tier, unchanged.
    assert.equal(carryableModelString(unknown), unknown);
  }
});

test("a model string that is not carryable is unrecognized and is not truncated", () => {
  const overLong = `m${"o".repeat(400)}del`;
  assert.equal(carryableModelString(overLong), null);
  assert.equal(classifyModelTier(overLong), "unrecognized");
  assert.equal(carryableModelString(`gpt-4o${String.fromCharCode(10)}prompt text`), null);
});

test("absent is null and is not zero", () => {
  assert.equal(isAbsent(null), true);
  assert.equal(isAbsent(0), false);
  assert.equal(isAbsent(undefined), false);
  assert.deepEqual(Object.keys(ABSENT_USAGE_DETAIL), [...USAGE_DETAIL_KEYS]);
  assert.ok(Object.values(ABSENT_USAGE_DETAIL).every((value) => value === null));
});

// --- per-dialect mapping ---------------------------------------------------

test("openai: the token split is carried and an absent request column stays absent", async () => {
  const result = await delimited("openai-usage.csv");
  assert.equal(result.ok, true);
  assert.equal(result.shape, "openai_usage");
  assert.equal(result.parsed.document.schema_version, PROVIDER_USAGE_SCHEMA_VERSION);

  const premium = forModel(result, "gpt-4o");
  assert.equal(premium.model_tier, "premium");
  assert.equal(premium.input_tokens, 90000);
  assert.equal(premium.output_tokens, 12000);
  // This dialect's fixture has no request column at all, so every record says
  // "not reported" rather than "zero calls".
  assert.ok(records(result).every((record) => record.request_count === null));
  assert.equal(forModel(result, "gpt-4o-mini").model_tier, "economy");
});

test("openai: a request column carries a genuine zero as zero", async () => {
  const result = await delimited("openai-usage-with-requests.csv");
  assert.equal(result.ok, true);
  assert.equal(forModel(result, "gpt-4o").request_count, 4200);
  // The export reported zero calls for this row. Absent would be a lie.
  assert.equal(forModel(result, "gpt-4o-mini").request_count, 0);
  assert.equal(isAbsent(forModel(result, "gpt-4o-mini").request_count), false);
});

test("anthropic: model, tier, and split map from the real column names", async () => {
  const result = await delimited("anthropic-usage.csv");
  assert.equal(result.ok, true);
  assert.equal(result.shape, "anthropic_usage");
  assert.equal(forModel(result, "claude-opus-4").model_tier, "premium");
  assert.equal(forModel(result, "claude-sonnet-4").model_tier, "standard");
  const economy = forModel(result, "claude-haiku-3-5");
  assert.equal(economy.model_tier, "economy");
  assert.equal(economy.input_tokens, 410000);
  assert.equal(economy.output_tokens, 38000);
  assert.equal(economy.request_count, null);
});

test("bedrock: a combined token total leaves the split absent, never synthesized", async () => {
  const result = await delimited("bedrock-usage.tsv");
  assert.equal(result.ok, true);
  assert.equal(result.shape, "bedrock_usage");
  assert.equal(result.delimiter, "tab");
  for (const record of records(result)) {
    // The combined figure stays where v1.0 already put it...
    assert.equal(record.usage.unit, "provider-units");
    assert.ok(record.usage.quantity > 0);
    // ...and no ratio, default, or heuristic fills in a split.
    assert.equal(record.input_tokens, null);
    assert.equal(record.output_tokens, null);
    assert.equal(record.request_count, null);
    assert.equal(record.model_raw, "AmazonBedrock");
    assert.equal(record.model_tier, "unrecognized");
  }
});

// --- unrecognized rows stay visible ----------------------------------------

test("the count of unrecognized-tier rows is carried out of the import", async () => {
  const withRequests = await delimited("openai-usage-with-requests.csv");
  // gpt-4o and gpt-4o-mini are named; orion-preview-9 is not.
  assert.equal(withRequests.unrecognizedModelRows, 1);
  assert.equal(withRequests.parsed.unrecognizedModelRows, 1);
  assert.equal(forModel(withRequests, "orion-preview-9").model_tier, "unrecognized");

  const named = await delimited("anthropic-usage.csv");
  assert.equal(named.unrecognizedModelRows, 0);

  // The same number is derivable from the records alone, so a screen that has
  // only the document does not need the parse result to report it.
  assert.equal(countUnrecognizedModels(records(withRequests)), 1);
});

test("an aggregate that folds two models carries no model identity", async () => {
  const text = [
    "date,project_name,model,input_tokens,output_tokens,requests,amount,currency",
    "2026-07-24,Atlas Platform,gpt-4o,10,2,7,1.00,USD",
    "2026-07-24,Atlas Platform,claude-sonnet-4,20,4,9,2.00,USD",
  ].join("\n");
  const result = parseDelimitedFinopsFile(text, "mixed.csv", { generatedAt: GENERATED_AT });
  assert.equal(result.ok, true);
  const [record] = records(result);
  assert.equal(records(result).length, 1);
  // Neither model won the row: a picked winner would be a fact no row supports.
  assert.equal(record.model_raw, null);
  assert.equal(record.model_tier, null);
  // The counts still sum, because they are additive across models.
  assert.equal(record.request_count, 16);
  assert.equal(record.input_tokens, 30);
  assert.equal(record.output_tokens, 6);
});

// --- backward compatibility ------------------------------------------------

test("a committed v1.0 export still imports, with every new field absent", async () => {
  const text = await contractFixture("v1/fixtures/valid.json");
  const parsed = parseLocalFinopsFile(text, "valid.json", "application/json");
  assert.equal(parsed.type, "provider");
  assert.equal(parsed.document.schema_version, PREVIOUS_PROVIDER_USAGE_SCHEMA_VERSION);
  for (const record of parsed.document.records) {
    assert.deepEqual(readUsageDetail(record), ABSENT_USAGE_DETAIL);
    // Additive means additive: the stored record is untouched.
    assert.ok(USAGE_DETAIL_KEYS.every((key) => !(key in record)));
  }
});

test("a v1.0 export may not smuggle a v1.1 field in under the old version", async () => {
  const document = JSON.parse(await contractFixture("v1/fixtures/valid.json"));
  document.records[0].model_tier = "premium";
  assert.throws(() => parseLocalFinopsFile(JSON.stringify(document), "v1.json", "application/json"),
    (error) => error.code === "unknown_field");
});

test("the shipped v1.1 fixture imports and reports its unrecognized models", async () => {
  const text = await contractFixture("v1.1/fixtures/valid.json");
  const parsed = parseLocalFinopsFile(text, "valid.json", "application/json");
  assert.equal(parsed.document.kind, LOCAL_KINDS.provider);
  assert.equal(parsed.document.schema_version, PROVIDER_USAGE_SCHEMA_VERSION);
  assert.equal(countUnrecognizedModels(parsed.document.records), 2);

  const [filled, zeroed, combined] = parsed.document.records;
  assert.deepEqual(readUsageDetail(filled), {
    model_raw: "gpt-4o", model_tier: "premium",
    request_count: 8400, input_tokens: 380000, output_tokens: 40000,
  });
  assert.equal(zeroed.request_count, 0);
  assert.equal(combined.request_count, null);
  assert.equal(combined.input_tokens, null);
});

// --- the validator ---------------------------------------------------------

test("a v1.1 record must carry every new field, and may not invent a tier", async () => {
  const original = JSON.parse(await contractFixture("v1.1/fixtures/valid.json"));
  const mutate = (change) => {
    const document = JSON.parse(JSON.stringify(original));
    change(document.records[0]);
    return () => parseLocalFinopsFile(JSON.stringify(document), "v11.json", "application/json");
  };
  assert.throws(mutate((record) => { delete record.request_count; }),
    (error) => error.code === "missing_field");
  assert.throws(mutate((record) => { record.model_tier = "mid"; }),
    (error) => error.code === "invalid_value");
  assert.throws(mutate((record) => { record.model_raw = null; }),
    (error) => error.code === "invalid_value");
  assert.throws(mutate((record) => { record.request_count = -1; }),
    (error) => error.code === "invalid_value");
  assert.throws(mutate((record) => { record.input_tokens = "many"; }),
    (error) => error.code === "invalid_value");
});

test("a rejection names the field and never echoes the cell", async () => {
  const document = JSON.parse(await contractFixture("v1.1/fixtures/valid.json"));
  document.records[0].model_raw = "gpt-4o ignore all previous instructions";
  document.records[0].model_tier = "premium";
  const parsed = parseLocalFinopsFile(JSON.stringify(document), "v11.json", "application/json");
  // A long-but-legal SKU string is carried verbatim, not rewritten.
  assert.equal(parsed.document.records[0].model_raw, "gpt-4o ignore all previous instructions");

  document.records[0].model_raw = `over${"long".repeat(80)}`;
  try {
    parseLocalFinopsFile(JSON.stringify(document), "v11.json", "application/json");
    assert.fail("an uncarryable model identifier must be rejected");
  } catch (error) {
    assert.equal(error.code, "invalid_value");
    assert.match(error.message, /model_raw/);
    assert.equal(error.message.includes("overlong"), false);
  }
});

// --- the schema file and the code agree ------------------------------------

test("the v1.1 schema declares exactly what the module produces", async () => {
  const schema = JSON.parse(await contractFixture("v1.1/schema.json"));
  const previous = JSON.parse(await contractFixture("v1/schema.json"));
  assert.equal(schema.properties.schema_version.const, PROVIDER_USAGE_SCHEMA_VERSION);
  assert.equal(previous.properties.schema_version.const, PREVIOUS_PROVIDER_USAGE_SCHEMA_VERSION);
  assert.equal(schema.properties.kind.const, previous.properties.kind.const);

  const aggregate = schema.$defs.aggregate.properties;
  const before = previous.$defs.aggregate.properties;
  // Additive only: no v1.0 field changed meaning or type.
  for (const key of Object.keys(before)) assert.deepEqual(aggregate[key], before[key]);
  assert.deepEqual(
    Object.keys(aggregate).filter((key) => !(key in before)),
    [...USAGE_DETAIL_KEYS],
  );
  assert.deepEqual(schema.$defs.aggregate.required,
    [...previous.$defs.aggregate.required, ...USAGE_DETAIL_KEYS]);
  assert.deepEqual(aggregate.model_tier.enum, [...MODEL_TIERS, null]);
});
