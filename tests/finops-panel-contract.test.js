// The executive panel contract, and the regression it exists to prevent.
//
// Before this contract, importing a provider export removed the hero grade and
// five other panels from the AI FinOps page. A leader who brought one invoice
// was left with fewer questions answered and no statement of what would answer
// them. The first half of this file pins the contract's arithmetic; the second
// half drives the real page with the real fixtures and proves the panels are
// still there afterwards.
//
// Determinism: no clock, no network beyond the page's own bundled fixtures, no
// sleeps. Every wait is on state the page produces.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  EXECUTIVE_PANELS, MIN_ATTRIBUTED_SHARE, MIN_SCORED_PROMPTS, PANEL_CONTRACT_VERSION, PANEL_FACTS,
  PANEL_UNAVAILABLE_REASON, examplePanelFacts, importedPanelFacts, panelFacts,
  panelState, panelStates,
} from "../src/finops-panel-contract.js";
import { PROMPT_GRADING_THRESHOLDS } from "../src/prompt-grading-eligibility.js";
import { ATTRIBUTION_RANKED_FINDING_FLOOR } from "../src/finops-attribution-policy.js";

// ---------------------------------------------------------------------------
// The contract itself.
// ---------------------------------------------------------------------------

test("every declared panel names one question, one element, and inputs that exist", () => {
  assert.ok(EXECUTIVE_PANELS.length >= 6, "the executive page has more than a handful of panels");
  const ids = new Set();
  for (const panel of EXECUTIVE_PANELS) {
    assert.equal(ids.has(panel.id), false, `${panel.id} is declared twice`);
    ids.add(panel.id);
    assert.match(panel.question, /\?$/, `${panel.id} must declare a question, not a heading`);
    assert.ok(panel.metric.length > 40,
      `${panel.id} must define its metric precisely enough for two engineers to compute it`);
    assert.ok(panel.requirements.length >= 1, `${panel.id} must declare what answers it`);
    assert.ok(panel.figures.length >= 1, `${panel.id} must declare which nodes carry a figure`);
    for (const entry of panel.requirements) {
      assert.ok(entry.fact in PANEL_FACTS, `${panel.id} names an undeclared fact: ${entry.fact}`);
      assert.ok(entry.atLeast > 0, `${panel.id}/${entry.fact} needs a positive threshold`);
      assert.ok(["file", "field"].includes(entry.kind));
      assert.ok(entry.need.length > 40, `${panel.id}/${entry.fact} must say what to do next`);
    }
  }
});

test("every declared input carries the stable code a caller refuses with", () => {
  assert.equal(PANEL_CONTRACT_VERSION, "executive-panel-contract/1.1.0",
    "adding reason codes to the exported state is a contract-shape change");
  const codes = new Set(Object.values(PANEL_UNAVAILABLE_REASON));
  assert.equal(codes.size, Object.keys(PANEL_FACTS).length,
    "one code per fact, none shared: a shared code cannot say which input is missing");
  for (const fact of Object.keys(PANEL_FACTS)) {
    assert.ok(PANEL_UNAVAILABLE_REASON[fact], `${fact} may be required and has no reason code`);
  }
  for (const panel of EXECUTIVE_PANELS) {
    for (const entry of panel.requirements) {
      assert.equal(entry.reason, PANEL_UNAVAILABLE_REASON[entry.fact],
        `${panel.id}/${entry.fact} must refuse with the declared code`);
    }
  }
  // The code is on the state and on the sentence, so a card, a log line, and an
  // exported briefing all name one gap the same way.
  const nothing = panelStates({});
  for (const state of nothing) {
    assert.equal(state.reason, state.blocking.reason);
    assert.equal(state.message.reason, state.blocking.reason);
  }
  const answered = panelState(EXECUTIVE_PANELS.find((entry) => entry.id === "high-value-share"),
    { scoredPrompts: MIN_SCORED_PROMPTS });
  assert.equal(answered.reason, null, "an answerable panel has nothing to refuse with");
});

