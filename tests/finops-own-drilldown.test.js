// The own-data drill-down: the first-run region repopulated from an import.
//
// What is pinned here is the product rule, not an object shape:
//
//   1. An import REPOPULATES this region instead of retiring it, and exactly
//      one headline paints — the example's or the reader's, never both.
//   2. The rank-1 row and the group the headline names are the same group,
//      because they come off one sorted array rather than two searches.
//   3. An export with no department dimension falls back deterministically and
//      SAYS SO, in visible text, naming both the grouping it used and the field
//      it did not find — with the disclosure still a real focusable control.
//   4. The headline figure lives outside the collapsible content, so it is
//      readable while the drill-down is shut.
//
// Envelopes are built in-test in the shape `normalizeLocalFinopsHistory`
// publishes, the way tests/finops-imported-headline.test.js does it, plus one
// pass over a real envelope from the real translator so the ranking is proved
// against data nobody wrote for this test.
//
// Assertions are on counts, attributes, and text. This harness reads text
// through a closed details element and models no layout, so "the number is
// still visible when collapsed" is held on WHERE the node is in the markup —
// asserted as a count of headline nodes inside the disclosure — rather than on
// text that would read through it either way.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, tabSequence } from "./support/browser.js";
import { normalizeLocalFinopsHistory } from "../src/local-finops.js";
import { loadExampleDatasetInputs } from "../src/example-dataset.js";
import { FIRST_RUN_IDS } from "../src/finops-first-run.js";
import { applyFirstRunResult, bindFirstRunDisclosure } from "../src/finops-first-run-view.js";
import { buildFirstRunResult } from "../src/finops-first-run.js";
import { GROUPING_PRECEDENCE, ownDataDrilldown } from "../src/finops-own-drilldown.js";
import {
  applyOwnDataDrilldown, clearOwnDataDrilldown,
} from "../src/finops-own-drilldown-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const pageEntry = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");

const byId = (document, id) => document.getElementById(id);

/** A grouped import: departments with spend, deliberately not in spend order. */
const groupedImport = {
  period: "2026-01-01 to 2026-02-01",
  spendUsd: 240_000,
  recoverableUsd: 36_000,
  // The analysis publishes this list ranked by RECOVERABLE amount, so Support
  // arrives ahead of Platform even though Platform bills more. The drill-down
  // has to re-sort it or the headline names the wrong team.
  rankedDepartments: [
    { id: "unit-b", name: "Support", spendUsd: 60_000, recoverableUsd: 21_000 },
    { id: "unit-a", name: "Platform", spendUsd: 140_000, recoverableUsd: 9_000 },
    { id: "unit-c", name: "Research", spendUsd: 40_000, recoverableUsd: 2_000 },
  ],
  history: {
    state: "available",
    periods: [{ period: "2026-01", spendUsd: 240_000, completeness: "complete" }],
  },
};

/** No department dimension at all, but two billing months that carry spend. */
const ungroupedImport = {
  period: "2025-12-01 to 2026-02-01",
  spendUsd: 450_000,
  rankedDepartments: [],
  history: {
    state: "available",
    periods: [
      { period: "2025-12", spendUsd: 210_000, completeness: "complete" },
      { period: "2026-01", spendUsd: 240_000, completeness: "complete" },
    ],
  },
};

/** A page in the state a reader meets after the example paint, before import. */
function pageAfterBoot() {
  const document = parseHtml(html);
  applyFirstRunResult(document, buildFirstRunResult());
  bindFirstRunDisclosure(document);
  return document;
}

// --- 1. one headline --------------------------------------------------------

test("after an import exactly one headline renders in the FinOps region", () => {
  const document = pageAfterBoot();
  const region = byId(document, FIRST_RUN_IDS.region);
  assert.equal(region.querySelectorAll("[data-finops-headline]")
    .filter((node) => !node.hidden).length, 1, "the example state carries one headline");

  applyOwnDataDrilldown(document, groupedImport);
  const shown = region.querySelectorAll("[data-finops-headline]").filter((node) => !node.hidden);
  assert.equal(shown.length, 1, "an import must not leave two competing summaries on screen");
  assert.equal(shown[0].dataset.finopsHeadline, "own-data");
  assert.equal(shown[0].id, FIRST_RUN_IDS.ownAnswer);
  // The region survives the import rather than retiring under it.
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.superseded, "false");
  assert.equal(region.dataset.source, "own-data");
  // And nothing composed from the bundled example is left standing beside it.
  assert.equal(byId(document, FIRST_RUN_IDS.answer).hidden, true);
  assert.equal(byId(document, FIRST_RUN_IDS.sample).hidden, true);
  assert.equal(region.querySelectorAll(".first-run-slots")
    .filter((node) => !node.hidden).length, 0);
});

test("clearing the import gives the region back to the example, headline and all", () => {
  const document = pageAfterBoot();
  applyOwnDataDrilldown(document, groupedImport);
  clearOwnDataDrilldown(document);
  const region = byId(document, FIRST_RUN_IDS.region);
  const shown = region.querySelectorAll("[data-finops-headline]").filter((node) => !node.hidden);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].dataset.finopsHeadline, "example");
  assert.equal(byId(document, FIRST_RUN_IDS.sample).hidden, false);
  assert.equal(byId(document, FIRST_RUN_IDS.ownRows).querySelectorAll("tr").length, 0,
    "a row for a file that is no longer loaded must not survive the clear");
});

// --- 2. the drill-down ------------------------------------------------------

