// The copyable revision summary, and the three rungs of the copy.
//
// The flow file next door drives the button through the shipped page. This file
// covers what a page cannot: the fallback rungs, which are each reached only in
// a browser that is missing an API, and the promise that nothing a visitor
// pasted can reach the clipboard through this path.
//
// The summaries here are built from real sessions rather than hand-authored
// models, so a change to the change model's shape fails here rather than
// silently producing a summary with a blank line in it.

import test from "node:test";
import assert from "node:assert/strict";

import {
  COPY_METHOD, SUMMARY_BOUNDARY, SUMMARY_TITLE, buildCoachingSummary, copySummaryText,
} from "../src/coaching-summary.js";
import { REVISION_PENDING, REVISION_STATUS, buildRevisionChange } from "../src/prompt-coaching-view.js";
import { buildCoachingSession, coachingSample } from "../src/prompt-coaching-contract.js";

const WEAK = coachingSample("underspecified-request").text;
const STRONG = coachingSample("well-formed-request").text;

function comparedPair() {
  const baseline = buildCoachingSession({ sessionId: "baseline", text: WEAK });
  const revision = buildCoachingSession({ sessionId: "revision", text: STRONG });
  const change = buildRevisionChange({ comparisonId: "revision-2", baseline, revision });
  return { baseline, revision, change };
}

test("a compared revision summarises both grades, the movement, and the next move", () => {
  const { revision, change } = comparedPair();
  assert.equal(change.status, REVISION_STATUS.compared);
  const summary = buildCoachingSummary({ change, result: revision.result });

  assert.equal(summary.available, true);
  assert.equal(summary.reason, null);
  assert.equal(summary.lines[0], SUMMARY_TITLE);
  assert.equal(summary.lines.at(-1), SUMMARY_BOUNDARY);
  assert.equal(summary.text, summary.lines.join("\n"));

  // Both figures, each labelled, so the pair survives being pasted into a
  // ticket where nothing around it explains which is which.
  assert.match(summary.text, /^Baseline: \d+ \/ 100 · grade [A-F]$/m);
  assert.match(summary.text, /^Revised: \d+ \/ 100 · grade [A-F]$/m);
  // The materiality judgement travels with the numbers rather than leaving the
  // reader of the paste to rank a signed integer the panel already ranked.
  assert.match(summary.text, /^Change: (Material change|Within the same grade band|No change) · improved · \+\d+ points · \d+ → \d+ of 100\.$/m);
  assert.match(summary.text, /^Grade band: Grade band (moved [A-F] → [A-F]|unchanged at [A-F])\.$/m);
  assert.match(summary.text, /^Answer: /m);
  assert.match(summary.text, /^Do this next: /m);
  assert.match(summary.text, /^Both grades: rubric \S+ · classifier \S+ · model tier/m);

  // Exactly one next move in the paste, as on screen.
  assert.equal(summary.lines.filter((entry) => entry.startsWith("Do this next:")).length, 1);
  // Nine or ten short lines. A "summary" that runs longer than the panel is a
  // transcript, and nobody pastes a transcript into a pull request.
  assert.ok(summary.lines.length <= 10, `summary is ${summary.lines.length} lines`);
});

test("nothing a visitor pasted appears in the summary", () => {
  const { revision, change } = comparedPair();
  const summary = buildCoachingSummary({ change, result: revision.result });
  // Every four-word run of both graded texts, checked against the summary.
  // Single words are the wrong unit — "improve" is in the question this
  // workflow asks and in half the prompts anyone would paste into it — but a
  // four-word run in common is text carried across, not English coinciding.
  // The boundary sentence in the paste claims nothing pasted travels; this is
  // what makes the claim true rather than aspirational.
  const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const haystack = words(summary.text).join(" ");
  for (const source of [WEAK, STRONG]) {
    const tokens = words(source);
    for (let at = 0; at + 4 <= tokens.length; at += 1) {
      const run = tokens.slice(at, at + 4).join(" ");
      assert.equal(haystack.includes(run), false,
        `"${run}" came from the graded text and must never reach the clipboard`);
    }
  }
  assert.match(summary.text, /No prompt text was sent, stored, or included in this summary\./);
});

test("a withheld delta is summarised as withheld rather than as movement", () => {
  const baseline = buildCoachingSession({ sessionId: "baseline", text: WEAK });
  const revision = buildCoachingSession({ sessionId: "revision", text: STRONG });
  const broken = JSON.parse(JSON.stringify(revision));
  broken.result.benchmark.score = 4000;
  const change = buildRevisionChange({ comparisonId: "revision-2", baseline, revision: broken });

  const summary = buildCoachingSummary({ change, result: broken.result });
  assert.equal(summary.available, true);
  assert.match(summary.text, /^Change: Movement not claimed · Out of range/m);
  // No direction word to lift out of context, and the reason code travels so
  // the reader of the paste can say which figure was refused.
  assert.doesNotMatch(summary.text, /improved|regressed/);
  assert.match(summary.text, /^Withheld: score_out_of_range/m);
  // The move is still there: the figure is untrustworthy, the guidance is not.
  assert.match(summary.text, /^Do this next: \S/m);
});

