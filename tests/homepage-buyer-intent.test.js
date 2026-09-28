// The home page's two buyer questions, from the control to the stored row.
//
// Issue #2593: the page offered one link for two errands — "Request a
// demonstration or discuss a pilot" — and carried neither into the form, so
// every home-page request reached the Wawalu team as the same topic. What is
// pinned here is the whole path: two real controls, the choice in the address,
// the choice stated above the field, the choice on the wire, and the landing in
// the work-email field.
//
// Two things this file deliberately asserts the CURRENT arrangement of, rather
// than an arrangement it would prefer:
//
//   1. The work-email field is the first focusable inside the follow-up form,
//      before and after a choice is made. tests/shiplog-evaluation-brief.test.js
//      pins that from the other side — the evaluation brief publishes
//      /#site-footer-panel as the address for this question — so a control
//      added above the field would move a buyer's landing away from the field
//      the brief sent them to. This is why the choice is made on the controls
//      above the form and not in a fieldset inside it.
//   2. The disclosure block sits BELOW the field it describes and ABOVE the
//      button that sends it: field, then the sentence saying what is sent, then
//      submit. That is the order tests/follow-up-privacy.test.js requires of
//      every follow-up form on the site — a claim a reader meets after pressing
//      the button is not a claim they got to weigh — so "beside the form" here
//      means between the two, not above the field.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BUYER_INTENT_CONTROLS, BUYER_INTENT_DESCRIPTION, BUYER_INTENT_DESCRIPTION_ID,
  BUYER_INTENT_PARAM, buyerIntentFromSearch, initHomepageBuyerIntent, topicSentence,
} from "../src/homepage-buyer-intent.js";
import { FOLLOW_UP_PRIVACY, FOLLOW_UP_REPLY, FOLLOW_UP_USE } from "../src/lead-capture.js";
import { FOLLOW_UP_TOPICS, HOMEPAGE_BUYER_TOPICS } from "../src/leads.js";
import { onRequest } from "../functions/api/leads.js";
import { initSiteFooter } from "../src/site-footer.js";
import { createTestD1 } from "./support/d1-sqlite.js";
import { loadPage, pressEnter, tabSequence, textOf, typeText } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

const page = new URL("../src/index.html", import.meta.url);
const EMAIL = "buyer@example.com";
const byId = (document, id) => document.getElementById(id);

async function openHome(t, { search = "", history = { replaceState() {} } } = {}) {
  const home = await loadPage(page);
  t.after(() => home.restore());
  const teardown = initHomepageBuyerIntent(home.document, {
    locationRef: { search, hash: "", origin: "https://labs.wawalu.org" },
    historyRef: history,
  });
  return { document: home.document, teardown };
}

/* ---------------------------- the two controls ---------------------------- */

test("the page offers two real controls, one per errand, both reachable by Tab", async (t) => {
  const { document } = await openHome(t);
  const sequence = tabSequence(document);

  assert.equal(BUYER_INTENT_CONTROLS.length, 2);
  const labels = new Set();
  for (const control of BUYER_INTENT_CONTROLS) {
    const node = byId(document, control.id);
    assert.ok(node, `the page carries no #${control.id}`);
    // A link, because the address is real: a visitor with no script still
    // arrives at the form and the choice still survives a forwarded URL.
    assert.equal(node.tagName, "A");
    assert.equal(node.getAttribute("href"), control.href);
    assert.ok(node.getAttribute("href").includes(`${BUYER_INTENT_PARAM}=${control.key}`),
      `${control.id}: the address does not carry the choice`);

    // The accessible name is the visible text — no aria-label saying something
    // else — and the two names are different things to ask for.
    assert.equal(textOf(node), control.label);
    assert.equal(node.getAttribute("aria-label"), null);
    labels.add(control.label);

    assert.ok(sequence.includes(node), `${control.id} is not in the tab order`);
    // The focus ring is the site's own: no new rule was added for this row.
    assert.ok(node.classList.contains("text-link"), `${control.id} dropped the shared link treatment`);
    assert.equal(node.getAttribute("aria-describedby"), BUYER_INTENT_DESCRIPTION_ID);
  }
  assert.equal(labels.size, 2, "the two controls must not read as the same offer");
  assert.match([...labels].join(" | "), /demonstration/);
  assert.match([...labels].join(" | "), /pilot/);

  // One line for the pair, static, at the row it explains — not a third control.
  const described = document.querySelectorAll("p")
    .filter((node) => node.getAttribute("id") === BUYER_INTENT_DESCRIPTION_ID);
  assert.equal(described.length, 1, `the description is painted ${described.length} times`);
  assert.equal(textOf(described[0]), BUYER_INTENT_DESCRIPTION);
  assert.equal(sequence.filter((node) => node === described[0]).length, 0,
    "the description became a tab stop of its own");
  // What comes back is the form's own sentence, byte for byte, so a buyer meets
  // one promise here and the same one above the button.
  assert.ok(BUYER_INTENT_DESCRIPTION.endsWith(FOLLOW_UP_REPLY),
    `the reply window has drifted from ${FOLLOW_UP_REPLY}`);
});

