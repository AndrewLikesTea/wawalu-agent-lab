// Decision-detail state model and renderer. State transitions are pure and live
// above the DOM layer so selection rules can be verified independently.

import { createShareControl } from "./share-link.js";
import { EXAMPLE_LABEL } from "./seed-records.js";
import { indexSupersessions } from "./supersede.js";

export const MAX_COMPARISON_SELECTION = 2;

const text = (value, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const list = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];

export function normalizeAlternatives(decision) {
  if (Array.isArray(decision?.alternatives)) {
    return decision.alternatives.map((alternative, index) => ({
      id: text(alternative?.id, `alternative-${index + 1}`),
      name: text(alternative?.name, `Alternative ${index + 1}`),
      summary: text(alternative?.summary, "No summary recorded."),
      pros: list(alternative?.pros),
      cons: list(alternative?.cons),
      effort: text(alternative?.effort, "Not assessed"),
      risk: text(alternative?.risk, "Not assessed"),
      selected: alternative?.selected === true,
    }));
  }
  const legacy = text(decision?.alternatives);
  return legacy ? [{ id: "recorded-alternative", name: "Recorded alternative", summary: legacy, pros: [], cons: [], effort: "Not assessed", risk: "Not assessed", selected: false }] : [];
}

export function createComparisonState(alternatives) {
  const validIds = new Set(alternatives.map(({ id }) => id));
  const preferred = alternatives.filter(({ selected }) => selected).map(({ id }) => id);
  const selectedIds = [...new Set(preferred)].filter((id) => validIds.has(id)).slice(0, MAX_COMPARISON_SELECTION);
  return { selectedIds, comparisonVisible: false };
}

export function toggleAlternative(state, id, alternatives) {
  if (!alternatives.some((alternative) => alternative.id === id)) return state;
  const selectedIds = state.selectedIds.includes(id)
    ? state.selectedIds.filter((selectedId) => selectedId !== id)
    : [...state.selectedIds, id].slice(-MAX_COMPARISON_SELECTION);
  return { selectedIds, comparisonVisible: selectedIds.length === 2 && state.comparisonVisible };
}

export function toggleComparison(state) {
  return state.selectedIds.length === 2 ? { ...state, comparisonVisible: !state.comparisonVisible } : { ...state, comparisonVisible: false };
}

export function resolveDecisionDetail(decisions, id) {
  return (decisions ?? []).find((decision) => decision?.id === id) ?? null;
}

export function decisionDetailState({ id = "", decision = null, unavailable = false } = {}) {
  if (decision) return "available";
  if (unavailable) return "error";
  return id ? "not-found" : "empty";
}

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function renderBackLink() {
  const back = el("a", "detail-back", "← Back to Decisions");
  back.href = "/";
  return back;
}

const DETAIL_STATE_COPY = {
  loading: {
    title: "Loading decision",
    description: "We’re finding this decision and its linked releases.",
  },
  empty: {
    title: "Choose a decision",
    description: "No decision was specified. Return to Decisions to choose one from the log.",
  },
  "not-found": {
    title: "Decision not found",
    description: "This decision may have been removed or is not available in this browser.",
  },
  error: {
    title: "Decision couldn’t be loaded",
    description: "The decision log is temporarily unavailable. Your browser data has not been changed.",
  },
};

export function renderDecisionDetailState(container, state) {
  const copy = DETAIL_STATE_COPY[state] ?? DETAIL_STATE_COPY.error;
  container.replaceChildren(renderBackLink());
  const loadingHook = state === "loading" ? " list-state-loading" : "";
  const panel = el("section", `detail-state detail-state-${state}${loadingHook}`);
  panel.dataset.state = state;
  panel.setAttribute("aria-labelledby", "decision-state-title");
  panel.setAttribute("role", state === "error" ? "alert" : "status");
  const label = el("p", "detail-state-label", state === "error" ? "Error" : "Decision status");
  const title = el("h1", "detail-state-title", copy.title);
  title.id = "decision-state-title";
  panel.append(label, title, el("p", "detail-state-guidance", copy.description));
  container.append(panel);
  return panel;
}

function labelledList(title, values, kind) {
  const section = el("div", `alternative-points alternative-${kind}`);
  section.append(el("h4", undefined, title));
  if (!values.length) section.append(el("p", "detail-muted", "None recorded."));
  else {
    const ul = el("ul");
    for (const value of values) ul.append(el("li", undefined, value));
    section.append(ul);
  }
  return section;
}

