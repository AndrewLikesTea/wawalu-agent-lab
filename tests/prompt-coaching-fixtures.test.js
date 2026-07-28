// Labelled fixtures for the coaching contract: the numbers, in writing.
//
// WHY THIS FILE EXISTS SEPARATELY FROM tests/prompt-coaching.test.js.
// That file asserts the *shape* of the contract — a refusal is a refusal, a
// result is frozen, nothing pasted survives. This file asserts the *values*:
// a labelled input, the exact score it produces, the exact reason codes in the
// exact order, the exact recommendation sentence, and the exact rewrite. Those
// are the assertions a director disputes, and a shape test cannot carry them.
//
// A GOLDEN NUMBER IS ONLY WORTH WHAT ITS DERIVATION IS WORTH. Locking a
// composite to 96 proves the module did not change; it does not prove 96 was
// ever right. So every golden below is checked twice:
//
//   1. LOCKED. `gradeMyPrompt` returns exactly this composite, letter, axis
//      subscore, category, first move, and recommendation sentence.
//   2. DERIVED. The same composite is recomputed here from the parts a reader
//      can see — each axis from its own baseline plus its own fired signal
//      contributions, the composite from the rubric's published axis weights
//      and the aggregation's own turn weights. If the recomputation and the
//      locked number disagree, the number is not explainable and the test says
//      so rather than the number quietly shipping.
//
// Fixtures are generated in this file, never committed: a shape change has to
// fail here rather than drift in a JSON blob. Every string below is
// hand-authored for the test. No real prompt, customer, provider, or telemetry
// data was available to this workflow and none is used.

import test from "node:test";
import assert from "node:assert/strict";

import {
  IMPROVEMENT_REWRITE, RECOMMENDATION_STATE, RECOMMENDATION_TIER_LADDER,
  ROUTING_CLAIM_LIMIT, gradeMyPrompt,
} from "../src/prompt-coaching.js";
import {
  DIMENSION_KEYS, PROSE_SIGNALS, TURN_REASON_CODES, classifyConversation,
} from "../src/prompt-prose-classification.js";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";

// ---------------------------------------------------------------------------
// The corpus. Generated, labelled, and never committed.
// ---------------------------------------------------------------------------

/** Enough plain prose to clear the rubric's substantive-work threshold. */
const SUBSTANTIVE_BODY = Array.from({ length: 26 }, (unused, at) =>
  `Step ${at} of the ledger migration moves one table and leaves the read path untouched.`)
  .join(" ");

/** A request that states context, constraints, acceptance, and is laid out. */
const WELL_FORMED = [
  "Context: we run a checkout service on Node 20 behind a CDN.",
  "Constraints: do not use a new dependency and must not change the public API.",
  "The answer should be a patch to one file plus the test that fails without it.",
  "",
  "1. Explain why the retry storm starts",
  "2. Propose the smallest fix",
  "",
  SUBSTANTIVE_BODY,
].join("\n");

/** A request that states nothing and hedges four times. */
const VAGUE = "can you improve this and fix it somehow, make it better as needed";

/** A mechanical errand, of the shape the model-fit debit exists to catch. */
const ERRAND = "rename the variable foo to bar and fix the typo in the header";

/**
 * A request the vocabulary table cannot read, wrapped around a log paste.
 *
 * This is the ambiguous case on purpose: the classifier can see structure and
 * pasted material but cannot read the request, so it scores what it can, says
 * what it could not, and — this is the assertion that matters — declines to
 * recommend a tier even though the reader named one and the paste is long.
 */
const UNREADABLE = [
  "Контекст: платёжный шлюз падает на третьей партии.",
  "1. почему",
  "2. что делать",
  "",
  ...Array.from({ length: 12 }, (unused, at) =>
    `2026-07-01T09:0${at % 10}:00Z ERROR ledger.batch failed id=${at} `
    + `retry=3 upstream=timeout region=eu-west-1 shard=${at}`),
  "",
  ...Array.from({ length: 40 }, (unused, at) =>
    `Строка ${at}: платёжный шлюз падает на третьей партии и нам нужно понять причину.`),
].join("\n");

/**
 * THE LABELLED FIXTURES.
 *
 * `label` is the judgement a human made about the input before the classifier
 * saw it. Everything after it is what the classifier produced, written down.
 * The two are deliberately separate columns: when a rubric change makes a
 * "strong" input score like a weak one, the disagreement is visible here rather
 * than absorbed into a re-baselined number.
 */
