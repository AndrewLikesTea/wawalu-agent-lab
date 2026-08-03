// Check the math: re-derive a briefing's headline figure and its grade from the
// operands the briefing itself carries.
//
// WHO THIS IS FOR
// ---------------
// The director whose team the briefing grades, reading it with the intention of
// disputing it. That reader is owed three things a headline figure alone cannot
// give them: the operands the figure was computed from, every arithmetic step
// between those operands and the figure, and — where this build genuinely cannot
// reproduce the figure — a verdict that says so instead of a number that implies
// otherwise.
//
// WHAT IT READS, AND WHAT IT REFUSES TO READ
// ------------------------------------------
// Input is one briefing payload: the #391 contract object under `briefing`, the
// #393 file's `results` projection, and its optional `figures`/`scenario` blocks.
// That is the whole of it. This module never re-imports a provider export, never
// re-runs the analysis, never touches a prompt, a conversation, a query sample,
// or any other visitor content — none of which is in a briefing payload to begin
// with, which is exactly why the payload is the only permitted input. A check
// that had to re-read the source data would be a second analysis wearing an
// audit's clothes, and would put visitor content back in front of a reader who
// had been promised it never left their tab.
//
// It is therefore offline and prompt-free by construction: no DOM, no fetch, no
// storage, no clock, no randomness. Same payload in, same derivation out.
//
// RE-DERIVATION IS NOT RE-SCORING
// -------------------------------
// Every rule applied below is imported from the briefing contract —
// `coverageRatio`, `confidenceFor`, `COVERAGE_THRESHOLDS`. This module holds no
// copy of them. If it did, "check the math" would be a second scorer that agrees
// with the first by coincidence, and the day they disagreed a reader would have
// no way to tell which one was the briefing they were shown.
//
// WHAT A FAILED CHECK MEANS
// -------------------------
// A step that does not reconcile is reported as a mismatch with both numbers
// beside each other. It is never repaired, never rounded into agreement, and
// never dropped. The verdict downgrades accordingly, because a check that
// silently fixes what it finds is not a check.

import {
  BRIEFING_CONFIDENCE,
  CONTRACT_VERSION,
  COVERAGE_THRESHOLDS,
  MATERIAL_CANDIDATE,
  PROVENANCE_HIGH_FLOOR,
  REQUIRED_INPUTS,
  confidenceFor,
  coverageRatio,
} from "./finops-briefing-contract.js";
import { DOWN_ROUTING_RULE_VERSION } from "./down-routing-candidates.js";

/**
 * This view's own version, bumped when a step's meaning, the verdict enum, or a
 * stated weight changes. A screenshot of a derivation is only evidence if it
 * says which derivation it is.
 */
export const DERIVATION_VERSION = "finops-briefing-derivation/1.0.0";

// ---------------------------------------------------------------------------
// Every number this module applies, with the assumption behind it.
//
// STATED FIRST, BECAUSE A WEIGHT NOBODY CAN DISPUTE IS NOT A POLICY.
//
// Read `value` as the number, `assumption` as the claim about the world that
// makes the number the right one, and `rationale` as why it is set where it is
// rather than somewhere else. A reader who rejects the assumption has grounds to
// reject the grade, which is the point of writing them down.
// ---------------------------------------------------------------------------

/**
 * NOTE ON THE WORD "WEIGHT". The coverage grade is **not** a weighted sum. It is
 * a lookup against ordered thresholds plus one all-or-nothing gate, and no
 * number below is ever multiplied by another. That is stated here rather than
 * left to inference because "weighted score" and "threshold lookup" fail in
 * opposite ways: a weighted score lets a strong criterion mask a weak one, and a
 * threshold lookup cannot. Every number that can move the grade is listed.
 */
