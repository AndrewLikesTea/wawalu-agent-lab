// Assertion helpers for the Shiplog JSON export: record-for-record parity and
// a pinned field shape.
//
// The failure message is the deliverable here. Both checkers collect *every*
// violation and name the offending record id or field, so a drifted export
// reports "export.decisions: missing 1 record(s) [seed-cache]" or
// "export.decisions[0]: missing field 'owner'" instead of a deep-equal dump
// that leaves the reader diffing two JSON blobs by eye.
//
// Neither helper touches the DOM, the clock, or the network: they take a parsed
// payload and a plain expectation, so tests/export-parity.test.js can point them
// at a real export from the page and at deliberately mutated copies of one.

// --- parity ----------------------------------------------------------------

const sorted = (ids) => [...ids].sort();
const list = (ids) => sorted(ids).map((id) => JSON.stringify(id)).join(", ");

function duplicateIds(ids) {
  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen].filter(([, count]) => count > 1);
}

// Sorted id sets on both sides, so a change of ordering never silently carries
// an assertion, and the symmetric difference is reported in both directions.
function collectionViolations(kind, expected, actual, fields) {
  const violations = [];
  const expectedIds = expected.map((record) => record.id);
  const actualIds = actual.map((record) => record.id);
  const expectedSet = new Set(expectedIds);
  const actualSet = new Set(actualIds);

  const missing = sorted(expectedIds.filter((id) => !actualSet.has(id)));
  const extra = sorted(actualIds.filter((id) => !expectedSet.has(id)));
  if (missing.length > 0) {
    violations.push(`export.${kind}: missing ${missing.length} record(s) [${list(missing)}] that the visitor can see`);
  }
  if (extra.length > 0) {
    violations.push(`export.${kind}: ${extra.length} extra record(s) [${list(extra)}] that the visitor cannot see`);
  }
  for (const [id, count] of duplicateIds(actualIds)) {
    violations.push(`export.${kind}: id ${JSON.stringify(id)} appears ${count} times, expected exactly once`);
  }

  for (const record of expected) {
    const found = actual.filter((candidate) => candidate.id === record.id);
    if (found.length === 0) continue;
    const [exported] = found;
    for (const field of fields) {
      if (record[field] === undefined) continue;
      if (exported[field] !== record[field]) {
        violations.push(
          `export.${kind}[id=${JSON.stringify(record.id)}].${field}: expected ${JSON.stringify(record[field])}, `
          + `got ${JSON.stringify(exported[field])}`,
        );
      }
    }
  }
  return violations;
}

// Every decision<->release association in the expectation survives, and no
// association the fixture never made is invented.
function associationViolations(expected, actual) {
  const violations = [];
  for (const release of expected) {
    if (!Array.isArray(release.decisionIds)) continue;
    const exported = actual.find((candidate) => candidate.id === release.id);
    if (!exported) continue;
    if (!Array.isArray(exported.decisionIds)) {
      violations.push(
        `export.releases[id=${JSON.stringify(release.id)}].decisionIds: expected an array of decision ids, `
        + `got ${JSON.stringify(exported.decisionIds)}`,
      );
      continue;
    }
    const linked = new Set(exported.decisionIds);
    const wanted = new Set(release.decisionIds);
    for (const id of sorted(release.decisionIds).filter((candidate) => !linked.has(candidate))) {
      violations.push(
        `export.releases[id=${JSON.stringify(release.id)}].decisionIds: missing association with decision ${JSON.stringify(id)}`,
      );
    }
    for (const id of sorted(exported.decisionIds).filter((candidate) => !wanted.has(candidate))) {
      violations.push(
        `export.releases[id=${JSON.stringify(release.id)}].decisionIds: spurious association with decision ${JSON.stringify(id)}`,
      );
    }
  }
  return violations;
}

const DECISION_FIELDS = ["title", "context", "alternatives", "owner", "status", "createdAt"];
const RELEASE_FIELDS = ["version", "title", "description", "owner", "status", "createdAt"];

// `expected` is the set of records the visitor can see, expressed as plain
// objects with at least an id. Any other field present on an expected record is
// compared against the exported one, so a caller opts in to field-level parity
// simply by putting the field in the fixture.
export function parityViolations(expected, payload) {
  const violations = [];
  for (const kind of ["decisions", "releases"]) {
    if (!Array.isArray(payload?.[kind])) {
      violations.push(`export.${kind}: expected an array of records, got ${JSON.stringify(payload?.[kind])}`);
    }
  }
  if (violations.length > 0) return violations;

  violations.push(...collectionViolations("decisions", expected.decisions ?? [], payload.decisions, DECISION_FIELDS));
  violations.push(...collectionViolations("releases", expected.releases ?? [], payload.releases, RELEASE_FIELDS));
  violations.push(...associationViolations(expected.releases ?? [], payload.releases));
  return violations;
}

// --- shape -----------------------------------------------------------------

// A field spec is a type token: "string", "number", "array", "string[]", with a
// trailing "?" marking the field optional. Unknown fields are reported too — an
// export that grows a field nobody pinned is drift the reader should see.
function typeName(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function fieldViolations(path, record, spec) {
  const violations = [];
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return [`${path}: expected an object, got ${typeName(record)}`];
  }
  for (const [field, token] of Object.entries(spec)) {
    const optional = token.endsWith("?");
    const type = optional ? token.slice(0, -1) : token;
    const value = record[field];
    if (value === undefined) {
      if (!optional) violations.push(`${path}: missing field ${JSON.stringify(field)}`);
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
  for (const field of Object.keys(record)) {
    if (!(field in spec)) {
      violations.push(`${path}: unexpected field ${JSON.stringify(field)} that the pinned export shape does not declare`);
    }
  }
  return violations;
}

// The shipped export contract, pinned field by field. A rename, a drop, or a
// retype in src/shiplog-export.js (or in the records it echoes) fails here with
// the field named.
export const SHIPLOG_EXPORT_SHAPE = Object.freeze({
  envelope: {
    schema: "string",
    version: "number",
    generatedAt: "string",
    decisions: "array",
    releases: "array",
  },
  decisions: {
    id: "string",
    title: "string",
    context: "string",
    alternatives: "string",
    owner: "string",
    status: "string",
    createdAt: "string",
    supersedes: "string?",
    // Present only on a decision recorded from an approved FinOps commitment.
    // Its own fields are pinned by finops-commitment-decision.test.js, which
    // owns the block; here it is pinned as optional so the exporter carrying it
    // is a declared part of the shape rather than undetected drift.
    finopsCommitment: "object?",
  },
  releases: {
    id: "string",
    version: "string",
    title: "string",
    description: "string",
    owner: "string",
    status: "string",
    createdAt: "string",
    decisionIds: "string[]",
  },
});

export function shapeViolations(payload, shape = SHIPLOG_EXPORT_SHAPE) {
  const violations = fieldViolations("export", payload, shape.envelope);
  for (const kind of ["decisions", "releases"]) {
    if (!Array.isArray(payload?.[kind])) continue;
    payload[kind].forEach((record, index) => {
      violations.push(...fieldViolations(`export.${kind}[${index}]`, record, shape[kind]));
    });
  }
  return violations;
}

// --- reporting -------------------------------------------------------------

export function describeViolations(headline, violations) {
  return [headline, ...violations.map((violation) => `  - ${violation}`)].join("\n");
}
