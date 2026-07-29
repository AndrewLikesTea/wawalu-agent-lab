// The personal AI-history grade, held to figures written down before it ran.
//
// HOW THIS SUITE IS ARGUED. Every number a fixture expects is derived twice by
// different routes and the two are compared:
//
//   1. `EVAL_PROMPT_LABELS` records what the rubric finds in one prompt. The
//      first test pins those labels against the classifier itself, so a rubric
//      change fails here — one obvious failure — instead of quietly restating
//      every total below.
//   2. `expectedRanking` re-implements the published ranking rule from the
//      contract's words over those labels. The reader's own aggregation is never
//      consulted to produce an expectation, so a test comparing them is an
//      agreement check and not a tautology.
//   3. Confidence is re-derived from the report's own published basis using
//      `PERSONAL_CONFIDENCE_TIERS`, so the level is checked against the rule a
//      reader can read rather than against the branch that produced it.
//
// WHAT A FAILURE HERE MEANS. A pin failure is a scoring change that needs a
// human to re-derive the totals. A fixture failure with the pins intact is the
// reader disagreeing with the rubric it claims to use. A safety failure is
// neither: it is prompt text or a forbidden field reaching a report, which is
// the one defect in this area that ships harm rather than a wrong number.
//
// NOTHING HERE IS REAL. Every export is generated in-test from the bundled
// synthetic prompts; no file is committed, and no provider, customer, or
// telemetry data was available to this workflow or is used.

import test from "node:test";
import assert from "node:assert/strict";

import * as contract from "../src/personal-history-contract.js";
import {
  FORBIDDEN_REPORT_KEYS, PERSONAL_CONFIDENCE_TIERS, PERSONAL_COVERAGE_FLOOR,
  PERSONAL_COVERAGE_IDENTITY, PERSONAL_ELIGIBILITY, PERSONAL_HISTORY_VERSION,
  PERSONAL_REPORT_STATE, validatePersonalHistoryReport,
} from "../src/personal-history-contract.js";
import {
  PERSONAL_NO_PRIORITY, assertNoPromptText, buildPersonalHistoryReport, personalHistoryDate,
} from "../src/personal-history-report.js";
import { IMPROVEMENT_COPY, IMPROVEMENT_REWRITE, gradeMyPrompt } from "../src/prompt-coaching.js";
import {
  EVAL_BENCHMARK_PERIODS, EVAL_COVERAGE_TIERS, EVAL_FIXTURES, EVAL_PROMPT_LABELS, EVAL_UNREADABLE_TEXT,
  EVAL_VERSION_PINS, buildEvalExport, evalConversation, evalCoverageTier, evalDays,
  evalFixtureExport, evalPeriodTrend, expectedLeadMargin, expectedRanking,
} from "../src/personal-history-eval-fixtures.js";

const reportFor = (fixture) => buildPersonalHistoryReport(evalFixtureExport(fixture));

// ---------------------------------------------------------------------------
// The pins: what the fixtures were labelled against
// ---------------------------------------------------------------------------

test("every labelled prompt still grades to the moves and points recorded for it", () => {
  for (const row of EVAL_PROMPT_LABELS) {
    const graded = gradeMyPrompt({ text: row.text });
    assert.equal(graded.scored, true, `${row.key} stopped being gradeable`);
    assert.equal(graded.rubricVersionId, EVAL_VERSION_PINS.rubric, `${row.key}: rubric moved`);
    assert.equal(graded.classifierVersion, EVAL_VERSION_PINS.classifier, `${row.key}: classifier moved`);
    assert.deepEqual(
      graded.detail.improvements.map((entry) => ({
        id: entry.id, kind: entry.kind, axis: entry.axis, points: entry.points,
      })),
      row.moves.map((entry) => ({ ...entry })),
      `${row.key}: the label set no longer matches the rubric, so every total built from it `
        + "needs re-deriving by hand before this expectation is edited",
    );
  }
});

