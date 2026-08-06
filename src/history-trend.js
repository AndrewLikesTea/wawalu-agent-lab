// The shape of the log over time: the filtered history as week buckets, the
// sentence that says which way it is going, and the geometry of the chart that
// draws it. Pure arithmetic over record timestamps — no clock, no chart library,
// no canvas, and nothing here touches the DOM.
//
// THE WEEK BOUNDARY, STATED ONCE: ISO weeks, Monday 00:00 UTC. UTC because
// selectHistory already reads the From/To filters as calendar days in UTC, and a
// second timezone basis would put a record in a week the date filter that
// selects it disagrees with — the bar and the list would then describe
// different sets and neither would be wrong on its own terms.
//
// CONTIGUITY IS THE POINT. The buckets run week by week from the first record's
// week to the last one's, so a week nobody recorded in is a zero bar rather than
// a missing one. A chart that closes the gap draws four busy weeks in a row that
// never happened, which is the one thing a trend must not do.

import { formatFilterDate } from "./history-filters.js";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * The Monday 00:00 UTC that opens the week containing `instant`, in epoch
 * milliseconds — or `null` when the instant is not readable.
 *
 * 1970-01-01 was a Thursday, so the Monday-based index of a day number is
 * `(days + 3) % 7`. Whole-day arithmetic in UTC: no zone offset, no DST rule,
 * and no `Date` component reads that would import a local calendar.
 */
export function weekStartOf(instant) {
  const at = typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(at)) return null;
  const days = Math.floor(at / DAY_MS);
  return (days - (((days + 3) % 7) + 7) % 7) * DAY_MS;
}

const dayString = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * How many weeks the chart will draw at most, oldest weeks dropped first.
 *
 * A log spanning two years is 104 bars in a column a few hundred pixels wide:
 * every bar becomes a hairline and the shape stops being readable. Capping is a
 * trade-off with a cost — the chart then describes the most recent stretch of
 * the view rather than all of it — so the description sentence says how many
 * weeks are drawn, and the headline is computed from the same drawn buckets.
 */
export const MAX_TREND_WEEKS = 26;

/**
 * The filtered record set as contiguous week buckets, oldest first.
 *
 * Empty input returns `[]` — "nothing to chart" — and a set that lands inside
 * one week returns exactly one bucket, so a renderer can tell the two degenerate
 * cases apart from each other and from a real trend without re-deriving either.
 * A record whose `createdAt` cannot be read is left out rather than dropped into
 * a week it may not belong to.
 */
export function historyWeekBuckets(records = [], { maxWeeks = MAX_TREND_WEEKS } = {}) {
  const counted = new Map();
  let first = null;
  let last = null;
  for (const record of records) {
    const start = weekStartOf(record?.createdAt);
    if (start === null) continue;
    const counts = counted.get(start) ?? { decisions: 0, releases: 0 };
    if (record?.type === "release") counts.releases += 1;
    else counts.decisions += 1;
    counted.set(start, counts);
    if (first === null || start < first) first = start;
    if (last === null || start > last) last = start;
  }
  if (first === null) return [];
  const weeks = [];
  for (let start = first; start <= last; start += WEEK_MS) {
    const counts = counted.get(start) ?? { decisions: 0, releases: 0 };
    weeks.push({
      // Calendar days, because that is what the From/To filters take: a bar can
      // hand its own week straight to the existing date filter.
      start: dayString(start),
      end: dayString(start + 6 * DAY_MS),
      startMs: start,
      decisions: counts.decisions,
      releases: counts.releases,
      total: counts.decisions + counts.releases,
    });
  }
  return weeks.slice(-maxWeeks);
}

const recordWord = (count) => (count === 1 ? "record" : "records");
const countPhrase = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The week a bar covers, in the words the date chips already use. */
export const weekLabel = (bucket) => `week of ${formatFilterDate(bucket.start)}`;

/** A bar group's accessible name: which week, and both counts. */
export function weekBarName(bucket) {
  return `${weekLabel(bucket).replace("week", "Week")}: `
    + `${countPhrase(bucket.decisions, "decision")}, ${countPhrase(bucket.releases, "release")}`;
}

/**
 * One bar's own accessible name. The group above it already says which week this
 * is, but a bar a reader has landed on must still name what it counts: "3
 * decisions" beside "1 release" is the distinction colour alone would carry.
 */
