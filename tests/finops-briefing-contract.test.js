// The versioned briefing contract.
//
// These tests pin the definitions, not the wording: which figure is material
// and why, what coverage means at each confidence level, what an incomplete
// analysis is allowed to say, and what a briefing may never carry. A briefing
// that quotes a visitor's own content to fill a hole is the failure this suite
// exists to catch, so the validator is exercised against briefings that try.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadExampleDataset } from "../src/example-dataset.js";
import { localFinopsJsonExport, localFinopsMeetingSummary } from "../src/local-finops.js";
import {
  ABSENCE_REASON, ABSENCE_STATEMENT, ACCOUNTABLE_ROLE, BRIEFING_CONFIDENCE, BRIEFING_FIXTURE,
  buildFinopsBriefing, CONTRACT_VERSION, COVERAGE_THRESHOLDS, coverageRatio, DEFAULT_HEADLINE_QUESTION,
  MATERIAL_CANDIDATE, periodFromEnvelopeString, questionForAnalysis, validateBriefing,
} from "../src/finops-briefing-contract.js";

/** A minimal envelope in the shape `normalizeLocalFinopsHistory` returns. */
function envelope({
  spendUsd = 1000,
  recoverableUsd = 250,
  departments = [{ id: "u1", name: "Department …atlas0", spendUsd: 600, previousSpendUsd: 400, recoverableUsd: 250 }],
  periods = [
    { period: "2026-05-01 to 2026-06-01", spendUsd: 800 },
    { period: "2026-06-01 to 2026-07-01", spendUsd: 1000 },
  ],
  action = "Pilot lower-cost routing for text-generation; cap the pilot at 250.00 USD.",
  joinedRecords = 90,
  quarantinedRecords = 10,
  providerCompleteness = "complete",
  state = "available",
} = {}) {
  return {
    schemaVersion: "local-finops-history/1.0.0",
    period: periods.at(-1).period,
    spendUsd,
    recoverableUsd,
    rankedDepartments: departments,
    topDepartment: departments[0] ?? null,
    action,
    quality: { joinedRecords, quarantinedRecords, providerCompleteness },
    history: {
      state,
      message: "History is unavailable.",
      periodCount: periods.length,
      currentPeriod: periods.at(-1).period,
      previousPeriod: periods.at(-2)?.period ?? null,
      periods,
    },
  };
}

// --- the one question ------------------------------------------------------

test("the headline question is derived from the analysis type and survives an empty analysis", () => {
  assert.equal(questionForAnalysis("local-finops/1.0.0"), DEFAULT_HEADLINE_QUESTION);
  assert.equal(questionForAnalysis("local-finops-history/1.0.0"), DEFAULT_HEADLINE_QUESTION);
  assert.equal(questionForAnalysis("something-else/9.9.9"), DEFAULT_HEADLINE_QUESTION);
  assert.match(DEFAULT_HEADLINE_QUESTION, /^Is our AI spend justified.*next\?$/);

  // An incomplete analysis still has a question. It is the same one.
  for (const input of [null, undefined, {}, envelope()]) {
    const briefing = buildFinopsBriefing(input);
    assert.equal(briefing.headlineQuestion, DEFAULT_HEADLINE_QUESTION);
    assert.equal(briefing.contractVersion, CONTRACT_VERSION);
  }
});

// --- the material metric ---------------------------------------------------

test("the material figure is the one that sizes the action, with its period half-open", () => {
  const briefing = buildFinopsBriefing(envelope());
  assert.equal(briefing.materialMetric.candidate, MATERIAL_CANDIDATE.recoverableScenario);
  assert.equal(briefing.materialMetric.value, 250);
  assert.equal(briefing.materialMetric.unit, "USD");
  // Inclusive start, exclusive end, exactly as the provider contract's snapshot
  // dates are defined.
  assert.deepEqual({ ...briefing.materialMetric.period },
    { start: "2026-06-01T00:00:00Z", end: "2026-07-01T00:00:00Z" });
  // Exactly one figure. There is no slot for a second.
  assert.equal(typeof briefing.materialMetric.value, "number");
  assert.ok(!("secondaryMetric" in briefing));
});

