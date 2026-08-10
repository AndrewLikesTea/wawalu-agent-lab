// One URL per AI FinOps destination, and the department it was opened on.
//
// WHAT THIS CLOSES (#1522). The workspace shell already gave each destination a
// fragment, so `#workspace-departments` opens the department screen and back
// walks between screens. What it did not give a reader was the *selection*: a
// lead who drilled into Backend and sent the link sent "the departments screen",
// and the recipient landed on whichever department happened to rank first. The
// address described the screen and not the reading.
//
// So a route here is two things and never more: a destination slug, and an
// optional selection inside it. Both are validated against the destination map
// in src/finops-destination-regions.js (#1521) on the way in. Nothing else on
// the address is trusted, and nothing else on the address is touched.
//
// ---------------------------------------------------------------------------
// WHY THE HASH FOR THE DESTINATION AND THE QUERY FOR THE SELECTION
// ---------------------------------------------------------------------------
//
// Neither half is a free choice; both are already claimed.
//
// The destination is the hash because it ALREADY IS. `DESTINATION_FRAGMENT` in
// src/finops-workspace-nav.js is what the rail's doors carry, what the shell
// resolves, and what is in readers' address bars and bookmarks today. A router
// that moved the destination to a query parameter would be a second encoding for
// a published fact and would strand every saved link on the day it shipped.
//
// The selection is a query parameter because the hash has three claimants
// already — the shared-briefing `#brief=` payload, this page's in-page deep
// links, and the five destination fragments — and a fourth is the collision that
// silently drops somebody's shared brief. src/destination-route.js states that
// rule at length and reserves `destination`, `scope` and `department` on the
// query for the front-door route. Those three are SPOKEN FOR: `canonicalQuery`
// rewrites them from the front-door route and drops what it cannot place, so a
// selection written as `?department=` would be deleted by the next destination
// change. This module therefore owns exactly one name of its own, `dept`, which
// is foreign to `canonicalQuery` and is carried through its rewrites in its
// original bytes. The two routers do not fight over one slot because they do not
// share one.
//
// ---------------------------------------------------------------------------
// EVERY PARSE RESOLVES TO A DESTINATION. THE STATUS SAYS HOW IT GOT THERE.
// ---------------------------------------------------------------------------
//
// `slug` is never null: a route that could not be read resolves to the answer,
// because the alternative is a page that renders nothing at the address someone
// was sent. Five statuses, and there is no sixth:
//
//   ok                     A destination this map holds, with a selection it
//                          accepts or with none.
//   absent                 No fragment and no selection. An ORDINARY open, which
//                          is the answer, and not an error.
//   foreign                A fragment this router does not own. See below.
//   unsupported-selection  A `dept` value the resolved destination does not
//                          accept — an unknown id, or any id at a destination
//                          that is not read per department.
//   malformed              Not an address at all, or a value whose percent
//                          encoding does not decode.
//
// `correct` is true for exactly the two statuses this router can prove are its
// own failures. Those get a replace-style navigation so a reload does not
// re-trigger the fallback, and `fallback()` below is the single code path that
// produces all of them.
//
// A FOREIGN FRAGMENT IS NOT A FAILURE, and this is the one place the shape here
// departs from "unknown slug lands on the answer". `#recommendation-evidence`,
// `#workspace-restore` and every other in-page deep link this page has shipped
// for a year are fragments this router does not own but the shell resolves
// perfectly well. Rewriting them away would break saved links to close the
// theoretical case of a fragment nobody owns. So `foreign` resolves to the
// answer — which is what a cold load already shows, and therefore what an
// unresolvable fragment already lands on — carries `owned: false` so the caller
// leaves the destination to whoever does own it, and corrects nothing.
//
// ---------------------------------------------------------------------------
// BOUNDED SURFACE
// ---------------------------------------------------------------------------
//
// `parseScreenRoute` / `serializeScreenRoute` are mutually inverse over
// (slug, selection) — `screenRoute()` states the pair a status-carrying record
// reduces to — and `createScreenRouter` adds `current`, `subscribe` and
// `navigate` and nothing else. It reads no DOM. It writes no Location: a
// `pushState` already moves the document URL, and assigning `location.search`
// in a real browser is a full page load.

