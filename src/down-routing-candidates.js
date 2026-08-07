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

// PRICES ARE NOT DECLARED HERE ANY MORE (#1263). The two destination prices
// this file used to type as constants now come from the rate card — the
// reader's own when they have declared one, the published-list reference card
// otherwise — through the single resolver in finops-rate-card-contract.js. The
// tier floors below are derived from that card rather than retyped, so a
// declared contract moves the floor, the projected cost and the recoverable
// delta together, and there is no second copy of a rate anywhere in the rule.

import {
  PREMIUM_LIST_RATE, STANDARD_LIST_RATE, confidenceFor as confidenceForCard,
  excludedDestinations, priceDestination, resolveRateCard, toMinorPerMillion,
} from "./finops-rate-card-contract.js";

export const DOWN_ROUTING_RULE_VERSION = "down-routing-candidate/1.0.0";

/** The rate-card destination identifiers this rule prices at. */
export const DOWN_ROUTING_DESTINATIONS = Object.freeze({
  premium: "premium-text", standard: "standard-text",
});

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
  // premium text tier. Read off the reference card, not typed: $20.00 per
  // million tokens, which is 2000 minor per million.
  PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS: toMinorPerMillion(PREMIUM_LIST_RATE),

  // What the cheaper tier is assumed to charge for the same tokens, off the same
  // card. $15.00 per million tokens, which is 1500 minor per million.
  STANDARD_TIER_REFERENCE_MINOR_PER_MILLION_TOKENS: toMinorPerMillion(STANDARD_LIST_RATE),

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
 * One million tokens priced at a destination, which is that destination's rate
 * in the minor units per million this rule compares against. Going through the
 * resolver rather than reading a rate off the card keeps the discount and the
 * permission check on one path.
 */
function ratePerMillion(resolved, destination) {
  return priceDestination(resolved, destination, { tokens: 1_000_000 });
}

/**
 * Evaluate one org unit's records against the candidate rule.
 *
 * @param {{unitId?: string, records?: Array<object>, rateCard?: object|null}} unit
 *   `rateCard` is the FinOps lead's declared card. Absent — the shipped case —
 *   it resolves to the published-list reference card and every figure below is
 *   the one this page published before #1263.
 * @returns a frozen result carrying the decision, the numbers, the confidence
 *   tier with its reasons, the pricing provenance, and the ordered arithmetic
 *   behind the figure.
 */
export function evaluateDownRoutingCandidate({
  unitId = null, records = [], rateCard = null,
} = {}) {
  const {
    SHORT_CALL_MAX_TOKENS_PER_CALL: shortCallCeiling,
    MIN_CANDIDATE_REQUESTS: minRequests,
  } = DOWN_ROUTING_CONSTANTS;
  const resolved = resolveRateCard(rateCard);
  const premiumRate = ratePerMillion(resolved, DOWN_ROUTING_DESTINATIONS.premium);
  const standardRate = ratePerMillion(resolved, DOWN_ROUTING_DESTINATIONS.standard);
  const premiumFloor = premiumRate.amountMinor
    ?? DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS;

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
  // The one place the cheaper destination is turned into money for this unit.
  const projected = priceDestination(resolved, DOWN_ROUTING_DESTINATIONS.standard,
    { tokens: candidateTokens });
  const projectedMinor = projected.amountMinor ?? 0;

  let decisionCode = null;
  if (routable.length === 0) decisionCode = "no_text_generation_spend";
  else if (candidateTokens === 0) decisionCode = "no_token_billed_spend";
  else if (!standardRate.permitted) decisionCode = "destination_not_permitted";
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
    referenceMinorPerMillionTokens: standardRate.amountMinor,
    projectedStandardTierSpendUsd: usd(projectedMinor),
    // Published rather than re-derived downstream: the slate used to look this
    // pair up again from the observed price, which is a second opinion about a
    // tier the rule had already decided.
    tier: premium ? "premium" : "standard",
    proposedTier: premium ? "standard" : null,
    confidence,
    // The provenance of the rate this figure was priced at, so a renderer can
    // pick a confidence tier without re-deriving it from a bare number.
    pricing: pricingProvenance(resolved, [premiumRate, standardRate]),
  };
  result.workedExample = Object.freeze(workedExampleLines(result));
  return Object.freeze(result);
}

/**
 * Fold the priced lines into one provenance record.
 *
 * `rateSource` is `declared` only when EVERY line was priced off the reader's
 * own card; one line falling back to the reference card makes the whole figure a
 * reference figure, because a total is only as contracted as its weakest line.
 */
