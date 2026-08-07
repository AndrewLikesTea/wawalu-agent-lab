// The rate-card resolver, and the four things that had to become true with it
// (#1263). Every expected figure below is WRITTEN OUT and derived by hand in the
// comment above it. Recomputing an expectation by calling the function under
// test proves the function agrees with itself, which is the one thing it will
// always do.
//
//   1. THE REGRESSION CONTRACT. No declared card ⇒ the reference card ⇒ the
//      numbers the site shipped before this change, to the cent. Checked twice:
//      against hand-written arithmetic, and against the real bundled example.
//   2. A DECLARED CARD MOVES THE FIGURE. Same rows, different card, a different
//      headline — and the provenance says which card and whether a discount ran.
//   3. A FORBIDDEN DESTINATION IS REPORTED, NOT DROPPED. It leaves the candidate
//      set and arrives in the exclusions with a stable code and reader wording.
//   4. THE HEADLINE IS THE SUM OF THE ACTIONS, on both paths. This is the defect
//      the single resolver exists to make unwritable.
//
// The cards are built here rather than committed, in the style of
// tests/finops-rate-card-contract.test.js: the interesting part of a variant is
// the one field that differs from the last one.
//
// Nothing here reads a clock, a network, or a random source.

import assert from "node:assert/strict";
import test from "node:test";

import { loadExampleDataset } from "../src/example-dataset.js";
import {
  DEFAULT_REFERENCE_CARD, PRICING_REASON_TEXT, excludedDestinations, priceDestination,
  resolveRateCard,
} from "../src/finops-rate-card-contract.js";
import {
  DOWN_ROUTING_CONSTANTS, MODEL_EXCLUSION_REASONS, analyzeModelRouting,
  evaluateDownRoutingCandidate,
} from "../src/down-routing-candidates.js";
import { routingSlate } from "../src/routing-slate.js";

/**
 * The lead's own card. Both destinations contracted, both permitted, both
 * carrying committed-use terms — the "fully declared" case #1262 grades
 * Declared · High.
 *
 * Rates in currency units per million tokens, so in the repo's minor units:
 *   premium-text   input 1200, output 3600, 15% off ⇒ 1020 and 3060
 *   standard-text  input  400, output  800, 20% off ⇒  320 and  640
 */
const declaredModel = (model, label, overrides = {}) => ({
  model,
  label,
  contractedInputRate: 12,
  contractedOutputRate: 36,
  currency: "USD",
  effectiveDate: "2026-01-01",
  committedUseDiscountPct: 15,
  permitted: true,
  ...overrides,
});

const declaredCard = (overrides = {}) => ({
  contractVersion: DEFAULT_REFERENCE_CARD.contractVersion,
  cardId: "acme-2026-contract",
  source: "contracted",
  models: [
    declaredModel("premium-text", "the premium text tier"),
    declaredModel("standard-text", "the standard text tier", {
      contractedInputRate: 4, contractedOutputRate: 8, committedUseDiscountPct: 20,
    }),
  ],
  ...overrides,
});

/**
 * One org unit's per-model usage. Four billion tokens split three-to-one
 * input/output, four million calls (1,000 tokens per call, under the short-call
 * ceiling), and $100,000 of spend.
 *
 * observed price = 10,000,000 minor × 1,000,000 ÷ 4,000,000,000 tokens
 *                = 2,500 minor per million tokens, which clears both premium
 *                  floors below.
 */
const USAGE_ROW = Object.freeze({
  orgUnitId: "unit-atlas",
  model: "premium-alpha",
  provider: "openai",
  inputTokens: 3_000_000_000,
  outputTokens: 1_000_000_000,
  tokens: 4_000_000_000,
  requests: 4_000_000,
  spendMinor: 10_000_000,
  estimated: false,
  sourceRows: 12,
});

const analyze = (rateCard = null, rows = [USAGE_ROW]) => analyzeModelRouting({
  modelUsage: rows, unitIds: ["unit-atlas"], rateCard,
});

const envelope = (modelRouting) => ({
  period: "2026-06-01 to 2026-06-30", rankedDepartments: [], modelRouting,
});

// ---------------------------------------------------------------------------
// 1. The regression contract: absent card ⇒ reference card ⇒ today's numbers.
// ---------------------------------------------------------------------------

test("an absent, null or malformed card all resolve to the reference card", () => {
  for (const input of [undefined, null, {}, { models: [] }, "a card", 7]) {
    const resolved = resolveRateCard(input);
    assert.equal(resolved.card, DEFAULT_REFERENCE_CARD);
    assert.equal(resolved.cardId, "published-list-reference");
    assert.equal(resolved.declared, false, "the reference card is not a declaration");
  }
});