import { DEFAULT_DESTINATION, DESTINATION_FRAGMENT } from "./finops-workspace-nav.js";
import { destinationRegions, destinationSelections } from "./finops-destination-regions.js";

/** The one query parameter this module owns. Nothing else on the address is ours. */
export const SELECTION_PARAM = "dept";

/** The five statuses. There is no sixth. */
export const SCREEN_ROUTE_STATUS = Object.freeze({
  ok: "ok",
  absent: "absent",
  foreign: "foreign",
  unsupportedSelection: "unsupported-selection",
  malformed: "malformed",
});

/** Where an address that cannot be read resolves to. The answer, always. */
export const FALLBACK_SLUG = DEFAULT_DESTINATION;

/**
 * The longest requested value this module hands back. A URL can carry kilobytes;
 * a log line or a failure message naming one is still a sentence a person reads.
 */
export const MAX_REQUESTED_LENGTH = 80;

const clamp = (text) => {
  const value = String(text ?? "");
  return value.length > MAX_REQUESTED_LENGTH
    ? `${value.slice(0, MAX_REQUESTED_LENGTH - 1)}…`
    : value;
};

/** One decode attempt. `null` — never a replacement character — means "no". */
const decode = (raw) => {
  try {
    return decodeURIComponent(String(raw).replace(/\+/g, " "));
  } catch {
    return null;
  }
};

const record = (status, fields = {}) => Object.freeze({
  status,
  slug: FALLBACK_SLUG,
  selection: null,
  owned: true,
  correct: false,
  requestedSlug: null,
  requestedSelection: null,
  ...fields,
});

/**
 * THE ONE FALLBACK PATH. Every failure in this module ends here, so "what does a
 * bad address do" has one answer to read and one place to change.
 */
const fallback = (status, fields = {}) => record(status, {
  correct: status === SCREEN_ROUTE_STATUS.unsupportedSelection
    || status === SCREEN_ROUTE_STATUS.malformed,
  owned: status !== SCREEN_ROUTE_STATUS.foreign,
  ...fields,
});

/** The destination one owned fragment names, or null. */
export function slugForFragment(hash) {
  const wanted = String(hash ?? "");
  if (wanted === "") return null;
  return Object.keys(DESTINATION_FRAGMENT)
    .find((slug) => DESTINATION_FRAGMENT[slug] === wanted) ?? null;
}

/** The fragment one destination owns, or "" when the map does not hold it. */
export const fragmentForSlug = (slug) => DESTINATION_FRAGMENT[String(slug ?? "")] ?? "";

/**
 * The address of whatever was handed in, or `null` when its structure cannot be
 * interpreted at all.
 *
 * Accepts a `URL`, anything location-shaped, a full URL string, a `?a=b#c`
 * string and a `#c` string. `null`/`undefined`/`""` are an ordinary open rather
 * than a structural failure. A bare word is NOT an address: `parse("department")`
 * and `parse("#workspace-departments")` must not be the same call, because only
 * one of them came off a URL.
 */
function addressOf(input) {
  if (input === null || input === undefined) return { search: "", hash: "" };
  if (typeof input === "string") {
    const raw = input.trim();
    if (raw === "") return { search: "", hash: "" };
    const cut = raw.indexOf("#");
    const hash = cut >= 0 ? raw.slice(cut) : "";
    const head = cut >= 0 ? raw.slice(0, cut) : raw;
    const mark = head.indexOf("?");
    const search = mark >= 0 ? head.slice(mark) : "";
    const path = mark >= 0 ? head.slice(0, mark) : head;
    if (path !== "" && !path.startsWith("/") && !path.includes("://")) return null;
    return { search, hash };
  }
  if (typeof input !== "object") return null;
  if (typeof input.hash === "string" || typeof input.search === "string") {
    return { search: String(input.search ?? ""), hash: String(input.hash ?? "") };
  }
  if (typeof input.href === "string") return addressOf(input.href);
  return null;
}

