import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml, textOf } from "./support/browser.js";
import { analysisReadiness } from "../src/finops-bundled-scenarios.js";
import {
  CONFIDENCE_THRESHOLD, WITHHELD, finopsAnswerSignals, resolveFinopsAnswer,
} from "../src/finops-answer-contract.js";
import { renderFinopsAnswer } from "../src/finops-answer-contract-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

/** A clean, answerable signal set. Every test below deviates from this in one
 *  way, so a failure names the rule it broke rather than the fixture. */
const signals = (overrides = {}) => ({
  recommendedActions: [{
    id: "act-2", sourceId: "act-2", label: "Route batch work to the standard model",
    department: "Data Platform", monthlySavingsUsd: 900,
  }],
  baseline: { sourceId: "departments.spendUsd", monthlySpendUsd: 10000 },
  benchmark: { sourceId: "finding.benchmark", label: "Peer median", value: 1000, unit: "USD" },
  confidence: { sourceId: "readiness.confidence.value", value: 63 },
  readiness: { sourceId: "readiness.level", level: "illustrative_only" },
  statedAnnualSavingsUsd: [],
  statedSavingsPercent: null,
  ...overrides,
});

test("the answered case derives every field from the named signals", () => {
  const answer = resolveFinopsAnswer(signals());
  assert.equal(answer.status, "answered");
  assert.equal(answer.annualSavingsUsd, 10800, "900 × 12");
  assert.equal(answer.annualBaselineSpendUsd, 120000, "10,000 monthly × 12");
  assert.equal(answer.savingsPercent, 9, "10,800 × 100 ÷ 120,000");
  assert.equal(answer.primaryAction.id, "act-2");
  assert.equal(answer.primaryAction.department, "Data Platform");
  assert.equal(answer.benchmark.label, "Peer median");
  assert.equal(answer.benchmark.value, 1000);
  assert.equal(answer.benchmark.unit, "USD");
  assert.equal(answer.confidence.level, "medium");
  assert.equal(answer.readiness.state, "illustrative");
  assert.equal(answer.withheldReason, null);
  // The monthly-only baseline is annualised, and the ×12 is named rather than
  // left for a reader of the source line to assume.
  assert.deepEqual(answer.sources.savingsPercent, ["act-2", "departments.spendUsd × 12"]);
  assert.deepEqual(answer.sources.annualSavingsUsd, ["act-2"]);
  assert.deepEqual(answer.sources.benchmark, ["finding.benchmark"]);
  assert.equal(Object.isFrozen(answer), true);
});

// Rounding is where two engineers diverge, so both roundings are pinned at a
// half boundary rather than at a value any rule would agree on.
test("both derived figures round half up at a .5 boundary", () => {
  const annual = resolveFinopsAnswer(signals({
    recommendedActions: [{ id: "a", sourceId: "a", label: "A", monthlySavingsUsd: 100.125 }],
  }));
  assert.equal(annual.annualSavingsUsd, 1202, "1,201.5 rounds up, not to even");

  const percent = resolveFinopsAnswer(signals({
    recommendedActions: [{ id: "a", sourceId: "a", label: "A", monthlySavingsUsd: 1250 / 12 }],
    baseline: { sourceId: "b", annualSpendUsd: 100000 },
  }));
  assert.equal(percent.annualSavingsUsd, 1250);
  assert.equal(percent.savingsPercent, 1.3, "1.25% rounds half up to one decimal");
});

test("an annual baseline stated directly is used unchanged", () => {
  const answer = resolveFinopsAnswer(signals({
    baseline: { sourceId: "scenario.annualBaseline", annualSpendUsd: 120000 },
  }));
  assert.equal(answer.annualBaselineSpendUsd, 120000);
  assert.deepEqual(answer.sources.savingsPercent, ["act-2", "scenario.annualBaseline"]);
});

test("confidence is a documented cut into the existing 0–100 signal", () => {
  const level = (value) => resolveFinopsAnswer(signals({
    confidence: { sourceId: "c", value },
  })).confidence.level;
  assert.equal(level(CONFIDENCE_THRESHOLD.high), "high");
  assert.equal(level(CONFIDENCE_THRESHOLD.high - 1), "medium");
  assert.equal(level(CONFIDENCE_THRESHOLD.medium), "medium");
  assert.equal(level(CONFIDENCE_THRESHOLD.medium - 1), "low");
});