test("the report schema the fixtures were written against has not moved", () => {
  assert.equal(PERSONAL_HISTORY_VERSION, EVAL_VERSION_PINS.report);
  // The report carries no rubric version of its own, so this pin is the only
  // thing standing between a rubric change and a silently different published
  // figure. It is deliberately a literal in the fixture module, not an import.
  assert.equal(gradeMyPrompt({ text: EVAL_PROMPT_LABELS[0].text }).rubricVersionId,
    EVAL_VERSION_PINS.rubric);
});

test("pasted output with no request in it is unreadable rather than badly scored", () => {
  assert.equal(gradeMyPrompt({ text: EVAL_UNREADABLE_TEXT }).scored, false,
    "the unreadable fixture entry has to be genuinely unreadable or its bucket count is fiction");
});

// ---------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------

test("every fixture produces the figures declared beside it", () => {
  for (const fixture of EVAL_FIXTURES) {
    const report = reportFor(fixture);
    const want = fixture.expected;
    const where = (what) => `${fixture.id}: ${what}`;

    assert.deepEqual(validatePersonalHistoryReport(report).errors, [], where("invalid report"));
    assert.equal(report.state, want.state, where("state"));
    assert.equal(report.reason, want.reason, where("reason"));
    assert.equal(report.shape, "personal-conversation-json", where("shape"));
    assert.equal(report.schemaVersion, PERSONAL_HISTORY_VERSION, where("schema version"));

    const { coverage } = report;
    assert.equal(coverage.scoredPrompts, want.scoredPrompts, where("scored prompts"));
    assert.equal(coverage.distinctDays, want.distinctDays, where("distinct days"));
    assert.deepEqual({ ...coverage.dropped }, { ...want.dropped }, where("drop buckets"));
    assert.equal(coverage.attachmentsSkipped, want.attachmentsSkipped, where("attachments"));
    assert.equal(coverage.ratio, want.coverageRatio, where("coverage ratio"));
    assert.equal(evalCoverageTier(coverage), want.coverageTier, where("coverage tier"));
    assert.equal(coverage.identity, PERSONAL_COVERAGE_IDENTITY, where("identity text"));
    assert.equal(coverage.promptEntries,
      coverage.scoredPrompts + coverage.dropped.empty + coverage.dropped.undated
        + coverage.dropped.unreadable,
      where("the published coverage identity does not reconcile"));

    assert.equal(report.confidence.level, want.confidence, where("confidence"));
    assert.equal(report.confidence.basis?.downgradedForCoverage ?? null,
      want.downgradedForCoverage, where("coverage downgrade"));

    assert.equal(report.priority.id, want.priorityId, where("prioritized move"));
    assert.equal(report.priority.points, want.priorityPoints, where("points"));
    assert.equal(report.priority.promptsAffected, want.promptsAffected, where("prompts affected"));
    assert.equal(report.priority.leadMargin, want.leadMargin, where("lead margin"));
    assert.equal(report.priority.runnerUp?.id ?? null, want.runnerUpId, where("runner-up"));
    assert.equal(report.priority.available, want.state === PERSONAL_REPORT_STATE.prioritized,
      where("availability"));
  }
});

test("the coverage tier turns on the published floor and nothing else", () => {
  const declared = new Set(EVAL_COVERAGE_TIERS.map((entry) => entry.tier));
  for (const [ratio, tier] of [
    [null, "none"], [1, "full"], [0.999, "sufficient"],
    [PERSONAL_COVERAGE_FLOOR, "sufficient"], [PERSONAL_COVERAGE_FLOOR - 0.001, "thin"], [0, "thin"],
  ]) {
    assert.ok(declared.has(tier), `${tier} is not a declared tier`);
    assert.equal(evalCoverageTier({ ratio }), tier, `coverage ${ratio}`);
  }
  for (const fixture of EVAL_FIXTURES) {
    assert.ok(declared.has(fixture.expected.coverageTier), `${fixture.id}: undeclared tier`);
  }
});

