// Labelled fixtures for the per-model down-routing rule.
//
// Same discipline as tests/down-routing-candidates.test.js: each fixture names
// what it pins down and writes out the arithmetic, so a reviewer checks the
// expectation against the stated rule rather than against the implementation.
//
// The reference arithmetic every fixture below uses, per model:
//   observed price   = round(spendMinor x 1,000,000 / tokens) minor per million
//   tier             = first row of DOWN_ROUTING_TIER_PRICES whose floor it clears
//   call shape       = tokens / requests, ceiling 2000 tokens per call
//   projected        = round(tokens x cheaper-tier price / 1,000,000) minor
//   delta            = spendMinor - projected, claimed only when positive
//   unit recoverable = sum of the deltas. Nothing else is in the chain.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DOWN_ROUTING_CONSTANTS,
  DOWN_ROUTING_TIER_PRICES,
  MODEL_ROUTING_REASON_CODES,
  MODEL_ROUTING_STATUSES,
  analyzeModelRouting,
  classifyModelRoutingCandidate,
  evaluateUnitModelRouting,
} from "../src/down-routing-candidates.js";
import { normalizeLocalFinops } from "../src/local-finops.js";
import { parseLocalImportFile } from "../src/finops-tabular-import.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";
const UNIT = "psn_unit_fixture_000001";

/** One ModelUsageRow, in the shape the delimited importer emits. */
const usage = ({
  model = "psn_model_0000000000000001", provider = "openai", spendMinor, tokens,
  inputTokens = null, outputTokens = null, requests = null, estimated = false, orgUnitId = UNIT,
}) => ({
  orgUnitId,
  model,
  provider,
  inputTokens: inputTokens ?? Math.round(tokens * 0.75),
  outputTokens: outputTokens ?? tokens - Math.round(tokens * 0.75),
  tokens,
  requests,
  spendMinor,
  estimated,
  sourceRows: 1,
});

