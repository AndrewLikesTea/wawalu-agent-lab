import assert from "node:assert/strict";
import test from "node:test";
import { byClass, installDocument, tags } from "./support/dom.js";
import {
  OPTIMIZATION_DIRECTION,
  REVIEW_STATE,
  demoRecurringReviewReadiness,
  recurringReviewReadiness,
} from "../src/recurring-review-readiness.js";
import { renderRecurringReviewReadiness } from "../src/savings-action-center-view.js";

installDocument();

const metric = (value, periodEnd, overrides = {}) => ({
  value,
  metricDefinition: "cost_per_review_v1",
  unit: "currency_minor",
  currency: "USD",
  scopeId: "team-a",
  periodDurationDays: 30,
  periodEnd,
  ...overrides,
});

test("first review answers the leader with one baseline action", () => {
  const review = recurringReviewReadiness({
    current: metric(900, "2026-07-31"),
    benchmark: metric(1000, "2026-06-30"),
    optimizationDirection: OPTIMIZATION_DIRECTION.minimize,
  });
  assert.equal(review.state, REVIEW_STATE.first);
  assert.equal(review.ready, false);
  assert.match(review.nextAction.label, /first review/i);
  assert.equal(review.recommendation, null);
});

test("a tracked action without a retained post-period outcome waits", () => {
  const review = recurringReviewReadiness({
    current: metric(900, "2026-07-31"),
    benchmark: metric(1000, "2026-06-30"),
    priorAction: { reviewPeriodEnd: "2026-06-30", baseline: metric(1100, "2026-06-30") },
    optimizationDirection: OPTIMIZATION_DIRECTION.minimize,
  });
  assert.equal(review.state, REVIEW_STATE.awaiting);
  assert.equal(review.evidence.priorResultAvailable, false);
  assert.match(review.nextAction.label, /post-action measurement/i);
});

test("comparable retained outcome makes the review ready and computes exact deltas", () => {
  const review = recurringReviewReadiness({
    current: metric(900, "2026-07-31"),
    benchmark: metric(1000, "2026-06-30"),
    priorAction: {
      reviewPeriodEnd: "2026-05-31",
      baseline: metric(1200, "2026-05-31"),
      outcome: metric(1000, "2026-06-30"),
    },
    optimizationDirection: OPTIMIZATION_DIRECTION.minimize,
  });
  assert.equal(review.state, REVIEW_STATE.ready);
  assert.equal(review.ready, true);
  assert.equal(review.metrics.currentValue, 900);
  assert.equal(review.metrics.benchmarkDelta, -100);
  assert.equal(review.metrics.benchmarkDirection, 100);
  assert.equal(review.metrics.priorActionOutcomeDelta, -200);
  assert.equal(review.metrics.priorActionOutcomeDirection, 200);
  assert.equal(review.recommendation.status, "available");
});

test("missing or mismatched comparison dimensions suppress recommendations", () => {
  for (const [field, override] of [
    ["metricDefinition", { metricDefinition: "cost_per_review_v2" }],
    ["unit", { unit: "tokens" }],
    ["currency", { currency: "EUR" }],
    ["scopeId", { scopeId: "team-b" }],
    ["periodDurationDays", { periodDurationDays: 31 }],
  ]) {
    const review = recurringReviewReadiness({
      current: metric(900, "2026-07-31"),
      benchmark: metric(1000, "2026-06-30", override),
      priorAction: {
        reviewPeriodEnd: "2026-05-31",
        baseline: metric(1200, "2026-05-31"),
        outcome: metric(1000, "2026-06-30"),
      },
      optimizationDirection: OPTIMIZATION_DIRECTION.minimize,
    });
    assert.equal(review.recommendation, null, field);
    assert.equal(review.ready, false, field);
    assert.ok(review.evidence.gaps.some((gap) => gap.startsWith(field)), field);
    // A measured prior outcome must not hand the leader a "the evidence is
    // ready" action while the headline above it refuses the recommendation.
    assert.equal(review.state, REVIEW_STATE.ready, field);
    assert.match(review.nextAction.label, /Reconcile the mismatched evidence/, field);
  }
  assert.equal(recurringReviewReadiness().recommendation, null);
});

test("a review refused for mismatched evidence never paints a ready next action", () => {
  const review = recurringReviewReadiness({
    current: metric(900, "2026-07-31"),
    benchmark: metric(1000, "2026-06-30", { currency: "EUR" }),
    priorAction: {
      reviewPeriodEnd: "2026-05-31",
      baseline: metric(1200, "2026-05-31"),
      outcome: metric(1000, "2026-06-30"),
    },
    optimizationDirection: OPTIMIZATION_DIRECTION.minimize,
  });
  const view = renderRecurringReviewReadiness(review);
  assert.equal(view.dataset.reviewState, REVIEW_STATE.ready);
  assert.doesNotMatch(view.textContent, /ready for an executive decision/);
  assert.match(byClass(view, "sac-decision")[0].textContent, /Reconcile the mismatched evidence/);
  assert.match(byClass(view, "sac-caveat")[0].textContent, /currency_mismatch/);
  assert.equal(byClass(view, "sac-headline")[0].dataset.state, "demo");
});

// The shipped demonstration is what every visitor with nothing open sees. A
// drifted date, scope, or unit in it degrades that first screen to "not ready"
// with no other test failing, so assert the state it is meant to demonstrate.
test("the bundled demonstration demonstrates a ready review", () => {
  const review = demoRecurringReviewReadiness();
  assert.equal(review.state, REVIEW_STATE.ready);
  assert.equal(review.ready, true);
  assert.deepEqual(review.evidence.gaps, []);
  assert.equal(review.metrics.benchmarkDirection, 90000);
  assert.equal(byClass(renderRecurringReviewReadiness(review), "sac-headline")[0].dataset.state,
    "verified");
});

// The branch a reader actually reaches by opening files: the entry point calls
// the model with no arguments on purpose, so the refusal it paints has to name
// what is missing rather than render an empty list.
test("the imported entry point paints a named refusal, not a blank one", () => {
  const view = renderRecurringReviewReadiness(recurringReviewReadiness(),
    { source: "imported" });
  assert.equal(view.dataset.source, "imported");
  assert.equal(view.dataset.reviewState, REVIEW_STATE.first);
  assert.match(byClass(view, "sac-caveat")[0].textContent,
    /Recommendation withheld.*current_import_missing/);
  assert.match(byClass(view, "sac-decision")[0].textContent, /baseline/);
});

test("the view shows one next action and discloses benchmark and prior result", () => {
  const review = recurringReviewReadiness({
    current: metric(900, "2026-07-31"),
    benchmark: metric(1000, "2026-06-30"),
    priorAction: {
      reviewPeriodEnd: "2026-05-31",
      baseline: metric(1200, "2026-05-31"),
      outcome: metric(1000, "2026-06-30"),
    },
    optimizationDirection: OPTIMIZATION_DIRECTION.minimize,
  });
  const view = renderRecurringReviewReadiness(review);
  assert.equal(tags(view, "H2")[0].textContent, "Is this month’s review ready to act on?");
  assert.equal(byClass(view, "sac-decision").length, 1);
  assert.equal(tags(view, "DETAILS").length, 1);
  assert.equal(tags(view, "SUMMARY")[0].textContent, "Review benchmark and prior result");
  assert.equal(tags(view, "DT").filter((node) => /Benchmark|Prior-action/.test(node.textContent)).length, 2);
});
