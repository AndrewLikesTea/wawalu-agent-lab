/**
 * The model-overspend finding contract.
 *
 * One question, asked by one person: *where am I paying for a model that a
 * cheaper tier a team of mine already runs would have handled, and how much is
 * that worth per month?*
 *
 * The per-model analysis result is a table. A table is not an answer. This
 * module is the contract that turns it into one: a single ranked finding with
 * one metric, one action, a derived confidence, and the provenance of the
 * customer's own columns it came from. The per-model rows survive as `evidence`,
 * explicitly marked as progressive-disclosure content so the UI knows they are
 * not headline material.
 *
 * WHAT THIS CONTRACT REFUSES TO CARRY.
 *
 *   - No peer or industry benchmark. A single tenant's export contains one
 *     tenant. It supports self-comparison across that tenant's own segments and
 *     periods and nothing else, so the only benchmark field here is scoped
 *     `intra_tenant` and there is no field a UI could read as "versus the
 *     industry". See `docs/model-overspend-finding-contract.md`.
 *   - No third-party rate card. Every rate in this contract is an *observed*
 *     rate — the customer's own spend divided by their own request count. This
 *     repository ships no vendor pricing and reaches none. If the file contains
 *     no cheaper tier, the metric is `available: false` with a reason, never an
 *     estimate.
 *   - No quality claim. Nothing in a usage export can establish that a cheaper
 *     model answers a prompt as well. This contract claims *routing candidacy*
 *     evidenced by the customer's own traffic, and says so in the action text.
 *
 * Money is integer minor units end to end, so two engineers with the same rows
 * and a calculator reproduce every figure exactly. `metric.formula` states the
 * arithmetic in the order it is performed.
 */

export const MODEL_OVERSPEND_FINDING_VERSION = "model-overspend-finding/1.0.0";

/**
 * @typedef {object} ModelPeriodRow One per model, per segment, per period.
 * @property {string} period Calendar month the row covers, `YYYY-MM`.
 * @property {string} segmentId Team or workspace id, as it appears in the file.
 * @property {string} segmentLabel Display label for that segment.
 * @property {string} model Model identifier, verbatim from the file.
 * @property {number|null} requests Requests observed. `null` when the file
 *   carries no request count for this key — never `0` as a stand-in.
 * @property {number} spendMinor Observed spend in USD minor units, integer.
 * @property {number} observedDays Distinct days in the period carrying rows.
 * @property {number} daysInPeriod Calendar days in that month.
 * @property {number} rowCount Source rows aggregated into this row.
 */

/**
 * Every threshold the contract uses. There are no other numbers in the rule.
 * Each is a stated policy line, not a measurement, and each says so.
 */
export const MODEL_OVERSPEND_CONSTANTS = Object.freeze({
  // Below this many requests for a model in a period, no rate is derived from
  // it and no routing change is proposed against it. A thousand requests is the
  // same floor the down-routing rule uses, for the same reason: below it the
  // saving is assumed smaller than the cost of changing routing. It is a
  // judgement about change cost, not a measurement.
  MIN_REQUESTS_PER_MODEL_PERIOD: 1000,

  // A trend claim needs at least this many comparable periods. One period
  // cannot distinguish a standing pattern from a single unusual month.
  MIN_PERIODS_FOR_TREND: 2,

  // An intra-tenant benchmark needs at least this many eligible segments on the
  // same model in the same period; comparing a segment to itself is not a
  // comparison.
  MIN_SEGMENTS_FOR_BENCHMARK: 2,

  // Longest identifier echoed into a headline or action string.
  MAX_LABEL_LENGTH: 64,
});

/** The status shapes. Exactly one is reported, by the precedence below. */
export const MODEL_OVERSPEND_STATUSES = Object.freeze([
  "ok",
  "degraded_single_period",
  "degraded_no_request_counts",
  "degraded_unrecognized_models",
  "unavailable",
]);

export const MODEL_OVERSPEND_CONFIDENCE_LEVELS = Object.freeze(["high", "medium", "low"]);

/**
 * The metric definitions, as data rather than prose in a wiki, so the code and
 * the spec cannot drift. `docs/model-overspend-finding-contract.md` is the
 * reader's copy of these same rules.
 */
