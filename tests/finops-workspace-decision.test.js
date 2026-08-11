import test from "node:test";
import assert from "node:assert/strict";

import {
  finopsWorkspaceDecision, PORTABLE_RECORD_AVAILABILITY,
} from "../src/finops-workspace-decision.js";

const period = (month, spendMinor, workspace = "user") => ({
  period: month, periodId: `${workspace}:${month}`, analyzedSpendMinor: spendMinor,
});

const commitment = (month, {
  baseline = 100_000, projected = 80_000, saving = 20_000, workspace = "user",
} = {}) => ({
  periodId: `${workspace}:${month}`,
  claim: {
    baselineMonthlyCostMinor: baseline,
    projectedMonthlyCostMinor: projected,
    monthlySavingsMinor: saving,
    currency: "USD",
    unit: "usd_minor",
  },
});

const document = (periods = [], commitments = []) => ({ periods, commitments });

test("first-time state answers insufficiency and has one Start fresh action", () => {
  const decision = finopsWorkspaceDecision({ document: document() });

  assert.equal(decision.sufficient, false);
  assert.equal(decision.evidence.requiredCompleteComparablePeriods, 2);
  assert.equal(decision.primaryAction.code, "start_fresh");
  assert.equal(decision.primaryAction.label, "Start fresh");
  assert.equal(decision.movement, null);
  assert.equal(decision.verdict, null);
});

test("incomplete retained record without a portable record says Add a month", () => {
  const decision = finopsWorkspaceDecision({
    document: document([period("2026-06", 90_000)], [commitment("2026-06")]),
  });

  assert.equal(decision.sufficient, false);
  assert.equal(decision.primaryAction.code, "add_month");
  assert.equal(decision.primaryAction.label, "Add a month");
});

test("portable-record-plus-gap prioritizes importing the portable record", () => {
  const decision = finopsWorkspaceDecision({
    document: document([period("2026-06", 90_000)], []),
    portableRecordAvailability: PORTABLE_RECORD_AVAILABILITY.available,
  });

  assert.equal(decision.sufficient, false);
  assert.equal(decision.portableRecordAvailability, "available");
  assert.equal(decision.primaryAction.code, "import_portable_record");
  assert.equal(decision.primaryAction.label, "Import your portable record");
  // The priority is stated, not merely applied.
  assert.match(decision.primaryAction.reason, /comes first/);
});

// A truthy-but-wrong value is the way this ordering fails in production: the
// caller believes it declared availability, the contract reads it as neither
// enum value, and the reader silently gets the action the review rejected. The
// safe reading is the one that asks for less, and the contract has to say which
// reading it used rather than echo the input back.
test("an availability value outside the enum reads as unavailable, and is reported as such", () => {
  for (const value of [true, "yes", 1, null, {}]) {
    const decision = finopsWorkspaceDecision({
      document: document([period("2026-06", 90_000)], [commitment("2026-06")]),
      portableRecordAvailability: value,
    });

    assert.equal(decision.portableRecordAvailability, "unavailable");
    assert.equal(decision.primaryAction.code, "add_month");
  }
});

test("two complete same-workspace periods produce verdict, movement, and one follow-up", () => {
  const decision = finopsWorkspaceDecision({
    document: document(
      [period("2026-05", 100_000), period("2026-06", 75_000)],
      [commitment("2026-05", { saving: 20_000 }), commitment("2026-06", { saving: 30_000 })],
    ),
  });

  assert.equal(decision.sufficient, true);
  assert.deepEqual(decision.evidence.periods, ["2026-05", "2026-06"]);
  assert.equal(decision.verdict.code, "achieved");
  assert.equal(decision.movement.absoluteMinor, 10_000);
  assert.equal(decision.movement.percentage, 50);
  assert.equal(decision.movement.percentageLabel, "50%");
  assert.equal(decision.primaryAction.code, "commit_next_action");
});

test("movement percentage is explicitly undefined when prior commitment is zero", () => {
  const decision = finopsWorkspaceDecision({
    document: document(
      [period("2026-05", 100_000), period("2026-06", 90_000)],
      [commitment("2026-05", { saving: 0 }), commitment("2026-06", { saving: 10_000 })],
    ),
  });

  assert.equal(decision.movement.absoluteMinor, 10_000);
  assert.equal(decision.movement.percentage, null);
  assert.equal(decision.movement.percentageLabel, "Undefined (prior commitment is zero)");
  assert.match(decision.movement.statement, /Undefined \(prior commitment is zero\)/);
});

test("months from different workspaces and incomplete claims never become sufficient", () => {
  const decision = finopsWorkspaceDecision({
    document: document(
      [period("2026-05", 100_000, "alpha"), period("2026-06", 90_000, "beta"),
        period("2026-07", 80_000, "alpha")],
      [commitment("2026-05", { workspace: "alpha" }),
        commitment("2026-06", { workspace: "beta" }),
        { ...commitment("2026-07", { workspace: "alpha" }), claim: { currency: "USD" } }],
    ),
  });

  assert.equal(decision.sufficient, false);
  assert.equal(decision.primaryAction.code, "add_month");
});
