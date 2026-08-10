// Addresses written before the page was shortened, still landing somewhere real.
//
// WHAT BROKE. #1498 consolidated /evolution.html down to one canonical answer
// region — `finops-recoverable-answer` — with a single supporting-detail layer
// (`finops-answer-support`) folded inside it. The move was deliberate and the
// surviving ids were kept where possible, but it did not survive intact: three
// sibling disclosures in the readiness region became one, so two published
// fragment ids stopped resolving. Anything holding one of those addresses — a
// share link copied out of the address bar before the consolidation, a bookmark,
// a link in somebody's chat history — now opens the page and lands at the top of
// the document with no indication that the thing it named ever existed.
//
// THE SHIM IS ONE MAP AND ONE RESOLVER, and it is here rather than spread across
// the callers on purpose. An old id is answered by a table lookup, never by a
// prefix match: `analysis-readiness-*` is a family with two retired members and
// several live ones, and a rule that guessed from the shape of a string would
// forward the live ones too. Every entry below is a decision somebody made in a
// consolidation commit, written down once.
//
// IT NEVER THROWS AND IT NEVER LEAVES A READER NOWHERE. An id this page does not
// know, and does not have, resolves to the canonical answer region: a reader who
// followed a stale link reads the page's one answer instead of a blank first
// screen. An id that IS on the page is left exactly as it is — the fallback is
// for addresses that resolve to nothing, not a redirect for the whole document.
//
// LOCAL ONLY. A fragment is replaced in place through `replaceState`, so there
// is no request, no navigation, no history entry and no server coupling. Nothing
// here reads or writes storage, and nothing here is reversible only by a deploy.

import { ANSWER_SPINE, ROLE } from "./finops/answer-spine-view.js";

/**
 * The region the shortened page answers in, and the destination of last resort.
 *
 * It is the region that carries the canonical recoverable figure, the grade and
 * pricing provenance beside it, and — since #1498 — the supporting-detail layer
 * every demoted region was folded into. A reader sent here has landed on the
 * answer, which is the honest outcome for an address that named a region the
 * page no longer has.
 */
export const CANONICAL_ANSWER_REGION_ID = "finops-recoverable-answer";

/** Region fragments the answer manifest itself declares retired, and their heir. */
export const RETIRED_ANCHOR_TARGETS = Object.freeze(Object.fromEntries(
  ANSWER_SPINE
    .filter((entry) => entry.role === ROLE.retired)
    .map((entry) => [entry.id, entry.supersededBy]),
));

/**
 * THE alias map: every id an older build published, and the id that owns its
 * question now. One constant, one place, explicit both sides.
 *
 * The manifest's own retired regions come first because the spine already states
 * them and restating them here would be a second source of truth. The entries
 * after it are id-level merges the spine cannot express: a `details` element is
 * not a spine region, so the manifest has no vocabulary for "these three
 * disclosures became one" and the record has to live somewhere.
 *
 * A value here must be an id that is actually on the shortened page. The test
 * beside this file asserts exactly that against the shipped markup, so an entry
 * pointing at a second retired id fails the suite rather than forwarding a
 * reader from one missing target to another.
 */
export const CONSOLIDATED_REGION_ALIASES = Object.freeze({
  ...RETIRED_ANCHOR_TARGETS,
  // #1498. The readiness region shipped three sibling disclosures — the verdict,
  // the figure's working, and what later evidence would enable — for one
  // question. They are one control now, `analysis-readiness-detail`, and every
  // line the other two carried is inside it under the same ids.
  "analysis-readiness-how-we-know": "analysis-readiness-detail",
  "analysis-readiness-upgrade-detail": "analysis-readiness-detail",
});

/** How an id was answered. A caller branches on this rather than re-deriving it. */
export const RESOLVED_BY = Object.freeze({
  absent: "absent",
  alias: "alias",
  live: "live",
  canonical: "canonical",
  missing: "missing",
});

/**
 * A fragment that carries a `key=value` payload rather than naming an element.
 *
 * This page spends its hash twice: `#brief=<token>` carries a shared briefing,
 * and `#<id>` is an ordinary anchor. `sharedBriefingToken` tells them apart by
 * the `=`, and this uses the same rule for the same reason — rewriting a brief
 * token to the canonical region would silently drop somebody's shared figures,
 * which is a far worse outcome than the stale anchor this file exists to fix.
 */
