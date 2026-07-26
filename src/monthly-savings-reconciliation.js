/**
 * Static monthly reconciliation inputs linked to accountable portfolio actions.
 *
 * Questions this contract answers, in order, for one action and for the portfolio:
 * 1. In each month, what savings were planned for work that was actually running?
 * 2. Of that plan, how much was measured, and what did the measurement say?
 * 3. How far is measured realized savings from the plan it can be compared to?
 * 4. How much of the plan could not be measured at all, and why?
 *
 * Deliberately out of scope: an on-track verdict, a forecast, a cause for any
 * variance, currency conversion, live data, and treating a simulated measurement
 * as verified savings. This module does not infer lifecycle state, fetch data,
 * or persist results.
 */

export const MONTHLY_RECONCILIATION_SCHEMA_VERSION =
  "monthly-savings-reconciliation/1.0.0";

/** The only portfolio contract this reconciliation is defined against. */
export const SUPPORTED_PORTFOLIO_SCHEMA_VERSION = "savings-portfolio/1.1.0";

export const RECONCILIATION_AVAILABILITY_STATES = Object.freeze([
  "available",
  "unavailable",
]);

/** Why a measurement is missing, because the two answers need different action. */
export const RECONCILIATION_AVAILABILITY_REASONS = Object.freeze([
  "action-not-started",
  "measurement-pending",
]);

export const RECONCILIATION_VARIANCE_REASONS = Object.freeze([
  "above-projection",
  "below-projection",
  "matched-projection",
  "measurement-unavailable",
]);

/** Every allocation rule is computed by the validator, never authored freehand. */
export const RECONCILIATION_ALLOCATION_RULES = Object.freeze([
  "even-twelfth",
  "not-yet-active",
]);

export const MONTHLY_RECONCILIATION_METRIC_RULES = Object.freeze({
  monthlyProjectionBaseline:
    "Zero for a month before the action entered in-progress (rule not-yet-active);"
    + " otherwise round-half-up(annualized projection / 12) (rule even-twelfth).",
  measuredProjection:
    "The monthly baseline of records whose measurement is available; zero otherwise.",
  unmeasuredProjection:
    "Monthly baseline minus measured projection. Reported as its own amount and"
    + " never netted into variance.",
  measuredVariance:
    "Credited simulated realized savings minus measured projection, over available"
    + " records only. Null when a group has no available record, because no"
    + " measurement is not the same answer as no difference.",
  coverage:
    "Counts of window months, active months, measured months, and unmeasured active"
    + " months. Reported as counts, never as a ratio, so an inactive action has no"
    + " undefined denominator.",
});

export class MonthlySavingsReconciliationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "MonthlySavingsReconciliationError";
    this.path = path;
  }
}

function invalid(path, message) {
  throw new MonthlySavingsReconciliationError(path, message);
}

function requiredText(value, path) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0)
    invalid(path, "must be a non-empty trimmed string");
  return value;
}

function wholeUsd(value, path) {
  if (!Number.isSafeInteger(value) || value < 0)
    invalid(path, "must be a non-negative safe integer in whole USD");
  return value;
}

function measurementMonth(value, path) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
    invalid(path, "must be a calendar month (YYYY-MM)");
  return value;
}

/** The month after `month`, so a gap in the window can be detected exactly. */
function nextMonth(month) {
  const [year, index] = month.split("-").map(Number);
  return index === 12
    ? `${year + 1}-01`
    : `${year}-${String(index + 1).padStart(2, "0")}`;
}

/**
 * The single monthly allocation rule: an even twelfth of the annualized
 * projection, rounded half up to whole USD. Twelve monthly baselines therefore
 * differ from the annualized projection by at most 6 USD; the annualized figure
 * stays authoritative and no consumer should reconstruct it by multiplying.
 */
