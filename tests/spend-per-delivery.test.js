// The spend-per-delivery contract: the arithmetic, the state ladder, and the
// framing that keeps the figure an observation.
//
// Every expectation is computed by the shipped module from an input built here.
// Nothing transcribes a sentence the module authors, except where the point of the
// assertion is that a specific word never appears.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFOUNDERS, FRAMING, MAXIMUM_SPEND_USD, MINIMUM_BASELINE_PERIODS, MINIMUM_DELIVERIES,
  MINIMUM_PERIOD_DAYS, REQUIRED_PROVENANCE_FIELDS, SPEND_PER_DELIVERY_SCHEMA_VERSION,
  SPEND_PER_DELIVERY_STATE, SpendPerDeliveryError, deliveriesFromReleases,
  spendPeriodsFromAnalysis, spendPerDeliveryDecision, spendPerDeliveryInput,
} from "../src/spend-per-delivery.js";
import {
  EXAMPLE_DELIVERY_RELEASES, SPEND_PER_DELIVERY_FIXTURES, spendPerDeliveryFixture,
} from "../src/spend-per-delivery-fixtures.js";

/** A month of spend, end exclusive, as the analysis reports it. */
const month = (start, end, spendUsd, extra = {}) =>
  ({ periodStart: start, periodEnd: end, spendUsd, completeness: "complete", ...extra });

const shipped = (day, index = 0) =>
  ({ id: `r-${day}-${index}`, completedAt: `${day}T12:00:00.000Z` });

const decide = (spendPeriods, deliveries, provenance = {}) => spendPerDeliveryDecision({
  spendPeriods,
  deliveries,
  provenance: {
    origin: "import",
    source: "test input",
    derivedFromFields: REQUIRED_PROVENANCE_FIELDS,
    ...provenance,
  },
});

const MAY = month("2026-05-01", "2026-06-01", 30_000);
const JUNE = month("2026-06-01", "2026-07-01", 60_000);
const APRIL = month("2026-04-01", "2026-05-01", 30_000);

const threeInJune = [shipped("2026-06-02"), shipped("2026-06-12"), shipped("2026-06-22")];
const threeInMay = [shipped("2026-05-02", 1), shipped("2026-05-12", 1), shipped("2026-05-22", 1)];
const threeInApril = [shipped("2026-04-02", 2), shipped("2026-04-12", 2), shipped("2026-04-22", 2)];

/* ------------------------------- the arithmetic ------------------------------- */

test("the ratio is the headline period's spend over the releases inside it", () => {
  const state = decide([MAY, JUNE], [...threeInMay, ...threeInJune]);
  assert.equal(state.state, SPEND_PER_DELIVERY_STATE.eligible);
  assert.equal(state.schemaVersion, SPEND_PER_DELIVERY_SCHEMA_VERSION);
  // June, not May and not the two pooled: 60,000 over the three June releases.
  assert.deepEqual(
    { start: state.window.start, end: state.window.end, days: state.window.days },
    { start: "2026-06-01", end: "2026-07-01", days: 30 });
  assert.equal(state.metric.spendUsd, 60_000);
  assert.equal(state.metric.deliveries, 3);
  assert.equal(state.metric.spendPerDeliveryUsd, 20_000);
});

test("the period end is exclusive, so a boundary release counts once and in the later period", () => {
  // 2026-06-01T00:00:00Z is May's end and June's start.
  const boundary = { id: "boundary", completedAt: "2026-06-01T00:00:00.000Z" };
  const state = decide([APRIL, MAY, JUNE], [
    ...threeInApril, ...threeInMay, boundary, shipped("2026-06-12"), shipped("2026-06-22"),
  ]);
  assert.equal(state.metric.deliveries, 3, "the boundary release falls in June");
  // And May keeps exactly its own three, which is what makes the baseline 10,000.
  assert.equal(state.comparison.baselineUsd, 10_000);
});

