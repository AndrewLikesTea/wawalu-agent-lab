// Where the one number came from — the record, its redaction, and the
// disclosure on /evolution.html that renders it.
//
// THE ACCEPTANCE CRITERION IS THAT THE RECORD IS COMPUTED, NOT WRITTEN. The
// first test below runs the real builder over one department set and then over
// the same set with one more row and a different injected clock, and requires
// BOTH the sample count and the computed-at to move — and requires the count to
// equal the number of rows actually consumed, not merely to differ from the
// previous one. A record assembled from literals at the figure's definition site
// passes neither half.
//
// Every fixture here is built in this file. Nothing is checked in, and nothing
// is compared against a percentage copied out of a fixture.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, pressEnter, textOf } from "./support/browser.js";
import { answerBlock } from "../src/finops-screen-contract.js";
import { gradeExport } from "../src/export-gradability.js";
import {
  AGGREGATION, FIGURE_PROVENANCE_VERSION, figureProvenance, inputTap, symbolicInputs,
} from "../src/finops-figure-provenance.js";
import {
  ANSWER_BLOCK_IDS, ANSWER_PROVENANCE_KEY, ANSWER_PROVENANCE_LABEL, applyAnswerBlock,
  applyAnswerProvenance, standDisclosureIds,
} from "../src/finops-stand-view.js";
import { FINOPS_ANSWER_SUMMARY } from "../src/finops-answer-summary.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const byId = (document, id) => document.getElementById(id);

/** A department the rubric can score, with the fields `departmentPerformance` reads. */
const scored = (id, spendUsd) => ({
  id, name: id, spendUsd, records: 10,
  sampling: { status: "available", sampledQueries: 40 },
  mix: { highValue: 0.6, routine: 0.4 },
});

/** A department it cannot, carrying its own published reason. */
const unscored = (id, spendUsd) => ({
  id, name: id, spendUsd, records: 10,
  sampling: { status: "unavailable", sampledQueries: 0, reason: "No queries were sampled." },
});

/** The block for one department set, through the real gradability verdict. */
function blockFor(rankedDepartments, at) {
  const analysis = { period: "2026-05-01 to 2026-06-01", rankedDepartments };
  return answerBlock(
    { label: "Imported", period: "May 2026", gradability: gradeExport({ analysis, source: "import" }) },
    { now: () => new Date(at) });
}

// ---------------------------------------------------------------------------
// 1. Computed, not written.
// ---------------------------------------------------------------------------

test("the sample count is the rows consumed, and it moves when the rows do", () => {
  // Under the coverage bar, so the action ranks a real residue and its record
  // has a sample of its own to report.
  const first = [scored("Platform", 10_000), unscored("Support", 90_000)];
  const second = [...first, unscored("Design", 5_000)];

  const before = blockFor(first, "2026-05-02T08:00:00.000Z");
  const after = blockFor(second, "2026-06-03T17:45:00.000Z");

  const beforeMetric = before.provenance.headlineMetric;
  const afterMetric = after.provenance.headlineMetric;

  // The count IS the number of records consumed, not just a number that differs.
  assert.equal(beforeMetric.samples.count, first.length,
    "the headline metric's sample count is not the number of department rows it read");
  assert.equal(afterMetric.samples.count, second.length);
  assert.equal(afterMetric.samples.count, beforeMetric.samples.count + 1);
  assert.equal(beforeMetric.samples.unit, "department row");

  // …and the clock is the injected one, to the millisecond, in both runs.
  assert.equal(beforeMetric.computedAt, "2026-05-02T08:00:00.000Z");
  assert.equal(afterMetric.computedAt, "2026-06-03T17:45:00.000Z");
  assert.notEqual(afterMetric.computedAt, beforeMetric.computedAt);

  // The action's own record moved with its own sample: one more unscored row.
  assert.equal(before.provenance.nextAction.samples.count, 1);
  assert.equal(after.provenance.nextAction.samples.count, 2);
  assert.equal(after.provenance.nextAction.samples.unit, "unscored department row");
});

