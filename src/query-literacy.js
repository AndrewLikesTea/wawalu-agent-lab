// Scoring an imported query sample against the imported billing export.
//
// This is the join and nothing else. It owns no rubric numbers (Theo's module
// owns those), no tier thresholds (Noor's module owns those), and no model
// vocabulary (Anya's contract owns that). What it owns is the arithmetic of
// which sampled queries may be graded, and the honest reporting of the ones that
// may not.
//
// ---------------------------------------------------------------------------
// THE JOIN KEY: (department, model)
// ---------------------------------------------------------------------------
//
// The billing side is Anya's v1.1 provider records, read through
// `readUsageDetail`: `org_unit_id` × `model_raw`, with the input/output split and
// request count that version added. The sample side is a classified query's
// `department` × `model`, carried through the same `carryableModelString` rule
// the billing importer uses, so a string one side accepts is a string the other
// side accepts.
//
// The department column carries either the pseudonymous org-unit id the billing
// export uses, or a provider-native grouping value (a project, workspace,
// account, resource group, key, or tag) that an analysed department declares as
// its own. Which of the two applies is resolved once per analysis by
// `resolveJoinKeySpace` below, from Anya's dialect-detection result — never by
// looking at the shape of a sample key. A reader with a provider export and a
// query sample but no HRIS file keys their sample the way their provider groups
// their bill, and demanding a pseudonym they were never issued dead-ends the
// grade. What is *not* relaxed is the exactness: a key matches a department or
// it matches nothing. There is still no name-to-id guess.
//
// Both directions of miss are counted and published. A sample row naming a pair
// the billing export never billed, and a billed pair no sampled query landed on,
// are different facts about the reader's data and neither is an error to swallow.
//
// ---------------------------------------------------------------------------
// COVERAGE
// ---------------------------------------------------------------------------
//
//   coverage(department) = classified_and_joined_records / sampled_records
//
//   numerator     sample records for this department that the classifier placed
//                 in a rubric category (confidence at or above the exported
//                 floor) AND whose (department, model) pair appears in the
//                 billing export.
//
//   denominator   every sample row for this department that survived ingest
//                 validation — including unclassified rows and rows whose model
//                 never appears in billing. Rows the parser refused carry no
//                 trustworthy department, so they are counted globally as
//                 rejections and are deliberately absent from any department's
//                 denominator; shrinking the denominator by them would raise
//                 coverage for a file that got worse.
//
// An unclassified record therefore lowers coverage and is never graded. That is
// the same contract Theo's rubric states for records it cannot recognize, held
// one layer earlier so the count is attributable to a department.
//
// No network, no storage, no clock. Every function here is a pure function of
// its arguments.

import {
  gradeEligibilityFromCoverage, sampledSpendCoverage,
} from "./grade-eligibility.js";
import {
  PROMPT_LITERACY_RUBRIC, RUBRIC_VERSION_ID, scorePromptLiteracy,
} from "./prompt-literacy-scoring.js";
import { ABSENT, carryableModelString, readUsageDetail } from "./provider-usage-record.js";
import { QUERY_CLASSIFIER_VERSION } from "./query-classification.js";
import {
  MIN_JOINED_RECORDS_FOR_GRADE, NOT_GRADEABLE_REASONS,
} from "./query-gradeability-reasons.js";
import { QUERY_SAMPLE_VERSION } from "./query-sample.js";

/** Bump when a reason code or the gradeability rule changes meaning. */
export const QUERY_LITERACY_VERSION = "query-literacy/1.0.0";

// The minimum sample and the not-gradeable codes are declared in a leaf beside
// this module so a surface can render a reason without importing the rubric,
// the classifier and the sampler to do it. They are still this module's values,
// and they are re-exported here so every existing importer is unaffected.
export {
  MIN_JOINED_RECORDS_FOR_GRADE, NOT_GRADEABLE_COPY, NOT_GRADEABLE_REASONS,
} from "./query-gradeability-reasons.js";

/**
 * A cohort needs a subject and at least two peers, so the median it is compared
 * against is never the subject's own score. `model-overspend-finding.js` states
 * the same rule for its intra-tenant benchmark: comparing a segment to itself is
 * not a comparison.
 */
