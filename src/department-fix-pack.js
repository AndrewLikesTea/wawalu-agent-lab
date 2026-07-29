// The fix pack behind one department's drill-down: the named things a leader can
// actually do about that department's grade, ranked, priced where a price exists,
// and refused where one does not.
//
// IT RECOMMENDS NOTHING NEW. Every judgement in this file was already made and
// published somewhere else in this repository:
//
//   what is weak            `RUBRIC_SIGNALS` (conversation-literacy.js) — one row
//                           per weak rubric category, with the share of its
//                           shortfall a programme can realistically move.
//   how weak                Theo's rubric (`prompt-literacy-rubric.json`), read
//                           through the department row's own `signals`, whose
//                           severity is `100 - categoryScoreWeight`.
//   what a prompt was       the query classifier's category and confidence, and
//                           the department row's structural sketches — a length
//                           band, an intent class, a model tier, a signal key.
//   what routing is worth   `evaluateUnitModelRouting` (down-routing-candidates.js),
//                           whose per-model recoverable delta is used verbatim.
//
// This module composes those four into pattern-level interventions. It authors
// exactly three things of its own: the action names, the rationale sentences, and
// the ranking rule. It computes no new severity scale, no second recoverability
// number, and no saving that is not either a figure the routing rule published or
// an apportionment of a spend basis the caller supplied.
//
// PRIVACY IS A STEP, NOT AN ABSENCE. A fix pack is assembled from an allow-list of
// known fields on the inputs; every other top-level field is dropped, named in
// `redaction.droppedInputFields`, and never read. Raw prompt text, credentials and
// customer records cannot reach this surface because no field carrying them is on
// the list — and the two free-text values that *are* (a department label, a model
// identifier) are each validated against a pattern before they are published.
//
// Deterministic and side-effect free: no clock, no randomness, no I/O, no mutation
// of the caller's inputs.

import { RUBRIC_SIGNALS } from "./conversation-literacy.js";
import { QUERY_CLASSIFIER_VERSION } from "./query-classification.js";
import { PROMPT_LITERACY_RUBRIC, RUBRIC_VERSION_ID } from "./prompt-literacy-scoring.js";

/** Bump when an action, a savings rule, the ranking, or the redaction changes. */
export const DEPARTMENT_FIX_PACK_VERSION = "department-fix-pack/1.0.0";

/** The three action kinds this surface is allowed to name. There is no fourth. */
export const FIX_PACK_ACTION_KINDS = Object.freeze(["routing", "rewrite", "training"]);

/**
 * The states a fix pack can be in. `withheld` and `unavailable` are separate for
 * the same reason they are separate on the evidence panel: "this department is
 * below the grading floor" and "no department was selected" are two different
 * conversations, and a reader who conflates them fixes the wrong thing.
 */
export const FIX_PACK_STATE = Object.freeze({
  unavailable: "unavailable",
  withheld: "withheld",
  empty: "empty",
  ready: "ready",
});

/** The promise this surface makes about what a fix pack is made of. */
export const FIX_PACK_REDACTION_STATEMENT =
  "A fix pack is counts, shares, enum keys and dollars. No prompt text, no "
  + "credential, no customer record and no raw org-unit identifier is read from "
  + "the inputs or published in the result; unknown input fields are dropped "
  + "unread and named in the redaction block.";

/**
 * THE INTERVENTIONS. One per rubric weakness signal, because the signal table is
 * where this repository already decided what the weaknesses are. The action kind
 * follows the signal's own recoverability argument: over-provisioning is a
 * gateway config change (`routing`), a re-prompt spiral is fixed at the prompt
 * (`rewrite`), and an absent work intent is a programme problem (`training`).
 *
 * `savingsBasis` names where the money comes from and is not negotiable per call:
 *
 *   down_routing_delta            the routing rule's own `recoverableUsd`, used
 *                                 verbatim. No apportionment, no multiplier.
 *   apportioned_recoverable_share spendUsd × signal share × signal recoverability.
 *                                 An estimate, stated as one, and unavailable
 *                                 rather than guessed when no spend basis exists.
 */
