// What one provider export can honestly answer — and what it cannot.
//
// A single provider export (OpenAI, Anthropic, AWS, Azure, GCP) answers exactly
// one question:
//
//   "Which model or service line is my spend concentrated in, and how much of it
//    is recoverable without changing what we ship?"
//
// It cannot answer *who* is spending. It can only answer that when the export
// itself carries a grouping column, and it answers it by that column's own
// labels until an org mapping renames them. Org mapping is therefore a precision
// upgrade, not a gate: nothing here blocks an analysis on its absence, and
// nothing here promises a department answer the line items cannot support.
//
// This module is the one place that decision is written down. Every threshold,
// every confidence label, and every "we will not show this" is data below, so a
// consuming surface reads a table rather than re-deriving a rule in a branch.
//
// ---------------------------------------------------------------------------
// Metric definitions. Two engineers reading these must produce the same number.
// ---------------------------------------------------------------------------
//
//   line item          one parsed cost row of the export, exactly as the parser
//                      produced it. `cost` is the row's amount in the dataset's
//                      single currency; the unit is the caller's (major units or
//                      minor units) and must be the same for every row. The share
//                      is a ratio, so it is unit-free either way.
//
//   grouping key       the row's grouping value — `org_unit_id` in the v1
//                      provider contract, which the delimited path binds from the
//                      export's native grouping column when one exists. Empty
//                      string, whitespace, null, and undefined are all "absent".
//
//   known group        a grouping key the analysis can resolve to a group it can
//                      name. With no org mapping the known set is the export's own
//                      distinct grouping values; with one it is the mapped units.
//                      A caller that passes no `knownGroups` accepts every
//                      non-empty key, which is the native-grouping case.
//
//   attributed_spend_share
//                      sum(cost) over line items whose grouping key is non-empty
//                      *and* resolves to a known group, divided by sum(cost) over
//                      **all** line items in the parsed export, across the full
//                      period present in the file. The denominator excludes
//                      nothing: not credits, not taxes, not zero-cost rows, not
//                      rows the analysis later drops. A denominator of 0 makes the
//                      share undefined, and undefined is treated as below the
//                      floor — never as 0.8, never as "unknown but fine".
//                      Under PROVIDER_ONLY the numerator is 0 by construction.
//
//   unattributed_share 1 − attributed_spend_share. This is the figure a DEGRADED
//                      finding must display verbatim, as a percentage of spend,
//                      rounded to whole percent, half away from zero.
//
// ---------------------------------------------------------------------------
// Deliberate omissions
// ---------------------------------------------------------------------------
//
// * No numeric confidence score. Three states with published thresholds, matching
//   what `grade-eligibility.js` and the trust verdict already refuse to invent.
// * No hedged savings number below the floor. A range, an "approximately", or a
//   dollar figure with an asterisk is the same wrong number with a disclaimer on
//   it. Below the floor the fallback names spend and concentration, and stops.
// * No second question. Anything this module could also compute — per-model
//   deltas, forecast, benchmark — is answered by a surface that already owns it.

/** Bump when a state, a category id, or a threshold's meaning changes. */
export const ATTRIBUTION_POLICY_VERSION = "provider-export-attribution/1.0.0";

/**
 * The three input states, and nothing between them. `PROVIDER_PLUS_GROUPING` is
 * the state `native-grouping.js` already detects; this module reads that
 * detection rather than repeating it.
 */
export const INPUT_STATES = Object.freeze({
  PROVIDER_ONLY: "PROVIDER_ONLY",
  PROVIDER_PLUS_GROUPING: "PROVIDER_PLUS_GROUPING",
  PROVIDER_PLUS_ORG_MAPPING: "PROVIDER_PLUS_ORG_MAPPING",
});

/** What a surface is allowed to do with a finding in a given state. */
export const CONFIDENCE = Object.freeze({
  FULL: "FULL_CONFIDENCE",
  DEGRADED: "DEGRADED",
  SUPPRESSED: "SUPPRESSED",
});

