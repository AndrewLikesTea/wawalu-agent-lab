// The release-outcome figure's arithmetic: which decisions have an outcome, how
// long each one took, which one has been open longest, and the strip's geometry
// in device pixels.
//
// Golden values, not shapes. Every coordinate below is written out as the number
// it must be, because "the marks are inside the box" passes for a strip drawn one
// pixel wide and a rounding change that smears a 2px rule across a device-pixel
// boundary is invisible to any assertion that only checks ordering. The 1× and
// 2× cases are both spelled out: doubling is exactly what a retina display asks
// for, and it is the arithmetic most likely to be got half right.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_STRIP_RATIO,
  MAX_TIMELINE_STRIPS,
  STRIP_CSS_HEIGHT,
  STRIP_CSS_WIDTH,
  dayOf,
  decisionOutcome,
  decisionOutcomes,
  elapsedDays,
  longestOpenOutcome,
  nextActionSentence,
  stripGeometry,
  stripRatio,
  timelineCaption,
  timelineName,
  timelineSummary,
} from "../src/decision-timeline.js";

// The record shapes toHistoryRecords composes, hand-built so the fields that
// decide an outcome stay visible in the test.
const decision = (id, createdAt, status = "accepted", links = []) => ({
  type: "decision", id, title: `Decision ${id}`, status, createdAt, links,
});
const release = (id, createdAt, label = id) => ({ type: "release", id, title: label, createdAt });
const shipped = (id, createdAt, releaseId, label) => decision(id, createdAt, "accepted", [
  { type: "release", id: releaseId, label },
]);

const NOW = Date.parse("2026-06-30T12:00:00.000Z");

test("a day is a UTC calendar day, and an unreadable instant belongs to none", () => {
  assert.equal(dayOf("2026-06-01T23:59:59.999Z"), "2026-06-01");
  assert.equal(dayOf("2026-06-02T00:00:00.000Z"), "2026-06-02");
  assert.equal(dayOf("not a date"), "");
});

test("elapsed days count calendar days, not 24-hour windows", () => {
  // Two hours apart across midnight is one day, which is what a reader counting
  // dates on a calendar sees.
  assert.equal(elapsedDays("2026-06-01T23:00:00.000Z", "2026-06-02T01:00:00.000Z"), 1);
  assert.equal(elapsedDays("2026-06-01T00:00:00.000Z", "2026-06-12T00:00:00.000Z"), 11);
  assert.equal(elapsedDays("2026-06-01T00:00:00.000Z", "2026-06-01T23:00:00.000Z"), 0);
  // A release dated before the decision is a data problem, and it is reported as
  // one rather than clamped to zero.
  assert.equal(elapsedDays("2026-06-12T00:00:00.000Z", "2026-06-01T00:00:00.000Z"), -11);
  assert.equal(elapsedDays("2026-06-01T00:00:00.000Z", "nope"), null);
});

test("a shipped decision carries both dates and the span between them", () => {
  const outcome = decisionOutcome(shipped("d1", "2026-06-01T09:00:00.000Z", "r1", "v2.1"), {
    releasesById: new Map([["r1", release("r1", "2026-06-12T17:00:00.000Z")]]),
    now: NOW,
  });
  assert.deepEqual(
    { recordedOn: outcome.recordedOn, releasedOn: outcome.releasedOn, days: outcome.days, open: outcome.open },
    { recordedOn: "2026-06-01", releasedOn: "2026-06-12", days: 11, open: false },
  );
  assert.equal(outcome.release.label, "v2.1");
});

test("an accepted decision with no release is open, and its span runs to now", () => {
  const outcome = decisionOutcome(decision("d2", "2026-06-01T00:00:00.000Z"), { now: NOW });
  assert.equal(outcome.open, true);
  assert.equal(outcome.release, null);
  assert.equal(outcome.days, 29, "recorded Jun 1, open through Jun 30");
});

test("only shipped and accepted-but-open decisions have an outcome to draw", () => {
  const options = { now: NOW };
  // Proposed and pending have not started the span this figure measures, and a
  // superseded decision ended somewhere other than a release.
  for (const status of ["proposed", "pending", "superseded"]) {
    assert.equal(decisionOutcome(decision("d", "2026-06-01T00:00:00.000Z", status), options), null, status);
  }
  // ...but any of them that a release actually carried does have one.
  assert.ok(decisionOutcome(decision("d", "2026-06-01T00:00:00.000Z", "superseded", [
    { type: "release", id: "r1", label: "v1.0" },
  ]), options));
  assert.equal(decisionOutcome(release("r1", "2026-06-01T00:00:00.000Z"), options), null, "a release is not a decision");
  assert.equal(decisionOutcome(decision("d", "not a date"), options), null, "an undatable record cannot be drawn");
});

