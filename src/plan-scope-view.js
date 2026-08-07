// Paints the plan beside the diagnosis (#1286), and lets a lead move its scope
// levers and watch the total answer (#1288). It decides nothing: every figure,
// label and sentence below is read off `plan-scope.js`, and every lever a reader
// moves is turned into that module's own commitment shape by
// `plan-scope-levers.js`. No dollar, grade or threshold is computed here.
//
// READING ORDER IS THE PRODUCT, and it is one question, one number, one action:
// the planned figure at the numeral role, then how much of that figure rests on
// a stated fact (#1289), then the sentence separating it from the recoverable
// headline above, then the single next ask, then the grade line — and only then,
// behind collapsed disclosures, the rules behind the evidence grade and each
// move with the levers that scope it.
//
// TWO NUMBERS, TWO NAMES. The evidence grade is NOT the plan-confidence line and
// is not the analysis's own confidence claim further up the page: it is labelled
// "Evidence grade", carries a letter rather than a tier, and every letter it
// shows is accounted for rule by rule in its own disclosure. Nothing here coins a
// third word for confidence, and the plan-confidence line below it is untouched.
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
// open.
//
// A COMMITTED PLAN OUTLIVES THE TAB (#1290), and only a committed plan: filing
// happens on the commit control and on a field being left, never per keystroke,
// and it goes through `plan-persistence.js` — the record's shape, its bounds and
// what may be in it are stated there, and nothing on this surface widens them.
// With no store handed in, this section behaves exactly as it did before: it
// paints, it recomputes, and a reload starts empty.
//
// No new styles — every class used already ships in evolution.css and styles.css.
// `createElement` and `textContent` only; no markup string, no innerHTML.

import { formatUsd } from "./evolution.js";
import {
  EVIDENCE_RULES_ORDERED, GRADE_ABSENT_REASON, MAX_SCORE, NO_BLOCKERS_SUMMARY,
  PLAN_EVIDENCE_GRADE_LABEL, gradePlanEvidence,
} from "./plan-evidence-grade.js";
import {
  FEASIBLE_SHARE_MAX, FEASIBLE_SHARE_MIN, emptyMoveScope, feasibleShareRefusal, planCommitments,
  readFeasibleShare,
} from "./plan-scope-levers.js";
import {
  PLAN_KEEP_LABEL, PLAN_READ, PLAN_RECOMPUTE_LABEL, PLAN_RESTORE_FAILED, clearStoredPlan,
  planFingerprints, planStaleness, projectPlanRecord, readStoredPlan, restoredScopes,
  writeStoredPlan,
} from "./plan-persistence.js";
import {
  PLAN_GRADE_ABSENT, PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS, moveName,
  planMoveKey, planScope,
} from "./plan-scope.js";

export const PLAN_SCOPE_SECTION_ID = "plan-scope";
export const PLAN_SCOPE_BODY_ID = "plan-scope-body";
export const PLAN_SCOPE_STATUS_ID = "plan-scope-status";
export const PLAN_SCOPE_FIGURE_ID = "plan-scope-figure";
export const PLAN_SCOPE_GRADE_ID = "plan-scope-grade";
export const PLAN_SCOPE_ACTION_ID = "plan-scope-action";
export const PLAN_SCOPE_DISTINCTION_ID = "plan-scope-distinction";
export const PLAN_EVIDENCE_GRADE_ID = "plan-evidence-grade";
export const PLAN_EVIDENCE_DETAIL_ID = "plan-evidence-grade-detail";
export const PLAN_SCOPE_NOTICE_ID = "plan-scope-staleness";
export const PLAN_SCOPE_RESTORE_ERROR_ID = "plan-scope-restore-error";
export const PLAN_SCOPE_RECOMPUTE_ID = "plan-scope-recompute";
export const PLAN_SCOPE_KEEP_ID = "plan-scope-keep";
export const PLAN_SCOPE_CLEAR_ID = "plan-scope-clear";

/** The words on the control that forgets the filed plan. */
export const PLAN_SCOPE_CLEAR_LABEL = "Clear this plan";

/** How many blockers are named in the open. Two or three: enough to act on. */
export const NAMED_BLOCKER_LIMIT = 3;

/** The words on the closed disclosure. It promises the levers, and holds them. */
export const PLAN_SCOPE_DETAIL_SUMMARY =
  "Scope each modelled move: the share, the excluded workloads and the refusals";

/** The words on the grade's own disclosure. It promises the rules, and holds them. */
export const PLAN_EVIDENCE_DETAIL_SUMMARY =
  "How this evidence grade was computed: every rule, what would clear it, and the assumption "
  + "behind its weight";

/** Every control id derives from here, so a label and its field cannot drift. */
export const planLeverId = (index, part) => `plan-lever-${index}-${part}`;

