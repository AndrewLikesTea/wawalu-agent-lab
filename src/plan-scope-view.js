// Paints the plan beside the diagnosis (#1286). It decides nothing: every
// figure, label and sentence below is read off `plan-scope.js`, which in turn
// enumerates the routing slate's own rules and no second list of moves.
//
// READING ORDER IS THE PRODUCT, and it is one question, one number, one action:
// the planned figure at the numeral role, then the sentence separating it from
// the recoverable headline above, then the single next ask, then the stated
// absence of a grade, then the moves the figure is the sum of, each with its
// four-step derivation one press away (#1287) — and only then, behind a
// collapsed disclosure, what each move would have to state to count.
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

import { formatPercent, formatUsd } from "./evolution.js";
import { FIGURE_SOURCE_DISCLOSURE } from "./finops-example-figure-sources.js";
import {
  PLAN_GRADE_ABSENT, PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS, planScope,
} from "./plan-scope.js";
import { PLAN_TOTAL_STEPS, RATE_CARD_BASIS } from "./plan-total.js";

export const PLAN_SCOPE_SECTION_ID = "plan-scope";
export const PLAN_SCOPE_BODY_ID = "plan-scope-body";
export const PLAN_SCOPE_STATUS_ID = "plan-scope-status";
export const PLAN_SCOPE_FIGURE_ID = "plan-scope-figure";
export const PLAN_SCOPE_GRADE_ID = "plan-scope-grade";
export const PLAN_SCOPE_ACTION_ID = "plan-scope-action";
export const PLAN_SCOPE_DISTINCTION_ID = "plan-scope-distinction";
export const PLAN_SCOPE_CONTRIBUTIONS_ID = "plan-scope-contributions";

/** The words on every per-move derivation, in the page's own provenance pattern. */
export const PLAN_TOTAL_WORKING_SUMMARY = "How we know this";

/** How the plan figure is arrived at, stated where the figure is (#1287). */
export const PLAN_TOTAL_RULE =
  "That figure is the sum of the moves listed below and of nothing else — each one's modelled "
  + "dollars taken at its applied scope, summed exactly, and rounded once here.";

/** Said in place of the list when nobody has committed anything. */
export const PLAN_TOTAL_EMPTY =
  "No move is in the plan, so there is nothing to sum and the recoverable total is $0.";

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

/**
 * A scope fraction as a percentage a reader can multiply by hand. Two decimals,
 * with an exact whole percent left whole — 18.75% has to survive, because the
 * derivation below is only checkable if the number in it is the one that was used.
 */
const scopeText = (scope) => formatPercent(scope, { digits: 2 }).replace(/\.00%$/, "%");

/** One step's line, from the record #1287 publishes. Four of these, in its order. */
function stepText(step, entry, basisText) {
  if (step.key === "rateCardBasis") return basisText;
  if (step.key === "modelledMove") {
    return `The whole move is modelled at ${formatUsd(entry.modelledMove)} a month at those `
      + "prices, before any scope is applied. This figure is the ranked slate's own, not a "
      + "second opinion about it.";
  }
  if (step.key === "appliedScope") {
    return entry.appliedScope === 0
      ? "No feasible scope is left once the excluded workloads and the refusing teams are taken "
        + "off the eligible base, so 0% of this move is committed."
      : `${scopeText(entry.appliedScope)} of the move is committed, after the workloads excluded `
        + "from the eligible base and the teams that have refused it.";
  }
  return `${formatUsd(entry.modelledMove)} x ${scopeText(entry.appliedScope)} = `
    + `${formatUsd(entry.contribution)} a month, exactly ${entry.contribution}. `
    + "The plan total is the unrounded sum of every line like this one.";
}

