// The down-routing candidate rule: which spend could move to a cheaper tier,
// how much of it comes back, and how much of that number we can stand behind.
//
// This module replaces a flat "20% of joined text-generation spend is
// recoverable" constant. That constant was indefensible in the one conversation
// it exists for: a director asked to accept a monthly saving could not retrace
// it, could not argue with it, and could not tell a unit running short cheap
// calls apart from one running long-context calls that must stay on the premium
// tier. Both got 20%.
//
// Everything here is integer arithmetic in currency minor units and whole
// tokens, so a reader with the same rows and a calculator reproduces every
// figure exactly. `downRoutingWorkedExample()` emits that arithmetic as ordered
// lines; `docs/down-routing-worked-example.md` is that output, pinned by a
// fixture so it cannot drift from this code.
//
// WHAT THE CONTRACT DOES NOT CARRY. The v1 provider-usage-billing contract has
// no model identifier and no input/output token split. Model *tier* is
// therefore not read, it is derived: from the unit's own observed blended price
// per million tokens, which is exactly the arithmetic a director can redo from
// their invoice. Per-call token *shape* is total tokens per request, not an
// input/output ratio. Both substitutions are stated in DOWN_ROUTING_ASSUMPTIONS
// so they are argued with rather than assumed away.
//
// UNTRUSTED INPUT. Nothing user-supplied reaches an explanation string
// verbatim. Provider and service-category values are compared against the
// contract enums and never interpolated; unit ids pass through `redactLabel()`,
// which keeps a six-character tail of an already-pseudonymous id and strips
// every other character class. Free text cannot reach a reader or a judge from
// here.

export const DOWN_ROUTING_RULE_VERSION = "down-routing-candidate/1.0.0";

/**
 * Every threshold the rule uses, with the assumption behind it stated in
 * DOWN_ROUTING_ASSUMPTIONS below. There are no other numbers in the rule.
 *
 * Prices are held as *currency minor units per million tokens* so the whole
 * rule is integer arithmetic: no floating-point drift, no locale formatting, no
 * rounding that changes with evaluation order.
 */
export const DOWN_ROUTING_CONSTANTS = Object.freeze({
  // At or above this observed blended price, the unit is treated as buying a
  // premium text tier. 2000 minor per million tokens is $20.00 per million.
  PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS: 2000,

  // What the cheaper tier is assumed to charge for the same tokens. 1500 minor
  // per million tokens is $15.00 per million.
  STANDARD_TIER_REFERENCE_MINOR_PER_MILLION_TOKENS: 1500,

  // Above this many tokens per call, the call is treated as carrying a long
  // retrieved context and is NOT a down-routing candidate.
  SHORT_CALL_MAX_TOKENS_PER_CALL: 2000,

  // Below this many requests in the period, a routing change is not proposed.
  MIN_CANDIDATE_REQUESTS: 1000,
});

/**
 * One entry per constant and per substitution, in the words a director would
 * need to disagree with it. Where there is no defensible source, this says so
 * rather than inventing one — an unsourced number a reader can see is unsourced
 * is safer than an unsourced number dressed as a benchmark.
 */
export const DOWN_ROUTING_ASSUMPTIONS = Object.freeze([
  "Premium-tier floor ($20.00 per million blended tokens): at or above this observed price "
  + "the unit is assumed to be buying a premium text tier. NO SOURCE — this repository ships "
  + "no provider rate card and cannot reach one. The value sits just below the blended rate "
  + "the bundled example export implies, and must be replaced with the organisation's own "
  + "contracted rates before any figure here means money.",
  "Standard-tier reference price ($15.00 per million blended tokens): what the cheaper tier "
  + "is assumed to charge for the same tokens. NO SOURCE, same caveat as the premium floor. "
  + "The recoverable figure is the difference between what the unit paid and this price "
  + "applied to the same token count, so an error in this number moves the saving "
  + "proportionally and visibly.",
  "Short-call ceiling (2,000 tokens per call): a text call whose total tokens are at or "
  + "below this is assumed to carry no long retrieved context and to be servable by the "
  + "cheaper tier at equal quality. NO SOURCE — it is a stated policy line, not a measured "
  + "quality result, and no quality evaluation in this repository supports it.",
  "Minimum request volume (1,000 requests in the period): below this, the saving is assumed "
  + "to be smaller than the engineering cost of changing routing, so no candidate is raised. "
  + "NO SOURCE — it is a judgement about change cost, not a measurement.",
  "SUBSTITUTION — model tier: the contract carries no model identifier, so tier is derived "
  + "from the unit's own observed blended price per million tokens (candidate spend divided "
  + "by candidate tokens). A director can redo this division from their invoice.",
  "SUBSTITUTION — per-call token shape: the contract carries no input/output token split, so "
  + "call shape is total tokens per request, taken from a sibling record whose usage unit is "
  + "'requests'. Without such a record the shape is unknown, the unit is still costed, and "
  + "the confidence tier is lowered rather than the number being hidden.",
  "Candidate spend is the cost of text-generation records billed in tokens only. A record "
  + "billed in requests contributes volume and never spend, so a provider that reports both "
  + "cannot double-count into the saving.",
]);

