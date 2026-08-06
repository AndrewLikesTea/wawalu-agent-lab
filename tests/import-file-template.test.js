// The blank template and the worked sample per pinned adapter (#1167), as a
// contract and on the surface that has to use it.
//
// FOUR THINGS ONLY THIS FILE CAN CATCH.
//
// 1. A template that has gone stale against the adapter contract. The expected
//    headers are re-derived here from PROVIDER_ADAPTERS and SHAPES — the root
//    facts — while the generator reaches them through its own path, so a column
//    added, removed or renamed in the contract without the template following
//    reds this test instead of shipping a file the importer would refuse.
// 2. A documented figure that does not survive the importer. Each worked sample
//    is fed through `parseDelimitedFinopsFile`, the real delimited intake the
//    drop handler calls, and asserted to land on the exact total the surface
//    prints beside the download control. Both numbers are one constant in
//    `import-recipes.js`, so they cannot drift apart quietly either.
// 3. A sample row that looks like somebody's data. Enforced as a rule over every
//    cell, not read once and trusted.
// 4. The rows landing in the initial payload. The generator is reached by
//    `await import(...)`; the static-graph walk below is what makes that
//    measurable rather than merely intended.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

import {
  IMPORT_FILE_TEMPLATES, TEMPLATE_MEDIA_TYPE, importFileTemplateArtifact, templateForAdapter,
} from "../src/import-file-template.js";
import { IMPORT_RECIPES, SAMPLE_ROW_COUNT, recipeForAdapter } from "../src/import-recipes.js";
import { PROVIDER_ADAPTERS } from "../src/multi-provider-intake.js";
import { SHAPES, detectShape, parseDelimitedFinopsFile } from "../src/finops-tabular-import.js";
import { staticModuleGraph } from "../scripts/check-size-budget.mjs";
import { formatUsd } from "../src/evolution.js";

const SRC = new URL("../src/", import.meta.url);
const PAGE = new URL("evolution.html", SRC);
const DEMO_DATA = JSON.parse(await readFile(new URL("evolution-demo-data.json", SRC), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("finops-evaluation-fixtures.json", SRC), "utf8"));

/** The columns the contract itself declares, reached without the generator. */
function contractColumns(adapter) {
  const shape = SHAPES.find((entry) => entry.id === adapter.shapes[0]);
  return Object.values(shape.columns).filter((spec) => spec.required).map((spec) => spec.aliases[0]);
}

const lines = (text) => text.split("\r\n").filter((line) => line.length > 0);

// Descendant selectors throw in this harness, so ancestry is walked.
function ancestorIds(node) {
  const ids = [];
  for (let current = node?.parentNode; current && current.nodeType === 1; current = current.parentNode) {
    if (current.id) ids.push(current.id);
  }
  return ids;
}

/* -------------------------------- contract -------------------------------- */

test("every pinned adapter publishes a blank template and a worked sample", () => {
  assert.equal(IMPORT_FILE_TEMPLATES.length, PROVIDER_ADAPTERS.length,
    "one template pair per pinned adapter, derived from the contract rather than listed");
  for (const adapter of PROVIDER_ADAPTERS) {
    const entry = templateForAdapter(adapter.id);
    assert.ok(entry, `${adapter.id} must publish a template pair`);
    assert.equal(entry.label, adapter.label, `${adapter.id} must be named as the contract names it`);
    for (const kind of ["blank", "sample"]) {
      assert.equal(entry[kind].mediaType, TEMPLATE_MEDIA_TYPE);
      assert.equal(importFileTemplateArtifact(adapter.id, kind), entry[kind]);
    }
  }
  assert.equal(importFileTemplateArtifact("no-such-adapter", "blank"), null,
    "an unknown adapter yields no file rather than an exception in the reader's tab");
  assert.equal(importFileTemplateArtifact(PROVIDER_ADAPTERS[0].id, "toString"), null,
    "only the two declared kinds are artifacts");
});

test("the blank template's headers are the adapter contract's columns, in order", () => {
  for (const adapter of PROVIDER_ADAPTERS) {
    const expected = contractColumns(adapter);
    const entry = templateForAdapter(adapter.id);
    const header = lines(entry.blank.text);
    assert.equal(header.length, 1, `${adapter.id}: a blank template carries headers and no rows`);
    assert.deepEqual(header[0].split(","), expected,
      `${adapter.id}: the blank template's headers must be the contract's columns, in order`);
    assert.deepEqual([...entry.columns], expected);
    // The same list the surface prints as "Columns read". Two derivations of one
    // contract; a lead must never be shown one set and handed the other.
    assert.deepEqual([...recipeForAdapter(adapter.id).columns], expected,
      `${adapter.id}: the row and the template must name the same columns`);
    // And the importer agrees it is this shape: a renamed column the template
    // followed but the alias table did not is still a file that will not import.
    const binding = detectShape(header[0].split(","));
    assert.equal(binding.recognized, true, `${adapter.id}: the blank template must be recognized`);
    assert.equal(binding.shape.id, adapter.shapes[0]);
    assert.deepEqual(binding.missing, []);
  }
});

