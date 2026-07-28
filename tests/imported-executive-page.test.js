// An import has to land on the whole executive page, not a corner of it.
//
// Two halves. The first drives the two pure adapters directly: the hero grade a
// visitor's own corpus earns, and the department drill-down rebuilt from their
// own analysis. The second boots the shipped page and walks a leader through
// every state the import panel can put it in — bundled, imported, re-mapped,
// cleared, imported again with a file that attributes nothing — asserting after
// each one that no executive panel has left the DOM.
//
// The panel-absence assertion is the regression this file exists for. Before
// the contract landed, an import unmounted six panels; the danger now is subtler
// and the same shape — a surface that keeps *answering* after the data under it
// was replaced. So every state is checked twice: nothing is missing, and what is
// on screen belongs to whoever's analysis is on screen.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { EXECUTIVE_PANELS, MIN_SCORED_PROMPTS } from "../src/finops-panel-contract.js";
import { gradeImportedCorpus } from "../src/imported-corpus-grade.js";
import { importedHeroGrade } from "../src/imported-hero-grade-view.js";
import {
  importedDecisionData, importedDepartmentLiteracy, samplingReasonText,
} from "../src/imported-department-decisions.js";

// ---------------------------------------------------------------------------
// The hero grade, from the visitor's own corpus.
// ---------------------------------------------------------------------------

/** `count` scored records plus `unscored` rows the rubric will not recognize. */
function corpusOf(count, unscored = 0) {
  return [
    ...Array.from({ length: count }, () => ({ category: "highValue", model: "gpt-4o" })),
    ...Array.from({ length: unscored }, () => ({ category: "not-a-category", model: "gpt-4o" })),
  ];
}

test("a graded corpus puts the letter, the confidence and the record count in one line", () => {
  const hero = importedHeroGrade(gradeImportedCorpus(corpusOf(MIN_SCORED_PROMPTS * 4)),
    { files: ["sample.csv"] });

  assert.equal(hero.available, true);
  assert.equal(hero.grade, "A");
  assert.match(hero.value, /100 \/ 100 · grade A/);
  // Grade, confidence and sample size in one line of sight is the whole point:
  // a letter whose denominator sits elsewhere is a letter quoted without it.
  assert.match(hero.coverage, /High confidence/);
  assert.match(hero.coverage, new RegExp(`${MIN_SCORED_PROMPTS * 4} of ${MIN_SCORED_PROMPTS * 4} imported records scored`));
  assert.match(hero.coverage, /sample\.csv/);
  // The arithmetic behind the named confidence travels with it.
  assert.match(hero.peer, /4\.00x/);
  assert.equal(hero.action.available, false, "a corpus at the top tier is not asked for more");
  assert.match(hero.action.text, /high-confidence floor/);
});

test("a thinner graded corpus is told exactly how many records raise its confidence", () => {
  const hero = importedHeroGrade(gradeImportedCorpus(corpusOf(MIN_SCORED_PROMPTS)));

  assert.equal(hero.available, true);
  assert.match(hero.coverage, /Low confidence/);
  assert.equal(hero.action.available, true);
  // One next step, with the shortfall counted rather than described.
  assert.match(hero.action.text,
    new RegExp(`Add ${MIN_SCORED_PROMPTS} more scored records to reach ${MIN_SCORED_PROMPTS * 2}`));
  assert.match(hero.action.text, /moderate confidence/);
});

test("a corpus under the floor publishes no letter and names the shortfall", () => {
  const short = MIN_SCORED_PROMPTS - 3;
  const hero = importedHeroGrade(gradeImportedCorpus(corpusOf(short)));

  assert.equal(hero.available, false);
  assert.equal(hero.grade, "!");
  assert.match(hero.value, new RegExp(`No grade · ${short} of ${short} imported records scored`));
  assert.match(hero.action.text, /Add 3 more scored records/);
  assert.match(hero.action.text, new RegExp(`declared floor is ${MIN_SCORED_PROMPTS}`));
});

test("a provider invoice with no query sample is told which file grades prompts", () => {
  const hero = importedHeroGrade(gradeImportedCorpus([]));

  assert.equal(hero.available, false);
  assert.equal(hero.action.available, false, "there is no partial step to offer");
  assert.match(hero.action.text, /Add a query sample export/);
});

