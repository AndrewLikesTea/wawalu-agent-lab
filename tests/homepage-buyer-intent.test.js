// The home page's buyer-intent pair: what it draws, what choosing does, and the
// one thing it deliberately does not do.
//
// The shipped follow-up form on this page is email-only. `follow_up_homepage` is
// not in `FOLLOW_UP_INTENT_PURPOSES` and not in `FOLLOW_UP_MESSAGE_PURPOSES`, so
// there is no key the chosen topic could travel on and no field it could be
// typed into; both facts are asserted below rather than left in a comment,
// because they are the reason the submitted payload is unchanged and a future
// widening of either list should have to come back through here.
//
// So what is pinned is the reading surface: two controls painted below the
// prompt-coach offer and outside both work-email forms, one pressed at a time,
// the chosen topic in visible text in two places, focus landing in the field a
// visitor types next, a polite announcement, and the footer's own disclosures
// still standing. Plus the shapes this must not disturb: the follow-up block's
// three tab stops and the field-note form's single control.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import { FOLLOW_UP_INTENTS } from "../src/lead-capture.js";
import {
  FOLLOW_UP_INTENT_PURPOSES, FOLLOW_UP_MESSAGE_PURPOSES, FOLLOW_UP_TOPICS,
} from "../src/leads.js";

const PAGE = new URL("../src/index.html", import.meta.url);

/** The purpose the form on this page sends, read off the form rather than typed. */
const HOMEPAGE_PURPOSE = "follow_up_homepage";

async function openHomepage(t) {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  // The entry mounts itself on import, exactly as the script tag does. Its
  // exports come back from the same call, so the copy this file asserts against
  // is the copy the page just painted.
  const api = await importPageModule("/homepage-buyer-intent.js");
  return { document: page.document, api };
}

const byId = (document, id) => document.getElementById(id);

/** The drawn controls, in the order they are painted. */
const toggles = (document) =>
  byId(document, "buyer-intent-choices").childElements.filter((node) => node.getAttribute("id"));

/** Every focusable inside a region, named so a failure reports a shape. */
const focusables = (document, region) =>
  tabSequence(document).filter((stop) => {
    for (let node = stop; node; node = node.parentNode) if (node === region) return true;
    return false;
  }).map((stop) => `${stop.tagName}#${stop.getAttribute("id") ?? ""}`);

/**
 * Reach a control by Tab alone: no mouse anywhere in this file. Bounded by the
 * page's own tab stops, so a control that leaves the sequence fails here rather
 * than looping. pressTab wraps, so a second call from inside the footer still
 * comes back round to the pair.
 */
