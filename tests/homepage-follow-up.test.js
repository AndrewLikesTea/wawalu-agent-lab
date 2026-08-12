// The hand-raise under the home page's executive takeaway.
//
// The first screen states somebody else's recoverable figure and offers two
// things to do with it: copy it, or go and read how it was computed. A visitor
// whose own bill is the reason they are on this page had one place to say so —
// the About Shiplog band at the foot of the document — and no reason to scroll
// past nine sections to find it.
//
// What is pinned here, in the order it would hurt if it broke:
//
//   1. The control is in the takeaway block, it says what it does, and nothing
//      is revealed until it is pressed.
//   2. Keyboard: Tab to it, Enter or Space opens it, focus lands in the field,
//      Escape gives focus back to the control that opened it.
//   3. The form is the site's follow-up form — the shared privacy sentence, a
//      bounded request body, and the same named confirmation the footer leaves.
//   4. A failure keeps the typed address, offers the retry the footer offers,
//      and leaves no receipt behind.
//   5. The footer's own form is still on this page and still works. The two
//      share no id, no live region and no state.
//
// The page runs for real: shipped markup from src/index.html, booted by the
// module the document loads, with nothing stubbed but /api/leads.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, pressEnter, pressKey, pressSpace, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { ASK_INVITATION, ASK_LABEL, PREFIX } from "../src/homepage-follow-up.js";
import { ALREADY_CAPTURED, CAPTURED } from "../src/site-footer.js";
import { CONTACT_COPY, FOLLOW_UP_PRIVACY } from "../src/lead-capture.js";
import { CONFIRMATION_LEAD, REOPEN_LABEL } from "../src/follow-up-confirmation.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const TYPED_EMAIL = "director@example.com";

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));
const at = (document, suffix) => byId(document, `${PREFIX}-${suffix}`);

async function openHomepage(t) {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  await importPageModule("/homepage-follow-up.js");
  return page.document;
}

/** Take over POST /api/leads and record exactly what the page hands the network. */
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

const failureReply = () => jsonReply({ error: { code: "storage_unavailable", message: "unavailable" } }, 503);

const settled = (document, prefix) => waitFor(
  () => ["success", "error"].includes(byId(document, `${prefix}-form`).dataset.state),
  "the submission to settle");

/** Type an address into a disclosed form and submit it from the keyboard. */
function submitEmail(document, prefix, value) {
  const field = byId(document, `${prefix}-email`);
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
}

/** Tab from wherever focus is until a control is reached; no mouse involved. */
function tabTo(document, node) {
  for (let step = 0; step <= tabSequence(document).length; step += 1) {
    if (pressTab(document) === node) return true;
  }
  return false;
}

test("the takeaway block offers a third control that asks the team, and reveals nothing yet", async (t) => {
  const document = await openHomepage(t);
  const block = document.querySelector(".executive-takeaway");
  const trigger = at(document, "open");

  // In the block that carries the figure, beside the two controls that were
  // already there — not in a band of its own further down the page.
  assert.ok(block.querySelectorAll("button").includes(trigger),
    "the control must sit inside the executive takeaway block");
  assert.equal(trigger.tagName, "BUTTON");
  assert.equal(trigger.type, "button");
  assert.equal(textOf(trigger), ASK_LABEL);
  assert.ok(textOf(block).includes("Copy executive takeaway"),
    "the control the block already carried must still be there");

  // The name says the errand; the sentence beside it says who is on the other
  // end, and it is part of the control's accessible description rather than
  // prose that happens to be near it.
  assert.equal(shownText(document, `${PREFIX}-invitation`), ASK_INVITATION);
  assert.equal(trigger.getAttribute("aria-describedby"), `${PREFIX}-invitation`);

  // Closed on arrival: one control, and nothing else added to the tab order.
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(at(document, "panel").hidden, true);
  const stops = tabSequence(document);
  assert.ok(stops.includes(trigger), "the control must be reachable by Tab");
  for (const suffix of ["email", "retry", "dismiss"]) {
    assert.ok(!stops.includes(at(document, suffix)),
      `#${PREFIX}-${suffix} must not be a tab stop while the panel is closed`);
  }
});

test("Enter opens the form on the page and puts the cursor in the field", async (t) => {
  const document = await openHomepage(t);
  const trigger = at(document, "open");

  assert.ok(tabTo(document, trigger), "the control is not reachable by Tab");
  pressEnter(document);

  assert.equal(at(document, "panel").hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, at(document, "email"),
    "opening the form must land the cursor in the work email field");
  // No navigation: the request is made from the page the reader is on.
  assert.deepEqual(document.navigations, []);
});

