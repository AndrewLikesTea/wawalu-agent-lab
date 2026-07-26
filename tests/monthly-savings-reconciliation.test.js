import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import reconciliationFixture from "../src/monthly-savings-reconciliation-fixture.json" with {
  type: "json",
};
import portfolioFixture from "../src/savings-portfolio-fixture.json" with { type: "json" };
import {
  MONTHLY_RECONCILIATION_METRIC_RULES,
  MonthlySavingsReconciliationError,
  createMonthlySavingsReconciliation,
} from "../src/monthly-savings-reconciliation.js";
import { createSavingsPortfolio } from "../src/savings-portfolio.js";

const portfolio = createSavingsPortfolio(portfolioFixture);
const fixtureText = await readFile(
  new URL("../src/monthly-savings-reconciliation-fixture.json", import.meta.url), "utf8",
);

function createFixture(overrides = {}) {
  return { ...structuredClone(reconciliationFixture), ...overrides };
}

function recordFor(fixture, actionId, month) {
  return fixture.records.find(
    (record) => record.actionId === actionId && record.measurementMonth === month,
  );
}

test("fixture shape is compatible with Noor's delivered portfolio contract", () => {
  const reconciliation = createMonthlySavingsReconciliation(
    reconciliationFixture, portfolio,
  );
  assert.equal(reconciliation.portfolioSchemaVersion, portfolio.schemaVersion);
  assert.deepEqual(reconciliation.measurementWindow, {
    firstMonth: "2026-06", lastMonth: "2026-07", monthCount: 2,
  });
  assert.equal(
    reconciliation.records.length, portfolio.actions.length * 2,
    "the grid must be dense: one record per action per window month",
  );

  const wrongPortfolioVersion = createFixture({ portfolioSchemaVersion: "savings-portfolio/9.0.0" });
  assert.throws(() => createMonthlySavingsReconciliation(wrongPortfolioVersion, portfolio),
    /portfolioSchemaVersion/);
});

test("every monthly record links to an existing accountable action identifier", () => {
  const portfolioIds = new Set(portfolio.actions.map(({ actionId }) => actionId));
  const reconciliation = createMonthlySavingsReconciliation(
    reconciliationFixture, portfolio,
  );
  assert.deepEqual(
    new Set(reconciliation.records.map(({ actionId }) => actionId)),
    portfolioIds,
  );

  const broken = createFixture();
  broken.records[0].actionId = "syn-missing";
  assert.throws(
    () => createMonthlySavingsReconciliation(broken, portfolio),
    (error) => error instanceof MonthlySavingsReconciliationError
      && error.path.endsWith("actionId"),
  );
});

test("records expose every required reconciliation and provenance field", () => {
  const { records } = createMonthlySavingsReconciliation(
    reconciliationFixture, portfolio,
  );
  for (const record of records) {
    for (const field of [
      "actionId", "measurementMonth", "projectionBaseline",
      "simulatedRealizedSavingsUsd", "varianceUsd", "varianceReason",
      "evidenceProvenance", "availabilityState", "availabilityReason",
      "aggregationInput",
    ]) assert.ok(Object.hasOwn(record, field), `${record.actionId}: ${field}`);
    assert.ok(record.projectionBaseline.allocationRule);
    assert.ok(record.evidenceProvenance.source);
  }
});

test("the monthly baseline is computed, so two readers derive the same plan", () => {
  const { records } = createMonthlySavingsReconciliation(reconciliationFixture, portfolio);
  for (const record of records) {
    const { annualizedSavingsUsd, monthlySavingsUsd, allocationRule } =
      record.projectionBaseline;
    assert.equal(monthlySavingsUsd, allocationRule === "even-twelfth"
      ? Math.round(annualizedSavingsUsd / 12) : 0);
  }
  // 88000/12 rounds down, 110000/12 rounds up: both are derived, not authored.
  assert.equal(recordFor({ records }, "syn-quality-retry", "2026-07")
    .projectionBaseline.monthlySavingsUsd, 7333);

  const authored = createFixture();
  recordFor(authored, "syn-platform-cache", "2026-07")
    .projectionBaseline.monthlySavingsUsd = 1999;
  assert.throws(() => createMonthlySavingsReconciliation(authored, portfolio),
    /must equal 2000 under the even-twelfth rule/);

  assert.ok(MONTHLY_RECONCILIATION_METRIC_RULES.monthlyProjectionBaseline);
});

