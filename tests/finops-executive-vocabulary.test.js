// The first screen speaks a reader's language, not this repository's (#1554).
//
// WHAT THESE ASSERTIONS ARE FOR. The first screen of /evolution.html answers one
// executive question: what is the recoverable figure priced from, and how sure
// are we? It was answering it in the vocabulary of the code that computes it —
// a contract version, a fixture path, "declared" and "derived" as terms of art —
// so the sentence was traceable and unrepeatable. A CTO who has never opened
// this repository could not carry it into a meeting.
//
// The fix demotes rather than deletes: every identifier is still on the page, in
// the disclosure the region already carries and on the slot's data attributes.
// That is exactly the kind of change that decays — the next edit reaches for the
// precise internal name because it is precise. So the ban is machine-checkable
// and the sentence is held to the module's OWN predicate, in both places the
// sentence exists:
//
//   1. THE SERVED BYTES. The authored sentence in src/evolution.html, which is
//      what a reader gets before any script runs.
//   2. THE PAINT. What `renderRecoverableAttestation` writes into the same slot.
//
// AND THE DEMOTION IS ASSERTED, not assumed: what left the sentence has to be
// findable in the existing "How we know this" disclosure, or the change traded
// a traceable sentence for an untraceable one.
//
// The forbidden shapes themselves are asserted against known-bad examples too,
// because a matcher that matches nothing would pass every test above.
//
// No clock, no network, no sleeps, no randomness.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { recoverableAttestation } from "../src/finops-answer-contract.js";
import {
  RECOVERABLE_ATTESTATION_ID, renderRecoverableAttestation,
} from "../src/finops-answer-contract-view.js";
import {
  FORBIDDEN_TOKEN_SHAPES, READER_PHRASING, forbiddenTokensIn, isReaderFacing, readerPhraseFor,
} from "../src/finops-executive-vocabulary.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

const attestation = recoverableAttestation(loadExampleDataset());

/** The disclosure the demoted identifiers were moved into. */
const HOW_WE_KNOW_ID = "finops-recoverable-how-we-know";

const report = (copy) => forbiddenTokensIn(copy)
  .map((hit) => `${hit.id} forbids ${hit.forbids}, and the copy says "${hit.match}"`)
  .join("; ");

// ---------------------------------------------------------------------------
// 1. The sentence a reader actually gets.
// ---------------------------------------------------------------------------

test("the served first-screen attestation copy carries no internal identifier", () => {
  const document = parseHtml(html);
  const node = document.getElementById(RECOVERABLE_ATTESTATION_ID);
  assert.ok(node, "the served page carries no attestation slot");
  const copy = textOf(node);
  assert.equal(isReaderFacing(copy), true,
    `the first screen states an identifier a reader cannot resolve: ${report(copy)}`);
});

test("the painted attestation copy carries no internal identifier either", () => {
  const document = parseHtml(html);
  const node = renderRecoverableAttestation(document, attestation);
  assert.ok(node, "the paint found no slot to write into");
  const copy = textOf(node);
  assert.equal(isReaderFacing(copy), true,
    `the paint puts an identifier back on the first screen: ${report(copy)}`);
  assert.equal(isReaderFacing(attestation.statement), true,
    `the composed statement carries an identifier: ${report(attestation.statement)}`);
});

test("the sentence answers the question it exists for: priced from what, how sure", () => {
  // Not a copy pin — those live in the attestation fixture. This is the pair of
  // claims the sentence is not allowed to stop making, in whatever words.
  const copy = textOf(parseHtml(html).getElementById(RECOVERABLE_ATTESTATION_ID));
  assert.match(copy, /priced from/i,
    "the sentence no longer says what the figure is priced from");
  assert.match(copy, /\b(?:high|medium|low|ungraded) confidence\b/i,
    "the sentence no longer says how sure we are, in a word a reader can act on");
});

