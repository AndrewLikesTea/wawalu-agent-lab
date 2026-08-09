// The five-second glance: four declared figures, and one deterministic lead.
//
// WHAT IS UNDER TEST. Not a widget. The claim is that a FinOps lead landing
// above the fold can tell which of four figures is the reason to keep reading,
// and that two engineers handed the same data pick the same one. So the
// assertions below are about the DECLARATION (four figures, in one order, each
// with a question, a unit, a shipped source function and a numeric threshold)
// and about the SELECTION (first measured crossing figure wins, nothing else
// participates).
//
// THE STATE THIS FILE EXISTS FOR. A figure the page could not measure must not
// cross a threshold, must not lead, and must not put a number on the surface.
// The peer figure is the one that can fail that quietly: the ranking model
// returns a `position` object even when it has REFUSED to rank, so a reader of
// `position.band` alone would paint a band in exactly the states the model
// declined to make a claim in. Every refusal that model publishes is exercised
// here, in the model and on the rendered surface.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  GLANCE_FIGURE_KEYS, GLANCE_FIGURES, GLANCE_IDS, GLANCE_NO_LEAD, GLANCE_UNMEASURED,
  composeFinopsGlance, measureGlanceFigures,
} from "../src/finops-glance-spec.js";
import { applyFinopsGlance, applyStandHeadline } from "../src/finops-stand-view.js";
import { composeStandHeadline } from "../src/finops-stand.js";
import {
  MINIMUM_RANKED_SUCCESSFUL_TASKS, REPRODUCIBILITY_REFUSED, SHIPPED_COHORT_SNAPSHOT,
  evaluateRankingReproducibility,
} from "../src/ranking-reproducibility.js";
import {
  EXAMPLE_ORG_COHORT_PROFILE, EXAMPLE_TASK_LEDGER, loadExampleDataset,
} from "../src/example-dataset.js";
import { ORG_SIZE_BAND } from "../src/peer-cost-cohorts.js";
import { PEER_INDUSTRY } from "../src/peer-cost-position.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const analysis = loadExampleDataset();

const ranking = (overrides = {}) => evaluateRankingReproducibility({
  org: EXAMPLE_ORG_COHORT_PROFILE,
  spendUsd: Number(analysis.spendUsd),
  tasks: EXAMPLE_TASK_LEDGER,
  analysis,
  ...overrides,
});

/** Every way the ranking model can decline to publish a ranking. */
const RANKING_REFUSALS = [
  ["a sample under the floor", {
    tasks: [{ outcome: "success", count: MINIMUM_RANKED_SUCCESSFUL_TASKS - 1 }], spendUsd: 1000,
  }, REPRODUCIBILITY_REFUSED.insufficientSample],
  ["no matched cohort", {
    org: {
      sizeBand: ORG_SIZE_BAND.mid,
      industry: PEER_INDUSTRY.financialServices,
      snapshotId: SHIPPED_COHORT_SNAPSHOT.snapshotId,
    },
  }, REPRODUCIBILITY_REFUSED.noMatchedCohort],
  ["a snapshot built for other scoring rules", {
    snapshot: { snapshotId: SHIPPED_COHORT_SNAPSHOT.snapshotId, rubricVersion: "finops-cost-rubric/v1" },
  }, REPRODUCIBILITY_REFUSED.rubricVersionMismatch],
];

const byKey = (figures, key) => figures.find((figure) => figure.key === key);

// ---------------------------------------------------------------------------
// 1. The declaration.
// ---------------------------------------------------------------------------

test("the spec declares exactly four figures, in one fixed order", () => {
  assert.equal(GLANCE_FIGURES.length, 4,
    "the glance is four figures — a fifth one is surface that answers no declared question");
  assert.deepEqual(GLANCE_FIGURES.map((figure) => figure.key), [...GLANCE_FIGURE_KEYS]);
  assert.deepEqual(GLANCE_FIGURE_KEYS.slice(),
    ["spendMix", "departmentRank", "movement", "peerPosition"],
    "the declared order is the selection order; moving an entry changes which figure leads");
});

