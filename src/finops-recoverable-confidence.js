// "How sure are we about that number?" — one grade, from named thresholds (#1186).
//
// The answer region states a recoverable figure and a hedge saying what the
// arithmetic left out. Neither says how far the INPUTS behind the figure got. A
// sentence can be disputed forever; a grade with a published cut point can only
// be disputed by arguing with the cut point, which is the argument worth having.
//
// WHAT IT GRADES, the assumption the rubric stands on: the figure is a modelled
// destination move over spend the rubric scored, so it is only as trustworthy as
// the share of spend that was in fact scored. That share is NOT measured here —
// it is `gradeExport()`'s in export-gradability.js, consumed whole. There is one
// coverage number on this page and this is not a second one.
//
// RULES THIS FILE KEEPS
//
// 1. TOTAL. Full coverage, partial coverage, a billing-only export with no scored
//    department, a verdict with no spend total, `null` — each returns a grade. A
//    blank where a grade belongs reads as "fine" to everyone who cannot read code.
// 2. DATA, NOT PROSE-BY-HAND. The reasons are records — which input held the
//    grade down, what would raise it — asserted by the fixture and rendered into
//    the page's sentences. Hand-written copy drifts the first time a cut point
//    moves; generated copy cannot.
// 3. DETERMINISTIC. No clock, no randomness, no object-key iteration: the checks
//    are an ordered array, so one input yields one grade and one reason order.
//
// tests/finops-recoverable-confidence.test.js runs the labelled fixture.

import { loadExampleDataset } from "./example-dataset.js";
import { COVERAGE_BAR, gradeExport } from "./export-gradability.js";

/** Bump when a grade, a cut point, or what one means changes. Copy may be reworded. */
export const RECOVERABLE_CONFIDENCE_VERSION = "recoverable-confidence/1.0.0";

/** The three grades, worst to best. The order IS the ranking; nothing else ranks them. */
export const CONFIDENCE_GRADES = Object.freeze(["low", "moderate", "high"]);

/** What a reader sees. One word, because it sits beside a figure and not in prose. */
export const GRADE_LABEL = Object.freeze({ low: "Low", moderate: "Moderate", high: "High" });

// ---------------------------------------------------------------------------
// The cut points. Each one carries the assumption a director disputing this
// grade would have to argue with.
// ---------------------------------------------------------------------------

/**
 * Coverage at or above which the grade may be High. ASSUMPTION: at four fifths
 * of spend scored, the unscored fifth cannot move the figure by more than a
 * fifth even if every unscored dollar behaves opposite to every scored one, so
 * the figure survives its own worst case. Below that it does not.
 */
export const HIGH_COVERAGE_FLOOR = 0.8;

/**
 * Coverage at or above which the grade may be Moderate. ASSUMPTION: this rubric
 * may not claim more confidence than the evaluator that produced its inputs.
 * `COVERAGE_BAR` is where export-gradability.js publishes a grade at all, so it
 * is imported rather than typed again and the two surfaces cannot disagree.
 */
export const MODERATE_COVERAGE_FLOOR = COVERAGE_BAR;

/**
 * Scored departments needed for High. ASSUMPTION: a figure resting on one scored
 * cluster rests on one cluster's classification being right; two is the smallest
 * set in which one being wrong shows up as disagreement rather than as the answer.
 */
export const HIGH_SCORED_CLUSTER_FLOOR = 2;

/**
 * Departments read with no spend of their own that High tolerates. ASSUMPTION: an
 * unpriced row is in the numerator of nothing and the denominator of nothing, so
 * while any row is unpriced the share was measured against a partial invoice.
 * Zero, because "some of the invoice" is not a quantity this page can bound.
 */
export const HIGH_UNPRICED_CLUSTER_CEILING = 0;

