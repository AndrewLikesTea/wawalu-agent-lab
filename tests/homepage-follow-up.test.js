// The follow-up ask on the home page's first screen.
//
// The hero states a figure a visitor can be convinced by — 33% of analyzed AI
// spend is recoverable — and the only way to raise a hand about it was the About
// Shiplog panel at the foot of a long page. The ask now sits in the same section
// as the figure.
//
// What is pinned here, in the order it would hurt if it broke:
//
//   1. The ask is inside the opening section, above the footer, and it is the
//      site's one follow-up surface: the same label on the control that opens it
//      and the control that submits it, the same work-email field, the same
//      privacy sentence. tests/follow-up-privacy.test.js and
//      tests/follow-up-cta-label.test.js police those site-wide; this file only
//      has to prove the home page's panel is one of the forms they find.
//   2. Who replies and by when is readable before anything is typed, in specific
//      words — a named team and a window in working days, not "soon".
//   3. The confirmation repeats that sentence, word for word, so a visitor who
//      has just submitted is not left to remember it.
//   4. The footer's panel on this page is untouched: still shipped byte for byte
//      from src/site-footer.js, still working, and still making its own promise
//      rather than this one.
//
// The page runs for real — shipped markup, the shipped entry module, only
// /api/leads stubbed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { CONFIRMATION_LEAD, REOPEN_LABEL } from "../src/follow-up-confirmation.js";
import { ALREADY_CAPTURED, CAPTURED, REPLY_COMMITMENT } from "../src/home-follow-up.js";
import { FOLLOW_UP_PRIVACY } from "../src/lead-capture.js";
import { siteFooterMarkup } from "../src/site-footer.js";
import { loadPage, parseHtml, pressEnter, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const TYPED_EMAIL = "director@example.com";

/** The one label, written out so a rename has to be a decision, not a diff. */
const CTA = "Request a follow-up";

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

function interceptLeads(reply) {
  const passthrough = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (url !== "/api/leads") return passthrough(url, options);
    calls.push({ url, options });
    return reply(calls.length);
  };
  return calls;
}

const jsonReply = (body, status = 201) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

/** Type an address into a disclosed form and submit it from the keyboard. */
function submitEmail(document, prefix, value) {
  const field = byId(document, `${prefix}-email`);
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
}

const settled = (document, prefix) => waitFor(
  () => ["success", "error"].includes(byId(document, `${prefix}-form`).dataset.state),
  "the submission to settle");

/** The home page with the hero's follow-up wiring live, and nothing else. */
async function openHomePage() {
  const page = await loadPage(HOME_PAGE);
  await importPageModule("/home-follow-up-page.js");
  return page;
}

/* ------------------------------- the placement ------------------------------ */

test("the ask sits in the same section as the recoverable-spend figure", async () => {
  const html = await readFile(HOME_PAGE, "utf8");
  const document = parseHtml(html);
  const opening = byId(document, "top");

  // The section a visitor reads first, and the figure it is there to state.
  assert.match(textOf(opening), /33% of analyzed AI spend is recoverable — \$51,254 of \$154,500/,
    "the opening section no longer carries the figure this ask belongs to");

  const ask = byId(document, "hero-contact");
  assert.ok(ask, "the home page ships no follow-up ask on its first screen");
  assert.equal(ask.closest("#top")?.id, "top", "the ask must be inside the section that states the figure");
  assert.ok(!ask.closest("#site-footer"), "the ask must not be the footer's panel under another name");

  // And the reader reaches it before the footer, not after it.
  assert.ok(html.indexOf('id="hero-contact"') < html.indexOf('id="site-footer"'),
    "the ask must read before the About Shiplog band, not below it");
});

