// The reading surface for "Did my revised prompt improve?".
//
// Step 2 of one workflow, not a second workflow. Step 1 — grade one prompt —
// is untouched by everything here: this module never writes into
// `#prompt-coaching-result`, never repaints it, and appears only *after* a
// baseline has been graded, so a reader who wants one grade and nothing else
// sees exactly the page they saw before this issue.
//
// The rules this surface holds, all four inherited rather than invented:
//
//   1. **createElement and textContent only.** No markup string and no markup
//      property assignment on any path. The inputs are two prompts a visitor
//      pasted; a template string here would be a script injection with a paste
//      as its vector. (The envelope cannot carry their text — but the rule does
//      not depend on that being true.)
//   2. **Nothing is signalled by tint alone.** Every direction, band move and
//      state carries a word and a shape. The big `F → B` figure is
//      `aria-hidden`: the line under it says the same thing in words.
//   3. **Exactly one action.** `nextAction` is the only thing phrased as an
//      instruction and the only block that carries a rewrite. The remaining
//      weakness is rendered as a *status* — it answers "am I fixing what I was
//      told to fix?", and a second imperative beside the first hands the reader
//      the ranking job the contract exists to do for them.
//   4. **Reading order is the contract's**, not this file's opinion:
//      `["headline", "grade", "action", "evidence"]`, with the remaining-weakness
//      status sitting inside the answer half rather than beside the action.
//
// The evidence disclosure renders each side with `presentCoachingResult` +
// `renderCoachingResult` — the single-prompt presentation model, unchanged —
// because the alternative is a second, thinner rendering of a result that
// already has one.

import { presentCoachingResult } from "./coaching-result-presentation.js";
import { renderCoachingResult } from "./coaching-result-view.js";
import {
  COPY_FEEDBACK, COPY_OUTCOME, DIRECTION_COPY, REMAINING_STATUS_COPY,
  copyRevisionSummary, revisionCopySummary,
} from "./prompt-revision-summary.js";

const SECTION_ID = "prompt-revision";
const RESULT_ID = "prompt-revision-result";
const EVIDENCE_ID = "prompt-revision-evidence";
const BASELINE_ID = "prompt-revision-baseline";
const LIVE_ID = "prompt-revision-live";
const INPUT_ID = "prompt-coaching-revision-input";
const HINT_ID = "prompt-revision-hint";
const RECOVERY_TEXT_ID = "prompt-revision-recovery-guidance";
const COPY_GROUP_ID = "prompt-revision-copy-group";
const COPY_BUTTON_ID = "prompt-revision-copy";
const COPY_STATUS_ID = "prompt-revision-copy-status";
const SUMMARY_TEXT_ID = "prompt-revision-summary-text";
const REGRADE_ID = "prompt-coaching-regrade";

/**
 * The contract names in-page controls to move focus to, and one of its names
 * predates this surface: `prompt-coaching-baseline-input` is the field the
 * single-prompt workflow shipped as `prompt-coaching-input` in issue #486.
 *
 * Resolved here, in one map, rather than by renaming the shipped field — the
 * id is in `evolution.html`, in `prompt-coaching-view.js`, and in the flow
 * tests that assert the original grading path still works, and renaming it to
 * satisfy a newer document would be changing step 1 to make step 2 tidier.
 * tests/prompt-revision-loop.test.js asserts every control the comparison
 * module can name resolves to a real node through this map.
 */
export const CONTROL_ALIASES = Object.freeze({
  "prompt-coaching-baseline-input": "prompt-coaching-input",
});

/** The sentence under the revision field. Says what the box is measured against. */
export const REVISION_HINT = "This starts as the prompt you graded above. Edit it, then "
  + "re-grade: the delta is always measured against that baseline, not against your "
  + "previous revision.";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shapeSpan(doc, glyph) {
  const shape = element(doc, "span", "prompt-coaching-shape", glyph);
  shape.setAttribute("aria-hidden", "true");
  return shape;
}

