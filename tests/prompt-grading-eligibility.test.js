// Prompt-grading eligibility: when a reader's own prompt corpus may own the
// headline.
//
// Every assertion is about a metric, a state, or the one next action — never a
// widget. Boundary fixtures are built from exact whole counts (15 of 25, not
// 0.6 * 25) so a threshold assertion can never pass or fail on float drift, and
// the corpora are generated here rather than committed, because a 60-prompt
// fixture file is 60 lines nobody reads to check one count.

import assert from "node:assert/strict";
import test from "node:test";
import {
  GRADING_DIMENSION, PROMPT_GRADING_ACTION_PRECEDENCE, PROMPT_GRADING_REASON,
  PROMPT_GRADING_STATE, PROMPT_GRADING_THRESHOLDS, combinedGradingStatus,
  promptGradingEligibility, promptGradingSignals,
} from "../src/prompt-grading-eligibility.js";
import { gradeEligibility } from "../src/grade-eligibility.js";

const { minClassifiedPromptShare, minPromptsPerDepartment, minHistoryWindowDays } =
  PROMPT_GRADING_THRESHOLDS;

/** A day `offset` days after 2026-01-01, in the contract's own bucket format. */
function day(offset) {
  return new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
}

/**
 * `count` prompts for one department, spread across `spanDays` so the earliest
 * and latest are exactly that many days apart. `classified` false makes every
 * one of them an unclassified record that still counts in `totalPrompts`.
 */
function prompts(department, count, { spanDays = 0, classified = true, timestamp } = {}) {
  return Array.from({ length: count }, (unused, index) => ({
    department,
    // First prompt on day 0, last on day `spanDays`, the rest in between: the
    // window is exactly `spanDays` for any count of two or more.
    timestamp: timestamp === undefined
      ? day(count <= 1 ? 0 : Math.round((index * spanDays) / (count - 1)))
      : timestamp,
    classified,
  }));
}

/** An import that clears every dimension, so a test can break exactly one. */
function healthyCorpus() {
  return prompts("psn_engineering_0000001", minPromptsPerDepartment, { spanDays: minHistoryWindowDays });
}

// --- the three states ------------------------------------------------------

test("an absent import is sample-only, and says the grade shown is the sample's", () => {
  for (const empty of [undefined, {}, [], { prompts: [] }]) {
    const result = promptGradingEligibility(empty);
    assert.equal(result.state, PROMPT_GRADING_STATE.sampleOnly);
    assert.equal(result.hasOwnImport, false);
    assert.equal(result.showOwnGrade, false);
    assert.deepEqual([...result.reasons], [PROMPT_GRADING_REASON.noImport]);
    assert.equal(result.nextAction.kind, "import_conversation_export");
    assert.match(result.disclosure.provenance, /bundled sample/);
    assert.match(result.disclosure.impact, /not yours/);
  }
});

test("an import where every department is under the floor is sample-only", () => {
  const result = promptGradingEligibility([
    ...prompts("psn_engineering_0000001", minPromptsPerDepartment - 1, { spanDays: 30 }),
    ...prompts("psn_marketing_000000001", 3, { spanDays: 30 }),
  ]);
  assert.equal(result.state, PROMPT_GRADING_STATE.sampleOnly);
  // The reader does have data — it is just not enough of it. The two facts are
  // reported separately because they lead to different next actions.
  assert.equal(result.hasOwnImport, true);
  assert.equal(result.departmentsCovered, 0);
  assert.ok(result.reasons.includes(PROMPT_GRADING_REASON.noDepartmentAboveFloor));
  assert.equal(result.nextAction.kind, "import_conversation_export");
});

test("every dimension clearing yields own-grade and a coaching next action", () => {
  const result = promptGradingEligibility(healthyCorpus(), {
    departmentScores: { psn_engineering_0000001: 71 },
  });
  assert.equal(result.state, PROMPT_GRADING_STATE.ownGrade);
  assert.equal(result.showOwnGrade, true);
  assert.equal(result.status, "graded");
  assert.deepEqual([...result.reasons], [PROMPT_GRADING_REASON.allDimensionsClear]);
  assert.equal(result.nextAction.kind, "coach_department");
  assert.equal(result.nextAction.department, "psn_engineering_0000001");
  assert.equal(result.nextAction.score, 71);
});