const FIXTURES = Object.freeze([
  {
    name: "strong: states context, constraints and acceptance, on a matched tier",
    label: "strong",
    input: { text: WELL_FORMED, modelTier: "premium" },
    composite: 96,
    grade: "A",
    axes: { intent: 100, efficiency: 85, modelFit: 100 },
    category: "highValue",
    reasonCodes: [[]],
    // Nothing this rubric penalises fired and no intent credit is left unearned.
    firstMove: null,
    ranked: [],
    recommendation: {
      state: RECOMMENDATION_STATE.fitEvidenced,
      from: "premium",
      to: "premium",
      direction: "none",
      signalId: "model-fit-substantive-on-premium",
      text: "You named a premium model, and this request is at or above the rubric's "
        + "substantive-work threshold of 150 prose units. That fired "
        + "model-fit-substantive-on-premium, the one routing credit the rubric awards, "
        + "worth 20 points on the Model fit axis. No routing change is evidenced.",
    },
  },
  {
    name: "weak: states nothing, hedges, and names no tier",
    label: "weak",
    input: { text: VAGUE },
    composite: 56,
    grade: "F",
    axes: { intent: 28, efficiency: 85, modelFit: 80 },
    category: "unclassified",
    reasonCodes: [[]],
    firstMove: "intent-states-acceptance",
    ranked: [
      "intent-states-acceptance",
      "intent-states-constraints",
      "intent-states-context",
      "intent-structured-layout",
      "intent-vague-request",
      "intent-pasted-context",
    ],
    recommendation: {
      state: RECOMMENDATION_STATE.noTierStated,
      from: null,
      to: null,
      direction: "none",
      signalId: null,
      text: "The model-fit signals read the tier you name beside the box. Without one they "
        + "abstain rather than assume, so this grade carries no routing recommendation and "
        + "the model-fit axis kept its baseline of 80.",
    },
  },
  {
    name: "ambiguous: unreadable request around a log paste, on a named tier",
    label: "ambiguous",
    input: { text: UNREADABLE, modelTier: "economy" },
    composite: 84,
    grade: "B",
    axes: { intent: 84, efficiency: 85, modelFit: 80 },
    category: "highValue",
    // Order is the declaration order of TURN_REASON_CODES, asserted below.
    reasonCodes: [["language_uncertain", "paste_heavy"]],
    firstMove: null,
    ranked: [],
    recommendation: {
      state: RECOMMENDATION_STATE.noEvidence,
      from: "economy",
      to: null,
      direction: "none",
      signalId: null,
      text: "You named an economy model and no model-fit signal fired on this text, so the "
        + "Model fit axis kept its baseline of 80. This workflow names a tier only when a "
        + "model-fit signal fired, never on the shape of a request alone.",
    },
  },
  {
    name: "under-provisioned: the same strong request, on an economy tier",
    label: "strong",
    input: { text: WELL_FORMED, modelTier: "economy" },
    composite: 87,
    grade: "B",
    axes: { intent: 100, efficiency: 85, modelFit: 55 },
    category: "highValue",
    reasonCodes: [[]],
    firstMove: "model-fit-substantive-on-economy",
    ranked: ["model-fit-substantive-on-economy"],
    recommendation: {
      state: RECOMMENDATION_STATE.routeUp,
      from: "economy",
      to: "standard",
      direction: "up",
      signalId: "model-fit-substantive-on-economy",
      text: "You named an economy model, and this request is at or above the rubric's "
        + "substantive-work threshold of 150 prose units, or the pasted-code equivalent. "
        + "That fired model-fit-substantive-on-economy, which took 25 points off the "
        + `Model fit axis. standard is the smallest move that stops the signal reading `
        + `this turn. ${ROUTING_CLAIM_LIMIT}`,
    },
  },
  {
    name: "over-provisioned: a mechanical errand on a premium tier",
    label: "weak",
    input: { text: ERRAND, modelTier: "premium" },
    composite: 50,
    grade: "F",
    axes: { intent: 40, efficiency: 85, modelFit: 20 },
    category: "overProvisioned",
    reasonCodes: [[]],
    firstMove: "model-fit-trivial-on-premium",
    ranked: [
      "model-fit-trivial-on-premium",
      "intent-states-acceptance",
      "intent-states-constraints",
      "intent-states-context",
      "intent-structured-layout",
      "intent-pasted-context",
    ],
    recommendation: {
      state: RECOMMENDATION_STATE.routeDown,
      from: "premium",
      to: "standard",
      direction: "down",
      signalId: "model-fit-trivial-on-premium",
      text: "You named a premium model, and this request is at or below the rubric's "
        + "mechanical-errand threshold of 60 prose units with a mechanical-edit phrasing "
        + "in it. That fired model-fit-trivial-on-premium, which took 60 points off the "
        + `Model fit axis. standard is the smallest move that stops the signal reading `
        + `this turn. ${ROUTING_CLAIM_LIMIT}`,
    },
  },
]);