export const FIX_PACK_INTERVENTIONS = Object.freeze([
  Object.freeze({
    actionId: "route_short_lookups_to_standard_tier",
    signal: "model_fit",
    kind: "routing",
    name: "Route short lookups to the standard tier",
    savingsBasis: "down_routing_delta",
    summary: "A gateway rule, not a behaviour change: the requester types the same thing.",
  }),
  Object.freeze({
    actionId: "rewrite_re_prompt_spirals",
    signal: "iteration_cost",
    kind: "rewrite",
    name: "Ship a re-prompt rewrite template",
    savingsBasis: "apportioned_recoverable_share",
    summary: "One template that states the ask and its acceptance test, so the "
      + "second and third calls are not needed.",
  }),
  Object.freeze({
    actionId: "train_intent_framing",
    signal: "intent_clarity",
    kind: "training",
    name: "Run an intent-framing workshop",
    savingsBasis: "apportioned_recoverable_share",
    summary: "The slowest lever and the smallest share: most of this shortfall is "
      + "policy, not literacy.",
  }),
]);

const SIGNAL_BY_KEY = new Map(RUBRIC_SIGNALS.map((signal) => [signal.key, signal]));
for (const intervention of FIX_PACK_INTERVENTIONS) {
  if (!SIGNAL_BY_KEY.has(intervention.signal)) {
    throw new RangeError(`fix pack: ${intervention.actionId} names no rubric signal`);
  }
  if (!FIX_PACK_ACTION_KINDS.includes(intervention.kind)) {
    throw new RangeError(`fix pack: ${intervention.actionId} names no action kind`);
  }
}

/** Why an intervention carries no dollar figure. Machine-readable, never prose. */
export const UNPRICED_REASONS = Object.freeze({
  noMonthlySpendBasis: "no_monthly_spend_basis",
  noRoutingAnalysis: "no_routing_analysis",
  routingInsufficientData: "routing_insufficient_data",
  noRecoverableSpend: "no_recoverable_spend",
});

/** Why an intervention is not in the pack at all. */
export const EXCLUSION_REASONS = Object.freeze({
  signalDidNotFire: "signal_did_not_fire",
  departmentNotGraded: "department_not_graded",
});

/**
 * Coverage at or above this share is not penalised. 0.8 is the same shape of
 * judgement as the confidence penalties in the routing rule: a department whose
 * export left a fifth of its prompts unclassified has a real finding and a
 * thinner one, and saying so costs a tier rather than the whole figure.
 */
export const FIX_PACK_MIN_COVERAGE = 0.8;

const CONFIDENCE_LEVELS = Object.freeze(["High", "Medium", "Low"]);

/**
 * Every reason that lowers an intervention's confidence one tier, in the declared
 * order they are emitted in. Never map or set iteration order.
 */
const CONFIDENCE_PENALTIES = Object.freeze([
  Object.freeze({
    code: "unpriced_saving",
    detail: "No dollar figure could be derived for this action, so its rank rests on "
      + "recoverable prompt-points alone.",
  }),
  Object.freeze({
    code: "thin_classification_coverage",
    detail: "Under 80% of this department's imported prompts were classified, so the "
      + "share the saving is apportioned from rests on part of the file.",
  }),
  Object.freeze({
    code: "unmeasured_classifier_confidence",
    detail: "The department row reports no mean classifier confidence, so the strength "
      + "of the categories behind this action is unmeasured.",
  }),
  Object.freeze({
    code: "estimated_saving",
    detail: "The saving is apportioned from a spend basis rather than measured, so it "
      + "is a scenario and not an observed delta.",
  }),
]);

const PENALTY_BY_CODE = new Map(CONFIDENCE_PENALTIES.map((penalty) => [penalty.code, penalty]));

// --- redaction ---------------------------------------------------------------

