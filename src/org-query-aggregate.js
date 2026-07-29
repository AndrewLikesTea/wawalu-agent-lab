// The sanitized aggregate: the only thing a local query sample sends downstream.
//
// WHY THIS EXISTS. `org-query-source.js` says which local files may be read and
// hands back validated records. `org-query-scoring.js` classifies those records
// and drops every excerpt at `classifyRecords`. What neither of them had was a
// *named, bounded, serializable object* that is the whole of what leaves the
// reading layer — so "only the aggregate reaches the decision model" was a
// property of who happened to read which field, not a shape anyone could point
// at, digest, or assert against.
//
// This module is that shape. An aggregate is counts on a grid: per organization
// unit, per UTC day, per model, per rubric category, plus the intake provenance
// of the files those counts came from. It is built from allowlists — every cell
// is constructed key by key from `ORG_QUERY_CELL_KEYS` and friends rather than
// copied from a record and pruned — so there is no key a prompt, a credential,
// or a customer identifier could survive in. `assertOrgQueryAggregateRedacted`
// re-checks that from the outside, and the suite runs it on every fixture.
//
// CANONICAL FORM AND THE DIGEST. Two readers disputing a grade need to learn in
// one line whether they are arguing about the same sample. That is what the
// digest is for, and it is only worth anything if it is a function of the
// *evidence* and not of the order the evidence happened to be assembled in.
// `orgQueryAggregateCanonicalForm` therefore sorts `cells`, `unclassifiedCells`
// and `intakeCells` by their documented cell keys and rebuilds every entry with
// its keys in a fixed order before anything serializes or digests it. Two
// aggregates that differ only in array order are the same aggregate and produce
// the same eight hex digits; `tests/org-query-aggregate.test.js` proves it
// directly rather than by inference from a scoring result.
//
// Determinism: no clock, no randomness, no iteration over an unordered map that
// escapes without a sort, and no I/O of any kind. This module imports no
// network or storage API and neither does anything it calls.

import {
  ORG_QUERY_SOURCE_CONTRACT_ID, orgQuerySourceById,
} from "./org-query-source.js";

/** Bump when a cell key, a cell value, the ceiling, or the canonical form moves. */
export const ORG_QUERY_AGGREGATE_VERSION = "org-query-aggregate/1.0.0";

/**
 * The identity of a classified cell: what makes two rows the same cell.
 *
 * These five are the documented cell key. `orgQueryAggregateCanonicalForm`
 * sorts by them in this order, and `orgQueryAggregate` merges rows that agree
 * on all five into one cell with a count.
 */
export const ORG_QUERY_CELL_KEYS = Object.freeze([
  "orgUnitId", "queryDate", "model", "category", "classifiedBy",
]);

/** What a classified cell counts. Numbers only; every one of them is a total. */
export const ORG_QUERY_CELL_VALUES = Object.freeze([
  "queries", "inputTokens", "outputTokens", "confidence",
]);

/** The identity of an unclassified cell. The reason is the classifier's code. */
export const ORG_QUERY_UNCLASSIFIED_CELL_KEYS = Object.freeze([
  "orgUnitId", "queryDate", "reason",
]);

export const ORG_QUERY_UNCLASSIFIED_CELL_VALUES = Object.freeze(["queries"]);

/**
 * The identity of an intake cell: which declared source, read as which dialect,
 * in which key space. Two files of the same source and dialect merge into one
 * cell, because the decision model is owed "what was read", not "how many times
 * the reader clicked the picker".
 */
export const ORG_QUERY_INTAKE_CELL_KEYS = Object.freeze([
  "sourceId", "dialect", "keySpace",
]);

export const ORG_QUERY_INTAKE_CELL_VALUES = Object.freeze([
  "grades", "files", "records", "skippedRowCount", "outOfOrderRowCount",
]);

