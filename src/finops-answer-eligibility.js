// May this claim be published? — the eligibility layer over #1463's contract.
//
// `finops-answer-contract.js` decides WHAT the answer is. It does not decide
// whether the finding underneath it is good enough to put in front of an
// executive, and it carries no record of which rule decided. So a leader who is
// handed "$43,200 a year" has no way to reconstruct the judgement: which
// threshold governed, what the finding was, what would have withheld it.
//
// This module adds exactly that, and nothing else:
//
//   * it classifies a synthetic finding as `eligible` / `incomplete` /
//     `conflicting`, against named exported thresholds;
//   * it returns the four claim elements a leader actually reads — headline,
//     benchmark, confidence, next action — taken FIELD BY FIELD from the record
//     `resolveFinopsAnswer` returned. It derives no figure of its own;
//   * it returns a machine-readable reason list and the provenance of the
//     finding, so the number and the judgement travel together.
//
// EVERY THRESHOLD IS A NAMED EXPORT WITH ITS ASSUMPTION WRITTEN DOWN. There is
// no inline magic number below, and `CLAIM_RULE` publishes the whole table so a
// reader can reconstruct any status by hand. The assumptions are stated so a
// director whose team a status grades can dispute the ASSUMPTION rather than
// argue with an opaque number.
//
// A NON-ELIGIBLE CLAIM PUBLISHES NO NUMBER AT ALL. Not a downgraded one, not a
// rounded one, not a "roughly". All four elements go null and the reasons say
// which field was missing or which two sources disagreed. A figure a leader
// cannot trace is worse than no figure — the same rule #1463 holds itself to.
//
// Pure: no DOM, no storage, no clock, no network. Fixtures and live analysis
// arrive as arguments.
import {
  ANSWER_STATUS, CONFIDENCE_THRESHOLD, CONFLICT_ABSOLUTE_USD, CONFLICT_RELATIVE,
  FINOPS_ANSWER_CONTRACT, WITHHELD, finopsAnswerSignals, resolveFinopsAnswer,
} from "./finops-answer-contract.js";

export const FINOPS_CLAIM_EVALUATION = "finops-claim-eligibility/1.0.0";

/** The three classes a finding can land in. There is no fourth, and there is
 *  no "publish it anyway with a caveat": that is what `incomplete` refuses. */
export const CLAIM_STATUS = Object.freeze({
  eligible: "eligible", incomplete: "incomplete", conflicting: "conflicting",
});

/** Machine-readable reason codes. Each reason also names the `field` it is
 *  about, so a caller can point at the input rather than at a sentence. */
export const CLAIM_REASON = Object.freeze({
  missingField: "missing-field",
  sampleTooSmall: "sample-too-small",
  confidenceBelowFloor: "confidence-below-floor",
  conflictingSavings: "conflicting-savings",
  inconsistentPercent: "inconsistent-percent",
  contractWithheld: "contract-withheld",
});

export const RULE_OUTCOME = Object.freeze({
  pass: "pass", fail: "fail", skipped: "skipped",
});

// ── The thresholds, each with the assumption it rests on ──────────────────────

/**
 * The fields a claim is defined from. A finding missing any one of them cannot
 * be checked by the reader it is shown to.
 *
 * ASSUMPTION: these six are the inputs #1463's contract consumes, so the list
 * is not a taste judgement — it is the contract's own dependency set, and a
 * seventh input added there has to be added here or a claim would publish from
 * a field nobody validated.
 */
export const REQUIRED_FINDING_FIELDS = Object.freeze([
  "id", "baseline", "benchmark", "confidence", "readiness", "recommendedActions",
]);

/**
 * The fewest spend rows the annual baseline may be summed over.
 *
 * ASSUMPTION: a savings percentage divides by that baseline, so a claim summed
 * over zero rows divides by an invented denominator. The floor is 1 and not
 * higher ON PURPOSE, and this is the weight most worth disputing: every bundled
 * synthetic scenario in this repository carries a single department, so a floor
 * of 3 would withhold every claim the live page can currently make and the rule
 * would never be exercised against the real surface. Raise it the day the
 * bundled scenarios carry multi-department samples, not before.
 */
export const MIN_BASELINE_SAMPLE_ROWS = 1;

/**
 * The evidence-confidence value a claim must reach before a figure is
 * published, on the analysis's existing 0–100 signal.
 *
 * ASSUMPTION: no new score is invented here. This is #1463's own `medium` cut
 * reused as the publication floor, because below it the readiness analysis
 * already declines to call the evidence sufficient — so publishing there would
 * contradict a verdict this page states elsewhere on the same screen.
 */
export const MIN_PUBLISHABLE_CONFIDENCE = CONFIDENCE_THRESHOLD.medium;

