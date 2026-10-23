// The optional name and organization on the footer's follow-up form (#2995),
// from the field to the row and back.
//
// Both halves share one limit, MAX_FOLLOW_UP_NAME_LENGTH: it is the inputs'
// maxlength and the endpoint's refusal, so neither half can accept what the
// other forbids. Neither field is ever required, a blank one stores NULL, and
// the endpoint takes both on every purpose, unlike the message.
//
// The home page's form is the one exception: it is email-only by design. The
// evaluation brief's Tab path into it, the home page's "sends your work email to
// that team and nothing else", and tests/homepage-buyer-intent.test.js all pin
// that shape, so index.html renders the footer with `identity: false`. The
// endpoint still accepts both keys on its purpose; the form simply never sends them.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { loadPage, parseHtml, pressEnter, textOf, typeText } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";
import { createTestD1, MIGRATIONS } from "./support/d1-sqlite.js";
import { onRequest } from "../functions/api/leads.js";
import { IDENTITY_FIELDS, initSiteFooter } from "../src/site-footer.js";
import { FOLLOW_UP_IDENTITY_KEYS, FOLLOW_UP_REQUEST_TYPES, FOLLOW_UP_TOPICS, normalizeFollowUpIdentity } from "../src/leads.js";
import {
  FOLLOW_UP_PRIVACY, FOLLOW_UP_PRIVACY_WITH_MESSAGE, FOLLOW_UP_PRIVACY_WITH_NAME, MAX_FOLLOW_UP_NAME_LENGTH,
} from "../src/lead-capture.js";

const EMAIL = "buyer@example.com";
const SRC = new URL("../src/", import.meta.url);
const byId = (document, id) => document.getElementById(id);

const post = (db, body) => onRequest({
  request: new Request("https://labs.wawalu.org/api/leads", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }),
  env: { DB: db },
});
const homepage = (extra = {}) => ({
  email: EMAIL, purpose: "follow_up_homepage", topic: FOLLOW_UP_TOPICS.follow_up_homepage, ...extra,
});
const rows = (db) => db.raw.prepare("SELECT email, purpose, name, organization FROM lead_submissions").all()
  .map((row) => ({ ...row }));

/* ------------------------------ the endpoint ------------------------------ */

test("a request with a name and an organization stores both, trimmed", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const response = await post(db, homepage({ name: "  Ada Lovelace ", organization: " Analytical Engines Ltd  " }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { captured: true, created: true, purpose: "follow_up_homepage" });
  assert.deepEqual(rows(db), [{
    email: EMAIL, purpose: "follow_up_homepage", name: "Ada Lovelace", organization: "Analytical Engines Ltd",
  }]);
});

test("absent, null, empty and blank values all succeed and store NULL", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const bodies = [{}, { name: null, organization: null }, { name: "", organization: "" }, { name: "   ", organization: "\t" }];
  for (const [index, extra] of bodies.entries()) {
    const response = await post(db, homepage({ email: `buyer${index}@example.com`, ...extra }));
    assert.equal(response.status, 201, JSON.stringify(extra));
  }
  assert.deepEqual(rows(db).map(({ name, organization }) => [name, organization]),
    bodies.map(() => [null, null]), "an empty optional field is NULL, never an empty string");

  // One given, one left blank: each column stands alone.
  await post(db, homepage({ email: "half@example.com", organization: "Wawalu" }));
  assert.deepEqual(rows(db).at(-1), { email: "half@example.com", purpose: "follow_up_homepage", name: null, organization: "Wawalu" });
});

test("every purpose takes both fields, including those whose form asks an intent", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const intents = new Set(["follow_up_coach", "follow_up_releases", "follow_up_social", "follow_up_people", "follow_up_agents"]);
  for (const purpose of ["field_notes", "follow_up", ...FOLLOW_UP_REQUEST_TYPES]) {
    const response = await post(db, {
      email: EMAIL, purpose, ...(FOLLOW_UP_TOPICS[purpose] && { topic: FOLLOW_UP_TOPICS[purpose] }),
      ...(intents.has(purpose) && { intent: "demo" }), name: "Ada", organization: "Wawalu",
    });
    assert.equal(response.status, 201, `${purpose}: ${JSON.stringify(await response.clone().json())}`);
  }
  assert.ok(rows(db).every((row) => row.name === "Ada" && row.organization === "Wawalu"));
});

