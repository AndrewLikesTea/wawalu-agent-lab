// The strongest finding a leader's own partial evidence supports — and nothing
// stronger.
//
// THE QUESTION THIS ANSWERS. A FinOps lead imports what they have, which is
// never everything: one provider's export is a month short, another arrived in
// euros, a roster row never joined, a date in a CSV is a day that does not
// exist. The panels above answer "what did you give me" and "can these be
// combined". Neither answers the question a lead actually has to act on:
//
//     Given only the evidence I could import, what is the strongest finding I
//     can defend, and what one thing would make it stronger?
//
// A page that answers this badly is worse than a page that stays silent. The
// two failure modes are (a) publishing a total as if it were complete, and
// (b) refusing to publish anything because something is missing. Both are
// avoidable: a partial total is a defensible *floor* as long as it is labelled
// as one and the reader can see what is outside it.
//
// THE RESULT SHAPE IS FIXED AT THREE SLOTS, in this order, because that is the
// order a decision is made in:
//
//   1. one decision question, answered by one finding state;
//   2. exactly one material figure — a metric or a benchmark, never both;
//   3. exactly one prioritized next action.
//
// Everything else — every excluded record, every review gap, every provenance
// label — is progressive disclosure. It is carried in the result so a reader can
// open it, and it is never in the way of the three slots above.
//
// WHAT THIS MODULE REFUSES TO DO.
//
//   1. It never measures a peer comparison, and structurally cannot: the caller
//      passes availability, and an unavailable comparison is reported as "not
//      measured" with the reason. There is no branch in which a percentile,
//      cohort figure, or "in line with peers" sentence can be produced here.
//   2. It never repairs input. An impossible date, a foreign currency, or an
//      unreadable amount excludes the record and names it. A corrected value
//      would be this product inventing evidence.
//   3. It never publishes an unlabelled total. Whenever anything at all was
//      excluded or left for review, the figure is stamped partial and carries
//      the count that is outside it.
//   4. It holds no source material. A record contributes an id, a label, a
//      window, a currency code, an amount, and a provenance *label*. Prompt
//      text, account identifiers, and file bytes have no field to arrive in.
//
// Determinism: no clock, no network, no storage, no randomness. The same input
// yields a byte-identical result, which is what makes a disagreement about the
// finding a disagreement about the rules below.

import { calendarDate } from "./calendar-date.js";

/** Bump when a state, a code, a threshold, or a metric definition changes. */
export const PARTIAL_EVIDENCE_VERSION = "partial-evidence/1.0.0";

/** The one question the result answers. Stated once, here. */
export const PARTIAL_EVIDENCE_QUESTION =
  "What is the strongest finding my imported evidence supports right now?";

/**
 * The three finding states.
 *
 * `supported`    Every admissible record was admissible and no review gap is
 *                open. The figure is a total, not a floor.
 * `partial`      At least one record is usable, and something was excluded or
 *                is awaiting review. The figure is a floor and says so.
 * `insufficient` No record is usable. No figure is published at all; the
 *                material slot falls back to the coverage benchmark, which is a
 *                count of exports and not an amount of money.
 */
export const FINDING_STATE = Object.freeze({
  supported: "supported",
  partial: "partial",
  insufficient: "insufficient_evidence",
});

/**
 * Why a record is outside the finding. Ordered: the first rule a record fails is
 * the reason reported, so one record never carries two explanations.
 *
 * `unreadable_period` is first on purpose. A date that does not exist means the
 * export was misread — by a column mapping, a locale, or an upstream tool — and
 * every other judgment about that row is unsafe until it is corrected.
 */
export const EXCLUSION_CODE = Object.freeze({
  unreadablePeriod: "unreadable_period",
  outsideRequiredPeriod: "outside_required_period",
  incompatibleCurrency: "incompatible_currency",
  unreadableAmount: "unreadable_amount",
  duplicateExport: "duplicate_export",
  heldOutUpstream: "held_out_upstream",
});