export const MIN_COHORT_DEPARTMENTS = 3;

/** The two key spaces a sample's department column may be stated in. */
export const JOIN_KEY_SPACES = Object.freeze({
  orgPseudonym: "org_pseudonym",
  providerUnit: "provider_unit",
});

/**
 * The missing inputs this analysis can name, each with the single action that
 * supplies it. Held as data beside the code that emits it so a surface renders a
 * sentence it did not assemble, and so nothing here carries an internal
 * identifier, a file name, or a provider's own error string.
 *
 * `unresolvedSample` takes the grouping unit Anya's detection named, which is a
 * provider-native word a reader sees in their own console — `project`,
 * `workspace`, `account` — not an id from this codebase.
 */
export const MISSING_INPUTS = Object.freeze({
  noSample: Object.freeze({
    input: "Query sample",
    action: "Import a query sample: one row per query, carrying its category, its model, and the unit the billing export is grouped by.",
  }),
  unresolvedSample: Object.freeze({
    input: "Query sample keyed to the billed units",
    action: "Re-export the query sample keyed by the same unit the billing export is grouped by; no key in the imported sample names a billed unit.",
  }),
});

/** One missing input as the sentence a surface prints, input first, then action. */
export function missingInputNotice(kind, { unit = null } = {}) {
  const entry = MISSING_INPUTS[kind];
  if (!entry) return null;
  const unitPhrase = unit ? ` The billing export is grouped by ${unit.replace(/_/g, " ")}.` : "";
  return Object.freeze({
    kind,
    input: entry.input,
    action: `${entry.action}${unitPhrase}`,
    text: `${entry.input}: not available. ${entry.action}${unitPhrase}`,
  });
}

/**
 * Resolve the key space the sample's department column is stated in, and build
 * the one map every sample row is looked up in.
 *
 * ---------------------------------------------------------------------------
 * THE RESOLUTION RULE. Explicit, deterministic, and decided once — before a
 * single sample row is read, never per row.
 * ---------------------------------------------------------------------------
 *
 *  1. Anya's dialect-detection result is the *only* authority for whether a
 *     provider-native key space exists at all. `groupingUnit` on a matched
 *     detection is the whole test. This module never inspects a sample key's
 *     shape: a project literally named `psn_something` would otherwise decide a
 *     key space by accident, and a grade would move on a regex.
 *  2. A department id is always a key. It is the pseudonym every previously
 *     published grade joined on, so dropping it would move those grades.
 *  3. When a grouping unit is detected, each department's declared `unitKeys`
 *     are added to the same map, under that unit. A department that declares
 *     none contributes none — a detected unit with nothing to resolve against
 *     is not a key space, it is an empty map.
 *  4. There is no precedence between the two spaces, because a key claimed by
 *     more than one department — or claimed as one department's unit key and
 *     another's id — resolves to *no* department and is reported as a collision.
 *     Ranking one space over the other would move a grade on a rule nobody read;
 *     refusing the ambiguous key costs one row and is visible in the counts.
 *
 * `space` reports which spaces actually contributed a key, for the surface that
 * has to say how the join was made. It is a description of the map, not a switch
 * anything downstream branches on.
 *
 * @param {{grouping?: object|null, departments?: ReadonlyArray<object>}} input
 *   `grouping` is a `detectDialect` result, or null when no export was detected.
 * @returns {{space: string, unit: string|null, keys: Map<string, string>,
 *   collisions: ReadonlyArray<string>, declaredUnitKeys: number}}
 */
