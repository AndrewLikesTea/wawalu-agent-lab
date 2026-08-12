// The hand-raise under the home page's executive takeaway.
//
// A visitor who has just read "$51,254 of $154,500 is recoverable" is reading
// somebody else's synthetic numbers, and the one thing they cannot do with them
// is ask about their own. The two controls beside the takeaway are a clipboard
// and a link; this is the third, and it opens a work-email form in place. There
// is no navigation, nothing overlays the page, and the takeaway above it never
// moves.
//
// NOTHING NEW IS IMPLEMENTED HERE, AND THAT IS THE POINT.
//
//   • The behaviour is src/finops-contact.js, the panel that already drives the
//     AI FinOps result and the executive briefing, wired to a third id family.
//     Disclosure, focus, validation, submission, failure and retry are that one
//     implementation, so this panel cannot drift away from the other two.
//   • The promise about what is sent is FOLLOW_UP_PRIVACY in
//     src/lead-capture.js, rendered in the markup beside the field.
//     tests/follow-up-privacy.test.js discovers this form and holds it to that
//     sentence byte for byte.
//   • The receipt is createFollowUpConfirmation in
//     src/follow-up-confirmation.js — the same named confirmation the footer's
//     form leaves, naming the address that was sent.
//   • The two success sentences are the FOOTER'S, imported rather than
//     re-authored. The AI FinOps form promises two business days because someone
//     watches that queue; the footer deliberately promises no response time, and
//     a hand-raise on the front page of a demonstration product is the footer's
//     situation, not the result page's.
//
// WHY IT IS ITS OWN PAGE MODULE. src/site-footer-page.js and its static import
// graph are a tracked size budget with about 100 bytes of headroom, and every
// page on the site pays for that graph before it paints. This panel is on one
// page, so it loads on one page: the home page's own script tag, outside that
// graph. src/site-footer.js is imported here for two strings and is not changed
// by that — the footer's form, on this page and on every other, is untouched.
//
// WHY THE CONTROL IS NOT LABELLED "Request a follow-up". Issue #646 gave every
// control that opens or submits one of these forms exactly that label, and this
// module keeps it on the control that SENDS. The control that opens this one
// names the errand instead, because it stands inside a block of example figures
// between a clipboard button and a link to a demonstration page: "Request a
// follow-up" there reads as a follow-up about the example. The sentence beside
// it says who the team is, the same way the footer's invitation does.

import { initFinopsContact } from "./finops-contact.js";
import { ALREADY_CAPTURED, CAPTURED } from "./site-footer.js";

/** The id family this panel ships, and the one src/index.html authors. */
export const PREFIX = "homepage-follow-up";

/**
 * What the control says it does. It names the team, the thing being asked
 * about, and whose spend it is — the reader's, not the example's.
 */
export const ASK_LABEL = "Ask the team about your own spend";

/**
 * The context the label cannot carry: who is on the other end, and what they
 * do. Modelled on the footer's INVITATION, which answers the same two questions
 * outside the panel, where a visitor reads them before opening anything.
 */
export const ASK_INVITATION = "Those figures are the bundled example, not yours. Ask the Wawalu team "
  + "that operates Shiplog about your own spend, and a person replies by email.";

/**
 * Bring the panel to life. `request` is deferred to call time for the same
 * reason every other follow-up form defers it: a test that takes over
 * `globalThis.fetch` after the page mounts must still receive the submission.
 */
export function bindHomepageFollowUp(root = document, request = (...args) => globalThis.fetch(...args)) {
  return initFinopsContact(root, request, {
    prefix: PREFIX,
    captured: CAPTURED,
    alreadyCaptured: ALREADY_CAPTURED,
  });
}

if (globalThis.document) bindHomepageFollowUp();
