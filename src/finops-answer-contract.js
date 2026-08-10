// The ONE place an annual AI-savings figure is derived for /evolution.html.
//
// The AI FinOps analysis region already publishes a recommended action, a
// materiality benchmark, an evidence-confidence score and a readiness level.
// What it did not publish was an ANSWER: a single annual figure, the comparison
// that supports it, and the one action it implies — stated once, from named
// signals, or not stated at all. This module derives that, and nothing else on
// the page may derive an annual savings figure of its own.
//
// WITHHOLDING IS THE POINT. A savings number a leader cannot trace is worse
// than no number, so every rule below returns `status: "withheld"` with a
// stable code rather than a best-available guess. The view then shows the
// reason and the partial signals that did survive.
//
// Pure: no DOM, no storage, no clock, no network, no locale-dependent sort.
// Synthetic client-side signals arrive as an argument.

export const FINOPS_ANSWER_CONTRACT = "finops-answer-contract/1.0.0";

export const ANSWER_STATUS = Object.freeze({ answered: "answered", withheld: "withheld" });

export const WITHHELD = Object.freeze({
  missingInput: "missing-input",
  conflictingSavings: "conflicting-savings",
  inconsistentPercent: "inconsistent-percent",
  noRecommendedAction: "no-recommended-action",
  unsupportedBenchmark: "unsupported-benchmark",
  readinessBlocked: "readiness-blocked",
});

/** The order the rules are evaluated in. Published so two readers agree on
 *  which code a scenario that trips several rules reports. */
export const WITHHELD_ORDER = Object.freeze([
  WITHHELD.missingInput, WITHHELD.conflictingSavings, WITHHELD.inconsistentPercent,
  WITHHELD.noRecommendedAction, WITHHELD.unsupportedBenchmark, WITHHELD.readinessBlocked,
]);

export const WITHHELD_SENTENCE = Object.freeze({
  [WITHHELD.missingInput]:
    "An input this answer is defined from is missing, so no annual figure is stated.",
  [WITHHELD.conflictingSavings]:
    "This scenario carries more than one annual savings figure and they disagree, so none of"
    + " them is quoted as the answer.",
  [WITHHELD.inconsistentPercent]:
    "The stated savings percentage disagrees with the one these figures compute to, so neither"
    + " is shown.",
  [WITHHELD.noRecommendedAction]:
    "Nothing is currently recommended, so there is no prioritized action to imply.",
  [WITHHELD.unsupportedBenchmark]:
    "No benchmark accompanies this figure, so there is nothing supporting it.",
  [WITHHELD.readinessBlocked]:
    "Readiness is in a state this analysis already treats as not actionable.",
});

// Cut points into the analysis's EXISTING 0–100 evidence-confidence signal. No
// new score is invented here: this is only a documented three-way cut, so a
// reader who repeats it by hand gets the same level.
export const CONFIDENCE_THRESHOLD = Object.freeze({ high: 75, medium: 50 });
export const CONFIDENCE_RULE = "high at 75 or above, medium at 50 or above, low below 50,"
  + " read off the analysis's existing 0–100 evidence-confidence value.";

export const READINESS_STATE = Object.freeze({
  ready: "ready", illustrative: "illustrative", blocked: "blocked",
});

// The existing readiness levels, normalised. `insufficient` is the state the
// analysis already treats as not actionable, so it is the blocked one.
const READINESS_BY_LEVEL = Object.freeze({
  ready: READINESS_STATE.ready,
  illustrative_only: READINESS_STATE.illustrative,
  insufficient: READINESS_STATE.blocked,
});

// Money is compared at whole dollars or half a percent, whichever is wider, so
// two figures that round differently are not called a conflict.
const CONFLICT_ABSOLUTE_USD = 1;
const CONFLICT_RELATIVE = 0.005;
// A stated percentage may differ from the computed one by at most this, in
// percentage points, before the two are treated as disagreeing.
const PERCENT_TOLERANCE = 0.1;

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const filled = (value) => typeof value === "string" && value.trim().length > 0;
const roundHalfUp = (value) => Math.floor(value + 0.5);
const roundHalfUpTenth = (value) => Math.floor(value * 10 + 0.5) / 10;
const list = (value) => (Array.isArray(value) ? value : []);