const PERCENT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const percent = (ratio) => PERCENT.format(ratio);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The measurements this rubric reads, taken off a `gradeExport()` verdict only. */
function measure(gradability) {
  const coverage = Number.isFinite(gradability?.coverage) ? gradability.coverage : null;
  const provenance = gradability?.provenance ?? null;
  return Object.freeze({
    /** Scored share of spend in [0, 1], or null when there is no denominator. */
    coverage,
    read: count(provenance?.rows),
    scored: count(provenance?.scored),
    unpriced: count(provenance?.unpriced),
  });
}

/**
 * The checks, in the order they are reported. An ordered array and not an object,
 * so the reason list is a fixed sequence rather than a key-iteration order.
 *
 * Each check returns the BEST grade its input still allows — its ceiling — plus
 * the sentence saying why, and the sentence naming the evidence that would lift
 * that ceiling. A check with nothing to say returns `high` and two nulls.
 */
const CHECKS = Object.freeze([
  Object.freeze({
    input: "scored_spend_coverage",
    run({ coverage }) {
      if (coverage === null) {
        return {
          ceiling: "low",
          held_down_by: "This export publishes no spend total, so the share of spend the rubric "
            + "scored has no denominator and cannot be measured at all.",
          would_raise: "A spend total against each department would let coverage be measured; "
            + `at ${percent(MODERATE_COVERAGE_FLOOR)} scored it reaches Moderate.`,
        };
      }
      const short = 1 - coverage;
      if (coverage < MODERATE_COVERAGE_FLOOR) {
        return {
          ceiling: "low",
          held_down_by: `Only ${percent(coverage)} of this export's spend sits in departments the `
            + `rubric scored, under the ${percent(MODERATE_COVERAGE_FLOOR)} this page publishes a `
            + "grade from.",
          would_raise: `Scoring departments holding ${percent(short)} of spend takes it to `
            + `Moderate at ${percent(MODERATE_COVERAGE_FLOOR)} and to High at `
            + `${percent(HIGH_COVERAGE_FLOOR)}.`,
        };
      }
      if (coverage < HIGH_COVERAGE_FLOOR) {
        return {
          ceiling: "moderate",
          held_down_by: `${percent(coverage)} of this export's spend sits in departments the rubric `
            + `scored, under the ${percent(HIGH_COVERAGE_FLOOR)} High is claimed from.`,
          would_raise: `Scoring departments holding a further ${percent(HIGH_COVERAGE_FLOOR - coverage)} `
            + "of spend takes it to High.",
        };
      }
      return { ceiling: "high", held_down_by: null, would_raise: null };
    },
  }),
  Object.freeze({
    input: "scored_departments",
    run({ scored }) {
      if (scored >= HIGH_SCORED_CLUSTER_FLOOR) {
        return { ceiling: "high", held_down_by: null, would_raise: null };
      }
      return {
        ceiling: "moderate",
        held_down_by: `This export carries ${plural(scored, "scored department", "scored departments")}, `
          + `under the ${HIGH_SCORED_CLUSTER_FLOOR} High needs before one cluster being wrong shows `
          + "up as disagreement rather than as the answer.",
        would_raise: `Scoring ${plural(HIGH_SCORED_CLUSTER_FLOOR - scored, "further department", "further departments")} `
          + "would let the clusters check each other, which High requires.",
      };
    },
  }),
  Object.freeze({
    input: "priced_departments",
    run({ unpriced, read }) {
      if (unpriced <= HIGH_UNPRICED_CLUSTER_CEILING) {
        return { ceiling: "high", held_down_by: null, would_raise: null };
      }
      return {
        ceiling: "moderate",
        held_down_by: `${unpriced} of the ${read} departments read carry no spend of their own, so `
          + "the scored share was measured against a partial invoice.",
        would_raise: "An export pricing every department it lists would measure coverage against "
          + "the whole invoice, which High requires.",
      };
    },
  }),
]);

const rank = (grade) => CONFIDENCE_GRADES.indexOf(grade);

