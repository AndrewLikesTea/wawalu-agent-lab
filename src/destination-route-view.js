// The route from src/destination-route.js, applied to /evolution.html.
//
// Everything that touches a document, a History or a Location is here, and the
// parsing is next door. The split is what lets the parser be exercised over
// every registered slug as a pure function, which is the only way to be sure a
// URL somebody pasted from Slack six months from now still opens what it names.
//
// WHAT "OPENING A DESTINATION" MEANS ON THIS PAGE. The front door's three doors
// are real anchors and two of them leave for another document. So this module
// does NOT navigate on load — a page that redirects itself the moment it opens
// is a page a reader cannot read. It marks the named door as the current one,
// applies the qualifiers the address carried, and moves the reader to it.
// `spend-attribution` points at `#finops-stand` on this same document, so that
// one is opened in place: its disclosures are expanded and its region is
// focused through the machinery src/deep-link-disclosure.js already ships.
//
// HISTORY. Selecting a destination pushes exactly one entry, and only when the
// resulting address differs from the one already showing. Pushing an identical
// URL is what makes the back button appear to unwind scroll instead of moving
// between destinations, which is the defect this change exists to remove.
// `popstate` re-applies and pushes nothing.
//
// THE FAILURE STATE IS A SENTENCE, NOT A BLANK PAGE. An unknown, stale or
// malformed slug leaves the front door rendered exactly as it was and adds one
// paragraph above it naming what was asked for. That paragraph is built with
// `createElement` and filled with `textContent`: the requested slug came off
// the URL and is attacker-controllable, and this page's policy forbids
// assigning markup anywhere. The address is then normalized with
// `replaceState`, so a reload does not show the message a second time.

import {
  DESTINATION_PARAM, ROUTE_STATUS,
  canonicalQuery, parseDestinationRoute, routeFailureMessage,
} from "./destination-route.js";
import { FINOPS_DESTINATIONS } from "./finops-destinations.js";
import { revealFragmentTarget } from "./deep-link-disclosure.js";

/** The front-door region and its list, both authored in the document. */
const FRONT_DOOR_ID = "finops-front-door";
const FRONT_DOOR_LIST_ID = "finops-front-door-list";

/**
 * The failure paragraph. Created on demand rather than authored, because the
 * front-door markup in the document is compared byte for byte against
 * `frontDoorMarkup()` in tests/finops-destinations.test.js — a slot authored
 * beside it would be a second copy of a region that must have exactly one.
 * `.stand-answer` is a class this page already ships, so no stylesheet moves.
 */
export const ROUTE_MESSAGE_ID = "finops-front-door-route-message";

const findDoors = (document) => [
  ...(document?.getElementById?.(FRONT_DOOR_LIST_ID)
    ?.querySelectorAll?.("[data-front-door-slug]") ?? []),
];

function messageNode(document) {
  const existing = document?.getElementById?.(ROUTE_MESSAGE_ID);
  if (existing) return existing;
  const region = document?.getElementById?.(FRONT_DOOR_ID);
  if (!region) return null;
  const node = document.createElement("p");
  node.id = ROUTE_MESSAGE_ID;
  node.className = "stand-answer";
  node.setAttribute("role", "status");
  node.setAttribute("data-route-message", "true");
  // Before the figure, because it qualifies everything under it.
  const first = region.firstChild ?? null;
  if (first) region.insertBefore?.(node, first);
  else region.append?.(node);
  return node;
}

/**
 * Say what happened to the address, or say nothing.
 *
 * The node is created on the first apply even when there is nothing to say, and
 * stays in the tree afterwards carrying its state on `data-route-status`. Both
 * halves are deliberate: a `role="status"` region that is inserted at the
 * moment it first has text is frequently not announced at all, and a node left
 * with an old sentence would describe a destination the reader has since left.
 * So it exists early and is emptied, rather than appearing and disappearing.
 */
function renderMessage(document, route) {
  const text = routeFailureMessage(route);
  const node = messageNode(document);
  if (!node) return "";
  // textContent, never markup: `requestedSlug` is URL text.
  node.textContent = text;
  node.setAttribute("data-route-status", route?.status ?? ROUTE_STATUS.absent);
  node.hidden = text === "";
  return text;
}

/**
 * Mark the current door, and only that one.
 *
 * `aria-current` rather than a class: the doors are anchors and the fact being
 * stated is "this is the one you are on", which is what assistive technology
 * reads off that attribute. It is removed rather than set to "false", because
 * `aria-current="false"` announces nothing and litters the markup.
 */
function markDoors(document, slug) {
  let marked = 0;
  for (const door of findDoors(document)) {
    const active = door.dataset?.frontDoorSlug === slug && slug !== null;
    door.setAttribute("data-front-door-active", active ? "true" : "false");
    if (active) {
      door.setAttribute("aria-current", "true");
      marked += 1;
    } else {
      door.removeAttribute?.("aria-current");
    }
  }
  return marked;
}

/**
 * Apply the qualifiers. `scope` is recorded on the region for the surfaces that
 * read it; `department` additionally presses the matching department control if
 * the bundled analysis has already painted one. It is a no-op before that paint
 * — `applyDestinationRoute` is idempotent and the page re-applies once the seed
 * has rendered — rather than a queued action that fires into a stale document.
 */
