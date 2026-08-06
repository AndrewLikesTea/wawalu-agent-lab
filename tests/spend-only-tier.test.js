// Fixture → preflight → rendered region for a billing-only export (#1168).
//
// The fixture is a Cost and Usage Report in the shape the shipped Bedrock
// adapter already recognizes, with the cost-allocation column present and empty
// on every row. That is what a console emits when nobody has tagged the account
// yet — not a full-import fixture with fields deleted — so the export carries
// money and models and attributes none of it.

import assert from "node:assert/strict";
import test from "node:test";

import { adaptHyperscalerExport, HYPERSCALER_RESULT } from "../src/hyperscaler-export-adapters.js";
import { IMPORT_RECIPES, recipeForAdapter } from "../src/import-recipes.js";
import { EVIDENCE_PREFLIGHT_OUTCOME } from "../src/own-data-evidence-preflight.js";
import {
  projectProviderExport, providerExportPreflight,
} from "../src/provider-export-projection.js";
import { renderProviderExportProjection } from "../src/provider-export-projection-view.js";
import { renderOwnDataEvidencePreflight } from "../src/own-data-evidence-preflight-view.js";
import {
  MODEL_NOT_STATED, SPEND_ONLY_FIGURE, SPEND_ONLY_TIER, spendOnlyFigures,
} from "../src/spend-only-tier.js";
import { createElement } from "./support/dom.js";

const HEADER = "lineItem/UsageStartDate,product/model_id,lineItem/UsageAmount,"
  + "lineItem/UnblendedCost,lineItem/CurrencyCode,lineItem/UsageAccountId,product/region";

/** One CUR line. An empty account id is the ungrouped case, not a missing column. */
const line = ({ day = "2026-07-20", model = "anthropic.claude-sonnet", amount = 120000,
  cost = "4.80", account = "" }) =>
  `${day},${model},${amount},${cost},USD,${account},us-east-1`;

/**
 * Three days of charges, two models, nothing grouped. Three rows because the
 * recognition pass has a record floor of three and this test drives the shipped
 * recognizer rather than a stand-in for it.
 */
const UNGROUPED_PERIOD = Object.freeze([
  { day: "2026-07-20", model: "anthropic.claude-sonnet", cost: "4.80" },
  { day: "2026-07-21", model: "amazon.titan-text", cost: "0.90" },
  { day: "2026-07-22", model: "anthropic.claude-sonnet", cost: "3.92" },
]);

const billingOnlyExport = (rows) => ({
  text: [HEADER, ...rows.map(line)].join("\n"),
  fileName: "bedrock-usage.csv",
});

function project(rows) {
  const adapted = adaptHyperscalerExport(billingOnlyExport(rows));
  assert.equal(adapted.status, HYPERSCALER_RESULT.PROJECTED, adapted.message);
  const projection = projectProviderExport(adapted.document);
  assert.equal(projection.ok, true);
  return projection;
}

function pageDocument() {
  const nodes = {};
  return {
    nodes,
    document: {
      createElement,
      createTextNode: (text) => { const n = createElement("#text"); n.textContent = text; return n; },
      getElementById: (id) => (nodes[id] ??= createElement("p")),
    },
  };
}

test("a spend-only export reaches the downgraded tier instead of a dead end", () => {
  const projection = project(UNGROUPED_PERIOD);
  assert.equal(projection.departmentCoverage.attributedRows, 0);
  assert.equal(projection.preflightOutcome, EVIDENCE_PREFLIGHT_OUTCOME.SPEND_ONLY);

  const assessment = providerExportPreflight(projection);
  assert.equal(assessment.outcome, EVIDENCE_PREFLIGHT_OUTCOME.SPEND_ONLY);
  assert.equal(assessment.tier, SPEND_ONLY_TIER);
  assert.equal(assessment.sufficient, false, "a downgraded result is not a sufficient one");

  // Total spend and the per-model split are both computed, and every one of
  // them is stamped with the tier it belongs to.
  const total = assessment.computed.find((entry) => entry.id === SPEND_ONLY_FIGURE.totalSpend);
  assert.equal(total.value, 9.62);
  assert.match(total.display, /\$9\.62/);
  const split = assessment.computed
    .filter((entry) => entry.id === SPEND_ONLY_FIGURE.modelSpendSplit);
  assert.equal(split.length, 2, "one bucket per model the export named");
  assert.deepEqual(split.map((entry) => entry.value.amountUsd), [8.72, 0.9]);
  assert.equal(assessment.computed.every((entry) => entry.tier === SPEND_ONLY_TIER), true);
  assert.ok(assessment.withheld.length > 0);
});

test("every withheld entry names a field and a recipe the contract module publishes", () => {
  const { withheld } = providerExportPreflight(project(UNGROUPED_PERIOD));
  assert.ok(withheld.length > 0);
  for (const entry of withheld) {
    const recipe = recipeForAdapter(entry.recipe);
    assert.ok(recipe, `${entry.recipe} is a pinned recipe`);
    assert.equal(entry.recipeLabel, recipe.label);
    // The identifier, not a lookalike: renaming the column in import-recipes.js
    // breaks this assertion rather than drifting the rendered line.
    assert.ok(recipe.columns.includes(entry.field),
      `${entry.field} is a column ${recipe.adapter} supplies`);
    assert.equal(entry.tier, SPEND_ONLY_TIER);
    assert.ok(entry.figure.length > 0);
  }
  // Nothing here is hand-written at the call site: every field is a column some
  // pinned recipe declares.
  const columns = new Set(IMPORT_RECIPES.flatMap((recipe) => recipe.columns));
  assert.equal(withheld.every((entry) => columns.has(entry.field)), true);
  assert.equal(new Set(withheld.map((entry) => entry.id)).size, withheld.length);
});

