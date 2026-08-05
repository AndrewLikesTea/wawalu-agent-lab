// The blank template and the worked sample per pinned adapter (#1167), as
// contracts and on the surface that hands them over.
//
// The worked samples are EXECUTABLE FIXTURES, not prose. Each one is fed
// through the shipped intake — the real delimited reader, the real shape
// detection, the real normalizer, the real contract validator — and then
// through the real trust verdict, and the total that verdict prints is asserted
// against the figure the page prints beside that provider's download control.
// Both come from `import-templates.js`, which derives the figure from the rows
// it also serializes, so no number is written down in this file or in the page.
//
// The blank templates are checked against the adapter contract's own columns
// rather than against a list spelled here: a renamed, reordered, added or
// removed contract column has to move the download, and a test carrying its own
// header strings would keep passing while the download went stale.
//
// The download is checked by its bytes, through the same button a reader
// clicks. The harness reads text through a closed disclosure, so placement is
// proved by walking ancestry, never by reading text.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

import {
  HEADLINE_FIGURE_KEY, IMPORT_TEMPLATES, IMPORT_TEMPLATES_LEAD, TEMPLATE_KINDS,
  templateForAdapter,
} from "../src/import-templates.js";
import { PROVIDER_ADAPTERS, screenSensitiveColumns } from "../src/multi-provider-intake.js";
import { recipeForAdapter } from "../src/import-recipes.js";
import { parseDelimitedFinopsFile } from "../src/finops-tabular-import.js";
import { trustVerdict } from "../src/finops-trust-verdict.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

// A fixed generation time: the importer stamps one, and a clock-dependent
// fixture is a fixture that fails at midnight rather than when it is wrong.
const GENERATED_AT = "2026-04-01T00:00:00.000Z";

const lines = (text) => text.replace(/\n$/, "").split("\n");

/** What the shipped importer makes of these bytes, with nothing stubbed. */
function importSample(template) {
  const result = parseDelimitedFinopsFile(template.sampleText, template.sampleFileName,
    { generatedAt: GENERATED_AT });
  assert.equal(result.ok, true,
    `the ${template.adapter} sample must import: ${JSON.stringify(result.problems ?? [])}`);
  return trustVerdict({ providers: [result.parsed] });
}

