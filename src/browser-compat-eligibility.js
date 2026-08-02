// The eligibility evaluator. Pure: text or parsed records in, verdict out. No
// DOM, no network, no storage, and — deliberately — no clock. Freshness is
// measured against a reference date the caller supplies, so the same file gives
// the same verdict on every machine on every day.
//
// Every shape judgment comes from browser-compat-contracts.js. There is no
// if-chain over provider names here; adding a fourth contract to the manifest
// changes the behaviour of this module without editing it.

import { DELIMITED_CODES, readDelimitedText } from "./delimited-text.js";
import {
  BROWSER_COMPAT_MANIFEST, DEGRADED_CODES, FIELD_ROLES, MANIFEST_VERSION,
  PRIVACY_POLICY, UNSUPPORTED_CODES, contractById,
} from "./browser-compat-contracts.js";

export const ELIGIBILITY_STATUS = Object.freeze({
  SUPPORTED: "supported",
  DEGRADED: "degraded",
  REJECTED: "rejected",
  NO_MATCH: "no-match",
});

export const NO_MATCH_CODE = "no_contract_matched";

// ---------------------------------------------------------------- parsing

// Flattens one record to dot-separated paths. CSV column names keep their own
// punctuation ("lineItem/UnblendedCost") because they are already flat.
function flatten(value, prefix, into) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value)) {
      flatten(nested, prefix ? `${prefix}.${key}` : key, into);
    }
    return into;
  }
  if (prefix) into[prefix] = value;
  return into;
}

const jsonLines = (text) => String(text).split("\n")
  .map((line) => line.trim()).filter(Boolean);

/**
 * Reads one export file into the normalized form the evaluator consumes:
 * { ok, format, fieldNames, records }. Delimited files go through the intake's
 * existing reader rather than a second CSV parser written for this path.
 */
export function parseExportText(text, fileName = "") {
  const source = String(text ?? "");
  const name = String(fileName ?? "").toLowerCase();
  const trimmed = source.trim();
  let format = name.endsWith(".jsonl") || name.endsWith(".ndjson") ? "jsonl"
    : name.endsWith(".json") ? "json"
      : name.endsWith(".csv") || name.endsWith(".tsv") ? "csv" : null;
  if (!format) {
    format = trimmed.startsWith("{") || trimmed.startsWith("[")
      ? (jsonLines(trimmed).length > 1 ? "jsonl" : "json") : "csv";
  }
  try {
    if (format === "jsonl") {
      const records = jsonLines(trimmed).map((line) => flatten(JSON.parse(line), "", {}));
      return normalized("jsonl", records);
    }
    if (format === "json") {
      const envelope = JSON.parse(trimmed || "null");
      const rows = envelope?.properties?.rows ?? envelope?.rows ?? envelope?.records;
      if (!Array.isArray(rows)) {
        return { ok: false, format, problem: "unreadable-structure", fieldNames: [], records: [] };
      }
      return normalized("json", rows.map((row) => flatten(row, "", {})));
    }
  } catch {
    return { ok: false, format, problem: "unreadable-structure", fieldNames: [], records: [] };
  }
  const reading = readDelimitedText(source);
  if (!reading.ok) {
    // An empty delimited file is not a parse failure the reader needs to hear
    // about twice: it is the contract's empty case, so it is handed on as a
    // zero-record CSV and rejected by code below.
    return reading.problem?.code === DELIMITED_CODES.EMPTY_FILE
      ? normalized("csv", [], [])
      : { ok: false, format: "csv", problem: "unreadable-structure", fieldNames: [], records: [] };
  }
  const header = reading.header.map((cell) => String(cell ?? "").trim());
  const records = reading.rows.map(({ values }) =>
    Object.fromEntries(header.map((column, index) => [column, values[index]])));
  return normalized("csv", records, header);
}

function normalized(format, records, header = null) {
  const fieldNames = header ?? [...new Set(records.flatMap((record) => Object.keys(record)))];
  return { ok: true, format, fieldNames, records };
}

// ---------------------------------------------------------------- helpers

const DAY = 86_400_000;
const lastSegment = (path) => String(path).split(/[./]/).pop().toLowerCase();

