// Did the commitment we made actually land?
//
// WHAT THIS IS FOR
// ----------------
// `savings-commitment.js` proposes exactly one commitment out of one imported
// month, and says plainly that reconciling it against a measured month is
// downstream of the contract and not implemented there. This module is that
// downstream step, and only that step: it pairs a commitment built from month N
// against the visitor's own import of month N+1 and reports what was realized,
// how far that is from what was projected, and the verdict those two numbers
// support — or says, in a sentence, why no verdict is available.
//
// It consumes `commitment` exactly as `validateSavingsCommitment` produced it,
// carries `commitment.provenance` unchanged, and never recomputes the baseline:
// the baseline is whatever the imported analysis said it was. Those are the three
// conditions the contract states for any downstream implementation.
//
// WHAT IT READS
// -------------
// Two things: one already-validated commitment, and one later analysis envelope
// from the visitor's own import. No provider, no rate card, no credential, no
// HRIS, no storage, no clock, no randomness, and no server. Two calls on the same
// pair return equal objects, in this process and the next one.
//
// AMBIGUITY IS AN ANSWER, NOT A TIE-BREAK
// ---------------------------------------
// The observation is located by canonicalizing the later import's own org-unit
// and model identifiers and matching them against the identifiers the commitment
// carries. Two distinct raw identifiers can reduce to one canonical id — "Atlas
// One" and "atlas.one" both become `atlas-one`. When that happens there is no
// principled way to say which row the commitment meant, so no row is chosen.
// Picking the first match would make the realized figure depend on the order the
// exporter happened to write its rows in, which is the one property a number
// shown to a director must not have. The collision is counted, reported as
// `ambiguous_observation`, and produces the same unavailable result under any
// input order.
//
// UNAVAILABLE IS A STATE, NOT A ZERO
// ----------------------------------
// A department that stopped reporting, a window that is not the month after the
// baseline, a route the later import never mentions: each is a reason with an
// authored sentence, and none of them is a variance of zero. Zero means "landed
// exactly on plan", and that is the single most expensive thing this module could
// say by accident.

import { calendarMonth, canonical } from "./finops-briefing-commitment.js";
import { SAVINGS_COMMITMENT_VERSION } from "./savings-commitment.js";

export const COMMITMENT_VERIFICATION_VERSION = "savings-commitment-verification/1.0.0";

/** The one question, carried in the payload so a surface cannot retitle it. */
export const COMMITMENT_VERIFICATION_QUESTION = "Did the commitment we made actually land?";

/** Exactly one is reported. There is no third shape. */
export const VERIFICATION_STATUS = Object.freeze({
  ok: "ok",
  unavailable: "unavailable",
});

/**
 * The verdict ladder. Three rungs, with boundaries stated as data rather than as
 * a comment, because the first thing a director disputes is which side of a line
 * their month fell on.
 */
export const VERIFICATION_VERDICT = Object.freeze({
  achieved: "achieved",
  underRealized: "under_realized",
  notRealized: "not_realized",
});

export const VERIFICATION_VERDICT_RULE = Object.freeze({
  [VERIFICATION_VERDICT.achieved]:
    "varianceMinor >= 0: the committed route's cost fell by at least the projected monthly saving.",
  [VERIFICATION_VERDICT.underRealized]:
    "realizedMonthlySavingsMinor > 0 and varianceMinor < 0: the cost fell, but by less than projected.",
  [VERIFICATION_VERDICT.notRealized]:
    "realizedMonthlySavingsMinor <= 0: the committed route cost the same or more than its baseline.",
});

export const VERIFICATION_VERDICT_STATEMENT = Object.freeze({
  [VERIFICATION_VERDICT.achieved]:
    "Achieved: the observed month met or beat the projected monthly saving on the committed route.",
  [VERIFICATION_VERDICT.underRealized]:
    "Under-realized: the committed route did get cheaper, but by less than the commitment projected.",
  [VERIFICATION_VERDICT.notRealized]:
    "Not realized: the committed route cost at least as much in the observed month as in its own baseline month.",
});

