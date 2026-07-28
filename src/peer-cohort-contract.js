// The peer-cohort benchmark contract.
//
// THE ONE QUESTION
// ----------------
//   "How do we compare with organizations like us?"
//
// This page has carried that question in a panel that could never answer it for
// a reader's own import: the only cohort on the page was the bundled seed's
// hand-authored percentile, and an import was told, correctly, that no cohort
// could be built from its own files. That refusal was honest and it was also
// permanent, which made the panel a question with no path to an answer.
//
// The path is published reference data. `peer-cohort-fixtures.js` ships a fixed
// set of synthetic cohorts; this module is the contract over them: which cohort
// applies to an organization, which metrics are comparable, what a percentile
// means when values tie, how confident the comparison is, and the single action
// that follows from it. An import is compared against the published cohort. It
// is never compared against the bundled seed's organization, and it never joins
// a cohort.
//
// WHAT IS DELIBERATELY NOT HERE
// -----------------------------
// * No cohort built from visitor data. A cohort a reader's import can move is a
//   cohort that carries the previous reader's import into this one.
// * No blended peer set. One cohort is selected and named; two cohorts averaged
//   is a comparison against a group that does not exist.
// * No second headline. Three metrics are published; exactly one of them —
//   the literacy score — decides whether the benchmark exists at all.
// * No ranked backlog. One prioritized action, by declared rank.
// * No storage, clock, network, credential, or DOM. Pure arithmetic over the
//   published fixtures and one organization roll-up handed in by the caller.

import {
  COHORT_FAMILY, PEER_COHORTS, PEER_COHORT_RUBRIC_VERSION, PEER_COHORT_SNAPSHOT_DATE,
} from "./peer-cohort-fixtures.js";

export { COHORT_FAMILY, PEER_COHORTS, PEER_INDUSTRY } from "./peer-cohort-fixtures.js";

/**
 * Bump this when a metric definition, a reason code, a label enum, a threshold,
 * an action rank, or any published fixture value changes. Every consumer
 * records the version it read.
 */
export const PEER_COHORT_VERSION = "finops-peer-cohort/1.0.0";

/**
 * What the cohorts are, stated once so the KPI note, the method note, and the
 * exported briefing cannot hold three versions of the same claim.
 */
export const PEER_COHORT_PROVENANCE = Object.freeze({
  label: "Published synthetic peer cohorts",
  statement: "Peer cohorts are published synthetic reference data authored in this repository. "
    + "They contain no customer, tenant, or provider data, and they are not derived from any "
    + "file imported by any visitor. Your import is compared against them; it never joins them.",
  version: PEER_COHORT_VERSION,
  snapshotDate: PEER_COHORT_SNAPSHOT_DATE,
  rubricVersion: PEER_COHORT_RUBRIC_VERSION,
});

/** A cohort below this many members is not published and is never selected. */
export const MIN_COHORT_MEMBERS = 8;

/** Members a cohort needs before the comparison is called anything but low. */
const CONFIDENT_COHORT_MEMBERS = 12;

// ---------------------------------------------------------------------------
// The metrics. Defined before any surface, precisely enough that two engineers
// compute them the same way.
// ---------------------------------------------------------------------------

/** Which way is good. Percentile is always "share of the cohort you beat". */
export const METRIC_DIRECTION = Object.freeze({
  higherIsBetter: "higher_is_better",
  lowerIsBetter: "lower_is_better",
});

/**
 * The three published benchmark metrics.
 *
 * `decimals` is the precision every value — the organization's and every
 * member's — is rounded to BEFORE anything is compared. Rounding first is what
 * makes a tie a fact rather than a floating-point accident, so two engineers
 * produce the same tie set and therefore the same percentile.
 */
