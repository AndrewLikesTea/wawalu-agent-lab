// The committed baseline count, and the one place three counts are ranked.
//
// Issue #1820: a browser arriving for the first time, rate-limited or offline,
// used to be shown a sentence where the site's one checkable figure belongs.
// What is pinned here is that the record it now falls back to is a real dated
// count rather than a placeholder, and that the ordering around it lives in one
// function — so the home page and the Agent observatory cannot rank one set of
// counts two ways.
//
// Nothing in this file opens a socket or touches a page.

import assert from "node:assert/strict";
import test from "node:test";
import { PR_COUNT_BASELINE, PR_COUNT_BASELINE_SCHEMA, baselineCountRecord } from "../src/pr-count-baseline.js";
import {
  BASELINE_LEAD, MERGED_COUNT_SOURCES, resolveMergedCount,
} from "../src/merged-count-resolution.js";
import { SOURCE_REPOSITORIES } from "../src/public-merges.js";

const record = (count, takenAt) => ({ count, takenAt: new Date(takenAt) });

test("the committed baseline is a real count, taken at a stated instant", () => {
  assert.equal(PR_COUNT_BASELINE.schemaVersion, PR_COUNT_BASELINE_SCHEMA);
  assert.ok(Number.isInteger(PR_COUNT_BASELINE.total) && PR_COUNT_BASELINE.total >= 0,
    "the baseline must carry a whole count, not a placeholder");
  // ISO-8601 in UTC, so the date a reader is shown and the date the record holds
  // cannot drift, and it is unambiguous outside the writer's locale.
  assert.match(PR_COUNT_BASELINE.countedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(PR_COUNT_BASELINE.countedAt).toISOString(), PR_COUNT_BASELINE.countedAt);
  assert.ok(new Date(PR_COUNT_BASELINE.countedAt).getTime() <= Date.now(),
    "a count cannot have been taken in the future");
  assert.ok(Number.isInteger(PR_COUNT_BASELINE.eventsPerFeed) && PR_COUNT_BASELINE.eventsPerFeed > 0,
    "the window the count was taken over has to be stated, since the feed is a window");
});

test("the total is the per-repository counts added up, and covers every feed the page links", () => {
  const counted = Object.entries(PR_COUNT_BASELINE.repositories);
  for (const [repository, count] of counted) {
    assert.ok(Number.isInteger(count) && count >= 0, `${repository} must carry a whole count`);
  }
  // Derived rather than typed twice: a hand-edited total reds this instead of
  // shipping a number that disagrees with the parts it claims to be made of.
  assert.equal(PR_COUNT_BASELINE.total, counted.reduce((sum, [, count]) => sum + count, 0));
  // And it is counted over exactly the feeds the figure links a reader to.
  assert.deepEqual(counted.map(([repository]) => repository).sort(), [...SOURCE_REPOSITORIES].sort());
});

test("the record is frozen, so nothing on a page can edit the published figure", () => {
  assert.equal(Object.isFrozen(PR_COUNT_BASELINE), true);
  assert.equal(Object.isFrozen(PR_COUNT_BASELINE.repositories), true);
});

test("the baseline reads back as a dated count record", () => {
  const baseline = baselineCountRecord();
  assert.equal(baseline.count, PR_COUNT_BASELINE.total);
  assert.equal(baseline.takenAt.toISOString(), PR_COUNT_BASELINE.countedAt);
});

test("an unpopulated or half-written baseline is no record at all, never a zero", () => {
  for (const payload of [
    null, {},
    { total: null, countedAt: null },
    { total: 4 },
    { countedAt: "2026-08-17T08:22:59.000Z" },
    { total: "4", countedAt: "2026-08-17T08:22:59.000Z" },
    { total: 4.5, countedAt: "2026-08-17T08:22:59.000Z" },
    { total: -1, countedAt: "2026-08-17T08:22:59.000Z" },
    { total: 4, countedAt: "sometime last week" },
    { total: 4, countedAt: 1755419999000 },
  ]) {
    assert.equal(baselineCountRecord(payload), null, JSON.stringify(payload) ?? "undefined");
  }
  // A counted zero is a real answer about merges and is kept, which is exactly
  // why "never counted" may not be spelled as one.
  assert.equal(baselineCountRecord({ total: 0, countedAt: "2026-08-17T08:22:59.000Z" }).count, 0);
});

