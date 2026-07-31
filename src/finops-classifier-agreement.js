// How often the shipped query classifier agrees with a human label.
//
// This module measures `classifyQuery` in `query-classification.js`. It does not
// wrap it, improve it, or fall back to anything when it abstains: the classifier
// is the subject of the measurement, and a scorer that quietly repaired its
// answers would be publishing a number about a classifier nobody ships.
//
// WHAT THE NUMBER IS. Agreement between the classifier and a human reviewer on
// `finops-classifier-agreement-corpus.json` — 150-plus invented queries, each
// labelled from the class definitions published in that file's `$protocol`
// block before any scorer run. It is NOT accuracy on customer traffic, and the
// page that renders it is required to say so in the same breath.
//
// WHY THE CORPUS DISAGREES ON PURPOSE. Some entries are labelled the way a
// reviewer reads them and not the way the keyword table reads them — a
// well-specified prompt that never says "Context:", a trivial task on a
// mid-line model, a retry that arrives carrying a constraint. Those are the
// entries that make the number worth publishing. None of them was relabelled
// after a run.
//
// DETERMINISM. No clock, no randomness, no I/O, no locale-dependent formatting,
// no iteration over a set whose order depends on insertion. Rates are fixed to
// four decimals as strings so a float's shortest repr can never move a byte,
// object keys are sorted on the way out, and arrays are sorted by a declared
// key. Two runs over the same corpus produce byte-identical output; a test
// asserts it rather than trusting this paragraph.
//
// UNTRUSTED INPUT. Corpus queries deliberately include injection-shaped text.
// It is data here and stays data: it is read as a string, handed to the
// classifier, and never rendered by this module, never interpolated into any
// prompt, and never carried into the report — the report holds ids, class
// names, and integers, and nothing else.

import {
  CATEGORY_PRECEDENCE, QUERY_CLASSIFIER_VERSION, UNCLASSIFIED_CATEGORY, classifyQuery,
} from "./query-classification.js";

/** The floor the corpus is held to. Below this, a per-class rate is anecdote. */
export const MINIMUM_CORPUS_ENTRIES = 150;

/** How many decimals every published rate carries, as a fixed-width string. */
const RATE_DECIMALS = 4;

/**
 * The label vocabulary a human reviewer may draw from.
 *
 * The classifier's own four classes plus the explicit `unclassified` label,
 * sorted so this array is stable regardless of how `CATEGORY_PRECEDENCE` is
 * ordered upstream. `unclassified` is a real label with real entries here: a
 * competent, ordinary work query that no rubric class describes.
 */
export const AGREEMENT_LABELS = Object.freeze(
  [...CATEGORY_PRECEDENCE, UNCLASSIFIED_CATEGORY].sort(),
);

/**
 * The tie-break for "weakest class", stated once, in code and in English.
 *
 * Lowest per-class agreement rate wins. A tie goes to the class with the LARGER
 * support, because a low rate over more labelled examples is the better-evidenced
 * weakness. A remaining tie goes to the alphabetically first class name, which
 * settles it without a coin toss. Nothing about the tie-break reads a clock, a
 * hash order, or the corpus's row order, so the caveat a reader sees is
 * reproducible from the fixture alone.
 */
export const WEAKEST_CLASS_TIE_BREAK =
  "Lowest per-class agreement rate; ties broken by larger support, then by class name.";

/** A rate as a fixed-width string. Zero denominator is 0, not NaN. */
function rate(numerator, denominator) {
  return (denominator === 0 ? 0 : numerator / denominator).toFixed(RATE_DECIMALS);
}

/** Human-readable class names, for the surfaces that render the report. */
export const CLASS_LABELS = Object.freeze({
  highValue: "High-value",
  inefficient: "Inefficient",
  outOfScope: "Out-of-scope",
  overProvisioned: "Over-provisioned",
  unclassified: "Unclassified",
});

/** The display name for a class key, falling back to the key itself. */
export function classLabel(key) {
  return CLASS_LABELS[key] ?? String(key);
}

/**
 * Everything wrong with a corpus, as sentences. Empty means well-formed.
 *
 * Separate from scoring on purpose: a malformed corpus should fail a test with
 * the reason named, not produce a plausible number.
 */
export function validateCorpus(corpus) {
  const problems = [];
  const entries = Array.isArray(corpus?.entries) ? corpus.entries : [];
  if (typeof corpus?.corpus_version !== "string" || corpus.corpus_version.trim() === "") {
    problems.push("The corpus declares no corpus_version.");
  }
  if (entries.length < MINIMUM_CORPUS_ENTRIES) {
    problems.push(`The corpus holds ${entries.length} entries; ${MINIMUM_CORPUS_ENTRIES} is the floor.`);
  }
  const seen = new Set();
  for (const entry of entries) {
    const id = entry?.id;
    if (typeof id !== "string" || id.trim() === "") {
      problems.push("An entry has no id.");
    } else if (seen.has(id)) {
      problems.push(`Entry id "${id}" is used more than once.`);
    } else {
      seen.add(id);
    }
    if (typeof entry?.query !== "string" || entry.query.trim() === "") {
      problems.push(`Entry "${id}" has no query text.`);
    }
    if (!AGREEMENT_LABELS.includes(entry?.label)) {
      problems.push(`Entry "${id}" carries label "${entry?.label}", which is not in the declared vocabulary.`);
    }
    if (typeof entry?.rationale !== "string" || entry.rationale.trim() === "") {
      problems.push(`Entry "${id}" has no rationale, so nobody can argue with its label.`);
    }
  }
  return problems;
}