test("the ask is the site's one follow-up surface, not a second contact mechanism", async () => {
  const document = parseHtml(await readFile(HOME_PAGE, "utf8"));
  const ask = byId(document, "hero-contact");
  const form = byId(document, "hero-contact-form");

  // One label on the control that begins the request and the control that
  // completes it — the same one every other follow-up surface carries.
  assert.equal(textOf(byId(document, "hero-contact-open")), CTA);
  assert.equal(textOf(form.querySelector('button[type="submit"]')), CTA);

  // The same field, and the same sentence about what leaves the browser.
  const field = byId(document, "hero-contact-email");
  assert.equal(field.getAttribute("type"), "email");
  assert.equal(field.getAttribute("aria-describedby"), "hero-contact-note");
  assert.equal(shownText(document, "hero-contact-note"), FOLLOW_UP_PRIVACY);

  // No competing name for the errand anywhere in the block.
  for (const term of [/walkthrough/i, /\bdemo\b/i, /\bchat\b/i, /get in touch/i, /talk to us/i]) {
    assert.doesNotMatch(textOf(ask), term, `the ask must not be renamed: ${term}`);
  }

  // Collapsed in the shipped markup, so the first screen gains one tab stop —
  // the button — and the field arrives only when a reader asks for it.
  assert.equal(byId(document, "hero-contact-panel").hasAttribute("hidden"), true);
  const stops = tabSequence(document);
  assert.ok(stops.includes(byId(document, "hero-contact-open")), "the ask must be keyboard reachable");
  assert.ok(!stops.includes(field), "a hidden field must not be a tab stop");
});

/* ------------------------------ the commitment ------------------------------ */

test("who replies and how soon is readable before anything is typed", async () => {
  const html = await readFile(HOME_PAGE, "utf8");
  const document = parseHtml(html);

  // Word for word the sentence the confirmation ends on. Two renderings of one
  // commitment is how two commitments start.
  assert.equal(shownText(document, "hero-contact-reply"), REPLY_COMMITMENT);

  // Specific, and checkable against what the operating team already commits to
  // on the AI FinOps form: a named team, a person, and a window in working days.
  assert.match(REPLY_COMMITMENT, /Wawalu team that operates Shiplog/, "it must name who replies");
  assert.match(REPLY_COMMITMENT, /within two business days/, "it must state a window a team can keep");
  assert.doesNotMatch(REPLY_COMMITMENT, /\bsoon\b|\bshortly\b|\bASAP\b|right away/i,
    "the window must be stated, not hedged");
  // Nothing the project cannot keep: no same-day promise, no sales team, no SLA.
  assert.doesNotMatch(REPLY_COMMITMENT, /24 hours|same day|sales|SLA|guarantee/i);

  // It is read before the panel is opened, so it is outside the panel.
  assert.ok(!byId(document, "hero-contact-reply").closest("#hero-contact-panel"));
  assert.ok(html.indexOf('id="hero-contact-reply"') < html.indexOf('id="hero-contact-open"'),
    "the commitment must read above the control it qualifies");
});

test("the confirmation repeats the same commitment, word for word", async () => {
  const page = await openHomePage();
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ created: true, purpose: "follow_up" }));
  try {
    byId(document, "hero-contact-open").click();
    assert.equal(document.activeElement?.id, "hero-contact-email", "opening the panel must land the cursor in it");

    submitEmail(document, "hero-contact", TYPED_EMAIL);
    await settled(document, "hero-contact");

    assert.equal(calls.length, 1, "a valid submission is sent once");
    assert.equal(JSON.parse(calls[0].options.body).purpose, "follow_up",
      "the ask must use the shared follow-up routing label");

    const confirmation = shownText(document, "hero-contact-status");
    assert.equal(confirmation, CAPTURED);
    assert.ok(confirmation.includes(REPLY_COMMITMENT),
      "the confirmation must repeat the sentence shown before submitting");
    assert.match(confirmation, /^Follow-up requested — we sent your email address, and nothing else\./);

    // The shared receipt, unchanged: it names the address and takes focus.
    const receipt = byId(document, "hero-contact-confirmation");
    assert.ok(receipt, "a landed request must leave a receipt");
    assert.ok(textOf(receipt).includes(CONFIRMATION_LEAD.trim()));
    assert.ok(textOf(receipt).includes(TYPED_EMAIL), "the receipt must name the address that was sent");
    assert.ok(textOf(receipt).includes(REOPEN_LABEL), "the visitor must be able to ask again");
    assert.equal(document.activeElement?.id, "hero-contact-confirmation");
    assert.equal(byId(document, "hero-contact-form").hidden, true, "success is terminal until the visitor reopens");
  } finally {
    page.restore();
  }
});