export function resolveJoinKeySpace({ grouping = null, departments = [] } = {}) {
  const unit = grouping?.status === "matched" && typeof grouping.groupingUnit === "string"
    ? grouping.groupingUnit : null;
  const list = Array.isArray(departments) ? departments : [];
  const keys = new Map();
  const collisions = new Set();
  const claim = (key, departmentId) => {
    const trimmed = typeof key === "string" ? key.trim() : "";
    if (!trimmed) return;
    const held = keys.get(trimmed);
    if (held !== undefined && held !== departmentId) collisions.add(trimmed);
    keys.set(trimmed, held === undefined || held === departmentId ? departmentId : null);
  };

  for (const department of list) claim(department?.id, department?.id);
  let declaredUnitKeys = 0;
  if (unit) {
    for (const department of list) {
      for (const key of Array.isArray(department?.unitKeys) ? department.unitKeys : []) {
        declaredUnitKeys += 1;
        claim(key, department?.id);
      }
    }
  }
  for (const key of collisions) keys.set(key, null);

  const space = unit && declaredUnitKeys
    ? JOIN_KEY_SPACES.providerUnit : JOIN_KEY_SPACES.orgPseudonym;
  return Object.freeze({
    space, unit: space === JOIN_KEY_SPACES.providerUnit ? unit : null,
    detectedUnit: unit,
    keys,
    collisions: Object.freeze([...collisions].sort()),
    declaredUnitKeys,
  });
}

/**
 * Why a benchmark is or is not available. `no_compatible_cohort` is retained
 * verbatim from the pre-sample behaviour: with no query sample at all, nothing
 * about the answer has changed and the code a consumer already branches on
 * should not change either.
 */
export const BENCHMARK_REASONS = Object.freeze({
  intraTenantCohort: "intra_tenant_cohort",
  noCompatibleCohort: "no_compatible_cohort",
  insufficientGradeableDepartments: "insufficient_gradeable_departments",
});

/** Human copy per reason, held next to the code it belongs to and not at the UI. */
const BENCHMARK_COPY = Object.freeze({
  [BENCHMARK_REASONS.intraTenantCohort]:
    "Compared against the median score of the other graded departments in this import.",
  [BENCHMARK_REASONS.noCompatibleCohort]:
    "Unavailable: the imported contracts contain no compatible peer cohort or benchmark methodology.",
  [BENCHMARK_REASONS.insufficientGradeableDepartments]:
    `Unavailable: a cohort needs ${MIN_COHORT_DEPARTMENTS} graded departments and this import has fewer.`,
});

const BENCHMARK_METHODOLOGY =
  "Intra-tenant: each graded department is compared to the median composite of the other "
  + "graded departments in the same import, on the same rubric version. No external cohort "
  + "is fetched, referenced, or implied.";

function roundComposite(value) {
  const factor = 10 ** PROMPT_LITERACY_RUBRIC.reporting.compositeDecimals;
  return Math.round(value * factor) / factor;
}

/** Median of an already-sorted numeric list. Even counts average the middle pair. */
function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function billingKey(department, model) {
  return `${department} ${model}`;
}

/**
 * Fold the provider records into the billing side of the join.
 *
 * Only records carrying a `model_raw` participate: a pair whose model the export
 * did not report cannot be matched to a sampled query's model, and pretending
 * otherwise would join every sample row to whichever aggregate came first.
 *
 * @param {ReadonlyArray<object>} records Anya-contract provider records.
 * @returns {Map<string, {department: string, model: string, records: number,
 *   spendMinor: number, inputTokens: number, outputTokens: number, requests: number|null}>}
 */
export function billingIndex(records = []) {
  const index = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const detail = readUsageDetail(record);
    const model = carryableModelString(detail.model_raw);
    const department = typeof record?.org_unit_id === "string" ? record.org_unit_id : "";
    if (model === ABSENT || !department) continue;
    const key = billingKey(department, model);
    const entry = index.get(key) ?? {
      department, model, records: 0, spendMinor: 0,
      inputTokens: 0, outputTokens: 0, requests: null,
    };
    entry.records += 1;
    entry.spendMinor += Number(record?.cost?.amount_minor) || 0;
    // Absent is not zero (Anya's contract): a missing split stays missing rather
    // than adding a fabricated 0 to a total a reader would read as measured.
    if (detail.input_tokens !== ABSENT) entry.inputTokens += detail.input_tokens;
    if (detail.output_tokens !== ABSENT) entry.outputTokens += detail.output_tokens;
    if (detail.request_count !== ABSENT) entry.requests = (entry.requests ?? 0) + detail.request_count;
    index.set(key, entry);
  }
  return index;
}

