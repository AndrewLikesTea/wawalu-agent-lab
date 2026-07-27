import assert from "node:assert/strict";
import test from "node:test";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";
import {
  CATEGORY_PRECEDENCE, classifyQuery, MINIMUM_CLASSIFICATION_CONFIDENCE,
  QUERY_CLASSIFICATION_RULES, UNCLASSIFIED_CATEGORY, UNCLASSIFIED_REASONS,
} from "../src/query-classification.js";

const WELL_FORMED = "Context: the billing service returns 500s. Constraints: must not change "
  + "the schema. Acceptance criteria: a passing regression test.";

test("the rule table is readable as data and names only rubric categories", () => {
  const categories = new Set(PROMPT_LITERACY_RUBRIC.categories.map((entry) => entry.key));
  assert.ok(QUERY_CLASSIFICATION_RULES.length > 0);
  for (const rule of QUERY_CLASSIFICATION_RULES) {
    assert.ok(categories.has(rule.category), `${rule.id} names ${rule.category}`);
    assert.ok(rule.pattern instanceof RegExp);
    assert.ok(Number.isInteger(rule.weight) && rule.weight > 0);
    // Every rule carries the reasoning a reviewer would otherwise have to infer.
    assert.match(rule.note, /\S/);
  }
  assert.deepEqual([...new Set(QUERY_CLASSIFICATION_RULES.map((rule) => rule.id))].length,
    QUERY_CLASSIFICATION_RULES.length);
  // The tie-break order covers every category a rule can vote for.
  for (const rule of QUERY_CLASSIFICATION_RULES) {
    assert.ok(CATEGORY_PRECEDENCE.includes(rule.category));
  }
});

test("classification is deterministic across repeats and input order", () => {
  const inputs = [
    { excerpt: WELL_FORMED, model: "gpt-4o" },
    { excerpt: "still not working, try again", model: "claude-sonnet-4" },
    { excerpt: "give me a recipe for a birthday dinner", model: "gpt-4o-mini" },
    { excerpt: "rename this variable to invoiceTotal", model: "gpt-4o" },
    { excerpt: "what is the status of the deploy", model: "gpt-4o" },
  ];
  const first = inputs.map(classifyQuery);
  for (let run = 0; run < 5; run += 1) {
    assert.deepEqual([...inputs].reverse().map(classifyQuery).reverse(), first);
  }
  assert.deepEqual(first.map((result) => result.category),
    ["highValue", "inefficient", "outOfScope", "overProvisioned", UNCLASSIFIED_CATEGORY]);
  assert.deepEqual(first.map((result) => result.confidence), [1, 1, 1, 1, 0]);
});

test("the over-provisioned rule abstains unless Anya's tier table says premium", () => {
  const excerpt = "rename this variable to invoiceTotal";
  assert.equal(classifyQuery({ excerpt, model: "gpt-4o" }).category, "overProvisioned");
  // Same words, cheaper model: the rule contributes nothing and nothing else
  // matches, so the record is unclassified rather than downgraded on a guess.
  const economy = classifyQuery({ excerpt, model: "gpt-4o-mini" });
  assert.equal(economy.category, UNCLASSIFIED_CATEGORY);
  assert.equal(economy.reason, UNCLASSIFIED_REASONS.noSignal);
  assert.equal(classifyQuery({ excerpt, model: "claude-sonnet-4" }).classified, false);
});

test("a two-way tie falls below the floor and is routed to unclassified", () => {
  const tied = classifyQuery({ excerpt: "try again with the birthday poem", model: "gpt-4o" });
  assert.equal(tied.classified, false);
  assert.equal(tied.category, UNCLASSIFIED_CATEGORY);
  assert.equal(tied.reason, UNCLASSIFIED_REASONS.belowConfidenceFloor);
  assert.equal(tied.confidence, 0);
  // The leaning is reported for a reviewer, and it is the worst reading, not the
  // flattering one. It is never a grade: `classified` stays false.
  assert.equal(tied.nearestCategory, "outOfScope");
  assert.deepEqual([...tied.matchedRuleIds].sort(),
    ["inefficient-repeat", "out-of-scope-personal"]);
});

test("weight of evidence decides, and the floor is the only cut-off", () => {
  // Three structural signals (6) against one leakage signal (3): 0.6667 clears
  // the floor, so a well-formed request that mentions a birthday still grades.
  const mixed = classifyQuery({ excerpt: `${WELL_FORMED} it is for a birthday release.`, model: "gpt-4o" });
  assert.equal(mixed.category, "highValue");
  assert.ok(mixed.confidence >= MINIMUM_CLASSIFICATION_CONFIDENCE);
  assert.ok(mixed.confidence < 1);
  // One structural signal (2) against one leakage signal (3): 0.6 is exactly the
  // floor, and the floor is read with >=, so this one classifies.
  const leaning = classifyQuery({ excerpt: "Context: planning a vacation policy", model: "gpt-4o" });
  assert.equal(leaning.confidence, MINIMUM_CLASSIFICATION_CONFIDENCE);
  assert.equal(leaning.category, "outOfScope");
});

test("a missing or empty excerpt is a named refusal, never a category", () => {
  for (const excerpt of [undefined, null, "", "   ", 42]) {
    const result = classifyQuery({ excerpt, model: "gpt-4o" });
    assert.equal(result.classified, false);
    assert.equal(result.category, UNCLASSIFIED_CATEGORY);
    assert.equal(result.reason, UNCLASSIFIED_REASONS.noExcerpt);
    assert.equal(result.nearestCategory, null);
  }
  assert.equal(classifyQuery().category, UNCLASSIFIED_CATEGORY);
});

test("no excerpt text survives into the classifier's result", () => {
  const sentinel = "ZQX-CLASSIFIER-SENTINEL-8891";
  const result = classifyQuery({ excerpt: `${WELL_FORMED} ${sentinel}`, model: "gpt-4o" });
  assert.equal(result.category, "highValue");
  assert.ok(!JSON.stringify(result).includes(sentinel));
  assert.ok(!JSON.stringify(result).includes("billing service"));
});
