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
  PEER_FINDING_UNAVAILABLE, PEER_STANDING,
  importedPeerBenchmark, importedPeerEvidence, importedPeerFinding, importedPeerRollup,
  importedPeerSegment,
} from "../src/imported-peer-benchmark.js";
import {
  IMPORTED_EXECUTIVE_VIEW_VERSION, applyImportedExecutive, clearImportedExecutive,
  importedHeroFigures, importedKpiFigures, importedMixFigures,
} from "../src/imported-executive-view.js";
import { loadPage, textOf } from "./support/browser.js";
import bundledSeed from "../src/evolution-demo-data.json" with { type: "json" };

const PAGE = new URL("../src/evolution.html", import.meta.url);

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
  // The note is the placement and only the placement. Since #433 the cohort's
  // size, the two trust labels and the snapshot version are their own lines
  // rather than four more clauses in one muted sentence; each is asserted where
  // it now lives in `imported-peer-position.test.js`.
  assert.match(card.note, /quartile of/);
  assert.match(card.segment.text, /published synthetic peers/);
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

// --- the one prioritized finding, and the action inside it -------------------
//
// THE REJECTED STATE THIS SECTION PINS. The benchmark has always selected one
// action and published it on the result. Nothing rendered it, so a leader whose
// import sat in the bottom quartile of its cohort read a percentile, a quartile
// and a cohort name, and then the panel stopped — the recommended step existed
// only as a field nobody painted. Every assertion below is about that step
// reaching the page, in the contract's own words, beside the gap it follows
// from and the import's own money.

/** The savings evidence a local-finops analysis publishes beside its totals. */
const withSavings = (name = "unit-3 · Platform", recoverableUsd = 2100, action = "Pilot lower-cost routing for text-generation in unit-3 · Platform.") => ({
  topDepartment: { id: "unit-3", name, recoverableUsd },
  action,
});

/** An import that is behind its cohort on the metric the action names. */
const behind = () => importedPeerBenchmark({
  grade: grade(46, 0.16), analysis: analysis(8, 10000, 3400, withSavings()),
});

test("a comparable import carries one finding with the contract's own action attached", () => {
  const peer = behind();
  const { finding } = peer;
  assert.equal(finding.available, true);
  assert.equal(finding.id, "close_literacy_gap");
  assert.equal(finding.standing, PEER_STANDING.behind);
  assert.equal(finding.behind, true);
  // The action is repeated, never re-authored: the sentence on the finding and
  // the sentence on the benchmark result are the same string.
  assert.equal(finding.action.text, peer.action.text);
  assert.equal(finding.action.gap, peer.action.gap);
  assert.equal(finding.action.accountableRole, peer.action.accountableRole);
});

test("the gap sentence names the action's own metric, its value, and the cohort median", () => {
  const finding = behind().finding;
  assert.equal(finding.gap.metricId, "literacy_score");
  assert.equal(finding.gap.value, 46);
  assert.equal(finding.gap.cohortMedian, 60);
  assert.match(finding.gap.text, /46 points against a cohort median of 60/);
  assert.match(finding.gap.text, /Bottom quartile of Organizations with 5–14 attributed org units/);
  assert.match(finding.gap.text, /14 points behind the median/);
});

test("a spend-side action is reported against spend, not against the headline score", () => {
  // A healthy literacy score with worse-than-median recoverable share: the
  // contract selects the spend action, so the gap sentence must move with it.
  const peer = importedPeerBenchmark({
    grade: grade(70, 0.40), analysis: analysis(8, 10000, 3000, withSavings()),
  });
  assert.equal(peer.finding.id, "capture_recoverable_gap");
  assert.equal(peer.finding.metricId, "recoverable_share");
  assert.equal(peer.finding.gap.metricId, "recoverable_share");
  // Shares read as shares. A share printed as "0.3 points" is the unit slip this
  // per-metric formatting exists to prevent.
  assert.match(peer.finding.gap.text, /30\.0% against a cohort median of 21\.0%/);
  assert.match(peer.finding.gap.text, /9\.0 points of share behind the median/);
});

test("the evidence is the import's own savings figures, repeated and never recomputed", () => {
  const finding = behind().finding;
  assert.deepEqual(finding.evidence.map((entry) => entry.id),
    ["recoverable_scenario", "top_department", "analysis_action"]);
  assert.equal(finding.evidence[0].value, "$3,400");
  assert.match(finding.evidenceText, /Recoverable in this import: \$3,400/);
  assert.match(finding.evidenceText, /Largest recoverable unit: unit-3 · Platform · \$2,100/);
  assert.match(finding.evidenceText, /Already on this briefing: Pilot lower-cost routing/);
});

test("an analysis that published no savings evidence contributes no entry, not a zero", () => {
  const finding = importedPeerBenchmark({
    grade: grade(46, 0.16), analysis: analysis(8, 10000, 3400),
  }).finding;
  // The recoverable total is present; the department and the next step are not,
  // and an absent figure is an absent line rather than "$0".
  assert.deepEqual(finding.evidence.map((entry) => entry.id), ["recoverable_scenario"]);
  assert.equal(importedPeerEvidence(null).length, 0);
  assert.equal(finding.evidenceText.includes("$0"), false);
});

