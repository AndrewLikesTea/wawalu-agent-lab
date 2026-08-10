// The consolidated FinOps answer is still the answer the arithmetic produces (#1499).
//
// WHAT THESE ASSERTIONS ARE FOR. #1502, #1503 and #1504 shortened
// /evolution.html hard — two conflicting recoverable figures became one, seven
// regions became one answer with a supporting layer. Every one of those was a
// rewrite of the words around a number, and a rewrite is exactly when a number
// quietly stops meaning what it meant. A director whose team the figure
// implicates will ask what the consolidation cost. The only answer that survives
// that conversation is a pinned fixture and a check that names what moved.
//
// So four dimensions are compared, three ways, and ALL FOUR ARE ALWAYS REPORTED:
//
//   1. THE FIXTURE AGAINST THE COMPUTATION. Every pinned value in
//      tests/fixtures/finops-consolidated-answer-attestation.json against what
//      `recoverableAttestation` computes from the bundled dataset, with a
//      message naming which dimension drifted and both readings of it.
//   2. THE FIXTURE AGAINST THE SERVED PAGE. The same four, read out of the
//      authored markup, so a page that was edited away from the module fails
//      here rather than in a browser.
//   3. THE FIXTURE AGAINST THE PAINT. `renderRecoverableAttestation` over the
//      served document, so the bytes a reader gets and the bytes a script writes
//      cannot state two different things.
//
// AND THE HARNESS IS NOT ALLOWED TO BE THE PROOF. `textOf` reads straight
// through a shut details element, so a statement folded into one would pass
// every assertion above and be invisible to a reader. The reachability check
// walks parentNode and fails if any ancestor is a disclosure.
//
// EVERY VALUE HAS ITS ASSUMPTION. A pinned number with no assumption beside it
// is a number nobody can dispute on its merits, so the fixture's shape is
// asserted too.
//
// No clock, no network, no sleeps, no randomness.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import {
  ATTESTATION_ORIGIN, RECOVERABLE_ATTESTATION, attestationOperands, getRecoverableSpend,
  recoverableAttestation,
} from "../src/finops-answer-contract.js";
import {
  RECOVERABLE_ATTESTATION_ID, renderRecoverableAttestation,
} from "../src/finops-answer-contract-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const FIXTURE = new URL("./fixtures/finops-consolidated-answer-attestation.json", import.meta.url);

const html = await readFile(PAGE, "utf8");
const fixture = JSON.parse(await readFile(FIXTURE, "utf8"));

const attestation = recoverableAttestation(loadExampleDataset());

/** The four dimensions of one reading, flattened to comparable scalars. */
const dimensionsOf = (source) => ({
  headline: source.headline,
  confidence: source.confidence,
  provenance: `declared=${source.provenance.declared} derived=${source.provenance.derived}`,
  coverage: `scored=${source.coverage.scored} inScope=${source.coverage.inScope}`,
});

/** The four as the fixture pins them. */
const pinned = dimensionsOf({
  headline: fixture.dimensions.headline.value,
  confidence: fixture.dimensions.confidence.value,
  provenance: fixture.dimensions.provenance.value,
  coverage: fixture.dimensions.coverage.value,
});

/**
 * Compare all four and report EVERY dimension that moved.
 *
 * A generic "the page does not match the fixture" tells a reader to go and diff
 * two files by hand, and stopping at the first difference hides the other three
 * behind a re-run each. So each drift is one line naming the dimension, what the
 * fixture pins, and what the other side actually reads.
 */
function assertNoDrift(label, actual) {
  const drifts = [];
  for (const key of Object.keys(pinned)) {
    if (actual[key] !== pinned[key]) {
      drifts.push(`${key} drifted: fixture ${pinned[key]}, ${label} ${actual[key]}`);
    }
  }
  assert.deepEqual(drifts, [], `${drifts.length} of 4 attested dimensions moved against `
    + `tests/fixtures/finops-consolidated-answer-attestation.json:\n  ${drifts.join("\n  ")}\n`
    + "Re-run the regeneration command in that fixture, and say in the PR body which dimension "
    + "moved and why the new value is the true one.");
}

// ---------------------------------------------------------------------------
// 1. The fixture against the computation.
// ---------------------------------------------------------------------------

test("the pinned four are what the bundled analysis still computes", () => {
  assertNoDrift("computed", dimensionsOf(attestation.dimensions));
  assert.equal(attestation.version, fixture.attestationVersion,
    "the module's contract version moved without the fixture's attestationVersion moving");
});

