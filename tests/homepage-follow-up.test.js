// The hand-raise under the home page's executive takeaway.
//
// The takeaway is the one thing on the first screen a reader can forward to
// somebody: a recoverable figure, a first action, an accountable role. The
// question it provokes is about their own spend, and until now the only place
// on this page to ask it was the site footer — eight screens down, named after
// nothing they had been reading.
//
// So this file drives the control that closes that gap, and it drives it as a
// visitor does: reach it with Tab, open it with Enter and with Space, land in
// the field, escape back to the control that opened it, submit, fail, retry.
//
// Two of these tests are parity tests rather than behaviour tests, and they are
// the ones that matter most. The panel is not a second implementation — it is
// `initFinopsContact` under a different id family — so what has to be pinned is
// that the two panels on this page say the same thing: the same privacy
// sentence between field and button, and the same receipt once an address
// lands. Both are asserted by driving the footer's panel and this one on the
// same document and comparing what each renders, which is the only check that
// fails when one of them is edited alone.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressEnter, pressKey, pressSpace, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";
import { ALREADY_CAPTURED, CAPTURED, HAND_RAISE_LABEL, initHomepageFollowUp } from "../src/homepage-follow-up.js";
import { initSiteFooter } from "../src/site-footer.js";
import { CONFIRMATION_DETAIL, CONFIRMATION_LEAD, REOPEN_LABEL } from "../src/follow-up-confirmation.js";
import { CONTACT_COPY, FOLLOW_UP_PRIVACY } from "../src/lead-capture.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const TYPED = "director@example.com";

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

/** A 2xx the shared transport reads as a capture. */
const okReply = (created = true) => ({ ok: true, json: async () => ({ created }) });

/**
 * Mount the takeaway's panel on the real page markup with a transport double.
 * `request` receives the call number, so a test can fail the first attempt and
 * answer the second.
 */
async function mount(t, request = async () => { throw new Error("this test makes no request"); }) {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  const calls = [];
  initHomepageFollowUp(page.document, (url, options) => {
    calls.push({ url, options });
    return request(calls.length);
  });
  return { document: page.document, calls };
}

/** Open the panel from the keyboard, the way the control is meant to be used. */
function openFromKeyboard(document, press = pressEnter) {
  byId(document, "homepage-followup-open").focus();
  press(document);
  return byId(document, "homepage-followup-panel");
}

function submitAddress(document, value = TYPED) {
  const field = byId(document, "homepage-followup-email");
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
  return field;
}

const settled = (document, id = "homepage-followup-form") => waitFor(
  () => ["success", "error"].includes(byId(document, id).dataset.state),
  `the ${id} submission to settle`,
);

/* ------------------------------ what it is ------------------------------- */

test("the takeaway block offers a named ask beside the copy control, closed", async (t) => {
  const { document } = await mount(t);
  const trigger = byId(document, "homepage-followup-open");

  assert.equal(trigger.tagName, "BUTTON");
  assert.equal(trigger.type, "button", "an ask that submits the page is not an ask");
  // The name says what pressing it starts, in the reader's terms. The site's
  // one CTA label, "Request a follow-up", is on the control inside the panel;
  // this is the invitation that precedes it.
  assert.equal(textOf(trigger), HAND_RAISE_LABEL);
  assert.match(textOf(trigger), /team/i, "the name must say who the ask reaches");

  // A disclosure, and it says so before it is opened.
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(trigger.getAttribute("aria-controls"), "homepage-followup-panel");
  assert.equal(byId(document, "homepage-followup-panel").hidden, true);

  // Beside "Copy executive takeaway", in the block the takeaway is in — not in
  // a band of its own further down the page.
  const actions = document.querySelector(".executive-takeaway-actions");
  assert.deepEqual(
    actions.children.filter((child) => child.tagName === "BUTTON").map((child) => child.id),
    ["copy-executive-takeaway", "homepage-followup-open"],
  );
  for (const id of ["homepage-followup-open", "homepage-followup-panel"]) {
    assert.ok(inTakeawayBlock(byId(document, id)), `#${id} sits outside the executive takeaway`);
  }
});

function inTakeawayBlock(node) {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if ((parent.className ?? "").split(/\s+/).includes("executive-takeaway")) return true;
  }
  return false;
}

test("the live region ships with the page, empty, and claims nothing", async (t) => {
  const { document } = await mount(t);
  const status = byId(document, "homepage-followup-status");

  assert.equal(status.tagName, "P");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(textOf(status), "");

  // And it is not folded inside a native disclosure. The harness reads through
  // a closed details element; a screen reader in a real browser does not, and
  // the announcement would be silent with every test here still green.
  for (let node = status.parentNode; node; node = node.parentNode) {
    assert.notEqual(node.tagName, "DETAILS", "the live region must not sit inside a disclosure");
  }

  // Nothing has failed, so nothing offers a retry yet.
  const retry = byId(document, "homepage-followup-retry");
  assert.equal(retry.type, "submit");
  assert.equal(retry.hidden, true);
  assert.equal(retry.closest("form")?.id, "homepage-followup-form");
});

