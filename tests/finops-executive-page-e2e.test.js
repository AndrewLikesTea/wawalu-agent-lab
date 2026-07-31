// End-to-end regression for "the import lands on the whole executive page".
//
// The subject is not one panel. It is the page a leader is left holding after
// they import: every panel `finops-panel-contract.js` declares is still in the
// document, in a readable state, after the first import, after a second import
// that replaces the first, and after the clear that returns them to the sample.
//
// The one rule asserted in all four states, and the reason this file exists:
// NO DECLARED PANEL EVER LEAVES THE DOM, and none of them is left `hidden`.
// Before the panel contract the page removed six of the nine on import, which
// told a leader that their file had broken the product.
//
// Everything runs for real: the shipped markup of src/evolution.html, the real
// page entry, the real delimited reader, the real query-sample validator, the
// real rubric, the real join. The only thing the harness supplies is the
// browser's File API, which a headless DOM does not have.
//
// The query-sample corpus is generated here rather than committed: 90 rows of
// near-identical CSV is a diff nobody reads, and every number this file asserts
// is derived from the counts below.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { EXECUTIVE_PANELS, MIN_SCORED_PROMPTS } from "../src/finops-panel-contract.js";
import { exampleDepartmentUnitIds } from "../src/query-sample-example.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const OVERSPEND_FIXTURE = JSON.parse(await readFile(
  new URL("../src/model-overspend-finding-fixture.json", import.meta.url), "utf8"));