export function weekBarSegmentName(bucket, kind) {
  const count = kind === "release" ? bucket.releases : bucket.decisions;
  return `${countPhrase(count, kind)} in the ${weekLabel(bucket)}`;
}

/**
 * The material number and its direction: "7 records in the week of Jun 1, 2026,
 * down from 11 the week before".
 *
 * The latest week is named rather than called "this week". The buckets come from
 * the filtered view, so the last one is the most recent week *in that view* —
 * which is not today's week whenever a filter excludes it, and a headline that
 * says "this week" about a stretch of April would be a plain lie.
 *
 * Equal counts say "unchanged"; a prior week nobody recorded in says "up from
 * none"; and a view with only one week says so instead of inventing a direction.
 */
export function historyTrendHeadline(buckets = []) {
  if (buckets.length === 0) return "No records in this view, so there is no trend to report.";
  const latest = buckets.at(-1);
  const prior = buckets.length > 1 ? buckets.at(-2) : null;
  const lead = `${latest.total} ${recordWord(latest.total)} in the ${weekLabel(latest)}`;
  if (!prior) return `${lead}. No earlier week in this view to compare it with.`;
  if (latest.total === prior.total) return `${lead}, unchanged from the week before.`;
  if (prior.total === 0) return `${lead}, up from none the week before.`;
  return `${lead}, ${latest.total > prior.total ? "up" : "down"} from ${prior.total} the week before.`;
}

/** One sentence describing the whole chart, for the reader who cannot see it. */
export function historyTrendDescription(buckets = []) {
  if (buckets.length === 0) return "No records to chart.";
  const peak = buckets.reduce((best, bucket) => (bucket.total > best.total ? bucket : best), buckets[0]);
  return `Records per week for the ${buckets.length} weeks from ${formatFilterDate(buckets[0].start)}`
    + ` to ${formatFilterDate(buckets.at(-1).end)}, busiest in the ${weekLabel(peak)}`
    + ` with ${peak.total} ${recordWord(peak.total)}.`;
}

// THE CHART'S GEOMETRY, IN VIEWBOX UNITS AND NOWHERE ELSE.
//
// Everything below is a coordinate in the viewBox, never a pixel: the element is
// sized by the stylesheet and the browser rasterizes the fractions, so the same
// chart is sharp at 1x, at 2x, and at whatever the reader's zoom happens to be.
// Nothing is rounded to whole units — rounding here is what puts a half-pixel
// seam between two bars on a retina display, and it buys nothing.
export const CHART_HEIGHT = 100;
const WEEK_WIDTH = 12;
const BAR_WIDTH = 4;
const BAR_GAP = 1;

/**
 * Bars for a bucket set, laid out from a single scale factor.
 *
 * THE SCALE: `CHART_HEIGHT / max`, where `max` is the tallest single bar in the
 * range. It rebases on every render — nothing is ever clipped — so one dominant
 * week flattens every other bar rather than overflowing the box. That is the
 * trade-off of a self-scaling chart: the shape stays honest, the small weeks
 * lose resolution, and the accessible names carry the counts the pixels no
 * longer separate.
 *
 * Decisions and releases are told apart by position and width inside the group,
 * not by colour: the decisions bar sits left, the releases bar right, and each
 * carries its own accessible name.
 */
export function trendChartLayout(buckets = []) {
  const max = buckets.reduce((tallest, bucket) => Math.max(tallest, bucket.decisions, bucket.releases), 0);
  const scale = max > 0 ? CHART_HEIGHT / max : 0;
  const weeks = buckets.map((bucket, index) => {
    const left = index * WEEK_WIDTH;
    const bar = (count, offset) => ({
      x: left + offset,
      y: CHART_HEIGHT - count * scale,
      width: BAR_WIDTH,
      height: count * scale,
      count,
    });
    return {
      bucket,
      x: left,
      width: WEEK_WIDTH,
      decisions: bar(bucket.decisions, BAR_GAP),
      releases: bar(bucket.releases, BAR_GAP + BAR_WIDTH + BAR_GAP),
    };
  });
  return {
    width: Math.max(WEEK_WIDTH, buckets.length * WEEK_WIDTH),
    height: CHART_HEIGHT,
    max,
    scale,
    weeks,
  };
}
