// The drill-down an imported export earns, in the region the example owned.
//
// The regression this exists to catch is the one #979 names: importing your own
// export used to RETIRE the richest region on the page, so the reader who
// supplied real data saw less structure than the visitor who supplied none.
//
// What is pinned here is therefore the shape of the hand-over, not a screenshot
// of it:
//
//   1. The region survives an import, exactly once, populated from imported
//      numbers rather than from the bundled example's.
//   2. Rank 1 in the drill-down IS the department the imported headline names as
//      its driver — the same call, not two that agree today.
//   3. An export with no department dimension says which grouping it fell back
//      to and why, in visible text, and stays keyboard reachable saying it.
//   4. Exactly one summary is on screen: the example's answer, benchmark,
//      impact, peer and confidence blocks are withheld while the imported
//      headline stands.
//   5. The disclosure is still shut, and the headline number is still readable
//      with it shut — this harness models no layout, so `open`/`aria-expanded`
//      are asserted directly rather than inferred from text being present.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import {
  DRILLDOWN_GROUPING, DRILLDOWN_UNAVAILABLE, importedDrilldown,
} from "../src/finops-imported-drilldown.js";
import { importedHeadline, rankDepartments } from "../src/finops-imported-headline.js";
import { FIRST_RUN_IDS, SLOT_LABEL } from "../src/finops-first-run.js";
import {
  applyFirstRunResult, applyImportedDrilldown, restoreFirstRunExample,
} from "../src/finops-first-run-view.js";
import { applyImportedHeadline } from "../src/finops-imported-headline-view.js";
import { buildFirstRunResult } from "../src/finops-first-run.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const byId = (document, id) => document.getElementById(id);

/**
 * An imported envelope, generated here rather than committed: only the fields
 * the drill-down and the headline read are present, which is also the statement
 * of what this feature depends on.
 */
function envelope(departments, { period = "2026-06" } = {}) {
  const spendUsd = departments.reduce((total, entry) => total + entry.spendUsd, 0);
  const recoverableUsd = departments.reduce((total, entry) => total + entry.recoverableUsd, 0);
  return {
    schemaVersion: "local-finops-history/1.0.0",
    currency: "USD",
    spendUsd,
    recoverableUsd,
    action: "Pilot lower-cost routing in the top-spend group.",
    rankedDepartments: departments,
    history: {
      periods: [{ period, completeness: "complete", spendUsd, recoverableUsd }],
    },
  };
}

const IMPORTED = envelope([
  { id: "u-1", name: "Department …atlas0", spendUsd: 48_000, recoverableUsd: 12_400 },
  { id: "u-2", name: "Department …boreal", spendUsd: 61_000, recoverableUsd: 9_100 },
  { id: "u-3", name: "Department …cinder", spendUsd: 12_000, recoverableUsd: 3_050 },
  { id: "u-4", name: "Department …dorado", spendUsd: 9_000, recoverableUsd: 0 },
]);

const drilldownFor = (analysis, options = {}) =>
  importedDrilldown({ analysis, departmentDimension: true, ...options });

async function importedPage(analysis, options = {}) {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  applyFirstRunResult(document, buildFirstRunResult());
  const drilldown = drilldownFor(analysis, options);
  applyImportedDrilldown(document, drilldown);
  return { document, drilldown };
}

test("an import repopulates the drill-down instead of retiring the region", async () => {
  const { document, drilldown } = await importedPage(IMPORTED);
  const region = byId(document, FIRST_RUN_IDS.region);

  // Once, and still on screen: this is the retirement the issue is about.
  assert.equal(document.querySelectorAll(`#${FIRST_RUN_IDS.region}`).length, 1);
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.superseded, "false");
  assert.equal(region.dataset.source, "imported");

  // Populated from the imported numbers, in rank order, and not from the
  // bundled example's five invented departments.
  assert.equal(drilldown.rows.length, 3);
  assert.deepEqual(drilldown.rows.map((row) => row.rank), [1, 2, 3]);
  assert.deepEqual(drilldown.rows.map((row) => row.name),
    ["Department …atlas0", "Department …boreal", "Department …cinder"]);
  const evidence = textOf(byId(document, FIRST_RUN_IDS.methodList));
  assert.match(evidence, /Rank 1 · Department …atlas0/);
  assert.match(evidence, /Rank 3 · Department …cinder/);
  assert.match(evidence, /\$12,400 recoverable · \$48,000 spend/);
  // A group with no recoverable spend is not ranked, so it is not a row.
  assert.doesNotMatch(evidence, /dorado/);
});

test("rank 1 and the headline's named driver are the same computation", async () => {
  const { drilldown } = await importedPage(IMPORTED);
  const named = importedHeadline(IMPORTED).slots.find((slot) => slot.id === "top_department");

  assert.equal(named.supported, true);
  assert.equal(drilldown.rows[0].name, named.value);
  assert.equal(drilldown.driver, named.value);
  // Not merely equal today: both read the one exported ranking.
  assert.equal(rankDepartments(IMPORTED)[0].name, named.value);

  // Descending, on the figure the headline ranks by, with the drift-free order
  // stated in the region rather than only in a comment.
  const recoverable = drilldown.rows.map((row) => row.recoverableUsd);
  assert.deepEqual(recoverable, [...recoverable].sort((left, right) => right - left));
});