test("the change against the prior period is the material figure only when no scenario is computable", () => {
  // A ranked department with no recoverable scenario: the higher-ranked
  // candidate is ineligible, so materiality falls to the spend change.
  const briefing = buildFinopsBriefing(envelope({
    recoverableUsd: 0,
    departments: [{ id: "u1", name: "Department …atlas0", spendUsd: 600, previousSpendUsd: 400, recoverableUsd: 0 }],
  }));
  assert.equal(briefing.materialMetric.candidate, MATERIAL_CANDIDATE.spendChange);
  assert.equal(briefing.materialMetric.value, 200);
  assert.equal(briefing.arithmeticInputs.operation,
    "spend_change_usd = reporting_period_spend_usd − prior_period_spend_usd");
  assert.deepEqual(briefing.arithmeticInputs.inputs.map((input) => [input.name, input.value]), [
    ["reporting_period_spend_usd", 1000],
    ["prior_period_spend_usd", 800],
  ]);
});

test("the arithmetic behind the figure is nameable aggregates, and a reader can recompute the figure from them", () => {
  const briefing = buildFinopsBriefing(envelope({ spendUsd: 1000, recoverableUsd: 250 }));
  const inputs = Object.fromEntries(briefing.arithmeticInputs.inputs.map((input) => [input.name, input.value]));
  assert.equal(inputs.analyzed_spend_usd, 1000);
  assert.equal(inputs.recoverable_scenario_usd, 250);
  assert.equal(inputs.ranked_departments, 1);
  // The operation names the division the reader would do by hand.
  assert.equal(inputs.recoverable_scenario_usd / inputs.analyzed_spend_usd, 0.25);
  assert.match(briefing.arithmeticInputs.operation, /recoverable_share = recoverable_scenario_usd ÷ analyzed_spend_usd/);
  for (const input of briefing.arithmeticInputs.inputs) assert.equal(typeof input.value, "number");
});

test("a period string that is not a half-open pair of dates yields no period at all", () => {
  assert.equal(periodFromEnvelopeString("June 2026"), null);
  assert.equal(periodFromEnvelopeString(null), null);
  assert.deepEqual({ ...periodFromEnvelopeString("2026-06-01 to 2026-07-01") },
    { start: "2026-06-01T00:00:00Z", end: "2026-07-01T00:00:00Z" });
});

// --- coverage --------------------------------------------------------------

test("coverage is a ratio computed from its own counts, and the empty denominator is zero", () => {
  assert.equal(coverageRatio(90, 100), 0.9);
  assert.equal(coverageRatio(0, 0), 0, "nothing covered is not full coverage");
  assert.equal(coverageRatio(5, 0), 0);

  const briefing = buildFinopsBriefing(envelope({ joinedRecords: 90, quarantinedRecords: 10 }));
  assert.equal(briefing.coverage.recordsAnalyzed, 90);
  assert.equal(briefing.coverage.recordsTotal, 100);
  assert.equal(briefing.coverage.coverageRatio, 0.9);
});

test("each confidence level is an explicit numeric rule, not a judgement call", () => {
  const at = (joined, quarantined, extra = {}) =>
    buildFinopsBriefing(envelope({ joinedRecords: joined, quarantinedRecords: quarantined, ...extra })).coverage;

  assert.equal(COVERAGE_THRESHOLDS.high, 0.9);
  assert.equal(COVERAGE_THRESHOLDS.moderate, 0.6);
  assert.equal(at(90, 10).confidence, BRIEFING_CONFIDENCE.high);
  assert.equal(at(89, 11).confidence, BRIEFING_CONFIDENCE.moderate);
  assert.equal(at(60, 40).confidence, BRIEFING_CONFIDENCE.moderate);
  assert.equal(at(59, 41).confidence, BRIEFING_CONFIDENCE.low);
  assert.equal(at(0, 40).confidence, BRIEFING_CONFIDENCE.insufficient);
  assert.equal(at(0, 0).confidence, BRIEFING_CONFIDENCE.insufficient);

  // At or above the high threshold but with an input missing, the answer is
  // moderate: the ratio is a claim about records, not about completeness.
  const incomplete = at(95, 5, { providerCompleteness: null });
  assert.equal(incomplete.coverageRatio, 0.95);
  assert.deepEqual([...incomplete.missingInputs], ["provider_completeness"]);
  assert.equal(incomplete.confidence, BRIEFING_CONFIDENCE.moderate);
});

test("coverage is present on every briefing, including the ones with no figure in them", () => {
  for (const briefing of [
    buildFinopsBriefing(null),
    buildFinopsBriefing(envelope({ departments: [], recoverableUsd: 0, joinedRecords: 0, quarantinedRecords: 40 })),
    buildFinopsBriefing(envelope(), { attributionWithheld: true }),
  ]) {
    assert.ok(briefing.coverage, "coverage is never dropped to hide a weak analysis");
    assert.ok(Object.values(BRIEFING_CONFIDENCE).includes(briefing.coverage.confidence));
    assert.equal(validateBriefing(briefing).valid, true);
  }
});

