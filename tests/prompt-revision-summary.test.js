// The words that leave the tab.
//
// The clipboard is the revision loop's only egress, so what the copy control
// puts on it is asserted as a literal string here rather than scraped out of a
// rendered DOM. Two properties matter more than the wording: the summary can
// never carry prompt text, and a clipboard that is missing is distinguishable
// from a clipboard that refused — those have different recoveries.
//
// FIXTURE PROVENANCE. Every prompt below is hand-authored for this test and
// matches the texts pinned in tests/prompt-revision-fixtures.test.js, so a
// change to the engine that moves a score fails there first with a clearer
// message. No real prompt, customer, or telemetry data exists in this workflow.

import test from "node:test";
import assert from "node:assert/strict";

import { buildCoachingSession } from "../src/prompt-coaching-contract.js";
import { buildRevisionComparison } from "../src/prompt-revision-comparison.js";
import {
  COPY_FEEDBACK, COPY_OUTCOME, DIRECTION_COPY, REMAINING_STATUS_COPY,
  SUMMARY_BOUNDARY_LINE, copyRevisionSummary, revisionCopySummary,
} from "../src/prompt-revision-summary.js";

const TIER = "standard";

const VAGUE_CHECKOUT = "improve the checkout code somehow and make it better as needed";

const SPECIFIC_CHECKOUT = [
  "Context: we run a checkout service on Node 20 behind a CDN, and the retry path floods payments during a partial outage.",
  "Constraints: do not add a dependency and do not change the public API.",
  "Success: a patch to one file plus the test that fails without it.",
  "",
  "1. Explain why the retry storm starts",
  "2. Propose the smallest fix",
].join("\n");

const ACCEPTANCE_CHECKOUT = [
  "Context: we run a checkout service on Node 20 behind a CDN, and the retry path floods payments during a partial outage.",
  "Constraints: do not add a dependency and do not change the public API.",
  "Acceptance criteria: a patch to one file plus the test that fails without it.",
  "",
  "1. Explain why the retry storm starts",
  "2. Propose the smallest fix",
].join("\n");

function compare(baselineText, revisionText, { tier = TIER, revisionTier = tier } = {}) {
  return buildRevisionComparison({
    comparisonId: "summary-case",
    baseline: buildCoachingSession({ sessionId: "baseline-1", text: baselineText, modelTier: tier }),
    revision: buildCoachingSession({ sessionId: "revision-2", text: revisionText, modelTier: revisionTier }),
  });
}

test("an improved revision copies one delta, one band move, one status, one action", () => {
  const summary = revisionCopySummary(compare(VAGUE_CHECKOUT, SPECIFIC_CHECKOUT));
  const lines = summary.split("\n");

  assert.equal(lines[0], "Prompt coaching — Did my revised prompt improve?");
  assert.equal(lines[1], "Improved. +33 points · 56 → 89 of 100.");
  assert.equal(lines[2], "Letter grade F → B, up 3 bands.");
  assert.equal(lines[3],
    `Still first: ${REMAINING_STATUS_COPY.advanced.label} — ${REMAINING_STATUS_COPY.advanced.text}`);
  // The axis is the rubric's own display label, printed rather than re-cased:
  // it is what the axis subscore table beside it says.
  assert.equal(lines[4], "Signal: intent-pasted-context (Intent axis).");
  assert.match(lines[5], /^Do this next: /);
  assert.match(lines[6], /^Rubric /);
  assert.equal(lines.at(-1), SUMMARY_BOUNDARY_LINE);

  // Exactly one instruction. Two would hand the ranking job to whoever the
  // summary is pasted to, which is the same failure the surface avoids.
  assert.equal(lines.filter((line) => line.startsWith("Do this next:")).length, 1);
});

test("a same-band gain says so, rather than implying a letter moved", () => {
  const summary = revisionCopySummary(compare(VAGUE_CHECKOUT, VAGUE_CHECKOUT));
  assert.match(summary, /Unchanged\. No change · 56 → 56 of 100\./);
  assert.match(summary, /Letter grade F → F, still the same band\./);
  assert.match(summary, new RegExp(REMAINING_STATUS_COPY.unaddressed.label));
});

test("a regressed revision copies the verdict rather than burying it", () => {
  const summary = revisionCopySummary(compare(SPECIFIC_CHECKOUT, VAGUE_CHECKOUT));
  assert.match(summary, /^Prompt coaching/);
  assert.match(summary, /Regressed\. -33 points · 89 → 56 of 100\./);
  assert.match(summary, /Letter grade B → F, down 3 bands\./);
  assert.match(summary, /Do this next: Keep the baseline\./);
});