test("records that scored none of their rows are told the category column is empty", () => {
  const hero = importedHeroGrade(gradeImportedCorpus(corpusOf(0, 40)));

  assert.equal(hero.available, false);
  assert.match(hero.action.text, /Fill the category column/);
  assert.match(hero.action.text, /40 records were read/);
});

// ---------------------------------------------------------------------------
// The department drill-down, from the visitor's own analysis.
// ---------------------------------------------------------------------------

const ANALYSIS = Object.freeze({
  period: "2026-05-01 to 2026-05-31",
  provenance: "Browser-local projection of provider export exp-1.",
  quality: { hrisCompleteness: null },
  literacy: { departments: [] },
  rankedDepartments: [
    {
      id: "atlas", name: "Atlas Platform", spendUsd: 412.75, recoverableUsd: 90.5, records: 4,
      downRouting: { decisionCode: "down_route_candidate", confidence: { level: "medium" } },
      previousSpendUsd: 300, trendAvailable: true,
    },
    {
      id: "boreal", name: "Boreal Support", spendUsd: 31.4, recoverableUsd: 0, records: 1,
      downRouting: { decisionCode: "no_candidate", confidence: { level: "low" } },
      previousSpendUsd: null, trendAvailable: false,
    },
  ],
});

test("the drill-down is rebuilt from the imported departments, in the bundled shape", () => {
  const data = importedDecisionData(ANALYSIS);

  assert.deepEqual(data.departments.map((entry) => entry.name),
    ["Atlas Platform", "Boreal Support"]);
  assert.match(data.provenance.label, /Your import/);
  assert.match(data.provenance.orgSource, /no org roster was supplied/);
});

test("no performance score is invented for departments an invoice cannot grade", () => {
  const [atlas] = importedDecisionData(ANALYSIS).departments;

  assert.equal(atlas.sampling.status, "unavailable");
  assert.equal(atlas.sampling.reason, samplingReasonText(null));
  // The trajectory decision answers its cost half and refuses its performance
  // half: an import carries a second period of spend, never of grades.
  assert.equal(atlas.previousPeriod.spendUsd, 300);
  assert.equal(atlas.previousPeriod.score, null);
});

test("a department's action is its own disclosed scenario, and never a realized saving", () => {
  const [atlas, boreal] = importedDecisionData(ANALYSIS).departments;

  assert.equal(atlas.actionPlan.status, "planned");
  assert.equal(atlas.actionPlan.estimatedSavingsUsd, 90.5);
  assert.equal(atlas.actionPlan.targetUsd, 322.25);
  assert.equal(atlas.actionPlan.realizedSavingsUsd, null);
  assert.match(atlas.actionPlan.provenance, /not a realized saving/);

  // Nothing recoverable is an unavailable action carrying a reason, not an
  // action worth 0.00 USD.
  assert.equal(boreal.actionPlan.status, "unavailable");
  assert.match(boreal.actionPlan.unavailableReason, /No down-routing scenario applies/);
});

test("the comparator decision says a cohort cannot exist, not that a rubric mismatched", () => {
  const data = importedDecisionData(ANALYSIS);

  assert.match(data.benchmarkNotice.answer, /No peer cohort can be built from your own files/);
  assert.match(data.benchmarkNotice.answer, /not a step you can complete/);
  assert.doesNotMatch(data.benchmarkNotice.answer, /rubric/i);
});

test("a graded department carries its own mix and its own sampled count", () => {
  const graded = importedDecisionData({
    ...ANALYSIS,
    literacy: {
      departments: [{
        departmentId: "atlas", gradeable: true, reason: null,
        coverage: { classified: 60, joined: 55 },
        categories: [{ key: "highValue", share: 0.6 }, { key: "inefficient", share: 0.4 }],
      }],
    },
  }).departments[0];

  assert.equal(graded.sampling.status, "available");
  assert.equal(graded.sampling.sampledQueries, 55);
  assert.equal(graded.mix.highValue, 0.6);
  assert.equal(graded.mix.inefficient, 0.4);
  assert.equal(graded.mix.outOfScope, 0, "an absent category is zero, never undefined");
});

