// The guided-result composition contract.
//
// Three imported analyses are exercised end to end — complete, partial, and
// unavailable — and each one asserts the same two things the issue asks a
// leader to be able to read off the page: what the primary finding is, and
// which supporting disclosures are permitted. Everything else here defends the
// rules that make those two answers reproducible: the precedence of an import
// over the bundled seed, the required trust verdict, unique action ranks, and a
// disclosure order that is a declared property of the contract rather than of
// the order a reader happened to select files in.
//
// Fixtures are built in this file rather than committed, so a shape change
// fails here instead of drifting silently in a JSON blob.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ACTION_CANDIDATES, GUIDED_RESULT_VERSION, GUIDED_UNAVAILABLE_REASON, PRIMARY_PANEL_ID,
  PRIMARY_QUESTION, RESULT_BASIS, SUPPORT_DISCLOSURES, TRUST_STATE,
  composeAction, composeBenchmark, composeDisclosures, composeGuidedResult, composeTrust,
} from "../src/finops-guided-result.js";
import {
  EXECUTIVE_PANELS, MIN_ATTRIBUTED_SHARE, MIN_SCORED_PROMPTS,
} from "../src/finops-panel-contract.js";
import { trustVerdict } from "../src/finops-trust-verdict.js";
import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  READINESS_LABEL, applyDisclosureRoles, applyGuidedResult,
} from "../src/finops-guided-result-view.js";

// ---------------------------------------------------------------------------
// Fixtures. Built, never committed.
// ---------------------------------------------------------------------------

const UNIT_A = "unit-aaaaaa";
const UNIT_B = "unit-bbbbbb";

/** A provider period export in the v1 envelope shape the trust verdict reads. */
function providerExport({ exportId, start, end, rows }) {
  return {
    export_id: exportId,
    snapshot: { period_start: start, period_end: end },
    records: rows.map((row, index) => ({
      aggregate_id: `${exportId}-${index}`,
      org_unit_id: row.unit,
      cost: { amount_minor: row.minor, currency: "USD" },
    })),
  };
}

/** An HRIS roster. `active` drives the confirmation rule the verdict applies. */
function roster(units) {
  return {
    export_id: "hris-1",
    snapshot: { period_start: "2026-06-01", period_end: "2026-07-01" },
    records: units.map((unit) => ({
      unit_id: unit.id, operation: "upsert", active: unit.active !== false,
    })),
  };
}

/** A graded corpus, in the shape `gradeImportedCorpus` publishes it. */
function grade({ gradeable = true, composite = 74, letter = "C", scored = MIN_SCORED_PROMPTS * 3 } = {}) {
  if (!gradeable) {
    return {
      version: "imported-corpus-grade/1.0.0", rubricVersionId: "rubric/1", gradeable: false,
      grade: null, composite: null,
      reason: "scored_records_below_eligibility_floor",
      reasonRule: "Fewer records scored than the floor the hero grade panel declares.",
      confidence: { level: null, basis: null },
      records: { source: scored, scored, unclassified: 0 },
      eligibility: { minScoredRecords: MIN_SCORED_PROMPTS, observed: scored, met: false },
      score: null,
    };
  }
  return {
    version: "imported-corpus-grade/1.0.0", rubricVersionId: "rubric/1", gradeable: true,
    grade: letter, composite, reason: null, reasonRule: null,
    confidence: { level: "moderate", basis: { arithmetic: `${scored} / ${MIN_SCORED_PROMPTS} = 3.00x` } },
    records: { source: scored + 2, scored, unclassified: 2 },
    eligibility: { minScoredRecords: MIN_SCORED_PROMPTS, observed: scored, met: true },
    score: { categories: [] },
  };
}

/**
 * A two-period analysis envelope with a growing department, in the shape
 * `normalizeLocalFinopsHistory` publishes it. `leadingFinding` reads exactly
 * these fields, so the driver and its paired action are real here.
 */
