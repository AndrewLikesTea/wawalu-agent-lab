// The four glance figures, as four small pictures.
//
// WHAT THIS IS. One inline-SVG primitive and four narrow renderers over it, one
// per figure declared in finops-glance-spec.js. Plain numbers in, one SVG root
// out. No canvas, no library, no fetch, no build step: every picture is a
// handful of rects or one polyline whose coordinates are arithmetic over the
// same series the figure was measured from.
//
// DECORATIVE, AND THAT IS THE CONTRACT. Every root carries aria-hidden="true"
// and holds no text, no link, no control and no tabindex. The prose beside it
// keeps every number it already had. Delete every picture on this page and a
// screen-reader user loses nothing — which is also why no renderer here may
// move a number out of its line and into a label. The glance sits on a first
// screen with no spare tab stop, so a focusable node in this file would redden a
// tab-order test in another one.
//
// SELF-CONTAINED GEOMETRY, NO STYLESHEET. The leading gap and the pixel size are
// in the viewBox and on the root, not in a rule. This page's CSP sets
// style-src 'self' with no inline-style allowance, so a chart cannot carry its
// own style attribute; and a chart that needs a stylesheet rule to sit correctly
// beside its number renders wrong everywhere that rule is not. Colour is
// currentColor at a few opacities, so a mark follows the text it sits beside —
// dark mode and forced colours included — and no meaning is carried by hue.
//
// EVERY SHAPE IS THE NUMBER BESIDE IT, AND THAT IS CHECKED. The scales live in
// glance-chart-scales.js, one per figure, each of them invertible: the same
// module reads a drawn shape back as a number from its attributes alone.
// `renderGlanceFigureChart` runs that reading against the figure's published
// value and returns NOTHING when the two disagree, so a picture that has drifted
// from its sentence is never the thing a lead sees. The prose is untouched
// either way — it is the whole answer, and the picture is an illustration of it
// that has to earn its place on every paint.
//
// THE DEGENERATE SERIES ARE THE FEATURE, NOT A GUARD.
//   • No points: nothing is drawn and null is returned, so the caller keeps its
//     text and the DOM gains no empty SVG shell.
//   • One point: a valid single-datum shape, not an axis and not a trend. On the
//     page a one-point movement therefore draws nothing at all: a single period
//     states no change, and the sentence already says so in words.
//   • Many points: bounded. A ranked list draws at most RANK_ROWS rows.
//   • All zero, or flat: no denominator is ever zero, because a non-positive
//     denominator maps every datum to zero length. The chart then draws its
//     track and no fill — "nothing here", rather than NaN in a width. A flat
//     movement is the exception, and deliberately: two equal totals sit at the
//     same height on the zero-anchored axis, which reads back as 0.0% and is
//     exactly what the sentence says.
//   • Negative: magnitude and direction are separated before any attribute is
//     written. Month-over-month can fall, and a rect refuses a negative height.

import {
  BOX, DIM, GAP, HEIGHT, LINE_INSET, LIT, PEER_SLOTS, RANK_ROWS, SLICE_GUTTER,
  SLOT_GUTTER, TRACK, WIDTH, compareGlanceDrawing, round,
} from "./glance-chart-scales.js";

export { PEER_SLOTS, RANK_ROWS };

const SVG_NS = "http://www.w3.org/2000/svg";

/** Only real numbers reach a coordinate. A series of NaN is a series of none. */
const finite = (series) => (Array.isArray(series) ? series : [])
  .map((value) => Number(value))
  .filter((value) => Number.isFinite(value));

/** A share of the track, in [0, 1]. Out of range is a caller contract error;
 * it draws clamped, and the correspondence check then reports the mismatch
 * rather than letting a bar past the end of its own track. */
const share = (value) => Math.min(1, Math.max(0, value));

const el = (doc, name, attributes) => {
  const node = doc.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, typeof value === "number" ? String(round(value)) : String(value));
  }
  return node;
};

const root = (doc, key) => el(doc, "svg", {
  class: "glance-chart",
  "data-chart": key,
  viewBox: `0 0 ${BOX} ${HEIGHT}`,
  width: BOX,
  height: HEIGHT,
  "aria-hidden": "true",
  // Carrying no tabindex is what keeps this out of the tab order; `focusable`
  // is the SVG-side opt-out for engines that made svg focusable by default.
  focusable: "false",
});

const bar = (doc, { x, y, width, height, opacity }) => el(doc, "rect", {
  x, y, width: Math.max(0, width), height: Math.max(0, height),
  fill: "currentColor", "fill-opacity": opacity,
});

/**
 * Spend mix: one proportional bar, the largest class filled.
 *
 * Shares, not totals — but the arithmetic only needs them to be comparable, so
 * any non-negative series works. The largest slice is the one the line beside it
 * names, so it is the one at full opacity; the rest are the context that makes
 * "largest" mean something.
 */
export function renderSpendMixChart(doc, series) {
  const values = finite(series).map((value) => Math.max(0, value));
  if (values.length === 0) return null;
  const node = root(doc, "spendMix");
  node.append(bar(doc, { x: GAP, y: 3, width: WIDTH, height: 6, opacity: TRACK }));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total > 0) {
    const largest = values.indexOf(Math.max(...values));
    let x = GAP;
    for (const [index, value] of values.entries()) {
      const span = (value / total) * WIDTH;
      // The gutter is taken off the drawn width and not off the step, so the
      // slices stay proportional and two dim neighbours stay told apart. It goes
      // back on in `readSpendMixShare`, which is why it is a named constant.
      node.append(bar(doc, {
        x, y: 3, width: span - SLICE_GUTTER, height: 6, opacity: index === largest ? LIT : DIM,
      }));
      x += span;
    }
  }
  return node;
}

