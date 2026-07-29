// Carrying one personal AI-history reading forward to the next.
//
// HOW THIS SUITE IS ARGUED. Every reading here is produced by the real reader
// from one of Theo's benchmark periods or fixtures, so no expectation is a
// figure recorded from a run: the periods carry 7.8, 6.0, and 4.2 points per
// scored prompt on the same leading move, derived in
// tests/personal-history-evaluation.test.js from the labelled prompts, and the
// deltas below are subtractions a reviewer can do on this page.
//
// THE DIRECTION IS PINNED TO THE FIXTURES' OWN. `evalPeriodTrend` states the
// same arithmetic over a list of reports and was shipped before this module
// existed. The production path re-implements it over a stored summary rather
// than importing it — a src module must not import a fixture — so one test
// compares the two on the same periods. A change to either that does not move
// the other fails there.
//
// WHAT A FAILURE HERE MEANS. A direction or delta failure is arithmetic. A state
// failure is the precedence in `CARRY_FORWARD_PRECEDENCE` no longer being total.
// A safety failure is neither: it is prompt text, a calendar date, or a
// forbidden field reaching browser storage, which outlives the tab and is the
// one defect in this area that ships harm rather than a wrong number.
//
// NOTHING HERE IS REAL. Every export is generated in-test from the bundled
// synthetic prompts, and every storage object is a fake built in this file.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, DomEvent, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { buildPersonalHistoryReport } from "../src/personal-history-report.js";
import { PERSONAL_BOUNDARY, PERSONAL_PERSISTED } from "../src/personal-history-contract.js";
import {
  EVAL_BENCHMARK_PERIODS, EVAL_FIXTURES, EVAL_VERSION_PINS, buildEvalExport, evalDays,
  evalFixtureExport, evalPeriodTrend,
} from "../src/personal-history-eval-fixtures.js";
import {
  CARRY_FORWARD_BASIS, CARRY_FORWARD_BOUNDARY, CARRY_FORWARD_DIRECTION, CARRY_FORWARD_FAULT,
  CARRY_FORWARD_ORIGIN, CARRY_FORWARD_PRECEDENCE, CARRY_FORWARD_REASON, CARRY_FORWARD_REASON_RULE,
  CARRY_FORWARD_STATE, CARRY_FORWARD_STORAGE, CARRY_FORWARD_SUMMARY_FIELDS, CARRY_FORWARD_VERSION,
  CARRY_FORWARD_VERSION_PINS, assertNoCarriedPromptText, carryForward, carryForwardSummary,
  clearCarriedSummary, compareWithCarriedSummary, readCarriedSummary, validateCarriedSummary,
  writeCarriedSummary,
} from "../src/personal-history-carry-forward.js";

const PAGE = new URL("../src/personal-history.html", import.meta.url);

/** A storage object with the three methods this module uses, and nothing else. */
function fakeStorage(seed = null) {
  const values = new Map(seed === null ? [] : [[CARRY_FORWARD_STORAGE.key, seed]]);
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    raw: () => values.get(CARRY_FORWARD_STORAGE.key) ?? null,
    keys: () => [...values.keys()],
  };
}

/** A browser that refuses storage outright, the way a private window does. */
const hostileStorage = () => ({
  getItem() { throw new DOMExceptionLike("denied"); },
  setItem() { throw new DOMExceptionLike("denied"); },
  removeItem() { throw new DOMExceptionLike("denied"); },
});

/** A readable browser slot whose privacy/quota policy refuses mutations. */
const readOnlyStorage = (seed = null) => ({
  getItem: () => seed,
  setItem() { throw new DOMExceptionLike("denied"); },
  removeItem() { throw new DOMExceptionLike("denied"); },
});

class DOMExceptionLike extends Error {}

const periodReport = (id) =>
  buildPersonalHistoryReport(evalFixtureExport(EVAL_BENCHMARK_PERIODS.find((p) => p.id === id)));
