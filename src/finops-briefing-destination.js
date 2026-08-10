// Where the forwardable briefing points, and whether the number it carries is
// still the number the page states (#1525).
//
// TWO JOBS, AND THEY ARE THE SAME JOB.
//
//   1. The briefing's hand-off address. It is built by asking
//      `finops-destination-router.js` to serialize a destination, never by
//      writing a fragment here. A briefing that hard-coded `#finops-answer`
//      would keep pointing at a mid-page anchor on the day routing moved, and
//      the reader who followed it would land somewhere the figure is not.
//
//   2. The one recomputation of the briefed figure, its confidence and its
//      grade, plus the reporter that says which surface disagrees. A briefing
//      is a number a director forwards to somebody who cannot see the page it
//      came from, so "the briefing, the answer screen and the evidence all say
//      one thing" has to be checkable rather than assumed.
//
// NO TOLERANCE, ON PURPOSE. Every surface compared here formats from ONE
// record — `getRecoverableSpend` for the figure and its confidence,
// `gradeRecoverableConfidence` for the grade — so two surfaces that disagree by
// any amount at all disagree because a code path stopped reading that record,
// not because two roundings drifted apart. A tolerance would therefore hide the
// only failure this comparison exists to catch, so the comparison is exact
// string equality and there is no numeric threshold in this file to explain.
//
// DATA ONLY. No DOM, no storage, no network, no clock, no prompt text: the
// inputs are the analysis record the page already holds, and nothing a reader
// typed reaches this module.

import { getRecoverableSpend } from "./finops-answer-contract.js";
import { gradeRecoverableConfidence } from "./finops-recoverable-confidence.js";
import { serializeScreenRoute } from "./finops-destination-router.js";

/** The page the destinations live on. The router owns everything after it. */
export const ANALYSIS_PATH = "/evolution.html";

/**
 * The two destinations a briefing names, as router slugs.
 *
 * `answer` is where the briefed figure is STATED — the recoverable headline, its
 * grade and the one next action. `evidence` is where it is CHECKABLE — the
 * working, the coverage and the graded sample. A briefing hands a reader the
 * first and offers the second; it never points at a region id.
 */
export const BRIEFED_FIGURE_DESTINATION = "answer";
export const BRIEFED_EVIDENCE_DESTINATION = "evidence";

/**
 * The address one destination opens at.
 *
 * `serializeScreenRoute` is the only thing that knows the fragment, and it
 * validates the slug on the way through: an unknown slug resolves to the
 * router's fallback rather than producing an address that opens nothing.
 */
export function briefingDestinationHref(slug = BRIEFED_FIGURE_DESTINATION) {
  return `${ANALYSIS_PATH}${serializeScreenRoute({ slug })}`;
}

/** The absolute form, for a link that leaves this tab. Falls back to the path. */
export function briefingDestinationUrl(slug = BRIEFED_FIGURE_DESTINATION, origin = null) {
  try {
    return new URL(briefingDestinationHref(slug), origin ?? undefined).href;
  } catch {
    return briefingDestinationHref(slug);
  }
}

/**
 * Recompute the briefed figure, its confidence and its grade from recorded
 * inputs.
 *
 * @param dataset the analysis envelope the page already holds.
 * @param gradability a `gradeExport()` verdict, or null — which
 *   `gradeRecoverableConfidence` reads as "this rubric got no measurement",
 *   returning `low` with the reason rather than throwing.
 * @returns frozen. `figure` and `confidence` are the display strings the page
 *   paints, not raw numbers, because what has to agree across surfaces is what a
 *   reader reads.
 */
export function briefedFigure(dataset, gradability = null) {
  const recoverable = getRecoverableSpend(dataset);
  const verdict = gradeRecoverableConfidence(gradability);
  return Object.freeze({
    figure: recoverable.monthlyDisplay,
    // The confidence the figure is stated AT, as every surface carries it: the
    // scored coverage. "3 of 4" is the qualifier a director disputes first, and
    // it is the one confidence fact the answer slots, the briefing text and the
    // attestation all three publish, so it is what agreement is checked on.
    confidence: `${recoverable.scoredDepartments} of ${recoverable.totalDepartments}`,
    // The LEVEL the analysis published, kept beside it. Null when it published
    // none — which is a state, not a zero.
    level: recoverable.confidence.level,
    grade: verdict.grade,
    href: briefingDestinationHref(BRIEFED_FIGURE_DESTINATION),
    evidenceHref: briefingDestinationHref(BRIEFED_EVIDENCE_DESTINATION),
    recoverable,
    verdict,
  });
}

/** The three fields every surface must state identically. */
export const BRIEFED_FIELDS = Object.freeze(["figure", "confidence", "grade"]);

/**
 * The one comparison routine. Both the reproducibility fixture and the drift
 * test call this, so neither can quietly hold a different idea of "agree".
 *
 * @param expected a `briefedFigure()` record, or any object carrying the three
 *   fields.
 * @param surfaces `{ [surfaceName]: { figure, confidence, grade } }`.
 * @returns frozen `{ agree, drifted, mismatches, statement }`. `drifted` NAMES
 *   the surfaces that disagreed, in the order they were handed in, because a
 *   failure that says only "they differ" leaves a director to find out which
 *   number to stop quoting.
 */
export function compareBriefedFigure(expected, surfaces = {}) {
  const mismatches = [];
  for (const [surface, stated] of Object.entries(surfaces)) {
    for (const field of BRIEFED_FIELDS) {
      const want = expected?.[field] ?? null;
      const got = stated?.[field] ?? null;
      // Exact equality. See the header: one record formats all three surfaces,
      // so any difference is a broken read and never a rounding difference.
      if (want !== got) mismatches.push(Object.freeze({ surface, field, expected: want, actual: got }));
    }
  }
  const drifted = [...new Set(mismatches.map((entry) => entry.surface))];
  return Object.freeze({
    agree: mismatches.length === 0,
    drifted: Object.freeze(drifted),
    mismatches: Object.freeze(mismatches),
    statement: mismatches.length === 0
      ? "The briefing, the answer destination and the evidence destination state one figure."
      : mismatches
        .map((entry) => `${entry.surface} states ${entry.field} ${String(entry.actual)}, `
          + `the recorded inputs give ${String(entry.expected)}`)
        .join(" "),
  });
}
