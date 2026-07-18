// Decision-detail state model and renderer. State transitions are pure and live
// above the DOM layer so selection rules can be verified independently.

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

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
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

export function renderDecisionDetail(container, decision, options = {}) {
  container.replaceChildren();
  const back = el("a", "detail-back", "← Back to decisions"); back.href = "/"; container.append(back);
  if (!decision) {
    const empty = el("div", "empty-state"); empty.setAttribute("role", "status");
    empty.append(el("h1", "empty-title", "Decision not found"), el("p", undefined, options.id ? "This decision may have been removed or is not available in this browser." : "No decision was specified."));
    container.append(empty); return;
  }

  const alternatives = normalizeAlternatives(decision);
  let state = createComparisonState(alternatives);
  const view = el("article", "decision-detail");
  const header = el("header", "decision-detail-header");
  header.append(el("p", "eyebrow", "Engineering decision"), el("h1", undefined, decision.title));
  const meta = el("dl", "detail-meta decision-detail-meta");
  const created = new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(decision.createdAt));
  for (const [label, value, className] of [["Status", decision.status, `badge badge-${decision.status}`], ["Owner", decision.owner], ["Recorded", created]]) {
    const row = el("div", "detail-meta-row"); row.append(el("dt", "detail-meta-label", label), el("dd", `detail-meta-value ${className ?? ""}`, value)); meta.append(row);
  }
  header.append(meta); view.append(header);
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