test("the old single control, which asked two questions at once, is gone", async (t) => {
  const { document } = await openHome(t);
  assert.equal(document.querySelectorAll("#ask-about-shiplog").length, 0,
    "the combined demonstration-or-pilot route is still on the page");
  const offer = byId(document, "shiplog-entry");
  // Still one contact destination: both addresses are this page's own panel.
  const routes = offer.querySelectorAll("a")
    .filter((link) => link.getAttribute("href")?.endsWith("#site-footer-panel"));
  assert.equal(routes.length, 2, "the offer paints something other than the two buyer routes");
  assert.equal(offer.querySelectorAll('a[href="#site-footer-email"]').length, 0);
});

/* ------------------------- what activation carries ------------------------ */

for (const control of BUYER_INTENT_CONTROLS) {
  test(`activating "${control.label}" selects its topic and lands focus in the work email field`, async (t) => {
    const addresses = [];
    const { document } = await openHome(t, { history: { replaceState: (_s, _t, url) => addresses.push(url) } });
    const form = byId(document, "site-footer-form");
    assert.equal(form.getAttribute("data-follow-up-topic"), FOLLOW_UP_TOPICS.follow_up_homepage,
      "the page must ship its default topic before any choice is made");

    byId(document, control.id).focus();
    pressEnter(document);

    // The topic, on the form and in the line above the field, in one wording.
    assert.equal(form.getAttribute("data-follow-up-topic"), control.topic);
    assert.equal(form.dataset.followUpTopic, control.topic);
    assert.equal(textOf(byId(document, "site-footer-topic-note")), topicSentence(control.topic));
    assert.equal(HOMEPAGE_BUYER_TOPICS[control.key], control.topic);

    // On the control that made it, so a returning reader can see which.
    assert.equal(byId(document, control.id).getAttribute("aria-current"), "true");
    const other = BUYER_INTENT_CONTROLS.find((candidate) => candidate.key !== control.key);
    assert.equal(byId(document, other.id).getAttribute("aria-current"), null);

    // In the address bar, so a reload and a forwarded link arrive on it too.
    assert.deepEqual(addresses, [control.href]);

    // And the cursor is in the one thing left to do.
    assert.equal(document.activeElement?.getAttribute("id"), "site-footer-email");
  });
}

test("the second press replaces the first choice rather than adding to it", async (t) => {
  const { document } = await openHome(t);
  const [first, second] = BUYER_INTENT_CONTROLS;
  byId(document, first.id).click();
  byId(document, second.id).click();
  assert.equal(byId(document, "site-footer-form").getAttribute("data-follow-up-topic"), second.topic);
  assert.equal(byId(document, first.id).getAttribute("aria-current"), null);
  assert.equal(byId(document, second.id).getAttribute("aria-current"), "true");
});

test("an address that already names a choice arrives on it, and an unknown one changes nothing", async (t) => {
  for (const control of BUYER_INTENT_CONTROLS) {
    assert.equal(buyerIntentFromSearch(`?${BUYER_INTENT_PARAM}=${control.key}`), control.key);
  }
  for (const search of ["", "?", "?discuss=", "?discuss=pricing", "?discuss[]=pilot", "?other=demo"]) {
    assert.equal(buyerIntentFromSearch(search), null, search);
  }

  const forwarded = await openHome(t, { search: "?discuss=pilot" });
  assert.equal(forwarded.document.getElementById("site-footer-form").getAttribute("data-follow-up-topic"),
    HOMEPAGE_BUYER_TOPICS.pilot);
  assert.equal(forwarded.document.activeElement?.getAttribute("id"), "site-footer-email");

  const unknown = await openHome(t, { search: "?discuss=pricing" });
  assert.equal(unknown.document.getElementById("site-footer-form").getAttribute("data-follow-up-topic"),
    FOLLOW_UP_TOPICS.follow_up_homepage);
});

