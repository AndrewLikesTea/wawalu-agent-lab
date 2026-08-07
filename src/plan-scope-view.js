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
// NO CONTROL OF ANY KIND. There is no input, no commit affordance and nothing
// stored: the only focusable this section adds is the disclosure's own summary,
// and it sits far below the first-run region so the first screen's tab order is
// untouched. A control here would promise a commitment this page cannot keep.
//
// No new styles — every class used already ships in evolution.css and styles.css.
// `createElement` and `textContent` only; no markup string, no innerHTML.

import { formatUsd } from "./evolution.js";
import {
  PLAN_GRADE_ABSENT, PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS, planScope,
} from "./plan-scope.js";

export const PLAN_SCOPE_SECTION_ID = "plan-scope";
export const PLAN_SCOPE_BODY_ID = "plan-scope-body";
export const PLAN_SCOPE_STATUS_ID = "plan-scope-status";
export const PLAN_SCOPE_FIGURE_ID = "plan-scope-figure";
export const PLAN_SCOPE_GRADE_ID = "plan-scope-grade";
export const PLAN_SCOPE_ACTION_ID = "plan-scope-action";
export const PLAN_SCOPE_DISTINCTION_ID = "plan-scope-distinction";

/** The words on the closed disclosure. It promises the facts, not a form. */
export const PLAN_SCOPE_DETAIL_SUMMARY =
  "What each modelled move would have to state to count as planned";

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
 */
function moveDisclosure(doc, model) {
  const detail = element(doc, "details", "completeness-detail");
  detail.dataset.moveCount = String(model.moves.length);
  const summary = element(doc, "summary");
  summary.setAttribute("aria-expanded", "false");
  summary.append(doc.createTextNode(
    `${PLAN_SCOPE_DETAIL_SUMMARY} (${model.moves.length})`));
  detail.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(detail.hasAttribute("open")));
  });
  const list = element(doc, "ol", "action-list");
  for (const move of model.moves) list.append(moveEntry(doc, move));
  detail.append(summary, element(doc, "p", "answer-figure-basis",
    "Each move needs the same three facts, and each fact has a default the silence carries."),
    list);
  return detail;
}

/** The planned figure at the numeral role. It is a commitment count, not a forecast. */
function plannedFigure(doc, model) {
  const figure = element(doc, "p", "answer-figure");
  figure.id = PLAN_SCOPE_FIGURE_ID;
  figure.dataset.committedCount = String(model.committedCount);
  figure.append(
    element(doc, "span", "answer-figure-label", model.figureLabel),
    element(doc, "strong", "answer-figure-value",
      `${formatUsd(model.plannedMonthlyUsd)} planned`),
  );
  return figure;
}

/**
 * The grade line. With nothing committed it states the ABSENCE and why, and
 * carries `data-grade="absent"` — never a fabricated score, and never a passing
 * one. With something committed it carries the weakest rung of the rate-card
 * ladder the page already ships, and the facts required to earn more.
 */
function gradeLine(doc, model) {
  const line = element(doc, "p", "answer-figure-basis");
  line.id = PLAN_SCOPE_GRADE_ID;
  if (!model.grade) {
    line.dataset.grade = "absent";
    line.textContent = `${PLAN_GRADE_ABSENT} ${model.gradeRequirement}`;
    return line;
  }
  line.dataset.grade = model.grade.tier;
  line.textContent = `Plan confidence: ${model.grade.marker} · ${model.grade.label}. `
    + `${model.gradeRequirement}`;
  return line;
}

/**
 * Paint the section from the slate already on screen.
 *
 * @param {Document} doc
 * @param {object|null} slate The slate `routing-slate-view.js` just painted.
 * @param {{commitments?: Array<object>}} [options] Commitments a lead has made.
 *   None exist: nothing on this page collects or retains one.
 * @returns the model that was painted, so a caller can assert on it.
 */
export function applyPlanScope(doc, slate, { commitments = [] } = {}) {
  const model = planScope(slate, { commitments });
  const section = doc?.getElementById?.(PLAN_SCOPE_SECTION_ID);
  const body = doc?.getElementById?.(PLAN_SCOPE_BODY_ID);
  if (!section || !body) return model;
  section.dataset.state = model.committedCount ? "committed" : "empty";
  section.dataset.moveCount = String(model.moves.length);
  section.dataset.committedCount = String(model.committedCount);
  const status = doc.getElementById?.(PLAN_SCOPE_STATUS_ID);
  if (status) {
    status.dataset.state = section.dataset.state;
    status.textContent = planScopeStatus(model);
  }

  const distinction = element(doc, "p", "answer-figure-basis", model.distinction);
  distinction.id = PLAN_SCOPE_DISTINCTION_ID;
  const action = element(doc, "p", "answer-figure-direction",
    `Do this first: ${model.nextAction}`);
  action.id = PLAN_SCOPE_ACTION_ID;

  body.replaceChildren(
    plannedFigure(doc, model),
    distinction,
    action,
    gradeLine(doc, model),
    moveDisclosure(doc, model),
  );
  return model;
}

export { PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS };
