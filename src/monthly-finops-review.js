import { OPERATING_CYCLE_STORAGE_KEY } from "./finops-workspace-contract.js";

export { OPERATING_CYCLE_STORAGE_KEY };

// Verification brief contract. This module owns the definitions before the UI:
// it is pure, clock-free, and uses integer minor currency units until display.
export const MONTHLY_FINOPS_FIXTURE_VERSION = "monthly-finops-review-fixture/2.0.0";
export const MONTHLY_FINOPS_REVIEW_VERSION = "monthly-finops-review/2.0.0";
export const OPERATING_CYCLE_VERSION = "finops-operating-cycle/1.0.0";
export const OPERATING_CYCLE_SELECTION_VERSION = "finops-operating-cycle-selection/1.0.0";

export const MONTHLY_FINOPS_METRIC_CONTRACTS = Object.freeze({
  selectedAction: Object.freeze({
    question: "Which recorded savings action are we verifying?",
    definition: "The sole action with selected=true in the bundled fixture.",
    excluded: "Unselected opportunities and actions inferred from spend movement.",
  }),
  expectedSavings: Object.freeze({
    question: "What savings did the selected action commit to deliver next period?",
    formula: "selectedAction.expectedSavingsMinor, in fixture currency minor units",
    population: "The selected action's named scope in its verificationPeriodId only.",
    excluded: "Annualization, forecasts beyond that period, and unselected actions.",
  }),
  observedSavings: Object.freeze({
    question: "What savings were observed for that same scope and period?",
    formula: "observation.baselinePeriod.spendMinor - observation.verificationPeriod.spendMinor",
    population: "observation.scope, compared across the action's baselinePeriodId and verificationPeriodId. A scope that does not equal the action's own scope is reported as a failed confidence signal, not a like-for-like benchmark.",
    excluded: "Causal attribution: the result is associated with, not proved caused by, the action.",
  }),
  variance: Object.freeze({
    question: "How far above or below expectation did the result land?",
    formula: "observedSavingsMinor - expectedSavingsMinor",
    rounding: "No rounding; calculate in integer minor currency units.",
  }),
  attainment: Object.freeze({
    question: "What share of expected savings was observed?",
    formula: "observedSavingsMinor / expectedSavingsMinor; null when expectedSavingsMinor is zero",
    rounding: "Store the ratio unrounded; display as a percentage rounded to one decimal, half away from zero.",
  }),
  confidence: Object.freeze({
    question: "How strong are the bundled signals behind this comparison?",
    formula: "Count three booleans: complete observation; coverage >= threshold; observation scope equals the selected action's scope. high=3, moderate=2, low=0 or 1.",
    population: "Only signals encoded in this bundled synthetic fixture.",
    excluded: "Statistical significance, causal confidence, customer data, and external evidence.",
  }),
  provenance: Object.freeze({
    question: "Which synthetic source periods produced the benchmark?",
    definition: "Ordered baselinePeriodId and verificationPeriodId plus fixture sourceType and methodVersion.",
    excluded: "Credentials, raw customer rows, prompts, storage, and live integrations.",
  }),
  followUp: Object.freeze({
    question: "What is the single highest-priority follow-up?",
    formula: "Select exactly one candidate whose outcome equals met when variance >= 0, otherwise missed.",
    excluded: "Equal-weight alerts, secondary recommendations, and actions not bundled in the fixture.",
  }),
});

const freeze = Object.freeze;

const integer = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
};

/** One decimal, with exact half-ties away from zero. */
export function roundOne(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const magnitude = Math.abs(value) * 10;
  const tolerance = Number.EPSILON * Math.max(1, magnitude) * 2;
  return Math.sign(value) * (Math.floor(magnitude + 0.5 + tolerance) / 10);
}

/**
 * Answers, in order:
 * 1. What action and one-period expectation are being verified?
 * 2. What was observed in that exact scope and period?
 * 3. Did it meet expectation, by how much, and with what confidence?
 * 4. Which bundled periods produced the answer?
 * 5. What is the one follow-up action?
 *
 * Deliberately leaves out causal claims, annualization, live data, alert lists,
 * and any recommendation other than the one selected by the documented rule.
 */
