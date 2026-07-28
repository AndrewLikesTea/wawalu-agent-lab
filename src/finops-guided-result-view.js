// Painting the guided-result composition.
//
// This module owns one decision and no others: where each slot the contract
// selected is written. It never selects a figure, never computes a ratio, and
// never decides whether a panel is support — `finops-guided-result.js` did all
// three, and a second opinion here is how two surfaces start disagreeing.
//
// Every node is created with createElement and filled with textContent. The
// site policy forbids executing user-generated markup and nothing here assigns
// any. No value written below can carry prompt text or a cell value: the
// contract's slots are counts, ratios, letters, and authored sentences.
//
// THE DEMOTION IS WRITTEN DOWN, NOT ONLY IMPLIED. Each support-only panel gets
// `data-panel-role="support"` and its declared `data-disclosure-rank`. That is
// what makes "these nine panels are progressive disclosure, not primary
// content" a fact a reader, a test, and a bug report can all check on one
// element, rather than a claim in a design document.

import { PRIMARY_PANEL_ID, TRUST_STATE } from "./finops-guided-result.js";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text ?? "";
  return node;
}

function setData(node, key, value) {
  if (!node) return;
  if (value === null || value === undefined) delete node.dataset[key];
  else node.dataset[key] = String(value);
}

/**
 * Keep the support panels behind the native disclosure that introduces them.
 *
 * The panels remain in their established DOM positions, preserving all of
 * their existing state and event handlers. The document-level state gives CSS
 * one reliable switch for panels that live in several different sections.
 */
function bindSupportDisclosure(doc) {
  const disclosure = byId(doc, "guided-result-support");
  const root = byId(doc, "guided-result");
  if (!disclosure || !root) return;
  const sync = () => {
    root.dataset.supportExpanded = String(Boolean(disclosure.open));
  };
  sync();
  if (disclosure.dataset.guidedResultBound === "true") return;
  disclosure.dataset.guidedResultBound = "true";
  disclosure.addEventListener("toggle", sync);
}

/**
 * Make a contract-named control an actual next step, while leaving actions that
 * happen outside this demo as text rather than manufacturing a dead button.
 */
function applyActionControl(doc, action) {
  const button = byId(doc, "guided-result-action-control");
  if (!button) return;
  const targetId = action?.available && action.actionable ? action.control : null;
  button.hidden = !targetId;
  setData(button, "target", targetId);
  button.onclick = targetId ? () => {
    const target = byId(doc, targetId);
    target?.focus?.({ preventScroll: true });
    target?.click?.();
  } : null;
}

/** The one word beside the composition that says how far it may be taken. */
export const READINESS_LABEL = Object.freeze({
  [TRUST_STATE.verified]: "Decision-ready · your import, attribution above the floor",
  [TRUST_STATE.belowFloor]: "Not decision-ready · attribution below the published floor",
  [TRUST_STATE.unmeasurable]: "Not decision-ready · no coverage percentage exists for this import",
  [TRUST_STATE.synthetic]: "Not decision-ready · bundled synthetic sample data",
});

const money = (value) => `${value.toFixed(2)} USD`;

/**
 * The benchmark line: the letter, the composite, and the record count behind
 * it — or the contract's own refusal, which names the one input that would
 * publish it.
 */
function benchmarkText(benchmark) {
  if (!benchmark) return { value: "—", detail: "No benchmark was composed." };
  if (!benchmark.available) {
    return {
      value: "Not graded",
      detail: `${benchmark.scoredRecords} of the ${benchmark.floor} scored records this benchmark `
        + `needs are in this dataset · ${benchmark.unavailable.need}`,
    };
  }
  return {
    value: `${benchmark.letter} · ${benchmark.value} / 100`,
    detail: `${benchmark.scoredRecords} of ${benchmark.sourceRecords} records scored`
      + (benchmark.confidenceLevel ? ` · ${benchmark.confidenceLevel} confidence` : "")
      + ` · ${benchmark.unit}`,
  };
}

/** The trust line. The percentage never ships without its floor beside it. */
function trustText(trust) {
  if (!trust) return "No trust verdict was composed.";
  if (trust.coveragePercent === null) return trust.answer ?? "No coverage percentage exists.";
  return `${trust.coveragePercent}% of ${money(trust.totalUsd ?? 0)} is attributed to a confirmed `
    + `org unit · published floor ${Math.round(trust.coverageFloor * 100)}%`;
}

