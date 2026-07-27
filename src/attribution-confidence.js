// One confidence treatment, spoken in three places.
//
// A 68%-coverage result is trustworthy *and* qualified. Today the page says so
// four different ways — a word beside the recoverable figure, a sentence in the
// below-floor fallback, a prepended list item in the department evidence, and
// nothing at all on the KPI row or the spend mix. This module is the single
// vocabulary those surfaces read from, so the same finding cannot be described
// as "degraded" in one panel and left unmarked in the next.
//
// It decides nothing. Every state comes out of `finops-attribution-policy.js`
// (Noor, #355): `CONFIDENCE.FULL` / `DEGRADED` / `SUPPRESSED`, and the per
// category cells of `CLASSIFICATION_TABLE`. What is added here is presentation
// vocabulary — the word, the shape, and the border style each state carries —
// plus two read-only selectors over the policy's own arithmetic:
// `rankedCoverageUpgrades` and `coverageChangeAnnouncement`. Neither changes a
// threshold, and neither recomputes the share: both call the policy's exported
// `attributedSpendShare` and compare its results.
//
// Three rules hold for every export below.
//
//   1. Never color alone. Each state ships a word *and* a shape *and* a border
//      style. A monochrome reader sorts the three correctly with the hue gone.
//   2. Full confidence is the baseline, not a prize. It carries the coverage
//      sentence — a fact a reader is owed — and no badge, no tint, no icon.
//      `decorated` is false for exactly one state, and that is the point.
//   3. Degraded is not an error. Its words are "partial confidence" and its
//      shape is a half-filled circle, because the finding is real over the
//      attributed remainder. Nothing here reaches for failure semantics.

import {
  attributedSpendShare, classifyFinding, classifyFindings, CONFIDENCE,
  FINDING_CATEGORIES, INPUT_STATES, RAISE_CONFIDENCE_SENTENCE,
  ATTRIBUTION_RANKED_FINDING_FLOOR, toWholePercent,
} from "./finops-attribution-policy.js";

/** Bump when a state's word, shape, or the upgrade ranking's basis changes. */
export const CONFIDENCE_TREATMENT_VERSION = "attribution-confidence-treatment/1.0.0";

/**
 * The treatment, as data. `state` is the value written to `data-confidence` and
 * is the only hook the stylesheet uses; `shape` and `borderStyle` are the two
 * non-color differentiators, and `label` is the word that survives a monochrome
 * screenshot with the shape stripped out by a font fallback.
 */
export const CONFIDENCE_TREATMENT = Object.freeze({
  [CONFIDENCE.FULL]: Object.freeze({
    confidence: CONFIDENCE.FULL,
    state: "full",
    label: "full confidence",
    /** No badge. The baseline reads as an ordinary number, because it is one. */
    decorated: false,
    shape: "",
    borderStyle: "none",
  }),
  [CONFIDENCE.DEGRADED]: Object.freeze({
    confidence: CONFIDENCE.DEGRADED,
    state: "degraded",
    label: "partial confidence",
    decorated: true,
    /** Half-filled: the finding holds over the attributed half of the money. */
    shape: "◑",
    borderStyle: "dashed",
  }),
  [CONFIDENCE.SUPPRESSED]: Object.freeze({
    confidence: CONFIDENCE.SUPPRESSED,
    state: "suppressed",
    label: "withheld",
    decorated: true,
    /** An empty outline: the slot exists, and nothing was put in it. */
    shape: "◌",
    borderStyle: "dotted",
  }),
});

/** The treatment for a policy confidence value; unknown values read withheld. */
export function confidenceTreatment(confidence) {
  return CONFIDENCE_TREATMENT[confidence] ?? CONFIDENCE_TREATMENT[CONFIDENCE.SUPPRESSED];
}

/**
 * The three decorated surfaces, and the headline figure they qualify. Each maps
 * to one `FINDING_CATEGORIES` member, so the confidence a surface shows is the
 * cell the policy table already publishes for that claim rather than a fourth
 * opinion invented at render time.
 *
 *   KPI row / headline figure  the recoverable number → RECOVERABLE_SAVINGS,
 *                              the one category decided by the measured share.
 *   spend mix                  the model and service split → MODEL_SERVICE_MIX,
 *                              read from line items alone and never degraded.
 *   findings list              department findings name a team → TEAM_ATTRIBUTION,
 *                              suppressed with no grouping column at all.
 */