test("sibling query-sample records grade the visitor's matching departments", () => {
  const records = [
    ...Array.from({ length: MIN_SCORED_PROMPTS }, () => ({
      orgUnitId: "atlas", category: "highValue", model: "gpt-4o",
    })),
    // A valid record for an unknown unit must not leak into Atlas's grade.
    { orgUnitId: "unknown", category: "outOfScope", model: "gpt-4o" },
  ];
  const literacy = importedDepartmentLiteracy(ANALYSIS, records);
  const data = importedDecisionData(ANALYSIS, { queryRecords: records });
  const [atlas, boreal] = data.departments;

  assert.equal(literacy[0].gradeable, true);
  assert.equal(atlas.sampling.status, "available");
  assert.equal(atlas.sampling.sampledQueries, MIN_SCORED_PROMPTS);
  assert.equal(atlas.mix.highValue, 1);
  assert.equal(boreal.sampling.status, "unavailable");
  assert.match(boreal.sampling.reason, /share no org unit key/);
});

// ---------------------------------------------------------------------------
// The page, through every state the import panel can put it in.
// ---------------------------------------------------------------------------

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const EXAMPLE_EXPORTS = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);
const PROVIDER_EXPORT = await readFile(new URL("openai-usage-export.csv", EXAMPLE_EXPORTS), "utf8");
const ORG_ROSTER = await readFile(new URL("generic-hris-roster.csv", EXAMPLE_EXPORTS), "utf8");

/** The shipped export with two project labels respelled to match the roster. */
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
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

const byId = (document, id) => document.getElementById(id);

