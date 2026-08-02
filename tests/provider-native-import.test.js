// Provider-native local export intake (#930).
//
// The defect this file exists to keep fixed: a file can clear the published
// recognition gate and STILL have no computable rate, because recognition
// scores columns and signatures rather than cell values. The render path used
// to dereference the metric on the answered branch, throw inside the change
// handler, and leave the previous file's finding on screen with no error
// anywhere. Two tests below pin the parts of that: the fixture really does
// clear the gate, and a null-metric render really does replace what was there.

import test from "node:test";
import assert from "node:assert/strict";

import { BROWSER_COMPAT_MANIFEST, contractById } from "../src/browser-compat-contracts.js";
import { ACCEPTED_MIN_CONFIDENCE, MAX_CONFIDENCE } from "../src/export-recognition.js";
import {
  INTAKE_STATES, NO_RATE_SENTENCE, PROVISIONAL_PREFIX, buildIntake, costMetric, rateTable,
} from "../src/provider-native-import.js";
import {
  NATIVE_IMPORT_EXAMPLES, NO_UNIT_COUNT_EXAMPLE, NO_UNIT_COUNT_EXAMPLE_ID, nativeExampleById,
} from "../src/provider-native-import-fixtures.js";
import {
  EMPTY_FINDING_COPY, LOCAL_SCOPE_COPY, UNKNOWN_EXAMPLE_COPY, bindProviderImport,
  initProviderImport, renderProviderImport,
} from "../src/provider-native-import-view.js";
import { createElement, first, tags } from "./support/dom.js";

const PROVIDER_ID = "browser-compat-provider";
const EXAMPLE_ID = "provider-native-example";
const FINDING_ID = "provider-native-finding";
const TRUST_ID = "provider-native-trust";
const EVIDENCE_ID = "provider-native-evidence";
const EVIDENCE_BODY_ID = "provider-native-evidence-body";

const IDS = [PROVIDER_ID, EXAMPLE_ID, FINDING_ID, TRUST_ID,
  EVIDENCE_ID, EVIDENCE_BODY_ID];

function fakeDocument() {
  const registry = Object.fromEntries(IDS.map((id) => {
    const element = createElement("div");
    element.id = id;
    element.value = "";
    return [id, element];
  }));
  return { createElement, getElementById: (id) => registry[id] ?? null, registry };
}

const CLEAN = nativeExampleById("bedrock-supported");
const NO_UNITS = nativeExampleById(NO_UNIT_COUNT_EXAMPLE_ID);

const intakeFor = (example, providerId = example.providerId) => buildIntake({
  text: example.text, fileName: example.fileName, providerId,
  sourceLabel: `bundled example · ${example.label}`,
});

const findingText = (doc) => doc.registry[FINDING_ID].textContent;
const slotClasses = (doc) => doc.registry[FINDING_ID].children.map((child) => child.className);

// ------------------------------------------------------- rate table + metric

test("the rate table ranks by unit rate and returns no model identity", () => {
  const contract = contractById("bedrock");
  const rows = rateTable([
    { "product/model_id": "cheap", "lineItem/UsageAmount": "100000", "lineItem/UnblendedCost": "1.00" },
    { "product/model_id": "dear", "lineItem/UsageAmount": "10000", "lineItem/UnblendedCost": "5.00" },
    { "product/model_id": "dear", "lineItem/UsageAmount": "10000", "lineItem/UnblendedCost": "5.00" },
  ], contract);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.rank), [1, 2]);
  // 10.00 over 20,000 units, against 1.00 over 100,000: 0.50 and 0.01 per 1,000.
  assert.equal(rows[0].ratePer1k, 0.5);
  assert.equal(rows[0].records, 2);
  assert.equal(rows[1].ratePer1k, 0.01);
  // The grouping key came from a cell. It must not come back out.
  for (const row of rows) {
    assert.ok(!Object.keys(row).some((key) => /model|key|id/i.test(key)),
      `a rate row exposed ${Object.keys(row).join(", ")}`);
  }
});

