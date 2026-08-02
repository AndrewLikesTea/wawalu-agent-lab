// The three hyperscaler adapters, the shared normalization they run through,
// and the import entry point that routes to them.
//
// The equivalence test is the one this issue is actually about: three exports
// carrying the same usage and the same money, printed in three different units,
// have to arrive at the same canonical records. Everything else here guards a
// property that test depends on — recognition claims one adapter, a bad file
// comes back as an outcome rather than a throw, and the same bytes project
// identically twice.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BROWSER_COMPAT_FIXTURES, UNRECOGNIZED_FIXTURE,
} from "../src/browser-compat-fixtures.js";
import { UNSUPPORTED_CODES } from "../src/browser-compat-contracts.js";
import {
  HYPERSCALER_ADAPTERS, HYPERSCALER_OUTCOME, adaptAzureOpenAiExport, adaptBedrockExport,
  adaptVertexExport, recognizeHyperscalerExport,
} from "../src/hyperscaler-export-adapters.js";
import { parseLocalImportFile } from "../src/finops-tabular-import.js";
import { orgUnitPseudonym } from "../src/unit-pseudonym.js";

const fixture = (id) => BROWSER_COMPAT_FIXTURES.find((entry) => entry.id === id);
const supported = (providerId) => fixture(`${providerId}-supported`);
const variantOf = (providerId, code) => fixture(`${providerId}-${code}`);

const ADAPTERS = Object.freeze({
  bedrock: adaptBedrockExport,
  "vertex-ai": adaptVertexExport,
  "azure-openai": adaptAzureOpenAiExport,
});

// The currency column each contract requires, and the provider whose export is
// the wrong-provider case for it. Both come from the fixtures, not from a
// second reading of the contract.
const CASES = Object.freeze([
  { providerId: "bedrock", provider: "aws", currencyPath: "lineItem/CurrencyCode",
    modelPath: "product/model_id", records: 3, totalMinor: 480 + 90 + 392 },
  { providerId: "vertex-ai", provider: "google", currencyPath: "currency",
    modelPath: "sku.model_id", records: 3, totalMinor: 630 + 144 + 495 },
  { providerId: "azure-openai", provider: "azure", currencyPath: "billingCurrency",
    modelPath: "meterName", records: 3, totalMinor: 270 + 360 + 228 },
]);

const totalMinor = (document) =>
  document.records.reduce((sum, record) => sum + record.cost.amount_minor, 0);
const totalTokens = (document) =>
  document.records.reduce((sum, record) => sum + record.usage.quantity, 0);

test("recognition is deterministic and claimed by at most one adapter", () => {
  for (const entry of [...BROWSER_COMPAT_FIXTURES, UNRECOGNIZED_FIXTURE]) {
    const claiming = HYPERSCALER_ADAPTERS.filter((adapter) => adapter.claims(entry.text));
    assert.ok(claiming.length <= 1,
      `${entry.id} was claimed by ${claiming.map((one) => one.providerId).join(", ")}`);
    // Same input, same answer: recognition reads markers, never a file name.
    assert.equal(recognizeHyperscalerExport(entry.text)?.providerId ?? null,
      claiming[0]?.providerId ?? null);
  }
  assert.equal(recognizeHyperscalerExport(UNRECOGNIZED_FIXTURE.text), null,
    "a generic finance ledger is nobody's export and must stay unclaimed");
});

