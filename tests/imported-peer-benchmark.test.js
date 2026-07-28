// The regression this file exists to prevent.
//
// The peer panel used to answer "how do we compare with organizations like us?"
// with a permanent refusal for anyone who imported their own files, and with
// the bundled seed's hand-authored percentile for everyone else. A reader who
// brought a real export got a question with no path to an answer.
//
// What is pinned below: an import with comparable data produces a result that
// is derived from THAT import — it moves when the import moves, and it is not
// the bundled seed's figure — and an import missing a required input stays
// unavailable under the contract's own reason code rather than being filled in.

import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPARABILITY, PEER_COHORT_PROVENANCE, PEER_UNAVAILABLE_REASON, PEER_INDUSTRY,
} from "../src/peer-cohort-contract.js";
import {
  importedPeerBenchmark, importedPeerRollup, importedPeerSegment,
} from "../src/imported-peer-benchmark.js";
import { importedKpiFigures } from "../src/imported-executive-view.js";
import bundledSeed from "../src/evolution-demo-data.json" with { type: "json" };

const RUBRIC = PEER_COHORT_PROVENANCE.rubricVersion;

/** A graded corpus, shaped exactly as `gradeImportedCorpus` publishes one. */
const grade = (composite, highValueShare, { scored = 240 } = {}) => Object.freeze({
  gradeable: true,
  composite,
  grade: "B",
  rubricVersionId: RUBRIC,
  records: Object.freeze({ source: scored, scored, unclassified: 0 }),
  score: Object.freeze({
    categories: Object.freeze([
      Object.freeze({ key: "highValue", share: highValueShare, records: 12 }),
      Object.freeze({ key: "inefficient", share: 1 - highValueShare, records: 8 }),
    ]),
  }),
});

/** A local-finops analysis, shaped as the page holds one. */
const analysis = (departments, spendUsd, recoverableUsd, extra = {}) => Object.freeze({
  period: "2026-06-01 to 2026-06-30",
  spendUsd,
  recoverableUsd,
  rankedDepartments: Object.freeze(
    Array.from({ length: departments }, (unused, index) => Object.freeze({ id: `unit-${index}` }))),
  ...extra,
});

// --- an import produces its own result --------------------------------------

test("an import with comparable data is placed in a published cohort", () => {
  const result = importedPeerBenchmark({
    grade: grade(71, 0.38), analysis: analysis(8, 10000, 1100),
  });
  assert.equal(result.available, true);
  assert.equal(result.fromImport, true);
  assert.equal(result.cohort.cohortId, "size-scaling");
  assert.equal(result.comparability, COMPARABILITY.broad);
  assert.equal(result.headline.value, 71);
  assert.equal(result.organization.recoverableShare, 0.11);
  assert.equal(result.organization.rubricVersion, RUBRIC);
  assert.ok(result.action.available);
});

test("the result is the import's own: change the import and the percentile moves", () => {
  const weak = importedPeerBenchmark({ grade: grade(46, 0.16), analysis: analysis(8, 10000, 3400) });
  const strong = importedPeerBenchmark({ grade: grade(78, 0.44), analysis: analysis(8, 10000, 900) });
  assert.equal(weak.available, true);
  assert.equal(strong.available, true);
  assert.ok(strong.headline.percentile > weak.headline.percentile);
  // And the one prioritized action follows the import, not a standing default.
  assert.equal(weak.action.id, "close_literacy_gap");
  assert.equal(strong.action.id, "hold_position");
});

test("the import's size band, not the seed's, selects the cohort", () => {
  const small = importedPeerBenchmark({ grade: grade(60, 0.3), analysis: analysis(2, 500, 50) });
  const large = importedPeerBenchmark({ grade: grade(60, 0.3), analysis: analysis(20, 500, 50) });
  assert.equal(small.cohort.cohortId, "size-focused");
  assert.equal(large.cohort.cohortId, "size-enterprise");
  assert.notEqual(small.headline.percentile, large.headline.percentile);
});

test("no bundled seed organization figure reaches an imported result", () => {
  const result = importedPeerBenchmark({
    grade: grade(71, 0.38), analysis: analysis(8, 10000, 1100),
  });
  const seed = bundledSeed.organization;
  assert.equal(result.headline.percentile === seed.peerPercentile, false);
  assert.equal(result.headline.cohortMedian === seed.peerMedianScore, false);
  assert.notEqual(result.cohort.label, seed.peerCohort);
  // The seed's own benchmark block is a different fixture entirely, and none of
  // its identifying values appear in the import's result.
  assert.equal(JSON.stringify(result).includes(bundledSeed.benchmark.name), false);
});