/**
 * Score a corpus against the shipped classifier.
 *
 * `classify` is injectable for tests only; production passes nothing and gets
 * `classifyQuery`. The classifier is handed the entry's query as its excerpt and
 * the entry's model string for the tier gate, which is exactly what the import
 * path hands it — a scorer that fed it a richer record than production does
 * would be measuring a classifier that does not exist.
 */
export function scoreAgreementCorpus(corpus, { classify = classifyQuery } = {}) {
  const entries = Array.isArray(corpus?.entries) ? corpus.entries : [];

  // Counters are seeded for every declared label so a class with no support
  // still appears, as a zero, instead of silently leaving the report.
  const support = new Map(AGREEMENT_LABELS.map((label) => [label, 0]));
  const agreed = new Map(AGREEMENT_LABELS.map((label) => [label, 0]));
  const confusion = new Map(AGREEMENT_LABELS.map((label) => [label, new Map()]));
  let overallAgreed = 0;
  let predictedUnclassified = 0;

  for (const entry of entries) {
    const label = entry?.label;
    if (!support.has(label)) continue;
    const result = classify({ excerpt: entry?.query, model: entry?.model ?? null });
    // `category` is already `unclassified` when the classifier abstains, so the
    // predicted key and the human label share one vocabulary and one comparison.
    const predicted = result?.category ?? UNCLASSIFIED_CATEGORY;
    support.set(label, support.get(label) + 1);
    if (predicted === UNCLASSIFIED_CATEGORY) predictedUnclassified += 1;
    if (predicted === label) {
      agreed.set(label, agreed.get(label) + 1);
      overallAgreed += 1;
    }
    const row = confusion.get(label);
    row.set(predicted, (row.get(predicted) ?? 0) + 1);
  }

  const sampleSize = [...support.values()].reduce((sum, count) => sum + count, 0);

  const perClass = AGREEMENT_LABELS.map((label) => Object.freeze({
    class: label,
    support: support.get(label),
    agreed: agreed.get(label),
    agreementRate: rate(agreed.get(label), support.get(label)),
    // Sorted by predicted class name, never by first-seen order: the row a
    // reader reads must not depend on where an entry sits in the fixture.
    confusion: Object.freeze([...confusion.get(label).entries()]
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .map(([predicted, count]) => Object.freeze({ predicted, count }))),
  }));

  return Object.freeze({
    classifierVersion: QUERY_CLASSIFIER_VERSION,
    corpusVersion: typeof corpus?.corpus_version === "string" ? corpus.corpus_version : null,
    labelVocabulary: AGREEMENT_LABELS,
    overall: Object.freeze({
      agreed: overallAgreed,
      sampleSize,
      agreementRate: rate(overallAgreed, sampleSize),
    }),
    perClass: Object.freeze(perClass),
    predictedUnclassified: Object.freeze({
      count: predictedUnclassified,
      rate: rate(predictedUnclassified, sampleSize),
    }),
    weakestClass: weakestClass(perClass),
  });
}

/**
 * The class the caveat names, by the rule in `WEAKEST_CLASS_TIE_BREAK`.
 *
 * Classes with no support are excluded: a rate over zero examples is not a
 * weakness, it is an absence, and naming one as the weakest class would be the
 * arbitrary number this whole module exists to avoid. Returns null when nothing
 * has support, and the page renders no caveat rather than an invented one.
 */
export function weakestClass(perClass) {
  const measurable = perClass.filter((row) => row.support > 0);
  if (measurable.length === 0) return null;
  const [weakest] = [...measurable].sort((left, right) =>
    Number(left.agreementRate) - Number(right.agreementRate)
    || right.support - left.support
    || (left.class < right.class ? -1 : left.class > right.class ? 1 : 0));
  return Object.freeze({
    class: weakest.class,
    support: weakest.support,
    agreed: weakest.agreed,
    agreementRate: weakest.agreementRate,
    tieBreak: WEAKEST_CLASS_TIE_BREAK,
  });
}

/** Every object key sorted, recursively. Arrays keep their declared order. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

/**
 * The report as a byte-stable artifact.
 *
 * Sorted keys, rates already fixed to four decimals as strings, no timestamp,
 * no locale call, no hash-order iteration. Two runs over the same corpus return
 * identical strings, which is the property that lets a reader recompute the
 * published figure and compare it byte for byte.
 */
export function serializeAgreementReport(report) {
  return `${JSON.stringify(canonical(report), null, 2)}\n`;
}