/** Ascending by code point. `localeCompare` is locale-dependent and would let
 *  the same records rank differently on two machines. */
const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

const readableAction = (action) => isRecord(action) && filled(action.id) && filled(action.label)
  && Number.isFinite(action.monthlySavingsUsd);

/**
 * The scenario's annual baseline spend, and the source id that names it.
 * A scenario stating only a monthly baseline is annualised here, and the ×12
 * is written into the source id rather than left for a reader to assume.
 */
function annualBaseline(baseline) {
  if (!isRecord(baseline) || !filled(baseline.sourceId)) return null;
  if (Number.isFinite(baseline.annualSpendUsd) && baseline.annualSpendUsd > 0) {
    return { value: baseline.annualSpendUsd, sourceId: baseline.sourceId };
  }
  if (Number.isFinite(baseline.monthlySpendUsd) && baseline.monthlySpendUsd > 0) {
    return { value: baseline.monthlySpendUsd * 12, sourceId: `${baseline.sourceId} × 12` };
  }
  return null;
}

function confidenceLevel(value) {
  if (value >= CONFIDENCE_THRESHOLD.high) return "high";
  if (value >= CONFIDENCE_THRESHOLD.medium) return "medium";
  return "low";
}

/**
 * The single recommended action a leader should start with.
 *
 * Highest monthly savings, then higher readiness, then lower implementation
 * effort where the signal exists, then ascending action id. Actions carrying
 * neither optional signal fall through to the id, which always decides.
 */
function prioritize(actions) {
  const rank = (action) => (Number.isFinite(action.readiness) ? action.readiness : -Infinity);
  const effort = (action) => (Number.isFinite(action.effort) ? action.effort : Infinity);
  return [...actions].sort((left, right) =>
    right.monthlySavingsUsd - left.monthlySavingsUsd
    || rank(right) - rank(left)
    || effort(left) - effort(right)
    || byId(left, right))[0];
}

/** True when the annual figures on offer disagree beyond the stated tolerance. */
function figuresConflict(figures) {
  if (figures.length < 2) return false;
  const low = Math.min(...figures);
  const high = Math.max(...figures);
  return high - low > Math.max(CONFLICT_ABSOLUTE_USD, Math.abs(high) * CONFLICT_RELATIVE);
}

const frozenBenchmark = (benchmark) => Object.freeze({
  sourceId: benchmark.sourceId, label: benchmark.label,
  value: benchmark.value, unit: benchmark.unit,
});

/**
 * A withheld answer: no annual figure, no percentage, no prioritized action —
 * only the code, the sentence, and whichever supporting signals did resolve.
 */
function withhold(code, partial = {}) {
  return Object.freeze({
    contract: FINOPS_ANSWER_CONTRACT, status: ANSWER_STATUS.withheld,
    annualSavingsUsd: null, savingsPercent: null, primaryAction: null,
    benchmark: partial.benchmark ?? null,
    confidence: partial.confidence ?? null,
    readiness: partial.readiness ?? null,
    sources: Object.freeze(partial.sources ?? {}),
    withheldReason: Object.freeze({ code, sentence: WITHHELD_SENTENCE[code] }),
  });
}

/**
 * Resolve the canonical FinOps answer from the analysis's existing signals.
 *
 * @param signals `{ recommendedActions, baseline, benchmark, confidence,
 *   readiness, statedAnnualSavingsUsd, statedSavingsPercent }` — see
 *   `finopsAnswerSignals` for the adapter that reads them off the page's
 *   bundled analysis.
 * @returns a frozen `finops-answer-contract/1.0.0` record. Always a record:
 *   the caller never has to distinguish null from withheld.
 */
