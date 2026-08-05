// Does the published answer still reproduce from a pinned snapshot?
//
// WHAT A DISPUTING DIRECTOR SHOULD READ, IN ORDER.
//   1. tests/fixtures/finops-answer-reproduction.json — the invented input, the
//      assumption behind every weight, and the three expected values, each with
//      a one-line note naming the rule that produced it.
//   2. The failure output below. Every assertion names the field that diverged,
//      what was pinned, what the code produced now, and the rule note from the
//      fixture, so CI says WHAT changed rather than "snapshot mismatch".
//
// THERE IS NO SECOND IMPLEMENTATION HERE. This file divides nothing, ranks
// nothing, and formats no percentage. It calls gradeExport() and then
// answerBlock() — the same pair src/finops-answer-summary.js calls to paint
// /evolution.html — and compares fields. A test that re-derived 36% would only
// prove that two copies of the same arithmetic agree.
//
// AND THE ASSERTIONS RUN OVER THE PROVENANCE-BEARING FIGURES (#833), not over a
// parallel un-annotated copy of the numbers: each figure is checked together
// with the record that travels with it — the operand keys it consumed, the
// sample it was measured over, the method, and the injected computed-at.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { gradeExport } from "../src/export-gradability.js";
import { answerBlock, periodLabel } from "../src/finops-screen-contract.js";
import {
  ANSWER_REPRODUCTION, REPRODUCTION_CHECK, REPRODUCTION_STAMP_VERSION, REPRODUCTION_UNAVAILABLE,
  readReproductionStamp, reproductionLine,
} from "../src/finops-answer-reproduction.js";
import { ANSWER_REPRODUCTION_ID, applyAnswerBlock, applyAnswerReproduction } from "../src/finops-stand-view.js";

const FIXTURE_URL = new URL("./fixtures/finops-answer-reproduction.json", import.meta.url);
const STAMP_URL = new URL("../src/finops-answer-reproduction-stamp.json", import.meta.url);
const PAGE_URL = new URL("../src/evolution.html", import.meta.url);

const fixture = JSON.parse(await readFile(FIXTURE_URL, "utf8"));
const committedStamp = JSON.parse(await readFile(STAMP_URL, "utf8"));
const html = await readFile(PAGE_URL, "utf8");

/**
 * Recompute the answer from a snapshot, through the live path and nothing else.
 *
 * The clock is the snapshot's own pinned instant, injected — answerBlock takes
 * `now` as an option — so `computedAt` is reproducible without stubbing a global.
 */
function recompute(analysis, { label, source, computedAt } = fixture.input) {
  return answerBlock({
    label,
    period: periodLabel(analysis),
    gradability: gradeExport({ analysis, source }),
  }, { now: () => new Date(computedAt) });
}

/** A deep copy of the pinned input's analysis, so a perturbation cannot leak. */
const analysisCopy = () => structuredClone(fixture.input.analysis);

/**
 * One field, and what it means if it moved.
 *
 * The message is the deliverable: a director reading CI must see the field, the
 * pinned value, the recomputed value, and the rule the pinned value came from.
 */
function agrees(field, actual, expected, note) {
  assert.deepEqual(actual, expected,
    `${field} does not reproduce.\n`
    + `  pinned:     ${JSON.stringify(expected)}\n`
    + `  recomputed: ${JSON.stringify(actual)}\n`
    + `  the pinned rule: ${note}\n`
    + `  Either a scoring, ranking, or formatting rule changed on purpose — then update\n`
    + `  ${REPRODUCTION_CHECK.fixture} and its note in the same change, so the next reader\n`
    + "  sees the new rule stated — or it drifted, and this is the drift.");
}

// ---------------------------------------------------------------------------
// 1. The three published values.
// ---------------------------------------------------------------------------

test("the headline metric reproduces from the pinned snapshot", () => {
  const answer = recompute(analysisCopy());
  const pinned = fixture.expected.headlineMetric;
  agrees("headline metric · figure", answer.figure, pinned.figure, pinned.note);
  agrees("headline metric · raw ratio", answer.ratio, pinned.ratio, pinned.note);
  agrees("headline metric · as-of basis", answer.basis, pinned.basis, pinned.basisNote);
  agrees("headline metric · publication state", answer.state, pinned.state, pinned.stateNote);
});

