// The coaching contract: one question, one benchmark, one improvement, and a
// refusal for everything it cannot grade.
//
// Fixtures are written in this file rather than committed, so a shape change
// fails here instead of drifting silently in a JSON blob. Every prompt below is
// hand-authored for the test and contains no real prompt, customer, or provider
// data — this workflow never had access to any.
//
// The privacy assertion at the foot of this file is the one that matters most:
// the input is untrusted text a visitor pasted, and the whole design rests on
// none of it surviving into the result. That is asserted by walking every
// string in the returned object, at every depth, rather than by review.

import test from "node:test";
import assert from "node:assert/strict";

import {
  COACHING_ANSWER, COACHING_INPUT_LIMITS, COACHING_QUESTION, COACHING_REASON,
  COACHING_RECOVERY, IMPROVEMENT_COPY, MODEL_TIER_EXAMPLES, PROMPT_COACHING_VERSION,
  composeBenchmark, gradeMyPrompt, parseCoachingInput, rankImprovements,
} from "../src/prompt-coaching.js";
import { PROSE_SIGNALS, classifyConversation } from "../src/prompt-prose-classification.js";
import { PROMPT_LITERACY_RUBRIC, letterGradeForScore } from "../src/prompt-literacy-scoring.js";
import { classifyModelTier } from "../src/provider-usage-record.js";
import { PROMPT_GRADING_THRESHOLDS } from "../src/prompt-grading-eligibility.js";

// ---------------------------------------------------------------------------
// Fixtures. Built, never committed.
// ---------------------------------------------------------------------------

/** A request that states nothing and hedges. The coaching case. */
const VAGUE = "can you improve this and fix it somehow, make it better as needed";

/** A request that states context, constraints and acceptance, laid out. */
const WELL_FORMED = [
  "Context: we run a checkout service on Node 20 behind a CDN.",
  "Constraints: do not use a new dependency and must not change the public API.",
  "The answer should be a patch to one file plus the test that fails without it.",
  "",
  "1. Explain why the retry storm starts",
  "2. Propose the smallest fix",
].join("\n");

/** Two turns, the second one a re-prompt. The efficiency case. */
const SPIRAL = [
  "User: Context: our nightly export job fails on the third batch.",
  "Explain the failure and the constraint is that we cannot change the schema.",
  "Assistant: Here is a possible cause.",
  "User: still not right, try again. as i said, the schema cannot change.",
].join("\n");

/** A distinctive token that must never appear anywhere in a result. */
const CANARY = "zqxjv-canary-7781";

/** Every string in an object graph, at every depth, including keys. */
function everyString(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) for (const entry of value) everyString(entry, found);
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      found.push(key);
      everyString(entry, found);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The rubric this module answers to
// ---------------------------------------------------------------------------

test("every prose signal carries the coaching copy its weight can produce", () => {
  for (const signal of PROSE_SIGNALS) {
    const copy = IMPROVEMENT_COPY[signal.id];
    assert.ok(copy, `${signal.id} has no coaching copy`);
    const slot = signal.weight > 0 ? copy.add : copy.fix;
    assert.ok(slot?.title && slot?.guidance, `${signal.id} states no ${signal.weight > 0 ? "add" : "fix"}`);
  }
  // And nothing extra: a copy entry for a signal that no longer exists is copy
  // no reader can ever be shown.
  const ids = new Set(PROSE_SIGNALS.map((signal) => signal.id));
  for (const id of Object.keys(IMPROVEMENT_COPY)) assert.ok(ids.has(id), `${id} is not a signal`);
});

test("every ranked improvement includes a privacy-safe rewrite the reader can use", () => {
  const result = gradeMyPrompt({ text: VAGUE });
  assert.ok(result.improvement.rewrite.length > 0);
  assert.ok(result.detail.improvements.every((entry) => entry.rewrite.length > 0));
  assert.equal(result.improvement.rewrite.includes(VAGUE), false,
    "the rewrite must not copy pasted text into the result");
});

test("each offered model tier is an identifier the shared classifier reads as that tier", () => {
  for (const [tier, identifier] of Object.entries(MODEL_TIER_EXAMPLES)) {
    assert.equal(classifyModelTier(identifier), tier,
      `"${identifier}" must classify as ${tier}, or the select lies about what it selected`);
  }
});