test("each template republishes its adapter's own partial, stale and reordered behavior", () => {
  for (const adapter of PROVIDER_ADAPTERS) {
    // Identity, not a copy: the note a reader sees is the contract's own text.
    assert.equal(templateForAdapter(adapter.id).failureBehavior, adapter.failureBehavior,
      `${adapter.id}: the template must reference the adapter's failure behavior, not restate it`);
    for (const mode of ["partial", "stale", "malformed", "reordered", "incomplete"]) {
      assert.ok(adapter.failureBehavior[mode]?.length > 0,
        `${adapter.id}: the contract must state what happens to a ${mode} file`);
    }
  }
});

test("each download has a stable, provider-named filename", () => {
  const names = IMPORT_FILE_TEMPLATES.flatMap((entry) => [entry.blank.fileName, entry.sample.fileName]);
  assert.equal(new Set(names).size, names.length, "two downloads must never collide in a folder");
  for (const entry of IMPORT_FILE_TEMPLATES) {
    assert.equal(entry.blank.fileName, `${entry.adapter}-blank-template.csv`);
    assert.equal(entry.sample.fileName, `${entry.adapter}-worked-sample.csv`);
  }
});

/* --------------------------- executable fixture --------------------------- */

test("each worked sample imports through the real intake and produces the documented figure", () => {
  for (const adapter of PROVIDER_ADAPTERS) {
    const entry = templateForAdapter(adapter.id);
    const documented = recipeForAdapter(adapter.id).sampleTotalMinor;
    // The importer itself, not a reimplementation of it: this is the call the
    // drop handler makes on a file a reader chose.
    const result = parseDelimitedFinopsFile(entry.sample.text, entry.sample.fileName);
    assert.equal(result.ok, true, `${adapter.id}: the worked sample must import`);
    assert.equal(result.shape, adapter.shapes[0],
      `${adapter.id}: the sample must be read as this adapter's shape, not another's`);
    assert.equal(result.acceptedRows, SAMPLE_ROW_COUNT, `${adapter.id}: every sample row must be read`);
    assert.equal(result.skippedRows, 0, `${adapter.id}: no sample row may be skipped`);
    assert.equal(result.totals.currency, "USD");
    assert.equal(result.totals.amountMinor, documented,
      `${adapter.id}: the sample must add up to the figure the surface documents`);
    assert.equal(lines(entry.sample.text).length, SAMPLE_ROW_COUNT + 1,
      `${adapter.id}: a handful of rows and one header, not a corpus`);
  }
});

test("the reordered and malformed behavior each adapter declares holds for its own sample", () => {
  for (const adapter of PROVIDER_ADAPTERS) {
    const entry = templateForAdapter(adapter.id);
    const documented = recipeForAdapter(adapter.id).sampleTotalMinor;
    const grid = lines(entry.sample.text).map((line) => line.split(","));
    // "Columns are matched by header name, so any column order imports
    // identically" — the adapter's own words, put to its own sample rather than
    // taken on trust. Reversing the column order is the strongest reordering
    // there is, and it must not move the figure by a cent.
    const reversed = grid.map((row) => [...row].reverse().join(",")).join("\r\n") + "\r\n";
    const shuffled = parseDelimitedFinopsFile(reversed, entry.sample.fileName);
    assert.equal(shuffled.ok, true, `${adapter.id}: a column-reordered sample must still import`);
    assert.equal(shuffled.totals.amountMinor, documented,
      `${adapter.id}: column order must not move the figure`);

    // "A row whose date or amount cannot be read is located and skipped; the
    // file still imports." The last row's amount is replaced with a word.
    const damaged = [...grid];
    damaged[damaged.length - 1] = grid.at(-1).map((cell, index) =>
      (index === grid[0].length - 1 ? "not-a-number" : cell));
    const partial = parseDelimitedFinopsFile(
      damaged.map((row) => row.join(",")).join("\r\n") + "\r\n", entry.sample.fileName);
    assert.equal(partial.ok, true, `${adapter.id}: one unreadable row must not refuse the file`);
    assert.equal(partial.skippedRows, 1, `${adapter.id}: the unreadable row must be located`);
    assert.ok(partial.totals.amountMinor < documented,
      `${adapter.id}: a skipped row must leave the total short, never be assumed`);
  }
});

