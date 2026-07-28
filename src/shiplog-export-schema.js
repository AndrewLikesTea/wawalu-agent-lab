// The Shiplog export contract, stated once and shipped with the product.
//
// Until now the shape of an export file existed in three places that only
// agreed by convention: the exporter (which echoed whatever storage held), the
// importer's validators, and a pin in tests/support/export-parity.js. This
// module is the shipped declaration the exporter is built from, so the file a
// visitor downloads is a *closed* record rather than a copy of browser state:
//
//   * Every field in the file is a field declared here. A key that some other
//     module (or a hand-edited store) left on a record is not carried out of
//     the browser — PRODUCT.md rules out exporting credentials, cookies,
//     customer data, and telemetry, and an allowlist is the only version of
//     that promise that survives a future writer who does not read this file.
//   * Field order is the declaration order, so two exports of the same log
//     diff cleanly.
//   * `shiplogExportViolations` states the whole contract as a check a consumer
//     can run, including link integrity: every id in a release's `decisionIds`
//     resolves to a decision in the same file.
//
// Nothing here touches the DOM, storage, the clock, or the network.

/** The `schema` discriminator every export file carries. */
export const SHIPLOG_EXPORT_SCHEMA = "shiplog-history";

// Still 1, deliberately. Every change this module made to the exporter narrows
// what a file may contain — undeclared fields and dangling release links — and
// a reader of version 1 accepts a narrower file unchanged. Bumping the number
// would have made every older export unreadable to buy nothing.
export const SHIPLOG_EXPORT_VERSION = 1;

// A field spec is a type token: "string", "number", "object", "array",
// "string[]". A trailing "?" marks the field optional. Required here means
// "the local store guarantees it", which is the rule loadDecisions/loadReleases
// already enforce on the way out of storage — being stricter would reject
// records the browser legitimately holds today.
export const EXPORT_ENVELOPE_FIELDS = Object.freeze({
  schema: "string",
  version: "number",
  generatedAt: "string",
  decisions: "array",
  releases: "array",
});

export const EXPORT_DECISION_FIELDS = Object.freeze({
  id: "string",
  title: "string",
  context: "string",
  // Optional because a decision recorded before the field existed has none;
  // createDecision writes "" when the visitor leaves it blank.
  alternatives: "string?",
  owner: "string",
  status: "string",
  createdAt: "string",
  // The forward supersede link only (see supersede.js).
  supersedes: "string?",
  // Two derived blocks a decision may carry. Each is owned, validated, and
  // pinned by its own module — finops-commitment-decision.js and
  // decision-reconciliation.js — and is declared here as an opaque object so
  // that the block a visitor's browser durably holds is a block their backup
  // restores.
  finopsCommitment: "object?",
  finopsReconciliation: "object?",
});

export const EXPORT_RELEASE_FIELDS = Object.freeze({
  id: "string",
  version: "string",
  // Optional copy: release-form.js only writes these when they are non-empty,
  // and `notes`/`author` exist on records that predate the current form.
  title: "string?",
  description: "string?",
  notes: "string?",
  owner: "string?",
  author: "string?",
  status: "string?",
  createdAt: "string",
  decisionIds: "string[]",
});