test("the reference card prices at exactly the rates the site already shipped", () => {
  // 4,000,000,000 tokens × 1,500 minor per million ÷ 1,000,000 = 6,000,000 minor.
  // Input and output rates are equal on the reference card, so the split basis
  // and the blended basis have to agree to the minor unit.
  const split = priceDestination(null, "standard-text",
    { inputTokens: 3_000_000_000, outputTokens: 1_000_000_000 });
  const blended = priceDestination(null, "standard-text", { tokens: 4_000_000_000 });
  assert.equal(split.amountMinor, 6_000_000);
  assert.equal(split.amountUsd, 60_000);
  assert.equal(blended.amountMinor, 6_000_000);
  assert.equal(split.basis, "split");
  assert.equal(blended.basis, "blended");
  assert.deepEqual(
    { rateSource: split.rateSource, discountApplied: split.discountApplied,
      cardId: split.cardId, permitted: split.permitted },
    { rateSource: "reference", discountApplied: false,
      cardId: "published-list-reference", permitted: true });
  // And the premium destination, at the same rate the tier floor is read at.
  assert.equal(priceDestination(null, "premium-text", { tokens: 1_000_000 }).amountMinor,
    DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS);
});

test("the reference card is never returned as a bare number", () => {
  const priced = priceDestination(null, "standard-text", { tokens: 1_000_000 });
  assert.equal(typeof priced, "object");
  for (const field of ["rateSource", "cardId", "discountApplied", "basis", "permitted"]) {
    assert.ok(field in priced, `provenance must carry ${field}`);
  }
});

test("the no-card path reproduces the per-model figures the rule published before", () => {
  // spend 10,000,000 minor − projected 6,000,000 minor = 4,000,000 minor.
  const unit = analyze(null).ranked[0];
  assert.equal(unit.candidates.length, 1);
  assert.deepEqual(
    { current: unit.candidates[0].currentSpendUsd,
      projected: unit.candidates[0].projectedSpendUsd,
      recoverable: unit.candidates[0].recoverableUsd,
      unitTotal: unit.recoverableUsd },
    { current: 100_000, projected: 60_000, recoverable: 40_000, unitTotal: 40_000 });
  assert.equal(unit.pricing.rateSource, "reference");
  assert.equal(unit.pricing.discountApplied, false);
});

test("the bundled example's shipped figures did not move, source spend included", async () => {
  const analysis = await loadExampleDataset();
  // The three numbers this page has published all along, written out here so a
  // review reads them rather than trusting a recomputation.
  assert.equal(analysis.spendUsd, 154_500, "observed source-side spend must not move");
  assert.equal(analysis.recoverableUsd, 51_254);
  assert.equal(routingSlate(analysis).totalExpectedMonthlyUsd, 51_253);
  assert.equal(analysis.modelRouting.pricing.rateSource, "reference");
  assert.deepEqual(
    [analysis.modelRouting.rateCardConfidence.marker,
      analysis.modelRouting.rateCardConfidence.label],
    ["Illustrative", "Low"],
    "a published-list price is not a contract, so the bundled tier stays where it was");
});

// ---------------------------------------------------------------------------
// 2. A declared card moves the figure, and says so.
// ---------------------------------------------------------------------------

test("the declared card prices the same rows at a different headline", () => {
  // standard-text at the declared contract, after 20% committed use:
  //   3,000,000,000 input × 320 minor + 1,000,000,000 output × 640 minor
  //   = 960,000,000,000,000 + 640,000,000,000,000 = 1,600,000,000,000,000
  //   ÷ 1,000,000 = 1,600,000 minor = $16,000.
  // recoverable = 10,000,000 − 1,600,000 = 8,400,000 minor = $84,000.
  const declared = analyze(declaredCard()).ranked[0];
  assert.deepEqual(
    { projected: declared.candidates[0].projectedSpendUsd,
      recoverable: declared.candidates[0].recoverableUsd,
      unitTotal: declared.recoverableUsd },
    { projected: 16_000, recoverable: 84_000, unitTotal: 84_000 });
  // …and the reference-card total for the same rows is a different number.
  assert.equal(analyze(null).recoverableUsd, 40_000);
  assert.equal(analyze(declaredCard()).recoverableUsd, 84_000);
  assert.notEqual(analyze(declaredCard()).recoverableUsd, analyze(null).recoverableUsd);
});

