// Normalization of real provider CSV/TSV exports into the shipped v1 envelopes.
//
// The importer already accepts one thing: a v1 provider-usage or HRIS-org JSON
// envelope. Nobody's billing console emits that. This module is the translation
// layer between what providers actually hand a reader and what the shipped
// analysis consumes — and it is deliberately the *only* place that knows the
// difference. Its output goes through `parseLocalFinopsFile`, the same reviewed
// validator the JSON path uses, so a normalized CSV is accepted by the analysis
// on exactly the same terms as an uploaded envelope or it is not accepted at all.
//
// Three rules hold throughout:
//   1. Every failure is a code plus a coordinate. Downstream never string-matches
//      a message, and a message never carries a cell value.
//   2. Partial success is the normal case. A file with three bad dates yields the
//      other rows plus three located problems, not a dead end.
//   3. Nothing derived from the file is retained beyond column headers and
//      aggregate totals. Org-unit labels become pseudonyms before they enter the
//      envelope; no prompt, completion, or free-text column is ever read.
//
// This module performs no I/O of any kind: no fetch, no XHR, no beacon, no
// localStorage/sessionStorage/IndexedDB. Callers hand it a string that the page
// obtained from the local FileReader/Blob text API.

import {
  DELIMITED_CODES, MAX_DELIMITED_BYTES, MAX_DELIMITED_ROWS, readDelimitedText,
} from "./delimited-text.js";
import { ACCEPTED_LOCAL_FILE, LOCAL_KINDS, parseLocalFinopsFile } from "./local-finops.js";
import { recognizeIdentifier } from "./model-overspend-finding.js";
import {
  ABSENT, PROVIDER_USAGE_SCHEMA_VERSION, UNRECOGNIZED_TIER,
  carryableModelString, classifyModelTier, usageDetail,
} from "./provider-usage-record.js";
import { modelPseudonym, orgUnitPseudonym, unitDigest, unitKey } from "./unit-pseudonym.js";
import { NO_NATIVE_GROUPING, detectNativeGrouping } from "./native-grouping.js";
import { NATIVE_REQUIRED_FIELD_CODE, nativeContractForHeader } from "./native-provider-activation.js";
// The package layer: which vendor packages are supported, what a reader is told
// to ask for, and which containers are refused. Everything below reads those
// declarations rather than restating them — the accepted extensions, the
// accepted media types, the vendor a row is attributed to, and the sentence an
// undeclared file is refused with all come from the one versioned contract.
import {
  ACCEPTED_PACKAGE_EXTENSIONS, PROVIDER_PATTERNS, matchExportPackage,
} from "./provider-export-package.js";
// The multi-provider intake contract's sensitivity policy. A column it marks
// `reject` is refused here, at the header row, before a single cell is read —
// the one place a refusal can promise that no prompt or completion body was
// ever parsed, sampled, or rendered.
import { adapterForShape, adapterRemediation, screenSensitiveColumns } from "./multi-provider-intake.js";

export { MAX_DELIMITED_BYTES, MAX_DELIMITED_ROWS };

/** Every reason a delimited import can report. Stable; downstream switches on it. */
export const TABULAR_CODES = Object.freeze({
  ...DELIMITED_CODES,
  MISSING_REQUIRED_COLUMN: "missing_required_column",
  UNPARSEABLE_DATE: "unparseable_date",
  INVALID_AMOUNT: "invalid_amount",
  INVALID_QUANTITY: "invalid_quantity",
  UNSUPPORTED_CURRENCY: "unsupported_currency",
  MALFORMED_ROW: "malformed_row",
  MISSING_VALUE: "missing_value",
  NO_USABLE_ROWS: "no_usable_rows",
  GROUP_SIZE_ASSUMED: "group_size_assumed",
  CONTRACT_REJECTED: "contract_rejected",
  SENSITIVE_FIELD_PRESENT: "sensitive_field_present",
  NATIVE_REQUIRED_FIELD_INVALID: NATIVE_REQUIRED_FIELD_CODE,
});

/** Extensions the picker and the validator accept, from the package contract.
 * `.json` keeps its own path. */
export const ACCEPTED_DELIMITED_EXTENSIONS = ACCEPTED_PACKAGE_EXTENSIONS;

/** The `accept` attribute the file input ships, written once, here. */
export const LOCAL_FILE_ACCEPT = [
  ACCEPTED_LOCAL_FILE.extension, ...ACCEPTED_DELIMITED_EXTENSIONS,
  "application/json", "text/csv", "text/tab-separated-values", "text/plain",
].join(",");

// --- currency --------------------------------------------------------------

/**
 * ISO 4217 minor-unit exponents for the currencies these exports emit. Two is
 * the common case and the documented default, but it is not universal: a JPY
 * amount of 1200 is 1200 minor units, not 120000, and a KWD amount of 1.234 is
 * 1234. Hardcoding 100 would silently inflate or deflate those by 100×.
 */
export const CURRENCY_MINOR_UNITS = Object.freeze({
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, CHF: 2, SEK: 2, NOK: 2, DKK: 2,
  INR: 2, BRL: 2, MXN: 2, SGD: 2, ZAR: 2, PLN: 2, NZD: 2, HKD: 2, ILS: 2,
  JPY: 0, KRW: 0, CLP: 0, ISK: 0, VND: 0, PYG: 0, UGX: 0, XAF: 0, XOF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
});

export const DEFAULT_MINOR_UNIT_EXPONENT = 2;

/** The v1 analysis combines one currency; anything else is quarantined per row. */
export const ANALYSIS_CURRENCY = "USD";

export function minorUnitExponent(currency) {
  return CURRENCY_MINOR_UNITS[String(currency ?? "").trim().toUpperCase()]
    ?? DEFAULT_MINOR_UNIT_EXPONENT;
}

const AMOUNT_NOISE = /[$€£¥₹\s ']/g;

/**
 * Convert a printed amount to integer minor units.
 *
 * The value is scaled by string surgery and BigInt, never by multiplying a
 * float: `19.99 * 100` is 1998.9999999999998 in IEEE-754, and a total built from
 * thousands of those drifts visibly. Digits beyond the currency's exponent are
 * rounded **half-up, away from zero** — `0.125` USD is 13 minor units — which is
 * the rule a reader reconciling against an invoice expects.
 */
export function toMinorUnits(amount, currency = ANALYSIS_CURRENCY) {
  const exponent = minorUnitExponent(currency);
  let text = String(amount ?? "").trim().replace(AMOUNT_NOISE, "");
  if (text === "") return { ok: false, reason: "empty" };
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) text = text.slice(1);
  // Thousands separators only; a comma that is not grouping digits in threes is
  // a decimal comma this layer refuses to guess at.
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, reason: "not_a_number" };
  if (negative) return { ok: false, reason: "negative" };

  const [whole, fraction = ""] = text.split(".");
  const kept = fraction.slice(0, exponent).padEnd(exponent, "0");
  const dropped = fraction.slice(exponent);
  let scaled = BigInt(`${whole}${kept}`);
  if (dropped && Number(dropped[0]) >= 5) scaled += 1n;
  const value = Number(scaled);
  if (!Number.isSafeInteger(value)) return { ok: false, reason: "out_of_range" };
  return { ok: true, amountMinor: value, exponent, currency: String(currency).toUpperCase() };
}

