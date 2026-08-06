// The release-log trend chart: the week buckets, the headline sentence, the
// drawn chart, and what activating a bar does to the record list.
//
// Same split as the rest of the history tests: the pure layer is tested
// directly, the render layer through the shared element stub, and the wiring
// through initDecisionLog with the harness that drives the real controls. The
// week boundary is asserted at the exact instants that decide it — a bucket rule
// tested only in the middle of a week is a rule nobody has tested.
import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, toHistoryRecords } from "../src/app.js";
import {
  MAX_TREND_WEEKS,
  historyTrendDescription,
  historyTrendHeadline,
  historyWeekBuckets,
  trendChartLayout,
  weekStartOf,
} from "../src/history-trend.js";
import { renderHistoryTrend, EMPTY_TREND_LINE, SINGLE_WEEK_TREND_LINE } from "../src/history-trend-view.js";
import { createHistoryHarness } from "./support/decision-log.js";
import { byClass, createElement, installDocument, walk } from "./support/dom.js";

installDocument();

// Hand-built records: `type` and `createdAt` are all the bucketing reads, and
// building them by hand keeps the week under test visible in the test.
const at = (createdAt, type = "decision") => ({ id: `${type}-${createdAt}`, type, createdAt });

// 2026-06-01 is a Monday. Every instant below is stated in UTC, the basis the
// From/To filters already read.
const MONDAY = "2026-06-01T00:00:00.000Z";
const SUNDAY_END = "2026-06-07T23:59:59.999Z";

test("a week runs Monday 00:00 UTC to the last millisecond of Sunday", () => {
  const monday = weekStartOf(MONDAY);
  assert.equal(new Date(monday).toISOString(), MONDAY);
  // Both boundary instants land in the same week; one millisecond either side
  // does not.
  assert.equal(weekStartOf(SUNDAY_END), monday);
  assert.equal(weekStartOf("2026-06-07T23:59:59.999Z"), monday);
  assert.equal(weekStartOf("2026-05-31T23:59:59.999Z"), monday - 7 * 86_400_000);
  assert.equal(weekStartOf("2026-06-08T00:00:00.000Z"), monday + 7 * 86_400_000);
  assert.equal(weekStartOf("not a date"), null, "an unreadable instant is placed in no week");
});

test("the boundary instants bucket into one week, not two", () => {
  const buckets = historyWeekBuckets([at(MONDAY), at(SUNDAY_END, "release")]);
  assert.equal(buckets.length, 1);
  assert.deepEqual(
    { start: buckets[0].start, end: buckets[0].end, decisions: buckets[0].decisions, releases: buckets[0].releases },
    { start: "2026-06-01", end: "2026-06-07", decisions: 1, releases: 1 },
  );
  assert.equal(buckets[0].total, 2);
});

test("an empty set and a single-week set are distinguishable, not both blank", () => {
  assert.deepEqual(historyWeekBuckets([]), []);
  assert.equal(historyWeekBuckets([at(MONDAY)]).length, 1);
});

test("a week nobody recorded in is a zero bucket, not a closed gap", () => {
  // Two records three weeks apart: the two empty weeks between them are drawn.
  const buckets = historyWeekBuckets([at(MONDAY), at("2026-06-22T12:00:00.000Z", "release")]);
  assert.deepEqual(buckets.map((bucket) => bucket.start), [
    "2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22",
  ]);
  assert.deepEqual(buckets.map((bucket) => bucket.total), [1, 0, 0, 1]);
  assert.deepEqual(buckets.map((bucket) => bucket.releases), [0, 0, 0, 1]);
});

test("a range longer than the cap keeps the most recent weeks", () => {
  const records = [at("2025-01-06T00:00:00.000Z"), at(MONDAY)];
  const buckets = historyWeekBuckets(records);
  assert.equal(buckets.length, MAX_TREND_WEEKS);
  assert.equal(buckets.at(-1).start, "2026-06-01", "the newest week is the one that survives");
  assert.equal(historyWeekBuckets(records, { maxWeeks: 3 }).length, 3);
});

