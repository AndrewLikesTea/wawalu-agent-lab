/**
 * Executable metric contract: recorded local AI spend per completed release.
 *
 * THE ONE QUESTION THIS ANSWERS
 *
 *     Is local AI spend keeping pace with shipped delivery, and can I trust
 *     this comparison?
 *
 * It is answered with a single figure — USD of recorded AI spend per completed
 * release over one spend period — compared against this browser's own trailing
 * baseline, and with the state of the comparison itself, because a leader who
 * cannot tell an eligible ratio from an unalignable one has no answer at all.
 *
 * WHAT THIS IS NOT, STRUCTURALLY AND NOT AS A DISCLAIMER
 *
 * The ratio is *observational*. Both figures are counts of things that were
 * recorded: dollars a provider export billed, releases a human wrote down. No
 * step below establishes that the spend produced the releases, that a release
 * is a unit of value, or that a lower ratio is better. So this module never
 * publishes return on investment, payback, productivity, efficiency gain, or
 * any causal verb — `FRAMING` states that once, every rendered state carries it,
 * and `CONFOUNDERS` lists the six reasons the ratio can move with no change in
 * how much was delivered. A consumer that reframes this figure as ROI is
 * misusing it; the contract makes that misuse visible rather than convenient.
 *
 * DELIBERATELY OUT OF SCOPE. Any peer, industry, or cohort benchmark (no
 * imported local contract carries one, so the only honest baseline is the
 * reader's own history); a forecast; a target; currency conversion; per-person
 * or per-team attribution; release size, scope, or quality; and any claim of
 * realized saving.
 *
 * LOCALITY. No fetch, storage, clock, randomness, or credential path. Every
 * input is a value already parsed in the tab; every output is frozen. The
 * `generatedAt`-style stamps other contracts carry are absent on purpose: this
 * module is pure, so the same inputs always produce the same record.
 */

export const SPEND_PER_DELIVERY_SCHEMA_VERSION = "spend-per-delivery/1.0.0";

/** The only currency comparable without an exchange-rate transfer. */
export const SUPPORTED_CURRENCY = "USD";

export const SPEND_PER_DELIVERY_QUESTION =
  "Is local AI spend keeping pace with shipped delivery, and can I trust this comparison?";

/** The unit, written once. It names both sides, so the figure cannot be relabelled. */
export const SPEND_PER_DELIVERY_UNIT = "USD of recorded AI spend per completed release";

export const SPEND_PER_DELIVERY_STATE = Object.freeze({
  /** A ratio is published, with a confidence and a comparison state. */
  eligible: "eligible",
  /** One side of the ratio does not clear the minimum-data floor. */
  insufficient: "insufficient_data",
  /** Both sides carry records, but they cannot be aligned to one window. */
  mismatched: "mismatched_period",
  /** Nothing has been read in this tab yet; the surface stays as it was. */
  absent: "absent",
});

/**
 * Minimum-data floors. Both are judgement calls, and both are stated as numbers
 * so two engineers apply the same one.
 *
 * Three releases, because a per-release mean over one or two releases is a
 * description of those releases and not of a period. Fourteen days, because a
 * shorter window cannot contain a fortnightly cadence, and a ratio over a
 * three-day export would move by a factor of ten on the timing of one merge.
 */
export const MINIMUM_DELIVERIES = 3;
export const MINIMUM_PERIOD_DAYS = 14;

/**
 * Two prior periods, because a baseline built from one prior period is not a
 * baseline — it is a second reading, and the delta against it inherits all of
 * that single period's noise.
 */
export const MINIMUM_BASELINE_PERIODS = 2;

/** Same plausibility ceiling as the FinOps briefing that supplies the numerator. */
export const MAXIMUM_SPEND_USD = 1_000_000_000_000;

/** Checked in this order; the first failing predicate names the reason. */
export const INSUFFICIENT_REASONS = Object.freeze([
  "no_local_spend",
  "implausible_local_spend",
  "no_delivery_evidence",
  "short_spend_period",
  "too_few_deliveries_in_period",
]);

