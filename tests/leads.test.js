import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createD1LeadStore,
  createMemoryLeadStore,
  handleLeadRequest,
  normalizeEmail,
} from "../src/leads.js";
import { initLeadCapture } from "../src/lead-capture.js";
import { createTestD1 } from "./support/d1-sqlite.js";

function request(body, options = {}) {
  return new Request("https://test.invalid/api/leads", {
    method: options.method ?? "POST",
    headers: options.headers ?? { "content-type": "application/json" },
    body: body === undefined ? undefined : (options.raw ? body : JSON.stringify(body)),
  });
}

test("normalizes valid email addresses and rejects unsafe or malformed input", () => {
  assert.equal(normalizeEmail("  Mina+Notes@Example.COM "), "mina+notes@example.com");
  for (const value of [null, "", "mina", "mina @example.com", `a@${"x".repeat(250)}.com`]) {
    assert.equal(normalizeEmail(value), null);
  }
});

test("subscribes an email and treats a repeated submission as success", async () => {
  const store = createMemoryLeadStore();
  const dependencies = { store, requestId: "lead-1", now: () => "2026-07-25T12:00:00.000Z" };
  const first = await handleLeadRequest(request({ email: "Mina@Example.com" }), dependencies);
  const duplicate = await handleLeadRequest(request({ email: "mina@example.com" }), dependencies);

  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { subscribed: true });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { subscribed: false });
  assert.equal(store.has("mina@example.com"), true);
  assert.equal(first.headers.get("cache-control"), "no-store");
});

test("returns actionable client errors and opaque storage errors", async () => {
  assert.equal((await handleLeadRequest(request({ email: "not-an-email" }), { store: createMemoryLeadStore() })).status, 422);
  assert.equal((await handleLeadRequest(request("{", { raw: true }), { store: createMemoryLeadStore() })).status, 400);
  assert.equal((await handleLeadRequest(request({}, { headers: { "content-type": "text/plain" } }), { store: createMemoryLeadStore() })).status, 415);
  const method = await handleLeadRequest(request(undefined, { method: "GET" }), { store: createMemoryLeadStore() });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");
  const failed = await handleLeadRequest(request({ email: "mina@example.com" }), {
    store: { subscribe: async () => { throw new Error("database password"); } },
    requestId: "trace-1",
  });
  assert.equal(failed.status, 500);
  assert.doesNotMatch(JSON.stringify(await failed.json()), /password/);
});

test("D1 store persists normalized leads and deduplicates atomically", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const store = createD1LeadStore(db);
  assert.equal(await store.subscribe("mina@example.com", "2026-07-25T12:00:00.000Z"), true);
  assert.equal(await store.subscribe("mina@example.com", "2026-07-25T12:01:00.000Z"), false);
  assert.equal(db.raw.prepare("SELECT count(*) AS count FROM leads").get().count, 1);
});

test("homepage ships the labelled lead form and its deployment adapter", async () => {
  const [html, adapter, migration] = await Promise.all([
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/leads.js", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0006_leads.sql", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<h2 id="lead-capture-title">See how teams make better decisions<\/h2>/);
  assert.match(html, /<label for="lead-email">Work email<\/label>/);
  assert.match(html, /aria-live="polite"/);
  assert.match(adapter, /createD1LeadStore/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS leads/);
});

function leadFormHarness() {
  const listeners = {};
  const emailListeners = {};
  const status = { textContent: "" };
  const button = {
    disabled: false,
    setAttribute() {},
    removeAttribute() {},
  };
  const email = {
    value: "Mina@Example.com",
    addEventListener(type, listener) { emailListeners[type] = listener; },
  };
  const form = {
    dataset: {},
    elements: { email },
    reportValidity: () => true,
    reset() { email.value = ""; },
    querySelector: () => button,
    addEventListener(type, listener) { listeners[type] = listener; },
  };
  const root = {
    querySelector(selector) {
      if (selector === "#lead-capture-form") return form;
      if (selector === "#lead-capture-status") return status;
      return null;
    },
  };
  return { root, form, email, button, status, listeners, emailListeners };
}

test("client submits once, announces success, and restores the control", async () => {
  const harness = leadFormHarness();
  let payload;
  initLeadCapture(harness.root, async (_url, options) => {
    payload = JSON.parse(options.body);
    assert.equal(harness.button.disabled, true);
    return new Response(JSON.stringify({ subscribed: true }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
  await harness.listeners.submit({ preventDefault() {} });

  assert.deepEqual(payload, { email: "Mina@Example.com" });
  assert.equal(harness.form.dataset.state, "success");
  assert.match(harness.status.textContent, /You’re in/);
  assert.equal(harness.email.value, "");
  assert.equal(harness.button.disabled, false);
});

test("client gives a retryable network error and clears it when editing", async () => {
  const harness = leadFormHarness();
  initLeadCapture(harness.root, async () => { throw new Error("private network detail"); });
  await harness.listeners.submit({ preventDefault() {} });

  assert.equal(harness.form.dataset.state, "error");
  assert.equal(harness.status.textContent, "We couldn’t save your email. Please try again.");
  assert.doesNotMatch(harness.status.textContent, /private/);
  harness.emailListeners.input();
  assert.equal(harness.form.dataset.state, undefined);
  assert.equal(harness.status.textContent, "");
});
