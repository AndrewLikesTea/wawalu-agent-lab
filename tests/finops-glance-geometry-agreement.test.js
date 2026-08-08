// Production-path agreement: the composed model paints src/evolution.html, and
// an executable fixture independently re-derives every coordinate beside all
// four prose lines. Prompt text is absent from this fixture by design.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { loadExampleDataset, EXAMPLE_ORG_COHORT_PROFILE, EXAMPLE_TASK_LEDGER } from "../src/example-dataset.js";
import { composeStandHeadline } from "../src/finops-stand.js";
import { applyStandHeadline } from "../src/finops-stand-view.js";
import { evaluateRankingReproducibility } from "../src/ranking-reproducibility.js";
import { GLANCE_CHART_FALLBACK } from "../src/glance-figure-charts.js";
import { glanceGeometryViolations, svgGeometryBytes } from "./fixtures/finops-glance-geometry.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const analysis = loadExampleDataset();
const reproducibility = evaluateRankingReproducibility({
  org: EXAMPLE_ORG_COHORT_PROFILE, spendUsd: Number(analysis.spendUsd),
  tasks: EXAMPLE_TASK_LEDGER, analysis,
});
const headline = composeStandHeadline({ analysis, reproducibility, source: "example" });

function paint(value = headline) {
  const document = parseHtml(html);
  applyStandHeadline(document, value, { announce: false });
  return document.getElementById("finops-glance");
}

test("all four production glance pictures agree with the model result printed beside them", () => {
  const block = paint();
  assert.equal(block.querySelectorAll("svg").length, 4);
  assert.deepEqual(glanceGeometryViolations(block, headline.glance), []);
});

test("the agreement check detects a perturbed model series", () => {
  const figures = headline.glance.figures.map((figure) => figure.key === "departmentRank"
    ? { ...figure, series: [figure.series[0] * 2, ...figure.series.slice(1)] } : figure);
  const perturbed = { ...headline.glance, figures };
  assert.deepEqual(glanceGeometryViolations(paint(), perturbed), ["departmentRank: coordinates diverged"]);
});

test("empty, single-period and all-equal movement series state the fallback instead of drawing flat", () => {
  for (const series of [[], [7], [7, 7, 7]]) {
    const glance = { ...headline.glance, figures: headline.glance.figures.map((figure) =>
      figure.key === "movement" ? { ...figure, measured: series.length > 0, series } : figure) };
    const block = paint({ ...headline, glance });
    assert.equal(block.querySelectorAll('[data-chart="movement"]').length, 0);
    const movementLine = [...block.querySelectorAll("p")].find((node) => textOf(node).includes("Month-over-month movement"));
    assert.match(textOf(movementLine), new RegExp(GLANCE_CHART_FALLBACK));
  }
});

test("identical inputs produce byte-identical geometry without clock or randomness", async () => {
  const first = svgGeometryBytes(paint());
  const second = svgGeometryBytes(paint());
  assert.equal(first, second);
  const sources = await Promise.all(["../src/glance-figure-charts.js", "../src/finops-glance-spec.js"]
    .map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /Date\.now|new Date|Math\.random|crypto\.randomUUID/);
});
