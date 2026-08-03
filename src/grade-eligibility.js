// Grade eligibility — is this grade representative of our spend?
//
// The score card prints one letter for the whole organization. That letter is a
// spend-weighted roll-up of departments the scoring rubric actually sampled, and
// nothing on the card has ever said how much of the money was in that sample. A
// confident "B" over a quarter of the budget is not a cautious answer; it is a
// wrong one. This module answers the one question that has to be settled before
// the letter is read at all, and refuses to answer a second.
//
// ---------------------------------------------------------------------------
// Metric definition. Two engineers reading this must produce the same number.
// ---------------------------------------------------------------------------
//
//   record              one department in the analysed set — the same list
//                       `summarize` rolls up. The import grain above a
//                       department is the organization, and the grain below it
//                       is a prompt this product never sees, so the department
//                       is the only unit that can be both spent and scored.
//
//   total_imported_spend
//                       `summarize(departments).spendUsd` — the accessor the
//                       headline already treats as authoritative. It is not
//                       re-summed here, and it is not filtered by period,
//                       department, or model. Calling `summarize` also means a
//                       negative or non-finite `spendUsd` is coerced exactly the
//                       way the printed total coerces it, so the denominator and
//                       the number beside it cannot disagree.
//
//   scored query        a department is *covered* when `departmentPerformance`
//                       returns `available: true` — sampling status is
//                       `available`, the sampled-query count is a positive
//                       integer, and the category mix carries at least one
//                       non-zero share. That is precisely "the rubric consumed
//                       it and produced a score". A department the rubric
//                       skipped, could not classify, or reported a reason for is
//                       not covered, and no partial credit is invented for it.
//
//   covered_spend       `summarize(covered).spendUsd` — the same accessor over
//                       the covered subset, so covered and total are the same
//                       field measured the same way.
//
//   sampled_spend_coverage
//                       covered_spend / total_imported_spend, as a raw ratio in
//                       [0, 1]. Never rounded here: presentation owns the
//                       percentage.
//
// Weighting is by spend, not by query count, and that is the whole point. One
// department burning $40k that nobody sampled matters more than five hundred
// sampled queries in a team spending pocket change. The leader is asking about
// their money.
//
// A total of 0, a negative total, or a missing one has no coverage. It is not
// 0% and it is not tier zero: it is `no_spend_baseline`, and the grade is
// withheld rather than graded badly.
//
// ---------------------------------------------------------------------------
// Deliberate omissions
// ---------------------------------------------------------------------------
//
// * No second metric. Sampled-query counts, freshness dates, and per-category
//   confidence intervals all exist upstream and none of them answers "is this
//   grade representative of our spend?". They would be surface.
// * No explanatory prose. The strings this module returns are the only text the
//   surface ships; a copywriter owns anything longer, later.
// * No numeric confidence score. The tier is a five-value enum with a published
//   threshold per member, matching the trust verdict's refusal to invent one.

import { departmentPerformance, formatUsd, summarize } from "./evolution.js";
import { TRUST_LABEL } from "./finops-display.js";

/** Bump this when a `reason` changes meaning. Labels may be reworded freely. */
export const GRADE_ELIGIBILITY_VERSION = "sampled-spend-coverage/1.0.0";

/**
 * The thresholds, ordered high to low and read with `>=`, so a boundary value
 * belongs to the better tier. Published as data because the number a reader
 * disputes should be visible without reading a branch.
 */
export const COVERAGE_TIERS = Object.freeze([
  Object.freeze({
    tier: "high", floor: 0.80, state: "graded", showGrade: true, reason: "sufficient_coverage",
    label: `${TRUST_LABEL.available} · high confidence`,
    rule: "At least 80% of imported spend sits in departments the rubric scored.",
  }),
  Object.freeze({
    tier: "moderate", floor: 0.50, state: "graded", showGrade: true, reason: "sufficient_coverage",
    label: `${TRUST_LABEL.available} · moderate confidence`,
    rule: "Half to four-fifths of imported spend was scored; the letter stands, with the figure beside it.",
  }),
  Object.freeze({
    tier: "provisional", floor: 0.25, state: "provisional", showGrade: true, reason: "provisional_coverage",
    label: `${TRUST_LABEL.partial} · provisional grade`,
    rule: "A quarter to a half of spend was scored. The letter is shown and marked not actionable alone.",
  }),
  Object.freeze({
    tier: "insufficient", floor: 0, state: "not_gradeable", showGrade: false, reason: "insufficient_coverage",
    label: `${TRUST_LABEL.needsReview} · insufficient coverage`,
    rule: "Under a quarter of spend was scored. No letter is shown.",
  }),
]);

