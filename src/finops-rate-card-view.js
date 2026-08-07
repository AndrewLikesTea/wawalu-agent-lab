// The rate-card ladder, painted into the answer region's own slots (#1262).
//
// THREE SLOTS, ALL AUTHORED ALREADY except the last, and no new control. The
// marker beside the figure and the hedge under it are the region's existing
// nodes; the full next action goes inside the "how we know this" disclosure the
// region already ships, in its Limits part, beside the confidence grade's own
// meaning. Nothing here mounts a disclosure, a live region or a focusable node:
// the answer region's tab order is the one it had.
//
// WHY THE MARKER IS SOURCED FROM THE LADDER. "Illustrative" was a literal in the
// markup. A word that says how far a figure may be trusted, kept by hand, is a
// word that survives the day the trust changes. It now comes from the same
// function the hedge and the next action do, so all three move together or not
// at all. The grade chip beside it — "Confidence: Low" — stays with
// finops-recoverable-confidence.js: that rubric grades the SPEND COVERAGE behind
// the figure, this one grades the RATES it is priced at, and one slot written by
// two rubrics is a slot that can disagree with itself.
//
// EVERY STRING IS WRITTEN AS TEXT. `textContent` only, never `innerHTML`, and
// every string is composed by finops-rate-card-contract.js from its own copy
// plus a model label. No value that originated in a reader's file reaches the
// DOM as anything but text.

import {
  BUNDLED_RATE_CARD_CONFIDENCE, rateCardHedge, rateCardMarker, rateCardNextStep,
} from "./finops-rate-card-contract.js";

/** The slots the answer region authors for the rate-card ladder. */
export const RATE_CARD_IDS = Object.freeze({
  marker: "finops-recoverable-marker",
  hedge: "finops-recoverable-confidence",
  nextStep: "finops-recoverable-contract-next",
});

/**
 * Paint the tier, the hedge and the one next action.
 *
 * Total, like the ladder it paints: a document missing a slot is left alone
 * rather than throwing through the boot of the first figure a reader meets. The
 * default verdict is the bundled one — the card this page's figure is actually
 * priced at — so a boot onto the served page rewrites the strings it already
 * carries. A recipient's shared brief rebuilds this disclosure from the sender's
 * envelope afterwards and legitimately drops this sentence: the reader's own
 * contract is not the question a colleague's brief answers.
 */
export function applyRateCardLadder(doc, verdict = BUNDLED_RATE_CARD_CONFIDENCE) {
  const marker = doc?.getElementById?.(RATE_CARD_IDS.marker) ?? null;
  const hedge = doc?.getElementById?.(RATE_CARD_IDS.hedge) ?? null;
  const nextStep = doc?.getElementById?.(RATE_CARD_IDS.nextStep) ?? null;
  if (marker) marker.textContent = rateCardMarker(verdict);
  if (hedge) hedge.textContent = rateCardHedge(verdict);
  if (nextStep) nextStep.textContent = rateCardNextStep(verdict);
  return nextStep;
}
