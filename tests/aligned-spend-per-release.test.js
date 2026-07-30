// The period-aligned spend-per-release derivation: window selection, the pair
// arithmetic, the state ladder, the independent exclusion counts, and the framing
// that keeps the figure an observation.
//
// Fixtures are built here rather than committed, and every one of them is a plain
// value: no clock, no randomness, no file. Two calls with the same fixture must
// produce byte-identical records, and a test asserts that directly.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  ALIGNED_INSUFFICIENT_REASONS, ALIGNED_MISMATCH_REASONS,
  ALIGNED_SPEND_PER_RELEASE_CAVEATS, ALIGNED_SPEND_PER_RELEASE_RULES,
  ALIGNED_SPEND_PER_RELEASE_SCHEMA_VERSION, ALIGNED_SPEND_PER_RELEASE_STATE,
  ALIGNED_TREND_UNAVAILABLE_REASONS, AlignedSpendPerReleaseError,
  MINIMUM_RELEASES_IN_WINDOW, MINIMUM_WINDOW_DAYS, alignedSpendPerRelease,
} from "../src/aligned-spend-per-release.js";
import {
  CONFOUNDERS, FRAMING, MAXIMUM_SPEND_USD, REQUIRED_PROVENANCE_FIELDS, spendPerDeliveryInput,
} from "../src/spend-per-delivery.js";
import { assertObservational } from "../src/delivery-efficiency-finding.js";

/* --------------------------------- fixtures ---------------------------------- */

/**
 * Two abutting 28-day windows. Calendar months are deliberately not used for the
 * comparable pair: May is 31 days and June is 30, so a month pair is exactly the
 * mismatch this contract refuses, and it has its own fixture below.
 */
const PRIOR_WINDOW = Object.freeze({ start: "2026-05-04", end: "2026-06-01" });
const CURRENT_WINDOW = Object.freeze({ start: "2026-06-01", end: "2026-06-29" });

const window = (start, end, spendUsd, extra = {}) => ({
  periodStart: start, periodEnd: end, spendUsd, completeness: "complete", ...extra,
});

const prior = (spendUsd, extra) =>
  window(PRIOR_WINDOW.start, PRIOR_WINDOW.end, spendUsd, extra);
const current = (spendUsd, extra) =>
  window(CURRENT_WINDOW.start, CURRENT_WINDOW.end, spendUsd, extra);

const shipped = (day, index = 0) =>
  ({ id: `r-${day}-${index}`, completedAt: `${day}T12:00:00.000Z`, label: `v${index}` });

/** `count` releases inside a window, spaced by two days from its second day. */
function releasesIn(start, count, index = 0) {
  const base = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (unused, offset) => {
    const day = new Date(base + (offset * 2 + 1) * 86_400_000)
      .toISOString().slice(0, 10);
    return shipped(day, index + offset);
  });
}

const FOUR_IN_PRIOR = releasesIn(PRIOR_WINDOW.start, 4, 10);
const FIVE_IN_PRIOR = releasesIn(PRIOR_WINDOW.start, 5, 20);
const FOUR_IN_CURRENT = releasesIn(CURRENT_WINDOW.start, 4, 30);
const FIVE_IN_CURRENT = releasesIn(CURRENT_WINDOW.start, 5, 40);

const derive = (spendPeriods, deliveries, provenance = {}) => alignedSpendPerRelease({
  spendPeriods,
  deliveries,
  provenance: {
    origin: "import",
    source: "test input",
    derivedFromFields: REQUIRED_PROVENANCE_FIELDS,
    ...provenance,
  },
});

/**
 * The five named fixtures the issue calls for. Each is the whole input, so a test
 * that disputes a figure can recompute it from the fixture alone.
 */
