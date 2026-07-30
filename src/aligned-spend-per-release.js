/**
 * Period-aligned recorded AI spend per shipped release, and its movement against
 * the one previous comparable window.
 *
 * THE ONE QUESTION THIS ANSWERS
 *
 *     Over one reporting window, how much recorded AI spend was there per
 *     shipped release, and how did that figure move against the window
 *     immediately before it that is comparable to it?
 *
 * WHY THIS EXISTS BESIDE `spend-per-delivery.js`
 *
 * That contract publishes one headline ratio and compares it against the *mean*
 * of every earlier period that clears its floor. That is the right baseline for
 * "is this month unusual for us", and it is the wrong one for "did this move
 * since last month": a mean over four windows of four different lengths cannot
 * answer a question about two windows. This module answers only the paired
 * question, and it answers it under a stricter alignment rule — the two windows
 * must abut and must be the same number of days long — so that a difference in
 * window length can never be part of the movement it reports.
 *
 * It reuses that contract's floors, framing, confounders, and required
 * provenance fields rather than declaring second copies. Two modules with two
 * definitions of "enough releases" would be two policies, and a reader would
 * have no way to know which one produced the number in front of them.
 *
 * WHAT IT REFUSES TO SAY. Both sides are counts of records: dollars a provider
 * export billed, releases a person wrote down. Nothing here establishes that the
 * spend produced the releases, that a release is a quantity of work, or that a
 * direction is good or bad. `FRAMING` and `CONFOUNDERS` travel from the source
 * contract for exactly that reason, and `ALIGNED_SPEND_PER_RELEASE_CAVEATS` adds
 * the two limits that belong to a *two-point* comparison specifically.
 *
 * LOCALITY. Pure. No fetch, storage, clock, randomness, or credential path.
 * Nothing is persisted: the input is values already parsed in the tab, no
 * imported record and no prompt text is retained, and every output is frozen.
 * There is no `generatedAt` stamp, because the same input must always produce a
 * byte-identical record.
 */

import {
  CONFIDENCE_LEVELS, CONFOUNDERS, FRAMING, MAXIMUM_SPEND_USD, MINIMUM_DELIVERIES,
  MINIMUM_PERIOD_DAYS, REQUIRED_PROVENANCE_FIELDS, SUPPORTED_CURRENCY,
} from "./spend-per-delivery.js";

export const ALIGNED_SPEND_PER_RELEASE_SCHEMA_VERSION = "aligned-spend-per-release/1.0.0";

export const ALIGNED_SPEND_PER_RELEASE_QUESTION =
  "Over one reporting window, how much recorded AI spend was there per shipped release,"
  + " and how did that move against the previous comparable window?";

export const ALIGNED_SPEND_PER_RELEASE_UNIT =
  "USD of recorded AI spend per release recorded as shipped";

/** Re-exported so a consumer reads one floor, not two. */
export const MINIMUM_RELEASES_IN_WINDOW = MINIMUM_DELIVERIES;
export const MINIMUM_WINDOW_DAYS = MINIMUM_PERIOD_DAYS;

export const ALIGNED_SPEND_PER_RELEASE_STATE = Object.freeze({
  /** A per-release figure is published for the current window. */
  eligible: "eligible",
  /** One side of the current window does not clear a floor. */
  insufficient: "insufficient_data",
  /** Both windows carry records, and the two cannot be compared as a pair. */
  mismatched: "mismatched_window",
  /** Nothing was read in this tab. The caller leaves its surface as it was. */
  absent: "absent",
});

/** Checked in this order; the first failing predicate names the reason. */
export const ALIGNED_INSUFFICIENT_REASONS = Object.freeze([
  "no_spend_period",
  "missing_current_period_spend",
  "implausible_current_period_spend",
  "no_releases_in_current_period",
  "short_reporting_window",
  "too_few_releases_in_current_period",
]);

/** Checked in this order, ahead of every insufficiency but the spend ones. */
export const ALIGNED_MISMATCH_REASONS = Object.freeze([
  "overlapping_reporting_windows",
  "non_contiguous_reporting_windows",
  "unequal_reporting_window_lengths",
]);

/** Why no movement is published. Checked in this order. */
export const ALIGNED_TREND_UNAVAILABLE_REASONS = Object.freeze([
  "no_published_figure",
  "no_prior_period",
  "missing_prior_period_spend",
  "no_releases_in_prior_period",
  "too_few_releases_in_prior_period",
  "zero_prior_spend_per_release",
]);

