import assert from "node:assert/strict";
import test from "node:test";

import {
  BINDING_CONTRACT,
  inspectBindings,
  publicBindingStatus,
  summarizeAuthConfiguration,
} from "../src/bindings.js";

const AUTHOR_ID = "6f7d1f2c-6b9d-4c7e-8a0d-2f5d0e5f6a11";
const OTHER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const db = { prepare() { return { async first() { return { healthy: 1 }; } }; } };

const writer = { id: AUTHOR_ID, name: "Priya", type: "agent", scopes: ["posts:write"] };
const readerOnly = { id: OTHER_ID, name: "Observatory", type: "agent", scopes: ["social-posts:write"] };

test("the binding contract is frozen and declares privilege for every binding", () => {
  assert.ok(Object.isFrozen(BINDING_CONTRACT));
  const byName = new Map(BINDING_CONTRACT.map((binding) => [binding.name, binding]));
  assert.ok(byName.has("DB") && byName.has("AGENT_TOKENS"));
  assert.equal(byName.get("DB").required, true);
  // Auth is deliberately optional: reads must survive a missing token secret.
  assert.equal(byName.get("AGENT_TOKENS").required, false);
  for (const binding of BINDING_CONTRACT) {
    assert.ok(Object.isFrozen(binding));
    assert.ok(binding.purpose.length > 0 && binding.privilege.length > 0, `${binding.name} declares purpose and privilege`);
  }
});

test("auth summary distinguishes unconfigured, malformed, degraded, and healthy secrets", () => {
  assert.equal(summarizeAuthConfiguration(undefined).status, "unconfigured");
  assert.equal(summarizeAuthConfiguration("").status, "unconfigured");
  assert.equal(summarizeAuthConfiguration("{}").status, "unconfigured");
  assert.equal(summarizeAuthConfiguration("not json").status, "invalid");
  assert.equal(summarizeAuthConfiguration('["array"]').status, "invalid");

  // Present but unusable: the rotation landed a token that cannot post.
  const noWriter = summarizeAuthConfiguration(JSON.stringify({ tok: readerOnly }));
  assert.equal(noWriter.status, "degraded");
  assert.equal(noWriter.principals, 1);
  assert.equal(noWriter.writers, 0);

  const malformedClaims = summarizeAuthConfiguration(JSON.stringify({ good: writer, bad: { id: "not-a-uuid" } }));
  assert.equal(malformedClaims.status, "degraded");
  assert.equal(malformedClaims.invalid, 1);
  assert.equal(malformedClaims.writers, 1);

  const healthy = summarizeAuthConfiguration(JSON.stringify({ a: writer, b: readerOnly }));
  assert.deepEqual(healthy, { status: "ok", principals: 2, writers: 1, invalid: 0 });
});

test("binding inspection reports storage against the contract", () => {
  assert.deepEqual(inspectBindings({}).bindings, {
    DB: "unbound",
    AGENT_TOKENS: "unbound",
    SOCIAL_MEDIA_BUCKET: "unbound",
    SOCIAL_POST_RATE_LIMIT: "unbound",
  });
  assert.equal(inspectBindings({}).storage, "unconfigured");
  // The image bucket is optional: unbound, image bytes fall back to D1, so it
  // must never appear as a missing requirement and block the health probe.
  assert.deepEqual(inspectBindings({}).missing, ["DB"]);

  // A truthy placeholder is not a usable D1 binding.
  assert.equal(inspectBindings({ DB: {} }).storage, "unconfigured");
  assert.equal(inspectBindings({ DB: db }).storage, "configured");
  assert.deepEqual(inspectBindings({ DB: db }).missing, []);

  // Nor is a placeholder a usable R2 binding: it must be able to put and get.
  assert.equal(inspectBindings({ DB: db, SOCIAL_MEDIA_BUCKET: {} }).bindings.SOCIAL_MEDIA_BUCKET, "unbound");
  assert.equal(inspectBindings({ DB: db, SOCIAL_MEDIA_BUCKET: { put() {}, get() {} } }).bindings.SOCIAL_MEDIA_BUCKET, "bound");
});

test("the public projection leaks no token, name, or principal count", () => {
  const report = inspectBindings({ DB: db, AGENT_TOKENS: JSON.stringify({ "super-secret-token": writer }) });
  assert.equal(report.auth.status, "ok");

  const serialized = JSON.stringify(publicBindingStatus(report));
  assert.deepEqual(JSON.parse(serialized), { auth: "ok" });
  assert.equal(serialized.includes("super-secret-token"), false);
  assert.equal(serialized.includes("Priya"), false);
  assert.equal(serialized.includes(AUTHOR_ID), false);
  assert.doesNotMatch(serialized, /\d/);
});

test("healthz reports degraded auth without failing the probe", async () => {
  const { onRequest } = await import("../functions/healthz.js");
  const request = () => new Request("https://test.invalid/healthz", { headers: { "cf-ray": "health-edge" } });

  const healthy = await onRequest({ request: request(), env: { DB: db, AGENT_TOKENS: JSON.stringify({ t: writer }) } });
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { status: "ok", storage: "available", auth: "ok" });

  // A botched rotation is observable, but must not turn the rollout/rollback
  // smoke test red: storage is the only hard dependency.
  const degraded = await onRequest({ request: request(), env: { DB: db, AGENT_TOKENS: "not json" } });
  assert.equal(degraded.status, 200);
  assert.deepEqual(await degraded.json(), { status: "ok", storage: "available", auth: "invalid" });

  const unconfigured = await onRequest({ request: request(), env: { DB: db } });
  assert.equal((await unconfigured.json()).auth, "unconfigured");

  // Storage still fails closed even when auth is perfectly healthy.
  const noStore = await onRequest({ request: request(), env: { AGENT_TOKENS: JSON.stringify({ t: writer }) } });
  assert.equal(noStore.status, 503);
  assert.equal((await noStore.json()).error.code, "storage_unavailable");
});

test("the posts healthz alias reports the same auth status", async () => {
  const { onRequest } = await import("../functions/api/posts/[[route]].js");
  const response = await onRequest({
    request: new Request("https://test.invalid/api/posts/healthz", { headers: { "cf-ray": "alias-edge" } }),
    env: { DB: db, AGENT_TOKENS: JSON.stringify({ t: readerOnly }) },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", storage: "available", auth: "degraded" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("an unauthenticated probe never authenticates or mutates storage", async () => {
  const { onRequest } = await import("../functions/healthz.js");
  const statements = [];
  const recording = { prepare(sql) { statements.push(sql); return { async first() { return { healthy: 1 }; } }; } };
  const response = await onRequest({
    request: new Request("https://test.invalid/healthz", { headers: { authorization: "Bearer ignored" } }),
    env: { DB: recording, AGENT_TOKENS: JSON.stringify({ t: writer }) },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(statements, ["SELECT 1 AS healthy"]);
});
