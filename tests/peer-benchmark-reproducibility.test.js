// Are the peer benchmark's numbers reproducible?
//
// THE DISPUTE THIS SUITE IS WRITTEN FOR
// -------------------------------------
// A director reads "83rd percentile · second quartile of Organizations with
// 5–14 attributed org units" beside their team's name and asks where the number
// came from. The only acceptable answer is: from these inputs, under these
// stated rules, and here is a labelled case a second engineer can rerun.
//
// Every expectation below is a literal in `tests/support/peer-fixtures.js`,
// derived by hand from `docs/peer-cohort-contract.md`. That file also states the
// assumption behind each of the six choices that move a reader's number — the
// headline metric, the tie convention, round-before-compare, per-metric
// direction, the action rank order, and the member floors. A weight with no
// stated assumption is a weight nobody can argue with, which is worse than one
// that is wrong.
//
// WHAT IS NOT HERE. No live, customer, tenant or provider data, and no bundled
// seed figure: every input is invented in the fixture module and every cohort is
// the published synthetic reference data. Drift in the published cohort version,
// the scoring rules, or the action table is pinned separately, in
// `peer-benchmark-drift.test.js`.

import test from "node:test";
import assert from "node:assert/strict";
import {
  COHORT_FAMILY, COMPARABILITY, COMPARABILITY_LABEL, METRIC_DIRECTION, PEER_COHORTS,
  PEER_COHORT_PROVENANCE, PEER_CONFIDENCE, PEER_METRICS, PEER_UNAVAILABLE_REASON,
  evaluatePeerBenchmark, medianOf, peerConfidenceFor, percentileWithin,
} from "../src/peer-cohort-contract.js";
import {
  PEER_FINDING_UNAVAILABLE, PEER_STANDING,
  importedPeerBenchmark, importedPeerRollup, importedPeerSegment,
} from "../src/imported-peer-benchmark.js";
import { importedKpiFigures } from "../src/imported-executive-view.js";
import { PEER_FIXTURES, fixtureById, fixturesOfKind } from "./support/peer-fixtures.js";

const METRIC_BY_ID = Object.fromEntries(PEER_METRICS.map((metric) => [metric.id, metric]));
const cohortById = (cohortId) => PEER_COHORTS.find((entry) => entry.cohortId === cohortId);

const comparisonOf = (result, metricId) =>
  result.comparisons.find((entry) => entry.metricId === metricId);

/** Evaluate one fixture through the contract directly, from its declared roll-up. */
const evaluate = (row) =>
  evaluatePeerBenchmark({ organization: row.organization, segment: row.segment });

/** Evaluate the same fixture the way the page does: from an import's own files. */
const evaluateImport = (row) => importedPeerBenchmark({ grade: row.grade, analysis: row.analysis });

const AVAILABLE = fixturesOfKind("comparable", "boundary", "tie", "partial");
const REFUSED = fixturesOfKind("missing_segment", "non_comparable");

// ---------------------------------------------------------------------------
// The labelled cases reproduce, metric by metric.
// ---------------------------------------------------------------------------

for (const row of AVAILABLE) {
  test(`fixture "${row.id}" reproduces its documented placement`, () => {
    const result = evaluate(row);
    assert.equal(result.available, true, row.note);
    assert.equal(result.cohort.cohortId, row.expect.cohortId);
    assert.equal(result.comparability, row.expect.comparability);
    assert.equal(result.confidence, row.expect.confidence);

    for (const metric of PEER_METRICS) {
      const expected = row.expect.metrics[metric.id];
      const comparison = comparisonOf(result, metric.id);
      if (expected === null) {
        // An absent metric is named and refused, never filled in with a zero and
        // never given a placement inside the cohort.
        assert.equal(comparison.available, false, metric.id);
        assert.equal(comparison.value, null, metric.id);
        assert.equal(comparison.percentile, null, metric.id);
        assert.equal(comparison.quartile, null, metric.id);
        assert.equal(comparison.unavailable.reason,
          row.expect.unavailableMetrics[metric.id], metric.id);
        continue;
      }
      assert.equal(comparison.available, true, metric.id);
      assert.equal(comparison.value, expected.value, `${row.id}/${metric.id} value`);
      assert.equal(comparison.percentile, expected.percentile, `${row.id}/${metric.id} percentile`);
      assert.equal(comparison.quartile, expected.quartile, `${row.id}/${metric.id} quartile`);
      assert.equal(comparison.cohortMedian, expected.cohortMedian, `${row.id}/${metric.id} median`);
    }
  });

  test(`fixture "${row.id}" selects its documented prioritized action`, () => {
    const result = evaluate(row);
    assert.equal(result.action.available, true);
    assert.equal(result.action.id, row.expect.actionId, row.note);
    assert.equal(result.action.gap, row.expect.actionGap);
    // The action is reported against its own metric, and that metric is one the
    // comparison actually published. An action naming an unavailable metric is a
    // recommendation with no measurement under it.
    assert.equal(comparisonOf(result, result.action.metricId).available, true);
  });
}