function analysisEnvelope({ topRecoverable = 900, growth = true } = {}) {
  return {
    schemaVersion: "local-finops-history/1.0.0",
    period: "2026-06-01 to 2026-07-01",
    spendUsd: 12000,
    recoverableUsd: topRecoverable,
    action: "Pilot lower-cost routing for text-generation in Core Services; cap the pilot at "
      + `${topRecoverable.toFixed(2)} USD and verify against a like-for-like period.`,
    topDepartment: { id: UNIT_A, name: "Core Services", recoverableUsd: topRecoverable },
    rankedDepartments: [
      {
        id: UNIT_A, name: "Core Services", spendUsd: 8000,
        previousSpendUsd: growth ? 6000 : 8000, recoverableUsd: topRecoverable,
      },
      {
        id: UNIT_B, name: "Support", spendUsd: 4000,
        previousSpendUsd: 4000, recoverableUsd: 100,
      },
    ],
    history: {
      state: "available",
      currentPeriod: "2026-06-01 to 2026-07-01",
      periods: [
        { period: "2026-05-01 to 2026-06-01", spendUsd: growth ? 10000 : 12000 },
        { period: "2026-06-01 to 2026-07-01", spendUsd: 12000 },
      ],
    },
  };
}

/** Panel facts for a rich import: every declared provider input is present. */
const COMPLETE_FACTS = Object.freeze({
  providerPeriodFiles: 2, costedRows: 40, orgUnitRows: 40,
  modelIdentifiedRows: 40, requestCountedRows: 40,
  attributedShare: 1, rankedDepartments: 2,
  scoredPrompts: MIN_SCORED_PROMPTS * 3, gradedDepartments: 2,
});

/** Panel facts for a thin import: a costed provider export and nothing else. */
const PARTIAL_FACTS = Object.freeze({
  providerPeriodFiles: 1, costedRows: 12, orgUnitRows: 12,
  attributedShare: 0.2, rankedDepartments: 1,
  scoredPrompts: 0, gradedDepartments: 0,
});

/** A fully attributed import: every dollar resolves to a confirmed unit. */
function completeVerdict() {
  return trustVerdict({
    providers: [providerExport({
      exportId: "prov-1", start: "2026-06-01", end: "2026-07-01",
      rows: [{ unit: UNIT_A, minor: 800000 }, { unit: UNIT_B, minor: 400000 }],
    })],
    hris: roster([{ id: UNIT_A }, { id: UNIT_B }]),
  });
}

/** A partial import: most of the money names a unit the roster has never heard of. */
function partialVerdict() {
  return trustVerdict({
    providers: [providerExport({
      exportId: "prov-1", start: "2026-06-01", end: "2026-07-01",
      rows: [{ unit: UNIT_A, minor: 100000 }, { unit: "unit-zzzzzz", minor: 900000 }],
    })],
    hris: roster([{ id: UNIT_A }]),
  });
}

/** An unavailable import: rows parsed, no money in any of them. */
function unavailableVerdict() {
  return trustVerdict({
    providers: [providerExport({
      exportId: "prov-1", start: "2026-06-01", end: "2026-07-01",
      rows: [{ unit: UNIT_A, minor: 0 }],
    })],
    hris: roster([{ id: UNIT_A }]),
  });
}

const permitted = (result) => result.disclosures.filter((entry) => entry.permitted)
  .map((entry) => entry.panelId);

// ---------------------------------------------------------------------------
// The contract's own invariants.
// ---------------------------------------------------------------------------

test("every declared panel is classified primary or support, exactly once", () => {
  const support = SUPPORT_DISCLOSURES.map((entry) => entry.panelId);
  assert.equal(new Set(support).size, support.length, "a panel is listed twice");
  assert.ok(!support.includes(PRIMARY_PANEL_ID), "the primary panel is also listed as support");
  assert.equal(support.length + 1, EXECUTIVE_PANELS.length);
  for (const panel of EXECUTIVE_PANELS) {
    assert.ok(panel.id === PRIMARY_PANEL_ID || support.includes(panel.id),
      `panel ${panel.id} is unclassified`);
  }
});

