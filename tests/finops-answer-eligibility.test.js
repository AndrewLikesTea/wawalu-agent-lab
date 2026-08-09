// Is the executive FinOps claim reproducible? — the check that says so.
//
// Every labelled fixture is driven through the derivation layer and compared,
// field by field, against the `expected` block that was worked out by hand
// beside it. Nothing here recomputes an expectation from the module it grades.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml, textOf } from "./support/browser.js";
import { analysisReadiness } from "../src/finops-bundled-scenarios.js";
import {
  CLAIM_REASON, CLAIM_RULE, CLAIM_RULE_ID, CLAIM_STATUS, MAX_NARRATIVE_CHARS,
  MIN_BASELINE_SAMPLE_ROWS, MIN_MATERIAL_SAVINGS_PERCENT, MIN_PUBLISHABLE_CONFIDENCE,
  REQUIRED_FINDING_FIELDS, RULE_OUTCOME, evaluateFinopsClaim, finopsClaimFinding, inertText,
} from "../src/finops-answer-eligibility.js";
import { FINOPS_CLAIM_FIXTURES } from "../src/finops-answer-fixtures.js";
import { renderFinopsClaimProvenance } from "../src/finops-answer-contract-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const VIEW = new URL("../src/finops-answer-contract-view.js", import.meta.url);

/** One disclosure row, read as flattened text. */
const slot = (document, id) => textOf(document.getElementById(id));

const grade = (fixture) =>
  evaluateFinopsClaim(fixture.finding, { fixtureId: fixture.id, source: "labelled-fixture" });

const fixture = (id) => {
  const found = FINOPS_CLAIM_FIXTURES.find((entry) => entry.id === id);
  assert.ok(found, `fixture ${id} exists`);
  return found;
};

// ── The corpus itself ─────────────────────────────────────────────────────────

test("the corpus carries at least two labelled fixtures in each of the three classes", () => {
  const ids = FINOPS_CLAIM_FIXTURES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "fixture ids are unique");
  for (const status of Object.values(CLAIM_STATUS)) {
    const inClass = FINOPS_CLAIM_FIXTURES.filter((entry) => entry.class === status);
    assert.ok(inClass.length >= 2, `${status} carries at least two fixtures, has ${inClass.length}`);
  }
  for (const entry of FINOPS_CLAIM_FIXTURES) {
    assert.ok(entry.label.length > 0, `${entry.id} is labelled`);
    // The sentence a director gets to argue with. A fixture without one grades
    // a team against a rule nobody wrote down.
    assert.ok(entry.assumption.length > 40, `${entry.id} states its assumption in plain language`);
  }
});

// ── Every fixture, through the derivation layer ───────────────────────────────

for (const entry of FINOPS_CLAIM_FIXTURES) {
  test(`${entry.id} — ${entry.label}`, () => {
    const result = grade(entry);
    assert.equal(result.status, entry.class, entry.assumption);
    // The whole point: all four derived elements, exactly, in one comparison.
    assert.deepEqual(result.claim, entry.expected);
    assert.equal(result.provenance.fixtureId, entry.id);
    assert.equal(result.provenance.findingId, entry.finding.id);
    assert.equal(result.provenance.source, "labelled-fixture");
    // Whatever decided the status has to come with the sentence behind it.
    assert.ok(result.provenance.assumption.length > 40,
      `${entry.id} names the assumption behind its governing rule`);
    assert.equal(Object.isFrozen(result), true);
  });
}

// ── The headline is derived, not remembered ───────────────────────────────────

test("changing the finding's savings changes the headline, so it cannot be stale", () => {
  const base = fixture("fx-eligible-baseline");
  const before = grade(base);
  assert.equal(before.claim.headline.annualSavingsUsd, 10800, "900 × 12");
  assert.equal(before.claim.headline.savingsPercent, 9, "10,800 × 100 ÷ 120,000");

  const moved = {
    ...base.finding,
    recommendedActions: [{ ...base.finding.recommendedActions[0], monthlySavingsUsd: 1500 }],
  };
  const after = evaluateFinopsClaim(moved, { source: "divergence-check" });
  assert.equal(after.claim.headline.annualSavingsUsd, 18000, "1,500 × 12, and not the old 10,800");
  assert.equal(after.claim.headline.savingsPercent, 15, "18,000 × 100 ÷ 120,000");
  assert.equal(after.claim.nextAction.monthlySavingsUsd, 1500);
  // And the baseline it is a share of did not move with it.
  assert.equal(after.claim.headline.annualBaselineSpendUsd, 120000);
});