export function buildMonthlyFinopsReview(fixture) {
  if (fixture?.schemaVersion !== MONTHLY_FINOPS_FIXTURE_VERSION) {
    throw new TypeError("unsupported monthly FinOps fixture version");
  }

  const selected = (fixture.actions ?? []).filter((action) => action.selected === true);
  if (selected.length !== 1) throw new TypeError("exactly one selected savings action is required");
  const action = selected[0];
  const observation = fixture.observation;
  const periodsAligned = action.baselinePeriodId === observation?.baselinePeriod?.id
    && action.verificationPeriodId === observation?.verificationPeriod?.id;
  if (!periodsAligned) throw new TypeError("selected action and observation periods must match");

  const expectedSavingsMinor = integer(action.expectedSavingsMinor, "expectedSavingsMinor");
  const baselineSpendMinor = integer(observation.baselinePeriod.spendMinor, "baselineSpendMinor");
  const observedSpendMinor = integer(observation.verificationPeriod.spendMinor, "observedSpendMinor");
  const observedSavingsMinor = baselineSpendMinor - observedSpendMinor;
  const varianceMinor = observedSavingsMinor - expectedSavingsMinor;
  const attainment = expectedSavingsMinor === 0 ? null : observedSavingsMinor / expectedSavingsMinor;

  const comparable = integer(fixture.confidence.recordsComparable, "recordsComparable");
  const expectedRecords = integer(fixture.confidence.recordsExpected, "recordsExpected");
  const threshold = integer(fixture.confidence.minimumCoverageTenthsPercent,
    "minimumCoverageTenthsPercent") / 10;
  if (comparable > expectedRecords) throw new TypeError("comparable records cannot exceed expected records");
  const coveragePercent = expectedRecords === 0 ? null : roundOne((comparable * 100) / expectedRecords);
  // Matching periods are a precondition, not a signal: they are already enforced
  // above, so counting them would pin one of three signals permanently true and
  // make the documented low level unreachable. Scope is the claim that is still
  // open here — expected savings are scoped to the action, so an observation that
  // does not name that same scope is not a like-for-like benchmark.
  const signals = freeze({
    observationComplete: observation.complete === true,
    coverageMeetsThreshold: coveragePercent !== null && coveragePercent >= threshold,
    scopeMatches: observation.scope === action.scope,
  });
  const signalCount = Object.values(signals).filter(Boolean).length;
  const confidenceLevel = signalCount === 3 ? "high" : signalCount === 2 ? "moderate" : "low";

  const outcome = varianceMinor >= 0 ? "met" : "missed";
  const candidates = (fixture.followUpActions ?? []).filter((candidate) => candidate.outcome === outcome);
  if (candidates.length !== 1) throw new TypeError(`exactly one ${outcome} follow-up action is required`);
  const followUp = candidates[0];
  if (!["continue", "adjust", "retire"].includes(followUp.disposition)) {
    throw new TypeError("follow-up disposition must be continue, adjust, or retire");
  }
  const finding = varianceMinor > 0
    ? `${action.name} exceeded its next-period savings expectation.`
    : varianceMinor === 0
      ? `${action.name} met its next-period savings expectation exactly.`
      : `${action.name} missed its next-period savings expectation.`;

  return freeze({
    schemaVersion: MONTHLY_FINOPS_REVIEW_VERSION,
    reviewId: fixture.reviewId,
    question: "Did our last action deliver the expected savings?",
    selectedAction: freeze({ id: action.id, name: action.name, scope: action.scope }),
    benchmark: freeze({
      currency: fixture.currency,
      observedScope: observation.scope ?? null,
      expectedSavingsMinor,
      observedSavingsMinor,
      varianceMinor,
      attainment,
      baselineSpendMinor,
      observedSpendMinor,
      verificationPeriodLabel: observation.verificationPeriod.label,
    }),
    finding: freeze({ outcome, statement: finding }),
    confidence: freeze({
      level: confidenceLevel,
      signalCount,
      signalTotal: 3,
      coveragePercent,
      thresholdPercent: threshold,
      signals,
      basis: `${signalCount} of 3 bundled verification signals pass.`,
    }),
    provenance: freeze({
      sourceType: fixture.provenance.sourceType,
      methodVersion: fixture.provenance.methodVersion,
      periodIds: freeze([action.baselinePeriodId, action.verificationPeriodId]),
      periodLabels: freeze([observation.baselinePeriod.label, observation.verificationPeriod.label]),
      boundary: "Bundled synthetic data only; no credentials, customer data, prompts, storage, or live integrations.",
    }),
    nextAction: freeze({ rank: 1, id: followUp.id, disposition: followUp.disposition,
      statement: followUp.statement, evidence: followUp.evidence }),
  });
}

const selectionFields = Object.freeze(["schemaVersion", "actionId"]);

/** The only durable cycle data: a schema marker and one bundled action id. */
export function validateOperatingCycleSelection(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return freeze({ valid: false, errors: freeze(["selection must be an object"]) });
  }
  for (const key of Object.keys(value)) {
    if (!selectionFields.includes(key)) errors.push(`${key}: storage field is not allowed`);
  }
  if (value.schemaVersion !== OPERATING_CYCLE_SELECTION_VERSION) errors.push("unsupported selection version");
  if (typeof value.actionId !== "string" || !ID.test(value.actionId)) errors.push("actionId is invalid");
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