/** Checked in this order; the first failing predicate names the reason. */
export const MISMATCH_REASONS = Object.freeze([
  "overlapping_spend_periods",
  "non_contiguous_spend_periods",
  "no_delivery_in_spend_window",
]);

export const COMPARISON_UNAVAILABLE_REASONS = Object.freeze([
  "insufficient_baseline_periods",
  "zero_baseline_ratio",
]);

/** Ordered weakest to strongest; index is the comparable rank. */
export const CONFIDENCE_LEVELS = Object.freeze(["none", "low", "medium", "high"]);

/**
 * A figure is fully supported only when every one of these local fields backed
 * it. `local.shiplog.release.status` is required and is not satisfied by the
 * release list's default: a stored release with no status is *treated* as
 * completed by the log, which is a display convenience, not a record that the
 * release shipped. Counting it silently would let unshipped work into the
 * denominator, so its absence lowers confidence instead.
 */
export const REQUIRED_PROVENANCE_FIELDS = Object.freeze([
  "local.provider_export.snapshot.period_start",
  "local.provider_export.snapshot.period_end",
  "local.provider_export.cost.amount_minor",
  "local.shiplog.release.created_at",
  "local.shiplog.release.status",
]);

/**
 * The framing, stated once and carried by every published state.
 *
 * `forbiddenClaims` is not decoration: a test asserts that no string this module
 * or its view produces contains any of them, so the framing cannot drift out of
 * a copy edit six months from now.
 */
export const FRAMING = Object.freeze({
  kind: "observational ratio",
  statement:
    "This is an observational ratio: recorded local AI spend divided by releases"
    + " recorded as completed in the same window. It is not a return on investment,"
    + " not a productivity measure, and it is not evidence that either figure moved"
    + " the other.",
  forbiddenClaims: Object.freeze([
    "return on investment", "roi", "productivity", "efficiency gain",
    "payback", "caused by", "because of", "value delivered", "output per dollar",
  ]),
});

/**
 * Why the ratio can move with no change in how much was delivered. Fixed list,
 * always rendered: these are the reasons the number is not a scoreboard, and a
 * reader who cannot see them cannot judge the comparison they were shown.
 */
export const CONFOUNDERS = Object.freeze([
  "A release is a recorded event, not a quantity of work. Two releases are not twice"
  + " the scope, size, or value of one.",
  "The release log is written by hand. Releases nobody recorded raise the ratio without"
  + " anything changing in delivery.",
  "AI spend includes work that never reached a release, and releases include work that"
  + " used no AI spend at all.",
  "Provider price and model-mix changes move the numerator on their own.",
  "Team size, hiring, and non-AI tooling are not held constant across periods.",
  "Release cadence is a policy choice. A team that batches releases shows a higher ratio"
  + " than the same team releasing weekly.",
]);

/**
 * Every rule, in prose, keyed. The module is the authority; this object exists so
 * the rules can be rendered and asserted on, and `docs/spend-per-delivery-
 * contract.md` carries the same text for a reader who is not reading code.
 */
