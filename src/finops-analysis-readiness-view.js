// Paints the first-analysis decision. It decides nothing, ranks nothing and
// formats no figure of its own: finops-first-analysis-decision.js chose the
// words, the order and the cues, and the money text is the one the shared
// next-step record already publishes, so the two regions that name this action
// cannot drift apart in a decimal.
//
// IT ADDS NO RULE TO ANY STYLESHEET. Every class it applies already ships in
// evolution.css or styles.css — `.import-chip` with its `signal`/
// `classification` silhouettes for the cues (the Claude Design foundations
// rule: filled wash = dynamic signal, outline = static classification),
// `.stand-figure-value` for the lead figure and its `data-available="false"`
// degraded step, `.figure-source-detail` for the working.
//
// IT ADDS NO TAB STOP. The only focusable nodes in this region are the two
// native disclosure summaries the document itself authors: /evolution.html's
// first screen has no spare tab stop above the first-run region, and a second
// copy of the page's one action control would take one.
import { DECISION_STATE, firstAnalysisDecision } from "./finops-first-analysis-decision.js";

const set = (doc, id, value) => {
  const node = doc.getElementById(id);
  if (node) node.textContent = value;
  return node;
};

/** One cue chip: a shape, a word, and a value. The tone is the last carrier. */
function chipNode(doc, cue) {
  const chip = doc.createElement("span");
  chip.className = "import-chip";
  chip.id = cue.id;
  chip.dataset.kind = cue.kind;
  chip.dataset.tone = cue.tone;
  const shape = doc.createElement("span");
  shape.className = "import-chip-shape";
  shape.setAttribute("aria-hidden", "true");
  shape.textContent = cue.shape;
  const label = doc.createElement("span");
  label.textContent = ` ${cue.label} `;
  const value = doc.createElement("span");
  value.className = "import-chip-value";
  value.textContent = cue.value;
  chip.append(shape, label, value);
  return chip;
}

/**
 * Paint one decision record, or shape one from whatever the page has.
 *
 * `outcome` may be the bundled-scenario envelope, a bare readiness model, or a
 * record this module's own presenter already produced.
 */
export function renderAnalysisReadiness(doc, outcome, options = {}) {
  const region = doc.getElementById("finops-analysis-readiness");
  if (!region) return null;
  const view = outcome?.contract === "finops-first-analysis-decision/1.0.0"
    ? outcome
    : firstAnalysisDecision(outcome, options);

  region.dataset.state = view.state;
  region.dataset.level = view.level;

  // 1 — scenario, 2 — the one finding, 3 — the cues, 4 — the action. The DOM
  // order is authored in evolution.html and asserted against DECISION_ORDER;
  // nothing here moves a node.
  set(doc, "analysis-readiness-scenario", view.scenario);
  const value = set(doc, "analysis-readiness-finding-value", view.finding.value);
  if (value) value.dataset.available = view.finding.available ? "true" : "false";
  set(doc, "analysis-readiness-finding-label", view.finding.label);
  set(doc, "analysis-readiness-verdict", view.finding.basis);

  const cues = doc.getElementById("analysis-readiness-cues");
  if (cues) cues.replaceChildren(...view.cues.map((cue) => chipNode(doc, cue)));

  set(doc, "analysis-readiness-action", view.action.text);
  set(doc, "analysis-readiness-act-label", view.action.label);
  set(doc, "analysis-readiness-act-basis", view.action.basis);
  set(doc, "analysis-readiness-limit", view.limitation);

  // THE STATUS STAYS OUTSIDE BOTH DISCLOSURES. A live region folded into a shut
  // `details` is announced by nothing in a real browser, however readable the
  // test harness finds it.
  set(doc, "analysis-readiness-live", view.status);

  // 5 — the working, one press down.
  set(doc, "analysis-readiness-value", view.detail.figure);
  set(doc, "analysis-readiness-action-confidence", view.detail.actionConfidence);
  set(doc, "analysis-readiness-reason", view.detail.reason);
  set(doc, "analysis-readiness-provenance", view.detail.provenance);
  set(doc, "analysis-readiness-confidence", view.detail.evidenceConfidence);
  set(doc, "analysis-readiness-evidence", view.detail.evidenceHeld);
  const list = doc.getElementById("analysis-readiness-upgrades");
  if (list) list.replaceChildren(...view.supporting.map((line) => {
    const item = doc.createElement("li");
    item.textContent = line;
    return item;
  }));
  return region;
}

export { DECISION_STATE };