test("every reason code the contract can return has recovery guidance and a control", () => {
  for (const reason of Object.values(COACHING_REASON)) {
    const recovery = COACHING_RECOVERY[reason];
    assert.ok(recovery, `${reason} has no recovery guidance`);
    assert.ok(recovery.title && recovery.guidance);
    assert.equal(recovery.control, "prompt-coaching-input");
  }
});

// ---------------------------------------------------------------------------
// Reading the box
// ---------------------------------------------------------------------------

test("an unlabelled paste is one user turn", () => {
  const parsed = parseCoachingInput(VAGUE);
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.turns[0].role, "user");
  assert.equal(parsed.labelled, false);
});

test("labelled turns split on the label and keep their roles", () => {
  const parsed = parseCoachingInput(SPIRAL);
  assert.deepEqual(parsed.turns.map((turn) => turn.role), ["user", "assistant", "user"]);
  assert.equal(parsed.labelled, true);
  assert.ok(parsed.turns[0].body.startsWith("Context:"), "the label itself is not part of the turn");
});

test("a role label inside a fenced code block is code, not a turn boundary", () => {
  const parsed = parseCoachingInput([
    "Context: the parser splits on the wrong line.",
    "```",
    "user: alice",
    "system: root",
    "```",
    "Constraints: keep the fence intact.",
  ].join("\n"));
  assert.equal(parsed.turns.length, 1, "a fenced block must not be cut into three turns");
});

// ---------------------------------------------------------------------------
// The graded result
// ---------------------------------------------------------------------------

test("a vague prompt is graded, answered, benchmarked, and given exactly one move", () => {
  const result = gradeMyPrompt({ text: VAGUE });
  assert.equal(result.version, PROMPT_COACHING_VERSION);
  assert.equal(result.question, COACHING_QUESTION);
  assert.equal(result.state, "graded");
  assert.equal(result.scored, true);
  assert.equal(result.reason, null);

  // The answer comes before the figure, and it is the rubric's band, not prose
  // this module invented per result.
  assert.equal(result.answer, COACHING_ANSWER[result.benchmark.grade]);

  // One benchmark. Not two, and not a list.
  assert.equal(typeof result.benchmark.score, "number");
  assert.equal(result.benchmark.grade, letterGradeForScore(result.benchmark.score));
  assert.match(result.benchmark.text, /\/ 100 · grade [A-F]\./);

  // One improvement, with the runners-up behind the disclosure rather than
  // beside it.
  assert.equal(result.improvement.available, true);
  assert.ok(result.improvement.title && result.improvement.guidance);
  assert.ok(result.improvement.points > 0);
  assert.ok(result.detail.improvements.length >= 1);
  assert.equal(result.detail.improvements[0].id, result.improvement.id);
});

test("the composite and the letter are the classifier's, repeated and never recomputed", () => {
  const direct = classifyConversation({
    turns: parseCoachingInput(WELL_FORMED).turns, model: MODEL_TIER_EXAMPLES.premium,
  });
  const result = gradeMyPrompt({ text: WELL_FORMED, modelTier: "premium" });
  assert.equal(result.benchmark.score, direct.composite);
  assert.equal(result.benchmark.grade, direct.grade);
  assert.deepEqual(result.detail.axes.map((axis) => axis.score),
    PROMPT_LITERACY_RUBRIC.axes.map((axis) => direct.dimensions[axis.key]));
  assert.equal(result.rubricVersionId, direct.rubricVersionId);
});

test("a well-formed prompt outscores a vague one, and the answer changes with it", () => {
  const weak = gradeMyPrompt({ text: VAGUE });
  const strong = gradeMyPrompt({ text: WELL_FORMED });
  assert.ok(strong.benchmark.score > weak.benchmark.score,
    `${strong.benchmark.score} must beat ${weak.benchmark.score}`);
  assert.notEqual(strong.answer, weak.answer);
});