test("the baseline is the mean of prior period ratios, each period one vote", () => {
  // April 30,000/3 = 10,000. May 30,000/3 = 10,000. Mean 10,000, and June is 20,000.
  const state = decide([APRIL, MAY, JUNE],
    [...threeInApril, ...threeInMay, ...threeInJune]);
  assert.equal(state.comparison.available, true);
  assert.equal(state.comparison.baselinePeriods, 2);
  assert.equal(state.comparison.baselineExcludedPeriods, 0);
  assert.equal(state.comparison.baselineUsd, 10_000);
  assert.equal(state.comparison.deltaUsd, 10_000);
  assert.equal(state.comparison.deltaPercent, 100);
  assert.equal(state.comparison.direction, "higher");
  // Pooled spend over pooled deliveries would be 120,000/9 = 13,333.33 — a
  // different number. The rule is mean-of-ratios, and this pins it.
  assert.notEqual(state.comparison.baselineUsd, 13_333.33);
});

test("a prior period that fails the floor is excluded from the baseline, never counted as zero", () => {
  // April has one release: below MINIMUM_DELIVERIES, so it cannot vote.
  const state = decide([APRIL, MAY, JUNE],
    [shipped("2026-04-02", 9), ...threeInMay, ...threeInJune]);
  assert.equal(state.comparison.available, false);
  assert.equal(state.comparison.reasonCode, "insufficient_baseline_periods");
  assert.equal(state.comparison.baselineUsd, null);
  assert.equal(state.comparison.baselinePeriods, 1);
  assert.equal(state.comparison.baselineExcludedPeriods, 1);
  assert.ok(MINIMUM_BASELINE_PERIODS > 1);
});

/** Three months of releases, so a two-period trailing baseline exists. */
const NINE_RELEASES = [...threeInApril, ...threeInMay, ...threeInJune];
const trio = (aprilUsd, mayUsd, juneUsd) => decide([
  month("2026-04-01", "2026-05-01", aprilUsd),
  month("2026-05-01", "2026-06-01", mayUsd),
  month("2026-06-01", "2026-07-01", juneUsd),
], NINE_RELEASES);

test("direction is read off the rounded percentage, so word and number agree", () => {
  assert.equal(trio(30_000, 30_000, 60_000).comparison.direction, "higher");
  const level = trio(60_000, 60_000, 60_000).comparison;
  assert.equal(level.deltaPercent, 0);
  assert.equal(level.direction, "level");
  const lower = trio(120_000, 120_000, 60_000).comparison;
  assert.equal(lower.direction, "lower");
  assert.ok(lower.deltaPercent < 0);
});

test("rounding is half away from zero, so a rise and a fall of the same size match", () => {
  // Baseline 10,000 both times. June at 10,125 is +1.25%, at 9,875 is -1.25%, and
  // the two must print the same magnitude rather than one of them absorbing the
  // half toward positive infinity.
  const rise = trio(30_000, 30_000, 30_375).comparison;
  const fall = trio(30_000, 30_000, 29_625).comparison;
  assert.equal(rise.deltaPercent, 1.3);
  assert.equal(fall.deltaPercent, -1.3);
});

/* ------------------------------ the state ladder ------------------------------ */

test("no spend is insufficient, and says which side is missing", () => {
  const state = decide([], threeInJune);
  assert.equal(state.state, SPEND_PER_DELIVERY_STATE.insufficient);
  assert.equal(state.reasonCode, "no_local_spend");
  assert.equal(state.metric.spendPerDeliveryUsd, null, "a withheld ratio is null, never zero");
});

test("an implausible extreme is withheld instead of becoming a decision-ready ratio", () => {
  const state = decide([month("2026-06-01", "2026-07-01", MAXIMUM_SPEND_USD + 0.01)],
    threeInJune);
  assert.equal(state.state, SPEND_PER_DELIVERY_STATE.insufficient);
  assert.equal(state.reasonCode, "implausible_local_spend");
  assert.equal(state.metric.spendPerDeliveryUsd, null);
  assert.match(state.statement, /withheld for review/);
  assert.match(state.nextAction.text, /Inspect the provider export/);
});