function renderAlternative(alternative, checked, onChange, comparable) {
  const article = el("article", `alternative-card${comparable && checked ? " is-selected" : ""}`);
  const heading = el("div", "alternative-heading");
  heading.append(el("h3", undefined, alternative.name));
  // The compare affordance only appears when there is something to compare against.
  // A lone alternative (the shape recorded decisions carry today) would otherwise
  // show a checkbox that can never reach the two-selection threshold.
  if (comparable) {
    const label = el("label", "comparison-check");
    const input = el("input");
    input.type = "checkbox";
    input.checked = checked;
    input.dataset.alternativeId = alternative.id;
    input.setAttribute("aria-label", `Select ${alternative.name} for comparison`);
    input.addEventListener("change", () => onChange(alternative.id, input));
    label.append(input, el("span", undefined, "Compare"));
    heading.append(label);
  }
  article.append(heading, el("p", "alternative-summary", alternative.summary));
  const points = el("div", "alternative-points-grid");
  points.append(labelledList("Advantages", alternative.pros, "pros"), labelledList("Trade-offs", alternative.cons, "cons"));
  article.append(points);
  const facts = el("dl", "alternative-facts");
  for (const [name, value] of [["Effort", alternative.effort], ["Risk", alternative.risk]]) {
    const row = el("div"); row.append(el("dt", undefined, name), el("dd", undefined, value)); facts.append(row);
  }
  article.append(facts);
  return article;
}

function renderComparison(alternatives) {
  const section = el("section", "comparison-view");
  section.id = "alternative-comparison";
  section.tabIndex = -1;
  section.setAttribute("aria-labelledby", "comparison-title");
  section.append(el("h2", undefined, "Side-by-side comparison"));
  section.lastChild.id = "comparison-title";
  section.append(el("p", "comparison-key", "Different values are marked with a blue indicator."));
  const rows = [
    ["Summary", (item) => item.summary],
    ["Effort", (item) => item.effort],
    ["Risk", (item) => item.risk],
    ["Advantages", (item) => item.pros.join("; ") || "None recorded"],
    ["Trade-offs", (item) => item.cons.join("; ") || "None recorded"],
  ];
  const tableWrap = el("div", "comparison-table-wrap");
  const table = el("table", "comparison-table");
  const caption = el("caption", undefined, `${alternatives[0].name} compared with ${alternatives[1].name}`);
  const thead = el("thead"); const header = el("tr"); header.append(el("th", undefined, "Criterion"));
  for (const alternative of alternatives) { const th = el("th", undefined, alternative.name); th.scope = "col"; header.append(th); }
  thead.append(header); table.append(caption, thead);
  const tbody = el("tbody");
  for (const [label, getValue] of rows) {
    const values = alternatives.map(getValue); const differs = values[0] !== values[1]; const row = el("tr", differs ? "comparison-differs" : "");
    const th = el("th", undefined, label); th.scope = "row"; row.append(th);
    values.forEach((value) => { const td = el("td", undefined, value); if (differs) td.dataset.difference = "true"; row.append(td); });
    tbody.append(row);
  }
  table.append(tbody); tableWrap.append(table); section.append(tableWrap);
  return section;
}

const decisionHref = (id) => `/decision.html?id=${encodeURIComponent(id)}`;
const longDate = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(value));

// Titles reach the DOM as text nodes, never as markup: the same rule the rest of
// this renderer follows, so a title carrying a script tag or an onerror payload
// renders as the characters the author typed.
function decisionLink(target) {
  const link = el("a", "supersede-link", target.title);
  link.href = decisionHref(target.id);
  return link;
}

// One banner, above the recorded context and alternatives, announcing the state
// this decision is now in. It is the only place that state is stated on this
// page — the successor is reachable from the link inside it.
export function renderSupersededBanner(successor) {
  const banner = el("section", "supersede-banner");
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-labelledby", "supersede-banner-text");
  const line = el("p", "supersede-banner-text");
  line.id = "supersede-banner-text";
  line.append(document.createTextNode("Superseded by "), decisionLink(successor));
  const on = el("time", "supersede-banner-date", longDate(successor.createdAt));
  on.dateTime = successor.createdAt;
  line.append(document.createTextNode(" on "), on);
  banner.append(line);
  return banner;
}

// The other side of the same link is quieter by design: replacing an earlier
// decision is background, not an alert, so it opens closed and carries no status
// role. aria-expanded is kept in step with the native open state.
export function renderReplacesDisclosure(predecessor) {
  const disclosure = el("details", "supersede-disclosure");
  const summary = el("summary", "supersede-disclosure-summary", `Replaces ${predecessor.title}`);
  summary.setAttribute("aria-expanded", "false");
  disclosure.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(disclosure.open === true));
  });
  const body = el("p", "supersede-disclosure-body");
  body.append(decisionLink(predecessor));
  disclosure.append(summary, body);
  return disclosure;
}