/**
 * The limits that belong to a paired reading specifically. The source contract's
 * `FRAMING` and `CONFOUNDERS` are carried on every record beside these and are
 * not repeated here.
 */
export const ALIGNED_SPEND_PER_RELEASE_CAVEATS = Object.freeze([
  "This is a two-point comparison between two adjacent windows. It inherits the noise of"
  + " both of them, and two readings are not a trend line however far apart they sit.",
  "Nothing is held constant between the two windows except where they sit in the calendar:"
  + " release cadence, scope, team size, provider prices, and model mix all differ between"
  + " them, and each of those moves this figure on its own.",
  "A movement in this figure describes two pairs of recorded counts. It is not evidence"
  + " that either count moved the other, in either direction.",
]);

/**
 * How a pair earned the right to be compared. Two answers, and the second is a
 * concession to how provider billing actually arrives.
 *
 * `equal_length` is the clean case. `calendar_month` exists because a provider
 * bills by calendar month, so the windows a FinOps reader has are 28, 30, and 31
 * days long and would never be exactly equal. Refusing those would make this
 * comparison unusable on the only exports anyone has. The residual difference —
 * at most three days, under 11% of a month — is published as
 * `alignment.lengthDifferenceDays` and carried as a caveat, so it is disclosed
 * rather than either hidden or treated as a reason to say nothing.
 */
export const ALIGNMENT_BASES = Object.freeze(["equal_length", "calendar_month"]);

/**
 * Every rule, in prose, keyed. The module is the authority;
 * `docs/aligned-spend-per-release-contract.md` carries the same text for a reader
 * who is not reading code, and a test pins the two together.
 */
export const ALIGNED_SPEND_PER_RELEASE_RULES = Object.freeze({
  window:
    "A reporting window is the half-open interval [periodStart, periodEnd): start inclusive,"
    + " end exclusive, both YYYY-MM-DD in UTC, which is the interval the provider-export"
    + " contract already uses. Length in days is (periodEnd - periodStart) and must be a"
    + " positive whole number.",
  selection:
    "Windows are sorted ascending by periodStart, ties by periodEnd, then by exportId, which"
    + " makes the order total. The current window is the LAST one. The candidate prior window"
    + " is the one immediately before it and nothing else: no search is made for an older"
    + " window that would compare more favourably, because a metric that picks its own"
    + " baseline is a metric that can be steered.",
  comparability:
    "The candidate prior window is comparable only when it abuts the current one"
    + " (prior periodEnd == current periodStart) and either covers the same number of days"
    + " (alignment basis equal_length) or is a whole calendar month beside another whole"
    + " calendar month (basis calendar_month, because provider billing arrives by month and"
    + " months are 28 to 31 days long). Any other difference in length, an overlap, or a gap"
    + " is reported as mismatched_window with the reason naming which of the three it was;"
    + " the candidate is then not a compared window and no movement is published."
    + " A calendar-month pair publishes alignment.lengthDifferenceDays and carries it as an"
    + " extra caveat, because up to three days of difference moves a per-release figure on"
    + " its own and this contract does not remove it.",
  counts:
    "Releases counted in a window are the records whose completion instant falls in"
    + " [periodStart, periodEnd). Only records the caller supplies as shipped are counted;"
    + " a record whose completion date cannot be parsed is excluded and counted in"
    + " exclusions.unreadableReleaseDates rather than silently dropped.",
  figure:
    "spendPerReleaseUsd = window spend / releases in that window, rounded half away from zero"
    + " to 2 decimals. It is published for the current window only in the eligible state, and"
    + " for the prior window only when that window clears the same floors. Every other state"
    + " publishes null, never 0. periodSpendUsd and shippedReleases are published in every"
    + " state, because they are facts about what was read and not conclusions.",
  eligibility:
    "Checked in this exact order, first match wins: (1) nothing read at all -> absent;"
    + " (2) no reporting window read -> insufficient_data/no_spend_period; (3) current window"
    + " spend not a finite positive number -> insufficient_data/missing_current_period_spend;"
    + " (4) current window spend above the supported display ceiling ->"
    + " insufficient_data/implausible_current_period_spend; (5) the two windows overlap ->"
    + " mismatched_window/overlapping_reporting_windows; (6) a gap between them ->"
    + " mismatched_window/non_contiguous_reporting_windows; (7) they differ in length ->"
    + " mismatched_window/unequal_reporting_window_lengths; (8) no shipped release inside the"
    + " current window -> insufficient_data/no_releases_in_current_period; (9) current window"
    + " shorter than MINIMUM_WINDOW_DAYS -> insufficient_data/short_reporting_window;"
    + " (10) fewer than MINIMUM_RELEASES_IN_WINDOW releases in the current window ->"
    + " insufficient_data/too_few_releases_in_current_period; otherwise eligible."
    + " Order matters: a pair that cannot be aligned is reported as a mismatch even when the"
    + " current window is also too short or empty, because re-exporting a longer window does"
    + " not make an unalignable pair comparable. A missing spend total is reported ahead of"
    + " the mismatch, because there is no figure to align in the first place.",
  trend:
    "deltaUsd = current spend per release - prior spend per release, 2 decimals."
    + " deltaPercent = deltaUsd / prior x 100, 1 decimal, half away from zero, so a rise and"
    + " a fall of the same magnitude round identically. direction is read off the ROUNDED"
    + " percentage (> 0 higher, < 0 lower, == 0 level) so the word and the number can never"
    + " disagree. Movement is published only when the state is eligible and the prior window"
    + " clears the same floors as the current one and its figure is not zero; otherwise"
    + " available is false with a reason from ALIGNED_TREND_UNAVAILABLE_REASONS."
    + " 'higher' means spend per recorded release rose. Neither direction is labelled good"
    + " or bad.",
  exclusions:
    "exclusions.releasesOutsideComparedWindows is computed independently of the state and of"
    + " the movement, by checking every parsed release against every compared window. When"
    + " the current window holds no release and the prior window is comparable, the prior"
    + " window's releases are inside the compared windows and are NOT counted as outside"
    + " them: the pair that was selected is what a release is checked against, not the pair"
    + " that happened to produce a figure.",
  confidence:
    "Exactly one level from CONFIDENCE_LEVELS, first match wins: none when no figure was"
    + " published; low when any REQUIRED_PROVENANCE_FIELDS entry is missing, because part of"
    + " the basis was never checked; medium when a compared window declares completeness"
    + " other than 'complete', or when no movement is published; high otherwise. Confidence"
    + " describes the comparison, not the size of the figure.",
  locality:
    "Pure. No fetch, storage, clock, randomness, or credential path, and nothing is retained:"
    + " no imported record, no line item, and no prompt text is copied into the result or kept"
    + " after it is returned.",
});