export const MODEL_OVERSPEND_METRIC_RULES = Object.freeze({
  denominator:
    "Requests. Not tokens, not sessions, not line items. The denominator for any rate or "
    + "benchmark is the count of requests for one model, in one segment, in one calendar "
    + "month. A file with no request column has no denominator and yields no rate.",
  periodNormalization:
    "Calendar month. A month observed for fewer days than it contains is prorated by "
    + "observed days: normalized = round(observed x daysInPeriod / observedDays), applied "
    + "identically to spend and to requests. Every proration is recorded in "
    + "provenance.proration; an unprorated month records prorated: false.",
  observedRate:
    "A model's rate in a period is its own observed cost per request in this file: the sum "
    + "of normalized spend over that model in that period, pooled across every eligible "
    + "segment, divided by the sum of its normalized requests. No published or vendor rate "
    + "is used, because this contract has access to none.",
  candidateCheaperTier:
    "The nearest cheaper tier: among models in the same period that clear eligibility and "
    + "whose observed cost per request is strictly lower than the named model's, the one "
    + "with the highest such rate. Ties break on model identifier ascending. The nearest "
    + "tier is chosen deliberately over the cheapest, which would inflate the saving.",
  downgradeEligibleVolume:
    "A segment's requests on model M in period P are downgrade-eligible when, in that same "
    + "segment and that same period, this file shows at least "
    + "MIN_REQUESTS_PER_MODEL_PERIOD requests already served by candidate model C. The "
    + "evidence is the customer's own traffic: the segment demonstrably runs C at "
    + "production volume. Eligibility is all-or-nothing per (model, segment, period), "
    + "because an aggregated row carries no per-request detail to split on. This is a "
    + "claim of routing candidacy for review, not of quality equivalence, which no usage "
    + "export can establish.",
  estimatedMonthlyOverspend:
    "estimatedMonthlyOverspendMinor = observedSpendMinor - projectedSpendMinor, where "
    + "observedSpendMinor is the named model's normalized spend for that segment and month, "
    + "and projectedSpendMinor = round(eligibleRequests x candidateSpendMinor / "
    + "candidateRequests) is what those same requests would have cost at the candidate's "
    + "observed rate. Reported only when it is positive; a non-positive result means there "
    + "is nothing to move and is reported as such, not as a saving of zero.",
  benchmarkScope:
    "Intra-tenant only. The named segment's observed cost per request on the named model, "
    + "against the pooled cost per request of this file's other eligible segments on the "
    + "same model in the same period. A single-tenant export cannot support a peer or "
    + "industry benchmark and this contract carries no field for one.",
});

/**
 * Every reason that can lower confidence, each worth one step down the ladder.
 * Emitted in this declared order so output is stable across runs and machines.
 */
const CONFIDENCE_PENALTIES = Object.freeze([
  Object.freeze({
    code: "metric_unavailable",
    detail: "The monthly overspend could not be computed from this file, so the finding "
      + "names a concentration of spend rather than a saving.",
  }),
  Object.freeze({
    code: "single_period",
    detail: "Only one period is present, so a standing pattern cannot be told apart from "
      + "one unusual month.",
  }),
  Object.freeze({
    code: "unrecognized_models_present",
    detail: "Some spend carries a model identifier this contract cannot recognize, so it "
      + "is excluded from the ranking and reported separately.",
  }),
  Object.freeze({
    code: "prorated_partial_month",
    detail: "The reporting month is observed for fewer days than it contains, so spend and "
      + "requests are prorated to a full month.",
  }),
  Object.freeze({
    code: "candidate_rate_pooled_across_segments",
    detail: "The cheaper tier's rate is pooled from more than one segment, so the named "
      + "segment would not necessarily reproduce it exactly.",
  }),
]);

export class ModelOverspendValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "ModelOverspendValidationError";
    this.path = path;
  }
}

function invalid(path, message) {
  throw new ModelOverspendValidationError(path, message);
}

// --- identifiers -----------------------------------------------------------

const LABEL_ALLOWED = /^[A-Za-z0-9 ._:/+-]+$/;
const PLACEHOLDER_LABELS = Object.freeze([
  "", "-", "--", "n/a", "na", "none", "null", "undefined", "unknown", "other", "unspecified",
]);

/**
 * A model identifier is *recognized* structurally, never by matching a list of
 * vendor model names: this repository embeds no third party's catalogue, and a
 * list would silently drop every model released after it was written.
 *
 * Recognized means: collapses to a non-empty token of at most MAX_LABEL_LENGTH
 * characters drawn from an identifier-safe class, containing at least one
 * letter or digit, and not a placeholder the exporter writes when it does not
 * know. Anything else is unrecognized, and unrecognized spend is reported as
 * unattributed rather than guessed at.
 */
export function recognizeIdentifier(value) {
  const collapsed = String(value ?? "").trim().replace(/\s+/g, " ");
  if (PLACEHOLDER_LABELS.includes(collapsed.toLowerCase())) {
    return { recognized: false, label: null, reason: "placeholder_identifier" };
  }
  if (collapsed.length > MODEL_OVERSPEND_CONSTANTS.MAX_LABEL_LENGTH) {
    return { recognized: false, label: null, reason: "identifier_too_long" };
  }
  if (!LABEL_ALLOWED.test(collapsed) || !/[A-Za-z0-9]/.test(collapsed)) {
    return { recognized: false, label: null, reason: "unsupported_characters" };
  }
  return { recognized: true, label: collapsed, reason: null };
}

// --- input validation ------------------------------------------------------

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function integer(value, path, { min = 0 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    invalid(path, `must be an integer of at least ${min}`);
  }
  return value;
}

function nonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim() === "") invalid(path, "must be a non-empty string");
  return value;
}

/** Validate one analysis row. Malformed input fails loudly; it is never coerced. */
export function validateModelPeriodRow(row, path = "row") {
  if (!row || typeof row !== "object" || Array.isArray(row)) invalid(path, "must be an object");
  if (!PERIOD_PATTERN.test(String(row.period))) invalid(`${path}.period`, "must be YYYY-MM");
  nonEmptyString(row.segmentId, `${path}.segmentId`);
  nonEmptyString(row.segmentLabel, `${path}.segmentLabel`);
  if (typeof row.model !== "string") invalid(`${path}.model`, "must be a string");
  if (row.requests !== null) integer(row.requests, `${path}.requests`, { min: 0 });
  integer(row.spendMinor, `${path}.spendMinor`, { min: 0 });
  integer(row.daysInPeriod, `${path}.daysInPeriod`, { min: 28 });
  integer(row.observedDays, `${path}.observedDays`, { min: 1 });
  integer(row.rowCount, `${path}.rowCount`, { min: 1 });
  if (row.observedDays > row.daysInPeriod) {
    invalid(`${path}.observedDays`, "cannot exceed daysInPeriod");
  }
  return row;
}

function validateInput(input) {
  if (!input || typeof input !== "object") invalid("input", "must be an object");
  if (!Array.isArray(input.rows)) invalid("input.rows", "must be an array");
  const columns = input.columns;
  if (!columns || typeof columns !== "object") invalid("input.columns", "must be an object");
  for (const field of ["period", "segment", "model", "spend"]) {
    nonEmptyString(columns[field], `input.columns.${field}`);
  }
  if (columns.requests !== null && typeof columns.requests !== "string") {
    invalid("input.columns.requests", "must be the source column name or null");
  }
  input.rows.forEach((row, index) => validateModelPeriodRow(row, `input.rows[${index}]`));
  const keys = new Set();
  for (const row of input.rows) {
    const key = `${row.period}|${row.segmentId}|${row.model}`;
    if (keys.has(key)) invalid("input.rows", `repeats period/segment/model “${key}”`);
    keys.add(key);
  }
  return input;
}

// --- arithmetic ------------------------------------------------------------

const usd = (minor) => Math.round(minor) / 100;
const money = (minor) => `${usd(minor).toFixed(2)} USD`;

/** Prorate a partial month to a whole one. Spend and requests take the same factor. */
function prorate(value, observedDays, daysInPeriod) {
  if (value === null) return null;
  if (observedDays === daysInPeriod) return value;
  return Math.round((value * daysInPeriod) / observedDays);
}

/**
 * Pooled observed rate for one model in one period. Segments below the request
 * floor contribute neither spend nor requests, so a rate is never dragged by a
 * volume too small to price.
 */
function pooledRate(rows) {
  const eligible = rows.filter((row) => row.requests !== null
    && row.requests >= MODEL_OVERSPEND_CONSTANTS.MIN_REQUESTS_PER_MODEL_PERIOD);
  if (!eligible.length) return null;
  const spendMinor = eligible.reduce((total, row) => total + row.spendMinor, 0);
  const requests = eligible.reduce((total, row) => total + row.requests, 0);
  if (requests <= 0) return null;
  return {
    spendMinor,
    requests,
    segments: eligible.length,
    minorPerRequest: spendMinor / requests,
  };
}

// --- eligibility -----------------------------------------------------------

/**
 * The eligibility rule, as executable code. Every claim this contract can make
 * is gated here, and every gate that fails yields a reason string the UI
 * displays rather than a field that quietly disappears or reads zero.
 *
 * @returns {{overspend: {available: boolean, reason: string|null},
 *            benchmark: {available: boolean, reason: string|null},
 *            trend: {available: boolean, reason: string|null}}}
 */
export function evaluateEligibility({
  modelRecognized = false,
  requestsKnown = false,
  requests = 0,
  candidateAvailable = false,
  candidateRequestsInSegment = 0,
  comparableSegments = 0,
  comparablePeriods = 0,
} = {}) {
  const { MIN_REQUESTS_PER_MODEL_PERIOD: floor, MIN_PERIODS_FOR_TREND: minPeriods,
    MIN_SEGMENTS_FOR_BENCHMARK: minSegments } = MODEL_OVERSPEND_CONSTANTS;

  const overspend = !modelRecognized
    ? "The model identifier on this spend is not recognized, so no rate can be attributed to it."
    : !requestsKnown
      ? "This file carries no request count for the model, so there is no denominator and no "
        + "cost per request to compare."
      : requests < floor
        ? `Fewer than ${floor} requests in the month: below the volume at which a routing `
          + "change is proposed."
        : !candidateAvailable
          ? "No cheaper model clears eligibility in this file for that month, so there is no "
            + "rate to compare against. Nothing is estimated in its place."
          : candidateRequestsInSegment < floor
            ? `This segment does not already run the cheaper model at ${floor} requests or `
              + "more in the month, so its traffic is not evidenced as routable."
            : null;

  const benchmark = !modelRecognized
    ? "The model identifier is not recognized, so segments cannot be compared on it."
    : !requestsKnown
      ? "Without request counts there is no cost per request to compare between segments."
      : comparableSegments < minSegments
        ? `Fewer than ${minSegments} segments clear the request floor on this model, so there `
          + "is nothing within this organization to compare against."
        : null;

  const trend = comparablePeriods < minPeriods
    ? `Fewer than ${minPeriods} comparable periods are present, so no direction of travel `
      + "may be claimed."
    : null;

  return Object.freeze({
    overspend: Object.freeze({ available: overspend === null, reason: overspend }),
    benchmark: Object.freeze({ available: benchmark === null, reason: benchmark }),
    trend: Object.freeze({ available: trend === null, reason: trend }),
  });
}

// --- confidence ------------------------------------------------------------

/** Derived from the eligibility inputs, one step down per distinct reason. Never set by hand. */
function deriveConfidence(flags) {
  const reasons = CONFIDENCE_PENALTIES.filter((penalty) => flags[penalty.code])
    .map((penalty) => Object.freeze({ ...penalty, effect: "lowered one level" }));
  const index = Math.min(reasons.length, MODEL_OVERSPEND_CONFIDENCE_LEVELS.length - 1);
  return Object.freeze({
    level: MODEL_OVERSPEND_CONFIDENCE_LEVELS[index],
    reasons: Object.freeze(reasons),
  });
}

// --- the builder -----------------------------------------------------------

/**
 * Build the one finding this analysis supports.
 *
 * @param {{columns: object, rows: ModelPeriodRow[]}} input the per-model
 *   analysis result plus the customer's own column names behind it.
 * @returns a frozen finding matching MODEL_OVERSPEND_FINDING_VERSION.
 */
export function buildModelOverspendFinding(input) {
  validateInput(input);

  const periods = [...new Set(input.rows.map((row) => row.period))].sort();
  const reportingPeriod = periods.at(-1) ?? null;
  const sourceRowCount = input.rows.reduce((total, row) => total + row.rowCount, 0);
  const requestColumn = typeof input.columns.requests === "string" ? input.columns.requests : null;

  // Normalize every row to a whole calendar month before anything is compared.
  const normalized = input.rows.map((row) => {
    const recognition = recognizeIdentifier(row.model);
    const segment = recognizeIdentifier(row.segmentLabel);
    return {
      period: row.period,
      segmentId: row.segmentId,
      segmentLabel: segment.recognized ? segment.label : "segment (unnamed)",
      model: recognition.label,
      modelRecognized: recognition.recognized,
      unrecognizedReason: recognition.reason,
      requests: prorate(row.requests, row.observedDays, row.daysInPeriod),
      spendMinor: prorate(row.spendMinor, row.observedDays, row.daysInPeriod),
      observedSpendMinor: row.spendMinor,
      prorated: row.observedDays !== row.daysInPeriod,
      observedDays: row.observedDays,
      daysInPeriod: row.daysInPeriod,
      rowCount: row.rowCount,
    };
  });

  const reporting = normalized.filter((row) => row.period === reportingPeriod);
  const recognized = reporting.filter((row) => row.modelRecognized);
  const unrecognized = reporting.filter((row) => !row.modelRecognized);
  const unrecognizedSpendMinor = unrecognized.reduce((total, row) => total + row.spendMinor, 0);
  const anyRequests = reporting.some((row) => row.requests !== null);
  const proratedMonth = reporting.some((row) => row.prorated);

  // Rates, per model, pooled over the segments that clear the request floor.
  const rates = new Map();
  for (const model of new Set(recognized.map((row) => row.model))) {
    const rate = pooledRate(recognized.filter((row) => row.model === model));
    if (rate) rates.set(model, rate);
  }

  const ranked = [];
  for (const row of recognized) {
    const rate = rates.get(row.model);
    const cheaper = [...rates.entries()]
      .filter(([model, other]) => model !== row.model
        && rate && other.minorPerRequest < rate.minorPerRequest)
      .sort(([leftModel, left], [rightModel, right]) =>
        right.minorPerRequest - left.minorPerRequest || leftModel.localeCompare(rightModel))[0];
    const candidateModel = cheaper?.[0] ?? null;
    const candidate = cheaper?.[1] ?? null;
    const candidateInSegment = candidateModel === null ? null
      : recognized.find((other) => other.segmentId === row.segmentId
        && other.model === candidateModel) ?? null;

    const eligibility = evaluateEligibility({
      modelRecognized: true,
      requestsKnown: row.requests !== null,
      requests: row.requests ?? 0,
      candidateAvailable: candidate !== null,
      candidateRequestsInSegment: candidateInSegment?.requests ?? 0,
      comparableSegments: recognized.filter((other) => other.model === row.model
        && other.requests !== null
        && other.requests >= MODEL_OVERSPEND_CONSTANTS.MIN_REQUESTS_PER_MODEL_PERIOD).length,
      comparablePeriods: periods.length,
    });

    if (!eligibility.overspend.available) {
      ranked.push({ row, eligibility, candidateModel, candidate, overspendMinor: null });
      continue;
    }
    const eligibleRequests = row.requests;
    const projectedSpendMinor = Math.round(
      (eligibleRequests * candidate.spendMinor) / candidate.requests,
    );
    ranked.push({
      row,
      eligibility,
      candidateModel,
      candidate,
      // The segment's own volume on the cheaper tier. Kept apart from the
      // pooled `candidate.requests` that forms the rate, because a sentence
      // that shows a leader a number their own team did not run is a wrong
      // sentence even when the arithmetic behind it is right.
      candidateRequestsInSegment: candidateInSegment.requests,
      eligibleRequests,
      projectedSpendMinor,
      overspendMinor: row.spendMinor - projectedSpendMinor,
    });
  }

  // The headline is the largest positive overspend. Every comparator step is
  // total, so the same rows produce the same winner in any input order.
  const priced = ranked.filter((entry) => entry.overspendMinor !== null && entry.overspendMinor > 0)
    .sort((left, right) => right.overspendMinor - left.overspendMinor
      || left.row.model.localeCompare(right.row.model)
      || left.row.segmentId.localeCompare(right.row.segmentId));
  const winner = priced[0] ?? null;

  // Fallback subject when no metric exists: the largest single block of spend,
  // which is still an honest answer to "where is the money".
  const largestSpend = [...recognized].sort((left, right) => right.spendMinor - left.spendMinor
    || left.model.localeCompare(right.model)
    || left.segmentId.localeCompare(right.segmentId))[0] ?? null;

  const status = !anyRequests ? "degraded_no_request_counts"
    : recognized.length === 0 ? "degraded_unrecognized_models"
      : winner === null ? "unavailable"
        : periods.length < MODEL_OVERSPEND_CONSTANTS.MIN_PERIODS_FOR_TREND
          ? "degraded_single_period"
          : "ok";

  const confidence = deriveConfidence({
    metric_unavailable: winner === null,
    single_period: periods.length < MODEL_OVERSPEND_CONSTANTS.MIN_PERIODS_FOR_TREND,
    unrecognized_models_present: unrecognized.length > 0,
    prorated_partial_month: proratedMonth,
    candidate_rate_pooled_across_segments: Boolean(winner && winner.candidate.segments > 1),
  });

  const subject = winner?.row ?? largestSpend ?? null;
  const monthLabel = reportingPeriod ?? "the reporting month";

  const metric = winner
    ? Object.freeze({
      available: true,
      reason: null,
      name: "estimated_monthly_overspend_usd",
      currency: "USD",
      amountMinor: winner.overspendMinor,
      amountUsd: usd(winner.overspendMinor),
      period: reportingPeriod,
      model: winner.row.model,
      segmentId: winner.row.segmentId,
      segmentLabel: winner.row.segmentLabel,
      candidateModel: winner.candidateModel,
      eligibleRequests: winner.eligibleRequests,
      observedSpendMinor: winner.row.spendMinor,
      candidateSpendMinor: winner.candidate.spendMinor,
      candidateRequests: winner.candidate.requests,
      projectedSpendMinor: winner.projectedSpendMinor,
      formula: `projected = round(${winner.eligibleRequests} requests x `
        + `${winner.candidate.spendMinor} minor / ${winner.candidate.requests} requests) = `
        + `${winner.projectedSpendMinor} minor; overspend = ${winner.row.spendMinor} - `
        + `${winner.projectedSpendMinor} = ${winner.overspendMinor} minor`,
    })
    : Object.freeze({
      available: false,
      reason: unavailableMetricReason(status, ranked),
      name: "estimated_monthly_overspend_usd",
      currency: "USD",
      amountMinor: null,
      amountUsd: null,
      period: reportingPeriod,
      model: subject?.model ?? null,
      segmentId: subject?.segmentId ?? null,
      segmentLabel: subject?.segmentLabel ?? null,
      candidateModel: null,
      eligibleRequests: null,
      observedSpendMinor: subject?.spendMinor ?? null,
      candidateSpendMinor: null,
      candidateRequests: null,
      projectedSpendMinor: null,
      formula: null,
    });

  return Object.freeze({
    schemaVersion: MODEL_OVERSPEND_FINDING_VERSION,
    status,
    question: `In ${monthLabel}, where am I paying for a model that a cheaper tier one of my `
      + "own teams already runs would have handled?",
    headline: buildHeadline({ status, winner, subject, monthLabel, unrecognizedSpendMinor }),
    metric,
    action: buildAction({ winner, subject, monthLabel, status }),
    confidence,
    benchmark: buildBenchmark({ winner, recognized, reportingPeriod }),
    provenance: Object.freeze({
      columns: Object.freeze({
        period: input.columns.period,
        segment: input.columns.segment,
        model: input.columns.model,
        requests: requestColumn,
        spend: input.columns.spend,
      }),
      periods: Object.freeze([...periods]),
      reportingPeriod,
      sourceRowCount,
      analysisRowCount: input.rows.length,
      proration: Object.freeze({
        prorated: proratedMonth,
        rule: MODEL_OVERSPEND_METRIC_RULES.periodNormalization,
        months: Object.freeze(reporting.filter((row) => row.prorated).map((row) => Object.freeze({
          model: row.model, segmentId: row.segmentId,
          observedDays: row.observedDays, daysInPeriod: row.daysInPeriod,
        }))),
      }),
      unrecognizedModelSpendMinor: unrecognizedSpendMinor,
    }),
    evidence: buildEvidence({ ranked, unrecognized, winner }),
  });
}