const FIXTURES = Object.freeze({
  // 30,000 / 5 = 6,000 prior; 48,000 / 4 = 12,000 current. +100%.
  increase: Object.freeze({
    spendPeriods: [prior(30_000), current(48_000)],
    deliveries: [...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT],
  }),
  // The same pair, the other way round: 12,000 prior, 6,000 current. -50%.
  improvement: Object.freeze({
    spendPeriods: [prior(48_000), current(30_000)],
    deliveries: [...FOUR_IN_PRIOR, ...FIVE_IN_CURRENT],
  }),
  // Spend on both sides, releases only in the prior window.
  zeroCurrentReleases: Object.freeze({
    spendPeriods: [prior(30_000), current(48_000)],
    deliveries: [...FOUR_IN_PRIOR],
  }),
  missingSpend: Object.freeze({
    spendPeriods: [prior(30_000), current(null)],
    deliveries: [...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT],
  }),
  // A 30-day window followed by a 14-day one. Abutting, neither a calendar month,
  // and not comparable: the movement would be the window length.
  mismatchedWindows: Object.freeze({
    spendPeriods: [
      window("2026-05-04", "2026-06-03", 30_000),
      window("2026-06-03", "2026-06-17", 48_000),
    ],
    deliveries: [
      ...releasesIn("2026-05-04", 4, 50), ...releasesIn("2026-06-03", 4, 60),
    ],
  }),
});

const fixture = (name, provenance) =>
  derive(FIXTURES[name].spendPeriods, FIXTURES[name].deliveries, provenance);

/* ------------------------------ the pair arithmetic --------------------------- */

test("an aligned pair publishes both windows' figures and the movement between them", () => {
  const state = fixture("increase");
  assert.equal(state.schemaVersion, ALIGNED_SPEND_PER_RELEASE_SCHEMA_VERSION);
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.eligible);
  assert.equal(state.reasonCode, null);
  assert.deepEqual(state.metric.current, {
    window: { start: "2026-06-01", end: "2026-06-29", days: 28 },
    periodSpendUsd: 48_000,
    shippedReleases: 4,
    completeness: "complete",
    spendPerReleaseUsd: 12_000,
  });
  assert.deepEqual(state.metric.prior, {
    window: { start: "2026-05-04", end: "2026-06-01", days: 28 },
    periodSpendUsd: 30_000,
    shippedReleases: 5,
    completeness: "complete",
    spendPerReleaseUsd: 6_000,
  });
  assert.equal(state.trend.available, true);
  assert.equal(state.trend.deltaUsd, 6_000);
  assert.equal(state.trend.deltaPercent, 100);
  assert.equal(state.trend.direction, "higher");
  assert.deepEqual(state.comparedWindows, [
    { start: "2026-05-04", end: "2026-06-01", days: 28 },
    { start: "2026-06-01", end: "2026-06-29", days: 28 },
  ]);
});

test("a fall is reported with the same arithmetic and the opposite direction", () => {
  const state = fixture("improvement");
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.eligible);
  assert.equal(state.metric.prior.spendPerReleaseUsd, 12_000);
  assert.equal(state.metric.current.spendPerReleaseUsd, 6_000);
  assert.equal(state.trend.deltaUsd, -6_000);
  assert.equal(state.trend.deltaPercent, -50);
  assert.equal(state.trend.direction, "lower");
  // Neither direction is labelled good or bad anywhere in the record.
  assert.doesNotMatch(JSON.stringify(state), /better|worse|improv|good news/i);
});

test("a rise and a fall of the same magnitude round to the same percentage", () => {
  const up = derive([prior(30_000), current(33_000)], [...FIVE_IN_PRIOR, ...FIVE_IN_CURRENT]);
  const down = derive([prior(33_000), current(30_000)], [...FIVE_IN_PRIOR, ...FIVE_IN_CURRENT]);
  assert.equal(up.trend.deltaPercent, 10);
  assert.equal(down.trend.deltaPercent, -9.1);
  const symmetric = derive([prior(30_000), current(25_500)],
    [...FIVE_IN_PRIOR, ...FIVE_IN_CURRENT]);
  assert.equal(symmetric.trend.deltaPercent, -15);
  assert.equal(symmetric.trend.direction, "lower");
});

test("an identical pair is level, and level is published rather than omitted", () => {
  const state = derive([prior(30_000), current(30_000)],
    [...FIVE_IN_PRIOR, ...FIVE_IN_CURRENT]);
  assert.equal(state.trend.available, true);
  assert.equal(state.trend.deltaUsd, 0);
  assert.equal(state.trend.deltaPercent, 0);
  assert.equal(state.trend.direction, "level");
});