for (const supportedCase of CASES) {
  const { providerId, provider } = supportedCase;
  const adapt = ADAPTERS[providerId];

  test(`${providerId}: the representative export becomes the canonical projection`, () => {
    const result = adapt(supported(providerId).text);
    assert.equal(result.ok, true);
    assert.equal(result.outcome, HYPERSCALER_OUTCOME.PROJECTED);
    assert.equal(result.skippedRows, 0);
    const { document } = result;
    assert.equal(document.kind, "wawalu.integration.provider-usage-billing");
    assert.equal(document.schema_version, "1.1");
    assert.equal(document.records.length, supportedCase.records);
    assert.equal(totalMinor(document), supportedCase.totalMinor);
    assert.deepEqual(new Set(document.records.map((record) => record.provider)),
      new Set([provider]));
    // The period and the one timestamp in the envelope are derived from the
    // export's own dates. No wall clock is consulted anywhere in this path.
    assert.equal(document.snapshot.period_start, "2026-07-20");
    assert.equal(document.snapshot.period_end, "2026-07-23");
    assert.equal(document.snapshot.generated_at, "2026-07-22T00:00:00.000Z");
    assert.equal(document.snapshot.completeness, "complete");
    assert.equal(document.snapshot.omitted_record_count, 0);
    assert.equal(document.privacy.content_included, false);
  });

  test(`${providerId}: a missing required field is incomplete and names the field`, () => {
    const result = adapt(variantOf(providerId, UNSUPPORTED_CODES.UNMODELED_VARIANT).text);
    assert.equal(result.ok, false);
    assert.equal(result.outcome, HYPERSCALER_OUTCOME.INCOMPLETE);
    assert.equal(result.providerId, providerId);
    assert.deepEqual(result.missingFields, [supportedCase.currencyPath]);
    assert.equal(result.caseCode, UNSUPPORTED_CODES.UNMODELED_VARIANT);
    assert.match(result.remedy, /export/i);

    // A missing model field is still incomplete, and still names its field, but
    // it is the contract's rollup case rather than an unmodeled variant.
    const rollup = adapt(variantOf(providerId, UNSUPPORTED_CODES.ROLLUP_ONLY).text);
    assert.equal(rollup.outcome, HYPERSCALER_OUTCOME.INCOMPLETE);
    assert.equal(rollup.caseCode, UNSUPPORTED_CODES.ROLLUP_ONLY);
    assert.deepEqual(rollup.missingFields, [supportedCase.modelPath]);
  });

  test(`${providerId}: another provider's export is incompatible, not incomplete`, () => {
    const wrong = adapt(variantOf(providerId, UNSUPPORTED_CODES.WRONG_PROVIDER).text);
    assert.equal(wrong.ok, false);
    assert.equal(wrong.outcome, HYPERSCALER_OUTCOME.INCOMPATIBLE);
    assert.equal(wrong.caseCode, UNSUPPORTED_CODES.WRONG_PROVIDER);
    assert.deepEqual(wrong.missingFields, [],
      "an incompatible file has no missing fields to name; it is the wrong file");

    // A generic ledger and an empty string are the same answer.
    assert.equal(adapt(UNRECOGNIZED_FIXTURE.text).outcome, HYPERSCALER_OUTCOME.INCOMPATIBLE);
    assert.equal(adapt("").outcome, HYPERSCALER_OUTCOME.INCOMPATIBLE);

    // An export carrying conversation bodies is refused on the same terms:
    // outside the contract, never parsed into a projection.
    const prompt = adapt(variantOf(providerId, UNSUPPORTED_CODES.PROMPT_CONTENT).text);
    assert.equal(prompt.outcome, HYPERSCALER_OUTCOME.INCOMPATIBLE);
    assert.equal(prompt.caseCode, UNSUPPORTED_CODES.PROMPT_CONTENT);
    assert.ok(prompt.prohibitedFields.length >= 1);
  });

  test(`${providerId}: bad input is an outcome, and a caller defect is a throw`, () => {
    assert.doesNotThrow(() => adapt("not an export at all"));
    assert.throws(() => adapt({ text: supported(providerId).text }), TypeError,
      "handing an adapter a non-string is a programmer error, not user data");
  });
}

test("a malformed row is skipped and counted, and the period says so", () => {
  const result = adaptBedrockExport(
    variantOf("bedrock", "malformed_rows_skipped").text);
  assert.equal(result.ok, true);
  assert.equal(result.skippedRows, 1);
  assert.equal(result.document.snapshot.completeness, "partial");
  assert.equal(result.document.snapshot.omitted_record_count, 1);
});

test("an export with no usable records is incomplete rather than an empty projection", () => {
  const empty = adaptBedrockExport(variantOf("bedrock", "empty_or_header_only").text);
  assert.equal(empty.outcome, HYPERSCALER_OUTCOME.INCOMPLETE);
  assert.equal(empty.caseCode, UNSUPPORTED_CODES.EMPTY);
  assert.deepEqual(empty.missingFields, []);
});

test("the same input projects identically twice, byte for byte", () => {
  for (const { providerId } of CASES) {
    const adapt = ADAPTERS[providerId];
    const first = adapt(supported(providerId).text);
    const second = adapt(supported(providerId).text);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first.document), JSON.stringify(second.document),
      `${providerId} must serialize identically on a second run`);
  }
});

// --- cross-provider equivalence --------------------------------------------
//
// One month of usage, described three ways. The money is the same, the token
// count is the same, and the three exports print the units differently on
// purpose: Bedrock counts raw tokens, Vertex prints thousands in `usage.unit`,
// and the Azure meter carries the same rate multiple in its name. If the shared
// normalizer were three coincidentally-matching implementations, this is the
// test that would fail.

const SCOPE = "shared-scope-01";
const DAYS = Object.freeze([
  { date: "2026-07-20", tokens: 120_000, cost: "4.80", minor: 480 },
  { date: "2026-07-21", tokens: 90_000, cost: "3.60", minor: 360 },
]);
const MODEL = "gpt-4o";

const bedrockEquivalent = () => [
  ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
    "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId",
    "lineItem/UsageType"].join(","),
  ...DAYS.map((day) => [day.date, MODEL, day.tokens, day.cost, "USD", SCOPE,
    "USE1-InputTokenCount"].join(",")),
].join("\n");

const vertexEquivalent = () => DAYS.map((day) => JSON.stringify({
  usage_start_time: day.date,
  sku: { model_id: MODEL, description: "Generative input tokens" },
  // Printed per 1,000 tokens, which is what the shared normalizer has to undo.
  usage: { amount: day.tokens / 1000, unit: "1k tokens" },
  cost: Number(day.cost),
  currency: "USD",
  project: { id: SCOPE },
})).join("\n");

