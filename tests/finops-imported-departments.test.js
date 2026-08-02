// The department drill-down a reader's OWN export earns (#979).
//
// The regression this exists to catch is the one it was written against:
// importing a file retired the first-run region whole, and took the department
// ranking — the part of the example that made it persuasive — off the page at
// the moment it stopped being about invented money. So what is pinned here is
// that the region survives an import, that its rank 1 is the same department
// the headline above it names, that an export with no grouping column says
// which dimension it fell back to and why, and that the collapsed disclosure
// still carries the figure.
//
// Every fixture is built in this file. Nothing here reads a network, and the
// envelopes below are the shape `normalizeLocalFinopsHistory` publishes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, textOf } from "./support/browser.js";
import {
  DRILLDOWN_GROUPING, DRILLDOWN_HEADING, DRILLDOWN_QUESTION,
  importedDepartmentDrilldown, NO_DRILLDOWN,
} from "../src/finops-imported-departments.js";
import { importedHeadline } from "../src/finops-imported-headline.js";
import { applyFirstRunResult, applyFirstRunSupersession } from "../src/finops-first-run-view.js";
import { buildFirstRunResult, FIRST_RUN_IDS } from "../src/finops-first-run.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const byId = (document, id) => document.getElementById(id);

/** A group as the analysis publishes one: a label, a total, and a scenario. */
const group = (name, spendUsd, recoverableUsd) => ({
  name, spendUsd, recoverableUsd,
  unit: { key: `provider-group:${name}`, label: name, source: "provider-group" },
});

/** An envelope with departments in it, and one complete month behind them. */
function imported({ departments = null, periods = null } = {}) {
  return {
    schemaVersion: "local-finops/1.0.0",
    currency: "USD",
    spendUsd: 154500,
    recoverableUsd: 51254,
    action: "Pilot lower-cost routing in Platform.",
    rankedDepartments: departments ?? [
      group("Platform", 60000, 21000),
      group("Research", 90000, 30000),
      group("Support", 4500, 254),
    ],
    history: { periods: periods ?? [
      { period: "2026-05", completeness: "complete", spendUsd: 70000, recoverableUsd: 20000 },
      { period: "2026-06", completeness: "complete", spendUsd: 84500, recoverableUsd: 31254 },
      { period: "2026-07", completeness: "partial", spendUsd: 12000, recoverableUsd: 9000 },
    ] },
  };
}

// --- the ranking -----------------------------------------------------------

test("groups are ranked from the imported rows, largest recoverable amount first", () => {
  const drilldown = importedDepartmentDrilldown(imported());

  assert.equal(drilldown.available, true);
  assert.equal(drilldown.grouping.id, DRILLDOWN_GROUPING.department.id);
  assert.deepEqual(drilldown.rows.map((row) => row.name), ["Research", "Platform", "Support"]);
  assert.deepEqual(drilldown.rows.map((row) => row.rank), [1, 2, 3]);
  // Ranked, not re-summed: each row carries the two figures the envelope
  // published for that group, and the share is of the recoverable total.
  assert.equal(drilldown.rows[0].recoverableUsd, 30000);
  assert.equal(drilldown.rows[0].spendUsd, 90000);
  assert.equal(drilldown.rows[0].share, 59);
  assert.match(drilldown.rows[0].detail, /30,000 USD recoverable of 90,000 USD spent/);
  // Not the biggest spender: Platform outspends nothing here, and the rule is
  // absolute recoverable spend rather than total spend or percentage.
  assert.equal(drilldown.rows[1].name, "Platform");
});

test("rank 1 is the department the imported headline names as the driver", () => {
  const analysis = imported();
  const named = importedHeadline(analysis).slots.find((slot) => slot.id === "top_department");

  assert.equal(named.supported, true);
  assert.equal(importedDepartmentDrilldown(analysis).rows[0].name, named.value,
    "the drill-down's first row disagrees with the department named in the headline");
});

