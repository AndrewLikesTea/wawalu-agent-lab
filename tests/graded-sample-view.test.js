// The three graded panels, drawn into the shipped markup of src/evolution.html.
//
// Every assertion is on what a leader can see or what a screen reader is handed:
// the text beside the letter, the coverage line, the provenance, the disclosure's
// own state, and — for state C — that a visitor who imports nothing meets a page
// this module has not touched. Nothing asserts on a class name alone, because a
// class is not a channel a reader has.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { applyGradedSample, clearGradedSample } from "../src/graded-sample-view.js";
import { gradedSampleFigures, querySampleEligibility } from "../src/graded-sample-figures.js";
import { classifyQuerySample, parseQuerySample } from "../src/query-sample-contract.js";
import { RUBRIC_VERSION_ID, scorePromptLiteracy } from "../src/prompt-literacy-scoring.js";
import { exampleDepartmentUnitIds, exampleQuerySampleText } from "../src/query-sample-example.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const UNITS = exampleDepartmentUnitIds();

const byId = (document, id) => document.getElementById(id);
const shown = (document, id) => textOf(byId(document, id));

/** The shipped template through the real validator, classifier and rubric. */
function sample() {
  const classified = classifyQuerySample(parseQuerySample(exampleQuerySampleText()));
  return {
    classified,
    scored: scorePromptLiteracy(classified.records),
    orgUnitIds: classified.records.map((record) => record.orgUnitId),
  };
}

function model(coveredUsd, totalUsd, { files = ["june-sample.csv"] } = {}) {
  const { scored, classified, orgUnitIds } = sample();
  return gradedSampleFigures({
    scored,
    eligibility: querySampleEligibility({
      orgUnitIds,
      departments: [
        { id: UNITS[0], name: "Atlas Platform", spendUsd: coveredUsd },
        { id: "psn_absent_from_the_sample", name: "Cinder Research", spendUsd: totalUsd - coveredUsd },
      ],
      totalUsd,
    }),
    recordCounts: {
      total: classified.records.length + classified.unclassified.length,
      unclassified: classified.unclassified.length,
    },
    files,
    spendUsd: totalUsd,
    recoverableUsd: 120,
    period: "2026-06-01 to 2026-06-30",
  });
}

const openPage = () => loadPage(PAGE);

test("state C · a visitor who imports nothing meets the page unchanged", async () => {
  const { document } = await openPage();
  const before = {
    badge: shown(document, "headline-basis"),
    badgeHidden: byId(document, "headline-basis").hidden,
    kpiRowHidden: byId(document, "kpi-row").hidden,
    mixHidden: byId(document, "spend-mix-panel").hidden,
  };
  assert.equal(before.badgeHidden, false);
  assert.match(before.badge,
    /^◇ Example data — bundled synthetic sample, replaced by your figures only after a local import\.$/);
  assert.equal(byId(document, "graded-sample").hidden, true, "the graded section ships hidden");
  assert.equal(byId(document, "graded-provenance").hidden, true);
  assert.equal(byId(document, "mix-basis").hidden, true);

  // Whatever the page does with a sample it never received, the example surface
  // is byte-for-byte what it was.
  applyGradedSample(document, gradedSampleFigures());
  assert.deepEqual({
    badge: shown(document, "headline-basis"),
    badgeHidden: byId(document, "headline-basis").hidden,
    kpiRowHidden: byId(document, "kpi-row").hidden,
    mixHidden: byId(document, "spend-mix-panel").hidden,
  }, before);
  assert.equal(byId(document, "graded-sample").hidden, true);
});

