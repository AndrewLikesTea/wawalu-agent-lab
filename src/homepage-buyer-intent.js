// Carry the reason a buyer came here into the follow-up request (#2593).
//
// WHAT THE FORM SENDS DOES NOT CHANGE, AND CANNOT WITHOUT A SCHEMA DECISION.
// The home page's request type is `follow_up_homepage`, which is not in
// `FOLLOW_UP_INTENT_PURPOSES` in src/leads.js, so an `intent` key sent with it
// is a field `handleLeadRequest` refuses whole as `invalid_request`; it is not
// in `FOLLOW_UP_MESSAGE_PURPOSES` either, so there is no free-text field to
// carry the reason instead. Adding the purpose to either list is not a widening
// — it makes the key REQUIRED on this purpose, so every plain homepage
// submission that does not carry one starts failing with `invalid_intent`. That
// is a two-sided contract change and it is not this module's to make.
//
// So the choice is a note this page keeps: it records what the visitor came
// for, shows it where they are about to type, and puts them in the field. The
// footer's own disclosure still says only the address is sent, and the line
// this module writes beside the field says the same thing rather than implying
// the topic travels with it.
//
// THE PAIR IS DRAWN, NOT SHIPPED. Choosing moves focus into the form at the
// foot of the page, which a page whose script never ran cannot do, and a dead
// control is worse than no control — the same reason the print control on this
// page is drawn by src/landing-decision-page.js. What ships is the section's
// prose, an empty slot, and the empty live region that announces the change.
//
// THE LABELS ARE NOT NEW WORDS. Both come from `FOLLOW_UP_INTENTS`, the map the
// five footer forms that do ask this question already render, so "A product
// demonstration" has one wording across the site.

import { FOLLOW_UP_INTENTS } from "/lead-capture.js";

/** The two a buyer chooses between, in the order the section offers them. */
export const BUYER_INTENTS = Object.freeze(["demo", "pilot"]);

export const CHOICE_PREFIX = "Discussion topic: ";
/** The state before anyone chooses, said rather than left blank. */
export const NOTHING_CHOSEN = `${CHOICE_PREFIX}not chosen yet`;

/** What the section reports back, so a choice can be reviewed before sending. */
export const choiceLine = (intent) =>
  (BUYER_INTENTS.includes(intent) ? `${CHOICE_PREFIX}${FOLLOW_UP_INTENTS[intent]}` : NOTHING_CHOSEN);

// Said beside the field, because a topic printed over a form reads as something
// the form carries. It does not, and the way to get it to a person is the reply
// this request asks for.
export const CARRIED_SUFFIX = "This request sends only your work email, so name the topic when the reply"
  + " reaches you. Choosing the other topic above replaces it.";

/** The same choice, where the visitor is about to type the address. */
export const carriedLine = (intent) => `${choiceLine(intent)}. ${CARRIED_SUFFIX}`;

/** What the polite region says: the change, then where the reader now is. */
export const announcement = (intent) =>
  `Discussion topic set to ${FOLLOW_UP_INTENTS[intent]}. The work email field at the foot of this page is now focused.`;

function toggle(document, intent) {
  const button = document.createElement("button");
  // Attributes rather than properties: this is the markup a browser reflects
  // from, and `button.type = "button"` would leave a submit in the HTML.
  button.setAttribute("type", "button");
  button.setAttribute("id", `buyer-intent-${intent}`);
  // The site's existing pressed-toggle style, so the pair needs no new rule.
  button.setAttribute("class", "filter-toggle");
  button.setAttribute("aria-pressed", "false");
  button.dataset.intent = intent;
  button.textContent = FOLLOW_UP_INTENTS[intent];
  return button;
}

function carriedNote(document) {
  const note = document.createElement("p");
  note.setAttribute("id", "buyer-intent-carried");
  // The form-hint role the footer's own sentences already use: no new colour,
  // size, or spacing to pay for in a stylesheet with little to spare.
  note.setAttribute("class", "site-footer-note");
  return note;
}

/**
 * Wire the pair, and return it so a test can drive a choice the way a visitor
 * does. Null when the section is not on the page, which is every page but this
 * one.
 */
export function initBuyerIntent(document) {
  const choices = document.getElementById("buyer-intent-choices");
  const choice = document.getElementById("buyer-intent-choice");
  const status = document.getElementById("buyer-intent-status");
  if (!choices || !choice || !status) return null;

  const panel = document.getElementById("site-footer-panel");
  const form = document.getElementById("site-footer-form");
  const email = document.getElementById("site-footer-email");

  const buttons = BUYER_INTENTS.map((intent) => toggle(document, intent));
  choices.replaceChildren(...buttons);
  choice.textContent = NOTHING_CHOSEN;

  // Created on the first choice rather than shipped empty: before anyone
  // chooses there is no topic to report, and an empty paragraph above a form is
  // a gap a reader has to account for.
  let carried = null;
  function carry(intent) {
    if (!panel || !form) return;
    carried ??= panel.insertBefore(carriedNote(document), form);
    carried.textContent = carriedLine(intent);
  }

  function choose(intent) {
    // One pressed control at a time: the pair is a choice, not two switches.
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.intent === intent));
    }
    choice.textContent = choiceLine(intent);
    carry(intent);
    // Focus first, then announce: a polite region queues behind the name of the
    // field the reader has just landed in, rather than racing it.
    email?.focus();
    status.textContent = announcement(intent);
  }

  for (const button of buttons) {
    button.addEventListener("click", () => choose(button.dataset.intent));
  }
  return { buttons, choose };
}

const page = globalThis.document ?? null;
if (page?.getElementById("buyer-intent-choices")) initBuyerIntent(page);
