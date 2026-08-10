// The first screen's reader vocabulary, and the guard that keeps it (#1554).
//
// WHAT THIS FILE IS FOR. A CTO who has never opened this repository reads the
// attestation under the $51,254 and must learn two things in words they can
// repeat: what the figure is priced from, and how sure the product is about it.
// The old sentence answered neither — it opened with a version string and
// closed with a fixture path. So the checks below are in three groups:
//
//   1. The definitions. Every band boundary from both sides, the whole input
//      domain covered, one named phrase for a confidence that is not
//      established, a passing and a failing example for every forbidden shape,
//      and a lookup miss that throws rather than passing an identifier through.
//   2. The module is on the render path — the sentence the page states is the
//      sentence this module composes, not merely a sentence it could compose.
//   3. Demotion, not deletion — every identifier the sentence stopped printing
//      is still findable in the audit disclosure, named one at a time.
//
// Nothing here reads a clock, a network or a random source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { CONFIDENCE_THRESHOLD, recoverableAttestation } from "../src/finops-answer-contract.js";
import { RECOVERABLE_ATTESTATION_ID } from "../src/finops-answer-contract-view.js";
import {
  CONFIDENCE_BANDS, CONFIDENCE_NOT_ESTABLISHED, DEMOTED_IDENTIFIERS, EVIDENCE_SOURCE_PHRASE,
  FORBIDDEN_TOKEN_SHAPES, READER_PHRASES, attestationSentence, confidencePhrase, forbiddenTokens,
  readerPhrase,
} from "../src/finops-executive-vocabulary.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const attestation = recoverableAttestation(loadExampleDataset());

const phraseFor = (band) => CONFIDENCE_BANDS.find((entry) => entry.band === band).phrase;

// ---------------------------------------------------------------------------
// 1. The definitions.
// ---------------------------------------------------------------------------

test("the bands are the confidence cut points the analysis already publishes", () => {
  // The module carries no import, so it restates the cut points as its own data.
  // This is the assertion that stops the two copies drifting.
  assert.equal(phraseFor("high"), confidencePhrase(CONFIDENCE_THRESHOLD.high));
  assert.equal(phraseFor("medium"), confidencePhrase(CONFIDENCE_THRESHOLD.medium));
  assert.equal(phraseFor("low"), confidencePhrase(CONFIDENCE_THRESHOLD.medium - 1));
  assert.equal(CONFIDENCE_BANDS.find((entry) => entry.band === "high").min,
    CONFIDENCE_THRESHOLD.high);
  assert.equal(CONFIDENCE_BANDS.find((entry) => entry.band === "medium").min,
    CONFIDENCE_THRESHOLD.medium);
});

test("the bands tile the whole 0-100 domain with no gap and no overlap", () => {
  for (let value = 0; value <= 100; value += 1) {
    const matched = CONFIDENCE_BANDS.filter((entry) =>
      value >= entry.min && (entry.maxInclusive ? value <= entry.max : value < entry.max));
    assert.equal(matched.length, 1, `${value} lands in ${matched.length} bands, not exactly one`);
    assert.equal(confidencePhrase(value), matched[0].phrase);
  }
});

test("every band boundary reads the same from both sides", () => {
  // Each pair is (just below the edge, at the edge). The edge belongs to the
  // band above it, because every band is closed at its bottom.
  assert.equal(confidencePhrase(74.999), phraseFor("medium"));
  assert.equal(confidencePhrase(75), phraseFor("high"));
  assert.equal(confidencePhrase(49.999), phraseFor("low"));
  assert.equal(confidencePhrase(50), phraseFor("medium"));
  // The two ends of the domain are in the domain.
  assert.equal(confidencePhrase(0), phraseFor("low"));
  assert.equal(confidencePhrase(100), phraseFor("high"));
});

test("a missing or unreadable confidence says so, and never lands in the top band", () => {
  const notEstablished = [
    null, undefined, Number.NaN, Infinity, -Infinity, -0.001, 100.001, 101, -1,
    "", "  ", "not graded", "unknown", "HIGHISH", {}, [], true,
  ];
  for (const input of notEstablished) {
    assert.equal(confidencePhrase(input), CONFIDENCE_NOT_ESTABLISHED,
      `${JSON.stringify(String(input))} did not read as an unestablished confidence`);
  }
  assert.notEqual(CONFIDENCE_NOT_ESTABLISHED, phraseFor("high"));
  // The level words the analysis already publishes map to the same band phrases,
  // so a word input and a numeric input cannot describe the figure differently.
  assert.equal(confidencePhrase("medium"), confidencePhrase(60));
  assert.equal(confidencePhrase(" High "), confidencePhrase(90));
  assert.equal(confidencePhrase("low"), confidencePhrase(10));
});