test("the benchmark names the next band up and how far away it is", () => {
  const benchmark = composeBenchmark(72);
  assert.equal(benchmark.grade, "C");
  assert.equal(benchmark.next.letter, "B");
  assert.equal(benchmark.next.minimumScore, 80);
  assert.equal(benchmark.next.pointsAway, 8);
  assert.match(benchmark.text, /8 points away/);
  // The top band has nothing above it, and says so rather than inventing one.
  assert.equal(composeBenchmark(95).next, null);
  assert.match(composeBenchmark(95).text, /Nothing above this band/);
});

test("a measured debit outranks a projected credit worth the same, and the order is stable", () => {
  const result = gradeMyPrompt({ text: SPIRAL });
  const ranked = result.detail.improvements;
  assert.ok(ranked.length > 1, "this fixture has both a fired debit and missing credits");
  for (let at = 1; at < ranked.length; at += 1) {
    const [left, right] = [ranked[at - 1], ranked[at]];
    assert.ok(left.points > right.points
      || (left.points === right.points && Number(left.measured) >= Number(right.measured)),
      `${left.id} must not rank below ${right.id}`);
  }
  const repeat = gradeMyPrompt({ text: SPIRAL });
  assert.deepEqual(repeat.detail.improvements, ranked, "the same paste must rank the same way");
});

test("the same paste grades identically every time — no clock, no randomness", () => {
  assert.deepEqual(gradeMyPrompt({ text: SPIRAL }), gradeMyPrompt({ text: SPIRAL }));
});

test("an unspecified model tier makes model fit abstain rather than assume one", () => {
  const unspecified = gradeMyPrompt({ text: WELL_FORMED });
  assert.equal(unspecified.observed.modelTier, "unrecognized");
  const premium = gradeMyPrompt({ text: WELL_FORMED, modelTier: "premium" });
  assert.equal(premium.observed.modelTier, "premium");
  // Both are graded; the tier changes what the model-fit axis may claim, not
  // whether an answer exists.
  assert.equal(unspecified.state, "graded");
  assert.equal(premium.state, "graded");
});

test("rankImprovements returns nothing when there is nothing scored to rank", () => {
  assert.deepEqual(rankImprovements(null), []);
  assert.deepEqual(rankImprovements({ turns: [], aggregation: null }), []);
});

test("a prompt with no room left on the coachable axis names no invented move", () => {
  const result = gradeMyPrompt({ text: WELL_FORMED, modelTier: "premium" });
  if (result.detail.improvements.length === 0) {
    assert.equal(result.improvement.available, false);
    assert.equal(result.improvement.kind, "none");
    assert.ok(result.improvement.title && result.improvement.guidance);
  } else {
    assert.equal(result.improvement.available, true);
  }
});

test("the basis says this is one text and not the organization's grade", () => {
  const result = gradeMyPrompt({ text: WELL_FORMED });
  assert.match(result.basis.label, /Partial result/);
  assert.match(result.basis.text, /this browser tab/);
  assert.match(result.basis.text, /Nothing was uploaded, saved, or attached/);
  // Noor's per-department floor, quoted rather than restated, so "this is not
  // your team's grade" carries the number that would make it one.
  assert.ok(result.basis.text.includes(
    `${PROMPT_GRADING_THRESHOLDS.minPromptsPerDepartment} classified prompts`));
});

// ---------------------------------------------------------------------------
// Everything it refuses to grade
// ---------------------------------------------------------------------------

const REFUSALS = [
  { name: "no input at all", input: {}, reason: COACHING_REASON.emptyInput },
  { name: "an empty string", input: { text: "" }, reason: COACHING_REASON.emptyInput },
  { name: "whitespace only", input: { text: "  \n\t \n " }, reason: COACHING_REASON.emptyInput },
  { name: "a non-string", input: { text: { body: "hi" } }, reason: COACHING_REASON.unsupportedInput },
  { name: "a number", input: { text: 42 }, reason: COACHING_REASON.unsupportedInput },
  {
    name: "a paste over the character ceiling",
    input: { text: "a ".repeat(COACHING_INPUT_LIMITS.maxChars) },
    reason: COACHING_REASON.tooLong,
  },
  {
    name: "a transcript over the turn ceiling",
    input: {
      text: Array.from({ length: COACHING_INPUT_LIMITS.maxTurns + 1 },
        (unused, at) => `User: turn number ${at} asking about the export job`).join("\n"),
    },
    reason: COACHING_REASON.tooManyTurns,
  },
  {
    name: "a paste with no turn of the reader's own",
    input: { text: "Assistant: here is the answer.\nSystem: you are a helpful assistant." },
    reason: COACHING_REASON.noUserTurn,
  },
  {
    name: "code and pasted material with no request in it",
    input: { text: "```\nconst x = 1;\nconst y = 2;\n```" },
    reason: COACHING_REASON.noScorableTurn,
  },
];