test("there is nothing to copy until a comparison was actually made", () => {
  const { revision, change } = comparedPair();
  const refusal = buildCoachingSession({ sessionId: "empty", text: "" });

  for (const [name, pair] of [
    ["no change at all", { change: null, result: revision.result }],
    ["a pending grade", { change: REVISION_PENDING, result: revision.result }],
    ["an unscored result", { change, result: refusal.result }],
    ["nothing whatsoever", {}],
  ]) {
    const summary = buildCoachingSummary(pair);
    assert.equal(summary.available, false, `${name} must not be summarised`);
    assert.equal(summary.text, "", `${name} must not produce copyable text`);
    assert.ok(summary.reason, `${name} must say why`);
  }

  // An abstained comparison is a real change model with no comparison in it.
  const abstained = buildRevisionChange({
    comparisonId: "revision-2", baseline: refusal, revision,
  });
  assert.equal(abstained.status, REVISION_STATUS.abstained);
  assert.equal(buildCoachingSummary({ change: abstained, result: revision.result }).available,
    false);
});

// The status literal this module tests against is the one the view publishes.
// Without this, renaming the status would silently turn every summary off.
test("the summarised status is the view's own compared status", () => {
  assert.equal(REVISION_STATUS.compared, "compared");
});

// --- the copy ----------------------------------------------------------------

/** A document stub with only what the `execCommand` rung reaches for. */
function stagingDoc({ execCommand } = {}) {
  const appended = [];
  const body = { append: (node) => appended.push(node) };
  const doc = {
    body,
    appended,
    createElement: () => ({
      attributes: {},
      selected: false,
      setAttribute(name, value) { this.attributes[name] = value; },
      select() { this.selected = true; },
      setSelectionRange() {},
      remove() { doc.removed = true; },
    }),
  };
  if (execCommand) doc.execCommand = execCommand;
  return doc;
}

test("the async clipboard is used first and reported as a success", async () => {
  const written = [];
  const outcome = await copySummaryText("two lines\nof summary", {
    clipboard: { writeText: async (text) => { written.push(text); } },
    doc: stagingDoc({ execCommand: () => assert.fail("execCommand must not be reached") }),
  });
  assert.deepEqual(written, ["two lines\nof summary"]);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.method, COPY_METHOD.asyncClipboard);
  assert.match(outcome.message, /clipboard/i);
});

test("a denied or absent clipboard falls through to execCommand rather than failing", async () => {
  const doc = stagingDoc({ execCommand: (command) => command === "copy" });
  for (const clipboard of [
    undefined,
    {},
    { writeText: async () => { throw new Error("NotAllowedError"); } },
  ]) {
    const outcome = await copySummaryText("summary", { clipboard, doc });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.method, COPY_METHOD.execCommand);
  }
  // The staged node is selected so the command has something to copy, and it is
  // taken back out of the document either way.
  assert.equal(doc.appended.at(-1).selected, true);
  assert.equal(doc.appended.at(-1).attributes["aria-hidden"], "true");
  assert.equal(doc.appended.at(-1).attributes.tabindex, "-1");
  assert.equal(doc.removed, true);
});

test("when no rung can copy, the outcome says so instead of claiming success", async () => {
  for (const [name, deps] of [
    ["no clipboard and no execCommand", { doc: stagingDoc() }],
    ["an execCommand that refuses", { doc: stagingDoc({ execCommand: () => false }) }],
    ["an execCommand that throws", {
      doc: stagingDoc({ execCommand: () => { throw new Error("outside a user gesture"); } }),
    }],
    ["no document at all", {}],
  ]) {
    const outcome = await copySummaryText("summary", deps);
    assert.equal(outcome.ok, false, `${name} must not report a copy`);
    assert.equal(outcome.method, COPY_METHOD.manual);
    // The message names the keystroke on both platforms rather than telling the
    // reader only that something went wrong.
    assert.match(outcome.message, /Ctrl\+C/);
    assert.match(outcome.message, /Cmd\+C/);
  }
});

test("an empty summary is never reported as copied", async () => {
  for (const text of ["", null, undefined, 42]) {
    const outcome = await copySummaryText(text, {
      clipboard: { writeText: async () => assert.fail("nothing should be written") },
      doc: stagingDoc({ execCommand: () => true }),
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.method, COPY_METHOD.manual);
  }
});

test("the copy never throws, whatever it is handed", async () => {
  const hostile = {
    get body() { throw new Error("detached"); },
    createElement() { throw new Error("no"); },
    execCommand() { throw new Error("no"); },
  };
  const outcome = await copySummaryText("summary", {
    clipboard: { get writeText() { throw new Error("no"); } },
    doc: hostile,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.method, COPY_METHOD.manual);
});