/** Write the live region only when the sentence changed; see prompt-coaching-view.js. */
function announce(doc, text) {
  const node = byId(doc, LIVE_ID);
  if (!node || node.textContent === text) return node;
  node.textContent = text;
  return node;
}

function state(section) {
  if (!section.__promptRevision) section.__promptRevision = { comparison: null, summary: "" };
  return section.__promptRevision;
}

/** The revision field's own validity, exactly as step 1 marks the baseline field. */
function markField(doc, invalid) {
  const field = byId(doc, INPUT_ID);
  if (!field) return;
  if (invalid) {
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", `${HINT_ID} ${RECOVERY_TEXT_ID}`);
    return;
  }
  field.removeAttribute("aria-invalid");
  field.setAttribute("aria-describedby", HINT_ID);
}

/** Focus a control the contract named, through the alias map. */
function focusControl(doc, control) {
  byId(doc, CONTROL_ALIASES[control] ?? control)?.focus?.();
}

function resetResult(doc) {
  for (const id of [RESULT_ID, EVIDENCE_ID]) {
    const node = byId(doc, id);
    if (node) {
      node.replaceChildren();
      node.hidden = true;
    }
  }
  const group = byId(doc, COPY_GROUP_ID);
  if (group) group.hidden = true;
  const status = byId(doc, COPY_STATUS_ID);
  if (status) {
    status.textContent = "";
    delete status.dataset.outcome;
  }
  const summary = byId(doc, SUMMARY_TEXT_ID);
  if (summary) summary.textContent = "";
}

// --- the states -------------------------------------------------------------

/**
 * Open step 2 against a freshly graded baseline.
 *
 * The revision field is *seeded* with the baseline text rather than merely
 * pointing at it: the reader's next act is to edit that text, and a field they
 * have to copy into first is a field most readers retype from scratch, which
 * turns a revision into an unrelated second prompt.
 *
 * A new baseline reseeds the field and discards any painted comparison, because
 * a delta measured against a baseline that has since been replaced is a number
 * about nothing.
 *
 * @returns the section, or null when the markup is absent.
 */
export function applyRevisionStep(doc, { baseline, text = "" } = {}) {
  const section = byId(doc, SECTION_ID);
  if (!section || !baseline) return null;
  state(section).comparison = null;
  state(section).summary = "";
  section.hidden = false;
  section.dataset.state = "ready";
  delete section.dataset.direction;
  delete section.dataset.reason;

  const field = byId(doc, INPUT_ID);
  if (field) field.value = text;
  markField(doc, false);
  paintBaseline(doc, baseline);
  resetResult(doc);
  announce(doc, "");
  return section;
}

/** Back to before a baseline existed: step 2 is not a thing on the page. */
export function clearRevision(doc) {
  const section = byId(doc, SECTION_ID);
  if (!section) return null;
  state(section).comparison = null;
  state(section).summary = "";
  section.hidden = true;
  section.dataset.state = "idle";
  delete section.dataset.direction;
  delete section.dataset.reason;
  const field = byId(doc, INPUT_ID);
  if (field) field.value = "";
  const baseline = byId(doc, BASELINE_ID);
  if (baseline) baseline.replaceChildren();
  markField(doc, false);
  resetResult(doc);
  announce(doc, "");
  return section;
}

/**
 * The grading state. Grading is synchronous, so this is measured in
 * microseconds in a browser — it exists because the button must not be
 * re-entrant and because a disabled control needs a state that says why.
 *
 * The button is disabled rather than hidden: a control that vanishes under a
 * keyboard user's focus drops them to the top of the document.
 */
export function setRevisionBusy(doc, busy) {
  const section = byId(doc, SECTION_ID);
  const button = byId(doc, REGRADE_ID);
  if (button) {
    button.disabled = Boolean(busy);
    button.setAttribute("aria-busy", busy ? "true" : "false");
  }
  if (section && busy) {
    section.dataset.state = "grading";
    announce(doc, "Grading your revision.");
  }
  return button;
}

