import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createD1LeadStore,
  createMemoryLeadStore,
  handleLeadRequest,
  LEAD_REASONS,
  normalizeEmail,
} from "../src/leads.js";
import { FOLLOW_UP_REASONS } from "../src/site-footer.js";
import {
  CONTACT_COPY, FIELD_NOTE_COPY, initLeadCapture, looksLikeEmail, resolveFailure,
} from "../src/lead-capture.js";
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

test("the home page's field-note form says what submitting does, in the surface a visitor reads", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const section = html.slice(html.indexOf('<section class="lead-capture"'), html.indexOf("</section>", html.indexOf('<section class="lead-capture"')));

  // The note beside the field, the label on the control that submits it, and the
  // paragraph a visitor is left with after an outage. All three now name the one
  // thing this form does, so none of them can be read as the footer's.
  assert.match(section, /Submitting subscribes you to field notes\./);
  assert.match(section, /<button type="submit">Subscribe to field notes/);
  assert.match(section, /resubmit then to subscribe/);
  // "Product notes" was a second name for the thing the heading, the button, and
  // the confirmation all call a field note. One concept, one name.
  assert.doesNotMatch(section, /product notes/i);
});

test("normalizes valid email addresses and rejects unsafe or malformed input", () => {
  assert.equal(normalizeEmail("  Mina+Notes@Example.COM "), "mina+notes@example.com");
  for (const value of [null, "", "mina", "mina @example.com", `a@${"x".repeat(250)}.com`]) {
    assert.equal(normalizeEmail(value), null);
  }
});

test("subscribes an email and treats a repeated submission as success", async () => {
  const store = createMemoryLeadStore();
  const dependencies = { store, requestId: "lead-1", now: () => "2026-07-25T12:00:00.000Z" };
  const first = await handleLeadRequest(request({ email: "Mina@Example.com", purpose: "field_notes" }), dependencies);
  const duplicate = await handleLeadRequest(request({ email: "mina@example.com", purpose: "field_notes" }), dependencies);

  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { captured: true, created: true, purpose: "field_notes" });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { captured: true, created: false, purpose: "field_notes" });
  assert.equal(store.has("mina@example.com"), true);
  assert.equal(first.headers.get("cache-control"), "no-store");
});

test("stores field-note and follow-up intent independently for the same address", async () => {
  const store = createMemoryLeadStore();
  const dependencies = { store, requestId: "lead-purpose", now: () => "2026-08-01T12:00:00.000Z" };

  const subscription = await handleLeadRequest(request({
    email: "mina@example.com", purpose: "field_notes",
  }), dependencies);
  const followUp = await handleLeadRequest(request({
    email: "mina@example.com", purpose: "follow_up",
  }), dependencies);

  assert.equal(subscription.status, 201);
  assert.equal(followUp.status, 201, "an existing subscription must not swallow a follow-up request");
  assert.equal(store.has("mina@example.com", "field_notes"), true);
  assert.equal(store.has("mina@example.com", "follow_up"), true);
});

test("the endpoint decides for itself which reasons it will record", async () => {
  // The browser's required-choice gate is a courtesy to the visitor. This is the
  // guarantee: a reason the endpoint does not know never becomes a row, whatever
  // sent it. The harness's controls accept any value they are given, so proving
  // refusal at the control would prove nothing — it is proved here instead.
  const store = createMemoryLeadStore();
  const dependencies = { store, requestId: "lead-reason", now: () => "2026-08-03T12:00:00.000Z" };

  for (const reason of ["curious", "", null, 7, "OWN_SPEND", "own_spend "]) {
    const refused = await handleLeadRequest(request({
      email: "mina@example.com", purpose: "follow_up", reason,
    }), dependencies);
    assert.equal(refused.status, 422, `${JSON.stringify(reason)} must be refused`);
    assert.equal((await refused.json()).error.code, "invalid_reason");
  }
  assert.equal(store.has("mina@example.com", "follow_up"), false, "a refused reason must store nothing");

  // A fourth key is still a caller this endpoint does not know about.
  const widened = await handleLeadRequest(request({
    email: "mina@example.com", purpose: "follow_up", reason: "own_spend", source: "footer",
  }), dependencies);
  assert.equal(widened.status, 400);
  assert.equal((await widened.json()).error.code, "invalid_request");

  // Every reason the footer can produce is one the endpoint records, and the
  // value the visitor chose is what lands beside the address.
  for (const [index, reason] of LEAD_REASONS.entries()) {
    const email = `mina${index}@example.com`;
    const accepted = await handleLeadRequest(request({ email, purpose: "follow_up", reason }), dependencies);
    assert.equal(accepted.status, 201, `${reason} is offered by the form and must be accepted`);
    assert.deepEqual(await accepted.json(), { captured: true, created: true, purpose: "follow_up" });
    assert.equal(store.reasonFor(email), reason, `${reason} must reach storage, not just the wire`);
  }

  // And a form that does not ask why still sends two keys and still works.
  const withoutReason = await handleLeadRequest(request({
    email: "director@example.com", purpose: "follow_up",
  }), dependencies);
  assert.equal(withoutReason.status, 201);
  assert.equal(store.reasonFor("director@example.com"), null);
});

