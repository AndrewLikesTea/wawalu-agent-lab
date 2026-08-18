// The decision and release log asks for a person of its own.
//
// The home page already carried one work-email request, beside the executive
// takeaway, and its fixed topic is the bundled AI FinOps example. A reader who
// scrolls past that to the log — the other half of what this site is — had
// nothing to press that was about the log, and the one form on the page would
// have filed their question under the example.
//
// So there are two now, and two is the whole risk. The binder they share used
// to look its nodes up by written-out id and keep one form's pending state; if
// either half of that survived, submitting one form would clear, send, or steal
// focus from the other. Every test below that says "the other form" is pinning
// that: one page, two requests, no shared state but the transport.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressEnter, tabSequence, textOf, typeText } from "./support/browser.js";
import {
  bindDecisionLogFollowUp, bindFinopsExampleFollowUp, DECISION_LOG_FOLLOW_UP_PURPOSE,
  FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE,
} from "../src/homepage-executive-takeaway.js";
import { LEAD_PURPOSES } from "../src/leads.js";
import { onRequest } from "../functions/api/leads.js";
import { createTestD1 } from "./support/d1-sqlite.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const NativeResponse = globalThis.Response;

const LOG = "decision-log-follow-up";
const EXAMPLE = "finops-example-follow-up";

