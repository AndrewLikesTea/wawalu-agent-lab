// The shared follow-up request path, from the click to the row and back.
//
// One panel ships on every page of the site; six of them are the ones a visitor
// is invited to use to reach a person about a surface they are reading. This
// file drives that one path end to end, and it drives it twice:
//
//   1. Against a transport double, to pin the state machine — validate, send,
//      state, render, with exactly four states and no fifth. The double is the
//      `request` argument `initSiteFooter` already takes, so the production call
//      is the same call, not a parallel one.
//   2. Against the real Pages Function and a real SQLite database migrated from
//      the checked-in migrations, so "success" means a row exists.
//
// The second half is what found the defect this file exists for. `capture` used
// `INSERT OR IGNORE`, which ignores *every* constraint failure on the row —
// including the purpose CHECK — and reports the same `changes = 0` a genuine
// duplicate reports. A database that has not had migration 0008 applied (nothing
// in this repository applies migrations) therefore refused every
// `follow_up_<surface>` write, answered 200 `created: false`, and every page but
// the homepage told a first-time visitor their address was already on our list.
// Nothing was stored and nothing said so. `beforeTheirMigration` below stands
// that exact database up and requires the path to fail out loud instead.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { loadPage, parseHtml, pressEnter, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { MIGRATIONS, createTestD1 } from "./support/d1-sqlite.js";
import { initSiteFooter } from "../src/site-footer.js";
import { CONFIRMATION_DETAIL, CONFIRMATION_LEAD } from "../src/follow-up-confirmation.js";
import { FOLLOW_UP_REQUEST_TYPES, LEAD_PURPOSES } from "../src/leads.js";
import { onRequest } from "../functions/api/leads.js";

// The six pages the follow-up request was reviewed on, with the request type
// each one sends. The homepage predates the bounded types and still sends the
// legacy label; the other five name the surface the visitor was reading.
const REVIEWED = [
  ["index.html", "follow_up"],
  ["coach.html", "follow_up_coach"],
  ["releases.html", "follow_up_releases"],
  ["social.html", "follow_up_social"],
  ["profile.html", "follow_up_people"],
  ["agents.html", "follow_up_agents"],
];

const TYPED_EMAIL = "director@example.com";
const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);

// The routing label is the second and last field on the wire, and the only one
// the visitor does not type. It is authored by hand in each page's markup and
// read straight off the form — `form.dataset.followUpType || "follow_up"` in
// src/site-footer.js — while the set the endpoint accepts is declared in
// src/leads.js and enforced by `LEAD_PURPOSES`. Two hand-kept lists, one wire
// contract, and until now nothing held them together.
//
// A page shipping a label outside the enum is answered 422 `invalid_purpose`,
// which src/lead-capture.js maps to the unreadable-request copy: "Reload the
// page and try again". Reloading changes nothing, because the markup is what is
// wrong — a permanent dead end on the one surface that reaches a person, which
// is the failure issue #1694 exists to remove. The REVIEWED table above cannot
// catch it: it asserts about its own six pages, so a seventh surface, or a typo
// in a value, ships green. This reads whatever src/ actually ships instead.
test("every routing label the site ships is one the endpoint accepts, and every declared type ships", async () => {
  const files = (await readdir(new URL("../src/", import.meta.url))).filter((name) => name.endsWith(".html"));
  const shipped = new Map();
  for (const file of files.sort()) {
    for (const form of parseHtml(await readFile(pageUrl(file), "utf8")).querySelectorAll("form")) {
      const label = form.getAttribute("data-follow-up-type");
      // No attribute is the legacy `follow_up` fallback, which every deployment
      // accepts; only a stated label is a claim this contract has to honour.
      if (label === null) continue;
      assert.ok(LEAD_PURPOSES.includes(label),
        `${file} sends purpose "${label}", which POST /api/leads answers 422 invalid_purpose`);
      assert.ok(!shipped.has(label),
        `${file} and ${shipped.get(label)} both send "${label}"; one label names one surface`);
      shipped.set(label, file);
    }
  }

  // And the reverse direction, which is the quieter failure: a bounded type
  // nobody sends means a surface lost its attribute and silently fell back to
  // the legacy label, so the team cannot tell which page a request came from.
  assert.deepEqual([...shipped.keys()].sort(), [...FOLLOW_UP_REQUEST_TYPES].sort(),
    "the labels src/ ships and the types src/leads.js declares have drifted apart");
});
const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

