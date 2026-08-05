// The routing slate: the ranked list a FinOps lead decides from.
//
// Three properties carry the whole surface, and each has a test that fails when
// it stops holding:
//
//   1. The bundled example — with no imported export — renders at least two
//      ranked rules. Asserted against the real bundled example, not a fixture,
//      because a first-time visitor meets that dataset and nothing else.
//   2. The headline total equals the sum of the rendered per-rule figures. A
//      reader who adds the column has to reach the headline.
//   3. Rank is a property of the data, not of the input order. Proved by feeding
//      equal-value rules in two different orders and asserting one rank 1.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { loadExampleDataset } from "../src/example-dataset.js";
import {
  MODELLED_BASIS_TAG, ROUTING_SLATE_QUESTION, ROUTING_SLATE_REASONS, routingSlate,
} from "../src/routing-slate.js";
import { applyRoutingSlate } from "../src/routing-slate-view.js";
import { loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

/**
 * A per-model envelope, built in-test. `recoverableUsd` is what the down-routing
 * rule publishes per candidate; everything else is the shape it publishes it in.
 */
const modelEnvelope = (candidates) => ({
  period: "2026-06-01 to 2026-06-30",
  rankedDepartments: [],
  modelRouting: {
    ranked: [{
      unitLabel: "unit …atlas0",
      confidence: { level: "Medium", reasons: [] },
      candidates: candidates.map((entry) => ({
        model: entry.model,
        tier: "premium",
        proposedTier: entry.proposedTier ?? "standard",
        currentSpendUsd: 1000,
        projectedSpendUsd: 1000 - entry.recoverableUsd,
        recoverableUsd: entry.recoverableUsd,
        inputs: { tokens: 500_000 },
      })),
    }],
  },
});

// ---------------------------------------------------------------------------
// 1. The bundled example populates the view with no import.
// ---------------------------------------------------------------------------

test("the bundled example alone produces at least two ranked rules", () => {
  const slate = routingSlate(loadExampleDataset());
  assert.equal(slate.available, true, slate.reason ?? "the bundled example must populate the slate");
  assert.ok(slate.rules.length >= 2,
    `a first-time visitor must meet a populated list; got ${slate.rules.length} rule(s)`);
  assert.equal(slate.source, "per-unit",
    "the bundled export is the JSON contract shape and carries no model identity");
  for (const rule of slate.rules) {
    assert.equal(Number.isInteger(rule.expectedMonthlyUsd), true,
      "every expected return is rendered as an exact integer dollar figure");
    assert.ok(rule.expectedMonthlyUsd > 0, "a rule worth nothing is not a change to ship");
    assert.equal(rule.targetTier, "standard");
    assert.equal(rule.basis, MODELLED_BASIS_TAG);
    assert.ok(rule.evidence.length > 0, "each rule carries the line its figure came from");
  }
});

test("each expected return truncates its source figure toward zero rather than rounding", () => {
  const analysis = loadExampleDataset();
  const byName = new Map(analysis.rankedDepartments
    .filter((department) => department.downRouting.flagged)
    .map((department) => [department.name, department.downRouting.recoverableUsd]));
  const slate = routingSlate(analysis);
  const fractional = slate.rules.filter((rule) => byName.get(rule.source) % 1 !== 0);
  assert.ok(fractional.length > 0,
    "the bundled example must still exercise truncation; if it stops, pick another case");
  for (const rule of slate.rules) {
    assert.equal(rule.expectedMonthlyUsd, Math.trunc(byName.get(rule.source)),
      `${rule.source} must truncate toward zero, never round`);
  }
});

test("the prioritized next action names rank 1 as a move, not as the metric", () => {
  const slate = routingSlate(loadExampleDataset());
  const first = slate.rules[0];
  assert.match(slate.nextAction, /^Move /);
  assert.ok(slate.nextAction.includes(first.source), "the action must name rank 1's source");
  assert.ok(slate.nextAction.includes(first.targetTier), "the action must name the target tier");
  assert.ok(!slate.nextAction.includes(String(first.expectedMonthlyUsd)),
    "the action is the move to make, not a restatement of the figure above it");
});

// ---------------------------------------------------------------------------
// 2. The headline is the sum of the rows.
// ---------------------------------------------------------------------------

test("the headline total equals the sum of the ranked rules", () => {
  const slate = routingSlate(loadExampleDataset());
  const summed = slate.rules.reduce((total, rule) => total + rule.expectedMonthlyUsd, 0);
  assert.equal(slate.totalExpectedMonthlyUsd, summed);
});

test("a rule filtered out of the list is out of the total too", () => {
  const slate = routingSlate(modelEnvelope([
    { model: "keeper", recoverableUsd: 400 },
    { model: "zero-delta", recoverableUsd: 0.4 },
  ]));
  assert.deepEqual(slate.rules.map((rule) => rule.source), ["keeper"],
    "a rule worth $0 after truncation is not rendered");
  assert.equal(slate.totalExpectedMonthlyUsd, 400);
});

test("an envelope with no candidate says so rather than showing an empty ranking", () => {
  const slate = routingSlate({ period: "2026-06", rankedDepartments: [], modelRouting: null });
  assert.equal(slate.available, false);
  assert.equal(slate.reason, ROUTING_SLATE_REASONS.no_candidates);
  assert.equal(routingSlate(null).reason, ROUTING_SLATE_REASONS.no_analysis);
});

// ---------------------------------------------------------------------------
// 3. Rank does not depend on input order.
// ---------------------------------------------------------------------------

test("equal-value rules rank identically from two different input orders", () => {
  const rules = [
    { model: "beta", recoverableUsd: 900 },
    { model: "alpha", recoverableUsd: 900 },
    { model: "gamma", recoverableUsd: 900 },
  ];
  const forward = routingSlate(modelEnvelope(rules));
  const reversed = routingSlate(modelEnvelope([...rules].reverse()));
  assert.equal(forward.rules[0].source, "alpha",
    "the documented tie-break is source name ascending in raw character order");
  assert.equal(reversed.rules[0].source, forward.rules[0].source,
    "rank 1 must be a property of the data, not of the order the rows arrived in");
  assert.deepEqual(reversed.rules.map((rule) => rule.source),
    forward.rules.map((rule) => rule.source));
  assert.equal(forward.nextAction, reversed.nextAction);
});

test("rules with the same source name and value break on the target tier", () => {
  const same = [
    { model: "shared", recoverableUsd: 50, proposedTier: "standard" },
    { model: "shared", recoverableUsd: 50, proposedTier: "economy" },
  ];
  const forward = routingSlate(modelEnvelope(same));
  const reversed = routingSlate(modelEnvelope([...same].reverse()));
  assert.equal(forward.rules[0].targetTier, "economy");
  assert.equal(reversed.rules[0].targetTier, forward.rules[0].targetTier);
});

// ---------------------------------------------------------------------------
// The realized/modelled wording is the page's, reused rather than re-coined.
// ---------------------------------------------------------------------------

test("the modelled label is the phrase the executive briefing already ships", async () => {
  const source = await readFile(new URL("../src/executive-briefing-view.js", import.meta.url), "utf8");
  assert.ok(source.includes(MODELLED_BASIS_TAG),
    "a second phrase for one distinction teaches a reader the page measured what it modelled");
});

// ---------------------------------------------------------------------------
// The shipped page renders it.
// ---------------------------------------------------------------------------

test("the shipped section leads with the question, the total, then the action", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const section = document.getElementById("routing-slate");
  assert.ok(section, "the section must be authored in evolution.html");
  assert.equal(textOf(document.getElementById("routing-slate-title")), ROUTING_SLATE_QUESTION);

  const slate = applyRoutingSlate(document, loadExampleDataset());
  assert.equal(section.dataset.state, "ready");
  assert.equal(section.dataset.ruleCount, String(slate.rules.length));

  const body = textOf(document.getElementById("routing-slate-body"));
  const total = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(slate.totalExpectedMonthlyUsd);
  assert.ok(body.includes("Total expected monthly return"), body.slice(0, 200));
  assert.ok(body.includes(total), `the rendered headline must be ${total}`);
  assert.ok(body.includes(`Do this first: ${slate.nextAction}`));
  assert.ok(body.includes(slate.tieBreak), "the tie-break must be stated where a reader ranks");
  assert.ok(body.includes(MODELLED_BASIS_TAG));
});

test("every rule's summary names source, target tier and dollars outside its disclosure", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const slate = applyRoutingSlate(document, loadExampleDataset());
  const summaries = [...document.querySelectorAll("summary")]
    .map(textOf)
    .filter((text) => /^\d+\./.test(text));
  assert.equal(summaries.length, slate.rules.length);
  for (const rule of slate.rules) {
    const line = summaries[rule.rank - 1];
    assert.ok(line.includes(rule.source), `${line} must name its source`);
    assert.ok(line.includes(`${rule.targetTier} tier`), `${line} must name the target tier`);
    assert.ok(line.includes("a month"), `${line} must carry the expected monthly return`);
  }
});
