// The home page's follow-up ask, where a visitor is actually convinced.
//
// The recoverable-spend figure is the front door's one checkable result. Until
// this shipped, a reader persuaded by it had to scroll the length of the page to
// the About block to raise their hand, and the only visible copy about what
// happens after they did was the failure message.
//
// So there are two things to hold, and they pull against each other:
//
//   1. ONE SURFACE, TWO PLACEMENTS. The ask in the hero is not a second contact
//      mechanism worded its own way — it is src/site-footer.js rendered twice.
//      This file compares the two copies string for string rather than pinning
//      literals, so a wording change that reached one and not the other fails
//      here instead of shipping as two voices for one errand.
//   2. TWO COPIES ON ONE PAGE ARE STILL TWO. Same words, different ids: a label
//      bound to the wrong field, or two panels a screen reader cannot tell
//      apart, is a real defect and not a nit.
//
// Behaviour is driven through the shipped page entry, the way
// tests/site-footer.test.js drives the footer's, so what is asserted is what a
// visitor's browser would do rather than what a module exports.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COMMITMENT, HOME_FOLLOW_UP, INVITATION } from "../src/site-footer.js";
import { FOLLOW_UP_PRIVACY } from "../src/lead-capture.js";
import { loadPage, pressEnter, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const TYPED_EMAIL = "director@example.com";
const HOME = HOME_FOLLOW_UP.prefix;

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));
const submitOf = (document, prefix) =>
  byId(document, `${prefix}-form`).querySelector('button[type="submit"]');

/** The home page with both copies of the surface wired the way a browser wires them. */
async function openHome() {
  const page = await loadPage(PAGE);
  await importPageModule("/site-footer-page.js");
  return page;
}

/** Lifted from tests/site-footer.test.js so both copies are pinned the same way. */
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

function submitEmail(document, prefix, value) {
  const field = byId(document, `${prefix}-email`);
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
}

const settled = (document, prefix) => waitFor(
  () => ["success", "error"].includes(byId(document, `${prefix}-form`).dataset.state),
  `the ${prefix} submission to settle`);

/* ------------------------------ where it sits ----------------------------- */

test("the ask sits in the opening section, on the figure rather than at the end of it", async () => {
  const html = await readFile(PAGE, "utf8");
  const hero = html.slice(html.indexOf('<section class="hero'), html.indexOf('<section class="landing-decision"'));

  // Inside the section that carries the recoverable-spend figure, not merely
  // somewhere above the fold.
  assert.ok(hero.includes(`id="${HOME}-form"`), "the opening section ships no follow-up form");

  // Immediately after the figure and its disclosure, and before the section's
  // remaining copy: the point of conviction, not the section's end.
  const figure = hero.indexOf('<p class="hero-proof-point">');
  const ask = hero.indexOf(`id="${HOME}-open"`);
  const boundary = hero.indexOf('<p class="hero-boundary">');
  assert.ok(figure >= 0 && ask > figure, "the ask must follow the figure that earns it");
  assert.ok(ask < boundary, "the ask must not be parked at the end of the section");

  // The figure stays the hero's only authored money, and the ask brings none of
  // its own — tests/landing-decision.test.js pins the pair for the whole page.
  const block = hero.slice(ask, boundary);
  assert.doesNotMatch(block, /\$\s*\d/, "the ask must not restate the example's figures");
});

/* ------------------------- one surface, two copies ------------------------ */

test("every word of the home page's ask is the footer's word, string for string", async () => {
  const page = await openHome();
  const { document } = page;
  try {
    for (const id of ["open", "form", "email", "note", "error", "status", "recovery", "dismiss"]) {
      assert.ok(Boolean(byId(document, `${HOME}-${id}`)), `the home page copy is missing #${HOME}-${id}`);
    }

    // The invitation, the field label, and both button labels, compared against
    // the footer's own rendering on the same page rather than against literals.
    const pairs = [
      ["invitation", textOf(document.querySelectorAll(".site-footer-invitation")[0]),
        textOf(document.querySelectorAll(".site-footer-invitation")[1])],
      ["field label", textOf(byId(document, `${HOME}-form`).querySelector("label")),
        textOf(byId(document, "site-footer-form").querySelector("label"))],
      ["trigger label", shownText(document, `${HOME}-open`), shownText(document, "site-footer-open")],
      ["submit label", textOf(submitOf(document, HOME)), textOf(submitOf(document, "site-footer"))],
      ["privacy note", shownText(document, `${HOME}-note`), shownText(document, "site-footer-note")],
      ["recovery copy", shownText(document, `${HOME}-recovery`), shownText(document, "site-footer-recovery")],
    ];
    for (const [what, home, footer] of pairs) {
      assert.equal(home, footer, `the ${what} has drifted between the two copies of one surface`);
    }

    // And the one name for the errand, on both controls.
    assert.equal(shownText(document, `${HOME}-open`), "Request a follow-up");
    assert.equal(textOf(submitOf(document, HOME)), "Request a follow-up");
    // No second verb for it anywhere in the opening section.
    const hero = textOf(document.querySelector(".hero-finops"));
    for (const competing of [/contact us/i, /get in touch/i, /talk to sales/i, /book a (?:call|demo)/i]) {
      assert.doesNotMatch(hero, competing, `the opening section names the errand "${competing}"`);
    }
  } finally {
    page.restore();
  }
});

