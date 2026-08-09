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