const reply = (body, status = 201) => new NativeResponse(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

/** Both of the home page's follow-up forms, wired against one request spy. */
async function openHomePage(t, request = async () => reply({ captured: true, created: true })) {
  const calls = [];
  const spy = async (...args) => {
    calls.push(args);
    return request(...args);
  };
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  bindFinopsExampleFollowUp(page.document, spy);
  bindDecisionLogFollowUp(page.document, spy);
  return { document: page.document, calls };
}

const byId = (document, id) => document.getElementById(id);

/** Open one panel and type an address into it, keystroke by keystroke. */
function fill(document, prefix, value) {
  byId(document, `${prefix}-open`).click();
  const email = byId(document, `${prefix}-email`);
  email.focus();
  typeText(document, value);
  return email;
}

function submit(document, prefix) {
  byId(document, `${prefix}-email`).focus();
  pressEnter(document);
  return new Promise((resolve) => setImmediate(resolve));
}

test("the log section carries a request whose fixed topic names the log, readable before sending", async (t) => {
  const { document } = await openHomePage(t);
  const region = byId(document, LOG);

  // It is part of the log, not a floating panel: the section a reader is in
  // when they decide they want a person is the one that offers them one.
  let ancestor = region.parentNode;
  while (ancestor && ancestor.id !== "record-history") ancestor = ancestor.parentNode;
  assert.equal(ancestor?.id, "record-history", "the request must sit inside the decision and release log");

  // The trigger names the topic on its face, so what the form is about is
  // legible with the panel still shut.
  const open = byId(document, `${LOG}-open`);
  assert.equal(textOf(open), "Request a follow-up about the decision and release log");
  assert.equal(open.getAttribute("aria-expanded"), "false");
  assert.equal(open.getAttribute("aria-controls"), `${LOG}-panel`);

  open.click();
  assert.equal(byId(document, `${LOG}-panel`).hidden, false);
  assert.equal(open.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement?.id, `${LOG}-email`);

  // And the exact topic that will be filed is on the page, in a field, before
  // anything is sent — not only in the payload.
  const topic = byId(document, `${LOG}-topic`);
  assert.equal(topic.value, "Shiplog's decision and release log — recording decisions and linking them to releases");
  assert.equal(topic.getAttribute("readonly"), "");
  assert.match(topic.value, /decision and release log/);

  // Nothing invented: no customer, no quote, no usage or money figure anywhere
  // in the copy this block adds.
  const copy = textOf(region);
  assert.doesNotMatch(copy, /\$[\d,]+|\d+%|customers?\b|“|”/,
    `the log's request invents something it cannot back: ${copy}`);
});

test("the sentence about what is sent is the one the page's other follow-up form uses", async (t) => {
  const { document } = await openHomePage(t);
  byId(document, `${LOG}-open`).click();
  byId(document, `${EXAMPLE}-open`).click();

  // Word for word. Two forms on one page that describe the same transport in
  // two vocabularies is how a reader ends up believing there are two promises.
  const disclosure = textOf(byId(document, `${LOG}-disclosure`));
  assert.equal(disclosure, textOf(byId(document, `${EXAMPLE}-disclosure`)));
  assert.equal(disclosure, "Only your work email and this fixed follow-up topic are sent.");

  // And it is the field's accessible description, so it is read with the
  // control rather than merely near it.
  const described = byId(document, `${LOG}-email`).getAttribute("aria-describedby").split(/\s+/);
  assert.ok(described.includes(`${LOG}-disclosure`), "the field must name the disclosure");
  assert.ok(described.includes(`${LOG}-status`), "the field must name its own outcome region");
});

test("every control in the log's request is reachable by Tab and carries a visible label", async (t) => {
  const { document } = await openHomePage(t);
  const open = byId(document, `${LOG}-open`);
  assert.ok(tabSequence(document).includes(open), "the trigger must sit in the natural tab order");

  open.click();
  const sequence = tabSequence(document);
  for (const id of [`${LOG}-topic`, `${LOG}-email`]) {
    const field = byId(document, id);
    assert.ok(sequence.includes(field), `#${id} is not reachable by Tab`);
    const label = document.querySelector(`label[for="${id}"]`);
    assert.ok(label && textOf(label).length > 0, `#${id} has no visible label`);
  }
  const send = byId(document, `${LOG}-form`).querySelector('button[type="submit"]');
  assert.ok(sequence.includes(send), "the submit control is not reachable by Tab");
  assert.equal(textOf(send), "Request a follow-up about this log");
});

test("either form can be used without touching the other", async (t) => {
  const { document, calls } = await openHomePage(t);
  const logEmail = fill(document, LOG, "log@example.com");
  const exampleEmail = fill(document, EXAMPLE, "example@example.com");

  await submit(document, LOG);

  // The one that was sent reports its own outcome, in its own region, naming
  // the request that landed.
  assert.equal(byId(document, `${LOG}-form`).dataset.state, "success");
  assert.equal(textOf(byId(document, `${LOG}-status`)),
    "Follow-up requested about the decision and release log. Someone from Wawalu will reply by email.");
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0][1].body).purpose, DECISION_LOG_FOLLOW_UP_PURPOSE);

  // The other one is exactly where the visitor left it: same typed address,
  // no state, nothing in its live region, and it did not send.
  const other = byId(document, `${EXAMPLE}-form`);
  assert.equal(exampleEmail.value, "example@example.com");
  assert.equal(other.dataset.state, undefined);
  assert.equal(textOf(byId(document, `${EXAMPLE}-status`)), "");
  assert.ok(!exampleEmail.disabled, "the other form's field must stay usable");
  assert.equal(logEmail.disabled, true, "the sent form's field is closed to a second send");

  // And the second request still works, on the same page, with its own purpose.
  await submit(document, EXAMPLE);
  assert.equal(other.dataset.state, "success");
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1][1].body).purpose, FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE);
  assert.equal(textOf(byId(document, `${EXAMPLE}-status`)),
    "Follow-up requested. Someone from Wawalu will reply by email.");
  // Two outcomes, two regions. Neither overwrote the other.
  assert.match(textOf(byId(document, `${LOG}-status`)), /decision and release log/);
});