// --- the headline ----------------------------------------------------------

const headlineFor = (...totals) => historyTrendHeadline(totals.map((total, index) => ({
  start: `2026-06-${String(1 + index * 7).padStart(2, "0")}`,
  end: `2026-06-${String(7 + index * 7).padStart(2, "0")}`,
  decisions: total,
  releases: 0,
  total,
})));

test("the headline states the number and its direction, in every case", () => {
  assert.match(headlineFor(11, 7), /^7 records in the week of Jun 8, 2026, down from 11 the week before\.$/);
  assert.match(headlineFor(7, 11), /up from 7 the week before\.$/);
  // Equal counts say "unchanged". Never "up 0" and never a direction at all.
  const unchanged = headlineFor(7, 7);
  assert.match(unchanged, /unchanged from the week before\.$/);
  assert.doesNotMatch(unchanged, /\bup\b|\bdown\b/);
  // A prior period of zero is a real comparison, and "up from 0" is not English.
  assert.match(headlineFor(0, 4), /^4 records in the week of Jun 8, 2026, up from none the week before\.$/);
  // No prior period at all: no direction is claimed.
  assert.match(headlineFor(3), /^3 records in the week of Jun 1, 2026\. No earlier week in this view to compare it with\.$/);
  // And nothing at all is still a sentence.
  assert.match(historyTrendHeadline([]), /No records in this view/);
  assert.match(headlineFor(1), /^1 record in the week of/, "one record is not '1 records'");
});

test("the description is one sentence about the trend, not the numbers again", () => {
  const buckets = historyWeekBuckets([at(MONDAY), at(MONDAY), at("2026-06-10T00:00:00.000Z", "release")]);
  const description = historyTrendDescription(buckets);
  assert.match(description, /^Records per week for the 2 weeks from Jun 1, 2026 to Jun 14, 2026, busiest in the week of Jun 1, 2026 with 2 records\.$/);
  assert.equal(description.split(". ").length, 1);
  assert.equal(historyTrendDescription([]), "No records to chart.");
});

// --- the geometry ----------------------------------------------------------

test("every bar is laid out from one scale factor, and nothing is clipped", () => {
  const buckets = historyWeekBuckets([
    at(MONDAY), at(MONDAY), at(MONDAY), at("2026-06-09T00:00:00.000Z", "release"),
  ]);
  const layout = trendChartLayout(buckets);
  assert.equal(layout.max, 3);
  assert.equal(layout.scale, 100 / 3);
  assert.equal(layout.height, 100);
  // The tallest bar fills the box exactly: the scale rebases on the range, so a
  // dominant week flattens the others rather than overflowing.
  const tallest = layout.weeks[0].decisions;
  assert.equal(tallest.height, 100);
  assert.equal(tallest.y, 0);
  // A one-record week is a third of it, unrounded — the browser rasterizes the
  // fraction rather than a whole unit that would seam at 2x.
  const single = layout.weeks[1].releases;
  assert.equal(single.height, 100 / 3);
  assert.equal(single.y, 100 - 100 / 3);
  assert.notEqual(single.height, Math.round(single.height));
  // Decisions sit left of releases inside the group: position, not colour.
  assert.ok(layout.weeks[0].decisions.x < layout.weeks[0].releases.x);
  assert.equal(layout.weeks[1].x, layout.weeks[0].x + layout.weeks[0].width);
  // A zero count is a zero-height bar, never a stub that would read as one.
  assert.equal(layout.weeks[1].decisions.height, 0);
});

// --- the drawn chart -------------------------------------------------------

function draw(records) {
  const node = createElement("div");
  const drawn = renderHistoryTrend(node, { records });
  const chart = byClass(node, "trend-chart")[0] ?? null;
  return { node, chart, drawn, rects: chart ? walk(chart, (child) => child.tagName === "RECT") : [] };
}

const records = historyRecords();

