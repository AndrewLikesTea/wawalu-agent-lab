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
// WHY A ROUTE MAY OPT OUT OF THE LANDING. A route carrying `data-buyer-intent`
// has a better one: homepage-buyer-intent.js records the topic that route names
// and puts the visitor in the work-email field itself, which is the field they
// came to fill. Wiring this module on top of it would undo that, and not only
// because two click handlers would race. A fragment target that CAN take focus
// is focused by the navigation the link performs after every handler has run, so
// the tabindex below would hand focus from the field back to the panel — the
// browser doing it, not this module, which is why no test harness catches it and
// why the opt-out is a guard here rather than an ordering convention there.
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
 * What the label alone does not say: where the route goes and what the form
 * there asks for. Issue #2556 — "Ask about Shiplog" read as a mail client, a
 * pricing page or a new tab to anyone who had not already scrolled to the foot
 * of the page.
 *
 * THE REPLY WINDOW IS NOT SAID HERE. #2689: this caption and the form it points
 * at both spelled FOLLOW_UP_REPLY, so five pages made one promise twice inside a
 * scroll. The sentence stays where the promise is made — beside the submit, from
 * lead-capture.js — and tests/ask-about-shiplog.test.js counts it once per page.
 *
 * It promises no price, no quote and no signup, because the site's answer to
 * both is that there is no self-serve signup and no published price and that
 * both are answered on request. Saying the form asks what you want to discuss
 * is a description of a fieldset, not an offer.
 */
export const ASK_ABOUT_SHIPLOG_DESCRIPTION =
  "Ask about Shiplog moves you to the follow-up form at the foot of this page,"
  + " which asks for a work email address, what you want to discuss and an"
  + " optional note.";

/**
 * Wire the route on a page that ships it. Returns a teardown, or null when this
 * page carries no route or no form — so a surface with neither is unaffected.
 */
export function initAskAboutShiplog(root = document) {
  const link = root.querySelector(`#${ASK_ABOUT_SHIPLOG_ID}`);
  const panel = root.querySelector(ASK_ABOUT_SHIPLOG_HREF);
  if (!link || !panel || link.hasAttribute("data-buyer-intent")) return null;
  panel.setAttribute("tabindex", "-1");
  const onClick = () => {
    panel.focus?.({ preventScroll: true });
    panel.scrollIntoView?.({ block: "start" });
  };
  link.addEventListener("click", onClick);
  return () => link.removeEventListener("click", onClick);
}
