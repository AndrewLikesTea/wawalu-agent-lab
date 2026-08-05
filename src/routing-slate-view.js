// Paints the routing slate. It decides nothing: every figure, label and sentence
// below is read off `routing-slate.js` verbatim.
//
// READING ORDER IS THE PRODUCT. The question, then one material figure, then one
// action. A reader who stops after three lines has the decision; a reader who
// wants to argue with a row opens that row and finds the evidence line the
// figure came from and what kind of number it is.
//
// What stays OUTSIDE a disclosure: the question, the total, the action, the
// tie-break clause, and every rule's summary line. The test harness reads
// through a closed disclosure and a real browser does not, so anything a reader
// must see without pressing something is authored outside one.
//
// No new styles — every class here already ships in evolution.css.
// `createElement` and `textContent` only; no markup string, no innerHTML.

import { formatUsd } from "./evolution.js";
import {
  MODELLED_BASIS, ROUTING_SLATE_QUESTION, routingSlate,
} from "./routing-slate.js";

export const ROUTING_SLATE_SECTION_ID = "routing-slate";
export const ROUTING_SLATE_BODY_ID = "routing-slate-body";

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One rule: a summary a reader can rank on, and a body they can dispute. */
function ruleItem(doc, rule) {
  const item = element(doc, "li");
  const detail = element(doc, "details", "completeness-detail");
  detail.dataset.rank = String(rule.rank);
  const summary = element(doc, "summary", null,
    `${rule.rank}. ${rule.source} → ${rule.targetTier} tier · `
    + `${formatUsd(rule.expectedMonthlyUsd)} a month`);
  const evidence = element(doc, "p", "answer-figure-basis", rule.evidence);
  const basis = element(doc, "p", "answer-figure-basis",
    `${rule.basis}. Confidence: ${rule.confidence}.`);
  basis.dataset.basis = MODELLED_BASIS;
  detail.append(summary, evidence, basis);
  item.append(detail);
  return item;
}

/**
 * Paint the section from an analysis envelope.
 *
 * @param {Document} doc
 * @param {object|null} analysis The `local-finops` envelope, bundled or imported.
 * @returns the slate that was painted, so a caller can assert on it.
 */
export function applyRoutingSlate(doc, analysis) {
  const section = doc?.getElementById?.(ROUTING_SLATE_SECTION_ID);
  const body = doc?.getElementById?.(ROUTING_SLATE_BODY_ID);
  const slate = routingSlate(analysis);
  if (!section || !body) return slate;
  section.dataset.state = slate.available ? "ready" : "unavailable";
  section.dataset.ruleCount = String(slate.rules.length);
  section.hidden = false;

  if (!slate.available) {
    body.replaceChildren(element(doc, "p", "answer-figure-direction", slate.reason));
    return slate;
  }

  const figureBasis = element(doc, "span", "answer-figure-basis",
    `${slate.basis}. The sum of the ${slate.rules.length} ranked rules below`
    + `${slate.period ? `, over ${slate.period}` : ""}.`);
  figureBasis.dataset.basis = MODELLED_BASIS;
  const figure = element(doc, "p", "answer-figure");
  figure.append(
    element(doc, "span", "answer-figure-label", "Total expected monthly return"),
    element(doc, "strong", "answer-figure-value",
      formatUsd(slate.totalExpectedMonthlyUsd)),
    figureBasis,
  );

  const list = element(doc, "ol", "action-list");
  for (const rule of slate.rules) list.append(ruleItem(doc, rule));

  body.replaceChildren(
    figure,
    element(doc, "p", "answer-figure-direction", `Do this first: ${slate.nextAction}`),
    element(doc, "p", "answer-figure-basis", slate.tieBreak),
    list,
  );
  return slate;
}

export { ROUTING_SLATE_QUESTION };
