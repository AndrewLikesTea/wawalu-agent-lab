// The grade → revise → re-grade loop, driven through the shipped markup.
//
// Like tests/prompt-coaching-flow.test.js, this loads the real evolution.html
// and the real page entry — not a fixture DOM and not a re-implementation of
// the wiring — so "a reader can revise a prompt and read whether it improved"
// is a keystroke assertion. What it cannot model is layout; the responsive
// rules are asserted as CSS rather than as geometry, and the rest belongs in a
// browser. What it does model is what a keyboard and screen-reader user feels:
// tab order, activation, live-region text, disabled states, and where focus
// lands after every refusal.
//
// The harness's fetch throws on any request a test did not declare, and this
// file declares none. That is the network assertion: if this loop ever grows a
// call, every test here fails.
//
// FIXTURE PROVENANCE. The prompts below are hand-authored and match the texts
// pinned in tests/prompt-revision-fixtures.test.js and
// tests/prompt-revision-delta-fixtures.test.js, so the scores this file asserts
// are the ones those contracts already pin.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadPage, pressEnter, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { CONTROL_ALIASES, REVISION_HINT } from "../src/prompt-revision-view.js";
import { COPY_FEEDBACK, SUMMARY_BOUNDARY_LINE } from "../src/prompt-revision-summary.js";

const PAGE = fileURLToPath(new URL("../src/evolution.html", import.meta.url));

const byId = (document, id) => document.getElementById(id);

const VAGUE_CHECKOUT = "improve the checkout code somehow and make it better as needed";

const SPECIFIC_CHECKOUT = [
  "Context: we run a checkout service on Node 20 behind a CDN, and the retry path floods payments during a partial outage.",
  "Constraints: do not add a dependency and do not change the public API.",
  "Success: a patch to one file plus the test that fails without it.",
  "",
  "1. Explain why the retry storm starts",
  "2. Propose the smallest fix",
].join("\n");

const ACCEPTANCE_CHECKOUT = SPECIFIC_CHECKOUT
  .replace("Success: a patch", "Acceptance criteria: a patch");

/** A clipboard that records, one that refuses, or none at all. */
function recordingClipboard() {
  const written = [];
  return { written, writeText: async (value) => { written.push(value); } };
}

async function openCoachingPage(options = {}) {
  const page = await loadPage(PAGE, options);
  await importPageModule("/prompt-coaching-page.js");
  return page;
}

