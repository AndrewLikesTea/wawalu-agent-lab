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
 * What the label alone does not say: who answers and how soon. #2964 — the
 * caption used to narrate the scroll and list the form's fields, which the form
 * says for itself on arrival; what a visitor deciding whether to ask needs is
 * that a person on the Wawalu team answers, by email, and roughly when.
 *
 * THE REPLY WINDOW IS THE FORM'S OWN WORDS. #2689 removed a byte-for-byte copy
 * of FOLLOW_UP_REPLY from here; #2964 puts the promise back as the reason to
 * ask, so it reuses the form's exact "usually within two working days" — one
 * promise in one wording — and the form's own sentence stays the only
 * paragraph that reads FOLLOW_UP_REPLY, which tests/ask-about-shiplog.test.js
 * counts once per page.
 *
 * It promises no price, no quote and no signup, because the site's answer to
 * both is that there is no self-serve signup and no published price and that
 * both are answered on request.
 */
export const ASK_ABOUT_SHIPLOG_DESCRIPTION = "Ask about Shiplog, and a person on the Wawalu team"
  + " that operates it replies by email, usually within two working days.";

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

/**
 * The two direct asks beside the route (#2807), keyed by the FOLLOW_UP_INTENTS
 * value each one preselects. Both are answers the form's own "What do you want
 * to discuss?" question already offers, so no topic, purpose or wire field is
 * new: the request carries the page's purpose and the chosen intent exactly as
 * a visitor who ticked the radio by hand would send them.
 */
export const ASK_ABOUT_SHIPLOG_ACTIONS = Object.freeze({
  demo: "Request a Shiplog demonstration",
  pilot: "Discuss a Shiplog pilot",
});

/**
 * Preselect the answer a fragment names and put the visitor in the work-email
 * field, the one they still have to fill (#2962). The contract is the address
 * the actions already carry: `#site-footer-intent-<FOLLOW_UP_INTENTS key>`.
 * Only an exact match to a radio in the form counts, so an unknown, malformed,
 * encoded or repeated fragment names nothing and leaves the form as it was —
 * no decoding, so nothing to throw. Returns whether a radio was chosen.
 */
export function chooseFollowUpIntent(root, hash) {
  const form = root.querySelector("#site-footer-form");
  const radio = form && [...form.querySelectorAll('input[name="intent"]')].find((item) => `#${item.id}` === hash);
  if (!radio) return false;
  // A sent request is replaced by its receipt; reopen it through its own
  // control first, as the home page's topic pair does.
  if (form.hidden) root.querySelector("#site-footer-again")?.click();
  // Ticked the way a click would, which fires the change the footer already
  // listens for: an old error clears and the note's guidance shows. Nothing
  // locks it, so the visitor can still pick another answer.
  if (!radio.checked) radio.click();
  radio.scrollIntoView?.({ block: "center" });
  root.querySelector("#site-footer-email")?.focus({ preventScroll: true });
  return true;
}

/**
 * Wire every `data-follow-up-intent` link on the page, and the fragment the
 * page was opened or navigated with. Each link is an ordinary link to its own
 * radio in the footer form, so with no script — or opened in a new tab — it
 * still lands the reader on the question it would have answered for them.
 *
 * WHY A PLAIN CLICK PREVENTS THE DEFAULT. The fragment's target is the radio,
 * and a browser focuses a focusable fragment target after every handler has
 * run, which would take focus back from the email field. So the script records
 * the address itself with pushState — Back and a copied URL still work, and
 * Back's hashchange restores the earlier answer — and modified clicks stay native.
 */
export function initAskAboutShiplogActions(root = document, view = globalThis.window) {
  const links = [...root.querySelectorAll("[data-follow-up-intent]")];
  const teardowns = links.map((link) => {
    const onClick = (event) => {
      if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = link.getAttribute("href");
      if (!chooseFollowUpIntent(root, href)) return;
      event.preventDefault();
      if (view?.location && view.location.hash !== href) view.history?.pushState?.(view.history.state ?? null, "", href);
    };
    link.addEventListener("click", onClick);
    return () => link.removeEventListener("click", onClick);
  });
  const navigate = () => chooseFollowUpIntent(root, view?.location?.hash);
  view?.addEventListener?.("hashchange", navigate);
  navigate();
  teardowns.push(() => view?.removeEventListener?.("hashchange", navigate));
  return () => teardowns.forEach((teardown) => teardown());
}
