// Deep links that survive progressive disclosure.
//
// The AI FinOps page keeps its supporting panels behind native `details`
// elements, and the guided-result index publishes a fragment link to each one.
// Those two facts fight each other in every browser: a fragment whose target
// sits inside a closed `details` resolves to an element that is not being
// rendered, so nothing scrolls, nothing focuses, and the reader is left at the
// top of the page holding a link somebody told them was evidence. Copying
// `#recommendation-evidence` out of the address bar and pasting it back is the
// exact motion this page asks a leader to make when they send a finding to
// finance, so it has to work on a cold load, not only on a click.
//
// The fix is one rule, applied in one place: before anything navigates, scrolls,
// or focuses, every `details` enclosing the target is opened, outermost first.
// Opening is done through the `open` attribute rather than the property because
// that is the state the HTML, the CSS, and this module can all agree on, and
// because it is what a serialized page would have shipped.
//
// What this module deliberately does not do: it never un-hides a `hidden`
// element. `hidden` on this page means "there is no such result yet" — an
// unimported briefing, an ungraded sample — and forcing one open would show a
// reader an empty panel and call it evidence. A fragment pointing at a panel
// that has no content yet resolves to nothing, which is the honest outcome.

/** Elements this module will open. Kept narrow on purpose. */
const DISCLOSURE_TAG = "DETAILS";

/** Tags a browser already places in the focus order without help. */
const NATURALLY_FOCUSABLE = new Set([
  "A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "DETAILS",
]);

/**
 * The element id a fragment names, or null.
 *
 * A bare `#`, an empty hash, and a malformed escape are all "no target" rather
 * than an error: a reader who typed the URL by hand should land on the page,
 * not on a thrown exception that stops the rest of the page from booting.
 */
export function fragmentId(hash) {
  const raw = String(hash ?? "");
  const text = raw.startsWith("#") ? raw.slice(1) : raw;
  if (text === "") return null;
  try {
    return decodeURIComponent(text) || null;
  } catch {
    return text;
  }
}

/**
 * Every `details` enclosing a node, outermost first.
 *
 * Outermost first matters: opening an inner disclosure while its parent is
 * still closed is a state a reader can never reach by clicking, and some
 * engines will not lay the inner content out until the ancestor is open.
 */
export function enclosingDisclosures(node) {
  const found = [];
  let current = node?.parentNode ?? null;
  while (current && current.nodeType === 1) {
    if (current.tagName === DISCLOSURE_TAG) found.unshift(current);
    current = current.parentNode;
  }
  return found;
}

/** Open one disclosure through its attribute, and report whether it moved. */
function openDisclosure(details) {
  if (details.hasAttribute("open")) return false;
  details.setAttribute("open", "");
  // Kept in step for anything reading the property — including this page's own
  // support-disclosure binding, which mirrors `open` onto a data attribute.
  details.open = true;
  return true;
}

/**
 * Make the fragment target reachable, then hand it the reader's attention.
 *
 * Returns what was done rather than a boolean, so a caller — and a test — can
 * assert on the disclosures that were opened rather than re-deriving them from
 * the DOM afterwards. A missing target returns null; that is not a failure,
 * because a page legitimately ships fragments for panels that are not on screen
 * in every state.
 *
 * `resolve` is how a page says where its own retired targets went. It is only
 * ever asked about an id THIS DOCUMENT DOES NOT HAVE, so a working fragment is
 * never rerouted, and a caller that passes none — every page but /evolution.html
 * — behaves exactly as it did before the option existed. This module knows no
 * page's ids and will not learn any: the table belongs to the page that retired
 * them.
 */
export function revealFragmentTarget(
  doc, hash, { scroll = true, focus = true, resolve = null } = {},
) {
  const requested = fragmentId(hash);
  if (!requested || !doc?.getElementById) return null;
  let id = requested;
  let target = doc.getElementById(id);
  if (!target && typeof resolve === "function") {
    const resolved = resolve(requested, doc);
    id = typeof resolved === "string" && resolved !== "" ? resolved : requested;
    target = id === requested ? null : doc.getElementById(id);
  }
  if (!target) return null;

  const opened = [];
  for (const details of enclosingDisclosures(target)) {
    if (openDisclosure(details)) opened.push(details);
  }

  // Only now — the target is laid out, so a scroll lands where the reader was
  // sent and a focus ring is drawn on something they can see.
  if (focus) {
    if (!NATURALLY_FOCUSABLE.has(target.tagName) && !target.hasAttribute("tabindex")) {
      // The standard programmatic-target idiom: reachable by script, never
      // added to the tab sequence. Panels on this page are sections and lists,
      // which a browser will otherwise refuse to focus at all.
      target.setAttribute("tabindex", "-1");
    }
    target.focus?.({ preventScroll: true });
  }
  if (scroll) target.scrollIntoView?.({ block: "start" });

  // `requested` beside `id` so a caller can tell a link that worked from one
  // that was carried to a survivor, without re-deriving it from the address.
  return { id, requested, target, opened };
}

/**
 * Wire the rule to the three moments a fragment is resolved.
 *
 * - Initial load, because the browser already tried and failed while the target
 *   was collapsed. This is the reload case in the bug report.
 * - `hashchange`, for a pasted URL edit and for back/forward between fragments.
 * - A click on an in-page link, which is the only one of the three where this
 *   can run genuinely *before* the browser navigates. The default is never
 *   prevented: the address bar must still end up holding the link the reader is
 *   about to copy.
 *
 * The window is a parameter rather than a global so this is testable without a
 * browser, and so a page that boots twice cannot register the handlers twice.
 * Returns a teardown for the same reason.
 */
export function installDeepLinkDisclosure(doc, win, options = {}) {
  if (!doc || !win?.addEventListener) return () => {};

  const currentHash = () => win.location?.hash ?? "";

  const onHashChange = () => revealFragmentTarget(doc, currentHash(), options);
  const onClick = (event) => {
    if (event.defaultPrevented) return;
    // Matched in code rather than with an attribute-prefix selector: the href is
    // read here anyway, and one way of deciding "is this an in-page link" is
    // easier to keep true than two.
    const link = event.target?.closest?.("a");
    if (!link?.getAttribute("href")?.startsWith("#")) return;
    // Reveal only. The browser still performs the navigation, still updates the
    // address bar, and still writes the history entry.
    revealFragmentTarget(doc, link.getAttribute("href"), { ...options, scroll: false });
  };

  win.addEventListener("hashchange", onHashChange);
  doc.addEventListener("click", onClick);

  // The cold-load case. Run it once now for a document that is already parsed;
  // otherwise wait, because a target inside markup that has not been parsed yet
  // cannot be found.
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", onHashChange);
  else onHashChange();

  return () => {
    win.removeEventListener?.("hashchange", onHashChange);
    doc.removeEventListener?.("click", onClick);
    doc.removeEventListener?.("DOMContentLoaded", onHashChange);
  };
}
