// Check the math: re-derive a briefing's headline figure and its grade from the
// briefing's own stated inputs, and say plainly whether they reproduce.
//
// WHO THIS IS FOR
// ---------------
// The director whose department came out worst. They are entitled to redo the
// arithmetic, to see every threshold that was applied to them, to read the
// assumption behind each one, and to be told — not left to infer — when the
// briefing in front of them was produced under a rubric this build no longer
// runs and therefore cannot be reproduced exactly.
//
// OFFLINE AND PROMPT-FREE IS A HARD CONSTRAINT
// --------------------------------------------
// `verifyBriefingMath` is a pure function of the briefing object it is handed.
// No fetch, no storage, no clock, no randomness, no model call, and above all no
// second look at the source dataset: if the briefing does not carry an operand,
// the answer is `cannot reproduce`, never "go and read the import again". A
// verification that re-derives from source is not a verification, it is a second
// computation that happens to agree with itself.
//
// It also reads no prose. Only named aggregate numbers, enum codes, and the
// assumption strings the rule modules authored are touched, so nothing a visitor
// typed can reach this path, a judge, or an executive view through it.
//
// ONE RECOMPUTATION, TWO CALLERS
// ------------------------------
// The view and the golden fixtures call this same function. That is the point:
// a view that computed figures one way and a test that computed them another
// would agree with each other about nothing, and the drift this file exists to
// catch would ship.
//
// WHAT IS RE-DERIVED, AND FROM WHAT
// ---------------------------------
//   recoverable spend   from each department's `downRouting` operands —
//                       candidate spend, candidate tokens, the standard-tier
//                       reference price the file itself recorded — re-run
//                       through the routing rule's arithmetic and summed.
//   the grade           from `coverage.recordsAnalyzed / recordsTotal` and the
//                       required-input list, against COVERAGE_THRESHOLDS.
// Neither reads the stored answer to produce its own; the stored answer is only
// ever the thing compared against.

import {
  BRIEFING_CONFIDENCE,
  COVERAGE_GRADE_ASSUMPTIONS,
  confidenceFor,
  coverageRatio,
  missingRequiredInputs,
} from "./finops-briefing-contract.js";
import {
  DOWN_ROUTING_ASSUMPTIONS,
  DOWN_ROUTING_CONSTANTS,
  DOWN_ROUTING_RULE_VERSION,
} from "./down-routing-candidates.js";
import { buildBriefing } from "./finops-briefing-export.js";

/** Bump when a step, a verdict code, or the shape of a reported figure changes. */
export const VERIFICATION_VERSION = "briefing-verification/1.0.0";

/**
 * The four states this check can end in. There is no fifth, and no state that
 * means "probably fine".
 */
export const VERIFICATION_VERDICT = Object.freeze({
  reproduced: "reproduced_exactly",
  rubricDrift: "rubric_version_drift",
  mismatch: "does_not_match",
  cannotReproduce: "cannot_reproduce",
});

/**
 * The sentence each verdict is stated in, authored once so the page, a test,
 * and any later consumer say the same thing about the same outcome. Each says
 * what happened and what it means for the reader's dispute.
 */
export const VERDICT_STATEMENT = Object.freeze({
  [VERIFICATION_VERDICT.reproduced]:
    "Reproduced exactly. Every figure below was recomputed from the inputs this briefing states, "
    + "under the rubric version it names, and matched the figure it published to the cent.",
  [VERIFICATION_VERDICT.rubricDrift]:
    "Cannot reproduce — rubric version drift. This briefing was scored under an older version of "
    + "the routing rubric than the one this build runs, so its figures cannot be reproduced "
    + "exactly here. The steps below show the arithmetic as the briefing stated it; they are not a "
    + "confirmation of it.",
  [VERIFICATION_VERDICT.mismatch]:
    "Does not match. The rubric version is the same, but recomputing from this briefing's own "
    + "stated inputs did not return the figures it published. That is a defect in the analysis or "
    + "in this briefing, not a disagreement about policy, and the disagreeing figures are named "
    + "below.",
  [VERIFICATION_VERDICT.cannotReproduce]:
    "Cannot reproduce — an input is missing. This briefing does not carry every operand its "
    + "headline figure was computed from, so the arithmetic cannot be redone from it. Nothing was "
    + "read from the source data to fill the gap; the missing inputs are named below.",
});