test("Space opens it too, and Escape gives focus back to the control that opened it", async (t) => {
  const document = await openHomepage(t);
  const trigger = at(document, "open");

  trigger.focus();
  pressSpace(document);
  assert.equal(at(document, "panel").hidden, false);
  assert.equal(document.activeElement, at(document, "email"));

  pressKey(document, "Escape");
  assert.equal(at(document, "panel").hidden, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, trigger,
    "Escape must return focus to the control that opened the panel");
});

test("the revealed form makes the site's one promise about what is sent", async (t) => {
  const document = await openHomepage(t);
  at(document, "open").click();

  const note = at(document, "note");
  // Byte for byte, from src/lead-capture.js — not a sentence written again for
  // this page. tests/follow-up-privacy.test.js discovers this form too and
  // holds it to the same string and the same position in the form.
  assert.equal(textOf(note), FOLLOW_UP_PRIVACY);
  assert.equal(at(document, "email").getAttribute("aria-describedby"), `${PREFIX}-note`);
  assert.equal(textOf(at(document, "form").querySelector('button[type="submit"]')), "Request a follow-up");
});

test("a landed request leaves the footer's receipt, naming the address, on this page", async (t) => {
  const document = await openHomepage(t);
  const calls = interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));

  at(document, "open").click();
  assert.equal(byId(document, `${PREFIX}-confirmation`), null,
    "a receipt must not exist before a request lands");
  submitEmail(document, PREFIX, TYPED_EMAIL);
  await settled(document, PREFIX);

  // One request, and the whole of it is the address and the routing label.
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(payload, { email: TYPED_EMAIL, purpose: "follow_up" });
  assert.doesNotMatch(calls[0].options.body, /51,254|154,500|Atlas Platform/,
    "no figure from the takeaway above the form may travel with the request");

  // The same named confirmation the footer's form leaves: same module, same
  // sentences, the address rendered as text, and focus inside it.
  const receipt = byId(document, `${PREFIX}-confirmation`);
  assert.ok(receipt, "a landed request must leave a confirmation");
  assert.equal(receipt.hidden, false);
  assert.ok(textOf(receipt).includes(`${CONFIRMATION_LEAD.trim()} ${TYPED_EMAIL}`),
    `the receipt must name the address it sent: ${textOf(receipt)}`);
  assert.equal(textOf(receipt.querySelector(`.${receipt.className}-address`)), TYPED_EMAIL);
  assert.equal(document.activeElement, receipt, "focus must land on the receipt");
  assert.equal(receipt.getAttribute("role"), "status");

  // The announcement is the footer's sentence, imported rather than re-authored,
  // so this panel cannot promise something the footer's does not.
  assert.equal(shownText(document, `${PREFIX}-status`), CAPTURED);
  // Terminal until the visitor asks again, and asking again is a control.
  assert.equal(at(document, "form").hidden, true);
  assert.equal(textOf(byId(document, `${PREFIX}-again`)), REOPEN_LABEL);
});

test("an address already on the list gets the footer's other sentence", async (t) => {
  const document = await openHomepage(t);
  interceptLeads(() => jsonReply({ captured: true, created: false, purpose: "follow_up" }, 200));

  at(document, "open").click();
  submitEmail(document, PREFIX, TYPED_EMAIL);
  await settled(document, PREFIX);

  assert.equal(shownText(document, `${PREFIX}-status`), ALREADY_CAPTURED);
});

test("a failure keeps the typed address, offers the retry, and retries in place", async (t) => {
  const document = await openHomepage(t);
  const calls = interceptLeads((call) => (call === 1
    ? failureReply()
    : jsonReply({ captured: true, created: true, purpose: "follow_up" })));

  at(document, "open").click();
  submitEmail(document, PREFIX, TYPED_EMAIL);
  await settled(document, PREFIX);

  const field = at(document, "email");
  assert.equal(at(document, "form").dataset.state, "error");
  assert.equal(field.value, TYPED_EMAIL, "the typed address must survive a failure");
  assert.equal(byId(document, `${PREFIX}-confirmation`), null,
    "a failed request must never leave a confirmation behind");
  assert.equal(shownText(document, `${PREFIX}-status`), CONTACT_COPY.rejected.storage_unavailable);

  // The recovery paragraph appears only now, and it is named in the field's
  // description now that there is something to describe.
  const recovery = at(document, "recovery");
  assert.equal(recovery.hidden, false);
  assert.match(textOf(recovery), /Your email address is still in the field above/);
  assert.match(field.getAttribute("aria-describedby"), new RegExp(`${PREFIX}-recovery`));

  // The same retry the footer's panel offers: it stands where the send control
  // was, on this page, and sends the same request again.
  const retry = at(document, "retry");
  assert.equal(retry.hidden, false);
  assert.equal(retry.type, "submit");
  assert.equal(textOf(retry), "Retry sending this request");
  assert.equal(at(document, "form").querySelector('button[type="submit"]').hidden, true);
  assert.ok(tabSequence(document).includes(retry), "the retry must be reachable by Tab");

  retry.focus();
  pressEnter(document);
  await waitFor(() => at(document, "form").dataset.state === "success", "the retry to land");
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), { email: TYPED_EMAIL, purpose: "follow_up" });
  assert.equal(shownText(document, `${PREFIX}-status`), CAPTURED);
});

