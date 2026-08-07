// Paints the plan beside the diagnosis (#1286). It decides nothing: every
// figure, label and sentence below is read off `plan-scope.js`, which in turn
// enumerates the routing slate's own rules and no second list of moves.
//
// READING ORDER IS THE PRODUCT, and it is one question, one number, one action:
// the planned figure at the numeral role, then the sentence separating it from
// the recoverable headline above, then the single next ask, then the stated
// absence of a grade — and only then, behind a collapsed disclosure, what each
// move would have to state to count.
//
// WHAT STAYS OUTSIDE THE DISCLOSURE: the status line (authored in evolution.html,
// a sibling of this body), the planned figure, the diagnosis-versus-plan
// sentence, the next action and the grade line. A real browser hides a closed
// disclosure's subtree from the accessibility tree, so a live region inside one
// is silently dropped; the harness models no layout and reads straight through,
// which is why this is a rule here rather than something a test catches.
//
// THE LEVERS ARE NOW CONTROLS (#1288), and every one of them sits in this
// section, far below the first-run region, so the first screen's tab order is
// byte-for-byte the one it had. Four per move: in-or-out, the re-routed share,
// the workloads excluded, and whether the owning team has refused. Each has a
// real <label for>, each is a native control the keyboard already reaches, and
// each takes the focus ring styles.css already gives every input.
//
// ONE RENDER PASS. A lever that changes recomputes the model ONCE and rewrites
// the figure, the committed count, the next action, the grade line, the status
// line and the per-move detail from that one model. Nothing is written twice
// and nothing is left a step behind, which is the whole reason `refresh` below
// is one function and not a listener per figure.
//
// A REFUSED VALUE RE-RENDERS NOTHING. `readSharePct` refuses out-of-range and
// non-numeric shares; this file then shows the message beside the field it names
// and stops. The controls are built once and updated in place, so a refusal — or
// any other change — cannot cost a lead the excluded workloads they typed, the
// refusal they marked, or another move's state.
//
// THE SCOPE OUTLIVES THE COMMITMENT. Entries live in a map keyed by document,
// never in the DOM of a node that may be rebuilt, so a move taken out of the
// plan and put back keeps its share, exclusions and refusal.
//
// No new styles — every class used already ships in evolution.css and styles.css.
// `createElement` and `textContent` only; no markup string, no innerHTML.

import { formatUsd } from "./evolution.js";
import {
  PLAN_GRADE_ABSENT, PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_SHARE_HINT,
  PLAN_SHARE_MAX, PLAN_SHARE_MIN, PLAN_VS_DIAGNOSIS, emptyPlanEntry, planEntryCommitments,
  planScope, readSharePct,
} from "./plan-scope.js";

export const PLAN_SCOPE_SECTION_ID = "plan-scope";
export const PLAN_SCOPE_BODY_ID = "plan-scope-body";
export const PLAN_SCOPE_STATUS_ID = "plan-scope-status";
export const PLAN_SCOPE_FIGURE_ID = "plan-scope-figure";
export const PLAN_SCOPE_GRADE_ID = "plan-scope-grade";
export const PLAN_SCOPE_ACTION_ID = "plan-scope-action";
export const PLAN_SCOPE_DISTINCTION_ID = "plan-scope-distinction";
export const PLAN_SCOPE_CONTROLS_ID = "plan-scope-controls";
export const PLAN_SCOPE_COMMITTED_ID = "plan-scope-committed";

/** Every control's id, so a test and a <label for> derive the same one. */
export const planControlId = (index, part) => `plan-move-${index + 1}-${part}`;

/** The words on the closed disclosure. It promises the facts, not a form. */
export const PLAN_SCOPE_DETAIL_SUMMARY =
  "What each modelled move would have to state to count as planned";

/** What the levers are for, and the one thing they deliberately do not move. */
export const PLAN_SCOPE_CONTROLS_INTRO =
  "Set the scope of each move you are actually committing to. Nothing here is sent or stored — "
  + "it is this browser session only, and the figures above rewrite as you go. Named exclusions "
  + "are recorded but do not reduce the planned dollars: this page collects no eligible workload "
  + "base to reduce, and an unreduced base is an unverified one.";