test("thresholds are the published ones, not a second opinion", () => {
  assert.equal(MIN_SCORED_PROMPTS, PROMPT_GRADING_THRESHOLDS.minPromptsPerDepartment);
  assert.equal(MIN_ATTRIBUTED_SHARE, ATTRIBUTION_RANKED_FINDING_FLOOR);
});

test("with nothing imported every panel is unavailable and names exactly one input", () => {
  const states = panelStates({});
  assert.equal(states.length, EXECUTIVE_PANELS.length);
  for (const state of states) {
    assert.equal(state.available, false, `${state.id} claims to be answerable from nothing`);
    assert.ok(state.message.need.length > 0);
    assert.equal(state.message.needLabel, state.missing[0].label,
      "the sentence must name the first unmet input, never a later one");
    assert.equal(state.blocking, state.missing[0]);
  }
});

test("the named input is the first unmet requirement in declaration order, always", () => {
  const panel = EXECUTIVE_PANELS.find((entry) => entry.id === "department-priority");
  // A provider file with a cost column and nothing else: the org-unit column is
  // the third requirement and the first one that is unmet.
  const partial = panelState(panel, { providerPeriodFiles: 1, costedRows: 3 });
  assert.equal(partial.available, false);
  assert.equal(partial.blocking.fact, "orgUnitRows");
  assert.match(partial.message.need, /org_unit_id/);
  assert.match(partial.message.rest, /^2 further declared inputs remain/);

  // Add the column but leave the values unmatched: the floor is next, and the
  // remaining count falls with it. The order never depends on selection order.
  const grouped = panelState(panel, {
    providerPeriodFiles: 1, costedRows: 3, orgUnitRows: 3, attributedShare: 0.2,
  });
  assert.equal(grouped.blocking.fact, "attributedShare");
  assert.match(grouped.message.rest, /^1 further declared input remains/);

  // Everything at or above its threshold: answerable, with no sentence at all.
  const answered = panelState(panel, {
    providerPeriodFiles: 1, costedRows: 3, orgUnitRows: 3,
    attributedShare: MIN_ATTRIBUTED_SHARE, rankedDepartments: 2,
  });
  assert.equal(answered.available, true);
  assert.equal(answered.message, null);
});

test("a threshold is met at the boundary and missed just below it, with no third state", () => {
  const hero = EXECUTIVE_PANELS.find((entry) => entry.id === "hero-grade");
  const at = panelState(hero, { scoredPrompts: MIN_SCORED_PROMPTS, gradedDepartments: 1 });
  const below = panelState(hero, { scoredPrompts: MIN_SCORED_PROMPTS - 1, gradedDepartments: 1 });
  assert.equal(at.available, true);
  assert.equal(below.available, false);
  assert.equal(below.blocking.fact, "scoredPrompts");

  // Absent, negative, and non-finite are all "we counted none of these". A
  // third state is where two engineers start disagreeing about a panel.
  for (const value of [undefined, null, -4, Number.NaN, "12"]) {
    assert.equal(panelFacts({ scoredPrompts: value }).scoredPrompts, 0);
  }
});

test("provider facts are counted off the declared fields of the parsed envelope", () => {
  const envelope = {
    document: {
      records: [
        { cost: { amount_minor: 41275 }, org_unit_id: "atlas", usage: { model_raw: "gpt-x", request_count: 12 } },
        { cost: { amount_minor: 3140 }, org_unit_id: null, usage: { model_raw: null, request_count: null } },
        { cost: {}, org_unit_id: "cinder" },
      ],
    },
  };
  const facts = importedPanelFacts({
    providers: [envelope], result: { rankedDepartments: [{ id: "atlas" }] },
    attributedShare: 0.81, scoredPrompts: 0, gradedDepartments: 0,
  });
  assert.equal(facts.providerPeriodFiles, 1);
  assert.equal(facts.costedRows, 2);
  assert.equal(facts.orgUnitRows, 2);
  assert.equal(facts.modelIdentifiedRows, 1);
  assert.equal(facts.requestCountedRows, 1);
  assert.equal(facts.rankedDepartments, 1);
  // The three the bundled seed alone can supply are counted as absent for an
  // import, which is what keeps their panels honest rather than silent.
  assert.equal(facts.actionOutcomeRecords, 0);
  assert.equal(facts.evaluationRecords, 0);
  assert.equal(facts.peerCohortRecords, 0);
});

