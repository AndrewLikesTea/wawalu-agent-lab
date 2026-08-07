// "Which of these moves are you committing to, and at what scope?" — the plan
// beside the diagnosis (#1286).
//
// THE DEFECT THIS CLOSES. The routing slate ranks what a move is WORTH, and the
// recoverable headline above it says how much of the spend is recoverable. Both
// are the system's opinion. Neither is a plan, and a lead who reads $51,254 and
// a ranked list has no way to see that nobody has yet committed to any of it.
// The honest answer to "what are we planning to save" today is zero, and this
// module is what states it.
//
// IT INVENTS NO MOVE. The moves enumerated here are the slate's own rules,
// passed in. There is no second list of routing changes in this repository and
// there must not be: a parallel copy would drift the moment the slate's ranking,
// filtering or pricing changed, and the two lists would then disagree about what
// the organization is even choosing between.
//
// IT COLLECTS, BUT IT STORES NOTHING. The levers on the surface (#1288) hand
// `commitments` in from what a lead entered this session; the reading of a typed
// share, and of an entry as a commitment, is settled at the bottom of this file
// so no view does arithmetic. Nothing is written to disk, to storage or to a
// server: close the tab and the plan is gone, which is the honest state for a
// figure nobody has agreed to yet. With no entry the answer is still the
// empty-set one, and it is still exactly $0.
//
// ---------------------------------------------------------------------------
// PLANNED SAVINGS, defined so two engineers compute the same figure
// ---------------------------------------------------------------------------
//
// Planned savings is the sum, over moves a lead has explicitly committed, of
//
//   trunc( modelledMonthlyUsd x share/100 x workloadFactor x teamFactor )
//
// where, for one committed move:
//
//   modelledMonthlyUsd  the slate rule's own `expectedMonthlyUsd`. Not
//                       recomputed here, ever.
//   share               `reroutedSharePct`, DEFAULT 0 when the lead has said
//                       nothing. Unstated scope is zero, never all traffic.
//   workloadFactor      (eligibleWorkloads - excludedWorkloads) / eligibleWorkloads,
//                       floored at 0, and 1 when the commitment states no
//                       eligible base to reduce. `excludedWorkloads` defaults
//                       to 0 — an unreduced base, and therefore an unverified one.
//   teamFactor          the same, over `eligibleTeams` and `refusingTeams`.
//                       `refusingTeams` defaults to 0 — nobody has been asked.
//
// Each move's contribution is truncated toward zero BEFORE the sum, matching the
// slate's rule that a rendered column adds up to the rendered total and that the
// page never claims a dollar the arithmetic did not find.
//
// With no committed move the sum is over an empty set and the figure is exactly
// 0. That is not a placeholder, an error state, or a missing value: it is the
// correct answer to the question, and it is the answer this page ships with.
//
// IT IS NOT THE RECOVERABLE HEADLINE and never restates it. See
// `PLAN_VS_DIAGNOSIS`, which is the sentence the surface prints saying so.
//
// PURE. No DOM, no clock, no storage, no randomness.

import { CONFIDENCE_TIERS } from "./finops-rate-card-contract.js";

/** Bump when a lever, a default, or what the planned figure means changes. */
export const PLAN_SCOPE_VERSION = "plan-scope/1.1.0";

/** The one question this surface settles. Nothing else belongs in it. */
export const PLAN_SCOPE_QUESTION =
  "Which of these moves are you committing to, and at what scope?";

/** What the number beside the question is called. */
export const PLAN_SCOPE_FIGURE_LABEL = "Planned savings";

/**
 * The distinction the whole section rests on, in one plain sentence. The
 * headline above is a diagnosis the page computed; this figure is a commitment a
 * person made. A reader who conflates the two believes the saving is already
 * decided.
 */
export const PLAN_VS_DIAGNOSIS =
  "The recoverable figure above is this page's diagnosis of what could be recovered; "
  + "planned savings is only what a named owner has committed to at a stated scope. "
  + "This section neither recomputes nor restates that headline.";

/**
 * The three scope levers, each with its unit and what it means when a lead has
 * said nothing. Every default is the CONSERVATIVE reading — silence is never
 * taken as agreement, and never as all of the traffic.
 */