export function resolveFinopsAnswer(signals) {
  const input = isRecord(signals) ? signals : null;
  const actions = Array.isArray(input?.recommendedActions) ? input.recommendedActions : null;
  const confidenceValue = input?.confidence?.value;
  const confidenceId = input?.confidence?.sourceId;
  const readinessState = READINESS_BY_LEVEL[input?.readiness?.level] ?? null;
  const readinessId = input?.readiness?.sourceId;
  const baseline = annualBaseline(input?.baseline);
  const benchmark = isRecord(input?.benchmark) && filled(input.benchmark.sourceId)
    && filled(input.benchmark.label) && Number.isFinite(input.benchmark.value)
    && filled(input.benchmark.unit) ? frozenBenchmark(input.benchmark) : null;

  // Partial signals a withheld answer may still show. Composed before the rules
  // so every withholding path offers the same ones.
  const partial = {
    benchmark,
    confidence: Number.isFinite(confidenceValue) && filled(confidenceId)
      ? Object.freeze({ level: confidenceLevel(confidenceValue), value: confidenceValue })
      : null,
    readiness: readinessState && filled(readinessId)
      ? Object.freeze({ state: readinessState, level: input.readiness.level }) : null,
    sources: Object.freeze({
      confidence: Object.freeze(filled(confidenceId) ? [confidenceId] : []),
      readiness: Object.freeze(filled(readinessId) ? [readinessId] : []),
      benchmark: Object.freeze(benchmark ? [benchmark.sourceId] : []),
    }),
  };

  if (!actions || actions.some((action) => !readableAction(action))
    || !partial.confidence || !partial.readiness || !baseline) {
    return withhold(WITHHELD.missingInput, partial);
  }

  const actionIds = actions.map((action) => action.sourceId ?? action.id);
  const annualSavingsUsd = roundHalfUp(
    actions.reduce((sum, action) => sum + action.monthlySavingsUsd, 0) * 12);
  const stated = list(input.statedAnnualSavingsUsd);
  if (stated.some((figure) => !Number.isFinite(figure?.value))
    || figuresConflict([annualSavingsUsd, ...stated.map((figure) => figure.value)])) {
    return withhold(WITHHELD.conflictingSavings, partial);
  }

  // Multiplication before division: mathematically identical to the stated
  // definition and free of a rounding step two implementations could differ on.
  const savingsPercent = roundHalfUpTenth(annualSavingsUsd * 100 / baseline.value);
  const statedPercent = input.statedSavingsPercent;
  if (isRecord(statedPercent) && (!Number.isFinite(statedPercent.value)
    || Math.abs(statedPercent.value - savingsPercent) > PERCENT_TOLERANCE)) {
    return withhold(WITHHELD.inconsistentPercent, partial);
  }

  if (!actions.length) return withhold(WITHHELD.noRecommendedAction, partial);
  if (!benchmark) return withhold(WITHHELD.unsupportedBenchmark, partial);
  if (readinessState === READINESS_STATE.blocked) {
    return withhold(WITHHELD.readinessBlocked, partial);
  }

  const first = prioritize(actions);
  return Object.freeze({
    contract: FINOPS_ANSWER_CONTRACT, status: ANSWER_STATUS.answered,
    annualSavingsUsd, savingsPercent,
    annualBaselineSpendUsd: baseline.value,
    benchmark,
    primaryAction: Object.freeze({
      id: first.id, label: first.label,
      monthlySavingsUsd: first.monthlySavingsUsd,
      department: filled(first.department) ? first.department : null,
    }),
    confidence: partial.confidence,
    readiness: partial.readiness,
    sources: Object.freeze({
      annualSavingsUsd: Object.freeze([...actionIds]),
      savingsPercent: Object.freeze([...actionIds, baseline.sourceId]),
      benchmark: partial.sources.benchmark,
      primaryAction: Object.freeze([first.sourceId ?? first.id]),
      confidence: partial.sources.confidence,
      readiness: partial.sources.readiness,
    }),
    withheldReason: null,
  });
}

// ---------------------------------------------------------------------------
// THE ONE RECOVERABLE-SPEND FIGURE (#1496)
//
// /evolution.html carried two of them. The answer region at the top stated
// $62,400 a year, annualised from a single modelled destination move worth
// $5,200 a month; the analysis region below stated $51,254 for the month,
// summed per department by the recoverability rule. Two numbers, two bases, one
// page, and no way for a reader to tell which one is the answer — so neither
// was one.
//
// THE MONTHLY FIGURE IS THE BASIS OF RECORD, because it is the one derived from
// real per-department data. The annual figure is a PROJECTION of it and is
// computed here, from it, every time. There is deliberately no annual constant
// left to drift: the $62,400 did not equal 51,254 x 12, and a figure that
// cannot be reproduced from the departments is deleted rather than reconciled
// toward.
//
// SCORED DEPARTMENTS ONLY. A department counts when the current dataset carries
// a completed FinOps score for it — a finite, non-negative recoverable line
// under the recoverability rule. A department without one contributes zero and
// is counted in neither numerator nor denominator; nothing is ever extrapolated
// from the scored departments to the unscored ones. The two counts travel with
// the figure so the scope is legible without opening anything.
// ---------------------------------------------------------------------------