export const GRADE_WEIGHTS = Object.freeze([
  Object.freeze({
    name: "high_coverage_threshold",
    value: COVERAGE_THRESHOLDS.high,
    unit: "ratio",
    assumption:
      "A briefing may be called high-confidence only if at least 90% of the records handed to the analysis "
      + "were actually analyzed.",
    rationale:
      "Set at 0.90, not 1.0, because a provider export routinely carries a small tail of rows no join can "
      + "place, and requiring perfection would make the top grade unreachable in normal operation. Set no "
      + "lower because a tenth of the records is the point at which one unanalyzed department can change "
      + "which department ranks first.",
  }),
  Object.freeze({
    name: "required_inputs_present",
    value: REQUIRED_INPUTS.length,
    unit: "count",
    assumption:
      "High confidence additionally requires every one of the four named aggregate inputs to be present; "
      + "record coverage alone cannot earn it.",
    rationale:
      "An all-or-nothing gate rather than a weight, because the four inputs are not interchangeable: a "
      + "briefing can cover 95% of records and still be missing the figure that sizes the action, and "
      + "averaging that absence away would let a complete-looking grade sit on top of a missing operand.",
  }),
  Object.freeze({
    name: "moderate_coverage_threshold",
    value: COVERAGE_THRESHOLDS.moderate,
    unit: "ratio",
    assumption: "Above 60% record coverage a figure is directional; below it, it is an anecdote.",
    rationale:
      "Set at a clear majority of the record set so that the figure describes most of the population it "
      + "claims to describe. It is a judgement call and is the weight most open to dispute; it is stated "
      + "here so the dispute is about the number rather than about whether one was applied.",
  }),
  Object.freeze({
    name: "low_coverage_floor",
    value: COVERAGE_THRESHOLDS.low,
    unit: "ratio",
    assumption:
      "Any coverage strictly above zero is 'low'; exactly zero coverage is 'insufficient' and carries no "
      + "figure at all.",
    rationale:
      "A strict inequality, so an import that joined nothing can never present as a graded briefing. The "
      + "contract defines 0÷0 as 0 for the same reason.",
  }),
  Object.freeze({
    name: "full_attribution_for_complete",
    value: 1,
    unit: "ratio",
    assumption:
      "A headline figure may be called complete only when every analyzed dollar sits in a department the "
      + "rubric could score.",
    rationale:
      "Exactly 1, with no tolerance band, because record coverage and spend attribution fail independently: "
      + "100% of records can join while a fifth of the money lands in the unattributed bucket, and a figure "
      + "summed over four-fifths of the spend that presents as a total is a wrong number in a right one's "
      + "clothes.",
  }),
]);

/**
 * Reconciliation tolerances. These decide when two numbers "agree", so they are
 * as much a policy as the thresholds above.
 */
export const RECONCILIATION_TOLERANCE = Object.freeze([
  Object.freeze({
    name: "money_tolerance_usd",
    value: 0.005,
    unit: "USD",
    assumption: "Two money figures agree when they round to the same cent.",
    rationale:
      "Half a cent: the largest difference that cannot survive rounding to cents. Anything wider would let a "
      + "real per-department error hide inside the tolerance; anything narrower would report IEEE-754 "
      + "addition order as a discrepancy.",
  }),
  Object.freeze({
    name: "ratio_tolerance",
    value: 1e-6,
    unit: "ratio",
    assumption: "Two ratios agree when they match at the precision the briefing file stores them to.",
    rationale:
      "The briefing file rounds every ratio to six decimal places exactly once, so six places is the finest "
      + "distinction a stored ratio can carry. Comparing tighter than the file stores would report the file's "
      + "own rounding as drift.",
  }),
]);

const MONEY_TOLERANCE = RECONCILIATION_TOLERANCE[0].value;
const RATIO_TOLERANCE = RECONCILIATION_TOLERANCE[1].value;

// ---------------------------------------------------------------------------
// The verdict.
// ---------------------------------------------------------------------------

export const DERIVATION_VERDICT = Object.freeze({
  reproduced: "reproduced",
  arithmeticMismatch: "arithmetic_mismatch",
  rubricSuperseded: "rubric_superseded",
  rubricUnknown: "rubric_unknown",
  contractMismatch: "contract_mismatch",
  inputsAbsent: "inputs_absent",
});

/**
 * The sentence each verdict is shown as, authored once here so the screen, a
 * print, and any later consumer say the same thing about the same outcome.
 *
 * Only `reproduced` claims reproduction. Every other sentence says plainly that
 * the figure was not reproduced and why, because "could not check" and "checked
 * and it holds" are the two answers a disputing reader most needs kept apart.
 */
