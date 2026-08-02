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
} from "../src/native-provider-activation.js";
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
  assert.match(manifest.unsupported_shape_behavior.malformed_row, /not coerce.*zero/i);
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

test("AI FinOps compatibility view renders the contract registry and prohibitions", () => {
  const root = createElement("div");
  renderNativeProviderCompatibility(root);
  assert.equal(root.dataset.state, "ready");
  assert.equal(tags(root, "ARTICLE").length, 2);
  assert.match(root.textContent, /OpenAI organization usage export/);
  assert.match(root.textContent, /Anthropic Console usage export/);
  assert.match(root.textContent, /No network request during import/);
  assert.match(root.textContent, /native-provider-exports\/1\.0\.0/);
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
