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
//   5. **A second grade answers a second question.** Re-grading is a comparison,
//      not a repeat, so it gets its own reading order above the result —
//      baseline, revised, the labelled delta, the rubric's confidence and
//      versions, one move — and the result below stands its own move down so
//      the surface still names exactly one.

import { COACHING_INPUT_LIMITS } from "./prompt-coaching.js";
import { buildRevisionComparison } from "./prompt-revision-comparison.js";
import { auditFigures } from "./coaching-result-presentation.js";
import { applyCoachingSummary } from "./coaching-summary-view.js";

const SECTION_ID = "prompt-coaching";
const RESULT_ID = "prompt-coaching-result";
const LIVE_ID = "prompt-coaching-live";
const INPUT_ID = "prompt-coaching-input";
const HINT_ID = "prompt-coaching-hint";
const RECOVERY_TEXT_ID = "prompt-coaching-recovery-guidance";
const TOGGLE_ID = "prompt-coaching-detail-toggle";
const PANEL_ID = "prompt-coaching-detail-panel";
const CUE_ID = "prompt-coaching-cue";
const CHANGE_ID = "prompt-coaching-change";
const CHANGE_HEADING_ID = "prompt-coaching-change-heading";
const CRITERIA_TOGGLE_ID = "prompt-coaching-criteria-toggle";
const CRITERIA_PANEL_ID = "prompt-coaching-criteria-panel";

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
  if (!section.__promptCoaching) section.__promptCoaching = { result: null, change: null };
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

// --- the change between two grades ------------------------------------------
//
// A reader who re-grades is not asking the first question again. They asked
// "would a model answer this well?", got a letter, changed the text, and now ask
// a second one: "did that help, and is it enough?". That question has its own
// reading order, and it is the one this block holds:
//
//   1. the baseline result, 2. the revised result, 3. the delta, labelled as
//   material or not rather than left as a signed number a reader has to rank,
//   4. the rubric's own confidence qualifier and the versions both grades ran
//   on, and 5. exactly one next move.
//
// The criterion-by-criterion movement is disclosure material, not answer
// material: it is what a reader opens to dispute the delta, and a reader who has
// to read four axis rows before learning whether they improved has been handed
// the ranking job the rubric already did.
//
// WHY THE MOVE LIVES HERE AND NOT IN THE RESULT BODY. When a comparison is on
// screen the body's own "Do this first" is suppressed (see `paint`), because
// after a revision the prioritised move is the comparison's — it knows the
// revision regressed, or that the same weakness went unaddressed, and the
// single-result block does not. Two next steps of equal weight is the failure
// this surface is designed against.
//
// PRIVACY. `buildRevisionComparison` consumes session envelopes, which carry
// measurements of the analyzed text and never the text. Nothing in this block
// reads a prompt, and the baseline a caller holds between grades is that same
// envelope — measurements, in this tab, for as long as the tab is open.

export const REVISION_STATUS = Object.freeze({
  pending: "pending",
  compared: "compared",
  abstained: "abstained",
  error: "error",
});

const CHANGE_HEADING = "What changed since your last grade";

/** Direction as a word and as a silhouette, so no tint carries the delta alone. */
const DIRECTION_SHAPE = Object.freeze({ improved: "▲", regressed: "▼", unchanged: "=" });

/**
 * The state a caller paints while a revision is being graded. `gradeMyPrompt` is
 * synchronous, so the shipped page never shows it — but a caller that grades off
 * the main thread has this state whether or not it is drawn, and a state that is
 * never drawn is a state that ships undesigned. Exported and rendered by
 * `markPromptCoachingPending`.
 */
