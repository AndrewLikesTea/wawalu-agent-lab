// The two starting files per pinned adapter (#1167): the blank template and the
// worked sample, checked against the contract they are derived from and against
// the intake path that has to read them.
//
// THE ASSERTION THAT MATTERS is not that a sample exists — it is that the SAME
// code the live importer runs turns it into the figure the panel prints. So the
// worked sample goes through `parseLocalImportFile`, the one entry point
// evolution-page.js calls for a selected file, and then through
// `projectProviderExport`, the projection that page paints its provider result
// from. Neither is re-implemented here; a change to either that stops reading
// this file reds this test rather than shipping a sample that no longer imports.
//
// Harness notes that shaped this file: descendant selectors throw, so ancestry
// is walked; `assert.equal(node, null)` walks the whole parsed page, so absence
// is asserted through counts; and the worked control is appended by a module the
// panel fetches on demand, so the page assertions wait for it rather than
// assuming a paint order.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

import {
  WORKED_SAMPLES, WORKED_SAMPLE_FIGURE_LABEL, WORKED_SAMPLE_TOTAL_USD, workedSample,
} from "../src/import-worked-sample.js";
import { onRampChoiceFor, onRampTemplateText } from "../src/import-on-ramp.js";
import { recipeForAdapter } from "../src/import-recipes.js";
import { PROVIDER_ADAPTERS } from "../src/multi-provider-intake.js";
import { parseLocalImportFile } from "../src/finops-tabular-import.js";
import { projectProviderExport } from "../src/provider-export-projection.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

// Every value a row is allowed to carry, stated as a rule rather than a list:
// fictional org units, fictional models, ISO dates and plain decimal amounts.
// A real department, a real model name or an account identifier fails here.
const SYNTHETIC_VALUE = /^(Example Dept (Alpha|Beta|Gamma)|example-model-(small|large)|gpt-example-(premium|standard)|\d{4}-\d{2}-\d{2}|\d+(\.\d{2})?|USD|final)$/;

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

/** Choose a provider and wait for the deferred worked-sample control to land. */
async function chooseAndWait(page, adapterId) {
  const select = page.document.getElementById("import-on-ramp-provider");
  select.value = adapterId;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  const answer = page.document.getElementById("import-on-ramp-answer");
  await waitFor(() => answer.querySelectorAll("[data-worked]").length === 2,
    `the ${adapterId} worked sample control and its figure`);
  return answer;
}

const lines = (text) => text.trimEnd().split("\n");

test("every pinned adapter has both starting files, and neither header is spelled twice", () => {
  assert.equal(WORKED_SAMPLES.length, PROVIDER_ADAPTERS.length,
    "one worked sample per pinned spend adapter, derived from the intake contract");
  for (const adapter of PROVIDER_ADAPTERS) {
    const recipe = recipeForAdapter(adapter.id);
    const sample = workedSample(adapter.id);
    const template = onRampTemplateText(onRampChoiceFor(adapter.id));

    // The blank template: the contract's column list, in order, and nothing under it.
    assert.deepEqual(lines(template), [recipe.columns.join(",")],
      `${adapter.id} template must be the contract header row and no data row`);

    // The worked sample: the same header, then rows.
    const rows = lines(sample.text);
    if (adapter.id === "openai-usage") {
      assert.deepEqual(rows[0].split(",").slice(0, 3), ["date", "project", "model"]);
      assert.match(rows[0], /input tokens,output tokens,requests,amount,currency,status$/,
        "the analysis example must carry the optional evidence needed to score it");
    } else {
      assert.equal(rows[0], recipe.columns.join(","),
        `${adapter.id} worked sample must carry the contract's columns, in order`);
      assert.equal(rows[0], lines(template)[0],
        `${adapter.id} must not spell its header differently in its two files`);
    }
    assert.equal(rows.length - 1, sample.rowCount);
    assert.ok(sample.rowCount >= 2 && sample.rowCount <= 10,
      `${adapter.id} worked sample must be a handful of rows, not a data set`);
    for (const row of rows.slice(1)) {
      assert.equal(row.split(",").length, rows[0].split(",").length,
        `${adapter.id} row must carry one value per declared column`);
    }
    assert.match(sample.filename, /^wawalu-worked-sample-[a-z-]+\.csv$/);
    assert.notEqual(sample.filename, onRampChoiceFor(adapter.id).templateFilename,
      "the two files must not overwrite one another in a download folder");
  }
  // Two adapters must not receive the same file: the header is what differs.
  const headers = new Set(WORKED_SAMPLES.map((sample) => lines(sample.text)[0]));
  assert.equal(headers.size, WORKED_SAMPLES.length,
    "each adapter's worked sample is written in its own column spelling");
});

