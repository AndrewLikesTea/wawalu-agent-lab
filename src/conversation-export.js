// The conversation-export reader: a vendor's assistant transcript or audit
// export in, counts out, prompt text nowhere.
//
// It is the consumer half of the conversation dialects declared in
// `dialect-profiles.js`, and it is a separate module from `dialect-detection.js`
// on purpose. The generic normalizer maps a cell to a field; this contract has
// one column whose cell may never *become* a field, and rules for imperfect data
// (an empty prompt is a valid row, an unparseable timestamp is a counted skip)
// that the billing dialects settled differently. Rather than widen the generic
// path and change what a usage import does, the conversation rules live here.
//
// Detection is not reimplemented: `detectDialect` scores the conversation
// registry with exactly the header-sniffing code the usage and roster dialects
// use, and a file it does not recognize comes back `unrecognized` carrying its
// columns and rows, which is the existing manual-mapping path unchanged.
//
// THE NEVER-RENDER RULE, as implemented rather than promised:
//
//   1. The profile marks the prompt column `sensitivity: "never-render"` and
//      maps it through `promptSignals`, a coercion that returns counts. The
//      registry self-check refuses either half without the other.
//   2. A record is *built* from `CONVERSATION_RECORD_KEYS`, never copied from a
//      row and pruned. There is no key a prompt body could survive in.
//   3. Every value this module emits for a never-render column is a number or a
//      boolean. `assertNeverRenderClean` says so as an executable assertion, and
//      the export and summary helpers below are the only doors out.
//   4. Issues name a row by index, by 1-based row number, and by the row's own
//      conversation identifier. No issue, message, or summary line is ever
//      built from a cell value.

import { detectDialect } from "./dialect-detection.js";
import {
  COERCIONS, CONVERSATION_DIALECT_PROFILES, NEVER_RENDER, UNGROUPED_DEPARTMENT,
  columnNames, neverRenderColumns, normalizeColumnName,
} from "./dialect-profiles.js";

/** Bumped when the shape below changes, independently of a profile version. */
export const CONVERSATION_CONTRACT_VERSION = "1.0";

export { UNGROUPED_DEPARTMENT };

/**
 * The closed key set of a parsed record. `prompt_signals` from the profile is
 * expanded into the three derived keys here; the raw cell has no landing place.
 */
export const CONVERSATION_RECORD_KEYS = Object.freeze([
  "conversation_id", "actor_id", "department", "occurred_at",
  "prompt_chars", "prompt_token_estimate", "prompt_empty",
]);

/** Row-level skip codes. Downstream switches on the code, never the message. */
export const CONVERSATION_ROW_CODES = Object.freeze({
  missingValue: "missing_required_value",
  invalidTimestamp: "invalid_timestamp",
  invalidValue: "invalid_value",
});

/** Normalized header -> first column index carrying it. Leftmost copy wins. */
function indexColumns(columns) {
  const index = new Map();
  columns.forEach((name, position) => {
    const key = normalizeColumnName(name);
    if (key && !index.has(key)) index.set(key, position);
  });
  return index;
}

function locate(entry, index) {
  for (const name of columnNames(entry)) if (index.has(name)) return index.get(name);
  return null;
}

const issue = (rowIndex, conversationId, field, code, reason) => Object.freeze({
  row: rowIndex,
  rowNumber: rowIndex + 1,
  conversation_id: conversationId,
  field,
  code,
  // Field, code, coordinate, reason. Never a cell value — including, especially,
  // when the field that failed sits on the same row as a prompt body.
  message: `row ${rowIndex + 1}: ${field} ${reason}`,
});

/**
 * Read one parsed table as a conversation export.
 *
 * `table` is the `{ columns, rows }` shape the dialect layer consumes. The
 * result carries records, counted skips, derived ordering, and the department
 * grouping — and, when nothing matched, the untouched table for manual mapping.
 */
