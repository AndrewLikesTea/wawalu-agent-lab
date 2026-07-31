// The portfolio-primary brief, model and rendered states.
//
// What is pinned here is the product rule, not an object shape:
//
//   1. A portfolio leads only when the intake contract actually combined two or
//      more providers. One provider, or a selection reduced to one, keeps the
//      single-provider answer the page has always rendered.
//   2. Exactly one efficiency benchmark and exactly one next action reach the
//      brief, whatever else the analysis could have offered.
//   3. Trusted, partial, and blocked are three different screens, and the blocked
//      one prints no money at all.
//   4. The four evidence groups are native, keyboard-operable disclosures, and an
//      empty group opens onto a sentence rather than an empty list.
//   5. Exactly one complete decision summary stays on screen across the hand-off,
//      and clearing the import hands the page back.
//
// Envelopes are built in-test in the shape `normalizeLocalFinopsHistory`
// publishes — the same approach tests/finops-leading-finding.test.js takes — so a
// state that a real import reaches rarely is still covered directly.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml } from "./support/browser.js";
import { countCompleteSummaries } from "../src/finops-decision-contract.js";
import {
  PORTFOLIO_DISCLOSURES,
  PORTFOLIO_STATE,
  portfolioBrief,
  selectPortfolioBenchmark,
} from "../src/finops-portfolio-brief.js";
import { applyPortfolioBrief, clearPortfolioBrief } from "../src/finops-portfolio-brief-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

// --- fixtures ---------------------------------------------------------------

function multiProvider({ providerCount = 2, state = "combined", notes = [], rejections = [] } = {}) {
  return {
    contractVersion: "wawalu.integration.multi-provider-intake/1.0",
    providerCount,
    providers: [
      {
        provider: "openai", label: "OpenAI", state: "settled",
        periods: ["2026-01"], adapterId: "openai-usage-csv", adapterVersion: "1.0",
        comparabilityNote: null,
      },
      {
        provider: "anthropic", label: "Anthropic", state: "settled",
        periods: ["2026-01"], adapterId: "anthropic-usage-csv", adapterVersion: "1.0",
        comparabilityNote: "Reports list price, which is not the same basis as a billed amount.",
      },
    ].slice(0, Math.max(providerCount, 1)),
    comparability: { state, basis: "Same billing window and currency.", message: `${providerCount} providers were combined.`, notes },
    rejections,
    provenance: {
      processing: "browser_local_ephemeral",
      contract: "wawalu.integration.multi-provider-intake/1.0",
      adapters: ["openai-usage-csv/1.0", "anthropic-usage-csv/1.0"],
      acceptedExportIds: ["exp_anthropic_1", "exp_openai_1"],
      sourceInstanceIds: ["psn_multi_provider_intake_v1_0001"],
      combinedSourceInstanceId: "psn_multi_provider_intake_v1_0001",
    },
  };
}

function analysis(overrides = {}) {
  return {
    period: "2026-01-01 to 2026-02-01",
    spendUsd: 240_000,
    recoverableUsd: 36_000,
    topDepartment: { id: "unit-a", name: "Platform", recoverableUsd: 21_000 },
    action: "Pilot lower-cost routing for text-generation in Platform; cap the pilot at 21000.00 USD.",
    benchmark: { eligible: false, reasonCode: "no_compatible_cohort", message: "No imported peer cohort was scored with the same rubric.", comparisons: [], methodology: null },
    decisionInputs: {
      confidence: { level: "moderate", basis: ["provider and HRIS completeness", "record reconciliation"], historyEligible: true },
    },
    history: {
      state: "available",
      message: "Two compatible adjacent periods were read.",
      periods: [
        { period: "2025-12", spendUsd: 210_000, recoverableUsd: 30_000, exportId: "exp_dec", completeness: "settled" },
        { period: "2026-01", spendUsd: 240_000, recoverableUsd: 36_000, exportId: "exp_jan", completeness: "settled" },
      ],
    },
    validation: { state: "valid", results: [], quarantinedExportIds: [] },
    multiProvider: multiProvider(),
    ...overrides,
  };
}

// --- 1. what counts as a portfolio -----------------------------------------

test("a single-provider analysis is not a portfolio, and says which case it is", () => {
  for (const [label, envelope] of [
    ["no intake plan at all", analysis({ multiProvider: null })],
    ["one provider read", analysis({ multiProvider: multiProvider({ providerCount: 1, state: "single_provider" }) })],
    ["a bundle that already arrived combined", analysis({
      multiProvider: multiProvider({ state: "single_provider" }),
    })],
  ]) {
    const brief = portfolioBrief(envelope);
    assert.equal(brief.available, false, `${label} produced a portfolio brief`);
    assert.ok(brief.reason, `${label} gave no reason`);
    assert.equal(brief.state, null);
  }
  assert.equal(portfolioBrief(null).available, false, "a missing analysis produced a brief");
});

