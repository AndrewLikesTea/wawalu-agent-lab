// The route from a page's own action row to the follow-up form at the foot of
// it — one label, one address, one landing, on every page that offers it.
//
// WHY A LINK AND NOT A BUTTON. The address is real: /#site-footer-panel is the
// same route the evaluation brief publishes for this exact question (see
// BRIEF_FOLLOW_UP_URL in shiplog-evaluation-brief.js), so a page whose script
// never ran still arrives at the form, the fragment stays shareable, and the
// back button undoes the jump. Nothing below prevents the default.
//
// WHAT THE SCRIPT ADDS IS THE LANDING, not the route. A fragment target that
// cannot take focus scrolls a sighted reader to the form and leaves a keyboard
// or screen-reader user exactly where they were — reading the section they just
// left while the form sits off screen. So the panel is made focusable and takes
// focus on activation. The panel and not the field: the container holds the
// offer, the line naming what this request is about, and the work-email field
// itself, so the arrival reads as a form with its reasons rather than as a
// cursor in a box. This mirrors initRecordReleaseJump in releases-page.js,
// which lands the Releases hero on the recorder the same way.
//
// THE TABINDEX IS SET HERE, not in the footer markup. That markup is generated
// by siteFooterMarkup() in site-footer.js and shipped byte for byte on every
// page that carries the band — site-footer.test.js compares the two — and only
// the pages that offer this route need the target to take focus. Setting it at
// init also costs the footer's own module graph nothing: it is on a measured
// byte budget (config/evolution-size-budget.json) and this module is not in it.

/** The one id the route carries, so a page, this module and its test agree. */
export const ASK_ABOUT_SHIPLOG_ID = "ask-about-shiplog";

/**
 * The label, in one place. It names the errand and not the gesture, and it is
 * deliberately not the submit button's words: renaming a submit enrols its form
 * in the byte-exact follow-up privacy and topic contracts.
 */
export const ASK_ABOUT_SHIPLOG_LABEL = "Ask about Shiplog";

/** The follow-up form's container, which is what the route lands on. */
export const ASK_ABOUT_SHIPLOG_HREF = "#site-footer-panel";

/** The id the description carries, so the link can point its accessible
 * description at it and a test can count it. */
export const ASK_ABOUT_SHIPLOG_DESCRIPTION_ID = "ask-about-shiplog-description";

/**
 * What the label alone does not say: where the route goes, what the form there
 * asks for, and what comes back. Issue #2556 — "Ask about Shiplog" read as a
 * mail client, a pricing page or a new tab to anyone who had not already
 * scrolled to the foot of the page.
 *
 * THE SECOND SENTENCE IS NOT WRITTEN HERE. It is FOLLOW_UP_REPLY from
 * lead-capture.js, byte for byte, because the form itself renders that sentence
 * above its button and a reader who arrives should meet the same words twice
 * rather than two promises to reconcile. It is copied rather than imported: this
 * module is the whole of what six pages load for the route, and importing the
 * lead-capture graph to spell one sentence would put a form module on pages that
 * only need a focus move. tests/ask-about-shiplog.test.js compares the two.
 *
 * It promises no price, no quote and no signup, because the site's answer to
 * both is that there is no self-serve signup and no published price and that
 * both are answered on request. Saying the form asks what you want to discuss
 * is a description of a fieldset, not an offer.
 */
export const ASK_ABOUT_SHIPLOG_DESCRIPTION =
  "Ask about Shiplog moves you to the follow-up form at the foot of this page,"
  + " which asks for a work email address, what you want to discuss and an"
  + " optional note. A person replies by email, usually within two working days.";

/**
 * The query key a cross-page route carries, and the value it carries in it: one
 * of the radio values the footer's "What do you want to discuss?" group renders
 * (`FOLLOW_UP_INTENTS` in lead-capture.js). It is the field's own name, so the
 * link, the control and the wire all spell the errand the same way.
 *
 * The home page's two buyer routes are what send it: that page's own follow-up
 * form is email-only — its request type is not in `FOLLOW_UP_INTENT_PURPOSES`,
 * so src/site-footer.js renders it no such group — and an errand as specific as
 * a demonstration or a pilot arriving there arrives as a bare address.
 */
