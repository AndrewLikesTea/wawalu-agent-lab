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
// A RELOAD NO LONGER STARTS EMPTY (#1290), but only when a caller hands over a
// `storage`. Without one this file behaves exactly as it did: session-only
// scope, no notice, no write, no read. With one, `plan-scope-store.js` — which
// owns the key, the schema and the two fingerprints — is asked for the filed
// plan on the way in and told about it on the way out.
//
// FILED NUMBERS STAND UNTIL SOMEONE MOVES SOMETHING. A restored plan shows the
// dollars that were filed, not what those moves would be worth today, and the
// staleness notice says which of the two a reader is looking at. Moving any
// lever, or pressing the notice's recompute action, drops the filed figures and
// puts the whole plan back on `plan-scope.js` for today's slate — a total half
// filed and half recomputed is a number nobody could account for. Pressing
// "keep as filed" only dismisses the notice; it writes nothing, so the next
// reload tells the reader the same true thing again.
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
  PLAN_CLEAR_LABEL, PLAN_KEEP_FILED_LABEL, PLAN_READ, PLAN_RECOMPUTE_LABEL,
  PLAN_UNREADABLE_MESSAGE, clearPlanRecord, filedPlan, planStaleness, projectPlanRecord,
  readPlanRecord, restoredScopes, writePlanRecord,
} from "./plan-scope-store.js";
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
export const PLAN_SCOPE_NOTICE_TEXT_ID = "plan-scope-staleness-text";
export const PLAN_SCOPE_RECOMPUTE_ID = "plan-scope-recompute";
export const PLAN_SCOPE_KEEP_ID = "plan-scope-keep-filed";
export const PLAN_SCOPE_CLEAR_ID = "plan-scope-clear";
export const PLAN_SCOPE_UNREADABLE_ID = "plan-scope-unreadable";

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
  return {
    node: group,
    // Repaint the four controls from whatever the scope object now holds. Used
    // when the plan is cleared, and by nothing else: an ordinary recompute
    // deliberately leaves a field the lead is typing in alone.
    reset() {
      commit.input.checked = Boolean(scope.inPlan);
      share.input.value = scope.sharePct === null ? "" : String(scope.sharePct);
      excluded.input.value = scope.excludedText;
      refuses.input.checked = Boolean(scope.refuses);
      refusal.hidden = true;
      refusal.textContent = "";
      share.input.removeAttribute("aria-invalid");
      share.input.removeAttribute("aria-describedby");
    },
  };
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
  const controls = moveControls(doc, move, index, scopeFor(scopes, move.key), recompute);
  item.append(heading, rationale, levers, controls.node);
  return {
    node: item,
    reset: controls.reset,
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

/** A control, with its accessible name in its own text and no icon standing in. */
function button(doc, id, label) {
  const node = doc.createElement("button");
  node.id = id;
  node.className = "secondary-button";
  node.setAttribute("type", "button");
  node.textContent = label;
  return node;
}

/**
 * The staleness notice, at the top of the plan and outside every disclosure,
 * because a reader who never opens a disclosure still has to be told that the
 * numbers under it were filed against something that has since moved.
 *
 * ONE PRIORITIZED ACTION, then the way to decline it. Recompute comes first in
 * DOM order and therefore first in the tab order; keeping the plan as filed is
 * the second control and changes no figure.
 */
function stalenessNoticeNode(doc, onRecompute, onKeep) {
  const node = element(doc, "div");
  node.id = PLAN_SCOPE_NOTICE_ID;
  node.hidden = true;
  // `answer-figure-basis`, NOT `answer-figure-direction`: this section prints
  // exactly one direction — the next ask — and a second node in that class would
  // give a reader two competing "do this first" lines. What the notice says is a
  // statement about the basis of the figure, which is the class it is in.
  const text = element(doc, "p", "answer-figure-basis");
  text.id = PLAN_SCOPE_NOTICE_TEXT_ID;
  const recompute = button(doc, PLAN_SCOPE_RECOMPUTE_ID, PLAN_RECOMPUTE_LABEL);
  recompute.addEventListener("click", onRecompute);
  const keep = button(doc, PLAN_SCOPE_KEEP_ID, PLAN_KEEP_FILED_LABEL);
  keep.addEventListener("click", onKeep);
  node.append(text, recompute, keep);
  return {
    node,
    update(staleness) {
      node.hidden = !staleness;
      node.dataset.changed = staleness ? staleness.changed.join(",") : "";
      text.textContent = staleness ? staleness.notice : "";
    },
  };
}

/**
 * The way out of the store. Hidden while there is nothing filed, so the page
 * never offers to clear a plan that does not exist — and a hidden control is
 * not a tab stop, which is what keeps this section's focus order the one it
 * had while the plan is empty.
 */
function clearControl(doc, onClear) {
  const wrapper = element(doc, "p");
  wrapper.hidden = true;
  const control = button(doc, PLAN_SCOPE_CLEAR_ID, PLAN_CLEAR_LABEL);
  control.addEventListener("click", onClear);
  wrapper.append(control);
  return {
    node: wrapper,
    update(anythingFiled) { wrapper.hidden = !anythingFiled; },
  };
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
 *   `storage` is the browser store the filed plan is read from and written to
 *   (#1290); omitted, nothing is read or written and this section is
 *   session-only, which is what every caller that does not pass one still gets.
 *   `fingerprints` is `{analysis, rateCard}` from `plan-scope-store.js`, taken
 *   over what this page has already rendered — they are compared, never fetched.
 * @returns the model that was painted, so a caller can assert on it.
 */
export function applyPlanScope(doc, slate,
  { commitments = [], evidence = {}, onModel, storage = null, fingerprints = null } = {}) {
  const scopes = sessionScopes(doc);
  const keys = (slate?.rules ?? []).map((rule) => ({ key: planMoveKey(rule) }));
  const compose = () => planScope(slate, {
    commitments: [...commitments, ...planCommitments(scopes, keys)],
  });

  // The load path, and the only place this file reads the store. A record that
  // will not parse or will not validate is UNRECOVERABLE: it is removed rather
  // than retried, and the page falls through to the ordinary empty plan with a
  // sentence saying so. Nothing below can throw past this point.
  const read = storage ? readPlanRecord(storage) : { status: PLAN_READ.missing, record: null };
  if (read.status === PLAN_READ.unreadable) clearPlanRecord(storage);
  let filed = read.status === PLAN_READ.restored ? read.record : null;
  if (filed) for (const [key, scope] of restoredScopes(filed)) scopes.set(key, scope);
  const staleness = filed && fingerprints ? planStaleness(filed, fingerprints) : null;
  let noticeDismissed = false;

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

  // Said once, at the top, when a stored plan could not be read. It is a plain
  // paragraph rather than a second live region: this section announces through
  // `#plan-scope-status` and nowhere else.
  const unreadable = element(doc, "p", "field-error",
    read.status === PLAN_READ.unreadable ? PLAN_UNREADABLE_MESSAGE : "");
  unreadable.id = PLAN_SCOPE_UNREADABLE_ID;
  unreadable.hidden = read.status !== PLAN_READ.unreadable;

  /**
   * Stop showing the filed dollars and put the whole plan back on today's
   * analysis. Both the notice's recompute action and any moved lever land here,
   * because the alternative — one row repriced, the rest filed — is a total that
   * adds up to nothing a reader could check.
   */
  const goLive = () => { filed = null; noticeDismissed = true; };

  /** Write what is on screen, or clear the key when there is nothing filed. */
  const persist = (next) => {
    if (!storage || filed) return;
    const record = projectPlanRecord({
      model: next,
      scopes,
      analysis: fingerprints?.analysis,
      rateCard: fingerprints?.rateCard,
    });
    if (record) writePlanRecord(storage, record);
    else clearPlanRecord(storage);
  };

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
    // The filed dollars, if a plan was restored and nobody has moved anything
    // since. `filedPlan` overlays money and nothing else, so the levers below
    // still read off the scopes that were filed.
    if (filed) model = filedPlan(model, filed);
    section.dataset.state = model.committedCount ? "committed" : "empty";
    section.dataset.filed = String(Boolean(filed));
    section.dataset.moveCount = String(model.moves.length);
    section.dataset.committedCount = String(model.committedCount);
    figure.update(model);
    grade.update(model);
    const verdict = gradePlanEvidence(model, evidence);
    evidenceGrade.update(verdict);
    evidenceDetail.update(verdict);
    action.textContent = `Do this first: ${model.nextAction}`;
    for (const [index, row] of rows.entries()) row.update(model.moves[index]);
    notice.update(staleness?.stale && filed && !noticeDismissed ? staleness : null);
    clear.update(Boolean(storage) && model.committedCount > 0);
    // A refusal changed nothing the store holds, so it writes nothing.
    if (!refused) persist(model);
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

  // A moved lever supersedes the filed figures; a REFUSED entry does not, because
  // nothing the plan is computed from changed and the last accepted answer still
  // stands. That is the whole difference between the two branches here.
  const leverMoved = (options = {}) => {
    if (!options.refused) goLive();
    return recompute(options);
  };

  const notice = stalenessNoticeNode(doc,
    () => { goLive(); recompute(); },
    // Keep as filed: the notice goes, the numbers stay, and NOTHING is written.
    // Re-filing under today's fingerprints would make the next reload claim the
    // plan matches an analysis it was never checked against.
    () => { noticeDismissed = true; recompute(); });
  // Clearing is the whole way out: the key goes, every retained scope goes with
  // it, and the controls are put back to the state a first visit paints. A store
  // emptied while the fields still hold the old answers would refile the plan on
  // the next keystroke.
  const clear = clearControl(doc, () => {
    clearPlanRecord(storage);
    goLive();
    // In place, not replaced: every control below closes over its own scope
    // object, and swapping the map entry would leave four fields still holding
    // the answers this control just promised to clear.
    for (const scope of scopes.values()) Object.assign(scope, emptyMoveScope());
    for (const row of rows) row.reset();
    recompute();
  });

  const disclosure = moveDisclosure(doc, model, scopes, leverMoved);
  const { rows } = disclosure;

  body.replaceChildren(
    // First in the body, and outside every disclosure: a reader is told what the
    // numbers below were filed against before they read one of them.
    unreadable,
    notice.node,
    figure.node,
    // Beside the total, before anything else is read: the number and how much of
    // it rests on a stated fact travel together or not at all.
    evidenceGrade.node,
    distinction,
    action,
    grade.node,
    clear.node,
    evidenceDetail.node,
    disclosure.node,
  );
  return recompute();
}

export { PLAN_GRADE_REQUIREMENT, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS, moveName };