test("the live count outranks everything, and nothing else renders beside it", () => {
  const shown = resolveMergedCount({
    live: { count: 7, asOf: new Date("2026-08-17T09:00:00.000Z") },
    retained: record(412, "2026-08-16T09:00:00.000Z"),
    published: record(400, "2026-08-15T09:00:00.000Z"),
    baseline: baselineCountRecord(),
  });

  assert.equal(shown.source, MERGED_COUNT_SOURCES.live);
  assert.equal(shown.count, 7);
  assert.equal(shown.takenAt.toISOString(), "2026-08-17T09:00:00.000Z");
  // One record, never a list: a surface cannot paint a second competing number
  // out of what this function returned.
  assert.deepEqual(Object.keys(shown).sort(), ["count", "source", "takenAt"]);
});

test("an earlier count beats the baseline even when the baseline was taken later", () => {
  const baseline = baselineCountRecord();
  const stale = record(412, "2020-01-01T00:00:00.000Z");
  assert.ok(stale.takenAt < baseline.takenAt, "the fixture must be older than the committed baseline");

  const shown = resolveMergedCount({ retained: stale, baseline });
  // Tier, not recency: a count this browser watched GitHub return is a stronger
  // claim about this reader's own view of the feeds than a number compiled in.
  assert.equal(shown.source, MERGED_COUNT_SOURCES.earlier);
  assert.equal(shown.count, 412);
});

test("of a retained and a published count, the later one wins", () => {
  const older = record(1, "2026-07-14T09:05:00.000Z");
  const newer = record(2, "2026-08-01T09:05:00.000Z");
  assert.equal(resolveMergedCount({ retained: older, published: newer }).count, 2);
  assert.equal(resolveMergedCount({ retained: newer, published: older }).count, 2);
});

test("the baseline is what a cold browser with no answer lands on", () => {
  const shown = resolveMergedCount({ baseline: baselineCountRecord() });
  assert.equal(shown.source, MERGED_COUNT_SOURCES.baseline);
  assert.equal(shown.count, PR_COUNT_BASELINE.total);
  assert.equal(shown.takenAt.toISOString(), PR_COUNT_BASELINE.countedAt);
});

test("a candidate that is not a whole dated count is not a candidate", () => {
  const baseline = baselineCountRecord();
  for (const attempt of [
    { count: 3 },
    { count: 3, takenAt: new Date("nonsense") },
    { count: 3, takenAt: "2026-07-14" },
    { count: 3.5, takenAt: new Date("2026-07-14T09:05:00.000Z") },
    { count: -1, takenAt: new Date("2026-07-14T09:05:00.000Z") },
    { count: "3", takenAt: new Date("2026-07-14T09:05:00.000Z") },
  ]) {
    assert.equal(resolveMergedCount({ live: attempt, baseline }).source, MERGED_COUNT_SOURCES.baseline,
      `${JSON.stringify(attempt)} was rendered as a live figure`);
    assert.equal(resolveMergedCount({ retained: attempt, baseline }).source, MERGED_COUNT_SOURCES.baseline,
      `${JSON.stringify(attempt)} was rendered as an earlier figure`);
  }
});

test("given nothing at all, it resolves to nothing rather than inventing a floor", () => {
  // The fallbacks are passed in, so a caller that supplies none gets none: this
  // is what keeps a render called by hand from painting a number nobody gave it.
  const shown = resolveMergedCount();
  assert.equal(shown.source, MERGED_COUNT_SOURCES.none);
  assert.equal(shown.count, null);
  assert.equal(shown.takenAt, null);
  assert.equal(resolveMergedCount({ live: null, retained: null, published: null, baseline: null }).source,
    MERGED_COUNT_SOURCES.none);
});

test("the baseline's words say it is not live, name both feeds, and hand over to the date", () => {
  assert.match(BASELINE_LEAD, /not a live count/);
  for (const repository of SOURCE_REPOSITORIES) assert.ok(BASELINE_LEAD.includes(repository));
  assert.match(BASELINE_LEAD, /as of $/, "the clause has to end handing over to the date it was taken");
  // No digit of its own: the only number in the state is the count itself.
  assert.doesNotMatch(BASELINE_LEAD, /\d/);
});