test("the ranked action reproduces from the pinned snapshot", () => {
  const answer = recompute(analysisCopy());
  const pinned = fixture.expected.rankedAction;
  agrees("ranked action · label", answer.action.label, pinned.label, pinned.note);
  agrees("ranked action · destination", answer.action.href, pinned.href, pinned.note);
  agrees("ranked action · destination key", answer.action.destinationKey,
    pinned.destinationKey, pinned.note);
});

test("the confidence tier reproduces from the pinned snapshot", () => {
  const analysis = analysisCopy();
  const pinned = fixture.expected.confidence;
  // The tier is read off the same verdict the figure came from, so it is
  // asserted on the verdict AND on the line the answer block publishes from it.
  agrees("confidence · tier", gradeExport({ analysis, source: fixture.input.source }).tier,
    pinned.tier, pinned.note);
  const answer = recompute(analysis);
  agrees("confidence · published label", answer.evidence.confidence, pinned.label, pinned.note);
  agrees("confidence · line", answer.evidence.line, pinned.line, pinned.note);
});

// ---------------------------------------------------------------------------
// 2. …over the provenance-bearing figures, not beside them (#833).
// ---------------------------------------------------------------------------

test("each figure's provenance record travels with the figure it explains", () => {
  const answer = recompute(analysisCopy());
  const cases = [
    ["headline metric", answer.provenance.headlineMetric, fixture.expected.headlineMetric.provenance],
    ["ranked action", answer.provenance.nextAction, fixture.expected.rankedAction.provenance],
  ];
  for (const [name, record, pinned] of cases) {
    assert.ok(record, `${name}: the published figure carries no provenance record at all, so `
      + "nothing states which inputs it consumed. #833's record has been dropped.");
    agrees(`${name} · provenance.figure`, record.figure, pinned.figure, pinned.note);
    agrees(`${name} · provenance.label`, record.label, pinned.label, pinned.note);
    agrees(`${name} · provenance.inputs`, [...record.inputs], pinned.inputs, pinned.note);
    agrees(`${name} · provenance.samples.count`, record.samples.count, pinned.sampleCount, pinned.note);
    agrees(`${name} · provenance.samples.unit`, record.samples.unit, pinned.sampleUnit, pinned.note);
    agrees(`${name} · provenance.method.aggregation`, record.method.aggregation,
      pinned.aggregation, pinned.note);
    agrees(`${name} · provenance.method.rule`, record.method.rule, pinned.rule, pinned.note);
    agrees(`${name} · provenance.empty`, record.empty, pinned.empty, pinned.note);
    agrees(`${name} · provenance.computedAt`, record.computedAt, fixture.input.computedAt,
      fixture.input.computedAtNote);
  }
});

test("no value from the snapshot leaks into a provenance record as a key name", () => {
  // The record publishes KEY NAMES, never values. A department name reaching the
  // input list would be the leak #833's `symbolicInputs` gate exists to stop.
  const answer = recompute(analysisCopy());
  const serialized = JSON.stringify(answer.provenance);
  for (const row of fixture.input.analysis.rankedDepartments) {
    assert.ok(!serialized.includes(row.name),
      `the provenance records name "${row.name}", so a value has reached a list of key names`);
  }
});

// ---------------------------------------------------------------------------
// 3. The negative checks: does any of this actually bite?
// ---------------------------------------------------------------------------

test("a perturbed snapshot moves the tier, so a silent scoring change cannot pass green", () => {
  const [perturbation] = fixture.perturbations;
  const analysis = analysisCopy();
  const target = analysis.rankedDepartments.find((row) => row.name === perturbation.department);
  assert.ok(target, `the fixture names no department "${perturbation.department}" to perturb`);
  Object.assign(target, perturbation.set);

  const verdict = gradeExport({ analysis, source: fixture.input.source });
  const answer = recompute(analysis);
  assert.equal(verdict.tier, perturbation.expect.tier,
    `${perturbation.name}: expected the tier to become ${perturbation.expect.tier}; it is `
    + `${verdict.tier}. ${perturbation.note}`);
  assert.equal(answer.state, perturbation.expect.state,
    `${perturbation.name}: expected state ${perturbation.expect.state}, got ${answer.state}`);
  assert.equal(answer.action.label, perturbation.expect.actionLabel,
    `${perturbation.name}: expected the action to become "${perturbation.expect.actionLabel}"`);
  // …and it really is a different answer from the pinned one.
  assert.notEqual(verdict.tier, fixture.expected.confidence.tier,
    "the perturbation left the tier where it was, so the tier assertion above proves nothing");
});

