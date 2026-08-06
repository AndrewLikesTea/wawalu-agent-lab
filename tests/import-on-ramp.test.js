// The one-question on-ramp (#1169), as a join and on the surface that uses it.
//
// The render assertions are driven per adapter off IMPORT_ON_RAMP_CHOICES and
// check the CHOSEN adapter's own report name and download attributes, so a
// panel that paints one hardcoded adapter — or the wrong one — reds here rather
// than passing on shape alone. OpenAI and Bedrock are both exercised through
// the real chooser, and Bedrock's second sample control is what proves the
// download set is per-adapter and not a fixture.
//
// Harness notes that shaped this file: descendant selectors throw, so ancestry
// is walked; `assert.equal(node, null)` walks the whole parsed page, so absence
// is asserted through counts and attributes; and a select here accepts any
// value, so the option set is asserted on the rendered options themselves.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

import {
  IMPORT_ON_RAMP_CHOICES, IMPORT_ON_RAMP_EMPTY, IMPORT_ON_RAMP_UNCHOSEN,
  onRampChoiceFor, onRampTemplateText,
} from "../src/import-on-ramp.js";
import { PROVIDER_ADAPTERS } from "../src/multi-provider-intake.js";
import { recipeForAdapter } from "../src/import-recipes.js";
import { detectAndNormalizeExport } from "../src/export-provider-detection.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

