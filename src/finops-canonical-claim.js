// The ONE place the four published FinOps claims are derived from a finding.
//
// THE DEFECT THIS EXISTS TO CLOSE (#1464). /evolution.html states an annual
// recoverable figure, the benchmark under it, how far it may be trusted, and the
// one move it implies. Each of those four was authored, seeded or painted by a
// different module, so nothing stopped one of them from moving while the other
// three stood still — the exact failure a graded director would open the review
// with. Every one of them now comes out of `deriveCanonicalClaim`, from a single
// named evidence case, or none of them is published at all.
//
// WITHHOLDING IS A RESULT, NOT A FAILURE. An executive view may show no number;
// it may not show an unexplainable one. Evidence that is missing a field this
// contract is defined over resolves `insufficient`, and evidence carrying two
// findings that disagree resolves `conflicted` WITH THE DISAGREEMENT NAMED —
// never silently resolved by preferring one of them.
//
// EVERY WEIGHT CARRIES ITS ASSUMPTION. `WEIGHT` holds no bare number: each entry
// pairs the value with the sentence justifying it, and the derived record
// reports only the weights it actually applied. The page renders those
// sentences, so a threshold cannot reach a reader without its justification.
//
// FINDING TEXT IS UNTRUSTED. A workload name, a department or an action label
// may have originated in a file someone else wrote. Everything that becomes
// displayed text goes through `redactClaimText` first — see its own note.
//
// Pure: no DOM, no storage, no clock, no network, no locale-dependent sort.

import { formatUsd, redactForScoring } from "./evolution.js";

export const FINOPS_CANONICAL_CLAIM = "finops-canonical-claim/1.0.0";

/** The three states a published claim may be in. There is no fourth. */
export const CLAIM_STATUS = Object.freeze({
  eligible: "eligible",
  insufficient: "insufficient",
  conflicted: "conflicted",
});

/**
 * Every weight and threshold this contract applies, with the assumption behind
 * it stated as data rather than as a comment.
 *
 * The assumption is the reviewable part. A director disputing a score disputes
 * these sentences, not the arithmetic, so they are what the page shows beside
 * the figure and what the fixtures assert against.
 */
export const WEIGHT = Object.freeze({
  annualisationMonths: Object.freeze({
    key: "annualisationMonths",
    value: 12,
    assumption: "A monthly recoverable figure is annualised by 12 only when the finding"
      + " states the baseline period it was measured over. Without that period the"
      + " multiplier is an assumption about how long the saving lasts, not a measurement.",
  }),
  materialSampleCount: Object.freeze({
    key: "materialSampleCount",
    value: 12,
    assumption: "A benchmark counts as material from 12 sampled billing days — one working"
      + " fortnight. Below that a single billing spike moves the figure more than the lever"
      + " does, so the benchmark is treated as absent rather than as weak evidence.",
  }),
  confidenceCoverageCut: Object.freeze({
    key: "confidenceCoverageCut",
    value: 0.5,
    highValue: 0.8,
    assumption: "Confidence is read off the share of analyzed spend the rubric actually"
      + " scored, at the same 50% and 80% cut points the page's existing recoverable"
      + "-confidence grade publishes, so the two statements cannot disagree.",
  }),
  conflictTolerance: Object.freeze({
    key: "conflictTolerance",
    value: 1,
    relative: 0.005,
    assumption: "Two findings are called conflicting when their monthly figures differ by"
      + " more than $1 or 0.5%, whichever is wider, so figures that only round differently"
      + " are not reported to an executive as a disagreement.",
  }),
});

/**
 * The order the rules run in, published so two readers agree on which status a
 * case that trips several of them reports.
 *
 * Completeness first: a disagreement between two findings cannot be judged
 * before both of them can be read.
 */
export const RULE_ORDER = Object.freeze(["completeness", "agreement", "materiality"]);

/** Confidence levels, named as the page's existing grade names them. */
export const CONFIDENCE_LEVEL = Object.freeze({
  low: "low", moderate: "moderate", high: "high",
});

/** Longest displayed text derived from an untrusted field. */
export const CLAIM_TEXT_LIMIT = 120;

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const filled = (value) => typeof value === "string" && value.trim().length > 0;
const list = (value) => (Array.isArray(value) ? value : []);
const positive = (value) => Number.isFinite(value) && value > 0;