function tabTo(document, id) {
  for (let press = 0; press <= tabSequence(document).length; press += 1) {
    const focused = pressTab(document);
    if (focused?.getAttribute("id") === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard visitor cannot choose a topic`);
}

/* ----------------------------- what is drawn ------------------------------ */

test("both intent controls are painted, outside every work-email form on the page", async (t) => {
  const { document } = await openHomepage(t);

  const drawn = toggles(document);
  assert.equal(drawn.length, 2, "the page must offer exactly two intents to choose between");
  assert.deepEqual(drawn.map((node) => node.getAttribute("id")),
    ["buyer-intent-demo", "buyer-intent-pilot"]);

  for (const button of drawn) {
    assert.equal(button.tagName, "BUTTON");
    // The harness reflects no properties, so `type` is read as the property the
    // markup sets: a button that defaults to submit would submit something.
    assert.equal(button.type, "button", "a topic control must not submit a form");
    assert.equal(button.getAttribute("aria-pressed"), "false", "nothing is chosen on arrival");
    assert.ok(tabSequence(document).includes(button), "the control must sit in the natural tab order");
    // Outside both forms: the field-note sign-up and the follow-up request.
    assert.ok(!button.closest("form"), "a topic control must not live inside a work-email form");
  }

  // Named with the site's own words for these two topics, not a seventh
  // description of them written for this section.
  assert.deepEqual(drawn.map((node) => textOf(node)),
    [FOLLOW_UP_INTENTS.demo, FOLLOW_UP_INTENTS.pilot]);
  assert.equal(FOLLOW_UP_INTENTS.demo, "A product demonstration");
  assert.equal(FOLLOW_UP_INTENTS.pilot, "A pilot evaluation");

  // The live region ships and stays empty until something changes, so that
  // setting it is a change assistive technology announces.
  const status = byId(document, "buyer-intent-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(textOf(status), "");
});

test("the section is read after the prompt-coach offer and before the story", async (t) => {
  const { document } = await openHomepage(t);

  const regions = byId(document, "main-content").childElements;
  const at = (match) => regions.findIndex(match);
  const coach = at((node) => node.getAttribute("class") === "coach-entry");
  const intent = at((node) => node.getAttribute("id") === "buyer-intent");
  const story = at((node) => node.getAttribute("id") === "decision-to-release");
  assert.ok(coach >= 0, "the prompt-coach offer left the home page");
  assert.ok(coach < intent, `the intent pair is region ${intent} and the coach offer is ${coach}`);
  assert.ok(intent < story, "the intent pair must stay above the decision-to-release story");

  // One heading, naming the choice, and it is what names the group of controls.
  assert.equal(textOf(byId(document, "buyer-intent-title")), "Say what you want to talk about.");
  assert.equal(byId(document, "buyer-intent").getAttribute("aria-labelledby"), "buyer-intent-title");
  const group = byId(document, "buyer-intent-choices");
  assert.equal(group.getAttribute("role"), "group");
  assert.equal(group.getAttribute("aria-labelledby"), "buyer-intent-title");
});

/* ------------------------------ choosing one ------------------------------ */

test("choosing reports one topic, and choosing the other replaces it", async (t) => {
  const { document, api } = await openHomepage(t);
  const choice = byId(document, "buyer-intent-choice");

  // Before anything is chosen the line says so rather than standing blank.
  assert.equal(textOf(choice), api.NOTHING_CHOSEN);
  assert.equal(api.NOTHING_CHOSEN, "Discussion topic: not chosen yet");

  tabTo(document, "buyer-intent-demo");
  pressEnter(document);
  assert.equal(byId(document, "buyer-intent-demo").getAttribute("aria-pressed"), "true");
  assert.equal(byId(document, "buyer-intent-pilot").getAttribute("aria-pressed"), "false");
  assert.equal(textOf(choice), "Discussion topic: A product demonstration");
  assert.equal(textOf(choice), api.choiceLine("demo"));

  // Mutually exclusive: the pair is one choice, not two independent switches.
  tabTo(document, "buyer-intent-pilot");
  pressEnter(document);
  assert.equal(byId(document, "buyer-intent-pilot").getAttribute("aria-pressed"), "true");
  assert.equal(byId(document, "buyer-intent-demo").getAttribute("aria-pressed"), "false");
  assert.equal(textOf(choice), "Discussion topic: A pilot evaluation");
  assert.equal(
    toggles(document).filter((node) => node.getAttribute("aria-pressed") === "true").length,
    1,
    "exactly one topic can be the chosen one",
  );

  // The reported choice is text, not a control: reviewing it costs no tab stop.
  assert.deepEqual(focusables(document, choice), []);
  assert.equal(choice.getAttribute("tabindex"), null);
});

test("choosing lands the visitor in the work-email field and announces the change", async (t) => {
  const { document, api } = await openHomepage(t);

  tabTo(document, "buyer-intent-demo");
  pressEnter(document);

  const email = byId(document, "site-footer-email");
  // ok(), not equal(): a failing equal() on two parsed nodes stringifies the
  // whole page to build its diff and never returns.
  assert.ok(document.activeElement === email, "the address must be unambiguously the next input");
  assert.equal(email.getAttribute("type"), "email");
  assert.equal(email.closest("form").getAttribute("id"), "site-footer-form");

  const status = byId(document, "buyer-intent-status");
  assert.equal(textOf(status), api.announcement("demo"));
  assert.match(textOf(status), /^Discussion topic set to A product demonstration\./);
  assert.match(textOf(status), /work email field at the foot of this page is now focused\.$/);

  // And the second choice re-announces rather than going quiet on a change.
  tabTo(document, "buyer-intent-pilot");
  pressEnter(document);
  assert.equal(textOf(byId(document, "buyer-intent-status")), api.announcement("pilot"));
  assert.ok(document.activeElement === email, "a changed topic must land in the field too");
});

/* ------------------ the topic where the address is typed ------------------- */

test("the chosen topic is visible beside the field, and says what the request sends", async (t) => {
  const { document, api } = await openHomepage(t);
  const panel = byId(document, "site-footer-panel");

  // Nothing is added to the follow-up block until there is a topic to report.
  assert.equal(panel.childElements.filter((node) => node.getAttribute("id") === "buyer-intent-carried").length, 0);

  tabTo(document, "buyer-intent-demo");
  pressEnter(document);

  const carried = byId(document, "buyer-intent-carried");
  assert.ok(carried, "the chosen topic must be readable where the address is typed");
  assert.equal(carried.tagName, "P");
  assert.equal(textOf(carried), api.carriedLine("demo"));
  assert.match(textOf(carried), /^Discussion topic: A product demonstration\./);
  // It does not imply the topic travels with the request. The footer already
  // says only the address is sent, and this line must agree with it.
  assert.match(textOf(carried), /sends only your work email/);
  assert.match(textOf(carried), /Choosing the other topic above replaces it\./);

  // Read before the field, inside the block it describes, and not a control.
  const order = [...panel.querySelectorAll("p"), ...panel.querySelectorAll("input")];
  assert.ok(order.indexOf(carried) >= 0, "the line must sit inside the follow-up block");
  assert.ok(order.indexOf(carried) < order.indexOf(byId(document, "site-footer-email")),
    "the topic must be read above the address it is about");
  assert.ok(!carried.closest("form"), "the line must not join the form it stands above");
  assert.deepEqual(focusables(document, carried), []);

  // The same string, updated rather than added to, when the choice changes.
  tabTo(document, "buyer-intent-pilot");
  pressEnter(document);
  assert.equal(panel.childElements.filter((node) => node.getAttribute("id") === "buyer-intent-carried").length, 1);
  assert.equal(textOf(byId(document, "buyer-intent-carried")), api.carriedLine("pilot"));
});

/* ----------------------- what must not have changed ----------------------- */

test("the follow-up block keeps its three tab stops and the field-note form its one", async (t) => {
  const { document } = await openHomepage(t);

  const stops = () => focusables(document, byId(document, "site-footer-panel"));
  // The field and the one submit that is visible on arrival; the retry ships
  // hidden, so it is not a stop until a request has actually failed.
  const before = stops();
  assert.deepEqual(before, ["INPUT#site-footer-email", "BUTTON#"],
    "the follow-up block did not parse, so the comparison below proves nothing");
  assert.equal(byId(document, "site-footer-retry").hidden, true);

  tabTo(document, "buyer-intent-pilot");
  pressEnter(document);
  assert.deepEqual(stops(), before, "the follow-up block's tab stops changed");

  // The field-note sign-up above is untouched too: one field, one submit.
  assert.deepEqual(focusables(document, byId(document, "lead-capture-form")),
    ["INPUT#lead-email", "BUTTON#"]);
});

test("the disclosure of what is sent, and when a person replies, stays visible", async (t) => {
  const { document } = await openHomepage(t);

  tabTo(document, "buyer-intent-demo");
  pressEnter(document);

  // Presence and text only: which paragraph sits above which is not this
  // change's rule to invent.
  const sent = byId(document, "site-footer-note");
  assert.equal(textOf(sent), "The work email address you type here goes to the Wawalu team that"
    + " operates Shiplog; nothing else on this page is sent.");
  assert.equal(sent.hidden, false);

  const reply = byId(document, "site-footer-reply");
  assert.equal(textOf(reply), "A person replies by email, usually within two working days.");
  assert.equal(reply.hidden, false);

  const use = byId(document, "site-footer-use");
  assert.equal(textOf(use), "We use your address to reply to this request and for nothing else.");
  assert.equal(use.hidden, false);
});

test("the request this page sends is unchanged, because no key exists to carry a topic", async (t) => {
  const { document } = await openHomepage(t);

  tabTo(document, "buyer-intent-demo");
  pressEnter(document);

  // The two facts that make the submitted-purpose half of #2593 undeliverable
  // without a schema decision. A widening of either list makes the key REQUIRED
  // on this purpose, so every plain submission here would start failing.
  assert.ok(!FOLLOW_UP_INTENT_PURPOSES.includes(HOMEPAGE_PURPOSE),
    "the home page's purpose now asks an intent: wire the choice into the payload");
  assert.ok(!FOLLOW_UP_MESSAGE_PURPOSES.includes(HOMEPAGE_PURPOSE),
    "the home page's form now offers a message: carry the topic in it");

  // So the wire values the form declares are exactly the two it declared
  // before, and the chosen topic is on neither of them.
  const form = byId(document, "site-footer-form");
  assert.equal(form.getAttribute("data-follow-up-type"), HOMEPAGE_PURPOSE);
  assert.equal(form.getAttribute("data-follow-up-topic"), FOLLOW_UP_TOPICS[HOMEPAGE_PURPOSE]);
  assert.equal(form.getAttribute("data-follow-up-intent"), null);
  // And nothing inside the form carries the choice as a value either.
  for (const control of form.querySelectorAll("input")) {
    assert.doesNotMatch(String(control.value), /demonstration|pilot evaluation/i);
  }
});