// --- dates -----------------------------------------------------------------

const MONTH_NAMES = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
});

function isoDate(year, month, day) {
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  if (!Number.isFinite(stamp) || date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Resolve one printed date, and say which format matched.
 *
 * The ambiguous case is `03/04/2026`. The documented, tested rule is:
 * **a two-number date is read month-first (M/D/YYYY)** — the form the OpenAI,
 * Anthropic, and AWS consoles emit — **unless the first number exceeds 12**, in
 * which case month-first is impossible and it is read day-first (D/M/YYYY).
 * The rule is fixed. It is never inferred from neighbouring rows, so two files
 * with the same value always resolve the same way.
 */
export function parseExportDate(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: false, reason: "empty" };

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
    .exec(text);
  if (iso) {
    const date = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date
      ? { ok: true, date, format: iso[4] === undefined ? "iso_date" : "iso_datetime" }
      : { ok: false, reason: "not_a_calendar_date" };
  }

  const isoSlash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (isoSlash) {
    const date = isoDate(Number(isoSlash[1]), Number(isoSlash[2]), Number(isoSlash[3]));
    return date ? { ok: true, date, format: "iso_slash" } : { ok: false, reason: "not_a_calendar_date" };
  }

  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = Number(numeric[3]);
    const monthFirst = first <= 12;
    const date = monthFirst ? isoDate(year, first, second) : isoDate(year, second, first);
    return date
      ? { ok: true, date, format: monthFirst ? "numeric_month_first" : "numeric_day_first" }
      : { ok: false, reason: "not_a_calendar_date" };
  }

  const dayMonthName = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ -](\d{4})$/.exec(text);
  if (dayMonthName) {
    const month = MONTH_NAMES[dayMonthName[2].slice(0, 4).toLowerCase()]
      ?? MONTH_NAMES[dayMonthName[2].slice(0, 3).toLowerCase()];
    const date = month ? isoDate(Number(dayMonthName[3]), month, Number(dayMonthName[1])) : null;
    return date ? { ok: true, date, format: "day_month_name" } : { ok: false, reason: "unknown_month" };
  }

  const monthNameDay = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(text);
  if (monthNameDay) {
    const month = MONTH_NAMES[monthNameDay[1].slice(0, 4).toLowerCase()]
      ?? MONTH_NAMES[monthNameDay[1].slice(0, 3).toLowerCase()];
    const date = month ? isoDate(Number(monthNameDay[3]), month, Number(monthNameDay[2])) : null;
    return date ? { ok: true, date, format: "month_name_day" } : { ok: false, reason: "unknown_month" };
  }

  return { ok: false, reason: "unrecognized_format" };
}

// --- column mapping --------------------------------------------------------