/**
 * Grade one gradability verdict. One grade out, always.
 *
 * @param gradability a `gradeExport()` verdict, or anything at all — a missing,
 *   partial or malformed verdict is a measurement this rubric did not get, which
 *   is `low` with the reason saying so, not an exception that blanks the figure.
 */
export function gradeRecoverableConfidence(gradability = null) {
  const measured = measure(gradability);
  const reasons = CHECKS.map((check) => {
    const outcome = check.run(measured);
    return Object.freeze({ input: check.input, ...outcome });
  });
  const grade = reasons.reduce(
    (worst, reason) => (rank(reason.ceiling) < rank(worst) ? reason.ceiling : worst), "high");
  // Held down by EVERY input that is not clean, so a reader sees the whole
  // binding set; raised by the inputs sitting AT the grade, which are the ones
  // that must move for the next grade to be reachable.
  const heldDownBy = reasons.filter((reason) => reason.ceiling !== "high");
  const binding = reasons.filter((reason) => reason.ceiling === grade && grade !== "high");
  const nextGrade = grade === "high" ? null : CONFIDENCE_GRADES[rank(grade) + 1];
  return Object.freeze({
    version: RECOVERABLE_CONFIDENCE_VERSION,
    grade,
    label: GRADE_LABEL[grade],
    nextGrade,
    nextLabel: nextGrade === null ? null : GRADE_LABEL[nextGrade],
    measured,
    reasons: Object.freeze(reasons),
    heldDownBy: Object.freeze(heldDownBy.map((reason) => reason.held_down_by)),
    wouldRaise: Object.freeze(binding.map((reason) => reason.would_raise)),
    thresholds: Object.freeze({
      highCoverageFloor: HIGH_COVERAGE_FLOOR,
      moderateCoverageFloor: MODERATE_COVERAGE_FLOOR,
      highScoredClusterFloor: HIGH_SCORED_CLUSTER_FLOOR,
      highUnpricedClusterCeiling: HIGH_UNPRICED_CLUSTER_CEILING,
    }),
  });
}

/** The headline fact, beside the figure: two words, and never a colour alone. */
export const confidenceChip = (verdict) => `Confidence: ${verdict?.label ?? GRADE_LABEL.low}`;

/**
 * The explanation, one press away, GENERATED from the records above rather than
 * written beside them. Plain language: no input keys, no version string, no tier
 * name — a reader gets the sentences, and the identifiers stay in the code.
 */
export function confidenceExplanation(verdict) {
  const graded = verdict ?? gradeRecoverableConfidence(null);
  const held = graded.heldDownBy.length === 0
    ? "Nothing this rubric reads holds it lower."
    : `What holds it there: ${graded.heldDownBy.join(" ")}`;
  const raise = graded.wouldRaise.length === 0
    ? ""
    : ` What would raise it to ${graded.nextLabel}: ${graded.wouldRaise.join(" ")}`;
  return `Confidence in this figure is graded ${graded.label} by a published rule: `
    + `High from ${percent(HIGH_COVERAGE_FLOOR)} of spend scored, Moderate from `
    + `${percent(MODERATE_COVERAGE_FLOOR)}, and High also requires at least `
    + `${HIGH_SCORED_CLUSTER_FLOOR} scored departments with every department read carrying spend. `
    + `${held}${raise}`;
}

/** The bundled example's analysis, or null. A fixture this browser could not read is a state. */
function bundledAnalysis() {
  try {
    return loadExampleDataset();
  } catch {
    return null;
  }
}

/**
 * The grade the bundled example carries, evaluated once, on the one path.
 *
 * The build seeds the served document from this and the page paints from it, so
 * the served bytes and the render cannot state two different grades — and both
 * read `gradeExport()` over the same fixture the answer block reads.
 */
export const BUNDLED_RECOVERABLE_CONFIDENCE = gradeRecoverableConfidence(
  gradeExport({ analysis: bundledAnalysis(), source: "example" }));
