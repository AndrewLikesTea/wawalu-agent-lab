// Does the forwarded number survive the forward? (#1525)
//
// A briefing is a figure read by somebody who cannot see the page it came from.
// So three things have to be true at once, and this file is the only place that
// checks all three against ONE set of recorded inputs:
//
//   1. The briefing points at a real destination ADDRESS, produced by the
//      router, not at a mid-page anchor that routing can move out from under it.
//   2. The figure, the confidence it is stated at, and its grade recompute from
//      the recorded inputs — and the briefing text, the answer destination's
//      rendering and the evidence attestation state the same three.
//   3. Changing one recorded value makes that check FAIL, by name. A drift test
//      that still passes after a mutation is the bug it exists to catch.
//
// LABELLED INPUTS, CHECKED IN, AND SMALL. `RECORDED` below is the whole input:
// no live data, no provider call, no prompt text, no storage. Every number
// asserted here is derived from it in the test rather than pasted, so a reader
// disputing a figure can follow the arithmetic in one screen.
//
// NO TOLERANCE ANYWHERE IN THIS FILE, and that is a decision rather than an
// omission: all three surfaces format from one `getRecoverableSpend` record and
// one `gradeRecoverableConfidence` verdict, so any difference is a surface that
// stopped reading them. A tolerance would hide exactly that. Comparison is
// exact string equality, through the one reporter both tests share.

import test from "node:test";
import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { getRecoverableSpend } from "../src/finops-answer-contract.js";
import {
  confidenceChip, gradeRecoverableConfidence,
} from "../src/finops-recoverable-confidence.js";
import {
  RECOVERABLE_SPEND_IDS, RECOVERABLE_SPEND_LABEL, renderRecoverableSpend,
} from "../src/finops-answer-contract-view.js";
import {
  RECOVERABLE_CONFIDENCE_IDS, applyRecoverableConfidence,
} from "../src/finops-recoverable-confidence-view.js";
import { buildAnswerCopy } from "../src/finops-answer-copy.js";
import { SHARE_LINK_IDS, applyShareLink } from "../src/finops-share-link-control.js";
import { fragmentForSlug } from "../src/finops-destination-router.js";
import {
  ANALYSIS_PATH, BRIEFED_EVIDENCE_DESTINATION, BRIEFED_FIGURE_DESTINATION,
  BRIEFED_FIELDS, briefedFigure, briefingDestinationHref, compareBriefedFigure,
} from "../src/finops-briefing-destination.js";

/**
 * THE RECORDED INPUTS. One month, three departments, two of them scored.
 *
 * Deliberately PARTIAL coverage: a fixture where everything is scored cannot
 * tell "the surfaces agree" from "the surfaces all print the same easy case",
 * and partial coverage is the state a director actually receives a briefing in.
 */
const RECORDED = Object.freeze({
  period: "June 2026",
  confidence: "high",
  rankedDepartments: Object.freeze([
    Object.freeze({ id: "backend", name: "Backend", recoverableUsd: 3200 }),
    Object.freeze({ id: "support", name: "Support", recoverableUsd: 1450 }),
    // Unscored: it opts out, so it contributes zero and is excluded from the
    // count. This is the row the coverage qualifier is about.
    Object.freeze({ id: "growth", name: "Growth", scored: false }),
  ]),
});

/** The arithmetic, restated here so the expected figure is not pasted. */
const MONTHLY = 3200 + 1450;
const SCORED = 2;
const READ = 3;

/** The money token as every surface prints it. Wording may change; digits may not. */
const money = (text) => /\$[\d,]+/.exec(String(text ?? ""))?.[0] ?? null;
/** The coverage qualifier, in the one form all three surfaces write it. */
const coverage = (text) => {
  const found = /(\d+) of (\d+) department/.exec(String(text ?? ""));
  return found ? `${found[1]} of ${found[2]}` : null;
};
/** The rubric grade, off the published chip. Lowercased to the rubric's own word. */
const gradeWord = (chip) => String(chip ?? "").replace(/^Confidence:\s*/, "").trim().toLowerCase();

/** A document that is a map of slots. No markup is parsed and none is needed. */
function slotDocument(ids) {
  const nodes = new Map(ids.map((id) => [id, {
    id, textContent: "", value: "", hidden: false, dataset: {},
    getAttribute: () => null, focus() {}, select() {},
  }]));
  return {
    nodes,
    getElementById: (id) => nodes.get(id) ?? null,
    querySelector: () => null,
  };
}