test("two combined providers lead with the aligned total before any provider detail", () => {
  const brief = portfolioBrief(analysis());
  assert.equal(brief.available, true);
  assert.equal(brief.alignedSpend.available, true);
  assert.equal(brief.alignedSpend.text, "240,000 USD");
  assert.equal(brief.alignedSpend.providerCount, 2);
  assert.match(brief.alignedSpend.detail, /2 providers on one billing window/);
  // The order the view paints and a reader reads: total, one benchmark, impact,
  // confidence, provenance, one action — then the provider-level disclosures.
  assert.deepEqual(brief.disclosures.map((group) => group.id), [...PORTFOLIO_DISCLOSURES]);
});

// --- 2. exactly one, twice over --------------------------------------------

test("exactly one efficiency benchmark is selected, and the passed-over one is named", () => {
  const share = selectPortfolioBenchmark(analysis());
  assert.equal(share.selected, "recoverable_share");
  assert.equal(share.value, "15% of the aligned total");
  assert.match(share.passedOver, /Peer cohort: No imported peer cohort/);

  // With an eligible cohort the cohort wins: it compares this organization
  // against others rather than against itself.
  const cohort = selectPortfolioBenchmark(analysis({
    benchmark: {
      eligible: true, reasonCode: null, message: "42nd percentile of the imported cohort.",
      comparisons: [{ id: "a" }, { id: "b" }], methodology: "prompt-literacy-rubric/1.0",
      cohort: { members: ["a", "b"] },
    },
  }));
  assert.equal(cohort.selected, "peer_cohort");
  assert.match(cohort.detail, /2 cohort comparisons under prompt-literacy-rubric\/1\.0/);

  // Neither: the reason the cohort gave is what a reader is left with, not a
  // silent empty slot.
  const neither = selectPortfolioBenchmark(analysis({ spendUsd: 0, recoverableUsd: 0 }));
  assert.equal(neither.available, false);
  assert.match(neither.detail, /No imported peer cohort/);
});

test("exactly one next action reaches the brief, with the role accountable for it", () => {
  const brief = portfolioBrief(analysis());
  assert.equal(brief.nextAction.available, true);
  assert.equal(brief.nextAction.rank, 1);
  assert.equal(brief.nextAction.accountable, "Platform");
  assert.equal(typeof brief.nextAction.text, "string");

  const unranked = portfolioBrief(analysis({ action: "", topDepartment: null }));
  assert.equal(unranked.nextAction.available, false);
  assert.equal(unranked.nextAction.text, "Not read yet.");
  assert.equal(unranked.state, PORTFOLIO_STATE.partial, "an unranked action still claimed a trusted brief");
});

// --- 3. trusted, partial, blocked ------------------------------------------

test("a clean combination is trusted; anything bounding it is partial", () => {
  assert.equal(portfolioBrief(analysis()).state, PORTFOLIO_STATE.trusted);

  const bounded = portfolioBrief(analysis({
    multiProvider: multiProvider({
      state: "combined_bounded",
      notes: ["Anthropic is a partial export; the combined total is a floor."],
    }),
  }));
  assert.equal(bounded.state, PORTFOLIO_STATE.partial);
  assert.deepEqual(bounded.confidence.bounds,
    ["Anthropic is a partial export; the combined total is a floor."],
    "the bounding note is not restated where the confidence it bounds is read");

  const held = portfolioBrief(analysis({
    multiProvider: multiProvider({
      rejections: [{
        providerLabel: "Bedrock", code: "misaligned_period",
        message: "Bedrock covers 2026-01-15 to 2026-02-15, which overlaps an accepted window.",
        action: "Re-export Bedrock on calendar-month boundaries.",
      }],
    }),
  }));
  assert.equal(held.state, PORTFOLIO_STATE.partial);
  const exclusions = held.disclosures.find((group) => group.id === "exclusions");
  assert.equal(exclusions.rows.length, 1);
  assert.match(exclusions.rows[0].term, /Bedrock — misaligned period/);
  assert.match(exclusions.rows[0].detail, /Re-export Bedrock on calendar-month boundaries\./,
    "the exclusion does not carry the one action that recovers it");
});