test("an action carries no monthly plan before it entered in-progress", () => {
  const { records } = createMonthlySavingsReconciliation(reconciliationFixture, portfolio);
  // syn-support-library never left planned; syn-finops-routing started 2026-07-01.
  for (const record of records.filter(
    ({ actionId }) => actionId === "syn-support-library",
  )) {
    assert.equal(record.projectionBaseline.monthlySavingsUsd, 0);
    assert.equal(record.availabilityReason, "action-not-started");
  }
  assert.equal(recordFor({ records }, "syn-finops-routing", "2026-06")
    .projectionBaseline.monthlySavingsUsd, 0);
  assert.equal(recordFor({ records }, "syn-finops-routing", "2026-07")
    .projectionBaseline.monthlySavingsUsd, 6000);

  const premature = createFixture();
  const dormant = recordFor(premature, "syn-support-library", "2026-07");
  dormant.projectionBaseline.monthlySavingsUsd = 9167;
  dormant.projectionBaseline.allocationRule = "even-twelfth";
  assert.throws(() => createMonthlySavingsReconciliation(premature, portfolio),
    /must equal not-yet-active for this action month/);

  const claimed = createFixture();
  const started = recordFor(claimed, "syn-support-library", "2026-06");
  started.availabilityState = "available";
  started.simulatedRealizedSavingsUsd = 500;
  started.varianceReason = "above-projection";
  started.availabilityReason = null;
  started.evidenceProvenance.evidenceRefs = ["syn-recon-support-2026-06"];
  assert.throws(() => createMonthlySavingsReconciliation(claimed, portfolio),
    /must be unavailable before the action entered in-progress/);
});

test("an unmeasured plan is reported as coverage, never as being behind plan", () => {
  const { monthlyAggregationInputs } = createMonthlySavingsReconciliation(
    reconciliationFixture, portfolio,
  );
  assert.deepEqual(monthlyAggregationInputs, [
    {
      measurementMonth: "2026-06",
      projectedSavingsUsd: 2_000,
      measuredProjectedSavingsUsd: 2_000,
      unmeasuredProjectedSavingsUsd: 0,
      creditedSimulatedRealizedSavingsUsd: 2_250,
      measuredVarianceUsd: 250,
      availableActionCount: 1,
      unavailableActionCount: 3,
      notStartedActionCount: 3,
    },
    {
      measurementMonth: "2026-07",
      projectedSavingsUsd: 15_333,
      measuredProjectedSavingsUsd: 8_000,
      // syn-quality-retry is running but not yet measured. Its 7333 USD plan is
      // reported here and is deliberately absent from the variance below.
      unmeasuredProjectedSavingsUsd: 7_333,
      creditedSimulatedRealizedSavingsUsd: 7_500,
      measuredVarianceUsd: -500,
      availableActionCount: 2,
      unavailableActionCount: 2,
      notStartedActionCount: 1,
    },
  ]);
});

test("action and monthly aggregation inputs are deterministic and additive", () => {
  const first = createMonthlySavingsReconciliation(reconciliationFixture, portfolio);
  const second = createMonthlySavingsReconciliation(
    JSON.parse(JSON.stringify(reconciliationFixture)), portfolio,
  );
  assert.deepEqual(second, first);
  assert.deepEqual(first.records.map((record) =>
    `${record.measurementMonth}:${record.actionId}`), [
    "2026-06:syn-finops-routing", "2026-06:syn-platform-cache",
    "2026-06:syn-quality-retry", "2026-06:syn-support-library",
    "2026-07:syn-finops-routing", "2026-07:syn-platform-cache",
    "2026-07:syn-quality-retry", "2026-07:syn-support-library",
  ]);

  // Every aggregate in the contract is reproducible by summing record inputs.
  for (const field of [
    "projectedSavingsUsd", "measuredProjectedSavingsUsd",
    "creditedSimulatedRealizedSavingsUsd",
  ]) {
    const fromRecords = first.records.reduce(
      (total, record) => total + record.aggregationInput[field], 0,
    );
    const byMonth = first.monthlyAggregationInputs.reduce(
      (total, month) => total + month[field], 0,
    );
    const byAction = first.actionAggregationInputs.reduce(
      (total, action) => total + action[field], 0,
    );
    assert.equal(byMonth, fromRecords, field);
    assert.equal(byAction, fromRecords, field);
  }
});