test("no sample row carries anything that could be mistaken for real data", () => {
  // A cell is a placeholder unit, a placeholder model, an ISO day, or a decimal
  // amount. Nothing else is allowed to be in a file this page hands out.
  const ALLOWED = /^(?:example-[a-z-]+|\d{4}-\d{2}-\d{2}|\d+(?:\.\d+)?)$/;
  const FORBIDDEN = [/@/, /\barn:/i, /\bsk-/i, /acct[_-]/i, /\bs3:/i, /\bkey\b/i, /https?:/i];
  for (const entry of IMPORT_FILE_TEMPLATES) {
    for (const line of lines(entry.sample.text).slice(1)) {
      for (const cell of line.split(",")) {
        assert.match(cell, ALLOWED,
          `${entry.adapter}: “${cell}” is not obviously synthetic`);
        for (const pattern of FORBIDDEN) {
          assert.doesNotMatch(cell, pattern, `${entry.adapter}: “${cell}” looks like a real identifier`);
        }
      }
    }
  }
});

/* ------------------------------ initial payload ---------------------------- */

test("the generator stays out of the page's static import graph", async () => {
  const { modules, missing } = await staticModuleGraph(
    SRC.pathname, "/evolution-page.js", (path) => readFile(path, "utf8"));
  assert.deepEqual(missing, [], "every static import of the page entry must resolve in src/");
  assert.ok(modules.includes("/import-recipes.js"),
    "the walk must actually be reaching the page's contract modules");
  assert.equal(modules.includes("/import-file-template.js"), false,
    "the template rows must be reached by await import(...), never served before a reader asks");
});

/* --------------------------------- surface -------------------------------- */

test("every pinned adapter's row offers both files, with the figure the sample owes", async (t) => {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  t.after(() => page.restore());
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");

  const buttons = document.querySelectorAll("[data-template]");
  assert.equal(buttons.length, PROVIDER_ADAPTERS.length * 2,
    "a blank template and a worked sample per pinned adapter, and no control for a recipe with neither");
  assert.equal(IMPORT_RECIPES.filter((recipe) => recipe.sampleTotalMinor === null).length, 1,
    "the query-sample recipe ships no template in this slice and must offer no control");

  for (const adapter of PROVIDER_ADAPTERS) {
    const detail = document.getElementById(`import-recipe-${adapter.id}-detail`);
    const text = textOf(detail);
    const documented = recipeForAdapter(adapter.id).sampleTotalMinor;
    assert.ok(text.includes(formatUsd(documented / 100)),
      `${adapter.id}: the sample's total must be stated beside its download control`);
    assert.ok(text.includes(`across ${SAMPLE_ROW_COUNT} rows`),
      `${adapter.id}: the row count must be stated too`);

    for (const kind of ["blank", "sample"]) {
      const button = document.querySelectorAll("[data-template]")
        .find((node) => node.dataset.adapter === adapter.id && node.dataset.template === kind);
      assert.ok(button, `${adapter.id}: no ${kind} control`);
      assert.equal(button.tagName.toLowerCase(), "button");
      assert.equal(button.type, "button", "a control inside a form region must not submit it");
      // Behind the row's file-shape disclosure, so the first screen gains no tab
      // stop until a reader opens the shape they are about to check.
      assert.ok(ancestorIds(button).includes(detail.id),
        `${adapter.id}: the ${kind} control belongs inside the file-shape disclosure`);

      const before = page.downloads.length;
      button.click();
      await waitFor(() => page.downloads.length > before, `the ${kind} download for ${adapter.id}`);
      const file = page.downloads.at(-1);
      assert.equal(file.filename, templateForAdapter(adapter.id)[kind].fileName);
      assert.equal(file.text, templateForAdapter(adapter.id)[kind].text,
        `${adapter.id}: the reader receives the bytes the contract generated`);
    }
  }

  // The loop closed: the bytes the page actually handed over, fed back through
  // the importer, produce the figure the page printed next to the control.
  const delivered = page.downloads.filter((file) => file.filename.endsWith("-worked-sample.csv"));
  assert.equal(delivered.length, PROVIDER_ADAPTERS.length);
  for (const file of delivered) {
    const adapterId = file.filename.replace("-worked-sample.csv", "");
    assert.equal(parseDelimitedFinopsFile(file.text, file.filename).totals.amountMinor,
      recipeForAdapter(adapterId).sampleTotalMinor,
      `${adapterId}: the downloaded sample must produce the documented figure`);
  }
});
