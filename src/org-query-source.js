// The organizational query-source registry: which *local* files this product
// will read to learn what an organization asks its models, and on what terms.
//
// WHY THIS EXISTS. Two contracts already say how a query corpus is shaped —
// `query-sample-contract.js` reads a gateway log or a prompt batch,
// `conversation-export.js` reads an assistant's own conversation or audit
// export. Neither answers the question a reader asks before either of them
// runs: *which sources am I allowed to bring, what will this product do with
// one, and what will it never do?* That answer lived in three panels and zero
// versioned documents. This module is the one answer, versioned, and the import
// panel is painted from it rather than from authored prose.
//
// WHAT A SOURCE IS. A local export the reader already possesses. Every entry
// here is a file on the reader's own machine, chosen through a file picker, and
// read in the reader's own browser tab. There is no endpoint, no credential, no
// redirect, and no live connector in this registry, and `GUARANTEES` states
// that as data so a surface prints it rather than re-asserting it. Sources that
// *would* need a credential or a network call are declared too — in
// `UNSUPPORTED_SOURCES`, each with the reason and the local alternative — so
// asking for one is a described path rather than a dead end.
//
// WHAT EVERY SOURCE MUST STATE. Organization-unit attribution, a time bucket,
// a sampling bound, a provenance label, the contract and version it reads, and
// its behaviour for partial, stale, malformed, and reordered deliveries. A
// source that cannot state all seven is not a source; the contract test asserts
// each field on each entry, so an entry cannot ship half-declared.
//
// This module performs no I/O of any kind: no fetch, no storage, no clock, no
// randomness. Callers hand it a string they read locally. No message it emits
// carries a cell value; messages name sources, columns, codes, and counts.

import { CONVERSATION_CONTRACT_VERSION, parseConversationExport } from "./conversation-export.js";
import { CONVERSATION_DIALECT_PROFILES, UNGROUPED_DEPARTMENT } from "./dialect-profiles.js";
import { MAX_DELIMITED_BYTES, MAX_DELIMITED_ROWS, readDelimitedText } from "./delimited-text.js";
import { PROMPT_GRADING_THRESHOLDS } from "./prompt-grading-eligibility.js";
import {
  MAX_PROMPT_EXCERPT_LENGTH,
  QUERY_SAMPLE_CODES,
  QUERY_SAMPLE_CONTRACT_KIND,
  QUERY_SAMPLE_SCHEMA_VERSION,
  parseQuerySample,
} from "./query-sample-contract.js";

/** The contract's own identity. Consumers allowlist the exact version. */
export const ORG_QUERY_SOURCE_KIND = "wawalu.integration.org-query-source";
export const ORG_QUERY_SOURCE_VERSION = "1.0";
export const ORG_QUERY_SOURCE_CONTRACT_ID = `${ORG_QUERY_SOURCE_KIND}/${ORG_QUERY_SOURCE_VERSION}`;

/**
 * What is true of every source, stated once so no entry can quietly weaken it.
 * These are properties of the shipped code — this module imports no network or
 * storage API and neither does anything it calls — not aspirations on a page.
 */
export const ORG_QUERY_SOURCE_GUARANTEES = Object.freeze({
  credentials: false,
  network_calls: false,
  customer_data_transfer: false,
  prompt_content_persisted: false,
  prompt_content_rendered: false,
  processing: "the reader's own browser tab",
  file_selection: "a local file picker; the product never reaches a console, gateway, or directory",
  retained_from_a_source: Object.freeze([
    "counts per organization unit, day bucket, and model",
    "the derived rubric category of a query, never the query",
    "pseudonymous or reader-supplied organization-unit keys",
  ]),
  never_retained: Object.freeze([
    "the file itself",
    "prompt or completion text, including in an error message",
    "per-person, per-session, or per-request rows",
    "any credential, token, or endpoint",
  ]),
});

/** The sentence the panel prints above the source list. One place, one wording. */
export const ORG_QUERY_SOURCE_INTAKE_SENTENCE =
  "Every source below is a file you already have, read in this browser tab: no credential is used, "
  + "no service is contacted, nothing is uploaded, and no prompt text is stored or drawn on this page.";

