// Recognition, confidence, and redaction tests (#928). The point of this file
// is that a disputed score can be re-derived: every fixture asserts an EXACT
// confidence rather than a range, the evidence is asserted to add up to it, and
// the same fixture is asserted to score identically twice and after its keys
// are reordered.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCEPTED_MIN_CONFIDENCE, ATTENTION_MIN_CONFIDENCE, MAX_CONFIDENCE, RECORD_FLOOR,
  RECOGNITION_BANDS, RECOGNITION_OUTCOMES, RECOGNITION_SIGNALS, REDACTED,
  bandFor, recognizeExport, redactFileToken,
} from "../src/export-recognition.js";
import {
  INJECTED_INSTRUCTION, KEY_LIKE_STRING, RECOGNITION_FIXTURES, recognitionFixtureById,
} from "../src/export-recognition-fixtures.js";
import {
  LOCAL_SCOPE_COPY, UNKNOWN_EXAMPLE_COPY, initExportRecognition, renderExportRecognition,
} from "../src/export-recognition-view.js";
import { createElement, tags } from "./support/dom.js";

const PROVIDERS = ["bedrock", "vertex-ai", "azure-openai"];
const CLASSES = Object.values(RECOGNITION_OUTCOMES);

// ------------------------------------------------------------ weight table

