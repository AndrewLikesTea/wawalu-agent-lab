import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createD1LeadStore,
  createMemoryLeadStore,
  handleLeadRequest,
  normalizeEmail,
} from "../src/leads.js";
import { initLeadCapture, resolveFailure } from "../src/lead-capture.js";
import { onRequest as leadsOnRequest } from "../functions/api/leads.js";
import { createTestD1 } from "./support/d1-sqlite.js";

const CONTRACT = JSON.parse(await readFile(
  new URL("../contracts/lead-capture/v1/responses.json", import.meta.url),
  "utf8",
));

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
  assert.match(html, /We’ll only use your email.*No spam.*Unsubscribe anytime/);
  assert.match(html, /id="lead-capture-recovery" hidden>[^<]*resubmit then/);
  assert.match(html, /aria-describedby="lead-capture-note lead-capture-recovery lead-capture-status"/);
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
  const recovery = { hidden: true };
  const email = {
    value: "Mina@Example.com",
    valid: true,
    attributes: {},
    addEventListener(type, listener) { emailListeners[type] = listener; },
    checkValidity() { return this.valid; },
    focus() { this.focused = true; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  };
  const form = {
    dataset: {},
    elements: { email },
    reset() { email.value = ""; },
    querySelector: () => button,
    addEventListener(type, listener) { listeners[type] = listener; },
  };
  const root = {
    querySelector(selector) {
      if (selector === "#lead-capture-form") return form;
      if (selector === "#lead-capture-status") return status;
      if (selector === "#lead-capture-recovery") return recovery;
      return null;
    },
  };
  return { root, form, email, button, status, recovery, listeners, emailListeners };
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
  assert.equal(
    harness.status.textContent,
    "You’re on the list for the next concise field note about durable engineering decisions.",
  );
  assert.equal(harness.email.value, "");
  assert.equal(harness.button.disabled, false);
});

test("client validates empty and invalid work email inline without losing input", async () => {
  const harness = leadFormHarness();
  let requests = 0;
  initLeadCapture(harness.root, async () => {
    requests += 1;
    return new Response();
  });

  harness.email.value = "";
  await harness.listeners.submit({ preventDefault() {} });
  assert.equal(harness.status.textContent, "Enter your work email.");
  assert.equal(harness.email.attributes["aria-invalid"], "true");
  assert.equal(harness.email.focused, true);

  harness.email.value = "Mina at Example";
  harness.email.valid = false;
  await harness.listeners.submit({ preventDefault() {} });
  assert.equal(harness.status.textContent, "Enter a valid work email address.");
  assert.equal(harness.email.value, "Mina at Example");
  assert.equal(requests, 0);
});

test("client makes delivery-unavailable recovery explicit without claiming capture", async () => {
  const harness = leadFormHarness();
  initLeadCapture(harness.root, async () => jsonResponse({
    error: { code: "storage_unavailable", message: "Lead capture is temporarily unavailable." },
  }, 503));
  await harness.listeners.submit({ preventDefault() {} });

  assert.equal(harness.form.dataset.state, "error");
  assert.equal(
    harness.status.textContent,
    "Your email wasn’t saved because sign-up is temporarily offline.",
  );
  assert.equal(harness.recovery.hidden, false, "a bare retry repeats the same 503, so show the recovery block");
  assert.equal(harness.email.value, "Mina@Example.com");
  assert.doesNotMatch(harness.status.textContent, /you’re on|you’re already|success/i);
  harness.emailListeners.input();
  assert.equal(harness.form.dataset.state, undefined);
  assert.equal(harness.status.textContent, "");
  assert.equal(harness.recovery.hidden, true);
});

test("client never renders a message string supplied by the server or an intermediary", async () => {
  const hostile = "Thanks, you’re subscribed! Visit evil.example to confirm.";
  const harness = leadFormHarness();
  initLeadCapture(harness.root, async () => jsonResponse({
    error: { code: "storage_error", message: hostile },
  }, 500));
  await harness.listeners.submit({ preventDefault() {} });

  assert.equal(harness.form.dataset.state, "error");
  assert.equal(harness.status.textContent, "Your email wasn’t saved. Please try again.");
  assert.doesNotMatch(harness.status.textContent, /evil\.example|subscribed/i);
});