test("action ranks and disclosure ranks are unique, so selection needs no tie-break", () => {
  const actionRanks = ACTION_CANDIDATES.map((candidate) => candidate.rank);
  assert.equal(new Set(actionRanks).size, actionRanks.length);
  assert.deepEqual([...actionRanks].sort((a, b) => a - b), actionRanks,
    "candidates must be declared in rank order");
  const disclosureRanks = SUPPORT_DISCLOSURES.map((entry) => entry.rank);
  assert.equal(new Set(disclosureRanks).size, disclosureRanks.length);
});

test("disclosure order is the declared rank order and does not vary with input order", () => {
  const forward = composeDisclosures(COMPLETE_FACTS).map((entry) => entry.panelId);
  const empty = composeDisclosures({}).map((entry) => entry.panelId);
  assert.deepEqual(forward, empty, "order must not depend on which panels are answerable");
  assert.deepEqual(forward, SUPPORT_DISCLOSURES.map((entry) => entry.panelId));
});

test("the primary question is fixed and is not derived from the data", () => {
  assert.equal(PRIMARY_QUESTION, "What should we do now?");
  const imported = composeGuidedResult({
    imported: { grade: grade(), analysis: analysisEnvelope(), verdict: completeVerdict(), facts: COMPLETE_FACTS },
  });
  const bundled = composeGuidedResult({ bundled: { grade: grade(), facts: {} } });
  assert.equal(imported.question, PRIMARY_QUESTION);
  assert.equal(bundled.question, PRIMARY_QUESTION);
  assert.equal(imported.version, GUIDED_RESULT_VERSION);
});

// ---------------------------------------------------------------------------
// Precedence: an import outranks the bundled seed, structurally.
// ---------------------------------------------------------------------------

test("an imported analysis takes precedence: nothing bundled reaches the composition", () => {
  const result = composeGuidedResult({
    imported: {
      grade: grade({ composite: 74, letter: "C" }),
      analysis: analysisEnvelope(),
      verdict: completeVerdict(),
      facts: COMPLETE_FACTS,
    },
    bundled: {
      grade: grade({ composite: 91, letter: "A" }),
      analysis: analysisEnvelope({ topRecoverable: 99999 }),
      facts: COMPLETE_FACTS,
    },
  });
  assert.equal(result.basis, RESULT_BASIS.imported);
  assert.equal(result.benchmark.value, 74, "the bundled composite leaked into the benchmark");
  assert.equal(result.benchmark.letter, "C");
  assert.ok(!JSON.stringify(result).includes("99999"), "a bundled figure reached the output");
});

test("a verdict handed to the bundled side is ignored: synthetic data earns no trust verdict", () => {
  const result = composeGuidedResult({
    bundled: { grade: grade(), facts: COMPLETE_FACTS, verdict: completeVerdict() },
  });
  assert.equal(result.basis, RESULT_BASIS.synthetic);
  assert.equal(result.trust.state, TRUST_STATE.synthetic);
  assert.equal(result.trust.coveragePercent, null);
  assert.equal(result.decisionReady, false);
});

test("with neither side supplied the composition is unavailable and says which input is missing", () => {
  const result = composeGuidedResult();
  assert.equal(result.state, "unavailable");
  assert.equal(result.unavailable.reason, GUIDED_UNAVAILABLE_REASON.noResult);
  assert.equal(result.decisionReady, false);
  assert.deepEqual(result.disclosures, []);
});

// ---------------------------------------------------------------------------
// The three imported analyses the issue names.
// ---------------------------------------------------------------------------