test("an unusable address is refused inline, and nothing is sent", async (t) => {
  const document = await openHomepage(t);
  const calls = interceptLeads(() => jsonReply({ captured: true, created: true }));

  at(document, "open").click();
  for (const [value, copy] of [["", CONTACT_COPY.emptyEmail], ["rowan at example", CONTACT_COPY.invalidEmail]]) {
    submitEmail(document, PREFIX, value);
    assert.equal(calls.length, 0, `${JSON.stringify(value)} must not be sent`);
    assert.equal(shownText(document, `${PREFIX}-error`), copy);
    assert.equal(at(document, "email").getAttribute("aria-invalid"), "true");
    assert.match(at(document, "email").getAttribute("aria-describedby"), new RegExp(`${PREFIX}-error`));
    assert.equal(byId(document, `${PREFIX}-confirmation`), null, "a refusal cannot look successful");
  }
});

test("nothing this block says promises a reply by a time, a price, or a contract", async (t) => {
  const document = await openHomepage(t);
  at(document, "open").click();

  // The copy this change authors or chooses: the label, the sentence beside it,
  // the privacy note, the recovery paragraph, and both landed-request
  // announcements. The shared receipt is deliberately not in this list — it is
  // the footer's, unchanged, and tests/follow-up-success-state.test.js owns its
  // wording for every surface that shows it.
  const authored = [
    ASK_LABEL, ASK_INVITATION, shownText(document, `${PREFIX}-note`),
    shownText(document, `${PREFIX}-recovery`), CAPTURED, ALREADY_CAPTURED,
  ].join(" ");

  for (const term of [/business day/i, /within (?:an?|\d+) (?:hour|day|week)/i, /response time/i,
    /\bSLA\b/i, /\bpricing\b/i, /\bprice/i, /\bfree\b/i, /\btrial\b/i, /\bcontract\b/i,
    /\bsubscri/i, /\bavailability\b/i, /\bguarantee/i]) {
    assert.doesNotMatch(authored, term, `this block must not say ${term}`);
  }
});

test("the About Shiplog form is still on this page, still separate, and still works", async (t) => {
  const document = await openHomepage(t);
  await importPageModule("/site-footer-page.js");
  const calls = interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));

  // Two panels, two of everything they own. Nothing is shared but the module
  // behind them, so neither can address, describe or announce into the other.
  for (const id of ["open", "panel", "form", "email", "error", "note", "recovery", "status"]) {
    assert.equal(document.querySelectorAll(`#${PREFIX}-${id}`).length, 1, `#${PREFIX}-${id} is not unique`);
    assert.equal(document.querySelectorAll(`#site-footer-${id}`).length, 1, `#site-footer-${id} is not unique`);
  }
  assert.equal(textOf(byId(document, "site-footer-open")), "Request a follow-up",
    "the footer's own control keeps the site's one label");

  // Opening the new panel leaves the footer's shut and silent.
  at(document, "open").click();
  assert.equal(byId(document, "site-footer-panel").hidden, true);
  assert.equal(shownText(document, "site-footer-status"), "");

  // And sending from the footer, on this page, still lands its own receipt in
  // its own band, with the new panel's live region untouched.
  byId(document, "site-footer-open").click();
  submitEmail(document, "site-footer", TYPED_EMAIL);
  await settled(document, "site-footer");

  const receipt = byId(document, "site-footer-confirmation");
  assert.ok(receipt, "the footer's form must still confirm a landed request");
  assert.equal(shownText(document, "site-footer-status"), CAPTURED);
  assert.equal(shownText(document, `${PREFIX}-status`), "");
  assert.equal(at(document, "form").hidden, false, "the takeaway's form must not react to the footer's");
  assert.equal(calls.length, 1);
});
