// The reading surface for a coached prompt.
//
// It takes the document rather than reading a global, exactly like
// `graded-sample-view.js`, so a test drives the shipped markup of
// evolution.html instead of a fixture authored for the test. Every node is
// built with createElement and textContent; there is no markup string, no
// innerHTML and no template interpolation on any path here. That matters more
// on this surface than on any other in the product: the input is prompt text a
// visitor pasted, and `innerHTML` anywhere in this file would be a script
// injection with a paste as its vector.
//
// Four rules this surface holds:
//
//   1. **The answer comes before the figure.** The reader asked "would a model
//      answer this well?" — a letter is the evidence for the answer, not the
//      answer. Answer, then benchmark, then the one thing to change; rubric
//      detail and reason codes live behind a disclosure.
//   2. **Nothing is signalled by tint alone.** Every state carries a word, and
//      a shape beside it. The letter itself is `aria-hidden`: the line under it
//      says the same thing in words, and a screen reader that read both would
//      announce the grade twice.
//   3. **A refusal is a state, not an empty panel.** Every reason code the
//      contract can return renders its own title, its recovery guidance, and a
//      focus move to the control that acts on it — and marks the field invalid
//      so the guidance is part of the field's accessible description.
//   4. **Nothing pasted is ever written back to the document.** The contract
//      returns numbers, identifiers, and static copy only, and this module
//      renders only what the contract returned.

import { COACHING_INPUT_LIMITS } from "./prompt-coaching.js";

const SECTION_ID = "prompt-coaching";
const RESULT_ID = "prompt-coaching-result";
const LIVE_ID = "prompt-coaching-live";
const INPUT_ID = "prompt-coaching-input";
const HINT_ID = "prompt-coaching-hint";
const RECOVERY_TEXT_ID = "prompt-coaching-recovery-guidance";
const TOGGLE_ID = "prompt-coaching-detail-toggle";
const PANEL_ID = "prompt-coaching-detail-panel";

/**
 * The limits, said once, where the reader types rather than in an error they
 * have to trigger. Built from the contract so the sentence cannot drift from
 * the number the contract enforces.
 */
export const INPUT_HINT = "Label turns “User:” and “Assistant:” to grade an exchange, or paste "
  + `one prompt on its own. Up to ${COACHING_INPUT_LIMITS.maxChars.toLocaleString("en-US")} `
  + `characters and ${COACHING_INPUT_LIMITS.maxTurns} turns.`;

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

/**
 * Write the live region only when the sentence actually changed. `paint` runs
 * again on every disclosure toggle, and rewriting a status region with the same
 * string announces the whole grade a second time because the reader opened a
 * panel.
 */
function announce(doc, text) {
  const node = byId(doc, LIVE_ID);
  if (!node || node.textContent === text) return node;
  node.textContent = text;
  return node;
}

function state(section) {
  if (!section.__promptCoaching) section.__promptCoaching = { result: null };
  return section.__promptCoaching;
}

/**
 * The field's own state. A refusal is a validation failure of the field the
 * reader typed into, so it is described by the field rather than only by a
 * paragraph somewhere below it: `aria-invalid` plus the guidance added to the
 * accessible description, which is what a screen reader reads on focus.
 */
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

/**
 * Paint a coaching result, graded or refused.
 *
 * @returns the result that was painted, so a caller asserts on the state it
 *   asked for rather than on the DOM it got.
 */
export function applyPromptCoaching(doc, result) {
  const section = byId(doc, SECTION_ID);
  if (!section || !result) return null;
  state(section).result = result;
  // A new result always opens closed: the reader asked a question, and the
  // answer to it is three lines, not a rubric.
  section.dataset.expanded = "false";
  paint(doc, section);
  return result;
}

/** Back to the idle state: no result, no announcement, no invalid field. */
export function clearPromptCoaching(doc) {
  const section = byId(doc, SECTION_ID);
  if (section) {
    state(section).result = null;
    section.dataset.state = "idle";
    section.dataset.expanded = "false";
    delete section.dataset.grade;
    delete section.dataset.reason;
  }
  const result = byId(doc, RESULT_ID);
  if (result) {
    result.replaceChildren();
    result.hidden = true;
  }
  markField(doc, false);
  announce(doc, "");
  return null;
}