test("an action-level review compares months and states its own coverage", () => {
  const { actionAggregationInputs } = createMonthlySavingsReconciliation(
    reconciliationFixture, portfolio,
  );
  const byId = new Map(actionAggregationInputs.map((entry) => [entry.actionId, entry]));
  assert.deepEqual(actionAggregationInputs.map(({ actionId }) => actionId), [
    "syn-finops-routing", "syn-platform-cache", "syn-quality-retry", "syn-support-library",
  ]);

  // Measured in both window months: +250 then -250, flat against plan overall.
  assert.deepEqual(byId.get("syn-platform-cache"), {
    actionId: "syn-platform-cache",
    windowMonthCount: 2,
    activeMonthCount: 2,
    measuredMonthCount: 2,
    unmeasuredActiveMonthCount: 0,
    projectedSavingsUsd: 4_000,
    measuredProjectedSavingsUsd: 4_000,
    unmeasuredProjectedSavingsUsd: 0,
    creditedSimulatedRealizedSavingsUsd: 4_000,
    measuredVarianceUsd: 0,
  });

  // Running but never measured: no comparison exists, so variance is null.
  const pending = byId.get("syn-quality-retry");
  assert.equal(pending.activeMonthCount, 1);
  assert.equal(pending.measuredMonthCount, 0);
  assert.equal(pending.unmeasuredActiveMonthCount, 1);
  assert.equal(pending.unmeasuredProjectedSavingsUsd, 7_333);
  assert.equal(pending.measuredVarianceUsd, null,
    "zero would read as on plan, which the data cannot support");

  // Never started: no plan, no measurement, no verdict.
  assert.deepEqual(byId.get("syn-support-library"), {
    actionId: "syn-support-library",
    windowMonthCount: 2,
    activeMonthCount: 0,
    measuredMonthCount: 0,
    unmeasuredActiveMonthCount: 0,
    projectedSavingsUsd: 0,
    measuredProjectedSavingsUsd: 0,
    unmeasuredProjectedSavingsUsd: 0,
    creditedSimulatedRealizedSavingsUsd: 0,
    measuredVarianceUsd: null,
  });
});

test("unavailable measurements remain null while additive credit is explicit zero", () => {
  const { records } = createMonthlySavingsReconciliation(
    reconciliationFixture, portfolio,
  );
  const unavailable = records.find(
    ({ availabilityState }) => availabilityState === "unavailable",
  );
  assert.equal(unavailable.simulatedRealizedSavingsUsd, null);
  assert.equal(unavailable.varianceUsd, null);
  assert.equal(unavailable.aggregationInput.creditedSimulatedRealizedSavingsUsd, 0);
  assert.equal(unavailable.aggregationInput.measuredProjectedSavingsUsd, 0);

  const broken = createFixture();
  broken.records[0].simulatedRealizedSavingsUsd = 0;
  assert.throws(() => createMonthlySavingsReconciliation(broken, portfolio),
    /must be null/);
});

test("a missing measurement says whether to chase the owner or wait", () => {
  const { records } = createMonthlySavingsReconciliation(reconciliationFixture, portfolio);
  assert.equal(recordFor({ records }, "syn-quality-retry", "2026-07").availabilityReason,
    "measurement-pending");
  assert.equal(recordFor({ records }, "syn-quality-retry", "2026-06").availabilityReason,
    "action-not-started");
  for (const record of records.filter(
    ({ availabilityState }) => availabilityState === "available",
  )) assert.equal(record.availabilityReason, null);

  const mislabelled = createFixture();
  recordFor(mislabelled, "syn-quality-retry", "2026-07").availabilityReason =
    "action-not-started";
  assert.throws(() => createMonthlySavingsReconciliation(mislabelled, portfolio),
    /must equal measurement-pending/);

  const missing = createFixture();
  delete recordFor(missing, "syn-quality-retry", "2026-07").availabilityReason;
  assert.throws(() => createMonthlySavingsReconciliation(missing, portfolio),
    /availabilityReason/);
});

