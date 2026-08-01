import { ANSWER_SPINE, ROLE } from "./finops/answer-spine-view.js";

/** Retired region fragments and the live region that now owns their question. */
export const RETIRED_ANCHOR_TARGETS = Object.freeze(Object.fromEntries(
  ANSWER_SPINE
    .filter((entry) => entry.role === ROLE.retired)
    .map((entry) => [entry.id, entry.supersededBy]),
));

/**
 * Forward an old fragment without adding a history entry or making a request.
 * The replacement happens before the ordinary deep-link disclosure path runs.
 */
export function forwardRetiredAnchor(win) {
  const raw = String(win?.location?.hash ?? "").replace(/^#/, "");
  let id;
  try { id = decodeURIComponent(raw); } catch { id = raw; }
  const target = RETIRED_ANCHOR_TARGETS[id];
  if (!target) return null;

  const hash = `#${encodeURIComponent(target)}`;
  if (win.history?.replaceState) {
    win.history.replaceState(win.history.state ?? null, "", hash);
  } else {
    win.location.hash = hash;
  }
  return target;
}