test("the same facts always produce the same states, whatever key order they arrive in", () => {
  const forward = panelStates({ providerPeriodFiles: 1, costedRows: 3, attributedShare: 0.9 });
  const reverse = panelStates({ attributedShare: 0.9, costedRows: 3, providerPeriodFiles: 1 });
  assert.deepEqual(forward.map((entry) => [entry.id, entry.available, entry.blocking?.fact ?? null]),
    reverse.map((entry) => [entry.id, entry.available, entry.blocking?.fact ?? null]));
});

test("the bundled seed answers its own panels; an empty seed answers none", () => {
  const seed = {
    organization: { peerCohort: "Enterprise SaaS" },
    actionPlan: { actions: [{ id: "a1" }] },
    departments: [
      { id: "data-ml", spendUsd: 52140, sampling: { status: "available", sampledQueries: 620 } },
      { id: "support", spendUsd: 1200, sampling: { status: "unavailable", sampledQueries: 0 } },
    ],
  };
  const facts = examplePanelFacts(seed, { evaluationRecords: 3, modelFindingRows: 1 });
  assert.equal(facts.scoredPrompts, 620);
  assert.equal(facts.gradedDepartments, 1);
  assert.equal(facts.peerCohortRecords, 1);
  assert.equal(facts.actionOutcomeRecords, 1);
  assert.equal(panelStates(facts).every((state) => state.available), true,
    "the bundled seed is what every bundled panel is drawn from");
  assert.equal(panelStates(examplePanelFacts(null)).some((state) => state.available), false,
    "a seed that never loaded supplies nothing");
});

// ---------------------------------------------------------------------------
// The page. Real markup, real entry module, real fixtures.
// ---------------------------------------------------------------------------

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const EXAMPLE_EXPORTS = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);
const PROVIDER_EXPORT = await readFile(new URL("openai-usage-export.csv", EXAMPLE_EXPORTS), "utf8");
const ORG_ROSTER = await readFile(new URL("generic-hris-roster.csv", EXAMPLE_EXPORTS), "utf8");
const JOINABLE_EXPORT = PROVIDER_EXPORT
  .replace(/atlas-platform/g, "Atlas Platform")
  .replace(/boreal-support/g, "Boreal Support");

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

