// Labelled paired-period fixtures for commitment verification.
//
// Each case is a baseline month, a later month, and the exact outcome the check
// must produce for the pair — realized, variance, verdict, or the reason there is
// none. The label is the claim; `expected` is the claim written down as numbers
// so a disagreement about a score is a failing test rather than an argument.
//
// The envelopes are BUILT from `analyzeModelRouting` — the same call the product's
// own import makes — rather than committed as JSON. A stale JSON file agrees with
// itself forever; a built one fails the moment the routing rule's published shape
// moves, which is the only way a fixture can keep being evidence.
//
// Every factory returns a fresh object, so a test may reorder or pollute one
// without leaking into the next case.

import { analyzeModelRouting } from "../../../src/down-routing-candidates.js";

/**
 * The reference per-model usage row.
 *
 * 10,000,000 tokens at 3,000 minor per million observed (the premium floor is
 * 2,000), 5,000 calls at 2,000 tokens each, repriced at the 1,500 standard
 * reference: 300.00 USD becomes a 150.00 USD projection, so the commitment this
 * row produces projects exactly 15,000 minor units of monthly saving.
 */
export function usageRow(overrides = {}) {
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

const DEPARTMENT_NAMES = Object.freeze({
  psn_example_unit_atlas0: "Atlas Platform",
  psn_example_unit_boreal: "Boreal Systems",
  "atlas-one": "Atlas One",
});

/**
 * One month's analysis envelope, in the shape `normalizeLocalFinops` publishes.
 *
 * `unitIds` is taken from the rows unless given, and department names are looked
 * up by id rather than by array position: a fixture whose labels move with the
 * input order cannot be used to prove that the output does not.
 */
export function monthEnvelope({
  modelUsage = [usageRow()],
  unitIds = null,
  period = "2026-06-01 to 2026-07-01",
  generatedAt = "2026-07-02T09:15:00.000Z",
  ...rest
} = {}) {
  const ids = unitIds ?? [...new Set(modelUsage.map((row) => row.orgUnitId))];
  return {
    schemaVersion: "local-finops/1.0.0",
    generatedAt,
    period,
    spendUsd: 1_000,
    recoverableUsd: 150,
    rankedDepartments: ids.map((id) => ({
      id,
      name: DEPARTMENT_NAMES[id] ?? "Org unit",
      spendUsd: 500,
      recoverableUsd: 150,
      records: 12,
      downRouting: { ruleVersion: "down-routing-candidate/1.0.0", recoverableUsd: 150 },
    })),
    modelRouting: analyzeModelRouting({ modelUsage, unitIds: ids }),
    quality: { joinedRecords: 12, quarantinedRecords: 0, providerCompleteness: "complete" },
    action: "Pilot lower-cost routing for text-generation.",
    topDepartment: { id: ids[0], recoverableUsd: 150 },
    ...rest,
  };
}

/** The month after the reference baseline, so every pair is genuinely adjacent. */
export function observedMonth(options = {}) {
  return monthEnvelope({
    period: "2026-07-01 to 2026-08-01",
    generatedAt: "2026-08-02T09:15:00.000Z",
    ...options,
  });
}

/**
 * The baseline every case below commits from: one unit, one model, 30,000 minor
 * baseline, 15,000 minor projected saving.
 */
export function referenceBaseline() {
  return monthEnvelope();
}

/**
 * The two colliding units of the ambiguous case, as a pair of factories rather
 * than a fixed array, so a test can present them in either order.
 *
 * `atlas.one` and `Atlas One` are two distinct org units in the visitor's export
 * and reduce to the identical canonical id `atlas-one` — which is also the
 * committed department's id. Their observed spends differ deliberately: one would
 * score `achieved` and the other `under_realized`, so an order-dependent
 * selection would not merely be unprincipled, it would print a different verdict
 * depending on which row the exporter happened to write first.
 */
export const AMBIGUOUS_OBSERVED_UNITS = Object.freeze([
  Object.freeze({ orgUnitId: "atlas.one", spendMinor: 12_000 }),
  Object.freeze({ orgUnitId: "Atlas One", spendMinor: 24_000 }),
]);

export function ambiguousObservedMonth(units = AMBIGUOUS_OBSERVED_UNITS) {
  return observedMonth({
    modelUsage: units.map((unit) => usageRow({ orgUnitId: unit.orgUnitId, spendMinor: unit.spendMinor })),
    unitIds: units.map((unit) => unit.orgUnitId),
  });
}

/**
 * The labelled cases.
 *
 * `expected` states the whole outcome, not a spot check: for an available verdict
 * it fixes realized savings, variance, attainment, and the verdict; for an
 * unavailable one it fixes the reason code. `why` records the assumption the case
 * is there to defend, so deleting a case means deleting a stated claim.
 */
export const PAIRED_PERIOD_CASES = Object.freeze([
  Object.freeze({
    label: "achieved — the committed route got cheaper by more than projected",
    why: "Realized savings are measured against the commitment's own baseline, and beating the plan is "
      + "reported as achieved rather than capped at 100%.",
    baseline: referenceBaseline,
    observed: () => observedMonth({ modelUsage: [usageRow({ spendMinor: 12_000 })] }),
    expected: Object.freeze({
      status: "ok",
      verdict: "achieved",
      observedPeriod: "2026-07",
      realizedCostMinor: 12_000,
      realizedSavingsMinor: 18_000,
      projectedSavingsMinor: 15_000,
      varianceMinor: 3_000,
      attainmentPercent: 120,
    }),
  }),
  Object.freeze({
    label: "achieved — the committed route landed exactly on the projected saving",
    why: "The boundary between achieved and under-realized is exactly variance = 0, with no tolerance "
      + "band. A fixture sits on the boundary so nobody can move it quietly.",
    baseline: referenceBaseline,
    observed: () => observedMonth({ modelUsage: [usageRow({ spendMinor: 15_000 })] }),
    expected: Object.freeze({
      status: "ok",
      verdict: "achieved",
      observedPeriod: "2026-07",
      realizedCostMinor: 15_000,
      realizedSavingsMinor: 15_000,
      projectedSavingsMinor: 15_000,
      varianceMinor: 0,
      attainmentPercent: 100,
    }),
  }),
  Object.freeze({
    label: "under-realized — the route got cheaper, but by less than committed",
    why: "A partial result is its own verdict. Rounding it up to achieved or down to not-realized are "
      + "both ways of not answering the question.",
    baseline: referenceBaseline,
    observed: () => observedMonth({ modelUsage: [usageRow({ spendMinor: 24_000 })] }),
    expected: Object.freeze({
      status: "ok",
      verdict: "under_realized",
      observedPeriod: "2026-07",
      realizedCostMinor: 24_000,
      realizedSavingsMinor: 6_000,
      projectedSavingsMinor: 15_000,
      varianceMinor: -9_000,
      attainmentPercent: 40,
    }),
  }),
  Object.freeze({
    label: "not realized — the committed route cost more than its own baseline",
    why: "Realized savings are signed and never clamped at zero, so a route that got more expensive "
      + "reports a negative saving instead of reading as “saved nothing”.",
    baseline: referenceBaseline,
    observed: () => observedMonth({ modelUsage: [usageRow({ spendMinor: 36_000 })] }),
    expected: Object.freeze({
      status: "ok",
      verdict: "not_realized",
      observedPeriod: "2026-07",
      realizedCostMinor: 36_000,
      realizedSavingsMinor: -6_000,
      projectedSavingsMinor: 15_000,
      varianceMinor: -21_000,
      attainmentPercent: -40,
    }),
  }),
  Object.freeze({
    label: "unavailable — the later month never observed the committed department",
    why: "A department that stopped reporting has not saved anything; it has stopped being measured. "
      + "Those two are the same number and different answers.",
    baseline: referenceBaseline,
    observed: () => observedMonth({
      modelUsage: [usageRow({ orgUnitId: "psn_example_unit_boreal" })],
    }),
    expected: Object.freeze({ status: "unavailable", reason: "department_not_observed" }),
  }),
  Object.freeze({
    label: "unavailable — the department is observed but publishes no row for the committed route",
    why: "An absent model row is not evidence that its traffic cost nothing; it is evidence of nothing. "
      + "Reading absence as a full saving is how a migration that never happened gets a verdict.",
    baseline: referenceBaseline,
    observed: () => observedMonth({
      modelUsage: [usageRow({ model: "Vendor-Small-2026", spendMinor: 8_000 })],
    }),
    expected: Object.freeze({ status: "unavailable", reason: "route_not_observed" }),
  }),
  Object.freeze({
    label: "unavailable — the later month is not the month after the baseline",
    why: "A commitment priced in June is checked against July. Any later month folds in every other "
      + "change made in between and credits them all to this one decision.",
    baseline: referenceBaseline,
    observed: () => monthEnvelope({
      period: "2026-08-01 to 2026-09-01",
      generatedAt: "2026-09-02T09:15:00.000Z",
      modelUsage: [usageRow({ spendMinor: 12_000 })],
    }),
    expected: Object.freeze({ status: "unavailable", reason: "observation_period_not_paired" }),
  }),
  Object.freeze({
    label: "unavailable — no later month has been imported at all",
    why: "The commonest state of a fresh commitment is “not measurable yet”, and it has to be sayable "
      + "without a number attached.",
    baseline: referenceBaseline,
    observed: () => null,
    expected: Object.freeze({ status: "unavailable", reason: "no_observation" }),
  }),
  Object.freeze({
    label: "unavailable — two observed org units canonicalize to the committed department id",
    why: "Neither colliding unit can be shown to be the committed one, and they carry different spends, "
      + "so any selection between them invents a verdict out of row order.",
    baseline: () => monthEnvelope({ modelUsage: [usageRow({ orgUnitId: "atlas-one" })] }),
    observed: () => ambiguousObservedMonth(),
    expected: Object.freeze({
      status: "unavailable",
      reason: "ambiguous_observation",
      scope: "department",
      identifier: "atlas-one",
      matchCount: 2,
    }),
  }),
  Object.freeze({
    label: "unavailable — two observed model rows canonicalize to the committed route id",
    why: "The same collision one level down: the department is unambiguous, the model is not, and the "
      + "realized figure would be read off whichever row was written first.",
    baseline: referenceBaseline,
    observed: () => observedMonth({
      modelUsage: [
        usageRow({ model: "Vendor-Large-2026", spendMinor: 12_000 }),
        usageRow({ model: "vendor large 2026", spendMinor: 24_000 }),
      ],
    }),
    expected: Object.freeze({
      status: "unavailable",
      reason: "ambiguous_observation",
      scope: "model",
      identifier: "vendor-large-2026",
      matchCount: 2,
    }),
  }),
]);
