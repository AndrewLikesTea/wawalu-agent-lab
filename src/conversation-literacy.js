// Per-department AI-literacy grades from an imported conversation export.
//
// The pipeline, end to end, and who owns which step:
//
//   file text        -> `readDelimitedText`            (delimited-text.js)
//   table            -> `parseConversationExport`      (conversation-export.js, Anya)
//   prompt cell      -> `classifyQuery`                (query-classification.js, Theo)
//   category mix     -> `scorePromptLiteracy`          (prompt-literacy-scoring.js, Theo)
//   minimum sample   -> `MIN_JOINED_RECORDS_FOR_GRADE` (query-literacy.js, Noor)
//   coverage tiers   -> `COVERAGE_TIERS`               (grade-eligibility.js, Noor)
//
// This module owns exactly three decisions and nothing else: which department a
// record belongs to, which rubric signal drives a department's weakness, and how
// much of that weakness is recoverable. Every score, cutoff, letter and
// threshold below is read out of a module above. There is no second rubric here.
//
// ---------------------------------------------------------------------------
// WHY THE CLASSIFIER RUNS INSIDE THE PARSE
// ---------------------------------------------------------------------------
//
// A parsed conversation record carries counts, never text — that is the whole
// point of Anya's contract, and it is why this module cannot classify a record
// it was handed. The prompt body exists for the length of one row inside
// `parseConversationExport`, so the classifier is passed *in* there and its
// answer comes back as the index-aligned `classifications` array this module
// reads. Nothing here ever sees an excerpt, and there is no code path that
// could: the excerpt is not a field on anything this module is given.
//
// ---------------------------------------------------------------------------
// DELIBERATE OMISSIONS
// ---------------------------------------------------------------------------
//
// * No spend. A conversation export carries no cost field. Every figure below is
//   counted in prompts and says so; a per-prompt price would be an invention.
// * No trend, no cohort, no benchmark. `query-literacy.js` already answers those
//   for the sample-plus-billing join, and a second answer computed from a
//   different denominator would be a second product.
// * No rendering. Every string this module emits is assembled from a count, a
//   department name, or an authored phrase — never from a cell.

import { COVERAGE_TIERS } from "./grade-eligibility.js";
import { readDelimitedText } from "./delimited-text.js";
import { UNGROUPED_DEPARTMENT, parseConversationExport } from "./conversation-export.js";
import {
  PROMPT_LITERACY_RUBRIC, categoryScoreWeight, letterGradeForScore, scorePromptLiteracy,
} from "./prompt-literacy-scoring.js";
import { QUERY_CLASSIFIER_VERSION, classifyQuery } from "./query-classification.js";
import { MIN_JOINED_RECORDS_FOR_GRADE, NOT_GRADEABLE_REASONS } from "./query-literacy.js";

/** Bump when a reason code, a field, or the impact formula changes meaning. */
export const CONVERSATION_LITERACY_VERSION = "conversation-literacy/1.0.0";

/** The bucket for a record no rule below could attribute to a department. */
export const UNATTRIBUTED_DEPARTMENT = "(unattributed)";

/**
 * THE DEPARTMENT RESOLUTION ORDER. One ranked list, decided per record, in this
 * order and no other. A record is never dropped: rule 3 always matches.
 *
 *   1. `export_column`  the export's own department/group/cost-centre column.
 *      The vendor's grouping is the reader's grouping; a roster that disagrees
 *      with the file the reader is looking at would move a grade for reasons
 *      nothing on screen explains.
 *   2. `roster`         the shipped roster mapping, joined on `actor_id` — the
 *      lower-cased email the parse contract already normalized. Consulted only
 *      when the export named no department for the row, which includes every row
 *      of an export with no department column at all.
 *   3. `unattributed`   an explicit bucket, counted and returned. A record whose
 *      department cannot be named is a fact about the import, and silently
 *      dropping it would quietly shrink every denominator on the page.
 */
export const DEPARTMENT_SOURCES = Object.freeze({
  exportColumn: "export_column",
  roster: "roster",
  unattributed: "unattributed",
});

/**
 * Why a department is not graded. Noor's codes, reused verbatim so a consumer
 * that already branches on them keeps working, plus the one case her join cannot
 * produce: a bucket that exists precisely because attribution failed.
 */
