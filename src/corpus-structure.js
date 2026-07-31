// The structural-column reader: which ordering, tier, time, and language
// columns a reader's own raw assistant export actually carries.
//
// WHY IT IS SEPARATE FROM `conversation-export.js`. That reader answers "what
// did this file spend, per department, without ever touching a prompt". This
// one answers a question asked strictly earlier, before any grade exists: *of
// the columns later structural grading depends on, which ones are in the file I
// just chose?* The two consume the same vendor exports and the same header-row
// detection idea, but they emit different vocabularies, and folding this into
// the conversation record would widen a shape whose narrowness is the whole of
// its never-render guarantee. So this module is additive: it reads the same
// table, emits its own record, and changes nothing about what a conversation
// import does.
//
// THE RULES, as implemented rather than promised:
//
//   1. Absent is a state, not a blank. Every structural field is `null` when the
//      export cannot supply it, which is a different value from `""` and from
//      `0`. Nothing is defaulted, back-filled, or guessed.
//   2. Recognition is by declared column name only. `DIALECTS` below is an
//      explicit per-dialect table; there is no substring match, no fuzzy score,
//      and no heuristic that could land a customer's arbitrary column on a
//      structural field. An undeclared column is ignored, full stop.
//   3. A field is *detected* only when the dialect declares the column AND at
//      least one row carries a usable value. A column present but empty in
//      every row cannot support a later structural signal, so it is reported as
//      not present rather than as a column that exists.
//   4. Partial data is normal. A row missing a structural value is kept, with
//      that field absent on its record. No row is ever dropped for a missing
//      structural field.
//   5. Malformed does not throw. A ragged row or an undecodable turn ordinal is
//      counted as skipped and parsing continues. A timestamp that is present but
//      unparseable leaves the field absent on that record rather than emitting a
//      date this layer invented.
//   6. Row order is not turn order. Nothing here sorts, renumbers, or repairs
//      ordering; `turnIndex` and `parentMessageId` are carried through as given.
//
// No network call, no clock, no storage, no randomness. The caller hands it text
// it read locally. Nothing this module returns carries a prompt, a message body,
// an account identifier, or any cell outside the six declared fields.

import { COERCIONS, normalizeColumnName } from "./dialect-profiles.js";
import { readDelimitedText } from "./delimited-text.js";

/**
 * The normalized record's own version, bumped when the shape or the dialect
 * table below changes. It is separate from the conversation contract version on
 * purpose: adding a dialect here is a visible change to *this* schema and must
 * not read as a change to what a conversation import emits.
 */
export const CORPUS_STRUCTURE_SCHEMA_VERSION = "1.0";

/**
 * The closed record vocabulary, in the order a summary renders them, each with
 * the words a FinOps lead uses rather than the words a schema uses.
 *
 * `priority` is the deterministic rank behind the single next action: how much
 * later structural grading depends on the field. Thread id first — without it
 * there are no threads to grade at all — then turn ordering, then the tier the
 * turn ran on, then time, then language. `group` is what makes ordering one
 * question: `turnIndex` and `parentMessageId` are two encodings of the same
 * fact, so an export carrying either one is not missing ordering.
 */
export const STRUCTURAL_FIELDS = Object.freeze([
  Object.freeze({
    id: "threadId", label: "Conversation / thread id", group: "thread", priority: 1,
    coerce: "identifier",
  }),
  Object.freeze({
    id: "turnIndex", label: "Turn number within the thread", group: "ordering", priority: 2,
    coerce: "ordinal",
  }),
  Object.freeze({
    id: "parentMessageId", label: "Parent message id (the other way to order turns)",
    group: "ordering", priority: 2, coerce: "identifier",
  }),
  Object.freeze({
    id: "modelTier", label: "Model or tier the turn ran on", group: "model", priority: 3,
    coerce: "identifier",
  }),
  Object.freeze({
    id: "timestamp", label: "Request timestamp", group: "time", priority: 4,
    coerce: "instant",
  }),
  Object.freeze({
    id: "language", label: "Language of the conversation", group: "language", priority: 5,
    coerce: "identifier",
  }),
]);

/** The record keys, as an allowlist. A record is built from this, never copied. */
export const STRUCTURAL_RECORD_KEYS = Object.freeze(STRUCTURAL_FIELDS.map((field) => field.id));

/** Why a row was skipped. Downstream switches on the code, never the message. */
export const STRUCTURE_ROW_CODES = Object.freeze({
  raggedRow: "ragged_row",
  undecodableOrdinal: "undecodable_ordinal",
});