test("the reader's totals are the labels multiplied out, arrived at independently", () => {
  for (const fixture of EVAL_FIXTURES) {
    const report = reportFor(fixture);
    if (report.state !== PERSONAL_REPORT_STATE.prioritized) continue;
    const ranking = expectedRanking(fixture.blocks);
    const [top, runnerUp] = ranking;
    assert.equal(report.priority.id, top.id, `${fixture.id}: leading move`);
    assert.equal(report.priority.points, top.points, `${fixture.id}: leading points`);
    assert.equal(report.priority.promptsAffected, top.promptsAffected, `${fixture.id}: affected`);
    assert.equal(report.priority.kind, top.kind, `${fixture.id}: kind`);
    assert.equal(report.priority.axis, top.axis, `${fixture.id}: axis`);
    assert.equal(report.priority.evidence, top.kind === "fix" ? "measured" : "projected",
      `${fixture.id}: evidence label`);
    assert.equal(report.priority.runnerUp.id, runnerUp.id, `${fixture.id}: runner-up`);
    assert.equal(report.priority.runnerUp.points, runnerUp.points, `${fixture.id}: runner-up points`);
    assert.equal(report.priority.leadMargin, expectedLeadMargin(ranking), `${fixture.id}: margin`);
    assert.equal(report.priority.promptShare,
      Math.round((top.promptsAffected / report.coverage.scoredPrompts) * 1000) / 1000,
      `${fixture.id}: share`);
  }
});

test("the confidence label is the published rule re-applied to the report's own basis", () => {
  for (const fixture of EVAL_FIXTURES) {
    const report = reportFor(fixture);
    if (report.state !== PERSONAL_REPORT_STATE.prioritized) {
      assert.equal(report.confidence.level, "none", `${fixture.id}: a refusal names no confidence`);
      assert.equal(report.confidence.basis, null, `${fixture.id}: a refusal carries no basis`);
      continue;
    }
    const basis = report.confidence.basis;
    assert.equal(basis.floorMultiple,
      Math.round((basis.scoredPrompts / PERSONAL_ELIGIBILITY.minScoredPrompts) * 100) / 100,
      `${fixture.id}: the floor multiple is the arithmetic it states`);
    const earned = PERSONAL_CONFIDENCE_TIERS.findIndex((tier) => basis.floorMultiple >= tier.minFloorMultiple
      && basis.leadMargin >= tier.minLeadMargin);
    const last = PERSONAL_CONFIDENCE_TIERS.length - 1;
    const thin = basis.coverage !== null && basis.coverage < PERSONAL_COVERAGE_FLOOR;
    const tier = PERSONAL_CONFIDENCE_TIERS[Math.min((earned === -1 ? last : earned) + (thin ? 1 : 0), last)];
    assert.equal(report.confidence.level, tier.level, `${fixture.id}: level`);
    assert.equal(report.confidence.rule, tier.rule,
      `${fixture.id}: the rule a reader can dispute travels with the level`);
    assert.equal(basis.coverageFloor, PERSONAL_COVERAGE_FLOOR, `${fixture.id}: floor`);
    assert.match(basis.arithmetic, /^\d+ scored prompts \/ \d+ floor = \d+\.\d\dx; /,
      `${fixture.id}: the confidence sentence shows its arithmetic`);
  }
});

test("a fixture read twice is byte-identical, and reading one does not change another", () => {
  const once = EVAL_FIXTURES.map((fixture) => JSON.stringify(reportFor(fixture)));
  const again = [...EVAL_FIXTURES].reverse().map((fixture) => JSON.stringify(reportFor(fixture)));
  assert.deepEqual([...again].reverse(), once,
    "the reader carries no clock, no randomness, and no state between reads");
});

// ---------------------------------------------------------------------------
// Three benchmark periods, and the trend across them
// ---------------------------------------------------------------------------

test("three benchmark periods each stand on their own before any trend is drawn", () => {
  for (const period of EVAL_BENCHMARK_PERIODS) {
    const report = buildPersonalHistoryReport(evalFixtureExport(period));
    assert.deepEqual(validatePersonalHistoryReport(report).errors, [], period.id);
    assert.equal(report.state, PERSONAL_REPORT_STATE.prioritized, period.id);
    assert.equal(report.coverage.scoredPrompts, PERSONAL_ELIGIBILITY.minScoredPrompts, period.id);
    assert.equal(report.coverage.distinctDays, PERSONAL_ELIGIBILITY.minDistinctDays, period.id);
    assert.equal(evalCoverageTier(report.coverage), "full", period.id);
    // Every period sits exactly on the floor, so no period can be more than low
    // confidence. Three low-confidence readings do not add up to a confident
    // trend, which is why the trend below is a direction and never a grade.
    assert.equal(report.confidence.level, "low", period.id);
    const [top] = expectedRanking(period.blocks);
    assert.equal(report.priority.id, top.id, `${period.id}: leading move`);
    assert.equal(report.priority.points, top.points, `${period.id}: leading points`);
  }
});

test("the trend is one habit's cost per request, falling across the three periods", () => {
  const reports = EVAL_BENCHMARK_PERIODS.map((period) => buildPersonalHistoryReport(evalFixtureExport(period)));
  const trend = evalPeriodTrend(reports);
  assert.equal(trend.moveId, "intent-states-acceptance");
  assert.equal(trend.direction, "improving");
  assert.deepEqual(trend.series.map((entry) => entry.pointsPerScoredPrompt), [7.8, 6, 4.2],
    "156, 120 and 84 points over twenty scored prompts each — arithmetic a reader can redo");
  assert.deepEqual(trend.series.map((entry) => entry.confidence), ["low", "low", "low"]);
  // The runner-up is a fact about one period, not a fixed second place: by May
  // the constraints move has fallen behind the pasted-context move.
  assert.deepEqual(reports.map((report) => report.priority.runnerUp.id),
    ["intent-states-constraints", "intent-states-constraints", "intent-pasted-context"]);
});

test("a trend is refused outright when the periods do not name the same move", () => {
  const reports = [
    buildPersonalHistoryReport(evalFixtureExport(EVAL_BENCHMARK_PERIODS[0])),
    buildPersonalHistoryReport(evalFixtureExport(EVAL_BENCHMARK_PERIODS[1])),
  ];
  const swapped = evalPeriodTrend([reports[0], {
    ...reports[1],
    priority: { ...reports[1].priority, id: "intent-states-context" },
  }]);
  assert.equal(swapped.direction, "move_changed");
  assert.equal(swapped.moveId, null, "two different habits' costs are not points on one line");
});

// ---------------------------------------------------------------------------
// The date rule: complete values only
// ---------------------------------------------------------------------------

test("a date is read only when the whole value is one complete, unambiguous date", () => {
  for (const [value, expected] of [
    ["2026-05-04", "2026-05-04"],
    ["2026/05/04", "2026-05-04"],
    ["2026-05-04T09:00Z", "2026-05-04"],
    ["2026-05-04T23:59:59Z", "2026-05-04"],
    ["2026-05-04T09:00:00.123456Z", "2026-05-04"],
    ["2026-05-04T09:00:00+02:00", "2026-05-04"],
    ["2026-05-04 09:00:00", "2026-05-04"],
    [" 2026-05-04 ", "2026-05-04"],
  ]) assert.equal(personalHistoryDate(value), expected, `${value} is a complete date`);

  for (const value of [
    // The rejection this rule exists for: a prefix match reads a day out of a
    // field the export filled in wrong.
    "2026-05-01not-a-date",
    "2026-05-04 and later", "2026-05-04T", "2026-05-04T09", "2026-05-04T09:00:00Z extra",
    "on 2026-05-04", "2026-05-04/2026-05-11", "2026-05-042", "2026-5-4",
    // A time out of range makes the whole value malformed, date included.
    "2026-05-04T25:00:00Z", "2026-05-04T09:61:00Z",
    // Unchanged refusals: a day that depends on where the reader lives, and a
    // day that does not exist.
    "03/04/2026", "4 May 2026", "2026-02-31", "", "   ", null, undefined, {}, [], true,
  ]) assert.equal(personalHistoryDate(value), null, `${String(value)} was resolved to a day`);
});

