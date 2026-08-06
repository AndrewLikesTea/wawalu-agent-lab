// How sure we are that a decision record can be quoted (issue #1188).
//
// WHAT THIS ANSWERS
// -----------------
// A lead reads the history and wants to quote a row to somebody who was not in
// the room. The row already shows what was decided; it does not say whether the
// record behind it is complete enough to stand up when the decision is
// challenged. This module answers that once, per decision, as one graded
// sentence plus the evidence that produced it.
//
// It grades the RECORD, never the decision. "Backed" means the log holds the
// four things a reader needs to check the claim themselves. It is not a
// judgement that the decision was correct, and nothing here reads status.
//
// THE RULE ORDER, AND THE ASSUMPTION BEHIND EACH POSITION
// -------------------------------------------------------
// The four checks below are in a fixed priority order. The order is the rule:
// when more than one check fails, the verdict names the FIRST failure in this
// list and nothing else. Each position is an assumption, and each is arguable —
// so each is written down here rather than left in the weights.
//
//   1. owner        — Assumption: an unowned record has nobody to ask, so every
//                     other gap in it is unfixable until this one is closed.
//   2. context      — Assumption: a reader who cannot see why a decision was
//                     made cannot evaluate it at all, so context outranks the
//                     alternatives that only refine it.
//   3. alternatives — Assumption: "we considered X and rejected it" is what
//                     turns a record from an assertion into a decision, so it
//                     outranks evidence that the decision was carried out.
//   4. release      — Assumption: shipping is the weakest of the four for
//                     quotability, because a sound, owned, argued decision is
//                     quotable before it ships and a shipped one with no
//                     reasoning behind it still is not.
//
// A director who disagrees with a position is disagreeing with the sentence
// beside it, not with an opaque weight. There are no weights and no score: four
// booleans and their order decide everything, so two readers stepping through
// the same record reach the same verdict by hand.
//
// WHAT "A DATED CONTEXT ENTRY" MEANS HERE
// ---------------------------------------
// A shipped decision record carries one `context` field and one `createdAt`
// (see decision-entry.js and shiplog-export-schema.js); there is no per-entry
// context log in the product today. So the check is satisfied by context text
// that is non-empty AND a `createdAt` a browser can parse — the dated context
// entry the record actually has. If a record ever grows a real context log,
// this is the one function that has to learn about it.
//
// PURITY AND DETERMINISM
// ----------------------
// No DOM, no storage, no network, and no clock. None of the four checks is
// about recency, so this function takes no `now` at all rather than taking one
// it would ignore — there is no instant it could read and no value it could
// drift against. Every output string is built from constants and from counts,
// never from iteration over object keys, so the same record always yields
// byte-identical strings. decision-confidence rendering lives in app.js.

/** Longest run of record-supplied text an evidence line will show. */
export const CONFIDENCE_EVIDENCE_LIMIT = 120;

const text = (value) => (typeof value === "string" ? value.trim() : "");

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

// Record text, bounded so one pathological field cannot push the disclosure off
// the row. The ellipsis is appended to a plain slice, so the same input always
// truncates at the same character.
const evidenceText = (values) => {
  const joined = values.map((value) => text(value)).filter(Boolean).join(", ");
  return joined.length > CONFIDENCE_EVIDENCE_LIMIT
    ? `${joined.slice(0, CONFIDENCE_EVIDENCE_LIMIT)}…`
    : joined;
};

/**
 * The four checks, in priority order. `gapVerdict` is what the row says when
 * this is the first failure; `action` is the single thing to do about it.
 * Nothing here interpolates record text, so a verdict string is always one of
 * five fixed shapes.
 */
export const CONFIDENCE_CHECKS = Object.freeze([
  Object.freeze({
    id: "owner",
    label: "Owner recorded",
    gapVerdict: "Needs an owner before this is quotable",
    action: "Record who owns this decision.",
  }),
  Object.freeze({
    id: "context",
    label: "Dated context entry",
    gapVerdict: "Needs a dated context entry before this is quotable",
    action: "Record the context behind this decision on a record with a readable date.",
  }),
  Object.freeze({
    id: "alternatives",
    label: "Alternative considered",
    gapVerdict: "Needs a considered alternative before this is quotable",
    action: "Record at least one alternative that was considered and rejected.",
  }),
  Object.freeze({
    id: "release",
    label: "Associated release",
    gapVerdict: "Needs an associated release before this is quotable",
    action: "Link the release that shipped this decision.",
  }),
]);

/** The order above, as ids, for callers that want to assert the rule order. */
export const CONFIDENCE_CHECK_ORDER = Object.freeze(CONFIDENCE_CHECKS.map(({ id }) => id));

/** The rule that decided a backed verdict. */
export const BACKED_RULE_ID = "backed:all-checks-pass";

/** The rule that decided an unbacked verdict, named by the check it stopped at. */
export const gapRuleId = (checkId) => `first-gap:${checkId}`;

/** Label for the disclosure control. One per decision row. */
export const CONFIDENCE_DISCLOSURE_LABEL = "How this grade was decided";

/** Words, not colour or an icon, for each check's outcome inside the disclosure. */
export const CONFIDENCE_OUTCOME_WORDS = Object.freeze({ pass: "Pass", gap: "Gap" });

// The alternatives a record counts as considered. This mirrors
// normalizeAlternatives in decision-detail.js — an array of alternative objects,
// or the legacy single string that older records and the entry form still write
// — without importing it, because that module is a rendering module and the
// history page must not pull it into its initial payload for a count.
function countedAlternatives(decision) {
  if (Array.isArray(decision?.alternatives)) {
    return decision.alternatives
      .map((alternative, index) => (typeof alternative === "string"
        ? text(alternative)
        : text(alternative?.name) || (alternative ? `Alternative ${index + 1}` : "")))
      .filter(Boolean);
  }
  const legacy = text(decision?.alternatives);
  return legacy ? [legacy] : [];
}

// The releases a record counts as associated. A composed history record already
// carries the resolved answer on `shipped` (shipped-releases.js decides which
// associations are readable); a bare decision may be handed its releases
// directly. Dangling associations are deliberately not counted: an association
// whose release cannot be read is not evidence a reader can follow.
function countedReleases(record, decision) {
  const entries = Array.isArray(record?.shipped?.entries) ? record.shipped.entries : null;
  const releases = entries ?? (Array.isArray(record?.releases)
    ? record.releases
    : Array.isArray(decision?.releases) ? decision.releases : []);
  return releases
    .map((release) => (typeof release === "string" ? text(release) : text(release?.version)))
    .filter(Boolean);
}

function hasDatedContext(decision) {
  if (!text(decision?.context)) return false;
  const recordedAt = text(decision?.createdAt);
  return recordedAt !== "" && Number.isFinite(Date.parse(recordedAt));
}

/**
 * Grade one decision record.
 *
 * Accepts either a composed history record (`{ decision, shipped }`, the shape
 * renderHistory works in) or a bare decision object, so the page and a test can
 * hand it the same thing they already have.
 *
 * Returns a plain object:
 *   verdict    the one sentence the row shows
 *   backed     true only when all four checks pass
 *   checks     the four checks in rule order, each with `passed` and evidence
 *   nextAction the single thing to do, or null when the record is backed
 *   ruleId     which rule produced the verdict
 */
export function scoreDecisionConfidence(record = {}) {
  const decision = record?.decision ?? record;
  const alternatives = countedAlternatives(decision);
  const releases = countedReleases(record, decision);
  const owner = text(decision?.owner);
  const recordedAt = text(decision?.createdAt);

  const results = {
    owner: { passed: owner !== "", count: owner === "" ? 0 : 1, evidence: evidenceText([owner]) },
    context: {
      passed: hasDatedContext(decision),
      count: hasDatedContext(decision) ? 1 : 0,
      // The recorded date, not the context prose: the check is about the entry
      // being dated, and the prose is already on the row above.
      evidence: hasDatedContext(decision) ? recordedAt : "",
    },
    alternatives: {
      passed: alternatives.length > 0,
      count: alternatives.length,
      evidence: evidenceText(alternatives),
    },
    release: { passed: releases.length > 0, count: releases.length, evidence: evidenceText(releases) },
  };

  // Built by walking CONFIDENCE_CHECKS, never by iterating the object above, so
  // the order is the stated rule order and not an insertion order.
  const checks = CONFIDENCE_CHECKS.map((check) => ({
    id: check.id,
    label: check.label,
    passed: results[check.id].passed,
    count: results[check.id].count,
    evidence: results[check.id].evidence,
  }));

  const gap = CONFIDENCE_CHECKS.find((check) => !results[check.id].passed) ?? null;
  if (!gap) {
    return {
      verdict: `Backed: owner, context, ${plural(results.alternatives.count, "alternative")}, `
        + `${plural(results.release.count, "release")}`,
      backed: true,
      checks,
      nextAction: null,
      ruleId: BACKED_RULE_ID,
    };
  }

  return {
    // Exactly one gap is named, however many failed. The rest are in the
    // disclosure: a row that lists four problems does not say what to do first.
    verdict: gap.gapVerdict,
    backed: false,
    checks,
    nextAction: gap.action,
    ruleId: gapRuleId(gap.id),
  };
}
