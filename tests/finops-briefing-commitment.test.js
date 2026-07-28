// The portable commitment a briefing file carries.
//
// The envelope fixtures below are built in-test from `analyzeModelRouting` —
// the same call the analysis makes — rather than committed as JSON, so a change
// to the routing rule's published shape fails here instead of leaving a stale
// file that agrees with nothing.

import assert from "node:assert/strict";
import test from "node:test";

import { analyzeModelRouting } from "../src/down-routing-candidates.js";
import {
  COMMITMENT_DERIVATION_VERSION,
  COMMITMENT_INPUT_FIELDS,
  COMMITMENT_STATUS,
  COMMITMENT_UNAVAILABLE_REASON,
  COMMITMENT_UNAVAILABLE_STATEMENT,
  IMPORTED_AT_BASIS,
  calendarMonth,
  commitmentInputFor,
  commitmentLines,
  deriveBriefingCommitment,
  readSavedCommitment,
} from "../src/finops-briefing-commitment.js";
import { buildBriefing, serializeBriefing } from "../src/finops-briefing-export.js";
import { parseSavedBriefing } from "../src/finops-briefing-restore.js";
import { SAVINGS_COMMITMENT_VERSION, validateImportedAnalysis } from "../src/savings-commitment.js";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

/**
 * One per-model usage row that the routing rule scores as a candidate:
 * 10,000,000 tokens at 3,000 minor per million observed (premium floor is
 * 2,000), 5,000 calls at 2,000 tokens each (the short-call ceiling), repriced at
 * the 1,500 standard reference. 300.00 USD becomes 150.00 USD.
 */
function usageRow(overrides = {}) {
  return {
    orgUnitId: "psn_example_unit_atlas0",
    model: "Vendor-Large-2026",
    provider: "openai",
    inputTokens: 6_000_000,
    outputTokens: 4_000_000,
    tokens: 10_000_000,
    requests: 5_000,
    spendMinor: 30_000,
    estimated: false,
    sourceRows: 12,
    ...overrides,
  };
}