function emptyCoverage(sampled = 0) {
  return Object.freeze({
    ratio: 0, sampled, classified: 0, joined: 0, unclassified: 0, unjoined: 0,
  });
}

function notGradeable({ id, name, reason, coverage, spend, confidence, join }) {
  return Object.freeze({
    departmentId: id,
    name,
    gradeable: false,
    reason,
    score: null,
    grade: null,
    subscores: null,
    categories: Object.freeze([]),
    rubricVersion: RUBRIC_VERSION_ID,
    coverage,
    tokens: Object.freeze({ input: 0, output: 0, source: "billing_aggregate" }),
    spend,
    join,
    confidence,
  });
}

/**
 * Score every department, gradeable or not.
 *
 * @param {{sample?: object, records?: ReadonlyArray<object>, departments?: ReadonlyArray<object>}} input
 *   `sample` is an `ingestQuerySample` result; `records` overrides its record
 *   list for callers that already have one. `departments` is the analysed set,
 *   each `{id, name, spendUsd}` and each carrying its provider records.
 */
function scoreDepartments({ records, departments, index, resolution }) {
  const byDepartment = new Map();
  for (const record of records) {
    // The sample's own key is resolved to a department id here and nowhere
    // else. Everything below — the bucket, the billing key, the published
    // result — is stated in department ids, which is what makes the same sample
    // score identically whichever key space it arrived in.
    const departmentId = resolution.keys.get(record.department) ?? null;
    if (departmentId === null) continue;
    const bucket = byDepartment.get(departmentId) ?? [];
    bucket.push(record);
    byDepartment.set(departmentId, bucket);
  }

  const matchedKeys = new Set();
  let sampleRowsWithoutBillingMatch = 0;

  const scored = departments.map((department) => {
    const sampled = byDepartment.get(department.id) ?? [];
    const joined = [];
    const joinedKeys = new Set();
    let classified = 0;
    let unjoined = 0;
    for (const record of sampled) {
      if (record.classified) classified += 1;
      const key = billingKey(department.id, record.model);
      if (!index.has(key)) {
        unjoined += 1;
        sampleRowsWithoutBillingMatch += 1;
        continue;
      }
      matchedKeys.add(key);
      // An unclassified record is joined for coverage purposes only. It never
      // reaches the rubric, because a guessed category would move the grade.
      if (!record.classified) continue;
      joinedKeys.add(key);
      joined.push(record);
    }

    const coverage = Object.freeze({
      ratio: sampled.length ? roundRatio(joined.length / sampled.length) : 0,
      sampled: sampled.length,
      classified,
      joined: joined.length,
      unclassified: sampled.length - classified,
      unjoined,
    });

    // Spend under scored pairs, summed from the billing rows the sample actually
    // reached. This is the numerator Noor's coverage metric takes, measured at
    // department grain rather than organization grain — same field, same
    // accessor, narrower set.
    const joinedSpendUsd = [...joinedKeys].reduce(
      (sum, key) => sum + index.get(key).spendMinor, 0,
    ) / 100;
    const totalSpendUsd = Number(department.spendUsd) || 0;
    const confidence = gradeEligibilityFromCoverage(
      sampledSpendCoverage({ coveredUsd: joinedSpendUsd, totalUsd: totalSpendUsd }),
    );
    const spend = Object.freeze({
      totalUsd: Math.round(totalSpendUsd * 100) / 100,
      joinedUsd: Math.round(joinedSpendUsd * 100) / 100,
    });
    const join = Object.freeze({
      matchedPairs: joinedKeys.size,
      sampleRowsWithoutBillingMatch: unjoined,
    });

    const reason = !sampled.length ? NOT_GRADEABLE_REASONS.noSampledQueries
      : !classified ? NOT_GRADEABLE_REASONS.noClassifiedQueries
        : !joined.length ? NOT_GRADEABLE_REASONS.noBillingMatch
          : joined.length < MIN_JOINED_RECORDS_FOR_GRADE
            ? NOT_GRADEABLE_REASONS.insufficientJoinedSample : null;
    if (reason) {
      return notGradeable({
        id: department.id, name: department.name ?? null, reason,
        coverage: sampled.length ? coverage : emptyCoverage(0), spend, confidence, join,
      });
    }

    const graded = scorePromptLiteracy(joined.map((record) => Object.freeze({
      category: record.category, model: record.model,
      // Deliberately no token counts. The reader's split is reported at the
      // (department, model) grain by the billing export; apportioning that
      // aggregate across sampled rows would be synthesis, and the rubric weights
      // every scored query equally in 1.0.0 regardless.
    })));
    const tokens = [...joinedKeys].reduce((totals, key) => {
      const entry = index.get(key);
      return { input: totals.input + entry.inputTokens, output: totals.output + entry.outputTokens };
    }, { input: 0, output: 0 });

    return Object.freeze({
      departmentId: department.id,
      name: department.name ?? null,
      gradeable: true,
      reason: null,
      score: graded.composite,
      grade: graded.grade,
      subscores: graded.subscores,
      categories: graded.categories,
      // Read off Theo's result, never written down here.
      rubricVersion: graded.rubricVersionId,
      coverage,
      tokens: Object.freeze({ ...tokens, source: "billing_aggregate" }),
      spend,
      join,
      confidence,
    });
  });

  const billingRowsWithoutSample = [...index.keys()].filter((key) => !matchedKeys.has(key)).length;
  return { scored, sampleRowsWithoutBillingMatch, billingRowsWithoutSample };
}