test("an address already on the list gets the same commitment, not a different one", async () => {
  const page = await openHomePage();
  const { document } = page;
  interceptLeads(() => jsonReply({ created: false, purpose: "follow_up" }));
  try {
    byId(document, "hero-contact-open").click();
    submitEmail(document, "hero-contact", TYPED_EMAIL);
    await settled(document, "hero-contact");

    const confirmation = shownText(document, "hero-contact-status");
    assert.equal(confirmation, ALREADY_CAPTURED);
    assert.ok(confirmation.includes(REPLY_COMMITMENT));
  } finally {
    page.restore();
  }
});

test("a failed request keeps the address, says so, and never claims a reply is coming", async () => {
  const page = await openHomePage();
  const { document } = page;
  interceptLeads(() => jsonReply({ error: { code: "storage_unavailable", message: "unavailable" } }, 503));
  try {
    byId(document, "hero-contact-open").click();
    submitEmail(document, "hero-contact", TYPED_EMAIL);
    await settled(document, "hero-contact");

    const status = shownText(document, "hero-contact-status");
    assert.match(status, /^We didn’t get your request/);
    assert.ok(!status.includes(REPLY_COMMITMENT), "a request that never landed promises nothing");
    assert.equal(byId(document, "hero-contact-recovery").hidden, false, "a failure must say what to do next");
    assert.equal(byId(document, "hero-contact-email").value, TYPED_EMAIL, "the typed address must survive");
    assert.ok(!byId(document, "hero-contact-confirmation"), "a failure must not leave a receipt");
  } finally {
    page.restore();
  }
});

/* -------------------------------- the footer -------------------------------- */

test("the footer's follow-up surface on this page is unchanged", async () => {
  const html = await readFile(HOME_PAGE, "utf8");

  // Byte for byte from the generator, exactly as tests/site-footer.test.js
  // requires of every page: the hero's ask added nothing to it and took
  // nothing out of it.
  assert.ok(html.includes(siteFooterMarkup()), "the footer markup drifted from src/site-footer.js");
  assert.equal((html.match(/<footer/g) ?? []).length, 1, "the home page renders more than one footer");

  const page = await loadPage(HOME_PAGE);
  await importPageModule("/site-footer-page.js");
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ created: true, purpose: "follow_up" }));
  try {
    byId(document, "site-footer-open").click();
    assert.equal(document.activeElement?.id, "site-footer-email");
    submitEmail(document, "site-footer", TYPED_EMAIL);
    await settled(document, "site-footer");

    assert.equal(calls.length, 1, "the footer's form still sends");
    assert.equal(byId(document, "site-footer-form").dataset.state, "success");
    assert.ok(byId(document, "site-footer-confirmation"), "the footer still shows the shared receipt");

    // And it still makes its own promise. The footer sits on fifteen pages and
    // has never claimed a window; the hero's ask does not give it one.
    const confirmation = shownText(document, "site-footer-status");
    assert.match(confirmation, /a person replies by email/);
    assert.doesNotMatch(confirmation, /business days?|within \d/i);
    assert.ok(!confirmation.includes(REPLY_COMMITMENT));
  } finally {
    page.restore();
  }
});

test("the hero's panel and the footer's are two panels, not one wired twice", async () => {
  const page = await openHomePage();
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ created: true, purpose: "follow_up" }));
  try {
    // Only the hero's entry ran, so the footer's trigger reveals nothing and,
    // more to the point, submitting in the hero leaves the footer alone.
    byId(document, "hero-contact-open").click();
    submitEmail(document, "hero-contact", TYPED_EMAIL);
    await settled(document, "hero-contact");

    assert.equal(calls.length, 1);
    assert.equal(shownText(document, "site-footer-status"), "", "the footer's live region must stay quiet");
    assert.ok(!byId(document, "site-footer-form").hidden, "the footer's form must stay on the page");
    assert.ok(!byId(document, "site-footer-confirmation"),
      "the hero's request must not put a receipt in the footer");
  } finally {
    page.restore();
  }
});
