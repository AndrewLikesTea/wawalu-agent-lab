// The decision contract behind the returning FinOps lead's one question.
//
// Every case here is a state a reader can be in, named as the state and not as
// the widget: enough evidence, a portable record waiting, a month short, an
// incomplete record, a first visit. The assertions are on the *primary* action,
// because the defect this file exists to prevent is a second plausible action
// being offered as though it were co-equal with the first.
//
// Documents are built by hand rather than through the retention path on
// purpose: this contract reads a stored document, and a hand-built one can hold
// the shapes a real store legitimately produces (a zero commitment, a gap
// between months) without a retention API having to be talked into producing
// them.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MINIMUM_EVIDENCE_PERIODS, UNCHANGED_MOVEMENT_POINTS, WORKSPACE_DECISION_QUESTION,
  buildWorkspaceDecision,
} from "../src/finops-workspace-decision.js";

/** One stored period. `analyzedSpendMinor` is the actual-spend figure. */
const periodOf = (month, actualMinor, { dataset = "user" } = {}) => ({
  periodId: `${dataset}:${month}`, period: month, dataset, analyzedSpendMinor: actualMinor,
});

/** One stored commitment. `projectedMonthlyCostMinor` is the committed figure. */
const commitmentOf = (month, committedMinor, { dataset = "user" } = {}) => ({
  commitmentId: `commit-${month}`, periodId: `${dataset}:${month}`,
  claim: { projectedMonthlyCostMinor: committedMinor, currency: "USD", period: month },
});

const documentOf = (periods = [], commitments = []) => ({ periods, commitments });

/** Two consecutive months, each with both figures. The returning-lead state. */
const twoPeriods = ({ earlierActual = 900_000, laterActual = 1_000_000, committed = 1_000_000 } = {}) =>
  documentOf(
    [periodOf("2026-05", earlierActual), periodOf("2026-06", laterActual)],
    [commitmentOf("2026-05", committed), commitmentOf("2026-06", committed)],
  );

test("two consecutive retained months answer the question, and the movement is the benchmark", () => {
  // 90% of committed spend, then 100%: ten percentage points worse.
  const decision = buildWorkspaceDecision({ document: twoPeriods() });

  assert.equal(decision.question, WORKSPACE_DECISION_QUESTION);
  assert.equal(decision.answer, "yes");
  assert.equal(decision.evidence.sufficient, true);
  assert.deepEqual(decision.evidence.periods, ["user:2026-05", "user:2026-06"]);
  assert.equal(decision.movement.earlierUtilizationPercent, 90);
  assert.equal(decision.movement.laterUtilizationPercent, 100);
  assert.equal(decision.movement.points, 10);
  assert.equal(decision.movement.direction, "worsened");
  assert.match(decision.movement.statement, /worsened by 10\.0 percentage points/);
  // The verdict is primary. No gap-filling action outranks it.
  assert.equal(decision.primaryAction.code, "commitment_verdict");
  assert.deepEqual(decision.secondaryActions.map((action) => action.code), ["add_month"]);
});

test("spending a smaller share of what was committed is improved, and it is signed", () => {
  const decision = buildWorkspaceDecision({
    document: twoPeriods({ earlierActual: 1_100_000, laterActual: 1_000_000 }),
  });

  assert.equal(decision.movement.points, -10);
  assert.equal(decision.movement.direction, "improved");
  assert.equal(decision.primaryAction.code, "commitment_verdict");
});

test("a movement under a tenth of a point is unchanged, not a direction", () => {
  // 100.00% then 100.04%: rounds to 0.0 points, which is below the threshold.
  const decision = buildWorkspaceDecision({
    document: twoPeriods({ earlierActual: 1_000_000, laterActual: 1_000_400 }),
  });

  assert.ok(Math.abs(decision.movement.points) < UNCHANGED_MOVEMENT_POINTS);
  assert.equal(decision.movement.direction, "unchanged");
  assert.match(decision.movement.statement, /was unchanged/);
});

test("a portable record outranks adding a month even when a month is already retained", () => {
  const decision = buildWorkspaceDecision({
    document: documentOf([periodOf("2026-06", 1_000_000)], [commitmentOf("2026-06", 1_000_000)]),
    portableRecordAvailable: true,
  });

  assert.equal(decision.evidence.sufficient, false);
  assert.equal(decision.evidence.retainedPeriodCount, 1);
  // The regression this file exists for: one retained month must not promote
  // "Add a month" over a record the reader already holds.
  assert.equal(decision.primaryAction.code, "import_portable_record");
  assert.equal(decision.primaryAction.label, "Import your portable record");
  assert.deepEqual(decision.secondaryActions.map((action) => action.code), ["add_month"]);
});

test("a portable record with nothing retained is still the import, not the first run", () => {
  const decision = buildWorkspaceDecision({
    document: documentOf(), portableRecordAvailable: true,
  });

  assert.equal(decision.primaryAction.code, "import_portable_record");
  assert.deepEqual(decision.secondaryActions.map((action) => action.code), ["first_import"]);
});

test("a portable record beside non-consecutive months is still the import", () => {
  const decision = buildWorkspaceDecision({
    document: documentOf(
      [periodOf("2026-03", 900_000), periodOf("2026-06", 1_000_000)],
      [commitmentOf("2026-03", 1_000_000), commitmentOf("2026-06", 1_000_000)],
    ),
    portableRecordAvailable: true,
  });

  assert.equal(decision.evidence.retainedPeriodCount, 2);
  assert.equal(decision.evidence.sufficient, false);
  assert.equal(decision.primaryAction.code, "import_portable_record");
});