test("complete import: the primary finding is the spend driver and every disclosure is permitted", () => {
  const result = composeGuidedResult({
    imported: {
      grade: grade(), analysis: analysisEnvelope(),
      verdict: completeVerdict(), facts: COMPLETE_FACTS,
    },
  });

  // Trust: required, satisfied, and the coverage figure is the verdict's own.
  assert.equal(result.trust.required, true);
  assert.equal(result.trust.state, TRUST_STATE.verified);
  assert.equal(result.trust.satisfied, true);
  assert.equal(result.trust.coveragePercent, 100);
  assert.equal(result.trust.totalUsd, 12000);
  assert.equal(result.decisionReady, true);

  // Benchmark: one, grade-backed, from the reader's own corpus.
  assert.equal(result.benchmark.available, true);
  assert.equal(result.benchmark.metricId, "ai_literacy_composite");
  assert.equal(result.benchmark.unit, "points (0-100)");
  assert.equal(result.benchmark.letter, "C");
  assert.equal(result.benchmark.basis, RESULT_BASIS.imported);

  // Action: exactly one, and it is the rank-2 driver action.
  assert.equal(result.action.available, true);
  assert.equal(result.action.id, "spend_driver");
  assert.equal(result.action.rank, 2);
  assert.equal(result.action.actionable, true);
  assert.equal(result.action.expectedEffect.unit, "USD");
  assert.equal(result.action.expectedEffect.value, 2000, "Core Services grew 8000 - 6000");
  assert.equal(result.primaryFinding, result.action.text);

  // Disclosures: everything the facts answer, in declared order, support only.
  assert.deepEqual(permitted(result), [
    "spend-and-recovery", "department-priority", "spend-mix", "high-value-share", "model-overspend",
  ]);
  for (const entry of result.disclosures) assert.equal(entry.role, "support");
  const peer = result.disclosures.find((entry) => entry.panelId === "peer-benchmark");
  assert.equal(peer.permitted, false);
  assert.equal(peer.unavailable.reason, "no_peer_cohort");
});

test("partial import: attribution below the floor demotes the answer to the repair step", () => {
  const verdict = partialVerdict();
  const result = composeGuidedResult({
    imported: {
      grade: grade({ gradeable: false, scored: 2 }),
      analysis: analysisEnvelope(),
      verdict,
      facts: PARTIAL_FACTS,
    },
  });

  assert.equal(result.trust.state, TRUST_STATE.belowFloor);
  assert.equal(result.trust.satisfied, false);
  assert.equal(result.trust.coveragePercent, 10);
  assert.ok(result.trust.coverage < MIN_ATTRIBUTED_SHARE);
  assert.equal(result.decisionReady, false, "an unattributable import is never decision-ready");

  // The benchmark refuses on its own floor, not on the attribution one, and it
  // quotes the hero panel's reason rather than authoring a second sentence.
  assert.equal(result.benchmark.available, false);
  assert.equal(result.benchmark.unavailable.reason, "scored_prompts_below_floor");

  // Rank 1 wins: the primary finding is the trust repair, sized in USD.
  assert.equal(result.action.id, "trust_repair");
  assert.equal(result.action.rank, 1);
  assert.equal(result.action.actionable, true);
  assert.equal(result.action.expectedEffect.value, 9000, "the unresolved rows are 900000 minor");
  assert.equal(result.action.control, "local-finops-files");
  assert.equal(result.primaryFinding, result.action.text);
  assert.ok(!result.primaryFinding.includes("routing"),
    "a routing pilot must not be prioritized over an unattributable import");

  // Only the panels the thin facts actually answer are permitted as support.
  assert.deepEqual(permitted(result), []);
  const spend = result.disclosures.find((entry) => entry.panelId === "spend-and-recovery");
  assert.equal(spend.unavailable.reason, "attributed_share_below_floor");
  assert.ok(spend.unavailable.need.length > 0);
});

test("unavailable import: no coverage percentage exists, and no action is invented", () => {
  const result = composeGuidedResult({
    imported: {
      grade: grade({ gradeable: false, scored: 0 }),
      analysis: null,
      verdict: unavailableVerdict(),
      facts: { providerPeriodFiles: 1, costedRows: 1 },
    },
  });

  assert.equal(result.trust.state, TRUST_STATE.unmeasurable);
  assert.equal(result.trust.satisfied, false);
  assert.equal(result.trust.coveragePercent, null, "an undefined ratio is null, never 0");
  assert.equal(result.decisionReady, false);

  assert.equal(result.benchmark.available, false);
  assert.equal(result.action.available, false);
  assert.equal(result.action.unavailable.reason, GUIDED_UNAVAILABLE_REASON.noEligibleAction);
  assert.equal(result.primaryFinding, result.action.unavailable.need);

  assert.deepEqual(permitted(result), []);
  assert.equal(result.disclosures.length, SUPPORT_DISCLOSURES.length,
    "an unanswerable panel is still listed, with the input that would answer it");
  for (const entry of result.disclosures) assert.ok(entry.unavailable.need.length > 0);
});

