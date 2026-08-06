// How well a decision is backed, as one rule set a director can read and argue
// with.
//
// WHY THIS EXISTS. A lead scanning the history can see a decision's status but
// not whether the record behind it would survive being questioned. "Accepted"
// with no owner, no dated context, no alternative and no release is a sentence,
// not a decision. This module turns that judgement into four yes/no checks and
// one ordered rule, so the line on the row is reproducible from the record and
// disputable in words rather than defended as a feeling.
//
// WHAT IT IS NOT. There is no weighting, no threshold anyone can tune, and no
// percentage. Four checks either pass or they do not, and the order below is
// the whole model. A number nobody can re-derive is worse than no number.
//
// ---------------------------------------------------------------------------
// THE RULE ORDER. Applied top to bottom; the first rule that matches decides.
// ---------------------------------------------------------------------------
//
//   1. backing/missing-owner — no owner is recorded.
//      ASSUMPTION: owner ranks first because a decision with no owner cannot be
//      chased at all, so every other gap is unactionable until it is filled.
//
//   2. backing/missing-context — no context, or no usable recorded date on the
//      entry that carries it.
//      ASSUMPTION: context ranks second because it is what makes the decision
//      re-readable by someone who was not in the room, and undated context
//      cannot be placed against what was known at the time.
//
//   3. backing/missing-alternatives — nothing was recorded as considered.
//      ASSUMPTION: alternatives rank third because their absence weakens the
//      decision's credibility rather than its traceability — a reader can still
//      find the owner and the reasoning, they just cannot see what was weighed.
//
//   4. backing/missing-release — no release is associated with the decision.
//      ASSUMPTION: the release ranks last because it is the only gap that may
//      be legitimate — work that has not shipped yet has no release to name —
//      and it is the one gap that can be closed later from the release record
//      without going back to the decision's author.
//
//   5. backing/complete — all four checks passed.
//
// The order is total: exactly one of these five rules matches any record, so a
// record with three gaps still names one next action and never a tie.
//
// DETERMINISM. Same record in, same verdict out. Nothing here reads the clock,
// a random source, a locale, or `Object.keys` — every field is read by name, so
// a record whose keys were written in a different order scores identically.
// `Date.parse` is used only to ask whether a recorded timestamp is a timestamp
// at all; no date is formatted, compared against today, or rendered.
//
// UNTRUSTED INPUT. Nothing a person typed is copied into the verdict. The
// verdict strings below are authored constants plus two integers, so no owner
// name, context sentence or alternative label can travel out of here into a
// rendered line, an export, or a judge prompt.

export const DECISION_BACKING_VERSION = "shiplog-decision-backing/1.0.0";

// The four checks, in the priority order the rules above apply them in. Frozen
// and exported so the renderer, the tests and a reviewer all read one list.
export const DECISION_BACKING_CHECKS = Object.freeze([
  "owner",
  "context",
  "alternatives",
  "release",
]);

// What each check is called on screen. Sentence-shaped, because they are read
// one per line inside the disclosure.
export const DECISION_BACKING_LABELS = Object.freeze({
  owner: "Owner",
  context: "Dated context",
  alternatives: "Alternatives considered",
  release: "Associated release",
});

// One entry per failing rule, in rule order. `verdict` is the whole line a row
// shows; `nextAction` is the same instruction on its own, for a caller that
// already has a heading. Both are authored here rather than composed from a
// template, so the sentence a lead reads is reviewable as a sentence.
const MISSING_RULES = Object.freeze([
  Object.freeze({
    check: "owner",
    ruleId: "backing/missing-owner",
    nextAction: "Name an owner for this decision.",
    verdict: "Not fully backed. Next: name an owner for this decision.",
  }),
  Object.freeze({
    check: "context",
    ruleId: "backing/missing-context",
    nextAction: "Record dated context for this decision.",
    verdict: "Not fully backed. Next: record dated context for this decision.",
  }),
  Object.freeze({
    check: "alternatives",
    ruleId: "backing/missing-alternatives",
    nextAction: "Record at least one alternative that was considered.",
    verdict: "Not fully backed. Next: record at least one alternative that was considered.",
  }),
  Object.freeze({
    check: "release",
    ruleId: "backing/missing-release",
    nextAction: "Link the release that carried this decision.",
    verdict: "Not fully backed. Next: link the release that carried this decision.",
  }),
]);