/**
 * The share of the analyzed baseline a modelled saving must reach before the
 * benchmark is described as material.
 *
 * ASSUMPTION: at executive scale a saving under 1% of the baseline is inside
 * the noise of the estimate that produced it, so calling it material would
 * overstate what the finding supports. It does NOT withhold the claim: the
 * figure is still traceable and still published, flagged `material: false`, on
 * the assumption that hiding a number a reader can compute loses more trust
 * than showing a small one.
 */
export const MIN_MATERIAL_SAVINGS_PERCENT = 1;

/** Rule ids, so a caller names a rule without matching on prose. */
export const CLAIM_RULE_ID = Object.freeze({
  requiredFields: "required-fields",
  minSample: "min-baseline-sample-rows",
  minConfidence: "min-publishable-confidence",
  savingsAgreement: "savings-agreement",
  materiality: "materiality",
});

/**
 * The whole rule table, in evaluation order, published so a status can be
 * reconstructed by hand. `constants` names every exported constant the rule
 * reads, so a threshold cannot be added to the derivation without appearing
 * here — and `tests/finops-answer-eligibility.test.js` fails a rule that no
 * fixture drives to both a pass and a fail.
 */
export const CLAIM_RULE = Object.freeze([
  Object.freeze({
    id: CLAIM_RULE_ID.requiredFields,
    constants: Object.freeze({ REQUIRED_FINDING_FIELDS }),
    assumption: "A claim may only be published from the six fields the answer contract consumes,"
      + " because a reader cannot check a figure derived from a field nobody validated.",
  }),
  Object.freeze({
    id: CLAIM_RULE_ID.minSample,
    constants: Object.freeze({ MIN_BASELINE_SAMPLE_ROWS }),
    assumption: "The annual baseline must be summed over at least one spend row, because a"
      + " percentage of a baseline sampled from nothing divides by an invented denominator.",
  }),
  Object.freeze({
    id: CLAIM_RULE_ID.minConfidence,
    constants: Object.freeze({ MIN_PUBLISHABLE_CONFIDENCE }),
    assumption: "Evidence confidence must reach the analysis's own medium cut of 50 of 100,"
      + " because below it this page already declines to call the evidence sufficient.",
  }),
  Object.freeze({
    id: CLAIM_RULE_ID.savingsAgreement,
    constants: Object.freeze({ CONFLICT_ABSOLUTE_USD, CONFLICT_RELATIVE }),
    assumption: "Two findings that state different savings for the same metric, beyond a dollar"
      + " or half a percent of rounding, are named as a disagreement rather than averaged,"
      + " because an average publishes a figure neither of them states.",
  }),
  Object.freeze({
    id: CLAIM_RULE_ID.materiality,
    constants: Object.freeze({ MIN_MATERIAL_SAVINGS_PERCENT }),
    assumption: "A saving under 1% of the analyzed baseline sits inside the noise of the estimate"
      + " that produced it, so it is published as immaterial rather than as a headline.",
  }),
]);

const RULE_BY_ID = Object.freeze(Object.fromEntries(CLAIM_RULE.map((rule) => [rule.id, rule])));

/**
 * The rule reported as governing when nothing failed.
 *
 * ASSUMPTION: an eligible claim cleared every gate, so no single one "decided"
 * it. Naming the confidence floor is a stated convention, not a computation:
 * it is the last gate standing between a complete finding and publication, and
 * a reader is told that here rather than left to infer a ranking.
 */
export const DEFAULT_GOVERNING_RULE = CLAIM_RULE_ID.minConfidence;

/**
 * The longest untrusted finding narrative carried into provenance.
 *
 * ASSUMPTION: narrative text is UNTRUSTED INPUT. It is authored by whoever
 * produced the finding and may be shaped to instruct a reader — or a model —
 * rather than to describe a cost. It is escaped and bounded here so it can
 * never be anything but inert quoted evidence, and it reaches no derivation.
 */
export const MAX_NARRATIVE_CHARS = 240;

const ESCAPES = Object.freeze({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
});

/**
 * Render untrusted finding text inert.
 *
 * Markup characters are escaped, every run of whitespace — newlines included —
 * collapses to one space, and the result is bounded. The collapse matters as
 * much as the escaping: line-oriented injections ("\nIgnore all previous
 * instructions…") read as a fresh instruction only while they own a line.
 */
