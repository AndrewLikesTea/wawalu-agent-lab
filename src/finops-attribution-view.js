// The two places the attribution policy becomes something a reader sees.
//
// It takes the document rather than reading a global, exactly like
// `graded-sample-view.js` and `import-mapping-view.js`, so a test drives the
// shipped markup of evolution.html instead of a fixture authored for the test.
// Every node is built with createElement and textContent — no markup string, no
// innerHTML, nothing interpolated from a file.
//
// Neither surface is a new section, panel, or expander. The disclosure is three
// sentences in the import panel's own heading block; the fallback replaces the
// contents of the impact slot the savings figure would have occupied. Surface
// that does not answer a question does not ship, so nothing here is added that
// the policy module cannot supply an answer for.
//
// Two rules hold in both:
//   1. Nothing is signalled by tint alone. Every state ships a word.
//   2. No dollar savings figure appears below the floor — not a range, not an
//      estimate, not a hedged amount. `suppressedSavingsFallback` carries none,
//      and this module renders only what it carries.

import {
  CONFIDENCE, PRE_UPLOAD_STATEMENTS, suppressedSavingsFallback,
} from "./finops-attribution-policy.js";

const DISCLOSURE_ID = "pre-upload-disclosure";
const FALLBACK_ID = "local-attribution-fallback";
const NOTE_ID = "local-attribution-note";
const RECOVERABLE_ID = "local-recoverable";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The three statements the page makes before a byte is selected: the question
 * one provider export answers, the material metric it produces, and the one
 * prioritized action it names. Painted from the policy module so the promise and
 * the rule that enforces it are the same text.
 *
 * @returns {string[]} the statements painted, for a caller that wants to assert.
 */
export function applyPreUploadDisclosure(doc) {
  const list = byId(doc, DISCLOSURE_ID);
  if (!list) return [];
  list.replaceChildren(...PRE_UPLOAD_STATEMENTS.map((statement) =>
    element(doc, "li", "pre-upload-statement", statement)));
  return [...PRE_UPLOAD_STATEMENTS];
}

/**
 * The below-floor fallback. Three facts in the place the ranked figure would
 * have been: the spend observed, the largest concentration line — full
 * confidence in every input state — and the one sentence naming what would raise
 * confidence.
 *
 * @param {object} doc the document.
 * @param {object|null} fallback a `suppressedSavingsFallback` model, or null to
 *   clear the region and hand the slot back to the ranked figure.
 * @param {{formatMoney?: (value: number) => string,
 *          includeRaiseSentence?: boolean}} [options] pass
 *   `includeRaiseSentence: false` when the page already shows the one ranked
 *   upgrade action; the model's raise sentence is the same guidance without the
 *   file named or the coverage it would buy, and saying it twice is the
 *   per-missing-input messaging this surface exists to avoid.
 */
export function applySuppressedSavings(doc, fallback, {
  formatMoney = String, includeRaiseSentence = true,
} = {}) {
  const region = byId(doc, FALLBACK_ID);
  if (!region) return null;
  if (!fallback) {
    region.replaceChildren();
    region.hidden = true;
    region.dataset.state = "inactive";
    return null;
  }
  const model = fallback.reason === "attribution_below_floor"
    ? fallback : suppressedSavingsFallback(fallback);
  region.dataset.state = "suppressed";
  const items = [
    element(doc, "li", "attribution-fallback-total",
      `Total spend observed: ${formatMoney(model.totalCost)}.`),
    element(doc, "li", "attribution-fallback-line", model.concentration.available
      ? `Largest concentration line: ${model.concentration.label} at `
        + `${formatMoney(model.concentration.cost)}.`
      : "Largest concentration line: none — no cost row in this file carries a "
        + "provider or service line."),
  ];
  if (includeRaiseSentence) {
    items.push(element(doc, "li", "attribution-fallback-raise", model.raiseConfidence));
  }
  region.replaceChildren(
    element(doc, "p", "attribution-fallback-headline", model.headline),
    element(doc, "p", "attribution-fallback-why", model.explanation),
    (() => {
      const list = element(doc, "ul", "attribution-fallback-facts");
      list.setAttribute("aria-label", "What this export can still answer");
      list.replaceChildren(...items);
      return list;
    })(),
  );
  region.hidden = false;
  return model;
}

/**
 * The confidence word beside the recoverable figure, and the unattributed share
 * a degraded finding must carry verbatim. A suppressed classification blanks the
 * figure itself: the fallback above is what stands in its place, and leaving a
 * number in the slot with a caveat under it would be the hedge the policy
 * refuses.
 *
 * @param {object} doc the document.
 * @param {object} classification a `classifyFinding` result for the
 *   recoverable-savings category.
 */
export function applyAttributionNote(doc, classification) {
  const note = byId(doc, NOTE_ID);
  const figure = byId(doc, RECOVERABLE_ID);
  if (figure) figure.dataset.confidence = classification?.confidence ?? CONFIDENCE.SUPPRESSED;
  if (!note) return null;
  if (!classification || classification.confidence === CONFIDENCE.FULL) {
    note.textContent = "";
    note.hidden = true;
    note.dataset.state = classification ? "full" : "unknown";
    return classification ?? null;
  }
  note.hidden = false;
  if (classification.confidence === CONFIDENCE.DEGRADED) {
    note.dataset.state = "degraded";
    // The figure is stated verbatim, as a percentage of spend, because "some
    // spend is unattributed" is not something a leader can weigh.
    note.textContent = `Degraded confidence · ${classification.unattributedText}. `
      + "The figure below covers only the attributed remainder.";
    return classification;
  }
  note.dataset.state = "suppressed";
  note.textContent = "Suppressed · too little of this spend is attributed to rank a "
    + "savings figure honestly.";
  return classification;
}