export const SPEND_PER_DELIVERY_RULES = Object.freeze({
  window:
    "A spend period is the half-open interval [periodStart, periodEnd): start inclusive,"
    + " end exclusive, both YYYY-MM-DD in UTC. This is the interval the provider-export"
    + " contract already uses — local-finops.js excludes a usage_date >= period_end — so"
    + " no boundary day is counted in two periods and none is dropped between them."
    + " Period length in days is (periodEnd - periodStart) and must be a positive integer.",
  headlinePeriod:
    "Periods are sorted ascending by periodStart, ties by periodEnd, then by exportId,"
    + " which makes the order total. The headline is the LAST period — the most recent"
    + " one — never a pooled figure over all of them: a mean across periods of different"
    + " lengths is not the number a leader is asking about this month.",
  numerator:
    "spendUsd of the headline period, as the analysis reported it, rounded half away from"
    + " zero to 2 decimals. Nothing is re-derived from line items here.",
  denominator:
    "Deliveries counted in the headline period are the records whose completedAt instant"
    + " falls in [periodStart, periodEnd). Only releases recorded as completed are"
    + " eligible: planned and cancelled releases are not delivery evidence. A delivery"
    + " with an unparseable completedAt is excluded and counted in"
    + " excludedUnparseableDeliveries rather than silently dropped.",
  ratio:
    "spendPerDeliveryUsd = headline spendUsd / deliveries in the headline period, rounded"
    + " half away from zero to 2 decimals. It is published only in the eligible state;"
    + " every other state publishes null, never 0.",
  eligibility:
    "Checked in this exact order, first match wins: (1) no spend period, or headline"
    + " spendUsd not a finite positive number -> insufficient_data/no_local_spend;"
    + " (2) headline spend above MAXIMUM_SPEND_USD -> insufficient_data/"
    + "implausible_local_spend; (3) no completed delivery record at all ->"
    + " insufficient_data/no_delivery_evidence; (4) spend periods overlap ->"
    + " mismatched_period/overlapping_spend_periods; (5) a gap between consecutive spend"
    + " periods -> mismatched_period/non_contiguous_spend_periods; (6) no delivery falls"
    + " inside the full spend window -> mismatched_period/no_delivery_in_spend_window;"
    + " (7) headline period shorter than MINIMUM_PERIOD_DAYS -> insufficient_data/"
    + "short_spend_period; (8) fewer than"
    + " MINIMUM_DELIVERIES in the headline period -> insufficient_data/"
    + "too_few_deliveries_in_period; otherwise eligible."
    + " Order matters: a window that cannot be aligned is reported as a mismatch even"
    + " when it would also have been too short, because re-exporting a longer period"
    + " would not fix an unalignable one.",
  baseline:
    "The comparison baseline is the mean of the per-period ratios of every period before"
    + " the headline that clears the same floor as the headline (positive spend,"
    + " >= MINIMUM_PERIOD_DAYS long, >= MINIMUM_DELIVERIES deliveries in period), rounded"
    + " half away from zero to 2 decimals. Mean of per-period ratios, not pooled spend"
    + " over pooled deliveries: each period gets one vote, so a single unusually large"
    + " month cannot dominate the baseline, and the baseline does not shift when a"
    + " period's length changes. A period that fails the floor is excluded from the"
    + " baseline and counted in baselineExcludedPeriods; it is never counted as zero."
    + " Fewer than MINIMUM_BASELINE_PERIODS qualifying periods leaves the comparison"
    + " unavailable with insufficient_baseline_periods and a null baseline.",
  comparison:
    "deltaUsd = headline ratio - baseline, 2 decimals. deltaPercent = deltaUsd / baseline"
    + " x 100, 1 decimal, half away from zero, so a rise and a fall of the same magnitude"
    + " round identically. direction is read off the ROUNDED deltaPercent (> 0 higher,"
    + " < 0 lower, == 0 level) so the word and the number can never disagree. A zero"
    + " baseline yields unavailable/zero_baseline_ratio and a null percentage."
    + " 'higher' means spend per recorded release rose. It does not mean the team got"
    + " slower, and no direction is labelled good or bad.",
  confidence:
    "Exactly one level from CONFIDENCE_LEVELS, first match wins: none when the state is"
    + " not eligible; low when any REQUIRED_PROVENANCE_FIELDS entry is missing, because"
    + " part of the basis for the figure was never checked; medium when the comparison is"
    + " unavailable or any contributing period declares completeness other than"
    + " 'complete'; high otherwise. Confidence describes the comparison, not the size of"
    + " the number.",
  nextAction:
    "Exactly one action, rank 1, with the role accountable for it. It is selected from"
    + " the state and reason code, so the same inputs always name the same next step."
    + " In the no_delivery_evidence state the action is the highest-priority one on the"
    + " page: record completed releases in the release log, because until that exists"
    + " there is no denominator and no other action can be justified.",
});

export class SpendPerDeliveryError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "SpendPerDeliveryError";
    this.path = path;
  }
}

const invalid = (path, message) => {
  throw new SpendPerDeliveryError(path, message);
};

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const DAY_MS = 86_400_000;

/**
 * Round half away from zero. Math.round breaks halves toward positive infinity,
 * so a -12.5% fall and a +12.5% rise would print different magnitudes. This is
 * the single rounding rule for every number in this contract.
 */