/**
 * The lead's entries, per document. Not per node and not in the DOM: a move
 * taken out of the plan keeps the scope already entered, and it has to survive a
 * repaint that rebuilds every node in this section.
 */
const entriesByDocument = new WeakMap();

export function planEntriesFor(doc) {
  const existing = entriesByDocument.get(doc);
  if (existing) return existing;
  const entries = new Map();
  entriesByDocument.set(doc, entries);
  return entries;
}

function entryFor(entries, key) {
  const existing = entries.get(key);
  if (existing) return existing;
  const entry = emptyPlanEntry();
  entries.set(key, entry);
  return entry;
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** How the plan stands, in one sentence, before any of it is read. */
export function planScopeStatus(model) {
  const total = formatUsd(model.plannedMonthlyUsd);
  if (!model.moves.length) {
    return `${total} planned: no routing move has been modelled yet, so there is nothing to `
      + "commit to.";
  }
  return `${total} planned. ${model.committedCount} of ${model.moves.length} modelled moves `
    + "are committed at a stated scope.";
}

/** One lever line: its name, its unit, and what the silence on it means. */
function leverLine(doc, lever) {
  const item = element(doc, "li");
  item.dataset.lever = lever.key;
  item.dataset.stated = String(lever.stated);
  item.textContent = lever.stated
    ? `${lever.name} — ${lever.unit}. Stated: ${lever.value}.`
    : `${lever.name} — ${lever.unit}. Not stated, so it counts as its default: `
      + `${lever.defaultWhenSilent}.`;
  return item;
}

/**
 * One move, with its three levers and the reason its modelled dollars are not
 * planned dollars. The rationale is the whole point of the row: a reader who
 * sees a modelled figure beside a zero has to be told which fact is missing.
 */
function moveEntry(doc, move) {
  const item = element(doc, "li");
  item.dataset.move = move.key;
  item.dataset.committed = String(move.committed);
  const modelled = formatUsd(move.modelledMonthlyUsd);
  const planned = formatUsd(move.plannedMonthlyUsd);
  const heading = element(doc, "p", "answer-figure-basis",
    `${move.rank}. ${move.source} → ${move.targetTier} tier · ${modelled} a month modelled, `
    + `${planned} planned.`);
  const rationale = element(doc, "p", "answer-figure-basis", move.committed
    ? `Committed${move.owner ? ` by ${move.owner}` : ""}. Planned dollars are this move's `
      + "modelled monthly figure taken at the committed share, after the excluded workloads "
      + "and refusing teams below."
    : "Nobody has committed this move, so its share is 0% and none of its modelled dollars "
      + "are planned.");
  const levers = element(doc, "ul", "action-list");
  for (const lever of move.levers) levers.append(leverLine(doc, lever));
  item.append(heading, rationale, levers);
  return item;
}

/**
 * The per-move detail, collapsed. `aria-expanded` is mirrored off the `toggle`
 * event rather than asserted once at build time, so the state a screen reader
 * reads is the state the element is actually in.
 *
 * Its list is refilled on every change rather than rebuilt: the disclosure and
 * its summary — the section's one pre-existing tab stop — are the same nodes all
 * session, so a reader who opened it is not closed out by a lever.
 */
function moveDisclosure(doc) {
  const detail = element(doc, "details", "completeness-detail");
  const summary = element(doc, "summary");
  summary.setAttribute("aria-expanded", "false");
  detail.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(detail.hasAttribute("open")));
  });
  const list = element(doc, "ol", "action-list");
  detail.append(summary, element(doc, "p", "answer-figure-basis",
    "Each move needs the same three facts, and each fact has a default the silence carries."),
    list);
  return { detail, summary, list };
}

/** One label, tied to its control by `for` — never a placeholder standing in. */
function labelFor(doc, id, text) {
  const label = element(doc, "label", null, text);
  label.setAttribute("for", id);
  return label;
}

/**
 * A checkbox and its label, in the shipped checkbox row: `.decision-picker-option`
 * is a grid whose first column is `auto`, which keeps a native checkbox its own
 * size under the `width:100%` styles.css gives every input. Reused, not restyled.
 */
function checkboxField(doc, id, text, checked, onChange) {
  const wrap = element(doc, "div", "decision-picker-option");
  const input = doc.createElement("input");
  input.setAttribute("type", "checkbox");
  input.id = id;
  if (checked) input.setAttribute("checked", "");
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onChange(input.checked));
  wrap.append(input, labelFor(doc, id, text));
  return { wrap, input };
}