/** The exclusion rules in the order they are applied. */
export const EXCLUSION_ORDER = Object.freeze([
  EXCLUSION_CODE.unreadablePeriod,
  EXCLUSION_CODE.outsideRequiredPeriod,
  EXCLUSION_CODE.incompatibleCurrency,
  EXCLUSION_CODE.unreadableAmount,
  EXCLUSION_CODE.duplicateExport,
]);

/**
 * The next actions, in strict priority order. Exactly one is returned.
 *
 * The order is the product decision and it is not "worst number first". It is
 * "cheapest correction that changes the finding most": a misread date can move
 * every figure, so it outranks a review gap; a review gap can move the total, so
 * it outranks re-exporting a held-out provider; and attribution only changes
 * which department is named, so it comes last before "nothing to fix".
 */
export const ACTION_CODE = Object.freeze({
  selectProviderExport: "select_provider_export",
  correctImpossibleDates: "correct_impossible_dates",
  resolveReviewGaps: "resolve_review_gaps",
  recoverExcludedEvidence: "recover_excluded_evidence",
  attributeUnassignedSpend: "attribute_unassigned_spend",
  recordTheDecision: "record_the_decision",
});

/**
 * The floor an attributed share must clear before the finding stops asking for
 * attribution. Declared here so the number a reader is held to is the number a
 * reviewer can dispute: below 80% of dollars joined to an org unit, "which
 * department" is a guess dressed as a ranking.
 */
export const ATTRIBUTION_FLOOR = 0.8;

/** Two decimals, half away from zero, so ±x.005 print the same magnitude. */
function money(value) {
  const magnitude = Math.round(Math.abs(value) * 100) / 100;
  return value < 0 ? -magnitude : magnitude;
}

/** Four decimals, so two implementations store the same ratio digits. */
function ratio(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10_000 + Number.EPSILON) / 10_000;
}

const text = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, 120);
  return trimmed.length > 0 ? trimmed : null;
};

const CURRENCY_SHAPE = /^[A-Z]{3}$/;

const currencyCode = (value) => {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  return CURRENCY_SHAPE.test(upper) ? upper : null;
};

/** A non-negative finite amount, or null. A numeric string is not an amount. */
const amount = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * Read the declared window every record is judged against.
 *
 * Half-open [start, end). An impossible bound is fatal rather than per-record:
 * with no window there is nothing to be inside or outside of, so the whole
 * evaluation is insufficient and says which bound failed.
 */
function readRequiredPeriod(period) {
  const errors = [];
  const start = calendarDate(period?.start);
  const end = calendarDate(period?.end);
  if (!start) errors.push("requiredPeriod.start: expected a real ISO-8601 calendar date");
  if (!end) errors.push("requiredPeriod.end: expected a real ISO-8601 calendar date");
  if (start && end && !(start < end)) {
    errors.push("requiredPeriod.end: must be later than requiredPeriod.start");
  }
  return { start, end, errors, valid: errors.length === 0 };
}

/** One imported record, read down to the closed set of fields this policy uses. */
function readRecord(entry, index) {
  return {
    id: text(entry?.id) ?? `record-${index + 1}`,
    label: text(entry?.providerLabel) ?? "Unnamed export",
    periodStart: calendarDate(entry?.periodStart),
    periodEnd: calendarDate(entry?.periodEnd),
    rawPeriodStart: text(entry?.periodStart),
    rawPeriodEnd: text(entry?.periodEnd),
    currencyCode: currencyCode(entry?.currencyCode),
    spendUsd: amount(entry?.spendUsd),
    costBasis: text(entry?.costBasis),
    completeness: text(entry?.completeness),
    provenanceLabel: text(entry?.provenanceLabel),
  };
}

/**
 * The first rule this record fails, with the sentence a reader gets. Returns
 * null when the record is admissible.
 */