test("the weight table is a table: named, integer, summing to the stated maximum", () => {
  const ids = RECOGNITION_SIGNALS.map((signal) => signal.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(RECOGNITION_SIGNALS.reduce((total, signal) => total + signal.weight, 0),
    MAX_CONFIDENCE);
  for (const signal of RECOGNITION_SIGNALS) {
    assert.ok(Number.isInteger(signal.weight) && signal.weight > 0,
      `${signal.id} must carry a positive integer weight`);
    // The assumption is the whole defence of the weight. A signal without one
    // is a number nobody can argue with, which is the failure mode this
    // module exists to avoid.
    assert.ok(signal.assumption.length > 60, `${signal.id} must state its assumption`);
  }
});

test("band thresholds are named constants, ordered, and inside the scale", () => {
  assert.ok(ATTENTION_MIN_CONFIDENCE < ACCEPTED_MIN_CONFIDENCE);
  assert.ok(ACCEPTED_MIN_CONFIDENCE <= MAX_CONFIDENCE);
  assert.equal(bandFor(MAX_CONFIDENCE), RECOGNITION_BANDS.ACCEPTED);
  assert.equal(bandFor(ACCEPTED_MIN_CONFIDENCE), RECOGNITION_BANDS.ACCEPTED);
  assert.equal(bandFor(ACCEPTED_MIN_CONFIDENCE - 1), RECOGNITION_BANDS.ATTENTION);
  assert.equal(bandFor(ATTENTION_MIN_CONFIDENCE), RECOGNITION_BANDS.ATTENTION);
  assert.equal(bandFor(ATTENTION_MIN_CONFIDENCE - 1), RECOGNITION_BANDS.REJECTED);
  assert.equal(bandFor(0), RECOGNITION_BANDS.REJECTED);
  assert.ok(RECORD_FLOOR >= 1);
});

// ---------------------------------------------------------------- fixtures

test("the fixture set covers every contracted provider in every outcome class", () => {
  assert.ok(RECOGNITION_FIXTURES.length >= 12);
  for (const providerId of PROVIDERS) {
    const mine = RECOGNITION_FIXTURES.filter((fixture) => fixture.providerId === providerId);
    assert.deepEqual(mine.map((fixture) => fixture.outcomeClass).sort(), [...CLASSES].sort(),
      `${providerId} must carry one fixture per outcome class`);
  }
  // A file belonging to no contract, so "none" is an answer rather than a
  // nearest-neighbour guess.
  assert.equal(RECOGNITION_FIXTURES.filter((fixture) => fixture.providerId === null).length, 1);
  const ids = RECOGNITION_FIXTURES.map((fixture) => fixture.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("fixtures are static literals: no clock, no counter, no generated value", () => {
  // Read twice through the module's own accessor. A fixture that computed
  // anything at read time would differ between the two reads.
  const first = JSON.stringify(RECOGNITION_FIXTURES.map((fixture) => fixture.parsed));
  const second = JSON.stringify(
    RECOGNITION_FIXTURES.map((fixture) => recognitionFixtureById(fixture.id).parsed));
  assert.equal(first, second);
});

for (const fixture of RECOGNITION_FIXTURES) {
  test(`${fixture.id} scores exactly its labelled expectation`, () => {
    const result = recognizeExport(fixture.parsed);
    assert.equal(result.providerId, fixture.expected.providerId);
    assert.equal(result.outcome, fixture.expected.outcome);
    assert.equal(result.band, fixture.expected.band);
    // Exact, not a range: a range is a score nobody can reproduce.
    assert.equal(result.confidence, fixture.expected.confidence);
    assert.equal(result.outcome, fixture.outcomeClass);
    assert.ok(result.nextAction.length > 20);
  });
}

// --------------------------------------------------------- reconstructable

test("every listed contribution adds up to the reported confidence", () => {
  for (const fixture of RECOGNITION_FIXTURES) {
    const result = recognizeExport(fixture.parsed);
    const summed = result.evidence.reduce((total, entry) => total + entry.contribution, 0);
    assert.equal(summed, result.confidence, `${fixture.id} does not add up`);
  }
});

test("every signal that fired is on the evidence list, and so is every one that did not", () => {
  for (const fixture of RECOGNITION_FIXTURES) {
    const result = recognizeExport(fixture.parsed);
    const listed = new Set(result.evidence.map((entry) => entry.signalId));
    for (const signal of RECOGNITION_SIGNALS) {
      assert.ok(listed.has(signal.id), `${fixture.id} omits ${signal.id} from its evidence`);
    }
    for (const entry of result.evidence) {
      assert.ok(entry.statement.length > 20, `${entry.signalId} statement is too thin to check`);
      if (entry.contribution > 0) assert.equal(entry.contribution, entry.weight);
    }
    // Order is the weight table's order, so two readers comparing evidence
    // lists are comparing the same lines in the same places.
    assert.deepEqual(result.evidence.slice(0, RECOGNITION_SIGNALS.length)
      .map((entry) => entry.signalId), RECOGNITION_SIGNALS.map((signal) => signal.id));
  }
});

// ------------------------------------------------------------ reproducible

const reorder = (record) => Object.fromEntries(Object.entries(record).reverse());
const reorderedClone = (parsed) => ({
  records: parsed.records.map(reorder),
  fieldNames: [...parsed.fieldNames].reverse(),
  format: parsed.format,
  ok: parsed.ok,
});

test("the same fixture scores byte-identically twice and after its keys are reordered", () => {
  for (const fixture of RECOGNITION_FIXTURES) {
    const once = JSON.stringify(recognizeExport(fixture.parsed));
    const twice = JSON.stringify(recognizeExport(fixture.parsed));
    assert.equal(twice, once, `${fixture.id} is not stable across two runs`);
    const shuffled = JSON.stringify(recognizeExport(reorderedClone(fixture.parsed)));
    assert.equal(shuffled, once, `${fixture.id} depends on key or column order`);
  }
});

test("an unreadable parse and an empty input score zero rather than throwing", () => {
  for (const input of [undefined, null, {}, { ok: false, format: "csv", fieldNames: [], records: [] }]) {
    const result = recognizeExport(input);
    assert.equal(result.confidence, 0);
    assert.equal(result.band, RECOGNITION_BANDS.REJECTED);
    assert.equal(result.providerId, null);
    assert.equal(result.outcome, RECOGNITION_OUTCOMES.INCOMPATIBLE);
  }
});

// ---------------------------------------------------------------- redaction

test("redaction passes published vocabulary and withholds everything else", () => {
  assert.equal(redactFileToken("lineItem/UnblendedCost"), "lineItem/UnblendedCost");
  assert.equal(redactFileToken("prompt_text"), "prompt_text");
  assert.equal(redactFileToken(INJECTED_INSTRUCTION), REDACTED);
  assert.equal(redactFileToken(KEY_LIKE_STRING), REDACTED);
  assert.equal(redactFileToken(undefined), REDACTED);
});

const HOSTILE_ID = "bedrock-incompatible";

test("no free text from a hostile export reaches the result or the surface", () => {
  const fixture = recognitionFixtureById(HOSTILE_ID);
  // The fixture really does carry both strings, or this test proves nothing.
  const raw = JSON.stringify(fixture.parsed);
  assert.ok(raw.includes(INJECTED_INSTRUCTION) && raw.includes(KEY_LIKE_STRING));

  const result = recognizeExport(fixture.parsed);
  const emitted = [...result.evidence.map((entry) => entry.statement), result.nextAction].join(" ");
  for (const secret of [INJECTED_INSTRUCTION, KEY_LIKE_STRING, "Ignore previous", "sk-"]) {
    assert.ok(!emitted.includes(secret), `evidence leaked ${secret}`);
  }
  const doc = fakeDocument();
  renderExportRecognition(doc, HOSTILE_ID);
  const painted = doc.registry[RESULT_ID].textContent;
  for (const secret of [INJECTED_INSTRUCTION, KEY_LIKE_STRING, "Ignore previous", "sk-"]) {
    assert.ok(!painted.includes(secret), `the surface leaked ${secret}`);
  }
  // What it says instead: the structural fact, and nothing from the file.
  assert.ok(painted.includes("prompt_text"));
  assert.ok(painted.includes("Rejected"));
});

// ----------------------------------------------------------------- surface

const EXAMPLE_ID = "export-recognition-example";
const RESULT_ID = "export-recognition-result";

function fakeDocument() {
  const registry = Object.fromEntries([EXAMPLE_ID, RESULT_ID].map((id) => {
    const element = createElement("div");
    element.id = id;
    return [id, element];
  }));
  return { createElement, getElementById: (id) => registry[id] ?? null, registry };
}

test("the surface paints band, confidence, evidence and next action together", () => {
  for (const id of ["bedrock-recognized", "azure-openai-incompatible"]) {
    const doc = fakeDocument();
    assert.equal(renderExportRecognition(doc, id), true);
    const root = doc.registry[RESULT_ID];
    const result = recognizeExport(recognitionFixtureById(id).parsed);
    assert.equal(root.dataset.state, "scored");
    assert.equal(root.dataset.band, result.band);
    assert.equal(root.dataset.confidence, String(result.confidence));
    const text = root.textContent;
    assert.ok(text.includes(`Confidence ${result.confidence} of ${result.maxConfidence}`));
    assert.ok(text.includes(result.nextAction));
    // The number never appears without the lines that produce it: the evidence
    // list is painted in the same pass, one item per signal.
    assert.equal(tags(root, "OL").length, 1);
    assert.equal(tags(root, "LI").length, result.evidence.length);
    for (const entry of result.evidence) assert.ok(text.includes(entry.statement));
  }
});

test("an accepted example and a rejected example read as exactly one state each", () => {
  const doc = fakeDocument();
  renderExportRecognition(doc, "bedrock-recognized");
  const accepted = doc.registry[RESULT_ID].textContent;
  assert.equal(doc.registry[RESULT_ID].dataset.band, RECOGNITION_BANDS.ACCEPTED);
  assert.ok(accepted.includes("Accepted") && !accepted.includes("Rejected"));
  assert.ok(accepted.includes("Detected provider: AWS Bedrock"));

  renderExportRecognition(doc, "none-incompatible");
  const rejected = doc.registry[RESULT_ID].textContent;
  assert.equal(doc.registry[RESULT_ID].dataset.band, RECOGNITION_BANDS.REJECTED);
  assert.ok(rejected.includes("Rejected") && !rejected.includes("Accepted"));
  assert.ok(rejected.includes("Detected provider: none"));
});

test("the surface claims local browser analysis and never a live integration", () => {
  const doc = fakeDocument();
  for (const fixture of RECOGNITION_FIXTURES) {
    renderExportRecognition(doc, fixture.id);
    const text = doc.registry[RESULT_ID].textContent;
    assert.ok(text.includes(LOCAL_SCOPE_COPY), `${fixture.id} dropped the local-only statement`);
    for (const claim of ["connected to", "live provider", "real-time", "fetched from",
      "synced", "we queried", "your account"]) {
      assert.ok(!text.toLowerCase().includes(claim), `${fixture.id} implies ${claim}`);
    }
  }
});

test("the chooser is filled from the fixtures and scores the first one on init", () => {
  const doc = fakeDocument();
  assert.equal(initExportRecognition(doc), true);
  const select = doc.registry[EXAMPLE_ID];
  assert.equal(select.children.length, RECOGNITION_FIXTURES.length);
  assert.equal(select.value, RECOGNITION_FIXTURES[0].id);
  assert.equal(doc.registry[RESULT_ID].dataset.state, "scored");

  select.value = "azure-openai-ambiguous";
  select.dispatch("change");
  assert.equal(doc.registry[RESULT_ID].dataset.band, RECOGNITION_BANDS.ATTENTION);
  assert.equal(doc.registry[RESULT_ID].dataset.confidence, "75");
});

test("a value no bundled example carries is refused by this module, not by the control", () => {
  const doc = fakeDocument();
  initExportRecognition(doc);
  const select = doc.registry[EXAMPLE_ID];
  // The harness hands back any value assigned to a select, which a real control
  // would refuse — so the refusal has to be here, and it has to be visible.
  select.value = "not-a-bundled-example";
  select.dispatch("change");
  const root = doc.registry[RESULT_ID];
  assert.equal(root.dataset.state, "unavailable");
  assert.equal(root.dataset.band, "none");
  assert.ok(root.textContent.includes(UNKNOWN_EXAMPLE_COPY));
  // No stale figure is left behind next to the refusal.
  assert.equal(tags(root, "LI").length, 0);
});

// ---------------------------------------------------------------- markup

test("the workspace document carries the result region outside every disclosure", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const start = html.indexOf('id="export-recognition"');
  assert.ok(start > 0, "the recognition section must ship in the document");
  const section = html.slice(start, html.indexOf("</section>", start));
  assert.ok(section.includes('id="export-recognition-result"'));
  assert.ok(section.includes('role="status"') && section.includes('aria-live="polite"'));
  // A live region inside a folded disclosure is not announced in a real
  // browser, whatever the harness reads from it.
  assert.ok(!section.includes("<details"), "the result region must not be folded away");
  // No number and no provider name ships in the markup: everything a reader
  // acts on is painted from the fixtures and the published contracts.
  for (const claim of ["AWS Bedrock", "Vertex AI", "Azure OpenAI", "Confidence 1", "Confidence 0"]) {
    assert.ok(!section.includes(claim), `the markup must not ship ${claim}`);
  }
});