export const CONVERSATION_NOT_GRADEABLE_REASONS = Object.freeze({
  ...NOT_GRADEABLE_REASONS,
  unattributedRecords: "unattributed_records",
});

/**
 * Human copy per code. Retargeted from `NOT_GRADEABLE_COPY`, which words the
 * same codes for the sample-to-billing join: there is no billing export here, so
 * a sentence about joining to one would be wrong. The codes mean what they
 * always meant — no sample, nothing classified, too small a sample — and the
 * code is still the thing consumers branch on.
 */
export const CONVERSATION_NOT_GRADEABLE_COPY = Object.freeze({
  [CONVERSATION_NOT_GRADEABLE_REASONS.noSampledQueries]:
    "No imported conversation names this department.",
  [CONVERSATION_NOT_GRADEABLE_REASONS.noClassifiedQueries]:
    "Every prompt for this department fell below the classification confidence floor.",
  [CONVERSATION_NOT_GRADEABLE_REASONS.insufficientJoinedSample]:
    `Fewer than ${MIN_JOINED_RECORDS_FOR_GRADE} classified prompts for this department.`,
  [CONVERSATION_NOT_GRADEABLE_REASONS.unattributedRecords]:
    "These prompts name no department the export or the roster could resolve, so they are counted and left ungraded.",
});

/**
 * THE RUBRIC SIGNALS. One row per weak rubric category, naming the axis it
 * drags down and the phrase a finding is built from. `highValue` has no row: it
 * is the reference class, and there is no weakness in it to recover.
 *
 * `recoverability` is the share of a category's shortfall a leader can
 * realistically act on. It is the one number this module authors, and each value
 * is argued from the rubric's own axis assumption rather than invented:
 *
 *   1.0  over-provisioned — the rubric states outright that routing is a
 *        platform fix a gateway rule corrects "without the requester changing
 *        anything". All of it is addressable, this quarter, by a config change.
 *   0.6  inefficient — a re-prompt spiral is fixed by coaching, which the rubric
 *        calls the product's lever. Real, slower, and not everyone takes it.
 *   0.2  out-of-scope — personal traffic is a policy and culture problem. An
 *        AI-literacy programme is the wrong instrument, so most of this
 *        shortfall is not recoverable by the intervention this grade proposes.
 *
 * These are a judgement about what an AI-literacy programme can move, not a
 * measurement. Disagree with a number here and the ranking changes; that is why
 * they are one exported table rather than three constants in a branch.
 */
export const RUBRIC_SIGNALS = Object.freeze([
  Object.freeze({
    key: "model_fit", label: "model fit", axis: "modelFit", category: "overProvisioned",
    recoverability: 1.0,
    evidence: "route a lookup to the top-tier model",
  }),
  Object.freeze({
    key: "iteration_cost", label: "iteration cost", axis: "efficiency", category: "inefficient",
    recoverability: 0.6,
    evidence: "re-ask a question the previous turn did not answer",
  }),
  Object.freeze({
    key: "intent_clarity", label: "intent clarity", axis: "intent", category: "outOfScope",
    recoverability: 0.2,
    evidence: "carry no stated work intent at all",
  }),
]);

/**
 * THE LENGTH BANDS. A prompt's character count, already on the parsed record as
 * `prompt_chars`, reported as one of five named bands and never as a figure a
 * reader could work backwards from.
 *
 * The cuts are about what a prompt of that size can structurally hold, read off
 * the rubric's own intent axis rather than picked for roundness: under ~120
 * characters is one line, which has room for an instruction and nothing else;
 * ~480 is a paragraph, enough for an instruction plus its context; ~1600 is a
 * briefed prompt carrying context, constraints and acceptance criteria at once.
 * `empty` is its own band because a row with no prompt body is a fact about the
 * export, not a very short prompt.
 *
 * Bands, not counts, because a character count is a fingerprint: an exact
 * length plus a timestamp narrows a prompt to one conversation, and this
 * surface promises the opposite.
 */