/* ------------------------------- keyboard -------------------------------- */

test("the ask is reachable by Tab and opens on Enter, with the cursor in the field", async (t) => {
  const { document } = await mount(t);
  const trigger = byId(document, "homepage-followup-open");

  let focused = null;
  for (let step = 0; step < tabSequence(document).length; step += 1) {
    focused = pressTab(document);
    if (focused === trigger) break;
  }
  assert.equal(focused?.id, "homepage-followup-open", "the ask is not reachable from the keyboard");

  pressEnter(document);
  assert.equal(byId(document, "homepage-followup-panel").hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  // Revealing a form and leaving focus on the control above it strands a
  // keyboard reader at the moment they asked for the form.
  assert.equal(document.activeElement.id, "homepage-followup-email");
});

test("Space opens it too, because it is a real button", async (t) => {
  const { document } = await mount(t);
  const panel = openFromKeyboard(document, pressSpace);

  assert.equal(panel.hidden, false);
  assert.equal(byId(document, "homepage-followup-open").getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement.id, "homepage-followup-email");
});

test("Escape closes the panel and puts focus back on the control that opened it", async (t) => {
  const { document } = await mount(t);
  openFromKeyboard(document);
  assert.equal(document.activeElement.id, "homepage-followup-email");

  pressKey(document, "Escape");

  assert.equal(byId(document, "homepage-followup-panel").hidden, true);
  assert.equal(byId(document, "homepage-followup-open").getAttribute("aria-expanded"), "false");
  // Anything else drops the reader at the top of the document, above the
  // takeaway they were reading.
  assert.equal(document.activeElement.id, "homepage-followup-open");
});

/* -------------------------- parity with the footer ------------------------ */

test("the panel states the site's one privacy sentence, between the field and the button", async (t) => {
  const { document } = await mount(t);
  const field = byId(document, "homepage-followup-email");

  // Read out with the control rather than merely sitting near it.
  assert.equal(field.getAttribute("aria-describedby"), "homepage-followup-note");
  assert.equal(shownText(document, "homepage-followup-note"), FOLLOW_UP_PRIVACY);

  // Byte for byte, and in the order a reader meets it: field, claim, button.
  const order = byId(document, "homepage-followup-form").querySelectorAll("input,p,button");
  const notes = order.filter((node) => textOf(node) === FOLLOW_UP_PRIVACY);
  assert.equal(notes.length, 1);
  const submit = byId(document, "homepage-followup-form").querySelector('button[type="submit"]');
  assert.ok(order.indexOf(field) < order.indexOf(notes[0]));
  assert.ok(order.indexOf(notes[0]) < order.indexOf(submit));
  assert.equal(textOf(submit), "Request a follow-up", "the control that sends carries the site's one label");
});

test("a landed request reads exactly as the footer's does, on the same page", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    const reply = async () => okReply();
    initHomepageFollowUp(document, reply);
    initSiteFooter(document, reply);

    openFromKeyboard(document);
    submitAddress(document);
    await settled(document);

    byId(document, "site-footer-open").click();
    const footerField = byId(document, "site-footer-email");
    footerField.value = "";
    footerField.focus();
    typeText(document, TYPED);
    pressEnter(document);
    await settled(document, "site-footer-form");

    // The announcement, and then the receipt that replaces the form. Compared
    // rather than matched against a copy of the strings: an edit to either
    // panel's wording alone is exactly what this has to fail on.
    assert.equal(
      shownText(document, "homepage-followup-status"),
      shownText(document, "site-footer-status"),
      "the two panels on this page word a landed request differently",
    );
    assert.equal(shownText(document, "homepage-followup-status"), CAPTURED);

    const receipt = shownText(document, "homepage-followup-confirmation");
    assert.equal(receipt, shownText(document, "site-footer-confirmation"));

    // And it is the named confirmation: the address the visitor typed is in it.
    assert.ok(receipt.includes(`${CONFIRMATION_LEAD}${TYPED}.`), `the receipt does not name the address: ${receipt}`);
    assert.ok(receipt.includes(CONFIRMATION_DETAIL));
    assert.ok(receipt.includes(REOPEN_LABEL));

    // Terminal until the visitor asks for the form back.
    assert.equal(byId(document, "homepage-followup-form").hidden, true);
  } finally {
    page.restore();
  }
});

test("an address already on the list is told so, in the footer's words", async (t) => {
  const { document } = await mount(t, async () => okReply(false));
  openFromKeyboard(document);
  submitAddress(document);
  await settled(document);

  assert.equal(shownText(document, "homepage-followup-status"), ALREADY_CAPTURED);
});

/* -------------------------------- failure -------------------------------- */

