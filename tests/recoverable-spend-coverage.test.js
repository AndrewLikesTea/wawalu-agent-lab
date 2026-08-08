import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  COVERAGE_STATE, RECOVERABLE_SPEND_TAXONOMY, evaluateRecoverableSpendCoverage,
} from "../src/recoverable-spend-coverage.js";
import { renderRecoverableSpendCoverage } from "../src/recoverable-spend-coverage-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

test("the recovery taxonomy is complete and every metric has one executable contract", () => {
  assert.deepEqual(RECOVERABLE_SPEND_TAXONOMY.map(({ id }) => id), [
    "retry_failed_call", "duplicate_repeat", "context_bloat", "batch_cache_eligibility",
    "unused_committed_capacity", "out_of_scope_leakage",
  ]);
  for (const item of RECOVERABLE_SPEND_TAXONOMY) {
    assert.ok(item.question.endsWith("?"), `${item.id} must answer a leader's question`);
    assert.ok(item.requiredImportFields.length > 1, `${item.id} declares required fields`);
    assert.match(item.metric.formula, /Sum|sum/);
    assert.ok(item.metric.denominator.includes("accepted") || item.metric.denominator.includes("commitments"));
    assert.ok(item.pricingBasis && item.accountableOwner && item.confidenceCap.level);
    assert.match(item.absentBehavior, /^Unsupported\./);
  }
});

test("evaluation distinguishes evaluated, unsupported, and no opportunity without a zero-cost claim", () => {
  const definitions = RECOVERABLE_SPEND_TAXONOMY.slice(0, 3);
  const facts = Object.fromEntries(definitions.flatMap((item) =>
    item.requiredImportFields.map((field) => [field, "supported"])));
  delete facts.operation_fingerprint;
  const coverage = evaluateRecoverableSpendCoverage({
    facts,
    opportunities: { retry_failed_call: 48.25, context_bloat: 0 },
  });
  assert.equal(coverage[0].state, COVERAGE_STATE.evaluated);
  assert.equal(coverage[0].amountUsd, 48.25);
  assert.equal(coverage[1].state, COVERAGE_STATE.unsupported);
  assert.equal(coverage[1].amountUsd, null);
  assert.equal(coverage[2].state, COVERAGE_STATE.noOpportunity);
  assert.match(coverage[2].stateDetail, /not a claim.*zero cost/i);
});

test("the existing recoverable answer progressively discloses all three coverage states", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const first = RECOVERABLE_SPEND_TAXONOMY[0];
  const second = RECOVERABLE_SPEND_TAXONOMY[1];
  const third = RECOVERABLE_SPEND_TAXONOMY[2];
  const facts = Object.fromEntries([...first.requiredImportFields, ...third.requiredImportFields]
    .map((field) => [field, "supported"]));
  const coverage = evaluateRecoverableSpendCoverage({ facts,
    opportunities: { [first.id]: 12, [third.id]: 0 } });
  renderRecoverableSpendCoverage(document, coverage);

  const root = document.getElementById("recoverable-spend-coverage");
  assert.ok(root.closest("details#finops-recoverable-how-we-know"),
    "coverage extends the existing evidence disclosure rather than creating a surface");
  assert.deepEqual(root.querySelectorAll("li").map((row) => row.dataset.coverageState).slice(0, 3),
    [COVERAGE_STATE.evaluated, COVERAGE_STATE.unsupported, COVERAGE_STATE.noOpportunity]);
  assert.match(textOf(root), new RegExp(second.requiredImportFields[0]));
  assert.match(textOf(root), /Unsupported is not zero/);
  assert.match(textOf(root), /not a claim that the activity had zero cost/);
  assert.equal(root.querySelectorAll("li").length, 6);
});
