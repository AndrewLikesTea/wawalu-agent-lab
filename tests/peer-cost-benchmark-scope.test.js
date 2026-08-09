import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BENCHMARK_FIT_STATE, PEER_COST_BENCHMARK_SCOPE, benchmarkFitAnswer,
  evaluatePeerCostBenchmarkFit,
} from "../src/peer-cost-benchmark-scope.js";
import { PEER_COST_COHORTS } from "../src/peer-cost-cohorts.js";
import { COST_METRIC } from "../src/peer-cost-position.js";
import { buildStandHeadline } from "../src/finops-stand.js";
import { applyStandHeadline } from "../src/finops-stand-view.js";
import { parseHtml, textOf } from "./support/browser.js";

const cohort = PEER_COST_COHORTS[0];
const comparable = (changes = {}) => ({
  metricId: COST_METRIC.id,
  sizeBand: cohort.sizeBand,
  industry: cohort.industry,
  cohort,
  asOfDate: "2026-08-01",
  ...changes,
});

test("benchmark fitness resolves all four states in declared precedence", () => {
  const eligible = evaluatePeerCostBenchmarkFit(comparable());
  assert.equal(eligible.state, BENCHMARK_FIT_STATE.eligible);
  assert.equal(eligible.eligible, true);

  const insufficient = evaluatePeerCostBenchmarkFit(comparable({
    cohort: { ...cohort, memberCount: PEER_COST_BENCHMARK_SCOPE.minimumCohortSize - 1 },
    asOfDate: "2027-01-01",
  }));
  assert.equal(insufficient.state, BENCHMARK_FIT_STATE.insufficient,
    "insufficient precedes stale");

  const stale = evaluatePeerCostBenchmarkFit(comparable({ asOfDate: "2027-01-01" }));
  assert.equal(stale.state, BENCHMARK_FIT_STATE.stale);

  const incomparable = evaluatePeerCostBenchmarkFit(comparable({
    metricId: "cost_per_attempt", cohort: { ...cohort, memberCount: 1 }, asOfDate: "2027-01-01",
  }));
  assert.equal(incomparable.state, BENCHMARK_FIT_STATE.incomparable,
    "incomparable precedes insufficient and stale");
});

test("confidence is selected from the consumed scope configuration", () => {
  const configured = {
    ...PEER_COST_BENCHMARK_SCOPE,
    confidenceRules: PEER_COST_BENCHMARK_SCOPE.confidenceRules.map((rule, index) => index === 0
      ? { ...rule, confidence: "directional", id: "test_policy_controls_confidence" }
      : rule),
  };
  const result = evaluatePeerCostBenchmarkFit(comparable(), configured);
  assert.equal(result.confidence, "directional");
  assert.equal(result.confidenceRuleId, "test_policy_controls_confidence");

  const refused = evaluatePeerCostBenchmarkFit(comparable({ metricId: "different" }), configured);
  assert.equal(refused.confidence,
    configured.confidenceRules.find((rule) => !rule.eligibleOnly).confidence);
});

test("the shipped analysis renders one visible, complete benchmark-fit answer", async () => {
  const doc = parseHtml(await readFile(new URL("../src/evolution.html", import.meta.url), "utf8"));
  const headline = buildStandHeadline();
  applyStandHeadline(doc, headline, { announce: false });
  const nodes = doc.querySelectorAll("#finops-stand-benchmark-fit");
  assert.equal(nodes.length, 1);
  const node = nodes[0];
  assert.equal(node.hidden, false);
  assert.equal(node.dataset.state, BENCHMARK_FIT_STATE.eligible);
  assert.equal(node.dataset.confidence, headline.benchmarkFit.confidence);
  const answer = textOf(node);
  assert.equal(answer, benchmarkFitAnswer(headline.benchmarkFit));
  assert.match(answer, /Eligible: 40 synthetic members/);
  assert.match(answer, /snapshot is \d+ days old/);
  assert.match(answer, /Freshness: snapshot 2026-06-30, \d+ days old/);
  assert.match(answer, /Confidence:/);
  assert.match(answer, /Method:/);
  assert.match(answer, /Provenance: Published synthetic cost cohorts/);
  assert.match(answer, /privacy-preserving/);
  assert.match(answer, /do not imply access to customer, provider, or HRIS data/);
});

test("the scope independently publishes the exact decision and metric boundary", () => {
  assert.match(PEER_COST_BENCHMARK_SCOPE.decisionQuestion, /fit to judge/);
  assert.equal(PEER_COST_BENCHMARK_SCOPE.metric.id, COST_METRIC.id);
  assert.match(PEER_COST_BENCHMARK_SCOPE.metric.definition, /All attributed spend remains/);
  assert.match(PEER_COST_BENCHMARK_SCOPE.metric.definition, /round only the displayed result/);
  assert.ok(PEER_COST_BENCHMARK_SCOPE.permittedCohorts.sizeBands.length > 1);
  assert.ok(PEER_COST_BENCHMARK_SCOPE.permittedCohorts.industries.length > 1);
  assert.ok(PEER_COST_BENCHMARK_SCOPE.minimumCohortSize > 0);
  assert.ok(PEER_COST_BENCHMARK_SCOPE.freshness.maximumAgeDays > 0);
});