export const REVISION_PENDING = Object.freeze({
  status: REVISION_STATUS.pending,
  shape: "◌",
  statusWord: "Grading the revision",
  reason: null,
  scores: Object.freeze([
    Object.freeze({ label: "Baseline", value: "—", pending: true }),
    Object.freeze({ label: "Revised", value: "—", pending: true }),
  ]),
  delta: Object.freeze({
    label: "Waiting for the revised grade",
    direction: null,
    material: false,
    withheld: false,
    value: "—",
    band: "The 0–100 scale and its bands are the rubric's; neither depends on what you pasted.",
  }),
  basis: null,
  provenance: null,
  action: Object.freeze({
    title: "Waiting for the grade before naming a next move.",
    guidance: "The rubric ranks every available change and names one. Naming a move before it has ranked them would be a guess.",
    rewrite: null,
    control: null,
  }),
  criteria: null,
  notices: Object.freeze([]),
  announcement: "Grading the revision. Nothing has been sent anywhere.",
});

/**
 * Two composites cannot differ by more than the scale they are measured on. The
 * shipped rubric clamps, so this never fires on a real pair — it fires the day a
 * caller hands this surface a figure that cannot be true, which is the day the
 * honest thing to draw is "out of range" rather than a confident arrow.
 */
function deltaBounds(delta) {
  if (Number.isFinite(delta) && Math.abs(delta) <= 100) return [];
  return [Object.freeze({
    code: "delta_out_of_range",
    label: "Points moved",
    value: String(delta),
    guidance: "Two 0–100 composites cannot differ by more than 100 points.",
  })];
}

/** Every criterion, baseline beside revised, with the direction spelled out. */
function criteriaRows(baseline, revision) {
  const before = new Map(baseline.result.detail.axes.map((axis) => [axis.key, axis.score]));
  return Object.freeze(revision.result.detail.axes.map((axis) => {
    const from = before.get(axis.key);
    const moved = Number.isFinite(from) ? axis.score - from : null;
    if (moved === null) {
      return Object.freeze({
        label: `${axis.label} · ${axis.weightPercent}% of the composite`,
        value: `${axis.score} / 100 · no baseline for this criterion`,
      });
    }
    const word = moved > 0 ? `up ${moved}` : moved < 0 ? `down ${Math.abs(moved)}` : "unchanged";
    return Object.freeze({
      label: `${axis.label} · ${axis.weightPercent}% of the composite`,
      value: `${from} → ${axis.score} / 100 · ${word}`,
    });
  }));
}

const criteriaSummary = (rows) => Object.freeze({
  summary: `${rows.length} ${rows.length === 1 ? "criterion" : "criteria"}`,
  rows,
});

const gradeLine = (session) =>
  `${session.result.benchmark.scoreText} · grade ${session.result.benchmark.grade}`;

function comparedChange(comparison) {
  const { baseline, revision } = comparison;
  const { headline, grade, nextAction } = comparison.comparison;
  const notices = Object.freeze([
    ...auditFigures(baseline), ...auditFigures(revision), ...deltaBounds(headline.delta),
  ]);
  // "Material" is the band moving, not a threshold this surface invented: the
  // band is what the rubric already treats as a difference in kind. A figure
  // out of range withdraws the claim entirely rather than softening it: a
  // caveat beside a direction is cropped by every skim, and a movement nobody
  // can trust is worse than no movement.
  const material = notices.length ? false : grade.moved;
  const label = notices.length
    ? "Movement not claimed"
    : material ? "Material change"
      : headline.delta === 0 ? "No change" : "Within the same grade band";
  return Object.freeze({
    status: REVISION_STATUS.compared,
    shape: notices.length ? "!" : DIRECTION_SHAPE[headline.direction],
    statusWord: "Compared with your last grade",
    reason: null,
    scores: Object.freeze([
      Object.freeze({ label: "Baseline", value: gradeLine(baseline), pending: false }),
      Object.freeze({ label: "Revised", value: gradeLine(revision), pending: false }),
    ]),
    delta: Object.freeze({
      label,
      direction: notices.length ? null : headline.direction,
      material,
      withheld: notices.length > 0,
      value: notices.length
        ? "Out of range — a figure behind this delta is outside the 0–100 scale, so no movement is claimed."
        : headline.text,
      band: notices.length
        ? "The letters below are unchanged and still readable."
        : material
          ? `Grade band moved ${grade.from} → ${grade.to}.`
          : `Grade band unchanged at ${grade.to}.`,
    }),
    basis: Object.freeze({
      label: revision.result.basis.label, text: revision.result.basis.text,
    }),
    provenance: `Both grades: rubric ${revision.result.rubricVersionId} · classifier `
      + `${revision.result.classifierVersion} · model tier `
      + `${revision.input.modelTier ?? "not specified"}`,
    action: Object.freeze({
      title: nextAction.title,
      guidance: nextAction.guidance,
      rewrite: nextAction.rewrite ?? null,
      control: nextAction.control ?? null,
    }),
    criteria: criteriaSummary(criteriaRows(baseline, revision)),
    notices,
    announcement: notices.length
      ? `${label}. A figure behind this delta is outside the 0–100 scale. `
        + `Do this next: ${nextAction.title}`
      : `${label}, ${headline.direction}. ${headline.text} `
        + `${material ? `Grade band moved ${grade.from} to ${grade.to}.` : "Grade band unchanged."} `
        + `Do this next: ${nextAction.title}`,
  });
}

