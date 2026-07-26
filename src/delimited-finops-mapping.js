// Pure mapping from delimited rows onto the v1 normalized envelopes.
//
// This module produces exactly the structures `local-finops.js` already
// validates and `normalizeLocalFinopsHistory` already consumes:
// `wawalu.integration.provider-usage-billing` and `wawalu.integration.hris-org`
// v1 documents. There is no second envelope shape and no second pipeline — if a
// downstream surface would need a change to read this output, the mapping is
// wrong, not the surface.
//
// No DOM, no I/O, no clock, no network. Everything nondeterministic is injected
// (`exportId`, `generatedAt`, `sourceInstanceId`) so a test can pin it.
//
// Privacy: only column headers and aggregate totals leave this module alongside
// the mapped records. Row problems carry a coordinate and a reason code; a cell's
// contents are never copied into a message, because a free-text column in a
// provider export can hold prompt text.

import {
  DELIMITED_IMPORT_CODES as CODES, importProblem, normalizeHeaderName,
} from "./delimited-text.js";

export const LOCAL_KIND_NAMES = Object.freeze({
  provider: "wawalu.integration.provider-usage-billing",
  hris: "wawalu.integration.hris-org",
});

/**
 * ISO 4217 minor-unit exponents. The exponent is looked up, never assumed: a
 * hardcoded ×100 would silently inflate a JPY export by two orders of magnitude.
 * A currency outside this table is a row error, not a guess.
 */
export const CURRENCY_MINOR_UNITS = Object.freeze({
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, CHF: 2, SEK: 2, NOK: 2, DKK: 2,
  PLN: 2, BRL: 2, MXN: 2, INR: 2, SGD: 2, HKD: 2, NZD: 2, ZAR: 2, ILS: 2,
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, HUF: 0,
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
});

/**
 * Applied when a delimited export carries an amount column but no currency
 * column. Recorded in `defaultsApplied` every time it is used, so a reader is
 * never left guessing which currency the totals are in.
 */
export const DEFAULT_CURRENCY = "USD";

/** The provider-usage identity the v1 contract requires: pseudonymous only. */
const PSEUDONYM_PATTERN = /^psn_[A-Za-z0-9_-]{16,64}$/;

/**
 * Header aliases, as data. These are the spellings the real exports emit —
 * OpenAI and Anthropic usage CSVs, an AWS/Bedrock cost-and-usage report, and an
 * HRIS roster CSV. Keys are the normalized field names; every alias is compared
 * after `normalizeHeaderName` (trimmed, lowercased, whitespace collapsed), so a
 * new spelling is one array entry rather than one more branch.
 */
export const PROVIDER_HEADER_ALIASES = Object.freeze({
  usage_date: Object.freeze([
    "date", "day", "usage date", "usage_date", "usage day", "start date",
    "start time", "start_time", "timestamp", "period", "month", "usage month",
    "invoice month", "bill period start date", "lineitem/usagestartdate",
    "billingperiodstartdate", "activity date",
  ]),
  org_unit_id: Object.freeze([
    "org unit id", "org_unit_id", "org unit", "cost center", "cost centre",
    "cost_center", "department id", "department_id", "workspace", "workspace id",
    "project", "project id", "project_id", "resourcetags/user:org_unit_id",
    "resource_tags/user:org_unit_id", "costcategory/org_unit_id", "team",
  ]),
  provider: Object.freeze([
    "provider", "vendor", "service provider", "lineitem/productcode",
    "product/provider", "product code", "platform",
  ]),
  service_category: Object.freeze([
    "service category", "service_category", "category", "usage type",
    "usage_type", "lineitem/usagetype", "product/productname", "product",
    "endpoint", "operation", "model type",
  ]),
  quantity: Object.freeze([
    "quantity", "usage quantity", "usage_quantity", "units", "unit count",
    "tokens", "total tokens", "n_tokens", "n_tokens_total", "input tokens",
    "lineitem/usageamount", "requests",
  ]),
  unit: Object.freeze([
    "unit", "usage unit", "usage_unit", "quantity unit", "pricing unit",
    "lineitem/usageunit", "pricing/unit",
  ]),
  amount: Object.freeze([
    "amount", "cost", "cost usd", "cost_usd", "total cost", "total_cost",
    "amount due", "spend", "charge", "unblended cost",
    "lineitem/unblendedcost", "lineitem/netunblendedcost", "amount (usd)",
  ]),
  currency: Object.freeze([
    "currency", "currency code", "currency_code", "cost currency",
    "lineitem/currencycode", "pricing/currency", "billing currency",
  ]),
  status: Object.freeze([
    "status", "cost status", "cost_status", "billing status", "invoice status",
    "bill/invoicestatus",
  ]),
});

