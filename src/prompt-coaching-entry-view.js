// The front door, painted from the journey contract.
//
// READING ORDER, AND WHY IT IS THIS ONE. A visitor who has typed nothing asks
// four things in a fixed order, and this surface answers them in that order and
// stops:
//
//   1. What do I get, and what does it cost me?   — the value block.
//   2. Measured against what?                     — the benchmark block.
//   3. What do I do first?                        — exactly one action, and the
//      zero-input control that performs it when there is nothing to paste.
//   4. What does this reach on my behalf?         — the exclusions, each with
//      the property that makes it checkable.
//
// Everything is computed from `prompt-coaching-entry.js`. No sentence here is
// transcribed from it, so a promise cannot drift from the contract the workflow
// enforces without failing in the module the workflow imports.
//
// The action line and the source attribution are rewritten in place rather than
// repainted: the example control must keep its identity and its listener across
// a state change, and a status region that is replaced wholesale may never
// announce. Every node is built with createElement and textContent — no markup
// string and no innerHTML on any path.

import {
  COACHING_ENTRY_EXAMPLE, COACHING_ENTRY_VERSION, COACHING_ENTRY_STATE,
  COACHING_INPUT_SOURCE_LABELS, buildEntryExampleSession, coachingEntryJourney,
  coachingEntryNextAction,
} from "./prompt-coaching-entry.js";
import { presentCoachingResult } from "./coaching-result-presentation.js";
import { renderCoachingResult } from "./coaching-result-view.js";

const SECTION_ID = "prompt-coaching-entry";
const BODY_ID = "prompt-coaching-entry-body";
const ACTION_ID = "prompt-coaching-entry-action";
const ALTERNATIVE_ID = "prompt-coaching-entry-alternative";
const SOURCE_ID = "prompt-coaching-entry-source";
const FIRST_RUN_SECTION_ID = "prompt-coach-sample";
const FIRST_RUN_BODY_ID = "prompt-coach-sample-body";
export const EXAMPLE_CONTROL_ID = "prompt-coaching-example";
export const FIRST_RUN_RESULT_ID = "prompt-coach-sample-result";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text, id) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (id) node.id = id;
  return node;
}

function definitions(doc, className, entries) {
  const list = element(doc, "dl", className);
  for (const [term, detail] of entries) {
    list.append(element(doc, "dt", undefined, term), element(doc, "dd", undefined, detail));
  }
  return list;
}

// --- 1. what you get --------------------------------------------------------

function valueBlock(doc, journey) {
  const block = element(doc, "section", "prompt-coaching-entry-block");
  block.dataset.block = "value";
  block.append(
    element(doc, "h4", "eyebrow", "What you get here"),
    element(doc, "p", "prompt-coaching-entry-headline", journey.value.headline),
    definitions(doc, "prompt-coaching-entry-value", [
      ["When", journey.value.arrivesWhen],
      ["Computed by", journey.value.computedBy],
      ["What it costs you", journey.value.costsVisitor],
      ["What is kept", journey.value.keeps],
    ]),
  );
  return block;
}

// --- 2. measured against what ----------------------------------------------

function benchmarkBlock(doc, journey) {
  const { benchmark } = journey;
  const block = element(doc, "section", "prompt-coaching-entry-block");
  block.dataset.block = "benchmark";
  block.dataset.rubric = benchmark.rubricId;
  block.append(
    element(doc, "h4", "eyebrow", "Measured against what"),
    element(doc, "p", "prompt-coaching-entry-metric",
      `${benchmark.label}: ${benchmark.scale.minimum}–${benchmark.scale.maximum} in `
      + `${benchmark.scale.unit}, from rubric ${benchmark.rubricId}.`),
    definitions(doc, "prompt-coaching-entry-benchmark", [
      ["Bands", benchmark.bands.map((band) => `${band.letter} from ${band.minimumScore}`).join(" · ")],
      ["How it is computed", benchmark.computedAs],
      ["What counts as a real change", `${benchmark.material.rule} ${benchmark.material.notMaterial}`],
      ["What it may not be used for", `${benchmark.ceiling.claim} It is not ${benchmark.ceiling.refuses} — that needs ${benchmark.ceiling.floorInstead}`],
    ]),
  );
  return block;
}

