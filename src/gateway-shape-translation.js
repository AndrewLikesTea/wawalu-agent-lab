// The gateway mapping contract: what a downloaded routing policy turns into on
// the two generic shapes a request router is configured with, stated as code so
// the claim can be checked rather than believed.
//
// WHY IT EXISTS. `routing-policy-document.js` hands a reader a versioned JSON
// policy. That file is a proposal about routing; it is not a gateway config, and
// nothing on this page can make it one. What a platform team asks next is the
// narrow question this module answers: given the shape my router is configured
// in, which of these rules survive the translation, and which do not.
//
// TWO SHAPES, AND TWO IS THE CEILING:
//
//   rule-list      an ordered array of {match, target}, evaluated FIRST MATCH
//                  WINS. Order is the whole semantics, so the policy's own rank
//                  is the array index and nothing re-sorts it here.
//   weighted-pool  named pools of upstreams carrying integer weights, each pool
//                  with a default upstream. Weight is a percentage of the pool.
//
// Both are generic. NO VENDOR, product or proprietary schema is named, imitated
// or referenced anywhere in this module, and no field name below was copied from
// one — they are the plainest words for the thing.
//
// PURE AND OFFLINE. No DOM, no fetch, no storage, no clock, no randomness. The
// output is a plain object that is a function of (policy, shape) and nothing
// else, so a test can compare it exactly and two readers translating the same
// policy get the same bytes. `generatedAt` is read off the policy by NOTHING
// here: a translated shape that carried an instant could not be compared.
//
// IT REFUSES RATHER THAN GUESSES. A policy whose `version` this mapping does not
// know translates nothing and says which version it saw — a router config
// inferred from a schema nobody checked is worse than no config.
//
// NOTHING IS SILENTLY DROPPED. A rule this shape cannot express is not omitted:
// it is listed in `untranslatable` with the field that could not be carried and
// the reason, and the caller renders that count beside the snippet.
//
// WHAT NEITHER SHAPE CARRIES, on purpose: every dollar figure, every confidence
// level, the evidence line and the lifecycle. A router has no field for what a
// route is worth, and a comment claiming $12,000 a month inside a live config is
// a claim nobody re-checks. Those stay in the policy file, which is the record.
// They are named in `fieldsNotCarried` so the omission is machine-readable.

import { ROUTING_POLICY_SCHEMA, ROUTING_POLICY_VERSION } from "./routing-policy-document.js";

/** The version of THIS mapping, moved when a translated shape changes. */
export const GATEWAY_MAPPING_VERSION = "gateway-shape-mapping/1.0.0";

/** The policy contract this mapping reads, and the versions of it it accepts. */
export const ACCEPTED_POLICY_SCHEMA = ROUTING_POLICY_SCHEMA;
export const ACCEPTED_POLICY_VERSIONS = Object.freeze([ROUTING_POLICY_VERSION]);

/** The two target shapes. Identifiers, not names of anything anybody sells. */
export const GATEWAY_SHAPES = Object.freeze({
  RULE_LIST: "rule-list",
  WEIGHTED_POOL: "weighted-pool",
});

/** What each shape is, in the one line a reader needs above a snippet. */
export const GATEWAY_SHAPE_LABELS = Object.freeze({
  [GATEWAY_SHAPES.RULE_LIST]: "Ordered rule list, evaluated first match wins",
  [GATEWAY_SHAPES.WEIGHTED_POOL]: "Weighted upstream pools, each with a default",
});

/** Where one translation ended up. Exactly one of these, always. */
export const TRANSLATION_STATES = Object.freeze({
  TRANSLATED: "translated",
  EMPTY: "empty",
  UNSUPPORTED_VERSION: "unsupported_version",
  UNSUPPORTED_SHAPE: "unsupported_shape",
  UNREADABLE: "unreadable",
});

/** Why one rule did not reach the shape, in the words the page prints. */
export const UNTRANSLATABLE_REASONS = Object.freeze({
  no_org_unit: "the rule names no org unit, so neither shape can say which traffic it applies to",
  no_target_tier: "the rule names no target tier, so there is nothing to route to",
  no_source_tier: "the rule names no current tier, so a weighted pool has no upstream to "
    + "weight the proposed one against",
});

