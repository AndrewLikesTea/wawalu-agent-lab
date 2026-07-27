// One decision-status vocabulary, in one place.
//
// Three surfaces name a decision's status — the record form, the history
// filter, and a rendered record (list row, detail page, and the breakdown on a
// release). They used to each carry their own list, and the lists disagreed:
// the form offered Pending and Approved, the filter offered Approved, Pending,
// Proposed, Accepted and Superseded, and every seeded record rendered
// "accepted". "Approved" and "Accepted" were two words for one state that no
// record could tell apart, and the filter offered a status the form could not
// produce.
//
// The words below are the whole vocabulary. Nothing renders a status word that
// is not here.
//
// The list is deliberately not app.js's: releases.js documents that it will not
// import the decision module, and the decision detail page has no reason to.
// Three call sites is the seam that earns a shared module.

// The canonical statuses, in lifecycle order. The filter offers them in this
// order and the glossary on the decisions page defines them in this order.
export const DECISION_STATUSES = Object.freeze([
  "proposed",
  "pending",
  "accepted",
  "superseded",
]);

// "approved" was the second word for "accepted". It is gone from every control,
// but a returning visitor's browser can still hold records the old form wrote,
// and an old export can still be imported. So it stays a legal *stored* value
// and is read as "accepted" everywhere a visitor sees or filters it. The stored
// record is never rewritten; only the label diverges.
export const LEGACY_DECISION_STATUSES = Object.freeze({ approved: "accepted" });

// Every value that may arrive from storage or an import. Order is the order the
// import error message lists them in.
export const STORED_DECISION_STATUSES = Object.freeze([
  "pending",
  "approved",
  "proposed",
  "accepted",
  "superseded",
]);

// Fold a stored value onto the word a visitor reads. Unknown values pass
// through untouched: validation, not display, decides what is storable.
export function canonicalDecisionStatus(status) {
  return LEGACY_DECISION_STATUSES[status] ?? status;
}