/**
 * Money is compared at half a cent.
 *
 * ASSUMPTION: every figure in this chain is already rounded to cents by the rule
 * that produced it, so any real disagreement is at least one cent. A tolerance
 * below one cent therefore admits no rounding argument, and a tolerance of
 * exactly zero would fail on IEEE-754 noise from summing a list of cent values.
 */
export const MONEY_TOLERANCE_USD = 0.005;

/**
 * Ratios are compared at the six decimal places the briefing file rounds them
 * to, plus one order of magnitude for float noise.
 */
export const RATIO_TOLERANCE = 1e-7;

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Cents in, dollars out, the way every money figure in this chain is rounded. */
function usd(minor) {
  return Math.round(minor) / 100;
}

function roundCents(value) {
  return Math.round(value * 100) / 100;
}

function roundRatio(value) {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : 0;
}

/** A named figure: what was published, what came back, and the gap. */
function comparison(name, unit, stated, recomputed, tolerance) {
  const bothNumbers = Number.isFinite(stated) && Number.isFinite(recomputed);
  const delta = bothNumbers ? roundRatio(recomputed - stated) : null;
  const matches = bothNumbers
    ? Math.abs(recomputed - stated) <= tolerance
    : stated === recomputed;
  return Object.freeze({ name, unit, stated, recomputed, delta, matches });
}

// ---------------------------------------------------------------------------
// The money chain.
// ---------------------------------------------------------------------------

/**
 * One department's routing arithmetic, redone.
 *
 * The reference price comes off the department's own record, not off this
 * build's constant: a briefing written under an older rubric recorded the price
 * it actually used, and re-pricing it with today's number would produce a figure
 * neither build ever published.
 */
function redoDepartment(department, rank) {
  const routing = department?.downRouting ?? null;
  const candidateSpendUsd = finite(routing?.candidateSpendUsd);
  const candidateTokens = finite(routing?.candidateTokens);
  const referencePrice = finite(routing?.referenceMinorPerMillionTokens);
  const statedRecoverableUsd = finite(department?.recoverableUsd, 0);
  const flagged = Boolean(routing?.flagged);

  if (candidateSpendUsd === null || candidateTokens === null || referencePrice === null) {
    return Object.freeze({
      id: department?.id ?? null,
      rank,
      reproducible: false,
      missing: Object.freeze([
        ...(candidateSpendUsd === null ? ["candidate_spend_usd"] : []),
        ...(candidateTokens === null ? ["candidate_tokens"] : []),
        ...(referencePrice === null ? ["standard_tier_reference_price"] : []),
      ]),
      flagged,
      statedRecoverableUsd,
      recomputedRecoverableUsd: null,
    });
  }

  const candidateSpendMinor = Math.round(candidateSpendUsd * 100);
  const projectedMinor = Math.round((candidateTokens * referencePrice) / 1_000_000);
  const recoverableMinor = flagged ? Math.max(0, candidateSpendMinor - projectedMinor) : 0;
  return Object.freeze({
    id: department?.id ?? null,
    rank,
    reproducible: true,
    missing: Object.freeze([]),
    flagged,
    decisionCode: routing.decisionCode ?? null,
    candidateSpendUsd,
    candidateTokens,
    referenceMinorPerMillionTokens: referencePrice,
    projectedStandardTierSpendUsd: usd(projectedMinor),
    statedRecoverableUsd,
    recomputedRecoverableUsd: usd(recoverableMinor),
    matches: Math.abs(usd(recoverableMinor) - statedRecoverableUsd) <= MONEY_TOLERANCE_USD,
  });
}

/**
 * The steps from the stated operands to the headline figure, in the order a
 * reader would redo them. Every expression is text, and every intermediate value
 * it names appears on an earlier step or in the briefing's own input list.
 */