function round(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const magnitude = Math.round(Math.abs(value) * factor) / factor;
  return value < 0 ? -magnitude : magnitude;
}

const dayStart = (date) => Date.parse(`${date}T00:00:00Z`);

function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readPeriod(entry, index) {
  const path = `spendPeriods[${index}]`;
  if (entry === null || typeof entry !== "object") invalid(path, "must be an object.");
  if (!DATE_PATTERN.test(entry.periodStart ?? "")) invalid(`${path}.periodStart`, "must be YYYY-MM-DD.");
  if (!DATE_PATTERN.test(entry.periodEnd ?? "")) invalid(`${path}.periodEnd`, "must be YYYY-MM-DD.");
  const days = (dayStart(entry.periodEnd) - dayStart(entry.periodStart)) / DAY_MS;
  if (!Number.isInteger(days) || days <= 0) {
    invalid(`${path}.periodEnd`, "must be a whole number of days after periodStart.");
  }
  if (entry.spendUsd !== null && typeof entry.spendUsd !== "number") {
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

function readInput(input) {
  if (input === null || typeof input !== "object") invalid("input", "must be an object.");
  if (!Array.isArray(input.spendPeriods)) invalid("spendPeriods", "must be an array.");
  if (!Array.isArray(input.deliveries)) invalid("deliveries", "must be an array.");
  const periods = input.spendPeriods.map(readPeriod).sort((left, right) =>
    left.periodStart.localeCompare(right.periodStart)
    || left.periodEnd.localeCompare(right.periodEnd)
    || String(left.exportId).localeCompare(String(right.exportId)));
  const deliveries = [];
  let excludedUnparseable = 0;
  input.deliveries.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object") invalid(`deliveries[${index}]`, "must be an object.");
    const at = Date.parse(entry.completedAt ?? "");
    if (Number.isNaN(at)) {
      excludedUnparseable += 1;
      return;
    }
    deliveries.push(Object.freeze({
      id: typeof entry.id === "string" ? entry.id : `delivery-${index + 1}`,
      completedAt: entry.completedAt,
      at,
      label: typeof entry.label === "string" ? entry.label : null,
    }));
  });
  const provenance = input.provenance ?? {};
  return {
    periods,
    deliveries,
    excludedUnparseable,
    provenance: {
      source: typeof provenance.source === "string" ? provenance.source : "unstated local source",
      origin: provenance.origin === "example" ? "example" : "import",
      derivedFromFields: Array.isArray(provenance.derivedFromFields)
        ? provenance.derivedFromFields.filter((field) => typeof field === "string")
        : [],
    },
  };
}

const inPeriod = (delivery, period) =>
  delivery.at >= dayStart(period.periodStart) && delivery.at < dayStart(period.periodEnd);

const countIn = (deliveries, period) =>
  deliveries.filter((delivery) => inPeriod(delivery, period)).length;

/** Per-period ratio, or null where the period does not clear the headline floor. */
function periodRatio(period, deliveries) {
  const count = countIn(deliveries, period);
  if (!positive(period.spendUsd) || period.days < MINIMUM_PERIOD_DAYS
    || count < MINIMUM_DELIVERIES) return null;
  return { ratio: round(period.spendUsd / count, 2), deliveries: count };
}

function alignment(periods) {
  for (let index = 1; index < periods.length; index += 1) {
    const previous = periods[index - 1];
    const current = periods[index];
    if (current.periodStart < previous.periodEnd) return "overlapping_spend_periods";
    if (current.periodStart > previous.periodEnd) return "non_contiguous_spend_periods";
  }
  return null;
}