test("every forbidden token shape has a passing and a failing example", () => {
  // A shape with no example that trips it is a shape that guards nothing. Every
  // example on the left is an identifier this repository actually prints.
  const examples = new Map([
    ["repository-relative path", ["read from src/finops-answer-contract.js today", "the source of record"]],
    ["test fixture path", ["pinned in tests/fixtures/finops-consolidated-answer-attestation.json", "pinned in the audit note"]],
    ["file extension", ["see evolution.html for it", "see the evolution page for it"]],
    ["contract id", ["finops-recoverable-spend/1.0.0 states it", "the recoverable-spend figure states it"]],
    ["rubric or version string", ["prompt-literacy-rubric/2.1.0 graded it", "the literacy rubric graded it"]],
    ["clause or state code", ["promoted by ready_to_commit", "promoted because it is ready to commit"]],
  ]);
  assert.equal(examples.size, FORBIDDEN_TOKEN_SHAPES.length,
    "a forbidden shape was added or removed without an example pair beside it");
  for (const shape of FORBIDDEN_TOKEN_SHAPES) {
    const pair = examples.get(shape.name);
    assert.ok(pair, `no example pair for the "${shape.name}" shape`);
    const [leaks, clean] = pair;
    assert.equal(shape.pattern.test(leaks), true,
      `the "${shape.name}" shape did not catch ${JSON.stringify(leaks)}`);
    assert.equal(shape.pattern.test(clean), false,
      `the "${shape.name}" shape fired on the reader phrasing ${JSON.stringify(clean)}`);
    assert.equal(typeof shape.name, "string");
    assert.equal(shape.pattern.global, false, "a global pattern carries state between runs");
  }
});

test("forbiddenTokens names the kind of identifier that leaked", () => {
  const hits = forbiddenTokens("Attested finops-recoverable-attestation/1.0.0 — see"
    + " tests/fixtures/finops-consolidated-answer-attestation.json");
  const names = hits.map((hit) => hit.name);
  for (const expected of ["contract id", "test fixture path", "file extension"]) {
    assert.ok(names.includes(expected), `a leaked ${expected} was not reported`);
  }
  assert.deepEqual(forbiddenTokens("Priced from the bundled synthetic example."), []);
  assert.deepEqual(forbiddenTokens(null), [], "a non-string subject must not throw");
});

test("a phrase lookup miss throws instead of passing the identifier through", () => {
  for (const entry of READER_PHRASES) {
    assert.equal(readerPhrase(entry.id), entry.phrase);
    assert.deepEqual(forbiddenTokens(entry.phrase), [],
      `the replacement phrase for "${entry.id}" is itself an identifier`);
  }
  assert.throws(() => readerPhrase("finops-not-a-real-contract/9.9.9"), /no reader phrase/);
  assert.throws(() => readerPhrase(undefined), /no reader phrase/);
});

// ---------------------------------------------------------------------------
// 2. The module is on the render path.
// ---------------------------------------------------------------------------

test("the sentence the page states is the one this module composes", () => {
  // Not "the module is importable": the served bytes, the contract's record and
  // this module's composer must all be the same string.
  const composed = attestationSentence(attestation.dimensions);
  assert.equal(attestation.statement, composed,
    "the attestation composes its sentence somewhere other than the vocabulary module");
  const document = parseHtml(html);
  assert.equal(textOf(document.getElementById(RECOVERABLE_ATTESTATION_ID)), composed,
    "the served first screen states a sentence the vocabulary module did not write");
});

test("the visible sentence answers what the figure is priced from, and how sure", () => {
  const document = parseHtml(html);
  const visible = textOf(document.getElementById(RECOVERABLE_ATTESTATION_ID));
  assert.ok(visible.includes(EVIDENCE_SOURCE_PHRASE),
    "the sentence does not name what the figure is priced from");
  assert.ok(visible.includes(confidencePhrase(attestation.dimensions.confidence)),
    "the sentence does not say how sure the product is, in words");
  assert.equal(visible.split(". ").length, 1, "the attestation is more than one sentence");
});

test("no forbidden token shape appears in the visible first-screen attestation", () => {
  // This iterates the module's OWN list, so adding a shape there tightens this
  // guard without anyone remembering to edit this file.
  const document = parseHtml(html);
  const visible = textOf(document.getElementById(RECOVERABLE_ATTESTATION_ID));
  for (const subject of [visible, attestation.statement, EVIDENCE_SOURCE_PHRASE]) {
    assert.deepEqual(forbiddenTokens(subject), [],
      `an internal identifier is printed at a reader in: ${subject}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Demotion, not deletion.
// ---------------------------------------------------------------------------

test("every identifier the sentence stopped printing is still in the audit disclosure", () => {
  // Named one at a time so a failure says WHICH identifier was dropped rather
  // than that "something" is missing. The disclosure is the one already beside
  // the figure; nothing was added to the first screen to hold these.
  const document = parseHtml(html);
  const disclosure = textOf(document.getElementById("finops-recoverable-how-we-know"));
  assert.ok(DEMOTED_IDENTIFIERS.length >= 3, "the demoted list collapsed");
  for (const id of DEMOTED_IDENTIFIERS) {
    assert.ok(disclosure.includes(id),
      `"${id}" left the visible sentence and is in no audit disclosure — that is a deletion`);
  }
  // And they are genuinely gone from the sentence, so this is a move.
  const visible = textOf(document.getElementById(RECOVERABLE_ATTESTATION_ID));
  for (const id of DEMOTED_IDENTIFIERS) {
    assert.equal(visible.includes(id), false, `"${id}" is still printed at a reader`);
  }
});

test("the demoted identifiers are the ones the old sentence actually printed", () => {
  // The list is a review decision, not a wish: each entry must be a string this
  // repository really produces, so the guard cannot be satisfied by inventing
  // identifiers nobody prints.
  for (const id of DEMOTED_IDENTIFIERS) {
    assert.ok(forbiddenTokens(id).length > 0,
      `"${id}" is on the demoted list but matches no forbidden shape, so it is not an identifier`);
  }
});