function roundRatio(value) {
  const factor = 10 ** PROMPT_LITERACY_RUBRIC.reporting.shareDecimals;
  return Math.round(value * factor) / factor;
}

/**
 * The cohort comparison, or an honest refusal with a code.
 *
 * The cohort is the reader's own graded departments. There is no external peer
 * data in this product and none is implied: the copy says which cohort it is.
 */
export function benchmarkFromDepartments(scored, { hasSample }) {
  const gradeable = scored.filter((department) => department.gradeable);
  const reasonCode = !hasSample ? BENCHMARK_REASONS.noCompatibleCohort
    : gradeable.length < MIN_COHORT_DEPARTMENTS
      ? BENCHMARK_REASONS.insufficientGradeableDepartments
      : BENCHMARK_REASONS.intraTenantCohort;
  if (reasonCode !== BENCHMARK_REASONS.intraTenantCohort) {
    return Object.freeze({
      state: "unavailable",
      eligible: false,
      reasonCode,
      message: BENCHMARK_COPY[reasonCode],
      methodology: BENCHMARK_METHODOLOGY,
      rubricVersion: RUBRIC_VERSION_ID,
      cohort: null,
      comparisons: Object.freeze([]),
    });
  }

  const scores = gradeable.map((department) => department.score).sort((a, b) => a - b);
  const comparisons = gradeable.map((department) => {
    const peers = gradeable
      .filter((other) => other.departmentId !== department.departmentId)
      .map((other) => other.score)
      .sort((a, b) => a - b);
    const peerMedian = roundComposite(median(peers));
    const deltaPoints = roundComposite(department.score - peerMedian);
    return Object.freeze({
      departmentId: department.departmentId,
      score: department.score,
      peerMedian,
      deltaPoints,
      position: deltaPoints > 0 ? "above" : deltaPoints < 0 ? "below" : "at",
    });
  }).sort((left, right) => right.deltaPoints - left.deltaPoints
    || left.departmentId.localeCompare(right.departmentId));

  return Object.freeze({
    state: "available",
    eligible: true,
    reasonCode: BENCHMARK_REASONS.intraTenantCohort,
    message: BENCHMARK_COPY[BENCHMARK_REASONS.intraTenantCohort],
    methodology: BENCHMARK_METHODOLOGY,
    rubricVersion: RUBRIC_VERSION_ID,
    cohort: Object.freeze({
      kind: "intra_tenant",
      size: gradeable.length,
      medianScore: roundComposite(median(scores)),
    }),
    comparisons: Object.freeze(comparisons),
  });
}

