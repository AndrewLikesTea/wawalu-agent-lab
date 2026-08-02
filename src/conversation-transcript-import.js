// Assistant conversation/transcript exports, accepted by the SAME drop-anywhere
// import entry point that accepts a billing export (#996).
//
// The merged conversation contract (`conversation-export.js`, #373/#375) reads a
// DELIMITED conversation export: one row per turn, a header row, one prompt
// column. What a leader can actually download from an assistant admin console is
// usually not that — it is a JSON export of conversation objects, or a
// newline-delimited log of message events. This module accepts those two shapes
// and hands the merged contract exactly the table it already consumes. There is
// no second parser, no second rubric, and no second scoring path: everything
// below ends in `parseConversationExport` + `aggregateConversationLiteracy`.
//
// ===========================================================================
// FIELD CONTRACT — schema version `conversation-transcript/1.0`
// ===========================================================================
//
// TWO ACCEPTED SHAPES. Both are decided from the file's CONTENT. The file name,
// its extension and its media type are not inputs to any function in this file.
//
// ---------------------------------------------------------------------------
// SHAPE 1 — `conversation.envelope` (JSON)
// ---------------------------------------------------------------------------
//   Discriminating fields the detector keys on:
//     * the WHOLE file parses as one JSON value, and
//     * that value is an array — or an object carrying one of
//       `conversations` / `items` / `data` / `records` as an array — and
//     * at least one element of that array is an object carrying a nested
//       `messages` / `turns` / `transcript` ARRAY whose entries are objects
//       with a `role` / `sender` / `author_role` key.
//     The nested role-bearing array is the discriminator. No billing export, no
//     HRIS roster, no query-sample envelope and no Shiplog delivery history
//     nests turns inside a conversation, so nothing else in the intake can be
//     read as this shape.
//   Required, per conversation object:
//     * an identifier   — `conversation_id` | `conversationId` | `thread_id`
//                         | `chat_id` | `id` | `uuid`
//     * a timestamp     — `started_at` | `created_at` | `occurred_at`
//                         | `timestamp` | `time` | `ts` | `event_time`,
//                         ISO 8601; a conversation with none of its own falls
//                         back to the first timestamp on its own messages
//     * an actor        — `user_email` | `account_email` | `actor_email`
//                         | `member_email` | `user_id` | `user` | `actor`
//                         | `author`. An object here is read for its `email`
//                         or `id`.
//     * `messages`      — the nested array above, with at least one entry
//   Optional:
//     * a department (below), a model (`model` | `model_slug` | `model_id`),
//       per-message timestamps, and any other key, which is ignored.
//
// ---------------------------------------------------------------------------
// SHAPE 2 — `message.events` (JSONL / newline-delimited JSON)
// ---------------------------------------------------------------------------
//   Discriminating fields the detector keys on:
//     * each non-blank LINE parses as its own JSON object — there is no single
//       whole-file value the events belong to — and
//     * at least one such object carries BOTH a conversation identifier
//       (`conversation_id` | `conversationId` | `thread_id` | `chat_id`) and a
//       `role` / `sender` / `author_role` at its top level, with NO nested
//       messages array.
//     Flat-and-repeated versus nested-and-single is what separates the two: a
//     shape-1 file has one top-level value whose turns are nested, a shape-2
//     file has N top-level values that repeat a conversation id between them.
//     Neither test can pass for the other file, so the two are genuinely
//     distinguishable without ever consulting a name or an extension.
//   Required, per EVENT (one line):
//     * a conversation identifier (above)
//     * a role (above)
//     * a timestamp (the same key list as shape 1)
//   Required, per CONVERSATION (the events sharing one identifier):
//     * at least one event, and an actor named by at least one of its events
//   Optional:
//     * content (`content` | `text` | `body` | `message`) — an event with no
//       content is a real turn that contributed no prompt characters
//     * a department, a model, a per-event actor
//
// ---------------------------------------------------------------------------
// DEPARTMENT ATTRIBUTION, AND ITS FALLBACK
// ---------------------------------------------------------------------------
// Field, in this fixed order, first non-empty wins: `department`, `team`,
// `cost_center`, `org_unit`, `group`, `workspace_group`. Shape 1 reads it off
// the conversation object; shape 2 off the first event of the conversation that
// carries one.
//
// When absent the conversation is emitted with the merged contract's own
// `(ungrouped)` value rather than a guess. The literacy layer then applies the
// precedence it already owns (`DEPARTMENT_SOURCES` in `conversation-literacy.js`):
// the roster is joined on the actor identifier, and a conversation nothing can
// place lands in `(unattributed)`, counted and reported, never merged into
// another department's denominator. An actor identifier that is not an email
// cannot join the roster, so for those the export's own department field is the
// only attribution there is — stated here rather than discovered later.
//
// ---------------------------------------------------------------------------
// A RECORD MISSING REQUIRED FIELDS
// ---------------------------------------------------------------------------
// Skipped and counted. Never fatal, and never a silently shrunk total:
//   * a conversation missing an identifier, an actor or a usable timestamp is
//     emitted as a row with that cell blank, which the merged contract turns
//     into a located `missing_required_value` / `invalid_timestamp` skip. It
//     therefore appears in `skipped` and in `skippedRowCount`, with a row
//     number and a code, exactly like a bad row of a delimited export.
//   * a shape-2 LINE that is not JSON at all is counted in
//     `unreadableLineCount`; a shape-2 line missing a conversation id or a role
//     is counted in `skippedEventCount`. Neither ends the import.
//   * only a file matching NEITHER shape is refused, and the refusal names both
//     shapes and their required fields (`describeUnrecognizedTranscript`).
//
// ===========================================================================
// REDACTION BY CONSTRUCTION
// ===========================================================================
// Message text is built into a local `rows` array inside `parseConversationTranscript`
// and handed straight to `parseConversationExport`, whose never-render coercion
// turns it into a character count, a token estimate and an `empty` flag. That
// array is emptied before this function returns and is reachable from nothing it
// returns. No exported function of this module returns, accepts a callback over,
// or stores message text, conversation titles, or any other free text of the
// file: every value that leaves here is a count, a flag, an ISO timestamp, an
// identifier the file used as a key, a department label, or a phrase authored in
// this repository.
//
// Only USER turns are measured. An assistant's reply is not a prompt, so its
// text is never even concatenated — roles are read to decide that, and the role
// vocabulary is this module's, not the file's.

