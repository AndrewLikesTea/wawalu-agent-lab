// The view model behind the three graded panels.
//
// Every input here is produced by the module that owns it — the real query
// sample validator, the real classifier, the real rubric — so a change to any
// of them surfaces as a failure here rather than as a quietly wrong number on
// the page. Nothing in this file re-implements a score, a tier, or a threshold.

import test from "node:test";
import assert from "node:assert/strict";

import {
  GRADED_SAMPLE_FIGURES_VERSION, NOT_SCORED_MESSAGE,
  gradedSampleFigures, querySampleEligibility,
} from "../src/graded-sample-figures.js";
import { classifyQuerySample, parseQuerySample } from "../src/query-sample-contract.js";
import { scorePromptLiteracy } from "../src/prompt-literacy-scoring.js";
import { exampleDepartmentUnitIds, exampleQuerySampleText } from "../src/query-sample-example.js";

const UNITS = exampleDepartmentUnitIds();

/** The shipped template, read by the real validator and the real rubric. */
function gradedSample() {
  const parsed = parseQuerySample(exampleQuerySampleText());
  assert.equal(parsed.ok, true, "the shipped template must still validate");
  const classified = classifyQuerySample(parsed);
  return {
    classified,
    scored: scorePromptLiteracy(classified.records),
    orgUnitIds: classified.records.map((record) => record.orgUnitId),
  };
}

/** Departments whose covered spend is `coveredUsd` out of `totalUsd`. */
function departments(coveredUsd, totalUsd) {
  return [
    { id: UNITS[0], name: "Atlas Platform", spendUsd: coveredUsd },
    { id: "psn_not_in_the_sample_at_all", name: "Cinder Research", spendUsd: totalUsd - coveredUsd },
  ];
}

function figuresFor(coveredUsd, totalUsd, extra = {}) {
  const { scored, classified, orgUnitIds } = gradedSample();
  return gradedSampleFigures({
    scored,
    eligibility: querySampleEligibility({ orgUnitIds, departments: departments(coveredUsd, totalUsd), totalUsd }),
    recordCounts: {
      total: classified.records.length + classified.unclassified.length,
      unclassified: classified.unclassified.length,
    },
    files: ["example-query-sample.csv"],
    spendUsd: totalUsd,
    recoverableUsd: Math.round(totalUsd / 10),
    period: "2026-06-01 to 2026-06-30",
    ...extra,
  });
}

test("no sample at all leaves the page in its example state", () => {
  assert.deepEqual(gradedSampleFigures(), {
    state: "example", version: GRADED_SAMPLE_FIGURES_VERSION,
  });
  assert.equal(gradedSampleFigures({ scored: scorePromptLiteracy([]) }).state, "example",
    "a score without an eligibility verdict is not a state this surface can publish");
});

test("high coverage publishes the reader's own grade, confidently", () => {
  const model = figuresFor(900, 1000);
  assert.equal(model.state, "graded");
  assert.equal(model.provisional, false);
  assert.equal(model.statusWord, "Confident grade");
  assert.equal(model.coverage.tier, "high");
  assert.equal(model.coverage.text, "90.0% of imported spend scored");
  // The figures are the reader's own, not the bundled sample's.
  assert.equal(model.kpis.find((kpi) => kpi.key === "spend").value, "$1,000");
  assert.equal(model.grade, scorePromptLiteracy(
    classifyQuerySample(parseQuerySample(exampleQuerySampleText())).records).grade);
  assert.match(model.gradeLine, /^Grade [A-F] · \d+ \/ 100 · Confident grade$/);
});

test("provisional coverage is carried as a word, not as a tint", () => {
  const model = figuresFor(300, 1000);
  assert.equal(model.state, "graded");
  assert.equal(model.provisional, true);
  assert.equal(model.coverage.tier, "provisional");
  assert.equal(model.statusWord, "Provisional grade");
  assert.match(model.gradeLine, /Provisional grade$/);
  // Noor's own sentence, unchanged, is what qualifies the letter.
  assert.match(model.coverage.rule, /not actionable alone/);
});