function exclusionFor(record, period, currency, seen) {
  if (!record.periodStart || !record.periodEnd) {
    return {
      code: EXCLUSION_CODE.unreadablePeriod,
      reason: `${record.label} declares a window that is not a real calendar date, so no part of `
        + "it is counted. Correct the date in the export rather than rounding it here.",
    };
  }
  if (record.periodStart < period.start || record.periodEnd > period.end) {
    return {
      code: EXCLUSION_CODE.outsideRequiredPeriod,
      reason: `${record.label} covers ${record.periodStart} to ${record.periodEnd}, which is not `
        + `inside ${period.start} to ${period.end}. Mixing windows would make the total a `
        + "different measurement, so it is held out.",
    };
  }
  if (record.currencyCode !== currency) {
    return {
      code: EXCLUSION_CODE.incompatibleCurrency,
      reason: `${record.label} is priced in ${record.currencyCode ?? "an unreadable currency"}, `
        + `not ${currency}. This product cannot obtain a rate locally, and a converted figure `
        + "nobody can reproduce is worse than an absent one.",
    };
  }
  if (record.spendUsd === null) {
    return {
      code: EXCLUSION_CODE.unreadableAmount,
      reason: `${record.label} carries no readable non-negative amount, so it contributes nothing `
        + "to the total. A row this product cannot read is evidence about the export.",
    };
  }
  if (seen.has(record.id)) {
    return {
      code: EXCLUSION_CODE.duplicateExport,
      reason: `${record.label} repeats export ${record.id}, which is already counted. Two copies `
        + "of one export are not two months of spend.",
    };
  }
  return null;
}

/** An exclusion the caller already decided, carried through with its own words. */
function upstreamExclusion(entry, index) {
  return Object.freeze({
    id: text(entry?.id) ?? `held-${index + 1}`,
    label: text(entry?.providerLabel) ?? "Unnamed export",
    code: text(entry?.code) ?? EXCLUSION_CODE.heldOutUpstream,
    origin: "upstream",
    reason: text(entry?.reason)
      ?? "This export was held out before it reached this policy; the intake panel says why.",
  });
}

/** Review gaps the caller is holding open, as counted facts and sentences. */
function readReview(review) {
  const gaps = (Array.isArray(review?.gaps) ? review.gaps : [])
    .map((gap, index) => Object.freeze({
      code: text(gap?.code) ?? `gap-${index + 1}`,
      message: text(gap?.message) ?? "An unstated review gap is open.",
    }));
  const open = review?.state === "needs_review" || gaps.length > 0;
  return Object.freeze({ open, gaps: Object.freeze(gaps) });
}

/**
 * The material slot: one metric, or one benchmark, never both and never zero.
 *
 * The metric is observed spend across usable evidence. It is published whenever
 * at least one record is usable, and it is stamped `partial` — a floor, not a
 * total — whenever anything was excluded or is awaiting review.
 *
 * When nothing is usable there is no honest amount to print, so the slot holds
 * the coverage benchmark instead: a count of exports, which is a fact about the
 * import rather than a claim about money.
 */
function materialSlot({ usable, excluded, observedSpendUsd, currency, partial, review }) {
  const admissible = usable.length;
  const considered = admissible + excluded.length;
  const coverage = considered > 0 ? ratio(admissible / considered) : null;
  if (admissible === 0) {
    return Object.freeze({
      kind: "benchmark",
      id: "evidence_coverage",
      label: "Admissible exports",
      value: coverage,
      unit: "share_of_exports",
      display: considered > 0
        ? `0 of ${plural(considered, "export", "exports")} is admissible`
        : "No export was offered",
      partial: false,
      definition: "Admissible exports divided by exports considered, where an admissible export "
        + "clears every rule in EXCLUSION_ORDER. Rounded to four decimals.",
      arithmetic: `0 admissible ÷ ${considered} considered`,
      basis: "A count of exports. No amount of money is published while nothing is usable.",
    });
  }
  return Object.freeze({
    kind: "metric",
    id: "observed_spend_usd",
    label: partial ? "Observed spend, partial floor" : "Observed spend",
    value: money(observedSpendUsd),
    unit: currency,
    display: `${currency} ${money(observedSpendUsd).toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    })}`,
    partial,
    partialReason: partial
      ? `${plural(excluded.length, "export is", "exports are")} outside this figure`
        + `${review.open
          ? ` and ${plural(review.gaps.length, "review gap remains", "review gaps remain")} open`
          : ""}, so it is a floor and the true total is higher.`
      : null,
    definition: "The sum of spendUsd across every admissible record, rounded half away from zero "
      + "to two decimals. Excluded records contribute nothing — not zero, nothing.",
    arithmetic: `${usable.map((record) => money(record.spendUsd).toFixed(2)).join(" + ")}`
      + ` = ${money(observedSpendUsd).toFixed(2)}`,
    coverage,
    basis: `Summed over ${plural(admissible, "admissible export", "admissible exports")} of `
      + `${considered} considered.`,
  });
}