test("each figure's inputs are the operands its own code read, and the method names the rule", () => {
  const block = blockFor([scored("Platform", 10_000), unscored("Support", 90_000)],
    "2026-05-02T08:00:00.000Z");
  const metric = block.provenance.headlineMetric;

  // The ratio's own operands, by name. Nothing here is a value.
  for (const key of ["coverage", "coveredUsd", "totalUsd", "provenance.rows"]) {
    assert.ok(metric.inputs.includes(key),
      `the headline metric's record does not name ${key}: ${metric.inputs.join(", ")}`);
  }
  assert.equal(metric.figure, "headlineMetric");
  assert.equal(metric.version, FIGURE_PROVENANCE_VERSION);
  assert.equal(metric.method.aggregation, AGGREGATION.ratioOfSums);
  // The rule half is the computing module's OWN published version, read off the
  // verdict — so bumping export-gradability.js moves this label with no edit at
  // the figure's definition site.
  assert.equal(metric.method.rule, gradeExport({ analysis: null }).version);
  assert.ok(metric.method.label.includes(metric.method.rule));

  // The action ranked a residue, so its record names the ranking's operands and
  // NOT the ratio's — two figures, two records, no shared bag.
  const action = block.provenance.nextAction;
  assert.ok(action.inputs.includes("action.cluster"), action.inputs.join(", "));
  assert.ok(!action.inputs.includes("coveredUsd"),
    "the action's record claims an operand only the ratio read");
  assert.equal(action.method.aggregation, AGGREGATION.largestGroup);
});

test("a figure that read nothing reports nothing, rather than seven empty operands", () => {
  const empty = answerBlock({ label: "Imported", period: null },
    { now: () => new Date("2026-05-02T08:00:00.000Z") });
  assert.deepEqual(empty.provenance.headlineMetric.inputs, []);
  assert.equal(empty.provenance.headlineMetric.samples.count, 0);
  assert.equal(empty.provenance.headlineMetric.empty, true);
  assert.equal(empty.provenance.nextAction.empty, true);
});

test("the clock is an argument, and the default is the real one", () => {
  const before = Date.now();
  const block = blockFor([scored("Platform", 90_000)], "ignored");
  assert.ok(block, "the fixture builder must still produce a block");
  // The default path: no `now` supplied at all.
  const live = answerBlock({ label: "Imported", period: "May 2026",
    gradability: gradeExport({ analysis: { rankedDepartments: [scored("Platform", 1)] } }) });
  const stamped = Date.parse(live.provenance.headlineMetric.computedAt);
  assert.ok(stamped >= before && stamped <= Date.now(),
    "the default clock did not stamp the record at the moment it was built");
});

// ---------------------------------------------------------------------------
// 2. Redaction. Key names travel; values never do.
// ---------------------------------------------------------------------------

test("a figure computed from a record carrying prompt text and a credential leaks neither", () => {
  // A department row the way a careless upstream change could leave one: the
  // reader's prompt text and a credential-shaped field sitting on the record the
  // figure is computed from.
  const leaky = {
    ...unscored("Support", 10_000),
    promptText: "Summarize the Q3 board deck for the CFO, including headcount",
    apiKey: "sk-live-9f3a2b7c4d1e8f6a0b5c",
    customerEmail: "cfo@example.com",
  };
  const block = blockFor([scored("Platform", 90_000), leaky], "2026-05-02T08:00:00.000Z");
  const serialized = JSON.stringify(block.provenance);

  for (const secret of ["Summarize the Q3", "sk-live-9f3a2b7c4d1e8f6a0b5c", "cfo@example.com",
    "promptText", "apiKey", "customerEmail"]) {
    assert.ok(!serialized.includes(secret),
      `the provenance records carry "${secret}"`);
  }
  // …and the records are not empty, so this is a redaction rather than a silence.
  assert.ok(block.provenance.headlineMetric.inputs.length > 0);
});

test("the input list is symbolic key names, and refuses anything that is not one", () => {
  const kept = symbolicInputs([
    "coveredUsd", "provenance.rows", "coveredUsd",
    "Summarize the Q3 board deck", "sk-live-9f3a2b7c", "prompt_text", "customerEmail",
    "apiKey", "authorization", 42, null, "",
  ]);
  assert.deepEqual(kept, ["coveredUsd", "provenance.rows"],
    "a value, a credential, or a prompt reached the input list");
  // An object's OWN KEYS are the operand names, which is how a figure that
  // already publishes its operands needs no second list.
  assert.deepEqual(symbolicInputs({ totalUsd: 10, promptExcerpt: "…" }), ["totalUsd"]);
});

test("the tap records the path, never what it resolved to", () => {
  const tap = inputTap({ totalUsd: 10_000, action: { cluster: "Customer Support" }, missing: null });
  assert.equal(tap.read("action.cluster"), "Customer Support");
  assert.equal(tap.read("missing"), null);
  assert.equal(tap.read("nothing.here"), undefined);
  assert.deepEqual([...tap.keys()], ["action.cluster", "missing"]);
  const record = figureProvenance({ figure: "f", inputs: tap.keys(), sampleCount: 1 });
  assert.ok(!JSON.stringify(record).includes("Customer Support"));
});

// ---------------------------------------------------------------------------
// 3. The disclosure on the page.
// ---------------------------------------------------------------------------