const fixtureReport = (id) =>
  buildPersonalHistoryReport(evalFixtureExport(EVAL_FIXTURES.find((f) => f.id === id)));
const singleBlockReport = (prompt, month) => buildPersonalHistoryReport(
  buildEvalExport({ blocks: [{ prompt, count: 20 }], days: evalDays(month, 5) }));

/* ------------------------------ provenance ------------------------------- */

test("a summary is pinned to the three versions its figures were computed under", () => {
  assert.deepEqual(CARRY_FORWARD_VERSION_PINS, {
    report: EVAL_VERSION_PINS.report,
    rubric: EVAL_VERSION_PINS.rubric,
    classifier: EVAL_VERSION_PINS.classifier,
  }, "the pins this module compares against are the ones the fixtures were labelled under");

  const summary = carryForwardSummary(periodReport("2026-04"));
  assert.deepEqual(Object.keys(summary).sort(), [...CARRY_FORWARD_SUMMARY_FIELDS].sort());
  assert.equal(summary.schemaVersion, CARRY_FORWARD_VERSION);
  assert.equal(summary.reportVersion, EVAL_VERSION_PINS.report);
  assert.equal(summary.rubricVersion, EVAL_VERSION_PINS.rubric);
  assert.equal(summary.classifierVersion, EVAL_VERSION_PINS.classifier);
  assert.equal(summary.origin, CARRY_FORWARD_ORIGIN.ownExport);
  assert.equal(summary.reading, 1);
  assert.deepEqual(validateCarriedSummary(summary).errors, []);
});

/* -------------------------------- safety --------------------------------- */

test("a marker in every prompt reaches no field of the stored summary", () => {
  const marker = "kx4-marker-not-in-any-summary";
  const conversations = evalDays("2026-05", 6).flatMap((date) => Array.from({ length: 5 }, (unused, at) => ({
    create_time: `${date}T09:0${at}:00Z`,
    messages: [{ role: "user", content: `Context: ${marker} number ${at}.\nRequest: draft the ${marker} note.` }],
  })));
  const report = buildPersonalHistoryReport(JSON.stringify({ conversations }));
  assert.equal(report.state, "prioritized");

  const storage = fakeStorage();
  const { stored } = carryForward(report, storage);
  assert.equal(stored.written, true);

  const raw = storage.raw();
  assert.equal(raw.includes(marker), false, "prompt text reached browser storage");
  assert.equal(assertNoCarriedPromptText(JSON.parse(raw), marker), true);
  assert.deepEqual(storage.keys(), [CARRY_FORWARD_STORAGE.key], "more than one key was written");
});

test("no calendar date is stored, in any field, from an export full of them", () => {
  const storage = fakeStorage();
  carryForward(periodReport("2026-03"), storage);
  const raw = storage.raw();
  // The period is an ordinal precisely so this assertion can be made: the export
  // behind it carries five dated days and none of them survive the summary.
  assert.doesNotMatch(raw, /\d{4}-\d{2}-\d{2}/, "a calendar date reached browser storage");
  assert.equal(CARRY_FORWARD_BOUNDARY.retainsDates, false);
  assert.equal(CARRY_FORWARD_BOUNDARY.retainsPromptText, false);
  assert.equal(CARRY_FORWARD_BOUNDARY.slotsKept, 1);
});

test("the report boundary states what this browser keeps, rather than none", () => {
  const report = periodReport("2026-04");
  assert.equal(report.boundary.persisted, PERSONAL_PERSISTED);
  assert.equal(PERSONAL_BOUNDARY.persisted, PERSONAL_PERSISTED);
  assert.notEqual(PERSONAL_BOUNDARY.persisted, "none",
    "a boundary that says none beside code that writes a key is the failure this contract prevents");
  assert.match(report.eligibility.boundary, /derived summary of the reading/);
  // A refusal is still the old promise, in full: nothing read, nothing kept.
  const refused = fixtureReport("below-the-day-floor");
  assert.match(refused.eligibility.boundary, /A refusal stores nothing, replaces no summary/);
});

