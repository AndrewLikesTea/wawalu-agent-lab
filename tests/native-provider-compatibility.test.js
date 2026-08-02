import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { detectDialect, normalizeTable } from "../src/dialect-detection.js";
import { profileById } from "../src/dialect-profiles.js";
import {
  NATIVE_PROVIDER_BOUNDARY, NATIVE_PROVIDER_COMPATIBILITY, NATIVE_PROVIDER_CONTRACT_VERSION,
} from "../src/native-provider-compatibility.js";
import { renderNativeProviderCompatibility } from "../src/native-provider-compatibility-view.js";
import {
  assessNativeProviderActivation, NATIVE_ACTIVATION_STATUS,
  nativeContractForHeader, NATIVE_REQUIRED_FIELD_CODE,
} from "../src/native-provider-activation.js";
import { parseLocalImportFile } from "../src/finops-tabular-import.js";
import { createElement, installDocument, tags } from "./support/dom.js";
import { readTable } from "./support/tabular.js";

installDocument();
const ROOT = new URL("../contracts/integrations/native-provider-exports/v1/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", ROOT), "utf8"));

async function table(name) {
  return readTable(await readFile(new URL(`fixtures/${name}`, ROOT), "utf8"));
}

test("native provider contract is versioned, bounded, and pinned to executable adapters", () => {
  assert.equal(manifest.contract_version, NATIVE_PROVIDER_CONTRACT_VERSION);
  assert.deepEqual(manifest.formats, ["csv-utf8-with-header"]);
  assert.deepEqual(manifest.providers.map(({ id }) => id),
    NATIVE_PROVIDER_COMPATIBILITY.map(({ id }) => id));
  for (const provider of manifest.providers) {
    const profile = profileById(provider.id);
    const view = NATIVE_PROVIDER_COMPATIBILITY.find(({ id }) => id === provider.id);
    assert.equal(provider.adapter_version, profile.version);
    assert.equal(view.adapterVersion, profile.version);
    assert.deepEqual(provider.required_columns,
      profile.columns.filter(({ required }) => required).map(({ source }) => source));
    assert.deepEqual(provider.optional_columns,
      profile.columns.filter(({ required }) => !required).map(({ source }) => source));
    assert.deepEqual(view.required, provider.required_columns);
    assert.deepEqual(view.optional, provider.optional_columns);
  }
});

test("contract states privacy and failure boundaries without a live integration", () => {
  const policy = JSON.stringify(manifest.privacy_and_runtime);
  for (const word of ["credentials", "network", "prompt", "persisted", "live provider", "HRIS", "identity"]) {
    assert.match(policy, new RegExp(word, "i"));
  }
  assert.match(manifest.unsupported_shape_behavior.partial_export, /partial evidence/i);
  assert.match(manifest.unsupported_shape_behavior.stale_export, /freshness as unknown/i);
  // The published document and the rendered registry state the same rule: a
  // reader who trusts the manifest must not meet a different adapter.
  assert.match(manifest.unsupported_shape_behavior.malformed_row,
    /reject the whole native export.*not coerce.*zero/i);
  assert.match(NATIVE_PROVIDER_COMPATIBILITY[0].behavior.malformed, /rejects the native export/i);
  assert.match(manifest.unsupported_shape_behavior.reordered_columns, /header name/i);
  assert.equal(NATIVE_PROVIDER_BOUNDARY.length, 5);
});

test("supported, missing-required, and unknown-format fixtures have deterministic outcomes", async () => {
  const supported = normalizeTable(await table("openai-supported.csv"));
  assert.equal(supported.detection.status, "matched");
  assert.equal(supported.detection.profileId, "openai-usage-export");
  assert.deepEqual(supported.normalized.records, [{
    usage_date: "2026-07-01", sku: "gpt-demo", owner_id: "synthetic-platform",
    usage_quantity: 1200, usage_unit: "tokens", cost_amount_minor: 125, cost_currency: "USD",
  }]);

  const missing = detectDialect(await table("anthropic-missing-required.csv"));
  assert.equal(missing.status, "unidentified");
  assert.match(missing.reason, /required columns/);
  const unknown = detectDialect(await table("unknown-format.csv"));
  assert.equal(unknown.status, "unidentified");
  assert.match(unknown.reason, /no profile/);
});

