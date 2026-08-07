// The coaching preview: the contract, shown rather than promised.
//
// A reader deciding whether to paste something into a box on the open internet
// has three questions, and this surface answers them in that order:
//
//   1. What text does this read?  — a bundled sample, shown in full, beside the
//      measurements a session actually carries about it.
//   2. What do I get back?        — the field list, and the whole session as
//      JSON, generated live from the same functions the workflow uses.
//   3. What does it never do?     — the local-only boundary, each claim beside
//      the property it can be checked against.
//
// Everything below is computed from `prompt-coaching-contract.js` at render
// time. Nothing is transcribed: a claim that drifted from the implementation
// would have to drift in the module the workflow itself runs on, and the
// contract tests fail there first.
//
// Every node is built with createElement and textContent. There is no markup
// string and no innerHTML on any path here — the same rule the result surface
// holds, for the same reason.

import {
  COACHING_LOCAL_ONLY_BOUNDARY, COACHING_OUTCOME_STATES, COACHING_SESSION_VERSION,
  PREVIEW_SAMPLE_ID, RESULT_FIELD_MEANINGS, buildSampleCoachingSession,
  coachingSample, serializeCoachingSessionPreview, summarizeSampleOutcomes,
} from "./prompt-coaching-contract.js";

const BODY_ID = "prompt-coaching-preview-body";

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function definitions(doc, className, entries) {
  const list = element(doc, "dl", className);
  for (const [term, detail] of entries) {
    list.append(element(doc, "dt", undefined, term), element(doc, "dd", undefined, detail));
  }
  return list;
}

/** A closed disclosure for the long material: the reader opts into the JSON. */
function collapsed(doc, summaryText, node) {
  const wrap = element(doc, "details", "prompt-coaching-preview-nested");
  wrap.append(element(doc, "summary", undefined, summaryText), node);
  return wrap;
}

// --- 1. what text is analyzed -----------------------------------------------

function analyzedBlock(doc, sample, session) {
  const block = element(doc, "section", "prompt-coaching-preview-block");
  block.dataset.block = "analyzed";
  block.append(
    element(doc, "h3", "eyebrow", "What text is analyzed"),
    element(doc, "p", "prompt-coaching-preview-lead",
      `${sample.label} — bundled synthetic text written for this preview, not anyone's prompt. `
      + "Grading your own text measures exactly the same things about it."),
    element(doc, "pre", "prompt-coaching-preview-sample", sample.text),
    definitions(doc, "prompt-coaching-preview-measures", [
      ["Source", session.input.source],
      ["Characters read", String(session.input.chars)],
      ["Turns read", String(session.input.turns)],
      ["Role labels found", session.input.labelled ? "yes" : "no"],
      ["Turns the rubric scored", String(session.input.scoredTurns)],
      ["Model tier named", session.input.modelTier ?? "not specified"],
    ]),
    element(doc, "p", "prompt-coaching-preview-note",
      "Those counts are the whole of what a session says about the text. The text "
      + "itself is measured and left in the field you typed it into."),
  );
  return block;
}

// --- 2. what comes back -----------------------------------------------------

function resultBlock(doc, session) {
  const block = element(doc, "section", "prompt-coaching-preview-block");
  block.dataset.block = "result";
  block.dataset.outcome = session.outcome;
  block.append(
    element(doc, "h3", "eyebrow", "What you receive"),
    element(doc, "p", "prompt-coaching-preview-lead",
      `Outcome: ${session.outcome}. ${session.result.scored
        ? session.result.benchmark.text
        : session.result.recovery.title}`),
    definitions(doc, "prompt-coaching-preview-fields",
      RESULT_FIELD_MEANINGS.map((entry) => [entry.field, entry.meaning])),
    collapsed(doc, `The whole session as JSON (${COACHING_SESSION_VERSION})`,
      element(doc, "pre", "prompt-coaching-preview-json",
        serializeCoachingSessionPreview(session.sessionId))),
  );
  return block;
}

// --- 3. every state ---------------------------------------------------------

function statesBlock(doc, outcomes) {
  const block = element(doc, "section", "prompt-coaching-preview-block");
  block.dataset.block = "states";
  const list = element(doc, "ul", "prompt-coaching-preview-states");
  for (const state of COACHING_OUTCOME_STATES) {
    const shown = outcomes.filter((entry) => entry.outcome === state.outcome);
    const item = element(doc, "li");
    item.dataset.outcome = state.outcome;
    item.append(
      element(doc, "p", "prompt-coaching-preview-state-title", `${state.label} · ${state.outcome}`),
      element(doc, "p", "prompt-coaching-preview-state-meaning", state.meaning),
      element(doc, "p", "prompt-coaching-preview-state-delivers", `You get: ${state.delivers}`),
    );
    if (state.reasons.length) {
      item.append(element(doc, "p", "prompt-coaching-preview-state-codes",
        `Reason codes: ${state.reasons.join(", ")}`));
    }
    // Demonstrated, not asserted: each sample is graded here and the state it
    // actually produced is printed. A sample that stopped producing the state
    // it is filed under shows up on the page, not only in a test.
    for (const entry of shown) {
      item.append(element(doc, "p", "prompt-coaching-preview-state-sample",
        `Sample “${entry.label}” → ${entry.outcome}${entry.reason ? ` (${entry.reason})` : ""}: ${entry.headline}`));
    }
    list.append(item);
  }
  block.append(
    element(doc, "h3", "eyebrow", "Every state this can return"),
    element(doc, "p", "prompt-coaching-preview-lead",
      "Four states, each demonstrated below by a bundled sample graded when this page rendered."),
    list,
  );
  return block;
}

// --- 4. the boundary --------------------------------------------------------

function boundaryBlock(doc) {
  const block = element(doc, "section", "prompt-coaching-preview-block");
  block.dataset.block = "boundary";
  const list = element(doc, "ul", "prompt-coaching-preview-boundary");
  for (const entry of COACHING_LOCAL_ONLY_BOUNDARY) {
    const item = element(doc, "li");
    item.dataset.boundary = entry.id;
    item.append(
      element(doc, "p", "prompt-coaching-preview-boundary-label", entry.label),
      element(doc, "p", "prompt-coaching-preview-boundary-claim", entry.claim),
      // The claim is worth what its check is worth, so the check is printed
      // beside it rather than kept in a test file the reader cannot see.
      element(doc, "p", "prompt-coaching-preview-boundary-verify", `How to check: ${entry.verify}`),
    );
    list.append(item);
  }
  block.append(
    element(doc, "h3", "eyebrow", "What stays out"),
    element(doc, "p", "prompt-coaching-preview-lead",
      "Grading runs in this browser tab. No request is sent for coaching, and "
      + "nothing you type is stored."),
    list,
  );
  return block;
}

/**
 * Paint the preview into the shipped markup.
 *
 * @returns the container that was painted, or `null` when the page does not
 *   carry one — the coaching workflow itself does not depend on this surface.
 */
export function applyCoachingPreview(doc, sampleId = PREVIEW_SAMPLE_ID) {
  const body = doc?.getElementById ? doc.getElementById(BODY_ID) : null;
  if (!body) return null;
  const sample = coachingSample(sampleId);
  if (!sample) return null;
  const session = buildSampleCoachingSession(sampleId);
  body.replaceChildren(
    analyzedBlock(doc, sample, session),
    resultBlock(doc, session),
    statesBlock(doc, summarizeSampleOutcomes()),
    boundaryBlock(doc),
  );
  body.dataset.sample = sampleId;
  body.dataset.contractVersion = COACHING_SESSION_VERSION;
  return body;
}