function unavailableMetricReason(status, ranked) {
  if (status === "degraded_no_request_counts") {
    return "This file carries no request count, so no cost per request exists for any model "
      + "and no overspend can be computed. Spend totals are still exact.";
  }
  if (status === "degraded_unrecognized_models") {
    return "No spend in the reporting month carries a model identifier this contract "
      + "recognizes, so no model can be named and no rate attributed.";
  }
  const blocked = ranked.find((entry) => entry.eligibility.overspend.reason);
  return blocked?.eligibility.overspend.reason
    ?? "No model in this file costs more per request than a cheaper tier its own segment "
      + "already runs, so there is nothing to move.";
}

function buildHeadline({ status, winner, subject, monthLabel, unrecognizedSpendMinor }) {
  if (winner) {
    return `${winner.row.segmentLabel} spent ${money(winner.row.spendMinor)} on `
      + `${winner.row.model} in ${monthLabel}; the same requests at this file's own observed `
      + `rate for ${winner.candidateModel} would have cost `
      + `${money(winner.projectedSpendMinor)}.`;
  }
  if (status === "degraded_no_request_counts") {
    return subject
      ? `${subject.segmentLabel} carries the largest block of model spend in ${monthLabel}, `
        + `${money(subject.spendMinor)} on ${subject.model}. Whether a cheaper tier would `
        + "have handled it cannot be answered without a request count."
      : `No model spend is present for ${monthLabel}.`;
  }
  if (status === "degraded_unrecognized_models") {
    return `${money(unrecognizedSpendMinor)} of spend in ${monthLabel} carries no recognizable `
      + "model identifier, so it cannot be attributed to a model or compared to a cheaper tier.";
  }
  return subject
    ? `No model in ${monthLabel} costs more per request than a cheaper tier the same segment `
      + `already runs. The largest block of spend is ${money(subject.spendMinor)} on `
      + `${subject.model} in ${subject.segmentLabel}.`
    : `No model spend is present for ${monthLabel}.`;
}