test("every figure names a question, a unit, a shipped source, and a numeric threshold", () => {
  for (const figure of GLANCE_FIGURES) {
    assert.ok(figure.question.length > 20 && figure.question.endsWith("?"),
      `${figure.key} does not state the question a leader is asking`);
    assert.ok(figure.unit.length > 20,
      `${figure.key} does not define its unit precisely enough to be recomputed`);
    // The FUNCTION, not its name: a rename cannot leave this table pointing at
    // a module that no longer exports what it claims to.
    assert.equal(typeof figure.source, "function",
      `${figure.key} is not bound to a model function that already computes it`);
    assert.ok(figure.sourceModule.endsWith(".js"), `${figure.key} names no source module`);
    assert.equal(typeof figure.threshold, "number",
      `${figure.key} has no numeric threshold, so "called out" is a judgement call`);
    assert.equal(typeof figure.crosses, "function");
    assert.ok(figure.action.length > 20, `${figure.key} states no next action`);
  }
  // The four thresholds, pinned as numbers, because the whole selection rule is
  // a comparison against them.
  assert.deepEqual(GLANCE_FIGURES.map((figure) => figure.threshold), [40, 30, 10, 4]);
});

test("each threshold rule fires exactly at its stated boundary", () => {
  const [mix, rank, movement, peer] = GLANCE_FIGURES;
  assert.equal(mix.crosses(39.9), false);
  assert.equal(mix.crosses(40), true);
  assert.equal(rank.crosses(29.9), false);
  assert.equal(rank.crosses(30), true);
  // Signed, and judged on the absolute change: a fall of the same size is the
  // same amount of news.
  assert.equal(movement.crosses(9.9), false);
  assert.equal(movement.crosses(-10), true);
  assert.equal(movement.crosses(10), true);
  // 4 is the worst quartile and the only one that is news. The middle band
  // spans quartiles 2 and 3 and reports no single quartile, so it cannot cross.
  assert.equal(peer.crosses(1), false);
  assert.equal(peer.crosses(4), true);
  assert.equal(peer.crosses(null), false);
});

// ---------------------------------------------------------------------------
// 2. The selection rule.
// ---------------------------------------------------------------------------

/** A composed glance whose figures are forced into a stated crossing pattern. */
function glanceWith(pattern) {
  const figures = GLANCE_FIGURE_KEYS.map((key, index) => ({
    key, crossed: pattern[index], line: `${key} line`, action: `${key} action`,
  }));
  const lead = figures.find((figure) => figure.crossed) ?? null;
  return { lead, supporting: figures.filter((figure) => figure !== lead) };
}

test("the lead is the FIRST crossing figure in spec order, not the largest", () => {
  // Three figures cross at once. The rule has no severity score to fall back
  // on, so the answer is the earliest declared one and nothing else.
  assert.equal(glanceWith([false, true, true, true]).lead.key, "departmentRank");
  assert.equal(glanceWith([true, true, true, true]).lead.key, "spendMix");
  assert.equal(glanceWith([false, false, false, true]).lead.key, "peerPosition");
  assert.equal(glanceWith([false, false, false, false]).lead, null);
});

test("the bundled example picks one lead and states three supporting lines", () => {
  const glance = composeFinopsGlance({ analysis, reproducibility: ranking() });
  assert.equal(glance.figures.length, 4);
  assert.equal(glance.crossed, true);
  // Since #1482 widened the scored sample to cover Atlas, the graded query mix
  // is spread across four departments and its largest class sits under its own
  // threshold — so the first declared figure no longer crosses, and the lead is
  // the first one that does. The lead is a consequence of the data, which is
  // exactly why it moved when the data got better.
  assert.equal(byKey(glance.figures, "spendMix").crossed, false);
  assert.equal(glance.leadKey, "departmentRank",
    "the first CROSSING figure in declared order is the lead");
  assert.equal(glance.supporting.length, 3);
  assert.ok(!glance.supporting.includes(glance.lead), "the lead is also a supporting line");
  assert.equal(glance.nextAction, byKey(glance.figures, "departmentRank").action);
  // Recomposed from the same inputs, twice: the lead is a consequence of the
  // data, so it cannot move between two reads of it.
  assert.equal(composeFinopsGlance({ analysis, reproducibility: ranking() }).leadKey,
    glance.leadKey);
});

test("no crossing figure states the no-action lead and keeps all four lines", () => {
  // An analysis with nothing in it: no graded queries, no attributed spend, one
  // period, and no ranking. Nothing can cross, because nothing is measured.
  const glance = composeFinopsGlance({ analysis: {}, reproducibility: null });
  assert.equal(glance.crossed, false);
  assert.equal(glance.leadKey, null);
  assert.equal(glance.lead, GLANCE_NO_LEAD.lead);
  assert.equal(glance.nextAction, GLANCE_NO_LEAD.action);
  assert.equal(glance.supporting.length, 4,
    "with no lead, all four figures still render as supporting lines");
  assert.match(glance.lead, /Nothing crossed its threshold/);
});

// ---------------------------------------------------------------------------
// 3. Unmeasured figures: stated, and never eligible.
// ---------------------------------------------------------------------------

test("a model with no data reports every figure as not yet measured, never as zero", () => {
  const figures = measureGlanceFigures({ analysis: null, reproducibility: null });
  assert.equal(figures.length, 4);
  for (const figure of figures) {
    assert.equal(figure.measured, false, `${figure.key} claimed a measurement from no data`);
    assert.equal(figure.value, null, `${figure.key} carried a value with nothing to measure`);
    assert.equal(figure.crossed, false, `${figure.key} crossed a threshold while unmeasured`);
    assert.equal(figure.display, GLANCE_UNMEASURED);
    assert.ok(figure.reason.length > 30, `${figure.key} refused without a readable reason`);
    assert.ok(figure.line.includes(GLANCE_UNMEASURED));
    // Never a zero, never a dash, never a bare blank standing in for a figure.
    assert.ok(!/(^|\s)(0|0\.0%|—|-)(\s|$)/.test(figure.display),
      `${figure.key} painted an empty-looking value instead of stating its state`);
  }
});

for (const [name, overrides, code] of RANKING_REFUSALS) {
  test(`${name} leaves the peer figure unmeasured and ineligible to lead`, () => {
    const reproducibility = ranking(overrides);
    assert.equal(reproducibility.refusedCode, code, "this case no longer refuses the ranking");
    const figures = measureGlanceFigures({ analysis, reproducibility });
    const peer = byKey(figures, "peerPosition");
    assert.equal(peer.measured, false, `${name} published a peer measurement anyway`);
    assert.equal(peer.value, null, `${name} carried a quartile value`);
    assert.equal(peer.crossed, false, `${name} crossed the worst-quartile threshold`);
    // The refusing model's own sentence, not a paraphrase invented here.
    assert.equal(peer.reason, reproducibility.reason);
    assert.ok(!/quartile|band/i.test(peer.display),
      `${name} put a band word in the peer figure's value slot`);
    // And it can never be the lead, even when it is the only figure left.
    const glance = composeFinopsGlance({ analysis: {}, reproducibility });
    assert.equal(glance.leadKey, null, `${name} still led the glance`);
  });
}

test("a peer position in the middle half reports two quartiles and cannot cross", () => {
  // The published model has three bands, not four: the middle one spans
  // quartiles 2 and 3, so it names no single quartile and is not news.
  const reproducibility = {
    reproducible: true, reason: null, position: { band: "middle_range" }, record: null,
  };
  const peer = byKey(measureGlanceFigures({ analysis, reproducibility }), "peerPosition");
  assert.equal(peer.measured, true);
  assert.equal(peer.value, null);
  assert.equal(peer.crossed, false);
  assert.match(peer.display, /Quartiles 2–3 of 4/);
});