/** The contract declined to compare. A reason code, and the move that fixes it. */
function abstainedChange(comparison) {
  const { nextAction } = comparison.comparison;
  return Object.freeze({
    status: REVISION_STATUS.abstained,
    shape: "◆",
    statusWord: "Not compared",
    reason: `Reason code ${comparison.reason}. No movement is claimed between two grades `
      + "this workflow cannot line up.",
    scores: Object.freeze([]),
    delta: null,
    basis: null,
    provenance: null,
    action: Object.freeze({
      title: nextAction.title,
      guidance: nextAction.guidance,
      rewrite: null,
      control: nextAction.control ?? null,
    }),
    criteria: null,
    notices: Object.freeze([]),
    announcement: `Not compared. ${nextAction.title} ${nextAction.guidance}`,
  });
}

/** The comparison could not be built at all. Still a drawn state, not a blank. */
const REVISION_ERROR = Object.freeze({
  status: REVISION_STATUS.error,
  shape: "■",
  statusWord: "Not compared",
  reason: "The two grades could not be lined up, so no movement is claimed. "
    + "The result below is still the rubric's reading of what is in the box.",
  scores: Object.freeze([]),
  delta: null,
  basis: null,
  provenance: null,
  action: Object.freeze({
    title: "Grade this text again on its own.",
    guidance: "Clear the panel and grade once more to start a fresh baseline to compare against.",
    rewrite: null,
    control: INPUT_ID,
  }),
  criteria: null,
  notices: Object.freeze([]),
  announcement: "Not compared. The two grades could not be lined up, so no movement is claimed.",
});

/**
 * Build the change model for one baseline/revision pair.
 *
 * @param {{comparisonId: string, baseline: object, revision: object}} pair two
 *   session envelopes from `buildCoachingSession`.
 * @returns {object} frozen, in one of `REVISION_STATUS`. Never throws: a pair the
 *   contract rejects becomes the drawn `error` state rather than an exception a
 *   page entry would have to translate into copy of its own.
 */
export function buildRevisionChange({ comparisonId, baseline, revision } = {}) {
  let comparison;
  try {
    comparison = buildRevisionComparison({ comparisonId, baseline, revision });
  } catch {
    return REVISION_ERROR;
  }
  return comparison.compared ? comparedChange(comparison) : abstainedChange(comparison);
}

/**
 * Paint a coaching result, graded or refused.
 *
 * @param {object} doc the document to paint into.
 * @param {object} result from `gradeMyPrompt`.
 * @param {{change?: object|null}} options `change` is a model from
 *   `buildRevisionChange`; pass it on a re-grade and the change hierarchy is
 *   painted above the result, focus moves to it, and the result's own next move
 *   stands down in favour of the comparison's.
 * @returns the result that was painted, so a caller asserts on the state it
 *   asked for rather than on the DOM it got.
 */