test("state A · the KPI row, the mix and the cohort carry the reader's own figures", async () => {
  const { document } = await openPage();
  const painted = applyGradedSample(document, model(900, 1000));

  assert.equal(byId(document, "graded-sample").hidden, false);
  assert.equal(byId(document, "kpi-row").hidden, false);
  assert.equal(byId(document, "spend-mix-panel").hidden, false);

  assert.equal(shown(document, "kpi-spend-value"), "$1,000");
  assert.match(shown(document, "kpi-spend-note"), /2026-06-01 to 2026-06-30/);
  assert.equal(shown(document, "kpi-recoverable-value"), "$120");
  assert.equal(shown(document, "kpi-productive-value"),
    painted.kpis.find((kpi) => kpi.key === "productive").value);
  assert.equal(shown(document, "kpi-peer-value"), "Unavailable");

  // The mix bar is redrawn from the sample, and says what it is a share of.
  assert.equal(byId(document, "mix-bar").children.length, 4);
  assert.equal(byId(document, "mix-legend").children.length, 4);
  assert.match(shown(document, "mix-basis"), /query mix, not a spend mix/);
  assert.match(shown(document, "mix-summary"), /^Your scored query mix:/);

  // The cohort statement is present and honest rather than absent.
  assert.match(textOf(byId(document, "graded-sample-body")), /No peer cohort in your import\./);
});

test("state A · the provenance line replaces the example badge and names both", async () => {
  const { document } = await openPage();
  applyGradedSample(document, model(900, 1000, { files: ["june-sample.csv", "july-sample.csv"] }));

  const provenance = byId(document, "graded-provenance");
  assert.equal(provenance.hidden, false);
  assert.equal(byId(document, "headline-basis").hidden, true,
    "the example badge and a provenance line must not both be on the row");
  const text = textOf(provenance);
  assert.match(text, /june-sample\.csv/);
  assert.match(text, /july-sample\.csv/);
  assert.match(text, new RegExp(RUBRIC_VERSION_ID.replace(/[.]/g, "\\.")),
    "the rubric version travels with the figures");
});

test("state A · provisional and confident differ without colour, in text a reader is given", async () => {
  const confident = (await openPage()).document;
  applyGradedSample(confident, model(900, 1000));
  const provisional = (await openPage()).document;
  applyGradedSample(provisional, model(300, 1000));

  const line = (document) => textOf(document.querySelector(".graded-grade-line"));
  assert.match(line(confident), /· Confident grade$/);
  assert.match(line(provisional), /· Provisional grade$/);
  assert.notEqual(line(confident), line(provisional));

  // The distinction is on the figure as an attribute too, so the hatch and the
  // dashed outline have something to hang off that is not a colour.
  assert.equal(confident.querySelector(".graded-letter").dataset.gradeStatus, "confident");
  assert.equal(provisional.querySelector(".graded-letter").dataset.gradeStatus, "provisional");
  assert.equal(byId(provisional, "graded-sample").dataset.gradeStatus, "provisional");

  // The big letter is decorative; the word beside it is what is announced.
  assert.equal(provisional.querySelector(".graded-letter").getAttribute("aria-hidden"), "true");
  assert.match(shown(provisional, "graded-sample-live"), /Provisional grade/);

  // Coverage and confidence are on the first screen, not behind the disclosure.
  assert.match(textOf(provisional.querySelector(".graded-coverage")), /30\.0% of imported spend scored/);
  assert.match(textOf(provisional.querySelector(".graded-coverage")), /provisional grade/);
});

test("state B · the honest message and one next action, and no grade figure at all", async () => {
  const { document } = await openPage();
  applyGradedSample(document, model(100, 1000));

  const body = byId(document, "graded-sample-body");
  assert.equal(byId(document, "graded-sample").hidden, false);
  assert.match(textOf(body), /Needs review · insufficient coverage/);
  assert.match(textOf(body), /Widen the sample for Cinder Research/);

  // No letter, no score slot, no dash standing in for one, and no half-drawn
  // mix or cohort chart.
  assert.equal(document.querySelector(".graded-letter"), null);
  assert.equal(document.querySelector(".graded-grade-line"), null);
  assert.equal(document.querySelector(".graded-coverage"), null);
  // The two panels stay mounted. This module publishes no figure into them —
  // the mix bar is still empty — but taking them off the page is not its call:
  // `finops-panel-contract.js` decides what a leader may read and writes the
  // sentence naming the input that would fill it. A panel that vanished is a
  // question a leader can no longer see, let alone answer.
  assert.equal(byId(document, "kpi-row").hidden, false);
  assert.equal(byId(document, "spend-mix-panel").hidden, false);
  assert.equal(byId(document, "mix-bar").children.length, 0);
});