test("the reason a visitor can choose and the reason the endpoint accepts are one vocabulary", async () => {
  // Two halves of one contract, in two files that cannot import each other: the
  // endpoint is server code and no page ships it. A form offering a choice the
  // endpoint refuses would lose the visitor at the last step, and an endpoint
  // accepting a value no form produces would store something nobody chose.
  assert.deepEqual(FOLLOW_UP_REASONS.map((reason) => reason.value), [...LEAD_REASONS]);

  // The published contract documents the same set, and the migration's CHECK
  // constraint is what keeps a row from carrying anything else.
  assert.deepEqual(Object.keys(CONTRACT.reason_values), [...LEAD_REASONS]);
  const migration = await readFile(new URL("../migrations/0008_lead_reason.sql", import.meta.url), "utf8");
  for (const reason of LEAD_REASONS) assert.match(migration, new RegExp(`'${reason}'`), `${reason} is not storable`);

  // The two the issue named, in the words a visitor reads them by.
  const labels = FOLLOW_UP_REASONS.map((reason) => reason.label);
  assert.ok(labels.length >= 3, "the group must offer at least three choices");
  assert.ok(labels.some((label) => /own AI spend/.test(label)), "one choice must be running Shiplog on your own spend");
  assert.ok(labels.some((label) => /question about the demonstration/.test(label)), "one choice must be a question about the demo");
});

test("the D1 store records the chosen reason and refuses one the vocabulary does not list", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const store = createD1LeadStore(db);

  assert.equal(await store.capture("mina@example.com", "follow_up", "2026-08-03T12:00:00.000Z", "own_spend"), true);
  assert.equal(
    db.raw.prepare("SELECT reason FROM lead_submissions WHERE email = ?").get("mina@example.com").reason,
    "own_spend",
  );
  // The sign-up asks nobody why, and its rows say so rather than guessing.
  assert.equal(await store.capture("mina@example.com", "field_notes", "2026-08-03T12:01:00.000Z"), true);
  assert.equal(
    db.raw.prepare("SELECT reason FROM lead_submissions WHERE purpose = 'field_notes'").get().reason,
    null,
  );
  // The CHECK fires and the insert is dropped rather than committed. The store
  // writes with INSERT OR IGNORE, so a violation reports "nothing was created"
  // instead of throwing — which is exactly what the caller has to be told.
  assert.equal(
    await store.capture("director@example.com", "follow_up", "2026-08-03T12:02:00.000Z", "curious"),
    false,
    "a reason the vocabulary does not list must not become a row",
  );
  assert.equal(db.raw.prepare("SELECT count(*) AS count FROM lead_submissions").get().count, 2);
});