// --- 3. the one next action -------------------------------------------------

function actionBlock(doc, journey) {
  const action = coachingEntryNextAction(COACHING_ENTRY_STATE.empty);
  const block = element(doc, "section", "prompt-coaching-entry-block");
  block.dataset.block = "action";
  const control = element(doc, "button", "prompt-coaching-entry-example", action.label, EXAMPLE_CONTROL_ID);
  control.setAttribute("type", "button");
  control.setAttribute("aria-describedby", ACTION_ID);
  // The status of the last grade: whose text produced it. One permanent node so
  // assistive technology has something to watch across every grade.
  const source = element(doc, "p", "prompt-coaching-entry-source", "", SOURCE_ID);
  source.setAttribute("role", "status");
  source.setAttribute("aria-live", "polite");
  source.hidden = true;
  block.append(
    element(doc, "h4", "eyebrow", "Do this first"),
    element(doc, "p", "prompt-coaching-entry-action", action.instruction, ACTION_ID),
    control,
    element(doc, "p", "prompt-coaching-entry-alternative", action.alternative ?? "", ALTERNATIVE_ID),
    element(doc, "p", "prompt-coaching-entry-attribution", journey.example.attribution),
    source,
  );
  return block;
}

// --- 4. what it never reaches ----------------------------------------------

function exclusionsBlock(doc, journey) {
  // Keep the boundary visible without placing five audit proofs between the
  // first action and the field it points to. Native details preserves keyboard
  // reachability and exposes the expanded/collapsed state without custom ARIA.
  const block = element(doc, "details", "prompt-coaching-entry-block prompt-coaching-entry-boundary");
  block.dataset.block = "exclusions";
  const summary = element(doc, "summary", "prompt-coaching-entry-boundary-summary",
    "Privacy boundary — no provider, HRIS, enterprise system, credential, or customer data");
  const list = element(doc, "ul", "prompt-coaching-entry-exclusions");
  for (const entry of journey.exclusions) {
    const item = element(doc, "li");
    item.dataset.exclusion = entry.id;
    item.append(
      element(doc, "p", "prompt-coaching-entry-exclusion-label", entry.label),
      element(doc, "p", "prompt-coaching-entry-exclusion-claim", entry.claim),
      element(doc, "p", "prompt-coaching-entry-exclusion-verify", `How to check: ${entry.verify}`),
    );
    list.append(item);
  }
  block.append(
    summary,
    element(doc, "p", "prompt-coaching-entry-lead",
      "None of the systems below is contacted, read, or required. Expand this boundary to inspect each claim and how the regression suite checks it."),
    list,
  );
  return block;
}

/**
 * Paint the front door into the shipped markup.
 *
 * @returns the container that was painted, or `null` when the page carries none
 *   — the grading workflow itself does not depend on this surface.
 */
export function applyCoachingEntry(doc) {
  const body = byId(doc, BODY_ID);
  if (!body) return null;
  const journey = coachingEntryJourney();
  body.replaceChildren(
    valueBlock(doc, journey),
    benchmarkBlock(doc, journey),
    actionBlock(doc, journey),
    exclusionsBlock(doc, journey),
  );
  body.dataset.entryVersion = COACHING_ENTRY_VERSION;
  setCoachingEntryState(doc, { state: COACHING_ENTRY_STATE.empty });
  return body;
}

/**
 * Move the front door to a state: one instruction, and the zero-input control
 * offered only while there is nothing in the field to overwrite.
 */
