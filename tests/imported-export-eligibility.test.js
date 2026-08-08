import assert from "node:assert/strict";
import test from "node:test";

import {
  determineImportedExportEligibility, IMPORT_ELIGIBILITY_STATE,
} from "../src/imported-export-eligibility.js";
import { renderImportedExportEligibility } from "../src/imported-export-eligibility-view.js";
import { createElement, walk } from "./support/dom.js";

const providerExport = (overrides = {}) => ({
  snapshot: {
    completeness: "complete", omitted_record_count: 0, issues: [],
    period_start: "2026-07-01", period_end: "2026-08-01",
    ...overrides.snapshot,
  },
  records: overrides.records ?? [{
    model_raw: "model-a", model_tier: "standard", request_count: 20,
    cost: { amount_minor: 2500, currency: "USD", status: "final" },
  }, {
    model_raw: "model-b", model_tier: "economy", request_count: 30,
    cost: { amount_minor: 1500, currency: "USD", status: "final" },
  }],
});

test("complete model cost and nonzero request volume publish one observed unit metric", () => {
  const decision = determineImportedExportEligibility(providerExport());
  assert.equal(decision.state, IMPORT_ELIGIBILITY_STATE.COST_PER_REQUEST);
  assert.equal(decision.metric.id, "observed_cost_per_request_usd");
  assert.equal(decision.metric.valueUsd, 0.8);
  assert.match(decision.metric.definition, /amount_minor ÷ 100 ÷ sum of request_count/);
  assert.match(decision.provenance, /2 accepted provider-export rows; 50 requests/);
  assert.match(decision.boundary, /no claim about prompt content, credentials, model quality/);
});

test("missing request counts retain observed spend without inventing a unit benchmark", () => {
  const input = providerExport();
  input.records[1].request_count = null;
  const decision = determineImportedExportEligibility(input);
  assert.equal(decision.state, IMPORT_ELIGIBILITY_STATE.MODEL_SPEND);
  assert.equal(decision.metric.id, "observed_model_spend_usd");
  assert.equal(decision.metric.valueUsd, 40);
  assert.equal(decision.upgrade.field, "records[].request_count");
  assert.match(decision.confidence, /no per-request benchmark is claimed/);
});

test("insufficient states fail closed to the first smallest export-field repair", () => {
  const partial = determineImportedExportEligibility(providerExport({
    snapshot: { completeness: "partial" },
  }));
  assert.equal(partial.state, IMPORT_ELIGIBILITY_STATE.INSUFFICIENT_PERIOD);
  assert.equal(partial.requiredField, "snapshot.completeness");
  assert.equal(partial.metric, null);

  const missingModel = providerExport();
  missingModel.records[0].model_raw = null;
  missingModel.records[0].model_tier = null;
  assert.equal(determineImportedExportEligibility(missingModel).requiredField,
    "records[].model_raw");

  const estimated = providerExport();
  estimated.records[0].cost.status = "estimated";
  assert.equal(determineImportedExportEligibility(estimated).requiredField,
    "records[].cost.status");
});

test("rendered import copy names the question, one money metric, provenance, and action", () => {
  const host = createElement("section");
  host.id = "own-data-evidence-preflight";
  const root = createElement("document");
  root.append(host);
  const document = { createElement, getElementById: (id) =>
    walk(root, (node) => node.id === id)[0] ?? null };
  const decision = determineImportedExportEligibility(providerExport());
  assert.equal(renderImportedExportEligibility(document, decision), true);
  const region = document.getElementById("imported-export-eligibility");
  assert.equal(region.dataset.state, IMPORT_ELIGIBILITY_STATE.COST_PER_REQUEST);
  assert.match(region.textContent, /What money fact can a leader act on/);
  assert.match(region.textContent, /\$0\.80 per request/);
  assert.match(region.textContent, /browser-local deterministic sum/);
  assert.match(region.textContent, /Prioritized next action/);
  assert.equal(region.querySelectorAll(".imported-export-eligibility-metric").length, 1);
});

test("rendered insufficient copy names exactly which export field to add", () => {
  const host = createElement("section");
  host.id = "own-data-evidence-preflight";
  const root = createElement("document");
  root.append(host);
  const document = { createElement, getElementById: (id) =>
    walk(root, (node) => node.id === id)[0] ?? null };
  const input = providerExport();
  input.records[0].model_raw = null;
  input.records[0].model_tier = null;
  renderImportedExportEligibility(document, determineImportedExportEligibility(input));
  const region = document.getElementById("imported-export-eligibility");
  assert.match(region.textContent, /Smallest additional export field records\[\]\.model_raw/);
  assert.match(region.textContent, /Supply the provider model identifier on every billed row/);
  assert.equal(region.querySelectorAll(".imported-export-eligibility-metric").length, 0);
});