const col = (source, ...aliases) => Object.freeze({ source, aliases: Object.freeze(aliases) });

/**
 * The per-dialect column tables.
 *
 * `identity` is how a dialect is recognized: every one of its header names must
 * be present. The identity columns are deliberately *not* structural ones — a
 * vendor's message column and its actor column — so an export that carries none
 * of the structural columns is still recognized and can be told, precisely, that
 * it carries none of them. Identity sets are disjoint across dialects; a header
 * satisfying two of them is reported ambiguous rather than resolved by order.
 *
 * `columns` declares only what the vendor's console actually emits. A dialect
 * with no entry for a field cannot detect that field, and says so.
 *
 * `exportOptions` is the console toggle that would add a field the export does
 * not carry — the sentence the single next action is built from. It is authored
 * per dialect because "turn on message index" is not the same control in four
 * consoles, and a generic instruction is one a reader cannot act on.
 */
export const DIALECTS = Object.freeze([
  // Models the ChatGPT Enterprise admin conversation export (one row per
  // message). Orders by an explicit message index; carries no parent pointer.
  Object.freeze({
    id: "chatgpt-enterprise-conversation-export",
    label: "ChatGPT Enterprise conversation export",
    identity: Object.freeze(["message_text", "user_email"]),
    columns: Object.freeze({
      threadId: col("conversation_id", "thread_id"),
      turnIndex: col("message_index", "turn_index"),
      modelTier: col("model", "model_name"),
      timestamp: col("created_at", "message_created_at"),
      language: col("language", "detected_language"),
    }),
    exportOptions: Object.freeze({
      thread: "Include conversation id",
      ordering: "Include message index",
      model: "Include model",
      time: "Include created at",
      language: "Include detected language",
    }),
  }),
  // Models the Claude Enterprise organization conversation export (one row per
  // human turn). Orders by a parent message pointer rather than an ordinal, and
  // its console has no language column at all — hence no `language` entry.
  Object.freeze({
    id: "claude-enterprise-conversation-export",
    label: "Claude Enterprise conversation export",
    identity: Object.freeze(["prompt_text", "account_email"]),
    columns: Object.freeze({
      threadId: col("conversation_uuid", "chat_uuid"),
      parentMessageId: col("parent_message_uuid", "parent_uuid"),
      modelTier: col("model_slug", "model"),
      timestamp: col("started_at", "turn_started_at"),
    }),
    exportOptions: Object.freeze({
      thread: "Include conversation uuid",
      ordering: "Include parent message uuid",
      model: "Include model slug",
      time: "Include started at",
      language: "no language column is available in this export",
    }),
  }),
  // Models the Copilot interaction export. Its rows are interactions, so the
  // thread is a separate column from the row's own id, and the console emits a
  // locale but no model column.
  Object.freeze({
    id: "copilot-conversation-export",
    label: "Copilot interaction export",
    identity: Object.freeze(["prompt_body", "user_principal_name"]),
    columns: Object.freeze({
      threadId: col("conversation_thread_id", "thread_id"),
      turnIndex: col("turn_number", "interaction_ordinal"),
      timestamp: col("interaction_time", "interaction_timestamp"),
      language: col("locale", "client_locale"),
    }),
    exportOptions: Object.freeze({
      thread: "Include conversation thread id",
      ordering: "Include turn number",
      model: "no model column is available in this export",
      time: "Include interaction time",
      language: "Include locale",
    }),
  }),
  // Models a workspace assistant audit log. An audit log records events, so it
  // carries a thread id and a time and nothing else structural.
  Object.freeze({
    id: "workspace-audit-conversation-export",
    label: "Workspace assistant audit export",
    identity: Object.freeze(["prompt_content", "actor_email"]),
    columns: Object.freeze({
      threadId: col("conversation_ref", "session_ref"),
      timestamp: col("event_time", "event_timestamp"),
    }),
    exportOptions: Object.freeze({
      thread: "Include conversation ref",
      ordering: "no turn ordering column is available in an audit log export",
      model: "no model column is available in an audit log export",
      time: "Include event time",
      language: "no language column is available in an audit log export",
    }),
  }),
]);

const COERCE = Object.freeze({
  /** A bounded identifier-ish string, as the provider wrote it. Never remapped. */
  identifier(raw) {
    const value = String(raw ?? "").trim();
    if (value === "") throw new RangeError("is empty");
    return value;
  },
  /** A turn ordinal. Integer, zero or above; anything else indicts the row. */
  ordinal(raw) {
    const value = String(raw ?? "").trim();
    if (!/^\d+$/.test(value)) throw new RangeError("is not a whole turn number");
    return Number(value);
  },
  /** ISO 8601 UTC, from the coercion the shipped dialects already use. */
  instant: COERCIONS.instant,
});

