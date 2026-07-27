// What the KPI row, the spend-mix panel, and the cohort comparison say once a
// leader has imported a query sample of their own.
//
// This module computes nothing. Every figure below is read out of a module that
// already owns it:
//
//   grade, composite, per-axis subscores, per-category rows, the unclassified
//   record count, the rubric version   → `scorePromptLiteracy` (prompt-literacy-scoring.js)
//   tier, coverage ratio, showGrade, provisional, the one next action
//                                      → `gradeEligibility*` (grade-eligibility.js)
//   spend, recoverable spend, period, the cohort verdict
//                                      → the imported analysis envelope (local-finops.js)
//   file names                         → `userDatasetProvenance` (local-import-flow.js)
//
// The one thing this file decides is *which of three states the page is in*, and
// it decides it from the eligibility verdict rather than from a truthiness check
// on the sample:
//
//   example        no query sample was selected. The page is untouched.
//   not_gradeable  a sample was selected and `showGrade` is false, or the rubric
//                  scored nothing in it. No figure of any kind is published —
//                  not a zero, not a dash in a grade slot, not a half mix.
//   graded         `showGrade` is true and the rubric produced a composite. The
//                  three panels publish the reader's own figures.
//
// ---------------------------------------------------------------------------
// The adapter, stated plainly
// ---------------------------------------------------------------------------
//
// `gradeEligibility` takes departments and asks `departmentPerformance` whether
// the rubric scored each one. A query sample is not a department list, so this
// module reaches one level lower into the same module — `sampledSpendCoverage`
// and `gradeEligibilityFromCoverage`, both exported for exactly this — and
// supplies the covered subset itself, using that module's own published
// definition of covered: the department has at least one query the rubric
// scored. No threshold, tier, or ratio is redefined here.
//
// A query sample carries no cost field (see `CLASSIFIED_RECORD_KEYS`), so the
// mix published from it is a share of *scored queries*, never of dollars, and
// says so in its own basis line. Inventing a per-query price would be a scoring
// rule, and this is the presentation layer.