export const FOLLOW_UP_INTENT_PARAM = "intent";

/** A radio value, not a selector: the query is a visitor-supplied string, and it
 * is built into an id below. */
const INTENT_VALUE = /^[a-z_]{1,32}$/;

/** The id the group's radio for one value carries, in src/site-footer.js. */
export const intentRadioId = (value) => `site-footer-intent-${value}`;

/**
 * What the live region says once the choice has been made for a visitor.
 *
 * `label` is read off the page's own <label> rather than written here: the
 * announcement then names the choice in the words the control beside it uses,
 * and there is no second copy of four labels to drift. It says the choice is
 * changeable because it was made without asking, and names the one field left,
 * because that is where the focus has just gone.
 */
export const followUpIntentLanded = (label) => `${label} is selected as what you want to discuss.`
  + " Your work email is the only thing left to enter, and you can change what you want to discuss"
  + " before you send the request.";

// Spread first, both here and for the group below: a live HTMLCollection and a
// NodeList carry no `find`, so a real browser is where an array method on one of
// them would throw and the harness is where it would never be noticed.
const labelIn = (parent) => [...(parent?.children ?? [])].find((node) => node.tagName === "LABEL");

/**
 * Land a visitor who arrived from another page's buyer route: make the choice
 * their link named, announce it where the form already announces, and put the
 * cursor in the one field left to fill.
 *
 * THE FIELD AND NOT THE PANEL, which is the opposite of the in-page route above.
 * A reader following that route has not said what they want yet and arrives to
 * read the form's offer and its topic line. A visitor arriving here chose the
 * errand on the page they came from and had the choice made for them, so the
 * address is the only thing this page still needs — and the announcement, not
 * the focus move, is what tells them the rest is done.
 *
 * Returns the value applied, or null: a page with no such group (every page's
 * footer that asks for an address only), a link with no query, and a value no
 * radio answers to all leave the form exactly as it shipped.
 */
export function initFollowUpIntentLanding(root = document, search = globalThis.window?.location?.search ?? "") {
  const requested = new URLSearchParams(String(search ?? "")).get(FOLLOW_UP_INTENT_PARAM) ?? "";
  if (!INTENT_VALUE.test(requested)) return null;
  const group = root.querySelector("#site-footer-intent");
  const email = root.querySelector("#site-footer-email");
  if (!group || !email) return null;
  const radios = [...group.querySelectorAll('input[name="intent"]')];
  const chosen = radios.find((radio) => radio.getAttribute("id") === intentRadioId(requested));
  if (!chosen) return null;
  // The whole group, not only the one: a browser unchecks the rest of a radio
  // group by itself, and saying so here keeps "one choice" true wherever this
  // runs rather than resting on that.
  for (const radio of radios) radio.checked = radio === chosen;
  const label = labelIn(chosen.parentNode);
  const status = root.querySelector("#site-footer-status");
  if (status && label) status.textContent = followUpIntentLanded(label.textContent.trim());
  email.focus?.({ preventScroll: true });
  root.querySelector(ASK_ABOUT_SHIPLOG_HREF)?.scrollIntoView?.({ block: "start" });
  return requested;
}

/**
 * Wire the route on a page that ships it. Returns a teardown, or null when this
 * page carries no route or no form — so a surface with neither is unaffected.
 *
 * The cross-page landing above runs first and independently of the route: it is
 * the same errand arriving from somewhere else, and a page could carry the form
 * without carrying the in-page link to it.
 */
export function initAskAboutShiplog(root = document) {
  initFollowUpIntentLanding(root);
  const link = root.querySelector(`#${ASK_ABOUT_SHIPLOG_ID}`);
  const panel = root.querySelector(ASK_ABOUT_SHIPLOG_HREF);
  if (!link || !panel) return null;
  panel.setAttribute("tabindex", "-1");
  const onClick = () => {
    panel.focus?.({ preventScroll: true });
    panel.scrollIntoView?.({ block: "start" });
  };
  link.addEventListener("click", onClick);
  return () => link.removeEventListener("click", onClick);
}