function moneySteps(departments, analyzedSpendUsd, recomputedTotalUsd, recomputedShare) {
  const flagged = departments.filter((department) => department.flagged);
  const steps = [
    {
      id: "candidate_spend",
      label: "Candidate spend per department",
      expression: "cost of text-generation records billed in tokens, as each department recorded it",
      value: flagged.map((department) =>
        `${department.id ?? "unattributed"}: ${(department.candidateSpendUsd ?? 0).toFixed(2)} USD `
        + `over ${department.candidateTokens ?? 0} tokens`).join("; ") || "no candidate department",
    },
    {
      id: "projected_spend",
      label: "Same tokens on the cheaper tier",
      expression: "round(candidate tokens × standard-tier reference price ÷ 1,000,000)",
      value: flagged.map((department) =>
        `${department.id ?? "unattributed"}: round(${department.candidateTokens} × `
        + `${department.referenceMinorPerMillionTokens} ÷ 1,000,000) = `
        + `${(department.projectedStandardTierSpendUsd ?? 0).toFixed(2)} USD`).join("; ")
        || "no candidate department",
    },
    {
      id: "department_recoverable",
      label: "Recoverable per department",
      expression: "max(0, candidate spend − cheaper-tier cost), and 0 for a department the rule did not flag",
      value: departments.map((department) =>
        `${department.id ?? "unattributed"}: `
        + `${(department.recomputedRecoverableUsd ?? 0).toFixed(2)} USD`).join("; ")
        || "no ranked department",
    },
    {
      id: "organization_recoverable",
      label: "Recoverable spend (the headline figure)",
      expression: `sum of ${departments.length} department figure`
        + `${departments.length === 1 ? "" : "s"}, rounded to cents`,
      value: `${recomputedTotalUsd.toFixed(2)} USD`,
    },
  ];
  if (analyzedSpendUsd !== null && analyzedSpendUsd > 0) {
    steps.push({
      id: "recoverable_share",
      label: "Share of analyzed spend",
      expression: `${recomputedTotalUsd.toFixed(2)} ÷ ${analyzedSpendUsd.toFixed(2)}`,
      value: `${(recomputedShare * 100).toFixed(1)}% of analyzed spend`,
    });
  }
  return Object.freeze(steps.map((step) => Object.freeze(step)));
}

// ---------------------------------------------------------------------------
// The grade chain.
// ---------------------------------------------------------------------------

const GRADE_LADDER = Object.freeze([
  Object.freeze({
    grade: BRIEFING_CONFIDENCE.high,
    test: "coverage ratio ≥ 0.90 AND no required input missing",
  }),
  Object.freeze({
    grade: BRIEFING_CONFIDENCE.moderate,
    test: "coverage ratio ≥ 0.60",
  }),
  Object.freeze({
    grade: BRIEFING_CONFIDENCE.low,
    test: "coverage ratio > 0",
  }),
  Object.freeze({
    grade: BRIEFING_CONFIDENCE.insufficient,
    test: "coverage ratio = 0, including the 0/0 case",
  }),
]);