/**
 * One parameter's raw value, or `undefined` when the query does not carry it.
 *
 * Values are left RAW and each name is decoded on read, individually: this page
 * puts base64url share payloads on the query, and a parser that refused the
 * whole string because a neighbouring parameter did not decode would be a new
 * way to lose a shared brief. First occurrence wins — a repeated parameter is
 * not a second opinion.
 */
function rawParam(search, wanted) {
  for (const chunk of String(search ?? "").replace(/^\?/, "").split("&")) {
    if (chunk === "") continue;
    const eq = chunk.indexOf("=");
    const name = decode(eq < 0 ? chunk : chunk.slice(0, eq));
    if (name === wanted) return eq < 0 ? "" : chunk.slice(eq + 1);
  }
  return undefined;
}

/**
 * Parse an address into a route. Never throws: every failure is a status, and a
 * parser that threw on a hand-typed URL would be a blank page.
 */
export function parseScreenRoute(input) {
  const address = addressOf(input);
  if (!address) return fallback(SCREEN_ROUTE_STATUS.malformed);

  const hash = address.hash;
  const slug = hash === "" ? FALLBACK_SLUG : slugForFragment(hash);
  const raw = rawParam(address.search, SELECTION_PARAM);

  // A fragment somebody else owns. Resolve to the answer for a caller that has
  // nothing better, but claim nothing and rewrite nothing.
  if (slug === null) return fallback(SCREEN_ROUTE_STATUS.foreign, { requestedSlug: clamp(hash) });

  if (raw === undefined) {
    return record(hash === "" ? SCREEN_ROUTE_STATUS.absent : SCREEN_ROUTE_STATUS.ok, { slug });
  }

  const selection = decode(raw);
  if (selection === null) {
    return fallback(SCREEN_ROUTE_STATUS.malformed, { requestedSelection: clamp(raw) });
  }
  // Validated against the map, never against a list kept here. A destination
  // that accepts no selection and one that does not accept THIS selection are
  // the same answer, because both address a reading this page cannot show.
  if (!destinationSelections(slug).includes(selection)) {
    return fallback(SCREEN_ROUTE_STATUS.unsupportedSelection, {
      requestedSlug: clamp(hash), requestedSelection: clamp(selection),
    });
  }
  return record(SCREEN_ROUTE_STATUS.ok, { slug, selection });
}

/**
 * The (slug, selection) pair a route reduces to, with both validated.
 *
 * This is what `serializeScreenRoute` is inverse over: an unreadable address and
 * an ordinary open both reduce to the answer with no selection, so a status is
 * not recoverable from a URL and is not meant to be.
 */
export function screenRoute(route) {
  const slug = destinationRegions(route?.slug) ? route.slug : FALLBACK_SLUG;
  const selection = route?.selection ?? null;
  return Object.freeze({
    slug,
    selection: selection !== null && destinationSelections(slug).includes(String(selection))
      ? String(selection)
      : null,
  });
}

/**
 * A route as the address suffix that opens it: `"?dept=backend#workspace-departments"`.
 *
 * One order, one encoding, values percent-encoded exactly once, and a selection
 * the destination does not accept omitted rather than emitted — so this is
 * idempotent over its own output and inverse to `parseScreenRoute` over the pair
 * `screenRoute()` states.
 */
export function serializeScreenRoute(route) {
  const { slug, selection } = screenRoute(route);
  const query = selection === null
    ? ""
    : `?${SELECTION_PARAM}=${encodeURIComponent(selection)}`;
  return `${query}${fragmentForSlug(slug)}`;
}