test("outcomes are newest first and capped, and the total still counts the rest", () => {
  const records = [
    release("r1", "2026-06-12T00:00:00.000Z"),
    ...["01", "02", "03", "04", "05", "06", "07"].map((day) => shipped(`d${day}`, `2026-06-${day}T00:00:00.000Z`, "r1", "v2.1")),
  ];
  const { shown, total } = decisionOutcomes(records, { now: NOW });
  assert.equal(total, 7);
  assert.equal(shown.length, MAX_TIMELINE_STRIPS);
  assert.deepEqual(shown.map(({ id }) => id), ["d07", "d06", "d05", "d04", "d03"]);
  assert.equal(decisionOutcomes(records, { now: NOW, max: 2 }).shown.length, 2);
});

test("a filtered-away release still dates the decision it carried", () => {
  const releases = [release("r1", "2026-06-12T00:00:00.000Z")];
  const listed = [shipped("d1", "2026-06-01T00:00:00.000Z", "r1", "v2.1")];
  // The release row is not in the view; the decision's span is unchanged.
  const { shown } = decisionOutcomes(listed, { now: NOW, releases: [...listed, ...releases] });
  assert.equal(shown[0].days, 11);
  // Without the lookup set, the date genuinely cannot be read, and the sentence
  // says so instead of inventing one.
  const blind = decisionOutcomes(listed, { now: NOW });
  assert.equal(blind.shown[0].days, null);
  assert.match(timelineCaption(blind.shown[0]), /the release date could not be read\.$/);
});

test("the longest open decision is one decision, chosen by wait and then by date", () => {
  const { shown } = decisionOutcomes([
    decision("newer", "2026-06-20T00:00:00.000Z"),
    decision("oldest", "2026-06-02T00:00:00.000Z"),
    decision("tied", "2026-06-02T00:00:00.000Z"),
    shipped("done", "2026-06-01T00:00:00.000Z", "r1", "v2.1"),
    release("r1", "2026-06-03T00:00:00.000Z"),
  ], { now: NOW });
  const longest = longestOpenOutcome(shown);
  assert.equal(longest.id, "oldest", "the shipped decision is never the open one");
  assert.equal(longest.days, 28);
  assert.equal(longestOpenOutcome([]), null);
  assert.equal(longestOpenOutcome(shown.filter((outcome) => !outcome.open)), null, "no open decision, no callout");
});

test("every fact in the drawing is in the caption, and the name repeats it", () => {
  const releases = new Map([["r1", release("r1", "2026-06-12T00:00:00.000Z")]]);
  const closed = decisionOutcome(shipped("d1", "2026-06-01T00:00:00.000Z", "r1", "v2.1"), { releasesById: releases, now: NOW });
  assert.equal(
    timelineCaption(closed),
    "“Decision d1” — recorded Jun 1, 2026, accepted, shipped in v2.1 on Jun 12, 2026, 11 days from recorded to release.",
  );
  assert.equal(timelineName(closed), `Timeline: ${timelineCaption(closed)}`);
  const open = decisionOutcome(decision("d2", "2026-06-29T00:00:00.000Z"), { now: NOW });
  assert.equal(timelineCaption(open), "“Decision d2” — recorded Jun 29, 2026, accepted, no release linked yet, open 1 day.");
  const backwards = decisionOutcome(shipped("d3", "2026-06-12T00:00:00.000Z", "r0", "v1.9"), {
    releasesById: new Map([["r0", release("r0", "2026-06-01T00:00:00.000Z")]]),
    now: NOW,
  });
  assert.match(timelineCaption(backwards), /dated 11 days before the decision was recorded\.$/);
});

test("the summary says what is on screen and what is not", () => {
  assert.equal(timelineSummary({ shown: 0, total: 0 }), "No decision in this view has a release outcome yet.");
  assert.equal(timelineSummary({ shown: 1, total: 1 }), "1 decision with a release outcome.");
  assert.equal(timelineSummary({ shown: 5, total: 5 }), "5 decisions with a release outcome.");
  assert.equal(
    timelineSummary({ shown: 5, total: 12 }),
    "Showing the 5 most recently recorded of 12 decisions with a release outcome.",
  );
});