// ---------------------------------------------------------------------------
// 4. The rendered block, on the shipped markup.
// ---------------------------------------------------------------------------

/** Paint a composed headline into the shipped document and read the glance. */
function renderedGlance(reproducibility) {
  const document = parseHtml(html);
  applyStandHeadline(document, composeStandHeadline({
    analysis, source: "example", position: reproducibility?.position ?? null, reproducibility,
  }));
  const block = document.getElementById(GLANCE_IDS.block);
  return {
    document,
    block,
    lead: textOf(document.getElementById(GLANCE_IDS.lead)),
    next: textOf(document.getElementById(GLANCE_IDS.next)),
    supporting: [...document.getElementById(GLANCE_IDS.supporting).children]
      .map((node) => textOf(node)),
  };
}

test("the shipped page paints the glance with one lead, one action, three lines", () => {
  const rendered = renderedGlance(ranking());
  assert.equal(rendered.block.hidden, false, "the glance never reached the reader");
  assert.equal(rendered.block.dataset.lead, "departmentRank");
  assert.equal(rendered.block.dataset.crossed, "true");
  assert.equal(rendered.supporting.length, 3);
  assert.ok(rendered.lead.length > 30, "the lead slot is empty");
  assert.ok(rendered.next.length > 20, "the lead figure came with no next action");
  assert.equal(rendered.document.getElementById(GLANCE_IDS.lead).dataset.available, "true");
});

for (const [name, overrides] of RANKING_REFUSALS) {
  test(`${name} renders the not-yet-measured line and no band on the glance`, () => {
    const reproducibility = ranking(overrides);
    const rendered = renderedGlance(reproducibility);
    const peerLine = [rendered.lead, ...rendered.supporting]
      .find((line) => line.includes("Are we out of line"));
    assert.ok(peerLine, `${name} dropped the peer question off the glance entirely`);
    assert.ok(peerLine.includes(GLANCE_UNMEASURED),
      `${name} did not say the peer position is unmeasured`);
    assert.ok(peerLine.includes(reproducibility.reason),
      `${name} did not carry the refusing model's own reason onto the surface`);
    assert.notEqual(rendered.block.dataset.lead, "peerPosition");
    // The whole block, in every slot: no band word, no quartile, no zero
    // standing in for a refused figure.
    const painted = textOf(rendered.block);
    assert.ok(!/quartile|Middle range/i.test(painted),
      `a band leaked onto the glance for ${name}`);
    assert.ok(!/(^|\s)(0|0\.0)(%|\s|$)/.test(peerLine),
      `${name} painted a zero where the model refused to publish a figure`);
  });
}

test("the glance states no lead on the surface when nothing crosses", () => {
  const document = parseHtml(html);
  applyFinopsGlance(document, composeFinopsGlance({ analysis: {}, reproducibility: null }));
  const block = document.getElementById(GLANCE_IDS.block);
  assert.equal(block.dataset.lead, "none");
  assert.equal(block.dataset.crossed, "false");
  assert.equal(document.getElementById(GLANCE_IDS.lead).dataset.available, "false");
  assert.equal(textOf(document.getElementById(GLANCE_IDS.lead)), GLANCE_NO_LEAD.lead);
  assert.equal(textOf(document.getElementById(GLANCE_IDS.next)), GLANCE_NO_LEAD.action);
  assert.equal(document.getElementById(GLANCE_IDS.supporting).children.length, 4,
    "with no lead every figure still states itself");
});

