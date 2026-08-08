// The glance's four pictures: what they draw, and what they refuse to draw.
//
// WHAT IS UNDER TEST. Not that a chart looks right — this harness models no
// layout and cannot tell you that. Two things it CAN prove are the two that
// matter here:
//
//   1. THE PICTURES ARE FREE. Every root is aria-hidden, carries no text, takes
//      no tab stop and contains no control, so the prose beside them is still
//      the whole accessible answer. The FinOps first screen has no spare tab
//      stop, so a focusable node here would break a different file.
//   2. NO SERIES PRODUCES A BROKEN ATTRIBUTE. Zero points, one point, many
//      points, all zeros and a fall all reach a coordinate, and none of them may
//      write NaN, a negative width or a negative height into the document.
//
// Every assertion about absence is written against a count or a boolean, never
// `assert.equal(node, null)`: this harness's elements are deep enough that the
// diff assert builds for a failing identity check does not finish.

import test from "node:test";
import assert from "node:assert/strict";

import { parseHtml, textOf } from "./support/browser.js";
import {
  GLANCE_CHART_FALLBACK, PEER_SLOTS, RANK_ROWS, glanceChartFallback,
  renderGlanceFigureChart, renderMovementChart,
  renderPositionChart, renderRankChart, renderSpendMixChart,
} from "../src/glance-figure-charts.js";

const doc = () => parseHtml("<main><p id=\"line\">Spend mix by query class · 41.2%.</p></main>");

/** Every element under `node`, itself included. Text nodes are not elements. */
function elements(node, found = []) {
  found.push(node);
  for (const child of node.children ?? []) {
    if (child.nodeType === 1) elements(child, found);
  }
  return found;
}

const attributePairs = (node) => elements(node)
  .flatMap((element) => [...element.attributes.entries()]);

const shapes = (node, tagName) => elements(node)
  .filter((element) => element.tagName === tagName.toUpperCase());

/** The renderers, each with a series that draws something. */
const RENDERERS = [
  ["spend mix", renderSpendMixChart, [4, 1, 3, 2]],
  ["department rank", renderRankChart, [900, 400, 100]],
  ["movement", renderMovementChart, [1200, 1500]],
  ["peer position", renderPositionChart, [4]],
];

/** Series that must never draw anything at all. */
const EMPTY_SERIES = [["an empty array", []], ["a non-array", null], ["all NaN", [NaN, "x"]]];

// ---------------------------------------------------------------------------
// 1. The decorative contract, on every renderer.
// ---------------------------------------------------------------------------