export class AlignedSpendPerReleaseError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "AlignedSpendPerReleaseError";
    this.path = path;
  }
}

const invalid = (path, message) => {
  throw new AlignedSpendPerReleaseError(path, message);
};

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const DAY_MS = 86_400_000;

/** The one rounding rule, half away from zero, as in the source contract. */
function round(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const magnitude = Math.round(Math.abs(value) * factor) / factor;
  return value < 0 ? -magnitude : magnitude;
}

const dayStart = (date) => Date.parse(`${date}T00:00:00Z`);

const positive = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const money = (value) => value.toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function readWindow(entry, index) {
  const path = `spendPeriods[${index}]`;
  if (entry === null || typeof entry !== "object") invalid(path, "must be an object.");
  if (!DATE_PATTERN.test(entry.periodStart ?? "")) {
    invalid(`${path}.periodStart`, "must be YYYY-MM-DD.");
  }
  if (!DATE_PATTERN.test(entry.periodEnd ?? "")) {
    invalid(`${path}.periodEnd`, "must be YYYY-MM-DD.");
  }
  const days = (dayStart(entry.periodEnd) - dayStart(entry.periodStart)) / DAY_MS;
  if (!Number.isInteger(days) || days <= 0) {
    invalid(`${path}.periodEnd`, "must be a whole number of days after periodStart.");
  }
  if (entry.spendUsd !== null && entry.spendUsd !== undefined
    && typeof entry.spendUsd !== "number") {
    invalid(`${path}.spendUsd`, "must be a number or null.");
  }
  return Object.freeze({
    periodStart: entry.periodStart,
    periodEnd: entry.periodEnd,
    days,
    spendUsd: typeof entry.spendUsd === "number" ? entry.spendUsd : null,
    exportId: typeof entry.exportId === "string" ? entry.exportId : null,
    completeness: typeof entry.completeness === "string" ? entry.completeness : null,
  });
}