test("an unpublishable total blocks every figure rather than showing one with a caveat", () => {
  for (const broken of [
    { spendUsd: -5 },
    { spendUsd: Number.NaN },
    { spendUsd: 2e12 },
    { spendUsd: 100, recoverableUsd: 900 },
  ]) {
    const brief = portfolioBrief(analysis(broken));
    assert.equal(brief.state, PORTFOLIO_STATE.blocked, `${JSON.stringify(broken)} was not blocked`);
    assert.equal(brief.alignedSpend.available, false);
    assert.equal(brief.alignedSpend.usd, null);
    assert.equal(brief.impact.available, false);
    assert.equal(brief.impact.usd, null);
    assert.match(brief.alignedSpend.detail, /withheld/);
  }
});

test("composition never apportions the merged total, and says where the split does come from", () => {
  const brief = portfolioBrief(analysis());
  const composition = brief.disclosures.find((group) => group.id === "composition");
  assert.equal(composition.rows.length, 2);
  assert.match(composition.note, /carries no per-provider spend column/);
  for (const row of composition.rows) {
    assert.doesNotMatch(row.detail, /USD/,
      `the composition row for ${row.term} invented a per-provider figure`);
    assert.match(row.detail, /adapter .+ v1\.0/, `${row.term} does not state the adapter that read it`);
  }
  // The per-provider figures are the aggregate's, re-derived from record-level
  // provider identity. This envelope carries none, and the group says so rather
  // than apportioning the merged total to fill itself in.
  const contribution = brief.disclosures.find((group) => group.id === "contribution");
  assert.equal(contribution.rows.length, 0);
  assert.match(contribution.note, /no per-provider split/);
});

test("period coverage and validation reasons are carried, not summarized away", () => {
  const brief = portfolioBrief(analysis({
    validation: {
      state: "needs_review",
      results: [{
        code: "duplicate_period", scope: "provider",
        message: "OpenAI supplies period 2026-01 more than once.",
        action: "Remove the duplicate export and choose files again.",
      }],
      quarantinedExportIds: ["exp_dupe"],
    },
  }));
  const coverage = brief.disclosures.find((group) => group.id === "coverage");
  assert.equal(coverage.rows.length, 3, "two aligned periods and the history sentence");
  assert.match(coverage.rows[0].detail, /210,000 USD aligned · export exp_dec/);
  const validation = brief.disclosures.find((group) => group.id === "validation");
  assert.match(validation.rows[0].term, /duplicate period \(provider\)/);
  assert.match(validation.rows[0].detail, /Remove the duplicate export/);
});

// --- 4 and 5. the shipped page ---------------------------------------------

const openPage = () => parseHtml(html);

test("the brief stays off the page until a portfolio exists, and the single answer is untouched", () => {
  const doc = openPage();
  const region = doc.getElementById("finops-portfolio-brief");
  const guided = doc.getElementById("guided-result");
  assert.ok(region, "the shipped page has no portfolio brief region");
  assert.equal(region.hidden, true, "the portfolio brief ships visible");
  assert.equal(region.dataset.workspaceRegion, "answer",
    "the portfolio brief does not belong to the answer destination");

  const brief = applyPortfolioBrief(doc, analysis({ multiProvider: null }));
  assert.equal(brief.available, false);
  assert.equal(region.hidden, true);
  assert.equal(region.dataset.state, "unavailable");
  assert.equal(guided.dataset.superseded, "false", "a single-provider answer was superseded anyway");
});

test("a portfolio leads the answer destination and leaves exactly one complete summary", () => {
  const doc = openPage();
  const region = doc.getElementById("finops-portfolio-brief");
  const guided = doc.getElementById("guided-result");
  // The state the page is in after a real import: the reader's own answer is
  // showing and the bundled example has stepped down.
  guided.hidden = false;
  doc.getElementById("finops-first-run").hidden = true;

  applyPortfolioBrief(doc, analysis());
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.state, "trusted");
  assert.equal(guided.hidden, true, "the single-provider answer stayed on screen beside the portfolio");
  assert.equal(guided.dataset.superseded, "true");
  const summaries = countCompleteSummaries(doc);
  assert.deepEqual(summaries.visibleIds, ["finops-portfolio-brief"]);
  assert.equal(summaries.visible, 1);

  // Every slot a lead is judged on is filled from the brief, in text.
  assert.equal(doc.getElementById("finops-portfolio-brief-total").textContent, "240,000 USD");
  assert.equal(doc.getElementById("finops-portfolio-brief-impact").textContent, "36,000 USD");
  assert.equal(doc.getElementById("finops-portfolio-brief-confidence").textContent, "moderate");
  assert.match(doc.getElementById("finops-portfolio-brief-benchmark").textContent, /15% of the aligned total/);
  assert.match(doc.getElementById("finops-portfolio-brief-action").textContent, /Pilot lower-cost routing/);
  assert.match(doc.getElementById("finops-portfolio-brief-provenance").textContent,
    /Combined in this browser tab from 2 provider exports/);
  // The state is a word before it is a tint, and the shape is not the only cue.
  assert.equal(doc.getElementById("finops-portfolio-brief-state").textContent, "Combined and complete");
  assert.match(doc.getElementById("finops-portfolio-brief-live").textContent,
    /Total aligned spend: 240,000 USD/);
});