export const VERDICT_STATEMENT = Object.freeze({
  [DERIVATION_VERDICT.reproduced]:
    "Reproduced. Every figure below was recomputed from the operands stated in this briefing and matched the "
    + "figure the briefing reports.",
  [DERIVATION_VERDICT.arithmeticMismatch]:
    "NOT reproduced. At least one figure recomputed to a different number than the briefing states. Both "
    + "numbers are shown against the step that disagreed; treat the briefing's headline as unverified until "
    + "the analysis is exported again.",
  [DERIVATION_VERDICT.rubricSuperseded]:
    "NOT reproducible on this build. This briefing was scored under an older routing rubric than the one "
    + "loaded here, so its figures cannot be re-derived exactly — the steps below re-add the operands the "
    + "briefing carries and are internally consistent, but they do not prove today's rubric would produce "
    + "the same figure. Re-export the analysis to score it under the current rubric.",
  [DERIVATION_VERDICT.rubricUnknown]:
    "NOT reproducible on this build. This briefing does not record which routing rubric produced it, so "
    + "there is no way to confirm it was scored the same way this build scores. The steps below are "
    + "internally consistent and prove nothing beyond that.",
  [DERIVATION_VERDICT.contractMismatch]:
    "NOT reproducible on this build. This briefing was written against a different version of the briefing "
    + "contract, so the meaning of its slots may have changed. No figure below should be read as confirmed.",
  [DERIVATION_VERDICT.inputsAbsent]:
    "Nothing to check. This briefing states no figure and carries no arithmetic to re-derive, so there is no "
    + "claim here to confirm or dispute.",
});

/**
 * Verdict precedence, strongest objection first.
 *
 * Fixed and total, so the same payload always yields the same verdict rather
 * than whichever fault the code happened to notice first:
 *
 *   1. `arithmetic_mismatch` — a stated figure does not add up. It outranks
 *      every other objection, including "there is no headline figure": a
 *      briefing can withhold its figure and still state a coverage grade its own
 *      record counts contradict, and that contradiction is the finding.
 *   2. `inputs_absent`      — no headline figure and nothing left to check.
 *   3. `contract_mismatch`  — the slots may not mean what this build reads.
 *   4. `rubric_unknown`     — the rubric is unstated, so nothing can be said.
 *   5. `rubric_superseded`  — the rubric is stated and is not this build's.
 *   6. `reproduced`.
 */
export const VERDICT_PRECEDENCE = Object.freeze([
  DERIVATION_VERDICT.arithmeticMismatch,
  DERIVATION_VERDICT.inputsAbsent,
  DERIVATION_VERDICT.contractMismatch,
  DERIVATION_VERDICT.rubricUnknown,
  DERIVATION_VERDICT.rubricSuperseded,
  DERIVATION_VERDICT.reproduced,
]);

export const STEP_STATUS = Object.freeze({
  reproduced: "reproduced",
  mismatch: "mismatch",
  unchecked: "unchecked",
});

// ---------------------------------------------------------------------------
// Reading the payload. Untrusted until proven otherwise.
// ---------------------------------------------------------------------------

/**
 * Version identifiers are the only strings out of the payload that this module
 * lets through to a reader, and a saved file is untrusted input, so they are
 * allowlisted rather than escaped downstream: anything that is not shaped like
 * a version this product emits becomes null and is reported as unstated.
 *
 * THE `/major.minor.patch` SUFFIX IS REQUIRED, and that is the whole strength of
 * the rule. Every version this product stamps has one — `finops-briefing/1.0.0`,
 * `down-routing-candidate/1.0.0`, `attribution-unit/1.0.0` — and no sentence
 * does. An earlier draft allowed any short run of word characters, which a
 * hyphenated 62-character prompt fragment satisfies; requiring the numeric
 * suffix is what makes "looks like a version" a claim rather than a hope.
 *
 * Redaction happens here, at the boundary, rather than in the view — a view that
 * has to remember to redact is one that eventually forgets.
 */
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}\/\d+\.\d+\.\d+$/;

