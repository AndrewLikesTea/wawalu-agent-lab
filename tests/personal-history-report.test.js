// The personal AI-history reader: shape detection, the coverage arithmetic, and
// every refusal a reader can be handed.
//
// The arithmetic group is the one to read first. Coverage and confidence are the
// two figures a reader will quote back at us, so each is checked against the
// definition published in `PERSONAL_METRIC_DEFINITIONS` rather than against
// whatever the code happened to return.
//
// No fixture is committed. Every export below is generated from the bundled
// synthetic preview or from strings hand-authored in this file. No real prompt,
// provider, customer, or telemetry data was available and none is used.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PERSONAL_CONFIDENCE_TIERS, PERSONAL_COVERAGE_FLOOR, PERSONAL_ELIGIBILITY,
  PERSONAL_EXPORT_SHAPES, PERSONAL_NOT_ELIGIBLE, PERSONAL_READER_LIMITS,
  PERSONAL_REPORT_STATE, validatePersonalHistoryReport,
} from "../src/personal-history-contract.js";
import {
  buildPersonalHistoryReport, detectPersonalExportShape, personalHistoryDate,
} from "../src/personal-history-report.js";
import {
  PERSONAL_PREVIEW_DAYS, PERSONAL_PREVIEW_PROMPTS, personalHistoryPreviewFiles,
  personalHistoryPreviewJson, personalHistoryPreviewTable,
} from "../src/personal-history-fixture.js";

/** A day well past the nine the preview uses, so generated exports never collide. */
const day = (at) => `2026-0${1 + Math.floor(at / 28)}-${String((at % 28) + 1).padStart(2, "0")}`;

/**
 * A synthetic JSON export of `prompts` requests spread over `days` days, plus
 * whatever extra messages a test needs. The prompt text is the bundled preview's,
 * so no test authors a second corpus that could drift from the fixture.
 */
function exportJson({ prompts = 0, days = 1, extra = [] } = {}) {
  const conversations = Array.from({ length: prompts }, (unused, at) => ({
    create_time: `${day(at % days)}T09:00:00Z`,
    messages: [
      { role: "user", content: PERSONAL_PREVIEW_PROMPTS[at % PERSONAL_PREVIEW_PROMPTS.length] },
      { role: "assistant", content: "Here is a draft." },
    ],
  }));
  return JSON.stringify({ conversations: [...conversations, ...extra] });
}

const userMessage = (content, date = PERSONAL_PREVIEW_DAYS[0]) => ({
  ...(date ? { create_time: `${date}T09:00:00Z` } : {}),
  messages: [{ role: "user", content }],
});

// ---------------------------------------------------------------------------
// Shape detection
// ---------------------------------------------------------------------------

test("detection is the executable form of the declared detect rules", () => {
  const [json, table] = PERSONAL_EXPORT_SHAPES;
  assert.equal(detectPersonalExportShape(personalHistoryPreviewJson()), json.id);
  assert.equal(detectPersonalExportShape(personalHistoryPreviewTable()), table.id);
  // The array spelling and the wrapped spelling are both the JSON shape.
  assert.equal(detectPersonalExportShape('[{"messages":[]}]'), json.id);
  assert.equal(detectPersonalExportShape('{"conversations":[{"messages":[]}]}'), json.id);
  // A table needs both required columns, and a header carrying one is not a shape.
  assert.equal(detectPersonalExportShape("date,prompt\n2026-05-04,ask something"), table.id);
  assert.equal(detectPersonalExportShape("when,request\n2026-05-04,ask something"), table.id);
  assert.equal(detectPersonalExportShape("date,model\n2026-05-04,assistant-large"), null);
  assert.equal(detectPersonalExportShape("prompt,model\nask something,assistant-large"), null);
  for (const nothing of [null, 42, "", "{}", '{"messages":"no"}', '[{"note":1}]']) {
    assert.equal(detectPersonalExportShape(nothing), null, `${nothing} was read as an export`);
  }
});

