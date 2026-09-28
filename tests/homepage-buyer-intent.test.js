// The home page's two buyer errands, and where each one lands.
//
// Issue #2593: the home page had one route for both — "Request a demonstration
// or discuss a pilot" in the log section — and it landed on this page's own
// follow-up form, which asks for a work email and nothing else. That form ships
// no "What do you want to discuss?" control and cannot: its request type
// (`follow_up_homepage`) is not in `FOLLOW_UP_INTENT_PURPOSES`, so
// src/site-footer.js renders it no such group, and several contracts plus a
// literal tab-stop count in tests/homepage-log-leads.test.js hold the section
// that carries the route to exactly one contact destination. So a visitor who
// arrived to ask about a demonstration handed over an address and hoped.
//
// What ships instead: two separately labelled routes below the prompt-coach
// entry, each landing on the footer form of a page that DOES carry the control,
// with the matching choice made, announced, and still changeable, and the
// work-email field focused.
//
// HARNESS RULES OBSERVED HERE. Counts and attributes, never
// `assert.equal(node, null)` — comparing a harness element stringifies the whole
// parsed page and outlives the timeout. `checked` is asserted as a property,
// because this harness reflects no property to an attribute. And the destination
// is loaded from the href the home page actually ships, so the two halves of the
// route cannot drift apart while both tests stay green.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import {
  ASK_ABOUT_SHIPLOG_HREF, ASK_ABOUT_SHIPLOG_ID, followUpIntentLanded, intentRadioId,
} from "../src/ask-about-shiplog.js";
import { FOLLOW_UP_INTENTS, FOLLOW_UP_PRIVACY_WITH_MESSAGE, FOLLOW_UP_REPLY } from "../src/lead-capture.js";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { initReleasesPage } from "../src/releases-page.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";

const SRC = new URL("../src/", import.meta.url);
const HOME = new URL("index.html", SRC);

// One row per errand: the control on the home page, and the choice it makes on
// the page it opens. The labels the radios carry are not written here — they are
// `FOLLOW_UP_INTENTS`, so a renamed choice fails this file instead of leaving it
// asserting a string nothing renders.
const ROUTES = [
  { id: "buyer-intent-demo", intent: "demo", page: "coach.html", label: "Ask about a product demonstration" },
  { id: "buyer-intent-pilot", intent: "pilot", page: "releases.html", label: "Ask about a pilot evaluation" },
];

const linkById = (root, id) => root.querySelectorAll("a").filter((node) => node.getAttribute("id") === id);

async function openHome(t) {
  const page = await loadPage(HOME, { storage: { [STORAGE_KEY]: "[]", [RELEASE_STORAGE_KEY]: "[]" } });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  return page.document;
}

/**
 * The destination, opened the way the link opens it: same path, same query.
 *
 * The caller owns the teardown rather than registering it here, because a test
 * that opens more than one page has to close the newest first: `t.after`
 * callbacks run oldest first, which would leave an earlier page's globals
 * installed for whatever runs next.
 */