/** Why no verdict is available. Each names what is missing and what would supply it. */
export const VERIFICATION_UNAVAILABLE_REASON = Object.freeze({
  noCommitment: "no_commitment",
  commitmentNotVerifiable: "commitment_not_verifiable",
  attributionWithheld: "attribution_withheld",
  noObservation: "no_observation",
  observationPeriodUnreadable: "observation_period_unreadable",
  observationPeriodNotPaired: "observation_period_not_paired",
  departmentNotObserved: "department_not_observed",
  routeNotObserved: "route_not_observed",
  ambiguousObservation: "ambiguous_observation",
});

export const VERIFICATION_UNAVAILABLE_STATEMENT = Object.freeze({
  [VERIFICATION_UNAVAILABLE_REASON.noCommitment]:
    "Nothing has been committed to yet, so there is nothing to check a later month against. Propose a "
    + "commitment from an imported analysis first.",
  [VERIFICATION_UNAVAILABLE_REASON.commitmentNotVerifiable]:
    "This commitment does not carry the baseline, route, and projected saving the check compares against, "
    + "so no verdict is computed from it rather than one computed from guesses.",
  [VERIFICATION_UNAVAILABLE_REASON.attributionWithheld]:
    "Too little of the observed month's spend is attributed to state a figure, so no realized saving is "
    + "reported from it. A verdict here would be a number the attribution policy already withheld.",
  [VERIFICATION_UNAVAILABLE_REASON.noObservation]:
    "No later month has been imported, so the commitment has nothing to be measured against yet. Import "
    + "the month after the baseline to check it.",
  [VERIFICATION_UNAVAILABLE_REASON.observationPeriodUnreadable]:
    "The later import observes a window that is not one calendar month, and a monthly commitment can only "
    + "be checked against a monthly observation. Import a single calendar month.",
  [VERIFICATION_UNAVAILABLE_REASON.observationPeriodNotPaired]:
    "The later import is not the month directly after this commitment's baseline, so the difference "
    + "between them is not this commitment's result. Import the month that follows the baseline.",
  [VERIFICATION_UNAVAILABLE_REASON.departmentNotObserved]:
    "The later import contains no org unit matching the one this commitment names, so the committed "
    + "workload was not observed at all. No realized figure is stated for it.",
  [VERIFICATION_UNAVAILABLE_REASON.routeNotObserved]:
    "The observed org unit reports no usage for the model this commitment moves traffic away from. That "
    + "is not the same as it costing nothing, so no realized saving is claimed from its absence.",
  [VERIFICATION_UNAVAILABLE_REASON.ambiguousObservation]:
    "More than one of the later import's org units or models reduces to the identifier this commitment "
    + "names, so a realized figure taken from either could be the wrong one. None is stated.",
});

/**
 * Every rule this module applies, with the assumption behind it written next to
 * it. Exported as data so a test can assert the list is complete, a reviewer can
 * check each rule against the code in one pass, and a surface can print the
 * assumption beside the number it produced.
 *
 * The rule that matters most is `realizedCost`. Read it before quoting any
 * figure this module returns.
 */
