// The one client-side pseudonymization helper for org-unit and model labels.
//
// It was written inside `finops-tabular-import.js` and is lifted here unchanged
// so the native-grouping layer can reuse it rather than grow a second digest.
// There is exactly one implementation of `psn_unit_*` in this repository, and
// this is it: two callers agreeing on a prefix but disagreeing on a digest would
// silently stop joining, which is the failure mode this file exists to prevent.
//
// It is not a security control. It is a stable opaque key inside one browser
// tab, so a customer's project, workspace, key-alias, and tag names — which are
// theirs, not ours — never reach a stored record, a diagnostic, or an exported
// artifact. Nothing here does I/O of any kind.

/** The prefix every org-unit pseudonym carries. Downstream matches on it. */
export const UNIT_PSEUDONYM_PREFIX = "psn_unit_";

/** The prefix every model pseudonym carries. */
export const MODEL_PSEUDONYM_PREFIX = "psn_model_";

/**
 * A non-cryptographic fingerprint (two interleaved FNV-1a style 32-bit lanes).
 * Same input, same output, in every module that imports it.
 */
export function unitDigest(text) {
  let low = 0x811c9dc5;
  let high = 0x9e3779b9;
  const value = String(text ?? "");
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193) >>> 0;
    high = Math.imul(high ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${low.toString(16).padStart(8, "0")}${high.toString(16).padStart(8, "0")}`;
}

/** Case- and spacing-insensitive, so a roster and a usage export join. */
export function unitKey(label) {
  return String(label ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** A grouping label — project, workspace, key alias, tag, account — as a key. */
export function orgUnitPseudonym(label) {
  return `${UNIT_PSEUDONYM_PREFIX}${unitDigest(unitKey(label))}`;
}

/**
 * A model identifier becomes a pseudonym on the same terms an org-unit label
 * does: the per-model analysis needs stable identity, not the vendor's string.
 */
export function modelPseudonym(label) {
  return `${MODEL_PSEUDONYM_PREFIX}${unitDigest(unitKey(label))}`;
}