export function parseConversationExport(table, { profiles = CONVERSATION_DIALECT_PROFILES } = {}) {
  const detection = detectDialect(table, profiles);
  if (detection.status !== "matched") {
    return Object.freeze({
      status: "unrecognized",
      contractVersion: CONVERSATION_CONTRACT_VERSION,
      profileId: null, profileLabel: null, profileVersion: null, confidence: detection.confidence,
      reason: detection.reason,
      records: Object.freeze([]), skipped: Object.freeze([]), skippedRowCount: 0,
      rowCount: detection.rows.length,
      grouped: false, departments: Object.freeze([]),
      span: null, outOfOrderRowCount: 0,
      // The handoff to the existing manual-mapping flow: an unrecognized file is
      // not a conversation export as far as this contract knows, so its cells
      // are ordinary unclassified cells and travel on unchanged.
      detection,
    });
  }

  const profile = detection.profile;
  const index = indexColumns(detection.columns);
  const mapped = profile.columns
    .filter((entry) => entry.field !== null)
    .map((entry) => Object.freeze({ entry, columnIndex: locate(entry, index) }));
  const departmentEntry = mapped.find((step) => step.entry.field === "department");
  const grouped = departmentEntry?.columnIndex !== null && departmentEntry?.columnIndex !== undefined;

  const records = [];
  const skipped = [];

  detection.rows.forEach((row, rowIndex) => {
    const values = {};
    let identifier = null;
    let failed = false;
    for (const { entry, columnIndex } of mapped) {
      const raw = columnIndex === null ? undefined : row[columnIndex];
      const blank = raw === undefined || String(raw).trim() === "";
      if (blank && entry.sensitivity !== NEVER_RENDER) {
        // An absent column and an empty cell degrade the same way, because a
        // reader cannot tell them apart from the result and should not have to.
        if (entry.whenAbsent?.mode === "default") {
          values[entry.field] = entry.whenAbsent.value;
          continue;
        }
        skipped.push(issue(rowIndex, identifier, entry.field, CONVERSATION_ROW_CODES.missingValue, "is empty"));
        failed = true;
        continue;
      }
      try {
        values[entry.field] = COERCIONS[entry.coerce](raw ?? "");
        if (entry.field === "conversation_id") identifier = values[entry.field];
      } catch (error) {
        const code = entry.field === "occurred_at"
          ? CONVERSATION_ROW_CODES.invalidTimestamp
          : CONVERSATION_ROW_CODES.invalidValue;
        skipped.push(issue(rowIndex, identifier, entry.field, code, error.message));
        failed = true;
      }
    }
    if (!failed) records.push(buildRecord(values));
  });

  const ordered = [...records].sort((left, right) => (left.occurred_at < right.occurred_at ? -1 : 1));
  let outOfOrderRowCount = 0;
  for (let position = 1; position < records.length; position += 1) {
    if (records[position].occurred_at < records[position - 1].occurred_at) outOfOrderRowCount += 1;
  }

  return Object.freeze({
    status: "matched",
    contractVersion: CONVERSATION_CONTRACT_VERSION,
    profileId: profile.id,
    profileLabel: profile.label,
    profileVersion: profile.version,
    confidence: detection.confidence,
    reason: detection.reason,
    records: Object.freeze(records),
    skipped: Object.freeze(skipped),
    skippedRowCount: skipped.length ? new Set(skipped.map((entry) => entry.row)).size : 0,
    rowCount: detection.rows.length,
    // Stated, not inferred by a consumer: an export with no department column
    // still imports, and every row is in one bucket named `UNGROUPED_DEPARTMENT`.
    grouped,
    departments: summarizeDepartments(records),
    // Ordering is *derived* here, from the timestamps, so a file in any row order
    // yields the same span. `outOfOrderRowCount` reports the shuffle; it never
    // rejects it.
    span: ordered.length
      ? Object.freeze({ first: ordered[0].occurred_at, last: ordered.at(-1).occurred_at })
      : null,
    outOfOrderRowCount,
  });
}

/**
 * Build one record from the allowlist. `prompt_signals` arrives as the derived
 * object the never-render coercion produced and is expanded into counts; a
 * missing prompt cell is a valid row whose signals are zero.
 */
function buildRecord(values) {
  const signals = values.prompt_signals ?? { chars: 0, token_estimate: 0, empty: true };
  const record = {
    conversation_id: values.conversation_id,
    actor_id: values.actor_id,
    department: values.department ?? UNGROUPED_DEPARTMENT,
    occurred_at: values.occurred_at,
    prompt_chars: signals.chars,
    prompt_token_estimate: signals.token_estimate,
    prompt_empty: signals.empty,
  };
  return Object.freeze(record);
}

