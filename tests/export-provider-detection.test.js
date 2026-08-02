// Content-based provider detection (#957): the contract of the one entry point
// the page's local-export handler calls. Every fixture is generated here rather
// than committed, and no assertion depends on a DOM, a clock or a network.
//
// The wiring — that /evolution.html actually reaches this module and paints its
// named reason — is asserted in tests/hyperscaler-import-wiring.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import {
  AMBIGUITY_MARGIN, DETECTABLE_PROVIDER_IDS, DETECTION_CODES, PROVIDER_ORDER,
  awsFamilyVerdict, columnTokens, describeDetection, detectAndNormalizeExport, formatOf,
} from "../src/export-provider-detection.js";

const csv = (header, rows) => `${[header, ...rows].map((row) => row.join(",")).join("\n")}\n`;

// --- one realistic fixture per supported provider ---------------------------

const BEDROCK = csv(
  ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
    "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId"],
  [["2026-07-20", "anthropic.claude-sonnet", "120000", "4.80", "USD", "000000000001"],
    ["2026-07-21", "anthropic.claude-sonnet", "45000", "0.90", "USD", "000000000001"],
    ["2026-07-22", "anthropic.claude-haiku", "98000", "1.92", "USD", "000000000001"]]);

// The same AWS report SHAPE with no model column and no Bedrock service in it:
// a general Cost and Usage Report, which is a different verdict from the file
// above even though four of its six columns are identical.
const AWS = csv(
  ["bill/BillingPeriodStartDate", "lineItem/UsageStartDate", "lineItem/ProductCode",
    "lineItem/UsageAmount", "lineItem/UnblendedCost", "lineItem/CurrencyCode",
    "lineItem/UsageAccountId"],
  [["2026-07-01", "2026-07-20", "AmazonEC2", "740", "88.10", "USD", "000000000001"],
    ["2026-07-01", "2026-07-21", "AmazonS3", "1200", "12.40", "USD", "000000000001"],
    ["2026-07-01", "2026-07-22", "AmazonEC2", "740", "88.10", "USD", "000000000001"]]);

// The same report sliced to one service. No model column at all — the ONLY
// Bedrock signal is the service naming itself in the rows.
const AWS_BEDROCK_SLICE = csv(
  ["bill/BillingPeriodStartDate", "lineItem/UsageStartDate", "lineItem/ProductCode",
    "lineItem/UsageAmount", "lineItem/UnblendedCost", "lineItem/CurrencyCode",
    "lineItem/UsageAccountId"],
  [["2026-07-01", "2026-07-20", "AmazonBedrock", "120000", "4.80", "USD", "000000000001"],
    ["2026-07-01", "2026-07-21", "AmazonBedrock", "45000", "0.90", "USD", "000000000001"]]);

const VERTEX = [
  { usage_start_time: "2026-07-20T00:00:00Z", sku: { model_id: "gemini-1.5-pro" },
    usage: { amount: 91000, unit: "tokens" }, cost: 3.11, currency: "USD", project: { id: "acme-prod" } },
  { usage_start_time: "2026-07-21T00:00:00Z", sku: { model_id: "gemini-1.5-flash" },
    usage: { amount: 220000, unit: "tokens" }, cost: 1.02, currency: "USD", project: { id: "acme-prod" } },
  { usage_start_time: "2026-07-22T00:00:00Z", sku: { model_id: "gemini-1.5-pro" },
    usage: { amount: 64000, unit: "tokens" }, cost: 2.18, currency: "USD", project: { id: "acme-prod" } },
].map((record) => JSON.stringify(record)).join("\n");

const AZURE = JSON.stringify({
  properties: {
    rows: [
      { date: "2026-07-20", meterName: "gpt-4o Input Tokens", quantity: 140000,
        costInBillingCurrency: 3.5, billingCurrency: "USD",
        resourceId: "/subscriptions/s/resourceGroups/rg/providers/openai/acme" },
      { date: "2026-07-21", meterName: "gpt-4o Output Tokens", quantity: 38000,
        costInBillingCurrency: 5.7, billingCurrency: "USD",
        resourceId: "/subscriptions/s/resourceGroups/rg/providers/openai/acme" },
    ],
  },
});

const OPENAI = csv(
  ["timestamp", "organization_id", "project_id", "model", "n_context_tokens_total",
    "amount_value", "amount_currency"],
  [["2026-07-20", "org-acme", "proj-search", "gpt-4o", "410000", "5.12", "usd"],
    ["2026-07-21", "org-acme", "proj-search", "gpt-4o-mini", "980000", "1.47", "usd"],
    ["2026-07-22", "org-acme", "proj-chat", "gpt-4o", "220000", "2.75", "usd"]]);

const FIXTURES = Object.freeze([
  ["bedrock", BEDROCK],
  ["aws", AWS],
  ["vertex-ai", VERTEX],
  ["azure-openai", AZURE],
  ["openai", OPENAI],
]);

