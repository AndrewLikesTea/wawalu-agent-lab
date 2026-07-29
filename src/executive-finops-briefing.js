// The executive FinOps briefing contract.
//
// THE THREE QUESTIONS, IN ORDER
// -----------------------------
// A CTO opens this artifact to answer three questions, and reads them in this
// order because each one is only worth asking if the one before it answered:
//
//   1. Where should we act first?
//   2. How much recoverable spend is indicated, relative to the benchmark?
//   3. What should happen next, on what evidence, and with what limits?
//
// Every slot below serves one of the three. A field that serves none does not
// have a slot here, however interesting it is.
//
// WHAT THIS MODULE IS
// -------------------
// Pure selection over records this browser already derived: retained FinOps
// workspace periods in, one briefing object out. No DOM, no storage, no fetch,
// no clock, no formatting. `{ valueMinor: 612000, currency: "USD" }` is the
// output; "$6,120.00" is a view decision and lives in the view layer.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
// * It does not recompute any money figure. `recoverableScenarioMinor`,
//   `analyzedSpendMinor`, `confidence`, and `topDepartmentId` are read off the
//   retained period exactly as `finops-briefing-contract.js` selected them and
//   `finops-workspace.js` stored them. A second source of truth for the same
//   number is how two surfaces show a leader two different "the" figures.
// * It does not read a raw import, a provider export, a prompt, a file, or a
//   credential. It cannot: a retained period holds aggregates only.
// * It does not invent a peer cohort. The benchmark is this workspace's own
//   trailing history, because that is the only comparison the browser holds.
// * It does not produce a second headline figure, a chart series, a per-record
//   table, or a per-department breakdown. Those answer other questions.
// * It does not render, print, export, or share. It declares what a printed or
//   exported artifact must carry (`PRESENTATION_REQUIREMENTS`) and stops.

import {
  ACCOUNTABLE_ROLE, BRIEFING_CONFIDENCE, CONTRACT_VERSION as BRIEFING_CONTRACT_VERSION,
} from "./finops-briefing-contract.js";
import { ATTRIBUTION_RANKED_FINDING_FLOOR } from "./finops-attribution-policy.js";
import {
  BENCHMARK_INELIGIBILITY_REASONS, MINIMUM_BENCHMARK_PERIODS,
} from "./longitudinal-finops-metrics.js";
import { scanRetainedContent } from "./finops-workspace.js";

/** Bump when any slot's meaning, any enum value, or any threshold below changes. */
export const EXECUTIVE_BRIEFING_VERSION = "executive-finops-briefing/1.0.0";

/**
 * The questions, in the order a leader asks them, each bound to the slot that
 * answers it. Emitted with the briefing so a consumer orders the artifact from
 * the contract rather than from a designer's memory of it.
 */
export const BRIEFING_QUESTIONS = Object.freeze([
  Object.freeze({
    order: 1,
    id: "act_first",
    question: "Where should we act first?",
    answeredBy: "primaryFinding",
  }),
  Object.freeze({
    order: 2,
    id: "recoverable_vs_benchmark",
    question: "How much recoverable spend is indicated, relative to the benchmark?",
    answeredBy: "recoverable, benchmark",
  }),
  Object.freeze({
    order: 3,
    id: "next_on_what_evidence",
    question: "What should happen next, on what evidence, and with what limits?",
    answeredBy: "nextAction, confidence, provenance, method, limitations",
  }),
]);

/* ------------------------------- arithmetic -------------------------------- */

/** Parts per million. A share is an integer here so two engineers never round it apart. */
export const PPM = 1_000_000;

/**
 * Round half away from zero. `Math.round` breaks halves toward positive
 * infinity, so a rise and a fall of the same magnitude would round to different
 * magnitudes. This is the single rounding rule for every number below.
 */
export function roundHalfAwayFromZero(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(Math.abs(value));
  return value < 0 ? -rounded : rounded;
}

/**
 * `recoverable_share_ppm = round(recoverable_scenario_minor ÷ analyzed_spend_minor × 1e6)`.
 *
 * Null — never zero — when the denominator is absent or not positive. A share
 * nobody could compute and a measured share of zero are different claims, and
 * only one of them may be compared against a benchmark.
 */
export function recoverableSharePpm(recoverableMinor, analyzedMinor) {
  if (!Number.isFinite(recoverableMinor) || !Number.isFinite(analyzedMinor)) return null;
  if (!(analyzedMinor > 0)) return null;
  return roundHalfAwayFromZero((recoverableMinor / analyzedMinor) * PPM);
}

