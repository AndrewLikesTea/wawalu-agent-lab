// The pricing-provenance sub-score, painted into the answer region's own slots.
//
// THREE SLOTS AND NO MORE, and the split between them is the point (#1266):
//
//   * THE SUB-SCORE IS BESIDE THE MONEY, outside every disclosure. A grade folded
//     into a shut disclosure is a grade nobody is told, and the test harness reads
//     text through a shut disclosure, so no assertion here would notice.
//   * THE ONE-SENTENCE REASON IS BESIDE IT, also outside, because a number an
//     executive cannot explain is the thing this module exists to prevent.
//   * THE FOUR BANDS ARE ONE PRESS AWAY, in the Limits part of the "how we know
//     this" disclosure the region already ships (#1185) — the same one the
//     confidence grade explains itself in. No second disclosure, no new dt row,
//     no focusable node: the answer region's tab order is the one it had.
//
// EVERY STRING IS WRITTEN AS TEXT. `textContent` only, never `innerHTML`, and the
// strings come from finops-pricing-provenance.js, which composes them from its own
// copy plus counts and a sanitized citation. A destination name or a source label
// that originated in a reader's file therefore reaches the DOM as redacted text or
// not at all.

import {
  BUNDLED_PRICING_PROVENANCE, pricingProvenanceChip, pricingProvenanceDetail,
  pricingProvenanceSummary,
} from "./finops-pricing-provenance.js";

/** The three slots the answer region authors for this sub-score. */
export const PRICING_PROVENANCE_IDS = Object.freeze({
  score: "finops-recoverable-provenance",
  reason: "finops-recoverable-provenance-reason",
  detail: "finops-recoverable-provenance-detail",
});

/**
 * Paint the sub-score, its one sentence, and the four bands.
 *
 * Total, like the rubric it paints: a document missing a slot is left alone rather
 * than throwing through the boot of the first figure a reader meets. The default
 * verdict is the bundled one — the same object the build seeds the served document
 * from — so a boot onto the served page rewrites the three strings it already
 * carries rather than changing them.
 */
export function applyPricingProvenance(doc, verdict = BUNDLED_PRICING_PROVENANCE) {
  const score = doc?.getElementById?.(PRICING_PROVENANCE_IDS.score) ?? null;
  const reason = doc?.getElementById?.(PRICING_PROVENANCE_IDS.reason) ?? null;
  const detail = doc?.getElementById?.(PRICING_PROVENANCE_IDS.detail) ?? null;
  if (score) {
    score.textContent = pricingProvenanceChip(verdict);
    // The band as data, so a stylesheet or a printed page can read the rating
    // without parsing the sentence. The word is in the text either way.
    score.dataset.band = verdict?.confidence?.key ?? "insufficient";
  }
  if (reason) reason.textContent = pricingProvenanceSummary(verdict);
  if (detail) detail.textContent = pricingProvenanceDetail(verdict);
  return score;
}
