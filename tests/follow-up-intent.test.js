// What a follow-up visitor wants to discuss (#2365), from the radio to the row
// and back.
//
// The first attempt stored the answer with ON CONFLICT DO NOTHING and built the
// receipt from the radio still checked, so a `pilot` request resubmitted as
// `security_data` kept `pilot` in the row while the page confirmed "Security or
// data handling". Both halves are pinned here: the row takes the latest answer,
// and the receipt names only the intent the endpoint read back from storage.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { loadPage, parseHtml, pressEnter, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { createTestD1 } from "./support/d1-sqlite.js";
import { onRequest } from "../functions/api/leads.js";
import { initSiteFooter, INTENT_QUESTION } from "../src/site-footer.js";
import { FOLLOW_UP_INTENT_PURPOSES, FOLLOW_UP_TOPICS } from "../src/leads.js";
import { CONTACT_COPY, FOLLOW_UP_INTENTS, FOLLOW_UP_PRIVACY_WITH_MESSAGE } from "../src/lead-capture.js";

const EMAIL = "buyer@example.com";
const SRC = new URL("../src/", import.meta.url);
const byId = (document, id) => document.getElementById(id);

const post = (db, body) => onRequest({
  request: new Request("https://labs.wawalu.org/api/leads", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }),
  env: { DB: db },
});
const coach = (extra = {}) => ({ email: EMAIL, purpose: "follow_up_coach", topic: FOLLOW_UP_TOPICS.follow_up_coach, ...extra });
// node:sqlite hands back null-prototype rows; spread them into plain objects.
const rows = (db) => db.raw.prepare("SELECT email, purpose, topic, message, intent FROM lead_submissions").all()
  .map((row) => ({ ...row }));

/* ------------------------------ the endpoint ------------------------------ */

test("a resubmission with a new intent updates the one row and answers with the stored intent", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());

  const first = await post(db, coach({ intent: "pilot", message: "First question" }));
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { captured: true, created: true, purpose: "follow_up_coach", intent: "pilot" });

  const second = await post(db, coach({ intent: "security_data", message: "Second question" }));
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(),
    { captured: true, created: false, purpose: "follow_up_coach", intent: "security_data" });

  // Exactly one row, holding the latest intent; the conflict leaves the first
  // request's topic and message as they were.
  assert.deepEqual(rows(db), [{
    email: EMAIL, purpose: "follow_up_coach", topic: FOLLOW_UP_TOPICS.follow_up_coach,
    message: "First question", intent: "security_data",
  }]);
});

test("an intent purpose refuses a missing or unknown intent; other purposes neither need nor take one", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());

  for (const body of [coach(), coach({ intent: "pricing" }), coach({ intent: ["pilot"] }), coach({ intent: null })]) {
    const response = await post(db, body);
    assert.equal(response.status, 422, JSON.stringify(body));
    assert.equal((await response.json()).error.code, "invalid_intent");
  }
  assert.equal(rows(db).length, 0, "a refused intent stores nothing");

  const homepage = { email: EMAIL, purpose: "follow_up_homepage", topic: FOLLOW_UP_TOPICS.follow_up_homepage };
  const accepted = await post(db, homepage);
  assert.equal(accepted.status, 201, "a purpose with no intent field is not refused for leaving it out");
  assert.deepEqual(await accepted.json(), { captured: true, created: true, purpose: "follow_up_homepage" });

  const smuggled = await post(db, { ...homepage, intent: "pilot" });
  assert.equal(smuggled.status, 400, "and an intent its form cannot have sent is an unsupported field");
  assert.equal((await smuggled.json()).error.code, "invalid_request");
  assert.deepEqual(rows(db).map((row) => row.intent), [null]);
});

/* --------------------------- the forms that ask ---------------------------- */

test("exactly the forms whose purpose requires an intent render the question, the four choices, and the sentence", async () => {
  const files = (await readdir(SRC)).filter((name) => name.endsWith(".html")).sort();
  const asking = new Map();
  for (const file of files) {
    const document = parseHtml(await readFile(new URL(file, SRC), "utf8"));
    // Discovered the way tests/follow-up-privacy.test.js discovers them.
    for (const form of document.querySelectorAll("form")) {
      const submit = form.querySelector('button[type="submit"]');
      if (!submit || textOf(submit) !== "Request a follow-up") continue;
      const purpose = form.getAttribute("data-follow-up-type");
      const group = form.querySelector("#site-footer-intent");
      assert.equal(Boolean(group), FOLLOW_UP_INTENT_PURPOSES.includes(purpose),
        `${file}: the intent field disagrees with FOLLOW_UP_INTENT_PURPOSES for ${purpose}`);
      if (!group) continue;
      asking.set(file, purpose);

      assert.equal(group.tagName, "FIELDSET");
      assert.equal(textOf(group.querySelector("legend")), INTENT_QUESTION);
      const radios = form.querySelectorAll('input[name="intent"]');
      assert.deepEqual(radios.map((radio) => radio.getAttribute("value")), Object.keys(FOLLOW_UP_INTENTS));
      assert.deepEqual(radios.map((radio) => textOf(form.querySelector(`label[for="${radio.id}"]`))),
        Object.values(FOLLOW_UP_INTENTS), `${file}: every choice is labelled`);
      assert.ok(radios.every((radio) => radio.type === "radio" && radio.hasAttribute("required")));
      assert.equal(textOf(byId(document, "site-footer-note")), FOLLOW_UP_PRIVACY_WITH_MESSAGE,
        `${file}: the privacy sentence must name what the visitor wants to discuss`);

      // Before the button that sends it.
      const order = form.querySelectorAll("input,button");
      assert.ok(order.indexOf(radios[0]) < order.indexOf(submit), `${file}: the question is below the button`);
    }
  }
  assert.deepEqual([...new Set(asking.values())].sort(), [...FOLLOW_UP_INTENT_PURPOSES].sort(),
    "a purpose that requires an intent has no form asking for it");
  assert.deepEqual([...asking.keys()], ["agents.html", "coach.html", "post.html", "profile.html", "releases.html", "social.html"]);
});