/** One next step, or one plain statement of why there is none. Never both, never neither. */
function buildAction({ winner, subject, monthLabel, status }) {
  if (winner) {
    return Object.freeze({
      available: true,
      text: `Route ${winner.row.segmentLabel}'s ${winner.row.model} traffic to `
        + `${winner.candidateModel}, the tier that segment already ran for `
        + `${winner.candidateRequestsInSegment} requests in ${monthLabel}. Confirm output `
        + "quality on a sample before moving production traffic: this file evidences routing "
        + "candidacy, not equivalence.",
      reason: null,
    });
  }
  if (status === "degraded_no_request_counts") {
    return Object.freeze({
      available: false,
      text: null,
      reason: "Re-import with the request-count column mapped. Without it no rate can be "
        + "derived and no routing recommendation is honest.",
    });
  }
  if (status === "degraded_unrecognized_models") {
    return Object.freeze({
      available: false,
      text: null,
      reason: "Map the column that carries the model or SKU identifier, or correct the values "
        + "that read as placeholders, then re-import.",
    });
  }
  return Object.freeze({
    available: false,
    text: null,
    reason: subject
      ? "No cheaper tier in this file clears eligibility against the spend that is present, "
        + "so no routing change is proposed."
      : "There is no model spend in the reporting month to act on.",
  });
}

/**
 * Intra-tenant only, and named so in the payload. There is deliberately no
 * field here a UI could render as a peer or industry comparison.
 */
