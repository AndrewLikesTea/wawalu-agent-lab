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
 * What the label alone does not say: where the route goes, what a visitor may
 * ask for once they are there, and what comes back. Issue #2556 — "Ask about
 * Shiplog" read as a mail client, a pricing page or a new tab to anyone who had
 * not already scrolled to the foot of the page.
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
 * both are answered on request.
 *
 * WHY IT NAMES TWO OFFERS AND NOT THREE FIELDS. Issue #2643: the first sentence
 * used to list what the form asks for — an address, a topic, an optional note —
 * which is a description of a fieldset rather than an offer, so a reader learned
 * they would be asked what they want to discuss without learning that a product
 * demonstration and a pilot evaluation are two of the answers. It now names
 * those two, lower-cased out of FOLLOW_UP_INTENTS in lead-capture.js and in the
 * order that fieldset lists them, so a reader meets the option they will pick in
 * the words they will pick it by. It names NEITHER of the other two: availability
 * and pricing is the one answer this line may not restate, and security and data
 * handling has its own brief on the home page.
 *
 * THE WORK-EMAIL REQUIREMENT LEFT WITH THE FIELD LIST, deliberately: the form
 * states what it sends and to whom in FOLLOW_UP_PRIVACY_WITH_MESSAGE, directly
 * above its own button, where a visitor reads it at the moment they type it. A
 * caption under a link is the place to say what can be asked for.
 */
export const ASK_ABOUT_SHIPLOG_DESCRIPTION =
  "Ask about Shiplog moves you to the follow-up form at the foot of this page,"
  + " where you can request a product demonstration or discuss a pilot"
  + " evaluation. A person replies by email, usually within two working days.";

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