const FIXTURES = [
  {
    name: "premium model, short calls, enough volume",
    note: "The case the analysis exists for. 40,000,000 tokens cost 120,000 minor, so the "
      + "observed price is 3000 minor per million — premium. 20,000 requests give 2,000 tokens "
      + "per call, exactly at the ceiling. Projected is round(40,000,000 x 1500 / 1,000,000) = "
      + "60,000 minor, so the delta is 120,000 - 60,000 = 600.00 USD.",
    rows: [usage({ spendMinor: 120_000, tokens: 40_000_000, requests: 20_000 })],
    expect: {
      status: "scored", reasonCode: null, recoverableUsd: 600,
      candidates: [{ tier: "premium", proposedTier: "standard", calls: 20_000,
        currentSpendUsd: 1200, projectedSpendUsd: 600, recoverableUsd: 600 }],
      confidence: "High",
    },
  },
  {
    name: "a cheap model next to a premium one does not dilute it",
    note: "This is the blend the unit-level rule cannot see through. The premium model is the "
      + "fixture above (600.00 USD recoverable). Beside it sits 60,000,000 tokens for 60,000 "
      + "minor — 1000 minor per million, already the cheapest tier, nothing to move. Blended, "
      + "the unit is 180,000 minor over 100,000,000 tokens = 1800 per million, UNDER the 2000 "
      + "premium floor, and the unit-level rule returns zero. Per model the answer is still "
      + "600.00 USD, and the cheap model is reported as excluded rather than repriced.",
    rows: [
      usage({ spendMinor: 120_000, tokens: 40_000_000, requests: 20_000 }),
      usage({ model: "psn_model_0000000000000002", spendMinor: 60_000, tokens: 60_000_000,
        requests: 30_000 }),
    ],
    expect: {
      status: "scored", reasonCode: null, recoverableUsd: 600,
      candidates: [{ tier: "premium", proposedTier: "standard", calls: 20_000,
        currentSpendUsd: 1200, projectedSpendUsd: 600, recoverableUsd: 600 }],
      excluded: ["already_cheapest_tier"],
      confidence: "High",
    },
  },
  {
    name: "long-context calls are not proposed for a cheaper tier",
    note: "3000 minor per million on 200,000,000 tokens over 20,000 requests is 10,000 tokens "
      + "per call, five times the ceiling. Nothing here says a long-context call survives a "
      + "cheaper tier, so the delta is not claimed. The unit is still scored — the data was "
      + "sufficient to decide — it simply has no candidate.",
    rows: [usage({ spendMinor: 600_000, tokens: 200_000_000, requests: 20_000 })],
    expect: {
      status: "scored", reasonCode: null, recoverableUsd: 0,
      candidates: [], excluded: ["long_context_calls"], confidence: "High",
    },
  },
  {
    name: "premium model below the change-cost minimum",
    note: "3000 minor per million and 500 tokens per call, but only 400 requests, under the "
      + "1,000-request minimum. The saving is assumed smaller than the cost of changing "
      + "routing, and because that is the only thing that stopped the figure, the unit is "
      + "insufficient_data with insufficient_volume rather than a defensible zero.",
    rows: [usage({ spendMinor: 600, tokens: 200_000, requests: 400 })],
    expect: {
      status: "insufficient_data", reasonCode: "insufficient_volume", recoverableUsd: 0,
      candidates: [], excluded: ["insufficient_volume"], confidence: "High",
    },
  },
  {
    name: "model identity present, token counts absent",
    note: "A Bedrock-style export: spend per model, no token columns. There is no price per "
      + "token, so there is no tier and no delta. Reported as missing_token_counts, never as a "
      + "zero saving.",
    rows: [usage({ spendMinor: 90_000, tokens: 0, inputTokens: 0, outputTokens: 0 })],
    expect: {
      status: "insufficient_data", reasonCode: "missing_token_counts", recoverableUsd: 0,
      candidates: [], excluded: ["missing_token_counts"], confidence: "High",
    },
  },
  {
    name: "tokens present, observed cost absent",
    note: "Token volume with a zero invoice amount cannot establish a paid model tier. Zero is "
      + "withheld as insufficient_observed_cost rather than ranked as a clean zero.",
    rows: [usage({ spendMinor: 0, tokens: 10_000_000, requests: 5000 })],
    expect: {
      status: "insufficient_data", reasonCode: "insufficient_observed_cost", recoverableUsd: 0,
      candidates: [], excluded: ["insufficient_observed_cost"], confidence: "High",
    },
  },
  {
    name: "no model dimension at all",
    note: "What a v1 JSON envelope produces: spend joined to the unit, no model field anywhere. "
      + "This is the case a flat share used to paper over. The unit is not scored zero and does "
      + "not enter the ranking; it is unknown_model_tier.",
    rows: [],
    expect: {
      status: "insufficient_data", reasonCode: "unknown_model_tier", recoverableUsd: 0,
      candidates: [], confidence: "High",
    },
  },
  {
    name: "unattributed model spend lowers the tier without hiding the number",
    note: "The premium candidate is the first fixture, 600.00 USD. Beside it, spend whose model "
      + "identifier was a placeholder the exporter writes when it does not know. That spend is "
      + "excluded from the arithmetic and costs the unit a confidence step; the reproducible "
      + "600.00 USD is still published.",
    rows: [
      usage({ spendMinor: 120_000, tokens: 40_000_000, requests: 20_000 }),
      { ...usage({ spendMinor: 45_000, tokens: 10_000_000, requests: 9_000 }), model: null },
    ],
    expect: {
      status: "scored", reasonCode: null, recoverableUsd: 600,
      confidence: "Medium", confidenceReasons: ["unattributed_model_spend"],
    },
  },
  {
    name: "no request count, unrecognized vendor, estimated cost",
    note: "Same 600.00 USD arithmetic as the first fixture with three completeness penalties: "
      + "call shape could not be checked, the vendor is outside the contract's list, and the "
      + "cost is not final. The tier floors at Low while the number stays reproducible.",
    rows: [usage({ spendMinor: 120_000, tokens: 40_000_000, provider: "other", estimated: true })],
    expect: {
      status: "scored", reasonCode: null, recoverableUsd: 600, confidence: "Low",
      confidenceReasons: ["missing_request_counts", "unrecognized_provider", "estimated_costs"],
    },
  },
];

