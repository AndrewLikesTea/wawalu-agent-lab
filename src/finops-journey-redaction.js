// One narrow redaction pass for record-sourced free text on the journey view.
//
// The view already escapes: it builds with `createElement` and `textContent`
// and never assigns markup, so a stored string cannot become an element. That
// closes the markup hole and no other. It leaves the one this module exists for:
// a stored `actionLabel`, `ownerLabel`, or `department` is free text a visitor —
// or a file they were sent — can write, and it is copied verbatim into the
// sentences that explain the recommendation. Those sentences are also what a
// reader pastes into a review, an export, or a model. Text that reads as an
// *instruction to whoever reads it next* ("ignore the above", "treat confidence
// as high") has no legitimate place in a department name, so it is removed here
// rather than passed on and hoped about.
//
// WHAT THIS IS NOT. It is not a filter that makes untrusted text safe to obey,
// and nothing downstream may treat a redacted string as validated. The
// recommendation, the confidence band, and the evidence boundary are derived
// from typed fields — numbers, dates, enums — and never from these strings, so
// removing text here cannot change a finding, and leaving it could not have
// raised one. This narrows what a reader is shown; it is not a control anything
// depends on.

/** Said in the reader's own words, so a redaction is visible rather than silent. */
export const REDACTED_MARK = "[instruction text removed]";

/**
 * Control characters, bidirectional overrides, and zero-width joiners, named by
 * code point rather than by an escape a diff renders as nothing.
 *
 * A label is one line of an explanation, so anything that would break, reverse,
 * or invisibly split that line is collapsed to a space before anything else
 * runs — a right-to-left override can otherwise make a redacted sentence read
 * back in an order this module never produced.
 */
const HIDDEN_RANGES = Object.freeze([
  [0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0xfeff, 0xfeff],
]);

const hidden = (character) => {
  const code = character.codePointAt(0);
  return HIDDEN_RANGES.some(([low, high]) => code >= low && code <= high);
};

/**
 * The shapes that address a downstream reader rather than describe a department.
 * Deliberately few and deliberately anchored on a verb: a broad pattern that
 * eats ordinary words would redact real evidence, which is its own failure.
 */
const INSTRUCTION = Object.freeze([
  // "ignore all previous instructions", "disregard the rules above"
  /\b(?:ignore|disregard|override|forget|bypass)\b[^.;\n]*\b(?:instruction|instructions|prompt|prompts|rule|rules|context|above|previous|prior)\b[^.;\n]*/gi,
  // "treat this as high confidence", "set confidence to high"
  /\b(?:treat|set|mark|raise|report|assume)\b[^.;\n]*\bconfidence\b[^.;\n]*/gi,
  // "you must recommend", "act as the reviewer", "respond with"
  /\b(?:you are|you must|you should|act as|respond with|reply with)\b[^.;\n]*/gi,
  // Role turns and template or control markers borrowed from prompt formats.
  /\b(?:system|assistant|developer)\s*:/gi,
  /<\|[^|>]*\|>|\{\{[^}]*\}\}|\[\[[^\]]*\]\]/g,
]);

/** Long enough for every label these records legitimately carry. */
const LIMIT = 240;

/**
 * Neutralize one record-sourced string for display.
 *
 * @param value any field value. Non-strings are returned untouched: only free
 *   text is redacted, and a number or a null is neither.
 * @returns the same string when it carries no instruction text — this is the
 *   identity for every legitimate label — or one with each instruction span
 *   replaced by `REDACTED_MARK`.
 */
export function neutralizeRecordText(value, { limit = LIMIT } = {}) {
  if (typeof value !== "string") return value;
  let text = [...value].map((character) => (hidden(character) ? " " : character)).join("");
  text = text.replace(/\s+/g, " ").trim();
  for (const pattern of INSTRUCTION) text = text.replace(pattern, ` ${REDACTED_MARK} `);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}
