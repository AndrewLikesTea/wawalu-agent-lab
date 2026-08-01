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

test("roundOne is one-decimal half-away-from-zero, including negative half-ties", () => {
  assert.equal(roundOne(10.05), 10.1);
  assert.equal(roundOne(-10.05), -10.1);
  assert.equal(roundOne(2.04), 2);
  assert.equal(roundOne(-2.04), -2);
  assert.equal(roundOne(0.05), 0.1);
  assert.equal(roundOne(-0.05), -0.1);
});

test("metric contracts fix the population, formula, rounding, and exclusions", () => {
  assert.match(MONTHLY_FINOPS_METRIC_CONTRACTS.spendChange.formula, /currentPeriod\.spendMinor - priorPeriod\.spendMinor/);
  assert.match(MONTHLY_FINOPS_METRIC_CONTRACTS.spendChange.rounding, /half-ties away from zero/);
  assert.match(MONTHLY_FINOPS_METRIC_CONTRACTS.priorCommitment.formula, /observedReductionTenthsPercent >= targetReductionTenthsPercent/);
  assert.match(MONTHLY_FINOPS_METRIC_CONTRACTS.confidence.population, /present in both periods/);
  assert.match(MONTHLY_FINOPS_METRIC_CONTRACTS.provenance.excluded, /Credentials/);
  assert.match(MONTHLY_FINOPS_METRIC_CONTRACTS.nextAction.formula, /sole candidate/);
});

test("fixture deterministically answers the headline, commitment, confidence, and one action", async () => {
  const review = buildMonthlyFinopsReview(await fixture());
  assert.equal(review.schemaVersion, MONTHLY_FINOPS_REVIEW_VERSION);
  assert.equal(review.finding.changeMinor, -1_290_600);
  assert.equal(review.finding.changePercent, -10.1);
  assert.match(review.finding.statement, /fell 10\.1%; the prior commitment met/);
  assert.equal(review.commitment.status, "verified");
  assert.equal(review.confidence.coveragePercent, 95);
  assert.deepEqual(review.nextAction, {
    rank: 1,
    id: "extend-platform-routing",
    statement: "Extend the verified Platform routing policy to Support for the August review.",
    evidence: "The prior scoped reduction cleared its target with comparable coverage above the confidence threshold.",
  });
});

test("the existing evolution workspace exposes and renders the fixture preview", async () => {
  const html = await read("src/evolution.html");
  const page = await read("src/evolution-page.js");
  const doc = parseHtml(html);
  const root = renderMonthlyFinopsReview(doc, buildMonthlyFinopsReview(await fixture()));
  const entry = doc.getElementById("monthly-review-preview-entry");
  assert.equal(entry.tagName, "BUTTON");
  assert.equal(textOf(entry), "Preview monthly FinOps review");
  assert.match(page, /monthly-finops-review-fixture\.json/);
  assert.match(textOf(root.querySelector(".monthly-review-benchmark")), /Spend fell 10\.1%/);
  assert.equal(root.querySelectorAll(".monthly-review-projection-action").length, 1);
  assert.deepEqual(root.querySelectorAll("h2,h3").map(textOf), [
    "What changed this month, and what should we do next?",
    "Primary finding",
    "What should we do next? · priority 1",
  ]);
  assert.match(textOf(root.querySelector("details")), /Did the prior commitment hold\?/);
  assert.match(textOf(root.querySelector("details")), /Spend-change definition/);
});
