// Scoring a *local* organizational query sample into department grades.
//
// WHAT THIS IS. `org-query-source.js` says which local files may be read and
// hands back validated records: an organization unit, a UTC day bucket, a model,
// token counts, and either a declared rubric category or a bounded excerpt. That
// is evidence, not a score. This module is the one step from that evidence to
// the four things a leader is shown — a literacy grade per unit, the query mix
// behind it, a confidence with the factor that capped it, and the coaching gap
// the weakest graded unit carries — and nothing else.
//
// WRITTEN TO BE DISPUTED. Every number below is one of exactly three things:
//
//   (a) a count read off the reader's own file;
//   (b) a weight in `ORG_QUERY_SCORING_WEIGHTS`, each row carrying the
//       assumption behind it and the module that owns it;
//   (c) arithmetic already published by a module this one imports — the rubric's
//       category credits, the recoverability table, the grading floors.
//
// There is no fourth source, and (c) is deliberately never re-declared here. A
// second copy of a weight is a second thing to disagree with, and the two
// would drift the first time either moved. `docs/org-query-scoring.md` is this
// same table in prose for a reader who will not open a `.js` file.
//
// THE REDACTION BOUNDARY IS `classifyRecords` AND NOTHING ELSE. A validated
// record may still carry `promptExcerpt` — the contract admits an excerpt of at
// most 280 characters. That excerpt is read exactly once, inside
// `classifyRecords`, by the browser-local classifier, and the classified record
// is *built from an allowlist* rather than copied and deleted: there is no
// excerpt key on the way out because nothing writes one. Everything downstream
// — the grade, the mix, the confidence, the coaching gap, the decision records
// the page renders — is derived from classified records, so no prompt text can
// reach a persisted, exported, or rendered object through this path.
//
// WHAT THIS MODULE REFUSES TO DO.
//   1. It computes no cost. The organizational query sample carries no money,
//      and `spendUsd` on every record it emits is null rather than apportioned
//      from tokens. Provider-cost arithmetic stays entirely in the provider
//      import path, untouched.
//   2. It grades no unit it cannot place. A record whose organization unit is
//      absent or `(ungrouped)` is attributed to `(unattributed)` and counted
//      there, never folded into another unit's total.
//   3. It publishes no letter for a sample below the floor, and no confidence
//      word above its weakest factor.
//
// Determinism: no clock, no randomness, no iteration over an unordered map, and
// no I/O of any kind. Identical records in yield a byte-identical result out,
// and `provenance.inputDigest` is the handle for saying so in a dispute.

import {
  RUBRIC_SIGNALS, UNATTRIBUTED_DEPARTMENT, aggregateConversationLiteracy,
} from "./conversation-literacy.js";
import { UNGROUPED_DEPARTMENT } from "./dialect-profiles.js";
import { ORG_QUERY_SAMPLING, organizationalSampleSummary } from "./org-query-source.js";
import { PROMPT_LITERACY_RUBRIC, RUBRIC_VERSION_ID } from "./prompt-literacy-scoring.js";
import {
  MINIMUM_CLASSIFICATION_CONFIDENCE, QUERY_CLASSIFIER_VERSION, classifyQuery,
} from "./query-classification.js";
import { MIN_JOINED_RECORDS_FOR_GRADE } from "./query-literacy.js";

/** Bump when a weight, a floor, an outcome, or the emitted shape changes. */
export const ORG_QUERY_SCORING_VERSION = "org-query-scoring/1.0.0";

/**
 * What a producer's own declared category is worth, as classifier confidence.
 *
 * ASSUMPTION 0.90: a declared category is the gateway owner's statement about a
 * query this page never saw. It is the best evidence available and is used
 * unchanged for the grade — but recording it at 1.00 would claim this product
 * verified a classification it structurally cannot re-derive, and the mean
 * classifier confidence a reader is shown would then be a number nobody
 * measured. 0.90 is a stated discount, not a measurement, and it moves no
 * letter: confidence is reported beside the grade and is never an input to it.
 */
export const DECLARED_CATEGORY_CONFIDENCE = 0.9;

/** How a record's category was arrived at. Both values are always published. */
export const CLASSIFIED_BY = Object.freeze({
  declared: "declared_by_source",
  classifier: "browser_local_classifier",
});

