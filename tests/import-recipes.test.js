// The recipe per pinned adapter (#1166), as a contract and on the surface that
// has to use it.
//
// Two things only this file can catch. First, drift between the recipe list and
// the contracts it claims to read: the adapter assertion is driven off
// PROVIDER_ADAPTERS, so a fourth adapter with no recipe reds this test rather
// than shipping a list that names three of four. Second, the placement rule the
// issue exists for — the half an export supplies has to be readable with
// nothing opened, because a lead who learns it after pulling the file runs the
// errand twice. The harness reads text through a closed disclosure, so "the
// text is there" is not evidence a person can see it; ancestry is walked.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

import {
  IMPORT_RECIPES, IMPORT_RECIPES_LEAD, RECIPE_SUPPLIES, SUPPLIES_MARKER, recipeForAdapter,
} from "../src/import-recipes.js";
import { PROVIDER_ADAPTERS } from "../src/multi-provider-intake.js";
import { packageById } from "../src/provider-export-package.js";
import { SHAPES } from "../src/finops-tabular-import.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

// Descendant selectors throw in this harness, so ancestry is walked.
function ancestorTags(node) {
  const tags = [];
  for (let current = node?.parentNode; current && current.nodeType === 1; current = current.parentNode) {
    tags.push(current.tagName.toLowerCase());
  }
  return tags;
}

test("every pinned adapter has exactly one recipe", () => {
  for (const adapter of PROVIDER_ADAPTERS) {
    const matches = IMPORT_RECIPES.filter((recipe) => recipe.adapter === adapter.id);
    assert.equal(matches.length, 1, `${adapter.id} must have exactly one recipe`);
    assert.equal(matches[0].label, adapter.label,
      `${adapter.id} must be named as the intake contract names it`);
    assert.equal(recipeForAdapter(adapter.id)?.adapter, adapter.id);
  }
  assert.equal(IMPORT_RECIPES.filter((recipe) => recipe.supplies === RECIPE_SUPPLIES.spend).length,
    PROVIDER_ADAPTERS.length, "the spend recipes are the pinned adapters and nothing else");
});

test("each recipe names one report, one question, and which half it supplies", () => {
  for (const recipe of IMPORT_RECIPES) {
    assert.ok(recipe.report.length > 0, `${recipe.adapter} must name the report to pull`);
    assert.ok(recipe.question.includes("?"), `${recipe.adapter} must state a question`);
    assert.ok(recipe.grouping.length > 0, `${recipe.adapter} must state its row unit`);
    assert.ok(recipe.columns.length > 0, `${recipe.adapter} must list the columns read`);
    assert.ok(Object.values(RECIPE_SUPPLIES).includes(recipe.supplies),
      `${recipe.adapter} must supply spend or sample, not ${recipe.supplies}`);
  }
  for (const kind of Object.values(RECIPE_SUPPLIES)) {
    assert.ok(IMPORT_RECIPES.some((recipe) => recipe.supplies === kind),
      `at least one recipe must supply ${kind}; the headline figure needs both halves`);
  }
});

test("no recipe invents a report name or a column the importer does not accept", () => {
  for (const adapter of PROVIDER_ADAPTERS) {
    const recipe = recipeForAdapter(adapter.id);
    assert.equal(recipe.report, packageById(adapter.packageId).export_request.ask_for,
      `${adapter.id} must ask for what its export package declares`);
    assert.equal(recipe.grouping, adapter.billingGrain,
      `${adapter.id} must state the billing grain the adapter declares`);
    const shape = SHAPES.find((entry) => entry.id === adapter.shapes[0]);
    const required = Object.values(shape.columns)
      .filter((spec) => spec.required).map((spec) => spec.aliases[0]);
    assert.deepEqual([...recipe.columns], required,
      `${adapter.id} must list the required columns of the shape that reads it`);
  }
});

test("the recipes are painted on the import panel, with the supplies half in the open", async () => {
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
  assert.equal(list.children.length, IMPORT_RECIPES.length,
    "one row per recipe, painted from the contract-derived list");
  assert.equal(textOf(document.getElementById("import-recipes-lead")), IMPORT_RECIPES_LEAD,
    "the two-inputs sentence is painted from the module, never authored in the page");
  assert.equal(ancestorTags(document.getElementById("import-recipes-lead")).includes("details"),
    false, "the two-inputs sentence must be readable with nothing opened");

  for (const recipe of IMPORT_RECIPES) {
    const row = document.getElementById(`import-recipe-${recipe.adapter}`);
    assert.equal(row.dataset.supplies, recipe.supplies,
      `${recipe.adapter} must carry which half it supplies as an attribute`);
    assert.equal(ancestorTags(row).includes("details"), false,
      `${recipe.adapter} must be listed with nothing opened`);
    const text = textOf(row);
    for (const phrase of [recipe.label, SUPPLIES_MARKER[recipe.supplies], recipe.question,
      recipe.report, recipe.grouping, ...recipe.columns]) {
      assert.ok(text.includes(phrase), `${recipe.adapter} must say “${phrase}”`);
    }
    // The row unit and the columns are the part that folds away: they answer a
    // failed import, not the errand a lead is deciding on.
    const detail = document.getElementById(`import-recipe-${recipe.adapter}-detail`);
    assert.equal(detail.tagName.toLowerCase(), "details");
    assert.ok(textOf(detail).includes(recipe.grouping),
      `${recipe.adapter} keeps its row unit behind the disclosure`);
    assert.equal(ancestorTags(detail).includes("details"), false,
      "one disclosure deep: a recipe is never nested inside another one");
  }
});
