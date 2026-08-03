// The local hyperscaler adapters (#929): a Bedrock, Vertex AI, or Azure OpenAI
// export becoming the canonical v1.1 provider-usage-billing projection, and the
// two failure classes that must never be a projection full of zeros.
//
// Every export here is built in this file rather than committed, so a reader can
// see the exact bytes each expectation is derived from. The three cross-provider
// exports below are deliberately the SAME usage and the SAME money written three
// different ways, because "are these providers comparable?" is the question the
// issue exists to answer and a fixture pair that only looks similar would not
// answer it.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ADAPTED_PROVIDER_IDS, HYPERSCALER_CODES, HYPERSCALER_RESULT,
  HYPERSCALER_SOURCE_INSTANCE_ID, PREFLIGHT_REASONS, adaptHyperscalerExport, adaptParsedExport,
  centsFromDecimal, countFromCell, preflight,
} from "../src/hyperscaler-export-adapters.js";
import { parseExportText } from "../src/browser-compat-eligibility.js";
import { BROWSER_COMPAT_FIXTURES } from "../src/browser-compat-fixtures.js";
import { RECOGNITION_FIXTURES } from "../src/export-recognition-fixtures.js";
import { RECOGNITION_OUTCOMES } from "../src/export-recognition.js";
import { parseLocalFinopsFile } from "../src/local-finops.js";

// --- exports written by hand, one shape per provider ------------------------