test("the window end is exclusive, so a boundary release counts once, in the later window", () => {
  const boundary = { id: "boundary", completedAt: "2026-06-01T00:00:00.000Z" };
  const state = derive([prior(30_000), current(48_000)], [
    ...FIVE_IN_PRIOR, boundary, ...releasesIn(CURRENT_WINDOW.start, 3, 70),
  ]);
  assert.equal(state.metric.prior.shippedReleases, 5);
  assert.equal(state.metric.current.shippedReleases, 4);
  assert.equal(state.exclusions.releasesOutsideComparedWindows, 0);
});

/* -------------------------------- window selection --------------------------- */

test("the pair is the two most recent windows, and no older window is searched for", () => {
  const older = window("2026-04-06", "2026-05-04", 6_000);
  const state = derive([older, prior(30_000), current(48_000)],
    [...releasesIn("2026-04-06", 4, 80), ...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT]);
  assert.deepEqual(state.comparedWindows.map((entry) => entry.start),
    ["2026-05-04", "2026-06-01"]);
  // The oldest window would have made the movement look far larger. It is not
  // considered, and its releases are counted as outside the compared pair.
  assert.equal(state.exclusions.windowsNotCompared, 1);
  assert.equal(state.exclusions.releasesOutsideComparedWindows, 4);
  assert.equal(state.trend.deltaPercent, 100);
});

test("windows are sorted before selection, so input order cannot change the pair", () => {
  const forward = derive([prior(30_000), current(48_000)],
    [...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT]);
  const reversed = derive([current(48_000), prior(30_000)],
    [...FOUR_IN_CURRENT, ...FIVE_IN_PRIOR]);
  assert.deepEqual(JSON.parse(JSON.stringify(reversed)), JSON.parse(JSON.stringify(forward)));
});

/* ------------------------------ the state ladder ------------------------------ */

test("nothing read at all is absent, not an insufficiency about no data", () => {
  const state = derive([], [], { derivedFromFields: [] });
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.absent);
  assert.equal(state.reasonCode, "nothing_read");
  assert.equal(state.metric.current.window, null);
  assert.equal(state.metric.current.spendPerReleaseUsd, null);
});

test("releases with no billing window is an insufficiency and names the missing side", () => {
  const state = derive([], FOUR_IN_CURRENT);
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.insufficient);
  assert.equal(state.reasonCode, "no_spend_period");
  assert.equal(state.nextAction.owner, "FinOps lead");
});

test("a missing spend total withholds the figure and is reported ahead of alignment", () => {
  const state = fixture("missingSpend");
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.insufficient);
  assert.equal(state.reasonCode, "missing_current_period_spend");
  // The counts are still facts and are still published; only the ratio is withheld.
  assert.equal(state.metric.current.periodSpendUsd, null);
  assert.equal(state.metric.current.shippedReleases, 4);
  assert.equal(state.metric.current.spendPerReleaseUsd, null);
  assert.equal(state.metric.prior.spendPerReleaseUsd, null, "no half-published pair");
  assert.equal(state.trend.available, false);
  assert.equal(state.trend.reasonCode, "no_published_figure");
  assert.equal(state.confidence.level, "none");
});

test("a missing spend total on the prior side keeps the figure and withholds the movement", () => {
  const state = derive([prior(null), current(48_000)], [...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT]);
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.eligible);
  assert.equal(state.metric.current.spendPerReleaseUsd, 12_000);
  assert.equal(state.trend.available, false);
  assert.equal(state.trend.reasonCode, "missing_prior_period_spend");
  assert.equal(state.confidence.level, "medium");
});

test("a spend total above the display ceiling is withheld rather than published", () => {
  const state = derive([prior(30_000), current(MAXIMUM_SPEND_USD + 1)],
    [...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT]);
  assert.equal(state.reasonCode, "implausible_current_period_spend");
  assert.equal(state.metric.current.spendPerReleaseUsd, null);
});