/**
 * Thresholds, read with `>=` at **both** boundaries.
 *
 *   share >= 0.80                 ranked headline at full confidence
 *   0.50 <= share < 0.80          ranked headline, DEGRADED, carries the
 *                                 unattributed share verbatim
 *   share < 0.50, or undefined    not presented as a ranked finding at all
 *
 * So 0.80 is full confidence and 0.50 is degraded; 0.7999 and 0.4999 are not.
 */
export const ATTRIBUTION_FULL_CONFIDENCE_MIN = 0.80;
export const ATTRIBUTION_RANKED_FINDING_FLOOR = 0.50;

/**
 * The finding categories this page can produce, named by what they claim rather
 * than by the element that renders them.
 */
export const FINDING_CATEGORIES = Object.freeze({
  /** Where the money is: the largest spend lines, by provider and service. */
  SPEND_CONCENTRATION: "spend_concentration",
  /** The mix across models and service lines, and its movement. */
  MODEL_SERVICE_MIX: "model_service_mix",
  /** The headline: how much is recoverable without changing what we ship. */
  RECOVERABLE_SAVINGS: "recoverable_savings",
  /** Anything that names a team, an owner, or a cost center. */
  TEAM_ATTRIBUTION: "team_attribution",
});

/**
 * `by_attribution` means the cell is decided by the measured share against the
 * two thresholds above, not by the input state. It is used for exactly one
 * category — the recoverable-savings headline — because that is the one number
 * whose honesty depends on how much of the money is attributed rather than on
 * which files were dropped.
 */
const BY_ATTRIBUTION = "by_attribution";

/**
 * The whole policy, as data: finding category × input state. A surface that
 * wants to know what it may render looks the answer up here. Adding a branch
 * downstream instead of a row here is how the product would start saying two
 * different things about the same finding.
 */
export const CLASSIFICATION_TABLE = Object.freeze({
  // Concentration and mix need only the line items. No grouping column, no org
  // file, and no attribution share can make "most of your spend is on this
  // model" less true, so these are never degraded and never suppressed.
  [FINDING_CATEGORIES.SPEND_CONCENTRATION]: Object.freeze({
    [INPUT_STATES.PROVIDER_ONLY]: CONFIDENCE.FULL,
    [INPUT_STATES.PROVIDER_PLUS_GROUPING]: CONFIDENCE.FULL,
    [INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING]: CONFIDENCE.FULL,
  }),
  [FINDING_CATEGORIES.MODEL_SERVICE_MIX]: Object.freeze({
    [INPUT_STATES.PROVIDER_ONLY]: CONFIDENCE.FULL,
    [INPUT_STATES.PROVIDER_PLUS_GROUPING]: CONFIDENCE.FULL,
    [INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING]: CONFIDENCE.FULL,
  }),
  // The headline. Under PROVIDER_ONLY the share is 0 by construction, so this
  // row lands on SUPPRESSED there without needing a state-specific cell.
  [FINDING_CATEGORIES.RECOVERABLE_SAVINGS]: Object.freeze({
    [INPUT_STATES.PROVIDER_ONLY]: BY_ATTRIBUTION,
    [INPUT_STATES.PROVIDER_PLUS_GROUPING]: BY_ATTRIBUTION,
    [INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING]: BY_ATTRIBUTION,
  }),
  // Naming a team is the one claim a bare export cannot make at all. With the
  // export's own grouping it can name a unit but not vouch that the unit is the
  // team a leader means, so it is degraded and says how much is unattributed.
  [FINDING_CATEGORIES.TEAM_ATTRIBUTION]: Object.freeze({
    [INPUT_STATES.PROVIDER_ONLY]: CONFIDENCE.SUPPRESSED,
    [INPUT_STATES.PROVIDER_PLUS_GROUPING]: CONFIDENCE.DEGRADED,
    [INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING]: CONFIDENCE.FULL,
  }),
});

