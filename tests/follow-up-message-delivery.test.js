// The typed question in "What do you want to know?" — from the field to the row
// and back into the receipt, on every page and topic that renders the field.
//
// The message tests that shipped with the field stub the transport, and a stub
// answers whatever it is told to. Two things hid behind that:
//
//   1. The endpoint gates a `message` key behind FOLLOW_UP_MESSAGE_PURPOSES and
//      refuses the whole body as `invalid_request` when the key arrives on a
//      purpose that is not in it. Until that list was widened, five of the six
//      forms rendering the field sent a question the endpoint would not read,
//      and the visitor — the one who cared enough to type a question — landed on
//      "Retry your follow-up request". A stubbed 201 says nothing about that, so
//      every submission below goes through functions/api/leads.js over a SQLite
//      database migrated from the checked-in migrations. A purpose the endpoint
//      refuses fails here, and "success" means a row with the message in it.
//   2. The receipt. Every page that offers the field also asks what to discuss,
//      and the stubs replied without an `intent`, so the confirmation took its
//      message branch in the tests and its intent branch in production: the one
//      thing the visitor actually typed went unnamed in the account of what was
//      sent. It is named on both branches now, and the pages are driven here
//      against the endpoint that really does answer with a stored intent.
//
// The guard below is the part that keeps this true without another incident: for
// every form in src/*.html, message-field-present and purpose-accepts-message
// are asserted to be the same fact. A page that starts rendering the field on a
// purpose the endpoint refuses fails that test rather than a prospect's request.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { loadPage, parseHtml, pressEnter, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { createTestD1 } from "./support/d1-sqlite.js";
import { onRequest } from "../functions/api/leads.js";
import {
  createMemoryLeadStore, FOLLOW_UP_MESSAGE_PURPOSES, FOLLOW_UP_TOPICS, handleLeadRequest, POST_FOLLOW_UP_TOPIC,
} from "../src/leads.js";
import { CONTACT_COPY, MAX_FOLLOW_UP_MESSAGE_LENGTH, resolveFailure } from "../src/lead-capture.js";
import {
  CONFIRMATION_INTENT_DETAIL, CONFIRMATION_INTENT_MESSAGE_DETAIL,
} from "../src/follow-up-confirmation.js";
import { FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE } from "../src/homepage-executive-takeaway.js";

const SRC = new URL("../src/", import.meta.url);
const EMAIL = "director@example.com";
const byId = (document, id) => document.getElementById(id);

/**
 * Every (page, topic, purpose) the footer's message field ships on, with the
 * question a visitor on that page would actually type.
 *
 * The topics come from FOLLOW_UP_TOPICS rather than from strings typed here, so
 * the pair cannot drift away from what the endpoint accepts for that purpose.
 * The individual post shares Social's purpose and states its own fixed topic.
 */
const ASKS = [
  ["agents.html", "follow_up_agents", FOLLOW_UP_TOPICS.follow_up_agents,
    "Which of these runs had a human reviewer?"],
  ["coach.html", "follow_up_coach", FOLLOW_UP_TOPICS.follow_up_coach,
    "Can the coach grade our own prompt library?"],
  ["post.html", "follow_up_social", POST_FOLLOW_UP_TOPIC,
    "Who decided to ship the change in this post?"],
  ["profile.html", "follow_up_people", FOLLOW_UP_TOPICS.follow_up_people,
    "Can we see image posts by team rather than by name?"],
  ["releases.html", "follow_up_releases", FOLLOW_UP_TOPICS.follow_up_releases,
    "Which release carried the routing decision?"],
  ["social.html", "follow_up_social", FOLLOW_UP_TOPICS.follow_up_social,
    "How do you keep customer data out of these posts?"],
];

// The seventh form that renders the field is the home page's AI FinOps panel,
// which is script-drawn and has its own end-to-end coverage in
// tests/homepage-executive-takeaway.test.js. It is in the guard below, because
// the guard's whole job is to know about every form that ships the field.
const FINOPS_FORM_PURPOSE = Object.freeze({
  "finops-example-follow-up-form": FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE,
});

const rows = (db) => db.raw.prepare("SELECT email, purpose, topic, message, intent FROM lead_submissions").all()
  .map((row) => ({ ...row }));

/** The real endpoint, reached the way the shipped page entry reaches it. */
async function mountAgainstEndpoint(t, file, db) {
  const page = await loadPage(new URL(file, SRC));
  await importPageModule("/site-footer-page.js");
  const passthrough = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, options) => {
    if (url !== "/api/leads") return passthrough(url, options);
    calls.push(JSON.parse(options.body));
    return onRequest({ request: new Request(`https://labs.wawalu.org${url}`, options), env: { DB: db } });
  };
  t.after(() => {
    globalThis.fetch = passthrough;
    page.restore();
  });
  return { document: page.document, calls };
}

function ask(document, question) {
  const field = byId(document, "site-footer-message");
  field.value = "";
  field.focus();
  typeText(document, question);
  return field;
}