test("returns actionable client errors and opaque storage errors", async () => {
  assert.equal((await handleLeadRequest(request({ email: "not-an-email", purpose: "field_notes" }), { store: createMemoryLeadStore() })).status, 422);
  assert.equal((await handleLeadRequest(request("{", { raw: true }), { store: createMemoryLeadStore() })).status, 400);
  assert.equal((await handleLeadRequest(request({}, { headers: { "content-type": "text/plain" } }), { store: createMemoryLeadStore() })).status, 415);
  const method = await handleLeadRequest(request(undefined, { method: "GET" }), { store: createMemoryLeadStore() });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");
  const failed = await handleLeadRequest(request({ email: "mina@example.com", purpose: "follow_up" }), {
    store: { capture: async () => { throw new Error("database password"); } },
    requestId: "trace-1",
  });
  assert.equal(failed.status, 500);
  assert.doesNotMatch(JSON.stringify(await failed.json()), /password/);
});

test("D1 store persists normalized leads and deduplicates atomically", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const store = createD1LeadStore(db);
  assert.equal(await store.capture("mina@example.com", "field_notes", "2026-07-25T12:00:00.000Z"), true);
  assert.equal(await store.capture("mina@example.com", "follow_up", "2026-07-25T12:01:00.000Z"), true);
  assert.equal(await store.capture("mina@example.com", "follow_up", "2026-07-25T12:02:00.000Z"), false);
  assert.equal(db.raw.prepare("SELECT count(*) AS count FROM lead_submissions").get().count, 2);
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
  assert.match(html, /Submitting subscribes you to field notes\..*No spam\. Unsubscribe anytime/);
  assert.match(html, /id="lead-capture-recovery" hidden>[^<]*resubmit then/);
  // The recovery paragraph is hidden *and* unreferenced at rest. A hidden node
  // named by aria-describedby is still part of the accessible description, so
  // shipping the id in the markup read "your email is still in the field above"
  // to anyone who focused the field before submitting anything.
  assert.match(html, /aria-describedby="lead-capture-note lead-capture-status"/);
  assert.doesNotMatch(html, /aria-describedby="[^"]*lead-capture-recovery/);
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
    // Seeded with what src/index.html now ships: the note and the live status,
    // and deliberately not the recovery paragraph.
    attributes: { "aria-describedby": "lead-capture-note lead-capture-status" },
    addEventListener(type, listener) { emailListeners[type] = listener; },
    checkValidity() { return this.valid; },
    focus() { this.focused = true; },
    getAttribute(name) { return this.attributes[name] ?? null; },
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
    return new Response(JSON.stringify({ captured: true, created: true, purpose: "field_notes" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
  await harness.listeners.submit({ preventDefault() {} });

  assert.deepEqual(payload, { email: "Mina@Example.com", purpose: "field_notes" });
  assert.equal(harness.form.dataset.state, "success");
  assert.equal(
    harness.status.textContent,
    "You’re subscribed. The next field note about durable engineering decisions goes to that address.",
  );
  assert.equal(harness.email.value, "");
  assert.equal(harness.button.disabled, false);
});

test("client treats a legacy 2xx response as success after the row was captured", async () => {
  const harness = leadFormHarness();
  initLeadCapture(harness.root, async () => jsonResponse({ subscribed: true }, 201));
  await harness.listeners.submit({ preventDefault() {} });

  assert.equal(harness.form.dataset.state, "success");
  assert.match(harness.status.textContent, /^You’re subscribed\./);
  assert.equal(harness.recovery.hidden, true);
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
  assert.equal(harness.status.textContent, "Enter your work email to subscribe to field notes.");
  assert.equal(harness.email.attributes["aria-invalid"], "true");
  assert.equal(harness.email.focused, true);

  harness.email.value = "Mina at Example";
  harness.email.valid = false;
  await harness.listeners.submit({ preventDefault() {} });
  assert.equal(harness.status.textContent, "Enter a valid work email address to subscribe to field notes.");
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
    "You’re not subscribed because sign-up is temporarily offline.",
  );
  assert.equal(harness.recovery.hidden, false, "a bare retry repeats the same 503, so show the recovery block");
  assert.equal(harness.email.value, "Mina@Example.com");
  assert.doesNotMatch(harness.status.textContent, /you’re subscribed|already subscribed|success/i);
  harness.emailListeners.input();
  assert.equal(harness.form.dataset.state, undefined);
  assert.equal(harness.status.textContent, "");
  assert.equal(harness.recovery.hidden, true);
});

