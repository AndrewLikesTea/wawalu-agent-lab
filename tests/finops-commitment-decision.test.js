// An approved FinOps commitment becomes exactly one durable Shiplog decision,
// and that decision survives the local JSON export/import round trip with its
// money claim and its provenance summary intact.
//
// Every figure here is built in the test from one synthetic imported analysis:
// no committed fixture file, no clock, no network, no storage but the in-memory
// map below. Ids are prefixed `commitment-decision-` so a parallel `npm test`
// cannot collide with another suite's storage.

import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY, loadDecisions, saveDecisions } from "../src/app.js";
import {
  COMMITMENT_METADATA_FIELD,
  COMMITMENT_METADATA_SCHEMA,
  CommitmentDecisionError,
  buildCommitmentDecision,
  commitmentDecisionId,
  commitmentMetadataErrors,
  findCommitmentDecision,
  recordCommitmentDecision,
} from "../src/finops-commitment-decision.js";
import { buildSavingsCommitment } from "../src/savings-commitment.js";
import { createShiplogExport } from "../src/shiplog-export.js";
import {
  commitShiplogImport,
  parseImport,
  prepareShiplogImport,
} from "../src/shiplog-import.js";

const APPROVED_AT = "2026-05-04T09:30:00.000Z";
const IMPORTED_AT = "2026-05-01T06:00:00.000Z";
const APPROVER = "Dana Okafor";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    data: values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

// One imported analysis with two candidates: the second saves less, so the
// contract's ranking picks the first and the decision under test is stable.
function analysis(overrides = {}) {
  return {
    schemaVersion: "savings-commitment-input/1.0.0",
    source: {
      sourceId: "commitment-decision-source",
      importedAt: IMPORTED_AT,
      analysisPeriod: "2026-05",
      designation: "imported",
      currency: "USD",
      unit: "usd_minor",
      recordIds: ["record-a", "record-b", "record-c"],
      ...overrides.source,
    },
    candidates: overrides.candidates ?? [
      candidate({
        candidateId: "route-support-summaries",
        workloadId: "support-summaries",
        baselineMinor: 1_200_000,
        projectedMinor: 718_000,
        percent: 78,
        recordIds: ["record-a", "record-b"],
      }),
      candidate({
        candidateId: "route-invoice-extraction",
        workloadId: "invoice-extraction",
        baselineMinor: 400_000,
        projectedMinor: 380_000,
        percent: 55,
        recordIds: ["record-c"],
      }),
    ],
  };
}

function candidate({ candidateId, workloadId, baselineMinor, projectedMinor, percent, recordIds }) {
  return {
    candidateId,
    workloadScope: {
      workloadId,
      description: `the ${workloadId} workload`,
      period: "2026-05",
    },
    department: { departmentId: "customer-support", name: "Customer Support" },
    accountableOwner: { role: "Director of Support Engineering" },
    recordIds,
    routing: {
      currentRoute: { modelId: "frontier-large" },
      proposedRoute: { modelId: "efficient-small" },
      workloadId,
      rationale: "The measured output length fits the smaller model's published envelope.",
      evidence: [{ recordId: recordIds[0], statement: "Sampled calls stayed inside the envelope." }],
    },
    baseline: { monthlyCostMinor: baselineMinor, workloadId, period: "2026-05" },
    projected: { monthlyCostMinor: projectedMinor, workloadId, period: "2026-05" },
    confidence: { percent, basis: "Measured across a full month of provider records." },
  };
}

function approval(overrides = {}) {
  return {
    preview: buildSavingsCommitment(analysis()),
    approvedBy: APPROVER,
    approvedAt: APPROVED_AT,
    ...overrides,
  };
}

