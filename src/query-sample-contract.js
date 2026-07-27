// The query-sample import contract: version, dialects, refused fields, and the
// redaction boundary the validator actually enforces.
//
// WHY THIS EXISTS. `local-finops.js` reports, for every department it ranks,
// "The provider billing contract contains no scored query-category sample."
// That is true and it is the whole gap: a billing aggregate says what a
// department spent, never what it asked for, so the prompt-literacy rubric has
// nothing to grade. This contract is the missing input, and it is deliberately
// the *narrowest* input that closes the gap — its required fields are exactly
// the four the rubric consumes (`category`, `model`, `inputTokens`,
// `outputTokens`), plus the department key that attributes a row and the day
// bucket that places it. Nothing else is required, because nothing else changes
// a grade, and a field nobody consumes is a field somebody has to defend.
//
// THE REDACTION BOUNDARY. A prompt excerpt is the only free text this contract
// admits and it is admitted on one condition: it is classified in the reader's
// own browser tab and discarded there. `classifyQuerySample` is the single door
// out of the parsed shape, and it *builds* its output from an allowlist rather
// than deleting the excerpt from a copy — a derived record has no excerpt key
// to leak because nothing ever wrote one. Files that carry data the product
// refuses to keep at all (end-user identifiers, full prompt or response bodies,
// API keys, per-request ids) are rejected whole, before a single row is read;
// see `REFUSED_COLUMNS`.
//
// FAILURE POLICY, and whose precedent it follows.
//   * File-level rejection for anything that indicts the whole file: an
//     unrecognized dialect, an unsupported kind or version, a refused column,
//     a stale delivery, no usable rows. Precedent: `local-finops.js`, which
//     rejects an envelope outright rather than salvaging records out of it.
//   * Row-level skip with a collected, coordinate-bearing issue for anything
//     wrong with one row. Precedent: `finops-tabular-import.js`, where partial
//     success is the normal case and a file with three bad dates yields the
//     other rows plus three located problems.
//
// This module performs no I/O of any kind: no fetch, no storage, no clock, no
// randomness. Callers hand it a string they read locally. No message it emits
// ever carries a cell value; messages name columns, codes, and coordinates.