test("no delivery evidence is insufficient and carries the release log as the next action", () => {
  const state = decide([MAY, JUNE], []);
  assert.equal(state.state, SPEND_PER_DELIVERY_STATE.insufficient);
  assert.equal(state.reasonCode, "no_delivery_evidence");
  assert.equal(state.nextAction.rank, 1);
  assert.equal(state.nextAction.href, "/release.html");
  assert.equal(state.confidence.level, "none");
  assert.equal(state.comparison.baselinePeriods, null,
    "no baseline is attempted while the ratio is withheld");
});

test("a gap between spend periods is a mismatched period, not a short one", () => {
  // April and June with May missing: also a case where the ladder's order shows.
  const state = decide([APRIL, JUNE], [...threeInApril, ...threeInJune]);
  assert.equal(state.state, SPEND_PER_DELIVERY_STATE.mismatched);
  assert.equal(state.reasonCode, "non_contiguous_spend_periods");
});

test("overlapping spend periods are refused before anything is divided", () => {
  const state = decide([month("2026-05-01", "2026-06-15", 30_000), JUNE],
    [...threeInMay, ...threeInJune]);
  assert.equal(state.state, SPEND_PER_DELIVERY_STATE.mismatched);
  assert.equal(state.reasonCode, "overlapping_spend_periods");
});

test("releases from another window are a mismatched period, and the drift is counted", () => {
  const state = decide([MAY, JUNE], [
    shipped("2026-01-09", 3), shipped("2026-01-19", 3), shipped("2026-01-29", 3),
  ]);
  assert.equal(state.state, SPEND_PER_DELIVERY_STATE.mismatched);
  assert.equal(state.reasonCode, "no_delivery_in_spend_window");
  assert.ok(state.evidence.some((line) => line.includes("outside 2026-05-01 to 2026-07-01")));
});

test("a period shorter than the floor is insufficient, and the mismatch outranks it", () => {
  const short = month("2026-06-01", "2026-06-08", 60_000);
  assert.ok(MINIMUM_PERIOD_DAYS > 7);
  const shortOnly = decide([short], threeInJune);
  assert.equal(shortOnly.reasonCode, "short_spend_period");
  // The same short period after a gap reports the gap: re-exporting a longer
  // window would not fix an unalignable one.
  const gapped = decide([APRIL, short], [...threeInApril, ...threeInJune]);
  assert.equal(gapped.reasonCode, "non_contiguous_spend_periods");
});

test("fewer deliveries than the floor is insufficient and names the count it found", () => {
  const state = decide([JUNE], threeInJune.slice(0, MINIMUM_DELIVERIES - 1));
  assert.equal(state.state, SPEND_PER_DELIVERY_STATE.insufficient);
  assert.equal(state.reasonCode, "too_few_deliveries_in_period");
  assert.ok(state.evidence.some((line) => line.includes(`${MINIMUM_DELIVERIES - 1} fall inside`)));
  // Exactly the floor is enough: the boundary is inclusive.
  assert.equal(decide([JUNE], threeInJune).state, SPEND_PER_DELIVERY_STATE.eligible);
});

test("an unreadable completion date is excluded and reported, not silently dropped", () => {
  const state = decide([JUNE], [...threeInJune, { id: "broken", completedAt: "not-a-date" }]);
  assert.equal(state.metric.deliveries, 3);
  assert.ok(state.evidence.some((line) => line.includes("unreadable completion date")));
});

/* -------------------------------- confidence --------------------------------- */

test("confidence falls to low when a required provenance field never backed the figure", () => {
  const state = decide([APRIL, MAY, JUNE], [...threeInApril, ...threeInMay, ...threeInJune],
    { derivedFromFields: REQUIRED_PROVENANCE_FIELDS.slice(0, -1) });
  assert.equal(state.confidence.level, "low");
  assert.deepEqual(state.provenance.missingFields, [REQUIRED_PROVENANCE_FIELDS.at(-1)]);
  assert.ok(state.confidence.basis.includes(REQUIRED_PROVENANCE_FIELDS.at(-1)));
});