/* ------------------------------ first reading ---------------------------- */

test("the first reading is compared with nothing and is otherwise unchanged", () => {
  const storage = fakeStorage();
  const report = periodReport("2026-03");
  const { comparison, stored } = carryForward(report, storage);

  assert.equal(comparison.state, CARRY_FORWARD_STATE.firstReading);
  assert.equal(comparison.reason, CARRY_FORWARD_REASON.noPriorSummary);
  assert.equal(comparison.reasonRule, CARRY_FORWARD_REASON_RULE[CARRY_FORWARD_REASON.noPriorSummary]);
  assert.equal(comparison.comparable, false);
  assert.equal(comparison.previous, null);
  assert.equal(comparison.delta, null);

  // The reading itself is the product and is not touched by any of this.
  assert.deepEqual(report, periodReport("2026-03"));
  assert.equal(stored.written, true);
  assert.equal(JSON.parse(storage.raw()).reading, 1);
});

test("the ordinal counts readings and only a named move advances it", () => {
  const storage = fakeStorage();
  carryForward(periodReport("2026-03"), storage);
  carryForward(periodReport("2026-04"), storage);
  assert.equal(JSON.parse(storage.raw()).reading, 2);

  const before = storage.raw();
  const refusal = carryForward(fixtureReport("below-the-day-floor"), storage);
  assert.equal(refusal.stored.written, false);
  assert.equal(storage.raw(), before, "a refusal replaced the summary already carried");

  carryForward(periodReport("2026-05"), storage);
  assert.equal(JSON.parse(storage.raw()).reading, 3);
});

/* -------------------------------- compatible ------------------------------ */

test("a second reading of the same move is a delta on cost per request", () => {
  const storage = fakeStorage();
  carryForward(periodReport("2026-03"), storage);
  const { comparison } = carryForward(periodReport("2026-04"), storage);

  assert.equal(comparison.state, CARRY_FORWARD_STATE.compatible);
  assert.equal(comparison.reason, null);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.moveId, "intent-states-acceptance");
  assert.equal(comparison.previous.pointsPerScoredPrompt, 7.8);
  assert.equal(comparison.current.pointsPerScoredPrompt, 6);
  assert.equal(comparison.delta.pointsPerScoredPrompt, -1.8);
  assert.equal(comparison.delta.direction, CARRY_FORWARD_DIRECTION.improving);
  assert.equal(comparison.previous.reading, 1);
  assert.equal(comparison.current.reading, 2);
  // One person, twice. Never anybody else, in any state.
  assert.equal(comparison.basis.population, 1);
  assert.equal(comparison.basis, CARRY_FORWARD_BASIS);
});

test("the same habit costing more is reported as costing more", () => {
  const storage = fakeStorage();
  carryForward(periodReport("2026-05"), storage);
  const { comparison } = carryForward(periodReport("2026-03"), storage);
  assert.equal(comparison.delta.direction, CARRY_FORWARD_DIRECTION.worsening);
  assert.equal(comparison.delta.pointsPerScoredPrompt, 3.6);
});

test("twice the prompts at the same cost per prompt is flat, not an improvement", () => {
  // The whole argument for the per-prompt figure: `twice-the-floor` carries
  // double the points of `clean-at-the-floor` on double the prompts. A total
  // would read as a collapse; the cost of the habit did not move at all.
  const storage = fakeStorage();
  carryForward(fixtureReport("clean-at-the-floor"), storage);
  const { comparison } = carryForward(fixtureReport("twice-the-floor"), storage);

  assert.equal(comparison.delta.direction, CARRY_FORWARD_DIRECTION.flat);
  assert.equal(comparison.delta.pointsPerScoredPrompt, 0);
  assert.equal(comparison.previous.scoredPrompts, 20);
  assert.equal(comparison.current.scoredPrompts, 40);
  // The weaker of the two levels binds: one end of this comparison is a reading
  // at the floor, and averaging the two would invent a level neither earned.
  assert.equal(comparison.previous.confidence, "low");
  assert.equal(comparison.current.confidence, "moderate");
  assert.equal(comparison.delta.basisConfidence, "low");
});