function historyRecords() {
  return [
    at(MONDAY), at("2026-06-02T09:00:00.000Z"), at("2026-06-03T09:00:00.000Z", "release"),
    at("2026-06-15T09:00:00.000Z"), at("2026-06-16T09:00:00.000Z", "release"),
  ];
}

test("the chart is one image with a description, and every bar is named", () => {
  const { node, chart, drawn } = draw(records);
  assert.equal(chart.getAttribute("role"), "img");
  assert.equal(chart.namespaceURI, "http://www.w3.org/2000/svg");
  // The description is associated, present, and about the trend.
  const describedBy = chart.getAttribute("aria-describedby");
  const description = walk(node, (child) => child.id === describedBy);
  assert.equal(description.length, 1);
  assert.match(description[0].textContent, /Records per week for the 3 weeks/);
  // The viewBox is what sizes it: no pixel width or height attribute.
  assert.equal(chart.getAttribute("viewBox"), "0 0 36 100");
  assert.equal(chart.getAttribute("width"), null);
  assert.equal(chart.getAttribute("height"), null);

  assert.equal(drawn.groups.length, 3, "the empty middle week is drawn too");
  assert.deepEqual(drawn.groups.map((group) => group.dataset.week), ["2026-06-01", "2026-06-08", "2026-06-15"]);
  assert.deepEqual(drawn.groups.map((group) => group.getAttribute("aria-label")), [
    "Week of Jun 1, 2026: 2 decisions, 1 release",
    "Week of Jun 8, 2026: 0 decisions, 0 releases",
    "Week of Jun 15, 2026: 1 decision, 1 release",
  ]);
  // Each bar names what it counts, so the two kinds are told apart without
  // colour by a reader who cannot see either one.
  const bars = walk(chart, (child) => child.dataset.kind !== undefined);
  assert.equal(bars.length, 6);
  assert.equal(bars[0].getAttribute("aria-label"), "2 decisions in the week of Jun 1, 2026");
  assert.equal(bars[1].getAttribute("aria-label"), "1 release in the week of Jun 1, 2026");
});