export function applyPromptCoaching(doc, result, { change = null } = {}) {
  const section = byId(doc, SECTION_ID);
  if (!section || !result) return null;
  const store = state(section);
  store.result = result;
  // A refusal has no revised grade to compare, so it keeps whatever baseline the
  // caller holds and claims no movement.
  store.change = result.scored ? change : null;
  // A new result always opens closed: the reader asked a question, and the
  // answer to it is three lines, not a rubric.
  section.dataset.expanded = "false";
  section.dataset.changeExpanded = "false";
  // Where a keyboard or screen-reader user lands after re-grading: on what
  // changed, which is the thing they pressed the button to find out.
  if (store.change) section.dataset.focusTarget = CHANGE_ID;
  paint(doc, section);
  return result;
}

/**
 * Draw the pending change state. For a caller that grades off the main thread:
 * the shipped page grades synchronously and never paints this.
 */
export function markPromptCoachingPending(doc) {
  const section = byId(doc, SECTION_ID);
  if (!section) return null;
  state(section).change = REVISION_PENDING;
  paintChange(doc, section);
  announce(doc, REVISION_PENDING.announcement);
  return REVISION_PENDING;
}

/** Back to the idle state: no result, no announcement, no invalid field. */
export function clearPromptCoaching(doc) {
  const section = byId(doc, SECTION_ID);
  if (section) {
    const store = state(section);
    store.result = null;
    store.change = null;
    section.dataset.state = "idle";
    section.dataset.expanded = "false";
    section.dataset.changeExpanded = "false";
    delete section.dataset.grade;
    delete section.dataset.reason;
    paintChange(doc, section);
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
  const { result, change } = state(section);
  const body = byId(doc, RESULT_ID);
  if (!result || !body) return;
  body.hidden = false;
  section.dataset.state = result.state;
  paintChange(doc, section);

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
    // Exactly one next move on the surface. When a comparison is painted above,
    // the prioritised move is its own — it knows the revision regressed or that
    // the same weakness went unaddressed, and this block does not.
    ...(change ? [] : [improvementBlock(doc, result.improvement)]),
    recommendationBlock(doc, result.recommendation),
    disclosure(doc, section, result),
  );
  markField(doc, false);
  // The answer, the figure behind it, and the move — in that order, because a
  // reader who is not looking at the page needs the answer before the letter.
  // After a re-grade the change leads instead: they already heard the answer
  // once, and what they pressed the button to find out is whether it moved.
  announce(doc, change
    ? `${change.announcement} ${result.answer}`
    : `${result.answer} ${result.benchmark.text} `
      + `Do this first: ${result.improvement.title}`);

  const focusId = section.dataset.focusTarget;
  if (focusId) {
    delete section.dataset.focusTarget;
    byId(doc, focusId)?.focus?.();
  }
}

// --- painting the change ----------------------------------------------------

/**
 * The change region and the first-time cue, which are two halves of one idea: a
 * visitor who has not re-graded yet is told they can, and a visitor who has is
 * shown what moved instead of being told again.
 *
 * The region carries `tabindex="-1"` in the markup so focus can land on it after
 * a re-grade; it is never in the tab sequence, so a reader who did not re-grade
 * never tabs through an empty landmark.
 */