test("the direction is the one the shipped fixtures already state", () => {
  const reports = [periodReport("2026-03"), periodReport("2026-04")];
  const trend = evalPeriodTrend(reports);

  const storage = fakeStorage();
  carryForward(reports[0], storage);
  const { comparison } = carryForward(reports[1], storage);

  assert.equal(trend.direction, comparison.delta.direction);
  assert.equal(trend.moveId, comparison.moveId);
  assert.deepEqual(
    trend.series.map((entry) => entry.pointsPerScoredPrompt),
    [comparison.previous.pointsPerScoredPrompt, comparison.current.pointsPerScoredPrompt],
    "the production path and the fixture path disagree on the compared figure",
  );
});

/* ------------------------------- incompatible ----------------------------- */

test("a different leading move is refused rather than charted", () => {
  const storage = fakeStorage();
  carryForward(singleBlockReport("context-and-notes", "2026-03"), storage);
  const { comparison } = carryForward(singleBlockReport("fully-stated", "2026-04"), storage);

  assert.equal(comparison.state, CARRY_FORWARD_STATE.incompatible);
  assert.equal(comparison.reason, CARRY_FORWARD_REASON.leadingMoveChanged);
  assert.equal(comparison.comparable, false);
  assert.equal(comparison.delta, null, "two habits' costs were put on one line");
  // Both sides are still named, because "the thing worth changing first has
  // changed" is the reading, and a reader is owed what it changed from.
  assert.equal(comparison.previous.pointsPerScoredPrompt, 9);
  assert.equal(comparison.current.pointsPerScoredPrompt, 3);
  // The new reading takes the slot: the next comparison is against this one.
  assert.equal(JSON.parse(storage.raw()).moveId, "intent-pasted-context");
});

test("a summary written under a different version is not compared", () => {
  const base = carryForwardSummary(periodReport("2026-03"));
  const cases = [
    [{ schemaVersion: "personal-history-carry-forward/0.9.0" }, CARRY_FORWARD_REASON.schemaChanged],
    [{ reportVersion: "personal-history-report/0.9.0" }, CARRY_FORWARD_REASON.contractChanged],
    [{ rubricVersion: "literacy-mix/0.9.0" }, CARRY_FORWARD_REASON.rubricChanged],
    [{ classifierVersion: "prompt-prose-classifier/0.9.0" }, CARRY_FORWARD_REASON.rubricChanged],
  ];
  for (const [drift, reason] of cases) {
    const storage = fakeStorage(JSON.stringify({ ...base, ...drift }));
    const { comparison, stored } = carryForward(periodReport("2026-04"), storage);
    assert.equal(comparison.state, CARRY_FORWARD_STATE.incompatible, JSON.stringify(drift));
    assert.equal(comparison.reason, reason, JSON.stringify(drift));
    assert.equal(comparison.delta, null);
    // The stale value is replaced by one this build can read, so the drift
    // costs exactly one comparison rather than every comparison after it.
    assert.equal(stored.written, true);
    assert.equal(JSON.parse(storage.raw()).schemaVersion, CARRY_FORWARD_VERSION);
    assert.equal(JSON.parse(storage.raw()).reading, 1);
  }
});

