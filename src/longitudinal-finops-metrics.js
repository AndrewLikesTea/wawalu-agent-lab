/**
 * Executable metric definitions for the browser-local longitudinal FinOps view.
 *
 * The one question this contract answers: **which department's spend has moved
 * far enough from its own recent baseline that a leader should intervene this
 * period, and can that number be trusted?** Every rule below is pinned to a
 * formula, a rounding rule, and a tie/edge behaviour so two engineers compute
 * the same value.
 *
 * Deliberately out of scope: any view, chart, route, or export surface; a peer
 * or industry benchmark (the imported local contracts carry no cohort); a
 * forecast; a causal claim; currency conversion; per-employee detail; and any
 * claim of realized savings.
 *
 * Locality: this module has no fetch, storage, clock, randomness, or credential
 * path. It transforms a value already parsed in the tab and returns a frozen
 * projection, so imported records stay browser-local for the session.
 */

export const LONGITUDINAL_FINOPS_SCHEMA_VERSION = "longitudinal-finops/1.0.0";

/** The only currency comparable without an exchange-rate transfer. */
export const SUPPORTED_CURRENCY = "USD";

/** The locally supplied fields a record may declare as its derivation source. */
export const LOCAL_FIELD_CATALOG = Object.freeze([
  "local.hris_export.org_unit_id",
  "local.provider_export.cost.amount_minor",
  "local.provider_export.snapshot.period_start",
]);

/** A finding is fully supported only when every one of these is present. */
export const REQUIRED_PROVENANCE_FIELDS = Object.freeze([
  "local.hris_export.org_unit_id",
  "local.provider_export.cost.amount_minor",
  "local.provider_export.snapshot.period_start",
]);

/** Three periods is the shortest history that shows a baseline and a move off it. */
export const MINIMUM_BENCHMARK_PERIODS = 3;

/** Ordered weakest to strongest; index is the comparable rank. */
export const CONFIDENCE_LEVELS = Object.freeze(["none", "low", "medium", "high"]);

/** Checked in this order; the first failing predicate names the reason. */
export const BENCHMARK_INELIGIBILITY_REASONS = Object.freeze([
  "insufficient_history",
  "period_gap",
  "null_spend",
]);

/** Checked in this order; the first failing predicate names the reason. */
export const TREND_UNAVAILABLE_REASONS = Object.freeze([
  "insufficient_history",
  "non_adjacent_comparison_window",
  "null_spend_in_comparison_window",
  "zero_prior_period_spend",
]);

export const LONGITUDINAL_METRIC_RULES = Object.freeze({
  trend:
    "Comparison window is the department's two most recent period labels in"
    + " ascending ISO order: prior = second-to-last, current = last."
    + " changeUsd = currentSpend - priorSpend; changePercent = changeUsd / priorSpend"
    + " x 100. A positive value always means spend increased. changePercent is"
    + " rounded to one decimal, half away from zero, so an increase and a decrease"
    + " of the same magnitude round identically. A zero prior period yields"
    + " state unavailable with reason zero_prior_period_spend and a null percentage;"
    + " changeUsd is still reported because subtraction is defined.",
  departmentComparison:
    "Departments are ranked by current-period spend, descending, so the largest"
    + " exposure is first. Equal spend breaks by ascending departmentId. A"
    + " department whose current period has null spend is not dropped: it is"
    + " marked comparable false with reason null_current_period_spend and sorted"
    + " after every comparable department, by ascending departmentId.",
  benchmarkEligibility:
    "A department receives a benchmark only when it has at least"
    + " MINIMUM_BENCHMARK_PERIODS records, its period labels form a gapless"
    + " consecutive calendar-month sequence, and every record has non-null spend."
    + " Failing the predicate produces eligible false with a reason code from"
    + " BENCHMARK_INELIGIBILITY_REASONS and a null baseline, never a zero"
    + " benchmark and never an omitted row.",
  benchmarkBaseline:
    "The material benchmark is the department's own trailing baseline: the mean"
    + " of every period before the current one, rounded half away from zero to"
    + " whole USD. No peer or industry cohort is invented, because the imported"
    + " local contracts contain none. varianceUsd = currentSpend - baselineUsd;"
    + " variancePercent = varianceUsd / baselineUsd x 100, one decimal, half away"
    + " from zero. A zero baseline yields a null percentage with reason"
    + " zero_benchmark_baseline.",
  confidence:
    "Exactly one level from CONFIDENCE_LEVELS, first match wins: high when the"
    + " benchmark is eligible, the trend is available, and provenance is"
    + " complete; medium when the benchmark is eligible but the trend or"
    + " provenance is not; low when the benchmark is ineligible but at least two"
    + " periods carry non-null spend; none otherwise.",
  provenance:
    "A finding's supporting fields are the intersection of derivedFromFields"
    + " across every record of that department, because a field absent from any"
    + " contributing period cannot support a figure spanning them. missingFields"
    + " is REQUIRED_PROVENANCE_FIELDS minus that intersection. When missingFields"
    + " is non-empty the finding is incomplete and its rendered statement names"
    + " each missing field, so no bare number is ever presented.",
  actionPriority:
    "Findings are ordered by: descending confidence rank; then descending"
    + " benchmark varianceUsd with null variance last; then descending"
    + " current-period spend with null spend last; then ascending departmentId,"
    + " which is unique and makes the order total. The same fixture therefore"
    + " always yields the same top action.",
});