test("a ranking whose order would differ under a different rule still matches the headline", () => {
  // Deliberately adversarial: the largest total spend, the largest percentage,
  // and the largest absolute recoverable amount are three different groups.
  const analysis = imported({ departments: [
    group("Whole", 1000, 1000), group("Huge", 500000, 4000), group("Middle", 40000, 12000),
  ] });
  const named = importedHeadline(analysis).slots.find((slot) => slot.id === "top_department");

  assert.equal(named.value, "Middle");
  assert.equal(importedDepartmentDrilldown(analysis).rows[0].name, "Middle");
});

test("the reserved unattributed bucket is never ranked as a team", () => {
  const unattributed = {
    name: "Unattributed spend", spendUsd: 90000, recoverableUsd: 40000,
    unit: { key: "unattributed", label: "Unattributed spend", source: "unattributed" },
  };
  const drilldown = importedDepartmentDrilldown(
    imported({ departments: [unattributed, group("Platform", 60000, 21000)] }));

  assert.deepEqual(drilldown.rows.map((row) => row.name), ["Platform"]);
});

// --- the fallback ----------------------------------------------------------

test("an export with no department dimension says which grouping it fell back to, and why", () => {
  const drilldown = importedDepartmentDrilldown(imported({ departments: [] }));

  assert.equal(drilldown.available, true);
  assert.equal(drilldown.grouping.id, "billing-month");
  assert.match(drilldown.detail, /no department column in this export/i);
  assert.match(drilldown.detail, /grouped by billing month instead/i);
  // The reason is a sentence a reader can act on, not a bare state word.
  assert.match(drilldown.detail, /none carries a team/);
  // Complete months only: the partial one is not ranked beside them.
  assert.deepEqual(drilldown.rows.map((row) => row.name), ["2026-06", "2026-05"]);
  assert.match(drilldown.headline, /2026-06 is driving it/);
});

test("an envelope with neither dimension states that there is nothing to rank", () => {
  for (const empty of [null, {}, imported({ departments: [], periods: [] })]) {
    const drilldown = importedDepartmentDrilldown(empty);
    assert.equal(drilldown.available, false);
    assert.equal(drilldown.headline, NO_DRILLDOWN);
    assert.deepEqual(drilldown.rows, []);
  }
});

// --- the region ------------------------------------------------------------

async function importedRegion(analysis = imported()) {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  applyFirstRunResult(document, buildFirstRunResult());
  const region = applyFirstRunSupersession(document, true,
    { ownData: importedDepartmentDrilldown(analysis) });
  return { document, region };
}

test("an import keeps the region on the page and repaints it from the reader's own file", async () => {
  const { document, region } = await importedRegion();

  assert.equal(region.hidden, false, "the import hid the region it was supposed to refill");
  assert.equal(region.dataset.superseded, "own-data");
  assert.equal(region.dataset.grouping, "department");
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.question)), DRILLDOWN_QUESTION);
  // Exactly one headline: the figure a reader acts on is the one from their
  // export, and every synthetic figure in this region is withheld beside it.
  assert.match(textOf(byId(document, FIRST_RUN_IDS.answer)), /Research is driving it/);
  for (const id of [FIRST_RUN_IDS.sample, FIRST_RUN_IDS.slots,
    FIRST_RUN_IDS.recommendation, FIRST_RUN_IDS.confidence]) {
    assert.equal(byId(document, id).hidden, true, `#${id} kept an invented figure on screen`);
  }
});

test("the collapsed disclosure exposes the headline number in visible text", async () => {
  const { document } = await importedRegion();
  const details = byId(document, FIRST_RUN_IDS.method);

  // Collapsed, and the figure is outside it: the answer slot is a sibling of
  // the `details`, so nothing a reader has to open holds the number.
  assert.equal(details.hasAttribute("open"), false);
  assert.equal(byId(document, FIRST_RUN_IDS.methodSummary).getAttribute("aria-expanded"), "false");
  const headline = textOf(byId(document, FIRST_RUN_IDS.answer));
  assert.match(headline, /30,000 USD recoverable of 90,000 USD spent/);
  assert.equal(byId(document, FIRST_RUN_IDS.answer).dataset.available, "true");
  assert.doesNotMatch(textOf(details), /is driving it/,
    "the headline sentence is inside the disclosure rather than above it");
});

