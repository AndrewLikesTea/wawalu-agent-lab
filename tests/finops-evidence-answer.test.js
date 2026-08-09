// Divergence tests for the canonical FinOps answer.
//
// The claim under test is not "the module returns a number". It is that the
// four values a CTO reads on /evolution.html — the annual headline, the
// benchmark under it, the confidence beside it and the action after it — cannot
// come from different findings, cannot be stated at all when the evidence is
// incomplete, and cannot be picked by array order when two findings disagree.
// Each of those is a labelled fixture with an `expected` block written before
// the code ran, and the last test in the first group is the anti-divergence
// invariant: the answer's cited provenance id is the fixture's finding id.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml, textOf } from "./support/browser.js";
import { EVIDENCE_CATEGORIES } from "../src/finops-analysis-readiness.js";
import { analysisReadiness } from "../src/finops-bundled-scenarios.js";
import {
  CONFIDENCE_DEDUCTIONS, CONFIDENCE_WEIGHTS, CONFLICT_RULE, EVIDENCE_CLASS, VALIDATION_STATUS,
  bundledFinopsEvidence, confidenceScore, resolveEvidenceAnswer,
} from "../src/finops-evidence-answer.js";
import { FINOPS_EVIDENCE_FIXTURES, HOSTILE_PROSE } from "../src/finops-evidence-fixtures.js";
import { renderFinopsAnswer, renderFinopsProvenance } from "../src/finops-answer-contract-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const fixture = (id) => FINOPS_EVIDENCE_FIXTURES.find((each) => each.id === id);
const findingOf = (each, id) => each.findings.find((finding) => finding.id === id);

test("the fixture set covers all three labelled evidence classes", () => {
  const classes = new Set(FINOPS_EVIDENCE_FIXTURES.map((each) => each.class));
  assert.deepEqual([...classes].sort(),
    [EVIDENCE_CLASS.conflicting, EVIDENCE_CLASS.eligible, EVIDENCE_CLASS.incomplete].sort());
  assert.equal(new Set(FINOPS_EVIDENCE_FIXTURES.map((each) => each.id)).size,
    FINOPS_EVIDENCE_FIXTURES.length, "fixture ids are unique");
});

// One test per fixture rather than one loop with five assertions: a failure
// names the case that broke rather than the first case in the list.
for (const each of FINOPS_EVIDENCE_FIXTURES) {
  test(`${each.id} reproduces the answer its expected block declares`, () => {
    const resolved = resolveEvidenceAnswer(each);
    const want = each.expected;
    // The human label and the computed class are two independent opinions.
    assert.equal(resolved.evidenceClass, each.class, "declared class vs computed class");
    assert.equal(resolved.evidenceClass, want.evidenceClass);
    assert.equal(resolved.validationStatus, want.validationStatus);
    assert.equal(resolved.provenance.findingId, want.findingId);
    assert.deepEqual([...resolved.provenance.supersededFindingIds],
      [...want.supersededFindingIds]);
    assert.equal(resolved.headline?.annualSavingsUsd ?? null, want.annualSavingsUsd);
    assert.equal(resolved.headline?.savingsPercent ?? null, want.savingsPercent);
    assert.equal(resolved.benchmark?.label ?? null, want.benchmarkLabel);
    assert.equal(resolved.confidence.label, want.confidenceLabel);
    assert.equal(resolved.confidence.value, want.confidenceValue);
    assert.equal(resolved.nextAction?.label ?? null, want.nextActionLabel);
    if ("nextActionDepartment" in want) {
      assert.equal(resolved.nextAction?.department ?? null, want.nextActionDepartment);
    }
    if (want.missingFields) {
      assert.deepEqual([...resolved.provenance.missingFields], [...want.missingFields]);
    }
    assert.equal(Object.isFrozen(resolved), true);
  });

  test(`${each.id} derives every surfaced number from the finding, not a literal`, () => {
    const resolved = resolveEvidenceAnswer(each);
    const cited = findingOf(each, resolved.provenance.findingId);
    if (!resolved.headline) {
      assert.equal(resolved.answer.status, "withheld");
      assert.equal(resolved.answer.annualSavingsUsd, null);
      assert.equal(resolved.nextAction, null);
      return;
    }
    // Recomputed from the fixture's own fields. If the module ever hardcodes a
    // figure, editing the fixture breaks this and not the expected block.
    assert.equal(resolved.headline.annualSavingsUsd, cited.monthlySavingsUsd * 12);
    assert.equal(resolved.headline.annualBaselineSpendUsd, cited.baseline.monthlySpendUsd * 12);
    assert.equal(resolved.headline.savingsPercent, Math.floor(
      cited.monthlySavingsUsd * 12 * 100 / (cited.baseline.monthlySpendUsd * 12) * 10 + 0.5) / 10);
    assert.equal(resolved.benchmark.value, cited.benchmark.value);
    assert.equal(resolved.nextAction.monthlySavingsUsd, cited.monthlySavingsUsd);
    assert.equal(resolved.confidence.scoreBeforeDeductions, confidenceScore(cited.evidence));
    assert.equal(resolved.confidence.value, resolved.answer.confidence.value,
      "the confidence the contract was handed is the one reported");
    assert.equal(resolved.confidence.label, resolved.answer.confidence.level);
  });
}