export const VERIFICATION_METRIC_RULES = Object.freeze({
  pairing: Object.freeze({
    rule: "The observed period must be the calendar month directly after commitment.baseline.period.",
    assumption:
      "A monthly commitment is checked against the first full month after the month it was priced in. "
      + "Assuming any later month would fold in every other change made in between and attribute them "
      + "all to this one routing decision.",
  }),
  observationScope: Object.freeze({
    rule: "The observation is the later import's row for the committed department and the committed "
      + "current-route model, taken from that unit's scored candidates and its excluded models alike.",
    assumption:
      "Traffic that fell below the routing rule's own volume floor is still observed spend. Reading only "
      + "the scored candidates would make a workload disappear at exactly the moment it succeeded in "
      + "getting smaller.",
  }),
  identifierMatching: Object.freeze({
    rule: "Department and model are matched on canonicalized identifiers. More than one match on either "
      + "is reported as ambiguous_observation and no row is selected.",
    assumption:
      "Two raw identifiers that reduce to one canonical id are assumed to be genuinely ambiguous rather "
      + "than duplicates of one unit. Selecting either would make the realized figure depend on row "
      + "order in the exporter's file.",
  }),
  realizedCost: Object.freeze({
    rule: "realizedMonthlyCostMinor is the observed month's spend on the committed CURRENT route only. "
      + "The proposed route's cost is not netted in.",
    assumption:
      "The commitment names a cheaper TIER, not a target model, so no import can identify what the "
      + "traffic moved to. This figure therefore measures how much of the committed route's cost went "
      + "away, and is an UPPER BOUND on net savings: spend that reappeared on a replacement model is "
      + "not subtracted here.",
  }),
  realizedSavings: Object.freeze({
    rule: "realizedMonthlySavingsMinor = baseline.monthlyCostMinor - realizedMonthlyCostMinor. Signed, "
      + "never clamped at zero.",
    assumption:
      "A route that got more expensive is a result worth reporting. Clamping at zero, as the projection "
      + "side does for eligibility, would render a regression as “saved nothing” and hide it.",
  }),
  variance: Object.freeze({
    rule: "varianceMinor = realizedMonthlySavingsMinor - projectedMonthlySavingsMinor, where the "
      + "projected figure is carried verbatim from the commitment and never recomputed.",
    assumption:
      "The commitment's own projected saving is the plan of record. Re-deriving it from the later import "
      + "would let a moved goalpost pass as a met one.",
  }),
  attainment: Object.freeze({
    rule: "attainmentPercent = round(realizedMonthlySavingsMinor * 100 / projectedMonthlySavingsMinor), "
      + "reported only because the contract guarantees a strictly positive projected saving.",
    assumption:
      "A ratio is a convenience for reading, never an input: every verdict is decided on the minor-unit "
      + "figures above, so rounding here can never move a verdict across a boundary.",
  }),
  tolerance: Object.freeze({
    rule: "No tolerance band is applied. The boundary between achieved and under_realized is exactly "
      + "varianceMinor = 0.",
    assumption:
      "Both sides are exact integers in USD minor units taken from imports, so there is no measurement "
      + "noise for a band to absorb. Any band would be an unstated policy about how much of a miss is "
      + "acceptable, and that is a decision for the person reading the number, not for this module.",
  }),
});

/* -------------------------------- primitives ------------------------------- */

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

const usd = (minor) => Math.round(minor) / 100;

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

