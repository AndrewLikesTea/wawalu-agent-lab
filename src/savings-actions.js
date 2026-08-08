/**
 * Bounded client-side lifecycle for the synthetic savings-action fixture.
 * There is deliberately no storage, clock, network, or prompt dependency.
 */

/** @typedef {"planned" | "in_progress" | "completed" | "verified"} SavingsActionStatus */

export const SAVINGS_ACTION_STATUSES = Object.freeze([
  "planned", "in_progress", "completed", "verified",
]);

const TRANSITIONS = Object.freeze({
  planned: Object.freeze(["in_progress"]),
  in_progress: Object.freeze(["completed"]),
  completed: Object.freeze(["verified"]),
  verified: Object.freeze([]),
});

export class SavingsActionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SavingsActionError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SavingsActionError(code, message);
}

function finiteNonNegative(value, field, actionId) {
  if (!Number.isFinite(value) || value < 0)
    fail("INVALID_ACTION", `${actionId}: ${field} must be a non-negative finite number.`);
  return value;
}

function copyMeasurement(measurement) {
  return Object.freeze({ ...measurement });
}

function snapshot(record) {
  return Object.freeze({
    ...record,
    evidenceRefs: Object.freeze([...record.evidenceRefs]),
    confidence: Object.freeze({ ...record.confidence }),
    baseline: copyMeasurement(record.baseline),
    target: copyMeasurement(record.target),
    realizedImpact: record.realizedImpact
      ? copyMeasurement(record.realizedImpact) : null,
    provenance: Object.freeze({
      plan: record.provenance.plan,
      confidence: record.provenance.confidence,
      evidenceRefs: Object.freeze([...record.provenance.evidenceRefs]),
    }),
  });
}

/**
 * Estimated minus realized savings. A positive value is below estimate.
 * Missing measurement remains unavailable and is never coerced to zero.
 */
export function savingsVariance(estimatedImpactUsd, realizedImpactUsd) {
  if (!Number.isFinite(estimatedImpactUsd) || realizedImpactUsd === null
    || realizedImpactUsd === undefined || !Number.isFinite(realizedImpactUsd))
    return null;
  const amountUsd = estimatedImpactUsd - realizedImpactUsd;
  return Object.freeze({
    amountUsd,
    percent: estimatedImpactUsd === 0
      ? null : Math.round((amountUsd / estimatedImpactUsd) * 1000) / 10,
  });
}

/**
 * @param {object} fixture evolution-demo-data.json compatible data
 */
export function createSavingsActionStore(fixture = {}) {
  const plan = fixture.actionPlan;
  if (!plan || !Array.isArray(plan.actions) || !Array.isArray(plan.benchmarkPeriods))
    fail("INVALID_FIXTURE", "A versioned action plan with actions and reporting periods is required.");

  const departments = new Map((fixture.departments ?? []).map((item) => [item.id, item]));
  const evidence = new Map((fixture.evidence ?? []).map((item) => [item.sampleId, item]));
  const periods = new Map(plan.benchmarkPeriods.map((item) => [item.periodId, Object.freeze({ ...item })]));
  const records = new Map();

  for (const source of plan.actions) {
    if (records.has(source.actionId))
      fail("INVALID_FIXTURE", `Duplicate actionId: ${source.actionId}.`);
    if (!departments.has(source.departmentId))
      fail("MISSING_DIAGNOSIS", `${source.actionId}: department diagnosis does not exist.`);
    if (!source.evidenceRefs?.length || source.evidenceRefs.some((reference) =>
      evidence.get(reference)?.departmentId !== source.departmentId))
      fail("MISSING_DIAGNOSIS", `${source.actionId}: diagnosis evidence is missing or out of scope.`);
    if (!periods.has(source.baseline?.periodRef) || !periods.has(source.target?.periodRef))
      fail("INVALID_FIXTURE", `${source.actionId}: reporting period reference does not exist.`);

    const baselineValue = finiteNonNegative(source.baseline.value, "baseline.value", source.actionId);
    const targetValue = finiteNonNegative(source.target.value, "target.value", source.actionId);
    const estimatedImpactUsd = finiteNonNegative(
      source.estimatedSavingsUsd, "estimatedSavingsUsd", source.actionId,
    );
    records.set(source.actionId, {
      actionId: source.actionId,
      commitmentCandidateId: source.commitmentCandidateId,
      departmentId: source.departmentId,
      departmentName: source.departmentName,
      diagnosis: source.rationale,
      evidenceRefs: [...source.evidenceRefs],
      priorityRank: source.priorityRank,
      title: source.action,
      accountableRole: source.accountableRole,
      confidence: { ...source.confidence },
      baseline: { ...source.baseline, value: baselineValue },
      target: { ...source.target, value: targetValue },
      estimatedImpactUsd,
      realizedImpact: null,
      status: "planned",
      provenance: {
        plan: plan.provenance,
        confidence: source.confidence.provenance,
        evidenceRefs: [...source.evidenceRefs],
      },
    });
  }

  function getRecord(actionId) {
    const record = records.get(actionId);
    if (!record) fail("ACTION_NOT_FOUND", `Unknown savings action: ${actionId}.`);
    return record;
  }

  return Object.freeze({
    schemaVersion: plan.schemaVersion,

    /** Stable reporting-period selector in fixture order. */
    selectReportingPeriods() {
      return Object.freeze([...periods.values()]);
    },

    /** Stable priority selector; ties resolve by actionId. */
    selectPrioritizedActions(departmentId) {
      return Object.freeze([...records.values()]
        .filter((record) => !departmentId || record.departmentId === departmentId)
        .sort((left, right) =>
          left.priorityRank - right.priorityRank || left.actionId.localeCompare(right.actionId))
        .map(snapshot));
    },

    selectAction(actionId) {
      return snapshot(getRecord(actionId));
    },

    varianceFor(actionId) {
      const record = getRecord(actionId);
      return savingsVariance(record.estimatedImpactUsd, record.realizedImpact?.value);
    },

    /**
     * @param {string} actionId
     * @param {SavingsActionStatus} nextStatus
     * @param {{value?: number, periodRef?: string}} [result]
     */
    transition(actionId, nextStatus, result = {}) {
      const record = getRecord(actionId);
      if (!SAVINGS_ACTION_STATUSES.includes(nextStatus))
        fail("INVALID_STATUS", `Unknown savings action status: ${nextStatus}.`);
      if (!TRANSITIONS[record.status].includes(nextStatus))
        fail("INVALID_TRANSITION", `Cannot transition ${actionId} from ${record.status} to ${nextStatus}.`);

      if (nextStatus === "completed") {
        if (result.value === undefined || result.value === null)
          fail("MISSING_RESULT", `${actionId}: completed actions require a realized result.`);
        const value = finiteNonNegative(result.value, "realizedImpact.value", actionId);
        const periodRef = result.periodRef ?? record.target.periodRef;
        if (periodRef !== record.target.periodRef || !periods.has(periodRef))
          fail("INVALID_PERIOD", `${actionId}: realized result must use its target reporting period.`);
        record.realizedImpact = {
          metricName: record.target.metricName,
          value,
          unit: record.target.unit,
          periodRef,
        };
      }
      record.status = nextStatus;
      return snapshot(record);
    },
  });
}
