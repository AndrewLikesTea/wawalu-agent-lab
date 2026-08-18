// The decision-and-release section's own follow-up request, click to row and back.
//
// The homepage makes a promise with two halves — what your AI spend is buying,
// and why the things you shipped shipped — and until now only the first half had
// a way to raise a hand. The takeaway's form carries a fixed topic naming the
// bundled AI FinOps example, so a reader persuaded by the log had to send their
// work email under someone else's subject line, and every inbound lead from this
// page arrived labelled a FinOps enquiry.
//
// This file drives the second panel end to end and, just as importantly, drives
// the seam between the two: they share a transport, a copy set, and a binder, so
// the failure worth testing for is one panel reaching into the other. Every
// independence assertion below is written in both directions.
//
// Assertions are on counts, ids, and attributes rather than on element identity:
// a failing assert.equal(node, other) deep-inspects the whole parsed page to
// build its diff and never returns.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import {
  bindDecisionLogFollowUp, bindFinopsExampleFollowUp, DECISION_LOG_FOLLOW_UP_PURPOSE,
  DECISION_LOG_FOLLOW_UP_TOPIC, FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE, FIXED_TOPIC_DISCLOSURE,
} from "../src/homepage-executive-takeaway.js";
import { LEAD_PURPOSES } from "../src/leads.js";
import { onRequest } from "../functions/api/leads.js";
import { createTestD1 } from "./support/d1-sqlite.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const MODULE = new URL("../src/homepage-executive-takeaway.js", import.meta.url);
const NativeResponse = globalThis.Response;