for (const { name, input, reason } of REFUSALS) {
  test(`${name} is refused with a reason code and recovery guidance, never a grade`, () => {
    const result = gradeMyPrompt(input);
    assert.equal(result.state, "not_gradeable");
    assert.equal(result.scored, false);
    assert.equal(result.reason, reason);
    // No half-filled result: a surface cannot accidentally render a letter.
    assert.equal(result.benchmark, null);
    assert.equal(result.improvement, null);
    assert.equal(result.answer, null);
    assert.equal(result.detail, null);
    assert.deepEqual(result.recovery, COACHING_RECOVERY[reason]);
  });
}

test("a ceiling refusal names the number the reader has to get under", () => {
  const long = gradeMyPrompt({ text: "a ".repeat(COACHING_INPUT_LIMITS.maxChars) });
  assert.equal(long.observed.maxChars, COACHING_INPUT_LIMITS.maxChars);
  assert.ok(long.observed.chars > COACHING_INPUT_LIMITS.maxChars);
  const many = gradeMyPrompt({
    text: Array.from({ length: COACHING_INPUT_LIMITS.maxTurns + 3 },
      () => "User: still failing, try again").join("\n"),
  });
  assert.equal(many.observed.maxTurns, COACHING_INPUT_LIMITS.maxTurns);
  assert.equal(many.observed.turns, COACHING_INPUT_LIMITS.maxTurns + 3);
});

test("a refusal for unreadable material carries the classifier's own turn codes", () => {
  const result = gradeMyPrompt({ text: "```\nconst x = 1;\nconst y = 2;\n```" });
  assert.ok(result.observed.turnReasonCodes.includes("no_prose"));
});

test("a prompt at the character ceiling exactly is graded, not refused", () => {
  // The ceiling is read with `>`, so the boundary value is inside it. A ceiling
  // that refused its own published number would be the one number a reader
  // trimmed to and still lost.
  const text = `Context: ${"a".repeat(COACHING_INPUT_LIMITS.maxChars - 9)}`;
  assert.equal(text.length, COACHING_INPUT_LIMITS.maxChars);
  assert.equal(gradeMyPrompt({ text }).state, "graded");
});

// ---------------------------------------------------------------------------
// Privacy. The assertion this whole design rests on.
// ---------------------------------------------------------------------------

test("no pasted text survives into a graded result, at any depth", () => {
  const text = [
    `Context: the ${CANARY} table drops rows for customer ${CANARY}@example.com.`,
    "Constraints: do not change the schema.",
    `The answer should name the ${CANARY} index.`,
    "```",
    `secret_key = "${CANARY}"`,
    "```",
  ].join("\n");
  const result = gradeMyPrompt({ text, modelTier: "premium" });
  assert.equal(result.state, "graded");
  for (const value of everyString(result)) {
    assert.ok(!value.includes(CANARY),
      `a fragment of the pasted prompt reached the result: ${value.slice(0, 80)}`);
    assert.ok(!value.includes("example.com"), "an address from the paste reached the result");
  }
});

test("no pasted text survives into a refusal either", () => {
  const result = gradeMyPrompt({ text: `\`\`\`\n${CANARY}\n${CANARY}\n\`\`\`` });
  assert.equal(result.scored, false);
  for (const value of everyString(result)) assert.ok(!value.includes(CANARY));
});

test("the result is frozen, so a surface cannot edit the grade it was handed", () => {
  const result = gradeMyPrompt({ text: VAGUE });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.benchmark));
  assert.ok(Object.isFrozen(result.improvement));
  assert.ok(Object.isFrozen(result.detail));
});