async function openFinopsTab() {
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

// Descendant selectors throw in this harness, so ancestry is walked.
function ancestorTags(node) {
  const tags = [];
  for (let current = node?.parentNode; current && current.nodeType === 1; current = current.parentNode) {
    tags.push(current.tagName.toLowerCase());
  }
  return tags;
}

test("every pinned adapter has exactly one template pair", () => {
  assert.equal(IMPORT_TEMPLATES.length, PROVIDER_ADAPTERS.length,
    "one blank template and one worked sample per pinned adapter, and no others");
  PROVIDER_ADAPTERS.forEach((adapter, index) => {
    const template = templateForAdapter(adapter.id);
    assert.equal(IMPORT_TEMPLATES[index].adapter, adapter.id,
      "the pairs follow the intake contract's declared order");
    assert.equal(template.label, adapter.label,
      `${adapter.id} must be named as the intake contract names it`);
    assert.notEqual(template.blankFileName, template.sampleFileName,
      `${adapter.id} must hand over two distinguishable files`);
  });
});

test("each blank template is the adapter contract's columns, in order, and no rows", () => {
  for (const template of IMPORT_TEMPLATES) {
    const rows = lines(template.blankText);
    assert.equal(rows.length, 1, `${template.adapter} template must carry no data rows`);
    // The columns the recipe row quotes, derived from the shape that reads this
    // adapter. Neither side of this comparison is spelled in this file.
    assert.deepEqual(rows[0].split(","), [...recipeForAdapter(template.adapter).columns],
      `${template.adapter} template must be the contract columns in contract order`);
    assert.deepEqual([...template.columns], rows[0].split(","),
      `${template.adapter} must publish the columns it wrote`);
  }
});

test("each worked sample repeats that header and stays readable in full", () => {
  for (const template of IMPORT_TEMPLATES) {
    const rows = lines(template.sampleText);
    assert.equal(rows[0], lines(template.blankText)[0],
      `${template.adapter} sample must carry the template's own header row`);
    assert.equal(rows.length - 1, template.rowCount,
      `${template.adapter} sample must carry the row count it declares`);
    assert.ok(template.rowCount >= 3 && template.rowCount <= 6,
      `${template.adapter} sample must stay short enough to read in full`);
    for (const row of rows.slice(1)) {
      assert.equal(row.split(",").length, template.columns.length,
        `${template.adapter} sample rows must fill every contract column`);
    }
  }
});

test("the worked samples import, and to the figure the page states", () => {
  for (const template of IMPORT_TEMPLATES) {
    const verdict = importSample(template);
    assert.equal(verdict.headline.total, template.headlineFigure,
      `${template.adapter} must import to the total stated beside its download`);
    assert.equal(verdict.headline.totalRows, template.rowCount,
      `every row of the ${template.adapter} sample must survive the real intake`);
  }
});

test("no sample carries anything that could read as customer data", () => {
  for (const template of IMPORT_TEMPLATES) {
    // The header screen the importer itself runs before a value is read: a
    // sample carrying a refused column would be teaching a file this product
    // rejects.
    assert.equal(screenSensitiveColumns(template.columns).ok, true,
      `${template.adapter} template must not name a column this import refuses`);
    const values = lines(template.sampleText).slice(1).flatMap((row) => row.split(","));
    for (const value of values) {
      assert.ok(value.length > 0 && value.length < 40,
        `${template.adapter} values must stay short placeholders, not free text`);
    }
    // Every non-numeric cell announces itself as an example. Cheap to satisfy
    // and the only way a reader can tell at a glance that nothing here is real.
    const named = values.filter((value) => !/^[\d.:TZ-]+$/.test(value));
    for (const value of named) {
      assert.match(value.toLowerCase(), /example/,
        `${template.adapter} must keep invented names self-evidently invented`);
    }
  }
});

test("both files are offered per adapter, in the open, from the import panel", async () => {
  const { document } = await openFinopsTab();
  assert.equal(textOf(document.getElementById("import-templates-lead")), IMPORT_TEMPLATES_LEAD,
    "the sentence explaining the two files is painted from the module");

  for (const template of IMPORT_TEMPLATES) {
    const row = document.getElementById(`import-recipe-${template.adapter}`);
    const buttons = row.querySelectorAll(".provider-readiness-download");
    assert.equal(buttons.length, TEMPLATE_KINDS.length,
      `${template.adapter} must offer a blank template and a worked sample`);
    for (const button of buttons) {
      assert.equal(button.getAttribute("type"), "button",
        "a download control is a button, reachable and operable from the keyboard");
      assert.equal(ancestorTags(button).includes("details"), false,
        `${template.adapter} downloads must be reachable with nothing opened`);
      assert.match(button.getAttribute("aria-label"), new RegExp(template.label
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        "a control read on its own must name the provider it downloads for");
    }
    // The promise, beside the controls and outside the disclosure: a figure a
    // lead can only see after opening something is a figure they compare too
    // late.
    const figure = row.querySelectorAll("p")
      .find((node) => textOf(node).startsWith(HEADLINE_FIGURE_KEY));
    assert.equal(textOf(figure), `${HEADLINE_FIGURE_KEY}${template.headlineFigure}`,
      `${template.adapter} must state what its sample imports as`);
    assert.equal(ancestorTags(figure).includes("details"), false,
      `${template.adapter} must state that figure with nothing opened`);
  }
});

test("each control hands over the bytes the fixture test imported", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  for (const template of IMPORT_TEMPLATES) {
    const row = document.getElementById(`import-recipe-${template.adapter}`);
    for (const kind of TEMPLATE_KINDS) {
      const button = row.querySelectorAll(".provider-readiness-download")
        .find((node) => node.dataset.templateKind === kind.id);
      button.click();
      const received = page.downloads.at(-1);
      assert.equal(received.filename, template[kind.fileKey],
        `the ${template.adapter} ${kind.id} control must name its own file`);
      assert.equal(received.text, template[kind.textKey],
        `the ${template.adapter} ${kind.id} control must hand over the generated bytes`);
    }
  }
  assert.equal(page.downloads.length, IMPORT_TEMPLATES.length * TEMPLATE_KINDS.length,
    "one click, one file, and no file generated before it was asked for");
});