/** Normalized header name -> leftmost column index carrying it. */
function indexHeader(header) {
  const index = new Map();
  header.forEach((name, position) => {
    const key = normalizeColumnName(name);
    if (key && !index.has(key)) index.set(key, position);
  });
  return index;
}

function locate(entry, index) {
  for (const name of [entry.source, ...entry.aliases]) {
    const key = normalizeColumnName(name);
    if (index.has(key)) return index.get(key);
  }
  return null;
}

/**
 * Which dialect a header row is, from the declared identity columns alone.
 * Returns `matched`, `unrecognized`, or `ambiguous` — never a partial guess.
 */
export function detectStructuralDialect(header, dialects = DIALECTS) {
  const index = indexHeader(header ?? []);
  const candidates = dialects.filter((dialect) =>
    dialect.identity.every((name) => index.has(normalizeColumnName(name))));
  if (candidates.length === 1) return { status: "matched", dialect: candidates[0], index };
  return { status: candidates.length ? "ambiguous" : "unrecognized", dialect: null, index };
}

const EMPTY_RECORD = Object.freeze(
  Object.fromEntries(STRUCTURAL_RECORD_KEYS.map((key) => [key, null])));

/**
 * Read raw export text and report which structural columns it carries.
 *
 * @param {string} text the file's own text, read locally by the caller.
 * @returns {object} frozen result: schema version, dialect, records, per-field
 *   detection, and the counted skips. Never throws for file content.
 */
export function parseCorpusStructure(text, { dialects = DIALECTS } = {}) {
  const table = readDelimitedText(text);
  if (!table.ok) {
    return frozenResult({ status: "unreadable", reason: table.problem?.code ?? "unreadable" });
  }

  const detection = detectStructuralDialect(table.header, dialects);
  if (detection.status !== "matched") {
    return frozenResult({ status: detection.status, rowCount: table.rowCount });
  }

  const dialect = detection.dialect;
  // The declared columns, resolved to positions once. A declared column whose
  // header is absent from this particular file resolves to null and is simply
  // not read; it is not an error and not a guess at another column.
  const positions = new Map();
  for (const field of STRUCTURAL_FIELDS) {
    const entry = dialect.columns[field.id];
    if (entry) positions.set(field.id, locate(entry, detection.index));
  }

  const records = [];
  const skipped = [];
  const width = table.header.length;
  table.rows.forEach((row, rowIndex) => {
    // A ragged row cannot be read by position without silently shifting one
    // column's values into another field. It is counted and stepped over.
    if (row.values.length !== width) {
      skipped.push(skip(rowIndex, STRUCTURE_ROW_CODES.raggedRow,
        `has ${row.values.length} values against ${width} columns`));
      return;
    }
    const record = { ...EMPTY_RECORD };
    let failed = null;
    for (const field of STRUCTURAL_FIELDS) {
      const position = positions.get(field.id);
      if (position === undefined || position === null) continue;
      const raw = row.values[position];
      if (raw === undefined || String(raw).trim() === "") continue;
      try {
        record[field.id] = COERCE[field.coerce](raw);
      } catch (error) {
        // A present-but-unreadable ordinal indicts the row; a present-but-
        // unreadable timestamp leaves one field unknown on an otherwise good
        // row, because inventing a date is worse than reporting no date.
        if (field.coerce === "ordinal") {
          failed = skip(rowIndex, STRUCTURE_ROW_CODES.undecodableOrdinal,
            `${field.id} ${error.message}`);
          break;
        }
        record[field.id] = null;
      }
    }
    if (failed) {
      skipped.push(failed);
      return;
    }
    records.push(Object.freeze(record));
  });

  // Detected means declared AND carried. A column every row left blank cannot
  // support a structural signal, so it is reported as not present.
  const detected = Object.fromEntries(STRUCTURAL_FIELDS.map((field) => [
    field.id,
    Boolean(dialect.columns[field.id])
      && positions.get(field.id) !== null
      && records.some((record) => record[field.id] !== null),
  ]));

  return frozenResult({
    status: "matched",
    dialectId: dialect.id,
    dialectLabel: dialect.label,
    records,
    detected,
    skipped,
    rowCount: table.rowCount,
  });
}

const skip = (rowIndex, code, reason) => Object.freeze({
  row: rowIndex,
  rowNumber: rowIndex + 1,
  code,
  // A coordinate, a code, and a shape. Never a cell value.
  message: `row ${rowIndex + 1}: ${reason}`,
});

