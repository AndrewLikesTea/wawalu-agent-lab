// The department drill-down, rebuilt from a leader's own import.
//
// The panel headed "Which department needs help?" answers three named decisions
// — intervention, trajectory, comparator — and until now it answered all three
// from the bundled synthetic seed. The panel contract correctly reported it
// *available* after an import, because an import that clears the attribution
// floor genuinely can rank departments; what it could not do was notice that
// the rows on screen belonged to somebody else's fixture. An available panel
// showing another organization's departments is worse than an unavailable one,
// because nothing on it says so.
//
// This module is an adapter and nothing more. It takes the analysis envelope
// `local-finops.js` already produced and returns it in the exact shape the
// bundled decision surface consumes, so the same renderer, the same headings,
// the same disclosure semantics and the same accessible names draw both. There
// is no second view, and therefore no second set of accessibility bugs.
//
// WHAT IT REFUSES TO INVENT.
//   * A performance score. Prompt-literacy grades come from a query sample. A
//     provider invoice has none, so `sampling.status` is "unavailable" and the
//     stated reason is the analysis's own — never a zero, never a guess.
//   * A prior-period score. An import may carry two periods of spend and never
//     a second period of grades, so the cost side of the trajectory decision can
//     be answered while the performance side is explicitly unavailable.
//   * A peer cohort. Nothing in a provider export can build one; the comparator
//     decision says so in the analysis's own words.
//
// PRIVACY. Every value here is already inside the analysis envelope or the
// classified query-sample shape: unit ids, unit labels, categories, dollar
// totals, and counts. No prompt text, no cell value, and no file name is read.

import { MIN_SCORED_PROMPTS } from "./finops-panel-contract.js";
import { scorePromptLiteracy } from "./prompt-literacy-scoring.js";

export const IMPORTED_DECISIONS_VERSION = "imported-department-decisions/1.0.0";

/** The mix keys the bundled surface normalizes. Categories outside them are ignored. */
const MIX_KEYS = Object.freeze(["highValue", "overProvisioned", "inefficient", "outOfScope"]);

/**
 * Why a department carries no performance score, in a sentence.
 *
 * The keys are `query-literacy.js`'s own reason codes. A code this table does
 * not know still produces a sentence — the code itself — rather than an empty
 * string, because "Sampling unavailable: " with nothing after it reads as a
 * rendering fault rather than a stated limit.
 */
export const SAMPLING_REASON_TEXT = Object.freeze({
  no_sampled_queries: "no query sample was imported beside this provider export, so no prompt "
    + "was scored for this department",
  no_classified_queries: "the imported query sample carried no rubric category for this "
    + "department's rows, and a category is never guessed",
  insufficient_joined_sample: "too few sampled queries joined this department's billing rows "
    + "for a grade to describe how the team works",
  no_join_key: "the query sample and the provider export share no org unit key, so no prompt "
    + "could be attributed to this department",
});

export function samplingReasonText(reason) {
  if (!reason) return "no eligible scored sample for this period";
  return SAMPLING_REASON_TEXT[reason] ?? String(reason);
}

/**
 * Build per-department literacy from the classified, excerpt-free records that
 * also feed the hero. Query samples are imported beside provider files, rather
 * than nested inside them, so the local-finops envelope cannot carry this join
 * without an explicit adapter at the page seam.
 */
export function importedDepartmentLiteracy(result, queryRecords = [], { hasQuerySample = true } = {}) {
  const known = new Set((result?.rankedDepartments ?? []).map((entry) => entry.id));
  const byDepartment = new Map();
  for (const record of Array.isArray(queryRecords) ? queryRecords : []) {
    if (!known.has(record?.orgUnitId)) continue;
    const bucket = byDepartment.get(record.orgUnitId) ?? [];
    bucket.push(record);
    byDepartment.set(record.orgUnitId, bucket);
  }
  return Object.freeze([...known].map((departmentId) => {
    const records = byDepartment.get(departmentId) ?? [];
    const scored = scorePromptLiteracy(records);
    const gradeable = scored.records.scored >= MIN_SCORED_PROMPTS;
    return Object.freeze({
      departmentId,
      gradeable,
      reason: gradeable ? null
        : records.length ? "insufficient_joined_sample"
          : hasQuerySample ? "no_join_key" : "no_sampled_queries",
      coverage: Object.freeze({
        classified: scored.records.scored,
        joined: records.length,
      }),
      categories: scored.categories,
    });
  }));
}

/** A literacy department's category shares, in the shape `normalizeMix` reads. */
function mixOf(literacy) {
  const mix = {};
  for (const key of MIX_KEYS) mix[key] = 0;
  for (const category of literacy?.categories ?? []) {
    if (MIX_KEYS.includes(category?.key)) mix[category.key] = category.share ?? 0;
  }
  return mix;
}

/**
 * The one intervention an import can honestly offer for a department: the
 * disclosed down-routing scenario the analysis already computed for it.
 *
 * It is `planned`, never `completed`, and its realized figure is null — a
 * scenario is not a realized saving, and this page has refused to blur those
 * two everywhere else. A department with nothing recoverable gets an explicitly
 * unavailable action carrying the reason, not an action worth 0.00 USD.
 */