import { readDelimitedText, DELIMITED_CODES, MAX_DELIMITED_BYTES, MAX_DELIMITED_ROWS } from "./delimited-text.js";
import { normalizeColumnName } from "./dialect-profiles.js";
import { PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";

/** The contract kind these documents declare. */
export const QUERY_SAMPLE_CONTRACT_KIND = "wawalu.integration.query-sample";

/** The version this module produces and accepts. */
export const QUERY_SAMPLE_SCHEMA_VERSION = "1.0";

/** Every version the validator accepts, oldest first. Additive only. */
export const SUPPORTED_QUERY_SAMPLE_SCHEMA_VERSIONS = Object.freeze([QUERY_SAMPLE_SCHEMA_VERSION]);

/** The label a parsed result is stamped with, derived, never written twice. */
export const QUERY_SAMPLE_CONTRACT_ID = `${QUERY_SAMPLE_CONTRACT_KIND}/${QUERY_SAMPLE_SCHEMA_VERSION}`;

/** The time granularity `query_date` states. Day, for the reason in the schema. */
export const QUERY_SAMPLE_BUCKET_GRANULARITY = "day";

/** The accepted bucket format, stated once and enforced against the calendar. */
export const QUERY_DATE_FORMAT = "YYYY-MM-DD";

/** Longest accepted excerpt. Long enough to classify, too short to be a body. */
export const MAX_PROMPT_EXCERPT_LENGTH = 280;

/** A UTF-8 BOM, stripped before anything reads the first character. */
const BOM = "﻿";

/** The HRIS org contract's key shape, reused verbatim — not a lookalike. */
const ORG_UNIT_ID_PATTERN = /^psn_[A-Za-z0-9_-]{16,64}$/;
const QUERY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MODEL_ID_PATTERN = new RegExp(PROMPT_LITERACY_RUBRIC.redaction.modelIdPattern);

/** The rubric's own category keys. Read from the rubric; never a second copy. */
export const QUERY_SAMPLE_CATEGORIES = Object.freeze(
  PROMPT_LITERACY_RUBRIC.categories.map((category) => category.key),
);

export { MAX_DELIMITED_BYTES, MAX_DELIMITED_ROWS };

/**
 * Every reason this contract can refuse a file or a row. Stable; downstream
 * switches on the code and never string-matches a message.
 */
export const QUERY_SAMPLE_CODES = Object.freeze({
  ...DELIMITED_CODES,
  UNRECOGNIZED_DIALECT: "unrecognized_dialect",
  REFUSED_COLUMN: "refused_column",
  UNSUPPORTED_CONTRACT: "unsupported_contract",
  UNKNOWN_FIELD: "unknown_field",
  STALE_DELIVERY: "stale_delivery",
  NO_USABLE_ROWS: "no_usable_rows",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  INVALID_DEPARTMENT_KEY: "invalid_department_key",
  INVALID_TIME_BUCKET: "invalid_time_bucket",
  INVALID_TOKEN_COUNT: "invalid_token_count",
  INVALID_MODEL_IDENTIFIER: "invalid_model_identifier",
  MISSING_CLASSIFICATION: "missing_classification",
  AMBIGUOUS_CLASSIFICATION: "ambiguous_classification",
  UNKNOWN_CATEGORY: "unknown_category",
  EXCERPT_TOO_LONG: "excerpt_too_long",
  UNMAPPED_COLUMN: "unmapped_column",
  OUT_OF_ORDER_ROW: "out_of_order_row",
});

/**
 * THE REFUSED SET. Columns whose presence rejects the file, keyed by the
 * normalized column name and carrying the reason a leader is owed. This is the
 * enforceable half of the redaction boundary: prose in a contract document
 * cannot stop a gateway from exporting a `user_email` column, and a validator
 * that quietly dropped it would leave the product holding data it promised
 * never to receive. Refusal is loud and whole-file on purpose — a row-level
 * skip would keep the rest of a file that should never have left the gateway.
 */
export const REFUSED_COLUMNS = Object.freeze({
  user_id: "identifies the person who made the request",
  user_email: "identifies the person who made the request",
  email: "identifies the person who made the request",
  username: "identifies the person who made the request",
  actor_id: "identifies the person who made the request",
  subject_id: "identifies the person who made the request",
  employee_id: "identifies the person who made the request",
  account_id: "identifies the person or account who made the request",
  ip_address: "identifies the device the request came from",
  prompt: "is a raw prompt body; this contract accepts a bounded excerpt only",
  prompt_text: "is a raw prompt body; this contract accepts a bounded excerpt only",
  prompt_body: "is a raw prompt body; this contract accepts a bounded excerpt only",
  full_prompt: "is a raw prompt body; this contract accepts a bounded excerpt only",
  input_text: "is a raw prompt body; this contract accepts a bounded excerpt only",
  messages: "is a raw conversation body; this contract accepts a bounded excerpt only",
  response: "is model output text, which is never imported",
  response_text: "is model output text, which is never imported",
  output_text: "is model output text, which is never imported",
  completion: "is model output text, which is never imported",
  api_key: "is a credential, which must never appear in an export",
  api_token: "is a credential, which must never appear in an export",
  authorization: "is a credential, which must never appear in an export",
  session_id: "is a per-session identifier the product refuses to keep",
  request_id: "is a per-request identifier the product refuses to keep",
});

/** Accepted column spellings per field. First match wins, leftmost column wins. */
const COLUMN_ALIASES = Object.freeze({
  org_unit_id: ["org_unit_id", "unit_id", "department_id", "org_unit", "department_key"],
  query_date: ["query_date", "date", "day", "usage_date", "bucket", "time_bucket", "date_bucket"],
  model_raw: ["model_raw", "model", "model_id", "model_name"],
  input_tokens: ["input_tokens", "prompt_tokens", "tokens_in", "input_token_count"],
  output_tokens: ["output_tokens", "completion_tokens", "tokens_out", "output_token_count"],
  prompt_excerpt: ["prompt_excerpt", "excerpt", "prompt_snippet", "query_excerpt"],
  category: ["category", "query_category", "assigned_category", "literacy_category"],
});

/** The fields every row must carry, whatever the dialect. */
export const REQUIRED_QUERY_SAMPLE_FIELDS = Object.freeze([
  "org_unit_id", "query_date", "model_raw", "input_tokens", "output_tokens",
]);

/** Exactly one of these must be present per row. Never both, never neither. */
export const CLASSIFICATION_FIELDS = Object.freeze(["prompt_excerpt", "category"]);

const ENVELOPE_KEYS = Object.freeze([
  "schema_version", "kind", "export_id", "snapshot", "privacy", "records",
]);
const SNAPSHOT_KEYS = Object.freeze([
  "source_instance_id", "sequence", "generated_at", "bucket_granularity",
  "completeness", "omitted_record_count", "issues",
]);
const PRIVACY_KEYS = Object.freeze([
  "classification_site", "prompt_text_retained", "direct_identifiers_included",
]);
const RECORD_KEYS = Object.freeze([...REQUIRED_QUERY_SAMPLE_FIELDS, ...CLASSIFICATION_FIELDS]);

function refusal(code, detail) {
  return Object.freeze({ ok: false, problem: Object.freeze({ code, ...detail }) });
}

function rowIssue(row, field, code, message) {
  return Object.freeze({ row, field, code, message });
}

/**
 * A real calendar day in the one accepted format. 2026-06-31 rolls over to
 * July and is refused; 2026-07-32 does not parse at all and is refused without
 * letting the Date constructor throw its way out of a row-level failure.
 */
function validQueryDate(value) {
  if (typeof value !== "string" || !QUERY_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Refuse the file if any column is one this product will not hold. Takes
 * already-normalized names so the delimited and JSON paths refuse the same set:
 * `User Email`, `user_email`, and `userEmail` are one column here.
 */
function refusedColumn(names) {
  for (const name of names) {
    const reason = REFUSED_COLUMNS[name];
    if (reason) return { column: name, reason };
  }
  return null;
}

// --- dialect recognition ---------------------------------------------------

/**
 * Decide what a file *is* from its bytes, never from its name.
 *
 * A leading `{` or `[` after whitespace means the producer wrote JSON, so JSON
 * owns the diagnosis from there — an envelope with the wrong kind is a wrong
 * envelope, not a CSV. Anything else goes to the delimited reader, which votes
 * on comma versus tab from field-count consistency across the leading records
 * (`delimited-text.js`), so a `.txt` TSV and a mislabelled `.csv` both land.
 *
 * A file that matches neither returns a code plus what was actually seen: the
 * delimiter that was chosen, the header names that were found, and the
 * top-level JSON type. Header names are column metadata, which this repository
 * already surfaces; no cell value is ever echoed.
 */
export function detectQuerySampleDialect(text) {
  const source = String(text ?? "");
  if (source.trim() === "") {
    return refusal(QUERY_SAMPLE_CODES.EMPTY_FILE, {
      expected: "a query-sample JSON envelope or a delimited gateway log",
      observed: "an empty file",
    });
  }
  const body = source.startsWith(BOM) ? source.slice(BOM.length) : source;
  const leading = body.trimStart()[0];
  if (leading === "{" || leading === "[") {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return refusal(QUERY_SAMPLE_CODES.UNRECOGNIZED_DIALECT, {
        expected: `a JSON object with kind “${QUERY_SAMPLE_CONTRACT_KIND}”`,
        observed: "text that begins like JSON but does not parse as JSON",
      });
    }
    const topLevel = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
    if (topLevel !== "object") {
      return refusal(QUERY_SAMPLE_CODES.UNRECOGNIZED_DIALECT, {
        expected: `a JSON object with kind “${QUERY_SAMPLE_CONTRACT_KIND}”`,
        observed: `a JSON ${topLevel} at the top level`,
        topLevel,
      });
    }
    return Object.freeze({ ok: true, dialect: "json-envelope", document: parsed, topLevel });
  }

  const table = readDelimitedText(source);
  if (!table.ok) {
    return Object.freeze({ ok: false, problem: table.problem });
  }
  const columns = table.header.map((name) => normalizeColumnName(name));
  const missing = REQUIRED_QUERY_SAMPLE_FIELDS.filter((field) =>
    !COLUMN_ALIASES[field].some((alias) => columns.includes(alias)));
  if (missing.length) {
    return refusal(QUERY_SAMPLE_CODES.UNRECOGNIZED_DIALECT, {
      expected: `a delimited gateway log carrying ${missing.join(", ")}`,
      observed: `a ${table.delimiterName}-separated file whose header is ${table.header.join(", ")}`,
      delimiter: table.delimiterName,
      columns: Object.freeze(columns),
      missing: Object.freeze(missing),
    });
  }
  return Object.freeze({ ok: true, dialect: "delimited-gateway-log", table, columns });
}

// --- row validation, shared by both dialects -------------------------------

/**
 * Validate one row's already-extracted values. `values` is `{ field: raw }`
 * with absent fields left off. Returns a record or a list of issues; a row
 * never half-lands.
 *
 * THE BOTH-PRESENT RULE: a row carrying an excerpt *and* a category is
 * rejected, not reconciled. The two statements can disagree about the same
 * query and this layer has no evidence with which to pick a winner; the
 * repository's dialect detector already refuses to resolve ambiguity by
 * declaration order, and silently preferring one would move a published grade
 * on a rule nobody read. It is a row-level refusal, so the rest of the file
 * still lands.
 */
export function validateQuerySampleRow(values, row) {
  const issues = [];
  const record = {};

  for (const field of REQUIRED_QUERY_SAMPLE_FIELDS) {
    const raw = values[field];
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
      issues.push(rowIssue(row, field, QUERY_SAMPLE_CODES.MISSING_REQUIRED_FIELD,
        `${field} is required and is empty`));
    }
  }
  if (issues.length) return Object.freeze({ ok: false, issues: Object.freeze(issues) });

  const orgUnitId = typeof values.org_unit_id === "string" ? values.org_unit_id.trim() : "";
  if (!ORG_UNIT_ID_PATTERN.test(orgUnitId)) {
    issues.push(rowIssue(row, "org_unit_id", QUERY_SAMPLE_CODES.INVALID_DEPARTMENT_KEY,
      "org_unit_id must be an HRIS org unit pseudonym of the form psn_ plus 16 to 64 identifier characters"));
  } else record.orgUnitId = orgUnitId;

  const queryDate = typeof values.query_date === "string" ? values.query_date.trim() : "";
  if (!validQueryDate(queryDate)) {
    issues.push(rowIssue(row, "query_date", QUERY_SAMPLE_CODES.INVALID_TIME_BUCKET,
      `query_date must be a real ${QUERY_SAMPLE_BUCKET_GRANULARITY} bucket in ${QUERY_DATE_FORMAT} form`));
  } else record.queryDate = queryDate;

  const model = typeof values.model_raw === "string" ? values.model_raw.trim() : "";
  if (!MODEL_ID_PATTERN.test(model)) {
    issues.push(rowIssue(row, "model_raw", QUERY_SAMPLE_CODES.INVALID_MODEL_IDENTIFIER,
      "model_raw must match the conservative model identifier shape the rubric declares"));
  } else record.model = model;

  for (const [field, key] of [["input_tokens", "inputTokens"], ["output_tokens", "outputTokens"]]) {
    const raw = values[field];
    const count = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isInteger(count) || count < 0) {
      issues.push(rowIssue(row, field, QUERY_SAMPLE_CODES.INVALID_TOKEN_COUNT,
        `${field} must be a non-negative whole number of tokens`));
    } else record[key] = count;
  }

  const excerpt = typeof values.prompt_excerpt === "string" ? values.prompt_excerpt.trim() : "";
  const category = typeof values.category === "string" ? values.category.trim() : "";
  if (excerpt && category) {
    issues.push(rowIssue(row, "category", QUERY_SAMPLE_CODES.AMBIGUOUS_CLASSIFICATION,
      "the row carries both prompt_excerpt and category; state exactly one, because this contract will not choose between two claims about the same query"));
  } else if (!excerpt && !category) {
    issues.push(rowIssue(row, "category", QUERY_SAMPLE_CODES.MISSING_CLASSIFICATION,
      "the row carries neither prompt_excerpt nor category; one of the two is required"));
  } else if (excerpt) {
    if (excerpt.length > MAX_PROMPT_EXCERPT_LENGTH) {
      issues.push(rowIssue(row, "prompt_excerpt", QUERY_SAMPLE_CODES.EXCERPT_TOO_LONG,
        `prompt_excerpt must be at most ${MAX_PROMPT_EXCERPT_LENGTH} characters; a longer value is a prompt body, which this contract refuses`));
    } else {
      record.promptExcerpt = excerpt;
      record.category = null;
    }
  } else if (!QUERY_SAMPLE_CATEGORIES.includes(category)) {
    issues.push(rowIssue(row, "category", QUERY_SAMPLE_CODES.UNKNOWN_CATEGORY,
      `category must be one of ${QUERY_SAMPLE_CATEGORIES.join(", ")}`));
  } else {
    record.category = category;
    record.promptExcerpt = null;
  }

  if (issues.length) return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  return Object.freeze({
    ok: true,
    record: Object.freeze({
      row,
      orgUnitId: record.orgUnitId,
      queryDate: record.queryDate,
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      category: record.category,
      promptExcerpt: record.promptExcerpt,
    }),
  });
}