// A general-ledger extract: billing-shaped to a human, no cost column any
// supported provider declares.
const LEDGER = csv(["posting_date", "gl_account", "amount"],
  [["2026-07-20", "6100-software", "482.10"], ["2026-07-21", "6100-software", "133.75"]]);

// --- detection --------------------------------------------------------------

for (const [provider, text] of FIXTURES) {
  test(`a ${provider} export is detected from its content alone`, () => {
    const verdict = detectAndNormalizeExport(text);
    assert.equal(verdict.provider, provider);
    assert.equal(verdict.reason.code, DETECTION_CODES.DETECTED);
    assert.ok(verdict.confidence >= 80,
      `a realistic ${provider} export should score high, scored ${verdict.confidence}`);
    assert.equal(verdict.normalizedProjection.provider, provider);
    assert.ok(verdict.normalizedProjection.rowCount >= 2);
    assert.equal(verdict.normalizedProjection.missingRoles.length, 0);
  });
}

test("the supported set is exactly the five providers, in one declared order", () => {
  assert.deepEqual(DETECTABLE_PROVIDER_IDS,
    ["azure-openai", "vertex-ai", "bedrock", "aws", "openai"]);
  assert.equal(PROVIDER_ORDER.length, 5);
});

test("an unrecognizable file returns a named reason and the closest candidate", () => {
  const verdict = detectAndNormalizeExport(LEDGER);
  assert.equal(verdict.provider, null);
  assert.equal(verdict.normalizedProjection, null);
  assert.equal(verdict.reason.code, DETECTION_CODES.NO_COST_COLUMN);
  assert.match(verdict.reason.message, /No cost or amount column was found/);
  assert.ok(verdict.closestCandidate, "a failure must still name the nearest importer");
  assert.ok(DETECTABLE_PROVIDER_IDS.includes(verdict.closestCandidate.provider));
  assert.equal(typeof verdict.closestCandidate.score, "number");
  assert.match(verdict.reason.message,
    new RegExp(`${verdict.closestCandidate.displayName}.*${verdict.closestCandidate.confidence} of 100`));
});

test("billing-shaped columns with no identifying column are their own reason", () => {
  const verdict = detectAndNormalizeExport(csv(["date", "cost", "currency", "quantity"],
    [["2026-07-20", "12.00", "USD", "4000"]]));
  assert.equal(verdict.provider, null);
  assert.equal(verdict.reason.code, DETECTION_CODES.NO_SIGNATURE_MATCH);
  assert.ok(verdict.closestCandidate.confidence > 0,
    "the file matched role columns, so the closest candidate is not a zero");
});

test("two providers that cannot be separated are ambiguous, not a coin toss", () => {
  const verdict = detectAndNormalizeExport(csv(
    ["date", "meterName", "quantity", "costInBillingCurrency", "billingCurrency", "resourceId",
      "usage_start_time", "sku.model_id", "usage.amount", "cost", "currency", "project.id"],
    [["2026-07-20", "gpt-4o", "1", "1", "USD", "/x", "2026-07-20", "gemini", "1", "1", "USD", "p"]]));
  assert.equal(verdict.provider, null);
  assert.equal(verdict.reason.code, DETECTION_CODES.AMBIGUOUS_PROVIDERS);
  assert.match(verdict.reason.message, new RegExp(`${AMBIGUITY_MARGIN}-point separation`));
  assert.ok(verdict.closestCandidate.confidence > 0);
});

test("empty and whitespace-only input are the same named reason, never a crash", () => {
  for (const text of ["", "   ", "\n\n\t  \r\n"]) {
    const verdict = detectAndNormalizeExport(text);
    assert.equal(verdict.provider, null);
    assert.equal(verdict.reason.code, DETECTION_CODES.EMPTY_EXPORT);
    assert.equal(verdict.normalizedProjection, null);
    assert.equal(verdict.confidence, 0);
  }
  // Not a string at all is still a return value rather than a throw.
  assert.equal(detectAndNormalizeExport(null).reason.code, DETECTION_CODES.EMPTY_EXPORT);
  assert.equal(detectAndNormalizeExport(undefined).provider, null);
});

// --- the AWS/Bedrock discriminator ------------------------------------------

test("an AWS-shaped file is Bedrock only when it carries a Bedrock marker", () => {
  // Same report shape, three files, three different answers to ONE question.
  assert.equal(detectAndNormalizeExport(AWS).provider, "aws");
  assert.equal(detectAndNormalizeExport(AWS_BEDROCK_SLICE).provider, "bedrock");
  assert.equal(detectAndNormalizeExport(BEDROCK).provider, "bedrock");

  const generic = awsFamilyVerdict(columnTokens(AWS, "csv"), AWS);
  assert.deepEqual({ ...generic }, { provider: "aws", markerColumn: false, markerToken: false });
  const sliced = awsFamilyVerdict(columnTokens(AWS_BEDROCK_SLICE, "csv"), AWS_BEDROCK_SLICE);
  assert.deepEqual({ ...sliced }, { provider: "bedrock", markerColumn: false, markerToken: true });
  const modelled = awsFamilyVerdict(columnTokens(BEDROCK, "csv"), BEDROCK);
  assert.deepEqual({ ...modelled }, { provider: "bedrock", markerColumn: true, markerToken: false });
});

test("the loser of the AWS/Bedrock question is not left to be beaten on points", () => {
  // The generic report outscores nothing by luck: the sliced report scores
  // LOWER as AWS than the generic one does and is still Bedrock, and the
  // ambiguous reason — which the two would otherwise trigger against each
  // other, being the same shape — never fires for a file in this family.
  for (const text of [AWS, AWS_BEDROCK_SLICE, BEDROCK]) {
    assert.notEqual(detectAndNormalizeExport(text).reason.code,
      DETECTION_CODES.AMBIGUOUS_PROVIDERS);
  }
  assert.equal(detectAndNormalizeExport(AWS_BEDROCK_SLICE).normalizedProjection
    .awsFamilyMarker.markerToken, true);
});

// --- determinism ------------------------------------------------------------

test("the same input produces the same provider, confidence and reason every run", () => {
  const cases = [...FIXTURES.map(([, text]) => text), LEDGER, "", "   "];
  for (const text of cases) {
    const runs = Array.from({ length: 6 }, () => detectAndNormalizeExport(text));
    for (const run of runs) {
      assert.equal(run.provider, runs[0].provider);
      assert.equal(run.confidence, runs[0].confidence);
      assert.deepEqual({ ...run.reason }, { ...runs[0].reason });
      assert.deepEqual(run.closestCandidate ? { ...run.closestCandidate } : null,
        runs[0].closestCandidate ? { ...runs[0].closestCandidate } : null);
    }
  }
});

test("column order in the file does not move the verdict", () => {
  const reversed = OPENAI.split("\n").filter(Boolean)
    .map((line) => line.split(",").reverse().join(",")).join("\n");
  const straight = detectAndNormalizeExport(OPENAI);
  const flipped = detectAndNormalizeExport(reversed);
  assert.equal(flipped.provider, straight.provider);
  assert.equal(flipped.confidence, straight.confidence);
});

// --- the hint is a cross-check, never a selector -----------------------------

test("a correct hint, a wrong hint and no hint give the same provider and confidence", () => {
  const none = detectAndNormalizeExport(VERTEX);
  const agreeing = detectAndNormalizeExport(VERTEX, { providerHint: "vertex-ai" });
  const disagreeing = detectAndNormalizeExport(VERTEX, { providerHint: "azure-openai" });
  for (const verdict of [agreeing, disagreeing]) {
    assert.equal(verdict.provider, none.provider);
    assert.equal(verdict.confidence, none.confidence);
    assert.deepEqual({ ...verdict.reason }, { ...none.reason });
  }
  assert.equal(none.hint, null);
  assert.deepEqual({ ...agreeing.hint }, { given: "vertex-ai", agreed: true });
  assert.deepEqual({ ...disagreeing.hint }, { given: "azure-openai", agreed: false });
  assert.match(describeDetection(disagreeing), /content decided the verdict/);
  assert.doesNotMatch(describeDetection(agreeing), /content decided the verdict/);
});

test("a hint cannot rescue a file the content does not recognize", () => {
  const verdict = detectAndNormalizeExport(LEDGER, { providerHint: "bedrock" });
  assert.equal(verdict.provider, null);
  assert.equal(verdict.reason.code, DETECTION_CODES.NO_COST_COLUMN);
  assert.deepEqual({ ...verdict.hint }, { given: "bedrock", agreed: false });
});

// --- shape and containment ---------------------------------------------------

test("the result is always the same four-field shape and never throws", () => {
  for (const text of [BEDROCK, LEDGER, "", "{not json", " "]) {
    const verdict = detectAndNormalizeExport(text);
    for (const field of ["provider", "confidence", "normalizedProjection", "reason"]) {
      assert.ok(field in verdict, `every result carries ${field}`);
    }
    assert.equal(typeof verdict.reason.code, "string");
    assert.equal(typeof verdict.reason.message, "string");
    assert.ok(Object.isFrozen(verdict));
  }
});

test("no cell of the reader's file reaches the result", () => {
  const verdict = detectAndNormalizeExport(BEDROCK);
  const rendered = JSON.stringify(verdict);
  for (const cell of ["000000000001", "anthropic.claude-sonnet", "4.80", "120000"]) {
    assert.ok(!rendered.includes(cell), `${cell} must not reach the verdict`);
  }
});

test("format comes from the bytes, never from a file name", () => {
  assert.equal(formatOf(BEDROCK), "csv");
  assert.equal(formatOf(VERTEX), "jsonl");
  assert.equal(formatOf(AZURE), "json");
  assert.equal(formatOf("a\tb\n1\t2\n"), "tsv");
  assert.equal(formatOf(""), "");
});
