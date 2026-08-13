import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml, textOf } from "./support/browser.js";
import {
  CONFIDENCE_RULE, EVIDENCE_CATEGORIES, analysisReadinessForDataset, evidenceConfidence, evidenceHeld,
  readinessScore,
} from "../src/finops-analysis-readiness.js";
import { bundledFirstAction } from "../src/finops-bundled-next-step.js";
import { renderAnalysisReadiness } from "../src/finops-analysis-readiness-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));

test("readiness and confidence are computed from the categories the dataset carries", () => {
  assert.equal(EVIDENCE_CATEGORIES.reduce((sum, item) => sum + item.weight, 0), 100,
    "the published confidence rule states the weights sum to 100");
  const held = evidenceHeld(DATA);
  assert.deepEqual(held.map((item) => [item.id, item.present, item.sufficient]), [
    ["usage_cost", true, true], ["workload_classification", true, true],
    ["applicable_pricing", true, false], ["observed_validation", false, false],
  ]);
  assert.equal(readinessScore(held).value, 50, "2 of 4 categories are sufficient");
  assert.equal(evidenceConfidence(held).value, 63,
    "35×1 + 30×.75 + 20×.25 + absent×0 = 62.5, rounded half up");
  assert.match(CONFIDENCE_RULE, /usage\/cost 1\.00/);
});

// The benchmark's whole claim is that it read the evidence. A model that scores
// a dataset it was never given, or promises a recommendation it has not got,
// answers the reader's question with a decoration.
test("an empty dataset scores zero and withholds the recommendation it cannot make", () => {
  const empty = analysisReadinessForDataset({});
  assert.equal(empty.score.value, 0);
  assert.equal(empty.confidence.value, 0);
  assert.equal(empty.level, "insufficient");
  assert.equal(empty.recommendation, null);
  assert.match(empty.supportedConclusion, /^No savings recommendation is supported/);
  assert.match(empty.currentEvidence, /^0 of 4 required categories are sufficient: none\./);
  assert.equal(empty.upgrades.length, 4, "every unmet category is offered as an upgrade");
  const partial = analysisReadinessForDataset({ departments: [{ spendUsd: 10, queries: 5 }] });
  assert.equal(partial.score.value, 25);
  assert.equal(partial.confidence.value, 40, "35×1 + 20×.25, classification absent");
});

// #1020: one page, one prioritized action. This region must quote the record
// the rest of the page already paints, not re-rank the same table beside it.
test("the readiness answer quotes the page's one derived next-step record", () => {
  const result = analysisReadinessForDataset(DATA);
  const step = bundledFirstAction(DATA);
  assert.equal(result.version, "finops-analysis-readiness/2.0.0");
  assert.equal(result.level, "illustrative_only");
  assert.match(result.supportedConclusion, /no for an organization-specific/);
  assert.equal(result.recommendation.id, step.actionId);
  assert.equal(result.recommendation.department, step.department);
  assert.equal(result.recommendation.figure.text, step.figure.text);
  assert.equal(result.recommendation.confidence, 74, "the same action's own fixture confidence");
  assert.match(result.recommendation.provenance, /Bundled synthetic client-side data/);
  assert.deepEqual(result.upgrades.map((item) => item.category), [
    "Organization-applicable contracted pricing", "Observed post-change usage and cost",
  ]);
});

test("the active analysis surface answers readiness and makes the one action inspectable", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const result = analysisReadinessForDataset(DATA);
  renderAnalysisReadiness(document, result);
  const region = document.getElementById("finops-recoverable-how-we-know");
  assert.equal(region.tagName, "DETAILS");
  assert.equal(region.querySelectorAll("#analysis-readiness-action").length, 1);
  assert.match(textOf(document.getElementById("analysis-readiness-benchmark")), /50\/100 · 2 of 4/);
  assert.match(textOf(document.getElementById("analysis-readiness-action")),
    new RegExp(result.recommendation.department));
  assert.match(textOf(document.getElementById("analysis-readiness-value")),
    new RegExp(result.recommendation.figure.text.replace("$", "\\$")));
  assert.match(textOf(document.getElementById("analysis-readiness-action-confidence")), /74\/100/);
  assert.match(textOf(document.getElementById("analysis-readiness-provenance")),
    new RegExp(result.recommendation.id));
  const upgrades = document.getElementById("analysis-readiness-upgrades").querySelectorAll("li");
  assert.equal(upgrades.length, 2);
  for (const row of upgrades) {
    assert.match(textOf(row), /reduces/);
    assert.match(textOf(row), /enables/);
  }
  // Counts, not identity: asserting an element is null makes a failing run hang
  // on inspecting the parsed page instead of reporting the regression.
  assert.equal(region.querySelectorAll("input").length, 0);
  assert.equal(region.querySelectorAll("button").length, 0);
});