test("a record with no readable unit count carries no rate and is not counted as zero", () => {
  const contract = contractById("bedrock");
  const { rows, metric } = costMetric([
    { "product/model_id": "a", "lineItem/UsageAmount": "0", "lineItem/UnblendedCost": "0.00" },
    { "product/model_id": "b", "lineItem/UsageAmount": "", "lineItem/UnblendedCost": "4.00" },
    { "product/model_id": "c", "lineItem/UsageAmount": "n/a", "lineItem/UnblendedCost": "4.00" },
  ], contract);
  assert.equal(rows.length, 0);
  assert.equal(metric, null, "an absent rate is null, never a computed zero");
});

// --------------------------------------------- the blocking case: null metric

test("an export with every column present and no billed units still clears the gate", () => {
  const intake = intakeFor(NO_UNITS);
  // Proves the fixture reaches the ANSWERED branch: this is the file that used
  // to throw, and it throws precisely because it is NOT rejected.
  assert.ok(intake.recognition.confidence >= ACCEPTED_MIN_CONFIDENCE,
    `confidence ${intake.recognition.confidence} must clear the accepted gate`);
  assert.equal(intake.recognition.confidence, MAX_CONFIDENCE);
  assert.equal(intake.state, INTAKE_STATES.ANSWERED);
  assert.equal(intake.metric, null);
  assert.equal(intake.provenance.recordCount, 3);
});

test("the null-metric answer still paints three slots, a live region and an action", () => {
  const doc = fakeDocument();
  assert.equal(renderProviderImport(doc, intakeFor(NO_UNITS)), true);
  const finding = doc.registry[FINDING_ID];
  assert.equal(finding.dataset.state, INTAKE_STATES.ANSWERED);
  assert.equal(finding.dataset.metric, "none");
  // Three slots, in reading order: question, metric, action.
  assert.deepEqual(slotClasses(doc),
    ["provider-native-question", "provider-native-metric", "provider-native-action"]);
  const text = findingText(doc);
  assert.ok(text.includes(NO_RATE_SENTENCE), "the no-rate sentence is the metric sentence");
  assert.ok(!text.includes(PROVISIONAL_PREFIX), "an answered file is not labelled provisional");
  assert.ok(text.includes("Do this next:"));
  assert.ok(/re-export/i.test(text), "the action must be the re-export copy");
  // No zero figure anywhere: the copy may SAY "not a rate of zero", and must
  // never PRINT one, which is what a reader would try to compare against.
  assert.ok(!/\$0\.00 per 1,000|\b0 per 1,000\b|\$0\.0000/.test(text),
    "a missing rate must never be printed as a rate of zero");
  assert.ok(text.includes("not a rate of zero"));
  // The rest of the render path ran: trust signals, evidence, disclosure state.
  assert.equal(doc.registry[TRUST_ID].dataset.state, "ready");
  assert.ok(doc.registry[TRUST_ID].children.length >= 3);
  assert.ok(doc.registry[EVIDENCE_BODY_ID].textContent.includes("No rate table"));
  assert.equal(doc.registry[EVIDENCE_ID].open, true);
  assert.equal(doc.registry[EVIDENCE_ID].dataset.open, "true");
});

test("a null-metric file leaves none of the previous file's finding behind", () => {
  const doc = fakeDocument();
  renderProviderImport(doc, intakeFor(CLEAN));
  const answered = findingText(doc);
  assert.ok(/per 1,000 billed units/.test(answered));
  const rateRows = tags(doc.registry[EVIDENCE_BODY_ID], "LI").length;
  assert.ok(rateRows > 0);
  const trustBefore = doc.registry[TRUST_ID].textContent;

  renderProviderImport(doc, intakeFor(NO_UNITS));
  const after = findingText(doc);
  assert.ok(after.includes(NO_RATE_SENTENCE));
  assert.ok(!after.includes(answered.split("Do this next:")[0].slice(-60)),
    "the previous file's metric sentence survived the re-render");
  assert.equal(doc.registry[FINDING_ID].children.length, 3);
  assert.notEqual(doc.registry[TRUST_ID].textContent, trustBefore,
    "the trust signals must be re-derived, not left from the previous file");
  assert.ok(!first(doc.registry[EVIDENCE_BODY_ID], "provider-native-rates"),
    "the previous file's rate table survived the re-render");
});

// ------------------------------------------------------------ answered path