test("a committed-use destination prices below its list rate and reports the discount", () => {
  const priced = priceDestination(declaredCard(), "standard-text",
    { inputTokens: 3_000_000_000, outputTokens: 1_000_000_000 });
  // At list: 3e9 × 400 + 1e9 × 800 = 2,000,000,000,000,000 ÷ 1e6 = 2,000,000 minor.
  assert.equal(priced.listAmountMinor, 2_000_000);
  assert.equal(priced.amountMinor, 1_600_000);
  assert.ok(priced.amountMinor < priced.listAmountMinor,
    "a committed-use rate that does not price below list is not a discount");
  assert.deepEqual(
    { rateSource: priced.rateSource, discountApplied: priced.discountApplied,
      discountPct: priced.discountPct, cardId: priced.cardId },
    { rateSource: "declared", discountApplied: true, discountPct: 20,
      cardId: "acme-2026-contract" });
  // An explicit zero is a declaration, not an absence: it prices at list and
  // says no discount ran.
  const noDiscount = priceDestination(
    declaredCard({
      models: [declaredModel("standard-text", "the standard text tier",
        { contractedInputRate: 4, contractedOutputRate: 8, committedUseDiscountPct: 0 })],
    }),
    "standard-text", { inputTokens: 3_000_000_000, outputTokens: 1_000_000_000 });
  assert.equal(noDiscount.amountMinor, 2_000_000);
  assert.deepEqual(
    { applied: noDiscount.discountApplied, pct: noDiscount.discountPct },
    { applied: false, pct: 0 });
});

test("a fully declared card carries the analysis off Illustrative, in the existing words", () => {
  const analysis = analyze(declaredCard());
  assert.deepEqual(
    [analysis.rateCardConfidence.marker, analysis.rateCardConfidence.label],
    ["Declared", "High"],
    "the tier vocabulary is #1262's; this change reuses it rather than coining one");
  assert.deepEqual(
    { rateSource: analysis.pricing.rateSource, declared: analysis.pricing.declaredCard,
      discount: analysis.pricing.discountApplied, cardId: analysis.pricing.cardId },
    { rateSource: "declared", declared: true, discount: true, cardId: "acme-2026-contract" });
});

// ---------------------------------------------------------------------------
// 3. A forbidden destination is reported, not dropped.
// ---------------------------------------------------------------------------

const FORBIDDEN_STANDARD = () => declaredCard({
  models: [
    declaredModel("premium-text", "the premium text tier"),
    declaredModel("standard-text", "the standard text tier", {
      contractedInputRate: 4, contractedOutputRate: 8, permitted: false,
    }),
  ],
});

test("a not-permitted destination is absent from the candidates and named in the exclusions", () => {
  const unit = analyze(FORBIDDEN_STANDARD()).ranked[0];
  assert.equal(unit.candidates.length, 0, "a forbidden destination is not a saving");
  assert.equal(unit.recoverableUsd, 0);
  assert.equal(unit.excludedModels.length, 1);
  assert.deepEqual(
    { model: unit.excludedModels[0].model, code: unit.excludedModels[0].code },
    { model: "premium-alpha", code: "destination_not_permitted" });
  assert.equal(unit.excludedModels[0].reason,
    MODEL_EXCLUSION_REASONS.destination_not_permitted);
  assert.match(unit.excludedModels[0].reason, /not permitted/);
});

test("the card's own forbidden destinations are published beside the figure", () => {
  assert.deepEqual(excludedDestinations(null), [], "the reference card forbids nothing");
  const excluded = excludedDestinations(FORBIDDEN_STANDARD());
  assert.equal(excluded.length, 1);
  assert.deepEqual(
    { destination: excluded[0].destination, code: excluded[0].code, label: excluded[0].label },
    { destination: "standard-text", code: "destination_not_permitted",
      label: "the standard text tier" });
  assert.equal(excluded[0].reason, PRICING_REASON_TEXT.destination_not_permitted);
  // Priced directly, the same destination refuses to produce a number at all —
  // an unpriceable line is never a zero.
  const priced = priceDestination(FORBIDDEN_STANDARD(), "standard-text", { tokens: 1_000_000 });
  assert.deepEqual(
    { priced: priced.priced, amountMinor: priced.amountMinor, permitted: priced.permitted,
      reasonCode: priced.reasonCode },
    { priced: false, amountMinor: null, permitted: false,
      reasonCode: "destination_not_permitted" });
});

test("the slate surfaces the exclusion rather than shortening its list in silence", () => {
  const slate = routingSlate(envelope(analyze(FORBIDDEN_STANDARD())));
  assert.equal(slate.pricing.exclusions.length, 2,
    "the card's forbidden destination and the model it blocked are both named");
  assert.deepEqual(slate.pricing.exclusions.map((entry) => entry.code),
    ["destination_not_permitted", "destination_not_permitted"]);
  for (const exclusion of slate.pricing.exclusions) {
    assert.match(exclusion.reason, /not permitted/);
  }
});