export class LongitudinalFinopsError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "LongitudinalFinopsError";
    this.path = path;
  }
}

function invalid(path, message) {
  throw new LongitudinalFinopsError(path, message);
}

const RECORD_KEYS = ["departmentId", "periodLabel", "spendUsd", "currency", "provenance"];
const DEPARTMENT_ID_PATTERN = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PERIOD_LABEL_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/**
 * Round half away from zero. JavaScript's Math.round breaks halves toward
 * positive infinity, so -12.75 would become -12.7 while 12.75 became 12.8 and a
 * 1.275% rise and fall would print different magnitudes. This is the single
 * rounding rule for every displayed number in this contract.
 */
function roundHalfAwayFromZero(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(value) * factor) / factor;
  return value < 0 ? -rounded : rounded;
}

/** The month after `period`, so a gap in the sequence can be detected exactly. */
function nextPeriod(period) {
  const [year, index] = period.split("-").map(Number);
  return index === 12
    ? `${year + 1}-01`
    : `${year}-${String(index + 1).padStart(2, "0")}`;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function validateRecord(input, index) {
  const path = `records[${index}]`;
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid(path, "must be an object");
  const unknown = Object.keys(input).find((key) => !RECORD_KEYS.includes(key));
  if (unknown) invalid(path, `must not contain undeclared field "${unknown}"`);
  for (const key of RECORD_KEYS) {
    if (!(key in input)) invalid(`${path}.${key}`, "is required");
  }
  if (typeof input.departmentId !== "string"
    || !DEPARTMENT_ID_PATTERN.test(input.departmentId))
    invalid(`${path}.departmentId`, "must be a syn- prefixed synthetic slug");
  if (typeof input.periodLabel !== "string" || !PERIOD_LABEL_PATTERN.test(input.periodLabel))
    invalid(`${path}.periodLabel`, "must be an ISO year-month (YYYY-MM)");
  // Null is the only permitted absence. Zero is a measurement, not a gap.
  if (input.spendUsd !== null
    && (!Number.isSafeInteger(input.spendUsd) || input.spendUsd < 0))
    invalid(`${path}.spendUsd`, "must be null or a non-negative safe integer in whole USD");
  if (input.currency !== SUPPORTED_CURRENCY)
    invalid(`${path}.currency`, `must be ${SUPPORTED_CURRENCY}; this contract does not convert currency`);

  const provenance = input.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance))
    invalid(`${path}.provenance`, "must be an object");
  if (typeof provenance.source !== "string" || !/synthetic/i.test(provenance.source))
    invalid(`${path}.provenance.source`, "must name a synthetic source");
  if (!Array.isArray(provenance.derivedFromFields) || provenance.derivedFromFields.length === 0)
    invalid(`${path}.provenance.derivedFromFields`, "must be a non-empty array");
  const fields = [...provenance.derivedFromFields];
  for (const [fieldIndex, field] of fields.entries()) {
    if (!LOCAL_FIELD_CATALOG.includes(field))
      invalid(`${path}.provenance.derivedFromFields[${fieldIndex}]`,
        "must name a field in LOCAL_FIELD_CATALOG");
  }
  if (new Set(fields).size !== fields.length)
    invalid(`${path}.provenance.derivedFromFields`, "must not contain duplicates");
  // A null spend cannot have been derived from an amount, and a non-null one
  // must have been. Otherwise provenance would be decorative.
  const declaresAmount = fields.includes("local.provider_export.cost.amount_minor");
  if (input.spendUsd === null && declaresAmount)
    invalid(`${path}.provenance.derivedFromFields`,
      "must not claim an amount field when spend is null");
  if (input.spendUsd !== null && !declaresAmount)
    invalid(`${path}.provenance.derivedFromFields`,
      "must declare local.provider_export.cost.amount_minor when spend is present");

  return {
    departmentId: input.departmentId,
    periodLabel: input.periodLabel,
    spendUsd: input.spendUsd,
    currency: input.currency,
    provenanceSource: provenance.source,
    derivedFromFields: fields.sort(),
  };
}

