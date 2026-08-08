// Every drawn shape on the glance is the number the sentence beside it states.
//
// WHAT IS UNDER TEST, AND WHY IT IS NOT "THE CHART MATCHES THE FIXTURE". Pinning
// the geometry and separately pinning the prose proves only that both were
// pinned; the two claims never meet, and a scale change that quietly stopped
// drawing the published number would leave both halves green. So the assertion
// here runs the other way: the drawn value is RECOVERED from the SVG attributes
// by inverting the figure's declared scale, and that recovered number is
// compared against the value the sentence was built from. The arithmetic of
// every inversion is written out below, in the test, so a director disputing a
// figure can follow it without reading the renderer.
//
// THE FIXTURES ARE LABELLED. Each entry states what its series represents and
// why the pinned geometry is the correct drawing of it. A pinned string with no
// stated assumption is not reviewable — it only records what the code did on the
// day it was written.
//
// THE CHECK IS PROVEN TO CATCH DIVERGENCE. `compareGlanceDrawing` is the same
// helper the production render path guards on, so §4 feeds it a deliberately
// perturbed model value — one bar figure and one trend figure — and asserts it
// reports the mismatch. The perturbation is a local object; no module state is
// touched and nothing survives the test.
//
// HARNESS. This DOM double models no layout and reflects no property, so every
// assertion below is on an attribute, a count or a text string. Absence is
// asserted as `x === null` compared to `true`, never as `assert.equal(x, null)`,
// which would set this file walking the whole parsed page.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  GLANCE_CHART_SCALES, WIDTH, compareGlanceDrawing,
} from "../src/glance-chart-scales.js";
import { renderGlanceFigureChart } from "../src/glance-figure-charts.js";
import { GLANCE_IDS, composeFinopsGlance } from "../src/finops-glance-spec.js";
import { applyFinopsGlance } from "../src/finops-stand-view.js";
import { loadExampleDataset } from "../src/example-dataset.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const doc = () => parseHtml(html);
const chartDoc = () => parseHtml("<main><p id=\"line\">a sentence</p></main>");

/** Every element under `node`, itself included. Walked: `*` will not parse here. */
function elementsUnder(node, found = []) {
  found.push(node);
  for (const child of node.children ?? []) {
    if (child.nodeType === 1) elementsUnder(child, found);
  }
  return found;
}

const tags = (node, tagName) => elementsUnder(node)
  .filter((element) => element.tagName === tagName.toUpperCase());

/** Every attribute of every element, in document order, as one comparable string. */
const geometryOf = (node) => elementsUnder(node)
  .map((element) => `${element.tagName} ${[...element.attributes.entries()]
    .map(([name, value]) => `${name}=${value}`).join(" ")}`)
  .join("\n");

// ---------------------------------------------------------------------------
// 1. The labelled fixtures.
// ---------------------------------------------------------------------------
//
// `series` is the input the model publishes; `value` is the number the sentence
// prints from the same reading; `geometry` is the rendered output, verbatim.
// `assumption` states what the series is and why that geometry draws it.

