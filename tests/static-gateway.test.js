import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createStaticGateway } from "../src/static-gateway.js";
import { STATIC_GATEWAY_FIXTURES } from "../src/static-gateway-fixtures.js";

function controlledGateway(fixtures = STATIC_GATEWAY_FIXTURES) {
  let release;
  const gateway = createStaticGateway({
    fixtures,
    schedule: () => new Promise((resolve) => { release = resolve; }),
  });
  return { gateway, complete: () => release() };
}

test("the static gateway exposes deterministic pending and completed transitions", async () => {
  const { gateway, complete } = controlledGateway();
  const states = [];
  gateway.subscribe((state) => states.push(state));

  const firstRefresh = gateway.refresh();
  assert.equal(gateway.snapshot().status, "pending");
  assert.equal(gateway.snapshot().metadata.failureState, "none");
  complete();
  await firstRefresh;

  assert.deepEqual(states.map(({ status }) => status), ["unavailable", "pending", "completed"]);
  const first = gateway.snapshot();
  assert.equal(first.inspection.departmentCount, 1);
  assert.equal(first.inspection.aggregateCount, 1);

  const secondRefresh = gateway.refresh();
  complete();
  await secondRefresh;
  assert.deepEqual(gateway.snapshot(), first);
});

test("sampling metadata is explicit, immutable, and derived only from fixtures", async () => {
  const gateway = createStaticGateway();
  const state = await gateway.refresh();

  assert.deepEqual(state.metadata, {
    sourceType: "bundled static contract fixtures",
    sampleWindow: "2026-07-24 to 2026-07-25",
    freshness: "current",
    generatedAt: "2026-07-25T12:00:00Z",
    failureState: "none",
  });
  assert.equal(Object.isFrozen(state.metadata), true);
});

test("the browser projection remains pinned to Anya's reviewed fixture metadata", async () => {
  const root = new URL("../contracts/integrations/", import.meta.url);
  const hris = JSON.parse(await readFile(new URL("hris-org/v1/fixtures/valid.json", root), "utf8"));
  const provider = JSON.parse(await readFile(
    new URL("provider-usage-billing/v1/fixtures/valid.json", root), "utf8"));

  for (const [projected, reviewed] of [
    [STATIC_GATEWAY_FIXTURES.hris, hris],
    [STATIC_GATEWAY_FIXTURES.provider, provider],
  ]) {
    assert.equal(projected.schema_version, reviewed.schema_version);
    assert.equal(projected.kind, reviewed.kind);
    assert.equal(projected.export_id, reviewed.export_id);
    assert.deepEqual(projected.snapshot, {
      generated_at: reviewed.snapshot.generated_at,
      ...(reviewed.snapshot.period_start && { period_start: reviewed.snapshot.period_start }),
      ...(reviewed.snapshot.period_end && { period_end: reviewed.snapshot.period_end }),
      completeness: reviewed.snapshot.completeness,
    });
  }
});

test("invalid bundled input fails closed without a fallback transport", async () => {
  const fixtures = {
    ...STATIC_GATEWAY_FIXTURES,
    provider: { ...STATIC_GATEWAY_FIXTURES.provider, schema_version: "2.0" },
  };
  const { gateway, complete } = controlledGateway(fixtures);
  const refresh = gateway.refresh();
  assert.equal(gateway.snapshot().status, "pending");
  complete();
  const state = await refresh;

  assert.equal(state.status, "unavailable");
  assert.equal(state.inspection, null);
  assert.equal(state.metadata.failureState, "fixture_validation_failed");
});

test("an asynchronous processing failure becomes unavailable", async () => {
  const gateway = createStaticGateway({
    schedule: () => Promise.reject(new Error("simulated failure")),
  });
  const state = await gateway.refresh();
  assert.equal(state.status, "unavailable");
  assert.equal(state.metadata.failureState, "gateway_processing_failed");
});
