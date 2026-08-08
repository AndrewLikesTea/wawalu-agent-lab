// The home page's follow-up ask: the same form, in the opening section.
//
// A visitor convinced by the recoverable-spend figure in the hero used to have
// one way to raise their hand — the About Shiplog panel at the very bottom of a
// long page. The ask now sits beside the figure that earns it. It is not a
// second contact mechanism: the markup is the `hero-contact` id family in
// src/index.html, and src/finops-contact.js drives it exactly as it drives the
// AI FinOps result's panel and the executive briefing's, with the one CTA label
// ("Request a follow-up"), the one privacy sentence, the one transport, and the
// one receipt. The footer's panel is untouched and still ships on this page.
//
// What this file owns is the pair of sentences the live region reads out once a
// request lands. The default pair names the reader's own analysis, which the
// home page does not carry — nobody has imported anything here — so the pair
// below says the same thing about this surface instead.
import { initFinopsContact } from "./finops-contact.js";

/**
 * Who replies, and by when — the one commitment this ask makes.
 *
 * It is deliberately the commitment the AI FinOps form already makes, in the
 * team's own name rather than "someone here", because both requests reach the
 * same people under the same `follow_up` label. Two business days is what that
 * queue is watched to. Nothing here claims an SLA, a sales team, or a same-day
 * reply, and no page on this site promises one.
 *
 * It renders twice, word for word: src/index.html ships it as #hero-contact-reply,
 * which a visitor reads before typing, and both sentences below end on it, so the
 * confirmation repeats the promise rather than leaving a visitor to remember it.
 * tests/homepage-follow-up.test.js reads this constant and requires the shipped
 * markup and the confirmation to carry it exactly.
 */
export const REPLY_COMMITMENT = "A person from the Wawalu team that operates Shiplog replies by email "
  + "within two business days.";

// Both open on the words every follow-up confirmation on this site opens on: the
// live region announces them with no other context, so the first words have to
// say which request succeeded rather than merely that something was sent.
export const CAPTURED = "Follow-up requested — we sent your email address, and nothing else. "
  + REPLY_COMMITMENT;
export const ALREADY_CAPTURED = "Follow-up requested — that address is already on our list, so nothing "
  + `new was stored. ${REPLY_COMMITMENT}`;

/**
 * Wire the hero's panel. `request` is deferred to call time for the same reason
 * every other follow-up surface defers it: a test that takes over
 * `globalThis.fetch` after the page mounts must still receive the submission.
 */
export function initHomeFollowUp(root = document, request = (...args) => globalThis.fetch(...args)) {
  return initFinopsContact(root, request, {
    prefix: "hero-contact",
    captured: CAPTURED,
    alreadyCaptured: ALREADY_CAPTURED,
  });
}
