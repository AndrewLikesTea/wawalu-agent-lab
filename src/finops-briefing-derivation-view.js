// The render layer for "check the math".
//
// It paints a `briefingDerivation` model into a container the page already
// ships, exactly like `finops-provenance-view.js` beside it: `createElement` and
// `textContent` only, no markup string, no innerHTML, no interpolation into a
// template. A briefing carries no visitor content, and this layer would not be
// allowed to render it if it did.
//
// IT DECIDES NOTHING
// ------------------
// Every number, every verdict, and every sentence arrives on the model. There is
// no path here that recomputes a figure, softens a mismatch, or hides a step. A
// step that did not reconcile is painted with both numbers side by side, in the
// same place a reconciled one is painted, because a reader scanning for the
// disagreement should not have to know it is rendered differently.
//
// LEGIBLE WITHOUT SIGHT
// ---------------------
// The structure is the accessibility, not an ARIA label layered over a grid:
//
//   * The verdict is the first thing in the region and is a complete sentence
//     that names the outcome. It is never a colour, a chip, or an icon alone;
//     `data-verdict` exists for the stylesheet and is never the only channel.
//   * Stated inputs are a description list, so each operand's name and value are
//     one term/definition pair rather than two cells a reader has to correlate.
//   * The steps are an ordered list, so a screen reader announces "3 of 6" and a
//     reader can say which step they dispute. Each item is three sentences —
//     what the step is, the expression, and the two numbers with the outcome
//     word — so no item depends on the one before it for meaning.
//   * Nothing is a table. A table of arithmetic needs header association to be
//     readable, and a sentence per step needs none.

import { STEP_STATUS } from "./finops-briefing-derivation.js";

/** The outcome word for each step status. Authored once; never a glyph alone. */
const STATUS_WORD = Object.freeze({
  [STEP_STATUS.reproduced]: "matches the briefing",
  [STEP_STATUS.mismatch]: "DOES NOT match the briefing",
  [STEP_STATUS.unchecked]: "could not be checked from this briefing's own figures",
});

// A shape per status reaches the reader through `data-status` and a CSS
// `::before`, never through a text node. It is a fourth channel for a
// monochrome print or a greyscale screenshot, layered on top of the outcome
// word — and generated content stays out of the accessibility tree, so a screen
// reader hears the sentence once rather than hearing a glyph read as "equals".

export const DERIVATION_INTRO =
  "Every figure this briefing states is recomputed below from the operands the briefing itself carries. "
  + "Nothing here re-reads your provider export, and no prompt or conversation content is involved: "
  + "this check runs on the briefing alone.";

export const WEIGHTS_SUMMARY = "Every number this check applies, and the assumption behind it";

/**
 * The one sentence that says the grade is not a weighted average, painted above
 * the weight list rather than left to a reader's assumption about the word.
 */
export const WEIGHTS_PREAMBLE =
  "The confidence grade is a lookup against ordered thresholds and one all-or-nothing gate — no number below "
  + "is multiplied by another, so a strong criterion cannot mask a weak one. Each number is stated with the "
  + "assumption that justifies it, so the assumption can be disputed instead of reverse-engineered.";

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function definitionList(doc, className, entries) {
  const list = element(doc, "dl", className);
  for (const { term, definition } of entries) {
    list.append(element(doc, "dt", null, term), element(doc, "dd", null, definition));
  }
  return list;
}

/**
 * The version line: what produced this briefing, beside what this build would
 * apply. Both halves are always named, including when one of them is unstated —
 * "not stated" is a fact about the file and is more useful than an absent line.
 */
export function versionsLine(versions) {
  return `Routing rubric ${versions.rubric.stated ?? "not stated"} `
    + `(this build applies ${versions.rubric.current}) · `
    + `attribution classifier ${versions.attribution.stated ?? "not stated"} · `
    + `briefing contract ${versions.contract.stated ?? "not stated"} · `
    + `check ${versions.derivation}`;
}

/** One step, as the three sentences a screen reader hears in order. */
function stepItem(doc, entry, index, total) {
  const item = element(doc, "li", "derivation-step");
  item.dataset.status = entry.status;
  item.dataset.stepId = entry.id;
  const operands = entry.operands.length
    ? `Using ${entry.operands.map((operand) => `${operand.name} = ${operand.text}`).join(", ")}. `
    : "";
  item.append(
    element(doc, "p", "derivation-step-label", `Step ${index + 1} of ${total}: ${entry.label}`),
    element(doc, "p", "derivation-step-expression", entry.expression),
    element(doc, "p", "derivation-step-result",
      `${operands}Recomputed ${entry.computedText}; this briefing states ${entry.statedText}. `
      + `That ${STATUS_WORD[entry.status] ?? STATUS_WORD[STEP_STATUS.unchecked]}.`),
  );
  return item;
}

/**
 * Paint a derivation into `container`, replacing whatever was there.
 *
 * @param doc the document, passed in rather than read off a global, so a test
 *   drives the shipped markup instead of a fixture authored for the test.
 * @param containerId the element the region is painted into. Missing, nothing
 *   happens and null is returned — this view is additive to every surface it
 *   appears on and never a precondition for one.
 * @param derivation a `briefingDerivation` result, or null to empty the region.
 * @returns the derivation that was painted, or null.
 */
export function renderBriefingDerivation(doc, containerId, derivation) {
  const container = doc?.getElementById ? doc.getElementById(containerId) : null;
  if (!container) return null;
  container.replaceChildren();
  if (!derivation) {
    container.hidden = true;
    delete container.dataset.verdict;
    delete container.dataset.reproducible;
    return null;
  }

  container.hidden = false;
  // For the stylesheet and for a test. Both are restatements of the sentence
  // below them, never the only place the outcome can be read.
  container.dataset.verdict = derivation.verdict;
  container.dataset.reproducible = String(derivation.reproducible);

  const verdict = element(doc, "p", "derivation-verdict", derivation.statement);
  verdict.dataset.verdict = derivation.verdict;
  container.append(
    element(doc, "p", "derivation-intro", DERIVATION_INTRO),
    verdict,
    element(doc, "p", "derivation-versions", versionsLine(derivation.versions)),
    element(doc, "p", "derivation-heading eyebrow", "Stated inputs"),
    definitionList(doc, "derivation-inputs",
      derivation.inputs.map((input) => ({ term: input.name, definition: input.text }))),
    element(doc, "p", "derivation-heading eyebrow", "Arithmetic, step by step"),
  );

  const steps = element(doc, "ol", "derivation-steps");
  derivation.steps.forEach((entry, index) => {
    steps.append(stepItem(doc, entry, index, derivation.steps.length));
  });
  container.append(steps);

  // The weights sit behind a native disclosure with a summary that says what is
  // behind it. They stay in the DOM whether it is open or shut, which is what
  // lets the print stylesheet open all of it without a script — the same rule
  // the briefing's own disclosures follow.
  const details = element(doc, "details", "derivation-weights");
  details.append(
    element(doc, "summary", null, WEIGHTS_SUMMARY),
    element(doc, "p", "derivation-weights-preamble", WEIGHTS_PREAMBLE),
    definitionList(doc, "derivation-weight-list",
      [...derivation.weights, ...derivation.tolerances].map((weight) => ({
        term: `${weight.name} = ${weight.value} ${weight.unit}`,
        definition: `Assumption: ${weight.assumption} Why this number: ${weight.rationale}`,
      }))),
  );
  container.append(details);
  return derivation;
}