const FIXTURES = [
  {
    key: "spendMix",
    name: "spend mix by query class",
    // The four query-class shares of GRADED spend, in declared category order,
    // off `summarize`'s normalised mix — so they sum to 1 and the largest one is
    // the class the sentence names. The track is that graded spend in full; the
    // lit slice is 41.2% of it, drawn 0.412 × 48 − 0.6 = 19.176 wide, the 0.6
    // being the gutter that keeps two dim neighbours apart.
    series: [0.412, 0.311, 0.177, 0.1],
    value: 41.2,
    geometry: [
      "SVG class=glance-chart data-chart=spendMix viewBox=0 0 54 12 width=54 height=12"
        + " aria-hidden=true focusable=false",
      "RECT x=6 y=3 width=48 height=6 fill=currentColor fill-opacity=0.12",
      "RECT x=6 y=3 width=19.176 height=6 fill=currentColor fill-opacity=0.95",
      "RECT x=25.776 y=3 width=14.328 height=6 fill=currentColor fill-opacity=0.28",
      "RECT x=40.704 y=3 width=7.896 height=6 fill=currentColor fill-opacity=0.28",
      "RECT x=49.2 y=3 width=4.2 height=6 fill=currentColor fill-opacity=0.28",
    ].join("\n"),
  },
  {
    key: "departmentRank",
    name: "department rank",
    // Five departments as shares of PERIOD spend, spend descending, off
    // `buildSpendMix`'s published units over its published total. They sum to
    // 0.85 on purpose: the remaining 15% is spend the model attributed to no
    // department, and it shows as undrawn track rather than being redistributed.
    // Rank 1 is 0.318 × 48 = 15.264 wide against a 48-unit track, and only the
    // first RANK_ROWS = 4 rows are drawn.
    series: [0.318, 0.221, 0.164, 0.097, 0.05],
    value: 31.8,
    geometry: [
      "SVG class=glance-chart data-chart=departmentRank viewBox=0 0 54 12 width=54 height=12"
        + " aria-hidden=true focusable=false",
      "RECT x=6 y=0.5 width=48 height=2 fill=currentColor fill-opacity=0.12",
      "RECT x=6 y=0.5 width=15.264 height=2 fill=currentColor fill-opacity=0.95",
      "RECT x=6 y=3.5 width=48 height=2 fill=currentColor fill-opacity=0.12",
      "RECT x=6 y=3.5 width=10.608 height=2 fill=currentColor fill-opacity=0.28",
      "RECT x=6 y=6.5 width=48 height=2 fill=currentColor fill-opacity=0.12",
      "RECT x=6 y=6.5 width=7.872 height=2 fill=currentColor fill-opacity=0.28",
      "RECT x=6 y=9.5 width=48 height=2 fill=currentColor fill-opacity=0.12",
      "RECT x=6 y=9.5 width=4.656 height=2 fill=currentColor fill-opacity=0.28",
    ].join("\n"),
  },
  {
    key: "movement",
    name: "month-over-month movement",
    // The two period totals `periodMovement` published, in time order, in
    // dollars. The axis is anchored at zero with the larger total at the top, so
    // 1350 sits at y = 1.5 and 1200 at 10.5 − (1200/1350) × 9 = 2.5. The heights
    // are therefore the totals up to one common factor, and the ratio between
    // them is the +12.5% the sentence prints. A min/max-normalised axis would
    // have drawn these two points at the same floor and ceiling as a 0.4% rise.
    series: [1200, 1350],
    value: 12.5,
    geometry: [
      "SVG class=glance-chart data-chart=movement viewBox=0 0 54 12 width=54 height=12"
        + " aria-hidden=true focusable=false",
      "POLYLINE points=6,2.5 54,1.5 fill=none stroke=currentColor stroke-width=1.25"
        + " stroke-opacity=0.95 stroke-linecap=round stroke-linejoin=round",
      "CIRCLE cx=54 cy=1.5 r=1.75 fill=currentColor fill-opacity=0.95",
    ].join("\n"),
  },
  {
    key: "peerPosition",
    name: "peer position",
    // The quartiles the published band occupies, one-based. A single-quartile
    // band names one, so exactly one of the four fixed slots is lit and its
    // position — 6 + 3 × 12 + 0.6 = 42.6 — is the quartile. The whole scale is
    // always drawn: a lit slot with no scale behind it is a position against
    // nothing.
    series: [4],
    value: 4,
    geometry: [
      "SVG class=glance-chart data-chart=peerPosition viewBox=0 0 54 12 width=54 height=12"
        + " aria-hidden=true focusable=false",
      "RECT x=6.6 y=3 width=10.8 height=6 fill=currentColor fill-opacity=0.12",
      "RECT x=18.6 y=3 width=10.8 height=6 fill=currentColor fill-opacity=0.12",
      "RECT x=30.6 y=3 width=10.8 height=6 fill=currentColor fill-opacity=0.12",
      "RECT x=42.6 y=3 width=10.8 height=6 fill=currentColor fill-opacity=0.95",
    ].join("\n"),
  },
];

const figureOf = (fixture) => ({
  key: fixture.key, measured: true, series: fixture.series, value: fixture.value,
});

/** The production dispatcher the page calls — not a re-implementation of it. */
const draw = (fixture) => renderGlanceFigureChart(chartDoc(), figureOf(fixture));