test("each drifting dimension is named, and every one of the four is reported", () => {
  // The check must bite on its own. A moved headline, a moved band, a moved
  // split and a moved coverage at once must produce four named lines, not one.
  const drifts = [];
  const moved = { headline: "$1", confidence: "low", provenance: "declared=1 derived=1",
    coverage: "scored=1 inScope=9" };
  for (const key of Object.keys(pinned)) {
    if (moved[key] !== pinned[key]) drifts.push(`${key} drifted: fixture ${pinned[key]}`);
  }
  assert.equal(drifts.length, 4, "a comparison that stops at the first difference hides three");
  assert.throws(() => assertNoDrift("computed", moved), (error) => {
    for (const key of ["headline", "confidence", "provenance", "coverage"]) {
      assert.ok(error.message.includes(`${key} drifted:`),
        `the failure message does not name ${key}`);
    }
    assert.ok(error.message.includes("declared=5 derived=2"),
      "the failure message does not carry the fixture's own reading");
    assert.ok(error.message.includes("declared=1 derived=1"),
      "the failure message does not carry the drifted reading");
    return true;
  });
});

test("the provenance split is checked against the envelope, not labelled", () => {
  const dataset = loadExampleDataset();
  const operands = attestationOperands(dataset, getRecoverableSpend(dataset));
  assert.deepEqual(operands.map((operand) => ({ key: operand.key, origin: operand.origin,
    value: operand.value })), fixture.operands,
  "the operand table moved: the two provenance counts above are a sum of these rows");
  const declared = operands.filter((one) => one.origin === ATTESTATION_ORIGIN.declared);
  assert.equal(declared.length, fixture.dimensions.provenance.value.declared);
  for (const operand of declared) {
    assert.equal(operand.stated, operand.value,
      `${operand.key} is counted as declared but the envelope does not state that value`);
  }
});

test("a value the envelope stops stating becomes derived, and the split moves", () => {
  // The reconciliation #1502 landed, measured: the headline is declared only
  // while the envelope's own total and the sum over scored rows agree.
  const dataset = loadExampleDataset();
  const disagreeing = { ...dataset, recoverableUsd: dataset.recoverableUsd + 1000 };
  const moved = recoverableAttestation(disagreeing);
  assert.equal(moved.dimensions.provenance.declared,
    fixture.dimensions.provenance.value.declared - 1,
    "an envelope total that no longer matches the departments still counted as declared");
  assert.equal(moved.dimensions.provenance.derived,
    fixture.dimensions.provenance.value.derived + 1);
  assert.equal(moved.dimensions.headline, fixture.dimensions.headline.value,
    "the headline is summed from the departments and must not follow the envelope's total");
});

test("coverage moves when a department stops carrying a completed score", () => {
  const dataset = loadExampleDataset();
  const rows = dataset.rankedDepartments.map((row, index) =>
    (index === 0 ? { ...row, scored: false } : row));
  const moved = recoverableAttestation({ ...dataset, rankedDepartments: rows });
  assert.equal(moved.dimensions.coverage.scored, fixture.dimensions.coverage.value.scored - 1);
  assert.equal(moved.dimensions.coverage.inScope, fixture.dimensions.coverage.value.inScope);
  assert.notEqual(moved.dimensions.headline, fixture.dimensions.headline.value,
    "dropping a scored department left the headline unchanged, so it is not summed from them");
});

// ---------------------------------------------------------------------------
// 2. The fixture against the served page.
// ---------------------------------------------------------------------------

/**
 * The four, read off the authored markup's own attributes and text.
 *
 * The headline comes from `data-headline` rather than from the sentence on
 * purpose: this region states its one recoverable figure once and its projection
 * once, so the attestation carries the money for the check without painting a
 * third dollar string beside the answer.
 */
function pageDimensions(node, text) {
  const headline = node.getAttribute("data-headline") ?? "absent";
  // The band is still read out of the SENTENCE, not out of `data-confidence`:
  // the point of this check is that the words a reader sees and the record the
  // page computed agree. Since #1554 the band is said as a leading clause —
  // "Medium confidence — enough to plan against" — rather than as the term of
  // art "confidence medium ·", so the shape moved and the source did not.
  const confidence = /\b(\w+) confidence\b/.exec(text)?.[1]?.toLowerCase() ?? "absent";
  return {
    headline,
    confidence,
    provenance: `declared=${node.getAttribute("data-declared")}`
      + ` derived=${node.getAttribute("data-derived")}`,
    coverage: `scored=${node.getAttribute("data-scored")}`
      + ` inScope=${node.getAttribute("data-in-scope")}`,
  };
}

test("the served page states the pinned four, in text and in attributes", () => {
  const document = parseHtml(html);
  const node = document.getElementById(RECOVERABLE_ATTESTATION_ID);
  assert.ok(node, "the served page carries no attestation slot");
  const text = textOf(node);
  assertNoDrift("served page", pageDimensions(node, text));
  assert.equal(text, fixture.statement,
    "the authored sentence and the fixture's `statement` disagree; the page holds no number of "
    + "its own, so regenerate the page from the fixture's command rather than editing the bytes");
  assert.equal(node.getAttribute("data-version"), RECOVERABLE_ATTESTATION);
});