export const PEER_METRICS = Object.freeze([
  Object.freeze({
    id: "literacy_score",
    field: "literacyScore",
    label: "AI literacy score",
    unit: "points (0-100)",
    decimals: 0,
    domain: Object.freeze({ min: 0, max: 100 }),
    direction: METRIC_DIRECTION.higherIsBetter,
    definition: "The prompt-literacy rubric's composite over the scored prompts of the "
      + "organization on screen, as an integer on a 0–100 scale. Comparable only against a "
      + "cohort published under the same rubric version.",
  }),
  Object.freeze({
    id: "high_value_share",
    field: "highValueShare",
    label: "High-value share of the spend mix",
    unit: "share of scored prompts",
    decimals: 4,
    domain: Object.freeze({ min: 0, max: 1 }),
    direction: METRIC_DIRECTION.higherIsBetter,
    definition: "Scored prompts the rubric classified high value, divided by all scored "
      + "prompts, in [0,1]. A query mix, not a dollar mix: a query sample carries no "
      + "per-query cost.",
  }),
  Object.freeze({
    id: "recoverable_share",
    field: "recoverableShare",
    label: "Recoverable share of observed spend",
    unit: "share of USD",
    decimals: 4,
    domain: Object.freeze({ min: 0, max: 1 }),
    // A large recoverable share is a large amount of avoidable spend still on
    // the invoice. Being high on this metric is being behind on it.
    direction: METRIC_DIRECTION.lowerIsBetter,
    definition: "The disclosed down-routing scenario in USD divided by observed spend in USD, "
      + "over the same period and the same attributed rows, in [0,1]. A scenario, never a "
      + "realized saving.",
  }),
]);

/** The metric the benchmark exists for. Without it there is no comparison. */
export const HEADLINE_METRIC_ID = "literacy_score";

const METRIC_BY_ID = Object.freeze(Object.fromEntries(
  PEER_METRICS.map((metric) => [metric.id, metric])));

// ---------------------------------------------------------------------------
// Reason codes. Wire values: reword a sentence freely, changing a code is a
// version bump.
// ---------------------------------------------------------------------------

export const PEER_UNAVAILABLE_REASON = Object.freeze({
  /** Nothing in the analysis says how big the organization is or what it does. */
  noSegmentInput: "no_peer_segment_input",
  /** Segment inputs were read and fall outside every published cohort's band. */
  noMatchingCohort: "no_matching_peer_cohort",
  /** The organization's rubric differs from the cohort's; scores are not comparable. */
  rubricMismatch: "peer_rubric_version_mismatch",
  /** A cohort applies and the organization published no comparable headline value. */
  noComparableMetric: "no_comparable_peer_metric",
  /** The organization's value for one metric is absent or outside its domain. */
  missingValue: "no_organization_metric_value",
  /** The cohort publishes fewer than the declared member floor for one metric. */
  belowMemberFloor: "peer_cohort_below_member_floor",
});

const UNAVAILABLE_COPY = Object.freeze({
  [PEER_UNAVAILABLE_REASON.noSegmentInput]: Object.freeze({
    needLabel: "An org unit column that joins your roster",
    need: "Nothing in this import says how large the organization is. Map `org_unit_id` so at "
      + "least one org unit is attributed; organization size is counted in attributed org "
      + "units, not in employees.",
  }),
  [PEER_UNAVAILABLE_REASON.noMatchingCohort]: Object.freeze({
    needLabel: "An organization inside a published cohort band",
    need: "This organization's segment falls outside every published cohort band, so there is "
      + "no comparable group to compare it against. No import can close this gap; the bands "
      + "are published reference data.",
  }),
  [PEER_UNAVAILABLE_REASON.rubricMismatch]: Object.freeze({
    needLabel: "A grade computed under the published rubric version",
    need: `This score was computed under a different rubric than the cohort's `
      + `(${PEER_COHORT_RUBRIC_VERSION}). Two rubrics produce two scales, and a percentile `
      + "across them would be arithmetic without a meaning.",
  }),
  [PEER_UNAVAILABLE_REASON.noComparableMetric]: Object.freeze({
    needLabel: "A graded query sample",
    need: "A cohort applies to this organization and the import published no literacy score to "
      + "place inside it. Add a query sample export so the rubric can grade this import.",
  }),
  [PEER_UNAVAILABLE_REASON.missingValue]: Object.freeze({
    needLabel: "The metric's own input",
    need: "This import published no value for this metric, so there is nothing to place inside "
      + "the cohort.",
  }),
  [PEER_UNAVAILABLE_REASON.belowMemberFloor]: Object.freeze({
    needLabel: "A published cohort at or above the member floor",
    need: `The selected cohort publishes fewer than ${MIN_COHORT_MEMBERS} members carrying this `
      + "metric, so a percentile over it would be a rank dressed as a distribution.",
  }),
});

function unavailable(reason, detail = null) {
  const copy = UNAVAILABLE_COPY[reason];
  return Object.freeze({
    reason, needLabel: copy.needLabel, need: copy.need, detail,
  });
}

