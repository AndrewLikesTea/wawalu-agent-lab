/**
 * The scoring layer over the spend-per-delivery derivation: one classified,
 * prioritized, caveated finding per reading.
 *
 * WHY THIS EXISTS SEPARATELY FROM `spend-per-delivery.js`
 *
 * That module derives a figure and says whether the figure may be published.
 * It stops short of the judgement a leader actually acts on — *is this move big
 * enough to be worth reading as a change, or is it inside the range this ratio
 * moves in on its own?* That judgement needs thresholds, and a threshold is a
 * policy a director will dispute. So it lives here, in one place, with the
 * assumption behind each number stated beside it and echoed onto every finding
 * the module emits. A reader who disagrees with a threshold can see which number
 * to argue with without reading this file.
 *
 * THE NAME. The issue that commissioned this work calls the subject "delivery
 * efficiency". The finding never uses that word, and neither does its view: the
 * source contract's `FRAMING.forbiddenClaims` rules out presenting this ratio as
 * efficiency, productivity, or return, and a finding that adopted the routing
 * name would have re-introduced the claim the derivation refuses. The word
 * survives in this file's name so the issue can be traced to the code; every
 * string a reader or a judge sees says "recorded AI spend per completed release".
 *
 * WHAT IT REFUSES TO SAY
 *
 *   * No causal verb. A ratio that rose is a fact about two recorded counts; it
 *     is never reported as spend having produced, driven, or failed to produce
 *     delivery. `assertObservational` is the executable form of that rule.
 *   * No unqualified direction from a sample that cannot support one. Four of
 *     the five classifications publish `direction: null`, and the two material
 *     ones are reachable only past both thresholds below.
 *   * No unredacted source text. Provider exports and the release log are typed
 *     by people and arrive from files; every string this module carries out of
 *     the decision goes through the repository's one sanitizer first, and the
 *     fields it will not carry at all are named in `redaction.excludedFields`.
 *
 * LOCALITY. Pure. No fetch, storage, clock, randomness, or credential path, and
 * no `generatedAt` stamp: equivalent inputs must serialize identically, which a
 * timestamp would break.
 */

import { sanitizeFinopsRecommendation } from "./finops-evaluation.js";
import {
  CONFIDENCE_LEVELS, CONFOUNDERS, FRAMING, MINIMUM_DELIVERIES, MINIMUM_PERIOD_DAYS,
  SPEND_PER_DELIVERY_STATE, SPEND_PER_DELIVERY_UNIT,
} from "./spend-per-delivery.js";

export const DELIVERY_FINDING_SCHEMA_VERSION = "delivery-efficiency-finding/1.0.0";

/**
 * The five outcomes, in the order the ladder checks them. Two of them publish a
 * direction; three cannot, and say so.
 */
export const DELIVERY_FINDING_CLASSIFICATIONS = Object.freeze([
  "invalid_period_alignment",
  "insufficient_evidence",
  "stable_ratio",
  "material_ratio_increase",
  "material_ratio_decrease",
]);

/** The classifications that may carry a direction. Nothing else may. */
export const DIRECTIONAL_CLASSIFICATIONS = Object.freeze([
  "material_ratio_increase", "material_ratio_decrease",
]);

/**
 * Every number this module decides with, and the assumption that puts it there.
 *
 * Both are judgement calls. Neither is a measurement, and saying so is the point:
 * a director who wants this finding to fire more often is arguing about
 * `materialChangePercent`, and one who thinks it fires on hand-written release
 * logs is arguing about `singleReleaseSensitivity`. The finding carries this
 * object so that argument can happen from the screen.
 */
export const DELIVERY_FINDING_THRESHOLDS = Object.freeze({
  materialChangePercent: Object.freeze({
    value: 15,
    unit: "percent of the reader's own trailing baseline",
    assumption:
      "A move smaller than 15% of the reader's own trailing baseline is inside the range"
      + " ordinary provider price and model-mix drift moves this ratio through with no change"
      + " in recorded delivery. 15 is a round number chosen for that reason and not measured"
      + " from this dataset; lowering it makes this finding report drift as a change.",
    disputeBy: "Change materialChangePercent. Nothing else in this module reads a percentage floor.",
  }),
  singleReleaseSensitivity: Object.freeze({
    value: "100 / (deliveries + 1) percent",
    unit: "percent of the headline ratio",
    assumption:
      `The release log is written by hand, so one release nobody recorded is the cheapest`
      + ` explanation for a move. One more release in the headline period would move the`
      + ` ratio by 100 / (deliveries + 1) percent, so a move no larger than that is not`
      + ` reported as material at any size. At the ${MINIMUM_DELIVERIES}-release floor that`
      + ` is ${round(100 / (MINIMUM_DELIVERIES + 1), 1)}%, which is why a short period buys`
      + ` a wide indeterminate band and a long one buys a narrow band.`,
    disputeBy:
      "Argue that unrecorded releases are rare in the log being read, or raise"
      + " MINIMUM_DELIVERIES in spend-per-delivery.js so the band narrows.",
  }),
});

