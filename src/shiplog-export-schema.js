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
//   * Field order is the declaration order, and record order is canonical
//     (`compareExportRecords`: oldest first, ties broken by id), so two exports
//     of the same log are byte-identical and two exports of different logs diff
//     cleanly. Without this the file inherited localStorage insertion order,
//     which means the same history exported from two browsers — or from one
//     browser before and after a restore — produced different bytes.
//   * `shiplogExportViolations` states the whole contract as a check a consumer
//     can run, including link integrity: every id in a release's `decisionIds`
//     resolves to a decision in the same file.
//
// Nothing here touches the DOM, storage, the clock, or the network.

import { DEFAULT_HISTORY_FILTERS } from "./history-filters.js";

/** The `schema` discriminator every export file carries. */
export const SHIPLOG_EXPORT_SCHEMA = "shiplog-history";

// Still 1, deliberately. Every change this module made to the exporter narrows
// what a file may contain — undeclared fields and dangling release links — and
// a reader of version 1 accepts a narrower file unchanged. Bumping the number
// would have made every older export unreadable to buy nothing.
export const SHIPLOG_EXPORT_VERSION = 1;

// Which surface wrote the file. Two of them download the same schema — the
// history export panel and the workspace backup — and a reader holding only the
// file otherwise cannot tell a deliberate backup from a filtered download the
// visitor took for one report. Declared as a closed set rather than free text so
// the identifier is a value a consumer can switch on, and stated once here so
// the writer and the reader can never name the surface differently.
export const EXPORT_SOURCES = Object.freeze({
  history: "shiplog.history-panel",
  workspace: "shiplog.workspace-backup",
});

export const DEFAULT_EXPORT_SOURCE = EXPORT_SOURCES.history;

// A field spec is a type token: "string", "number", "object", "array",
// "string[]". A trailing "?" marks the field optional. Required here means
// "the local store guarantees it", which is the rule loadDecisions/loadReleases
// already enforce on the way out of storage — being stricter would reject
// records the browser legitimately holds today.
export const EXPORT_ENVELOPE_FIELDS = Object.freeze({
  schema: "string",
  version: "number",
  generatedAt: "string",
  // What the file is: how many records it carries, and which filter produced
  // them. Both are optional here and required by the exporter — a file written
  // before they existed is still a valid version 1 export, and a reader that
  // ignores them reads the same `decisions` and `releases` it always did.
  //
  // `record_count` is the total across both collections
  // (`decisions.length + releases.length`); Shiplog's records are of two kinds
  // and the file keeps them in two arrays, so one count over both is the number
  // a reader means by "how many records is this".
  record_count: "number?",
  // The same fact per collection, because "how many decisions is this" is the
  // question a reader actually checks a file against and one total over two
  // arrays cannot answer it. Both are derived from the arrays written below —
  // never from the store a second time — so a file cannot claim a count that
  // disagrees with its own records, and a reader that finds one has found a
  // truncated or hand-edited file.
  decision_count: "number?",
  release_count: "number?",
  // Which surface wrote the file (EXPORT_SOURCES).
  source: "string?",
  // The active filters, keyed and valued exactly as activeHistoryFilters()
  // states them: present means active, absent means off, `{}` means the file is
  // the whole browsed history.
  filter: "object?",
  decisions: "array",
  releases: "array",
  // Required on files produced now; optional in the version-1 reader so an
  // export written before associations became explicit remains readable.
  associations: "array?",
});

// One row per decision-to-release link. `position` is the index of `decisionId`
// within that release's own `decisionIds` *as this file carries it* — 0-based
// and contiguous, so the third row for a release is that release's third
// decision and nothing else. It is not an index into whatever the exporting
// browser held: a link the file could not carry is absent from both collections
// rather than left as a gap somebody would have to interpret.
export const EXPORT_ASSOCIATION_FIELDS = Object.freeze({
  decisionId: "string",
  releaseId: "string",
  position: "number",
});