/** Why a category carries the confidence it does, in one sentence each. */
const CATEGORY_RULE = Object.freeze({
  [FINDING_CATEGORIES.SPEND_CONCENTRATION]:
    "Concentration is read from the line items alone, so no grouping input changes it.",
  [FINDING_CATEGORIES.MODEL_SERVICE_MIX]:
    "The model and service mix is read from the line items alone, so no grouping input changes it.",
  [FINDING_CATEGORIES.RECOVERABLE_SAVINGS]:
    "The recoverable figure is ranked only when attributed spend clears the published share.",
  [FINDING_CATEGORIES.TEAM_ATTRIBUTION]:
    "A team claim needs a grouping column to exist and an org mapping to be vouched for.",
});

/** The one sentence naming what would raise confidence, per input state. */
export const RAISE_CONFIDENCE_SENTENCE = Object.freeze({
  [INPUT_STATES.PROVIDER_ONLY]:
    "Re-export with a grouping column — project, workspace, key alias, or cost tag — "
    + "or add an org mapping file in this tab to raise confidence.",
  [INPUT_STATES.PROVIDER_PLUS_GROUPING]:
    "Add an org mapping file in this tab, or fill the grouping column on the rows that "
    + "are missing it, to raise confidence.",
  [INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING]:
    "Fill the grouping column on the rows that are missing it, or extend the org mapping "
    + "to the units it does not cover, to raise confidence.",
});

/**
 * The one line the requirements row uses for the org mapping. Written here so
 * the requirement copy and the policy cannot drift into disagreeing about
 * whether the file is required.
 */
export const ORG_MAPPING_REQUIREMENT_STATUS = "optional — sharpens attribution";

/**
 * The optional inputs, and the concrete gain each one buys. Written here rather
 * than in the requirements component for the same reason the status word above
 * is: the panel that offers an upgrade and the policy that decides what the
 * upgrade changes must not be able to disagree about it.
 *
 * `gain` is the standing sentence. A surface that has a measured share replaces
 * it with the projected coverage `rankedCoverageUpgrades` computes from the
 * reader's own file — the same claim, with their number in it.
 */
export const OPTIONAL_UPGRADES = Object.freeze({
  ORG_MAPPING: Object.freeze({
    id: "org_mapping",
    name: "Org mapping",
    status: ORG_MAPPING_REQUIREMENT_STATUS,
    gain: "Renames the grouping values your export already carries into the units "
      + "your org uses, and lets a finding name a team rather than a column value.",
  }),
  QUERY_SAMPLE: Object.freeze({
    id: "query_sample",
    name: "Query sample",
    status: "optional — sharpens what the spend bought",
    gain: "Grades what the spend was actually asking for, so the mix is read by "
      + "intent rather than by model line alone.",
  }),
});

/**
 * Whether an analysis may run at all, decided by the same state machine that
 * classifies findings. A recognized provider export on its own is eligible: the
 * grouping column and the org mapping are precision upgrades above, and neither
 * is a gate. Nothing else in the product is allowed to hold a second opinion.
 *
 * The reason travels with the verdict so a disabled control can name the policy
 * state that disabled it instead of a string authored beside the button.
 *
 * @returns {{eligible: boolean, inputState: string|null, reason: string}}
 */
export function analysisEligibility(input = {}) {
  const inputState = providerExportInputState(input);
  if (!inputState) {
    return Object.freeze({
      eligible: false,
      inputState: null,
      reason: "No recognized provider export is loaded, so there is no spend to analyze. "
        + PRE_UPLOAD_DISCLOSURE.question,
    });
  }
  return Object.freeze({
    eligible: true,
    inputState,
    reason: inputState === INPUT_STATES.PROVIDER_ONLY
      ? "A provider export on its own is enough to analyze. " + PRE_UPLOAD_DISCLOSURE.limit
      : `A provider export on its own is enough to analyze. ${RAISE_CONFIDENCE_SENTENCE[inputState]}`,
  });
}