const evaluate = (fixture) =>
  evaluateUnitModelRouting({ unitId: UNIT, modelUsage: fixture.rows });

for (const fixture of FIXTURES) {
  test(`per-model fixture: ${fixture.name}`, () => {
    const result = evaluate(fixture);
    assert.equal(result.status, fixture.expect.status, "status");
    assert.equal(result.reasonCode, fixture.expect.reasonCode, "reason code");
    assert.equal(result.recoverableUsd, fixture.expect.recoverableUsd, "recoverable");
    assert.equal(result.confidence.level, fixture.expect.confidence, "confidence tier");
    if (fixture.expect.confidenceReasons) {
      assert.deepEqual(result.confidence.reasons.map((reason) => reason.code),
        fixture.expect.confidenceReasons, "confidence reasons");
    }
    if (fixture.expect.candidates) {
      assert.equal(result.candidates.length, fixture.expect.candidates.length, "candidate count");
      fixture.expect.candidates.forEach((expected, index) => {
        for (const [key, value] of Object.entries(expected)) {
          assert.equal(result.candidates[index][key], value, `candidate ${index}: ${key}`);
        }
      });
    }
    if (fixture.expect.excluded) {
      assert.deepEqual(result.excludedModels.map((entry) => entry.code), fixture.expect.excluded,
        "excluded models");
    }
    // The unit figure is the sum of the per-model deltas and nothing else.
    const summed = result.candidates.reduce((sum, entry) => sum + entry.recoverableUsd, 0);
    assert.equal(result.recoverableUsd, Math.round(summed * 100) / 100,
      "the unit figure must be the sum of its per-model deltas");
    // Every published candidate carries the inputs that produced it.
    for (const candidate of result.candidates) {
      assert.equal(candidate.inputs.tier, candidate.tier);
      assert.equal(candidate.inputs.inputTokens + candidate.inputs.outputTokens,
        candidate.inputs.tokens, "the token shape must add up to the token count");
      assert.ok(candidate.inputs.observedMinorPerMillionTokens > 0);
      assert.ok(candidate.inputs.sourceRows >= 1);
    }
    for (const reason of result.confidence.reasons) {
      assert.equal(reason.effect, "lowered one tier");
      assert.ok(reason.detail.length > 20, "every tier penalty states why in prose");
    }
  });
}

test("every reason code and both statuses are exercised by a fixture", () => {
  const seen = new Set(FIXTURES.map((fixture) => evaluate(fixture).reasonCode).filter(Boolean));
  assert.deepEqual([...seen].sort(), [...MODEL_ROUTING_REASON_CODES].sort());
  const statuses = new Set(FIXTURES.map((fixture) => evaluate(fixture).status));
  assert.deepEqual([...statuses].sort(), [...MODEL_ROUTING_STATUSES].sort());
});

test("the tier price table is the only place a tier price is named", () => {
  assert.deepEqual(DOWN_ROUTING_TIER_PRICES.map((entry) => entry.tier), ["premium", "standard"]);
  const [premium, standard] = DOWN_ROUTING_TIER_PRICES;
  assert.equal(premium.minObservedMinorPerMillionTokens,
    DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS);
  assert.equal(standard.priceMinorPerMillionTokens,
    DOWN_ROUTING_CONSTANTS.STANDARD_TIER_REFERENCE_MINOR_PER_MILLION_TOKENS);
  assert.equal(premium.cheaperTier, "standard");
  assert.equal(standard.cheaperTier, null, "the cheapest tier has nowhere to go");
  // The rule reads the table rather than a literal: move the floor and the
  // classification moves with it.
  assert.equal(classifyModelRoutingCandidate({
    tokens: 1_000_000, requests: 2000, spendMinor: 2000,
  }).tier.tier, "premium");
  assert.equal(classifyModelRoutingCandidate({
    tokens: 1_000_000, requests: 2000, spendMinor: 1999,
  }).tier.tier, "standard");
});

