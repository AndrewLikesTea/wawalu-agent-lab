// The confidence grade, painted into the answer region's two slots.
//
// TWO SLOTS AND NO MORE. The grade itself goes beside the figure, outside every
// disclosure, because it is a headline fact: a grade folded into a shut
// disclosure is a grade nobody is told, and the harness reads text through a shut
// disclosure so no test here would notice. The explanation goes inside the
// "how we know this" disclosure the region already ships (#1185) — the same one,
// in its Limits part; this adds no second disclosure and no new dt.
//
// EVERY STRING IS WRITTEN AS TEXT. `textContent` only, never `innerHTML`, and the
// strings come from finops-recoverable-confidence.js, which composes them from
// its own copy plus formatted numbers. A department name or any other value that
// originated in a reader's file therefore reaches the DOM as text or not at all.

import {
  BUNDLED_RECOVERABLE_CONFIDENCE, confidenceChip, confidenceExplanation,
} from "./finops-recoverable-confidence.js";

/** The two slots the answer region authors for this grade. */
export const RECOVERABLE_CONFIDENCE_IDS = Object.freeze({
  grade: "finops-recoverable-grade",
  detail: "finops-recoverable-confidence-detail",
});

/**
 * Paint the grade and its explanation.
 *
 * Total, like the grading function it paints: a document missing either slot is
 * left alone rather than throwing through the boot of the first figure a reader
 * meets. The default verdict is the bundled one — the same object the build seeds
 * the served document from — so a boot onto the served page rewrites the same
 * two strings it already carries.
 */
export function applyRecoverableConfidence(doc, verdict = BUNDLED_RECOVERABLE_CONFIDENCE) {
  const grade = doc?.getElementById?.(RECOVERABLE_CONFIDENCE_IDS.grade) ?? null;
  const detail = doc?.getElementById?.(RECOVERABLE_CONFIDENCE_IDS.detail) ?? null;
  if (grade) {
    grade.textContent = confidenceChip(verdict);
    grade.dataset.grade = verdict?.grade ?? "low";
  }
  if (detail) detail.textContent = confidenceExplanation(verdict);
  return grade;
}