// --- the two dialect readers -----------------------------------------------

function readDelimitedSample(detection) {
  const { table, columns } = detection;
  const refused = refusedColumn(columns);
  if (refused) {
    return refusal(QUERY_SAMPLE_CODES.REFUSED_COLUMN, {
      column: refused.column,
      reason: refused.reason,
      detail: `column “${refused.column}” ${refused.reason}, so the file is refused whole rather than partly kept`,
    });
  }
  const index = new Map();
  columns.forEach((name, position) => {
    if (name && !index.has(name)) index.set(name, position);
  });
  const positions = {};
  const mapped = new Set();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const alias = aliases.find((candidate) => index.has(candidate));
    if (alias === undefined) continue;
    positions[field] = index.get(alias);
    mapped.add(index.get(alias));
  }
  // Unknown extra columns are ignored and reported, never a hard failure: the
  // delimited path follows `finops-tabular-import.js`, where a vendor's spare
  // column is normal and `unmappedColumns` is how it is surfaced.
  const notices = columns
    .map((name, position) => ({ name, position }))
    .filter(({ position, name }) => name && !mapped.has(position))
    .map(({ name }) => rowIssue(null, name, QUERY_SAMPLE_CODES.UNMAPPED_COLUMN,
      `column “${name}” is not part of this contract and was ignored`));

  const rows = table.rows.map((record) => {
    const values = {};
    for (const [field, position] of Object.entries(positions)) {
      const raw = record.values[position];
      if (raw !== undefined && String(raw).trim() !== "") values[field] = String(raw).trim();
    }
    return { values, row: record.row };
  });
  return Object.freeze({
    ok: true,
    dialect: "delimited-gateway-log",
    delimiter: table.delimiterName,
    columns: Object.freeze([...columns]),
    snapshot: null,
    rows,
    notices,
  });
}