import { NEVER_RENDER, UNGROUPED_DEPARTMENT } from "./dialect-profiles.js";
import { parseConversationExport } from "./conversation-export.js";
import { aggregateConversationLiteracy } from "./conversation-literacy.js";
import { classifyQuery } from "./query-classification.js";
import { ORG_QUERY_SOURCE_CONTRACT_ID, organizationalSampleSummary } from "./org-query-source.js";

/** Bumped when a key list, a required field, or a fallback below changes. */
export const CONVERSATION_TRANSCRIPT_VERSION = "1.0";
export const CONVERSATION_TRANSCRIPT_CONTRACT =
  `wawalu.integration.conversation-transcript/${CONVERSATION_TRANSCRIPT_VERSION}`;

/** The two shape ids. Stable; a consumer switches on these, never on a label. */
export const TRANSCRIPT_SHAPE_IDS = Object.freeze({
  envelope: "conversation.envelope",
  events: "message.events",
});

// The key lists, declared once and read by the detector, the row builders and
// the refusal message alike — so the contract above cannot drift from the code.
const CONVERSATION_ID_KEYS = Object.freeze([
  "conversation_id", "conversationId", "thread_id", "chat_id", "id", "uuid",
]);
const EVENT_ID_KEYS = Object.freeze(["conversation_id", "conversationId", "thread_id", "chat_id"]);
const ACTOR_KEYS = Object.freeze([
  "user_email", "account_email", "actor_email", "member_email",
  "user_id", "user", "actor", "author",
]);
const TIME_KEYS = Object.freeze([
  "started_at", "created_at", "occurred_at", "timestamp", "time", "ts", "event_time",
]);
const DEPARTMENT_KEYS = Object.freeze([
  "department", "team", "cost_center", "org_unit", "group", "workspace_group",
]);
const MODEL_KEYS = Object.freeze(["model", "model_slug", "model_id"]);
const MESSAGES_KEYS = Object.freeze(["messages", "turns", "transcript"]);
const ROLE_KEYS = Object.freeze(["role", "sender", "author_role"]);
const CONTENT_KEYS = Object.freeze(["content", "text", "body", "message"]);
const ENVELOPE_KEYS = Object.freeze(["conversations", "items", "data", "records"]);