export const PROMPT_LENGTH_BANDS = Object.freeze([
  Object.freeze({ key: "empty", label: "no prompt body", ceiling: 0 }),
  Object.freeze({ key: "one_line", label: "under 120 characters", ceiling: 120 }),
  Object.freeze({ key: "paragraph", label: "120 to 480 characters", ceiling: 480 }),
  Object.freeze({ key: "briefed", label: "480 to 1,600 characters", ceiling: 1600 }),
  Object.freeze({ key: "long_form", label: "1,600 characters and over", ceiling: null }),
]);

/** The band one record's character count falls in. Never returns undefined. */
export function lengthBandFor(chars) {
  const count = Number.isFinite(chars) && chars > 0 ? chars : 0;
  return PROMPT_LENGTH_BANDS.find((band) => band.ceiling === null || count <= band.ceiling)
    ?? PROMPT_LENGTH_BANDS[PROMPT_LENGTH_BANDS.length - 1];
}

/**
 * How many distinct structural signatures a department reports.
 *
 * A signature is a shape, not a prompt, so a department with forty thousand
 * prompts still has at most a few dozen of them — but a panel that listed every
 * one would bury the finding, and one that silently cut the list would claim
 * completeness it does not have. Eight rows, and the count that was left out
 * travels with them so the truncation is stated rather than hidden.
 */
export const MAX_SKETCH_SIGNATURES = 8;

const AXIS_KEYS = new Set(PROMPT_LITERACY_RUBRIC.axes.map((axis) => axis.key));
const CATEGORY_KEYS = new Set(PROMPT_LITERACY_RUBRIC.categories.map((category) => category.key));
for (const signal of RUBRIC_SIGNALS) {
  if (!CATEGORY_KEYS.has(signal.category)) {
    throw new RangeError(`conversation literacy: signal ${signal.key} names no rubric category`);
  }
  if (!AXIS_KEYS.has(signal.axis)) {
    throw new RangeError(`conversation literacy: signal ${signal.key} names no rubric axis`);
  }
}

/**
 * THE RECOVERABLE-IMPACT FORMULA. Defined here once; nothing recomputes it.
 *
 *   signalImpact(department, signal)
 *     = prompts_in_category                 volume — how many prompts this is
 *     x (100 - categoryScoreWeight) / 100   severity — the rubric's own gap
 *                                           between this category and the
 *                                           reference class, on the 0-100 scale
 *     x recoverability                      how much of that gap is addressable
 *
 *   departmentImpact = sum of signalImpact over every signal above
 *
 * The unit is *recoverable prompt-points*: one prompt moved from this category
 * all the way to the reference class is worth `(100 - weight)/100` points, and
 * `recoverability` discounts it to the share a programme can actually move.
 *
 * WHY NOT RANK BY SCORE. A score is a share, so it is scale-free: three
 * out-of-scope prompts in a four-person team score an F and a thousand
 * over-provisioned lookups in engineering score a C. Ranking by score puts the
 * four-person team first, and every hour spent there recovers almost nothing.
 * Multiplying by volume is what makes the ranking answer "where should the next
 * workshop go" instead of "who looks worst".
 *
 * WHY SEVERITY IS THE RUBRIC'S GAP AND NOT A FRESH SCALE. `categoryScoreWeight`
 * is already the published distance from the reference class, derived from the
 * axis credits a director can read in one JSON file. A second severity scale
 * here would be a second rubric, and the two would disagree the first time
 * either moved.
 *
 * Ties are broken by classified volume, then by department name, so the same
 * input always produces the same order.
 */
export function signalImpact(promptCount, signal) {
  const count = Number.isFinite(promptCount) && promptCount > 0 ? promptCount : 0;
  const gap = (100 - categoryScoreWeight(signal.category)) / 100;
  return count * gap * signal.recoverability;
}

/** Impact is reported to two places; the ranking uses the unrounded value. */
function roundImpact(value) {
  return Math.round(value * 100) / 100;
}

function roundShare(value) {
  const factor = 10 ** PROMPT_LITERACY_RUBRIC.reporting.shareDecimals;
  return Math.round(value * factor) / factor;
}

