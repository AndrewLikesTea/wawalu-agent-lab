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
// THE DEGENERATE SERIES ARE THE FEATURE, NOT A GUARD.
//   • No points: nothing is drawn and null is returned, so the caller keeps its
//     text and the DOM gains no empty SVG shell.
//   • One point, or an all-equal movement series: no trend is claimed. The
//     production view keeps the prose and states the chart fallback instead.
//   • Many points: bounded. A ranked list draws at most RANK_ROWS rows.
//   • All zero, or flat: no denominator is ever zero, because a non-positive
//     denominator maps every datum to zero length. The chart then draws its
//     track and no fill — "nothing here", rather than NaN in a width.
//   • Negative: magnitude and direction are separated before any attribute is
//     written. Month-over-month can fall, and a rect refuses a negative height.

const SVG_NS = "http://www.w3.org/2000/svg";

// Viewbox units, and the shipped pixel size: one unit is one CSS pixel at 1x,
// and the browser resamples from the viewBox at every other ratio. GAP is clear
// space inside the box, which is how the mark stands off its number without a
// margin rule.
const GAP = 6;
const WIDTH = 48;
const HEIGHT = 12;
const BOX = GAP + WIDTH;

/** The datum the prose names, everything else, and the unfilled track. */
const LIT = "0.95";
const DIM = "0.28";
const TRACK = "0.12";

/** At most this many bars in a ranked list. The prose names rank 1. */
export const RANK_ROWS = 4;

/** The peer figure's scale: four quartiles, always drawn, one or two marked. */
export const PEER_SLOTS = 4;

/** Visible beside prose when a series cannot honestly communicate a trend. */
export const GLANCE_CHART_FALLBACK = "Chart not shown: a trend needs two distinct period values.";

/** Only real numbers reach a coordinate. A series of NaN is a series of none. */
const finite = (series) => (Array.isArray(series) ? series : [])
  .map((value) => Number(value))
  .filter((value) => Number.isFinite(value));

const el = (doc, name, attributes) => {
  const node = doc.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
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
      // slices stay proportional and two dim neighbours stay told apart.
      node.append(bar(doc, {
        x, y: 3, width: span - 0.6, height: 6, opacity: index === largest ? LIT : DIM,
      }));
      x += span;
    }
  }
  return node;
}

/**
 * Department rank: the top rows as bars against the largest.
 *
 * The caller's series is already in the order the figure ranks by, so row 0 is
 * rank 1 and nothing is sorted here. Rows past RANK_ROWS are not drawn: the
 * picture answers "how far ahead is the first one", and the line beside it
 * carries the name and the share.
 */
export function renderRankChart(doc, series) {
  const values = finite(series).map((value) => Math.max(0, value));
  if (values.length === 0) return null;
  const node = root(doc, "departmentRank");
  const rows = values.slice(0, RANK_ROWS);
  const largest = Math.max(...rows);
  const pitch = HEIGHT / RANK_ROWS;
  for (const [index, value] of rows.entries()) {
    const y = index * pitch + 0.5;
    const height = pitch - 1;
    node.append(bar(doc, { x: GAP, y, width: WIDTH, height, opacity: TRACK }));
    node.append(bar(doc, {
      x: GAP, y, height,
      width: largest > 0 ? (value / largest) * WIDTH : 0,
      opacity: index === 0 ? LIT : DIM,
    }));
  }
  return node;
}

/**
 * Movement: a sparkline over the periods, with the latest one marked.
 *
 * The sign is carried by where the last point sits, not by a length, so a fall
 * draws exactly as safely as a rise. A flat or all-zero series has no span to
 * normalise against and draws a level line through the middle.
 */
export function renderMovementChart(doc, series) {
  const values = finite(series);
  if (values.length < 2 || new Set(values).size < 2) return null;
  const node = root(doc, "movement");
  const low = Math.min(...values);
  const span = Math.max(...values) - low;
  const y = (value) => (span > 0 ? HEIGHT - 1.5 - ((value - low) / span) * (HEIGHT - 3) : HEIGHT / 2);
  const x = (index) => (values.length > 1
    ? GAP + (index * WIDTH) / (values.length - 1)
    : GAP + WIDTH / 2);
  node.append(el(doc, "polyline", {
    points: values.map((value, index) => `${x(index)},${y(value)}`).join(" "),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.25",
    "stroke-opacity": LIT,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }));
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
      x: GAP + (slot - 1) * pitch + 0.6, y: 3,
      width: pitch - 1.2, height: 6,
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
 */
export function renderGlanceFigureChart(doc, figure) {
  if (!doc?.createElementNS || !figure?.measured) return null;
  const render = RENDERERS[figure.key];
  return render ? render(doc, figure.series ?? []) : null;
}
