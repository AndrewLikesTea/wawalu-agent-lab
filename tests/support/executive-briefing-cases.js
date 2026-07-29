// Labelled fixtures for executive briefing-ready records.
//
// One case per state a presentation consumer has to render differently. Each
// case is `{ id, label, why, periods, expected }`, where `expected` is the
// *claims projection* of the briefing — the primary metric, the confidence, the
// provenance, the limitation codes, the prioritized action, and the selection
// tie-break — pinned as literals so a reviewer can check a number by reading it
// rather than by re-running the arithmetic in their head.
//
// The inputs are generated here rather than committed as JSON: they are three
// or four aggregate records apiece, and a builder that states only what a case
// varies is the thing a disputed number gets read against.
//
// WHY THE FIGURES ARE THE FIGURES
// -------------------------------
// Every period analyzes 4,000,000 usd_minor, so a recoverable scenario of `r`
// has a share of exactly `r / 4` ppm and no rounding step hides in any case.
// Where a case moves a number, it moves exactly one, and the case's `why` names
// which slot that move is supposed to change.
//
// NOTHING HERE IS IMPORTED. Org unit ids use the `syn-` synthetic convention,
// fingerprints are literals, and no case carries a prompt, a source row, a file
// name, a credential, or a provider payload. The redaction suite asserts that,
// rather than trusting this comment.

/** The shared retained period. Analyzed spend is fixed so shares stay exact. */
export const BASE_PERIOD = Object.freeze({
  period: "2026-06",
  dataset: "user",
  briefingContractVersion: "finops-briefing/1.0.0",
  derivedAt: "2026-07-02T09:14:00Z",
  sourceFingerprint: "c1daf8d2",
  analyzedSpendMinor: 4_000_000,
  attributedSpendMinor: 3_800_000,
  recoverableScenarioMinor: 480_000,
  recordsTotal: 1600,
  recordsAnalyzed: 1536,
  coverageRatioPpm: 960_000,
  confidence: "high",
  missingInputs: [],
  materialMetricId: "recoverable_scenario",
  materialMetricMinor: 480_000,
  topDepartmentId: "syn-support-triage",
});

/** A retained period. `periodId` is `dataset:period` unless a case pins its own. */
export function retained(overrides = {}) {
  const period = overrides.period ?? BASE_PERIOD.period;
  const dataset = overrides.dataset ?? BASE_PERIOD.dataset;
  return { ...BASE_PERIOD, period, dataset, periodId: `${dataset}:${period}`, ...overrides };
}

/**
 * Three gapless months ending at the reporting period, priors at 115,000 and
 * 120,000 ppm. Their mean — 117,500 ppm — is the baseline every benchmarked case
 * below is measured against, and it is an integer, so no case depends on how the
 * mean rounds.
 */
export function gaplessHistory(reportingOverrides = {}, priorOverrides = {}) {
  return [
    retained({
      period: "2026-04",
      derivedAt: "2026-05-02T09:00:00Z",
      recoverableScenarioMinor: 460_000,
      ...priorOverrides,
    }),
    retained({ period: "2026-05", derivedAt: "2026-06-02T09:00:00Z" }),
    retained({ period: "2026-06", ...reportingOverrides }),
  ];
}

/** The five limitations that ship with every briefing, in the order they ship. */
export const ALWAYS_ON_LIMITATIONS = Object.freeze([
  "scenario_not_realized_saving",
  "browser_local_derived_only",
  "no_shareable_link",
  "usd_only",
  "no_peer_cohort",
]);

const BENCHMARKED = Object.freeze({
  eligible: true,
  reason: null,
  baselineSharePpm: 117_500,
  priorPeriods: ["2026-04", "2026-05"],
  priorPeriodCount: 2,
});

const USER_PROVENANCE = Object.freeze({
  dataset: "user",
  sourceFingerprint: "c1daf8d2",
  periodIds: ["user:2026-04", "user:2026-05", "user:2026-06"],
  retainedPeriodCount: 3,
  recordsAnalyzed: 1536,
  recordsTotal: 1600,
});

