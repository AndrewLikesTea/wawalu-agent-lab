// #2877: Social, People and Agent observatory are separate lab tools, and their
// footer follow-up form asks whether the request is about Shiplog or about the
// tool on the page. The choice is held here from the click to the row and back:
// the radio in the markup, the topic on the wire, what the endpoint accepts and
// stores, and the subject the receipt names.
//
// Every submission goes through functions/api/leads.js over a SQLite database
// migrated from the checked-in migrations, so "stored" means a row, and nothing
// reaches the network.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { loadPage, pressEnter, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { createTestD1 } from "./support/d1-sqlite.js";
import { onRequest } from "../functions/api/leads.js";
import { FOLLOW_UP_TOOL_TOPICS, FOLLOW_UP_TOPICS } from "../src/leads.js";
import {
  FOLLOW_UP_INTENTS, FOLLOW_UP_PRIVACY_WITH_MESSAGE, FOLLOW_UP_REPLY, FOLLOW_UP_USE,
} from "../src/lead-capture.js";
import {
  CONFIRMATION_INTENT_DETAIL, INTENT_LEAD, SUBJECT_LEAD,
} from "../src/follow-up-confirmation.js";

const SRC = new URL("../src/", import.meta.url);
const EMAIL = "lead@example.com";
const byId = (document, id) => document.getElementById(id);

// Page, purpose, and the tool's name as the radio, the wire and the row carry it.
const TOOL_PAGES = [
  ["social.html", "follow_up_social", "Social (a separate lab tool)"],
  ["profile.html", "follow_up_people", "People (a separate lab tool)"],
  ["agents.html", "follow_up_agents", "Agent observatory (a separate lab tool)"],
];

const rows = (db) => db.raw.prepare("SELECT email, purpose, topic, message, intent FROM lead_submissions").all()
  .map((row) => ({ ...row }));

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

function sendEmail(document) {
  const field = byId(document, "site-footer-email");
  field.value = "";
  field.focus();
  typeText(document, EMAIL);
  pressEnter(document);
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
  "the follow-up submission to settle");

function post(db, body) {
  return onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    env: { DB: db },
  });
}

test("the tool names on the pages are the endpoint's, one per tool page", () => {
  assert.deepEqual(Object.fromEntries(TOOL_PAGES.map(([, purpose, tool]) => [purpose, tool])), FOLLOW_UP_TOOL_TOPICS);
});

for (const [file, purpose, tool] of TOOL_PAGES) {
  test(`${file}: the form offers Shiplog, checked, and the page's tool by name`, async (t) => {
    const page = await loadPage(new URL(file, SRC));
    t.after(() => page.restore());
    const { document } = page;
    const group = byId(document, "site-footer-subject");
    assert.ok(group, `${file}: no subject choice`);
    assert.equal(group.tagName, "FIELDSET");
    assert.equal(textOf(group.querySelector("legend")), "Ask about");
    const radios = [...group.querySelectorAll('input[name="subject"]')];
    assert.equal(radios.length, 2);
    assert.deepEqual(radios.map((radio) => radio.getAttribute("type")), ["radio", "radio"]);
    assert.deepEqual(radios.map((radio) => radio.getAttribute("value")), ["", tool]);
    assert.deepEqual(radios.map((radio) => radio.checked), [true, false]);
    const [shiplogLabel, toolLabel] = [...group.querySelectorAll("label")];
    assert.equal(shiplogLabel.getAttribute("for"), "site-footer-subject-shiplog");
    assert.equal(textOf(shiplogLabel), "Shiplog");
    assert.equal(toolLabel.getAttribute("for"), "site-footer-subject-tool");
    assert.equal(textOf(toolLabel), tool);
    // Not part of Shiplog, and no claim about price, availability, customers,
    // adoption or results.
    assert.doesNotMatch(tool, /shiplog|pric|availab|customer|adopt|result|pilot/i);
    assert.match(tool, /\(a separate lab tool\)$/);

    // The choice sits inside the footer form, before the Shiplog questions, and
    // the Shiplog path is all still there.
    const form = byId(document, "site-footer-form");
    assert.equal(form.querySelectorAll("#site-footer-subject").length, 1);
    assert.deepEqual([...byId(document, "site-footer-intent").querySelectorAll('input[name="intent"]')]
      .map((radio) => radio.getAttribute("value")), Object.keys(FOLLOW_UP_INTENTS));
    assert.equal(form.getAttribute("data-follow-up-topic"), FOLLOW_UP_TOPICS[purpose]);
    assert.equal(textOf(byId(document, "site-footer-note")), FOLLOW_UP_PRIVACY_WITH_MESSAGE);
    assert.equal(textOf(byId(document, "site-footer-use")), FOLLOW_UP_USE);
    assert.equal(textOf(byId(document, "site-footer-reply")), FOLLOW_UP_REPLY);
    assert.equal(textOf(form.querySelectorAll('button[type="submit"]')[0]), "Request a follow-up");
  });

  test(`${file}: Shiplog, the default, sends and stores exactly the request it always did`, async (t) => {
    const db = await createTestD1();
    t.after(() => db.close());
    const { document, calls } = await mountAgainstEndpoint(t, file, db);

    byId(document, "site-footer-intent-demo").click();
    sendEmail(document);
    await settled(document);

    assert.equal(byId(document, "site-footer-form").dataset.state, "success",
      textOf(byId(document, "site-footer-status")));
    assert.deepEqual(calls, [{ email: EMAIL, purpose, topic: FOLLOW_UP_TOPICS[purpose], intent: "demo" }]);
    assert.deepEqual(rows(db), [{ email: EMAIL, purpose, topic: FOLLOW_UP_TOPICS[purpose], message: null, intent: "demo" }]);
    const receipt = textOf(byId(document, "site-footer-confirmation"));
    assert.ok(receipt.includes(`${SUBJECT_LEAD}Shiplog. `), receipt);
    assert.ok(receipt.includes(`${INTENT_LEAD}${FOLLOW_UP_INTENTS.demo}. `), receipt);
    assert.ok(!receipt.includes(tool), receipt);
  });

  test(`${file}: choosing the tool sends its name as the topic, stores it, and names it back`, async (t) => {
    const db = await createTestD1();
    t.after(() => db.close());
    const { document, calls } = await mountAgainstEndpoint(t, file, db);

    // The Shiplog questions stop applying, so none is required or sent.
    byId(document, "site-footer-subject-tool").click();
    assert.equal(byId(document, "site-footer-intent").getAttribute("disabled"), "");
    sendEmail(document);
    await settled(document);

    assert.equal(byId(document, "site-footer-form").dataset.state, "success",
      textOf(byId(document, "site-footer-status")));
    assert.deepEqual(calls, [{ email: EMAIL, purpose, topic: tool }]);
    assert.deepEqual(rows(db), [{ email: EMAIL, purpose, topic: tool, message: null, intent: null }]);
    const receipt = textOf(byId(document, "site-footer-confirmation"));
    assert.ok(receipt.includes(`${SUBJECT_LEAD}${tool}. `), receipt);
    assert.ok(receipt.includes(CONFIRMATION_INTENT_DETAIL), receipt);
    assert.ok(!receipt.includes(INTENT_LEAD), receipt);
    assert.ok(!receipt.includes(`${SUBJECT_LEAD}Shiplog`), receipt);
  });

  test(`${file}: switching back to Shiplog asks the Shiplog question again`, async (t) => {
    const db = await createTestD1();
    t.after(() => db.close());
    const { document, calls } = await mountAgainstEndpoint(t, file, db);

    byId(document, "site-footer-subject-tool").click();
    byId(document, "site-footer-subject-shiplog").click();
    assert.equal(byId(document, "site-footer-intent").getAttribute("disabled"), null);
    sendEmail(document);
    assert.equal(calls.length, 0, "no intent chosen, so nothing is sent");
    assert.equal(byId(document, "site-footer-intent").getAttribute("aria-invalid"), "true");
  });
}