// THE ANTI-DIVERGENCE INVARIANT. Every fixture, one assertion: the answer cites
// the finding it was derived from, and every source line under a surfaced figure
// names that same finding.
test("every fixture's answer cites the finding id it was resolved from", () => {
  for (const each of FINOPS_EVIDENCE_FIXTURES) {
    const resolved = resolveEvidenceAnswer(each);
    const id = resolved.provenance.findingId;
    assert.equal(each.findings.some((finding) => finding.id === id), true,
      `${each.id}: cited ${id}, which is not a finding in the set`);
    assert.equal(id, each.expected.findingId, each.id);
    assert.deepEqual([...resolved.provenance.findingIds],
      each.findings.map((finding) => finding.id), each.id);
    const sources = resolved.answer.sources;
    // The benchmark source names the benchmark record rather than the finding,
    // so it is checked by label above; every other source is the finding's.
    for (const key of ["annualSavingsUsd", "savingsPercent", "primaryAction",
      "confidence", "readiness"]) {
      for (const source of sources[key] ?? []) {
        assert.equal(source.startsWith(id), true,
          `${each.id}: ${key} source "${source}" does not name ${id}`);
      }
    }
  }
});

test("an incomplete fixture states no figure and no full confidence", () => {
  for (const id of ["fixture-incomplete-no-benchmark", "fixture-incomplete-no-baseline"]) {
    const each = fixture(id);
    const resolved = resolveEvidenceAnswer(each);
    assert.equal(resolved.validationStatus, VALIDATION_STATUS.incomplete, id);
    assert.equal(resolved.headline, null, `${id}: no headline survives incomplete evidence`);
    assert.equal(resolved.answer.annualSavingsUsd, null, id);
    assert.equal(resolved.answer.savingsPercent, null, id);
    assert.equal(resolved.nextAction, null, id);
    assert.equal(resolved.benchmark, null, id);
    assert.equal(resolved.confidence.label, "low", id);
    assert.equal(resolved.confidence.value, 0, id);
    // The evidence it DID hold is still scored, so the deduction is visible as a
    // deduction rather than as a score that was quietly never computed.
    assert.equal(resolved.confidence.scoreBeforeDeductions,
      confidenceScore(each.findings[0].evidence), id);
    assert.deepEqual(resolved.confidence.deductions.map((item) => item.id),
      ["incomplete-evidence"], id);
  }
});

test("an incomplete finding is not silently replaced by its complete sibling", () => {
  const complete = fixture("fixture-eligible-standard-routing").findings[0];
  const broken = fixture("fixture-incomplete-no-baseline").findings[0];
  const resolved = resolveEvidenceAnswer({ id: "mixed", findings: [complete, broken] });
  assert.equal(resolved.evidenceClass, EVIDENCE_CLASS.incomplete);
  assert.equal(resolved.headline, null, "the complete finding does not get promoted");
  assert.equal(resolved.provenance.findingId, broken.id, "the incomplete finding is named");
});