test("the prioritized action breaks ties by savings, readiness, effort, then id", () => {
  const action = (over) => ({ id: over.id, sourceId: over.id, label: over.id, ...over });
  const winner = (actions) => resolveFinopsAnswer(signals({ recommendedActions: actions }))
    .primaryAction.id;

  assert.equal(winner([
    action({ id: "small", monthlySavingsUsd: 100 }),
    action({ id: "large", monthlySavingsUsd: 900 }),
  ]), "large", "highest monthly savings wins outright");

  assert.equal(winner([
    action({ id: "b-low-readiness", monthlySavingsUsd: 500, readiness: 1 }),
    action({ id: "a-high-readiness", monthlySavingsUsd: 500, readiness: 9 }),
  ]), "a-high-readiness", "equal savings: higher readiness wins");

  assert.equal(winner([
    action({ id: "a-hard", monthlySavingsUsd: 500, readiness: 5, effort: 8 }),
    action({ id: "b-easy", monthlySavingsUsd: 500, readiness: 5, effort: 2 }),
  ]), "b-easy", "equal savings and readiness: lower effort wins");

  assert.equal(winner([
    action({ id: "zzz", monthlySavingsUsd: 500 }),
    action({ id: "aaa", monthlySavingsUsd: 500 }),
  ]), "aaa", "everything else equal: ascending action id, by code point");
});

test("every input the definitions need is required, by its own reason code", () => {
  const code = (overrides) => resolveFinopsAnswer(signals(overrides)).withheldReason.code;
  assert.equal(resolveFinopsAnswer(null).withheldReason.code, WITHHELD.missingInput);
  assert.equal(code({ recommendedActions: null }), WITHHELD.missingInput);
  assert.equal(code({ baseline: { sourceId: "b" } }), WITHHELD.missingInput,
    "no annual and no monthly baseline is not a zero baseline");
  assert.equal(code({ baseline: { sourceId: "b", monthlySpendUsd: 0 } }), WITHHELD.missingInput);
  assert.equal(code({ confidence: { sourceId: "c", value: null } }), WITHHELD.missingInput);
  assert.equal(code({ confidence: { sourceId: "c", value: Number.NaN } }), WITHHELD.missingInput);
  assert.equal(code({ readiness: { sourceId: "r", level: "unheard-of" } }), WITHHELD.missingInput);
  assert.equal(code({
    recommendedActions: [{ id: "a", label: "A", monthlySavingsUsd: Number.POSITIVE_INFINITY }],
  }), WITHHELD.missingInput, "a non-finite monthly saving cannot be summed");
});

test("a scenario carrying two disagreeing annual figures quotes neither", () => {
  const code = (stated) => resolveFinopsAnswer(signals({ statedAnnualSavingsUsd: stated }))
    .withheldReason?.code ?? null;
  // Derived is 10,800. Tolerance is the wider of $1 and 0.5% (= $54).
  assert.equal(code([{ id: "s", value: 10850 }]), null, "inside 0.5% is not a conflict");
  assert.equal(code([{ id: "s", value: 10900 }]), WITHHELD.conflictingSavings);
  assert.equal(code([{ id: "s", value: null }]), WITHHELD.conflictingSavings,
    "an unreadable second figure is a disagreement, not an absence");
});

test("a stated percentage that disagrees with the computed one withholds both", () => {
  const code = (value) => resolveFinopsAnswer(signals({
    statedSavingsPercent: { sourceId: "p", value },
  })).withheldReason?.code ?? null;
  assert.equal(code(9), null);
  assert.equal(code(9.1), null, "0.1 points is the tolerance, not past it");
  assert.equal(code(9.2), WITHHELD.inconsistentPercent);
  assert.equal(code(12), WITHHELD.inconsistentPercent);
});

test("an empty recommended set implies no action, and says so", () => {
  const answer = resolveFinopsAnswer(signals({ recommendedActions: [] }));
  assert.equal(answer.withheldReason.code, WITHHELD.noRecommendedAction);
  assert.equal(answer.annualSavingsUsd, null);
  assert.equal(answer.savingsPercent, null);
  assert.equal(answer.primaryAction, null);
  // The signals it still trusts survive, so the view has something honest left.
  assert.equal(answer.confidence.level, "medium");
  assert.equal(answer.benchmark.label, "Peer median");
});

test("a figure with no benchmark behind it is not published", () => {
  for (const benchmark of [null, { sourceId: "b", label: "Peer median", value: null, unit: "USD" },
    { sourceId: "b", label: "", value: 1000, unit: "USD" }]) {
    const answer = resolveFinopsAnswer(signals({ benchmark }));
    assert.equal(answer.withheldReason.code, WITHHELD.unsupportedBenchmark);
    assert.equal(answer.benchmark, null);
    assert.equal(answer.annualSavingsUsd, null);
  }
});

test("readiness the analysis already calls not actionable blocks the answer", () => {
  const answer = resolveFinopsAnswer(signals({
    readiness: { sourceId: "readiness.level", level: "insufficient" },
  }));
  assert.equal(answer.withheldReason.code, WITHHELD.readinessBlocked);
  assert.equal(answer.readiness.state, "blocked");
  assert.equal(answer.primaryAction, null);
  assert.equal(resolveFinopsAnswer(signals({
    readiness: { sourceId: "readiness.level", level: "ready" },
  })).readiness.state, "ready");
});

