// The named hand-raise under the home page's executive takeaway.
//
// A reader who has just read the takeaway is holding one question — can I ask
// about my own spend — and the site's only answer used to be a scroll to the
// footer. This file drives the control that answers it in place: it opens a
// follow-up request form inside the takeaway block, it sends the same request
// through the same transport as every other follow-up form on the site, and it
// says the same three things about what was sent.
//
// Two things are pinned here that are easy to break and hard to see:
//
//   1. The home page now carries two follow-up forms. The footer's is not
//      allowed to change, and the two are not allowed to collide — no shared
//      id, no shared label target, no shared live region, and no module-level
//      state that makes the second one the first one's puppet.
//   2. The reveal is a real disclosure with a real focus contract: Tab reaches
//      it, Enter and Space open it, focus lands in the field, Escape closes it
//      and gives the control its focus back.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressEnter, pressKey, pressSpace, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { HAND_RAISE_LABEL, initFollowUpPanel } from "../src/homepage-follow-up.js";
import { ALREADY_CAPTURED, CAPTURED, initSiteFooter } from "../src/site-footer.js";
import { CONFIRMATION_DETAIL, CONFIRMATION_LEAD } from "../src/follow-up-confirmation.js";
import { FOLLOW_UP_PRIVACY } from "../src/lead-capture.js";

const HOME = new URL("../src/index.html", import.meta.url);
const OTHER_PAGE = new URL("../src/coach.html", import.meta.url);
const TYPED_EMAIL = "director@example.com";

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

const jsonReply = (body, status = 201) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

/** Every ancestor of a node, nearest first. The harness rejects descendant selectors. */
function ancestors(node) {
  const out = [];
  for (let current = node?.parentNode; current; current = current.parentNode) out.push(current);
  return out;
}

const inside = (node, id) => ancestors(node).some((parent) => parent.id === id);

/** Every id in the document, in document order. `querySelectorAll("*")` throws here. */
function idsIn(node, found = []) {
  for (const child of node.childElements) {
    const id = child.getAttribute("id");
    if (id) found.push(id);
    idsIn(child, found);
  }
  return found;
}

/** The panel wired to a caller-supplied transport: the production path, injected. */
async function mountHandRaise(request) {
  const page = await loadPage(HOME);
  const calls = [];
  initFollowUpPanel(page.document, (url, options) => {
    calls.push({ url, options });
    return request(calls.length);
  });
  return { page, document: page.document, calls };
}

const settled = (document, prefix) => waitFor(
  () => ["success", "error"].includes(byId(document, `${prefix}-form`).dataset.state),
  `the ${prefix} submission to settle`);

function submitFrom(document, prefix, value = TYPED_EMAIL) {
  const field = byId(document, `${prefix}-email`);
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
  return field;
}

/* ------------------------------ the control ------------------------------- */

test("the takeaway block offers a control that says it starts a conversation with the team", async (t) => {
  const page = await loadPage(HOME);
  t.after(() => page.restore());
  const { document } = page;

  const trigger = byId(document, "takeaway-contact-open");
  assert.equal(trigger.tagName, "BUTTON");
  // A property, not an attribute: the harness reflects neither into the other.
  assert.equal(trigger.type, "button");
  assert.equal(textOf(trigger), HAND_RAISE_LABEL);

  // The name has to name the errand — who you are reaching and what about —
  // because this control sits in a row of takeaway actions where "Request a
  // follow-up" would be a third button with no subject.
  assert.match(textOf(trigger), /\bteam\b/i, "the control must say who the reader would be talking to");
  assert.match(textOf(trigger), /\byour own spend\b/i, "the control must say what the conversation is about");

  // In the takeaway's own block, beside the copy control, not adrift in the page.
  assert.ok(ancestors(trigger).some((parent) => (parent.getAttribute("class") ?? "").includes("executive-takeaway")),
    "the control must sit in the executive takeaway block");
  const actions = trigger.parentNode.childElements.map((node) => node.id);
  assert.ok(actions.includes("copy-executive-takeaway"),
    "the control must stand with the takeaway's existing actions");

  // Closed, and saying so, before anything is pressed.
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(trigger.getAttribute("aria-controls"), "takeaway-contact-panel");
  assert.equal(byId(document, "takeaway-contact-panel").hidden, true);
});

test("the revealed form ships the shared privacy sentence and an announceable live region", async (t) => {
  const page = await loadPage(HOME);
  t.after(() => page.restore());
  const { document } = page;

  // Byte for byte, from src/lead-capture.js, and it is the field's accessible
  // description rather than prose that happens to sit nearby.
  const field = byId(document, "takeaway-contact-email");
  assert.equal(field.getAttribute("aria-describedby"), "takeaway-contact-note");
  assert.equal(shownText(document, "takeaway-contact-note"), FOLLOW_UP_PRIVACY);

  const status = byId(document, "takeaway-contact-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(textOf(status), "", "the region must start empty, claiming nothing");

  // Not folded into a disclosure the browser collapses: this harness reads
  // through a closed details, and a real screen reader would hear nothing.
  for (const parent of ancestors(status)) {
    assert.notEqual(parent.tagName, "DETAILS", "the live region must not sit inside a details");
    assert.ok(!parent.open, "the live region must not sit inside a closed disclosure");
  }
});

test("nothing in the hand-raise promises a response time, a price, or a contract", async (t) => {
  const page = await loadPage(HOME);
  t.after(() => page.restore());
  const { document } = page;
  const copy = [
    textOf(byId(document, "takeaway-contact-open")),
    textOf(byId(document, "takeaway-contact-panel")),
  ].join(" ");

  for (const forbidden of [/business day/i, /within \d/i, /\d+ ?hours?\b/i, /\$\d/, /\bprice|\bpricing/i,
    /\bfree\b/i, /\btrial\b/i, /\bcontract\b/i, /\bavailab/i, /\bwe['’]ll be in touch\b/i]) {
    assert.doesNotMatch(copy, forbidden, `the hand-raise promises something it cannot keep: ${forbidden}`);
  }
});

/* ------------------------------ the keyboard ------------------------------ */

test("Tab reaches the control, Enter opens it into the field, and Escape hands focus back", async (t) => {
  const page = await loadPage(HOME);
  t.after(() => page.restore());
  const { document } = page;
  await importPageModule("/homepage-follow-up.js");

  let guard = 0;
  while (document.activeElement?.id !== "takeaway-contact-open" && guard < 300) { pressTab(document); guard += 1; }
  assert.equal(document.activeElement?.id, "takeaway-contact-open", "the control is not reachable by Tab");

  pressEnter(document);
  const panel = byId(document, "takeaway-contact-panel");
  assert.equal(panel.hidden, false, "Enter must reveal the form");
  assert.equal(byId(document, "takeaway-contact-open").getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement?.id, "takeaway-contact-email", "opening must land focus in the field");

  // Escape from inside the form, which is where a reader who changed their mind
  // actually is.
  pressKey(document, "Escape");
  assert.equal(panel.hidden, true, "Escape must close the panel");
  assert.equal(document.activeElement?.id, "takeaway-contact-open",
    "Escape must return focus to the control that opened the panel");
  assert.equal(byId(document, "takeaway-contact-open").getAttribute("aria-expanded"), "false");

  // And the form's controls leave the tab order with it.
  const ids = tabSequence(document).map((node) => node.id);
  assert.ok(!ids.includes("takeaway-contact-email"), "a closed panel must not keep a tab stop");
});

test("Space opens the same disclosure, and the Close control closes it", async (t) => {
  const page = await loadPage(HOME);
  t.after(() => page.restore());
  const { document } = page;
  await importPageModule("/homepage-follow-up.js");

  byId(document, "takeaway-contact-open").focus();
  pressSpace(document);
  assert.equal(byId(document, "takeaway-contact-panel").hidden, false, "Space must reveal the form");
  assert.equal(document.activeElement?.id, "takeaway-contact-email");

  byId(document, "takeaway-contact-dismiss").click();
  assert.equal(byId(document, "takeaway-contact-panel").hidden, true);
  assert.equal(document.activeElement?.id, "takeaway-contact-open");
});

/* ---------------------------- what a send does ---------------------------- */

test("a submission from the home page lands the shared named confirmation, in this block", async (t) => {
  const { page, document, calls } = await mountHandRaise(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));
  t.after(() => page.restore());

  byId(document, "takeaway-contact-open").click();
  submitFrom(document, "takeaway-contact");
  await settled(document, "takeaway-contact");

  // One bounded request: the typed address and a fixed routing label.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/leads");
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: TYPED_EMAIL, purpose: "follow_up" });

  const receipt = byId(document, "takeaway-contact-confirmation");
  const text = textOf(receipt);
  assert.ok(text.includes(CONFIRMATION_LEAD.trim()), "the receipt must name what was sent");
  assert.ok(text.includes(TYPED_EMAIL), "the receipt must name the address itself");
  assert.ok(text.includes(CONFIRMATION_DETAIL), "the receipt must be the shared one, word for word");
  assert.equal(shownText(document, "takeaway-contact-status"), CAPTURED,
    "the outcome sentence must be the one the footer's panel already says");

  // Rendered where the request was made, not in the footer and not on another page.
  assert.ok(inside(receipt, "takeaway-contact-panel"), "the receipt must render in the takeaway's panel");
  assert.ok(!inside(receipt, "site-footer"), "the receipt must not render in the footer");
  assert.equal(receipt.getAttribute("role"), "status");
  assert.equal(document.activeElement, receipt, "focus must land inside the receipt");

  // Terminal: there is nothing left to press a second time.
  assert.equal(byId(document, "takeaway-contact-form").hidden, true);
  assert.equal(byId(document, "takeaway-contact-form").querySelector('button[type="submit"]').disabled, true);
});