test("an import with no trust verdict at all publishes nothing decision-ready", () => {
  const result = composeGuidedResult({
    imported: { grade: grade(), analysis: analysisEnvelope(), verdict: null, facts: COMPLETE_FACTS },
  });
  assert.equal(result.trust.supplied, false);
  assert.equal(result.trust.unavailable.reason, GUIDED_UNAVAILABLE_REASON.noTrustVerdict);
  assert.equal(result.decisionReady, false);
  assert.equal(result.action.available, false);
});

// ---------------------------------------------------------------------------
// The synthetic path.
// ---------------------------------------------------------------------------

test("synthetic data prioritizes importing your own export, never a spend action", () => {
  const result = composeGuidedResult({
    bundled: { grade: grade(), analysis: analysisEnvelope(), facts: COMPLETE_FACTS },
  });
  assert.equal(result.basis, RESULT_BASIS.synthetic);
  assert.equal(result.decisionReady, false);
  assert.equal(result.action.id, "import_own_export");
  assert.equal(result.action.rank, 4);
  assert.equal(result.action.control, "local-finops-files");
  assert.equal(result.action.expectedEffect, null, "no dollar effect is claimed for invented data");
  assert.ok(!result.action.text.includes("Pilot lower-cost routing"),
    "the seed's routing recommendation must not become the guided answer");
  // The benchmark still publishes: the letter is the seed's, and the readiness
  // note beside it is what says the seed is invented.
  assert.equal(result.benchmark.available, true);
  assert.equal(result.benchmark.basis, RESULT_BASIS.synthetic);
});

// ---------------------------------------------------------------------------
// The selection rules in isolation.
// ---------------------------------------------------------------------------

test("a decision-ready analysis with no prior period falls to the rank-3 routing pilot", () => {
  const analysis = analysisEnvelope({ topRecoverable: 640 });
  analysis.history = { state: "single_period", periods: [{ period: "2026-06-01 to 2026-07-01", spendUsd: 12000 }] };
  const result = composeGuidedResult({
    imported: { grade: grade(), analysis, verdict: completeVerdict(), facts: COMPLETE_FACTS },
  });
  assert.equal(result.action.id, "routing_pilot");
  assert.equal(result.action.rank, 3);
  assert.equal(result.action.expectedEffect.value, 640);
  assert.ok(result.action.detail.includes("standing recommendation"));
});

test("a decision-ready analysis with nothing recoverable and no driver prioritizes nothing", () => {
  const analysis = analysisEnvelope({ topRecoverable: 0, growth: false });
  const result = composeAction({
    basis: RESULT_BASIS.imported,
    trust: composeTrust(completeVerdict(), RESULT_BASIS.imported),
    decisionReady: true,
    verdict: completeVerdict(),
    analysis,
    finding: { available: true, action: { available: false } },
  });
  assert.equal(result.available, false);
  assert.equal(result.unavailable.reason, GUIDED_UNAVAILABLE_REASON.noSpendDriver);
});

test("composeTrust repeats the verdict's ratio and never recomputes it", () => {
  const verdict = partialVerdict();
  const trust = composeTrust(verdict, RESULT_BASIS.imported);
  assert.equal(trust.coveragePercent, Math.round(verdict.headline.coveragePercent * 10) / 10);
  assert.equal(trust.attributedUsd, verdict.headline.attributedMinor / 100);
  assert.equal(trust.totalUsd, verdict.headline.totalMinor / 100);
  assert.equal(trust.coverageFloor, MIN_ATTRIBUTED_SHARE);
  assert.equal(trust.findingCount, verdict.findings.length);
});

test("mixed currencies are unmeasurable, not zero coverage", () => {
  const mixed = trustVerdict({
    providers: [{
      export_id: "prov-1",
      snapshot: { period_start: "2026-06-01", period_end: "2026-07-01" },
      records: [
        { aggregate_id: "a", org_unit_id: UNIT_A, cost: { amount_minor: 100, currency: "USD" } },
        { aggregate_id: "b", org_unit_id: UNIT_A, cost: { amount_minor: 100, currency: "EUR" } },
      ],
    }],
    hris: roster([{ id: UNIT_A }]),
  });
  const trust = composeTrust(mixed, RESULT_BASIS.imported);
  assert.equal(trust.state, TRUST_STATE.unmeasurable);
  assert.equal(trust.coverage, null);
});