function frozenResult({
  status, dialectId = null, dialectLabel = null, records = [], detected = null,
  skipped = [], rowCount = 0, reason = null,
}) {
  return Object.freeze({
    schemaVersion: CORPUS_STRUCTURE_SCHEMA_VERSION,
    status,
    reason,
    dialectId,
    dialectLabel,
    records: Object.freeze(records),
    detected: Object.freeze(detected
      ?? Object.fromEntries(STRUCTURAL_RECORD_KEYS.map((key) => [key, false]))),
    skipped: Object.freeze(skipped),
    rowsParsed: records.length,
    rowsSkipped: skipped.length,
    rowCount,
  });
}

/** Ordering is one question with two encodings; either one answers it. */
function groupDetected(detected, group) {
  return STRUCTURAL_FIELDS.filter((field) => field.group === group)
    .some((field) => detected[field.id]);
}

/**
 * The single next action, chosen deterministically.
 *
 * The missing groups are ranked by `priority` — the order later structural
 * grading depends on them — and only the top one is named, with the console
 * option that would supply it. There is no filler branch: with nothing missing
 * the action says so.
 */
export function nextStructuralAction(result) {
  if (result.status !== "matched") {
    return {
      group: null,
      text: "No supported export dialect matched this file's header row, so no column was read "
        + "from it and nothing was guessed. Re-export it from your assistant console.",
    };
  }
  const dialect = DIALECTS.find((entry) => entry.id === result.dialectId);
  // One entry per group, represented by the group's first field so "ordering"
  // is named by the turn number rather than by whichever encoding sorts last.
  const missing = STRUCTURAL_FIELDS
    .filter((field, position) =>
      STRUCTURAL_FIELDS.findIndex((other) => other.group === field.group) === position)
    .filter((field) => !groupDetected(result.detected, field.group))
    .sort((left, right) => left.priority - right.priority);
  if (!missing.length) {
    return {
      group: null,
      text: "Every structural column this analysis uses is already in your export. "
        + "No further console export option is needed.",
    };
  }
  const top = missing[0];
  const option = dialect?.exportOptions?.[top.group] ?? null;
  return {
    group: top.group,
    text: option && option.startsWith("no ")
      ? `Most valuable missing column: ${top.label.toLowerCase()}. In ${result.dialectLabel}, `
        + `${option} — a different export is needed to supply it.`
      : `Most valuable missing column: ${top.label.toLowerCase()}. Turn on “${option}” in your `
        + `${result.dialectLabel} and export again.`,
  };
}

/** The word each field ships, so a tint is never the only signal. */
const PRESENCE_WORD = Object.freeze({
  true: "detected", false: "not present in this export",
});

/**
 * The summary a surface renders: one row per structural field in the fixed
 * order, the dialect, the counts, and exactly one next action. Every string is
 * built from a count, an authored label, or a dialect name — never from a cell.
 */
export function structuralSummary(result) {
  return Object.freeze({
    schemaVersion: result.schemaVersion,
    recognized: result.status === "matched",
    dialectLine: result.status === "matched"
      ? `Recognized as ${result.dialectLabel} (structural schema ${result.schemaVersion}).`
      : result.status === "ambiguous"
        ? "This file's header row matches more than one supported export, so no dialect was "
          + "chosen and no column was read."
        : result.status === "unreadable"
          ? "This file could not be read as a delimited export, so no column was read."
          : "This file's header row matched no supported export dialect, so no column was read.",
    countLine: result.status === "matched"
      ? `${result.rowsParsed} row${result.rowsParsed === 1 ? "" : "s"} parsed`
        + (result.rowsSkipped
          ? `, ${result.rowsSkipped} skipped as malformed.`
          : ", none skipped as malformed.")
      : "No rows were parsed.",
    fields: Object.freeze(STRUCTURAL_FIELDS.map((field) => Object.freeze({
      id: field.id,
      label: field.label,
      detected: result.detected[field.id] === true,
      text: `${field.label} — ${PRESENCE_WORD[result.detected[field.id] === true]}`,
    }))),
    nextAction: Object.freeze(nextStructuralAction(result)),
  });
}

/** The one-sentence form the page's polite region announces. */
export function structuralAnnouncement(summary) {
  const detected = summary.fields.filter((field) => field.detected).length;
  return `${summary.dialectLine} ${detected} of ${summary.fields.length} structural columns `
    + `detected. ${summary.countLine} ${summary.nextAction.text}`;
}
