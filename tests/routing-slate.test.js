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
  MODELLED_BASIS_TAG, ROUTING_POLICY_EMPTY_NOTICE, ROUTING_POLICY_NOTICE,
  ROUTING_POLICY_SCHEMA, ROUTING_POLICY_SCHEMA_VERSION, ROUTING_SLATE_QUESTION,
  ROUTING_SLATE_REASONS, routingPolicyDocument, routingPolicyFile, routingSlate,
  serializeRoutingPolicy,
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

// ---------------------------------------------------------------------------
// The downloadable policy. Four properties, and each one is a way the file
// could mislead the change review that reads it:
//
//   determinism  two downloads of one record are the same bytes, so a diff
//                between two files is a change in the analysis and nothing else.
//   purity       generating a file does not alter the record the page is showing.
//   completeness every rule states what it moves, what that is worth, and what
//                must hold before it is applied.
//   redaction    the file carries derived figures only. No prompt, no customer
//                text, from any depth of the record.
// ---------------------------------------------------------------------------

const STAMP = "2026-08-01T00:00:00.000Z";

test("the same record and the same stamp serialize to the same bytes", () => {
  const analysis = loadExampleDataset();
  const first = serializeRoutingPolicy(routingPolicyDocument(analysis, { generatedAt: STAMP }));
  const second = serializeRoutingPolicy(routingPolicyDocument(analysis, { generatedAt: STAMP }));
  assert.equal(first, second, "a re-download must diff clean against the first one");
  assert.equal(first, routingPolicyFile(analysis, { generatedAt: STAMP }).text);
});

test("a different stamp changes the stamp and nothing else", () => {
  const analysis = loadExampleDataset();
  const later = "2026-09-02T11:30:00.000Z";
  const before = routingPolicyDocument(analysis, { generatedAt: STAMP });
  const after = routingPolicyDocument(analysis, { generatedAt: later });
  assert.equal(before.generatedAt, STAMP);
  assert.equal(after.generatedAt, later);
  assert.deepEqual({ ...after, generatedAt: STAMP }, { ...before },
    "the stamp is the only field a clock is allowed to move");
  assert.equal(
    serializeRoutingPolicy(after).replace(later, STAMP),
    serializeRoutingPolicy(before),
    "the stamp appears exactly once, so replacing it recovers the earlier bytes",
  );
});

test("generating a policy does not mutate the record it was derived from", () => {
  const analysis = loadExampleDataset();
  const before = JSON.stringify(analysis);
  routingPolicyFile(analysis, { generatedAt: STAMP });
  assert.equal(JSON.stringify(analysis), before, "the generator is side-effect free");
});

test("the document is schema-stamped and every rule carries its five fields", () => {
  const analysis = loadExampleDataset();
  const slate = routingSlate(analysis);
  const policy = routingPolicyDocument(analysis, { generatedAt: STAMP });
  assert.equal(policy.schema, ROUTING_POLICY_SCHEMA);
  assert.equal(policy.schemaVersion, ROUTING_POLICY_SCHEMA_VERSION);
  assert.equal(policy.period, slate.period, "the file names the period it was derived from");
  assert.ok(policy.period, "the bundled example publishes a period");
  assert.equal(policy.notice, ROUTING_POLICY_NOTICE);
  assert.equal(policy.ruleCount, slate.rules.length);
  assert.equal(policy.totalExpectedMonthlyUsd, slate.totalExpectedMonthlyUsd);
  for (const entry of policy.rules) {
    assert.ok(entry.sourceModel, "a rule that does not name its source is not applicable");
    assert.ok(entry.targetTier, "a rule that does not name a target tier moves nothing");
    assert.equal(Number.isInteger(entry.expectedMonthlyUsd), true,
      "figures are rounded in one place, and it is not this one");
    assert.equal(entry.guardrails.basis, MODELLED_BASIS_TAG);
    assert.ok(entry.guardrails.appliesToOrgUnit, "a rule is scoped to the unit that earned it");
    assert.ok(entry.guardrails.lifecycle, "a reviewer must be told whether this shipped");
    assert.ok(entry.evidence.length > 0, "each rule carries the line its figure came from");
  }
});

test("a record that ranked nothing yields an empty rule list that says so", () => {
  const policy = routingPolicyDocument(null, { generatedAt: STAMP });
  assert.deepEqual(policy.rules, []);
  assert.equal(policy.ruleCount, 0);
  assert.equal(policy.totalExpectedMonthlyUsd, 0);
  assert.equal(policy.notice, ROUTING_POLICY_EMPTY_NOTICE,
    "an empty file must not read as an approved policy");
  assert.equal(policy.reason, ROUTING_SLATE_REASONS.no_analysis);
});

test("no prompt or customer text from the record reaches the file", () => {
  const secret = "ZZ-CONFIDENTIAL-PROMPT-TEXT";
  // The bundled envelope is frozen, so poison a structural copy of it.
  const analysis = structuredClone(loadExampleDataset());
  // Poisoned at every depth the generator walks: the envelope, an org unit, the
  // unit's own routing candidate, and one of its worked-example lines.
  analysis.promptExcerpt = secret;
  analysis.customerName = secret;
  const flagged = analysis.rankedDepartments.find((entry) => entry.downRouting?.flagged);
  flagged.promptExcerpt = secret;
  flagged.downRouting.promptExcerpt = secret;
  for (const line of flagged.downRouting.workedExample ?? []) line.promptExcerpt = secret;

  const text = routingPolicyFile(analysis, { generatedAt: STAMP }).text;
  assert.equal(text.includes(secret), false, "a prompt excerpt must never leave this page");
  assert.equal(text.includes("promptExcerpt"), false, "not even the key name is copied through");
  assert.equal(text.includes("customerName"), false);
});

test("the shipped control is authored below the slate and carries the file's own notice", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const button = document.getElementById("download-routing-policy");
  assert.ok(button, "the control must be authored in evolution.html");
  assert.equal(textOf(button), "Download routing policy");
  assert.equal(textOf(document.getElementById("routing-policy-notice")), ROUTING_POLICY_NOTICE,
    "the page must state the caveat the downloaded file states, in the same words");

  applyRoutingSlate(document, loadExampleDataset());
  assert.equal(button.disabled, false, "a record with ranked rules has a policy to propose");
  assert.equal(button.getAttribute("aria-describedby"), "routing-policy-notice");

  // Nothing ranked: the control is refused rather than left live over an empty
  // file, and it points at the status line that says why.
  applyRoutingSlate(document, null);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-describedby"), "routing-slate-status");
  assert.equal(textOf(document.getElementById("routing-slate-status")),
    ROUTING_SLATE_REASONS.no_analysis);
});