function readJsonSample(detection, { lastAcceptedSequence = null } = {}) {
  const document = detection.document;
  const unknown = Object.keys(document).find((key) => !ENVELOPE_KEYS.includes(key));
  if (unknown) {
    const reason = REFUSED_COLUMNS[normalizeColumnName(unknown)];
    if (reason) {
      return refusal(QUERY_SAMPLE_CODES.REFUSED_COLUMN, {
        column: unknown,
        reason,
        detail: `field “${unknown}” ${reason}, so the file is refused whole rather than partly kept`,
      });
    }
    return refusal(QUERY_SAMPLE_CODES.UNKNOWN_FIELD, {
      column: unknown,
      detail: `the envelope carries undeclared field “${unknown}”`,
    });
  }
  if (document.kind !== QUERY_SAMPLE_CONTRACT_KIND
    || !SUPPORTED_QUERY_SAMPLE_SCHEMA_VERSIONS.includes(document.schema_version)) {
    return refusal(QUERY_SAMPLE_CODES.UNSUPPORTED_CONTRACT, {
      expected: `kind ${QUERY_SAMPLE_CONTRACT_KIND} at version `
        + SUPPORTED_QUERY_SAMPLE_SCHEMA_VERSIONS.join(" or "),
      observed: `kind ${String(document.kind)} at version ${String(document.schema_version)}`,
    });
  }
  const missing = ENVELOPE_KEYS.find((key) => !(key in document));
  if (missing) {
    return refusal(QUERY_SAMPLE_CODES.MISSING_REQUIRED_FIELD, {
      column: missing, detail: `the envelope is missing required field “${missing}”` });
  }
  const snapshot = document.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || SNAPSHOT_KEYS.some((key) => !(key in snapshot))
    || snapshot.bucket_granularity !== QUERY_SAMPLE_BUCKET_GRANULARITY) {
    return refusal(QUERY_SAMPLE_CODES.UNSUPPORTED_CONTRACT, {
      expected: `a snapshot declaring bucket_granularity “${QUERY_SAMPLE_BUCKET_GRANULARITY}” `
        + `and ${SNAPSHOT_KEYS.join(", ")}`,
      observed: "a snapshot that does not",
    });
  }
  const privacy = document.privacy;
  if (!privacy || typeof privacy !== "object" || PRIVACY_KEYS.some((key) => !(key in privacy))
    || privacy.classification_site !== "browser-tab" || privacy.prompt_text_retained !== false
    || privacy.direct_identifiers_included !== false) {
    return refusal(QUERY_SAMPLE_CODES.UNSUPPORTED_CONTRACT, {
      expected: "a privacy block declaring browser-tab classification, no retained prompt text, and no direct identifiers",
      observed: "a privacy block that does not",
    });
  }
  if (!Array.isArray(document.records)) {
    return refusal(QUERY_SAMPLE_CODES.UNSUPPORTED_CONTRACT, {
      expected: "records as an array of query objects", observed: `records as ${typeof document.records}`,
    });
  }
  // Sequence, not arrival order, decides freshness — the rule the HRIS and
  // provider contracts already state for a re-delivered or reordered export.
  if (Number.isInteger(lastAcceptedSequence) && snapshot.sequence <= lastAcceptedSequence) {
    return refusal(QUERY_SAMPLE_CODES.STALE_DELIVERY, {
      expected: `a sequence above ${lastAcceptedSequence} from source ${snapshot.source_instance_id}`,
      observed: `sequence ${snapshot.sequence}`,
    });
  }

  const rows = [];
  const notices = [];
  for (const [position, record] of document.records.entries()) {
    const row = position + 1;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      rows.push({ values: {}, row });
      continue;
    }
    const unknownField = Object.keys(record).find((key) => !RECORD_KEYS.includes(key));
    if (unknownField) {
      const reason = REFUSED_COLUMNS[normalizeColumnName(unknownField)];
      if (reason) {
        return refusal(QUERY_SAMPLE_CODES.REFUSED_COLUMN, {
          column: unknownField,
          reason,
          detail: `record field “${unknownField}” ${reason}, so the file is refused whole rather than partly kept`,
        });
      }
      // Unknown record fields reject the file on the JSON path, following
      // `local-finops.js` and the schema's `additionalProperties: false`: a
      // declared envelope that grew a field is a contract change, not a stray
      // spreadsheet column.
      return refusal(QUERY_SAMPLE_CODES.UNKNOWN_FIELD, {
        column: unknownField,
        detail: `record ${row} carries undeclared field “${unknownField}”`,
      });
    }
    rows.push({ values: record, row });
  }
  return Object.freeze({
    ok: true,
    dialect: "json-envelope",
    delimiter: null,
    columns: Object.freeze([...RECORD_KEYS]),
    snapshot: Object.freeze({
      exportId: document.export_id,
      sourceInstanceId: snapshot.source_instance_id,
      sequence: snapshot.sequence,
      generatedAt: snapshot.generated_at,
      completeness: snapshot.completeness,
      omittedRecordCount: snapshot.omitted_record_count,
    }),
    rows,
    notices,
  });
}

