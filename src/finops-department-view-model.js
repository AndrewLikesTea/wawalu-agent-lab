// One department's complete answer, as one plain object.
//
// WHAT THIS FIXES (#1612). A forwarded `?department=<slug>` link landed a reader
// on /evolution.html and left them to reassemble the department's answer out of
// four separate regions: the spend mix in one, the month-over-month trajectory
// in another, the peer rank behind a disclosure, the recommended intervention in
// a third. Nothing on the page stated the five parts together, so "look at
// Quality" was still an instruction to go and read four things. This module is
// that statement: given a record and a slug, it returns the spend mix, the
// trajectory, the peer position, the training gap and the intervention verdict,
// all derived from the same record in one pass.
//
// PURE, AND DELIBERATELY SO. No DOM, no storage, no network, no clock, no
// randomness. Input in, plain object out, and `JSON.parse(JSON.stringify(vm))`
// is deep-equal to `vm` — which is what lets the same view model be asserted in
// a unit test, carried in a shared brief and painted by the page without three
// independent derivations of the same five figures drifting apart.
//
// RESOLUTION IS TOTAL. A missing slug, an empty string, a non-string, a slug the
// record does not hold, and a record that cannot be read at all all return the
// SAME shape: the org-level answer, a machine-readable `reasonCode`, and one
// sentence in the reader's own vocabulary. It never throws, and it never answers
// a question about one department with another department's numbers — a fallback
// says "the whole organization" out loud rather than quietly ranking a
// substitute into the slot. Silently substituting is the failure mode that turns
// a stale bookmark into a wrong decision, and no status code prevents it; only
// refusing to fill the slot does.
//
// THE SLUG LIST IS DERIVED, NEVER TYPED. `knownDepartmentSlugs()` reads the ids
// off the record, in the record's own order. src/finops-destinations.js sources
// `FINOPS_DEPARTMENT_IDS` from it, so the workspace index, the destination
// registry's `route.departments`, the selection ids in
// src/finops-destination-regions.js and this selector cannot disagree about what
// a department is: there is one list and it is computed.

// The bundled synthetic example. Imported rather than fetched because this
// module must be answerable before any request resolves — a deep link that has
// to wait for a fixture is a deep link that lands on a blank panel. The page
// already imports the same document, so this adds no bytes to its graph.
import BUNDLED_ANALYSIS_RECORD from "./evolution-demo-data.json" with { type: "json" };
// The scoring rules, read rather than restated. Every figure below is one of
// these functions' return value: a second implementation of the literacy score
// or the recoverable share here would be a second answer to a published
// question, and the two would diverge on the first rubric change.
import {
  QUERY_CATEGORIES, actionPlanFor, benchmarkComparison, categorySpendUsd,
  departmentPerformance, departmentTrend, normalizeMix, quartileLabel,
  recoverableSpendUsd, summarize,
} from "./evolution.js";

export { BUNDLED_ANALYSIS_RECORD };

/** Stamped on every view model, so a consumer can refuse a shape it cannot read. */
export const DEPARTMENT_VIEW_MODEL_VERSION = "finops-department-view-model/1.0.0";

/**
 * Why a request resolved the way it did. Machine-readable, so a caller branches
 * on the code and never on the sentence — the sentence is copy and will be
 * rewritten; the code is a contract.
 */
export const DEPARTMENT_RESOLUTION = Object.freeze({
  resolved: "resolved",
  absent: "no_department_requested",
  empty: "empty_department",
  notText: "department_not_text",
  unknown: "unknown_department",
  unreadable: "record_unreadable",
});

/**
 * The longest requested slug this module hands back. A URL can carry kilobytes;
 * a sentence naming one is still a sentence somebody reads. Clamped here rather
 * than at the render, so the message, the log line and the test all see the same
 * bounded string. Matches src/destination-route.js, which clamps for the same
 * reason.
 */
export const MAX_REQUESTED_DEPARTMENT_LENGTH = 80;

const ORG_NAME = "the whole organization";

const clamp = (text) => (text.length > MAX_REQUESTED_DEPARTMENT_LENGTH
  ? `${text.slice(0, MAX_REQUESTED_DEPARTMENT_LENGTH - 1)}…`
  : text);

const departmentsOf = (record) => (Array.isArray(record?.departments) ? record.departments : null);

const money = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : null);

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

/**
 * Every department id this record holds, in the record's own order.
 *
 * The order matters: it is the order the destination registry publishes and the
 * order the workspace index ranks in, so deriving it rather than sorting keeps
 * one authored decision authored in one place — the seed.
 */