test("composeBenchmark publishes the rubric's own letter and composite, unrounded", () => {
  const benchmark = composeBenchmark(grade({ composite: 83, letter: "B" }), { basis: RESULT_BASIS.imported });
  assert.equal(benchmark.value, 83);
  assert.equal(benchmark.letter, "B");
  assert.equal(benchmark.confidenceLevel, "moderate");
  assert.equal(benchmark.floor, MIN_SCORED_PROMPTS);
});

// ---------------------------------------------------------------------------
// The view. Nothing here decides anything; it asserts the composition reached
// the DOM and that the demotion is written where a reader can check it.
// ---------------------------------------------------------------------------

const VIEW_DOM = `
  <section id="guided-result" hidden>
    <h2 id="guided-result-question"></h2>
    <p id="guided-result-finding"></p>
    <p id="guided-result-readiness" data-ready="false"></p>
    <p id="guided-result-benchmark" data-available="false"></p>
    <p id="guided-result-benchmark-detail"></p>
    <p id="guided-result-trust" data-satisfied="false"></p>
    <p id="guided-result-action" data-actionable="false"></p>
    <p id="guided-result-action-effect"></p>
    <button id="guided-result-action-control" hidden></button>
    <details id="guided-result-support"><ol id="guided-result-disclosures"></ol></details>
  </section>
  <input id="local-finops-files">
  <div id="score-card"></div>
  <div id="kpi-row"></div>
  <div id="spend-mix-panel"></div>`;

test("the view writes the composition and stamps the demotion onto the panels", () => {
  const document = parseHtml(VIEW_DOM);
  const result = composeGuidedResult({
    imported: {
      grade: grade(), analysis: analysisEnvelope(),
      verdict: completeVerdict(), facts: COMPLETE_FACTS,
    },
  });
  applyGuidedResult(document, result);
  applyDisclosureRoles(document, result.disclosures);

  const root = document.getElementById("guided-result");
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.decisionReady, "true");
  assert.equal(root.dataset.contractVersion, GUIDED_RESULT_VERSION);
  assert.equal(document.getElementById("guided-result-question").textContent, PRIMARY_QUESTION);
  assert.equal(document.getElementById("guided-result-finding").textContent, result.primaryFinding);
  assert.equal(document.getElementById("guided-result-readiness").textContent,
    READINESS_LABEL[TRUST_STATE.verified]);
  assert.equal(document.getElementById("guided-result-benchmark").dataset.available, "true");
  assert.equal(document.getElementById("guided-result-action").dataset.actionId, "spend_driver");
  assert.equal(document.getElementById("guided-result-action").dataset.actionRank, "2");
  assert.equal(document.getElementById("guided-result-action-control").hidden, true,
    "an action without an in-page control must not grow a dead button");
  assert.equal(root.dataset.supportExpanded, "false");

  // The primary panel is marked primary; a support panel carries its rank.
  assert.equal(document.getElementById("score-card").dataset.panelRole, "primary");
  assert.equal(document.getElementById("kpi-row").dataset.panelRole, "support");
  assert.equal(document.getElementById("kpi-row").dataset.disclosureRank, "1");
  assert.equal(document.getElementById("spend-mix-panel").dataset.panelRole, "support");
  assert.equal(document.getElementById("spend-mix-panel").dataset.disclosureRank, "3");

  // Every declared support panel is listed, permitted or not.
  const items = [...document.getElementById("guided-result-disclosures").children];
  assert.equal(items.length, SUPPORT_DISCLOSURES.length);
  assert.deepEqual(items.map((item) => item.dataset.panelId),
    SUPPORT_DISCLOSURES.map((entry) => entry.panelId));
  assert.equal(items.at(-1).dataset.permitted, "false");
});