for (const row of REFUSED) {
  test(`fixture "${row.id}" is refused under its documented reason code`, () => {
    const result = evaluate(row);
    assert.equal(result.available, false, row.note);
    assert.equal(result.unavailable.reason, row.expect.reason);
    assert.equal(result.action, null);
    assert.equal(result.headline, null);
    assert.equal(result.comparisons.length, 0);
  });
}

// ---------------------------------------------------------------------------
// Reproducible means: same inputs, same answer, every time and from either seam.
// ---------------------------------------------------------------------------

test("evaluating a fixture twice produces a deep-equal result", () => {
  for (const row of PEER_FIXTURES) {
    assert.deepEqual(evaluate(row), evaluate(row), row.id);
  }
});

test("evaluation order does not move any result", () => {
  const forwards = PEER_FIXTURES.map((row) => JSON.stringify(evaluate(row)));
  const backwards = [...PEER_FIXTURES].reverse().map((row) => JSON.stringify(evaluate(row))).reverse();
  assert.deepEqual(backwards, forwards);
});

test("no result carries anything a clock, a random source, or a session could have set", () => {
  for (const row of PEER_FIXTURES) {
    const serialized = JSON.stringify(evaluate(row));
    assert.equal(/\b20\d\d-\d\d-\d\dT/.test(serialized), false, `${row.id} carries a timestamp`);
    // The snapshot date is the one date a result may name, and it is the
    // published cohort's, not today's.
    const dates = serialized.match(/\b20\d\d-\d\d-\d\d\b/g) ?? [];
    for (const date of dates) {
      assert.equal(date, PEER_COHORT_PROVENANCE.snapshotDate, `${row.id} names ${date}`);
    }
  }
});

test("the import seam and the contract seam agree on every fixture's numbers", () => {
  for (const row of PEER_FIXTURES) {
    // The roll-up the fixture declares is exactly what the import derives, so
    // the two modules are held to one definition of the organization's numbers.
    assert.deepEqual(importedPeerRollup(row.grade, row.analysis), row.organization, row.id);
    assert.deepEqual(importedPeerSegment(row.analysis), row.segment, row.id);

    const contract = evaluate(row);
    const imported = evaluateImport(row);
    assert.equal(imported.available, contract.available, row.id);
    assert.equal(imported.unavailable?.reason ?? null, contract.unavailable?.reason ?? null, row.id);
    assert.deepEqual(imported.comparisons, contract.comparisons, row.id);
    assert.deepEqual(imported.action, contract.action, row.id);
    assert.deepEqual(imported.cohort, contract.cohort, row.id);
    assert.equal(imported.fromImport, true);
  }
});

// ---------------------------------------------------------------------------
// An agreement check against an independently written reference.
//
// The reference below was written from the prose in `docs/peer-cohort-contract.md`
// and deliberately takes a different rounding path (`toFixed`, not scale-and-
// round) and a different counting shape. Agreement across every fixture and
// every metric is a transcription check on the arithmetic; the DEFINITION is
// pinned by the hand-derived literals above, not by this function.
// ---------------------------------------------------------------------------

const referenceRound = (value, decimals) => Number(value.toFixed(decimals));

function referencePercentile(values, value, direction, decimals) {
  const target = referenceRound(value, decimals);
  let credit = 0;
  for (const raw of values) {
    const member = referenceRound(raw, decimals);
    if (member === target) credit += 0.5;
    else if (direction === METRIC_DIRECTION.higherIsBetter ? member < target : member > target) credit += 1;
  }
  return Math.min(100, Math.max(0, Math.round((credit / values.length) * 100)));
}

function referenceMedian(values, decimals) {
  const sorted = [...values].sort((left, right) => left - right);
  const upper = sorted[Math.floor(sorted.length / 2)];
  const lower = sorted[Math.ceil(sorted.length / 2 - 1)];
  return referenceRound((lower + upper) / 2, decimals);
}

