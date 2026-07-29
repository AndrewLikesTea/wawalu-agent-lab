// The shipped export contract, checked on its own terms.
//
// tests/shiplog-export.test.js proves the exporter produces files this module
// accepts; these tests prove the module is worth trusting — that it rejects the
// files it should, and names what is wrong with each one.

import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_DECISION_FIELDS,
  EXPORT_RELEASE_FIELDS,
  SHIPLOG_EXPORT_SCHEMA,
  SHIPLOG_EXPORT_VERSION,
  canonicalExportOrder,
  compareExportRecords,
  normalizeExportRecord,
  orderingViolations,
  shiplogExportViolations,
  undeclaredExportFields,
} from "../src/shiplog-export-schema.js";

const decision = {
  id: "d-1", title: "Adopt a queue", context: "Jobs were lost",
  alternatives: "Polling", owner: "Rowan", status: "accepted",
  createdAt: "2026-03-01T09:00:00.000Z",
};
const release = {
  id: "r-1", version: "v1.0.0", createdAt: "2026-03-02T09:00:00.000Z",
  decisionIds: ["d-1"],
};

const file = (overrides = {}) => ({
  schema: SHIPLOG_EXPORT_SCHEMA,
  version: SHIPLOG_EXPORT_VERSION,
  generatedAt: "2026-03-03T09:00:00.000Z",
  decisions: [decision],
  releases: [release],
  ...overrides,
});

test("a well-formed file has no violations", () => {
  assert.deepEqual(shiplogExportViolations(file()), []);
  assert.deepEqual(shiplogExportViolations(file({ decisions: [], releases: [] })), []);
});

test("a broken envelope is reported field by field", () => {
  const broken = file({ version: "1", generatedAt: "someday" });
  delete broken.schema;
  delete broken.releases;

  const violations = shiplogExportViolations(broken);
  for (const expected of [
    'export: missing required field "schema"',
    'export: missing required field "releases"',
    "export.version: expected number, got string",
    'export.generatedAt: expected an ISO date, got "someday"',
  ]) {
    assert.ok(violations.includes(expected), `missing "${expected}": ${violations.join(" | ")}`);
  }
});

test("a foreign schema or version is named rather than silently accepted", () => {
  assert.ok(shiplogExportViolations(file({ schema: "some-other-tool" }))
    .some((violation) => violation.startsWith("export.schema:")));
  assert.ok(shiplogExportViolations(file({ version: 99 }))
    .some((violation) => violation.startsWith("export.version:")));
});

test("record-level type errors and undeclared fields are reported with their path", () => {
  const violations = shiplogExportViolations(file({
    decisions: [{ ...decision, status: 3, sessionCookie: "sid=1" }],
    releases: [{ ...release, decisionIds: ["d-1", 7] }],
  }));

  for (const expected of [
    "export.decisions[0].status: expected string, got number",
    'export.decisions[0]: undeclared field "sessionCookie"',
    "export.releases[0].decisionIds[1]: expected string, got number",
  ]) {
    assert.ok(violations.includes(expected), `missing "${expected}": ${violations.join(" | ")}`);
  }
});

test("a missing required record field is reported, and an optional one is not", () => {
  const withoutOwner = { ...decision };
  delete withoutOwner.owner;
  const withoutAlternatives = { ...decision };
  delete withoutAlternatives.alternatives;

  assert.ok(shiplogExportViolations(file({ decisions: [withoutOwner], releases: [] }))
    .includes('export.decisions[0]: missing required field "owner"'));
  assert.deepEqual(shiplogExportViolations(file({ decisions: [withoutAlternatives] })), []);
});

test("the same id twice in one collection is reported", () => {
  const violations = shiplogExportViolations(file({ decisions: [decision, { ...decision }] }));
  assert.ok(violations.includes('export.decisions: id "d-1" appears 2 times, expected exactly once'));
});

test("normalization keeps declared fields in declaration order and drops the rest", () => {
  const normalized = normalizeExportRecord({
    createdAt: decision.createdAt,
    sessionCookie: "sid=1",
    title: decision.title,
    id: decision.id,
    context: decision.context,
    owner: decision.owner,
    status: decision.status,
  }, EXPORT_DECISION_FIELDS);

  assert.deepEqual(Object.keys(normalized), ["id", "title", "context", "owner", "status", "createdAt"]);
  assert.deepEqual(undeclaredExportFields({ id: "r-1", authToken: "t" }, EXPORT_RELEASE_FIELDS), ["authToken"]);
});

test("normalization deep-copies, so a later write to the store cannot reach the file", () => {
  const stored = { ...decision, finopsCommitment: { commitmentId: "c-1" } };
  const normalized = normalizeExportRecord(stored, EXPORT_DECISION_FIELDS);
  stored.finopsCommitment.commitmentId = "c-2";

  assert.equal(normalized.finopsCommitment.commitmentId, "c-1");
});

test("canonical order is total: oldest first, ties by id, undated last", () => {
  const at = (id, createdAt) => ({ id, createdAt });
  const records = [
    at("b", "2026-03-02T09:00:00.000Z"),
    at("z", undefined),
    at("a", "2026-03-02T09:00:00.000Z"),
    at("c", "2026-03-01T09:00:00.000Z"),
    at("y", "not a date"),
  ];
  const ordered = canonicalExportOrder(records);

  assert.deepEqual(ordered.map(({ id }) => id), ["c", "a", "b", "y", "z"]);
  assert.deepEqual(records.map(({ id }) => id), ["b", "z", "a", "c", "y"], "the input is not mutated");
  // Sorting an already-sorted collection is a no-op, which is what makes
  // export -> import -> export a fixed point rather than a slow shuffle.
  assert.deepEqual(canonicalExportOrder(ordered).map(({ id }) => id), ordered.map(({ id }) => id));
  assert.deepEqual(canonicalExportOrder(undefined), []);

  // Antisymmetry, so the comparator cannot depend on the order it is handed.
  assert.equal(compareExportRecords(records[0], records[2]), 1);
  assert.equal(compareExportRecords(records[2], records[0]), -1);
  assert.equal(compareExportRecords(records[0], { ...records[0] }), 0);
});

test("a reordered file is named as out of canonical order", () => {
  const older = { ...decision, id: "d-0", createdAt: "2026-02-01T09:00:00.000Z" };
  const payload = file({ decisions: [decision, older], releases: [release] });

  assert.deepEqual(orderingViolations(payload), [
    'export.decisions[1]: "d-0" is out of canonical order (oldest createdAt first, ties by id)',
  ]);
  assert.ok(shiplogExportViolations(payload).includes(orderingViolations(payload)[0]),
    "the whole-contract check carries the ordering rule");
  assert.deepEqual(orderingViolations(file({ decisions: [older, decision] })), [],
    "the same two records in canonical order pass");
  assert.deepEqual(orderingViolations({}), [], "a payload with no collections has no order to violate");
});

test("a non-object is refused rather than treated as an empty export", () => {
  assert.ok(shiplogExportViolations(null).includes("export: expected an object, got null"));
  assert.ok(shiplogExportViolations("{}").includes("export: expected an object, got string"));
  assert.deepEqual(normalizeExportRecord(null, EXPORT_DECISION_FIELDS), {});
});
