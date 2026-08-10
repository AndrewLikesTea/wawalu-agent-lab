// The first screen speaks a reader's vocabulary, and the proof tokens survive (#1554).
//
// WHAT THIS IS FOR. The attestation under the recoverable figure told a CTO the
// number was "Attested finops-recoverable-attestation/1.0.0" and that each of
// its inputs was pinned in a path ending .json. A leader reading that learns
// which code ran; they do not learn what the money was priced from or how sure
// anyone is. So the sentence now says the evidence and the confidence, and the
// two identifiers moved one press down into the disclosure the region already
// ships.
//
// A DEMOTION IS ONLY HONEST IF BOTH HALVES ARE ASSERTED. Half of that is easy
// to fake — deleting the identifiers passes any "no file path in the copy"
// check and leaves a skeptic with nothing to audit. So every assertion below
// comes in pairs: absent from the answer's own sentence, present verbatim in
// the disclosure.
//
// AND THE HARNESS IS NOT ALLOWED TO BE THE PROOF. `textOf` reads straight
// through a shut disclosure, so a page-wide "no fixture path anywhere" check
// would fail on copy that is correct — the demoted identifiers are legitimately
// still on the page. Every forbidden-token assertion is scoped to one node's
// own text, and the reachability of that node is walked through parentNode
// rather than asserted with a descendant selector the harness rejects.
//
// No clock, no network, no sleeps, no randomness.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  EXECUTIVE_VOCABULARY, FORBIDDEN_TOKEN_KINDS, findForbiddenTokens, isReaderSafe,
  readerPhrase, vocabularyEntry,
} from "../src/finops-executive-vocabulary.js";
import { RECOVERABLE_ATTESTATION } from "../src/finops-answer-contract.js";
import { RECOVERABLE_ATTESTATION_ID } from "../src/finops-answer-contract-view.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const doc = () => parseHtml(html);

/** The attestation's own disclosure of record, and the identifiers demoted into it. */
const DISCLOSURE_ID = "finops-recoverable-how-we-know";
const DEMOTED = [
  "tests/fixtures/finops-consolidated-answer-attestation.json",
  RECOVERABLE_ATTESTATION,
];

// ---------------------------------------------------------------------------
// 1. The vocabulary itself.
// ---------------------------------------------------------------------------

test("every internal identifier carries a reader-facing phrase", () => {
  assert.ok(EXECUTIVE_VOCABULARY.length >= 3,
    "the vocabulary covers fewer identifiers than the first screen prints");
  const seen = new Set();
  for (const entry of EXECUTIVE_VOCABULARY) {
    assert.equal(seen.has(entry.identifier), false,
      `${entry.identifier} is mapped twice, so which phrase wins depends on order`);
    seen.add(entry.identifier);
    assert.equal(typeof entry.phrase, "string");
    assert.ok(entry.phrase.trim().length >= 20,
      `${entry.identifier} maps to a phrase too short to say anything`);
    assert.ok(entry.kind && entry.demotedTo,
      `${entry.identifier} does not say what kind of thing it is or where it went`);
    assert.equal(readerPhrase(entry.identifier), entry.phrase);
  }
  // The three the brief names by name.
  for (const identifier of [...DEMOTED, "finops-recoverable-attestation"]) {
    assert.ok(vocabularyEntry(identifier), `${identifier} has no reader-facing phrase`);
  }
});

test("a phrase never smuggles an identifier back in", () => {
  for (const entry of EXECUTIVE_VOCABULARY) {
    assert.deepEqual(findForbiddenTokens(entry.phrase), [],
      `the phrase standing in for ${entry.identifier} carries a forbidden token itself`);
  }
});

test("a version bump resolves to the same phrase rather than falling back to the id", () => {
  // The failure this prevents: someone bumps the contract to /1.1.0, the exact
  // key misses, and the sentence quietly prints the identifier again.
  assert.equal(readerPhrase("finops-recoverable-attestation/9.9.9"),
    readerPhrase(RECOVERABLE_ATTESTATION));
  assert.equal(vocabularyEntry("nothing-here/1.0.0"), null);
  assert.throws(() => readerPhrase("nothing-here/1.0.0"), /no reader-facing phrase/,
    "an unmapped identifier fell back to a raw string instead of failing loudly");
});

// ---------------------------------------------------------------------------
// 2. The matcher, on each forbidden shape and on prose that is fine.
// ---------------------------------------------------------------------------

const OFFENDERS = [
  { kind: "fixture-path", text: "Pinned in tests/fixtures/finops-consolidated-answer.json." },
  { kind: "repository-path", text: "Composed by src/finops-answer-contract.js on load." },
  { kind: "file-name", text: "The numbers come from evolution-demo-data.json." },
  { kind: "contract-version", text: "Attested finops-recoverable-attestation/1.0.0 today." },
  { kind: "contract-id", text: "The finops-recoverable-attestation check passed." },
  { kind: "clause-id", text: "Priced under clause 4.2 of the agreement." },
];