test("a value this build does not recognize is discarded, never read loosely", () => {
  const base = carryForwardSummary(periodReport("2026-03"));
  const values = [
    "not json at all",
    "[]",
    "null",
    JSON.stringify({ ...base, moveId: "" }),
    JSON.stringify({ ...base, scoredPrompts: 0 }),
    JSON.stringify({ ...base, coverage: 1.4 }),
    JSON.stringify({ ...base, reading: 0 }),
    JSON.stringify({ ...base, origin: CARRY_FORWARD_ORIGIN.workedExample }),
    JSON.stringify({ ...base, extra: "a field nobody declared" }),
    `"${"x".repeat(CARRY_FORWARD_STORAGE.maxBytes)}"`,
  ];
  for (const value of values) {
    const storage = fakeStorage(value);
    const { comparison } = carryForward(periodReport("2026-04"), storage);
    assert.equal(comparison.state, CARRY_FORWARD_STATE.incompatible, value.slice(0, 40));
    assert.equal(comparison.reason, CARRY_FORWARD_REASON.unreadablePriorSummary, value.slice(0, 40));
  }
});

/* --------------------------- insufficient evidence ------------------------ */

test("a reading that names no move is compared with nothing and replaces nothing", () => {
  const storage = fakeStorage();
  carryForward(periodReport("2026-03"), storage);
  const before = storage.raw();

  for (const report of [fixtureReport("below-the-day-floor"), buildPersonalHistoryReport("not an export")]) {
    const { comparison, stored } = carryForward(report, storage);
    assert.equal(comparison.state, CARRY_FORWARD_STATE.insufficientEvidence);
    assert.equal(comparison.reason, CARRY_FORWARD_REASON.readingNamesNoMove);
    assert.equal(comparison.current, null);
    assert.equal(comparison.delta, null);
    // The previous reading is still named: a reader whose second file was thin
    // has not lost the figure their first one produced.
    assert.equal(comparison.previous.pointsPerScoredPrompt, 7.8);
    assert.equal(stored.written, false);
    assert.equal(storage.raw(), before);
  }
});

test("a browser that refuses storage costs the comparison and nothing else", () => {
  const report = periodReport("2026-04");
  for (const storage of [hostileStorage(), null, {}]) {
    const { comparison, stored } = carryForward(report, storage);
    assert.equal(comparison.state, CARRY_FORWARD_STATE.insufficientEvidence);
    assert.equal(comparison.reason, CARRY_FORWARD_REASON.storageUnavailable);
    assert.equal(stored.written, false);
    assert.equal(stored.fault, CARRY_FORWARD_FAULT.unavailable);
  }
  // The reading is untouched by every one of those, which is the property that
  // makes this a line beside the answer rather than part of it.
  assert.deepEqual(report, periodReport("2026-04"));
});

test("a first reading is not called carried forward when its write is denied", () => {
  const report = periodReport("2026-04");
  const { comparison, stored } = carryForward(report, readOnlyStorage());

  assert.equal(stored.written, false);
  assert.equal(stored.fault, CARRY_FORWARD_FAULT.unavailable);
  assert.equal(comparison.state, CARRY_FORWARD_STATE.insufficientEvidence);
  assert.equal(comparison.reason, CARRY_FORWARD_REASON.storageUnavailable);
  assert.doesNotMatch(comparison.reasonRule, /first reading this browser has carried forward/);
  assert.deepEqual(report, periodReport("2026-04"),
    "a denied carry-forward write must not cost the reader their current result");
});

/* ------------------------------ the worked example ------------------------ */

test("the worked example is never carried forward and never compared", () => {
  const storage = fakeStorage();
  const report = periodReport("2026-04");
  assert.equal(carryForwardSummary(report, { origin: CARRY_FORWARD_ORIGIN.workedExample }), null);

  const { stored } = carryForward(report, storage, { origin: CARRY_FORWARD_ORIGIN.workedExample });
  assert.equal(stored.written, false);
  assert.equal(storage.raw(), null, "an invented person reached this browser's storage");
});

/* ------------------------------- the precedence --------------------------- */