/** A text field and its label, with the value a lead already entered restored. */
function textField(doc, id, text, value, onInput) {
  const wrap = element(doc, "div", "field");
  const input = doc.createElement("input");
  input.setAttribute("type", "text");
  input.id = id;
  input.setAttribute("value", value);
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  wrap.append(labelFor(doc, id, text), input);
  return { wrap, input };
}

/**
 * The share field: a text control with a numeric input mode, NOT `type=number`.
 * A number input silently discards what a browser cannot parse, so "one third"
 * would arrive here as an empty string and be read as silence — the refusal a
 * lead needs to see would never be shown outside a test harness. Owning the
 * check means the same value is refused, in the same words, everywhere.
 */
function shareField(doc, index, move, entry, refresh) {
  const id = planControlId(index, "share");
  const hintId = planControlId(index, "share-hint");
  const errorId = planControlId(index, "share-error");
  const wrap = element(doc, "div", "field");
  const input = doc.createElement("input");
  input.setAttribute("type", "text");
  input.setAttribute("inputmode", "decimal");
  input.setAttribute("aria-describedby", `${hintId} ${errorId}`);
  input.setAttribute("aria-invalid", "false");
  input.id = id;
  const value = entry.reroutedSharePct === null ? "" : String(entry.reroutedSharePct);
  input.setAttribute("value", value);
  input.value = value;

  const hint = element(doc, "p", "answer-figure-basis", PLAN_SHARE_HINT);
  hint.id = hintId;
  const error = element(doc, "p", "field-error");
  error.id = errorId;
  error.hidden = true;

  input.addEventListener("input", () => {
    const reading = readSharePct(input.value);
    if (!reading.ok) {
      // Refused: the message, and nothing else. No entry is cleared, no other
      // move is touched and the section is not re-rendered — the lead's own
      // words stay in the field they typed them into.
      error.textContent = reading.message;
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      return;
    }
    error.textContent = "";
    error.hidden = true;
    input.setAttribute("aria-invalid", "false");
    entry.reroutedSharePct = reading.value;
    refresh();
  });

  wrap.append(
    labelFor(doc, id, `Re-routed traffic share for ${move.source} → ${move.targetTier} tier, `
      + `${PLAN_SHARE_MIN} to ${PLAN_SHARE_MAX} percent`),
    input, hint, error,
  );
  return wrap;
}

/** One move's four levers, built once and updated in place from then on. */
function moveControls(doc, move, index, entry, refresh) {
  const item = element(doc, "li", "field");
  item.dataset.planMove = move.key;
  const heading = element(doc, "p", "answer-figure-basis",
    `${move.rank}. ${move.source} → ${move.targetTier} tier · `
    + `${formatUsd(move.modelledMonthlyUsd)} a month modelled.`);

  const commit = checkboxField(doc, planControlId(index, "commit"),
    `Commit ${move.source} → ${move.targetTier} tier to the plan`,
    entry.committed, (checked) => { entry.committed = checked; refresh(); });

  const exclusions = textField(doc, planControlId(index, "exclusions"),
    `Workloads excluded from ${move.source} → ${move.targetTier} tier `
    + "(comma-separated names, empty if none)",
    entry.excludedWorkloads, (value) => { entry.excludedWorkloads = value; refresh(); });

  const refusing = checkboxField(doc, planControlId(index, "refusing"),
    `${move.unit || move.source}'s team refuses this move`,
    entry.teamRefuses, (checked) => { entry.teamRefuses = checked; refresh(); });

  item.append(heading, commit.wrap, shareField(doc, index, move, entry, refresh),
    exclusions.wrap, refusing.wrap);
  return item;
}

/** The count of committed moves, as a sentence rather than a data attribute. */
function committedLine(model) {
  return `${model.committedCount} of ${model.moves.length} modelled moves `
    + `${model.committedCount === 1 ? "is" : "are"} in the plan.`;
}

/**
 * The grade line. With nothing committed it states the ABSENCE and why, and
 * carries `data-grade="absent"` — never a fabricated score, and never a passing
 * one. With something committed it carries the weakest rung of the rate-card
 * ladder the page already ships, and the facts required to earn more.
 */