test("the attestation does not restate the money the region already states once", () => {
  // The rule tests/evolution.test.js enforces over the whole answer region, kept
  // here at the source so a later edit that pours the headline back into this
  // sentence fails in the file that would have made the mistake. A third dollar
  // string under #finops-recoverable-answer is the competing figure #1496 and
  // #1502 removed.
  const document = parseHtml(html);
  const node = document.getElementById(RECOVERABLE_ATTESTATION_ID);
  for (const text of [textOf(node), attestation.statement]) {
    assert.equal(/\$[\d,]+/.test(text), false,
      "the attestation restated a money figure the answer region already states once");
  }
  assert.equal(node.getAttribute("data-headline"), fixture.dimensions.headline.value,
    "the headline it attests to must still travel with it, as an attribute");
});

test("the statement is reachable, not folded into a shut disclosure", () => {
  // textOf reads straight through a closed details element, so every assertion
  // above would pass on a statement no reader can see. This is the one that
  // would not.
  const document = parseHtml(html);
  let inGroup = false;
  for (let up = document.getElementById(RECOVERABLE_ATTESTATION_ID); up; up = up.parentNode) {
    assert.notEqual(up.tagName, "DETAILS",
      "the attestation was folded into a disclosure, where a harness reads it and a reader cannot");
    if (up.id === "finops-answer-support") inGroup = true;
  }
  assert.equal(inGroup, true,
    "the attestation left the answer's supporting-detail layer");
  // Not focusable: the first screen has no spare tab stop, and a sentence is not
  // a control.
  const node = document.getElementById(RECOVERABLE_ATTESTATION_ID);
  assert.equal(node.getAttribute("tabindex"), null);
  assert.equal(node.tagName, "P");
});

// ---------------------------------------------------------------------------
// 3. The fixture against the paint.
// ---------------------------------------------------------------------------

test("the paint writes the same four the served bytes already carry", () => {
  const document = parseHtml(html);
  const node = renderRecoverableAttestation(document, attestation);
  assert.ok(node, "the paint found no slot to write into");
  assertNoDrift("paint", pageDimensions(node, textOf(node)));
  assert.equal(textOf(node), fixture.statement,
    "the paint and the served bytes state two different attestations");
  assert.equal(node.dataset.attested, "true");
});

test("a page with no analysis says so rather than restating a stale attestation", () => {
  const document = parseHtml(html);
  const node = renderRecoverableAttestation(document, null);
  assert.equal(node.dataset.attested, "false");
  assert.ok(textOf(node).includes("no consolidated answer to attest"),
    "a failed analysis left the previous attestation standing under it");
});

test("a document without the slot is left alone rather than throwing", () => {
  assert.equal(renderRecoverableAttestation({ getElementById: () => null }, attestation), null);
});

// ---------------------------------------------------------------------------
// 4. The fixture's own shape: no number without its assumption.
// ---------------------------------------------------------------------------

test("every pinned dimension carries a stated assumption", () => {
  for (const key of ["headline", "confidence", "provenance", "coverage"]) {
    const entry = fixture.dimensions[key];
    assert.ok(entry, `the fixture stopped pinning ${key}`);
    assert.equal(typeof entry.assumption, "string");
    assert.ok(entry.assumption.trim().length >= 80,
      `${key} carries a value with no assumption a director could dispute`);
  }
});

test("the fixture is version-stamped, and stamped with a version rather than an instant", () => {
  assert.match(fixture.fixtureVersion, /^finops-consolidated-answer-attestation\/\d+\.\d+\.\d+$/);
  assert.match(fixture.attestationVersion, /^finops-recoverable-attestation\/\d+\.\d+\.\d+$/);
  const raw = JSON.stringify(fixture);
  assert.equal(/\d{4}-\d{2}-\d{2}T/.test(raw), false,
    "a timestamp in the stamp makes a re-run that changed nothing look like a change");
  assert.equal(/\b[0-9a-f]{40}\b/.test(raw), false, "a git sha is not a fixture version");
  assert.ok(fixture.regenerate.includes("--input-type=module"),
    "the fixture does not say how to regenerate itself");
});

test("regenerating twice from the same dataset reproduces byte-identical values", () => {
  const first = recoverableAttestation(loadExampleDataset());
  const second = recoverableAttestation(loadExampleDataset());
  assert.deepEqual(JSON.parse(JSON.stringify(second.dimensions)),
    JSON.parse(JSON.stringify(first.dimensions)));
  assert.equal(second.statement, first.statement);
});