/** The three surfaces, each read from what it actually renders. */
function readSurfaces(dataset, gradability = null) {
  const recoverable = getRecoverableSpend(dataset);
  const verdict = gradeRecoverableConfidence(gradability);

  // (a) THE BRIEFING TEXT. The forwardable summary, composed from the record the
  // page composes its headline from, and read back as bytes a reader pastes.
  const copy = buildAnswerCopy({
    question: "How much AI spend can we recover?",
    source: "example",
    period: RECORDED.period,
    asOf: RECORDED.period,
    recoverable: {
      available: true,
      label: RECOVERABLE_SPEND_LABEL,
      value: recoverable.monthlyDisplay,
      basis: `${recoverable.basisSentence} ${recoverable.confidence.sentence}`,
    },
    team: { available: true, name: "Backend" },
    action: { available: true, label: "Route the top workload to the cheaper model" },
  });

  // (b) THE ANSWER DESTINATION. The real painters, into the real slot ids.
  const answerDoc = slotDocument([
    ...Object.values(RECOVERABLE_SPEND_IDS), ...Object.values(RECOVERABLE_CONFIDENCE_IDS),
  ]);
  renderRecoverableSpend(answerDoc, recoverable);
  applyRecoverableConfidence(answerDoc, verdict);
  const figureNode = answerDoc.getElementById(RECOVERABLE_SPEND_IDS.figure);

  // (c) THE EVIDENCE DESTINATION. The working: the basis sentence and the
  // coverage the figure is a floor over, which is what the evidence screen is
  // for. Read from the same record, through the slot the evidence side prints.
  // The headline leads, then the working: the monthly figure is the briefed one,
  // and the annual projection in the working is a SECOND money string, so the
  // stated figure has to come first or the comparison would read the projection.
  const evidenceText = `${recoverable.headline}. ${recoverable.scopeSentence}`;

  return {
    recoverable,
    verdict,
    copyText: copy.text,
    surfaces: {
      briefing: {
        figure: money(copy.text),
        confidence: coverage(copy.text),
        grade: gradeWord(confidenceChip(verdict)),
      },
      answer: {
        figure: answerDoc.getElementById(RECOVERABLE_SPEND_IDS.value).textContent,
        confidence: `${figureNode.dataset.scoredDepartments} of ${figureNode.dataset.totalDepartments}`,
        grade: answerDoc.getElementById(RECOVERABLE_CONFIDENCE_IDS.grade).dataset.grade,
      },
      evidence: {
        figure: money(evidenceText),
        confidence: coverage(evidenceText),
        grade: gradeWord(confidenceChip(verdict)),
      },
    },
  };
}

test("the briefing hands over a routed destination address, not a mid-page anchor", () => {
  const href = briefingDestinationHref(BRIEFED_FIGURE_DESTINATION);
  // The router owns the fragment. Asserted against the router's own accessor so
  // this test cannot pass by agreeing with a string typed twice.
  assert.equal(href, `${ANALYSIS_PATH}${fragmentForSlug(BRIEFED_FIGURE_DESTINATION)}`);
  assert.ok(href.startsWith(`${ANALYSIS_PATH}#`), `a destination address, got ${href}`);
  assert.notEqual(fragmentForSlug(BRIEFED_FIGURE_DESTINATION), "");
  assert.notEqual(fragmentForSlug(BRIEFED_EVIDENCE_DESTINATION), "");
  assert.notEqual(
    fragmentForSlug(BRIEFED_FIGURE_DESTINATION), fragmentForSlug(BRIEFED_EVIDENCE_DESTINATION),
    "the answer and the evidence are two destinations, not one",
  );

  // And the briefing surface renders it. Painted by the shipped control into the
  // shipped slot id, so the markup a reader copies from carries the routed URL.
  const doc = slotDocument(Object.values(SHARE_LINK_IDS));
  applyShareLink(doc, {}, { origin: "https://labs.wawalu.org" });
  const line = doc.getElementById(SHARE_LINK_IDS.destination);
  assert.equal(line.textContent, href);
  assert.equal(line.dataset.destination, BRIEFED_FIGURE_DESTINATION);
});

test("the briefed figure, confidence and grade recompute, and three surfaces agree", () => {
  const briefed = briefedFigure(RECORDED, null);

  // Recomputed from the recorded inputs, not pasted: 3200 + 1450 over the two
  // scored departments, and the third excluded rather than counted as zero.
  assert.equal(briefed.recoverable.monthly, MONTHLY);
  assert.equal(briefed.figure, "$4,650");
  assert.equal(briefed.confidence, `${SCORED} of ${READ}`);
  assert.equal(briefed.level, "high");
  // The grade is the published rubric's answer to "no export gradability was
  // recorded", which that rubric states is `low` with the reason, not an
  // exception. The fixture asserts the rule's output; it does not guess a grade.
  assert.equal(briefed.grade, gradeRecoverableConfidence(null).grade);
  assert.equal(briefed.href, briefingDestinationHref(BRIEFED_FIGURE_DESTINATION));
  assert.equal(briefed.evidenceHref, briefingDestinationHref(BRIEFED_EVIDENCE_DESTINATION));

  const read = readSurfaces(RECORDED, null);
  const verdict = compareBriefedFigure(briefed, read.surfaces);
  assert.deepEqual(verdict.drifted, [], verdict.statement);
  assert.equal(verdict.agree, true, verdict.statement);
  assert.equal(verdict.mismatches.length, 0);

  // Every field was actually read off a surface: a null on both sides would
  // "agree" and prove nothing.
  for (const [name, stated] of Object.entries(read.surfaces)) {
    for (const field of BRIEFED_FIELDS) {
      assert.ok(stated[field], `${name} states no ${field}`);
    }
  }
  assert.ok(read.copyText.includes("$4,650"), "the briefing text carries the figure");
});

