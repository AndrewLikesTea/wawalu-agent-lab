// The prose classifier held to its published corpus.
//
// The corpus is data (`tests/fixtures/prompt-prose/corpus.js`) and the doc is
// prose (`docs/prompt-prose-rubric.md`); this file is only the harness that
// makes them binding. A grade that a director can reproduce on paper is the
// whole product here, so the first test asserts the published letter and every
// published number, and the rest defend the properties those numbers rest on.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";
import {
  AGGREGATION_ASSUMPTION, AGGREGATION_RULE_ID, CONVERSATION_REASON_CODES,
  CONVERSATION_TURN_WEIGHT_FLOOR, DIMENSION_BASELINES, MINIMUM_RATE_DENOMINATOR_UNITS,
  PROSE_CLASSIFIER_VERSION, PROSE_REASONS_SCHEMA, PROSE_SIGNALS, SIGNAL_ASSUMPTIONS,
  TURN_REASON_CODES, aggregateTurnScores, classifyConversation, classifyPromptTurn,
  promptCorpusCoverage,
} from "../src/prompt-prose-classification.js";
import { UNCLASSIFIED_CATEGORY } from "../src/query-classification.js";
import { NON_LATIN_SCRIPT_THRESHOLD, segmentPromptBody } from "../src/prompt-prose-segmentation.js";
import { PROMPT_PROSE_CORPUS } from "./fixtures/prompt-prose/corpus.js";

const graded = () => PROMPT_PROSE_CORPUS.map((fixture) => ({
  fixture, result: classifyConversation({ turns: fixture.turns, model: fixture.model }),
}));

test("every fixture reproduces its published grade, exactly", () => {
  for (const { fixture, result } of graded()) {
    const expected = fixture.expected;
    assert.equal(result.grade, expected.grade, `${fixture.id} grade`);
    assert.equal(result.composite, expected.composite, `${fixture.id} composite`);
    assert.deepEqual(result.dimensions, expected.dimensions, `${fixture.id} dimensions`);
    assert.equal(result.category, expected.category, `${fixture.id} category`);
    assert.equal(
      result.reasons.turns.filter((turn) => turn.role === "user" && !turn.scored).length,
      expected.unscoredTurns, `${fixture.id} unscored user turns`,
    );
    // The letter is the rubric's own, not a second cutoff table living here.
    const band = PROMPT_LITERACY_RUBRIC.grades.find((entry) => entry.letter === expected.grade);
    assert.ok(result.composite >= band.minimumScore, `${fixture.id} sits inside its band`);
    // The derivation is the artifact a director checks the number against, so a
    // fixture without one is a number nobody can dispute on paper.
    assert.ok(fixture.derivation.length >= 120, `${fixture.id} states its arithmetic`);
  }
});

test("the corpus covers every band, every category, and every messy case", () => {
  const results = graded();
  const letters = new Set(results.map(({ result }) => result.grade));
  for (const grade of PROMPT_LITERACY_RUBRIC.grades) {
    assert.ok(letters.has(grade.letter), `no fixture grades ${grade.letter}`);
  }
  const categories = new Set(results.map(({ result }) => result.category));
  for (const category of PROMPT_LITERACY_RUBRIC.categories) {
    assert.ok(categories.has(category.key), `no fixture is ${category.key}`);
  }
  assert.ok(categories.has(UNCLASSIFIED_CATEGORY), "no fixture lands outside the four names");
  const covered = new Set(PROMPT_PROSE_CORPUS.flatMap((fixture) => fixture.covers));
  for (const shape of ["multi-turn", "large-code-block", "mostly-pasted-context",
    "very-short-prompt", "very-long-prompt", "non-english", "mixed-language", "no-prose"]) {
    assert.ok(covered.has(shape), `the corpus claims no ${shape} fixture`);
  }
  const ids = PROMPT_PROSE_CORPUS.map((fixture) => fixture.id);
  assert.equal(new Set(ids).size, ids.length, "fixture ids are unique");
});