test("an import that is not behind still gets the contract's hold action, marked as holding", () => {
  const finding = importedPeerBenchmark({
    grade: grade(78, 0.44), analysis: analysis(8, 10000, 900, withSavings()),
  }).finding;
  assert.equal(finding.id, "hold_position");
  assert.equal(finding.standing, PEER_STANDING.holding);
  assert.equal(finding.behind, false);
  // No distance-to-median phrase on a hold, so the sentence must not claim one.
  assert.equal(finding.gap.size, null);
  assert.equal(finding.gap.text.includes("behind the median"), false);
});

test("a refused benchmark produces no finding and keeps the contract's own reason", () => {
  const finding = importedPeerBenchmark({
    grade: grade(71, 0.38), analysis: analysis(0, 10000, 1100),
  }).finding;
  assert.equal(finding.available, false);
  assert.equal(finding.unavailable.reason, PEER_UNAVAILABLE_REASON.noSegmentInput);
  assert.equal(finding.action, null);
  assert.equal(finding.gap, null);
});

test("no benchmark at all is its own reason, distinct from a refused comparison", () => {
  const finding = importedPeerFinding({ peer: null, analysis: analysis(8, 10000, 1100) });
  assert.equal(finding.available, false);
  assert.equal(finding.unavailable.reason, PEER_FINDING_UNAVAILABLE.noBenchmark);
  assert.equal(finding.provenance, PEER_COHORT_PROVENANCE);
});

// --- what a leader actually sees --------------------------------------------

const KPI = (peer) => importedKpiFigures(grade(46, 0.16), {
  spendUsd: 10000, recoverableUsd: 3400, departments: 8, period: "2026-06", peer,
}).find((entry) => entry.key === "peer");

test("the peer card publishes the finding's three lines, action included", () => {
  const peer = behind();
  const card = KPI(peer);
  assert.equal(card.finding.action, peer.action.text);
  assert.equal(card.finding.gap, peer.finding.gap.text);
  assert.match(card.finding.evidence, /^Accountable: Platform Engineering Lead · /);
  assert.equal(card.finding.standing, PEER_STANDING.behind);
});

test("a card with no comparison to report carries no finding to render", () => {
  assert.equal(KPI(null).finding, null);
  assert.equal(KPI(importedPeerBenchmark({
    grade: grade(46, 0.16), analysis: analysis(0, 10000, 3400),
  })).finding, null);
});

const shown = (document, id) => textOf(document.getElementById(id));

/**
 * The executive figures, with only the peer card's inputs varied.
 *
 * The hero and the mix are handed an ungraded corpus on purpose: this file is
 * about one card, and a hero fixture here would be a second copy of the grading
 * assertions that `imported-executive-view.test.js` already owns.
 */
const executiveFigures = (peer) => Object.freeze({
  version: IMPORTED_EXECUTIVE_VIEW_VERSION,
  hero: importedHeroFigures(null),
  kpis: importedKpiFigures(grade(46, 0.16), {
    spendUsd: 10000, recoverableUsd: 3400, departments: 8, period: "2026-06", peer,
  }),
  mix: importedMixFigures(null),
});

test("the shipped page renders the recommended action beside the gap and the evidence", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    const peer = behind();
    applyImportedExecutive(document, executiveFigures(peer));

    const block = document.getElementById("kpi-peer-finding");
    assert.equal(block.hidden, false);
    assert.equal(block.dataset.peerStanding, PEER_STANDING.behind);
    // THE REGRESSION: the action a reader is given is the contract's own
    // sentence, on the page, and not only a field on a result object.
    assert.equal(shown(document, "kpi-peer-action"), peer.action.text);
    assert.match(shown(document, "kpi-peer-action"), /Raise prompt literacy first/);
    // Beside it, the measurement it follows from and the money behind it.
    assert.equal(shown(document, "kpi-peer-gap"), peer.finding.gap.text);
    assert.match(shown(document, "kpi-peer-evidence"), /Accountable: Platform Engineering Lead/);
    assert.match(shown(document, "kpi-peer-evidence"), /Recoverable in this import: \$3,400/);
    // The percentile above it is unchanged: the finding is added to the card,
    // not put in place of the figure.
    assert.equal(shown(document, "kpi-peer-value"), `${peer.headline.percentile}th`);
  } finally {
    page.restore();
  }
});

test("a refused comparison renders its reason and no next step at all", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    const peer = importedPeerBenchmark({
      grade: grade(46, 0.16), analysis: analysis(0, 10000, 3400),
    });
    applyImportedExecutive(document, executiveFigures(peer));

    const block = document.getElementById("kpi-peer-finding");
    assert.equal(block.hidden, true);
    assert.equal(block.dataset.peerStanding, undefined);
    // Hidden AND empty: a stale action must not be readable off the DOM by
    // anything that ignores `hidden`.
    assert.equal(shown(document, "kpi-peer-action"), "");
    assert.equal(shown(document, "kpi-peer-gap"), "");
    assert.equal(shown(document, "kpi-peer-evidence"), "");
    assert.equal(shown(document, "kpi-peer-note"), peer.unavailable.need);
  } finally {
    page.restore();
  }
});

test("returning to the bundled sample takes the import's finding down with it", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    applyImportedExecutive(document, executiveFigures(behind()));
    assert.equal(document.getElementById("kpi-peer-finding").hidden, false);

    clearImportedExecutive(document);
    assert.equal(document.getElementById("kpi-peer-finding").hidden, true);
    assert.equal(shown(document, "kpi-peer-action"), "");
    assert.equal(document.getElementById("kpi-peer-finding").dataset.peerStanding, undefined);
  } finally {
    page.restore();
  }
});
