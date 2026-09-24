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
//
// An index alone is only true while every other sibling is where it shipped, and
// a panel that removes more than one line at a time breaks that: a line that
// ships after another removable one is restored one place late, or appended past
// the end of the panel. `anchor` is the element this line must stay in front of
// — a sibling the page never removes — and it wins whenever it is still there.
export function feedPresence(node, anchor = null) {
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
      const anchored = anchor && anchor.parentNode === parent ? anchor : null;
      const after = anchored ?? parent.children[slot] ?? null;
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
//
// It names the display-name menu and nothing else (#2001). Both menus are shut
// while the feed is open, but only one of them is also EMPTY: the time menu
// ships its four ranges in the markup, while the display names are read off the
// posts and so cannot exist yet. Listing the time menu as something that
// "becomes available" described a choice the reader could already see. Naming
// it as shown would be the same mistake inverted — the control is `disabled`,
// so an invitation to use it is a second claim the row cannot support. Why
// neither menu is operable is the fetch's news, and the status region beside
// this line is already reporting it.
export const FILTERS_UNAVAILABLE_HINT = "Display name options become available when posts load.";

// WHERE A READER STANDING ON RETRY IS PUT WHEN RETRY GOES AWAY (#2499).
//
// Both feeds draw their failure panel — message, guidance, and the one control
// that re-runs the fetch — inside the status region. So the render that answers
// the press is the render that destroys the button the press came from. A
// removed focused element drops focus to <body>, and from <body> the next Tab
// restarts at the top of the document: the reader who asked for the feed again
// loses the feed, the nav, and every stop in between, and has to walk the whole
// page back to where they were standing. That is the one outcome this must not
// have, and it is what a page gets for free by doing nothing.
//
// So the press is remembered and each following render places the reader:
//
//   the attempt failed again  → the new Retry, because the control is back and
//                               it is still the only thing to do here;
//   anything else             → `landing`, the region's status node: the line
//                               that says what the load produced. It takes
//                               `tabindex="-1"` only if the markup did not
//                               already give it a stop, so it is a place focus
//                               can be put and never a stop Tab lands on.
//
// A feed that returns to "loading" first — both of these do, so a second
// failure reads as a second attempt rather than a dead button — lands the
// reader on `landing` for the wait and stays armed, so the answer still places
// them when it arrives.
//
// Only a reader who has been stranded is moved: `document.activeElement` null,
// on <body>, or on a node that is no longer in the document. Someone who tabbed
// away while the fetch was open is where they chose to be, and moving them is
// the same theft in the other direction. The detached case is what the test
// harness produces — removing a node there leaves `activeElement` pointing at
// it, where a browser drops to <body> — and both mean the same thing: the node
// the reader was on is gone.
export function retryFocus(statusRegion, landing) {
  let pending = false;
  // The node this parked the reader on for the duration of the fetch, if it
  // did. They are still movable from there: that landing was this function's
  // doing and not a place the reader chose, so putting them on the control the
  // answer produced is finishing the move rather than taking their place.
  let parked = null;
  const stranded = (document) => {
    const active = document?.activeElement ?? null;
    if (!active || active === document.body) return true;
    for (let walker = active; walker; walker = walker.parentNode) {
      if (walker === document.documentElement) return false;
    }
    return true;
  };
  return {
    /** Called from the Retry handler, before the render it triggers. */
    armed() { pending = true; },
    /** Called at the end of every render, with the state that render drew. */
    settle(state) {
      if (!pending) return;
      if (state !== "loading") pending = false;
      const document = landing?.ownerDocument ?? statusRegion?.ownerDocument ?? null;
      if (!document) return;
      const movable = stranded(document) || (parked !== null && document.activeElement === parked);
      if (!movable) { parked = null; return; }
      const again = state === "error"
        ? statusRegion?.querySelector?.(".feed-status-action") ?? null
        : null;
      const target = again ?? landing;
      if (!target) return;
      if (target.getAttribute("tabindex") === null) target.setAttribute("tabindex", "-1");
      target.focus();
      parked = state === "loading" ? target : null;
    },
  };
}

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
// currently set to, not only why they are shut. Such a line is authored in the
// markup, so this only ever rewrites it. It is not a live region on either page:
// describing the controls beside it is read out when one of them is reached, and
// the feed's own status region is the single node that speaks for a load.
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
  // Static pages ship a compact first-paint status before this renderer runs.
  container.classList?.remove?.("feed-status");
  const {
    state = "ready", label = "Feed status", text = "", detail = "",
    actionLabel = "", onAction = null, append = false, heading = false, quiet = false,
  } = options;
  const status = element("div", `feed-status feed-status-${state}`);
  status.dataset.state = state;

  if (state === "loading") {
    // `quiet` is for the surfaces that hand this renderer a status region of
    // their own — Social's #feed-state, People's #profile-feed-status. That
    // region is where the page has already decided whether the wait is spoken
    // and by which node, so a second `role="status"` drawn inside it is a live
    // region nested in a live region: the same open fetch announced twice, from
    // two nodes one of which the page never authored. It stays the default off,
    // because a caller that appends into the feed container itself has no such
    // region and this panel is the only thing that can speak for the wait.
    if (!quiet) {
      status.setAttribute("role", "status");
      status.setAttribute("aria-label", label);
    }
    status.append(element("span", "feed-status-value state-title", text));
  } else {
    const summary = element(heading ? "div" : "p", "feed-status-summary");
    summary.append(
      element("span", "feed-status-label", `${label}:`),
      element(heading ? "h3" : "strong", "feed-status-value", text),
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