const CATEGORY_KEYS = new Set(PROMPT_LITERACY_RUBRIC.categories.map((entry) => entry.key));
const CATEGORY_LABELS = new Map(
  PROMPT_LITERACY_RUBRIC.categories.map((entry) => [entry.key, entry.label]));
const FLOOR = ORG_QUERY_SAMPLING.gradeable_floor;

/**
 * Every weight and floor this module scores with, with the assumption behind it
 * and the module that owns it. Exported as data rather than buried in branches,
 * because a director who wants to argue with a number needs one place to read
 * them all and a test needs one place to assert them from.
 *
 * `owner` matters as much as `value`: a row this module does not own is one it
 * reads from the module that does, so the two cannot disagree.
 */
export const ORG_QUERY_SCORING_WEIGHTS = Object.freeze([
  Object.freeze({
    id: "declared_category_confidence",
    value: DECLARED_CATEGORY_CONFIDENCE,
    owner: "org-query-scoring.js",
    assumption: "ASSUMPTION 0.90: a category the source declared is used unchanged for the "
      + "grade but is not recorded as verified, because this page cannot re-derive it from an "
      + "excerpt it was never given.",
  }),
  Object.freeze({
    id: "classifier_confidence_floor",
    value: MINIMUM_CLASSIFICATION_CONFIDENCE,
    owner: "query-classification.js",
    assumption: "Borrowed, not re-declared: an excerpt the local classifier places below its "
      + "own floor is reported unclassified rather than graded at low confidence. A second "
      + "floor here would be a quieter one nobody agreed to.",
  }),
  Object.freeze({
    id: "min_classified_prompts_for_letter",
    value: MIN_JOINED_RECORDS_FOR_GRADE,
    owner: "query-literacy.js",
    assumption: "Borrowed: under this many classified prompts a single query moves the "
      + "composite by twenty points or more, so the letter would describe the sample rather "
      + "than the unit.",
  }),
  Object.freeze({
    id: "publishable_prompts_per_unit",
    value: FLOOR.prompts_per_org_unit,
    owner: "prompt-grading-eligibility.js, via the org-query-source registry",
    assumption: "A letter is published at the letter floor above; the registry's higher floor "
      + "is what this module reports as *publishable* to an executive. Two floors on purpose: "
      + "showing a unit its own reading and putting that reading in a board pack are different "
      + "acts with different costs of being wrong.",
  }),
  Object.freeze({
    id: "classified_share_floor",
    value: FLOOR.classified_share,
    owner: "prompt-grading-eligibility.js, via the org-query-source registry",
    assumption: "Borrowed: below this share of the sample classified, the grade describes the "
      + "rows the classifier happened to recognize rather than the unit's traffic.",
  }),
  Object.freeze({
    id: "history_window_days",
    value: FLOOR.history_window_days,
    owner: "prompt-grading-eligibility.js, via the org-query-source registry",
    assumption: "Borrowed: a sample spanning fewer days than this is one unusual week, and a "
      + "grade published from it will move when the week does.",
  }),
  Object.freeze({
    id: "category_score_credits",
    value: null,
    owner: "prompt-literacy-rubric.json",
    assumption: "Not re-declared. The 0-100 credit per rubric category is the published "
      + "rubric's, read through scorePromptLiteracy, so the letter this module reports and the "
      + "letter every other surface reports are the same arithmetic.",
  }),
  Object.freeze({
    id: "signal_recoverability",
    value: null,
    owner: "conversation-literacy.js (RUBRIC_SIGNALS)",
    assumption: "Not re-declared. Which share of a category's gap an AI-literacy programme "
      + "can move is one judgement in one table; the coaching gap this module names is ranked "
      + "by that table and by nothing of its own.",
  }),
]);

/** The sentence this module's numbers are always shown beside. */
export const ORG_QUERY_REDACTION_STATEMENT =
  "These grades are computed from per-unit category counts and day buckets only. Any prompt "
  + "excerpt in the chosen file is read once by the classifier in this tab and is never stored, "
  + "exported, or drawn on this page.";

/** Why a sample produced no gradeable unit at all. Stable codes. */
export const ORG_QUERY_SCORING_CODES = Object.freeze({
  NO_RECORDS: "no_records",
  NO_CLASSIFIED_RECORDS: "no_classified_records",
  NO_GRADEABLE_UNIT: "no_gradeable_unit",
  SOURCE_DOES_NOT_GRADE: "source_does_not_grade",
});

// --- the redaction boundary -------------------------------------------------

