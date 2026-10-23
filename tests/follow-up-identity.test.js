// Who is asking (#2995): the optional Name and Organization fields, from the
// input to the row. Both halves are pinned here — the form sends only what was
// typed, trimmed, and the endpoint stores exactly that or NULL — so neither can
// promise what the other does not deliver.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { loadPage, parseHtml, pressEnter, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { createTestD1, MIGRATIONS } from "./support/d1-sqlite.js";
import { onRequest } from "../functions/api/leads.js";
import { initSiteFooter } from "../src/site-footer.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";
import { FOLLOW_UP_IDENTITY_LIMITS, FOLLOW_UP_PRIVACY_WITH_MESSAGE } from "../src/lead-capture.js";

const EMAIL = "buyer@example.com";
const SRC = new URL("../src/", import.meta.url);
const byId = (document, id) => document.getElementById(id);
const ASKING_PAGES = ["agents.html", "coach.html", "post.html", "profile.html", "releases.html", "social.html"];
const LABELS = { name: "Name (optional)", organization: "Organization (optional)" };

const post = (db, body) => onRequest({
  request: new Request("https://labs.wawalu.org/api/leads", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }),
  env: { DB: db },
});
const coach = (extra = {}) => ({
  email: EMAIL, purpose: "follow_up_coach", topic: FOLLOW_UP_TOPICS.follow_up_coach, intent: "pilot", ...extra,
});
const rows = (db) => db.raw.prepare("SELECT purpose, topic, intent, name, organization FROM lead_submissions").all()
  .map((row) => ({ ...row }));

/* -------------------------------- the forms -------------------------------- */

test("every follow-up form that asks a question offers an optional Name and Organization", async () => {
  const files = (await readdir(SRC)).filter((name) => name.endsWith(".html")).sort();
  const offering = [];
  for (const file of files) {
    const document = parseHtml(await readFile(new URL(file, SRC), "utf8"));
    const form = byId(document, "site-footer-form");
    if (!form) continue;
    const asks = Boolean(byId(document, "site-footer-message"));
    for (const [key, max] of Object.entries(FOLLOW_UP_IDENTITY_LIMITS)) {
      const input = byId(document, `site-footer-${key}`);
      assert.equal(Boolean(input), asks, `${file}: the ${key} field disagrees with the question field`);
      if (!input) continue;
      assert.equal(input.getAttribute("name"), key);
      assert.equal(input.getAttribute("type"), "text");
      assert.equal(input.getAttribute("autocomplete"), key, `${file}: ${key} must be autofillable`);
      assert.equal(input.getAttribute("maxlength"), `${max}`, `${file}: ${key} must hold the endpoint's limit`);
      // Never required. The harness's `required` is getter-only, so the
      // attribute is toggled and the property read back.
      assert.equal(input.getAttribute("required"), null, `${file}: ${key} must stay optional`);
      assert.equal(input.required, false);
      input.setAttribute("required", "");
      assert.equal(input.required, true, "the property follows the attribute, so the check above means something");
      input.removeAttribute("required");
      const labels = form.querySelectorAll(`label[for="site-footer-${key}"]`);
      assert.equal(labels.length, 1, `${file}: ${key} has ${labels.length} labels`);
      assert.equal(textOf(labels[0]), LABELS[key], `${file}: ${key} must be visibly marked optional`);
    }
    if (!asks) continue;
    offering.push(file);
    assert.equal(textOf(byId(document, "site-footer-note")), FOLLOW_UP_PRIVACY_WITH_MESSAGE,
      `${file}: the privacy sentence must say the name and organization go with the request`);
    // Above the address, below the question: the order the controls are reached in.
    const order = form.querySelectorAll("input,button");
    const at = (id) => order.indexOf(byId(document, id));
    assert.ok(at("site-footer-message") < at("site-footer-name"), `${file}`);
    assert.ok(at("site-footer-name") < at("site-footer-organization"), `${file}`);
    assert.ok(at("site-footer-organization") < at("site-footer-email"), `${file}`);
  }
  assert.deepEqual(offering, ASKING_PAGES);
  assert.match(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /name and organization you give for the reply/);
});

/* ------------------------------- the payload ------------------------------- */

async function mountCoach() {
  const page = await loadPage(new URL("coach.html", SRC));
  const calls = [];
  initSiteFooter(page.document, (url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ captured: true, created: true, purpose: "follow_up_coach", intent: "pilot" }), {
      status: 201, headers: { "content-type": "application/json" },
    });
  });
  return { page, document: page.document, calls };
}

function fill(document, id, text) {
  const field = byId(document, id);
  field.value = "";
  field.focus();
  typeText(document, text);
}

function submit(document) {
  byId(document, "site-footer-intent-pilot").click();
  fill(document, "site-footer-email", EMAIL);
  pressEnter(document);
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
  "the follow-up submission to settle");

test("a typed name and organization go on the wire trimmed, beside the page's own topic", async () => {
  const { page, document, calls } = await mountCoach();
  try {
    fill(document, "site-footer-name", "  Ada Lovelace ");
    fill(document, "site-footer-organization", " Analytical Engines Ltd  ");
    submit(document);
    await settled(document);
    assert.equal(byId(document, "site-footer-form").dataset.state, "success", textOf(byId(document, "site-footer-status")));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "Ada Lovelace");
    assert.equal(calls[0].organization, "Analytical Engines Ltd");
    assert.equal(calls[0].topic, FOLLOW_UP_TOPICS.follow_up_coach, "the topic stays byte-exact");
    assert.equal(calls[0].intent, "pilot");
  } finally {
    page.restore();
  }
});