const azureEquivalent = () => JSON.stringify({
  properties: {
    rows: DAYS.map((day) => ({
      date: day.date,
      meterName: `${MODEL} 1K Input Tokens`,
      quantity: day.tokens / 1000,
      costInBillingCurrency: Number(day.cost),
      billingCurrency: "USD",
      resourceId: SCOPE,
    })),
  },
});

test("three providers' equivalent exports project to comparable records", () => {
  const projections = [
    adaptBedrockExport(bedrockEquivalent()),
    adaptVertexExport(vertexEquivalent()),
    adaptAzureOpenAiExport(azureEquivalent()),
  ];
  assert.deepEqual(projections.map((result) => result.outcome),
    Array(3).fill(HYPERSCALER_OUTCOME.PROJECTED));

  const expectedMinor = DAYS.reduce((sum, day) => sum + day.minor, 0);
  const expectedTokens = DAYS.reduce((sum, day) => sum + day.tokens, 0);
  for (const { document } of projections) {
    assert.equal(totalMinor(document), expectedMinor, "total cost must match to the cent");
    assert.equal(totalTokens(document), expectedTokens, "token totals must match exactly");
    assert.equal(document.snapshot.period_start, DAYS[0].date);
    assert.equal(document.snapshot.period_end, "2026-07-22");
    assert.equal(document.snapshot.generated_at, "2026-07-21T00:00:00.000Z");
  }

  // Per-model breakdown: one model, the same spend and the same tokens under
  // the same identity, from all three.
  const breakdown = ({ document }) => document.records.map((record) => [
    record.usage_date, record.model_raw, record.model_tier, record.org_unit_id,
    record.service_category, record.usage.unit, record.usage.quantity,
    record.input_tokens, record.output_tokens, record.cost.amount_minor,
  ]);
  const [bedrock, vertex, azure] = projections.map(breakdown);
  assert.deepEqual(vertex, bedrock);
  assert.deepEqual(azure, bedrock);
  assert.deepEqual(bedrock, [
    ["2026-07-20", MODEL, "premium", orgUnitPseudonym(SCOPE), "text-generation",
      "tokens", 120_000, 120_000, 0, 480],
    ["2026-07-21", MODEL, "premium", orgUnitPseudonym(SCOPE), "text-generation",
      "tokens", 90_000, 90_000, 0, 360],
  ]);

  // The records differ in exactly one dimension — which provider was billed.
  const withoutIdentity = ({ document }) => document.records.map(
    ({ aggregate_id: _id, provider: _provider, ...rest }) => rest);
  assert.deepEqual(withoutIdentity(projections[1]), withoutIdentity(projections[0]));
  assert.deepEqual(withoutIdentity(projections[2]), withoutIdentity(projections[0]));
  assert.deepEqual(projections.map(({ document }) => document.records[0].provider),
    ["aws", "google", "azure"]);
});

// --- entry-point integration -----------------------------------------------

test("the import entry point routes each provider export to its adapter", () => {
  for (const { providerId, provider } of CASES) {
    const entry = supported(providerId);
    const parsed = parseLocalImportFile(entry.text, entry.fileName, "");
    assert.equal(parsed.type, "provider");
    assert.equal(parsed.shape, `hyperscaler_${providerId}`);
    // The envelope came back through the shipped v1 validator, so it is the
    // canonical projection on the same terms as an uploaded JSON export.
    assert.equal(parsed.document.kind, "wawalu.integration.provider-usage-billing");
    assert.deepEqual(new Set(parsed.document.records.map((record) => record.provider)),
      new Set([provider]));
  }
});

test("the entry point reports the two refusals apart, with the missing fields", () => {
  const incomplete = variantOf("azure-openai", UNSUPPORTED_CODES.UNMODELED_VARIANT);
  assert.throws(() => parseLocalImportFile(incomplete.text, incomplete.fileName, ""), (error) => {
    assert.equal(error.code, "hyperscaler_export_incomplete");
    assert.deepEqual(error.missingFields, ["billingCurrency"]);
    assert.equal(error.providerId, "azure-openai");
    return true;
  });

  const refused = variantOf("vertex-ai", UNSUPPORTED_CODES.PROMPT_CONTENT);
  assert.throws(() => parseLocalImportFile(refused.text, refused.fileName, ""), (error) => {
    assert.equal(error.code, "hyperscaler_export_incompatible");
    assert.equal(error.caseCode, UNSUPPORTED_CODES.PROMPT_CONTENT);
    return true;
  });
});

test("already-supported inputs still take their existing path", () => {
  const openai = [
    "usage_date,model,project,n_context_tokens_total,amount",
    "2026-07-20,gpt-4o,Platform,120000,4.80",
    "2026-07-21,gpt-4o,Platform,90000,3.60",
  ].join("\n");
  const parsed = parseLocalImportFile(openai, "openai.csv", "text/csv");
  assert.equal(parsed.type, "provider");
  assert.equal(parsed.shape, "openai_usage",
    "the hyperscaler branch must not claim a file the delimited path already reads");
  assert.equal(recognizeHyperscalerExport(openai), null);
});