/**
 * The ceiling on a whole aggregate, counted in cells across all three arrays.
 *
 * An aggregate is meant to be smaller than the sample it summarizes. One that
 * is not is per-request evidence wearing a grid's clothing — a unit-day-model-
 * category tuple that repeats once per row is a row, and this contract refuses
 * rows. The refusal is recoverable locally: narrow the sample, or coarsen it.
 */
export const MAX_ORG_QUERY_AGGREGATE_CELLS = 20_000;

/** The longest a string value in an aggregate may be. A sentence is not a cell. */
export const MAX_AGGREGATE_STRING_LENGTH = 200;

/** Every reason this module refuses to build an aggregate. Stable codes. */
export const ORG_QUERY_AGGREGATE_CODES = Object.freeze({
  NO_SOURCE: "no_source",
  MALFORMED_SOURCE: "malformed_source",
  UNSUPPORTED_SOURCE: "unsupported_source",
  INCOMPATIBLE_CONTRACT: "incompatible_contract",
  MIXED_KEY_SPACE: "mixed_key_space",
  AGGREGATE_TOO_LARGE: "aggregate_too_large",
});

function refusal(code, message, recovery, extra = {}) {
  return Object.freeze({ ok: false, code, message, recovery, ...extra });
}

/**
 * Build the sanitized aggregate from validated results and their classification.
 *
 * @param {{results?: ReadonlyArray<object>, classification?: object}} input
 *   `results` are `validateOrgQuerySource` / `orgQuerySampleResult` results;
 *   `classification` is a `classifyRecords` output — records already past the
 *   redaction boundary, so no excerpt exists by the time this function runs.
 * @returns `{ ok: true, aggregate }`, or `{ ok: false, code, message, recovery }`
 *   with a code a surface switches on and a sentence a reader can act on
 *   without leaving the tab.
 *
 * The refusals are deliberately whole-selection rather than per-file. An
 * aggregate is one grid with one meaning; a selection that mixes key spaces
 * would join `psn_unit_0001` from a gateway log to a department label that
 * happens to read the same, and a digest over that grid would certify a join
 * nobody made.
 */
export function orgQueryAggregate({ results = [], classification = null } = {}) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) {
    return refusal(ORG_QUERY_AGGREGATE_CODES.NO_SOURCE,
      "No validated source was supplied, so there is nothing to aggregate.",
      "Choose a local conversation archive, gateway log, or representative prompt batch.");
  }

  const broken = list.find((entry) => entry?.ok !== true);
  if (broken) {
    return refusal(ORG_QUERY_AGGREGATE_CODES.MALFORMED_SOURCE,
      `One selected source did not validate (${broken?.code ?? "unknown reason"}), and a partly `
        + "read selection is never aggregated.",
      "Fix or deselect that file locally and choose the selection again.",
      { sourceId: broken?.sourceId ?? null });
  }

  const unsupported = list.find((entry) => !orgQuerySourceById(entry.sourceId));
  if (unsupported) {
    return refusal(ORG_QUERY_AGGREGATE_CODES.UNSUPPORTED_SOURCE,
      "One result names a source this registry does not declare, so its provenance cannot be "
        + "stated.",
      "Re-read the file through a declared source before aggregating it.",
      { sourceId: unsupported.sourceId ?? null });
  }

  const contracts = distinct(list.map((entry) => entry.registryContract ?? ORG_QUERY_SOURCE_CONTRACT_ID));
  if (contracts.length > 1) {
    return refusal(ORG_QUERY_AGGREGATE_CODES.INCOMPATIBLE_CONTRACT,
      `The selection was read under ${contracts.length} registry contract versions `
        + `(${contracts.join(", ")}), which do not share a grid.`,
      "Aggregate each contract version separately; a digest over both would describe neither.");
  }

  const keySpaces = distinct(list.map((entry) => entry.keySpace ?? null).filter(Boolean));
  if (keySpaces.length > 1) {
    return refusal(ORG_QUERY_AGGREGATE_CODES.MIXED_KEY_SPACE,
      `The selection mixes ${keySpaces.length} organization-unit key spaces `
        + `(${keySpaces.join(", ")}). The same unit id means different things in each, so merging `
        + "them would join units nobody joined.",
      "Import one key space at a time, or re-export so every file keys units the same way.",
      { keySpaces: Object.freeze(keySpaces) });
  }

  const cells = classifiedCells(classification?.records ?? []);
  const unclassifiedCells = declinedCells(classification?.unclassified ?? []);
  const intakeCells = sourceCells(list);
  const total = cells.length + unclassifiedCells.length + intakeCells.length;
  if (total > MAX_ORG_QUERY_AGGREGATE_CELLS) {
    return refusal(ORG_QUERY_AGGREGATE_CODES.AGGREGATE_TOO_LARGE,
      `This selection summarizes to ${total} cells, over the ${MAX_ORG_QUERY_AGGREGATE_CELLS} an `
        + "aggregate may carry. A grid that large is per-request evidence, not organizational "
        + "evidence.",
      "Narrow the sample — fewer days, fewer models, or fewer units per file — and choose it again.",
      { cellCount: total, ceiling: MAX_ORG_QUERY_AGGREGATE_CELLS });
  }

  const aggregate = Object.freeze({
    version: ORG_QUERY_AGGREGATE_VERSION,
    registryContract: contracts[0],
    classifierVersion: classification?.classifierVersion ?? null,
    keySpace: keySpaces[0] ?? null,
    cells: Object.freeze(cells),
    unclassifiedCells: Object.freeze(unclassifiedCells),
    intakeCells: Object.freeze(intakeCells),
    totals: Object.freeze({
      classified: cells.reduce((sum, cell) => sum + cell.queries, 0),
      unclassified: unclassifiedCells.reduce((sum, cell) => sum + cell.queries, 0),
      cellCount: total,
    }),
  });
  return Object.freeze({ ok: true, aggregate });
}

