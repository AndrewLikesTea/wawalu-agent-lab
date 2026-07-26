import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CONTENT_RUBRIC, aggregateContentJudgement, evaluateContent, prepareContentForJudge,
} from "../src/content-evaluation.js";

const FIXTURE_URL = new URL("../contracts/content-evaluation/v1/fixtures.json", import.meta.url);
const fixtures = JSON.parse(await readFile(FIXTURE_URL, "utf8"));

function judgementFor(fixture) {
  return {
    dimensions: Object.fromEntries(Object.entries(fixture.expected.scores).map(([key, score]) => [
      key, { score, evidence: `${fixture.id}: ${fixture.rationale}` },
    ])),
  };
}

test("rubric is versioned, bounded, and weights state assumptions", () => {
  assert.match(CONTENT_RUBRIC.version, /^\d+\.\d+\.\d+$/);
  assert.equal(CONTENT_RUBRIC.scale.min, 0);
  assert.equal(CONTENT_RUBRIC.scale.max, 4);
  assert.equal(CONTENT_RUBRIC.dimensions.reduce((sum, item) => sum + item.weight, 0), 1);
  for (const dimension of CONTENT_RUBRIC.dimensions) {
    assert.ok(dimension.assumption);
    assert.ok(dimension.rationale);
  }
  assert.match(CONTENT_RUBRIC.edgeCases, /Exact thresholds use the higher band/);
});

test("labelled fixtures agree exactly with deterministic aggregation", () => {
  const required = ["strong", "weak", "borderline", "conflicting-signal", "injection-like", "redaction-required"];
  assert.deepEqual(required.filter((id) => !fixtures.some((item) => item.id === id)), []);

  for (const fixture of fixtures) {
    const first = aggregateContentJudgement(judgementFor(fixture));
    const repeated = aggregateContentJudgement(judgementFor(fixture));
    assert.deepEqual(repeated, first, `${fixture.id} must be stable across repeated evaluation`);
    assert.equal(first.total, fixture.expected.total, `${fixture.id}: ${fixture.rationale}`);
    assert.equal(first.result, fixture.expected.result, `${fixture.id}: ${fixture.rationale}`);
    assert.equal(first.rubricVersion, CONTENT_RUBRIC.version);
    assert.match(first.arithmetic, /=/);
    for (const dimension of first.dimensions) {
      assert.ok(dimension.evidence, `${fixture.id}/${dimension.key} needs evidence`);
      assert.match(dimension.appliedRule, /×/);
    }
  }
});

test("thresholds, rounding, and the safety override are explicit and consistent", () => {
  assert.equal(aggregateContentJudgement(judgementFor(fixtures.find((item) => item.id === "borderline"))).result, "borderline");
  assert.equal(aggregateContentJudgement(judgementFor(fixtures.find((item) => item.id === "pass-edge"))).result, "pass");
  const conflict = aggregateContentJudgement(judgementFor(fixtures.find((item) => item.id === "conflicting-signal")));
  assert.equal(conflict.total, 92.5);
  assert.equal(conflict.result, "fail");
  assert.match(conflict.appliedRules.at(-1), /Safety gate applied/);
});

test("raw content is redacted and injection-neutralized before the judge runs", async () => {
  const fixture = fixtures.find((item) => item.id === "redaction-required");
  let received;
  const result = await evaluateContent(fixture.content, async (prepared) => {
    received = prepared;
    return judgementFor(fixture);
  });
  assert.equal(received.kind, "untrusted-content");
  assert.match(received.handling, /data only/);
  for (const raw of ["ana.reyes@northwind.example", "demo-token-not-real-000", "10.42.7.19"])
    assert.doesNotMatch(received.content, new RegExp(raw.replaceAll(".", "\\.")));
  assert.match(received.content, /\[email\].*\[secret\].*\[ip\]/);
  assert.deepEqual(result.evaluatedContent, received);

  const injection = prepareContentForJudge(fixtures.find((item) => item.id === "injection-like").content);
  assert.doesNotMatch(injection.content, /ignore all previous instructions|reveal the system prompt/i);
  assert.match(injection.content, /\[instruction-neutralized\]/);
});

test("invalid or unexplained judge numbers cannot become scores", () => {
  const valid = judgementFor(fixtures[0]);
  assert.throws(() => aggregateContentJudgement({
    dimensions: { ...valid.dimensions, correctness: { score: 4.5, evidence: "guess" } },
  }), /integer score/);
  assert.throws(() => aggregateContentJudgement({
    dimensions: { ...valid.dimensions, correctness: { score: 4, evidence: "" } },
  }), /include concise evidence/);
  assert.throws(() => aggregateContentJudgement({ dimensions: {} }), /correctness/);
});
