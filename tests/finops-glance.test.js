// The five-second glance (#1345): four declared figures, one lead chosen by
// declared order, and a figure with no data that says so and never leads.
//
// The dataset every case runs on is built here rather than committed: two
// departments and an organization are enough to pin every rule, and a fixture
// file would be a second place for the numbers to drift.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  FINOPS_GLANCE_FIGURES, NOT_YET_MEASURED, applyFinopsGlance, composeFinopsGlance,
  readGlanceFigures, selectGlanceLead,
} from "../src/finops-glance-spec.js";
import { loadPage, parseHtml } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE_URL = new URL("../src/evolution.html", import.meta.url);
const PAGE = fileURLToPath(PAGE_URL);

/**
 * A department the model will accept.
 *
 * `mix` is raw counts, which `normalizeMix` divides by their own sum, so a
 * caller states the shape of the spend rather than four numbers that must
 * already add to one.
 */
function department({ name, spendUsd, priorSpendUsd = null, mix }) {
  return {
    id: name.toLowerCase().replace(/\W+/g, "-"),
    name,
    spendUsd,
    queries: 1000,
    headcount: 10,
    period: "1–31 Jul 2026",
    periodDays: 31,
    ...(priorSpendUsd === null
      ? {}
      : { previousPeriod: { period: "1–30 Jun 2026", spendUsd: priorSpendUsd, score: 70 } }),
    sampling: { status: "available", sampledQueries: 100 },
    mix,
  };
}

/** Half over-provisioned, half high-value: no class reaches the 40% threshold. */
const EVEN_MIX = { highValue: 30, overProvisioned: 30, inefficient: 20, outOfScope: 20 };
/** Three quarters over-provisioned: the spend-mix figure crosses. */
const SKEWED_MIX = { highValue: 10, overProvisioned: 75, inefficient: 10, outOfScope: 5 };

/** Five equal departments, no prior period declared: nothing crosses anything. */
const FLAT = ["A", "B", "C", "D", "E"].map((name) =>
  department({ name, spendUsd: 200, mix: EVEN_MIX }));

const idsOf = (readings) => readings.map((reading) => reading.id);
const readingFor = (readings, id) => readings.find((reading) => reading.id === id);

// ---------------------------------------------------------------------------
// 1. The spec.
// ---------------------------------------------------------------------------

test("the spec declares exactly four figures, each with a question, a unit, a model function and a threshold", () => {
  assert.equal(FINOPS_GLANCE_FIGURES.length, 4);
  assert.deepEqual(FINOPS_GLANCE_FIGURES.map((figure) => figure.id),
    ["spend-mix", "department-rank", "mom-movement", "peer-quartile"],
    "the declared order is what selects the lead, so it is asserted, not assumed");

  for (const figure of FINOPS_GLANCE_FIGURES) {
    assert.match(figure.question, /\?$/, `${figure.id} does not state a question a leader asks`);
    assert.ok(["percent", "quartile"].includes(figure.unit), `${figure.id} declares no unit`);
    assert.equal(typeof figure.source, "string", `${figure.id} names no model function`);
    assert.notEqual(figure.source, "", `${figure.id} names no model function`);
    assert.equal(typeof figure.threshold, "number", `${figure.id} declares no numeric threshold`);
    assert.equal(figure.direction, "at_or_above",
      `${figure.id} does not say which side of its threshold is the call-out`);
    assert.ok(figure.definition.length > 80,
      `${figure.id} is not defined tightly enough for two engineers to compute it the same way`);
  }
});

test("every figure names a function src/evolution.js actually exports", async () => {
  const model = await import("../src/evolution.js");
  for (const figure of FINOPS_GLANCE_FIGURES) {
    assert.equal(typeof model[figure.source], "function",
      `${figure.id} is bound to "${figure.source}", which the model does not export`);
  }
});

// ---------------------------------------------------------------------------
// 2. Lead selection: declared order, never magnitude.
// ---------------------------------------------------------------------------

test("the lead is the first threshold-crossing figure in declared order, not the largest number", () => {
  // department-rank is at 100% — by magnitude it would win every time — but
  // spend-mix crosses too and is declared first, so spend-mix leads.
  const departments = [department({ name: "Only", spendUsd: 1000, priorSpendUsd: 100, mix: SKEWED_MIX })];
  const glance = composeFinopsGlance({ departments, organization: { peerPercentile: 5 } });

  assert.equal(glance.lead.figure.id, "spend-mix");
  assert.equal(glance.lead.crossed, true);
  assert.equal(readingFor(readGlanceFigures({ departments }), "department-rank").value, 100,
    "the runner-up is the bigger number, which is the point of this case");
});