test("a perturbed snapshot moves the ranked action with the tier held still", () => {
  const perturbation = fixture.perturbations[1];
  const analysis = analysisCopy();
  const target = analysis.rankedDepartments.find((row) => row.name === perturbation.department);
  assert.ok(target, `the fixture names no department "${perturbation.department}" to perturb`);
  Object.assign(target, perturbation.set);

  const answer = recompute(analysis);
  assert.equal(gradeExport({ analysis, source: fixture.input.source }).tier,
    perturbation.expect.tier,
    `${perturbation.name}: the tier was supposed to hold still. ${perturbation.note}`);
  assert.equal(answer.action.label, perturbation.expect.actionLabel,
    `${perturbation.name}: expected "${perturbation.expect.actionLabel}", got `
    + `"${answer.action.label}". ${perturbation.note}`);
  assert.notEqual(answer.action.label, fixture.expected.rankedAction.label,
    "the ranking assertion cannot bite: the perturbed snapshot names the same department");
});

// ---------------------------------------------------------------------------
// 4. The recorded run, and the line the page renders from it.
// ---------------------------------------------------------------------------

test("the committed stamp is the record of THIS fixture, not a stale one", () => {
  assert.equal(committedStamp.version, REPRODUCTION_STAMP_VERSION);
  assert.equal(committedStamp.fixtureRevision, fixture.revision,
    `the recorded run is for fixture revision ${committedStamp.fixtureRevision}, but the fixture `
    + `is at ${fixture.revision}. The rendered line would date a check that ran against a `
    + "different snapshot. Re-run this test to move the stamp.");
  assert.equal(committedStamp.fixture, REPRODUCTION_CHECK.fixture);
  assert.deepEqual(committedStamp.figuresChecked, ["headlineMetric", "nextAction"],
    "the stamp must list the figures this check actually compared");
  assert.ok(readReproductionStamp(committedStamp),
    "the committed stamp does not validate, so the page will say the check is unrecorded");
});

test("the rendered line quotes the recorded run and never a date literal", () => {
  const line = reproductionLine(committedStamp);
  assert.equal(line.available, true);
  assert.equal(line.checkedOn, committedStamp.checkedOn);
  assert.match(line.text, /Last checked /);
  assert.ok(!line.text.includes(REPRODUCTION_CHECK.fixture),
    "a file path is not executive wording");
  // The date in the sentence is the artifact's, and it moves with the artifact.
  const moved = reproductionLine({ ...committedStamp, checkedOn: "2026-01-02" });
  assert.match(moved.text, /January 2, 2026/);
  assert.notEqual(moved.text, line.text);
  // Nothing in the shipped document dates this check. The sentence exists in one
  // place, composed from the artifact, so a stale build cannot claim a fresh run.
  assert.ok(!html.includes("Last checked"),
    "the document authors a freshness claim of its own, which no artifact stands behind");
  assert.ok(!html.includes(line.text));
});

test("an unusable stamp says so plainly instead of implying a check ran", () => {
  for (const [name, stamp] of [
    ["missing", null],
    ["not an object", "2026-07-31"],
    ["a version this module was not written against", { ...committedStamp, version: "other/9" }],
    ["a date that is not a calendar day", { ...committedStamp, checkedOn: "last Tuesday" }],
    ["a revision nobody can resolve", { ...committedStamp, fixtureRevision: "¯\\_(ツ)_/¯" }],
    ["no figures listed", { ...committedStamp, figuresChecked: [] }],
  ]) {
    const line = reproductionLine(stamp);
    assert.equal(line.available, false, `a stamp that is ${name} must not produce a claim`);
    assert.equal(line.text, REPRODUCTION_UNAVAILABLE);
    assert.ok(!/checked/i.test(line.text.split(".")[0]) || /no record/i.test(line.text),
      "the unavailable wording must not read as a passed check");
  }
});