function evenTwelfthUsd(annualizedSavingsUsd) {
  return Math.round(annualizedSavingsUsd / 12);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

/**
 * The month an action began running, taken from its lifecycle audit trail. An
 * action that never reached in-progress has no month in which savings could
 * accrue, so it has no plan to be measured against.
 */
function activeFromMonth(action) {
  const started = action.lifecycleTransitions.find(
    (transition) => transition.state === "in-progress",
  );
  return started ? started.transitionedDate.slice(0, 7) : null;
}

function validateRecord(input, index, portfolioActions) {
  const path = `records[${index}]`;
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid(path, "must be an object");

  const actionId = requiredText(input.actionId, `${path}.actionId`);
  const portfolioAction = portfolioActions.get(actionId);
  if (!portfolioAction)
    invalid(`${path}.actionId`, "must reference an accountable portfolio action");
  const month = measurementMonth(input.measurementMonth, `${path}.measurementMonth`);
  const startedMonth = activeFromMonth(portfolioAction);
  const isActive = startedMonth !== null && month >= startedMonth;

  const baseline = input.projectionBaseline;
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline))
    invalid(`${path}.projectionBaseline`, "must be an object");
  const annualizedSavingsUsd = wholeUsd(
    baseline.annualizedSavingsUsd, `${path}.projectionBaseline.annualizedSavingsUsd`,
  );
  if (annualizedSavingsUsd !== portfolioAction.projectedSavingsUsd)
    invalid(`${path}.projectionBaseline.annualizedSavingsUsd`,
      "must equal the linked action projection");
  if (!RECONCILIATION_ALLOCATION_RULES.includes(baseline.allocationRule))
    invalid(`${path}.projectionBaseline.allocationRule`,
      `must be one of ${RECONCILIATION_ALLOCATION_RULES.join(", ")}`);
  const expectedRule = isActive ? "even-twelfth" : "not-yet-active";
  if (baseline.allocationRule !== expectedRule)
    invalid(`${path}.projectionBaseline.allocationRule`,
      `must equal ${expectedRule} for this action month`);
  const monthlySavingsUsd = wholeUsd(
    baseline.monthlySavingsUsd, `${path}.projectionBaseline.monthlySavingsUsd`,
  );
  // An action that was not running cannot be behind a plan it was not on.
  const expectedMonthly = isActive ? evenTwelfthUsd(annualizedSavingsUsd) : 0;
  if (monthlySavingsUsd !== expectedMonthly)
    invalid(`${path}.projectionBaseline.monthlySavingsUsd`,
      `must equal ${expectedMonthly} under the ${expectedRule} rule`);

  const availabilityState = input.availabilityState;
  if (!RECONCILIATION_AVAILABILITY_STATES.includes(availabilityState))
    invalid(`${path}.availabilityState`, "must be available or unavailable");
  if (!isActive && availabilityState !== "unavailable")
    invalid(`${path}.availabilityState`,
      "must be unavailable before the action entered in-progress");
  const varianceReason = input.varianceReason;
  if (!RECONCILIATION_VARIANCE_REASONS.includes(varianceReason))
    invalid(`${path}.varianceReason`, "must be a supported reason");

  const provenance = input.evidenceProvenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance))
    invalid(`${path}.evidenceProvenance`, "must be an object");
  if (!Array.isArray(provenance.evidenceRefs))
    invalid(`${path}.evidenceProvenance.evidenceRefs`, "must be an array");
  const evidenceRefs = provenance.evidenceRefs.map((reference, evidenceIndex) => {
    const referencePath = `${path}.evidenceProvenance.evidenceRefs[${evidenceIndex}]`;
    const value = requiredText(reference, referencePath);
    // Namespaced apart from portfolio verification evidence IDs so a simulated
    // measurement can never read as an evidence-backed verified saving.
    if (!value.startsWith("syn-recon-"))
      invalid(referencePath, "must be a syn-recon- reconciliation reference");
    return value;
  });
  if (new Set(evidenceRefs).size !== evidenceRefs.length)
    invalid(`${path}.evidenceProvenance.evidenceRefs`, "must not contain duplicates");

  const availabilityReason = input.availabilityReason;
  let simulatedRealizedSavingsUsd = input.simulatedRealizedSavingsUsd;
  if (availabilityState === "available") {
    simulatedRealizedSavingsUsd = wholeUsd(
      simulatedRealizedSavingsUsd, `${path}.simulatedRealizedSavingsUsd`,
    );
    if (availabilityReason !== null)
      invalid(`${path}.availabilityReason`, "must be null when a measurement exists");
    if (varianceReason === "measurement-unavailable")
      invalid(`${path}.varianceReason`, "available measurements require a measured variance reason");
    const expectedReason = simulatedRealizedSavingsUsd === monthlySavingsUsd
      ? "matched-projection"
      : simulatedRealizedSavingsUsd > monthlySavingsUsd
        ? "above-projection" : "below-projection";
    if (varianceReason !== expectedReason)
      invalid(`${path}.varianceReason`, `must equal ${expectedReason}`);
    if (evidenceRefs.length === 0)
      invalid(`${path}.evidenceProvenance.evidenceRefs`,
        "available measurements require evidence");
  } else {
    if (simulatedRealizedSavingsUsd !== null)
      invalid(`${path}.simulatedRealizedSavingsUsd`,
        "must be null when measurement is unavailable");
    if (varianceReason !== "measurement-unavailable")
      invalid(`${path}.varianceReason`, "must explain unavailable measurement");
    if (!RECONCILIATION_AVAILABILITY_REASONS.includes(availabilityReason))
      invalid(`${path}.availabilityReason`,
        `must be one of ${RECONCILIATION_AVAILABILITY_REASONS.join(", ")}`);
    const expectedAvailabilityReason = isActive
      ? "measurement-pending" : "action-not-started";
    if (availabilityReason !== expectedAvailabilityReason)
      invalid(`${path}.availabilityReason`, `must equal ${expectedAvailabilityReason}`);
    if (evidenceRefs.length !== 0)
      invalid(`${path}.evidenceProvenance.evidenceRefs`,
        "must be empty when no measurement exists");
  }

  const isMeasured = availabilityState === "available";
  return {
    actionId,
    measurementMonth: month,
    projectionBaseline: {
      annualizedSavingsUsd,
      monthlySavingsUsd,
      allocationRule: baseline.allocationRule,
    },
    simulatedRealizedSavingsUsd,
    varianceUsd: isMeasured ? simulatedRealizedSavingsUsd - monthlySavingsUsd : null,
    varianceReason,
    evidenceProvenance: {
      source: requiredText(provenance.source, `${path}.evidenceProvenance.source`),
      evidenceRefs,
    },
    availabilityState,
    availabilityReason: isMeasured ? null : availabilityReason,
    // The three inputs every aggregate is summed from. A consumer can reproduce
    // any total in this contract with addition alone.
    aggregationInput: {
      projectedSavingsUsd: monthlySavingsUsd,
      measuredProjectedSavingsUsd: isMeasured ? monthlySavingsUsd : 0,
      creditedSimulatedRealizedSavingsUsd: isMeasured ? simulatedRealizedSavingsUsd : 0,
    },
  };
}