const EXPECTED_METADATA = Object.freeze({
  schemaVersion: COMMITMENT_METADATA_SCHEMA,
  commitmentId: "route-support-summaries",
  claim: {
    baselineMonthlyCostMinor: 1_200_000,
    projectedMonthlyCostMinor: 718_000,
    monthlySavingsMinor: 482_000,
    currency: "USD",
    unit: "usd_minor",
    period: "2026-05",
  },
  confidence: { percent: 78, band: "high" },
  provenance: {
    sourceId: "commitment-decision-source",
    designation: "imported",
    importedAt: IMPORTED_AT,
    analysisPeriod: "2026-05",
    recordIds: ["record-a", "record-b"],
    recordCount: 2,
  },
  recommendedAction: {
    workloadId: "support-summaries",
    departmentId: "customer-support",
    fromModelId: "frontier-large",
    toModelId: "efficient-small",
  },
});

// --- creation ---------------------------------------------------------------

test("an approved commitment becomes one decision carrying only the declared metadata", () => {
  const decision = buildCommitmentDecision(approval());

  assert.deepEqual(decision, {
    id: "finops-commitment-route-support-summaries",
    title: "Route support-summaries to efficient-small",
    context:
      "Approved FinOps commitment route-support-summaries: route support-summaries for "
      + "customer-support from frontier-large to efficient-small. "
      + "The imported analysis projects $4,820.00 a month against a $12,000.00 2026-05 baseline, "
      + "at 78% confidence (high). "
      + `Provenance: source commitment-decision-source (imported), imported ${IMPORTED_AT}, 2 records.`,
    alternatives: "Keep routing support-summaries on frontier-large.",
    owner: APPROVER,
    status: "accepted",
    createdAt: APPROVED_AT,
    [COMMITMENT_METADATA_FIELD]: { ...EXPECTED_METADATA },
  });
  // The whole allow-list, asserted as a whole: no rationale, no evidence
  // statement, no candidate list, and no row of the import came along.
  assert.deepEqual(decision[COMMITMENT_METADATA_FIELD], EXPECTED_METADATA);
  assert.deepEqual(commitmentMetadataErrors(decision[COMMITMENT_METADATA_FIELD]), []);
});

test("recording an approved commitment writes a durable decision the store reads back", () => {
  const storage = memoryStorage();
  const result = recordCommitmentDecision(storage, approval());

  assert.equal(result.created, true);
  assert.equal(result.reason, null);
  const stored = loadDecisions(storage);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0], result.decision);
  assert.deepEqual(stored[0][COMMITMENT_METADATA_FIELD], EXPECTED_METADATA);
});

test("an approved commitment joins the existing log instead of replacing it", () => {
  const existing = {
    id: "commitment-decision-existing",
    title: "Adopt the queue",
    context: "We need retries.",
    alternatives: "",
    owner: "Kai",
    status: "accepted",
    createdAt: "2026-04-01T00:00:00.000Z",
  };
  const storage = memoryStorage();
  saveDecisions(storage, [existing]);

  recordCommitmentDecision(storage, approval());

  const stored = loadDecisions(storage);
  assert.deepEqual(stored.map((decision) => decision.id),
    ["finops-commitment-route-support-summaries", "commitment-decision-existing"]);
  assert.deepEqual(stored[1], existing, "the decision that was already recorded is unchanged");
});

test("a preview that proposes nothing is refused rather than recorded as an empty commitment", () => {
  const nothing = buildSavingsCommitment(analysis({
    candidates: [candidate({
      candidateId: "route-invoice-extraction",
      workloadId: "invoice-extraction",
      baselineMinor: 400_000,
      projectedMinor: 400_000,
      percent: 60,
      recordIds: ["record-c"],
    })],
  }));
  assert.equal(nothing.status, "no_commitment");

  const storage = memoryStorage();
  assert.throws(
    () => recordCommitmentDecision(storage, approval({ preview: nothing })),
    (error) => error instanceof CommitmentDecisionError && error.code === "NO_COMMITMENT",
  );
  assert.equal(storage.getItem(STORAGE_KEY), null, "a refused approval writes nothing");
});