// Every claim of receipt this repository knows how to make. A failure may use
// none of them: the whole point of the four states is that only one of them is
// allowed to say the address arrived.
const RECEIPT_CLAIM = /\b(received|sent|stored|queued|recorded|on our list)\b|we['’]ll be in touch/i;

const jsonReply = (body, status = 201) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

/** A footer wired to a caller-supplied transport: the injectable production path. */
async function mountFooter(file, request) {
  const page = await loadPage(pageUrl(file));
  const calls = [];
  initSiteFooter(page.document, (url, options) => {
    calls.push({ url, options });
    return request(calls.length);
  });
  return { page, document: page.document, calls };
}

function openAndSubmit(document, value = TYPED_EMAIL) {
  byId(document, "site-footer-open").click();
  const field = byId(document, "site-footer-email");
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
  return field;
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
  "the follow-up submission to settle");

const submitControl = (document) =>
  byId(document, "site-footer-form").querySelector('button[type="submit"]');

/* --------------------------- the panel, per page --------------------------- */

for (const [file, purpose] of REVIEWED) {
  test(`${file} ships the follow-up panel and its live region before anything is submitted`, async () => {
    const page = await loadPage(pageUrl(file));
    const { document } = page;
    try {
      const form = byId(document, "site-footer-form");
      assert.equal(form.tagName, "FORM");
      assert.equal(form.getAttribute("data-follow-up-type"), purpose === "follow_up" ? null : purpose);
      assert.equal(byId(document, "site-footer-email").getAttribute("type"), "email");
      assert.equal(submitControl(document).getAttribute("type"), "submit");

      // The status region is in the document at first paint, not inserted when
      // the state changes: a live region created already-populated is not
      // reliably announced.
      const status = byId(document, "site-footer-status");
      assert.equal(status.tagName, "P");
      assert.equal(status.getAttribute("role"), "status");
      assert.equal(status.getAttribute("aria-live"), "polite");
      assert.equal(textOf(status), "", "the region must start empty, claiming nothing");

      // ...and it is not folded inside a summary/details the browser collapses.
      // The harness reads through one; a screen reader in a real browser does
      // not, and the announcement would be silent with every test still green.
      for (let node = status.parentNode; node; node = node.parentNode) {
        assert.notEqual(node.tagName, "DETAILS", `${file}: the live region must not sit inside a details`);
      }

      // The recovery ships with the page and stays on it: a paragraph that
      // leaves for no other form, and a retry control inside this very form.
      const recovery = byId(document, "site-footer-recovery");
      assert.equal(recovery.children.filter((child) => child.tagName === "A").length, 0,
        `${file}: a failure here must be recovered here, not on another page`);
      const retry = byId(document, "site-footer-retry");
      assert.equal(retry.type, "submit");
      assert.equal(retry.hidden, true, `${file}: nothing has failed, so nothing offers a retry`);
      assert.equal(retry.closest("form")?.id, "site-footer-form");
    } finally {
      page.restore();
    }
  });
}

/* ---------------------------- the state machine ---------------------------- */

test("a valid work email and a successful transport reach the success state, which says all three things", async () => {
  const { page, document, calls } = await mountFooter("coach.html",
    () => jsonReply({ captured: true, created: true, purpose: "follow_up_coach" }));
  try {
    openAndSubmit(document);
    await settled(document);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/leads");
    assert.deepEqual(JSON.parse(calls[0].options.body), { email: TYPED_EMAIL, purpose: "follow_up_coach" });
    assert.equal(byId(document, "site-footer-form").dataset.state, "success");

    const receipt = shownText(document, "site-footer-confirmation");
    // 1. What was sent: the address, and the fixed routing label beside it.
    assert.ok(receipt.includes(CONFIRMATION_LEAD.trim()), "the receipt must name what was sent");
    assert.ok(receipt.includes(TYPED_EMAIL), "the receipt must name the address itself");
    // 2. Who replies, and roughly when.
    assert.match(receipt, /Wawalu team replies to that address by email, usually within two business days/);
    // 3. What did not go with it.
    assert.match(receipt, /Page content, prompts, exports, and other visitor data were not sent/);
    assert.ok(receipt.includes(CONFIRMATION_DETAIL));
  } finally {
    page.restore();
  }
});

test("the success state is reached only on a confirmed successful response", async () => {
  // A 200 that reports no row written is not a success this panel may claim.
  const { page, document } = await mountFooter("releases.html",
    () => jsonReply({ captured: true, created: false, purpose: "follow_up_releases" }, 200));
  try {
    openAndSubmit(document);
    await settled(document);
    // The endpoint no longer answers this way for a refused write (see the
    // migration test below); when it answers it for a genuine duplicate, the
    // panel still owns a receipt, and it does not claim a new row.
    assert.equal(byId(document, "site-footer-form").dataset.state, "success");
    assert.match(shownText(document, "site-footer-status"), /already on our list, so nothing new was recorded/);
  } finally {
    page.restore();
  }
});

test("the submit control is disabled in flight and every path resolves out of submitting", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { page, document } = await mountFooter("social.html", async () => {
    await gate;
    return jsonReply({ captured: true, created: true, purpose: "follow_up_social" });
  });
  try {
    openAndSubmit(document);
    const form = byId(document, "site-footer-form");
    assert.equal(form.dataset.state, "submitting");
    assert.equal(submitControl(document).disabled, true);
    assert.equal(submitControl(document).getAttribute("aria-disabled"), "true");
    assert.match(shownText(document, "site-footer-status"), /^Requesting a follow-up/);

    release();
    await settled(document);
    assert.equal(form.dataset.state, "success");
  } finally {
    page.restore();
  }
});