/**
 * The state nothing plans for: the comparison module threw.
 *
 * `buildRevisionComparison` throws on a malformed session and on an internal
 * inconsistency (grade movement opposing composite movement). Neither should
 * reach a reader — but "should not" is not a state, and a surface without this
 * branch leaves a disabled button and a panel that never answers.
 */
export function applyRevisionError(doc, error) {
  const section = byId(doc, SECTION_ID);
  const body = byId(doc, RESULT_ID);
  if (!section || !body) return null;
  state(section).comparison = null;
  state(section).summary = "";
  section.dataset.state = "error";
  delete section.dataset.direction;
  section.dataset.reason = "comparison_failed";
  resetResult(doc);
  body.hidden = false;

  const block = element(doc, "div", "prompt-revision-recovery");
  const title = element(doc, "p", "prompt-coaching-recovery-title");
  title.append(shapeSpan(doc, "◆"),
    element(doc, "span", undefined, "This revision could not be compared."));
  const guidance = element(doc, "p", "prompt-coaching-recovery-guidance",
    "Nothing was sent or saved. Grade the prompt above again to start a new baseline, "
    + "then re-grade your revision.");
  guidance.id = RECOVERY_TEXT_ID;
  block.append(element(doc, "h4", "eyebrow", "Not compared"), title, guidance);
  // The message, never the stack: a thrown Error can carry a value a reader
  // pasted, and this surface does not print anything it did not compose.
  block.append(element(doc, "p", "prompt-coaching-recovery-observed",
    `Reported as: ${String(error?.name ?? "Error")}`));
  body.replaceChildren(block);
  markField(doc, true);
  announce(doc, "This revision could not be compared. Nothing was sent or saved. "
    + "Grade the prompt above again to start a new baseline.");
  focusControl(doc, INPUT_ID);
  return section;
}

/**
 * Paint a comparison, compared or abstained.
 *
 * @returns the comparison that was painted, so a caller asserts on the state it
 *   asked for rather than on the DOM it got.
 */
export function applyRevisionComparison(doc, comparison) {
  const section = byId(doc, SECTION_ID);
  const body = byId(doc, RESULT_ID);
  if (!section || !body || !comparison) return null;
  state(section).comparison = comparison;
  resetResult(doc);
  section.hidden = false;
  body.hidden = false;

  const { headline, grade, remainingWeakness, nextAction } = comparison.comparison;

  if (!comparison.compared) {
    section.dataset.state = "abstained";
    delete section.dataset.direction;
    section.dataset.reason = comparison.reason;
    body.replaceChildren(abstentionBlock(doc, comparison));
    paintEvidence(doc, comparison);
    markField(doc, comparison.reason === "revision_not_graded");
    announce(doc, `Not compared. ${nextAction.title} ${nextAction.guidance}`);
    // The one control that fixes it, focused rather than described.
    focusControl(doc, nextAction.control);
    return comparison;
  }

  section.dataset.state = "compared";
  section.dataset.direction = headline.direction;
  delete section.dataset.reason;
  body.replaceChildren(
    headlineBlock(doc, headline),
    gradeBlock(doc, grade),
    remainingBlock(doc, remainingWeakness),
    actionBlock(doc, nextAction),
  );
  paintEvidence(doc, comparison);
  paintCopy(doc, section, comparison);
  markField(doc, false);
  // Verdict, then the figure behind it, then the move — the same order the
  // single-prompt surface announces in, for the same reason.
  announce(doc, `${DIRECTION_COPY[headline.direction].word}. ${headline.text} `
    + `Letter grade ${grade.from} to ${grade.to}. Do this next: ${nextAction.title}`);
  return comparison;
}

// --- the blocks -------------------------------------------------------------