/**
 * Priority, derived from the classification alone.
 *
 * `rank` places this finding in a queue that may hold others, so it is a total
 * order over the five outcomes and nothing else: the same classification always
 * produces the same rank, and no figure, dollar amount, or confidence level moves
 * it. The ordering assumption is that what blocks a decision outranks what
 * informs one — an unalignable window is the only outcome where the next reading
 * is guaranteed wrong too, so it sits above a material move that a reader could
 * at least act on today.
 */
export const DELIVERY_FINDING_PRIORITY = Object.freeze({
  invalid_period_alignment: Object.freeze({
    rank: 1, band: "resolve_period_alignment",
    assumption: "The windows cannot be aligned, so every later reading of this pair is wrong"
      + " in the same way until the exports are fixed. Nothing here is worth ranking below it.",
  }),
  material_ratio_increase: Object.freeze({
    rank: 2, band: "review_recorded_change",
    assumption: "A move past both thresholds is the one outcome that asks a reader to look at"
      + " something today, so it outranks the outcomes that ask them to wait or to collect.",
  }),
  material_ratio_decrease: Object.freeze({
    rank: 2, band: "review_recorded_change",
    assumption: "A fall is ranked identically to a rise. Neither direction is labelled good or"
      + " bad, so ranking one above the other would smuggle in that label.",
  }),
  insufficient_evidence: Object.freeze({
    rank: 3, band: "collect_evidence",
    assumption: "Collecting records is real work with a known next step, so it outranks a"
      + " reading that is already complete and unremarkable.",
  }),
  stable_ratio: Object.freeze({
    rank: 4, band: "monitor",
    assumption: "A reading that clears every floor and reports no material move is the one"
      + " outcome with nothing to do, so it is ranked last rather than omitted.",
  }),
});

/**
 * The caveats a classification may not be published without. The universal
 * three ride on every finding; the rest are keyed to the outcome that needs them.
 * `requiredCaveats` is asserted non-empty for every reachable outcome.
 */
const UNIVERSAL_CAVEATS = Object.freeze([
  FRAMING.statement,
  "Both sides of this ratio are counts of things that were recorded, not of work that was"
  + " done: dollars a provider export billed, and releases a person wrote down.",
  "Nothing here is compared against a peer, industry, or cohort baseline. The only"
  + " comparison is against this reader's own earlier periods.",
]);

const CLASSIFICATION_CAVEATS = Object.freeze({
  invalid_period_alignment: Object.freeze([
    "No ratio, direction, or comparison is published from this reading: the spend window and"
    + " the delivery records do not describe the same period, so a figure would be arithmetic"
    + " without a subject.",
  ]),
  insufficient_evidence: Object.freeze([
    "No direction is published. The sample does not support calling this reading a rise, a"
    + " fall, or a flat period, and reporting one anyway would put a conclusion in front of a"
    + " reader that the records cannot carry.",
  ]),
  stable_ratio: Object.freeze([
    "“No material change” is not a claim that nothing changed. It means the observed"
    + " move is smaller than the threshold this finding treats as material, which is stated"
    + " beside it.",
  ]),
  material_ratio_increase: Object.freeze([
    "A higher ratio does not mean the team slowed down, and it is not evidence that spend"
    + " affected delivery or that delivery affected spend. Every confounder listed with this"
    + " finding moves the ratio on its own.",
  ]),
  material_ratio_decrease: Object.freeze([
    "A lower ratio does not mean the team sped up, and it is not evidence that spend affected"
    + " delivery or that delivery affected spend. Every confounder listed with this finding"
    + " moves the ratio on its own.",
  ]),
});

/**
 * The reason a classification was reached, in the ladder's own order. Each code
 * is either a spend-per-delivery reason code passed straight through, or one of
 * the three this module decides itself.
 */
export const DELIVERY_FINDING_OWN_REASONS = Object.freeze([
  "incomplete_local_provenance",
  "within_material_band",
  "within_single_release_sensitivity",
  "material_move_past_both_thresholds",
]);

/**
 * The fields this module will not carry at any length, redacted or not.
 *
 * A release version and an export id are free text from a file or a form. They
 * identify nothing a reader needs in order to judge a ratio — the window and the
 * counts do that — so excluding them is cheaper than sanitizing them, and it
 * removes the whole class of "a release named `ignore all previous instructions`
 * reached a judge" rather than filtering one shape of it.
 */