test("a failure keeps the typed address and offers the retry in place", async (t) => {
  const { document, calls } = await mount(t, async (attempt) => {
    if (attempt === 1) throw new Error("offline");
    return okReply();
  });

  openFromKeyboard(document);
  submitAddress(document);
  await settled(document);

  const form = byId(document, "homepage-followup-form");
  assert.equal(form.dataset.state, "error");
  // Never cleared to "help": the address a visitor typed is the one they would
  // have to type again.
  assert.equal(byId(document, "homepage-followup-email").value, TYPED);
  // Copy this repository owns, not a string an intermediary supplied, and no
  // claim that the address was lost when that is not known.
  assert.equal(shownText(document, "homepage-followup-status"), CONTACT_COPY.unconfirmed);

  // Recovered here, on the page it happened on.
  assert.equal(byId(document, "homepage-followup-recovery").hidden, false);
  const retry = byId(document, "homepage-followup-retry");
  assert.equal(retry.hidden, false);
  assert.equal(form.querySelector('button[type="submit"]').hidden, true,
    "the send control stands aside while the retry is on screen");
  assert.equal(byId(document, "homepage-followup-recovery")
    .children.filter((child) => child.tagName === "A").length, 0,
    "a failure here must be recovered here, not on another page");

  retry.click();
  await settled(document);

  assert.equal(calls.length, 2, "the retry did not send the request again");
  assert.equal(JSON.parse(calls[1].options.body).email, TYPED);
  assert.equal(form.dataset.state, "success");
  assert.ok(shownText(document, "homepage-followup-confirmation").includes(`${CONFIRMATION_LEAD}${TYPED}.`));
});

test("an address the field cannot use is refused before anything is sent", async (t) => {
  const { document, calls } = await mount(t);
  openFromKeyboard(document);
  submitAddress(document, "director@example");

  assert.equal(calls.length, 0, "an unusable address must not reach the transport");
  assert.equal(shownText(document, "homepage-followup-error"), CONTACT_COPY.invalidEmail);
  assert.equal(byId(document, "homepage-followup-email").value, "director@example");
  assert.equal(document.activeElement.id, "homepage-followup-email");
});

/* --------------------------- what it must not say ------------------------- */

test("the ask promises no response time, price, availability, trial, or contract", async (t) => {
  const { document } = await mount(t);
  // The copy this control authors: its name, both landed sentences, and every
  // word the panel shows a reader before they submit anything.
  const authored = [
    HAND_RAISE_LABEL, CAPTURED, ALREADY_CAPTURED,
    textOf(byId(document, "homepage-followup-panel")),
  ].join(" ");

  for (const forbidden of [/business day/i, /\bwithin \d/i, /\b\d+ hours?\b/i, /\bprice|\bpricing\b/i,
    /\bfree\b/i, /\btrial\b/i, /\bcontract\b/i, /\bSLA\b/i, /\bavailab/i, /\bguarantee/i]) {
    assert.doesNotMatch(authored, forbidden, `the hand-raise promises something it cannot keep: ${forbidden}`);
  }
});

/* ------------------------- the footer, still there ------------------------ */

test("the home page keeps the footer's follow-up request, and the two do not interfere", async (t) => {
  const { document } = await mount(t);
  initSiteFooter(document, async () => okReply());

  // Two panels, two id families, and the site's one label on both send
  // controls: the footer's request is not replaced by this one.
  for (const id of ["site-footer-open", "site-footer-form", "site-footer-email", "site-footer-retry"]) {
    assert.equal(byId(document, id)?.id, id, `the footer lost #${id}`);
  }
  assert.equal(textOf(byId(document, "site-footer-open")), "Request a follow-up");

  openFromKeyboard(document);
  assert.equal(byId(document, "site-footer-panel").hidden, true, "opening the takeaway's ask opened the footer's");

  byId(document, "site-footer-open").click();
  assert.equal(byId(document, "site-footer-panel").hidden, false);
  assert.equal(document.activeElement.id, "site-footer-email");
  assert.equal(byId(document, "homepage-followup-panel").hidden, false,
    "opening the footer's panel closed a form the visitor was filling in");
});

test("every other page's footer follow-up request is untouched", async () => {
  // One list page and one the footer varies the request type on, so this is not
  // asserted on a single layout.
  for (const file of ["social.html", "agents.html"]) {
    const page = await loadPage(new URL(`../src/${file}`, import.meta.url));
    const { document } = page;
    try {
      initSiteFooter(document, async () => okReply());
      assert.equal(document.querySelectorAll("#homepage-followup-open").length, 0,
        `${file} ships the home page's takeaway ask`);

      byId(document, "site-footer-open").click();
      assert.equal(byId(document, "site-footer-panel").hidden, false, `${file}: the footer's panel did not open`);
      assert.equal(document.activeElement.id, "site-footer-email");

      const field = byId(document, "site-footer-email");
      field.value = "";
      field.focus();
      typeText(document, TYPED);
      pressEnter(document);
      await settled(document, "site-footer-form");

      assert.ok(shownText(document, "site-footer-confirmation").includes(`${CONFIRMATION_LEAD}${TYPED}.`),
        `${file}: the footer's follow-up no longer confirms by name`);
    } finally {
      page.restore();
    }
  }
});