test("a figure below its threshold is skipped, and the next crossing one in declared order leads", () => {
  // spend-mix tops out at 30% (below 40), so the scan moves on. One department
  // holds all the spend, so department-rank is 100% and crosses at 30.
  const departments = [department({ name: "Only", spendUsd: 1000, priorSpendUsd: 1000, mix: EVEN_MIX })];
  const glance = composeFinopsGlance({ departments, organization: { peerPercentile: 90 } });

  assert.equal(glance.lead.figure.id, "department-rank");
  assert.equal(glance.lead.crossed, true);
});

test("when nothing crosses, the lead is the first figure with data and the block says so", () => {
  // Five equal departments at an even mix: 30% class share, 20% department
  // share, spend level month over month, top quartile. Nothing is reached.
  const departments = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map((name) =>
    department({ name, spendUsd: 200, priorSpendUsd: 200, mix: EVEN_MIX }));
  const glance = composeFinopsGlance({ departments, organization: { peerPercentile: 99 } });

  assert.equal(glance.lead.figure.id, "spend-mix");
  assert.equal(glance.lead.crossed, false);
  assert.match(glance.headline, /^No figure crossed its threshold this period\./);
  assert.ok(glance.action, "a lead with no call-out still owes the reader one next step");
});

test("the prioritized action names the concrete object to act on", () => {
  const departments = [
    department({ name: "Zulu", spendUsd: 900, priorSpendUsd: 500, mix: EVEN_MIX }),
    department({ name: "Alpha", spendUsd: 100, priorSpendUsd: 100, mix: EVEN_MIX }),
  ];
  const glance = composeFinopsGlance({ departments, organization: { peerPercentile: 99 } });

  assert.equal(glance.lead.figure.id, "department-rank");
  assert.match(glance.action, /Zulu/, "the action does not name the department to talk to");
  assert.doesNotMatch(glance.action, /investigate/i);
});

test("a tie on department spend is broken by name ascending, so the named department is reproducible", () => {
  const forward = [
    department({ name: "Zulu", spendUsd: 500, priorSpendUsd: 500, mix: EVEN_MIX }),
    department({ name: "Alpha", spendUsd: 500, priorSpendUsd: 500, mix: EVEN_MIX }),
  ];
  const reversed = [...forward].reverse();

  for (const departments of [forward, reversed]) {
    assert.equal(readingFor(readGlanceFigures({ departments }), "department-rank").subject, "Alpha",
      "the tied department named depends on dataset order");
  }
});

// ---------------------------------------------------------------------------
// 3. The no-data rule.
// ---------------------------------------------------------------------------

test("a figure with no data renders \"not yet measured\" and is never the lead", () => {
  // No department declares a prior period, so month-over-month has no
  // denominator; no percentile is declared, so there is no quartile.
  const departments = [department({ name: "Only", spendUsd: 1000, mix: SKEWED_MIX })];
  const readings = readGlanceFigures({ departments, organization: {} });

  for (const id of ["mom-movement", "peer-quartile"]) {
    const reading = readingFor(readings, id);
    assert.equal(reading.available, false);
    assert.equal(reading.value, null, `${id} reported a value it does not have`);
    assert.equal(reading.supporting, NOT_YET_MEASURED,
      `${id} rendered something other than the one sentence an unmeasured figure renders`);
  }

  // Even with the two measured figures forced below their thresholds, the scan
  // reaches neither unmeasured one: it stops at the first figure WITH data.
  const lead = selectGlanceLead(readGlanceFigures({ departments: FLAT, organization: {} }));
  assert.equal(lead.figure.id, "spend-mix");
  assert.equal(lead.crossed, false);
});

test("an unmeasured figure that would otherwise cross its threshold still cannot lead", () => {
  // The bottom quartile crosses (4 >= 3) when it is measured…
  assert.equal(
    composeFinopsGlance({ departments: FLAT, organization: { peerPercentile: 5 } }).lead.figure.id,
    "peer-quartile");
  // …and vanishes from the scan when it is not.
  const withoutPercentile = composeFinopsGlance({ departments: FLAT, organization: {} });
  assert.equal(withoutPercentile.lead.figure.id, "spend-mix");
  assert.equal(withoutPercentile.lead.crossed, false);
});

