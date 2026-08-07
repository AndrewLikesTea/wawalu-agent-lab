// Paints the plan beside the diagnosis (#1286), and lets a lead move its scope
// levers and watch the total answer (#1288). It decides nothing: every figure,
// label and sentence below is read off `plan-scope.js`, and every lever a reader
// moves is turned into that module's own commitment shape by
// `plan-scope-levers.js`. No dollar, grade or threshold is computed here.
//
// READING ORDER IS THE PRODUCT, and it is one question, one number, one action:
// the planned figure at the numeral role, then the sentence separating it from
// the recoverable headline above, then the single next ask, then the grade line
// — and only then, behind a collapsed disclosure, each move with the levers that
// scope it.
//
// WHAT STAYS OUTSIDE THE DISCLOSURE: the status line (authored in evolution.html,
// a sibling of this body), the planned figure, the diagnosis-versus-plan
// sentence, the next action and the grade line. A real browser hides a closed
// disclosure's subtree from the accessibility tree, so a live region inside one
// is silently dropped; the harness models no layout and reads straight through,
// which is why this is a rule here rather than something a test catches.
//
// WHERE THE CONTROLS LIVE, and why. Every lever sits INSIDE that disclosure, so
// the only tab stop this section adds while collapsed is the summary itself and
// the first screen's tab order is untouched. The announcement goes the other
// way: it is written to `#plan-scope-status`, the page's own `role="status"`
// region, which is authored outside every disclosure. There is exactly one live
// region for this section and this file adds no second one.
//
// A MOVED LEVER REWRITES TEXT, NOT MARKUP. Recomputing replaces the words in
// nodes that already exist rather than rebuilding the body, so a lead's focus
// stays in the field they are typing in and the disclosure they opened stays
// open. Nothing is stored beyond the document: the scope is retained for the
// session, and a reload starts empty.
//
// No new styles — every class used already ships in evolution.css and styles.css.
// `createElement` and `textContent` only; no markup string, no innerHTML.

import { formatUsd } from "./evolution.js";
import {
  FEASIBLE_SHARE_MAX, FEASIBLE_SHARE_MIN, emptyMoveScope, feasibleShareRefusal, planCommitments,
  readFeasibleShare,
} from "./plan-scope-levers.js";
import {
  PLAN_GRADE_ABSENT, PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS, planMoveKey,
  planScope,
} from "./plan-scope.js";

export const PLAN_SCOPE_SECTION_ID = "plan-scope";
export const PLAN_SCOPE_BODY_ID = "plan-scope-body";
export const PLAN_SCOPE_STATUS_ID = "plan-scope-status";
export const PLAN_SCOPE_FIGURE_ID = "plan-scope-figure";
export const PLAN_SCOPE_GRADE_ID = "plan-scope-grade";
export const PLAN_SCOPE_ACTION_ID = "plan-scope-action";
export const PLAN_SCOPE_DISTINCTION_ID = "plan-scope-distinction";

/** The words on the closed disclosure. It promises the levers, and holds them. */
export const PLAN_SCOPE_DETAIL_SUMMARY =
  "Scope each modelled move: the share, the excluded workloads and the refusals";

/** Every control id derives from here, so a label and its field cannot drift. */
export const planLeverId = (index, part) => `plan-lever-${index}-${part}`;

/** What the lead is scoping, said the way the page says it everywhere else. */
export const moveName = (move) => (move.source === move.unit
  ? `${move.source} → ${move.targetTier} tier`
  : `${move.source} → ${move.targetTier} tier in ${move.unit}`);

/**
 * The scope a lead has stated, per document, keyed by the slate's own move key.
 *
 * Per DOCUMENT rather than per module: two pages never share one lead's answers,
 * and — the reason it matters in practice — taking a move OUT of the plan leaves
 * its entry here untouched, so putting it back restores the share, the excluded
 * workloads and the refusal without a word being retyped.
 */
const SESSION_SCOPES = new WeakMap();