/** Policy fields that reach neither shape, because a router has no field for them. */
export const FIELDS_NOT_CARRIED = Object.freeze([
  "expectedMonthlyReturnUsd", "observedChangeUsd", "evidence", "guardrails.confidence",
  "guardrails.basis", "guardrails.lifecycle",
]);

/**
 * Said by the rule-list shape, which has no catch-all to end on. The policy
 * ranks changes; it never claims to describe all traffic, so inventing a final
 * `match: *` entry would put every unmentioned request on a route no rule asked
 * for. The list therefore ends without a default, and says so.
 */
export const NO_CATCH_ALL =
  "This policy proposes changes to named traffic; it does not describe all traffic. The list "
  + "ends with no catch-all, so anything it does not match keeps the route it has today.";

/** Said by the weighted-pool shape, which cannot omit a default. */
export const DEFAULT_FROM_CURRENT_TIER =
  "The policy states no fallback route, so each pool defaults to the tier that rule is on "
  + "today: a pool that fails over lands where the traffic already was.";

/** Refusals, in the sentence a caller can render without composing one. */
const refusals = {
  unreadable: "This is not a routing policy document this mapping can read.",
  empty: "This policy carries no rules, so there is nothing to translate onto a gateway shape.",
};

/**
 * A pool identifier a router will accept and a human can still read: lower case,
 * one separator, nothing that needs quoting. Derived from the rule's own words,
 * so two translations of one policy name the same pools.
 */
function slug(text) {
  const cleaned = String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "unnamed";
}

/**
 * The fields of one policy rule this mapping reads, by their real paths on the
 * #1138 schema. Every path is here and nowhere else: a policy field that is
 * renamed breaks this function and therefore the fixture test, which is the
 * point of reading them in one place.
 *
 * `model` is null when the policy repeats the org unit as the source. That is
 * what the per-org-unit form of the policy does when the export never named a
 * model, and a match on a model name that is really an org unit would address
 * traffic no gateway has.
 */
function readRule(rule) {
  const guardrails = rule?.guardrails ?? {};
  const orgUnit = String(guardrails.appliesToOrgUnit ?? "");
  const sourceModel = String(rule?.sourceModel ?? "");
  return {
    rank: Number(rule?.rank ?? 0),
    orgUnit,
    model: sourceModel && sourceModel !== orgUnit ? sourceModel : null,
    sourceTier: String(guardrails.appliesToSourceTier ?? ""),
    targetTier: String(rule?.targetTier ?? ""),
    source: sourceModel || orgUnit,
  };
}

/** The reason this rule cannot be expressed in this shape, or "" if it can. */
function untranslatableReason(read, shape) {
  if (!read.orgUnit) return "no_org_unit";
  if (!read.targetTier) return "no_target_tier";
  if (shape === GATEWAY_SHAPES.WEIGHTED_POOL && !read.sourceTier) return "no_source_tier";
  return "";
}

/** One entry of the ordered list. Its index is the policy's own rank order. */
function ruleListEntry(read) {
  return {
    match: { orgUnit: read.orgUnit, model: read.model, tier: read.sourceTier || null },
    target: { tier: read.targetTier },
  };
}

/**
 * One pool. The proposed upstream carries the whole weight and the current one
 * is kept at zero rather than deleted: the policy proposes a full move, and a
 * team that wants to stage it needs the upstream it is moving off to still be
 * in the pool to raise.
 */
function weightedPool(read) {
  return {
    name: `${slug(read.orgUnit)}--${slug(read.model ?? read.sourceTier)}`,
    appliesTo: { orgUnit: read.orgUnit, model: read.model },
    default: read.sourceTier,
    upstreams: [
      { name: read.targetTier, weight: 100 },
      { name: read.sourceTier, weight: 0 },
    ],
  };
}