test("a duplicate address is still a receipt, and it does not claim a new row", async (t) => {
  const { page, document } = await mountHandRaise(() => jsonReply({ captured: true, created: false, purpose: "follow_up" }, 200));
  t.after(() => page.restore());

  byId(document, "takeaway-contact-open").click();
  submitFrom(document, "takeaway-contact");
  await settled(document, "takeaway-contact");

  assert.equal(byId(document, "takeaway-contact-form").dataset.state, "success");
  assert.equal(shownText(document, "takeaway-contact-status"), ALREADY_CAPTURED);
});

test("a failed send keeps the typed address and offers the retry here, claiming nothing", async (t) => {
  let attempt = 0;
  const { page, document } = await mountHandRaise(() => {
    attempt += 1;
    return attempt === 1
      ? Promise.reject(new TypeError("Failed to fetch"))
      : jsonReply({ captured: true, created: true, purpose: "follow_up" });
  });
  t.after(() => page.restore());

  byId(document, "takeaway-contact-open").click();
  const field = submitFrom(document, "takeaway-contact");
  await settled(document, "takeaway-contact");

  const form = byId(document, "takeaway-contact-form");
  assert.equal(form.dataset.state, "error");
  assert.equal(form.hidden, false, "a failure leaves the form on screen to retry from");
  assert.equal(field.value, TYPED_EMAIL, "the typed address must survive the failure, unchanged");
  assert.equal(field.disabled, false, "and stay editable");

  const message = shownText(document, "takeaway-contact-status");
  assert.doesNotMatch(message, /\b(received|stored|queued|recorded|on our list)\b/i,
    `a failure must not claim receipt: ${message}`);
  assert.match(message, /^We (didn|couldn)['’]t/);

  // The recovery is here, on this page, in this block — not a link elsewhere.
  const recovery = byId(document, "takeaway-contact-recovery");
  assert.equal(recovery.hidden, false);
  assert.equal(recovery.childElements.filter((child) => child.tagName === "A").length, 0,
    "a failure here must be recovered here, not on another page");
  assert.match(textOf(recovery), /Retry sends the same request again from this page/);
  const retry = byId(document, "takeaway-contact-retry");
  assert.equal(retry.hidden, false, "a failure must offer a retry where it happened");
  assert.equal(textOf(retry), "Retry sending this request");
  assert.ok(inside(retry, "takeaway-contact-panel"));

  // The outcome is wired to the field a reader has to come back to.
  assert.equal(field.getAttribute("aria-invalid"), "true");
  const described = (field.getAttribute("aria-describedby") ?? "").split(/\s+/);
  assert.ok(described.includes("takeaway-contact-status"), "the outcome must describe the field");
  assert.ok(described.includes("takeaway-contact-recovery"));

  // And the retry works from the keyboard, in place.
  field.focus();
  pressEnter(document);
  await waitFor(() => byId(document, "takeaway-contact-form").dataset.state === "success", "the keyboard retry");
  assert.ok(shownText(document, "takeaway-contact-confirmation").includes(TYPED_EMAIL));
});

test("an address that cannot be one issues no request and says which errand failed", async (t) => {
  const { page, document, calls } = await mountHandRaise(() => jsonReply({ captured: true, created: true }));
  t.after(() => page.restore());

  byId(document, "takeaway-contact-open").click();
  const field = submitFrom(document, "takeaway-contact", "director@example");

  assert.equal(calls.length, 0, "an invalid address must never reach the network");
  assert.equal(byId(document, "takeaway-contact-form").dataset.state, "invalid");
  assert.equal(field.value, "director@example", "and must not be cleared to help");
  assert.match(shownText(document, "takeaway-contact-error"), /valid work email address to request a Shiplog follow-up/);
  assert.equal(shownText(document, "takeaway-contact-status"), "", "nothing happened, so the live region says nothing");
});

/* -------------------------- the two forms coexist -------------------------- */

test("the home page's two follow-up forms share no id, no label target, and no live region", async (t) => {
  const page = await loadPage(HOME);
  t.after(() => page.restore());
  const { document } = page;

  const ids = idsIn(document);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], `the home page ships duplicate ids: ${duplicates.join(", ")}`);

  // Every label points at a field that exists, and at only one.
  for (const label of document.querySelectorAll("label")) {
    const target = label.getAttribute("for");
    if (!target) continue;
    assert.equal(ids.filter((id) => id === target).length, 1,
      `a label points at #${target}, which is not exactly one control`);
  }

  // The two panels are distinct nodes with distinct live regions.
  assert.notEqual(byId(document, "takeaway-contact-status"), byId(document, "site-footer-status"));
  assert.ok(!inside(byId(document, "takeaway-contact-panel"), "site-footer"),
    "the hand-raise must not be nested in the footer");
});