/** The tier for an import with no denominator at all. Not a coverage of zero. */
export const NO_BASELINE_TIER = Object.freeze({
  tier: "no_baseline", floor: null, state: "not_gradeable", showGrade: false,
  reason: "no_spend_baseline",
  label: `${TRUST_LABEL.needsReview} · no spend baseline`,
  rule: "No positive imported spend total exists, so coverage is undefined and no letter is shown.",
});

/** Set alongside the tier when the inputs are internally inconsistent. */
export const CLAMPED_REASON = "coverage_exceeds_baseline";

function tierFor(ratio) {
  return COVERAGE_TIERS.find((entry) => ratio >= entry.floor) ?? COVERAGE_TIERS[COVERAGE_TIERS.length - 1];
}

/**
 * The metric on its own, so the arithmetic can be disputed without a department
 * list. `ratio` is null exactly when there is no baseline to divide by; the
 * caller never has to distinguish that from a measured zero.
 *
 * TWO SOURCES OF COVERAGE, NEVER COLLAPSED (#1008). `coveredUsd` is spend the
 * scoring rubric consumed upstream. `readerClassifiedUsd` is spend a reader
 * classified themselves against the published rubric, on the page, because a
 * billing-only import carries no scored query sample at all. They are added to
 * make one threshold decision and are returned apart from each other, because a
 * leader is entitled to know which half of their coverage came from a judge and
 * which half came from a colleague's dropdown. No caller may print the sum
 * without printing the split beside it.
 *
 * @returns {{ratio, clamped, coveredUsd, totalUsd, importedUsd, readerClassifiedUsd,
 *   importedShare, readerClassifiedShare, coveredShare}}
 */
export function sampledSpendCoverage({ coveredUsd, totalUsd, readerClassifiedUsd = 0 } = {}) {
  const total = Number(totalUsd);
  const covered = Number(coveredUsd);
  const reader = Number(readerClassifiedUsd);
  // Missing, non-finite, zero, and negative totals are one case: there is no
  // denominator. Dividing would produce Infinity, NaN, or a negative ratio, and
  // every one of those would be printed as if it were measured.
  if (!Number.isFinite(total) || total <= 0) {
    return Object.freeze({
      ratio: null, clamped: false, coveredUsd: 0, totalUsd: 0,
      importedUsd: 0, readerClassifiedUsd: 0,
      importedShare: null, readerClassifiedShare: null, coveredShare: null,
    });
  }
  const safeImported = Number.isFinite(covered) && covered > 0 ? covered : 0;
  const safeReader = Number.isFinite(reader) && reader > 0 ? reader : 0;
  const safeCovered = safeImported + safeReader;
  const clamped = safeCovered > total;
  // Under a clamp the sum is pinned to 1 and each part keeps its own measured
  // share. The parts then no longer sum to the whole, which is exactly the
  // inconsistency `CLAMPED_REASON` exists to report rather than to smooth over.
  const ratio = clamped ? 1 : safeCovered / total;
  return Object.freeze({
    ratio,
    clamped,
    coveredUsd: safeCovered,
    totalUsd: total,
    importedUsd: safeImported,
    readerClassifiedUsd: safeReader,
    importedShare: Math.min(1, safeImported / total),
    readerClassifiedShare: Math.min(1, safeReader / total),
    coveredShare: ratio,
  });
}

/**
 * The one action. Ranked, never a list:
 *   1. the grouping value whose uncovered spend is largest,
 *   2. the generic widen when the data carries no grouping value,
 *   3. import billing data when there is no denominator at all.
 * Ties break lexicographically on the group key so the same input always yields
 * the same sentence.
 */
function nextActionFor(tier, groups) {
  if (tier.tier === "no_baseline") {
    return Object.freeze({
      kind: "import_billing", available: true, step: "select", control: "local-finops-files",
      group: null, uncoveredUsd: 0,
      text: "Import billing data. Coverage has no denominator until a spend total exists.",
    });
  }
  if (tier.tier === "high") {
    return Object.freeze({
      kind: "none", available: true, step: null, control: null, group: null, uncoveredUsd: 0,
      text: "None needed. The scored sample already covers most of the imported spend.",
    });
  }
  // No control on this page widens a sample: scoring happens upstream of the
  // import. Saying so beats linking to a step that would not move the number.
  const ranked = [...groups].sort((left, right) => right.uncoveredUsd - left.uncoveredUsd
    || String(left.key).localeCompare(String(right.key)));
  const top = ranked[0];
  if (!top) {
    return Object.freeze({
      kind: "widen", available: false, step: null, control: null, group: null, uncoveredUsd: 0,
      text: "Widen the scored sample. The import carries no grouping field to aim it at.",
    });
  }
  return Object.freeze({
    kind: "widen_group", available: false, step: null, control: null,
    group: top.key, uncoveredUsd: top.uncoveredUsd,
    text: `Widen the sample for ${top.key}: ${formatUsd(top.uncoveredUsd)} of its spend has no scored query.`,
  });
}