export const PLAN_LEVERS = Object.freeze([
  Object.freeze({
    key: "reroutedSharePct",
    name: "Re-routed traffic share",
    unit: "percent of this move's eligible request volume",
    defaultWhenSilent: "0% — an unstated scope counts as zero, never as all traffic",
  }),
  Object.freeze({
    key: "excludedWorkloads",
    name: "Excluded workloads",
    unit: "count of named workloads removed from the eligible base",
    defaultWhenSilent: "0 excluded — the eligible base is unreduced, and therefore unverified",
  }),
  Object.freeze({
    key: "refusingTeams",
    name: "Refusing teams",
    unit: "count of named teams that have declined this move",
    defaultWhenSilent: "0 refused — no team has been asked yet",
  }),
]);

/**
 * The honesty ceiling, taken from the rate-card ladder this page already ships
 * rather than coined here. A second vocabulary for one idea is how a reader ends
 * up believing two grades mean two different things.
 */
export const PLAN_GRADE_CEILING = CONFIDENCE_TIERS[0];

/** What a plan figure must state before it may be called anything stronger. */
export const PLAN_GRADE_REQUIREMENT =
  `A plan figure is labelled no stronger than ${PLAN_GRADE_CEILING.marker} · `
  + `${PLAN_GRADE_CEILING.label} until, for every committed move, the lead has stated all `
  + "three: the re-routed traffic share, the workloads excluded from the eligible base, and "
  + "the teams that have refused the move.";

/**
 * Why there is NO grade rather than a passing one. An absent grade and a grade
 * of zero are different claims, and "N/A" beside a figure reads like a computed
 * result to every reader who did not write it.
 */
export const PLAN_GRADE_ABSENT =
  "No plan grade is shown, because nothing is committed and an uncommitted plan is not a "
  + "weak plan — there is nothing to grade. An absent grade is not a passing one.";

/** Said when the slate has no move to commit to yet, so the ask cannot be made. */
export const PLAN_NO_MOVES_ACTION =
  "Read a provider export first: no routing move has been modelled yet, so there is nothing "
  + "to commit to.";

/** Said when every modelled move already carries a commitment. */
export const PLAN_ALL_COMMITTED_ACTION =
  "Verify each committed scope against next period's own usage before counting any of it as "
  + "a saving.";

/** A commitment names one move. This is the name, and both sides derive it here. */
export const planMoveKey = (rule) =>
  `${rule?.source ?? ""} → ${rule?.targetTier ?? ""} tier · ${rule?.unit ?? ""}`;

// ---------------------------------------------------------------------------
// THE LEVERS AS CONTROLS (#1288)
// ---------------------------------------------------------------------------
//
// #1286 shipped the arithmetic above with no way to reach it: `commitments` was
// a parameter nothing supplied. The controls now on the surface supply it, and
// everything they need to REFUSE a value or to turn what a lead typed into a
// commitment is decided here, beside the arithmetic it feeds. A view that parsed
// a share, clamped a range or counted a workload itself would be a second
// opinion about the same figure, and the two would drift.

/** The share lever's accepted range, in percent. Read by the label and the check. */
export const PLAN_SHARE_MIN = 0;
export const PLAN_SHARE_MAX = 100;

/** The field a refusal has to name, taken from the lever rather than retyped. */
export const PLAN_SHARE_FIELD_NAME = PLAN_LEVERS[0].name;

/** The range a refusal has to state, in the words the label uses. */
export const PLAN_SHARE_RANGE_TEXT = `a number from ${PLAN_SHARE_MIN} to ${PLAN_SHARE_MAX}`;

/** What the share field says about itself, range included, before anything is typed. */
export const PLAN_SHARE_HINT =
  `${PLAN_SHARE_FIELD_NAME} — ${PLAN_SHARE_RANGE_TEXT} percent of this move's eligible request `
  + "volume. Left empty it stays unstated, and an unstated scope counts as 0%.";

/**
 * Why a refused value changes nothing. The message names the field and states
 * the range, because "invalid input" beside a form is a message a reader cannot
 * act on, and it says the previous scope stands so nobody re-types what they
 * already entered.
 */
export const planShareRefusal = (raw) =>
  `${PLAN_SHARE_FIELD_NAME} must be ${PLAN_SHARE_RANGE_TEXT} percent. `
  + `"${String(raw ?? "").trim()}" was not accepted, so this move keeps the scope already `
  + "entered.";

/**
 * Read a typed share. Empty is not an error — it is silence, and silence has a
 * documented default above. Anything else must be a finite number inside the
 * range; a number outside it, or a value that is not a number at all, is
 * REFUSED rather than clamped. Clamping would put a figure on the page that
 * nobody typed, which is exactly the kind of invented scope this section exists
 * to prevent.
 *
 * @returns {{ok: boolean, value: number|null, message: string}}
 */
