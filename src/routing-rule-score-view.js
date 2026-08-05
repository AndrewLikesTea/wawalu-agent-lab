// Paints the routing-rule score. It decides nothing: every verdict, threshold and
// figure below is read off `routing-rule-score.js` verbatim, including the
// threshold — a view that re-derives a boundary is a second place the rule can be
// got wrong.
//
// READING ORDER. The aggregate verdict first, at the numeral role, with the rule
// that produced it in text and the count it excluded named in the same sentence.
// Then one disclosure per rule. The aggregate and the status line are OUTSIDE
// every disclosure, because a real browser hides a closed disclosure's subtree
// from the accessibility tree and an executive verdict announced inside one is
// silently dropped.
//
// UNTRUSTED TEXT. Org unit and model names arrive from a downloaded policy and an
// imported export. They are written with `createElement` and `textContent` only —
// no markup string, no innerHTML — so a name carrying markup renders as the
// characters it is. Nothing here is passed to a judge or a model call.
//
// No new styles. Every class is one `routing-slate-view.js` already paints with.

import { formatUsd } from "./evolution.js";
import { CHIP_KINDS, renderChip } from "./import-status-chip.js";
import {
  ROUTING_RULE_SCORE_QUESTION, RULE_VERDICT, scoreRoutingRules, unitSeriesFromAnalysis,
} from "./routing-rule-score.js";

export const ROUTING_RULE_SCORE_SECTION_ID = "routing-rule-score";
export const ROUTING_RULE_SCORE_BODY_ID = "routing-rule-score-body";
export const ROUTING_RULE_SCORE_STATUS_ID = "routing-rule-score-status";

/**
 * One chip per verdict, in the vocabulary `import-status-chip.js` already ships.
 *
 * The shape is the page's declared circle ramp and it carries HOW MUCH OF THE
 * EXPECTED RETURN ARRIVED: ● all of it, ◐ part, ○ none. `not-enough-evidence`
 * draws no shape at all, because nothing was measured and a status mark beside it
 * would read as a measurement. Colour is the last carrier, never the only one.
 */
export const VERDICT_CHIPS = Object.freeze({
  [RULE_VERDICT.met]: Object.freeze({
    label: "Met", shape: "●", tone: "ok", kind: CHIP_KINDS.SIGNAL,
  }),
  [RULE_VERDICT.partiallyMet]: Object.freeze({
    label: "Partially met", shape: "◐", tone: "warn", kind: CHIP_KINDS.SIGNAL,
  }),
  [RULE_VERDICT.missed]: Object.freeze({
    label: "Missed", shape: "○", tone: "error", kind: CHIP_KINDS.SIGNAL,
  }),
  [RULE_VERDICT.notEnoughEvidence]: Object.freeze({
    label: "Not enough evidence", shape: "", tone: "neutral", kind: CHIP_KINDS.CLASSIFICATION,
  }),
});

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const verdictChip = (doc, verdict) =>
  renderChip(doc, { ...VERDICT_CHIPS[verdict], status: verdict, value: "" });

/** The one line every rule states without being opened. */
const summaryLine = (row) =>
  `${row.rank}. ${row.rule} → ${row.targetTier} tier · expected `
  + `${formatUsd(row.expectedSavings)}`;

/**
 * One rule's detail. Expected against observed, then the threshold the verdict
 * turned on — and for a rule with no evidence, the coverage that was absent, in
 * prose, instead of any figure at all.
 */
function ruleDisclosure(doc, row) {
  const detail = element(doc, "details", "completeness-detail");
  detail.dataset.rank = String(row.rank);
  detail.dataset.verdict = row.verdict;
  const summary = element(doc, "summary");
  summary.setAttribute("aria-expanded", "false");
  summary.append(doc.createTextNode(summaryLine(row)), verdictChip(doc, row.verdict));
  detail.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(detail.hasAttribute("open")));
  });
  const lines = [summary];
  if (row.verdict === RULE_VERDICT.notEnoughEvidence) {
    lines.push(element(doc, "p", "answer-figure-basis", row.missingCoverage));
  } else {
    lines.push(element(doc, "p", "answer-figure-basis",
      `Expected ${formatUsd(row.expectedSavings)}, observed `
      + `${formatUsd(row.observedSavings)}, in ${row.unit}.`));
    lines.push(element(doc, "p", "answer-figure-basis",
      `Threshold ${formatUsd(row.threshold)}. ${row.thresholdRule}`));
  }
  lines.push(element(doc, "p", "answer-figure-basis", `Basis: ${row.basis}`));
  detail.append(...lines);
  return detail;
}