test("an approval states its approver and its own instant; this module reads no clock", () => {
  const storage = memoryStorage();
  for (const [override, code] of [
    [{ approvedBy: "   " }, "INVALID_APPROVER"],
    [{ approvedBy: "x".repeat(81) }, "INVALID_APPROVER"],
    [{ approvedAt: "2026-05-04" }, "INVALID_APPROVED_AT"],
    [{ approvedAt: undefined }, "INVALID_APPROVED_AT"],
    [{ preview: null }, "INVALID_COMMITMENT"],
  ]) {
    assert.throws(
      () => recordCommitmentDecision(storage, approval(override)),
      (error) => error instanceof CommitmentDecisionError && error.code === code,
      JSON.stringify(override),
    );
  }
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

// --- duplicate prevention ---------------------------------------------------

test("a commitment creates at most one decision, however many times it is approved", () => {
  const storage = memoryStorage();
  const first = recordCommitmentDecision(storage, approval());
  const before = storage.getItem(STORAGE_KEY);

  const second = recordCommitmentDecision(storage, {
    ...approval(),
    approvedBy: "Someone Else",
    approvedAt: "2026-06-01T12:00:00.000Z",
  });

  assert.equal(second.created, false);
  assert.equal(second.reason, "already_linked");
  assert.deepEqual(second.decision, first.decision, "the decision that already exists is returned");
  assert.equal(storage.getItem(STORAGE_KEY), before, "the second approval wrote nothing");
  assert.equal(loadDecisions(storage).length, 1);
});

test("the link is found by commitment id even when the decision carries another id", () => {
  const storage = memoryStorage();
  const renamed = buildCommitmentDecision(approval({ id: "commitment-decision-hand-written" }));
  saveDecisions(storage, [renamed]);

  assert.deepEqual(findCommitmentDecision([renamed], "route-support-summaries"), renamed);
  const result = recordCommitmentDecision(storage, approval());
  assert.equal(result.created, false);
  assert.equal(loadDecisions(storage).length, 1);
  assert.equal(loadDecisions(storage)[0].id, "commitment-decision-hand-written");
});

test("the decision id is derived from the commitment id, so two browsers agree on it", () => {
  assert.equal(commitmentDecisionId("route-support-summaries"),
    "finops-commitment-route-support-summaries");
  assert.equal(findCommitmentDecision([], "route-support-summaries"), null);
});

// --- export / import round trip ---------------------------------------------

function exportText(storage) {
  return JSON.stringify(createShiplogExport(storage, { generatedAt: "2026-05-04T10:00:00.000Z" }));
}

test("the export/import round trip preserves the money claim and the provenance summary", () => {
  const source = memoryStorage();
  const { decision } = recordCommitmentDecision(source, approval());

  const text = exportText(source);
  assert.deepEqual(JSON.parse(text).decisions[0][COMMITMENT_METADATA_FIELD], EXPECTED_METADATA);

  const target = memoryStorage();
  const plan = prepareShiplogImport(target, text);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.parsed.droppedCommitments, []);
  assert.equal(plan.merged.summary.newDecisions, 1);
  commitShiplogImport(target, plan);

  const restored = loadDecisions(target);
  assert.deepEqual(restored, [decision], "the restored decision is the recorded one, field for field");
  assert.deepEqual(restored[0][COMMITMENT_METADATA_FIELD].claim, EXPECTED_METADATA.claim);
  assert.deepEqual(restored[0][COMMITMENT_METADATA_FIELD].provenance, EXPECTED_METADATA.provenance);

  // Exporting the restored browser reproduces the same bytes for the record.
  assert.deepEqual(JSON.parse(exportText(target)).decisions, JSON.parse(text).decisions);
});

test("re-importing an export into the browser that wrote it links the commitment once", () => {
  const storage = memoryStorage();
  recordCommitmentDecision(storage, approval());
  const text = exportText(storage);

  const plan = prepareShiplogImport(storage, text);
  assert.deepEqual(plan.parsed.droppedCommitments, [],
    "the same decision arriving again is not a second link");
  assert.equal(plan.merged.summary.newDecisions, 0);
  assert.equal(plan.merged.summary.duplicateDecisions, 1);
  commitShiplogImport(storage, plan);

  const stored = loadDecisions(storage);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0][COMMITMENT_METADATA_FIELD], EXPECTED_METADATA);
});