test("own-grade names the worst-scoring graded department, not the smallest", () => {
  const result = promptGradingEligibility([
    ...prompts("psn_engineering_0000001", 100, { spanDays: minHistoryWindowDays }),
    ...prompts("psn_marketing_000000001", minPromptsPerDepartment, { spanDays: minHistoryWindowDays }),
  ], { departmentScores: { psn_engineering_0000001: 41, psn_marketing_000000001: 88 } });
  assert.equal(result.state, PROMPT_GRADING_STATE.ownGrade);
  assert.equal(result.nextAction.department, "psn_engineering_0000001");
});

test("own-grade with no per-department scores says so rather than naming one", () => {
  const result = promptGradingEligibility(healthyCorpus());
  assert.equal(result.nextAction.kind, "coach_department");
  assert.equal(result.nextAction.available, false);
  assert.equal(result.nextAction.department, null);
});

// --- classified share ------------------------------------------------------

test("share exactly at the floor passes; just below it is partial", () => {
  // 100 prompts, 60 classified = 0.6 exactly. Whole counts, so no float drift,
  // and both sides of the boundary clear the per-department floor, so this test
  // moves only the dimension it is about.
  const total = 100;
  const atFloor = total * minClassifiedPromptShare;
  const build = (classifiedCount) => [
    ...prompts("psn_engineering_0000001", classifiedCount, { spanDays: minHistoryWindowDays }),
    ...prompts("psn_engineering_0000001", total - classifiedCount,
      { spanDays: minHistoryWindowDays, classified: false }),
  ];

  const exact = promptGradingEligibility(build(atFloor));
  assert.equal(exact.classifiedPromptShare, minClassifiedPromptShare);
  assert.equal(exact.state, PROMPT_GRADING_STATE.ownGrade);

  const below = promptGradingEligibility(build(atFloor - 1));
  assert.ok(below.classifiedPromptShare < minClassifiedPromptShare);
  assert.equal(below.state, PROMPT_GRADING_STATE.partial);
  assert.ok(below.reasons.includes(PROMPT_GRADING_REASON.shareBelowFloor));
});

test("an empty corpus has a share of 0, never NaN and never 1", () => {
  const result = promptGradingEligibility([]);
  assert.equal(result.totalPrompts, 0);
  assert.equal(result.classifiedPrompts, 0);
  assert.equal(result.classifiedPromptShare, 0);
  assert.ok(!Number.isNaN(result.classifiedPromptShare));
});

test("a prompt with no department is unclassified however it was labelled", () => {
  const result = promptGradingEligibility([
    ...healthyCorpus(),
    { department: null, timestamp: day(1), classified: true },
    { department: "   ", timestamp: day(2), classified: true },
  ]);
  assert.equal(result.totalPrompts, minPromptsPerDepartment + 2);
  assert.equal(result.classifiedPrompts, minPromptsPerDepartment);
  // Counts sum to classifiedPrompts, so nothing is double-counted or orphaned.
  assert.equal(
    Object.values(result.detail.departmentPromptCounts).reduce((sum, n) => sum + n, 0),
    result.classifiedPrompts,
  );
});

// --- history window --------------------------------------------------------

test("window exactly at the floor passes; a day short is partial", () => {
  const exact = promptGradingEligibility(
    prompts("psn_engineering_0000001", minPromptsPerDepartment, { spanDays: minHistoryWindowDays }));
  assert.equal(exact.historyWindowDays, minHistoryWindowDays);
  assert.equal(exact.state, PROMPT_GRADING_STATE.ownGrade);

  const short = promptGradingEligibility(
    prompts("psn_engineering_0000001", minPromptsPerDepartment, { spanDays: minHistoryWindowDays - 1 }));
  assert.equal(short.historyWindowDays, minHistoryWindowDays - 1);
  assert.equal(short.state, PROMPT_GRADING_STATE.partial);
  assert.ok(short.reasons.includes(PROMPT_GRADING_REASON.windowBelowFloor));
  assert.equal(short.nextAction.kind, "extend_history_window");
  assert.equal(short.nextAction.shortfall, 1);
});

test("a single-day import is a window of 0 days, not 1", () => {
  const result = promptGradingEligibility(
    prompts("psn_engineering_0000001", minPromptsPerDepartment, { timestamp: day(3) }));
  assert.equal(result.historyWindowDays, 0);
});

