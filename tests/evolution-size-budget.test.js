// The size-budget checker itself.
//
// Driven with fixture numbers rather than by growing the real build: a check
// that can only be tested by making the product worse is a check nobody runs.
// The real config is read too, because a budget file with a placeholder in it
// is the same as no budget at all.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CONFIG_PATH, evaluateBudgets, formatReport, staticModuleGraph,
} from "../scripts/check-size-budget.mjs";

const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));

const FIXTURE_CONFIG = {
  headroom: "2% over the measured baseline",
  artifacts: [
    { id: "page", label: "page.html", kind: "file", path: "page.html", budgetBytes: 1000 },
    { id: "graph", label: "entry graph", kind: "module-graph", entry: "/a.js", budgetBytes: 2000 },
  ],
};

test("the checker passes when every artifact is inside its budget", () => {
  const results = evaluateBudgets(FIXTURE_CONFIG, { page: 900, graph: 2000 });
  assert.equal(results.some((result) => result.over), false,
    "a measurement equal to the budget is inside it");
  const report = formatReport(results, FIXTURE_CONFIG);
  assert.match(report, /page\.html: measured 0\.9 KiB · budget 1\.0 KiB · delta -0\.1 KiB/,
    "a pass must still print the measured size, the budget, and the delta");
  assert.match(report, /entry graph: measured 2\.0 KiB · budget 2\.0 KiB · delta \+0\.0 KiB/);
  assert.match(report, /every tracked artifact is inside its budget/);
});

test("the checker fails, names the artifact, and says how to raise the baseline", () => {
  const results = evaluateBudgets(FIXTURE_CONFIG, { page: 1024 * 4, graph: 1500 });
  const over = results.filter((result) => result.over);
  assert.deepEqual(over.map((result) => result.id), ["page"],
    "only the artifact that exceeded its budget may fail");
  const report = formatReport(results, FIXTURE_CONFIG);
  assert.match(report, /FAIL page\.html: measured 4\.0 KiB · budget 1\.0 KiB · delta \+3\.0 KiB/);
  assert.match(report, /ok\s+entry graph: measured 1\.5 KiB/,
    "a failing run must still print every artifact, including the ones that passed");
  assert.match(report, /Over budget: page\.html \(page\)/,
    "the failure must name the artifact rather than only the total");
  assert.match(report, /config\/evolution-size-budget\.json/,
    "the failure must say where the baseline is written down");
  assert.match(report, /Set budgetBytes for the artifact above to the new measured size/,
    "the failure must say how to raise the baseline deliberately");
});

test("an artifact missing from the build output fails rather than silently passing", () => {
  const results = evaluateBudgets(FIXTURE_CONFIG, { graph: 100 });
  const page = results.find((result) => result.id === "page");
  assert.equal(page.over, true);
  assert.equal(page.unmeasured, true);
  assert.match(formatReport(results, FIXTURE_CONFIG),
    /FAIL page\.html: not present in the build output/);
});

test("the module graph follows static imports and stops at a dynamic one", async () => {
  const sources = {
    "/a.js": `import { b } from "/b.js";\nimport { c } from "./c.js";\n`
      + `export async function later() { return import("/deferred.js"); }\n`,
    "/b.js": "export const b = 1;\n",
    "/c.js": "export const c = 2;\n",
    "/deferred.js": "export const d = 3;\n",
  };
  const readText = async (path) => {
    const served = `/${String(path).replace(/^.*dist\//, "")}`;
    if (!(served in sources)) throw new Error(`no such module ${served}`);
    return sources[served];
  };
  const { modules, missing } = await staticModuleGraph("dist", "/a.js", readText);
  assert.deepEqual(modules, ["/a.js", "/b.js", "/c.js"],
    "a module behind a dynamic import() is not in the initial payload and must not be counted");
  assert.deepEqual(missing, []);
});

test("the checked-in budget config is a real measurement, not a placeholder", () => {
  assert.ok(config.artifacts.length > 0);
  assert.match(config.headroom, /\S/, "the config must state the headroom it chose");
  const evolution = config.artifacts.find((artifact) => artifact.id === "evolution-html");
  assert.ok(evolution, "the page itself must be tracked");
  for (const artifact of config.artifacts) {
    assert.ok(Number.isInteger(artifact.budgetBytes) && artifact.budgetBytes > 0,
      `${artifact.id} must carry a real byte budget`);
    assert.ok(typeof artifact.baseline === "string" && artifact.baseline.length > 40,
      `${artifact.id} must say in one line where its baseline came from`);
    assert.doesNotMatch(artifact.baseline, /PLACEHOLDER/,
      `${artifact.id}'s baseline note must be written, not stubbed`);
  }
});