test("an import that declares an industry is compared closely", () => {
  const result = importedPeerBenchmark({
    grade: grade(71, 0.38),
    analysis: analysis(8, 10000, 1100, { segment: { industry: PEER_INDUSTRY.saas } }),
  });
  assert.equal(result.comparability, COMPARABILITY.close);
  assert.equal(result.cohort.cohortId, "industry-saas");
});

// --- missing and non-comparable inputs stay unavailable ---------------------

test("an import with no attributed org unit cannot be segmented", () => {
  const result = importedPeerBenchmark({ grade: grade(71, 0.38), analysis: analysis(0, 10000, 1100) });
  assert.equal(result.available, false);
  assert.equal(result.unavailable.reason, PEER_UNAVAILABLE_REASON.noSegmentInput);
  assert.equal(result.headline, null);
});

test("an ungraded import has no score to place and says which input is missing", () => {
  const result = importedPeerBenchmark({
    grade: Object.freeze({ gradeable: false, composite: null, rubricVersionId: RUBRIC, score: null }),
    analysis: analysis(8, 10000, 1100),
  });
  assert.equal(result.available, false);
  assert.equal(result.unavailable.reason, PEER_UNAVAILABLE_REASON.noComparableMetric);
  assert.match(result.unavailable.need, /query sample/);
});

test("a grade from a different rubric is refused, not rescaled onto the cohort", () => {
  const other = { ...grade(71, 0.38), rubricVersionId: "literacy-mix/9.9.9" };
  const result = importedPeerBenchmark({ grade: other, analysis: analysis(8, 10000, 1100) });
  assert.equal(result.unavailable.reason, PEER_UNAVAILABLE_REASON.rubricMismatch);
});

test("an import with no spend leaves the recoverable metric absent, not zero", () => {
  const rollup = importedPeerRollup(grade(71, 0.38), analysis(8, 0, 0));
  assert.equal(rollup.recoverableShare, null);
  const result = importedPeerBenchmark({ grade: grade(71, 0.38), analysis: analysis(8, 0, 0) });
  assert.equal(result.available, true);
  const recoverable = result.comparisons.find((entry) => entry.metricId === "recoverable_share");
  assert.equal(recoverable.available, false);
  assert.equal(recoverable.value, null);
});

test("organization size is counted in attributed org units, and nothing else", () => {
  assert.deepEqual(importedPeerSegment(analysis(3, 10, 1)), { orgUnits: 3, industry: null });
  assert.deepEqual(importedPeerSegment(null), { orgUnits: null, industry: null });
});

// --- the KPI card the reader actually sees ----------------------------------

test("the peer KPI card publishes the import's percentile and its provenance", () => {
  const peer = importedPeerBenchmark({ grade: grade(71, 0.38), analysis: analysis(8, 10000, 1100) });
  const card = importedKpiFigures(grade(71, 0.38), {
    spendUsd: 10000, recoverableUsd: 1100, departments: 8, period: "2026-06", peer,
  }).find((entry) => entry.key === "peer");
  assert.equal(card.available, true);
  assert.equal(card.value, `${peer.headline.percentile}th`);
  assert.match(card.note, /published synthetic peers/);
  assert.equal(card.unavailable, null);
  assert.equal(card.provenance.sourceRecords, 240);
});

test("a refused benchmark reaches the card as the contract's own reason", () => {
  const peer = importedPeerBenchmark({ grade: grade(71, 0.38), analysis: analysis(0, 10000, 1100) });
  const card = importedKpiFigures(grade(71, 0.38), { peer })
    .find((entry) => entry.key === "peer");
  assert.equal(card.available, false);
  assert.equal(card.unavailable.reason, PEER_UNAVAILABLE_REASON.noSegmentInput);
  assert.equal(card.note, peer.unavailable.need);
  assert.equal(card.provenance, null);
});

test("no benchmark supplied is a different statement from a refused one", () => {
  const card = importedKpiFigures(grade(71, 0.38), {}).find((entry) => entry.key === "peer");
  assert.equal(card.available, false);
  assert.equal(card.unavailable.reason, "no_peer_cohort");
});
