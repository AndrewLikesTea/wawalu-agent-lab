// The specimen: every state of the coaching result, drawn from one shared
// sample, before any of it is wired to the entry flow.
//
// WHY A SPECIMEN AND NOT A SCREENSHOT. The states that break a surface are the
// ones nobody demos: the empty box, the refusal, the wait, and the figure that
// arrived wrong. A screenshot of the good state is an assertion about the
// designer's afternoon; this list is the states themselves, computed from the
// bundled samples at render time, so a state that stopped rendering fails on
// the page and in a test rather than aging quietly in a design file.
//
// DETERMINISM. Every case is built from `buildSampleCoachingSession`, which is
// pure over hand-authored bundled text. No clock, no randomness, no reader
// input: two people reviewing this specimen are looking at the same pixels.
//
// PRIVACY. A case carries a presentation model, and a presentation model
// carries measurements and static copy only. The sample text itself is not
// rendered here — the contract preview above already shows it once, in the one
// place a reader is deciding what gets read — and no reader's text ever reaches
// this module: nothing here reads the field.

import { COACHING_SAMPLES, buildSampleCoachingSession } from "./prompt-coaching-contract.js";
import { PRESENTATION_STATUS, presentCoachingResult } from "./coaching-result-presentation.js";

/**
 * A session with four figures pushed outside their range.
 *
 * WHY THIS IS NOT REACHABLE FROM THE ENGINE, AND IS DRAWN ANYWAY. The rubric
 * clamps its dimensions and the contract tests pin the shape, so nothing in
 * this build produces a composite of 4,200. The presentation is a primitive,
 * though: it will be handed sessions by callers this repository has not written
 * yet, and the state to design for is not "a number is wrong" — it is "a number
 * is wrong and the surface printed it in 52px anyway". Drawing the extreme is
 * how the withheld grade gets reviewed before anyone needs it.
 *
 * Derived rather than hand-written so it stays one edit away from the real
 * session shape: every field not named here is the sample's own.
 */
export function outOfRangeSession(session) {
  const benchmark = session.result.benchmark;
  return Object.freeze({
    ...session,
    input: Object.freeze({ ...session.input, scoredTurns: (session.input.turns ?? 0) + 3 }),
    result: Object.freeze({
      ...session.result,
      benchmark: Object.freeze({
        ...benchmark,
        score: 4200,
        scoreText: "4,200 / 100",
        next: benchmark.next
          ? Object.freeze({ ...benchmark.next, pointsAway: -12 })
          : null,
      }),
      improvement: Object.freeze({ ...session.result.improvement, points: 640 }),
      observed: Object.freeze({
        ...session.result.observed,
        scoredTurns: (session.result.observed.scoredTurns ?? 0) + 3,
      }),
    }),
  });
}

/**
 * The cases, in the order a reviewer should read them: the state that answers
 * the question, the state at the top of the scale, then every state that does
 * not answer it, then the two nobody demos.
 *
 * `sample` names a bundled sample from the contract; `purpose` is what a
 * reviewer is being asked to look at, which is the whole point of a specimen.
 */
export const SPECIMEN_CASES = Object.freeze([
  Object.freeze({
    id: "graded",
    sample: "underspecified-request",
    label: "Graded — an underspecified request",
    purpose: "A typical result: the answer, its score, and the first change to make.",
  }),
  Object.freeze({
    id: "graded-strong",
    sample: "well-formed-request",
    label: "Graded — a request that states its context",
    purpose: "A strong prompt with no higher grade band to reach.",
  }),
  Object.freeze({
    id: "loading",
    sample: null,
    status: PRESENTATION_STATUS.loading,
    label: "Grading",
    purpose: "What you see while the coach grades a prompt.",
  }),
  Object.freeze({
    id: "empty",
    sample: "empty-box",
    label: "Nothing to grade — an empty box",
    purpose: "There is no text to grade. Paste a prompt to continue.",
  }),
  Object.freeze({
    id: "invalid",
    sample: "long-transcript",
    label: "Not accepted — a whole transcript",
    purpose: "The conversation is too long. The result shows how much to remove before grading again.",
  }),
  Object.freeze({
    id: "unsupported",
    sample: "pasted-log-only",
    label: "Nothing the rubric can read — a pasted log",
    purpose: "The text contains no request the coach can grade. Add a clear instruction and try again.",
  }),
  Object.freeze({
    id: "implausible",
    sample: "underspecified-request",
    extreme: true,
    label: "Implausible figures — a session that arrived out of range",
    purpose: "One or more figures are outside the grading scale, so no letter grade is shown.",
  }),
]);

for (const specimen of SPECIMEN_CASES) {
  if (specimen.sample && !COACHING_SAMPLES.some((sample) => sample.id === specimen.sample)) {
    throw new RangeError(`coaching specimen: no bundled sample "${specimen.sample}"`);
  }
}

/**
 * Build every case.
 *
 * @returns {ReadonlyArray<{id, label, purpose, status, model}>} frozen, in
 *   reading order. The status on each case is the one the model actually
 *   produced, not the one the case was filed under: a sample that stopped
 *   producing its state shows up in the specimen rather than only in a test.
 */
export function buildCoachingSpecimen() {
  return Object.freeze(SPECIMEN_CASES.map((specimen) => {
    const built = specimen.sample ? buildSampleCoachingSession(specimen.sample) : null;
    const session = built && specimen.extreme ? outOfRangeSession(built) : built;
    const model = presentCoachingResult({ status: specimen.status, session });
    return Object.freeze({
      id: specimen.id,
      label: specimen.label,
      purpose: specimen.purpose,
      status: model.status,
      model,
    });
  }));
}