export const DECISION_BACKING_COMPLETE_RULE = "backing/complete";

// A blank string is not an owner. Storage and imports both hand back records a
// person half-filled, and `"   "` counting as a name is the failure mode that
// makes a completeness check worthless.
const filled = (value) => typeof value === "string" && value.trim() !== "";

// Dated means "carries a timestamp that parses", nothing more. It is never
// compared against now: a check whose answer changes tomorrow is not a check.
const dated = (value) => filled(value) && Number.isFinite(Date.parse(value));

/**
 * How many alternatives a decision records.
 *
 * Two stored shapes exist and both are counted the way the decision detail page
 * already reads them (see normalizeAlternatives in decision-detail.js): an
 * array is a structured comparison and each entry is one alternative, while the
 * older free-text field is exactly one recorded alternative however long it is.
 * The rule is duplicated rather than imported so this module stays pure — the
 * detail page module pulls in a renderer and a share control that a scorer has
 * no business loading.
 */
export function countAlternatives(decision) {
  const stored = decision?.alternatives;
  if (Array.isArray(stored)) return stored.filter((entry) => entry !== null && entry !== undefined).length;
  return filled(stored) ? 1 : 0;
}

/**
 * How many releases are confirmed to have carried this decision.
 *
 * Read off the shared shipped-releases verdict the history already composes, so
 * the count on this line can never disagree with the releases named beside it.
 * Only the `shipped` state counts: an association whose release record cannot
 * be read is an unresolved reference, and treating it as a release would let a
 * broken link stand in for evidence.
 */
export function countAssociatedReleases(record) {
  const shipped = record?.shipped;
  if (shipped?.state !== "shipped") return 0;
  return Array.isArray(shipped.entries) ? shipped.entries.length : 0;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Score one decision's backing.
 *
 * `record` is the composed history record — `{ decision, shipped }` — which is
 * what every caller in the history view already holds. A bare stored decision
 * is also accepted and scores with no associated release, which is the honest
 * answer when the caller has not composed the release side at all.
 *
 * Returns a frozen verdict:
 *   verdict     the whole line to show, as authored text
 *   state       "backed" or "incomplete"
 *   passed      the checks that passed, in DECISION_BACKING_CHECKS order
 *   failed      the checks that failed, in the same order
 *   ruleId      the rule that decided the verdict
 *   nextAction  the single highest-priority gap as an instruction, or null
 */
export function scoreDecisionBacking(record) {
  const decision = record?.decision ?? record ?? {};
  const alternatives = countAlternatives(decision);
  const releases = countAssociatedReleases(record);
  const results = {
    owner: filled(decision.owner),
    context: filled(decision.context) && dated(decision.createdAt),
    alternatives: alternatives > 0,
    release: releases > 0,
  };
  const passed = DECISION_BACKING_CHECKS.filter((check) => results[check]);
  const failed = DECISION_BACKING_CHECKS.filter((check) => !results[check]);
  const rule = MISSING_RULES.find((candidate) => !results[candidate.check]);
  if (!rule) {
    return Object.freeze({
      verdict: `Backed: owner, context, ${plural(alternatives, "alternative")}, ${plural(releases, "release")}.`,
      state: "backed",
      passed: Object.freeze(passed),
      failed: Object.freeze(failed),
      ruleId: DECISION_BACKING_COMPLETE_RULE,
      nextAction: null,
    });
  }
  return Object.freeze({
    verdict: rule.verdict,
    state: "incomplete",
    passed: Object.freeze(passed),
    failed: Object.freeze(failed),
    ruleId: rule.ruleId,
    nextAction: rule.nextAction,
  });
}