async function openImportPanel() {
  const page = await loadPage(PAGE, {
    storage: {},
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

function choose(document, adapterId) {
  const select = document.getElementById("import-on-ramp-provider");
  select.value = adapterId;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return document.getElementById("import-on-ramp-answer");
}

// Descendant selectors throw in this harness, so ancestry is walked.
function ancestorTags(node) {
  const tags = [];
  for (let current = node?.parentNode; current && current.nodeType === 1; current = current.parentNode) {
    tags.push(current.tagName.toLowerCase());
  }
  return tags;
}

test("every pinned adapter is one choice, and no fact in it is invented", () => {
  assert.equal(IMPORT_ON_RAMP_CHOICES.length, PROVIDER_ADAPTERS.length,
    "one choice per pinned spend adapter, derived from the intake contract");
  for (const adapter of PROVIDER_ADAPTERS) {
    const choice = onRampChoiceFor(adapter.id);
    const recipe = recipeForAdapter(adapter.id);
    assert.equal(choice.label, recipe.label, `${adapter.id} is named as the recipe names it`);
    assert.equal(choice.report, recipe.report,
      `${adapter.id} must ask for the report the recipe module publishes`);
    assert.deepEqual([...choice.columns], [...recipe.columns]);
    assert.ok(choice.consolePath.length > 0, `${adapter.id} must say which console screen`);
    assert.equal(onRampTemplateText(choice), `${recipe.columns.join(",")}\n`,
      `${adapter.id} template is the header row of the report and nothing else`);
  }
});

test("the section leads with the question and the unchosen state, behind no disclosure", async () => {
  const { document } = await openImportPanel();
  const select = document.getElementById("import-on-ramp-provider");
  const label = document.querySelector('label[for="import-on-ramp-provider"]');
  assert.ok(label, "the provider control must carry a real label element");
  assert.equal(textOf(label), "Provider you pay for AI");
  assert.equal(select.value, "", "no provider may be chosen for the reader");
  // The select accepts any value in this harness, so the OPTION SET is what is
  // asserted: the unchosen option plus one per pinned adapter, in order.
  assert.deepEqual(select.options.map((option) => option.value),
    ["", ...IMPORT_ON_RAMP_CHOICES.map((choice) => choice.adapter)]);
  assert.deepEqual(select.options.map((option) => textOf(option)),
    [IMPORT_ON_RAMP_UNCHOSEN, ...IMPORT_ON_RAMP_CHOICES.map((choice) => choice.label)]);

  const answer = document.getElementById("import-on-ramp-answer");
  assert.equal(answer.dataset.state, "empty");
  assert.equal(answer.dataset.adapter, "none");
  assert.equal(textOf(answer), IMPORT_ON_RAMP_EMPTY,
    "the unchosen state is painted from the module, never authored twice");
  // The live region is a direct part of the visible flow, by construction.
  assert.equal(answer.getAttribute("aria-live"), "polite");
  assert.equal(ancestorTags(answer).includes("details"), false,
    "the announced region must never sit inside a disclosure");
  assert.equal(answer.querySelectorAll("details").length, 0,
    "and it must not fold its own answer away either");
  assert.equal(document.getElementById("import-on-ramp-detail").hidden, true,
    "no supporting detail ships before a provider is chosen");
  assert.equal(answer.querySelectorAll("button").length, 0,
    "the empty state offers no control but the question itself");
});

test("choosing a provider reveals that adapter's report, its downloads, and one action", async () => {
  const { document } = await openImportPanel();
  for (const choice of IMPORT_ON_RAMP_CHOICES) {
    const answer = choose(document, choice.adapter);
    assert.equal(answer.dataset.state, "chosen");
    assert.equal(answer.dataset.adapter, choice.adapter);
    const text = textOf(answer);
    // The chosen adapter's own words, from the recipe module.
    for (const phrase of [choice.label, choice.report, choice.question, choice.consolePath]) {
      assert.ok(text.includes(phrase), `${choice.adapter} must say “${phrase}”`);
    }
    // and none of another adapter's.
    for (const other of IMPORT_ON_RAMP_CHOICES) {
      if (other.adapter === choice.adapter) continue;
      assert.equal(text.includes(other.report), false,
        `${choice.adapter} must not paint ${other.adapter}'s report`);
    }
    // One control per starting file, and exactly one filled next action.
    const downloads = answer.querySelectorAll(".provider-readiness-download");
    assert.deepEqual(downloads.map((button) => button.dataset.template ?? button.dataset.sample),
      [choice.adapter, ...choice.samples.map((sample) => sample.id)],
      `${choice.adapter} must offer its own template and its own samples`);
    for (const button of downloads) assert.equal(button.getAttribute("type"), "button");
    const actions = answer.querySelectorAll(".local-export-primary");
    assert.equal(actions.length, 1, `${choice.adapter} must offer exactly one next action`);
    assert.equal(actions[0].getAttribute("id"), "import-on-ramp-action");
    assert.equal(textOf(actions[0]), choice.nextAction.label);
  }
});

test("the column list, the second file, and the alternates fold away", async () => {
  const { document } = await openImportPanel();
  const choice = onRampChoiceFor("openai-usage");
  choose(document, choice.adapter);
  const detail = document.getElementById("import-on-ramp-detail");
  assert.equal(detail.hidden, false);
  assert.equal(detail.querySelectorAll("details").length, 3,
    "three disclosures: columns, the second file, and the other providers");
  const columns = document.getElementById("import-on-ramp-columns");
  assert.equal(columns.tagName.toLowerCase(), "details");
  const columnText = textOf(columns);
  for (const column of choice.columns) {
    assert.ok(columnText.includes(column), `the column list must name ${column}`);
  }
  assert.ok(textOf(document.getElementById("import-on-ramp-second-input"))
    .includes(choice.secondInput.report), "the second input requirement is one disclosure away");
  const alternates = textOf(document.getElementById("import-on-ramp-alternates"));
  for (const other of IMPORT_ON_RAMP_CHOICES) {
    if (other.adapter === choice.adapter) continue;
    assert.ok(alternates.includes(other.label), `the alternates must list ${other.adapter}`);
  }
  assert.equal(ancestorTags(columns).includes("details"), false,
    "one disclosure deep: supporting detail is never nested inside another");
});

test("each revealed download hands over the file it names", async () => {
  const page = await openImportPanel();
  const { document } = page;

  // OpenAI: a column template plus the recognized one-row OpenAI sample.
  const openai = onRampChoiceFor("openai-usage");
  const openaiAnswer = choose(document, openai.adapter);
  const openaiButtons = openaiAnswer.querySelectorAll(".provider-readiness-download");
  openaiButtons[0].click();
  assert.deepEqual(page.downloads.at(-1).filename, openai.templateFilename);
  assert.equal(page.downloads.at(-1).text, onRampTemplateText(openai));
  openaiButtons[1].click();
  assert.equal(page.downloads.at(-1).filename, openai.samples[0].filename);
  assert.equal(detectAndNormalizeExport(page.downloads.at(-1).text).provider, "openai",
    "the OpenAI sample must be recognized as OpenAI by the shipping importer");

  // Bedrock: a different template and TWO samples, so a single hardcoded
  // adapter render cannot satisfy both providers.
  const bedrock = onRampChoiceFor("bedrock-cost-and-usage");
  const bedrockAnswer = choose(document, bedrock.adapter);
  const bedrockButtons = bedrockAnswer.querySelectorAll(".provider-readiness-download");
  assert.equal(bedrockButtons.length, 1 + bedrock.samples.length);
  bedrockButtons[0].click();
  assert.equal(page.downloads.at(-1).filename, bedrock.templateFilename);
  assert.equal(page.downloads.at(-1).text, onRampTemplateText(bedrock));
  assert.notEqual(onRampTemplateText(bedrock), onRampTemplateText(openai),
    "two providers must not receive the same template");
  for (const [index, sample] of bedrock.samples.entries()) {
    bedrockButtons[index + 1].click();
    assert.equal(page.downloads.at(-1).filename, sample.filename);
    assert.equal(detectAndNormalizeExport(page.downloads.at(-1).text).provider, sample.id,
      `the ${sample.id} sample must be recognized as ${sample.id}`);
  }
  assert.equal(page.downloads.length, 2 + 1 + bedrock.samples.length,
    "one click, one file, and no file generated before it was asked for");
});

test("the next action opens the page's one picker rather than a second import", async () => {
  const { document } = await openImportPanel();
  choose(document, "anthropic-usage");
  const action = document.getElementById("import-on-ramp-action");
  const input = document.getElementById("local-finops-files");
  let clicked = 0;
  input.click = () => { clicked += 1; };
  action.click();
  assert.equal(clicked, 1, "the one next action must lead to the existing file picker");
  // The unchosen state still works after a choice, and reads sensibly.
  const answer = choose(document, "");
  assert.equal(answer.dataset.state, "empty");
  assert.equal(textOf(answer), IMPORT_ON_RAMP_EMPTY);
  assert.equal(document.getElementById("import-on-ramp-detail").hidden, true);
});

test("the panel does not move the assurance that files stay in this browser", async () => {
  const { document } = await openImportPanel();
  const boundary = document.querySelector(".privacy-boundary");
  assert.equal(ancestorTags(boundary).includes("details"), false,
    "the local-processing assurance stays on the first screen, behind nothing");
  assert.ok(textOf(boundary).includes("Your files do not leave this tab."));
  // The on-ramp says it too, before a provider is chosen.
  assert.match(IMPORT_ON_RAMP_EMPTY, /never leaves it/);
});