test("simulated measurements never borrow portfolio verification evidence", () => {
  const verifiedEvidenceIds = new Set(portfolio.actions.flatMap(
    (action) => action.verificationEvidence.map(({ evidenceId }) => evidenceId),
  ));
  const { records } = createMonthlySavingsReconciliation(reconciliationFixture, portfolio);
  for (const record of records) {
    for (const reference of record.evidenceProvenance.evidenceRefs) {
      assert.ok(reference.startsWith("syn-recon-"), reference);
      assert.equal(verifiedEvidenceIds.has(reference), false,
        "a simulated measurement must not cite verified savings evidence");
    }
  }

  const borrowed = createFixture();
  recordFor(borrowed, "syn-platform-cache", "2026-07")
    .evidenceProvenance.evidenceRefs = ["syn-evidence-cache-01"];
  assert.throws(() => createMonthlySavingsReconciliation(borrowed, portfolio),
    /must be a syn-recon- reconciliation reference/);

  const unmeasuredEvidence = createFixture();
  recordFor(unmeasuredEvidence, "syn-quality-retry", "2026-07")
    .evidenceProvenance.evidenceRefs = ["syn-recon-retry-2026-07"];
  assert.throws(() => createMonthlySavingsReconciliation(unmeasuredEvidence, portfolio),
    /must be empty when no measurement exists/);
});

test("baseline linkage, variance reason, evidence, and duplicate month IDs fail closed", () => {
  const baseline = createFixture();
  baseline.records[0].projectionBaseline.annualizedSavingsUsd = 1;
  assert.throws(() => createMonthlySavingsReconciliation(baseline, portfolio),
    /must equal the linked action projection/);

  const reason = createFixture();
  recordFor(reason, "syn-platform-cache", "2026-07").varianceReason = "above-projection";
  assert.throws(() => createMonthlySavingsReconciliation(reason, portfolio),
    /must equal below-projection/);

  const evidence = createFixture();
  recordFor(evidence, "syn-platform-cache", "2026-07")
    .evidenceProvenance.evidenceRefs = [];
  assert.throws(() => createMonthlySavingsReconciliation(evidence, portfolio),
    /require evidence/);

  const duplicate = createFixture();
  duplicate.records.push(structuredClone(duplicate.records[0]));
  assert.throws(() => createMonthlySavingsReconciliation(duplicate, portfolio),
    /must be unique within a measurement month/);
});

test("a sparse or gapped window is rejected before any total is reported", () => {
  const sparse = createFixture();
  sparse.records = sparse.records.filter(
    (record) => record.actionId !== "syn-support-library",
  );
  assert.throws(() => createMonthlySavingsReconciliation(sparse, portfolio),
    /must contain a record for syn-support-library in 2026-06/);

  const gapped = createFixture();
  for (const record of structuredClone(reconciliationFixture.records)) {
    if (record.measurementMonth === "2026-06") continue;
    gapped.records.push({ ...record, measurementMonth: "2026-09" });
  }
  assert.throws(() => createMonthlySavingsReconciliation(gapped, portfolio),
    /contiguous window; 2026-08 is missing/);
});

test("the shipped fixture stays synthetic, with no credentials or live-provider data", () => {
  const forbidden = [
    [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "an email address"],
    [/https?:\/\//i, "a live URL"],
    [/\b(?:sk|pk|ghp|xox[bp])[-_][A-Za-z0-9]{8,}/, "a credential-shaped token"],
    [/\b(?:api[_-]?key|secret|password|bearer|authorization)\b/i, "a credential field"],
    [/\b(?:openai|anthropic|aws|azure|gcp|snowflake|databricks)\b/i, "a live provider name"],
    [/\b\d{3}-\d{2}-\d{4}\b/, "a government identifier"],
  ];
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(fixtureText), false, `fixture must not contain ${label}`);
  }
  for (const record of reconciliationFixture.records) {
    assert.match(record.actionId, /^syn-/, "action IDs must stay synthetic");
    assert.match(record.evidenceProvenance.source, /synthetic/i);
  }
});

test("reconciliation is static, serializable, and cannot mutate lifecycle data", () => {
  const before = structuredClone(portfolio.actions);
  const reconciliation = createMonthlySavingsReconciliation(
    reconciliationFixture, portfolio,
  );
  assert.doesNotThrow(() => JSON.stringify(reconciliation));
  assert.throws(() => {
    reconciliation.records[0].availabilityState = "available";
  }, TypeError);
  assert.throws(() => {
    reconciliation.actionAggregationInputs[0].measuredVarianceUsd = 1;
  }, TypeError);
  assert.deepEqual(portfolio.actions, before);
});
