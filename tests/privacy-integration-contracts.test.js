import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INTEGRATION_FIXTURE_URLS,
  formatIntegrationProvenance,
  inspectIntegrationFixtures,
  loadIntegrationFixtureInspection,
} from "../src/integration-contracts.js";

const ROOT = new URL("../contracts/integrations/", import.meta.url);
const INTEGRATIONS = [
  ["hris-org", "wawalu.integration.hris-org"],
  ["identity", "wawalu.integration.identity"],
  ["provider-usage-billing", "wawalu.integration.provider-usage-billing"],
];

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

for (const [directory, kind] of INTEGRATIONS) {
  test(`${directory} has a strict, privacy-preserving, versioned schema`, async () => {
    const schema = await json(new URL(`${directory}/v1/schema.json`, ROOT));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.properties.schema_version.const, "1.0");
    assert.equal(schema.properties.kind.const, kind);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.$defs.opaqueId.pattern.startsWith("^psn_"), true);
  });

  test(`${directory} fixtures cover required delivery states`, async () => {
    const fixtureRoot = new URL(`${directory}/v1/fixtures/`, ROOT);
    const valid = await json(new URL("valid.json", fixtureRoot));
    const partial = await json(new URL("partial.json", fixtureRoot));
    const stale = await json(new URL("stale.json", fixtureRoot));
    const malformed = await json(new URL("malformed.json", fixtureRoot));
    const reordered = await json(new URL("reordered.json", fixtureRoot));

    assert.equal(valid.schema_version, "1.0");
    assert.equal(valid.kind, kind);
    assert.equal(valid.snapshot.completeness, "complete");
    assert.equal(partial.snapshot.completeness, "partial");
    assert.ok(partial.snapshot.omitted_record_count > 0);
    assert.ok(partial.snapshot.issues.length > 0);
    assert.ok(Date.parse(stale.snapshot.generated_at) < Date.parse(valid.snapshot.generated_at));
    assert.ok(Array.isArray(reordered));
    assert.ok(reordered[0].snapshot.sequence > reordered[1].snapshot.sequence);
    assert.ok(malformed.export_id === "bad" || malformed.export_id === "not-a-uuid");
  });
}

test("identity fixtures exclude direct identity and provider fixtures exclude content", async () => {
  const identity = await json(new URL("identity/v1/fixtures/valid.json", ROOT));
  const provider = await json(new URL("provider-usage-billing/v1/fixtures/valid.json", ROOT));
  const serializedIdentity = JSON.stringify(identity);
  const serializedProvider = JSON.stringify(provider);

  for (const prohibited of ["email", "display_name", "phone", "employee_number"]) {
    assert.equal(serializedIdentity.includes(prohibited), false);
  }
  for (const prohibited of ["subject_id", "prompt", "response", "request_id", "api_key"]) {
    assert.equal(serializedProvider.includes(prohibited), false);
  }
  assert.equal(identity.privacy.direct_identifiers_included, false);
  assert.ok(provider.privacy.minimum_group_size >= 10);
  assert.equal(provider.privacy.content_included, false);
});

test("reordered fixtures make record revision, not arrival, authoritative", async () => {
  for (const [directory] of INTEGRATIONS) {
    const deliveries = await json(new URL(`${directory}/v1/fixtures/reordered.json`, ROOT));
    assert.ok(deliveries[0].records[0].revision > deliveries[1].records[0].revision);
  }
});

test("the demo consumes the reviewed HRIS-department and provider fixtures", async () => {
  const hris = await json(new URL("hris-org/v1/fixtures/valid.json", ROOT));
  const provider = await json(new URL("provider-usage-billing/v1/fixtures/valid.json", ROOT));
  const inspection = inspectIntegrationFixtures(hris, provider);

  assert.equal(inspection.version, "1.0");
  assert.equal(inspection.departmentCount, 1);
  assert.equal(inspection.aggregateCount, 1);
  assert.deepEqual(inspection.providers, ["openai"]);
  assert.equal(inspection.minimumGroupSize, 10);
  assert.match(formatIntegrationProvenance(inspection),
    /Contracts v1\.0 · synthetic static fixtures · 1 HRIS department · 1 daily provider aggregate \(openai\)/);
  assert.match(formatIntegrationProvenance(inspection), /no credentials or live calls/);
});

test("fixture loading is same-origin, static, and rejects malformed contract input", async () => {
  const requested = [];
  const fixtures = new Map([
    [INTEGRATION_FIXTURE_URLS.hris, await json(new URL("hris-org/v1/fixtures/valid.json", ROOT))],
    [INTEGRATION_FIXTURE_URLS.provider,
      await json(new URL("provider-usage-billing/v1/fixtures/valid.json", ROOT))],
  ]);
  const inspection = await loadIntegrationFixtureInspection(async (url, options) => {
    requested.push([url, options]);
    return { ok: true, json: async () => structuredClone(fixtures.get(url)) };
  });

  assert.equal(inspection.departmentCount, 1);
  assert.deepEqual(requested.map(([url]) => url), Object.values(INTEGRATION_FIXTURE_URLS));
  assert.ok(requested.every(([url]) => url.startsWith("/contracts/integrations/")));
  assert.ok(requested.every(([, options]) => options.cache === "no-store"));

  const malformed = await json(new URL("hris-org/v1/fixtures/malformed.json", ROOT));
  assert.throws(() => inspectIntegrationFixtures(malformed, fixtures.get(INTEGRATION_FIXTURE_URLS.provider)),
    /Unsupported or malformed/);
});

test("the AI FinOps inspection surface exposes contract provenance", async () => {
  const [page, pageScript] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id="integration-contract-provenance"/);
  assert.match(pageScript, /loadIntegrationFixtureInspection/);
  assert.match(pageScript, /Contract fixtures unavailable/);
});