/**
 * Assemble the verdict from an already-computed coverage figure. Exported so the
 * clamp path — inputs the department layer cannot produce, but a future caller
 * could — is pinned by a fixture rather than trusted.
 */
export function gradeEligibilityFromCoverage(coverage, { groups = [] } = {}) {
  const tier = coverage.ratio === null ? NO_BASELINE_TIER : tierFor(coverage.ratio);
  return Object.freeze({
    version: GRADE_ELIGIBILITY_VERSION,
    question: "Is this grade representative of our spend?",
    state: tier.state,
    tier: tier.tier,
    // The one flag a consuming surface cannot accidentally ignore: suppressing
    // the letter is the entire point of this module.
    showGrade: tier.showGrade,
    provisional: tier.state === "provisional",
    coverage: coverage.ratio,
    // The same figure as `coverage`, plus the two halves it was made of. Kept
    // as three fields rather than one so a surface can say "X% imported and
    // rubric-scored + Y% you classified" without re-deriving either part.
    coveredShare: coverage.coveredShare ?? coverage.ratio,
    importedShare: coverage.importedShare ?? coverage.ratio,
    readerClassifiedShare: coverage.readerClassifiedShare ?? (coverage.ratio === null ? null : 0),
    coveredUsd: coverage.coveredUsd,
    readerClassifiedUsd: coverage.readerClassifiedUsd ?? 0,
    totalUsd: coverage.totalUsd,
    reason: coverage.clamped ? CLAMPED_REASON : tier.reason,
    tierReason: tier.reason,
    rule: tier.rule,
    label: tier.label,
    nextAction: nextActionFor(tier, groups),
  });
}

/** The grouping value a department is named by, or null when it carries none. */
function groupKey(department) {
  const name = typeof department?.name === "string" ? department.name.trim() : "";
  if (name) return name;
  const id = typeof department?.id === "string" ? department.id.trim() : "";
  return id || null;
}

/**
 * @param {Array} departments the analysed set, exactly as `summarize` takes it.
 * @param {object} [options]
 * @param {string[]} [options.readerClassifiedNames] department names a reader
 *   classified against the published rubric on the page. They count toward the
 *   coverage threshold — a department a person put in a rubric category is a
 *   department the rubric has an opinion about — and they are excluded from the
 *   uncovered ranking, because naming a department the reader has already dealt
 *   with as the next thing to widen is an instruction they have followed.
 *   Matching is on the trimmed grouping name, the same key the ranking uses.
 * @returns the eligibility verdict: one tier, one coverage ratio, one action.
 */
export function gradeEligibility(departments = [], { readerClassifiedNames = [] } = {}) {
  const list = Array.isArray(departments) ? departments : [];
  const claimed = new Set((Array.isArray(readerClassifiedNames) ? readerClassifiedNames : [])
    .map((name) => String(name ?? "").trim()).filter(Boolean));
  const covered = [];
  const uncovered = [];
  const readerClassified = [];
  for (const department of list) {
    if (departmentPerformance(department).available) covered.push(department);
    // Rubric-scored wins over reader-classified for the same department: a
    // judge's verdict is not overwritten by a dropdown, and counting one
    // department in both halves would print a coverage split that oversums.
    else if (claimed.has(groupKey(department) ?? "")) readerClassified.push(department);
    else uncovered.push(department);
  }
  // Both sides go through the same accessor, so "covered" and "total" are the
  // same field measured the same way and the ratio cannot exceed 1 here.
  const coverage = sampledSpendCoverage({
    coveredUsd: summarize(covered).spendUsd,
    readerClassifiedUsd: summarize(readerClassified).spendUsd,
    totalUsd: summarize(list).spendUsd,
  });

  const byGroup = new Map();
  for (const department of uncovered) {
    const key = groupKey(department);
    if (!key) continue;
    // One department's uncovered spend is its whole spend: coverage is decided
    // per department, so there is no partially covered group to apportion.
    const spend = summarize([department]).spendUsd;
    byGroup.set(key, (byGroup.get(key) ?? 0) + spend);
  }
  const groups = [...byGroup.entries()]
    .filter(([, uncoveredUsd]) => uncoveredUsd > 0)
    .map(([key, uncoveredUsd]) => ({ key, uncoveredUsd }));

  return gradeEligibilityFromCoverage(coverage, { groups });
}