/** Inputs that must never produce a score, a letter, or a tier. */
const INVALID = Object.freeze([
  { name: "invalid: nothing pasted", input: { text: "   \n\t " }, reason: "empty_input" },
  { name: "invalid: not text at all", input: { text: [1, 2] }, reason: "unsupported_input" },
  {
    name: "invalid: code with no request in it",
    input: { text: "```\nconst x = 1;\nconst y = 2;\n```", modelTier: "premium" },
    reason: "no_scorable_turn",
  },
  {
    name: "invalid: nothing of the reader's own",
    input: { text: "Assistant: here is the answer.\nSystem: be helpful." },
    reason: "no_user_turn",
  },
]);

// ---------------------------------------------------------------------------
// 1. The locked values
// ---------------------------------------------------------------------------

for (const fixture of FIXTURES) {
  test(`${fixture.name} — scores exactly what it is written down as`, () => {
    const result = gradeMyPrompt(fixture.input);
    assert.equal(result.state, "graded");
    assert.equal(result.benchmark.score, fixture.composite);
    assert.equal(result.benchmark.grade, fixture.grade);
    assert.deepEqual(
      Object.fromEntries(result.detail.axes.map((axis) => [axis.key, axis.score])),
      fixture.axes,
    );
    assert.equal(result.detail.category, fixture.category);
  });

  test(`${fixture.name} — ranks the same moves in the same order`, () => {
    const result = gradeMyPrompt(fixture.input);
    assert.deepEqual(result.detail.improvements.map((entry) => entry.id), fixture.ranked);
    assert.equal(result.improvement.id, fixture.firstMove);
    assert.equal(result.improvement.available, fixture.firstMove !== null);
  });

  test(`${fixture.name} — emits its reason codes in a stable order`, () => {
    const result = gradeMyPrompt(fixture.input);
    assert.deepEqual(result.detail.turns.map((turn) => [...turn.reasonCodes]),
      fixture.reasonCodes);
  });

  test(`${fixture.name} — states exactly one tier recommendation, word for word`, () => {
    const { recommendation } = gradeMyPrompt(fixture.input);
    const { text, ...fields } = fixture.recommendation;
    assert.equal(recommendation.text, text);
    for (const [key, value] of Object.entries(fields)) {
      assert.equal(recommendation[key], value, `recommendation.${key}`);
    }
    assert.equal(recommendation.evidenced, fields.signalId !== null);
  });

  test(`${fixture.name} — grades identically on a second run`, () => {
    assert.deepEqual(gradeMyPrompt(fixture.input), gradeMyPrompt(fixture.input));
  });
}

test("every graded fixture hands back a rewrite that is the signal's own template", () => {
  for (const fixture of FIXTURES) {
    const { improvement } = gradeMyPrompt(fixture.input);
    if (fixture.firstMove === null) {
      assert.equal(improvement.rewrite, null, `${fixture.label}: no move, so no rewrite`);
      continue;
    }
    // Identity with the declared template is the whole assertion: a static
    // constant cannot contain the paste, whatever the paste was. The rewrite is
    // deliberately not an interpolation of the input, so "usable" and "never
    // echoes the prompt" are the same property here rather than two.
    assert.equal(improvement.rewrite, IMPROVEMENT_REWRITE[fixture.firstMove]);
    assert.ok(improvement.rewrite.length > 0);
  }
});