/**
 * The keys a classified record may carry. Eight values: two identifiers the
 * contract already declared pseudonymous, a day bucket, a model string the
 * rubric's own pattern admits, a rubric category key, a number, and two token
 * counts. There is no ninth key, and none of the eight can be read back toward
 * a sentence somebody typed.
 */
export const ORG_CLASSIFIED_RECORD_KEYS = Object.freeze([
  "orgUnitId", "queryDate", "model", "category", "confidence", "classifiedBy",
  "inputTokens", "outputTokens",
]);

/**
 * Classify validated records, and drop every excerpt on the way through.
 *
 * This mirrors `classifyQuerySample`'s boundary in `query-sample-contract.js`
 * and differs from it in one way that matters here: it keeps the classifier's
 * *confidence* and hands the model string to the classifier, so a model-tier
 * rule can fire and a mean confidence can be reported. The excerpt is a local
 * `const` inside this loop and appears in no returned object.
 *
 * A record the classifier will not place is reported in `unclassified`, never
 * guessed at, and it stays in its unit's denominator — a sample that got worse
 * must not look like a sample that got smaller.
 */
export function classifyRecords(records = []) {
  const classified = [];
  const unclassified = [];
  for (const record of Array.isArray(records) ? records : []) {
    const declared = typeof record?.category === "string" ? record.category : null;
    const model = typeof record?.model === "string" ? record.model : null;
    const unit = orgUnitOf(record);
    if (declared && CATEGORY_KEYS.has(declared)) {
      classified.push(classifiedRecord(record, unit, declared, DECLARED_CATEGORY_CONFIDENCE,
        CLASSIFIED_BY.declared, model));
      continue;
    }
    // The one read of the excerpt, and the only place one exists in this module.
    const excerpt = typeof record?.promptExcerpt === "string" ? record.promptExcerpt : null;
    const verdict = classifyQuery({ excerpt, model });
    if (verdict.classified && CATEGORY_KEYS.has(verdict.category)) {
      classified.push(classifiedRecord(record, unit, verdict.category, verdict.confidence,
        CLASSIFIED_BY.classifier, model));
      continue;
    }
    // The reason is the classifier's own code — "no excerpt", "no signal",
    // "below the confidence floor" — and carries no cell value.
    unclassified.push(Object.freeze({
      orgUnitId: unit,
      queryDate: dayBucketOf(record),
      reason: verdict.reason,
    }));
  }
  return Object.freeze({
    classifierVersion: QUERY_CLASSIFIER_VERSION,
    records: Object.freeze(classified),
    unclassified: Object.freeze(unclassified),
  });
}

function classifiedRecord(record, orgUnitId, category, confidence, classifiedBy, model) {
  return Object.freeze({
    orgUnitId,
    queryDate: dayBucketOf(record),
    model,
    category,
    confidence: roundShare(confidence),
    classifiedBy,
    inputTokens: Number.isInteger(record?.inputTokens) ? record.inputTokens : null,
    outputTokens: Number.isInteger(record?.outputTokens) ? record.outputTokens : null,
  });
}

/**
 * The unit a record is attributed to.
 *
 * Attribution is required, so a record with no unit — or one the conversation
 * dialect layer already marked `(ungrouped)` — becomes `(unattributed)`, which
 * `aggregateConversationLiteracy` refuses to grade. That refusal is the whole
 * point: an unplaceable query is not organizational evidence, and quietly
 * dropping it would raise every other unit's share of the sample.
 */
function orgUnitOf(record) {
  const unit = typeof record?.orgUnitId === "string" ? record.orgUnitId.trim() : "";
  return !unit || unit === UNGROUPED_DEPARTMENT ? UNATTRIBUTED_DEPARTMENT : unit;
}