function paint(doc, section) {
  const result = state(section).result;
  const body = byId(doc, RESULT_ID);
  if (!result || !body) return;
  body.hidden = false;
  section.dataset.state = result.state;

  if (!result.scored) {
    delete section.dataset.grade;
    section.dataset.reason = result.reason;
    body.replaceChildren(recoveryBlock(doc, result));
    markField(doc, true);
    announce(doc, `Not graded. ${result.recovery.title} ${result.recovery.guidance}`);
    byId(doc, result.recovery.control)?.focus?.();
    return;
  }

  delete section.dataset.reason;
  section.dataset.grade = result.benchmark.grade;
  body.replaceChildren(
    answerBlock(doc, result),
    benchmarkBlock(doc, result),
    improvementBlock(doc, result.improvement),
    disclosure(doc, section, result),
  );
  markField(doc, false);
  // The answer, the figure behind it, and the move — in that order, because a
  // reader who is not looking at the page needs the answer before the letter.
  announce(doc, `${result.answer} ${result.benchmark.text} `
    + `Do this first: ${result.improvement.title}`);

  const focusId = section.dataset.focusTarget;
  if (focusId) {
    delete section.dataset.focusTarget;
    byId(doc, focusId)?.focus?.();
  }
}

// --- the answer, the benchmark, the move ------------------------------------

function answerBlock(doc, result) {
  const block = element(doc, "p", "prompt-coaching-answer");
  block.append(shapeSpan(doc, "●"),
    element(doc, "span", "prompt-coaching-answer-words", result.answer));
  return block;
}

function benchmarkBlock(doc, result) {
  const block = element(doc, "div", "prompt-coaching-benchmark");
  block.dataset.grade = result.benchmark.grade;

  // Decorative: the line below repeats it in words.
  const letter = element(doc, "p", "prompt-coaching-letter", result.benchmark.grade);
  letter.setAttribute("aria-hidden", "true");

  const figure = element(doc, "div", "prompt-coaching-figure");
  figure.append(letter,
    element(doc, "p", "prompt-coaching-benchmark-text", result.benchmark.text));

  // The qualifier shares the bordered block with the letter, so a skimmer
  // cannot lift a grade out of the sentence saying what it is a grade of.
  const basis = element(doc, "p", "prompt-coaching-basis");
  basis.append(element(doc, "strong", "prompt-coaching-basis-label", result.basis.label),
    element(doc, "span", "prompt-coaching-basis-text", result.basis.text));
  block.append(figure, basis);
  return block;
}

function improvementBlock(doc, improvement) {
  const block = element(doc, "div", "prompt-coaching-improvement");
  block.dataset.available = String(improvement.available);
  block.dataset.kind = improvement.kind;
  const title = element(doc, "p", "prompt-coaching-improvement-title");
  title.append(shapeSpan(doc, improvement.available ? "▶" : "◇"),
    element(doc, "span", "prompt-coaching-improvement-words", improvement.title));
  block.append(
    element(doc, "h3", "eyebrow", "Do this first"),
    title,
    element(doc, "p", "prompt-coaching-improvement-guidance", improvement.guidance),
  );
  if (improvement.available) {
    const rewrite = element(doc, "div", "prompt-coaching-rewrite");
    rewrite.append(
      element(doc, "p", "prompt-coaching-rewrite-label", "Ready-to-edit rewrite"),
      element(doc, "pre", "prompt-coaching-rewrite-text", improvement.rewrite),
    );
    block.append(rewrite);
    // The estimate, with the word "about" in it. The contract does not model
    // the score clamp, and a figure printed to two decimals would claim it did.
    block.append(element(doc, "p", "prompt-coaching-improvement-worth",
      `${improvement.axis} axis · worth about ${Math.round(improvement.points)} `
      + `point${Math.round(improvement.points) === 1 ? "" : "s"} of the 0–100 composite`));
  }
  return block;
}

function recoveryBlock(doc, result) {
  const block = element(doc, "div", "prompt-coaching-recovery");
  block.dataset.reason = result.reason;
  const title = element(doc, "p", "prompt-coaching-recovery-title");
  title.append(shapeSpan(doc, "◆"),
    element(doc, "span", "prompt-coaching-recovery-words", result.recovery.title));
  const guidance = element(doc, "p", "prompt-coaching-recovery-guidance",
    result.recovery.guidance);
  guidance.id = RECOVERY_TEXT_ID;
  block.append(element(doc, "h3", "eyebrow", "Not graded"), title, guidance);
  // What was measured about the refusal, when there is anything to measure. A
  // ceiling a reader hit is a number, and naming it is how they know what to
  // trim to. Counts only: nothing here comes from what they pasted.
  const observed = observedLine(result);
  if (observed) block.append(element(doc, "p", "prompt-coaching-recovery-observed", observed));
  return block;
}