/** Sum the record inputs of one group. The only place amounts are added. */
function sumInputs(records) {
  const projectedSavingsUsd = records.reduce(
    (total, record) => total + record.aggregationInput.projectedSavingsUsd, 0,
  );
  const measuredProjectedSavingsUsd = records.reduce(
    (total, record) => total + record.aggregationInput.measuredProjectedSavingsUsd, 0,
  );
  const creditedSimulatedRealizedSavingsUsd = records.reduce(
    (total, record) =>
      total + record.aggregationInput.creditedSimulatedRealizedSavingsUsd, 0,
  );
  const availableCount = records.filter(
    (record) => record.availabilityState === "available",
  ).length;
  return {
    projectedSavingsUsd,
    measuredProjectedSavingsUsd,
    unmeasuredProjectedSavingsUsd: projectedSavingsUsd - measuredProjectedSavingsUsd,
    creditedSimulatedRealizedSavingsUsd,
    // No available record means no comparison exists. Zero would read as "on
    // plan", which is the one answer the data cannot support.
    measuredVarianceUsd: availableCount === 0
      ? null : creditedSimulatedRealizedSavingsUsd - measuredProjectedSavingsUsd,
    availableCount,
  };
}

function aggregateByMonth(records) {
  const grouped = Map.groupBy(records, (record) => record.measurementMonth);
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, monthRecords]) => {
      const { availableCount, ...totals } = sumInputs(monthRecords);
      return {
        measurementMonth: month,
        ...totals,
        availableActionCount: availableCount,
        unavailableActionCount: monthRecords.length - availableCount,
        notStartedActionCount: monthRecords.filter(
          (record) => record.availabilityReason === "action-not-started",
        ).length,
      };
    });
}

