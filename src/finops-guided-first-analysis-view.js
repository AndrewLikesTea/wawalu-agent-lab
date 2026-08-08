// The guided first analysis on the page: the chooser, and the two destinations
// the choice actually changes.
//
// ONE SOURCE OF TRUTH, AND IT IS NOT THE DOM. `selected` below is the chosen
// scenario id. Every surface is painted from `guidedAnalysis(selected)`, and the
// only way it moves is `applyGuidedScenario`, which also writes it into the
// address. Nothing here reads a marker back off a node to decide what to draw —
// that is exactly how a chooser ends up marking its choice and changing nothing.
//
// The evidence panel and the department panel are ordinary workspace regions, so
// the shell shows them for `#workspace-evidence` and `#workspace-departments`;
// the address a link carries is `?scenario=<id>#workspace-…`, which makes the
// deep link real rather than cosmetic — an open of that address paints that
// scenario in that destination without a press.
import {
  DEFAULT_GUIDED_SCENARIO, GUIDED_DESTINATION, GUIDED_SCENARIOS, GUIDED_SYNTHETIC_NOTICE,
  guidedAnalysis, guidedScenarioAddress, guidedScenarioFromAddress,
} from "./finops-guided-first-analysis.js";

export const GUIDED_IDS = Object.freeze({
  choice: "finops-guided-choice", chooser: "finops-guided-chooser",
  select: "finops-guided-select", summary: "finops-guided-summary",
  live: "finops-guided-live",
  evidence: "finops-guided-evidence", evidenceTitle: "finops-guided-evidence-title",
  evidenceBody: "finops-guided-evidence-body",
  department: "finops-guided-department", departmentTitle: "finops-guided-department-title",
  departmentBody: "finops-guided-department-body",
});

let selected = DEFAULT_GUIDED_SCENARIO;

/** The one selected scenario id. Exported for the page, not for a re-render. */
export const selectedGuidedScenario = () => selected;