test("an older export whose decisions carry no commitment metadata still imports", () => {
  const older = {
    schema: "shiplog-history",
    version: 1,
    generatedAt: "2026-01-02T00:00:00.000Z",
    decisions: [{
      id: "commitment-decision-older",
      title: "Adopt the queue",
      context: "We need retries.",
      alternatives: "",
      owner: "Kai",
      status: "accepted",
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
    releases: [],
  };

  const parsed = parseImport(JSON.stringify(older));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.rejected, []);
  assert.deepEqual(parsed.droppedCommitments, []);
  assert.deepEqual(parsed.decisions, older.decisions);

  const target = memoryStorage();
  commitShiplogImport(target, prepareShiplogImport(target, JSON.stringify(older)));
  assert.deepEqual(loadDecisions(target), older.decisions);
});

test("an unreadable commitment block is dropped and reported; its decision is kept", () => {
  const storage = memoryStorage();
  const { decision } = recordCommitmentDecision(storage, approval());
  const payload = JSON.parse(exportText(storage));
  // A hand-edited saving that no longer follows from its own baseline. The
  // block cannot be trusted; the decision itself is still the visitor's record.
  payload.decisions[0][COMMITMENT_METADATA_FIELD].claim.monthlySavingsMinor = 999_999;

  const parsed = parseImport(JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.decisions.length, 1);
  assert.equal(COMMITMENT_METADATA_FIELD in parsed.decisions[0], false);
  assert.deepEqual(
    { ...parsed.decisions[0] },
    Object.fromEntries(Object.entries(decision).filter(([key]) => key !== COMMITMENT_METADATA_FIELD)),
  );
  assert.equal(parsed.droppedCommitments.length, 1);
  assert.equal(parsed.droppedCommitments[0].commitmentId, "route-support-summaries");
  assert.match(parsed.droppedCommitments[0].message, /monthlySavingsMinor: expected max\(0, baseline - projected\)/);
});

test("a file cannot restore a second decision for a commitment this browser already linked", () => {
  const storage = memoryStorage();
  recordCommitmentDecision(storage, approval());

  const other = buildCommitmentDecision(approval({ id: "commitment-decision-elsewhere" }));
  const text = JSON.stringify({
    schema: "shiplog-history",
    version: 1,
    generatedAt: "2026-05-05T00:00:00.000Z",
    decisions: [other],
    releases: [],
  });

  const plan = prepareShiplogImport(storage, text);
  assert.equal(plan.parsed.droppedCommitments.length, 1);
  assert.match(plan.parsed.droppedCommitments[0].message, /already linked to decision/);
  commitShiplogImport(storage, plan);

  const stored = loadDecisions(storage);
  const linked = stored.filter((entry) => entry[COMMITMENT_METADATA_FIELD]);
  assert.equal(linked.length, 1, "the commitment still links to exactly one decision");
  assert.equal(linked[0].id, "finops-commitment-route-support-summaries");
  assert.equal(stored.length, 2, "the imported decision itself is kept, without the link");
});

// --- the block's own rules --------------------------------------------------

test("the metadata validator names what is wrong with a block", () => {
  const base = structuredClone(EXPECTED_METADATA);
  const cases = [
    [{ ...base, schemaVersion: "shiplog-finops-commitment/9" }, /schemaVersion/],
    [{ ...base, commitmentId: "Route Support" }, /commitmentId/],
    [{ ...base, confidence: { percent: 78, band: "low" } }, /band: expected high/],
    [{ ...base, claim: { ...base.claim, period: "2026-13" } }, /claim\.period/],
    [{ ...base, provenance: { ...base.provenance, recordCount: 5 } }, /recordCount: expected 2/],
    [{ ...base, recommendedAction: { ...base.recommendedAction, toModelId: "frontier-large" } },
      /differs from fromModelId/],
    [{ ...base, rawImportRows: [] }, /rawImportRows: unknown field/],
    ["not an object", /expected an object/],
  ];
  for (const [metadata, pattern] of cases) {
    const errors = commitmentMetadataErrors(metadata);
    assert.ok(errors.length > 0, JSON.stringify(metadata));
    assert.match(errors.join("; "), pattern);
  }
  assert.deepEqual(commitmentMetadataErrors(base), []);
});
