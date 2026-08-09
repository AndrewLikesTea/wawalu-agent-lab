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

export const GUIDED_VIEW_STATE = Object.freeze({
  loading: "loading", ready: "ready", empty: "empty", error: "error", extreme: "extreme",
});

const MAX_GUIDED_USD = 1_000_000_000_000;

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
  const details = el(doc, "details", "figure-source guided-support");
  details.append(el(doc, "summary", "figure-source-summary", summaryText), ...nodes);
  return details;
};

const labelled = (doc, className, label, value, shape = null, shapeRole = "status-shape") => {
  const node = el(doc, "p", className);
  if (shape) node.append(el(doc, "span", `${shapeRole} guided-shape`, shape));
  node.append(el(doc, "span", "guided-label", label), el(doc, "span", "guided-value", value));
  if (shape) node.firstChild.setAttribute("aria-hidden", "true");
  return node;
};

const stateMessage = (doc, state, { onRetry } = {}) => {
  const copy = {
    loading: ["Analysis pending", "Waiting for the page result", "The finding and action will appear here."],
    empty: ["No analysis", "No bundled scenarios are available.", "Choose a scenario when one becomes available."],
    error: ["Analysis error", "This scenario could not be analyzed.", "Try the analysis again. Nothing was uploaded."],
    extreme: ["Value withheld", "This result is outside the supported display range.",
      "Choose another scenario and verify the source figures before acting."],
  }[state];
  const message = el(doc, "div", "guided-state-message");
  message.append(
    labelled(doc, "guided-state-label", copy[0], copy[1], state === "error" ? "!" : "○"),
    el(doc, "p", "guided-state-remedy", copy[2]),
  );
  if (state === GUIDED_VIEW_STATE.error && onRetry) {
    const retry = el(doc, "button", "guided-retry", "Try analysis again");
    retry.setAttribute("type", "button");
    retry.addEventListener("click", onRetry);
    message.append(retry);
  }
  return message;
};

const implausible = (model) => {
  const amounts = [model?.department?.spend, model?.department?.recoverable]
    .map((value) => Number(String(value ?? "").replace(/[$,]/g, "")));
  return amounts.some((value) => !Number.isFinite(value) || value < 0 || value > MAX_GUIDED_USD);
};

/** Paint every non-successful state into the same region and reading position
 * as the result it replaces. This is also the error boundary used at mount. */
export function renderGuidedState(doc, state, options = {}) {
  const host = doc.getElementById(GUIDED_IDS.chooser);
  if (!host || !Object.values(GUIDED_VIEW_STATE).includes(state) || state === GUIDED_VIEW_STATE.ready) {
    return null;
  }
  host.dataset.state = state;
  host.setAttribute("aria-busy", state === GUIDED_VIEW_STATE.loading ? "true" : "false");
  // Paint into the result region when the chooser has been built, and over the
  // whole host only before it exists. A state whose remedy reads "choose another
  // scenario" must not be the state that deletes the control naming it — and a
  // select replaced here is a select whose change listener leaves with it.
  (doc.getElementById(GUIDED_IDS.summary) ?? host).replaceChildren(stateMessage(doc, state, options));
  for (const [bodyId, titleId, label] of [
    [GUIDED_IDS.evidenceBody, GUIDED_IDS.evidenceTitle, "Evidence"],
    [GUIDED_IDS.departmentBody, GUIDED_IDS.departmentTitle, "Department detail"],
  ]) {
    const body = doc.getElementById(bodyId);
    if (body) body.replaceChildren(stateMessage(doc, state));
    const title = doc.getElementById(titleId);
    if (title) title.textContent = `${label} · ${state === GUIDED_VIEW_STATE.loading ? "loading" : "unavailable"}`;
  }
  return host;
}

const destinationLink = (doc, scenarioId, destination, text) => {
  const link = el(doc, "a", "front-door-question", text);
  link.setAttribute("href", guidedScenarioAddress(scenarioId, destination));
  link.dataset.guidedDestination = destination === GUIDED_DESTINATION.evidence
    ? "evidence" : "department";
  return link;
};

/**
 * The chooser, and the EVIDENCE for the answer stated once above it (#1466).
 *
 * This surface used to publish a competing briefing: a finding in the largest
 * type role on the panel, a benchmark, confidence, provenance, and a second
 * "Prioritized next action" in a call-to-action treatment. Two headline savings
 * figures — a monthly recoverable here, an annual one in the canonical region —
 * is how a leader ends up quoting the wrong one. So the control stays, the
 * scenario is named, and everything that qualifies the answer is demoted into
 * the one disclosure, phrased as evidence rather than as a second instruction.
 */