test("a date is read only when it means one day everywhere", () => {
  assert.equal(personalHistoryDate("2026-05-04"), "2026-05-04");
  assert.equal(personalHistoryDate("2026-05-04T23:59:59Z"), "2026-05-04");
  assert.equal(personalHistoryDate("2026/05/04"), "2026-05-04");
  assert.equal(personalHistoryDate(1_777_939_200), "2026-05-05", "epoch seconds");
  assert.equal(personalHistoryDate(1_777_939_200_000), "2026-05-05", "epoch milliseconds");
  for (const ambiguous of ["03/04/2026", "4 May 2026", "May 4, 2026", "2026-02-31", "", null, {}]) {
    assert.equal(personalHistoryDate(ambiguous), null,
      `${ambiguous} was resolved to a day it does not unambiguously name`);
  }
});

// ---------------------------------------------------------------------------
// The coverage arithmetic
// ---------------------------------------------------------------------------

test("only messages you wrote are prompt entries", () => {
  const report = buildPersonalHistoryReport(JSON.stringify({
    conversations: [{
      create_time: `${PERSONAL_PREVIEW_DAYS[0]}T09:00:00Z`,
      messages: [
        { role: "user", content: PERSONAL_PREVIEW_PROMPTS[0] },
        { role: "assistant", content: PERSONAL_PREVIEW_PROMPTS[1] },
        { role: "system", content: PERSONAL_PREVIEW_PROMPTS[2] },
        { role: "tool", content: PERSONAL_PREVIEW_PROMPTS[3] },
      ],
    }],
  }));
  assert.equal(report.coverage.promptEntries, 1,
    "an assistant, system, or tool turn is not something you wrote");
});

test("the drop buckets are exclusive, in the published precedence", () => {
  const report = buildPersonalHistoryReport(JSON.stringify({
    conversations: [
      userMessage(PERSONAL_PREVIEW_PROMPTS[0]),
      userMessage("   "),
      // Empty *and* undated: precedence 1 takes it, and it is counted once.
      { messages: [{ role: "user", content: "  " }] },
      { messages: [{ role: "user", content: PERSONAL_PREVIEW_PROMPTS[1] }] },
      userMessage("```\nnpm ERR! code ELIFECYCLE\n```"),
    ],
  }));
  const { promptEntries, scoredPrompts, dropped } = report.coverage;
  assert.equal(promptEntries, 5);
  assert.equal(scoredPrompts, 1);
  assert.deepEqual({ ...dropped }, { empty: 2, undated: 1, unreadable: 1 });
  assert.equal(promptEntries, scoredPrompts + dropped.empty + dropped.undated + dropped.unreadable);
  assert.equal(report.coverage.ratio, 0.2);
});