/**
 * Attribution, stated once. A query that cannot be placed in an organization
 * unit is not organizational evidence, so attribution is required rather than
 * optional — an unattributed row is skipped and counted, never folded into a
 * total under a label the reader did not choose.
 */
const ATTRIBUTION = Object.freeze({
  required: true,
  unattributed_row: "skipped and counted; never merged into another unit",
  key_spaces: Object.freeze([
    Object.freeze({
      id: "org_pseudonym",
      note: "the HRIS org contract's `unit_id`, compared verbatim, never canonicalized",
    }),
    Object.freeze({
      id: "provider_unit",
      note: "the provider-native project, workspace, or account the bill is grouped by",
    }),
    Object.freeze({
      id: "source_label",
      note: "the department label the export itself carries; grouped as written, never parsed",
    }),
  ]),
});

/** The bucket, stated once. Day, for the reason the query-sample contract gives. */
const TIME_BUCKET = Object.freeze({
  granularity: "day",
  format: "YYYY-MM-DD",
  timezone: "UTC",
  why: "the rubric weights every sampled query once and publishes no time series, so an hour "
    + "bucket would carry precision no grade can use and would narrow the crowd one row hides in",
});

/**
 * Sampling bounds. A source is a *sample*, not a corpus: the ceilings below are
 * the ones the delimited reader already enforces, restated here so a producer
 * sizes their export before they build it rather than after it is refused.
 */
const SAMPLING = Object.freeze({
  max_bytes: MAX_DELIMITED_BYTES,
  max_rows: MAX_DELIMITED_ROWS,
  max_prompt_excerpt_chars: MAX_PROMPT_EXCERPT_LENGTH,
  selection: "the producer's own bounded sample; this contract never asks for a full corpus",
  gradeable_floor: Object.freeze({
    prompts_per_org_unit: PROMPT_GRADING_THRESHOLDS.minPromptsPerDepartment,
    classified_share: PROMPT_GRADING_THRESHOLDS.minClassifiedPromptShare,
    history_window_days: PROMPT_GRADING_THRESHOLDS.minHistoryWindowDays,
  }),
});

/**
 * Delivery behaviour, stated once because all three sources inherit the same
 * policy from the contracts beneath them: whole-file rejection for anything
 * that indicts the file, a counted row-level skip for anything wrong with one
 * row.
 */
const DELIVERY_BEHAVIOUR = Object.freeze({
  partial: Object.freeze({
    situation: "the source states it omitted records, or some rows fail validation.",
    behaviour: "accepted; the omitted count and one located issue per skipped row are carried "
      + "through, and the summary counts what was read rather than what was sent.",
    never: "a partial source is never presented as a complete one.",
  }),
  stale: Object.freeze({
    situation: "a delivery arrives at or below the last accepted sequence from the same source.",
    behaviour: "refused whole with `stale_delivery`; sequence decides freshness, never arrival.",
    never: "a re-delivered older snapshot never overwrites a newer one.",
  }),
  malformed: Object.freeze({
    situation: "the envelope, the header, or the quoting is unreadable.",
    behaviour: "refused whole, before a row is read, with the code and the coordinate.",
    never: "a malformed source is never partly parsed to see what it might have been.",
  }),
  reordered: Object.freeze({
    situation: "rows arrive out of day order, or columns in a different position.",
    behaviour: "kept. Columns are mapped by name; out-of-order rows are counted and reported, "
      + "because order carries no meaning to a day bucket but a shuffled file is usually an "
      + "unintended concatenation.",
    never: "a row is never dropped for its position.",
  }),
});

/** Every reason this registry refuses a source or a file. Stable codes. */
export const ORG_QUERY_SOURCE_CODES = Object.freeze({
  NO_SOURCE_SELECTED: "no_source_selected",
  UNKNOWN_SOURCE: "unknown_source",
  UNSUPPORTED_SOURCE: "unsupported_source",
  UNSUPPORTED_FORMAT: "unsupported_format",
  DIALECT_MISMATCH: "dialect_mismatch",
  UNRECOGNIZED_SOURCE_SHAPE: "unrecognized_source_shape",
  MISSING_ATTRIBUTION: "missing_attribution",
  EMPTY_SOURCE: "empty_source",
});

const CONVERSATION_DIALECT_IDS = Object.freeze(CONVERSATION_DIALECT_PROFILES.map((p) => p.id));