function sessionScopes(doc) {
  if (!SESSION_SCOPES.has(doc)) SESSION_SCOPES.set(doc, new Map());
  return SESSION_SCOPES.get(doc);
}

function scopeFor(scopes, key) {
  if (!scopes.has(key)) scopes.set(key, emptyMoveScope());
  return scopes.get(key);
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
function paintLever(item, lever) {
  item.dataset.lever = lever.key;
  item.dataset.stated = String(lever.stated);
  item.textContent = lever.stated
    ? `${lever.name} — ${lever.unit}. Stated: ${lever.value}.`
    : `${lever.name} — ${lever.unit}. Not stated, so it counts as its default: `
      + `${lever.defaultWhenSilent}.`;
}

/**
 * One labelled field. The label is a real element tied by `for`/`id` in every
 * case, including the checkboxes: an accessible name inferred from wrapping is
 * one refactor away from being lost, and this page has to survive that.
 */
function field(doc, { id, type, className, labelText, checked = false }) {
  const wrapper = element(doc, "p", className);
  const input = doc.createElement("input");
  input.id = id;
  input.setAttribute("type", type);
  if (type === "checkbox" && checked) input.checked = true;
  const label = element(doc, "label", null, labelText);
  label.setAttribute("for", id);
  // Checkbox first, then its words; text field after its label. Both are the
  // order the rest of the site already paints, so the focus ring lands where a
  // reader expects it.
  if (type === "checkbox") wrapper.append(input, label);
  else wrapper.append(label, input);
  return { wrapper, input, label };
}

/**
 * The four levers for one move: in or out of the plan, the share the lead thinks
 * is actually feasible, the workloads they are excluding, and whether a team has
 * refused. Each one recomputes the whole section through `plan-scope.js`.
 */
function moveControls(doc, move, index, scope, recompute) {
  const name = moveName(move);
  const group = element(doc, "div");
  group.dataset.moveControls = move.key;

  const commit = field(doc, {
    id: planLeverId(index, "commit"),
    type: "checkbox",
    className: "filter-option",
    labelText: `Commit ${name} to the plan`,
    checked: scope.inPlan,
  });
  commit.input.addEventListener("change", () => {
    scope.inPlan = Boolean(commit.input.checked);
    recompute();
  });

  // TEXT, NOT NUMBER, and the range said in the label instead of declared to a
  // stepper. A real `type="number"` field reports an EMPTY value for anything it
  // cannot parse, so "half" would reach this page as a cleared field: the lead's
  // entry would vanish and the refusal below could never fire. A numeric
  // inputmode still raises the digit keypad on a phone.
  const share = field(doc, {
    id: planLeverId(index, "share"),
    type: "text",
    className: null,
    labelText:
      `Feasible share for ${name} — whole percent, ${FEASIBLE_SHARE_MIN} to ${FEASIBLE_SHARE_MAX}`,
  });
  share.input.className = "figure-corrections-input";
  share.input.setAttribute("inputmode", "numeric");
  share.input.value = scope.sharePct === null ? "" : String(scope.sharePct);
  const refusal = element(doc, "p", "field-error");
  refusal.id = planLeverId(index, "share-error");
  refusal.hidden = true;
  share.input.addEventListener("input", () => {
    // The typed text is NEVER touched here, accepted or refused. A field that
    // rewrites itself under a lead's cursor loses the entry they were fixing.
    const read = readFeasibleShare(share.input.value);
    if (read.accepted) {
      scope.sharePct = read.stated ? read.value : null;
      refusal.hidden = true;
      refusal.textContent = "";
      share.input.removeAttribute("aria-invalid");
      share.input.removeAttribute("aria-describedby");
      recompute();
      return;
    }
    // Refused: the last accepted share still stands, every other lever on every
    // other move is untouched, and the section is not recomputed — because
    // nothing it computes from has changed.
    refusal.textContent = feasibleShareRefusal(name);
    refusal.hidden = false;
    share.input.setAttribute("aria-invalid", "true");
    share.input.setAttribute("aria-describedby", refusal.id);
    recompute({ refused: refusal.textContent });
  });

  const excluded = field(doc, {
    id: planLeverId(index, "excluded"),
    type: "text",
    className: null,
    labelText: `Workloads excluded from ${name} — names separated by commas, or “none”`,
  });
  excluded.input.className = "figure-corrections-input";
  excluded.input.value = scope.excludedText;
  excluded.input.addEventListener("input", () => {
    scope.excludedText = excluded.input.value;
    recompute();
  });

  const refuses = field(doc, {
    id: planLeverId(index, "refuses"),
    type: "checkbox",
    className: "filter-option",
    labelText: `A team has refused ${name}`,
    checked: scope.refuses,
  });
  refuses.input.addEventListener("change", () => {
    scope.refuses = Boolean(refuses.input.checked);
    recompute();
  });

  group.append(commit.wrapper, share.wrapper, refusal, excluded.wrapper, refuses.wrapper);
  return group;
}

/**
 * One move, with its levers, its controls, and the reason its modelled dollars
 * are not planned dollars. The rationale is the whole point of the row: a reader
 * who sees a modelled figure beside a zero has to be told which fact is missing.
 */
function moveEntry(doc, move, index, scopes, recompute) {
  const item = element(doc, "li");
  item.dataset.move = move.key;
  const heading = element(doc, "p", "answer-figure-basis");
  const rationale = element(doc, "p", "answer-figure-basis");
  const levers = element(doc, "ul", "action-list");
  const leverItems = move.levers.map(() => {
    const line = element(doc, "li");
    levers.append(line);
    return line;
  });
  item.append(heading, rationale, levers,
    moveControls(doc, move, index, scopeFor(scopes, move.key), recompute));
  return {
    node: item,
    update(next) {
      item.dataset.committed = String(next.committed);
      heading.textContent =
        `${next.rank}. ${next.source} → ${next.targetTier} tier · `
        + `${formatUsd(next.modelledMonthlyUsd)} a month modelled, `
        + `${formatUsd(next.plannedMonthlyUsd)} planned.`;
      rationale.textContent = next.committed
        ? `Committed${next.owner ? ` by ${next.owner}` : ""}. Planned dollars are this move's `
          + "modelled monthly figure taken at the committed share, after the excluded workloads "
          + "and refusing teams below."
        : "This move is not in the plan, so its share is 0% and none of its modelled dollars "
          + "are planned. Anything already entered for it is kept.";
      next.levers.forEach((lever, position) => paintLever(leverItems[position], lever));
    },
  };
}

/**
 * The per-move detail, collapsed, and every control on this surface with it.
 * `aria-expanded` is mirrored off the `toggle` event rather than asserted once at
 * build time, so the state a screen reader reads is the state the element is
 * actually in.
 */
function moveDisclosure(doc, model, scopes, recompute) {
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
  const rows = model.moves.map((move, index) => {
    const row = moveEntry(doc, move, index, scopes, recompute);
    list.append(row.node);
    return row;
  });
  detail.append(summary, element(doc, "p", "answer-figure-basis",
    "Each move needs the same three facts, and each fact has a default the silence carries. "
    + "Naming an excluded workload does not shrink the dollars — this page does not know how "
    + "many workloads a move is eligible for — but a refusing team removes the move's whole "
    + "figure, because a slate rule names one org unit."),
    list);
  return { node: detail, rows };
}

/** The planned figure at the numeral role. It is a commitment count, not a forecast. */
function plannedFigure(doc, model) {
  const figure = element(doc, "p", "answer-figure");
  figure.id = PLAN_SCOPE_FIGURE_ID;
  const label = element(doc, "span", "answer-figure-label", model.figureLabel);
  const value = element(doc, "strong", "answer-figure-value");
  figure.append(label, value);
  return {
    node: figure,
    update(next) {
      figure.dataset.committedCount = String(next.committedCount);
      value.textContent = `${formatUsd(next.plannedMonthlyUsd)} planned`;
    },
  };
}

/**
 * The grade line. With nothing committed it states the ABSENCE and why, and
 * carries `data-grade="absent"` — never a fabricated score, and never a passing
 * one. With something committed it carries the weakest rung of the rate-card
 * ladder the page already ships, and the facts required to earn more.
 */
function gradeLine(doc) {
  const line = element(doc, "p", "answer-figure-basis");
  line.id = PLAN_SCOPE_GRADE_ID;
  return {
    node: line,
    update(next) {
      if (!next.grade) {
        line.dataset.grade = "absent";
        line.textContent = `${PLAN_GRADE_ABSENT} ${next.gradeRequirement}`;
        return;
      }
      line.dataset.grade = next.grade.tier;
      line.textContent = `Plan confidence: ${next.grade.marker} · ${next.grade.label}. `
        + `${next.gradeRequirement}`;
    },
  };
}

/**
 * Paint the section from the slate already on screen, and keep painting it as a
 * lead moves the levers.
 *
 * @param {Document} doc
 * @param {object|null} slate The slate `routing-slate-view.js` just painted.
 * @param {{commitments?: Array<object>}} [options] Commitments from a caller.
 *   The lead's own levers are read on top of these, so a move they have scoped
 *   here wins over a seeded commitment for the same move.
 * @returns the model that was painted, so a caller can assert on it.
 */
export function applyPlanScope(doc, slate, { commitments = [] } = {}) {
  const scopes = sessionScopes(doc);
  const keys = (slate?.rules ?? []).map((rule) => ({ key: planMoveKey(rule) }));
  const compose = () => planScope(slate, {
    commitments: [...commitments, ...planCommitments(scopes, keys)],
  });

  let model = compose();
  const section = doc?.getElementById?.(PLAN_SCOPE_SECTION_ID);
  const body = doc?.getElementById?.(PLAN_SCOPE_BODY_ID);
  if (!section || !body) return model;
  const status = doc.getElementById?.(PLAN_SCOPE_STATUS_ID);

  const distinction = element(doc, "p", "answer-figure-basis", model.distinction);
  distinction.id = PLAN_SCOPE_DISTINCTION_ID;
  const action = element(doc, "p", "answer-figure-direction");
  action.id = PLAN_SCOPE_ACTION_ID;

  // Every part that changes when a lever moves, and nothing else. `recompute`
  // rewrites their words in place; the controls above are never rebuilt.
  const figure = plannedFigure(doc, model);
  const grade = gradeLine(doc);

  /**
   * One visible step: the total, the committed count, the next action and the
   * per-move rows all move together, and the page's own status region says so.
   *
   * A refused entry passes its message through here rather than through a second
   * live region — the figure it reports is the one still standing, so a reader
   * who cannot see the inline refusal is told both what was rejected and that
   * nothing else changed.
   */
  const recompute = ({ refused = "" } = {}) => {
    model = compose();
    section.dataset.state = model.committedCount ? "committed" : "empty";
    section.dataset.moveCount = String(model.moves.length);
    section.dataset.committedCount = String(model.committedCount);
    figure.update(model);
    grade.update(model);
    action.textContent = `Do this first: ${model.nextAction}`;
    for (const [index, row] of rows.entries()) row.update(model.moves[index]);
    if (status) {
      status.dataset.state = section.dataset.state;
      status.textContent = refused
        ? `${refused} Nothing else changed: ${planScopeStatus(model)}`
        : planScopeStatus(model);
    }
    return model;
  };

  const disclosure = moveDisclosure(doc, model, scopes, recompute);
  const { rows } = disclosure;

  body.replaceChildren(
    figure.node,
    distinction,
    action,
    grade.node,
    disclosure.node,
  );
  return recompute();
}

export { PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS };
