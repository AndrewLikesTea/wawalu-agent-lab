// The reconciliation rubric, and the drift check that defends it.
//
// Four things are pinned here:
//
//   1. THE LABELLED CASES. One fixture per required status, each with its
//      expected status, verdict, and amounts written down. A change that moves a
//      status fails immediately; a change that moves an amount by a dollar or
//      more fails as a material drift even where the status survives.
//   2. THE MATCH RULE. A decision is settled by the stable commitment
//      identifier and by nothing else — not by department name, not by month
//      proximity, and never by which file happened to be read last.
//   3. THE PERSISTED SHAPE. The block is closed both ways, holds only derived
//      values, and carries no file name, no briefing text, and no raw row.
//   4. REPRODUCIBILITY. The same inputs in a different order produce an equal
//      model, and a second pass over an already-reconciled log writes nothing.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DECISION_RECONCILIATION_VERSION,
  MATERIAL_AMOUNT_MINOR,
  RECONCILIATION_METADATA_FIELD,
  RECONCILIATION_REASON,
  RECONCILIATION_STATUS,
  RECONCILIATION_STATUS_CUE,
  RECONCILIATION_STATUS_FROM_OUTCOME,
  observationsByCommitment,
  persistReconciliations,
  reconcileImportedAnalysis,
  reconciliationErrors,
} from "../src/decision-reconciliation.js";
import { OUTCOME_STATUS } from "../src/decision-outcome.js";
import { COMMITMENT_METADATA_FIELD } from "../src/finops-commitment-decision.js";
import { STORAGE_KEY } from "../src/app.js";
import { RETENTION, setRetention } from "../src/local-retention.js";
import {
  HALF_TRAFFIC,
  LIGHT_MIGRATION,
  OTHER_UNIT,
  RECONCILED_AT,
  labelledCases,
  openedMonth,
  recordedDecision,
  shippedRelease,
} from "./fixtures/decision-reconciliation/labelled-cases.js";

const CASES = labelledCases();

function reconcileCase(fixture, overrides = {}) {
  return reconcileImportedAnalysis({
    decisions: fixture.decisions,
    releases: fixture.releases,
    entries: fixture.entries,
    reconciledAt: RECONCILED_AT,
    ...overrides,
  });
}

/* ------------------------------ labelled cases ----------------------------- */

test("every required status has a labelled fixture that produces it", () => {
  const produced = new Set(CASES.map((fixture) => reconcileCase(fixture).rows[0].status));
  assert.deepEqual([...produced].sort(), [...Object.values(RECONCILIATION_STATUS)].sort(),
    "every required status must have at least one labelled case that produces it");
  // And every case's label names the status it claims, so a fixture cannot drift
  // into asserting something its own name denies.
  for (const fixture of CASES) {
    assert.ok(fixture.label.startsWith(fixture.expected.status),
      `${fixture.label} does not name the status it expects`);
  }
});

for (const fixture of CASES) {
  test(`labelled case: ${fixture.label}`, () => {
    const model = reconcileCase(fixture);
    assert.equal(model.rows.length, 1);
    const [row] = model.rows;
    const { expected } = fixture;

    assert.equal(row.status, expected.status, fixture.label);
    assert.equal(row.record.verdict, expected.verdict);
    assert.equal(row.record.reason, expected.reason);
    assert.equal(row.observedMonth, expected.observedMonth);
    assert.equal(row.record.confidence.level, expected.confidence);

    // The amounts, exactly. A case that must produce no figure produces null
    // rather than zero: zero means "landed on plan", which is the single most
    // expensive thing this rubric could say by accident.
    for (const [key, value] of Object.entries(expected.amounts)) {
      assert.equal(row.record[key], value, `${fixture.label}: ${key}`);
    }

    // Every state carries a sentence and a non-colour cue. A row that says
    // nothing is a row a leader cannot act on.
    assert.ok(row.statement && row.statement.length > 20, "each row states its own reason");
    assert.deepEqual(row.cue, RECONCILIATION_STATUS_CUE[expected.status]);
    assert.equal(row.commitmentId, fixture.decisions[0][COMMITMENT_METADATA_FIELD].commitmentId);
  });
}

test("the drift check fails on a material change to a labelled amount", () => {
  // The guard itself, exercised: the same fixture re-scored with one amount
  // moved by exactly the materiality threshold must be caught. Without this the
  // threshold is a number nobody has ever seen do its job.
  for (const fixture of CASES) {
    const [row] = reconcileCase(fixture).rows;
    for (const [key, value] of Object.entries(fixture.expected.amounts)) {
      if (value === null) {
        assert.equal(row.record[key], null, `${fixture.label}: ${key} must stay absent`);
        continue;
      }
      const drifted = value + MATERIAL_AMOUNT_MINOR;
      assert.ok(Math.abs(row.record[key] - drifted) >= MATERIAL_AMOUNT_MINOR,
        `${fixture.label}: a ${MATERIAL_AMOUNT_MINOR}-minor move in ${key} must read as material`);
      assert.ok(Math.abs(row.record[key] - value) < MATERIAL_AMOUNT_MINOR,
        `${fixture.label}: ${key} drifted materially from its labelled value`);
    }
  }
});

test("the status projection is total over the outcome model's states", () => {
  for (const status of Object.values(OUTCOME_STATUS)) {
    assert.ok(RECONCILIATION_STATUS_FROM_OUTCOME[status],
      `${status} has no projection, so it would render as the wrong kind of row`);
  }
  assert.deepEqual([...new Set(Object.values(RECONCILIATION_STATUS_FROM_OUTCOME))].sort(),
    [...Object.values(RECONCILIATION_STATUS)].sort());
});

/* -------------------------------- the match -------------------------------- */

test("a month is matched by the stable commitment identifier, not by the file order", () => {
  const decision = recordedDecision();
  const releases = [shippedRelease(decision)];
  const paired = openedMonth("2026-07", { rows: HALF_TRAFFIC() });
  const other = openedMonth("2026-07", { rows: OTHER_UNIT() });

  const forward = reconcileImportedAnalysis({
    decisions: [decision], releases, entries: [other, paired], reconciledAt: RECONCILED_AT,
  });
  const reversed = reconcileImportedAnalysis({
    decisions: [decision], releases, entries: [paired, other], reconciledAt: RECONCILED_AT,
  });
  assert.equal(forward.rows[0].status, RECONCILIATION_STATUS.verified);
  assert.deepEqual(forward.rows[0].record, reversed.rows[0].record);
});

test("the month after the baseline is used even when a later month is also open", () => {
  const decision = recordedDecision();
  const releases = [shippedRelease(decision)];
  const july = openedMonth("2026-07", { rows: HALF_TRAFFIC() });
  const august = openedMonth("2026-08", { rows: LIGHT_MIGRATION() });
  const model = reconcileImportedAnalysis({
    decisions: [decision], releases, entries: [august, july], reconciledAt: RECONCILED_AT,
  });
  assert.equal(model.rows[0].observedMonth, "2026-07");
  assert.equal(model.rows[0].status, RECONCILIATION_STATUS.verified);
  assert.deepEqual([...model.openedMonths], ["2026-07", "2026-08"]);
});

test("a month that is not the one after the baseline is unmatched, not scored", () => {
  const decision = recordedDecision();
  const model = reconcileImportedAnalysis({
    decisions: [decision],
    releases: [shippedRelease(decision)],
    entries: [openedMonth("2026-09", { rows: HALF_TRAFFIC() })],
    reconciledAt: RECONCILED_AT,
  });
  const [row] = model.rows;
  assert.equal(row.status, RECONCILIATION_STATUS.unmatchedCommitment);
  assert.equal(row.record.observedMonthlySavingsMinor, null);
});

test("two conflicting copies of one month settle as no comparable data", () => {
  const decision = recordedDecision();
  const model = reconcileImportedAnalysis({
    decisions: [decision],
    releases: [shippedRelease(decision)],
    entries: [
      openedMonth("2026-07", { rows: HALF_TRAFFIC() }),
      openedMonth("2026-07", { rows: LIGHT_MIGRATION() }),
    ],
    reconciledAt: RECONCILED_AT,
  });
  const [row] = model.rows;
  assert.equal(row.status, RECONCILIATION_STATUS.noComparableData);
  assert.equal(row.reason, RECONCILIATION_REASON.ambiguousCommitmentMatch);
  assert.equal(row.record.observedMonthlySavingsMinor, null);
});

test("two agreeing copies of one month are one observation", () => {
  const decision = recordedDecision();
  const model = reconcileImportedAnalysis({
    decisions: [decision],
    releases: [shippedRelease(decision)],
    entries: [
      openedMonth("2026-07", { rows: HALF_TRAFFIC() }),
      openedMonth("2026-07", { rows: HALF_TRAFFIC() }),
    ],
    reconciledAt: RECONCILED_AT,
  });
  assert.equal(model.rows[0].status, RECONCILIATION_STATUS.verified);
});

test("with nothing open, a commitment has no comparable data rather than an unmatched one", () => {
  const decision = recordedDecision();
  const model = reconcileImportedAnalysis({
    decisions: [decision], releases: [shippedRelease(decision)], entries: [],
    reconciledAt: RECONCILED_AT,
  });
  assert.equal(model.rows[0].status, RECONCILIATION_STATUS.noComparableData);
  assert.deepEqual([...model.openedMonths], []);
});

test("a decision carrying no commitment block is not reconciled at all", () => {
  const model = reconcileImportedAnalysis({
    decisions: [{
      id: "hand-typed", title: "Adopt trunk-based development", context: "Because.",
      owner: "Ada", status: "accepted", createdAt: "2026-05-01T00:00:00.000Z",
    }],
    releases: [],
    entries: [openedMonth("2026-07", { rows: HALF_TRAFFIC() })],
    reconciledAt: RECONCILED_AT,
  });
  assert.deepEqual([...model.rows], []);
  assert.equal(model.counts[RECONCILIATION_STATUS.verified], 0);
});