/** Which roles are a person asking. The vocabulary is ours, not the file's. */
const USER_ROLES = new Set(["user", "human", "member", "end_user", "customer", "person", "requester"]);

/**
 * The accepted shapes, machine-readable, so the refusal message below is
 * generated from the same declaration the detector runs on.
 */
export const TRANSCRIPT_SHAPES = Object.freeze([
  Object.freeze({
    id: TRANSCRIPT_SHAPE_IDS.envelope,
    label: "Conversation envelope (JSON)",
    format: "json",
    discriminator: "one whole-file JSON value holding conversation objects, each nesting a "
      + "messages array of role/content turns",
    required: Object.freeze(["conversation_id", "a timestamp", "a user identifier", "messages[]"]),
    requiredKeys: Object.freeze([CONVERSATION_ID_KEYS, TIME_KEYS, ACTOR_KEYS, MESSAGES_KEYS]),
  }),
  Object.freeze({
    id: TRANSCRIPT_SHAPE_IDS.events,
    label: "Message events (newline-delimited JSON)",
    format: "jsonl",
    discriminator: "one JSON object per line, each a flat message event repeating its "
      + "conversation id, with no nested messages array",
    required: Object.freeze(["conversation_id", "role", "a timestamp"]),
    requiredKeys: Object.freeze([EVENT_ID_KEYS, ROLE_KEYS, TIME_KEYS]),
  }),
]);

const shapeById = (id) => TRANSCRIPT_SHAPES.find((shape) => shape.id === id) ?? null;

// --------------------------------------------------------------- reading keys

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** The first of `keys` this object carries with a non-blank scalar value. */
function pick(source, keys) {
  if (!isObject(source)) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    // A nested actor object is common (`user: { email, id }`) and is read for
    // the two keys that can identify a person, never for a display name.
    if (isObject(value)) {
      const nested = typeof value.email === "string" ? value.email
        : typeof value.id === "string" ? value.id : "";
      if (nested.trim() !== "") return nested.trim();
    }
  }
  return "";
}

/** The nested turns of a conversation object, or null when it nests none. */
function messagesOf(entry) {
  if (!isObject(entry)) return null;
  for (const key of MESSAGES_KEYS) if (Array.isArray(entry[key])) return entry[key];
  return null;
}

const roleOf = (message) => pick(message, ROLE_KEYS).toLowerCase();

/**
 * One message's text. A local read, called only from the row builders, whose
 * return value never reaches an exported result. Content blocks
 * (`content: [{type, text}]`) are flattened because that is what several
 * consoles export; the flattening is still only ever measured.
 */
function contentOf(message) {
  if (typeof message === "string") return message;
  if (!isObject(message)) return "";
  for (const key of CONTENT_KEYS) {
    const value = message[key];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map((block) => (typeof block === "string" ? block
        : isObject(block) ? String(block.text ?? block.content ?? "") : "")).join("\n");
    }
  }
  return "";
}

const nonBlankLines = (text) => String(text ?? "").split(/\r?\n/).filter((line) => line.trim() !== "");