// ---------------------------------------------------------------------------
// Comparability and confidence. Two labels, two rules, both stated.
// ---------------------------------------------------------------------------

/** How like this organization the cohort is. */
export const COMPARABILITY = Object.freeze({
  /** The cohort constrains industry AND organization size, and both were declared. */
  close: "close",
  /** The cohort constrains organization size only. */
  broad: "broad",
  /** No cohort applies. Published so an unavailable result still carries a label. */
  none: "none",
});

export const COMPARABILITY_LABEL = Object.freeze({
  [COMPARABILITY.close]: "Close match · same industry and size band",
  [COMPARABILITY.broad]: "Broad match · same size band, any industry",
  [COMPARABILITY.none]: "No comparable cohort",
});

/** How much weight the comparison carries. */
export const PEER_CONFIDENCE = Object.freeze({ high: "high", medium: "medium", low: "low" });

export const PEER_CONFIDENCE_LABEL = Object.freeze({
  [PEER_CONFIDENCE.high]: "High confidence",
  [PEER_CONFIDENCE.medium]: "Medium confidence",
  [PEER_CONFIDENCE.low]: "Low confidence",
});

/**
 * The confidence rule, in full: a close match over a cohort at or above the
 * confident-member count is high; anything else at or above that count is
 * medium; everything else that cleared the published floor is low.
 */
export function peerConfidenceFor(comparability, memberCount) {
  if (memberCount >= CONFIDENT_COHORT_MEMBERS) {
    return comparability === COMPARABILITY.close ? PEER_CONFIDENCE.high : PEER_CONFIDENCE.medium;
  }
  return PEER_CONFIDENCE.low;
}

// ---------------------------------------------------------------------------
// Percentile and quartile. Ties are decided here, once.
// ---------------------------------------------------------------------------

const roundTo = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Where one value sits inside a cohort, as an integer percentile in [0,100].
 *
 * THE TIE RULE. Members strictly better than the organization do not count;
 * members strictly worse count as one; members EQUAL to it count as one half.
 * That is the mid-rank convention, and it is chosen because it is the only one
 * that puts an organization at exactly 50 when it equals every member of its
 * cohort — the two neighbouring conventions would report 0 or 100 for a result
 * that is, by construction, average.
 *
 * Both sides are rounded to the metric's declared precision before comparison,
 * so a tie is a tie for every engineer computing it.
 *
 * The result is rounded half-up to a whole percentile and clamped to [0,100].
 */
export function percentileWithin(values, value, direction, decimals = 0) {
  const rounded = roundTo(value, decimals);
  const members = values.map((entry) => roundTo(entry, decimals));
  if (!members.length) return null;
  const worse = members.filter((entry) => (direction === METRIC_DIRECTION.higherIsBetter
    ? entry < rounded : entry > rounded)).length;
  const equal = members.filter((entry) => entry === rounded).length;
  const raw = ((worse + equal / 2) / members.length) * 100;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/**
 * The cohort's median, for the gap sentence beside the percentile.
 *
 * Even member counts take the mean of the two middle values, rounded once to
 * the metric's declared precision. Sorting is ascending on the raw value in
 * every case; direction does not reorder a median.
 */
export function medianOf(values, decimals = 0) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 1
    ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return roundTo(raw, decimals);
}

/** The four quartile bands, named. */
export const QUARTILE = Object.freeze({
  top: "top_quartile",
  second: "second_quartile",
  third: "third_quartile",
  bottom: "bottom_quartile",
});

export const QUARTILE_LABEL = Object.freeze({
  [QUARTILE.top]: "Top quartile",
  [QUARTILE.second]: "Second quartile",
  [QUARTILE.third]: "Third quartile",
  [QUARTILE.bottom]: "Bottom quartile",
});

/**
 * Percentile to quartile. Every band is closed at its lower edge and open at
 * its upper one, so 25, 50 and 75 each belong to exactly one band and there is
 * no percentile that two bands claim.
 */
export function quartileFor(percentile) {
  if (!Number.isFinite(percentile)) return null;
  if (percentile >= 75) return QUARTILE.top;
  if (percentile >= 50) return QUARTILE.second;
  if (percentile >= 25) return QUARTILE.third;
  return QUARTILE.bottom;
}

// ---------------------------------------------------------------------------
// Cohort selection.
// ---------------------------------------------------------------------------