const reply = (body, status = 201) => new NativeResponse(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

const byId = (document, id) => document.getElementById(id);
const shown = (document, id) => textOf(byId(document, id));

/** Both homepage panels, wired to one recording transport. */
async function openHomepage(t, request = async () => reply({ captured: true, created: true })) {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  const calls = [];
  const transport = (url, options) => {
    calls.push({ url, options });
    return request(url, options);
  };
  bindFinopsExampleFollowUp(page.document, transport);
  bindDecisionLogFollowUp(page.document, transport);
  return { document: page.document, calls };
}

/** Type into a panel's field and press Enter, the way a visitor submits it. */
function submitPanel(document, prefix, value) {
  const email = byId(document, `${prefix}-email`);
  email.value = value;
  email.focus();
  pressEnter(document);
  return email;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** What a panel looks like when nobody has touched it. */
function assertUntouched(document, prefix, message) {
  const form = byId(document, `${prefix}-form`);
  assert.equal(form.dataset.state, undefined, `${message}: state`);
  assert.equal(byId(document, `${prefix}-email`).value ?? "", "", `${message}: field`);
  assert.equal(shown(document, `${prefix}-status`), "", `${message}: status`);
  assert.ok(!form.querySelector('button[type="submit"]').disabled, `${message}: submit`);
}

test("the decision-and-release section carries its own follow-up request, topic first", async (t) => {
  const { document } = await openHomepage(t);
  const panelWrapper = byId(document, "decision-log-follow-up");
  const open = byId(document, "decision-log-follow-up-open");
  const panel = byId(document, "decision-log-follow-up-panel");

  // It lives in the section it is about, not beside the takeaway.
  let parent = panelWrapper.parentNode;
  const ancestors = [];
  while (parent) {
    if (parent.id) ancestors.push(parent.id);
    parent = parent.parentNode;
  }
  assert.ok(ancestors.includes("shiplog-entry"),
    `the panel sits outside the decision-and-release section: ${ancestors.join(" < ")}`);

  assert.equal(open.getAttribute("aria-controls"), "decision-log-follow-up-panel");
  assert.equal(open.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  open.click();
  assert.equal(panel.hidden, false);
  assert.equal(open.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement?.id, "decision-log-follow-up-email");

  // The topic is readable before anything is sent, and it names the log rather
  // than the bundled spend example the other panel is about.
  const topic = byId(document, "decision-log-follow-up-topic");
  assert.equal(topic.value, DECISION_LOG_FOLLOW_UP_TOPIC);
  assert.match(topic.value, /decision and release log/i);
  assert.doesNotMatch(topic.value, /FinOps|Atlas Platform|recoverable/i);
  assert.equal(topic.getAttribute("readonly"), "");

  // Every stop a visitor can Tab to inside the panel is labelled where they can
  // see it: a button says what it does, a field has a <label> pointing at it.
  const inside = (node) => {
    for (let parent = node; parent; parent = parent.parentNode) {
      if (parent === panelWrapper) return true;
    }
    return false;
  };
  const stops = tabSequence(document).filter(inside);
  assert.equal(stops.length, 4, `the panel offers ${stops.length} tab stops: ${stops.map((n) => n.tagName)}`);
  for (const stop of stops) {
    if (stop.tagName === "BUTTON") {
      assert.ok(textOf(stop).length > 0, "a control in the panel renders no words");
      continue;
    }
    const label = document.querySelector(`label[for="${stop.id}"]`);
    assert.ok(label, `#${stop.id} has no visible label`);
    assert.ok(textOf(label).length > 0, `#${stop.id}'s label renders no words`);
  }
});

test("both homepage panels say what is sent in the same words, from the same constant", async (t) => {
  const { document } = await openHomepage(t);
  for (const prefix of ["finops-example-follow-up", "decision-log-follow-up"]) {
    assert.equal(shown(document, `${prefix}-disclosure`), FIXED_TOPIC_DISCLOSURE,
      `${prefix}: the fields-sent sentence has drifted from the shared constant`);
    // The sentence is the field's accessible description, so it is read out with
    // the control rather than only sitting near it.
    assert.match(byId(document, `${prefix}-email`).getAttribute("aria-describedby") ?? "",
      new RegExp(`${prefix}-disclosure`), `${prefix}: the field names no fields-sent description`);
  }

  // Neither panel collects anything the other does not: one work email, one
  // fixed topic, and nothing else that a visitor could fill in.
  for (const prefix of ["finops-example-follow-up", "decision-log-follow-up"]) {
    const fields = byId(document, `${prefix}-form`).querySelectorAll("input");
    assert.deepEqual(fields.map((node) => node.getAttribute("name")), ["topic", "email"],
      `${prefix}: the form collects something other than the fixed topic and a work email`);
    assert.equal(fields[0].getAttribute("readonly"), "", `${prefix}: the topic is editable`);
  }
});

test("the two panels are two nodes, not one form found twice", async (t) => {
  const { document } = await openHomepage(t);
  const submits = ["finops-example-follow-up", "decision-log-follow-up"]
    .map((prefix) => byId(document, `${prefix}-form`).querySelectorAll('button[type="submit"]'));
  for (const [index, found] of submits.entries()) {
    assert.equal(found.length, 1, `panel ${index} has ${found.length} submit controls`);
  }
  assert.deepEqual(submits.map(([button]) => textOf(button)),
    ["Request a follow-up about this example", "Request a follow-up about this log"]);

  const emails = document.querySelectorAll('input[type="email"]');
  const ids = emails.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, `two work-email fields share an id: ${ids.join(", ")}`);
  for (const id of ["finops-example-follow-up-email", "decision-log-follow-up-email"]) {
    assert.equal(ids.filter((found) => found === id).length, 1, `#${id} is not exactly one node`);
  }
});

test("a request from the log panel names the log on the payload and in the row", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());

  // The backend half first: the request type the panel sends is one the endpoint
  // accepts and the migrated schema stores.
  assert.ok(LEAD_PURPOSES.includes(DECISION_LOG_FOLLOW_UP_PURPOSE));
  const response = await onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "log@example.com", purpose: DECISION_LOG_FOLLOW_UP_PURPOSE }),
    }),
    env: { DB: db },
  });
  assert.equal(response.status, 201);
  const row = db.raw.prepare("SELECT email, purpose FROM lead_submissions WHERE email = ?").get("log@example.com");
  assert.equal(row.purpose, DECISION_LOG_FOLLOW_UP_PURPOSE,
    "the row does not record the topic the visitor read");
  assert.notEqual(row.purpose, FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE);

  // And the front half sends exactly that, in place, with no navigation.
  const { document, calls } = await openHomepage(t);
  byId(document, "decision-log-follow-up-open").click();
  submitPanel(document, "decision-log-follow-up", "log@example.com");
  await settle();

  assert.equal(byId(document, "decision-log-follow-up-form").dataset.state, "success",
    shown(document, "decision-log-follow-up-status"));
  assert.match(shown(document, "decision-log-follow-up-status"), /Someone from Wawalu will reply by email/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/leads");
  assert.deepEqual(JSON.parse(calls[0].options.body),
    { email: "log@example.com", purpose: DECISION_LOG_FOLLOW_UP_PURPOSE });
  assert.deepEqual(document.navigations ?? [], [], "a landed request must not take the reader anywhere");
  // The confirmation replaces nothing above it: the section a visitor was
  // reading is still there.
  assert.match(shown(document, "shiplog-entry"), /Know why it shipped/);
});

test("a refused request keeps the typed address and leaves the control ready to retry", async (t) => {
  let attempt = 0;
  const { document, calls } = await openHomepage(t, async () => {
    attempt += 1;
    return attempt === 1 ? reply({ error: { code: "storage_error" } }, 500) : reply({ captured: true, created: true });
  });
  byId(document, "decision-log-follow-up-open").click();

  // Nothing typed yet: the local check refuses before a request is made.
  submitPanel(document, "decision-log-follow-up", "");
  assert.equal(calls.length, 0);
  assert.match(shown(document, "decision-log-follow-up-error"), /work email/i);

  const email = submitPanel(document, "decision-log-follow-up", "log@example.com");
  await settle();
  const form = byId(document, "decision-log-follow-up-form");
  assert.equal(form.dataset.state, "error");
  assert.equal(email.value, "log@example.com", "the typed address was cleared on failure");
  assert.doesNotMatch(shown(document, "decision-log-follow-up-status"), /will reply|requested\./i);
  const submit = form.querySelector('button[type="submit"]');
  assert.ok(!submit.disabled, "the retry control is disabled after a failure");

  // Retry from the same page, without a reload, and it lands.
  pressEnter(document);
  await settle();
  assert.equal(form.dataset.state, "success");
  assert.equal(calls.length, 2);
});