/**
 * The roster lookup, built once per import.
 *
 * Accepts roster records in the shipped roster vocabulary (`email`,
 * `department`, and the rest of `NORMALIZED_FIELDS.roster`). Joined on email
 * because `actor_id` is an email the parse already lower-cased; a roster keyed
 * only by `person_id` contributes nothing and is not an error, it is a roster
 * that cannot answer this question.
 *
 * Employment status is deliberately not consulted. A departed employee's prompts
 * were still their department's prompts, and dropping them would move a
 * historical grade every time HR closed a record.
 */
export function rosterDepartments(roster = []) {
  const byEmail = new Map();
  for (const entry of Array.isArray(roster) ? roster : []) {
    const email = typeof entry?.email === "string" ? entry.email.trim().toLowerCase() : "";
    const department = typeof entry?.department === "string" ? entry.department.trim() : "";
    if (!email || !department) continue;
    // First row wins, so a duplicated person does not depend on file order.
    if (!byEmail.has(email)) byEmail.set(email, department);
  }
  return byEmail;
}

/**
 * Resolve one record's department by the precedence above.
 *
 * @returns {{department: string, source: string}}
 */
export function resolveDepartment(record, byEmail) {
  const named = typeof record?.department === "string" ? record.department.trim() : "";
  if (named && named !== UNGROUPED_DEPARTMENT) {
    return { department: named, source: DEPARTMENT_SOURCES.exportColumn };
  }
  const fromRoster = byEmail?.get(record?.actor_id);
  if (fromRoster) return { department: fromRoster, source: DEPARTMENT_SOURCES.roster };
  return { department: UNATTRIBUTED_DEPARTMENT, source: DEPARTMENT_SOURCES.unattributed };
}

/** One department's signals, strongest first. Counts, never reconstructed. */
function signalsFor(counts, classified) {
  return RUBRIC_SIGNALS
    .map((signal) => {
      const numerator = counts.get(signal.category) ?? 0;
      const impact = signalImpact(numerator, signal);
      return Object.freeze({
        key: signal.key,
        label: signal.label,
        axis: signal.axis,
        category: signal.category,
        // Numerator, denominator and name all travel together. A render layer
        // that recomputed the percentage from a rounded share would print a
        // number nobody measured.
        numerator,
        denominator: classified,
        share: classified > 0 ? roundShare(numerator / classified) : 0,
        recoverability: signal.recoverability,
        severityPoints: 100 - categoryScoreWeight(signal.category),
        impact: roundImpact(impact),
        text: `Support: ${signal.label}, ${percentText(numerator, classified)} of prompts `
          + `${signal.evidence} (${numerator} of ${classified})`,
      });
    })
    .sort((left, right) => right.impact - left.impact || left.key.localeCompare(right.key));
}

/** Which weakness signal a rubric category answers to, or none. */
const SIGNAL_BY_CATEGORY = new Map(RUBRIC_SIGNALS.map((signal) => [signal.category, signal]));

/**
 * THE STRUCTURAL SKETCHES. What an individual prompt is allowed to become on a
 * reading surface: a length band, the rubric category it was classified into,
 * the model tier the export named, and the signal that fired. Four values, every
 * one of them either a count-derived band or a key from a table in this
 * repository. There is no fifth field, and none of the four can be read back
 * toward a sentence somebody typed.
 *
 * Identical shapes are one row with a count rather than N rows, which is both
 * the only form that survives a forty-thousand-prompt department and one more
 * step away from a single identifiable prompt.
 *
 * Only signal-bearing categories are sketched: these are the prompts the grade
 * is an accusation about, and a high-value prompt is evidence for nothing a
 * reader is being asked to act on. The whole classified mix is in
 * `distribution` below, so nothing is hidden by that choice.
 */
function sketchesFor(bucket) {
  const rows = [...bucket.sketches.values()]
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  const represented = rows.reduce((sum, row) => sum + row.count, 0);
  const shown = rows.slice(0, MAX_SKETCH_SIGNATURES);
  return Object.freeze({
    represented,
    signatureCount: rows.length,
    shownCount: shown.length,
    shownPrompts: shown.reduce((sum, row) => sum + row.count, 0),
    signatures: Object.freeze(shown.map((row) => Object.freeze({
      key: row.key,
      count: row.count,
      share: bucket.classified > 0 ? roundShare(row.count / bucket.classified) : 0,
      lengthBand: row.band.key,
      lengthBandLabel: row.band.label,
      intentClass: row.category,
      intentClassLabel: categoryLabel(row.category),
      // Null is "the export named no model on this row", which is not the same
      // fact as `unrecognized` — a model was named and no tier rule matched it.
      modelTier: row.modelTier,
      signal: row.signal.key,
      signalLabel: row.signal.label,
    }))),
  });
}