test("clearing the import gives the single-provider answer back", () => {
  const doc = openPage();
  const guided = doc.getElementById("guided-result");
  guided.hidden = false;
  applyPortfolioBrief(doc, analysis());
  assert.equal(guided.hidden, true);

  clearPortfolioBrief(doc);
  assert.equal(doc.getElementById("finops-portfolio-brief").hidden, true);
  assert.equal(guided.hidden, false, "the single-provider answer was left hidden after a clear");
  assert.equal(guided.dataset.superseded, "false");
});

test("every evidence group is a native disclosure, collapsed, and never empty-bodied", () => {
  const doc = openPage();
  applyPortfolioBrief(doc, analysis());
  const host = doc.getElementById("finops-portfolio-brief-disclosures");
  const groups = [...host.querySelectorAll("details")];
  assert.equal(groups.length, PORTFOLIO_DISCLOSURES.length,
    "the evidence groups and the declared disclosure ids disagree");
  assert.deepEqual(groups.map((group) => group.dataset.disclosure), [...PORTFOLIO_DISCLOSURES]);
  for (const group of groups) {
    const summary = group.querySelector("summary");
    assert.ok(summary, `${group.dataset.disclosure} has no summary to operate`);
    // Native details/summary: focusable and operable from the keyboard with no
    // handler of ours, and announced as an expandable group.
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.equal(group.dataset.open, "false");
    assert.ok(group.getAttribute("aria-label"), `${group.dataset.disclosure} is unnamed`);
    assert.ok(group.querySelector(".portfolio-brief-disclosure-note"),
      `${group.dataset.disclosure} opens with no explanation`);
  }
  // Three of them have nothing to list on a clean portfolio with no aggregate;
  // each opens onto a sentence rather than an empty list.
  const empty = groups.filter((group) => group.querySelector(".portfolio-brief-disclosure-empty"));
  assert.deepEqual(empty.map((group) => group.dataset.disclosure),
    ["contribution", "exclusions", "validation"]);
  assert.equal(empty[0].querySelector(".portfolio-brief-disclosure-empty").textContent,
    "Nothing to list here.");
  assert.equal(host.querySelectorAll(".portfolio-brief-disclosure-rows").length, 2);
});

test("a repaint replaces the previous portfolio's rows rather than accumulating them", () => {
  const doc = openPage();
  const host = doc.getElementById("finops-portfolio-brief-disclosures");
  applyPortfolioBrief(doc, analysis());
  const first = host.querySelectorAll("details").length;
  applyPortfolioBrief(doc, analysis({ multiProvider: multiProvider({ state: "combined_bounded", notes: ["bounded"] }) }));
  const after = [...host.querySelectorAll("details")];
  assert.equal(after.length, first, "a second paint left the previous disclosures behind");
  assert.equal(doc.getElementById("finops-portfolio-brief").dataset.state, "partial");
  assert.equal(doc.getElementById("finops-portfolio-brief-state").textContent, "Combined and bounded");
});

test("a blocked portfolio keeps its headings and prints no money", () => {
  const doc = openPage();
  applyPortfolioBrief(doc, analysis({ spendUsd: 5e12 }));
  const region = doc.getElementById("finops-portfolio-brief");
  assert.equal(region.hidden, false, "a blocked portfolio left the reader with nothing");
  assert.equal(region.dataset.state, "blocked");
  assert.equal(doc.getElementById("finops-portfolio-brief-state").textContent,
    "Combined figures withheld");
  for (const id of ["finops-portfolio-brief-total", "finops-portfolio-brief-impact"]) {
    const slot = doc.getElementById(id);
    assert.equal(slot.textContent, "Withheld");
    assert.equal(slot.dataset.available, "false");
  }
  assert.doesNotMatch(region.textContent, /5,000,000,000,000/,
    "a withheld figure reached the page anyway");
});
