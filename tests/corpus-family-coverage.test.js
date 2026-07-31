// Coverage from the multi-family classifier, and the residue behind it.
//
// Four claims are made to a FinOps lead, and each one is checked here against
// the shipped modules rather than against a re-implementation:
//
//   1. The tier a corpus lands in is decided by `COVERAGE_TIERS`, on both sides
//      of a floor, with the boundary value belonging to the better tier.
//   2. Residue clusters rank by share and, when two shares are equal, by the
//      cluster key — so no run can reorder them.
//   3. A cluster key comes from the record's own normalized text, so shuffling
//      the input array changes neither the keys nor their order.
//   4. A corpus under the floor is refused with the published withholding
//      wording, and the surface that reads it publishes no letter.
//
// The corpora are generated in-test. Token counts are the weights: a query
// sample carries no money, so `familyCoverage` weighs it in billed tokens and
// says so, and every share below is arithmetic over integers a reader can
// repeat by hand.

import assert from "node:assert/strict";
import test from "node:test";
import {
  RESIDUE_UNKEYED, classifyCorpusRecord, coverageHeadline, familyCoverage, residueClusterKey,
  residueClusters,
} from "../src/corpus-family-coverage.js";
import { COVERAGE_TIERS, gradeEligibility } from "../src/grade-eligibility.js";
import { orgQueryCoachingDecision } from "../src/org-query-decision.js";
import { orgQueryDepartmentLiteracy } from "../src/org-query-scoring.js";
import { loadExampleOrgQuerySample } from "../src/org-query-example.js";
import { orgQuerySampleResult } from "../src/org-query-source.js";
import demoData from "../src/evolution-demo-data.json" with { type: "json" };

/**
 * A record the classifier CAN place: labelled lines are structure in any
 * language, so this one is read by the language-independent family and by the
 * keyword family, and does not depend on the model tier to be classified.
 */
const classifiable = (vendor, tokens) => ({
  orgUnitId: "unit-a",
  vendor,
  model: "gpt-3.5-turbo",
  promptExcerpt: "Context: quarterly close. Constraints: no customer names. "
    + "Acceptance criteria: reconciles to the ledger.",
  inputTokens: tokens,
  outputTokens: 0,
});

/**
 * A record no family can read: three characters, one turn, on a standard-tier
 * model, so there is no phrase, no depth, no structure and no tier mismatch to
 * vote on. `no_signal`, and therefore residue.
 */
const residual = (vendor, tokens) => ({
  orgUnitId: "unit-a",
  vendor,
  model: "gpt-3.5-turbo",
  promptExcerpt: "zzz",
  inputTokens: tokens,
  outputTokens: 0,
});

const tierNamed = (name) => COVERAGE_TIERS.find((entry) => entry.tier === name);

test("an unreadable record is residue and a structural one is scored", () => {
  assert.equal(classifyCorpusRecord(residual("acme", 10)).classified, false);
  const scored = classifyCorpusRecord(classifiable("acme", 10));
  assert.equal(scored.classified, true);
  // One record, one class, one contribution — however many families voted.
  assert.ok(scored.families.length >= 1);
  assert.equal(scored.spend, 10);
});

test("coverage lands on both sides of a COVERAGE_TIERS floor", () => {
  const floor = tierNamed("moderate").floor;
  assert.equal(floor, 0.5, "this test is written against the 0.50 floor");

  // Exactly at the floor: 50 scored tokens of 100. Read with `>=`, so the
  // boundary belongs to the better tier.
  const at = familyCoverage([classifiable("acme", 50), residual("beta", 50)]);
  assert.equal(at.scoredShare, floor);
  assert.equal(at.eligibility.tier, "moderate");
  assert.equal(at.eligibility.showGrade, true);

  // One token under it: 49 of 100. The tier below, and it is a different tier.
  const under = familyCoverage([classifiable("acme", 49), residual("beta", 51)]);
  assert.ok(under.scoredShare < floor);
  assert.equal(under.eligibility.tier, "provisional");
  assert.equal(under.eligibility.label, tierNamed("provisional").label);
});

test("residue clusters rank by share, and equal shares tie-break on the key", () => {
  const result = familyCoverage([
    classifiable("acme", 200),
    residual("zulu vendor", 50),
    residual("alpha vendor", 50),
    residual("big vendor", 120),
  ]);
  assert.deepEqual(result.residue.map((cluster) => cluster.key),
    ["big vendor", "alpha vendor", "zulu vendor"]);
  const [alpha, zulu] = [result.residue[1], result.residue[2]];
  assert.equal(alpha.share, zulu.share, "the tie-break case must actually be a tie");
  // The points a cluster returns are its share, as points. Both readings of the
  // same number, so a reader can check one against the other.
  assert.equal(alpha.coveragePoints, alpha.share * 100);
  assert.equal(result.residueAction.cluster, "big vendor");
  assert.match(result.residueAction.text, /big vendor/);
});

