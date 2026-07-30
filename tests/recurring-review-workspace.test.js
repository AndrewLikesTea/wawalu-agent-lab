import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { parseHtml, textOf } from "./support/browser.js";
import { assembleRecurringReview } from "../src/recurring-review-readiness.js";
import { renderRecurringReviewWorkspace } from "../src/recurring-review-workspace-view.js";

// The rendered surface is held to the same prohibition the fixtures declare: the
// wording constants being clean does not prove the painted paragraph is, because
// the view concatenates the verdict with its own finding text.
const CAUSAL_SUCCESS = new RegExp(JSON.parse(readFileSync(
  new URL("../src/recurring-review-verdict-fixtures.json", import.meta.url), "utf8"),
).metadata.prohibitedWordingPattern, "i");

const action = Object.freeze({
  schemaVersion: "monthly-department-action/1.0.0",
  decisionVersion: "monthly-department-decision/1.0.0",
  actionId: "route-support",
  actionLabel: "Route support summaries to the efficient model",
  department: "Support",
  ownerLabel: "FinOps lead",
  baseline: {
    value: 1000, unit: "USD/month", period: "2026-06",
    aggregation: "monthly", calculation: "Recoverable spend for Support",
  },
  target: {
    value: 700, unit: "USD/month", deadline: "2026-08-31",
    calculation: "Monthly recoverable spend at or below 700 USD",
  },
  reviewPeriod: "2026-07",
  confidence: "high",
  provenanceReferences: ["analysis:2026-06", "decision:route-support"],
  committedAt: "2026-07-01T12:00:00.000Z",
});

const analysis = (period = "2026-07") => ({
  schemaVersion: "local-finops-analysis/1.0.0",
  period,
  rankedDepartments: [{ name: "Support", recoverableUsd: 760 }],
});

const verdict = (overrides = {}) => ({
  state: "all_clear",
  measured: true,
  coveragePercent: 96,
  rows: 24,
  confidence: "high",
  ...overrides,
});

function page() {
  return parseHtml(`<main><section id="guided-result">
    <section id="recurring-review-workspace" hidden></section>
    <h2 id="guided-result-question">What should we do now?</h2>
  </section></main>`);
}

test("a ready review leads with one metric and completes without changing retained evidence", () => {
  const document = page();
  const review = assembleRecurringReview({
    retainedAction: action,
    currentAnalysis: analysis(),
    theoVerdict: verdict(),
  });

  const root = renderRecurringReviewWorkspace(document, review, action);
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.state, "ready");
  assert.equal(root.querySelector("h2").textContent, "Is this month’s review ready to act on?");

  const visibleText = textOf(root);
  assert.match(visibleText, /\$760\.00 vs \$1,000\.00/);
  assert.match(visibleText, /Recoverable spend is \$240\.00 lower/);
  assert.match(visibleText, /high verdict confidence · 96\.0% attribution coverage/);
  assert.match(visibleText, /local-finops-analysis\/1\.0\.0 · Theo verdict: all_clear/);
  assert.match(visibleText, /Continue the tracked action and review it again next month/);
  assert.equal(root.querySelectorAll("details").length, 4,
    "prior outcome, limits, evidence, and verdict metadata stay progressively disclosed");
  const verdictDetails = root.querySelectorAll("details")[3];
  assert.match(textOf(verdictDetails), /improvement/);
  assert.match(textOf(verdictDetails), /minimum_sample_met/);
  assert.match(textOf(verdictDetails), /causal attribution/);
  assert.match(textOf(verdictDetails), /Confidence describes evidence completeness/);
  assert.doesNotMatch(visibleText, CAUSAL_SUCCESS);

  const button = root.querySelector("button");
  button.focus();
  assert.equal(document.activeElement, button, "the completion action is keyboard focusable");
  button.click();
  assert.equal(root.dataset.completed, "true");
  assert.equal(button.disabled, true);
  assert.match(textOf(root.querySelector("[role=status]")), /retained action and evidence were not changed/);
  assert.equal(action.baseline.value, 1000);
  assert.equal(review.current.value, 760);
});

test("an unchanged review survives the repaints a late bundle fetch triggers", () => {
  const document = page();
  const inputs = { retainedAction: action, currentAnalysis: analysis(), theoVerdict: verdict() };
  const root = renderRecurringReviewWorkspace(document, assembleRecurringReview(inputs), action);
  const details = root.querySelector("details");
  details.open = true;
  root.querySelector("button").focus();
  root.querySelector("button").click();

  // The same review, reassembled — every panel sync does this, and two bundle
  // fetches resolve after first paint, so it happens mid-interaction.
  renderRecurringReviewWorkspace(document, assembleRecurringReview(inputs), action);
  assert.equal(root.dataset.completed, "true", "completing the review is not undone by a repaint");
  assert.equal(root.querySelector("details").open, true, "an opened disclosure stays open");
  assert.equal(document.activeElement, root.querySelector("button"), "keyboard focus is not dropped");

  // A later period is a different review, so it does repaint and does not
  // arrive pre-completed.
  renderRecurringReviewWorkspace(document,
    assembleRecurringReview({ ...inputs, currentAnalysis: analysis("2026-08") }), action);
  assert.equal(root.dataset.completed, "false");
  assert.equal(root.querySelector("button").disabled, false);
});

test("a blocked review explains the unavailable comparison and gives one recovery action", () => {
  const document = page();
  const review = assembleRecurringReview({
    retainedAction: action,
    currentAnalysis: analysis("2026-06"),
    theoVerdict: verdict(),
  });

  const root = renderRecurringReviewWorkspace(document, review, action);
  assert.equal(root.dataset.state, "blocked");
  assert.match(textOf(root), /Current \$760\.00 · baseline \$1,000\.00 · not comparable/i);
  assert.match(textOf(root), /not from a later comparable period/i);
  assert.match(textOf(root), /Analyze a period later than the retained benchmark/);
  assert.equal(root.querySelectorAll("button").length, 0,
    "a blocked review does not offer a completion action");
  assert.equal(root.querySelectorAll(".recurring-review-action").length, 1,
    "the blocked state does not become an equal-weight action wall");
  assert.match(textOf(root.querySelectorAll("details")[1]), /later_period_missing/);
  assert.match(textOf(root.querySelectorAll("details")[3]), /incomparable/);
  assert.doesNotMatch(textOf(root), CAUSAL_SUCCESS);
});

test("no retained action leaves the established guided result unchanged", () => {
  const document = page();
  const root = document.getElementById("recurring-review-workspace");
  renderRecurringReviewWorkspace(document, assembleRecurringReview(), null);
  assert.equal(root.hidden, true);
  assert.equal(root.children.length, 0);
  assert.equal(document.getElementById("guided-result-question").textContent, "What should we do now?");
});