/** Fields this module reads off a `aggregateConversationLiteracy` department row. */
const DEPARTMENT_FIELDS = Object.freeze([
  "department", "attribution", "gradeable", "score", "grade", "subscores",
  "reasonCode", "reasonText", "prompts", "coverage", "confidence", "signals",
  "driver", "impact", "distribution", "sketches", "rubricVersion",
]);

/**
 * Fields this module reads off an `evaluateUnitModelRouting` result.
 *
 * `unitId` is deliberately absent. The routing rule publishes both the raw org
 * unit id and its own redacted `unitLabel`; only the label crosses this boundary,
 * and the id is reported as dropped so the omission is visible rather than quiet.
 */
const ROUTING_FIELDS = Object.freeze([
  "ruleVersion", "unitLabel", "status", "reasonCode", "candidates",
  "excludedModels", "recoverableUsd", "modelledSpendUsd", "confidence",
]);

/** Fields read off one routing candidate row. Token/tier arithmetic only. */
const CANDIDATE_FIELDS = Object.freeze([
  "model", "tier", "proposedTier", "calls", "currentSpendUsd",
  "projectedSpendUsd", "recoverableUsd",
]);

const MODEL_ID = new RegExp(PROMPT_LITERACY_RUBRIC.redaction.modelIdPattern);

/**
 * A department label is published only if it looks like a department label: a
 * short noun phrase, no address characters, no markup. An export whose department
 * column holds an email, a pasted sentence or an HTML fragment gets the label
 * withheld, because a drill-down that echoes whatever was in the column is a leak
 * with extra steps.
 *
 * The two limits are stated rather than tuned: this surface cannot tell a very
 * long department name from a pasted sentence, so it withholds both. Real names
 * ("Atlas Platform", "R&D (EMEA)") sit far inside them.
 */
