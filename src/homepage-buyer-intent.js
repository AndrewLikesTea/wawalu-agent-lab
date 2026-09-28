// Two buyer questions, two controls, and what each one carries into the
// follow-up form at the foot of the home page.
//
// WHAT WAS WRONG. The home page offered one link — "Request a demonstration or
// discuss a pilot" — for two different errands, and it carried neither of them
// anywhere. A buyer who pressed it landed on the form's container and then had
// to say in some other channel which of the two they had come for, because
// every home-page request reached the Wawalu team as the same row: "Homepage —
// record a decision and explore Shiplog".
//
// WHAT THIS DOES. It replaces that one link with two, and makes each one carry
// its answer: the choice goes into the address bar, the form's topic line
// states it in words, the form sends it as its topic, and focus lands in the
// work-email field so the next thing to do is unmistakable.
//
// WHY THE TOPIC AND NOT AN `intent`. The site already has a four-way "What do
// you want to discuss?" radio group, and five footer forms render it — but it
// is a focusable INSIDE the form, and the home page's form is the one whose
// internal focus order is pinned from another page: the evaluation brief
// publishes /#site-footer-panel as the address for exactly this question, and
// tests/shiplog-evaluation-brief.test.js requires the first Tab stop inside
// that panel to be the work-email field and the next one to be the submit
// button. Adding a control between them would move a keyboard buyer's landing
// away from the field the brief sent them to fill. So the choice is made on the
// controls above the form, and travels in the column this purpose already
// sends and already prints above the field — the topic (HOMEPAGE_BUYER_TOPICS
// in src/leads.js, accepted there beside the purpose's default).
//
// WHY LINKS AND NOT BUTTONS. The address is real. /?discuss=pilot#site-footer-panel
// is a page of this site: a visitor with no JavaScript still arrives at the
// form, the choice survives a reload, and the URL can be forwarded to whoever
// actually fills the form in. The handler below only removes the reload.

import { FOLLOW_UP_TOPICS, HOMEPAGE_BUYER_TOPICS } from "./leads.js";

/** The query key the two controls put the choice under. */
export const BUYER_INTENT_PARAM = "discuss";

/** The one id the description carries, so both labels can point at it. */
export const BUYER_INTENT_DESCRIPTION_ID = "buyer-intent-description";

/** The container the route lands on, and the field it lands focus in. */
const PANEL_ID = "site-footer-panel";
const EMAIL_ID = "site-footer-email";
const FORM_ID = "site-footer-form";
const TOPIC_NOTE_ID = "site-footer-topic-note";

/**
 * The two controls, in the order a buyer decides between them.
 *
 * `label` names the errand and not the gesture, and the two are deliberately
 * not paraphrases of each other: "Request a product demonstration" asks to be
 * shown the product, "Discuss a pilot evaluation" asks to talk about running
 * one. They are the words FOLLOW_UP_INTENTS already uses for the same two
 * choices, turned into things a visitor can press.
 */
export const BUYER_INTENT_CONTROLS = Object.freeze(Object.keys(HOMEPAGE_BUYER_TOPICS).map((key) => Object.freeze({
  key,
  id: `buyer-intent-${key}`,
  href: `/?${BUYER_INTENT_PARAM}=${key}#${PANEL_ID}`,
  label: key === "demo" ? "Request a product demonstration" : "Discuss a pilot evaluation",
  topic: HOMEPAGE_BUYER_TOPICS[key],
})));

/**
 * What the labels alone do not say: where the two routes go, that they land on
 * the same form, and what comes back. One line for the pair, because it is the
 * same destination and a caption each would say it twice.
 *
 * The last sentence is FOLLOW_UP_REPLY from src/lead-capture.js, byte for byte,
 * so a buyer meets the same promise here and again above the button.
 * tests/homepage-buyer-intent.test.js compares the two.
 */
export const BUYER_INTENT_DESCRIPTION =
  "Either one moves you to the follow-up form at the foot of this page, states"
  + " there what your request is about, and puts the cursor in the work email"
  + " field. A person replies by email, usually within two working days.";

/** The choice an address carries, or null when it carries none we offer. */
export function buyerIntentFromSearch(search) {
  const raw = new URLSearchParams(String(search ?? "").replace(/^\?/, "")).get(BUYER_INTENT_PARAM);
  return typeof raw === "string" && Object.hasOwn(HOMEPAGE_BUYER_TOPICS, raw) ? raw : null;
}

/** The sentence the form prints above the work-email field, for any topic. */
export const topicSentence = (topic) => `This request is sent about the ${topic}.`;

/**
 * Wire the pair on the page that ships it. Returns a teardown, or null when
 * this page carries neither control or carries no follow-up form — so every
 * other page of the site is unaffected by importing this.
 */
export function initHomepageBuyerIntent(root = document, {
  locationRef = globalThis.location ?? globalThis.window?.location,
  historyRef = globalThis.history ?? globalThis.window?.history,
} = {}) {
  const form = root.querySelector(`#${FORM_ID}`);
  const controls = BUYER_INTENT_CONTROLS
    .map((control) => ({ control, node: root.querySelector(`#${control.id}`) }))
    .filter(({ node }) => node);
  if (!form || controls.length === 0) return null;

  const panel = root.querySelector(`#${PANEL_ID}`);
  const email = root.querySelector(`#${EMAIL_ID}`);
  const note = root.querySelector(`#${TOPIC_NOTE_ID}`);
  // A fragment target that cannot take focus scrolls a sighted reader to the
  // form and leaves everyone else where they were. Set here rather than in the
  // footer's generated markup, which every page ships byte for byte.
  panel?.setAttribute("tabindex", "-1");

  /**
   * Put the choice on the form, in the line above the field, and on the control
   * that made it. The attribute and the property are both written: the submit
   * path in src/site-footer.js reads `form.dataset.followUpTopic`, and the
   * attribute is what a reader inspecting the page sees.
   */
  function apply(key) {
    const topic = HOMEPAGE_BUYER_TOPICS[key] ?? FOLLOW_UP_TOPICS.follow_up_homepage;
    form.setAttribute("data-follow-up-topic", topic);
    form.dataset.followUpTopic = topic;
    if (note) note.textContent = topicSentence(topic);
    for (const { control, node } of controls) {
      if (control.key === key) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    }
    return topic;
  }

  function land() {
    // The field, not the container: the buyer has already said what the request
    // is about, so the one thing left is the address. The panel is scrolled to
    // the top anyway, so the offer and the topic line arrive with the field.
    email?.focus?.({ preventScroll: true });
    panel?.scrollIntoView?.({ block: "start" });
  }

  const teardowns = [];
  for (const { control, node } of controls) {
    const onClick = (event) => {
      // A modified press is a request for a new tab or window, and the address
      // is real, so let the browser have it.
      if (event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey || event?.button) return;
      event?.preventDefault?.();
      apply(control.key);
      // The address bar keeps the answer, so a reload and a forwarded link both
      // arrive on the same choice. `replaceState` rather than `pushState`: the
      // two controls are two readings of one page, not two pages.
      historyRef?.replaceState?.(null, "", control.href);
      land();
    };
    node.addEventListener("click", onClick);
    teardowns.push(() => node.removeEventListener("click", onClick));
  }

  // An address that already names a choice is a buyer arriving from their own
  // earlier press, or from a link somebody forwarded them. Same landing.
  const arrived = buyerIntentFromSearch(locationRef?.search);
  if (arrived) {
    apply(arrived);
    land();
  }

  return () => {
    for (const teardown of teardowns) teardown();
  };
}
