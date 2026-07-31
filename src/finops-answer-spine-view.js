// The thin painter for src/finops-answer-spine.js.
//
// It puts the spine's own strings into the page's answer region and stamps
// every top-level region with the role and order the spine gives it. It holds
// no copy, no list, and no number of its own: every string it writes comes from
// the spine, and every figure stays with the module that already computes it.
//
// WHY THE ORDER IS STAMPED RATHER THAN APPLIED. The regions are already in the
// document in spine order — src/finops/answer-spine-view.js fails the build
// when they are not. Re-sorting them here would be a second mechanism moving
// the same nodes, and a page whose reading order depends on script having run
// is a page that reads wrong with script disabled. So this writes the spine's
// index onto each region and *reports* any region whose DOM position disagrees;
// a test turns that report into a failure.

import {
  answerRegionId, FINOPS_ANSWER_SPINE, LAYER_ROLE, orderedRegionIds,
} from "./finops-answer-spine.js";
import { SUMMARY_ATTRIBUTE, SUMMARY_ROLE } from "./finops-decision-contract.js";

/** Every element this view writes into. All inside the answer region. */
export const SPINE_VIEW_IDS = Object.freeze({
  question: "finops-stand-question",
  metricLabel: "finops-stand-recoverable-label",
  metricValue: "finops-stand-recoverable-value",
  metricBasis: "finops-stand-recoverable-basis",
  spine: "finops-stand-spine",
  action: "finops-stand-spine-action",
  artifactLink: "finops-stand-spine-artifact-link",
  artifactNote: "finops-stand-spine-artifact-note",
});

/** Attributes this view writes onto every classified region. */
export const LAYER_ROLE_ATTRIBUTE = "data-spine-role";
export const LAYER_ORDER_ATTRIBUTE = "data-spine-order";

/** The element whose element children are the page's top-level regions. */
export const MAIN_REGION_ID = "main-content";

/** How a spine role labels itself in the older `data-decision-summary` vocabulary. */
const SUMMARY_LABEL = Object.freeze({
  [LAYER_ROLE.answer]: SUMMARY_ROLE.complete,
  [LAYER_ROLE.evidence]: SUMMARY_ROLE.evidence,
});

const text = (doc, id, value) => {
  const node = doc?.getElementById?.(id);
  if (node && typeof value === "string" && value) node.textContent = value;
  return node;
};

/** The ids of `main`'s top-level element children, in document order. */
function renderedRegionIds(doc, mainId = MAIN_REGION_ID) {
  const main = doc?.getElementById?.(mainId);
  if (!main) return [];
  return Array.from(main.children ?? [])
    .map((child) => child.id)
    .filter(Boolean);
}

/**
 * Paint the spine onto the document.
 *
 * @returns `{ applied, answerRegionId, order, mismatches, classified }`.
 *   `mismatches` names every region whose document position disagrees with the
 *   spine's order, so the disagreement is reported rather than silently fixed.
 */
export function applyAnswerSpineContract(doc, spine = FINOPS_ANSWER_SPINE) {
  const answerId = answerRegionId(spine);
  const answer = doc?.getElementById?.(answerId);
  if (!answer) {
    return Object.freeze({
      applied: false, answerRegionId: answerId, order: Object.freeze([]),
      mismatches: Object.freeze([`${answerId}: the answer region is not on this page`]),
      classified: 0,
    });
  }

  // 1. The question, in the leader's words.
  text(doc, SPINE_VIEW_IDS.question, spine.question);

  // 2. The headline metric. Its label always; its unavailable wording only
  //    while the slot has no figure, so an empty dataset never renders a
  //    misleadingly precise number and a painted figure is never overwritten.
  const metric = spine.headlineMetric;
  text(doc, SPINE_VIEW_IDS.metricLabel, metric.label);
  const value = doc.getElementById(SPINE_VIEW_IDS.metricValue);
  if (value && value.dataset?.available !== "true") {
    value.textContent = metric.unavailable.value;
    value.dataset.state = metric.unavailable.state;
    text(doc, SPINE_VIEW_IDS.metricBasis, metric.unavailable.basis);
  }

  // 3. The one action, as the shape of the thing the lead does. The concrete
  //    sentence — which department, which change — stays with the resolver that
  //    ranks it, one element above.
  text(doc, SPINE_VIEW_IDS.action, `Do next: ${spine.action.label}.`);

  // 4. The one forwardable artifact, and what a recipient can check from it.
  text(doc, SPINE_VIEW_IDS.artifactLink, spine.artifact.label);
  const link = doc.getElementById(SPINE_VIEW_IDS.artifactLink);
  if (link) link.setAttribute("href", `#${spine.artifact.control}`);
  text(doc, SPINE_VIEW_IDS.artifactNote, spine.artifact.recipientCanVerify[0]);
  const spineLine = doc.getElementById(SPINE_VIEW_IDS.spine);
  if (spineLine) spineLine.dataset.spine = "contract";

  // 5. Every region's role and order, from the spine rather than from where the
  //    element happens to sit. `data-decision-summary` is written here too, so
  //    the older label can no longer disagree with the spine that decides.
  let classified = 0;
  for (const layer of spine.evidenceLayers) {
    const region = doc.getElementById(layer.id);
    if (!region) continue;
    region.setAttribute(LAYER_ROLE_ATTRIBUTE, layer.role);
    region.setAttribute(LAYER_ORDER_ATTRIBUTE, String(layer.order));
    const label = SUMMARY_LABEL[layer.role];
    if (label && region.hasAttribute(SUMMARY_ATTRIBUTE)) region.setAttribute(SUMMARY_ATTRIBUTE, label);
    classified += 1;
  }

  const expected = orderedRegionIds({}, spine);
  const rendered = renderedRegionIds(doc);
  const mismatches = [];
  const shared = expected.filter((id) => rendered.includes(id));
  shared.forEach((id, index) => {
    if (rendered.filter((other) => shared.includes(other))[index] !== id) {
      mismatches.push(`${id}: document position disagrees with the spine order`);
    }
  });

  return Object.freeze({
    applied: true,
    answerRegionId: answerId,
    order: Object.freeze(rendered),
    mismatches: Object.freeze(mismatches),
    classified,
  });
}
