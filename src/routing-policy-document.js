// The routing policy document: the ranked rules on screen, handed over as a file
// somebody can read, diff, and argue with outside this page.
//
// IT DECIDES NOTHING. Every field below is copied off the slate `routing-slate.js`
// already composed and the page already painted, so the file a reader receives and
// the list they were looking at cannot disagree. No figure is recomputed, no
// threshold is re-applied, and no rule is added, dropped or re-ranked here.
//
// PURE AND LOCAL. No fetch, no credential, no prompt text, no customer content —
// not in a field, not in a comment field, because there is no comment field. The
// inputs are the slate and a timestamp the caller reads; this module reads no
// clock of its own.
//
// BYTE-STABLE. Two exports of the same slate at the same timestamp are the same
// string, character for character. That is what makes the file diffable, which is
// the only reason to hand a policy over as a file rather than as a screenshot.
// Three rules hold it:
//
//   KEY ORDER   every object below is an object literal written in the order it
//               serializes in. Nothing is built by iterating `Object.keys`, so no
//               key order depends on how a rule happened to be constructed.
//   RULE ORDER  the slate's own rank, taken in array order. The slate's
//               comparator is total, so that order is a property of the data.
//   NUMBERS     every dollar figure on the slate is already an integer — the
//               slate truncates — so no float formatting reaches JSON.stringify.
//
// The one field that moves between two exports of the same export is `generatedAt`,
// and it is an argument for exactly that reason.

import { ROUTING_SLATE_VERSION } from "./routing-slate.js";

/** What this file IS, for a reader who has one and no page to go with it. */
export const ROUTING_POLICY_SCHEMA = "shiplog/routing-policy";

/** The shape of the document, not the version of the data in it. */
export const ROUTING_POLICY_VERSION = "1.0.0";

export const ROUTING_POLICY_MEDIA_TYPE = "application/json";
export const ROUTING_POLICY_FILE_NAME = "routing-policy.json";

/** The control's visible words, held here so the page and the view agree. */
export const ROUTING_POLICY_CONTROL_LABEL = "Download routing policy";

/**
 * Said inside the document, in the register the rest of the page uses. A file
 * outlives the screen it came from: whoever opens it next may never have seen
 * the panel, the basis line under it, or the word "proposed" on any rule.
 */
export const ROUTING_POLICY_STATEMENT =
  "This is a proposal, not a configuration. Every rule in it was worked out in your own "
  + "browser from the export you read there, and every dollar figure is modelled potential "
  + "rather than money anybody has measured. Read it, check each rule against what your "
  + "gateway is actually serving, and change nothing on a live gateway until you have.";

/** Why there is no file to hand over, in words the control can state. */
export const ROUTING_POLICY_REFUSALS = Object.freeze({
  no_slate: "No routing slate has been composed yet, so there is no policy to download.",
  no_rules: "No routing change is ranked, so there is no policy to download.",
});

/**
 * Whether there is a policy to hand over, and the sentence to say when there is
 * not. An empty policy is worse than a refused one: it downloads cleanly and
 * teaches a reader their gateway has nothing to fix.
 *
 * @param {object|null} slate the slate `routingSlate()` returned.
 * @returns {{available: boolean, reason: string}}
 */
export function routingPolicyAvailability(slate) {
  if (!slate || typeof slate !== "object") {
    return { available: false, reason: ROUTING_POLICY_REFUSALS.no_slate };
  }
  const rules = Array.isArray(slate.rules) ? slate.rules : [];
  if (!slate.available || rules.length === 0) {
    return { available: false, reason: slate.reason || ROUTING_POLICY_REFUSALS.no_rules };
  }
  return { available: true, reason: "" };
}

/**
 * The conditions under which one rule is the rule it claims to be. None of them
 * is invented here: each is a field the slate already carries, restated as the
 * thing a reader has to hold true before applying the rule. `reviewBeforeApply`
 * is the constant that never turns false, because nothing on this page can
 * observe a live gateway.
 */
function guardrails(rule, period) {
  return {
    appliesToOrgUnit: rule.unit,
    appliesToSourceTier: rule.sourceTier,
    derivedFromPeriod: period,
    confidence: rule.confidence,
    basis: rule.basis,
    lifecycle: rule.lifecycle,
    reviewBeforeApply: true,
  };
}

/**
 * Where this rule's number came from, close enough to check. The statement is
 * the slate's own derivation line — the line the figure was computed from and
 * the line a director disputes — and `source` names which of the two candidate
 * forms produced it, so a reader knows whether the model was named in their
 * export or inferred from an org unit's blended price.
 */
function evidence(rule, slate) {
  return {
    statement: rule.evidence,
    derivedFrom: slate.source,
    slateVersion: ROUTING_SLATE_VERSION,
    rank: rule.rank,
  };
}

/** One rule entry, in the order it serializes. */
function policyRule(rule, slate) {
  return {
    rank: rule.rank,
    sourceModel: rule.source,
    sourceTier: rule.sourceTier,
    targetTier: rule.targetTier,
    expectedMonthlyReturnUsd: rule.expectedMonthlyUsd,
    observedChangeUsd: rule.observedChangeUsd ?? null,
    guardrails: guardrails(rule, slate.period ?? null),
    evidence: evidence(rule, slate),
  };
}

/**
 * Compose the policy document from the slate already on screen.
 *
 * @param {object} slate the slate `routingSlate()` returned and the page painted.
 * @param {string} generatedAt an ISO-8601 instant the CALLER read. This module
 *   reads no clock: a generator that stamped its own would make two exports of
 *   one export differ, which is the property the file exists to have.
 * @returns {object} a plain object, its keys in serialization order.
 * @throws {Error} with the stated refusal when there is no policy to compose.
 *   Refusing loudly beats writing a file with an empty `rules` array in it.
 */
export function routingPolicyDocument(slate, generatedAt) {
  const { available, reason } = routingPolicyAvailability(slate);
  if (!available) throw new Error(reason);
  if (typeof generatedAt !== "string" || !generatedAt) {
    throw new Error("A routing policy needs the timestamp its caller read, as a string.");
  }
  return {
    schema: ROUTING_POLICY_SCHEMA,
    version: ROUTING_POLICY_VERSION,
    generatedAt,
    period: slate.period ?? null,
    statement: ROUTING_POLICY_STATEMENT,
    basis: slate.basis,
    tieBreak: slate.tieBreak,
    ruleCount: slate.rules.length,
    totalExpectedMonthlyReturnUsd: slate.totalExpectedMonthlyUsd,
    rules: slate.rules.map((rule) => policyRule(rule, slate)),
  };
}

/**
 * The document as the exact bytes the reader receives: two-space indent, one
 * trailing newline, and nothing else between one export and the next.
 */
export function routingPolicyText(slate, generatedAt) {
  return `${JSON.stringify(routingPolicyDocument(slate, generatedAt), null, 2)}\n`;
}

/**
 * What the section says once the file is on its way. It repeats the census the
 * status line was already carrying, so a reader who hears this instead of the
 * ranked summary has lost nothing, and it repeats the proposal claim, because
 * the file's own statement is the one thing they cannot hear from here.
 */
export function routingPolicyDownloadedMessage(slate) {
  const count = Array.isArray(slate?.rules) ? slate.rules.length : 0;
  const period = slate?.period ? `, from ${slate.period}` : "";
  return `Routing policy downloaded: ${count} ranked rules${period}. It is a proposal — `
    + "review it before applying any of it to a live gateway.";
}
