// The blank template and the worked sample per pinned adapter (#1167), as a
// contract, as a file the real importer reads, and on the surface that offers it.
//
// Three things only this file can catch.
//
// 1. A STALE HEADER. The template's header is asserted to be the recipe's column
//    list, in the recipe's order, for every pinned adapter — so renaming or
//    reordering a required column in the shape reds this test rather than
//    shipping a template whose header the importer would refuse.
// 2. A DRIFTED FIGURE. The worked sample is fed through `parseLocalImportFile`,
//    the one entry point the page calls for a selected file, and the total it
//    produces is held against the constant the control prints. A change to the
//    sample rows, to the cost column, or to how the importer sums minor units
//    moves one and not the other, and this fails.
// 3. A SAMPLE THAT LEAKS. The serialized text is held against the identifier
//    shapes the intake and readiness contracts document — account, subscription,
//    payer, project and key identifiers, and any header either contract marks
//    sensitive. A file a lead may mail to a colleague has to be safe to mail.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

import {
  IMPORT_SAMPLE_FILES, SAMPLE_TOTAL_USD, importSampleFileById, importedTotalUsd,
} from "../src/import-sample-files.js";
import {
  SAMPLE_DOWNLOAD_KINDS, downloadLabel, downloadPayload,
} from "../src/import-sample-downloads-view.js";
import { PROVIDER_ADAPTERS, SENSITIVE_INTAKE_HEADERS } from "../src/multi-provider-intake.js";
import { recipeForAdapter } from "../src/import-recipes.js";
import { parseLocalImportFile } from "../src/finops-tabular-import.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

// Fixed, so nothing in this file reads a clock: the importer stamps the export
// with what it is handed, and a sample whose bytes depend on today is a sample
// nobody can reproduce.
const PARSE_OPTIONS = Object.freeze({ generatedAt: "2026-07-01T00:00:00Z", seed: "1167" });

const headerOf = (text) => text.split("\n")[0].split(",");

test("every pinned adapter has exactly one template-and-sample pair", () => {
  assert.equal(IMPORT_SAMPLE_FILES.length, PROVIDER_ADAPTERS.length,
    "one pair per pinned adapter, derived from the intake contract's own list");
  for (const [index, adapter] of PROVIDER_ADAPTERS.entries()) {
    const file = IMPORT_SAMPLE_FILES[index];
    assert.equal(file.adapter, adapter.id, "in the intake contract's declared order");
    assert.equal(file.label, adapter.label, "named as the intake contract names it");
    assert.equal(importSampleFileById(adapter.id)?.adapter, adapter.id);
  }
});

test("the blank template is the contract's columns, in contract order, and no rows", () => {
  for (const file of IMPORT_SAMPLE_FILES) {
    const columns = recipeForAdapter(file.adapter).columns;
    assert.deepEqual(headerOf(file.blankTemplate), [...columns],
      `${file.adapter}: the template header must be the recipe's column list, in its order`);
    assert.deepEqual([...file.columns], [...columns],
      `${file.adapter}: the published column list must be the recipe's`);
    assert.equal(file.blankTemplate.split("\n").filter(Boolean).length, 1,
      `${file.adapter}: a blank template carries a header and nothing to import by accident`);
    assert.deepEqual(headerOf(file.workedSample), [...columns],
      `${file.adapter}: the sample must be readable by the same header as the template`);
    assert.equal(file.workedSample.split("\n").filter(Boolean).length, file.sampleRowCount + 1,
      `${file.adapter}: the sample must carry exactly the rows it says it does`);
    // A column the contract added and the sample has no cell for would arrive
    // here as an empty field, so this is what a contract ADDITION reds.
    for (const row of file.workedSample.split("\n").filter(Boolean).slice(1)) {
      const cells = row.split(",");
      assert.equal(cells.length, columns.length,
        `${file.adapter}: every sample row must fill every column the header names`);
      assert.equal(cells.filter((cell) => cell === "").length, 0,
        `${file.adapter}: no sample cell may be blank`);
    }
  }
});

test("each worked sample imports through the page's own entry point to the documented figure", () => {
  for (const file of IMPORT_SAMPLE_FILES) {
    const result = parseLocalImportFile(
      file.workedSample, file.sampleFilename, file.mediaType, PARSE_OPTIONS);
    assert.equal(result.shape, PROVIDER_ADAPTERS
      .find((adapter) => adapter.id === file.adapter).shapes[0],
    `${file.adapter}: the sample must be recognized as its own adapter's shape`);
    assert.equal(result.document.records.length, file.sampleRowCount,
      `${file.adapter}: every sample row must survive the import`);
    assert.equal(importedTotalUsd(result.document), file.documentedTotalUsd,
      `${file.adapter}: the imported total must be the figure the control promises`);
    assert.equal(file.documentedTotalUsd, SAMPLE_TOTAL_USD,
      `${file.adapter}: one documented figure, quoted by the control and by this test`);
    assert.ok(file.documentedTotalLabel.includes(String(SAMPLE_TOTAL_USD)),
      `${file.adapter}: the printed label must carry the documented figure`);
  }
});