test("a conflicting fixture resolves to the lower claim with confidence reduced", () => {
  const each = fixture("fixture-conflicting-two-claims");
  const resolved = resolveEvidenceAnswer(each);
  const [high, low] = each.findings;
  assert.equal(high.monthlySavingsUsd > low.monthlySavingsUsd, true, "fixture ordering premise");
  assert.equal(resolved.validationStatus, VALIDATION_STATUS.conflicted);
  assert.equal(resolved.provenance.findingId, low.id, CONFLICT_RULE);
  assert.equal(resolved.headline.annualSavingsUsd, low.monthlySavingsUsd * 12);
  assert.notEqual(resolved.headline.annualSavingsUsd, high.monthlySavingsUsd * 12);
  assert.deepEqual([...resolved.provenance.supersededFindingIds], [high.id],
    "the claim not taken is named, not dropped");
  assert.equal(resolved.headline.verified, false, "a resolved conflict is not a verified figure");

  // Reduced against the same evidence without the conflict: same categories,
  // one band lower, and the deduction that did it is named with its points.
  const unconflicted = resolveEvidenceAnswer({ id: "single", findings: [low] });
  assert.equal(unconflicted.confidence.label, "medium");
  assert.equal(resolved.confidence.label, "low");
  assert.equal(resolved.confidence.scoreBeforeDeductions, unconflicted.confidence.value);
  assert.deepEqual(resolved.confidence.deductions.map((item) => item.id), ["conflicting-findings"]);
  assert.equal(resolved.confidence.value,
    unconflicted.confidence.value - resolved.confidence.deductions[0].points);
});

test("a resolution never depends on the order the findings arrive in", () => {
  const each = fixture("fixture-conflicting-two-claims");
  const forward = resolveEvidenceAnswer(each);
  const reversed = resolveEvidenceAnswer({ id: each.id, findings: [...each.findings].reverse() });
  assert.equal(reversed.provenance.findingId, forward.provenance.findingId);
  assert.equal(reversed.headline.annualSavingsUsd, forward.headline.annualSavingsUsd);
  assert.equal(reversed.confidence.value, forward.confidence.value);
});

test("every weight and every deduction carries a non-empty assumption", () => {
  assert.equal(CONFIDENCE_WEIGHTS.length > 0, true);
  for (const weight of [...CONFIDENCE_WEIGHTS, ...CONFIDENCE_DEDUCTIONS]) {
    const value = weight.weight ?? weight.points;
    assert.equal(Number.isFinite(value) && value > 0, true, `${weight.id} has no value`);
    assert.equal(typeof weight.assumption === "string" && weight.assumption.trim().length > 20,
      true, `${weight.id} states no assumption behind its value`);
  }
  assert.equal(CONFIDENCE_WEIGHTS.reduce((sum, item) => sum + item.weight, 0), 100,
    "the weights are a share of 100, which is what makes the score readable as a percentage");
});

// The weights explain the analysis's OWN evidence model. If that model changes
// its ids, weights or reliabilities, this table is explaining something that no
// longer exists, and the explanation must be updated with it.
test("the declared weights match the evidence categories they claim to explain", () => {
  assert.deepEqual(CONFIDENCE_WEIGHTS.map((item) => [item.id, item.weight, item.reliability]),
    EVIDENCE_CATEGORIES.map((item) => [item.id, item.weight, item.reliability]));
});

test("hostile prose on a finding never reaches a surfaced value", async () => {
  const each = fixture("fixture-eligible-hostile-prose");
  const resolved = resolveEvidenceAnswer(each);
  const serialized = JSON.stringify(resolved);
  for (const prose of HOSTILE_PROSE) {
    assert.equal(serialized.includes(prose), false, `answer carried: ${prose}`);
  }
  // The label a reader sees is an allowlist value chosen by the action id, and
  // the department the finding supplied is dropped for not being one.
  assert.equal(resolved.nextAction.label, "Retire the idle inference endpoints.");
  assert.equal(resolved.nextAction.department, null);
  assert.equal(resolved.benchmark.label, "Synthetic peer median recoverable spend");

  const document = parseHtml(await readFile(PAGE, "utf8"));
  renderFinopsAnswer(document, resolved.answer);
  renderFinopsProvenance(document, resolved);
  const painted = textOf(document.getElementById("finops-canonical-answer"));
  for (const prose of HOSTILE_PROSE) {
    assert.equal(painted.includes(prose), false, `region painted: ${prose}`);
  }
  assert.equal(painted.includes("9,900,000"), false, "no injected figure reaches the region");
});