/** The aggregate, at the numeral role, visible without any interaction. */
function aggregateFigure(doc, payload) {
  const figure = element(doc, "p", "answer-figure");
  figure.dataset.verdict = payload.aggregate;
  const row = doc.createElement("span");
  row.append(verdictChip(doc, payload.aggregate));
  figure.append(
    element(doc, "span", "answer-figure-label",
      `Routing rules scored over ${payload.priorPeriod} to ${payload.followUpPeriod}`),
    element(doc, "strong", "answer-figure-value", VERDICT_CHIPS[payload.aggregate].label),
    row,
    element(doc, "span", "answer-figure-basis",
      `${payload.scoredCount} of ${payload.rules.length} rules scored; `
      + `${payload.notEnoughEvidenceCount} excluded for want of evidence. `
      + payload.aggregateRule),
  );
  if (payload.registerNote) {
    figure.append(element(doc, "span", "answer-figure-basis", payload.registerNote));
  }
  return figure;
}

/** How the whole score stands, in one sentence, before any of it is read. */
export function routingRuleScoreStatus(payload) {
  if (!payload.available) return payload.reason;
  return `${payload.rules.length} routing rules on the ${payload.registerPeriod} analysis: `
    + `${payload.scoredCount} scored over ${payload.priorPeriod} to ${payload.followUpPeriod}, `
    + `${payload.notEnoughEvidenceCount} with not enough evidence.`;
}

/**
 * Paint the section.
 *
 * @param {Document} doc
 * @param {object|null} priorAnalysis the PRIOR period's envelope, whose routing
 *   rules are the ones being scored.
 * @param {{commitment?: object|null, followUpAnalysis?: object|null}} [options]
 *   the retained commitment, which supplies both periods, and the follow-up
 *   envelope the observed series is read from.
 * @returns the payload that was painted, so a caller can assert on it.
 */
export function applyRoutingRuleScore(doc, priorAnalysis,
  { commitment = null, followUpAnalysis = null } = {}) {
  const section = doc?.getElementById?.(ROUTING_RULE_SCORE_SECTION_ID);
  const body = doc?.getElementById?.(ROUTING_RULE_SCORE_BODY_ID);
  const status = doc?.getElementById?.(ROUTING_RULE_SCORE_STATUS_ID);
  // The window comes off the commitment, so the series is built for exactly the
  // two periods the score will be taken on and never for a third.
  const probe = scoreRoutingRules({ commitment });
  const payload = probe.priorPeriod === null ? probe : scoreRoutingRules({
    priorAnalysis,
    commitment,
    // The envelope's own period is handed in, so an import for a month this
    // commitment never covered is refused rather than scored.
    seriesPeriod: followUpAnalysis?.period ?? null,
    unitSeries: unitSeriesFromAnalysis(followUpAnalysis,
      { priorPeriod: probe.priorPeriod, followUpPeriod: probe.followUpPeriod }),
  });
  if (!section || !body) return payload;

  section.dataset.state = payload.available ? "ready" : "unavailable";
  section.dataset.verdict = payload.aggregate;
  section.dataset.scoredCount = String(payload.scoredCount);
  if (status) {
    status.dataset.state = section.dataset.state;
    status.textContent = routingRuleScoreStatus(payload);
  }
  if (!payload.available) {
    body.replaceChildren(element(doc, "p", "answer-figure-direction", payload.reason));
    return payload;
  }

  const list = element(doc, "ol", "action-list");
  for (const row of payload.rules) {
    const item = element(doc, "li");
    item.append(ruleDisclosure(doc, row));
    list.append(item);
  }
  body.replaceChildren(aggregateFigure(doc, payload), list);
  return payload;
}

export { ROUTING_RULE_SCORE_QUESTION };