export function readSharePct(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return Object.freeze({ ok: true, value: null, message: "" });
  const value = Number(text);
  if (!Number.isFinite(value) || value < PLAN_SHARE_MIN || value > PLAN_SHARE_MAX) {
    return Object.freeze({ ok: false, value: null, message: planShareRefusal(text) });
  }
  return Object.freeze({ ok: true, value, message: "" });
}

/**
 * The team base one move is asked over. The slate names ONE owning unit per move
 * — it is the move's `unit`, and the ask in `nextActionFor` goes to that unit's
 * lead. So a refusal from that team is the whole of the move's team base, and
 * the move contributes nothing: `teamFactor` is (1 - 1) / 1. This is the only
 * base this page can honestly state, and it is stated here rather than assumed
 * in a view.
 */
export const PLAN_MOVE_TEAM_BASE = 1;

/**
 * What a lead has entered against one move, before it is arithmetic. `committed`
 * is the in-or-out toggle; the rest is the scope, retained whether or not the
 * move is currently in the plan.
 */
export function emptyPlanEntry() {
  return {
    committed: false,
    reroutedSharePct: null,
    excludedWorkloads: "",
    teamRefuses: false,
  };
}

/** The workloads a lead named, comma separated, blanks dropped. */
export function namedWorkloads(text) {
  return String(text ?? "").split(",").map((name) => name.trim()).filter(Boolean);
}

/**
 * One entry as a commitment the arithmetic above understands, or null when the
 * move is not in the plan. An uncommitted entry is NOT a zero commitment: it is
 * absent, so it neither counts toward the committed moves nor carries a scope
 * the page could be read as having been told.
 *
 * Three readings are settled here, each of which a view would otherwise invent:
 *
 *   share       null when the field is empty — unstated, and therefore 0% by the
 *               default at the top of this file. Never silently 100%.
 *   workloads   the COUNT of the names typed. Committing the move with the field
 *               empty states zero exclusions — a definite answer, not silence,
 *               because the field was on screen when the move went in. No
 *               `eligibleWorkloads` is sent: this page collects no eligible
 *               base, so the factor stays 1 and the exclusions are recorded
 *               WITHOUT moving the dollars. Inventing a denominator here would
 *               move money nobody counted.
 *   teams       one refusal against `PLAN_MOVE_TEAM_BASE`, so a marked refusal
 *               takes the move's planned dollars to zero while it stands.
 */
export function planEntryCommitment(moveKey, entry) {
  if (!entry?.committed) return null;
  return Object.freeze({
    move: String(moveKey),
    reroutedSharePct: entry.reroutedSharePct,
    excludedWorkloads: namedWorkloads(entry.excludedWorkloads).length,
    refusingTeams: entry.teamRefuses ? 1 : 0,
    eligibleTeams: PLAN_MOVE_TEAM_BASE,
  });
}

/**
 * Every committed entry, as the commitments `planScope` takes.
 *
 * @param {Iterable<[string, object]>} entries move key → entry, in any order.
 */
export function planEntryCommitments(entries) {
  const commitments = [];
  for (const [key, entry] of entries ?? []) {
    const commitment = planEntryCommitment(key, entry);
    if (commitment) commitments.push(commitment);
  }
  return commitments;
}

/** A count a lead actually stated: a finite, non-negative number and nothing else. */
function statedCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * One lever, as it stands on one commitment: what the lead stated, or silence
 * and the default that silence carries.
 */
function leverState(lever, commitment) {
  const stated = statedCount(commitment?.[lever.key]);
  return Object.freeze({
    key: lever.key,
    name: lever.name,
    unit: lever.unit,
    defaultWhenSilent: lever.defaultWhenSilent,
    stated: stated !== null,
    // The value USED in the arithmetic. Silence resolves to zero, which is the
    // default the copy states — not a guess made here and not shown as a fact.
    value: stated ?? 0,
  });
}

/**
 * A share of a base, floored at zero and capped at one. A commitment that
 * excludes more workloads than it claims are eligible contradicts itself; it
 * yields nothing planned rather than a negative saving.
 */
function remainingShare(base, removed) {
  const eligible = statedCount(base);
  if (eligible === null || eligible <= 0) return 1;
  const gone = statedCount(removed) ?? 0;
  return Math.min(1, Math.max(0, (eligible - gone) / eligible));
}