/** Header matching tolerates case, padding, and separator style, nothing else. */
export function normalizeHeader(header) {
  return String(header ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const PROVIDER_COLUMN = Object.freeze({
  aliases: ["provider", "vendor", "service provider"], required: false,
});
const STATUS_COLUMN = Object.freeze({
  aliases: ["status", "cost status", "billing status", "invoice status"], required: false,
});
// Call counts. Optional on every shape, because plenty of exports omit them —
// but where one exists it is the only honest denominator for tokens per call
// and for the minimum-volume threshold the down-routing rule applies. Absent,
// the per-model analysis reports `calls: null` and lowers its confidence tier;
// it never substitutes a zero or a row count.
// The spellings below are the ones this repository supports, not a claim about
// what any one console emits: where a vendor's exact header is uncertain the
// variants are declared here rather than guessed into a single name.
const REQUESTS_COLUMN = Object.freeze({
  aliases: ["requests", "request count", "requests total", "n requests", "api requests",
    "calls", "call count", "num model requests", "num requests", "model requests"],
  required: false,
});

/**
 * One entry per recognized export shape. Adding a provider means adding a row
 * here, not branching somewhere in the parser.
 */
export const SHAPES = Object.freeze([
  Object.freeze({
    id: "openai_usage",
    label: "OpenAI usage export",
    kind: "provider",
    provider: "openai",
    // The package this shape reads, in `provider-export-package.js`. Asserted
    // both ways by the contract test, so a shape can never lose its guidance
    // and guidance can never describe a shape nobody normalizes.
    packageId: "openai-usage-export",
    columns: Object.freeze({
      date: { aliases: ["date", "usage date", "day", "start time", "timestamp"], required: true },
      orgUnit: {
        aliases: ["project name", "project", "organization", "organization id", "org unit",
          "department", "cost center"],
        required: true,
      },
      model: { aliases: ["model", "model id", "snapshot id"], required: true },
      amount: { aliases: ["amount", "amount usd", "cost", "total cost", "spend"], required: true },
      currency: { aliases: ["currency", "currency code"], required: false },
      inputTokens: {
        aliases: ["n context tokens total", "context tokens", "input tokens", "prompt tokens"],
        required: false,
      },
      outputTokens: {
        aliases: ["n generated tokens total", "generated tokens", "output tokens",
          "completion tokens"],
        required: false,
      },
      requests: REQUESTS_COLUMN,
      provider: PROVIDER_COLUMN,
      status: STATUS_COLUMN,
    }),
  }),
  Object.freeze({
    id: "anthropic_usage",
    label: "Anthropic usage export",
    kind: "provider",
    provider: "anthropic",
    packageId: "anthropic-usage-export",
    columns: Object.freeze({
      date: { aliases: ["date", "usage date", "day", "usage day"], required: true },
      orgUnit: {
        aliases: ["workspace", "workspace name", "org unit", "department", "cost center"],
        required: true,
      },
      model: { aliases: ["model", "model name"], required: true },
      amount: {
        aliases: ["cost usd", "amount", "cost", "total cost", "spend"], required: true,
      },
      currency: { aliases: ["currency", "currency code"], required: false },
      inputTokens: { aliases: ["input tokens", "uncached input tokens"], required: false },
      outputTokens: { aliases: ["output tokens"], required: false },
      requests: REQUESTS_COLUMN,
      provider: PROVIDER_COLUMN,
      status: STATUS_COLUMN,
    }),
  }),
  Object.freeze({
    id: "bedrock_usage",
    label: "Bedrock usage export",
    kind: "provider",
    provider: "aws",
    packageId: "aws-cost-and-usage-report",
    columns: Object.freeze({
      date: {
        aliases: ["lineitem usagestartdate", "line item usage start date", "usage start date",
          "bill billingperiodstartdate", "date"],
        required: true,
      },
      orgUnit: {
        aliases: ["resourcetags user costcenter", "resource tags user cost center",
          "resourcetags user department", "cost center", "department", "org unit"],
        required: true,
      },
      model: {
        aliases: ["lineitem productcode", "line item product code", "product productname",
          "lineitem operation", "model"],
        required: true,
      },
      amount: {
        aliases: ["lineitem unblendedcost", "line item unblended cost", "unblended cost",
          "amount", "cost"],
        required: true,
      },
      currency: {
        aliases: ["lineitem currencycode", "line item currency code", "currency", "currency code"],
        required: false,
      },
      quantity: {
        aliases: ["lineitem usageamount", "line item usage amount", "usage amount", "tokens"],
        required: false,
      },
      requests: REQUESTS_COLUMN,
      provider: PROVIDER_COLUMN,
      status: STATUS_COLUMN,
    }),
  }),
  Object.freeze({
    id: "org_roster",
    label: "Org roster",
    kind: "hris",
    packageId: "generic-hris-roster",
    columns: Object.freeze({
      orgUnit: {
        aliases: ["unit id", "org unit", "unit", "department", "team", "cost center", "unit name"],
        required: true,
      },
      parent: {
        aliases: ["parent", "parent unit", "parent department", "parent unit id", "reports to"],
        required: false,
      },
      unitType: { aliases: ["unit type", "type", "level"], required: false },
      active: { aliases: ["active", "is active", "status"], required: false },
    }),
  }),
]);

/**
 * Bind a shape's declared columns to the header row. Returns the resolved index
 * per canonical field, which required fields are absent, and how many declared
 * columns matched — the score the shape vote uses.
 */
function bindColumns(shape, header) {
  const normalized = header.map(normalizeHeader);
  const bound = {};
  const missing = [];
  let matched = 0;
  for (const [field, spec] of Object.entries(shape.columns)) {
    const index = spec.aliases.reduce((found, alias) => (
      found >= 0 ? found : normalized.indexOf(alias)
    ), -1);
    if (index >= 0) {
      bound[field] = index;
      matched += 1;
    } else if (spec.required) missing.push(field);
  }
  return { bound, missing, matched };
}

/** Highest matched-column count wins; ties break by declared shape order. */
export function detectShape(header) {
  const bindings = SHAPES.map((shape) => ({ shape, ...bindColumns(shape, header) }));
  const complete = bindings.filter((binding) => binding.missing.length === 0);
  const ranked = (complete.length ? complete : bindings)
    .map((binding, order) => ({ ...binding, order }))
    .sort((left, right) => right.matched - left.matched || left.order - right.order);
  const best = ranked[0];
  return { ...best, recognized: complete.length > 0 };
}

// --- pseudonyms ------------------------------------------------------------
//
// The digest and the two label pseudonyms live in `unit-pseudonym.js` so the
// native-grouping layer reuses this exact path rather than growing a second
// one. Rule 3 of this module is unchanged: no cell value survives
// normalization, and an org-unit or model label is a cell value.

const digestOf = unitDigest;
const unitId = orgUnitPseudonym;
const modelId = modelPseudonym;

function exportId(seed) {
  const hex = `${digestOf(seed)}${digestOf(`${seed}:tail`)}`;
  return [
    hex.slice(0, 8), hex.slice(8, 12), `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`, hex.slice(20, 32),
  ].join("-");
}

/**
 * Every delimited import declares the same source instance, because that is what
 * it is: one translation layer, not a provider's billing system. Two CSV periods
 * therefore reconcile into a trend with each other, and never silently merge with
 * a real provider export's source.
 */
export const DELIMITED_SOURCE_INSTANCE_ID = "psn_delimited_import_v1_0001";

// --- display labels --------------------------------------------------------
//
// The pseudonym above is the identity; the layer that decides what a READER
// sees over it lives in org-unit-display-label.js and is re-exported here,
// because "what is this unit called" is a question about the identity this
// module mints, and a caller should find it beside the thing it names.
//
// It is a separate file for one reason: this module and local-finops.js
// already import each other, and a composer reaching into that cycle from
// outside evaluates it in the wrong order. The label layer imports nothing, so
// nobody can pull the cycle in behind it.
//
// Nothing in that layer is persisted, uploaded, or exported. The labels are
// page state, passed down as an argument, and they die with the tab.
export {
  MAX_ORG_UNIT_DISPLAY_LABEL, NO_ORG_UNIT_LABELS,
  hasOrgUnitDisplayLabel, orgUnitDisplayName, withOrgUnitDisplayLabel,
} from "./org-unit-display-label.js";

// --- row classification ----------------------------------------------------

// Compiled from the package contract's `provider_patterns`, in declared order,
// so the vendor a package documents and the vendor its rows are attributed to
// are one statement rather than two lists that can disagree.
const PROVIDER_BY_PATTERN = PROVIDER_PATTERNS;

function mapProvider(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return PROVIDER_BY_PATTERN.find(([pattern]) => pattern.test(text))?.[1] ?? "other";
}

function mapServiceCategory(model) {
  const text = String(model ?? "");
  if (/embed/i.test(text)) return "embedding";
  if (/image|dall.?e|imagen|stable.?diffusion|canvas/i.test(text)) return "image-generation";
  if (/s3|storage|glacier|bucket/i.test(text)) return "storage";
  if (/text|gpt|claude|gemini|llama|titan|nova|chat|completion|invoke|bedrock/i.test(text)) {
    return "text-generation";
  }
  return "other";
}

const UNIT_TYPES = Object.freeze(["company", "division", "department", "team", "other"]);

function mapUnitType(value) {
  const text = normalizeHeader(value);
  return UNIT_TYPES.includes(text) ? text : "department";
}

function mapActive(value) {
  const text = normalizeHeader(value);
  if (text === "") return true;
  return !["false", "no", "0", "inactive", "terminated", "closed", "disabled"].includes(text);
}

function parseQuantity(value) {
  const text = String(value ?? "").trim().replace(/[\s,]/g, "");
  if (text === "") return { ok: true, quantity: 0 };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false };
  const quantity = Number(text);
  return Number.isFinite(quantity) ? { ok: true, quantity } : { ok: false };
}

// --- the result type -------------------------------------------------------

function makeProblem(code, { row = null, column = null, columnIndex = null, ...rest } = {}) {
  return Object.freeze({ code, row, column, columnIndex, ...rest });
}

function failure(problems, extra = {}) {
  return Object.freeze({
    ok: false, shape: null, parsed: null, columns: Object.freeze([]),
    rowCount: 0, acceptedRows: 0, skippedRows: 0, unrecognizedModelRows: 0,
    dateFormats: Object.freeze({}), totals: null,
    // Present on a failed read too: "this file could not be used" and "this is
    // how the file was grouped" are separate answers, and the review step needs
    // the second one to explain what the export already carried.
    nativeGrouping: NO_NATIVE_GROUPING,
    problems: Object.freeze(problems), ...extra,
  });
}

// A contract-required cell the normalizer could not read. `unsupported_currency`
// is deliberately absent: a foreign-currency row is a readable row that the
// envelope itself reports as omitted, with `completeness: "partial"` and a
// count — the reader is told. These five mean the required value was unusable,
// and the row disappears from the total with nothing on the envelope to say so.
const NATIVE_BLOCKING_CODES = Object.freeze([
  TABULAR_CODES.MALFORMED_ROW, TABULAR_CODES.UNPARSEABLE_DATE, TABULAR_CODES.MISSING_VALUE,
  TABULAR_CODES.INVALID_AMOUNT, TABULAR_CODES.INVALID_QUANTITY,
]);

/**
 * The two ways a native row can be read successfully and still not be the
 * export the contract describes. Both are silent in the general path, so the
 * native path looks for them by name.
 *
 * A date: `03/04/2026` parses, because this module's documented rule reads a
 * two-number date month-first. On a native export it means a spreadsheet round
 * trip, and the guessed month order can move spend into the wrong month — so
 * the native path takes the printed form the manifest names, "strict ISO
 * calendar date", and only that one.
 *
 * A currency: an empty cell in a currency column that the export *does* carry
 * would default to the analysis currency and join the USD total. The manifest
 * allows that default only when the column is absent from the file entirely.
 */
function nativePrintedFormProblem(binding, reading) {
  const at = (record, field) => record.values[binding.bound[field]] ?? "";
  const locate = (field, record, code) => ({
    row: record.row, column: reading.header[binding.bound[field]] ?? field,
    columnIndex: binding.bound[field] ?? null, code,
  });
  for (const record of reading.rows) {
    const resolved = parseExportDate(at(record, "date"));
    if (resolved.ok && resolved.format !== "iso_date") {
      return locate("date", record, `date_printed_as_${resolved.format}`);
    }
    if (binding.bound.currency !== undefined && String(at(record, "currency")).trim() === "") {
      return locate("currency", record, "currency_missing");
    }
  }
  return null;
}

function addDay(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

// --- normalization ---------------------------------------------------------

function normalizeProviderRows(shape, binding, reading, problems, options) {
  const { header, rows } = reading;
  const cell = (values, field) => {
    const index = binding.bound[field];
    return index === undefined ? "" : (values[index] ?? "");
  };
  const columnName = (field) => header[binding.bound[field]] ?? field;
  const dateFormats = {};
  const groups = new Map();
  // Per-model usage, folded in the same pass as the contract aggregates. The
  // v1 envelope has no model field and is not gaining one here; this travels
  // beside the document as analysis input, so the model dimension the reader's
  // own file carries is not thrown away before the routing rule can use it.
  // One Map lookup and four adds per accepted row, no allocation in the loop
  // beyond the accumulator a new (unit, model) pair creates once.
  const modelGroups = new Map();
  let accepted = 0;
  // Rows whose model string matched no declared tier rule. Counted per source
  // row, carried out on the result, and never silently coerced into a tier.
  let unrecognizedModelRows = 0;
  // Which of the v1.1 count columns this file has at all. A column the export
  // does not carry makes the field *absent* on every record it produces; a
  // column it does carry makes a genuine zero a zero.
  const hasInput = binding.bound.inputTokens !== undefined;
  const hasOutput = binding.bound.outputTokens !== undefined;
  const hasRequests = binding.bound.requests !== undefined;

  for (const record of rows) {
    if (record.values.length !== header.length) {
      problems.push(makeProblem(TABULAR_CODES.MALFORMED_ROW, {
        row: record.row, expected: header.length, observed: record.values.length,
      }));
      continue;
    }
    const resolved = parseExportDate(cell(record.values, "date"));
    if (!resolved.ok) {
      problems.push(makeProblem(TABULAR_CODES.UNPARSEABLE_DATE, {
        row: record.row, column: columnName("date"), columnIndex: binding.bound.date,
        reason: resolved.reason,
      }));
      continue;
    }
    const label = String(cell(record.values, "orgUnit")).trim();
    if (!label) {
      problems.push(makeProblem(TABULAR_CODES.MISSING_VALUE, {
        row: record.row, column: columnName("orgUnit"), columnIndex: binding.bound.orgUnit,
      }));
      continue;
    }
    const currency = String(cell(record.values, "currency") || ANALYSIS_CURRENCY)
      .trim().toUpperCase();
    const money = toMinorUnits(cell(record.values, "amount"), currency);
    if (!money.ok) {
      problems.push(makeProblem(TABULAR_CODES.INVALID_AMOUNT, {
        row: record.row, column: columnName("amount"), columnIndex: binding.bound.amount,
        reason: money.reason,
      }));
      continue;
    }
    // The v1 analysis refuses to add two currencies without a rate it can show.
    // The row is located and reported rather than converted behind the reader.
    if (currency !== ANALYSIS_CURRENCY) {
      problems.push(makeProblem(TABULAR_CODES.UNSUPPORTED_CURRENCY, {
        row: record.row,
        column: header[binding.bound.currency] ?? "currency",
        columnIndex: binding.bound.currency ?? null,
        observed: currency, expected: ANALYSIS_CURRENCY,
      }));
      continue;
    }
    const input = parseQuantity(cell(record.values, "inputTokens"));
    const output = parseQuantity(cell(record.values, "outputTokens"));
    const bulk = parseQuantity(cell(record.values, "quantity"));
    if (!input.ok || !output.ok || !bulk.ok) {
      problems.push(makeProblem(TABULAR_CODES.INVALID_QUANTITY, {
        row: record.row,
        column: columnName(!input.ok ? "inputTokens" : !output.ok ? "outputTokens" : "quantity"),
        columnIndex: binding.bound[!input.ok ? "inputTokens" : !output.ok ? "outputTokens" : "quantity"] ?? null,
      }));
      continue;
    }
    const tokenColumns = binding.bound.inputTokens !== undefined
      || binding.bound.outputTokens !== undefined;
    // A malformed count in the optional requests column never costs the reader
    // the row: the spend still totals, and the model's call count becomes
    // unknown, which the routing rule already has a status for.
    const requests = binding.bound.requests === undefined
      ? { counted: false, quantity: 0, broken: false }
      : (() => {
        const parsed = parseQuantity(cell(record.values, "requests"));
        return { counted: parsed.ok, quantity: parsed.quantity ?? 0, broken: !parsed.ok };
      })();
    const model = cell(record.values, "model");
    const provider = mapProvider(cell(record.values, "provider"), shape.provider);
    const category = mapServiceCategory(model);
    const status = normalizeHeader(cell(record.values, "status")) === "final"
      ? "final" : "estimated";
    // Group to the aggregation the contract declares — one row per day, org unit,
    // provider, and service category — so `privacy.aggregation` is true by
    // construction rather than by assertion.
    // Tier is decided per source row, from that row's own string, so the count
    // of unrecognized rows is a count of rows and not of folded aggregates.
    const carriedModel = carryableModelString(model);
    if (classifyModelTier(model) === UNRECOGNIZED_TIER) unrecognizedModelRows += 1;
    const key = `${resolved.date}|${unitKey(label)}|${provider}|${category}`;
    const group = groups.get(key) ?? {
      usage_date: resolved.date, org_unit_id: unitId(label), provider,
      service_category: category, amountMinor: 0, quantity: 0,
      unit: tokenColumns ? "tokens" : "provider-units", status: "final",
      // Model identity survives folding only while the folded rows agree. Two
      // models in one aggregate make it absent, never whichever came first:
      // the contract's grain is coarser than the model, and a picked winner
      // would read as a fact about spend that no row supports.
      modelRaw: carriedModel, modelMixed: false,
      inputTotal: 0, outputTotal: 0, requestTotal: 0, requestsBroken: false,
    };
    group.amountMinor += money.amountMinor;
    group.quantity += tokenColumns ? input.quantity + output.quantity : bulk.quantity;
    group.inputTotal += input.quantity;
    group.outputTotal += output.quantity;
    if (requests.broken) group.requestsBroken = true;
    else group.requestTotal += requests.quantity;
    if (group.modelRaw !== carriedModel) {
      group.modelMixed = true;
      group.modelRaw = ABSENT;
    }
    if (status === "estimated") group.status = "estimated";
    groups.set(key, group);

    // Model identity, folded per (org unit, model). The label is recognized
    // structurally — never matched against a vendor catalogue and never echoed
    // raw — so an unrecognized or placeholder value becomes `null` and its
    // spend is reported as unattributed rather than guessed at.
    if (category === "text-generation") {
      const recognized = recognizeIdentifier(model);
      const modelKey = `${unitKey(label)}|${recognized.label ?? ""}`;
      const modelGroup = modelGroups.get(modelKey) ?? {
        orgUnitId: unitId(label),
        model: recognized.recognized ? modelId(recognized.label) : null,
        provider,
        inputTokens: 0, outputTokens: 0, tokens: 0, requests: null,
        spendMinor: 0, estimated: false, sourceRows: 0, requestsBroken: false,
      };
      modelGroup.spendMinor += money.amountMinor;
      if (tokenColumns) {
        modelGroup.inputTokens += input.quantity;
        modelGroup.outputTokens += output.quantity;
        modelGroup.tokens += input.quantity + output.quantity;
      }
      if (requests.broken) modelGroup.requestsBroken = true;
      else if (requests.counted) {
        modelGroup.requests = (modelGroup.requests ?? 0) + requests.quantity;
      }
      if (status === "estimated") modelGroup.estimated = true;
      modelGroup.sourceRows += 1;
      modelGroups.set(modelKey, modelGroup);
    }
    dateFormats[resolved.format] = (dateFormats[resolved.format] ?? 0) + 1;
    accepted += 1;
  }

  const records = [...groups.values()]
    .sort((left, right) => (left.usage_date < right.usage_date ? -1
      : left.usage_date > right.usage_date ? 1
        : left.org_unit_id.localeCompare(right.org_unit_id)
        || left.provider.localeCompare(right.provider)
        || left.service_category.localeCompare(right.service_category)))
    .map((group, index) => ({
      aggregate_id: `psn_agg_${digestOf(`${group.usage_date}|${group.org_unit_id}|${group.provider}|${group.service_category}`)}${String(index).padStart(4, "0")}`,
      revision: 0,
      usage_date: group.usage_date,
      org_unit_id: group.org_unit_id,
      provider: group.provider,
      service_category: group.service_category,
      usage: { quantity: group.quantity, unit: group.unit },
      cost: { amount_minor: group.amountMinor, currency: ANALYSIS_CURRENCY, status: group.status },
      // The v1.1 detail. A column this export does not carry is absent here —
      // not zero — and a combined-token export (`quantity` only, above) leaves
      // the split absent rather than inventing one.
      ...usageDetail({
        model: group.modelRaw,
        requestCount: hasRequests && !group.requestsBroken
          && Number.isInteger(group.requestTotal) ? group.requestTotal : ABSENT,
        inputTokens: hasInput ? group.inputTotal : ABSENT,
        outputTokens: hasOutput ? group.outputTotal : ABSENT,
      }),
    }));
  if (!records.length) return { records: null, accepted, dateFormats };

  const dates = records.map((record) => record.usage_date).sort();
  const document = {
    // A delimited import always produces the current provider contract. The
    // reader's own file is the only thing that decides whether the fields it
    // added carry a value or carry absence.
    schema_version: PROVIDER_USAGE_SCHEMA_VERSION,
    kind: LOCAL_KINDS.provider,
    export_id: exportId(`${shape.id}|${dates[0]}|${dates.at(-1)}|${records.length}|${options.seed}`),
    snapshot: {
      source_instance_id: DELIMITED_SOURCE_INSTANCE_ID,
      sequence: 0,
      generated_at: options.generatedAt,
      period_start: dates[0],
      period_end: addDay(dates.at(-1)),
      completeness: problems.length ? "partial" : "complete",
      omitted_record_count: problems.length,
      issues: [],
    },
    privacy: {
      aggregation: "daily-org-unit-service",
      // The contract's k-anonymity floor is a property of the *source*, which a
      // CSV cannot prove. The import asserts the declared minimum and says so:
      // the `group_size_assumed` note below is attached to every delimited
      // provider import so the assumption is visible rather than implied.
      minimum_group_size: 10,
      direct_identifiers_included: false,
      content_included: false,
    },
    records,
  };
  problems.push(makeProblem(TABULAR_CODES.GROUP_SIZE_ASSUMED, { severity: "info" }));
  const modelUsage = [...modelGroups.values()]
    .map(({ requestsBroken, ...group }) => Object.freeze({
      ...group, requests: requestsBroken ? null : group.requests,
    }))
    .sort((left, right) => left.orgUnitId.localeCompare(right.orgUnitId)
      || String(left.model).localeCompare(String(right.model)));
  return { records, document, accepted, dateFormats, modelUsage, unrecognizedModelRows };
}

function normalizeRosterRows(binding, reading, problems, options) {
  const { header, rows } = reading;
  const cell = (values, field) => {
    const index = binding.bound[field];
    return index === undefined ? "" : (values[index] ?? "");
  };
  const seen = new Map();
  let accepted = 0;
  for (const record of rows) {
    if (record.values.length !== header.length) {
      problems.push(makeProblem(TABULAR_CODES.MALFORMED_ROW, {
        row: record.row, expected: header.length, observed: record.values.length,
      }));
      continue;
    }
    const label = String(cell(record.values, "orgUnit")).trim();
    if (!label) {
      problems.push(makeProblem(TABULAR_CODES.MISSING_VALUE, {
        row: record.row, column: header[binding.bound.orgUnit] ?? "unit",
        columnIndex: binding.bound.orgUnit,
      }));
      continue;
    }
    const parentLabel = String(cell(record.values, "parent")).trim();
    seen.set(unitKey(label), {
      unit_id: unitId(label),
      revision: 0,
      operation: "upsert",
      effective_at: options.generatedAt,
      parent_unit_id: parentLabel ? unitId(parentLabel) : null,
      unit_type: mapUnitType(cell(record.values, "unitType")),
      active: mapActive(cell(record.values, "active")),
    });
    accepted += 1;
  }
  const records = [...seen.values()].sort((left, right) =>
    left.unit_id.localeCompare(right.unit_id));
  if (!records.length) return { records: null, accepted, dateFormats: {} };
  const document = {
    schema_version: "1.0",
    kind: LOCAL_KINDS.hris,
    export_id: exportId(`org_roster|${records.length}|${records[0].unit_id}|${options.seed}`),
    snapshot: {
      source_instance_id: DELIMITED_SOURCE_INSTANCE_ID,
      sequence: 0,
      generated_at: options.generatedAt,
      mode: "full",
      completeness: problems.length ? "partial" : "complete",
      omitted_record_count: problems.length,
      issues: [],
    },
    privacy: {
      identifier_method: "hmac-sha256-truncated",
      direct_identifiers_included: false,
      salt_scope: "tenant-integration-v1",
    },
    records,
  };
  return { records, document, accepted, dateFormats: {} };
}

/**
 * The canonical fields a reviewed mapping may bind, and which of them the
 * normalizer cannot proceed without. It mirrors the required flags declared on
 * the shapes above; the review step reads the same table so the step and the
 * parser can never disagree about what "required" means.
 */
const MANUAL_FIELDS = Object.freeze({
  provider: Object.freeze({
    date: true, orgUnit: true, model: true, amount: true,
    currency: false, inputTokens: false, outputTokens: false, quantity: false,
    requests: false, provider: false, status: false,
  }),
  hris: Object.freeze({ orgUnit: true, parent: false, unitType: false, active: false }),
});

/**
 * Build a binding from a reviewed column mapping instead of from detection.
 *
 * The shape is synthesized rather than looked up, so a hand-mapped file never
 * has to pretend to be a vendor's export and nothing is added to `SHAPES` that
 * detection would then have to rank. Everything downstream — normalization,
 * grouping, the contract validator — is the auto-detected path unchanged.
 */
export function bindingFromMapping(mapping, header) {
  const kind = mapping?.kind === "hris" ? "hris" : "provider";
  const declared = MANUAL_FIELDS[kind];
  const bound = {};
  let matched = 0;
  for (const [field, index] of Object.entries(mapping?.bound ?? {})) {
    if (!Object.hasOwn(declared, field)) continue;
    if (!Number.isInteger(index) || index < 0 || index >= header.length) continue;
    bound[field] = index;
    matched += 1;
  }
  const missing = Object.keys(declared).filter((field) => declared[field] && bound[field] === undefined);
  const columns = Object.fromEntries(Object.entries(declared).map(([field, required]) => [
    field, { aliases: Object.freeze([]), required },
  ]));
  return {
    shape: Object.freeze({
      id: mapping?.shapeId ?? `reviewed_${kind}`,
      label: "Reviewed column mapping",
      kind, provider: mapping?.provider ?? "other",
      columns: Object.freeze(columns),
    }),
    bound, missing, matched, recognized: missing.length === 0,
  };
}

/**
 * Rebind `orgUnit` to the column the dialect layer says this export is natively
 * grouped by. Everything else about the shape is untouched, so normalization,
 * pseudonymization, and the contract validator are the detected path unchanged.
 */
function nativeGroupingBinding(binding, nativeGrouping) {
  return {
    ...binding,
    bound: { ...binding.bound, orgUnit: nativeGrouping.column.index },
    missing: binding.missing.filter((field) => field !== "orgUnit"),
    matched: binding.matched + 1,
    recognized: binding.missing.every((field) => field === "orgUnit"),
    orgUnitOrigin: "native_grouping",
  };
}

/**
 * Read one delimited provider export or roster and normalize it into a v1
 * envelope.
 *
 * Always returns a result object; it never throws for bad input. On success the
 * `parsed` field holds exactly what `parseLocalFinopsFile` returns for the JSON
 * path, because it *is* what `parseLocalFinopsFile` returned — the normalized
 * envelope is validated by the shipped contract validator before it is handed
 * back, so a translation defect fails here rather than downstream.
 */
export function parseDelimitedFinopsFile(text, fileName = "export.csv", options = {}) {
  const reading = readDelimitedText(text, options);
  if (!reading.ok) return failure([makeProblem(reading.problem.code, reading.problem)]);

  // Set once the header names exactly one supported provider's required columns.
  // That file skips the mapping review, so it is held to the stricter native
  // row rule below instead.
  const nativeContract = nativeContractForHeader(reading.header);

  // A reviewed mapping wins over detection: the reader has already been shown
  // what every column became and has corrected it, so re-guessing here would
  // discard the one answer that is not a guess.
  let binding = options.mapping
    ? bindingFromMapping(options.mapping, reading.header)
    : detectShape(reading.header);
  const columns = Object.freeze([...reading.header]);

  // The sensitivity screen, before any row is read. A billing export that
  // carries prompt or completion bodies is refused whole rather than partly
  // read: the promise is that no message body was parsed, sampled into the
  // mapping review, or written anywhere — and that promise can only be kept at
  // the header row.
  const screened = screenSensitiveColumns(columns);
  if (!screened.ok) {
    return failure([makeProblem(TABULAR_CODES.SENSITIVE_FIELD_PRESENT, {
      row: reading.headerRow,
      column: screened.rejected[0],
      shape: binding.shape?.id ?? null,
      observed: screened.rejected.length,
      action: adapterRemediation(adapterForShape(binding.shape?.id),
        TABULAR_CODES.SENSITIVE_FIELD_PRESENT),
    })], { columns, shape: binding.shape?.id ?? null });
  }

  // What the export already says about how it is grouped, read off the dialect
  // profiles rather than this module's own alias lists. It is carried out on
  // every result — success or failure — because the review step wants to explain
  // the grouping even when something else about the file is wrong.
  const nativeGrouping = detectNativeGrouping({
    columns: reading.header, rows: reading.rows.map((record) => record.values),
  });
  // A shape whose `orgUnit` aliases missed is not an unattributable file. If the
  // dialect layer recognized a native grouping column, bind it: the reader's
  // export was always grouped, this module simply had not been told the header.
  // A reviewed mapping is never overridden — the reader has already answered.
  if (!options.mapping && binding.missing.includes("orgUnit")
    && nativeGrouping.status === "native") {
    binding = nativeGroupingBinding(binding, nativeGrouping);
  }

  // Contract-approved native output retains the required usage quantity only.
  // Provider output-token columns are shape signals, not additive usage input:
  // the manifest declares `n_generated_tokens_total` and `output_tokens` as
  // "shape signal only; not retained".
  if (nativeContract && binding.bound.outputTokens !== undefined) {
    binding = { ...binding, bound: { ...binding.bound } };
    delete binding.bound.outputTokens;
  }

  if (!binding.recognized) {
    if (binding.matched === 0) {
      return failure([makeProblem(TABULAR_CODES.UNSUPPORTED_FORMAT, {
        row: reading.headerRow,
        detail: "the header row matches no recognized provider export or roster",
      })], { columns, nativeGrouping });
    }
    return failure(binding.missing.map((field) => makeProblem(
      TABULAR_CODES.MISSING_REQUIRED_COLUMN,
      {
        row: reading.headerRow, column: field, shape: binding.shape.id,
        expected: Object.freeze([...binding.shape.columns[field].aliases]),
      },
    )), { columns, shape: binding.shape.id, nativeGrouping });
  }

  const settings = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    seed: fileName,
  };
  const problems = [];
  const normalized = binding.shape.kind === "provider"
    ? normalizeProviderRows(binding.shape, binding, reading, problems, settings)
    : normalizeRosterRows(binding, reading, problems, settings);

  // The native all-or-nothing rule. A reader who mapped the columns themselves
  // is shown the skipped-row count and can judge the remainder; a native export
  // skips that review, so one unreadable required cell rejects the file whole.
  // Otherwise the provider's usage and cost for that row leave the monthly
  // total silently, and a subtotal reads exactly like a total.
  //
  // The verdict is the normalizer's own, not a second copy of its rules: a
  // private validator drifts from the parser it guards, and every value the two
  // disagree about is a row waved through the gate and skipped downstream —
  // which is the partial analysis this gate exists to prevent.
  if (nativeContract) {
    const cause = problems.find(({ code }) => NATIVE_BLOCKING_CODES.includes(code))
      ?? nativePrintedFormProblem(binding, reading);
    if (cause) {
      return failure([makeProblem(TABULAR_CODES.NATIVE_REQUIRED_FIELD_INVALID, {
        row: cause.row, column: cause.column, columnIndex: cause.columnIndex,
        providerId: nativeContract.id, reason: cause.code,
      }), ...problems], {
        columns, shape: binding.shape.id, rowCount: reading.rows.length, nativeGrouping,
      });
    }
  }

  if (!normalized.records) {
    problems.push(makeProblem(TABULAR_CODES.NO_USABLE_ROWS, {
      observed: normalized.accepted, expected: 1,
    }));
    return failure(problems, {
      columns, shape: binding.shape.id, rowCount: reading.rows.length, nativeGrouping,
    });
  }

  let parsed;
  try {
    // Same validator, same rules as an uploaded envelope. The synthetic name
    // only satisfies the JSON path's extension gate; the caller's file name is
    // restored below so diagnostics still address the file the reader chose.
    const validated = parseLocalFinopsFile(
      JSON.stringify(normalized.document), "normalized-delimited-import.json", "application/json",
    );
    parsed = Object.freeze({
      type: validated.type,
      fileName,
      document: validated.document,
      // Analysis input, not contract content: the per-model rows the envelope
      // cannot carry. Absent for a roster and for an uploaded JSON envelope,
      // which is exactly the case the routing rule reports as
      // `unknown_model_tier` rather than scoring as zero.
      ...(normalized.modelUsage?.length
        ? { modelUsage: Object.freeze(normalized.modelUsage) } : {}),
      // Rows whose model string matched no declared tier rule. Carried on the
      // parse result so a later screen can say how much of the file this build
      // could not name, instead of the number vanishing into `unrecognized`.
      unrecognizedModelRows: normalized.unrecognizedModelRows ?? 0,
    });
  } catch (error) {
    problems.push(makeProblem(TABULAR_CODES.CONTRACT_REJECTED, { reason: error?.code ?? "unknown" }));
    return failure(problems, {
      columns, shape: binding.shape.id, rowCount: reading.rows.length, nativeGrouping,
    });
  }

  const totalMinor = binding.shape.kind === "provider"
    ? normalized.records.reduce((sum, record) => sum + record.cost.amount_minor, 0) : 0;
  const skippedRows = reading.rows.length - normalized.accepted;
  const evidence = Object.freeze({
    version: "local-import-evidence/1.0.0",
    source: Object.freeze({
      fileName,
      exportId: parsed.document.export_id,
      sourceInstanceId: parsed.document.snapshot.source_instance_id,
      shape: binding.shape.id,
    }),
    rowCounts: Object.freeze({
      source: reading.sampling.sourceRows,
      selected: reading.sampling.analyzedRows,
      analyzed: normalized.accepted,
      coverage: reading.sampling.sourceRows
        ? normalized.accepted / reading.sampling.sourceRows : 0,
      excluded: reading.sampling.excludedRows + skippedRows,
    }),
    exclusions: Object.freeze([
      ...(reading.sampling.excludedRows
        ? [{ reason: "bounded_systematic_sample", count: reading.sampling.excludedRows }] : []),
      ...(skippedRows ? [{ reason: "malformed_or_unsupported_row", count: skippedRows }] : []),
    ].map(Object.freeze)),
    sampling: reading.sampling,
    currency: ANALYSIS_CURRENCY,
    window: Object.freeze({
      start: parsed.document.snapshot.period_start,
      end: parsed.document.snapshot.period_end,
      limitation: "Dates are derived only from analyzed rows; excluded rows are not inferred.",
    }),
    duplicateHandling:
      "Within analyzed rows, latest revision per aggregate ID is retained; repeats are quarantined. "
      + "Duplicates in unsampled rows are unknown.",
    processing: "browser_local_ephemeral",
  });
  return Object.freeze({
    ok: true,
    shape: binding.shape.id,
    shapeLabel: binding.shape.label,
    kind: binding.shape.kind,
    parsed,
    // Retained: the header names and the aggregate totals. Nothing else from the
    // file survives this call — no cell value, no org-unit label, no free text.
    columns,
    delimiter: reading.delimiterName,
    lineEnding: reading.lineEnding,
    hadBom: reading.hadBom,
    rowCount: reading.sampling.sourceRows,
    acceptedRows: normalized.accepted,
    skippedRows,
    evidence,
    unrecognizedModelRows: normalized.unrecognizedModelRows ?? 0,
    dateFormats: Object.freeze({ ...normalized.dateFormats }),
    // The versioned grouping contract, republished verbatim. Rowan's attribution
    // and Mina's review step read it from here rather than re-deriving it.
    nativeGrouping,
    // Which answer supplied the org-unit column: this module's own shape
    // aliases, the reader's reviewed mapping, or the export's native grouping.
    orgUnitOrigin: binding.orgUnitOrigin
      ?? (options.mapping ? "reviewed_mapping" : "shape_alias"),
    totals: Object.freeze({
      records: normalized.records.length,
      amountMinor: totalMinor,
      currency: ANALYSIS_CURRENCY,
    }),
    problems: Object.freeze(problems),
  });
}

function extensionOf(fileName) {
  const name = String(fileName ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
}

/** Does this file name route through the delimited path? The column-review step
 * asks before it decides whether a file needs reviewing at all. */
export function isDelimitedFileName(fileName) {
  return ACCEPTED_DELIMITED_EXTENSIONS.includes(extensionOf(fileName));
}

function reject(code, message, detail = {}) {
  const error = new TypeError(message);
  error.code = code;
  Object.assign(error, detail);
  throw error;
}

/**
 * The one entry point the page calls for a selected file.
 *
 * `.json` keeps the existing path untouched — same validator, same errors.
 * `.csv`, `.tsv`, and `.txt` route through the delimited layer. A blocking
 * failure is raised as an error carrying its reason code and the full problem
 * list, so the existing diagnostic surface keeps working while a later task can
 * render the located problems.
 */
export function parseLocalImportFile(text, fileName = "local.json", mediaType = "", options = {}) {
  const extension = extensionOf(fileName);
  if (extension === ACCEPTED_LOCAL_FILE.extension) {
    return parseLocalFinopsFile(text, fileName, mediaType);
  }
  // The unsupported-package path, stated by the contract rather than here. A
  // declared container — a ZIP from a console that only delivers archives, a
  // workbook, an invoice PDF — comes back with the one step that turns it into
  // a file this page reads, and the refusal happens before a byte is parsed.
  const routed = matchExportPackage({ fileName, mediaType });
  if (routed.status !== "supported") {
    reject(TABULAR_CODES.UNSUPPORTED_FORMAT, routed.message,
      { container: routed.container?.label ?? null });
  }
  const result = parseDelimitedFinopsFile(text, fileName, options);
  if (!result.ok) {
    const blocking = result.problems[0];
    reject(blocking.code, describeProblem(blocking), { problems: result.problems });
  }
  return Object.freeze({
    ...result.parsed,
    problems: result.problems,
    shape: result.shape,
    importEvidence: result.evidence,
  });
}

/**
 * A sentence for a problem, built from the code and its coordinates only. No
 * cell value is ever interpolated: the reader is told which row and column to
 * look at in their own file, and looks at it there.
 */
export function describeProblem(problem) {
  const at = problem.row
    ? ` at row ${problem.row}${problem.column ? ` in column “${problem.column}”` : ""}`
    : "";
  switch (problem.code) {
    case TABULAR_CODES.NATIVE_REQUIRED_FIELD_INVALID:
      return `The native provider export has an invalid required field${at}; no rows were analyzed.`;
    case TABULAR_CODES.EMPTY_FILE:
      return "The file contains no rows.";
    case TABULAR_CODES.FILE_TOO_LARGE:
      return `The file is ${problem.observed} bytes; the limit is ${problem.limit} bytes.`;
    case TABULAR_CODES.TOO_MANY_ROWS:
      return `The file has ${problem.observed} rows; the limit is ${problem.limit} rows.`;
    case TABULAR_CODES.MALFORMED_QUOTED_FIELD:
      return `A quoted field is not closed${at || ""}.`;
    case TABULAR_CODES.MISSING_REQUIRED_COLUMN:
      return `The header is missing the required “${problem.column}” column.`;
    case TABULAR_CODES.UNPARSEABLE_DATE:
      return `A date could not be read${at}.`;
    case TABULAR_CODES.INVALID_AMOUNT:
      return `An amount could not be read${at}.`;
    case TABULAR_CODES.INVALID_QUANTITY:
      return `A usage quantity could not be read${at}.`;
    case TABULAR_CODES.UNSUPPORTED_CURRENCY:
      return `A row is priced in ${problem.observed}; only ${problem.expected} rows are combined${at}.`;
    case TABULAR_CODES.MALFORMED_ROW:
      return `A row has ${problem.observed} fields where the header declares ${problem.expected}${at}.`;
    case TABULAR_CODES.MISSING_VALUE:
      return `A required value is empty${at}.`;
    case TABULAR_CODES.NO_USABLE_ROWS:
      return "No row in the file could be normalized.";
    case TABULAR_CODES.CONTRACT_REJECTED:
      return `The normalized export was rejected by the v1 contract (${problem.reason}).`;
    case TABULAR_CODES.SENSITIVE_FIELD_PRESENT:
      // The column name, never a cell from it: the reader needs to know which
      // column to drop, and nothing in it was read to say so.
      return `The header carries “${problem.column}”, which this import never reads. `
        + `${problem.action}`;
    case TABULAR_CODES.GROUP_SIZE_ASSUMED:
      return "The declared minimum group size is asserted by the import; a delimited export cannot prove it.";
    default:
      return "The delimited file could not be read.";
  }
}