const csv = (header, rows) => `${[header, ...rows].map((row) => row.join(",")).join("\n")}\n`;
const jsonl = (records) => `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
const envelope = (records) => JSON.stringify({ properties: { rows: records } });

const BEDROCK_HEADER = ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
  "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId",
  "lineItem/UsageType"];

const bedrock = (rows) => csv(BEDROCK_HEADER, rows);
const bedrockRow = (date, model, units, cost, meter = "USE1-InputTokenCount",
  account = "000000000001") => [date, model, units, cost, "USD", account, meter];

const vertex = (records) => jsonl(records);
const vertexRecord = (date, model, amount, cost, unit = "input tokens",
  project = "proj-synthetic-01") => ({
  usage_start_time: date,
  sku: { model_id: model, description: "Vertex AI generative input" },
  usage: { amount, unit },
  cost,
  currency: "USD",
  project: { id: project },
});

const azure = (records) => envelope(records);
const azureRecord = (date, meter, quantity, cost, resource = "resource-synthetic-01") => ({
  date,
  meterName: meter,
  meterSubCategory: "Azure OpenAI",
  quantity,
  costInBillingCurrency: cost,
  billingCurrency: "USD",
  resourceId: resource,
  resourceGroup: "rg-synthetic",
});

const adapt = (text, fileName, providerId) =>
  adaptHyperscalerExport({ text, fileName, providerId });

const projected = (text, fileName) => {
  const result = adapt(text, fileName);
  assert.equal(result.status, HYPERSCALER_RESULT.PROJECTED,
    `expected a projection, got ${result.status}: ${result.message}`);
  return result;
};

// --- the three published contracts this build adapts ------------------------

test("the adapter claims exactly the three published hyperscaler contracts", () => {
  assert.deepEqual([...ADAPTED_PROVIDER_IDS], ["bedrock", "vertex-ai", "azure-openai"]);
});

// --- per provider: a representative export becomes one canonical document ----

test("a Bedrock Cost and Usage Report becomes the canonical projection", () => {
  const result = projected(bedrock([
    bedrockRow("2026-07-20", "anthropic.claude-sonnet", "120000", "4.80"),
    bedrockRow("2026-07-21", "amazon.titan-text", "45000", "0.90"),
    bedrockRow("2026-07-22", "anthropic.claude-sonnet", "98000", "3.92"),
  ]), "bedrock-usage.csv");

  assert.equal(result.providerId, "bedrock");
  assert.equal(result.document.kind, "wawalu.integration.provider-usage-billing");
  assert.equal(result.document.schema_version, "1.1");
  assert.equal(result.document.snapshot.source_instance_id, HYPERSCALER_SOURCE_INSTANCE_ID);
  assert.equal(result.document.snapshot.period_start, "2026-07-20");
  // Half-open: the period ends the day after the last day the file covers.
  assert.equal(result.document.snapshot.period_end, "2026-07-23");
  assert.equal(result.document.snapshot.completeness, "complete");
  assert.equal(result.document.snapshot.omitted_record_count, 0);
  // No clock: the stamp is the period boundary the file itself stated.
  assert.equal(result.document.snapshot.generated_at, "2026-07-23T00:00:00Z");

  assert.equal(result.document.records.length, 3);
  const [first] = result.document.records;
  assert.equal(first.provider, "aws");
  assert.equal(first.usage_date, "2026-07-20");
  assert.equal(first.service_category, "text-generation");
  assert.equal(first.cost.currency, "USD");
  // Money is integer cents, and 4.80 is 480 of them — not 479 via a float.
  assert.equal(first.cost.amount_minor, 480);
  assert.deepEqual(first.usage, { quantity: 120000, unit: "tokens" });
  assert.equal(first.model_raw, "anthropic.claude-sonnet");
  // The usage type names the direction, so the split is carried, not invented.
  assert.equal(first.input_tokens, 120000);
  // Nothing in this export counted output tokens, so the field is absent.
  assert.equal(first.output_tokens, null);
  assert.equal(first.request_count, null);
});

test("a Vertex AI detailed usage export becomes the canonical projection", () => {
  const result = projected(vertex([
    vertexRecord("2026-07-20T00:00:00Z", "gemini-1.5-pro", 210000, 6.3),
    vertexRecord("2026-07-21T00:00:00Z", "gemini-1.5-flash", 480000, 1.44),
    vertexRecord("2026-07-22T00:00:00Z", "gemini-1.5-pro", 165000, 4.95),
  ]), "vertex-usage.jsonl");

  assert.equal(result.providerId, "vertex-ai");
  assert.equal(result.document.records.length, 3);
  assert.deepEqual(result.document.records.map((record) => record.provider),
    ["google", "google", "google"]);
  // A timestamp is read down to its calendar day, and only its calendar day.
  assert.deepEqual(result.document.records.map((record) => record.usage_date),
    ["2026-07-20", "2026-07-21", "2026-07-22"]);
  assert.deepEqual(result.document.records.map((record) => record.cost.amount_minor),
    [630, 144, 495]);
  assert.deepEqual(result.document.records.map((record) => record.usage.unit),
    ["tokens", "tokens", "tokens"]);
  assert.equal(result.document.records[1].model_raw, "gemini-1.5-flash");
  assert.equal(result.document.records[1].model_tier, "economy");
});

test("an Azure OpenAI actual-cost export becomes the canonical projection", () => {
  const result = projected(azure([
    azureRecord("2026-07-20", "gpt-4o-mini Input Tokens", 180000, 2.7),
    azureRecord("2026-07-21", "gpt-4o Output Tokens", 24000, 3.6),
    azureRecord("2026-07-22", "gpt-4o-mini Input Tokens", 152000, 2.28),
  ]), "azure-usage.json");

  assert.equal(result.providerId, "azure-openai");
  assert.deepEqual(result.document.records.map((record) => record.provider),
    ["azure", "azure", "azure"]);
  assert.deepEqual(result.document.records.map((record) => record.cost.amount_minor),
    [270, 360, 228]);
  // Azure states the direction inside the meter name; that is where it is read.
  assert.equal(result.document.records[0].input_tokens, 180000);
  assert.equal(result.document.records[0].output_tokens, null);
  assert.equal(result.document.records[1].output_tokens, 24000);
  assert.equal(result.document.records[1].input_tokens, null);
});

// --- every projection is canonical, checked by the shipped validator ---------

test("every adapted document is accepted by the v1 provider contract validator", () => {
  const exports = [
    [bedrock([bedrockRow("2026-07-20", "anthropic.claude-sonnet", "120000", "4.80"),
      bedrockRow("2026-07-21", "amazon.titan-text", "45000", "0.90"),
      bedrockRow("2026-07-22", "anthropic.claude-sonnet", "98000", "3.92")]), "b.csv"],
    [vertex([vertexRecord("2026-07-20", "gemini-1.5-pro", 210000, 6.3),
      vertexRecord("2026-07-21", "gemini-1.5-flash", 480000, 1.44),
      vertexRecord("2026-07-22", "gemini-1.5-pro", 165000, 4.95)]), "v.jsonl"],
    [azure([azureRecord("2026-07-20", "gpt-4o-mini Input Tokens", 180000, 2.7),
      azureRecord("2026-07-21", "gpt-4o Output Tokens", 24000, 3.6),
      azureRecord("2026-07-22", "gpt-4o-mini Input Tokens", 152000, 2.28)]), "a.json"],
  ];
  for (const [text, fileName] of exports) {
    const result = projected(text, fileName);
    const revalidated = parseLocalFinopsFile(
      JSON.stringify(result.document), "adapted.json", "application/json");
    assert.equal(revalidated.type, "provider");
    assert.deepEqual(revalidated.document, result.document);
  }
});

// --- cross-provider equivalence, the criterion the issue names --------------

// The same three days, the same token counts, the same money, spelled the way
// each provider spells it. Anything the adapters do that is not a normalization
// shows up as a difference in the projections these produce.
const EQUIVALENT_DAYS = [
  { day: "2026-07-20", tokens: 120000, cost: "4.80", cents: 480 },
  { day: "2026-07-21", tokens: 45000, cost: "0.90", cents: 90 },
  { day: "2026-07-22", tokens: 98000, cost: "3.92", cents: 392 },
];

const EQUIVALENT = [
  {
    providerId: "bedrock", provider: "aws", fileName: "equivalent.csv",
    text: bedrock(EQUIVALENT_DAYS.map((entry) =>
      bedrockRow(entry.day, "shared-model", String(entry.tokens), entry.cost))),
  },
  {
    providerId: "vertex-ai", provider: "google", fileName: "equivalent.jsonl",
    text: vertex(EQUIVALENT_DAYS.map((entry) =>
      vertexRecord(entry.day, "shared-model", entry.tokens, Number(entry.cost)))),
  },
  {
    providerId: "azure-openai", provider: "azure", fileName: "equivalent.json",
    text: azure(EQUIVALENT_DAYS.map((entry) =>
      azureRecord(entry.day, "shared-model Input Tokens", entry.tokens, Number(entry.cost)))),
  },
];

test("semantically equivalent exports from all three providers project comparably", () => {
  const projections = EQUIVALENT.map((entry) => ({
    entry, result: projected(entry.text, entry.fileName),
  }));

  for (const { entry, result } of projections) {
    assert.equal(result.providerId, entry.providerId);
    assert.equal(result.document.snapshot.period_start, "2026-07-20");
    assert.equal(result.document.snapshot.period_end, "2026-07-23");
    assert.equal(result.document.snapshot.completeness, "complete");
    assert.equal(result.document.records.length, EQUIVALENT_DAYS.length);
    // The comparable part of a record: day, canonical provider, money in cents,
    // usage in a canonical unit, and the input split each meter declared.
    assert.deepEqual(result.document.records.map((record) => ({
      usage_date: record.usage_date,
      provider: record.provider,
      service_category: record.service_category,
      amount_minor: record.cost.amount_minor,
      currency: record.cost.currency,
      status: record.cost.status,
      usage: record.usage,
      input_tokens: record.input_tokens,
    })), EQUIVALENT_DAYS.map((day) => ({
      usage_date: day.day,
      provider: entry.provider,
      service_category: "text-generation",
      amount_minor: day.cents,
      currency: "USD",
      status: "final",
      usage: { quantity: day.tokens, unit: "tokens" },
      input_tokens: day.tokens,
    })), `${entry.providerId} did not normalize to the shared projection`);
  }

  // And the totals a portfolio would add up are identical across the three.
  const totals = projections.map(({ result }) => result.document.records
    .reduce((sum, record) => sum + record.cost.amount_minor, 0));
  assert.deepEqual(totals, [962, 962, 962]);
  const tokens = projections.map(({ result }) => result.document.records
    .reduce((sum, record) => sum + record.usage.quantity, 0));
  assert.deepEqual(tokens, [263000, 263000, 263000]);
});

test("equivalent exports differ only in the facts that are genuinely per provider", () => {
  const documents = EQUIVALENT.map((entry) => projected(entry.text, entry.fileName).document);
  // What is nulled below is what genuinely differs per provider: the account,
  // project or resource the usage was billed to, the vendor enum, the ids
  // derived from both — and the model identity, because Azure's model identity
  // IS its meter name ("shared-model Input Tokens") while Bedrock and Vertex
  // carry a bare model id. Everything else must be byte-identical.
  const stripped = documents.map((document) => JSON.stringify({
    ...document,
    export_id: null,
    records: document.records.map((record) => ({
      ...record, aggregate_id: null, org_unit_id: null, provider: null,
      model_raw: null, model_tier: null,
    })),
  }));
  assert.equal(new Set(stripped).size, 1,
    "three equivalent exports produced three different canonical shapes");
  // Each still names a model; none of them lost it in normalization.
  for (const document of documents) {
    assert.ok(document.records.every((record) => typeof record.model_raw === "string"));
  }
  // The export id IS per provider: two providers' periods must not collide.
  assert.equal(new Set(documents.map((document) => document.export_id)).size, 3);
});

// --- determinism ------------------------------------------------------------

test("adapting the same bytes twice yields deep-equal output", () => {
  for (const entry of EQUIVALENT) {
    const first = projected(entry.text, entry.fileName);
    const second = projected(entry.text, entry.fileName);
    assert.deepEqual(second.document, first.document);
    assert.equal(JSON.stringify(second.document), JSON.stringify(first.document),
      `${entry.providerId} did not serialize identically on a second run`);
    assert.equal(second.message, first.message);
  }
});

test("record order in the file does not change the projection", () => {
  const forward = projected(vertex([
    vertexRecord("2026-07-20", "gemini-1.5-pro", 210000, 6.3),
    vertexRecord("2026-07-21", "gemini-1.5-flash", 480000, 1.44),
    vertexRecord("2026-07-22", "gemini-1.5-pro", 165000, 4.95),
  ]), "ordered.jsonl");
  const shuffled = projected(vertex([
    vertexRecord("2026-07-22", "gemini-1.5-pro", 165000, 4.95),
    vertexRecord("2026-07-20", "gemini-1.5-pro", 210000, 6.3),
    vertexRecord("2026-07-21", "gemini-1.5-flash", 480000, 1.44),
  ]), "shuffled.jsonl");
  assert.deepEqual(shuffled.document, forward.document);
});

// --- money and counts, at the boundary --------------------------------------

test("money converts to integer cents by string arithmetic, half-up", () => {
  assert.equal(centsFromDecimal("4.80"), 480);
  assert.equal(centsFromDecimal("4.815"), 482);
  assert.equal(centsFromDecimal("4.814"), 481);
  assert.equal(centsFromDecimal("0"), 0);
  assert.equal(centsFromDecimal("1,234.50"), 123450);
  // The digits are read, never multiplied: a third decimal decides the round
  // and a fourth cannot reach the answer through an inexact binary product.
  assert.equal(centsFromDecimal("0.0049"), 0);
  assert.equal(centsFromDecimal("0.005"), 1);
  assert.equal(centsFromDecimal("n/a"), null);
  assert.equal(centsFromDecimal("-1.00"), null);
  assert.equal(centsFromDecimal(""), null);
});

test("usage counts are whole units or nothing at all", () => {
  assert.equal(countFromCell("120000"), 120000);
  assert.equal(countFromCell(45000), 45000);
  assert.equal(countFromCell("1,500"), 1500);
  assert.equal(countFromCell("1.5"), null);
  assert.equal(countFromCell("many"), null);
});

test("an unreadable row is skipped and counted, never folded in as a zero", () => {
  const result = projected(bedrock([
    bedrockRow("2026-07-20", "anthropic.claude-sonnet", "120000", "4.80"),
    bedrockRow("2026-07-21", "amazon.titan-text", "45000", "n/a"),
    bedrockRow("2026-07-22", "anthropic.claude-sonnet", "98000", "3.92"),
  ]), "malformed.csv");
  assert.equal(result.document.records.length, 2);
  assert.equal(result.document.snapshot.completeness, "partial");
  assert.equal(result.document.snapshot.omitted_record_count, 1);
  assert.equal(result.normalization.skippedRows, 1);
  assert.equal(result.normalization.acceptedRows, 2);
  // The skipped day is absent from the projection rather than present at zero.
  assert.deepEqual(result.document.records.map((record) => record.usage_date),
    ["2026-07-20", "2026-07-22"]);
});

test("rows sharing a day, scope and category fold into one canonical aggregate", () => {
  const result = projected(azure([
    azureRecord("2026-07-20", "gpt-4o Input Tokens", 100000, 1.5),
    azureRecord("2026-07-20", "gpt-4o Output Tokens", 20000, 3),
    azureRecord("2026-07-21", "gpt-4o Input Tokens", 50000, 0.75),
  ]), "folded.json");
  assert.equal(result.document.records.length, 2);
  const [day] = result.document.records;
  assert.equal(day.cost.amount_minor, 450);
  assert.equal(day.usage.quantity, 120000);
  assert.equal(day.input_tokens, 100000);
  assert.equal(day.output_tokens, 20000);
  // Two meters folded into one aggregate name no single model.
  assert.equal(day.model_raw, null);
});

// --- failure class one: incomplete ------------------------------------------

const INCOMPLETE_CASES = [
  {
    providerId: "bedrock", fileName: "bedrock-no-currency.csv", missing: "lineItem/CurrencyCode",
    text: csv(BEDROCK_HEADER.filter((column) => column !== "lineItem/CurrencyCode"),
      [["2026-07-20", "anthropic.claude-sonnet", "120000", "4.80", "000000000001",
        "USE1-InputTokenCount"],
      ["2026-07-21", "amazon.titan-text", "45000", "0.90", "000000000001",
        "USE1-InputTokenCount"],
      ["2026-07-22", "anthropic.claude-sonnet", "98000", "3.92", "000000000001",
        "USE1-InputTokenCount"]]),
  },
  {
    providerId: "vertex-ai", fileName: "vertex-no-model.jsonl", missing: "sku.model_id",
    text: jsonl([
      { usage_start_time: "2026-07-20", sku: { description: "Vertex" },
        usage: { amount: 1000, unit: "tokens" }, cost: 1, currency: "USD",
        project: { id: "p" } },
      { usage_start_time: "2026-07-21", sku: { description: "Vertex" },
        usage: { amount: 2000, unit: "tokens" }, cost: 2, currency: "USD",
        project: { id: "p" } },
      { usage_start_time: "2026-07-22", sku: { description: "Vertex" },
        usage: { amount: 3000, unit: "tokens" }, cost: 3, currency: "USD",
        project: { id: "p" } },
    ]),
  },
  {
    providerId: "azure-openai", fileName: "azure-rollup.json", missing: "meterName",
    text: envelope([
      { date: "2026-07-20", quantity: 1000, costInBillingCurrency: 1,
        billingCurrency: "USD", resourceId: "r", resourceGroup: "rg" },
      { date: "2026-07-21", quantity: 2000, costInBillingCurrency: 2,
        billingCurrency: "USD", resourceId: "r", resourceGroup: "rg" },
      { date: "2026-07-22", quantity: 3000, costInBillingCurrency: 3,
        billingCurrency: "USD", resourceId: "r", resourceGroup: "rg" },
    ]),
  },
];

test("a recognized export missing a required field is typed incomplete, not projected", () => {
  for (const testCase of INCOMPLETE_CASES) {
    const result = adapt(testCase.text, testCase.fileName);
    assert.equal(result.status, HYPERSCALER_RESULT.INCOMPLETE,
      `${testCase.providerId} should be incomplete, got ${result.status}`);
    // The provider is still named: the reader is told which export to re-run.
    assert.equal(result.providerId, testCase.providerId);
    assert.ok(result.displayName);
    assert.ok(result.missingFields.includes(testCase.missing),
      `${testCase.providerId} did not name ${testCase.missing} as missing`);
    assert.match(result.message, /No projection was produced\./);
    assert.ok(result.action.length > 0, "an incomplete result carries one next action");
    // The two things a caller must never find on this branch.
    assert.equal(result.document, undefined);
    assert.equal(result.parsed, undefined);
  }
});

test("a recognized export with too few records is incomplete rather than trended", () => {
  const result = adapt(bedrock([
    bedrockRow("2026-07-20", "anthropic.claude-sonnet", "120000", "4.80"),
  ]), "one-row.csv");
  assert.equal(result.status, HYPERSCALER_RESULT.INCOMPLETE);
  assert.equal(result.providerId, "bedrock");
  assert.deepEqual([...result.missingFields], []);
  assert.match(result.message, /below the accepted band/);
});

test("an export whose every amount is unreadable never reaches the projection", () => {
  // The confidence gate catches this one before the fold: no row carries a
  // parseable cost, so the recognition pass lands it below the accepted band.
  const result = adapt(bedrock([
    bedrockRow("2026-07-20", "m", "120000", "n/a"),
    bedrockRow("2026-07-21", "m", "45000", "n/a"),
    bedrockRow("2026-07-22", "m", "98000", "n/a"),
  ]), "unreadable.csv");
  assert.equal(result.status, HYPERSCALER_RESULT.INCOMPLETE);
  assert.equal(result.providerId, "bedrock");
  assert.match(result.message, /below the accepted band/);
});

test("an export the gate accepts but the fold cannot read is typed empty", () => {
  // Costs and counts all parse, so the recognition pass accepts the file; every
  // day is unreadable, so no aggregate survives. The result is the empty case,
  // not a projection over zero records.
  const result = adapt(bedrock([
    bedrockRow("day one", "m", "120000", "4.80"),
    bedrockRow("day two", "m", "45000", "0.90"),
    bedrockRow("day three", "m", "98000", "3.92"),
  ]), "undated.csv");
  assert.equal(result.status, HYPERSCALER_RESULT.INCOMPLETE);
  assert.equal(result.code, HYPERSCALER_CODES.EMPTY);
  assert.equal(result.providerId, "bedrock");
  assert.equal(result.document, undefined);
});

// --- failure class two: incompatible ----------------------------------------

test("a payload no published contract claims is typed incompatible", () => {
  const result = adapt(csv(["posting_date", "gl_account", "amount", "currency"], [
    ["2026-07-20", "6100-software", "482.10", "USD"],
    ["2026-07-21", "6100-software", "133.75", "USD"],
  ]), "ledger.csv");
  assert.equal(result.status, HYPERSCALER_RESULT.INCOMPATIBLE);
  assert.equal(result.code, HYPERSCALER_CODES.WRONG_PROVIDER);
  assert.equal(result.providerId, null);
  assert.equal(result.confidence, 0);
  assert.equal(result.document, undefined);
});

test("each provider rejects another provider's export when the caller pinned one", () => {
  const wrong = [
    ["bedrock", EQUIVALENT[1]],
    ["vertex-ai", EQUIVALENT[2]],
    ["azure-openai", EQUIVALENT[0]],
  ];
  for (const [pinned, entry] of wrong) {
    const result = adapt(entry.text, entry.fileName, pinned);
    assert.equal(result.status, HYPERSCALER_RESULT.INCOMPATIBLE);
    assert.equal(result.code, HYPERSCALER_CODES.WRONG_PROVIDER);
    // The file's own provider is still reported, so the remedy can name it.
    assert.equal(result.providerId, entry.providerId);
    assert.equal(result.document, undefined);
  }
});

test("an export carrying conversation bodies is refused rather than stripped", () => {
  const header = [...BEDROCK_HEADER, "prompt_text"];
  const result = adapt(csv(header, [
    ["2026-07-20", "m", "120000", "4.80", "USD", "acct", "USE1-InputTokenCount", "(withheld)"],
    ["2026-07-21", "m", "45000", "0.90", "USD", "acct", "USE1-InputTokenCount", "(withheld)"],
    ["2026-07-22", "m", "98000", "3.92", "USD", "acct", "USE1-InputTokenCount", "(withheld)"],
  ]), "invocations.csv");
  assert.equal(result.status, HYPERSCALER_RESULT.INCOMPATIBLE);
  assert.equal(result.code, HYPERSCALER_CODES.PROMPT_CONTENT);
  assert.equal(result.confidence, 0);
});

test("an export priced in another currency is refused, never converted", () => {
  const result = adapt(vertex([
    { ...vertexRecord("2026-07-20", "gemini-1.5-pro", 210000, 6.3), currency: "EUR" },
    { ...vertexRecord("2026-07-21", "gemini-1.5-pro", 180000, 5.4), currency: "EUR" },
    { ...vertexRecord("2026-07-22", "gemini-1.5-pro", 165000, 4.95), currency: "EUR" },
  ]), "euro.jsonl");
  assert.equal(result.status, HYPERSCALER_RESULT.INCOMPATIBLE);
  assert.equal(result.code, HYPERSCALER_CODES.UNSUPPORTED_CURRENCY);
  assert.equal(result.providerId, "vertex-ai");
});

// --- the shipped fixtures, driven through the adapter -----------------------

test("Anya's bundled compatibility fixtures adapt exactly as their case says", () => {
  const supported = BROWSER_COMPAT_FIXTURES.filter((entry) => entry.caseCode === null);
  assert.equal(supported.length, 3, "one representative fixture per published contract");
  for (const fixture of supported) {
    const result = adapt(fixture.text, fixture.fileName);
    assert.equal(result.status, HYPERSCALER_RESULT.PROJECTED, `${fixture.id}: ${result.message}`);
    assert.equal(result.providerId, fixture.providerId);
    assert.equal(result.document.records.length > 0, true);
  }
  // A fixture filed under another provider's wrong-provider case is a real
  // export of a DIFFERENT provider, so it is only wrong once a caller has
  // pinned the provider the reader chose. Pinned, all three are refused.
  const wrongProvider = BROWSER_COMPAT_FIXTURES.filter((entry) =>
    entry.caseCode === HYPERSCALER_CODES.WRONG_PROVIDER);
  assert.equal(wrongProvider.length, 3);
  for (const fixture of wrongProvider) {
    const result = adapt(fixture.text, fixture.fileName, fixture.providerId);
    assert.equal(result.status, HYPERSCALER_RESULT.INCOMPATIBLE, fixture.id);
    assert.equal(result.code, HYPERSCALER_CODES.WRONG_PROVIDER, fixture.id);
  }
});

test("Theo's recognition fixtures decide the adapter's branch, with no second detector", () => {
  const branch = {
    [RECOGNITION_OUTCOMES.RECOGNIZED]: HYPERSCALER_RESULT.PROJECTED,
    [RECOGNITION_OUTCOMES.INCOMPLETE]: HYPERSCALER_RESULT.INCOMPLETE,
    [RECOGNITION_OUTCOMES.AMBIGUOUS]: HYPERSCALER_RESULT.INCOMPATIBLE,
    [RECOGNITION_OUTCOMES.INCOMPATIBLE]: HYPERSCALER_RESULT.INCOMPATIBLE,
  };
  let projections = 0;
  for (const fixture of RECOGNITION_FIXTURES) {
    const result = adaptParsedExport(fixture.parsed);
    assert.equal(result.recognition.outcome, fixture.expected.outcome, fixture.id);
    assert.equal(result.status, branch[fixture.expected.outcome], `${fixture.id}: ${result.message}`);
    assert.equal(result.confidence, fixture.expected.confidence, fixture.id);
    if (result.status === HYPERSCALER_RESULT.PROJECTED) projections += 1;
  }
  assert.ok(projections >= 3, "the recognized fixtures must actually project");
});

// --- the check path: preflight, which imports nothing ------------------------
//
// One recognition pass is shared with the adapter above; what these assert is
// the VERDICT a reader is handed before importing — the provider, the counts,
// the missing columns, and the single instruction each state maps to. Every
// expectation below is the whole string, because a substring match would pass
// on an instruction that named the wrong column.

const check = (text, fileName) => preflight(parseExportText(text, fileName));

const VERTEX_ROWS = [
  vertexRecord("2026-07-20", "gemini-1.5-pro", 120000, "4.80"),
  vertexRecord("2026-07-21", "gemini-1.5-pro", 45000, "0.90"),
  vertexRecord("2026-07-22", "gemini-1.5-pro", 98000, "3.92"),
];

// The same rows with the money column taken out. Vertex is the shape that makes
// this state reachable: its cost column is not one of its signature columns, so
// the file is still recognized as Vertex AI and is still unusable.
const withoutCost = (record) => {
  const { cost, ...rest } = record;
  return rest;
};

test("a recognized, complete export is told there is nothing to fix", () => {
  const verdict = check(vertex(VERTEX_ROWS), "vertex-usage.jsonl");
  assert.equal(verdict.provider, "vertex-ai");
  assert.equal(verdict.displayName, "Google Vertex AI");
  assert.equal(verdict.rowCount, 3);
  assert.equal(verdict.periodCount, 3);
  assert.deepEqual([...verdict.missingColumns], []);
  assert.equal(verdict.reason, PREFLIGHT_REASONS.READY);
  assert.equal(verdict.nextAction,
    "Nothing to fix. Import this Google Vertex AI export to run the analysis.");
});

test("an export with no amount column is told which column to re-pull it with", () => {
  const verdict = check(vertex(VERTEX_ROWS.map(withoutCost)), "vertex-usage.jsonl");
  assert.equal(verdict.provider, "vertex-ai");
  assert.equal(verdict.rowCount, 3);
  assert.equal(verdict.periodCount, 3);
  assert.deepEqual([...verdict.missingColumns], ["cost"]);
  assert.equal(verdict.reason, PREFLIGHT_REASONS.MISSING_REQUIRED_COLUMN);
  assert.equal(verdict.nextAction,
    "Re-pull the Google Vertex AI export with the cost column included, then check it again.");
});

test("an unrecognized file is told which consoles this build reads", () => {
  const verdict = check(csv(["posting_date", "gl_account", "amount"], [
    ["2026-07-20", "6100-software", "482.10"],
    ["2026-07-21", "6100-software", "133.75"],
  ]), "ledger.csv");
  assert.equal(verdict.provider, null);
  assert.equal(verdict.displayName, null);
  assert.equal(verdict.rowCount, 2);
  assert.equal(verdict.periodCount, 0);
  assert.deepEqual([...verdict.missingColumns], []);
  assert.equal(verdict.reason, PREFLIGHT_REASONS.UNRECOGNIZED_PROVIDER);
  assert.equal(verdict.nextAction,
    "Re-pull a usage export from one of the consoles this build adapts — AWS Bedrock, "
    + "Google Vertex AI, Azure OpenAI — as none of their signature columns are in this file.");
});

test("an empty file is told to re-pull a period that has usage in it", () => {
  const verdict = check("   \n\n", "usage.csv");
  assert.equal(verdict.provider, null);
  assert.equal(verdict.rowCount, 0);
  assert.equal(verdict.periodCount, 0);
  assert.equal(verdict.reason, PREFLIGHT_REASONS.EMPTY_EXPORT);
  assert.equal(verdict.nextAction, "Re-pull the export over a billing period that has usage "
    + "in it: this file carries no usage rows to check.");
});

test("a check writes nothing: persisted state is byte-identical across it", () => {
  const values = new Map([
    ["shiplog.finops.brief", JSON.stringify({ recoverable: 4820 })],
    ["shiplog.finops.workspace", "vertex-ai"],
  ]);
  const serialize = () => JSON.stringify([...values.entries()].sort());
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => { values.set(key, String(value)); },
      removeItem: (key) => { values.delete(key); },
      clear: () => { values.clear(); },
      get length() { return values.size; },
    },
  });
  try {
    const before = serialize();
    const first = check(vertex(VERTEX_ROWS), "vertex-usage.jsonl");
    const second = check(vertex(VERTEX_ROWS.map(withoutCost)), "vertex-usage.jsonl");
    // Serialized state, not object identity: a verdict that wrote a key back
    // with the same value would still be a write.
    assert.equal(serialize(), before, "preflight wrote to persisted state");
    // And a verdict is a fresh object each call rather than one shared record
    // two calls take turns mutating.
    assert.notEqual(first, second);
    assert.deepEqual(check(vertex(VERTEX_ROWS), "vertex-usage.jsonl"), first);
  } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else delete globalThis.localStorage;
  }
});
