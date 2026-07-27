// The imported query sample: one explicit record type, and an excerpt that
// cannot outlive the parse.
//
// THE TWO TYPES. There are exactly two, and the difference between them is the
// whole privacy design:
//
//   ParsedQuerySampleRow    department, model, timestamp, excerpt.
//                           Constructed inside `ingestQuerySample`, handed to
//                           the classifier, and dropped when the loop iteration
//                           ends. It is never returned, never collected into an
//                           array, and never frozen into a result.
//
//   ClassifiedQuerySample   department, model, modelTier, timestamp, category,
//                           confidence, classified, reason.
//                           No excerpt field exists on it to delete. It is built
//                           field by field by `classifiedSample` — never by
//                           spreading the parse record — so a future field added
//                           upstream cannot ride along into a persisted type.
//
// A `delete record.excerpt` step would have been one refactor away from being
// dropped, and it would have made every downstream type "the parse record minus
// a field we remember to remove". Absence by construction needs no discipline.
//
// REJECTIONS ARE COUNTED, NOT DROPPED. A row that fails validation produces a
// named rejection with its row number. It never becomes a silent zero and it
// never becomes a record with a guessed field. No rejection carries a cell
// value: the row number is enough to find it in the reader's own file, and
// echoing the cell would put the excerpt back in the output through the error
// path.
//
// CHUNKING. Ingest yields to the task queue between fixed-size row chunks, on
// the same seam and with the same progress shape `import-offload.js` already
// uses for file text. A tens-of-thousands-row sample therefore runs as many
// short tasks rather than one long one, and the tab paints between them.

import {
  ABSENT, carryableModelString, classifyModelTier,
} from "./provider-usage-record.js";
import { classifyQuery, QUERY_CLASSIFIER_VERSION } from "./query-classification.js";

/** Bump when the record shape or a rejection code changes meaning. */
export const QUERY_SAMPLE_VERSION = "query-sample/1.0.0";

/** The persisted record's fields, in order. `excerpt` is deliberately absent. */
export const CLASSIFIED_SAMPLE_FIELDS = Object.freeze([
  "department", "model", "modelTier", "timestamp", "category", "confidence",
  "classified", "reason",
]);

/** Every reason a row is refused. Machine-readable and closed. */
export const QUERY_SAMPLE_REJECTIONS = Object.freeze({
  malformedRow: "malformed_row",
  missingDepartment: "missing_department",
  missingModel: "missing_model",
  missingExcerpt: "missing_excerpt",
  excerptTooLong: "excerpt_too_long",
  invalidTimestamp: "invalid_timestamp",
});

/**
 * The longest department identifier a row may carry. Same reasoning as the
 * model bound in Anya's contract: a mis-mapped free-text column must not be able
 * to smuggle a paragraph in under the name of a department.
 */
export const MAX_DEPARTMENT_LENGTH = 200;

/**
 * The longest excerpt that will be classified. An excerpt is a sample of one
 * prompt, not a transcript; anything longer is a mis-mapped column, and refusing
 * it is cheaper than lower-casing a megabyte per row. Nothing is truncated — a
 * truncated prompt would be classified on evidence the reader cannot see.
 */
export const MAX_EXCERPT_LENGTH = 4_000;

/**
 * Rows per chunk. Chosen so a 50,000-row sample is ~100 task boundaries: enough
 * that no single task runs long, few enough that yielding is not the cost.
 */
export const QUERY_SAMPLE_CHUNK_ROWS = 500;

function cleanString(value, limit) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit) return null;
  return trimmed;
}

/**
 * One raw row as a `ParsedQuerySampleRow`, or a named rejection.
 *
 * Exported so the validation table is testable on its own. The returned record
 * carries the excerpt — it is the one type that does — and the only supported
 * thing to do with it is hand it straight to `classifiedSample`.
 *
 * @param {unknown} raw
 * @param {number} row 1-based row number in the reader's own file.
 * @returns {{ok: true, record: object} | {ok: false, rejection: {code: string, row: number}}}
 */
export function parseQuerySampleRow(raw, row = 0) {
  const reject = (code) => ({ ok: false, rejection: Object.freeze({ code, row }) });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return reject(QUERY_SAMPLE_REJECTIONS.malformedRow);
  }
  const department = cleanString(raw.department, MAX_DEPARTMENT_LENGTH);
  if (!department) return reject(QUERY_SAMPLE_REJECTIONS.missingDepartment);
  // The model string is carried by Anya's rule, not by a second one here, so a
  // value this sample accepts is exactly a value the billing contract accepts —
  // which is what makes the (department, model) join sound.
  const model = carryableModelString(raw.model);
  if (model === ABSENT) return reject(QUERY_SAMPLE_REJECTIONS.missingModel);
  const timestamp = typeof raw.timestamp === "string" ? raw.timestamp.trim() : "";
  const parsedAt = Date.parse(timestamp);
  if (!timestamp || !Number.isFinite(parsedAt)) {
    return reject(QUERY_SAMPLE_REJECTIONS.invalidTimestamp);
  }
  if (typeof raw.excerpt !== "string" || !raw.excerpt.trim()) {
    return reject(QUERY_SAMPLE_REJECTIONS.missingExcerpt);
  }
  if (raw.excerpt.length > MAX_EXCERPT_LENGTH) {
    return reject(QUERY_SAMPLE_REJECTIONS.excerptTooLong);
  }
  return {
    ok: true,
    record: {
      department,
      model,
      timestamp: new Date(parsedAt).toISOString(),
      excerpt: raw.excerpt,
    },
  };
}