test("the view names the refusal when nothing can be prioritized", () => {
  const document = parseHtml(VIEW_DOM);
  const result = composeGuidedResult({
    imported: {
      grade: grade({ gradeable: false, scored: 0 }), analysis: null,
      verdict: unavailableVerdict(), facts: {},
    },
  });
  applyGuidedResult(document, result);
  const action = document.getElementById("guided-result-action");
  assert.equal(action.dataset.actionable, "false");
  assert.equal(action.dataset.unavailableReason, GUIDED_UNAVAILABLE_REASON.noEligibleAction);
  assert.equal(document.getElementById("guided-result-benchmark").dataset.available, "false");
  assert.equal(document.getElementById("guided-result-readiness").dataset.ready, "false");
});

test("a contract-named action exposes an operable control and disclosure state", () => {
  const document = parseHtml(VIEW_DOM);
  const result = composeGuidedResult({
    bundled: { grade: grade(), analysis: analysisEnvelope(), facts: COMPLETE_FACTS },
  });
  applyGuidedResult(document, result);

  const button = document.getElementById("guided-result-action-control");
  assert.equal(button.hidden, false);
  assert.equal(button.dataset.target, "local-finops-files");

  const disclosure = document.getElementById("guided-result-support");
  disclosure.open = true;
  disclosure.dispatchEvent({ type: "toggle" });
  assert.equal(document.getElementById("guided-result").dataset.supportExpanded, "true");
});

// ---------------------------------------------------------------------------
// The words in the slots. A visitor reads this section before they read any
// number in it, so what an empty slot says is as much a result as a figure is.
// ---------------------------------------------------------------------------

const SLOT_IDS = ["guided-result-benchmark", "guided-result-trust", "guided-result-action"];

/** A value that tells a reader nothing: a dash, or a word torn off a label. */
const PLACEHOLDER = /^(—|-|–|required|one|n\/a)$/i;

test("an empty slot says findings are not available yet, never a bare dash", () => {
  const document = parseHtml(VIEW_DOM);
  // The composition with neither an import nor a bundled seed: every slot is
  // null, which is the one state where the view supplies the words itself.
  const result = composeGuidedResult({});
  applyGuidedResult(document, result);

  for (const id of SLOT_IDS) {
    const text = textOf(document.getElementById(id));
    assert.doesNotMatch(text, PLACEHOLDER, `${id} must not render a placeholder as its value`);
    assert.match(text, /[Nn]ot available yet/, `${id} must say it is not available yet`);
  }
  // And the missing input is named where the reader can act on it, rather than
  // left to be inferred from an empty benchmark.
  assert.match(textOf(document.getElementById("guided-result-benchmark-detail")),
    /Choose one provider period export below/);
  assert.match(textOf(document.getElementById("guided-result-finding")),
    /Findings are not available yet/);
  assert.match(textOf(document.getElementById("guided-result-readiness")), /Not decision-ready/);
});

test("an ungradeable benchmark says it is not available and names what the dataset lacks", () => {
  const document = parseHtml(VIEW_DOM);
  applyGuidedResult(document, composeGuidedResult({
    imported: {
      grade: grade({ gradeable: false, scored: 0 }), analysis: null,
      verdict: unavailableVerdict(), facts: {},
    },
  }));
  const value = textOf(document.getElementById("guided-result-benchmark"));
  assert.doesNotMatch(value, PLACEHOLDER);
  assert.match(value, /Not available yet/);
  assert.match(textOf(document.getElementById("guided-result-benchmark-detail")),
    /scored records this benchmark needs/);
});

test("before any file is chosen the action names both required files and the CTA", () => {
  const document = parseHtml(VIEW_DOM);
  applyGuidedResult(document, composeGuidedResult({
    bundled: { grade: grade(), analysis: analysisEnvelope(), facts: COMPLETE_FACTS },
  }));
  const action = textOf(document.getElementById("guided-result-action"));
  // Only the one required input is asked for. The org mapping is an optional
  // precision upgrade in the panel below, so naming it here would read as a gate.
  assert.match(action, /Choose one provider period export/);
  assert.doesNotMatch(action, /HRIS/);
  // The sentence sends the visitor to the picker, and the control it names is
  // the picker — so the words and the button cannot point at different things.
  assert.match(action, /in the panel below/);
  assert.equal(document.getElementById("guided-result-action-control").dataset.target,
    "local-finops-files");
});