test("the fixtures cover all four figures, and each names its scale", () => {
  assert.deepEqual(FIXTURES.map((fixture) => fixture.key), Object.keys(GLANCE_CHART_SCALES));
  for (const fixture of FIXTURES) {
    assert.equal(typeof GLANCE_CHART_SCALES[fixture.key].drawn, "string",
      `${fixture.key} draws on a scale nobody wrote down`);
  }
});

for (const fixture of FIXTURES) {
  test(`the ${fixture.name} figure draws its pinned geometry`, () => {
    const chart = draw(fixture);
    assert.equal(chart === null, false, `${fixture.key} drew nothing for its own fixture`);
    assert.equal(geometryOf(chart), fixture.geometry);
  });
}

// ---------------------------------------------------------------------------
// 2. The correspondence: geometry, inverted, against the number in the prose.
// ---------------------------------------------------------------------------
//
// Each case below recovers the drawn number from the attributes by hand, with
// the arithmetic spelled out, and checks it against the same recovery the
// shipped inversion performs. Doing it twice is deliberate: the hand arithmetic
// is what a disputing reviewer can check, and the equality is what says the
// shipped code does that and not something else.

const attr = (node, name) => Number(node.getAttribute(name));
const litRects = (chart) => tags(chart, "rect")
  .filter((rect) => rect.getAttribute("fill-opacity") === "0.95");

test("spend mix: the lit slice's width, plus its gutter, is the printed share", () => {
  const fixture = FIXTURES[0];
  const chart = draw(fixture);
  const lit = litRects(chart);
  assert.equal(lit.length, 1, "more than one class was drawn as the named one");
  // (19.176 + 0.6) / 48 = 0.412 → 41.2% of graded spend.
  const drawn = (attr(lit[0], "width") + 0.6) / WIDTH;
  assert.equal(Number((drawn * 100).toFixed(1)), fixture.value);
  const check = compareGlanceDrawing(chart, figureOf(fixture));
  assert.equal(check.agrees, true, check.arithmetic);
  assert.ok(Math.abs(check.drawn - drawn) < 1e-12, "the shipped inversion is not this arithmetic");
});

test("department rank: the lit row's width against the track is the printed share", () => {
  const fixture = FIXTURES[1];
  const chart = draw(fixture);
  const lit = litRects(chart);
  assert.equal(lit.length, 1, "more than one row was drawn as rank 1");
  // 15.264 / 48 = 0.318 → 31.8% of period spend. The track is the whole period,
  // so this width is the sentence's percentage and not a ratio against rank 2.
  const drawn = attr(lit[0], "width") / WIDTH;
  assert.equal(Number((drawn * 100).toFixed(1)), fixture.value);
  const check = compareGlanceDrawing(chart, figureOf(fixture));
  assert.equal(check.agrees, true, check.arithmetic);
  assert.ok(Math.abs(check.drawn - drawn) < 1e-12, "the shipped inversion is not this arithmetic");
});

test("movement: the two heights on the zero axis give the printed percentage", () => {
  const fixture = FIXTURES[2];
  const chart = draw(fixture);
  const [first, last] = tags(chart, "polyline")[0].getAttribute("points").split(" ");
  // y = 10.5 − (value / top) × 9, so (10.5 − y) / 9 recovers value / top:
  //   prior  (10.5 − 2.5) / 9 = 0.8889
  //   latest (10.5 − 1.5) / 9 = 1
  // The common `top` cancels in the ratio: (1 / 0.8889 − 1) × 100 = +12.5%.
  const ratio = (point) => (10.5 - Number(point.split(",")[1])) / 9;
  const drawn = (ratio(last) / ratio(first) - 1) * 100;
  assert.equal(Number(drawn.toFixed(1)), fixture.value);
  const check = compareGlanceDrawing(chart, figureOf(fixture));
  assert.equal(check.agrees, true, check.arithmetic);
  assert.ok(Math.abs(check.drawn - drawn) < 1e-9, "the shipped inversion is not this arithmetic");
});