/** DEFINITION 3 (predicate half): min periods, no gaps, no null spend. */
function evaluateBenchmarkEligibility(periods) {
  if (periods.length < MINIMUM_BENCHMARK_PERIODS) {
    return {
      eligible: false,
      reasonCode: "insufficient_history",
      reason: `Only ${periods.length} reporting period${periods.length === 1 ? "" : "s"}`
        + ` supplied; ${MINIMUM_BENCHMARK_PERIODS} consecutive periods are required`
        + " before a trailing baseline can be computed.",
    };
  }
  for (let index = 1; index < periods.length; index += 1) {
    const expected = nextPeriod(periods[index - 1].periodLabel);
    if (periods[index].periodLabel !== expected) {
      return {
        eligible: false,
        reasonCode: "period_gap",
        reason: `The period sequence is not consecutive; ${expected} is missing`
          + " between the supplied periods, so no like-for-like baseline exists.",
      };
    }
  }
  const missing = periods.find((period) => period.spendUsd === null);
  if (missing) {
    return {
      eligible: false,
      reasonCode: "null_spend",
      reason: `Spend for ${missing.periodLabel} was not supplied; an unmeasured`
        + " period cannot be silently treated as zero inside a baseline.",
    };
  }
  return { eligible: true, reasonCode: null, reason: null };
}

/** DEFINITION 3 (value half) plus the trailing-baseline benchmark. */
function buildBenchmark(periods) {
  const eligibility = evaluateBenchmarkEligibility(periods);
  if (!eligibility.eligible) {
    return {
      eligible: false,
      reasonCode: eligibility.reasonCode,
      reason: eligibility.reason,
      basis: null,
      baselineUsd: null,
      baselinePeriods: [],
      varianceUsd: null,
      variancePercent: null,
      varianceReasonCode: eligibility.reasonCode,
    };
  }
  const prior = periods.slice(0, -1);
  const current = periods.at(-1);
  const baselineUsd = roundHalfAwayFromZero(
    prior.reduce((total, period) => total + period.spendUsd, 0) / prior.length, 0,
  );
  const varianceUsd = current.spendUsd - baselineUsd;
  return {
    eligible: true,
    reasonCode: null,
    reason: null,
    basis: "own_trailing_mean",
    baselineUsd,
    baselinePeriods: prior.map((period) => period.periodLabel),
    varianceUsd,
    // A zero baseline has no defined proportional distance. The absolute
    // variance stays, because subtraction is still defined.
    variancePercent: baselineUsd === 0
      ? null : roundHalfAwayFromZero((varianceUsd / baselineUsd) * 100, 1),
    varianceReasonCode: baselineUsd === 0 ? "zero_benchmark_baseline" : null,
  };
}

/** DEFINITION 1: period-over-period change across the two newest periods. */
function buildTrend(periods) {
  const unavailable = (reasonCode, reason, changeUsd = null, window = null) => ({
    state: "unavailable",
    comparisonWindow: window,
    changeUsd,
    changePercent: null,
    direction: null,
    reasonCode,
    reason,
  });
  if (periods.length < 2) {
    return unavailable("insufficient_history",
      "One reporting period cannot establish a period-over-period change.");
  }
  const prior = periods.at(-2);
  const current = periods.at(-1);
  const window = [prior.periodLabel, current.periodLabel];
  if (nextPeriod(prior.periodLabel) !== current.periodLabel) {
    return unavailable("non_adjacent_comparison_window",
      `${prior.periodLabel} and ${current.periodLabel} are not adjacent months, so`
      + " the change between them is not a period-over-period movement.", null, window);
  }
  if (prior.spendUsd === null || current.spendUsd === null) {
    return unavailable("null_spend_in_comparison_window",
      `Spend was not supplied for ${prior.spendUsd === null ? prior.periodLabel : current.periodLabel},`
      + " so no change can be computed without inventing a value.", null, window);
  }
  const changeUsd = current.spendUsd - prior.spendUsd;
  if (prior.spendUsd === 0) {
    return unavailable("zero_prior_period_spend",
      `${prior.periodLabel} spend is zero, so a percentage change has no defined`
      + " denominator; the absolute change is reported instead.", changeUsd, window);
  }
  return {
    state: "available",
    comparisonWindow: window,
    changeUsd,
    // Sign convention: positive always means spend went up.
    changePercent: roundHalfAwayFromZero((changeUsd / prior.spendUsd) * 100, 1),
    direction: changeUsd > 0 ? "increase" : changeUsd < 0 ? "decrease" : "no_change",
    reasonCode: null,
    reason: null,
  };
}