const DEPARTMENT_LABEL_PATTERN = /^[\p{L}\p{N} .,'&()/-]+$/u;
const MAX_LABEL_CHARS = 48;
const MAX_LABEL_WORDS = 6;

/** What a label becomes when it fails the rule above. */
export const WITHHELD_LABEL = "(department label withheld)";

export function safeDepartmentLabel(value) {
  const label = typeof value === "string" ? value.trim() : "";
  if (!label || label.length > MAX_LABEL_CHARS) return WITHHELD_LABEL;
  if (label.split(/\s+/).length > MAX_LABEL_WORDS) return WITHHELD_LABEL;
  return DEPARTMENT_LABEL_PATTERN.test(label) ? label : WITHHELD_LABEL;
}

/** Theo's model-identifier contract, reused rather than re-decided here. */
export function safeModelId(value) {
  return typeof value === "string" && MODEL_ID.test(value)
    ? value : PROMPT_LITERACY_RUBRIC.redaction.unrecognizedModelLabel;
}

/**
 * Copy the allow-listed fields off an input and report every field that was not
 * on the list. The dropped names are what makes the redaction observable: a
 * caller who attaches a prompt body, an email column or a token to a department
 * row sees it named as dropped instead of finding it downstream.
 */
function pick(source, fields, prefix, dropped) {
  const safe = {};
  if (!source || typeof source !== "object") return safe;
  for (const key of Object.keys(source)) {
    if (fields.includes(key)) safe[key] = source[key];
    else dropped.push(`${prefix}.${key}`);
  }
  return safe;
}

// --- money -------------------------------------------------------------------

/** USD are summed in integer minor units and divided once, at the end. */
const minor = (usd) => Math.round((Number.isFinite(usd) ? usd : 0) * 100);
const major = (minorUnits) => Math.round(minorUnits) / 100;

function positiveMonths(value) {
  const months = Number(value);
  return Number.isFinite(months) && months > 0 ? months : 1;
}

/** A whole-number percentage. One implementation, no locale surprises. */
function percentText(share) {
  const value = Number.isFinite(share) ? share : 0;
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

const countText = (value) =>
  (Number.isFinite(value) ? Math.round(value) : 0).toLocaleString("en-US");

const moneyText = (usd) => `${major(minor(usd)).toFixed(2)} USD`;

// --- savings -----------------------------------------------------------------

/**
 * The routing action's money, read verbatim off the routing rule.
 *
 * An `insufficient_data` routing result is unpriced with the routing rule's own
 * reason code, not scored zero: in a ranked list a zero reads as "clean" when it
 * means "we could not look".
 */
function routingSaving(routing) {
  if (!routing) return { minorUnits: null, code: UNPRICED_REASONS.noRoutingAnalysis };
  if (routing.status !== "scored") {
    return { minorUnits: null, code: UNPRICED_REASONS.routingInsufficientData };
  }
  const units = minor(routing.recoverableUsd);
  if (units <= 0) return { minorUnits: null, code: UNPRICED_REASONS.noRecoverableSpend };
  return { minorUnits: units, code: null };
}

/**
 * The rewrite and training actions' money: the share of the department's spend
 * that sits in this signal's category, discounted by the share of it the signal
 * table already says a programme can move.
 *
 *   spend × (numerator ÷ classified) × recoverability
 *
 * The two ratios are the department row's and the signal table's respectively;
 * neither is authored here. Without a spend basis there is no number at all,
 * because apportioning an unstated total is inventing one.
 */
function apportionedSaving(signalRow, rubricSignal, spendMinorUnits) {
  if (spendMinorUnits === null) {
    return { minorUnits: null, code: UNPRICED_REASONS.noMonthlySpendBasis };
  }
  const denominator = signalRow.denominator ?? 0;
  if (denominator <= 0) {
    return { minorUnits: null, code: UNPRICED_REASONS.noMonthlySpendBasis };
  }
  const units = Math.round(
    (spendMinorUnits * signalRow.numerator * rubricSignal.recoverability) / denominator,
  );
  if (units <= 0) return { minorUnits: null, code: UNPRICED_REASONS.noRecoverableSpend };
  return { minorUnits: units, code: null };
}

// --- confidence --------------------------------------------------------------

/**
 * Confidence is computed from completeness, never asserted. The routing action
 * starts from the routing rule's own tier so a lowered routing confidence cannot
 * be laundered back up to High here; everything else starts at High. Each reason
 * costs one tier, floored at Low, and the reasons travel with the level.
 */
function confidenceFor(baseLevel, codes, routingReasons) {
  const reasons = CONFIDENCE_PENALTIES
    .filter((penalty) => codes.has(penalty.code))
    .map((penalty) => Object.freeze({ ...penalty, effect: "lowered one tier" }));
  const base = Math.max(0, CONFIDENCE_LEVELS.indexOf(baseLevel));
  const index = Math.min(base + reasons.length, CONFIDENCE_LEVELS.length - 1);
  return Object.freeze({
    level: CONFIDENCE_LEVELS[index],
    reasons: Object.freeze(reasons),
    // The routing rule's own penalties, repeated rather than re-derived, so a
    // reader can see why the tier this started from was not High.
    inheritedReasons: Object.freeze((routingReasons ?? []).map((reason) =>
      Object.freeze({ code: String(reason?.code ?? "unspecified"), detail: reason?.detail ?? null }))),
  });
}

// --- rationale ---------------------------------------------------------------

function rationaleFor(intervention, signalRow, rubricSignal, saving, basis, months) {
  const observed = `${countText(signalRow.numerator)} of ${countText(signalRow.denominator)} `
    + `classified prompts (${percentText(signalRow.share)}) fired the ${rubricSignal.label} signal`;
  if (intervention.savingsBasis === "down_routing_delta") {
    return saving.minorUnits === null
      ? `${observed}; the routing rule published no priced delta for this department, `
        + "so the action is ranked on recoverable prompt-points alone."
      : `${observed}; the routing rule prices the move at ${moneyText(major(saving.minorUnits))} `
        + `over ${countText(months)} month${months === 1 ? "" : "s"}.`;
  }
  return saving.minorUnits === null
    ? `${observed}; no spend basis was supplied for this department, so no dollar `
      + "figure is claimed for it."
    : `${observed}; ${percentText(rubricSignal.recoverability)} of that shortfall is `
      + `recoverable by ${intervention.kind}, apportioned from ${moneyText(basis.spendUsd)} `
      + `of ${basis.source}.`;
}

// --- the pack ----------------------------------------------------------------

function shell(state, reason, redaction) {
  return Object.freeze({
    version: DEPARTMENT_FIX_PACK_VERSION,
    state,
    reasonCode: reason,
    department: null,
    interventions: Object.freeze([]),
    excluded: Object.freeze([]),
    totals: Object.freeze({
      monthlySavingsUsd: 0,
      pricedCount: 0,
      unpricedCount: 0,
      recoverablePromptPoints: 0,
      unpricedReasonCodes: Object.freeze([]),
      complete: false,
    }),
    basis: null,
    redaction,
  });
}

/**
 * Build one department's fix pack.
 *
 * @param {{department?: object|null, routing?: object|null,
 *   basis?: {spendUsd?: number|null, periodMonths?: number, source?: string}|null,
 *   provenance?: string}} input
 *   `department` is one row of `aggregateConversationLiteracy().departments`.
 *   `routing` is an `evaluateUnitModelRouting` result for the same department, or
 *   null when the import carried no per-model billing. `basis` is the department's
 *   own spend over the window the routing result covers; without it the two
 *   apportioned actions are published unpriced rather than guessed.
 * @returns the frozen fix pack.
 */
export function departmentFixPack({
  department = null,
  routing = null,
  basis = null,
  provenance = "bundled_sample",
} = {}) {
  const dropped = [];
  const safeDepartment = pick(department, DEPARTMENT_FIELDS, "department", dropped);
  const safeRouting = routing ? pick(routing, ROUTING_FIELDS, "routing", dropped) : null;
  const source = provenance === "own_import" ? "own_import" : "bundled_sample";
  const redaction = Object.freeze({
    statement: FIX_PACK_REDACTION_STATEMENT,
    policy: PROMPT_LITERACY_RUBRIC.redaction.modelIdPattern,
    droppedInputFields: Object.freeze([...new Set(dropped)].sort()),
  });

  if (!department || typeof department !== "object") {
    return shell(FIX_PACK_STATE.unavailable, "no_department_selected", redaction);
  }

  const months = positiveMonths(basis?.periodMonths);
  const spendMinorUnits = Number.isFinite(basis?.spendUsd) && basis.spendUsd > 0
    ? minor(basis.spendUsd) : null;
  const basisModel = Object.freeze({
    spendUsd: spendMinorUnits === null ? null : major(spendMinorUnits),
    periodMonths: months,
    source: typeof basis?.source === "string" && basis.source
      ? basis.source : "no spend basis supplied",
  });
  const label = safeDepartmentLabel(safeDepartment.department);

  if (safeDepartment.gradeable !== true) {
    const withheld = shell(FIX_PACK_STATE.withheld,
      safeDepartment.reasonCode ?? EXCLUSION_REASONS.departmentNotGraded, redaction);
    return Object.freeze({
      ...withheld,
      department: label,
      excluded: Object.freeze(FIX_PACK_INTERVENTIONS.map((intervention) => Object.freeze({
        actionId: intervention.actionId,
        kind: intervention.kind,
        name: intervention.name,
        reasonCode: EXCLUSION_REASONS.departmentNotGraded,
      }))),
      basis: basisModel,
    });
  }

  const signalRows = new Map((Array.isArray(safeDepartment.signals) ? safeDepartment.signals : [])
    .map((row) => [row.key, row]));
  const coverage = Number.isFinite(safeDepartment.coverage) ? safeDepartment.coverage : 0;
  const routingModels = safeRouting && Array.isArray(safeRouting.candidates)
    ? safeRouting.candidates.map((candidate) => {
      const safeCandidate = pick(candidate, CANDIDATE_FIELDS, "routing.candidate", dropped);
      return Object.freeze({
        model: safeModelId(safeCandidate.model),
        tier: safeCandidate.tier ?? null,
        proposedTier: safeCandidate.proposedTier ?? null,
        recoverableUsd: major(minor(safeCandidate.recoverableUsd)),
      });
    })
    : [];

  const interventions = [];
  const excluded = [];

  for (const intervention of FIX_PACK_INTERVENTIONS) {
    const rubricSignal = SIGNAL_BY_KEY.get(intervention.signal);
    const signalRow = signalRows.get(intervention.signal);
    if (!signalRow || !(signalRow.numerator > 0)) {
      excluded.push(Object.freeze({
        actionId: intervention.actionId,
        kind: intervention.kind,
        name: intervention.name,
        reasonCode: EXCLUSION_REASONS.signalDidNotFire,
      }));
      continue;
    }

    const saving = intervention.savingsBasis === "down_routing_delta"
      ? routingSaving(safeRouting)
      : apportionedSaving(signalRow, rubricSignal, spendMinorUnits);
    const monthlyMinor = saving.minorUnits === null
      ? null : Math.round(saving.minorUnits / months);

    const codes = new Set();
    if (saving.minorUnits === null) codes.add("unpriced_saving");
    if (coverage < FIX_PACK_MIN_COVERAGE) codes.add("thin_classification_coverage");
    if (safeDepartment.confidence === null || safeDepartment.confidence === undefined) {
      codes.add("unmeasured_classifier_confidence");
    }
    if (saving.minorUnits !== null && intervention.savingsBasis === "apportioned_recoverable_share") {
      codes.add("estimated_saving");
    }
    const baseLevel = intervention.savingsBasis === "down_routing_delta"
      ? safeRouting?.confidence?.level ?? CONFIDENCE_LEVELS[0] : CONFIDENCE_LEVELS[0];

    interventions.push({
      actionId: intervention.actionId,
      action: Object.freeze({
        id: intervention.actionId,
        kind: intervention.kind,
        name: intervention.name,
        summary: intervention.summary,
      }),
      signal: Object.freeze({
        key: rubricSignal.key,
        label: rubricSignal.label,
        axis: rubricSignal.axis,
        category: rubricSignal.category,
        numerator: signalRow.numerator,
        denominator: signalRow.denominator,
        share: signalRow.share,
        recoverability: rubricSignal.recoverability,
        recoverablePromptPoints: signalRow.impact,
      }),
      monthlySavingsUsd: monthlyMinor === null ? null : major(monthlyMinor),
      savings: Object.freeze({
        basis: intervention.savingsBasis,
        monthlySavingsUsd: monthlyMinor === null ? null : major(monthlyMinor),
        windowSavingsUsd: saving.minorUnits === null ? null : major(saving.minorUnits),
        periodMonths: months,
        unpricedReasonCode: saving.code,
        // Named models only on the routing action, and only through the model-id
        // pattern the rubric publishes.
        models: intervention.savingsBasis === "down_routing_delta"
          ? Object.freeze(routingModels) : Object.freeze([]),
      }),
      confidence: confidenceFor(baseLevel, codes, safeRouting?.confidence?.reasons),
      provenance: Object.freeze({
        fixPackVersion: DEPARTMENT_FIX_PACK_VERSION,
        rubricVersion: safeDepartment.rubricVersion ?? RUBRIC_VERSION_ID,
        classifierVersion: QUERY_CLASSIFIER_VERSION,
        routingRuleVersion: safeRouting?.ruleVersion ?? null,
        source,
        department: label,
        unitLabel: safeRouting?.unitLabel ?? null,
        evidence: Object.freeze([
          `signal:${rubricSignal.key}`,
          `category:${rubricSignal.category}`,
          intervention.savingsBasis === "down_routing_delta"
            ? `routing:${safeRouting?.ruleVersion ?? "absent"}`
            : `basis:${basisModel.source}`,
        ]),
      }),
      rationale: rationaleFor(intervention, signalRow, rubricSignal, saving, basisModel, months),
      _sortMinor: monthlyMinor,
    });
  }

  // THE RANKING. A named dollar figure outranks an unpriced action, because an
  // unpriced action is not a smaller number — it is no number, and sorting it
  // against real money at zero would bury it under every priced trickle. Within
  // each tier: savings descending, then recoverable prompt-points descending,
  // then confidence tier, then actionId. Total order, no ties.
  interventions.sort((left, right) => {
    const leftPriced = left._sortMinor !== null;
    const rightPriced = right._sortMinor !== null;
    if (leftPriced !== rightPriced) return leftPriced ? -1 : 1;
    if (leftPriced && left._sortMinor !== right._sortMinor) {
      return right._sortMinor - left._sortMinor;
    }
    return right.signal.recoverablePromptPoints - left.signal.recoverablePromptPoints
      || CONFIDENCE_LEVELS.indexOf(left.confidence.level)
        - CONFIDENCE_LEVELS.indexOf(right.confidence.level)
      || left.actionId.localeCompare(right.actionId);
  });

  const ranked = Object.freeze(interventions.map((intervention, index) => {
    const { _sortMinor, ...rest } = intervention;
    return Object.freeze({ ...rest, rank: index + 1 });
  }));

  const pricedMinor = interventions.reduce(
    (sum, intervention) => sum + (intervention._sortMinor ?? 0), 0,
  );
  const unpriced = ranked.filter((intervention) => intervention.monthlySavingsUsd === null);

  return Object.freeze({
    version: DEPARTMENT_FIX_PACK_VERSION,
    state: ranked.length ? FIX_PACK_STATE.ready : FIX_PACK_STATE.empty,
    reasonCode: ranked.length ? null : EXCLUSION_REASONS.signalDidNotFire,
    department: label,
    interventions: ranked,
    excluded: Object.freeze(excluded),
    totals: Object.freeze({
      // Summed in minor units over the priced actions only. An unpriced action is
      // never folded in as a zero; it is counted separately and `complete` says so.
      monthlySavingsUsd: major(pricedMinor),
      pricedCount: ranked.length - unpriced.length,
      unpricedCount: unpriced.length,
      recoverablePromptPoints: Math.round(ranked.reduce(
        (sum, intervention) => sum + (intervention.signal.recoverablePromptPoints ?? 0), 0,
      ) * 100) / 100,
      unpricedReasonCodes: Object.freeze([...new Set(
        unpriced.map((intervention) => intervention.savings.unpricedReasonCode),
      )].sort()),
      complete: unpriced.length === 0,
    }),
    basis: basisModel,
    redaction: Object.freeze({
      ...redaction,
      droppedInputFields: Object.freeze([...new Set(dropped)].sort()),
    }),
  });
}

/**
 * The pack as one ordered sentence list, for a screen reader and for a test that
 * wants to assert the order as a string rather than by walking the model.
 */
export function fixPackAnnouncement(pack) {
  if (!pack || pack.state !== FIX_PACK_STATE.ready) return "";
  return [
    `${pack.department}: ${countText(pack.interventions.length)} prioritized `
    + `intervention${pack.interventions.length === 1 ? "" : "s"}, `
    + `${moneyText(pack.totals.monthlySavingsUsd)} a month`
    + (pack.totals.complete ? "." : `, ${countText(pack.totals.unpricedCount)} unpriced.`),
    ...pack.interventions.map((intervention) =>
      `${intervention.rank}. ${intervention.action.name} (${intervention.action.kind}) — `
      + `${intervention.monthlySavingsUsd === null
        ? "no dollar figure" : `${moneyText(intervention.monthlySavingsUsd)} a month`}, `
      + `confidence ${intervention.confidence.level}.`),
  ].join(" ");
}

/** The penalty detail behind a code, for a view that renders one. */
export function confidencePenaltyDetail(code) {
  return PENALTY_BY_CODE.get(code)?.detail ?? null;
}