test("cluster keys and their order survive a shuffled input array", () => {
  const corpus = [
    classifiable("Acme  Corp", 300),
    residual("  Beta Corp ", 40),
    residual("beta corp", 60),
    residual("Gamma\tWorks", 100),
    residual("", 25),
    classifiable("Delta", 75),
  ];
  const first = familyCoverage(corpus);
  // A deterministic shuffle: reversed, then rotated. No clock, no randomness —
  // a test that shuffles randomly cannot be replayed when it fails.
  const shuffled = [...corpus].reverse();
  shuffled.push(shuffled.shift());
  const second = familyCoverage(shuffled);

  assert.deepEqual(second.residue.map((cluster) => cluster.key),
    first.residue.map((cluster) => cluster.key));
  assert.deepEqual(second.residue.map((cluster) => cluster.share),
    first.residue.map((cluster) => cluster.share));
  assert.equal(second.scoredShare, first.scoredShare);
  // Whitespace and case are normalized into one key, and a record with no
  // grouping text at all is kept under the published key rather than dropped.
  assert.ok(first.residue.some((cluster) => cluster.key === "beta corp"));
  assert.ok(first.residue.some((cluster) => cluster.key === "gamma works"));
  // The record with a blank vendor is not dropped: the key rule falls through
  // to the next field the record carries, which is the model that ran it.
  assert.ok(first.residue.some((cluster) => cluster.key === "gpt-3.5-turbo"));
  assert.equal(residueClusterKey({ vendor: "  Acme   Corp  " }), "acme corp");
  assert.equal(residueClusterKey({ vendor: " ", model: "" }), RESIDUE_UNKEYED);
  assert.equal(residueClusterKey({}), RESIDUE_UNKEYED);
});

test("a corpus with no weight at all has no denominator, not a coverage of zero", () => {
  const empty = familyCoverage([]);
  assert.equal(empty.scoredShare, null);
  assert.equal(empty.eligibility.tier, "no_baseline");
  assert.equal(empty.eligibility.showGrade, false);
  assert.deepEqual(residueClusters([], 0), []);
});

test("below the bar, the letter is withheld in the published words", () => {
  const insufficient = tierNamed("insufficient");
  // 10 scored tokens of 100 — under the 0.25 floor.
  const result = familyCoverage([classifiable("acme", 10), residual("beta", 90)]);
  assert.equal(result.eligibility.tier, "insufficient");
  assert.equal(result.eligibility.showGrade, false);
  assert.equal(result.eligibility.label, insufficient.label);
  assert.equal(result.eligibility.rule, insufficient.rule);
  assert.equal(result.eligibility.reason, insufficient.reason);

  const headline = coverageHeadline(result);
  assert.equal(headline.showGrade, false);
  assert.equal(headline.rule, insufficient.rule);
  assert.ok(headline.text.endsWith(insufficient.label), "the tier label is carried verbatim");

  // And the surface that reads it publishes no letter: the same sample that
  // grades without a coverage result is refused with the coverage wording.
  const literacy = orgQueryDepartmentLiteracy({
    results: [orgQuerySampleResult(loadExampleOrgQuerySample())],
  });
  const graded = orgQueryCoachingDecision(literacy, { origin: "example" });
  assert.equal(graded.state, "graded");
  const withheld = orgQueryCoachingDecision(literacy,
    { origin: "example", familyCoverage: result });
  assert.equal(withheld.state, "ungradeable");
  assert.equal(withheld.benchmark, undefined, "no benchmark survives a withheld letter");
  assert.equal(withheld.reason.code, insufficient.reason);
  assert.equal(withheld.reason.detail, insufficient.rule);
  assert.ok(withheld.reason.label.endsWith(insufficient.label));
});

test("the decision surface leads with the number and names the top cluster", () => {
  const sample = orgQuerySampleResult(loadExampleOrgQuerySample());
  const literacy = orgQueryDepartmentLiteracy({ results: [sample] });
  const coverage = familyCoverage(sample.records);
  const decision = orgQueryCoachingDecision(literacy,
    { origin: "example", familyCoverage: coverage });

  assert.equal(decision.state, "graded", "the bundled sample keeps its letter");
  assert.equal(decision.coverage.share, coverage.scoredShare);
  assert.equal(decision.coverage.action, coverage.residueAction.text);
  assert.match(decision.coverage.action, new RegExp(coverage.residue[0].key));

  // The per-cluster detail lands in the disclosure the reader checks limits in,
  // in the module's ranked order and nowhere else.
  const limits = decision.disclosures.find((entry) => entry.id === "sampling-limits");
  const residueTerms = limits.rows.filter((row) => row.term.startsWith("Residue "));
  assert.equal(residueTerms.length, coverage.residue.length);
  assert.deepEqual(residueTerms.map((row) => row.term.replace(/^Residue \d+ · /, "")),
    coverage.residue.map((cluster) => cluster.key));

  // A sample with no coverage result attached carries none, and the surface is
  // exactly what it was before this module existed.
  assert.equal(orgQueryCoachingDecision(literacy, { origin: "example" }).coverage, null);
});

test("the bundled demo dataset's headline is unchanged", () => {
  // The demo billing seed is graded by the department path, which this change
  // does not touch: no query corpus is read for it and its tier, coverage and
  // one action are the same figures the page printed before.
  const eligibility = gradeEligibility(demoData.departments);
  assert.equal(eligibility.tier, "high");
  assert.equal(eligibility.state, "graded");
  assert.equal(eligibility.showGrade, true);
  // Pinned to the figure the page printed before this change, to five places.
  assert.equal(Number(eligibility.coverage.toFixed(5)), 0.94484);
  assert.equal(eligibility.label, tierNamed("high").label);
  assert.equal(eligibility.nextAction.kind, "none");

  // And the bundled example query sample still publishes its letter: the
  // multi-family classifier reads more of it, never less.
  const sample = orgQuerySampleResult(loadExampleOrgQuerySample());
  const coverage = familyCoverage(sample.records);
  assert.equal(coverage.eligibility.tier, "high");
  assert.equal(coverage.eligibility.showGrade, true);
  assert.equal(coverage.unit, "billed_tokens");
  assert.ok(coverage.scoredShare > tierNamed("high").floor);
});
