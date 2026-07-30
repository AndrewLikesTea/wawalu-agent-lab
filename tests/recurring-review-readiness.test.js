import assert from "node:assert/strict";
import test from "node:test";
import { byClass, installDocument, tags } from "./support/dom.js";
import {
  CONFIDENCE_POLICY,
  OPTIMIZATION_DIRECTION,
  REVIEW_CONFIDENCE,
  REVIEW_STATE,
  REVIEW_VERDICT,
  demoRecurringReviewReadiness,
  recurringReviewReadiness,
} from "../src/recurring-review-readiness.js";
import {
  RECURRING_REVIEW_REFUSAL_FIXTURES,
  RECURRING_REVIEW_VERDICT_FIXTURES,
  REFUSAL_MARKER,
} from "../src/recurring-review-verdict-fixtures.js";
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
  sample: { observed: 30, eligible: 30 },
  ...overrides,
});

test("the labelled adjudication set covers every required verdict and evidence boundary", () => {
  assert.deepEqual(RECURRING_REVIEW_VERDICT_FIXTURES.map((item) => item.fixtureId), [
    "comparable-improvement",
    "comparable-regression",
    "incomparable-periods",
    "missing-prior-evidence",
  ]);
  for (const fixture of RECURRING_REVIEW_VERDICT_FIXTURES) {
    const result = recurringReviewReadiness(fixture.input).verdict;
    assert.equal(result.verdict, fixture.expected.verdict, fixture.fixtureId);
    assert.equal(result.confidence, fixture.expected.confidence, fixture.fixtureId);
    for (const [boundary, expected] of Object.entries(fixture.expected.boundaries)) {
      assert.equal(result.evidenceBoundaries[boundary], expected,
        `${fixture.fixtureId}:${boundary}`);
    }
    assert.ok(result.permittedWording.includes(fixture.expected.permittedWording),
      `${fixture.fixtureId}: permitted wording`);
    assert.equal(result.statement, fixture.expected.permittedWording, fixture.fixtureId);
    assert.equal(result.causalClaimPermitted, false, fixture.fixtureId);
  }
  assert.deepEqual(new Set(RECURRING_REVIEW_VERDICT_FIXTURES.map(
    (item) => item.expected.verdict,
  )), new Set(Object.values(REVIEW_VERDICT)));
});

test("identical local inputs produce byte-identical verdicts", () => {
  for (const fixture of RECURRING_REVIEW_VERDICT_FIXTURES) {
    const first = recurringReviewReadiness(structuredClone(fixture.input)).verdict;
    const second = recurringReviewReadiness(structuredClone(fixture.input)).verdict;
    assert.equal(JSON.stringify(first), JSON.stringify(second), fixture.fixtureId);
  }
});

test("confidence weights and thresholds are complete, named, and explainable", () => {
  assert.equal(Object.values(CONFIDENCE_POLICY.weights).reduce((sum, value) => sum + value, 0), 1);
  assert.equal(CONFIDENCE_POLICY.assumptions.length,
    Object.keys(CONFIDENCE_POLICY.weights).length + 1);
  assert.ok(CONFIDENCE_POLICY.thresholds.high > CONFIDENCE_POLICY.thresholds.moderate);
});

test("missing comparability, sampling, or baseline cannot emit causal-success wording", () => {
  const unsafe = /\b(caused|because of|resulted in|delivered savings|successful action)\b/i;
  const cases = [
    recurringReviewReadiness(RECURRING_REVIEW_VERDICT_FIXTURES[2].input).verdict,
    recurringReviewReadiness({
      ...RECURRING_REVIEW_VERDICT_FIXTURES[0].input,
      current: metric(900, "2026-07-31", { sample: { observed: 29, eligible: 30 } }),
    }).verdict,
    recurringReviewReadiness(RECURRING_REVIEW_VERDICT_FIXTURES[3].input).verdict,
  ];
  assert.deepEqual(cases.map((result) => result.confidence), [
    REVIEW_CONFIDENCE.insufficient,
    REVIEW_CONFIDENCE.insufficient,
    REVIEW_CONFIDENCE.moderate,
  ]);
  for (const result of cases) {
    assert.equal(result.causalClaimPermitted, false);
    assert.doesNotMatch([result.statement, ...result.permittedWording].join(" "), unsafe);
  }
  const incomplete = recurringReviewReadiness({
    ...RECURRING_REVIEW_VERDICT_FIXTURES[0].input,
    current: metric(900, "2026-07-31", { sample: { observed: 29, eligible: 30 } }),
  });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.recommendation, null);
  assert.ok(incomplete.evidence.gaps.includes("complete_sampling_missing"));
});

