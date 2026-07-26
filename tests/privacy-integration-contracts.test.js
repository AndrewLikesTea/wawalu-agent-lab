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
const BROWSER_MANIFEST = new URL("browser-compatibility/v1/manifest.json", ROOT);
const INTEGRATIONS = [
  ["hris-org", "wawalu.integration.hris-org"],
  ["identity", "wawalu.integration.identity"],
  ["provider-usage-billing", "wawalu.integration.provider-usage-billing"],
];

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function deliveries(fixture) {
  return Array.isArray(fixture) ? fixture : [fixture];
}

function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    assert.ok(allowed.includes(key), `${label} contains unmapped field ${key}`);
  }
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
    const duplicated = await json(new URL("duplicated.json", fixtureRoot));
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
    assert.ok(Array.isArray(duplicated));
    assert.deepEqual(duplicated[0], duplicated[1]);
    assert.deepEqual(duplicated[0].records[0], duplicated[0].records[1]);
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

test("browser compatibility manifest stays pinned to authoritative contract fields", async () => {
  const manifest = await json(BROWSER_MANIFEST);
  assert.equal(manifest.manifest_version, "1.0");
  assert.equal(manifest.privacy.fixture_data, "synthetic-only");
  assert.equal(manifest.privacy.allows_live_credentials, false);
  assert.deepEqual(manifest.supported_file_formats.map(({ format }) => format), ["json"]);
  assert.ok(manifest.unsupported_file_formats.includes("csv"));
  assert.ok(manifest.unsupported_file_formats.includes("xlsx"));

  for (const [manifestKey, directory] of [
    ["provider_export", "provider-usage-billing"],
    ["hris_mapping", "hris-org"],
  ]) {
    const advertised = manifest.contracts[manifestKey];
    const schema = await json(new URL(`${directory}/v1/schema.json`, ROOT));
    assert.equal(advertised.kind, schema.properties.kind.const);
    assert.equal(advertised.schema_version, schema.properties.schema_version.const);
    assert.deepEqual(advertised.envelope_required, schema.required);
    assert.deepEqual(advertised.snapshot_required, schema.properties.snapshot.required);
    const recordSchema = manifestKey === "provider_export"
      ? schema.$defs.aggregate
      : schema.$defs.unit;
    assert.deepEqual(advertised.record_required, recordSchema.required);
    assert.equal(advertised.schema_url,
      `/contracts/integrations/${directory}/v1/schema.json`);
  }

  const providerSchema = await json(new URL("provider-usage-billing/v1/schema.json", ROOT));
  assert.deepEqual(
    manifest.contracts.provider_export.nested_required.usage,
    providerSchema.$defs.aggregate.properties.usage.required,
  );
  assert.deepEqual(
    manifest.contracts.provider_export.nested_required.cost,
    providerSchema.$defs.aggregate.properties.cost.required,
  );
  assert.deepEqual(
    manifest.contracts.hris_mapping.upsert_required,
    ["parent_unit_id", "unit_type", "active"],
  );
  assert.match(manifest.join_requirements[0].on_missing, /never assign a default unit/);
});

test("browser fixture matrix conforms to contracts and actionable outcomes", async () => {
  const manifest = await json(BROWSER_MANIFEST);
  const expectedScenarios = ["valid", "partial", "stale", "duplicated", "reordered", "malformed"];
  assert.deepEqual(manifest.fixtures.map(({ scenario }) => scenario), expectedScenarios);
  assert.deepEqual(Object.keys(manifest.validation_reasons).sort(), [...expectedScenarios].sort());

  const schemas = {
    provider_export: await json(new URL("provider-usage-billing/v1/schema.json", ROOT)),
    hris_mapping: await json(new URL("hris-org/v1/schema.json", ROOT)),
  };
  for (const fixtureEntry of manifest.fixtures) {
    assert.equal(
      fixtureEntry.expected_code,
      manifest.validation_reasons[fixtureEntry.scenario].code,
    );
    for (const [contractKey, urlKey] of [
      ["provider_export", "provider_url"],
      ["hris_mapping", "hris_url"],
    ]) {
      assert.ok(fixtureEntry[urlKey].startsWith("/contracts/integrations/"));
      const fixture = await json(new URL(fixtureEntry[urlKey].replace(
        "/contracts/integrations/", ""), ROOT));
      const schema = schemas[contractKey];
      for (const delivery of deliveries(fixture)) {
        if (!fixtureEntry.schema_valid) {
          assert.notEqual(delivery.export_id.length, 36);
          continue;
        }
        assert.equal(delivery.schema_version, schema.properties.schema_version.const);
        assert.equal(delivery.kind, schema.properties.kind.const);
        assertExactKeys(delivery, Object.keys(schema.properties), `${fixtureEntry.scenario} envelope`);
        for (const required of schema.required) assert.ok(required in delivery);
        assertExactKeys(delivery.snapshot, Object.keys(schema.properties.snapshot.properties),
          `${fixtureEntry.scenario} snapshot`);
        for (const required of schema.properties.snapshot.required) {
          assert.ok(required in delivery.snapshot);
        }
        const recordSchema = contractKey === "provider_export"
          ? schema.$defs.aggregate
          : schema.$defs.unit;
        for (const record of delivery.records) {
          assertExactKeys(record, Object.keys(recordSchema.properties),
            `${fixtureEntry.scenario} record`);
          for (const required of recordSchema.required) assert.ok(required in record);
          if (contractKey === "provider_export") {
            assert.ok(delivery.privacy.minimum_group_size >= 10);
            assert.equal(delivery.privacy.direct_identifiers_included, false);
            assert.equal(delivery.privacy.content_included, false);
          } else {
            assert.equal(delivery.privacy.direct_identifiers_included, false);
            if (record.operation === "upsert") {
              for (const required of manifest.contracts.hris_mapping.upsert_required) {
                assert.ok(required in record);
              }
            }
          }
        }
      }
    }
  }
});

test("valid provider attribution uses an exact synthetic HRIS unit mapping", async () => {
  const manifest = await json(BROWSER_MANIFEST);
  const fixtureEntry = manifest.fixtures.find(({ scenario }) => scenario === "valid");
  const provider = await json(new URL(fixtureEntry.provider_url.replace(
    "/contracts/integrations/", ""), ROOT));
  const hris = await json(new URL(fixtureEntry.hris_url.replace(
    "/contracts/integrations/", ""), ROOT));
  const activeUnits = new Set(hris.records
    .filter(({ operation, active }) => operation === "upsert" && active)
    .map(({ unit_id }) => unit_id));

  assert.ok(provider.records.length > 0);
  assert.ok(provider.records.every(({ org_unit_id }) => activeUnits.has(org_unit_id)));
  assert.ok(provider.records.every(({ org_unit_id }) => org_unit_id.startsWith("psn_")));
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
  assert.match(page, /id="integration-gateway-refresh"/);
  assert.match(pageScript, /createStaticGateway/);
  assert.match(pageScript, /Gateway unavailable/);
  assert.match(pageScript, /Gateway pending/);
  assert.match(pageScript, /Gateway completed/);
});