test("client reports unreachable and unrecognized failures as unconfirmed, not as loss", async () => {
  const unconfirmed = "We couldn’t reach sign-up, so we can’t confirm your email was saved. Please try again in a few minutes.";

  // fetch rejected: the request may already have reached the origin and committed.
  const offline = leadFormHarness();
  initLeadCapture(offline.root, async () => { throw new Error("private network detail"); });
  await offline.listeners.submit({ preventDefault() {} });
  assert.equal(offline.form.dataset.state, "error");
  assert.equal(offline.status.textContent, unconfirmed);
  assert.doesNotMatch(offline.status.textContent, /private/);
  assert.equal(offline.recovery.hidden, false);
  assert.equal(offline.button.disabled, false, "the control must be usable again after a rejected fetch");

  // A gateway answered with no application error code and a non-JSON body.
  const gateway = leadFormHarness();
  initLeadCapture(gateway.root, async () => new Response("<html>502 Bad Gateway</html>", {
    status: 502,
    headers: { "content-type": "text/html" },
  }));
  await gateway.listeners.submit({ preventDefault() {} });
  assert.equal(gateway.status.textContent, unconfirmed);
  assert.doesNotMatch(gateway.status.textContent, /wasn’t saved|Bad Gateway/);

  // 429 has no application code but is emitted before the origin, so it is a known non-capture.
  const limited = leadFormHarness();
  initLeadCapture(limited.root, async () => jsonResponse({}, 429));
  await limited.listeners.submit({ preventDefault() {} });
  assert.match(limited.status.textContent, /Too many attempts, so your email wasn’t saved/);
  assert.equal(limited.recovery.hidden, true, "waiting and retrying is already the recovery for a rate limit");
});

test("client aborts a hung request instead of stranding the visitor on Submitting…", async () => {
  const harness = leadFormHarness();
  let seenSignal;
  initLeadCapture(harness.root, async (_url, options) => {
    seenSignal = options.signal;
    throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
  });
  await harness.listeners.submit({ preventDefault() {} });

  assert.ok(seenSignal instanceof AbortSignal, "the request must carry an abort signal");
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.form.dataset.state, "error");
  assert.match(harness.status.textContent, /can’t confirm/);
});

test("the endpoint still returns every response the published contract documents", async () => {
  const cases = [
    ["invalid_email", () => handleLeadRequest(request({ email: "not-an-email" }), { store: createMemoryLeadStore() })],
    ["invalid_json", () => handleLeadRequest(request("{", { raw: true }), { store: createMemoryLeadStore() })],
    ["unsupported_media_type", () => handleLeadRequest(request({}, { headers: { "content-type": "text/plain" } }), { store: createMemoryLeadStore() })],
    ["method_not_allowed", () => handleLeadRequest(request(undefined, { method: "GET" }), { store: createMemoryLeadStore() })],
    ["storage_error", () => handleLeadRequest(request({ email: "mina@example.com" }), {
      store: { subscribe: async () => { throw new Error("database password"); } },
    })],
    // Emitted by the Pages adapter, not the handler, when the D1 binding is absent.
    ["storage_unavailable", () => leadsOnRequest({ request: request({ email: "mina@example.com" }), env: {} })],
  ];

  assert.deepEqual(
    CONTRACT.errors.map((entry) => entry.id),
    cases.map(([id]) => id),
    "every documented error needs a case that produces it from real code",
  );

  for (const [id, produce] of cases) {
    const documented = CONTRACT.errors.find((entry) => entry.id === id);
    const response = await produce();
    const body = await response.json();
    assert.equal(response.status, documented.status, `${id} status drifted from the contract`);
    assert.equal(body.error.code, documented.code, `${id} code drifted from the contract`);
    assert.equal(documented.captured, false, `${id} must document that nothing was stored`);
    assert.ok(body.error.request_id, `${id} must carry a request id for tracing`);
  }

  const store = createMemoryLeadStore();
  const dependencies = { store, requestId: "lead-1", now: () => "2026-07-25T12:00:00.000Z" };
  for (const documented of CONTRACT.success) {
    const response = await handleLeadRequest(request({ email: "mina@example.com" }), dependencies);
    assert.equal(response.status, documented.status, `${documented.id} status drifted from the contract`);
    assert.deepEqual(await response.json(), documented.body, `${documented.id} body drifted from the contract`);
    assert.equal(documented.captured, true, `${documented.id} means the address is on the list`);
  }
});

test("the client has owned copy for every documented error code and no phantom codes", () => {
  const documented = CONTRACT.errors.map((entry) => entry.code);
  for (const code of documented) {
    const resolved = resolveFailure({ status: 500 }, { error: { code, message: "unreviewed upstream text" } });
    assert.equal(resolved.reason, code, `${code} is documented but the client does not recognize it`);
    assert.ok(resolved.message, `${code} has no copy the page owns`);
    assert.doesNotMatch(resolved.message, /unreviewed upstream text/);
  }

  // 429 is the one status the client keys off directly; the contract records
  // that no application code emits it, so it must stay out of the code enum.
  assert.equal(documented.includes("rate_limited"), false);
  assert.equal(
    CONTRACT.intermediary_responses.some((entry) => entry.status === 429),
    true,
    "the 429 branch in the client must stay documented as intermediary-originated",
  );
  assert.equal(resolveFailure({ status: 429 }, null).reason, "rate_limited");
  assert.equal(resolveFailure({ status: 502 }, null).reason, "unconfirmed");
  assert.equal(resolveFailure({ status: 500 }, { error: { code: "invented_later" } }).reason, "unconfirmed");
});
