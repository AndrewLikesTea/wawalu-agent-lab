// "How much of this plan rests on something the lead actually stated?" — the
// evidence grade beside the planned figure (#1289).
//
// THE DEFECT THIS CLOSES. A lead can move the scope levers shipped by #1288
// until the planned total reads whatever they want it to read, and nothing on
// the page distinguishes $60,000 planned on four stated facts from $60,000
// planned on none. Claimed scope is the one input a plan can inflate for free,
// so it is the one input this grade refuses to look at.
//
// ---------------------------------------------------------------------------
// SCOPE IS NOT AN INPUT. This is a property, not an aspiration.
// ---------------------------------------------------------------------------
//
// The grade is computed from the PRESENCE and COMPLETENESS of stated facts:
// which moves are in the plan, and which of the four evidence signals each of
// them carries. It never reads `plannedMonthlyUsd`, `modelledMonthlyUsd`, or any
// lever's `value` — only each lever's `stated` flag. Raising every move's claimed
// share to 100% therefore moves the plan total and cannot move this grade by one
// point. `tests/plan-evidence-grade.test.js` asserts exactly that, by serialising
// the result at a low share and at 100% and comparing the two strings.
//
// IT READS THE PLAN MODEL, and does not keep a second copy of it. The argument is
// `planScope()`'s own frozen output — the same object the plan total is read off.
// A parallel plan state here would drift the first time a lever's meaning changed.
//
// THE FOUR EVIDENCE SIGNALS, and nothing else:
//
//   1. a declared rate card      the prices under the plan are contracted, not list
//   2. an observed baseline      the period under the plan is measured, not invented
//   3. named exclusions          every committed move says what is out of its base
//   4. recorded team refusals    every committed move says whether a team declined
//
// Signals 3 and 4 are COMPLETENESS rules: one committed move that states nothing
// holds the whole rule open, because a plan is only as evidenced as its weakest
// committed move.
//
// UNTRUSTED TEXT NEVER REACHES THIS FILE'S OUTPUT. Move names, exclusion notes
// and refusal notes are lead-entered free text. No rule branches on them, and no
// string this module returns is derived from them: every statement and assumption
// below is a constant authored here, and the only lead-derived values that leave
// are COUNTS. A test injects a script tag as a move name and asserts it appears
// nowhere in the serialised result.
//
// PURE. No DOM, no clock, no storage, no randomness, no network.

/** Bump when a weight, a cut point, or what a rule means changes. */
export const PLAN_EVIDENCE_GRADE_VERSION = "plan-evidence-grade/1.0.0";

/** What this grade is called on the page. Never "confidence": see the view. */
export const PLAN_EVIDENCE_GRADE_LABEL = "Evidence grade";

// ---------------------------------------------------------------------------
// THE WEIGHTS. One place, each with the assumption it rests on.
// ---------------------------------------------------------------------------
//
// Every weight below is a claim about how wrong the plan can be while that fact
// is missing, and each one is arguable — which is why the argument is written
// down beside the number rather than left in someone's head. The four sum to
// MAX_SCORE, which is computed from them rather than typed, so a changed weight
// cannot silently stop the scale adding up.

export const RULE_WEIGHTS = Object.freeze({
  // ASSUMPTION: a plan priced at published list prices is wrong by the whole
  // contracted discount on every dollar in it, so the error is unbounded by any
  // scoping fact. Heaviest for that reason alone.
  rateCard: 35,
  // ASSUMPTION: without an observed period the monthly level is invented, so the
  // plan cannot be checked against next month's bill. It can be wrong about the
  // size of every move, but not about which move is largest — below pricing.
  baseline: 25,
  // ASSUMPTION: unnamed exclusions overstate the eligible base, an error bounded
  // by that base rather than by the whole plan.
  exclusions: 20,
  // ASSUMPTION: an unrecorded refusal removes one move's dollars entirely when it
  // surfaces, an error bounded by the largest single move. Deliberately EQUAL to
  // exclusions: we have no evidence which of the two goes wrong more often, and a
  // split we cannot defend is worse than a tie we can.
  refusals: 20,
});