/** Contract enums. Anything outside these is never echoed into an explanation. */
const ROUTABLE_SERVICE_CATEGORIES = Object.freeze(["text-generation"]);
const KNOWN_PROVIDERS = Object.freeze(["openai", "anthropic", "google", "aws", "azure"]);
const TOKEN_UNIT = "tokens";
const REQUEST_UNIT = "requests";

const CONFIDENCE_LEVELS = Object.freeze(["High", "Medium", "Low"]);

/**
 * Every reason that can lower a unit's confidence tier, each worth one step
 * down the CONFIDENCE_LEVELS ladder. Reasons are emitted in this declared
 * order, never in map or set iteration order, so the output is stable.
 */
const CONFIDENCE_PENALTIES = Object.freeze([
  Object.freeze({
    code: "missing_request_counts",
    detail: "No text-generation record reports usage in requests, so tokens per call "
      + "could not be checked against the short-call ceiling.",
  }),
  Object.freeze({
    code: "unrecognized_provider",
    detail: "At least one candidate record names a provider outside the contract's known "
      + "vendor list, so its rate cannot be attributed to a tier.",
  }),
  Object.freeze({
    code: "unpriceable_usage_units",
    detail: "At least one text-generation record is billed in a unit that is neither tokens "
      + "nor requests, so its spend is outside the price arithmetic.",
  }),
  Object.freeze({
    code: "estimated_costs",
    detail: "At least one candidate record carries an estimated rather than final cost.",
  }),
]);

