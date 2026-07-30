// Executable verdict contract for one retained FinOps action across two periods.
// It accepts derived numbers and evidence facts only. Unknown input fields
// (including prompt text) are never copied, inspected, or returned.

export const RECURRING_VERDICT_VERSION = "finops-recurring-verdict/1.0.0";

export const RECURRING_VERDICT_RULES = Object.freeze({
  direction: Object.freeze({
    assumption: "Lower monthly recoverable spend is improvement because it is spend the tracked action still seeks to remove.",
  }),
  materiality: Object.freeze({
    thresholdPercent: 5,
    assumption: "Changes below 5% are labelled stable because ordinary month-to-month variation is not separately modelled.",
  }),
  sampling: Object.freeze({
    minimumRows: 10,
    assumption: "Ten measured rows is the minimum sample used for a recurring directional claim; it is a review convention, not statistical significance.",
  }),
  coverage: Object.freeze({
    highPercent: 95,
    moderatePercent: 80,
    assumption: "At least 95% attributed spend leaves at most 5% outside the comparison; 80–94.9% is useful but explicitly bounded; lower coverage is low confidence. A figure outside 0–100 is not a coverage measurement and is read as missing.",
  }),
  confidence: Object.freeze({
    assumption: "Confidence describes evidence completeness, not attribution of the change to the tracked action. Comparable periods and a baseline are mandatory; coverage and sample size then select a band.",
  }),
});

const freeze = Object.freeze;
const finite = (value) => typeof value === "number" && Number.isFinite(value);

// Coverage is evidence only when it is a percentage. Local evidence is read back
// from storage a visitor can edit, and a finite-but-impossible figure is a
// corrupted record rather than measured attribution: without this bound a stored
// `1e9` reads as "at least 95%" and presents itself as high confidence. Anything
// outside 0–100 is therefore reported as missing coverage, not as coverage.
export const coveragePercentOrNull = (value) =>
  finite(value) && value >= 0 && value <= 100 ? value : null;

const WORDING = Object.freeze({
  improvement: "Measured recoverable spend is lower than the prior baseline.",
  regression: "Measured recoverable spend is higher than the prior baseline.",
  stable: "Measured recoverable spend is within the stability band around the prior baseline.",
  incomparable: "No directional verdict: the periods are not comparable.",
  missing_prior_evidence: "No directional verdict: prior baseline evidence is missing.",
});

function confidenceFor({ coveragePercent, sampleRows }) {
  const sampled = Number.isInteger(sampleRows)
    && sampleRows >= RECURRING_VERDICT_RULES.sampling.minimumRows;
  const coverage = coveragePercentOrNull(coveragePercent);
  if (coverage === null || !sampled) {
    return freeze({
      level: "low",
      basis: freeze([
        coverage === null ? "attribution_coverage_missing" : "attribution_coverage_measured",
        sampled ? "minimum_sample_met" : "minimum_sample_not_met",
      ]),
      assumption: RECURRING_VERDICT_RULES.confidence.assumption,
    });
  }
  const level = coverage >= RECURRING_VERDICT_RULES.coverage.highPercent ? "high"
    : coverage >= RECURRING_VERDICT_RULES.coverage.moderatePercent ? "moderate" : "low";
  return freeze({
    level,
    basis: freeze([
      `attribution_coverage_${level === "high" ? "at_least_95_percent"
        : level === "moderate" ? "80_to_94_9_percent" : "below_80_percent"}`,
      "minimum_sample_met",
    ]),
    assumption: RECURRING_VERDICT_RULES.confidence.assumption,
  });
}

function unavailableConfidence(reason) {
  return freeze({
    level: "unavailable",
    basis: freeze([reason]),
    assumption: RECURRING_VERDICT_RULES.confidence.assumption,
  });
}

/**
 * Compute a deterministic, non-causal verdict from bounded local evidence.
 * `comparable` must be established by the caller from metric, scope, and period.
 */
export function recurringReviewVerdict({
  priorValue = null,
  currentValue = null,
  comparable = false,
  coveragePercent = null,
  sampleRows = null,
} = {}) {
  const boundary = freeze({
    included: freeze([
      "prior derived monthly baseline",
      "current derived monthly value",
      "metric, scope, and period comparability",
      "attribution coverage",
      "measured row count",
    ]),
    excluded: freeze([
      "causal attribution",
      "statistical significance",
      "unobserved spend",
      "source rows",
      "prompt content",
      "customer identifiers",
    ]),
  });

  if (!finite(priorValue)) {
    return freeze({
      schemaVersion: RECURRING_VERDICT_VERSION,
      verdict: "missing_prior_evidence",
      wording: WORDING.missing_prior_evidence,
      change: null,
      changePercent: null,
      confidence: unavailableConfidence("prior_baseline_missing"),
      evidenceBoundary: boundary,
      assumptions: RECURRING_VERDICT_RULES,
    });
  }
  if (!comparable || !finite(currentValue)) {
    return freeze({
      schemaVersion: RECURRING_VERDICT_VERSION,
      verdict: "incomparable",
      wording: WORDING.incomparable,
      change: null,
      changePercent: null,
      confidence: unavailableConfidence("comparable_period_evidence_missing"),
      evidenceBoundary: boundary,
      assumptions: RECURRING_VERDICT_RULES,
    });
  }

  const change = currentValue - priorValue;
  const changePercent = priorValue === 0 ? null : (change / priorValue) * 100;
  const material = changePercent === null
    ? change !== 0
    : Math.abs(changePercent) >= RECURRING_VERDICT_RULES.materiality.thresholdPercent;
  const verdict = !material ? "stable" : change < 0 ? "improvement" : "regression";
  return freeze({
    schemaVersion: RECURRING_VERDICT_VERSION,
    verdict,
    wording: WORDING[verdict],
    change,
    changePercent,
    confidence: confidenceFor({ coveragePercent, sampleRows }),
    evidenceBoundary: boundary,
    assumptions: RECURRING_VERDICT_RULES,
  });
}