const el = (doc, tagName, className, text) => {
  const node = doc.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const line = (doc, className, label, text) => {
  const node = el(doc, "p", className);
  const name = el(doc, "span", "visually-hidden", `${label}: `);
  node.append(name, doc.createTextNode(text));
  return node;
};

const rows = (doc, entries) => {
  const list = el(doc, "dl", "figure-source-detail");
  for (const entry of entries) {
    const pair = el(doc, "div");
    pair.append(el(doc, "dt", null, entry.term), el(doc, "dd", null, entry.detail));
    list.append(pair);
  }
  return list;
};

const disclosure = (doc, summaryText, nodes) => {
  const details = el(doc, "details", "figure-source");
  details.append(el(doc, "summary", "figure-source-summary", summaryText), ...nodes);
  return details;
};

const destinationLink = (doc, scenarioId, destination, text) => {
  const link = el(doc, "a", "front-door-question", text);
  link.setAttribute("href", guidedScenarioAddress(scenarioId, destination));
  link.dataset.guidedDestination = destination === GUIDED_DESTINATION.evidence
    ? "evidence" : "department";
  return link;
};

/**
 * The chooser and the primary surface: the question is authored above it, and
 * this paints the answer, the one benchmark, confidence, provenance, impact,
 * why it matters and the one action — all at a glance, with the second-order
 * calculations behind the one disclosure.
 */
export function renderGuidedChooser(doc, model) {
  const host = doc.getElementById(GUIDED_IDS.chooser);
  if (!host || !model) return null;
  // The control is built once and then kept: a select replaced on every repaint
  // is a control whose listener, and whose keyboard focus, quietly go with the
  // node it used to be.
  if (!doc.getElementById(GUIDED_IDS.select)) {
    // `eyebrow` is the page's existing small-label treatment: a visible, real
    // label costs no new rule in a stylesheet with no room for one.
    const label = el(doc, "label", "eyebrow", "Bundled provider export to analyze");
    label.setAttribute("for", GUIDED_IDS.select);
    const control = doc.createElement("select");
    control.setAttribute("id", GUIDED_IDS.select);
    control.setAttribute("name", "scenario");
    for (const scenario of GUIDED_SCENARIOS) {
      const option = el(doc, "option", null, scenario.label);
      option.setAttribute("value", scenario.id);
      control.append(option);
    }
    const summary = doc.createElement("div");
    summary.setAttribute("id", GUIDED_IDS.summary);
    host.replaceChildren(label, control, summary);
  }
  const select = doc.getElementById(GUIDED_IDS.select);
  select.value = model.scenarioId;
  for (const option of select.querySelectorAll("option")) {
    if (option.getAttribute("value") === model.scenarioId) option.setAttribute("selected", "selected");
    else option.removeAttribute("selected");
  }
  doc.getElementById(GUIDED_IDS.summary).replaceChildren(
    el(doc, "p", "stand-answer", model.answer),
    el(doc, "p", "stand-figure", model.benchmark),
    line(doc, "stand-answer", "Impact", model.impact),
    line(doc, "stand-answer", "Why this matters", model.whyItMatters),
    line(doc, "stand-answer", "Confidence", model.confidence),
    line(doc, "stand-answer", "Provenance", model.provenance),
    el(doc, "p", "stand-answer", `Do this first: ${model.action.text}`
      + ` ${model.action.team} is the team that should take it.`),
    disclosure(doc, "How this was calculated", [
      rows(doc, [
        { term: "Why this action is ranked first", detail: model.action.reason },
        { term: "What this figure is not", detail: model.limitation },
        ...model.assumptions.map((text, index) => ({ term: `Assumption ${index + 1}`, detail: text })),
      ]),
    ]),
    destinationLink(doc, model.scenarioId, GUIDED_DESTINATION.evidence,
      `See the evidence behind ${model.label}`),
    destinationLink(doc, model.scenarioId, GUIDED_DESTINATION.department,
      `See ${model.action.team}'s department detail`),
  );
  return host;
}

/** The evidence destination, for the chosen scenario and no other. */
export function renderGuidedEvidence(doc, model) {
  const host = doc.getElementById(GUIDED_IDS.evidenceBody);
  const title = doc.getElementById(GUIDED_IDS.evidenceTitle);
  if (!host || !model) return null;
  if (title) title.textContent = `Evidence · ${model.label}`;
  host.replaceChildren(
    el(doc, "p", "stand-answer", model.answer),
    el(doc, "p", "stand-figure", model.benchmark),
    line(doc, "stand-answer", "Provenance", model.provenance),
    line(doc, "stand-answer", "Confidence", model.confidence),
    el(doc, "p", "sample-marker", GUIDED_SYNTHETIC_NOTICE),
    rows(doc, model.evidenceRows),
  );
  return host;
}

/** The department destination: the department this scenario carries, and the
 * one action that department is being asked to take. */
export function renderGuidedDepartment(doc, model) {
  const host = doc.getElementById(GUIDED_IDS.departmentBody);
  const title = doc.getElementById(GUIDED_IDS.departmentTitle);
  if (!host || !model) return null;
  if (title) title.textContent = `Department detail · ${model.department.name}`;
  host.replaceChildren(
    el(doc, "p", "stand-answer", `${model.department.name} is the one department in`
      + ` ${model.label}, and the team that acts first.`),
    el(doc, "p", "stand-figure", `${model.department.recoverable} recoverable of`
      + ` ${model.department.spend} analyzed — ${model.department.share} of its modelled spend.`),
    line(doc, "stand-answer", "Prioritized action",
      `${model.action.text} Owner: ${model.action.team}.`),
    line(doc, "stand-answer", "Provenance", model.provenance),
    rows(doc, [
      { term: "Analyzed spend", detail: `${model.department.spend} in the fixture period.` },
      { term: "Query volume", detail: `${model.department.queries} queries.` },
      { term: "Modelled recoverable", detail: model.department.recoverable },
    ]),
    disclosure(doc, "Assumptions behind this department view",
      [rows(doc, model.assumptions.map((text, index) => ({ term: `Assumption ${index + 1}`, detail: text })))]),
  );
  return host;
}

/**
 * Move the flow to `scenarioId` and repaint every surface from it.
 *
 * `announce` is what a screen reader hears — silent on the first paint, because
 * a status that speaks on a cold open is a status a reader learns to ignore.
 * `focus` is used when a destination view swaps in under the reader, so the
 * keyboard lands in what just changed rather than where the old view was.
 */
export function applyGuidedScenario(doc, scenarioId, { announce = false, focus = null } = {}) {
  const model = guidedAnalysis(scenarioId);
  if (!model) return null;
  selected = model.scenarioId;
  const choice = doc.getElementById(GUIDED_IDS.choice);
  if (choice) choice.dataset.guidedScenario = model.scenarioId;
  renderGuidedChooser(doc, model);
  renderGuidedEvidence(doc, model);
  renderGuidedDepartment(doc, model);
  for (const [id, key] of [[GUIDED_IDS.evidence, "evidence"], [GUIDED_IDS.department, "department"]]) {
    const region = doc.getElementById(id);
    if (region) region.dataset.guidedScenario = model.scenarioId;
    if (focus === key) doc.getElementById(`${id}-title`)?.focus();
  }
  const live = doc.getElementById(GUIDED_IDS.live);
  if (live) live.textContent = announce ? model.announcement : "";
  return model;
}

/**
 * Mount the flow: paint it from the address, then keep the address and the
 * surfaces in step as the reader chooses.
 */
export function installGuidedFirstAnalysis(doc, { location = null, history = null } = {}) {
  const address = `${location?.search ?? ""}`;
  const fragment = `${location?.hash ?? ""}`;
  const chosen = guidedScenarioFromAddress(address);
  const named = chosen !== DEFAULT_GUIDED_SCENARIO || address.includes("scenario=");
  // A guided deep link is the one open that moves the keyboard: the reader asked
  // for THIS scenario in THIS destination, so that is where they are put.
  const landing = !named ? null
    : fragment === GUIDED_DESTINATION.evidence ? "evidence"
      : fragment === GUIDED_DESTINATION.department ? "department" : null;
  const model = applyGuidedScenario(doc, chosen, { focus: landing });
  const select = doc.getElementById(GUIDED_IDS.select);
  select?.addEventListener("change", (event) => {
    const next = event?.target?.value ?? select.value;
    const applied = applyGuidedScenario(doc, next, { announce: true });
    if (!applied) return;
    // The address follows the choice rather than the other way round, and it is
    // a replacement: choosing again is refining one question, not a step back
    // through every scenario the reader tried.
    history?.replaceState?.({}, "", `${guidedScenarioAddress(applied.scenarioId)}${fragment}`);
  });
  return model;
}
