// Coverage over a reader's own imported corpus, decided by the MULTI-FAMILY
// classifier, plus the residue that is keeping coverage down.
//
// WHAT CHANGED AND WHY THIS FILE EXISTS. Coverage on the imported path was
// decided by one family of evidence: `classifyQuery` reads an excerpt against a
// table of English keyword patterns, and a record it cannot match falls to
// `unclassified` and out of the numerator. A German prompt with three labelled
// lines, a six-turn re-prompt spiral, and a one-line rename on a premium model
// are all readable as structure — `classifyThread` reads exactly those, across
// five declared families — and every one of them used to count as a gap in the
// reader's data rather than as evidence. This module recomputes coverage from
// `classifyThread` and reports what is STILL unclassified as ranked clusters, so
// the next action is "resolve this cluster" rather than "widen the sample".
//
// ---------------------------------------------------------------------------
// Metric definitions. Two engineers reading this must produce the same number.
// ---------------------------------------------------------------------------
//
//   record            one in-memory imported query record. It carries an org
//                     unit, a model, token counts, and EITHER a category the
//                     source declared or a bounded prompt excerpt. Nothing here
//                     reads a file, a network, or storage, and no excerpt or
//                     anything derived from one appears in a returned object.
//
//   scored_denominator
//                     the summed spend of every record in the corpus, scored or
//                     not. It is the denominator for coverage AND for every
//                     cluster share below, so a cluster's share and the coverage
//                     it would return are the same arithmetic read twice.
//
//   scored_spend      the summed spend of records the classifier placed in a
//                     rubric category. A record that matches SEVERAL families
//                     counts ONCE: `classifyThread` returns one winning class
//                     and lists the families that voted for it, so the families
//                     are evidence for a single verdict, never buckets a
//                     record's spend is split between or added to twice.
//
//   coverage          scored_spend / scored_denominator, handed to
//                     `sampledSpendCoverage` and then to the SAME tier lookup
//                     the department path uses. `COVERAGE_TIERS`, its floors,
//                     its labels and its withholding rules are imported, never
//                     restated: this module changes what is measured, not what
//                     the thresholds are or what a withheld grade says.
//
//   residue cluster   the unclassified records that share a cluster key, with
//                     the key derived from the record's own normalized text.
//                     `coveragePoints` is the percentage points coverage would
//                     return if the whole cluster were resolved, which is the
//                     cluster's share of the scored denominator times 100 —
//                     stated as one number rather than left for a reader to
//                     multiply.
//
// DETERMINISM IS A PRODUCT REQUIREMENT HERE, not a nicety. A cluster key is
// derived from the record's own normalized fields and from nothing else: not
// from array index, not from insertion or iteration order, not from a
// timestamp, not from `Date.now()`, not from randomness, and not from object
// identity. The returned array is sorted explicitly — share descending, then by
// the cluster key with a plain string comparison — so two equal-share clusters
// cannot swap places between runs, and no output ordering rides on Map
// insertion order.
//
// ---------------------------------------------------------------------------
// Deliberate omissions
// ---------------------------------------------------------------------------
//
// * No second tier table. The floors and the withheld-grade wording are
//   `grade-eligibility.js`'s, imported.
// * No rate card. This repository ships none (see `down-routing-candidates.js`),
//   so a corpus with no money in it is weighted by billed tokens and SAYS SO
//   through `unit`. A surface that prints a currency symbol over a token count
//   would be inventing the one number this page refuses to invent.
// * No persistence, no network, no rendering. Pure functions over the records a
//   caller already holds in memory.