/**
 * Write the composition.
 *
 * @returns the composition that was written, so a caller asserts on the state
 *   it asked for rather than on the DOM it got.
 */
export function applyGuidedResult(doc, result) {
  const root = byId(doc, "guided-result");
  if (!root || !result) return null;

  root.hidden = false;
  setData(root, "state", result.state);
  setData(root, "basis", result.basis);
  setData(root, "decisionReady", String(result.decisionReady));
  setData(root, "contractVersion", result.version);

  setText(doc, "guided-result-question", result.question);
  setText(doc, "guided-result-finding", result.primaryFinding);

  const readiness = setText(doc, "guided-result-readiness",
    READINESS_LABEL[result.trust?.state] ?? "Not decision-ready");
  setData(readiness, "ready", String(result.decisionReady));

  const benchmark = benchmarkText(result.benchmark);
  const benchmarkNode = setText(doc, "guided-result-benchmark", benchmark.value);
  setData(benchmarkNode, "available", String(Boolean(result.benchmark?.available)));
  setData(benchmarkNode, "unavailableReason", result.benchmark?.unavailable?.reason ?? null);
  setText(doc, "guided-result-benchmark-detail", benchmark.detail);

  const trustNode = setText(doc, "guided-result-trust", trustText(result.trust));
  setData(trustNode, "trustState", result.trust?.state ?? null);
  setData(trustNode, "satisfied", String(Boolean(result.trust?.satisfied)));

  const action = result.action;
  const actionNode = setText(doc, "guided-result-action",
    action?.available ? action.text : action?.unavailable?.need ?? "No action is prioritized.");
  setData(actionNode, "actionId", action?.available ? action.id : null);
  setData(actionNode, "actionRank", action?.available ? action.rank : null);
  setData(actionNode, "actionable", String(Boolean(action?.available && action.actionable)));
  setData(actionNode, "unavailableReason", action?.available ? null : action?.unavailable?.reason ?? null);

  const effect = action?.available && action.expectedEffect
    ? `${money(action.expectedEffect.value)} · ${action.expectedEffect.label}`
    : action?.available
      ? `Accountable role: ${action.accountableRole}`
      : "";
  setText(doc, "guided-result-action-effect",
    action?.available && action.expectedEffect
      ? `${effect} · accountable role: ${action.accountableRole}`
      : effect);
  applyActionControl(doc, action);

  renderDisclosureIndex(doc, result.disclosures ?? []);
  bindSupportDisclosure(doc);
  return result;
}

/**
 * The index of supporting disclosures, in declared rank order.
 *
 * A panel that cannot be computed is still listed, with the one input that
 * would answer it. Dropping it would tell a leader the question does not exist.
 */
export function renderDisclosureIndex(doc, disclosures) {
  const list = byId(doc, "guided-result-disclosures");
  if (!list) return null;
  list.replaceChildren();
  for (const entry of disclosures) {
    const item = element(doc, "li", "guided-disclosure");
    item.dataset.panelId = entry.panelId;
    item.dataset.rank = String(entry.rank);
    item.dataset.permitted = String(entry.permitted);
    const link = element(doc, "a", "guided-disclosure-question", entry.question);
    link.href = `#${entry.elementId}`;
    item.append(link);
    item.append(element(doc, "span", "guided-disclosure-note",
      entry.permitted ? "Open to check the finding above." : entry.unavailable.need));
    list.append(item);
  }
  return list;
}

/**
 * Stamp the declared role and disclosure rank onto the panels themselves.
 *
 * Called once per repaint alongside the panel contract's own painting. It adds
 * no visual state of its own: the rank is the reading order the index above
 * publishes, written where the panel is so the two can never disagree.
 */
export function applyDisclosureRoles(doc, disclosures) {
  const touched = [];
  const primary = byId(doc, "score-card");
  if (primary) {
    primary.dataset.panelRole = "primary";
    delete primary.dataset.disclosureRank;
    touched.push(primary);
  }
  for (const entry of disclosures) {
    const node = byId(doc, entry.elementId);
    if (!node) continue;
    node.dataset.panelRole = "support";
    node.dataset.disclosureRank = String(entry.rank);
    node.dataset.disclosurePermitted = String(entry.permitted);
    touched.push(node);
  }
  return touched;
}

/** The panel id the contract permits as primary content, re-exported for callers. */
export { PRIMARY_PANEL_ID };
