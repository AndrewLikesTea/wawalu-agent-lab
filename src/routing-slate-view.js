// Paints the routing slate. It decides nothing: every figure, label and sentence
// below is read off `routing-slate.js` verbatim.
//
// READING ORDER IS THE PRODUCT, and it is a descent, not a list: the status line
// (how many rules, and how many are proposals, shipped, or scored), then RANK 1
// at the numeral role, then the one next move, then rank 1's evidence behind a
// disclosure, then ranks 2..n at the list role, then the total under the column a
// reader can add, then the tie-break.
//
// The two loudest elements are therefore rank 1 and the action, and everything
// under them steps down. The total moved off the numeral role to make that true:
// the question asks which CHANGE to ship, so the change is the answer and the sum
// is the footing under it.
//
// WHAT STAYS OUTSIDE A DISCLOSURE: the status line (authored in evolution.html,
// a sibling of this body), rank 1, the action, the total, the tie-break, and
// every rule's summary with its lifecycle chip. A real browser hides a closed
// disclosure's subtree from the accessibility tree, so status text inside one is
// silently dropped; the harness models no layout and reads straight through,
// which is why this is a rule here rather than something a test catches.
//
// CHIPS ARE THE VOCABULARY import-status-chip.js ALREADY SHIPS. No second chip
// system: same element, same classes, same silhouette rule from the Claude
// Design foundations card — OUTLINE = a static classification, FILLED WASH = a
// live signal. A proposal is a classification; shipping and scoring are signals.
//
// No new styles — every class here already ships in evolution.css and styles.css.
// `createElement` and `textContent` only; no markup string, no innerHTML.

import { formatUsd } from "./evolution.js";
import { CHIP_KINDS, renderChip } from "./import-status-chip.js";
import {
  ROUTING_POLICY_CONTROL_LABEL, routingPolicyAvailability, routingPolicyDownloadedMessage,
} from "./routing-policy-document.js";
import {
  MODELLED_BASIS, NO_SCORE_YET, ROUTING_SLATE_NOTHING_LEFT, ROUTING_SLATE_QUESTION,
  ROUTING_SLATE_REASONS, ROUTING_SLATE_STATES, RULE_LIFECYCLE, routingSlate,
} from "./routing-slate.js";

export const ROUTING_SLATE_SECTION_ID = "routing-slate";
export const ROUTING_SLATE_BODY_ID = "routing-slate-body";
export const ROUTING_SLATE_STATUS_ID = "routing-slate-status";
export const ROUTING_POLICY_DOWNLOAD_ID = "routing-policy-download";

/**
 * One chip per lifecycle state. Four carriers, and colour is the last of them:
 *
 *   WORD       the whole meaning on its own, and the chip's accessible name.
 *   SILHOUETTE outline for the classification, filled wash for the two signals.
 *   SHAPE      the circle ramp declared at the top of evolution.css: ○ nothing
 *              measured · ◐ part · ● measured. Fill AREA is the channel that
 *              survives 11px and greyscale, which is what this chip has to work
 *              at on a phone.
 *   VALUE      only `scored` carries one, and it is a measured figure. A
 *              proposal showing a score-shaped number is the exact mistake the
 *              three states exist to prevent.
 *
 * `note` is what the visible word cannot hold, rendered visually hidden inside
 * the chip with the utility styles.css already ships.
 */
export const LIFECYCLE_CHIPS = Object.freeze({
  [RULE_LIFECYCLE.PROPOSED]: Object.freeze({
    label: "Proposed", shape: "○", tone: "neutral", kind: CHIP_KINDS.CLASSIFICATION,
    note: "a modelled ceiling; nothing has been shipped or measured for this rule",
  }),
  [RULE_LIFECYCLE.SHIPPED]: Object.freeze({
    label: "Shipped", shape: "◐", tone: "neutral", kind: CHIP_KINDS.SIGNAL,
    note: "committed in this browser; not scored yet",
  }),
  [RULE_LIFECYCLE.SCORED]: Object.freeze({
    label: "Scored", shape: "●", tone: "ok", kind: CHIP_KINDS.SIGNAL,
    note: "shipped, and this org unit's own measured change since",
  }),
});

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The measured change, in words rather than in a sign a reader has to decode.
 * "lower" and "higher" say which way it went; the magnitude is the unsigned
 * dollars, so a very large or a negative figure reads the same way.
 */