export const EXCLUDED_SOURCE_FIELDS = Object.freeze([
  "release.version", "release.id", "release.notes", "provider_export.export_id",
  "provider_export.line_item.description",
]);

/** The one rounding rule, half away from zero, as in the source contract. */
function round(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const magnitude = Math.round(Math.abs(value) * factor) / factor;
  return value < 0 ? -magnitude : magnitude;
}

/**
 * The only gate any source-derived string crosses on its way into a finding.
 *
 * It is the repository's existing sanitizer rather than a second one: redaction
 * that has two definitions has none. The result is idempotent, and a test asserts
 * that every string on every fixture finding is already a fixed point of it, so a
 * later edit that appends raw text to a sentence fails rather than ships.
 */
export function redactForFinding(value) {
  return sanitizeFinopsRecommendation(String(value ?? ""));
}

const redactList = (values) => Object.freeze(
  (Array.isArray(values) ? values : []).map(redactForFinding));

/**
 * The observational check, executable. It runs over every string a finding
 * carries, so a copy edit six months from now cannot introduce a causal claim
 * quietly.
 *
 * `forbiddenClaims` travels from the source contract so the two lists cannot
 * drift apart. The causal phrases beside it are the ones that assert a mechanism;
 * bare "because" is deliberately not among them, because the source contract uses
 * it to explain why a *comparison is unavailable*, which is a statement about
 * records and not about cause.
 */
export const CAUSAL_PHRASES = Object.freeze([
  "caused", "causes", "drove", "driven by", "resulted in", "led to", "thanks to",
  "as a result of", "attributable to", "produced by", "translates into",
]);

const scanPattern = (phrase) =>
  new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

/**
 * @returns the first offending phrase and the string it was found in, or null.
 *   Returned rather than thrown so both a test and a caller can use it.
 */
export function assertObservational(finding) {
  const strings = [];
  const walk = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(finding);
  // The framing sentence is the one string allowed to name the claims, because it
  // is the sentence that denies them.
  const scanned = strings.filter((value) => value !== FRAMING.statement
    && !FRAMING.forbiddenClaims.includes(value));
  for (const phrase of [...FRAMING.forbiddenClaims, ...CAUSAL_PHRASES]) {
    const offender = scanned.find((value) => scanPattern(phrase).test(value));
    if (offender) return { phrase, text: offender };
  }
  return null;
}

/* ------------------------------ the ladder ---------------------------------- */

/**
 * Classification, first match wins, in exactly this order:
 *
 *   1. mismatched window            -> invalid_period_alignment
 *   2. withheld ratio               -> insufficient_evidence
 *   3. incomplete local provenance  -> insufficient_evidence
 *   4. no trailing baseline         -> insufficient_evidence
 *   5. move under materialChangePercent          -> stable_ratio
 *   6. move within the single-release swing      -> insufficient_evidence
 *   7. move past both, upward / downward         -> material_*
 *
 * Order matters twice. Provenance is checked before the comparison because a
 * figure whose basis was never fully checked cannot support a direction however
 * good the comparison looks. And the material band is checked before the
 * single-release swing so that a genuinely small move is reported as stable
 * rather than as indeterminate: a move the swing cannot distinguish from noise is
 * consistent with stability, and calling it insufficient would hide a complete
 * reading behind a data-collection action.
 */
function classify(decision, swingPercent) {
  if (decision.state === SPEND_PER_DELIVERY_STATE.mismatched) {
    return { classification: "invalid_period_alignment", reasonCode: decision.reasonCode };
  }
  if (decision.state !== SPEND_PER_DELIVERY_STATE.eligible) {
    return { classification: "insufficient_evidence", reasonCode: decision.reasonCode };
  }
  if (!decision.provenance.complete) {
    return { classification: "insufficient_evidence", reasonCode: "incomplete_local_provenance" };
  }
  if (!decision.comparison.available) {
    return { classification: "insufficient_evidence", reasonCode: decision.comparison.reasonCode };
  }
  const magnitude = Math.abs(decision.comparison.deltaPercent);
  if (magnitude < DELIVERY_FINDING_THRESHOLDS.materialChangePercent.value) {
    return { classification: "stable_ratio", reasonCode: "within_material_band" };
  }
  if (magnitude <= swingPercent) {
    return {
      classification: "insufficient_evidence",
      reasonCode: "within_single_release_sensitivity",
    };
  }
  return {
    classification: decision.comparison.deltaPercent > 0
      ? "material_ratio_increase" : "material_ratio_decrease",
    reasonCode: "material_move_past_both_thresholds",
  };
}