/** One committed move's planned dollars, by the definition at the top of this file. */
function plannedFor(rule, commitment) {
  const share = (statedCount(commitment?.reroutedSharePct) ?? 0) / 100;
  const workloads = remainingShare(commitment?.eligibleWorkloads, commitment?.excludedWorkloads);
  const teams = remainingShare(commitment?.eligibleTeams, commitment?.refusingTeams);
  const modelled = Number(rule?.expectedMonthlyUsd);
  if (!Number.isFinite(modelled)) return 0;
  return Math.trunc(modelled * Math.min(1, Math.max(0, share)) * workloads * teams);
}

/** The moves, in the slate's own rank order, each with its levers and its answer. */
function movesFrom(slate, commitments) {
  const byKey = new Map();
  for (const commitment of commitments ?? []) {
    if (commitment?.move) byKey.set(String(commitment.move), commitment);
  }
  return (slate?.rules ?? []).map((rule) => {
    const key = planMoveKey(rule);
    const commitment = byKey.get(key) ?? null;
    const levers = PLAN_LEVERS.map((lever) => leverState(lever, commitment));
    return Object.freeze({
      key,
      rank: rule.rank,
      source: rule.source,
      unit: rule.unit,
      targetTier: rule.targetTier,
      modelledMonthlyUsd: rule.expectedMonthlyUsd,
      committed: commitment !== null,
      // Every lever spoken for, by a lead who committed the move. The gate below
      // turns on this and on nothing else.
      fullyScoped: commitment !== null && levers.every((lever) => lever.stated),
      levers: Object.freeze(levers),
      plannedMonthlyUsd: commitment === null ? 0 : plannedFor(rule, commitment),
      owner: commitment?.owner ? String(commitment.owner) : null,
    });
  });
}

/**
 * The grade, or the absence of one.
 *
 * Nothing committed means NO GRADE AT ALL — null, which the surface renders as
 * a stated absence. Once something is committed the figure may be labelled, and
 * the label is the weakest rung of the shipped rate-card ladder until every
 * committed move has stated all three levers. It is never stronger than that
 * rung here: a stronger claim would need measured re-routing, which this section
 * does not have and does not model.
 */
function gradeFor(moves) {
  const committed = moves.filter((move) => move.committed);
  if (!committed.length) return null;
  return PLAN_GRADE_CEILING;
}

/**
 * The one next action, as an imperative sentence. It is the ask that would move
 * the plan furthest: the highest-ranked move nobody has committed to yet.
 */
function nextActionFor(moves) {
  if (!moves.length) return PLAN_NO_MOVES_ACTION;
  const open = moves.find((move) => !move.committed)
    ?? moves.find((move) => !move.fullyScoped)
    ?? null;
  if (!open) return PLAN_ALL_COMMITTED_ACTION;
  const owner = open.unit || open.source;
  return `Ask ${owner}'s lead what share of ${open.source} traffic they will move to the `
    + `${open.targetTier} tier, and record the answer — including a refusal.`;
}

/**
 * Build the section's model from the slate that is already on screen.
 *
 * @param {object|null} slate The `routing-slate.js` slate — the only source of
 *   moves this section has.
 * @param {{commitments?: Array<object>}} [options] Commitments a lead has made.
 *   None exist today: nothing on this page collects or retains one.
 * @returns a frozen model: the moves with their levers, the planned figure, the
 *   grade or its absence, and exactly one next action.
 */
export function planScope(slate = null, { commitments = [] } = {}) {
  const moves = movesFrom(slate, commitments);
  const committedCount = moves.filter((move) => move.committed).length;
  return Object.freeze({
    version: PLAN_SCOPE_VERSION,
    question: PLAN_SCOPE_QUESTION,
    figureLabel: PLAN_SCOPE_FIGURE_LABEL,
    distinction: PLAN_VS_DIAGNOSIS,
    moves: Object.freeze(moves),
    committedCount,
    // The sum over the committed moves, and over nothing else. Empty set, $0.
    plannedMonthlyUsd: moves.reduce((sum, move) => sum + move.plannedMonthlyUsd, 0),
    grade: gradeFor(moves),
    gradeRequirement: PLAN_GRADE_REQUIREMENT,
    gradeAbsentReason: committedCount === 0 ? PLAN_GRADE_ABSENT : "",
    levers: PLAN_LEVERS,
    nextAction: nextActionFor(moves),
  });
}