test("the ranked rows go behind the disclosure the example already uses", async () => {
  const { document } = await importedRegion();
  const list = byId(document, FIRST_RUN_IDS.methodList);

  assert.equal(byId(document, FIRST_RUN_IDS.method).tagName.toLowerCase(), "details");
  assert.deepEqual([...list.querySelectorAll("dt")].map((node) => textOf(node)),
    ["1. Research", "2. Platform", "3. Support"]);
  // The disclosure names what it is holding, in both copies of the evidence.
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.methodTitle)), DRILLDOWN_HEADING);
  assert.match(textOf(byId(document, FIRST_RUN_IDS.methodPrint)), /Every group in your export/);
  // The state chip counts what is behind the control rather than saying "more".
  assert.match(textOf(byId(document, FIRST_RUN_IDS.methodState)), /Show evidence · 3/);
});

test("the fallback state stays keyboard reachable and operable", async () => {
  const { document } = await importedRegion(imported({ departments: [] }));
  const summary = byId(document, FIRST_RUN_IDS.methodSummary);
  const details = byId(document, FIRST_RUN_IDS.method);

  // A native summary, still the accessible name it shows, still toggling both
  // its own `open` and the mirror the region paints beside it.
  assert.equal(summary.tagName.toLowerCase(), "summary");
  assert.equal(summary.hasAttribute("aria-label"), false);
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.match(textOf(byId(document, FIRST_RUN_IDS.answerDetail)),
    /no department column in this export/i);
  summary.focus();
  assert.equal(document.activeElement, summary, "the disclosure is not focusable in this state");
  assert.equal(byId(document, FIRST_RUN_IDS.region).hidden, false);
});

test("the example path retires the region exactly as it did before", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  applyFirstRunResult(document, buildFirstRunResult());

  applyFirstRunSupersession(document, true);

  const region = byId(document, FIRST_RUN_IDS.region);
  assert.equal(region.hidden, true);
  assert.equal(region.dataset.superseded, "true");
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.question)), "Are we wasting money?");
});

test("clearing an import puts the example's own words and figures back", async () => {
  const { document } = await importedRegion();
  const question = textOf(byId(document, FIRST_RUN_IDS.question));

  applyFirstRunSupersession(document, false);

  const region = byId(document, FIRST_RUN_IDS.region);
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.superseded, "false");
  assert.notEqual(question, textOf(byId(document, FIRST_RUN_IDS.question)));
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.question)), "Are we wasting money?");
  assert.match(textOf(byId(document, FIRST_RUN_IDS.sample)), /Bundled synthetic example/);
  assert.equal(byId(document, FIRST_RUN_IDS.slots).hidden, false);
  assert.equal(byId(document, FIRST_RUN_IDS.confidence).hidden, false);
  assert.match(textOf(byId(document, FIRST_RUN_IDS.methodTitle)), /How this example was calculated/);
  assert.match(textOf(byId(document, FIRST_RUN_IDS.methodList)), /Bundled synthetic example|invented/i);
});

test("a hostile group name stays literal text in the ranked rows", async () => {
  const hostile = `<img src=x onerror="globalThis.pwned=true">`;
  const { document } = await importedRegion(imported({
    departments: [group(hostile, 90000, 30000)],
  }));

  assert.match(textOf(byId(document, FIRST_RUN_IDS.answer)), /<img src=x on/);
  assert.match(textOf(byId(document, FIRST_RUN_IDS.methodList)), /<img src=x on/);
  assert.equal(byId(document, FIRST_RUN_IDS.region).querySelectorAll("img").length, 0);
});