/**
 * The one action. Priority order is `ACTION_CODE`'s declaration order, and the
 * first condition that holds wins — there is no scoring and no tie to break.
 */
function nextAction({ usable, excluded, review, attribution, considered }) {
  if (usable.length === 0 && considered === 0) {
    return {
      code: ACTION_CODE.selectProviderExport,
      statement: "Choose a provider usage export. There is no evidence to find anything in yet.",
      focus: "files",
    };
  }
  const impossible = excluded.filter((entry) => entry.code === EXCLUSION_CODE.unreadablePeriod);
  if (impossible.length > 0) {
    return {
      code: ACTION_CODE.correctImpossibleDates,
      statement: `Correct the billing window in ${impossible.map((entry) => entry.label).join(", ")}`
        + `: ${plural(impossible.length, "export declares", "exports declare")} a day that does `
        + `not exist, so every figure from ${impossible.length === 1 ? "it" : "them"} is unsafe `
        + "until it is fixed.",
      focus: "files",
    };
  }
  if (review.open) {
    return {
      code: ACTION_CODE.resolveReviewGaps,
      statement: `Resolve ${plural(review.gaps.length, "open review gap", "open review gaps")} `
        + "before quoting this figure: the total can still move.",
      focus: "review",
    };
  }
  if (excluded.length > 0) {
    return {
      code: ACTION_CODE.recoverExcludedEvidence,
      statement: `Re-export ${excluded.map((entry) => entry.label).join(", ")} so `
        + `${plural(excluded.length, "export", "exports")} currently outside the floor can be `
        + "counted. That is the one change that raises this figure.",
      focus: "files",
    };
  }
  if (attribution.share !== null && attribution.share < attribution.floor) {
    return {
      code: ACTION_CODE.attributeUnassignedSpend,
      statement: `Attribute the remaining spend: ${(attribution.share * 100).toFixed(1)}% of `
        + `dollars joined an org unit, below the ${(attribution.floor * 100).toFixed(0)}% floor `
        + "this page will name a department at.",
      focus: "roster",
    };
  }
  return {
    code: ACTION_CODE.recordTheDecision,
    statement: "Record the decision. Nothing in this evidence is missing, so the next move is a "
      + "logged decision rather than another export.",
    focus: "decisions",
  };
}

/** The peer slot. There is no branch here that produces a measurement. */
function peerSlot(peer) {
  if (peer?.available === true) {
    return Object.freeze({
      measured: true,
      statement: "A peer comparison is available and is published on the benchmark card. This "
        + "finding does not restate it.",
      reason: null,
    });
  }
  return Object.freeze({
    measured: false,
    statement: "No peer comparison was measured. This finding is your own evidence compared "
      + "against nothing but itself.",
    reason: text(peer?.reason)
      ?? "No cohort scored with the same rubric was available for this import.",
  });
}

/**
 * Evaluate what an imported, incomplete body of evidence supports.
 *
 * @param requiredPeriod `{ start, end }` ISO-8601 calendar dates, half-open.
 * @param currencyCode the one currency figures may be summed in.
 * @param records the reader's own imported period records. Closed field set:
 *   `id`, `providerLabel`, `periodStart`, `periodEnd`, `currencyCode`,
 *   `spendUsd`, `costBasis`, `completeness`, `provenanceLabel`. Anything else on
 *   the object is dropped before any rule runs.
 * @param heldOut exclusions the caller already decided, each `{ id,
 *   providerLabel, code, reason }`.
 * @param review `{ state, gaps }` — open review gaps this evidence is carrying.
 * @param peer `{ available, reason }` — availability only; no figure.
 * @param attribution `{ share }` — the share of dollars joined to an org unit,
 *   or null when nothing was measured.
 * @param source `"import"` or `"example"`, so a surface can label whose it is.
 * @returns a frozen finding: one question, one state, one material slot, one
 *   action, and the disclosure behind them.
 */