test("activation distinguishes direct analysis, incomplete native export, and manual formats", async () => {
  const supported = assessNativeProviderActivation({
    header: (await table("openai-supported.csv")).columns,
    rows: (await table("openai-supported.csv")).rows.map((values) => ({ values })),
  });
  assert.equal(supported.status, NATIVE_ACTIVATION_STATUS.SUPPORTED);
  assert.equal(supported.providerId, "openai-usage-export");
  assert.match(supported.message, /manual column mapping is not required/i);

  const incompleteTable = await table("anthropic-missing-required.csv");
  const incomplete = assessNativeProviderActivation({
    header: incompleteTable.columns, rows: incompleteTable.rows.map((values) => ({ values })),
  });
  assert.equal(incomplete.status, NATIVE_ACTIVATION_STATUS.INCOMPLETE);
  assert.match(incomplete.message, /missing required column.*cost_usd/i);

  assert.equal(assessNativeProviderActivation({
    header: ["day", "team", "sku", "spend"], rows: [],
  }).status, NATIVE_ACTIVATION_STATUS.NOT_NATIVE);
});

test("native adapters normalize only contract fields into canonical analysis input", async () => {
  const text = await readFile(new URL("fixtures/openai-supported.csv", ROOT), "utf8");
  const parsed = parseLocalImportFile(text, "native.csv", "text/csv", {
    generatedAt: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(parsed.type, "provider");
  assert.equal(parsed.shape, "openai_usage");
  assert.equal(parsed.document.records.length, 1);
  assert.equal(parsed.document.records[0].usage.quantity, 1200);
  assert.equal(parsed.document.records[0].cost.amount_minor, 125);
  assert.equal(parsed.document.snapshot.period_start, "2026-07-01");
  assert.equal(parsed.document.snapshot.period_end, "2026-07-02");
  assert.doesNotMatch(JSON.stringify(parsed.document), /api_key_name|n_generated_tokens_total/);
});

const OPENAI_NATIVE = "usage_date,model,project,n_context_tokens_total,amount,currency";
const ANTHROPIC_NATIVE = "date,model,workspace,input_tokens,cost_usd,currency";
const nativeCsv = (header, ...rows) => [header, ...rows].join("\n");
const rejection = (text, name = "native.csv") => {
  let thrown = null;
  assert.throws(() => parseLocalImportFile(text, name, "text/csv"), (error) => {
    thrown = error;
    return true;
  });
  return thrown;
};

test("one invalid required cell rejects a mixed native export without partial analysis", () => {
  const error = rejection(nativeCsv(OPENAI_NATIVE,
    "2026-07-01,gpt-demo,synthetic-platform,1200,1.25,USD",
    "2026-07-02,gpt-demo,synthetic-platform,900,,USD"), "mixed.csv");
  assert.equal(error.code, NATIVE_REQUIRED_FIELD_CODE);
  // The blocking problem locates the file's own row and column, and the
  // normalizer's finding survives behind it as the detail.
  assert.deepEqual(error.problems[0], {
    code: NATIVE_REQUIRED_FIELD_CODE, row: 3, column: "amount", columnIndex: 4,
    providerId: "openai-usage-export", reason: "invalid_amount",
  });
  assert.equal(error.problems[1].code, "invalid_amount");
  assert.equal(error.problems[1].reason, "empty");
});

test("an ambiguous printed date rejects a native export rather than guessing its month", () => {
  const error = rejection(nativeCsv(ANTHROPIC_NATIVE,
    "2026-04-03,claude-demo,synthetic,40,0.25,USD",
    "03/04/2026,claude-demo,synthetic,40,0.25,USD"), "ambiguous.csv");
  assert.equal(error.code, NATIVE_REQUIRED_FIELD_CODE);
  assert.deepEqual(error.problems[0], {
    code: NATIVE_REQUIRED_FIELD_CODE, row: 3, column: "date", columnIndex: 0,
    providerId: "anthropic-usage-export", reason: "date_printed_as_numeric_month_first",
  });
});

// The gate and the normalizer must agree about every printed value, because a
// gate with its own idea of "valid" fails in both directions: a value only the
// gate accepts is skipped downstream — reopening partial analysis behind a
// passed gate — and a value only the normalizer accepts refuses a good export.
test("the native gate accepts exactly the amounts the normalizer can read", () => {
  const parsed = parseLocalImportFile(nativeCsv(OPENAI_NATIVE,
    "2026-07-01,gpt-demo,synthetic-platform,1200,\"$1,200.50\",USD"), "grouped.csv", "text/csv");
  assert.equal(parsed.document.records[0].cost.amount_minor, 120_050,
    "a printed amount the normalizer reads must not be refused by the gate");

  // A decimal comma is refused by `toMinorUnits` because 1,25 is 1.25 in one
  // locale and 125 in another. The whole export goes back, rather than one row
  // quietly leaving the total.
  const error = rejection(nativeCsv(OPENAI_NATIVE,
    "2026-07-01,gpt-demo,synthetic-platform,1200,1.25,USD",
    "2026-07-02,gpt-demo,synthetic-platform,900,\"0,75\",USD"), "decimal-comma.csv");
  assert.equal(error.code, NATIVE_REQUIRED_FIELD_CODE);
  assert.equal(error.problems[0].row, 3);
  assert.equal(error.problems[0].column, "amount");
});

test("a blank cell in a native currency column is refused, not defaulted to USD", () => {
  const error = rejection(nativeCsv(OPENAI_NATIVE,
    "2026-07-01,gpt-demo,synthetic-platform,1200,1.25,"), "blank-currency.csv");
  assert.equal(error.problems[0].reason, "currency_missing");
  assert.equal(error.problems[0].column, "currency");
  // The same export without the column at all keeps the contract's one
  // permitted default, so the demo path is not broken by the stricter rule.
  const parsed = parseLocalImportFile(nativeCsv(
    "usage_date,model,project,n_context_tokens_total,amount",
    "2026-07-01,gpt-demo,synthetic-platform,1200,1.25"), "no-currency.csv", "text/csv");
  assert.equal(parsed.document.records[0].cost.currency, "USD");
});

test("aliases remain in manual mapping and cannot activate the bounded native adapter", () => {
  // One predicate decides both answers: the banner that promises direct
  // analysis and the import gate that enforces the promise cannot disagree.
  const header = ["usage_date", "model", "project", "input_tokens", "cost_usd"];
  assert.equal(nativeContractForHeader(header), null);
  assert.equal(assessNativeProviderActivation({ header, rows: [] }).status,
    NATIVE_ACTIVATION_STATUS.NOT_NATIVE);
});

test("AI FinOps compatibility view renders the contract registry and prohibitions", () => {
  const root = createElement("div");
  renderNativeProviderCompatibility(root);
  assert.equal(root.dataset.state, "ready");
  assert.equal(tags(root, "ARTICLE").length, 2);
  assert.match(root.textContent, /OpenAI organization usage export/);
  assert.match(root.textContent, /Anthropic Console usage export/);
  assert.match(root.textContent, /No network request during import/);
  assert.ok(root.textContent.includes(NATIVE_PROVIDER_CONTRACT_VERSION));
  // The all-or-nothing rule is stated on the panel, not only in the error a
  // reader meets after a rejected import.
  assert.equal(root.textContent.match(/rejects the native export/g).length, 2);
});

test("the existing intake entry imports, renders, and links the compatibility contract", async () => {
  const [html, page] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="native-provider-compatibility"/);
  assert.match(html, /native-provider-exports\/v1\/manifest\.json/);
  assert.match(page, /import \{ renderNativeProviderCompatibility \}/);
  assert.match(page, /renderNativeProviderCompatibility\(document\.getElementById/);
});
