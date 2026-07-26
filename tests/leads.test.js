import assert from "node:assert/strict";
import test from "node:test";

import {
  createD1LeadStore,
  handleLeadRequest,
  normalizeLeadInput,
  validateLeadInput,
} from "../src/leads.js";

const request = (body, options = {}) => new Request("https://test.invalid/api/leads", {
  method: options.method ?? "POST",
  headers: { "content-type": options.contentType ?? "application/json" },
  body: options.raw ?? JSON.stringify(body),
});

test("lead input is normalized and validated", () => {
  assert.deepEqual(normalizeLeadInput({ email: " Mina@Example.COM " }), {
    email: "mina@example.com",
    company: "",
  });
  assert.equal(validateLeadInput({ email: "" }).error, "Enter your email address.");
  assert.equal(validateLeadInput({ email: "mina@" }).error, "Enter a valid email address.");
  assert.equal(validateLeadInput({ email: "mina@example.com" }).error, null);
});

test("lead endpoint persists valid email and returns resilient errors", async () => {
  const saved = [];
  const store = { subscribe: async (...values) => saved.push(values) };
  const response = await handleLeadRequest(request({ email: " Mina@Example.com " }), {
    store,
    now: () => "2026-07-25T12:00:00.000Z",
  });
  assert.equal(response.status, 201);
  assert.deepEqual(saved, [["mina@example.com", "2026-07-25T12:00:00.000Z"]]);
  assert.deepEqual(await response.json(), { subscribed: true });

  assert.equal((await handleLeadRequest(request({ email: "bad" }), { store })).status, 422);
  assert.equal((await handleLeadRequest(request({}, { contentType: "text/plain" }), { store })).status, 415);
  assert.equal((await handleLeadRequest(request({}, { raw: "{" }), { store })).status, 400);
  assert.equal((await handleLeadRequest(new Request("https://test.invalid/api/leads"), { store })).status, 405);
});

test("honeypot submissions succeed without storage writes", async () => {
  let called = false;
  const response = await handleLeadRequest(request({
    email: "bot@example.com",
    company: "https://spam.invalid",
  }), { store: { subscribe: async () => { called = true; } } });
  assert.equal(response.status, 200);
  assert.equal(called, false);
});

test("D1 store uses a parameterized idempotent insert", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      const statement = {
        bind(...args) { calls.push({ sql, args }); return statement; },
        async run() {},
      };
      return statement;
    },
  };
  await createD1LeadStore(db).subscribe("mina@example.com", "now");
  assert.match(calls[0].sql, /ON CONFLICT\(email\) DO UPDATE/);
  assert.deepEqual(calls[0].args, ["mina@example.com", "now", "now"]);
});

test("deployment adapter fails closed without storage", async () => {
  const { onRequest } = await import("../functions/api/leads.js");
  const response = await onRequest({ request: request({ email: "mina@example.com" }), env: {} });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("index contains a labelled, privacy-described email capture", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /See how teams make better decisions/);
  assert.match(html, /<label for="lead-email">Work email<\/label>/);
  assert.match(html, /type="email"[^>]+autocomplete="email"/);
  assert.match(html, /id="lead-status" role="status" aria-live="polite"/);
});
