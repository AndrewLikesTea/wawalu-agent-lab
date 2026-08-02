// The recognition surface on the AI FinOps workspace (#928). It paints what
// recognizeExport() returned and nothing else: a band sentence, the confidence
// WITH the evidence that produces it, and one next action.
//
// Three constraints this file exists to honour:
//  - no bare number. The confidence line and the evidence list are painted in
//    the same pass, so a figure can never appear without the lines that add up
//    to it. There is no code path that renders one without the other.
//  - no raw file content. Every string here comes from the recognition result,
//    which is redacted at source, or from a literal in this module. No record,
//    no cell, and no reader-invented column name is ever painted.
//  - the result region is a live region and is NEVER inside a collapsed
//    disclosure. Folded-away status text is not announced in a real browser
//    however readable a test harness finds it.

import { RECOGNITION_FIXTURES, recognitionFixtureById } from "./export-recognition-fixtures.js";
import { RECOGNITION_BANDS, recognizeExport } from "./export-recognition.js";

const EXAMPLE_ID = "export-recognition-example";
const RESULT_ID = "export-recognition-result";

// One sentence per band, and each reads as exactly one state: a reader never
// has to decide whether "accepted" also means something is outstanding.
const BAND_SENTENCE = Object.freeze({
  [RECOGNITION_BANDS.ACCEPTED]: "Accepted — this export can be used as it is.",
  [RECOGNITION_BANDS.ATTENTION]:
    "Needs attention — this export can be used only after the next action below.",
  [RECOGNITION_BANDS.REJECTED]: "Rejected — this export cannot be used.",
});

// Said when the chooser holds a value that is not a bundled example. A real
// select refuses an unlisted value and the test harness does not, so the
// refusal lives here, in the application code, rather than in the control.
export const UNKNOWN_EXAMPLE_COPY = "That is not one of the bundled example exports. "
  + "Choose an example from the list to score it.";

// Repeated on every render because it is the claim the whole surface rests on.
export const LOCAL_SCOPE_COPY = "This is a local, browser-only reading of a bundled "
  + "example export. No provider account is contacted, no credential is used or "
  + "stored, and no row of the file is shown here.";

const node = (doc, tag, className, text) => {
  const created = doc.createElement(tag);
  if (className) created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
};

const signed = (value) => (value > 0 ? `+${value}` : String(value));

/** Paints the recognition result for one bundled example. */
export function renderExportRecognition(doc, fixtureId) {
  const root = doc.getElementById(RESULT_ID);
  if (!root) return false;
  const fixture = recognitionFixtureById(fixtureId);
  if (!fixture) {
    root.dataset.state = "unavailable";
    root.dataset.band = "none";
    root.replaceChildren(node(doc, "p", "export-recognition-band", UNKNOWN_EXAMPLE_COPY));
    return true;
  }
  const result = recognizeExport(fixture.parsed);
  root.dataset.state = "scored";
  root.dataset.band = result.band;
  root.dataset.outcome = result.outcome;
  root.dataset.confidence = String(result.confidence);
  const lines = [
    node(doc, "p", "export-recognition-band", BAND_SENTENCE[result.band]),
    node(doc, "p", "export-recognition-provider", result.displayName
      ? `Detected provider: ${result.displayName}, matched against its published contract.`
      : "Detected provider: none. This file was not attributed to the nearest-looking provider."),
    node(doc, "p", "export-recognition-confidence",
      `Confidence ${result.confidence} of ${result.maxConfidence}, and every point of it is `
      + `one of the ${result.evidence.length} lines below.`),
  ];
  const evidence = node(doc, "ol", "export-recognition-evidence");
  for (const entry of result.evidence) {
    const item = node(doc, "li", null,
      `${signed(entry.contribution)} of ${entry.weight} · ${entry.label} — ${entry.statement}`);
    item.dataset.signalId = entry.signalId;
    item.dataset.contribution = String(entry.contribution);
    evidence.append(item);
  }
  lines.push(evidence);
  lines.push(node(doc, "p", "export-recognition-action", `Next action: ${result.nextAction}`));
  lines.push(node(doc, "p", "export-recognition-scope", LOCAL_SCOPE_COPY));
  root.replaceChildren(...lines);
  return true;
}

/** Fills the example chooser, paints the first example, and wires the change. */
export function initExportRecognition(doc) {
  const select = doc.getElementById(EXAMPLE_ID);
  const result = doc.getElementById(RESULT_ID);
  if (!select || !result) return false;
  select.replaceChildren(...RECOGNITION_FIXTURES.map((fixture) => {
    const option = doc.createElement("option");
    option.value = fixture.id;
    option.textContent = `${fixture.label} · expected ${fixture.outcomeClass}`;
    return option;
  }));
  // Taken from the fixture list rather than from select.options so the default
  // is a value renderExportRecognition() can actually resolve.
  select.value = RECOGNITION_FIXTURES[0].id;
  select.addEventListener("change", () => renderExportRecognition(doc, select.value));
  renderExportRecognition(doc, select.value);
  return true;
}
