// The front-door journey contract: the promises made before anything is typed.
//
// Each test below holds one product decision to account — the question the door
// answers, the value it promises, the benchmark that value is measured against,
// the single next action, what counts as success, and what is excluded. A claim
// that drifted from the workflow fails here rather than aging into a lie on the
// page.

import test from "node:test";
import assert from "node:assert/strict";

import { COACHING_QUESTION } from "../src/prompt-coaching.js";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";
import {
  COACHING_INPUT_SOURCE, COACHING_LOCAL_ONLY_BOUNDARY, COACHING_OUTCOME,
  buildCoachingSession, validateCoachingSession,
} from "../src/prompt-coaching-contract.js";
import {
  COACHING_ENTRY_BENCHMARK, COACHING_ENTRY_EXAMPLE, COACHING_ENTRY_EXCLUSIONS,
  COACHING_ENTRY_STATE, COACHING_ENTRY_SUCCESS_STATES, COACHING_ENTRY_VERSION,
  COACHING_INPUT_SOURCE_LABELS, buildEntryExampleSession, coachingEntryJourney,
  coachingEntryNextAction, coachingEntryState, coachingEntrySuccess,
  validateCoachingEntryJourney,
} from "../src/prompt-coaching-entry.js";

test("the journey answers the workflow's own question and validates against itself", () => {
  const journey = coachingEntryJourney();
  assert.equal(journey.schemaVersion, COACHING_ENTRY_VERSION);
  assert.equal(journey.question.answeredBy, COACHING_QUESTION,
    "the door must promise the answer the workflow returns, not a paraphrase");
  assert.deepEqual(validateCoachingEntryJourney(journey), { valid: true, errors: [] });
  // And it refuses a journey that promises a different question.
  const drifted = { ...journey, question: { ...journey.question, answeredBy: "something else" } };
  assert.deepEqual(validateCoachingEntryJourney(drifted).errors.map(({ code }) => code),
    ["question"]);
});

test("the promised value is immediate, private, client-side, and costs nothing", () => {
  const { value } = coachingEntryJourney();
  assert.match(value.arrivesWhen, /same page view/);
  assert.match(value.computedBy, /bundled client-side rubric modules in this browser tab/);
  assert.match(value.costsVisitor, /no sign-in/);
  assert.match(value.keeps, /^nothing\./);
  // The value claim may not promise anything the boundary says is not delivered.
  assert.equal(/upload|account|sign up|free trial/i.test(value.headline), false, value.headline);
});

test("the benchmark is defined precisely enough to compute twice", () => {
  const { benchmark } = coachingEntryJourney();
  assert.equal(benchmark.metric, "result.benchmark.score");
  assert.equal(benchmark.scale.minimum, PROMPT_LITERACY_RUBRIC.scale.minimum);
  assert.equal(benchmark.scale.maximum, PROMPT_LITERACY_RUBRIC.scale.maximum);
  assert.equal(benchmark.rubricId,
    `${PROMPT_LITERACY_RUBRIC.rubricId}/${PROMPT_LITERACY_RUBRIC.rubricVersion}`);
  // The bands are the rubric's own cutoffs, not a second table beside them.
  assert.deepEqual(benchmark.bands.map((band) => [band.letter, band.minimumScore]),
    PROMPT_LITERACY_RUBRIC.grades.map((grade) => [grade.letter, grade.minimumScore]));
  // Materiality is one rule, and it is the band rule the revision surface uses.
  assert.match(benchmark.material.rule, /only when the letter band moves/);
  // And the figure states what it may never be used for, with the floor instead.
  assert.match(benchmark.ceiling.floorInstead, /\d+ classified prompts in a department/);
});

test("the supplied example is deterministic and classified as bundled sample", () => {
  const first = buildEntryExampleSession();
  const second = buildEntryExampleSession();
  assert.equal(JSON.stringify(first), JSON.stringify(second),
    "the example must grade identically on every machine and every visit");
  assert.equal(first.input.source, COACHING_INPUT_SOURCE.bundledSample);
  assert.equal(first.outcome, COACHING_OUTCOME.graded,
    "the zero-input path must demonstrate a real result, not a refusal");
  assert.equal(validateCoachingSession(first).valid, true);
  assert.equal(COACHING_ENTRY_EXAMPLE.source, COACHING_INPUT_SOURCE.bundledSample);
});