const percentText = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}`
  + `${Math.abs(value).toFixed(1)}%`;

/**
 * The headline, one sentence, and the only sentence a reader who reads nothing
 * else will read. Every branch names the window, so no number ever appears
 * without the period it describes.
 */
function headlineFor(classification, decision, swingPercent) {
  const window = decision.window
    ? `${decision.window.start} to ${decision.window.end}`
    : "the period read in this tab";
  const move = decision.comparison.available
    ? percentText(decision.comparison.deltaPercent) : null;
  switch (classification) {
    case "invalid_period_alignment":
      return "No reading is published: the billing periods and the recorded releases read here"
        + " cannot be aligned to one window.";
    case "material_ratio_increase":
      return `Recorded AI spend per completed release is ${move} against this reader's own`
        + ` trailing baseline over ${window} — past both the ${DELIVERY_FINDING_THRESHOLDS
          .materialChangePercent.value}% material threshold and the ${swingPercent}% swing one`
        + " more recorded release would cause.";
    case "material_ratio_decrease":
      return `Recorded AI spend per completed release is ${move} against this reader's own`
        + ` trailing baseline over ${window} — past both the ${DELIVERY_FINDING_THRESHOLDS
          .materialChangePercent.value}% material threshold and the ${swingPercent}% swing one`
        + " more recorded release would cause.";
    case "stable_ratio":
      return `No material change over ${window}: recorded AI spend per completed release moved`
        + ` ${move} against this reader's own trailing baseline, under the`
        + ` ${DELIVERY_FINDING_THRESHOLDS.materialChangePercent.value}% this finding treats as`
        + " material.";
    default:
      return `No direction is published for ${window}: the records read here do not support`
        + " calling this a rise, a fall, or a flat period.";
  }
}

/**
 * The rationale, as the ordered list of rules that were actually applied to reach
 * this classification. This is what makes the finding explainable without the
 * module: each entry names the rule, the numbers it was given, and the outcome,
 * so a disputed classification can be recomputed from the screen.
 */
function rationaleFor({ decision, classification, reasonCode, swingPercent }) {
  const steps = [];
  const step = (code, text) => steps.push(Object.freeze({ code, text: redactForFinding(text) }));
  step("source_state", `The derivation published state "${decision.state}"`
    + `${decision.reasonCode ? ` with reason "${decision.reasonCode}"` : ""}.`);
  if (decision.state === SPEND_PER_DELIVERY_STATE.eligible) {
    step("floors_cleared", `The headline period cleared both minimum-data floors:`
      + ` at least ${MINIMUM_PERIOD_DAYS} days (${decision.window.days}) and at least`
      + ` ${MINIMUM_DELIVERIES} completed releases (${decision.metric.deliveries}).`);
    step("provenance", decision.provenance.complete
      ? "Every local field the derivation requires was declared."
      : `The basis is incomplete: ${decision.provenance.missingFields.join(", ")} did not back`
        + " this figure, so no direction is published from it.");
    if (decision.comparison.available) {
      step("baseline", `The trailing baseline is the mean of`
        + ` ${decision.comparison.baselinePeriods} earlier period ratios that clear the same`
        + ` floor; ${decision.comparison.baselineExcludedPeriods} earlier period(s) were`
        + " excluded for failing it, and none was counted as zero.");
      step("observed_move", `Observed move against that baseline:`
        + ` ${percentText(decision.comparison.deltaPercent)}.`);
      step("material_threshold", `Material threshold:`
        + ` ${DELIVERY_FINDING_THRESHOLDS.materialChangePercent.value}%.`
        + ` ${Math.abs(decision.comparison.deltaPercent)
          >= DELIVERY_FINDING_THRESHOLDS.materialChangePercent.value ? "Cleared" : "Not cleared"}.`);
      step("single_release_sensitivity", `One more completed release in the headline period`
        + ` would move the ratio by ${swingPercent}% (100 / (${decision.metric.deliveries} + 1)).`
        + ` A move no larger than that is not reported as material.`
        + ` ${Math.abs(decision.comparison.deltaPercent) > swingPercent
          ? "Cleared" : "Not cleared"}.`);
    } else {
      step("baseline", `No trailing baseline was available`
        + `${decision.comparison.reasonCode ? ` (${decision.comparison.reasonCode})` : ""}, so`
        + " there is nothing to measure a move against.");
    }
  }
  step("classification", `Classified ${classification} on rule "${reasonCode}".`);
  step("direction", DIRECTIONAL_CLASSIFICATIONS.includes(classification)
    ? `Direction published as "${decision.comparison.direction}": this describes the movement of`
      + " a recorded ratio between two windows, and nothing about why either count moved."
    : "No direction published.");
  return Object.freeze(steps);
}

