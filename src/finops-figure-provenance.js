// Where one published figure came from — one record shape, reused for every figure.
//
// THE PROBLEM THIS SOLVES. #831 left /evolution.html with one consolidated
// answer: one headline metric and one next action. A CFO who is about to repeat
// that percentage to a board has no way to check it. The confidence sentence
// says how much was covered; it does not say WHICH inputs were consumed, HOW
// MANY records fed them, WHAT was done to them, or WHEN. Those four things are
// what makes a number checkable rather than quotable, and they are the four
// field groups every record below carries.
//
// THREE RULES THIS FILE EXISTS TO HOLD
//
// 1. NOTHING IS WRITTEN, EVERYTHING IS READ. A record is built from values the
//    computation already produced. `inputTap()` below is how: the figure's own
//    code reads its operands through `read(path)`, and the record's `inputs` is
//    exactly the set of paths that code asked for. Adding an operand to a figure
//    changes its record with no edit here and no edit at the figure's definition
//    site, which is the property that makes a provenance record worth reading.
//
// 2. KEY NAMES, NEVER VALUES. `inputs` is a list of symbolic key paths. A value
//    cannot arrive in it by construction — `inputTap` records the path, not what
//    it resolved to — and `symbolicInputs()` is the second gate: an entry that is
//    not a bare dotted identifier is dropped, so a cell, a prompt, a header
//    string, or a token that reached this list by some future accident is not
//    rendered and not exported.
//
//    WHY THE FORBIDDEN-NAME LIST IS LOCAL rather than
//    `FORBIDDEN_FIELD_PATTERN` from finops-briefing-contract.js. This module is
//    on the answer block's minimal path: src/finops-answer-summary.js states, and
//    tests/finops-answer-summary.test.js pins, that the bundled answer may not
//    reach the briefing contract directly OR TRANSITIVELY. Importing it here
//    would put the whole contract back in that path. The list below is
//    deliberately the narrow one — the names that would make a KEY NAME itself a
//    leak — and the briefing file keeps the wider scan it already runs over the
//    whole payload.
//
// 3. NO CLOCK. `computedAt` is an argument. This module never reads one, at
//    import time or at call time, so a caller's injected clock is the only clock.
//
// The record is emitted as ISO-8601 and unrounded counts. Formatting for a
// reader is the surface's job — finops-stand-view.js does it with the same
// `Intl` formatters the rest of this page uses.

/** Bump when a field, a group, or what one means changes. */
export const FIGURE_PROVENANCE_VERSION = "finops-figure-provenance/1.0.0";

/**
 * The aggregations a figure on this page is computed by, named once.
 *
 * A method label is the one field a computation cannot publish about itself, so
 * it is declared here as a shared vocabulary rather than typed as prose beside
 * each figure. The `rule` half of the method IS derived — it is the computing
 * module's own published version string — so a change to the computation moves
 * the label with no edit here.
 */
export const AGGREGATION = Object.freeze({
  ratioOfSums: "ratio of two sums",
  largestGroup: "largest single group, ties broken by key order",
  stateOnly: "selected from the export's state alone",
  publishedTotal: "the analysis's own published total",
});

/**
 * A bare dotted identifier and nothing else. `provenance.rows` passes; a prompt,
 * a header string with a space in it, a quoted value, and `sk-…` do not.
 */
const SYMBOLIC_KEY = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/;

/**
 * Key names that are a leak even as names. Narrow on purpose — see rule 2 above.
 */
const FORBIDDEN_KEY = /(prompt|excerpt|transcript|conversation|completion|email|apikey|accesstoken|bearertoken|credential|password|secret|authorization|token)/i;

/**
 * The input list, reduced to symbolic key names.
 *
 * @param inputs an array of key paths, or an object whose OWN KEYS are the
 *   operand names — the shape a figure that already publishes its operands is
 *   in, so `symbolicInputs(figure.inputs)` needs no second list to be kept
 *   in step with the first.
 * @returns a frozen, sorted, de-duplicated array. Never null.
 */
export function symbolicInputs(inputs) {
  const names = Array.isArray(inputs) ? inputs
    : (inputs && typeof inputs === "object" ? Object.keys(inputs) : []);
  const kept = new Set();
  for (const name of names) {
    const text = typeof name === "string" ? name.trim() : "";
    if (!SYMBOLIC_KEY.test(text)) continue;
    if (FORBIDDEN_KEY.test(text.replace(/\./g, ""))) continue;
    kept.add(text);
  }
  return Object.freeze([...kept].sort());
}

/** A non-negative whole count, or null when nothing countable was supplied. */
function sampleCountOf(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : null;
}

/** An ISO-8601 instant from a Date, a timestamp, or an ISO string. Null, never a guess. */
function instantOf(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? date.toISOString() : null;
}

/**
 * ONE PROVENANCE RECORD, for any figure on this page.
 *
 * Four field groups and nothing else: `inputs` (which keys were consumed),
 * `samples` (how many records fed them, in the figure's own unit), `method`
 * (how they were combined, and under which published rule), and `computedAt`.
 *
 * `empty` is derived, not passed: a figure that consumed no named input AND read
 * no record has nothing behind it, and a surface that renders an empty list, a
 * bare "0" and a timestamp for that state is showing a reader four slots of
 * furniture instead of saying so.
 */
export function figureProvenance({
  figure, label = null, inputs = [], sampleCount = null, sampleUnit = "record",
  aggregation = null, rule = null, computedAt = null,
} = {}) {
  const names = symbolicInputs(inputs);
  const count = sampleCountOf(sampleCount);
  const unit = typeof sampleUnit === "string" && sampleUnit.trim() ? sampleUnit.trim() : "record";
  const method = typeof aggregation === "string" && aggregation ? aggregation : null;
  const published = typeof rule === "string" && rule ? rule : null;
  return Object.freeze({
    version: FIGURE_PROVENANCE_VERSION,
    /** Which figure this record explains. The export keys on it; nothing is positional. */
    figure: typeof figure === "string" && figure ? figure : null,
    /** The figure's own name, for a surface that renders the record beside it. */
    label: typeof label === "string" && label ? label : null,
    inputs: names,
    samples: Object.freeze({ count, unit }),
    method: Object.freeze({
      aggregation: method,
      rule: published,
      label: method && published ? `${method} · ${published}` : method ?? published,
    }),
    computedAt: instantOf(computedAt),
    empty: names.length === 0 && !(count > 0),
  });
}

/**
 * A reader that remembers what a computation asked for.
 *
 * `read("action.cluster")` returns the value and records the path. The figure's
 * `inputs` is then `keys()` — the operands the code actually consumed on the
 * branch it took, not a list someone maintained beside it. A branch that reads
 * nothing records nothing, which is exactly how the degenerate states end up
 * saying they have no inputs rather than claiming the ones they skipped.
 *
 * Deliberately a function rather than a Proxy: `gradeExport()` returns a frozen
 * object, and a Proxy that returned wrapped children for its non-configurable,
 * non-writable properties would violate the invariant and throw.
 */
export function inputTap(source) {
  const keys = new Set();
  return Object.freeze({
    read(path) {
      const value = String(path).split(".")
        .reduce((held, step) => (held === null || held === undefined ? undefined : held[step]),
          source);
      // ASKED FOR IS NOT CONSUMED. A path that resolved to nothing was not an
      // input to anything, and listing it would let a figure computed from an
      // empty verdict claim seven operands it never had. `null` IS recorded: a
      // published null — a coverage with no denominator — is a value the
      // computation read and branched on.
      if (value !== undefined) keys.add(path);
      return value;
    },
    keys: () => Object.freeze([...keys]),
  });
}