export function renderGuidedChooser(doc, model) {
  const host = doc.getElementById(GUIDED_IDS.chooser);
  if (!host || !model) return null;
  if (implausible(model)) return renderGuidedState(doc, GUIDED_VIEW_STATE.extreme);
  host.dataset.state = GUIDED_VIEW_STATE.ready;
  host.setAttribute("aria-busy", "false");
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
    const summary = el(doc, "article", "guided-analysis");
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
    // Outside the disclosure: only what the CONTROL owes its reader — which
    // export is loaded, and where the answer for it is stated.
    el(doc, "p", "guided-lede", `${model.label} is loaded. The savings figure it`
      + " implies, how far to trust it, and the one action to take are stated once, in the"
      + " executive briefing above."),
    disclosure(doc, "Evidence behind this scenario", [
      rows(doc, [
        { term: "Primary finding", detail: model.answer },
        { term: "Material benchmark", detail: model.benchmark },
        { term: "Confidence", detail: model.confidence },
        { term: "Provenance", detail: model.provenance },
        { term: "Impact", detail: model.impact },
        { term: "Why this matters", detail: model.whyItMatters },
        // Stated as the record this scenario carries, not as an instruction: the
        // one thing a reader is asked to do is the briefing's action, above.
        {
          term: "Action this scenario carries",
          detail: `${model.action.text} ${model.action.team} is the department it falls to.`,
        },
        { term: "Why this action is ranked first", detail: model.action.reason },
        { term: "What this figure is not", detail: model.limitation },
        ...model.assumptions.map((text, index) => ({ term: `Assumption ${index + 1}`, detail: text })),
      ]),
    ]),
  );
  doc.getElementById(GUIDED_IDS.summary).append(
    destinationLink(doc, model.scenarioId, GUIDED_DESTINATION.evidence,
      `See the evidence behind ${model.label}`),
    destinationLink(doc, model.scenarioId, GUIDED_DESTINATION.department,
      `Open ${model.action.team}'s department detail`),
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
 *
 * `onScenario` is called with the id this flow settled on — null when nothing
 * could be analyzed. It is how the page's ONE canonical briefing follows the
 * chooser (#1466); without it the briefing keeps stating an answer for the
 * scenario the reader has already left, which is worse than stating none.
 */
export function applyGuidedScenario(
  doc, scenarioId, { announce = false, focus = null, onScenario = null } = {},
) {
  const model = guidedAnalysis(scenarioId);
  if (!model) {
    renderGuidedState(doc, GUIDED_VIEW_STATE.empty);
    onScenario?.(null);
    return null;
  }
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
  // Last, so the briefing is restated from a surface that has already settled.
  onScenario?.(model.scenarioId);
  return model;
}

/**
 * Mount the flow: paint it from the address, then keep the address and the
 * surfaces in step as the reader chooses.
 */
export function installGuidedFirstAnalysis(
  doc, { location = null, history = null, onScenario = null } = {},
) {
  const address = `${location?.search ?? ""}`;
  const fragment = `${location?.hash ?? ""}`;
  const chosen = guidedScenarioFromAddress(address);
  const named = chosen !== DEFAULT_GUIDED_SCENARIO || address.includes("scenario=");
  // A guided deep link is the one open that moves the keyboard: the reader asked
  // for THIS scenario in THIS destination, so that is where they are put.
  const landing = !named ? null
    : fragment === GUIDED_DESTINATION.evidence ? "evidence"
      : fragment === GUIDED_DESTINATION.department ? "department" : null;
  const retry = () => installGuidedFirstAnalysis(doc, { location, history, onScenario });
  renderGuidedState(doc, GUIDED_VIEW_STATE.loading);
  let model = null;
  try {
    model = applyGuidedScenario(doc, chosen, { focus: landing, onScenario });
  } catch {
    renderGuidedState(doc, GUIDED_VIEW_STATE.error, { onRetry: retry });
    // The briefing above must not be left mid-paint in its authored loading
    // state when nothing is coming: it is told there is no analysis.
    onScenario?.(null);
  }
  const select = doc.getElementById(GUIDED_IDS.select);
  select?.addEventListener("change", (event) => {
    const next = event?.target?.value ?? select.value;
    const applied = applyGuidedScenario(doc, next, { announce: true, onScenario });
    if (!applied) return;
    // The address follows the choice rather than the other way round, and it is
    // a replacement: choosing again is refining one question, not a step back
    // through every scenario the reader tried.
    history?.replaceState?.({}, "", `${guidedScenarioAddress(applied.scenarioId)}${fragment}`);
  });
  return model;
}