function chooseFiles(document, files) {
  const input = byId(document, "local-finops-files");
  input.files = files.map(({ name, text }) => ({ name, type: "text/csv", text: async () => text }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

/** Walk the mapping step through to the analysis, confirming each file in turn. */
async function importFiles(document, files) {
  chooseFiles(document, files);
  for (const file of files) {
    await waitFor(() => !byId(document, "import-mapping").hidden
      && textOf(byId(document, "import-mapping-file")) === file.name,
    `the column-mapping step on ${file.name}`);
    byId(document, "import-mapping-confirm").click();
  }
  await waitFor(() => !byId(document, "local-results").hidden, "the decision brief");
}

/**
 * The assertion this file exists for.
 *
 * Every declared panel is still in the document, still the same node, still
 * visible, and still carrying a state the contract put there. A panel that went
 * quiet counts as a failure exactly like one that was removed.
 */
function everyPanelIsMounted(document, state, nodes = null) {
  const seen = [];
  for (const [index, panel] of EXECUTIVE_PANELS.entries()) {
    const node = byId(document, panel.elementId);
    assert.ok(node, `${state}: ${panel.id} left the document`);
    if (nodes) assert.equal(node, nodes[index], `${state}: ${panel.id} was replaced, not repainted`);
    assert.equal(node.hidden, false, `${state}: ${panel.id} was hidden instead of answering`);
    assert.ok(["available", "unavailable"].includes(node.dataset.panelState),
      `${state}: ${panel.id} carries no contract-derived state`);
    if (node.dataset.panelState === "unavailable") {
      const note = byId(document, `${panel.id}-unavailable`);
      assert.ok(note && !note.hidden, `${state}: ${panel.id} went quiet instead of saying why`);
      assert.match(textOf(note), /Needed next · .+: .+/,
        `${state}: ${panel.id} must name the one input that would answer it`);
    }
    seen.push(node);
  }
  return seen;
}

/**
 * An imported unit reads as a shortened opaque label, never a bundled
 * department's name: the privacy-safe HRIS contract carries no unit names, so
 * the analysis publishes the label it can defend rather than one it invented.
 */
const IMPORTED_UNIT = /Department …/;

const priorityNames = (document) => textOf(byId(document, "department-priority"));

test("import, re-map, clear and import again leaves every executive panel on the page", async (t) => {
  const { document } = await openFinopsTab();

  const mounted = everyPanelIsMounted(document, "state 1 · bundled");
  await t.test("state 1 · the bundled page ranks the bundled departments", () => {
    assert.match(priorityNames(document), /Data & ML/);
  });

  await importFiles(document, [
    { name: "openai-usage-export.csv", text: JOINABLE_EXPORT },
    { name: "generic-hris-roster.csv", text: ORG_ROSTER },
  ]);

  await t.test("state 2 · the import lands on the whole page, not a corner of it", () => {
    everyPanelIsMounted(document, "state 2 · imported", mounted);

    // The drill-down is the leader's own. The bundled departments are gone —
    // not hidden, replaced — and the panel is available because the import
    // clears the attribution floor.
    assert.equal(byId(document, "department-decision-panel").dataset.panelState, "available");
    // Unit names are not carried by the privacy-safe HRIS contract, so an
    // imported department is its own shortened opaque label — never a bundled
    // department's name standing in for one.
    assert.match(priorityNames(document), IMPORTED_UNIT);
    assert.doesNotMatch(priorityNames(document), /Data & ML/);
    assert.match(textOf(byId(document, "decision-provenance")), /Your import/);
    assert.match(textOf(byId(document, "detail-name")), IMPORTED_UNIT);
    // No query sample came with the invoice, so the score is refused with the
    // analysis's own reason rather than drawn as a zero.
    assert.equal(textOf(byId(document, "detail-score")), "Unavailable");
    assert.match(textOf(byId(document, "detail-sample")), /Sampling unavailable: no query sample/);
    // Named decision 2 and 3, answered from the import or explicitly refused.
    assert.match(textOf(byId(document, "trend-answer")), /Unavailable|No\.|Yes\./);
    assert.match(textOf(byId(document, "benchmark-answer")), /No peer cohort can be built/);
    // The reviewed intervention is the import's own disclosed scenario.
    assert.match(textOf(byId(document, "action-provenance")), /Browser-local down-routing scenario/);
    assert.equal(textOf(byId(document, "action-realized")), "Not yet simulated");
  });

  await t.test("state 2 · the hero says which file would grade the prompts", () => {
    const hero = byId(document, "score-card");
    assert.equal(hero.dataset.basis, "import", "the hero must be reading the import, not the seed");
    assert.equal(hero.dataset.panelState, "unavailable");
    // `score-action` is not one of the panel's hidden figures, so it is the one
    // line that must never be left holding the bundled seed's next step.
    assert.match(textOf(byId(document, "score-action")), /Add a query sample export/);
  });

  await t.test("state 3 · re-mapping the same file replaces it without a reload", async () => {
    byId(document, "remap-local-import").click();
    await waitFor(() => !byId(document, "import-mapping").hidden, "the mapping step to reopen");
    byId(document, "import-mapping-confirm").click();
    await waitFor(() => byId(document, "import-mapping").hidden, "the mapping step to close");

    everyPanelIsMounted(document, "state 3 · re-mapped", mounted);
    assert.match(priorityNames(document), IMPORTED_UNIT);
  });

  await t.test("state 4 · clearing hands the whole page back, drill-down included", () => {
    byId(document, "clear-local-analysis").click();

    everyPanelIsMounted(document, "state 4 · cleared", mounted);
    assert.match(priorityNames(document), /Data & ML/);
    assert.doesNotMatch(priorityNames(document), IMPORTED_UNIT);
    assert.equal(byId(document, "score-card").dataset.basis, undefined,
      "the hero must stop claiming to read an import that was cleared");
    assert.match(textOf(byId(document, "decision-provenance")), /Synthetic|synthetic/);
  });

  await t.test("state 5 · an export that attributes nothing keeps the panel and says why", async () => {
    await importFiles(document, [
      { name: "openai-usage-export.csv", text: PROVIDER_EXPORT },
      { name: "generic-hris-roster.csv", text: ORG_ROSTER },
    ]);

    everyPanelIsMounted(document, "state 5 · unattributed", mounted);
    const panel = byId(document, "department-decision-panel");
    assert.equal(panel.dataset.panelState, "unavailable",
      "no dollar joined the roster, so nothing may be ranked");
    const note = byId(document, "department-priority-unavailable");
    assert.match(textOf(note), /Which department needs help first\?/);
    assert.match(textOf(note), /Needed next/);
    assert.equal(byId(document, "decision-layout").hidden, true,
      "the ranking itself goes; the question and the named input stay");
  });
});