for (const [name, render, series] of RENDERERS) {
  test(`the ${name} picture is hidden from assistive tech and holds no words`, () => {
    const chart = render(doc(), series);
    assert.equal(chart.tagName, "SVG");
    assert.equal(chart.getAttribute("aria-hidden"), "true");
    assert.equal(textOf(chart), "", `the ${name} picture put text on the surface`);
  });

  test(`the ${name} picture takes no tab stop and holds no control`, () => {
    const chart = render(doc(), series);
    for (const element of elements(chart)) {
      assert.equal(element.hasAttribute("tabindex"), false,
        `the ${name} picture made ${element.tagName} focusable`);
      assert.equal(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(element.tagName), false,
        `the ${name} picture put a ${element.tagName} inside a chart`);
      // A role of "button" or "link" is the other way an SVG node joins the
      // interaction model, and the trend chart on the history page does exactly
      // that. This one may not.
      assert.equal(element.getAttribute("role"), null,
        `the ${name} picture gave ${element.tagName} a role`);
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Degenerate series.
// ---------------------------------------------------------------------------

for (const [name, render] of RENDERERS) {
  for (const [seriesName, series] of EMPTY_SERIES) {
    test(`${name} draws nothing for ${seriesName}, and the caller keeps its text`, () => {
      const document = doc();
      const line = document.getElementById("line");
      const before = textOf(line);
      const chart = render(document, series);
      // Not assert.equal(chart, null): a returned element would hang the diff.
      assert.equal(chart === null, true, `${name} returned a shape for ${seriesName}`);
      // The DOM gains no empty shell, and the sentence is untouched.
      assert.equal(line.children.length, 1);
      assert.equal(textOf(line), before);
    });
  }
}

test("a single quantitative point uses the documented prose fallback", () => {
  for (const [key, render] of [
    ["spendMix", renderSpendMixChart], ["departmentRank", renderRankChart],
    ["movement", renderMovementChart],
  ]) {
    assert.equal(render(doc(), [7]) === null, true, `${key} implied a comparison from one point`);
    assert.equal(glanceChartFallback({ key, measured: true, series: [7] }), GLANCE_CHART_FALLBACK);
  }
  // Peer position is a categorical occupied slot, not a quantitative series.
  assert.equal(shapes(renderPositionChart(doc(), [4]), "rect").length, PEER_SLOTS);
});

test("a ranked list stays inside its box however many departments arrive", () => {
  const many = Array.from({ length: 40 }, (_, index) => 40 - index);
  const chart = renderRankChart(doc(), many);
  // One track and one bar per drawn row, and no more rows than the box holds.
  assert.equal(shapes(chart, "rect").length, RANK_ROWS * 2);
  assert.equal(shapes(renderRankChart(doc(), [5, 4]), "rect").length, 4);
});

test("many points draw one segment each without leaving the spend-mix bar", () => {
  const many = Array.from({ length: 25 }, (_, index) => index + 1);
  const chart = renderSpendMixChart(doc(), many);
  // The track, plus one slice per class.
  assert.equal(shapes(chart, "rect").length, many.length + 1);
  const right = shapes(chart, "rect")
    .map((rect) => Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")));
  const box = Number(chart.getAttribute("width"));
  for (const edge of right) assert.ok(edge <= box + 0.001, `a slice ran to ${edge} past ${box}`);
});

test("all-equal quantitative series use prose instead of a misleading flat chart", () => {
  for (const [key, render] of [
    ["spendMix", renderSpendMixChart], ["departmentRank", renderRankChart],
    ["movement", renderMovementChart],
  ]) {
    assert.equal(render(doc(), [7, 7, 7]) === null, true, `${key} drew an all-equal series`);
    assert.equal(glanceChartFallback({ key, measured: true, series: [7, 7, 7] }),
      GLANCE_CHART_FALLBACK);
  }
});

test("no series writes NaN or a negative length into an attribute", () => {
  const series = [
    [], [0], [0, 0], [-5, 12], [1e12, 1], [0.0001, 0.0002], [3], [2, 3], [1, 2, 3, 4, 5, 6, 7],
  ];
  for (const [name, render] of RENDERERS) {
    for (const values of series) {
      const chart = render(doc(), values);
      if (chart === null) continue;
      for (const [attribute, value] of attributePairs(chart)) {
        assert.equal(/NaN|Infinity|undefined/.test(value), false,
          `${name} wrote ${attribute}="${value}" for [${values}]`);
        if (attribute === "width" || attribute === "height" || attribute === "r") {
          assert.ok(Number(value) >= 0, `${name} wrote a negative ${attribute} for [${values}]`);
        }
      }
    }
  }
});

test("a month-over-month fall draws as a fall, and a rise as a rise", () => {
  // SVG y grows downward, so the later point of a falling series sits LOWER on
  // the page and therefore at a LARGER y. Nothing encodes the sign as a length.
  const ends = (values) => {
    const chart = renderMovementChart(doc(), values);
    const [first, last] = shapes(chart, "polyline")[0].getAttribute("points").split(" ");
    return { from: Number(first.split(",")[1]), to: Number(last.split(",")[1]) };
  };
  const fall = ends([1500, 1200]);
  assert.ok(fall.to > fall.from, "a fall did not draw downward");
  const rise = ends([1200, 1500]);
  assert.ok(rise.to < rise.from, "a rise did not draw upward");
  // The marked latest point sits on the end of the line either way.
  const chart = renderMovementChart(doc(), [1500, 1200]);
  assert.equal(Number(shapes(chart, "circle")[0].getAttribute("cy")), fall.to);
});

test("the peer scale is always whole, with only the occupied quartiles filled", () => {
  const filled = (occupied) => shapes(renderPositionChart(doc(), occupied), "rect")
    .map((rect) => rect.getAttribute("fill-opacity"));
  const worst = filled([4]);
  assert.equal(worst.length, PEER_SLOTS, "the scale lost a quartile");
  assert.equal(new Set(worst).size, 2, "the marked quartile is not told apart from the rest");
  assert.equal(worst[3], worst.find((opacity) => worst.filter((o) => o === opacity).length === 1));
  // The middle band spans two quartiles and names neither, so it marks both.
  const middle = filled([2, 3]);
  assert.equal(middle[1], middle[2]);
  assert.notEqual(middle[0], middle[1]);
  // And an unmarked scale is a claim about nothing, so it is not drawn.
  assert.equal(renderPositionChart(doc(), [], PEER_SLOTS) === null, true);
});

// ---------------------------------------------------------------------------
// 3. The dispatch a page uses.
// ---------------------------------------------------------------------------

test("a measured figure gets the picture its key names", () => {
  const figure = (key, series) => ({ key, measured: true, series });
  for (const [key, expected] of [["spendMix", 5], ["departmentRank", 8], ["peerPosition", 4]]) {
    const chart = renderGlanceFigureChart(doc(), figure(key, [4, 3, 2, 1]));
    assert.equal(chart.getAttribute("data-chart"), key);
    assert.equal(shapes(chart, "rect").length, expected, `${key} drew the wrong shape`);
  }
  assert.equal(shapes(renderGlanceFigureChart(doc(), figure("movement", [2, 1])), "circle").length, 1);
});

test("an unmeasured figure, an unknown key and a missing figure draw nothing", () => {
  const document = doc();
  for (const figure of [
    { key: "spendMix", measured: false, series: [1, 2] },
    { key: "somethingElse", measured: true, series: [1, 2] },
    undefined,
    null,
  ]) {
    assert.equal(renderGlanceFigureChart(document, figure) === null, true,
      `${JSON.stringify(figure)} was given a picture`);
  }
});
