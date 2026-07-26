import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STATIC_GATEWAY_FIXTURES } from "../src/static-gateway-fixtures.js";
import { createStaticGatewaySimulator, gatewayStateCopy } from "../src/static-gateway.js";

function controlledGateway() {
  const scheduled = [];
  return {
    scheduled,
    gateway: createStaticGatewaySimulator({ schedule: (complete) => scheduled.push(complete) }),
  };
}

test("refresh transitions from pending to completed asynchronously", async () => {
  const { gateway, scheduled } = controlledGateway();
  const transitions = [];
  const refresh = gateway.refresh((state) => transitions.push(state.state));

  assert.equal(refresh.pending.state, "pending");
  assert.equal(gateway.current().state, "pending");
  assert.deepEqual(transitions, ["pending"]);

  scheduled.shift()();
  const completed = await refresh.settled;
  assert.equal(completed.state, "completed");
  assert.equal(completed.refreshNumber, 1);
  assert.deepEqual(transitions, ["pending", "completed"]);
});

test("fixture replay exposes deterministic sampling and failure metadata", async () => {
  const { gateway, scheduled } = controlledGateway();
  const outcomes = [];

  for (let index = 0; index < STATIC_GATEWAY_FIXTURES.length + 1; index += 1) {
    const refresh = gateway.refresh();
    scheduled.shift()();
    outcomes.push(await refresh.settled);
  }

  assert.deepEqual(outcomes.map(({ state }) => state),
    ["completed", "unavailable", "unavailable", "completed"]);
  assert.equal(outcomes[0].sourceType, "daily-org-unit-service");
  assert.equal(outcomes[0].sampleWindow, "2026-07-24 through 2026-07-25");
  assert.match(outcomes[0].freshness, /current/);
  assert.equal(outcomes[0].failureState, "none");
  assert.match(outcomes[1].failureState, /group_suppressed/);
  assert.match(outcomes[2].freshness, /stale/);
  assert.equal(outcomes[3].fixture, outcomes[0].fixture);
});

test("new simulators replay the same result without clock, storage, or randomness", async () => {
  async function firstOutcome() {
    const { gateway, scheduled } = controlledGateway();
    const refresh = gateway.refresh();
    scheduled.shift()();
    return refresh.settled;
  }
  assert.deepEqual(await firstOutcome(), await firstOutcome());
});

test("a superseded refresh cannot overwrite the latest request", async () => {
  const { gateway, scheduled } = controlledGateway();
  const first = gateway.refresh();
  const second = gateway.refresh();

  scheduled.shift()();
  await first.settled;
  assert.equal(gateway.current().state, "pending");
  assert.equal(gateway.current().refreshNumber, 2);

  scheduled.shift()();
  assert.equal((await second.settled).state, "unavailable");
  assert.equal(gateway.current().refreshNumber, 2);
});

test("browser metadata projection matches Anya's bundled contract fixtures", async () => {
  const fixtureRoot = new URL("../contracts/integrations/provider-usage-billing/v1/fixtures/", import.meta.url);
  const names = ["valid.json", "partial.json", "stale.json"];

  for (const [index, name] of names.entries()) {
    const contract = JSON.parse(await readFile(new URL(name, fixtureRoot), "utf8"));
    const projected = STATIC_GATEWAY_FIXTURES[index];
    assert.equal(projected.fixture.endsWith(name), true);
    assert.equal(projected.sourceType, contract.privacy.aggregation);
    assert.match(projected.sampleWindow,
      new RegExp(`${contract.snapshot.period_start} through ${contract.snapshot.period_end}`));
    assert.match(projected.freshness, new RegExp(contract.snapshot.generated_at.slice(0, 10)));
    if (contract.snapshot.completeness === "partial")
      assert.match(projected.failureState, new RegExp(contract.snapshot.issues[0].code));
  }
});

test("state copy distinguishes pending, completed, and unavailable without color", () => {
  assert.equal(gatewayStateCopy({ state: "pending" }).label, "Pending");
  assert.equal(gatewayStateCopy({ state: "completed", sampleCount: 1 }).label, "Completed");
  assert.equal(gatewayStateCopy({ state: "unavailable" }).label, "Unavailable");
});

test("the accessible UI is wired to the client-only simulator", async () => {
  const [page, pageScript, gatewayScript] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/static-gateway.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id="gateway-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(page, /<button[^>]*id="gateway-refresh"[^>]*type="button"/);
  for (const id of ["gateway-source-type", "gateway-sample-window", "gateway-freshness", "gateway-failure-state"])
    assert.match(page, new RegExp(`id="${id}"`));
  assert.match(pageScript, /createStaticGatewaySimulator/);
  assert.doesNotMatch(gatewayScript, /\bfetch\b|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Math\.random/);
});