export function setCoachingEntryState(doc, { state = COACHING_ENTRY_STATE.empty } = {}) {
  const section = byId(doc, SECTION_ID);
  if (!section) return null;
  const action = coachingEntryNextAction(state);
  section.dataset.entryState = state;
  section.dataset.nextAction = action.id;

  const instruction = byId(doc, ACTION_ID);
  if (instruction) instruction.textContent = action.instruction;
  const alternative = byId(doc, ALTERNATIVE_ID);
  if (alternative) {
    alternative.textContent = action.alternative ?? "";
    alternative.hidden = !action.alternative;
  }
  const control = byId(doc, EXAMPLE_CONTROL_ID);
  if (control) {
    // Offering to overwrite text a visitor already typed is not an offer.
    control.hidden = state !== COACHING_ENTRY_STATE.empty;
  }
  return section;
}

/**
 * Paint the first-run sample: one complete graded result, on arrival, from the
 * bundled example.
 *
 * WHY A DESTINATION PAINTS ONE AT ALL. The workflow's front door explains what a
 * result contains; this shows one. A visitor deciding whether this page is worth
 * their prompt reads the same regions their own grade would produce — the answer,
 * what it is measured against with its provenance, the one thing to do first, and
 * the rubric evidence behind a disclosure — before being asked for anything.
 *
 * DETERMINISM. The session comes from `buildEntryExampleSession()`: bundled text,
 * bundled tier, a pure rubric, no clock and no sampling. The same page load draws
 * the same figures on every machine, which is what makes this assertable.
 *
 * WHOSE TEXT IT IS. The attribution is the contract's own sentence for a
 * `bundled_sample` grade, rendered beside the figures rather than under them, so
 * a demonstration can never be read as a reading of the visitor's work.
 *
 * @returns the container that was painted, or `null` on a page that carries no
 *   sample region — the grading workflow does not depend on this surface.
 */
export function applyCoachingFirstRun(doc) {
  const body = byId(doc, FIRST_RUN_BODY_ID);
  if (!body) return null;
  const session = buildEntryExampleSession();
  const model = presentCoachingResult({ session });
  body.replaceChildren(
    element(doc, "p", "prompt-coach-sample-attribution",
      COACHING_INPUT_SOURCE_LABELS[session.input.source]),
    // The sample's own heading names it, so the result is labelled by that
    // heading rather than writing a second one over the same figures.
    renderCoachingResult(doc, model, {
      idPrefix: FIRST_RUN_RESULT_ID,
      headingLevel: 4,
      labelledBy: "prompt-coach-sample-title",
    }),
  );
  body.dataset.sampleId = COACHING_ENTRY_EXAMPLE.sampleId;
  body.dataset.source = session.input.source;
  setCoachingFirstRunState(doc, { replaced: false });
  return body;
}

/**
 * Stand the sample down, or bring it back.
 *
 * A visitor who has graded their own text has the result they came for, and two
 * results on one page is the state where an example figure gets read as theirs.
 * Clearing the panel returns the page to its first-run state, where the sample
 * is the only result on screen and is offered again.
 */
export function setCoachingFirstRunState(doc, { replaced = false } = {}) {
  const section = byId(doc, FIRST_RUN_SECTION_ID);
  if (!section) return null;
  section.dataset.sampleState = replaced ? "replaced" : "shown";
  section.hidden = replaced;
  return section;
}

/**
 * Say whose text the grade on screen came from.
 *
 * This is the visible half of the classification `session.input.source` carries:
 * a result produced from the supplied example is announced as a demonstration,
 * so it can never be read as a grade of the visitor's own work. `null` takes the
 * attribution off, which is what clearing does.
 */
export function announceCoachingEntrySource(doc, source) {
  const section = byId(doc, SECTION_ID);
  const node = byId(doc, SOURCE_ID);
  if (!section || !node) return null;
  if (!source) {
    delete section.dataset.gradedSource;
    node.textContent = "";
    node.hidden = true;
    return node;
  }
  section.dataset.gradedSource = source;
  node.textContent = COACHING_INPUT_SOURCE_LABELS[source]
    ?? COACHING_INPUT_SOURCE_LABELS[COACHING_ENTRY_EXAMPLE.distinct.visitorTextClassifiedAs];
  node.hidden = false;
  return node;
}