// --- incomplete analyses stay honest ---------------------------------------

test("an absent figure is a reason, never a zero, a dash, or an estimate", () => {
  const single = buildFinopsBriefing(envelope({
    recoverableUsd: 0,
    departments: [{ id: "u1", name: "Department …atlas0", spendUsd: 600, previousSpendUsd: 600, recoverableUsd: 0 }],
    periods: [{ period: "2026-06-01 to 2026-07-01", spendUsd: 1000 }],
    state: "missing",
  }));
  assert.equal(single.materialMetric, null);
  assert.equal(single.arithmeticInputs, null);
  assert.equal(single.absent.materialMetric.reason, ABSENCE_REASON.noComparablePriorPeriod);
  assert.equal(single.absent.materialMetric.statement, ABSENCE_STATEMENT[ABSENCE_REASON.noComparablePriorPeriod]);
  assert.doesNotMatch(single.absent.materialMetric.statement, /\b0(\.00)?\b|—|approximate|estimate/);

  // Nothing joined at all. "No spend joined an org unit" is more use to a
  // reader than "the prior period is missing", so it is the reason reported.
  const unjoined = buildFinopsBriefing(envelope({
    departments: [], recoverableUsd: 0, joinedRecords: 0,
    periods: [{ period: "2026-06-01 to 2026-07-01", spendUsd: 1000 }], state: "missing",
  }));
  assert.equal(unjoined.materialMetric, null);
  assert.equal(unjoined.absent.materialMetric.reason, ABSENCE_REASON.noAttributedSpend);

  // The page already withheld the money figure; the briefing honours that
  // rather than re-deriving it and disagreeing.
  const withheld = buildFinopsBriefing(envelope(), { attributionWithheld: true });
  assert.equal(withheld.materialMetric.candidate, MATERIAL_CANDIDATE.spendChange,
    "a withheld scenario falls to the next candidate rather than vanishing");
  const withheldAndFlat = buildFinopsBriefing(
    envelope({ periods: [{ period: "2026-06-01 to 2026-07-01", spendUsd: 1000 }], state: "missing" }),
    { attributionWithheld: true });
  assert.equal(withheldAndFlat.materialMetric, null);
  assert.equal(withheldAndFlat.absent.materialMetric.reason, ABSENCE_REASON.attributionBelowFloor);

  // No analysis at all.
  assert.equal(buildFinopsBriefing(null).absent.materialMetric.reason, ABSENCE_REASON.noAnalysis);
});

test("an absent action says the analysis cannot prioritize one, never a generic one", () => {
  const noFigure = buildFinopsBriefing(null);
  assert.equal(noFigure.rankedAction, null);
  assert.equal(noFigure.absent.rankedAction.reason, ABSENCE_REASON.noMaterialMetric);
  assert.match(noFigure.absent.rankedAction.statement, /insufficient to prioritize an action/);

  // The envelope ranked no department, so there is no owner and no action.
  const unranked = buildFinopsBriefing(envelope({ departments: [], action: "" }));
  assert.equal(unranked.rankedAction, null);

  // The change's driver and the top-ranked recommendation are different
  // departments: `leadingFinding` already refuses to pair them, and the
  // contract reads that refusal rather than repeating the rule.
  const mismatched = buildFinopsBriefing(envelope({
    recoverableUsd: 0,
    departments: [
      { id: "flat", name: "Department …flat00", spendUsd: 500, previousSpendUsd: 500, recoverableUsd: 0 },
      { id: "grew", name: "Department …grew00", spendUsd: 500, previousSpendUsd: 300, recoverableUsd: 0 },
    ],
  }));
  assert.equal(mismatched.materialMetric.candidate, MATERIAL_CANDIDATE.spendChange);
  assert.equal(mismatched.rankedAction, null);
  assert.equal(mismatched.absent.rankedAction.reason, ABSENCE_REASON.actionDoesNotNameDriver);
});

test("every absence reason has exactly one authored statement, so consumers cannot each invent one", () => {
  for (const reason of Object.values(ABSENCE_REASON)) {
    assert.equal(typeof ABSENCE_STATEMENT[reason], "string");
    assert.ok(ABSENCE_STATEMENT[reason].length > 20, `${reason} needs a statement a reader can act on`);
  }
  assert.equal(Object.keys(ABSENCE_STATEMENT).length, Object.values(ABSENCE_REASON).length);
});

// --- the action's owner is a role -----------------------------------------