/**
 * Read the input. Malformed *shape* throws — a caller passing the wrong type is a
 * defect, not a reading. Unusable *data* never throws: it comes back as a state
 * with a reason code, because that is the answer a reader has to act on.
 *
 * The accepted shape is exactly what `spendPerDeliveryInput` already builds, so
 * the page assembles one input and derives both records from it.
 */
function readInput(input) {
  if (input === null || typeof input !== "object") invalid("input", "must be an object.");
  if (!Array.isArray(input.spendPeriods)) invalid("spendPeriods", "must be an array.");
  if (!Array.isArray(input.deliveries)) invalid("deliveries", "must be an array.");
  const windows = input.spendPeriods.map(readWindow).sort((left, right) =>
    left.periodStart.localeCompare(right.periodStart)
    || left.periodEnd.localeCompare(right.periodEnd)
    || String(left.exportId).localeCompare(String(right.exportId)));
  const releases = [];
  let unreadable = 0;
  input.deliveries.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      invalid(`deliveries[${index}]`, "must be an object.");
    }
    const at = Date.parse(entry.completedAt ?? "");
    // Excluded and counted, never silently dropped: a release nobody can date is
    // a gap in the denominator and the reader is told how many there were. The
    // record itself is not carried forward — only the count.
    if (Number.isNaN(at)) unreadable += 1;
    else releases.push(at);
  });
  const provenance = input.provenance ?? {};
  return {
    windows,
    releases: Object.freeze(releases),
    unreadable,
    provenance: {
      source: typeof provenance.source === "string"
        ? provenance.source : "unstated local source",
      origin: provenance.origin === "example" ? "example" : "import",
      declared: new Set(Array.isArray(provenance.derivedFromFields)
        ? provenance.derivedFromFields.filter((field) => typeof field === "string") : []),
    },
  };
}

const inWindow = (at, window) =>
  at >= dayStart(window.periodStart) && at < dayStart(window.periodEnd);

const countIn = (releases, window) =>
  releases.filter((at) => inWindow(at, window)).length;

/** A whole calendar month: both ends land on the first, one month apart. */
const FIRST_OF_MONTH = /^\d{4}-\d{2}-01$/;
const wholeCalendarMonth = (window) =>
  FIRST_OF_MONTH.test(window.periodStart) && FIRST_OF_MONTH.test(window.periodEnd)
  && window.days >= 28 && window.days <= 31;

/**
 * Why the candidate prior window is not comparable to the current one, or null.
 *
 * Every answer is about the pair and never about one window alone, which is why
 * they are decided here rather than on the eligibility ladder.
 */
function comparability(candidate, current) {
  if (!candidate) return null;
  if (candidate.periodEnd > current.periodStart) return "overlapping_reporting_windows";
  if (candidate.periodEnd < current.periodStart) return "non_contiguous_reporting_windows";
  if (candidate.days === current.days) return null;
  if (wholeCalendarMonth(candidate) && wholeCalendarMonth(current)) return null;
  return "unequal_reporting_window_lengths";
}

/** The basis a compared pair was accepted on, and what it does not remove. */
function alignmentOf(prior, current, rejected) {
  if (!prior) {
    return {
      basis: null,
      lengthDifferenceDays: null,
      note: rejected
        ? "No pair was formed: the window before the current one is not comparable to it"
          + ` (${rejected.replace(/_/g, " ")}).`
        : "No pair was formed, because only one billing window has been read.",
    };
  }
  const difference = Math.abs(current.days - prior.days);
  if (difference === 0) {
    return {
      basis: "equal_length",
      lengthDifferenceDays: 0,
      note: `Both windows cover ${current.days} days, so window length is held constant`
        + " across the pair.",
    };
  }
  return {
    basis: "calendar_month",
    lengthDifferenceDays: difference,
    note: `The two windows are adjacent calendar months of ${prior.days} and ${current.days}`
      + ` days. The shorter one covers ${difference} fewer day${difference === 1 ? "" : "s"} of`
      + " spend and of release cadence, which moves a per-release figure on its own. This"
      + " contract discloses that difference and does not adjust for it.",
  };
}

