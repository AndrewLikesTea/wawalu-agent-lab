// The first-run AI-literacy letter, and the coverage figure that qualifies it.
//
// THE DEFECT THIS CLOSES. The first screen showed four resolved slots and one
// hole. Literacy read "no scored query sample", because the bundled example was
// a billing export and a billing export has no prompts in it. A grade nobody can
// see is a scoring layer nobody can dispute, which is the same as not having one.
//
// `example-conversation-corpus.js` supplies the missing half of the invented
// company. This module joins it to the billing analysis and produces one slot.
//
// ---------------------------------------------------------------------------
// TWO BASES, ON PURPOSE, AND WHY THEY ARE NOT THE SAME NUMBER
// ---------------------------------------------------------------------------
//
// THE LETTER is prompt-weighted. `companyGrade` rolls the graded departments up
// by classified-prompt count, and the rubric's own `recordWeighting` assumption
// says why: the department score it is rolling up is a share-of-queries number,
// so weighting the roll-up by anything else would silently restate an already
// published grade.
//
// THE COVERAGE FIGURE beside it is spend-weighted, and that is deliberate rather
// than an inconsistency. Coverage answers one question — "is this letter
// representative of our money?" — and `grade-eligibility.js` states the
// assumption in its own header: one department burning $40k that nobody sampled
// matters more than five hundred sampled queries in a team spending pocket
// change. A prompt-weighted coverage figure would let a chatty, cheap department
// vouch for an expensive silent one.
//
// So the slot prints both bases and names each. Neither module's thresholds are
// copied here: `COVERAGE_TIERS` decides the tier, `prompt-literacy-rubric.json`
// decides the letter, and this file decides nothing but the join.
//
// NO PROMPT TEXT LEAVES THE PARSE. The corpus is written to bytes, handed to
// `analyzeConversationExportText`, and classified inside
// `parseConversationExport`. What comes back is counts, categories, department
// names, and phrases authored in this repository. Nothing this module returns
// was read out of a prompt.

import { analyzeConversationExportText } from "./conversation-literacy.js";
import { exampleConversationCorpusText } from "./example-conversation-corpus.js";
import { gradeEligibilityFromCoverage, sampledSpendCoverage } from "./grade-eligibility.js";
import { RUBRIC_VERSION_ID } from "./prompt-literacy-scoring.js";

/** Bump when a field, a sentence, or the join rule changes meaning. */
export const FIRST_RUN_LITERACY_VERSION = "finops-first-run-literacy/1.0.0";

/** The slot's visible name. One name for one figure, as the sibling slots do. */
export const LITERACY_SLOT_LABEL = "AI literacy · graded prompt sample";

/** The invented-data marker, in the sibling slots' own idiom. */
export const LITERACY_SAMPLE_NOTE =
  "Synthetic prompts from an invented company, scored by a published rubric — "
  + "not customer behaviour and not realized savings.";

/** What the slot says when the corpus could not be scored at all. */
export const LITERACY_UNAVAILABLE = Object.freeze({
  failed: "No literacy grade: the bundled synthetic prompt sample could not be scored in this browser.",
  noDepartments: "No literacy grade: the bundled example produced no departments to score prompts against.",
  withheld: "No literacy grade: too little of the invented spend sits in departments the rubric scored.",
});

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const COUNT = new Intl.NumberFormat("en-US");

/**
 * Score the bundled corpus against the bundled billing analysis.
 *
 * @param analysis the envelope `loadExampleDataset()` produced. Its
 *   `rankedDepartments` are both the corpus's department column and the spend
 *   denominator, so the two halves of the figure name the same departments by
 *   construction rather than by a lookup that could miss.
 * @param load injectable for tests; defaults to the shipped pipeline.
 * @returns `{ available, value, detail, band: null, grade, score, coverage }`,
 *   the shape `finops-first-run.js` paints, plus the figures a test pins.
 */