function buildBenchmark({ winner, recognized, reportingPeriod }) {
  const base = { scope: "intra_tenant", period: reportingPeriod };
  if (!winner) {
    return Object.freeze({
      ...base,
      available: false,
      reason: "No model and segment is named, so there is nothing to compare within this "
        + "organization.",
      model: null, segmentCostPerRequestMinor: null,
      otherSegmentsCostPerRequestMinor: null, otherSegments: 0,
    });
  }
  const peers = recognized.filter((row) => row.model === winner.row.model
    && row.segmentId !== winner.row.segmentId
    && row.requests !== null
    && row.requests >= MODEL_OVERSPEND_CONSTANTS.MIN_REQUESTS_PER_MODEL_PERIOD);
  if (!winner.eligibility.benchmark.available || peers.length === 0) {
    return Object.freeze({
      ...base,
      available: false,
      reason: winner.eligibility.benchmark.reason
        ?? `Fewer than ${MODEL_OVERSPEND_CONSTANTS.MIN_SEGMENTS_FOR_BENCHMARK} segments clear `
          + "the request floor on this model, so there is nothing within this organization to "
          + "compare against.",
      model: winner.row.model, segmentCostPerRequestMinor: null,
      otherSegmentsCostPerRequestMinor: null, otherSegments: 0,
    });
  }
  const peerSpend = peers.reduce((total, row) => total + row.spendMinor, 0);
  const peerRequests = peers.reduce((total, row) => total + row.requests, 0);
  return Object.freeze({
    ...base,
    available: true,
    reason: null,
    model: winner.row.model,
    segmentCostPerRequestMinor: winner.row.spendMinor / winner.row.requests,
    otherSegmentsCostPerRequestMinor: peerSpend / peerRequests,
    otherSegments: peers.length,
  });
}

/**
 * The per-model rows, demoted. `disclosure: "progressive"` is the contract's
 * instruction to the UI: this is what a reader opens *after* the headline, not
 * a table to lead with.
 */
function buildEvidence({ ranked, unrecognized, winner }) {
  const rows = ranked
    .map((entry) => Object.freeze({
      model: entry.row.model,
      segmentId: entry.row.segmentId,
      segmentLabel: entry.row.segmentLabel,
      requests: entry.row.requests,
      spendMinor: entry.row.spendMinor,
      spendUsd: usd(entry.row.spendMinor),
      costPerRequestMinor: entry.row.requests ? entry.row.spendMinor / entry.row.requests : null,
      candidateModel: entry.candidateModel,
      overspendMinor: entry.overspendMinor,
      isHeadline: entry === winner,
      excludedReason: entry.eligibility.overspend.reason,
      sourceRowCount: entry.row.rowCount,
    }))
    .sort((left, right) => right.spendMinor - left.spendMinor
      || left.model.localeCompare(right.model)
      || left.segmentId.localeCompare(right.segmentId));
  const unattributed = unrecognized.map((row) => Object.freeze({
    segmentId: row.segmentId,
    segmentLabel: row.segmentLabel,
    spendMinor: row.spendMinor,
    spendUsd: usd(row.spendMinor),
    reason: row.unrecognizedReason,
    sourceRowCount: row.rowCount,
  })).sort((left, right) => right.spendMinor - left.spendMinor
    || left.segmentId.localeCompare(right.segmentId));
  return Object.freeze({
    disclosure: "progressive",
    note: "Supporting per-model rows. Not headline material: the headline is one finding, and "
      + "these are what it was chosen from.",
    rows: Object.freeze(rows),
    unattributedRows: Object.freeze(unattributed),
  });
}

// --- output validation -----------------------------------------------------

const FINDING_KEYS = Object.freeze([
  "schemaVersion", "status", "question", "headline", "metric", "action",
  "confidence", "benchmark", "provenance", "evidence",
]);

const BENCHMARK_KEYS = Object.freeze([
  "scope", "period", "available", "reason", "model",
  "segmentCostPerRequestMinor", "otherSegmentsCostPerRequestMinor", "otherSegments",
]);

// Matched without word boundaries, because the field that smuggles a peer claim
// back in will be named `industryAverageMinor`, not `industry`.
const PEER_BENCHMARK_PATTERN = /peer|industry|market|competitor|percentile|cohort/i;

/** Every key in the payload, at any depth. Arrays contribute their items' keys. */
function everyKey(value, keys = []) {
  if (Array.isArray(value)) value.forEach((item) => everyKey(item, keys));
  else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key);
      everyKey(nested, keys);
    }
  }
  return keys;
}

/**
 * Validate a finding against the contract. This is the gate the UI can trust:
 * a payload that passes has exactly the declared fields, a derived confidence,
 * an explicit reason wherever something is unavailable, and no field that
 * invites a peer-benchmark reading.
 */
