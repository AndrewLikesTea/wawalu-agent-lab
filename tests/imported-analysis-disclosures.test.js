// One imported analysis, four linked disclosures — and the regression that
// proves they cannot drift apart.
//
// The defect this suite pins: the AI FinOps tab used to compose the leading
// finding, the benchmark card, the recommendation evidence, and the
// quantified-impact figure at four separate call sites reading three different
// inputs. The benchmark card in particular was two CONSTANT strings written over
// whatever the analysis envelope said, so an import that DID establish an
// intra-tenant cohort was still told it had none.
//
// Every fixture below is built in this file from a small, explicit department
// list, so the "change one department" tests change exactly one thing. The
// benchmark half of each fixture is produced by the SHIPPED cohort builder
// (`benchmarkFromDepartments`) rather than hand-written, so a fixture cannot
// assert a cohort the real analysis would never publish.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DISCLOSURE_GAP, DISCLOSURE_SOURCE, GUIDED_DISCLOSURES_VERSION,
  guidedDisclosures, importedAnalysisState,
} from "../src/imported-analysis-disclosures.js";
import { benchmarkFromDepartments } from "../src/query-literacy.js";
import { IMPORTED_BRIEFING_EMPTY } from "../src/briefing-strings.js";

const REPORTING = "2026-06-01 to 2026-07-01";
const PRIOR = "2026-05-01 to 2026-06-01";

/** Three graded departments: enough for the cohort floor the analysis declares. */
const DEPARTMENTS = Object.freeze([
  { id: "unit-atlas", name: "Atlas Platform", spendUsd: 412.75, previousSpendUsd: 300, recoverableUsd: 120.5, records: 4, score: 71 },
  { id: "unit-boreal", name: "Boreal Support", spendUsd: 31.4, previousSpendUsd: 28, recoverableUsd: 9.2, records: 2, score: 64 },
  { id: "unit-cinder", name: "Cinder Research", spendUsd: 102.05, previousSpendUsd: 110, recoverableUsd: 40, records: 3, score: 58 },
]);

const sum = (values) => Number(values.reduce((total, value) => total + value, 0).toFixed(2));

/**
 * An analysis envelope in the shape `normalizeLocalFinopsHistory` publishes,
 * built from a department list so one edit propagates the way a real re-import
 * would: the ranking, the top department, the totals, the evidence lines and the
 * cohort all move together.
 */
function analysisFixture(departments = DEPARTMENTS, { action = null, gradeable = true } = {}) {
  const ranked = [...departments].sort((left, right) => right.recoverableUsd - left.recoverableUsd
    || String(left.id).localeCompare(String(right.id)));
  const top = ranked[0];
  const spendUsd = sum(departments.map((department) => department.spendUsd));
  const priorSpendUsd = sum(departments.map((department) => department.previousSpendUsd));
  const recoverableUsd = sum(departments.map((department) => department.recoverableUsd));
  return Object.freeze({
    schemaVersion: "local-finops-history/1.0.0",
    period: REPORTING,
    spendUsd,
    recoverableUsd,
    confidence: "Medium",
    provenance: "Browser-local projection of provider export exp-1.",
    rankedDepartments: Object.freeze(ranked.map((department) => Object.freeze({ ...department }))),
    topDepartment: Object.freeze({ ...top }),
    action: action ?? `Pilot lower-cost routing for text-generation in ${top.name}; cap the pilot at `
      + `${top.recoverableUsd.toFixed(2)} USD and verify against a like-for-like period.`,
    evidence: Object.freeze([
      `${top.records} deduplicated provider aggregates joined to ${top.id}.`,
      `${top.spendUsd.toFixed(2)} USD observed; ${top.recoverableUsd.toFixed(2)} USD is the disclosed routing scenario.`,
    ]),
    history: Object.freeze({
      state: "available",
      currentPeriod: REPORTING,
      previousPeriod: PRIOR,
      message: "Two comparable provider periods were analyzed.",
      organizationTrendAvailable: true,
      organizationSpendChangePercent: 12,
      periods: Object.freeze([
        Object.freeze({ period: PRIOR, spendUsd: priorSpendUsd, recoverableUsd: 0, completeness: "complete", exportId: "exp-0" }),
        Object.freeze({ period: REPORTING, spendUsd, recoverableUsd, completeness: "complete", exportId: "exp-1" }),
      ]),
    }),
    // The shipped cohort builder, over the same departments, so the benchmark is
    // the analysis's own answer rather than this file's opinion of it.
    benchmark: benchmarkFromDepartments(
      departments.map((department) => ({
        departmentId: department.id, gradeable, score: department.score,
      })),
      { hasSample: true }),
    quality: Object.freeze({
      providerCompleteness: "complete",
      joinedRecords: departments.reduce((total, department) => total + department.records, 0),
      quarantinedRecords: 1,
    }),
  });
}