test("a clean export answers with one question, one rate, and one action", () => {
  const doc = fakeDocument();
  const intake = intakeFor(CLEAN);
  assert.equal(intake.state, INTAKE_STATES.ANSWERED);
  assert.ok(intake.metric.modelCount >= 2);
  renderProviderImport(doc, intake);
  assert.deepEqual(slotClasses(doc),
    ["provider-native-question", "provider-native-metric", "provider-native-action"]);
  const text = findingText(doc);
  assert.ok(text.includes(intake.question));
  assert.ok(text.includes(intake.metric.statement));
  assert.ok(text.includes(intake.action));
  // A settled answer keeps its evidence folded — and the disclosed text is
  // asserted alongside the disclosure state, because the harness reads through
  // a closed disclosure and a real browser does not.
  // Which file this finding is about, so a reader never mistakes a bundled
  // example's answer for one about their own export.
  assert.ok(doc.registry[TRUST_ID].textContent.includes(intake.sourceLabel));
  assert.equal(doc.registry[EVIDENCE_ID].open, false);
  assert.equal(doc.registry[EVIDENCE_ID].dataset.open, "false");
  assert.ok(first(doc.registry[EVIDENCE_BODY_ID], "provider-native-rates"));
});

test("no cell value from the reader's file is painted anywhere on the surface", () => {
  const doc = fakeDocument();
  renderProviderImport(doc, intakeFor(CLEAN));
  const painted = [findingText(doc), doc.registry[TRUST_ID].textContent,
    doc.registry[EVIDENCE_BODY_ID].textContent].join(" ");
  for (const cell of ["anthropic.claude-sonnet", "amazon.titan-text", "000000000001"]) {
    assert.ok(!painted.includes(cell), `the surface painted the cell value ${cell}`);
  }
  assert.ok(painted.includes(LOCAL_SCOPE_COPY), "the local-only claim is on every render");
});

// ------------------------------------------- provisional vs unrecognized split

test("a low-confidence export is provisional, and the prefix sits on the resolved sentence", () => {
  const contract = contractById("bedrock");
  // Every required column present except the currency one: recognized as this
  // provider, below the gate, and with a perfectly computable rate.
  const header = contract.requiredFields
    .map((field) => field.path).filter((path) => !/CurrencyCode/.test(path));
  const text = `${header.join(",")}\n2026-07-20,m1,100000,4.00,000000000001\n`;
  const intake = buildIntake({ text, fileName: "partial.csv", providerId: "bedrock" });
  assert.equal(intake.state, INTAKE_STATES.PROVISIONAL);
  assert.ok(intake.recognition.confidence < ACCEPTED_MIN_CONFIDENCE);
  assert.ok(intake.metric, "a provisional finding still has its figure");
  const doc = fakeDocument();
  renderProviderImport(doc, intake);
  const sentence = first(doc.registry[FINDING_ID], "provider-native-metric").textContent;
  assert.ok(sentence.startsWith(PROVISIONAL_PREFIX));
  assert.ok(sentence.includes(intake.metric.statement),
    "the prefix is applied on top of the resolved sentence, not instead of it");
  assert.equal(doc.registry[FINDING_ID].dataset.state, INTAKE_STATES.PROVISIONAL);
  assert.equal(doc.registry[FINDING_ID].dataset.metric, "rate");
});

test("a wrong-provider file is a recovery state, and its record count is the real one", () => {
  // A file that parses perfectly — as a different published contract.
  const vertex = nativeExampleById("vertex-ai-supported");
  const intake = intakeFor(vertex, "bedrock");
  assert.equal(intake.state, INTAKE_STATES.UNRECOGNIZED);
  assert.notEqual(intake.state, INTAKE_STATES.PROVISIONAL,
    "unrecognized and provisional are different states, not one state with two names");
  assert.equal(intake.provenance.recordCount, 3);
  assert.ok(intake.provenance.readableRecords > 0);
  const doc = fakeDocument();
  renderProviderImport(doc, intake);
  const trust = doc.registry[TRUST_ID].textContent;
  assert.ok(trust.includes("3 records parsed"));
  assert.ok(!trust.includes("0 records parsed"),
    "a file whose records parsed cleanly must never be told none of them did");
  assert.ok(!/0 of them carrying/.test(trust));
  assert.equal(doc.registry[FINDING_ID].children.length, 3);
  assert.equal(doc.registry[FINDING_ID].dataset.state, INTAKE_STATES.UNRECOGNIZED);
});