/**
 * The labelled set. `grade` is the eligibility verdict a reader is being shown:
 * `eligible` when a retained period founds the finding, `ineligible` when none
 * does. It is the same predicate `buildExecutiveBriefing` applies; it is named
 * here so the set can be read as coverage of both verdicts rather than as a pile
 * of inputs.
 */
export const EXECUTIVE_BRIEFING_CASES = Object.freeze([
  {
    id: "eligible-benchmarked-in-line",
    label: "Eligible grade, benchmark eligible, variance inside the material band",
    grade: "eligible",
    why: "The canonical readable state: one org unit, one figure, one capped pilot.",
    periods: gaplessHistory(),
    expected: {
      reportingPeriod: { periodId: "user:2026-06", period: "2026-06", dataset: "user" },
      recoverable: { valueMinor: 480_000, sharePpm: 120_000, analyzedSpendMinor: 4_000_000 },
      benchmark: { ...BENCHMARKED, varianceSharePpm: 2_500, standing: "in_line_with_baseline" },
      primaryFinding: "syn-support-triage",
      nextAction: {
        id: "pilot_routing", accountableRole: "Platform Engineering Lead", capMinor: 480_000,
      },
      confidence: { level: "high", periodConfidence: "high", ceiling: null, ceilingReason: null },
      provenance: USER_PROVENANCE,
      limitations: [...ALWAYS_ON_LIMITATIONS],
      selection: { tieBreakApplied: "period_descending", candidateCount: 3 },
      absent: {},
    },
  },
  {
    id: "eligible-benchmark-less-verify",
    label: "Eligible grade, standing below the baseline, rank-2 action",
    grade: "eligible",
    why: "A smaller recoverable pool than this workspace's own trailing baseline is the "
      + "one state that asks a leader to verify the last change before opening another.",
    periods: gaplessHistory({ recoverableScenarioMinor: 200_000 }),
    expected: {
      reportingPeriod: { periodId: "user:2026-06", period: "2026-06", dataset: "user" },
      recoverable: { valueMinor: 200_000, sharePpm: 50_000, analyzedSpendMinor: 4_000_000 },
      benchmark: { ...BENCHMARKED, varianceSharePpm: -67_500, standing: "less_recoverable_than_baseline" },
      primaryFinding: "syn-support-triage",
      nextAction: {
        id: "verify_prior_change", accountableRole: "Platform Engineering Lead", capMinor: null,
      },
      confidence: { level: "high", periodConfidence: "high", ceiling: null, ceilingReason: null },
      provenance: USER_PROVENANCE,
      limitations: [...ALWAYS_ON_LIMITATIONS],
      selection: { tieBreakApplied: "period_descending", candidateCount: 3 },
      absent: {},
    },
  },
  {
    id: "low-confidence-missing-inputs",
    label: "Low-confidence finding: the period's own confidence is low",
    grade: "eligible",
    why: "Confidence is read off the retained period, never recomputed here, and a low "
      + "one drives the rank-1 action however healthy the benchmark looks.",
    periods: gaplessHistory({ confidence: "low", missingInputs: ["provider_completeness"] }),
    expected: {
      reportingPeriod: { periodId: "user:2026-06", period: "2026-06", dataset: "user" },
      recoverable: { valueMinor: 480_000, sharePpm: 120_000, analyzedSpendMinor: 4_000_000 },
      benchmark: { ...BENCHMARKED, varianceSharePpm: 2_500, standing: "in_line_with_baseline" },
      primaryFinding: "syn-support-triage",
      nextAction: {
        id: "improve_attribution", accountableRole: "FinOps Data Owner", capMinor: null,
      },
      confidence: { level: "low", periodConfidence: "low", ceiling: null, ceilingReason: null },
      provenance: USER_PROVENANCE,
      limitations: [...ALWAYS_ON_LIMITATIONS, "missing_inputs"],
      selection: { tieBreakApplied: "period_descending", candidateCount: 3 },
      absent: {},
    },
  },
  {
    id: "low-confidence-attribution-below-floor",
    label: "Low-confidence finding: under half the analyzed spend reaches an org unit",
    grade: "eligible",
    why: "Attribution depth and coverage are different weaknesses; this case pins the one "
      + "that fires the rank-1 action without the period ever saying `low`.",
    periods: gaplessHistory({
      attributedSpendMinor: 1_600_000, coverageRatioPpm: 720_000, confidence: "moderate",
    }),
    expected: {
      reportingPeriod: { periodId: "user:2026-06", period: "2026-06", dataset: "user" },
      recoverable: { valueMinor: 480_000, sharePpm: 120_000, analyzedSpendMinor: 4_000_000 },
      benchmark: { ...BENCHMARKED, varianceSharePpm: 2_500, standing: "in_line_with_baseline" },
      primaryFinding: "syn-support-triage",
      nextAction: {
        id: "improve_attribution", accountableRole: "FinOps Data Owner", capMinor: null,
      },
      confidence: {
        level: "moderate", periodConfidence: "moderate", ceiling: null, ceilingReason: null,
      },
      provenance: USER_PROVENANCE,
      limitations: [...ALWAYS_ON_LIMITATIONS, "partial_coverage"],
      selection: { tieBreakApplied: "period_descending", candidateCount: 3 },
      absent: {},
    },
  },
  {
    id: "action-rank-tie-all-preconditions",
    label: "Tied action ranking: every precondition in the catalog holds at once",
    grade: "eligible",
    why: "Low period confidence, a standing below the baseline, and a positive scenario "
      + "with a named org unit all hold, so all three catalog entries qualify and the "
      + "lowest rank must win deterministically.",
    periods: gaplessHistory({ recoverableScenarioMinor: 200_000, confidence: "low" }),
    expected: {
      reportingPeriod: { periodId: "user:2026-06", period: "2026-06", dataset: "user" },
      recoverable: { valueMinor: 200_000, sharePpm: 50_000, analyzedSpendMinor: 4_000_000 },
      benchmark: { ...BENCHMARKED, varianceSharePpm: -67_500, standing: "less_recoverable_than_baseline" },
      primaryFinding: "syn-support-triage",
      nextAction: {
        id: "improve_attribution", accountableRole: "FinOps Data Owner", capMinor: null,
      },
      confidence: { level: "low", periodConfidence: "low", ceiling: null, ceilingReason: null },
      provenance: USER_PROVENANCE,
      limitations: [...ALWAYS_ON_LIMITATIONS],
      selection: { tieBreakApplied: "period_descending", candidateCount: 3 },
      absent: {},
    },
  },
  {
    id: "benchmark-unavailable-insufficient-history",
    label: "Benchmark unavailable: fewer than three retained periods",
    grade: "eligible",
    why: "The figure still ships; the comparison does not, and the confidence ceiling "
      + "says so rather than leaving a reader to infer it.",
    periods: [
      retained({ period: "2026-05", derivedAt: "2026-06-02T09:00:00Z" }),
      retained({ period: "2026-06" }),
    ],
    expected: {
      reportingPeriod: { periodId: "user:2026-06", period: "2026-06", dataset: "user" },
      recoverable: { valueMinor: 480_000, sharePpm: 120_000, analyzedSpendMinor: 4_000_000 },
      benchmark: {
        eligible: false,
        reason: "insufficient_history",
        baselineSharePpm: null,
        varianceSharePpm: null,
        standing: null,
        priorPeriods: ["2026-05"],
        priorPeriodCount: 1,
      },
      primaryFinding: "syn-support-triage",
      nextAction: {
        id: "pilot_routing", accountableRole: "Platform Engineering Lead", capMinor: 480_000,
      },
      confidence: {
        level: "moderate",
        periodConfidence: "high",
        ceiling: "moderate",
        ceilingReason: "benchmark_ineligible",
      },
      provenance: {
        ...USER_PROVENANCE, periodIds: ["user:2026-05", "user:2026-06"], retainedPeriodCount: 2,
      },
      limitations: [...ALWAYS_ON_LIMITATIONS, "benchmark_unavailable"],
      selection: { tieBreakApplied: "period_descending", candidateCount: 2 },
      absent: {},
    },
  },
  {
    id: "benchmark-unavailable-period-gap",
    label: "Benchmark unavailable: a month is missing from the sequence",
    grade: "eligible",
    why: "A gapless sequence is a precondition, not a preference: averaging across a "
      + "missing month would compare the reporting period to a history nobody has.",
    periods: [
      retained({ period: "2026-03", derivedAt: "2026-04-02T09:00:00Z" }),
      retained({ period: "2026-05", derivedAt: "2026-06-02T09:00:00Z" }),
      retained({ period: "2026-06" }),
    ],
    expected: {
      reportingPeriod: { periodId: "user:2026-06", period: "2026-06", dataset: "user" },
      recoverable: { valueMinor: 480_000, sharePpm: 120_000, analyzedSpendMinor: 4_000_000 },
      benchmark: {
        eligible: false,
        reason: "period_gap",
        baselineSharePpm: null,
        varianceSharePpm: null,
        standing: null,
        priorPeriods: ["2026-03", "2026-05"],
        priorPeriodCount: 2,
      },
      primaryFinding: "syn-support-triage",
      nextAction: {
        id: "pilot_routing", accountableRole: "Platform Engineering Lead", capMinor: 480_000,
      },
      confidence: {
        level: "moderate",
        periodConfidence: "high",
        ceiling: "moderate",
        ceilingReason: "benchmark_ineligible",
      },
      provenance: {
        ...USER_PROVENANCE, periodIds: ["user:2026-03", "user:2026-05", "user:2026-06"],
      },
      limitations: [...ALWAYS_ON_LIMITATIONS, "benchmark_unavailable"],
      selection: { tieBreakApplied: "period_descending", candidateCount: 3 },
      absent: {},
    },
  },
  {
    id: "benchmark-unavailable-null-spend",
    label: "Benchmark unavailable: a prior month recorded no analyzed spend",
    grade: "eligible",
    why: "A share nobody could compute is null, never zero, and one null prior "
      + "disqualifies the baseline instead of dragging it toward zero.",
    periods: gaplessHistory({}, {
      period: "2026-04",
      derivedAt: "2026-05-02T09:00:00Z",
      analyzedSpendMinor: 0,
      recoverableScenarioMinor: 0,
    }),
    expected: {
      reportingPeriod: { periodId: "user:2026-06", period: "2026-06", dataset: "user" },
      recoverable: { valueMinor: 480_000, sharePpm: 120_000, analyzedSpendMinor: 4_000_000 },
      benchmark: {
        eligible: false,
        reason: "null_spend",
        baselineSharePpm: null,
        varianceSharePpm: null,
        standing: null,
        priorPeriods: ["2026-04", "2026-05"],
        priorPeriodCount: 2,
      },
      primaryFinding: "syn-support-triage",
      nextAction: {
        id: "pilot_routing", accountableRole: "Platform Engineering Lead", capMinor: 480_000,
      },
      confidence: {
        level: "moderate",
        periodConfidence: "high",
        ceiling: "moderate",
        ceilingReason: "benchmark_ineligible",
      },
      provenance: USER_PROVENANCE,
      limitations: [...ALWAYS_ON_LIMITATIONS, "benchmark_unavailable"],
      selection: { tieBreakApplied: "period_descending", candidateCount: 2 },
      absent: {},
    },
  },
  {
    id: "example-dataset-mixed-history",
    label: "Eligible grade on the bundled example, with a user period excluded",
    grade: "eligible",
    why: "A demonstration may not evidence a decision, and example and imported periods "
      + "are never averaged together; both statements have to reach the reader.",
    periods: [
      retained({ period: "2026-03", derivedAt: "2026-04-02T09:00:00Z" }),
      retained({ period: "2026-04", dataset: "example", derivedAt: "2026-05-02T09:00:00Z", recoverableScenarioMinor: 460_000 }),
      retained({ period: "2026-05", dataset: "example", derivedAt: "2026-06-02T09:00:00Z" }),
      retained({ period: "2026-06", dataset: "example" }),
    ],
    expected: {
      reportingPeriod: { periodId: "example:2026-06", period: "2026-06", dataset: "example" },
      recoverable: { valueMinor: 480_000, sharePpm: 120_000, analyzedSpendMinor: 4_000_000 },
      benchmark: {
        ...BENCHMARKED, varianceSharePpm: 2_500, standing: "in_line_with_baseline",
      },
      primaryFinding: "syn-support-triage",
      nextAction: {
        id: "pilot_routing", accountableRole: "Platform Engineering Lead", capMinor: 480_000,
      },
      confidence: {
        level: "low",
        periodConfidence: "high",
        ceiling: "low",
        ceilingReason: "dataset_is_not_your_import",
      },
      provenance: {
        ...USER_PROVENANCE,
        dataset: "example",
        periodIds: ["example:2026-04", "example:2026-05", "example:2026-06"],
        retainedPeriodCount: 4,
      },
      limitations: [...ALWAYS_ON_LIMITATIONS, "example_dataset", "mixed_dataset_history"],
      selection: { tieBreakApplied: "period_descending", candidateCount: 4 },
      absent: {},
    },
  },
  {
    id: "tied-period-selection",
    label: "Tied selection: one month derived twice, identical in every ordered field",
    grade: "eligible",
    why: "A re-imported corrected export is the ordinary way two records claim the same "
      + "month. The last tie-break is `periodId` ascending, and it is unique, so the "
      + "order is total and the winner does not depend on arrival order.",
    periods: [
      { ...retained(), periodId: "user:2026-06#b" },
      { ...retained(), periodId: "user:2026-06#a" },
    ],
    expected: {
      reportingPeriod: { periodId: "user:2026-06#a", period: "2026-06", dataset: "user" },
      recoverable: { valueMinor: 480_000, sharePpm: 120_000, analyzedSpendMinor: 4_000_000 },
      benchmark: {
        eligible: false,
        reason: "insufficient_history",
        baselineSharePpm: null,
        varianceSharePpm: null,
        standing: null,
        priorPeriods: [],
        priorPeriodCount: 0,
      },
      primaryFinding: "syn-support-triage",
      nextAction: {
        id: "pilot_routing", accountableRole: "Platform Engineering Lead", capMinor: 480_000,
      },
      confidence: {
        level: "moderate",
        periodConfidence: "high",
        ceiling: "moderate",
        ceilingReason: "benchmark_ineligible",
      },
      provenance: {
        ...USER_PROVENANCE, periodIds: ["user:2026-06#a"], retainedPeriodCount: 2,
      },
      limitations: [...ALWAYS_ON_LIMITATIONS, "benchmark_unavailable"],
      selection: { tieBreakApplied: "period_id_ascending", candidateCount: 2 },
      absent: {},
    },
  },
  {
    id: "ineligible-no-period-can-found-a-finding",
    label: "Ineligible grade: retained periods exist, none can found a finding",
    grade: "ineligible",
    why: "An unnamed org unit and a zero scenario are different defects with the same "
      + "consequence, and the consequence is a stated absence, not a zero.",
    periods: [
      retained({ period: "2026-05", derivedAt: "2026-06-02T09:00:00Z", recoverableScenarioMinor: 0 }),
      retained({ period: "2026-06", topDepartmentId: "" }),
    ],
    expected: {
      reportingPeriod: null,
      recoverable: null,
      benchmark: null,
      primaryFinding: null,
      nextAction: null,
      confidence: {
        level: "insufficient", periodConfidence: null, ceiling: null, ceilingReason: null,
      },
      provenance: {
        dataset: null,
        sourceFingerprint: null,
        periodIds: [],
        retainedPeriodCount: 2,
        recordsAnalyzed: null,
        recordsTotal: null,
      },
      limitations: [...ALWAYS_ON_LIMITATIONS, "benchmark_unavailable"],
      selection: { tieBreakApplied: null, candidateCount: 0 },
      absent: {
        primaryFinding: "no_eligible_period",
        recoverable: "no_eligible_period",
        benchmark: "no_eligible_period",
        nextAction: "no_primary_finding",
      },
    },
  },
  {
    id: "ineligible-empty-workspace",
    label: "Ineligible grade: nothing has been retained at all",
    grade: "ineligible",
    why: "The first state every consumer renders. It must say what to do, not show a zero "
      + "that reads as a measured zero.",
    periods: [],
    expected: {
      reportingPeriod: null,
      recoverable: null,
      benchmark: null,
      primaryFinding: null,
      nextAction: null,
      confidence: {
        level: "insufficient", periodConfidence: null, ceiling: null, ceilingReason: null,
      },
      provenance: {
        dataset: null,
        sourceFingerprint: null,
        periodIds: [],
        retainedPeriodCount: 0,
        recordsAnalyzed: null,
        recordsTotal: null,
      },
      limitations: [...ALWAYS_ON_LIMITATIONS, "benchmark_unavailable"],
      selection: { tieBreakApplied: null, candidateCount: 0 },
      absent: {
        primaryFinding: "no_retained_periods",
        recoverable: "no_retained_periods",
        benchmark: "no_retained_periods",
        nextAction: "no_primary_finding",
      },
    },
  },
]);

