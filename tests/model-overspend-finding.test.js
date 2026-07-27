import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MODEL_OVERSPEND_CONSTANTS,
  MODEL_OVERSPEND_FINDING_VERSION,
  ModelOverspendValidationError,
  buildModelOverspendFinding,
  evaluateEligibility,
  recognizeIdentifier,
  validateModelOverspendFinding,
} from "../src/model-overspend-finding.js";

const fixtureText = await readFile(
  new URL("../src/model-overspend-finding-fixture.json", import.meta.url), "utf8",
);
const fixture = JSON.parse(fixtureText);

const COLUMNS = Object.freeze({
  period: "Usage month", segment: "Workspace", model: "Model",
  requests: "Requests", spend: "Cost (USD)",
});

/** One synthetic analysis row. Overrides isolate the single rule under test. */
function row(overrides = {}) {
  return {
    period: "2026-06",
    segmentId: "seg-atlas",
    segmentLabel: "Atlas Platform",
    model: "syn-large-1",
    requests: 40000,
    spendMinor: 800000,
    observedDays: 30,
    daysInPeriod: 30,
    rowCount: 30,
    ...overrides,
  };
}

/** A file whose reporting month supports a headline: one dear model, one cheap one. */
function routableRows(overrides = {}) {
  return [
    row({ model: "syn-large-1", requests: 40000, spendMinor: 800000, ...overrides }),
    row({ model: "syn-small-1", requests: 60000, spendMinor: 300000, ...overrides }),
  ];
}

const build = (rows, columns = COLUMNS) => buildModelOverspendFinding({ columns, rows });

// --- the happy path, pinned ------------------------------------------------

test("the fixture is exactly what the contract builds from its own input", () => {
  const built = buildModelOverspendFinding(structuredClone(fixture.input));
  assert.deepEqual(JSON.parse(JSON.stringify(built)), fixture.finding);
  assert.equal(fixture.finding.schemaVersion, MODEL_OVERSPEND_FINDING_VERSION);
});

test("the fixture validates against the contract", () => {
  assert.doesNotThrow(() => validateModelOverspendFinding(structuredClone(fixture.finding)));
});

test("the headline metric is reproducible by hand from the customer's own rows", () => {
  const { metric } = fixture.finding;
  // Pooled cheaper-tier rate over the reporting month: (300000 + 20000) minor
  // across (60000 + 5000) requests. Atlas's own 40000 requests at that rate:
  const projected = Math.round((40000 * 320000) / 65000);
  assert.equal(projected, 196923);
  assert.equal(metric.candidateSpendMinor, 320000);
  assert.equal(metric.candidateRequests, 65000);
  assert.equal(metric.projectedSpendMinor, projected);
  assert.equal(metric.amountMinor, 800000 - projected);
  assert.equal(metric.amountUsd, 6030.77);
  assert.equal(metric.model, "syn-large-1");
  assert.equal(metric.candidateModel, "syn-small-1");
  assert.equal(fixture.finding.status, "ok");
});

test("confidence is derived from eligibility, not asserted", () => {
  // The cheaper tier's rate pools two segments, which is one step down from high.
  assert.deepEqual(fixture.finding.confidence.reasons.map((reason) => reason.code),
    ["candidate_rate_pooled_across_segments"]);
  assert.equal(fixture.finding.confidence.level, "medium");
  const handSet = structuredClone(fixture.finding);
  handSet.confidence.level = "high";
  assert.throws(() => validateModelOverspendFinding(handSet), ModelOverspendValidationError);
});

test("per-model rows are evidence, never the headline", () => {
  const { evidence } = fixture.finding;
  assert.equal(evidence.disclosure, "progressive");
  assert.equal(evidence.rows.filter((entry) => entry.isHeadline).length, 1);
  // Every row the headline was not chosen from says why it was not chosen.
  for (const entry of evidence.rows) {
    assert.ok(entry.overspendMinor !== null || entry.excludedReason,
      `${entry.model}/${entry.segmentId} is excluded without a reason`);
  }
  const nonHeadline = structuredClone(fixture.finding);
  nonHeadline.evidence.disclosure = "primary";
  assert.throws(() => validateModelOverspendFinding(nonHeadline), ModelOverspendValidationError);
});

test("the same rows in any order produce the same finding", () => {
  const forward = build(structuredClone(fixture.input.rows));
  const reversed = build(structuredClone(fixture.input.rows).reverse());
  assert.deepEqual(reversed, forward);
});

// --- metric definitions ----------------------------------------------------

test("the candidate is the nearest cheaper tier, not the cheapest in the file", () => {
  const finding = build([
    row({ model: "syn-large-1", requests: 40000, spendMinor: 800000 }),
    row({ model: "syn-mid-1", requests: 40000, spendMinor: 400000 }),
    row({ model: "syn-tiny-1", requests: 40000, spendMinor: 40000 }),
  ]);
  assert.equal(finding.metric.candidateModel, "syn-mid-1");
  assert.equal(finding.metric.amountMinor, 800000 - 400000);
});