test("succeeding in one panel leaves the other untouched and unsubmitted", async (t) => {
  const { document, calls } = await openHomepage(t);
  byId(document, "decision-log-follow-up-open").click();
  byId(document, "finops-example-follow-up-open").click();

  submitPanel(document, "decision-log-follow-up", "log@example.com");
  await settle();
  assert.equal(byId(document, "decision-log-follow-up-form").dataset.state, "success");
  assertUntouched(document, "finops-example-follow-up", "the takeaway panel after the log panel succeeded");
  assert.deepEqual(calls.map(({ options }) => JSON.parse(options.body).purpose),
    [DECISION_LOG_FOLLOW_UP_PURPOSE], "one submission sent two requests");

  // And back the other way, on the same page, after the first one is terminal.
  submitPanel(document, "finops-example-follow-up", "finops@example.com");
  await settle();
  assert.equal(byId(document, "finops-example-follow-up-form").dataset.state, "success");
  assert.deepEqual(calls.map(({ options }) => JSON.parse(options.body).purpose),
    [DECISION_LOG_FOLLOW_UP_PURPOSE, FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE]);
  // The first panel's confirmation is still its own, and still there.
  assert.match(shown(document, "decision-log-follow-up-status"), /Follow-up requested/);
  assert.equal(byId(document, "decision-log-follow-up-email").value, "log@example.com");
});

test("failing in one panel leaves the other untouched and unsubmitted", async (t) => {
  const { document, calls } = await openHomepage(t, async () => reply({ error: { code: "storage_error" } }, 500));
  byId(document, "decision-log-follow-up-open").click();
  byId(document, "finops-example-follow-up-open").click();

  submitPanel(document, "finops-example-follow-up", "finops@example.com");
  await settle();
  assert.equal(byId(document, "finops-example-follow-up-form").dataset.state, "error");
  assertUntouched(document, "decision-log-follow-up", "the log panel after the takeaway panel failed");
  assert.equal(shown(document, "decision-log-follow-up-error"), "");
  assert.deepEqual(calls.map(({ options }) => JSON.parse(options.body).purpose),
    [FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE]);

  // The other direction: a failure in the log panel says nothing about the
  // takeaway panel, which is still sitting in its own error state.
  submitPanel(document, "decision-log-follow-up", "log@example.com");
  await settle();
  assert.equal(byId(document, "decision-log-follow-up-form").dataset.state, "error");
  assert.equal(byId(document, "finops-example-follow-up-email").value, "finops@example.com");
  assert.deepEqual(calls.map(({ options }) => JSON.parse(options.body).purpose),
    [FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE, DECISION_LOG_FOLLOW_UP_PURPOSE]);
});

test("the typed address never becomes markup, a URL, or a diagnostic string", async (t) => {
  // The harness parses no markup, so an innerHTML regression cannot fail a page
  // test. Pinned at the source instead: this module has no markup sink at all.
  const source = await readFile(MODULE, "utf8");
  for (const sink of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/]) {
    assert.doesNotMatch(source, sink, `the binder writes markup: ${sink}`);
  }

  const logged = [];
  const console_error = console.error;
  console.error = (...args) => logged.push(args.map(String).join(" "));
  // Shaped like an address so it gets past the local check and onto the wire:
  // the render path, not the validator, is what this test is about.
  const hostile = "<img/src=x/onerror=alert(1)>@evil.example";
  try {
    const { document, calls } = await openHomepage(t, async () => reply({ error: { code: "invalid_email" } }, 422));
    byId(document, "decision-log-follow-up-open").click();
    submitPanel(document, "decision-log-follow-up", hostile);
    await settle();

    // It went in the body and nowhere else.
    assert.equal(calls[0].url, "/api/leads");
    assert.equal(JSON.parse(calls[0].options.body).email, hostile);
    for (const rendered of [
      shown(document, "decision-log-follow-up-status"),
      shown(document, "decision-log-follow-up-error"),
      shown(document, "shiplog-entry"),
    ]) {
      assert.doesNotMatch(rendered, /onerror|<img/, `the failure path echoed the typed value: ${rendered}`);
    }
    assert.deepEqual(logged, [], "the failure path logged a diagnostic containing visitor input");
    // The field keeps what was typed so the visitor can correct it.
    assert.equal(byId(document, "decision-log-follow-up-email").value, hostile);
  } finally {
    console.error = console_error;
  }
});
