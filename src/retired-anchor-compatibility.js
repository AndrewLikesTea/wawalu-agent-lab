// Where an id written by an EARLIER build of this page lands on this one.
//
// Two kinds of stale id reach this module, and they arrive by two routes that
// have nothing else in common: a fragment in a link somebody saved or sent, and
// a region pointer inside a payload this browser persisted. Both are strings
// naming a region that was true when they were written. Neither can be repaired
// where it is stored — the link is in somebody's mail and the payload is in a
// reader's `localStorage` — so the repair happens on the way IN, once, here.
//
// THE MAP IS EXPLICIT AND THE FALLBACK IS TOTAL. `MERGED_ANCHOR_TARGETS` is
// hand-written, one line per id the consolidation merged away, because a derived
// map can only know about regions something still declares and these ids are
// declared by nothing — that is what makes them stale. Everything the map does
// not name and the document does not carry degrades to the canonical answer
// region rather than to nowhere: an id this build cannot place is a reader who
// followed a link to the FinOps answer, and the answer is a page they can be
// given. Landing them on a blank viewport, or throwing on the way, is the
// failure this file exists to prevent.
import { ANSWER_SPINE, ROLE } from "./finops/answer-spine-view.js";

/** Retired region fragments and the live region that now owns their question. */
export const RETIRED_ANCHOR_TARGETS = Object.freeze(Object.fromEntries(
  ANSWER_SPINE
    .filter((entry) => entry.role === ROLE.retired)
    .map((entry) => [entry.id, entry.supersededBy]),
));

/**
 * The one region that states the reconciled recoverable figure (#1502).
 *
 * The degrade target, and deliberately a region and not a control: sending a
 * reader with a stale link to the page's one answer is orientation; sending them
 * to something that acts is a decision nobody asked this module to make.
 */
export const CANONICAL_ANSWER_REGION = "finops-recoverable-answer";

/**
 * Ids the consolidation merged away, and the surviving target that took their
 * content. One entry per id, added when the id stops being rendered.
 *
 * #1504 folded three readiness disclosures into one, so the two it removed name
 * the disclosure that now holds what they held. They are NOT pointed at the
 * canonical answer region: a reader who saved "how we know" wanted the evidence,
 * and the evidence still exists under a different id. The fallback below is for
 * ids whose content is genuinely gone, not for ids somebody can be given.
 */
export const MERGED_ANCHOR_TARGETS = Object.freeze({
  "analysis-readiness-how-we-know": "analysis-readiness-detail",
  "analysis-readiness-upgrade-detail": "analysis-readiness-detail",
});

/** Every alias this build honours: the spine's retirements and the merges. */
export const ANCHOR_ALIASES = Object.freeze({
  ...RETIRED_ANCHOR_TARGETS,
  ...MERGED_ANCHOR_TARGETS,
});

/** A cycle or a chain longer than this is a mistake in the map, not a target. */
const MAX_ALIAS_HOPS = 4;

/**
 * Walk the alias chain to its end, or return the id unchanged.
 *
 * Bounded and cycle-guarded rather than trusted, because the map is hand-written
 * and this runs on the boot path: a typo that pointed two entries at each other
 * would otherwise hang the page before anything painted.
 */
export function aliasedAnchorTarget(id) {
  const start = typeof id === "string" ? id.trim() : "";
  if (start === "") return "";
  let current = start;
  const seen = new Set([current]);
  for (let hop = 0; hop < MAX_ALIAS_HOPS; hop += 1) {
    const next = ANCHOR_ALIASES[current];
    if (typeof next !== "string" || next === "" || seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current;
}

/**
 * The id on THIS page that a saved id should resolve to. Never throws, and never
 * returns an id the document does not carry.
 *
 * The document is the authority, not the map: an alias whose target was itself
 * removed by a later change degrades exactly as an unmapped id does, so the map
 * going stale costs a reader precision rather than a destination. Called without
 * a document — from a context that has none — it resolves the alias and stops
 * there, because "is this on the page?" is not a question it can answer.
 */
export function canonicalAnchorTarget(id, doc = null) {
  const aliased = aliasedAnchorTarget(id);
  if (!doc?.getElementById) return aliased === "" ? CANONICAL_ANSWER_REGION : aliased;
  if (aliased !== "" && doc.getElementById(aliased)) return aliased;
  return CANONICAL_ANSWER_REGION;
}

/**
 * Forward an old fragment without adding a history entry or making a request.
 * The replacement happens before the ordinary deep-link disclosure path runs.
 *
 * @param win the window whose hash is read and replaced.
 * @param doc the shipped document, when the caller has one. WITH it, an id the
 *   page no longer carries degrades to the canonical answer region; WITHOUT it,
 *   only a declared alias is forwarded and anything else is left alone. A caller
 *   that cannot check the page must not be able to send a reader somewhere on a
 *   guess.
 * @returns the id that was forwarded to, or null when nothing was changed.
 */
export function forwardRetiredAnchor(win, doc = null) {
  const raw = String(win?.location?.hash ?? "").replace(/^#/, "");
  let id;
  try { id = decodeURIComponent(raw); } catch { id = raw; }
  // No fragment is not a stale fragment. A reader who asked for the top of the
  // page is left at the top of the page, and the address bar is untouched.
  if (id === "") return null;
  const target = doc ? canonicalAnchorTarget(id, doc) : ANCHOR_ALIASES[id];
  if (typeof target !== "string" || target === "" || target === id) return null;

  const hash = `#${encodeURIComponent(target)}`;
  if (win.history?.replaceState) {
    win.history.replaceState(win.history.state ?? null, "", hash);
  } else {
    win.location.hash = hash;
  }
  return target;
}