// The filter dimensions a `filter` block may name, with the type each value
// carries. A key outside this set is drift — a new dimension that reached the
// file without being declared — and is reported rather than passed along.
export const EXPORT_FILTER_FIELDS = Object.freeze({
  query: "string",
  type: "string",
  status: "string",
  owner: "string",
  // The release whose decisions were on screen, by id. The id and not the
  // version: the version is a label that a re-release can reuse, and the file
  // has to name the release the reader can look up in its own `releases`.
  releaseId: "string",
  from: "string",
  to: "string",
  currentOnly: "boolean",
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

/**
 * The canonical order of a collection in an export file: oldest record first,
 * ties broken by id.
 *
 * `createdAt` alone is not a total order — two records written in the same
 * millisecond, or restored from a file that carried both, would keep whatever
 * order storage happened to hold. The id tiebreak closes that, and both stores
 * guarantee a unique string id, so the comparator is total: the same set of
 * records always produces the same sequence regardless of how it arrived.
 *
 * A record whose `createdAt` does not parse sorts after every dated record
 * rather than at an arbitrary point, still ordered by id. Neither store can
 * produce one (loadDecisions/loadReleases reject them), but this comparator is
 * exported and a consumer may hand it a file it did not write.
 */
export function compareExportRecords(a, b) {
  const timeOf = (record) => {
    const parsed = Date.parse(record?.createdAt);
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  };
  const left = timeOf(a);
  const right = timeOf(b);
  if (left !== right) return left < right ? -1 : 1;
  const leftId = typeof a?.id === "string" ? a.id : "";
  const rightId = typeof b?.id === "string" ? b.id : "";
  if (leftId === rightId) return 0;
  return leftId < rightId ? -1 : 1;
}

/** A copy of `records` in canonical export order. Never mutates the input. */
export function canonicalExportOrder(records) {
  return Array.isArray(records) ? [...records].sort(compareExportRecords) : [];
}

/**
 * Collections that are not in canonical order, named with the first record that
 * is out of place — the check a consumer runs to tell "this file was written by
 * a conforming exporter" from "this file was hand-edited or reordered".
 */
export function orderingViolations(payload) {
  const violations = [];
  for (const kind of ["decisions", "releases"]) {
    const records = payload?.[kind];
    if (!Array.isArray(records)) continue;
    for (let index = 1; index < records.length; index += 1) {
      if (compareExportRecords(records[index - 1], records[index]) <= 0) continue;
      violations.push(
        `export.${kind}[${index}]: ${JSON.stringify(records[index]?.id)} is out of canonical order `
        + "(oldest createdAt first, ties by id)",
      );
      break;
    }
  }
  return violations;
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
 * `associations` is the flat decision-to-release join, and it is *derived*:
 * `releases[].decisionIds` flattened in file order, one row per link, where
 * `position` is the index into the release's own `decisionIds` as this file
 * carries it. So it is fully determined by the rest of the file, and this check
 * is what makes it safe to publish a second copy of the same fact — a reader
 * that joins on `associations` and a reader that walks `decisionIds` cannot get
 * different answers without the file being reported as invalid.
 *
 * Reported row by row rather than as one verdict, because a file that has
 * drifted is being diagnosed, and "row 7 should be X" is the finding; "these do
 * not match" only says to go and diff them by hand.
 */
export function associationViolations(payload) {
  if (payload?.associations === undefined) return [];
  if (!Array.isArray(payload.associations)) return [];
  const violations = [];
  payload.associations.forEach((association, index) => {
    violations.push(...fieldViolations(
      `export.associations[${index}]`, association, EXPORT_ASSOCIATION_FIELDS,
    ));
  });
  if (!Array.isArray(payload.releases)) return violations;
  const expected = payload.releases.flatMap((release) => (
    isRecordObject(release) && Array.isArray(release.decisionIds)
      ? release.decisionIds.map((decisionId, position) => ({ decisionId, releaseId: release.id, position }))
      : []
  ));
  expected.forEach((row, index) => {
    const actual = payload.associations[index];
    if (actual?.decisionId === row.decisionId
      && actual?.releaseId === row.releaseId
      && actual?.position === row.position) return;
    violations.push(
      `export.associations[${index}]: expected ${JSON.stringify(row)}, got ${JSON.stringify(actual ?? null)}`,
    );
  });
  if (payload.associations.length > expected.length) {
    violations.push(
      `export.associations: carries ${payload.associations.length} links, but this file's `
      + `releases name ${expected.length}`,
    );
  }
  return violations;
}

/**
 * The `filter` block's own contract: every key is a declared filter dimension,
 * every value has that dimension's type, and no key carries the value that
 * means "off".
 *
 * The last rule is the one worth stating as a check. A block that wrote
 * `status: "all"` would read as *a status filter for the word "all"* to anybody
 * who has not read history-filters.js, and it would make `{}` stop being the
 * only way a file says "no filter was active".
 */
export function filterBlockViolations(payload) {
  const block = payload?.filter;
  if (block === undefined) return [];
  if (!isRecordObject(block)) return [`export.filter: expected an object, got ${typeName(block)}`];
  const violations = [];
  for (const [key, value] of Object.entries(block)) {
    const type = EXPORT_FILTER_FIELDS[key];
    if (!type) {
      violations.push(`export.filter: undeclared filter ${JSON.stringify(key)}`);
      continue;
    }
    if (typeName(value) !== type) {
      violations.push(`export.filter.${key}: expected ${type}, got ${typeName(value)}`);
      continue;
    }
    if (value === DEFAULT_HISTORY_FILTERS[key]) {
      violations.push(
        `export.filter.${key}: ${JSON.stringify(value)} means this filter was not active; `
        + "an inactive filter is omitted from the block",
      );
    }
  }
  return violations;
}

// The three counts an envelope may state, each with the collections it counts.
// A count is checked against the arrays in the same file and nothing else.
const ENVELOPE_COUNTS = Object.freeze([
  { field: "decision_count", noun: "decisions", collections: ["decisions"] },
  { field: "release_count", noun: "releases", collections: ["releases"] },
  { field: "record_count", noun: "records", collections: ["decisions", "releases"] },
]);

/**
 * Every envelope count that disagrees with the records the file carries, as
 * structured rows rather than sentences.
 *
 * Structured because two callers need the same fact in two registers: this
 * module reports it as a contract violation, and shiplog-import.js refuses the
 * whole file over it in the visitor's own words. Deriving both from one row
 * keeps them from drifting into two different accounts of the same file.
 *
 * A count that disagrees with the arrays is worse than no count at all — it is
 * the number a consumer would check the file against — so it is reported rather
 * than reconciled quietly. An absent count predates the field and is not a
 * mismatch; a present count that is not an integer is.
 *
 * @returns `{ field, noun, claimed, actual, message }` per mismatch, where
 *   `actual` is null when the count could not be compared to anything.
 */
export function envelopeCountMismatches(payload) {
  const mismatches = [];
  for (const { field, noun, collections } of ENVELOPE_COUNTS) {
    const claimed = payload?.[field];
    if (claimed === undefined) continue;
    if (typeof claimed !== "number" || !Number.isInteger(claimed)) {
      mismatches.push({
        field, noun, claimed, actual: null,
        message: `${field}: expected an integer, got ${JSON.stringify(claimed) ?? typeof claimed}`,
      });
      continue;
    }
    const arrays = collections.map((kind) => payload?.[kind]);
    if (arrays.some((records) => !Array.isArray(records))) continue;
    const actual = arrays.reduce((total, records) => total + records.length, 0);
    if (claimed === actual) continue;
    mismatches.push({
      field, noun, claimed, actual,
      message: `${field}: envelope claims ${claimed} ${noun}, file contains ${actual}`,
    });
  }
  return mismatches;
}

/**
 * The envelope counts as contract violations: each states the size of the file
 * it is in, or it is a violation.
 */
export function recordCountViolations(payload) {
  return envelopeCountMismatches(payload).map((mismatch) => `export.${mismatch.message}`);
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
    if (payload.source !== undefined && !Object.values(EXPORT_SOURCES).includes(payload.source)) {
      violations.push(
        `export.source: expected one of ${Object.values(EXPORT_SOURCES).map((id) => JSON.stringify(id)).join(", ")}, `
        + `got ${JSON.stringify(payload.source)}`,
      );
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
  violations.push(...filterBlockViolations(payload));
  violations.push(...recordCountViolations(payload));
  violations.push(...linkIntegrityViolations(payload));
  violations.push(...associationViolations(payload));
  violations.push(...orderingViolations(payload));
  return violations;
}