test("the authored markup states the absence and ships no placeholder slot values", async () => {
  const document = parseHtml(await readFile(new URL("../src/evolution.html", import.meta.url), "utf8"));

  // What a visitor sees before the composition exists. It names the missing
  // answer rather than this module's internals — and rather than narrating a
  // load, which only #finops-load-state is allowed to do.
  const finding = textOf(document.getElementById("guided-result-finding"));
  assert.match(finding, /^No next step ranked yet$/);
  assert.doesNotMatch(finding, /Composing|Loading/);

  for (const id of SLOT_IDS) {
    assert.doesNotMatch(textOf(document.getElementById(id)), PLACEHOLDER,
      `${id} ships a placeholder a visitor could read as a result`);
  }
  // The slot labels name one concept each. "required" and "one" are properties
  // of the contract, not answers, and they used to hang off the label where they
  // read as the value beside them.
  for (const label of document.querySelectorAll(".guided-result-label")) {
    assert.doesNotMatch(textOf(label), /—/, `"${textOf(label)}" carries a dangling qualifier`);
  }

  // The standing promise about the reader's files, said before they choose one.
  // No rewording above may quietly cost them it.
  const boundary = textOf(document.querySelector(".privacy-boundary"));
  assert.match(boundary, /Your files do not leave this tab\./);
  assert.match(boundary, /No upload/);
});

// ---------------------------------------------------------------------------
// The shipped page. The wiring, not the contract: the composition has to reach
// the real document through the real entry module, on the bundled first paint a
// visitor actually meets.
// ---------------------------------------------------------------------------

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

test("the live demo composes a guided result on first paint, marked not decision-ready", async () => {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  const { document } = page;

  const root = document.getElementById("guided-result");
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.basis, RESULT_BASIS.synthetic);
  assert.equal(root.dataset.decisionReady, "false",
    "bundled synthetic data must never present itself as a basis for a decision");
  assert.equal(document.getElementById("guided-result-question").textContent, PRIMARY_QUESTION);
  assert.equal(document.getElementById("guided-result-action").dataset.actionId, "import_own_export");
  assert.equal(document.getElementById("guided-result-action-control").hidden, false);
  assert.equal(root.dataset.supportExpanded, "false");
  // The first paint a visitor meets names the one file that would replace the
  // bundled sample with their own, and points at the picker below.
  assert.match(textOf(document.getElementById("guided-result-finding")),
    /Choose one provider period export in the panel below/);

  // Every executive panel on the shipped page is stamped with the role the
  // contract gave it, and only one of them is primary.
  const roles = EXECUTIVE_PANELS.map((panel) => [
    panel.id, document.getElementById(panel.elementId)?.dataset.panelRole]);
  for (const [id, role] of roles) {
    assert.ok(role === "primary" || role === "support", `${id} carries no declared role`);
  }
  assert.equal(roles.filter(([, role]) => role === "primary").length, 1);

  // The disclosure index lists every support panel, in declared rank order.
  const items = [...document.getElementById("guided-result-disclosures").children];
  assert.deepEqual(items.map((item) => item.dataset.panelId),
    SUPPORT_DISCLOSURES.map((entry) => entry.panelId));
});

// ---------------------------------------------------------------------------
// The boundary. Nothing in a composition may carry content from a source file.
// ---------------------------------------------------------------------------

test("no composition carries a raw org identifier, a prompt, or a credential-shaped string", () => {
  for (const result of [
    composeGuidedResult({
      imported: {
        grade: grade(), analysis: analysisEnvelope(),
        verdict: partialVerdict(), facts: PARTIAL_FACTS,
      },
    }),
    composeGuidedResult({ bundled: { grade: grade(), facts: COMPLETE_FACTS } }),
  ]) {
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("unit-zzzzzz"),
      "a whole opaque org identifier reached the composition");
    assert.ok(!/sk-[A-Za-z0-9]{12,}|bearer\s/i.test(serialized));
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(serialized));
  }
});