test("an independently written reference reproduces every published percentile and median", () => {
  let checked = 0;
  for (const row of AVAILABLE) {
    const cohort = cohortById(row.expect.cohortId);
    for (const metric of PEER_METRICS) {
      const expected = row.expect.metrics[metric.id];
      if (expected === null) continue;
      const values = cohort.members.map((member) => member[metric.field]);
      assert.equal(
        referencePercentile(values, row.organization[metric.field], metric.direction, metric.decimals),
        expected.percentile, `${row.id}/${metric.id} percentile`);
      assert.equal(referenceMedian(values, metric.decimals), expected.cohortMedian,
        `${row.id}/${metric.id} median`);
      checked += 1;
    }
  }
  // A silently empty loop would pass this test while checking nothing, so the
  // count is compared against the fixtures' own declared placements.
  const declared = AVAILABLE.reduce((total, row) =>
    total + Object.values(row.expect.metrics).filter((entry) => entry !== null).length, 0);
  assert.equal(checked, declared, `only ${checked} of ${declared} placements were checked`);
});

test("the tie rule is mid-rank, so equalling the whole cohort reads exactly 50", () => {
  assert.equal(percentileWithin([5, 5, 5, 5], 5, METRIC_DIRECTION.higherIsBetter), 50);
  assert.equal(percentileWithin([5, 5, 5, 5], 5, METRIC_DIRECTION.lowerIsBetter), 50);
  // The two conventions this one was chosen over, for the same input.
  assert.notEqual(percentileWithin([5, 5, 5, 5], 5, METRIC_DIRECTION.higherIsBetter), 0);
  assert.notEqual(percentileWithin([5, 5, 5, 5], 5, METRIC_DIRECTION.higherIsBetter), 100);
  assert.equal(medianOf([5, 5, 5, 5]), 5);
});

// ---------------------------------------------------------------------------
// Boundaries and ties, stated as the pairs that make them boundaries.
// ---------------------------------------------------------------------------

test("the literacy action fires below the 25th percentile and not at it", () => {
  const at25 = fixtureById("boundary-literacy-p25");
  const below = fixtureById("boundary-literacy-below-p25");
  assert.equal(evaluate(at25).headline.percentile, 25);
  assert.equal(evaluate(at25).action.id, "hold_position");
  assert.equal(evaluate(below).headline.percentile, 21);
  assert.equal(evaluate(below).action.id, "close_literacy_gap");
  // Two points of score is the whole difference between the two rows, and the
  // rule — not the fixture — is what decides which side each lands on.
  assert.equal(at25.organization.literacyScore - below.organization.literacyScore, 2);
});

test("a spend action fires below the median percentile and not at it", () => {
  const at50 = fixtureById("boundary-recoverable-p50");
  const below = fixtureById("boundary-recoverable-below-p50");
  assert.equal(comparisonOf(evaluate(at50), "recoverable_share").percentile, 50);
  assert.equal(evaluate(at50).action.id, "hold_position");
  assert.equal(comparisonOf(evaluate(below), "recoverable_share").percentile, 46);
  assert.equal(evaluate(below).action.id, "capture_recoverable_gap");
});

test("a value that rounds into a member's value ties with it rather than beating it", () => {
  const row = fixtureById("tie-recoverable-rounds-into-member");
  const comparison = comparisonOf(evaluate(row), "recoverable_share");
  // 0.19999 is 0.2000 at four declared decimals. Rounding after the comparison
  // would make this a win over syn-scl-07 and move the percentile off 54.
  assert.equal(row.organization.recoverableShare, 0.19999);
  assert.equal(comparison.value, 0.2);
  assert.equal(comparison.percentile, 54);
});

// ---------------------------------------------------------------------------
// The findings a reader is shown, for each of the three metrics.
// ---------------------------------------------------------------------------

test("the literacy finding names the score, the cohort median, and the distance", () => {
  const finding = evaluateImport(fixtureById("boundary-literacy-below-p25")).finding;
  assert.equal(finding.available, true);
  assert.equal(finding.metricId, "literacy_score");
  assert.equal(finding.standing, PEER_STANDING.behind);
  assert.equal(finding.gap.value, 50);
  assert.equal(finding.gap.cohortMedian, 60);
  assert.match(finding.gap.text, /50 points against a cohort median of 60/);
  assert.match(finding.gap.text, /10 points behind the median/);
});

test("the spend-mix finding is reported as a share, in share units", () => {
  const finding = evaluateImport(fixtureById("spend-mix-behind")).finding;
  assert.equal(finding.metricId, "high_value_share");
  assert.equal(finding.gap.metricId, "high_value_share");
  // A share printed as "0.2 points" is the unit slip per-metric formatting exists
  // to prevent, and the gap phrase must move with the action's own metric.
  assert.match(finding.gap.text, /20\.0% against a cohort median of 29\.5%/);
  assert.match(finding.gap.text, /9\.5 points of share behind the median/);
});