test("the two panels on the home page do not drive each other", async (t) => {
  const page = await loadPage(HOME);
  t.after(() => page.restore());
  const { document } = page;
  initFollowUpPanel(document, () => jsonReply({ captured: true, created: true }));
  initSiteFooter(document, () => jsonReply({ captured: true, created: true }));

  // Opening one leaves the other closed, and typing in one does not type in the
  // other — the module-level state a cloned panel would have shared.
  byId(document, "takeaway-contact-open").click();
  assert.equal(byId(document, "takeaway-contact-panel").hidden, false);
  assert.equal(byId(document, "site-footer-panel").hidden, true);

  typeText(document, TYPED_EMAIL);
  assert.equal(byId(document, "takeaway-contact-email").value, TYPED_EMAIL);
  assert.equal(byId(document, "site-footer-email").value, "");

  byId(document, "site-footer-open").click();
  assert.equal(byId(document, "site-footer-panel").hidden, false);
  assert.equal(byId(document, "takeaway-contact-panel").hidden, false,
    "opening the footer must not close the panel the reader was using");
  assert.equal(document.activeElement?.id, "site-footer-email");
});

test("the footer's own follow-up request still works, on the home page and elsewhere", async (t) => {
  for (const url of [HOME, OTHER_PAGE]) {
    const page = await loadPage(url);
    t.after(() => page.restore());
    const { document } = page;
    const calls = [];
    initSiteFooter(document, (endpoint, options) => {
      calls.push({ endpoint, options });
      return jsonReply({ captured: true, created: true, purpose: "follow_up" });
    });

    byId(document, "site-footer-open").click();
    assert.equal(document.activeElement?.id, "site-footer-email");
    submitFrom(document, "site-footer");
    await settled(document, "site-footer");

    assert.equal(byId(document, "site-footer-form").dataset.state, "success");
    assert.equal(calls.length, 1, `${url.pathname}: the footer must send exactly one request`);
    const receipt = byId(document, "site-footer-confirmation");
    assert.ok(textOf(receipt).includes(TYPED_EMAIL));
    assert.ok(inside(receipt, "site-footer"), `${url.pathname}: the footer's receipt must stay in the footer`);

    // Nothing the home page's second panel does leaks into it.
    if (url === HOME) {
      assert.equal(byId(document, "takeaway-contact-panel").hidden, true,
        "submitting in the footer must not open the takeaway's panel");
      assert.equal(shownText(document, "takeaway-contact-status"), "");
    }
  }
});

test("the shipped page entry wires the hand-raise without a test touching it", async (t) => {
  const page = await loadPage(HOME);
  t.after(() => page.restore());
  await importPageModule("/homepage-follow-up.js");

  // No transport double here: this only asserts the page's own script found the
  // markup and bound the disclosure.
  page.document.getElementById("takeaway-contact-open").click();
  assert.equal(page.document.getElementById("takeaway-contact-panel").hidden, false);
});