test("the matcher flags every forbidden shape, and names which one", () => {
  for (const { kind, text } of OFFENDERS) {
    const found = findForbiddenTokens(text);
    assert.ok(found.length >= 1, `"${text}" passed the matcher untouched`);
    assert.ok(found.some((hit) => hit.kind === kind),
      `"${text}" was not reported as ${kind}; got ${found.map((hit) => hit.kind).join(", ")}`);
    assert.ok(found.every((hit) => typeof hit.why === "string" && hit.why.length > 20),
      `${kind} is reported with no reason a writer could act on`);
    assert.equal(isReaderSafe(text), false);
  }
  assert.equal(FORBIDDEN_TOKEN_KINDS.length, new Set(OFFENDERS.map((one) => one.kind)).size,
    "a declared shape has no example above, or an example has no declared shape");
});

test("one token can offend more than once, and all of it is reported", () => {
  const found = findForbiddenTokens("See tests/fixtures/finops-consolidated-answer.json.");
  const kinds = new Set(found.map((hit) => hit.kind));
  assert.equal(kinds.has("fixture-path") && kinds.has("repository-path")
    && kinds.has("file-name"), true,
  "a fixture path is three kinds of wrong and the matcher reported fewer");
});

test("the matcher runs clean twice, so a shared regexp cannot skip a caller", () => {
  const text = OFFENDERS[0].text;
  assert.deepEqual(findForbiddenTokens(text), findForbiddenTokens(text));
});

test("ordinary executive prose is left alone", () => {
  const clean = [
    "Recoverable AI spend per month is $51,254, summed over 5 of 5 departments scored.",
    "Priced from the bundled sample of invented invoices, at medium confidence.",
    "Summed for 2026-06-01 to 2026-07-01, with no seasonality adjustment.",
    "Every department carrying a completed FinOps score is in the period-over-period view.",
    "A ceiling at list prices until 2 destination models state contracted rates.",
  ];
  for (const text of clean) {
    assert.deepEqual(findForbiddenTokens(text), [],
      `the matcher flagged ordinary prose: "${text}"`);
    assert.equal(isReaderSafe(text), true);
  }
  assert.equal(findForbiddenTokens(undefined).length, 0, "a missing string threw or flagged");
});

// ---------------------------------------------------------------------------
// 3. The first screen states it in a reader's words.
// ---------------------------------------------------------------------------

test("the attestation is one sentence, and it names the evidence and the confidence", () => {
  const text = textOf(doc().getElementById(RECOVERABLE_ATTESTATION_ID)).trim();
  assert.equal((text.match(/\./g) ?? []).length, 1,
    `the attestation is more than one sentence: "${text}"`);
  assert.ok(text.endsWith("."), "the attestation does not end as a sentence");
  assert.match(text, /invoices/,
    "the sentence does not say what the figure is priced from");
  assert.match(text, /confidence in it is \w+/,
    "the sentence does not say how sure we are, in words");
  assert.match(text, /How we know this/,
    "the sentence does not say where the exact sources are");
});

test("the attestation's own text produces no forbidden tokens", () => {
  // Scoped to this node. A page-wide check would fail on correct copy, because
  // `textOf` reads through the shut disclosure the identifiers moved into.
  const text = textOf(doc().getElementById(RECOVERABLE_ATTESTATION_ID));
  assert.deepEqual(findForbiddenTokens(text), [],
    "the answer's own sentence is back to printing internal identifiers");
});

// ---------------------------------------------------------------------------
// 4. Demoted, not deleted.
// ---------------------------------------------------------------------------

test("every demoted identifier is still readable inside the audit disclosure", () => {
  const document = doc();
  const disclosure = document.getElementById(DISCLOSURE_ID);
  assert.ok(disclosure, "the audit disclosure the identifiers were demoted into is gone");
  assert.equal(disclosure.tagName, "DETAILS");
  assert.equal(disclosure.hasAttribute("open"), false,
    "the disclosure ships open, so the proof arrives as a disclaimer again");
  const text = textOf(disclosure);
  for (const identifier of DEMOTED) {
    assert.ok(text.includes(identifier),
      `${identifier} was deleted rather than demoted; a skeptic cannot get from the `
      + "figure to the file that pins it");
  }
});

test("the disclosure holding them is inside the answer it qualifies, not a second one", () => {
  // parentNode walk: the harness rejects "details #id"-style descendant selectors.
  const document = doc();
  let inRegion = false;
  for (let up = document.getElementById(DISCLOSURE_ID); up; up = up.parentNode) {
    if (up.id === "finops-recoverable-answer") inRegion = true;
  }
  assert.equal(inRegion, true, "the identifiers went into a disclosure outside the answer");
  assert.equal(document.querySelectorAll("details.how-we-know").length, 3,
    "a second audit disclosure was created instead of extending the one that exists");
});

test("no focusable was added above the first-run region", () => {
  const region = doc().getElementById("finops-recoverable-answer");
  const counts = {};
  for (const selector of ["a", "button", "input", "select", "textarea", "summary"]) {
    counts[selector] = region.querySelectorAll(selector).length;
  }
  assert.deepEqual(counts,
    { a: 2, button: 0, input: 0, select: 0, textarea: 0, summary: 2 },
    "the answer region's tab stops moved; this screen has no spare one");
  assert.equal(region.querySelectorAll("[tabindex]").length, 0,
    "something in the answer region was given a tabindex of its own");
});