function scoreText(changeUsd) {
  if (!Number.isFinite(changeUsd)) return "";
  return `${formatUsd(Math.abs(changeUsd))} ${changeUsd > 0 ? "higher" : "lower"}`;
}

/** One lifecycle chip, in the shipped chip vocabulary, with its hidden note. */
function lifecycleChip(doc, rule) {
  const base = LIFECYCLE_CHIPS[rule.lifecycle] ?? LIFECYCLE_CHIPS[RULE_LIFECYCLE.PROPOSED];
  const value = rule.lifecycle === RULE_LIFECYCLE.SCORED
    ? scoreText(rule.observedChangeUsd) : "";
  const chip = renderChip(doc, { ...base, status: rule.lifecycle, value });
  const note = element(doc, "span", "visually-hidden", ` — ${base.note}.`);
  chip.append(note);
  return chip;
}

/** A grid row that holds a chip at its own width rather than stretching it. */
function chipRow(doc, rule) {
  const row = doc.createElement("span");
  row.dataset.lifecycle = rule.lifecycle;
  row.append(lifecycleChip(doc, rule));
  return row;
}

/** The one line every rule states without being opened. */
const summaryLine = (rule) =>
  `${rule.rank}. ${rule.source} → ${rule.targetTier} tier · `
  + `${formatUsd(rule.expectedMonthlyUsd)} a month`;

/**
 * One rule's evidence, behind a native disclosure. `aria-expanded` is mirrored
 * off the `toggle` event rather than asserted once at build time, so the state a
 * screen reader reads is the state the element is actually in.
 */
function ruleDisclosure(doc, rule) {
  const detail = element(doc, "details", "completeness-detail");
  detail.dataset.rank = String(rule.rank);
  detail.dataset.lifecycle = rule.lifecycle;
  const summary = element(doc, "summary");
  summary.setAttribute("aria-expanded", "false");
  summary.append(doc.createTextNode(summaryLine(rule)), lifecycleChip(doc, rule));
  detail.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(detail.hasAttribute("open")));
  });
  const basis = element(doc, "p", "answer-figure-basis",
    `${rule.basis}. Confidence: ${rule.confidence}.`);
  basis.dataset.basis = MODELLED_BASIS;
  const lines = [summary, element(doc, "p", "answer-figure-basis", rule.evidence), basis];
  if (rule.lifecycleReason) {
    lines.push(element(doc, "p", "answer-figure-basis", rule.lifecycleReason));
  }
  detail.append(...lines);
  return detail;
}

/** Rank 1, at the numeral role: the change to make, and what it is worth. */
function leadFigure(doc, rule) {
  const figure = element(doc, "p", "answer-figure");
  figure.dataset.rank = "1";
  figure.dataset.lifecycle = rule.lifecycle;
  const basis = element(doc, "span", "answer-figure-basis",
    `${rule.basis}. Confidence: ${rule.confidence}.`);
  basis.dataset.basis = MODELLED_BASIS;
  figure.append(
    element(doc, "span", "answer-figure-label",
      `Rank 1 · ${rule.source} → ${rule.targetTier} tier`),
    element(doc, "strong", "answer-figure-value",
      `${formatUsd(rule.expectedMonthlyUsd)} a month`),
    chipRow(doc, rule),
    basis,
  );
  return figure;
}

/** How the whole slate stands, in one sentence, before any of it is read. */
export function routingSlateStatus(slate) {
  if (slate.state === ROUTING_SLATE_STATES.LOADING) {
    return "Reading the analysis — the ranked routing rules below have not been recomputed yet.";
  }
  if (!slate.available) return slate.reason;
  const { proposed, shipped, scored } = slate.counts;
  return `${slate.rules.length} ranked routing rules: ${proposed} proposed, `
    + `${shipped} shipped, ${scored} scored. Rank 1 is ${slate.lead.source}.`;
}

/** The always-rendered status line, never inside a disclosure and never hidden. */
function paintStatus(doc, section, slate) {
  const status = doc.getElementById?.(ROUTING_SLATE_STATUS_ID);
  section.dataset.state = slate.state;
  section.setAttribute("aria-busy", String(slate.state === ROUTING_SLATE_STATES.LOADING));
  if (!status) return;
  status.dataset.state = slate.state;
  status.textContent = routingSlateStatus(slate);
}