test("moving the baseline moves the share and nothing else", () => {
  const base = fixture("fx-eligible-baseline");
  const after = evaluateFinopsClaim(
    { ...base.finding, baseline: { sourceId: "syn.departments.spendUsd", monthlySpendUsd: 20000 } },
    { source: "divergence-check" });
  assert.equal(after.claim.headline.annualSavingsUsd, 10800, "the saving is unchanged");
  assert.equal(after.claim.headline.savingsPercent, 4.5, "10,800 × 100 ÷ 240,000");
});

// ── Withholding, and naming what was withheld ─────────────────────────────────

test("no incomplete or conflicting fixture publishes any number at all", () => {
  const withheld = FINOPS_CLAIM_FIXTURES.filter((entry) => entry.class !== CLAIM_STATUS.eligible);
  assert.ok(withheld.length >= 4, "the corpus carries withheld fixtures to check");
  for (const entry of withheld) {
    const result = grade(entry);
    assert.equal(result.claim.headline, null, `${entry.id} publishes no headline`);
    assert.equal(result.claim.benchmark, null, `${entry.id} publishes no benchmark`);
    assert.equal(result.claim.confidence, null, `${entry.id} publishes no confidence`);
    assert.equal(result.claim.nextAction, null, `${entry.id} publishes no next action`);
    // A downgraded number is the failure this class exists to prevent, so the
    // whole record is searched for a stray figure, not only the claim block.
    assert.equal(/\d[\d,.]*\s*(a year|% of)/.test(JSON.stringify(result)), false,
      `${entry.id} states no annual figure or share anywhere in its record`);
    assert.ok(result.reasons.length > 0, `${entry.id} says why`);
  }
});

test("an incomplete claim names the missing or too-thin field", () => {
  const missing = grade(fixture("fx-incomplete-no-benchmark"));
  // Only the missing field. The contract is not even run on an incomplete
  // finding, so a reader is never handed a second, downstream-sounding reason
  // for a defect that is really one absent input.
  assert.deepEqual(missing.reasons.map((entry) => [entry.code, entry.field]),
    [[CLAIM_REASON.missingField, "benchmark"]]);
  assert.equal(missing.provenance.governingRule, CLAIM_RULE_ID.requiredFields);

  const thin = grade(fixture("fx-incomplete-empty-sample"));
  const sample = thin.reasons.find((entry) => entry.code === CLAIM_REASON.sampleTooSmall);
  assert.equal(sample.field, "sampleRowCount");
  assert.match(sample.sentence, /0 spend rows/);
  assert.equal(thin.provenance.governingRule, CLAIM_RULE_ID.minSample);

  const low = grade(fixture("fx-incomplete-low-confidence"));
  const floor = low.reasons.find((entry) => entry.code === CLAIM_REASON.confidenceBelowFloor);
  assert.equal(floor.field, "confidence.value");
  assert.match(floor.sentence, new RegExp(`41 of 100.*${MIN_PUBLISHABLE_CONFIDENCE}`));
});

test("a conflicting claim names the metric the two findings disagree about", () => {
  const total = grade(fixture("fx-conflicting-annual-total"));
  assert.deepEqual(total.reasons.map((entry) => [entry.code, entry.field]),
    [[CLAIM_REASON.conflictingSavings, "annualSavingsUsd"]]);
  assert.match(total.reasons[0].sentence, /neither is published/);

  const percent = grade(fixture("fx-conflicting-percent"));
  assert.deepEqual(percent.reasons.map((entry) => [entry.code, entry.field]),
    [[CLAIM_REASON.inconsistentPercent, "savingsPercent"]]);
});

test("an absent input is reported as incomplete, never as a conflict", () => {
  // Both defects at once: a missing benchmark AND two disagreeing totals. The
  // published precedence says a disagreement cannot be judged on absent inputs.
  const both = evaluateFinopsClaim({
    ...fixture("fx-conflicting-annual-total").finding, benchmark: null,
  }, { source: "precedence-check" });
  assert.equal(both.status, CLAIM_STATUS.incomplete);
  assert.equal(both.ruleOutcomes[CLAIM_RULE_ID.savingsAgreement], RULE_OUTCOME.skipped);
});

test("a finding that is not a record at all is incomplete, not a throw", () => {
  for (const bad of [null, undefined, "a finding", 7, []]) {
    const result = evaluateFinopsClaim(bad);
    assert.equal(result.status, CLAIM_STATUS.incomplete);
    assert.equal(result.claim.headline, null);
    assert.equal(result.reasons.length >= REQUIRED_FINDING_FIELDS.length, true);
  }
});