test("the region renders the computed figures and one line per withheld item", () => {
  const { nodes, document } = pageDocument();
  const projection = project(UNGROUPED_PERIOD);
  const assessment = providerExportPreflight(projection);
  assert.equal(renderProviderExportProjection(document, projection), true);

  const block = nodes["own-data-preflight-downgraded"];
  assert.equal(block.hidden, false, "the downgraded block is visible, not folded away");
  assert.equal(block.dataset.tier, SPEND_ONLY_TIER);
  assert.equal(nodes["own-data-evidence-preflight"].dataset.outcome,
    EVIDENCE_PREFLIGHT_OUTCOME.SPEND_ONLY);
  // Announced through the same always-visible status line the full-import path
  // uses, and it sits outside the provenance disclosure.
  assert.match(nodes["own-data-preflight-status"].textContent, /Spend only/);
  assert.equal(nodes["own-data-preflight-status"].getAttribute?.("aria-hidden"), null);

  const computed = nodes["own-data-preflight-computed"];
  assert.equal(computed.children.length, assessment.computed.length);
  assert.equal(computed.children.filter((item) => item.dataset.tier === SPEND_ONLY_TIER).length,
    assessment.computed.length);
  assert.match(computed.textContent, /\$9\.62/);
  assert.match(computed.textContent, /downgraded tier/);

  const withheld = nodes["own-data-preflight-withheld"];
  assert.equal(withheld.children.length, assessment.withheld.length);
  for (const [index, entry] of assessment.withheld.entries()) {
    const item = withheld.children[index];
    assert.equal(item.dataset.field, entry.field);
    assert.equal(item.dataset.recipe, entry.recipe);
    assert.equal(item.children.length, 3, "figure, missing field, and supplying recipe");
    assert.match(item.textContent, new RegExp(entry.field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(item.textContent, /supplied by/);
  }
});

test("a later result retires the downgraded figures rather than leaving them on screen", () => {
  const { nodes, document } = pageDocument();
  assert.equal(renderProviderExportProjection(document, project(UNGROUPED_PERIOD)), true);
  assert.ok(nodes["own-data-preflight-computed"].children.length > 0);

  // The bundled example's shape: an assessment carrying no tier at all.
  assert.equal(renderOwnDataEvidencePreflight(document, {
    outcome: EVIDENCE_PREFLIGHT_OUTCOME.COMPLETE, boundary: [], provenance: [],
    verdict: "v", finding: "f", confidence: "c", nextAction: "n",
    coverage: { coveredRows: 1, totalRows: 1 }, benchmark: { label: "b", rule: "r" },
  }), true);
  assert.equal(nodes["own-data-preflight-downgraded"].hidden, true);
  assert.equal(nodes["own-data-preflight-computed"].children.length, 0);
  assert.equal(nodes["own-data-preflight-withheld"].children.length, 0);
});

test("a zero-dollar single-bucket export still renders a coherent result", () => {
  const projection = project(UNGROUPED_PERIOD
    .map((row) => ({ ...row, model: "anthropic.claude-sonnet", cost: "0.00" })));
  const assessment = providerExportPreflight(projection);
  assert.equal(assessment.tier, SPEND_ONLY_TIER);
  const split = assessment.computed
    .filter((entry) => entry.id === SPEND_ONLY_FIGURE.modelSpendSplit);
  assert.equal(split.length, 1, "one bucket is still a split");
  assert.equal(split[0].value.share, null, "a zero total has no denominator, never 0%");
  assert.match(split[0].display, /\$0\.00/);
  assert.match(assessment.finding, /1 model bucket\./);

  const { nodes, document } = pageDocument();
  assert.equal(renderProviderExportProjection(document, projection), true);
  assert.equal(nodes["own-data-preflight-computed"].children.length, 2);
  assert.equal(nodes["own-data-preflight-withheld"].children.length,
    assessment.withheld.length);
});

test("a record that names no model is bucketed rather than dropped", () => {
  const { computed } = spendOnlyFigures([
    { cost: { amount_minor: 500 } },
    { cost: { amount_minor: 1500 }, model_raw: "gpt-4o", model_tier: "premium" },
  ]);
  assert.equal(computed[0].value, 20);
  const split = computed.filter((entry) => entry.id === SPEND_ONLY_FIGURE.modelSpendSplit);
  assert.deepEqual(split.map((entry) => entry.label), ["gpt-4o", MODEL_NOT_STATED]);
  assert.deepEqual(split.map((entry) => entry.value.amountUsd), [15, 5]);
  assert.match(split[1].display, /25%/);
});

test("a partly attributed export keeps the benchmark judgment it had", () => {
  const projection = project(UNGROUPED_PERIOD
    .map((row, index) => (index === 0 ? { ...row, account: "000000000001" } : row)));
  assert.equal(projection.departmentCoverage.attributedRows, 1);
  assert.equal(projection.spendOnly, null);
  assert.equal(projection.preflightOutcome, EVIDENCE_PREFLIGHT_OUTCOME.INSUFFICIENT);
  assert.equal(providerExportPreflight(projection).tier, null);
});
