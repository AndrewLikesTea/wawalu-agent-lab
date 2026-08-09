// The recoverable figure's readiness, painted into the answer region's own slots.
//
// FOUR SLOTS, ALL AUTHORED ALREADY, and no new control. The marker beside the
// figure and the hedge under it are the region's existing nodes; the full next
// action and the readiness sentence go inside the "how we know this" disclosure
// the region already ships, in its Limits part. Nothing here mounts a
// disclosure, a live region or a focusable node: the answer region's tab order
// is the one it had.
//
// ONE TIER REACHES THE DOM, AND THIS IS WHERE THAT IS ENFORCED (#1480). Every
// string below comes from ONE call to `resolveRecoverableReadiness`, so the word
// beside the money and the word in the readiness line are the same string by
// construction rather than by agreement. This file does not import
// `rateCardMarker`, `rateCardHedge` or `rateCardNextStep` — the readiness
// contract calls those, takes the ladder's verdict as one input among two, and
// publishes the resolved tier. Re-hard-coding the chip therefore means editing
// this file to reintroduce an import it does not have, which
// tests/finops-recoverable-readiness-render.test.js fails on by name.
//
// WHY THE MARKER IS SOURCED FROM THE CONTRACT. "Illustrative" was a literal in
// the markup. A word that says how far a figure may be trusted, kept by hand, is
// a word that survives the day the trust changes. The grade chip beside it —
// "Confidence: Low" — stays with finops-recoverable-confidence.js: that rubric
// grades the SPEND COVERAGE behind the figure as evidence, this one resolves
// whether the figure may be quoted at all, and one slot written by two rubrics
// is a slot that can disagree with itself. The pricing-provenance chip and its
// sentence stay with finops-pricing-provenance.js for the same reason and carry
// no tier word: their vocabulary is Absent / Weak / Partial / Adequate / Strong.
//
// EVERY STRING IS WRITTEN AS TEXT. `textContent` only, never `innerHTML`, and
// every string is composed by the contract from its own copy plus counts and a
// model label. No value that originated in a reader's file reaches the DOM as
// anything but text.

import {
  finopsReadinessSignals, readinessSentence, resolveRecoverableReadiness,
} from "./finops-recoverable-readiness.js";

/** The slots the answer region authors for the readiness contract. */
export const RATE_CARD_IDS = Object.freeze({
  marker: "finops-recoverable-marker",
  hedge: "finops-recoverable-confidence",
  nextStep: "finops-recoverable-contract-next",
  readiness: "finops-recoverable-readiness",
});

/**
 * Paint the tier, the hedge, the one next action and the readiness sentence.
 *
 * Total, like the contract it paints: a document missing a slot is left alone
 * rather than throwing through the boot of the first figure a reader meets.
 *
 * @param doc the document to paint into.
 * @param verdict the rate-card ladder's verdict for the card this figure was
 *   priced at. Omitted, the contract falls back to the bundled one — the card
 *   this page's figure is actually priced at.
 * @param analysis the analysis whose coverage is being graded, or null. WITH NO
 *   ANALYSIS THE COVERAGE GATE IS NOT FAILED, IT IS NOT ASKED: the contract
 *   publishes the ladder's rung verbatim, which is what the build seeds the
 *   served document with, so a boot onto the served page rewrites the strings it
 *   already carries. A recipient's shared brief rebuilds this disclosure from the
 *   sender's envelope afterwards and legitimately drops these sentences: the
 *   reader's own contract is not the question a colleague's brief answers.
 */
export function applyRateCardLadder(doc, verdict = undefined, analysis = null) {
  const contract = readinessFor(verdict, analysis);
  const write = (id, value) => {
    const node = doc?.getElementById?.(id) ?? null;
    if (node) node.textContent = value;
    return node;
  };
  write(RATE_CARD_IDS.marker, contract.marker);
  write(RATE_CARD_IDS.hedge, contract.hedge);
  write(RATE_CARD_IDS.readiness, readinessSentence(contract));
  return write(RATE_CARD_IDS.nextStep, contract.nextAction);
}

/**
 * The resolved contract for a verdict and an optional analysis. Exported so the
 * build seed and the tests read the same resolution the paint does, rather than
 * a second one written beside it.
 */
export function readinessFor(verdict = undefined, analysis = null) {
  const signals = finopsReadinessSignals(analysis);
  return resolveRecoverableReadiness(signals
    ? { ...signals, verdict: verdict ?? signals.verdict } : { verdict });
}