export const ROSTER_HEADER_ALIASES = Object.freeze({
  unit_id: Object.freeze([
    "unit id", "unit_id", "org unit id", "org_unit_id", "org unit",
    "department id", "department_id", "cost center", "cost_center",
  ]),
  parent_unit_id: Object.freeze([
    "parent unit id", "parent_unit_id", "parent id", "parent", "reports to",
    "parent org unit", "parent department id",
  ]),
  unit_type: Object.freeze([
    "unit type", "unit_type", "type", "level", "org level", "unit level",
  ]),
  active: Object.freeze([
    "active", "is active", "is_active", "status", "unit status", "state",
  ]),
  effective_at: Object.freeze([
    "effective at", "effective_at", "effective date", "as of", "as_of",
    "valid from", "snapshot date",
  ]),
  operation: Object.freeze(["operation", "change type", "change_type", "action"]),
});

/**
 * Value aliases for the closed enumerations the v1 contract declares. Also data.
 * An unmatched value falls back to the contract's `other`, which is recorded as
 * a default rather than treated as an error: a category we do not recognize is
 * still real spend, and dropping the row would understate the total.
 */
const PROVIDER_VALUE_ALIASES = Object.freeze({
  openai: ["openai", "open ai", "azure openai", "gpt"],
  anthropic: ["anthropic", "claude"],
  google: ["google", "gemini", "vertex", "vertex ai", "gcp"],
  aws: ["aws", "amazon", "amazon web services", "bedrock", "amazonbedrock", "amazon bedrock"],
  azure: ["azure", "microsoft", "microsoft azure"],
});

const SERVICE_CATEGORY_ALIASES = Object.freeze({
  "text-generation": ["text-generation", "text generation", "text", "chat", "chat completions",
    "completions", "completion", "messages", "responses", "modelinvocation", "model invocation",
    "inference", "llm"],
  "image-generation": ["image-generation", "image generation", "image", "images", "dall-e",
    "dalle", "vision generation"],
  embedding: ["embedding", "embeddings", "embed", "vector"],
  storage: ["storage", "object storage", "s3", "file storage", "retention"],
});

const USAGE_UNIT_ALIASES = Object.freeze({
  tokens: ["token", "tokens", "1k tokens", "1m tokens", "kilotokens"],
  images: ["image", "images"],
  requests: ["request", "requests", "call", "calls", "api calls", "invocations"],
  "byte-hours": ["byte-hours", "byte hours", "gb-hours", "gb hours", "gb-month", "gb month"],
});

const COST_STATUS_ALIASES = Object.freeze({
  final: ["final", "invoiced", "billed", "closed", "posted"],
  estimated: ["estimated", "estimate", "pending", "preliminary", "open", "unbilled"],
});

const UNIT_TYPE_ALIASES = Object.freeze({
  company: ["company", "organization", "org", "enterprise", "root"],
  division: ["division", "group", "business unit", "bu"],
  department: ["department", "dept", "cost center", "function"],
  team: ["team", "squad", "crew", "pod"],
});

const TRUE_VALUES = Object.freeze(["true", "yes", "y", "1", "active", "enabled"]);
const FALSE_VALUES = Object.freeze(["false", "no", "n", "0", "inactive", "disabled", "terminated"]);

/**
 * Defaults applied when a column is absent. Every one of these is reported in
 * `defaultsApplied`; none of them is silent.
 */
export const PROVIDER_COLUMN_DEFAULTS = Object.freeze({
  currency: DEFAULT_CURRENCY,
  provider: "other",
  service_category: "other",
  unit: "provider-units",
  quantity: 0,
  status: "estimated",
});

const PROVIDER_REQUIRED_FIELDS = Object.freeze(["usage_date", "org_unit_id", "amount"]);
const ROSTER_REQUIRED_FIELDS = Object.freeze(["unit_id"]);