test("one retained month and no portable record is the month, and only the month", () => {
  const decision = buildWorkspaceDecision({
    document: documentOf([periodOf("2026-06", 1_000_000)], [commitmentOf("2026-06", 1_000_000)]),
  });

  assert.equal(decision.portableRecordAvailable, false);
  assert.equal(decision.primaryAction.code, "add_month");
  assert.deepEqual(decision.secondaryActions, []);
});

test("an incomplete record counts as a period to fill, not as evidence", () => {
  // A month with an actual figure and no committed one: retained in the store,
  // and no part of a verdict.
  const decision = buildWorkspaceDecision({
    document: documentOf([periodOf("2026-06", 1_000_000)]),
  });

  assert.equal(decision.evidence.retainedPeriodCount, 0);
  assert.equal(decision.evidence.incompletePeriodCount, 1);
  assert.equal(decision.primaryAction.code, "add_month");
});

test("a first visit is the first import, with nothing else offered beside it", () => {
  const decision = buildWorkspaceDecision();

  assert.equal(decision.answer, "not_yet");
  assert.equal(decision.evidence.retainedPeriodCount, 0);
  assert.equal(decision.primaryAction.code, "first_import");
  assert.deepEqual(decision.secondaryActions, []);
  assert.match(decision.evidence.statement, new RegExp(`${MINIMUM_EVIDENCE_PERIODS} consecutive`));
});

test("a zero or negative committed spend is an incomplete record, never an infinity", () => {
  for (const committed of [0, -1_000_000]) {
    const decision = buildWorkspaceDecision({
      document: documentOf(
        [periodOf("2026-05", 900_000), periodOf("2026-06", 1_000_000)],
        [commitmentOf("2026-05", committed), commitmentOf("2026-06", 1_000_000)],
      ),
    });

    assert.equal(decision.evidence.sufficient, false, `committed ${committed} produced a verdict`);
    assert.equal(decision.movement, null);
    assert.equal(decision.evidence.incompletePeriodCount, 1);
    assert.equal(decision.primaryAction.code, "add_month");
  }
});

test("two non-consecutive months do not satisfy the threshold", () => {
  const decision = buildWorkspaceDecision({
    document: documentOf(
      [periodOf("2026-04", 900_000), periodOf("2026-06", 1_000_000)],
      [commitmentOf("2026-04", 1_000_000), commitmentOf("2026-06", 1_000_000)],
    ),
  });

  assert.equal(decision.evidence.retainedPeriodCount, MINIMUM_EVIDENCE_PERIODS);
  assert.equal(decision.evidence.sufficient, false);
  assert.equal(decision.movement, null);
  assert.equal(decision.primaryAction.code, "add_month");
});

test("consecutive months are consecutive across a year end", () => {
  const decision = buildWorkspaceDecision({
    document: documentOf(
      [periodOf("2025-12", 900_000), periodOf("2026-01", 1_000_000)],
      [commitmentOf("2025-12", 1_000_000), commitmentOf("2026-01", 1_000_000)],
    ),
  });

  assert.equal(decision.evidence.sufficient, true);
  assert.deepEqual(decision.evidence.months, ["2025-12", "2026-01"]);
});

test("a comparison never crosses datasets, even when the months line up", () => {
  const decision = buildWorkspaceDecision({
    document: documentOf(
      [periodOf("2026-05", 900_000, { dataset: "example" }), periodOf("2026-06", 1_000_000)],
      [commitmentOf("2026-05", 1_000_000, { dataset: "example" }), commitmentOf("2026-06", 1_000_000)],
    ),
  });

  assert.equal(decision.evidence.retainedPeriodCount, 2);
  assert.equal(decision.evidence.sufficient, false);
});

test("availability is an input, and only a literal yes is one", () => {
  const document = documentOf([periodOf("2026-06", 1_000_000)], [commitmentOf("2026-06", 1_000_000)]);
  for (const value of ["available", "yes", 1, {}]) {
    const decision = buildWorkspaceDecision({ document, portableRecordAvailable: value });
    assert.equal(decision.portableRecordAvailable, false, `${JSON.stringify(value)} was believed`);
    assert.equal(decision.primaryAction.code, "add_month");
  }
});

test("provenance names periods and declared sources, and the limits say what it cannot tell you", () => {
  const decision = buildWorkspaceDecision({
    document: twoPeriods(),
    sourceDeclarations: [{
      role: "provider", contractKind: "wawalu.integration.provider-usage-billing",
      contractVersion: "1.0", mappingVersion: "provider-billing-to-finops/1.0.0",
      reuseState: "review_required",
    }],
  });

  const terms = decision.provenance.map((row) => row.term);
  assert.deepEqual(terms,
    ["Periods counted", "Incomplete records", "Declared sources", "Portable record"]);
  assert.match(decision.provenance[0].detail, /user:2026-05, user:2026-06/);
  assert.match(decision.provenance[2].detail, /provider: wawalu\.integration\.provider-usage-billing/);
  assert.match(decision.provenance[2].detail, /review required/);
  assert.equal(decision.limitations.length, 3);
  assert.match(decision.limitations[0], /does not prove the commitment caused the movement/);
  // Provenance is identifiers and declared labels. No figure of anyone's leaks
  // into it, and no source identifier, credential, or prompt has a field here.
  const serialized = JSON.stringify(decision.provenance);
  assert.equal(/\d{3},\d{3}/.test(serialized), false);
});

test("the contract never throws on a store it cannot make sense of", () => {
  for (const document of [null, {}, { periods: null }, { periods: [null, {}], commitments: [null] }]) {
    const decision = buildWorkspaceDecision({ document });
    assert.equal(decision.evidence.sufficient, false);
    assert.ok(decision.primaryAction.code.length > 0);
  }
});