test("the accountable party is a role from the table, never a person or an identifier", () => {
  const briefing = buildFinopsBriefing(envelope());
  assert.equal(briefing.rankedAction.rank, 1);
  assert.equal(briefing.rankedAction.accountableRole, ACCOUNTABLE_ROLE.routing_pilot);
  assert.ok(Object.values(ACCOUNTABLE_ROLE).includes(briefing.rankedAction.accountableRole));
  for (const role of Object.values(ACCOUNTABLE_ROLE)) {
    assert.doesNotMatch(role, /@|\d/, "a role is a role, not an address or an id");
  }
});

// --- the fixture -----------------------------------------------------------

test("the committed fixture is a complete, valid briefing built only from aggregates", () => {
  const report = validateBriefing(BRIEFING_FIXTURE);
  assert.deepEqual(report.violations, []);
  assert.equal(report.valid, true);
  assert.equal(BRIEFING_FIXTURE.contractVersion, CONTRACT_VERSION);
  assert.ok(BRIEFING_FIXTURE.materialMetric && BRIEFING_FIXTURE.rankedAction && BRIEFING_FIXTURE.coverage);
  assert.deepEqual(BRIEFING_FIXTURE.absent, {});
  // Every value under arithmeticInputs is a number, so nothing quoted can hide
  // in the evidence for the figure.
  for (const input of BRIEFING_FIXTURE.arithmeticInputs.inputs) assert.equal(typeof input.value, "number");
});

// --- forbidden content, enforced ------------------------------------------

test("the validator rejects a briefing carrying prompt text, conversation content, or a credential", () => {
  const cases = [
    ["promptText", { promptText: "Summarize this contract for the board" }],
    ["prompt_excerpt", { prompt_excerpt: "why is our spend up" }],
    ["conversationId", { conversationId: "c-1024" }],
    ["rawContent", { rawContent: "user said: ..." }],
    ["apiKey", { apiKey: "abc" }],
    ["authorization", { authorization: "Bearer abc" }],
  ];
  for (const [label, extra] of cases) {
    const report = validateBriefing({ ...BRIEFING_FIXTURE, ...extra });
    assert.equal(report.valid, false, `${label} must be rejected`);
    assert.ok(report.violations.some((violation) => violation.code === "forbidden_field"),
      `${label} must be rejected as a forbidden field`);
  }
});

test("the validator rejects a customer-identifying field wherever it is nested", () => {
  for (const briefing of [
    { ...BRIEFING_FIXTURE, rankedAction: { ...BRIEFING_FIXTURE.rankedAction, accountableEmail: "cfo@example.com" } },
    { ...BRIEFING_FIXTURE, coverage: { ...BRIEFING_FIXTURE.coverage, userId: 12 } },
    { ...BRIEFING_FIXTURE, materialMetric: { ...BRIEFING_FIXTURE.materialMetric, accountId: "a-9" } },
  ]) {
    const report = validateBriefing(briefing);
    assert.equal(report.valid, false);
    assert.ok(report.violations.some((violation) => violation.code === "forbidden_field"));
  }
});

test("the validator rejects an identifier-shaped value even under an innocent key", () => {
  const byCode = (extra) => validateBriefing({ ...BRIEFING_FIXTURE, ...extra }).violations.map((v) => v.code);
  assert.ok(byCode({ note: "reply to cfo@example.com" }).includes("email_address"));
  assert.ok(byCode({ note: "gateway at 10.4.12.9" }).includes("ip_address"));
  assert.ok(byCode({ note: "sk-abcdefghijklmnopqrst" }).includes("bearer_token"));
  // Free-form prose is a leak whatever it is called: a briefing is aggregates
  // and authored sentences, and nothing in it runs to a paragraph.
  assert.ok(byCode({ note: "x".repeat(401) }).includes("free_form_text"));
  assert.equal(validateBriefing({ ...BRIEFING_FIXTURE, note: "760 records analyzed" }).valid, true);
});

test("the validator rejects a briefing whose stated coverage contradicts its own counts", () => {
  const codes = (coverage) =>
    validateBriefing({ ...BRIEFING_FIXTURE, coverage }).violations.map((violation) => violation.code);
  assert.ok(codes({ ...BRIEFING_FIXTURE.coverage, coverageRatio: 1 })
    .includes("ratio_not_computed_from_counts"));
  assert.ok(codes({ ...BRIEFING_FIXTURE.coverage, confidence: "pretty good" })
    .includes("confidence_not_in_enum"));
  assert.ok(codes({ recordsAnalyzed: 10, recordsTotal: 100, coverageRatio: 0.1, confidence: BRIEFING_CONFIDENCE.high, missingInputs: [] })
    .includes("confidence_contradicts_thresholds"));
  assert.ok(validateBriefing({ ...BRIEFING_FIXTURE, coverage: undefined }).violations
    .some((violation) => violation.code === "coverage_absent"));
});