test("untrusted prompt-like fields never cross the verdict evidence boundary", () => {
  const marker = "UNTRUSTED_PROMPT_DO_NOT_REPEAT";
  const input = structuredClone(RECURRING_REVIEW_VERDICT_FIXTURES[0].input);
  input.current.prompt = marker;
  input.priorAction.outcome.judgeInstructions = marker;
  // Unknown keys are the easy half. The period boundaries are the hard half:
  // they are the only imported strings the verdict quotes back, so the same
  // marker has to be refused when it arrives inside one of them.
  input.benchmark.periodEnd = `2026-06-30 ${marker}`;
  const serialized = JSON.stringify(recurringReviewReadiness(input).verdict);
  assert.doesNotMatch(serialized, new RegExp(marker));
  assert.ok(JSON.parse(serialized).evidenceBoundaries.excluded.includes("prompt content"));
});

// Every one of these reached "ready", "improvement", and "high confidence"
// before the boundaries were validated, because a string that is not a day
// still compares against other strings. A hostile export needs no unknown key
// to do it — just a plausible-looking date in a field the surface prints.
test("a period boundary that is not a real calendar day is refused, not parsed", () => {
  assert.deepEqual(RECURRING_REVIEW_REFUSAL_FIXTURES.map((item) => item.fixtureId), [
    "day-that-does-not-exist",
    "timestamp-sorts-past-its-own-day",
    "prose-in-a-period-boundary",
    "benchmark-is-not-the-earlier-period",
  ]);
  for (const fixture of RECURRING_REVIEW_REFUSAL_FIXTURES) {
    const review = recurringReviewReadiness(structuredClone(fixture.input));
    assert.equal(review.ready, false, fixture.fixtureId);
    assert.equal(review.recommendation, null, fixture.fixtureId);
    assert.equal(review.verdict.verdict, REVIEW_VERDICT.incomparable, fixture.fixtureId);
    assert.equal(review.verdict.confidence, REVIEW_CONFIDENCE.insufficient, fixture.fixtureId);
    assert.ok(review.evidence.gaps.includes(fixture.expected.gap),
      `${fixture.fixtureId}: ${review.evidence.gaps.join(",")}`);
    if (fixture.expected.absentBoundary) {
      assert.equal(review.verdict.evidenceBoundaries[fixture.expected.absentBoundary], null,
        fixture.fixtureId);
    }
    // Nothing that failed the calendar rule survives anywhere in the verdict.
    assert.doesNotMatch(JSON.stringify(review.verdict), new RegExp(REFUSAL_MARKER));
    // The reader is told which evidence was refused, in the surface's own words.
    const view = renderRecurringReviewReadiness(review, { source: "imported" });
    assert.match(byClass(view, "sac-caveat")[0].textContent,
      new RegExp(`Recommendation withheld.*${fixture.expected.gap}`), fixture.fixtureId);
    assert.doesNotMatch(view.textContent, new RegExp(REFUSAL_MARKER), fixture.fixtureId);
  }
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
  assert.match(view.textContent, /Recurring-review verdict/);
  assert.match(view.textContent, /Permitted conclusion/);
  assert.match(view.textContent, /Evidence boundary/);
  assert.match(view.textContent, /confidence weights comparability 0.5, sampling 0.3, baseline 0.2/);
});