/**
 * The four-step derivation behind one move's dollars, in the page's own
 * disclosure pattern: the same element, the same state channels and the same
 * classes as the marker under the recoverable headline. The parts are #1287's
 * four steps rather than that marker's two terms, because what is being
 * explained is an arithmetic derivation and not a provenance — same control,
 * same shape, and the step order comes from `PLAN_TOTAL_STEPS` so it cannot
 * drift per surface.
 *
 * NOTHING LIVE GOES IN, here as everywhere else the pattern is used: a shut
 * disclosure is hidden from the accessibility tree, so an announcement inside one
 * is announced to nobody.
 */
function moveDerivation(doc, entry, basisText) {
  const detail = element(doc, "details", "figure-source");
  detail.dataset.disclosure = "collapsed";
  const summary = element(doc, "summary", "figure-source-summary");
  summary.setAttribute("aria-expanded", "false");
  const state = element(doc, "span", "figure-source-state");
  state.dataset.disclosure = "collapsed";
  const shape = element(doc, "span", "figure-source-shape", FIGURE_SOURCE_DISCLOSURE.shape);
  shape.setAttribute("aria-hidden", "true");
  state.append(shape, doc.createTextNode(` ${PLAN_TOTAL_WORKING_SUMMARY}`));
  summary.append(state);
  detail.addEventListener("toggle", () => {
    const open = detail.hasAttribute("open");
    detail.dataset.disclosure = open ? "expanded" : "collapsed";
    state.dataset.disclosure = detail.dataset.disclosure;
    summary.setAttribute("aria-expanded", String(open));
  });
  const list = element(doc, "dl", "figure-source-detail");
  for (const step of PLAN_TOTAL_STEPS) {
    const row = element(doc, "div");
    row.dataset.step = step.key;
    row.append(element(doc, "dt", null, step.label),
      element(doc, "dd", null, stepText(step, entry, basisText)));
    list.append(row);
  }
  detail.append(summary, list);
  return detail;
}

/**
 * One in-plan move: what it puts into the total, and the derivation behind it.
 * A move worth nothing at its feasible scope is LISTED AT $0 rather than dropped
 * — it was committed, and a plan that quietly stops showing a committed move
 * looks like a plan nobody made that commitment in.
 */
function contributionEntry(doc, entry, move, basisText) {
  const item = element(doc, "li");
  item.dataset.planMove = entry.leverId;
  item.dataset.contribution = String(entry.contribution);
  const heading = move
    ? `${move.rank}. ${move.source} → ${move.targetTier} tier`
    : entry.leverId;
  item.append(element(doc, "p", "answer-figure-basis",
    `${heading} — ${formatUsd(entry.contribution)} a month, `
    + `${scopeText(entry.appliedScope)} of ${formatUsd(entry.modelledMove)} modelled.`),
  moveDerivation(doc, entry, basisText));
  return item;
}

/**
 * Every in-plan move and what it contributes — and NOTHING ELSE. A move nobody
 * committed is not a zero row here: it is absent, because it is absent from the
 * total, and the disclosure below already says what it would have to state.
 */
function contributionList(doc, model) {
  const list = element(doc, "ul", "action-list");
  list.id = PLAN_SCOPE_CONTRIBUTIONS_ID;
  list.dataset.moveCount = String(model.total.moveCount);
  list.dataset.total = String(model.total.unroundedTotalUsd);
  list.dataset.basis = model.total.basis.source === RATE_CARD_BASIS.DECLARED
    ? "declared" : "list";
  if (!model.total.moveCount) {
    const empty = element(doc, "li", null, PLAN_TOTAL_EMPTY);
    empty.dataset.planEmpty = "true";
    list.append(empty);
    return list;
  }
  const committed = model.moves.filter((move) => move.committed);
  for (const [index, entry] of model.total.moves.entries()) {
    list.append(contributionEntry(doc, entry, committed[index] ?? null, model.total.basisText));
  }
  return list;
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
    // The parts of the figure, then what each move would have to state to count.
    element(doc, "p", "answer-figure-basis", `${PLAN_TOTAL_RULE} ${model.total.basisText}`),
    contributionList(doc, model),
    moveDisclosure(doc, model),
  );
  return model;
}

export { PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS };
