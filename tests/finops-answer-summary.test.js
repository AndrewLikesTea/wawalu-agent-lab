// The answer block's summary, and the per-destination datasets behind it.
//
// TWO CLAIMS ARE UNDER TEST AND ONE OF THEM IS THE ACCEPTANCE CRITERION.
//
//   1. AGREEMENT. `src/finops-answer-summary.js` derives the headline figure,
//      its unit, the confidence/provenance fields and the next-action target
//      from the fixture WITHOUT composing a stand headline. Those values must
//      equal what the composed path produces for the same fixture. Nothing here
//      is compared against a literal copied out of the fixture: every expected
//      value is the real output of `answerBlock(await buildStandHeadline())`,
//      which reaches the briefing contract, the leading finding, the
//      reproducibility gate, the cohort validator and the destination record.
//      The load-bearing check is below it — a fixture the two sides have never
//      seen moves both of them, and off the shipped value.
//
//   2. THE MEMO. Each destination computes its dataset on first open and
//      returns the same object identity after it, and opening one destination
//      leaves the other two uncomputed.
//
// ORDER MATTERS IN THIS FILE. The destination memo is module-scoped and lives
// for the life of the process, which is the property under test, so the memo
// assertions run before anything that could fill it. `node --test` runs each
// test file in its own process, so no other file can reach it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { FINOPS_ANSWER_SUMMARY } from "../src/finops-answer-summary.js";
import {
  ANSWER_DESTINATION, STAND_LABEL, answerBlock, asOfBasis, destination, periodLabel,
} from "../src/finops-screen-contract.js";
import { gradeExport } from "../src/export-gradability.js";
import { ANSWER_BLOCK_IDS, applyAnswerBlock } from "../src/finops-stand-view.js";
import {
  applyWorkspaceDestination, computedDestinationDatasets, destinationDataset,
  destinationOpening,
} from "../src/finops-workspace-shell.js";
import { WORKSPACE_DESTINATION } from "../src/finops-workspace-nav.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const SUMMARY_SOURCE = await readFile(
  new URL("../src/finops-answer-summary.js", import.meta.url), "utf8");

