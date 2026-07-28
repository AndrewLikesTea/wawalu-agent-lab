// The reading order, every state, and the privacy boundary — as properties of
// the presentation model rather than of a rendering of it.
//
// These assertions are the design claim of the surface. If one of them can be
// deleted without breaking the product, it was decoration: the order a reader
// meets an answer in, the fact that there is exactly one next step, the fact
// that no state is drawn by tint alone, and the fact that nothing pasted can
// reach the model at all.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PRESENTATION_ORDER, PRESENTATION_STATUS, PRESENTATION_TONE,
  auditFigures, presentCoachingResult,
} from "../src/coaching-result-presentation.js";
import { buildCoachingSpecimen, outOfRangeSession } from "../src/coaching-specimen.js";
import { buildCoachingSession, buildSampleCoachingSession } from "../src/prompt-coaching-contract.js";

const specimen = () => buildCoachingSpecimen();
const caseNamed = (id) => specimen().find((entry) => entry.id === id);
const regionNamed = (model, id) => model.regions.find((region) => region.id === id);

test("the regions read grade, benchmark, one action, then the evidence", () => {
  for (const entry of specimen()) {
    const ids = entry.model.regions.map((region) => region.id);
    assert.deepEqual(ids, PRESENTATION_ORDER.filter((id) => ids.includes(id)),
      `${entry.id} renders its regions out of reading order: ${ids.join(" > ")}`);
    assert.equal(ids[0], "grade", `${entry.id} does not answer the question first`);
    assert.equal(ids[1], "benchmark", `${entry.id} does not follow the answer with what it is measured against`);
    assert.equal(ids[2], "action", `${entry.id} does not put the one move third`);
  }
});

test("every state carries exactly one next action, never two of equal weight", () => {
  for (const entry of specimen()) {
    const actions = entry.model.regions.filter((region) => region.kind === "action");
    assert.equal(actions.length, 1, `${entry.id} presents ${actions.length} next steps`);
    assert.ok(actions[0].title.length, `${entry.id} has an action with nothing in it`);
    assert.ok(actions[0].guidance.length, `${entry.id} names a move without saying how`);
  }
});

test("the routing recommendation is evidence, not a second next step", () => {
  const graded = caseNamed("graded").model;
  const evidence = regionNamed(graded, "evidence");
  assert.equal(evidence.disclosure, true, "supporting evidence is disclosed, not hoisted");
  assert.ok(evidence.recommendation, "the routing reading is still delivered");
  assert.equal(regionNamed(graded, "action").id, "action");
  // The tier reading is acted on by a platform owner and the rewrite by the
  // reader. Two top-level moves would make a reader rank them.
  assert.ok(!evidence.recommendation.title.includes(regionNamed(graded, "action").title));
});

test("only the evidence and the rubric detail are behind a disclosure", () => {
  for (const entry of specimen()) {
    for (const region of entry.model.regions) {
      assert.equal(region.disclosure, ["evidence", "rubric"].includes(region.id),
        `${entry.id}: "${region.id}" is disclosed the wrong way round`);
    }
  }
});

test("every state names itself in words and in a shape, never in a tint alone", () => {
  const words = new Set();
  const shapes = new Set();
  for (const entry of specimen()) {
    const grade = regionNamed(entry.model, "grade");
    assert.ok(grade.statusValue.length, `${entry.id} has no word for its state`);
    assert.ok(grade.shape.length, `${entry.id} has no shape for its state`);
    assert.ok(grade.answer.length, `${entry.id} says nothing about what happened`);
    assert.ok(Object.values(PRESENTATION_TONE).includes(entry.model.tone));
    words.add(`${entry.model.status}:${grade.statusValue}`);
    shapes.add(`${entry.model.status}:${grade.shape}`);
  }
  // One word and one shape per state: two states sharing both would be two
  // states a reader can only tell apart by color.
  const states = new Set(specimen().map((entry) => entry.model.status));
  assert.equal(words.size, states.size);
  assert.equal(shapes.size, states.size);
});

test("every figure is printed with the label that says what it is", () => {
  for (const entry of specimen()) {
    for (const region of entry.model.regions) {
      for (const figure of region.facts ?? []) {
        assert.ok(figure.label.length, `${entry.id}/${region.id} prints a value with no label`);
        assert.ok(String(figure.value).length, `${entry.id}/${region.id} prints an empty value`);
      }
    }
  }
});

test("every displayed rubric weight and ranked claim carries its stated assumption", () => {
  for (const entry of specimen().filter((item) => item.model.status === PRESENTATION_STATUS.graded)) {
    const rubric = regionNamed(entry.model, "rubric");
    const assumptions = new Map(rubric.assumptions.map((item) => [item.key, item.text]));
    for (const axis of rubric.axes) {
      assert.match(axis.label, /\d+% of the composite$/);
      assert.ok(axis.assumption?.length, `${entry.id} displays a weight without its assumption`);
    }
    for (const axis of entry.model.regions.find((region) => region.id === "rubric").axes) {
      assert.ok(rubric.assumptions.some((item) => item.text === axis.assumption),
        `${entry.id} drops an axis assumption from the dispute material`);
    }
    assert.ok([...assumptions.keys()].every((key) => key.length > 0));
    assert.ok([...assumptions.values()].every((text) => text.length > 0));
  }
});