test("a window shorter than the floor is withheld, and the floor is stated", () => {
  const short = [
    window("2026-06-01", "2026-06-08", 10_000), window("2026-06-08", "2026-06-15", 12_000),
  ];
  const state = derive(short, releasesIn("2026-06-08", 3, 90));
  assert.equal(state.reasonCode, "short_reporting_window");
  assert.ok(state.statement.includes(String(MINIMUM_WINDOW_DAYS)));
  assert.ok(MINIMUM_WINDOW_DAYS > 7);
});

test("one or two releases in the window is a different reason from none", () => {
  const state = derive([prior(30_000), current(48_000)],
    [...FIVE_IN_PRIOR, ...releasesIn(CURRENT_WINDOW.start, 2, 100)]);
  assert.equal(state.reasonCode, "too_few_releases_in_current_period");
  assert.ok(state.statement.includes(String(MINIMUM_RELEASES_IN_WINDOW)));
  assert.equal(state.metric.current.shippedReleases, 2);
  assert.notEqual(state.reasonCode, "no_releases_in_current_period");
});

test("every declared reason code is reachable and no state publishes an undeclared one", () => {
  const reasons = new Set([
    fixture("increase").reasonCode,
    fixture("improvement").reasonCode,
    fixture("zeroCurrentReleases").reasonCode,
    fixture("missingSpend").reasonCode,
    fixture("mismatchedWindows").reasonCode,
  ]);
  for (const code of reasons) {
    if (code === null) continue;
    assert.ok(
      ALIGNED_INSUFFICIENT_REASONS.includes(code) || ALIGNED_MISMATCH_REASONS.includes(code),
      code);
  }
});

/* ----------------------------- mismatched windows ---------------------------- */

test("two windows of different lengths are not comparable", () => {
  const state = fixture("mismatchedWindows");
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.mismatched);
  assert.equal(state.reasonCode, "unequal_reporting_window_lengths");
  // No figure on either side: the pair is what this contract publishes.
  assert.equal(state.metric.current.spendPerReleaseUsd, null);
  assert.equal(state.metric.prior.window, null, "a rejected candidate is not the prior window");
  assert.equal(state.trend.available, false);
  assert.equal(state.exclusions.priorWindowRejectedReason, "unequal_reporting_window_lengths");
  assert.equal(state.alignment.basis, null);
  assert.deepEqual(state.comparedWindows.map((entry) => entry.days), [14]);
  // And the rejected candidate is still named in the evidence, so a reader can see
  // which window was considered.
  assert.ok(state.evidence.some((line) => line.includes("2026-05-04")), state.evidence.join(" "));
});

// Provider billing arrives by calendar month, so a 31-day May beside a 30-day
// June is the only pair most readers will ever have. Refusing it would make this
// derivation unusable on real exports, so it is accepted on a named basis and the
// day of difference is published rather than hidden or ignored.
test("two adjacent calendar months are comparable, and the day of difference is disclosed", () => {
  const may = window("2026-05-01", "2026-06-01", 30_000);
  const june = window("2026-06-01", "2026-07-01", 48_000);
  const state = derive([may, june],
    [...releasesIn("2026-05-01", 5, 120), ...releasesIn("2026-06-01", 4, 130)]);
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.eligible);
  assert.equal(state.alignment.basis, "calendar_month");
  assert.equal(state.alignment.lengthDifferenceDays, 1);
  assert.match(state.alignment.note, /31 and 30 days/);
  assert.equal(state.trend.available, true);
  assert.equal(state.trend.deltaPercent, 100);
  assert.doesNotMatch(state.confidence.basis, /same number of days/);
  assert.match(state.confidence.basis, /calendar months/);
  // The difference the basis leaves behind is a caveat, published only when there
  // is one to publish.
  assert.equal(state.caveats.length, ALIGNED_SPEND_PER_RELEASE_CAVEATS.length + 1);
  assert.equal(state.caveats.at(-1), state.alignment.note);
  assert.equal(fixture("increase").alignment.basis, "equal_length");
  assert.equal(fixture("increase").caveats.length, ALIGNED_SPEND_PER_RELEASE_CAVEATS.length);
});

test("a calendar month is not comparable to a partial window of another length", () => {
  const state = derive([
    window("2026-05-01", "2026-06-01", 30_000), window("2026-06-01", "2026-06-15", 48_000),
  ], [...releasesIn("2026-05-01", 4, 140), ...releasesIn("2026-06-01", 4, 150)]);
  assert.equal(state.reasonCode, "unequal_reporting_window_lengths");
});