export function knownDepartmentSlugs(record = BUNDLED_ANALYSIS_RECORD) {
  const departments = departmentsOf(record);
  if (!departments) return Object.freeze([]);
  const slugs = [];
  for (const department of departments) {
    const id = department?.id;
    if (typeof id === "string" && id !== "" && !slugs.includes(id)) slugs.push(id);
  }
  return Object.freeze(slugs);
}

/**
 * Resolve a requested slug against a record. Total: every input produces a
 * record with the same keys, and none of them throws.
 *
 * `department` is the matched entry or null, and it is null in every branch but
 * `resolved`. Callers read `ok`; nothing downstream is allowed to fall back to
 * "the first department" when this says no.
 */
export function resolveDepartmentSlug(record, slug) {
  const departments = departmentsOf(record);
  const requested = typeof slug === "string" ? clamp(slug.trim()) : null;
  const answer = (code, department = null) => Object.freeze({
    ok: code === DEPARTMENT_RESOLUTION.resolved,
    slug: department?.id ?? null,
    requestedSlug: requested,
    reasonCode: code,
    reason: resolutionReason(code, requested),
    department,
  });
  if (!departments) return answer(DEPARTMENT_RESOLUTION.unreadable);
  if (slug === null || slug === undefined) return answer(DEPARTMENT_RESOLUTION.absent);
  if (typeof slug !== "string") return answer(DEPARTMENT_RESOLUTION.notText);
  if (requested === "") return answer(DEPARTMENT_RESOLUTION.empty);
  const match = departments.find((entry) => entry?.id === requested) ?? null;
  return match ? answer(DEPARTMENT_RESOLUTION.resolved, match) : answer(DEPARTMENT_RESOLUTION.unknown);
}

/**
 * The one sentence a reader gets, in the copy voice /evolution.html already uses
 * for a link that did not resolve: name what the link asked for, say what
 * happened to it, say what is on screen instead. No code, no field path, no
 * stack trace — the reader did not write the URL and cannot fix the record.
 */
export function resolutionReason(code, requestedSlug = null) {
  if (code === DEPARTMENT_RESOLUTION.resolved) return "";
  if (code === DEPARTMENT_RESOLUTION.unreadable) {
    return "These department figures could not be read, so there is nothing to show for one department yet.";
  }
  if (code === DEPARTMENT_RESOLUTION.unknown) {
    return `That link asked for a department called “${requestedSlug}”. `
      + "This analysis does not hold one by that name, so this is the whole organization’s answer instead.";
  }
  if (code === DEPARTMENT_RESOLUTION.empty || code === DEPARTMENT_RESOLUTION.notText) {
    return "That link named a department this page cannot read, so this is the whole organization’s answer instead.";
  }
  return "That link named no department, so this is the whole organization’s answer.";
}

const unavailable = (reason, fields) => Object.freeze({ available: false, reason, ...fields });

/** Where this department's money went, by the four published categories. */
function spendMixOf(department) {
  const spendUsd = money(department?.spendUsd) ?? 0;
  const shares = normalizeMix(department?.mix);
  const categories = QUERY_CATEGORIES.map((category) => Object.freeze({
    key: category.key,
    label: category.label,
    share: Math.round(shares[category.key] * 1000) / 1000,
    spendUsd: categorySpendUsd(department, category.key),
  }));
  const total = categories.reduce((sum, entry) => sum + entry.share, 0);
  if (total === 0) {
    return unavailable("No scored query mix is recorded for this department, so its spend is not broken down.",
      { spendUsd, recoverableUsd: 0, categories: Object.freeze([]) });
  }
  return Object.freeze({
    available: true,
    reason: null,
    spendUsd,
    recoverableUsd: recoverableSpendUsd(department),
    categories: Object.freeze(categories),
  });
}

/** This period against the one before it, cost and score. */
function trajectoryOf(department) {
  const trend = departmentTrend(department);
  const costChangePercent = finite(trend.costChangePercent);
  const direction = !trend.costAvailable ? null
    : costChangePercent > 0 ? "rising" : costChangePercent < 0 ? "falling" : "flat";
  if (!trend.costAvailable && !trend.performanceAvailable) {
    return unavailable("No comparable prior period is recorded, so nothing is stated about the direction of travel.",
      { period: trend.period ?? null, comparisonPeriod: trend.comparisonPeriod ?? null,
        costChangePercent: null, performanceChangePoints: null, direction: null, worsening: null });
  }
  return Object.freeze({
    available: true,
    reason: null,
    period: trend.period ?? null,
    comparisonPeriod: trend.comparisonPeriod ?? null,
    costChangePercent,
    performanceChangePoints: finite(trend.performanceChangePoints),
    direction,
    worsening: trend.worsening === null ? null : Boolean(trend.worsening),
  });
}