/** The result envelope, in the order it serializes, so a snippet is stable. */
function result(policy, shape, state, reason, translated, untranslatable, ruleCount) {
  return {
    mappingVersion: GATEWAY_MAPPING_VERSION,
    policySchema: policy && typeof policy === "object" ? (policy.schema ?? null) : null,
    policyVersion: policy && typeof policy === "object" ? (policy.version ?? null) : null,
    shape,
    shapeLabel: GATEWAY_SHAPE_LABELS[shape] ?? null,
    state,
    reason,
    ruleCount,
    translatedCount: translated ? (translated.rules?.length ?? translated.pools?.length ?? 0) : 0,
    translated,
    untranslatable,
    fieldsNotCarried: FIELDS_NOT_CARRIED,
  };
}

/**
 * Translate a downloaded routing policy onto one gateway shape.
 *
 * @param {object} policy a policy parsed from the file `routingPolicyDocument`
 *   composes. Untrusted: every field is read defensively and nothing throws.
 * @param {string} shape one of `GATEWAY_SHAPES`.
 * @returns {object} a plain, time-independent data structure. Never throws, and
 *   never returns a partly translated shape without saying what was left out.
 */
export function translateRoutingPolicy(policy, shape) {
  const known = Object.values(GATEWAY_SHAPES).includes(shape);
  if (!known) {
    return result(policy, shape, TRANSLATION_STATES.UNSUPPORTED_SHAPE,
      `This mapping knows the shapes ${Object.values(GATEWAY_SHAPES).join(" and ")}, not `
      + `"${String(shape)}".`, null, [], 0);
  }
  if (!policy || typeof policy !== "object" || !Array.isArray(policy.rules)) {
    return result(policy, shape, TRANSLATION_STATES.UNREADABLE, refusals.unreadable, null, [], 0);
  }
  // The version gate comes before any field is read. A policy from a schema this
  // mapping does not know may use the same field names for different things, and
  // a config built on that guess is the one failure nobody catches in review.
  if (!ACCEPTED_POLICY_VERSIONS.includes(policy.version)) {
    return result(policy, shape, TRANSLATION_STATES.UNSUPPORTED_VERSION,
      `This mapping (${GATEWAY_MAPPING_VERSION}) reads routing policy version `
      + `${ACCEPTED_POLICY_VERSIONS.join(", ")} and was handed ${JSON.stringify(policy.version)}. `
      + "Nothing was translated.", null, [], policy.rules.length);
  }
  if (policy.rules.length === 0) {
    return result(policy, shape, TRANSLATION_STATES.EMPTY, refusals.empty, null, [], 0);
  }

  const untranslatable = [];
  const carried = [];
  for (const rule of policy.rules) {
    const read = readRule(rule);
    const reason = untranslatableReason(read, shape);
    if (reason) {
      untranslatable.push({
        rank: read.rank,
        source: read.source,
        field: reason,
        reason: UNTRANSLATABLE_REASONS[reason],
      });
      continue;
    }
    carried.push(read);
  }

  const translated = shape === GATEWAY_SHAPES.RULE_LIST
    ? {
      shape,
      evaluation: "first match wins, in this order",
      rules: carried.map(ruleListEntry),
      default: null,
      unmatchedTraffic: NO_CATCH_ALL,
    }
    : {
      shape,
      weightUnit: "percent of the pool",
      pools: carried.map(weightedPool),
      defaultsFrom: DEFAULT_FROM_CURRENT_TIER,
    };

  return result(policy, shape, TRANSLATION_STATES.TRANSLATED, "", translated, untranslatable,
    policy.rules.length);
}

/**
 * The snippet itself, as the exact characters a reader is shown or copies:
 * two-space indent, no trailing newline, and nothing time-dependent in it.
 */
export function gatewayShapeSnippet(translation) {
  return translation?.translated ? JSON.stringify(translation.translated, null, 2) : "";
}

/**
 * What the untranslatable list says out loud. Rendered beside the snippet rather
 * than behind anything: a count of rules that did not make it is the one thing a
 * reader must not have to go looking for.
 */
export function untranslatableSummary(translation) {
  const left = translation?.untranslatable ?? [];
  if (!left.length) return "";
  const reasons = [...new Set(left.map((entry) => entry.reason))].join("; ");
  return `${left.length} of ${translation.ruleCount} rules are not in this snippet, because `
    + `${reasons}. They are still in the downloaded policy.`;
}