test("two windows a month apart on the same days of the month are not one calendar month", () => {
  // Both ends land on the first, and the span is two months, so neither window is
  // a whole month and the lengths differ.
  const state = derive([
    window("2026-03-01", "2026-05-01", 30_000), window("2026-05-01", "2026-06-01", 48_000),
  ], [...releasesIn("2026-03-01", 4, 160), ...releasesIn("2026-05-01", 4, 170)]);
  assert.equal(state.reasonCode, "unequal_reporting_window_lengths");
});

test("a gap between the two windows is a mismatch, not a shorter pair", () => {
  const state = derive([
    window("2026-05-04", "2026-06-01", 30_000), window("2026-06-08", "2026-07-06", 48_000),
  ], [...FIVE_IN_PRIOR, ...releasesIn("2026-06-08", 4, 110)]);
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.mismatched);
  assert.equal(state.reasonCode, "non_contiguous_reporting_windows");
});

test("overlapping windows are a mismatch, so no day of spend is counted twice", () => {
  const state = derive([
    window("2026-05-04", "2026-06-08", 30_000), window("2026-06-01", "2026-07-06", 48_000),
  ], [...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT]);
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.mismatched);
  assert.equal(state.reasonCode, "overlapping_reporting_windows");
});

test("a single window is eligible with no movement, not a mismatch", () => {
  const state = derive([current(48_000)], FOUR_IN_CURRENT);
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.eligible);
  assert.equal(state.metric.current.spendPerReleaseUsd, 12_000);
  assert.equal(state.trend.available, false);
  assert.equal(state.trend.reasonCode, "no_prior_period");
  assert.equal(state.exclusions.priorWindowRejectedReason, null);
  assert.equal(state.confidence.level, "medium");
});

/* --------------------- zero current-period releases, and the fix -------------- */

test("zero releases in the current window is its own insufficiency with an action", () => {
  const state = fixture("zeroCurrentReleases");
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.insufficient);
  assert.equal(state.reasonCode, "no_releases_in_current_period");
  assert.equal(state.metric.current.shippedReleases, 0);
  assert.equal(state.metric.current.periodSpendUsd, 48_000, "the spend is still a fact");
  assert.equal(state.metric.current.spendPerReleaseUsd, null, "and never 0");
  assert.equal(state.trend.available, false);
  assert.equal(state.nextAction.href, "/release.html");
  assert.equal(state.nextAction.owner, "Engineering lead");
});

// THE REGRESSION. The prior rejection of this work counted the prior window's
// releases as "outside the compared windows" whenever the movement was
// unavailable, which is exactly the zero-current-release case: it told a reader
// that the four releases they had recorded were outside a window that contains
// them. The count is now computed from the selected pair alone.
test("prior-window releases are inside the compared windows when the current window is empty", () => {
  const state = fixture("zeroCurrentReleases");
  assert.equal(state.trend.available, false, "the precondition of the old defect");
  assert.equal(state.exclusions.releasesInsideComparedWindows, 4);
  assert.equal(state.exclusions.releasesOutsideComparedWindows, 0);
  assert.equal(state.comparedWindows.length, 2,
    "both windows are still the compared pair: the pair selection does not depend on the trend");
  assert.equal(state.metric.prior.shippedReleases, 4);
});

test("the exclusion count is the parsed releases outside the selected pair, in every state", () => {
  const outside = [shipped("2026-03-02", 200), shipped("2026-08-02", 201)];
  const cases = [
    ["eligible", [prior(30_000), current(48_000)], [...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT]],
    ["zero current", [prior(30_000), current(48_000)], [...FOUR_IN_PRIOR]],
    ["missing spend", [prior(30_000), current(null)], [...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT]],
    ["single window", [current(48_000)], [...FOUR_IN_CURRENT]],
  ];
  for (const [name, windows, deliveries] of cases) {
    const state = derive(windows, [...deliveries, ...outside]);
    const inside = deliveries.filter((entry) =>
      state.comparedWindows.some((pair) =>
        entry.completedAt.slice(0, 10) >= pair.start && entry.completedAt.slice(0, 10) < pair.end,
      )).length;
    assert.equal(state.exclusions.releasesInsideComparedWindows, inside, name);
    assert.equal(state.exclusions.releasesOutsideComparedWindows,
      deliveries.length + outside.length - inside, name);
  }
});