/** One action per reachable reason, so the same input always names the same step. */
const NEXT_ACTIONS = Object.freeze({
  no_spend_period: {
    text: "Select a provider billing export for the window you want to compare.",
    owner: "FinOps lead",
    why: "There is no window to align releases to until one export has been read.",
  },
  missing_current_period_spend: {
    text: "Select a provider billing export that reports a spend total for the latest window.",
    owner: "FinOps lead",
    why: "The figure is the spend a provider export reports; nothing here estimates it.",
  },
  implausible_current_period_spend: {
    text: "Inspect the provider export and correct the billing total before comparing it.",
    owner: "FinOps lead",
    why: "The reported total is outside the supported display range, so publishing a figure"
      + " would make an implausible input look decision-ready.",
  },
  overlapping_reporting_windows: {
    text: "Keep one billing export per window and remove the overlapping one.",
    owner: "FinOps lead",
    why: "Overlapping windows count the same days of spend in both halves of the pair.",
  },
  non_contiguous_reporting_windows: {
    text: "Add the missing billing window, or select two consecutive windows.",
    owner: "FinOps lead",
    why: "The gap holds spend and releases that neither half of the pair accounts for.",
  },
  unequal_reporting_window_lengths: {
    text: "Select two billing windows that cover the same number of days.",
    owner: "FinOps lead",
    why: "A per-release figure over 30 days and one over 7 differ by window length alone,"
      + " so the movement between them would not be a movement in the figure.",
  },
  no_releases_in_current_period: {
    text: "Record the releases that shipped inside the latest billing window in the release log.",
    owner: "Engineering lead",
    href: "/release.html",
    why: "With no release inside the window there is nothing to divide the spend by, so no"
      + " figure and no movement can be published for it.",
  },
  short_reporting_window: {
    text: `Re-export billing for two windows of at least ${MINIMUM_WINDOW_DAYS} days each.`,
    owner: "FinOps lead",
    why: "A shorter window moves by a large factor on the timing of a single release.",
  },
  too_few_releases_in_current_period: {
    text: "Record the releases that shipped inside this billing window, or compare a window"
      + ` that contains at least ${MINIMUM_RELEASES_IN_WINDOW} of them.`,
    owner: "Engineering lead",
    href: "/release.html",
    why: "A per-release figure over one or two releases describes those releases rather than"
      + " the window.",
  },
  eligible: {
    text: "Check this movement against any known change in release cadence, scope, or provider"
      + " pricing between the two windows before acting on it.",
    owner: "Engineering lead",
    why: "Each of those moves the figure with no change in how much was recorded as shipped.",
  },
});

const REASON_SENTENCES = Object.freeze({
  no_spend_period: "No billing window has been read in this tab, so there is no aligned pair"
    + " to report.",
  missing_current_period_spend: "The latest billing window reports no spend total, so no"
    + " per-release figure is published for it.",
  implausible_current_period_spend: "The latest billing window reports a total above the"
    + " supported 1 trillion USD display range, so the figure is withheld for review.",
  overlapping_reporting_windows: "The two most recent billing windows overlap, so they cannot"
    + " be compared as a pair.",
  non_contiguous_reporting_windows: "The two most recent billing windows are not consecutive,"
    + " and the gap between them holds spend and releases neither window accounts for.",
  unequal_reporting_window_lengths: "The two most recent billing windows cover different"
    + " numbers of days, so a movement between them would report the difference in window"
    + " length rather than a movement in the figure.",
  no_releases_in_current_period: "No release is recorded as shipped inside the latest billing"
    + " window, so there is nothing to divide its spend by.",
  short_reporting_window: `The latest billing window is shorter than ${MINIMUM_WINDOW_DAYS}`
    + " days, which is too short to report per release.",
  too_few_releases_in_current_period: "Fewer than"
    + ` ${MINIMUM_RELEASES_IN_WINDOW} releases are recorded as shipped inside the latest`
    + " billing window, so a per-release figure would describe those releases rather than"
    + " the window.",
  nothing_read: "Nothing has been read in this tab yet.",
});

const windowRecord = (window, releases, ratio) => Object.freeze({
  window: window ? Object.freeze({
    start: window.periodStart, end: window.periodEnd, days: window.days,
  }) : null,
  // Facts about what was read, published in every state.
  periodSpendUsd: window && typeof window.spendUsd === "number"
    ? round(window.spendUsd, 2) : null,
  shippedReleases: releases,
  completeness: window?.completeness ?? null,
  // A conclusion, so published only where the state allows it.
  spendPerReleaseUsd: ratio,
});

