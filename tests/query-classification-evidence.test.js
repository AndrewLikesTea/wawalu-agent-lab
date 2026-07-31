// The evidence trail on a classification.
//
// The rule ids were always published; what was missing was the token that fired
// and the shape a surface can print without first asking whether a class was
// assigned. These tests hold both, and hold the containment argument that lets a
// token be published at all: a signal always fires the rule it is attributed to,
// and is never a span of the requester's own text around one.

import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SIGNAL_LENGTH, MINIMUM_CLASSIFICATION_CONFIDENCE, QUERY_CLASSIFICATION_RULES,
  UNCLASSIFIED_CATEGORY, UNCLASSIFIED_REASONS, classifyQuery, classifyThread,
} from "../src/query-classification.js";

const EVIDENCE_KEYS = ["class", "confidence", "patternId", "signal", "unclassifiedReason"];

/** One excerpt per assignable class, with the token each is expected to publish. */
const ASSIGNABLE = [
  {
    category: "outOfScope", model: "gpt-4o", signal: "recipe", patternId: "out-of-scope-personal",
    excerpt: "give me a recipe for dinner",
  },
  {
    category: "inefficient", model: "gpt-4o", signal: "try again", patternId: "inefficient-repeat",
    excerpt: "try again, that did not work",
  },
  {
    category: "overProvisioned", model: "gpt-4o", signal: "rename",
    patternId: "over-provisioned-trivial-on-premium",
    excerpt: "rename this variable to invoiceTotal",
  },
  {
    category: "highValue", model: "gpt-4o", signal: "context:", patternId: "high-value-context",
    excerpt: "Context: the ledger reconciliation fails. Constraints: idempotent. "
      + "Expected output: a patch.",
  },
];

test("every assignable class publishes the token and the rule that decided it", () => {
  for (const expected of ASSIGNABLE) {
    const result = classifyQuery({ excerpt: expected.excerpt, model: expected.model });
    assert.equal(result.category, expected.category, expected.excerpt);
    const { evidence } = result;
    assert.deepEqual(Object.keys(evidence).sort(), EVIDENCE_KEYS);
    assert.equal(evidence.class, expected.category);
    assert.equal(evidence.signal, expected.signal);
    assert.equal(evidence.patternId, expected.patternId);
    // Not invented per call: the number beside it is the one the result publishes.
    assert.equal(evidence.confidence, result.confidence);
    assert.ok(evidence.confidence >= MINIMUM_CLASSIFICATION_CONFIDENCE);
    assert.equal(evidence.unclassifiedReason, null);
  }
});

test("a published signal always fires the rule it is attributed to", () => {
  const byId = new Map(QUERY_CLASSIFICATION_RULES.map((rule) => [rule.id, rule]));
  for (const expected of ASSIGNABLE) {
    const { evidence } = classifyQuery({ excerpt: expected.excerpt, model: expected.model });
    const rule = byId.get(evidence.patternId);
    assert.ok(rule, `${evidence.patternId} names no rule`);
    assert.ok(rule.pattern.test(evidence.signal),
      `signal "${evidence.signal}" does not fire ${rule.id}`);
    assert.ok(evidence.signal.length <= MAX_SIGNAL_LENGTH);
  }
});

test("a signal carries no text the requester wrote around the phrase", () => {
  const secret = "ACCOUNT-4417-MERGER-TARGET";
  const result = classifyQuery({
    excerpt: `please write me a poem about ${secret} for the ${secret} party`,
    model: "gpt-4o",
  });
  assert.equal(result.category, "outOfScope");
  assert.equal(result.evidence.signal, "write me a poem");
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("a pathological excerpt cannot grow the stored signal", () => {
  const flood = `${"context:".repeat(4_000)} ${"x".repeat(50_000)}`;
  const { evidence } = classifyQuery({ excerpt: flood, model: "gpt-4o" });
  assert.ok(evidence.signal === null || evidence.signal.length <= MAX_SIGNAL_LENGTH);
});

test("each unclassified reason is reachable, and publishes no signal", () => {
  const cases = [
    [UNCLASSIFIED_REASONS.noExcerpt, () => classifyQuery({ excerpt: "   ", model: "gpt-4o" })],
    [UNCLASSIFIED_REASONS.noSignal,
      () => classifyQuery({ excerpt: "what is the status of the deploy", model: "gpt-4o" })],
    [UNCLASSIFIED_REASONS.belowConfidenceFloor,
      () => classifyQuery({ excerpt: "try again with the birthday poem", model: "gpt-4o" })],
    [UNCLASSIFIED_REASONS.noTurns, () => classifyThread({ turns: [], model: "gpt-4o" })],
    [UNCLASSIFIED_REASONS.noUserTurn,
      () => classifyThread({ turns: [{ role: "assistant", body: "hello" }], model: "gpt-4o" })],
  ];
  const seen = new Set();
  for (const [reason, run] of cases) {
    const { evidence, reason: published } = run();
    assert.equal(published, reason);
    assert.equal(evidence.class, UNCLASSIFIED_CATEGORY);
    assert.equal(evidence.unclassifiedReason, reason);
    assert.equal(evidence.signal, null, `${reason} published a signal`);
    assert.equal(evidence.patternId, null, `${reason} published a pattern id`);
    assert.equal(evidence.confidence, 0);
    seen.add(reason);
  }
  // The enum is closed, and every value in it is reachable from a real input.
  assert.deepEqual([...seen].sort(), Object.values(UNCLASSIFIED_REASONS).sort());
});

test("evidence is additive: every field a caller already read is unchanged", () => {
  const result = classifyQuery({ excerpt: "give me a recipe for dinner", model: "gpt-4o" });
  assert.equal(result.classified, true);
  assert.equal(result.nearestCategory, "outOfScope");
  assert.deepEqual([...result.matchedRuleIds], ["out-of-scope-personal"]);
  assert.equal(result.signals.length, 1);
  assert.equal(result.reason, null);
});

test("a thread names the signal that carried its class and publishes no token", () => {
  const thread = classifyThread({
    model: "gpt-4o",
    turns: [
      { role: "user", body: "still not working, try again" },
      { role: "assistant", body: "here" },
      { role: "user", body: "as i said, the total is wrong" },
    ],
  });
  assert.equal(thread.classified, true);
  assert.equal(thread.evidence.class, thread.category);
  assert.equal(thread.evidence.confidence, thread.confidence);
  assert.equal(thread.evidence.signal, null);
  assert.ok(thread.evidence.patternId, "a classified thread names no signal id");
});