/**
 * Classify one parse record into the persisted type.
 *
 * Every field is named explicitly. There is no spread of `parsed`, so the
 * excerpt has no path into the returned object even if the parse record grows a
 * field later.
 */
export function classifiedSample(parsed) {
  const verdict = classifyQuery({ excerpt: parsed.excerpt, model: parsed.model });
  return Object.freeze({
    department: parsed.department,
    model: parsed.model,
    modelTier: classifyModelTier(parsed.model),
    timestamp: parsed.timestamp,
    category: verdict.category,
    confidence: verdict.confidence,
    classified: verdict.classified,
    reason: verdict.reason,
  });
}

function tallyRejections(counts) {
  const byCode = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([code, count]) => Object.freeze({ code, count }));
  return Object.freeze({
    total: byCode.reduce((sum, entry) => sum + entry.count, 0),
    byCode: Object.freeze(byCode),
    // Row numbers for the first few, so a reader can open their file at the
    // offending line. Bounded: a wholly mis-mapped file must not produce a
    // 50,000-entry array the page then has to render.
    samples: Object.freeze([]),
  });
}

/**
 * Ingest a whole query sample: validate, classify, count.
 *
 * @param {Iterable<unknown>} rows raw rows, already parsed out of the file.
 * @param {{onProgress?: (progress: object) => void, yieldToTask?: () => Promise<void>,
 *   chunkRows?: number}} [options]
 * @returns {Promise<object>} frozen result: classified records (no excerpts),
 *   counted rejections, and the chunking evidence.
 */
export async function ingestQuerySample(rows, {
  onProgress,
  yieldToTask = () => new Promise((resolve) => { setTimeout(resolve, 0); }),
  chunkRows = QUERY_SAMPLE_CHUNK_ROWS,
} = {}) {
  const list = Array.isArray(rows) ? rows : [...(rows ?? [])];
  const size = Math.max(1, Math.floor(chunkRows) || QUERY_SAMPLE_CHUNK_ROWS);
  const records = [];
  const rejectionCounts = new Map();
  const rejectedRows = [];
  let classified = 0;
  let chunks = 0;

  onProgress?.({ phase: "classify", ratio: list.length ? 0 : 1, loaded: 0, total: list.length, unit: "rows" });
  for (let offset = 0; offset < list.length; offset += size) {
    const end = Math.min(offset + size, list.length);
    for (let index = offset; index < end; index += 1) {
      const parsed = parseQuerySampleRow(list[index], index + 1);
      if (!parsed.ok) {
        rejectionCounts.set(parsed.rejection.code, (rejectionCounts.get(parsed.rejection.code) ?? 0) + 1);
        if (rejectedRows.length < 20) rejectedRows.push(parsed.rejection);
        continue;
      }
      // `parsed.record` — the only object that ever holds an excerpt — goes out
      // of scope here. Nothing pushed below carries one.
      const record = classifiedSample(parsed.record);
      if (record.classified) classified += 1;
      records.push(record);
    }
    chunks += 1;
    onProgress?.({ phase: "classify", ratio: end / list.length, loaded: end, total: list.length, unit: "rows" });
    // One task boundary per chunk, exactly as the file importer does between
    // text chunks. The tab paints, scrolls, and answers clicks in between.
    if (end < list.length) await yieldToTask();
  }
  onProgress?.({ phase: "done", ratio: 1, loaded: list.length, total: list.length, unit: "rows" });

  const rejections = tallyRejections(rejectionCounts);
  return Object.freeze({
    version: QUERY_SAMPLE_VERSION,
    classifierVersion: QUERY_CLASSIFIER_VERSION,
    records: Object.freeze(records),
    counts: Object.freeze({
      // `total` is every row handed in, including the ones refused. It is the
      // denominator nothing else in this pipeline is allowed to quietly shrink.
      total: list.length,
      accepted: records.length,
      classified,
      unclassified: records.length - classified,
      rejected: rejections.total,
    }),
    rejections: Object.freeze({ ...rejections, samples: Object.freeze(rejectedRows) }),
    chunks,
  });
}
