// The render layer for the imported brief's completeness score.
//
// It takes the document rather than reading a global, like the view modules
// beside it, so a test drives the shipped markup of evolution.html. Every node
// is built with createElement and textContent: no markup string, no innerHTML.
//
// WHAT IT WILL NOT DO.
//
//   * Decide anything. Which slots were earned, what each one is worth, which
//     tier the total reaches and which gap is worth fixing first are
//     `scoreBriefCompleteness`'s answers. This layer paints rows and holds no
//     weight, threshold or instruction of its own.
//   * Put the answer inside the disclosure. The tier sentence and the one
//     prioritized next action are paragraphs in the open. A collapsed details
//     element hides its contents from assistive tech in a real browser while the
//     text-reading harness these tests run under still sees them, so the two
//     lines a reader came for are never behind the control. What IS behind it is
//     the slot-by-slot working — the part a reader opens only to dispute the
//     number — and the control says how many slots fell back before it is
//     pressed.
//   * Announce. The stand region already owns this page's single live region for
//     an import; a second one is a queue a reader hears instead of an answer.
//   * Touch the example path. Passing null takes the block off screen and leaves
//     every node the bundled example owns exactly as it was.

import {
  completenessSentence, nextActionSentence, scoreBriefCompleteness,
} from "./finops-brief-completeness.js";
import {
  FIGURE_SOURCE, mountProvenance, renderProvenance, sourceOfSupported,
} from "./finops-brief-provenance.js";

const REGION_ID = "finops-brief-completeness";
const PROVENANCE_ID = "finops-brief-completeness-provenance";
const TIER_ID = "finops-brief-completeness-tier";
const NEXT_ID = "finops-brief-completeness-next";
const DETAIL_ID = "finops-brief-completeness-detail";
const SUMMARY_ID = "finops-brief-completeness-summary";
const COUNT_ID = "finops-brief-completeness-count";
const SLOTS_ID = "finops-brief-completeness-slots";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

const setText = (doc, id, text) => {
  const node = byId(doc, id);
  if (node) node.textContent = text;
};

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Mirror the disclosure's own state into `data-disclosure` and `aria-expanded`,
 * exactly as every other disclosure on this region does. The listener is
 * attached once — a second one would fire twice per toggle.
 */
function mountDisclosure(doc) {
  const details = byId(doc, DETAIL_ID);
  if (!details || details.dataset.mounted === "true") return;
  details.dataset.mounted = "true";
  const paint = () => {
    const open = details.hasAttribute("open");
    details.dataset.disclosure = open ? "expanded" : "collapsed";
    byId(doc, SUMMARY_ID)?.setAttribute("aria-expanded", String(open));
  };
  details.addEventListener?.("toggle", paint);
  paint();
}

/**
 * One row per scored slot: the label with what it is worth, the verdict word,
 * and the reason it earned. Rebuilt on every paint rather than diffed — a row
 * kept from a previous import is a verdict about a file that is not loaded.
 */
function paintSlots(doc, slots) {
  const host = byId(doc, SLOTS_ID);
  if (!host) return;
  host.replaceChildren();
  for (const slot of slots) {
    const term = element(doc, "dt", "completeness-slot-label",
      `${slot.label} · ${slot.weight} points`);
    term.dataset.slot = slot.id;
    const detail = element(doc, "dd", "completeness-slot");
    detail.dataset.slot = slot.id;
    detail.dataset.satisfied = String(slot.satisfied);
    detail.dataset.weight = String(slot.weight);
    // The word carries the state, never the tint alone: "Earned" and "Fell back"
    // are what a reader reads and what a test holds.
    detail.append(element(doc, "span", "completeness-verdict",
      slot.satisfied ? "Earned" : "Fell back"));
    // And the same marker the rest of the brief uses, so a row here and the
    // headline row it scores say where the figure came from in one vocabulary.
    detail.append(renderProvenance(doc, sourceOfSupported(slot.satisfied),
      { qualifies: slot.label }));
    detail.append(element(doc, "span", "completeness-reason", slot.reason));
    host.append(term, detail);
  }
}

/**
 * Score an imported analysis and paint the block, or take it off screen.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`, or null on the
 *   bundled example and after a clear.
 * @param movement the movement summary the page already painted for this
 *   import, so the score and the block above it read the same periods.
 * @returns the score, including the unavailable one.
 */
export function applyBriefCompleteness(doc, analysis, { movement = null } = {}) {
  const score = scoreBriefCompleteness(analysis ?? null, { movement });
  const region = byId(doc, REGION_ID);
  if (!region) return score;
  mountDisclosure(doc);
  if (!score.available) {
    region.hidden = true;
    region.dataset.state = "unavailable";
    delete region.dataset.tier;
    region.dataset.total = "0";
    setText(doc, TIER_ID, "");
    setText(doc, NEXT_ID, "");
    setText(doc, COUNT_ID, "not analyzed");
    byId(doc, SLOTS_ID)?.replaceChildren();
    return score;
  }

  region.hidden = false;
  region.dataset.state = "imported";
  region.dataset.tier = score.tier;
  region.dataset.total = String(score.total);
  region.dataset.contractVersion = score.version;
  setText(doc, TIER_ID, completenessSentence(score));
  setText(doc, NEXT_ID, nextActionSentence(score));
  const missing = score.slotCount - score.satisfiedCount;
  // The count is inside the summary, so it is part of the control's accessible
  // name: a reader hears what is behind the control before pressing it.
  setText(doc, COUNT_ID, missing === 0
    ? `all ${score.slotCount} earned`
    : `${missing} of ${score.slotCount} fell back`);
  // The score is a fact about the reader's own export — it counts what that file
  // could and could not supply — so the marker above the working reads as the
  // file state, with the count as its detail. It sits OUTSIDE the disclosure,
  // above it, because a marker inside a collapsed details element is one a real
  // browser never shows.
  mountProvenance(doc, {
    region, id: PROVENANCE_ID, source: FIGURE_SOURCE.file, before: byId(doc, DETAIL_ID),
    qualifies: "Brief completeness",
    detail: `${score.satisfiedCount} of ${score.slotCount} slots scored from your export`,
  });
  paintSlots(doc, score.slots);
  return score;
}

/** Take the completeness block off screen. The example path is left untouched. */
export function clearBriefCompleteness(doc) {
  return applyBriefCompleteness(doc, null);
}