test("a distinctive token in the paste reaches neither the rewrite nor the recommendation", () => {
  const canary = "zqxjv-canary-7781";
  for (const tier of [undefined, "premium", "standard", "economy"]) {
    const result = gradeMyPrompt({
      text: `Context: rename the ${canary} column, and ${canary}@example.com asked for it.`
        + `\nsomething ${canary} as needed`,
      modelTier: tier,
    });
    assert.equal(result.state, "graded");
    for (const value of [result.improvement.rewrite ?? "", result.improvement.title,
      result.improvement.guidance, result.recommendation.title, result.recommendation.text]) {
      assert.equal(value.includes(canary), false, `a paste fragment reached: ${value}`);
      assert.equal(value.includes("example.com"), false, "an address from the paste reached copy");
    }
  }
});

// ---------------------------------------------------------------------------
// 2. The derivation. What makes the locked numbers explainable rather than
//    merely stable.
// ---------------------------------------------------------------------------

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const { subscoreDecimals, compositeDecimals } = PROMPT_LITERACY_RUBRIC.reporting;

test("each axis subscore is its own baseline plus its own fired contributions", () => {
  for (const fixture of FIXTURES) {
    const graded = classifyConversation({
      turns: [{ role: "user", body: fixture.input.text }],
      model: fixture.input.modelTier
        ? { premium: "ultra", standard: "pro", economy: "mini" }[fixture.input.modelTier]
        : undefined,
    });
    for (const turn of graded.reasons.turns.filter((entry) => entry.scored)) {
      for (const axis of DIMENSION_KEYS) {
        const { baseline, score, signals } = turn.dimensions[axis];
        const rebuilt = round(Math.min(100, Math.max(0, signals.reduce(
          (sum, signal) => sum + signal.contribution, baseline,
        ))), subscoreDecimals);
        assert.equal(score, rebuilt,
          `${fixture.label}/${axis}: ${score} is not ${baseline} plus its signals`);
      }
    }
  }
});

test("the composite is the rubric's published axis weights over the aggregated axes", () => {
  for (const fixture of FIXTURES) {
    const result = gradeMyPrompt(fixture.input);
    const axes = Object.fromEntries(result.detail.axes.map((axis) => [axis.key, axis.score]));
    const rebuilt = round(PROMPT_LITERACY_RUBRIC.axes.reduce(
      (sum, axis) => sum + axis.weightPercent * axes[axis.key], 0,
    ) / 100, compositeDecimals);
    assert.equal(result.benchmark.score, rebuilt,
      `${fixture.label}: ${result.benchmark.score} is not the weighted axis mean ${rebuilt}`);
    // And the weights it was computed from sum to the whole, so no share of the
    // score is unaccounted for.
    assert.equal(PROMPT_LITERACY_RUBRIC.axes.reduce((sum, a) => sum + a.weightPercent, 0), 100);
  }
});