import { QUERY_CATEGORIES, formatCount, formatPercent, formatUsd } from "./evolution.js";
import { PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";
import { gradeEligibilityFromCoverage, sampledSpendCoverage } from "./grade-eligibility.js";

/** Bump when a `state` or a key below changes meaning. */
export const GRADED_SAMPLE_FIGURES_VERSION = "graded-sample-figures/1.0.0";

/**
 * The sentence shown when a sample was read but the rubric scored none of it.
 * Authored here because no upstream module ships a reader-facing string for it;
 * the second sentence is the rubric's own `emptyInput` assumption, verbatim, and
 * is the part that must not be softened.
 */
export const NOT_SCORED_MESSAGE =
  "No record in this sample carried a rubric category, so no grade was produced. "
  + "Zero scorable records is not a score of zero.";

/** Used only when no imported analysis envelope is on hand to quote. */
export const NO_COHORT_MESSAGE =
  "Unavailable: a query sample carries no peer cohort and no benchmark methodology.";

const AXIS_LABEL = new Map(PROMPT_LITERACY_RUBRIC.axes.map((axis) => [axis.key, axis]));
const CATEGORY_COPY = new Map(QUERY_CATEGORIES.map((category) => [category.key, category]));

/**
 * The eligibility verdict for a query sample measured against imported spend.
 *
 * @param orgUnitIds the org units the sample actually scored a query for.
 * @param departments the imported analysis envelope's `rankedDepartments`.
 * @param totalUsd the envelope's own `spendUsd` — never re-summed here.
 */
export function querySampleEligibility({ orgUnitIds = [], departments = [], totalUsd = null } = {}) {
  const scoredUnits = new Set([...orgUnitIds].filter((id) => typeof id === "string" && id));
  const list = Array.isArray(departments) ? departments : [];
  let coveredUsd = 0;
  const groups = [];
  for (const department of list) {
    const spend = Number(department?.spendUsd);
    const usd = Number.isFinite(spend) && spend > 0 ? spend : 0;
    if (scoredUnits.has(department?.id)) coveredUsd += usd;
    else if (usd > 0) groups.push({ key: department?.name ?? department?.id ?? "an unnamed unit", uncoveredUsd: usd });
  }
  return gradeEligibilityFromCoverage(
    sampledSpendCoverage({ coveredUsd, totalUsd }), { groups },
  );
}

function provenanceOf(files, rubricVersion) {
  const names = [...files].filter((name) => typeof name === "string" && name);
  return Object.freeze({
    files: Object.freeze(names),
    rubricVersion,
    label: names.length ? `Your data — ${names.join(", ")}` : "Your data",
    detail: `Graded in this tab against ${rubricVersion}. Nothing was uploaded or stored.`,
  });
}

function axisSubscores(scored) {
  return Object.freeze(Object.entries(scored.subscores).map(([key, value]) => Object.freeze({
    key,
    label: AXIS_LABEL.get(key)?.label ?? key,
    weightPercent: AXIS_LABEL.get(key)?.weightPercent ?? null,
    value,
    text: value === null ? "Unavailable" : `${value} / 100`,
  })));
}

function categoryRows(scored) {
  return Object.freeze(scored.categories.map((category) => Object.freeze({
    key: category.key,
    label: category.label,
    records: category.records,
    share: category.share,
    shareText: formatPercent(category.share, { digits: 1 }),
    categoryScore: category.categoryScore,
    scoreText: `${category.categoryScore} / 100`,
  })));
}

/**
 * The record tally the surface publishes.
 *
 * `scorePromptLiteracy` counts only what it was handed, and `classifyQuerySample`
 * has already set the rows it could not categorize aside. Neither number alone is
 * the one a reader asked for, so the two are added here — nothing is recounted
 * and nothing is inferred.
 */
function tally(scored, recordCounts) {
  return Object.freeze({
    total: Number.isFinite(recordCounts?.total) ? recordCounts.total : scored.records.total,
    scored: scored.records.scored,
    unclassified: (Number.isFinite(recordCounts?.unclassified) ? recordCounts.unclassified : 0)
      + scored.records.unclassified,
  });
}

function mixOf(scored, counts) {
  const segments = QUERY_CATEGORIES.map((copy) => {
    const row = scored.categories.find((category) => category.key === copy.key);
    const share = row?.share ?? 0;
    return Object.freeze({
      key: copy.key,
      label: copy.label,
      description: copy.description,
      systemAction: copy.systemAction,
      records: row?.records ?? 0,
      share,
      shareText: formatPercent(share, { digits: 1 }),
      countText: `${formatCount(row?.records ?? 0)} of ${formatCount(counts.scored)} scored queries`,
    });
  });
  return Object.freeze({
    segments: Object.freeze(segments),
    // The basis is not decoration. A reader who reads this bar as dollars would
    // be reading a number nobody measured.
    basis: `Share of the ${formatCount(counts.scored)} queries the rubric scored in your sample. `
      + "A query sample carries no per-query cost, so this is a query mix, not a spend mix.",
    summary: `Your scored query mix: ${segments
      .map((segment) => `${segment.label} ${segment.shareText}`).join(", ")}.`,
  });
}

function cohortOf(cohort) {
  const message = typeof cohort?.message === "string" && cohort.message ? cohort.message : NO_COHORT_MESSAGE;
  const available = cohort?.eligible === true;
  return Object.freeze({
    available,
    answer: available ? "A peer cohort was found in your import." : "No peer cohort in your import.",
    reason: message,
    reasonCode: cohort?.reasonCode ?? "no_compatible_cohort",
  });
}

function kpisOf(scored, counts, { spendUsd, recoverableUsd, period, cohort }) {
  const spendKnown = Number.isFinite(spendUsd) && spendUsd >= 0;
  const recoverableKnown = spendKnown && Number.isFinite(recoverableUsd)
    && recoverableUsd >= 0 && recoverableUsd <= spendUsd;
  const highValue = scored.categories.find((category) => category.key === "highValue");
  return Object.freeze([
    Object.freeze({
      key: "spend", label: "AI spend · period", available: spendKnown,
      value: spendKnown ? formatUsd(spendUsd) : "Not in this sample",
      note: spendKnown
        ? `${period ?? "imported period"} · ${formatCount(counts.scored)} scored queries in your sample`
        : "Your query sample carries no cost field; import a provider export for a spend total.",
    }),
    Object.freeze({
      key: "recoverable", label: "Recoverable spend", available: recoverableKnown,
      value: recoverableKnown ? formatUsd(recoverableUsd) : "Not in this sample",
      note: recoverableKnown
        ? `${formatPercent(spendUsd > 0 ? recoverableUsd / spendUsd : 0)} of your imported spend — down-routing scenario`
        : "No recoverable scenario is published without an imported provider export.",
    }),
    Object.freeze({
      key: "productive", label: "High-value share", available: true,
      value: formatPercent(highValue?.share ?? 0, { digits: 1 }),
      note: `${formatCount(highValue?.records ?? 0)} of ${formatCount(counts.scored)} scored queries — `
        + "share of queries, not of spend",
    }),
    Object.freeze({
      key: "peer", label: "Peer position", available: cohort.available,
      value: cohort.available ? "See cohort comparison" : "Unavailable",
      note: cohort.reason,
    }),
  ]);
}

/**
 * The whole surface, as data.
 *
 * @param scored   `scorePromptLiteracy` output, or null when no sample was read.
 * @param eligibility a `gradeEligibility*` verdict. Required whenever `scored` is.
 * @param files    the imported file names, as the reader spelled them.
 * @param spendUsd, recoverableUsd, period, cohort — from the imported envelope.
 */
export function gradedSampleFigures({
  scored = null, eligibility = null, files = [], spendUsd = null,
  recoverableUsd = null, period = null, cohort = null, recordCounts = null,
} = {}) {
  if (!scored || !eligibility) return Object.freeze({ state: "example", version: GRADED_SAMPLE_FIGURES_VERSION });

  const provenance = provenanceOf(files, scored.rubricVersionId);
  const nextAction = eligibility.nextAction;
  const counts = tally(scored, recordCounts);
  // Two gates, and both come from upstream: the rubric has to have produced a
  // composite, and eligibility has to permit the letter. Either one failing
  // means no figure is published at all.
  if (!scored.scored || !eligibility.showGrade) {
    return Object.freeze({
      version: GRADED_SAMPLE_FIGURES_VERSION,
      state: "not_gradeable",
      showGrade: false,
      provenance,
      message: Object.freeze({
        label: eligibility.label,
        rule: eligibility.rule,
        unscored: scored.scored ? null : NOT_SCORED_MESSAGE,
      }),
      records: counts,
      nextAction,
    });
  }

  const cohortVerdict = cohortOf(cohort);
  return Object.freeze({
    version: GRADED_SAMPLE_FIGURES_VERSION,
    state: "graded",
    showGrade: true,
    provisional: eligibility.provisional === true,
    // The word beside the letter. It is the accessible name's job as much as the
    // hatch's, so it is data here rather than a class the CSS invents.
    statusWord: eligibility.provisional ? "Provisional grade" : "Confident grade",
    statusShape: eligibility.provisional ? "◐" : "●",
    grade: scored.grade,
    score: scored.composite,
    gradeLine: `Grade ${scored.grade} · ${scored.composite} / 100 · `
      + `${eligibility.provisional ? "Provisional grade" : "Confident grade"}`,
    coverage: Object.freeze({
      ratio: eligibility.coverage,
      text: eligibility.coverage === null
        ? eligibility.label
        : `${formatPercent(eligibility.coverage, { digits: 1 })} of imported spend scored`,
      label: eligibility.label,
      tier: eligibility.tier,
      rule: eligibility.rule,
    }),
    provenance,
    kpis: kpisOf(scored, counts, { spendUsd, recoverableUsd, period, cohort: cohortVerdict }),
    mix: mixOf(scored, counts),
    cohort: cohortVerdict,
    disclosure: Object.freeze({
      axes: axisSubscores(scored),
      categories: categoryRows(scored),
      unclassified: counts.unclassified,
      scoredRecords: counts.scored,
      totalRecords: counts.total,
      unclassifiedText: `${formatCount(counts.unclassified)} of `
        + `${formatCount(counts.total)} records carried no rubric category and were not scored.`,
    }),
    nextAction,
  });
}
