// The scope levers a lead actually moves, and what a moved lever means as an
// input to `plan-scope.js` (#1288).
//
// IT COMPUTES NO MONEY. Not a dollar, not a grade, not a threshold. Every figure
// on the surface still comes from `planScope()`, which is the one place the plan
// arithmetic is written down; this module only turns what a person typed into
// the commitment shape that function already takes. A second copy of the
// arithmetic in the view layer is exactly the drift this separation prevents.
//
// SILENCE STAYS SILENT. A lever nobody has touched is reported as UNSTATED, not
// as zero-that-looks-stated, so `plan-scope.js` applies the conservative default
// it documents rather than one invented here.
//
// THE TWO BASES, and why they are what they are:
//
//   eligibleTeams: 1   A slate rule names exactly ONE org unit — it is the unit's
//                      own down-routing candidate. So the team that can refuse
//                      this move is one team, and its refusal removes all of it.
//                      This is a fact about the slate's shape, not a factor
//                      computed here: `plan-scope.js` still divides.
//   eligibleWorkloads  NOT STATED, ever. Nothing on this page knows how many
//                      workloads are eligible for a move, so naming an excluded
//                      one cannot honestly shrink the dollars — it records what
//                      is out of scope, and it is one of the three facts the
//                      shipped grade requirement demands before a plan figure
//                      may be labelled at all.
//
// PURE. No DOM, no clock, no storage, no randomness.

/** The accepted range for a feasible share, in whole percent. */
export const FEASIBLE_SHARE_MIN = 0;
export const FEASIBLE_SHARE_MAX = 100;

/** The word a lead types to state "nothing is excluded" without naming a workload. */
export const NO_EXCLUSIONS = "none";

/**
 * The refusal, naming the field and the accepted range. One sentence, because a
 * refusal a reader has to decode is a refusal they will retype blindly.
 */
export const feasibleShareRefusal = (moveName) =>
  `Feasible share for ${moveName}: enter a whole number from ${FEASIBLE_SHARE_MIN} to `
  + `${FEASIBLE_SHARE_MAX}.`;

/** What a lead has said about one move before they have said anything. */
export const emptyMoveScope = () => ({
  inPlan: false,
  // The last ACCEPTED share. A refused entry never reaches this, which is what
  // makes a refusal non-destructive: the figure keeps standing on the last
  // number that passed.
  sharePct: null,
  excludedText: "",
  refuses: false,
});

/**
 * Read a typed feasible share.
 *
 * Empty is not a refusal — it is a lead clearing an answer, which returns the
 * lever to silence. Anything else must be a bare whole number inside the range:
 * no sign, no decimal point, no exponent, no units. `50.5`, `-5`, `1e2` and
 * `half` are all refused, and refused the same way.
 */
export function readFeasibleShare(text) {
  const raw = String(text ?? "").trim();
  if (raw === "") return { accepted: true, stated: false, value: null };
  if (!/^[0-9]{1,3}$/.test(raw)) return { accepted: false, stated: false, value: null };
  const value = Number(raw);
  if (value < FEASIBLE_SHARE_MIN || value > FEASIBLE_SHARE_MAX) {
    return { accepted: false, stated: false, value: null };
  }
  return { accepted: true, stated: true, value };
}

/**
 * The workloads a lead named as excluded, or `null` when they have named
 * nothing. `none` is a STATEMENT of zero exclusions, which is a different claim
 * from an empty field, and the two must not collapse into one.
 */
export function excludedWorkloadNames(text) {
  const raw = String(text ?? "").trim();
  if (raw === "") return null;
  if (raw.toLowerCase() === NO_EXCLUSIONS) return [];
  return raw.split(",").map((name) => name.trim()).filter(Boolean);
}

/**
 * One move's levers as a commitment for `planScope()`, or `null` when the lead
 * has taken the move out of the plan. A move out of the plan contributes
 * nothing and is not counted — but its scope is retained by the caller, so
 * putting it back restores every entry.
 */
export function commitmentFor(key, scope) {
  if (!scope?.inPlan) return null;
  const excluded = excludedWorkloadNames(scope.excludedText);
  return {
    move: key,
    reroutedSharePct: scope.sharePct,
    excludedWorkloads: excluded === null ? null : excluded.length,
    // Deliberately absent: see THE TWO BASES above.
    eligibleTeams: 1,
    refusingTeams: scope.refuses ? 1 : null,
  };
}

/**
 * Every commitment a lead has made, in the slate's own move order.
 *
 * @param {Map<string, object>} scopes what the lead has said, keyed by move key.
 * @param {Array<{key: string}>} moves the moves on the slate, in rank order.
 */
export function planCommitments(scopes, moves) {
  const commitments = [];
  for (const move of moves ?? []) {
    const commitment = commitmentFor(move.key, scopes?.get?.(move.key));
    if (commitment) commitments.push(commitment);
  }
  return commitments;
}