const EXAMPLE_EXPORTS = new URL(
  "../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);
const PROVIDER_EXPORT = await readFile(new URL("openai-usage-export.csv", EXAMPLE_EXPORTS), "utf8");
const ORG_ROSTER = await readFile(new URL("generic-hris-roster.csv", EXAMPLE_EXPORTS), "utf8");

/** The shipped export with two project labels respelled to match the roster. */
const JOINABLE_EXPORT = PROVIDER_EXPORT
  .replace(/atlas-platform/g, "Atlas Platform")
  .replace(/boreal-support/g, "Boreal Support");

/** A second period, so a replacing import is a different file with a different total. */
const SECOND_PERIOD_EXPORT = JOINABLE_EXPORT
  .replace(/2026-06-05/g, "2026-07-05")
  .replace(/2026-06-06/g, "2026-07-06")
  .replace(/2026-06-07/g, "2026-07-07")
  .replace(/exp_/g, "exq_");

const PROVIDER_FILE = "openai-usage-export.csv";
const SECOND_PROVIDER_FILE = "openai-usage-export-july.csv";
const ROSTER_FILE = "generic-hris-roster.csv";
const SAMPLE_FILE = "query-sample.csv";

// --- the generated query sample ---------------------------------------------
//
// One department, `PROMPTS_PER_DEPARTMENT` rows, spread over `DAYS` consecutive
// day buckets so the corpus spans more than the declared history window. Every
// row carries a pre-assigned category and no excerpt, which is the contract's
// exactly-one-of rule and keeps the mix — and therefore the letter — a property
// of the counts below rather than of a classifier's reading of invented prose.
const PROMPTS_PER_DEPARTMENT = MIN_SCORED_PROMPTS + 5;
const DAYS = 21;
const CATEGORY_CYCLE = ["highValue", "highValue", "highValue", "inefficient", "overProvisioned"];

function querySampleText(unitIds) {
  const lines = ["org_unit_id,query_date,model,input_tokens,output_tokens,prompt_excerpt,category"];
  for (const unit of unitIds) {
    for (let index = 0; index < PROMPTS_PER_DEPARTMENT; index += 1) {
      const day = String(1 + (index % DAYS)).padStart(2, "0");
      lines.push([
        unit, `2026-06-${day}`, "acme-sonnet-1",
        String(900 + index), String(400 + index), "",
        CATEGORY_CYCLE[index % CATEGORY_CYCLE.length],
      ].join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

const UNIT_IDS = exampleDepartmentUnitIds();
const GRADED_SAMPLE = querySampleText(UNIT_IDS.slice(0, 2));
/** The same shape, one department, under the floor: a corpus that cannot be graded. */
const THIN_SAMPLE = querySampleText(UNIT_IDS.slice(0, 1))
  .split("\n")
  .slice(0, MIN_SCORED_PROMPTS - 4)
  .join("\n");

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
      "/model-overspend-finding-fixture.json": OVERSPEND_FIXTURE,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => textOf(document.getElementById("integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

function chooseFiles(document, files) {
  const input = document.getElementById("local-finops-files");
  input.files = files.map(({ name, text }) => ({
    name, type: "text/csv", text: async () => text,
  }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

function reviewOpens(document, fileName) {
  return waitFor(() => !byId(document, "import-mapping").hidden
    && shownText(document, "import-mapping-file") === fileName,
  `the column-mapping step to open on ${fileName}`);
}

/** Select a provider export and a roster, walk both mapping steps, land on the brief. */
async function importProviderPair(document, { provider, providerFile, extra = [] }) {
  chooseFiles(document, [
    ...extra,
    { name: providerFile, text: provider },
    { name: ROSTER_FILE, text: ORG_ROSTER },
  ]);
  await reviewOpens(document, providerFile);
  byId(document, "import-mapping-confirm").click();
  await reviewOpens(document, ROSTER_FILE);
  byId(document, "import-mapping-confirm").click();
  await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");
}

/**
 * The assertion this file exists for, run in every state.
 *
 * A panel passes when its element is still in the document, is not hidden, and
 * carries a state the reading vocabulary knows. An available panel must show its
 * figures; an unavailable one must show the sentence naming the one input that
 * would answer it, because a panel with neither is the blank the contract bans.
 */
function assertEveryPanelReadable(document, where) {
  for (const panel of EXECUTIVE_PANELS) {
    const node = byId(document, panel.elementId);
    assert.ok(node, `${where}: panel "${panel.id}" (#${panel.elementId}) left the DOM`);
    assert.equal(node.hidden, false,
      `${where}: panel "${panel.id}" is hidden; a declared panel is never hidden`);
    assert.equal(node.dataset.panelId, panel.id,
      `${where}: panel "${panel.id}" is not marked with its contract id`);
    const state = node.dataset.panelState;
    assert.ok(state === "available" || state === "unavailable",
      `${where}: panel "${panel.id}" has no declared state (got ${state})`);
    const note = byId(document, `${panel.id}-unavailable`);
    if (state === "unavailable") {
      assert.ok(note && !note.hidden,
        `${where}: unavailable panel "${panel.id}" shows no sentence saying what would answer it`);
      assert.match(textOf(note), /Needed next ·/,
        `${where}: unavailable panel "${panel.id}" names no next input`);
    } else {
      assert.ok(!note || note.hidden,
        `${where}: available panel "${panel.id}" still shows an unavailable sentence`);
      for (const figureId of panel.figures) {
        const figure = byId(document, figureId);
        if (figure) {
          assert.equal(figure.hidden, false,
            `${where}: available panel "${panel.id}" hides its figure #${figureId}`);
        }
      }
    }
  }
}

/** Panel id → the state the contract put it in right now. */
function panelStateMap(document) {
  return Object.fromEntries(EXECUTIVE_PANELS.map((panel) =>
    [panel.id, byId(document, panel.elementId)?.dataset.panelState]));
}

test("an import lands on the whole executive page, survives a replacement, and clears back", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await t.test("before any file, every declared panel is already on the page", () => {
      assertEveryPanelReadable(document, "before import");
    });

    await t.test("a provider export plus a graded query sample fills the page", async () => {
      await importProviderPair(document, {
        provider: JOINABLE_EXPORT,
        providerFile: PROVIDER_FILE,
        extra: [{ name: SAMPLE_FILE, text: GRADED_SAMPLE }],
      });
      assertEveryPanelReadable(document, "after import");
      const states = panelStateMap(document);
      assert.equal(states["hero-grade"], "available",
        "a corpus over the declared floor must earn the hero grade");
      assert.equal(states["spend-and-recovery"], "available");
      assert.equal(states["spend-mix"], "available");
      assert.equal(states["department-priority"], "available");
      // This import attributes org units and carries a graded sample, so a
      // published synthetic cohort applies to it and the comparison is the
      // import's own. The cohort is reference data; the position in it is not.
      assert.equal(states["peer-benchmark"], "available");
      // The two an import genuinely cannot answer stay on the page and say so.
      assert.equal(states["savings-portfolio"], "unavailable");
      assert.equal(states["recommendation-evidence"], "unavailable");
    });

    await t.test("the hero carries the visitor's own grade, confidence, and record count", () => {
      const hero = shownText(document, "score-card");
      assert.match(hero, /grade [A-F]/, "the hero must publish the visitor's own letter");
      assert.match(hero, /confidence/i, "the letter must carry its confidence beside it");
      assert.match(hero, new RegExp(`${PROMPTS_PER_DEPARTMENT * 2} of ${PROMPTS_PER_DEPARTMENT * 2} `
        + "imported records scored"), "the hero must say off how many records the letter was computed");
      assert.equal(byId(document, "score-card").dataset.gradeSource, "import");
      // The bundled seed's own roll-up must be gone, not merely covered up: it
      // names departments that are not in this import at all.
      assert.doesNotMatch(hero, /Security Engineering/,
        "a bundled department must not survive under the visitor's own grade");
    });

    await t.test("the KPI row and the spend mix are the visitor's own figures", () => {
      const kpis = shownText(document, "kpi-row");
      assert.doesNotMatch(kpis, /178,760/, "the bundled spend total must not survive an import");
      assert.match(kpis, /\$446|\$444|\$546/, "the KPI row must show the imported spend total");
      assert.equal(byId(document, "kpi-peer").dataset.available, "true",
        "a published cohort applies to this import, so the card must publish its position");
      assert.equal(byId(document, "kpi-peer-flag").hidden, true);
      assert.match(shownText(document, "kpi-peer"), /published synthetic peers/,
        "the peer card must say the cohort behind it is published synthetic reference data");
      assert.doesNotMatch(shownText(document, "kpi-peer"), /Enterprise SaaS/,
        "the bundled seed's own cohort label must not survive an import");
      assert.match(shownText(document, "cohort-comparison"), /percentile/,
        "the inspectable comparison surface must agree with the imported KPI");
      assert.match(shownText(document, "cohort-comparison-provenance"),
        /finops-peer-cohort\/1\.0\.0/,
        "the comparison surface must expose the published contract version");
      assert.doesNotMatch(shownText(document, "cohort-comparison"), /stays the bundled cohort/,
        "the legacy bundled-only explanation must not contradict the imported benchmark");
      // The method prose itself is deferred to /finops-detail/ and fetched on
      // first expand — see tests/finops-deferred-detail.test.js, which drives
      // the load, the failure, and the cache. What this flow test still owns is
      // that an import leaves the panel readable without one: the fallback is
      // server-rendered, names what it stands for, and links to the source.
      const method = shownText(document, "peer-benchmark-method");
      assert.match(method, /comparable-peer method/);
      assert.match(method, /finops-peer-cohort\/1\.0\.0/);
      assert.match(method, /single prioritized action/);
      assert.equal(byId(document, "peer-benchmark-method-body")
        .dataset.deferredState, "fallback",
        "an import must not put the deferred panel into a loading state it never leaves");

      assert.equal(byId(document, "spend-mix-panel").hidden, false);
      assert.equal(byId(document, "mix-legend").children.length, 4,
        "the mix must carry one row per declared query category");
      const legend = shownText(document, "mix-legend");
      assert.match(legend, /scored queries/,
        "an imported mix is a query mix and every slice must be captioned in records");
      assert.doesNotMatch(legend, /\$/,
        "a query sample carries no per-query cost, so no slice may be captioned in dollars");
      assert.match(shownText(document, "mix-basis"), /query mix, not a spend mix/,
        "the basis for the chart must be readable beside it");
    });

    await t.test("the departments and their named decisions come from the import", () => {
      const decisions = byId(document, "local-department-list");
      assert.ok(decisions && decisions.children.length > 0,
        "the department panel must list the departments the import produced");
      assert.match(textOf(decisions), /Department …[0-9a-f]{6}/,
        "each ranked department must be named on its own decision row");
      assert.match(shownText(document, "department-decision-panel"), /Which department needs help first\?/,
        "the panel must keep its declared question on screen");
    });

    await t.test("adding a second period re-renders every panel, none disappears", async () => {
      await importProviderPair(document, {
        provider: SECOND_PERIOD_EXPORT,
        providerFile: SECOND_PROVIDER_FILE,
      });
      await waitFor(() => shownText(document, "dataset-provenance-results")
        .includes(SECOND_PROVIDER_FILE), "the provenance line to name the file now on screen");
      assertEveryPanelReadable(document, "after adding a second period");
    });

    await t.test("clearing returns to the bundled sample with every panel still mounted", async () => {
      byId(document, "clear-local-analysis").click();
      await waitFor(() => byId(document, "local-results").hidden,
        "the decision brief to go back off screen");
      assertEveryPanelReadable(document, "after clearing");
      assert.equal(byId(document, "analysis-mode").dataset.mode, "example",
        "clearing must return the page to the bundled example");
      assert.equal(byId(document, "kpi-row").dataset.source, "sample",
        "the KPI row must be captioned as the bundled sample again");
      assert.equal(byId(document, "headline-basis").hidden, false,
        "the example-data caption must come back with the example numbers");
      assert.match(shownText(document, "kpi-row"), /178,760/,
        "the bundled figures must be back, not left blank");
    });

    await t.test("a replacing import after the clear rebuilds a coherent page", async () => {
      await importProviderPair(document, {
        provider: JOINABLE_EXPORT,
        providerFile: PROVIDER_FILE,
        extra: [{ name: SAMPLE_FILE, text: THIN_SAMPLE }],
      });
      assertEveryPanelReadable(document, "after re-importing");
      // Under the declared floor: the letter is refused, in words, with the
      // count and the floor beside it — and the bundled letter does not return.
      const hero = shownText(document, "score-card");
      assert.match(hero, new RegExp(`floor ${MIN_SCORED_PROMPTS}`),
        "a refused grade must name the floor it was measured against");
      assert.doesNotMatch(hero, /grade [A-F]/,
        "no letter may be published for a corpus under the declared floor");
      assert.equal(panelStateMap(document)["hero-grade"], "unavailable",
        "the panel must agree with the module that refused the letter");
    });
  } finally {
    page.restore();
  }
});