/**
 * Parse a query sample of either dialect.
 *
 * Returns `{ ok: true, records, issues, ... }` where `records` is every row
 * that passed and `issues` is one located entry per row that did not, or
 * `{ ok: false, problem }` when the file itself is refused.
 *
 * Rows out of `query_date` order are accepted: 1.0 buckets by day and weights
 * every query once, so row order carries no meaning. It is counted and
 * reported as a notice rather than passed over in silence, because an
 * unexpectedly shuffled file is usually a concatenation the producer did not
 * mean to make.
 */
export function parseQuerySample(text, options = {}) {
  const detection = detectQuerySampleDialect(text);
  if (!detection.ok) return detection;
  const read = detection.dialect === "json-envelope"
    ? readJsonSample(detection, options)
    : readDelimitedSample(detection);
  if (!read.ok) return read;

  const records = [];
  const issues = [...read.notices];
  let outOfOrderRowCount = 0;
  let previousDate = null;
  for (const { values, row } of read.rows) {
    const result = validateQuerySampleRow(values, row);
    if (!result.ok) {
      issues.push(...result.issues);
      continue;
    }
    if (previousDate && result.record.queryDate < previousDate) {
      outOfOrderRowCount += 1;
      issues.push(rowIssue(row, "query_date", QUERY_SAMPLE_CODES.OUT_OF_ORDER_ROW,
        "query_date is earlier than the previous row; row order carries no meaning and the row was kept"));
    }
    previousDate = result.record.queryDate;
    records.push(result.record);
  }
  if (!records.length) {
    return refusal(QUERY_SAMPLE_CODES.NO_USABLE_ROWS, {
      expected: "at least one row satisfying every required field",
      observed: `${read.rows.length} row${read.rows.length === 1 ? "" : "s"}, none of which validated`,
      issues: Object.freeze(issues),
    });
  }
  return Object.freeze({
    ok: true,
    contract: QUERY_SAMPLE_CONTRACT_ID,
    dialect: read.dialect,
    delimiter: read.delimiter,
    columns: read.columns,
    snapshot: read.snapshot,
    records: Object.freeze(records),
    issues: Object.freeze(issues),
    skippedRowCount: read.rows.length - records.length,
    outOfOrderRowCount,
  });
}