/**
 * What the page states **before** a single byte is selected. Three statements:
 * the question one export answers, the material metric it produces, and the one
 * action it will name. Not a section, not a panel — three sentences, and the
 * reason they exist is that a reader deciding whether to drop a file is owed the
 * answer before they spend the effort.
 */
export const PRE_UPLOAD_DISCLOSURE = Object.freeze({
  question: "One provider export answers one question: which model or service line "
    + "your spend is concentrated in, and how much of it is recoverable without "
    + "changing what you ship.",
  metric: "The material metric is recoverable spend for the period in the file, "
    + "stated in the file's own currency beside the total it came out of.",
  action: "It names one prioritized action: the single concentration line worth "
    + "moving first.",
  /** Said plainly, because the alternative is a reader assuming otherwise. */
  limit: "It does not say who or which team is spending unless your export carries "
    + "a grouping column. An org mapping file is optional and only sharpens that.",
});

/** Statements in the order they are read. `limit` is deliberately last. */
export const PRE_UPLOAD_STATEMENTS = Object.freeze([
  PRE_UPLOAD_DISCLOSURE.question,
  PRE_UPLOAD_DISCLOSURE.metric,
  PRE_UPLOAD_DISCLOSURE.action,
]);

/**
 * Which of the three states an input set is in.
 *
 * @param {object} input
 * @param {boolean} input.hasProviderExport a recognized provider export is parsed.
 * @param {boolean} input.hasGroupingColumn the parser recognized a grouping
 *   column — pass `nativeGrouping.status === "native"` from `native-grouping.js`;
 *   this module does not re-detect it.
 * @param {boolean} input.hasOrgMapping the reader supplied an org mapping in-tab.
 * @returns {string|null} an `INPUT_STATES` member, or null with no export at all.
 */
export function providerExportInputState({
  hasProviderExport = false, hasGroupingColumn = false, hasOrgMapping = false,
} = {}) {
  if (!hasProviderExport) return null;
  // An org mapping with nothing to map to is not the org-mapping state: the
  // mapping renames grouping values, so with no grouping column there is
  // nothing for it to rename and the export is still provider-only.
  if (hasGroupingColumn && hasOrgMapping) return INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING;
  if (hasGroupingColumn) return INPUT_STATES.PROVIDER_PLUS_GROUPING;
  return INPUT_STATES.PROVIDER_ONLY;
}

/** Absent means absent: null, undefined, and any all-whitespace string. */
function groupingKeyOf(item) {
  const key = item?.groupingKey ?? item?.orgUnitId ?? item?.org_unit_id ?? null;
  const text = typeof key === "string" ? key.trim() : key === null || key === undefined ? "" : String(key).trim();
  return text || null;
}

function costOf(item) {
  const cost = Number(item?.cost ?? item?.costUsd ?? item?.amount ?? 0);
  return Number.isFinite(cost) ? cost : 0;
}

/**
 * The share on its own, from two sums a caller already has. Exported because the
 * trust verdict has summed exactly these two figures by the time the decision
 * brief renders, and summing them a second time is how two numbers on one screen
 * start disagreeing.
 *
 * `share` is null exactly when there is no denominator. A caller never has to
 * distinguish that from a measured zero — both are below the floor — but the
 * distinction is preserved so a surface can say which one it is.
 *
 * @returns {{share: number|null, defined: boolean, attributedCost: number, totalCost: number}}
 */
export function attributionShareFromTotals({ attributedCost = 0, totalCost = 0 } = {}) {
  const total = Number(totalCost);
  const attributed = Number(attributedCost);
  if (!Number.isFinite(total) || total === 0) {
    return Object.freeze({ share: null, defined: false, attributedCost: 0, totalCost: 0 });
  }
  const safeAttributed = Number.isFinite(attributed) ? attributed : 0;
  // A numerator larger than the denominator is an upstream defect, not a share
  // above 1. Clamping keeps a nonsense input from printing as −40% unattributed.
  const raw = safeAttributed / total;
  const share = raw > 1 ? 1 : raw < 0 ? 0 : raw;
  return Object.freeze({
    share, defined: true, attributedCost: safeAttributed, totalCost: total,
  });
}