for (const [name, transport] of [
  ["a rejected transport", () => Promise.reject(new TypeError("Failed to fetch"))],
  ["a non-ok response", () => jsonReply({ error: { code: "storage_error", message: "x" } }, 500)],
]) {
  test(`${name} lands in the error state, keeps the address, and claims no receipt`, async () => {
    const { page, document } = await mountFooter("profile.html", transport);
    try {
      const field = openAndSubmit(document);
      await settled(document);

      const form = byId(document, "site-footer-form");
      assert.equal(form.dataset.state, "error");
      assert.equal(form.hidden, false, "a failure leaves the form on screen to retry from");
      assert.equal(field.value, TYPED_EMAIL, "the typed address must survive the failure, unchanged");
      assert.equal(field.disabled, false, "and stay editable");

      const message = shownText(document, "site-footer-status");
      assert.doesNotMatch(message, RECEIPT_CLAIM, `a failure must not claim receipt: ${message}`);
      assert.match(message, /^We (didn|couldn)['’]t/);

      // The retry path: the control comes back, and the recovery it belongs to
      // keeps the reader on the page the request failed on.
      assert.equal(submitControl(document).disabled, false);
      const recovery = byId(document, "site-footer-recovery");
      assert.equal(recovery.hidden, false);
      assert.match(textOf(recovery), /Retry sends the same request again from this page/);
      assert.doesNotMatch(textOf(recovery), /briefing/i);
      const retry = byId(document, "site-footer-retry");
      assert.equal(retry.hidden, false, "a failure must offer a retry where it happened");
      assert.equal(textOf(retry), "Retry sending this request");

      // The outcome is wired to the field a reader has to come back to.
      assert.equal(field.getAttribute("aria-invalid"), "true");
      const described = (field.getAttribute("aria-describedby") ?? "").split(/\s+/);
      assert.ok(described.includes("site-footer-status"), "the outcome must describe the field");
      assert.ok(described.includes("site-footer-recovery"));

      // No receipt was built, so nothing on the page says one landed.
      assert.equal(byId(document, "site-footer-panel").children
        .filter((child) => child.id === "site-footer-confirmation").length, 0);
    } finally {
      page.restore();
    }
  });
}

test("an address that cannot be one issues no request at all", async () => {
  const { page, document, calls } = await mountFooter("agents.html", () => jsonReply({ captured: true, created: true }));
  try {
    const field = openAndSubmit(document, "director@example");
    assert.equal(calls.length, 0, "an invalid address must never reach the network");
    assert.equal(byId(document, "site-footer-form").dataset.state, "invalid");
    assert.equal(field.value, "director@example", "and must not be cleared to help");
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.match(shownText(document, "site-footer-error"), /valid work email address to request a Shiplog follow-up/);
    assert.equal(shownText(document, "site-footer-status"), "", "nothing happened, so the live region says nothing");
  } finally {
    page.restore();
  }
});

test("the whole panel is operable from the keyboard, including the retry after a failure", async () => {
  let attempt = 0;
  const { page, document } = await mountFooter("coach.html", () => {
    attempt += 1;
    return attempt === 1
      ? Promise.reject(new TypeError("Failed to fetch"))
      : jsonReply({ captured: true, created: true, purpose: "follow_up_coach" });
  });
  try {
    // Tab to the trigger and open it with Enter.
    let guard = 0;
    while (document.activeElement?.id !== "site-footer-open" && guard < 200) { pressTab(document); guard += 1; }
    assert.equal(document.activeElement?.id, "site-footer-open");
    pressEnter(document);
    assert.equal(document.activeElement?.id, "site-footer-email", "opening must land focus in the field");

    typeText(document, TYPED_EMAIL);
    pressEnter(document);
    await settled(document);
    assert.equal(byId(document, "site-footer-form").dataset.state, "error");

    // The retry affordance is reachable without a pointer, at its own place in
    // the form rather than as a link off the page.
    const ids = tabSequence(document).map((node) => node.id);
    assert.ok(ids.includes("site-footer-email"), "the field stays in the tab order after a failure");
    assert.ok(ids.includes("site-footer-dismiss"));
    assert.ok(ids.indexOf("site-footer-email") < ids.indexOf("site-footer-retry"),
      "the retry follows the field a reader may want to correct first");
    assert.ok(ids.indexOf("site-footer-retry") < ids.indexOf("site-footer-dismiss"));

    byId(document, "site-footer-email").focus();
    pressEnter(document);
    await waitFor(() => byId(document, "site-footer-form").dataset.state === "success", "the keyboard retry");
    assert.equal(byId(document, "site-footer-email").getAttribute("aria-invalid"), null);
  } finally {
    page.restore();
  }
});

/* ------------------------- the click to the row ---------------------------- */

/** The real endpoint over a real database, as the browser would reach it. */
function endpointTransport(db, calls) {
  return (url, options) => {
    calls.push({ url, options });
    return onRequest({ request: new Request(`https://labs.wawalu.org${url}`, options), env: { DB: db } });
  };
}

for (const [file, purpose] of REVIEWED) {
  test(`${file}: a follow-up request reaches the real endpoint and lands a row`, async (t) => {
    const db = await createTestD1();
    t.after(() => db.close());
    const page = await loadPage(pageUrl(file));
    await importPageModule("/site-footer-page.js");
    const { document } = page;
    const passthrough = globalThis.fetch;
    const calls = [];
    const transport = endpointTransport(db, calls);
    // The shipped page entry wires itself to `globalThis.fetch`; this is the
    // production call, not a second one.
    globalThis.fetch = (url, options) => (url === "/api/leads"
      ? transport(url, options)
      : passthrough(url, options));
    try {
      openAndSubmit(document);
      await settled(document);

      assert.equal(byId(document, "site-footer-form").dataset.state, "success", `${file} must reach success`);
      assert.deepEqual(JSON.parse(calls[0].options.body), { email: TYPED_EMAIL, purpose });

      // node:sqlite hands back null-prototype rows; the values are what matter.
      const rows = db.raw.prepare("SELECT email, purpose FROM lead_submissions").all()
        .map(({ email, purpose: stored }) => ({ email, purpose: stored }));
      assert.deepEqual(rows, [{ email: TYPED_EMAIL, purpose }], `${file} must write exactly one row`);
      assert.ok(shownText(document, "site-footer-confirmation").includes(TYPED_EMAIL));
    } finally {
      globalThis.fetch = passthrough;
      page.restore();
    }
  });
}

test("a write the live schema refuses fails out loud instead of reporting a duplicate", async (t) => {
  // The database as it stands before an operator applies migration 0008: the
  // purpose CHECK still knows only field_notes and follow_up.
  const beforeTheirMigration = MIGRATIONS.filter((name) => !name.startsWith("0008"));
  const db = await createTestD1({ migrations: beforeTheirMigration });
  t.after(() => db.close());

  const page = await loadPage(pageUrl("coach.html"));
  const { document } = page;
  const calls = [];
  initSiteFooter(document, endpointTransport(db, calls));
  try {
    openAndSubmit(document);
    await settled(document);

    // The refusal is a failure, not a receipt. Before this fix the endpoint
    // answered 200 created:false and the panel said "that address is already on
    // our list" to someone who had never submitted anything.
    assert.equal(byId(document, "site-footer-form").dataset.state, "error");
    const message = shownText(document, "site-footer-status");
    assert.doesNotMatch(message, RECEIPT_CLAIM);
    assert.match(message, /something went wrong at our end/);
    assert.equal(db.raw.prepare("SELECT count(*) AS count FROM lead_submissions").get().count, 0);
  } finally {
    page.restore();
  }
});

test("a genuine duplicate is still a duplicate, not an error", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const calls = [];
  const transport = endpointTransport(db, calls);
  const first = await transport("/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: TYPED_EMAIL, purpose: "follow_up_people" }),
  });
  assert.equal(first.status, 201);
  const second = await transport("/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: TYPED_EMAIL, purpose: "follow_up_people" }),
  });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { captured: true, created: false, purpose: "follow_up_people" });
  assert.equal(db.raw.prepare("SELECT count(*) AS count FROM lead_submissions").get().count, 1);
});
