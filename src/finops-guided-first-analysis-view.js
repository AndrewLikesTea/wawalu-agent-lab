// The guided first analysis on the page: the chooser, and the two destinations
// the choice actually changes.
//
// ONE SOURCE OF TRUTH, AND IT IS NOT THE DOM. `selected` is the chosen id, every
// surface is painted from `guidedAnalysis(selected)`, and the only way it moves
// is `applyGuidedScenario`, which also writes it into the address.
//
import {
  DEFAULT_GUIDED_SCENARIO, GUIDED_DESTINATION, GUIDED_SCENARIOS, GUIDED_STATE,
  GUIDED_STATE_COPY, GUIDED_SYNTHETIC_NOTICE,
  guidedAnalysis, guidedScenarioAddress, guidedScenarioFromAddress,
} from "./finops-guided-first-analysis.js";

export const GUIDED_IDS = Object.freeze({
  choice: "finops-guided-choice", chooser: "finops-guided-chooser",
  select: "finops-guided-select", summary: "finops-guided-summary",
  live: "finops-guided-live",
  scenarioTitle: "finops-guided-scenario-title", chosen: "finops-guided-chosen",
  findingTitle: "finops-guided-finding-title", groundsTitle: "finops-guided-grounds-title",
  actionTitle: "finops-guided-action-title", action: "finops-guided-action",
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

const screen = (doc, id, title, nodes) => {
  const region = el(doc, "div", "workspace-screen");
  const heading = el(doc, "h3", "workspace-screen-title", title);
  heading.setAttribute("id", id);
  region.append(heading, ...nodes);
  return region;
};

const rows = (doc, entries, className = "next-step-trust") => {
  const list = el(doc, "dl", className);
  for (const entry of entries) {
    list.append(el(doc, "dt", "next-step-term", entry.term),
      el(doc, "dd", "next-step-detail", entry.detail));
  }
  return list;
};

const chip = (doc, { state, shape, label }) => {
  const node = el(doc, "span", "confidence-chip");
  node.dataset.confidence = state;
  const glyph = el(doc, "span", "confidence-chip-shape", shape);
  glyph.setAttribute("aria-hidden", "true");
  node.append(glyph, el(doc, "span", "confidence-chip-label", label));
  return node;
};

const disclosure = (doc, summaryText, nodes) => {
  const details = el(doc, "details", "first-run-method");
  const summary = el(doc, "summary");
  const state = el(doc, "span", "first-run-method-state");
  state.dataset.disclosure = "collapsed";
  const glyph = el(doc, "span", "first-run-method-shape", "▸");
  glyph.setAttribute("aria-hidden", "true");
  const word = el(doc, "span", null, "collapsed");
  state.append(glyph, word);
  summary.append(doc.createTextNode(`${summaryText} `), state);
  details.append(summary, ...nodes);
  details.addEventListener("toggle", () => {
    const open = details.hasAttribute("open");
    state.dataset.disclosure = open ? "expanded" : "collapsed";
    glyph.textContent = open ? "▾" : "▸";
    word.textContent = open ? "expanded" : "collapsed";
  });
  return details;
};

const link = (doc, className, scenarioId, destination, text) => {
  const node = el(doc, "a", className, text);
  node.setAttribute("href", guidedScenarioAddress(scenarioId, destination));
  node.dataset.guidedDestination = destination === GUIDED_DESTINATION.evidence
    ? "evidence" : "department";
  return node;
};

const CLIP_AT = 34;
function clipped(doc, node, text) {
  if (text.length <= CLIP_AT) {
    node.textContent = text;
    return node;
  }
  const shown = el(doc, "span", null, `${text.slice(0, CLIP_AT - 1)}…`);
  shown.setAttribute("aria-hidden", "true");
  node.append(shown, el(doc, "span", "visually-hidden", text));
  return node;
}

export function guidedStateBanner(doc, state, detail = null) {
  const copy = GUIDED_STATE_COPY[state];
  if (!copy) return null;
  const banner = el(doc, "div", "finops-load-state");
  banner.dataset.state = state === GUIDED_STATE.empty ? "loading" : state;
  banner.dataset.guidedState = state;
  const body = el(doc, "div");
  const eyebrow = el(doc, "p", "eyebrow");
  const glyph = el(doc, "span", "finops-load-shape", copy.shape);
  glyph.setAttribute("aria-hidden", "true");
  eyebrow.append(glyph, el(doc, "span", null, copy.eyebrow));
  body.append(eyebrow, el(doc, "strong", null, copy.title),
    el(doc, "span", null, detail ?? copy.detail));
  banner.append(body);
  return banner;
}

function chooserScaffold(doc, host) {
  if (doc.getElementById(GUIDED_IDS.select)) return;
  const heading = el(doc, "h3", "workspace-screen-title", "1. Chosen provider export");
  heading.setAttribute("id", GUIDED_IDS.scenarioTitle);
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
  const chosen = el(doc, "div");
  chosen.setAttribute("id", GUIDED_IDS.chosen);
  const summary = doc.createElement("div");
  summary.setAttribute("id", GUIDED_IDS.summary);
  host.replaceChildren(heading, label, control, chosen, summary);
}

/** The chooser and the primary surface: the question is authored above it, and
 * this paints the four regions in reading order. A null model is not a blank
 * page — `state` selects which authored screen is drawn in place of regions 2–4,
 * and the control above stays put so the reader can choose their way out. */
export function renderGuidedChooser(doc, model, state = GUIDED_STATE.ready) {
  const host = doc.getElementById(GUIDED_IDS.chooser);
  if (!host) return null;
  chooserScaffold(doc, host);
  const chosen = doc.getElementById(GUIDED_IDS.chosen);
  const summary = doc.getElementById(GUIDED_IDS.summary);
  if (!model) {
    chosen.replaceChildren();
    summary.replaceChildren(guidedStateBanner(doc, state) ?? el(doc, "div"));
    return host;
  }
  const select = doc.getElementById(GUIDED_IDS.select);
  select.value = model.scenarioId;
  for (const option of select.querySelectorAll("option")) {
    if (option.getAttribute("value") === model.scenarioId) option.setAttribute("selected", "selected");
    else option.removeAttribute("selected");
  }
  // Region 1 finishes here: what was chosen, and the shape it stands for.
  chosen.replaceChildren(
    el(doc, "p", "workspace-screen-question", model.label),
    el(doc, "p", "next-step-term", model.shape),
  );

  const band = model.confidenceBand;
  const action = el(doc, "div", "next-step");
  action.setAttribute("id", GUIDED_IDS.action);
  // Below the floor the card takes the page's low variant — dashed edge, warn
  // wash — and says so in words, so the tint never carries it alone.
  action.dataset.confidence = model.material && band.band !== "low" ? "ranked" : "low";
  const head = el(doc, "div", "next-step-head");
  const actionHeading = el(doc, "h3", null, model.action.text);
  actionHeading.setAttribute("id", GUIDED_IDS.actionTitle);
  head.append(el(doc, "p", "eyebrow", "Do this first:"), actionHeading);
  action.append(head, el(doc, "p", "next-step-headline",
    `${model.action.team} is the team that should take it.`));
  if (!model.material) {
    const caveat = el(doc, "div", "next-step-unknowns");
    caveat.append(el(doc, "p", "next-step-unknowns-title", "Below the materiality floor"),
      el(doc, "p", "next-step-detail", model.whyItMatters));
    action.append(caveat);
  }
  action.append(clipped(doc,
    link(doc, "next-step-primary", model.scenarioId, GUIDED_DESTINATION.department, ""),
    `See ${model.action.team}'s department detail`));

  // The region's own first line: the two cues that qualify everything under it,
  // each stating its level in words before any fill is read.
  const cues = el(doc, "p", "stand-entitlement");
  cues.append(
    chip(doc, { state: band.state, shape: band.shape, label: `evidence · ${band.label}` }),
    chip(doc, { state: "full", shape: "◆", label: "provenance · bundled synthetic" }),
  );

  summary.replaceChildren(
    screen(doc, GUIDED_IDS.findingTitle, "2. Primary finding", [
      el(doc, "p", "next-step-headline", model.answer),
      el(doc, "p", "next-step-detail", model.benchmark),
      el(doc, "p", "next-step-detail", model.impact),
      el(doc, "p", "next-step-detail", model.departmentScope),
    ]),
    screen(doc, GUIDED_IDS.groundsTitle, "3. Confidence and provenance", [
      cues,
      rows(doc, [
        { term: "Confidence", detail: model.confidence },
        { term: "Provenance", detail: model.provenance },
        { term: "Why this matters", detail: model.whyItMatters },
        { term: "What this figure is not", detail: model.limitation },
      ]),
      disclosure(doc, "Show the assumptions behind this estimate", [
        rows(doc, [
          { term: "Why this action is ranked first", detail: model.action.reason },
          ...model.assumptions.map((text, index) => ({ term: `Assumption ${index + 1}`, detail: text })),
        ], "next-step-facts"),
      ]),
      link(doc, "answer-door", model.scenarioId, GUIDED_DESTINATION.evidence,
        `See the evidence behind ${model.label}`),
    ]),
    action,
  );
  return host;
}

/** The evidence destination, for the chosen scenario and no other. */
export function renderGuidedEvidence(doc, model, state = GUIDED_STATE.ready) {
  const host = doc.getElementById(GUIDED_IDS.evidenceBody);
  const title = doc.getElementById(GUIDED_IDS.evidenceTitle);
  if (!host) return null;
  if (!model) {
    if (title) title.textContent = "Evidence · no scenario";
    host.replaceChildren(guidedStateBanner(doc, state,
      "This panel shows the records the chosen export was computed from.")
      ?? el(doc, "div"));
    return host;
  }
  if (title) title.textContent = `Evidence · ${model.label}`;
  const band = model.confidenceBand;
  const chips = el(doc, "p", "stand-entitlement");
  chips.append(chip(doc, { state: band.state, shape: band.shape, label: `evidence · ${band.label}` }));
  host.replaceChildren(
    el(doc, "p", "next-step-headline", model.answer),
    el(doc, "p", "next-step-detail", model.benchmark),
    chips,
    rows(doc, [
      { term: "Provenance", detail: model.provenance },
      { term: "Confidence", detail: model.confidence },
    ]),
    el(doc, "p", "sample-marker", GUIDED_SYNTHETIC_NOTICE),
    rows(doc, model.evidenceRows, "next-step-facts"),
  );
  return host;
}

/** The department destination: the department this scenario carries, and the
 * one action that department is being asked to take. */
export function renderGuidedDepartment(doc, model, state = GUIDED_STATE.ready) {
  const host = doc.getElementById(GUIDED_IDS.departmentBody);
  const title = doc.getElementById(GUIDED_IDS.departmentTitle);
  if (!host) return null;
  if (!model) {
    if (title) title.textContent = "Department detail · no scenario";
    host.replaceChildren(guidedStateBanner(doc, state,
      "This panel shows the department the chosen export names, and its action.")
      ?? el(doc, "div"));
    return host;
  }
  if (title) title.textContent = `Department detail · ${model.department.name}`;
  host.replaceChildren(
    el(doc, "p", "next-step-headline", model.departmentScope),
    el(doc, "p", "next-step-detail", `${model.department.recoverable} recoverable of`
      + ` ${model.department.spend} analyzed — ${model.department.share} of its modelled spend.`),
    rows(doc, [
      { term: "Prioritized action", detail: `${model.action.text} Owner: ${model.action.team}.` },
      { term: "Provenance", detail: model.provenance },
      { term: "Analyzed spend", detail: `${model.department.spend} in the fixture period.` },
      { term: "Query volume", detail: `${model.department.queries} queries.` },
      { term: "Modelled recoverable", detail: model.department.recoverable },
    ]),
    disclosure(doc, "Show the assumptions behind this department view",
      [rows(doc, model.assumptions.map((text, index) => ({
        term: `Assumption ${index + 1}`, detail: text,
      })), "next-step-facts")]),
  );
  return host;
}

/** Move the flow to `scenarioId` and repaint every surface from it. A null id is
 * the empty state and an unregistered id is the error state; neither is a blank
 * panel. `announce` is what a screen reader hears — silent on the first paint,
 * because a status that speaks on a cold open is one a reader learns to ignore.
 * `focus` puts the keyboard in a destination that swapped in under the reader. */
export function applyGuidedScenario(doc, scenarioId, { announce = false, focus = null } = {}) {
  const wanted = typeof scenarioId === "string" && scenarioId.length > 0;
  const model = wanted ? guidedAnalysis(scenarioId) : null;
  const state = model ? GUIDED_STATE.ready
    : wanted ? GUIDED_STATE.error : GUIDED_STATE.empty;
  if (model) selected = model.scenarioId;
  const choice = doc.getElementById(GUIDED_IDS.choice);
  if (choice) {
    if (model) choice.dataset.guidedScenario = model.scenarioId;
    choice.dataset.guidedState = state;
  }
  renderGuidedChooser(doc, model, state);
  renderGuidedEvidence(doc, model, state);
  renderGuidedDepartment(doc, model, state);
  for (const [id, key] of [[GUIDED_IDS.evidence, "evidence"], [GUIDED_IDS.department, "department"]]) {
    const region = doc.getElementById(id);
    if (region) {
      if (model) region.dataset.guidedScenario = model.scenarioId;
      region.dataset.guidedState = state;
    }
    if (focus === key) doc.getElementById(`${id}-title`)?.focus();
  }
  const live = doc.getElementById(GUIDED_IDS.live);
  if (live) {
    live.textContent = !announce ? ""
      : model ? model.announcement : GUIDED_STATE_COPY[state].title;
  }
  return model;
}

/** Paint the flow's loading state, before anything is computed. */
export function renderGuidedLoading(doc) {
  renderGuidedChooser(doc, null, GUIDED_STATE.loading);
  renderGuidedEvidence(doc, null, GUIDED_STATE.loading);
  renderGuidedDepartment(doc, null, GUIDED_STATE.loading);
  const choice = doc.getElementById(GUIDED_IDS.choice);
  if (choice) choice.dataset.guidedState = GUIDED_STATE.loading;
  return GUIDED_STATE.loading;
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