function normalizeValue(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function matchAlias(table, value, fallback) {
  const normalized = normalizeValue(value);
  if (!normalized) return fallback;
  for (const [canonical, aliases] of Object.entries(table)) {
    if (canonical === normalized || aliases.includes(normalized)) return canonical;
  }
  // Substring match last, so `lineItem/UsageType = Bedrock:ModelInvocation`
  // still lands on a declared category instead of falling to `other`.
  for (const [canonical, aliases] of Object.entries(table)) {
    if (aliases.some((alias) => alias.length > 3 && normalized.includes(alias))) return canonical;
  }
  return fallback;
}

/**
 * Resolve declared fields onto column indexes. First occurrence wins, matching
 * the reader's duplicate-column report.
 */
export function resolveColumns(normalizedHeader, aliases) {
  const positions = new Map();
  normalizedHeader.forEach((name, index) => {
    if (!positions.has(name)) positions.set(name, index);
  });
  const resolved = {};
  for (const [field, spellings] of Object.entries(aliases)) {
    const hit = [field, ...spellings]
      .map((spelling) => normalizeHeaderName(spelling))
      .find((spelling) => positions.has(spelling));
    if (hit !== undefined) resolved[field] = positions.get(hit);
  }
  return resolved;
}

/**
 * Which envelope a delimited file maps onto, from its header alone.
 *
 * A usage-shaped header wins over a roster-shaped one, because an org-unit
 * column is a column both files carry: a provider export missing its cost column
 * must be reported as a provider export missing a required column, not quietly
 * read as a roster.
 */
export function detectDelimitedKind(normalizedHeader) {
  const provider = resolveColumns(normalizedHeader, PROVIDER_HEADER_ALIASES);
  const roster = resolveColumns(normalizedHeader, ROSTER_HEADER_ALIASES);
  const usageShaped = "amount" in provider || "usage_date" in provider;
  const rosterShaped = "unit_id" in roster && ["unit_type", "active", "parent_unit_id", "effective_at", "operation"]
    .some((field) => field in roster);
  if ("amount" in provider && "usage_date" in provider) return "provider";
  if (rosterShaped && !usageShaped) return "hris";
  if (usageShaped) return "provider";
  if ("unit_id" in roster) return "hris";
  return null;
}

/**
 * Convert a decimal amount string to minor units for its currency.
 *
 * Integer-safe: the decimal string is split, the fraction is padded to the
 * currency's exponent, and the digits are concatenated. There is no float
 * multiply anywhere, so `19.99 USD` is exactly 1999 and `0.1 + 0.2` drift cannot
 * reach a total. Significant fractional digits beyond the exponent are rejected
 * rather than rounded away; trailing zeros are not significant, so `1200.00 JPY`
 * is accepted and `1200.50 JPY` is not.
 */
export function amountToMinorUnits(rawAmount, currencyCode) {
  const currency = String(currencyCode ?? "").trim().toUpperCase();
  const exponent = CURRENCY_MINOR_UNITS[currency];
  if (exponent === undefined) {
    return { ok: false, code: CODES.UNSUPPORTED_CURRENCY, currency };
  }
  let text = String(rawAmount ?? "").trim().replace(/^[$€£¥]/, "").trim();
  // Thousands groupings only in their canonical shape; anything else is a parse
  // failure rather than a silently stripped character.
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, "");
  if (!text) return { ok: false, code: CODES.UNPARSEABLE_AMOUNT, currency };
  const negative = text.startsWith("-");
  if (negative || text.startsWith("+")) text = text.slice(1);
  if (!/^\d*(\.\d*)?$/.test(text) || !/\d/.test(text)) {
    return { ok: false, code: CODES.UNPARSEABLE_AMOUNT, currency };
  }
  const [whole = "", fraction = ""] = text.split(".");
  const significant = fraction.replace(/0+$/, "");
  if (significant.length > exponent) {
    return {
      ok: false, code: CODES.AMOUNT_PRECISION_EXCEEDED, currency,
      exponent, observedFractionDigits: significant.length,
    };
  }
  const digits = `${whole || "0"}${significant.padEnd(exponent, "0")}`.replace(/^0+(?=\d)/, "");
  const minor = Number(digits);
  if (!Number.isSafeInteger(minor)) {
    return { ok: false, code: CODES.UNPARSEABLE_AMOUNT, currency };
  }
  if (negative && minor !== 0) {
    // The v1 contract's cost.amount_minor is non-negative; a credit line cannot
    // be represented, and netting it into a neighbouring row would be a guess.
    return { ok: false, code: CODES.NEGATIVE_AMOUNT, currency };
  }
  return { ok: true, minor, currency, exponent };
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_ONLY = /^(\d{4})-(\d{2})$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

function isRealDate(year, month, day) {
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

/**
 * Normalize a period cell to the `YYYY-MM-DD` usage date the v1 provider
 * contract already uses.
 *
 * Timezone rule, fixed and deterministic: an offset-bearing timestamp is
 * converted to UTC and the UTC calendar date is taken; a timestamp with no
 * offset is *read as UTC*, not as the host's local time. The host machine's
 * timezone must never decide which day — and therefore which period — a row
 * lands in, because the same file would then produce two different totals on two
 * different laptops. A bare `YYYY-MM` means the first day of that month.
 */
export function normalizeUsageDate(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) return { ok: false, code: CODES.UNPARSEABLE_DATE };
  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) {
    const [, year, month, day] = dateOnly.map(Number);
    return isRealDate(year, month, day)
      ? { ok: true, date: text, precision: "day" }
      : { ok: false, code: CODES.UNPARSEABLE_DATE };
  }
  const monthOnly = MONTH_ONLY.exec(text);
  if (monthOnly) {
    const [, year, month] = monthOnly.map(Number);
    return isRealDate(year, month, 1)
      ? { ok: true, date: `${pad(year, 4)}-${pad(month)}-01`, precision: "month" }
      : { ok: false, code: CODES.UNPARSEABLE_DATE };
  }
  const timestamp = TIMESTAMP.exec(text);
  if (timestamp) {
    const [, year, month, day, hour, minute, second = "0"] = timestamp;
    const offset = timestamp[7];
    if (!isRealDate(Number(year), Number(month), Number(day))) {
      return { ok: false, code: CODES.UNPARSEABLE_DATE };
    }
    if (!offset || offset.toUpperCase() === "Z") {
      return { ok: true, date: `${year}-${month}-${day}`, precision: "timestamp" };
    }
    const sign = offset.startsWith("-") ? -1 : 1;
    const [offsetHours, offsetMinutes] = offset.slice(1).replace(":", "").match(/\d{2}/g).map(Number);
    const stamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour),
      Number(minute), Number(second)) - sign * ((offsetHours * 60 + offsetMinutes) * 60_000);
    const utc = new Date(stamp);
    return {
      ok: true,
      date: `${pad(utc.getUTCFullYear(), 4)}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`,
      precision: "timestamp",
    };
  }
  // `03/07/2026` is not accepted: day-first and month-first are both plausible
  // and a wrong guess moves spend between periods.
  return { ok: false, code: CODES.UNPARSEABLE_DATE };
}