test("field-note retry replaces an unavailable failure with a truthful success", async () => {
  const harness = leadFormHarness();
  let attempt = 0;
  initLeadCapture(harness.root, async () => {
    attempt += 1;
    return attempt === 1
      ? jsonResponse({ error: { code: "storage_unavailable" } }, 503)
      : jsonResponse({ captured: true, created: true, purpose: "field_notes" }, 201);
  });

  await harness.listeners.submit({ preventDefault() {} });
  assert.equal(harness.recovery.hidden, false);
  await harness.listeners.submit({ preventDefault() {} });

  assert.equal(harness.form.dataset.state, "success");
  assert.equal(harness.recovery.hidden, true);
  assert.match(harness.status.textContent, /^You’re subscribed\./);
  assert.doesNotMatch(harness.status.textContent, /offline|couldn’t|not subscribed/);
});

test("recovery copy is described to the field only after a submission has failed", async () => {
  const harness = leadFormHarness();
  const described = () => harness.email.attributes["aria-describedby"];
  initLeadCapture(harness.root, async () => jsonResponse({
    error: { code: "storage_unavailable", message: "unavailable" },
  }, 503));

  // First paint: no failure has happened, so nothing about failure is rendered
  // or described. This is the state a visitor meets the form in.
  assert.equal(harness.recovery.hidden, true);
  assert.doesNotMatch(described(), /lead-capture-recovery/);

  await harness.listeners.submit({ preventDefault() {} });
  assert.equal(harness.recovery.hidden, false);
  assert.match(described(), /lead-capture-recovery/,
    "once the recovery block is visible the field must actually point at it");
  // The note and the live status are still described; the fix adds and removes
  // one id rather than rewriting the description.
  assert.match(described(), /lead-capture-note/);
  assert.match(described(), /lead-capture-status/);

  harness.emailListeners.input();
  assert.equal(harness.recovery.hidden, true);
  assert.doesNotMatch(described(), /lead-capture-recovery/,
    "editing the field retracts the failure copy from the description too");
});

test("the browser shape check and the endpoint agree on what is malformed", () => {
  const cases = [
    "mina@example.com", "Mina+Notes@Example.COM", "  spaced@example.com  ",
    "", "   ", "mina", "mina @example.com", "mina@example", "@example.com",
    `a@${"x".repeat(250)}.com`,
  ];
  for (const value of cases) {
    assert.equal(looksLikeEmail(value), normalizeEmail(value) !== null,
      `the form and the endpoint disagree about "${value}"; one of them would `
      + "accept input the other rejects with a 422");
  }
});

test("client never renders a message string supplied by the server or an intermediary", async () => {
  const hostile = "Thanks, you’re subscribed! Visit evil.example to confirm.";
  const harness = leadFormHarness();
  initLeadCapture(harness.root, async () => jsonResponse({
    error: { code: "storage_error", message: hostile },
  }, 500));
  await harness.listeners.submit({ preventDefault() {} });

  assert.equal(harness.form.dataset.state, "error");
  assert.equal(harness.status.textContent, "You’re not subscribed — something went wrong at our end. Please try again.");
  assert.doesNotMatch(harness.status.textContent, /evil\.example|you’re subscribed/i);
});

