// Static contract-fixture inspection for the AI FinOps demo. These same-origin
// JSON files are copied into the build artifact; this module has no live
// provider/HRIS endpoint, credential, customer-data, or prompt-data path.

export const INTEGRATION_FIXTURE_URLS = Object.freeze({
  hris: "/contracts/integrations/hris-org/v1/fixtures/valid.json",
  provider: "/contracts/integrations/provider-usage-billing/v1/fixtures/valid.json",
});

const KINDS = Object.freeze({
  hris: "wawalu.integration.hris-org",
  provider: "wawalu.integration.provider-usage-billing",
});

function assertFixture(fixture, kind) {
  if (!fixture || fixture.schema_version !== "1.0" || fixture.kind !== kind
      || fixture.snapshot?.completeness !== "complete" || !Array.isArray(fixture.records)) {
    throw new TypeError(`Unsupported or malformed ${kind} demo fixture.`);
  }
  return fixture;
}

export function inspectIntegrationFixtures(hrisInput, providerInput) {
  const hris = assertFixture(hrisInput, KINDS.hris);
  const provider = assertFixture(providerInput, KINDS.provider);
  const departments = hris.records.filter((record) =>
    record.operation === "upsert" && record.active && record.unit_type === "department");

  return Object.freeze({
    version: hris.schema_version,
    hrisExportId: hris.export_id,
    providerExportId: provider.export_id,
    departmentCount: departments.length,
    aggregateCount: provider.records.length,
    providers: [...new Set(provider.records.map((record) => record.provider))],
    minimumGroupSize: provider.privacy?.minimum_group_size,
  });
}

export function formatIntegrationProvenance(inspection) {
  const providers = inspection.providers.length ? inspection.providers.join(", ") : "none";
  return `Contracts v${inspection.version} · synthetic static fixtures · `
    + `${inspection.departmentCount} HRIS department · `
    + `${inspection.aggregateCount} daily provider aggregate (${providers}) · `
    + `minimum group ${inspection.minimumGroupSize} · no credentials or live calls`;
}

async function fetchFixture(fetcher, url) {
  const response = await fetcher(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Contract fixture returned ${response.status}`);
  return response.json();
}

export async function loadIntegrationFixtureInspection(fetcher = fetch) {
  const [hris, provider] = await Promise.all([
    fetchFixture(fetcher, INTEGRATION_FIXTURE_URLS.hris),
    fetchFixture(fetcher, INTEGRATION_FIXTURE_URLS.provider),
  ]);
  return inspectIntegrationFixtures(hris, provider);
}