test("a partial month is prorated on both spend and requests, and says so", () => {
  const finding = build(routableRows({ observedDays: 15, daysInPeriod: 30 }));
  // Halving the observed window doubles both sides, so the rate is unchanged
  // and only the size of the month moves.
  assert.equal(finding.metric.observedSpendMinor, 1600000);
  assert.equal(finding.metric.eligibleRequests, 80000);
  assert.equal(finding.provenance.proration.prorated, true);
  assert.deepEqual(finding.provenance.proration.months.map((month) => month.observedDays),
    [15, 15]);
  assert.ok(finding.confidence.reasons.some((reason) => reason.code === "prorated_partial_month"));
});

test("provenance names the customer's own columns and counts the rows behind the number", () => {
  const finding = build(structuredClone(fixture.input.rows));
  assert.deepEqual(finding.provenance.columns, {
    period: "Usage month", segment: "Workspace", model: "Model",
    requests: "Requests", spend: "Cost (USD)",
  });
  assert.deepEqual(finding.provenance.periods, ["2026-05", "2026-06"]);
  assert.equal(finding.provenance.reportingPeriod, "2026-06");
  assert.equal(finding.provenance.sourceRowCount, 182);
});

// --- benchmark honesty -----------------------------------------------------

test("the only benchmark is intra-tenant and the contract has no field for any other", () => {
  assert.equal(fixture.finding.benchmark.scope, "intra_tenant");
  const keys = Object.keys(fixture.finding.benchmark);
  assert.ok(!keys.some((key) => /peer|industry|market|competitor/i.test(key)), keys.join());
  // Atlas is cheaper per request than Borealis on the same model: the benchmark
  // is a comparison, not a second way of restating the headline.
  assert.equal(fixture.finding.benchmark.segmentCostPerRequestMinor, 20);
  assert.equal(fixture.finding.benchmark.otherSegmentsCostPerRequestMinor, 30);

  const rescoped = structuredClone(fixture.finding);
  rescoped.benchmark.scope = "peer_median";
  assert.throws(() => validateModelOverspendFinding(rescoped), ModelOverspendValidationError);
  const smuggled = structuredClone(fixture.finding);
  smuggled.benchmark.industryCostPerRequestMinor = 25;
  assert.throws(() => validateModelOverspendFinding(smuggled), ModelOverspendValidationError);
});

test("one segment on a model supports no comparison, and says so instead of showing one", () => {
  const finding = build(routableRows());
  assert.equal(finding.benchmark.available, false);
  assert.match(finding.benchmark.reason, /nothing within this organization/);
  assert.equal(finding.benchmark.scope, "intra_tenant");
  validateModelOverspendFinding(finding);
});

// --- degraded shapes -------------------------------------------------------

test("degraded: no request counts in the file", () => {
  const finding = build(
    routableRows({ requests: null }),
    { ...COLUMNS, requests: null },
  );
  assert.equal(finding.status, "degraded_no_request_counts");
  assert.equal(finding.metric.available, false);
  // Never zero: a zero reads as a measured result.
  assert.equal(finding.metric.amountMinor, null);
  assert.match(finding.metric.reason, /no request count/i);
  // What is still answerable: where the money is.
  assert.match(finding.headline, /largest block of model spend/);
  assert.match(finding.headline, /8000\.00 USD on syn-large-1/);
  assert.equal(finding.action.available, false);
  assert.match(finding.action.reason, /request-count column/);
  assert.equal(finding.confidence.level, "low");
  validateModelOverspendFinding(finding);
});

test("degraded: only one period present", () => {
  const finding = build(routableRows());
  assert.equal(finding.status, "degraded_single_period");
  // The overspend is still answerable from one month; only direction is not.
  assert.equal(finding.metric.available, true);
  assert.equal(finding.metric.amountMinor, 800000 - Math.round((40000 * 300000) / 60000));
  assert.ok(finding.confidence.reasons.some((reason) => reason.code === "single_period"));
  assert.ok(!Object.keys(finding).some((key) => /trend|direction|forecast/i.test(key)));
  validateModelOverspendFinding(finding);
});

test("degraded: unrecognized model identifiers", () => {
  const finding = build([
    row({ model: "unknown", spendMinor: 800000 }),
    row({ model: "  ", spendMinor: 120000, segmentId: "seg-borealis", segmentLabel: "Borealis" }),
  ]);
  assert.equal(finding.status, "degraded_unrecognized_models");
  assert.equal(finding.metric.available, false);
  assert.match(finding.headline, /9200\.00 USD of spend/);
  assert.match(finding.headline, /no recognizable model identifier/);
  assert.equal(finding.provenance.unrecognizedModelSpendMinor, 920000);
  assert.deepEqual(finding.evidence.unattributedRows.map((entry) => entry.reason),
    ["placeholder_identifier", "placeholder_identifier"]);
  assert.match(finding.action.reason, /model or SKU identifier/);
  validateModelOverspendFinding(finding);
});