export const SURFACES = Object.freeze({
  KPI_ROW: "kpi_row",
  HEADLINE_FIGURE: "headline_figure",
  SPEND_MIX: "spend_mix",
  FINDINGS_LIST: "findings_list",
});

export const SURFACE_CATEGORY = Object.freeze({
  [SURFACES.KPI_ROW]: FINDING_CATEGORIES.RECOVERABLE_SAVINGS,
  [SURFACES.HEADLINE_FIGURE]: FINDING_CATEGORIES.RECOVERABLE_SAVINGS,
  [SURFACES.SPEND_MIX]: FINDING_CATEGORIES.MODEL_SERVICE_MIX,
  [SURFACES.FINDINGS_LIST]: FINDING_CATEGORIES.TEAM_ATTRIBUTION,
});

/**
 * Coverage as a percentage a reader can act on, with the two roundings that
 * would otherwise print a lie:
 *
 *   share === 1        "100%"        the only input allowed to say 100%
 *   0.996              ">99%"        rounds to 100 and is not 100
 *   0.002              "<1%"         rounds to 0 and is not 0
 *   null / undefined   null          no denominator, so no percentage
 */
export function coveragePercentText(share) {
  if (share === null || share === undefined || !Number.isFinite(Number(share))) return null;
  const value = Math.min(1, Math.max(0, Number(share)));
  if (value === 1) return "100%";
  if (value === 0) return "0%";
  const whole = toWholePercent(value);
  if (whole >= 100) return ">99%";
  if (whole <= 0) return "<1%";
  return `${whole}%`;
}

/**
 * The sentence read before the figure it qualifies. Coverage first, confidence
 * word second, and nothing else — a reader hears how much of the money this
 * covers before they hear what it is worth.
 */
export function coverageStatement({ share = null, confidence = CONFIDENCE.SUPPRESSED } = {}) {
  const percent = coveragePercentText(share);
  const { label } = confidenceTreatment(confidence);
  return percent === null
    ? `Coverage unmeasured · ${label}`
    : `Covers ${percent} of spend · ${label}`;
}

/**
 * Why a surface is withheld, and what would un-withhold it. Suppressed findings
 * are visibly absent with a reason attached; a blank panel is the failure this
 * sentence exists to prevent.
 */
export function withheldReason({
  category = FINDING_CATEGORIES.RECOVERABLE_SAVINGS,
  inputState = INPUT_STATES.PROVIDER_ONLY, share = null,
} = {}) {
  const floor = toWholePercent(ATTRIBUTION_RANKED_FINDING_FLOOR);
  const raise = RAISE_CONFIDENCE_SENTENCE[inputState]
    ?? RAISE_CONFIDENCE_SENTENCE[INPUT_STATES.PROVIDER_ONLY];
  if (category === FINDING_CATEGORIES.TEAM_ATTRIBUTION) {
    return `Withheld: this export carries no grouping column, so no finding here can name a team. ${raise}`;
  }
  const measured = coveragePercentText(share);
  return `Withheld: ${measured === null ? "no spend total could be read from this file"
    : `${measured} of this spend is attributed, under the published ${floor}% floor`}`
    + `, so a ranked figure would be a claim about money this file cannot place. ${raise}`;
}

/** One surface's classification, its treatment, and the words it renders. */
export function surfaceConfidence(surface, inputState, share = null) {
  const category = SURFACE_CATEGORY[surface] ?? FINDING_CATEGORIES.RECOVERABLE_SAVINGS;
  const classification = classifyFinding(category, inputState, share);
  const treatment = confidenceTreatment(classification.confidence);
  return Object.freeze({
    surface,
    category,
    confidence: classification.confidence,
    treatment,
    render: classification.render,
    statement: coverageStatement({ share, confidence: classification.confidence }),
    // Only the withheld state owes an explanation; the other two are self-
    // describing, and a "why" under a normal number is noise.
    reason: classification.confidence === CONFIDENCE.SUPPRESSED
      ? withheldReason({ category, inputState, share }) : "",
  });
}

// ---------------------------------------------------------------------------
// The one upgrade action
// ---------------------------------------------------------------------------

export const UPGRADE_IDS = Object.freeze({
  GROUPING_COLUMN: "grouping_column",
  FILL_GROUPING: "fill_grouping_values",
  ORG_MAPPING: "org_mapping",
});