test("a malformed date falls back to a real one when the record carries one, and is dropped when it does not", () => {
  const [, fullyStated] = EVAL_PROMPT_LABELS;
  const days = evalDays("2026-09", 5);
  const withFallback = buildPersonalHistoryReport(JSON.stringify({
    conversations: [
      // Malformed message date, dated conversation: the conversation's date is a
      // real date this export stated, so it is used rather than guessed at.
      evalConversation({ date: days[0], text: fullyStated.text, at: 0, messageDate: "2026-05-01not-a-date" }),
      // Malformed in the first date field, complete in a later one.
      {
        messages: [{
          role: "user", create_time: "2026-05-01not-a-date", date: days[1], content: fullyStated.text,
        }],
      },
      // Malformed with nothing to fall back to.
      evalConversation({ date: null, text: fullyStated.text, at: 2, messageDate: "2026-05-01not-a-date" }),
    ],
  }));
  assert.equal(withFallback.coverage.scoredPrompts, 2, "both recoverable dates were recovered");
  assert.equal(withFallback.coverage.dropped.undated, 1, "the unrecoverable one is a counted drop");
  assert.equal(withFallback.coverage.distinctDays, 2);
  assert.ok(!JSON.stringify(withFallback).includes("2026-05-01"),
    "the day named in the malformed field never reaches the report");
});

// ---------------------------------------------------------------------------
// Safety: what a report and anything rendered from it may contain
// ---------------------------------------------------------------------------

/** Every string a surface could print, wherever it sits in the report. */
function stringLeaves(value, into = []) {
  if (typeof value === "string") into.push(value);
  else if (value && typeof value === "object") for (const entry of Object.values(value)) stringLeaves(entry, into);
  return into;
}

function keysAtAnyDepth(value, into = new Set()) {
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (!Array.isArray(value)) into.add(key);
      keysAtAnyDepth(entry, into);
    }
  }
  return into;
}

/** A history whose every prompt carries a marker no authored copy could contain. */
function markedExport() {
  const days = evalDays("2026-10", 5);
  const conversations = Array.from({ length: 24 }, (unused, at) => evalConversation({
    date: days[at % days.length],
    at,
    text: `${EVAL_PROMPT_LABELS[at % EVAL_PROMPT_LABELS.length].text}\n`
      + `Reference: ZQWMARKER${String(at).padStart(3, "0")}ZQW and account key sk-live-${at}.`,
  }));
  return JSON.stringify({ conversations });
}

test("no prompt text reaches a report, at any depth or in any state", () => {
  const report = buildPersonalHistoryReport(markedExport());
  assert.equal(report.state, PERSONAL_REPORT_STATE.prioritized);
  const serialized = JSON.stringify(report);
  const leaves = stringLeaves(report);
  for (let at = 0; at < 24; at += 1) {
    const marker = `ZQWMARKER${String(at).padStart(3, "0")}ZQW`;
    assert.ok(!serialized.includes(marker), `${marker} survived into the report`);
    assert.ok(!leaves.some((leaf) => leaf.includes(marker)), `${marker} is printable from the report`);
    assert.equal(assertNoPromptText(report, marker), true);
  }
  assert.ok(!serialized.includes("sk-live-"), "nothing that looked like a credential was carried");
  // A refusal is a report too, and the file it refused was still read.
  const refused = buildPersonalHistoryReport(JSON.stringify({
    conversations: [evalConversation({ date: null, text: "ZQWMARKER999ZQW draft something", at: 0 })],
  }));
  assert.equal(refused.state, PERSONAL_REPORT_STATE.notEligible);
  assert.equal(assertNoPromptText(refused, "ZQWMARKER999ZQW"), true);
});