export function renderDecisionDetail(container, decision, options = {}) {
  container.replaceChildren(renderBackLink());
  if (!decision) {
    renderDecisionDetailState(container, decisionDetailState(options));
    return;
  }

  const alternatives = normalizeAlternatives(decision);
  let state = createComparisonState(alternatives);
  const view = el("article", "decision-detail");
  const header = el("header", "decision-detail-header");
  const heading = el("div", "detail-heading");
  heading.append(el("p", "eyebrow", "Engineering decision"), el("h1", undefined, decision.title));
  // The list row says this too, but a reader who pasted the URL never saw the
  // list. Same badge, same words, in the record's own header.
  if (options.example === true) heading.append(el("span", "badge badge-example", EXAMPLE_LABEL));
  if (options.shareable) {
    const share = createShareControl({ type: "decision", id: decision.id });
    if (share) heading.append(share);
  }
  header.append(heading);
  const meta = el("dl", "detail-meta decision-detail-meta");
  const created = new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(decision.createdAt));
  for (const [label, value, className] of [["Status", decision.status, `badge badge-${decision.status}`], ["Owner", decision.owner], ["Recorded", created]]) {
    const row = el("div", "detail-meta-row"); row.append(el("dt", "detail-meta-label", label), el("dd", `detail-meta-value ${className ?? ""}`, value)); meta.append(row);
  }
  header.append(meta); view.append(header);

  // Both directions of the supersede link are derived from the surrounding log
  // (options.decisions), never read off this record: only `supersedes` is
  // stored, and it points the other way.
  const { supersededBy, replaces } = indexSupersessions(
    Array.isArray(options.decisions) ? options.decisions : [decision],
  );
  const successor = supersededBy.get(decision.id) ?? null;
  const predecessor = replaces.get(decision.id) ?? null;
  if (successor) view.append(renderSupersededBanner(successor));
  if (predecessor) view.append(renderReplacesDisclosure(predecessor));

  const linkedReleases = Array.isArray(options.linkedReleases) ? options.linkedReleases : [];
  const relationship = el("section", "proof-relationship");
  relationship.setAttribute("aria-labelledby", "linked-releases-title");
  relationship.append(el("h2", undefined, "Linked releases"));
  relationship.firstChild.id = "linked-releases-title";
  if (linkedReleases.length) {
    const releaseList = el("ul");
    for (const release of linkedReleases) {
      const item = el("li");
      const link = el("a", undefined, `${release.version} · ${release.title || release.version}`);
      link.href = `/release.html?id=${encodeURIComponent(release.id)}`;
      item.append(link, el("span", `badge badge-release-${release.status}`, release.status));
      releaseList.append(item);
    }
    relationship.append(releaseList);
  } else {
    relationship.append(el("p", "detail-muted", "No releases link to this decision yet."));
  }
  view.append(relationship);
  const context = el("section", "decision-context"); context.setAttribute("aria-labelledby", "context-title");
  context.append(el("h2", undefined, "Context and rationale"), el("p", undefined, decision.context)); context.firstChild.id = "context-title"; view.append(context);
  const alternativesSection = el("section", "decision-alternatives"); alternativesSection.setAttribute("aria-labelledby", "alternatives-title");
  const sectionHead = el("div", "decision-section-heading"); sectionHead.append(el("div"));
  sectionHead.firstChild.append(el("p", "eyebrow", `${alternatives.length} ${alternatives.length === 1 ? "option" : "options"}`), el("h2", undefined, "Alternatives considered"));
  sectionHead.querySelector("h2").id = "alternatives-title";
  const comparable = alternatives.length >= MAX_COMPARISON_SELECTION;
  let status, button;
  if (comparable) {
    const controls = el("div", "comparison-controls");
    status = el("p", "comparison-status", "Select two alternatives to compare."); status.id = "comparison-status"; status.setAttribute("aria-live", "polite");
    button = el("button", "comparison-toggle", "Compare selected"); button.type = "button"; button.disabled = true; button.setAttribute("aria-controls", "alternative-comparison"); button.setAttribute("aria-expanded", "false");
    controls.append(status, button); sectionHead.append(controls);
  }
  alternativesSection.append(sectionHead);
  const cards = el("div", "alternative-grid"); const comparisonSlot = el("div");
  const update = ({ focusComparison = false, focusAlternative = "" } = {}) => {
    cards.replaceChildren();
    if (!alternatives.length) cards.append(el("p", "detail-empty-copy", "No alternatives were recorded for this decision."));
    for (const alternative of alternatives) cards.append(renderAlternative(alternative, state.selectedIds.includes(alternative.id), (id) => { state = toggleAlternative(state, id, alternatives); update({ focusAlternative: id }); }, comparable));
    if (comparable) {
      button.disabled = state.selectedIds.length !== 2;
      button.textContent = state.comparisonVisible ? "Hide comparison" : "Compare selected";
      button.setAttribute("aria-expanded", String(state.comparisonVisible));
      status.textContent = state.selectedIds.length === 2 ? "Two alternatives selected. Ready to compare." : `${state.selectedIds.length} of 2 alternatives selected.`;
      comparisonSlot.replaceChildren();
      if (state.comparisonVisible) {
        const selected = state.selectedIds.map((id) => alternatives.find((alternative) => alternative.id === id));
        const comparison = renderComparison(selected); comparisonSlot.append(comparison); if (focusComparison) comparison.focus();
      }
    }
    if (focusAlternative) cards.querySelector(`[data-alternative-id="${CSS.escape(focusAlternative)}"]`)?.focus();
  };
  if (comparable) button.addEventListener("click", () => { state = toggleComparison(state); update({ focusComparison: state.comparisonVisible }); });
  alternativesSection.append(cards, comparisonSlot); view.append(alternativesSection); container.append(view); update();
}