/** Tab from wherever focus is until a control is reached; no mouse involved. */
function tabTo(document, id) {
  for (let step = 0; step <= tabSequence(document).length; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot use the workflow.`);
}

/** Replace a field's contents from the keyboard and submit its form. */
function submitField(document, fieldId, text, buttonId) {
  const field = tabTo(document, fieldId);
  field.value = "";
  typeText(document, text);
  tabTo(document, buttonId);
  pressEnter(document);
  return field;
}

const gradeBaseline = (document, text) =>
  submitField(document, "prompt-coaching-input", text, "prompt-coaching-grade");
const regrade = (document, text) =>
  submitField(document, "prompt-coaching-revision-input", text, "prompt-coaching-regrade");

// ---------------------------------------------------------------------------
// Step 1 is unchanged, and step 2 does not exist until it has answered
// ---------------------------------------------------------------------------

test("the revision step is absent, and untabbable, until a baseline is graded", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const section = byId(document, "prompt-revision");
    assert.ok(section, "the revision step must ship in the page markup");
    assert.equal(section.hidden, true);
    assert.equal(section.dataset.state, "idle");

    // Not a keyboard trap and not a phantom tab stop: a hidden subtree has no
    // controls in the sequence, so tab order before a baseline is what it was.
    const reachable = tabSequence(document).map((node) => node.id);
    for (const id of ["prompt-coaching-revision-input", "prompt-coaching-regrade",
      "prompt-revision-reset", "prompt-revision-copy"]) {
      assert.equal(reachable.includes(id), false, `${id} is tabbable before there is a baseline`);
    }
    assert.equal(reachable.includes("prompt-coaching-input"), true);
    assert.equal(reachable.includes("prompt-coaching-grade"), true);
  } finally {
    page.restore();
  }
});

test("grading one prompt still answers exactly as it did, and then offers step 2", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);

    // The single-prompt path: same section state, same result region, same
    // announcement shape. Nothing in this issue repainted it.
    const coaching = byId(document, "prompt-coaching");
    assert.equal(coaching.dataset.state, "graded");
    assert.equal(coaching.dataset.grade, "F");
    assert.equal(byId(document, "prompt-coaching-result").hidden, false);
    assert.match(textOf(byId(document, "prompt-coaching-result")), /56 \/ 100 · grade F/);
    assert.match(textOf(byId(document, "prompt-coaching-live")), /Do this first:/);

    // And step 2 opens against it, seeded rather than empty.
    const revision = byId(document, "prompt-revision");
    assert.equal(revision.hidden, false);
    assert.equal(revision.dataset.state, "ready");
    assert.equal(byId(document, "prompt-coaching-revision-input").value, VAGUE_CHECKOUT);
    assert.equal(textOf(byId(document, "prompt-revision-hint")), REVISION_HINT);

    // The baseline strip carries the figure and exactly one prioritized move.
    const baseline = textOf(byId(document, "prompt-revision-baseline"));
    assert.match(baseline, /56 \/ 100 · grade F/);
    assert.match(baseline, /Do this first: /);
    assert.equal(byId(document, "prompt-revision-baseline")
      .querySelectorAll(".prompt-revision-baseline-move-title").length, 1);

    // No comparison is claimed before one is asked for.
    assert.equal(byId(document, "prompt-revision-result").hidden, true);
    assert.equal(byId(document, "prompt-revision-copy-group").hidden, true);
    assert.equal(textOf(byId(document, "prompt-revision-live")), "");
  } finally {
    page.restore();
  }
});

test("a refused baseline keeps step 2 shut rather than offering a second empty box", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, "   \n ");
    // The single-prompt surface keys on the result state, not the session
    // outcome; both are untouched by this issue.
    assert.equal(byId(document, "prompt-coaching").dataset.state, "not_gradeable");
    assert.equal(byId(document, "prompt-revision").hidden, true);

    // And recovering into a graded baseline opens it.
    gradeBaseline(document, VAGUE_CHECKOUT);
    assert.equal(byId(document, "prompt-revision").hidden, false);
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// The loop, and the deltas
// ---------------------------------------------------------------------------

test("a better revision reports the score delta, the band move, and one action", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, SPECIFIC_CHECKOUT);

    const section = byId(document, "prompt-revision");
    assert.equal(section.dataset.state, "compared");
    assert.equal(section.dataset.direction, "improved");

    const result = byId(document, "prompt-revision-result");
    assert.equal(result.hidden, false);
    // The glyph beside the word is decorative; `textOf` reads both, and the
    // word is what assistive technology announces.
    assert.equal(textOf(result.querySelector(".prompt-revision-verdict")), "▲Improved");
    assert.equal(textOf(result.querySelector(".prompt-revision-headline-text")),
      "+33 points · 56 → 89 of 100.");

    // The band move is a material figure of its own, said in words as well as
    // in the big decorative one.
    const grade = result.querySelector(".prompt-revision-grade");
    assert.equal(grade.dataset.moved, "true");
    assert.deepEqual([grade.dataset.from, grade.dataset.to], ["F", "B"]);
    assert.equal(textOf(grade.querySelector(".prompt-revision-grade-figure")), "F → B");
    assert.equal(grade.querySelector(".prompt-revision-grade-figure")
      .getAttribute("aria-hidden"), "true");
    assert.match(textOf(grade.querySelector(".prompt-revision-grade-text")), /up 3 bands/);

    // The status answers "am I fixing what I was told to fix?" without becoming
    // a second instruction.
    const remaining = result.querySelector(".prompt-revision-remaining");
    assert.equal(remaining.dataset.status, "advanced");
    assert.match(textOf(remaining), /intent-pasted-context/);
    assert.equal(remaining.querySelectorAll("pre").length, 0);

    // Exactly one action, and it is the one the ladder selects.
    const actions = result.querySelectorAll('[data-role="next-action"]');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].dataset.kind, "apply_remaining");
    assert.equal(actions[0].querySelectorAll("pre").length, 1, "the action carries the rewrite");

    // The verdict, then the figure, then the move — the reading order a person
    // who is not looking at the page hears.
    assert.match(textOf(byId(document, "prompt-revision-live")),
      /^Improved\. \+33 points · 56 → 89 of 100\. Letter grade F to B\. Do this next: /);
  } finally {
    page.restore();
  }
});

test("a same-band gain is not dressed up as a letter change", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, VAGUE_CHECKOUT);

    const result = byId(document, "prompt-revision-result");
    assert.equal(byId(document, "prompt-revision").dataset.direction, "unchanged");
    assert.equal(textOf(result.querySelector(".prompt-revision-verdict")), "■Unchanged");
    const grade = result.querySelector(".prompt-revision-grade");
    assert.equal(grade.dataset.moved, "false");
    assert.match(textOf(grade), /the same band/);
    assert.equal(result.querySelector(".prompt-revision-remaining").dataset.status, "unaddressed");
  } finally {
    page.restore();
  }
});

test("a worse revision is told to revert, not coached deeper into it", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, SPECIFIC_CHECKOUT);
    regrade(document, VAGUE_CHECKOUT);

    const result = byId(document, "prompt-revision-result");
    assert.equal(byId(document, "prompt-revision").dataset.direction, "regressed");
    assert.match(textOf(result.querySelector(".prompt-revision-headline-text")),
      /-33 points · 89 → 56 of 100\./);

    // `revert` outranks `apply_remaining`: the revision still has a top-ranked
    // improvement, and presenting it first would coach a worse draft.
    const actions = result.querySelectorAll('[data-role="next-action"]');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].dataset.kind, "revert");
    assert.match(textOf(actions[0]), /Keep the baseline\./);
    // The remaining weakness is still reported — as a status, not as the move.
    assert.equal(result.querySelector(".prompt-revision-remaining").dataset.status, "advanced");
  } finally {
    page.restore();
  }
});

test("a revision the rubric cannot improve says stop, and nothing else", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, ACCEPTANCE_CHECKOUT);

    const result = byId(document, "prompt-revision-result");
    const remaining = result.querySelector(".prompt-revision-remaining");
    assert.equal(remaining.dataset.status, "none");
    assert.doesNotMatch(textOf(remaining), /axis/);
    const actions = result.querySelectorAll('[data-role="next-action"]');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].dataset.kind, "stop");
    assert.equal(actions[0].querySelectorAll("pre").length, 0);
  } finally {
    page.restore();
  }
});

test("the delta is always measured against the first baseline, twice over", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, SPECIFIC_CHECKOUT);
    // A second revision compares to the same baseline rather than to the first
    // revision: there is no history object, and the hint says which it is.
    regrade(document, ACCEPTANCE_CHECKOUT);
    assert.match(textOf(byId(document, "prompt-revision-result")
      .querySelector(".prompt-revision-headline-text")), /\+36 points · 56 → 92 of 100\./);
    assert.match(REVISION_HINT, /measured against that baseline/);
  } finally {
    page.restore();
  }
});

test("grading a new baseline restarts the loop instead of leaving a stale delta", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, SPECIFIC_CHECKOUT);
    assert.equal(byId(document, "prompt-revision").dataset.state, "compared");

    gradeBaseline(document, SPECIFIC_CHECKOUT);
    const section = byId(document, "prompt-revision");
    assert.equal(section.dataset.state, "ready");
    assert.equal(section.dataset.direction, undefined);
    assert.equal(byId(document, "prompt-revision-result").hidden, true);
    assert.equal(byId(document, "prompt-revision-copy-group").hidden, true);
    assert.equal(byId(document, "prompt-revision-evidence").hidden, true);
    assert.equal(byId(document, "prompt-coaching-revision-input").value, SPECIFIC_CHECKOUT);
  } finally {
    page.restore();
  }
});

test("clearing the workflow takes step 2 with it, including the summary", async () => {
  const page = await openCoachingPage({ clipboard: recordingClipboard() });
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, SPECIFIC_CHECKOUT);

    tabTo(document, "prompt-coaching-clear");
    pressEnter(document);
    const section = byId(document, "prompt-revision");
    assert.equal(section.hidden, true);
    assert.equal(section.dataset.state, "idle");
    assert.equal(byId(document, "prompt-coaching-input").value, "");
    assert.equal(byId(document, "prompt-coaching-revision-input").value, "");
    assert.equal(textOf(byId(document, "prompt-revision-summary-text")), "");
    assert.equal(textOf(byId(document, "prompt-revision-baseline")), "");
    assert.equal(document.activeElement.id, "prompt-coaching-input");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// The states that are not an answer
// ---------------------------------------------------------------------------

test("an empty revision abstains, marks the field, and moves focus to it", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, "   \n ");

    const section = byId(document, "prompt-revision");
    assert.equal(section.dataset.state, "abstained");
    assert.equal(section.dataset.reason, "revision_not_graded");
    assert.equal(section.dataset.direction, undefined);

    // A refusal is a state, not an empty panel: one action, the reason code
    // printed for quoting, and no delta claimed.
    const result = byId(document, "prompt-revision-result");
    assert.equal(result.hidden, false);
    assert.equal(result.querySelectorAll('[data-role="next-action"]').length, 1);
    assert.match(textOf(result), /Reason code: revision_not_graded/);
    assert.equal(result.querySelector(".prompt-revision-headline"), null);

    // The field is invalid and describes its own recovery, and focus is on it.
    const field = byId(document, "prompt-coaching-revision-input");
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.equal(field.getAttribute("aria-describedby"),
      "prompt-revision-hint prompt-revision-recovery-guidance");
    assert.equal(document.activeElement.id, "prompt-coaching-revision-input");

    // Nothing may be copied out of a comparison that was never made.
    assert.equal(byId(document, "prompt-revision-copy-group").hidden, true);

    // And recovering clears the invalid mark rather than leaving it stuck on.
    regrade(document, SPECIFIC_CHECKOUT);
    assert.equal(field.getAttribute("aria-invalid"), null);
    assert.equal(field.getAttribute("aria-describedby"), "prompt-revision-hint");
  } finally {
    page.restore();
  }
});

test("changing the model tier between runs abstains and points at the tier control", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const model = byId(document, "prompt-coaching-model");
    model.value = "standard";
    gradeBaseline(document, VAGUE_CHECKOUT);
    model.value = "premium";
    regrade(document, SPECIFIC_CHECKOUT);

    const section = byId(document, "prompt-revision");
    assert.equal(section.dataset.state, "abstained");
    assert.equal(section.dataset.reason, "tier_changed");
    assert.match(textOf(byId(document, "prompt-revision-result")), /Use one model tier\./);
    // The control that fixes it, focused rather than described.
    assert.equal(document.activeElement.id, "prompt-coaching-model");
    // The revision field is not at fault here, so it is not marked invalid.
    assert.equal(byId(document, "prompt-coaching-revision-input")
      .getAttribute("aria-invalid"), null);
  } finally {
    page.restore();
  }
});

test("every control the comparison can name resolves to a real node", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    // The contract names in-page controls to move focus to. One of its names
    // predates this surface, which is what CONTROL_ALIASES resolves; if either
    // side of that map goes stale, a recovery focuses nothing.
    const named = ["prompt-coaching-baseline-input", "prompt-coaching-revision-input",
      "prompt-coaching-model"];
    for (const control of named) {
      const id = CONTROL_ALIASES[control] ?? control;
      assert.ok(byId(document, id), `"${control}" resolves to "${id}", which is not in the page`);
    }
  } finally {
    page.restore();
  }
});

test("the re-grade control is disabled while grading and usable again after", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    const button = byId(document, "prompt-coaching-regrade");
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-busy"), null);

    regrade(document, SPECIFIC_CHECKOUT);
    // Grading is synchronous, so the busy state is over by the time control
    // returns. What must not survive it is a dead button: a disabled control
    // that stays disabled is a keyboard user's dead end.
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-busy"), "false");
    assert.equal(tabSequence(document).map((node) => node.id).includes("prompt-coaching-regrade"),
      true, "the re-grade control must stay in the tab sequence");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// The copy control
// ---------------------------------------------------------------------------

test("copy puts the summary on the clipboard and says so, from the keyboard", async () => {
  const clipboard = recordingClipboard();
  const page = await openCoachingPage({ clipboard });
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, SPECIFIC_CHECKOUT);

    const group = byId(document, "prompt-revision-copy-group");
    assert.equal(group.hidden, false);
    // What would be copied is on the page before anyone presses the control.
    const preview = textOf(byId(document, "prompt-revision-summary-text"));
    assert.match(preview, /Improved\. \+33 points/);

    const button = tabTo(document, "prompt-revision-copy");
    assert.equal(button.getAttribute("aria-describedby"), "prompt-revision-copy-status");
    pressEnter(document);
    const status = await waitFor(
      () => (textOf(byId(document, "prompt-revision-copy-status")) || null),
      "the copy control reports an outcome");

    assert.equal(status, COPY_FEEDBACK.copied);
    assert.equal(byId(document, "prompt-revision-copy-status").dataset.outcome, "copied");
    assert.equal(clipboard.written.length, 1);
    assert.match(clipboard.written[0], /^Prompt coaching — Did my revised prompt improve\?/);
    assert.match(clipboard.written[0], new RegExp(SUMMARY_BOUNDARY_LINE.slice(0, 40)));
    // What is copied is what was previewed, exactly.
    assert.equal(clipboard.written[0].replace(/\s+/g, " ").trim(), preview);
    // Neither prompt travels: the envelope cannot hold text, and this is the
    // one place anything leaves the tab.
    assert.doesNotMatch(clipboard.written[0], /checkout service on Node 20/);
    // The control stays usable — a copy is repeatable.
    assert.equal(button.disabled, false);
  } finally {
    page.restore();
  }
});

test("a refused clipboard is recoverable, and the control is not left dead", async () => {
  const page = await openCoachingPage({
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  });
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, SPECIFIC_CHECKOUT);
    tabTo(document, "prompt-revision-copy");
    pressEnter(document);

    const status = await waitFor(
      () => (textOf(byId(document, "prompt-revision-copy-status")) || null),
      "the copy control reports a failure");
    assert.equal(status, COPY_FEEDBACK.failed);
    assert.equal(byId(document, "prompt-revision-copy-status").dataset.outcome, "failed");
    // The recovery it names is on the page: the text to copy by hand.
    assert.match(status, /copy the text yourself/);
    assert.match(textOf(byId(document, "prompt-revision-summary-text")), /Improved\./);
    assert.equal(byId(document, "prompt-revision-copy").disabled, false);
    assert.equal(document.activeElement.id, "prompt-revision-copy");
  } finally {
    page.restore();
  }
});

test("a browser with no clipboard API gets its own sentence, not a failure", async () => {
  // No clipboard is installed, which is the default for this harness.
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, SPECIFIC_CHECKOUT);
    tabTo(document, "prompt-revision-copy");
    pressEnter(document);

    const status = await waitFor(
      () => (textOf(byId(document, "prompt-revision-copy-status")) || null),
      "the copy control reports that no clipboard exists");
    assert.equal(status, COPY_FEEDBACK.unavailable);
    assert.notEqual(COPY_FEEDBACK.unavailable, COPY_FEEDBACK.failed);
    assert.equal(byId(document, "prompt-revision-copy").disabled, false);
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// Evidence, keyboard operation, and the responsive rules
// ---------------------------------------------------------------------------

test("both sides are behind one closed disclosure, opened and closed by keyboard", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, SPECIFIC_CHECKOUT);

    const evidence = byId(document, "prompt-revision-evidence");
    assert.equal(evidence.hidden, false);
    // Two sides, each rendered by the single-prompt presentation model rather
    // than by a second, thinner rendering written for this surface.
    const results = evidence.querySelectorAll(".coaching-result");
    assert.equal(results.length, 2);
    assert.match(textOf(evidence), /Baseline · session baseline-1/);
    assert.match(textOf(evidence), /Revision · session revision-2/);

    const toggle = evidence.querySelector("button");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    const panel = byId(document, toggle.getAttribute("aria-controls"));
    assert.equal(panel.hidden, true);

    toggle.focus();
    pressEnter(document);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(panel.hidden, false);
    assert.equal(document.activeElement.id, toggle.id, "focus stays on the trigger");
    pressEnter(document);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(panel.hidden, true);
  } finally {
    page.restore();
  }
});

test("the whole loop is operable from the keyboard, in reading order", async () => {
  const page = await openCoachingPage({ clipboard: recordingClipboard() });
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, SPECIFIC_CHECKOUT);

    const order = tabSequence(document).map((node) => node.id);
    const at = (id) => order.indexOf(id);
    assert.ok(at("prompt-coaching-input") < at("prompt-coaching-grade"));
    assert.ok(at("prompt-coaching-grade") < at("prompt-coaching-revision-input"));
    assert.ok(at("prompt-coaching-revision-input") < at("prompt-coaching-regrade"));
    assert.ok(at("prompt-coaching-regrade") < at("prompt-revision-reset"));
    assert.ok(at("prompt-revision-reset") < at("prompt-revision-copy"));

    // Restoring the original is a keyboard action too, and it reads the
    // baseline field rather than a second copy of the reader's text.
    const field = byId(document, "prompt-coaching-revision-input");
    field.value = "something else entirely";
    tabTo(document, "prompt-revision-reset");
    pressEnter(document);
    assert.equal(field.value, VAGUE_CHECKOUT);
    assert.equal(document.activeElement.id, "prompt-coaching-revision-input");
  } finally {
    page.restore();
  }
});

test("nothing is signalled by tint alone, and no figure is announced twice", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeBaseline(document, VAGUE_CHECKOUT);
    regrade(document, SPECIFIC_CHECKOUT);

    const result = byId(document, "prompt-revision-result");
    // Every shape glyph is decorative; the words beside it carry the meaning.
    const shapes = result.querySelectorAll(".prompt-coaching-shape");
    assert.ok(shapes.length >= 3);
    for (const shape of shapes) assert.equal(shape.getAttribute("aria-hidden"), "true");
    // The one large figure is hidden from assistive technology because the
    // sentence under it says the same thing.
    assert.equal(result.querySelector(".prompt-revision-grade-figure")
      .getAttribute("aria-hidden"), "true");

    // The live region is written once per result, not once per repaint.
    const live = byId(document, "prompt-revision-live");
    assert.equal(live.getAttribute("role"), "status");
    assert.equal(live.getAttribute("aria-live"), "polite");
    assert.equal(live.getAttribute("aria-atomic"), "true");
  } finally {
    page.restore();
  }
});

test("the revision step is legible on a phone and never renders a pasted string", async () => {
  const [css, view] = await Promise.all([
    readFile(new URL("../src/evolution.css", import.meta.url), "utf8"),
    readFile(new URL("../src/prompt-revision-view.js", import.meta.url), "utf8"),
  ]);

  // The mobile block: full-width targets and a smaller figure at 640px, in the
  // same breakpoint step 1's controls already use.
  const mobile = css.slice(css.indexOf("@media (max-width:640px)", css.indexOf(".prompt-revision {")));
  assert.match(mobile, /#prompt-revision-copy \{ width:100%; \}|,#prompt-revision-copy \{ width:100%; \}/);
  assert.match(mobile, /\.prompt-revision-grade-figure \{ font-size:28px; \}/);
  assert.match(mobile, /\.prompt-revision \{ padding-left:11px; \}/);
  // Long strings wrap rather than forcing a sideways scroll on a 390px screen.
  for (const selector of [".prompt-revision-headline-text", ".prompt-revision-action-guidance",
    ".prompt-revision-summary-text", ".prompt-revision-remaining-signal"]) {
    const rule = css.slice(css.indexOf(`${selector} {`));
    assert.match(rule.slice(0, rule.indexOf("}")), /overflow-wrap:anywhere/,
      `${selector} can overflow a narrow viewport`);
  }
  // Measure is capped where prose is read, matching the rest of the panel.
  assert.match(css, /\.prompt-revision-action-guidance \{[^}]*max-width:70ch/);

  // The inputs are two prompts a visitor pasted. There is no path in this file
  // that puts a string into markup.
  assert.doesNotMatch(view, /innerHTML|outerHTML|insertAdjacentHTML/);
});
