import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildMonthlyReviewProjection, MONTHLY_REVIEW_INPUT_VERSION,
  MONTHLY_REVIEW_VERSION, validateMonthlyReviewInput, validateMonthlyReviewProjection,
} from "../src/monthly-review-projection.js";
import { renderMonthlyReviewProjection } from "../src/monthly-review-projection-view.js";
import { parseHtml, pressEnter, pressSpace, tabSequence, textOf } from "./support/browser.js";

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

const commitment = (month = "2026-06", savings = 200_000, overrides = {}) => ({
  schemaVersion: "shiplog-finops-commitment/1.0.0",
  commitmentId: `commit-${month}`,
  claim: { baselineMonthlyCostMinor: 1_000_000, monthlySavingsMinor: savings, period: month },
  confidence: { percent: 90, band: "high" },
  provenance: { designation: "import", analysisPeriod: month, recordCount: 20 },
  recommendedAction: {}, recordedAt: `${month}-28T13:00:00.000Z`, status: "recorded",
  decisionId: null, periodId: `user:${month}`, ...overrides,
});

const input = (latest, periods = [period("2026-05", 200_000), period("2026-06", 200_000)], commitments = [commitment()]) => ({
  schemaVersion: MONTHLY_REVIEW_INPUT_VERSION,
  retainedPeriods: [...periods, latest],
  retainedCommitments: commitments,
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
  assert.equal(Object.hasOwn(review.comparison, "nextAction"), false,
    "the output must not duplicate its single prioritized action");
  assert.equal(review.nextAction.id, "revise_missed_commitment");
  assert.equal(validateMonthlyReviewProjection(review).valid, true);
});

test("material worsening produces one corrective action without claiming commitment success", () => {
  const review = buildMonthlyReviewProjection(input(period("2026-07", 260_000)));
  assert.equal(review.status, "worsening");
  assert.equal(review.materialBenchmark.changeSharePpm, 60_000);
  assert.equal(review.priorCommitmentVerification.status, "not_supported");
  assert.equal(review.nextAction.id, "revise_missed_commitment");
  assert.equal(Object.hasOwn(review.comparison, "nextAction"), false);
});

test("missing comparison evidence stays explicit and ranks collection first", () => {
  const review = buildMonthlyReviewProjection(input(period("2026-07", 150_000), []));
  assert.equal(review.status, "missing_comparison_evidence");
  assert.equal(review.materialBenchmark.status, "unavailable");
  assert.equal(review.materialBenchmark.material, null);
  assert.equal(review.strongestDepartmentContributor, null);
  assert.equal(review.priorCommitmentVerification.status, "not_verifiable");
  assert.equal(review.confidence.level, "insufficient");
  assert.equal(review.nextAction.id, "retain_prior_period");
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
  assert.match(textOf(root), /Current recoverable share · 15\.0%\. Baseline · 20\.0%/);
  assert.match(textOf(root), /Department evidencesyn-support/);
  assert.match(textOf(root), /Prior commitmentcandidate_supported/);
  assert.match(textOf(root), /Next action · priority 1/);
  assert.match(textOf(root), new RegExp(MONTHLY_REVIEW_VERSION.replaceAll(".", "\\.")));
  assert.equal(root.querySelectorAll(".monthly-review-projection-action").length, 1);
});

test("monthly decision orders its heading, finding, benchmark, action, and evidence", async () => {
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const doc = parseHtml(html);
  const root = renderMonthlyReviewProjection(doc, buildMonthlyReviewProjection(input(period("2026-07", 260_000))));
  const headings = root.querySelectorAll("h2,h3").map((node) => `${node.tagName}:${textOf(node)}`);
  assert.deepEqual(headings, [
    "H2:What changed this month, and what should we do next?",
    "H3:Headline finding",
    "H3:Next action · priority 1",
  ]);
  assert.match(textOf(root.querySelector(".monthly-review-status")), /▲ Worsening/);
  const action = root.querySelector(".monthly-review-projection-action");
  assert.match(textOf(action), /Revise the missed commitment/);
  const link = root.querySelector(".monthly-review-department-link");
  assert.equal(textOf(link), "Review syn-support department evidence");
  assert.equal(link.href, "#department-decision-panel");
});