test("an export with no department dimension names the grouping it fell back to", async () => {
  const { document, drilldown } = await importedPage(IMPORTED, {
    departmentDimension: false, groupingUnit: "project",
  });

  assert.equal(drilldown.grouping.fellBack, true);
  assert.equal(drilldown.grouping.unit, "project");
  const detail = textOf(byId(document, FIRST_RUN_IDS.internalDetail));
  // The grouping AND the reason, in visible text beside the figure rather than
  // behind the disclosure.
  assert.match(detail, /No department field in this export — grouped by project instead\./);
  assert.match(detail, /Departments come from an org roster export, and this import carried none/);
  assert.equal(byId(document, FIRST_RUN_IDS.internalDetail).hidden, false);

  // Still reachable by keyboard in that state: the evidence control is in the
  // tab order and the region it sits in is not hidden.
  assert.equal(byId(document, FIRST_RUN_IDS.region).hidden, false);
  assert.ok(tabSequence(document).includes(byId(document, FIRST_RUN_IDS.methodSummary)),
    "the drill-down's evidence control left the tab order in the fallback state");
});

test("a dialect that named no grouping unit still says what it grouped by", () => {
  const drilldown = importedDrilldown({ analysis: IMPORTED });
  assert.equal(drilldown.grouping.fellBack, true);
  assert.equal(drilldown.grouping.unit, DRILLDOWN_GROUPING.unnamed);
  assert.match(drilldown.grouping.statement,
    /grouped by the grouping column in your export instead/);
});

test("exactly one summary is on screen after an import", async () => {
  const { document } = await importedPage(IMPORTED);
  applyImportedHeadline(document, IMPORTED);

  // The imported headline is the one summary…
  assert.equal(byId(document, "finops-imported-headline").hidden, false);
  // …and the example's competing one is withheld, block by block.
  assert.equal(byId(document, FIRST_RUN_IDS.answer).hidden, true);
  assert.equal(byId(document, FIRST_RUN_IDS.answerDetail).hidden, true);
  const region = byId(document, FIRST_RUN_IDS.region);
  const slots = region.querySelectorAll(".first-run-slot");
  assert.equal(slots.length, 4);
  assert.equal(slots.filter((slot) => slot.hidden).length, 3);
  assert.equal(region.querySelectorAll(".first-run-recommendation")
    .filter((block) => block.hidden).length, 1);
  assert.equal(region.querySelectorAll(".first-run-confidence")
    .filter((block) => block.hidden).length, 1);
  // The one kept slot is the drill-down, and it is the one holding a figure.
  assert.equal(slots.filter((slot) => !slot.hidden)[0]
    .querySelectorAll(`#${FIRST_RUN_IDS.internalValue}`).length, 1);
});

test("the collapsed disclosure still exposes the headline number", async () => {
  const { document, drilldown } = await importedPage(IMPORTED);
  const details = byId(document, FIRST_RUN_IDS.method);
  const summary = byId(document, FIRST_RUN_IDS.methodSummary);

  // Asserted on the attributes, not on text being present: this harness models
  // no layout, so text inside a shut disclosure reads as present either way.
  assert.equal(Boolean(details.open), false);
  assert.equal(details.dataset.disclosure, "collapsed");
  assert.equal(summary.getAttribute("aria-expanded"), "false");

  // The figure is outside it, in the slot's own value.
  const headline = textOf(byId(document, FIRST_RUN_IDS.internalValue));
  assert.equal(headline, drilldown.headline);
  assert.match(headline, /Department …atlas0 carries the most recoverable spend/);
  assert.match(headline, /\$12,400 of \$48,000 \(26%\)/);
  assert.equal(byId(document, FIRST_RUN_IDS.internalValue).dataset.available, "true");
  assert.equal(byId(document, FIRST_RUN_IDS.methodTitle).textContent,
    "How this drill-down was computed and what it cannot tell you");
});

test("an export with nothing recoverable is labelled, not blanked", async () => {
  const empty = envelope([
    { id: "u-1", name: "Department …atlas0", spendUsd: 4_000, recoverableUsd: 0 },
  ]);
  const { document, drilldown } = await importedPage(empty);

  assert.equal(drilldown.available, false);
  assert.equal(drilldown.driver, null);
  assert.equal(drilldown.rows.length, 0);
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.internalValue)), DRILLDOWN_UNAVAILABLE);
  assert.equal(byId(document, FIRST_RUN_IDS.internalValue).dataset.available, "false");
  assert.equal(byId(document, FIRST_RUN_IDS.region).hidden, false);
  // The grouping is still stated, because "nothing to rank" is still a ranking
  // over something.
  assert.equal(byId(document, FIRST_RUN_IDS.methodList).querySelectorAll("dt").length, 1);
});

test("the hand-over is reversible, so the example comes back whole", async () => {
  const { document } = await importedPage(IMPORTED);
  restoreFirstRunExample(document, buildFirstRunResult());
  const region = byId(document, FIRST_RUN_IDS.region);

  assert.equal(region.dataset.source, "example");
  assert.equal(byId(document, FIRST_RUN_IDS.answer).hidden, false);
  assert.equal(region.querySelectorAll(".first-run-slot")
    .filter((slot) => slot.hidden).length, 0);
  assert.equal(byId(document, FIRST_RUN_IDS.internalHeading).textContent, SLOT_LABEL.internal);
  assert.equal(byId(document, FIRST_RUN_IDS.methodTitle).textContent,
    "How this example was calculated and what it cannot tell you");
  // The example's own figures are back in the slot the import took over.
  assert.doesNotMatch(textOf(byId(document, FIRST_RUN_IDS.internalValue)), /your export/);
});