function gradeSteps(analyzed, total, ratio, missingInputs, grade) {
  return Object.freeze([
    Object.freeze({
      id: "coverage_ratio",
      label: "Coverage ratio",
      expression: `${analyzed} records analyzed ÷ ${total} records handed to the analysis`,
      value: total > 0 ? `${roundRatio(ratio)} (${(ratio * 100).toFixed(1)}%)` : "0 (0/0 is defined as 0)",
    }),
    Object.freeze({
      id: "required_inputs",
      label: "Required inputs present",
      expression: "analyzed_spend_usd, recoverable_scenario_usd, ranked_departments, provider_completeness",
      value: missingInputs.length ? `missing: ${missingInputs.join(", ")}` : "all four present",
    }),
    Object.freeze({
      id: "threshold_ladder",
      label: "Threshold applied",
      expression: GRADE_LADDER.map((rung) => `${rung.grade} when ${rung.test}`).join("; "),
      value: `graded ${grade}`,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// The thresholds and weights, each beside the assumption behind it.
// ---------------------------------------------------------------------------

/**
 * The routing rule's four numeric parameters, paired with the assumption text
 * the rule module authored for each.
 *
 * The values are read from the briefing's own `scenario` block when it carries
 * one, so a drifted briefing shows the parameters it was actually scored under.
 * With no scenario block the current build's constants are used and `source`
 * says so — a number whose provenance the reader cannot see is exactly what this
 * view exists to stop.
 */
const CURRENT_SCENARIO_PARAMETERS = Object.freeze([
  Object.freeze({
    name: "premium_tier_floor_minor_per_million_tokens",
    unit: "currency_minor_per_million_tokens",
    value: DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS,
    assumption: DOWN_ROUTING_ASSUMPTIONS[0],
  }),
  Object.freeze({
    name: "standard_tier_reference_minor_per_million_tokens",
    unit: "currency_minor_per_million_tokens",
    value: DOWN_ROUTING_CONSTANTS.STANDARD_TIER_REFERENCE_MINOR_PER_MILLION_TOKENS,
    assumption: DOWN_ROUTING_ASSUMPTIONS[1],
  }),
  Object.freeze({
    name: "short_call_max_tokens_per_call",
    unit: "tokens_per_call",
    value: DOWN_ROUTING_CONSTANTS.SHORT_CALL_MAX_TOKENS_PER_CALL,
    assumption: DOWN_ROUTING_ASSUMPTIONS[2],
  }),
  Object.freeze({
    name: "min_candidate_requests",
    unit: "requests",
    value: DOWN_ROUTING_CONSTANTS.MIN_CANDIDATE_REQUESTS,
    assumption: DOWN_ROUTING_ASSUMPTIONS[3],
  }),
]);

function scenarioParameters(payload) {
  const stated = Array.isArray(payload?.scenario?.parameters) ? payload.scenario.parameters : null;
  if (!stated?.length) {
    return CURRENT_SCENARIO_PARAMETERS.map((parameter) =>
      Object.freeze({ ...parameter, source: "this build — the briefing states no scenario block" }));
  }
  return Object.freeze(stated.map((parameter) => Object.freeze({
    name: parameter?.name ?? null,
    unit: parameter?.unit ?? null,
    value: finite(parameter?.value),
    assumption: typeof parameter?.assumption === "string" ? parameter.assumption : null,
    source: "stated by the briefing",
  })));
}

/** The grade's thresholds, with the assumption COVERAGE_GRADE_ASSUMPTIONS states. */
function gradeThresholds() {
  return Object.freeze(COVERAGE_GRADE_ASSUMPTIONS.map((entry) => Object.freeze({ ...entry })));
}

// ---------------------------------------------------------------------------
// Attribution coverage. The disputing director's first question.
// ---------------------------------------------------------------------------

function attributionOf(payload) {
  const figure = payload?.figures?.attributedShare ?? null;
  const inputs = figure?.inputs ?? null;
  if (!inputs) {
    return Object.freeze({
      available: false,
      statement: "This briefing does not state how much of its spend was attributed to a department, "
        + "so the share cannot be shown and was not looked up elsewhere.",
    });
  }
  const attributed = finite(inputs.attributedSpendUsd, 0);
  const unattributed = finite(inputs.unattributedSpendUsd, 0);
  const total = attributed + unattributed;
  const recomputed = total > 0 ? roundRatio(attributed / total) : 0;
  const full = recomputed >= 1 - RATIO_TOLERANCE;
  return Object.freeze({
    available: true,
    attributedSpendUsd: attributed,
    unattributedSpendUsd: unattributed,
    share: comparison("attributed_share_of_spend", "ratio", finite(figure?.value), recomputed, RATIO_TOLERANCE),
    unattributedRecoverableUsd: finite(inputs.unattributedRecoverableUsd, 0),
    full,
    statement: full
      ? `Full attribution: all ${total.toFixed(2)} USD of analyzed spend sits in a department this `
        + "rubric could score, so the headline figure was summed over the whole of it."
      : `Partial attribution: ${(recomputed * 100).toFixed(1)}% of analyzed spend `
        + `(${attributed.toFixed(2)} of ${total.toFixed(2)} USD) sits in a department this rubric `
        + `could score. The remaining ${unattributed.toFixed(2)} USD is unattributed, and the `
        + "headline figure was not summed over it.",
  });
}

// ---------------------------------------------------------------------------
// The one entry point.
// ---------------------------------------------------------------------------

/**
 * The rubric version the briefing was produced under.
 *
 * Read off the departments, where `evaluateDownRoutingCandidate` wrote it at the
 * time. `briefing.rubricVersion` is stamped from whichever build rebuilt the
 * briefing object, so asking it would only ever return today's answer — which is
 * precisely the question drift detection must not ask.
 */
export function statedRubricVersion(payload) {
  const ranked = Array.isArray(payload?.results?.rankedDepartments)
    ? payload.results.rankedDepartments : [];
  for (const department of ranked) {
    const version = department?.downRouting?.ruleVersion;
    if (typeof version === "string" && version) return version;
  }
  return null;
}

/**
 * Re-derive a briefing's figures and grade from the briefing's own inputs.
 *
 * Pure and total: no I/O, no clock, no model call, and it never throws. A
 * briefing it cannot read is a `cannot_reproduce` verdict, not an exception, and
 * not a fallback to the source dataset.
 *
 * @param payload a briefing file payload — `buildBriefing`'s output, or a file
 *   `parseSavedBriefing` accepted. Only its aggregate figures are read.
 * @param options.currentRubricVersion the routing rule version this build runs.
 *   Injected so a test can state drift rather than simulate a different build.
 * @returns a frozen verification model: the verdict, the named figures with
 *   their stated/recomputed pair, the ordered steps, the parameters and
 *   thresholds with their assumptions, and the attribution coverage.
 */
export function verifyBriefingMath(payload, { currentRubricVersion = DOWN_ROUTING_RULE_VERSION } = {}) {
  const results = payload?.results ?? null;
  const briefing = payload?.briefing ?? null;
  const ranked = Array.isArray(results?.rankedDepartments) ? results.rankedDepartments : [];
  const departments = ranked.map((department, index) => redoDepartment(department, index + 1));

  const analyzedSpendUsd = finite(results?.spendUsd);
  const statedTotalUsd = finite(results?.recoverableUsd);
  const recomputedTotalUsd = roundCents(departments
    .reduce((sum, department) => sum + (department.recomputedRecoverableUsd ?? 0), 0));
  const recomputedShare = analyzedSpendUsd > 0 ? roundRatio(recomputedTotalUsd / analyzedSpendUsd) : 0;
  const statedShare = finite(payload?.figures?.recoverableSpend?.inputs?.recoverableShareOfAnalyzedSpend);

  // The grade, re-derived: the ratio from the record counts, the missing-input
  // list from the projected envelope, then the contract's own ladder.
  const analyzed = finite(briefing?.coverage?.recordsAnalyzed, 0);
  const total = finite(briefing?.coverage?.recordsTotal, 0);
  const ratio = coverageRatio(analyzed, total);
  const missingInputs = missingRequiredInputs(results);
  const recomputedGrade = confidenceFor(ratio, missingInputs);
  const statedGrade = briefing?.coverage?.confidence ?? null;

  const figures = Object.freeze({
    recoverableSpendUsd: comparison(
      "recoverable_spend_usd", "USD", statedTotalUsd, recomputedTotalUsd, MONEY_TOLERANCE_USD),
    recoverableShareOfAnalyzedSpend: comparison(
      "recoverable_share_of_analyzed_spend", "ratio", statedShare, recomputedShare, RATIO_TOLERANCE),
    coverageRatio: comparison(
      "coverage_ratio", "ratio", finite(briefing?.coverage?.coverageRatio), roundRatio(ratio), RATIO_TOLERANCE),
    grade: comparison("grade", "enum", statedGrade, recomputedGrade, 0),
  });

  const attribution = attributionOf(payload);
  const unreproducible = departments.filter((department) => !department.reproducible);
  const missingOperands = Object.freeze([...new Set(unreproducible.flatMap((department) => department.missing))]);

  const stated = statedRubricVersion(payload);
  const drifted = Boolean(stated) && stated !== currentRubricVersion;
  const compared = [
    figures.recoverableSpendUsd, figures.recoverableShareOfAnalyzedSpend,
    figures.coverageRatio, figures.grade,
    ...(attribution.available ? [attribution.share] : []),
  ];
  const disagreeing = compared.filter((entry) => !entry.matches);

  // Precedence, fixed so the same briefing always gets the same verdict:
  //   1. a missing operand or an unnamed rubric — nothing can be recomputed;
  //   2. rubric drift — the arithmetic ran, but under rules this build retired;
  //   3. a disagreement at the same rubric version — a defect, said as one;
  //   4. reproduced.
  // Drift outranks disagreement deliberately: under a different rubric a
  // disagreement is expected, and reporting it as a defect would send a director
  // to file a bug about a policy change.
  let verdict;
  if (!ranked.length || missingOperands.length || !stated || statedTotalUsd === null) {
    verdict = VERIFICATION_VERDICT.cannotReproduce;
  } else if (drifted) {
    verdict = VERIFICATION_VERDICT.rubricDrift;
  } else if (disagreeing.length) {
    verdict = VERIFICATION_VERDICT.mismatch;
  } else {
    verdict = VERIFICATION_VERDICT.reproduced;
  }

  return Object.freeze({
    verificationVersion: VERIFICATION_VERSION,
    verdict,
    statement: VERDICT_STATEMENT[verdict],
    rubric: Object.freeze({
      stated,
      current: currentRubricVersion,
      drifted,
    }),
    figures,
    disagreeingFigures: Object.freeze(disagreeing.map((entry) => entry.name)),
    missingOperands,
    departments: Object.freeze(departments),
    steps: Object.freeze({
      recoverableSpend: moneySteps(departments, analyzedSpendUsd, recomputedTotalUsd, recomputedShare),
      grade: gradeSteps(analyzed, total, ratio, missingInputs, recomputedGrade),
    }),
    parameters: scenarioParameters(payload),
    thresholds: gradeThresholds(),
    attribution,
    analyzedSpendUsd,
  });
}

/**
 * The same check for an analysis that has not been exported yet.
 *
 * A freshly generated briefing and a reopened one must reach the identical view,
 * so the live path does not get its own recomputation: it selects the briefing
 * payload the export would have written — purely, with no clock and no download
 * — and hands that to `verifyBriefingMath`.
 *
 * @returns a verification model, or null when no analysis has been computed or
 *   the payload was withheld for forbidden content. Null means the view is
 *   absent, never half-drawn.
 */
export function verifyAnalysisMath(analysis, { dataset, attributionWithheld = false, ...options } = {}) {
  if (!analysis || typeof analysis !== "object") return null;
  let payload;
  try {
    payload = buildBriefing(analysis, { dataset, attributionWithheld });
  } catch {
    return null;
  }
  return verifyBriefingMath(payload, options);
}

/**
 * The named figures alone, as a plain object.
 *
 * This is what a golden fixture asserts against: a failure then names which
 * figure drifted and by how much, instead of diffing two rendered paragraphs.
 */
export function verifiedFigures(verification) {
  return {
    verdict: verification.verdict,
    rubricVersion: verification.rubric.stated,
    recoverableSpendUsd: verification.figures.recoverableSpendUsd.recomputed,
    recoverableShareOfAnalyzedSpend: verification.figures.recoverableShareOfAnalyzedSpend.recomputed,
    coverageRatio: verification.figures.coverageRatio.recomputed,
    grade: verification.figures.grade.recomputed,
    attributedShareOfSpend: verification.attribution.available
      ? verification.attribution.share.recomputed : null,
    fullyAttributed: verification.attribution.available ? verification.attribution.full : null,
  };
}