import {
  COVERAGE_TIERS, gradeEligibilityFromCoverage, sampledSpendCoverage,
} from "./grade-eligibility.js";
import { PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";
import { classifyThread } from "./query-classification.js";

/** Bump when a field, a key rule, or the coverage definition changes meaning. */
export const CORPUS_FAMILY_COVERAGE_VERSION = "corpus-family-coverage/1.0.0";

/** The two units a corpus can be weighted in, and what each one is called. */
export const SPEND_UNIT = Object.freeze({
  usd: Object.freeze({ id: "usd", label: "USD" }),
  tokens: Object.freeze({ id: "billed_tokens", label: "billed tokens" }),
});

/** The cluster key for a record whose every grouping field is blank. */
export const RESIDUE_UNKEYED = "(unlabelled)";

/** The rubric's own category keys. Read from the rubric; never a second copy. */
const CATEGORY_KEYS = new Set(PROMPT_LITERACY_RUBRIC.categories.map((entry) => entry.key));

/**
 * Normalize one grouping value: trim, collapse every run of whitespace to a
 * single space, lower-case. Three ordinary spellings of one vendor — a trailing
 * space, a tab in the middle, a capitalized first letter — are one cluster.
 */
function normalizeKeyText(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The cluster a record belongs to, from the record's OWN fields, in one stated
 * order: the vendor it was billed under, the category the source declared, the
 * model that ran it, then the org unit it was attributed to.
 *
 * Order matters and is a judgement: a reader resolving unclassified spend acts
 * on a vendor or a workload name before they act on a team, because that is the
 * grain their export can be re-cut at. A record with none of the four is keyed
 * `RESIDUE_UNKEYED` and clusters with the other unkeyed records rather than
 * being dropped — dropping it would quietly shrink the residue this exists to
 * name.
 */
export function residueClusterKey(record) {
  for (const value of [record?.vendor, record?.category, record?.model, record?.orgUnitId]) {
    const normalized = normalizeKeyText(value);
    if (normalized) return normalized;
  }
  return RESIDUE_UNKEYED;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** The record's own money, when it carries any. Zero is "no money on this row". */
function usdOf(record) {
  return positiveNumber(record?.spendUsd) || positiveNumber(record?.costUsd);
}

/** The record's billed tokens — the only spend-proportional field a query sample carries. */
function billedTokensOf(record) {
  return positiveNumber(record?.inputTokens) + positiveNumber(record?.outputTokens);
}

/**
 * Which unit the whole corpus is weighted in, decided ONCE for the corpus.
 *
 * One unit per corpus on purpose: if any row carries money, the corpus is
 * measured in money and an unpriced row weighs 0, because adding a token count
 * into a dollar sum is two units in one number and no reader could tell which.
 */
function unitFor(records) {
  return records.some((record) => usdOf(record) > 0) ? SPEND_UNIT.usd : SPEND_UNIT.tokens;
}

const spendReaderFor = (unit) => (unit === SPEND_UNIT.usd ? usdOf : billedTokensOf);

/**
 * The turns `classifyThread` reads, built in memory and never returned.
 *
 * A record that already carries a normalized thread is passed through; a query
 * sample carries one bounded excerpt, which is one user turn. Both shapes reach
 * the same five families — an excerpt still carries labelled lines, enumerated
 * lines, code fences, length and the model tier it ran on, which is four of the
 * five — and the fifth (thread repeat) simply does not fire on a single turn.
 */
function turnsOf(record) {
  if (Array.isArray(record?.turns)) return record.turns;
  const excerpt = typeof record?.promptExcerpt === "string" ? record.promptExcerpt
    : typeof record?.excerpt === "string" ? record.excerpt : "";
  return excerpt.trim() ? [{ role: "user", body: excerpt }] : [];
}

/**
 * Classify one record on the multi-family classifier, and report it in the
 * shape this module's arithmetic reads: a class or nothing, the families that
 * decided it, a cluster key, and the record's own spend.
 *
 * A category the SOURCE declared wins without classifying, exactly as the
 * scoring path already treats one: a declared class is the customer's own
 * statement about their row, and re-deciding it here would be this page
 * overruling the file it is reading.
 */
export function classifyCorpusRecord(record, spendOf = billedTokensOf) {
  const spend = positiveNumber(spendOf(record));
  const key = residueClusterKey(record);
  const declared = typeof record?.category === "string" ? record.category : null;
  if (declared && CATEGORY_KEYS.has(declared)) {
    return Object.freeze({
      key, spend, classified: true, category: declared, families: Object.freeze(["declared"]),
      reason: null,
    });
  }
  const verdict = classifyThread({ turns: turnsOf(record), model: record?.model ?? null });
  return Object.freeze({
    key,
    spend,
    // One record, one class, one contribution to scored spend. `families` is the
    // evidence behind that single class and never a list of buckets to add the
    // spend into more than once.
    classified: verdict.classified === true,
    category: verdict.classified ? verdict.category : null,
    families: Object.freeze([...(verdict.families ?? [])]),
    reason: verdict.reason ?? null,
  });
}

/**
 * Rank the unclassified records into clusters. Pure: no I/O, no persistence, no
 * clock, no randomness.
 *
 * @param residue records already decided unclassified, each `{key, spend}`.
 * @param scoredDenominator the corpus-wide denominator every share is taken
 *   against. A denominator of 0 yields a share of 0 rather than a NaN or an
 *   Infinity that would be printed as if it were measured.
 * @returns frozen array, share descending, ties broken on the cluster key.
 */
export function residueClusters(residue = [], scoredDenominator = 0) {
  const total = positiveNumber(scoredDenominator);
  const byKey = new Map();
  for (const entry of Array.isArray(residue) ? residue : []) {
    const key = typeof entry?.key === "string" && entry.key ? entry.key : RESIDUE_UNKEYED;
    const held = byKey.get(key) ?? { key, records: 0, spend: 0 };
    held.records += 1;
    held.spend += positiveNumber(entry?.spend);
    byKey.set(key, held);
  }
  // Sorted explicitly, off an array built from the Map's entries. The Map is a
  // grouping device and its iteration order decides nothing: share descending,
  // then a plain string comparison on the key, so two clusters with equal share
  // are in the same order on every run and on every machine.
  return Object.freeze([...byKey.values()]
    .map((cluster) => {
      const share = total > 0 ? cluster.spend / total : 0;
      return Object.freeze({
        key: cluster.key,
        records: cluster.records,
        spend: cluster.spend,
        share,
        /** Points of coverage resolving this cluster would return. Share, as points. */
        coveragePoints: share * 100,
        // The field `grade-eligibility.js` ranks its next action on. Same number
        // as `spend`, named the way that contract names it, so the action it
        // composes names the top cluster here and cannot rank it differently.
        uncoveredUsd: cluster.spend,
      });
    })
    .sort((left, right) => right.share - left.share || (left.key < right.key ? -1
      : left.key > right.key ? 1 : 0)));
}

/** The one action, when there is a residue cluster to aim it at. */
function residueAction(clusters, unit) {
  const top = clusters[0];
  if (!top) {
    return Object.freeze({
      available: false, cluster: null, coveragePoints: 0,
      text: "No unclassified records remain. Coverage is not being held back by a residue cluster.",
    });
  }
  return Object.freeze({
    available: true,
    cluster: top.key,
    coveragePoints: top.coveragePoints,
    text: `Resolve “${top.key}” first: ${top.records} unclassified `
      + `${top.records === 1 ? "record" : "records"} holding `
      + `${top.coveragePoints.toFixed(1)} points of coverage `
      + `(${top.share === 0 ? "0" : (top.share * 100).toFixed(1)}% of the scored denominator, `
      + `in ${unit.label}).`,
  });
}

/**
 * Coverage for one imported corpus, decided by the multi-family classifier.
 *
 * @param records in-memory imported records. Never mutated, never retained.
 * @returns a frozen result. `eligibility` is `gradeEligibilityFromCoverage`'s
 *   verdict unchanged — the tier, `showGrade`, the label and the rule are the
 *   published ones, so a caller that withholds a letter on `showGrade` withholds
 *   it with the same words the department path already uses.
 */
export function familyCoverage(records = []) {
  const list = (Array.isArray(records) ? records : []).filter(Boolean);
  const unit = unitFor(list);
  const spendOf = spendReaderFor(unit);
  const decided = list.map((record) => classifyCorpusRecord(record, spendOf));
  const scoredDenominator = decided.reduce((sum, entry) => sum + entry.spend, 0);
  const scoredSpend = decided.reduce((sum, entry) => sum + (entry.classified ? entry.spend : 0), 0);
  const clusters = residueClusters(decided.filter((entry) => !entry.classified), scoredDenominator);
  const coverage = sampledSpendCoverage({
    coveredUsd: scoredSpend, totalUsd: scoredDenominator,
  });
  return Object.freeze({
    version: CORPUS_FAMILY_COVERAGE_VERSION,
    unit: unit.id,
    unitLabel: unit.label,
    records: Object.freeze({
      total: decided.length,
      classified: decided.filter((entry) => entry.classified).length,
      unclassified: decided.filter((entry) => !entry.classified).length,
    }),
    scoredSpend,
    scoredDenominator,
    /** Share of the scored denominator the classifier placed. Null with no denominator. */
    scoredShare: coverage.ratio,
    // The tier lookup, unchanged and unreimplemented. The clusters are handed
    // over as this verdict's groups so its own ranked action names the same
    // cluster this module names, rather than a second ranking beside it — but
    // ONLY when the corpus is weighted in money, because that verdict's sentence
    // formats its figure as USD and a currency symbol over a token count is the
    // one number this page refuses to invent. On a token-weighted corpus the
    // action a surface prints is `residueAction` below, which states its unit.
    eligibility: gradeEligibilityFromCoverage(coverage, {
      groups: unit === SPEND_UNIT.usd ? clusters : [],
    }),
    residue: clusters,
    residueAction: residueAction(clusters, unit),
  });
}

/**
 * The two lines a surface prints: one number, and one next action.
 *
 * The number is the share of the scored denominator that is classified, with
 * the tier's own published label beside it — a coverage figure printed without
 * the tier that reads it is the shape this page exists to prevent. The withheld
 * states carry `COVERAGE_TIERS`' wording verbatim, because the label and the
 * rule here ARE that table's strings.
 */
export function coverageHeadline(result) {
  if (!result || result.scoredShare === null) {
    return Object.freeze({
      available: false,
      showGrade: result?.eligibility?.showGrade === true,
      number: null,
      text: result?.eligibility?.label ?? COVERAGE_TIERS[COVERAGE_TIERS.length - 1].label,
      rule: result?.eligibility?.rule ?? "",
      action: result?.eligibility?.nextAction?.text ?? "",
    });
  }
  const percent = `${(result.scoredShare * 100).toFixed(1)}%`;
  return Object.freeze({
    available: true,
    showGrade: result.eligibility.showGrade,
    number: result.scoredShare,
    text: `${percent} of this corpus's ${result.unitLabel} was classified on structural `
      + `evidence · ${result.eligibility.label}`,
    rule: result.eligibility.rule,
    action: result.residueAction.text,
  });
}