test("the recoverable-share finding is reported against spend, not against the score", () => {
  const finding = evaluateImport(fixtureById("recoverable-share-behind")).finding;
  assert.equal(finding.metricId, "recoverable_share");
  assert.match(finding.gap.text, /30\.0% against a cohort median of 21\.0%/);
  assert.match(finding.gap.text, /9\.0 points of share behind the median/);
  // The headline score is still top quartile: the finding follows the action's
  // metric, so the sentence and the next step name one measurement.
  assert.equal(evaluateImport(fixtureById("recoverable-share-behind")).headline.percentile, 75);
});

test("an import at or above every median is told to hold, with no invented gap", () => {
  const finding = evaluateImport(fixtureById("boundary-literacy-p75")).finding;
  assert.equal(finding.id, "hold_position");
  assert.equal(finding.standing, PEER_STANDING.holding);
  assert.equal(finding.behind, false);
  assert.equal(finding.gap.size, null);
  assert.equal(finding.gap.text.includes("behind the median"), false);
});

// ---------------------------------------------------------------------------
// Honest provenance, and no implied ranking, when there is nothing to rank.
// ---------------------------------------------------------------------------

/**
 * Every field anywhere in a result that states where an organization sits.
 *
 * Checked by key rather than by prose: a refusal is allowed to say the word
 * "percentile" while explaining why it computed none — `peer_rubric_version_mismatch`
 * does exactly that — but it may never carry a placement value.
 */
const PLACEMENT_KEYS = new Set(["percentile", "quartile", "quartileLabel", "cohortMedian", "value"]);

function placementsIn(node, path = "$", found = []) {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => placementsIn(entry, `${path}[${index}]`, found));
  } else if (node && typeof node === "object") {
    for (const [key, entry] of Object.entries(node)) {
      if (PLACEMENT_KEYS.has(key) && entry !== null) found.push(`${path}.${key} = ${entry}`);
      placementsIn(entry, `${path}.${key}`, found);
    }
  }
  return found;
}

/** An ordinal is how a placement reaches a reader in prose. */
const ORDINAL = /\b\d+(?:st|nd|rd|th)\b/;

for (const row of REFUSED) {
  test(`refused fixture "${row.id}" keeps its provenance and implies no ranking`, () => {
    const result = evaluate(row);

    // Provenance survives the refusal: a reader is still told what the cohorts
    // are, which version refused them, and what the refusal needs.
    assert.equal(result.provenance, PEER_COHORT_PROVENANCE);
    assert.equal(result.provenance.version, result.version);
    assert.match(result.provenance.statement, /synthetic reference data/);
    assert.ok(result.unavailable.need.length > 0);
    assert.ok(result.unavailable.needLabel.length > 0);

    // And nothing in what a reader sees suggests a placement.
    assert.equal(result.confidence, null);
    assert.equal(result.confidenceLabel, null);
    assert.equal(result.comparability, COMPARABILITY.none);
    assert.equal(result.comparabilityLabel, COMPARABILITY_LABEL[COMPARABILITY.none]);
    assert.deepEqual(placementsIn(result), [], `${row.id} carries a placement`);
    assert.equal(ORDINAL.test(JSON.stringify(result)), false,
      `${row.id} states an ordinal placement`);

    // A named cohort on a refusal says which group WOULD have applied. It must
    // still carry the "none" comparability and no placement of its own.
    assert.equal(result.cohort !== null, row.expect.cohortNamed, row.id);
    if (result.cohort) {
      assert.equal(result.cohort.comparability, COMPARABILITY.none);
      assert.equal(result.cohort.rubricVersion, PEER_COHORT_PROVENANCE.rubricVersion);
      assert.equal(result.cohort.snapshotDate, PEER_COHORT_PROVENANCE.snapshotDate);
    }
  });

  test(`refused fixture "${row.id}" reaches the reader as a reason, not a blank figure`, () => {
    const imported = evaluateImport(row);
    const finding = imported.finding;
    assert.equal(finding.available, false);
    assert.equal(finding.action, null);
    assert.equal(finding.gap, null);
    assert.equal(finding.metricId, null);
    assert.equal(finding.standing, null);
    assert.equal(finding.evidence.length, 0);
    assert.equal(finding.evidenceText, "");
    assert.equal(finding.unavailable.reason, row.expect.reason);
    assert.equal(finding.provenance, PEER_COHORT_PROVENANCE);

    const card = importedKpiFigures(row.grade, {
      spendUsd: row.spendUsd, recoverableUsd: row.recoverableUsd,
      departments: row.orgUnits, period: row.analysis.period, peer: imported,
    }).find((entry) => entry.key === "peer");
    assert.equal(card.available, false);
    assert.equal(card.finding, null);
    assert.equal(card.unavailable.reason, row.expect.reason);
    assert.equal(card.note, imported.unavailable.need);
    // The figure slot holds the unmeasured marker, never an ordinal a reader
    // could take for a rank.
    assert.equal(ORDINAL.test(card.value), false, `${row.id} card value: ${card.value}`);
  });
}

