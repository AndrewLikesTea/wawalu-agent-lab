// Decision model for the bundled browser-local longitudinal fixture.
// Values are currency minor units. No persistence, network, or import handling
// lives here: callers supply an in-memory fixture and receive a frozen result.

const SCHEMA = "local-finops-longitudinal/1.0.0";
const COMPARABLE = "comparable";
const NON_COMPARABLE = "non-comparable";

function fail(message) {
  throw new TypeError(message);
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function sameDefinition(left, right) {
  return left.metric === right.metric
    && left.currency === right.currency
    && left.coverage === right.coverage;
}

function trendFor(observations, periods) {
  const byPeriod = new Map(observations.map((item) => [item.periodId, item]));
  const changes = [];
  for (const period of periods) {
    if (!period.previousPeriodId) continue;
    const current = byPeriod.get(period.id);
    const previous = byPeriod.get(period.previousPeriodId);
    if (!current || !previous || !sameDefinition(current, previous) || previous.value === 0) continue;
    changes.push(Object.freeze({
      fromPeriodId: previous.periodId,
      toPeriodId: current.periodId,
      percentChange: roundPercent(((current.value - previous.value) / previous.value) * 100),
    }));
  }
  const complete = changes.length === periods.length - 1;
  return Object.freeze({
    status: complete ? COMPARABLE : NON_COMPARABLE,
    reason: complete ? null
      : "Insufficient consecutive periods with the same metric, currency, and coverage; a zero prior value is also unsupported.",
    changes: Object.freeze(changes),
    latestPercentChange: complete ? changes.at(-1).percentChange : null,
  });
}

function validate(fixture) {
  if (fixture?.schemaVersion !== SCHEMA) fail("Unsupported longitudinal fixture schema.");
  const privacy = fixture.privacy;
  if (!privacy || privacy.directIdentifiersIncluded !== false
    || privacy.employeeFieldsIncluded !== false
    || privacy.promptOrResponseContentIncluded !== false
    || privacy.credentialsIncluded !== false) {
    fail("The longitudinal fixture must explicitly exclude identifiers, employee fields, content, and credentials.");
  }
  if (!Array.isArray(fixture.periods) || fixture.periods.length < 3) {
    fail("At least three reporting periods are required.");
  }
  const periodIds = new Set();
  fixture.periods.forEach((period, index) => {
    if (typeof period?.id !== "string" || typeof period.start !== "string"
      || typeof period.end !== "string" || periodIds.has(period.id)
      || period.previousPeriodId !== (index ? fixture.periods[index - 1].id : null)) {
      fail("Reporting periods must be unique and form one declared consecutive chain.");
    }
    periodIds.add(period.id);
  });
  if (!Array.isArray(fixture.observations)) fail("Observations are required.");
  const observationKeys = new Set();
  for (const observation of fixture.observations) {
    if (typeof observation.departmentId !== "string"
      || typeof observation.periodId !== "string"
      || typeof observation.metric !== "string"
      || typeof observation.currency !== "string"
      || typeof observation.coverage !== "string"
      || !Number.isInteger(observation.value) || observation.value < 0) {
      fail("Every observation needs a department, period, definition, and non-negative integer minor-unit value.");
    }
    if (!periodIds.has(observation.periodId)) fail("Every observation must reference a covered period.");
    const key = `${observation.departmentId}\u0000${observation.periodId}`;
    if (observationKeys.has(key)) fail("A department may have only one observation per period.");
    observationKeys.add(key);
  }
}

/**
 * Benchmark = arithmetic mean of the latest-period values for every other
 * eligible department. Eligibility requires at least two departments in the
 * latest period with the exact same metric, currency, and coverage definition.
 * Priority = descending estimated excess, confidence, absolute latest trend,
 * then department ID for a deterministic tie.
 */
export function analyzeLongitudinalFinops(fixture) {
  validate(fixture);
  const periods = fixture.periods;
  const latestPeriod = periods.at(-1);
  const departmentIds = [...new Set(fixture.observations.map((item) => item.departmentId))].sort();
  const histories = new Map(departmentIds.map((departmentId) => [
    departmentId,
    fixture.observations.filter((item) => item.departmentId === departmentId),
  ]));

  const findings = departmentIds.map((departmentId) => {
    const history = histories.get(departmentId);
    const latest = history.find((item) => item.periodId === latestPeriod.id);
    const trend = trendFor(history, periods);
    const cohort = latest ? departmentIds
      .map((id) => histories.get(id).find((item) => item.periodId === latestPeriod.id))
      .filter((item) => item && sameDefinition(item, latest)) : [];
    const eligible = cohort.length >= 2;
    const peers = eligible ? cohort.filter((item) => item.departmentId !== departmentId) : [];
    const benchmarkValue = peers.length
      ? Math.round(peers.reduce((sum, item) => sum + item.value, 0) / peers.length) : null;
    const comparison = eligible && latest && benchmarkValue !== null
      ? Object.freeze({
        status: COMPARABLE,
        benchmarkValue,
        differenceValue: latest.value - benchmarkValue,
        percentDifference: benchmarkValue === 0 ? null
          : roundPercent(((latest.value - benchmarkValue) / benchmarkValue) * 100),
        eligibleDepartmentCount: cohort.length,
      })
      : Object.freeze({
        status: NON_COMPARABLE,
        benchmarkValue: null,
        differenceValue: null,
        percentDifference: null,
        eligibleDepartmentCount: cohort.length,
        reason: "Fewer than two departments share the latest period, metric, currency, and coverage definition.",
      });
    const hasThreeComparablePeriods = trend.status === COMPARABLE && periods.length >= 3;
    const confidence = hasThreeComparablePeriods
      ? (eligible ? "high" : "medium") : NON_COMPARABLE;
    return {
      departmentId,
      latestValue: latest?.value ?? null,
      metric: latest?.metric ?? null,
      currency: latest?.currency ?? null,
      coverage: latest?.coverage ?? null,
      trend,
      comparison,
      confidence,
      estimatedExcessValue: comparison.status === COMPARABLE
        ? Math.max(0, comparison.differenceValue) : null,
    };
  });

  const confidenceRank = { high: 2, medium: 1, [NON_COMPARABLE]: 0 };
  findings.sort((left, right) =>
    (right.estimatedExcessValue ?? -1) - (left.estimatedExcessValue ?? -1)
    || confidenceRank[right.confidence] - confidenceRank[left.confidence]
    || Math.abs(right.trend.latestPercentChange ?? -1)
      - Math.abs(left.trend.latestPercentChange ?? -1)
    || left.departmentId.localeCompare(right.departmentId));

  return Object.freeze({
    schemaVersion: "local-finops-longitudinal-analysis/1.0.0",
    latestPeriodId: latestPeriod.id,
    findings: Object.freeze(findings.map((item, index) =>
      Object.freeze({ ...item, actionPriority: index + 1 }))),
    provenance: Object.freeze({
      source: fixture.source,
      coveredPeriods: Object.freeze(periods.map(({ id, start, end }) =>
        Object.freeze({ id, start, end }))),
      fields: Object.freeze([
        "departmentId", "periodId", "metric", "currency", "coverage", "value",
      ]),
      handling: "Bundled fixture analyzed in browser memory; imported files remain session-only and disappear on refresh.",
    }),
  });
}
