// Per-panel provenance on the AI FinOps headline surface.
//
// Every assertion here is on what a leader can see or what a screen reader is
// handed: the words in a panel's badge, the sentence that replaces it, the one
// question and one action the headline answers with, and — the acceptance
// criterion this whole surface exists to hold — that no string out of the
// reader's own file reaches the page.
//
// The fixtures are built here rather than committed: each one is a handful of
// rows through the real validator and the real classifier, so a tightened
// contract fails these tests with everything else.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import {
  FINOPS_IMPORT_STATUS, SAMPLE_LABEL, finopsProvenanceModel, promptImportFacts,
} from "../src/finops-provenance-model.js";
import { applyFinopsProvenance, clearFinopsProvenance } from "../src/finops-provenance-view.js";
import {
  CLASSIFICATION_FIELDS, REQUIRED_QUERY_SAMPLE_FIELDS,
  classifyQuerySample, parseQuerySample,
} from "../src/query-sample-contract.js";
import {
  promptGradingEligibility, promptGradingSignals,
} from "../src/prompt-grading-eligibility.js";
import { scorePromptLiteracy } from "../src/prompt-literacy-scoring.js";
import { exampleDepartmentUnitIds } from "../src/query-sample-example.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const UNITS = exampleDepartmentUnitIds();
const CONTRACT_FIELDS = [...REQUIRED_QUERY_SAMPLE_FIELDS, ...CLASSIFICATION_FIELDS];

/**
 * The one string that must never reach the DOM. It is written into the
 * `prompt_excerpt` column of every unclassified row below, which is exactly
 * where a real prompt would sit.
 */
const SENTINEL = "SENTINEL-PROMPT-refactor-the-billing-reconciler-before-the-audit";

const HEADER = "org_unit_id,query_date,model,input_tokens,output_tokens,prompt_excerpt,category";
const FILE_NAME = "june-prompts.csv";

const day = (index) => `2026-06-${String(index + 1).padStart(2, "0")}`;

/**
 * @param spec `[{ unit, count, category, excerpt, startDay, spanDays }]`
 * @returns the file as bytes, in the delimited dialect the contract accepts.
 */