test("the answer region carries one provenance disclosure, collapsed, that opens on Enter", () => {
  const document = parseHtml(html);
  const block = applyAnswerBlock(document);
  assert.ok(block, "the answer block must paint from the bundled summary");

  const ids = standDisclosureIds(ANSWER_PROVENANCE_KEY);
  const details = byId(document, ids.details);
  const summary = byId(document, ids.summary);
  assert.ok(details, "the answer region states no provenance for its own figure");
  assert.equal(details.closest("#finops-answer"), block,
    "the provenance disclosure is not inside the one decision-summary region");

  // Collapsed by default, in both channels, and the trigger names what it reveals.
  assert.equal(details.hasAttribute("open"), false);
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(details.dataset.disclosure, "collapsed");
  assert.equal(textOf(byId(document, ids.heading)), ANSWER_PROVENANCE_LABEL);
  assert.ok(!/^details$/i.test(textOf(byId(document, ids.heading))));

  // Keyboard: the native summary is the control, and Enter is what a reader
  // presses. No second control is nested inside it.
  assert.deepEqual(summary.querySelectorAll("button,a,input,select,textarea"), []);
  summary.focus();
  assert.equal(document.activeElement, summary);
  pressEnter(document);
  assert.equal(details.hasAttribute("open"), true, "Enter did not expand the disclosure");
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.equal(details.dataset.disclosure, "expanded");
  assert.equal(document.activeElement, summary);

  // …and what it now shows is the headline metric's own sample count and method.
  const record = FINOPS_ANSWER_SUMMARY.provenance.headlineMetric;
  const shown = textOf(byId(document, ids.list));
  assert.ok(shown.includes(`${record.samples.count} ${record.samples.unit}`), shown);
  assert.ok(shown.includes(record.method.label), shown);
  assert.ok(shown.includes(record.inputs[0]), shown);
  // The instant is a readable date, never epoch millis or a raw ISO string.
  assert.ok(!shown.includes(String(Date.parse(record.computedAt))), shown);
  assert.ok(!shown.includes(record.computedAt), shown);
});

test("the disclosure adds no second destination to the one-action region", () => {
  const document = parseHtml(html);
  applyAnswerBlock(document);
  const anchors = byId(document, ANSWER_BLOCK_IDS.block).querySelectorAll("a");
  assert.deepEqual([...anchors].map((link) => link.id), [ANSWER_BLOCK_IDS.action],
    "the provenance disclosure put a second operable destination in the answer");
});

test("a figure with no inputs and no sample says so in words, not as an empty list", () => {
  const document = parseHtml(html);
  const empty = answerBlock({ label: "Imported", period: null },
    { now: () => new Date("2026-05-02T08:00:00.000Z") });
  applyAnswerProvenance(document, empty);
  const ids = standDisclosureIds(ANSWER_PROVENANCE_KEY);
  const list = byId(document, ids.list);
  const shown = textOf(list);

  assert.ok(list.querySelectorAll("dt").length > 0, "the disclosure rendered an empty list");
  assert.match(shown, /Nothing has been read for this figure yet/);
  // No bare zero, and no timestamp hanging off a figure with nothing behind it.
  assert.ok(!/\b0\b/.test(shown), shown);
  assert.ok(!/2026/.test(shown), `a computed-at was shown for a figure with nothing behind it: ${shown}`);
});

test("a figure with operands but no rows ranked says that, rather than printing 0", () => {
  const document = parseHtml(html);
  // A fully scored export: graded, so the action is chosen from the state alone
  // and ranks no residue.
  const graded = blockFor([scored("Platform", 90_000), scored("Support", 10_000)],
    "2026-05-02T08:00:00.000Z");
  assert.equal(graded.provenance.nextAction.samples.count, 0);
  assert.equal(graded.provenance.nextAction.empty, false,
    "the action read the export's state, so its record is not the degenerate one");

  applyAnswerProvenance(document, graded);
  const shown = textOf(byId(document, standDisclosureIds(ANSWER_PROVENANCE_KEY).list));
  assert.match(shown, /No unscored department rows were read for this figure/);
  assert.ok(!/·\s*sample\s*0\b/.test(shown), shown);
});

test("a repaint replaces the record and never stacks a second disclosure", () => {
  const document = parseHtml(html);
  applyAnswerBlock(document);
  const first = textOf(byId(document, standDisclosureIds(ANSWER_PROVENANCE_KEY).list));
  applyAnswerBlock(document, blockFor([scored("Platform", 90_000), unscored("Support", 10_000)],
    "2026-05-02T08:00:00.000Z"));
  const region = byId(document, ANSWER_BLOCK_IDS.block);
  assert.equal(region.querySelectorAll("details").length, 1,
    "a second paint mounted a second provenance disclosure");
  const second = textOf(byId(document, standDisclosureIds(ANSWER_PROVENANCE_KEY).list));
  assert.notEqual(second, first, "the repaint left the previous figure's provenance standing");
});