/**
 * The supported sources, in the order the panel lists them.
 *
 * `reads` binds an entry to the contract that validates it, and `dialect_ids`
 * to the shapes that contract recognizes — both asserted against the live
 * modules by `tests/org-query-source.test.js`, so a renamed dialect breaks the
 * build rather than silently orphaning an entry.
 */
const SOURCES = Object.freeze([
  Object.freeze({
    id: "local-conversation-archive",
    label: "Local conversation or audit archive",
    source_kind: "conversation-archive",
    summary: "An assistant's own conversation or admin audit export, already downloaded.",
    reads: Object.freeze({
      contract: "wawalu.integration.conversation-export",
      version: CONVERSATION_CONTRACT_VERSION,
      module: "src/conversation-export.js",
    }),
    dialect_ids: CONVERSATION_DIALECT_IDS,
    accepted_extensions: Object.freeze([".csv", ".tsv", ".txt"]),
    attribution: Object.freeze({
      field: "department",
      key_space: "source_label",
      required: true,
      note: `a row with no department is grouped as “${UNGROUPED_DEPARTMENT}” and counted; a file `
        + "with no department column at all is incomplete for this purpose and is reported as such",
    }),
    time_bucket: Object.freeze({ field: "occurred_at", granularity: "day", derived: "UTC calendar day of the timestamp" }),
    sampling: Object.freeze({ bounded_by: "rows and bytes", excerpt_admitted: false }),
    provenance: Object.freeze({
      label: "Local conversation archive",
      detail: "Read in this tab. Prompt bodies are measured and discarded inside the parser; "
        + "no prompt text leaves it.",
    }),
    grades: "attribution_and_volume",
    grades_note: "carries no token counts or rubric category, so it places and counts queries "
      + "rather than grading them; pair it with a gateway log or prompt batch for a literacy grade",
  }),
  Object.freeze({
    id: "gateway-proxy-log",
    label: "Gateway or proxy log export",
    source_kind: "gateway-log",
    summary: "A delimited export from the LLM gateway or proxy the organization already runs.",
    reads: Object.freeze({
      contract: QUERY_SAMPLE_CONTRACT_KIND,
      version: QUERY_SAMPLE_SCHEMA_VERSION,
      module: "src/query-sample-contract.js",
    }),
    dialect_ids: Object.freeze(["delimited-gateway-log"]),
    accepted_extensions: Object.freeze([".csv", ".tsv", ".txt"]),
    attribution: Object.freeze({
      field: "org_unit_id",
      key_space: "org_pseudonym_or_provider_unit",
      required: true,
      note: "decided once per file from the caller's grouping unit, never per row from the shape "
        + "of a cell",
    }),
    time_bucket: Object.freeze({ field: "query_date", granularity: "day", derived: null }),
    sampling: Object.freeze({ bounded_by: "rows and bytes", excerpt_admitted: true }),
    provenance: Object.freeze({
      label: "Gateway log sample",
      detail: "Read and classified in this tab. Any excerpt is discarded at the classifier; only "
        + "the derived category survives.",
    }),
    grades: "prompt_literacy",
    grades_note: "carries the four fields the rubric consumes, so it can drive a graded sample",
  }),
  Object.freeze({
    id: "representative-prompt-batch",
    label: "Representative prompt batch",
    source_kind: "prompt-batch",
    summary: "A JSON envelope of already-categorized representative queries, assembled by the "
      + "organization's own gateway owner.",
    reads: Object.freeze({
      contract: QUERY_SAMPLE_CONTRACT_KIND,
      version: QUERY_SAMPLE_SCHEMA_VERSION,
      module: "src/query-sample-contract.js",
    }),
    dialect_ids: Object.freeze(["json-envelope"]),
    accepted_extensions: Object.freeze([".json"]),
    attribution: Object.freeze({
      field: "org_unit_id",
      key_space: "org_pseudonym_or_provider_unit",
      required: true,
      note: "same key space and same verbatim comparison as the gateway log",
    }),
    time_bucket: Object.freeze({ field: "query_date", granularity: "day", derived: null }),
    sampling: Object.freeze({ bounded_by: "records and bytes", excerpt_admitted: true }),
    provenance: Object.freeze({
      label: "Representative prompt batch",
      detail: "Read in this tab. The envelope declares its own sequence and completeness, so a "
        + "re-delivery is reconciled rather than summed.",
    }),
    grades: "prompt_literacy",
    grades_note: "the bundled synthetic fixture is one of these, and it grades",
    bundled_fixture: "contracts/integrations/org-query-source/v1/fixtures/organizational-sample.json",
  }),
]);