function addUtcDay(date) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function newExportId(provided) {
  if (provided) return provided;
  return globalThis.crypto?.randomUUID?.()
    // Deterministic v4-shaped fallback for a host without WebCrypto. The import
    // is session-local, so uniqueness only has to hold within one selection.
    ?? "00000000-0000-4000-8000-000000000000";
}

function missingColumnProblems(required, resolved, headerRow) {
  return required
    .filter((field) => !(field in resolved))
    .map((field) => importProblem(CODES.MISSING_REQUIRED_COLUMN, {
      row: headerRow,
      header: field,
      message: `No column in the header maps to the required field “${field}”.`,
      field,
    }));
}

function cellAt(cells, index) {
  return index === undefined ? "" : String(cells[index] ?? "").trim();
}

/**
 * Map delimited rows onto a v1 `provider-usage-billing` envelope.
 *
 * @param {object} reading a successful `readDelimitedText` result
 * @param {object} options `exportId`, `generatedAt`, `sourceInstanceId`, and an
 *   optional `pseudonymize` hook. Without that hook a raw (non-pseudonymous)
 *   org-unit value is a row error: this module will not invent a pseudonym,
 *   because the envelope's provenance would then be false.
 */
export function mapDelimitedProviderUsage(reading, options = {}) {
  const {
    exportId, generatedAt = "1970-01-01T00:00:00Z",
    sourceInstanceId = "psn_local_delimited_import_v1", pseudonymize,
  } = options;
  const resolved = resolveColumns(reading.normalizedHeader, PROVIDER_HEADER_ALIASES);
  const errors = [...reading.errors];
  const defaultsApplied = [];
  const missing = missingColumnProblems(PROVIDER_REQUIRED_FIELDS, resolved, reading.headerRow);
  if (missing.length) {
    return Object.freeze({
      ok: false, kind: "provider", document: null, headers: Object.freeze([...reading.header]),
      delimiter: reading.delimiter, rowsRead: reading.rows.length, rowsMapped: 0,
      rowsRejected: reading.rows.length,
      errors: Object.freeze([...errors, ...missing]),
      defaultsApplied: Object.freeze([]), totals: null,
    });
  }
  for (const [field, value] of Object.entries(PROVIDER_COLUMN_DEFAULTS)) {
    if (field in resolved) continue;
    defaultsApplied.push(Object.freeze({
      field, value,
      reason: field === "currency"
        ? `No currency column was present; amounts were read as ${value}.`
        : `No “${field}” column was present; the declared default was applied to every row.`,
    }));
  }

  const records = [];
  let totalMinor = 0;
  const currencies = new Set();
  reading.rows.forEach((row, index) => {
    const at = (field) => cellAt(row.cells, resolved[field]);
    const columnOf = (field) => (resolved[field] ?? 0) + 1;
    const headerOf = (field) => reading.header[resolved[field]] ?? field;

    const orgRaw = at("org_unit_id");
    const orgUnitId = PSEUDONYM_PATTERN.test(orgRaw) ? orgRaw : pseudonymize?.(orgRaw);
    if (!orgUnitId || !PSEUDONYM_PATTERN.test(orgUnitId)) {
      errors.push(importProblem(CODES.UNPSEUDONYMIZED_IDENTIFIER, {
        row: row.row, column: columnOf("org_unit_id"), header: headerOf("org_unit_id"),
        message: "The org-unit cell is not a pseudonymous unit id; map it through the roster before import.",
      }));
      return;
    }

    const period = normalizeUsageDate(at("usage_date"));
    if (!period.ok) {
      errors.push(importProblem(period.code, {
        row: row.row, column: columnOf("usage_date"), header: headerOf("usage_date"),
        message: "The date cell is not an ISO date, ISO timestamp, or YYYY-MM month.",
      }));
      return;
    }

    const currency = "currency" in resolved
      ? (at("currency") || DEFAULT_CURRENCY) : DEFAULT_CURRENCY;
    const amount = amountToMinorUnits(at("amount"), currency);
    if (!amount.ok) {
      errors.push(importProblem(amount.code, {
        row: row.row,
        column: amount.code === CODES.UNSUPPORTED_CURRENCY
          ? columnOf("currency") : columnOf("amount"),
        header: amount.code === CODES.UNSUPPORTED_CURRENCY
          ? headerOf("currency") : headerOf("amount"),
        message: amount.code === CODES.UNSUPPORTED_CURRENCY
          ? "The currency code has no declared minor-unit exponent."
          : amount.code === CODES.AMOUNT_PRECISION_EXCEEDED
            ? `The amount carries more fractional digits than ${amount.currency} allows (${amount.exponent}).`
            : amount.code === CODES.NEGATIVE_AMOUNT
              ? "The amount is negative; the v1 cost contract cannot represent a credit."
              : "The amount cell is not a plain decimal number.",
        ...(amount.exponent === undefined ? {} : { exponent: amount.exponent }),
      }));
      return;
    }

    const quantityText = at("quantity");
    const quantity = quantityText === "" ? PROVIDER_COLUMN_DEFAULTS.quantity : Number(quantityText);
    if (!Number.isFinite(quantity) || quantity < 0) {
      errors.push(importProblem(CODES.UNPARSEABLE_QUANTITY, {
        row: row.row, column: columnOf("quantity"), header: headerOf("quantity"),
        message: "The usage-quantity cell is not a non-negative number.",
      }));
      return;
    }

    // A delimited export carries no aggregate id, so one is derived from
    // dimensions that are already pseudonymous plus the row's position. It is
    // stable across re-imports of the same file and reveals nothing new.
    const aggregateId = `psn_${orgUnitId.slice(-12)}_${period.date.replace(/-/g, "")}_${index + 1}`;
    records.push({
      aggregate_id: aggregateId,
      revision: 0,
      usage_date: period.date,
      org_unit_id: orgUnitId,
      provider: matchAlias(PROVIDER_VALUE_ALIASES, at("provider"), PROVIDER_COLUMN_DEFAULTS.provider),
      service_category: matchAlias(SERVICE_CATEGORY_ALIASES, at("service_category"),
        PROVIDER_COLUMN_DEFAULTS.service_category),
      usage: {
        quantity,
        unit: matchAlias(USAGE_UNIT_ALIASES, at("unit"), PROVIDER_COLUMN_DEFAULTS.unit),
      },
      cost: {
        amount_minor: amount.minor,
        currency: amount.currency,
        status: matchAlias(COST_STATUS_ALIASES, at("status"), PROVIDER_COLUMN_DEFAULTS.status),
      },
    });
    totalMinor += amount.minor;
    currencies.add(amount.currency);
  });

  const rowsRejected = reading.rows.length - records.length;
  if (!records.length) {
    return Object.freeze({
      ok: false, kind: "provider", document: null, headers: Object.freeze([...reading.header]),
      delimiter: reading.delimiter, rowsRead: reading.rows.length, rowsMapped: 0, rowsRejected,
      errors: Object.freeze([...errors, importProblem(CODES.NO_MAPPABLE_ROWS, {
        message: "No row in the file produced a usable provider-usage record.",
      })]),
      defaultsApplied: Object.freeze(defaultsApplied), totals: null,
    });
  }

  const dates = records.map((record) => record.usage_date).sort();
  const document = {
    schema_version: "1.0",
    kind: LOCAL_KIND_NAMES.provider,
    export_id: newExportId(exportId),
    snapshot: {
      source_instance_id: sourceInstanceId,
      // A delimited export has no sequence counter of its own.
      sequence: 0,
      generated_at: generatedAt,
      period_start: dates[0],
      // The contract's period is half-open, so the last observed day is included
      // by ending the period on the following day.
      period_end: addUtcDay(dates.at(-1)),
      completeness: errors.length ? "partial" : "complete",
      omitted_record_count: rowsRejected,
      // Aggregate reason codes only: no coordinate, no cell value.
      issues: [...new Set(errors.map((problem) => problem.code))],
    },
    privacy: {
      aggregation: "daily-org-unit-service",
      minimum_group_size: 10,
      direct_identifiers_included: false,
      content_included: false,
    },
    records,
  };
  return Object.freeze({
    ok: true, kind: "provider", document, headers: Object.freeze([...reading.header]),
    delimiter: reading.delimiter, rowsRead: reading.rows.length, rowsMapped: records.length,
    rowsRejected, errors: Object.freeze(errors),
    defaultsApplied: Object.freeze(defaultsApplied),
    totals: Object.freeze({
      amountMinor: totalMinor,
      currencies: Object.freeze([...currencies].sort()),
      periodStart: document.snapshot.period_start,
      periodEnd: document.snapshot.period_end,
    }),
  });
}