function submit(document, intent = "pilot") {
  byId(document, `site-footer-intent-${intent}`).click();
  const field = byId(document, "site-footer-email");
  field.value = "";
  field.focus();
  typeText(document, EMAIL);
  pressEnter(document);
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
  "the follow-up submission to settle");

/* ------------------------- the invariant, directly ------------------------- */

test("every form that renders the message field sends a purpose the endpoint accepts a message on", async () => {
  const files = (await readdir(SRC)).filter((name) => name.endsWith(".html")).sort();
  const asking = new Map();
  for (const file of files) {
    const document = parseHtml(await readFile(new URL(file, SRC), "utf8"));
    for (const form of document.querySelectorAll("form")) {
      const purpose = form.getAttribute("data-follow-up-type") ?? FINOPS_FORM_PURPOSE[form.getAttribute("id")] ?? null;
      const fields = form.querySelectorAll('input[name="message"]');
      assert.ok(fields.length <= 1, `${file}: one question per form`);
      const asks = fields.length === 1;
      // The two halves of the contract, held to each other: a field with no
      // purpose behind it is a question the endpoint throws the request away
      // for, and a purpose with no field is a list entry nothing produces.
      if (!purpose) {
        assert.equal(asks, false, `${file}: a form with no follow-up purpose cannot offer a question`);
        continue;
      }
      assert.equal(asks, FOLLOW_UP_MESSAGE_PURPOSES.includes(purpose),
        `${file}: the message field disagrees with FOLLOW_UP_MESSAGE_PURPOSES for ${purpose}`);
      if (!asks) continue;
      asking.set(file, purpose);

      // The counter the field promises a visitor, beside the field itself.
      const id = fields[0].getAttribute("id");
      assert.equal(fields[0].getAttribute("type"), "text");
      assert.ok(form.querySelectorAll(`#${id}-counter`).length === 1, `${file}: ${id} ships no counter`);
      assert.ok(form.querySelectorAll(`#${id}-hint`).length === 1, `${file}: ${id} ships no limit hint`);
      assert.match(textOf(byId(document, `${id}-hint`)), new RegExp(`${MAX_FOLLOW_UP_MESSAGE_LENGTH}`));
      assert.equal(textOf(byId(document, `${id}-counter`)), `${MAX_FOLLOW_UP_MESSAGE_LENGTH}`);
    }
  }

  assert.deepEqual([...new Set(asking.values())].sort(), [...FOLLOW_UP_MESSAGE_PURPOSES].sort(),
    "a purpose the endpoint accepts a message on has no form offering one");
  // Named, so a new page joining this set is a decision somebody wrote down.
  assert.deepEqual([...asking.keys()],
    ["agents.html", "coach.html", "index.html", "post.html", "profile.html", "releases.html", "social.html"]);
});

test("the column's bound is the bound the field and the endpoint state", async () => {
  const migration = await readFile(new URL("../migrations/0011_follow_up_message.sql", import.meta.url), "utf8");
  // A UI limit raised past the column's CHECK would turn a legitimate question
  // into a storage_error, which is the one failure the visitor cannot act on.
  assert.match(migration, new RegExp(`BETWEEN 1 AND ${MAX_FOLLOW_UP_MESSAGE_LENGTH}`));
});

/* ------------------ every page and topic, real endpoint -------------------- */

for (const [file, purpose, topic, question] of ASKS) {
  test(`${file}: a typed question reaches the real endpoint with the address and the topic`, async (t) => {
    const db = await createTestD1();
    t.after(() => db.close());
    const { document, calls } = await mountAgainstEndpoint(t, file, db);

    ask(document, question);
    assert.equal(textOf(byId(document, "site-footer-message-counter")),
      `${MAX_FOLLOW_UP_MESSAGE_LENGTH - question.length}`);
    submit(document);
    await settled(document);

    // Nothing was refused: the purpose this page sends accepts the key its form
    // offers. Before the list was widened this was a 400 and an error state.
    assert.equal(byId(document, "site-footer-form").dataset.state, "success",
      textOf(byId(document, "site-footer-status")));
    assert.deepEqual(calls, [{ email: EMAIL, purpose, topic, message: question, intent: "pilot" }]);
    // The three things the delivered request has to carry, in the row.
    assert.deepEqual(rows(db), [{ email: EMAIL, purpose, topic, message: question, intent: "pilot" }]);

    // And the receipt names the question among what was sent. The endpoint
    // answers with the stored intent on every one of these purposes, so this is
    // the branch a real visitor gets — the one that used to drop the message.
    const receipt = textOf(byId(document, "site-footer-confirmation"));
    assert.ok(receipt.includes(CONFIRMATION_INTENT_MESSAGE_DETAIL), receipt);
    assert.match(receipt, /the message you entered/);
    assert.ok(receipt.includes(EMAIL), "the receipt names the address it was sent with");
    assert.ok(receipt.includes(topic), "and the page topic it was sent about");
    // Acknowledged, not echoed: the same rule the AI FinOps receipt follows.
    assert.doesNotMatch(receipt, new RegExp(question.slice(0, 20)));
    assert.doesNotMatch(receipt, /business day|within \d|we will reply|hours/i);
  });

  test(`${file}: the question left empty sends and stores no message`, async (t) => {
    const db = await createTestD1();
    t.after(() => db.close());
    const { document, calls } = await mountAgainstEndpoint(t, file, db);

    // Whitespace, not nothing: a visitor who tabbed through the field and hit
    // the space bar has not asked anything, and an empty string is not the same
    // request as no message at all — the column refuses a zero-length message.
    ask(document, "   ");
    submit(document, "demo");
    await settled(document);

    assert.equal(byId(document, "site-footer-form").dataset.state, "success",
      textOf(byId(document, "site-footer-status")));
    assert.deepEqual(Object.keys(calls[0]), ["email", "purpose", "topic", "intent"]);
    assert.deepEqual(rows(db), [{ email: EMAIL, purpose, topic, message: null, intent: "demo" }]);
    // A receipt may not name a message that was never sent.
    const receipt = textOf(byId(document, "site-footer-confirmation"));
    assert.ok(receipt.includes(CONFIRMATION_INTENT_DETAIL), receipt);
    assert.doesNotMatch(receipt, /the message you entered/);
  });
}

