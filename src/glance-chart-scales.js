// The scale each glance picture is drawn on, and the arithmetic that reads a
// drawn shape back as a number.
//
// WHAT THIS IS FOR. A picture beside a sentence is a second claim about the same
// reading, and a second claim can drift from the first without anyone noticing:
// nothing about a 19.2-unit rect says whether it is 41.2% of anything. This
// module makes the drift detectable by making every scale INVERTIBLE. For each
// figure it declares one projection — the model's published number, as a length
// or a position — and one inversion that recovers that number from the SVG
// attributes alone, reading no series and calling no model. The two meet in
// `compareGlanceDrawing`, which reports whether the shape re-reads as the number
// the prose beside it printed, and shows the arithmetic it used to decide.
//
// WHY THE INVERSION READS ATTRIBUTES AND NOTHING ELSE. If it took the series it
// would prove only that the same array was passed twice. It takes the rendered
// node, so the only thing that can make it agree is the geometry actually being
// a drawing of that number.
//
// THE SCALES, AND THE ASSUMPTION UNDER EACH ONE.
//   • spendMix — a stacked bar over the full track. The track is the graded
//     spend; each slice is that class's share of it. Assumes the series is a
//     normalised mix (it comes from `normalizeMix`, so it sums to 1), which is
//     what makes the lit slice's width the share the sentence prints.
//   • departmentRank — one row per department, each drawn as its share of the
//     SAME track, so the track is the period's whole spend and the undrawn tail
//     is the spend no department was attributed. Assumes the series is shares of
//     period spend, not dollars: dollars normalised by the largest row would
//     draw rank 1 at full width whatever share it held, and no width would then
//     correspond to the percentage beside it.
//   • movement — two period totals on an axis ANCHORED AT ZERO, top of the axis
//     being the larger total. Assumes both totals are non-negative sums of
//     spend. Anchoring is what carries the size of the change: normalising by
//     the pair's own min and max drew every movement, a 0.4% one included, as a
//     slope from floor to ceiling, and left the sentence's percentage nowhere in
//     the geometry.
//   • peerPosition — four fixed slots, the occupied ones lit. One lit slot is a
//     named quartile; two is the published middle band, which names none, and
//     which is why the inversion returns null there rather than picking one.
//
// TOLERANCE IS NOT SLOP. Each figure's tolerance below is the sum of two stated
// quantisations: the prose rounds to one decimal, and a coordinate is rounded to
// COORD_DECIMALS places. Nothing else is forgiven.
//
// No clock, no randomness, no environment: every export here is a pure function
// of its arguments, which is what lets the same series render byte-identically
// twice.

/** Viewbox units. One unit is one CSS pixel at 1x; GAP is clear space at the left. */
export const GAP = 6;
export const WIDTH = 48;
export const HEIGHT = 12;
export const BOX = GAP + WIDTH;

/** Taken off a slice's drawn width so two dim neighbours stay told apart. */
export const SLICE_GUTTER = 0.6;
/** Taken off a peer slot's width, at both ends, for the same reason. */
export const SLOT_GUTTER = 0.6;
/** Clear space above and below the movement axis, inside the box. */
export const LINE_INSET = 1.5;

/** The datum the prose names, everything else, and the unfilled track. */
export const LIT = "0.95";
export const DIM = "0.28";
export const TRACK = "0.12";

/** At most this many rows in a ranked list. The prose names rank 1. */
export const RANK_ROWS = 4;
/** The peer figure's scale: four quartiles, always drawn, one or two marked. */
export const PEER_SLOTS = 4;

/**
 * Every coordinate is rounded to this many places before it is written.
 *
 * Fixed precision, for two reasons. It is what makes two renders of one series
 * byte-identical rather than merely equal-looking — `(0.1 + 0.2) * 48` is not
 * the string `14.4`. And it bounds the inversion error below: a length is off by
 * at most 5e-5 units, which on the 48-unit track is 1e-6 of a share.
 */
export const COORD_DECIMALS = 4;