/** Per-department totals, alphabetical so a rendered table is stable. */
function summarizeDepartments(records) {
  const totals = new Map();
  for (const record of records) {
    const bucket = totals.get(record.department)
      ?? { department: record.department, conversations: 0, prompt_chars: 0, prompt_token_estimate: 0 };
    bucket.conversations += 1;
    bucket.prompt_chars += record.prompt_chars;
    bucket.prompt_token_estimate += record.prompt_token_estimate;
    totals.set(record.department, bucket);
  }
  return Object.freeze([...totals.values()]
    .sort((left, right) => left.department.localeCompare(right.department))
    .map((bucket) => Object.freeze(bucket)));
}

/**
 * The executable form of the never-render rule: every value this contract emits
 * for a never-render column is a count or a flag. Called by the tests against a
 * parsed result, and cheap enough for a consumer to call before rendering.
 * Throws rather than returning false, because a leak is not a status.
 */
export function assertNeverRenderClean(result, profile) {
  const sensitive = neverRenderColumns(profile ?? {});
  if (profile && sensitive.length !== 1) {
    throw new Error(`${profile.id}: expected exactly one never-render column`);
  }
  for (const record of result.records) {
    for (const key of Object.keys(record)) {
      if (!CONVERSATION_RECORD_KEYS.includes(key)) {
        throw new Error(`record carries ${key}, which is outside the conversation record vocabulary`);
      }
    }
    for (const key of ["prompt_chars", "prompt_token_estimate"]) {
      if (!Number.isFinite(record[key])) throw new Error(`${key} is not a number`);
    }
    if (typeof record.prompt_empty !== "boolean") throw new Error("prompt_empty is not a boolean");
  }
  return true;
}

/**
 * The JSON export payload, built from the allowlist. Nothing serializes the
 * parse result directly, so an internal field added later cannot ride out.
 */
export function conversationExportPayload(result) {
  return {
    contract: "wawalu.integration.conversation-export",
    contract_version: CONVERSATION_CONTRACT_VERSION,
    dialect: result.profileId,
    dialect_version: result.profileVersion,
    grouped: result.grouped,
    row_count: result.rowCount,
    skipped_row_count: result.skippedRowCount,
    out_of_order_row_count: result.outOfOrderRowCount,
    span: result.span ? { ...result.span } : null,
    departments: result.departments.map((bucket) => ({ ...bucket })),
    records: result.records.map((record) =>
      Object.fromEntries(CONVERSATION_RECORD_KEYS.map((key) => [key, record[key]]))),
    skipped: result.skipped.map((entry) => ({
      row_number: entry.rowNumber, conversation_id: entry.conversation_id,
      field: entry.field, code: entry.code, message: entry.message,
    })),
  };
}

export function conversationExportJson(result) {
  return `${JSON.stringify(conversationExportPayload(result), null, 2)}\n`;
}

/** The CSV export: the same allowlist, one column per derived key. */
export function conversationExportCsv(result) {
  const lines = [CONVERSATION_RECORD_KEYS.join(",")];
  for (const record of result.records) {
    lines.push(CONVERSATION_RECORD_KEYS.map((key) => String(record[key])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The sentences a surface may show about an import. Every one is built from a
 * count, a dialect label, or a department name — never from a cell of the file.
 */
export function conversationSummaryLines(result) {
  if (result.status !== "matched") {
    return [
      "This file was not recognized as a conversation export.",
      "Map its columns yourself, or download an example export to compare against.",
    ];
  }
  const lines = [
    `Recognized as ${result.profileLabel} (contract ${CONVERSATION_CONTRACT_VERSION}, `
      + `dialect version ${result.profileVersion}).`,
    `${result.records.length} of ${result.rowCount} rows read; `
      + `${result.skippedRowCount} skipped as invalid.`,
    result.grouped
      ? `Grouped into ${result.departments.length} department${result.departments.length === 1 ? "" : "s"}.`
      : `No department column, so every row is in one ${UNGROUPED_DEPARTMENT} bucket.`,
    "Prompt text was measured, never read into this page.",
  ];
  if (result.span) lines.push(`Covers ${result.span.first} to ${result.span.last}.`);
  if (result.outOfOrderRowCount) {
    lines.push(`${result.outOfOrderRowCount} row${result.outOfOrderRowCount === 1 ? " was" : "s were"} `
      + "out of chronological order; ordering is derived, so this changed nothing.");
  }
  return lines;
}