test("the limit is the inputs' maxlength: at it is stored, past it or not a string is refused, and nothing is written", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const atLimit = "a".repeat(MAX_FOLLOW_UP_NAME_LENGTH);
  // Surrounding whitespace is trimmed before counting, as the form's own value would be.
  assert.equal((await post(db, homepage({ name: ` ${atLimit} `, organization: atLimit }))).status, 201);
  assert.deepEqual(rows(db).map((row) => row.name.length), [MAX_FOLLOW_UP_NAME_LENGTH]);

  for (const key of FOLLOW_UP_IDENTITY_KEYS) {
    for (const value of [`${atLimit}a`, 42, ["Ada"], { name: "Ada" }]) {
      const response = await post(db, homepage({ email: "over@example.com", [key]: value }));
      assert.equal(response.status, 400, `${key}: ${JSON.stringify(value)}`);
      assert.equal((await response.json()).error.code, "invalid_request");
    }
  }
  assert.equal(rows(db).length, 1, "a refused request stores nothing");
  assert.deepEqual(normalizeFollowUpIdentity(`${atLimit}a`), { invalid: true });
});

test("a database without migration 0015 still takes a request whose name and organization are blank", async (t) => {
  const db = await createTestD1({ migrations: MIGRATIONS.filter((name) => !name.startsWith("0015")) });
  t.after(() => db.close());
  assert.equal((await post(db, homepage({ name: "", organization: " " }))).status, 201);
  assert.equal((await post(db, homepage({ email: "coach@example.com", purpose: "follow_up_coach",
    topic: FOLLOW_UP_TOPICS.follow_up_coach, intent: "demo" }))).status, 201);
});

/* -------------------------------- the form -------------------------------- */

test("every footer form but the home page's renders both optional fields, labelled, unrequired, capped, and named in its privacy sentence", async () => {
  const files = (await readdir(SRC)).filter((name) => name.endsWith(".html")).sort();
  const carrying = [];
  for (const file of files) {
    const document = parseHtml(await readFile(new URL(file, SRC), "utf8"));
    const form = byId(document, "site-footer-form");
    if (!form) continue;
    if (file === "index.html") {
      for (const [key] of IDENTITY_FIELDS) {
        assert.equal(form.querySelectorAll(`#site-footer-${key}`).length, 0, `index.html stays email-only: ${key}`);
      }
      assert.equal(textOf(byId(document, "site-footer-note")), FOLLOW_UP_PRIVACY);
      continue;
    }
    carrying.push(file);
    for (const [key, label] of IDENTITY_FIELDS) {
      assert.equal(form.querySelectorAll(`#site-footer-${key}`).length, 1, `${file}: #site-footer-${key} is in the footer form`);
      const input = byId(document, `site-footer-${key}`);
      assert.equal(input.getAttribute("type"), "text", `${file}: ${key}`);
      assert.equal(input.getAttribute("name"), key, `${file}: ${key}`);
      assert.equal(input.getAttribute("autocomplete"), key, `${file}: ${key}`);
      assert.equal(input.getAttribute("maxlength"), String(MAX_FOLLOW_UP_NAME_LENGTH), `${file}: ${key}`);
      assert.equal(input.hasAttribute("required"), false, `${file}: ${key} is never required`);
      assert.equal(textOf(document.querySelector(`label[for="site-footer-${key}"]`)), `${label} (optional)`, `${file}: ${key}`);
    }
    const note = textOf(byId(document, "site-footer-note"));
    assert.ok([FOLLOW_UP_PRIVACY_WITH_NAME, FOLLOW_UP_PRIVACY_WITH_MESSAGE].includes(note), `${file}: ${note}`);
  }
  assert.equal(carrying.length, 15, "every page that carries the footer form, less the home page");
  for (const sentence of [FOLLOW_UP_PRIVACY_WITH_NAME, FOLLOW_UP_PRIVACY_WITH_MESSAGE]) {
    assert.match(sentence, /your name and organization if you give them/);
    assert.match(sentence, /to reply to this request/);
  }
});