/* ------------------------------ the receipt ------------------------------- */

const reply = (body, status = 200) => () => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

async function mountCoach(transport) {
  const page = await loadPage(new URL("coach.html", SRC));
  const calls = [];
  initSiteFooter(page.document, (url, options) => {
    calls.push(JSON.parse(options.body));
    return transport();
  });
  return { page, document: page.document, calls };
}

function submit(document, intent) {
  if (intent) byId(document, `site-footer-intent-${intent}`).click();
  const field = byId(document, "site-footer-email");
  field.value = "";
  field.focus();
  typeText(document, EMAIL);
  pressEnter(document);
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
  "the follow-up submission to settle");

for (const [name, answered, shown] of [
  ["the intent the endpoint stored", "pilot", "What you want to discuss: A pilot evaluation."],
  ["no intent when the response carries none", undefined, null],
  ["no intent when the response carries an unknown one", "pricing", null],
]) {
  test(`the receipt names ${name}, never the radio still checked`, async () => {
    const { page, document, calls } = await mountCoach(reply({
      captured: true, created: false, purpose: "follow_up_coach", ...(answered && { intent: answered }),
    }));
    try {
      submit(document, "security_data");
      await settled(document);
      assert.equal(calls[0].intent, "security_data", "the visitor's choice is what goes on the wire");
      const receipt = textOf(byId(document, "site-footer-confirmation"));
      assert.doesNotMatch(receipt, /Security or data handling/, "the receipt may not guess from the form");
      if (shown) {
        assert.ok(receipt.includes(shown), receipt);
        assert.ok(receipt.includes("Your discussion choice has been saved."));
        assert.doesNotMatch(receipt, /Only that work email/);
      }
      else assert.doesNotMatch(receipt, /What you want to discuss/);
    } finally {
      page.restore();
    }
  });
}

test("submitting with nothing chosen is stopped here: inline, announced, focused, and nothing sent", async () => {
  const { page, document, calls } = await mountCoach(reply(
    { captured: true, created: true, purpose: "follow_up_coach", intent: "demo" }, 201));
  try {
    submit(document, null);
    const group = byId(document, "site-footer-intent");
    const error = byId(document, "site-footer-intent-error");
    assert.equal(calls.length, 0, "a request the endpoint would refuse must not reach the network");
    assert.equal(byId(document, "site-footer-form").dataset.state, "invalid");
    assert.equal(error.hidden, false);
    assert.equal(textOf(error), CONTACT_COPY.emptyIntent);
    assert.equal(error.getAttribute("role"), "alert");
    assert.equal(group.getAttribute("aria-invalid"), "true");
    assert.ok(group.getAttribute("aria-describedby").split(/\s+/).includes("site-footer-intent-error"));
    assert.equal(document.activeElement?.id, "site-footer-intent-availability_pricing");
    assert.equal(byId(document, "site-footer-email").value, EMAIL, "the typed address is kept");

    // One click clears the refusal, and the next submit goes through.
    byId(document, "site-footer-intent-demo").click();
    assert.equal(error.hidden, true);
    assert.equal(group.getAttribute("aria-invalid"), null);
    assert.ok(!(group.getAttribute("aria-describedby") ?? "").includes("site-footer-intent-error"));
    byId(document, "site-footer-email").focus();
    pressEnter(document);
    await settled(document);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].intent, "demo");
    assert.ok(textOf(byId(document, "site-footer-confirmation"))
      .includes("What you want to discuss: A product demonstration."));

    byId(document, "site-footer-again").click();
    submit(document, "demo");
    await settled(document);
    const receipt = textOf(byId(document, "site-footer-confirmation"));
    assert.equal(receipt.split("Your discussion choice has been saved.").length - 1, 1,
      "reopening and submitting replaces the explanation instead of repeating it");
  } finally {
    page.restore();
  }
});

/* --------------------------- the whole path ------------------------------- */

test("releases.html: the chosen intent and a question reach the real endpoint, land in the row, and come back", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const page = await loadPage(new URL("releases.html", SRC));
  await importPageModule("/site-footer-page.js");
  const { document } = page;
  const passthrough = globalThis.fetch;
  globalThis.fetch = (url, options) => (url === "/api/leads"
    ? onRequest({ request: new Request(`https://labs.wawalu.org${url}`, options), env: { DB: db } })
    : passthrough(url, options));
  try {
    byId(document, "site-footer-message").focus();
    typeText(document, "Which release shipped routing?");
    submit(document, "availability_pricing");
    await settled(document);

    assert.equal(byId(document, "site-footer-form").dataset.state, "success", textOf(byId(document, "site-footer-status")));
    assert.deepEqual(rows(db), [{
      email: EMAIL, purpose: "follow_up_releases", topic: FOLLOW_UP_TOPICS.follow_up_releases,
      message: "Which release shipped routing?", intent: "availability_pricing",
    }]);
    assert.ok(textOf(byId(document, "site-footer-confirmation")).includes("What you want to discuss: Availability or pricing."));
  } finally {
    globalThis.fetch = passthrough;
    page.restore();
  }
});