/**
 * The redaction contract for finding text on its way to a reader or a judge.
 *
 * It composes the page's existing `redactForScoring` — which already removes
 * addresses, secrets, URLs and account-shaped digits — and then closes the two
 * things a FinOps finding adds:
 *
 *   * MARKUP DELIMITERS NEVER SURVIVE. Angle brackets are removed here, at the
 *     source, rather than trusted to a view: the page's own policy forbids
 *     executing user-generated markup, and this is where that policy is
 *     enforceable in a unit test.
 *   * INSTRUCTION TEXT IS NEUTRALISED. A finding label reading "ignore previous
 *     instructions" is prompt-injection aimed at whatever summarises this claim
 *     next. It is replaced by a marker rather than dropped, so a reader can see
 *     that something was removed.
 *
 * Length is capped so a pasted paragraph cannot become the headline's action.
 */
export function redactClaimText(text) {
  const neutralised = redactForScoring(String(text ?? ""))
    .replace(/[<>]/g, " ")
    .replace(/\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+instructions?\b/gi,
      "[instruction removed]")
    .replace(/\b(?:system|assistant|developer)\s*:/gi, "[role removed]")
    .replace(/\s+/g, " ")
    .trim();
  return neutralised.length > CLAIM_TEXT_LIMIT
    ? `${neutralised.slice(0, CLAIM_TEXT_LIMIT - 1).trimEnd()}…`
    : neutralised;
}

const percent = (share) => `${Math.round(share * 100)}%`;

function confidenceLevel(share) {
  if (share >= WEIGHT.confidenceCoverageCut.highValue) return CONFIDENCE_LEVEL.high;
  if (share >= WEIGHT.confidenceCoverageCut.value) return CONFIDENCE_LEVEL.moderate;
  return CONFIDENCE_LEVEL.low;
}

/** A finding readable enough to derive anything from, with what it is missing. */
function shortfalls(finding) {
  const missing = [];
  if (!isRecord(finding)) return [{ field: "finding", sentence: "No finding was supplied." }];
  if (!positive(finding.monthlySavingsUsd)) {
    missing.push({
      field: "monthlySavingsUsd",
      sentence: "The finding states no positive monthly recoverable figure, so there is"
        + " nothing to annualise.",
    });
  }
  if (!filled(finding.baselinePeriod)) {
    missing.push({
      field: "baselinePeriod",
      sentence: "The finding names no baseline period, so the annual figure would rest on an"
        + " unstated assumption about how long the saving lasts.",
    });
  }
  if (!filled(finding.action)) {
    missing.push({
      field: "action",
      sentence: "The finding carries no prioritized action, so the figure implies no move.",
    });
  }
  if (!Number.isFinite(finding.scoredSpendCoverage)) {
    missing.push({
      field: "scoredSpendCoverage",
      sentence: "The finding reports no scored-spend coverage, so how far the figure may be"
        + " trusted cannot be stated.",
    });
  }
  const benchmark = finding.benchmark;
  if (!isRecord(benchmark) || !filled(benchmark.label) || !positive(benchmark.monthlyUsd)) {
    missing.push({
      field: "benchmark",
      sentence: "No benchmark accompanies the figure, so nothing supports it.",
    });
  } else if (!Number.isFinite(benchmark.sampleCount)) {
    missing.push({
      field: "benchmark.sampleCount",
      sentence: "The benchmark states no sample count, so whether it is material cannot be"
        + " decided.",
    });
  } else if (benchmark.sampleCount < WEIGHT.materialSampleCount.value) {
    missing.push({
      field: "benchmark.sampleCount",
      sentence: `The benchmark rests on ${benchmark.sampleCount} sampled billing days, under`
        + ` the ${WEIGHT.materialSampleCount.value} this contract treats as material.`,
    });
  }
  return missing;
}

/** True when two monthly figures differ by more than the stated tolerance. */
function figuresDisagree(left, right) {
  const gap = Math.abs(left - right);
  const allowed = Math.max(
    WEIGHT.conflictTolerance.value,
    Math.max(Math.abs(left), Math.abs(right)) * WEIGHT.conflictTolerance.relative);
  return gap > allowed;
}

/** Every way the findings in one case disagree, named rather than resolved. */
function disagreements(findings) {
  const found = [];
  const figures = findings.map((finding) => finding.monthlySavingsUsd);
  const low = Math.min(...figures);
  const high = Math.max(...figures);
  if (figures.length > 1 && figuresDisagree(low, high)) {
    found.push({
      field: "monthlySavingsUsd",
      values: Object.freeze(figures.map((figure) => formatUsd(figure))),
      sentence: `Two findings in this case state different monthly recoverable figures —`
        + ` ${formatUsd(low)} and ${formatUsd(high)} a month — so neither is quoted as the`
        + " answer.",
    });
  }
  const actions = [...new Set(findings.map((finding) => redactClaimText(finding.action)))];
  if (actions.length > 1) {
    found.push({
      field: "action",
      values: Object.freeze(actions),
      sentence: `Two findings in this case prioritize different moves — "${actions[0]}" and`
        + ` "${actions[1]}" — so no single next action is published.`,
    });
  }
  return found;
}