function sampleText(spec) {
  const lines = [HEADER];
  for (const group of spec) {
    for (let index = 0; index < group.count; index += 1) {
      const offset = group.startDay + (index % (group.spanDays ?? 1));
      lines.push([
        UNITS[group.unit], day(offset), "acme-sonnet-1", "1200", "800",
        group.excerpt ? SENTINEL : "", group.category ?? "",
      ].join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The page's own pipeline: parse, classify, and pair the two. */
function importOf(spec, fileName = FILE_NAME) {
  const parsed = parseQuerySample(sampleText(spec));
  assert.equal(parsed.ok, true, "the fixture must go through the real validator");
  return [{ fileName, parsed, classified: classifyQuerySample(parsed) }];
}

/** What the page hands the rule, so its `own_grade` action can name a team. */
function departmentScores(entries) {
  const byUnit = new Map();
  for (const entry of entries) {
    for (const record of entry.classified.records) {
      if (!record.orgUnitId) continue;
      const bucket = byUnit.get(record.orgUnitId) ?? [];
      bucket.push(record);
      byUnit.set(record.orgUnitId, bucket);
    }
  }
  return Object.fromEntries([...byUnit].map(([unit, records]) =>
    [unit, scorePromptLiteracy(records).composite]));
}

function verdictFor(entries) {
  return promptGradingEligibility(promptGradingSignals(entries),
    { departmentScores: departmentScores(entries) });
}

function modelFor(entries, extra = {}) {
  const promptGrading = verdictFor(entries);
  return finopsProvenanceModel({
    promptGrading,
    promptFacts: promptImportFacts(entries, CONTRACT_FIELDS),
    coaching: promptGrading.nextAction?.kind === "coach_department"
      && promptGrading.nextAction.department
      ? { department: promptGrading.nextAction.department } : null,
    ...extra,
  });
}

// Two departments, thirty classified prompts each, spanning three full weeks:
// every one of Noor's floors clears, so the headline is the reader's.
const OWN_GRADE = () => importOf([
  { unit: 0, count: 30, category: "highValue", startDay: 0, spanDays: 21 },
  { unit: 1, count: 30, category: "inefficient", startDay: 0, spanDays: 21 },
]);

// One graded department and thirty rows the classifier could not place: the
// classified share falls under its floor, which is the gap the copy must name.
const PARTIAL_SHARE = () => importOf([
  { unit: 0, count: 30, category: "highValue", startDay: 0, spanDays: 21 },
  { unit: 0, count: 30, excerpt: true, startDay: 0, spanDays: 21 },
]);

// One graded department and one under the per-department floor: the gap is a
// named team, not a share.
const PARTIAL_DEPARTMENT = () => importOf([
  { unit: 0, count: 30, category: "highValue", startDay: 0, spanDays: 21 },
  { unit: 1, count: 10, category: "inefficient", startDay: 0, spanDays: 21 },
]);

// Five prompts in one department: an import exists and nothing in it is
// gradeable, so the page is still the sample's.
const SAMPLE_ONLY = () => importOf([
  { unit: 0, count: 5, category: "highValue", startDay: 0, spanDays: 5 },
]);

const byId = (document, id) => document.getElementById(id);
const shown = (document, id) => textOf(byId(document, id));
const basisOf = (document, id) => (byId(document, id).hidden ? null : shown(document, id));

/** The four panels, as a reader meets them: badge or provenance, per panel. */
function panelLabels(document) {
  return {
    headline: basisOf(document, "finops-headline-basis")
      ?? shown(document, "finops-headline-provenance"),
    kpis: basisOf(document, "headline-basis") ?? shown(document, "graded-provenance"),
    cohort: basisOf(document, "cohort-comparison-basis")
      ?? shown(document, "cohort-comparison-provenance"),
    coaching: basisOf(document, "coaching-card-basis")
      ?? shown(document, "coaching-card-provenance"),
  };
}

const sampleLine = `◇ ${SAMPLE_LABEL}`;

test("the authored markup is the model's sample state, so the surface cannot drift", async () => {
  const { document } = await loadPage(PAGE);
  const model = finopsProvenanceModel();
  assert.equal(shown(document, "finops-headline-question"), model.headline.question);
  assert.equal(shown(document, "finops-headline-metric-label"), model.headline.metric.label);
  assert.equal(shown(document, "finops-headline-metric-value"), model.headline.metric.value);
  assert.equal(shown(document, "finops-headline-action"), model.headline.action.text);
  assert.equal(shown(document, "cohort-comparison-answer"), model.cohortAnswer);
  assert.equal(shown(document, "coaching-card-answer"), model.coachingAnswer);
  // All four panels ship the example badge, verbatim and identically.
  assert.deepEqual(panelLabels(document), {
    headline: sampleLine, kpis: sampleLine, cohort: sampleLine, coaching: sampleLine,
  });
});

test("no imported prompt string reaches the page, or the model handed to it", async () => {
  const entries = PARTIAL_SHARE();
  // The sentinel is really in the file, so a passing assertion below means it
  // was stripped rather than never present.
  assert.match(entries[0].parsed.records.map((record) => record.promptExcerpt).join(" "),
    new RegExp(SENTINEL));

  const model = modelFor(entries);
  // The boundary: the object the render layer is handed carries no prompt text
  // at all, so there is nothing for it to leak even by accident.
  assert.doesNotMatch(JSON.stringify(model), new RegExp(SENTINEL));

  const { document } = await loadPage(PAGE);
  applyFinopsProvenance(document, model);
  assert.doesNotMatch(document.body.textContent, new RegExp(SENTINEL),
    "no imported prompt string appears anywhere in the rendered page");
});

test("panels resolve their source one by one, and a mixed surface renders correctly", async () => {
  const { document } = await loadPage(PAGE);
  const model = applyFinopsProvenance(document, modelFor(OWN_GRADE(), {
    usage: { fileName: "june-usage.csv", rows: 412 },
  }));

  const labels = panelLabels(document);
  // The reader's prompts feed the grade and the coaching card; their usage
  // export feeds the KPI row; there is no cohort of theirs, so that panel keeps
  // the badge unchanged. All four states, on one screen, at once.
  // The shape, the words and the count run together here only because this
  // harness has no CSS: they are three adjacent spans with a gap between them.
  assert.match(labels.headline, /^▣Your data — june-prompts\.csv60 classified prompts from this file fed this panel\./);
  assert.match(labels.kpis, /^▣Your data — june-usage\.csv412 rows from this file fed this panel\./);
  assert.equal(labels.cohort, sampleLine, "no user cohort exists, so the badge stays verbatim");
  assert.match(labels.coaching, /^▣Your data — june-prompts\.csv/);

  // One panel's provenance never leaks into another's: the KPI row counts rows,
  // the grade counts classified prompts, and neither borrows the other's number.
  assert.doesNotMatch(labels.kpis, /classified prompt/);
  assert.doesNotMatch(labels.headline, /412/);
  assert.equal(model.panels.cohort.reason, "no_user_cohort");

  // Each line is programmatically part of its own panel, not a stray paragraph.
  assert.equal(byId(document, "kpi-row").getAttribute("aria-describedby"), "graded-provenance");
  assert.equal(byId(document, "cohort-comparison").getAttribute("aria-describedby"),
    "cohort-comparison-basis");
  assert.equal(byId(document, "finops-headline").getAttribute("aria-describedby"),
    "finops-headline-provenance");
  // The distinction is carried by words and a shape, never by colour alone.
  assert.match(labels.cohort, /◇ Example data/);
  assert.match(labels.headline, /▣Your data/);
});

test("a grade too thin to be the reader's leaves every panel on the sample", async () => {
  const { document } = await loadPage(PAGE);
  const model = applyFinopsProvenance(document, modelFor(SAMPLE_ONLY()));
  assert.equal(model.state, "sample_only");
  assert.deepEqual(panelLabels(document), {
    headline: sampleLine, kpis: sampleLine, cohort: sampleLine, coaching: sampleLine,
  });
  // An import that exists and falls short is a different sentence from no
  // import at all, and the panel says which one it is.
  assert.equal(model.panels.headline.reason, "import_below_grading_floor");
});

test("each eligibility state answers one question with one metric and one action", async () => {
  const { document } = await loadPage(PAGE);
  const section = byId(document, "finops-headline");
  const states = [
    { entries: SAMPLE_ONLY(), state: "sample_only", question: "Is this grade yours?" },
    { entries: PARTIAL_SHARE(), state: "partial", question: "Which part of this grade is yours?" },
    { entries: OWN_GRADE(), state: "own_grade", question: "Which team needs coaching first?" },
  ];
  for (const expected of states) {
    const model = applyFinopsProvenance(document, modelFor(expected.entries));
    assert.equal(model.state, expected.state);
    assert.equal(shown(document, "finops-headline-question"), expected.question);
    assert.equal(section.querySelectorAll('[data-role="metric"]').length, 1,
      `${expected.state} renders exactly one material metric`);
    assert.equal(section.querySelectorAll('[data-role="action"]').length, 1,
      `${expected.state} renders exactly one prioritized next action`);
    assert.notEqual(shown(document, "finops-headline-action"), "");
    // The question is the heading, so a reader listing headings meets it.
    assert.equal(byId(document, "finops-headline-question").tagName, "H2");
  }
});

test("the partial state names the column and the file that would close the gap", async () => {
  const { document } = await loadPage(PAGE);

  applyFinopsProvenance(document, modelFor(PARTIAL_SHARE()));
  const share = shown(document, "finops-headline-action");
  assert.match(share, /category column in june-prompts\.csv/,
    "the specific column, from the fixture's own header");
  assert.match(share, /6 more prompts must classify/, "the size of the gap, not 'incomplete data'");
  assert.doesNotMatch(share, /incomplete data/i);

  applyFinopsProvenance(document, modelFor(PARTIAL_DEPARTMENT()));
  const department = shown(document, "finops-headline-action");
  assert.match(department, new RegExp(`Add 15 more ${UNITS[1]} prompts to june-prompts\\.csv`),
    "the specific department that is missing, named from the import result");
  assert.match(department, /org_unit_id column carries 10 of the 25/);
});

test("the way back to the sample is labelled, keyboard operable, and total", async () => {
  const { document } = await loadPage(PAGE);
  const control = byId(document, "finops-return-to-sample");
  assert.equal(control.hidden, true, "nothing to return from before an import");

  let returned = 0;
  applyFinopsProvenance(document, modelFor(OWN_GRADE(), {
    usage: { fileName: "june-usage.csv", rows: 412 },
  }), { onReturnToSample: () => { returned += 1; } });
  assert.equal(control.hidden, false);
  // The accessible name says what pressing it does, without a title or an icon.
  assert.equal(textOf(control), "Show the bundled example data in all four panels");
  assert.ok(tabSequence(document).includes(control), "the control is in the tab sequence");

  control.focus();
  assert.equal(document.activeElement, control);
  pressEnter(document);
  assert.equal(returned, 1, "the page's own reset is asked to run");

  // All four panels, together, back to the badge the page ships.
  assert.deepEqual(panelLabels(document), {
    headline: sampleLine, kpis: sampleLine, cohort: sampleLine, coaching: sampleLine,
  });
  assert.equal(shown(document, "finops-headline-question"), "Is this grade yours?");
  // Focus is not dropped on a control that just disappeared.
  assert.equal(control.hidden, true);
  assert.equal(document.activeElement, byId(document, "finops-headline-question"));
  assert.match(shown(document, "finops-headline-live"), /bundled example data/);
});

test("the control is reachable by Tab alone from the surface it belongs to", async () => {
  const { document } = await loadPage(PAGE);
  applyFinopsProvenance(document, modelFor(OWN_GRADE()));
  const control = byId(document, "finops-return-to-sample");
  const sequence = tabSequence(document);
  document.activeElement?.blur?.();
  sequence[sequence.indexOf(control) - 1].focus();
  assert.equal(pressTab(document), control);
});

test("a file being read, and a file that failed, never leave a half-swapped surface", async () => {
  const { document } = await loadPage(PAGE);
  const entries = OWN_GRADE();
  applyFinopsProvenance(document, modelFor(entries, {
    usage: { fileName: "june-usage.csv", rows: 412 },
  }));
  assert.match(panelLabels(document).kpis, /Your data/);

  for (const status of [FINOPS_IMPORT_STATUS.pending, FINOPS_IMPORT_STATUS.failed]) {
    const model = applyFinopsProvenance(document, finopsProvenanceModel({
      status,
      promptGrading: verdictFor(entries),
      promptFacts: promptImportFacts(entries, CONTRACT_FIELDS),
      usage: { fileName: "june-usage.csv", rows: 412 },
    }));
    assert.deepEqual(panelLabels(document), {
      headline: sampleLine, kpis: sampleLine, cohort: sampleLine, coaching: sampleLine,
    }, `${status} shows four sample panels rather than a mix of fresh and stale`);
    // Not a blank headline: the question, the metric and the action are still
    // answered, and the reserved status line carries what happened.
    assert.equal(shown(document, "finops-headline-question"), "Is this grade yours?");
    assert.notEqual(shown(document, "finops-headline-status"), "");
    assert.equal(model.status, status);
  }
  assert.match(shown(document, "finops-headline-status"), /was not analyzed/);
  assert.match(shown(document, "finops-headline-live"), /was not analyzed/);
});

test("clearing is the same state a reload produces, and announces the swap", async () => {
  const { document } = await loadPage(PAGE);
  applyFinopsProvenance(document, modelFor(OWN_GRADE()));
  assert.match(shown(document, "finops-headline-live"), /Your import now feeds/);
  clearFinopsProvenance(document);
  assert.deepEqual(panelLabels(document), {
    headline: sampleLine, kpis: sampleLine, cohort: sampleLine, coaching: sampleLine,
  });
  const fresh = await loadPage(PAGE);
  assert.deepEqual(panelLabels(document), panelLabels(fresh.document));
});