function paintBaseline(doc, baseline) {
  const host = byId(doc, BASELINE_ID);
  if (!host) return;
  const { benchmark, improvement } = baseline.result;
  const block = element(doc, "div", "prompt-revision-baseline-body");
  block.dataset.grade = benchmark.grade;
  block.append(
    element(doc, "h4", "eyebrow", "Your baseline"),
    element(doc, "p", "prompt-revision-baseline-text", benchmark.text),
  );
  // Exactly one improvement, carried down beside the box the reader edits in.
  // The guidance for it stays in step 1's result above; what is repeated here
  // is the title and the ready-to-edit rewrite, because the rewrite is the part
  // you paste into this field.
  const move = element(doc, "div", "prompt-revision-baseline-move");
  move.dataset.available = String(improvement.available);
  const title = element(doc, "p", "prompt-revision-baseline-move-title");
  title.append(shapeSpan(doc, improvement.available ? "▶" : "◇"),
    element(doc, "span", undefined, `Do this first: ${improvement.title}`));
  move.append(title);
  if (improvement.available) {
    move.append(element(doc, "pre", "prompt-coaching-rewrite-text", improvement.rewrite));
  }
  block.append(move);
  host.replaceChildren(block);
}

function headlineBlock(doc, headline) {
  const block = element(doc, "div", "prompt-revision-headline");
  block.dataset.direction = headline.direction;
  const verdict = element(doc, "p", "prompt-revision-verdict");
  verdict.append(shapeSpan(doc, DIRECTION_COPY[headline.direction].shape),
    element(doc, "span", undefined, DIRECTION_COPY[headline.direction].word));
  block.append(
    element(doc, "h4", "eyebrow", "Did my revised prompt improve?"),
    verdict,
    element(doc, "p", "prompt-revision-headline-text", headline.text),
  );
  return block;
}

function gradeBlock(doc, grade) {
  const block = element(doc, "div", "prompt-revision-grade");
  block.dataset.moved = String(grade.moved);
  block.dataset.from = grade.from;
  block.dataset.to = grade.to;

  // Decorative: the line under it says the same thing in words, and a screen
  // reader that read both would announce the band move twice.
  const figure = element(doc, "p", "prompt-revision-grade-figure", `${grade.from} → ${grade.to}`);
  figure.setAttribute("aria-hidden", "true");

  const steps = Math.abs(grade.bandDelta);
  const words = grade.moved
    ? `Letter grade ${grade.from} to ${grade.to} — ${grade.bandDelta > 0 ? "up" : "down"} `
      + `${steps} band${steps === 1 ? "" : "s"}.`
    : `Letter grade ${grade.from} to ${grade.to} — the same band. `
      + "A gain inside a band is real and is not a letter change.";
  block.append(figure, element(doc, "p", "prompt-revision-grade-text", words));
  return block;
}

/**
 * The remaining weakness, as a status. Never an instruction, and never with the
 * rewrite: `apply_remaining` names the same signal, and printing both would put
 * two identical-looking moves on the page a paragraph apart.
 */
function remainingBlock(doc, weakness) {
  const copy = REMAINING_STATUS_COPY[weakness.status];
  const block = element(doc, "div", "prompt-revision-remaining");
  block.dataset.status = weakness.status;
  const label = element(doc, "p", "prompt-revision-remaining-label");
  label.append(shapeSpan(doc, weakness.status === "none" ? "◇" : "●"),
    element(doc, "span", undefined, copy.label));
  block.append(
    element(doc, "h4", "eyebrow", "Am I fixing what I was told to fix?"),
    label,
    element(doc, "p", "prompt-revision-remaining-text", copy.text),
  );
  if (weakness.signalId) {
    block.append(element(doc, "p", "prompt-revision-remaining-signal",
      `${weakness.signalId} · ${weakness.axis} axis`));
  }
  return block;
}

/** The one action. Marked as such, so a test can count them. */
function actionBlock(doc, action) {
  const block = element(doc, "div", "prompt-revision-action");
  block.dataset.role = "next-action";
  block.dataset.kind = action.kind;
  const title = element(doc, "p", "prompt-revision-action-title");
  title.append(shapeSpan(doc, "▶"), element(doc, "span", undefined, action.title));
  block.append(
    element(doc, "h4", "eyebrow", "Do this next"),
    title,
    element(doc, "p", "prompt-revision-action-guidance", action.guidance),
  );
  if (action.rewrite) {
    block.append(
      element(doc, "p", "prompt-coaching-rewrite-label", "Ready-to-edit rewrite"),
      element(doc, "pre", "prompt-coaching-rewrite-text", action.rewrite),
    );
  }
  return block;
}