test("a saturated revision copies the stop action and names no signal", () => {
  const comparison = compare(VAGUE_CHECKOUT, ACCEPTANCE_CHECKOUT);
  assert.equal(comparison.comparison.remainingWeakness.status, "none");
  const summary = revisionCopySummary(comparison);
  assert.match(summary, new RegExp(REMAINING_STATUS_COPY.none.label));
  assert.doesNotMatch(summary, /^Signal: /m);
  assert.match(summary, /Do this next: Stop iterating\./);
});

test("an abstention copies the reason code a reader would quote, and no delta", () => {
  const summary = revisionCopySummary(compare(SPECIFIC_CHECKOUT, "   \n "));
  assert.match(summary, /Not compared — revision_not_graded\./);
  assert.match(summary, /Grade the revision first\./);
  assert.doesNotMatch(summary, /points ·/);
  assert.doesNotMatch(summary, /Letter grade/);
  assert.equal(summary.split("\n").at(-1), SUMMARY_BOUNDARY_LINE);
});

test("a tier change abstains in the summary rather than reporting a confounded delta", () => {
  const summary = revisionCopySummary(
    compare(VAGUE_CHECKOUT, SPECIFIC_CHECKOUT, { tier: "standard", revisionTier: "premium" }));
  assert.match(summary, /Not compared — tier_changed\./);
  assert.doesNotMatch(summary, /33/);
});

test("neither prompt reaches the clipboard, at any depth", () => {
  // Two distinct markers, one per side, in text that still grades. If either
  // ever appears in the summary, the only egress this workflow has is leaking.
  const baselineMarker = "zqbaselinemarkerzq";
  const revisionMarker = "zqrevisionmarkerzq";
  const summary = revisionCopySummary(compare(
    `${VAGUE_CHECKOUT} ${baselineMarker}`,
    `${SPECIFIC_CHECKOUT}\nNote: ${revisionMarker}`));
  assert.doesNotMatch(summary, new RegExp(baselineMarker));
  assert.doesNotMatch(summary, new RegExp(revisionMarker));
  // And the words that are there came from the envelope, not from a paste.
  assert.match(summary, /Improved\./);
});

test("the summary refuses anything that is not a comparison envelope", () => {
  assert.throws(() => revisionCopySummary(null), TypeError);
  assert.throws(() => revisionCopySummary("Improved by a lot"), TypeError);
  assert.throws(() => revisionCopySummary({ comparison: {} }), TypeError);
});

test("copying reports three outcomes, not a boolean", async () => {
  let written = "";
  assert.equal(
    await copyRevisionSummary({ writeText: async (value) => { written = value; } }, "one line"),
    COPY_OUTCOME.copied);
  assert.equal(written, "one line");

  // A denied permission, an unfocused document, a browser that refuses outside
  // a gesture: all land here, and all have the same recovery.
  assert.equal(
    await copyRevisionSummary({ writeText: async () => { throw new Error("denied"); } }, "one line"),
    COPY_OUTCOME.failed);

  // No clipboard API at all is a different sentence: it will not work on retry.
  assert.equal(await copyRevisionSummary(undefined, "one line"), COPY_OUTCOME.unavailable);
  assert.equal(await copyRevisionSummary({}, "one line"), COPY_OUTCOME.unavailable);
  assert.equal(await copyRevisionSummary({ writeText: async () => {} }, ""), COPY_OUTCOME.failed);
});

test("every outcome has a distinct sentence, and every direction a word and a shape", () => {
  const sentences = Object.values(COPY_OUTCOME).map((outcome) => COPY_FEEDBACK[outcome]);
  assert.equal(sentences.filter(Boolean).length, 3);
  assert.equal(new Set(sentences).size, 3);
  for (const [direction, copy] of Object.entries(DIRECTION_COPY)) {
    assert.ok(copy.word.length > 0, `${direction} needs a word, not only a tint`);
    assert.ok(copy.shape.length > 0, `${direction} needs a shape, not only a tint`);
  }
  assert.equal(new Set(Object.values(DIRECTION_COPY).map(({ shape }) => shape)).size, 3);
  assert.deepEqual(Object.keys(REMAINING_STATUS_COPY).sort(),
    ["advanced", "emerged", "none", "unaddressed"]);
});
