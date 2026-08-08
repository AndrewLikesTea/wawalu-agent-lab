import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  FINOPS_OPPORTUNITY_VERSION, OPPORTUNITY_CONFIDENCE_CAPS,
  analyzeFinopsOpportunities, opportunityCommitmentHref,
} from "../src/finops-opportunity-analysis.js";
import { BUNDLED_FINOPS_OPPORTUNITY_FIXTURES } from "../src/finops-opportunity-fixtures.js";
import { buildSavingsCommitment } from "../src/savings-commitment.js";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const COMMITMENT_FIXTURE = JSON.parse(await readFile(
  new URL("../src/savings-commitment-fixture.json", import.meta.url), "utf8"));

test("bundled local fixtures produce explainable amounts, caps, provenance, and total", () => {
  const portfolio = analyzeFinopsOpportunities(BUNDLED_FINOPS_OPPORTUNITY_FIXTURES);
  assert.equal(portfolio.version, FINOPS_OPPORTUNITY_VERSION);
  assert.ok(portfolio.ranked.length >= 2, "at least two departments must be ranked");
  assert.equal(portfolio.portfolioTotalUsd,
    portfolio.ranked.reduce((sum, item) => sum + item.amountUsd, 0));
  assert.equal(portfolio.portfolioTotalUsd, 36646);
  assert.equal(portfolio.primaryRecommendation, portfolio.ranked[0]);
  assert.deepEqual(portfolio.ranked.map(({ opportunityId, action, amountUsd }) =>
    ({ opportunityId, action, amountUsd })), [
    { opportunityId: "syn-commit-support-triage", action: "routing", amountUsd: 31300 },
    { opportunityId: "syn-commit-batch-summaries", action: "rewrite", amountUsd: 3599 },
    { opportunityId: "syn-retry-failed-calls", action: "training_gap", amountUsd: 1747 },
  ]);
  assert.ok(portfolio.insufficientEvidence.some((item) =>
    item.departmentId === "syn-insufficient" && item.code === "sampling_unavailable"));
  for (const opportunity of portfolio.ranked) {
    assert.ok(opportunity.amountUsd > 0);
    const declared = OPPORTUNITY_CONFIDENCE_CAPS[opportunity.confidence.level];
    assert.equal(opportunity.confidence.percentCap, declared.percent);
    assert.match(opportunity.confidence.assumption, /^ASSUMPTION /);
    assert.equal(opportunity.provenance.portfolioVersion, FINOPS_OPPORTUNITY_VERSION);
    assert.match(opportunity.provenance.inputDigest, /^[0-9a-f]{8}$/);
    assert.ok(opportunity.provenance.basis.length > 20);
  }
  assert.deepEqual(Object.values(OPPORTUNITY_CONFIDENCE_CAPS).map((cap) => cap.percent),
    [90, 70, 40]);
  for (const cap of Object.values(OPPORTUNITY_CONFIDENCE_CAPS)) {
    assert.match(cap.assumption, /^ASSUMPTION /, "every confidence cap states its assumption");
  }
});

test("ranking is byte-identical under input reorder and exact retries do not repeat dollars", () => {
  const fixtures = BUNDLED_FINOPS_OPPORTUNITY_FIXTURES;
  const once = analyzeFinopsOpportunities(fixtures);
  const reversed = analyzeFinopsOpportunities([...fixtures].reverse());
  assert.equal(JSON.stringify(once), JSON.stringify(reversed));

  const repeated = analyzeFinopsOpportunities([...fixtures, structuredClone(fixtures[0])]);
  assert.equal(repeated.portfolioTotalUsd, once.portfolioTotalUsd);
  assert.deepEqual(repeated.excluded,
    [{ departmentId: fixtures[0].id, code: "duplicate_repeat" }]);
});

test("conflicting repeats abstain and exact ties use stable opportunity id", () => {
  const base = structuredClone(BUNDLED_FINOPS_OPPORTUNITY_FIXTURES[0]);
  const conflict = { ...structuredClone(base), spendUsd: base.spendUsd + 1 };
  const refused = analyzeFinopsOpportunities([base, conflict]);
  assert.equal(refused.ranked.length, 0);
  assert.deepEqual(refused.insufficientEvidence,
    [{ departmentId: base.id, code: "conflicting_repeat" }]);

  const a = { ...structuredClone(base), id: "syn-tie-a", name: "Synthetic A" };
  const b = { ...structuredClone(base), id: "syn-tie-b", name: "Synthetic B" };
  const tied = analyzeFinopsOpportunities([b, a]);
  assert.deepEqual(tied.ranked.map((item) => item.opportunityId), ["syn-tie-a", "syn-tie-b"]);
});

test("the rendered primary link names a destination fixture opportunity that validates", async () => {
  const evolution = await loadPage(new URL("../src/evolution.html", import.meta.url), {
    routes: {
      "/evolution-demo-data.json": JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url))),
      "/finops-evaluation-fixtures.json": JSON.parse(await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url))),
      "/model-overspend-finding-fixture.json": JSON.parse(await readFile(new URL("../src/model-overspend-finding-fixture.json", import.meta.url))),
    },
  });
  // Importing the actual page entry exercises the production fixture -> scorer -> link path.
  await importPageModule("/evolution-page.js");
  await waitFor(() => evolution.document.documentElement.dataset.shiplogEvolution === "ready",
    "the analysis page to settle");
  await waitFor(() => textOf(evolution.document.getElementById("integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static gateway to settle");
  const href = evolution.document.getElementById("finops-primary-commitment").href;
  const url = new URL(href, "https://labs.wawalu.org");
  const opportunityId = url.searchParams.get("opportunity");
  const action = url.searchParams.get("action");
  const expected = analyzeFinopsOpportunities(BUNDLED_FINOPS_OPPORTUNITY_FIXTURES)
    .primaryRecommendation;
  assert.equal(opportunityId, expected.opportunityId);
  assert.equal(action, expected.action);
  // The exact encoded pair must resolve in the destination's own fixture.
  const preview = buildSavingsCommitment(structuredClone(COMMITMENT_FIXTURE),
    { opportunityId, action });
  assert.equal(preview.commitment.commitmentId, opportunityId);
  assert.equal(preview.commitment.projectedMonthlySavings.amountUsd, expected.amountUsd,
    "the rendered opportunity amount must be the amount the commitment flow loads");
  assert.equal(preview.commitment.routing.currentRoute.modelId, "syn-model-frontier-a");

  evolution.restore();
  const destination = await loadPage(new URL("../src/savings-commitment.html", import.meta.url), {
    location: { search: url.search }, routes: { "/savings-commitment-fixture.json": COMMITMENT_FIXTURE },
  });
  await importPageModule("/savings-commitment-page.js");
  await waitFor(() => destination.document.getElementById("savings-commitment")
    .getAttribute("aria-busy") === "false", "linked commitment to render");
  assert.match(textOf(destination.document.getElementById("savings-commitment")),
    /first-pass support ticket triage/);
  destination.restore();
});

test("unknown or action-mismatched handoffs fail validation instead of silently loading another candidate", () => {
  assert.throws(() => buildSavingsCommitment(structuredClone(COMMITMENT_FIXTURE),
    { opportunityId: "syn-not-in-fixture", action: "routing" }), /eligible opportunity/);
  assert.throws(() => buildSavingsCommitment(structuredClone(COMMITMENT_FIXTURE),
    { opportunityId: "syn-commit-support-triage", action: "rewrite" }), /must be routing/);
});