/** The per-window figure, or null where the window does not clear the floors. */
function windowRatio(window, releases) {
  if (!window || !positive(window.spendUsd) || window.days < MINIMUM_WINDOW_DAYS) return null;
  if (releases < MINIMUM_RELEASES_IN_WINDOW) return null;
  return round(window.spendUsd / releases, 2);
}

function confidenceOf({ published, missingFields, trendAvailable, comparedWindows }) {
  if (!published) {
    return {
      level: "none",
      basis: "No per-release figure was published, so there is nothing to be confident about.",
    };
  }
  if (missingFields.length) {
    return {
      level: "low",
      basis: `Part of the basis was never checked: ${missingFields.join(", ")} did not back`
        + " this pair of figures.",
    };
  }
  const partial = comparedWindows.find((window) =>
    window.completeness && window.completeness !== "complete");
  if (partial) {
    return {
      level: "medium",
      basis: `Billing window ${partial.periodStart} declares completeness`
        + ` "${partial.completeness}", so the spend it reports may still move.`,
    };
  }
  if (!trendAvailable) {
    return {
      level: "medium",
      basis: "The figure rests on complete local records, and there is no comparable prior"
        + " window to measure a movement against yet.",
    };
  }
  const equalLength = comparedWindows[0]?.days === comparedWindows[1]?.days;
  return {
    level: "high",
    basis: equalLength
      ? "Both windows are complete local records, abut each other, and cover the same"
        + " number of days."
      : "Both windows are complete local records and are adjacent whole calendar months;"
        + " their difference in days remains disclosed as an alignment caveat.",
  };
}

/**
 * Derive the aligned pair for one set of local billing windows and shipped
 * release records.
 *
 * @param {object} input the shape `spendPerDeliveryInput` builds:
 *   `{ spendPeriods, deliveries, provenance }`.
 * @returns {object} a frozen record. Never throws on unusable data.
 */
