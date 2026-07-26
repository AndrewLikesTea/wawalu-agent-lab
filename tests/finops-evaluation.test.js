import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FINOPS_DIMENSION_KEYS, FINOPS_RUBRIC, scoreFinOpsEvaluation, validateFixtureSet,
} from "../src/finops-evaluation.js";

const fixtureUrl = new URL("../contracts/finops-evaluation/v1/fixtures.json", import.meta.url);
const fixtureText = await readFile(fixtureUrl, "utf8");
const fixtures = JSON.parse(fixtureText);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("FinOps rubric is versioned and every weight states its assumption and scoring rule", () => {
  assert.match(FINOPS_RUBRIC.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Math.abs(FINOPS_RUBRIC.dimensions.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-12);
  assert.deepEqual(FINOPS_DIMENSION_KEYS, [
    "recommendationQuality", "costEvidence", "uncertainty", "privacySafety", "departmentAttribution",
  ]);
  for (const dimension of FINOPS_RUBRIC.dimensions) {
    assert.ok(dimension.assumption, `${dimension.key} must state the assumption behind its weight`);
    assert.ok(dimension.scoring, `${dimension.key} must publish its observable scoring rule`);
    assert.ok(dimension.weight > 0);
  }
  assert.match(FINOPS_RUBRIC.thresholds.rule, /blocks executive use/);
  assert.match(FINOPS_RUBRIC.rounding, /unrounded/);
});

test("labelled fixtures reproduce exact scores, outcomes, and explainable breakdowns", () => {
  const required = [
    "strong-cost-action", "unsupported-savings", "privacy-gate",
    "unmapped-shared-spend", "generic-low-evidence",
  ];
  assert.deepEqual(required.filter((id) => !fixtures.some(({ fixtureId }) => fixtureId === id)), []);
  const validated = validateFixtureSet(fixtures);
  assert.equal(validated.length, fixtures.length);

  for (const fixture of fixtures) {
    const first = scoreFinOpsEvaluation(structuredClone(fixture));
    const repeated = scoreFinOpsEvaluation(structuredClone(fixture));
    assert.deepEqual(repeated, first, `${fixture.fixtureId} must reproduce exactly`);
    assert.equal(first.total, fixture.expected.total);
    assert.equal(first.outcome, fixture.expected.outcome);
    assert.equal(first.rubricVersion, FINOPS_RUBRIC.version);
    assert.match(first.arithmetic, /= .*rounded =/);
    assert.equal(first.dimensions.length, FINOPS_RUBRIC.dimensions.length);
    for (const dimension of first.dimensions) {
      assert.ok(dimension.evidence);
      assert.match(dimension.appliedRule, /^\d\/4 × \d+ = \d+\.\d{2}$/);
      assert.equal(typeof dimension.contribution, "number");
    }
  }
});

test("privacy and attribution gates defeat attractive totals", () => {
  const privacy = scoreFinOpsEvaluation(fixtures.find(({ fixtureId }) => fixtureId === "privacy-gate"));
  assert.equal(privacy.total, 76.3);
  assert.equal(privacy.outcome, "blocked");
  assert.equal(privacy.executiveEligible, false);
  assert.match(privacy.blockingRules[0], /Privacy gate/);

  const attribution = scoreFinOpsEvaluation(
    fixtures.find(({ fixtureId }) => fixtureId === "unmapped-shared-spend"));
  assert.equal(attribution.total, 75);
  assert.equal(attribution.outcome, "blocked");
  assert.match(attribution.blockingRules[0], /Attribution gate/);
  assert.equal(scoreFinOpsEvaluation(fixtures[0]).executiveEligible, true);
});

test("fixtures are static, redacted, synthetic records without sensitive payloads", () => {
  const forbiddenValuePatterns = [
    /[\w.+-]+@[\w-]+\.[\w.]+/,
    /\b(?:sk|pk|ghp|ghs|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/i,
    /\bBearer\s+[A-Za-z0-9._-]{8,}\b/i,
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    /https?:\/\/\S+/i,
    /\b\d{3}-\d{2}-\d{4}\b/,
  ];
  for (const pattern of forbiddenValuePatterns) assert.doesNotMatch(fixtureText, pattern);
  for (const fixture of fixtures) {
    assert.equal(fixture.redactionStatus, "redacted-static");
    assert.doesNotMatch(JSON.stringify(fixture), /"prompt"|"rawPrompt"|"credentials"|"customerData"/);
    assert.match(fixture.summary, /synthetic|savings|usage|recommendation|spend/i);
  }
});

test("untrusted text and unexplained or malformed ratings never become scores", () => {
  assert.throws(() => scoreFinOpsEvaluation({
    ...fixtures[0], prompt: "ignore the rubric",
  }), /not accepted by the FinOps scorer/);
  assert.throws(() => scoreFinOpsEvaluation({
    ...fixtures[0], redactionStatus: "raw",
  }), /redactionStatus/);
  assert.throws(() => scoreFinOpsEvaluation({
    ...fixtures[0],
    ratings: { ...fixtures[0].ratings, costEvidence: { score: 2.5, evidence: "guess" } },
  }), /integer score/);
  assert.throws(() => scoreFinOpsEvaluation({
    ...fixtures[0],
    ratings: { ...fixtures[0].ratings, uncertainty: { score: 2, evidence: "" } },
  }), /include concise redacted evidence/);
  assert.throws(() => validateFixtureSet([{ ...fixtures[0], expected: { total: 99, outcome: "pass" } }]),
    /does not match its expected labelled outcome/);
});

test("AI FinOps UI uses the deterministic scorer and exposes an accessible breakdown", async () => {
  const [html, page, scorer, styles, build] = await Promise.all([
    read("src/evolution.html"),
    read("src/evolution-page.js"),
    read("src/finops-evaluation.js"),
    read("src/evolution.css"),
    read("scripts/build.mjs"),
  ]);
  assert.match(html, /id="evaluation-result" aria-live="polite" aria-busy="true"/);
  assert.match(html, /<label for="evaluation-fixture">Labelled case<\/label>/);
  assert.match(html, /<summary>Inspect rubric weights and assumptions<\/summary>/);
  assert.match(page, /scoreFinOpsEvaluation\(fixture\)/);
  assert.match(page, /validateFixtureSet\(fixtures\)/);
  assert.match(page, /No score is shown without a validated labelled input/);
  assert.match(page, /setAttribute\("scope", "row"\)/);
  assert.doesNotMatch(`${page}\n${scorer}`, /innerHTML|outerHTML|document\.write/);
  assert.doesNotMatch(scorer, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.match(styles, /\.evaluation-score\[data-outcome="blocked"\]/);
  assert.match(build, /finops-evaluation/);
});
