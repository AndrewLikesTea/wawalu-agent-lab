import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadExampleDataset } from "../src/example-dataset.js";
import {
  BENCHMARK_ID, CTO_QUESTION, DISCLOSURE_ONLY_IDS, buildEvolutionFinding,
} from "../src/evolution-finding-contract.js";
import { renderEvolutionFinding } from "../src/evolution-finding-view.js";
import { FRONT_DOOR_QUESTION, prioritizedDestination } from "../src/finops-destinations.js";
import { parseHtml, textOf } from "./support/browser.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

test("the finding contract defines one CTO answer before presentation", () => {
  const finding = buildEvolutionFinding(loadExampleDataset());

  assert.equal(finding.question, CTO_QUESTION);
  assert.deepEqual({
    id: finding.primaryBenchmark.id,
    amount: finding.primaryBenchmark.amount,
    currency: finding.primaryBenchmark.currency,
    unit: finding.primaryBenchmark.unit,
    period: finding.primaryBenchmark.period,
    modeled: finding.primaryBenchmark.modeled,
    realized: finding.primaryBenchmark.realized,
  }, {
    id: BENCHMARK_ID,
    amount: 51254,
    currency: "USD",
    unit: "USD/month",
    period: "2026-06-01 to 2026-07-01",
    modeled: true,
    realized: false,
  });
  assert.equal(finding.nextAction.rank, 1);
  assert.match(finding.nextAction.statement, /^Move Atlas Platform/);
  assert.equal(finding.realizedSavings.available, false);
  assert.equal(finding.realizedSavings.amount, null);
});

// The failure this guards is silent: a contract that ranked departments for
// itself would render an action naming one department while the destination
// pages, the workspace nav and the front-door markup named another, and every
// one of those surfaces would still be green.
test("the question and the action are read, not restated", () => {
  const finding = buildEvolutionFinding(loadExampleDataset());
  const destination = prioritizedDestination();

  assert.equal(CTO_QUESTION, FRONT_DOOR_QUESTION);
  assert.equal(finding.question, FRONT_DOOR_QUESTION);
  assert.equal(finding.nextAction.statement, destination.nextAction);
  assert.equal(finding.nextAction.href, destination.href);
});

test("the rendered first answer has exactly one primary benchmark and one next action", () => {
  const document = parseHtml(html);
  const region = document.getElementById("finops-recoverable-answer");
  renderEvolutionFinding(document, buildEvolutionFinding(loadExampleDataset()));

  assert.equal(region.querySelectorAll('[data-primary-benchmark="true"]').length, 1);
  assert.equal(region.querySelectorAll('[data-next-action="true"]').length, 1);
  assert.equal(region.querySelectorAll(".stand-figure-value").length, 1);
  assert.equal(textOf(document.getElementById("finops-recoverable-value")), "$51,254");
  assert.match(textOf(document.getElementById("finops-recoverable-basis")),
    /Modelled potential, not realized savings/);
  assert.doesNotMatch(textOf(document.getElementById("finops-recoverable-basis")), /a year/);

  const disclosure = document.getElementById("finops-recoverable-how-we-know");
  assert.ok(!disclosure.open);
  for (const id of ["finops-recoverable-trust", "finops-recoverable-confidence-detail",
    "finops-recoverable-provenance-detail"]) {
    assert.ok(document.getElementById(id).closest("details#finops-recoverable-how-we-know"),
      `${id} must remain disclosure-only support`);
  }
});

// Every supporting signal the contract demotes is one the page used to state
// beside the money. The harness reads text through a shut disclosure, so this
// walks ancestors rather than reading text: folded away is exactly what a
// text-only assertion cannot see.
test("the supporting facts the contract names disclosure-only are folded away", () => {
  const document = parseHtml(html);
  const finding = buildEvolutionFinding(loadExampleDataset());
  assert.deepEqual(finding.disclosureOnlyIds, DISCLOSURE_ONLY_IDS);

  for (const id of DISCLOSURE_ONLY_IDS) {
    const node = document.getElementById(id);
    assert.ok(node, `#${id} is no longer authored in the document`);
    let disclosed = false;
    for (let walk = node; walk; walk = walk.parentNode) {
      if (walk.id === "finops-recoverable-how-we-know") disclosed = true;
    }
    assert.ok(disclosed, `#${id} is a rival answer beside the benchmark, not disclosed support`);
  }
});

// The error path, which is the one a first-time CTO is likeliest to hit on a
// cold open. A figure that cannot be stated must not leave the served counts
// behind claiming five scored departments.
test("an unstatable benchmark withdraws its scope rather than keeping the served counts", () => {
  const document = parseHtml(html);
  const finding = buildEvolutionFinding({ period: "2026-01-01 to 2026-02-01", rankedDepartments: [] });
  assert.equal(finding.primaryBenchmark.available, false);
  renderEvolutionFinding(document, finding);

  const figure = document.getElementById("finops-recoverable-figure");
  assert.equal(figure.dataset.available, "false");
  assert.equal(figure.dataset.scoredDepartments, "0");
  assert.equal(figure.dataset.totalDepartments, "0");
  assert.equal(textOf(document.getElementById("finops-recoverable-value")), "Not stated");
  assert.doesNotMatch(textOf(document.getElementById("finops-recoverable-basis")), /5 of 5/);
});
