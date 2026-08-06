// The worked sample on the surface (#1167): one more download beside the blank
// template, and the figure it imports to printed next to it.
//
// WHY THIS IS A SEPARATE MODULE FROM THE ON-RAMP VIEW. The on-ramp view is in
// the page's static import graph and therefore in what a first-time visitor
// fetches before the answer block is readable. The rows of a sample file and
// the figure they produce are neither of those things: a reader meets them only
// after choosing a provider. So the on-ramp reaches this module with a native
// `import()` and this module owns the whole control — the button, its bytes,
// and the sentence beside it. The initial payload does not move.
//
// The classes are the on-ramp's own, whole. No rule was added to either
// stylesheet for this control, and the figure is printed in the same
// key-and-value line the report and the console path already use.

import {
  WORKED_SAMPLE_FIGURE_LABEL, workedSample,
} from "./import-worked-sample.js";

/** The attribute the control is found by, in tests and in the click handler. */
export const WORKED_SAMPLE_ATTRIBUTE = "worked";

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Append the worked-sample control and its figure to a painted choice.
 *
 * `download` is the page's own local blob writer, handed down from the on-ramp:
 * this module opens no dialog and creates no Blob of its own, so there is still
 * exactly one download path on the page.
 *
 * Returns whether the control was appended, so a caller cannot report a file
 * offer that was never painted.
 */
export function appendWorkedSample(doc, card, adapterId, download) {
  const sample = workedSample(adapterId);
  if (!card || !sample) return false;
  const button = element(doc, "button", "provider-readiness-download",
    `Download a worked ${sample.rowCount}-row sample (CSV)`);
  button.setAttribute("type", "button");
  button.dataset[WORKED_SAMPLE_ATTRIBUTE] = sample.adapter;
  button.addEventListener("click", () => {
    download?.(sample.text, sample.mediaType, sample.filename);
  });
  const figure = element(doc, "p", "provider-readiness-where");
  figure.dataset[WORKED_SAMPLE_ATTRIBUTE] = "figure";
  figure.append(
    element(doc, "span", "provider-readiness-key", WORKED_SAMPLE_FIGURE_LABEL),
    doc.createTextNode(sample.figure),
  );
  card.append(button, figure);
  return true;
}