const importedFrom = (analysis, overrides = {}) => guidedDisclosures(importedAnalysisState({
  analysis,
  source: DISCLOSURE_SOURCE.import,
  files: ["openai-usage-export.csv"],
  attributedShare: 0.81,
  ...overrides,
}));

// ---------------------------------------------------------------------------
// One state fills all four.
// ---------------------------------------------------------------------------

test("one imported-analysis state fills the leading finding, benchmark, evidence, and savings", () => {
  const analysis = analysisFixture();
  const { guided, provenance, source, version } = importedFrom(analysis);

  assert.equal(version, GUIDED_DISCLOSURES_VERSION);
  assert.equal(source, DISCLOSURE_SOURCE.import);

  assert.equal(guided.finding.available, true);
  assert.equal(guided.finding.briefing.materialMetric.value, analysis.recoverableUsd,
    "the leading finding must size itself from this analysis's own recoverable figure");
  assert.equal(guided.finding.briefing.rankedAction.action, analysis.action);

  // The cohort the analysis actually published — not "No compatible peer cohort".
  assert.equal(guided.benchmark.available, true);
  assert.equal(guided.benchmark.cohort.size, 3);
  assert.match(guided.benchmark.answer, /^Cohort median 64 across 3 graded departments$/);
  assert.match(guided.benchmark.summary, /^Intra-tenant cohort · 3 graded departments · median 64$/);

  assert.equal(guided.evidence.available, true);
  assert.deepEqual([...guided.evidence.items], [...analysis.evidence]);

  assert.equal(guided.savings.available, true);
  assert.equal(guided.savings.value, "169.70 USD");
  assert.equal(guided.savings.real, true);
  assert.equal(guided.savings.department, "Atlas Platform");
  assert.equal(guided.savings.action, analysis.action);

  // One provenance object, shared by all four, so the four cards cannot qualify
  // the same analysis with four different lines.
  for (const disclosure of Object.values(guided)) {
    assert.equal(disclosure.provenance, provenance);
    assert.equal(disclosure.provenance.period, REPORTING);
    assert.deepEqual([...disclosure.provenance.files], ["openai-usage-export.csv"]);
    assert.equal(disclosure.provenance.recordsAnalyzed, 9);
    assert.equal(disclosure.provenance.recordsExcluded, 1);
  }
});

// ---------------------------------------------------------------------------
// The regression: one department moves, all four move.
// ---------------------------------------------------------------------------

test("changing one imported department updates every linked disclosure", () => {
  const before = importedFrom(analysisFixture()).guided;
  // One department re-imported: more spend, more recoverable, and a grade low
  // enough to move the cohort's middle value. Nothing else about the import
  // changes.
  const changed = DEPARTMENTS.map((department) => (department.id === "unit-atlas"
    ? { ...department, spendUsd: 812.75, recoverableUsd: 260.5, records: 6, score: 45 }
    : department));
  const after = importedFrom(analysisFixture(changed)).guided;

  assert.notEqual(after.finding.briefing.materialMetric.value, before.finding.briefing.materialMetric.value);
  assert.equal(after.finding.briefing.materialMetric.value, 309.7);
  assert.notEqual(after.finding.briefing.rankedAction.action, before.finding.briefing.rankedAction.action);

  assert.notEqual(after.benchmark.answer, before.benchmark.answer,
    "a re-graded department must move the cohort median the benchmark card publishes");
  assert.equal(after.benchmark.answer, "Cohort median 58 across 3 graded departments");

  assert.notDeepEqual([...after.evidence.items], [...before.evidence.items]);
  assert.ok(after.evidence.items.some((item) => item.includes("260.50 USD")),
    "the evidence list must quote the department's new routing scenario");

  assert.equal(before.savings.value, "169.70 USD");
  assert.equal(after.savings.value, "309.70 USD");
  assert.match(after.savings.action, /260\.50 USD/);
});

test("changing the ranked recommendation updates the finding and the savings action together", () => {
  const analysis = analysisFixture();
  const before = importedFrom(analysis).guided;
  const after = importedFrom(analysisFixture(DEPARTMENTS, {
    action: "Hold routing changes and re-run the export with the corrected org roster.",
  })).guided;

  assert.notEqual(after.finding.briefing.rankedAction.action, before.finding.briefing.rankedAction.action);
  assert.equal(after.savings.action, after.finding.briefing.rankedAction.action,
    "the action beside the figure and the action in the briefing are one decision");
  // The figure itself did not move, because no department did.
  assert.equal(after.savings.value, before.savings.value);
  assert.deepEqual([...after.evidence.items], [...before.evidence.items]);
});