test("the loading state keeps every region it will fill, and claims no figure", () => {
  const model = presentCoachingResult({ status: PRESENTATION_STATUS.loading });
  assert.equal(model.tone, PRESENTATION_TONE.pending);
  assert.deepEqual(model.regions.map((region) => region.id), ["grade", "benchmark", "action"]);
  assert.equal(regionNamed(model, "grade").mark, null, "a letter is not drawn before it exists");
  const benchmark = regionNamed(model, "benchmark");
  assert.ok(benchmark.facts.every((figure) => figure.pending && figure.value === "—"),
    "a pending figure prints a placeholder, never a zero");
  assert.equal(regionNamed(model, "action").available, false);
  assert.equal(model.sessionId, null);
});

test("a refusal is a state with a benchmark and a move in it, not a blank panel", () => {
  const invalid = caseNamed("invalid").model;
  assert.equal(invalid.status, PRESENTATION_STATUS.invalidInput);
  const facts = regionNamed(invalid, "benchmark").facts;
  assert.deepEqual(facts.map((figure) => figure.label), ["Turns read", "Ceiling"]);
  assert.equal(facts[1].value, "20", "a reader is told what to trim to");
  const action = regionNamed(invalid, "action");
  assert.equal(action.available, true);
  assert.equal(action.control, "prompt-coaching-input", "the guidance names an operable control");
  assert.equal(regionNamed(invalid, "grade").facts[0].label, "Reason code");

  const empty = caseNamed("empty").model;
  assert.equal(empty.status, PRESENTATION_STATUS.empty);
  assert.ok(regionNamed(empty, "action").title.length);
  assert.equal(regionNamed(empty, "rubric"), undefined, "a refusal has no rubric detail to disclose");
});

test("the control a refusal names is a control the page actually ships", async () => {
  const markup = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  for (const entry of specimen()) {
    const control = regionNamed(entry.model, "action").control;
    if (control) assert.ok(markup.includes(`id="${control}"`), `${entry.id} points at a missing control`);
  }
});

test("an out-of-range figure withholds the grade and names the bound it broke", () => {
  const model = caseNamed("implausible").model;
  assert.equal(model.status, PRESENTATION_STATUS.graded);
  assert.equal(model.implausible, true);
  assert.equal(model.tone, PRESENTATION_TONE.caution, "a broken figure does not get the confident tone");

  const grade = regionNamed(model, "grade");
  assert.equal(grade.mark, null, "no letter is drawn from a score outside the scale");
  assert.match(grade.answer, /not shown/);
  assert.deepEqual(model.notices.map((notice) => notice.code), [
    "score_out_of_range", "band_distance_negative", "estimate_out_of_range",
    "scored_turns_exceed_turns",
  ]);
  for (const notice of model.notices) {
    assert.ok(notice.label.length && notice.value.length && notice.guidance.length);
  }
  const composite = regionNamed(model, "benchmark").facts[0];
  assert.equal(composite.implausible, true);
  assert.match(composite.value, /out of range: 4,200/);
  // The rest of the result stays readable: a bad number is not a reason to
  // withhold the per-turn codes a reader needs to work out what happened.
  assert.ok(regionNamed(model, "rubric").turns.length);
});

test("every session the shipped engine produces passes the figure audit", () => {
  for (const entry of specimen()) {
    if (entry.id === "implausible") continue;
    const session = entry.model.sessionId ? buildSampleCoachingSession(entry.model.sessionId) : null;
    if (session) assert.deepEqual(auditFigures(session), [], `${entry.id} tripped its own bounds`);
  }
  // The ceiling a refusal hit is the workflow working, not a broken figure.
  assert.deepEqual(auditFigures(buildSampleCoachingSession("long-transcript")), []);
});

test("a model refuses to be built from a state it cannot draw", () => {
  assert.throws(() => presentCoachingResult({ status: "almost_graded" }), /unknown status/);
  assert.throws(() => presentCoachingResult({ status: PRESENTATION_STATUS.graded }), /needs a session/);
});

test("nothing a reader pasted can reach the presentation, at any depth", () => {
  // The marker is the property: a session carries counts about the text, so a
  // model built from one cannot carry the text. Asserted rather than reasoned
  // about, because this is the claim the whole workflow rests on.
  const marker = "ZQX-marker-9f2a-do-not-render";
  const session = buildCoachingSession({
    sessionId: "privacy-probe",
    text: `Please review ${marker} and explain what it does in this service.`,
    modelTier: "standard",
  });
  const model = presentCoachingResult({ session });
  assert.equal(model.status, PRESENTATION_STATUS.graded);
  assert.ok(!JSON.stringify(model).includes(marker), "the presentation echoed the analyzed text");
  assert.ok(!JSON.stringify(model).includes("Please review"), "the presentation echoed the analyzed text");

  const extreme = presentCoachingResult({ session: outOfRangeSession(session) });
  assert.ok(!JSON.stringify(extreme).includes(marker), "the extreme specimen echoed the analyzed text");
});

test("the specimen is deterministic: two builds are byte-identical", () => {
  assert.equal(JSON.stringify(buildCoachingSpecimen()), JSON.stringify(buildCoachingSpecimen()));
});