const PUBLISHED = Object.freeze(PEER_COHORTS.filter(
  (entry) => entry.members.length >= MIN_COHORT_MEMBERS));

{
  const ids = new Set(PEER_COHORTS.map((entry) => entry.cohortId));
  if (ids.size !== PEER_COHORTS.length) {
    throw new Error("peer cohort contract: cohort ids must be unique");
  }
  if (PUBLISHED.length !== PEER_COHORTS.length) {
    throw new Error("peer cohort contract: every published cohort must clear the member floor");
  }
}

/** How many segment dimensions a cohort constrains. Selection prefers more. */
const specificity = (entry) => (entry.selector.industry === null ? 1 : 2);

/**
 * The one applicable cohort, or null.
 *
 * A cohort matches when the organization's attributed org-unit count is inside
 * its band AND — for an industry cohort — the organization declared that exact
 * industry. Candidates are ordered by specificity descending and then by
 * `cohortId` ascending; ids are unique, so the order is total and two engineers
 * select the same cohort from the same segment inputs.
 *
 * @param segment `{ orgUnits, industry }`. `orgUnits` is a positive integer;
 *   `industry` is a published key or null.
 */
export function selectPeerCohort(segment = {}) {
  const orgUnits = Number.isInteger(segment?.orgUnits) && segment.orgUnits > 0
    ? segment.orgUnits : null;
  if (orgUnits === null) return null;
  const industry = typeof segment?.industry === "string" && segment.industry ? segment.industry : null;
  const candidates = PUBLISHED.filter((entry) => {
    const band = entry.selector.orgUnits;
    if (orgUnits < band.min || orgUnits > band.max) return false;
    return entry.selector.industry === null || entry.selector.industry === industry;
  });
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => specificity(right) - specificity(left)
    || left.cohortId.localeCompare(right.cohortId))[0];
}

// ---------------------------------------------------------------------------
// The single prioritized action.
// ---------------------------------------------------------------------------

/**
 * The action candidates, highest priority first.
 *
 * `rank` is a unique integer, so selection is total and there is never a tie to
 * break. WHY THIS ORDER: a bottom-quartile literacy score is the only finding
 * here that says the work itself is the problem, so it outranks the two spend
 * findings. Recoverable share outranks high-value share because it is already
 * denominated in dollars on this period's invoice. `hold_position` is last
 * because it is only ever eligible when nothing above it is.
 */
export const PEER_ACTION_CANDIDATES = Object.freeze([
  Object.freeze({
    id: "close_literacy_gap", rank: 1, metricId: "literacy_score",
    accountableRole: "Platform Engineering Lead",
    trigger: "literacy percentile below the 25th",
  }),
  Object.freeze({
    id: "capture_recoverable_gap", rank: 2, metricId: "recoverable_share",
    accountableRole: "FinOps Data Owner",
    trigger: "recoverable share worse than the cohort median",
  }),
  Object.freeze({
    id: "raise_high_value_share", rank: 3, metricId: "high_value_share",
    accountableRole: "Platform Engineering Lead",
    trigger: "high-value share worse than the cohort median",
  }),
  Object.freeze({
    id: "hold_position", rank: 4, metricId: HEADLINE_METRIC_ID,
    accountableRole: "Platform Engineering Lead",
    trigger: "no published metric sits below the cohort median",
  }),
]);

{
  const ranks = new Set(PEER_ACTION_CANDIDATES.map((entry) => entry.rank));
  if (ranks.size !== PEER_ACTION_CANDIDATES.length) {
    throw new Error("peer cohort contract: action ranks must be unique");
  }
  for (const entry of PEER_ACTION_CANDIDATES) {
    if (!METRIC_BY_ID[entry.metricId]) {
      throw new Error(`peer cohort contract: action "${entry.id}" names no declared metric`);
    }
  }
}

const gapText = (metric, comparison) => {
  const gap = Math.abs(roundTo(comparison.value - comparison.cohortMedian, metric.decimals));
  return metric.decimals === 0
    ? `${gap} ${metric.unit.replace(/\s*\(.*\)$/, "")}` : `${(gap * 100).toFixed(1)} points of share`;
};

/**
 * Select exactly one action from the comparable metrics.
 *
 * Every candidate is tested against its declared trigger; the eligible one with
 * the lowest rank wins. Ranks are unique, so there is no secondary comparator
 * and no tie-break. A benchmark that published no comparable metric gets no
 * action at all — a suggestion with no measurement under it is not an action.
 */