/* ------------------------- the endpoint's own bound ------------------------ */

test("the endpoint holds every message purpose to the limit its field states, and stores nothing over it", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const body = (purpose, message) => ({
    email: `${purpose}@example.com`,
    purpose,
    topic: FOLLOW_UP_TOPICS[purpose],
    message,
    // Only the purposes whose form asks may send this, and they must.
    ...(purpose === FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE ? {} : { intent: "pilot" }),
  });
  const post = (payload) => onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }),
    env: { DB: db },
  });

  for (const purpose of FOLLOW_UP_MESSAGE_PURPOSES) {
    const refused = await post(body(purpose, "y".repeat(MAX_FOLLOW_UP_MESSAGE_LENGTH + 1)));
    assert.equal(refused.status, 422, purpose);
    assert.equal((await refused.json()).error.code, "invalid_message", purpose);

    // The last character the field allows is accepted and kept whole: a stored
    // half-question is worse than a refused one.
    const accepted = await post(body(purpose, "y".repeat(MAX_FOLLOW_UP_MESSAGE_LENGTH)));
    assert.equal(accepted.status, 201, `${purpose}: ${JSON.stringify(await accepted.clone().json())}`);
    assert.deepEqual(await accepted.json(),
      { captured: true, created: true, purpose, ...(purpose === FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE ? {} : { intent: "pilot" }) });

    // A non-string is not a short message; it is a body no form produced.
    const shaped = await post(body(purpose, { text: "hello" }));
    assert.equal(shaped.status, 422, purpose);
    assert.equal((await shaped.json()).error.code, "invalid_message", purpose);
  }

  const stored = rows(db);
  assert.equal(stored.length, FOLLOW_UP_MESSAGE_PURPOSES.length, "one row per purpose, and nothing refused");
  assert.ok(stored.every((row) => row.message.length === MAX_FOLLOW_UP_MESSAGE_LENGTH));
});

test("a purpose whose form offers no question cannot carry one", async () => {
  const store = createMemoryLeadStore();
  const response = await handleLeadRequest(new Request("https://test.invalid/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: EMAIL, purpose: "follow_up_homepage", topic: FOLLOW_UP_TOPICS.follow_up_homepage,
      message: "Smuggled question",
    }),
  }), { store });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
  assert.equal(store.has(EMAIL, "follow_up_homepage"), false, "a refused body stores nothing");
});

test("a refused message reads as a refused message, not as a page to reload", async () => {
  const response = await handleLeadRequest(new Request("https://test.invalid/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: EMAIL, purpose: "follow_up_coach", topic: FOLLOW_UP_TOPICS.follow_up_coach,
      message: "z".repeat(MAX_FOLLOW_UP_MESSAGE_LENGTH + 1), intent: "pilot",
    }),
  }), { store: createMemoryLeadStore() });
  assert.equal(response.status, 422);
  const body = await response.json();

  // `invalid_message` shared the unreadable-request bucket, so the one refusal a
  // visitor can act on told them to reload the page — which throws away the
  // question they typed and changes nothing about why it was refused.
  const failure = resolveFailure(response, body, CONTACT_COPY);
  assert.equal(failure.reason, "invalid_message");
  assert.match(failure.message, /^No request was sent\b/, "a refusal states the definite non-delivery");
  assert.match(failure.message, new RegExp(`${MAX_FOLLOW_UP_MESSAGE_LENGTH}-character limit`));
  assert.match(failure.message, /Shorten it/);
  assert.doesNotMatch(failure.message, /Reload the page/);
});