function distinct(values) {
  return [...new Set(values)].sort();
}

/**
 * Classified records folded onto the cell grid.
 *
 * Every cell is built key by key from the two allowlists. Token counts sum only
 * where every record in the cell carried one — a partial sum would be a number
 * nobody could reproduce from their own file — and confidence is the mean over
 * the cell, rounded, because a sum of confidences is not a quantity.
 */
function classifiedCells(records) {
  const grid = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const identity = cellIdentity(record, ORG_QUERY_CELL_KEYS);
    const key = identityString(identity);
    const cell = grid.get(key) ?? {
      ...identity, queries: 0, inputTokens: 0, outputTokens: 0,
      confidenceSum: 0, tokenGaps: 0,
    };
    cell.queries += 1;
    if (Number.isInteger(record?.inputTokens)) cell.inputTokens += record.inputTokens;
    else cell.tokenGaps += 1;
    if (Number.isInteger(record?.outputTokens)) cell.outputTokens += record.outputTokens;
    cell.confidenceSum += Number.isFinite(record?.confidence) ? record.confidence : 0;
    grid.set(key, cell);
  }
  return [...grid.values()].map((cell) => Object.freeze({
    ...cellIdentity(cell, ORG_QUERY_CELL_KEYS),
    queries: cell.queries,
    inputTokens: cell.tokenGaps ? null : cell.inputTokens,
    outputTokens: cell.tokenGaps ? null : cell.outputTokens,
    confidence: round2(cell.confidenceSum / cell.queries),
  }));
}

function declinedCells(entries) {
  const grid = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const identity = cellIdentity(entry, ORG_QUERY_UNCLASSIFIED_CELL_KEYS);
    const key = identityString(identity);
    const cell = grid.get(key) ?? { ...identity, queries: 0 };
    cell.queries += 1;
    grid.set(key, cell);
  }
  return [...grid.values()].map((cell) => Object.freeze({ ...cell }));
}

/**
 * The intake provenance: which declared source, read as what, how much of it
 * survived. `files` is a count, never a name — a file name is a reader's own
 * words and belongs on the surface they typed it into, not in a digested grid.
 */