function selectAction(comparisons, cohort) {
  const by = (id) => comparisons.find((entry) => entry.metricId === id && entry.available);
  for (const candidate of [...PEER_ACTION_CANDIDATES].sort((left, right) => left.rank - right.rank)) {
    const comparison = by(candidate.metricId);
    if (!comparison) continue;
    const metric = METRIC_BY_ID[candidate.metricId];
    if (candidate.id === "close_literacy_gap" && comparison.percentile < 25) {
      return Object.freeze({
        available: true, id: candidate.id, rank: candidate.rank, metricId: candidate.metricId,
        accountableRole: candidate.accountableRole,
        text: `Raise prompt literacy first: this organization scores ${comparison.value} against a `
          + `median of ${comparison.cohortMedian} in ${cohort.label}, which is the bottom quartile `
          + "of the published cohort.",
        gap: gapText(metric, comparison),
      });
    }
    if (candidate.id === "capture_recoverable_gap" && comparison.percentile < 50) {
      return Object.freeze({
        available: true, id: candidate.id, rank: candidate.rank, metricId: candidate.metricId,
        accountableRole: candidate.accountableRole,
        text: "Work the recoverable spend first: more of this invoice is addressable by routing "
          + `than for half of ${cohort.label}. Closing to the cohort median would move `
          + `${gapText(metric, comparison)} of observed spend out of the recoverable scenario.`,
        gap: gapText(metric, comparison),
      });
    }
    if (candidate.id === "raise_high_value_share" && comparison.percentile < 50) {
      return Object.freeze({
        available: true, id: candidate.id, rank: candidate.rank, metricId: candidate.metricId,
        accountableRole: candidate.accountableRole,
        text: "Shift the query mix first: a smaller share of this organization's scored prompts is "
          + `high-value than for half of ${cohort.label}. The gap to the cohort median is `
          + `${gapText(metric, comparison)}.`,
        gap: gapText(metric, comparison),
      });
    }
    if (candidate.id === "hold_position") {
      return Object.freeze({
        available: true, id: candidate.id, rank: candidate.rank, metricId: candidate.metricId,
        accountableRole: candidate.accountableRole,
        text: `No published metric sits below the median of ${cohort.label}. Hold the current `
          + "routing and coaching plan; the next action for this organization comes from its own "
          + "spend findings, not from this comparison.",
        gap: null,
      });
    }
  }
  return Object.freeze({
    available: false, id: null, rank: null, metricId: null,
    accountableRole: null, text: null, gap: null,
  });
}

// ---------------------------------------------------------------------------
// The evaluation.
// ---------------------------------------------------------------------------

function comparisonFor(metric, organization, cohort) {
  const values = cohort.members
    .map((entry) => entry[metric.field])
    .filter((entry) => Number.isFinite(entry));
  const base = { metricId: metric.id, label: metric.label, unit: metric.unit,
    direction: metric.direction, definition: metric.definition };
  if (values.length < MIN_COHORT_MEMBERS) {
    return Object.freeze({ ...base, available: false, value: null, percentile: null,
      quartile: null, cohortMedian: null, memberCount: values.length,
      unavailable: unavailable(PEER_UNAVAILABLE_REASON.belowMemberFloor) });
  }
  const raw = organization?.[metric.field];
  const inDomain = Number.isFinite(raw) && raw >= metric.domain.min && raw <= metric.domain.max;
  if (!inDomain) {
    return Object.freeze({ ...base, available: false, value: null, percentile: null,
      quartile: null, cohortMedian: null, memberCount: values.length,
      unavailable: unavailable(PEER_UNAVAILABLE_REASON.missingValue,
        `${metric.label} must be a number in [${metric.domain.min}, ${metric.domain.max}].`) });
  }
  const value = roundTo(raw, metric.decimals);
  const percentile = percentileWithin(values, value, metric.direction, metric.decimals);
  return Object.freeze({
    ...base,
    available: true,
    value,
    percentile,
    quartile: quartileFor(percentile),
    quartileLabel: QUARTILE_LABEL[quartileFor(percentile)],
    cohortMedian: medianOf(values, metric.decimals),
    memberCount: values.length,
    unavailable: null,
  });
}