/* ------------------------ and what reaches the team ----------------------- */

test("the chosen topic is what the form sends, and what the endpoint stores", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const { document } = await openHome(t);
  const bodies = [];
  initSiteFooter(document, (url, options) => {
    bodies.push(JSON.parse(options.body));
    return onRequest({
      request: new Request(`https://labs.wawalu.org${url}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: options.body,
      }),
      env: { DB: db },
    });
  });

  byId(document, "buyer-intent-pilot").click();
  const field = byId(document, "site-footer-email");
  field.value = "";
  field.focus();
  typeText(document, EMAIL);
  pressEnter(document);
  await waitFor(() => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
    "the follow-up submission to settle");

  assert.equal(byId(document, "site-footer-form").dataset.state, "success",
    "the endpoint refused the topic the page chose");
  assert.deepEqual(bodies, [{
    email: EMAIL, purpose: "follow_up_homepage", topic: HOMEPAGE_BUYER_TOPICS.pilot,
  }]);
  const rows = db.raw.prepare("SELECT email, purpose, topic FROM lead_submissions").all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ email: EMAIL, purpose: "follow_up_homepage", topic: HOMEPAGE_BUYER_TOPICS.pilot }]);
});

test("the default topic still reaches the endpoint when no choice was made", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const response = await onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: EMAIL, purpose: "follow_up_homepage", topic: FOLLOW_UP_TOPICS.follow_up_homepage,
      }),
    }),
    env: { DB: db },
  });
  assert.equal(response.status, 201);

  // And a topic no control on the page can produce is still refused.
  const invented = await onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, purpose: "follow_up_homepage", topic: "Homepage — a discount" }),
    }),
    env: { DB: db },
  });
  assert.equal(invented.status, 422);
  assert.equal((await invented.json()).error.code, "invalid_topic");
});

/* --------------------- the disclosure stays where it is -------------------- */

// The failure this test exists for: a choice that rearranges the form. The
// three sentences saying what is sent, what the address is used for, and who
// answers have to be between the field and the button before AND after a
// choice, because that is the one position a reader is guaranteed to pass
// through on the way to pressing the button.
for (const state of ["on a cold paint", "after a choice is activated"]) {
  test(`the disclosure of what is sent and who answers is beside the form ${state}`, async (t) => {
    const { document } = await openHome(t);
    if (state !== "on a cold paint") byId(document, "buyer-intent-demo").click();

    const form = byId(document, "site-footer-form");
    const field = byId(document, "site-footer-email");
    const submit = form.querySelectorAll('button[type="submit"]').find((node) => !node.hidden);
    const order = form.querySelectorAll("input,p,button,fieldset");
    const at = (node) => order.indexOf(node);

    for (const [id, sentence] of [
      ["site-footer-note", FOLLOW_UP_PRIVACY],
      ["site-footer-use", FOLLOW_UP_USE],
      ["site-footer-reply", FOLLOW_UP_REPLY],
    ]) {
      const note = byId(document, id);
      assert.ok(note, `${state}: #${id} is no longer on the page`);
      // Byte for byte: a choice may not soften what the form says it sends.
      assert.equal(textOf(note), sentence, `${state}: #${id} has drifted`);
      assert.equal(note.hidden, false, `${state}: #${id} was hidden`);
      // Inside the form, and between the field it describes and the button.
      assert.ok(at(note) >= 0, `${state}: #${id} was moved out of the form`);
      assert.ok(at(field) < at(note), `${state}: #${id} is above the field it describes`);
      assert.ok(at(note) < at(submit), `${state}: #${id} is below the button it should precede`);
    }

    // The field the brief's address sends a buyer to is still the first stop
    // inside the panel, and the button is still the next one: no control was
    // added above or between them to carry the choice.
    const panel = byId(document, "site-footer-panel");
    const inPanel = tabSequence(document).filter((node) => {
      for (let current = node; current; current = current.parentNode) if (current === panel) return true;
      return false;
    });
    assert.equal(inPanel[0]?.getAttribute("id"), "site-footer-email", `${state}: the email field lost first place`);
    assert.equal(inPanel[1]?.getAttribute("type"), "submit", `${state}: something was added between field and submit`);
  });
}