test("no worked sample carries a value that could be somebody's", () => {
  for (const sample of WORKED_SAMPLES) {
    for (const row of lines(sample.text).slice(1)) {
      for (const value of row.split(",")) {
        assert.match(value, SYNTHETIC_VALUE,
          `${sample.adapter} carries “${value}”, which is not an obviously synthetic value`);
      }
    }
  }
});

test("each worked sample imports, through the shipping intake path, to its documented figure", () => {
  for (const sample of WORKED_SAMPLES) {
    // The one entry point the page calls for a selected file — same call, same
    // file name, same media type the download control hands the reader.
    const parsed = parseLocalImportFile(sample.text, sample.filename, sample.mediaType);
    assert.equal(parsed.type, "provider",
      `${sample.filename} must normalize into a v1 provider export`);
    assert.equal(parsed.document.records.length > 0, true,
      `${sample.filename} must produce usage records`);

    // The projection the page paints its provider result from.
    const projection = projectProviderExport(parsed.document);
    assert.equal(projection.ok, true,
      `${sample.filename} must project: ${projection.error ?? "unknown"}`);
    assert.equal(projection.spend.currency, "USD");
    assert.equal(projection.spend.amountUsd, WORKED_SAMPLE_TOTAL_USD,
      `${sample.filename} must import to the figure the panel prints beside it`);
    assert.equal(projection.spend.amountUsd, sample.totalUsd);
    // The figure the reader is shown is the figure that was just computed.
    assert.ok(sample.figure.includes("$505.00"),
      `${sample.adapter} must print the total it imports to`);
    assert.ok(sample.figure.includes(String(sample.rowCount)),
      `${sample.adapter} must say how many rows produced it`);
    // Every row is attributed to a unit, which is what makes the sample worth
    // shipping: a lead comparing their own file has a fully attributed one to
    // compare it against.
    assert.equal(projection.departmentCoverage.rowRatio, 1,
      `${sample.filename} must attribute every row to a unit`);
  }
});

test("the blank template is a header row the intake path recognizes and refuses to score", () => {
  for (const adapter of PROVIDER_ADAPTERS) {
    const choice = onRampChoiceFor(adapter.id);
    const text = onRampTemplateText(choice);
    // A file with a header and no rows is not an import failure to hide — it is
    // the state a lead's own file starts in, and the panel promises it is the
    // right shape. The intake path must therefore reject it for having no rows,
    // never for having the wrong columns.
    assert.throws(() => parseLocalImportFile(text, choice.templateFilename, "text/csv"),
      (error) => {
        assert.notEqual(error.code, "missing_required_column",
          `${adapter.id} template must not be missing a column the parser requires`);
        return true;
      });
  }
});

test("the chosen provider's worked sample is offered with its figure beside it", async () => {
  const page = await openImportPanel();
  for (const sample of WORKED_SAMPLES) {
    const answer = await chooseAndWait(page, sample.adapter);
    const controls = answer.querySelectorAll("[data-worked]");
    const button = controls.find((node) => node.tagName.toLowerCase() === "button");
    assert.equal(button.dataset.worked, sample.adapter,
      "the control offered must be the chosen adapter's own sample");
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(String(textOf(button)).includes(String(sample.rowCount)), true,
      "the control must say how big the file it hands over is");

    const figure = controls.find((node) => node.dataset.worked === "figure");
    const printed = textOf(figure);
    assert.ok(printed.includes(WORKED_SAMPLE_FIGURE_LABEL));
    assert.ok(printed.includes(sample.figure),
      "the figure beside the control is the module's own, never authored twice");
  }
});

test("the worked-sample control hands over the bytes it names, once per click", async () => {
  const page = await openImportPanel();
  const answer = await chooseAndWait(page, "openai-usage");
  const before = page.downloads.length;
  const button = answer.querySelectorAll("[data-worked]")
    .find((node) => node.tagName.toLowerCase() === "button");
  button.click();
  assert.equal(page.downloads.length, before + 1,
    "one click, one file, and no file generated before it was asked for");
  const file = page.downloads.at(-1);
  const sample = workedSample("openai-usage");
  assert.equal(file.filename, sample.filename);
  assert.equal(file.text, sample.text);
  // The bytes the reader receives are the bytes the intake path was asserted on.
  assert.equal(projectProviderExport(
    parseLocalImportFile(file.text, file.filename, sample.mediaType).document,
  ).spend.amountUsd, WORKED_SAMPLE_TOTAL_USD);
});
