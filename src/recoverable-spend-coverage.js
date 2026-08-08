// Coverage contract for the recoverable-spend answer. This module reads only
// caller-supplied, browser-local facts; it never fetches provider or HRIS data.

export const COVERAGE_STATE = Object.freeze({
  evaluated: "evaluated",
  unsupported: "unsupported",
  noOpportunity: "no-opportunity",
});

const entry = (definition) => Object.freeze({ ...definition,
  requiredImportFields: Object.freeze(definition.requiredImportFields),
  metric: Object.freeze(definition.metric),
  confidenceCap: Object.freeze(definition.confidenceCap),
});

export const RECOVERABLE_SPEND_TAXONOMY = Object.freeze([
  entry({
    id: "retry_failed_call", label: "Retry and failed-call waste",
    question: "How much billed spend repeated work after a failed call?",
    requiredImportFields: ["request_id", "attempt_number", "outcome", "billed_cost_usd"],
    metric: { unit: "USD", formula: "Sum billed_cost_usd where outcome is failed, plus attempts after attempt_number 1 for the same request_id.", denominator: "All accepted billed calls in the selected period." },
    pricingBasis: "Billed cost on each failed or retried call; do not reprice at list rates.",
    accountableOwner: "AI platform reliability owner", confidenceCap: { level: "high", reason: "Capped at medium when provider outcome codes do not distinguish client, provider, and policy failures." },
    absentBehavior: "Unsupported. Do not infer failures from latency, status absence, or repeated spend.",
  }),
  entry({
    id: "duplicate_repeat", label: "Duplicate-repeat waste",
    question: "How much billed spend came from the same normalized operation being submitted again?",
    requiredImportFields: ["request_id", "operation_fingerprint", "event_timestamp", "billed_cost_usd"],
    metric: { unit: "USD", formula: "Within 24 hours, order equal operation_fingerprint values by event_timestamp and sum billed_cost_usd for every occurrence after the first.", denominator: "All accepted billed calls with a non-null fingerprint in the selected period." },
    pricingBasis: "Billed cost of later occurrences; the first occurrence is never counted.",
    accountableOwner: "Application engineering owner", confidenceCap: { level: "medium", reason: "A fingerprint proves repetition, not that the repeated business operation was unnecessary." },
    absentBehavior: "Unsupported. Prompt contents are neither required nor accepted as a substitute fingerprint.",
  }),
  entry({
    id: "context_bloat", label: "Context-bloat waste",
    question: "How much input-token spend exceeded the declared context needed for the task?",
    requiredImportFields: ["input_tokens", "necessary_input_tokens", "input_token_rate_usd"],
    metric: { unit: "USD", formula: "Sum max(input_tokens - necessary_input_tokens, 0) multiplied by input_token_rate_usd per token.", denominator: "All accepted calls with a measured, non-negative necessary_input_tokens value." },
    pricingBasis: "Contracted input-token rate effective on the usage date; published list rate only when explicitly labelled illustrative.",
    accountableOwner: "Application prompt/runtime owner", confidenceCap: { level: "medium", reason: "Necessary context is a declared measurement and cannot establish causal savings by itself." },
    absentBehavior: "Unsupported. Never estimate necessary context from prompt contents or an arbitrary token threshold.",
  }),
  entry({
    id: "batch_cache_eligibility", label: "Batch/cache eligibility",
    question: "What spend was eligible for a cheaper batch or cache price but billed without it?",
    requiredImportFields: ["billed_cost_usd", "execution_mode", "cache_status", "batch_eligible", "cache_eligible", "eligible_price_usd"],
    metric: { unit: "USD", formula: "For eligible calls not executed in the eligible mode, sum max(billed_cost_usd - eligible_price_usd, 0).", denominator: "All accepted calls whose batch_eligible or cache_eligible flag is explicitly true or false." },
    pricingBasis: "Contracted eligible-mode price for the same model, region, and usage date.",
    accountableOwner: "AI platform runtime owner", confidenceCap: { level: "medium", reason: "Eligibility does not prove workload scheduling or cache-hit feasibility." },
    absentBehavior: "Unsupported. Do not treat ordinary calls as eligible merely because a provider offers batch or caching.",
  }),
  entry({
    id: "unused_committed_capacity", label: "Unused committed capacity",
    question: "How much paid commitment was left unused in the period?",
    requiredImportFields: ["commitment_id", "commitment_period_start", "commitment_period_end", "committed_cost_usd", "applied_usage_cost_usd"],
    metric: { unit: "USD", formula: "Per commitment and exact contract period, sum max(committed_cost_usd - applied_usage_cost_usd, 0), then sum commitments.", denominator: "All commitments whose complete contract period is contained in the selected period." },
    pricingBasis: "Invoice commitment cost and the provider-applied usage value under that same commitment; exclude on-demand list-price comparisons.",
    accountableOwner: "Cloud procurement / FinOps owner", confidenceCap: { level: "high", reason: "Capped at low for partial contract periods and therefore withheld from the total." },
    absentBehavior: "Unsupported. Usage below a guessed capacity or a partial month is not unused committed capacity.",
  }),
  entry({
    id: "out_of_scope_leakage", label: "Out-of-scope leakage",
    question: "How much billed spend violated the declared funded-use policy?",
    requiredImportFields: ["policy_scope_classification", "billed_cost_usd"],
    metric: { unit: "USD", formula: "Sum billed_cost_usd where policy_scope_classification equals out_of_scope; unknown classifications remain outside the numerator.", denominator: "All accepted billed calls with an explicit in_scope, out_of_scope, or unknown classification." },
    pricingBasis: "Observed billed cost; do not substitute avoided future usage or seat-list price.",
    accountableOwner: "AI governance policy owner", confidenceCap: { level: "high", reason: "Capped at medium when scope is rule-derived rather than provider- or owner-attested." },
    absentBehavior: "Unsupported. Department, model, or service category alone does not establish a policy violation.",
  }),
]);

const finite = (value) => Number.isFinite(value) && value >= 0;

/**
 * facts[field] is `supported`, `absent`, or `unsupported`. Opportunities are
 * supplied only by the analysis that computed them; this contract never guesses.
 */
export function evaluateRecoverableSpendCoverage({ facts = {}, opportunities = {} } = {}) {
  return Object.freeze(RECOVERABLE_SPEND_TAXONOMY.map((definition) => {
    const missing = definition.requiredImportFields.filter((field) => facts[field] !== "supported");
    if (missing.length) return Object.freeze({ ...definition, state: COVERAGE_STATE.unsupported,
      amountUsd: null, missingFields: Object.freeze(missing),
      stateDetail: `${definition.absentBehavior} Required import fields not supported: ${missing.join(", ")}.` });
    const amountUsd = opportunities[definition.id];
    if (!finite(amountUsd)) return Object.freeze({ ...definition, state: COVERAGE_STATE.unsupported,
      amountUsd: null, missingFields: Object.freeze([]),
      stateDetail: "Unsupported. The required fields are present, but this analysis did not publish a valid non-negative result." });
    if (amountUsd === 0) return Object.freeze({ ...definition, state: COVERAGE_STATE.noOpportunity,
      amountUsd, missingFields: Object.freeze([]),
      stateDetail: "No opportunity found in the evaluated records. This is not a claim that the activity had zero cost." });
    return Object.freeze({ ...definition, state: COVERAGE_STATE.evaluated, amountUsd,
      missingFields: Object.freeze([]),
      stateDetail: `Evaluated: ${amountUsd.toFixed(2)} USD of candidate spend in the selected period; not realized savings.` });
  }));
}