test("the two copies share no id, and each field is bound to its own label", async () => {
  const page = await openHome();
  const { document } = page;
  try {
    // Every id the surface ships, twice over, all distinct. A duplicated id is
    // what makes a label point at the wrong field.
    const ids = [];
    for (const prefix of [HOME, "site-footer"]) {
      for (const part of ["open", "panel", "form", "email", "note", "error", "status", "recovery", "dismiss"]) {
        ids.push(`${prefix}-${part}`);
        assert.equal(document.querySelectorAll(`#${prefix}-${part}`).length, 1,
          `#${prefix}-${part} renders more than once`);
      }
    }
    assert.equal(new Set(ids).size, ids.length, "the two copies share an id");

    for (const prefix of [HOME, "site-footer"]) {
      const form = byId(document, `${prefix}-form`);
      assert.equal(form.querySelector("label").getAttribute("for"), `${prefix}-email`,
        `${prefix}: the label names another copy's field`);
      assert.equal(form.querySelector('input[type="email"]').getAttribute("aria-describedby"),
        `${prefix}-note`, `${prefix}: the field is described by another copy's note`);
      assert.equal(byId(document, `${prefix}-open`).getAttribute("aria-controls"), `${prefix}-panel`,
        `${prefix}: the trigger opens another copy's panel`);
    }

    // And the two panels are tellable apart: the home page's carries a name of
    // its own, the footer's is the only one in the About block.
    const named = byId(document, `${HOME}-panel`);
    assert.equal(named.getAttribute("role"), "group", "an aria-label on a plain container is not exposed");
    assert.equal(named.getAttribute("aria-label"), HOME_FOLLOW_UP.panelLabel);
    assert.ok(HOME_FOLLOW_UP.panelLabel.startsWith("Request a follow-up"),
      "the panel's name must use the site's one verb for this errand");
    assert.equal(byId(document, "site-footer-panel").getAttribute("aria-label"), null,
      "the footer's panel keeps its shipped markup");
  } finally {
    page.restore();
  }
});

/* -------------------------- who replies, and when ------------------------- */

test("who replies and how soon is readable before anything is typed", async () => {
  const page = await openHome();
  const { document } = page;
  try {
    // Beside the ask, on the page as it first paints — not behind the
    // disclosure, and not waiting on a submission.
    const invitation = textOf(document.querySelectorAll(".site-footer-invitation")[0]);
    assert.equal(invitation, INVITATION);
    assert.ok(invitation.includes(COMMITMENT), "the invitation must carry the commitment whole");
    assert.equal(byId(document, `${HOME}-panel`).hidden, true, "the ask must be collapsed at first paint");

    // Both halves, in specific words. "Soon" is not a commitment.
    assert.match(COMMITMENT, /Wawalu team that operates Shiplog/, "it must name who reads the email");
    assert.match(COMMITMENT, /within two business days/, "it must say how soon a person replies");
    for (const vague of [/\bsoon\b/i, /shortly/i, /as soon as possible/i, /right away/i]) {
      assert.doesNotMatch(COMMITMENT, vague, `the commitment hedges: ${vague}`);
    }
    // And nothing invented to carry it: no support org, no named person, no SLA
    // vocabulary, and no promise measured in hours.
    for (const claim of [/support team/i, /\bSLA\b/, /24 hours/i, /\bguarantee/i, /account (?:manager|executive)/i]) {
      assert.doesNotMatch(COMMITMENT, claim, `the commitment invents something: ${claim}`);
    }
  } finally {
    page.restore();
  }
});