export function evaluatePartialEvidence({
  requiredPeriod = null,
  currencyCode: declaredCurrency = "USD",
  records = [],
  heldOut = [],
  review = null,
  peer = null,
  attribution = null,
  source = "import",
} = {}) {
  const period = readRequiredPeriod(requiredPeriod);
  const currency = currencyCode(declaredCurrency);
  const contractErrors = [...period.errors];
  if (!currency) contractErrors.push("currencyCode: expected a three-letter ISO-4217 code");

  const read = (Array.isArray(records) ? records : []).map(readRecord);
  const upstream = (Array.isArray(heldOut) ? heldOut : []).map(upstreamExclusion);
  const reviewState = readReview(review);
  const attributionState = {
    share: Number.isFinite(attribution?.share) ? ratio(attribution.share) : null,
    floor: ATTRIBUTION_FLOOR,
  };

  const usable = [];
  const excluded = [...upstream];
  const seen = new Set();
  // With no valid window nothing can be judged against it, so no per-record rule
  // runs at all: reporting five exclusions for one bad declaration would blame
  // the reader's exports for the caller's mistake.
  if (period.valid && currency) {
    for (const record of read) {
      const exclusion = exclusionFor(record, period, currency, seen);
      if (exclusion) {
        excluded.push(Object.freeze({
          id: record.id,
          label: record.label,
          code: exclusion.code,
          origin: "policy",
          reason: exclusion.reason,
        }));
        continue;
      }
      seen.add(record.id);
      usable.push(record);
    }
  }

  const observedSpendUsd = usable.reduce((sum, record) => sum + record.spendUsd, 0);
  const considered = period.valid && currency ? read.length + upstream.length : upstream.length;
  const partial = usable.length > 0 && (excluded.length > 0 || reviewState.open);
  const state = contractErrors.length > 0 || usable.length === 0
    ? FINDING_STATE.insufficient
    : partial ? FINDING_STATE.partial : FINDING_STATE.supported;

  const material = materialSlot({
    usable, excluded, observedSpendUsd, currency: currency ?? "USD", partial, review: reviewState,
  });

  const headline = state === FINDING_STATE.supported
    ? `Every export you imported is admissible, so ${material.display} is a complete reading of `
      + `${period.start} to ${period.end}.`
    : state === FINDING_STATE.partial
      ? `${material.display} is the floor your admissible evidence supports for ${period.start} `
        + `to ${period.end}. ${plural(excluded.length, "export is", "exports are")} outside it.`
      : contractErrors.length > 0
        ? "This evidence cannot be judged: the window it was to be measured over is not a real "
          + "calendar period."
        : considered === 0
          ? "Nothing has been imported yet, so there is no finding to defend."
          : `No imported export is admissible, so no amount is published. `
            + `${plural(considered, "export was", "exports were")} considered.`;

  return Object.freeze({
    version: PARTIAL_EVIDENCE_VERSION,
    source: source === "example" ? "example" : "import",
    question: PARTIAL_EVIDENCE_QUESTION,
    state,
    partial,
    headline,
    material,
    nextAction: Object.freeze(nextAction({
      usable, excluded, review: reviewState, attribution: attributionState, considered,
    })),
    peer: peerSlot(peer),
    // Progressive disclosure. Everything below is true and none of it is in the
    // way of the three answers above.
    evidence: Object.freeze({
      considered,
      admissible: usable.length,
      excludedCount: excluded.length,
      period: period.valid
        ? `${period.start} to ${period.end} (end exclusive)`
        : "no valid comparison period",
      currency: currency ?? "no valid currency",
      usable: Object.freeze(usable.map((record) => Object.freeze({
        id: record.id,
        label: record.label,
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
        spendUsd: money(record.spendUsd),
        costBasis: record.costBasis,
        completeness: record.completeness,
        provenanceLabel: record.provenanceLabel,
      }))),
      excluded: Object.freeze(excluded),
    }),
    review: reviewState,
    attribution: Object.freeze(attributionState),
    contractErrors: Object.freeze(contractErrors),
    provenance: Object.freeze({
      policy: PARTIAL_EVIDENCE_VERSION,
      processing: "browser_local_ephemeral",
      // Labels, never source material. What a record is attributed to is
      // evidence; the bytes behind it are not this product's to hold.
      labels: Object.freeze([...new Set(read
        .map((record) => record.provenanceLabel)
        .filter(Boolean))].sort()),
    }),
  });
}

