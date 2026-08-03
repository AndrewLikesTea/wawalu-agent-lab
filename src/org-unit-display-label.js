// The display-label layer over the pseudonymous org-unit identity (#1007).
//
// `orgUnitPseudonym()` in unit-pseudonym.js turns an org-unit cell into
// `psn_…atlas0` at intake, and the analysis renders that as "Department
// …atlas0" — correct, and unreadable: a finance lead knows that unit as
// Platform Engineering. So they may name it, and the name is resolved here.
//
// WHY THIS IS ITS OWN FILE. It belongs to the identity the tabular import
// mints, and src/finops-tabular-import.js re-exports it so that is where a
// reader finds it. It cannot LIVE there: that module and local-finops.js
// already import each other, and a composer reaching into the cycle from the
// outside evaluates it in the wrong order. This file imports nothing, so no
// caller can pull a cycle in behind it.
//
// FOUR PROPERTIES, and each one is a defect this layer exists to prevent:
//
//   1. ONE RESOLVER. `orgUnitDisplayName()` is the only thing that decides the
//      words. The imported headline, the driver sentence and the department
//      drill-down all call it, so a name a reader typed cannot apply in one of
//      the three and not the others. Nothing else reads the label map.
//   2. NOTHING LEAVES THE PAGE. The map is a plain frozen object held in page
//      state and passed down as an argument. This module opens no request,
//      touches no storage, reads no clock, and puts no label into an export, a
//      URL, or a digest — a leader's internal team names are not this demo's
//      business, and the static client-side boundary in PRODUCT.md is
//      unchanged by it.
//   3. KEYED ON IDENTITY, NEVER ON POSITION. The key is the pseudonymous unit
//      id, so a re-sort, a re-render, or a second import that reorders the
//      ranking cannot move a name onto a different team's spend.
//   4. CLEARING RESTORES, IT DOES NOT DELETE. An empty or whitespace-only
//      label is an absent label: the unit goes back to its pseudonym. The
//      imported analysis is never touched by any of this — the label map is a
//      separate value and `withOrgUnitDisplayLabel` returns a NEW one rather
//      than mutating the one it was given.

/** No reader has named anything yet. The starting value, and a valid one. */
export const NO_ORG_UNIT_LABELS = Object.freeze({});

/** Long enough for a real department name, short enough not to be an essay. */
export const MAX_ORG_UNIT_DISPLAY_LABEL = 60;

/** Trim, and treat whitespace-only or over-long as absent rather than as a name. */
function cleanDisplayLabel(value) {
  const label = typeof value === "string" ? value.trim() : "";
  return label && label.length <= MAX_ORG_UNIT_DISPLAY_LABEL ? label : "";
}

function cleanUnitId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return id && id.length <= 128 ? id : "";
}

/**
 * THE resolver: what one org unit is called on screen.
 *
 * Precedence is the reader's label, then the pseudonym the analysis carried,
 * then the raw identity. An unnamed unit renders exactly as it does today, so
 * this layer is invisible until somebody uses it.
 *
 * @param labels a `{ [unitId]: label }` map from page state, or nothing.
 * @param unitId the pseudonymous org-unit identity.
 * @param pseudonym the name the analysis published, e.g. "Department …atlas0".
 */
export function orgUnitDisplayName(labels, unitId, pseudonym = "") {
  const id = cleanUnitId(unitId);
  const label = id ? cleanDisplayLabel(labels?.[id]) : "";
  const fallback = typeof pseudonym === "string" ? pseudonym.trim() : "";
  return label || fallback || id || "Unattributed unit";
}

/** True when this unit shows a name a reader typed rather than its pseudonym. */
export function hasOrgUnitDisplayLabel(labels, unitId) {
  const id = cleanUnitId(unitId);
  return Boolean(id && cleanDisplayLabel(labels?.[id]));
}

/**
 * Set or clear one label, and return the whole map as it now stands.
 *
 * Pure: the map handed in is never mutated and the imported analysis is never
 * reached at all, so clearing a name costs the name and nothing else.
 */
export function withOrgUnitDisplayLabel(labels, unitId, label) {
  const id = cleanUnitId(unitId);
  const source = labels && typeof labels === "object" ? labels : NO_ORG_UNIT_LABELS;
  if (!id) return Object.freeze({ ...source });
  const next = { ...source };
  const clean = cleanDisplayLabel(label);
  if (clean) next[id] = clean;
  else delete next[id];
  return Object.freeze(next);
}