test("the validator rejects a hole with no reason, a figure with no arithmetic, and a wrong version", () => {
  const codes = (briefing) => validateBriefing(briefing).violations.map((violation) => violation.code);
  assert.ok(codes({ ...BRIEFING_FIXTURE, materialMetric: null, arithmeticInputs: null, absent: {} })
    .includes("absent_slot_without_reason"));
  assert.ok(codes({ ...BRIEFING_FIXTURE, rankedAction: null, absent: {} })
    .includes("absent_slot_without_reason"));
  assert.ok(codes({ ...BRIEFING_FIXTURE, arithmeticInputs: null }).includes("figure_without_arithmetic"));
  assert.ok(codes({ ...BRIEFING_FIXTURE, contractVersion: "finops-briefing/0.9.0" })
    .includes("wrong_contract_version"));
  assert.ok(codes({ ...BRIEFING_FIXTURE, headlineQuestion: "Spend summary" }).includes("missing_question"));
  assert.ok(codes({ ...BRIEFING_FIXTURE, provenance: { text: "computed", displayOnly: false } })
    .includes("missing_client_side_provenance"));
  assert.ok(codes({
    ...BRIEFING_FIXTURE,
    materialMetric: { ...BRIEFING_FIXTURE.materialMetric, period: { start: "June 2026", end: "July 2026" } },
  }).includes("period_not_iso_8601"));
  assert.ok(codes({
    ...BRIEFING_FIXTURE,
    rankedAction: { ...BRIEFING_FIXTURE.rankedAction, accountableRole: "Dana Whitfield" },
  }).includes("role_not_in_table"));
  assert.equal(validateBriefing(null).valid, false);
});

// --- provenance is display-only -------------------------------------------

test("the provenance line states client-side processing and is marked display-only", () => {
  const briefing = buildFinopsBriefing(envelope());
  assert.equal(briefing.provenance.displayOnly, true);
  assert.match(briefing.provenance.text, /ran in your browser/);
  assert.match(briefing.provenance.text, /left this tab/);
  assert.ok(briefing.rubricVersion.length > 0, "a graded field names the rubric that graded it");
});

// --- built from the shipped example dataset -------------------------------

test("a briefing built from the shipped example dataset is valid and answers the one question", () => {
  const briefing = buildFinopsBriefing(loadExampleDataset());
  assert.deepEqual(validateBriefing(briefing).violations, []);
  assert.equal(briefing.headlineQuestion, DEFAULT_HEADLINE_QUESTION);
  assert.ok(briefing.materialMetric.value > 0);
  assert.equal(briefing.rankedAction.rank, 1);
  assert.equal(briefing.coverage.recordsTotal >= briefing.coverage.recordsAnalyzed, true);
});

// --- the seam downstream consumers must not fork --------------------------

test("the export path records the briefing-contract version it was built against", () => {
  const result = loadExampleDataset();
  const json = JSON.parse(localFinopsJsonExport(result));
  assert.equal(json.briefingContractVersion, CONTRACT_VERSION);
  const exampleJson = JSON.parse(localFinopsJsonExport(result, { exampleDataset: true }));
  assert.equal(exampleJson.briefingContractVersion, CONTRACT_VERSION);
  assert.match(localFinopsMeetingSummary(result), new RegExp(`Briefing contract: ${CONTRACT_VERSION}`));
});

test("the page renders the three slots from the contract rather than deciding them itself", async () => {
  const [page, flow, script] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/local-import-flow.js", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  // The page builds a briefing and hands it to the painter. Nothing else on
  // this page selects the question, the figure, or the action.
  assert.match(script, /buildFinopsBriefing\(next, \{/);
  assert.match(script, /applyBriefing\(document,/);
  assert.doesNotMatch(script, /applyLeadingFinding/);
  assert.doesNotMatch(flow, /applyLeadingFinding/);

  // Question, figure, action — in that order in the DOM, not by stylesheet.
  const order = ["local-lead-question", "local-lead-metric", "local-lead-action"]
    .map((id) => page.indexOf(`id="${id}"`));
  assert.ok(order.every((index) => index > 0), "all three slots exist in the markup");
  assert.deepEqual([...order].sort((left, right) => left - right), order);
  // The authored markup carries no figure of its own: every slot ships empty.
  assert.match(page, /id="local-lead-metric" data-available="false">—</);
  assert.match(page, /id="local-lead-arithmetic" hidden><\/p>/);
});