/** Where this department sits against the cohort the record names. */
function peerPositionOf(department, record) {
  const comparison = benchmarkComparison(department, record?.benchmark ?? {});
  const percentile = finite(department?.peerPercentile);
  if (percentile === null && !comparison.available) {
    return unavailable(comparison.reason
      || "No comparable cohort figure is recorded, so this department is not ranked against peers.",
      { percentile: null, quartile: quartileLabel(null), cohortMedianScore: null, deltaPoints: null });
  }
  return Object.freeze({
    available: true,
    reason: null,
    percentile,
    quartile: quartileLabel(percentile),
    cohortMedianScore: finite(record?.benchmark?.medianScore),
    deltaPoints: finite(comparison.deltaPoints),
  });
}

/**
 * The training gap: the retry-chain slice the rubric already labels "surfaced as
 * a training gap for that team", stated in dollars beside the sampled score it
 * was measured from. Coaching spend, not routing spend — the two are different
 * errands and a leader who conflates them buys the wrong one.
 */
function trainingGapOf(department, record) {
  const performance = departmentPerformance(department);
  if (!performance.available) {
    return unavailable(performance.reason || "No eligible scored sample, so no training gap is stated.",
      { score: null, uncertaintyPoints: null, sampledQueries: null,
        gapPoints: null, inefficientSpendUsd: null });
  }
  const median = finite(record?.benchmark?.medianScore);
  return Object.freeze({
    available: true,
    reason: null,
    score: performance.score,
    uncertaintyPoints: performance.uncertaintyPoints,
    sampledQueries: finite(department?.sampling?.sampledQueries),
    gapPoints: median === null ? null : median - performance.score,
    inefficientSpendUsd: categorySpendUsd(department, "inefficient"),
  });
}

/** The one reviewed intervention attached to this department, or why there is none. */
function interventionVerdictOf(department) {
  const plan = actionPlanFor(department);
  if (!plan.available) {
    return unavailable(plan.reason, {
      status: plan.status, statusLabel: plan.statusLabel, title: null, rationale: null,
      impact: null, confidence: null, accountableRole: null,
      baselineUsd: null, targetUsd: null, estimatedSavingsUsd: null, realizedSavingsUsd: null,
    });
  }
  return Object.freeze({
    available: true,
    reason: null,
    status: plan.status,
    statusLabel: plan.statusLabel,
    title: plan.title ?? null,
    rationale: plan.rationale ?? null,
    impact: plan.impact ?? null,
    confidence: plan.confidence ?? null,
    accountableRole: plan.accountableRole ?? null,
    baselineUsd: plan.baselineUsd,
    targetUsd: plan.targetUsd,
    estimatedSavingsUsd: plan.estimatedSavingsUsd,
    realizedSavingsUsd: plan.realizedSavingsUsd,
  });
}

/**
 * The org-level answer, in the same five slots.
 *
 * It is the same SHAPE and never the same NUMBERS as a department's: the mix and
 * the recoverable line are the summed organization, the trajectory is stated
 * unavailable because this record holds no prior period for the org as a whole,
 * and the intervention slot is empty rather than borrowed from whichever
 * department happens to rank first. A fallback that quietly promotes one
 * department's plan to "the organization's plan" is the substitution this module
 * exists to refuse.
 */