// Strict, locale-free: only a leading ISO calendar date counts, and it is read
// as UTC so day arithmetic never depends on where the browser is.
function utcDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const stamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(stamp) ? stamp : null;
}

const finite = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const present = (record, path) => {
  const value = record[path];
  return value !== undefined && value !== null && String(value).trim() !== "";
};

const byRole = (contract, role) =>
  contract.requiredFields.find((field) => field.role === role) ?? null;

/**
 * Which contract does this file claim to be? Driven entirely by the manifest's
 * declared format and signature fields. Ambiguity is not resolved by picking the
 * nearest one — two matches is no match, exactly as zero is.
 */
export function detectContract(parsed, manifest = BROWSER_COMPAT_MANIFEST) {
  const names = new Set((parsed?.fieldNames ?? []).map((name) => String(name)));
  const matches = manifest.contracts.filter((entry) =>
    entry.exportShape.format === parsed?.format
    && entry.exportShape.signatureFields.every((field) => names.has(field)));
  return matches.length === 1 ? matches[0] : null;
}

const caseFor = (list, code) => list.find((entry) => entry.code === code) ?? null;

function rejection(contract, code, extra = {}) {
  const found = caseFor(contract.unsupportedCases, code);
  return {
    status: ELIGIBILITY_STATUS.REJECTED,
    providerId: contract.providerId,
    displayName: contract.displayName,
    contractVersion: contract.contractVersion,
    code,
    reason: found.reason,
    remedy: found.remedy,
    cases: [{ code, status: ELIGIBILITY_STATUS.REJECTED, statement: found.reason, ...extra }],
    notes: [],
    recordCount: 0,
    skippedRows: 0,
    ...extra,
  };
}

// ---------------------------------------------------------------- evaluator

/**
 * @param {object} parsed  output of parseExportText, or an equivalent
 *   { format, fieldNames, records } shape.
 * @param {object} options
 *   referenceDate — ISO calendar date the freshness window is measured against.
 *     Omit it and freshness is reported as not evaluated; nothing here ever
 *     reads the wall clock.
 *   expectedProviderId — the contract the reader said they were submitting.
 *     Supplying it is what makes "wrong provider's export" distinguishable
 *     from "unrecognized file".
 */