/** The prioritized next action, one per reachable state and reason. */
const NEXT_ACTIONS = Object.freeze({
  no_delivery_evidence: {
    text: "Record your completed releases in the release log, then read this comparison again.",
    owner: "Engineering lead",
    href: "/release.html",
    why: "There is no denominator until shipped releases are recorded, so no ratio and no"
      + " other action on this page can be justified yet.",
  },
  no_local_spend: {
    text: "Select a provider billing export for the period you want to compare.",
    owner: "FinOps lead",
    href: null,
    why: "The numerator is the spend a provider export reports; nothing here estimates it.",
  },
  implausible_local_spend: {
    text: "Inspect the provider export and correct the billing total before comparing it.",
    owner: "FinOps lead",
    href: null,
    why: "The reported total is outside the supported display range, so publishing a ratio"
      + " would make an implausible input look decision-ready.",
  },
  short_spend_period: {
    text: `Re-export billing for a period of at least ${MINIMUM_PERIOD_DAYS} days.`,
    owner: "FinOps lead",
    href: null,
    why: "A shorter window moves by a large factor on the timing of a single release.",
  },
  too_few_deliveries_in_period: {
    text: "Record the releases that shipped inside this billing period, or compare a period"
      + ` that contains at least ${MINIMUM_DELIVERIES} of them.`,
    owner: "Engineering lead",
    href: "/release.html",
    why: "A per-release mean over one or two releases describes those releases, not the period.",
  },
  overlapping_spend_periods: {
    text: "Remove the overlapping billing export and keep one export per period.",
    owner: "FinOps lead",
    href: null,
    why: "Overlapping periods count the same days of spend twice.",
  },
  non_contiguous_spend_periods: {
    text: "Add the missing billing period, or select only consecutive periods.",
    owner: "FinOps lead",
    href: null,
    why: "The gap holds spend and releases that no figure here would account for.",
  },
  no_delivery_in_spend_window: {
    text: "Compare a billing period that overlaps the dates your recorded releases cover.",
    owner: "FinOps lead",
    href: null,
    why: "Spend from one window and releases from another are not the same denominator,"
      + " so the ratio would be arithmetic without a meaning.",
  },
  eligible: {
    text: "Before acting on the change, check it against a known change in release cadence,"
      + " scope, or provider pricing.",
    owner: "Engineering lead",
    href: null,
    why: "Every one of those moves this ratio without delivery having changed.",
  },
});

function confidenceOf({ eligible, missingFields, comparisonAvailable, periods }) {
  if (!eligible) {
    return { level: "none", basis: "No ratio was published, so there is nothing to be confident about." };
  }
  if (missingFields.length) {
    return {
      level: "low",
      basis: `Part of the basis was never checked: ${missingFields.join(", ")} did not back this figure.`,
    };
  }
  const partial = periods.find((period) => period.completeness && period.completeness !== "complete");
  if (partial) {
    return {
      level: "medium",
      basis: `Billing period ${partial.periodStart} declares completeness "${partial.completeness}",`
        + " so the spend it reports may still move.",
    };
  }
  if (!comparisonAvailable) {
    return {
      level: "medium",
      basis: "The figure rests on complete local records, but there is no trailing baseline to"
        + " compare it against yet.",
    };
  }
  return {
    level: "high",
    basis: "Both sides come from complete local records over one aligned window, and the"
      + " comparison is against this browser's own earlier periods.",
  };
}

const money = (value) => value.toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/**
 * How the delivery side is named. The example dataset's releases are bundled
 * synthetic records, and calling them "this browser's" would be the one claim
 * this contract cannot afford to get wrong — a reader has to know whose release
 * log produced the denominator.
 */
const ledgerPhrase = (origin) =>
  (origin === "example" ? "the bundled example release log" : "this browser's release log");

const REASON_SENTENCES = Object.freeze({
  no_local_spend: "No local AI spend has been read in this tab, so there is no numerator to compare.",
  implausible_local_spend: "The local AI spend total is above the supported 1 trillion USD"
    + " display range, so the ratio is withheld for review.",
  no_delivery_evidence: "No completed release is recorded, so there is no delivery"
    + " evidence to compare local AI spend against.",
  short_spend_period: "The billing period read here is shorter than"
    + ` ${MINIMUM_PERIOD_DAYS} days, which is too short to compare per release.`,
  too_few_deliveries_in_period: `Fewer than ${MINIMUM_DELIVERIES} completed releases are recorded`
    + " inside this billing period, so a per-release figure would describe those releases"
    + " rather than the period.",
  overlapping_spend_periods: "Two billing periods read here overlap, so the same days of spend"
    + " would be counted twice.",
  non_contiguous_spend_periods: "The billing periods read here are not consecutive, and the gap"
    + " between them holds spend and releases this comparison cannot see.",
  no_delivery_in_spend_window: "The recorded releases fall entirely outside the billing period"
    + " read here, so the two sides describe different windows.",
});