test("peer position: the lit slot's x is the printed quartile", () => {
  const fixture = FIXTURES[3];
  const chart = draw(fixture);
  const lit = litRects(chart);
  assert.equal(lit.length, 1, "more than one quartile was marked for a single-quartile band");
  // x = 6 + (slot − 1) × 12 + 0.6, so (42.6 − 6 − 0.6) / 12 + 1 = quartile 4.
  const drawn = (attr(lit[0], "x") - 6 - 0.6) / (WIDTH / 4) + 1;
  assert.equal(drawn, fixture.value);
  assert.equal(compareGlanceDrawing(chart, figureOf(fixture)).drawn, fixture.value);
});

// ---------------------------------------------------------------------------
// 3. On the shipped page, against the real sentence.
// ---------------------------------------------------------------------------

/** How the recovered number reads in the sentence it sits beside. */
const printed = {
  spendMix: (drawn) => `${(Math.round(drawn * 1000) / 10).toFixed(1)}%`,
  departmentRank: (drawn) => `${(Math.round(drawn * 1000) / 10).toFixed(1)}%`,
  movement: (drawn) => `${(Math.round(Math.abs(drawn) * 10) / 10).toFixed(1)}%`,
  peerPosition: (drawn) => `Quartile ${drawn} of 4`,
};

test("every picture the shipped page draws reads back as the sentence it sits in", () => {
  const document = doc();
  const glance = composeFinopsGlance({ analysis: loadExampleDataset(), reproducibility: null });
  const block = applyFinopsGlance(document, glance);
  const charts = tags(block, "svg");
  assert.ok(charts.length >= 2, "the glance drew almost nothing, so this proves almost nothing");
  for (const chart of charts) {
    const key = chart.getAttribute("data-chart");
    const figure = glance.figures.find((entry) => entry.key === key);
    const check = compareGlanceDrawing(chart, figure);
    assert.equal(check.agrees, true, `${key}: ${check.arithmetic}`);
    // And the recovered number is in the paragraph the shape was appended to —
    // the geometry and the words a lead reads are one reading, not two.
    assert.ok(textOf(chart.parentNode).includes(printed[key](check.drawn)),
      `${key} drew ${check.drawn}, which is not the number in "${textOf(chart.parentNode)}"`);
  }
});

// ---------------------------------------------------------------------------
// 4. Proven to catch divergence.
// ---------------------------------------------------------------------------
//
// The same helper the render path guards on, run against a model value that has
// been moved off the geometry. Both perturbed figures are local objects built
// from a fixture, so nothing here outlives the test.

test("a bar figure whose model value drifts off its geometry is reported", () => {
  const fixture = FIXTURES[1];
  const chart = draw(fixture);
  // The drawn row still says 31.8% of period spend. The model now says 34.0%.
  const drifted = { ...figureOf(fixture), value: 34 };
  const check = compareGlanceDrawing(chart, drifted);
  assert.equal(check.agrees, false, "a 2.2-point drift was accepted as the same number");
  assert.ok(check.arithmetic.includes(">"), check.arithmetic);
  // And the smallest drift the sentence can express — one tenth of a point — is
  // outside the tolerance too, so the check is tight and not merely non-trivial.
  assert.equal(compareGlanceDrawing(chart, { ...figureOf(fixture), value: 31.9 }).agrees, false);
  // The production path draws nothing at all for the drifted figure.
  assert.equal(renderGlanceFigureChart(chartDoc(), drifted) === null, true);
});

test("a trend figure whose series drifts off its printed change is reported", () => {
  const fixture = FIXTURES[2];
  // The series moves and the sentence's +12.5% does not: 1200 → 1500 is +25%.
  const perturbed = { ...figureOf(fixture), series: [1200, 1500] };
  const chart = renderGlanceFigureChart(chartDoc(), { ...perturbed, value: 25 });
  assert.equal(chart === null, false, "the perturbed series draws its own honest picture");
  const check = compareGlanceDrawing(chart, perturbed);
  assert.equal(check.agrees, false, "a rise drawn at 25% was accepted as the printed 12.5%");
  assert.equal(check.stated, 12.5);
  assert.equal(Number(check.drawn.toFixed(1)), 25);
  // A sign flip is caught for the same reason: the geometry carries direction.
  assert.equal(compareGlanceDrawing(chart, { ...perturbed, value: -25 }).agrees, false);
});

