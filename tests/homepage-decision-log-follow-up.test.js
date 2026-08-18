// The home page's second follow-up request: the decision and release log.
//
// A visitor convinced by the section that describes the log had two ways on and
// both were more reading. This is the third — reach a person about the log
// itself — and it is deliberately the same shape as the executive takeaway's
// request one screen up, so a reader who has met one already knows this one.
//
// Two forms on one page is the seam. Everything this file exists to prove is
// about that: they share no id, no live region, no error paragraph and no
// module state, and neither of them owns a document-level submit listener, so
// filling, sending, succeeding or failing in one may not clear, submit or alter
// the other. That property is driven rather than described — the last test
// below fails one form and succeeds the other in the same document.
//
// The path is driven end to end too, against the shipped Pages Function over a
// database migrated from the checked-in migrations, because a topic the
// storage layer refuses is a topic the visitor is told was received. The
// purpose CHECK on lead_submissions is what refuses it, migration 0010 is what
// widens it, and the row read back at the end is what says so.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import {
  bindDecisionLogFollowUp, bindFinopsExampleFollowUp, DECISION_LOG_FOLLOW_UP_PURPOSE,
  FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE,
} from "../src/homepage-executive-takeaway.js";
import { onRequest } from "../functions/api/leads.js";
import { createTestD1 } from "./support/d1-sqlite.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const NativeResponse = globalThis.Response;

// The one sentence both panels on this page say about what leaves the browser.
// Byte for byte: two forms that word the same promise two ways are two promises
// a reader has to compare.
const DISCLOSURE = "Only your work email and this fixed follow-up topic are sent.";

const TYPED = "director@example.com";
const byId = (document, id) => document.getElementById(id);
const shown = (document, id) => textOf(byId(document, id));