const withheld = (status, provenance, applied, detail) => Object.freeze({
  contract: FINOPS_CANONICAL_CLAIM,
  status,
  publishable: false,
  provenance,
  claims: Object.freeze({
    annualHeadline: null, materialBenchmark: null, confidence: null, nextAction: null,
  }),
  appliedWeights: Object.freeze(applied),
  shortfalls: Object.freeze(detail.shortfalls ?? []),
  disagreements: Object.freeze(detail.disagreements ?? []),
});

/**
 * Derive the four published claims from one named evidence case.
 *
 * THIS IS THE ONLY ENTRY POINT. No caller — page, view, seed or test — may
 * compute an annual figure, a materiality verdict, a confidence level or a
 * prioritized action of its own; each of those is a field of the record this
 * returns.
 *
 * @param evidence `{ id, label, findings: [finding] }`, where a finding carries
 *   `monthlySavingsUsd`, `baselinePeriod`, `action`, `scoredSpendCoverage` and a
 *   `benchmark` of `{ label, monthlyUsd, sampleCount }`. See
 *   finops-canonical-claim-fixtures.js for labelled cases of each outcome.
 * @returns a frozen `finops-canonical-claim/1.0.0` record. Always a record: a
 *   caller never has to tell null apart from withheld.
 */
export function deriveCanonicalClaim(evidence) {
  const findings = list(evidence?.findings);
  const provenance = Object.freeze({
    caseId: filled(evidence?.id) ? evidence.id : "unnamed-case",
    caseLabel: redactClaimText(evidence?.label) || "an unnamed evidence case",
    findingCount: findings.length,
    findingIds: Object.freeze(findings.map((finding, index) =>
      (filled(finding?.id) ? finding.id : `finding-${index + 1}`))),
  });

  // RULE 1 — completeness. Every finding in the case must be readable, because a
  // case is published as a whole or not at all.
  const missing = findings.length
    ? findings.flatMap((finding) => shortfalls(finding))
    : [{ field: "findings", sentence: "The case carries no finding at all." }];
  if (missing.length) {
    return withheld(CLAIM_STATUS.insufficient, provenance,
      [WEIGHT.materialSampleCount, WEIGHT.annualisationMonths], { shortfalls: missing });
  }

  // RULE 2 — agreement. Two readable findings that disagree are reported as a
  // disagreement; picking the larger one is how an indefensible number ships.
  const disputed = disagreements(findings);
  if (disputed.length) {
    return withheld(CLAIM_STATUS.conflicted, provenance,
      [WEIGHT.conflictTolerance], { disagreements: disputed });
  }

  // RULE 3 — materiality already held above, so the case publishes.
  const finding = findings[0];
  const monthly = finding.monthlySavingsUsd;
  const annual = monthly * WEIGHT.annualisationMonths.value;
  const level = confidenceLevel(finding.scoredSpendCoverage);
  const action = redactClaimText(finding.action);
  const benchmark = finding.benchmark;

  return Object.freeze({
    contract: FINOPS_CANONICAL_CLAIM,
    status: CLAIM_STATUS.eligible,
    publishable: true,
    provenance,
    claims: Object.freeze({
      annualHeadline: Object.freeze({
        usd: annual,
        text: formatUsd(annual),
        basis: `${formatUsd(monthly)} a month over ${redactClaimText(finding.baselinePeriod)},`
          + ` annualised by ${WEIGHT.annualisationMonths.value}.`,
      }),
      materialBenchmark: Object.freeze({
        sampleCount: benchmark.sampleCount,
        text: `${formatUsd(benchmark.monthlyUsd)} a month from`
          + ` ${redactClaimText(benchmark.label)}, across ${benchmark.sampleCount} sampled`
          + " billing days.",
      }),
      confidence: Object.freeze({
        level,
        coverage: finding.scoredSpendCoverage,
        text: `Confidence ${level}: ${percent(finding.scoredSpendCoverage)} of analyzed spend`
          + ` sits in departments the rubric scored, against cut points at`
          + ` ${percent(WEIGHT.confidenceCoverageCut.value)} and`
          + ` ${percent(WEIGHT.confidenceCoverageCut.highValue)}.`,
      }),
      nextAction: Object.freeze({ text: action }),
    }),
    appliedWeights: Object.freeze([
      WEIGHT.annualisationMonths, WEIGHT.materialSampleCount, WEIGHT.confidenceCoverageCut,
      // Only when there was a second figure to compare against: a weight that
      // decided nothing here is not reported as one that did.
      ...(findings.length > 1 ? [WEIGHT.conflictTolerance] : []),
    ]),
    shortfalls: Object.freeze([]),
    disagreements: Object.freeze([]),
  });
}