/**
 * Sources a reader will genuinely ask for and this contract does not accept,
 * each with the reason and the local alternative. Every one of them is refused
 * for the same structural reason: it would require a credential, a network
 * call, or data this product refuses to hold.
 */
const UNSUPPORTED_SOURCES = Object.freeze([
  Object.freeze({
    id: "live-gateway-api",
    label: "Live gateway or proxy API",
    why: "it needs a credential and a network call, and this product makes neither.",
    do_instead: "Export a bounded sample from the gateway yourself and choose the file as a "
      + "gateway or proxy log export.",
  }),
  Object.freeze({
    id: "provider-admin-api",
    label: "Provider admin or usage API",
    why: "an admin key would be a production credential held by a page that promises to hold none.",
    do_instead: "Download the usage export from the provider console and use the provider-export "
      + "intake above.",
  }),
  Object.freeze({
    id: "hris-live-connector",
    label: "Live HRIS connector",
    why: "a directory connection transfers employee records continuously; this product reads one "
      + "pseudonymized file the reader chose.",
    do_instead: "Use the HRIS org export contract's pseudonymized file, produced on your side.",
  }),
  Object.freeze({
    id: "browser-session-capture",
    label: "Browser or endpoint session capture",
    why: "a capture is per-person, per-session evidence, which this contract refuses at any "
      + "granularity.",
    do_instead: "Ask the gateway owner for aggregate rows keyed by organization unit instead.",
  }),
  Object.freeze({
    id: "raw-prompt-dump",
    label: "Raw prompt or transcript dump",
    why: "full prompt bodies are refused whole: the redaction boundary rejects the file rather "
      + "than reading part of it.",
    do_instead: "Ask for categories, or excerpts within the declared excerpt limit, in a "
      + "representative prompt batch.",
  }),
]);

const CONTRACT = Object.freeze({
  manifest_version: ORG_QUERY_SOURCE_VERSION,
  kind: ORG_QUERY_SOURCE_KIND,
  published_at: "2026-07-29T00:00:00Z",
  fixture_data: "synthetic-only",
  guarantees: ORG_QUERY_SOURCE_GUARANTEES,
  attribution: ATTRIBUTION,
  time_bucket: TIME_BUCKET,
  sampling: SAMPLING,
  delivery_behaviour: DELIVERY_BEHAVIOUR,
  sources: SOURCES,
  unsupported_sources: UNSUPPORTED_SOURCES,
});

export {
  ATTRIBUTION as ORG_QUERY_ATTRIBUTION,
  CONTRACT as ORG_QUERY_SOURCE_CONTRACT,
  DELIVERY_BEHAVIOUR as ORG_QUERY_DELIVERY_BEHAVIOUR,
  SAMPLING as ORG_QUERY_SAMPLING,
  SOURCES as ORG_QUERY_SOURCES,
  TIME_BUCKET as ORG_QUERY_TIME_BUCKET,
  UNSUPPORTED_SOURCES as UNSUPPORTED_ORG_QUERY_SOURCES,
};

/** The document as plain JSON — the committed manifest is exactly these bytes. */
export function contractDocument() {
  return JSON.parse(JSON.stringify(CONTRACT));
}

export function orgQuerySourceById(id) {
  return SOURCES.find((entry) => entry.id === id) ?? null;
}

export function unsupportedOrgQuerySourceById(id) {
  return UNSUPPORTED_SOURCES.find((entry) => entry.id === id) ?? null;
}