function unavailableResult(reason, { segment = null, cohort = null, detail = null } = {}) {
  return Object.freeze({
    version: PEER_COHORT_VERSION,
    available: false,
    question: PEER_QUESTION,
    answer: UNAVAILABLE_COPY[reason].need,
    cohort: cohort ? cohortSummary(cohort, COMPARABILITY.none) : null,
    segment: segment ? Object.freeze({ ...segment }) : null,
    comparability: COMPARABILITY.none,
    comparabilityLabel: COMPARABILITY_LABEL[COMPARABILITY.none],
    confidence: null,
    confidenceLabel: null,
    headline: null,
    comparisons: Object.freeze([]),
    action: null,
    provenance: PEER_COHORT_PROVENANCE,
    unavailable: unavailable(reason, detail),
  });
}

/** The question this contract answers. One, and it is not derived. */
export const PEER_QUESTION = "How do we compare with organizations like us?";

function cohortSummary(cohort, comparability) {
  return Object.freeze({
    cohortId: cohort.cohortId,
    family: cohort.family,
    label: cohort.label,
    segmentLabel: cohort.segmentLabel,
    memberCount: cohort.members.length,
    rubricVersion: cohort.rubricVersion,
    snapshotDate: cohort.snapshotDate,
    comparability,
  });
}

/**
 * Evaluate one organization against the published cohorts.
 *
 * @param input.organization the roll-up being compared:
 *   `{ literacyScore, highValueShare, recoverableShare, rubricVersion }`. Every
 *   field is optional; a missing one makes its metric unavailable with a reason
 *   rather than defaulting to zero.
 * @param input.segment `{ orgUnits, industry }` — the segment inputs that select
 *   a cohort. `orgUnits` counts attributed org units, not employees.
 * @returns a frozen result. `available` is the only branch a caller needs.
 */
export function evaluatePeerBenchmark({ organization = null, segment = null } = {}) {
  const inputs = Object.freeze({
    orgUnits: Number.isInteger(segment?.orgUnits) && segment.orgUnits > 0 ? segment.orgUnits : null,
    industry: typeof segment?.industry === "string" && segment.industry ? segment.industry : null,
  });
  if (inputs.orgUnits === null) {
    return unavailableResult(PEER_UNAVAILABLE_REASON.noSegmentInput, { segment: inputs });
  }
  const cohort = selectPeerCohort(inputs);
  if (!cohort) {
    return unavailableResult(PEER_UNAVAILABLE_REASON.noMatchingCohort, { segment: inputs });
  }
  // Comparability is decided by what the SELECTED cohort constrains, not by what
  // the caller declared: a reader who names an industry no cohort publishes is
  // compared broadly, and the label says broadly.
  const comparability = cohort.selector.industry === null
    ? COMPARABILITY.broad : COMPARABILITY.close;

  const rubric = organization?.rubricVersion ?? null;
  if (rubric !== null && rubric !== cohort.rubricVersion) {
    return unavailableResult(PEER_UNAVAILABLE_REASON.rubricMismatch,
      { segment: inputs, cohort, detail: `Import rubric ${rubric} · cohort rubric ${cohort.rubricVersion}.` });
  }

  const comparisons = Object.freeze(PEER_METRICS.map(
    (metric) => comparisonFor(metric, organization, cohort)));
  const headline = comparisons.find((entry) => entry.metricId === HEADLINE_METRIC_ID);
  if (!headline?.available) {
    return unavailableResult(PEER_UNAVAILABLE_REASON.noComparableMetric,
      { segment: inputs, cohort, detail: headline?.unavailable?.detail ?? null });
  }
  const confidence = peerConfidenceFor(comparability, cohort.members.length);
  return Object.freeze({
    version: PEER_COHORT_VERSION,
    available: true,
    question: PEER_QUESTION,
    answer: `${headline.value} points · ${QUARTILE_LABEL[headline.quartile]} of ${cohort.label} `
      + `(median ${headline.cohortMedian}).`,
    cohort: cohortSummary(cohort, comparability),
    segment: inputs,
    comparability,
    comparabilityLabel: COMPARABILITY_LABEL[comparability],
    confidence,
    confidenceLabel: PEER_CONFIDENCE_LABEL[confidence],
    /** The one figure the panel leads with. Every other metric is support. */
    headline,
    comparisons,
    action: selectAction(comparisons, cohort),
    provenance: PEER_COHORT_PROVENANCE,
    unavailable: null,
  });
}
