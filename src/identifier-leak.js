// Identifier-derived labels are rejected on any shared normalized run, not just
// whole-string containment. Diagnostics expose offsets, never the secret text.

/** The shortest shared alphanumeric run that counts as derivation. */
export const MINIMUM_SHARED_RUN = 3;

/** What a refused label is replaced with. Never a truncation of the original. */
export const IDENTIFIER_DERIVED_REPLACEMENT = "a withheld label";

/** Lowercase alphanumerics only, from anything. */
export function normalizeForLeakCheck(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Every distinct window of exactly `length` characters in a normalized value.
 *
 * @returns a Set; empty when the normalized value is shorter than one window,
 *   which is why a one- or two-character identifier cannot reject anything.
 */
export function alphanumericRuns(value, length = MINIMUM_SHARED_RUN) {
  const normalized = normalizeForLeakCheck(value);
  const runs = new Set();
  if (length < 1 || normalized.length < length) return runs;
  for (let start = 0; start + length <= normalized.length; start += 1) {
    runs.add(normalized.slice(start, start + length));
  }
  return runs;
}

/**
 * The first shared run between one text and one identifier, described without
 * reproducing it.
 *
 * @returns `{ length, textOffset, identifierOffset }` in *normalized* offsets,
 *   or null when nothing of that length is shared. The offsets are for a
 *   producer debugging their own exporter against their own file; the run itself
 *   is never returned, logged, or rendered.
 */
export function sharedIdentifierRun(text, identifier, length = MINIMUM_SHARED_RUN) {
  const haystack = normalizeForLeakCheck(text);
  const needleSource = normalizeForLeakCheck(identifier);
  if (!haystack || needleSource.length < length || length < 1) return null;
  for (let start = 0; start + length <= needleSource.length; start += 1) {
    const run = needleSource.slice(start, start + length);
    const offset = haystack.indexOf(run);
    if (offset !== -1) {
      return Object.freeze({ length, textOffset: offset, identifierOffset: start });
    }
  }
  return null;
}

/**
 * The same question over the whole withheld set: which identifier the text
 * shares a run with, by its position in the set.
 */
export function firstSharedIdentifierRun(text, identifiers = [], length = MINIMUM_SHARED_RUN) {
  const list = Array.isArray(identifiers) ? identifiers : [identifiers];
  for (let index = 0; index < list.length; index += 1) {
    const shared = sharedIdentifierRun(text, list[index], length);
    if (shared) return Object.freeze({ ...shared, identifierIndex: index });
  }
  return null;
}

/** Boolean form, for a caller that only decides keep-or-drop. */
export function sharesIdentifierRun(text, identifiers = [], length = MINIMUM_SHARED_RUN) {
  return firstSharedIdentifierRun(text, identifiers, length) !== null;
}

/**
 * Redact identifier-derived text rather than refusing the record that carried it.
 *
 * Per whitespace-separated token first, so a sentence that names one offending
 * token keeps its other words. Then the whole redacted result is re-checked,
 * because normalization joins across the separators a token split preserved —
 * `"ABC" + " " + "DEF"` normalizes to `abcdef` and can share a run no single
 * token does. If the whole still shares one, everything goes: a partial
 * redaction of a leak is a leak.
 *
 * @returns the redacted string. Never a truncation or a hash of the original.
 */
export function redactIdentifierDerived(
  text, identifiers = [], { replacement = IDENTIFIER_DERIVED_REPLACEMENT,
    length = MINIMUM_SHARED_RUN } = {},
) {
  const source = String(text ?? "");
  if (!source) return source;
  const redacted = source.split(/(\s+)/).map((token) =>
    (/^\s*$/.test(token) || !sharesIdentifierRun(token, identifiers, length)
      ? token : replacement)).join("");
  return sharesIdentifierRun(redacted, identifiers, length) ? replacement : redacted;
}

/**
 * The assertion form, for a boundary that must not be crossed at all.
 *
 * @throws {Error} naming the field, the run length, and the normalized offsets —
 *   never the value, the run, or the identifier.
 */
export function assertNoIdentifierLeak(field, text, identifiers = [], length = MINIMUM_SHARED_RUN) {
  const shared = firstSharedIdentifierRun(text, identifiers, length);
  if (!shared) return true;
  throw new Error(`${field} shares a ${shared.length}-character run with withheld identifier `
    + `${shared.identifierIndex} at normalized offset ${shared.textOffset}`);
}