function observedLine(result) {
  const { chars, maxChars, turns, maxTurns } = result.observed ?? {};
  if (Number.isFinite(chars) && Number.isFinite(maxChars)) {
    return `${chars.toLocaleString("en-US")} characters pasted, `
      + `${maxChars.toLocaleString("en-US")} is the ceiling.`;
  }
  if (Number.isFinite(turns) && Number.isFinite(maxTurns)) {
    return `${turns} turns read, ${maxTurns} is the ceiling.`;
  }
  return null;
}

// --- progressive disclosure -------------------------------------------------
//
// The same trigger semantics as every other disclosure on this page: a real
// button that owns its panel, says whether it is open, starts closed, and takes
// focus back after the repaint.

function disclosure(doc, section, result) {
  const expanded = section.dataset.expanded === "true";
  const wrap = element(doc, "div", "prompt-coaching-disclosure");
  const toggle = element(doc, "button", "prompt-coaching-disclosure-toggle");
  toggle.id = TOGGLE_ID;
  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", PANEL_ID);
  toggle.textContent = `${expanded ? "Hide" : "Show"} how this grade was reached `
    + `(${result.detail.axes.length} axes, ${result.detail.turns.length} `
    + `turn${result.detail.turns.length === 1 ? "" : "s"})`;
  toggle.addEventListener("click", () => {
    section.dataset.expanded = expanded ? "false" : "true";
    section.dataset.focusTarget = TOGGLE_ID;
    paint(doc, section);
  });

  const panel = element(doc, "div", "prompt-coaching-disclosure-panel");
  panel.id = PANEL_ID;
  panel.hidden = !expanded;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "The rubric detail behind this grade");
  if (expanded) panel.append(...detailNodes(doc, result.detail));
  wrap.append(toggle, panel);
  return wrap;
}

function detailNodes(doc, detail) {
  const axes = element(doc, "dl", "prompt-coaching-axes");
  axes.setAttribute("aria-label", "Axis subscores");
  for (const axis of detail.axes) {
    axes.append(
      element(doc, "dt", undefined, `${axis.label} · ${axis.weightPercent}% of the composite`),
      element(doc, "dd", undefined, `${axis.score} / 100`),
    );
  }

  const turns = element(doc, "ul", "prompt-coaching-turns");
  turns.setAttribute("aria-label", "What the classifier read in each turn");
  for (const turn of detail.turns) {
    const item = element(doc, "li", "prompt-coaching-turn");
    item.dataset.scored = String(turn.scored);
    item.dataset.role = turn.role;
    item.append(
      element(doc, "span", "prompt-coaching-turn-index", `Turn ${turn.index + 1}`),
      element(doc, "span", "prompt-coaching-turn-role", turn.role),
      element(doc, "span", "prompt-coaching-turn-prose",
        `${turn.proseUnits} prose units, ${turn.codeBlocks} code, ${turn.pastedBlocks} pasted`),
      element(doc, "span", "prompt-coaching-turn-scored",
        turn.scored ? "graded" : "not graded"),
    );
    // Reason codes are the classifier's own identifiers. They are printed
    // verbatim rather than translated: a reader disputing a grade quotes a code
    // to a colleague, and a prettified sentence is not quotable.
    if (turn.reasonCodes.length) {
      item.append(element(doc, "span", "prompt-coaching-turn-codes",
        turn.reasonCodes.join(", ")));
    }
    turns.append(item);
  }

  const runnersUp = element(doc, "ol", "prompt-coaching-runners-up");
  runnersUp.setAttribute("aria-label", "The other changes this rubric would rank next");
  for (const entry of detail.improvements.slice(1)) {
    const item = element(doc, "li");
    item.dataset.kind = entry.kind;
    item.append(
      element(doc, "span", "prompt-coaching-runner-title", entry.title),
      element(doc, "span", "prompt-coaching-runner-points",
        `${entry.axis} · about ${Math.round(entry.points)} points`),
    );
    runnersUp.append(item);
  }

  const nodes = [
    element(doc, "h3", "eyebrow", "Axis subscores"), axes,
    element(doc, "h3", "eyebrow", "What was read"), turns,
  ];
  if (detail.improvements.length > 1) {
    nodes.push(element(doc, "h3", "eyebrow", "Ranked next"), runnersUp);
  }
  nodes.push(element(doc, "p", "prompt-coaching-rubric-version",
    `Rubric ${detail.rubricVersionId} · aggregation ${detail.aggregation.rule}`));
  return nodes;
}