test("a report carries no forbidden field, in any state, at any depth", () => {
  const reports = [
    buildPersonalHistoryReport(markedExport()),
    ...EVAL_FIXTURES.map(reportFor),
    buildPersonalHistoryReport(42),
    buildPersonalHistoryReport("a plain note to myself"),
  ];
  for (const report of reports) {
    for (const key of keysAtAnyDepth(report)) {
      assert.ok(!FORBIDDEN_REPORT_KEYS.includes(key), `a report grew a "${key}" field`);
    }
    assert.deepEqual(validatePersonalHistoryReport(report).errors, []);
  }
});

/**
 * Everything a report is allowed to print: the contract's own published copy,
 * the coaching module's authored move copy, and a short vocabulary of labels
 * this repository writes rather than reads. Anything else on a report is either
 * a figure or something that came out of the file, and the second is the defect
 * this test exists to catch.
 */
function authoredCopy() {
  const allowed = new Set();
  for (const source of [contract, IMPROVEMENT_COPY, IMPROVEMENT_REWRITE, PERSONAL_NO_PRIORITY]) {
    for (const leaf of stringLeaves(source)) allowed.add(leaf);
  }
  for (const row of EVAL_PROMPT_LABELS) {
    for (const entry of row.moves) [entry.id, entry.kind, entry.axis].forEach((token) => allowed.add(token));
  }
  // Vocabulary the report writes itself, listed rather than pattern-matched so
  // an addition to it is a line in a diff somebody has to justify.
  for (const token of ["measured", "projected", "none"]) allowed.add(token);
  return allowed;
}

test("every printable string on a report is authored copy or its own arithmetic", () => {
  const allowed = authoredCopy();
  // The one generated sentence: the confidence arithmetic, which is numbers and
  // the words around them and is pinned by its own assertion above.
  const arithmetic = /^\d+ scored prompts \/ \d+ floor = \d+\.\d\dx; leading move ahead of the runner-up by \d+\.\d% of its own points$/;
  for (const report of [buildPersonalHistoryReport(markedExport()), ...EVAL_FIXTURES.map(reportFor)]) {
    for (const leaf of stringLeaves(report)) {
      assert.ok(allowed.has(leaf) || arithmetic.test(leaf),
        `a report printed a string that is neither published copy nor its own arithmetic: ${leaf}`);
    }
  }
});

test("a nested export cannot smuggle text in through parts or attachments", () => {
  const days = evalDays("2026-11", 5);
  const report = buildPersonalHistoryReport(JSON.stringify({
    conversations: [
      ...Array.from({ length: 20 }, (unused, at) => evalConversation({
        date: days[at % days.length], at, text: EVAL_PROMPT_LABELS[0].text,
      })),
      {
        create_time: `${days[0]}T09:00:00Z`,
        messages: [{
          role: "user",
          content: { parts: ["draft a reply", { file_name: "ZQWFILEZQW.pdf", mime: "application/pdf" }] },
          attachments: [{ name: "ZQWATTACHZQW.png", bytes: 1024 }],
        }],
      },
    ],
  }));
  assert.equal(report.coverage.attachmentsSkipped, 2, "a non-string part and an attachment are counted");
  for (const marker of ["ZQWFILEZQW", "ZQWATTACHZQW", "application/pdf", "1024"]) {
    assert.ok(!JSON.stringify(report).includes(marker), `${marker} was read out of an attachment`);
  }
});

test("the fixture suite itself carries no report field that is not in the contract", () => {
  const built = buildEvalExport({
    blocks: [{ prompt: "fully-stated", count: 20 }], days: evalDays("2026-12", 5),
  });
  const report = buildPersonalHistoryReport(built);
  assert.deepEqual(Object.keys(report).sort(), [...contract.PERSONAL_REPORT_FIELDS].sort());
  assert.deepEqual(Object.keys(report.coverage).sort(), [...contract.PERSONAL_COVERAGE_FIELDS].sort());
  assert.deepEqual(Object.keys(report.priority).sort(), [...contract.PERSONAL_PRIORITY_FIELDS].sort());
});