test("a partial billing period and a missing baseline both cap confidence at medium", () => {
  const partial = decide([APRIL, MAY, month("2026-06-01", "2026-07-01", 60_000, { completeness: "partial" })],
    [...threeInApril, ...threeInMay, ...threeInJune]);
  assert.equal(partial.confidence.level, "medium");
  assert.ok(partial.confidence.basis.includes("partial"));
  const noBaseline = decide([JUNE], threeInJune);
  assert.equal(noBaseline.confidence.level, "medium");
  const complete = decide([APRIL, MAY, JUNE],
    [...threeInApril, ...threeInMay, ...threeInJune]);
  assert.equal(complete.confidence.level, "high");
});

/* --------------------------------- the framing -------------------------------- */

test("no published string frames the ratio as return, productivity, or cause", () => {
  const strings = [];
  const walk = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const name of Object.keys(SPEND_PER_DELIVERY_FIXTURES)) walk(spendPerDeliveryFixture(name));
  // Two exclusions, and they are the whole point rather than a loophole: the
  // forbidden vocabulary itself travels on FRAMING so it cannot be dropped from
  // the contract quietly, and FRAMING.statement is the one sentence allowed to say
  // these words — it says the figure is not them.
  assert.match(FRAMING.statement, /not a return on investment/);
  assert.match(FRAMING.statement, /not a productivity measure/);
  const scanned = strings.filter((value) => value !== FRAMING.statement
    && !FRAMING.forbiddenClaims.includes(value));
  assert.ok(scanned.length > 20, "the states publish prose to scan");
  for (const claim of FRAMING.forbiddenClaims) {
    const pattern = new RegExp(`\\b${claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const offender = scanned.find((value) => pattern.test(value));
    assert.equal(offender, undefined, `"${claim}" appeared in: ${offender}`);
  }
});

test("every published state carries the framing and all six confounders", () => {
  for (const name of Object.keys(SPEND_PER_DELIVERY_FIXTURES)) {
    const state = spendPerDeliveryFixture(name);
    assert.equal(state.framing.kind, "observational ratio");
    assert.ok(state.framing.statement.length > 0);
    assert.deepEqual(state.confounders, CONFOUNDERS);
    assert.equal(state.confounders.length, 6);
    assert.equal(state.nextAction.rank, 1);
    assert.ok(state.nextAction.owner.length > 0);
    assert.ok(state.statement.length > 0);
  }
});

/* ------------------------------- local adapters ------------------------------- */

test("spend periods come from the analysis envelope's own period strings", () => {
  const periods = spendPeriodsFromAnalysis({
    period: "2026-06-01 to 2026-07-01",
    spendUsd: 60_000,
    history: {
      periods: [
        { period: "2026-05-01 to 2026-06-01", spendUsd: 30_000, completeness: "complete" },
        { period: "2026-06-01 to 2026-07-01", spendUsd: 60_000, completeness: "complete" },
      ],
    },
  });
  assert.deepEqual(periods.map((entry) => [entry.periodStart, entry.periodEnd, entry.spendUsd]), [
    ["2026-05-01", "2026-06-01", 30_000],
    ["2026-06-01", "2026-07-01", 60_000],
  ]);
  // A single-period analysis still yields its one window.
  assert.equal(spendPeriodsFromAnalysis({ period: "2026-06-01 to 2026-07-01", spendUsd: 1 }).length, 1);
  // An unparseable window yields no period rather than a wrong one.
  assert.deepEqual(spendPeriodsFromAnalysis({ period: "June", spendUsd: 1 }), []);
  assert.deepEqual(spendPeriodsFromAnalysis(null), []);
});

test("only releases declared completed are delivery evidence", () => {
  const { deliveries, statusDeclared } = deliveriesFromReleases([
    { id: "a", version: "1.0.0", createdAt: "2026-06-02T00:00:00.000Z", status: "completed" },
    { id: "b", version: "1.1.0", createdAt: "2026-06-03T00:00:00.000Z", status: "planned" },
    { id: "c", version: "1.2.0", createdAt: "2026-06-04T00:00:00.000Z", status: "cancelled" },
  ]);
  assert.deepEqual(deliveries.map((entry) => entry.id), ["a"]);
  assert.equal(statusDeclared, true);
});

test("a release with no declared status is not counted and lowers confidence", () => {
  const undeclared = [
    { id: "a", version: "1.0.0", createdAt: "2026-06-02T00:00:00.000Z" },
    { id: "b", version: "1.1.0", createdAt: "2026-06-12T00:00:00.000Z" },
    { id: "c", version: "1.2.0", createdAt: "2026-06-22T00:00:00.000Z" },
  ];
  const { deliveries, statusDeclared } = deliveriesFromReleases(undeclared);
  assert.deepEqual(deliveries, [], "the list's completed default is not a record that it shipped");
  assert.equal(statusDeclared, false);
  const state = spendPerDeliveryDecision(spendPerDeliveryInput({
    analysis: { period: "2026-06-01 to 2026-07-01", spendUsd: 60_000 },
    releases: undeclared,
  }));
  assert.equal(state.reasonCode, "no_delivery_evidence");
  assert.ok(state.provenance.missingFields.includes("local.shiplog.release.status"));
});

test("the adapter declares only the fields it actually found", () => {
  const input = spendPerDeliveryInput({ analysis: null, releases: [] });
  assert.deepEqual(input.spendPeriods, []);
  assert.deepEqual(input.provenance.derivedFromFields, []);
  const state = spendPerDeliveryDecision(input);
  assert.equal(state.reasonCode, "no_local_spend");
  assert.equal(state.provenance.complete, false);
});

test("the bundled example release log is synthetic and sits in three consecutive months", () => {
  assert.ok(EXAMPLE_DELIVERY_RELEASES.every((release) => release.status === "completed"
    && release.id.startsWith("syn-release-")));
  const months = new Set(EXAMPLE_DELIVERY_RELEASES.map((release) => release.createdAt.slice(0, 7)));
  assert.deepEqual([...months].sort(), ["2026-04", "2026-05", "2026-06"]);
});

/* ------------------------------- malformed input ------------------------------ */

test("a malformed input is a defect and throws; unusable data never does", () => {
  assert.throws(() => spendPerDeliveryDecision(null), SpendPerDeliveryError);
  assert.throws(() => spendPerDeliveryDecision({ spendPeriods: {}, deliveries: [] }),
    /spendPeriods: must be an array/);
  assert.throws(() => spendPerDeliveryDecision({
    spendPeriods: [{ periodStart: "2026-06-01", periodEnd: "2026-06-01", spendUsd: 1 }],
    deliveries: [],
  }), /must be a whole number of days after periodStart/);
  assert.throws(() => spendPerDeliveryDecision({
    spendPeriods: [{ periodStart: "06/01/2026", periodEnd: "2026-07-01", spendUsd: 1 }],
    deliveries: [],
  }), /must be YYYY-MM-DD/);
  // Every fixture, by contrast, is data and returns a state.
  for (const name of Object.keys(SPEND_PER_DELIVERY_FIXTURES)) {
    assert.ok(spendPerDeliveryFixture(name).state);
  }
});

test("the fixtures cover exactly the three publishable states", () => {
  assert.deepEqual(
    Object.keys(SPEND_PER_DELIVERY_FIXTURES).map((name) => spendPerDeliveryFixture(name).state),
    [SPEND_PER_DELIVERY_STATE.eligible, SPEND_PER_DELIVERY_STATE.insufficient,
      SPEND_PER_DELIVERY_STATE.mismatched]);
  const eligible = spendPerDeliveryFixture("eligible");
  assert.equal(eligible.comparison.direction, "higher");
  assert.equal(eligible.confidence.level, "high");
  assert.equal(spendPerDeliveryFixture("insufficient").reasonCode, "no_delivery_evidence");
  assert.equal(spendPerDeliveryFixture("mismatched").reasonCode, "no_delivery_in_spend_window");
});