/** DEFINITION 5: which locally supplied fields support this finding. */
export function renderProvenance(periods) {
  const declared = periods.map((period) => new Set(period.derivedFromFields));
  // Intersection, not union: a field absent from any contributing period cannot
  // support a figure that spans them all.
  const supportingFields = LOCAL_FIELD_CATALOG.filter(
    (field) => declared.every((set) => set.has(field)),
  );
  const missingFields = REQUIRED_PROVENANCE_FIELDS.filter(
    (field) => !supportingFields.includes(field),
  );
  const complete = missingFields.length === 0;
  return {
    complete,
    supportingFields,
    missingFields,
    contributingPeriodCount: periods.length,
    statement: complete
      ? `Derived from ${supportingFields.join(", ")} across all `
        + `${periods.length} supplied period${periods.length === 1 ? "" : "s"}, in this browser only.`
      : `${missingFields.join(", ")} ${missingFields.length === 1 ? "is" : "are"} not`
        + " declared by every contributing record, so this figure is not fully"
        + " supported and must not be read as a measured amount.",
  };
}

/** DEFINITION 4: exactly one enumerated level, first match wins. */
function resolveConfidence(benchmark, trend, provenance, periods) {
  const nonNullPeriods = periods.filter((period) => period.spendUsd !== null).length;
  const level = benchmark.eligible
    ? (trend.state === "available" && provenance.complete ? "high" : "medium")
    : (nonNullPeriods >= 2 ? "low" : "none");
  return {
    level,
    rank: CONFIDENCE_LEVELS.indexOf(level),
    basis: [
      `benchmark ${benchmark.eligible ? "eligible" : `ineligible (${benchmark.reasonCode})`}`,
      `trend ${trend.state === "available" ? "available" : `unavailable (${trend.reasonCode})`}`,
      `provenance ${provenance.complete ? "complete" : "incomplete"}`,
      `${nonNullPeriods} of ${periods.length} periods carry non-null spend`,
    ],
  };
}

function buildFinding(departmentId, records) {
  const periods = [...records].sort((left, right) =>
    left.periodLabel.localeCompare(right.periodLabel));
  const current = periods.at(-1);
  const benchmark = buildBenchmark(periods);
  const trend = buildTrend(periods);
  const provenance = renderProvenance(periods);
  return {
    departmentId,
    currency: SUPPORTED_CURRENCY,
    periodCount: periods.length,
    periods: periods.map((period) => ({
      periodLabel: period.periodLabel,
      spendUsd: period.spendUsd,
      derivedFromFields: period.derivedFromFields,
    })),
    currentPeriodLabel: current.periodLabel,
    currentSpendUsd: current.spendUsd,
    // DEFINITION 2 companion: a department is never dropped for missing spend.
    comparison: {
      comparable: current.spendUsd !== null,
      reasonCode: current.spendUsd === null ? "null_current_period_spend" : null,
      reason: current.spendUsd === null
        ? `Spend for ${current.periodLabel} was not supplied, so this department`
          + " cannot be ranked against departments that reported one."
        : null,
      rank: null,
    },
    trend,
    benchmark,
    provenance,
    confidence: resolveConfidence(benchmark, trend, provenance, periods),
  };
}

/** DEFINITION 2: the total order used to rank departments against each other. */
export function compareDepartmentFindings(left, right) {
  // Non-comparable departments are ordered last, never removed.
  if (left.comparison.comparable !== right.comparison.comparable)
    return left.comparison.comparable ? -1 : 1;
  if (left.comparison.comparable && left.currentSpendUsd !== right.currentSpendUsd)
    return right.currentSpendUsd - left.currentSpendUsd;
  return left.departmentId.localeCompare(right.departmentId);
}

/** Nulls sort last under a descending comparison, without becoming zero. */
function descendingWithNullsLast(left, right) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

/** DEFINITION 6: the deterministic ordering function over findings. */
export function compareActionPriority(left, right) {
  return (right.confidence.rank - left.confidence.rank)
    || descendingWithNullsLast(left.benchmark.varianceUsd, right.benchmark.varianceUsd)
    || descendingWithNullsLast(left.currentSpendUsd, right.currentSpendUsd)
    || left.departmentId.localeCompare(right.departmentId);
}

