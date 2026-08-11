// A deliberately small, closed transfer format for browser-local FinOps state.
// It carries derived summaries and setup inputs only. Raw imports never have a
// field in this contract, and every object is rejected when it has extra fields.

import {
  FINOPS_COMMITMENT_ACTION_FIELDS, FINOPS_COMMITMENT_CLAIM_FIELDS,
  FINOPS_COMMITMENT_CONFIDENCE_FIELDS, FINOPS_COMMITMENT_ENVELOPE_FIELDS,
  FINOPS_COMMITMENT_PROVENANCE_FIELDS, FINOPS_PERIOD_FIELDS, FINOPS_WORKSPACE_KEY,
} from "./finops-workspace-contract.js";
import {
  readFinopsDocument, scanRetainedContent, validateRetainedCommitment, validateRetainedPeriod,
} from "./finops-workspace.js";
import { ORG_UNIT_LABEL_STORAGE_KEY, readOrgUnitLabels } from "./org-unit-labels.js";
import {
  RETAINED_STATE_KEY, loadRetainedState, validateRetainedPayload,
} from "./finops-retained-state.js";
import {
  MONTHLY_ACTION_KEY, readMonthlyAction, validateMonthlyActionRecord,
} from "./monthly-department-action-store.js";

export const FINOPS_PORTABLE_VERSION = "finops-portable-record/1.0.0";
export const FINOPS_PORTABLE_LIMITS = Object.freeze({ bytes: 1_000_000, periods: 24, commitments: 50 });
const ROOT_FIELDS = Object.freeze([
  "schemaVersion", "periods", "labels", "declaredRates", "commitmentInputs",
]);
const INPUT_FIELDS = Object.freeze(["approvedCommitments", "monthlyDepartmentAction"]);
const RATE_FIELDS = Object.freeze(["model", "unit", "rate", "effectiveDate", "sourceLabel"]);
const ACTION_FIELDS = Object.freeze([
  "schemaVersion", "decisionVersion", "actionId", "actionLabel", "department", "ownerLabel",
  "baseline", "target", "reviewPeriod", "confidence", "provenanceReferences", "committedAt",
]);
const BASELINE_FIELDS = Object.freeze(["value", "unit", "period", "aggregation", "calculation"]);
const TARGET_FIELDS = Object.freeze(["value", "unit", "deadline", "calculation"]);

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const pick = (value, fields) => Object.fromEntries(fields
  .filter((field) => value?.[field] !== undefined).map((field) => [field, value[field]]));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const stable = (value) => JSON.stringify(canonical(value));

