// One compact status treatment for collection feeds. Copy stays with each
// surface, while this module owns semantics, metadata styling, and the rule
// that an action only exists in the tab order when it can do something.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderFeedStatus(container, options = {}) {
  if (!container) return null;
  const {
    state = "ready", label = "Feed status", text = "", detail = "",
    actionLabel = "", onAction = null, append = false,
  } = options;
  const status = element("div", `feed-status feed-status-${state}`);
  status.dataset.state = state;

  if (state === "loading") {
    status.setAttribute("role", "status");
    status.setAttribute("aria-label", label);
    status.append(element("span", "feed-status-value state-title", text));
  } else {
    const summary = element("p", "feed-status-summary");
    summary.append(
      element("span", "feed-status-label", `${label}:`),
      element("strong", "feed-status-value", text),
    );
    status.append(summary);
    if (detail) status.append(element("p", "feed-status-detail", detail));
    if (actionLabel && typeof onAction === "function") {
      const action = element("button", "feed-status-action state-action", actionLabel);
      action.type = "button";
      action.addEventListener("click", onAction);
      status.append(action);
    }
  }

  container.hidden = false;
  if (append) container.append(status);
  else container.replaceChildren(status);
  return status;
}