/**
 * Adapt a local-finops analysis envelope into this policy's closed input.
 *
 * This is the seam. The analysis carries far more than the policy is allowed to
 * see, so the mapping is written out field by field rather than spread: a field
 * added upstream must be named here before it can reach a rule.
 *
 * The provider records come from the intake plan's accepted periods, and the
 * exclusions come from the same plan's rejections — so the panel and the total
 * cannot disagree about which exports were read.
 */
export function partialEvidenceFromAnalysis({
  analysis = null,
  peer = null,
  attributedShare = null,
  source = "import",
} = {}) {
  const periods = Array.isArray(analysis?.history?.periods) && analysis.history.periods.length
    ? analysis.history.periods
    : analysis?.period
      ? [{ period: analysis.period, spendUsd: analysis?.spendUsd, exportId: null }]
      : [];
  const window = splitPeriodString(analysis?.period);
  const labels = new Map((Array.isArray(analysis?.multiProvider?.providers)
    ? analysis.multiProvider.providers : []).map((entry) => [entry.provider, entry]));
  const primary = [...labels.values()][0] ?? null;
  const records = periods.map((entry, index) => {
    const bounds = splitPeriodString(entry?.period);
    return {
      id: entry?.exportId ?? `period-${index + 1}`,
      providerLabel: primary?.label ?? "Imported provider export",
      periodStart: bounds?.start ?? null,
      periodEnd: bounds?.end ?? null,
      currencyCode: "USD",
      spendUsd: entry?.spendUsd ?? null,
      costBasis: primary?.costBasis ?? null,
      completeness: entry?.completeness ?? null,
      provenanceLabel: primary?.comparabilityNote ?? analysis?.provenance ?? null,
    };
  });
  const gaps = (analysis?.validation?.results ?? []).map((item) => ({
    code: item?.code ?? item?.id ?? null,
    message: item?.message ?? null,
  }));
  return {
    // Every accepted period is judged against the analysis's own current window,
    // widened to the earliest start and latest end the periods declare, because
    // a multi-period history is legitimately wider than its newest month.
    requiredPeriod: widenPeriod(records, window),
    currencyCode: "USD",
    records,
    heldOut: (analysis?.multiProvider?.rejections ?? []).map((entry) => ({
      id: entry?.exportId ?? null,
      providerLabel: entry?.providerLabel ?? entry?.provider ?? null,
      code: entry?.code ?? null,
      reason: [entry?.message, entry?.action].filter(Boolean).join(" ") || null,
    })),
    review: {
      state: analysis?.validation?.state === "needs_review" ? "needs_review" : "valid",
      gaps,
    },
    peer: {
      available: peer?.available === true,
      reason: peer?.unavailable?.reason ?? null,
    },
    attribution: { share: Number.isFinite(attributedShare) ? attributedShare : null },
    source,
  };
}

/** `"2026-06-01 to 2026-07-01"` → validated bounds, or null. */
function splitPeriodString(value) {
  const match = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const start = calendarDate(match[1]);
  const end = calendarDate(match[2]);
  return start && end ? { start, end } : null;
}

/** The union of every record window, so no admissible period falls outside it. */
function widenPeriod(records, fallback) {
  const bounds = records
    .filter((record) => record.periodStart && record.periodEnd)
    .reduce((span, record) => ({
      start: span.start === null || record.periodStart < span.start ? record.periodStart : span.start,
      end: span.end === null || record.periodEnd > span.end ? record.periodEnd : span.end,
    }), { start: null, end: null });
  if (bounds.start && bounds.end) return bounds;
  return fallback ?? { start: null, end: null };
}