test("the example is explicitly distinct from anything a visitor types", () => {
  const { distinct, attribution, privacy, transition } = COACHING_ENTRY_EXAMPLE;
  assert.equal(distinct.classifiedAs, COACHING_INPUT_SOURCE.bundledSample);
  assert.equal(distinct.visitorTextClassifiedAs, COACHING_INPUT_SOURCE.readerText);
  assert.match(attribution, /not your prompt/);
  assert.match(privacy.reads, /nothing of yours/);
  // The transition out of the example is stated, with the control that does it.
  assert.match(transition.onEdit, /next grade is classified as your text/);
  assert.equal(transition.editControl, "prompt-coaching-input");
  assert.equal(transition.loadControl, "prompt-coaching-example");
  // Both classifications are announceable, so a result can always say whose it is.
  assert.deepEqual(Object.keys(COACHING_INPUT_SOURCE_LABELS).sort(),
    Object.values(COACHING_INPUT_SOURCE).sort());
  assert.match(COACHING_INPUT_SOURCE_LABELS[COACHING_INPUT_SOURCE.bundledSample],
    /not of your text/);
});

test("every state names exactly one next action, and the control that performs it", () => {
  assert.equal(coachingEntryState({}), COACHING_ENTRY_STATE.empty);
  assert.equal(coachingEntryState({ fieldText: "  \n " }), COACHING_ENTRY_STATE.empty,
    "whitespace is nothing to grade, so the zero-input path is still the offer");
  assert.equal(coachingEntryState({ fieldText: "x", fromExample: true }),
    COACHING_ENTRY_STATE.exampleLoaded);
  assert.equal(coachingEntryState({ fieldText: "x" }), COACHING_ENTRY_STATE.visitorText);
  assert.equal(coachingEntryState({ fieldText: "x", graded: true }),
    COACHING_ENTRY_STATE.answered);

  assert.equal(coachingEntryNextAction(COACHING_ENTRY_STATE.empty).id, "try_example");
  assert.equal(coachingEntryNextAction(COACHING_ENTRY_STATE.empty).control,
    "prompt-coaching-example");
  assert.match(coachingEntryNextAction(COACHING_ENTRY_STATE.empty).alternative, /field below/);
  assert.equal(coachingEntryNextAction(COACHING_ENTRY_STATE.visitorText).control,
    "prompt-coaching-grade");
  assert.throws(() => coachingEntryNextAction("invented"), RangeError);

  // One action per state, not a menu: a second offer is the decision handed back.
  for (const { state, nextAction } of coachingEntryJourney().states) {
    assert.ok(nextAction.instruction.length > 0, `${state} instructs nobody`);
    assert.equal(typeof nextAction.control, "string");
  }
});

test("success is defined as a predicate over a session, not as a feeling", () => {
  assert.deepEqual(COACHING_ENTRY_SUCCESS_STATES.map((entry) => entry.id),
    ["demonstrated", "own_prompt_graded", "refused_with_a_way_out"]);

  assert.deepEqual(coachingEntrySuccess(buildEntryExampleSession()), ["demonstrated"]);

  const own = buildCoachingSession({
    sessionId: "own", text: COACHING_ENTRY_EXAMPLE.text,
    modelTier: COACHING_ENTRY_EXAMPLE.modelTier,
  });
  assert.deepEqual(coachingEntrySuccess(own), ["own_prompt_graded"],
    "the same text typed by a visitor is their grade, never the example's");

  const refused = buildCoachingSession({ sessionId: "empty", text: "   " });
  assert.deepEqual(coachingEntrySuccess(refused), ["refused_with_a_way_out"]);
  // A refusal only counts when it carries the way out.
  assert.ok(refused.result.recovery.title.length > 0);
});

test("every excluded system is named and paired with the boundary that proves it", () => {
  assert.deepEqual(COACHING_ENTRY_EXCLUSIONS.map((entry) => entry.id),
    ["live_provider", "hris", "enterprise_systems", "credentials", "customer_data"]);
  for (const entry of COACHING_ENTRY_EXCLUSIONS) {
    assert.ok(entry.claim.length > 0 && entry.verify.length > 0, entry.id);
    assert.ok(COACHING_LOCAL_ONLY_BOUNDARY.some((boundary) => boundary.id === entry.boundaryId),
      `"${entry.id}" cites a boundary the session contract does not enforce`);
  }
  // The provider claim is the one a visitor asks about first, so it is explicit.
  const provider = COACHING_ENTRY_EXCLUSIONS.find((entry) => entry.id === "live_provider");
  assert.match(provider.claim, /never sent to a model/);
});

test("the journey carries no visitor text and no identity, only bundled material", () => {
  const serialized = JSON.stringify(coachingEntryJourney());
  assert.equal(serialized.includes(COACHING_ENTRY_EXAMPLE.text), true,
    "the bundled example is shown in full: it is ours, and hiding it would prove nothing");
  for (const forbidden of ["credential", "token", "cookie", "apiKey", "email"]) {
    assert.equal(new RegExp(`"${forbidden}"\\s*:`).test(serialized), false,
      `the journey must carry no ${forbidden} field`);
  }
});