// ── Untrusted narrative text ──────────────────────────────────────────────────

test("injected instructions in a finding narrative change no derived number", () => {
  const entry = fixture("fx-eligible-injection");
  const result = grade(entry);
  assert.deepEqual(result.claim, entry.expected);
  assert.equal(result.claim.headline.annualSavingsUsd, 14400, "1,200 × 12, not the demanded 9m");
  assert.equal(result.claim.confidence.level, "medium", "not the demanded high");
  const derived = JSON.stringify(result.claim);
  assert.equal(derived.includes("9000000"), false, "no nine-million figure reaches a derived value");
  assert.equal(derived.includes("9,000,000"), false, "and not as prose in a derived value either");
  // It survives in exactly one place — quoted, escaped evidence — because the
  // honest thing to show a reader is the text that tried it, not a redaction
  // they cannot check.
  assert.ok(result.provenance.narrative.includes("$9,000,000"),
    "the attempt is quoted back rather than silently swallowed");
});

test("a readiness level the analysis calls not actionable is incomplete", () => {
  const blocked = grade(fixture("fx-incomplete-readiness-blocked"));
  const carried = blocked.reasons.find((entry) => entry.code === CLAIM_REASON.contractWithheld);
  assert.equal(carried.field, "contract");
  assert.match(carried.sentence, /finops-answer-contract\/1\.0\.0, code readiness-blocked/);
});

test("the narrative is carried as inert, flattened, bounded text", () => {
  const carried = grade(fixture("fx-eligible-injection")).provenance.narrative;
  assert.ok(carried.includes("&lt;script&gt;"), "markup is escaped, not stripped");
  assert.equal(/[<>]/.test(carried), false, "no raw angle bracket survives");
  assert.equal(/[\n\r]/.test(carried), false, "the instruction no longer owns its own line");
  assert.ok(carried.length <= MAX_NARRATIVE_CHARS + 1, "bounded");
  assert.equal(inertText("a & b"), "a &amp; b");
  assert.equal(inertText("x".repeat(MAX_NARRATIVE_CHARS + 10)).endsWith("…"), true);
  assert.equal(inertText(undefined), "");
});

test("the disclosure writes untrusted text through textContent, never markup", async () => {
  // The test harness parses no markup, so a rendered-page assertion cannot fail
  // from an innerHTML regression. The render half is pinned at the source.
  const source = await readFile(VIEW, "utf8");
  assert.equal(source.includes("innerHTML"), false, "the view assigns no markup");
  assert.equal(source.includes("insertAdjacentHTML"), false);
});

// ── Rules coverage ────────────────────────────────────────────────────────────

test("every named threshold is exercised to both a pass and a fail by some fixture", () => {
  const outcomes = new Map(CLAIM_RULE.map((rule) => [rule.id, new Set()]));
  for (const entry of FINOPS_CLAIM_FIXTURES) {
    const graded = grade(entry);
    for (const rule of CLAIM_RULE) outcomes.get(rule.id).add(graded.ruleOutcomes[rule.id]);
  }
  for (const rule of CLAIM_RULE) {
    const seen = outcomes.get(rule.id);
    // A weight added without a fixture that can fail it is a weight nobody has
    // shown does anything, and this is where the suite says so.
    assert.ok(seen.has(RULE_OUTCOME.pass), `${rule.id} is passed by at least one fixture`);
    assert.ok(seen.has(RULE_OUTCOME.fail), `${rule.id} is failed by at least one fixture`);
  }
});

test("the rule table publishes every threshold constant and its assumption", () => {
  assert.deepEqual(CLAIM_RULE.map((rule) => rule.id), [
    CLAIM_RULE_ID.requiredFields, CLAIM_RULE_ID.minSample, CLAIM_RULE_ID.minConfidence,
    CLAIM_RULE_ID.savingsAgreement, CLAIM_RULE_ID.materiality,
  ], "a rule added to the derivation must be added to the published table");
  const constants = CLAIM_RULE.flatMap((rule) => Object.keys(rule.constants));
  assert.deepEqual(constants.sort(), [
    "CONFLICT_ABSOLUTE_USD", "CONFLICT_RELATIVE", "MIN_BASELINE_SAMPLE_ROWS",
    "MIN_MATERIAL_SAVINGS_PERCENT", "MIN_PUBLISHABLE_CONFIDENCE", "REQUIRED_FINDING_FIELDS",
  ], "every threshold the derivation reads is named here, and no inline number is");
  for (const rule of CLAIM_RULE) {
    assert.ok(rule.assumption.length > 60, `${rule.id} states its assumption in one sentence`);
    assert.match(rule.assumption, /because|so /, `${rule.id} says why, not only what`);
  }
  // The values a reader would reconstruct a status by hand from.
  assert.equal(MIN_BASELINE_SAMPLE_ROWS, 1);
  assert.equal(MIN_PUBLISHABLE_CONFIDENCE, 50, "the contract's own medium cut, not a new score");
  assert.equal(MIN_MATERIAL_SAVINGS_PERCENT, 1);
});