test("the same state produces a deep-equal composition every time", () => {
  const analysis = analysisFixture();
  const first = importedFrom(analysis);
  const second = importedFrom(analysis);
  const third = importedFrom(analysisFixture());
  assert.deepEqual(second, first, "composition must be a pure function of the state");
  assert.deepEqual(third, first, "an identical envelope must compose identically");
});

// ---------------------------------------------------------------------------
// Absence: stated, never filled in with the bundled sample.
// ---------------------------------------------------------------------------

test("an import with no cohort states the analysis's own reason and shows no cohort figure", () => {
  // Two gradeable departments is below the declared cohort floor, so the shipped
  // builder refuses — and the card must repeat that refusal, not invent one.
  const analysis = analysisFixture(DEPARTMENTS.slice(0, 2));
  const { guided } = importedFrom(analysis);

  assert.equal(guided.benchmark.available, false);
  assert.equal(guided.benchmark.cohort, null);
  assert.equal(guided.benchmark.answer, IMPORTED_BRIEFING_EMPTY.benchmarkAnswer);
  assert.equal(guided.benchmark.summary, IMPORTED_BRIEFING_EMPTY.benchmarkSummary);
  assert.equal(guided.benchmark.why, analysis.benchmark.message,
    "the sentence under the card is the analysis's own, verbatim");
  assert.equal(guided.benchmark.unavailable.reason, analysis.benchmark.reasonCode,
    "the machine-readable code is the analysis's own, so a consumer branches on one vocabulary");
  assert.ok(!/median/i.test(guided.benchmark.answer + guided.benchmark.summary),
    "a refused cohort must not print a median from anywhere");
});

test("a withheld or implausible import publishes a stated gap, never a sample figure", () => {
  const analysis = analysisFixture();

  const withheld = importedFrom(analysis, { attributionWithheld: true }).guided;
  assert.equal(withheld.savings.available, false);
  assert.equal(withheld.savings.value, "Not shown · attribution below floor");
  assert.equal(withheld.savings.real, false);
  assert.equal(withheld.savings.unavailable.reason, DISCLOSURE_GAP.attributionBelowFloor);
  // Suppressing the amount does not retract the department to act on.
  assert.equal(withheld.savings.action, analysis.action);

  const implausible = importedFrom(analysis, { plausible: false }).guided;
  assert.equal(implausible.savings.value, "Needs review");
  assert.equal(implausible.savings.unavailable.reason, DISCLOSURE_GAP.totalsOutsideRange);
  assert.match(implausible.savings.action, /^Review imported totals/);
});

test("an import with no ranked department refuses the evidence list in words", () => {
  const analysis = { ...analysisFixture(), topDepartment: null, evidence: [] };
  const { guided } = importedFrom(analysis);
  assert.equal(guided.evidence.available, false);
  assert.deepEqual([...guided.evidence.items], []);
  assert.equal(guided.evidence.unavailable.reason, DISCLOSURE_GAP.noRankedDepartment);
  assert.match(guided.evidence.emptyText, /No provider aggregate joined an org unit/);
});

test("bundled synthetic figures are permitted only on the explicit example path", () => {
  const analysis = analysisFixture();
  const imported = guidedDisclosures(importedAnalysisState({
    analysis, source: DISCLOSURE_SOURCE.import, files: ["openai-usage-export.csv"],
  }));
  const example = guidedDisclosures(importedAnalysisState({
    analysis, source: DISCLOSURE_SOURCE.example, files: ["openai-usage-export.csv"],
  }));

  assert.equal(imported.allowsBundledFigures, false);
  assert.equal(example.allowsBundledFigures, true);
  // The example path publishes a genuine computed figure that is still not a
  // fact about the reader's spend, so it is shown and marked unreal.
  assert.equal(example.guided.savings.value, imported.guided.savings.value);
  assert.equal(example.guided.savings.real, false);
  assert.equal(imported.guided.savings.real, true);
  assert.equal(example.provenance.label, "Example dataset");
  assert.deepEqual([...example.provenance.files], [],
    "the example path carries no file of the reader's, whatever a caller passes");
});

test("no analysis composes four stated gaps rather than throwing", () => {
  const composed = guidedDisclosures(importedAnalysisState({ source: DISCLOSURE_SOURCE.import }));
  assert.equal(composed.source, DISCLOSURE_SOURCE.none);
  assert.equal(composed.allowsBundledFigures, false);
  for (const disclosure of Object.values(composed.guided)) {
    assert.equal(disclosure.available, false, `${disclosure.key} must not claim a figure`);
    assert.ok(disclosure.unavailable.reason, `${disclosure.key} must name why it is empty`);
    assert.ok(disclosure.unavailable.statement.length > 0);
  }
  assert.equal(composed.guided.savings.unavailable.reason, DISCLOSURE_GAP.noAnalysis);
  assert.equal(composed.guided.savings.value, "—");
});