/** The scale. Computed from the weights so it cannot drift away from them. */
export const MAX_SCORE = Object.values(RULE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

/**
 * The cut points. Stated as "how many of the four, weighted" rather than as
 * feelings about the plan.
 *
 * ASSUMPTION BEHIND THE LADDER: a grade is a summary of which facts exist, so
 * each cut point is placed where the SET of cleared rules changes character —
 * not on a round number. With the weights above the bands land exactly here:
 *
 *   A (100)      all four signals stated.
 *   B (60–80)    three of the four, or the two heaviest — priced and measured.
 *   C (35–55)    the rate card alone, or any two of the cheaper three.
 *   D (0–25)     one cheap fact or none: a plan nobody has evidenced yet.
 */
export const GRADE_BANDS = Object.freeze([
  Object.freeze({ letter: "A", label: "every evidence signal stated", minScore: MAX_SCORE }),
  Object.freeze({ letter: "B", label: "most evidence stated", minScore: 60 }),
  Object.freeze({ letter: "C", label: "some evidence stated", minScore: 35 }),
  Object.freeze({ letter: "D", label: "little or no evidence stated", minScore: 0 }),
]);

/**
 * The rules, in one list, each with the id it reports under, the weight it
 * carries, the ONE sentence saying what the lead would have to state to clear
 * it, and the assumption behind its weight repeated in prose for the reader.
 *
 * `clears` reads only the derived input record below — never the plan's dollars.
 */
export const EVIDENCE_RULES = Object.freeze([
  Object.freeze({
    id: "baseline-observed",
    name: "Observed baseline period",
    weight: RULE_WEIGHTS.baseline,
    statement: "State the period this plan is measured against by reading a provider export, "
      + "rather than planning against the bundled example's invented month.",
    assumption: "Weighted below pricing because an unobserved baseline can be wrong about the "
      + "size of every move without changing which move is largest.",
    clears: (facts) => facts.baselineObserved,
  }),
  Object.freeze({
    id: "exclusions-named",
    name: "Named exclusions",
    weight: RULE_WEIGHTS.exclusions,
    statement: "Name the workloads excluded from every committed move, or state “none” for a "
      + "move that excludes nothing.",
    assumption: "Weighted below the baseline because unnamed exclusions overstate one move's "
      + "eligible base, an error bounded by that base rather than by the whole plan.",
    clears: (facts) => facts.exclusionsOutstanding === 0,
    outstanding: (facts) => facts.exclusionsOutstanding,
  }),
  Object.freeze({
    id: "rate-card-declared",
    name: "Declared rate card",
    weight: RULE_WEIGHTS.rateCard,
    statement: "Declare the contracted input and output rates for every destination model, so "
      + "the plan is priced at what this organization pays rather than at list prices.",
    assumption: "Weighted heaviest because list pricing is wrong by the whole contracted "
      + "discount on every dollar in the plan, an error no scoping fact bounds.",
    clears: (facts) => facts.rateCardDeclared,
  }),
  Object.freeze({
    id: "refusals-recorded",
    name: "Recorded team refusals",
    weight: RULE_WEIGHTS.refusals,
    statement: "Record, for every committed move, whether the team that owns it has refused it.",
    assumption: "Weighted equal to exclusions because a late refusal removes one move's dollars "
      + "entirely, and we have no evidence which of the two goes wrong more often.",
    clears: (facts) => facts.refusalsOutstanding === 0,
    outstanding: (facts) => facts.refusalsOutstanding,
  }),
]);

/**
 * Every rule in the ONE declared display order, so the disclosure that explains
 * a grade lists its rules in the same order the blockers are reported in.
 * Computed once from the comparator below rather than typed out, because two
 * hand-kept orders are one edit away from disagreeing.
 */
export const EVIDENCE_RULES_ORDERED = Object.freeze(
  [...EVIDENCE_RULES]
    .map((rule) => ({ rule, ruleId: rule.id, weight: rule.weight }))
    .sort((left, right) => byDeclaredOrder(left, right))
    .map((entry) => entry.rule));

/**
 * BLOCKER ORDER, declared once and never left to insertion or set iteration:
 * heaviest weight first, and ties broken on rule id ascending. Both keys are
 * data, so two runs over the same plan serialise byte-identically.
 */
export const BLOCKER_ORDER =
  "Blockers are ordered by the weight they cost, heaviest first; ties break on rule id, "
  + "ascending. The order never depends on the order rules were evaluated in.";

/** Said instead of a number when nothing is committed. An absence, not a zero. */
export const GRADE_ABSENT_REASON =
  "No evidence grade is shown, because no move is committed yet and an uncommitted plan is not "
  + "an unevidenced one — there is nothing to grade. An absent grade is not a failing one.";

/** Said when every rule cleared, so the grade is not a bare letter over silence. */
export const NO_BLOCKERS_SUMMARY =
  "No rule is blocking this plan: all four evidence signals are stated, and each one is listed "
  + "with the assumption behind its weight below.";

/** The evidence signal a lever states, per rule that reads it. */
const EXCLUSIONS_LEVER = "excludedWorkloads";
const REFUSALS_LEVER = "refusingTeams";

/** Has this move stated the named lever at all? The VALUE is never read. */
const statesLever = (move, key) =>
  (move?.levers ?? []).some((lever) => lever?.key === key && lever?.stated === true);

/**
 * The whole of what the rules see. Presence and counts — no dollars, no shares,
 * no lever values, and no lead-entered text.
 *
 * @param {object} plan `planScope()`'s own model.
 * @param {{rateCardDeclared?: boolean, baselineObserved?: boolean}} evidence facts
 *   the analysis states outside the plan.
 */
export function evidenceFacts(plan, evidence = {}) {
  const committed = (plan?.moves ?? []).filter((move) => move?.committed === true);
  return Object.freeze({
    committedCount: committed.length,
    exclusionsOutstanding: committed.filter((move) => !statesLever(move, EXCLUSIONS_LEVER)).length,
    refusalsOutstanding: committed.filter((move) => !statesLever(move, REFUSALS_LEVER)).length,
    rateCardDeclared: evidence?.rateCardDeclared === true,
    baselineObserved: evidence?.baselineObserved === true,
  });
}

/**
 * The two evidence signals that live on the analysis rather than on the plan.
 *
 * A rate card counts as declared only at the shipped ladder's `declared` tier —
 * the published-list reference card the page falls back to is not a declaration
 * anyone made. A baseline counts as observed only when the reader IMPORTED the
 * period: the bundled example states a period, but it is an invented one, and a
 * plan built on it is a rehearsal.
 */
export function planEvidence({ analysis = null, imported = false } = {}) {
  const period = typeof analysis?.period === "string" ? analysis.period.trim() : "";
  return Object.freeze({
    rateCardDeclared: analysis?.modelRouting?.rateCardConfidence?.tier === "declared",
    baselineObserved: imported === true && period !== "",
  });
}

/** The band a score falls in. The bands are descending, so the first hit wins. */
function bandFor(score) {
  return GRADE_BANDS.find((band) => score >= band.minScore) ?? GRADE_BANDS[GRADE_BANDS.length - 1];
}

/** Heaviest first, then rule id ascending. See BLOCKER_ORDER. */
function byDeclaredOrder(left, right) {
  if (right.weight !== left.weight) return right.weight - left.weight;
  // Code-unit comparison, not `localeCompare`: a collation that varies with the
  // reader's locale would vary the blocker order with it.
  if (left.ruleId === right.ruleId) return 0;
  return left.ruleId < right.ruleId ? -1 : 1;
}

/**
 * Grade one plan on the evidence its lead has stated.
 *
 * @param {object} plan `planScope()`'s model — the same object the plan total is
 *   read off. Nothing here recomputes a dollar.
 * @param {object} [evidence] `planEvidence()`'s two analysis-level signals.
 * @returns a frozen, stably-ordered result: the grade, the score it came from,
 *   the ids that cleared, and the blockers that did not, each carrying its rule
 *   id, what would clear it, and the assumption behind its weight.
 */
export function gradePlanEvidence(plan, evidence = {}) {
  const facts = evidenceFacts(plan, evidence);
  if (facts.committedCount === 0) {
    return Object.freeze({
      version: PLAN_EVIDENCE_GRADE_VERSION,
      graded: false,
      letter: null,
      label: "",
      score: 0,
      maxScore: MAX_SCORE,
      committedCount: 0,
      clearedRuleIds: Object.freeze([]),
      blockers: Object.freeze([]),
      summary: GRADE_ABSENT_REASON,
      blockerOrder: BLOCKER_ORDER,
    });
  }

  const cleared = [];
  const blockers = [];
  let score = 0;
  for (const rule of EVIDENCE_RULES) {
    if (rule.clears(facts)) {
      cleared.push(rule.id);
      score += rule.weight;
      continue;
    }
    blockers.push(Object.freeze({
      ruleId: rule.id,
      name: rule.name,
      weight: rule.weight,
      // A count of committed moves, never a name: see UNTRUSTED TEXT above.
      movesOutstanding: rule.outstanding ? rule.outstanding(facts) : 0,
      statement: rule.statement,
      assumption: rule.assumption,
    }));
  }
  const band = bandFor(score);
  blockers.sort(byDeclaredOrder);
  cleared.sort();

  return Object.freeze({
    version: PLAN_EVIDENCE_GRADE_VERSION,
    graded: true,
    letter: band.letter,
    label: band.label,
    score,
    maxScore: MAX_SCORE,
    committedCount: facts.committedCount,
    clearedRuleIds: Object.freeze(cleared),
    blockers: Object.freeze(blockers),
    summary: blockers.length === 0 ? NO_BLOCKERS_SUMMARY : "",
    blockerOrder: BLOCKER_ORDER,
  });
}