test("a release in a window that was read but not compared counts as outside the pair", () => {
  const older = window("2026-04-06", "2026-05-04", 6_000);
  const state = derive([older, prior(30_000), current(48_000)],
    [...releasesIn("2026-04-06", 3, 210), ...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT]);
  assert.equal(state.exclusions.releasesOutsideComparedWindows, 3);
  assert.equal(state.exclusions.windowsNotCompared, 1);
});

test("an unreadable completion date is excluded and counted, never silently dropped", () => {
  const state = derive([prior(30_000), current(48_000)], [
    ...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT,
    { id: "broken", completedAt: "last tuesday" }, { id: "empty" },
  ]);
  assert.equal(state.exclusions.unreadableReleaseDates, 2);
  assert.equal(state.exclusions.releasesOutsideComparedWindows, 0,
    "an undateable release is not reported as outside a window it was never checked against");
  assert.equal(state.metric.current.shippedReleases, 4);
  assert.ok(state.evidence.some((line) => line.includes("unreadable completion date")));
});

/* --------------------------- provenance and confidence ----------------------- */

test("confidence is high only for a complete, aligned, compared pair", () => {
  assert.equal(fixture("increase").confidence.level, "high");
});

test("a missing required provenance field lowers confidence and is named", () => {
  const state = fixture("increase", {
    derivedFromFields: REQUIRED_PROVENANCE_FIELDS.filter((field) =>
      field !== "local.shiplog.release.status"),
  });
  assert.equal(state.confidence.level, "low");
  assert.deepEqual(state.provenance.missingFields, ["local.shiplog.release.status"]);
  assert.equal(state.provenance.complete, false);
  assert.ok(state.confidence.basis.includes("local.shiplog.release.status"));
});

test("a window declaring partial completeness caps confidence at medium", () => {
  const state = derive([prior(30_000), current(48_000, { completeness: "partial" })],
    [...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT]);
  assert.equal(state.confidence.level, "medium");
  assert.ok(state.confidence.basis.includes("partial"));
});

test("a withheld figure has no confidence to report", () => {
  for (const name of ["zeroCurrentReleases", "missingSpend", "mismatchedWindows"]) {
    assert.equal(fixture(name).confidence.level, "none", name);
  }
});

test("provenance names its origin and states that nothing is retained", () => {
  const example = fixture("increase", { origin: "example", source: "bundled example" });
  assert.equal(example.provenance.origin, "example");
  assert.equal(example.provenance.source, "bundled example");
  assert.match(example.provenance.retention, /not persisted|Nothing read here is persisted/);
  assert.deepEqual(example.provenance.requiredFields, REQUIRED_PROVENANCE_FIELDS);
});

test("no imported record, label, or export id is carried into the record", () => {
  const state = derive([prior(30_000, { exportId: "export-secret" }), current(48_000)],
    [...FIVE_IN_PRIOR, ...FOUR_IN_CURRENT]);
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /export-secret/);
  assert.doesNotMatch(serialized, /"r-2026-/, "no release id is copied out");
  assert.doesNotMatch(serialized, /v10|v40/, "no release label is copied out");
});

/* ------------------------------- framing and limits -------------------------- */

test("every published record carries the framing, the caveats, and the confounders", () => {
  for (const name of Object.keys(FIXTURES)) {
    const state = fixture(name);
    assert.equal(state.framing, FRAMING, name);
    assert.deepEqual(state.caveats, ALIGNED_SPEND_PER_RELEASE_CAVEATS, name);
    assert.deepEqual(state.confounders, CONFOUNDERS, name);
    assert.ok(state.caveats.length >= 3, name);
  }
});

test("no state publishes a forbidden claim or a causal verb", () => {
  for (const name of Object.keys(FIXTURES)) {
    const offender = assertObservational(fixture(name));
    assert.equal(offender, null, `${name}: ${JSON.stringify(offender)}`);
  }
  // And the module's own rule text is scanned too, not only the records.
  assert.equal(assertObservational(ALIGNED_SPEND_PER_RELEASE_RULES), null);
});