/** Dollars to integer minor units, or null when the value is not readable money. */
function minorUnits(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const minor = Math.round(number * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** "2026-06" to "2026-07". The pairing rule's only arithmetic. */
export function nextCalendarMonth(month) {
  if (typeof month !== "string" || !PERIOD.test(month)) return null;
  const [year, index] = month.split("-").map(Number);
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, "0")}`;
}

function unavailable(reason, detail = null) {
  return deepFreeze({
    schemaVersion: COMMITMENT_VERIFICATION_VERSION,
    contractVersion: SAVINGS_COMMITMENT_VERSION,
    question: COMMITMENT_VERIFICATION_QUESTION,
    status: VERIFICATION_STATUS.unavailable,
    verdict: null,
    verdictStatement: null,
    reason,
    statement: VERIFICATION_UNAVAILABLE_STATEMENT[reason],
    detail,
    commitmentId: null,
    departmentId: null,
    baselinePeriod: null,
    observedPeriod: null,
    projected: null,
    realized: null,
    variance: null,
    evidence: [],
    assumptions: VERIFICATION_METRIC_RULES,
  });
}

/* ------------------------------ reading the inputs ------------------------- */

/**
 * The commitment to check, out of whatever the caller had to hand: a built
 * preview, a briefing block, or the bare commitment object. All three carry the
 * same validated object, and refusing two of the three would only push the same
 * unwrapping into every caller.
 */
function readCommitment(input) {
  if (!input || typeof input !== "object") return null;
  if (input.commitment && typeof input.commitment === "object") return input.commitment;
  return "commitmentId" in input ? input : null;
}

/**
 * The fields the comparison needs, or null. This is a re-check of a payload the
 * contract's own validator already accepted, not a second opinion about it: a
 * commitment that reaches here malformed came from a file somebody edited, and
 * every figure below would otherwise be computed from it.
 */
function verifiableCommitment(commitment) {
  const departmentId = canonical(commitment?.department?.departmentId);
  const modelId = canonical(commitment?.routing?.currentRoute?.modelId);
  const baselinePeriod = commitment?.baseline?.period;
  const baselineMinor = commitment?.baseline?.monthlyCostMinor;
  const projectedCostMinor = commitment?.projected?.monthlyCostMinor;
  const projectedSavingsMinor = commitment?.projectedMonthlySavings?.amountMinor;
  const commitmentId = canonical(commitment?.commitmentId);
  if (!departmentId || !modelId || !commitmentId) return null;
  if (departmentId !== commitment.department.departmentId) return null;
  if (typeof baselinePeriod !== "string" || !PERIOD.test(baselinePeriod)) return null;
  for (const amount of [baselineMinor, projectedCostMinor, projectedSavingsMinor]) {
    if (!Number.isSafeInteger(amount) || amount < 0) return null;
  }
  // The contract's eligibility floor. A commitment worth zero cannot produce an
  // attainment ratio, and was never supposed to exist.
  if (projectedSavingsMinor <= 0) return null;
  return {
    commitmentId,
    departmentId,
    modelId,
    baselinePeriod,
    baselineMinor,
    projectedCostMinor,
    projectedSavingsMinor,
    recordIds: Array.isArray(commitment?.provenance?.recordIds)
      ? commitment.provenance.recordIds.filter((id) => typeof id === "string") : [],
  };
}

/**
 * Every org unit the later import published, scored or not.
 *
 * `insufficientData` units are included deliberately. A unit lands there when the
 * rule cannot defend a *recommendation* for it, which says nothing about whether
 * its spend was observed — and a unit that drops off the scored list in month N+1
 * is exactly the shape a successful migration has. Excluding them would also make
 * the ambiguity check blind to half the import.
 */
function observedUnits(analysis) {
  const routing = analysis?.modelRouting;
  const ranked = Array.isArray(routing?.ranked) ? routing.ranked : [];
  const insufficient = Array.isArray(routing?.insufficientData) ? routing.insufficientData : [];
  return [...ranked, ...insufficient];
}

/** Every per-model row a unit published, scored or excluded. */
function observedRows(unit) {
  const scored = Array.isArray(unit?.candidates) ? unit.candidates : [];
  const excluded = Array.isArray(unit?.excludedModels) ? unit.excludedModels : [];
  return [...scored, ...excluded];
}

/**
 * The one row matching `wantedId`, or a counted collision.
 *
 * Deliberately not `.find()`. The whole list is scanned, every match is counted,
 * and two matches produce `{ ambiguous: true }` rather than the first one. The
 * count is the only thing reported about a collision, so the result cannot depend
 * on which colliding row was written first.
 *
 * @returns `{ matches: number, distinctRaw: number, row: object|null, ambiguous: boolean }`
 */
function matchOne(items, rawIdOf, wantedId) {
  const matched = items.filter((item) => canonical(rawIdOf(item)) === wantedId);
  const distinctRaw = new Set(matched.map((item) => String(rawIdOf(item)))).size;
  return {
    matches: matched.length,
    distinctRaw,
    row: matched.length === 1 ? matched[0] : null,
    ambiguous: matched.length > 1,
  };
}

/* -------------------------------- the check -------------------------------- */

/**
 * A stable id for the observation row a realized figure was read from.
 *
 * Period-qualified, unlike the baseline record ids the commitment carries: the
 * same unit and model in two months are two different observations, and a
 * citation that cannot tell them apart is not a citation.
 */
function observationRecordId(period, departmentId, modelId) {
  return `observation-${period}-${departmentId}-${modelId}`;
}

/**
 * Check one commitment against one later import.
 *
 * Pure and total: no DOM, no fetch, no storage, no clock, no randomness, and it
 * never throws. Every refusal is a reason with a sentence.
 *
 * @param commitmentInput a built preview, a briefing commitment block, or a bare
 *   commitment as `validateSavingsCommitment` accepted it.
 * @param observation the visitor's analysis envelope for a later month, from
 *   `normalizeLocalFinops` — or null when no later month has been imported.
 * @param options.attributionWithheld true when the attribution policy already
 *   suppressed the observed month's money figure on screen.
 */
export function verifyCommitment(commitmentInput, observation, { attributionWithheld = false } = {}) {
  const commitment = readCommitment(commitmentInput);
  if (!commitment) return unavailable(VERIFICATION_UNAVAILABLE_REASON.noCommitment);
  const plan = verifiableCommitment(commitment);
  if (!plan) return unavailable(VERIFICATION_UNAVAILABLE_REASON.commitmentNotVerifiable);

  const identity = {
    commitmentId: plan.commitmentId,
    departmentId: plan.departmentId,
    baselinePeriod: plan.baselinePeriod,
  };
  if (attributionWithheld) {
    return unavailable(VERIFICATION_UNAVAILABLE_REASON.attributionWithheld, identity);
  }
  if (!observation || typeof observation !== "object") {
    return unavailable(VERIFICATION_UNAVAILABLE_REASON.noObservation, identity);
  }

  const observedPeriod = calendarMonth(observation.period);
  if (!observedPeriod) {
    return unavailable(VERIFICATION_UNAVAILABLE_REASON.observationPeriodUnreadable, identity);
  }
  const expectedPeriod = nextCalendarMonth(plan.baselinePeriod);
  if (observedPeriod !== expectedPeriod) {
    return unavailable(VERIFICATION_UNAVAILABLE_REASON.observationPeriodNotPaired,
      { ...identity, observedPeriod, expectedPeriod });
  }

  const units = matchOne(observedUnits(observation), (unit) => unit?.unitId, plan.departmentId);
  if (units.ambiguous) {
    return unavailable(VERIFICATION_UNAVAILABLE_REASON.ambiguousObservation, {
      ...identity,
      observedPeriod,
      scope: "department",
      identifier: plan.departmentId,
      matchCount: units.matches,
      distinctRawIdentifierCount: units.distinctRaw,
    });
  }
  if (!units.row) {
    return unavailable(VERIFICATION_UNAVAILABLE_REASON.departmentNotObserved,
      { ...identity, observedPeriod });
  }

  const rows = matchOne(observedRows(units.row), (row) => row?.model, plan.modelId);
  if (rows.ambiguous) {
    return unavailable(VERIFICATION_UNAVAILABLE_REASON.ambiguousObservation, {
      ...identity,
      observedPeriod,
      scope: "model",
      identifier: plan.modelId,
      matchCount: rows.matches,
      distinctRawIdentifierCount: rows.distinctRaw,
    });
  }
  if (!rows.row) {
    return unavailable(VERIFICATION_UNAVAILABLE_REASON.routeNotObserved,
      { ...identity, observedPeriod });
  }

  const realizedCostMinor = minorUnits(rows.row.currentSpendUsd);
  if (realizedCostMinor === null) {
    return unavailable(VERIFICATION_UNAVAILABLE_REASON.routeNotObserved,
      { ...identity, observedPeriod });
  }

  const realizedSavingsMinor = plan.baselineMinor - realizedCostMinor;
  const varianceMinor = realizedSavingsMinor - plan.projectedSavingsMinor;
  const verdict = varianceMinor >= 0
    ? VERIFICATION_VERDICT.achieved
    : realizedSavingsMinor > 0
      ? VERIFICATION_VERDICT.underRealized
      : VERIFICATION_VERDICT.notRealized;
  const recordId = observationRecordId(observedPeriod, plan.departmentId, plan.modelId);

  return deepFreeze({
    schemaVersion: COMMITMENT_VERIFICATION_VERSION,
    contractVersion: SAVINGS_COMMITMENT_VERSION,
    question: COMMITMENT_VERIFICATION_QUESTION,
    status: VERIFICATION_STATUS.ok,
    verdict,
    verdictStatement: VERIFICATION_VERDICT_STATEMENT[verdict],
    reason: null,
    statement: null,
    detail: null,
    commitmentId: plan.commitmentId,
    departmentId: plan.departmentId,
    baselinePeriod: plan.baselinePeriod,
    observedPeriod,
    projected: {
      monthlyCostMinor: plan.projectedCostMinor,
      monthlyCostUsd: usd(plan.projectedCostMinor),
      monthlySavingsMinor: plan.projectedSavingsMinor,
      monthlySavingsUsd: usd(plan.projectedSavingsMinor),
      baselineMonthlyCostMinor: plan.baselineMinor,
      baselineMonthlyCostUsd: usd(plan.baselineMinor),
      currency: "USD",
      unit: "usd_minor",
    },
    realized: {
      monthlyCostMinor: realizedCostMinor,
      monthlyCostUsd: usd(realizedCostMinor),
      monthlySavingsMinor: realizedSavingsMinor,
      monthlySavingsUsd: usd(realizedSavingsMinor),
      routeModelId: plan.modelId,
      currency: "USD",
      unit: "usd_minor",
      formula: `${plan.baselineMinor} - ${realizedCostMinor} = ${realizedSavingsMinor} minor units, `
        + `for ${plan.modelId} in ${plan.departmentId}, ${plan.baselinePeriod} baseline against `
        + `${observedPeriod} observed.`,
    },
    variance: {
      amountMinor: varianceMinor,
      amountUsd: usd(varianceMinor),
      attainmentPercent: Math.round((realizedSavingsMinor * 100) / plan.projectedSavingsMinor),
      currency: "USD",
      unit: "usd_minor",
      formula: `${realizedSavingsMinor} - ${plan.projectedSavingsMinor} = ${varianceMinor} minor units.`,
      verdictRule: VERIFICATION_VERDICT_RULE[verdict],
    },
    // Both sides of the comparison are cited: the imported records the commitment
    // was priced from, and the observation row the realized figure was read from.
    // Statements carry canonical ids and integers only — never a raw label or a
    // raw model string out of the visitor's file.
    evidence: [
      {
        recordId,
        side: "observed",
        statement: `Observed spend on ${plan.modelId} in ${plan.departmentId} for ${observedPeriod}: `
          + `${usd(realizedCostMinor).toFixed(2)} USD.`,
      },
      ...plan.recordIds.map((baselineRecordId) => ({
        recordId: baselineRecordId,
        side: "baseline",
        statement: `Baseline record carried by the commitment for ${plan.baselinePeriod}, at `
          + `${usd(plan.baselineMinor).toFixed(2)} USD monthly cost.`,
      })),
    ],
    assumptions: VERIFICATION_METRIC_RULES,
  });
}

/* ------------------------------ what a surface says ------------------------ */

/**
 * The verification as the three lines a view paints, in the order it paints them.
 *
 * Every state produces all three keys, so an unavailable result renders through
 * the same path as a verdict rather than as an empty box, and `caveat` is never
 * dropped: the figure this module produces is an upper bound, and a headline
 * without that sentence beside it is the number a director is right to dispute.
 */
export function verificationLines(result) {
  const question = result?.question ?? COMMITMENT_VERIFICATION_QUESTION;
  if (!result || result.status !== VERIFICATION_STATUS.ok) {
    return Object.freeze({
      question,
      headline: result?.statement ?? VERIFICATION_UNAVAILABLE_STATEMENT.no_commitment,
      detail: null,
      caveat: null,
    });
  }
  const realized = result.realized.monthlySavingsUsd.toFixed(2);
  const projected = result.projected.monthlySavingsUsd.toFixed(2);
  const variance = result.variance.amountUsd.toFixed(2);
  return Object.freeze({
    question,
    headline: result.verdictStatement,
    detail: `${result.departmentId} · ${realized} USD realized against ${projected} USD projected · `
      + `${variance} USD variance (${result.variance.attainmentPercent}% of plan) · `
      + `${result.baselinePeriod} baseline against ${result.observedPeriod} observed.`,
    caveat: VERIFICATION_METRIC_RULES.realizedCost.assumption,
  });
}