function paintChange(doc, section) {
  const { change: model, result } = state(section);
  const cue = byId(doc, CUE_ID);
  if (cue) cue.hidden = Boolean(model);
  // The copyable record of this comparison. It lives outside the region because
  // its status line has to survive the region being replaced — see
  // `coaching-summary-view.js` — and it draws nothing unless a comparison was
  // actually made.
  applyCoachingSummary(doc, { change: model, result });
  const region = byId(doc, CHANGE_ID);
  if (!region) return;
  if (!model) {
    region.replaceChildren();
    region.hidden = true;
    region.removeAttribute("aria-labelledby");
    delete region.dataset.status;
    delete region.dataset.direction;
    delete region.dataset.implausible;
    return;
  }
  region.hidden = false;
  region.dataset.status = model.status;
  region.dataset.direction = model.delta?.direction ?? "none";
  region.dataset.implausible = String(model.notices.length > 0);
  region.setAttribute("aria-labelledby", CHANGE_HEADING_ID);
  region.replaceChildren(...changeNodes(doc, section, model));
}

function changeNodes(doc, section, model) {
  const heading = element(doc, "h3", "eyebrow", CHANGE_HEADING);
  heading.id = CHANGE_HEADING_ID;
  const status = element(doc, "p", "prompt-coaching-change-status");
  status.append(shapeSpan(doc, model.shape),
    element(doc, "strong", "prompt-coaching-change-status-word", model.statusWord));
  const nodes = [heading, status];
  if (model.reason) {
    nodes.push(element(doc, "p", "prompt-coaching-change-reason", model.reason));
  }
  if (model.scores.length) nodes.push(changeScores(doc, model.scores));
  if (model.delta) nodes.push(changeDelta(doc, model));
  if (model.notices.length) nodes.push(changeNotices(doc, model.notices));
  if (model.basis) {
    const basis = element(doc, "p", "prompt-coaching-basis");
    basis.append(element(doc, "strong", "prompt-coaching-basis-label", model.basis.label),
      element(doc, "span", "prompt-coaching-basis-text", model.basis.text));
    nodes.push(basis);
  }
  if (model.provenance) {
    nodes.push(element(doc, "p", "prompt-coaching-change-provenance", model.provenance));
  }
  nodes.push(changeAction(doc, model.action));
  if (model.criteria) nodes.push(criteriaDisclosure(doc, section, model.criteria));
  return nodes;
}

/** Baseline, then revised. Labelled figures, so the pair survives being read. */
function changeScores(doc, scores) {
  const list = element(doc, "dl", "prompt-coaching-change-scores");
  list.setAttribute("aria-label", "The baseline grade and the revised grade");
  for (const score of scores) {
    const value = element(doc, "dd", undefined, score.value);
    if (score.pending) value.dataset.pending = "true";
    list.append(element(doc, "dt", undefined, score.label), value);
  }
  return list;
}

/**
 * The delta, said four ways: a silhouette, a materiality word, a direction word,
 * and the figures. The tint behind it is the fourth cue, never the first.
 */
function changeDelta(doc, model) {
  const delta = element(doc, "p", "prompt-coaching-change-delta");
  delta.dataset.direction = model.delta.direction ?? "none";
  delta.dataset.material = String(model.delta.material);
  if (model.delta.withheld) delta.dataset.implausible = "true";
  delta.append(
    shapeSpan(doc, model.shape),
    element(doc, "strong", "prompt-coaching-change-delta-label", model.delta.label),
  );
  if (model.delta.direction) {
    delta.append(element(doc, "span", "prompt-coaching-change-delta-direction",
      model.delta.direction));
  }
  delta.append(
    element(doc, "span", "prompt-coaching-change-delta-value", model.delta.value),
    element(doc, "span", "prompt-coaching-change-delta-band", model.delta.band),
  );
  return delta;
}

function changeNotices(doc, notices) {
  const list = element(doc, "ul", "prompt-coaching-change-notices");
  list.setAttribute("aria-label", "Figures outside their range");
  for (const notice of notices) {
    const item = element(doc, "li");
    item.dataset.code = notice.code;
    item.append(
      shapeSpan(doc, "!"),
      element(doc, "span", "prompt-coaching-change-notice-label",
        `Check this figure — ${notice.label}: ${notice.value}.`),
      element(doc, "span", "prompt-coaching-change-notice-guidance", notice.guidance),
    );
    list.append(item);
  }
  return list;
}

