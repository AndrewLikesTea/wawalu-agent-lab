import { ANSWER_SPINE, ROLE } from "./finops/answer-spine-view.js";

/** Retired region fragments and the live region that now owns their question. */
export const RETIRED_ANCHOR_TARGETS = Object.freeze(Object.fromEntries(
  ANSWER_SPINE
    .filter((entry) => entry.role === ROLE.retired)
    .map((entry) => [entry.id, entry.supersededBy]),
));

/**
 * Ids the FinOps consolidation merged away, and the region that absorbed each.
 *
 * A LITERAL, NOT AN INFERENCE. The manifest above only records a retirement
 * where a whole spine region was deleted. The consolidation did something the
 * manifest has no vocabulary for: it merged three sibling disclosures into one
 * and folded a region inside another, so the ids below name markup that is gone
 * while every region the manifest declares is still there. Guessing at the
 * successor — nearest surviving prefix, fuzzy match — would send a reader
 * somewhere plausible and wrong, so each pairing is written out and reviewed.
 *
 * Sorted by retired id. One comment line each, naming the consolidation that
 * retired it. Additive by construction: delete an entry and the fragment goes
 * back to being unknown, which is the behaviour that shipped before this map.
 */
export const CONSOLIDATED_REGION_ALIAS = Object.freeze({
  // #1504 collapsed the readiness region's three sibling disclosures into one,
  // so the "how we know" table is a group inside the disclosure that survived.
  "analysis-readiness-how-we-know": "analysis-readiness-detail",
  // #1504, the same collapse: the upgrade list moved into that one disclosure.
  "analysis-readiness-upgrade-detail": "analysis-readiness-detail",
});

/**
 * One map, read by both entry points below and by the workspace shell.
 *
 * The manifest's retirements win a collision, because a deleted region is a
 * stronger statement than a merged disclosure and the manifest is validated.
 */
export const REGION_ALIAS = Object.freeze({
  ...CONSOLIDATED_REGION_ALIAS, ...RETIRED_ANCHOR_TARGETS,
});

/**
 * The surviving id for a pre-consolidation one, or null.
 *
 * Total and side-effect free: an unknown or garbage id is null rather than a
 * throw, which is what lets both callers treat "not ours" as "leave the page
 * exactly as it is" instead of as a failure.
 *
 * `Object.hasOwn` and not a plain lookup. The id comes off an address bar, so
 * `#constructor` and `#__proto__` are ids a reader can type: an inherited
 * property answers those with a function and an object, and the caller then
 * asks the document for an element by that name. Own keys only, always.
 */
export function canonicalRegionId(id) {
  if (typeof id !== "string" || id === "") return null;
  return Object.hasOwn(REGION_ALIAS, id) ? REGION_ALIAS[id] : null;
}

/**
 * Forward an old fragment without adding a history entry or making a request.
 * The replacement happens before the ordinary deep-link disclosure path runs.
 */
export function forwardRetiredAnchor(win) {
  const raw = String(win?.location?.hash ?? "").replace(/^#/, "");
  let id;
  try { id = decodeURIComponent(raw); } catch { id = raw; }
  const target = canonicalRegionId(id);
  if (!target) return null;

  const hash = `#${encodeURIComponent(target)}`;
  if (win.history?.replaceState) {
    win.history.replaceState(win.history.state ?? null, "", hash);
  } else {
    win.location.hash = hash;
  }
  return target;
}
