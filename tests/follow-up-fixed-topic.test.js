// The pages whose follow-up request has a fixed topic and no way to choose one,
// and that therefore say in prose what the request is about.
//
// Every follow-up request this site sends carries a topic the page fixes — a
// visitor has never picked one. Four pages said so, in a read-only control
// beside the work-email field. Two said nothing: the block asked for a work
// email and never stated what the request was about, and Releases sent a request
// type that had no FOLLOW_UP_TOPICS entry at all, so nothing about the errand
// reached the row either. Issue #1956 closed both halves of that gap.
//
// Issue #1980 moved three of the four read-only controls onto this sentence too.
// A control a visitor cannot edit is a control that owes them an explanation of
// why it is there; the sentence owes them nothing, reads in one pass, and says
// the same thing the request carries. Issue #2046 moved the last one — the Agent
// observatory, the page a technical buyer lands on, and the worst place on the
// site to ask for an email against an unexplained control.
//
// What this file holds is the equality between the halves. The sentence on the
// page and the value on the wire are compared to each other and to the shared
// map, never to a phrase typed in here: a test that pins prose against a string
// literal passes just as happily when the sentence and the request have drifted
// apart, which is the defect, not the fix. It also holds the shape of the
// sentence — prose, in the hint style the privacy note already uses, adding no
// control and no tab stop to a block a keyboard reader has already learned.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, parseHtml, pressEnter, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";

// The pages under test, and a page with the plain footer to measure them
// against. The baseline is what the follow-up block looks like with no topic of
// any kind, so the tab order it produces is the one the sentence must not change.
const STATED = ["index.html", "post.html", "releases.html", "social.html", "profile.html", "coach.html",
  "agents.html"];
const BASELINE = "decision.html";

const SENTENCE_LEAD = "This request is sent about the ";
const TYPED_EMAIL = "director@example.com";

const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);
const read = (file) => readFile(pageUrl(file), "utf8");
const byId = (document, id) => document.getElementById(id);

const jsonReply = (body, status = 201) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

function interceptLeads(reply) {
  const passthrough = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (url !== "/api/leads") return passthrough(url, options);
    calls.push({ url, options });
    return reply(calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = passthrough; } };
}

async function openPage(file) {
  const page = await loadPage(pageUrl(file));
  await importPageModule("/site-footer-page.js");
  return page;
}

function submit(document, value = TYPED_EMAIL) {
  const field = byId(document, "site-footer-email");
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
  "the follow-up submission to settle");

/**
 * Every focusable node inside a subtree, in document order.
 *
 * Walked child by child rather than queried: this harness throws on the
 * universal selector and on a descendant selector, and silently matches nothing
 * for a comma-separated one — a "no controls here" guard written that way passes
 * without looking at anything. Text nodes live in `children` too and carry no
 * dataset, hence the optional chaining.
 */
const FOCUSABLE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
function focusables(node, found = []) {
  for (const child of node.children ?? []) {
    const tag = child.tagName;
    // `!= null`, deliberately: a text node has no getAttribute at all, and a
    // strict `!== null` would count every one of them as a control.
    if (tag && !tag.startsWith("#") && (FOCUSABLE.has(tag) || child.getAttribute?.("tabindex") != null)) {
      found.push(`${tag}#${child.id || ""}`);
    }
    focusables(child, found);
  }
  return found;
}

/* ------------------- the sentence is the value on the wire ------------------ */

for (const file of STATED) {
  test(`${file} names the fixed topic its follow-up request is actually sent with`, async () => {
    const page = await openPage(file);
    const { document } = page;
    const form = byId(document, "site-footer-form");
    // The page's own declaration of what it sends. Everything below is derived
    // from it, so this test cannot agree with a page that changed surface.
    const purpose = form.getAttribute("data-follow-up-type");
    const expected = FOLLOW_UP_TOPICS[purpose];
    const lead = interceptLeads(() => jsonReply({ captured: true, created: true, purpose }));
    try {
      assert.ok(expected, `${file}: purpose ${purpose} has no entry in FOLLOW_UP_TOPICS`);

      const note = byId(document, "site-footer-topic-note");
      assert.ok(note, `${file}: the follow-up block states no topic`);
      const sentence = textOf(note);
      assert.ok(sentence.startsWith(SENTENCE_LEAD) && sentence.endsWith("."),
        `${file}: the topic must be stated as a sentence, not a fragment: ${sentence}`);
      const named = sentence.slice(SENTENCE_LEAD.length, -1);

      submit(document);
      await settled(document);

      assert.equal(lead.calls.length, 1, `${file}: one request`);
      const payload = JSON.parse(lead.calls[0].options.body);
      // The point of the issue, in one chain: what the visitor read, what the
      // request carried, and what the shared map holds are one string.
      assert.equal(named, payload.topic, `${file}: the sentence names a topic the request did not send`);
      assert.equal(named, expected, `${file}: the sentence has drifted from the shared topic list`);
      assert.deepEqual(payload, { email: TYPED_EMAIL, purpose, topic: expected },
        `${file}: the fixed topic is all that accompanies the address`);

      // And the receipt reads back the same string, so a visitor can check the
      // page's claim against what was submitted.
      assert.ok(textOf(byId(document, "site-footer-confirmation")).includes(`Fixed page topic: ${expected}.`),
        `${file}: the receipt must name the topic the page named`);
    } finally {
      lead.restore();
      page.restore();
    }
  });
}