export function evaluateExport(parsed, { referenceDate, expectedProviderId } = {}) {
  const expected = expectedProviderId ? contractById(expectedProviderId) : null;
  const detected = parsed?.ok === false ? null : detectContract(parsed);
  const records = parsed?.records ?? [];

  if (detected && expected && detected.providerId !== expected.providerId) {
    return Object.freeze({
      manifestVersion: MANIFEST_VERSION,
      ...rejection(expected, UNSUPPORTED_CODES.WRONG_PROVIDER, {
        detectedProviderId: detected.providerId,
        detectedDisplayName: detected.displayName,
      }),
    });
  }
  // Falling back to the expected contract only when nothing was detected AND
  // the file carries no records is what lets an empty file be reported as this
  // provider's empty case instead of an anonymous no-match. A file with records
  // that matched nothing stays a no-match: it is never attributed by guess.
  const contract = detected ?? (expected && records.length === 0 ? expected : null);
  if (!contract) {
    return Object.freeze({
      manifestVersion: MANIFEST_VERSION,
      status: ELIGIBILITY_STATUS.NO_MATCH,
      providerId: null,
      displayName: null,
      contractVersion: null,
      code: NO_MATCH_CODE,
      reason: "This file does not match any published compatibility contract. "
        + "It has not been attributed to the closest-looking provider.",
      remedy: "Compare the file against the required fields listed for each "
        + "provider above, then export the named usage or billing view.",
      cases: [], notes: [], recordCount: records.length, skippedRows: 0,
    });
  }

  const names = new Set((parsed.fieldNames ?? []).map((name) => String(name)));
  const banned = [...names].find((name) =>
    PRIVACY_POLICY.prohibitedFieldNames.includes(lastSegment(name)));
  if (banned) {
    return Object.freeze({ manifestVersion: MANIFEST_VERSION,
      ...rejection(contract, UNSUPPORTED_CODES.PROMPT_CONTENT, { prohibitedField: banned }) });
  }
  if (records.length === 0) {
    return Object.freeze({ manifestVersion: MANIFEST_VERSION,
      ...rejection(contract, UNSUPPORTED_CODES.EMPTY) });
  }

  const model = byRole(contract, FIELD_ROLES.MODEL);
  const missing = contract.requiredFields.filter((field) => !names.has(field.path));
  if (missing.length === 1 && missing[0].path === model.path) {
    return Object.freeze({ manifestVersion: MANIFEST_VERSION,
      ...rejection(contract, UNSUPPORTED_CODES.ROLLUP_ONLY, { missingFields: [model.path] }) });
  }
  if (missing.length) {
    return Object.freeze({ manifestVersion: MANIFEST_VERSION,
      ...rejection(contract, UNSUPPORTED_CODES.UNMODELED_VARIANT, {
        missingFields: missing.map((field) => field.path) }) });
  }

  const timestamp = byRole(contract, FIELD_ROLES.TIMESTAMP);
  const units = byRole(contract, FIELD_ROLES.UNITS);
  const cost = byRole(contract, FIELD_ROLES.COST);
  const readable = [];
  let skippedRows = 0;
  for (const record of records) {
    const day = utcDay(record[timestamp.path]);
    const usable = day !== null
      && contract.requiredFields.every((field) => present(record, field.path))
      && finite(record[units.path]) !== null && finite(record[cost.path]) !== null;
    if (usable) readable.push(day); else skippedRows += 1;
  }
  if (!readable.length) {
    return Object.freeze({ manifestVersion: MANIFEST_VERSION,
      ...rejection(contract, UNSUPPORTED_CODES.EMPTY, { skippedRows }) });
  }

  const cases = [];
  const notes = [];
  const fire = (code, detail) => {
    const found = caseFor(contract.degradedCases, code);
    const entry = { code, status: found.resultStatus, statement: found.behavior, ...detail };
    if (found.resultStatus === ELIGIBILITY_STATUS.SUPPORTED) notes.push(entry);
    else cases.push(entry);
  };

  // Declaration order in the manifest is the reporting order, so the primary
  // code a caller reads is not an accident of check order in this function.
  const sorted = [...readable].sort((left, right) => left - right);
  const distinct = new Set(sorted);
  const spanDays = (sorted[sorted.length - 1] - sorted[0]) / DAY + 1;
  const missingDays = spanDays - distinct.size;
  if (missingDays > 0) fire(DEGRADED_CODES.PARTIAL, { missingDays });

  const latestRecordDate = new Date(sorted[sorted.length - 1]).toISOString().slice(0, 10);
  const reference = utcDay(referenceDate);
  let ageDays = null;
  if (reference !== null) {
    ageDays = Math.round((reference - sorted[sorted.length - 1]) / DAY);
    if (ageDays > contract.exportShape.freshnessWindowDays) {
      fire(DEGRADED_CODES.STALE, {
        ageDays, latestRecordDate, windowDays: contract.exportShape.freshnessWindowDays });
    }
  }
  if (skippedRows > 0) fire(DEGRADED_CODES.MALFORMED_ROWS, { skippedRows });
  if (readable.some((day, index) => index > 0 && day < readable[index - 1])) {
    fire(DEGRADED_CODES.REORDERED, {});
  }

  return Object.freeze({
    manifestVersion: MANIFEST_VERSION,
    status: cases.length ? ELIGIBILITY_STATUS.DEGRADED : ELIGIBILITY_STATUS.SUPPORTED,
    providerId: contract.providerId,
    displayName: contract.displayName,
    contractVersion: contract.contractVersion,
    code: cases.length ? cases[0].code : null,
    reason: cases.length ? cases[0].statement
      : `Every record matches the ${contract.displayName} contract.`,
    remedy: null,
    cases, notes,
    recordCount: records.length,
    acceptedRows: readable.length,
    skippedRows,
    missingDays: Math.max(0, missingDays),
    latestRecordDate,
    ageDays,
    freshnessEvaluated: reference !== null,
  });
}