/**
 * Department rank: the top rows, each as its share of the period.
 *
 * SHARES, NOT DOLLARS, AND NOT NORMALISED BY THE LARGEST ROW. The track is the
 * period's whole spend, so a row's width is the percentage the line beside it
 * prints and the undrawn tail is the spend no department was attributed.
 * Scaling by the largest row instead would draw rank 1 at full width whether it
 * held 30% of the budget or 3%, which is a picture of the ranking and not of the
 * number in the sentence.
 *
 * The caller's series is already in the order the figure ranks by, so row 0 is
 * rank 1 and nothing is sorted here. Rows past RANK_ROWS are not drawn: the
 * picture answers "how far ahead is the first one", and the line beside it
 * carries the name and the share.
 */
export function renderRankChart(doc, series) {
  const values = finite(series);
  if (values.length === 0) return null;
  const node = root(doc, "departmentRank");
  const pitch = HEIGHT / RANK_ROWS;
  for (const [index, value] of values.slice(0, RANK_ROWS).entries()) {
    const y = index * pitch + 0.5;
    const height = pitch - 1;
    node.append(bar(doc, { x: GAP, y, width: WIDTH, height, opacity: TRACK }));
    node.append(bar(doc, {
      x: GAP, y, height, width: share(value) * WIDTH, opacity: index === 0 ? LIT : DIM,
    }));
  }
  return node;
}

/**
 * Movement: a line over the periods, on an axis anchored at zero.
 *
 * ANCHORED, NOT MIN-MAX NORMALISED. The top of the axis is the largest total and
 * the bottom is zero, so the slope is proportional to the change and the two
 * heights recover the ratio between the totals — which is the percentage the
 * sentence prints. Normalising by the pair's own min and max put every movement,
 * however small, on a slope from floor to ceiling: it drew the direction
 * truthfully and the size not at all.
 *
 * The sign is carried by where the last point sits, not by a length, so a fall
 * draws exactly as safely as a rise. Totals are sums of spend and non-negative;
 * a negative one is clamped to the baseline rather than drawn outside the box.
 * An all-zero series has no top to divide by and draws a level line through the
 * middle — no denominator is ever zero.
 */
export function renderMovementChart(doc, series) {
  const values = finite(series);
  if (values.length === 0) return null;
  const node = root(doc, "movement");
  const top = Math.max(...values, 0);
  const axis = HEIGHT - 2 * LINE_INSET;
  const y = (value) => (top > 0
    ? HEIGHT - LINE_INSET - (Math.max(0, value) / top) * axis
    : HEIGHT / 2);
  const x = (index) => (values.length > 1
    ? GAP + (index * WIDTH) / (values.length - 1)
    : GAP + WIDTH / 2);
  if (values.length > 1) {
    node.append(el(doc, "polyline", {
      points: values.map((value, index) => `${round(x(index))},${round(y(value))}`).join(" "),
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.25",
      "stroke-opacity": LIT,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }));
  }
  node.append(el(doc, "circle", {
    cx: x(values.length - 1), cy: y(values.at(-1)), r: 1.75,
    fill: "currentColor", "fill-opacity": LIT,
  }));
  return node;
}

/**
 * Peer position: the whole scale, with the occupied slots filled.
 *
 * `occupied` is one-based and may hold more than one slot, because the published
 * band model reports a middle HALF that spans two quartiles and names neither.
 * No occupied slot is no picture: an unmarked scale is a claim about nothing.
 */
export function renderPositionChart(doc, occupied, of = PEER_SLOTS) {
  const marks = new Set(finite(occupied).map((value) => Math.round(value)));
  const slots = Math.max(0, Math.round(Number(of)) || 0);
  if (marks.size === 0 || slots === 0) return null;
  const node = root(doc, "peerPosition");
  const pitch = WIDTH / slots;
  for (let slot = 1; slot <= slots; slot += 1) {
    node.append(bar(doc, {
      x: GAP + (slot - 1) * pitch + SLOT_GUTTER, y: 3,
      width: pitch - 2 * SLOT_GUTTER, height: 6,
      opacity: marks.has(slot) ? LIT : TRACK,
    }));
  }
  return node;
}

/** One renderer per declared figure key. A key with no entry gets no picture. */
const RENDERERS = Object.freeze({
  spendMix: renderSpendMixChart,
  departmentRank: renderRankChart,
  movement: renderMovementChart,
  peerPosition: (doc, series) => renderPositionChart(doc, series, PEER_SLOTS),
});

/**
 * The picture for one measured glance figure, or null.
 *
 * An UNMEASURED figure gets nothing. That block already says in words that it
 * could not measure the figure and why, and a shape beside that sentence would
 * be a picture of a number the page refused to publish.
 *
 * AND A DRAWN SHAPE THAT DOES NOT READ BACK AS THE FIGURE'S PUBLISHED VALUE GETS
 * NOTHING EITHER. The shape is measured with the figure's own scale — see
 * glance-chart-scales.js — and shown only when the recovered number matches the
 * one the sentence prints, inside a tolerance that is the two stated roundings
 * and nothing more. Three states end up in the same place, which is the point:
 * a series too degenerate to draw a percentage from, a figure carrying no
 * published value, and a genuine drift between the model and the geometry all
 * leave the prose standing alone rather than putting a second, different claim
 * beside it. The comparison returns its arithmetic, so a reviewer disputing a
 * missing picture gets both numbers and the tolerance.
 */
export function renderGlanceFigureChart(doc, figure) {
  if (!doc?.createElementNS || !figure?.measured) return null;
  const render = RENDERERS[figure.key];
  if (!render) return null;
  const chart = render(doc, figure.series ?? []);
  if (!chart) return null;
  return compareGlanceDrawing(chart, figure).agrees ? chart : null;
}