test("the confirmation repeats the same commitment, in the same words", async () => {
  const page = await openHome();
  const { document } = page;
  const calls = interceptLeads((call) =>
    jsonReply({ captured: true, created: call === 1, purpose: "follow_up" }, call === 1 ? 201 : 200));
  try {
    byId(document, `${HOME}-open`).click();
    assert.equal(document.activeElement?.id, `${HOME}-email`, "opening the ask must put the cursor in it");

    submitEmail(document, HOME, TYPED_EMAIL);
    await settled(document, HOME);

    // The shared transport, and only the typed address on the wire.
    assert.equal(calls.length, 1, "one submission must produce exactly one request");
    assert.equal(calls[0].url, "/api/leads");
    assert.deepEqual(JSON.parse(calls[0].options.body), { email: TYPED_EMAIL, purpose: "follow_up" });

    const confirmation = shownText(document, `${HOME}-status`);
    assert.match(confirmation, /^Follow-up requested —/);
    assert.ok(confirmation.endsWith(COMMITMENT),
      "a visitor who submitted must be told the same thing they were told before submitting");
    assert.equal(byId(document, `${HOME}-status`).getAttribute("role"), "status");

    // The receipt that replaces the form says it about the address it names, so
    // the two visible outcomes agree rather than one of them staying silent.
    assert.match(shownText(document, `${HOME}-confirmation`), /within two business days/);
    assert.match(shownText(document, `${HOME}-confirmation`), new RegExp(TYPED_EMAIL));
    assert.equal(byId(document, `${HOME}-form`).hidden, true, "a landed request must leave nothing to press again");

    // The footer's copy on the same page is untouched by all of this.
    assert.equal(byId(document, "site-footer-panel").hidden, true);
    assert.equal(shownText(document, "site-footer-status"), "");
    assert.equal(byId(document, "site-footer-form").dataset.state, undefined);
  } finally {
    page.restore();
  }
});

test("a failure names the ask that failed and keeps the typed address", async () => {
  const page = await openHome();
  const { document } = page;
  interceptLeads(() => jsonReply({ error: { code: "storage_unavailable" } }, 503));
  try {
    byId(document, `${HOME}-open`).click();
    submitEmail(document, HOME, TYPED_EMAIL);
    await settled(document, HOME);

    assert.equal(byId(document, `${HOME}-form`).dataset.state, "error");
    assert.equal(byId(document, `${HOME}-email`).value, TYPED_EMAIL,
      "a failed submission must not clear the address the visitor typed");
    assert.equal(byId(document, `${HOME}-recovery`).hidden, false);
    // The words the footer's failure uses — this is one surface, and a visitor
    // must not be told the field-note sign-up went wrong.
    assert.equal(shownText(document, `${HOME}-status`),
      "We didn’t get your request because follow-up requests are temporarily offline.");
    assert.doesNotMatch(shownText(document, `${HOME}-status`), /subscrib/i);
  } finally {
    page.restore();
  }
});

/* ------------------------------- keyboard --------------------------------- */

test("the ask costs the first screen one tab stop, and the AI FinOps route still follows it", async () => {
  const page = await openHome();
  const { document } = page;
  try {
    const stops = tabSequence(document);
    const at = (node) => stops.indexOf(node);
    const trigger = byId(document, `${HOME}-open`);
    const primary = document.querySelector('a[href="/evolution.html"].button-link');

    assert.ok(at(trigger) >= 0, "the ask must sit in the natural tab order");
    assert.ok(at(trigger) < at(primary),
      "the ask reads with the figure, so it precedes the actions below it");
    assert.ok(at(primary) >= 0, "the hero's primary route must stay reachable");

    // Collapsed, it is exactly one stop: the field and the two panel buttons
    // are behind the disclosure, so the first screen gains one control and not
    // four.
    for (const id of [`${HOME}-email`, `${HOME}-dismiss`]) {
      assert.ok(!stops.includes(byId(document, id)), `#${id} is a tab stop while the ask is collapsed`);
    }

    // Opened, the form's controls follow the trigger rather than jumping ahead
    // of the hero's actions.
    trigger.click();
    const opened = tabSequence(document).map((node) => node.id);
    const order = [`${HOME}-open`, `${HOME}-email`, `${HOME}-dismiss`].map((id) => opened.indexOf(id));
    assert.ok(order.every((position) => position >= 0), "the disclosed form must be keyboard reachable");
    assert.deepEqual([...order].sort((left, right) => left - right), order,
      "the disclosed form must follow its trigger in the tab order");
  } finally {
    page.restore();
  }
});