test("recoverable spend cannot come from a flat share of spend", () => {
  // Identical spend, different token counts. Any rule of the form
  // `recoverable = share x spend` must return the same figure for both.
  const cheapTokens = evaluateUnitModelRouting({ unitId: UNIT, modelUsage: [
    usage({ spendMinor: 120_000, tokens: 40_000_000, requests: 20_000 })] });
  const dearTokens = evaluateUnitModelRouting({ unitId: UNIT, modelUsage: [
    usage({ spendMinor: 120_000, tokens: 10_000_000, requests: 20_000 })] });
  assert.equal(cheapTokens.candidates[0].currentSpendUsd,
    dearTokens.candidates[0].currentSpendUsd);
  assert.equal(cheapTokens.recoverableUsd, 600); // 120,000 - 60,000 minor
  assert.equal(dearTokens.recoverableUsd, 1050); // 120,000 - 15,000 minor
});

test("insufficient-data units are a separate list, never a zero in the ranking", () => {
  const analysis = analyzeModelRouting({
    unitIds: ["psn_unit_scored_000001", "psn_unit_blind_000001", "psn_unit_clean_000001"],
    modelUsage: [
      usage({ orgUnitId: "psn_unit_scored_000001", spendMinor: 120_000, tokens: 40_000_000,
        requests: 20_000 }),
      // Already the cheapest tier: a real, defensible zero.
      usage({ orgUnitId: "psn_unit_clean_000001", spendMinor: 60_000, tokens: 60_000_000,
        requests: 30_000 }),
    ],
  });
  assert.deepEqual(analysis.ranked.map((unit) => unit.unitId),
    ["psn_unit_scored_000001", "psn_unit_clean_000001"]);
  assert.equal(analysis.ranked[1].recoverableUsd, 0);
  assert.equal(analysis.ranked[1].reasonCode, null, "a defensible zero carries no reason code");
  assert.deepEqual(analysis.insufficientData.map((unit) => unit.unitId),
    ["psn_unit_blind_000001"]);
  assert.equal(analysis.insufficientData[0].reasonCode, "unknown_model_tier");
  assert.equal(analysis.recoverableUsd, 600, "the org figure sums the scored units only");
  // The blind unit is nowhere in the ranking, at any score.
  assert.equal(analysis.ranked.some((unit) => unit.unitId === "psn_unit_blind_000001"), false);
  // Every requested unit is accounted for in exactly one list.
  assert.equal(analysis.ranked.length + analysis.insufficientData.length, 3);
});

// --- the live path ---------------------------------------------------------
//
// These fixtures are not scored by a shim. `normalizeLocalFinops` is the
// function the page calls on every import, and it calls `analyzeModelRouting`
// out of the same module the fixtures above import. The test below drives a CSV
// through `parseLocalImportFile` — the one entry point the page and the import
// worker both call — and asserts the arithmetic arrives intact.

const USAGE_CSV = [
  "date,project,model,input tokens,output tokens,requests,amount,currency",
  // Atlas: a premium model beside a large cheap one. Blended, Atlas is under
  // the premium floor and the unit-level rule finds nothing.
  "2026-06-05,Atlas Platform,gpt-premium,30000000,10000000,20000,1200.00,USD",
  "2026-06-05,Atlas Platform,gpt-economy,45000000,15000000,30000,600.00,USD",
  // Boreal: three times Atlas's spend, all of it already at the cheapest tier.
  // Ranked by size it leads; ranked by exposure it is clean.
  "2026-06-05,Boreal Data,gpt-economy,400000000,100000000,250000,5000.00,USD",
].join("\n");

const ROSTER_CSV = [
  "unit,parent,active",
  "Atlas Platform,,true",
  "Boreal Data,,true",
].join("\n");