function changeAction(doc, action) {
  const block = element(doc, "div", "prompt-coaching-change-action");
  const title = element(doc, "p", "prompt-coaching-change-action-title");
  title.append(shapeSpan(doc, "▶"),
    element(doc, "span", "prompt-coaching-change-action-words", action.title));
  block.append(
    element(doc, "h4", "eyebrow", "Do this next"),
    title,
    element(doc, "p", "prompt-coaching-change-action-guidance", action.guidance),
  );
  if (action.rewrite) {
    const rewrite = element(doc, "div", "prompt-coaching-rewrite");
    rewrite.append(
      element(doc, "p", "prompt-coaching-rewrite-label", "Ready-to-edit rewrite"),
      element(doc, "pre", "prompt-coaching-rewrite-text", action.rewrite),
    );
    block.append(rewrite);
  }
  return block;
}

/**
 * Criterion-level movement, disclosed. Same trigger semantics as the rubric
 * disclosure below: a real button that owns its panel, says whether it is open,
 * starts closed, and takes focus back after the repaint.
 */
function criteriaDisclosure(doc, section, criteria) {
  const expanded = section.dataset.changeExpanded === "true";
  const wrap = element(doc, "div", "prompt-coaching-disclosure");
  const toggle = element(doc, "button", "prompt-coaching-disclosure-toggle");
  toggle.id = CRITERIA_TOGGLE_ID;
  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", CRITERIA_PANEL_ID);
  toggle.textContent = `${expanded ? "Hide" : "Show"} what moved criterion by criterion `
    + `(${criteria.summary})`;
  toggle.addEventListener("click", () => {
    section.dataset.changeExpanded = expanded ? "false" : "true";
    section.dataset.focusTarget = CRITERIA_TOGGLE_ID;
    paint(doc, section);
  });

  const panel = element(doc, "div", "prompt-coaching-disclosure-panel");
  panel.id = CRITERIA_PANEL_ID;
  panel.hidden = !expanded;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "What moved on each rubric criterion");
  if (expanded) {
    const rows = element(doc, "dl", "prompt-coaching-axes");
    rows.setAttribute("aria-label", "Criterion subscores, baseline beside revised");
    for (const row of criteria.rows) {
      rows.append(element(doc, "dt", undefined, row.label),
        element(doc, "dd", undefined, row.value));
    }
    panel.append(rows);
  }
  wrap.append(toggle, panel);
  return wrap;
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

/**
 * The routing answer. Rendered for every graded result including the two that
 * recommend nothing, because "no model-fit signal fired" is an answer to the
 * question a reader came with and a missing block is not.
 *
 * Nothing is composed here. The title and the sentence are the contract's,
 * which is where the rule that a routing claim may only restate a fired signal
 * is stated and tested; a surface that reworded them would be the second place
 * that rule could be broken.
 */
function recommendationBlock(doc, recommendation) {
  const block = element(doc, "div", "prompt-coaching-recommendation");
  block.dataset.state = recommendation.state;
  block.dataset.direction = recommendation.direction;
  block.dataset.evidenced = String(recommendation.evidenced);
  const title = element(doc, "p", "prompt-coaching-recommendation-title");
  title.append(shapeSpan(doc, recommendation.evidenced ? "▲" : "◇"),
    element(doc, "span", "prompt-coaching-recommendation-words", recommendation.title));
  block.append(
    element(doc, "h3", "eyebrow", "Model tier"),
    title,
    element(doc, "p", "prompt-coaching-recommendation-text", recommendation.text),
  );
  // The signal id, printed rather than translated, for the same reason the turn
  // reason codes are: a reader disputing a routing recommendation quotes it.
  if (recommendation.evidenced) {
    block.append(element(doc, "p", "prompt-coaching-recommendation-basis",
      `Evidence: ${recommendation.signalId} on turn ${recommendation.turn + 1}`));
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
