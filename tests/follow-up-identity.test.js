// Who is asking (#2995): the optional name and organization on the footer
// follow-up forms, from the field to the row and back to the receipt.
//
// Only the forms that already ask what to discuss carry the two fields, and
// only their purposes may send them. Everywhere else the strict body check
// still refuses the keys, so no surface can store a name it never asked for.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { loadPage, parseHtml, pressEnter, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { createTestD1 } from "./support/d1-sqlite.js";
import { onRequest } from "../functions/api/leads.js";
import { initSiteFooter } from "../src/site-footer.js";
import {
  FOLLOW_UP_INTENT_PURPOSES, FOLLOW_UP_TOOL_TOPICS, FOLLOW_UP_TOPICS, MAX_FOLLOW_UP_IDENTITY_LENGTH,
} from "../src/leads.js";
import { FOLLOW_UP_PRIVACY, FOLLOW_UP_PRIVACY_WITH_MESSAGE } from "../src/lead-capture.js";

const EMAIL = "buyer@example.com";
const SRC = new URL("../src/", import.meta.url);
const byId = (document, id) => document.getElementById(id);
const ASKING_PAGES = ["agents.html", "coach.html", "post.html", "profile.html", "releases.html", "social.html"];

const post = (db, body) => onRequest({
  request: new Request("https://labs.wawalu.org/api/leads", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }),
  env: { DB: db },
});
const coach = (extra = {}) => ({
  email: EMAIL, purpose: "follow_up_coach", topic: FOLLOW_UP_TOPICS.follow_up_coach, intent: "demo", ...extra,
});
const rows = (db) => db.raw.prepare("SELECT purpose, topic, intent, name, organization FROM lead_submissions").all()
  .map((row) => ({ ...row }));

/* ------------------------------ the endpoint ------------------------------ */

test("a supplied name and organization are trimmed and stored on the row", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const response = await post(db, coach({ name: "  Ada Lovelace ", organization: " Analytical Engines Ltd  " }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { captured: true, created: true, purpose: "follow_up_coach", intent: "demo" });
  assert.deepEqual(rows(db), [{
    purpose: "follow_up_coach", topic: FOLLOW_UP_TOPICS.follow_up_coach, intent: "demo",
    name: "Ada Lovelace", organization: "Analytical Engines Ltd",
  }]);
});

test("omitted, null, or blank fields succeed and store NULL", async (t) => {
  for (const extra of [{}, { name: null, organization: null }, { name: "   ", organization: "" }]) {
    const db = await createTestD1();
    t.after(() => db.close());
    const response = await post(db, coach(extra));
    assert.equal(response.status, 201, JSON.stringify(extra));
    assert.deepEqual(rows(db).map(({ name, organization }) => [name, organization]), [[null, null]], JSON.stringify(extra));
  }
});

test("an over-length or non-string name or organization is refused, and nothing is stored", async (t) => {
  const long = "x".repeat(MAX_FOLLOW_UP_IDENTITY_LENGTH + 1);
  for (const extra of [
    { name: long }, { organization: long }, { name: 42 }, { organization: ["Acme"] }, { name: { first: "Ada" } },
    { name: true },
  ]) {
    const db = await createTestD1();
    t.after(() => db.close());
    const response = await post(db, coach(extra));
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.equal((await response.json()).error.code, "invalid_request");
    assert.equal(rows(db).length, 0);
  }
  // Exactly at the cap is fine.
  const db = await createTestD1();
  t.after(() => db.close());
  const atCap = "y".repeat(MAX_FOLLOW_UP_IDENTITY_LENGTH);
  assert.equal((await post(db, coach({ name: atCap, organization: atCap }))).status, 201);
  assert.equal(rows(db)[0].name, atCap);
});

test("only the purposes whose forms render the fields may send them; topics stay exact", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  // The home page, the AI FinOps example and the legacy purposes ship no field.
  for (const purpose of ["follow_up_homepage", "follow_up_finops_example", "field_notes", "follow_up"]) {
    const response = await post(db, {
      email: EMAIL, purpose, ...(FOLLOW_UP_TOPICS[purpose] && { topic: FOLLOW_UP_TOPICS[purpose] }), name: "Ada",
    });
    assert.equal(response.status, 400, purpose);
  }
  // The topic contract is untouched: a wrong topic is still refused with a name.
  const wrongTopic = await post(db, coach({ topic: "Somewhere else", name: "Ada" }));
  assert.equal(wrongTopic.status, 422);
  assert.equal((await wrongTopic.json()).error.code, "invalid_topic");
  // A request about the page's separate tool sends no intent but keeps its name.
  const tool = await post(db, {
    email: EMAIL, purpose: "follow_up_social", topic: FOLLOW_UP_TOOL_TOPICS.follow_up_social,
    name: "Ada", organization: "Acme",
  });
  assert.equal(tool.status, 201);
  assert.deepEqual(rows(db).map(({ name, organization, intent }) => [name, organization, intent]), [["Ada", "Acme", null]]);
});

test("a repeat request fills a field in but never blanks one", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  await post(db, coach({ name: "Ada" }));
  await post(db, coach({ organization: "Acme" }));
  await post(db, coach({ intent: "pilot" }));
  assert.deepEqual(rows(db).map(({ name, organization, intent }) => [name, organization, intent]), [["Ada", "Acme", "pilot"]]);
});