/**
 * `attributed_spend_share` over parsed line items, as defined at the top of this
 * file. Rows are counted in the denominator whatever their cost is and whatever
 * the analysis later does with them.
 *
 * @param {Array<{cost: number, groupingKey?: string|null}>} lineItems
 * @param {{knownGroups?: Iterable<string>|null}} [options] the groups the
 *   analysis can name. Omit (or pass null) to accept every non-empty key, which
 *   is the export's-own-grouping case.
 * @returns {{share: number|null, defined: boolean, attributedCost: number,
 *            totalCost: number, attributedRows: number, totalRows: number}}
 */
export function attributedSpendShare(lineItems = [], { knownGroups = null } = {}) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const known = knownGroups === null || knownGroups === undefined
    ? null
    : new Set([...knownGroups].map((group) => String(group).trim()).filter(Boolean));
  let totalCost = 0;
  let attributedCost = 0;
  let attributedRows = 0;
  for (const item of items) {
    const cost = costOf(item);
    totalCost += cost;
    const key = groupingKeyOf(item);
    if (!key) continue;
    if (known && !known.has(key)) continue;
    attributedCost += cost;
    attributedRows += 1;
  }
  return Object.freeze({
    ...attributionShareFromTotals({ attributedCost, totalCost }),
    attributedRows,
    totalRows: items.length,
  });
}

/**
 * 1 − share. Null in, null out: an undefined share has no complement, and
 * printing "100% unattributed" for a file with no spend in it would be a claim
 * about money that is not there.
 */
export function unattributedShare(share) {
  const value = share === null || share === undefined ? null : Number(share);
  if (value === null || !Number.isFinite(value)) return null;
  return 1 - Math.min(1, Math.max(0, value));
}