function writeGrade(line, model) {
  if (!model.grade) {
    line.dataset.grade = "absent";
    line.textContent = `${PLAN_GRADE_ABSENT} ${model.gradeRequirement}`;
    return;
  }
  line.dataset.grade = model.grade.tier;
  line.textContent = `Plan confidence: ${model.grade.marker} · ${model.grade.label}. `
    + `${model.gradeRequirement}`;
}

/**
 * Paint the section from the slate already on screen, and wire its levers.
 *
 * @param {Document} doc
 * @param {object|null} slate The slate `routing-slate-view.js` just painted.
 * @param {{commitments?: Array<object>, entries?: Map<string, object>}} [options]
 *   `commitments` are commitments made elsewhere; `entries` is the lead's own
 *   session state, which defaults to the one this document already holds.
 * @returns the model that was painted, so a caller can assert on it.
 */
export function applyPlanScope(doc, slate, { commitments = [], entries } = {}) {
  const held = entries ?? planEntriesFor(doc);
  const compute = () => planScope(slate,
    { commitments: [...commitments, ...planEntryCommitments(held)] });
  let model = compute();
  const section = doc?.getElementById?.(PLAN_SCOPE_SECTION_ID);
  const body = doc?.getElementById?.(PLAN_SCOPE_BODY_ID);
  if (!section || !body) return model;
  const status = doc.getElementById?.(PLAN_SCOPE_STATUS_ID);

  const figure = element(doc, "p", "answer-figure");
  figure.id = PLAN_SCOPE_FIGURE_ID;
  const figureValue = element(doc, "strong", "answer-figure-value");
  figure.append(element(doc, "span", "answer-figure-label", model.figureLabel), figureValue);

  const committed = element(doc, "p", "answer-figure-basis");
  committed.id = PLAN_SCOPE_COMMITTED_ID;
  const distinction = element(doc, "p", "answer-figure-basis", model.distinction);
  distinction.id = PLAN_SCOPE_DISTINCTION_ID;
  const action = element(doc, "p", "answer-figure-direction");
  action.id = PLAN_SCOPE_ACTION_ID;
  const grade = element(doc, "p", "answer-figure-basis");
  grade.id = PLAN_SCOPE_GRADE_ID;
  const disclosure = moveDisclosure(doc);

  const controls = element(doc, "ol", "action-list");
  controls.id = PLAN_SCOPE_CONTROLS_ID;

  /**
   * ONE pass over ONE model. Every figure a lever moves — the total, the count,
   * the next action, the grade, the announcement and the per-move detail — is
   * written from the same recomputation, so no two of them can disagree and none
   * of them lands a step later than the others.
   */
  function refresh() {
    model = compute();
    section.dataset.state = model.committedCount ? "committed" : "empty";
    section.dataset.moveCount = String(model.moves.length);
    section.dataset.committedCount = String(model.committedCount);
    if (status) {
      status.dataset.state = section.dataset.state;
      status.textContent = planScopeStatus(model);
    }
    figure.dataset.committedCount = String(model.committedCount);
    figureValue.textContent = `${formatUsd(model.plannedMonthlyUsd)} planned`;
    committed.textContent = committedLine(model);
    action.textContent = `Do this first: ${model.nextAction}`;
    writeGrade(grade, model);
    disclosure.detail.dataset.moveCount = String(model.moves.length);
    disclosure.summary.textContent = `${PLAN_SCOPE_DETAIL_SUMMARY} (${model.moves.length})`;
    disclosure.list.replaceChildren(...model.moves.map((move) => moveEntry(doc, move)));
    for (const row of controls.children) {
      const move = model.moves.find((entry) => entry.key === row.dataset.planMove);
      if (!move) continue;
      row.dataset.committed = String(move.committed);
      row.dataset.planned = String(move.plannedMonthlyUsd);
    }
  }

  controls.append(...model.moves.map((move, index) =>
    moveControls(doc, move, index, entryFor(held, move.key), refresh)));

  body.replaceChildren(
    figure, committed, distinction, action, grade,
    element(doc, "p", "answer-figure-basis", PLAN_SCOPE_CONTROLS_INTRO),
    controls, disclosure.detail,
  );
  refresh();
  return model;
}

export { PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS };
