// Reading order is answer, figure or withheld reason, comparison, confidence,
// non-causal framing, next action, then a native details disclosure. Nodes use
// textContent, and every color signal is repeated by a word and shape.

import { SPEND_PER_DELIVERY_STATE } from "./spend-per-delivery.js";

export const SPEND_PER_DELIVERY_SECTION_ID = "spend-per-delivery";
export const SPEND_PER_DELIVERY_BODY_ID = "spend-per-delivery-body";
export const SPEND_PER_DELIVERY_LIVE_ID = "spend-per-delivery-live";
export const SPEND_PER_DELIVERY_DETAIL_ID = "spend-per-delivery-detail";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shape(doc, glyph) {
  const node = element(doc, "span", "spd-shape", glyph);
  node.setAttribute("aria-hidden", "true");
  return node;
}

function list(doc, className, items) {
  const node = element(doc, "ul", className);
  for (const item of items) node.append(element(doc, "li", null, item));
  return node;
}

/** The shapes are redundant with the words beside them, never a substitute. */
const DIRECTION_SHAPE = Object.freeze({ higher: "▲", lower: "▼", level: "—" });
const CONFIDENCE_SHAPE = Object.freeze({
  high: "●●●", medium: "●●○", low: "●○○", none: "○○○",
});

function held(section) {
  if (!section.__spendPerDelivery) {
    section.__spendPerDelivery = { model: null, detailOpen: false };
  }
  return section.__spendPerDelivery;
}

/**
 * Write the live region only when the sentence actually changed. A repaint of the
 * same reading is not news, and rewriting a status region re-announces it.
 */
function announce(doc, text) {
  const node = byId(doc, SPEND_PER_DELIVERY_LIVE_ID);
  if (!node || node.textContent === text) return node;
  node.textContent = text;
  return node;
}

const usd = (value) => `${value.toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})} USD`;

function figureBlock(doc, state) {
  const { metric, window } = state;
  const wrap = element(doc, "p", "spd-figure");
  wrap.append(element(doc, "span", "spd-figure-value", usd(metric.spendPerDeliveryUsd)));
  wrap.append(element(doc, "span", "spd-figure-unit", "per completed release"));
  // The arithmetic, beside the result. Both operands and the window are named, so
  // the figure can be recomputed from the line that displays it.
  wrap.append(element(doc, "span", "spd-figure-basis",
    `${usd(metric.spendUsd)} of recorded AI spend ÷ ${metric.deliveries} completed`
    + ` release${metric.deliveries === 1 ? "" : "s"}, ${window.start} to ${window.end}`
    + ` (end exclusive, ${window.days} days).`));
  return wrap;
}

function comparisonBlock(doc, state) {
  const { comparison } = state;
  const wrap = element(doc, "p", "spd-comparison");
  if (comparison.available) {
    wrap.dataset.direction = comparison.direction;
    wrap.append(shape(doc, DIRECTION_SHAPE[comparison.direction] ?? "—"));
    wrap.append(element(doc, "span", "spd-delta",
      `${comparison.deltaPercent > 0 ? "+" : ""}${comparison.deltaPercent.toFixed(1)}%`
      + ` vs baseline · ${comparison.direction}`));
  }
  wrap.append(element(doc, "span", "spd-comparison-text", comparison.interpretation));
  return wrap;
}

function actionBlock(doc, state) {
  const { nextAction } = state;
  const wrap = element(doc, "div", "spd-action");
  wrap.append(element(doc, "h3", "spd-action-title", "Do this next"));
  wrap.append(element(doc, "p", "spd-action-text", nextAction.text));
  if (nextAction.href) {
    const link = element(doc, "a", "spd-action-link", "Open the release log");
    link.setAttribute("href", nextAction.href);
    wrap.append(link);
  }
  wrap.append(element(doc, "p", "spd-action-owner", `Accountable: ${nextAction.owner}`));
  wrap.append(element(doc, "p", "spd-action-why", nextAction.why));
  return wrap;
}

function detailBlock(doc, state, open) {
  const details = element(doc, "details", "spd-detail");
  details.id = SPEND_PER_DELIVERY_DETAIL_ID;
  details.open = open;
  details.append(element(doc, "summary", "spd-detail-summary",
    "How this is counted, and what can move it"));
  details.append(element(doc, "h3", "spd-detail-heading", "What was counted"));
  details.append(list(doc, "spd-evidence", state.evidence));
  details.append(element(doc, "h3", "spd-detail-heading",
    "What can move this ratio with no change in delivery"));
  details.append(list(doc, "spd-confounders", state.confounders));
  details.append(element(doc, "h3", "spd-detail-heading", "Where these figures came from"));
  details.append(element(doc, "p", "spd-provenance", state.provenance.source));
  details.append(element(doc, "p", "spd-provenance-fields",
    state.provenance.complete
      ? "Every local field this comparison requires was present."
      : `Missing local fields: ${state.provenance.missingFields.join(", ")}.`));
  return details;
}

/**
 * Paint the comparison, or hand the section back when there is nothing to say.
 *
 * Returns the state that was painted so a caller can assert on what it asked for
 * rather than on the DOM it got.
 */
export function applySpendPerDelivery(doc, state) {
  const section = byId(doc, SPEND_PER_DELIVERY_SECTION_ID);
  if (!section || !state) return null;
  if (state.state === SPEND_PER_DELIVERY_STATE.absent) return clearSpendPerDelivery(doc);
  const store = held(section);
  // The disclosure the reader opened stays open across a repaint of the same
  // reading, and is closed for a different one: a panel left open would caption
  // the evidence of a window that is no longer on screen.
  const sameReading = store.model?.statement === state.statement
    && store.model?.provenance.source === state.provenance.source;
  if (!sameReading) store.detailOpen = false;
  store.model = state;

  const body = byId(doc, SPEND_PER_DELIVERY_BODY_ID);
  if (!body) return null;
  const detailOpen = store.detailOpen;
  const children = [element(doc, "p", "spd-answer", state.statement)];
  if (state.state === SPEND_PER_DELIVERY_STATE.eligible) {
    children.push(figureBlock(doc, state));
    children.push(comparisonBlock(doc, state));
  } else {
    // No figure and no baseline. The unit is still named, because a reader has to
    // know which comparison is being withheld.
    children.push(element(doc, "p", "spd-withheld",
      `No figure is published for ${state.metric.unit} in this state.`));
  }
  const confidence = element(doc, "p", "spd-confidence");
  confidence.dataset.level = state.confidence.level;
  confidence.append(shape(doc, CONFIDENCE_SHAPE[state.confidence.level] ?? "○○○"));
  confidence.append(element(doc, "span", "spd-confidence-level",
    `Confidence: ${state.confidence.level}`));
  confidence.append(element(doc, "span", "spd-confidence-basis", state.confidence.basis));
  children.push(confidence);
  children.push(element(doc, "p", "spd-framing", state.framing.statement));
  children.push(actionBlock(doc, state));
  const details = detailBlock(doc, state, detailOpen);
  details.addEventListener("toggle", () => {
    held(section).detailOpen = details.open;
  });
  children.push(details);
  body.replaceChildren(...children);

  section.hidden = false;
  section.dataset.state = state.state;
  section.dataset.origin = state.provenance.origin;
  if (state.reasonCode) section.dataset.reason = state.reasonCode;
  else delete section.dataset.reason;
  announce(doc, `${state.statement} Next: ${state.nextAction.text}`);
  return state;
}

/** Hand the section back: every slot this module wrote is emptied. */
export function clearSpendPerDelivery(doc) {
  const section = byId(doc, SPEND_PER_DELIVERY_SECTION_ID);
  if (!section) return null;
  const store = held(section);
  store.model = null;
  store.detailOpen = false;
  section.hidden = true;
  section.dataset.state = SPEND_PER_DELIVERY_STATE.absent;
  delete section.dataset.origin;
  delete section.dataset.reason;
  byId(doc, SPEND_PER_DELIVERY_BODY_ID)?.replaceChildren();
  const live = byId(doc, SPEND_PER_DELIVERY_LIVE_ID);
  if (live) live.textContent = "";
  return null;
}