/**
 * The score distribution: every rubric category, its count, and the score the
 * rubric already publishes for it. Read from `categoryScoreWeight`, so the bars
 * a reader compares are the same numbers the composite was built from and not a
 * second scale drawn beside it.
 */
function distributionFor(bucket) {
  return Object.freeze(PROMPT_LITERACY_RUBRIC.categories.map((category) => {
    const count = bucket.categories.get(category.key) ?? 0;
    return Object.freeze({
      key: category.key,
      label: category.label,
      count,
      share: bucket.classified > 0 ? roundShare(count / bucket.classified) : 0,
      scorePoints: categoryScoreWeight(category.key),
    });
  }));
}

const CATEGORY_LABELS = new Map(
  PROMPT_LITERACY_RUBRIC.categories.map((category) => [category.key, category.label]),
);

function categoryLabel(key) {
  return CATEGORY_LABELS.get(key) ?? key;
}

/** A whole-number percentage, from the counts, computed in exactly one place. */
function percentText(numerator, denominator) {
  return `${denominator > 0 ? Math.round((numerator / denominator) * 100) : 0}%`;
}

/**
 * An ungraded department still has evidence, and withholding it is what makes a
 * below-floor department look like a failure rather than a gap: the reader
 * cannot see how far off the floor it is, or what the prompts it does have look
 * like. The letter is withheld; the counts are not.
 */
function ungraded(department, source, prompts, reason, evidence) {
  return Object.freeze({
    department,
    attribution: source,
    gradeable: false,
    // Not a low score and not a zero: a null the caller has to decide about.
    score: null,
    grade: null,
    subscores: null,
    reasonCode: reason,
    reasonText: CONVERSATION_NOT_GRADEABLE_COPY[reason],
    prompts,
    coverage: prompts.total > 0 ? roundShare(prompts.classified / prompts.total) : 0,
    confidence: prompts.classified > 0 ? prompts.meanConfidence : null,
    signals: Object.freeze([]),
    driver: null,
    impact: 0,
    distribution: evidence.distribution,
    sketches: evidence.sketches,
    rubricVersion: null,
  });
}

/**
 * Aggregate one parsed conversation export into per-department results.
 *
 * @param {{parsed?: object, roster?: ReadonlyArray<object>,
 *   minimumPrompts?: number}} input
 *   `parsed` is a `parseConversationExport` result produced *with* a classifier;
 *   without one there is nothing to grade and every department is returned
 *   ungraded with `no_classified_queries`.
 * @returns the frozen result set: one row per department, the ranking, and the
 *   company verdict.
 */