// An offered action becomes a DOM id, a stored id, and a formatted amount before
// anyone can act on it, so it clears all three gates here rather than in three
// places later. An id the selection validator would reject turns Confirm into a
// silent no-op; an amount or currency Intl cannot format throws out of the render
// and blanks the workspace instead of showing the choice.
const offerable = (action, currency) => ID.test(action?.id ?? "")
  && Number.isSafeInteger(action?.expectedSavingsMinor) && action.expectedSavingsMinor >= 0
  && /^[a-z]{3}$/i.test(currency ?? "");

export function readOperatingCycleSelection(storage) {
  if (!storage) return freeze({ status: "unavailable", selection: null });
  try {
    const raw = storage.getItem(OPERATING_CYCLE_STORAGE_KEY);
    if (raw === null) return freeze({ status: "empty", selection: null });
    const selection = JSON.parse(raw);
    return validateOperatingCycleSelection(selection).valid
      ? freeze({ status: "selected", selection: freeze({ ...selection }) })
      : freeze({ status: "incompatible", selection: null });
  } catch {
    return freeze({ status: "incompatible", selection: null });
  }
}

export function writeOperatingCycleSelection(storage, actionId) {
  const selection = { schemaVersion: OPERATING_CYCLE_SELECTION_VERSION, actionId };
  const checked = validateOperatingCycleSelection(selection);
  if (!checked.valid || !storage) return freeze({ ok: false, status: "unavailable" });
  try {
    storage.setItem(OPERATING_CYCLE_STORAGE_KEY, JSON.stringify(selection));
    return freeze({ ok: true, status: "selected", selection: freeze(selection) });
  } catch {
    return freeze({ ok: false, status: "unavailable" });
  }
}

export function clearOperatingCycleSelection(storage) {
  if (!storage) return freeze({ ok: false, status: "unavailable" });
  try {
    storage.removeItem(OPERATING_CYCLE_STORAGE_KEY);
    const cleared = storage.getItem(OPERATING_CYCLE_STORAGE_KEY) === null;
    return freeze({ ok: cleared, status: cleared ? "empty" : "incompatible" });
  } catch {
    return freeze({ ok: false, status: "unavailable" });
  }
}

/** Resolve a selected bundled action to its declared, immediately subsequent period. */
export function projectOperatingCycle(fixture, selectionResult) {
  const base = { schemaVersion: OPERATING_CYCLE_VERSION, sourceType: "bundled_synthetic_fixture" };
  // Version first, for every status: the offer below reads amounts and a currency
  // out of the fixture, so a fixture this build cannot vouch for must not reach it.
  if (fixture?.schemaVersion !== MONTHLY_FINOPS_FIXTURE_VERSION) {
    return freeze({ ...base, status: "incompatible", review: null, actions: freeze([]) });
  }
  if (selectionResult?.status !== "selected") {
    const recommended = (fixture.actions ?? [])
      .filter((action) => action.selected === true && offerable(action, fixture.currency));
    return freeze({ ...base, status: selectionResult?.status ?? "empty", review: null,
      actions: freeze(recommended.map(({ id, name, scope, expectedSavingsMinor, verificationPeriodId }) =>
        freeze({ id, name, scope, expectedSavingsMinor, verificationPeriodId,
          currency: fixture.currency, evidence: "Highest bundled expected one-period savings with an eligible subsequent period." }))) });
  }
  // No choices on an incompatible cycle: the view only offers a reset here, and a
  // list it must not act on is an unvalidated one waiting to be rendered later.
  const action = fixture.actions?.find(({ id }) => id === selectionResult.selection.actionId);
  if (!action) return freeze({ ...base, status: "incompatible", review: null, actions: freeze([]) });
  const baseline = fixture.observation?.baselinePeriod;
  const verification = fixture.observation?.verificationPeriod;
  const baselineMonth = /^synthetic-(\d{4})-(\d{2})$/.exec(action.baselinePeriodId ?? "");
  const verificationMonth = /^synthetic-(\d{4})-(\d{2})$/.exec(action.verificationPeriodId ?? "");
  const serial = (match) => match ? Number(match[1]) * 12 + Number(match[2]) : null;
  const valid = baseline?.id === action.baselinePeriodId && verification?.id === action.verificationPeriodId
    && serial(verificationMonth) === serial(baselineMonth) + 1 && fixture.observation.scope === action.scope;
  if (!valid) return freeze({ ...base, status: "no_valid_comparison", review: null,
    selectedAction: freeze({ id: action.id, name: action.name, scope: action.scope }), actions: freeze([]) });
  const selectedFixture = { ...fixture, actions: fixture.actions.map((candidate) =>
    ({ ...candidate, selected: candidate.id === action.id })) };
  return freeze({ ...base, status: "ready", review: buildMonthlyFinopsReview(selectedFixture), actions: freeze([]) });
}