test("coverage is null when there is no denominator, never a zero", () => {
  const report = buildPersonalHistoryReport('{"conversations":[]}');
  assert.equal(report.reason, PERSONAL_NOT_ELIGIBLE.noPromptEntries);
  assert.equal(report.coverage.ratio, null, "no prompt entries is the absence of a measurement");
  assert.equal(report.coverage.promptEntries, 0);
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

test("each refusal reason is reachable and carries its published sentence", () => {
  const cases = [
    [PERSONAL_NOT_ELIGIBLE.unsupportedInput, 42],
    [PERSONAL_NOT_ELIGIBLE.unrecognizedShape, "a plain note to myself"],
    [PERSONAL_NOT_ELIGIBLE.noPromptEntries, '{"conversations":[]}'],
    [PERSONAL_NOT_ELIGIBLE.noDatedPrompts, JSON.stringify({
      conversations: PERSONAL_PREVIEW_PROMPTS.map((content) => ({ messages: [{ role: "user", content }] })),
    })],
    [PERSONAL_NOT_ELIGIBLE.tooFewScoredPrompts, exportJson({ prompts: 6, days: 6 })],
    [PERSONAL_NOT_ELIGIBLE.tooFewDistinctDays, exportJson({
      prompts: PERSONAL_ELIGIBILITY.minScoredPrompts + 4,
      days: PERSONAL_ELIGIBILITY.minDistinctDays - 1,
    })],
  ];
  for (const [reason, input] of cases) {
    const report = buildPersonalHistoryReport(input);
    assert.equal(report.state, PERSONAL_REPORT_STATE.notEligible, reason);
    assert.equal(report.reason, reason);
    assert.ok(report.reasonRule.length > 40, `${reason} arrived without its sentence`);
    assert.equal(report.priority.available, false, `${reason} still named a move`);
    assert.equal(report.confidence.level, "none");
    assert.deepEqual(validatePersonalHistoryReport(report).errors, [],
      `the ${reason} refusal is not a valid report`);
  }
});

test("a file over the in-tab ceiling is refused whole, never truncated", () => {
  const report = buildPersonalHistoryReport(exportJson({
    prompts: PERSONAL_READER_LIMITS.maxPromptEntries + 1, days: 20,
  }));
  assert.equal(report.reason, PERSONAL_NOT_ELIGIBLE.exportTooLarge);
  assert.equal(report.coverage.promptEntries, 0,
    "a refused file reports no coverage rather than the coverage of the part that was read");
});

test("both floors are read with >=, so a history sitting exactly on them qualifies", () => {
  const report = buildPersonalHistoryReport(exportJson({
    prompts: PERSONAL_ELIGIBILITY.minScoredPrompts,
    days: PERSONAL_ELIGIBILITY.minDistinctDays,
  }));
  assert.equal(report.state, PERSONAL_REPORT_STATE.prioritized);
  assert.equal(report.eligibility.scoredPrompts, PERSONAL_ELIGIBILITY.minScoredPrompts);
  assert.equal(report.eligibility.distinctDays, PERSONAL_ELIGIBILITY.minDistinctDays);
  assert.equal(report.eligibility.met, true);
  assert.equal(report.eligibility.operator, ">=");

  const short = buildPersonalHistoryReport(exportJson({
    prompts: PERSONAL_ELIGIBILITY.minScoredPrompts - 1,
    days: PERSONAL_ELIGIBILITY.minDistinctDays,
  }));
  assert.equal(short.reason, PERSONAL_NOT_ELIGIBLE.tooFewScoredPrompts);
});

// ---------------------------------------------------------------------------
// The one move, and confidence in it
// ---------------------------------------------------------------------------

test("one move is named, with what it is worth and the move it beat", () => {
  const report = buildPersonalHistoryReport(personalHistoryPreviewJson());
  const { priority, coverage } = report;
  assert.equal(report.state, PERSONAL_REPORT_STATE.prioritized);
  assert.equal(priority.available, true);
  assert.ok(priority.id && priority.title && priority.guidance && priority.rewrite);
  assert.ok(["measured", "projected"].includes(priority.evidence));
  assert.ok(priority.promptsAffected > 0 && priority.promptsAffected <= coverage.scoredPrompts);
  assert.equal(priority.promptShare,
    Math.round((priority.promptsAffected / coverage.scoredPrompts) * 1000) / 1000);
  assert.ok(priority.runnerUp, "the move it beat travels with it, so the ranking can be argued");
  assert.ok(priority.points > priority.runnerUp.points);
  assert.equal(priority.leadMargin,
    Math.round(((priority.points - priority.runnerUp.points) / priority.points) * 1000) / 1000);
});

test("the ranking is by points, and points are the sum over the prompts a move applies to", () => {
  // One request, repeated. Every move available to it is available to all of
  // them, so each move's points are that one prompt's points times the count —
  // which is the definition, arithmetic a reader can redo by hand.
  const repeats = PERSONAL_ELIGIBILITY.minScoredPrompts;
  const single = buildPersonalHistoryReport(JSON.stringify({
    conversations: Array.from({ length: repeats }, (unused, at) => ({
      create_time: `${day(at % PERSONAL_ELIGIBILITY.minDistinctDays)}T09:00:00Z`,
      messages: [{ role: "user", content: PERSONAL_PREVIEW_PROMPTS[2] }],
    })),
  }));
  assert.equal(single.priority.promptsAffected, repeats);
  assert.equal(single.priority.promptShare, 1);
  assert.equal(single.priority.points % repeats, 0,
    "a move's points are a whole multiple of one prompt's points when every prompt is the same");
});

test("confidence needs both a sample and a margin, and coverage can take a step back", () => {
  const [high, moderate] = PERSONAL_CONFIDENCE_TIERS;

  const atFloor = buildPersonalHistoryReport(exportJson({
    prompts: PERSONAL_ELIGIBILITY.minScoredPrompts, days: PERSONAL_ELIGIBILITY.minDistinctDays,
  }));
  assert.equal(atFloor.confidence.level, "low", "the floor earns the floor's confidence");
  assert.equal(atFloor.confidence.basis.floorMultiple, 1);

  const wider = buildPersonalHistoryReport(exportJson({
    prompts: PERSONAL_ELIGIBILITY.minScoredPrompts * moderate.minFloorMultiple, days: 9,
  }));
  assert.ok(wider.confidence.basis.leadMargin >= moderate.minLeadMargin);
  assert.equal(wider.confidence.level, "moderate");
  assert.ok(wider.confidence.basis.floorMultiple >= moderate.minFloorMultiple);
  assert.ok(wider.confidence.basis.floorMultiple < high.minFloorMultiple);
  assert.match(wider.confidence.basis.arithmetic, /scored prompts/);

  // The same history with enough unreadable entries to push coverage under the
  // floor: the arithmetic is unchanged and the claim about it is weaker.
  const thin = buildPersonalHistoryReport(exportJson({
    prompts: PERSONAL_ELIGIBILITY.minScoredPrompts * moderate.minFloorMultiple,
    days: 9,
    extra: Array.from({ length: 16 }, () => userMessage("   ")),
  }));
  assert.ok(thin.coverage.ratio < PERSONAL_COVERAGE_FLOOR);
  assert.equal(thin.confidence.level, "low");
  assert.equal(thin.confidence.basis.downgradedForCoverage, true);
  assert.equal(thin.priority.id, wider.priority.id, "coverage moves the claim, never the move");
});

test("a report of one person never grows a comparison, and reads the same twice", () => {
  const text = personalHistoryPreviewJson();
  assert.equal(JSON.stringify(buildPersonalHistoryReport(text)),
    JSON.stringify(buildPersonalHistoryReport(text)),
    "the reader carries no clock, no randomness, and no generated identifier");
  const report = buildPersonalHistoryReport(text);
  assert.match(report.basis.refusal, /not a benchmark/i);
  assert.match(report.eligibility.boundary, /tab/);
});

// ---------------------------------------------------------------------------
// The canonical fixture
// ---------------------------------------------------------------------------

test("the preview clears both floors and is valid in both shapes", () => {
  const reports = personalHistoryPreviewFiles().map((file) => {
    const report = buildPersonalHistoryReport(file.text);
    assert.equal(report.shape, file.shape, `${file.name} was read as the wrong shape`);
    assert.deepEqual(validatePersonalHistoryReport(report).errors, [], file.name);
    assert.equal(report.state, PERSONAL_REPORT_STATE.prioritized);
    return report;
  });
  const [json, table] = reports;
  // One source, two files: the published figures have to agree, because the only
  // difference between the shapes is how the same history is spelled.
  assert.equal(json.priority.id, table.priority.id);
  assert.equal(json.priority.points, table.priority.points);
  assert.deepEqual({ ...json.coverage, attachmentsSkipped: 0 }, { ...table.coverage });
  assert.equal(json.confidence.level, table.confidence.level);
});

test("the preview demonstrates every coverage bucket rather than a clean file", () => {
  const report = buildPersonalHistoryReport(personalHistoryPreviewJson());
  const { dropped, attachmentsSkipped, distinctDays } = report.coverage;
  assert.ok(dropped.empty > 0 && dropped.undated > 0 && dropped.unreadable > 0,
    "a preview that only ever shows a clean file teaches nothing about coverage");
  assert.equal(attachmentsSkipped, 1);
  assert.equal(distinctDays, PERSONAL_PREVIEW_DAYS.length);
  assert.ok(report.coverage.ratio < 1 && report.coverage.ratio > PERSONAL_COVERAGE_FLOOR);
});