export function inertText(value) {
  if (typeof value !== "string") return "";
  const flat = value.replace(/\s+/g, " ").trim().replace(/[&<>"']/g, (char) => ESCAPES[char]);
  return flat.length > MAX_NARRATIVE_CHARS ? `${flat.slice(0, MAX_NARRATIVE_CHARS)}…` : flat;
}

// ── Field validation ──────────────────────────────────────────────────────────

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const filled = (value) => typeof value === "string" && value.trim().length > 0;
const positive = (value) => Number.isFinite(value) && value > 0;

const READABLE_ACTION = (action) => isRecord(action) && filled(action.id) && filled(action.label)
  && Number.isFinite(action.monthlySavingsUsd);

/** One predicate per required field, so "missing" means the same thing twice. */
const FIELD_PRESENT = Object.freeze({
  id: (finding) => filled(finding.id),
  baseline: (finding) => isRecord(finding.baseline) && filled(finding.baseline.sourceId)
    && (positive(finding.baseline.annualSpendUsd) || positive(finding.baseline.monthlySpendUsd)),
  benchmark: (finding) => isRecord(finding.benchmark) && filled(finding.benchmark.sourceId)
    && filled(finding.benchmark.label) && Number.isFinite(finding.benchmark.value)
    && filled(finding.benchmark.unit),
  confidence: (finding) => isRecord(finding.confidence) && filled(finding.confidence.sourceId)
    && Number.isFinite(finding.confidence.value),
  readiness: (finding) => isRecord(finding.readiness) && filled(finding.readiness.sourceId)
    && filled(finding.readiness.level),
  recommendedActions: (finding) => Array.isArray(finding.recommendedActions)
    && finding.recommendedActions.length > 0 && finding.recommendedActions.every(READABLE_ACTION),
});

/** The finding, read as the signal set #1463's contract already takes. Nothing
 *  is renamed and nothing is recomputed: the two shapes are the same shape. */
function signalsFromFinding(finding) {
  return {
    recommendedActions: finding.recommendedActions,
    baseline: finding.baseline,
    benchmark: finding.benchmark,
    confidence: finding.confidence,
    readiness: finding.readiness,
    statedAnnualSavingsUsd: finding.statedAnnualSavingsUsd ?? [],
    statedSavingsPercent: finding.statedSavingsPercent ?? null,
  };
}

const reason = (code, field, sentence) => Object.freeze({ code, field, sentence });

const NULL_CLAIM = Object.freeze({
  headline: null, benchmark: null, confidence: null, nextAction: null,
});

/** The confidence statement, from one template, so two claims at the same value
 *  never read as two different verdicts. */
export function confidenceStatement(level, value) {
  return `${level} confidence, ${value} of 100 on the analysis's evidence-confidence signal.`;
}

/**
 * Evaluate a synthetic finding into one publishable-or-not claim.
 *
 * @param finding the synthetic finding — the contract's signal set plus `id`,
 *   `sampleRowCount`, and an optional untrusted `narrative`.
 * @param provenance `{ fixtureId, source }` naming where the finding came from.
 * @returns a frozen record: `status`, the four claim elements (all null unless
 *   eligible), `reasons`, `ruleOutcomes`, and `provenance`.
 */
export function evaluateFinopsClaim(finding, provenance = {}) {
  const input = isRecord(finding) ? finding : {};
  const missing = REQUIRED_FINDING_FIELDS.filter((field) => !FIELD_PRESENT[field](input));
  const rows = Number.isFinite(input.sampleRowCount) ? input.sampleRowCount : 0;
  const confidenceValue = isRecord(input.confidence) && Number.isFinite(input.confidence.value)
    ? input.confidence.value : null;

  const outcomes = {};
  const reasons = [];
  const pass = (id, ok) => { outcomes[id] = ok ? RULE_OUTCOME.pass : RULE_OUTCOME.fail; return ok; };

  const fieldsOk = pass(CLAIM_RULE_ID.requiredFields, missing.length === 0);
  for (const field of missing) {
    reasons.push(reason(CLAIM_REASON.missingField, field,
      `The required field ${field} is missing or unreadable, so no figure is published from it.`));
  }

  if (!pass(CLAIM_RULE_ID.minSample, rows >= MIN_BASELINE_SAMPLE_ROWS)) {
    reasons.push(reason(CLAIM_REASON.sampleTooSmall, "sampleRowCount",
      `The baseline is summed over ${rows} spend rows, below the minimum of`
      + ` ${MIN_BASELINE_SAMPLE_ROWS}, so the share it would be a share of is not sampled.`));
  }

  if (!pass(CLAIM_RULE_ID.minConfidence,
    confidenceValue !== null && confidenceValue >= MIN_PUBLISHABLE_CONFIDENCE)) {
    reasons.push(reason(CLAIM_REASON.confidenceBelowFloor, "confidence.value",
      `Evidence confidence is ${confidenceValue ?? "unstated"} of 100, below the publication`
      + ` floor of ${MIN_PUBLISHABLE_CONFIDENCE}.`));
  }

  // The contract is the only thing that derives a figure. It runs only once the
  // fields it consumes are all readable, so a missing input is reported as a
  // missing input rather than as whatever the contract refused it for second.
  const answer = fieldsOk ? resolveFinopsAnswer(signalsFromFinding(input)) : null;
  const code = answer?.withheldReason?.code ?? null;
  const conflicted = code === WITHHELD.conflictingSavings || code === WITHHELD.inconsistentPercent;

  if (!answer) outcomes[CLAIM_RULE_ID.savingsAgreement] = RULE_OUTCOME.skipped;
  else if (!pass(CLAIM_RULE_ID.savingsAgreement, !conflicted)) {
    reasons.push(code === WITHHELD.conflictingSavings
      ? reason(CLAIM_REASON.conflictingSavings, "annualSavingsUsd",
        "Two sources state a different annual savings figure for this finding — its own"
        + " recommended actions and a separately stated annual total — so neither is published.")
      : reason(CLAIM_REASON.inconsistentPercent, "savingsPercent",
        "The stated savings percentage disagrees with the one this finding's own figures"
        + " compute to, so neither is published."));
  }

  // Anything the contract withheld that is not a disagreement is a missing or
  // unusable input by another name, and lands in the incomplete class.
  if (answer && code && !conflicted) {
    reasons.push(reason(CLAIM_REASON.contractWithheld, "contract",
      `${answer.withheldReason.sentence} (${FINOPS_ANSWER_CONTRACT}, code ${code})`));
  }

  const answered = answer?.status === ANSWER_STATUS.answered;
  const material = answered && answer.savingsPercent >= MIN_MATERIAL_SAVINGS_PERCENT;
  if (!answered) outcomes[CLAIM_RULE_ID.materiality] = RULE_OUTCOME.skipped;
  else pass(CLAIM_RULE_ID.materiality, material);

  const blocked = reasons.some((entry) => entry.code !== CLAIM_REASON.conflictingSavings
    && entry.code !== CLAIM_REASON.inconsistentPercent);
  // Incomplete outranks conflicting, matching the contract's own rule order: a
  // disagreement between two figures cannot be judged on inputs that are absent.
  const status = blocked ? CLAIM_STATUS.incomplete
    : (conflicted ? CLAIM_STATUS.conflicting : CLAIM_STATUS.eligible);
  const eligible = status === CLAIM_STATUS.eligible && answered;

  const governing = CLAIM_RULE.find((rule) => outcomes[rule.id] === RULE_OUTCOME.fail)?.id
    ?? DEFAULT_GOVERNING_RULE;

  return Object.freeze({
    evaluation: FINOPS_CLAIM_EVALUATION,
    contract: FINOPS_ANSWER_CONTRACT,
    status,
    claim: eligible ? Object.freeze({
      headline: Object.freeze({
        annualSavingsUsd: answer.annualSavingsUsd,
        savingsPercent: answer.savingsPercent,
        annualBaselineSpendUsd: answer.annualBaselineSpendUsd,
      }),
      benchmark: Object.freeze({
        label: answer.benchmark.label, value: answer.benchmark.value,
        unit: answer.benchmark.unit, material,
      }),
      confidence: Object.freeze({
        level: answer.confidence.level, value: answer.confidence.value,
        statement: confidenceStatement(answer.confidence.level, answer.confidence.value),
      }),
      nextAction: Object.freeze({
        id: answer.primaryAction.id, label: answer.primaryAction.label,
        department: answer.primaryAction.department,
        monthlySavingsUsd: answer.primaryAction.monthlySavingsUsd,
      }),
    }) : NULL_CLAIM,
    reasons: Object.freeze(reasons),
    ruleOutcomes: Object.freeze(outcomes),
    provenance: Object.freeze({
      findingId: filled(input.id) ? input.id : null,
      fixtureId: filled(provenance.fixtureId) ? provenance.fixtureId : null,
      source: filled(provenance.source) ? provenance.source : "unnamed-finding",
      governingRule: governing,
      assumption: RULE_BY_ID[governing].assumption,
      narrative: inertText(input.narrative),
    }),
  });
}

/**
 * The page's bundled analysis, read as one synthetic finding.
 *
 * It restates nothing: the signal set is #1463's own adapter, and the two
 * fields added here — the row count the baseline is summed over, and the
 * finding's own statement as untrusted text — are read straight off the
 * analysis record the page already loaded.
 */
export function finopsClaimFinding(analysis) {
  const signals = finopsAnswerSignals(analysis);
  if (!signals) return null;
  const rows = (analysis.sample?.departments ?? [])
    .filter((row) => Number.isFinite(row?.spendUsd)).length;
  return {
    ...signals,
    id: analysis.finding?.id ?? analysis.scenarioId ?? null,
    narrative: analysis.finding?.statement ?? "",
    sampleRowCount: rows,
  };
}
