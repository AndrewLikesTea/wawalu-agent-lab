// The shipped export contract, checked on its own terms.
//
// tests/shiplog-export.test.js proves the exporter produces files this module
// accepts; these tests prove the module is worth trusting — that it rejects the
// files it should, and names what is wrong with each one.

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HISTORY_FILTERS } from "../src/history-filters.js";
import {
  EXPORT_DECISION_FIELDS,
  EXPORT_FILTER_FIELDS,
  EXPORT_RELEASE_FIELDS,
  SHIPLOG_EXPORT_SCHEMA,
  SHIPLOG_EXPORT_VERSION,
  canonicalExportOrder,
  associationViolations,
  compareExportRecords,
  filterBlockViolations,
  normalizeExportRecord,
  orderingViolations,
  recordCountViolations,
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

test("associations are held to being the flattened view of releases[].decisionIds", () => {
  const associated = file({
    associations: [{ decisionId: "d-1", releaseId: "r-1", position: 0 }],
  });
  assert.deepEqual(associationViolations(associated), []);
  // A link the release names but the join omits is named, not summarised.
  assert.deepEqual(associationViolations(file({ associations: [] })), [
    'export.associations[0]: expected {"decisionId":"d-1","releaseId":"r-1","position":0}, got null',
  ]);
  // A row nothing in the file backs is a violation too, in the other direction.
  assert.deepEqual(associationViolations(file({
    associations: [
      { decisionId: "d-1", releaseId: "r-1", position: 0 },
      { decisionId: "d-1", releaseId: "r-9", position: 0 },
    ],
  })), ["export.associations: carries 2 links, but this file's releases name 1"]);
  assert.ok(associationViolations(file({ associations: [
    { decisionId: "d-1", releaseId: "r-1", position: "0" },
  ] })).some((violation) => violation.includes("position: expected number")));
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

// The exporter writes whatever dimensions the history view holds, so a filter
// added to the view and not to this schema produces a file that fails its own
// contract — and the visitor who set that filter is exactly the one who cannot
// export. Pinning the two key sets together turns that into a failure here,
// where it costs one line, instead of at the download.
test("every dimension the history can filter by is a dimension the file may name", () => {
  assert.deepEqual(
    Object.keys(EXPORT_FILTER_FIELDS).sort(),
    Object.keys(DEFAULT_HISTORY_FILTERS).sort(),
  );
});

test("the filter block declares its dimensions, and never states one that was off", () => {
  assert.deepEqual(shiplogExportViolations(file({ filter: {}, record_count: 2 })), [],
    "an empty block — the file saying no filter was active — is valid");
  assert.deepEqual(
    shiplogExportViolations(file({ filter: { status: "accepted", currentOnly: true }, record_count: 2 })),
    [],
  );
  assert.deepEqual(filterBlockViolations(file()), [], "a file with no block at all predates it and is valid");

  assert.deepEqual(filterBlockViolations({ filter: { owner: 7 } }),
    ["export.filter.owner: expected string, got number"]);
  assert.deepEqual(filterBlockViolations({ filter: { sort: "title" } }),
    ['export.filter: undeclared filter "sort"']);
  assert.deepEqual(filterBlockViolations({ filter: [] }),
    ["export.filter: expected an object, got array"]);
  // The rule that keeps `{}` the only way to say "nothing was filtered".
  assert.deepEqual(filterBlockViolations({ filter: { status: "all" } }), [
    'export.filter.status: "all" means this filter was not active; '
    + "an inactive filter is omitted from the block",
  ]);
  assert.deepEqual(filterBlockViolations({ filter: { query: "", currentOnly: false } }).length, 2);
});

test("record_count states the size of the file it is in, or it is a violation", () => {
  assert.deepEqual(recordCountViolations(file({ record_count: 2 })), []);
  assert.deepEqual(recordCountViolations(file({ decisions: [], releases: [], record_count: 0 })), [],
    "an empty file counting zero records is correct, not degenerate");
  assert.deepEqual(recordCountViolations(file()), [], "a file with no count predates it and is valid");
  assert.deepEqual(recordCountViolations(file({ record_count: 5 })),
    ["export.record_count: envelope claims 5 records, file contains 2"]);
  // The per-collection counts are checked on the same terms, and each names its
  // own collection: "2 records" would not tell a reader which array is short.
  assert.deepEqual(recordCountViolations(file({ decision_count: 7 })),
    ["export.decision_count: envelope claims 7 decisions, file contains 1"]);
  assert.deepEqual(recordCountViolations(file({ release_count: 0 })),
    ["export.release_count: envelope claims 0 releases, file contains 1"]);
  assert.deepEqual(recordCountViolations(file({ decision_count: 1, release_count: 1, record_count: 2 })), []);
  assert.deepEqual(recordCountViolations(file({ record_count: 1.5 })),
    ["export.record_count: expected an integer, got 1.5"]);
  assert.ok(shiplogExportViolations(file({ record_count: 5 })).some((violation) => violation.includes("record_count")),
    "the whole-contract check carries the record count rule");
});

test("a non-object is refused rather than treated as an empty export", () => {
  assert.ok(shiplogExportViolations(null).includes("export: expected an object, got null"));
  assert.ok(shiplogExportViolations("{}").includes("export: expected an object, got string"));
  assert.deepEqual(normalizeExportRecord(null, EXPORT_DECISION_FIELDS), {});
});