test("records with no timestamp are excluded from the window and still counted", () => {
  const result = promptGradingEligibility([
    ...prompts("psn_engineering_0000001", minPromptsPerDepartment, { spanDays: minHistoryWindowDays }),
    ...prompts("psn_engineering_0000001", 5, { timestamp: null }),
    ...prompts("psn_engineering_0000001", 2, { timestamp: "not a date" }),
  ]);
  // The window is still the span of the timestamped records: an unparseable
  // date does not stretch it to the epoch, and does not shorten it either.
  assert.equal(result.historyWindowDays, minHistoryWindowDays);
  assert.equal(result.totalPrompts, minPromptsPerDepartment + 7);
  assert.equal(result.classifiedPrompts, minPromptsPerDepartment + 7);
  assert.equal(result.detail.promptsWithTimestamp, minPromptsPerDepartment);
  assert.equal(result.detail.promptsWithoutTimestamp, 7);
});

// --- the per-department floor ----------------------------------------------

test("a department at exactly the floor is graded; one below is a named gap", () => {
  const result = promptGradingEligibility([
    ...prompts("psn_engineering_0000001", minPromptsPerDepartment, { spanDays: minHistoryWindowDays }),
    ...prompts("psn_marketing_000000001", minPromptsPerDepartment - 1, { spanDays: minHistoryWindowDays }),
  ]);
  assert.deepEqual([...result.gradedDepartments], ["psn_engineering_0000001"]);
  assert.equal(result.departmentsCovered, 1);
  assert.deepEqual(result.ungradedDepartments.map((gap) => gap.department), ["psn_marketing_000000001"]);
  assert.equal(result.ungradedDepartments[0].prompts, minPromptsPerDepartment - 1);
  assert.equal(result.ungradedDepartments[0].shortfall, 1);
  assert.equal(result.state, PROMPT_GRADING_STATE.partial);
  assert.ok(result.reasons.includes(PROMPT_GRADING_REASON.ungradedDepartments));
});

test("departmentsCovered is the graded count, not the count merely present", () => {
  const result = promptGradingEligibility([
    ...prompts("psn_engineering_0000001", 60, { spanDays: minHistoryWindowDays }),
    ...prompts("psn_marketing_000000001", 2, { spanDays: minHistoryWindowDays }),
    ...prompts("psn_support_0000000001", 1, { spanDays: minHistoryWindowDays }),
  ]);
  assert.equal(result.detail.departmentsPresent, 3);
  assert.equal(result.departmentsCovered, 1);
  // N is every classified prompt, including the three in departments too thin
  // to grade; M counts only the department the file can actually speak for.
  assert.match(result.disclosure.provenance, /Graded from your file, 63 prompts, 1 department$/);
});

// --- next-action precedence ------------------------------------------------

test("next-action precedence is deterministic when two dimensions are short", () => {
  // Short on share AND on window AND carrying a named gap. Share wins.
  const corpus = [
    ...prompts("psn_engineering_0000001", minPromptsPerDepartment, { spanDays: 3 }),
    ...prompts("psn_marketing_000000001", 4, { spanDays: 3 }),
    ...prompts("psn_engineering_0000001", 60, { spanDays: 3, classified: false }),
  ];
  const result = promptGradingEligibility(corpus);
  assert.equal(result.state, PROMPT_GRADING_STATE.partial);
  assert.ok(result.classifiedPromptShare < minClassifiedPromptShare);
  assert.ok(result.historyWindowDays < minHistoryWindowDays);
  assert.ok(result.ungradedDepartments.length > 0);
  assert.equal(result.nextAction.kind, PROMPT_GRADING_ACTION_PRECEDENCE[0]);
  // Same input, same action, every time.
  assert.deepEqual(promptGradingEligibility(corpus).nextAction, result.nextAction);
});

test("with share clear, a short window outranks a named department gap", () => {
  const result = promptGradingEligibility([
    ...prompts("psn_engineering_0000001", minPromptsPerDepartment, { spanDays: 2 }),
    ...prompts("psn_marketing_000000001", 4, { spanDays: 2 }),
  ]);
  assert.equal(result.nextAction.kind, PROMPT_GRADING_ACTION_PRECEDENCE[1]);
});

test("with share and window clear, the largest named gap is the action", () => {
  const result = promptGradingEligibility([
    ...prompts("psn_engineering_0000001", minPromptsPerDepartment, { spanDays: minHistoryWindowDays }),
    ...prompts("psn_marketing_000000001", 20, { spanDays: minHistoryWindowDays }),
    ...prompts("psn_support_0000000001", 4, { spanDays: minHistoryWindowDays }),
  ]);
  assert.equal(result.nextAction.kind, PROMPT_GRADING_ACTION_PRECEDENCE[2]);
  // Support is 21 short, marketing only 5: the biggest gap is named first.
  assert.equal(result.nextAction.department, "psn_support_0000000001");
  assert.equal(result.nextAction.shortfall, minPromptsPerDepartment - 4);
});