export function aggregateConversationLiteracy({
  parsed = null, roster = [], minimumPrompts = MIN_JOINED_RECORDS_FOR_GRADE,
} = {}) {
  const records = Array.isArray(parsed?.records) ? parsed.records : [];
  const classifications = Array.isArray(parsed?.classifications) ? parsed.classifications : [];
  const byEmail = rosterDepartments(roster);

  const buckets = new Map();
  const attribution = { export_column: 0, roster: 0, unattributed: 0 };
  records.forEach((record, index) => {
    const { department, source } = resolveDepartment(record, byEmail);
    attribution[source] += 1;
    const bucket = buckets.get(department) ?? {
      department,
      sources: new Set(),
      total: 0,
      classified: 0,
      confidenceSum: 0,
      categories: new Map(),
      scorable: [],
      // Signature -> count. Built here because this loop is the only place a
      // record and its classification are side by side; nothing downstream is
      // handed a record at all.
      sketches: new Map(),
    };
    bucket.sources.add(source);
    bucket.total += 1;
    const classification = classifications[index] ?? null;
    if (classification?.classified === true && CATEGORY_KEYS.has(classification.category)) {
      bucket.classified += 1;
      bucket.confidenceSum += Number(classification.confidence) || 0;
      bucket.categories.set(classification.category, (bucket.categories.get(classification.category) ?? 0) + 1);
      // Handed to the rubric with a category and nothing else: a conversation
      // export carries no token counts, and apportioning some would be synthesis.
      bucket.scorable.push({ category: classification.category });
      const signal = SIGNAL_BY_CATEGORY.get(classification.category);
      if (signal) {
        const band = lengthBandFor(record.prompt_empty ? 0 : record.prompt_chars);
        const modelTier = typeof classification.modelTier === "string" ? classification.modelTier : null;
        const key = `${band.key}|${classification.category}|${modelTier ?? "unnamed"}`;
        const entry = bucket.sketches.get(key)
          ?? { key, band, category: classification.category, modelTier, signal, count: 0 };
        entry.count += 1;
        bucket.sketches.set(key, entry);
      }
    }
    buckets.set(department, bucket);
  });

  const departments = [...buckets.values()]
    .sort((left, right) => left.department.localeCompare(right.department))
    .map((bucket) => departmentResult(bucket, minimumPrompts));

  const graded = departments.filter((department) => department.gradeable);
  const ranking = Object.freeze([...graded]
    .sort((left, right) => right.impact - left.impact
      || right.prompts.classified - left.prompts.classified
      || left.department.localeCompare(right.department))
    .map((department) => department.department));

  return Object.freeze({
    version: CONVERSATION_LITERACY_VERSION,
    classifierVersion: QUERY_CLASSIFIER_VERSION,
    rubricVersion: PROMPT_LITERACY_RUBRIC.rubricVersion,
    contractVersion: parsed?.contractVersion ?? null,
    dialect: parsed?.profileId ?? null,
    departments: Object.freeze(departments),
    // Department names, strongest recoverable impact first. A separate list
    // rather than an order on `departments`, which stays alphabetical so a
    // rendered table does not reshuffle when one number moves.
    ranking,
    attribution: Object.freeze({
      ...attribution,
      total: records.length,
      // Share of records this pipeline could name a department for. Not a
      // grade input; the fact a reader needs to judge the grades by.
      resolved: records.length > 0
        ? roundShare((records.length - attribution.unattributed) / records.length) : 0,
    }),
    company: companyGrade(departments, records.length),
  });
}

function departmentResult(bucket, minimumPrompts) {
  const meanConfidence = bucket.classified > 0
    ? roundShare(bucket.confidenceSum / bucket.classified) : null;
  const prompts = Object.freeze({
    total: bucket.total,
    classified: bucket.classified,
    unclassified: bucket.total - bucket.classified,
    meanConfidence,
  });
  // Every source that named a record in this bucket, so a reader disputing a
  // department can see whether the file said so or the roster did.
  const attribution = Object.freeze([...bucket.sources].sort());
  const evidence = {
    distribution: distributionFor(bucket),
    sketches: sketchesFor(bucket),
  };

  if (bucket.department === UNATTRIBUTED_DEPARTMENT) {
    return ungraded(bucket.department, attribution, prompts,
      CONVERSATION_NOT_GRADEABLE_REASONS.unattributedRecords, evidence);
  }
  if (bucket.total === 0) {
    return ungraded(bucket.department, attribution, prompts,
      CONVERSATION_NOT_GRADEABLE_REASONS.noSampledQueries, evidence);
  }
  if (bucket.classified === 0) {
    return ungraded(bucket.department, attribution, prompts,
      CONVERSATION_NOT_GRADEABLE_REASONS.noClassifiedQueries, evidence);
  }
  if (bucket.classified < minimumPrompts) {
    return ungraded(bucket.department, attribution, prompts,
      CONVERSATION_NOT_GRADEABLE_REASONS.insufficientJoinedSample, evidence);
  }

  const scored = scorePromptLiteracy(bucket.scorable);
  const signals = signalsFor(bucket.categories, bucket.classified);
  // Exactly one driver: the signal carrying the most recoverable impact. A
  // department whose weakness is entirely in the reference class has none, and
  // says so with a null rather than a signal at zero.
  const driver = signals[0] && signals[0].numerator > 0 ? signals[0] : null;
  return Object.freeze({
    department: bucket.department,
    attribution,
    gradeable: true,
    score: scored.composite,
    grade: scored.grade,
    subscores: scored.subscores,
    reasonCode: null,
    reasonText: null,
    prompts,
    coverage: roundShare(bucket.classified / bucket.total),
    confidence: meanConfidence,
    signals: Object.freeze(signals),
    driver,
    impact: roundImpact(signals.reduce((sum, signal) => sum + signal.impact, 0)),
    // The audit trail behind the letter: the whole classified mix, and the
    // structural shapes of the prompts the weakness is made of.
    distribution: evidence.distribution,
    sketches: evidence.sketches,
    rubricVersion: scored.rubricVersionId,
  });
}