test("reason codes come out in the classifier's declaration order, not in match order", () => {
  const order = Object.values(TURN_REASON_CODES);
  for (const fixture of FIXTURES) {
    for (const turn of gradeMyPrompt(fixture.input).detail.turns) {
      const positions = turn.reasonCodes.map((code) => order.indexOf(code));
      assert.ok(positions.every((at) => at >= 0),
        `${fixture.label}: a reason code outside TURN_REASON_CODES`);
      assert.deepEqual(positions, [...positions].sort((left, right) => left - right),
        `${fixture.label}: reason codes are not in declaration order`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Traceability. Every displayed claim maps back to a rubric signal.
// ---------------------------------------------------------------------------

const SIGNAL_IDS = new Set(PROSE_SIGNALS.map((signal) => signal.id));

test("every coaching claim a reader is shown names a signal the classifier fired or withheld",
  () => {
    for (const fixture of FIXTURES) {
      const result = gradeMyPrompt(fixture.input);
      for (const entry of result.detail.improvements) {
        assert.ok(SIGNAL_IDS.has(entry.id), `${entry.id} is not a rubric signal`);
        assert.ok(result.detail.assumptions[entry.assumptionKey],
          `${entry.id} displays a claim with no stated assumption`);
      }
      const { recommendation } = result;
      if (!recommendation.evidenced) {
        assert.equal(recommendation.signalId, null);
        assert.equal(recommendation.assumptionKey, null);
        assert.equal(recommendation.to, null);
        continue;
      }
      assert.ok(SIGNAL_IDS.has(recommendation.signalId));
      assert.ok(result.detail.assumptions[recommendation.assumptionKey],
        "a tier recommendation with no stated assumption behind it");
      // The signal it cites really did fire, in the turn it says it fired in.
      const turn = result.detail.turns[recommendation.turn];
      assert.ok(turn?.scored, "a recommendation cited an unscored turn");
      assert.ok(RECOMMENDATION_TIER_LADDER.includes(recommendation.to));
    }
  });

test("a recommended tier is always one step from the tier the reader named", () => {
  for (const fixture of FIXTURES.filter((entry) => entry.recommendation.to)) {
    const { from, to, direction } = gradeMyPrompt(fixture.input).recommendation;
    const step = RECOMMENDATION_TIER_LADDER.indexOf(to)
      - RECOMMENDATION_TIER_LADDER.indexOf(from);
    assert.equal(step, { up: -1, down: 1, none: 0 }[direction],
      `${fixture.label}: ${from} to ${to} is not one ${direction} step`);
  }
});

// ---------------------------------------------------------------------------
// 4. The prior rejection, asserted rather than promised.
// ---------------------------------------------------------------------------
//
// Route-up guidance once read "costs quality rather than money, and the cost
// lands on you in re-prompts". Nothing in this repository measures answer
// quality, a re-prompt attributable to a tier, or a dollar, so that clause was
// an outcome claim with no signal behind it. This is the test that keeps it
// from coming back — in that sentence or in any reworded successor.

/** Vocabulary that asserts an outcome this rubric does not observe. */
const UNBACKED_CLAIM = Object.freeze([
  /\bre-?prompts?\b/i, /\bquality\b/i, /\bsavings?\b/i, /\bcheaper\b/i, /\bfaster\b/i,
  /\bcosts? (you|the company|more|less)\b/i, /\bdollars?\b/i, /\$/, /\bwill (be|get|need)\b/i,
]);

test("no routing copy claims an outcome the rubric never observed", () => {
  for (const fixture of FIXTURES) {
    const result = gradeMyPrompt(fixture.input);
    const routing = [result.recommendation.title, result.recommendation.text];
    if (result.improvement.id?.startsWith("model-fit")) {
      routing.push(result.improvement.title, result.improvement.guidance);
    }
    for (const sentence of routing) {
      // The bounding sentence is allowed to name what is *not* measured; it is
      // the disclaimer, so it is excluded from the scan for claims.
      const claimed = sentence.split(ROUTING_CLAIM_LIMIT).join(" ");
      for (const pattern of UNBACKED_CLAIM) {
        assert.equal(pattern.test(claimed), false,
          `${fixture.label}: routing copy claims "${pattern}": ${claimed}`);
      }
    }
  }
});

test("every route-changing recommendation carries the sentence that bounds it", () => {
  for (const fixture of FIXTURES) {
    const { recommendation } = gradeMyPrompt(fixture.input);
    const routes = recommendation.direction !== "none";
    assert.equal(recommendation.text.includes(ROUTING_CLAIM_LIMIT), routes,
      `${fixture.label}: a tier change must state what it does not measure`);
  }
});

test("the answer bands predict no outcome the rubric does not observe", async () => {
  const { COACHING_ANSWER } = await import("../src/prompt-coaching.js");
  for (const [letter, sentence] of Object.entries(COACHING_ANSWER)) {
    assert.equal(/\bre-?prompts?\b/i.test(sentence), false,
      `grade ${letter} predicts a re-prompt, which no signal measures`);
  }
});

// ---------------------------------------------------------------------------
// 5. Invalid input never reaches a tier recommendation.
// ---------------------------------------------------------------------------

for (const { name, input, reason } of INVALID) {
  test(`${name} — refused with a code, and with no tier recommendation`, () => {
    const result = gradeMyPrompt(input);
    assert.equal(result.state, "not_gradeable");
    assert.equal(result.reason, reason);
    assert.equal(result.recommendation, null,
      "a refusal must not carry a routing claim: nothing was classified");
    assert.equal(result.benchmark, null);
    assert.equal(result.improvement, null);
    assert.equal(result.detail, null);
    assert.ok(result.recovery.title && result.recovery.guidance);
  });
}

test("the labelled corpus covers every state the recommendation contract can return", () => {
  const seen = new Set(FIXTURES.map((fixture) => fixture.recommendation.state));
  for (const state of Object.values(RECOMMENDATION_STATE)) {
    assert.ok(seen.has(state), `no labelled fixture produces ${state}`);
  }
});