test("the drill-down ranks by spend and row 1 is the group the headline names", () => {
  const document = pageAfterBoot();
  const model = applyOwnDataDrilldown(document, groupedImport);
  const rows = byId(document, FIRST_RUN_IDS.ownRows).querySelectorAll("tr");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.dataset.group), ["Platform", "Support", "Research"],
    "the rows are ordered by total spend, descending — not by recoverable amount");
  assert.deepEqual(rows.map((row) => row.dataset.rank), ["1", "2", "3"]);

  const headline = byId(document, FIRST_RUN_IDS.ownAnswer).textContent;
  assert.ok(headline.includes("Platform"), "the headline names the rank-1 group");
  assert.ok(headline.includes("140,000 USD"), "the headline carries its own figure");
  assert.equal(model.driver, model.rows[0],
    "the driver must BE row 1, not a second search that can disagree with it");
  assert.equal(model.headline.driverName, rows[0].dataset.group);
  // The share is of the ranked total, so it is a percentage a reader can check
  // against the rows underneath it.
  assert.equal(model.rows[0].sharePercent, 58);
});

test("a real translated export ranks by spend through the same one computation", () => {
  const analysis = normalizeLocalFinopsHistory(loadExampleDatasetInputs());
  const model = ownDataDrilldown(analysis);
  assert.equal(model.available, true);
  assert.equal(model.grouping.id, "department");
  assert.equal(model.grouping.fallback, false);
  const spend = model.rows.map((row) => row.spendUsd);
  assert.deepEqual(spend, [...spend].sort((left, right) => right - left),
    "the rendered order must be descending spend for a real envelope too");
  assert.equal(model.driver.name, model.headline.driverName);
  assert.equal(model.driver.rank, 1);
});

// --- 3. the fallback grouping ----------------------------------------------

test("an export with no department dimension names its fallback and the reason", () => {
  const document = pageAfterBoot();
  const model = applyOwnDataDrilldown(document, ungroupedImport);
  assert.equal(model.grouping.id, "billing-month");
  assert.equal(model.grouping.fallback, true);
  const grouping = byId(document, FIRST_RUN_IDS.ownGrouping);
  assert.equal(grouping.dataset.fallback, "true");
  assert.ok(grouping.textContent.includes("Grouped by billing month"),
    "the region must say which grouping it fell back to");
  assert.ok(grouping.textContent.includes("no department field"),
    "and why the grouping above it was not available");
  // The fallback is deterministic: the precedence order is declared, not
  // guessed, and billing month is the entry below department in it.
  assert.deepEqual(GROUPING_PRECEDENCE.map((entry) => entry.id),
    ["department", "billing-month"]);
  const rows = byId(document, FIRST_RUN_IDS.ownRows).querySelectorAll("tr");
  assert.deepEqual(rows.map((row) => row.dataset.group), ["2026-01", "2025-12"]);
});

test("the fallback region's disclosure is a real focusable control in tab order", () => {
  const document = pageAfterBoot();
  applyOwnDataDrilldown(document, ungroupedImport);
  const summary = byId(document, FIRST_RUN_IDS.methodSummary);
  assert.equal(summary.tagName, "SUMMARY", "the control is a summary, not a div");
  assert.equal(tabSequence(document).includes(summary), true,
    "a reader must be able to reach the fallback drill-down by keyboard");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  const details = byId(document, FIRST_RUN_IDS.method);
  details.open = true;
  details.dispatchEvent({ type: "toggle" });
  assert.equal(summary.getAttribute("aria-expanded"), "true",
    "the expanded state has to follow the element's own open state");
  assert.equal(byId(document, FIRST_RUN_IDS.methodState).dataset.disclosure, "expanded");
});

test("an import with no rankable dimension at all is refused rather than faked", () => {
  const model = ownDataDrilldown({ rankedDepartments: [], history: { periods: [] } });
  assert.equal(model.available, false);
  assert.equal(model.rows.length, 0);
  assert.equal(model.driver, null);
  assert.equal(ownDataDrilldown(null).available, false);
});

// --- 4. the collapsed state -------------------------------------------------

test("the headline figure sits outside the collapsible content", () => {
  const document = pageAfterBoot();
  applyOwnDataDrilldown(document, groupedImport);
  const details = byId(document, FIRST_RUN_IDS.method);
  // Collapsed is the state the region ships in, and the figure is still in the
  // document with no ancestor that can hide it: the headline node is not inside
  // the details element at all. This is a COUNT because this harness reads text
  // through a closed disclosure — the location of the node is the only thing
  // here that is evidence about a real browser.
  assert.equal(details.hasAttribute("open"), false);
  assert.equal(details.querySelectorAll("[data-finops-headline]").length, 0,
    "a headline number inside a shut disclosure is not a headline");
  const answer = byId(document, FIRST_RUN_IDS.ownAnswer);
  assert.equal(answer.hidden, false);
  assert.ok(/140,000 USD/.test(answer.textContent));
  // And the drill-down that IS behind the control says how much is behind it.
  assert.ok(byId(document, FIRST_RUN_IDS.methodState).textContent.includes("3"));
  assert.equal(byId(document, FIRST_RUN_IDS.methodList).hidden, true,
    "the example's evidence list and the own-data table are never both shown");
});

// --- 5. the wiring ----------------------------------------------------------

test("the shipped page entry repopulates this region instead of retiring it", () => {
  assert.match(pageEntry, /from "\/finops-own-drilldown-view\.js"/);
  assert.match(pageEntry, /applyOwnDataDrilldown\(document, result\)/);
  assert.match(pageEntry,
    /applyFirstRunSupersession\(document, Boolean\(result\) && !ownDrilldown\?\.available,/,
    "an own-data import must no longer reach the supersession path");
});

test("the view assigns no markup", async () => {
  const source = await readFile(new URL("../src/finops-own-drilldown-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});