test("evidence disclosure is named, keyboard operable, stateful, and announced", async () => {
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const doc = parseHtml(html);
  const root = renderMonthlyReviewProjection(doc, buildMonthlyReviewProjection(input(period("2026-07", 150_000))));
  root.hidden = false;
  const details = root.querySelector("details");
  const summary = root.querySelector("summary");
  const live = root.querySelector('[aria-live="polite"]');
  assert.equal(textOf(summary), "Trend, department, commitment, confidence, and provenance");
  assert.equal(summary.getAttribute("aria-controls"), "monthly-review-provenance-content");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.ok(tabSequence(doc).includes(summary));

  // The five deferred details are terms and values, so they ship inside a real
  // `dl`. Loose `dt`/`dd` in a `div` is invalid markup that no browser exposes
  // as a term/value pair, and it is what this disclosure had after the facts
  // moved behind it. The boundary sentence is prose about the whole set, so it
  // is the one thing outside the list.
  const facts = details.querySelector("dl.monthly-review-evidence");
  assert.ok(facts, "the deferred details are not a description list");
  assert.deepEqual([...facts.querySelectorAll("dt")].map(textOf),
    ["Trend", "Department evidence", "Prior commitment", "Confidence", "Savings scoring", "Comparison provenance", "Source", "Periods"]);
  assert.equal(facts.querySelectorAll("dd").length, 8);
  for (const orphan of details.querySelectorAll("dt")) {
    assert.equal(orphan.closest("dl"), facts, "a term ships outside the description list");
  }
  assert.equal(details.querySelector(".monthly-review-boundary").closest("dl"), null);

  summary.focus();
  pressEnter(doc);
  assert.equal(doc.activeElement, summary);
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.equal(details.dataset.disclosure, "expanded");
  assert.match(textOf(live), /expanded/);
  pressSpace(doc);
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(details.dataset.disclosure, "collapsed");
  assert.match(textOf(live), /collapsed/);
});

test("leading department evidence has a keyboard-operable return to the review heading", async () => {
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const doc = parseHtml(html);
  const root = renderMonthlyReviewProjection(doc,
    buildMonthlyReviewProjection(input(period("2026-07", 260_000))));
  const link = root.querySelector(".monthly-review-department-link");
  link.focus();
  pressEnter(doc);
  const back = doc.getElementById("monthly-review-return");
  assert.ok(back, "opening department evidence did not expose a return path");
  assert.equal(back.getAttribute("href"), "#monthly-review-projection-title");
  assert.ok(tabSequence(doc).includes(back));
  assert.equal(root.querySelector("h2").getAttribute("tabindex"), "-1");
});

test("loading, empty, error, and implausible extremes withhold unsupported decisions", async () => {
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const draw = (review) => {
    const doc = parseHtml(html);
    return renderMonthlyReviewProjection(doc, review);
  };
  const loading = draw(null);
  assert.equal(loading.dataset.state, "loading");
  assert.equal(loading.getAttribute("aria-busy"), "true");
  assert.match(textOf(loading), /◌ Loading/);

  const empty = draw(buildMonthlyReviewProjection(input(period("2026-07", 150_000), [])));
  assert.equal(empty.dataset.state, "empty");
  assert.match(textOf(empty), /○ Empty/);
  assert.equal(empty.querySelector(".monthly-review-projection-action"), null);

  const invalid = structuredClone(buildMonthlyReviewProjection(input(period("2026-07", 150_000))));
  invalid.nextAction.rank = 2;
  const error = draw(invalid);
  assert.equal(error.dataset.state, "error");
  assert.match(textOf(error), /× Error/);

  const extreme = structuredClone(buildMonthlyReviewProjection(input(period("2026-07", 150_000))));
  extreme.materialBenchmark.currentSharePpm = 1_200_000;
  extreme.materialBenchmark.changeSharePpm = 1_000_000;
  extreme.materialBenchmark.status = "worsening";
  const implausible = draw(extreme);
  assert.equal(implausible.dataset.state, "implausible_extreme");
  assert.match(textOf(implausible), /outside 0%–100%/);
  assert.equal(implausible.querySelector(".monthly-review-projection-action"), null);
});