test("grouping drops a month with no readable commitment block rather than counting it", () => {
  const grouped = observationsByCommitment([
    { month: "2026-07", commitment: { status: "unavailable" } },
    { month: "not-a-month", commitment: null },
    null,
  ]);
  assert.equal(grouped.size, 0);
});

/* ------------------------------- persistence ------------------------------- */

function storageWith(decisions) {
  const items = new Map([[STORAGE_KEY, JSON.stringify(decisions)]]);
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

test("only the derived block is persisted, and it satisfies its own contract", () => {
  const fixture = CASES[0];
  const model = reconcileCase(fixture);
  const storage = storageWith(fixture.decisions);

  const result = persistReconciliations(storage, model);
  assert.deepEqual(result, { written: 1, unchanged: 0, invalid: [], blocked: null });

  const [stored] = JSON.parse(storage.getItem(STORAGE_KEY));
  const block = stored[RECONCILIATION_METADATA_FIELD];
  assert.deepEqual(reconciliationErrors(block), []);
  assert.equal(block.schemaVersion, DECISION_RECONCILIATION_VERSION);
  assert.equal(block.status, RECONCILIATION_STATUS.verified);
  assert.equal(block.reconciledAt, RECONCILED_AT);
  // The commitment block the decision already carried is untouched.
  assert.deepEqual(stored[COMMITMENT_METADATA_FIELD],
    fixture.decisions[0][COMMITMENT_METADATA_FIELD]);

  // Nothing that came out of a file survives: no file name, no briefing text,
  // no per-row figure, and no org-unit identifier beyond the ids the commitment
  // block already made durable.
  const serialized = JSON.stringify(block);
  for (const forbidden of ["briefing-", ".json", "schemaVersion\":\"finops-briefing",
    "modelUsage", "sourceRows", "Vendor-Large-2026"]) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} reached storage`);
  }
});

test("a second pass over an unchanged log writes nothing", () => {
  const fixture = CASES[1];
  const storage = storageWith(fixture.decisions);
  persistReconciliations(storage, reconcileCase(fixture));
  const after = storage.getItem(STORAGE_KEY);

  // A later pass states a later instant; the block is equal in everything else,
  // so nothing is rewritten and no log looks freshly touched.
  const second = persistReconciliations(storage,
    reconcileCase(fixture, { reconciledAt: "2026-09-01T00:00:00.000Z" }));
  assert.deepEqual(second, { written: 0, unchanged: 1, invalid: [], blocked: null });
  assert.equal(storage.getItem(STORAGE_KEY), after);
});

test("a changed outcome is rewritten", () => {
  const fixture = CASES[0];
  const storage = storageWith(fixture.decisions);
  persistReconciliations(storage, reconcileCase(fixture));

  const worse = reconcileImportedAnalysis({
    decisions: fixture.decisions,
    releases: fixture.releases,
    entries: [openedMonth("2026-07", { rows: LIGHT_MIGRATION() })],
    reconciledAt: RECONCILED_AT,
  });
  assert.equal(persistReconciliations(storage, worse).written, 1);
  const [stored] = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(stored[RECONCILIATION_METADATA_FIELD].status,
    RECONCILIATION_STATUS.underperforming);
});

test("a browser that refuses to retain reports the refusal and writes nothing", () => {
  const fixture = CASES[0];
  const storage = storageWith(fixture.decisions);
  setRetention(storage, RETENTION.declined, { now: new Date("2026-08-01T00:00:00.000Z") });
  const before = storage.getItem(STORAGE_KEY);

  const result = persistReconciliations(storage, reconcileCase(fixture));
  assert.equal(result.written, 0);
  assert.ok(result.blocked, "the refusal is reported rather than swallowed");
  assert.equal(storage.getItem(STORAGE_KEY), before);
});

test("the persisted block is closed in both directions", () => {
  const [row] = reconcileCase(CASES[0]).rows;
  assert.deepEqual(reconciliationErrors(row.record), []);

  const cases = [
    [{ ...row.record, surprise: "raw export row" }, /unknown field/],
    [{ ...row.record, schemaVersion: "other/9" }, /schemaVersion/],
    [{ ...row.record, status: "probably_fine" }, /status/],
    [{ ...row.record, varianceMinor: 1.5 }, /varianceMinor/],
    [{ ...row.record, reconciledAt: "yesterday" }, /reconciledAt/],
    [{ ...row.record, confidence: null }, /confidence/],
    [{ ...row.record, evidence: { baselineRecordCount: -1, observedRecordCount: 0, complete: true } },
      /baselineRecordCount/],
    [{ ...row.record, provenance: { sourceId: 7 } }, /provenance/],
    ["not an object", /expected an object/],
  ];
  for (const [block, expected] of cases) {
    const errors = reconciliationErrors(block);
    assert.ok(errors.length > 0, `${JSON.stringify(block).slice(0, 60)} was accepted`);
    assert.match(errors.join("; "), expected);
  }
});