// The adapter is what makes this contract a reading of the page's analysis
// rather than a second dataset beside it.
test("the page's own bundled analysis resolves to one traceable answer", () => {
  const analysis = analysisReadiness({ scenarioId: "aws-bedrock-cur-v1" });
  const answer = resolveFinopsAnswer(finopsAnswerSignals(analysis));
  assert.equal(answer.status, "answered");
  assert.equal(answer.annualSavingsUsd,
    analysis.readiness.recommendation.figure.value * 12);
  assert.equal(answer.annualBaselineSpendUsd, analysis.sample.departments[0].spendUsd * 12);
  assert.equal(answer.savingsPercent, 20);
  assert.equal(answer.benchmark.label, analysis.finding.benchmark.name);
  assert.equal(answer.benchmark.value, analysis.finding.benchmark.value);
  assert.equal(answer.primaryAction.id, analysis.readiness.recommendation.id);
  assert.equal(answer.confidence.value, analysis.readiness.confidence.value);
  assert.equal(finopsAnswerSignals({ ok: false }), null);
});

test("the answer region states the figure, the benchmark, the action and the sources", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const analysis = analysisReadiness({ scenarioId: "aws-bedrock-cur-v1" });
  renderFinopsAnswer(document, resolveFinopsAnswer(finopsAnswerSignals(analysis)));
  const region = document.getElementById("finops-canonical-answer");
  assert.equal(region.dataset.status, "answered");
  assert.equal(region.dataset.reason, "none");
  const figure = document.getElementById("finops-canonical-answer-figure");
  assert.equal(figure.dataset.available, "true");
  assert.match(textOf(figure), /\$43,200 a year/);
  assert.match(textOf(figure), /20% of the \$216,000/);
  assert.match(textOf(document.getElementById("finops-canonical-answer-benchmark")),
    /Bundled demo materiality floor at \$1,000/);
  // #1667: this region no longer carries an action link of its own. The first
  // screen states ONE next action, #finops-recoverable-action, and this one
  // pointed at the same destination at the same weight.
  assert.equal(document.querySelectorAll("#finops-canonical-answer-action").length, 0);
  assert.match(textOf(document.getElementById("finops-canonical-answer-sources")),
    /readiness\.recommendation\.figure\.value/);
  assert.equal(textOf(document.getElementById("finops-canonical-answer-reason")), "");
  // The answer itself is never behind a control — no disclosure and no button
  // stands between a reader and the figure. #1465 added exactly one operable
  // element, the action the figure implies, because an answer whose next step a
  // reader cannot act on is a report rather than a decision.
  assert.equal(region.querySelectorAll("details").length, 0);
  assert.equal(region.querySelectorAll("button").length, 0);
  // #1667: and no anchor either. One action on the first screen, above.
  assert.equal(region.querySelectorAll("a").length, 0);
});

test("a withheld scenario renders the reason and no answer at all", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  renderFinopsAnswer(document, resolveFinopsAnswer(signals({ recommendedActions: [] })));
  const region = document.getElementById("finops-canonical-answer");
  assert.equal(region.dataset.status, "withheld");
  assert.equal(region.dataset.reason, WITHHELD.noRecommendedAction);
  const figure = document.getElementById("finops-canonical-answer-figure");
  assert.equal(figure.dataset.available, "false");
  assert.equal(textOf(figure), "", "no annual figure");
  // #1465: the slot says why it is empty rather than being empty. A blank line
  // under a figure reads as a benchmark somebody forgot, not one that is absent.
  assert.match(textOf(document.getElementById("finops-canonical-answer-benchmark")),
    /nothing for a benchmark to support/);
  const reason = textOf(document.getElementById("finops-canonical-answer-reason"));
  assert.match(reason, /no prioritized action to imply/);
  // Nothing anywhere in the region may read as a savings figure or a share.
  assert.equal(/\$[\d,]/.test(textOf(region)), false, "no money survives a withheld answer");
  assert.equal(/\d+(\.\d+)?%/.test(textOf(region)), false, "no percentage either");
  assert.match(textOf(document.getElementById("finops-canonical-answer-sources")),
    /Signals still trusted/);
});

test("an analysis that failed to load withholds rather than painting a stale answer", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  renderFinopsAnswer(document, resolveFinopsAnswer(finopsAnswerSignals(analysisReadiness({
    scenarioId: "aws-bedrock-cur-v1",
  }))));
  renderFinopsAnswer(document, null);
  const region = document.getElementById("finops-canonical-answer");
  assert.equal(region.dataset.status, "withheld");
  assert.equal(region.dataset.reason, WITHHELD.missingInput);
  assert.equal(textOf(document.getElementById("finops-canonical-answer-figure")), "",
    "the previously painted figure is cleared, not left behind");
  assert.match(textOf(document.getElementById("finops-canonical-answer-reason")), /did not load/);
});