test("a file no published contract matches drops the count clause it cannot compute", () => {
  const intake = buildIntake({
    text: "posting_date,gl_account,amount\n2026-07-20,6100-software,482.10\n",
    fileName: "ledger.csv", providerId: "bedrock",
  });
  assert.equal(intake.state, INTAKE_STATES.UNRECOGNIZED);
  assert.equal(intake.provenance.readableRecords, null);
  const doc = fakeDocument();
  renderProviderImport(doc, intake);
  const trust = doc.registry[TRUST_ID].textContent;
  assert.ok(trust.includes("1 record parsed"));
  assert.ok(!/carrying a readable unit count/.test(trust),
    "a count nobody could compute is dropped, not printed as zero");
});

// ------------------------------------------------------------------ wiring

test("the shared provider chooser carries exactly the published contract options", () => {
  const doc = fakeDocument();
  assert.equal(initProviderImport(doc), true);
  const provider = doc.registry[PROVIDER_ID];
  // The option SET, not a value round-trip: the harness's select accepts any
  // value assigned to it, so asserting `select.value` proves nothing about
  // which values a real control would take.
  assert.deepEqual(provider.children.map((option) => option.value),
    BROWSER_COMPAT_MANIFEST.contracts.map((contract) => contract.providerId));
  assert.equal(provider.children.length, BROWSER_COMPAT_MANIFEST.contracts.length);
  assert.equal(doc.registry[FINDING_ID].dataset.state, "empty");
  assert.ok(findingText(doc).includes(EMPTY_FINDING_COPY));
  assert.equal(doc.registry[TRUST_ID].children.length, 0);
});

test("choosing a bundled example reads it, and an unlisted value is refused here", () => {
  const doc = fakeDocument();
  initProviderImport(doc);
  assert.equal(bindProviderImport(doc), true);
  const example = doc.registry[EXAMPLE_ID];
  assert.ok(example.children.length >= 2, "the chooser lists this provider's examples");

  example.value = NO_UNIT_COUNT_EXAMPLE_ID;
  example.dispatch("change");
  assert.equal(doc.registry[FINDING_ID].dataset.metric, "none");
  assert.equal(doc.registry[FINDING_ID].children.length, 3);

  example.value = "bedrock-supported";
  example.dispatch("change");
  assert.equal(doc.registry[FINDING_ID].dataset.metric, "rate");

  example.value = "not-a-bundled-example";
  example.dispatch("change");
  assert.equal(doc.registry[FINDING_ID].dataset.state, "empty");
  assert.ok(findingText(doc).includes(UNKNOWN_EXAMPLE_COPY));
});

test("every bundled example reads to a finding with all three slots", () => {
  for (const entry of NATIVE_IMPORT_EXAMPLES) {
    const doc = fakeDocument();
    assert.equal(renderProviderImport(doc, intakeFor(entry)), true, `${entry.id} failed to render`);
    assert.equal(doc.registry[FINDING_ID].children.length, 3, `${entry.id} lost a slot`);
    assert.ok(doc.registry[TRUST_ID].children.length >= 3, `${entry.id} lost its trust signals`);
  }
});

// This section's own file control and drop target are gone (#958): the reader's
// export has ONE way into the page, and the tests for it are in
// tests/finops-import-drop.test.js. What is left here reads bundled examples,
// and the assertion that it no longer offers a second importer is in that file.

test("changing the provider refills the examples and clears the previous finding", () => {
  const doc = fakeDocument();
  initProviderImport(doc);
  bindProviderImport(doc);
  const example = doc.registry[EXAMPLE_ID];
  example.value = "bedrock-supported";
  example.dispatch("change");
  assert.equal(doc.registry[FINDING_ID].dataset.metric, "rate");

  doc.registry[PROVIDER_ID].value = "vertex-ai";
  doc.registry[PROVIDER_ID].dispatch("change");
  assert.equal(doc.registry[FINDING_ID].dataset.state, "empty");
  assert.equal(doc.registry[TRUST_ID].children.length, 0);
  assert.deepEqual(example.children.map((option) => option.value), ["vertex-ai-supported"]);
});
