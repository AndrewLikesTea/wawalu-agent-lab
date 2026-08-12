// The hand-raise under the home page's executive takeaway.
//
// A visitor who has just read the takeaway — a recoverable figure, a first
// action, an accountable role, all of it computed from a bundled synthetic
// example — has one obvious next question, and it is about their own spend.
// Until now the only place on this page to ask it was the site footer, eight
// screens down and named after nothing they had been reading. So the takeaway
// block offers the ask where the question forms: beside "Copy executive
// takeaway", named for what it starts rather than for the form it opens.
//
// Three rules, and the third is the whole design:
//
//   1. It is a disclosure, not a destination. The form opens inline, in the
//      same block, so nobody loses the takeaway to ask about it. Nothing here
//      navigates, and nothing overlays what a reader was reading.
//   2. It is not a second implementation. The panel, the transport, the
//      validation, the failure copy, the retry and the receipt are the ones
//      `initFinopsContact` already drives for the AI FinOps result and the
//      executive briefing, which are in turn the site footer's — one answer to
//      "was this captured?", on every surface that asks.
//   3. It promises nothing this page cannot keep. The FinOps queue commits to
//      two business days because someone watches it; this control sits on the
//      home page of a demonstration product, so it makes the site footer's
//      promise instead — the address is recorded, a person is the one who reads
//      it, and no machine is about to reply. tests/homepage-follow-up.test.js
//      drives both panels on this page and requires the two sentences to match,
//      so the pair cannot drift apart without failing the build.
//
// This module is deliberately outside src/site-footer-page.js's import graph
// and imports nothing from it: that graph is what every page of the site sends
// before a reader interacts with anything, and it is measured. Reuse here runs
// the other way — the home page imports the shared panel, the footer's initial
// payload is untouched, and the footer's own form keeps working exactly as it
// did, on this page and on every other.

import { initFinopsContact } from "./finops-contact.js";

/**
 * The name on the control, and the reason there is a control at all.
 *
 * Every button that opens or submits a follow-up form reads "Request a
 * follow-up" — see tests/follow-up-cta-label.test.js — and this one is not one
 * of those. It is the invitation that precedes them: it names the errand in the
 * reader's terms, their own spend, rather than the mechanism. Pressing it
 * reveals the form, whose submit control carries the site's one label.
 */
export const HAND_RAISE_LABEL = "Ask the team about your own spend";

/**
 * What a visitor is told once the address is stored, word for word from the
 * site footer's panel.
 *
 * Not an SLA, and not the FinOps queue's two business days. This is the home
 * page of a demonstration product; what is actually true is that the address is
 * recorded, that a person reads it, and that nothing here answers on its own.
 */
export const CAPTURED = "Follow-up requested — we sent your email address, and nothing else. It is recorded "
  + "for the Wawalu team, and a person replies by email; nothing here answers automatically.";
export const ALREADY_CAPTURED = "Follow-up requested — that address is already on our list, so nothing new "
  + "was recorded. The Wawalu team can reach you there.";

/** The id family the markup in src/index.html ships. */
export const PREFIX = "homepage-followup";

/**
 * Bring the takeaway's hand-raise to life.
 *
 * `request` is deferred to call time for the reason every panel on this site
 * defers it: a test that takes over the transport after the page mounts must
 * still be the one that receives the submission.
 */
export function initHomepageFollowUp(root = document, request = (...args) => globalThis.fetch(...args)) {
  return initFinopsContact(root, request, {
    prefix: PREFIX,
    copy: { captured: CAPTURED, alreadyCaptured: ALREADY_CAPTURED },
  });
}

if (globalThis.document) initHomepageFollowUp();
