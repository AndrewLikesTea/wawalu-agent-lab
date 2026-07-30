import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_EVIDENCE_KEY,
  REVIEW_EVIDENCE_VERSION,
  REVIEW_READINESS_VERSION,
  REVIEW_STATE,
  assembleRecurringReview,
  readCurrentReviewEvidence,
  retainCurrentReviewEvidence,
} from "../src/recurring-review-readiness.js";
import { MONTHLY_ACTION_VERSION } from "../src/monthly-department-action-store.js";
import { loadPage } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const retainedAction = {
  schemaVersion: MONTHLY_ACTION_VERSION,
  decisionVersion: "monthly-department-decision/1.0.0",
  actionId: "route-short-lookups",
  actionLabel: "Route short lookups",
  department: "Atlas Platform",
  ownerLabel: "AI Platform product owner",
  baseline: {
    value: 1200, unit: "USD/month", period: "2026-06",
    aggregation: "Monthly eligible recoverable spend",
    calculation: "Sum eligible row deltas",
  },
  target: {
    value: 0, unit: "USD/month remaining avoidable spend",
    deadline: "2026-07-31", calculation: "baseline minus verified reduction",
  },
  reviewPeriod: "2026-07",
  confidence: "high",
  provenanceReferences: ["fix-pack:1", "rubric:1"],
  committedAt: "2026-06-30T12:00:00.000Z",
};

const analysis = (overrides = {}) => ({
  schemaVersion: "local-finops/1.0.0",
  period: "2026-07-01 to 2026-08-01",
  rankedDepartments: [{ name: "Atlas Platform", recoverableUsd: 900 }],
  ...overrides,
});
const verdict = (overrides = {}) => ({
  state: "all_clear",
  headline: { available: true, coveragePercent: 100, totalRows: 12 },
  ...overrides,
});

test("a retained action resumes ready from a later analysis and Theo verdict", () => {
  const review = assembleRecurringReview({
    retainedAction, currentAnalysis: analysis(), theoVerdict: verdict(),
  });
  assert.equal(review.state, REVIEW_STATE.ready);
  assert.equal(review.recommendation.change, -300);
  assert.equal(review.benchmark.value, 1200);
  assert.equal(review.confidence.theo, "high");
  assert.equal(review.provenance.verdictRows, 12);
  assert.deepEqual(review.evidenceBoundary.gaps, []);
  // The contract the figure came from, not a placeholder standing in for it: a
  // finding defended with "local-finops-analysis" names no version at all.
  assert.equal(review.provenance.analysisContract, "local-finops/1.0.0");
  assert.equal(review.current.unit, review.benchmark.unit);
  assert.equal(review.verdict.verdict, "improvement");
  assert.equal(review.verdict.confidence.level, "high");
  assert.deepEqual(review.verdict.confidence.basis,
    ["attribution_coverage_at_least_95_percent", "minimum_sample_met"]);
});

test("a benchmark in another unit is blocked rather than differenced", () => {
  const review = assembleRecurringReview({
    retainedAction: {
      ...retainedAction,
      baseline: { ...retainedAction.baseline, unit: "USD/quarter" },
    },
    currentAnalysis: analysis(),
    theoVerdict: verdict(),
  });
  assert.equal(review.state, REVIEW_STATE.blocked);
  assert.equal(review.code, "metric_changed");
  assert.equal(review.recommendation, null);
  assert.deepEqual(review.evidenceBoundary.gaps, ["metric_unit_mismatch"]);
});

test("an absent retained action is explicitly blocked", () => {
  const review = assembleRecurringReview({
    currentAnalysis: analysis(), theoVerdict: verdict(),
  });
  assert.equal(review.state, REVIEW_STATE.blocked);
  assert.equal(review.code, "absent_action");
  assert.equal(review.recommendation, null);
});

test("a changed department scope is blocked", () => {
  const review = assembleRecurringReview({
    retainedAction,
    currentAnalysis: analysis({
      rankedDepartments: [{ name: "Security", recoverableUsd: 900 }],
    }),
    theoVerdict: verdict(),
  });
  assert.equal(review.code, "department_changed");
  assert.deepEqual(review.evidenceBoundary.gaps, ["department_scope_mismatch"]);
});