test("no benchmark at all is a different statement from a refused comparison", () => {
  const none = importedKpiFigures(fixtureById("comparable-broad-mid").grade, {})
    .find((entry) => entry.key === "peer");
  assert.equal(none.available, false);
  assert.equal(none.finding, null);
  assert.notEqual(none.unavailable.reason, PEER_UNAVAILABLE_REASON.noSegmentInput);
  assert.notEqual(none.unavailable.reason, PEER_FINDING_UNAVAILABLE.noBenchmark);
});

// ---------------------------------------------------------------------------
// Low comparability is labelled, not smoothed over.
// ---------------------------------------------------------------------------

test("a size-only cohort is labelled broad and never claims an industry match", () => {
  const row = fixtureById("comparable-unknown-industry");
  const result = evaluate(row);
  assert.equal(row.analysis.segment.industry, "haberdashery");
  assert.equal(result.comparability, COMPARABILITY.broad);
  assert.equal(result.comparabilityLabel, COMPARABILITY_LABEL[COMPARABILITY.broad]);
  assert.match(result.comparabilityLabel, /any industry/);
  // The declared industry is reported back as read, and it did not select the
  // cohort: a reader who names an industry nobody publishes is compared broadly
  // and told so, rather than quietly matched to the nearest thing.
  assert.equal(result.segment.industry, "haberdashery");
  assert.equal(result.cohort.family, COHORT_FAMILY.organizationSize);
  assert.equal(result.confidence, PEER_CONFIDENCE.medium);
});

test("the same organization reads differently in a close cohort, and both say which", () => {
  const broad = evaluate(fixtureById("comparable-broad-mid"));
  const close = evaluate(fixtureById("comparable-close-saas"));
  assert.deepEqual(
    { ...broad.segment, industry: null }, { ...close.segment, industry: null });
  assert.equal(broad.headline.percentile, 83);
  assert.equal(close.headline.percentile, 58);
  assert.equal(broad.confidence, PEER_CONFIDENCE.medium);
  assert.equal(close.confidence, PEER_CONFIDENCE.high);
  // Neither is "the" percentile: each is published with the cohort it is a
  // percentile of, so the two figures cannot be read as a change over time.
  assert.notEqual(broad.cohort.cohortId, close.cohort.cohortId);
  assert.notEqual(broad.cohort.label, close.cohort.label);
});

test("low confidence is reachable by rule and unreachable from published data", () => {
  // The rule, stated: fewer than twelve members is low, whatever the match.
  assert.equal(peerConfidenceFor(COMPARABILITY.close, 11), PEER_CONFIDENCE.low);
  assert.equal(peerConfidenceFor(COMPARABILITY.broad, 8), PEER_CONFIDENCE.low);
  assert.equal(peerConfidenceFor(COMPARABILITY.close, 12), PEER_CONFIDENCE.high);
  assert.equal(peerConfidenceFor(COMPARABILITY.broad, 12), PEER_CONFIDENCE.medium);
  // And today no shipped cohort can produce it, so no reader sees the label. If
  // a smaller cohort is ever published this assertion is the place that says so.
  for (const row of AVAILABLE) {
    assert.notEqual(evaluate(row).confidence, PEER_CONFIDENCE.low, row.id);
  }
});

test("a partially available benchmark names the absent metric instead of ranking it", () => {
  const row = fixtureById("partial-no-spend-denominator");
  const result = evaluate(row);
  const recoverable = comparisonOf(result, "recoverable_share");
  assert.equal(result.available, true);
  assert.equal(recoverable.available, false);
  assert.equal(recoverable.percentile, null);
  assert.equal(recoverable.quartile, null);
  assert.equal(recoverable.cohortMedian, null);
  assert.equal(recoverable.unavailable.reason, PEER_UNAVAILABLE_REASON.missingValue);
  // The metric's definition and the cohort's member count survive so a reader can
  // see what would have been compared.
  assert.ok(recoverable.definition.length > 0);
  assert.equal(recoverable.memberCount, 12);
  // And the selected action is never the metric that has no value under it.
  assert.notEqual(result.action.metricId, "recoverable_share");
});
