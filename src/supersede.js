// One relationship, stored in exactly one direction.
//
// A decision records the id of the decision it replaced on `supersedes`. The
// reverse direction ("this decision was superseded by …") is *derived* here and
// nowhere else: there is no `superseded_by` field, so no writer has to keep two
// fields in step and the two directions can never disagree. Everything that
// needs the reverse link — the detail banner, the history filter, the import
// round trip — reads it from indexSupersessions.
//
// Nothing in this module touches the DOM or storage, so the rules stay testable
// on their own.

export const SUPERSEDE_ERRORS = {
  self: "A decision cannot supersede itself.",
  unknown: "That decision is not in this log. Choose a decision that still exists.",
  type: "A supersede link must be a decision id.",
};

// "" and undefined both mean "no link". Normalizing here keeps the empty select
// option, an absent field, and a whitespace-only stored value on one path.
export function normalizeSupersedes(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validate one supersede link against the decisions that exist right now.
 * Returns null when the link is acceptable, otherwise the message the UI shows
 * inline. `id` is the id of the decision carrying the link (absent for a record
 * that does not have one yet), and `decisions` is the current log.
 */
export function validateSupersedes(value, { id = "", decisions = [] } = {}) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return SUPERSEDE_ERRORS.type;
  const target = normalizeSupersedes(value);
  if (target === "") return null;
  if (id && target === id) return SUPERSEDE_ERRORS.self;
  return decisions.some((decision) => decision?.id === target) ? null : SUPERSEDE_ERRORS.unknown;
}

// Two decisions can point at the same predecessor (a fork in the log). The
// banner names one successor, so the choice is pinned to the earliest recorded
// replacement — with the id as a tie-break — rather than to array order, which
// varies between stored, demo, and imported records.
function earliest(a, b) {
  const byDate = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (!Number.isNaN(byDate) && byDate !== 0) return byDate < 0 ? a : b;
  return String(a.id) <= String(b.id) ? a : b;
}

/**
 * Build both directions from the stored one. A link is only indexed when its
 * target exists in this set and is not the decision itself, so a dangling or
 * self reference can never produce a banner or hide a row.
 *
 * Returns `{ supersededBy, replaces }`: maps from decision id to the decision
 * that replaced it, and to the decision it replaced.
 */
export function indexSupersessions(decisions = []) {
  const byId = new Map();
  for (const decision of decisions) {
    if (decision && typeof decision.id === "string") byId.set(decision.id, decision);
  }
  const supersededBy = new Map();
  const replaces = new Map();
  for (const decision of decisions) {
    if (!decision || typeof decision.id !== "string") continue;
    const target = normalizeSupersedes(decision.supersedes);
    if (!target || target === decision.id || !byId.has(target)) continue;
    replaces.set(decision.id, byId.get(target));
    const known = supersededBy.get(target);
    supersededBy.set(target, known ? earliest(known, decision) : decision);
  }
  return { supersededBy, replaces };
}

// Convenience reads for a single decision, so a view never rebuilds the index
// itself and the "derived, never stored" rule holds in one place.
export function successorOf(decisions, id) {
  return indexSupersessions(decisions).supersededBy.get(id) ?? null;
}

export function predecessorOf(decisions, id) {
  return indexSupersessions(decisions).replaces.get(id) ?? null;
}

export function isSuperseded(decisions, id) {
  return indexSupersessions(decisions).supersededBy.has(id);
}

// The history header states the active filter and what it removed, in one line.
export function formatSupersedeSummary(current, hidden) {
  return `${current} current, ${hidden} superseded hidden`;
}