export function alignedSpendPerRelease(input) {
  const { windows, releases, unreadable, provenance } = readInput(input);
  const missingFields = REQUIRED_PROVENANCE_FIELDS
    .filter((field) => !provenance.declared.has(field));

  const current = windows.at(-1) ?? null;
  const candidate = windows.length > 1 ? windows.at(-2) : null;
  const pairMismatch = comparability(candidate, current);
  // The prior window is the candidate only when the pair is comparable. A window
  // that failed comparability was considered and rejected, and calling it
  // "compared" afterwards would make the exclusion counts below untrue.
  const prior = pairMismatch ? null : candidate;

  // THE COMPARED WINDOWS, and the only definition of them. Ascending, so the
  // pair reads in the order it happened.
  const comparedWindows = Object.freeze([prior, current].filter(Boolean));
  const alignment = current ? alignmentOf(prior, current, pairMismatch) : {
    basis: null, lengthDifferenceDays: null,
    note: "No pair was formed, because no billing window has been read.",
  };

  // EXCLUSIONS, COMPUTED INDEPENDENTLY. Every parsed release is checked against
  // every compared window here, before any state or movement is known, so the
  // count cannot inherit a decision made further down. In particular: a current
  // window with no release and a comparable prior window that has some leaves
  // the prior window's releases INSIDE the compared windows — they were checked
  // against the pair that was selected, which does not depend on whether that
  // pair went on to produce a figure.
  const releasesInsideComparedWindows = releases.filter((at) =>
    comparedWindows.some((window) => inWindow(at, window))).length;
  const releasesOutsideComparedWindows = releases.length - releasesInsideComparedWindows;

  const currentReleases = current ? countIn(releases, current) : 0;
  const priorReleases = prior ? countIn(releases, prior) : 0;

  // The ladder, in the order ALIGNED_SPEND_PER_RELEASE_RULES.eligibility publishes.
  // Each rung names the state and the reason together, so no caller infers one
  // from the other.
  let state = ALIGNED_SPEND_PER_RELEASE_STATE.eligible;
  let reasonCode = null;
  if (!windows.length && !releases.length && unreadable === 0) {
    state = ALIGNED_SPEND_PER_RELEASE_STATE.absent;
    reasonCode = "nothing_read";
  } else if (!current) {
    state = ALIGNED_SPEND_PER_RELEASE_STATE.insufficient;
    reasonCode = "no_spend_period";
  } else if (!positive(current.spendUsd)) {
    state = ALIGNED_SPEND_PER_RELEASE_STATE.insufficient;
    reasonCode = "missing_current_period_spend";
  } else if (current.spendUsd > MAXIMUM_SPEND_USD) {
    state = ALIGNED_SPEND_PER_RELEASE_STATE.insufficient;
    reasonCode = "implausible_current_period_spend";
  } else if (pairMismatch) {
    state = ALIGNED_SPEND_PER_RELEASE_STATE.mismatched;
    reasonCode = pairMismatch;
  } else if (currentReleases === 0) {
    state = ALIGNED_SPEND_PER_RELEASE_STATE.insufficient;
    reasonCode = "no_releases_in_current_period";
  } else if (current.days < MINIMUM_WINDOW_DAYS) {
    state = ALIGNED_SPEND_PER_RELEASE_STATE.insufficient;
    reasonCode = "short_reporting_window";
  } else if (currentReleases < MINIMUM_RELEASES_IN_WINDOW) {
    state = ALIGNED_SPEND_PER_RELEASE_STATE.insufficient;
    reasonCode = "too_few_releases_in_current_period";
  }
  const published = state === ALIGNED_SPEND_PER_RELEASE_STATE.eligible;

  const currentRatio = published ? round(current.spendUsd / currentReleases, 2) : null;
  const priorRatio = published ? windowRatio(prior, priorReleases) : null;

  // Movement, and the reason there is none. Checked in the order
  // ALIGNED_TREND_UNAVAILABLE_REASONS declares.
  let trend = {
    available: false,
    reasonCode: "no_published_figure",
    deltaUsd: null,
    deltaPercent: null,
    direction: null,
    interpretation: "No movement is reported while the current figure itself is withheld.",
  };
  if (published && !prior) {
    // Reachable only with a single window read: a rejected candidate makes the
    // state mismatched, which is not published, so this branch never has to
    // explain a comparability failure.
    trend = { ...trend, reasonCode: "no_prior_period",
      interpretation: "Only one billing window has been read, so there is no previous window"
        + " to compare this figure against." };
  } else if (published) {
    if (!positive(prior.spendUsd)) {
      trend = { ...trend, reasonCode: "missing_prior_period_spend",
        interpretation: "The previous window reports no spend total, so no movement can be"
          + " reported against it." };
    } else if (priorReleases === 0) {
      trend = { ...trend, reasonCode: "no_releases_in_prior_period",
        interpretation: "No release is recorded as shipped inside the previous window, so it"
          + " has no per-release figure to compare against." };
    } else if (priorReleases < MINIMUM_RELEASES_IN_WINDOW) {
      trend = { ...trend, reasonCode: "too_few_releases_in_prior_period",
        interpretation: `Fewer than ${MINIMUM_RELEASES_IN_WINDOW} releases are recorded as`
          + " shipped inside the previous window, so its figure would describe those releases"
          + " rather than the window." };
    } else if (priorRatio === 0) {
      trend = { ...trend, reasonCode: "zero_prior_spend_per_release",
        interpretation: "The previous window's figure is zero, so a percentage movement"
          + " against it is undefined and none is shown." };
    } else {
      const deltaUsd = round(currentRatio - priorRatio, 2);
      const deltaPercent = round((deltaUsd / priorRatio) * 100, 1);
      const direction = deltaPercent > 0 ? "higher" : deltaPercent < 0 ? "lower" : "level";
      trend = {
        available: true,
        reasonCode: null,
        deltaUsd,
        deltaPercent,
        direction,
        interpretation: direction === "level"
          ? `Recorded AI spend per shipped release is level with the previous window at`
            + ` ${money(priorRatio)} USD.`
          : `Recorded AI spend per shipped release is ${money(Math.abs(deltaUsd))} USD`
            + ` ${direction} than the previous window's ${money(priorRatio)} USD:`
            + (direction === "higher"
              ? " recorded spend rose faster than recorded releases across the two windows."
              : " recorded releases rose faster than recorded spend across the two windows."),
      };
    }
  }

  const confidence = confidenceOf({
    published, missingFields, trendAvailable: trend.available, comparedWindows,
  });

  const statement = published
    ? `${money(currentRatio)} USD of recorded AI spend per shipped release:`
      + ` ${money(round(current.spendUsd, 2))} USD across ${currentReleases}`
      + ` release${currentReleases === 1 ? "" : "s"} recorded as shipped between`
      + ` ${current.periodStart} and ${current.periodEnd}.`
    : REASON_SENTENCES[reasonCode];

  const evidence = [
    current
      ? `Current window ${current.periodStart} to ${current.periodEnd} (${current.days} days,`
        + ` end exclusive): ${positive(current.spendUsd)
          ? `${money(round(current.spendUsd, 2))} USD reported` : "no spend reported"},`
        + ` ${currentReleases} release${currentReleases === 1 ? "" : "s"} recorded as shipped.`
      : "No billing window was read in this tab.",
    prior
      ? `Previous comparable window ${prior.periodStart} to ${prior.periodEnd}`
        + ` (${prior.days} days): ${positive(prior.spendUsd)
          ? `${money(round(prior.spendUsd, 2))} USD reported` : "no spend reported"},`
        + ` ${priorReleases} release${priorReleases === 1 ? "" : "s"} recorded as shipped.`
      : candidate
        ? `The window before this one (${candidate.periodStart} to ${candidate.periodEnd},`
          + ` ${candidate.days} days) is not comparable to it: ${pairMismatch}.`
        : "No earlier billing window was read, so no pair was formed.",
    `${releasesInsideComparedWindows} of ${releases.length} recorded release`
    + `${releases.length === 1 ? "" : "s"} fall inside the`
    + ` ${comparedWindows.length} compared window${comparedWindows.length === 1 ? "" : "s"};`
    + ` ${releasesOutsideComparedWindows} fall outside and are not counted.`,
    unreadable > 0
      ? `${unreadable} release record${unreadable === 1 ? "" : "s"} carried an unreadable`
        + " completion date and were excluded from both counts."
      : null,
    windows.length > 2
      ? `${windows.length} billing windows were read; this pair is the two most recent.`
      : null,
  ].filter(Boolean);

  const action = NEXT_ACTIONS[published ? "eligible" : reasonCode] ?? NEXT_ACTIONS.no_spend_period;

  return Object.freeze({
    schemaVersion: ALIGNED_SPEND_PER_RELEASE_SCHEMA_VERSION,
    question: ALIGNED_SPEND_PER_RELEASE_QUESTION,
    state,
    reasonCode,
    statement,
    metric: Object.freeze({
      currency: SUPPORTED_CURRENCY,
      unit: ALIGNED_SPEND_PER_RELEASE_UNIT,
      current: windowRecord(current, currentReleases, currentRatio),
      prior: windowRecord(prior, priorReleases, priorRatio),
    }),
    comparedWindows: Object.freeze(comparedWindows.map((window) => Object.freeze({
      start: window.periodStart, end: window.periodEnd, days: window.days,
    }))),
    alignment: Object.freeze(alignment),
    trend: Object.freeze(trend),
    confidence: Object.freeze(confidence),
    exclusions: Object.freeze({
      // Independent of state and of trend, by construction. See the rule.
      releasesOutsideComparedWindows,
      releasesInsideComparedWindows,
      unreadableReleaseDates: unreadable,
      windowsNotCompared: Math.max(windows.length - comparedWindows.length, 0),
      priorWindowRejectedReason: pairMismatch,
      rule: ALIGNED_SPEND_PER_RELEASE_RULES.exclusions,
    }),
    provenance: Object.freeze({
      source: provenance.source,
      origin: provenance.origin,
      declaredFields: Object.freeze([...provenance.declared].sort()),
      missingFields: Object.freeze(missingFields),
      complete: missingFields.length === 0,
      requiredFields: REQUIRED_PROVENANCE_FIELDS,
      retention: "Nothing read here is persisted: no imported record, line item, or prompt"
        + " text is retained, and this record holds counts, windows, and totals only.",
    }),
    framing: FRAMING,
    // The three standing caveats, plus the alignment note when the pair was
    // accepted on a basis that leaves a real difference in it. A caveat that only
    // sometimes applies is added when it applies rather than hedged always.
    caveats: alignment.lengthDifferenceDays > 0
      ? Object.freeze([...ALIGNED_SPEND_PER_RELEASE_CAVEATS, alignment.note])
      : ALIGNED_SPEND_PER_RELEASE_CAVEATS,
    confounders: CONFOUNDERS,
    confidenceScale: CONFIDENCE_LEVELS,
    nextAction: Object.freeze({ rank: 1, href: null, ...action }),
    evidence: Object.freeze(evidence),
  });
}