test("clearing hands every slot back to the example surface", async () => {
  const { document } = await openPage();
  applyGradedSample(document, model(900, 1000));
  clearGradedSample(document);

  assert.equal(byId(document, "graded-sample").hidden, true);
  assert.equal(textOf(byId(document, "graded-sample-body")), "");
  assert.equal(byId(document, "graded-provenance").hidden, true);
  assert.equal(byId(document, "mix-basis").hidden, true);
  assert.equal(byId(document, "headline-basis").hidden, false);
  assert.match(shown(document, "headline-basis"),
    /^◇ Example data — bundled synthetic sample, replaced by your figures only after a local import\.$/);
});

test("the disclosure reveals the subscores and the unclassified count, from the keyboard", async () => {
  const { document } = await openPage();
  const painted = applyGradedSample(document, model(900, 1000));

  const toggle = byId(document, "graded-subscores-toggle");
  const panel = byId(document, "graded-subscores-panel");
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "it starts closed");
  assert.equal(toggle.getAttribute("aria-controls"), "graded-subscores-panel");
  assert.equal(panel.hidden, true);
  assert.equal(textOf(panel), "", "nothing is disclosed until it is opened");

  // Reachable by Tab, with no mouse and no trap.
  const stops = tabSequence(document).length;
  let focused = null;
  for (let step = 0; step <= stops && focused?.id !== "graded-subscores-toggle"; step += 1) {
    focused = pressTab(document);
  }
  assert.equal(focused?.id, "graded-subscores-toggle",
    "a keyboard user must be able to reach the disclosure trigger");

  pressEnter(document);
  const opened = byId(document, "graded-subscores-toggle");
  assert.equal(opened.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement?.id, "graded-subscores-toggle",
    "focus stays on the trigger across the repaint, so the keyboard is never stranded");

  const openPanel = byId(document, "graded-subscores-panel");
  assert.equal(openPanel.hidden, false);
  assert.equal(openPanel.getAttribute("role"), "region");
  const disclosed = textOf(openPanel);
  for (const axis of painted.disclosure.axes) assert.match(disclosed, new RegExp(axis.label));
  for (const row of painted.disclosure.categories) assert.match(disclosed, new RegExp(row.label));
  assert.match(disclosed, /carried no rubric category and were not scored\./);
  assert.match(disclosed, new RegExp(`${painted.disclosure.unclassified} of `));

  pressEnter(document);
  assert.equal(byId(document, "graded-subscores-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(byId(document, "graded-subscores-panel").hidden, true);
});

test("a file name made of markup is a string on the page, never a node", async () => {
  const { document } = await openPage();
  // The page's own module scripts, counted before the injection: the claim is
  // that the hostile string produced no script node, not that the page ships a
  // particular number of them.
  const shipped = document.querySelectorAll("script").length;
  const hostile = '<img src=x onerror="alert(1)">&<script>alert(2)</script>.csv';
  applyGradedSample(document, model(900, 1000, { files: [hostile] }));

  const provenance = byId(document, "graded-provenance");
  assert.match(textOf(provenance), /<img src=x onerror="alert\(1\)">&<script>alert\(2\)<\/script>\.csv/,
    "the name is rendered exactly as it was typed");
  // Nothing was parsed out of it: the label is one text-carrying element, and no
  // element of the injected kind exists anywhere on the page.
  const label = provenance.querySelector(".provenance-label");
  assert.deepEqual(label.children.map((child) => child.tagName), ["#text"],
    "the name produced one text node and no element");
  assert.equal(label.textContent.includes(hostile), true);
  assert.equal(document.querySelectorAll("script").length, shipped,
    "only the page's own module scripts exist");
  assert.equal(document.querySelectorAll("img").length, 0);
});