function jsonValue(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

/** The array of conversation objects a shape-1 file offers, or null. */
function envelopeList(value) {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return null;
  for (const key of ENVELOPE_KEYS) if (Array.isArray(value[key])) return value[key];
  return null;
}

const nestsTurns = (entry) => {
  const messages = messagesOf(entry);
  return Array.isArray(messages) && messages.some((message) => roleOf(message) !== "");
};

// ------------------------------------------------------------------ detection

/**
 * Which accepted shape this text is, decided from the text and nothing else.
 *
 * @returns a frozen `{ shape, label, conversationCount, observed, reason }`.
 *   `shape` is null when neither shape matched; `observed` is a STRUCTURAL
 *   description built from counts and the presence of keys — never from a cell,
 *   a message, or a title — so it is safe to put in front of a reader.
 */
export function detectConversationTranscript(text) {
  const source = typeof text === "string" ? text : String(text ?? "");
  if (!source.trim()) {
    return unmatched("no content at all", "the file is empty or contains only blank space");
  }

  const whole = jsonValue(source);
  if (whole.ok) {
    const list = envelopeList(whole.value);
    if (Array.isArray(list) && list.some(nestsTurns)) {
      return Object.freeze({
        shape: TRANSCRIPT_SHAPE_IDS.envelope,
        label: shapeById(TRANSCRIPT_SHAPE_IDS.envelope).label,
        conversationCount: list.length,
        observed: `${list.length} conversation object${list.length === 1 ? "" : "s"}, `
          + "each nesting an array of role-bearing turns",
        reason: "a whole-file JSON value whose entries nest role-bearing turns",
      });
    }
  }

  const lines = nonBlankLines(source);
  const events = lines.map((line) => jsonValue(line)).filter((read) => read.ok && isObject(read.value));
  const claimed = events.filter((read) =>
    pick(read.value, EVENT_ID_KEYS) !== "" && roleOf(read.value) !== "" && !messagesOf(read.value));
  if (claimed.length) {
    const conversations = new Set(claimed.map((read) => pick(read.value, EVENT_ID_KEYS)));
    return Object.freeze({
      shape: TRANSCRIPT_SHAPE_IDS.events,
      label: shapeById(TRANSCRIPT_SHAPE_IDS.events).label,
      conversationCount: conversations.size,
      observed: `${claimed.length} newline-delimited message event${claimed.length === 1 ? "" : "s"} `
        + `across ${conversations.size} conversation id${conversations.size === 1 ? "" : "s"}`,
      reason: "one flat, role-bearing JSON message event per line",
    });
  }

  // Nothing matched. Say what the file structurally IS, in counts and shape
  // words, so a reader can tell which of the two shapes they are nearest to.
  if (whole.ok) {
    const list = envelopeList(whole.value);
    if (Array.isArray(list)) {
      return unmatched(`a JSON array of ${list.length} entr${list.length === 1 ? "y" : "ies"}, `
        + "none of which nests an array of role-bearing turns",
        "no entry carries a messages, turns, or transcript array with a role on its entries");
    }
    return unmatched(Array.isArray(whole.value)
      ? "an empty JSON array"
      : `a single JSON ${isObject(whole.value) ? "object" : "value"} that holds no array of `
        + "conversations", "the top level names no conversations, items, data, or records array");
  }
  if (events.length) {
    return unmatched(`${events.length} newline-delimited JSON object${events.length === 1 ? "" : "s"}, `
      + "none carrying both a conversation id and a role",
      "every line parsed, but no line is a message event");
  }
  return unmatched(`${lines.length} non-blank line${lines.length === 1 ? "" : "s"} that are not JSON `
    + "— most likely a delimited file", "no whole-file JSON value and no JSON line");
}

function unmatched(observed, reason) {
  return Object.freeze({ shape: null, label: null, conversationCount: 0, observed, reason });
}

// ------------------------------------------------------------------ the table

/**
 * The private column vocabulary the two shapes normalize onto.
 *
 * These headers exist only between the row builders below and
 * `parseConversationExport`; no file is ever asked to carry them and no reader
 * ever sees them. They are prefixed so they cannot collide with a vendor header
 * a delimited export might really have.
 */
const TRANSCRIPT_COLUMNS = Object.freeze([
  "transcript_conversation_id", "transcript_actor", "transcript_started_at",
  "transcript_prompt_body", "transcript_department", "transcript_model", "transcript_shape",
]);

const columnEntry = (source, field, coerce, options = {}) => Object.freeze({
  source,
  aliases: Object.freeze([]),
  field,
  coerce,
  required: options.required !== false,
  whenAbsent: options.whenAbsent ? Object.freeze(options.whenAbsent) : null,
  sensitivity: options.sensitivity ?? null,
});

/**
 * The internal dialect profile, handed to `parseConversationExport` through its
 * own `profiles` option. A profile rather than a hand-rolled loop because the
 * never-render discipline, the counted skips and the derived ordering are all
 * enforced by that contract, and reimplementing any of them here would be the
 * second parser this module exists to avoid.
 *
 * One never-render column, as `assertNeverRenderClean` requires.
 */
export const TRANSCRIPT_DIALECT_PROFILES = Object.freeze([Object.freeze({
  id: "assistant-conversation-transcript",
  label: "Assistant conversation transcript",
  kind: "conversation",
  groupingUnit: null,
  groupingCandidates: Object.freeze([]),
  groupingPrecedence: null,
  version: 1,
  changelog: Object.freeze([
    Object.freeze({ version: 1, note: "Initial mapping: JSON envelope and JSONL message events." }),
  ]),
  constants: Object.freeze({}),
  match: Object.freeze({ minColumns: 5, forbidden: Object.freeze([]) }),
  columns: Object.freeze([
    columnEntry("transcript_conversation_id", "conversation_id", "string"),
    // `string`, not `emailAddress`: a console that identifies people by an
    // opaque id exports a real transcript, and refusing every row of it would
    // be this contract inventing a requirement its own shapes do not have.
    columnEntry("transcript_actor", "actor_id", "string"),
    columnEntry("transcript_started_at", "occurred_at", "instant"),
    columnEntry("transcript_prompt_body", "prompt_signals", "promptSignals",
      { sensitivity: NEVER_RENDER }),
    columnEntry("transcript_department", "department", "string",
      { required: false, whenAbsent: { mode: "default", value: UNGROUPED_DEPARTMENT } }),
    columnEntry("transcript_model", "model", "string",
      { required: false, whenAbsent: { mode: "omit" } }),
    // Detection-only, and its value is a shape id this repository authored.
    columnEntry("transcript_shape", null, "string",
      { required: false, whenAbsent: { mode: "omit" } }),
  ]),
})]);

const row = ({ id, actor, when, prompt, department, model, shape }) => [
  id, actor, when, prompt, department, model, shape,
];

/** Shape 1 → rows. The returned rows carry message text; see the caller. */
function envelopeRows(value) {
  const list = envelopeList(value) ?? [];
  const rows = [];
  for (const entry of list) {
    const messages = messagesOf(entry) ?? [];
    const userTurns = messages.filter((message) => USER_ROLES.has(roleOf(message)));
    rows.push(row({
      id: pick(entry, CONVERSATION_ID_KEYS),
      actor: pick(entry, ACTOR_KEYS).toLowerCase(),
      when: pick(entry, TIME_KEYS) || pick(messages[0], TIME_KEYS),
      prompt: userTurns.map(contentOf).join("\n"),
      department: pick(entry, DEPARTMENT_KEYS),
      model: pick(entry, MODEL_KEYS) || pick(messages[0], MODEL_KEYS),
      shape: TRANSCRIPT_SHAPE_IDS.envelope,
    }));
  }
  return { rows, unreadableLineCount: 0, skippedEventCount: 0 };
}

/** Shape 2 → rows, one per conversation id in first-seen order. */
function eventRows(text) {
  const buckets = new Map();
  let unreadableLineCount = 0;
  let skippedEventCount = 0;
  for (const line of nonBlankLines(text)) {
    const read = jsonValue(line);
    if (!read.ok || !isObject(read.value)) {
      unreadableLineCount += 1;
      continue;
    }
    const event = read.value;
    const id = pick(event, EVENT_ID_KEYS);
    const role = roleOf(event);
    if (!id || !role) {
      skippedEventCount += 1;
      continue;
    }
    const bucket = buckets.get(id) ?? {
      id, actor: "", when: "", department: "", model: "", prompt: [],
    };
    const when = pick(event, TIME_KEYS);
    // Earliest wins, so a shuffled log and an ordered one produce the same
    // conversation timestamp. Comparison is lexicographic over ISO strings.
    if (when && (!bucket.when || when < bucket.when)) bucket.when = when;
    bucket.actor ||= pick(event, ACTOR_KEYS).toLowerCase();
    bucket.department ||= pick(event, DEPARTMENT_KEYS);
    bucket.model ||= pick(event, MODEL_KEYS);
    if (USER_ROLES.has(role)) bucket.prompt.push(contentOf(event));
    buckets.set(id, bucket);
  }
  const rows = [...buckets.values()].map((bucket) => row({
    ...bucket, prompt: bucket.prompt.join("\n"), shape: TRANSCRIPT_SHAPE_IDS.events,
  }));
  return { rows, unreadableLineCount, skippedEventCount };
}

// ---------------------------------------------------------------- the refusal

/**
 * The refusal, naming both accepted shapes, the required fields of each, and
 * what this file structurally appeared to contain.
 *
 * Generated from `TRANSCRIPT_SHAPES` so a field added to the contract cannot be
 * missing from the message a reader is handed.
 */
export function describeUnrecognizedTranscript(text) {
  const detected = detectConversationTranscript(text);
  const shapes = TRANSCRIPT_SHAPES
    .map((shape, index) => `(${index + 1}) ${shape.label} — ${shape.discriminator}; `
      + `required: ${shape.required.join(", ")}`)
    .join(". ");
  return `This file is neither accepted conversation transcript shape `
    + `(contract ${CONVERSATION_TRANSCRIPT_CONTRACT}). ${shapes}. `
    + `Department attribution is optional on both — ${DEPARTMENT_KEYS.join(", ")}, first one `
    + `present — and a conversation with none is grouped as ${UNGROUPED_DEPARTMENT} and attributed `
    + `from the roster, never dropped. This file appeared to contain ${detected.observed}.`;
}

// ------------------------------------------------------------------ the parse

/**
 * Read one transcript into the merged conversation contract's own result.
 *
 * THE ONLY PLACE MESSAGE TEXT EXISTS. `built.rows` holds the concatenated user
 * turns for the length of one call, is handed to `parseConversationExport`,
 * which converts the never-render column into counts, and is emptied before this
 * function returns. Nothing it returns has a key that text could be in.
 *
 * @returns a `parseConversationExport` result — `status: "matched"` with
 *   `records`, `classifications`, `skipped`, `departments` and `span`, plus the
 *   shape this module matched — or a frozen unrecognized result carrying the
 *   named refusal on `message`. Never throws.
 */
export function parseConversationTranscript(text) {
  const detected = detectConversationTranscript(text);
  if (!detected.shape) return unrecognizedResult(text, detected);

  const built = detected.shape === TRANSCRIPT_SHAPE_IDS.envelope
    ? envelopeRows(jsonValue(text).value)
    : eventRows(text);
  const parsed = parseConversationExport(
    { columns: [...TRANSCRIPT_COLUMNS], rows: built.rows },
    { profiles: TRANSCRIPT_DIALECT_PROFILES, classify: classifyQuery },
  );
  // The table is dropped here, before anything is returned, rather than left to
  // be garbage collected at some point after a caller has a handle on it.
  built.rows.length = 0;
  if (parsed.status !== "matched") return unrecognizedResult(text, detected);

  return Object.freeze({
    ...parsed,
    transcriptContract: CONVERSATION_TRANSCRIPT_CONTRACT,
    shape: detected.shape,
    shapeLabel: detected.label,
    unreadableLineCount: built.unreadableLineCount,
    skippedEventCount: built.skippedEventCount,
  });
}

function unrecognizedResult(text, detected) {
  return Object.freeze({
    status: "unrecognized",
    transcriptContract: CONVERSATION_TRANSCRIPT_CONTRACT,
    shape: null,
    shapeLabel: null,
    profileId: null,
    profileVersion: null,
    contractVersion: null,
    reason: detected.reason,
    observed: detected.observed,
    message: describeUnrecognizedTranscript(text),
    records: Object.freeze([]),
    classifications: Object.freeze([]),
    skipped: Object.freeze([]),
    skippedRowCount: 0,
    rowCount: 0,
    unreadableLineCount: 0,
    skippedEventCount: 0,
    grouped: false,
    departments: Object.freeze([]),
    span: null,
    outOfOrderRowCount: 0,
  });
}

/**
 * Text in, per-department literacy out: the whole pipeline as one call, and the
 * same `{ parse, literacy }` shape `analyzeConversationExportText` returns for a
 * delimited conversation export.
 *
 * @throws {TypeError} carrying the named refusal when neither shape matched.
 */
export function analyzeConversationTranscriptText(text, options = {}) {
  const parsed = parseConversationTranscript(text);
  if (parsed.status !== "matched") {
    const error = new TypeError(parsed.message);
    error.code = "unrecognized_conversation_transcript";
    throw error;
  }
  return Object.freeze({
    parse: Object.freeze({
      status: parsed.status,
      shape: parsed.shape,
      dialect: parsed.profileId,
      rowCount: parsed.rowCount,
      recordCount: parsed.records.length,
      skippedRowCount: parsed.skippedRowCount,
      unreadableLineCount: parsed.unreadableLineCount,
      skippedEventCount: parsed.skippedEventCount,
      grouped: parsed.grouped,
    }),
    literacy: aggregateConversationLiteracy({
      parsed, roster: options.roster ?? [], minimumPrompts: options.minimumPrompts,
    }),
  });
}

// ----------------------------------------------------------- the intake seam

export const TRANSCRIPT_SOURCE_ID = "local-conversation-transcript";
export const TRANSCRIPT_SOURCE_LABEL = "Assistant conversation transcript export";

const TRANSCRIPT_PROVENANCE = Object.freeze({
  label: TRANSCRIPT_SOURCE_LABEL,
  detail: "Read in this tab. Message text is measured and classified inside the parser and "
    + "discarded there; only counts and a rubric category leave it.",
});

/**
 * A transcript, adapted into the organizational-query result shape the import
 * flow's `archives` list already carries.
 *
 * `category` is the rubric key the classifier produced INSIDE the parse, and
 * `promptExcerpt` is null: that pair is what makes `classifyRecords` take its
 * declared-category branch, so the file reaches the literacy grade without an
 * excerpt ever existing outside the parse. `model` is null for the same reason —
 * a vendor SKU is a cell, and the tier it implies is already folded into the
 * classification the grade was computed from.
 *
 * @returns `{ ok: true, ... }` on a match, or `{ ok: false, code, message,
 *   recovery }` naming both accepted shapes. Never throws.
 */
export function readConversationTranscript(text) {
  const parsed = parseConversationTranscript(text);
  if (parsed.status !== "matched") {
    return Object.freeze({
      ok: false,
      code: "unrecognized_source_shape",
      sourceId: TRANSCRIPT_SOURCE_ID,
      message: parsed.message,
      recovery: "Re-export the transcript in one of the two shapes above, or use this file with "
        + "the intake it belongs to; nothing from it was read or kept.",
    });
  }
  const records = parsed.records.map((record, index) => Object.freeze({
    row: index + 1,
    orgUnitId: record.department || UNGROUPED_DEPARTMENT,
    queryDate: String(record.occurred_at ?? "").slice(0, 10),
    model: null,
    inputTokens: null,
    outputTokens: null,
    category: parsed.classifications[index]?.classified === true
      ? parsed.classifications[index].category : null,
    promptExcerpt: null,
  })).filter((record) => record.queryDate.length === 10);

  if (!records.length) {
    return Object.freeze({
      ok: false,
      code: "empty_source",
      sourceId: TRANSCRIPT_SOURCE_ID,
      message: `This transcript matched ${parsed.shapeLabel}, but no conversation in it carried a `
        + `usable timestamp, so none can be placed in a day bucket. `
        + `${parsed.skippedRowCount} row${parsed.skippedRowCount === 1 ? " was" : "s were"} skipped.`,
      recovery: "Check the timestamp field, then choose the file again.",
    });
  }

  return Object.freeze({
    ok: true,
    sourceId: TRANSCRIPT_SOURCE_ID,
    sourceLabel: TRANSCRIPT_SOURCE_LABEL,
    registryContract: ORG_QUERY_SOURCE_CONTRACT_ID,
    provenance: TRANSCRIPT_PROVENANCE,
    grades: "prompt_literacy",
    dialect: parsed.shape,
    contract: CONVERSATION_TRANSCRIPT_CONTRACT,
    keySpace: "source_label",
    snapshot: null,
    records: Object.freeze(records),
    issues: Object.freeze([...parsed.skipped]),
    skippedRowCount: parsed.skippedRowCount,
    outOfOrderRowCount: parsed.outOfOrderRowCount,
    summary: organizationalSampleSummary(records, { grades: "prompt_literacy" }),
  });
}

/**
 * The plain-language statement the import panel shows, in its normal reading
 * flow. Two sentences and no disclosure: a folded region is unreadable to a real
 * reader whatever a test harness can read through.
 */
export const TRANSCRIPT_INTAKE_COPY = Object.freeze({
  reads: "From an assistant conversation export this page reads how many messages each "
    + "conversation holds and which role sent each one, the conversation timestamp, the user "
    + "identifier, and the department the export names.",
  discards: "It never keeps the words. Message and prompt text is measured inside the parser — "
    + "characters counted, a rubric category derived — and discarded there. No message text, "
    + "prompt text, or conversation title reaches this page, this browser's storage, or the "
    + "JSON export.",
});