export const RECOVERABLE_SPEND_CONTRACT = "finops-recoverable-spend/1.0.0";

/** The projection factor, written once. No seasonality, no growth adjustment. */
export const MONTHS_PER_YEAR = 12;

export const RECOVERABLE_SPEND_RULE =
  "Recoverable spend is the sum, over departments carrying a completed FinOps score in the "
  + "current dataset, of that department's identified recoverable spend for the most recent "
  + "complete month. Unscored departments contribute zero and are excluded from the count. The "
  + "annual figure is that monthly figure multiplied by 12, rounded once to whole dollars, with "
  + "no seasonality or growth adjustment.";

/** Whole dollars, grouped. Hand-rolled because `Intl` is locale-dependent and
 *  this module must give two machines the same string. */
function usdWhole(value) {
  const whole = String(Math.abs(roundHalfUp(value)));
  let grouped = "";
  for (let index = 0; index < whole.length; index += 1) {
    if (index > 0 && (whole.length - index) % 3 === 0) grouped += ",";
    grouped += whole[index];
  }
  return `${value < 0 ? "-$" : "$"}${grouped}`;
}

/** Every department the dataset published, scored or not. */
export const departmentRows = (dataset) => (Array.isArray(dataset)
  ? dataset
  : list(dataset?.rankedDepartments ?? dataset?.departments)).filter(isRecord);

/** A completed FinOps score: a finite, non-negative recoverable line. A row
 *  that opts out with `scored: false` is honoured even when it carries one.
 *
 *  EXPORTED so nothing states this rule twice. The scored/total counts beside
 *  the figure, and any surface that has to say WHICH departments were counted,
 *  must select the same set the sum was taken over — a second predicate that
 *  agreed today is a second predicate that can disagree tomorrow. */
export const isScoredDepartment = (row) => isRecord(row) && row.scored !== false
  && Number.isFinite(row.recoverableUsd) && row.recoverableUsd >= 0;

/** The rows the recoverable figure was summed over, in the dataset's own order. */
export const scoredDepartmentRows = (dataset) =>
  departmentRows(dataset).filter(isScoredDepartment);

const isScored = isScoredDepartment;

/** The level, off the analysis's EXISTING confidence signal — a 0–100 evidence
 *  value read through `confidenceLevel`, or a level word the analysis already
 *  publishes. No second scale is invented here. */
function recoverableConfidenceLevel(dataset) {
  const raw = dataset?.confidence;
  const value = isRecord(raw) ? raw.value : raw;
  if (Number.isFinite(value)) return confidenceLevel(value);
  const word = filled(value) ? value.trim().toLowerCase() : null;
  return word === "high" || word === "medium" || word === "low" ? word : null;
}

/**
 * The canonical recoverable-spend figure, and everything needed to read it.
 *
 * One accessor, so divergence is structurally impossible: both regions of
 * /evolution.html paint from this object, and nothing else on the page derives
 * a recoverable figure of its own.
 *
 * @param dataset the analysis envelope — `{ rankedDepartments, period,
 *   confidence }` — or the department rows on their own.
 * @returns a frozen record. `monthly` and `annualised` are null together when
 *   no department carries a completed score; the sentences say why.
 */