test("an empty dataset leads with nothing rather than with a zero", () => {
  const glance = composeFinopsGlance({ departments: [], organization: null });
  assert.equal(glance.lead, null);
  assert.deepEqual(idsOf(glance.entries.map((entry) => entry.reading)),
    ["spend-mix", "department-rank", "mom-movement", "peer-quartile"]);
  for (const entry of glance.entries) {
    assert.equal(entry.reading.supporting, NOT_YET_MEASURED);
  }
  assert.doesNotMatch(glance.headline, /0/, "an unmeasured page published a zero");
});

test("month-over-month movement is signed and counts only departments the trend model accepts", () => {
  const departments = [
    department({ name: "Rising", spendUsd: 1100, priorSpendUsd: 1000, mix: EVEN_MIX }),
    // No prior period: departmentTrend refuses it, so it is on neither side.
    department({ name: "New", spendUsd: 9000, mix: EVEN_MIX }),
  ];
  assert.equal(readingFor(readGlanceFigures({ departments }), "mom-movement").value, 10);

  const falling = [department({ name: "Falling", spendUsd: 900, priorSpendUsd: 1000, mix: EVEN_MIX })];
  assert.equal(readingFor(readGlanceFigures({ departments: falling }), "mom-movement").value, -10);
});

// ---------------------------------------------------------------------------
// 4. The block on the page.
// ---------------------------------------------------------------------------

test("the block is a section on the page with a heading and no control of its own", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const region = document.getElementById("finops-glance");

  assert.ok(region, "the glance is declared and tested but is not on the page");
  assert.equal(region.tagName, "SECTION");
  assert.equal(region.getAttribute("aria-labelledby"), "finops-glance-title");
  assert.equal(document.getElementById("finops-glance-title").tagName, "H2",
    "the glance heading does not fit under the page's one h1");
  // No tab stop and no disclosure: this block is read, not operated.
  for (const selector of ["button", "a", "input", "select", "details", "[tabindex]"]) {
    assert.equal(region.querySelectorAll(selector).length, 0,
      `the glance ships a ${selector}, which spends a tab stop or hides a figure`);
  }
});

test("painting the block states the lead, the one action, and the other three figures", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const departments = [department({ name: "Only", spendUsd: 1000, priorSpendUsd: 100, mix: SKEWED_MIX })];
  const glance = applyFinopsGlance(document, { departments, organization: { peerPercentile: 5 } });

  assert.equal(glance.lead.figure.id, "spend-mix");
  assert.equal(document.getElementById("finops-glance").getAttribute("data-glance-lead"), "spend-mix");
  assert.equal(document.getElementById("finops-glance-lead").textContent, glance.headline);
  assert.equal(document.getElementById("finops-glance-action").textContent, glance.action);

  const items = [...document.getElementById("finops-glance-figures").children]
    .filter((node) => node.nodeType === 1);
  assert.equal(items.length, 3, "the supporting one-liners are not the three non-lead figures");
  assert.deepEqual(items.map((item) => item.id),
    ["finops-glance-department-rank", "finops-glance-mom-movement", "finops-glance-peer-quartile"]);
});

test("the real page entry paints the block on a cold open, with nothing imported", async () => {
  const demo = JSON.parse(await readFile(
    fileURLToPath(new URL("../src/evolution-demo-data.json", import.meta.url)), "utf8"));
  const page = await loadPage(PAGE_URL, { storage: {}, routes: { "/evolution-demo-data.json": demo } });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  const region = page.document.getElementById("finops-glance");
  // Named lead, one action, three supporting one-liners — from the page's own
  // entry point, not from a test calling the painter directly.
  assert.equal(region.getAttribute("data-glance-lead"),
    composeFinopsGlance({ departments: demo.departments, organization: demo.organization })
      .lead.figure.id);
  assert.equal([...page.document.getElementById("finops-glance-figures").children]
    .filter((node) => node.nodeType === 1).length, 3);
  assert.ok(page.document.getElementById("finops-glance-action").textContent.trim().length > 20,
    "the block shipped without a prioritized action");
  // The page's own globals are deliberately left standing: this entry point
  // keeps settling panels after the block is painted, and tearing the document
  // out from under it turns that work into an unhandled rejection. The test
  // below owns the document it parses, so nothing here can reach it.
});

test("an unmeasured figure says so on the painted page rather than showing a dash or a zero", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  applyFinopsGlance(document, {
    departments: [department({ name: "Only", spendUsd: 1000, mix: SKEWED_MIX })],
    organization: {},
  });

  const item = document.getElementById("finops-glance-peer-quartile");
  assert.equal(item.getAttribute("data-glance-measured"), "false");
  assert.match(item.textContent, /not yet measured/);
  assert.doesNotMatch(item.textContent, /—/, "an unmeasured figure rendered a dash");
});