// --- the redaction boundary, in code ---------------------------------------

/**
 * The one door out of the parsed shape, and the point past which no prompt text
 * exists.
 *
 * `classify` is the caller's browser-local classifier: it is handed the excerpt
 * and must return a rubric category key. The excerpt is never returned, stored,
 * or logged by this function, and the derived record is *built from an
 * allowlist* rather than copied-and-deleted — there is no excerpt key to leak
 * because nothing writes one. A row whose classifier returns an unrecognized
 * key is reported unclassified rather than guessed at, which is the rule the
 * rubric already states for its own input.
 *
 * The result's keys are exactly what `scorePromptLiteracy` reads, so a caller
 * can hand this straight to the rubric with nothing in between.
 */
export function classifyQuerySample(parsed, classify = () => null) {
  const records = [];
  const unclassified = [];
  for (const record of parsed?.records ?? []) {
    const category = record.category ?? classify(record.promptExcerpt);
    if (!QUERY_SAMPLE_CATEGORIES.includes(category)) {
      unclassified.push(rowIssue(record.row, "category", QUERY_SAMPLE_CODES.UNKNOWN_CATEGORY,
        "no rubric category was assigned to this row; it is reported, never guessed"));
      continue;
    }
    records.push(Object.freeze({
      orgUnitId: record.orgUnitId,
      queryDate: record.queryDate,
      model: record.model,
      category,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
    }));
  }
  return Object.freeze({
    contract: QUERY_SAMPLE_CONTRACT_ID,
    records: Object.freeze(records),
    unclassified: Object.freeze(unclassified),
  });
}

/** The keys a classified record may carry. Nothing here is free text. */
export const CLASSIFIED_RECORD_KEYS = Object.freeze([
  "orgUnitId", "queryDate", "model", "category", "inputTokens", "outputTokens",
]);