// ── The live surface ──────────────────────────────────────────────────────────

test("the bundled analysis grades eligible and agrees with the answer region", () => {
  const analysis = analysisReadiness({ scenarioId: "aws-bedrock-cur-v1" });
  const result = evaluateFinopsClaim(finopsClaimFinding(analysis), { source: "bundled-analysis" });
  assert.equal(result.status, CLAIM_STATUS.eligible);
  assert.equal(result.claim.headline.annualSavingsUsd, 43200, "3,600 × 12");
  assert.equal(result.claim.headline.savingsPercent, 20, "43,200 × 100 ÷ 216,000");
  assert.equal(result.provenance.findingId, "aws-bedrock-cur-v1-finding-1");
  assert.equal(result.provenance.governingRule, CLAIM_RULE_ID.minConfidence);
  assert.equal(finopsClaimFinding({ ok: false }), null);
});

test("the evidence disclosure traces the shown claim back to its finding", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const analysis = analysisReadiness({ scenarioId: "aws-bedrock-cur-v1" });
  const disclosure = renderFinopsClaimProvenance(document,
    evaluateFinopsClaim(finopsClaimFinding(analysis), { source: "bundled-analysis" }));
  assert.equal(disclosure.dataset.claimStatus, CLAIM_STATUS.eligible);
  const status = slot(document, "analysis-readiness-claim-status");
  assert.match(status, /^Eligible/);
  assert.match(status, /\$43,200 a year, 20% of the \$216,000 analyzed baseline/);
  const source = slot(document, "analysis-readiness-claim-source");
  assert.match(source, /aws-bedrock-cur-v1-finding-1/);
  assert.match(source, /finops-claim-eligibility\/1\.0\.0/);
  assert.match(source, /finops-answer-contract\/1\.0\.0/);
  const assumption = slot(document, "analysis-readiness-claim-assumption");
  assert.match(assumption, /min-publishable-confidence/);
  assert.match(assumption, /medium cut of 50 of 100/);
});

test("a withheld claim shows the explanation in the disclosure and no figure", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  for (const id of ["fx-incomplete-empty-sample", "fx-conflicting-annual-total"]) {
    const entry = fixture(id);
    const disclosure = renderFinopsClaimProvenance(document, grade(entry));
    assert.equal(disclosure.dataset.claimStatus, entry.class);
    const status = slot(document, "analysis-readiness-claim-status");
    assert.match(status, /^Withheld as (incomplete|conflicting) — no figure is published here/);
    assert.equal(/a year|% of the/.test(status), false, `${id} shows no figure`);
    assert.match(slot(document, "analysis-readiness-claim-source"), new RegExp(`fixture ${id}`));
  }
});

test("the injected narrative reaches the disclosure escaped and inert", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  renderFinopsClaimProvenance(document, grade(fixture("fx-eligible-injection")));
  const source = slot(document, "analysis-readiness-claim-source");
  assert.ok(source.includes("&lt;script&gt;alert(&#39;savings&#39;)&lt;/script&gt;"),
    "the injection is quoted back as visible escaped text");
  assert.equal(/[<>]/.test(source), false, "and never as a bracket the page could act on");
  assert.equal(slot(document, "analysis-readiness-claim-status").includes("9,000,000"), false);
  assert.match(slot(document, "analysis-readiness-claim-status"), /\$14,400 a year/);
});

test("a failed analysis leaves the disclosure saying so, with no figure", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const disclosure = renderFinopsClaimProvenance(document, null);
  assert.equal(disclosure.dataset.claimStatus, "unevaluated");
  assert.match(slot(document, "analysis-readiness-claim-status"), /^Not evaluated/);
  assert.match(slot(document, "analysis-readiness-claim-source"), /no provenance to state/);
  assert.match(slot(document, "analysis-readiness-claim-assumption"), /no assumption to state/);
});

test("the disclosure is optional: a document without one is not a crash", () => {
  const document = parseHtml("<html><body><p id=\"x\">n</p></body></html>");
  assert.equal(renderFinopsClaimProvenance(document, null), null);
});