/**
 * The decision record for one set of local spend periods and delivery records.
 *
 * Malformed input throws — a caller passing the wrong shape is a defect, not a
 * state. Unusable *data* never throws: it comes back as `insufficient_data` or
 * `mismatched_period` with a reason code, because those are the answers a
 * reader has to act on.
 */
export function spendPerDeliveryDecision(input) {
  const { periods, deliveries, excludedUnparseable, provenance } = readInput(input);
  const declared = new Set(provenance.derivedFromFields);
  const missingFields = REQUIRED_PROVENANCE_FIELDS.filter((field) => !declared.has(field));
  const headline = periods.at(-1) ?? null;
  const window = headline ? Object.freeze({
    start: headline.periodStart, end: headline.periodEnd, days: headline.days,
  }) : null;
  const deliveriesInHeadline = headline ? countIn(deliveries, headline) : 0;
  const spendWindow = periods.length ? {
    start: periods[0].periodStart, end: periods.at(-1).periodEnd,
  } : null;
  const deliveriesInWindow = spendWindow
    ? countIn(deliveries, { periodStart: spendWindow.start, periodEnd: spendWindow.end })
    : 0;

  // The eligibility ladder, in the order SPEND_PER_DELIVERY_RULES.eligibility
  // publishes. Each rung names the state and the reason together, so no caller
  // has to infer one from the other.
  let state = SPEND_PER_DELIVERY_STATE.eligible;
  let reasonCode = null;
  const misalignment = alignment(periods);
  if (!headline || !positive(headline.spendUsd)) {
    state = SPEND_PER_DELIVERY_STATE.insufficient;
    reasonCode = "no_local_spend";
  } else if (headline.spendUsd > MAXIMUM_SPEND_USD) {
    state = SPEND_PER_DELIVERY_STATE.insufficient;
    reasonCode = "implausible_local_spend";
  } else if (!deliveries.length) {
    state = SPEND_PER_DELIVERY_STATE.insufficient;
    reasonCode = "no_delivery_evidence";
  } else if (misalignment) {
    state = SPEND_PER_DELIVERY_STATE.mismatched;
    reasonCode = misalignment;
  } else if (deliveriesInWindow === 0) {
    state = SPEND_PER_DELIVERY_STATE.mismatched;
    reasonCode = "no_delivery_in_spend_window";
  } else if (headline.days < MINIMUM_PERIOD_DAYS) {
    state = SPEND_PER_DELIVERY_STATE.insufficient;
    reasonCode = "short_spend_period";
  } else if (deliveriesInHeadline < MINIMUM_DELIVERIES) {
    state = SPEND_PER_DELIVERY_STATE.insufficient;
    reasonCode = "too_few_deliveries_in_period";
  }
  const eligible = state === SPEND_PER_DELIVERY_STATE.eligible;

  const spendUsd = headline && typeof headline.spendUsd === "number"
    ? round(headline.spendUsd, 2) : null;
  const ratio = eligible ? round(spendUsd / deliveriesInHeadline, 2) : null;

  // The baseline is only ever computed for a published ratio: a mean of prior
  // periods beside a withheld headline invites a reader to compare the two.
  const priorPeriods = periods.slice(0, -1);
  const qualifying = eligible
    ? priorPeriods.map((period) => ({ period, ratio: periodRatio(period, deliveries) }))
      .filter((entry) => entry.ratio !== null)
    : [];
  let comparison = {
    available: false,
    reasonCode: eligible ? "insufficient_baseline_periods" : null,
    baselineUsd: null,
    // Null rather than a count while the ratio is withheld: a "2 periods
    // excluded" line beside a withheld figure reads as a baseline that almost
    // existed, and none was attempted.
    baselinePeriods: eligible ? qualifying.length : null,
    baselineExcludedPeriods: eligible ? priorPeriods.length - qualifying.length : null,
    deltaUsd: null,
    deltaPercent: null,
    direction: null,
    interpretation: eligible
      ? `A trailing baseline needs ${MINIMUM_BASELINE_PERIODS} earlier billing periods that clear`
        + " the same floor as this one. Nothing here is compared against a peer or industry"
        + " cohort, because no imported local record contains one."
      : "No comparison is made while the ratio itself is withheld.",
  };
  if (eligible && qualifying.length >= MINIMUM_BASELINE_PERIODS) {
    const baselineUsd = round(
      qualifying.reduce((sum, entry) => sum + entry.ratio.ratio, 0) / qualifying.length, 2);
    if (baselineUsd === 0) {
      comparison = { ...comparison, reasonCode: "zero_baseline_ratio",
        baselineUsd: 0,
        interpretation: "The trailing baseline is zero, so a percentage change against it is"
          + " undefined and none is shown." };
    } else {
      const deltaUsd = round(ratio - baselineUsd, 2);
      const deltaPercent = round((deltaUsd / baselineUsd) * 100, 1);
      const direction = deltaPercent > 0 ? "higher" : deltaPercent < 0 ? "lower" : "level";
      comparison = {
        available: true,
        reasonCode: null,
        baselineUsd,
        baselinePeriods: qualifying.length,
        baselineExcludedPeriods: priorPeriods.length - qualifying.length,
        deltaUsd,
        deltaPercent,
        direction,
        interpretation: direction === "level"
          ? `Spend per recorded release is level with this browser's own trailing baseline of`
            + ` ${money(baselineUsd)} USD over ${qualifying.length} earlier periods.`
          : `Spend per recorded release is ${money(Math.abs(deltaUsd))} USD ${direction} than this`
            + ` browser's own trailing baseline of ${money(baselineUsd)} USD over`
            + ` ${qualifying.length} earlier periods:`
            + (direction === "higher"
              ? " recorded spend grew faster than recorded releases over the same window."
              : " recorded releases grew faster than recorded spend over the same window."),
      };
    }
  }

  const confidence = confidenceOf({
    eligible, missingFields, comparisonAvailable: comparison.available, periods,
  });
  const action = NEXT_ACTIONS[eligible ? "eligible" : reasonCode] ?? NEXT_ACTIONS.no_local_spend;

  const statement = eligible
    ? `${money(ratio)} USD of recorded AI spend per completed release: ${money(spendUsd)} USD`
      + ` across ${deliveriesInHeadline} releases recorded as completed between`
      + ` ${window.start} and ${window.end}.`
    : REASON_SENTENCES[reasonCode];

  const evidence = [
    headline
      ? `Billing period ${window.start} to ${window.end} (${window.days} days, end exclusive),`
        + ` ${spendUsd === null ? "no spend reported" : `${money(spendUsd)} USD reported`}.`
      : "No billing period was read in this tab.",
    `${deliveries.length} release${deliveries.length === 1 ? "" : "s"} recorded as completed in`
    + ` ${ledgerPhrase(provenance.origin)}; ${deliveriesInHeadline} fall inside the billing period.`,
    spendWindow && deliveries.length - deliveriesInWindow > 0
      ? `${deliveries.length - deliveriesInWindow} recorded release${
        deliveries.length - deliveriesInWindow === 1 ? "" : "s"} fall outside`
        + ` ${spendWindow.start} to ${spendWindow.end} and are not counted.`
      : null,
    excludedUnparseable > 0
      ? `${excludedUnparseable} release record${excludedUnparseable === 1 ? "" : "s"} carried an`
        + " unreadable completion date and were excluded from the count."
      : null,
    periods.length > 1
      ? `${periods.length} billing periods were read; the figure above is the most recent one.`
      : null,
  ].filter(Boolean);

  return Object.freeze({
    schemaVersion: SPEND_PER_DELIVERY_SCHEMA_VERSION,
    question: SPEND_PER_DELIVERY_QUESTION,
    state,
    reasonCode,
    statement,
    window,
    metric: Object.freeze({
      currency: SUPPORTED_CURRENCY,
      unit: SPEND_PER_DELIVERY_UNIT,
      spendUsd: eligible ? spendUsd : null,
      deliveries: eligible ? deliveriesInHeadline : null,
      spendPerDeliveryUsd: ratio,
    }),
    comparison: Object.freeze(comparison),
    confidence: Object.freeze(confidence),
    framing: FRAMING,
    confounders: CONFOUNDERS,
    provenance: Object.freeze({
      source: provenance.source,
      origin: provenance.origin,
      declaredFields: Object.freeze([...declared].sort()),
      missingFields: Object.freeze(missingFields),
      complete: missingFields.length === 0,
    }),
    nextAction: Object.freeze({ rank: 1, ...action }),
    evidence: Object.freeze(evidence),
  });
}