/**
 * The download control's state, repainted on every paint of the section.
 *
 * WHEN THERE IS NOTHING TO EXPORT IT IS DISABLED, not hidden and not silently
 * inert: a control that vanishes tells a reader nothing, and one that downloads
 * a policy with no rules in it teaches them their gateway has nothing to fix.
 * The reason is the slate's own — the same sentence the status line above is
 * already showing — and it rides in the control's ACCESSIBLE NAME, appended
 * visually hidden, because a disabled control cannot be focused and a reason
 * parked in a `title` is a reason most readers never receive.
 *
 * The `disabled` attribute rather than the property, so the state a test reads
 * off the markup is the state the browser enforces.
 */
function paintDownloadControl(doc, slate) {
  const button = doc.getElementById?.(ROUTING_POLICY_DOWNLOAD_ID);
  if (!button) return;
  const { available, reason } = routingPolicyAvailability(slate);
  button.dataset.state = available ? "ready" : "unavailable";
  if (available) button.removeAttribute("disabled");
  else button.setAttribute("disabled", "");
  button.replaceChildren(doc.createTextNode(ROUTING_POLICY_CONTROL_LABEL));
  if (!available) {
    button.append(element(doc, "span", "visually-hidden", ` — unavailable. ${reason}`));
  }
}

/**
 * Say that the file went, in the region this section already announces through.
 * A second live region here would make every repaint of the slate speak twice,
 * which is the defect the authored status line exists to avoid.
 *
 * `data-state` is deliberately NOT touched: it describes the slate, and the
 * slate did not change because a reader downloaded it.
 */
export function announceRoutingPolicyDownload(doc, slate) {
  const status = doc?.getElementById?.(ROUTING_SLATE_STATUS_ID);
  const message = routingPolicyDownloadedMessage(slate);
  if (status) status.textContent = message;
  return message;
}

/**
 * The section, while a file is being read. The rules on screen are the ones the
 * previous envelope earned and they are left exactly as they were — relabelling
 * them now would caption figures that have not changed. Only the status line
 * moves, and it says so.
 */
export function markRoutingSlateLoading(doc) {
  const section = doc?.getElementById?.(ROUTING_SLATE_SECTION_ID);
  if (section) paintStatus(doc, section, { state: ROUTING_SLATE_STATES.LOADING, available: false });
}

/**
 * Paint the section from an analysis envelope.
 *
 * @param {Document} doc
 * @param {object|null} analysis The `local-finops` envelope, bundled or imported.
 * @param {{commitment?: object|null}} [options] The action this browser retained.
 * @returns the slate that was painted, so a caller can assert on it.
 */
export function applyRoutingSlate(doc, analysis, { commitment = null } = {}) {
  const section = doc?.getElementById?.(ROUTING_SLATE_SECTION_ID);
  const body = doc?.getElementById?.(ROUTING_SLATE_BODY_ID);
  const slate = routingSlate(analysis, { commitment });
  if (!section || !body) return slate;
  section.dataset.ruleCount = String(slate.rules.length);
  section.hidden = false;
  paintStatus(doc, section, slate);
  paintDownloadControl(doc, slate);

  if (!slate.available) {
    body.replaceChildren(element(doc, "p", "answer-figure-direction", slate.reason));
    return slate;
  }

  const totalBasis = element(doc, "span", "answer-figure-basis",
    `${slate.basis}. The sum of the ${slate.rules.length} ranked rules above`
    + `${slate.period ? `, over ${slate.period}` : ""}.`);
  totalBasis.dataset.basis = MODELLED_BASIS;
  const total = element(doc, "p", "answer-figure-basis");
  total.append(
    doc.createTextNode("Total expected monthly return: "),
    element(doc, "strong", null, formatUsd(slate.totalExpectedMonthlyUsd)),
    doc.createTextNode(". "),
    totalBasis,
  );

  const list = element(doc, "ol", "action-list");
  for (const rule of slate.rules.slice(1)) {
    const item = element(doc, "li");
    item.append(ruleDisclosure(doc, rule));
    list.append(item);
  }

  body.replaceChildren(
    leadFigure(doc, slate.lead),
    element(doc, "p", "answer-figure-direction",
      slate.nextAction ? `Do this first: ${slate.nextAction}` : ROUTING_SLATE_NOTHING_LEFT),
    ruleDisclosure(doc, slate.lead),
    list,
    total,
    element(doc, "p", "answer-figure-basis", slate.tieBreak),
  );
  return slate;
}

export { NO_SCORE_YET, ROUTING_SLATE_QUESTION, ROUTING_SLATE_REASONS, ROUTING_SLATE_STATES };