function envelope({ modelUsage = [usageRow()], period = "2026-06-01 to 2026-07-01", ...rest } = {}) {
  const unitIds = [...new Set(modelUsage.map((row) => row.orgUnitId))];
  return {
    schemaVersion: "local-finops/1.0.0",
    generatedAt: "2026-07-02T09:15:00.000Z",
    period,
    spendUsd: 1_000,
    recoverableUsd: 150,
    // Named from the id, never from array position: a fixture whose labels move
    // with the input order cannot prove that the output does not.
    rankedDepartments: unitIds.map((id) => ({
      id,
      name: id === "psn_example_unit_atlas0" ? "Atlas Platform" : "Boreal Systems",
      spendUsd: 500,
      recoverableUsd: 150,
      records: 12,
      downRouting: { ruleVersion: "down-routing-candidate/1.0.0", recoverableUsd: 150 },
    })),
    modelRouting: analyzeModelRouting({ modelUsage, unitIds }),
    quality: { joinedRecords: 12, quarantinedRecords: 0, providerCompleteness: "complete" },
    action: "Pilot lower-cost routing for text-generation in Atlas Platform.",
    topDepartment: { id: unitIds[0], recoverableUsd: 150 },
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// The happy path.
// ---------------------------------------------------------------------------

test("an imported analysis yields one commitment carrying every stated field", () => {
  const block = deriveBriefingCommitment(envelope(), { dataset: "user" });

  assert.equal(block.status, COMMITMENT_STATUS.ok);
  assert.equal(block.reason, null);
  assert.equal(block.contractVersion, SAVINGS_COMMITMENT_VERSION);
  assert.equal(block.derivationVersion, COMMITMENT_DERIVATION_VERSION);
  assert.equal(block.designation, "imported");
  assert.equal(block.importedAtBasis, IMPORTED_AT_BASIS.generatedAt);

  const { commitment } = block;
  // The recommendation: one routing change, named on both sides.
  assert.equal(commitment.routing.currentRoute.modelId, "vendor-large-2026");
  assert.equal(commitment.routing.currentRoute.tier, "premium");
  assert.equal(commitment.routing.proposedRoute.modelId, "standard-tier-reference");
  // The department.
  assert.equal(commitment.department.departmentId, "psn-example-unit-atlas0");
  assert.equal(commitment.department.name, "Atlas Platform");
  assert.equal(commitment.accountableOwner.role, "Platform Engineering Lead");
  // The money, in integer minor units, and the baseline period it is against.
  assert.equal(commitment.baseline.monthlyCostMinor, 30_000);
  assert.equal(commitment.projected.monthlyCostMinor, 15_000);
  assert.equal(commitment.projectedMonthlySavings.amountMinor, 15_000);
  assert.equal(commitment.projectedMonthlySavings.amountUsd, 150);
  assert.equal(commitment.baseline.period, "2026-06");
  assert.equal(commitment.workloadScope.period, "2026-06");
  // The confidence, as a percent and the band derived from it.
  assert.equal(commitment.confidence.percent, 80);
  assert.equal(commitment.confidence.band, "high");
  // The provenance: the exact per-model usage rows the figure came from.
  assert.deepEqual(commitment.provenance.recordIds, ["usage-psn-example-unit-atlas0-vendor-large-2026"]);
  assert.equal(commitment.provenance.recordCount, 1);
  assert.equal(commitment.provenance.importedAt, "2026-07-02T09:15:00.000Z");
  assert.equal(commitment.provenance.designation, "imported");
});

test("the projected input satisfies the commitment contract's own input validator", () => {
  const derived = commitmentInputFor(envelope(), { designation: "imported" });
  assert.equal(derived.reason, undefined);
  assert.doesNotThrow(() => validateImportedAnalysis(derived.input));
});

test("the example dataset is stamped demo, never imported", () => {
  const block = deriveBriefingCommitment(envelope(), { dataset: "example" });
  assert.equal(block.designation, "demo");
  assert.equal(block.commitment.provenance.designation, "demo");
});

test("the largest monthly saving wins and the rest are excluded with a reason", () => {
  const block = deriveBriefingCommitment(envelope({
    modelUsage: [
      usageRow(),
      usageRow({ orgUnitId: "psn_example_unit_boreal", model: "Vendor-Huge-2026", spendMinor: 60_000 }),
    ],
  }), { dataset: "user" });

  assert.equal(block.status, COMMITMENT_STATUS.ok);
  assert.equal(block.consideredCount, 2);
  assert.equal(block.eligibleCount, 2);
  assert.equal(block.commitment.department.departmentId, "psn-example-unit-boreal");
  assert.equal(block.commitment.projectedMonthlySavings.amountMinor, 45_000);
  assert.deepEqual(block.excluded.map((entry) => entry.candidateId),
    ["psn-example-unit-atlas0-vendor-large-2026"]);
  assert.match(block.excluded[0].reason, /larger monthly saving/);
});

// ---------------------------------------------------------------------------
// Determinism, and what the derivation is allowed to read.
// ---------------------------------------------------------------------------

test("identical imported analyses produce identical commitment output", () => {
  const first = deriveBriefingCommitment(envelope(), { dataset: "user" });
  const second = deriveBriefingCommitment(envelope(), { dataset: "user" });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("input order does not change the winner", () => {
  const rows = [
    usageRow(),
    usageRow({ orgUnitId: "psn_example_unit_boreal", model: "Vendor-Huge-2026", spendMinor: 60_000 }),
  ];
  const forward = deriveBriefingCommitment(envelope({ modelUsage: rows }), { dataset: "user" });
  const reversed = deriveBriefingCommitment(envelope({ modelUsage: [...rows].reverse() }), { dataset: "user" });
  assert.equal(JSON.stringify(forward.commitment), JSON.stringify(reversed.commitment));
});

test("the derivation reads no credential, no live provider data, and no stored prompt", () => {
  const clean = deriveBriefingCommitment(envelope(), { dataset: "user" });
  // Every field the fixture below adds is one this derivation must not read:
  // a credential, a live rate card, and stored prompt text. The output is
  // asserted byte-identical to the run without them.
  const polluted = envelope();
  polluted.apiKey = "sk-livekeymustnevertravel00";
  polluted.authorization = "Bearer livetokenmustnevertravel";
  polluted.storedPrompts = [{ promptText: "summarize the quarterly board pack" }];
  polluted.liveRateCard = { url: "https://provider.example/pricing", premiumMinorPerMillion: 9_999 };
  polluted.rankedDepartments[0].secretNote = "sk-anotherkeyentirely00000";

  const derived = deriveBriefingCommitment(polluted, { dataset: "user" });
  assert.equal(JSON.stringify(derived), JSON.stringify(clean));

  const text = JSON.stringify(derived);
  for (const leak of ["sk-live", "Bearer", "quarterly board pack", "provider.example", "9999"]) {
    assert.ok(!text.includes(leak), `commitment carried ${leak}`);
  }
  // The declared read-list is the whole read-list, and none of it is a secret.
  for (const field of COMMITMENT_INPUT_FIELDS) {
    assert.ok(!/prompt|token(?!s)|secret|key|authoriz/i.test(field), `${field} names a forbidden input`);
  }
});

test("the derivation touches no network and no clock", () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const trap = () => { throw new Error("the commitment derivation reached ambient state"); };
  globalThis.fetch = trap;
  Date.now = trap;
  try {
    const block = deriveBriefingCommitment(envelope(), { dataset: "user" });
    assert.equal(block.status, COMMITMENT_STATUS.ok);
    // Every instant in the block is the analysis's own, not this run's.
    assert.equal(block.source.importedAt, "2026-07-02T09:15:00.000Z");
    assert.equal(block.commitment.provenance.importedAt, "2026-07-02T09:15:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

// ---------------------------------------------------------------------------
// Insufficient evidence is a state, not a zero.
// ---------------------------------------------------------------------------

test("every unavailable reason carries an authored statement", () => {
  for (const reason of Object.values(COMMITMENT_UNAVAILABLE_REASON)) {
    const statement = COMMITMENT_UNAVAILABLE_STATEMENT[reason];
    assert.equal(typeof statement, "string", `${reason} has no statement`);
    assert.ok(statement.length > 40 && statement.length <= 400, `${reason} statement is the wrong size`);
  }
});

test("no analysis, a withheld figure, and a non-monthly window each name themselves", () => {
  const cases = [
    [deriveBriefingCommitment(null, { dataset: "user" }), COMMITMENT_UNAVAILABLE_REASON.noAnalysis],
    [deriveBriefingCommitment(envelope(), { dataset: "user", attributionWithheld: true }),
      COMMITMENT_UNAVAILABLE_REASON.attributionWithheld],
    [deriveBriefingCommitment(envelope({ period: "2026-06-01 to 2026-06-15" }), { dataset: "user" }),
      COMMITMENT_UNAVAILABLE_REASON.periodNotACalendarMonth],
  ];
  for (const [block, reason] of cases) {
    assert.equal(block.status, COMMITMENT_STATUS.unavailable);
    assert.equal(block.reason, reason);
    assert.equal(block.commitment, null);
    assert.equal(block.statement, COMMITMENT_UNAVAILABLE_STATEMENT[reason]);
  }
});

test("an import with no model dimension says so rather than proposing nothing", () => {
  const block = deriveBriefingCommitment(envelope({ modelUsage: [usageRow({ model: null })] }),
    { dataset: "user" });
  assert.equal(block.status, COMMITMENT_STATUS.unavailable);
  assert.equal(block.reason, COMMITMENT_UNAVAILABLE_REASON.noModelDimension);
});

test("two org units that reduce to one identifier propose nothing", () => {
  const block = deriveBriefingCommitment(envelope({
    modelUsage: [usageRow({ orgUnitId: "atlas.one" }), usageRow({ orgUnitId: "atlas-one" })],
  }), { dataset: "user" });
  assert.equal(block.status, COMMITMENT_STATUS.unavailable);
  assert.equal(block.reason, COMMITMENT_UNAVAILABLE_REASON.ambiguousIdentifiers);
});

test("every derived candidate clears the contract's own positive-saving floor", () => {
  // The routing rule publishes a model as a candidate only when its delta is
  // strictly positive, so this adapter can never hand the contract a candidate
  // worth zero — Noor's `no_commitment` is reachable from a fixture but not from
  // here. That invariant is asserted rather than left implied, because the day it
  // stops holding is the day a commitment worth $0.00 could reach a leader.
  const block = deriveBriefingCommitment(envelope({
    modelUsage: [
      usageRow(),
      usageRow({ orgUnitId: "psn_example_unit_boreal", model: "Vendor-Huge-2026", spendMinor: 60_000 }),
    ],
  }), { dataset: "user" });
  const derived = commitmentInputFor(envelope({
    modelUsage: [
      usageRow(),
      usageRow({ orgUnitId: "psn_example_unit_boreal", model: "Vendor-Huge-2026", spendMinor: 60_000 }),
    ],
  }), { designation: "imported" });
  assert.equal(block.eligibleCount, block.consideredCount);
  for (const candidate of derived.input.candidates) {
    assert.ok(candidate.baseline.monthlyCostMinor > candidate.projected.monthlyCostMinor,
      `${candidate.candidateId} was derived with no saving in it`);
  }
});

test("calendarMonth accepts one month and refuses everything else", () => {
  assert.equal(calendarMonth("2026-06-01 to 2026-07-01"), "2026-06");
  assert.equal(calendarMonth("2026-12-01 to 2027-01-01"), "2026-12");
  assert.equal(calendarMonth("2026-06-01 to 2026-08-01"), null);
  assert.equal(calendarMonth("2026-06-02 to 2026-07-02"), null);
  assert.equal(calendarMonth("2026-07-01 to 2026-06-01"), null);
  assert.equal(calendarMonth(null), null);
});

// ---------------------------------------------------------------------------
// The briefing file: written, read back, and backwards compatible.
// ---------------------------------------------------------------------------

test("the briefing file carries the commitment and the same bytes twice", () => {
  const options = { dataset: "user", exportedAt: "2026-07-02T10:00:00.000Z" };
  const first = buildBriefing(envelope(), options);
  const second = buildBriefing(envelope(), options);
  assert.equal(serializeBriefing(first), serializeBriefing(second));
  assert.equal(first.savingsCommitment.status, COMMITMENT_STATUS.ok);
  assert.equal(first.savingsCommitment.commitment.department.departmentId, "psn-example-unit-atlas0");
});

test("a reopened briefing states the commitment the file was written with", () => {
  const payload = buildBriefing(envelope(), {
    dataset: "user", exportedAt: "2026-07-02T10:00:00.000Z",
  });
  const outcome = parseSavedBriefing(serializeBriefing(payload));
  assert.equal(outcome.ok, true, outcome.message ?? "");
  // Deep equality, not byte equality: `serializeBriefing` sorts every key on the
  // way out, so the restored object differs from the live one in insertion order
  // and in nothing else — which is exactly the claim being made.
  assert.deepEqual(JSON.parse(JSON.stringify(outcome.saved.savingsCommitment)),
    JSON.parse(JSON.stringify(payload.savingsCommitment)));
});

test("a briefing written before commitments existed still opens", () => {
  const payload = buildBriefing(envelope(), {
    dataset: "user", exportedAt: "2026-07-02T10:00:00.000Z",
  });
  delete payload.savingsCommitment;
  const outcome = parseSavedBriefing(serializeBriefing(payload));
  assert.equal(outcome.ok, true, outcome.message ?? "");
  assert.equal(outcome.saved.savingsCommitment.status, COMMITMENT_STATUS.unavailable);
  assert.equal(outcome.saved.savingsCommitment.reason, COMMITMENT_UNAVAILABLE_REASON.notInFile);
});

test("a tampered saved commitment is refused rather than half-believed", () => {
  const payload = buildBriefing(envelope(), {
    dataset: "user", exportedAt: "2026-07-02T10:00:00.000Z",
  });
  const tampered = JSON.parse(JSON.stringify(payload));
  tampered.savingsCommitment.commitment.projectedMonthlySavings.amountMinor = 9_999_900;
  assert.equal(readSavedCommitment(tampered).reason, COMMITMENT_UNAVAILABLE_REASON.contractRejected);

  const reversioned = JSON.parse(JSON.stringify(payload));
  reversioned.savingsCommitment.contractVersion = "savings-commitment/9.9.9";
  assert.equal(readSavedCommitment(reversioned).reason, COMMITMENT_UNAVAILABLE_REASON.unsupportedVersion);
});

test("an unavailable block survives the round trip as the same reason", () => {
  const payload = buildBriefing(envelope({ period: "2026-06-01 to 2026-06-15" }), {
    dataset: "user", exportedAt: "2026-07-02T10:00:00.000Z",
  });
  assert.equal(payload.savingsCommitment.reason, COMMITMENT_UNAVAILABLE_REASON.periodNotACalendarMonth);
  assert.equal(readSavedCommitment(payload).reason, COMMITMENT_UNAVAILABLE_REASON.periodNotACalendarMonth);
});

// ---------------------------------------------------------------------------
// What a surface paints.
// ---------------------------------------------------------------------------

test("every state paints all three lines, so no slot renders empty", () => {
  const states = [
    deriveBriefingCommitment(envelope(), { dataset: "user" }),
    deriveBriefingCommitment(null, { dataset: "user" }),
    deriveBriefingCommitment(envelope({ modelUsage: [usageRow({ model: null })] }), { dataset: "user" }),
    null,
  ];
  for (const block of states) {
    const lines = commitmentLines(block);
    assert.equal(typeof lines.question, "string");
    assert.ok(lines.question.trim().endsWith("?"));
    assert.ok(lines.headline.trim().length > 0, "an empty headline reads as a blank box");
    assert.ok(lines.detail === null || lines.detail.trim().length > 0);
  }
});

test("the proposed commitment's detail line names the figures a leader decides on", () => {
  const lines = commitmentLines(deriveBriefingCommitment(envelope(), { dataset: "user" }));
  assert.match(lines.headline, /vendor-large-2026/);
  assert.match(lines.detail, /Atlas Platform/);
  assert.match(lines.detail, /150\.00 USD a month/);
  assert.match(lines.detail, /high confidence \(80%\)/);
  assert.match(lines.detail, /2026-06 baseline/);
  assert.match(lines.detail, /1 imported record\./);
});