function actionPlanFrom(department, { period }) {
  const recoverable = Number(department?.recoverableUsd);
  const spend = Number(department?.spendUsd) || 0;
  if (!Number.isFinite(recoverable) || recoverable <= 0) {
    return {
      status: "unavailable",
      unavailableReason: "No down-routing scenario applies to this department's rows: none of its "
        + "billed spend is token-billed text generation priced above the premium-tier floor.",
    };
  }
  const routing = department.downRouting ?? {};
  return {
    status: "planned",
    title: `Pilot lower-cost routing for text generation in ${department.name}`,
    rationale: `${recoverable.toFixed(2)} USD of this department's ${spend.toFixed(2)} USD is the `
      + "disclosed routing scenario: token-billed text generation priced above the premium-tier "
      + "floor, repriced at the standard-tier reference rate.",
    impact: `${recoverable.toFixed(2)} USD scenario over ${period}`,
    confidence: `${routing.confidence?.level ?? "unstated"} · ${routing.decisionCode ?? "no decision code"}`,
    accountableRole: "Owner of the org unit this spend is attributed to",
    provenance: "Browser-local down-routing scenario computed in this tab · not a realized saving",
    baselineUsd: spend,
    targetUsd: Math.max(0, Math.round((spend - recoverable) * 100) / 100),
    estimatedSavingsUsd: recoverable,
    realizedSavingsUsd: null,
    diagnosis: `${department.records ?? 0} deduplicated provider aggregate`
      + `${department.records === 1 ? "" : "s"} joined to this unit over ${period}. `
      + "The scenario is bounded and checkable without inspecting prompt content.",
  };
}

/**
 * One imported department, in the bundled surface's own shape.
 *
 * `previousPeriod.score` is deliberately null: an import that carries two
 * billing periods still carries one period of grades, so the trajectory
 * decision answers its cost half and says the performance half is unavailable.
 */
export function importedDepartment(department, literacy, { period, periodDays = null } = {}) {
  const graded = Boolean(literacy?.gradeable);
  const previousSpend = Number(department?.previousSpendUsd);
  return Object.freeze({
    id: department.id,
    name: department.name,
    spendUsd: department.spendUsd,
    queries: literacy?.coverage?.classified ?? 0,
    mix: Object.freeze(mixOf(literacy)),
    sampling: Object.freeze({
      status: graded ? "available" : "unavailable",
      sampledQueries: literacy?.coverage?.joined ?? 0,
      sampledThrough: period,
      freshnessLabel: "imported in this tab",
      reason: graded ? null : samplingReasonText(literacy?.reason),
    }),
    period,
    periodDays,
    previousPeriod: Object.freeze({
      period: department?.trendAvailable ? "the preceding imported period" : null,
      spendUsd: Number.isFinite(previousSpend) ? previousSpend : null,
      score: null,
    }),
    actionPlan: Object.freeze(actionPlanFrom(department, { period })),
  });
}

/**
 * The whole decision surface for one imported analysis.
 *
 * Returns `{ provenance, benchmark, evidence, departments, benchmarkNotice }`.
 * The first four are exactly what the bundled renderer already takes; the fifth
 * is the comparator sentence the bundled `benchmarkComparison` cannot produce,
 * because its reasons are written for a cohort that exists.
 */
export function importedDecisionData(result, { queryRecords = null, hasQuerySample = true } = {}) {
  if (!result) return null;
  const period = result.period ?? "the imported period";
  const literacy = queryRecords === null
    ? (result.literacy?.departments ?? [])
    : importedDepartmentLiteracy(result, queryRecords, { hasQuerySample });
  const literacyById = new Map(literacy
    .map((entry) => [entry.departmentId, entry]));
  const departments = (result.rankedDepartments ?? []).map((department) =>
    importedDepartment(department, literacyById.get(department.id) ?? null, { period }));
  return Object.freeze({
    version: IMPORTED_DECISIONS_VERSION,
    provenance: Object.freeze({
      label: "Your import · computed in this browser tab",
      generatedAt: period,
      billingSource: result.provenance ?? "provider export read in this tab",
      orgSource: result.quality?.hrisCompleteness
        ? "org roster read in this tab"
        : "the provider export's own grouping column; no org roster was supplied",
    }),
    // No cohort exists for an import, and an empty object here would make the
    // bundled comparator claim a rubric mismatch. It is stated as absent, and
    // `benchmarkNotice` carries the sentence a reader is actually owed.
    benchmark: Object.freeze({
      name: "No peer cohort",
      medianScore: null,
      rubricVersion: null,
      organizationCount: 0,
      segment: "no segment",
      snapshotDate: period,
      provenance: "No cohort can be built from your own files, and none is bundled for imported data.",
    }),
    benchmarkNotice: Object.freeze({
      answer: "Unavailable. No peer cohort can be built from your own files, and this product "
        + "ships none for imported data. This is not a step you can complete.",
      method: `No peer cohort · 0 comparable organizations · ${period} · `
        + "no compatible rubric · computed in this browser tab",
    }),
    // Evidence is scoped per department by the bundled renderer, so each row is
    // stated against the unit it belongs to. Every sentence is a restatement of
    // a figure already in the envelope.
    evidence: Object.freeze((result.rankedDepartments ?? []).map((department) => Object.freeze({
      departmentId: department.id,
      category: "Attribution",
      sampleId: department.id,
      summary: `${department.records ?? 0} deduplicated provider aggregate`
        + `${department.records === 1 ? "" : "s"} joined this unit for `
        + `${Number(department.spendUsd ?? 0).toFixed(2)} USD observed and `
        + `${Number(department.recoverableUsd ?? 0).toFixed(2)} USD of disclosed routing scenario.`,
      scoredAt: period,
    }))),
    departments: Object.freeze(departments),
  });
}