function abstentionBlock(doc, comparison) {
  const action = comparison.comparison.nextAction;
  const block = element(doc, "div", "prompt-revision-recovery");
  block.dataset.role = "next-action";
  block.dataset.kind = action.kind;
  block.dataset.reason = comparison.reason;
  const title = element(doc, "p", "prompt-coaching-recovery-title");
  title.append(shapeSpan(doc, "◆"), element(doc, "span", undefined, action.title));
  const guidance = element(doc, "p", "prompt-coaching-recovery-guidance", action.guidance);
  guidance.id = RECOVERY_TEXT_ID;
  block.append(element(doc, "h4", "eyebrow", "Not compared"), title, guidance);
  // The code, printed rather than translated: it is what a reader quotes.
  block.append(element(doc, "p", "prompt-coaching-recovery-observed",
    `Reason code: ${comparison.reason}`));
  return block;
}

/**
 * The dispute material: both sides, each rendered by the single-prompt
 * presentation model rather than by a second, thinner rendering written here.
 * Closed by default — a reader asked whether their rewrite worked, and the
 * answer to that is four lines, not two full result cards.
 */
function paintEvidence(doc, comparison) {
  const host = byId(doc, EVIDENCE_ID);
  if (!host) return;
  const wrap = element(doc, "div", "prompt-revision-evidence-body");
  for (const [label, session] of [["Baseline", comparison.baseline], ["Revision", comparison.revision]]) {
    const heading = element(doc, "h5", "eyebrow", `${label} · session ${session.sessionId}`);
    wrap.append(heading, renderCoachingResult(doc,
      presentCoachingResult({ status: session.outcome, session }),
      { idPrefix: `${EVIDENCE_ID}-${label.toLowerCase()}`, headingLevel: 6, labelledBy: null }));
  }
  host.hidden = false;
  host.replaceChildren(wrap);
}

// --- the copy control -------------------------------------------------------

/**
 * The summary is written into the page *before* anyone presses copy, and the
 * button describes it. Two reasons, and the second is the important one:
 *
 *   - When the clipboard is unavailable or denied, the recovery is "select it
 *     and copy it yourself", which needs the text to already be somewhere.
 *   - This workflow's only egress is the clipboard. A reader deciding whether
 *     to paste a grade into a team channel is entitled to read exactly what
 *     would land there first, rather than after.
 */
function paintCopy(doc, section, comparison) {
  const summary = revisionCopySummary(comparison);
  state(section).summary = summary;
  const text = byId(doc, SUMMARY_TEXT_ID);
  if (text) text.textContent = summary;
  const group = byId(doc, COPY_GROUP_ID);
  if (group) group.hidden = false;
  const button = byId(doc, COPY_BUTTON_ID);
  if (button) button.disabled = false;
}

/**
 * Run the copy and report which of three things happened.
 *
 * The button is disabled for the duration and re-enabled in a `finally`: a
 * rejected clipboard promise must not leave a dead control, and re-enabling is
 * what puts focus back in a working state for the keyboard user who is still
 * standing on it.
 *
 * @returns {Promise<"copied"|"failed"|"unavailable">}
 */
export async function runRevisionCopy(doc, clipboard) {
  const section = byId(doc, SECTION_ID);
  const status = byId(doc, COPY_STATUS_ID);
  const button = byId(doc, COPY_BUTTON_ID);
  const summary = section ? state(section).summary : "";
  if (!summary) return COPY_OUTCOME.failed;
  if (button) button.disabled = true;
  if (status) status.textContent = "";
  let outcome = COPY_OUTCOME.failed;
  try {
    outcome = await copyRevisionSummary(clipboard, summary);
  } finally {
    if (button) button.disabled = false;
  }
  if (status) {
    status.dataset.outcome = outcome;
    status.textContent = COPY_FEEDBACK[outcome];
  }
  return outcome;
}