// ---------------------------------------------------------------------------
// 4. The headline is the sum of the actions, on both paths.
// ---------------------------------------------------------------------------

const SECOND_ROW = Object.freeze({
  ...USAGE_ROW,
  model: "premium-beta",
  inputTokens: 1_500_000_000,
  outputTokens: 500_000_000,
  tokens: 2_000_000_000,
  requests: 2_000_000,
  spendMinor: 5_000_000,
});

for (const [name, card, expected] of [
  // Reference: row A recovers $40,000 (above). Row B is half of row A at the
  // same observed price, so 5,000,000 − 3,000,000 = 2,000,000 minor = $20,000.
  ["the reference card", null, { total: 60_000, rows: [40_000, 20_000] }],
  // Declared: row A recovers $84,000 (above). Row B halves it:
  // 5,000,000 − 800,000 = 4,200,000 minor = $42,000.
  ["a declared card", declaredCard(), { total: 126_000, rows: [84_000, 42_000] }],
]) {
  test(`the hero total equals the sum of the ranked actions on ${name}`, () => {
    const analysis = analyze(card, [USAGE_ROW, SECOND_ROW]);
    const unit = analysis.ranked[0];
    assert.deepEqual(unit.candidates.map((entry) => entry.recoverableUsd), expected.rows);
    assert.equal(unit.recoverableUsd, expected.total);
    assert.equal(analysis.recoverableUsd, expected.total);
    // …and the ranked list the page actually renders adds up to its own headline.
    const slate = routingSlate(envelope(analysis));
    assert.equal(slate.rules.length, 2);
    assert.equal(
      slate.rules.reduce((sum, rule) => sum + rule.expectedMonthlyUsd, 0),
      slate.totalExpectedMonthlyUsd);
    assert.equal(slate.totalExpectedMonthlyUsd, expected.total);
  });
}

// ---------------------------------------------------------------------------
// The blended unit rule reads the same resolver.
// ---------------------------------------------------------------------------

const tokenRecord = (quantity, amountMinor) => ({
  serviceCategory: "text-generation",
  provider: "openai",
  usage: { quantity, unit: "tokens" },
  cost: { amount_minor: amountMinor, status: "final" },
});

const REQUEST_RECORD = {
  serviceCategory: "text-generation",
  provider: "openai",
  usage: { quantity: 4_000_000, unit: "requests" },
  cost: { amount_minor: 0, status: "final" },
};

test("the blended unit rule prices through the card too, and stands still without one", () => {
  const records = [tokenRecord(4_000_000_000, 10_000_000), REQUEST_RECORD];
  // Reference: 4,000,000,000 × 1,500 ÷ 1,000,000 = 6,000,000 minor projected.
  const reference = evaluateDownRoutingCandidate({ unitId: "unit-atlas", records });
  assert.deepEqual(
    { projected: reference.projectedStandardTierSpendUsd,
      recoverable: reference.recoverableUsd, decision: reference.decisionCode },
    { projected: 60_000, recoverable: 40_000, decision: "candidate_verified_call_shape" });
  assert.equal(reference.pricing.rateSource, "reference");
  // Declared, blended (no input/output split on this contract shape): the mean
  // of 320 and 640 is 480 minor per million, so 4,000,000,000 × 480 ÷ 1,000,000
  // = 1,920,000 minor projected, and 10,000,000 − 1,920,000 = 8,080,000.
  const declared = evaluateDownRoutingCandidate({
    unitId: "unit-atlas", records, rateCard: declaredCard(),
  });
  assert.deepEqual(
    { projected: declared.projectedStandardTierSpendUsd, recoverable: declared.recoverableUsd },
    { projected: 19_200, recoverable: 80_800 });
  assert.deepEqual(
    { rateSource: declared.pricing.rateSource, discount: declared.pricing.discountApplied },
    { rateSource: "declared", discount: true });
  // Forbidden: no destination to move to, so no saving and a named decision.
  const forbidden = evaluateDownRoutingCandidate({
    unitId: "unit-atlas", records, rateCard: FORBIDDEN_STANDARD(),
  });
  assert.deepEqual(
    { flagged: forbidden.flagged, recoverable: forbidden.recoverableUsd,
      decision: forbidden.decisionCode },
    { flagged: false, recoverable: 0, decision: "destination_not_permitted" });
  assert.equal(forbidden.pricing.excludedDestinations.length, 1);
  // Observed spend is read off the records and is the same on all three paths.
  for (const result of [reference, declared, forbidden]) {
    assert.equal(result.candidateSpendUsd, 100_000);
    assert.equal(result.routableSpendUsd, 100_000);
  }
});