/** Rounded, and never `-0`, which stringifies as "-0" and is not a coordinate. */
export function round(value) {
  const rounded = Number(Number(value).toFixed(COORD_DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

const COORD_QUANTUM = 0.5 * 10 ** -COORD_DECIMALS;
/** Half of the prose's one-decimal percent, expressed as a share. */
const REPORTED_SHARE_QUANTUM = 0.0005;

const number = (node, name) => Number(node.getAttribute(name));

/** Element children only. Text nodes live in `children` here and have no tagName. */
const shapes = (node, tagName) => [...(node?.children ?? [])]
  .filter((child) => child.tagName === tagName.toUpperCase());

const lit = (node, tagName) => shapes(node, tagName)
  .filter((shape) => shape.getAttribute("fill-opacity") === LIT);

/**
 * The largest class's share, from the lit slice's width.
 *
 * The slice was drawn `share × WIDTH − SLICE_GUTTER` wide, so the gutter goes
 * back on before the division. Exactly one slice is lit; anything else is not a
 * drawing of one named class and reads as nothing.
 */
export function readSpendMixShare(node) {
  const slices = lit(node, "rect");
  if (slices.length !== 1) return null;
  return (number(slices[0], "width") + SLICE_GUTTER) / WIDTH;
}

/** Rank 1's share of period spend, from the lit row's width against the track. */
export function readRankShare(node) {
  const rows = lit(node, "rect");
  if (rows.length !== 1) return null;
  return number(rows[0], "width") / WIDTH;
}

/**
 * The signed percent change, from where the two points sit on the zero axis.
 *
 * `y = HEIGHT − LINE_INSET − (value / top) × (HEIGHT − 2 × LINE_INSET)`, so each
 * point recovers `value / top` — the totals up to one unknown common factor,
 * which then cancels in the ratio. `(latest / prior − 1) × 100` is exactly the
 * conversion `measureMovement` prints. A prior of zero has no percentage.
 */
export function readMovementPercent(node) {
  const line = shapes(node, "polyline")[0];
  if (!line) return null;
  const points = String(line.getAttribute("points")).trim().split(/\s+/);
  if (points.length < 2) return null;
  const axis = HEIGHT - 2 * LINE_INSET;
  const ratio = (point) => (HEIGHT - LINE_INSET - Number(point.split(",")[1])) / axis;
  const prior = ratio(points[0]);
  const latest = ratio(points.at(-1));
  if (!(prior > 0) || !Number.isFinite(latest)) return null;
  return (latest / prior - 1) * 100;
}

/**
 * The named quartile, from which slot is lit — or null when more than one is.
 *
 * Slot n was drawn at `GAP + (n − 1) × pitch + SLOT_GUTTER`, so the position
 * inverts to the slot index without reading any width.
 */
export function readPeerQuartile(node, slots = PEER_SLOTS) {
  const marks = lit(node, "rect");
  if (marks.length !== 1) return null;
  const pitch = WIDTH / slots;
  return Math.round((number(marks[0], "x") - GAP - SLOT_GUTTER) / pitch) + 1;
}

/**
 * One entry per figure: what the sentence's number means as a drawn quantity,
 * how to read that quantity back off the shape, and how far apart the two are
 * allowed to be before the drawing is a different claim from the sentence.
 *
 * `project` is deliberately trivial — a unit conversion and nothing else — so
 * that a disputing reviewer can check it by eye. All the work is in `read`.
 */
export const GLANCE_CHART_SCALES = Object.freeze({
  spendMix: Object.freeze({
    drawn: "the lit slice's share of the 48-unit track",
    project: (value) => value / 100,
    read: readSpendMixShare,
    // One decimal of a percent is 0.0005 of a share; the coordinate rounding
    // adds 5e-5 / 48. Rounded up to the next ten-thousandth: 0.00055.
    tolerance: REPORTED_SHARE_QUANTUM + COORD_QUANTUM / WIDTH,
    units: "share",
  }),
  departmentRank: Object.freeze({
    drawn: "the lit row's share of the 48-unit track",
    project: (value) => value / 100,
    read: readRankShare,
    tolerance: REPORTED_SHARE_QUANTUM + COORD_QUANTUM / WIDTH,
    units: "share",
  }),
  movement: Object.freeze({
    drawn: "the ratio of the two points' heights on the zero-anchored axis",
    project: (value) => value,
    read: readMovementPercent,
    // 0.05 is half of the printed decimal. The relative term carries the
    // coordinate rounding through the division: the error in a ratio grows with
    // the ratio, so a large movement is allowed a proportionally larger gap.
    // Beyond roughly ±10,000% the axis can no longer resolve the smaller total
    // and the figure draws nothing rather than a shape that reads as a
    // different number.
    tolerance: 0.05,
    relativeTolerance: 0.001,
    units: "percent",
  }),
  peerPosition: Object.freeze({
    drawn: "the index of the single lit quartile slot",
    project: (value) => value,
    read: (node) => readPeerQuartile(node),
    // Slot indices are integers recovered by rounding; there is nothing to
    // forgive, and a half-slot error is a different quartile.
    tolerance: 0,
    units: "quartile",
  }),
});

const show = (value, units) => (value === null ? "no number"
  : units === "share" ? `${(value * 100).toFixed(4)}%`
    : units === "percent" ? `${value.toFixed(4)}%` : String(value));

/**
 * Does this shape re-read as the number the sentence beside it printed?
 *
 * `figure` is the measured glance figure whose `display` the prose renders, so
 * `figure.value` is the number a reader can see. `chart` is the rendered SVG
 * root. Returns the comparison and the arithmetic behind it — an executive view
 * never has to take "they agree" on faith, and a reviewer disputing a mismatch
 * gets the two numbers and the tolerance rather than a boolean.
 *
 * A null on BOTH sides agrees: the middle peer band prints no quartile and
 * lights two slots, and "the picture names no single quartile either" is the
 * correct correspondence for a sentence that names none.
 */
export function compareGlanceDrawing(chart, figure) {
  const scale = GLANCE_CHART_SCALES[figure?.key];
  if (!scale) {
    return { key: figure?.key ?? null, agrees: false, drawn: null, stated: null,
      tolerance: 0, arithmetic: "no declared scale for this figure" };
  }
  const stated = figure.value === null || figure.value === undefined
    ? null : scale.project(Number(figure.value));
  const drawn = chart ? scale.read(chart) : null;
  const tolerance = scale.tolerance
    + (scale.relativeTolerance ?? 0) * Math.abs(stated ?? 0);
  const gap = stated === null || drawn === null ? null : Math.abs(drawn - stated);
  const agrees = stated === null || drawn === null
    ? stated === null && drawn === null
    : gap <= tolerance;
  return {
    key: figure.key,
    agrees,
    drawn,
    stated,
    tolerance,
    arithmetic: `${scale.drawn} reads ${show(drawn, scale.units)}; the sentence states `
      + `${show(stated, scale.units)}; |difference| ${gap === null ? "—" : show(gap, scale.units)} `
      + `${agrees ? "≤" : ">"} tolerance ${show(tolerance, scale.units)}`,
  };
}