const byId = (document, id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// 1. The memo: first open computes, every open after it reads.
// ---------------------------------------------------------------------------

test("nothing is fetched before a destination is opened", () => {
  assert.deepEqual(computedDestinationDatasets(), [],
    "importing the shell must not fetch any destination's module");
});

test("opening evidence fetches evidence, and neither of the other two", async () => {
  const document = parseHtml(html);
  const opened = applyWorkspaceDestination(document, WORKSPACE_DESTINATION.evidence);
  // The open is synchronous and the fetch is not: the destination is on screen
  // before its module is, which is the property #821 exists to hold.
  assert.equal(opened, WORKSPACE_DESTINATION.evidence);
  assert.deepEqual(computedDestinationDatasets(), [],
    "the destination's module resolved on the synchronous open path");

  await destinationOpening(WORKSPACE_DESTINATION.evidence);
  assert.deepEqual(computedDestinationDatasets(), [WORKSPACE_DESTINATION.evidence],
    "opening one destination fetched another destination's module");
  assert.ok(destinationDataset(WORKSPACE_DESTINATION.evidence),
    "the evidence dataset must be a real briefing, not an empty state");
});

test("opening a destination twice fetches once: the second open is the same object", async () => {
  const document = parseHtml(html);
  const first = destinationDataset(WORKSPACE_DESTINATION.evidence);
  applyWorkspaceDestination(document, WORKSPACE_DESTINATION.answer);
  applyWorkspaceDestination(document, WORKSPACE_DESTINATION.evidence);
  await destinationOpening(WORKSPACE_DESTINATION.evidence);
  const second = destinationDataset(WORKSPACE_DESTINATION.evidence);
  // Identity, not equality: a second computation would produce an equal object
  // and pass a deepEqual, which is exactly the regression this must catch.
  assert.equal(second, first, "the second open re-fetched the evidence module");
  // …and the answer destination still has no module of its own to fetch.
  assert.equal(destinationDataset(WORKSPACE_DESTINATION.answer), null);
  assert.deepEqual(computedDestinationDatasets(), [WORKSPACE_DESTINATION.evidence]);
});

test("each destination's dataset is independent and cached on its own first open", async () => {
  const document = parseHtml(html);
  applyWorkspaceDestination(document, WORKSPACE_DESTINATION.department);
  await destinationOpening(WORKSPACE_DESTINATION.department);
  assert.deepEqual(computedDestinationDatasets(),
    [WORKSPACE_DESTINATION.evidence, WORKSPACE_DESTINATION.department],
    "opening departments must not have fetched act-and-verify");
  const finding = destinationDataset(WORKSPACE_DESTINATION.department);
  assert.equal(destinationDataset(WORKSPACE_DESTINATION.department), finding);

  applyWorkspaceDestination(document, WORKSPACE_DESTINATION.actAndVerify);
  await destinationOpening(WORKSPACE_DESTINATION.actAndVerify);
  assert.deepEqual(computedDestinationDatasets(), [
    WORKSPACE_DESTINATION.evidence, WORKSPACE_DESTINATION.department,
    WORKSPACE_DESTINATION.actAndVerify,
  ]);
  const record = destinationDataset(WORKSPACE_DESTINATION.actAndVerify);
  assert.equal(destinationDataset(WORKSPACE_DESTINATION.actAndVerify), record);
  assert.equal(record.valid, true, "the bundled destination record must pass its own contract");
});

// ---------------------------------------------------------------------------
// 2. Agreement. The acceptance criterion.
// ---------------------------------------------------------------------------

test("the summary carries every field the answer block's headline needs", () => {
  for (const field of ["figure", "ratio", "unit", "state", "available", "basis",
    "confidence", "action"]) {
    assert.ok(field in FINOPS_ANSWER_SUMMARY, `the summary declares no ${field}`);
  }
  assert.equal(FINOPS_ANSWER_SUMMARY.unit, ANSWER_DESTINATION.metricUnit);
  assert.equal(FINOPS_ANSWER_SUMMARY.question, ANSWER_DESTINATION.question);
  assert.equal(FINOPS_ANSWER_SUMMARY.metricLabel, ANSWER_DESTINATION.metricLabel);
  assert.ok(Object.isFrozen(FINOPS_ANSWER_SUMMARY));
});

test("the summary agrees with the panels' own composed answer, field for field", async () => {
  // The heavy path, in full: the briefing contract, the leading finding, the
  // ranking-reproducibility gate, the cohort-attribution validator and the
  // workspace-destination record, composed into one headline.
  const { buildStandHeadline } = await import("../src/finops-stand.js");
  const panel = answerBlock(await buildStandHeadline());

  assert.equal(FINOPS_ANSWER_SUMMARY.figure, panel.figure,
    "the summary's headline figure is not the figure the panels produce");
  assert.equal(FINOPS_ANSWER_SUMMARY.ratio, panel.ratio);
  assert.equal(FINOPS_ANSWER_SUMMARY.state, panel.state);
  assert.equal(FINOPS_ANSWER_SUMMARY.available, panel.available);
  // Confidence and provenance: the coverage/grade/residue sentence and the
  // as-of phrase, which is the dataset and its window and never a clock.
  assert.equal(FINOPS_ANSWER_SUMMARY.confidence, panel.confidence,
    "the summary's confidence sentence is not the panels' confidence sentence");
  assert.equal(FINOPS_ANSWER_SUMMARY.basis, panel.basis);
  // The next action, and the destination it targets.
  assert.deepEqual(FINOPS_ANSWER_SUMMARY.action, panel.action,
    "the summary's next action does not target what the panels' action targets");
  assert.ok(FINOPS_ANSWER_SUMMARY.action.href, "the next action must name a target");
});

test("the agreement is load-bearing: a fixture neither side has seen moves both", async () => {
  const { composeStandHeadline } = await import("../src/finops-stand.js");
  // A department set with genuine mixed coverage, built here rather than
  // committed. `sampling` and `mix` are what `departmentPerformance` reads to
  // decide a department was scored, so this grades for real.
  const scored = (id, spendUsd) => ({
    id, name: id, spendUsd, records: 10,
    sampling: { status: "available", sampledQueries: 40 },
    mix: { highValue: 0.6, routine: 0.4 },
  });
  const unscored = (id, spendUsd) => ({
    id, name: id, spendUsd, records: 10,
    sampling: { status: "unavailable", sampledQueries: 0, reason: "No queries were sampled." },
  });
  const rankedDepartments = [scored("Platform", 90000), unscored("Support", 10000)];
  const analysis = { period: "2026-05-01 to 2026-06-01", spendUsd: 100000, rankedDepartments };

  // The summary module's own path, applied to the moved fixture.
  const summarySide = answerBlock({
    label: STAND_LABEL.example,
    period: periodLabel(analysis),
    gradability: gradeExport({ analysis, source: "example" }),
  });
  // The composed path, applied to the same moved fixture.
  const panelSide = answerBlock(composeStandHeadline({ analysis, source: "example" }));

  assert.equal(summarySide.figure, panelSide.figure);
  assert.equal(summarySide.confidence, panelSide.confidence);
  assert.deepEqual(summarySide.action, panelSide.action);
  assert.equal(summarySide.basis, panelSide.basis);
  assert.equal(summarySide.basis, `as of ${asOfBasis({
    label: STAND_LABEL.example, period: "May 2026",
  })}`);
  // BOTH SIDES MOVED. The shipped summary is a different state entirely, so a
  // hardcoded expectation could not have produced this pair.
  assert.equal(summarySide.available, true);
  assert.match(summarySide.figure, /^90\.0% of spend in scope$/);
  assert.notEqual(summarySide.figure, FINOPS_ANSWER_SUMMARY.figure);
  assert.notEqual(summarySide.confidence, FINOPS_ANSWER_SUMMARY.confidence);
});

// ---------------------------------------------------------------------------
// 3. The block on the page renders from it, and the module reaches no panel.
// ---------------------------------------------------------------------------

test("the shipped answer block paints its four slots from the summary alone", () => {
  const document = parseHtml(html);
  // No headline, no analysis, no page entry: the default argument is the summary.
  const block = applyAnswerBlock(document);
  assert.ok(block, "the answer block must paint from the summary with no headline");
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.value)), FINOPS_ANSWER_SUMMARY.figure);
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.basis)), FINOPS_ANSWER_SUMMARY.basis);
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.confidence)),
    FINOPS_ANSWER_SUMMARY.confidence);
  const action = byId(document, ANSWER_BLOCK_IDS.action);
  assert.equal(textOf(action), FINOPS_ANSWER_SUMMARY.action.label);
  assert.equal(action.getAttribute("href"), FINOPS_ANSWER_SUMMARY.action.href);
  assert.equal(block.dataset.available, String(FINOPS_ANSWER_SUMMARY.available));
  // The target is one the contract owns, or the import panel for the state with
  // no residue to rank.
  const targets = new Set(["answer", "evidence", "departments", "act-and-verify"]
    .map((key) => destination(key).target).concat(["#local-import"]));
  assert.ok(targets.has(FINOPS_ANSWER_SUMMARY.action.href));
});

test("the summary module imports no per-panel dataset computation", () => {
  const imports = [...SUMMARY_SOURCE.matchAll(/from "\.\/([\w./-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(),
    ["example-dataset.js", "export-gradability.js", "finops-screen-contract.js"],
    "the summary reaches a module it must not; its headline is its own small path");
  for (const forbidden of ["finops-stand.js", "finops-briefing-contract.js",
    "finops-leading-finding.js", "finops-destination-contract.js", "cohort-attribution.js",
    "ranking-reproducibility.js", "finops-finding-resolver.js"]) {
    assert.ok(!SUMMARY_SOURCE.includes(`"./${forbidden}"`),
      `the summary imports ${forbidden}, so its headline is a panel computation again`);
  }
  // Exactly one export, and it is the object.
  const exports = [...SUMMARY_SOURCE.matchAll(/^export\s+(?:const|function|class)\s+(\w+)/gm)]
    .map((m) => m[1]);
  assert.deepEqual(exports, ["FINOPS_ANSWER_SUMMARY"]);
});