/**
 * The whole address for a route, every parameter belonging to somebody else
 * intact.
 *
 * Only `dept` is rewritten; every foreign parameter is carried through in its
 * original raw bytes, in its original order. That is what makes it safe to
 * `replaceState` a corrected address on load — the reader keeps their shared
 * brief, their front-door route and their campaign tag — and it is the other
 * half of not fighting `canonicalQuery` over one query string.
 */
export function screenRouteAddress(location, route) {
  const { slug, selection } = screenRoute(route);
  const foreign = [];
  for (const chunk of String(location?.search ?? "").replace(/^\?/, "").split("&")) {
    if (chunk === "") continue;
    const eq = chunk.indexOf("=");
    if (decode(eq < 0 ? chunk : chunk.slice(0, eq)) === SELECTION_PARAM) continue;
    foreign.push(chunk);
  }
  const ours = selection === null
    ? [] : [`${SELECTION_PARAM}=${encodeURIComponent(selection)}`];
  const parts = [...ours, ...foreign];
  return `${location?.pathname ?? ""}${parts.length ? `?${parts.join("&")}` : ""}`
    + `${fragmentForSlug(slug)}`;
}

const currentAddress = (location) =>
  `${location?.pathname ?? ""}${location?.search ?? ""}${location?.hash ?? ""}`;

/**
 * Wire an address bar to a listener.
 *
 * `history` and `location` are injected rather than read off `window` for the
 * reason #1326 injects them: the address is the state, and a module that reached
 * for a global could not be driven by a test double at all.
 *
 * The correction runs at construction, before any listener exists, so a reader
 * whose link named a department that is not there has a clean URL by the time
 * anything paints — and a reload does not re-trigger the fallback.
 */
export function createScreenRouter({ history, location, target } = {}) {
  const listeners = new Set();
  let current = parseScreenRoute(location);

  const write = (route, replace) => {
    const next = screenRouteAddress(location, route);
    if (next === currentAddress(location)) return false;
    const state = { screenRoute: route.slug, screenSelection: route.selection ?? null };
    if (replace) history?.replaceState?.(state, "", next);
    else history?.pushState?.(state, "", next);
    return true;
  };

  const announce = (route) => {
    current = route;
    for (const listener of [...listeners]) listener(route);
    return route;
  };

  // The bad fragment is dropped here and nowhere else. `foreign` and `absent`
  // are left exactly as the reader had them.
  if (current.correct) {
    const corrected = parseScreenRoute(serializeScreenRoute(current));
    write(corrected, true);
    current = Object.freeze({ ...corrected, correctedFrom: current.status });
  }

  /** Re-read the address. Restoring state must never write state. */
  const onPopState = () => announce(parseScreenRoute(location));
  target?.addEventListener?.("popstate", onPopState);
  target?.addEventListener?.("hashchange", onPopState);

  return Object.freeze({
    /** The route now on the address, as this router last resolved it. */
    current: () => current,

    /**
     * Listen. Fires once immediately with the resolved route — a cold load is a
     * route change like any other — and again on every history move.
     */
    subscribe(listener) {
      if (typeof listener !== "function") return () => false;
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },

    /**
     * Go to a route, recording it in history.
     *
     * One entry, and none at all when the address would not change: pushing an
     * identical URL is what makes back appear to unwind scroll instead of moving
     * between destinations. Listeners are told either way, because "apply this
     * route" is true whether or not the URL moved.
     */
    navigate(route, { replace = false } = {}) {
      const next = parseScreenRoute(serializeScreenRoute(route));
      const moved = write(next, replace);
      announce(next);
      return moved;
    },

    dispose() {
      listeners.clear();
      target?.removeEventListener?.("popstate", onPopState);
      target?.removeEventListener?.("hashchange", onPopState);
    },
  });
}