/* ------------------------------ local adapters ------------------------------- */

const PERIOD_STRING = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/;

/**
 * Spend periods out of a local-finops analysis envelope.
 *
 * The analysis publishes its window as the string "start to end" — the same
 * shape `finops-trust-verdict.js` reads — and its multi-period form repeats it
 * per period on `history.periods`. Parsing that here rather than plumbing a new
 * field through the analysis keeps this contract additive: nothing upstream
 * changes, and a period string that stops matching produces no period rather
 * than a wrong one.
 */
export function spendPeriodsFromAnalysis(analysis) {
  const entries = Array.isArray(analysis?.history?.periods) && analysis.history.periods.length
    ? analysis.history.periods
    : analysis?.period ? [{ period: analysis.period, spendUsd: analysis.spendUsd }] : [];
  return entries.map((entry) => {
    const match = PERIOD_STRING.exec(String(entry.period ?? ""));
    if (!match) return null;
    return {
      periodStart: match[1],
      periodEnd: match[2],
      spendUsd: typeof entry.spendUsd === "number" ? entry.spendUsd : null,
      exportId: typeof entry.exportId === "string" ? entry.exportId : null,
      completeness: typeof entry.completeness === "string" ? entry.completeness : null,
    };
  }).filter(Boolean);
}

/**
 * Delivery evidence out of stored Shiplog releases.
 *
 * Only `status === "completed"` counts, and the check is explicit rather than
 * `releaseStatus()`: that helper defaults a missing status to completed so the
 * list has something to show, which is right for a list and wrong for a
 * denominator. A release with no declared status is reported as
 * `statusDeclared: false` so the caller can drop the provenance field, and it is
 * not counted as delivered.
 */