function organizationAnswer(record) {
  const departments = departmentsOf(record) ?? [];
  const totals = summarize(departments);
  const organization = record?.organization ?? {};
  const percentile = finite(organization.peerPercentile);
  const shares = totals.mix ?? {};
  const categories = QUERY_CATEGORIES.map((category) => Object.freeze({
    key: category.key,
    label: category.label,
    share: Math.round((shares[category.key] ?? 0) * 1000) / 1000,
    spendUsd: departments.reduce((sum, entry) => sum + categorySpendUsd(entry, category.key), 0),
  }));
  return {
    name: typeof organization.name === "string" && organization.name ? organization.name : ORG_NAME,
    period: typeof organization.period === "string" ? organization.period : null,
    spendMix: departments.length
      ? Object.freeze({ available: true, reason: null, spendUsd: totals.spendUsd,
        recoverableUsd: totals.recoverableUsd, categories: Object.freeze(categories) })
      : unavailable("No department in this record carries spend, so there is nothing to break down.",
        { spendUsd: 0, recoverableUsd: 0, categories: Object.freeze([]) }),
    trajectory: unavailable(
      "This record states no prior period for the organization as a whole, so no direction of travel is claimed.",
      { period: typeof organization.period === "string" ? organization.period : null,
        comparisonPeriod: null, costChangePercent: null, performanceChangePoints: null,
        direction: null, worsening: null }),
    peerPosition: percentile === null
      ? unavailable("This record names no cohort position for the organization.",
        { percentile: null, quartile: quartileLabel(null), cohortMedianScore: null, deltaPoints: null })
      : Object.freeze({ available: true, reason: null, percentile, quartile: quartileLabel(percentile),
        cohortMedianScore: finite(organization.peerMedianScore) ?? finite(record?.benchmark?.medianScore),
        deltaPoints: finite(organization.peerMedianScore) === null
          ? null : totals.score - finite(organization.peerMedianScore) }),
    trainingGap: departments.length
      ? Object.freeze({ available: true, reason: null, score: totals.score, uncertaintyPoints: null,
        sampledQueries: null,
        gapPoints: finite(record?.benchmark?.medianScore) === null
          ? null : finite(record.benchmark.medianScore) - totals.score,
        inefficientSpendUsd: departments.reduce(
          (sum, entry) => sum + categorySpendUsd(entry, "inefficient"), 0) })
      : unavailable("No department in this record carries a scored sample.",
        { score: null, uncertaintyPoints: null, sampledQueries: null,
          gapPoints: null, inefficientSpendUsd: null }),
    interventionVerdict: unavailable(
      "One department's plan is not the organization's plan, so none is stated here. Open a department for its own.",
      { status: "unavailable", statusLabel: "Result unavailable", title: null, rationale: null,
        impact: null, confidence: null, accountableRole: null,
        baselineUsd: null, targetUsd: null, estimatedSavingsUsd: null, realizedSavingsUsd: null }),
  };
}

/** Every slot empty, for a record this module cannot read at all. */
function unreadableAnswer() {
  const none = "These figures could not be read.";
  return {
    name: ORG_NAME,
    period: null,
    spendMix: unavailable(none, { spendUsd: 0, recoverableUsd: 0, categories: Object.freeze([]) }),
    trajectory: unavailable(none, { period: null, comparisonPeriod: null, costChangePercent: null,
      performanceChangePoints: null, direction: null, worsening: null }),
    peerPosition: unavailable(none, { percentile: null, quartile: quartileLabel(null),
      cohortMedianScore: null, deltaPoints: null }),
    trainingGap: unavailable(none, { score: null, uncertaintyPoints: null, sampledQueries: null,
      gapPoints: null, inefficientSpendUsd: null }),
    interventionVerdict: unavailable(none, { status: "unavailable", statusLabel: "Result unavailable",
      title: null, rationale: null, impact: null, confidence: null, accountableRole: null,
      baselineUsd: null, targetUsd: null, estimatedSavingsUsd: null, realizedSavingsUsd: null }),
  };
}

/**
 * The whole answer for one department, or the org-level answer and the reason it
 * is the one on screen.
 *
 * Both branches return the same keys, so a caller reads `vm.spendMix.available`
 * without first proving which branch it is in — the discipline
 * src/destination-route.js already keeps for the destination itself.
 */
export function departmentViewModel(record, slug) {
  const resolution = resolveDepartmentSlug(record, slug);
  const department = resolution.department;
  const body = department
    ? {
      name: typeof department.name === "string" && department.name ? department.name : department.id,
      period: typeof department.period === "string" ? department.period : null,
      spendMix: spendMixOf(department),
      trajectory: trajectoryOf(department),
      peerPosition: peerPositionOf(department, record),
      trainingGap: trainingGapOf(department, record),
      interventionVerdict: interventionVerdictOf(department),
    }
    : resolution.reasonCode === DEPARTMENT_RESOLUTION.unreadable
      ? unreadableAnswer()
      : organizationAnswer(record);
  return Object.freeze({
    version: DEPARTMENT_VIEW_MODEL_VERSION,
    scope: department ? "department" : "organization",
    resolved: resolution.ok,
    slug: resolution.slug,
    requestedSlug: resolution.requestedSlug,
    reasonCode: resolution.reasonCode,
    reason: resolution.reason,
    ...body,
  });
}