test("fixtures that name a reason code get exactly that code", () => {
  for (const { fixture, result } of graded()) {
    if (!fixture.expected.turnReasonCodes) continue;
    assert.deepEqual(
      result.reasons.turns.slice(0, fixture.expected.turnReasonCodes.length)
        .map((turn) => [...turn.reasonCodes]),
      fixture.expected.turnReasonCodes, `${fixture.id} reason codes`,
    );
  }
});

/**
 * THE CEILING.
 *
 * 0.10, against a measured 0.0333 (one user turn in thirty) at the time of
 * writing. The one turn is the code-only turn in `x-code-only-turn`, which has
 * no prose in it and *should* be refused — a classifier that graded it would be
 * inventing a score. The margin is three times the measured rate rather than a
 * hair above it, because the corpus is small enough that adding one honest
 * no-prose fixture moves the rate by three points, and a ceiling that fires on
 * a new fixture rather than on a regression would be trained away within a
 * month. It is nowhere near loose enough to hide a real failure: the classifier
 * silently dropping so much as one ordinary prose turn takes the rate to 0.067,
 * and dropping the non-English fixtures — the regression this test exists for —
 * takes it past 0.10 immediately.
 */
const UNCLASSIFIED_RATE_CEILING = 0.10;

test("the corpus's unclassified rate stays under the published ceiling", () => {
  const coverage = promptCorpusCoverage(graded().map(({ result }) => result));
  assert.ok(coverage.turns >= 25, "the corpus is too small to measure a rate against");
  assert.ok(coverage.unclassifiedRate <= UNCLASSIFIED_RATE_CEILING,
    `unclassified rate ${coverage.unclassifiedRate} exceeds ${UNCLASSIFIED_RATE_CEILING}`);
  // Every refusal is a *named* refusal. An unnamed one is the failure mode this
  // ceiling cannot see: a turn dropped for no stated reason.
  for (const { result } of graded()) {
    for (const turn of result.reasons.turns) {
      if (turn.scored) continue;
      assert.ok(turn.reasonCodes.some((code) => code === TURN_REASON_CODES.noProse
        || code === TURN_REASON_CODES.notAUserTurn), "a refusal without a reason");
    }
  }
});