test("insufficient coverage publishes no figure of any kind", () => {
  const model = figuresFor(100, 1000);
  assert.equal(model.state, "not_gradeable");
  assert.equal(model.showGrade, false);
  for (const key of ["grade", "score", "kpis", "mix", "coverage"]) {
    assert.equal(model[key], undefined, `${key} must not exist when the sample is not gradeable`);
  }
  assert.equal(model.message.label, "Needs review · insufficient coverage");
  assert.match(model.nextAction.text, /^Widen the sample for Cinder Research/);
});

test("a sample with no spend beside it has no denominator, and says so", () => {
  const model = figuresFor(0, 0, { spendUsd: null, recoverableUsd: null });
  assert.equal(model.state, "not_gradeable");
  assert.equal(model.message.label, "Needs review · no spend baseline");
  assert.equal(model.nextAction.text,
    "Import billing data. Coverage has no denominator until a spend total exists.");
  assert.equal(model.message.unscored, null, "the rubric did score records; only coverage is missing");
});

test("a sample the rubric could score nothing in is not a score of zero", () => {
  const model = gradedSampleFigures({
    scored: scorePromptLiteracy([]),
    eligibility: querySampleEligibility({
      orgUnitIds: [], departments: departments(900, 1000), totalUsd: 1000,
    }),
    files: ["empty.csv"],
  });
  assert.equal(model.state, "not_gradeable");
  assert.equal(model.message.unscored, NOT_SCORED_MESSAGE);
  assert.match(model.message.unscored, /Zero scorable records is not a score of zero\./);
});

test("the provenance names every imported file and the rubric version", () => {
  const model = figuresFor(900, 1000, { files: ["june.csv", "july.csv"] });
  assert.deepEqual(model.provenance.files, ["june.csv", "july.csv"]);
  assert.equal(model.provenance.label, "Your data — june.csv, july.csv");
  assert.match(model.provenance.detail,
    new RegExp(`Graded in this tab against ${model.provenance.rubricVersion.replace("/", "\\/")}\\.`));
  assert.match(model.provenance.rubricVersion, /\/\d+\.\d+\.\d+$/);
});

test("the unclassified rows the classifier set aside are counted, not lost", () => {
  const { classified } = gradedSample();
  assert.ok(classified.unclassified.length > 0,
    "the shipped template exercises the excerpt path, so some rows are unclassified");
  const model = figuresFor(900, 1000);
  assert.equal(model.disclosure.unclassified, classified.unclassified.length);
  assert.equal(model.disclosure.totalRecords,
    classified.records.length + classified.unclassified.length);
  assert.match(model.disclosure.unclassifiedText, /carried no rubric category and were not scored\.$/);
  assert.deepEqual(model.disclosure.axes.map((axis) => axis.key),
    ["intent", "efficiency", "modelFit"]);
});

test("the mix is a share of scored queries and refuses to be read as dollars", () => {
  const model = figuresFor(900, 1000);
  const total = model.mix.segments.reduce((sum, segment) => sum + segment.share, 0);
  assert.ok(Math.abs(total - 1) < 0.0005, `the four shares must cover the sample, got ${total}`);
  assert.match(model.mix.basis, /query mix, not a spend mix/);
  assert.match(model.mix.summary, /^Your scored query mix: /);
  assert.match(model.kpis.find((kpi) => kpi.key === "productive").note,
    /share of queries, not of spend$/);
});

test("the cohort statement is the imported envelope's own, and stays unavailable", () => {
  const quoted = figuresFor(900, 1000, {
    cohort: { eligible: false, reasonCode: "no_compatible_cohort", message: "Unavailable: nothing to compare." },
  });
  assert.equal(quoted.cohort.available, false);
  assert.equal(quoted.cohort.reason, "Unavailable: nothing to compare.");
  assert.equal(quoted.kpis.find((kpi) => kpi.key === "peer").value, "Unavailable");
  const unquoted = figuresFor(900, 1000);
  assert.match(unquoted.cohort.reason, /^Unavailable: a query sample carries no peer cohort/);
});
