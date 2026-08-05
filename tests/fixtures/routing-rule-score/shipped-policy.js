// A labelled fixture PAIR for scoring a shipped routing policy.
//
//   priorPolicy()      the 2026-07 analysis envelope the rules were registered
//                      from — four org units, each flagged by the down-routing
//                      rule with its own recoverable dollars.
//   followUpExport()   the 2026-08 per-org-unit cost series, as two period totals
//                      per unit.
//   commitmentRecord() the retained savings-commitment record, which is what says
//                      2026-07 is the prior period and 2026-08 the follow-up.
//
// Hand-checkable in under a minute — every verdict is one subtraction against one
// expected figure:
//
//   Atlas Platform    expects 400  ·  5,000 → 4,600  = 400 observed  ≥ 380  met
//   Boreal Systems    expects 200  ·  3,000 → 2,900  = 100 observed  <  190 partial
//   Cirrus Data       expects 160  ·  2,000 → 2,100  = -100 observed ≤   0  missed
//   Delta Research    expects 120  ·  no rows at all                   no evidence
//
// Every factory returns a fresh object, so a test may reorder or pollute one
// without leaking into the next.

/** Above the premium floor (2,000 minor per million), so a cheaper tier exists. */
const OBSERVED_MINOR_PER_MILLION = 3_000;

function department(name, recoverableUsd) {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    spendUsd: 0,
    trendAvailable: false,
    downRouting: {
      flagged: true,
      unitLabel: name,
      recoverableUsd,
      observedMinorPerMillionTokens: OBSERVED_MINOR_PER_MILLION,
      decisionReason: `${name} is priced above the premium floor with a positive delta.`,
      confidence: { level: "medium" },
      workedExample: [
        { step: "recoverable", expression: `${name} observed minus standard-tier reference`,
          value: `${recoverableUsd}.00 USD` },
      ],
    },
  };
}

/** The prior period's envelope. Per-unit candidates only: no model is named. */
export function priorPolicy() {
  return {
    period: "2026-07-01 to 2026-08-01",
    rankedDepartments: [
      department("Atlas Platform", 400),
      department("Boreal Systems", 200),
      department("Cirrus Data", 160),
      department("Delta Research", 120),
    ],
  };
}

/**
 * The following period's cost series, one entry per org unit.
 *
 * "Delta Research" is absent on purpose, and absent WHOLESALE rather than as a
 * zero row: the follow-up export simply carried nothing for that unit, which is
 * the coverage gap the fourth verdict exists to report.
 */
export function followUpExport() {
  return [
    { unit: "Atlas Platform", periods: [
      { period: "2026-07", total: 5_000 }, { period: "2026-08", total: 4_600 }] },
    { unit: "Boreal Systems", periods: [
      { period: "2026-07", total: 3_000 }, { period: "2026-08", total: 2_900 }] },
    { unit: "Cirrus Data", periods: [
      { period: "2026-07", total: 2_000 }, { period: "2026-08", total: 2_100 }] },
  ];
}

/** The retained commitment, valid against `validateMonthlyActionRecord`. */
export function commitmentRecord(overrides = {}) {
  return {
    schemaVersion: "monthly-department-action/1.0.0",
    decisionVersion: "monthly-department-decision/1.0.0",
    actionId: "down-route-premium-text",
    actionLabel: "Move premium-tier text generation to the standard tier",
    department: "Atlas Platform",
    ownerLabel: "Platform Engineering Lead",
    baseline: {
      value: 5_000, unit: "USD per month", period: "2026-07",
      aggregation: "sum", calculation: "Sum of the unit's provider spend in the period.",
    },
    target: {
      value: 4_600, unit: "USD per month", deadline: "2026-08-31",
      calculation: "Baseline minus the rule's recoverable dollars.",
    },
    reviewPeriod: "2026-08",
    confidence: "medium",
    provenanceReferences: ["local-finops:2026-07"],
    committedAt: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}