// ---------------------------------------------------------------------------
// 2. Demoted, not deleted.
// ---------------------------------------------------------------------------

test("every identifier the sentence dropped is readable in the existing disclosure", () => {
  const document = parseHtml(html);
  const disclosure = document.getElementById(HOW_WE_KNOW_ID);
  assert.ok(disclosure, "the audit disclosure the identifiers were demoted into is gone");
  const detail = textOf(disclosure);
  for (const identifier of [
    "finops-recoverable-attestation/1.0.0",
    "tests/fixtures/finops-consolidated-answer-attestation.json",
    "src/finops-answer-contract.js",
  ]) {
    assert.ok(detail.includes(identifier),
      `${identifier} left the sentence and is not stated in the disclosure either, so the `
      + "walk from the sentence to the fixture and the clause is broken");
  }
  // A second disclosure was NOT opened for this: the count the shipped pattern
  // is held to elsewhere is three, and this is one of those three.
  assert.equal(disclosure.tagName, "DETAILS");
});

test("the attested values still travel on the slot, so nothing became unauditable", () => {
  const node = parseHtml(html).getElementById(RECOVERABLE_ATTESTATION_ID);
  for (const attribute of ["data-version", "data-headline", "data-confidence",
    "data-declared", "data-derived", "data-scored", "data-in-scope"]) {
    const value = node.getAttribute(attribute);
    assert.ok(value && value.length > 0, `${attribute} was dropped with the words`);
  }
});

// ---------------------------------------------------------------------------
// 3. The matchers are real matchers.
// ---------------------------------------------------------------------------

test("each forbidden shape catches the thing it names", () => {
  const cases = {
    "fixture-path": "pinned in tests/fixtures/finops-consolidated-answer-attestation.json",
    "repository-path": "authored in src/finops-answer-contract.js",
    "file-extension": "see the attestation.json beside it",
    "version-string": "Attested finops-recoverable-attestation/1.0.0",
    "contract-id": "the finops-recoverable-attestation record",
    "clause-id": "promoted by unchecked_basis",
  };
  const ids = FORBIDDEN_TOKEN_SHAPES.map((shape) => shape.id);
  assert.deepEqual(ids.slice().sort(), Object.keys(cases).sort(),
    "a shape was added or dropped without a known-bad example beside it");
  for (const [id, copy] of Object.entries(cases)) {
    const hits = forbiddenTokensIn(copy).map((hit) => hit.id);
    assert.ok(hits.includes(id), `${id} does not catch "${copy}"`);
  }
});

test("plain English is not flagged", () => {
  for (const copy of [
    "Medium confidence — enough to plan against, not yet enough to bill against.",
    "Priced from the bundled example export's own usage records.",
    "A list-price ceiling, not a committed-use saving.",
    "The How we know this note above names the pinned evidence file.",
  ]) {
    assert.equal(isReaderFacing(copy), true, `the ban flags ordinary prose: ${report(copy)}`);
  }
});

test("the phrasing table is frozen, total, and reachable through the lookup", () => {
  assert.equal(Object.isFrozen(READER_PHRASING), true);
  assert.equal(Object.isFrozen(FORBIDDEN_TOKEN_SHAPES), true);
  for (const [identifier, phrase] of Object.entries(READER_PHRASING)) {
    assert.equal(typeof phrase, "string");
    assert.ok(phrase.trim().length > 0, `${identifier} maps to nothing`);
    assert.equal(readerPhraseFor(identifier), phrase);
  }
  // A version bump resolves rather than silently falling back to the id.
  assert.equal(readerPhraseFor("finops-recoverable-attestation/9.9.9"),
    READER_PHRASING["finops-recoverable-attestation"]);
  for (const absent of [null, undefined, 42, "", "   ", "no-such-identifier"]) {
    assert.equal(readerPhraseFor(absent), null);
  }
  assert.deepEqual(forbiddenTokensIn(null), []);
});
