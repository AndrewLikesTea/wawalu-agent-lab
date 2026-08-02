// The render layer for the imported-state headline contract.
//
// It takes the document rather than reading a global, like the view modules
// beside it, so a test drives the shipped markup of evolution.html. Every node
// is built with createElement and textContent: no markup string, no innerHTML.
//
// WHAT IT WILL NOT DO.
//
//   * Decide anything. Which slots the export supported, what each one says
//     when it did not, and which provenance label belongs to it are
//     `importedHeadline`'s answers, and they come off the checked-in fixture.
//     This layer paints rows and holds no string of its own.
//   * Drop a row. Five slots are painted in fixture order in every state. A
//     slot the export could not supply is painted with its fallback sentence
//     and its fallback provenance label, marked `data-supported="false"` — not
//     hidden, not blank, and never carrying the bundled example's figure.
//   * Touch the example path. Passing `null` takes this block off screen and
//     leaves every node the example headline owns exactly as it was.
//   * Announce. This block is part of the stand region's one answer, and that
//     region already has the page's single live region for an import. A second
//     one is a queue a reader hears instead of an answer, which is the rule
//     tests/finops-answer-announcement.test.js holds.
//
// The provenance label is an ATTRIBUTE as well as a word, because the word is
// what a reader sees and the attribute is what a test can hold: the harness
// these tests run under reads text through collapsed containers, so "this slot
// says it came from your export" is asserted on `data-supported` and on the
// rendered label rather than on whether something is visible.

import { importedHeadline } from "./finops-imported-headline.js";

const REGION_ID = "finops-imported-headline";
const QUESTION_ID = "finops-imported-headline-question";
const SLOTS_ID = "finops-imported-headline-slots";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * One row per slot: the label, the value or its fallback, the provenance label,
 * and the basis sentence when the slot earned one.
 *
 * Rebuilt on every paint rather than diffed. The rows are five, and a row kept
 * from a previous import would be a figure for a file that is no longer loaded.
 */
function paintSlots(doc, slots) {
  const host = byId(doc, SLOTS_ID);
  if (!host) return [];
  const built = [];
  for (const entry of slots) {
    const term = element(doc, "dt", "imported-headline-label", entry.label);
    term.dataset.slot = entry.id;
    const detail = element(doc, "dd", "imported-headline-slot");
    detail.dataset.slot = entry.id;
    detail.dataset.supported = String(entry.supported);
    detail.append(element(doc, "span", "imported-headline-value", entry.value));
    const provenance = element(doc, "span", "imported-headline-provenance", entry.provenance);
    provenance.dataset.provenance = entry.supported ? "supported" : "fallback";
    detail.append(provenance);
    if (entry.detail) {
      detail.append(element(doc, "span", "imported-headline-basis", entry.detail));
    }
    host.append(term, detail);
    built.push(detail);
  }
  return built;
}

/**
 * Paint the imported headline for an analysis, or take it off screen.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`, or null when
 *   the reader is on the bundled example or has cleared an import.
 * @returns the composed headline, including the unavailable one.
 */
export function applyImportedHeadline(doc, analysis) {
  const region = byId(doc, REGION_ID);
  const headline = importedHeadline(analysis ?? null);
  if (!region) return headline;
  const host = byId(doc, SLOTS_ID);
  if (host) host.replaceChildren();
  if (!headline.available) {
    region.hidden = true;
    region.dataset.state = "unavailable";
    delete region.dataset.tier;
    const question = byId(doc, QUESTION_ID);
    if (question) question.textContent = "";
    return headline;
  }

  region.hidden = false;
  region.dataset.state = "imported";
  region.dataset.tier = headline.tier;
  region.dataset.contractVersion = headline.contractVersion;
  const question = byId(doc, QUESTION_ID);
  // The question line renders above the five slots, in the fixture's words.
  if (question) question.textContent = headline.question;
  paintSlots(doc, headline.slots);
  return headline;
}

/** Take the imported headline off screen. The example path is left untouched. */
export function clearImportedHeadline(doc) {
  return applyImportedHeadline(doc, null);
}