function extensionOf(fileName) {
  const name = String(fileName ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
}

/**
 * Whether a selected source can read a selected file, decided from the declared
 * extensions alone. The shape layer still decides what the file actually is,
 * from its header or its envelope, never from its name — this is the cheap
 * check that lets the panel say "that source reads .csv" before a byte is read.
 */
export function orgQuerySourceCompatibility({ sourceId = null, fileName = "", mediaType = "" } = {}) {
  if (!sourceId) {
    return frozenStatus({
      status: "unselected",
      code: ORG_QUERY_SOURCE_CODES.NO_SOURCE_SELECTED,
      message: "No source is selected.",
      recovery: `Choose one of: ${SOURCES.map((entry) => entry.label).join(", ")}.`,
    });
  }
  const declined = unsupportedOrgQuerySourceById(sourceId);
  if (declined) {
    return frozenStatus({
      status: "unsupported",
      code: ORG_QUERY_SOURCE_CODES.UNSUPPORTED_SOURCE,
      sourceId,
      message: `${declined.label}: ${declined.why}`,
      recovery: declined.do_instead,
    });
  }
  const entry = orgQuerySourceById(sourceId);
  if (!entry) {
    return frozenStatus({
      status: "unknown",
      code: ORG_QUERY_SOURCE_CODES.UNKNOWN_SOURCE,
      sourceId,
      message: "That source is not declared by this contract.",
      recovery: `Choose one of: ${SOURCES.map((source) => source.id).join(", ")}.`,
    });
  }
  const extension = extensionOf(fileName);
  if (extension && !entry.accepted_extensions.includes(extension)) {
    return frozenStatus({
      status: "incompatible",
      code: ORG_QUERY_SOURCE_CODES.UNSUPPORTED_FORMAT,
      sourceId,
      message: `${entry.label} reads ${entry.accepted_extensions.join(", ")}; the chosen file is `
        + `${extension}.`,
      recovery: "Choose a file in one of the accepted formats, or choose the source that reads this one.",
    });
  }
  // A media type is advisory: a browser types a `.tsv` as `text/plain` as
  // readily as a `.txt`, so it is never the reason a file is refused here.
  return frozenStatus({
    status: "supported",
    code: null,
    sourceId,
    message: `${entry.label} is read in this tab, with no credential and no network call.`,
    recovery: "",
    mediaType: String(mediaType ?? ""),
  });
}

function frozenStatus(value) {
  return Object.freeze({ recovery: "", sourceId: null, ...value });
}

function failure(code, message, recovery, extra = {}) {
  return Object.freeze({ ok: false, code, message, recovery, issues: Object.freeze([]), ...extra });
}

/** The delimited table shape the conversation dialect layer consumes. */
function tableFrom(read) {
  return {
    delimiter: read.delimiter,
    headerRowIndex: 0,
    columns: [...read.header],
    rows: read.rows.map((record) => record.values.map((value) => String(value ?? "").trim())),
  };
}

/**
 * Read one local source as an organizational query sample.
 *
 * Returns `{ ok: true, records, issues, summary, ... }`, where `records` carry
 * an organization unit, a day bucket, and — where the source has them — the
 * token counts and rubric category a grade is computed from. On refusal it
 * returns `{ ok: false, code, message, recovery }` with a code a surface
 * switches on and a sentence a reader can act on locally.
 *
 * The text is a string the caller already read from a local file. Nothing here
 * opens, fetches, stores, or persists anything.
 */
export function validateOrgQuerySource(text, options = {}) {
  const { sourceId = null, fileName = "", mediaType = "" } = options;
  const compatibility = orgQuerySourceCompatibility({ sourceId, fileName, mediaType });
  if (compatibility.status !== "supported") {
    return failure(compatibility.code, compatibility.message, compatibility.recovery,
      { sourceId, status: compatibility.status });
  }
  const entry = orgQuerySourceById(sourceId);
  return entry.source_kind === "conversation-archive"
    ? readConversationArchive(text, entry)
    : readQuerySampleSource(text, entry, options);
}

/**
 * Read one local file as whichever declared source its *bytes* say it is.
 *
 * `validateOrgQuerySource` above answers "can this source read this file", which
 * is the question a panel with a source chooser asks. The intake path has no
 * chooser: it is handed a file the reader picked for the whole import and has to
 * decide what it is. This is that decision, and it is made from the file's own
 * envelope or header in a fixed order — the two query-sample shapes first,
 * because their required fields are the narrowest thing here, then the
 * conversation dialects, which match on their own identifier columns.
 *
 * A file that is neither is *not* an error this function invents a reason for:
 * it returns the refusal with `UNRECOGNIZED_SOURCE_SHAPE`, which is the caller's
 * signal to carry on treating the file as whatever it was going to treat it as
 * — a provider export, a roster, or a file for the mapping step. Nothing here
 * consumes a file another path was going to read.
 *
 * Oversized, malformed, and unreadable files come back with the code the reader
 * beneath assigned them (`file_too_large`, `too_many_rows`,
 * `malformed_quoted_field`, …) so the recovery names the actual fault.
 */
export function readOrgQuerySource(text, { fileName = "", mediaType = "" } = {}) {
  const sample = parseQuerySample(text);
  if (sample.ok) {
    const adapted = orgQuerySampleResult(sample);
    if (adapted) return adapted;
  }
  // A query-sample refusal that is *not* `unrecognized_dialect` means the file
  // was recognized as one of the two query-sample shapes and something in it is
  // wrong — a refused identifier column, rows none of which validated, a file
  // over the byte or row ceiling. That is this contract's file to report, and
  // reporting it beats letting it fall through to "we do not read this".
  if (!sample.ok && sample.problem?.code
    && sample.problem.code !== QUERY_SAMPLE_CODES.UNRECOGNIZED_DIALECT) {
    return failure(sample.problem.code,
      sample.problem.message
        ?? `This file reads as a query sample and was refused: expected `
          + `${sample.problem.expected ?? "a valid query sample"}, observed `
          + `${sample.problem.observed ?? "something else"}.`,
      "Fix the file locally and choose it again; nothing from it was read or kept.",
      { sourceId: null, issues: Object.freeze([...(sample.problem.issues ?? [])]) });
  }
  const archive = orgQuerySourceById("local-conversation-archive");
  const asArchive = readConversationArchive(text, archive);
  if (asArchive.ok) return asArchive;
  // Same rule for the archive half: a matched conversation dialect with no
  // attribution column, or with no usable row, is a fault worth naming. A file
  // that matched no dialect at all is simply not one of ours.
  if (asArchive.code === ORG_QUERY_SOURCE_CODES.MISSING_ATTRIBUTION
    || asArchive.code === ORG_QUERY_SOURCE_CODES.EMPTY_SOURCE) {
    return asArchive;
  }
  return failure(ORG_QUERY_SOURCE_CODES.UNRECOGNIZED_SOURCE_SHAPE,
    `No declared organizational query source reads ${fileName || "this file"}.`,
    `This contract reads ${SOURCES.map((source) => source.label).join(", ")}. `
      + "Export one of those shapes locally, or use this file with the intake it belongs to.",
    { sourceId: null, mediaType: String(mediaType ?? "") });
}

function readQuerySampleSource(text, entry, options) {
  const parsed = parseQuerySample(text, {
    groupingUnit: options.groupingUnit ?? null,
    lastAcceptedSequence: options.lastAcceptedSequence ?? null,
  });
  if (!parsed.ok) {
    const problem = parsed.problem ?? {};
    return failure(problem.code ?? ORG_QUERY_SOURCE_CODES.UNRECOGNIZED_SOURCE_SHAPE,
      problem.message ?? "The file could not be read as a query sample.",
      `Fix the file locally and choose it again, or choose a different source. ${entry.label} `
        + `reads the ${entry.dialect_ids.join(" or ")} shape.`,
      { sourceId: entry.id, issues: Object.freeze([...(problem.issues ?? [])]) });
  }
  // The dialect the file actually is, versus the one this source declares. A
  // gateway log chosen as a prompt batch is a mis-selected source, not a broken
  // file, and saying which one to pick is the whole point of the registry.
  if (!entry.dialect_ids.includes(parsed.dialect)) {
    const owner = SOURCES.find((source) => source.dialect_ids.includes(parsed.dialect));
    return failure(ORG_QUERY_SOURCE_CODES.DIALECT_MISMATCH,
      `${entry.label} reads the ${entry.dialect_ids.join(" or ")} shape; this file read as `
        + `${parsed.dialect}.`,
      owner ? `Choose “${owner.label}” instead.` : "Choose the source that declares this shape.",
      { sourceId: entry.id });
  }
  return orgQuerySampleResult(parsed, entry.id);
}

/**
 * An already-parsed query sample, adapted into this registry's result shape.
 *
 * The import surface parses a chosen file exactly once, through `parseQuerySample`
 * and with no grouping unit, because a reader who has brought a query sample and
 * no billing export has no provider grouping unit to supply. This function is
 * how that single parse becomes an organizational sample: it takes no options,
 * reads the source entry from the dialect the parse already recognized, and adds
 * nothing to the records but the registry's own provenance and summary.
 *
 * Returns null when the parse failed or when no declared source reads that
 * shape — a caller gets no half-result to mistake for a validated one.
 */
export function orgQuerySampleResult(parsed, sourceId = null) {
  if (!parsed?.ok) return null;
  const entry = orgQuerySourceById(sourceId)
    ?? SOURCES.find((source) => source.dialect_ids.includes(parsed.dialect))
    ?? null;
  if (!entry || !entry.dialect_ids.includes(parsed.dialect)) return null;
  const records = parsed.records.map((record) => Object.freeze({
    row: record.row,
    orgUnitId: record.orgUnitId,
    queryDate: record.queryDate,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    category: record.category,
    promptExcerpt: record.promptExcerpt,
  }));
  return result(entry, {
    dialect: parsed.dialect,
    contract: parsed.contract,
    keySpace: parsed.keySpace,
    snapshot: parsed.snapshot,
    records,
    issues: parsed.issues,
    skippedRowCount: parsed.skippedRowCount,
    outOfOrderRowCount: parsed.outOfOrderRowCount,
    parsed,
  });
}

function readConversationArchive(text, entry) {
  const read = readDelimitedText(text);
  if (!read.ok) {
    return failure(read.problem.code, read.problem.message,
      "Fix the file locally and choose it again.", { sourceId: entry.id });
  }
  const parsed = parseConversationExport(tableFrom(read));
  if (parsed.status !== "matched") {
    return failure(ORG_QUERY_SOURCE_CODES.UNRECOGNIZED_SOURCE_SHAPE,
      `No declared conversation dialect matched this file (${parsed.reason ?? "no match"}).`,
      `${entry.label} reads ${entry.dialect_ids.length} declared dialects; re-export from the `
        + "assistant's admin console, or choose a gateway or prompt-batch source instead.",
      { sourceId: entry.id });
  }
  // Attribution is required, so an export with no department column is
  // incomplete for this purpose even though it parsed perfectly well.
  if (!parsed.grouped) {
    return failure(ORG_QUERY_SOURCE_CODES.MISSING_ATTRIBUTION,
      "This archive carries no organization-unit column, so no query in it can be attributed.",
      "Re-export it with the department, team, or group column included; nothing here can infer one.",
      { sourceId: entry.id });
  }
  const records = parsed.records.map((record, index) => Object.freeze({
    row: index + 1,
    orgUnitId: record.department || UNGROUPED_DEPARTMENT,
    queryDate: String(record.occurred_at ?? "").slice(0, 10),
    model: null,
    inputTokens: null,
    outputTokens: null,
    category: null,
    promptExcerpt: null,
  })).filter((record) => record.queryDate.length === 10);
  if (!records.length) {
    return failure(ORG_QUERY_SOURCE_CODES.EMPTY_SOURCE,
      "No row in this archive carried both an organization unit and a usable timestamp.",
      "Check the department and timestamp columns, then choose the file again.",
      { sourceId: entry.id });
  }
  return result(entry, {
    dialect: parsed.profileId,
    contract: `${entry.reads.contract}/${entry.reads.version}`,
    keySpace: "source_label",
    snapshot: null,
    records,
    issues: parsed.skipped,
    skippedRowCount: parsed.skippedRowCount,
    outOfOrderRowCount: parsed.outOfOrderRowCount,
    parsed,
  });
}

function result(entry, value) {
  return Object.freeze({
    ok: true,
    sourceId: entry.id,
    sourceLabel: entry.label,
    registryContract: ORG_QUERY_SOURCE_CONTRACT_ID,
    provenance: entry.provenance,
    grades: entry.grades,
    ...value,
    records: Object.freeze(value.records),
    issues: Object.freeze([...(value.issues ?? [])]),
    summary: organizationalSampleSummary(value.records, entry),
  });
}

const MS_PER_DAY = 86_400_000;

/**
 * What the sample says about the organization, and whether it says enough.
 *
 * The floors are the prompt-grading thresholds, read from their own module
 * rather than restated: a sample that clears them is gradeable, and a sample
 * that does not gets a named shortfall per dimension instead of a verdict.
 */
export function organizationalSampleSummary(records = [], entry = null) {
  const list = Array.isArray(records) ? records : [];
  const counts = new Map();
  const buckets = new Set();
  let classified = 0;
  for (const record of list) {
    const unit = record?.orgUnitId;
    if (unit) counts.set(unit, (counts.get(unit) ?? 0) + 1);
    if (record?.queryDate) buckets.add(record.queryDate);
    if (record?.category || record?.promptExcerpt) classified += 1;
  }
  const days = [...buckets].map((day) => Date.parse(`${day}T00:00:00Z`)).filter(Number.isFinite);
  const windowDays = days.length
    ? Math.floor((Math.max(...days) - Math.min(...days)) / MS_PER_DAY) : 0;
  const classifiedShare = list.length ? classified / list.length : 0;
  const floor = SAMPLING.gradeable_floor;
  const orgUnits = [...counts.entries()]
    .map(([id, count]) => Object.freeze({ id, records: count }))
    .sort((left, right) => right.records - left.records || (left.id < right.id ? -1 : 1));

  const shortfalls = [];
  if (!orgUnits.some((unit) => unit.records >= floor.prompts_per_org_unit)) {
    shortfalls.push(shortfall("prompts_per_org_unit",
      orgUnits[0]?.records ?? 0, floor.prompts_per_org_unit,
      "no organization unit has enough sampled queries to be graded on its own"));
  }
  if (windowDays < floor.history_window_days) {
    shortfalls.push(shortfall("history_window_days", windowDays, floor.history_window_days,
      "the sample spans too few days to be more than one unusual week"));
  }
  // A source that carries no categories at all is not failing a floor; it is a
  // different kind of evidence, and saying otherwise would read as a defect.
  const gradesLiteracy = (entry?.grades ?? "prompt_literacy") === "prompt_literacy";
  if (gradesLiteracy && classifiedShare < floor.classified_share) {
    shortfalls.push(shortfall("classified_share", round(classifiedShare), floor.classified_share,
      "too much of the sample carries neither a category nor an excerpt to classify"));
  }
  return Object.freeze({
    recordCount: list.length,
    orgUnitCount: orgUnits.length,
    orgUnits: Object.freeze(orgUnits),
    bucketCount: buckets.size,
    buckets: Object.freeze([...buckets].sort()),
    windowDays,
    classifiedShare: round(classifiedShare),
    gradeable: gradesLiteracy && shortfalls.length === 0,
    gradesLiteracy,
    shortfalls: Object.freeze(shortfalls),
  });
}

function shortfall(dimension, observed, target, detail) {
  return Object.freeze({ dimension, observed, target, detail });
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * The guidance rows the panel paints, one source at a time. Fixed terms in a
 * fixed order, so the panel is a table of the same five questions for every
 * source rather than a paragraph per source.
 */
export function orgQuerySourceGuidance(entry) {
  if (!entry) return [];
  return Object.freeze([
    Object.freeze({ term: "What it is", detail: entry.summary }),
    Object.freeze({
      term: "Attributed by",
      detail: `${entry.attribution.field} (${entry.attribution.key_space}), required. `
        + `${entry.attribution.note}.`,
    }),
    Object.freeze({
      term: "Bucketed by",
      detail: `${entry.time_bucket.field}, one ${entry.time_bucket.granularity} bucket in `
        + `${TIME_BUCKET.timezone}${entry.time_bucket.derived ? ` — ${entry.time_bucket.derived}` : ""}.`,
    }),
    Object.freeze({
      term: "Accepted here",
      detail: `${entry.accepted_extensions.join(", ")}, at most ${SAMPLING.max_rows} rows and `
        + `${SAMPLING.max_bytes} bytes. Read as ${entry.reads.contract} ${entry.reads.version}.`,
    }),
    Object.freeze({
      term: "What it answers",
      detail: `${entry.provenance.label}: ${entry.grades_note}. ${entry.provenance.detail}`,
    }),
  ]);
}