export function readVersion(value) {
  return typeof value === "string" && VERSION_PATTERN.test(value) ? value : null;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function moneyAgrees(left, right) {
  return left !== null && right !== null && Math.abs(left - right) <= MONEY_TOLERANCE;
}

function ratioAgrees(left, right) {
  return left !== null && right !== null && Math.abs(left - right) <= RATIO_TOLERANCE;
}

/** Fixed-precision text, so a step's sentence has the same bytes on every run. */
function moneyText(value) {
  return value === null ? "—" : `${value.toFixed(2)} USD`;
}

function ratioText(value) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function countText(value) {
  return value === null ? "—" : String(value);
}

const FORMAT = Object.freeze({ USD: moneyText, ratio: ratioText, count: countText, grade: (value) => value ?? "—" });

/**
 * One arithmetic step.
 *
 * `computed` is what this module got by applying the stated operands; `stated`
 * is what the briefing claims. They are separate fields and are never collapsed
 * into a single "value", because the entire purpose of the step is to let a
 * reader see them disagree.
 */
function step({ id, label, expression, unit, operands, computed, stated }) {
  const agrees = unit === "USD" ? moneyAgrees : unit === "ratio" ? ratioAgrees
    : (left, right) => left !== null && right !== null && left === right;
  const status = computed === null || stated === null
    ? STEP_STATUS.unchecked
    : agrees(computed, stated) ? STEP_STATUS.reproduced : STEP_STATUS.mismatch;
  const format = FORMAT[unit] ?? ((value) => String(value ?? "—"));
  return Object.freeze({
    id,
    label,
    expression,
    unit,
    operands: Object.freeze(operands.map((operand) => Object.freeze({ ...operand }))),
    computed,
    stated,
    status,
    computedText: format(computed),
    statedText: format(stated),
  });
}

function operand(name, value, unit) {
  return { name, value, unit, text: (FORMAT[unit] ?? String)(value) };
}

// ---------------------------------------------------------------------------
// The steps.
// ---------------------------------------------------------------------------

/**
 * The record set, its coverage ratio, and the grade that ratio earns.
 *
 * `confidenceFor` is the contract's own function. The missing-input list is read
 * off the briefing rather than recomputed, because it is a statement about what
 * the analysis had at the time, which no later reader can re-observe.
 */
function coverageSteps(briefing, results) {
  const coverage = briefing?.coverage ?? {};
  const joined = finite(results?.quality?.joinedRecords);
  const quarantined = finite(results?.quality?.quarantinedRecords);
  const analyzed = finite(coverage.recordsAnalyzed);
  const total = finite(coverage.recordsTotal);
  const missing = Array.isArray(coverage.missingInputs) ? coverage.missingInputs : [];
  const computedTotal = joined === null || quarantined === null ? null : joined + quarantined;
  const computedRatio = analyzed === null || total === null ? null : coverageRatio(analyzed, total);

  return [
    step({
      id: "records_total",
      label: "Records the analysis was handed",
      expression: "records_total = joined_records + set_aside_records",
      unit: "count",
      operands: [operand("joined_records", joined, "count"), operand("set_aside_records", quarantined, "count")],
      computed: computedTotal,
      stated: total,
    }),
    step({
      id: "coverage_ratio",
      label: "Share of those records the figure was computed over",
      expression: "coverage_ratio = records_analyzed ÷ records_total (0 ÷ 0 is defined as 0)",
      unit: "ratio",
      operands: [operand("records_analyzed", analyzed, "count"), operand("records_total", total, "count")],
      computed: computedRatio,
      stated: finite(coverage.coverageRatio),
    }),
    step({
      id: "grade",
      label: "Confidence grade the coverage ratio earns",
      expression:
        `grade = high if coverage_ratio ≥ ${COVERAGE_THRESHOLDS.high} and no required input is missing; `
        + `moderate if ≥ ${COVERAGE_THRESHOLDS.moderate}; low if > ${COVERAGE_THRESHOLDS.low}; `
        + "otherwise insufficient — then capped at moderate when the input "
        + `provenance score is under ${PROVENANCE_HIGH_FLOOR} of 100`,
      unit: "grade",
      operands: [
        operand("coverage_ratio", computedRatio, "ratio"),
        operand("missing_required_inputs", missing.length, "count"),
        // The cap's own operand, so a director checking the math sees the score
        // the ceiling was decided by rather than a grade that dropped a level
        // for a reason no step names. Read off the briefing, like the missing
        // list above it: it is a statement about what the analysis had.
        operand("input_provenance_score", finite(coverage.provenance?.score), "score"),
      ],
      computed: computedRatio === null
        ? null : confidenceFor(computedRatio, missing, coverage.provenance ?? null),
      stated: Object.values(BRIEFING_CONFIDENCE).includes(coverage.confidence) ? coverage.confidence : null,
    }),
  ];
}

/**
 * Recoverable spend, re-added from the per-department amounts.
 *
 * This is the step the routing figure lives or dies on: the briefing reports one
 * total, the departments beneath it carry the parts, and either they add up or
 * the total is describing something the parts do not.
 */
function recoverableSteps(briefing, results, figures) {
  const departments = Array.isArray(results?.rankedDepartments) ? results.rankedDepartments : [];
  const parts = departments.map((department, index) => ({
    value: finite(department?.recoverableUsd),
    rank: finite(department?.rank) ?? index + 1,
  }));
  const summable = parts.every((part) => part.value !== null);
  const summed = summable ? parts.reduce((total, part) => total + part.value, 0) : null;
  const analyzedSpend = finite(results?.spendUsd);
  const statedRecoverable = finite(results?.recoverableUsd);
  const steps = [
    step({
      id: "recoverable_sum",
      label: "Recoverable spend, re-added from the ranked departments",
      expression: "recoverable_scenario_usd = Σ(per-department recoverable_usd over ranked_departments)",
      unit: "USD",
      operands: parts.map((part) => operand(`rank_${part.rank}_recoverable_usd`, part.value, "USD")),
      computed: summed,
      stated: statedRecoverable,
    }),
  ];

  // The share is only meaningful against a positive base; a share of zero spend
  // is not "0%", it is a division that was never defined.
  const statedShare = finite(figures?.recoverableSpend?.inputs?.recoverableShareOfAnalyzedSpend);
  steps.push(step({
    id: "recoverable_share",
    label: "Recoverable spend as a share of analyzed spend",
    expression: "recoverable_share = recoverable_scenario_usd ÷ analyzed_spend_usd "
      + "(a non-positive base is defined as 0)",
    unit: "ratio",
    operands: [
      operand("recoverable_scenario_usd", statedRecoverable, "USD"),
      operand("analyzed_spend_usd", analyzedSpend, "USD"),
    ],
    computed: statedRecoverable === null || analyzedSpend === null
      ? null
      : roundToStoredPrecision(analyzedSpend > 0 ? statedRecoverable / analyzedSpend : 0),
    stated: statedShare,
  }));

  // The headline figure, re-derived from the contract's own stated operands
  // rather than from a rule this module keeps. Which operands those are depends
  // on which candidate the contract selected, and the contract says which.
  const metric = briefing?.materialMetric ?? null;
  const inputs = Array.isArray(briefing?.arithmeticInputs?.inputs) ? briefing.arithmeticInputs.inputs : [];
  const named = (name) => finite(inputs.find((input) => input?.name === name)?.value);
  if (metric && metric.candidate === MATERIAL_CANDIDATE.recoverableScenario) {
    steps.push(step({
      id: "headline_metric",
      label: "The headline figure, from the operands the briefing states",
      expression: "headline_usd = recoverable_scenario_usd",
      unit: "USD",
      operands: [operand("recoverable_scenario_usd", named("recoverable_scenario_usd"), "USD")],
      computed: named("recoverable_scenario_usd"),
      stated: finite(metric.value),
    }));
  } else if (metric && metric.candidate === MATERIAL_CANDIDATE.spendChange) {
    const reporting = named("reporting_period_spend_usd");
    const prior = named("prior_period_spend_usd");
    steps.push(step({
      id: "headline_metric",
      label: "The headline figure, from the operands the briefing states",
      expression: "headline_usd = reporting_period_spend_usd − prior_period_spend_usd",
      unit: "USD",
      operands: [
        operand("reporting_period_spend_usd", reporting, "USD"),
        operand("prior_period_spend_usd", prior, "USD"),
      ],
      computed: reporting === null || prior === null ? null : reporting - prior,
      stated: finite(metric.value),
    }));
  }
  return steps;
}

/** The file rounds stored ratios to six places; a comparison must round the same way. */
function roundToStoredPrecision(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * How much of the *money* the rubric could score, and whether that is enough for
 * the figure to read as complete.
 *
 * Absent when the payload carries no `figures` block — a briefing written before
 * that block existed can still have its coverage and its total checked, and
 * saying "not checked" is the honest report of a step whose operands are not in
 * the file.
 */
function attributionSteps(figures) {
  const inputs = figures?.attributedShare?.inputs;
  if (!inputs) return [];
  const attributed = finite(inputs.attributedSpendUsd);
  const unattributed = finite(inputs.unattributedSpendUsd);
  const total = attributed === null || unattributed === null ? null : attributed + unattributed;
  const computedShare = total === null ? null : roundToStoredPrecision(total > 0 ? attributed / total : 0);
  const steps = [step({
    id: "attributed_share",
    label: "Share of analyzed spend the rubric could attribute to a department",
    expression: "attributed_share = attributed_spend_usd ÷ (attributed_spend_usd + unattributed_spend_usd) "
      + "(a non-positive base is defined as 0)",
    unit: "ratio",
    operands: [
      operand("attributed_spend_usd", attributed, "USD"),
      operand("unattributed_spend_usd", unattributed, "USD"),
    ],
    computed: computedShare,
    stated: finite(figures?.attributedShare?.value),
  })];

  const completeness = figures?.recoverableSpend?.completeness;
  if (completeness && typeof completeness.complete === "boolean") {
    const gradeIsHigh = completeness.confidence === BRIEFING_CONFIDENCE.high;
    const fullyAttributed = computedShare !== null && computedShare >= 1 - RATIO_TOLERANCE;
    steps.push(step({
      id: "completeness",
      label: "Whether the headline figure may read as a complete total",
      expression: "complete = (grade is high) and (attributed_share ≥ 1)",
      unit: "grade",
      operands: [
        operand("grade", completeness.confidence ?? null, "grade"),
        operand("attributed_share", computedShare, "ratio"),
      ],
      computed: computedShare === null ? null : String(gradeIsHigh && fullyAttributed),
      stated: String(completeness.complete),
    }));
  }
  return steps;
}

// ---------------------------------------------------------------------------
// The derivation.
// ---------------------------------------------------------------------------

/**
 * The rubric and classifier versions this briefing was produced under, each
 * beside the version this build would apply.
 *
 * The routing rubric is read off the ranked departments, where
 * `evaluateDownRoutingCandidate` stamped it at analysis time — never off
 * `briefing.rubricVersion`, which the contract stamps from whichever build
 * rebuilt the briefing and therefore always answers "today".
 */
export function derivationVersions(payload) {
  const departments = Array.isArray(payload?.results?.rankedDepartments) ? payload.results.rankedDepartments : [];
  let stampedRubric = null;
  for (const department of departments) {
    const version = readVersion(department?.downRouting?.ruleVersion);
    if (version) {
      stampedRubric = version;
      break;
    }
  }
  const statedContract = readVersion(payload?.briefingContractVersion ?? payload?.briefing?.contractVersion);
  return Object.freeze({
    rubric: Object.freeze({
      stated: stampedRubric,
      current: DOWN_ROUTING_RULE_VERSION,
      matches: stampedRubric === DOWN_ROUTING_RULE_VERSION,
    }),
    contract: Object.freeze({
      stated: statedContract,
      current: CONTRACT_VERSION,
      matches: statedContract === CONTRACT_VERSION,
    }),
    // The classifier that decided which spend belongs to which org unit. It
    // grades nothing on its own, but it decides the denominator every share
    // below is taken against, so it is named beside the rubric rather than
    // buried in the attribution step.
    attribution: Object.freeze({ stated: readVersion(payload?.figures?.attributedShare?.inputs?.attributionVersion) }),
    analysisSchema: Object.freeze({ stated: readVersion(payload?.results?.schemaVersion) }),
    file: Object.freeze({ stated: readVersion(payload?.briefingFileVersion) }),
    derivation: DERIVATION_VERSION,
  });
}

function verdictFor(steps, versions, hasHeadlineFigure) {
  const checkable = steps.filter((entry) => entry.status !== STEP_STATUS.unchecked);
  if (steps.some((entry) => entry.status === STEP_STATUS.mismatch)) {
    return DERIVATION_VERDICT.arithmeticMismatch;
  }
  if (!hasHeadlineFigure || !checkable.length) return DERIVATION_VERDICT.inputsAbsent;
  if (!versions.contract.matches) return DERIVATION_VERDICT.contractMismatch;
  if (!versions.rubric.stated) return DERIVATION_VERDICT.rubricUnknown;
  if (!versions.rubric.matches) return DERIVATION_VERDICT.rubricSuperseded;
  return DERIVATION_VERDICT.reproduced;
}

/**
 * Re-derive a briefing's figures from the operands it carries.
 *
 * @param payload a briefing file payload — `{ briefing, results, figures?,
 *   scenario?, briefingContractVersion?, briefingFileVersion? }` — as written by
 *   `buildBriefing` and read back by `parseSavedBriefing`. A fresh briefing and a
 *   restored one go through this same call, so the two surfaces cannot disagree.
 * @returns a frozen derivation. Total: it never throws, whatever the payload
 *   holds, because a check that crashes on a malformed file tells the reader
 *   less than one that reports what it could not check.
 */
export function briefingDerivation(payload) {
  const briefing = payload && typeof payload === "object" ? payload.briefing ?? null : null;
  const results = payload && typeof payload === "object" ? payload.results ?? null : null;
  const figures = payload && typeof payload === "object" ? payload.figures ?? null : null;
  const versions = derivationVersions(payload ?? {});

  const steps = briefing
    ? [...coverageSteps(briefing, results), ...recoverableSteps(briefing, results, figures),
      ...attributionSteps(figures)]
    : [];

  // Stated inputs are the operands, deduplicated by name in the order the steps
  // consume them: the list a reader checks against their own source before
  // reading a single result.
  const seen = new Set();
  const inputs = [];
  for (const entry of steps) {
    for (const item of entry.operands) {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      inputs.push(Object.freeze({ ...item }));
    }
  }

  const verdict = verdictFor(steps, versions, Boolean(briefing?.materialMetric));
  const gradeStep = steps.find((entry) => entry.id === "grade") ?? null;
  const recoverableStep = steps.find((entry) => entry.id === "recoverable_sum") ?? null;

  return Object.freeze({
    derivationVersion: DERIVATION_VERSION,
    verdict,
    reproducible: verdict === DERIVATION_VERDICT.reproduced,
    statement: VERDICT_STATEMENT[verdict],
    versions,
    inputs: Object.freeze(inputs),
    steps: Object.freeze(steps),
    // The two figures the whole view exists to defend, lifted out of the step
    // list so a consumer never has to find them by index.
    recoverable: Object.freeze({
      computed: recoverableStep?.computed ?? null,
      stated: recoverableStep?.stated ?? null,
      status: recoverableStep?.status ?? STEP_STATUS.unchecked,
    }),
    grade: Object.freeze({
      computed: gradeStep?.computed ?? null,
      stated: gradeStep?.stated ?? null,
      status: gradeStep?.status ?? STEP_STATUS.unchecked,
    }),
    weights: GRADE_WEIGHTS,
    tolerances: RECONCILIATION_TOLERANCE,
  });
}

/**
 * A derivation as one deterministic block of plain text: the same statement, the
 * same inputs, and the same steps a screen reader hears, in the order it hears
 * them.
 *
 * This is what a golden fixture compares against and what a reader can paste
 * into a dispute. Deriving it from the model rather than from the DOM is what
 * makes a drifted number fail a unit test rather than only a browser test.
 */
export function derivationTranscript(derivation) {
  const lines = [
    `Verdict: ${derivation.verdict}`,
    derivation.statement,
    `Routing rubric: ${derivation.versions.rubric.stated ?? "not stated"} `
      + `(this build applies ${derivation.versions.rubric.current})`,
    `Briefing contract: ${derivation.versions.contract.stated ?? "not stated"}`,
    `Attribution classifier: ${derivation.versions.attribution.stated ?? "not stated"}`,
    "Stated inputs:",
    ...derivation.inputs.map((input) => `  ${input.name} = ${input.text}`),
    "Steps:",
  ];
  derivation.steps.forEach((entry, index) => {
    lines.push(`  ${index + 1}. ${entry.label}`);
    lines.push(`     ${entry.expression}`);
    lines.push(`     recomputed ${entry.computedText} · briefing states ${entry.statedText} · ${entry.status}`);
  });
  return lines.join("\n");
}