/**
 * The claims projection: everything a presentation consumer binds to, and
 * nothing else. Pinning this rather than the whole briefing keeps a case
 * readable and keeps an unrelated wording change out of twelve expected blocks —
 * the wording itself is asserted against the module's own catalogs instead.
 */
export function briefingClaims(briefing) {
  const period = briefing.reportingPeriod;
  const benchmark = briefing.benchmark;
  const action = briefing.nextAction;
  return {
    reportingPeriod: period
      ? { periodId: period.periodId, period: period.period, dataset: period.dataset }
      : null,
    recoverable: briefing.recoverable
      ? {
        valueMinor: briefing.recoverable.valueMinor,
        sharePpm: briefing.recoverable.sharePpm,
        analyzedSpendMinor: briefing.recoverable.analyzedSpendMinor,
      }
      : null,
    benchmark: benchmark
      ? {
        eligible: benchmark.eligible,
        reason: benchmark.reason,
        baselineSharePpm: benchmark.baselineSharePpm,
        varianceSharePpm: benchmark.varianceSharePpm,
        standing: benchmark.standing,
        priorPeriods: [...benchmark.priorPeriods],
        priorPeriodCount: benchmark.priorPeriodCount,
      }
      : null,
    primaryFinding: briefing.primaryFinding ? briefing.primaryFinding.orgUnitId : null,
    nextAction: action
      ? { id: action.id, accountableRole: action.accountableRole, capMinor: action.capMinor }
      : null,
    confidence: {
      level: briefing.confidence.level,
      periodConfidence: briefing.confidence.periodConfidence ?? null,
      ceiling: briefing.confidence.ceiling,
      ceilingReason: briefing.confidence.ceilingReason,
    },
    provenance: {
      dataset: briefing.provenance.dataset,
      sourceFingerprint: briefing.provenance.sourceFingerprint,
      periodIds: [...briefing.provenance.periodIds],
      retainedPeriodCount: briefing.provenance.retainedPeriodCount,
      recordsAnalyzed: briefing.provenance.recordsAnalyzed,
      recordsTotal: briefing.provenance.recordsTotal,
    },
    limitations: briefing.limitations.map((entry) => entry.code),
    selection: {
      tieBreakApplied: briefing.selection.tieBreakApplied,
      candidateCount: briefing.selection.candidateCount,
    },
    absent: Object.fromEntries(
      Object.entries(briefing.absent).map(([slot, entry]) => [slot, entry.reason]),
    ),
  };
}