function applyQualifiers(document, route) {
  const region = document?.getElementById?.(FRONT_DOOR_ID);
  for (const [name, value] of [["scope", route.scope], ["department", route.department]]) {
    if (value) region?.setAttribute?.(`data-route-${name}`, value);
    else region?.removeAttribute?.(`data-route-${name}`);
  }
  if (!route.department) return false;
  const button = document?.querySelector?.(`[data-department-id="${route.department}"]`);
  if (!button) return false;
  if (button.getAttribute?.("aria-pressed") === "true") return true;
  button.click?.();
  return true;
}

/**
 * Put the reader at the destination.
 *
 * In-page destinations (an `href` that is a fragment) get the full disclosure
 * treatment, so a link into a region behind a collapsed details element lands
 * on open content rather than on a target that is not being rendered. Doors
 * that leave this document are focused and not followed.
 */
function moveTo(document, destination) {
  const href = destination?.href ?? "";
  if (href.startsWith("#")) {
    if (revealFragmentTarget(document, href, { scroll: true, focus: true })) return "target";
  }
  const door = findDoors(document)
    .find((node) => node.dataset?.frontDoorSlug === destination?.slug);
  door?.scrollIntoView?.({ block: "start" });
  door?.focus?.();
  return door ? "door" : "none";
}

/**
 * Apply a parsed route to the document. Pure of history: it never pushes.
 *
 * Returns a record of what it did, so a caller (and a test) can tell "marked
 * the door and moved" apart from "the region is not on this page".
 */
export function applyDestinationRoute(document, route, { move = true, registry = FINOPS_DESTINATIONS } = {}) {
  const resolved = route?.status === ROUTE_STATUS.ok
    ? registry.find((entry) => entry.slug === route.slug) ?? null
    : null;
  const marked = markDoors(document, resolved?.slug ?? null);
  const message = renderMessage(document, route);
  const departmentApplied = resolved ? applyQualifiers(document, route) : applyQualifiers(document, {});
  const moved = resolved && move ? moveTo(document, resolved) : "none";
  return Object.freeze({
    status: route?.status ?? ROUTE_STATUS.absent,
    slug: resolved?.slug ?? null,
    marked, message, moved, departmentApplied,
    droppedParams: route?.droppedParams ?? [],
  });
}

/** The address a route resolves to, other people's query parameters intact. */
export const routeAddress = (location, route, registry = FINOPS_DESTINATIONS) =>
  `${location?.pathname ?? ""}${canonicalQuery(location?.search ?? "", route, registry)}`
  + `${location?.hash ?? ""}`;

const currentAddress = (location) =>
  `${location?.pathname ?? ""}${location?.search ?? ""}${location?.hash ?? ""}`;

/**
 * Wire /evolution.html to the address bar.
 *
 * `history` and `location` are injected rather than read off `window` so the
 * whole thing can be driven by a test double — the harness these tests run
 * against has no History at all, and a module that reached for a global would
 * simply be untested.
 */
export function installDestinationRouting(document, {
  history, location, registry = FINOPS_DESTINATIONS, target,
} = {}) {
  const replace = (route) => {
    const next = routeAddress(location, route, registry);
    if (next === currentAddress(location)) return false;
    history?.replaceState?.(null, "", next);
    return true;
  };

  /**
   * Select a destination and record it in history.
   *
   * One entry, and none at all when the address would not change. The state
   * object carries the slug so a consumer of `popstate` could read it, but
   * nothing here depends on it: the URL is the state, and a history entry
   * written by an older build must still resolve.
   */
  const select = (request, { push = true } = {}) => {
    const route = typeof request === "string" || request === null || request === undefined
      ? parseDestinationRoute(request, registry)
      : parseDestinationRoute({ search: canonicalQuery("", request, registry) }, registry);
    const next = routeAddress(location, route, registry);
    if (push && next !== currentAddress(location)) {
      history?.pushState?.({ [DESTINATION_PARAM]: route.slug }, "", next);
    }
    return applyDestinationRoute(document, route, { registry });
  };

  // Boot. The address is parsed before anything else paints a door, and a route
  // that did not resolve normalizes the URL so a reload is a clean front door.
  const booted = parseDestinationRoute(location, registry);
  const applied = applyDestinationRoute(document, booted, { registry });
  if (booted.status !== ROUTE_STATUS.absent) replace(booted);

  // In-page doors are routed rather than followed: following would put a bare
  // `#finops-stand` on the address, which is a second encoding for the same
  // fact and the thing this module exists not to do.
  document?.addEventListener?.("click", (event) => {
    const door = event?.target?.closest?.("[data-front-door-slug]");
    const slug = door?.dataset?.frontDoorSlug;
    if (!slug) return;
    if (!(door.getAttribute?.("href") ?? "").startsWith("#")) return;
    event.preventDefault?.();
    select({ slug });
  });

  // Restoring state must never write state.
  const onPopState = () => applyDestinationRoute(
    document, parseDestinationRoute(location, registry), { registry });
  (target ?? document)?.addEventListener?.("popstate", onPopState);

  /**
   * Re-apply the current address without moving the reader.
   *
   * The bundled analysis paints its department controls long after boot, so a
   * `?department=` that arrived on a cold load has nothing to press the first
   * time through. The page calls this once that surface exists. It re-reads the
   * address rather than trusting a captured route, and it scrolls nothing: a
   * reader who has already started reading must not be thrown back up the page
   * by a late fixture.
   */
  const refresh = () => applyDestinationRoute(
    document, parseDestinationRoute(location, registry), { registry, move: false });

  return Object.freeze({ applied, select, onPopState, replace, refresh });
}