/**
 * The prompts-basis analogue of Noor's `NO_BASELINE_TIER`. Same shape, same
 * meaning — coverage is undefined, so no letter — reworded because there is no
 * spend in this import to have a baseline of. Its reason code differs from hers
 * on purpose: a consumer branching on `no_spend_baseline` would go looking for a
 * billing import that was never part of this flow.
 */
export const NO_PROMPT_BASELINE_TIER = Object.freeze({
  tier: "no_baseline", floor: null, state: "not_gradeable", showGrade: false,
  reason: "no_prompt_baseline",
});

/**
 * Reader-facing copy per tier, stated in prompts.
 *
 * Noor's tiers carry their own `rule` and `label`, and every one of them says
 * "spend". The floors are unit-free and are read from her table; the sentences
 * are not, so they are authored here rather than emitted with the wrong noun in
 * them. Change a sentence freely; changing a floor means changing hers.
 */
export const COMPANY_COVERAGE_COPY = Object.freeze({
  high: "At least 80% of imported prompts sit in departments the rubric graded.",
  moderate: "Half to four-fifths of imported prompts were graded; the letter stands, with the figure beside it.",
  provisional: "A quarter to a half of imported prompts were graded. The letter is shown and marked not actionable alone.",
  insufficient: "Under a quarter of imported prompts were graded. No company letter is shown.",
  no_baseline: "No department reached the minimum sample, so there is no denominator and no company letter.",
});

/**
 * The company letter, or a withheld verdict with its reason.
 *
 * Noor's thresholds decide, unchanged — the floors live in `COVERAGE_TIERS` in
 * `grade-eligibility.js` and are consulted, not copied. What changes is the
 * *basis*: her metric divides covered spend by total spend, and a conversation
 * export carries no cost field at all. Coverage here is graded prompts over
 * imported prompts, and the result says `basis: "prompts"` in the data so no
 * consumer can read one of these numbers as dollars.
 *
 * The letter is a prompt-weighted mean of the graded department scores, not a
 * mean of means: a department with four hundred prompts should move the company
 * letter four hundred times as much as one with a single prompt.
 */
export function companyGrade(departments = [], totalPrompts = 0) {
  const graded = departments.filter((department) => department.gradeable);
  const coveredPrompts = graded.reduce((sum, department) => sum + department.prompts.classified, 0);
  const total = Number.isFinite(totalPrompts) && totalPrompts > 0 ? totalPrompts : 0;
  const tier = total === 0 || coveredPrompts === 0
    ? NO_PROMPT_BASELINE_TIER
    : COVERAGE_TIERS.find((entry) => (coveredPrompts / total) >= entry.floor)
      ?? COVERAGE_TIERS[COVERAGE_TIERS.length - 1];
  const coverage = total > 0 ? roundShare(Math.min(1, coveredPrompts / total)) : null;
  const rule = COMPANY_COVERAGE_COPY[tier.tier];

  if (!tier.showGrade || !graded.length) {
    return Object.freeze({
      state: "withheld",
      showGrade: false,
      provisional: false,
      score: null,
      grade: null,
      basis: "prompts",
      coverage,
      coveredPrompts,
      totalPrompts: total,
      tier: tier.tier,
      reason: tier.reason,
      rule,
    });
  }

  const weighted = graded.reduce(
    (sum, department) => sum + department.score * department.prompts.classified, 0,
  );
  const score = Math.round(weighted / coveredPrompts);
  return Object.freeze({
    state: tier.state,
    showGrade: true,
    provisional: tier.state === "provisional",
    score,
    grade: letterGradeForScore(score),
    basis: "prompts",
    coverage,
    coveredPrompts,
    totalPrompts: total,
    tier: tier.tier,
    reason: tier.reason,
    rule,
  });
}