const reply = (body, status = 201) => new NativeResponse(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

/** Let a submit handler's awaited transport settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** The log's panel alone, wired to a caller-supplied transport. */
async function openLogPanel(t, request) {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  bindDecisionLogFollowUp(page.document, request);
  byId(page.document, "decision-log-follow-up-open").click();
  return page.document;
}

/* ------------------------- the ask, before any script ---------------------- */

test("the decision-and-release section ships its own follow-up form, shaped like the one above it", async (t) => {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  const { document } = page;

  // In the section that describes the log, not in the takeaway that describes
  // the bundled AI FinOps example.
  const section = byId(document, "shiplog-entry");
  assert.equal(section.querySelectorAll("#decision-log-follow-up-panel").length, 1,
    "the follow-up panel must live in the decision and release log's own section");
  assert.equal(section.querySelectorAll("#decision-log-follow-up-open").length, 1);

  const form = byId(document, "decision-log-follow-up-form");
  assert.equal(form.tagName, "FORM");
  assert.equal(byId(document, "decision-log-follow-up-email").getAttribute("type"), "email");
  assert.equal(form.querySelector('button[type="submit"]').getAttribute("type"), "submit");

  // The live region ships with the document rather than being inserted when the
  // state changes: a region created already-populated is not reliably announced.
  const status = byId(document, "decision-log-follow-up-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(textOf(status), "", "the region must start empty, claiming nothing");
  for (let node = status.parentNode; node; node = node.parentNode) {
    assert.notEqual(node.tagName, "DETAILS", "the live region must not sit inside a collapsed disclosure");
  }

  // The error paragraph is shipped hidden and empty, so nothing reads a failure
  // to a visitor who has not submitted anything.
  const error = byId(document, "decision-log-follow-up-error");
  assert.ok(error.hidden, "the error paragraph must ship hidden");
  assert.equal(textOf(error), "");
});

test("the topic is fixed, names the log rather than the bundled example, and is readable before submitting", async (t) => {
  const document = await openLogPanel(t, async () => reply({ captured: true, created: true }));

  const topic = byId(document, "decision-log-follow-up-topic");
  assert.ok(topic.hasAttribute("readonly"), "the topic is fixed, not a field to fill in");
  assert.match(topic.value, /decision and release log/i, "the topic must name the log this section is about");
  assert.match(topic.value, /releases they shape/i);

  // Not the other form's subject, and not a claim about anybody: no customer, no
  // quote and no usage figure is authored anywhere in this panel.
  const panel = textOf(byId(document, "decision-log-follow-up-panel")) + topic.value;
  assert.doesNotMatch(panel, /AI FinOps|Atlas Platform|recoverable/i,
    "this ask is about the log, not about the bundled AI FinOps example");
  assert.doesNotMatch(panel, /\$[\d,]/, "no money figure belongs in a request form");
  assert.doesNotMatch(panel, /\d+\s*(?:%|customers|teams|engineers)/i, "no usage figure either");

  // And it is on screen before anything is sent, beside the field, so a visitor
  // knows what they are asking about before they type an address.
  assert.equal(byId(document, "decision-log-follow-up-panel").hidden, false);
  assert.equal(byId(document, "decision-log-follow-up-form").dataset.state, undefined);
});

test("the panel says what is sent, in the words the other homepage follow-up form uses", async (t) => {
  const document = await openLogPanel(t, async () => reply({ captured: true, created: true }));

  assert.equal(shown(document, "decision-log-follow-up-disclosure"), DISCLOSURE);
  // The same sentence the executive takeaway's form states, byte for byte. Two
  // wordings on one page read as two promises to compare rather than one to
  // rely on, which is the failure tests/follow-up-privacy.test.js exists for on
  // the forms it governs.
  assert.equal(shown(document, "finops-example-follow-up-disclosure"), DISCLOSURE);

  // It is the field's accessible description, so it is read out with the control
  // rather than only sitting near it.
  const described = byId(document, "decision-log-follow-up-email").getAttribute("aria-describedby").split(/\s+/);
  assert.ok(described.includes("decision-log-follow-up-disclosure"));
  assert.ok(described.includes("decision-log-follow-up-status"));
});

/* ------------------------------ the two outcomes --------------------------- */

test("a successful request confirms in place, with no navigation", async (t) => {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  const { document } = page;
  const calls = [];
  bindDecisionLogFollowUp(document, async (url, options) => {
    calls.push({ url, options });
    return reply({ captured: true, created: true, purpose: DECISION_LOG_FOLLOW_UP_PURPOSE });
  });

  byId(document, "decision-log-follow-up-open").click();
  const email = byId(document, "decision-log-follow-up-email");
  email.value = TYPED;
  email.focus();
  pressEnter(document);
  await settle();

  assert.equal(byId(document, "decision-log-follow-up-form").dataset.state, "success");
  assert.match(shown(document, "decision-log-follow-up-status"), /Someone from Wawalu will reply by email/);
  // The address and the fixed label, and nothing else, went to the one endpoint.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/leads");
  assert.deepEqual(JSON.parse(calls[0].options.body),
    { email: TYPED, purpose: DECISION_LOG_FOLLOW_UP_PURPOSE });
  // In place: the reader is still on the page they were reading.
  assert.deepEqual(document.navigations, []);
  assert.equal(byId(document, "decision-log-follow-up-panel").hidden, false);
});

test("a failed request keeps the typed address, claims no receipt, and can be retried", async (t) => {
  let attempt = 0;
  const document = await openLogPanel(t, async () => {
    attempt += 1;
    return attempt === 1
      ? reply({ error: { code: "storage_error" } }, 500)
      : reply({ captured: true, created: true, purpose: DECISION_LOG_FOLLOW_UP_PURPOSE });
  });

  const email = byId(document, "decision-log-follow-up-email");
  email.value = TYPED;
  email.focus();
  pressEnter(document);
  await settle();

  const form = byId(document, "decision-log-follow-up-form");
  assert.equal(form.dataset.state, "error");
  assert.equal(email.value, TYPED, "the typed address must survive the failure, unchanged");
  assert.ok(!email.disabled, "and stay editable");
  assert.equal(email.getAttribute("aria-invalid"), "true");
  assert.doesNotMatch(shown(document, "decision-log-follow-up-status"), /will reply|requested\./i,
    "a failure must not claim a receipt");
  // The retry is the same control, live again, in the form that failed.
  const submit = form.querySelector('button[type="submit"]');
  assert.equal(submit.disabled, false);

  email.focus();
  pressEnter(document);
  await settle();
  assert.equal(form.dataset.state, "success");
  assert.match(shown(document, "decision-log-follow-up-status"), /Someone from Wawalu will reply by email/);
});

test("an address that cannot be one issues no request at all", async (t) => {
  const calls = [];
  const document = await openLogPanel(t, async (...args) => {
    calls.push(args);
    return reply({ captured: true, created: true });
  });

  const email = byId(document, "decision-log-follow-up-email");
  email.value = "director@example";
  email.focus();
  pressEnter(document);

  assert.equal(calls.length, 0, "an invalid address must never reach the network");
  assert.equal(byId(document, "decision-log-follow-up-form").dataset.state, "invalid");
  assert.equal(email.value, "director@example", "and must not be cleared to help");
  assert.match(shown(document, "decision-log-follow-up-error"), /work email/i);
  assert.equal(shown(document, "decision-log-follow-up-status"), "",
    "nothing happened, so the live region says nothing");
});

/* --------------------------- the two forms, apart -------------------------- */

test("the two homepage follow-up forms share no id, no live region and no error paragraph", async (t) => {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  const { document } = page;

  for (const suffix of ["open", "panel", "form", "email", "topic", "error", "status", "disclosure"]) {
    for (const prefix of ["finops-example-follow-up", "decision-log-follow-up"]) {
      const id = `${prefix}-${suffix}`;
      // Counted rather than compared: asserting equality against a harness
      // element deep-inspects the whole parsed page and never returns.
      assert.equal(document.querySelectorAll(`#${id}`).length, 1, `#${id} must exist exactly once`);
    }
  }

  // The trigger names the panel it controls, and only its own.
  assert.equal(byId(document, "decision-log-follow-up-open").getAttribute("aria-controls"),
    "decision-log-follow-up-panel");
  assert.equal(byId(document, "finops-example-follow-up-open").getAttribute("aria-controls"),
    "finops-example-follow-up-panel");
});

test("failing one form does not clear, submit, or alter the other", async (t) => {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  const { document } = page;

  const sent = [];
  const transport = (outcome) => async (url, options) => {
    sent.push(JSON.parse(options.body));
    return outcome;
  };
  bindFinopsExampleFollowUp(document, transport(reply({ error: { code: "storage_error" } }, 500)));
  bindDecisionLogFollowUp(document, transport(reply({ captured: true, created: true })));

  byId(document, "finops-example-follow-up-open").click();
  byId(document, "decision-log-follow-up-open").click();

  // Both fields hold different addresses at the same time.
  const takeaway = byId(document, "finops-example-follow-up-email");
  const log = byId(document, "decision-log-follow-up-email");
  takeaway.value = "takeaway@example.com";
  log.value = "log@example.com";

  // Fail the takeaway's form.
  takeaway.focus();
  pressEnter(document);
  await settle();
  assert.equal(byId(document, "finops-example-follow-up-form").dataset.state, "error");

  // The log's form is untouched by it: same value, no state, nothing sent, and
  // its own live region and error paragraph still say nothing.
  assert.equal(log.value, "log@example.com");
  assert.equal(byId(document, "decision-log-follow-up-form").dataset.state, undefined);
  assert.equal(shown(document, "decision-log-follow-up-status"), "");
  assert.equal(shown(document, "decision-log-follow-up-error"), "");
  assert.equal(log.getAttribute("aria-invalid"), null);
  assert.deepEqual(sent, [{ email: "takeaway@example.com", purpose: FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE }]);

  // Now succeed the log's form; the takeaway's failure state is still its own.
  log.focus();
  pressEnter(document);
  await settle();
  assert.equal(byId(document, "decision-log-follow-up-form").dataset.state, "success");
  assert.equal(takeaway.value, "takeaway@example.com", "a success next door must not clear the other field");
  assert.equal(byId(document, "finops-example-follow-up-form").dataset.state, "error");
  assert.deepEqual(sent[1], { email: "log@example.com", purpose: DECISION_LOG_FOLLOW_UP_PURPOSE });
  assert.equal(sent.length, 2, "one submit must send exactly one request");

  // Two errands, two labels: the row a reply is routed from says which one.
  assert.notEqual(DECISION_LOG_FOLLOW_UP_PURPOSE, FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE);
});

/* ----------------------------- from the keyboard --------------------------- */

test("every control in the panel is reachable by Tab and carries a visible label", async (t) => {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  const { document } = page;
  await importPageModule("/homepage-executive-takeaway.js");

  // The trigger is reached with Tab alone, from the top of the page.
  const open = byId(document, "decision-log-follow-up-open");
  let reached = null;
  for (let press = 0; press < tabSequence(document).length && reached !== open; press += 1) {
    reached = pressTab(document);
  }
  assert.equal(reached, open, "the request must sit in the natural tab order");
  assert.equal(textOf(open), "Request a follow-up about the decision and release log");

  // Pressing it opens the panel and puts the cursor in the field, the same way
  // the takeaway's trigger does.
  pressEnter(document);
  assert.equal(byId(document, "decision-log-follow-up-panel").hidden, false);
  assert.equal(open.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement?.id, "decision-log-follow-up-email");

  // Both fields are labelled by a visible label element pointing at them, and
  // both are in the tab order now that the panel is open.
  const ids = tabSequence(document).map((node) => node.id);
  const form = byId(document, "decision-log-follow-up-form");
  for (const id of ["decision-log-follow-up-topic", "decision-log-follow-up-email"]) {
    const labels = form.querySelectorAll("label").filter((node) => node.getAttribute("for") === id);
    assert.equal(labels.length, 1, `#${id} must have exactly one visible label`);
    assert.ok(textOf(labels[0]).trim().length > 0, `#${id}'s label must say something`);
    assert.ok(ids.includes(id), `#${id} must be reachable by Tab`);
  }

  // And the submit, which names the errand rather than the gesture. It is a tab
  // stop of its own, behind the field a reader fills in first.
  const submit = form.querySelector('button[type="submit"]');
  assert.equal(textOf(submit), "Request a follow-up about this log");
  const sequence = tabSequence(document);
  assert.ok(sequence.includes(submit), "the submit must be reachable by Tab");
  assert.ok(sequence.indexOf(byId(document, "decision-log-follow-up-email")) < sequence.indexOf(submit),
    "the submit follows the field it sends");
});

/* --------------------------- the click to the row -------------------------- */

test("the new topic survives validation and reaches a row in the migrated schema", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());

  const post = (purpose, email) => onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, purpose }),
    }),
    env: { DB: db },
  });

  const created = await post(DECISION_LOG_FOLLOW_UP_PURPOSE, TYPED);
  assert.equal(created.status, 201, "the endpoint must accept the decision-log follow-up purpose");
  assert.deepEqual(await created.json(),
    { captured: true, created: true, purpose: DECISION_LOG_FOLLOW_UP_PURPOSE });

  const row = db.raw.prepare("SELECT email, purpose FROM lead_submissions WHERE purpose = ?")
    .get(DECISION_LOG_FOLLOW_UP_PURPOSE);
  assert.equal(row.email, TYPED);
  assert.equal(row.purpose, DECISION_LOG_FOLLOW_UP_PURPOSE);

  // The two homepage asks are two rows, not one: the same address may ask about
  // the log and about the bundled example, and a reply has to know which.
  assert.equal((await post(FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE, TYPED)).status, 201);
  assert.equal(db.raw.prepare("SELECT count(*) AS count FROM lead_submissions").get().count, 2);

  // A repeat of the same ask is a duplicate, not a second row.
  assert.equal((await post(DECISION_LOG_FOLLOW_UP_PURPOSE, TYPED)).status, 200);
  assert.equal(db.raw.prepare("SELECT count(*) AS count FROM lead_submissions").get().count, 2);
});

test("the endpoint still refuses a purpose nobody declared, and normalizes the address it stores", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());

  const post = (body) => onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    env: { DB: db },
  });

  // Widening the CHECK for one label must not widen it for anything else: the
  // email is still untrusted input and the purpose is still a closed set.
  const refused = await post({ email: TYPED, purpose: "follow_up_decision_log_admin" });
  assert.equal(refused.status, 422);
  assert.equal((await refused.json()).error.code, "invalid_purpose");

  const invalid = await post({ email: "director@example", purpose: DECISION_LOG_FOLLOW_UP_PURPOSE });
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).error.code, "invalid_email");

  // Stored lowercased and trimmed, which is what the table's own CHECK requires.
  assert.equal((await post({ email: "  Director@Example.COM ", purpose: DECISION_LOG_FOLLOW_UP_PURPOSE })).status, 201);
  assert.equal(db.raw.prepare("SELECT email FROM lead_submissions").get().email, TYPED);
  assert.equal(db.raw.prepare("SELECT count(*) AS count FROM lead_submissions").get().count, 1);
});