test("no other page offers the subject choice", async () => {
  const files = (await readdir(SRC)).filter((name) => name.endsWith(".html"));
  const offering = [];
  for (const file of files) {
    if ((await readFile(new URL(file, SRC), "utf8")).includes('id="site-footer-subject"')) offering.push(file);
  }
  assert.deepEqual(offering.sort(), TOOL_PAGES.map(([file]) => file).sort());
});

test("index.html's footer form has no subject choice and sends no tool topic", async (t) => {
  const page = await loadPage(new URL("index.html", SRC));
  t.after(() => page.restore());
  assert.equal(page.document.querySelectorAll('input[name="subject"]').length, 0);
});

test("the endpoint takes a tool topic only on its own purpose, and with no intent", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const refused = async (body, code) => {
    const response = await post(db, body);
    assert.equal(response.status, code === "invalid_request" ? 400 : 422, JSON.stringify(body));
    assert.equal((await response.json()).error.code, code);
  };
  await refused({ email: EMAIL, purpose: "follow_up_social", topic: "Social (a lab tool)" }, "invalid_topic");
  await refused({ email: EMAIL, purpose: "follow_up_social", topic: FOLLOW_UP_TOOL_TOPICS.follow_up_people }, "invalid_topic");
  await refused({ email: EMAIL, purpose: "follow_up_coach", topic: FOLLOW_UP_TOOL_TOPICS.follow_up_social }, "invalid_topic");
  await refused({ email: EMAIL, purpose: "follow_up_releases", topic: "Releases (a separate lab tool)" }, "invalid_topic");
  await refused({ email: EMAIL, purpose: "follow_up_agents", topic: FOLLOW_UP_TOOL_TOPICS.follow_up_agents, intent: "demo" },
    "invalid_request");
  // The page topic without an intent is still refused: the Shiplog path asks.
  await refused({ email: EMAIL, purpose: "follow_up_agents", topic: FOLLOW_UP_TOPICS.follow_up_agents }, "invalid_intent");
  assert.deepEqual(rows(db), []);
});

test("a repeat request keeps the row on the subject the visitor chose last", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const purpose = "follow_up_people";
  const tool = { email: EMAIL, purpose, topic: FOLLOW_UP_TOOL_TOPICS[purpose] };
  const shiplog = { email: EMAIL, purpose, topic: FOLLOW_UP_TOPICS[purpose], intent: "pilot" };

  assert.equal((await post(db, tool)).status, 201);
  const back = await post(db, shiplog);
  assert.equal(back.status, 200);
  assert.deepEqual(await back.json(), { captured: true, created: false, purpose, intent: "pilot" });
  assert.deepEqual(rows(db), [{ ...shiplog, message: null }]);

  const again = await post(db, tool);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { captured: true, created: false, purpose });
  assert.deepEqual(rows(db), [{ ...tool, message: null, intent: null }]);
});