/** The calendar month after `YYYY-MM`, so a gap in a history is detected exactly. */
function nextPeriodLabel(label) {
  const [year, month] = String(label).split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

const PERIOD_LABEL = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/* ------------------------------- absence ----------------------------------- */

/**
 * Why a slot is absent. A slot is computed from the retained aggregates or it is
 * absent with one of these codes and its authored sentence — never a blank, and
 * never a zero standing in for a number nobody has.
 */
export const EXECUTIVE_ABSENCE_REASON = Object.freeze({
  noRetainedPeriods: "no_retained_periods",
  noEligiblePeriod: "no_eligible_period",
  noAnalyzedSpend: "no_analyzed_spend",
  noRecoverableScenario: "no_recoverable_scenario",
  noOrgUnitRanked: "no_org_unit_ranked",
  noPrimaryFinding: "no_primary_finding",
});

export const EXECUTIVE_ABSENCE_STATEMENT = Object.freeze({
  [EXECUTIVE_ABSENCE_REASON.noRetainedPeriods]:
    "This workspace has retained no derived period, so there is nothing to brief on. "
    + "Analyze a provider export and retain the derived period to produce one.",
  [EXECUTIVE_ABSENCE_REASON.noEligiblePeriod]:
    "No retained period carries a recoverable-spend scenario that can found a finding, "
    + "so no org unit can be named to act on first.",
  [EXECUTIVE_ABSENCE_REASON.noAnalyzedSpend]:
    "The selected period recorded no analyzed spend, so a recoverable share cannot be computed "
    + "and no figure is shown.",
  [EXECUTIVE_ABSENCE_REASON.noRecoverableScenario]:
    "The selected period recorded no recoverable-spend scenario, so there is no figure to size an action.",
  [EXECUTIVE_ABSENCE_REASON.noOrgUnitRanked]:
    "The selected period ranked no org unit, so a finding cannot name where to act first.",
  [EXECUTIVE_ABSENCE_REASON.noPrimaryFinding]:
    "Without a primary finding there is nothing for a next action to act on, so none is recommended.",
});

/* --------------------------- period selection ------------------------------ */

/**
 * Why a retained period cannot found the primary finding. Checked in this order;
 * the first failing predicate names the reason, so an ineligible period always
 * reports the same code whatever else is also wrong with it.
 */
export const PERIOD_INELIGIBILITY_REASON = Object.freeze([
  "malformed_record",
  "absence_recorded",
  "no_analyzed_spend",
  "no_recoverable_scenario",
  "no_org_unit_ranked",
  "confidence_insufficient",
]);

function periodIneligibility(period) {
  if (!period || typeof period !== "object" || Array.isArray(period)) return "malformed_record";
  if (typeof period.periodId !== "string" || !period.periodId) return "malformed_record";
  if (!PERIOD_LABEL.test(String(period.period))) return "malformed_record";
  if (period.absenceReason) return "absence_recorded";
  if (!Number.isFinite(period.analyzedSpendMinor) || period.analyzedSpendMinor <= 0) {
    return "no_analyzed_spend";
  }
  if (!Number.isFinite(period.recoverableScenarioMinor) || period.recoverableScenarioMinor <= 0) {
    return "no_recoverable_scenario";
  }
  if (typeof period.topDepartmentId !== "string" || !period.topDepartmentId) {
    return "no_org_unit_ranked";
  }
  if (period.confidence === BRIEFING_CONFIDENCE.insufficient) return "confidence_insufficient";
  return null;
}

/**
 * The total order that picks exactly one reporting period.
 *
 * Applied in sequence; the first non-zero comparison wins:
 *
 *   1. period label descending — the newest evidence, because a leader acts on
 *      the current month and not on the largest month ever recorded;
 *   2. then `recoverableScenarioMinor` descending — the larger opportunity;
 *   3. then `recordsAnalyzed` descending — the better-covered derivation;
 *   4. then `derivedAt` descending as an ISO-8601 string — the later derivation;
 *   5. then `periodId` ascending, which is unique per retained period and
 *      therefore makes the order total.
 *
 * Steps 2–5 are reachable when the same month was derived more than once (a
 * re-import of a corrected export). They are implemented rather than described
 * because an unimplemented tie-break is a coin flip.
 */
export const PRIMARY_SELECTION_RULE = Object.freeze([
  "Eligible retained periods are ordered by period label descending.",
  "Ties break by recoverableScenarioMinor descending.",
  "Then by recordsAnalyzed descending.",
  "Then by derivedAt descending, compared as an ISO-8601 string.",
  "Then by periodId ascending, which is unique per retained period and makes the order total.",
  "The first entry is the reporting period, and its topDepartmentId is the primary finding.",
]);

export function compareCandidatePeriods(left, right) {
  return String(right.period).localeCompare(String(left.period))
    || (right.recoverableScenarioMinor - left.recoverableScenarioMinor)
    || ((right.recordsAnalyzed ?? 0) - (left.recordsAnalyzed ?? 0))
    || String(right.derivedAt ?? "").localeCompare(String(left.derivedAt ?? ""))
    || String(left.periodId).localeCompare(String(right.periodId));
}

/**
 * Exactly one reporting period, or the reason there is none.
 *
 * @returns `{ chosen, reason, tieBreakApplied }` where `tieBreakApplied` names
 *   the first comparison step that actually decided between the winner and the
 *   runner-up, so an artifact can state why this period and not that one.
 */
export function selectReportingPeriod(periods) {
  const list = Array.isArray(periods) ? periods : [];
  if (!list.length) {
    return { chosen: null, reason: EXECUTIVE_ABSENCE_REASON.noRetainedPeriods, tieBreakApplied: null };
  }
  const eligible = list.filter((period) => periodIneligibility(period) === null);
  if (!eligible.length) {
    return { chosen: null, reason: EXECUTIVE_ABSENCE_REASON.noEligiblePeriod, tieBreakApplied: null };
  }
  const ordered = [...eligible].sort(compareCandidatePeriods);
  const [chosen, runnerUp] = ordered;
  let tieBreakApplied = "period_descending";
  if (runnerUp) {
    if (String(runnerUp.period) === String(chosen.period)) {
      tieBreakApplied = runnerUp.recoverableScenarioMinor !== chosen.recoverableScenarioMinor
        ? "recoverable_scenario_descending"
        : (runnerUp.recordsAnalyzed ?? 0) !== (chosen.recordsAnalyzed ?? 0)
          ? "records_analyzed_descending"
          : String(runnerUp.derivedAt ?? "") !== String(chosen.derivedAt ?? "")
            ? "derived_at_descending"
            : "period_id_ascending";
    }
  } else {
    tieBreakApplied = "sole_candidate";
  }
  return { chosen, reason: null, tieBreakApplied };
}

/* -------------------------------- benchmark -------------------------------- */

/**
 * The benchmark is this workspace's own trailing baseline: the mean recoverable
 * share of every retained period *before* the reporting period, in the same
 * dataset. No peer or industry cohort is invented, because nothing this browser
 * holds contains one, and a percentile against a cohort nobody supplied is a
 * guess with a rank painted on it.
 *
 * The comparison is on *share*, not on dollars: the money figure sizes the
 * action, and a share is the only form of it that is comparable across months of
 * different size.
 */
export const BENCHMARK_KIND = "own_trailing_baseline";

/**
 * A variance smaller than this reads as noise, not as a move. One percentage
 * point of recoverable share, expressed in ppm.
 */
export const BENCHMARK_MATERIAL_VARIANCE_PPM = 10_000;

/**
 * Where the reporting period sits against its own baseline. Named without a
 * good/bad polarity: more recoverable spend is a larger opportunity and a worse
 * outcome at the same time, and a briefing that picked one reading for the
 * reader would be arguing rather than reporting.
 */
export const BENCHMARK_STANDING = Object.freeze({
  more: "more_recoverable_than_baseline",
  inLine: "in_line_with_baseline",
  less: "less_recoverable_than_baseline",
});

export const BENCHMARK_RULE = Object.freeze([
  "Prior periods are the retained periods of the reporting period's own dataset whose period label "
  + "sorts strictly before it. Another dataset's periods are never averaged in.",
  `The benchmark is eligible only when the reporting period and its priors number at least `
  + `${MINIMUM_BENCHMARK_PERIODS}, their labels form a gapless consecutive calendar-month sequence `
  + `ending at the reporting period, and every one carries a positive analyzedSpendMinor and a finite `
  + `recoverableScenarioMinor.`,
  "baselineSharePpm is the mean of the prior periods' recoverableSharePpm, rounded half away from "
  + "zero to whole ppm.",
  "varianceSharePpm = reportingSharePpm − baselineSharePpm.",
  `Standing is in_line_with_baseline when |varianceSharePpm| <= ${BENCHMARK_MATERIAL_VARIANCE_PPM}, `
  + `otherwise more_recoverable_than_baseline or less_recoverable_than_baseline by the sign.`,
]);

function priorPeriodsFor(periods, reporting) {
  return periods
    .filter((period) => period
      && period.dataset === reporting.dataset
      && PERIOD_LABEL.test(String(period.period))
      && String(period.period) < String(reporting.period))
    .sort((left, right) => String(left.period).localeCompare(String(right.period)));
}

/**
 * The benchmark comparison, or the reason there is none.
 *
 * Ineligibility reasons come from `longitudinal-finops-metrics.js` rather than
 * being redeclared here: one vocabulary for "this history cannot support a
 * baseline", checked in the order that module publishes.
 */
export function buildBenchmark(reporting, priors, reportingSharePpm) {
  const ineligible = (reason) => Object.freeze({
    kind: BENCHMARK_KIND,
    eligible: false,
    reason,
    baselineSharePpm: null,
    varianceSharePpm: null,
    standing: null,
    priorPeriodCount: priors.length,
    priorPeriods: Object.freeze(priors.map((period) => period.period)),
  });

  if (priors.length + 1 < MINIMUM_BENCHMARK_PERIODS) {
    return ineligible(BENCHMARK_INELIGIBILITY_REASONS[0]);
  }
  const labels = [...priors.map((period) => period.period), reporting.period];
  for (let index = 1; index < labels.length; index += 1) {
    if (nextPeriodLabel(labels[index - 1]) !== labels[index]) {
      return ineligible(BENCHMARK_INELIGIBILITY_REASONS[1]);
    }
  }
  const shares = priors.map((period) => recoverableSharePpm(
    period.recoverableScenarioMinor, period.analyzedSpendMinor,
  ));
  if (reportingSharePpm === null || shares.some((share) => share === null)) {
    return ineligible(BENCHMARK_INELIGIBILITY_REASONS[2]);
  }
  const baselineSharePpm = roundHalfAwayFromZero(
    shares.reduce((total, share) => total + share, 0) / shares.length,
  );
  const varianceSharePpm = reportingSharePpm - baselineSharePpm;
  const standing = Math.abs(varianceSharePpm) <= BENCHMARK_MATERIAL_VARIANCE_PPM
    ? BENCHMARK_STANDING.inLine
    : varianceSharePpm > 0 ? BENCHMARK_STANDING.more : BENCHMARK_STANDING.less;
  return Object.freeze({
    kind: BENCHMARK_KIND,
    eligible: true,
    reason: null,
    baselineSharePpm,
    varianceSharePpm,
    standing,
    priorPeriodCount: priors.length,
    priorPeriods: Object.freeze(priors.map((period) => period.period)),
  });
}

/* ------------------------------- next action ------------------------------- */

/**
 * The closed catalog of next actions. One is selected by ascending `rank`, first
 * precondition that holds. There is no free-typed action: an executive artifact
 * that can say anything is an artifact nobody can test.
 *
 * Each carries the role accountable for it — a role, never a person. This
 * briefing is built in a browser that holds no roster, and a named individual in
 * an executive artifact is an identifier, not a decision.
 */
export const NEXT_ACTION = Object.freeze([
  Object.freeze({
    id: "improve_attribution",
    rank: 1,
    accountableRole: ACCOUNTABLE_ROLE.data_quality,
    precondition:
      "The reporting period's own confidence is low or insufficient, it lists a missing required "
      + `input, or under ${Math.round(ATTRIBUTION_RANKED_FINDING_FLOOR * 100)}% of its analyzed spend `
      + "was attributed to an org unit.",
    statement:
      "Close the attribution gap before committing to a routing change: too little of this period's "
      + "spend reaches a named org unit for the figure to carry a decision.",
    capped: false,
  }),
  Object.freeze({
    id: "verify_prior_change",
    rank: 2,
    accountableRole: ACCOUNTABLE_ROLE.routing_pilot,
    precondition:
      "The benchmark is eligible and the reporting period stands less_recoverable_than_baseline.",
    statement:
      "Verify the previously committed routing change held over a like-for-like period before opening "
      + "a new pilot: the recoverable pool is smaller than this workspace's own trailing baseline.",
    capped: false,
  }),
  Object.freeze({
    id: "pilot_routing",
    rank: 3,
    accountableRole: ACCOUNTABLE_ROLE.routing_pilot,
    precondition:
      "A primary finding names an org unit and the reporting period's recoverable scenario is positive.",
    statement:
      "Pilot lower-cost routing in the named org unit, capped at the recoverable scenario for the "
      + "reporting period, and verify against a like-for-like period before extending it.",
    capped: true,
  }),
]);

const NEXT_ACTION_BY_ID = Object.freeze(Object.fromEntries(
  NEXT_ACTION.map((action) => [action.id, action]),
));

function attributionBelowFloor(period) {
  const analyzed = Number(period.analyzedSpendMinor);
  const attributed = Number(period.attributedSpendMinor);
  if (!Number.isFinite(attributed) || !(analyzed > 0)) return true;
  return attributed / analyzed < ATTRIBUTION_RANKED_FINDING_FLOOR;
}

/** The one action, chosen by the catalog's own precedence. Never more than one. */
export function selectNextAction(period, benchmark) {
  const weakConfidence = period.confidence === BRIEFING_CONFIDENCE.low
    || period.confidence === BRIEFING_CONFIDENCE.insufficient;
  const missingInputs = Array.isArray(period.missingInputs) ? period.missingInputs : [];
  if (weakConfidence || missingInputs.length > 0 || attributionBelowFloor(period)) {
    return NEXT_ACTION_BY_ID.improve_attribution;
  }
  if (benchmark.eligible && benchmark.standing === BENCHMARK_STANDING.less) {
    return NEXT_ACTION_BY_ID.verify_prior_change;
  }
  return NEXT_ACTION_BY_ID.pilot_routing;
}

/* -------------------------------- confidence -------------------------------- */

/** Weakest to strongest; the index is the comparable rank. */
export const CONFIDENCE_LADDER = Object.freeze([
  BRIEFING_CONFIDENCE.insufficient,
  BRIEFING_CONFIDENCE.low,
  BRIEFING_CONFIDENCE.moderate,
  BRIEFING_CONFIDENCE.high,
]);

/**
 * What each level licenses a leader to do. Stated as permission rather than as a
 * score, because "moderate" answers nothing on its own.
 */
export const CONFIDENCE_MEANING = Object.freeze({
  [BRIEFING_CONFIDENCE.high]:
    "The figure and the org unit it names are supported well enough to open a capped pilot against them.",
  [BRIEFING_CONFIDENCE.moderate]:
    "The figure is supported well enough to prioritize investigation, not to commit a budget against.",
  [BRIEFING_CONFIDENCE.low]:
    "The figure indicates only where to look. Treat it as a prompt to improve the inputs, not as a finding.",
  [BRIEFING_CONFIDENCE.insufficient]:
    "Nothing here supports a decision. The briefing reports what is missing and stops.",
});

export const CONFIDENCE_RULE = Object.freeze([
  "Confidence is the weakest of the three levels below. It is never recomputed from records here.",
  "The reporting period's own coverage confidence, as computed by the briefing contract and stored "
  + "with the retained period.",
  "A ceiling of moderate when the benchmark is ineligible: a figure with nothing to compare against "
  + "cannot support a commitment.",
  "A ceiling of low when the dataset is not the reader's own import: a demonstration cannot evidence "
  + "a decision.",
]);

function weakest(...levels) {
  return levels.reduce((worst, level) => (
    CONFIDENCE_LADDER.indexOf(level) < CONFIDENCE_LADDER.indexOf(worst) ? level : worst
  ));
}

/* -------------------------------- limitations ------------------------------- */

/**
 * The closed limitation set. The always-on entries state what this artifact
 * structurally cannot claim; the conditional ones state what this particular
 * workspace could not support. Both ship, because a limitation a reader has to
 * infer is one they will not.
 */
export const LIMITATION = Object.freeze({
  scenarioNotRealized: "scenario_not_realized_saving",
  browserLocalOnly: "browser_local_derived_only",
  noShareableLink: "no_shareable_link",
  usdOnly: "usd_only",
  noPeerCohort: "no_peer_cohort",
  exampleDataset: "example_dataset",
  benchmarkUnavailable: "benchmark_unavailable",
  partialCoverage: "partial_coverage",
  mixedDatasetHistory: "mixed_dataset_history",
  missingInputs: "missing_inputs",
});

export const LIMITATION_STATEMENT = Object.freeze({
  [LIMITATION.scenarioNotRealized]:
    "The recoverable figure is a routing scenario, not a realized saving. Nothing here has been banked, "
    + "and no invoice has changed.",
  [LIMITATION.browserLocalOnly]:
    "This briefing was built in your browser from derived workspace records only. No import, prompt, "
    + "file, or credential was read, and nothing was uploaded.",
  [LIMITATION.noShareableLink]:
    "This briefing cannot produce a shareable link. There is no link form that could carry imported "
    + "records, and none is offered.",
  [LIMITATION.usdOnly]:
    "Every figure is USD. No exchange rate is applied, so a workspace holding another currency is not "
    + "comparable here.",
  [LIMITATION.noPeerCohort]:
    "The benchmark is this workspace's own trailing history. No peer, industry, or market cohort is "
    + "implied by any figure.",
  [LIMITATION.exampleDataset]:
    "This briefing was built from the bundled example dataset, not from your own import. The figures "
    + "demonstrate the arithmetic and evidence nothing about your spend.",
  [LIMITATION.benchmarkUnavailable]:
    "No benchmark could be computed, so the recoverable figure is reported without a comparison.",
  [LIMITATION.partialCoverage]:
    "Some records of the reporting period were set aside rather than analyzed, so the figure covers "
    + "less than the period it names.",
  [LIMITATION.mixedDatasetHistory]:
    "Retained periods from another dataset were excluded from the benchmark. Example and imported "
    + "periods are never averaged together.",
  [LIMITATION.missingInputs]:
    "The reporting period was derived without every required input, so at least one figure rests on "
    + "less than the contract asks for.",
});

/** Below this coverage ratio the briefing states that it covers less than the period it names. */
export const FULL_COVERAGE_PPM = 900_000;

/* --------------------------- progressive disclosure ------------------------- */

/**
 * Three levels, and no more. A leader reads level 1 and can act; level 2 is what
 * they ask about when challenged; level 3 is what an engineer reproduces the
 * figure from. Consumers render the levels in this order and may collapse 2 and
 * 3 — they may not promote a level-3 field into level 1, which is how an
 * executive artifact turns back into a dashboard.
 */
export const DISCLOSURE_LEVELS = Object.freeze([
  Object.freeze({
    level: 1,
    id: "headline",
    intent: "What to act on and how much is indicated.",
    fields: Object.freeze(["primaryFinding", "recoverable", "benchmark.standing", "nextAction"]),
    collapsible: false,
  }),
  Object.freeze({
    level: 2,
    id: "supporting",
    intent: "What the claim rests on and how far it may be trusted.",
    fields: Object.freeze([
      "benchmark", "confidence", "provenance", "limitations",
    ]),
    collapsible: true,
  }),
  Object.freeze({
    level: 3,
    id: "method",
    intent: "How to recompute every figure from the same retained records.",
    fields: Object.freeze(["method", "selection", "contractVersions"]),
    collapsible: true,
  }),
]);

/* ---------------------- print and export requirements ----------------------- */

/**
 * What a printed or exported artifact must carry. Declared here, consumed by the
 * presentation work that lands later, and embedded verbatim in the canonical
 * fixture so that work has one normative statement to build against.
 *
 * The rule that matters: the limitations and the provenance may be collapsed on
 * screen, but they may never be *absent* from a printed or exported artifact.
 * A briefing that leaves the room without them is a number with no caveat
 * attached, and a number with no caveat attached is what gets quoted in a board
 * deck six weeks later.
 */
export const PRESENTATION_REQUIREMENTS = Object.freeze({
  print: Object.freeze({
    pageSizes: Object.freeze(["A4", "Letter"]),
    orientation: "portrait",
    firstPageMustContain: Object.freeze([
      "primaryFinding", "recoverable", "benchmark", "nextAction", "confidence",
    ]),
    mustAppearSomewhere: Object.freeze(["limitations", "provenance", "method", "contractVersions"]),
    mustNotAppear: Object.freeze([
      "interactive controls", "navigation chrome", "collapsed detail that is hidden in print",
    ]),
    colorIsDecorative: true,
    notes:
      "Every disclosure level expands for print: a collapsed level-2 or level-3 section must render "
      + "expanded rather than be dropped. Standing is stated in words as well as by any color, because "
      + "a printed briefing is read in monochrome.",
  }),
  export: Object.freeze({
    mediaType: "application/json",
    fileNamePattern: "executive-finops-briefing-{period}.json",
    mustCarry: Object.freeze([
      "contractVersions", "provenance", "limitations", "method", "confidence",
    ]),
    mustNotCarry: Object.freeze([
      "imported records", "source rows", "file names", "prompts", "credentials",
      "shareable links", "network endpoints",
    ]),
    shareableLink: false,
    notes:
      "The exported object is the briefing verbatim plus nothing. An export that adds a figure the "
      + "screen did not show is a second source of truth for the same claim.",
  }),
});

/* ---------------------------------- safety ---------------------------------- */

export const SAFETY_STATEMENT =
  "This briefing operates only on derived FinOps workspace records held in this browser. It reads no "
  + "import, prompt, conversation, file, credential, or provider endpoint, and it cannot create a "
  + "shareable link containing imported records.";

// `readsCredentials` is deliberately not a field: a key whose name contains
// "credential" is itself a forbidden field name under the retained-content scan,
// and a safety block that trips the scanner it exists to satisfy would have to be
// exempted from it. The claim is made in the statement instead, and the validator
// checks the statement makes it.
export const SAFETY = Object.freeze({
  dataResidency: "browser_local_derived_workspace_records",
  readsImportedRecords: false,
  readsLiveProviderEndpoints: false,
  shareableLinkSupported: false,
  statement: SAFETY_STATEMENT,
});

/** Any of these in any string is a link this artifact must not be able to carry. */
export const FORBIDDEN_LINK_PATTERN = /(?:https?:\/\/|data:[a-z]+\/|blob:|ftp:\/\/|\bwww\.)/i;

/* -------------------------------- the briefing ------------------------------ */

function absence(reason) {
  return Object.freeze({ reason, statement: EXECUTIVE_ABSENCE_STATEMENT[reason] });
}

function limitationsFor({ reporting, benchmark, excludedDatasetPeriods }) {
  const codes = [
    LIMITATION.scenarioNotRealized,
    LIMITATION.browserLocalOnly,
    LIMITATION.noShareableLink,
    LIMITATION.usdOnly,
    LIMITATION.noPeerCohort,
  ];
  if (reporting && reporting.dataset !== "user") codes.push(LIMITATION.exampleDataset);
  if (!benchmark || !benchmark.eligible) codes.push(LIMITATION.benchmarkUnavailable);
  if (reporting && Number(reporting.coverageRatioPpm) < FULL_COVERAGE_PPM) {
    codes.push(LIMITATION.partialCoverage);
  }
  if (excludedDatasetPeriods > 0) codes.push(LIMITATION.mixedDatasetHistory);
  if (reporting && Array.isArray(reporting.missingInputs) && reporting.missingInputs.length) {
    codes.push(LIMITATION.missingInputs);
  }
  return Object.freeze(codes.map((code) => Object.freeze({
    code, statement: LIMITATION_STATEMENT[code],
  })));
}

function methodFor(reporting) {
  return Object.freeze({
    note:
      "Nothing here is recomputed from raw records. The recoverable scenario, the analyzed spend, the "
      + "coverage confidence, and the named org unit are read off one retained derived period exactly as "
      + "the briefing contract selected them. This briefing selects which period, computes the share and "
      + "the trailing baseline from the retained aggregates, and applies a fixed action catalog.",
    operations: Object.freeze([
      "recoverable_share_ppm = round_half_away_from_zero(recoverable_scenario_minor ÷ analyzed_spend_minor × 1e6)",
      "baseline_share_ppm = round_half_away_from_zero(mean(prior periods' recoverable_share_ppm))",
      "variance_share_ppm = reporting_share_ppm − baseline_share_ppm",
      `standing = in_line_with_baseline when |variance_share_ppm| <= ${BENCHMARK_MATERIAL_VARIANCE_PPM}`,
    ]),
    selectionRule: PRIMARY_SELECTION_RULE,
    benchmarkRule: BENCHMARK_RULE,
    confidenceRule: CONFIDENCE_RULE,
    readFields: Object.freeze([
      "period", "dataset", "derivedAt", "analyzedSpendMinor", "attributedSpendMinor",
      "recoverableScenarioMinor", "recordsAnalyzed", "recordsTotal", "coverageRatioPpm",
      "confidence", "missingInputs", "topDepartmentId",
    ]),
    derivedFromBriefingContract: reporting?.briefingContractVersion ?? null,
  });
}

/**
 * Build the executive briefing from retained derived workspace periods.
 *
 * @param periods the retained periods, as stored by `finops-workspace.js` and
 *   read back by `readFinopsWorkspace`. Aggregates only: this function has no
 *   way to reach an import, and is not given one.
 * @returns a frozen briefing. `questions`, `confidence`, `limitations`,
 *   `provenance`, `safety`, and `disclosure` are always present; `recoverable`,
 *   `benchmark`, `primaryFinding`, and `nextAction` may be absent, and when they
 *   are, `absent[slot]` carries the reason code and its authored statement.
 */
export function buildExecutiveBriefing(periods) {
  const list = Array.isArray(periods) ? periods.filter(Boolean) : [];
  const { chosen, reason, tieBreakApplied } = selectReportingPeriod(list);

  const base = {
    contractVersion: EXECUTIVE_BRIEFING_VERSION,
    contractVersions: Object.freeze({
      executiveBriefing: EXECUTIVE_BRIEFING_VERSION,
      briefing: BRIEFING_CONTRACT_VERSION,
      derivedFrom: chosen?.briefingContractVersion ?? null,
    }),
    questions: BRIEFING_QUESTIONS,
    disclosure: DISCLOSURE_LEVELS,
    safety: SAFETY,
  };

  if (!chosen) {
    return Object.freeze({
      ...base,
      reportingPeriod: null,
      recoverable: null,
      benchmark: null,
      primaryFinding: null,
      nextAction: null,
      confidence: Object.freeze({
        level: BRIEFING_CONFIDENCE.insufficient,
        meaning: CONFIDENCE_MEANING[BRIEFING_CONFIDENCE.insufficient],
        source: "no reporting period was selected",
        rule: CONFIDENCE_RULE,
        ceiling: null,
        ceilingReason: null,
      }),
      method: methodFor(null),
      limitations: limitationsFor({ reporting: null, benchmark: null, excludedDatasetPeriods: 0 }),
      provenance: Object.freeze({
        dataset: null,
        derivedAt: null,
        sourceFingerprint: null,
        periodIds: Object.freeze([]),
        retainedPeriodCount: list.length,
        recordsAnalyzed: null,
        recordsTotal: null,
      }),
      selection: Object.freeze({ rule: PRIMARY_SELECTION_RULE, tieBreakApplied: null, candidateCount: 0 }),
      absent: Object.freeze({
        primaryFinding: absence(reason),
        recoverable: absence(reason),
        benchmark: absence(reason),
        nextAction: absence(EXECUTIVE_ABSENCE_REASON.noPrimaryFinding),
      }),
    });
  }

  const sharePpm = recoverableSharePpm(chosen.recoverableScenarioMinor, chosen.analyzedSpendMinor);
  const priors = priorPeriodsFor(list, chosen);
  const excludedDatasetPeriods = list.filter((period) => period.dataset !== chosen.dataset).length;
  const benchmark = buildBenchmark(chosen, priors, sharePpm);
  const action = selectNextAction(chosen, benchmark);

  const ceiling = !benchmark.eligible ? BRIEFING_CONFIDENCE.moderate : null;
  const datasetCeiling = chosen.dataset !== "user" ? BRIEFING_CONFIDENCE.low : null;
  const level = weakest(
    chosen.confidence ?? BRIEFING_CONFIDENCE.insufficient,
    ceiling ?? BRIEFING_CONFIDENCE.high,
    datasetCeiling ?? BRIEFING_CONFIDENCE.high,
  );
  const ceilingReason = datasetCeiling ? "dataset_is_not_your_import"
    : ceiling ? "benchmark_ineligible" : null;

  return Object.freeze({
    ...base,
    reportingPeriod: Object.freeze({
      periodId: chosen.periodId,
      period: chosen.period,
      dataset: chosen.dataset,
      derivedAt: chosen.derivedAt ?? null,
    }),
    recoverable: Object.freeze({
      valueMinor: chosen.recoverableScenarioMinor,
      currency: "USD",
      unit: "usd_minor",
      sharePpm,
      analyzedSpendMinor: chosen.analyzedSpendMinor,
      label: "Recoverable AI spend indicated for the reporting period (routing scenario, not a realized saving)",
    }),
    benchmark,
    primaryFinding: Object.freeze({
      orgUnitId: chosen.topDepartmentId,
      periodId: chosen.periodId,
      basis: "highest-ranked org unit of the reporting period, as derived by the briefing contract",
      statement:
        "Act first in the named org unit: it carries the reporting period's recoverable-spend scenario.",
    }),
    nextAction: Object.freeze({
      id: action.id,
      statement: action.statement,
      accountableRole: action.accountableRole,
      precondition: action.precondition,
      capMinor: action.capped ? chosen.recoverableScenarioMinor : null,
      capCurrency: action.capped ? "USD" : null,
      evidence: Object.freeze([
        `reporting period ${chosen.period} of dataset ${chosen.dataset}`,
        `recoverable scenario ${chosen.recoverableScenarioMinor} usd_minor of ${chosen.analyzedSpendMinor} analyzed`,
        benchmark.eligible
          ? `benchmark ${benchmark.standing} over ${benchmark.priorPeriodCount} prior period(s)`
          : `benchmark unavailable: ${benchmark.reason}`,
      ]),
    }),
    confidence: Object.freeze({
      level,
      meaning: CONFIDENCE_MEANING[level],
      source: "coverage confidence stored with the retained derived period",
      rule: CONFIDENCE_RULE,
      ceiling: datasetCeiling ?? ceiling,
      ceilingReason,
      periodConfidence: chosen.confidence ?? null,
    }),
    method: methodFor(chosen),
    limitations: limitationsFor({ reporting: chosen, benchmark, excludedDatasetPeriods }),
    provenance: Object.freeze({
      dataset: chosen.dataset,
      derivedAt: chosen.derivedAt ?? null,
      sourceFingerprint: chosen.sourceFingerprint ?? null,
      periodIds: Object.freeze([...priors.map((period) => period.periodId), chosen.periodId]),
      retainedPeriodCount: list.length,
      recordsAnalyzed: chosen.recordsAnalyzed ?? null,
      recordsTotal: chosen.recordsTotal ?? null,
    }),
    selection: Object.freeze({
      rule: PRIMARY_SELECTION_RULE,
      tieBreakApplied,
      candidateCount: list.filter((period) => periodIneligibility(period) === null).length,
    }),
    absent: Object.freeze({}),
  });
}

/* -------------------------------- validation -------------------------------- */

/**
 * Reject a briefing that is malformed, that contradicts its own thresholds, or
 * that carries content this artifact may never hold.
 *
 * Total: it never throws, because a validator that throws is one a consumer
 * wraps in a try and then skips.
 *
 * @returns `{ valid, violations: [{ path, code, detail }] }`
 */
export function validateExecutiveBriefing(briefing) {
  const violations = [];
  const fail = (path, code, detail = "") => violations.push({ path, code, detail });
  if (!briefing || typeof briefing !== "object" || Array.isArray(briefing)) {
    return Object.freeze({
      valid: false,
      violations: Object.freeze([{ path: "", code: "not_an_object", detail: "" }]),
    });
  }
  if (briefing.contractVersion !== EXECUTIVE_BRIEFING_VERSION) {
    fail("contractVersion", "wrong_contract_version", String(briefing.contractVersion));
  }
  if (!Array.isArray(briefing.questions) || briefing.questions.length !== BRIEFING_QUESTIONS.length) {
    fail("questions", "questions_not_declared");
  } else if (briefing.questions.some((entry, index) => entry?.order !== index + 1
    || !String(entry?.question ?? "").trim().endsWith("?"))) {
    fail("questions", "questions_out_of_order");
  }
  if (!Array.isArray(briefing.disclosure) || briefing.disclosure.length !== DISCLOSURE_LEVELS.length) {
    fail("disclosure", "disclosure_levels_missing");
  }
  const safety = briefing.safety;
  if (!safety || safety.shareableLinkSupported !== false || safety.readsImportedRecords !== false
    || safety.readsLiveProviderEndpoints !== false
    || safety.dataResidency !== SAFETY.dataResidency
    || !/browser/i.test(String(safety.statement ?? ""))
    || !/credential/i.test(String(safety.statement ?? ""))
    || !/shareable link/i.test(String(safety.statement ?? ""))) {
    fail("safety", "safety_statement_missing_or_weakened");
  }
  if (!Array.isArray(briefing.limitations) || !briefing.limitations.length) {
    fail("limitations", "limitations_absent");
  } else {
    for (const [index, entry] of briefing.limitations.entries()) {
      if (!LIMITATION_STATEMENT[entry?.code]) {
        fail(`limitations[${index}]`, "limitation_not_in_catalog", String(entry?.code));
      }
    }
    for (const required of [LIMITATION.scenarioNotRealized, LIMITATION.browserLocalOnly,
      LIMITATION.noShareableLink]) {
      if (!briefing.limitations.some((entry) => entry?.code === required)) {
        fail("limitations", "required_limitation_absent", required);
      }
    }
  }
  if (!CONFIDENCE_LADDER.includes(briefing.confidence?.level)) {
    fail("confidence.level", "confidence_not_in_ladder", String(briefing.confidence?.level));
  } else if (briefing.confidence.meaning !== CONFIDENCE_MEANING[briefing.confidence.level]) {
    fail("confidence.meaning", "confidence_meaning_does_not_match_level");
  }
  if (!briefing.method?.note || !Array.isArray(briefing.method?.operations)
    || !briefing.method.operations.length) {
    fail("method", "method_note_absent");
  }

  const recoverable = briefing.recoverable;
  if (recoverable !== null && recoverable !== undefined) {
    if (!Number.isInteger(recoverable.valueMinor)) fail("recoverable.valueMinor", "not_minor_units");
    if (recoverable.currency !== "USD") fail("recoverable.currency", "unsupported_currency");
    const expected = recoverableSharePpm(recoverable.valueMinor, recoverable.analyzedSpendMinor);
    if (recoverable.sharePpm !== expected) {
      fail("recoverable.sharePpm", "share_not_computed_from_aggregates", String(recoverable.sharePpm));
    }
    const benchmark = briefing.benchmark;
    if (!benchmark || typeof benchmark !== "object") {
      fail("benchmark", "benchmark_absent_without_reason");
    } else if (benchmark.eligible) {
      if (benchmark.varianceSharePpm !== recoverable.sharePpm - benchmark.baselineSharePpm) {
        fail("benchmark.varianceSharePpm", "variance_not_computed_from_baseline");
      }
      const expectedStanding = Math.abs(benchmark.varianceSharePpm) <= BENCHMARK_MATERIAL_VARIANCE_PPM
        ? BENCHMARK_STANDING.inLine
        : benchmark.varianceSharePpm > 0 ? BENCHMARK_STANDING.more : BENCHMARK_STANDING.less;
      if (benchmark.standing !== expectedStanding) {
        fail("benchmark.standing", "standing_contradicts_variance", String(benchmark.standing));
      }
    } else if (!BENCHMARK_INELIGIBILITY_REASONS.includes(benchmark.reason)) {
      fail("benchmark.reason", "reason_not_in_catalog", String(benchmark.reason));
    }
  } else if (!EXECUTIVE_ABSENCE_STATEMENT[briefing.absent?.recoverable?.reason]) {
    fail("absent.recoverable", "absent_slot_without_reason");
  }

  const finding = briefing.primaryFinding;
  if (finding !== null && finding !== undefined) {
    if (typeof finding.orgUnitId !== "string" || !finding.orgUnitId) {
      fail("primaryFinding.orgUnitId", "finding_names_no_org_unit");
    }
    if (finding.periodId !== briefing.reportingPeriod?.periodId) {
      fail("primaryFinding.periodId", "finding_not_from_reporting_period");
    }
  } else if (!EXECUTIVE_ABSENCE_STATEMENT[briefing.absent?.primaryFinding?.reason]) {
    fail("absent.primaryFinding", "absent_slot_without_reason");
  }

  const action = briefing.nextAction;
  if (action !== null && action !== undefined) {
    if (!NEXT_ACTION_BY_ID[action.id]) {
      fail("nextAction.id", "action_not_in_catalog", String(action.id));
    } else if (action.statement !== NEXT_ACTION_BY_ID[action.id].statement) {
      fail("nextAction.statement", "action_statement_rewritten");
    }
    if (!Object.values(ACCOUNTABLE_ROLE).includes(action.accountableRole)) {
      fail("nextAction.accountableRole", "role_not_in_table", String(action.accountableRole));
    }
    if (!Array.isArray(action.evidence) || !action.evidence.length) {
      fail("nextAction.evidence", "action_without_evidence");
    }
  } else if (!EXECUTIVE_ABSENCE_STATEMENT[briefing.absent?.nextAction?.reason]) {
    fail("absent.nextAction", "absent_slot_without_reason");
  }

  // Content this artifact may never carry: the retained-content scan catches
  // prompts, identities, and credentials by field name and by value shape; the
  // link scan catches the one thing a briefing could otherwise smuggle out.
  for (const violation of scanRetainedContent(briefing).violations) violations.push(violation);
  walkForLinks(briefing, "", violations);

  return Object.freeze({ valid: violations.length === 0, violations: Object.freeze(violations) });
}

function walkForLinks(value, path, violations) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForLinks(item, `${path}[${index}]`, violations));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walkForLinks(child, path ? `${path}.${key}` : key, violations);
    }
    return;
  }
  if (typeof value === "string" && FORBIDDEN_LINK_PATTERN.test(value)) {
    violations.push({ path, code: "shareable_link", detail: "briefing may not carry a link" });
  }
}