/** Whole percent, half away from zero. `0.375 → 38%`, `0.005 → 1%`. */
export function toWholePercent(share) {
  if (share === null || share === undefined || !Number.isFinite(Number(share))) return null;
  const value = Number(share) * 100;
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** The figure a DEGRADED finding shows verbatim, e.g. `"31% of spend"`. */
export function unattributedShareText(share) {
  const percent = toWholePercent(unattributedShare(share));
  return percent === null ? null : `${percent}% of spend is unattributed`;
}

/** Full / degraded / suppressed for the headline, from the measured share. */
function confidenceFromShare(share) {
  if (share === null || share === undefined || !Number.isFinite(Number(share))) {
    return CONFIDENCE.SUPPRESSED;
  }
  const value = Number(share);
  if (value >= ATTRIBUTION_FULL_CONFIDENCE_MIN) return CONFIDENCE.FULL;
  if (value >= ATTRIBUTION_RANKED_FINDING_FLOOR) return CONFIDENCE.DEGRADED;
  return CONFIDENCE.SUPPRESSED;
}

/**
 * What a surface may render for one finding category.
 *
 * @param {string} category a `FINDING_CATEGORIES` member.
 * @param {string} inputState an `INPUT_STATES` member.
 * @param {number|null} share the measured `attributed_spend_share`, or null.
 * @returns {{category: string, inputState: string, confidence: string,
 *            render: boolean, showsRankedSavings: boolean,
 *            unattributedShare: number|null, unattributedPercent: number|null,
 *            unattributedText: string|null, rule: string}}
 */
export function classifyFinding(category, inputState, share = null) {
  const row = CLASSIFICATION_TABLE[category];
  const cell = row?.[inputState] ?? CONFIDENCE.SUPPRESSED;
  const confidence = cell === BY_ATTRIBUTION ? confidenceFromShare(share) : cell;
  const degraded = confidence === CONFIDENCE.DEGRADED;
  return Object.freeze({
    version: ATTRIBUTION_POLICY_VERSION,
    category,
    inputState,
    confidence,
    /** Suppressed findings are not rendered in any hedged form. */
    render: confidence !== CONFIDENCE.SUPPRESSED,
    /** The one flag a consuming surface must not accidentally ignore. */
    showsRankedSavings: category === FINDING_CATEGORIES.RECOVERABLE_SAVINGS
      && confidence !== CONFIDENCE.SUPPRESSED,
    // A degraded finding without the figure is just an unlabelled finding, so
    // the number travels on the classification rather than being looked up.
    unattributedShare: degraded ? unattributedShare(share) : null,
    unattributedPercent: degraded ? toWholePercent(unattributedShare(share)) : null,
    unattributedText: degraded ? unattributedShareText(share) : null,
    rule: CATEGORY_RULE[category] ?? "",
  });
}

/** Every category at once, keyed by category id. */
export function classifyFindings(inputState, share = null) {
  return Object.freeze(Object.fromEntries(
    Object.values(FINDING_CATEGORIES).map((category) =>
      [category, classifyFinding(category, inputState, share)]),
  ));
}

/**
 * The largest concentration line: the provider-and-service pair carrying the
 * most cost. Ties break on higher cost, then on label ascending, so the same
 * file always names the same line. This is `FULL_CONFIDENCE` in every input
 * state, which is why it is what the below-floor fallback shows instead of a
 * savings figure.
 *
 * @param {Array<{cost: number, provider?: string, service?: string}>} lineItems
 */
export function largestConcentrationLine(lineItems = []) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const byLine = new Map();
  let totalCost = 0;
  for (const item of items) {
    const cost = costOf(item);
    totalCost += cost;
    const provider = String(item?.provider ?? "").trim();
    const service = String(item?.service ?? item?.serviceCategory ?? item?.service_category ?? "").trim();
    const label = [provider, service].filter(Boolean).join(" · ") || "Unlabelled line";
    byLine.set(label, (byLine.get(label) ?? 0) + cost);
  }
  const ranked = [...byLine.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])));
  const top = ranked[0];
  if (!top || totalCost <= 0) {
    return Object.freeze({ available: false, label: null, cost: 0, share: null, totalCost });
  }
  return Object.freeze({
    available: true, label: top[0], cost: top[1], share: top[1] / totalCost, totalCost,
  });
}

/**
 * What the page shows in place of a ranked savings figure when the share is
 * below the floor. Three facts and no fourth: the spend observed, the largest
 * concentration line, and the one sentence naming what would raise confidence.
 *
 * `showsRankedSavings` is false and there is no dollar savings figure anywhere
 * on this object — not a range, not an estimate, not a hedged amount. That is
 * the point of the state.
 */
export function suppressedSavingsFallback({
  inputState = INPUT_STATES.PROVIDER_ONLY, share = null, lineItems = null,
  totalCost = null, concentration = null,
} = {}) {
  const line = concentration ?? largestConcentrationLine(lineItems ?? []);
  const total = Number.isFinite(Number(totalCost)) && totalCost !== null
    ? Number(totalCost) : line.totalCost;
  return Object.freeze({
    version: ATTRIBUTION_POLICY_VERSION,
    inputState,
    confidence: CONFIDENCE.SUPPRESSED,
    showsRankedSavings: false,
    reason: "attribution_below_floor",
    /** Why the number is absent, said before the reader has to ask. */
    headline: "No recoverable-savings figure is shown.",
    explanation: `Under ${toWholePercent(ATTRIBUTION_RANKED_FINDING_FLOOR)}% of this spend is `
      + "attributed to a group, so a ranked savings number would be a claim about money "
      + "this file cannot place.",
    totalCost: total,
    unattributedShare: unattributedShare(share),
    unattributedPercent: toWholePercent(unattributedShare(share)),
    concentration: line,
    raiseConfidence: RAISE_CONFIDENCE_SENTENCE[inputState]
      ?? RAISE_CONFIDENCE_SENTENCE[INPUT_STATES.PROVIDER_ONLY],
  });
}