test("the next action names the decision, its date, and how long it has waited", () => {
  const outcome = decisionOutcome(decision("d1", "2026-06-02T00:00:00.000Z"), { now: NOW });
  assert.equal(
    nextActionSentence(outcome),
    "Settle “Decision d1” — accepted, recorded Jun 2, 2026, and open 28 days,"
    + " the longest wait of any accepted decision without a release.",
  );
  assert.equal(nextActionSentence(null), "");
});

test("the backing-store ratio is clamped, and an unreported ratio is 1", () => {
  assert.equal(stripRatio(1), 1);
  assert.equal(stripRatio(1.5), 1.5);
  assert.equal(stripRatio(3), MAX_STRIP_RATIO, "a 3x phone is drawn at 2x rather than tripling the bitmap");
  assert.equal(stripRatio(0.5), 1, "a zoomed-out browser still gets a full-resolution store");
  for (const unknown of [undefined, null, NaN, Infinity, 0, -2, "2"]) assert.equal(stripRatio(unknown), 1, String(unknown));
});

test("a shipped strip at 1x is exactly these device pixels", () => {
  const outcome = decisionOutcome(shipped("d1", "2026-06-01T00:00:00.000Z", "r1", "v2.1"), {
    releasesById: new Map([["r1", release("r1", "2026-06-12T00:00:00.000Z")]]),
    now: NOW,
  });
  const geometry = stripGeometry(outcome, { ratio: 1 });
  assert.deepEqual(
    { w: geometry.deviceWidth, h: geometry.deviceHeight, cw: geometry.cssWidth, ch: geometry.cssHeight },
    { w: STRIP_CSS_WIDTH, h: STRIP_CSS_HEIGHT, cw: STRIP_CSS_WIDTH, ch: STRIP_CSS_HEIGHT },
  );
  assert.deepEqual(geometry.track, { x: 10, y: 13, width: 300, height: 2 });
  assert.deepEqual(geometry.marks, [
    { kind: "recorded", shape: "cap", x: 10, width: 2, height: 12, y: 8 },
    { kind: "status", shape: "dot", x: 160, y: 14, radius: 4 },
    { kind: "released", shape: "cap", x: 308, width: 2, height: 12, y: 8 },
  ]);
  assert.deepEqual(geometry.dashes, [], "a shipped strip does not trail off");
});

test("2x doubles the store and every coordinate in it, and the CSS box is unchanged", () => {
  const outcome = decisionOutcome(shipped("d1", "2026-06-01T00:00:00.000Z", "r1", "v2.1"), {
    releasesById: new Map([["r1", release("r1", "2026-06-12T00:00:00.000Z")]]),
    now: NOW,
  });
  const geometry = stripGeometry(outcome, { ratio: 2 });
  assert.equal(geometry.scale, 2);
  assert.deepEqual({ w: geometry.deviceWidth, h: geometry.deviceHeight }, { w: 640, h: 56 });
  // The element still occupies the same box: the pair is what makes it sharp
  // rather than twice as large.
  assert.deepEqual({ cw: geometry.cssWidth, ch: geometry.cssHeight }, { cw: 320, ch: 28 });
  assert.deepEqual(geometry.track, { x: 20, y: 26, width: 600, height: 4 });
  assert.deepEqual(geometry.marks, [
    { kind: "recorded", shape: "cap", x: 20, width: 4, height: 24, y: 16 },
    { kind: "status", shape: "dot", x: 320, y: 28, radius: 8 },
    { kind: "released", shape: "cap", x: 616, width: 4, height: 24, y: 16 },
  ]);
});

test("an open strip stops short, has no end cap, and trails off in dashes", () => {
  const geometry = stripGeometry(decisionOutcome(decision("d2", "2026-06-01T00:00:00.000Z"), { now: NOW }), { ratio: 1 });
  assert.equal(geometry.open, true);
  assert.deepEqual(geometry.track, { x: 10, y: 13, width: 150, height: 2 });
  assert.deepEqual(geometry.marks.map(({ kind }) => kind), ["recorded", "status"]);
  assert.deepEqual(geometry.dashes, [{ x: 163, width: 4 }, { x: 170, width: 4 }, { x: 177, width: 4 }]);
  // Every dash is inside the store, so nothing is drawn into a clipped column.
  for (const dash of geometry.dashes) assert.ok(dash.x + dash.width <= geometry.deviceWidth);
});
