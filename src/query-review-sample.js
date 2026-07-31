// The rows a FinOps lead is handed to review, and the classifier's own reading
// of each one.
//
// WHAT THIS IS FOR. The import path grades a corpus out of the classes a reader's
// export declares. Rows that carry a prompt excerpt instead of a declared class
// are the rows the classifier had to decide, and today they are exactly the rows
// that land unclassified and hold the grade back. Those are the rows worth a
// human's attention, so those are the rows this module draws.
//
// WHAT IT DOES NOT DO. It does not grade, it does not re-derive a class, and it
// does not keep a correction. The class and the token behind it come from
// `classifyQuery`, the draw comes from `selectSample`, and the corrections live
// in the override model — this module only pairs a row with the key that model
// files it under, so the row a reviewer corrects and the row the grade recomputes
// from cannot drift apart.
//
// THE KEY. `applyOverrides` identifies a row by `recordKey`, which for the page's
// corpus is `row-<index in the flattened corpus array>`. That array is built per
// import entry as [classified records…, one placeholder per unclassified row], so
// the nth excerpt row of an entry sits at `offset + assigned + n`. The offset is
// carried here rather than guessed, and the same expression appears in exactly
// one place.

import { classifyQuery } from "./query-classification.js";
import { OVERRIDE_LABELS, selectSample } from "./query-label-overrides.js";

/**
 * How many rows one review pass shows. Smaller than the model's own default: a
 * panel is read in one sitting, and forty rows is a spreadsheet. The draw is
 * stratified and seeded, so the twelve are the same twelve on every reload.
 */
export const REVIEW_SAMPLE_SIZE = 12;

const LABEL_OF = new Map(OVERRIDE_LABELS.map((entry) => [entry.key, entry.label]));

/**
 * Every reviewable row in an import, in corpus order, with its override key.
 *
 * @param entries the page's classified samples: `{ parsed, classified }` per
 *   selected file, exactly the shape the corpus is assembled from.
 * @returns a frozen array of frozen rows. `text` is the reader's own prompt
 *   excerpt and is inert data — a caller renders it as text and nothing else.
 */
export function reviewCandidates(entries = []) {
  const rows = [];
  let offset = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const assigned = entry?.classified?.records?.length ?? 0;
    const declined = entry?.classified?.unclassified?.length ?? 0;
    const excerpted = (entry?.parsed?.records ?? []).filter(
      (record) => typeof record?.promptExcerpt === "string" && record.promptExcerpt,
    );
    // Bounded by the count the contract actually declined, so a row this page
    // did not put in the corpus can never be handed a corpus key.
    for (let index = 0; index < Math.min(declined, excerpted.length); index += 1) {
      const record = excerpted[index];
      const read = classifyQuery({ excerpt: record.promptExcerpt, model: record.model });
      rows.push(Object.freeze({
        // `queryId` is what `recordKey` reads, so the draw below and the override
        // map agree on identity without either one restating the rule.
        queryId: `row-${offset + assigned + index}`,
        text: record.promptExcerpt,
        model: typeof record.model === "string" ? record.model : null,
        classified: read.classified,
        // A rubric key when the classifier assigned one, null when it declined —
        // never the string "unclassified" standing in for a class.
        category: read.classified ? read.category : null,
        categoryLabel: read.classified ? LABEL_OF.get(read.category) ?? null : null,
        confidence: read.confidence,
        // The token that fired the rule, published by the classifier rather than
        // cut out of the reader's own text. Null on a refusal, which is why the
        // reason travels beside it.
        signal: read.evidence?.signal ?? null,
        patternId: read.evidence?.patternId ?? null,
        reason: read.evidence?.unclassifiedReason ?? null,
      }));
    }
    offset += assigned + declined;
  }
  return Object.freeze(rows);
}

/**
 * Draw the review sample: the same rows, in the same order, on every reload.
 *
 * The draw is `selectSample`'s, not this module's — one seeded stratified
 * sampler on this page, and a reviewer who labels rows and comes back is handed
 * the set they were labelling.
 *
 * @returns frozen `{ total, rows }` — how many rows were reviewable in the whole
 *   import, and the drawn subset in draw order.
 */
export function reviewSample(entries = [], { size = REVIEW_SAMPLE_SIZE } = {}) {
  const candidates = reviewCandidates(entries);
  const drawn = selectSample(candidates, { size });
  return Object.freeze({
    total: candidates.length,
    // `key` is the sampler's own — `recordKey(record)`, which reads the `queryId`
    // above — so a surface never derives an identity of its own.
    rows: Object.freeze(drawn.rows.map((row) => Object.freeze({ ...row.record, key: row.key }))),
  });
}