/* ------------------------------ the receipt ------------------------------- */

const reply = (body, status = 201) => () => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

async function mount(file, transport) {
  const page = await loadPage(new URL(file, SRC));
  const calls = [];
  initSiteFooter(page.document, (url, options) => {
    calls.push(JSON.parse(options.body));
    return transport();
  });
  return { page, document: page.document, calls };
}

function fill(document, id, text) {
  const field = byId(document, id);
  field.value = "";
  field.focus();
  typeText(document, text);
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
  "the follow-up submission to settle");

// coach.html fixes a topic and asks an intent; decision.html sends the legacy
// purpose with neither, so it proves the fields need no topic to travel.
for (const [file, purpose, intent] of [["coach.html", "follow_up_coach", "pilot"], ["decision.html", "follow_up", null]]) {
  test(`${file}: a name and an organization reach the transport and the receipt keeps the topic`, async () => {
    const { page, document, calls } = await mount(file, reply({
      captured: true, created: true, purpose, ...(intent && { intent }),
    }));
    try {
      if (intent) byId(document, `site-footer-intent-${intent}`).click();
      fill(document, "site-footer-name", "Ada Lovelace");
      fill(document, "site-footer-organization", "Analytical Engines Ltd");
      fill(document, "site-footer-email", EMAIL);
      pressEnter(document);
      await settled(document);

      assert.equal(byId(document, "site-footer-form").dataset.state, "success", textOf(byId(document, "site-footer-status")));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, "Ada Lovelace");
      assert.equal(calls[0].organization, "Analytical Engines Ltd");
      assert.equal(calls[0].topic, FOLLOW_UP_TOPICS[purpose], "the topic survives a submit carrying both fields");
      assert.equal(calls[0].intent ?? null, intent);
      const receipt = textOf(byId(document, "site-footer-confirmation"));
      assert.ok(receipt.includes(EMAIL), receipt);
      if (FOLLOW_UP_TOPICS[purpose]) assert.ok(receipt.includes(FOLLOW_UP_TOPICS[purpose]), "the success state still names the topic");
    } finally {
      page.restore();
    }
  });

  test(`${file}: both fields left empty still sends, and neither key goes on the wire`, async () => {
    const { page, document, calls } = await mount(file, reply({
      captured: true, created: true, purpose, ...(intent && { intent }),
    }));
    try {
      if (intent) byId(document, `site-footer-intent-${intent}`).click();
      fill(document, "site-footer-name", "   ");
      fill(document, "site-footer-email", EMAIL);
      pressEnter(document);
      await settled(document);
      assert.equal(byId(document, "site-footer-form").dataset.state, "success", textOf(byId(document, "site-footer-status")));
      assert.equal(calls.length, 1);
      assert.equal(Object.hasOwn(calls[0], "name"), false);
      assert.equal(Object.hasOwn(calls[0], "organization"), false);
    } finally {
      page.restore();
    }
  });
}

/* --------------------------- the whole path ------------------------------- */

test("coach.html: the typed name and organization reach the real endpoint and land in the row", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const page = await loadPage(new URL("coach.html", SRC));
  const { document } = page;
  initSiteFooter(document, (url, options) => onRequest({
    request: new Request(`https://labs.wawalu.org${url}`, options), env: { DB: db },
  }));
  try {
    byId(document, "site-footer-intent-demo").click();
    fill(document, "site-footer-name", " Ada Lovelace ");
    fill(document, "site-footer-organization", "Analytical Engines Ltd");
    fill(document, "site-footer-email", EMAIL);
    pressEnter(document);
    await settled(document);
    assert.equal(byId(document, "site-footer-form").dataset.state, "success", textOf(byId(document, "site-footer-status")));
    assert.deepEqual(rows(db), [{
      email: EMAIL, purpose: "follow_up_coach", name: "Ada Lovelace", organization: "Analytical Engines Ltd",
    }]);
  } finally {
    page.restore();
  }
});