/* -------------------------------- the forms ------------------------------- */

test("every form that asks what to discuss renders the two optional, labelled fields; no other page does", async () => {
  assert.deepEqual([...FOLLOW_UP_INTENT_PURPOSES].sort(),
    ["follow_up_agents", "follow_up_coach", "follow_up_people", "follow_up_releases", "follow_up_social"]);
  const pages = (await readdir(SRC)).filter((file) => file.endsWith(".html"));
  let checked = 0;
  for (const file of pages) {
    const html = await readFile(new URL(file, SRC), "utf8");
    if (!ASKING_PAGES.includes(file)) {
      assert.doesNotMatch(html, /id="site-footer-(name|organization)"/, `${file}: ships an identity field it cannot send`);
      continue;
    }
    const document = parseHtml(html);
    const form = byId(document, "site-footer-form");
    for (const [id, label, autocomplete] of [["name", "Name", "name"], ["organization", "Organization", "organization"]]) {
      const input = byId(document, `site-footer-${id}`);
      assert.ok(input, `${file}: no ${id} field`);
      assert.equal(input.getAttribute("name"), id);
      assert.equal(input.getAttribute("type"), "text");
      assert.equal(input.getAttribute("autocomplete"), autocomplete);
      assert.equal(input.getAttribute("required"), null, `${file}: ${id} must stay optional`);
      assert.ok(!input.required);
      assert.equal(Number(input.getAttribute("maxlength")), MAX_FOLLOW_UP_IDENTITY_LENGTH,
        `${file}: the field and the endpoint must hold the same cap`);
      assert.equal(input.closest("#site-footer-form")?.id, form.id, `${file}: ${id} sits outside the form`);
      const labels = [...form.querySelectorAll("label")].filter((node) => node.getAttribute("for") === `site-footer-${id}`);
      assert.equal(labels.length, 1, `${file}: ${id} needs exactly one label`);
      assert.equal(textOf(labels[0]).replace(/\s+/g, " ").trim(), `${label} (optional)`);
    }
    assert.equal(textOf(byId(document, "site-footer-note")), FOLLOW_UP_PRIVACY_WITH_MESSAGE);
    checked += 1;
  }
  assert.equal(checked, ASKING_PAGES.length, "a page in the table did not parse");
  // The forms without the fields keep the sentence that says nothing else goes.
  assert.doesNotMatch(FOLLOW_UP_PRIVACY, /name|organization/);
});

const reply = (body, status = 201) => () => new Response(JSON.stringify(body), {
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

function fill(document, id, value) {
  const field = byId(document, id);
  field.value = "";
  field.focus();
  if (value) typeText(document, value);
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
  "the follow-up submission to settle");

for (const [label, name, organization, sent] of [
  ["both filled", " Ada Lovelace ", "Acme ", { name: "Ada Lovelace", organization: "Acme" }],
  ["only the organization", "", "Acme", { organization: "Acme" }],
  ["both empty", "", "   ", {}],
]) {
  test(`the payload carries the fields only when filled: ${label}`, async () => {
    const { page, document, calls } = await mountCoach(reply({ captured: true, created: true, purpose: "follow_up_coach", intent: "pilot" }));
    try {
      byId(document, "site-footer-intent-pilot").click();
      fill(document, "site-footer-name", name);
      fill(document, "site-footer-organization", organization);
      fill(document, "site-footer-email", EMAIL);
      pressEnter(document);
      await settled(document);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], {
        email: EMAIL, purpose: "follow_up_coach", topic: FOLLOW_UP_TOPICS.follow_up_coach, intent: "pilot", ...sent,
      });
      assert.equal(byId(document, "site-footer-form").dataset.state, "success");
      const receipt = textOf(byId(document, "site-footer-confirmation"));
      assert.ok(receipt.includes(`Fixed page topic: ${FOLLOW_UP_TOPICS.follow_up_coach}.`), receipt);
      assert.ok(receipt.includes("What you want to discuss: A pilot evaluation."), receipt);
      assert.ok(byId(document, "site-footer-intent-pilot").checked, "the chosen answer stays selected");
    } finally {
      page.restore();
    }
  });
}

test("releases.html: a name and organization reach the real endpoint and land in the row", async (t) => {
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
    byId(document, "site-footer-intent-security_data").click();
    fill(document, "site-footer-name", "Grace Hopper");
    fill(document, "site-footer-organization", "Navy Labs");
    fill(document, "site-footer-email", EMAIL);
    pressEnter(document);
    await settled(document);
    assert.equal(byId(document, "site-footer-form").dataset.state, "success", textOf(byId(document, "site-footer-status")));
    assert.deepEqual(rows(db), [{
      purpose: "follow_up_releases", topic: FOLLOW_UP_TOPICS.follow_up_releases, intent: "security_data",
      name: "Grace Hopper", organization: "Navy Labs",
    }]);
    const receipt = textOf(byId(document, "site-footer-confirmation"));
    assert.ok(receipt.includes(`Fixed page topic: ${FOLLOW_UP_TOPICS.follow_up_releases}.`), receipt);
    assert.ok(receipt.includes("What you want to discuss: Security or data handling."), receipt);
  } finally {
    globalThis.fetch = passthrough;
    page.restore();
  }
});