function pricingProvenance(resolved, priced) {
  const usable = priced.filter((entry) => entry?.priced);
  const allDeclared = usable.length > 0
    && usable.every((entry) => entry.rateSource === "declared");
  return Object.freeze({
    cardId: resolved.cardId,
    declaredCard: resolved.declared,
    rateSource: allDeclared ? "declared" : "reference",
    discountApplied: usable.some((entry) => entry.discountApplied),
    pricedLines: usable.length,
    referenceLines: usable.filter((entry) => entry.rateSource === "reference").length,
    excludedDestinations: excludedDestinations(resolved.card),
  });
}

const DECISION_REASONS = Object.freeze({
  destination_not_permitted:
    "The rate card marks the cheaper destination as not permitted, so there is nowhere to move "
    + "this unit's traffic and no saving is claimed.",
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

// ---------------------------------------------------------------------------
// PER-MODEL DOWN-ROUTING
// ---------------------------------------------------------------------------
//
// Everything above scores a unit from its *blended* price per token: every
// text-generation record it owns, added together, divided by its tokens. That
// blend is the last place a size effect can hide. A unit running one premium
// model on short calls next to a large cheap workload blends down below the
// premium floor and disappears; a unit that is simply big blends up and ranks
// first on volume it could not move anywhere.
//
// The rule below removes the blend where the input can support it: one tier
// decision and one recoverable delta per model, summed. There is no share, no
// multiplier, and no unit-level fudge in the chain — the unit figure is
// literally the sum of the per-model deltas and nothing else.
//
// WHAT CARRIES MODEL IDENTITY. The v1 provider-usage-billing contract does not:
// its aggregate grain is day × org unit × provider × service category, with no
// model field and no input/output token split, so a JSON envelope cannot be
// scored per model at all. The delimited import path *does* — `model`,
// `inputTokens`, `outputTokens`, and `requests` are declared columns on every
// provider shape in `finops-tabular-import.js`, which is where these rows come
// from. A unit whose spend arrived without model identity is NOT scored zero.
// It lands in the insufficient-data bucket with `unknown_model_tier`, because a
// zero in a ranked list reads as "clean" when it means "we could not look".

export const MODEL_ROUTING_RULE_VERSION = "model-routing-candidate/1.0.0";

/**
 * THE TIER PRICE TABLE. One table, in one place, ordered dearest first.
 *
 * `minObservedMinorPerMillionTokens` classifies a model by the price the
 * customer actually paid for it — spend ÷ tokens, from their own rows — because
 * this repository ships no vendor rate card and reaches none. `cheaperTier`
 * names where the rule would move that model's traffic, and the target tier's
 * `priceMinorPerMillionTokens` is what it would cost there.
 *
 * Both numbers are the two already stated (and already sourced as unsourced) in
 * DOWN_ROUTING_CONSTANTS. Adding a third tier is a row here and nothing else;
 * there is deliberately no second price table anywhere in this codebase.
 */
export const DOWN_ROUTING_TIER_PRICES = Object.freeze([
  Object.freeze({
    tier: "premium",
    destination: DOWN_ROUTING_DESTINATIONS.premium,
    minObservedMinorPerMillionTokens:
      DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS,
    // A premium model is charged at what the customer paid, not at a table
    // price: the observed spend is the one number here with a source.
    priceMinorPerMillionTokens: null,
    cheaperTier: "standard",
  }),
  Object.freeze({
    tier: "standard",
    destination: DOWN_ROUTING_DESTINATIONS.standard,
    minObservedMinorPerMillionTokens: 0,
    priceMinorPerMillionTokens:
      DOWN_ROUTING_CONSTANTS.STANDARD_TIER_REFERENCE_MINOR_PER_MILLION_TOKENS,
    cheaperTier: null,
  }),
]);

/** The rate-card destination one tier's traffic is priced at. */
const destinationForTier = (tier) =>
  DOWN_ROUTING_TIER_PRICES.find((entry) => entry.tier === tier)?.destination ?? null;

/**
 * Why a unit could not be scored. Machine-readable, closed, and never free
 * text: a UI branches on these and a reader is told which one applies.
 */
export const MODEL_ROUTING_REASON_CODES = Object.freeze([
  "unknown_model_tier",
  "missing_token_counts",
  "insufficient_volume",
]);

/**
 * THE EXCLUSION-REASON CONVENTION (#1263). Every excluded model already carried
 * a machine-readable `code`; nothing carried the wording a surface could print,
 * so the action center could only shorten its list without saying why. Each code
 * now has exactly one sentence here, and an excluded entry carries both. A new
 * exclusion code without a line in this table is a code a reader never sees, so
 * the table is the definition of the set rather than a lookup beside it.
 */
export const MODEL_EXCLUSION_REASONS = Object.freeze({
  missing_token_counts:
    "This model's rows carry no token count, so no price per token exists and no move is priced.",
  already_cheapest_tier:
    "This model is already on the cheapest destination in the price table, so there is nowhere "
    + "cheaper to move it.",
  destination_not_permitted:
    "Your rate card marks the cheaper destination as not permitted, so this model's traffic is "
    + "not proposed for it and nothing it would have saved is counted.",
  unknown_destination:
    "Neither your rate card nor the reference card names the cheaper destination, so the move "
    + "cannot be priced.",
  no_usage: "No usage was recorded for this model in the period, so there is nothing to price.",
  long_context_calls:
    "Tokens per call exceed the short-call ceiling, so these calls are treated as carrying long "
    + "retrieved context and are not proposed for a cheaper destination.",
  insufficient_volume:
    "Request volume is below the minimum at which a routing change is proposed.",
  no_positive_delta:
    "At your rates the cheaper destination costs the same or more for these tokens, so moving "
    + "the traffic saves nothing.",
});

/** The two states a unit can be published in. Never both, never neither. */
export const MODEL_ROUTING_STATUSES = Object.freeze(["scored", "insufficient_data"]);

/**
 * @typedef {object} ModelUsageRow One model's usage inside one org unit.
 * @property {string} orgUnitId Pseudonymous unit id, as the contract carries it.
 * @property {string|null} model Recognized model label, or `null` when the
 *   exporter's value was a placeholder or not identifier-shaped. Never raw text.
 * @property {string} provider Provider enum value from the contract.
 * @property {number} inputTokens Prompt tokens observed, 0 when uncounted.
 * @property {number} outputTokens Completion tokens observed, 0 when uncounted.
 * @property {number} tokens inputTokens + outputTokens.
 * @property {number|null} requests Calls observed. `null` when the export
 *   carries no request count — never 0 as a stand-in for unknown.
 * @property {number} spendMinor Observed spend, integer currency minor units.
 * @property {boolean} estimated Whether any source row was an estimated cost.
 * @property {number} sourceRows Source rows folded into this row.
 *
 * @typedef {object} ModelRoutingCandidate One model's arithmetic, per unit.
 * @property {string} model Recognized model label.
 * @property {string} tier Tier the observed price puts this model in.
 * @property {string} proposedTier Cheaper tier the traffic would move to.
 * @property {number|null} calls Requests observed, or null when uncounted.
 * @property {number} currentSpendUsd What the unit paid for this model.
 * @property {number} projectedSpendUsd The same tokens at the proposed tier.
 * @property {number} recoverableUsd currentSpendUsd − projectedSpendUsd.
 * @property {object} inputs The values that produced the delta.
 *
 * @typedef {object} UnitModelRouting One org unit's published result.
 * @property {string} ruleVersion
 * @property {string} unitLabel Redacted unit label.
 * @property {"scored"|"insufficient_data"} status
 * @property {string|null} reasonCode One of MODEL_ROUTING_REASON_CODES when the
 *   status is insufficient_data; null when scored.
 * @property {ReadonlyArray<ModelRoutingCandidate>} candidates
 * @property {ReadonlyArray<object>} excludedModels Models seen and not proposed.
 * @property {number} recoverableUsd Sum over candidates. Nothing else.
 * @property {number} modelledSpendUsd Token-billed spend carrying model identity.
 * @property {{level: string, reasons: ReadonlyArray<object>}} confidence
 *
 * @typedef {object} ModelRoutingAnalysis
 * @property {string} ruleVersion
 * @property {ReadonlyArray<UnitModelRouting>} ranked Scored units, dearest first.
 * @property {ReadonlyArray<UnitModelRouting>} insufficientData Never scored, never
 *   ranked, never zero: units the input cannot support a figure for.
 * @property {number} recoverableUsd Sum over `ranked`.
 */

/** Confidence penalties for the per-model rule, in stable declared order. */
const MODEL_CONFIDENCE_PENALTIES = Object.freeze([
  Object.freeze({
    code: "missing_request_counts",
    detail: "No candidate model carries a request count, so tokens per call could not be "
      + "checked against the short-call ceiling.",
  }),
  Object.freeze({
    code: "unattributed_model_spend",
    detail: "Some token-billed spend carries a model identifier that is a placeholder or is "
      + "not identifier-shaped, so it is excluded from the per-model arithmetic.",
  }),
  Object.freeze({
    code: "unrecognized_provider",
    detail: "At least one candidate model names a provider outside the contract's known "
      + "vendor list, so its rate cannot be attributed to a tier.",
  }),
  Object.freeze({
    code: "estimated_costs",
    detail: "At least one candidate model's spend includes an estimated rather than final cost.",
  }),
]);

/**
 * The floor a tier is recognised at: one million tokens priced at that tier's
 * destination on the resolved card. A lead whose contract puts the premium tier
 * at a different price has a different floor, and the floor moving with the rate
 * is the point — the alternative is classifying today's invoice against last
 * year's list price. The cheapest tier has no floor by construction.
 */
function tierFloor(resolved, entry) {
  if (entry.minObservedMinorPerMillionTokens === 0) return 0;
  const priced = priceDestination(resolved, entry.destination, { tokens: 1_000_000 });
  return priced.amountMinor ?? entry.minObservedMinorPerMillionTokens;
}

/**
 * Look a tier up in the one price table, at the rates on the resolved card.
 * Ordered dearest first. Omit the card and the reference card is used, which is
 * what every caller did before #1263 and what the shipped page still does.
 */
export function classifyModelTier(observedMinorPerMillionTokens, rateCard = null) {
  const resolved = resolveRateCard(rateCard);
  return DOWN_ROUTING_TIER_PRICES.find((entry) =>
    observedMinorPerMillionTokens >= tierFloor(resolved, entry)) ?? null;
}

/**
 * THE CANDIDATE RULE, in one place, over one model's usage.
 *
 * Every threshold is a named constant from DOWN_ROUTING_CONSTANTS; there is no
 * inline number in this function. A model is a down-routing candidate when all
 * of the following hold, and the first one that fails is the reason it is not:
 *
 *   1. tokens > 0                      — otherwise no price per token exists.
 *   2. a cheaper tier exists           — a standard-tier model has nowhere to go.
 *   3. tokens/call ≤ short-call ceiling — long retrieved context is not moved.
 *      Unknown call shape does not disqualify; it lowers confidence instead.
 *   4. requests ≥ minimum, when known   — below it the change costs more than it
 *      saves.
 *   5. the delta is positive            — a non-positive delta is not a saving
 *      of zero, it is "there is nothing to move".
 *
 * @returns {{candidate: boolean, code: string, tier: object|null}}
 */
export function classifyModelRoutingCandidate({
  tokens, requests, spendMinor, inputTokens = 0, outputTokens = 0, rateCard = null,
}) {
  const {
    SHORT_CALL_MAX_TOKENS_PER_CALL: shortCallCeiling,
    MIN_CANDIDATE_REQUESTS: minRequests,
  } = DOWN_ROUTING_CONSTANTS;
  const resolved = resolveRateCard(rateCard);
  const unpriced = (code, tier = null, priced = null) => ({ candidate: false, code, tier, priced });
  if (!(tokens > 0)) return unpriced("missing_token_counts");
  const observed = Math.round((spendMinor * 1_000_000) / tokens);
  const tier = classifyModelTier(observed, resolved);
  if (!tier?.cheaperTier) return unpriced("already_cheapest_tier", tier);
  // Permission first: a forbidden destination is not a cheaper destination, and
  // the reason a reader is owed is "your card forbids it", not "no saving".
  const priced = priceDestination(resolved, destinationForTier(tier.cheaperTier),
    { tokens, inputTokens, outputTokens });
  if (!priced.priced) return unpriced(priced.reasonCode, tier, priced);
  const tokensPerCall = requests > 0 ? Math.round(tokens / requests) : null;
  if (tokensPerCall !== null && tokensPerCall > shortCallCeiling) {
    return unpriced("long_context_calls", tier, priced);
  }
  if (requests !== null && requests < minRequests) {
    return unpriced("insufficient_volume", tier, priced);
  }
  if (spendMinor - priced.amountMinor <= 0) return unpriced("no_positive_delta", tier, priced);
  return { candidate: true, code: "down_routing_candidate", tier, priced };
}

/**
 * Score one org unit from its per-model rows.
 *
 * recoverable = Σ over candidate models of
 *                 (observed spend for that model)
 *               − round(that model's tokens × cheaper-tier price ÷ 1,000,000)
 *
 * That sum is the only source of the unit figure. There is no share, no
 * multiplier, and no cross-model term.
 *
 * @param {{unitId?: string, modelUsage?: ReadonlyArray<ModelUsageRow>}} unit
 * @returns {UnitModelRouting}
 */
export function evaluateUnitModelRouting({
  unitId = null, modelUsage = [], rateCard = null,
} = {}) {
  const rows = Array.isArray(modelUsage) ? modelUsage : [];
  const resolved = resolveRateCard(rateCard);
  const priced = [];
  const candidates = [];
  const excluded = [];
  const flags = {
    missing_request_counts: false,
    unattributed_model_spend: false,
    unrecognized_provider: false,
    estimated_costs: false,
  };
  let modelledMinor = 0;
  let recoverableMinor = 0;
  let requestCounts = 0;
  let tokenBearingRows = 0;
  let volumeBlocked = 0;

  for (const row of rows) {
    if (!row?.model) {
      flags.unattributed_model_spend = true;
      continue;
    }
    const tokens = Number(row.tokens ?? 0);
    const spendMinor = Number(row.spendMinor ?? 0);
    const requests = row.requests === null || row.requests === undefined
      ? null : Number(row.requests);
    modelledMinor += spendMinor;
    if (tokens > 0) tokenBearingRows += 1;
    if (requests !== null) requestCounts += 1;
    const inputTokens = Number(row.inputTokens ?? 0);
    const outputTokens = Number(row.outputTokens ?? 0);
    const verdict = classifyModelRoutingCandidate({
      tokens, requests, spendMinor, inputTokens, outputTokens, rateCard: resolved,
    });
    if (verdict.priced) priced.push(verdict.priced);
    const observed = tokens > 0 ? Math.round((spendMinor * 1_000_000) / tokens) : null;
    const tokensPerCall = requests > 0 ? Math.round(tokens / requests) : null;
    const inputs = Object.freeze({
      tier: verdict.tier?.tier ?? null,
      observedMinorPerMillionTokens: observed,
      inputTokens: Number(row.inputTokens ?? 0),
      outputTokens: Number(row.outputTokens ?? 0),
      tokens,
      tokensPerCall,
      requests,
      sourceRows: Number(row.sourceRows ?? 0),
    });
    if (!verdict.candidate) {
      if (verdict.code === "insufficient_volume") volumeBlocked += 1;
      excluded.push(Object.freeze({
        model: row.model,
        code: verdict.code,
        // The wording the surface prints. An exclusion a reader cannot read is
        // indistinguishable from a row that quietly went missing.
        reason: MODEL_EXCLUSION_REASONS[verdict.code] ?? null,
        currentSpendUsd: usd(spendMinor),
        calls: requests,
        inputs,
      }));
      continue;
    }
    if (!KNOWN_PROVIDERS.includes(row.provider)) flags.unrecognized_provider = true;
    if (row.estimated) flags.estimated_costs = true;
    const projectedMinor = verdict.priced.amountMinor;
    const deltaMinor = spendMinor - projectedMinor;
    recoverableMinor += deltaMinor;
    candidates.push(Object.freeze({
      model: row.model,
      tier: verdict.tier.tier,
      proposedTier: verdict.tier.cheaperTier,
      calls: requests,
      currentSpendUsd: usd(spendMinor),
      projectedSpendUsd: usd(projectedMinor),
      recoverableUsd: usd(deltaMinor),
      // Per-line provenance, so a renderer can grade one row rather than the
      // whole envelope: which card priced it, and whether a discount was applied.
      pricing: Object.freeze({
        rateSource: verdict.priced.rateSource,
        discountApplied: verdict.priced.discountApplied,
        discountPct: verdict.priced.discountPct,
        basis: verdict.priced.basis,
      }),
      inputs,
    }));
  }

  flags.missing_request_counts = candidates.length > 0 && requestCounts === 0;
  candidates.sort((left, right) => right.recoverableUsd - left.recoverableUsd
    || left.model.localeCompare(right.model));
  excluded.sort((left, right) => right.currentSpendUsd - left.currentSpendUsd
    || left.model.localeCompare(right.model));

  // Insufficient data is a status, not a zero. The precedence is widest cause
  // first: no model identity at all, then no tokens to price, then not enough
  // volume to defend a change.
  let reasonCode = null;
  if (!candidates.length) {
    if (!rows.length || rows.every((row) => !row?.model)) reasonCode = "unknown_model_tier";
    else if (tokenBearingRows === 0) reasonCode = "missing_token_counts";
    else if (volumeBlocked > 0) reasonCode = "insufficient_volume";
  }

  const reasons = MODEL_CONFIDENCE_PENALTIES
    .filter((penalty) => flags[penalty.code])
    .map((penalty) => Object.freeze({ ...penalty, effect: "lowered one tier" }));
  const level = CONFIDENCE_LEVELS[Math.min(reasons.length, CONFIDENCE_LEVELS.length - 1)];

  return Object.freeze({
    ruleVersion: MODEL_ROUTING_RULE_VERSION,
    unitLabel: redactLabel(unitId),
    unitId: unitId ?? null,
    status: reasonCode ? "insufficient_data" : "scored",
    reasonCode,
    candidates: Object.freeze(candidates),
    excludedModels: Object.freeze(excluded),
    recoverableUsd: usd(recoverableMinor),
    modelledSpendUsd: usd(modelledMinor),
    confidence: Object.freeze({ level, reasons: Object.freeze(reasons) }),
    pricing: pricingProvenance(resolved, priced),
  });
}

/**
 * Rank a whole import by per-model exposure.
 *
 * Two lists, never one. `ranked` carries units whose figure is defensible,
 * dearest first. `insufficientData` carries units the input cannot support a
 * figure for; they are never given a zero and never sorted against a real
 * number, because in a ranked list a zero reads as "clean".
 *
 * `unitIds` is the set of units the caller wants an answer for — every one of
 * them appears in exactly one of the two lists, so a unit cannot go missing
 * just because the export carried nothing for it.
 *
 * Cost: one pass to bucket rows by unit and one pass per row inside the rule.
 * Both allocate per model, not per source record; the per-record work happens
 * once during import, where the rows are folded.
 *
 * @param {{modelUsage?: ReadonlyArray<ModelUsageRow>, unitIds?: Iterable<string>}} input
 * @returns {ModelRoutingAnalysis}
 */
export function analyzeModelRouting({ modelUsage = [], unitIds = [], rateCard = null } = {}) {
  const resolved = resolveRateCard(rateCard);
  const byUnit = new Map();
  for (const id of unitIds) byUnit.set(id, []);
  for (const row of Array.isArray(modelUsage) ? modelUsage : []) {
    const bucket = byUnit.get(row?.orgUnitId);
    if (bucket) bucket.push(row);
  }
  const results = [...byUnit.entries()].map(([id, rows]) =>
    evaluateUnitModelRouting({ unitId: id, modelUsage: rows, rateCard: resolved }));
  const ranked = results.filter((result) => result.status === "scored")
    .sort((left, right) => right.recoverableUsd - left.recoverableUsd
      || right.modelledSpendUsd - left.modelledSpendUsd
      || String(left.unitId).localeCompare(String(right.unitId)));
  const insufficientData = results.filter((result) => result.status === "insufficient_data")
    .sort((left, right) => right.modelledSpendUsd - left.modelledSpendUsd
      || String(left.unitId).localeCompare(String(right.unitId)));
  // One provenance for the whole analysis, folded from the units that actually
  // priced something. The page's headline tier is read off this, so a figure
  // whose lines fell back to the reference card cannot be labelled contracted.
  const rateCardConfidence = confidenceForCard(resolved.card);
  return Object.freeze({
    ruleVersion: MODEL_ROUTING_RULE_VERSION,
    ranked: Object.freeze(ranked),
    insufficientData: Object.freeze(insufficientData),
    recoverableUsd: usd(Math.round(
      ranked.reduce((sum, result) => sum + result.recoverableUsd, 0) * 100,
    )),
    pricing: Object.freeze({
      cardId: resolved.cardId,
      declaredCard: resolved.declared,
      rateSource: ranked.length > 0
        && ranked.every((result) => result.pricing.rateSource === "declared")
        ? "declared" : "reference",
      discountApplied: ranked.some((result) => result.pricing.discountApplied),
      excludedDestinations: excludedDestinations(resolved.card),
    }),
    // The #1262 ladder verdict for the card that priced these figures. The page
    // paints its marker and hedge from this rather than from a bundled constant.
    rateCardConfidence,
  });
}