test("the answer block on /evolution.html renders the line through its own entry point", () => {
  const document = parseHtml(html);
  const block = applyAnswerBlock(document);
  assert.ok(block, "the answer block must paint");

  const node = document.getElementById(ANSWER_REPRODUCTION_ID);
  assert.ok(node, "the page entry point painted no reproduction line, so the answer states no "
    + "confidence claim a reader could check");
  assert.equal(node.closest("#finops-answer"), block,
    "the reproduction line must sit in the one answer region, not in a panel of its own");
  // Immediately after the confidence sentence it qualifies, and before the one
  // action it bounds: a qualifier read after the step is a footnote.
  const order = () => [...block.children].map((child) => child.id).filter(Boolean);
  // #finops-answer-scope is the authored sentence naming which question this
  // verdict answers (#1113). It sits above the confidence sentence, so the
  // confidence sentence and the line qualifying it are still adjacent.
  assert.deepEqual(order().slice(0, 6), ["finops-answer-question", "finops-answer-figure",
    "finops-answer-scope", "finops-answer-confidence", ANSWER_REPRODUCTION_ID,
    "finops-answer-action"],
    "the reproduction line is not between the confidence sentence and the action");
  // Painted twice is still one line: the block repaints on every import.
  applyAnswerBlock(document);
  assert.equal(order().filter((id) => id === ANSWER_REPRODUCTION_ID).length, 1,
    "a repaint mounted a second reproduction line");
  assert.equal(textOf(node), ANSWER_REPRODUCTION.text,
    "the painted line is not the one composed from the committed stamp");
  assert.equal(node.dataset.checked, String(ANSWER_REPRODUCTION.available));
  assert.match(textOf(node), /Last checked /);

  // Still exactly one action in the decision summary: this line links nowhere.
  assert.deepEqual([...block.querySelectorAll("a")].map((link) => link.id),
    ["finops-answer-action"], "the reproduction line added a second destination");
  assert.deepEqual(node.querySelectorAll("a"), []);

  // The unavailable state paints too, in both channels.
  applyAnswerReproduction(document, reproductionLine(null));
  assert.equal(textOf(document.getElementById(ANSWER_REPRODUCTION_ID)), REPRODUCTION_UNAVAILABLE);
  assert.equal(document.getElementById(ANSWER_REPRODUCTION_ID).dataset.checked, "false");
});

// ---------------------------------------------------------------------------
// 5. …and record that this run happened. Last, so nothing is stamped that did
//    not pass: node:test runs the file's tests in source order.
// ---------------------------------------------------------------------------

test("the run is recorded, so the rendered date is an artifact rather than a claim", async () => {
  const answer = recompute(analysisCopy());
  // Re-assert the three headline values here rather than trusting the tests
  // above to have run: this is the assertion the stamp is a receipt for.
  assert.equal(answer.figure, fixture.expected.headlineMetric.figure);
  assert.equal(answer.action.label, fixture.expected.rankedAction.label);
  assert.equal(answer.evidence.confidence, fixture.expected.confidence.label);

  const stamp = {
    ...committedStamp,
    version: REPRODUCTION_STAMP_VERSION,
    check: REPRODUCTION_CHECK.test,
    fixture: REPRODUCTION_CHECK.fixture,
    fixtureRevision: fixture.revision,
    // Day granularity on purpose: a per-run timestamp would rewrite a tracked
    // file on every `npm test` and put churn in every diff. The claim on screen
    // is "last checked on this day", which is exactly what this records.
    checkedOn: new Date().toISOString().slice(0, 10),
    figuresChecked: ["headlineMetric", "nextAction"],
  };
  const serialized = `${JSON.stringify(stamp, null, 2)}\n`;
  const onDisk = await readFile(STAMP_URL, "utf8");
  if (serialized !== onDisk) await writeFile(STAMP_URL, serialized);
  assert.ok(readReproductionStamp(stamp), "the stamp this run wrote does not validate");
});
