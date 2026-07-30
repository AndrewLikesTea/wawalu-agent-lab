// Browser-local memory for exactly one approved monthly department action.
//
// This is deliberately not an analysis cache. It accepts the consumed decision
// contract and projects only the fields needed to reopen the decision and
// compare the same metric after a later local analysis. Source rows, prompts,
// provider payloads, credentials, and customer identifiers have no field here.

export const MONTHLY_ACTION_KEY = "shiplog.finops.monthly-department-action.v1";
export const MONTHLY_ACTION_VERSION = "monthly-department-action/1.0.0";
const CONSUMED_DECISION_VERSION = "monthly-department-decision/1.0.0";

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const REFERENCE = /^[a-z0-9][a-z0-9_.:/-]{0,159}$/i;
const TEXT_LIMIT = 500;

const text = (value, max = TEXT_LIMIT) =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const finitePositive = (value) => Number.isFinite(value) && value > 0;

export function validateMonthlyActionRecord(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, errors: ["record: expected an object"] };
  }
  if (record.schemaVersion !== MONTHLY_ACTION_VERSION) errors.push("schemaVersion: unsupported");
  if (record.decisionVersion !== CONSUMED_DECISION_VERSION) {
    errors.push("decisionVersion: unsupported");
  }
  if (!ID.test(String(record.actionId ?? ""))) errors.push("actionId: invalid");
  if (!text(record.actionLabel, 160)) errors.push("actionLabel: invalid");
  if (!text(record.department, 160)) errors.push("department: invalid");
  if (!text(record.ownerLabel, 160)) errors.push("ownerLabel: invalid");
  if (!MONTH.test(String(record.baseline?.period ?? ""))) errors.push("baseline.period: invalid");
  if (!finitePositive(record.baseline?.value)) errors.push("baseline.value: invalid");
  if (!text(record.baseline?.unit, 80)) errors.push("baseline.unit: invalid");
  if (!text(record.baseline?.aggregation)) errors.push("baseline.aggregation: invalid");
  if (!text(record.baseline?.calculation)) errors.push("baseline.calculation: invalid");
  if (!Number.isFinite(record.target?.value) || record.target.value < 0) {
    errors.push("target.value: invalid");
  }
  if (!text(record.target?.unit, 80)) errors.push("target.unit: invalid");
  if (!DATE.test(String(record.target?.deadline ?? ""))) errors.push("target.deadline: invalid");
  if (!text(record.target?.calculation)) errors.push("target.calculation: invalid");
  if (!MONTH.test(String(record.reviewPeriod ?? ""))) errors.push("reviewPeriod: invalid");
  if (!["high", "medium", "low"].includes(record.confidence)) errors.push("confidence: invalid");
  if (!Array.isArray(record.provenanceReferences)
    || record.provenanceReferences.length > 20
    || record.provenanceReferences.some((value) => !REFERENCE.test(String(value)))) {
    errors.push("provenanceReferences: invalid");
  }
  if (typeof record.committedAt !== "string"
    || !Number.isFinite(Date.parse(record.committedAt))) errors.push("committedAt: invalid");
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function projectMonthlyAction(decision, { now = new Date() } = {}) {
  if (!decision?.action || !decision?.baseline || !decision?.target) return null;
  const record = {
    schemaVersion: MONTHLY_ACTION_VERSION,
    decisionVersion: decision.version,
    actionId: decision.action.id,
    actionLabel: decision.action.label,
    department: decision.department,
    ownerLabel: decision.ownerLabel,
    baseline: {
      value: decision.baseline.value,
      unit: decision.baseline.unit,
      period: decision.baseline.period,
      aggregation: decision.baseline.aggregation,
      calculation: decision.baseline.calculation,
    },
    target: {
      value: decision.target.value,
      unit: decision.target.unit,
      deadline: decision.target.deadline,
      calculation: decision.target.calculation,
    },
    reviewPeriod: decision.reviewPeriod,
    confidence: decision.confidence.value,
    provenanceReferences: [...decision.evidenceReferences],
    committedAt: now.toISOString(),
  };
  return validateMonthlyActionRecord(record).ok ? Object.freeze(record) : null;
}

/** Total read: absent, corrupt, or newer records are ignored and never rewritten. */
export function readMonthlyAction(storage) {
  try {
    const raw = storage?.getItem(MONTHLY_ACTION_KEY);
    if (raw === null) return Object.freeze({ status: "missing", record: null });
    const record = JSON.parse(raw);
    const check = validateMonthlyActionRecord(record);
    if (!check.ok) {
      const status = record?.schemaVersion && record.schemaVersion !== MONTHLY_ACTION_VERSION
        ? "unsupported" : "malformed";
      return Object.freeze({ status, record: null, errors: check.errors });
    }
    return Object.freeze({ status: "restored", record: Object.freeze(record) });
  } catch {
    return Object.freeze({ status: "malformed", record: null });
  }
}

export function writeMonthlyAction(storage, decision, { now = new Date() } = {}) {
  const record = projectMonthlyAction(decision, { now });
  if (!record) return Object.freeze({ ok: false, code: "invalid_record" });
  try {
    storage?.setItem(MONTHLY_ACTION_KEY, JSON.stringify(record));
    const restored = readMonthlyAction(storage);
    return restored.status === "restored"
      ? Object.freeze({ ok: true, code: "retained", record: restored.record })
      : Object.freeze({ ok: false, code: "not_saved" });
  } catch {
    return Object.freeze({ ok: false, code: "not_saved" });
  }
}

/**
 * Compare the committed metric with a newly produced decision. Compatibility is
 * explicit; a mismatch returns no delta and therefore cannot imply savings.
 */
export function compareMonthlyAction(record, current) {
  if (record && current?.baseline?.period <= record.baseline.period) {
    return Object.freeze({
      status: "awaiting_later_analysis", comparable: false,
      baseline: record.baseline.value, current: null, change: null,
    });
  }
  const compatible = Boolean(record && current?.action && current?.baseline
    && record.decisionVersion === current.version
    && record.department === current.department
    && record.actionId === current.action.id
    && record.baseline.unit === current.baseline.unit
    && record.baseline.aggregation === current.baseline.aggregation
    && record.baseline.calculation === current.baseline.calculation);
  if (!compatible) {
    return Object.freeze({
      status: "not_comparable", comparable: false, baseline: record?.baseline?.value ?? null,
      current: null, change: null,
    });
  }
  return Object.freeze({
    status: "comparable",
    comparable: true,
    baseline: record.baseline.value,
    current: current.baseline.value,
    change: current.baseline.value - record.baseline.value,
  });
}