// ---------------------------------------------------------------------------
// 5. Determinism.
// ---------------------------------------------------------------------------

test("the same series renders byte-identical coordinates twice", () => {
  for (const fixture of FIXTURES) {
    assert.equal(geometryOf(draw(fixture)), geometryOf(draw(fixture)),
      `${fixture.key} drew two different pictures of one series`);
  }
  // Fixed precision, not luck: a coordinate that fell out of binary floating
  // point would print as 14.400000000000002 and this fixture would say so.
  assert.equal(geometryOf(draw(FIXTURES[0])).includes("000000000"), false);
});

test("nothing on the render path reads a clock or a random number", async () => {
  const modules = ["../src/glance-figure-charts.js", "../src/glance-chart-scales.js"];
  for (const path of modules) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    for (const forbidden of [/\bnew Date\b/, /\bDate\.now\b/, /\bMath\.random\b/,
      /\bperformance\.now\b/, /\bhrtime\b/]) {
      assert.equal(forbidden.test(source), false,
        `${path} reached for ${forbidden} — the same series must draw the same picture forever`);
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Degenerate series: the sentence, and no misleading shape.
// ---------------------------------------------------------------------------

const DEGENERATE = [
  // No series at all: nothing was measured to draw.
  ["an empty series", { key: "spendMix", series: [], value: 40 }],
  // One period is not a trend. There is no prior total to take a ratio against,
  // so a line between one point and itself would draw a change of zero that the
  // data does not support.
  ["a single-point movement", { key: "movement", series: [1200], value: 0 }],
  // Every class holds none of the graded spend: the renderer draws its track and
  // no slice, and a track alone names no class, so no picture is published.
  ["an all-zero mix", { key: "spendMix", series: [0, 0, 0, 0], value: 0 }],
  // A share above 1 is a contract error in the caller. It clamps to full width,
  // which is a different number from the one printed, and so draws nothing.
  ["a row wider than its track", { key: "departmentRank", series: [1.4], value: 140 }],
];

for (const [name, figure] of DEGENERATE) {
  test(`${name} draws no shape at all, and the sentence stands alone`, () => {
    const document = chartDoc();
    const line = document.getElementById("line");
    const chart = renderGlanceFigureChart(document, { measured: true, ...figure });
    assert.equal(chart === null, true, `${name} put a shape on the surface`);
    assert.equal(tags(line, "svg").length, 0);
    assert.equal(tags(line, "rect").length + tags(line, "path").length, 0);
    assert.equal(textOf(line), "a sentence");
  });
}

test("all-equal values are drawn, because flat is what they are", () => {
  // Four classes at exactly a quarter each: the first is named, the picture
  // shows four equal slices, and 25.0% is the truth about it. And two equal
  // period totals sit at the same height on an axis anchored at zero, which
  // reads back as 0.0% — the same number the sentence prints. Neither is the
  // misleading case; the misleading case is a flat line standing in for a
  // reading nobody took, which is what §6's degenerate figures refuse to draw.
  const mix = { key: "spendMix", measured: true, series: [0.25, 0.25, 0.25, 0.25], value: 25 };
  assert.equal(compareGlanceDrawing(renderGlanceFigureChart(chartDoc(), mix), mix).agrees, true);
  const flat = { key: "movement", measured: true, series: [1200, 1200], value: 0 };
  const chart = renderGlanceFigureChart(chartDoc(), flat);
  assert.equal(chart === null, false, "a genuinely flat month drew nothing");
  const check = compareGlanceDrawing(chart, flat);
  assert.equal(check.drawn, 0, check.arithmetic);
});

test("a glance with nothing measured is words only", () => {
  const document = doc();
  const glance = composeFinopsGlance({ analysis: {}, reproducibility: null });
  const block = applyFinopsGlance(document, glance);
  assert.equal(tags(block, "svg").length, 0, "an unmeasured figure was given a picture");
  const supporting = document.getElementById(GLANCE_IDS.supporting);
  assert.equal(supporting.children.length, 4, "the four sentences did not all render");
  assert.ok(textOf(supporting).includes("Not yet measured"));
});