const UPGRADE_ORDER = [
  UPGRADE_IDS.GROUPING_COLUMN, UPGRADE_IDS.FILL_GROUPING, UPGRADE_IDS.ORG_MAPPING,
];

/**
 * The provider carrying the most cost, named by the file's own value. Nothing
 * is hardcoded: an export from a provider this product has never heard of names
 * itself, and a file with no provider column falls back to a generic noun
 * rather than guessing.
 */
export function topProviderLabel(lineItems = []) {
  const byProvider = new Map();
  for (const item of Array.isArray(lineItems) ? lineItems : []) {
    const name = String(item?.provider ?? "").trim();
    if (!name) continue;
    const cost = Number(item?.cost ?? 0);
    byProvider.set(name, (byProvider.get(name) ?? 0) + (Number.isFinite(cost) ? cost : 0));
  }
  const ranked = [...byProvider.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])));
  return ranked[0]?.[0] ?? "provider";
}

/**
 * How the spend divides into what is attributed, what carries no grouping value
 * at all, and what carries one the analysis cannot name. Both figures come from
 * the policy's own `attributedSpendShare`, called twice: once accepting every
 * non-empty key, once restricted to the groups an org mapping names. Subtracting
 * the two is the only arithmetic added here.
 */
export function coverageSplit(lineItems = [], knownGroups = null) {
  const anyKey = attributedSpendShare(lineItems, { knownGroups: null });
  const named = attributedSpendShare(lineItems, { knownGroups });
  const total = named.totalCost;
  if (!Number.isFinite(total) || total <= 0) {
    return Object.freeze({
      total: 0, attributed: 0, blank: 0, unnamed: 0,
      blankShare: null, unnamedShare: null, blankRows: 0,
    });
  }
  const blank = Math.max(0, total - anyKey.attributedCost);
  const unnamed = Math.max(0, anyKey.attributedCost - named.attributedCost);
  return Object.freeze({
    total,
    attributed: named.attributedCost,
    blank,
    unnamed,
    blankShare: blank / total,
    unnamedShare: unnamed / total,
    blankRows: Math.max(0, anyKey.totalRows - anyKey.attributedRows),
  });
}

function upgradeEntry({ id, kind, label, gainShare, currentShare }) {
  const projected = kind === "coverage"
    ? Math.min(1, (currentShare ?? 0) + gainShare) : currentShare;
  const projectedText = coveragePercentText(projected);
  return Object.freeze({
    id,
    kind,
    label,
    gainShare,
    gainPercent: toWholePercent(gainShare),
    projectedShare: projected,
    projectedPercentText: projectedText,
    text: kind === "coverage"
      ? `${label} — would raise coverage to ~${projectedText}.`
      : `${label} — coverage is unchanged; it renames the units this result already covers.`,
  });
}

/**
 * Every input that could still be supplied, ranked by the coverage it would
 * add. A `coverage` entry moves the percentage; a `precision` entry does not and
 * says so, because offering an org mapping as a coverage upgrade when the export
 * already groups every row is how a reader learns to distrust the estimate.
 *
 * Entries that would add nothing are not offered at all. At 100% coverage the
 * list is empty rather than reading "would raise coverage to ~100%".
 *
 * @returns {{top: object|null, rest: object[], all: object[]}}
 */