function typeName(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function isRecordObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Copy exactly the declared fields that are present, in declaration order.
 *
 * Undefined-valued fields are omitted rather than written as `undefined`, so
 * the result survives JSON.stringify unchanged. The copy is deep: a caller can
 * hold the result while the store keeps changing underneath it.
 */
export function normalizeExportRecord(record, fields) {
  const normalized = {};
  if (!isRecordObject(record)) return normalized;
  for (const field of Object.keys(fields)) {
    if (record[field] === undefined) continue;
    normalized[field] = structuredClone(record[field]);
  }
  return normalized;
}

/** The keys a record carries that the export contract does not declare. */
export function undeclaredExportFields(record, fields) {
  if (!isRecordObject(record)) return [];
  return Object.keys(record).filter((field) => !(field in fields));
}

function fieldViolations(path, record, fields) {
  if (!isRecordObject(record)) return [`${path}: expected an object, got ${typeName(record)}`];
  const violations = [];
  for (const [field, token] of Object.entries(fields)) {
    const optional = token.endsWith("?");
    const type = optional ? token.slice(0, -1) : token;
    const value = record[field];
    if (value === undefined) {
      if (!optional) violations.push(`${path}: missing required field ${JSON.stringify(field)}`);
      continue;
    }
    if (type === "string[]") {
      if (!Array.isArray(value)) {
        violations.push(`${path}.${field}: expected array, got ${typeName(value)}`);
        continue;
      }
      value.forEach((item, index) => {
        if (typeof item !== "string") {
          violations.push(`${path}.${field}[${index}]: expected string, got ${typeName(item)}`);
        }
      });
      continue;
    }
    if (typeName(value) !== type) {
      violations.push(`${path}.${field}: expected ${type}, got ${typeName(value)}`);
    }
  }
  for (const field of undeclaredExportFields(record, fields)) {
    violations.push(`${path}: undeclared field ${JSON.stringify(field)}`);
  }
  return violations;
}

function duplicateIdViolations(kind, records) {
  const seen = new Map();
  for (const record of records) {
    if (!isRecordObject(record) || typeof record.id !== "string") continue;
    seen.set(record.id, (seen.get(record.id) ?? 0) + 1);
  }
  return [...seen]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => `export.${kind}: id ${JSON.stringify(id)} appears ${count} times, expected exactly once`);
}

/**
 * Link integrity: every decision id a release names resolves to a decision
 * record in the same file.
 *
 * This is the property that makes the file portable rather than a browser
 * fragment — a reader that has only this file can resolve every association it
 * claims. The exporter holds it by construction; this states it as a check, so
 * a consumer (or a future writer) is not asked to take it on trust.
 */
export function linkIntegrityViolations(payload) {
  if (!Array.isArray(payload?.decisions) || !Array.isArray(payload?.releases)) return [];
  const known = new Set(
    payload.decisions
      .filter((decision) => isRecordObject(decision) && typeof decision.id === "string")
      .map((decision) => decision.id),
  );
  const violations = [];
  payload.releases.forEach((release, index) => {
    if (!isRecordObject(release) || !Array.isArray(release.decisionIds)) return;
    release.decisionIds.forEach((id, position) => {
      if (typeof id === "string" && known.has(id)) return;
      violations.push(
        `export.releases[${index}].decisionIds[${position}]: ${JSON.stringify(id)} `
        + "does not resolve to a decision in this export",
      );
    });
  });
  return violations;
}

/**
 * Every way a payload can fail the contract, collected. An empty array means
 * the file is a valid Shiplog export.
 *
 * Collecting rather than throwing on the first problem is deliberate: the
 * failure list is the deliverable, and a caller diagnosing a drifted file wants
 * all of it at once.
 */
export function shiplogExportViolations(payload) {
  const violations = fieldViolations("export", payload, EXPORT_ENVELOPE_FIELDS);
  if (isRecordObject(payload)) {
    if (payload.schema !== undefined && payload.schema !== SHIPLOG_EXPORT_SCHEMA) {
      violations.push(`export.schema: expected ${JSON.stringify(SHIPLOG_EXPORT_SCHEMA)}, got ${JSON.stringify(payload.schema)}`);
    }
    if (payload.version !== undefined && payload.version !== SHIPLOG_EXPORT_VERSION) {
      violations.push(`export.version: expected ${SHIPLOG_EXPORT_VERSION}, got ${JSON.stringify(payload.version)}`);
    }
    if (typeof payload.generatedAt === "string" && Number.isNaN(Date.parse(payload.generatedAt))) {
      violations.push(`export.generatedAt: expected an ISO date, got ${JSON.stringify(payload.generatedAt)}`);
    }
  }
  for (const [kind, fields] of [["decisions", EXPORT_DECISION_FIELDS], ["releases", EXPORT_RELEASE_FIELDS]]) {
    if (!Array.isArray(payload?.[kind])) continue;
    payload[kind].forEach((record, index) => {
      violations.push(...fieldViolations(`export.${kind}[${index}]`, record, fields));
    });
    violations.push(...duplicateIdViolations(kind, payload[kind]));
  }
  violations.push(...linkIntegrityViolations(payload));
  return violations;
}