test("same and earlier periods are incomparable", () => {
  for (const period of ["2026-06-01 to 2026-07-01", "2026-05-01 to 2026-06-01"]) {
    const review = assembleRecurringReview({
      retainedAction, currentAnalysis: analysis({ period }), theoVerdict: verdict(),
    });
    assert.equal(review.code, "period_not_later", period);
    assert.equal(review.ready, false, period);
  }
});

test("missing and unmeasured Theo evidence are insufficient, not ready", () => {
  assert.equal(assembleRecurringReview({
    retainedAction, currentAnalysis: analysis(),
  }).state, REVIEW_STATE.insufficient);
  assert.equal(assembleRecurringReview({
    retainedAction,
    currentAnalysis: analysis(),
    theoVerdict: verdict({ state: "zero_spend", headline: { available: false } }),
  }).code, "verdict_insufficient");
});

test("the navigation handoff retains only bounded analysis and verdict facts", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const currentAnalysis = analysis({
    rankedDepartments: [{
      name: "Atlas Platform", recoverableUsd: 900, sourceRows: [{ prompt: "secret" }],
    }],
  });
  assert.equal(retainCurrentReviewEvidence(storage, {
    currentAnalysis, theoVerdict: verdict({ findings: [{ identifiers: ["customer"] }] }),
  }), true);
  const serialized = values.get(REVIEW_EVIDENCE_KEY);
  assert.doesNotMatch(serialized, /secret|customer|sourceRows|findings|Atlas Platform/);
  const restored = readCurrentReviewEvidence(storage);
  assert.equal(assembleRecurringReview({
    retainedAction, ...restored,
  }).state, REVIEW_STATE.ready);
  // The handoff payload is versioned separately from the result contract, so
  // rewording a headline cannot silently discard evidence already retained.
  assert.notEqual(REVIEW_EVIDENCE_VERSION, REVIEW_READINESS_VERSION);
  assert.equal(JSON.parse(serialized).schemaVersion, REVIEW_EVIDENCE_VERSION);
  values.set(REVIEW_EVIDENCE_KEY, JSON.stringify({
    ...JSON.parse(serialized), schemaVersion: "finops-current-review-evidence/9.0.0",
  }));
  assert.deepEqual(readCurrentReviewEvidence(storage),
    { currentAnalysis: null, theoVerdict: null });
});

test("the action-center entry passes retained action, current analysis, and Theo verdict", async () => {
  const evidence = {
    schemaVersion: REVIEW_EVIDENCE_VERSION,
    currentAnalysis: analysis(),
    theoVerdict: {
      state: "all_clear", measured: true, coveragePercent: 100, rows: 12, confidence: "high",
    },
  };
  const page = await loadPage(new URL("../src/savings-action-center.html", import.meta.url), {
    storage: {
      "shiplog.finops.monthly-department-action.v1": JSON.stringify(retainedAction),
      [REVIEW_EVIDENCE_KEY]: JSON.stringify(evidence),
    },
  });
  try {
    await importPageModule("/savings-action-center-page.js");
    await waitFor(() => page.document.querySelector(".sac-focus")?.dataset.reviewState === "ready",
      "ready recurring review");
    const focus = page.document.querySelector(".sac-focus");
    assert.equal(focus.dataset.source, "local");
    assert.match(focus.textContent, /ready for review/i);
    assert.match(focus.textContent, /100\.0%/);
    assert.match(focus.textContent, /Measured recoverable spend is lower than the prior baseline/);
    assert.match(focus.textContent, /attribution_coverage_at_least_95_percent/);
    assert.match(focus.textContent, /causal attribution/);
    assert.match(focus.textContent, /finops-recurring-verdict\/1\.0\.0/);
    assert.doesNotMatch(focus.textContent, /Demonstration data/);
  } finally {
    page.restore();
  }
});
