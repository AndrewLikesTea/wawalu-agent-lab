import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMonthlyFinopsReview, MONTHLY_FINOPS_METRIC_CONTRACTS, MONTHLY_FINOPS_REVIEW_VERSION, roundOne,
} from "../src/monthly-finops-review.js";
import { renderMonthlyFinopsReview } from "../src/monthly-finops-review-view.js";
import { parseHtml, textOf } from "./support/browser.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const fixture = async () => JSON.parse(await read("src/monthly-finops-review-fixture.json"));

test("metric definitions fix formulas, populations, rounding, and exclusions", () => {
  const metrics = MONTHLY_FINOPS_METRIC_CONTRACTS;
  assert.match(metrics.selectedAction.definition, /sole action with selected=true/);
  assert.match(metrics.expectedSavings.population, /verificationPeriodId only/);
  assert.equal(metrics.observedSavings.formula,
    "observation.baselinePeriod.spendMinor - observation.verificationPeriod.spendMinor");
  assert.match(metrics.observedSavings.excluded, /Causal attribution/);
  assert.match(metrics.variance.formula, /observedSavingsMinor - expectedSavingsMinor/);
  assert.match(metrics.attainment.formula, /null when expectedSavingsMinor is zero/);
  assert.match(metrics.confidence.formula, /high=3, moderate=2, low=0 or 1/);
  assert.match(metrics.provenance.definition, /baselinePeriodId and verificationPeriodId/);
  assert.match(metrics.followUp.excluded, /Equal-weight alerts/);
  assert.equal(roundOne(-10.05), -10.1);
});

test("answers whether the selected action delivered in the next synthetic period", async () => {
  const review = buildMonthlyFinopsReview(await fixture());
  assert.equal(review.schemaVersion, MONTHLY_FINOPS_REVIEW_VERSION);
  assert.deepEqual(review.selectedAction, {
    id: "platform-routing-policy",
    name: "Platform routing policy",
    scope: "Platform model-routing spend",
  });
  assert.equal(review.benchmark.expectedSavingsMinor, 1_027_200);
  assert.equal(review.benchmark.observedSavingsMinor, 1_290_600);
  assert.equal(review.benchmark.varianceMinor, 263_400);
  assert.equal(roundOne(review.benchmark.attainment * 100), 125.6);
  assert.equal(review.finding.outcome, "met");
  assert.equal(review.confidence.level, "high");
  assert.deepEqual(review.provenance.periodIds, ["synthetic-2026-06", "synthetic-2026-07"]);
  assert.equal(review.nextAction.id, "extend-platform-routing");
});

test("finding, confidence, and the sole action change by documented bundled rules", async () => {
  const input = await fixture();
  input.observation.verificationPeriod.spendMinor = 12_200_000;
  input.observation.complete = false;
  const review = buildMonthlyFinopsReview(input);
  assert.equal(review.benchmark.observedSavingsMinor, 640_000);
  assert.equal(review.benchmark.varianceMinor, -387_200);
  assert.equal(review.finding.outcome, "missed");
  assert.equal(review.confidence.level, "moderate");
  assert.equal(review.nextAction.id, "inspect-routing-gap");
  assert.equal(review.nextAction.rank, 1);
});

test("zero expectation has defined variance and null attainment", async () => {
  const input = await fixture();
  input.actions.find((action) => action.selected).expectedSavingsMinor = 0;
  const review = buildMonthlyFinopsReview(input);
  assert.equal(review.benchmark.varianceMinor, review.benchmark.observedSavingsMinor);
  assert.equal(review.benchmark.attainment, null);
});

test("meeting expectation exactly is stated as met, not exceeded", async () => {
  const input = await fixture();
  // Observed savings land on the expectation to the minor unit.
  input.observation.verificationPeriod.spendMinor = 12_840_000 - 1_027_200;
  const review = buildMonthlyFinopsReview(input);
  assert.equal(review.benchmark.varianceMinor, 0);
  assert.equal(review.finding.outcome, "met");
  assert.doesNotMatch(review.finding.statement, /exceeded/);
  assert.match(review.finding.statement, /met its next-period savings expectation exactly/);
});