function dayBucketOf(record) {
  const day = typeof record?.queryDate === "string" ? record.queryDate.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function roundShare(value) {
  const factor = 10 ** PROMPT_LITERACY_RUBRIC.reporting.shareDecimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

// --- aggregation ------------------------------------------------------------

/**
 * Grade one or more validated organizational query-source results.
 *
 * @param {{results?: ReadonlyArray<object>, minimumPrompts?: number}} input
 *   `results` are `validateOrgQuerySource` / `orgQuerySampleResult` results with
 *   `ok: true`. Several are merged, because a reader who exports two months
 *   has one sample in two files.
 * @returns a frozen model: the per-unit rows in the shape
 *   `departmentEvidenceModel` already consumes, the query mix, the confidence
 *   with its factors, the coaching gap, and the provenance a dispute needs.
 *
 * Callers pass no grouping unit and no options. That is deliberate: the key
 * space was decided when the file was parsed, and a surface that has only a
 * query sample — no billing export beside it — has no provider grouping unit to
 * supply. Requiring one here is what stopped a gradeable import from reaching
 * the drill-down at all.
 */
export function orgQueryDepartmentLiteracy({ results = [], minimumPrompts } = {}) {
  const list = (Array.isArray(results) ? results : []).filter((entry) => entry?.ok === true);
  const floor = Number.isInteger(minimumPrompts) ? minimumPrompts : MIN_JOINED_RECORDS_FOR_GRADE;
  const records = list.flatMap((entry) => (Array.isArray(entry.records) ? entry.records : []));
  const gradesLiteracy = list.length > 0
    && list.every((entry) => entry.grades === "prompt_literacy");
  const classification = classifyRecords(records);

  // One synthetic parse handed to the aggregator that already owns this
  // arithmetic. The rubric, the letter, the signal impacts and the score
  // distribution are its answers, not a second implementation of them here.
  // `prompt_chars` is deliberately absent: a query sample carries no prompt
  // body, so there is no length band to report and the structural sketches are
  // published empty rather than as "no prompt body" on every row.
  const aggregated = aggregateConversationLiteracy({
    parsed: {
      records: classification.records.map((record) => ({ department: record.orgUnitId })),
      classifications: classification.records.map((record) => ({
        classified: true,
        category: record.category,
        confidence: record.confidence,
        modelTier: null,
      })),
      contractVersion: list[0]?.registryContract ?? null,
      profileId: list[0]?.dialect ?? null,
    },
    minimumPrompts: floor,
  });

  // Unclassified records belong in their unit's denominator, and the aggregator
  // above was only handed the classified ones. Reuniting them here is what keeps
  // `coverage` a statement about the file rather than about the classifier.
  const unclassifiedByUnit = new Map();
  for (const entry of classification.unclassified) {
    unclassifiedByUnit.set(entry.orgUnitId, (unclassifiedByUnit.get(entry.orgUnitId) ?? 0) + 1);
  }
  // A unit every one of whose records the classifier declined is absent from the
  // aggregation above — it had nothing classified to aggregate — and dropping it
  // would let a wholly unclassifiable file report zero units rather than units
  // with nothing to grade. Those two are different facts, and the second is the
  // one the reader has to act on.
  const aggregatedUnits = new Set(aggregated.departments.map((row) => row.department));
  const departments = Object.freeze([
    ...aggregated.departments.map((row) =>
      withUnclassified(row, unclassifiedByUnit.get(row.department) ?? 0)),
    ...[...unclassifiedByUnit.keys()]
      .filter((unit) => !aggregatedUnits.has(unit))
      .map((unit) => unclassifiedUnitRow(unit, unclassifiedByUnit.get(unit))),
  ].sort((left, right) => left.department.localeCompare(right.department)));
  const graded = departments.filter((row) => row.gradeable === true);

  const summary = organizationalSampleSummary(records,
    { grades: gradesLiteracy ? "prompt_literacy" : "attribution_and_volume" });
  const mix = mixOf(classification.records);
  const confidence = sampleConfidence(summary, classification);
  const reasonCode = scoringReason(list, records, classification, graded, gradesLiteracy);

  return Object.freeze({
    version: ORG_QUERY_SCORING_VERSION,
    sources: Object.freeze(list.map((entry) => Object.freeze({
      sourceId: entry.sourceId,
      sourceLabel: entry.sourceLabel,
      dialect: entry.dialect,
      grades: entry.grades,
      recordCount: entry.records?.length ?? 0,
    }))),
    // The one boolean a surface branches on: is there a unit whose letter this
    // module will publish? Everything else is evidence about why.
    gradeable: graded.length > 0,
    reasonCode,
    departments,
    ranking: aggregated.ranking,
    company: aggregated.company,
    mix,
    confidence,
    coachingGap: coachingGap(graded),
    summary,
    prompts: Object.freeze({
      total: records.length,
      classified: classification.records.length,
      unclassified: classification.unclassified.length,
      declared: classification.records
        .filter((record) => record.classifiedBy === CLASSIFIED_BY.declared).length,
    }),
    provenance: Object.freeze({
      scorerVersion: ORG_QUERY_SCORING_VERSION,
      rubricVersion: RUBRIC_VERSION_ID,
      classifierVersion: classification.classifierVersion,
      registryContract: list[0]?.registryContract ?? null,
      basis: "per-unit rubric category counts and UTC day buckets; no cost and no prompt text",
      letterFloor: floor,
      publishableFloor: FLOOR.prompts_per_org_unit,
      inputDigest: orgQueryDigest(classification.records),
    }),
    weights: ORG_QUERY_SCORING_WEIGHTS,
    redaction: Object.freeze({
      statement: ORG_QUERY_REDACTION_STATEMENT,
      classifiedRecordKeys: ORG_CLASSIFIED_RECORD_KEYS,
    }),
  });
}

/**
 * Put a unit's unclassified records back in its denominator.
 *
 * The letter, the signals and the distribution are untouched — they are facts
 * about the classified prompts and stay that way. `total`, `unclassified` and
 * `coverage` are restated over the whole sample, which is the denominator the
 * evidence panel prints and the one a reader would check by counting rows.
 * Sketches are published empty: see the note in `orgQueryDepartmentLiteracy`.
 */
function withUnclassified(row, unclassified) {
  const total = row.prompts.total + unclassified;
  return Object.freeze({
    ...row,
    prompts: Object.freeze({
      total,
      classified: row.prompts.classified,
      unclassified: row.prompts.unclassified + unclassified,
      meanConfidence: row.prompts.meanConfidence,
    }),
    coverage: total > 0 ? roundShare(row.prompts.classified / total) : 0,
    sketches: Object.freeze({
      represented: 0, signatureCount: 0, shownCount: 0, shownPrompts: 0,
      signatures: Object.freeze([]),
      note: "A query sample carries no prompt body, so there is no length band to sketch.",
    }),
  });
}

/**
 * A unit whose every record the classifier declined. Same row shape as an
 * ungraded aggregated unit, so a consumer branches once: no letter, no signals,
 * a named reason, and its full denominator.
 */
function unclassifiedUnitRow(unit, unclassified) {
  return Object.freeze({
    department: unit,
    attribution: Object.freeze(["export_column"]),
    gradeable: false,
    score: null,
    grade: null,
    subscores: null,
    reasonCode: ORG_QUERY_SCORING_CODES.NO_CLASSIFIED_RECORDS,
    reasonText: "No record attributed to this unit could be classified into a rubric category, "
      + "so there is nothing here to grade.",
    prompts: Object.freeze({
      total: unclassified, classified: 0, unclassified, meanConfidence: null,
    }),
    coverage: 0,
    confidence: null,
    signals: Object.freeze([]),
    driver: null,
    impact: 0,
    distribution: Object.freeze(PROMPT_LITERACY_RUBRIC.categories.map((category) => Object.freeze({
      key: category.key, label: category.label, count: 0, share: 0,
    }))),
    sketches: Object.freeze({
      represented: 0, signatureCount: 0, shownCount: 0, shownPrompts: 0,
      signatures: Object.freeze([]),
    }),
    rubricVersion: null,
  });
}

/** The query mix over every classified record: the rubric's own categories. */
function mixOf(records) {
  const counts = new Map();
  for (const record of records) {
    counts.set(record.category, (counts.get(record.category) ?? 0) + 1);
  }
  const total = records.length;
  return Object.freeze(PROMPT_LITERACY_RUBRIC.categories.map((category) => {
    const count = counts.get(category.key) ?? 0;
    return Object.freeze({
      key: category.key,
      label: category.label,
      count,
      share: total > 0 ? roundShare(count / total) : 0,
    });
  }));
}

/** The mix as the counts object `normalizeMix` and the drill-down consume. */
export function mixCounts(mix = []) {
  return Object.freeze(Object.fromEntries(mix.map((entry) => [entry.key, entry.count])));
}

const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);
const weakest = (levels) => CONFIDENCE_LEVELS.find((level) => levels.includes(level)) ?? "low";

/**
 * Confidence as the weakest of three factors, never an average.
 *
 * ASSUMPTION: the three floors the registry already publishes are the three
 * things that can make a sample unrepresentative — too few prompts in a unit,
 * too little of the sample classified, too short a window. Each factor is
 * `high` at or above its floor, `medium` at or above half of it, `low` below
 * that; the reported level is the weakest, because a 5,000-prompt sample over
 * three days is still three days and averaging the factors is exactly how an
 * unexplainable number reaches an executive view.
 */
export function sampleConfidence(summary, classification) {
  // Counted over *classified* records, not over rows the file happened to
  // contain. A unit whose thirty prompts the classifier all declined has thirty
  // rows and nothing to grade, and reporting high confidence on the row count
  // would be the single most misleading number this module could publish.
  const perUnit = new Map();
  for (const record of classification.records) {
    perUnit.set(record.orgUnitId, (perUnit.get(record.orgUnitId) ?? 0) + 1);
  }
  const largest = Math.max(0, ...perUnit.values());
  const total = classification.records.length + classification.unclassified.length;
  const classifiedShare = total > 0 ? roundShare(classification.records.length / total) : 0;
  const factors = Object.freeze([
    factor("prompts_per_unit", largest, FLOOR.prompts_per_org_unit,
      `${largest} classified quer${largest === 1 ? "y" : "ies"} in the largest unit `
      + `(${FLOOR.prompts_per_org_unit} is the publishable floor).`),
    factor("classified_share", classifiedShare, FLOOR.classified_share,
      `${Math.round(classifiedShare * 100)}% of the ${total} sampled record`
      + `${total === 1 ? "" : "s"} carry a rubric category `
      + `(${Math.round(FLOOR.classified_share * 100)}% is the floor); `
      + `${classification.unclassified.length} record`
      + `${classification.unclassified.length === 1 ? "" : "s"} could not be classified.`),
    factor("history_window_days", summary.windowDays, FLOOR.history_window_days,
      `${summary.windowDays} day${summary.windowDays === 1 ? "" : "s"} between the first and `
      + `last bucket (${FLOOR.history_window_days} is the floor).`),
  ]);
  return Object.freeze({
    level: weakest(factors.map((entry) => entry.level)),
    factors,
    rule: "the weakest of the three factors, never their average",
  });
}

function factor(key, observed, target, detail) {
  const level = observed >= target ? "high" : observed >= target / 2 ? "medium" : "low";
  return Object.freeze({ key, level, observed, target, detail });
}

const SIGNAL_LABELS = new Map(RUBRIC_SIGNALS.map((signal) => [signal.key, signal.label]));

/**
 * The one unit to coach first, and the signal to coach it on.
 *
 * Ranked by recoverable prompt-points — `conversation-literacy.js`'s formula,
 * not a second one — so the answer is "where would the next workshop recover
 * the most", not "who looks worst". A graded unit whose weakness is entirely in
 * the reference class has no driver and says so.
 */
export function coachingGap(graded = []) {
  const ranked = [...graded]
    .filter((row) => row.driver)
    .sort((left, right) => right.impact - left.impact
      || left.department.localeCompare(right.department));
  const worst = ranked[0] ?? null;
  if (!worst) {
    return Object.freeze({
      department: null,
      signal: null,
      text: graded.length
        ? "No coaching gap: every graded unit's classified prompts sit in the reference class."
        : "No coaching gap can be named until at least one unit is graded.",
    });
  }
  return Object.freeze({
    department: worst.department,
    grade: worst.grade,
    score: worst.score,
    signal: worst.driver.key,
    signalLabel: SIGNAL_LABELS.get(worst.driver.key) ?? worst.driver.label,
    share: worst.driver.share,
    numerator: worst.driver.numerator,
    denominator: worst.driver.denominator,
    impact: worst.impact,
    text: `${worst.department} carries the largest recoverable gap: ${worst.driver.numerator} of `
      + `${worst.driver.denominator} classified prompts show weak ${worst.driver.label}, worth `
      + `${worst.driver.impact} recoverable prompt-points.`,
  });
}

function scoringReason(list, records, classification, graded, gradesLiteracy) {
  if (!list.length || !records.length) return ORG_QUERY_SCORING_CODES.NO_RECORDS;
  if (!gradesLiteracy) return ORG_QUERY_SCORING_CODES.SOURCE_DOES_NOT_GRADE;
  if (!classification.records.length) return ORG_QUERY_SCORING_CODES.NO_CLASSIFIED_RECORDS;
  return graded.length ? null : ORG_QUERY_SCORING_CODES.NO_GRADEABLE_UNIT;
}

/**
 * A stable 32-bit FNV-1a over the classified counts, as eight hex digits.
 *
 * Not a security primitive and not claimed as one. It is a handle: two people
 * disputing a grade compare digests and learn in one line whether they are
 * arguing about the same sample or about two different exports.
 */
export function orgQueryDigest(records = []) {
  const counts = new Map();
  for (const record of records) {
    const key = `${record.orgUnitId}|${record.queryDate}|${record.category}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const canonical = JSON.stringify([ORG_QUERY_SCORING_VERSION, RUBRIC_VERSION_ID,
    [...counts.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1))]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// --- the decision surface's own input ---------------------------------------

/**
 * The imported units as the drill-down's department records.
 *
 * The decision surface already knows how to rank departments, paint a
 * drill-down, and refuse to publish a figure it does not have. What it never
 * had was a *reader's own* department to do it for. These are those records, in
 * the shape that surface reads, with three deliberate absences:
 *
 *   - `spendUsd` and `previousPeriod` are null. This sample carries no money, so
 *     the cost trend reports itself unavailable rather than apportioning dollars
 *     out of token counts. Provider-cost arithmetic is untouched by this path.
 *   - `actionPlan` is absent, so the drill-down runs its deterministic scorer
 *     rather than showing a reviewed intervention nobody reviewed.
 *   - `name` is the unit key verbatim. The registry groups by the key as
 *     written and never parses it, so this surface does not prettify it either.
 */
export function orgQueryDecisionDepartments(literacy) {
  const rows = Array.isArray(literacy?.departments) ? literacy.departments : [];
  const buckets = literacy?.summary?.buckets ?? [];
  const through = buckets.length ? buckets[buckets.length - 1] : null;
  const periodDays = (literacy?.summary?.windowDays ?? 0) + 1;
  return Object.freeze(rows
    .filter((row) => row.department !== UNATTRIBUTED_DEPARTMENT)
    .map((row) => Object.freeze({
      id: row.department,
      name: row.department,
      spendUsd: null,
      previousPeriod: null,
      periodDays,
      period: buckets.length ? `${buckets[0]} to ${through}` : null,
      mix: mixCounts(distributionMix(row)),
      sampling: Object.freeze({
        status: row.prompts.classified > 0 ? "available" : "unavailable",
        sampledQueries: row.prompts.classified,
        sampledThrough: through,
        // No clock is read here, so freshness is stated as what it is: the last
        // bucket the reader's own file carried, not a comparison against today.
        freshnessLabel: through
          ? `through the last day bucket in your file (${through})`
          : "no usable day bucket in this sample",
        reason: row.gradeable ? null : row.reasonText,
      }),
    })));
}

/** One unit's classified distribution as a mix list `mixCounts` can read. */
function distributionMix(row) {
  return (Array.isArray(row.distribution) ? row.distribution : []).map((entry) => Object.freeze({
    key: entry.key,
    label: CATEGORY_LABELS.get(entry.key) ?? entry.key,
    count: entry.count,
    share: entry.share,
  }));
}

/**
 * The provenance block beside those records: whose file, read as what, graded by
 * which versions. Every field is a statement about the import; none of it is a
 * cell value, and there is no benchmark or retained evidence to offer because
 * this path has neither.
 */
export function orgQueryDecisionData(literacy) {
  const source = literacy?.sources?.[0] ?? null;
  return Object.freeze({
    provenance: Object.freeze({
      label: source
        ? `Your imported query sample — ${source.sourceLabel}`
        : "Imported query sample",
      generatedAt: literacy?.summary?.buckets?.[literacy.summary.buckets.length - 1] ?? null,
      billingSource: "no provider export in this selection; no cost is stated for these units",
      orgSource: `${literacy?.provenance?.registryContract ?? "org-query-source"} · `
        + `${literacy?.provenance?.scorerVersion} · ${literacy?.provenance?.rubricVersion} · `
        + `digest ${literacy?.provenance?.inputDigest}`,
    }),
    // Declared empty rather than omitted: the surfaces that read these two ask
    // "is there a peer cohort" and "was any evidence retained", and for an
    // imported query sample the honest answer to both is no.
    benchmark: Object.freeze({}),
    evidence: Object.freeze([]),
  });
}

/** The graded rows keyed by the id the decision surface addresses them with. */
export function orgQueryDepartmentRows(literacy) {
  const rows = Array.isArray(literacy?.departments) ? literacy.departments : [];
  return new Map(rows.map((row) => [row.department, row]));
}