test("a rejected address is reported and focused in the form it was typed into", async (t) => {
  const { document, calls } = await openHomePage(t);
  fill(document, EXAMPLE, "example@example.com");
  fill(document, LOG, "not-an-address");

  await submit(document, LOG);

  assert.equal(calls.length, 0, "an address the page can reject must not reach the wire");
  assert.equal(byId(document, `${LOG}-form`).dataset.state, "invalid");
  assert.match(textOf(byId(document, `${LOG}-error`)), /valid work email/i);
  assert.equal(byId(document, `${LOG}-email`).getAttribute("aria-invalid"), "true");
  // Focus went to the field that is wrong, not to the other form's.
  assert.equal(document.activeElement?.id, `${LOG}-email`);
  assert.equal(byId(document, `${EXAMPLE}-error`).hidden, true);
  assert.equal(byId(document, `${EXAMPLE}-email`).getAttribute("aria-invalid"), null);

  // Editing retracts the diagnostic about the field it describes.
  typeText(document, "@example.com");
  assert.equal(byId(document, `${LOG}-error`).hidden, true);
  assert.equal(byId(document, `${LOG}-email`).getAttribute("aria-invalid"), null);
  // The address the other form is holding survived every keystroke of that.
  assert.equal(byId(document, `${EXAMPLE}-email`).value, "example@example.com");
});

test("a failed send keeps the typed address and lets the visitor retry in place", async (t) => {
  let outcome = () => reply({ error: { code: "storage_error" } }, 500);
  const { document, calls } = await openHomePage(t, async () => outcome());
  fill(document, LOG, "log@example.com");

  await submit(document, LOG);

  assert.equal(calls.length, 1);
  const form = byId(document, `${LOG}-form`);
  assert.equal(form.dataset.state, "error");
  // Never a success sentence for a request that failed.
  assert.doesNotMatch(textOf(byId(document, `${LOG}-status`)), /requested|will reply/i);
  assert.match(textOf(byId(document, `${LOG}-status`)), /didn’t get your request/i);
  // What they typed is still there, and the control that sends is live again.
  assert.equal(byId(document, `${LOG}-email`).value, "log@example.com");
  const send = form.querySelector('button[type="submit"]');
  assert.ok(!send.disabled, "the retry control must come back");
  assert.equal(send.getAttribute("aria-disabled"), null);
  // No navigation happened, on either the failure or the retry.
  assert.deepEqual(document.navigations, []);

  outcome = () => reply({ captured: true, created: true });
  await submit(document, LOG);
  assert.equal(calls.length, 2);
  assert.equal(form.dataset.state, "success");
  assert.match(textOf(byId(document, `${LOG}-status`)), /Someone from Wawalu will reply by email/);
  assert.deepEqual(document.navigations, []);
});

test("only the work email and the fixed routing label leave the page", async (t) => {
  const { document, calls } = await openHomePage(t);
  fill(document, LOG, "log@example.com");
  await submit(document, LOG);

  const [url, init] = calls[0];
  assert.equal(url, "/api/leads", "no second endpoint: the one follow-up transport carries this");
  assert.equal(init.method, "POST");
  const body = JSON.parse(init.body);
  // The topic a visitor reads is markup. The purpose a server stores is a
  // constant. Nothing typed anywhere else on this page can widen the body.
  assert.deepEqual(Object.keys(body).sort(), ["email", "purpose"]);
  assert.equal(body.email, "log@example.com");
  assert.equal(body.purpose, DECISION_LOG_FOLLOW_UP_PURPOSE);
  assert.doesNotMatch(init.body, /decision and release log|Shiplog's/);
});

test("the endpoint accepts and stores the log's request type", async (t) => {
  assert.ok(LEAD_PURPOSES.includes(DECISION_LOG_FOLLOW_UP_PURPOSE),
    "the endpoint must recognise the purpose the page sends");
  const db = await createTestD1();
  t.after(() => db.close());

  const response = await onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "log@example.com", purpose: DECISION_LOG_FOLLOW_UP_PURPOSE }),
    }),
    env: { DB: db },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    captured: true, created: true, purpose: DECISION_LOG_FOLLOW_UP_PURPOSE,
  });

  const row = db.raw.prepare("SELECT email, purpose FROM lead_submissions WHERE purpose = ?")
    .get(DECISION_LOG_FOLLOW_UP_PURPOSE);
  assert.equal(row.email, "log@example.com");

  // The two requests are separate rows, so one address can ask about both
  // without the second ask being swallowed as a duplicate.
  const second = await onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "log@example.com", purpose: FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE }),
    }),
    env: { DB: db },
  });
  assert.equal(second.status, 201);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM lead_submissions WHERE email = ?")
    .get("log@example.com").n, 2);
});
