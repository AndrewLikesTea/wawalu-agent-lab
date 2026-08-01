import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildMonthlyReviewProjection, MONTHLY_REVIEW_INPUT_VERSION,
  MONTHLY_REVIEW_VERSION, validateMonthlyReviewInput, validateMonthlyReviewProjection,
} from "../src/monthly-review-projection.js";
import { renderMonthlyReviewProjection } from "../src/monthly-review-projection-view.js";
import { parseHtml, textOf } from "./support/browser.js";

const period = (month, recoverableScenarioMinor, overrides = {}) => Object.freeze({
  periodId: `user:${month}`,
  period: month,
  dataset: "user",
  briefingContractVersion: "finops-briefing/1.0.0",
  derivedAt: `${month}-28T12:00:00.000Z`,
  sourceFingerprint: `syn-${month}`,
  analyzedSpendMinor: 1_000_000,
  attributedSpendMinor: 960_000,
  recoverableScenarioMinor,
  recordsTotal: 20,
  recordsAnalyzed: 20,
  coverageRatioPpm: 1_000_000,
  confidence: "high",
  missingInputs: Object.freeze([]),
  materialMetricId: "recoverable_scenario",
  materialMetricMinor: recoverableScenarioMinor,
  absenceReason: null,
  topDepartmentId: "syn-support",
  ...overrides,
});

const input = (latest, periods = [period("2026-05", 200_000), period("2026-06", 200_000)]) => ({
  schemaVersion: MONTHLY_REVIEW_INPUT_VERSION,
  retainedPeriods: [...periods, latest],
});

test("material improvement projects prior-commitment verification and one ranked action", () => {
  const review = buildMonthlyReviewProjection(input(period("2026-07", 150_000)));
  assert.equal(review.schemaVersion, MONTHLY_REVIEW_VERSION);
  assert.equal(review.status, "improving");
  assert.deepEqual(review.materialBenchmark, {
    status: "improving", material: true, currentSharePpm: 150_000,
    baselineSharePpm: 200_000, changeSharePpm: -50_000, thresholdPpm: 10_000, reason: null,
  });
  assert.equal(review.strongestDepartmentContributor.departmentId, "syn-support");
  assert.equal(review.priorCommitmentVerification.status, "candidate_supported");
  assert.equal(review.confidence.level, "high");
  assert.equal(review.nextAction.rank, 1);
  assert.equal(review.nextAction.id, "verify_prior_commitment");
  assert.equal(validateMonthlyReviewProjection(review).valid, true);
});

test("material worsening produces one corrective action without claiming commitment success", () => {
  const review = buildMonthlyReviewProjection(input(period("2026-07", 260_000)));
  assert.equal(review.status, "worsening");
  assert.equal(review.materialBenchmark.changeSharePpm, 60_000);
  assert.equal(review.priorCommitmentVerification.status, "not_supported");
  assert.equal(review.nextAction.id, "revise_ranked_department_action");
  assert.deepEqual(Object.keys(review).filter((key) => key === "nextAction"), ["nextAction"]);
});

test("missing comparison evidence stays explicit and ranks collection first", () => {
  const review = buildMonthlyReviewProjection(input(period("2026-07", 150_000), []));
  assert.equal(review.status, "missing_comparison_evidence");
  assert.equal(review.materialBenchmark.status, "unavailable");
  assert.equal(review.materialBenchmark.material, null);
  assert.equal(review.strongestDepartmentContributor, null);
  assert.equal(review.priorCommitmentVerification.status, "not_verifiable");
  assert.equal(review.confidence.level, "insufficient");
  assert.equal(review.nextAction.id, "retain_comparable_period");
  assert.equal(validateMonthlyReviewProjection(review).valid, true);
});

test("input is closed and output validation rejects contradictory direction", () => {
  const bad = input(period("2026-07", 150_000, { prompt: "must not cross boundary" }));
  const checked = validateMonthlyReviewInput(bad);
  assert.equal(checked.valid, false);
  assert.match(checked.errors.join(" "), /prompt: undeclared field/);
  const review = structuredClone(buildMonthlyReviewProjection(input(period("2026-07", 150_000))));
  review.materialBenchmark.changeSharePpm = 1;
  assert.equal(validateMonthlyReviewProjection(review).valid, false);
});

test("the shipped evolution surface renders the validated projection contract", async () => {
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const doc = parseHtml(html);
  const review = buildMonthlyReviewProjection(input(period("2026-07", 150_000)));
  const root = renderMonthlyReviewProjection(doc, review);
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.state, "improving");
  assert.match(textOf(root), /15\.0% current recoverable share vs 20\.0% baseline/);
  assert.match(textOf(root), /Strongest department contributor: syn-support/);
  assert.match(textOf(root), /Prior commitment verification: candidate_supported/);
  assert.match(textOf(root), /Next action · rank 1/);
  assert.match(textOf(root), new RegExp(MONTHLY_REVIEW_VERSION.replaceAll(".", "\\.")));
  assert.equal(root.querySelectorAll(".monthly-review-projection-action").length, 1);
});