/** Keep a short tail of an already-pseudonymous id; drop every other character. */
export function redactLabel(unitId) {
  const safe = String(unitId ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return safe ? `unit …${safe.slice(-6)}` : "unit (unidentified)";
}

/**
 * Accept either a raw v1 contract record or the flattened projection the export
 * normalizer already builds. Neither shape is modified; this only reads.
 */
function readRecord(record) {
  const serviceCategory = record.serviceCategory ?? record.service_category ?? null;
  const usage = record.usage ?? {};
  const cost = record.cost ?? {};
  return {
    serviceCategory,
    provider: record.provider ?? null,
    amountMinor: Number(record.amountMinor ?? cost.amount_minor ?? 0),
    usageQuantity: Number(record.usageQuantity ?? usage.quantity ?? 0),
    usageUnit: record.usageUnit ?? usage.unit ?? null,
    costStatus: record.costStatus ?? cost.status ?? null,
  };
}

function usd(minor) {
  return Math.round(minor) / 100;
}

/**
 * Confidence is computed from data completeness, never asserted. It starts at
 * High and steps down once per distinct penalty, floored at Low. The reasons
 * travel with the level so a reader can see what cost the unit a step.
 */
function confidenceFor(flags) {
  const reasons = CONFIDENCE_PENALTIES.filter((penalty) => flags[penalty.code])
    .map((penalty) => Object.freeze({ ...penalty, effect: "lowered one tier" }));
  const index = Math.min(reasons.length, CONFIDENCE_LEVELS.length - 1);
  return Object.freeze({ level: CONFIDENCE_LEVELS[index], reasons: Object.freeze(reasons) });
}

/**
 * Evaluate one org unit's records against the candidate rule.
 *
 * @param {{unitId?: string, records?: Array<object>}} unit
 * @returns a frozen result carrying the decision, the numbers, the confidence
 *   tier with its reasons, and the ordered arithmetic behind the figure.
 */
export function evaluateDownRoutingCandidate({ unitId = null, records = [] } = {}) {
  const {
    PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS: premiumFloor,
    STANDARD_TIER_REFERENCE_MINOR_PER_MILLION_TOKENS: referencePrice,
    SHORT_CALL_MAX_TOKENS_PER_CALL: shortCallCeiling,
    MIN_CANDIDATE_REQUESTS: minRequests,
  } = DOWN_ROUTING_CONSTANTS;

  const routable = (Array.isArray(records) ? records : []).map(readRecord)
    .filter((record) => ROUTABLE_SERVICE_CATEGORIES.includes(record.serviceCategory));

  let routableMinor = 0;
  let candidateSpendMinor = 0;
  let candidateTokens = 0;
  let requests = 0;
  let requestRecords = 0;
  const flags = {
    missing_request_counts: false,
    unrecognized_provider: false,
    unpriceable_usage_units: false,
    estimated_costs: false,
  };

  for (const record of routable) {
    routableMinor += record.amountMinor;
    if (record.usageUnit === TOKEN_UNIT) {
      candidateSpendMinor += record.amountMinor;
      candidateTokens += record.usageQuantity;
      if (!KNOWN_PROVIDERS.includes(record.provider)) flags.unrecognized_provider = true;
      if (record.costStatus !== "final") flags.estimated_costs = true;
    } else if (record.usageUnit === REQUEST_UNIT) {
      requests += record.usageQuantity;
      requestRecords += 1;
    } else {
      flags.unpriceable_usage_units = true;
    }
  }
  flags.missing_request_counts = requestRecords === 0;

  const requestsKnown = requestRecords > 0 && requests > 0;
  // Integer division for display only; the branch tests below never use it.
  const tokensPerCall = requestsKnown ? Math.round(candidateTokens / requests) : null;
  const confidence = confidenceFor(flags);

  // Price comparisons are cross-multiplied so no division and no float enters a
  // branch decision: paid ≥ floor  ⇔  spendMinor × 1e6 ≥ tokens × floor.
  const observedMinorPerMillion = candidateTokens > 0
    ? Math.round((candidateSpendMinor * 1_000_000) / candidateTokens) : null;
  const premium = candidateTokens > 0
    && candidateSpendMinor * 1_000_000 >= candidateTokens * premiumFloor;
  const projectedMinor = Math.round((candidateTokens * referencePrice) / 1_000_000);

  let decisionCode = null;
  if (routable.length === 0) decisionCode = "no_text_generation_spend";
  else if (candidateTokens === 0) decisionCode = "no_token_billed_spend";
  else if (!premium) decisionCode = "below_premium_price_floor";
  else if (requestsKnown && tokensPerCall > shortCallCeiling) decisionCode = "long_context_calls";
  else if (requestsKnown && requests < minRequests) decisionCode = "below_minimum_request_volume";
  else if (requestsKnown) decisionCode = "candidate_verified_call_shape";
  else decisionCode = "candidate_unverified_call_shape";

  const flagged = decisionCode.startsWith("candidate_");
  const recoverableMinor = flagged ? Math.max(0, candidateSpendMinor - projectedMinor) : 0;

  const result = {
    ruleVersion: DOWN_ROUTING_RULE_VERSION,
    unitLabel: redactLabel(unitId),
    flagged,
    decisionCode,
    decisionReason: DECISION_REASONS[decisionCode],
    routableSpendUsd: usd(routableMinor),
    candidateSpendUsd: usd(candidateSpendMinor),
    recoverableUsd: usd(recoverableMinor),
    candidateTokens,
    requests: requestsKnown ? requests : null,
    tokensPerCall,
    observedMinorPerMillionTokens: observedMinorPerMillion,
    referenceMinorPerMillionTokens: referencePrice,
    projectedStandardTierSpendUsd: usd(projectedMinor),
    confidence,
  };
  result.workedExample = Object.freeze(workedExampleLines(result));
  return Object.freeze(result);
}

const DECISION_REASONS = Object.freeze({
  no_text_generation_spend:
    "No text-generation record joined this unit, so there is nothing to re-route.",
  no_token_billed_spend:
    "This unit's text-generation spend is not billed in tokens, so no price per token can be "
    + "derived and no saving is claimed.",
  below_premium_price_floor:
    "The observed blended price is below the premium-tier floor, so this unit already pays a "
    + "rate at or under the tier a pilot would move it to.",
  long_context_calls:
    "Tokens per call exceed the short-call ceiling, so these calls are treated as carrying long "
    + "retrieved context and are not proposed for a cheaper tier.",
  below_minimum_request_volume:
    "Request volume is below the minimum at which a routing change is proposed.",
  candidate_verified_call_shape:
    "Premium-tier price, short calls, and enough volume: the token-billed text-generation spend "
    + "is a down-routing candidate.",
  candidate_unverified_call_shape:
    "Premium-tier price with no request count in the export, so call shape could not be checked. "
    + "The saving is shown at a lowered confidence tier rather than withheld.",
});

/**
 * The arithmetic, in the order a reader would redo it. Every line is a
 * self-contained equation over numbers that appear on earlier lines or in the
 * reader's own rows.
 */
function workedExampleLines(result) {
  const lines = [
    {
      step: "candidate spend",
      expression: "sum of cost.amount_minor over text-generation records billed in tokens",
      value: `${result.candidateSpendUsd.toFixed(2)} USD`,
    },
    {
      step: "candidate tokens",
      expression: "sum of usage.quantity over those same records",
      value: `${result.candidateTokens} tokens`,
    },
  ];
  if (result.observedMinorPerMillionTokens !== null) {
    lines.push({
      step: "observed blended price",
      expression: `round(${Math.round(result.candidateSpendUsd * 100)} minor × 1,000,000 ÷ `
        + `${result.candidateTokens} tokens)`,
      value: `${result.observedMinorPerMillionTokens} minor per million tokens`,
    });
    lines.push({
      step: "premium-tier test",
      expression: `${result.observedMinorPerMillionTokens} ≥ `
        + `${DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS} (premium floor)`,
      value: result.observedMinorPerMillionTokens
        >= DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS ? "premium" : "standard",
    });
  }
  lines.push({
    step: "call shape",
    expression: result.requests === null
      ? "no record billed in requests; tokens per call unknown"
      : `${result.candidateTokens} tokens ÷ ${result.requests} requests`,
    value: result.tokensPerCall === null ? "unknown"
      : `${result.tokensPerCall} tokens per call (ceiling `
        + `${DOWN_ROUTING_CONSTANTS.SHORT_CALL_MAX_TOKENS_PER_CALL})`,
  });
  lines.push({
    step: "decision",
    expression: result.decisionReason,
    value: result.flagged ? "candidate" : "not a candidate",
  });
  if (result.flagged) {
    lines.push({
      step: "cost on the cheaper tier",
      expression: `round(${result.candidateTokens} tokens × `
        + `${result.referenceMinorPerMillionTokens} ÷ 1,000,000)`,
      value: `${result.projectedStandardTierSpendUsd.toFixed(2)} USD`,
    });
    lines.push({
      step: "recoverable",
      expression: `${result.candidateSpendUsd.toFixed(2)} − `
        + `${result.projectedStandardTierSpendUsd.toFixed(2)}`,
      value: `${result.recoverableUsd.toFixed(2)} USD`,
    });
  } else {
    lines.push({
      step: "recoverable",
      expression: "not a candidate, so no saving is claimed",
      value: "0.00 USD",
    });
  }
  lines.push({
    step: "confidence",
    expression: result.confidence.reasons.length
      ? result.confidence.reasons.map((reason) => reason.code).join(", ")
      : "no completeness penalty applied",
    value: result.confidence.level,
  });
  return lines.map((line) => Object.freeze(line));
}

/** The worked example as plain text. Numbers and enum values only. */
export function downRoutingWorkedExample(result) {
  return [
    `Down-routing worked example — ${result.unitLabel}`,
    `Rule ${result.ruleVersion}`,
    "",
    ...result.workedExample.map((line) =>
      `${line.step}: ${line.expression} = ${line.value}`),
  ].join("\n");
}