test("the record and every branch of it is frozen", () => {
  const state = fixture("increase");
  for (const node of [state, state.metric, state.metric.current, state.trend, state.alignment,
    state.exclusions, state.provenance, state.confidence, state.nextAction]) {
    assert.equal(Object.isFrozen(node), true);
  }
  assert.throws(() => { state.trend.deltaPercent = 0; }, TypeError);
});

test("the same input always produces the same record, with no timestamp in it", () => {
  const first = JSON.stringify(fixture("increase"));
  const second = JSON.stringify(fixture("increase"));
  assert.equal(first, second);
  assert.doesNotMatch(first, /generatedAt|"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
});

/* ------------------------------- bounded inputs ------------------------------ */

test("a malformed shape throws with the path, and unusable data never throws", () => {
  assert.throws(() => alignedSpendPerRelease(null), AlignedSpendPerReleaseError);
  assert.throws(() => alignedSpendPerRelease({ spendPeriods: {}, deliveries: [] }),
    /spendPeriods: must be an array/);
  assert.throws(() => derive([{ periodStart: "2026-6-1", periodEnd: "2026-07-01", spendUsd: 1 }], []),
    /spendPeriods\[0\].periodStart: must be YYYY-MM-DD/);
  assert.throws(() => derive([window("2026-06-01", "2026-06-01", 1)], []),
    /whole number of days/);
  assert.throws(() => derive([window("2026-06-01", "2026-07-01", "lots")], []),
    /spendUsd: must be a number or null/);
  assert.throws(() => derive([current(48_000)], ["not an object"]),
    /deliveries\[0\]: must be an object/);
  // Unusable data, by contrast, is a state.
  assert.equal(derive([current(0)], FOUR_IN_CURRENT).reasonCode,
    "missing_current_period_spend");
});

test("the derivation consumes the input the FinOps page already builds", () => {
  const input = spendPerDeliveryInput({
    analysis: {
      period: "2026-06-01 to 2026-06-29",
      spendUsd: 48_000,
      history: {
        periods: [
          { period: "2026-05-04 to 2026-06-01", spendUsd: 30_000, completeness: "complete" },
          { period: "2026-06-01 to 2026-06-29", spendUsd: 48_000, completeness: "complete" },
        ],
      },
    },
    releases: [
      ...FIVE_IN_PRIOR.map((entry) => ({ ...entry, createdAt: entry.completedAt, status: "completed" })),
      ...FOUR_IN_CURRENT.map((entry) => ({ ...entry, createdAt: entry.completedAt, status: "completed" })),
      { id: "planned", createdAt: "2026-06-10T12:00:00.000Z", status: "planned" },
    ],
  });
  const state = alignedSpendPerRelease(input);
  assert.equal(state.state, ALIGNED_SPEND_PER_RELEASE_STATE.eligible);
  assert.equal(state.metric.current.shippedReleases, 4, "a planned release is not shipped");
  assert.equal(state.trend.deltaPercent, 100);
  assert.equal(state.provenance.complete, true);
});

/* --------------------------- the contract, in two places --------------------- */

test("the prose contract names every state, reason, and floor the module publishes", async () => {
  const doc = await readFile(
    new URL("../docs/aligned-spend-per-release-contract.md", import.meta.url), "utf8");
  for (const code of [
    ...ALIGNED_INSUFFICIENT_REASONS, ...ALIGNED_MISMATCH_REASONS,
    ...ALIGNED_TREND_UNAVAILABLE_REASONS, ...Object.values(ALIGNED_SPEND_PER_RELEASE_STATE),
  ]) {
    assert.ok(doc.includes(code), `docs must document ${code}`);
  }
  assert.ok(doc.includes(ALIGNED_SPEND_PER_RELEASE_SCHEMA_VERSION));
  assert.ok(doc.includes(String(MINIMUM_WINDOW_DAYS)));
  assert.ok(doc.includes(String(MINIMUM_RELEASES_IN_WINDOW)));
  assert.ok(doc.includes("releasesOutsideComparedWindows"));
});