function aggregateByAction(records, windowMonthCount) {
  const grouped = Map.groupBy(records, (record) => record.actionId);
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([actionId, actionRecords]) => {
      const { availableCount, ...totals } = sumInputs(actionRecords);
      const activeMonthCount = actionRecords.filter(
        (record) => record.projectionBaseline.allocationRule === "even-twelfth",
      ).length;
      return {
        actionId,
        windowMonthCount,
        activeMonthCount,
        measuredMonthCount: availableCount,
        unmeasuredActiveMonthCount: activeMonthCount - availableCount,
        ...totals,
      };
    });
}

/**
 * Derive the measurement window and require the grid to be dense: every
 * portfolio action carries exactly one record for every month in a contiguous
 * window. A missing cell would be indistinguishable from an unmeasured one, and
 * month-to-month totals would silently stop being comparable.
 */
function measurementWindow(records, portfolioActions) {
  const months = [...new Set(records.map((record) => record.measurementMonth))].sort();
  if (months.length === 0) return null;
  for (let index = 1; index < months.length; index += 1) {
    if (months[index] !== nextMonth(months[index - 1]))
      invalid("fixture.records",
        `must cover a contiguous window; ${nextMonth(months[index - 1])} is missing`);
  }
  const present = new Set(
    records.map((record) => `${record.measurementMonth}:${record.actionId}`),
  );
  for (const month of months) {
    for (const actionId of portfolioActions.keys()) {
      if (!present.has(`${month}:${actionId}`))
        invalid("fixture.records",
          `must contain a record for ${actionId} in ${month}`);
    }
  }
  return {
    firstMonth: months[0],
    lastMonth: months.at(-1),
    monthCount: months.length,
  };
}

/**
 * Validate a reconciliation fixture against Noor's validated portfolio shape.
 * Returned records are sorted by month then action ID for stable JSON exports.
 */
export function createMonthlySavingsReconciliation(fixture, portfolio) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture))
    invalid("fixture", "must be an object");
  if (fixture.schemaVersion !== MONTHLY_RECONCILIATION_SCHEMA_VERSION)
    invalid("fixture.schemaVersion",
      `must equal ${MONTHLY_RECONCILIATION_SCHEMA_VERSION}`);
  if (fixture.portfolioSchemaVersion !== SUPPORTED_PORTFOLIO_SCHEMA_VERSION)
    invalid("fixture.portfolioSchemaVersion",
      `must equal ${SUPPORTED_PORTFOLIO_SCHEMA_VERSION}`);
  if (!portfolio || portfolio.schemaVersion !== fixture.portfolioSchemaVersion
    || !Array.isArray(portfolio.actions))
    invalid("portfolio", "must be a compatible validated savings portfolio");
  if (!Array.isArray(fixture.records))
    invalid("fixture.records", "must be an array");

  const portfolioActions = new Map(
    portfolio.actions.map((action) => [action.actionId, action]),
  );
  const validated = fixture.records.map(
    (record, index) => validateRecord(record, index, portfolioActions),
  );

  // Checked before sorting so the reported index is the authored one.
  const keys = new Set();
  for (const [index, record] of validated.entries()) {
    const key = `${record.measurementMonth}:${record.actionId}`;
    if (keys.has(key))
      invalid(`records[${index}]`, "actionId must be unique within a measurement month");
    keys.add(key);
  }
  const window = measurementWindow(validated, portfolioActions);

  const records = validated.sort((left, right) =>
    left.measurementMonth.localeCompare(right.measurementMonth)
      || left.actionId.localeCompare(right.actionId));

  return deepFreeze({
    schemaVersion: fixture.schemaVersion,
    portfolioSchemaVersion: fixture.portfolioSchemaVersion,
    measurementWindow: window,
    records,
    actionAggregationInputs: aggregateByAction(records, window?.monthCount ?? 0),
    monthlyAggregationInputs: aggregateByMonth(records),
  });
}