async function followRoute(href, search) {
  const { pathname } = new URL(href, "https://labs.wawalu.org");
  const page = await loadPage(new URL(pathname.replace(/^\//, ""), SRC), { location: { search } });
  if (pathname === "/releases.html") {
    // This page has no ask-about-shiplog-page.js of its own: releases-page.js
    // wires the route, so that is what has to do the landing here too.
    initReleasesPage(page.document, page.storage, {
      location: { pathname, origin: "https://labs.wawalu.org", search, hash: "" },
      history: { replaceState() {} },
    });
  } else {
    await importPageModule("/ask-about-shiplog-page.js");
  }
  return page;
}

test("the home page offers each buyer errand its own control, below the prompt-coach entry", async (t) => {
  const document = await openHome(t);
  const html = await readFile(HOME, "utf8");

  assert.equal(document.querySelectorAll("#buyer-intent").length, 1,
    "the home page must paint exactly one buyer-intent block");
  assert.equal(textOf(document.getElementById("buyer-intent-title")),
    "Asking about a demonstration or a pilot");

  const sequence = tabSequence(document);
  for (const { id, intent, page, label } of ROUTES) {
    const found = linkById(document, id);
    assert.equal(found.length, 1, `${id}: painted ${found.length} times, not once`);
    const [route] = found;
    // The accessible name is the visible text, and the two errands are told
    // apart by it: that is the whole point of there being two controls.
    assert.equal(textOf(route), label);
    assert.equal(route.getAttribute("aria-label"), null);
    assert.equal(route.tagName, "A", "a real link, so a page whose script never ran still arrives");
    assert.equal(route.getAttribute("href"), `/${page}?intent=${intent}${ASK_ABOUT_SHIPLOG_HREF}`);
    assert.ok(sequence.includes(route), `${id}: not reachable by Tab`);
  }
  assert.notEqual(textOf(linkById(document, ROUTES[0].id)[0]), textOf(linkById(document, ROUTES[1].id)[0]));

  // Below the coach entry, in the document and in the tab order: the coach link
  // is the last stop before the footer and tests/prompt-coach-destination.test.js
  // walks the page to it, so a control added above it breaks that walk.
  const coach = document.querySelector(".coach-entry").querySelector('a[href="/coach.html"]');
  assert.ok(html.indexOf('class="coach-entry"') < html.indexOf('id="buyer-intent"'));
  for (const { id } of ROUTES) {
    assert.ok(sequence.indexOf(coach) < sequence.indexOf(linkById(document, id)[0]),
      `${id}: tabbed before the prompt-coach entry it sits below`);
  }

  // And the log section's own ask is untouched: still one route, still in-page.
  const asks = linkById(document, ASK_ABOUT_SHIPLOG_ID);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].getAttribute("href"), ASK_ABOUT_SHIPLOG_HREF);
  assert.equal(document.getElementById("shiplog-entry")
    .querySelectorAll("a")
    .filter((node) => node.getAttribute("id") === ASK_ABOUT_SHIPLOG_ID).length, 1,
    "the offer paragraph must keep exactly its one contact destination");
});

for (const { id, intent, page, label } of ROUTES) {
  test(`${label} lands on ${page} with the choice made, announced, and changeable`, async (t) => {
    const home = parseHtml(await readFile(HOME, "utf8"));
    const href = linkById(home, id)[0].getAttribute("href");
    assert.equal(href.slice(href.indexOf("#")), ASK_ABOUT_SHIPLOG_HREF,
      "the route must land on the form's container, not the top of the page");
    const destination = await followRoute(href, `?intent=${intent}`);
    t.after(() => destination.restore());
    const { document } = destination;

    // The form it lands on is one that can hold the errand, and it names which
    // page the request is about, as every form carrying this control does.
    assert.equal(document.querySelectorAll(ASK_ABOUT_SHIPLOG_HREF).length, 1,
      `${page}: the fragment the route names is not on the page`);
    const group = document.querySelector("#site-footer-intent");
    assert.ok(group, `${page}: the page ships no "what do you want to discuss" control`);
    assert.equal(document.querySelectorAll("#site-footer-topic-note").length, 1);

    // The choice, read as a property: this harness reflects none to attributes.
    const radios = [...group.querySelectorAll('input[name="intent"]')];
    assert.equal(radios.length, Object.keys(FOLLOW_UP_INTENTS).length);
    const chosen = radios.filter((radio) => radio.checked);
    assert.equal(chosen.length, 1, `${page}: ${chosen.length} choices are made, not one`);
    assert.equal(chosen[0].getAttribute("id"), intentRadioId(intent));
    assert.equal(chosen[0].getAttribute("value"), intent);
    // Named on the page in the words the constant carries, beside the radio.
    const shown = [...chosen[0].parentNode.children].find((node) => node.tagName === "LABEL");
    assert.equal(textOf(shown), FOLLOW_UP_INTENTS[intent]);

    // Reviewable and changeable before sending: the group is still rendered,
    // still operable, and nothing was disabled to keep the choice.
    assert.equal(group.getAttribute("hidden"), null);
    assert.equal(radios.filter((radio) => radio.getAttribute("disabled") !== null).length, 0);
    assert.equal(radios.filter((radio) => radio.getAttribute("readonly") !== null).length, 0);
    assert.equal(group.getAttribute("aria-disabled"), null);

    // The one field left is where the cursor is.
    assert.equal(document.activeElement?.getAttribute("id"), "site-footer-email",
      `${page}: focus did not land on the work-email field`);

    // Announced where this form already announces — the status region it uses
    // for its own receipts — rather than in a live region added for the arrival.
    const status = document.querySelectorAll("#site-footer-status");
    assert.equal(status.length, 1);
    assert.equal(status[0].getAttribute("role"), "status");
    assert.equal(status[0].getAttribute("aria-live"), "polite");
    assert.equal(textOf(status[0]), followUpIntentLanded(FOLLOW_UP_INTENTS[intent]));

    // And what the form discloses is still there to read: what it sends, and
    // when a person answers.
    assert.equal(textOf(document.getElementById("site-footer-note")), FOLLOW_UP_PRIVACY_WITH_MESSAGE);
    assert.equal(textOf(document.getElementById("site-footer-reply")), FOLLOW_UP_REPLY);
  });
}

test("a visitor who arrives without a buyer route chooses for themselves", async () => {
  // No query at all, and a query naming no choice: both leave the form exactly
  // as it shipped, because a choice made for a visitor who did not ask for one
  // is a choice they would have to notice to undo. Each page is closed before
  // the next opens, so no page's globals outlive it.
  for (const search of ["", "?intent=whatever-they-typed", "?intent="]) {
    const page = await followRoute("/coach.html", search);
    try {
      const { document } = page;
      const radios = [...document.querySelector("#site-footer-intent").querySelectorAll('input[name="intent"]')];
      assert.equal(radios.filter((radio) => radio.checked).length, 0,
        `${search || "no query"}: a choice was made for a visitor who named none`);
      assert.equal(textOf(document.getElementById("site-footer-status")), "",
        `${search || "no query"}: the live region announced an arrival that did not happen`);
    } finally {
      page.restore();
    }
  }
});