export function validateModelOverspendFinding(finding, path = "finding") {
  if (!finding || typeof finding !== "object") invalid(path, "must be an object");
  if (finding.schemaVersion !== MODEL_OVERSPEND_FINDING_VERSION) {
    invalid(`${path}.schemaVersion`, `must be ${MODEL_OVERSPEND_FINDING_VERSION}`);
  }
  const unknown = Object.keys(finding).find((key) => !FINDING_KEYS.includes(key));
  if (unknown) invalid(path, `carries undeclared field “${unknown}”`);
  const missing = FINDING_KEYS.find((key) => !(key in finding));
  if (missing) invalid(path, `is missing required field “${missing}”`);
  if (!MODEL_OVERSPEND_STATUSES.includes(finding.status)) {
    invalid(`${path}.status`, "is not a declared status");
  }
  nonEmptyString(finding.question, `${path}.question`);
  nonEmptyString(finding.headline, `${path}.headline`);

  const { metric } = finding;
  if (metric.name !== "estimated_monthly_overspend_usd") {
    invalid(`${path}.metric.name`, "must be estimated_monthly_overspend_usd");
  }
  if (metric.currency !== "USD") invalid(`${path}.metric.currency`, "must be USD");
  if (metric.available) {
    integer(metric.amountMinor, `${path}.metric.amountMinor`, { min: 1 });
    integer(metric.eligibleRequests, `${path}.metric.eligibleRequests`, {
      min: MODEL_OVERSPEND_CONSTANTS.MIN_REQUESTS_PER_MODEL_PERIOD,
    });
    integer(metric.candidateRequests, `${path}.metric.candidateRequests`, { min: 1 });
    nonEmptyString(metric.model, `${path}.metric.model`);
    nonEmptyString(metric.candidateModel, `${path}.metric.candidateModel`);
    nonEmptyString(metric.formula, `${path}.metric.formula`);
    if (metric.observedSpendMinor - metric.projectedSpendMinor !== metric.amountMinor) {
      invalid(`${path}.metric.amountMinor`, "does not equal observed minus projected spend");
    }
    if (metric.amountUsd !== usd(metric.amountMinor)) {
      invalid(`${path}.metric.amountUsd`, "does not match amountMinor");
    }
  } else {
    nonEmptyString(metric.reason, `${path}.metric.reason`);
    if (metric.amountMinor !== null) {
      invalid(`${path}.metric.amountMinor`, "must be null when the metric is unavailable, "
        + "never zero: zero reads as a measured result");
    }
  }

  if (finding.action.available) nonEmptyString(finding.action.text, `${path}.action.text`);
  else nonEmptyString(finding.action.reason, `${path}.action.reason`);

  if (!MODEL_OVERSPEND_CONFIDENCE_LEVELS.includes(finding.confidence.level)) {
    invalid(`${path}.confidence.level`, "is not a declared level");
  }
  if (!Array.isArray(finding.confidence.reasons)) {
    invalid(`${path}.confidence.reasons`, "must be an array");
  }
  const derived = deriveConfidence(Object.fromEntries(
    finding.confidence.reasons.map((reason) => [reason.code, true]),
  ));
  if (derived.level !== finding.confidence.level) {
    invalid(`${path}.confidence.level`, "is not derived from its own reasons; confidence is "
      + "computed from eligibility, never asserted");
  }
  for (const [index, reason] of finding.confidence.reasons.entries()) {
    if (!CONFIDENCE_PENALTIES.some((penalty) => penalty.code === reason.code)) {
      invalid(`${path}.confidence.reasons[${index}].code`, "is not a declared penalty");
    }
  }

  if (finding.benchmark.scope !== "intra_tenant") {
    invalid(`${path}.benchmark.scope`, "must be intra_tenant: a single-tenant export cannot "
      + "support any other scope");
  }
  if (!finding.benchmark.available) nonEmptyString(finding.benchmark.reason, `${path}.benchmark.reason`);
  const strayBenchmarkKey = Object.keys(finding.benchmark)
    .find((key) => !BENCHMARK_KEYS.includes(key));
  if (strayBenchmarkKey) {
    invalid(`${path}.benchmark.${strayBenchmarkKey}`, "is not a declared benchmark field");
  }
  // The one claim this data cannot support, guarded at every depth: a single
  // tenant's export contains one tenant, so nothing here may be named as a
  // comparison against anyone else.
  const peerKey = everyKey(finding).find((key) => PEER_BENCHMARK_PATTERN.test(key));
  if (peerKey) {
    invalid(`${path}.${peerKey}`, "names a comparison outside this tenant, which a "
      + "single-tenant export cannot support");
  }

  const { provenance } = finding;
  nonEmptyString(provenance.columns.model, `${path}.provenance.columns.model`);
  nonEmptyString(provenance.columns.spend, `${path}.provenance.columns.spend`);
  if (!Array.isArray(provenance.periods) || provenance.periods.length === 0) {
    invalid(`${path}.provenance.periods`, "must list at least one period");
  }
  integer(provenance.sourceRowCount, `${path}.provenance.sourceRowCount`, { min: 1 });
  if (metric.available && provenance.columns.requests === null) {
    invalid(`${path}.provenance.columns.requests`, "must name the source column whenever a "
      + "per-request metric is reported");
  }

  if (finding.evidence.disclosure !== "progressive") {
    invalid(`${path}.evidence.disclosure`, "must be progressive: per-model rows are never "
      + "headline material");
  }
  if (!Array.isArray(finding.evidence.rows)) invalid(`${path}.evidence.rows`, "must be an array");
  return finding;
}