test("every follow-up type these pages send has an entry in the shared topic list", async () => {
  // The regression that motivated the issue: Releases declared a request type
  // FOLLOW_UP_TOPICS knew nothing about, so it sent no topic and the page had
  // nothing true to say. Discovered from the shipped markup rather than listed,
  // so a page that switches surface is held to the same rule.
  for (const file of STATED) {
    const document = parseHtml(await read(file));
    const form = document.getElementById("site-footer-form");
    const purpose = form.getAttribute("data-follow-up-type");
    assert.ok(purpose, `${file}: a page that states a topic must declare the type it sends`);
    assert.ok(FOLLOW_UP_TOPICS[purpose],
      `${file}: sends ${purpose}, which has no FOLLOW_UP_TOPICS entry, so no topic reaches the wire`);
    // The wire value travels on the form, not in a control the visitor could
    // edit, and it is the same string the map holds.
    assert.equal(form.getAttribute("data-follow-up-topic"), FOLLOW_UP_TOPICS[purpose]);
  }
});

/* --------------------------- prose, not a control -------------------------- */

test("the stated topic is prose in the existing hint style, and costs no tab stop", async () => {
  const baseline = parseHtml(await read(BASELINE));
  const baselineStops = focusables(baseline.getElementById("site-footer-panel"));
  // An empty baseline would make the comparison below pass without looking at
  // anything: the plain block has a field and two submit controls.
  assert.equal(baselineStops.length, 3, `${BASELINE}: the plain follow-up block did not parse`);

  for (const file of STATED) {
    const document = parseHtml(await read(file));
    const note = document.getElementById("site-footer-topic-note");
    assert.equal(note.tagName, "P", `${file}: the topic must be a paragraph`);

    // The same hint role the privacy sentence already uses — no new class, and
    // therefore no new colour, size, or spacing to pay for in styles.css.
    const privacy = document.getElementById("site-footer-note");
    assert.equal(note.getAttribute("class"), privacy.getAttribute("class"),
      `${file}: the sentence must reuse the form-hint style, not introduce one`);

    // Nothing inside it can be operated, and nothing about it is focusable.
    assert.deepEqual(focusables(note), [], `${file}: the sentence must contain no control`);
    assert.equal(note.getAttribute("tabindex"), null, `${file}: the sentence must not take focus`);

    // The block's tab order is the one a reader of any other page already knows:
    // same stops, same order, nothing inserted by the sentence.
    assert.deepEqual(focusables(document.getElementById("site-footer-panel")), baselineStops,
      `${file}: the follow-up block's tab stops changed`);
  }
});

test("the topic sentence sits with the work-email field, above the control that sends", async () => {
  for (const file of STATED) {
    const document = parseHtml(await read(file));
    const form = document.getElementById("site-footer-form");
    // One tag per call: a comma-separated selector matches nothing here, and the
    // resulting empty list would make every ordering assertion below vacuous.
    const order = [...form.querySelectorAll("p"), ...form.querySelectorAll("input"),
      ...form.querySelectorAll("button")];
    assert.ok(order.length >= 6, `${file}: the follow-up block did not parse`);

    const stops = focusables(form).length;
    const note = document.getElementById("site-footer-topic-note");
    const field = document.getElementById("site-footer-email");
    assert.ok(order.includes(note) && order.includes(field));
    assert.equal(stops, 3, `${file}: the field and its two submit controls are all that is focusable`);

    // The live sentence renders once, in one form.
    const stated = form.querySelectorAll("p").filter((node) => textOf(node).startsWith(SENTENCE_LEAD));
    assert.equal(stated.length, 1, `${file}: the topic is stated ${stated.length} times`);
  }
});

/* ------------------- the failure copy still stands beside it ---------------- */

for (const file of STATED) {
  test(`${file} keeps its send-failure and retry copy alongside the stated topic`, async () => {
    const page = await openPage(file);
    const { document } = page;
    const lead = interceptLeads(() => jsonReply(
      { error: { code: "storage_unavailable", message: "unreviewed upstream text" } }, 503));
    try {
      submit(document);
      await settled(document);

      assert.equal(byId(document, "site-footer-form").dataset.state, "error");
      assert.equal(textOf(byId(document, "site-footer-recovery")),
        "No request was sent. Retry the same request from this page. If it keeps failing, wait a few minutes and retry.",
        `${file}: the recovery copy has drifted`);
      assert.equal(byId(document, "site-footer-retry").hidden, false, `${file}: a failure offers a retry`);
      assert.equal(textOf(byId(document, "site-footer-status")),
        "No request was sent because follow-up requests are temporarily offline.");
      assert.equal(byId(document, "site-footer-email").value, TYPED_EMAIL,
        `${file}: the typed address survives the failure`);

      // The sentence is a statement about the request, not about its outcome, so
      // a failure neither withdraws it nor turns it into a claim of receipt.
      assert.equal(textOf(byId(document, "site-footer-topic-note")),
        `${SENTENCE_LEAD}${FOLLOW_UP_TOPICS[byId(document, "site-footer-form").getAttribute("data-follow-up-type")]}.`,
        `${file}: the stated topic must survive a failed send unchanged`);
      assert.ok(!tabSequence(document).some((node) => node.id === "site-footer-topic-note"),
        `${file}: the sentence must not become a tab stop when the block changes state`);
    } finally {
      lead.restore();
      page.restore();
    }
  });
}
