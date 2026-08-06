// The release log's shape, drawn above the list: one headline sentence and one
// bar group per week.
//
// INLINE SVG, NO LIBRARY, NO CANVAS. The whole picture is a dozen rectangles
// whose coordinates are arithmetic over record timestamps (history-trend.js), so
// a chart library would be a dependency, a bundle, and a second layout engine
// for a job the browser already does. SVG over canvas for the same reason a
// paragraph is not painted: the bars are real nodes, so they can be named, be
// focused, and be read by assistive tech, and they resample at every device
// pixel ratio instead of being rasterized once at the wrong one.
//
// EVERY COORDINATE IS A VIEWBOX UNIT. Nothing here computes a pixel or reads a
// device ratio: the element is sized by the stylesheet and the browser maps the
// viewBox onto whatever box that produces. That is what keeps the chart sharp at
// 2x, and why no bar geometry is rounded to whole units — rounding is what puts
// a half-pixel seam between two bars once the map is not 1:1.
//
// ONE TAB STOP, NOT ONE PER WEEK. The bars are a composite control with a roving
// tabindex, the same shape the record list uses: Tab reaches the chart once,
// arrows move between weeks, Enter or Space applies that week's date filter.
// Twenty-six bars as twenty-six tab stops would put the record list a screenful
// of Tab presses away from the filters above it.

import {
  historyTrendDescription,
  historyTrendHeadline,
  historyWeekBuckets,
  trendChartLayout,
  weekBarName,
  weekBarSegmentName,
} from "./history-trend.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export const TREND_DESCRIPTION_ID = "history-trend-description";
export const TREND_CHART_NAME = "Records per week";
export const EMPTY_TREND_LINE = "No records match this view, so there is no shape to draw.";
export const SINGLE_WEEK_TREND_LINE = "Every record in this view lands in one week, so there is no week-to-week shape to draw yet.";

const svgElement = (name, attributes) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

const textElement = (parent, tagName, className, text) => {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
};

/**
 * Draw the trend for `records` — the *filtered* set, the same one the list
 * renders, so the headline and the bars can never describe a different view.
 *
 * Both degenerate states replace the chart with one explanatory line rather than
 * drawing an axis: an empty chart and a single lonely bar both read as a claim
 * about a trend, and neither set contains one. The headline still renders in
 * both, because "no records in this view" is a true thing to say and a blank
 * space is not.
 *
 * @returns the buckets drawn and the focusable bar groups, in week order.
 */
export function renderHistoryTrend(node, { records = [], onSelectWeek } = {}) {
  if (!node) return { buckets: [], groups: [] };
  const buckets = historyWeekBuckets(records);
  node.replaceChildren();
  textElement(node, "p", "filter-summary", historyTrendHeadline(buckets));

  if (buckets.length < 2) {
    textElement(node, "p", "hint", buckets.length === 0 ? EMPTY_TREND_LINE : SINGLE_WEEK_TREND_LINE);
    return { buckets, groups: [] };
  }

  // The description is a sentence about the trend, not a table of the numbers:
  // the per-bar names carry the counts, and a reader who wants them can walk the
  // bars. It lives in the document (visually hidden) rather than in a desc
  // element, because that is the association assistive tech reports reliably.
  const description = textElement(node, "p", "visually-hidden", historyTrendDescription(buckets));
  description.id = TREND_DESCRIPTION_ID;

  const layout = trendChartLayout(buckets);
  const chart = svgElement("svg", {
    class: "trend-chart",
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    // The box the stylesheet gives it is filled exactly. Uniform scaling would
    // letterbox a 26-week chart in a wide column and blow a 3-week one up to the
    // height of the list; the bars stay comparable either way because every one
    // of them is scaled by the same factor in the same direction.
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": TREND_CHART_NAME,
    "aria-describedby": TREND_DESCRIPTION_ID,
  });

  const groups = [];
  const focusWeek = (index) => {
    const next = Math.max(0, Math.min(groups.length - 1, index));
    for (const [at, group] of groups.entries()) group.setAttribute("tabindex", at === next ? "0" : "-1");
    groups[next]?.focus?.();
  };

  for (const week of layout.weeks) {
    const group = svgElement("g", {
      role: "button",
      // The last week — the one the headline is about — is the one Tab lands on.
      tabindex: "-1",
      "aria-label": weekBarName(week.bucket),
    });
    group.dataset.week = week.bucket.start;
    // A week with no records has no bar to hit or to focus, so each group
    // carries a full-height invisible target. `fill="none"` paints nothing;
    // `pointer-events="all"` still makes it hittable.
    group.append(svgElement("rect", {
      x: week.x,
      y: 0,
      width: week.width,
      height: layout.height,
      fill: "none",
      "pointer-events": "all",
    }));
    for (const [kind, bar] of [["decision", week.decisions], ["release", week.releases]]) {
      // Told apart by position and width inside the group, not by colour: the
      // fill is the page's own text colour at two opacities, which is a second
      // cue rather than the only one.
      const rect = svgElement("rect", {
        x: bar.x,
        y: bar.y,
        width: bar.width,
        height: bar.height,
        fill: "currentColor",
        "fill-opacity": kind === "decision" ? "0.85" : "0.4",
        "aria-label": weekBarSegmentName(week.bucket, kind),
      });
      rect.dataset.kind = kind;
      rect.dataset.count = String(bar.count);
      group.append(rect);
    }

    const activate = (event) => {
      event?.preventDefault?.();
      onSelectWeek?.(week.bucket);
    };
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") return activate(event);
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault?.();
        return focusWeek(event.key === "Home" ? 0 : groups.length - 1);
      }
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (step === undefined) return undefined;
      event.preventDefault?.();
      return focusWeek(groups.indexOf(group) + step);
    });
    group.addEventListener("click", activate);
    groups.push(group);
    chart.append(group);
  }
  groups.at(-1)?.setAttribute("tabindex", "0");

  node.append(chart);
  return { buckets, layout, groups };
}