test("no prompt text survives into a score or its reasons payload", () => {
  const sentinel = "ZQX-PROSE-SENTINEL-4417";
  const result = classifyConversation({
    model: "gpt-4o",
    turns: [
      { role: "user", body: `Context: ${sentinel} is failing.\nConstraints: must not change ${sentinel}.dat\n`
        + "Acceptance criteria: a passing test.\n```js\nconst secret = \"" + sentinel + "\";\n```" },
      { role: "user", body: `still not working, try again with ${sentinel}` },
    ],
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(sentinel), "the sentinel reached the result");
  assert.ok(!serialized.includes("failing"), "a matched word reached the result");
  assert.ok(!serialized.includes(".dat"), "a filename from the prompt reached the result");
  // And nothing that is not a number, a boolean, a null, or an identifier this
  // module owns is in there at all — the allowlist, checked rather than trusted.
  const identifiers = new Set([
    PROSE_CLASSIFIER_VERSION, AGGREGATION_RULE_ID, result.rubricVersionId, "user", "other",
    "presence", "rate", "premium", "standard", "economy", "unrecognized",
    ...Object.values(TURN_REASON_CODES), ...PROSE_SIGNALS.map((s) => s.id),
    ...PROSE_SIGNALS.map((s) => s.dimension), ...Object.keys(SIGNAL_ASSUMPTIONS),
    ...PROMPT_LITERACY_RUBRIC.categories.map((c) => c.key), UNCLASSIFIED_CATEGORY,
    ...PROMPT_LITERACY_RUBRIC.grades.map((g) => g.letter), "aggregation", null,
  ]);
  const walk = (value) => {
    if (value === null || typeof value === "number" || typeof value === "boolean") return;
    if (typeof value === "string") {
      assert.ok(identifiers.has(value), `unexpected string in the payload: ${value}`);
      return;
    }
    for (const entry of Object.values(value)) walk(entry);
  };
  walk(result);
});

test("length does not buy a score", () => {
  const stated = "Context: the settlement service drifts.\nConstraints: must not change the "
    + "contract.\nAcceptance criteria: a report naming the source.";
  const padding = " The queue reader hands off to the writer once per minute and we watch the "
    + "depth at the end of each minute.";
  const short = classifyConversation({ turns: [{ role: "user", body: stated }], model: "claude-sonnet-4" });
  const long = classifyConversation({
    turns: [{ role: "user", body: stated + padding.repeat(30) }], model: "claude-sonnet-4",
  });
  assert.ok(long.reasons.turns[0].segments.proseUnits
    > short.reasons.turns[0].segments.proseUnits * 10, "the long body is not longer");
  assert.equal(long.dimensions.intent, short.dimensions.intent);
  assert.equal(long.dimensions.efficiency, short.dimensions.efficiency);
  // Repeating a marker is worth what saying it once is worth, for the same reason.
  const repeated = classifyConversation({
    turns: [{ role: "user", body: [stated, stated, stated].join("\n") }], model: "claude-sonnet-4",
  });
  assert.equal(repeated.dimensions.intent, short.dimensions.intent);
});

test("a debit is a rate against a floored denominator, not a count", () => {
  const one = classifyPromptTurn({ role: "user", body: "make it better somehow" });
  const spread = classifyPromptTurn({
    role: "user",
    body: "Please make it better somehow. " + "The reconciliation window closes at midnight "
      + "and the report goes to the finance team the following morning. ".repeat(12),
  });
  const debit = (turn) => turn.dimensions.intent.signals.find((s) => s.id === "intent-vague-request");
  // The short turn is priced against the 25-unit floor rather than its own four
  // words, and it saturates. The long one states the same two hedges as a much
  // smaller rate, and pays proportionally less.
  assert.equal(debit(one).strength, 1);
  assert.ok(debit(spread).strength < 1, "a hedge in a long turn cost the full weight");
  assert.ok(spread.segments.proseUnits > MINIMUM_RATE_DENOMINATOR_UNITS);
  assert.ok(spread.dimensions.intent.score > one.dimensions.intent.score);
});

test("code and pasted material leave the denominator and fire no prose pattern", () => {
  const prose = "Here is the handler. What blocks?";
  const code = "```js\n// try again, no I meant the other one, rename this\nconst x = 1;\n```";
  const bare = classifyPromptTurn({ role: "user", body: prose }, { model: "gpt-4o" });
  const withCode = classifyPromptTurn({ role: "user", body: `${prose}\n${code}` }, { model: "gpt-4o" });
  assert.equal(withCode.segments.proseUnits, bare.segments.proseUnits);
  assert.equal(withCode.segments.codeBlocks, 1);
  assert.deepEqual(withCode.dimensions, bare.dimensions,
    "a pattern fired inside a code block");
  assert.ok(withCode.reasonCodes.includes(TURN_REASON_CODES.codeHeavy));
  // Pasted material is a signal, not a silence: it credits intent rather than
  // vanishing, and it stays out of the length that debits are priced against.
  const paste = `${prose}\n\n${Array.from({ length: 10 },
    (unused, row) => `2026-07-01T09:0${row}:00Z ERROR worker=${row} status=timeout`).join("\n")}`;
  const withPaste = classifyPromptTurn({ role: "user", body: paste }, { model: "gpt-4o" });
  assert.equal(withPaste.segments.proseUnits, bare.segments.proseUnits);
  assert.equal(withPaste.segments.pastedBlocks, 1);
  assert.ok(withPaste.dimensions.intent.signals.some((s) => s.id === "intent-pasted-context"));
});

test("a non-English turn is scored and said to be uncertain, never dropped", () => {
  for (const body of [
    "夜間の照合ジョブが先月より四十分ほど遅く終わっています。原因を教えてください。",
    "Объясни, почему ночная сверка стала занимать больше времени.",
    "야간 대사 작업이 지난달보다 사십 분 늦게 끝납니다. 원인을 알려주세요.",
    "لماذا تستغرق عملية التسوية الليلية وقتا أطول من الشهر الماضي؟",
  ]) {
    const turn = classifyPromptTurn({ role: "user", body });
    assert.equal(turn.scored, true, "a non-English turn was refused");
    assert.notEqual(turn.dimensions, null);
    assert.ok(turn.segments.nonLatinLetterShare >= NON_LATIN_SCRIPT_THRESHOLD);
    assert.ok(turn.reasonCodes.includes(TURN_REASON_CODES.languageUncertain),
      "a non-English turn was graded without saying so");
    // Scored above the English no-signal baseline, which is the point: we are
    // reporting that we could not read it, not that it said nothing.
    assert.ok(turn.dimensions.intent.score > DIMENSION_BASELINES.intent);
    // Unspaced scripts are sized in prose units rather than read as three words.
    assert.ok(turn.segments.proseUnits >= 8, "an unspaced script was read as a few words");
  }
});

test("a mixed turn keeps its credits and is spared its debits", () => {
  const mixed = "Context: 夜間の照合バッチが遅い。The batch is slow. 原因を三つ挙げてください。"
    + "somehow make it better 状況を説明してください。";
  const turn = classifyPromptTurn({ role: "user", body: mixed });
  assert.ok(turn.reasonCodes.includes(TURN_REASON_CODES.languageMixed));
  const fired = turn.dimensions.intent.signals.map((signal) => signal.id);
  assert.ok(fired.includes("intent-states-context"), "a credit was withheld from a mixed turn");
  assert.ok(!fired.includes("intent-vague-request"),
    "a debit fired on a turn whose language we said we could not read");
});

test("aggregation happens in one function, and states its own rule", () => {
  const turns = [
    classifyPromptTurn({ role: "user", body: "Context: a long and careful opening. "
      + "The reconciliation window closes at midnight. ".repeat(20) }, { index: 0 }),
    classifyPromptTurn({ role: "user", body: "try again" }, { index: 1 }),
  ];
  const aggregate = aggregateTurnScores(turns);
  assert.equal(aggregate.rule, AGGREGATION_RULE_ID);
  assert.equal(aggregate.weightFloor, CONVERSATION_TURN_WEIGHT_FLOOR);
  assert.deepEqual([...aggregate.turnWeights],
    [turns[0].segments.proseUnits, CONVERSATION_TURN_WEIGHT_FLOOR]);
  // Recomputed here from the turn scores and the published weights — the check a
  // director would do on paper, and the reason the rule may live in only one place.
  const total = aggregate.turnWeights.reduce((sum, weight) => sum + weight, 0);
  const byHand = (axis) => (turns[0].dimensions[axis].score * aggregate.turnWeights[0]
    + turns[1].dimensions[axis].score * aggregate.turnWeights[1]) / total;
  for (const axis of ["intent", "efficiency", "modelFit"]) {
    assert.equal(aggregate.dimensions[axis], Math.round(byHand(axis) * 10) / 10);
  }
  assert.equal(aggregate.composite, Math.round(PROMPT_LITERACY_RUBRIC.axes
    .reduce((sum, axis) => sum + axis.weightPercent * byHand(axis.key), 0) / 100));
  // The conversation door publishes exactly what this function returned.
  const conversation = classifyConversation({
    turns: [{ role: "user", body: "Context: a long and careful opening. "
      + "The reconciliation window closes at midnight. ".repeat(20) },
    { role: "user", body: "try again" }],
  });
  assert.deepEqual(conversation.dimensions, aggregate.dimensions);
  assert.equal(conversation.composite, aggregate.composite);
  assert.match(AGGREGATION_ASSUMPTION, /weight by prose length/);
});

test("the signal table is readable as data and every weight states an assumption", () => {
  const axes = new Set(PROMPT_LITERACY_RUBRIC.axes.map((axis) => axis.key));
  const ids = new Set();
  for (const signal of PROSE_SIGNALS) {
    assert.ok(axes.has(signal.dimension), `${signal.id} names no rubric axis`);
    assert.ok(["presence", "rate"].includes(signal.kind), `${signal.id} kind`);
    assert.ok(Number.isInteger(signal.weight) && signal.weight !== 0, `${signal.id} weight`);
    assert.ok(SIGNAL_ASSUMPTIONS[signal.assumptionKey].length >= 80, `${signal.id} assumption`);
    assert.ok(signal.pattern || signal.derived, `${signal.id} reads nothing`);
    assert.ok(!ids.has(signal.id), `${signal.id} is declared twice`);
    ids.add(signal.id);
  }
  // A rate signal must be a global pattern or it can only ever count one match.
  for (const signal of PROSE_SIGNALS.filter((entry) => entry.kind === "rate")) {
    assert.ok(signal.pattern.flags.includes("g"), `${signal.id} counts at most one match`);
  }
  assert.match(PROSE_REASONS_SCHEMA.guarantee, /never|No field/i);
});

test("classification is pure: same input, same result, whatever the order", () => {
  const inputs = PROMPT_PROSE_CORPUS.map((fixture) =>
    () => classifyConversation({ turns: fixture.turns, model: fixture.model }));
  const first = inputs.map((run) => JSON.stringify(run()));
  for (let pass = 0; pass < 3; pass += 1) {
    assert.deepEqual([...inputs].reverse().map((run) => JSON.stringify(run())).reverse(), first);
  }
});

test("nothing to read is a named refusal, never a grade", () => {
  for (const conversation of [undefined, {}, { turns: [] }, { turns: null }]) {
    const result = classifyConversation(conversation);
    assert.equal(result.scored, false);
    assert.equal(result.grade, null);
    assert.equal(result.composite, null);
    assert.equal(result.category, UNCLASSIFIED_CATEGORY);
    assert.equal(result.reason, CONVERSATION_REASON_CODES.noTurns);
  }
  const codeOnly = classifyConversation({ turns: [{ role: "user", body: "```\nx = 1\n```" }] });
  assert.equal(codeOnly.scored, false);
  assert.equal(codeOnly.reason, CONVERSATION_REASON_CODES.noScorableTurn);
  assert.equal(codeOnly.reasons.turns[0].reasonCodes[0], TURN_REASON_CODES.noProse);
  // A turn body that is not a string is empty, not an exception carrying a value.
  for (const body of [undefined, null, 42, {}, []]) {
    assert.equal(classifyPromptTurn({ role: "user", body }).scored, false);
  }
});

test("the published doc lists every signal, so the paper trail cannot drift", async () => {
  const doc = await readFile(new URL("../docs/prompt-prose-rubric.md", import.meta.url), "utf8");
  for (const signal of PROSE_SIGNALS) {
    assert.ok(doc.includes(signal.id), `the rubric doc does not list ${signal.id}`);
    // The doc writes debits with a typographic minus, so the magnitude is what is
    // compared; the sign is carried by the column it sits in.
    assert.ok(doc.includes(String(Math.abs(signal.weight))), `the doc omits ${signal.id}'s weight`);
  }
  for (const baseline of Object.values(DIMENSION_BASELINES)) {
    assert.ok(doc.includes(String(baseline)), `the doc omits a baseline (${baseline})`);
  }
  assert.ok(doc.includes(AGGREGATION_RULE_ID), "the doc omits the aggregation rule id");
  assert.ok(doc.includes(String(UNCLASSIFIED_RATE_CEILING)),
    "the doc omits the unclassified-rate ceiling");
});

test("segmentation reports counts and never the text it counted", () => {
  const sentinel = "ZQX-SEGMENT-SENTINEL-2210";
  const { signals } = segmentPromptBody(`Context: ${sentinel}\n\n> ${sentinel}\n> ${sentinel}\n> ${sentinel}`);
  assert.ok(!JSON.stringify(signals).includes(sentinel));
  for (const [key, value] of Object.entries(signals)) {
    const kind = value === null ? "null" : typeof value;
    assert.ok(["number", "boolean", "null"].includes(kind)
      || key === "dominantNonLatinScript", `${key} is a ${kind}`);
  }
});