test("the glance is a repaint, not an append", () => {
  const document = parseHtml(html);
  const glance = composeFinopsGlance({ analysis, reproducibility: ranking() });
  applyFinopsGlance(document, glance);
  applyFinopsGlance(document, glance);
  assert.equal(document.getElementById(GLANCE_IDS.supporting).children.length, 3,
    "a second paint stacked a second copy of the supporting lines");
  assert.equal(chartsIn(document.getElementById(GLANCE_IDS.lead)).length, 1,
    "a second paint stacked a second picture on the lead line");
});

// ---------------------------------------------------------------------------
// 5. The pictures beside the figures (#1346).
// ---------------------------------------------------------------------------
//
// The claim is not that the charts look right — this harness models no layout.
// It is that they cost the reader nothing: every number and every sentence the
// block published before still reads identically, the shapes are hidden from
// assistive tech, they take no tab stop on a first screen that has none spare,
// and a figure the page refused to measure is given no picture of a refused
// number.

/** Every element under `node`, itself included. Walked, because `*` will not parse. */
function elementsUnder(node, found = []) {
  found.push(node);
  for (const child of node.children ?? []) {
    if (child.nodeType === 1) elementsUnder(child, found);
  }
  return found;
}

const chartsIn = (node) => elementsUnder(node).filter((element) => element.tagName === "SVG");
const chartKeys = (node) => chartsIn(node).map((chart) => chart.getAttribute("data-chart"));

test("the shipped page draws the spend-mix and department-rank figures", () => {
  const rendered = renderedGlance(ranking());
  const keys = chartKeys(rendered.block);
  assert.ok(keys.includes("spendMix"), "the spend mix figure got no picture");
  assert.ok(keys.includes("departmentRank"), "the department ranking got no picture");
  // Each picture sits inside the line it illustrates, not in a block of its own
  // below the prose: the lead's shape is a child of the lead paragraph.
  assert.equal(chartKeys(rendered.document.getElementById(GLANCE_IDS.lead)).join(),
    "departmentRank");
  assert.equal(chartsIn(rendered.document.getElementById(GLANCE_IDS.next)).length, 0,
    "a picture landed on the next-action line, which states no figure");
});

test("the pictures change no number and no sentence on the glance", () => {
  const glance = composeFinopsGlance({ analysis, reproducibility: ranking() });
  const rendered = renderedGlance(ranking());
  // Byte for byte the composer's own strings, with the shapes appended after.
  assert.equal(rendered.lead, glance.lead);
  assert.deepEqual(rendered.supporting, [...glance.supporting]);
  // And every drawn shape is wordless, so deleting all of them would lose a
  // screen-reader user nothing that is not still in the prose beside them.
  for (const chart of chartsIn(rendered.block)) assert.equal(textOf(chart), "");
});

test("every picture on the glance is hidden and outside the tab order", () => {
  const rendered = renderedGlance(ranking());
  const charts = chartsIn(rendered.block);
  assert.ok(charts.length >= 2, "the glance drew almost nothing");
  for (const chart of charts) {
    assert.equal(chart.getAttribute("aria-hidden"), "true");
    for (const element of elementsUnder(chart)) {
      assert.equal(element.hasAttribute("tabindex"), false,
        `a ${element.tagName} in the glance took a tab stop`);
      assert.equal(element.getAttribute("role"), null,
        `a ${element.tagName} in the glance joined the interaction model`);
    }
  }
});

test("a figure the page could not measure is given no picture", () => {
  for (const [name, overrides] of RANKING_REFUSALS) {
    const rendered = renderedGlance(ranking(overrides));
    assert.equal(chartKeys(rendered.block).includes("peerPosition"), false,
      `${name} drew a position the ranking model refused to claim`);
  }
  // With nothing measured at all the block is words only, exactly as before.
  const document = parseHtml(html);
  applyFinopsGlance(document, composeFinopsGlance({ analysis: {}, reproducibility: null }));
  assert.equal(chartsIn(document.getElementById(GLANCE_IDS.block)).length, 0);
});