function closed(value, fields, path, errors) {
  if (!object(value)) {
    errors.push(`${path}: expected an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) errors.push(`${path}.${key}: unsupported or prohibited field`);
  }
  return true;
}

function checkPeriod(value, index, errors) {
  const path = `periods[${index}]`;
  closed(value, FINOPS_PERIOD_FIELDS, path, errors);
  if (Array.isArray(value?.departmentAllocations)) value.departmentAllocations.forEach((row, rowIndex) =>
    closed(row, ["departmentId", "recoverableMinor"], `${path}.departmentAllocations[${rowIndex}]`, errors));
  errors.push(...validateRetainedPeriod(value).errors.map((error) => `${path}: ${error}`));
}

function checkCommitment(value, index, errors) {
  const path = `commitmentInputs.approvedCommitments[${index}]`;
  if (closed(value, FINOPS_COMMITMENT_ENVELOPE_FIELDS, path, errors)) {
    closed(value.claim, FINOPS_COMMITMENT_CLAIM_FIELDS, `${path}.claim`, errors);
    closed(value.confidence, FINOPS_COMMITMENT_CONFIDENCE_FIELDS, `${path}.confidence`, errors);
    closed(value.provenance, FINOPS_COMMITMENT_PROVENANCE_FIELDS, `${path}.provenance`, errors);
    closed(value.recommendedAction, FINOPS_COMMITMENT_ACTION_FIELDS, `${path}.recommendedAction`, errors);
  }
  errors.push(...validateRetainedCommitment(value).errors.map((error) => `${path}: ${error}`));
}

/** Build the sole portable projection. Arrays are sorted so equivalent state is byte-identical. */
export function buildFinopsPortableRecord(storage) {
  const workspace = readFinopsDocument(storage).document;
  const retained = loadRetainedState({ storage });
  const monthly = readMonthlyAction(storage).record;
  return Object.freeze({
    schemaVersion: FINOPS_PORTABLE_VERSION,
    periods: [...workspace.periods].map((entry) => pick(entry, FINOPS_PERIOD_FIELDS))
      .sort((a, b) => a.periodId.localeCompare(b.periodId)),
    labels: canonical(readOrgUnitLabels(storage)),
    declaredRates: (retained.payload?.declaredRates ?? []).map((entry) => pick(entry, RATE_FIELDS))
      .sort((a, b) => a.model.localeCompare(b.model) || a.effectiveDate.localeCompare(b.effectiveDate)),
    commitmentInputs: {
      approvedCommitments: [...workspace.commitments]
        .map((entry) => pick(entry, FINOPS_COMMITMENT_ENVELOPE_FIELDS))
        .sort((a, b) => a.commitmentId.localeCompare(b.commitmentId)),
      monthlyDepartmentAction: monthly ? pick(monthly, ACTION_FIELDS) : null,
    },
  });
}

export function serializeFinopsPortableRecord(storage) {
  return `${JSON.stringify(buildFinopsPortableRecord(storage), null, 2)}\n`;
}

/** Parse and validate without throwing or echoing file content into an error. */
export function parseFinopsPortableRecord(text) {
  if (typeof text !== "string") return { ok: false, errors: ["File: expected JSON text"] };
  if (new TextEncoder().encode(text).length > FINOPS_PORTABLE_LIMITS.bytes) {
    return { ok: false, errors: [`File: exceeds ${FINOPS_PORTABLE_LIMITS.bytes} byte limit`] };
  }
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, errors: ["File: malformed JSON"] }; }
  const errors = [];
  if (!closed(value, ROOT_FIELDS, "record", errors)) return { ok: false, errors };
  if (value.schemaVersion !== FINOPS_PORTABLE_VERSION) {
    errors.push(`record.schemaVersion: unsupported version ${String(value.schemaVersion)}`);
  }
  if (!Array.isArray(value.periods) || value.periods.length > FINOPS_PORTABLE_LIMITS.periods) {
    errors.push(`record.periods: expected at most ${FINOPS_PORTABLE_LIMITS.periods} entries`);
  } else value.periods.forEach((entry, index) => checkPeriod(entry, index, errors));
  if (!object(value.labels) || Object.keys(value.labels).length > 500) {
    errors.push("record.labels: expected an object with at most 500 labels");
  } else for (const [id, label] of Object.entries(value.labels)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) || typeof label !== "string"
      || !label.trim() || label.length > 160) errors.push(`record.labels.${id}: invalid label`);
  }
  if (!Array.isArray(value.declaredRates) || value.declaredRates.length > 200) {
    errors.push("record.declaredRates: expected at most 200 rates");
  } else if (value.declaredRates.length) {
    const payload = { version: 2, capturedAt: "2000-01-01T00:00:00.000Z",
      declaredRates: value.declaredRates, scoredCoverage: { coverage: null, departmentIds: [] } };
    value.declaredRates.forEach((rate, index) => closed(rate, RATE_FIELDS, `declaredRates[${index}]`, errors));
    if (!validateRetainedPayload(payload)) errors.push("record.declaredRates: one or more rates are invalid");
  }
  if (closed(value.commitmentInputs, INPUT_FIELDS, "record.commitmentInputs", errors)) {
    const commitments = value.commitmentInputs.approvedCommitments;
    if (!Array.isArray(commitments) || commitments.length > FINOPS_PORTABLE_LIMITS.commitments) {
      errors.push(`record.commitmentInputs.approvedCommitments: expected at most ${FINOPS_PORTABLE_LIMITS.commitments} entries`);
    } else commitments.forEach((entry, index) => checkCommitment(entry, index, errors));
    const action = value.commitmentInputs.monthlyDepartmentAction;
    if (action !== null) {
      if (closed(action, ACTION_FIELDS, "record.commitmentInputs.monthlyDepartmentAction", errors)) {
        closed(action.baseline, BASELINE_FIELDS, "record.commitmentInputs.monthlyDepartmentAction.baseline", errors);
        closed(action.target, TARGET_FIELDS, "record.commitmentInputs.monthlyDepartmentAction.target", errors);
      }
      errors.push(...validateMonthlyActionRecord(action).errors.map((error) =>
        `record.commitmentInputs.monthlyDepartmentAction: ${error}`));
    }
  }
  const scan = scanRetainedContent(value, "record");
  for (const violation of scan.violations) errors.push(`${violation.path}: prohibited content`);
  return errors.length ? { ok: false, errors: Object.freeze(errors) }
    : { ok: true, record: Object.freeze(value), errors: Object.freeze([]) };
}

function existingProjection(storage) {
  return buildFinopsPortableRecord(storage);
}

/**
 * Atomically replace portable state. A non-empty, different record requires an
 * explicit second call with `confirm: true`; failed writes are rolled back.
 */
export function importFinopsPortableRecord(storage, parsed, { confirm = false, now = new Date() } = {}) {
  if (!parsed?.ok) return { ok: false, code: "invalid_file", errors: parsed?.errors ?? ["File was not validated"] };
  const incoming = parsed.record;
  const current = existingProjection(storage);
  const hasCurrent = current.periods.length || Object.keys(current.labels).length
    || current.declaredRates.length || current.commitmentInputs.approvedCommitments.length
    || current.commitmentInputs.monthlyDepartmentAction;
  if (hasCurrent && stable(current) !== stable(incoming) && !confirm) {
    return { ok: false, code: "confirmation_required",
      message: "This file differs from the FinOps record already in this browser. Confirm replacement or cancel; nothing has changed." };
  }
  const keys = [FINOPS_WORKSPACE_KEY, ORG_UNIT_LABEL_STORAGE_KEY, RETAINED_STATE_KEY, MONTHLY_ACTION_KEY];
  const before = new Map();
  const rollback = () => {
    for (const [key, value] of before) value === null ? storage.removeItem(key) : storage.setItem(key, value);
  };
  try {
    for (const key of keys) before.set(key, storage.getItem(key));
    const decidedAt = now.toISOString();
    storage.setItem(FINOPS_WORKSPACE_KEY, JSON.stringify({
      schemaVersion: "finops-workspace/1.1.0",
      consent: { state: "granted", decidedAt, grantedAgainst: "finops-workspace/1.1.0" },
      periods: incoming.periods, commitments: incoming.commitmentInputs.approvedCommitments,
      meta: { lastWriteAt: decidedAt },
    }));
    if (Object.keys(incoming.labels).length) storage.setItem(ORG_UNIT_LABEL_STORAGE_KEY, JSON.stringify(incoming.labels));
    else storage.removeItem(ORG_UNIT_LABEL_STORAGE_KEY);
    if (incoming.declaredRates.length) storage.setItem(RETAINED_STATE_KEY, JSON.stringify({
      version: 2, capturedAt: decidedAt, declaredRates: incoming.declaredRates,
      scoredCoverage: { coverage: null, departmentIds: [] },
    })); else storage.removeItem(RETAINED_STATE_KEY);
    if (incoming.commitmentInputs.monthlyDepartmentAction) storage.setItem(MONTHLY_ACTION_KEY,
      JSON.stringify(incoming.commitmentInputs.monthlyDepartmentAction));
    else storage.removeItem(MONTHLY_ACTION_KEY);
    if (stable(existingProjection(storage)) !== stable(incoming)) {
      rollback();
      return { ok: false, code: "write_failed", message: "The browser did not preserve the complete import, so the prior record was restored." };
    }
  } catch {
    try { rollback(); } catch { /* observable below */ }
    return { ok: false, code: "write_failed", message: "The browser refused the import. The prior record was restored where possible." };
  }
  return { ok: true, code: "imported", message: "FinOps record imported. Prior-period summaries and commitment inputs are now available in this browser." };
}
