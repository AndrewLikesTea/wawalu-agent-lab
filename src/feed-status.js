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

// The two states a feed has something to filter in: tiles on screen, or a set
// of filters that emptied a feed which does have posts behind it. Every other
// phase — an open fetch, a failed one, a feed with nothing in it — is a screen
// where the menus cannot change what is showing.
export function filtersAvailable(phase) {
  return phase === "loaded" || phase === "filtered-empty";
}

// The one sentence the filter region says while its controls cannot do
// anything. Caption weight, not content weight: it describes the controls
// beside it rather than the feed, which the status region is already reporting.
export const FILTERS_UNAVAILABLE_HINT = "Filters become available when posts load.";

/** Is `node` inside `host`? Ancestor walk: no descendant selectors here. */
function within(node, host) {
  for (let walker = node; host && walker; walker = walker.parentNode) {
    if (walker === host) return true;
  }
  return false;
}

/** The hint this call owns, if a previous call already wrote it. */
function existingHint(host, id) {
  return [...(host?.children ?? [])].find((child) => child.getAttribute?.("id") === id) ?? null;
}

// A filter with nothing behind it is a control that cannot do anything, so it
// says so with the attribute the platform already has for it: `disabled` drops
// it out of the tab order and out of the pointer path in one move, with no
// tabindex bookkeeping and no trap to escape from. On a failed feed that is
// also what makes the panel's Retry the next stop after the status text — the
// filters stop being stops, so nothing had to be moved in the markup to put the
// one working control in the reader's path.
//
// One entry point for all of it, called from every render path on both pages
// including the error and retry paths, so a state added later cannot leave a
// dead menu operable by forgetting a setAttribute at its own call site.
//
// THREE THINGS BEYOND THE PROPERTY.
//
// `aria-disabled` alongside it, because `disabled` alone is announced by the
// platform but leaves nothing in the markup a reader of the page — or a test —
// can point at, and the fill change the browser draws is the one signal a
// low-vision reader is least likely to get.
//
// The hint sentence, written into the filter region and named by every control
// through `aria-describedby`, so the reason is in words next to the controls
// rather than only in a greyed-out fill. It is removed, not hidden, the moment
// the filters work again: a description that has stopped being true is worse
// standing there than absent.
//
// Unless the caller has something true to say in every state. `hintPersists`
// keeps the node and swaps only its text, which is what a surface needs when the
// line is the filter row's own status — Social's says what the menus are
// currently set to, not only why they are shut — and what a live region needs to
// announce once: a region that arrives with its news is announced unreliably, if
// at all. Such a line is authored in the markup, so this only ever rewrites it.
// People passes nothing and keeps the removal behaviour.
//
// And focus. Disabling the control a keyboard reader is standing on drops focus
// to <body>, which sends the next Tab back to the top of the document. So the
// active element is checked BEFORE the attribute lands, and if it is one of
// these controls, focus moves to the status region — the line that just changed
// under them, and the one that says what happened — which takes `tabindex="-1"`
// only if the markup did not already give it a stop.
export function setFilterAvailability(available, options = {}) {
  const {
    controls = [], statusRegion = null, focusHost = null,
    hintHost = null, hintId = "", hintBefore = null, hintText = FILTERS_UNAVAILABLE_HINT,
    hintClass = "hint", hintPersists = false,
  } = options;
  const off = !available;
  const list = controls.filter(Boolean);

  if (off && statusRegion) {
    const active = document.activeElement ?? null;
    if (active && (list.includes(active) || within(active, focusHost))) {
      if (statusRegion.getAttribute("tabindex") === null) statusRegion.setAttribute("tabindex", "-1");
      statusRegion.focus();
    }
  }

  for (const control of list) {
    control.disabled = off;
    if (off) control.setAttribute("aria-disabled", "true");
    else control.removeAttribute("aria-disabled");
    // Only the description this function wrote is added and taken away again,
    // so a control that already describes itself keeps its own words.
    if (!hintId) continue;
    if (off && control.getAttribute("aria-describedby") === null) control.setAttribute("aria-describedby", hintId);
    else if (!off && control.getAttribute("aria-describedby") === hintId) control.removeAttribute("aria-describedby");
  }

  if (!hintHost || !hintId) return;
  const written = existingHint(hintHost, hintId);
  if (!off && !hintPersists) {
    written?.remove();
    return;
  }
  if (written) {
    written.textContent = hintText;
    return;
  }
  const hint = element("p", hintClass, hintText);
  hint.setAttribute("id", hintId);
  if (hintBefore && within(hintBefore, hintHost)) hintHost.insertBefore(hint, hintBefore);
  else hintHost.append(hint);
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