test("the page's bundled analysis resolves through the same path as the fixtures", () => {
  const analysis = analysisReadiness({ scenarioId: "aws-bedrock-cur-v1" });
  const resolved = resolveEvidenceAnswer(bundledFinopsEvidence(analysis));
  assert.equal(resolved.evidenceClass, EVIDENCE_CLASS.eligible);
  assert.equal(resolved.validationStatus, VALIDATION_STATUS.complete);
  assert.equal(resolved.provenance.findingId, analysis.finding.id);
  assert.equal(resolved.headline.annualSavingsUsd,
    analysis.readiness.recommendation.figure.value * 12);
  assert.equal(resolved.headline.annualBaselineSpendUsd,
    analysis.sample.departments[0].spendUsd * 12);
  assert.equal(resolved.nextAction.department, analysis.readiness.recommendation.department);
  assert.equal(resolved.benchmark.value, analysis.finding.benchmark.value);
  // Agreement check: scoring the analysis's categories with the declared weights
  // reproduces the confidence the readiness model already publishes.
  assert.equal(resolved.confidence.scoreBeforeDeductions, analysis.readiness.confidence.value);
  assert.equal(resolved.confidence.deductions.length, 0);
  assert.equal(bundledFinopsEvidence({ ok: false }), null);
});

test("the region states the provenance and the validation status", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const analysis = analysisReadiness({ scenarioId: "aws-bedrock-cur-v1" });
  const resolved = resolveEvidenceAnswer(bundledFinopsEvidence(analysis));
  renderFinopsAnswer(document, resolved.answer);
  renderFinopsProvenance(document, resolved);
  const region = document.getElementById("finops-canonical-answer");
  assert.equal(region.dataset.validation, "complete");
  assert.equal(region.dataset.evidenceClass, "ELIGIBLE");
  const provenance = textOf(document.getElementById("finops-canonical-answer-provenance"));
  assert.equal(provenance.includes(analysis.finding.id), true, "the finding id is named");
  assert.match(provenance, /class ELIGIBLE/);
  assert.match(provenance, /superseded: none/);
  const validation = textOf(document.getElementById("finops-canonical-answer-validation"));
  assert.match(validation, /Validation: complete/);
  assert.match(validation, new RegExp(`Confidence \\w+ \\(${resolved.confidence.value}/100\\)`));
  assert.match(validation, /4 declared weights, no deductions/);
  // Still no control added above the first-run region: its tab order is full.
  assert.equal(region.querySelectorAll("details").length, 0);
  assert.equal(region.querySelectorAll("button").length, 0);
  assert.equal(region.querySelectorAll("a").length, 0);
});

test("an incomplete evidence set paints no figure and says why", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const resolved = resolveEvidenceAnswer(fixture("fixture-incomplete-no-benchmark"));
  renderFinopsAnswer(document, resolved.answer);
  renderFinopsProvenance(document, resolved);
  const region = document.getElementById("finops-canonical-answer");
  assert.equal(region.dataset.validation, "incomplete");
  assert.equal(region.dataset.evidenceClass, "INCOMPLETE");
  assert.equal(region.dataset.status, "withheld");
  assert.equal(textOf(document.getElementById("finops-canonical-answer-figure")), "");
  const text = textOf(region);
  assert.equal(/\$[\d,]/.test(text), false, "no money survives an incomplete answer");
  assert.equal(/\d+(\.\d+)?%/.test(text), false, "no share either");
  assert.match(textOf(document.getElementById("finops-canonical-answer-validation")),
    /Validation: incomplete — unmet: benchmark/);
  assert.match(textOf(document.getElementById("finops-canonical-answer-validation")),
    /less 100 for incomplete-evidence/);
});

test("a page with no evidence set at all still reports its status", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const resolved = resolveEvidenceAnswer(null);
  renderFinopsAnswer(document, resolved.answer);
  renderFinopsProvenance(document, resolved);
  const region = document.getElementById("finops-canonical-answer");
  assert.equal(region.dataset.validation, "incomplete");
  assert.deepEqual([...resolved.provenance.missingFields], ["findings"]);
  assert.match(textOf(document.getElementById("finops-canonical-answer-provenance")),
    /No finding could be named/);
});