export function getRecoverableSpend(dataset) {
  const rows = departmentRows(dataset);
  const scored = rows.filter(isScored);
  const totalDepartments = rows.length;
  const scoredDepartments = scored.length;
  const periodLabel = filled(dataset?.period) ? dataset.period.trim()
    : (filled(dataset?.period?.label) ? dataset.period.label.trim() : null);
  const window = periodLabel ? ` for ${periodLabel}` : "";
  const coverage = `${scoredDepartments} of ${totalDepartments} `
    + `${totalDepartments === 1 ? "department" : "departments"}`;
  const level = recoverableConfidenceLevel(dataset);
  const partial = scoredDepartments < totalDepartments;
  const grade = level ? `Confidence: ${level}` : "Confidence: not graded";

  if (!scoredDepartments) {
    return Object.freeze({
      contract: RECOVERABLE_SPEND_CONTRACT, basis: "monthly",
      monthly: null, annualised: null, monthlyDisplay: null, annualisedDisplay: null,
      scoredDepartments, totalDepartments, periodLabel,
      headline: "No recoverable figure is stated",
      scopeSentence: `No department in this dataset carries a completed FinOps score${window}, `
        + "so there is nothing to sum and nothing is projected from the unscored ones.",
      projectionSentence: "",
      basisSentence: `No department in this dataset carries a completed FinOps score${window}, `
        + "so there is nothing to sum and nothing is projected from the unscored ones.",
      confidence: Object.freeze({
        level, partialCoverage: partial,
        sentence: `${grade} — nothing is scored yet, so no recoverable figure is claimed.`,
      }),
    });
  }

  const monthly = roundHalfUp(scored.reduce((sum, row) => sum + row.recoverableUsd, 0));
  const annualised = roundHalfUp(monthly * MONTHS_PER_YEAR);
  const monthlyDisplay = usdWhole(monthly);
  const annualisedDisplay = usdWhole(annualised);
  // Partial coverage is said in the SCOPE sentence, not in a second confidence
  // grade: the region already carries one graded claim about this figure, and a
  // second scale beside it would be two answers to "how sure are we?" again.
  const scopeSentence = `Summed over the ${coverage} carrying a completed FinOps score`
    + `${window}. Unscored departments contribute zero and are never extrapolated to`
    + `${partial ? ", so this is a floor for the organization rather than its total" : ""}.`;
  const projectionSentence = `About ${annualisedDisplay} a year if this month holds — the monthly `
    + "figure multiplied by 12, with no seasonality or growth adjustment.";

  return Object.freeze({
    contract: RECOVERABLE_SPEND_CONTRACT, basis: "monthly",
    monthly, annualised, monthlyDisplay, annualisedDisplay,
    scoredDepartments, totalDepartments, periodLabel,
    headline: `${monthlyDisplay} recoverable per month`,
    scopeSentence, projectionSentence,
    basisSentence: `${scopeSentence} ${projectionSentence}`,
    confidence: Object.freeze({
      level, partialCoverage: partial,
      sentence: partial
        ? `${grade}, over scored spend only — ${coverage} carry a completed score, so this is a `
          + "floor for the organization rather than its total."
        : `${grade} — every department in this dataset carries a completed score, so nothing`
          + " here is extrapolated.",
    }),
  });
}

/**
 * The page's existing bundled analysis, read as this contract's signal set.
 *
 * It restates nothing: every value below is carried through from the record
 * `analysisReadiness` already publishes and the regions above already paint.
 * The action figure is a modelled recoverable line over the fixture's own
 * calendar month, which is what makes it a monthly saving.
 */
export function finopsAnswerSignals(analysis) {
  if (!isRecord(analysis) || analysis.ok !== true) return null;
  const readiness = analysis.readiness;
  const step = readiness?.recommendation;
  const monthly = step?.figure?.unit === "USD" ? step.figure.value : null;
  const departments = list(analysis.sample?.departments)
    .filter((row) => Number.isFinite(row?.spendUsd));
  const benchmark = analysis.finding?.benchmark;
  return {
    recommendedActions: step ? [{
      id: step.id, sourceId: "readiness.recommendation.figure.value",
      label: step.action, department: step.department, monthlySavingsUsd: monthly,
    }] : [],
    baseline: {
      sourceId: "sample.departments[].spendUsd",
      monthlySpendUsd: departments.reduce((sum, row) => sum + row.spendUsd, 0),
    },
    benchmark: isRecord(benchmark) ? {
      sourceId: "finding.benchmark", label: benchmark.name,
      value: benchmark.value, unit: benchmark.currency,
    } : null,
    confidence: { sourceId: "readiness.confidence.value", value: readiness?.confidence?.value },
    readiness: { sourceId: "readiness.level", level: readiness?.level },
    statedAnnualSavingsUsd: [],
    statedSavingsPercent: null,
  };
}