const carriesPayload = (fragment) => fragment.includes("=");

/** The element id a fragment names, or "" for none and for a payload fragment. */
export function anchorId(hash) {
  const raw = String(hash ?? "");
  const fragment = raw.startsWith("#") ? raw.slice(1) : raw;
  if (fragment === "" || carriesPayload(fragment)) return "";
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * Answer "what on today's page owns this id?" for one id.
 *
 * @param id the id an older build published, or a live one.
 * @param doc the document to check live ids against. Without one there is no way
 *   to tell a live id from a missing one, so only the alias map is consulted and
 *   an unrecognised id is left alone — a resolver that guessed would forward
 *   perfectly good anchors on every page that is not this one.
 * @param fallback whether an id that resolves to nothing becomes the canonical
 *   answer region. On for navigation, where landing nowhere is the defect. Off
 *   for slot lookup, where the canonical region is a whole region and writing a
 *   sentence into it would destroy the answer.
 * @returns `{ requested, id, reason }`, frozen. `id` is null when there is
 *   nothing to point at. Never throws.
 */
export function resolveRegionTarget(id, doc = null, { fallback = true } = {}) {
  const requested = typeof id === "string" ? id : "";
  const answer = (target, reason) => Object.freeze({ requested, id: target, reason });
  if (requested === "") return answer(null, RESOLVED_BY.absent);

  const has = (candidate) => (doc?.getElementById
    ? Boolean(doc.getElementById(candidate))
    : null);
  const canonical = () => (fallback
    ? answer(CANONICAL_ANSWER_REGION_ID, RESOLVED_BY.canonical)
    : answer(null, RESOLVED_BY.missing));

  const alias = CONSOLIDATED_REGION_ALIASES[requested];
  if (alias) return has(alias) === false ? canonical() : answer(alias, RESOLVED_BY.alias);

  const live = has(requested);
  // No document to ask: the id is not aliased, so it is not ours to move.
  if (live === null) return answer(requested, RESOLVED_BY.live);
  return live ? answer(requested, RESOLVED_BY.live) : canonical();
}

/** The node an id — or the id that superseded it — names, or null. No fallback. */
export const resolveRegionElement = (doc, id) => {
  const resolved = resolveRegionTarget(id, doc, { fallback: false });
  return resolved.id ? doc?.getElementById?.(resolved.id) ?? null : null;
};

/**
 * Forward the address in place, without adding a history entry or a request.
 *
 * Returns the id the address now names, or null when it was left alone. The
 * replacement happens before the ordinary deep-link disclosure path runs, so the
 * handler that unfolds disclosures reads the forwarded id rather than the stale
 * one — `replaceState` fires no `hashchange`, which is what makes that ordering
 * a fact rather than a race.
 */
export function forwardRetiredAnchor(win, doc = null) {
  const requested = anchorId(win?.location?.hash);
  const resolved = resolveRegionTarget(requested, doc);
  if (!resolved.id || resolved.id === requested) return null;

  const hash = `#${encodeURIComponent(resolved.id)}`;
  if (win.history?.replaceState) {
    win.history.replaceState(win.history.state ?? null, "", hash);
  } else {
    win.location.hash = hash;
  }
  return resolved.id;
}

/**
 * Forward now, and on every later hash change.
 *
 * A share link pasted into a tab that is already open arrives as a `hashchange`
 * and never passes through boot, so forwarding once was only ever half the fix.
 * Registered before `installDeepLinkDisclosure` so the rewrite lands first and
 * the disclosure handler opens the surviving target's ancestors.
 *
 * Returns a teardown, so a page that boots twice in one document (a test, a
 * bfcache restore) does not accumulate listeners.
 */
export function installRetiredAnchorForwarding(win, doc = null) {
  const forward = () => forwardRetiredAnchor(win, doc);
  forward();
  if (typeof win?.addEventListener !== "function") return () => {};
  win.addEventListener("hashchange", forward);
  return () => win.removeEventListener?.("hashchange", forward);
}