/**
 * The JSON export payload, built from an allowlist per row.
 *
 * Nothing serializes an aggregate directly — an internal field added later
 * cannot ride out — and every leaf below is a number, a boolean, a null, a
 * department name, or a phrase authored in this repository. There is no field a
 * prompt, a conversation title, or any other free-form user content could reach.
 */
export function conversationLiteracyPayload(result) {
  return {
    contract: "wawalu.integration.conversation-literacy",
    contract_version: CONVERSATION_LITERACY_VERSION,
    classifier_version: result.classifierVersion,
    rubric_version: result.rubricVersion,
    dialect: result.dialect,
    attribution: { ...result.attribution },
    company: { ...result.company },
    ranking: [...result.ranking],
    departments: result.departments.map((department) => ({
      department: department.department,
      attribution: [...department.attribution],
      gradeable: department.gradeable,
      score: department.score,
      grade: department.grade,
      subscores: department.subscores ? { ...department.subscores } : null,
      reason_code: department.reasonCode,
      reason_text: department.reasonText,
      prompts: { ...department.prompts },
      coverage: department.coverage,
      confidence: department.confidence,
      impact: department.impact,
      driver: department.driver ? signalPayload(department.driver) : null,
      signals: department.signals.map(signalPayload),
      distribution: department.distribution.map((row) => ({
        key: row.key, label: row.label, count: row.count,
        share: row.share, score_points: row.scorePoints,
      })),
      // Four keys and a count per row, all of them from a table above. Written
      // out field by field for the same reason every other row here is: an
      // internal field added to a signature later cannot ride out with it.
      sketches: {
        represented: department.sketches.represented,
        signature_count: department.sketches.signatureCount,
        shown_count: department.sketches.shownCount,
        shown_prompts: department.sketches.shownPrompts,
        signatures: department.sketches.signatures.map((row) => ({
          count: row.count,
          share: row.share,
          length_band: row.lengthBand,
          intent_class: row.intentClass,
          model_tier: row.modelTier,
          signal: row.signal,
        })),
      },
    })),
  };
}

function signalPayload(signal) {
  return {
    key: signal.key,
    label: signal.label,
    axis: signal.axis,
    category: signal.category,
    numerator: signal.numerator,
    denominator: signal.denominator,
    share: signal.share,
    severity_points: signal.severityPoints,
    recoverability: signal.recoverability,
    impact: signal.impact,
    text: signal.text,
  };
}

export function conversationLiteracyJson(result) {
  return `${JSON.stringify(conversationLiteracyPayload(result), null, 2)}\n`;
}

/**
 * Text in, result out: the whole pipeline as one synchronous call.
 *
 * This is the function the worker runs and the function the synchronous
 * fallback runs, so there is one pipeline and two callers — the same shape
 * `import-worker-core.js` already has for the usage import.
 *
 * @param {string} text the raw export file.
 * @param {{roster?: ReadonlyArray<object>, minimumPrompts?: number,
 *   maxBytes?: number, maxRows?: number}} [options]
 */
export function analyzeConversationExportText(text, options = {}) {
  const reading = readDelimitedText(text, options);
  if (!reading.ok) {
    const error = new TypeError("The conversation export could not be read.");
    error.code = reading.problem.code;
    error.problems = Object.freeze([Object.freeze({ ...reading.problem })]);
    throw error;
  }
  const parsed = parseConversationExport(
    { columns: [...reading.header], rows: reading.rows.map((row) => [...row.values]) },
    { classify: classifyQuery },
  );
  return Object.freeze({
    parse: Object.freeze({
      status: parsed.status,
      dialect: parsed.profileId,
      rowCount: parsed.rowCount,
      recordCount: parsed.records.length,
      skippedRowCount: parsed.skippedRowCount,
      grouped: parsed.grouped,
    }),
    literacy: aggregateConversationLiteracy({
      parsed, roster: options.roster ?? [], minimumPrompts: options.minimumPrompts,
    }),
  });
}