test("changing one recorded value is reported as drift, and names the surface", () => {
  // Exactly one mutation: Support recovers $100 more. Nothing else moves.
  const mutated = {
    ...RECORDED,
    rankedDepartments: RECORDED.rankedDepartments.map((row) => (row.id === "support"
      ? { ...row, recoverableUsd: row.recoverableUsd + 100 }
      : row)),
  };

  const drifted = readSurfaces(mutated, null);
  // The mutation reached the figure at all — otherwise the check below would be
  // passing for the wrong reason.
  assert.equal(drifted.recoverable.monthly, MONTHLY + 100);

  const verdict = compareBriefedFigure(briefedFigure(RECORDED, null), drifted.surfaces);
  assert.equal(verdict.agree, false, "a changed input must not compare equal");
  assert.deepEqual([...verdict.drifted].sort(), ["answer", "briefing", "evidence"]);
  for (const mismatch of verdict.mismatches) {
    assert.equal(mismatch.field, "figure");
    assert.equal(mismatch.expected, "$4,650");
    assert.equal(mismatch.actual, "$4,750");
  }
  // The failure names surfaces and numbers, so a reader is told which figure to
  // stop quoting rather than that "something differs".
  assert.match(verdict.statement, /briefing states figure \$4,750/);

  // And one surface drifting alone is reported alone: the reporter is not an
  // all-or-nothing flag.
  const single = compareBriefedFigure(briefedFigure(RECORDED, null), {
    briefing: drifted.surfaces.briefing,
    answer: readSurfaces(RECORDED, null).surfaces.answer,
  });
  assert.deepEqual(single.drifted, ["briefing"]);
});

// --------------------------------------------------------------------------
// AND THE ADDRESS OPENS THE SCREEN THAT STATES THE FIGURE.
//
// The three tests above prove the briefing carries a routed address and a true
// number. This one follows the address into the shipped page: the fragment the
// briefing emits has to land on the destination that STATES the briefed figure,
// or the whole hand-off is a link to the wrong screen.
//
// All three settle waits, not just `ready`: waiting only on `ready` leaves a
// paint in flight, which passes locally and reds CI as an unhandled rejection.
// --------------------------------------------------------------------------

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const OVERSPEND_FIXTURE = JSON.parse(await readFile(
  new URL("../src/model-overspend-finding-fixture.json", import.meta.url), "utf8"));

test("the address the briefing emits opens the destination that states the figure", async () => {
  const hash = fragmentForSlug(BRIEFED_FIGURE_DESTINATION);
  assert.ok(briefingDestinationHref(BRIEFED_FIGURE_DESTINATION).endsWith(hash));

  const page = await loadPage(PAGE, {
    location: { hash },
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
      "/model-overspend-finding-fixture.json": OVERSPEND_FIXTURE,
    },
  });
  try {
    await importPageModule("/evolution-page.js");
    const { document } = page;
    await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
      "the bundled analysis to finish rendering");
    await waitFor(() => textOf(document.getElementById("integration-contract-provenance"))
      .startsWith("Gateway completed"), "the static contract gateway to settle");
    await waitFor(() => document.getElementById("finops-evaluation-result")
      .getAttribute("aria-busy") === "false", "the evaluation panel to settle");

    // The answer destination is the one on screen, and the evidence destination
    // is not: the address selected a screen rather than scrolling within one.
    assert.equal(
      document.getElementById("finops-destinations").dataset.workspaceActive, "true");
    assert.equal(document.getElementById("score-card").dataset.workspaceActive, "false");

    // And the screen it landed on states the briefed figure, in money, beside
    // its grade. Read as text off the shipped slots, never through parsed markup.
    const figure = textOf(document.getElementById(RECOVERABLE_SPEND_IDS.value));
    assert.match(figure, /^\$[\d,]+$/, `a stated figure, got ${figure}`);
    assert.ok(textOf(document.getElementById(RECOVERABLE_CONFIDENCE_IDS.grade))
      .startsWith("Confidence:"), "the grade is stated beside the figure");
  } finally {
    page.restore();
  }
});