test("left empty, or only spaces, neither field reaches the wire and the request still succeeds", async () => {
  const { page, document, calls } = await mountCoach();
  try {
    fill(document, "site-footer-organization", "   ");
    submit(document);
    await settled(document);
    assert.equal(byId(document, "site-footer-form").dataset.state, "success");
    assert.deepEqual(Object.keys(calls[0]).sort(), ["email", "intent", "purpose", "topic"]);
  } finally {
    page.restore();
  }
});

/* ------------------------------- the endpoint ------------------------------ */

test("the endpoint stores both values trimmed, and an empty or missing one as NULL", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());

  assert.equal((await post(db, coach({ name: "  Ada ", organization: " Engines " }))).status, 201);
  assert.equal((await post(db, coach({ email: "two@example.com", name: "", organization: "   " }))).status, 201);
  assert.equal((await post(db, coach({ email: "three@example.com" }))).status, 201);
  // Every follow-up purpose takes them, including one whose form asks no message.
  assert.equal((await post(db, {
    email: EMAIL, purpose: "follow_up_homepage", topic: FOLLOW_UP_TOPICS.follow_up_homepage, organization: "Engines",
  })).status, 201);

  assert.deepEqual(rows(db), [
    { purpose: "follow_up_coach", topic: FOLLOW_UP_TOPICS.follow_up_coach, intent: "pilot", name: "Ada", organization: "Engines" },
    { purpose: "follow_up_coach", topic: FOLLOW_UP_TOPICS.follow_up_coach, intent: "pilot", name: null, organization: null },
    { purpose: "follow_up_coach", topic: FOLLOW_UP_TOPICS.follow_up_coach, intent: "pilot", name: null, organization: null },
    { purpose: "follow_up_homepage", topic: FOLLOW_UP_TOPICS.follow_up_homepage, intent: null, name: null, organization: "Engines" },
  ]);
});

test("the endpoint refuses over-length and non-string values, and a field-note sign-up that sends them", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());

  const refused = [
    coach({ name: "x".repeat(FOLLOW_UP_IDENTITY_LIMITS.name + 1) }),
    coach({ organization: "x".repeat(FOLLOW_UP_IDENTITY_LIMITS.organization + 1) }),
    coach({ name: 42 }),
    coach({ organization: ["Engines"] }),
    coach({ name: { first: "Ada" } }),
    { email: EMAIL, purpose: "field_notes", name: "Ada" },
  ];
  for (const body of refused) {
    const response = await post(db, body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal((await response.json()).error.code, "invalid_request");
  }
  assert.equal(rows(db).length, 0, "a refused value stores nothing, and nothing is truncated into a row");

  // Exactly at the limit, after trimming, is accepted.
  const atLimit = coach({ name: ` ${"x".repeat(FOLLOW_UP_IDENTITY_LIMITS.name)} ` });
  assert.equal((await post(db, atLimit)).status, 201);
  assert.equal(rows(db)[0].name.length, FOLLOW_UP_IDENTITY_LIMITS.name);
});

/* ------------------------------- the migration ----------------------------- */

test("migration 0015 adds two nullable columns that refuse an empty or over-length value", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const columns = db.raw.prepare("PRAGMA table_info(lead_submissions)").all().map((column) => ({ ...column }));
  for (const key of ["name", "organization"]) {
    const column = columns.find((entry) => entry.name === key);
    assert.ok(column, `${key} column is missing`);
    assert.equal(column.type, "TEXT");
    assert.equal(column.notnull, 0);
  }
  const insert = (name) => db.raw.prepare(
    "INSERT INTO lead_submissions (email, purpose, created_at, name) VALUES (?, 'follow_up', '2026-10-23', ?)",
  ).run(`${Math.random()}@example.com`, name);
  assert.throws(() => insert(""), /CHECK/, "an empty name is NULL, never ''");
  assert.throws(() => insert("x".repeat(FOLLOW_UP_IDENTITY_LIMITS.name + 1)), /CHECK/);
  insert(null);
});

test("a database without migration 0015 still takes a request that leaves both fields empty", async (t) => {
  const db = await createTestD1({ migrations: MIGRATIONS.filter((name) => name !== "0015_follow_up_identity.sql") });
  t.after(() => db.close());
  assert.equal((await post(db, coach())).status, 201);
  assert.equal((await post(db, coach({ email: "two@example.com", name: "Ada" }))).status, 500,
    "a name the table cannot hold is a truthful storage error, never a silent drop");
});

/* ------------------------------- the whole path ---------------------------- */

test("releases.html: name, organization and topic reach the real endpoint and land in one row", async (t) => {
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
    fill(document, "site-footer-name", "Ada Lovelace");
    fill(document, "site-footer-organization", "Analytical Engines Ltd");
    submit(document);
    await settled(document);

    assert.equal(byId(document, "site-footer-form").dataset.state, "success", textOf(byId(document, "site-footer-status")));
    assert.deepEqual(rows(db), [{
      purpose: "follow_up_releases", topic: FOLLOW_UP_TOPICS.follow_up_releases, intent: "pilot",
      name: "Ada Lovelace", organization: "Analytical Engines Ltd",
    }]);
    // The existing receipt, unchanged, still names the topic it was sent about.
    assert.ok(textOf(byId(document, "site-footer-confirmation")).includes(FOLLOW_UP_TOPICS.follow_up_releases));
  } finally {
    globalThis.fetch = passthrough;
    page.restore();
  }
});