test("every reason has a state, a published sentence, and a place in the precedence", () => {
  const reasons = Object.values(CARRY_FORWARD_REASON);
  assert.deepEqual([...CARRY_FORWARD_PRECEDENCE].sort(), [...reasons].sort(),
    "the precedence is not total over the reason codes");
  for (const reason of reasons) {
    assert.ok(CARRY_FORWARD_REASON_RULE[reason]?.length > 60, `${reason} publishes no sentence`);
  }
  // Storage before slot contents before the reading, so a browser that refuses
  // storage is never reported as a reader who has not read before.
  assert.equal(CARRY_FORWARD_PRECEDENCE[0], CARRY_FORWARD_REASON.storageUnavailable);
  assert.equal(CARRY_FORWARD_PRECEDENCE[1], CARRY_FORWARD_REASON.noPriorSummary);
});

test("the storage functions refuse anything they would not read back", () => {
  const storage = fakeStorage();
  const summary = carryForwardSummary(periodReport("2026-03"));

  assert.deepEqual(writeCarriedSummary(storage, { ...summary, moveId: 7 }),
    { written: false, fault: CARRY_FORWARD_FAULT.rejected });
  assert.equal(storage.raw(), null);

  assert.equal(writeCarriedSummary(storage, summary).written, true);
  assert.deepEqual(readCarriedSummary(storage).summary, summary);
  assert.equal(clearCarriedSummary(storage).cleared, true);
  assert.equal(readCarriedSummary(storage).reason, CARRY_FORWARD_REASON.noPriorSummary);
});

test("a comparison is a pure function of a reading and a slot", () => {
  const slot = readCarriedSummary(fakeStorage(JSON.stringify(carryForwardSummary(periodReport("2026-03")))));
  const once = compareWithCarriedSummary(periodReport("2026-04"), slot);
  const twice = compareWithCarriedSummary(periodReport("2026-04"), slot);
  assert.deepEqual(once, twice);
  assert.equal(Object.isFrozen(once), true);
});

/* --------------------------------- the page -------------------------------- */

test("two readings on the shipped page produce a comparison, and Clear deletes it", async () => {
  const page = await loadPage(PAGE);
  try {
    await importPageModule("/personal-history-page.js");
    const document = page.document;
    const input = document.getElementById("personal-history-file");
    const readFileNamed = async (text) => {
      input.files = [{ name: "export.json", size: text.length, text: async () => text }];
      input.dispatchEvent(new DomEvent("change", { bubbles: true }));
      await waitFor(() => document.querySelector(".ph-report"));
    };

    await readFileNamed(evalFixtureExport(EVAL_BENCHMARK_PERIODS[0]));
    const first = document.querySelector(".ph-carry");
    assert.equal(first.dataset.carry, CARRY_FORWARD_STATE.firstReading);
    assert.match(textOf(first), /first reading this browser has carried forward/);

    await readFileNamed(evalFixtureExport(EVAL_BENCHMARK_PERIODS[1]));
    const second = document.querySelector(".ph-carry");
    assert.equal(second.dataset.carry, CARRY_FORWARD_STATE.compatible);
    assert.match(textOf(second), /costs you less on an average request/);
    assert.ok(globalThis.localStorage.getItem(CARRY_FORWARD_STORAGE.key),
      "the page kept no summary to compare the next reading with");

    document.getElementById("personal-history-clear").click();
    assert.equal(globalThis.localStorage.getItem(CARRY_FORWARD_STORAGE.key), null,
      "Clear emptied the page and left a summary of the reader's history behind");
  } finally {
    page.restore();
  }
});

test("Clear does not claim deletion when browser storage refuses it", async () => {
  const page = await loadPage(PAGE);
  try {
    const seeded = JSON.stringify(carryForwardSummary(periodReport("2026-03")));
    globalThis.localStorage = readOnlyStorage(seeded);
    await importPageModule("/personal-history-page.js");

    page.document.getElementById("personal-history-clear").click();

    assert.equal(globalThis.localStorage.getItem(CARRY_FORWARD_STORAGE.key), seeded);
    assert.match(textOf(page.document.getElementById("personal-history-status")),
      /would not let the page delete/i);
    assert.doesNotMatch(textOf(page.document.getElementById("personal-history-status")),
      /was deleted/i);
  } finally {
    page.restore();
  }
});