test("the blank template imports nothing and is refused rather than counted", () => {
  for (const file of IMPORT_SAMPLE_FILES) {
    assert.throws(() => parseLocalImportFile(
      file.blankTemplate, file.blankFilename, file.mediaType, PARSE_OPTIONS),
    (error) => typeof error.code === "string",
    `${file.adapter}: a header with no rows must be refused with a reason code`);
  }
});

// The identifier shapes the contracts on this page document: an AWS payer or
// linked account, an ARN, an Azure subscription path, an OpenAI organization or
// project id, an API key, and an email address. Each is a shape, not a literal,
// so a sample that invented a *different* plausible-looking one still fails.
const IDENTIFIER_SHAPES = Object.freeze([
  ["a 12-digit AWS account id", /\b\d{12}\b/],
  ["an ARN", /\barn:/i],
  ["an Azure subscription path", /\/subscriptions\//i],
  ["a GUID", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ["an OpenAI organization id", /\borg-[A-Za-z0-9]{6,}/],
  ["an OpenAI project id", /\bproj[_-][A-Za-z0-9]{4,}/],
  ["an API key", /\b(?:sk|pk|rk)-[A-Za-z0-9]{8,}/],
  ["an email address", /[^\s,]+@[^\s,]+\.[a-z]{2,}/i],
]);

test("no sample carries a real account, key, or person identifier shape", () => {
  for (const file of IMPORT_SAMPLE_FILES) {
    for (const text of [file.blankTemplate, file.workedSample]) {
      for (const [what, pattern] of IDENTIFIER_SHAPES) {
        assert.equal(pattern.test(text), false,
          `${file.adapter}: the sample text must not contain ${what}`);
      }
    }
  }
});

test("no sample carries a column either contract marks sensitive", () => {
  for (const file of IMPORT_SAMPLE_FILES) {
    const header = headerOf(file.workedSample).map((name) => name.toLowerCase());
    for (const sensitive of SENSITIVE_INTAKE_HEADERS) {
      assert.equal(header.includes(sensitive.toLowerCase()), false,
        `${file.adapter}: ${sensitive} is refused or redacted at intake and is never sampled`);
    }
  }
});

test("the sample rows are obviously synthetic", () => {
  for (const file of IMPORT_SAMPLE_FILES) {
    const [, ...rows] = file.workedSample.split("\n").filter(Boolean);
    for (const row of rows) {
      const cells = row.split(",");
      assert.ok(cells.some((cell) => /^Department [A-Z]$/.test(cell)),
        `${file.adapter}: every row must name a placeholder org unit`);
      assert.ok(cells.some((cell) => /^acme-model-[a-z]$/.test(cell)),
        `${file.adapter}: every row must name a placeholder model`);
    }
  }
});

test("the download controls are painted on the import panel, one pair per adapter", async () => {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  const list = document.getElementById("import-recipes-list");
  await waitFor(() => list.dataset.sampleDownloads === "mounted",
    "the deferred download controls to mount");

  for (const file of IMPORT_SAMPLE_FILES) {
    const row = document.getElementById(`import-recipe-${file.adapter}`);
    const controls = row.querySelectorAll(".provider-readiness-download");
    assert.equal(controls.length, 2,
      `${file.adapter}: one blank template control and one worked sample control`);
    const text = textOf(row);
    assert.ok(text.includes(file.documentedTotalLabel),
      `${file.adapter}: the sample control must say what the file imports as`);
    for (const control of controls) {
      assert.equal(control.type, "button",
        `${file.adapter}: a download control must never submit anything`);
      assert.equal(control.dataset.adapter, file.adapter);
      assert.equal(textOf(control), downloadLabel(file, control.dataset.sampleKind),
        `${file.adapter}: the button must be worded by the module, never by the page`);
    }
  }

  // Both kinds, on the first adapter: the bytes a reader receives are the bytes
  // the assertions above ran through the importer, under a stable file name.
  const [first] = IMPORT_SAMPLE_FILES;
  const row = document.getElementById(`import-recipe-${first.adapter}`);
  for (const control of row.querySelectorAll(".provider-readiness-download")) control.click();
  assert.equal(page.downloads.length, 2, "each control hands over exactly one file");
  for (const kind of Object.values(SAMPLE_DOWNLOAD_KINDS)) {
    const expected = downloadPayload(first, kind);
    const received = page.downloads.find((entry) => entry.filename === expected.fileName);
    assert.ok(received, `the ${kind} control must download ${expected.fileName}`);
    assert.equal(received.text, expected.text,
      `the ${kind} download must be the exact bytes the contract emits`);
  }
  // The globals are deliberately left installed: this page keeps async work in
  // flight after its ready flag, and restoring them here makes that work fail on
  // a missing `document` rather than finishing quietly.
});