// What the lead is scoping is named by `plan-scope.js` now (#1291): the shared
// brief's plan block carries the same display name, and it cannot import a view.

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
  // Committing a move to the plan is what FILES it (#1290), so this is where the
  // record is written. Typing in a field below is not: those persist on the
  // field's own `change`, which a browser fires when the entry is left, never
  // per keystroke.
  commit.input.addEventListener("change", () => {
    scope.inPlan = Boolean(commit.input.checked);
    recompute({ filed: true });
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
  share.input.addEventListener("change", () => recompute({ filed: true }));

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
  excluded.input.addEventListener("change", () => recompute({ filed: true }));

  const refuses = field(doc, {
    id: planLeverId(index, "refuses"),
    type: "checkbox",
    className: "filter-option",
    labelText: `A team has refused ${name}`,
    checked: scope.refuses,
  });
  refuses.input.addEventListener("change", () => {
    scope.refuses = Boolean(refuses.input.checked);
    recompute({ filed: true });
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
 * The evidence grade beside the planned total (#1289), and the two or three
 * heaviest blockers NAMED in the open — a reader who never opens the disclosure
 * below still learns which facts are missing, because a closed disclosure is
 * dropped from the accessibility tree in a real browser.
 *
 * The label is "Evidence grade", never "confidence": this page already carries a
 * confidence claim about the ANALYSIS and a plan-confidence line one paragraph
 * down, and three numbers sharing one word is how a reader ends up believing a
 * scoping claim has been measured.
 */
function evidenceGradeLine(doc) {
  const line = element(doc, "p", "answer-figure-basis");
  line.id = PLAN_EVIDENCE_GRADE_ID;
  return {
    node: line,
    update(verdict) {
      line.dataset.grade = verdict.graded ? verdict.letter : "absent";
      line.dataset.score = String(verdict.score);
      line.dataset.blockers = String(verdict.blockers.length);
      if (!verdict.graded) {
        line.textContent = `${PLAN_EVIDENCE_GRADE_LABEL}: none yet. ${GRADE_ABSENT_REASON}`;
        return;
      }
      const named = verdict.blockers.slice(0, NAMED_BLOCKER_LIMIT)
        .map((blocker) => blocker.name).join("; ");
      const scored = `${verdict.score} of ${verdict.maxScore} points from facts the lead stated`;
      line.textContent = named
        ? `${PLAN_EVIDENCE_GRADE_LABEL} ${verdict.letter} — ${verdict.label} (${scored}). `
          + `Blocking a stronger grade: ${named}. Every rule behind this grade is listed below.`
        : `${PLAN_EVIDENCE_GRADE_LABEL} ${verdict.letter} — ${verdict.label} (${scored}). `
          + NO_BLOCKERS_SUMMARY;
    },
  };
}

/**
 * Why the grade is the grade: every rule, whether it fired, the one sentence
 * that would clear it, and the assumption its weight rests on. Both the fired
 * and the cleared rules are listed, because a score a reader can only partly
 * account for is a number they have to take on trust.
 */
function evidenceDisclosure(doc) {
  const detail = element(doc, "details", "completeness-detail");
  detail.id = PLAN_EVIDENCE_DETAIL_ID;
  const summary = element(doc, "summary");
  summary.setAttribute("aria-expanded", "false");
  summary.append(doc.createTextNode(PLAN_EVIDENCE_DETAIL_SUMMARY));
  detail.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(detail.hasAttribute("open")));
  });
  const basis = element(doc, "p", "answer-figure-basis");
  const list = element(doc, "ul", "action-list");
  const rows = EVIDENCE_RULES_ORDERED.map((rule) => {
    const item = element(doc, "li");
    item.dataset.rule = rule.id;
    list.append(item);
    return { rule, item };
  });
  detail.append(summary, basis, list);
  return {
    node: detail,
    update(verdict) {
      const blocked = new Set(verdict.blockers.map((blocker) => blocker.ruleId));
      basis.textContent = verdict.graded
        ? `The grade is the sum of the weights of the rules that cleared: ${verdict.score} of `
          + `${MAX_SCORE}. Claimed scope is not one of the inputs. ${verdict.blockerOrder}`
        : `${GRADE_ABSENT_REASON} These are the rules a committed move would be graded on, `
          + `each out of ${MAX_SCORE}.`;
      for (const { rule, item } of rows) {
        const fired = !verdict.graded || blocked.has(rule.id);
        item.dataset.cleared = String(!fired);
        item.textContent = `${rule.name} (rule ${rule.id}, worth ${rule.weight} of ${MAX_SCORE}) `
          + `— ${fired ? "not stated yet" : "stated"}. To clear it: ${rule.statement} `
          + `Assumption behind this weight: ${rule.assumption}`;
      }
    },
  };
}

/** A control that does one thing to the filed plan, in the page's own button style. */
function actionButton(doc, id, label, onClick) {
  const button = element(doc, "button", "secondary-button", label);
  button.id = id;
  button.setAttribute("type", "button");
  button.addEventListener("click", onClick);
  return button;
}

/**
 * The restored plan rests on figures that have since moved (#1290), said ABOVE
 * the moves and INSIDE this section rather than as a page-wide banner: it
 * qualifies this plan and nothing else on the page.
 *
 * It carries NO live region. The section has exactly one, authored in
 * evolution.html, and a second would double-announce every recompute. It adds no
 * style either — `local-result-notice` is the notice this page already ships.
 *
 * Two ways out, in priority order: recompute against today's figures, or leave
 * the plan filed as it is. Keeping it dismisses the notice and writes nothing,
 * so the stored total and both stored fingerprints stand untouched.
 */
function stalenessNotice(doc, staleness, onRecompute) {
  const notice = element(doc, "div", "local-result-notice");
  notice.id = PLAN_SCOPE_NOTICE_ID;
  notice.dataset.changed = staleness.changed;
  const actions = element(doc, "p");
  actions.append(
    actionButton(doc, PLAN_SCOPE_RECOMPUTE_ID, PLAN_RECOMPUTE_LABEL, () => {
      notice.hidden = true;
      onRecompute();
    }),
    actionButton(doc, PLAN_SCOPE_KEEP_ID, PLAN_KEEP_LABEL, () => {
      notice.hidden = true;
    }),
  );
  notice.append(
    element(doc, "strong", null, "This plan was filed before the figures under it changed"),
    element(doc, "span", null, staleness.sentence),
    actions,
  );
  return notice;
}

/**
 * A stored plan this page could not read. It states what happened and what the
 * page did instead, and it blocks nothing: the empty plan below it is live.
 */
function restoreFailureNotice(doc) {
  const notice = element(doc, "div", "local-result-notice");
  notice.id = PLAN_SCOPE_RESTORE_ERROR_ID;
  notice.dataset.state = "error";
  notice.append(
    element(doc, "strong", null, "The saved plan could not be read"),
    element(doc, "span", null, PLAN_RESTORE_FAILED),
  );
  return notice;
}

/**
 * Paint the section from the slate already on screen, and keep painting it as a
 * lead moves the levers.
 *
 * @param {Document} doc
 * @param {object|null} slate The slate `routing-slate-view.js` just painted.
 * @param {{commitments?: Array<object>, evidence?: object}} [options] Commitments
 *   from a caller. The lead's own levers are read on top of these, so a move they
 *   have scoped here wins over a seeded commitment for the same move. `evidence`
 *   is `planEvidence()`'s two analysis-level signals; absent, both read as
 *   unstated, which is the conservative reading and the one the page ships with.
 *   `onModel` is called with the model after every paint, including this first
 *   one — the shared brief carries the committed plan (#1291), so the surface
 *   that shares it has to learn about a moved lever rather than about a plan
 *   that was empty when the page booted. It is told, and decides nothing here.
 *
 *   `storage` is this browser's key-value store, or absent — with no store the
 *   section behaves exactly as it did before #1290: it paints, it recomputes,
 *   and a reload starts empty. `fingerprints` are today's analysis and rate-card
 *   digests, which a restored plan's own are compared against; absent, they are
 *   derived from the slate being painted and no declared card.
 * @returns the model that was painted, so a caller can assert on it.
 */
export function applyPlanScope(doc, slate, options = {}) {
  const { commitments = [], evidence = {}, onModel, storage = null, fingerprints = null } = options;
  const scopes = sessionScopes(doc);
  const today = fingerprints ?? planFingerprints(slate, null);

  // The filed plan, read ONCE and before anything is painted, and only when this
  // document holds no answers yet — a lead who has already moved a lever this
  // session is never overwritten by what a previous session filed. A record that
  // cannot be read has already been removed by the reader; all that is left is to
  // say so and carry on with an empty plan.
  const filed = storage && scopes.size === 0
    ? readStoredPlan(storage)
    : { status: PLAN_READ.EMPTY, record: null };
  if (filed.status === PLAN_READ.RESTORED) {
    for (const [key, scope] of restoredScopes(filed.record)) scopes.set(key, scope);
  }
  const staleness = filed.status === PLAN_READ.RESTORED
    ? planStaleness(filed.record, today)
    : { stale: false, changed: null, sentence: "" };

  const keys = (slate?.rules ?? []).map((rule) => ({ key: planMoveKey(rule) }));
  const compose = () => planScope(slate, {
    commitments: [...commitments, ...planCommitments(scopes, keys)],
  });

  let model = compose();
  const section = doc?.getElementById?.(PLAN_SCOPE_SECTION_ID);
  const body = doc?.getElementById?.(PLAN_SCOPE_BODY_ID);
  if (!section || !body) {
    onModel?.(model);
    return model;
  }
  const status = doc.getElementById?.(PLAN_SCOPE_STATUS_ID);

  const distinction = element(doc, "p", "answer-figure-basis", model.distinction);
  distinction.id = PLAN_SCOPE_DISTINCTION_ID;
  const action = element(doc, "p", "answer-figure-direction");
  action.id = PLAN_SCOPE_ACTION_ID;

  // Every part that changes when a lever moves, and nothing else. `recompute`
  // rewrites their words in place; the controls above are never rebuilt.
  const figure = plannedFigure(doc, model);
  const grade = gradeLine(doc);
  // Graded from the SAME model the total above is read off, never from a second
  // copy of the plan, and never from the dollars themselves.
  const evidenceGrade = evidenceGradeLine(doc);
  const evidenceDetail = evidenceDisclosure(doc);

  /**
   * One visible step: the total, the committed count, the next action and the
   * per-move rows all move together, and the page's own status region says so.
   *
   * A refused entry passes its message through here rather than through a second
   * live region — the figure it reports is the one still standing, so a reader
   * who cannot see the inline refusal is told both what was rejected and that
   * nothing else changed.
   */
  const recompute = ({ refused = "", filed: fileIt = false } = {}) => {
    model = compose();
    section.dataset.state = model.committedCount ? "committed" : "empty";
    section.dataset.moveCount = String(model.moves.length);
    section.dataset.committedCount = String(model.committedCount);
    figure.update(model);
    grade.update(model);
    const verdict = gradePlanEvidence(model, evidence);
    evidenceGrade.update(verdict);
    evidenceDetail.update(verdict);
    action.textContent = `Do this first: ${model.nextAction}`;
    for (const [index, row] of rows.entries()) row.update(model.moves[index]);
    clearRow.hidden = model.committedCount === 0;
    // WHAT GOES INTO THIS BROWSER, and nothing else: the committed moves, the
    // scope levers each was committed at, the total they produced, and the two
    // fingerprints. No credential, customer record, prompt, source row or
    // analysis narrative belongs here — do not widen it. A plan with nothing in
    // it leaves no key behind at all.
    if (fileIt && storage) {
      const record = projectPlanRecord(model, scopes, today);
      if (record.moves.length) writeStoredPlan(storage, record);
      else clearStoredPlan(storage);
    }
    if (status) {
      status.dataset.state = section.dataset.state;
      status.textContent = refused
        ? `${refused} Nothing else changed: ${planScopeStatus(model)}`
        : planScopeStatus(model);
    }
    // Last, and outside this section: whoever is holding the plan is told what
    // it now says. After the paint, so a listener that repaints something else
    // reads the same model the reader is looking at.
    onModel?.(model);
    return model;
  };

  // Forgetting the plan: the stored record goes, every stated scope goes with
  // it, and the section is repainted through this same function — so the empty
  // state a reader lands on is the empty state the page ships, not a second one
  // written here. It sits at the FOOT of the section, with the plan it acts on
  // and far below the first screen, and it is hidden until there is a plan to
  // clear, so an untouched section has exactly the tab stops it had before.
  const clearRow = element(doc, "p");
  clearRow.hidden = true;
  clearRow.append(actionButton(doc, PLAN_SCOPE_CLEAR_ID, PLAN_SCOPE_CLEAR_LABEL, () => {
    clearStoredPlan(storage);
    scopes.clear();
    applyPlanScope(doc, slate, options);
  }));

  const disclosure = moveDisclosure(doc, model, scopes, recompute);
  const { rows } = disclosure;

  // The two notices sit at the TOP of the plan, above the moves and above the
  // figure: both of them qualify the number a reader is about to read, and a
  // caveat printed after it is a caveat read too late.
  const notices = [];
  if (filed.status === PLAN_READ.UNREADABLE) notices.push(restoreFailureNotice(doc));
  if (staleness.stale) {
    notices.push(stalenessNotice(doc, staleness,
      // Recomputing is the ordinary recompute this page already does, against the
      // inputs it is showing now, and it re-files the plan — which is what moves
      // both stored fingerprints to today's.
      () => recompute({ filed: true })));
  }

  body.replaceChildren(
    ...notices,
    figure.node,
    // Beside the total, before anything else is read: the number and how much of
    // it rests on a stated fact travel together or not at all.
    evidenceGrade.node,
    distinction,
    action,
    grade.node,
    evidenceDetail.node,
    disclosure.node,
    clearRow,
  );
  return recompute();
}

export { PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS, moveName };
