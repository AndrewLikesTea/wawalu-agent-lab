// Deterministic bundled fixtures for the compatibility check. Every date is
// hardcoded, no value is generated at load time, and nothing here reads a clock
// or a locale. FIXTURE_REFERENCE_DATE is the date callers pass as the freshness
// reference so a fixture's verdict is the same on every machine on every day.
//
// No fixture contains prompt text, completion text, or a user identifier. The
// prompt-content fixtures carry the FIELD, with a withheld placeholder in it —
// that is the whole signal the contract rejects on.

import { DEGRADED_CODES, UNSUPPORTED_CODES } from "./browser-compat-contracts.js";

export const FIXTURE_REFERENCE_DATE = "2026-08-01";

const WITHHELD = "(withheld by fixture)";

const csv = (header, rows) => `${[header, ...rows].map((row) => row.join(",")).join("\n")}\n`;
const jsonl = (records) => `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
const envelope = (records) => JSON.stringify({ properties: { rows: records } });

const dropColumn = (header, rows, column) => {
  const index = header.indexOf(column);
  const keep = (row) => row.filter((_, position) => position !== index);
  return [keep(header), rows.map(keep)];
};
const addColumn = (header, rows, column, value) =>
  [[...header, column], rows.map((row) => [...row, value])];

const dropPath = (record, path) => {
  const [head, ...rest] = path.split(".");
  if (!rest.length) { const { [head]: _drop, ...kept } = record; return kept; }
  return { ...record, [head]: dropPath(record[head], rest.join(".")) };
};
const omit = (records, path) => records.map((record) => dropPath(record, path));
const withField = (records, key, value) => records.map((record) => ({ ...record, [key]: value }));

// ---------------------------------------------------------------- bedrock

const BEDROCK_HEADER = ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
  "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId", "product/region"];
const bedrockRow = (date, model, units, cost) =>
  [date, model, units, cost, "USD", "000000000001", "us-east-1"];
const BEDROCK_ROWS = [
  bedrockRow("2026-07-20", "anthropic.claude-sonnet", "120000", "4.80"),
  bedrockRow("2026-07-21", "amazon.titan-text", "45000", "0.90"),
  bedrockRow("2026-07-22", "anthropic.claude-sonnet", "98000", "3.92"),
];

// ---------------------------------------------------------------- vertex ai

const vertexRecord = (date, model, amount, cost) => ({
  usage_start_time: date,
  sku: { model_id: model, description: "Vertex AI generative input" },
  usage: { amount, unit: "tokens" },
  cost,
  currency: "USD",
  project: { id: "proj-synthetic-01" },
});
const VERTEX_RECORDS = [
  vertexRecord("2026-07-20", "gemini-1.5-pro", 210000, 6.3),
  vertexRecord("2026-07-21", "gemini-1.5-flash", 480000, 1.44),
  vertexRecord("2026-07-22", "gemini-1.5-pro", 165000, 4.95),
];

// ---------------------------------------------------------------- azure

const azureRecord = (date, meter, quantity, cost) => ({
  date,
  meterName: meter,
  meterSubCategory: "Azure OpenAI",
  quantity,
  costInBillingCurrency: cost,
  billingCurrency: "USD",
  resourceId: "/subscriptions/00000000-0000-0000-0000-000000000000/openai-synthetic",
  resourceGroup: "rg-synthetic",
});
const AZURE_RECORDS = [
  azureRecord("2026-07-20", "gpt-4o-mini Input Tokens", 180000, 2.7),
  azureRecord("2026-07-21", "gpt-4o Output Tokens", 24000, 3.6),
  azureRecord("2026-07-22", "gpt-4o-mini Input Tokens", 152000, 2.28),
];

// The three date sets each variant reuses, written out rather than computed so
// a reader can check the expected verdict by eye.
const GAP = ["2026-07-20", "2026-07-22"];
const OLD = ["2026-05-01", "2026-05-02", "2026-05-03"];
const SHUFFLED = [2, 0, 1];

const pick = (rows, indexes) => indexes.map((index) => rows[index]);
const redate = (rows, dates, at) => dates.map((date, index) => {
  const row = [...rows[index % rows.length]];
  row[at] = date;
  return row;
});
const redateRecords = (records, dates, set) => dates.map((date, index) =>
  set(records[index % records.length], date));

const entry = (providerId, caseCode, label, fileName, text) =>
  Object.freeze({ id: `${providerId}-${caseCode ?? "supported"}`, providerId, caseCode, label, fileName, text });

function bedrockFixtures() {
  const H = BEDROCK_HEADER;
  const R = BEDROCK_ROWS;
  const malformed = [R[0], bedrockRow("2026-07-21", "amazon.titan-text", "45000", "n/a"), R[1], R[2]];
  return [
    entry("bedrock", null, "Bedrock · representative Cost and Usage Report", "bedrock-usage.csv", csv(H, R)),
    entry("bedrock", UNSUPPORTED_CODES.WRONG_PROVIDER, "Bedrock · a Vertex AI export submitted by mistake",
      "vertex-usage.jsonl", jsonl(VERTEX_RECORDS)),
    entry("bedrock", UNSUPPORTED_CODES.UNMODELED_VARIANT, "Bedrock · report configured without a currency column",
      "bedrock-no-currency.csv", csv(...dropColumn(H, R, "lineItem/CurrencyCode"))),
    entry("bedrock", UNSUPPORTED_CODES.PROMPT_CONTENT, "Bedrock · invocation log carrying a prompt column",
      "bedrock-invocations.csv", csv(...addColumn(H, R, "prompt_text", WITHHELD))),
    entry("bedrock", UNSUPPORTED_CODES.ROLLUP_ONLY, "Bedrock · monthly service rollup with no model column",
      "bedrock-rollup.csv", csv(...dropColumn(H, R, "product/model_id"))),
    entry("bedrock", UNSUPPORTED_CODES.EMPTY, "Bedrock · header row and nothing under it",
      "bedrock-empty.csv", csv(H, [])),
    entry("bedrock", DEGRADED_CODES.PARTIAL, "Bedrock · a period with one day missing",
      "bedrock-partial.csv", csv(H, redate(R, GAP, 0))),
    entry("bedrock", DEGRADED_CODES.STALE, "Bedrock · an export from an old billing period",
      "bedrock-stale.csv", csv(H, redate(R, OLD, 0))),
    entry("bedrock", DEGRADED_CODES.MALFORMED_ROWS, "Bedrock · one row with an unreadable cost",
      "bedrock-malformed.csv", csv(H, malformed)),
    entry("bedrock", DEGRADED_CODES.REORDERED, "Bedrock · the same rows in non-chronological order",
      "bedrock-reordered.csv", csv(H, pick(R, SHUFFLED))),
  ];
}

function vertexFixtures() {
  const R = VERTEX_RECORDS;
  const setDate = (record, date) => ({ ...record, usage_start_time: date });
  const malformed = [R[0], { ...R[1], cost: "n/a" }, R[1], R[2]];
  return [
    entry("vertex-ai", null, "Vertex AI · representative detailed usage cost", "vertex-usage.jsonl", jsonl(R)),
    entry("vertex-ai", UNSUPPORTED_CODES.WRONG_PROVIDER, "Vertex AI · an Azure OpenAI export submitted by mistake",
      "azure-costs.json", envelope(AZURE_RECORDS)),
    entry("vertex-ai", UNSUPPORTED_CODES.UNMODELED_VARIANT, "Vertex AI · standard usage cost, which omits currency",
      "vertex-standard.jsonl", jsonl(omit(R, "currency"))),
    entry("vertex-ai", UNSUPPORTED_CODES.PROMPT_CONTENT, "Vertex AI · request log carrying a prompt field",
      "vertex-requests.jsonl", jsonl(withField(R, "prompt", WITHHELD))),
    entry("vertex-ai", UNSUPPORTED_CODES.ROLLUP_ONLY, "Vertex AI · project cost summary with no model id",
      "vertex-rollup.jsonl", jsonl(omit(R, "sku.model_id"))),
    entry("vertex-ai", UNSUPPORTED_CODES.EMPTY, "Vertex AI · an export with no lines in it",
      "vertex-empty.jsonl", ""),
    entry("vertex-ai", DEGRADED_CODES.PARTIAL, "Vertex AI · a period with one day missing",
      "vertex-partial.jsonl", jsonl(redateRecords(R, GAP, setDate))),
    entry("vertex-ai", DEGRADED_CODES.STALE, "Vertex AI · an export from an old billing period",
      "vertex-stale.jsonl", jsonl(redateRecords(R, OLD, setDate))),
    entry("vertex-ai", DEGRADED_CODES.MALFORMED_ROWS, "Vertex AI · one record with an unreadable cost",
      "vertex-malformed.jsonl", jsonl(malformed)),
    entry("vertex-ai", DEGRADED_CODES.REORDERED, "Vertex AI · the same records in non-chronological order",
      "vertex-reordered.jsonl", jsonl(pick(R, SHUFFLED))),
  ];
}

function azureFixtures() {
  const R = AZURE_RECORDS;
  const setDate = (record, date) => ({ ...record, date });
  const malformed = [R[0], { ...R[1], costInBillingCurrency: "n/a" }, R[1], R[2]];
  return [
    entry("azure-openai", null, "Azure OpenAI · representative actual cost export", "azure-costs.json", envelope(R)),
    entry("azure-openai", UNSUPPORTED_CODES.WRONG_PROVIDER, "Azure OpenAI · a Bedrock export submitted by mistake",
      "bedrock-usage.csv", csv(BEDROCK_HEADER, BEDROCK_ROWS)),
    entry("azure-openai", UNSUPPORTED_CODES.UNMODELED_VARIANT, "Azure OpenAI · export configured without a currency column",
      "azure-no-currency.json", envelope(omit(R, "billingCurrency"))),
    entry("azure-openai", UNSUPPORTED_CODES.PROMPT_CONTENT, "Azure OpenAI · audit export carrying a completion field",
      "azure-audit.json", envelope(withField(R, "completion", WITHHELD))),
    entry("azure-openai", UNSUPPORTED_CODES.ROLLUP_ONLY, "Azure OpenAI · subscription total with no meter name",
      "azure-rollup.json", envelope(omit(R, "meterName"))),
    entry("azure-openai", UNSUPPORTED_CODES.EMPTY, "Azure OpenAI · an envelope with no rows",
      "azure-empty.json", envelope([])),
    entry("azure-openai", DEGRADED_CODES.PARTIAL, "Azure OpenAI · a period with one day missing",
      "azure-partial.json", envelope(redateRecords(R, GAP, setDate))),
    entry("azure-openai", DEGRADED_CODES.STALE, "Azure OpenAI · an export from an old billing period",
      "azure-stale.json", envelope(redateRecords(R, OLD, setDate))),
    entry("azure-openai", DEGRADED_CODES.MALFORMED_ROWS, "Azure OpenAI · one row with an unreadable cost",
      "azure-malformed.json", envelope(malformed)),
    entry("azure-openai", DEGRADED_CODES.REORDERED, "Azure OpenAI · the same rows in non-chronological order",
      "azure-reordered.json", envelope(pick(R, SHUFFLED))),
  ];
}

export const BROWSER_COMPAT_FIXTURES = Object.freeze([
  ...bedrockFixtures(), ...vertexFixtures(), ...azureFixtures(),
]);

// An export that is not any of the three, used to prove the no-match verdict is
// distinct rather than the nearest provider.
export const UNRECOGNIZED_FIXTURE = Object.freeze({
  id: "unrecognized", providerId: null, caseCode: null,
  label: "Not a supported export · a generic finance ledger",
  fileName: "ledger.csv",
  text: csv(["posting_date", "gl_account", "amount", "currency"],
    [["2026-07-20", "6100-software", "482.10", "USD"],
      ["2026-07-21", "6100-software", "133.75", "USD"]]),
});

export const fixturesForProvider = (providerId) =>
  BROWSER_COMPAT_FIXTURES.filter((fixture) => fixture.providerId === providerId);