function sourceCells(list) {
  const grid = new Map();
  for (const entry of list) {
    const identity = {
      sourceId: stringOrNull(entry.sourceId),
      dialect: stringOrNull(entry.dialect),
      keySpace: stringOrNull(entry.keySpace),
    };
    const key = identityString(identity);
    const cell = grid.get(key) ?? {
      ...identity,
      grades: stringOrNull(entry.grades),
      files: 0, records: 0, skippedRowCount: 0, outOfOrderRowCount: 0,
    };
    cell.files += 1;
    cell.records += Array.isArray(entry.records) ? entry.records.length : 0;
    cell.skippedRowCount += Number.isInteger(entry.skippedRowCount) ? entry.skippedRowCount : 0;
    cell.outOfOrderRowCount += Number.isInteger(entry.outOfOrderRowCount)
      ? entry.outOfOrderRowCount : 0;
    grid.set(key, cell);
  }
  return [...grid.values()].map((cell) => Object.freeze({ ...cell }));
}

function cellIdentity(source, keys) {
  const identity = {};
  for (const key of keys) identity[key] = normalizeIdentityValue(source?.[key]);
  return identity;
}

function normalizeIdentityValue(value) {
  return typeof value === "string" ? value : value === null || value === undefined ? null : String(value);
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

// A separator no organization-unit key, day bucket, model string, or rubric key
// can contain, so two different identities can never collapse onto one string.
const UNIT_SEPARATOR = "\u001f";

function identityString(identity) {
  return Object.values(identity).map((value) => (value === null ? "\u0000" : value))
    .join(UNIT_SEPARATOR);
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// --- canonical form ---------------------------------------------------------

/**
 * The aggregate in one canonical shape: sorted arrays, fixed key order.
 *
 * THIS IS THE FIX THE PRIOR REVIEW ASKED FOR. `cells`, `unclassifiedCells` and
 * `intakeCells` arrive in whatever order their producer walked its inputs —
 * which, for a merged multi-file selection, is the order the reader happened to
 * choose files in. Serializing that order would make the digest a statement
 * about the file picker. Each array is therefore sorted by its own documented
 * cell key, in the declared key order, and each entry is rebuilt from its
 * allowlist so `JSON.stringify` cannot vary with insertion order either.
 *
 * The sort is total: identical cell keys tie-break on the serialized value
 * tuple, so no two entries can compare equal and leave the order to the engine.
 *
 * @returns a plain, non-frozen object safe to `JSON.stringify` and to digest.
 */
export function orgQueryAggregateCanonicalForm(aggregate) {
  return {
    version: aggregate?.version ?? ORG_QUERY_AGGREGATE_VERSION,
    registryContract: aggregate?.registryContract ?? null,
    classifierVersion: aggregate?.classifierVersion ?? null,
    keySpace: aggregate?.keySpace ?? null,
    cells: canonicalArray(aggregate?.cells, ORG_QUERY_CELL_KEYS, ORG_QUERY_CELL_VALUES),
    unclassifiedCells: canonicalArray(aggregate?.unclassifiedCells,
      ORG_QUERY_UNCLASSIFIED_CELL_KEYS, ORG_QUERY_UNCLASSIFIED_CELL_VALUES),
    intakeCells: canonicalArray(aggregate?.intakeCells,
      ORG_QUERY_INTAKE_CELL_KEYS, ORG_QUERY_INTAKE_CELL_VALUES),
    totals: {
      classified: aggregate?.totals?.classified ?? 0,
      unclassified: aggregate?.totals?.unclassified ?? 0,
      cellCount: aggregate?.totals?.cellCount ?? 0,
    },
  };
}

function canonicalArray(entries, keys, values) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => canonicalEntry(entry, keys, values))
    .sort((left, right) => (left.__sort < right.__sort ? -1 : left.__sort > right.__sort ? 1 : 0))
    .map((entry) => entry.value);
}