/**
 * The sentence a finding must be rendered with. A number never travels without
 * the fields that support it, and an unsupported number says so first.
 */
export function describeFinding(finding) {
  const { departmentId, currentPeriodLabel, currentSpendUsd, benchmark, trend } = finding;
  const spend = currentSpendUsd === null
    ? `${currentPeriodLabel} spend was not supplied`
    : `${currentPeriodLabel} spend is ${currentSpendUsd} ${SUPPORTED_CURRENCY}`;
  const against = benchmark.eligible
    ? `${benchmark.varianceUsd >= 0 ? "+" : ""}${benchmark.varianceUsd} ${SUPPORTED_CURRENCY}`
      + `${benchmark.variancePercent === null
        ? " against a zero trailing baseline"
        : ` (${benchmark.variancePercent > 0 ? "+" : ""}${benchmark.variancePercent}%)`
          + ` against its own trailing baseline of ${benchmark.baselineUsd} ${SUPPORTED_CURRENCY}`}`
    : `no benchmark (${benchmark.reasonCode})`;
  const movement = trend.state === "available"
    ? `period-over-period ${trend.direction} of ${trend.changePercent > 0 ? "+" : ""}`
      + `${trend.changePercent}% across ${trend.comparisonWindow.join(" to ")}`
    : `no period-over-period change (${trend.reasonCode})`;
  return `${departmentId}: ${spend}, ${against}, ${movement}. ${finding.provenance.statement}`;
}

/**
 * The action a leader takes. A finding whose benchmark is ineligible or whose
 * provenance is incomplete produces a data-resolution action, not a spend
 * action, because acting on it would be acting on an unsupported number.
 */
function recommendAction(finding, priorityRank) {
  const blockedBy = !finding.benchmark.eligible
    ? finding.benchmark.reasonCode
    : !finding.provenance.complete ? "provenance_incomplete" : null;
  return {
    priorityRank,
    departmentId: finding.departmentId,
    confidence: finding.confidence.level,
    blocked: blockedBy !== null,
    blockedReasonCode: blockedBy,
    action: blockedBy === null
      ? `Review ${finding.departmentId} spend against its own trailing baseline`
        + ` and decide on an intervention for ${finding.currentPeriodLabel}.`
      : `Resolve ${blockedBy} for ${finding.departmentId} before acting; the`
        + " supplied periods do not support a spend decision.",
    basis: describeFinding(finding),
  };
}

/**
 * Validate the fixture and project it into findings. Pure: no network, storage,
 * clock, or randomness, and the input value is never mutated.
 */
export function createLongitudinalFinopsFindings(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture))
    invalid("fixture", "must be an object");
  if (fixture.schemaVersion !== LONGITUDINAL_FINOPS_SCHEMA_VERSION)
    invalid("fixture.schemaVersion", `must equal ${LONGITUDINAL_FINOPS_SCHEMA_VERSION}`);
  if (typeof fixture.source !== "string" || !/synthetic/i.test(fixture.source))
    invalid("fixture.source", "must name a synthetic source");
  if (!Array.isArray(fixture.records) || fixture.records.length === 0)
    invalid("fixture.records", "must be a non-empty array");

  const records = fixture.records.map(validateRecord);
  const seen = new Set();
  for (const [index, record] of records.entries()) {
    const key = `${record.departmentId}:${record.periodLabel}`;
    if (seen.has(key))
      invalid(`records[${index}]`, "departmentId must be unique within a period label");
    seen.add(key);
  }

  const grouped = Map.groupBy(records, (record) => record.departmentId);
  const findings = [...grouped.entries()]
    .map(([departmentId, departmentRecords]) => buildFinding(departmentId, departmentRecords))
    .sort(compareDepartmentFindings)
    .map((finding, index) => ({
      ...finding,
      comparison: { ...finding.comparison, rank: index + 1 },
    }));

  const actionQueue = [...findings]
    .sort(compareActionPriority)
    .map((finding, index) => recommendAction(finding, index + 1));

  const periodLabels = [...new Set(records.map((record) => record.periodLabel))].sort();
  return deepFreeze({
    schemaVersion: fixture.schemaVersion,
    metricRules: LONGITUDINAL_METRIC_RULES,
    periodWindow: {
      firstPeriod: periodLabels[0],
      lastPeriod: periodLabels.at(-1),
      periodCount: periodLabels.length,
    },
    departmentCount: findings.length,
    findings,
    actionQueue,
    topAction: actionQueue[0],
    locality: {
      processing: "browser_local_ephemeral",
      statement: "Records are projected in this tab for the session only:"
        + " no network transmission, no credential, and no persistence.",
    },
  });
}