function chooseFiles(document, files) {
  const input = document.getElementById("local-finops-files");
  input.files = files.map(({ name, text }) => ({ name, type: "text/csv", text: async () => text }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

/** Walk the mapping step through to the analysis, confirming each file. */
async function importExports(document) {
  chooseFiles(document, [
    { name: "openai-usage-export.csv", text: JOINABLE_EXPORT },
    { name: "generic-hris-roster.csv", text: ORG_ROSTER },
  ]);
  await waitFor(() => !document.getElementById("import-mapping").hidden, "the mapping step");
  document.getElementById("import-mapping-confirm").click();
  await waitFor(() => textOf(document.getElementById("import-mapping-file")) === "generic-hris-roster.csv",
    "the roster review");
  document.getElementById("import-mapping-confirm").click();
  await waitFor(() => !document.getElementById("local-results").hidden, "the decision brief");
}

test("importing a provider export does not remove one panel from the page", async () => {
  const { document } = await openFinopsTab();
  const before = EXECUTIVE_PANELS.map((panel) => {
    const node = document.getElementById(panel.elementId);
    assert.ok(node, `${panel.id} must be authored in the page as #${panel.elementId}`);
    return node;
  });

  await importExports(document);

  for (const [index, panel] of EXECUTIVE_PANELS.entries()) {
    const node = document.getElementById(panel.elementId);
    assert.ok(node, `${panel.id} left the document when a provider export was imported`);
    assert.equal(node, before[index], `${panel.id} was replaced rather than repainted`);
    assert.equal(node.hidden, false, `${panel.id} was hidden by an import instead of answering`);
    assert.ok(["available", "unavailable"].includes(node.dataset.panelState),
      `${panel.id} must carry a contract-derived state, not an ad-hoc one`);
  }
});

test("after an import a CTO can read every panel's answer, or what would answer it", async () => {
  const { document } = await openFinopsTab();
  await importExports(document);

  for (const panel of EXECUTIVE_PANELS) {
    const node = document.getElementById(panel.elementId);
    const note = document.getElementById(`${panel.id}-unavailable`);
    if (node.dataset.panelState === "available") {
      assert.equal(note?.hidden ?? true, true, `${panel.id} is answerable and must show no excuse`);
      continue;
    }
    // Unanswerable: the question stays, the synthetic figures go, and one input
    // is named. Nothing is left for a leader to infer.
    assert.ok(note && !note.hidden, `${panel.id} went quiet instead of saying why`);
    const said = textOf(note);
    assert.match(said, /Not answerable from your import yet/);
    assert.ok(said.includes(panel.question), `${panel.id} must keep its question on screen`);
    assert.match(said, /Needed next · .+: .+/,
      `${panel.id} must name the one input that would answer it`);
    for (const figureId of panel.figures) {
      const figure = document.getElementById(figureId);
      if (figure) assert.equal(figure.hidden, true,
        `${panel.id} left the bundled figure ${figureId} on screen under an imported heading`);
    }
  }
});

test("the imported analysis keeps the hero grade and the department panel on the page", async () => {
  const { document } = await openFinopsTab();
  await importExports(document);

  // The two panels this regression is about. The hero grade cannot be answered
  // by an invoice, so it says which file grades prompts; the department ranking
  // can be, and the fixture joins above the attribution floor.
  const hero = document.getElementById("score-card");
  assert.equal(hero.hidden, false);
  assert.equal(hero.dataset.panelState, "unavailable");
  assert.match(textOf(document.getElementById("hero-grade-unavailable")), /query sample/i);

  const departments = document.getElementById("department-decision-panel");
  assert.equal(departments.hidden, false);
  assert.equal(departments.dataset.panelState, "available");
  assert.equal(document.getElementById("decision-layout").hidden, false);
});

test("the static proof point is marked illustrative before its figures, and more so over an import", async () => {
  const { document } = await openFinopsTab();
  const marker = document.getElementById("proof-point-illustrative");
  const article = document.querySelector(".proof-point");
  assert.ok(article.children.indexOf(marker) < article.children.indexOf(article.querySelector(".proof-point-facts")),
    "the marker must be read before the numbers it qualifies");
  assert.match(textOf(marker), /Illustrative figures/);
  assert.match(textOf(marker), /invented example data/);
  assert.match(textOf(marker), /not your spend or realized savings/);
  // A count, not the node: `assert.equal(node, null)` serializes the whole
  // parsed page on failure and hangs past the test timeout instead of failing.
  assert.equal(document.querySelectorAll(".proof-point-boundary").length, 0,
    "the full boundary must not repeat after the illustrative result");

  await importExports(document);
  assert.equal(marker.dataset.basis, "illustrative-over-import");
  assert.match(textOf(marker), /not your import/);
  assert.match(textOf(marker), /larger than the result computed from your own file/);
});

test("returning to example data restores every panel from the same contract", async () => {
  const { document } = await openFinopsTab();
  await importExports(document);
  document.getElementById("clear-local-analysis").click();

  for (const panel of EXECUTIVE_PANELS) {
    const node = document.getElementById(panel.elementId);
    assert.equal(node.hidden, false, `${panel.id} did not come back`);
    if (panel.id === "model-overspend") continue; // its bundled fixture is fetched only for the example run
    assert.equal(node.dataset.panelState, "available",
      `${panel.id} must be answerable again from the bundled seed`);
  }
});