test("the share action states how many more prompts would clear the floor", () => {
  const result = promptGradingEligibility([
    ...prompts("psn_engineering_0000001", 40, { spanDays: minHistoryWindowDays }),
    ...prompts("psn_engineering_0000001", 60, { spanDays: minHistoryWindowDays, classified: false }),
  ]);
  assert.equal(result.classifiedPromptShare, 0.4);
  assert.equal(result.nextAction.kind, "classify_more_prompts");
  // 0.6 of 100 is 60; 40 already classified, so 20 more.
  assert.equal(result.nextAction.shortfall, 20);
});

// --- one vocabulary, two dimensions ----------------------------------------

test("the combined status resolves to the weaker dimension and names it", () => {
  // Spend mix is fully covered; prompt grading is not.
  const spendMix = gradeEligibility([{
    id: "engineering", name: "Engineering", spendUsd: 100,
    mix: { highValue: 6, inefficient: 1 }, sampling: { status: "available", sampledQueries: 100 },
  }]);
  assert.equal(spendMix.state, "graded");

  const promptGrading = promptGradingEligibility([
    ...prompts("psn_engineering_0000001", minPromptsPerDepartment, { spanDays: 1 }),
  ]);
  assert.equal(promptGrading.status, "provisional");

  const combined = combinedGradingStatus({ spendMix, promptGrading });
  assert.equal(combined.status, "provisional");
  assert.equal(combined.weakestDimension, GRADING_DIMENSION.promptGrading);
  assert.equal(combined.dimensionsDisagree, true);
  // One label, not two competing badges.
  assert.equal(combined.label, promptGrading.label);
  assert.equal(combined.dimensions.length, 2);
});

test("agreeing dimensions produce one status and report no disagreement", () => {
  const spendMix = gradeEligibility([{
    id: "engineering", name: "Engineering", spendUsd: 100,
    mix: { highValue: 6 }, sampling: { status: "available", sampledQueries: 100 },
  }]);
  const promptGrading = promptGradingEligibility(healthyCorpus());
  const combined = combinedGradingStatus({ spendMix, promptGrading });
  assert.equal(combined.status, "graded");
  assert.equal(combined.dimensionsDisagree, false);
});

test("with nothing measured the combined status claims nothing", () => {
  const combined = combinedGradingStatus();
  assert.equal(combined.status, "not_gradeable");
  assert.equal(combined.weakestDimension, null);
});

// --- the adapter over the conversation-export contract ---------------------

test("signals read classification back from the classifier's set-aside rows", () => {
  const signals = promptGradingSignals([{
    parsed: {
      records: [
        { row: 1, orgUnitId: "psn_engineering_0000001", queryDate: "2026-01-01" },
        { row: 2, orgUnitId: "psn_engineering_0000001", queryDate: "2026-01-09" },
        { row: 3, orgUnitId: "psn_marketing_000000001", queryDate: "2026-01-15" },
      ],
    },
    classified: { unclassified: [{ row: 2, field: "category", code: "unknown_category" }] },
  }]);
  assert.equal(signals.prompts.length, 3);
  assert.deepEqual(signals.prompts.map((prompt) => prompt.classified), [true, false, true]);

  const result = promptGradingEligibility(signals, { thresholds: { minPromptsPerDepartment: 1 } });
  assert.equal(result.totalPrompts, 3);
  assert.equal(result.classifiedPrompts, 2);
  assert.equal(result.historyWindowDays, 14);
});

test("the rule holds no second copy of the thresholds", () => {
  // Overriding the published constants changes the verdict, which is only true
  // if every comparison reads them rather than an inlined number.
  const corpus = prompts("psn_engineering_0000001", 5, { spanDays: 1 });
  assert.equal(promptGradingEligibility(corpus).state, PROMPT_GRADING_STATE.sampleOnly);
  assert.equal(
    promptGradingEligibility(corpus, {
      thresholds: { minPromptsPerDepartment: 5, minHistoryWindowDays: 1 },
    }).state,
    PROMPT_GRADING_STATE.ownGrade,
  );
});

test("the rule is pure: no clock, no storage, no network", async () => {
  const source = await (await import("node:fs/promises"))
    .readFile(new URL("../src/prompt-grading-eligibility.js", import.meta.url), "utf8");
  for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "fetch(", "Date.now", "Math.random"]) {
    assert.ok(!source.includes(forbidden), `${forbidden} must not appear in the rule module`);
  }
});