function canonicalEntry(entry, keys, values) {
  const value = {};
  for (const key of keys) value[key] = normalizeIdentityValue(entry?.[key]);
  for (const key of values) {
    const raw = entry?.[key];
    value[key] = raw === undefined ? null : typeof raw === "number" ? raw : normalizeIdentityValue(raw);
  }
  // The key tuple decides the order; the value tuple only breaks a tie, so two
  // cells with the same key but different counts still sort deterministically.
  const keyPart = keys.map((key) => sortToken(value[key])).join(UNIT_SEPARATOR);
  const valuePart = values.map((key) => sortToken(value[key])).join(UNIT_SEPARATOR);
  return { __sort: `${keyPart}${UNIT_SEPARATOR}${UNIT_SEPARATOR}${valuePart}`, value };
}

function sortToken(value) {
  if (value === null) return "\u0000";
  // Fixed width and sign-aware, so 2 and 10 sort as numbers rather than as text.
  if (typeof value === "number") {
    return `${value < 0 ? "-" : "+"}${String(Math.abs(value)).padStart(20, "0")}`;
  }
  return value;
}

/**
 * The aggregate as eight hex digits: a stable 32-bit FNV-1a over its canonical
 * form. Not a security primitive and not claimed as one — it is the handle two
 * people compare to learn whether they are disputing the same sample or two
 * different exports.
 */
export function orgQueryAggregateDigest(aggregate) {
  const canonical = JSON.stringify(orgQueryAggregateCanonicalForm(aggregate));
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// --- the redaction assertion ------------------------------------------------

const ALLOWED_TOP_LEVEL = Object.freeze([
  "version", "registryContract", "classifierVersion", "keySpace",
  "cells", "unclassifiedCells", "intakeCells", "totals",
]);

const ALLOWED_TOTALS = Object.freeze(["classified", "unclassified", "cellCount"]);

/**
 * Assert from the outside that an aggregate carries nothing but the grid.
 *
 * The construction above already makes a leak impossible — every entry is built
 * key by key from an allowlist — so this is the second lock, not the first. It
 * is what a test asserts, and what a caller that received an aggregate from
 * somewhere it did not write can check before publishing it.
 *
 * @throws {Error} naming the offending path, never the offending value: an
 *   assertion that printed the prompt it caught would be the leak it prevents.
 */
export function assertOrgQueryAggregateRedacted(aggregate) {
  if (!aggregate || typeof aggregate !== "object") {
    throw new Error("org-query aggregate: not an object");
  }
  checkKeys("aggregate", aggregate, ALLOWED_TOP_LEVEL);
  checkKeys("aggregate.totals", aggregate.totals ?? {}, ALLOWED_TOTALS);
  checkCells("cells", aggregate.cells, ORG_QUERY_CELL_KEYS, ORG_QUERY_CELL_VALUES);
  checkCells("unclassifiedCells", aggregate.unclassifiedCells,
    ORG_QUERY_UNCLASSIFIED_CELL_KEYS, ORG_QUERY_UNCLASSIFIED_CELL_VALUES);
  checkCells("intakeCells", aggregate.intakeCells,
    ORG_QUERY_INTAKE_CELL_KEYS, ORG_QUERY_INTAKE_CELL_VALUES);
  return true;
}

function checkKeys(path, value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`org-query aggregate: ${path}.${key} is not declared`);
  }
}

function checkCells(name, entries, keys, values) {
  if (!Array.isArray(entries)) throw new Error(`org-query aggregate: ${name} is not an array`);
  const allowed = [...keys, ...values];
  entries.forEach((entry, index) => {
    checkKeys(`aggregate.${name}[${index}]`, entry, allowed);
    for (const [key, value] of Object.entries(entry)) {
      if (value === null || typeof value === "number") continue;
      if (typeof value !== "string") {
        throw new Error(`org-query aggregate: ${name}[${index}].${key} is neither a count nor a key`);
      }
      if (value.length > MAX_AGGREGATE_STRING_LENGTH) {
        throw new Error(`org-query aggregate: ${name}[${index}].${key} is longer than a key may be`);
      }
    }
  });
}