/**
 * The whole analysis: per-department performance, the join's failure counts, the
 * organization's eligibility verdict, and the benchmark.
 *
 * @param {{sample?: object|null, providerRecords?: ReadonlyArray<object>,
 *   departments?: ReadonlyArray<{id: string, name?: string, spendUsd?: number,
 *     unitKeys?: ReadonlyArray<string>}>, grouping?: object|null}} input
 *   `grouping` is Anya's `detectDialect` result for the imported provider
 *   export. Omitting it is the org-pseudonym key space, unchanged.
 */
export function analyzeQueryLiteracy({
  sample = null, providerRecords = [], departments = [], grouping = null,
} = {}) {
  const records = Array.isArray(sample?.records) ? sample.records : [];
  const list = Array.isArray(departments) ? departments : [];
  const index = billingIndex(providerRecords);
  const hasSample = Boolean(sample) && (sample.counts?.total ?? records.length) > 0;
  const resolution = resolveJoinKeySpace({ grouping, departments: list });

  const { scored, sampleRowsWithoutBillingMatch, billingRowsWithoutSample } =
    scoreDepartments({ records, departments: list, index, resolution });

  // Organization eligibility, through Noor's exported seam. Covered spend is the
  // spend of departments that produced a grade; total is the analysed set's
  // spend. Uncovered departments become the ranked next action.
  const covered = scored.filter((department) => department.gradeable);
  const eligibility = gradeEligibilityFromCoverage(
    sampledSpendCoverage({
      coveredUsd: covered.reduce((sum, department) => sum + department.spend.totalUsd, 0),
      totalUsd: scored.reduce((sum, department) => sum + department.spend.totalUsd, 0),
    }),
    {
      groups: scored
        .filter((department) => !department.gradeable && department.spend.totalUsd > 0)
        .map((department) => ({
          key: department.name ?? department.departmentId,
          uncoveredUsd: department.spend.totalUsd,
        })),
    },
  );

  // A sample row whose key resolves to no department never reaches a bucket
  // above, so it is counted here rather than lost. A key refused for colliding
  // across two departments lands here too: it is unattributable, which is the
  // same fact as naming nobody.
  const orphanRows = records.filter(
    (record) => (resolution.keys.get(record.department) ?? null) === null,
  ).length;

  // THE NAMED MISSING INPUT. Two facts, never a zero and never a silent
  // default: no sample was imported at all, or a sample was imported and not one
  // of its keys names a billed unit. Both suppress the grade through the
  // eligibility verdict above — this only supplies the sentence that says which
  // input is missing and the one action that supplies it.
  const missingInput = !hasSample ? missingInputNotice("noSample")
    : orphanRows === records.length && records.length > 0
      ? missingInputNotice("unresolvedSample", { unit: resolution.detectedUnit })
      : null;

  return Object.freeze({
    version: QUERY_LITERACY_VERSION,
    sampleVersion: QUERY_SAMPLE_VERSION,
    classifierVersion: sample?.classifierVersion ?? QUERY_CLASSIFIER_VERSION,
    rubricVersion: RUBRIC_VERSION_ID,
    available: hasSample,
    departments: Object.freeze(scored),
    sample: Object.freeze({
      total: sample?.counts?.total ?? 0,
      accepted: sample?.counts?.accepted ?? 0,
      classified: sample?.counts?.classified ?? 0,
      unclassified: sample?.counts?.unclassified ?? 0,
      rejected: sample?.counts?.rejected ?? 0,
      rejections: sample?.rejections?.byCode ?? Object.freeze([]),
    }),
    join: Object.freeze({
      billingPairs: index.size,
      sampleRowsWithoutBillingMatch: sampleRowsWithoutBillingMatch + orphanRows,
      sampleRowsInUnknownDepartment: orphanRows,
      billingRowsWithoutSample,
    }),
    // How the sample was joined, published so a disputed grade can be checked
    // without reading this module.
    joinKey: Object.freeze({
      space: resolution.space,
      unit: resolution.unit,
      detectedUnit: resolution.detectedUnit,
      declaredUnitKeys: resolution.declaredUnitKeys,
      ambiguousKeys: resolution.collisions.length,
    }),
    missingInput,
    eligibility,
    benchmark: benchmarkFromDepartments(scored, { hasSample }),
  });
}
