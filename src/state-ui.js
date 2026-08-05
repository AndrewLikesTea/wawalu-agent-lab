// Shared, dependency-free UI for collection loading, empty, and error states.
// Callers supply all copy and actions; this module owns consistent accessible
// structure. Dynamic values are always assigned through textContent.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderState(container, options) {
  const {
    state,
    title,
    description,
    label = state === "error" ? "Error" : "Status",
    value = title,
    action,
    item = false,
  } = options;

  const panel = element(item ? "li" : "div", `state-panel state-panel-${state}`);
  panel.dataset.state = state;

  if (state === "loading") {
    panel.setAttribute("role", "status");
    const spinner = element("span", "state-spinner");
    spinner.setAttribute("aria-hidden", "true");
    panel.append(spinner, element("span", "state-title", title));
  } else {
    const summary = element("p", "state-summary");
    summary.append(
      element("span", "state-label", `${label}:`),
      element("strong", "state-value", value),
    );
    panel.append(summary);
    if (description) panel.append(element("p", "state-guidance", description));
    if (action) {
      const control = element(action.href ? "a" : "button", "state-action", action.label);
      if (action.href) {
        control.href = action.href;
        // A state action that leaves the tab discloses it in its own text, the
        // way the authored links on Social and People do. Opt-in: same-tab is
        // still the default for every caller that says nothing.
        if (action.newTab) {
          control.target = "_blank";
          control.rel = "noopener";
          control.append(element("span", "new-tab-note", " (opens in a new tab)"));
        }
      } else {
        control.type = "button";
        control.addEventListener("click", action.onClick);
      }
      panel.append(control);
    }
  }

  container.replaceChildren(panel);
  return panel;
}
