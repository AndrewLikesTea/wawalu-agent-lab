// The published synthetic sample, carried in the bundle rather than fetched.
//
// WHY THIS IS A MODULE AND NOT A FILE THE PAGE READS
// --------------------------------------------------
// A leader who opens the executive briefing with nothing retained in this
// browser is the *common* first visit, not an edge case. Until now that visit
// paid for a second network round-trip before it could see anything: the page
// painted "reading this browser's own FinOps figures…", asked the origin for
// `executive-finops-briefing-fixture.json`, and only then drew a briefing — and
// a reader who was offline, behind a captive portal, or on a build that had
// dropped the file got an error state with no artifact on it at all.
//
// The periods below are the same three the published fixture declares under
// `input.retainedPeriods`, so the empty-state briefing is built by the shipped
// contract from the shipped inputs, in the same synchronous pass as the reader's
// own workspace path. Nothing is fetched, no clock is read, no random value is
// drawn: the same three periods produce the same briefing on every load, in
// every browser, forever.
//
// PARITY IS ENFORCED, NOT ASSUMED
// -------------------------------
// Duplicating data is only safe when a drift is loud. Two checks make it so:
// `tests/executive-briefing-local.test.js` asserts these periods deep-equal the
// fixture's own `input.retainedPeriods` and that the contract turns them into
// the fixture's published `briefing`, and `scripts/verify-build.mjs` repeats
// both against the built artifact. A change to one that is not made to the other
// fails the build rather than shipping two disagreeing samples.
//
// Nothing here is a measurement. Every org unit is a `syn-` slug, every figure
// is invented, and the surfaces that draw it say so on screen and on paper.

/** How the sample names itself wherever it could be mistaken for a measurement. */
export const SAMPLE_LABEL = "Synthetic sample";

/** The one sentence the first screen owes a reader before they read a figure. */
export const SAMPLE_DISCLOSURE =
  "Every figure below is invented to show the shape of this briefing. It is not a measurement of your "
  + "spend, not an import, and not anyone's customer data.";

/**
 * Where the sample's figures came from, stated at the level a reader reads them.
 * The fixture is named because a reader who wants the arithmetic can open it and
 * the contract side by side.
 */
export const SAMPLE_PROVENANCE_NOTE =
  "Rebuilt in this tab from the three synthetic periods this build ships, by the same contract that "
  + "builds a briefing from your own retained periods. No clock, no random value, no network request, "
  + "and no server took part. The same periods are published in "
  + "executive-finops-briefing-fixture.json so the arithmetic can be checked by hand.";

/**
 * Three gapless synthetic months of one workspace: a benchmark-eligible
 * reporting period (2026-06), the two priors its trailing baseline is taken
 * from, and the single next action they select.
 *
 * Verbatim — field for field — from the published fixture's `input`.
 */
export const SAMPLE_RETAINED_PERIODS = Object.freeze([
  Object.freeze({
    periodId: "user:2026-04",
    period: "2026-04",
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-05-02T09:00:00Z",
    sourceFingerprint: "a1b2c3d4",
    analyzedSpendMinor: 4000000,
    attributedSpendMinor: 3800000,
    recoverableScenarioMinor: 480000,
    recordsTotal: 1600,
    recordsAnalyzed: 1536,
    coverageRatioPpm: 960000,
    confidence: "high",
    missingInputs: Object.freeze([]),
    materialMetricId: "recoverable_scenario",
    materialMetricMinor: 480000,
    topDepartmentId: "syn-support-triage",
  }),
  Object.freeze({
    periodId: "user:2026-05",
    period: "2026-05",
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-06-02T09:00:00Z",
    sourceFingerprint: "b2c3d4e5",
    analyzedSpendMinor: 4400000,
    attributedSpendMinor: 4180000,
    recoverableScenarioMinor: 616000,
    recordsTotal: 1720,
    recordsAnalyzed: 1651,
    coverageRatioPpm: 960000,
    confidence: "high",
    missingInputs: Object.freeze([]),
    materialMetricId: "recoverable_scenario",
    materialMetricMinor: 616000,
    topDepartmentId: "syn-support-triage",
  }),
  Object.freeze({
    periodId: "user:2026-06",
    period: "2026-06",
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-07-02T09:14:00Z",
    sourceFingerprint: "c1daf8d2",
    analyzedSpendMinor: 4300000,
    attributedSpendMinor: 4085000,
    recoverableScenarioMinor: 612000,
    recordsTotal: 1840,
    recordsAnalyzed: 1766,
    coverageRatioPpm: 960000,
    confidence: "high",
    missingInputs: Object.freeze([]),
    materialMetricId: "recoverable_scenario",
    materialMetricMinor: 612000,
    topDepartmentId: "syn-support-triage",
  }),
]);

/**
 * A mutable copy, because the contract may sort, slice, or otherwise handle the
 * periods it is given and a frozen array is not a safe thing to hand a stranger.
 * Returns plain objects with the same values, never a shared reference.
 */
export function sampleRetainedPeriods() {
  return SAMPLE_RETAINED_PERIODS.map((entry) => ({ ...entry, missingInputs: [...entry.missingInputs] }));
}