/** Map a roster CSV onto a v1 `hris-org` envelope. */
export function mapDelimitedOrgUnits(reading, options = {}) {
  const {
    exportId, generatedAt = "1970-01-01T00:00:00Z",
    sourceInstanceId = "psn_local_delimited_roster_v1", pseudonymize,
  } = options;
  const resolved = resolveColumns(reading.normalizedHeader, ROSTER_HEADER_ALIASES);
  const errors = [...reading.errors];
  const defaultsApplied = [];
  const missing = missingColumnProblems(ROSTER_REQUIRED_FIELDS, resolved, reading.headerRow);
  if (missing.length) {
    return Object.freeze({
      ok: false, kind: "hris", document: null, headers: Object.freeze([...reading.header]),
      delimiter: reading.delimiter, rowsRead: reading.rows.length, rowsMapped: 0,
      rowsRejected: reading.rows.length,
      errors: Object.freeze([...errors, ...missing]),
      defaultsApplied: Object.freeze([]), totals: null,
    });
  }
  if (!("unit_type" in resolved)) {
    defaultsApplied.push(Object.freeze({
      field: "unit_type", value: "other",
      reason: "No unit-type column was present; every unit was mapped as “other”.",
    }));
  }
  if (!("active" in resolved)) {
    defaultsApplied.push(Object.freeze({
      field: "active", value: true,
      reason: "No active column was present; every listed unit was treated as active.",
    }));
  }

  const records = [];
  reading.rows.forEach((row) => {
    const at = (field) => cellAt(row.cells, resolved[field]);
    const columnOf = (field) => (resolved[field] ?? 0) + 1;
    const headerOf = (field) => reading.header[resolved[field]] ?? field;

    const raw = at("unit_id");
    const unitId = PSEUDONYM_PATTERN.test(raw) ? raw : pseudonymize?.(raw);
    if (!unitId || !PSEUDONYM_PATTERN.test(unitId)) {
      errors.push(importProblem(CODES.UNPSEUDONYMIZED_IDENTIFIER, {
        row: row.row, column: columnOf("unit_id"), header: headerOf("unit_id"),
        message: "The unit-id cell is not a pseudonymous unit id; the HRIS contract admits pseudonyms only.",
      }));
      return;
    }
    const parentRaw = at("parent_unit_id");
    let parentUnitId = null;
    if (parentRaw) {
      parentUnitId = PSEUDONYM_PATTERN.test(parentRaw) ? parentRaw : pseudonymize?.(parentRaw);
      if (!parentUnitId || !PSEUDONYM_PATTERN.test(parentUnitId)) {
        errors.push(importProblem(CODES.UNPSEUDONYMIZED_IDENTIFIER, {
          row: row.row, column: columnOf("parent_unit_id"), header: headerOf("parent_unit_id"),
          message: "The parent-unit cell is not a pseudonymous unit id.",
        }));
        return;
      }
    }
    let active = true;
    if ("active" in resolved) {
      const flag = normalizeValue(at("active"));
      if (TRUE_VALUES.includes(flag)) active = true;
      else if (FALSE_VALUES.includes(flag)) active = false;
      else {
        errors.push(importProblem(CODES.UNPARSEABLE_FLAG, {
          row: row.row, column: columnOf("active"), header: headerOf("active"),
          message: "The active cell is not one of the declared boolean spellings.",
        }));
        return;
      }
    }
    let effectiveAt = generatedAt;
    if ("effective_at" in resolved && at("effective_at")) {
      const parsed = normalizeUsageDate(at("effective_at"));
      if (!parsed.ok) {
        errors.push(importProblem(parsed.code, {
          row: row.row, column: columnOf("effective_at"), header: headerOf("effective_at"),
          message: "The effective-at cell is not an ISO date, ISO timestamp, or YYYY-MM month.",
        }));
        return;
      }
      effectiveAt = `${parsed.date}T00:00:00Z`;
    }
    const operation = normalizeValue(at("operation")) === "delete" ? "delete" : "upsert";
    records.push(operation === "delete"
      ? { unit_id: unitId, revision: 0, operation, effective_at: effectiveAt }
      : {
        unit_id: unitId,
        revision: 0,
        operation,
        effective_at: effectiveAt,
        parent_unit_id: parentUnitId,
        unit_type: matchAlias(UNIT_TYPE_ALIASES, at("unit_type"), "other"),
        active,
      });
  });

  const rowsRejected = reading.rows.length - records.length;
  if (!records.length) {
    return Object.freeze({
      ok: false, kind: "hris", document: null, headers: Object.freeze([...reading.header]),
      delimiter: reading.delimiter, rowsRead: reading.rows.length, rowsMapped: 0, rowsRejected,
      errors: Object.freeze([...errors, importProblem(CODES.NO_MAPPABLE_ROWS, {
        message: "No row in the file produced a usable org-unit record.",
      })]),
      defaultsApplied: Object.freeze(defaultsApplied), totals: null,
    });
  }
  const document = {
    schema_version: "1.0",
    kind: LOCAL_KIND_NAMES.hris,
    export_id: newExportId(exportId),
    snapshot: {
      source_instance_id: sourceInstanceId,
      sequence: 0,
      generated_at: generatedAt,
      mode: "full",
      completeness: errors.length ? "partial" : "complete",
      omitted_record_count: rowsRejected,
      issues: [...new Set(errors.map((problem) => problem.code))],
    },
    // The roster CSV must already carry pseudonyms, so this envelope reports the
    // method the source used rather than one this module performed.
    privacy: {
      identifier_method: "hmac-sha256-truncated",
      direct_identifiers_included: false,
      salt_scope: "tenant-integration-v1",
    },
    records,
  };
  return Object.freeze({
    ok: true, kind: "hris", document, headers: Object.freeze([...reading.header]),
    delimiter: reading.delimiter, rowsRead: reading.rows.length, rowsMapped: records.length,
    rowsRejected, errors: Object.freeze(errors),
    defaultsApplied: Object.freeze(defaultsApplied),
    totals: Object.freeze({
      activeUnits: records.filter((record) => record.active).length,
      units: records.length,
    }),
  });
}
