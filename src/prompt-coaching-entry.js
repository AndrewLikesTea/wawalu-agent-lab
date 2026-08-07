// The front door: the journey contract a visitor arrives on, as data.
//
// WHAT DECISION THIS OWNS. `prompt-coaching-contract.js` answers "what does one
// coached submission contain?". This module answers the question asked one step
// earlier, by someone who has not typed anything yet and may not: "what is this
// page for, what do I get out of it right now, what does it cost me, and what
// do I do first?" That is a product decision, so it is written down here as a
// contract the destination surface consumes — not as prose in a document, which
// nothing renders and no test can hold to account.
//
// WHY IT IS DATA AND NOT COPY. Every claim below is either read straight from
// the modules the workflow runs on (the rubric's own bands, the session
// contract's boundary) or paired with the property that makes it checkable.
// A front-door promise that drifted from the workflow would have to drift in
// the module the workflow itself imports, and the tests fail there first.
//
// WHAT IT DELIBERATELY LEAVES OUT. No second answer, no marketing surface, no
// tour. The front door earns exactly one thing: the visitor's first graded
// prompt. Anything that does not move them toward that is out of scope, which
// is why this contract names exactly ONE prioritized next action per state
// rather than a menu of things a visitor could do.

import { COACHING_QUESTION } from "./prompt-coaching.js";
import { PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";
import { PROMPT_GRADING_THRESHOLDS } from "./prompt-grading-eligibility.js";
import {
  COACHING_INPUT_SOURCE, COACHING_LOCAL_ONLY_BOUNDARY, COACHING_OUTCOME,
  PREVIEW_SAMPLE_ID, buildSampleCoachingSession, coachingSample,
} from "./prompt-coaching-contract.js";

/** Bump when a state, an action, a success definition, or a claim changes. */
export const COACHING_ENTRY_VERSION = "prompt-coaching-entry/1.0.0";

export const ENTRY_JOURNEY_FIELDS = Object.freeze([
  "schemaVersion", "question", "value", "benchmark", "example", "states",
  "successStates", "exclusions",
]);

// ---------------------------------------------------------------------------
// 1. The question the front door answers
// ---------------------------------------------------------------------------

/**
 * Whose question this is, and what an answer to it looks like.
 *
 * `answeredBy` is the grading workflow's own question string rather than a
 * paraphrase of it: the front door promises the answer the workflow actually
 * returns, and if that question is ever reworded this promise moves with it.
 */
export const COACHING_ENTRY_QUESTION = Object.freeze({
  asks: "Is the prompt I am about to send worth sending — and can I find that out here without handing anything over?",
  askedBy: "a visitor or a team lead arriving with no account, no import, and no file: the state every first visit is in.",
  answeredBy: COACHING_QUESTION,
  answeredWith: "one graded text, in this tab, on this visit.",
  notAnswered: "whether a team, a department, or an organization prompts well. That is a different question with a different floor, and this workflow refuses to answer it from one text.",
});

// ---------------------------------------------------------------------------
// 2. What the visitor gets, immediately, for what price
// ---------------------------------------------------------------------------

/**
 * The value proposition, stated in the only terms that can be checked: what
 * arrives, when, computed by what, and what it costs the visitor to obtain.
 */
export const COACHING_ENTRY_VALUE = Object.freeze({
  headline: "A grade for one prompt, and the single change worth making first.",
  arrivesWhen: "you press Grade this prompt. The answer comes back in the same page view — there is nothing to wait for and no queue.",
  computedBy: "a rubric bundled with this page, run in this browser tab.",
  costsVisitor: "nothing: no sign-in, no email address, no file, no upload, no payment, and no wait.",
  keeps: "nothing. Your text is measured and left in the field you typed it into — there is no store to write it to.",
  privateBecause: "the text never leaves the tab, so a visitor can grade a prompt that mentions their own systems without disclosing it to this site or anyone else.",
});

// ---------------------------------------------------------------------------
// 3. The benchmark the answer is measured against
// ---------------------------------------------------------------------------

/**
 * The material benchmark, defined precisely enough that two engineers compute
 * the same number from the same text.
 *
 * `metric`      — `result.benchmark.score`, the bundled rubric's composite for
 *                 the graded text.
 * `scale`       — integers 0–100, the rubric's published scale.
 * `computedAs`  — the composite is the axis subscores combined at the axis
 *                 weights the rubric publishes; the decomposition a reader can
 *                 re-add is printed in `result.detail.axes` as
 *                 `{ key, weightPercent, score }`.
 * `bands`       — the rubric's own grade cutoffs, read high to low with `>=`.
 * `material`    — a score movement counts as material ONLY when the letter band
 *                 changes. Points inside one band are movement, not a result:
 *                 the bands are ten points wide precisely so a small drift does
 *                 not change what an executive reads. This is the same rule the
 *                 revision surface publishes as `data-material`, stated once
 *                 here so the front door cannot promise a different one.
 * `ceiling`     — what this figure may never be used for, with the floor that
 *                 would be needed instead.
 */
export const COACHING_ENTRY_BENCHMARK = Object.freeze({
  metric: "result.benchmark.score",
  label: "Composite prompt score",
  scale: Object.freeze({
    minimum: PROMPT_LITERACY_RUBRIC.scale.minimum,
    maximum: PROMPT_LITERACY_RUBRIC.scale.maximum,
    unit: "whole points",
  }),
  rubricId: `${PROMPT_LITERACY_RUBRIC.rubricId}/${PROMPT_LITERACY_RUBRIC.rubricVersion}`,
  computedAs: "the rubric's axis subscores combined at the published axis weights, on one 0–100 scale. The axes, their weightPercent, and their subscores are printed with every graded result, so the composite can be re-added by hand.",
  bands: Object.freeze(PROMPT_LITERACY_RUBRIC.grades.map((grade) => Object.freeze({
    letter: grade.letter,
    minimumScore: grade.minimumScore,
  }))),
  bandRule: PROMPT_LITERACY_RUBRIC.gradeRule,
  material: Object.freeze({
    rule: "A score change is material only when the letter band moves.",
    notMaterial: "A change of any size inside one band. It is reported as points moved and never as a better or worse result.",
    why: "The bands are ten points wide so month-to-month drift does not change the letter a leader reads. A front door that called a two-point rise an improvement would be selling movement as progress.",
  }),
  ceiling: Object.freeze({
    claim: "This score describes one text, graded in this tab.",
    refuses: "an organization's, a department's, or a person's prompt quality.",
    floorInstead: `${PROMPT_GRADING_THRESHOLDS.minPromptsPerDepartment} classified prompts in a department before that department is graded at all.`,
  }),
});

// ---------------------------------------------------------------------------
// 4. The supplied example: the zero-input path
// ---------------------------------------------------------------------------

const EXAMPLE_SAMPLE = coachingSample(PREVIEW_SAMPLE_ID);
if (!EXAMPLE_SAMPLE) {
  throw new RangeError(`prompt coaching entry: no bundled sample "${PREVIEW_SAMPLE_ID}"`);
}

/**
 * The example a visitor can grade with zero input.
 *
 * WHY A SUPPLIED EXAMPLE EXISTS AT ALL. The front door's whole job is the first
 * graded prompt, and the most common reason a visitor never gets one is that
 * they have nothing to paste at the moment they arrive. One press removes that
 * blocker without asking them to invent a prompt on the spot.
 *
 * WHY IT IS EXPLICITLY NOT THE VISITOR'S TEXT. A grade of our own example is a
 * demonstration, not a reading of anything the visitor wrote, and a front door
 * that let those two blur would be claiming to have graded work it never saw.
 * The distinction is carried in data, not in a caption: an example submission
 * is classified `bundled_sample` in `session.input.source` and a visitor's text
 * is `reader_text`, so any consumer — the page, a test, a reviewer reading a
 * session — can tell which one produced a figure.
 *
 * DETERMINISM. The text and tier are bundled constants, so the example grades
 * to the same score on every machine and every visit. Nothing here is sampled,
 * shuffled, timed, or generated.
 */
export const COACHING_ENTRY_EXAMPLE = Object.freeze({
  id: "supplied-example",
  sampleId: EXAMPLE_SAMPLE.id,
  source: COACHING_INPUT_SOURCE.bundledSample,
  label: `Bundled synthetic example — ${EXAMPLE_SAMPLE.label.toLowerCase()}`,
  text: EXAMPLE_SAMPLE.text,
  modelTier: EXAMPLE_SAMPLE.modelTier,
  /** Applying the example sets the field AND the tier: a partial submission would grade something the example does not describe. */
  appliesModelTier: true,
  attribution: "The example supplied by this page: bundled synthetic text — not your prompt, not a customer's, and not anyone's real prompt.",
  distinct: Object.freeze({
    classifiedAs: COACHING_INPUT_SOURCE.bundledSample,
    visitorTextClassifiedAs: COACHING_INPUT_SOURCE.readerText,
    rule: "A submission is classified bundled_sample only while the field still holds the bundled synthetic example unedited. Any keystroke in the field makes the next submission reader_text.",
    why: "A figure produced from our example must never be readable as a grade of the visitor's own work.",
  }),
  privacy: Object.freeze({
    reads: "nothing of yours. The example is written into the field from bundled text in this tab.",
    sends: "nothing. Grading the example is the same local computation as grading your own text.",
    keeps: "nothing, and it holds no more of a record than a grade of your own text does — which is none.",
  }),
  transition: Object.freeze({
    onEdit: "Editing or replacing the text in the field ends the bundled synthetic example: the next grade is classified as your text, and the example attribution comes off the result.",
    onClear: "Clear and start over empties the field and returns the front door to its zero-input state, where the bundled synthetic example is offered again.",
    editControl: "prompt-coaching-input",
    loadControl: "prompt-coaching-example",
  }),
});

/**
 * The classification, said out loud beside a result. A grade of our example is
 * announced as a demonstration; a grade of the visitor's text is announced as
 * theirs. Total over `COACHING_INPUT_SOURCE`, asserted at load.
 */
export const COACHING_INPUT_SOURCE_LABELS = Object.freeze({
  [COACHING_INPUT_SOURCE.bundledSample]: "This grade is of the bundled synthetic example, not of your text. Replace it in the field to grade your own prompt.",
  [COACHING_INPUT_SOURCE.readerText]: "This grade is of your text, read in this tab and kept nowhere.",
});

for (const source of Object.values(COACHING_INPUT_SOURCE)) {
  if (!COACHING_INPUT_SOURCE_LABELS[source]) {
    throw new RangeError(`prompt coaching entry: source "${source}" has no attribution`);
  }
}

/** The example's session — deterministic, and built by the same function a visitor's grade uses. */
export function buildEntryExampleSession() {
  return buildSampleCoachingSession(COACHING_ENTRY_EXAMPLE.sampleId);
}

// ---------------------------------------------------------------------------
// 5. The states, and the ONE next action in each
// ---------------------------------------------------------------------------

export const COACHING_ENTRY_STATE = Object.freeze({
  empty: "empty",
  exampleLoaded: "example_loaded",
  visitorText: "visitor_text",
  answered: "answered",
});

/**
 * Exactly one prioritized action per state. Not a list per state — a list is a
 * decision handed back to the visitor, and the front door exists to make it.
 *
 * `control` is the id of the element that performs the action, so the guidance
 * and the thing a reader presses cannot drift apart.
 */
export const COACHING_ENTRY_NEXT_ACTION = Object.freeze({
  [COACHING_ENTRY_STATE.empty]: Object.freeze({
    id: "try_example",
    label: "Grade the bundled synthetic example",
    instruction: "Nothing to paste? Grade the example instead — one press, no typing, and the result is a demonstration rather than a reading of your work.",
    control: COACHING_ENTRY_EXAMPLE.transition.loadControl,
    alternative: "Or paste your own prompt into the field below.",
  }),
  [COACHING_ENTRY_STATE.exampleLoaded]: Object.freeze({
    id: "grade_example",
    label: "Grade this prompt",
    instruction: "The bundled synthetic example is in the field. Press Grade this prompt to see what a result contains.",
    control: "prompt-coaching-grade",
    alternative: "Or edit the field to replace it with your own prompt — the next grade is then yours, not the bundled synthetic example's.",
  }),
  [COACHING_ENTRY_STATE.visitorText]: Object.freeze({
    id: "grade_own",
    label: "Grade this prompt",
    instruction: "Your text is in the field. Press Grade this prompt: the answer, the score, and one change come back in this tab.",
    control: "prompt-coaching-grade",
    alternative: null,
  }),
  [COACHING_ENTRY_STATE.answered]: Object.freeze({
    id: "apply_one_change",
    label: "Apply the one change, then grade again",
    instruction: "The result names one change and what it is worth. Make it in the field, then press Grade this prompt again to see whether the band moved.",
    control: COACHING_ENTRY_EXAMPLE.transition.editControl,
    alternative: null,
  }),
});

for (const state of Object.values(COACHING_ENTRY_STATE)) {
  if (!COACHING_ENTRY_NEXT_ACTION[state]) {
    throw new RangeError(`prompt coaching entry: state "${state}" has no next action`);
  }
}

/**
 * The state of the front door, computed rather than tracked in two places.
 *
 * @param {{fieldText?: unknown, fromExample?: boolean, graded?: boolean}} view
 *   `fieldText` is the raw value of the field; `fromExample` is true only while
 *   that value is the supplied example unedited; `graded` is true only while a
 *   result for the current field contents is on screen.
 */
export function coachingEntryState({ fieldText = "", fromExample = false, graded = false } = {}) {
  if (graded) return COACHING_ENTRY_STATE.answered;
  if (typeof fieldText !== "string" || !fieldText.trim()) return COACHING_ENTRY_STATE.empty;
  return fromExample ? COACHING_ENTRY_STATE.exampleLoaded : COACHING_ENTRY_STATE.visitorText;
}

export function coachingEntryNextAction(state) {
  const action = COACHING_ENTRY_NEXT_ACTION[state];
  if (!action) throw new RangeError(`prompt coaching entry: no next action for "${state}"`);
  return action;
}

// ---------------------------------------------------------------------------
// 6. Success, defined so it can be counted the same way twice
// ---------------------------------------------------------------------------

/**
 * What "the front door worked" means. Each entry's `measure` is a predicate
 * over one built session, evaluated by `coachingEntrySuccess` below, so the
 * definition and the computation are the same thing rather than two things
 * that agree today.
 *
 * There is no engagement measure here on purpose: nothing is recorded, so a
 * definition of success this workflow cannot compute from a session in hand
 * would be a metric nobody can produce.
 */
export const COACHING_ENTRY_SUCCESS_STATES = Object.freeze([
  Object.freeze({
    id: "demonstrated",
    statement: "The visitor saw a real result without typing anything.",
    measure: "session.outcome === \"graded\" && session.input.source === \"bundled_sample\"",
    isNot: "the destination. It is the step that makes the destination legible.",
  }),
  Object.freeze({
    id: "own_prompt_graded",
    statement: "The visitor graded their own text and has an answer, a score, and one change to make.",
    measure: "session.outcome === \"graded\" && session.input.source === \"reader_text\"",
    isNot: "a claim about their team: one text is one text.",
  }),
  Object.freeze({
    id: "refused_with_a_way_out",
    statement: "The submission could not be graded and the visitor was told which ceiling or gap caused it and what to do next.",
    measure: "session.outcome !== \"graded\" && typeof session.result.recovery.title === \"string\"",
    isNot: "a failure of the front door. An unexplained refusal would be.",
  }),
]);

/** Which success states one session satisfies. Total, deterministic, and pure. */
export function coachingEntrySuccess(session) {
  const graded = session?.outcome === COACHING_OUTCOME.graded;
  const source = session?.input?.source ?? null;
  const satisfied = [];
  if (graded && source === COACHING_INPUT_SOURCE.bundledSample) satisfied.push("demonstrated");
  if (graded && source === COACHING_INPUT_SOURCE.readerText) satisfied.push("own_prompt_graded");
  if (!graded && typeof session?.result?.recovery?.title === "string") {
    satisfied.push("refused_with_a_way_out");
  }
  return Object.freeze(satisfied);
}

// ---------------------------------------------------------------------------
// 7. What the front door explicitly does not reach
// ---------------------------------------------------------------------------

/**
 * The exclusions a visitor needs before they paste anything, each paired with
 * the property that makes it checkable. `boundaryId` links an exclusion to the
 * session contract's own boundary entry, so a claim made at the door is the
 * same claim the workflow enforces rather than a second, looser one.
 */
export const COACHING_ENTRY_EXCLUSIONS = Object.freeze([
  Object.freeze({
    id: "live_provider",
    label: "Live model providers",
    claim: "Your prompt is never sent to a model. No provider account, key, or endpoint is contacted, and no completion is generated — the grade comes from a bundled rubric, not from a model's opinion.",
    verify: "No module reachable from the coaching page entry issues a request of any kind; the flow tests fail on one.",
    boundaryId: "network",
  }),
  Object.freeze({
    id: "hris",
    label: "HRIS and org charts",
    claim: "No HR system, directory, or reporting line is read. This workflow does not know who you are or who you work for.",
    verify: "Coaching imports only the bundled rubric and classifier modules; no dataset, import, or workspace is read.",
    boundaryId: "integrations",
  }),
  Object.freeze({
    id: "enterprise_systems",
    label: "Enterprise and billing systems",
    claim: "No billing, procurement, ticketing, or observability system is contacted, and no spend figure is read or produced by this workflow.",
    verify: "Coaching imports only the bundled rubric and classifier modules; no dataset, import, or workspace is read.",
    boundaryId: "integrations",
  }),
  Object.freeze({
    id: "credentials",
    label: "Credentials and identity",
    claim: "There is no sign-in. No key, token, cookie, account, or email address is read, required, or sent.",
    verify: "No module reachable from the coaching page entry references a cookie, storage, or authorization API.",
    boundaryId: "credentials",
  }),
  Object.freeze({
    id: "customer_data",
    label: "Customer data",
    claim: "No customer record is read and none is created. Your text is measured into counts and left in the field; there is no store to write it to.",
    verify: "A session built from text containing a unique marker contains that marker in no field, at any depth, once serialized.",
    boundaryId: "retention",
  }),
]);

for (const exclusion of COACHING_ENTRY_EXCLUSIONS) {
  if (!COACHING_LOCAL_ONLY_BOUNDARY.some((entry) => entry.id === exclusion.boundaryId)) {
    throw new RangeError(`prompt coaching entry: exclusion "${exclusion.id}" cites no session boundary`);
  }
}

// ---------------------------------------------------------------------------
// The journey, assembled
// ---------------------------------------------------------------------------

/**
 * The whole front-door contract, with the example graded at build time so the
 * page shows what the example actually produces rather than what it is
 * described as producing.
 */
export function coachingEntryJourney() {
  const session = buildEntryExampleSession();
  return Object.freeze({
    schemaVersion: COACHING_ENTRY_VERSION,
    question: COACHING_ENTRY_QUESTION,
    value: COACHING_ENTRY_VALUE,
    benchmark: COACHING_ENTRY_BENCHMARK,
    example: Object.freeze({
      ...COACHING_ENTRY_EXAMPLE,
      outcome: session.outcome,
      source: session.input.source,
      headline: session.result.scored
        ? session.result.benchmark.text
        : session.result.recovery.title,
      success: coachingEntrySuccess(session),
    }),
    states: Object.freeze(Object.values(COACHING_ENTRY_STATE).map((state) => Object.freeze({
      state,
      nextAction: coachingEntryNextAction(state),
    }))),
    successStates: COACHING_ENTRY_SUCCESS_STATES,
    exclusions: COACHING_ENTRY_EXCLUSIONS,
  });
}

/**
 * Check a journey against this contract.
 *
 * @returns {{valid: boolean, errors: ReadonlyArray<{code: string, detail: string}>}}
 *   every failure, not the first. Codes are stable; a caller switches on them.
 */
export function validateCoachingEntryJourney(journey) {
  const errors = [];
  const fail = (code, detail) => errors.push(Object.freeze({ code, detail }));

  if (!journey || typeof journey !== "object" || Array.isArray(journey)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze([Object.freeze({ code: "not_an_object", detail: "a journey must be an object" })]),
    });
  }
  if (journey.schemaVersion !== COACHING_ENTRY_VERSION) {
    fail("unsupported_version", `this build reads ${COACHING_ENTRY_VERSION}`);
  }
  const keys = Object.keys(journey);
  if (keys.length !== ENTRY_JOURNEY_FIELDS.length
    || !ENTRY_JOURNEY_FIELDS.every((field) => keys.includes(field))) {
    fail("journey_fields", `a journey carries exactly: ${ENTRY_JOURNEY_FIELDS.join(", ")}`);
  }
  if (journey.question?.answeredBy !== COACHING_QUESTION) {
    fail("question", "the front door promises the question the workflow answers");
  }
  if (!journey.benchmark?.bands?.length || journey.benchmark.metric !== COACHING_ENTRY_BENCHMARK.metric) {
    fail("benchmark", "the benchmark names one metric and the bands it is read against");
  }
  if (journey.example?.source !== COACHING_INPUT_SOURCE.bundledSample) {
    fail("example_source", `the supplied example is classified ${COACHING_INPUT_SOURCE.bundledSample}, never the visitor's text`);
  }
  const states = journey.states ?? [];
  if (states.length !== Object.values(COACHING_ENTRY_STATE).length
    || states.some((entry) => !entry?.nextAction?.control)) {
    fail("states", "every state names exactly one next action and the control that performs it");
  }
  if (!journey.successStates?.length
    || journey.successStates.some((entry) => !entry.measure)) {
    fail("success_states", "every success state carries the expression it is counted by");
  }
  const excluded = (journey.exclusions ?? []).map((entry) => entry.id);
  for (const required of ["live_provider", "hris", "enterprise_systems", "credentials", "customer_data"]) {
    if (!excluded.includes(required)) fail("exclusions", `"${required}" must be excluded explicitly`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