test("client reports unreachable and unrecognized failures as unconfirmed, not as loss", async () => {
  const unconfirmed = "We couldn’t reach sign-up, so we can’t confirm whether you’re subscribed. Please try again in a few minutes.";

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
  assert.doesNotMatch(gateway.status.textContent, /not subscribed|Bad Gateway/);

  // 429 has no application code but is emitted before the origin, so it is a known non-capture.
  const limited = leadFormHarness();
  initLeadCapture(limited.root, async () => jsonResponse({}, 429));
  await limited.listeners.submit({ preventDefault() {} });
  assert.match(limited.status.textContent, /You’re not subscribed — too many attempts/);
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
    ["invalid_request", () => handleLeadRequest(request({ email: "mina@example.com" }), { store: createMemoryLeadStore() })],
    ["invalid_purpose", () => handleLeadRequest(request({ email: "mina@example.com", purpose: "marketing" }), { store: createMemoryLeadStore() })],
    ["invalid_email", () => handleLeadRequest(request({ email: "not-an-email", purpose: "field_notes" }), { store: createMemoryLeadStore() })],
    ["invalid_reason", () => handleLeadRequest(request({ email: "mina@example.com", purpose: "follow_up", reason: "curious" }), { store: createMemoryLeadStore() })],
    ["invalid_json", () => handleLeadRequest(request("{", { raw: true }), { store: createMemoryLeadStore() })],
    ["unsupported_media_type", () => handleLeadRequest(request({}, { headers: { "content-type": "text/plain" } }), { store: createMemoryLeadStore() })],
    ["method_not_allowed", () => handleLeadRequest(request(undefined, { method: "GET" }), { store: createMemoryLeadStore() })],
    ["storage_error", () => handleLeadRequest(request({ email: "mina@example.com", purpose: "field_notes" }), {
      store: { capture: async () => { throw new Error("database password"); } },
    })],
    // Emitted by the Pages adapter, not the handler, when the D1 binding is absent.
    ["storage_unavailable", () => leadsOnRequest({ request: request({ email: "mina@example.com", purpose: "field_notes" }), env: {} })],
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
    const response = await handleLeadRequest(request({ email: "mina@example.com", purpose: documented.body.purpose }), dependencies);
    assert.equal(response.status, documented.status, `${documented.id} status drifted from the contract`);
    assert.deepEqual(await response.json(), documented.body, `${documented.id} body drifted from the contract`);
    assert.equal(documented.captured, true, `${documented.id} means the address is on the list`);
  }
});

test("the client has owned copy for every documented error code and no phantom codes", () => {
  const documented = CONTRACT.errors.map((entry) => entry.code);
  for (const code of documented) {
    const resolved = resolveFailure({ status: 500 }, { error: { code, message: "unreviewed upstream text" } }, FIELD_NOTE_COPY);
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
  assert.equal(resolveFailure({ status: 429 }, null, FIELD_NOTE_COPY).reason, "rate_limited");
  assert.equal(resolveFailure({ status: 502 }, null, FIELD_NOTE_COPY).reason, "unconfirmed");
  assert.equal(resolveFailure({ status: 500 }, { error: { code: "invented_later" } }, FIELD_NOTE_COPY).reason, "unconfirmed");
});

test("the two work-email forms never describe a failure in the same words", () => {
  // The home page carries both of these within a scroll of each other. A visitor
  // who mistypes an address, or meets an outage, has to be able to tell from the
  // sentence alone which of the two they were using — that is the whole defect
  // issue 451 reported, and it is one shared string away from coming back.
  const codes = [...CONTRACT.errors.map((entry) => entry.code), "invented_later"];
  for (const code of codes) {
    const body = { error: { code } };
    const subscribing = resolveFailure({ status: 500 }, body, FIELD_NOTE_COPY).message;
    const contacting = resolveFailure({ status: 500 }, body, CONTACT_COPY).message;
    assert.notEqual(subscribing, contacting, `${code} reads identically in both forms`);
  }

  for (const [copy, purpose] of [[FIELD_NOTE_COPY, /subscribe to field notes\.$/], [CONTACT_COPY, /request a Shiplog follow-up\.$/]]) {
    // Both halves of the inline validation, not just the malformed one: an empty
    // field is the state a visitor meets most often.
    assert.match(copy.emptyEmail, purpose);
    assert.match(copy.invalidEmail, purpose);
  }

  // Every failure a visitor can read still names what did or did not happen, so
  // no state degrades to a bare "something went wrong".
  for (const copy of [FIELD_NOTE_COPY, CONTACT_COPY]) {
    const purpose = copy === FIELD_NOTE_COPY ? /subscrib/i : /request/i;
    for (const message of [...Object.values(copy.rejected), copy.rateLimited, copy.unconfirmed]) {
      assert.match(message, purpose, `"${message}" does not say which form it belongs to`);
      // A next step, not just a diagnosis. The two outage messages hand off to
      // the recovery paragraph in the markup instead of repeating "try again".
      assert.match(message, /again|Reload|temporarily offline/,
        `"${message}" leaves the visitor without a next step`);
    }
  }
});