export function rankedCoverageUpgrades({
  inputState = INPUT_STATES.PROVIDER_ONLY, lineItems = [], knownGroups = null,
  share = null,
} = {}) {
  const split = coverageSplit(lineItems, knownGroups);
  const measured = share === null || share === undefined || !Number.isFinite(Number(share))
    ? (split.total > 0 ? split.attributed / split.total : null)
    : Math.min(1, Math.max(0, Number(share)));
  const provider = topProviderLabel(lineItems);
  const candidates = [];

  if (inputState === INPUT_STATES.PROVIDER_ONLY) {
    // No grouping column exists, so every row is blank and re-exporting with one
    // is the whole of the available gain. `blankShare` is null only when the file
    // has no spend in it at all, and then there is nothing to promise.
    if (split.blankShare) {
      candidates.push(upgradeEntry({
        id: UPGRADE_IDS.GROUPING_COLUMN, kind: "coverage", currentShare: measured,
        gainShare: split.blankShare,
        label: `Re-export your ${provider} usage with a grouping column — project, `
          + "workspace, key alias, or cost tag",
      }));
    }
  } else if (split.blankShare) {
    candidates.push(upgradeEntry({
      id: UPGRADE_IDS.FILL_GROUPING, kind: "coverage", currentShare: measured,
      gainShare: split.blankShare,
      label: `Re-upload your ${provider} export with the grouping column filled on the `
        + `${split.blankRows} row${split.blankRows === 1 ? "" : "s"} missing it`,
    }));
  }

  if (split.unnamedShare) {
    candidates.push(upgradeEntry({
      id: UPGRADE_IDS.ORG_MAPPING, kind: "coverage", currentShare: measured,
      gainShare: split.unnamedShare,
      label: "Add an org mapping file covering the grouping values it does not yet name",
    }));
  } else if (inputState === INPUT_STATES.PROVIDER_PLUS_GROUPING) {
    // The export groups every row by its own labels. An org mapping is a
    // precision upgrade here, exactly as the policy says, so it is offered as
    // one instead of being dressed up as coverage.
    candidates.push(upgradeEntry({
      id: UPGRADE_IDS.ORG_MAPPING, kind: "precision", currentShare: measured,
      gainShare: 0,
      label: "Add an org mapping file to name these units the way your org does",
    }));
  }

  const ranked = candidates
    .filter((entry) => entry.kind === "precision" || entry.gainShare > 0)
    .sort((left, right) => right.gainShare - left.gainShare
      || UPGRADE_ORDER.indexOf(left.id) - UPGRADE_ORDER.indexOf(right.id));
  const top = ranked.find((entry) => entry.kind === "coverage") ?? null;
  return Object.freeze({
    top,
    rest: Object.freeze(ranked.filter((entry) => entry !== top)),
    all: Object.freeze(ranked),
  });
}

// ---------------------------------------------------------------------------
// Announcing a change
// ---------------------------------------------------------------------------

/** How many categories moved to, or away from, full confidence. */
export function confidenceMovement(previous, next) {
  const before = classifyFindings(previous?.inputState, previous?.share ?? null);
  const after = classifyFindings(next?.inputState, next?.share ?? null);
  let upgraded = 0;
  let downgraded = 0;
  for (const category of Object.values(FINDING_CATEGORIES)) {
    const was = before[category]?.confidence;
    const now = after[category]?.confidence;
    if (was === now) continue;
    if (now === CONFIDENCE.FULL) upgraded += 1;
    else if (was === CONFIDENCE.FULL) downgraded += 1;
  }
  return Object.freeze({ upgraded, downgraded });
}

/**
 * The polite sentence spoken when coverage recalculates. Null when nothing a
 * reader would care about moved — a live region that fires on every re-render
 * teaches a screen-reader user to tune it out.
 */
export function coverageChangeAnnouncement({ previous = null, next = null } = {}) {
  if (!previous || !next) return null;
  const before = coveragePercentText(previous.share);
  const after = coveragePercentText(next.share);
  if (before === null || after === null) return null;
  const movement = confidenceMovement(previous, next);
  if (before === after && !movement.upgraded && !movement.downgraded) return null;
  const delta = Number(next.share) - Number(previous.share);
  const direction = delta > 0 ? "increased" : delta < 0 ? "decreased" : "changed";
  const head = before === after
    ? `Coverage is unchanged at ${after}.`
    : `Coverage ${direction} from ${before} to ${after}.`;
  const plural = (count) => (count === 1 ? "finding" : "findings");
  if (movement.upgraded) {
    return `${head} ${movement.upgraded} ${plural(movement.upgraded)} upgraded to full confidence.`;
  }
  if (movement.downgraded) {
    return `${head} ${movement.downgraded} ${plural(movement.downgraded)} no longer read at full confidence.`;
  }
  return head;
}

/**
 * Everything the four surfaces need, assembled once. A caller paints from this
 * and nothing else, so the KPI row and the findings list cannot drift into
 * disagreeing about the same import.
 */
export function coverageModel({
  inputState = null, share = null, lineItems = [], knownGroups = null,
} = {}) {
  if (!inputState) return null;
  return Object.freeze({
    version: CONFIDENCE_TREATMENT_VERSION,
    inputState,
    share: share === null || share === undefined ? null : Number(share),
    coverageText: coveragePercentText(share),
    surfaces: Object.freeze(Object.fromEntries(Object.values(SURFACES)
      .map((surface) => [surface, surfaceConfidence(surface, inputState, share)]))),
    upgrade: rankedCoverageUpgrades({ inputState, lineItems, knownGroups, share }),
  });
}
