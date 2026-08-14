// One compact status treatment for collection feeds. Copy stays with each
// surface, while this module owns semantics, metadata styling, and the rule
// that an action only exists in the tab order when it can do something.

// The one state machine both feeds run on. Social and People used to each work
// out "is this empty or still loading?" from their own chain of conditions, and
// the two chains drifted: a pending feed printed a count placeholder, a promise
// about posts nobody had seen, and a loading line all at once, and a display
// name with nothing under it read the same as a feed with nothing in it.
//
// Five outcomes, mutually exclusive, in the order the page can actually know
// them. Posts on screen win outright — stale content beats a spinner drawn over
// content the reader could already see — which is why `visible` is tested first
// and a failed refresh beside surviving tiles is still "loaded".
//
// `total` is the unfiltered feed and `visible` what the current filters leave,
// so "the feed is empty" and "your filters emptied it" stay different answers
// with different words and different recovery.
export function feedPhase({ state = "ready", total = 0, visible = 0, filtering = false } = {}) {
  if (visible > 0) return "loaded";
  if (state === "loading") return "loading";
  if (state === "error") return "failed";
  if (filtering && total > 0) return "filtered-empty";
  return "empty";
}

// Presence, not visibility. A line that is only true once a fetch has answered
// leaves the document while the fetch is open — `hidden` would keep it in the
// accessibility tree and in the text a screen reader can be walked through, and
// the whole complaint here is that a waiting page made claims it could not
// support yet.
//
// The slot is remembered as the index the node shipped at, so restoring it puts
// the line back where the author put it rather than at the end of its panel.
// `[...parent.children]` because a real HTMLCollection has no indexOf.
export function feedPresence(node) {
  const parent = node?.parentNode ?? null;
  if (!node || !parent) return { present() {} };
  const slot = [...parent.children].indexOf(node);
  return {
    present(show) {
      const here = [...parent.children].includes(node);
      if (Boolean(show) === here) return;
      if (!show) {
        node.remove();
        return;
      }
      const after = parent.children[slot] ?? null;
      if (after) parent.insertBefore(node, after);
      else parent.append(node);
    },
  };
}

// A filter with nothing behind it is a control that cannot do anything, so it
// says so with the attribute the platform already has for it: `disabled` drops
// it out of the tab order and out of the pointer path in one move, with no
// tabindex bookkeeping and no trap to escape from.
export function setFeedControlsDisabled(controls, disabled) {
  for (const control of controls) {
    if (control) control.disabled = Boolean(disabled);
  }
}

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