/**
 * Score one spend-per-delivery decision into a finding.
 *
 * @param {object} decision the frozen record from `spendPerDeliveryDecision`.
 * @returns {object|null} a frozen finding, or `null` for the `absent` state —
 *   nothing has been read, so there is nothing to classify, and an
 *   "insufficient" finding for an empty tab would be a conclusion about no data.
 */
export function deliveryEfficiencyFinding(decision) {
  if (!decision || typeof decision !== "object") {
    throw new TypeError("deliveryEfficiencyFinding requires a spend-per-delivery decision.");
  }
  if (decision.state === SPEND_PER_DELIVERY_STATE.absent) return null;

  const deliveries = decision.metric?.deliveries ?? null;
  // Null, not a default: with no published delivery count there is no swing, and
  // a placeholder swing would be a threshold nobody chose.
  const swingPercent = typeof deliveries === "number" && deliveries > 0
    ? round(100 / (deliveries + 1), 1) : null;
  const { classification, reasonCode } = classify(decision, swingPercent ?? Infinity);
  const directional = DIRECTIONAL_CLASSIFICATIONS.includes(classification);
  const priority = DELIVERY_FINDING_PRIORITY[classification];
  const confidenceLevel = decision.confidence.level;

  return Object.freeze({
    schemaVersion: DELIVERY_FINDING_SCHEMA_VERSION,
    derivedFrom: decision.schemaVersion,
    question: redactForFinding(decision.question),
    unit: SPEND_PER_DELIVERY_UNIT,
    classification,
    classificationReasonCode: reasonCode,
    headline: redactForFinding(headlineFor(classification, decision, swingPercent)),
    // The direction is structurally unreachable outside the two material
    // classifications, rather than blanked afterwards by a caller.
    direction: directional ? decision.comparison.direction : null,
    priority: Object.freeze({
      rank: priority.rank,
      band: priority.band,
      rule: "Rank is derived from the classification alone, so the same classification always"
        + " places this finding at the same rank. No figure, dollar amount, or confidence level"
        + " moves it.",
      assumption: priority.assumption,
    }),
    confidence: Object.freeze({
      level: confidenceLevel,
      rank: CONFIDENCE_LEVELS.indexOf(confidenceLevel),
      scale: CONFIDENCE_LEVELS,
      // Redacted: the derivation quotes a provider export's own completeness
      // declaration into this sentence, and that string came from a file.
      basis: redactForFinding(decision.confidence.basis),
    }),
    rationale: rationaleFor({ decision, classification, reasonCode, swingPercent }),
    thresholds: DELIVERY_FINDING_THRESHOLDS,
    measurement: Object.freeze({
      // Published exactly where the derivation published it: a withheld ratio
      // stays null here, never 0, and never a figure this module recomputed.
      window: decision.window,
      spendUsd: decision.metric.spendUsd,
      deliveries,
      spendPerDeliveryUsd: decision.metric.spendPerDeliveryUsd,
      baselineUsd: decision.comparison.baselineUsd,
      deltaUsd: decision.comparison.deltaUsd,
      deltaPercent: decision.comparison.deltaPercent,
      singleReleaseSwingPercent: swingPercent,
    }),
    requiredCaveats: Object.freeze([
      ...CLASSIFICATION_CAVEATS[classification], ...UNIVERSAL_CAVEATS,
    ].map(redactForFinding)),
    confounders: CONFOUNDERS,
    framing: FRAMING,
    evidence: redactList(decision.evidence),
    nextAction: Object.freeze({
      rank: decision.nextAction.rank,
      owner: redactForFinding(decision.nextAction.owner),
      text: redactForFinding(decision.nextAction.text),
      why: redactForFinding(decision.nextAction.why),
    }),
    provenance: Object.freeze({
      origin: decision.provenance.origin,
      source: redactForFinding(decision.provenance.source),
      complete: decision.provenance.complete,
      missingFields: decision.provenance.missingFields,
    }),
    redaction: Object.freeze({
      rule: "Every string carried out of the derivation passes the repository's one sanitizer"
        + " before it reaches this finding, and the sanitizer is idempotent, so re-running it"
        + " over a published finding changes nothing.",
      excludedFields: EXCLUDED_SOURCE_FIELDS,
      excludedReason: "Free text from a provider file or a release form identifies nothing a"
        + " reader needs in order to judge a ratio, so it is excluded rather than filtered.",
    }),
  });
}