export function deliveriesFromReleases(releases) {
  const records = Array.isArray(releases) ? releases : [];
  let statusDeclared = records.length > 0;
  const deliveries = [];
  for (const release of records) {
    if (typeof release?.status !== "string") statusDeclared = false;
    if (release?.status !== "completed") continue;
    deliveries.push({
      id: typeof release.id === "string" ? release.id : "",
      completedAt: release.createdAt,
      label: typeof release.version === "string" ? release.version : null,
    });
  }
  return { deliveries, statusDeclared };
}

/**
 * Assemble the contract input from what the FinOps tab already holds: one
 * analysis envelope and this browser's release log. The provenance fields are
 * declared from what was actually found, never asserted, so a missing side
 * lowers confidence instead of being invisible.
 */
export function spendPerDeliveryInput({ analysis, releases, origin = "import", source } = {}) {
  const spendPeriods = spendPeriodsFromAnalysis(analysis);
  const { deliveries, statusDeclared } = deliveriesFromReleases(releases);
  const derivedFromFields = [];
  if (spendPeriods.length) {
    derivedFromFields.push(
      "local.provider_export.snapshot.period_start",
      "local.provider_export.snapshot.period_end",
    );
    if (spendPeriods.every((period) => typeof period.spendUsd === "number")) {
      derivedFromFields.push("local.provider_export.cost.amount_minor");
    }
  }
  if (deliveries.length) {
    derivedFromFields.push("local.shiplog.release.created_at");
    if (statusDeclared) derivedFromFields.push("local.shiplog.release.status");
  }
  return {
    spendPeriods,
    deliveries,
    provenance: {
      origin,
      source: source ?? (origin === "example"
        ? "Bundled synthetic example dataset, analysed in this tab."
        : "Your provider export and this browser's release log, read in this tab."),
      derivedFromFields,
    },
  };
}