export function composeFirstRunLiteracy(analysis, load = analyzeConversationExportText) {
  const departments = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments : [];
  if (!departments.length) return unavailable(LITERACY_UNAVAILABLE.noDepartments);

  let literacy;
  try {
    literacy = load(exampleConversationCorpusText(
      departments.map((department) => ({ id: department.id, name: department.name })),
    )).literacy;
  } catch {
    return unavailable(LITERACY_UNAVAILABLE.failed);
  }
  const company = literacy?.company;
  if (!company) return unavailable(LITERACY_UNAVAILABLE.failed);

  // The join, and the whole join: a department contributes its spend to the
  // covered side exactly when the rubric produced a letter for it. A department
  // that was sampled and fell under the minimum is NOT partially credited —
  // `grade-eligibility.js` refuses partial credit for the same reason, and
  // inventing some here would make the two coverage figures on this page
  // disagree about what "scored" means.
  const gradedNames = new Set(literacy.departments
    .filter((department) => department.gradeable)
    .map((department) => department.department));
  const spendOf = (list) => list.reduce(
    (sum, department) => sum + (Number(department.spendUsd) || 0), 0,
  );
  const coverage = sampledSpendCoverage({
    coveredUsd: spendOf(departments.filter((department) => gradedNames.has(department.name))),
    totalUsd: spendOf(departments),
  });
  const eligibility = gradeEligibilityFromCoverage(coverage);

  const figures = Object.freeze({
    version: FIRST_RUN_LITERACY_VERSION,
    rubricVersionId: RUBRIC_VERSION_ID,
    grade: company.showGrade ? company.grade : null,
    score: company.showGrade ? company.score : null,
    promptsScored: company.coveredPrompts,
    promptsTotal: company.totalPrompts,
    coveredUsd: coverage.coveredUsd,
    totalUsd: coverage.totalUsd,
    coverageRatio: coverage.ratio,
    coverageTier: eligibility.tier,
    coverageRule: eligibility.rule,
    departmentsGraded: gradedNames.size,
    departmentsTotal: departments.length,
    // The teams the rubric did NOT grade, by name, as one pre-joined string.
    // Named rather than counted because "4 of 5 departments" leaves a reader
    // guessing which one is missing from the letter, and a string rather than an
    // array because nothing nested may leave this function — see the redaction
    // note above and the field-shape assertion in this module's test.
    ungradedDepartments: departments
      .filter((department) => !gradedNames.has(department.name))
      .map((department) => department.name).join(", "),
  });

  // Two independent gates, and both must open. `showGrade` is the prompt-basis
  // verdict — did enough of the sample get classified — and `eligibility` is the
  // money-basis one. A letter that passes one and fails the other is exactly the
  // "confident B over a quarter of the budget" this page refuses to print.
  if (!company.showGrade || !eligibility.showGrade) {
    return Object.freeze({
      ...figures,
      available: false,
      band: null,
      value: LITERACY_UNAVAILABLE.withheld,
      detail: `${coverageSentence(figures)} ${company.rule} ${LITERACY_SAMPLE_NOTE}`,
    });
  }

  return Object.freeze({
    ...figures,
    available: true,
    band: null,
    // The rubric label rides on the same line as the letter, not in a footnote:
    // a score whose scale is one scroll away is a score that gets quoted without
    // it, and then disputed against a rubric version nobody wrote down.
    value: `${company.grade} · ${company.score} of 100 · ${RUBRIC_VERSION_ID}`,
    detail: `${coverageSentence(figures)} ${eligibility.rule} ${LITERACY_SAMPLE_NOTE}`,
  });
}

/**
 * The coverage line: scored dollars, in-scope dollars, the tier those produce,
 * and the prompt sample underneath. Both denominators are printed because a
 * reader disputing the letter needs to know whether the gap is unsampled money
 * or unclassified prompts, and those call for different fixes.
 */
function coverageSentence(figures) {
  const ungraded = figures.ungradedDepartments
    ? ` Not graded: ${figures.ungradedDepartments}.` : "";
  return `${USD.format(figures.coveredUsd)} of ${USD.format(figures.totalUsd)} in-scope invented spend `
    + `was scored — ${figures.coverageTier} coverage, `
    + `${figures.departmentsGraded} of ${figures.departmentsTotal} invented departments, `
    + `${COUNT.format(figures.promptsScored)} of ${COUNT.format(figures.promptsTotal)} synthetic prompts classified.`
    + ungraded;
}

/** A slot with no figure in it, carrying the reason rather than a dash. */
function unavailable(reason) {
  return Object.freeze({
    version: FIRST_RUN_LITERACY_VERSION,
    rubricVersionId: RUBRIC_VERSION_ID,
    available: false,
    band: null,
    value: reason,
    detail: LITERACY_SAMPLE_NOTE,
    grade: null,
    score: null,
    promptsScored: 0,
    promptsTotal: 0,
    coveredUsd: 0,
    totalUsd: 0,
    coverageRatio: null,
    coverageTier: null,
    coverageRule: null,
    departmentsGraded: 0,
    departmentsTotal: 0,
    ungradedDepartments: "",
  });
}

/** The method-disclosure entry: the same figures, as evidence rather than a slot. */
export function literacyMethodEntry(literacy) {
  if (!literacy?.available) {
    return `${literacy?.value ?? LITERACY_UNAVAILABLE.failed} ${LITERACY_SAMPLE_NOTE}`;
  }
  return `${literacy.grade} · ${literacy.score} of 100 · ${literacy.rubricVersionId} · `
    + `${coverageSentence(literacy)} The letter is prompt-weighted per the rubric's recordWeighting `
    + "assumption; the coverage figure beside it is spend-weighted per grade-eligibility.js. "
    + "Recompute from these and compare.";
}