test("the bars are one composite control, not one tab stop per week", () => {
  const { drawn } = draw(records);
  const tabindexes = drawn.groups.map((group) => group.getAttribute("tabindex"));
  assert.deepEqual(tabindexes, ["-1", "-1", "0"], "Tab lands on the week the headline is about");
  assert.equal(tabindexes.filter((value) => value === "0").length, 1);
  for (const group of drawn.groups) assert.equal(group.getAttribute("role"), "button");

  // An arrow moves the roving stop and takes focus with it.
  drawn.groups[2].dispatch("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.deepEqual(drawn.groups.map((group) => group.getAttribute("tabindex")), ["-1", "0", "-1"]);
  assert.equal(drawn.groups[1].focused, 1);
  drawn.groups[1].dispatch("keydown", { key: "Home", preventDefault() {} });
  assert.equal(drawn.groups[0].getAttribute("tabindex"), "0");
});

test("both degenerate states say so instead of drawing a misleading axis", () => {
  const empty = draw([]);
  assert.equal(byClass(empty.node, "trend-chart").length, 0);
  assert.equal(empty.rects.length, 0);
  assert.match(empty.node.textContent, /No records in this view/);
  assert.match(empty.node.textContent, new RegExp(EMPTY_TREND_LINE.slice(0, 40)));

  const oneWeek = draw([at(MONDAY), at(SUNDAY_END, "release")]);
  assert.equal(byClass(oneWeek.node, "trend-chart").length, 0, "one bar is not a trend");
  assert.equal(oneWeek.rects.length, 0);
  // The headline is still true and still there.
  assert.match(oneWeek.node.textContent, /^2 records in the week of Jun 1, 2026\./);
  assert.match(oneWeek.node.textContent, new RegExp(SINGLE_WEEK_TREND_LINE.slice(0, 40)));
});

// --- the wiring ------------------------------------------------------------

const demo = {
  decisions: [
    { id: "queue", title: "Adopt a durable queue", context: "Retries are required", owner: "Kai", status: "accepted", createdAt: "2026-06-01T09:00:00.000Z" },
    { id: "cache", title: "Approve edge cache", context: "Reduce latency", owner: "Mina", status: "pending", createdAt: "2026-06-16T09:00:00.000Z" },
  ],
  releases: [
    { id: "r-1-3-0", version: "v1.3.0", title: "Throughput", description: "Shipped.", status: "completed", owner: "Kai", createdAt: "2026-06-17T09:00:00.000Z", decisionIds: ["cache"] },
  ],
};

const titles = (harness) => byClass(harness.list, "history-card").map((card) => card.children[0].textContent);

async function open(search = "") {
  const harness = createHistoryHarness(demo, { search });
  await initDecisionLog(harness.root, harness.storage, {
    announceDelay: 0,
    seed: demo,
    ...harness.browser,
  });
  return harness;
}

test("the chart draws the filtered view and moves with the filters", async () => {
  const harness = await open();
  assert.equal(harness.trendBars().length, 3, "Jun 1, the empty Jun 8, and Jun 15");
  // The week before is the empty Jun 8 bucket, not the last week that had a
  // record in it: that is the comparison the bars draw.
  assert.match(harness.trend.textContent, /2 records in the week of Jun 15, 2026, up from none the week before\./);

  // A filter the list obeys is a filter the chart obeys, on the same render.
  harness.chooseType("release");
  assert.equal(harness.trendBars().length, 0, "one release lands in one week");
  assert.match(harness.trend.textContent, /1 record in the week of Jun 15, 2026\./);
  harness.chooseType("all");
  assert.equal(harness.trendBars().length, 3);
});

test("pressing Enter on a bar narrows the list to that week", async () => {
  const harness = await open();
  assert.equal(titles(harness).length, 3);

  harness.pressBar("2026-06-15", "Enter");
  assert.deepEqual(titles(harness), ["v1.3.0 · Throughput", "Approve edge cache"]);
  assert.equal(harness.count.textContent, "2 of 3 records");
  // Applied through the page's own date filter — the controls, the URL, and the
  // chips all describe it, because there is only one filtering path.
  assert.equal(harness.elements["#filter-from"].value, "2026-06-15");
  assert.equal(harness.elements["#filter-to"].value, "2026-06-21");
  assert.equal(harness.url, "?from=2026-06-15&to=2026-06-21");
  assert.deepEqual(harness.chipButtons().map((chip) => chip.dataset.filter), ["from", "to"]);
  // The bar the keyboard was standing on is gone; focus is not.
  assert.ok(harness.elements["#filter-from"].focused > 0);
});

test("Space activates a bar too, and the week it applies is its own", async () => {
  const harness = await open();
  harness.pressBar("2026-06-01", " ");
  assert.deepEqual(titles(harness), ["Adopt a durable queue"]);
  assert.equal(harness.url, "?from=2026-06-01&to=2026-06-07");
  // One week left in view: the chart says so rather than drawing a lone bar.
  assert.equal(harness.trendBars().length, 0);
  assert.match(harness.trend.textContent, /one week/);
});

test("the page markup carries the slot the chart is drawn into", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(page, /<div id="history-trend"><\/div>/);
  // Above the list, below the summary it agrees with.
  assert.ok(page.indexOf('id="history-filter-summary"') < page.indexOf('id="history-trend"'));
  assert.ok(page.indexOf('id="history-trend"') < page.indexOf('id="decision-list"'));
});

test("the toHistoryRecords stream buckets without any extra shaping", () => {
  // The chart reads the same composed records the list does, so a release is a
  // release to it without a second normalization step in between.
  const buckets = historyWeekBuckets(toHistoryRecords(demo.decisions, demo.releases));
  assert.deepEqual(buckets.map((bucket) => [bucket.decisions, bucket.releases]), [[1, 0], [0, 0], [1, 1]]);
});