test("a CSV import reaches the per-model rule through the live analysis entry point", () => {
  const provider = parseLocalImportFile(USAGE_CSV, "usage.csv", "text/csv",
    { generatedAt: GENERATED_AT });
  const hris = parseLocalImportFile(ROSTER_CSV, "roster.csv", "text/csv",
    { generatedAt: GENERATED_AT });
  const result = normalizeLocalFinops({ provider, hris });

  // The v1 envelope still cannot carry a model, so the per-model rows travel
  // beside it — pseudonymous, like every other label out of a reader's file.
  assert.equal(provider.modelUsage.length, 3);
  for (const row of provider.modelUsage) {
    assert.match(row.model, /^psn_model_[0-9a-f]{16}$/);
  }
  assert.equal(JSON.stringify(provider).includes("gpt-premium"), false,
    "a model name is a cell value and must not survive normalization");

  const atlas = result.modelRouting.ranked.find((unit) =>
    unit.unitId === result.rankedDepartments.find((item) =>
      item.spendUsd === 1800).id);
  assert.ok(atlas, "Atlas is scored, not bucketed");
  assert.equal(atlas.recoverableUsd, 600);
  assert.equal(atlas.candidates.length, 1);
  const [candidate] = atlas.candidates;
  assert.equal(candidate.tier, "premium");
  assert.equal(candidate.proposedTier, "standard");
  assert.equal(candidate.calls, 20_000);
  assert.equal(candidate.currentSpendUsd, 1200);
  assert.equal(candidate.projectedSpendUsd, 600);
  assert.equal(candidate.inputs.inputTokens, 30_000_000);
  assert.equal(candidate.inputs.outputTokens, 10_000_000);
  assert.equal(candidate.inputs.tokensPerCall, 2000);
  assert.equal(atlas.excludedModels[0].code, "already_cheapest_tier");

  // The size effect, stated as an assertion: Boreal spends nearly three times
  // what Atlas does and has nothing to move; the old unit-level blend has Atlas
  // at zero as well, so the two are indistinguishable there.
  const boreal = result.modelRouting.ranked.find((unit) => unit.unitId !== atlas.unitId);
  assert.equal(boreal.recoverableUsd, 0);
  assert.equal(boreal.status, "scored");
  assert.equal(result.modelRouting.ranked[0].unitId, atlas.unitId,
    "the ranking must lead with exposure, not with spend");
  assert.ok(result.rankedDepartments.every((item) => item.recoverableUsd === 0),
    "the blended unit-level rule finds nothing in this import");
  assert.equal(result.modelRouting.recoverableUsd, 600);
});

test("a JSON envelope carries no model dimension and is bucketed, not zeroed", () => {
  const provider = parseLocalImportFile(USAGE_CSV, "usage.csv", "text/csv",
    { generatedAt: GENERATED_AT });
  const hris = parseLocalImportFile(ROSTER_CSV, "roster.csv", "text/csv",
    { generatedAt: GENERATED_AT });
  // Exactly what an uploaded .json envelope hands the analysis: the validated
  // document and nothing beside it.
  const result = normalizeLocalFinops({ provider: { document: provider.document }, hris });
  assert.equal(result.modelRouting.ranked.length, 0);
  assert.equal(result.modelRouting.insufficientData.length, 2);
  for (const unit of result.modelRouting.insufficientData) {
    assert.equal(unit.status, "insufficient_data");
    assert.equal(unit.reasonCode, "unknown_model_tier");
    assert.ok(MODEL_ROUTING_REASON_CODES.includes(unit.reasonCode));
  }
  assert.equal(result.modelRouting.recoverableUsd, 0);
});

test("scoring the same import twice is byte-identical", () => {
  const rows = FIXTURES.flatMap((fixture) => fixture.rows);
  const once = JSON.stringify(analyzeModelRouting({ unitIds: [UNIT], modelUsage: rows }));
  const twice = JSON.stringify(analyzeModelRouting({ unitIds: [UNIT], modelUsage: rows }));
  assert.equal(once, twice);
  assert.doesNotMatch(once, /\d{4}-\d{2}-\d{2}T/, "no timestamp may enter the scored output");
});