test("an unscoped observation is a failed signal, not a like-for-like benchmark", async () => {
  const mismatched = await fixture();
  mismatched.observation.scope = "Support inference spend";
  const review = buildMonthlyFinopsReview(mismatched);
  assert.equal(review.confidence.signals.scopeMatches, false);
  assert.equal(review.confidence.level, "moderate");

  // Two failed signals is the documented low level; it must be reachable.
  const weak = await fixture();
  delete weak.observation.scope;
  weak.observation.complete = false;
  const low = buildMonthlyFinopsReview(weak);
  assert.equal(low.confidence.signalCount, 1);
  assert.equal(low.confidence.level, "low");
});

test("a zero-record account renders the brief instead of throwing", async () => {
  const input = await fixture();
  input.confidence.recordsExpected = 0;
  input.confidence.recordsComparable = 0;
  const review = buildMonthlyFinopsReview(input);
  assert.equal(review.confidence.coveragePercent, null);
  assert.equal(review.confidence.signals.coverageMeetsThreshold, false);

  const doc = parseHtml(await read("src/evolution.html"));
  const root = renderMonthlyFinopsReview(doc, review);
  assert.match(textOf(root.querySelector("details")), /No comparable records/);
  assert.match(textOf(root), /Confidence: moderate/);
});

test("sub-unit amounts and attainment keep the contract's documented precision", async () => {
  const doc = parseHtml(await read("src/evolution.html"));
  const withCents = await fixture();
  withCents.actions.find((action) => action.selected).expectedSavingsMinor = 1_027_240;
  const cents = textOf(renderMonthlyFinopsReview(doc, buildMonthlyFinopsReview(withCents))
    .querySelector(".monthly-review-benchmark"));
  // Rounding the minor units away prints a $0 variance beside a met/missed verdict.
  assert.match(cents, /Expected savings.*\$10,272\.40/s);
  assert.match(cents, /Variance.*\$2,633\.60/s);

  const halfTie = await fixture();
  halfTie.actions.find((action) => action.selected).expectedSavingsMinor = 1_200_000;
  halfTie.observation.verificationPeriod.spendMinor = 12_840_000 - 1_200_600;
  // Exactly 100.05%: toFixed drops it to 100.0 and reads as "landed on target",
  // when the contract's half-away-from-zero rule says the action came in over.
  assert.match(textOf(renderMonthlyFinopsReview(doc, buildMonthlyFinopsReview(halfTie))
    .querySelector(".monthly-review-benchmark")), /Attainment.*100\.1%/s);
});

test("rejects ambiguous selected actions and ambiguous outcome actions", async () => {
  const twoSelected = await fixture();
  twoSelected.actions[1].selected = true;
  assert.throws(() => buildMonthlyFinopsReview(twoSelected), /exactly one selected/);

  const twoFollowUps = await fixture();
  twoFollowUps.followUpActions.push({ ...twoFollowUps.followUpActions[0], id: "duplicate" });
  assert.throws(() => buildMonthlyFinopsReview(twoFollowUps), /exactly one met follow-up/);
});

test("the existing AI FinOps monthly-review workspace imports and renders one accessible brief", async () => {
  const html = await read("src/evolution.html");
  const page = await read("src/evolution-page.js");
  const doc = parseHtml(html);
  const root = renderMonthlyFinopsReview(doc, buildMonthlyFinopsReview(await fixture()));

  assert.match(page, /import \{ buildMonthlyFinopsReview \} from "\/monthly-finops-review\.js"/);
  assert.match(page, /renderMonthlyFinopsReview\(document/);
  assert.match(textOf(root.querySelector("h2")), /Did our last action deliver the expected savings\?/);
  assert.match(textOf(root.querySelector(".monthly-review-benchmark")), /Expected savings.*\$10,272/s);
  assert.match(textOf(root.querySelector(".monthly-review-benchmark")), /Observed savings.*\$12,906/s);
  assert.match(textOf(root), /Confidence: high/);
  assert.match(textOf(root), /June 2026 synthetic source.*July 2026 synthetic source/s);
  assert.equal(root.querySelectorAll(".monthly-review-projection-action").length, 1);
  assert.equal(root.querySelectorAll("details").length, 1);
  assert.equal(root.querySelector("details").hasAttribute("open"), false);
  assert.equal(root.querySelector("summary").getAttribute("aria-controls"),
    "monthly-review-verification-support");
  assert.deepEqual(root.querySelectorAll("h2,h3").map(textOf), [
    "Did our last action deliver the expected savings?",
    "Finding",
    "Prioritized follow-up · rank 1",
  ]);
});