test("partly unrecognized spend lowers confidence without hiding the finding", () => {
  const finding = build([
    ...routableRows(),
    row({ model: "n/a", spendMinor: 50000, segmentId: "seg-ceres", segmentLabel: "Ceres" }),
  ]);
  assert.equal(finding.metric.available, true);
  assert.ok(finding.confidence.reasons.some(
    (reason) => reason.code === "unrecognized_models_present"));
  assert.equal(finding.evidence.unattributedRows.length, 1);
  assert.equal(finding.provenance.unrecognizedModelSpendMinor, 50000);
  validateModelOverspendFinding(finding);
});

// --- eligibility -----------------------------------------------------------

test("below the request floor, the metric is withheld with the floor as its reason", () => {
  const finding = build([
    row({ model: "syn-large-1", requests: 900, spendMinor: 800000 }),
    row({ model: "syn-small-1", requests: 900, spendMinor: 20000 }),
  ]);
  assert.equal(finding.status, "unavailable");
  assert.equal(finding.metric.available, false);
  assert.match(finding.metric.reason, /Fewer than 1000 requests in the month/);
  assert.equal(finding.action.available, false);
  validateModelOverspendFinding(finding);
});

test("a cheaper tier the segment does not itself run is not evidence it is routable", () => {
  const finding = build([
    row({ model: "syn-large-1", requests: 40000, spendMinor: 800000 }),
    row({
      model: "syn-small-1", requests: 60000, spendMinor: 300000,
      segmentId: "seg-borealis", segmentLabel: "Borealis Research",
    }),
  ]);
  assert.equal(finding.status, "unavailable");
  assert.match(finding.metric.reason, /does not already run the cheaper model/);
  validateModelOverspendFinding(finding);
});

test("the eligibility rule states a reason for every claim it withholds", () => {
  const eligibility = evaluateEligibility({
    modelRecognized: true, requestsKnown: true, requests: 5000,
    candidateAvailable: true, candidateRequestsInSegment: 5000,
    comparableSegments: 1, comparablePeriods: 1,
  });
  assert.equal(eligibility.overspend.available, true);
  assert.equal(eligibility.overspend.reason, null);
  assert.equal(eligibility.benchmark.available, false);
  assert.match(eligibility.benchmark.reason, /segments clear the request floor/);
  assert.equal(eligibility.trend.available, false);
  assert.match(eligibility.trend.reason, /no direction of travel/);
  assert.equal(evaluateEligibility({ modelRecognized: false }).overspend.reason,
    "The model identifier on this spend is not recognized, so no rate can be attributed to it.");
});

test("model identifiers are recognized structurally, never against a vendor catalogue", () => {
  assert.equal(recognizeIdentifier("syn-large-1").recognized, true);
  assert.equal(recognizeIdentifier("  Syn Large  1 ").label, "Syn Large 1");
  assert.equal(recognizeIdentifier("unknown").reason, "placeholder_identifier");
  assert.equal(recognizeIdentifier("<script>").reason, "unsupported_characters");
  assert.equal(recognizeIdentifier("x".repeat(MODEL_OVERSPEND_CONSTANTS.MAX_LABEL_LENGTH + 1))
    .reason, "identifier_too_long");
});

// --- the validator is a gate, not a formality ------------------------------

test("the validator rejects a payload that dresses absence as a measurement", () => {
  const zeroed = structuredClone(fixture.finding);
  zeroed.metric.available = false;
  zeroed.metric.reason = "no candidate";
  zeroed.metric.amountMinor = 0;
  assert.throws(() => validateModelOverspendFinding(zeroed), /never zero/);

  const undeclared = structuredClone(fixture.finding);
  undeclared.peerComparison = { median: 1 };
  assert.throws(() => validateModelOverspendFinding(undeclared), /undeclared field/);

  const unsourced = structuredClone(fixture.finding);
  unsourced.provenance.columns.requests = null;
  assert.throws(() => validateModelOverspendFinding(unsourced), /must name the source column/);

  const wrongArithmetic = structuredClone(fixture.finding);
  wrongArithmetic.metric.amountMinor += 1;
  assert.throws(() => validateModelOverspendFinding(wrongArithmetic),
    /does not equal observed minus projected/);
});

test("malformed analysis input fails loudly rather than being coerced", () => {
  assert.throws(() => build([row({ period: "June 2026" })]), /period: must be YYYY-MM/);
  assert.throws(() => build([row({ requests: 12.5 })]), /requests: must be an integer/);
  assert.throws(() => build([row({ observedDays: 40 })]), /cannot exceed daysInPeriod/);
  assert.throws(() => build([row(), row()]), /repeats period\/segment\/model/);
  assert.throws(() => buildModelOverspendFinding({ columns: COLUMNS }), /rows: must be an array/);
});
