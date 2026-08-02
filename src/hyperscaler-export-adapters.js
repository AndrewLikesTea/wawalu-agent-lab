// Local adapters from the three hyperscaler AI billing exports to the canonical
// v1 provider projection.
//
// WHAT THIS IS. Anya's browser-only compatibility contracts
// (`browser-compat-contracts.js`) say what an AWS Bedrock, Google Vertex AI, or
// Azure OpenAI export looks like and what makes one unusable. That module is
// data; the eligibility evaluator beside it answers "would this file work?".
// This module is the producer that follows: contracted export text in, the same
// v1 provider envelope the delimited importer already emits out. It adds no new
// output model — `buildProviderProjection` folds every provider's rows into the
// one canonical shape, so a Bedrock month and an Azure month are comparable
// because they went through the same arithmetic, not because three functions
// happened to agree.
//
// PURITY. Each adapter is a pure function of the export text. No fetch, XHR, or
// beacon; no credential; no localStorage, sessionStorage, or IndexedDB; no
// filesystem; no `Date.now()` and no `Math.random()` anywhere in the conversion
// path. The one time-dependent field in the envelope, `snapshot.generated_at`,
// is derived from the latest usage date in the export itself. The same bytes
// therefore produce a byte-identical envelope on every machine on every day.
//
// TWO FAILURE MODES, IN THE RETURN VALUE. Nothing here throws on a reader's
// file. Every adapter returns one of three outcomes:
//
//   projected      the export became a canonical projection.
//   incomplete     recognized as this provider, but a field the contract
//                  requires is absent. `missingFields` names them by contract
//                  path, so the reader is told which column to re-export.
//   incompatible   not this provider's export, or a shape the contract does not
//                  model — a different provider's file, an unreadable container,
//                  or an export carrying prompt or completion bodies.
//
// Exceptions are reserved for programmer error: a caller handing this module a
// non-string gets a TypeError, because that is a defect in the caller.
//
// RECOGNITION IS BY CONTRACT MARKER, NEVER BY FILE NAME. Each adapter claims a
// file only when the format and the `exportShape.signatureFields` its contract
// declares are both present. The three marker sets are structurally disjoint —
// a CSV header, a JSON-lines record, and a JSON envelope with `properties.rows`
// — so at most one adapter ever claims a given export. `tests/` asserts that on
// every bundled fixture rather than leaving it as a claim in a comment.

import {
  BROWSER_COMPAT_MANIFEST, FIELD_ROLES, PRIVACY_POLICY, UNSUPPORTED_CODES, contractById,
} from "./browser-compat-contracts.js";
import {
  MAX_DELIMITED_BYTES, MAX_DELIMITED_ROWS, readDelimitedText, utf8ByteLength,
} from "./delimited-text.js";
import {
  buildProviderProjection, normalizeCostAmount, normalizeUnitName,
  normalizeUsageAmount, normalizeUsageDay,
} from "./hyperscaler-export-units.js";

export const HYPERSCALER_ADAPTER_VERSION = "hyperscaler-export-adapters/1.0.0";

/** The closed outcome vocabulary. Callers branch on these and nothing else. */
export const HYPERSCALER_OUTCOME = Object.freeze({
  PROJECTED: "projected",
  INCOMPLETE: "incomplete",
  INCOMPATIBLE: "incompatible",
});

const BOUNDED_READ = Object.freeze({ maxBytes: MAX_DELIMITED_BYTES, maxRows: MAX_DELIMITED_ROWS });

const PROHIBITED_FIELD_KEYS = new Set(
  PRIVACY_POLICY.prohibitedFieldNames.map((name) => normalizeUnitName(name)),
);

const contractCase = (contract, code) =>
  contract.unsupportedCases.find((entry) => entry.code === code) ?? null;

function refusal(contract, outcome, code, extra = {}) {
  const declared = contractCase(contract, code);
  const { missingFields = [], ...rest } = extra;
  return Object.freeze({
    ok: false,
    outcome,
    providerId: contract.providerId,
    providerLabel: contract.displayName,
    contractVersion: contract.contractVersion,
    caseCode: code,
    // The contract's own sentences. This module never writes a second wording
    // for a case the contract already words.
    reason: declared?.reason ?? "The export is outside this contract.",
    remedy: declared?.remedy ?? "Choose the export this contract describes.",
    // Always present, always an array: a caller reading it never has to ask
    // whether this refusal happens to carry the key.
    missingFields: Object.freeze(missingFields),
    ...rest,
  });
}

/** Recognized as this provider, and short a field the contract requires. */
function incomplete(contract, missingFields, extra = {}) {
  // A missing model field is not a missing column like any other: without it no
  // cost can be attributed to a model at all, which is the contract's own
  // "aggregated rollup" case rather than an unmodeled variant.
  const modelPaths = requiredPaths(contract, FIELD_ROLES.MODEL);
  const code = missingFields.some((path) => modelPaths.includes(path))
    ? UNSUPPORTED_CODES.ROLLUP_ONLY : UNSUPPORTED_CODES.UNMODELED_VARIANT;
  return refusal(contract, HYPERSCALER_OUTCOME.INCOMPLETE, code, { missingFields, ...extra });
}

const incompatible = (contract, code, extra = {}) =>
  refusal(contract, HYPERSCALER_OUTCOME.INCOMPATIBLE, code, extra);

function requiredPaths(contract, role) {
  return contract.requiredFields.filter((field) => field.role === role)
    .map((field) => field.path);
}

/** The single required field carrying a role. Every contract declares one each. */
const pathFor = (contract, role) => requiredPaths(contract, role)[0];

function projected(contract, document, { skippedRows, sourceRows }) {
  return Object.freeze({
    ok: true,
    outcome: HYPERSCALER_OUTCOME.PROJECTED,
    providerId: contract.providerId,
    providerLabel: contract.displayName,
    contractVersion: contract.contractVersion,
    adapterVersion: HYPERSCALER_ADAPTER_VERSION,
    document,
    // Counts only. No cell value, no scope label, and no model string from the
    // reader's file survives outside the envelope itself.
    sourceRows,
    acceptedRows: sourceRows - skippedRows,
    skippedRows,
  });
}

// --- shared row handling ---------------------------------------------------

/**
 * Turn one reading — day, scope, model, printed cost, printed usage — into a
 * canonical row, or say which required value could not be read.
 *
 * Every adapter funnels through here, so "unreadable row" means the same thing
 * in all three and a skipped row is skipped for a reason the caller can name.
 */
function canonicalRow({ date, scope, model, amount, currency, usage, unit, direction }) {
  const day = normalizeUsageDay(date);
  if (!day.ok) return { ok: false, field: "timestamp", reason: day.reason };
  const label = String(scope ?? "").trim();
  if (!label) return { ok: false, field: "scope", reason: "empty" };
  const identifier = String(model ?? "").trim();
  if (!identifier) return { ok: false, field: "model", reason: "empty" };
  const money = normalizeCostAmount(amount, currency);
  if (!money.ok) return { ok: false, field: "cost", reason: money.reason };
  const counted = normalizeUsageAmount(usage, unit);
  if (!counted.ok) return { ok: false, field: "units", reason: counted.reason };
  return {
    ok: true,
    row: {
      date: day.date,
      scope: label,
      model: identifier,
      amountMinor: money.amountMinor,
      quantity: counted.quantity,
      unit: counted.unit,
      direction: direction ?? null,
    },
  };
}

/**
 * The last gate every adapter shares: rows that read cleanly become an
 * envelope, and an export where nothing read cleanly is the contract's empty
 * case rather than an envelope with no records in it.
 */
function finish(contract, provider, rows, sourceRows) {
  const skippedRows = sourceRows - rows.length;
  const document = buildProviderProjection({
    adapterId: contract.providerId, provider, rows, skippedRows,
  });
  if (!document) {
    return refusal(contract, HYPERSCALER_OUTCOME.INCOMPLETE, UNSUPPORTED_CODES.EMPTY,
      { missingFields: [], sourceRows, skippedRows });
  }
  return projected(contract, document, { skippedRows, sourceRows });
}

function requireText(text) {
  if (typeof text !== "string") {
    // Programmer error, not a reader's file: the page reads text at the picker.
    throw new TypeError("A hyperscaler adapter takes the export text as a string.");
  }
  return text;
}

const prohibitedAmong = (names) =>
  [...new Set(names)].filter((name) => PROHIBITED_FIELD_KEYS.has(normalizeUnitName(name)));

// --- AWS Bedrock · Cost and Usage Report (CSV) -----------------------------

const bedrockContract = () => contractById("bedrock");

function bedrockTable(text) {
  if (utf8ByteLength(text) > MAX_DELIMITED_BYTES) return null;
  const reading = readDelimitedText(text, BOUNDED_READ);
  return reading.ok ? reading : null;
}

const columnIndex = (header, path) => header.indexOf(path);

function claimsBedrock(text) {
  const contract = bedrockContract();
  const line = text.slice(0, text.indexOf("\n") + 1 || undefined);
  // The signature columns, matched by the contract's own spellings on the
  // header line. A cost ledger that carries neither is not claimed at all.
  return contract.exportShape.signatureFields.every((field) => line.includes(field));
}

/**
 * The Bedrock meter. `lineItem/UsageType` is optional in the contract and says
 * two things when it is there: which direction the tokens went, and whether the
 * meter counts tokens or invocations. Without it the units are one total and
 * the split is absent — which is exactly what the contract's `degradesWithout`
 * says happens.
 */
function bedrockMeter(usageType) {
  const text = String(usageType ?? "");
  const direction = /output/i.test(text) ? "output" : /input/i.test(text) ? "input" : null;
  const unit = /invocation|request/i.test(text) ? "requests"
    : /million|1m\b/i.test(text) ? "1m tokens"
      : /thousand|1k\b|1,000/i.test(text) ? "1k tokens" : "tokens";
  return { unit, direction };
}

export function adaptBedrockExport(text) {
  const contract = bedrockContract();
  const table = bedrockTable(requireText(text));
  if (!table || !claimsBedrock(text)) {
    return incompatible(contract, UNSUPPORTED_CODES.WRONG_PROVIDER);
  }
  const header = table.header;
  const prohibited = prohibitedAmong(header);
  if (prohibited.length) {
    return incompatible(contract, UNSUPPORTED_CODES.PROMPT_CONTENT,
      { prohibitedFields: Object.freeze(prohibited) });
  }
  const missing = contract.requiredFields.map((field) => field.path)
    .filter((path) => columnIndex(header, path) < 0);
  if (missing.length) return incomplete(contract, missing);

  const cell = (values, path) => values[columnIndex(header, path)] ?? "";
  const usageTypeAt = columnIndex(header, "lineItem/UsageType");
  const rows = [];
  for (const record of table.rows) {
    if (record.values.length !== header.length) continue;
    const meter = bedrockMeter(usageTypeAt < 0 ? "" : record.values[usageTypeAt]);
    const reading = canonicalRow({
      date: cell(record.values, pathFor(contract, FIELD_ROLES.TIMESTAMP)),
      scope: cell(record.values, pathFor(contract, FIELD_ROLES.SCOPE)),
      model: cell(record.values, pathFor(contract, FIELD_ROLES.MODEL)),
      amount: cell(record.values, pathFor(contract, FIELD_ROLES.COST)),
      currency: cell(record.values, pathFor(contract, FIELD_ROLES.CURRENCY)),
      usage: cell(record.values, pathFor(contract, FIELD_ROLES.UNITS)),
      unit: meter.unit,
      direction: meter.direction,
    });
    if (reading.ok) rows.push(reading.row);
  }
  return finish(contract, "aws", rows, table.rows.length);
}

// --- Google Vertex AI · detailed usage cost (JSON lines) -------------------

const vertexContract = () => contractById("vertex-ai");

const valueAt = (record, path) => path.split(".")
  .reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), record);

function vertexRecords(text) {
  if (utf8ByteLength(text) > MAX_DELIMITED_BYTES) return null;
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length || lines.length > MAX_DELIMITED_ROWS) return null;
  const records = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      records.push(parsed);
    } catch {
      // A file whose lines are not all JSON objects is not this contract's
      // newline-delimited shape, so it is never claimed as a damaged Vertex
      // export; it goes back to the router as unrecognized.
      return null;
    }
  }
  return records;
}

const claimsVertex = (records) => records !== null
  && vertexContract().exportShape.signatureFields
    .every((path) => records.some((record) => valueAt(record, path) !== undefined));

/** Direction from the SKU description, which is where Vertex names it. */
const vertexDirection = (description) => (/output|generated/i.test(String(description ?? "")) ? "output"
  : /input|prompt|context/i.test(String(description ?? "")) ? "input" : null);

export function adaptVertexExport(text) {
  const contract = vertexContract();
  const records = vertexRecords(requireText(text));
  if (!claimsVertex(records)) return incompatible(contract, UNSUPPORTED_CODES.WRONG_PROVIDER);
  const prohibited = prohibitedAmong(records.flatMap((record) => Object.keys(record)));
  if (prohibited.length) {
    return incompatible(contract, UNSUPPORTED_CODES.PROMPT_CONTENT,
      { prohibitedFields: Object.freeze(prohibited) });
  }
  const missing = contract.requiredFields.map((field) => field.path)
    .filter((path) => !records.some((record) => valueAt(record, path) !== undefined));
  if (missing.length) return incomplete(contract, missing);

  const rows = [];
  for (const record of records) {
    const reading = canonicalRow({
      date: valueAt(record, pathFor(contract, FIELD_ROLES.TIMESTAMP)),
      scope: valueAt(record, pathFor(contract, FIELD_ROLES.SCOPE)),
      model: valueAt(record, pathFor(contract, FIELD_ROLES.MODEL)),
      amount: valueAt(record, pathFor(contract, FIELD_ROLES.COST)),
      currency: valueAt(record, pathFor(contract, FIELD_ROLES.CURRENCY)),
      usage: valueAt(record, pathFor(contract, FIELD_ROLES.UNITS)),
      unit: valueAt(record, "usage.unit") ?? "",
      direction: vertexDirection(valueAt(record, "sku.description")),
    });
    if (reading.ok) rows.push(reading.row);
  }
  return finish(contract, "google", rows, records.length);
}

// --- Azure OpenAI · actual cost (JSON envelope) ----------------------------

const azureContract = () => contractById("azure-openai");

function azureRows(text) {
  if (utf8ByteLength(text) > MAX_DELIMITED_BYTES) return null;
  if (!text.trimStart().startsWith("{")) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const rows = parsed?.properties?.rows;
  if (!Array.isArray(rows) || rows.length > MAX_DELIMITED_ROWS) return null;
  return rows.filter((row) => row && typeof row === "object" && !Array.isArray(row));
}

/**
 * The envelope structure is the marker for an empty export, and the signature
 * fields are the marker for a populated one. Both are needed: a subscription
 * rollup with no rows at all still has to be reported as Azure's own case
 * rather than as an anonymous no-match.
 */
const claimsAzure = (rows) => rows !== null && (rows.length === 0
  || azureContract().exportShape.signatureFields
    .every((path) => rows.some((row) => valueAt(row, path) !== undefined)));

/**
 * The Azure meter names the deployment and the token direction in one string —
 * "gpt-4o-mini Input Tokens". The contract says so but does not say how to
 * split it, so the rule is here and it is conservative: a trailing direction
 * phrase is removed and read as the direction, and a meter that does not end in
 * one keeps its whole name as the model with the direction absent.
 */
const AZURE_METER = new RegExp("^(.*?)[\\s-]*(?:(1k|1,000|thousand|1m|million)\\s+)?"
  + "(input|output|prompt|completion|cached input)\\s+(tokens?|requests?|invocations?)$", "i");

/** The unit a meter name states when it states nothing else. */
const azureMeterUnit = (text) => (/invocation|request/i.test(text) ? "requests"
  : /1m|million/i.test(text) ? "1m tokens"
    : /1k|1,000|thousand/i.test(text) ? "1k tokens" : "tokens");

function azureMeter(meterName) {
  const text = String(meterName ?? "").trim();
  const matched = AZURE_METER.exec(text);
  if (!matched) return { model: text, direction: null, unit: azureMeterUnit(text) };
  const [, model, scale, direction, noun] = matched;
  return {
    // The rate multiple belongs to the meter, not to the deployment: a
    // "gpt-4o 1K Input Tokens" meter is the same model as "gpt-4o Input
    // Tokens", and folding them under two names would split one model's spend.
    model: model.trim() || text,
    direction: /output|completion/i.test(direction) ? "output" : "input",
    unit: /request|invocation/i.test(noun) ? "requests"
      : scale ? `${/1m|million/i.test(scale) ? "1m" : "1k"} tokens` : "tokens",
  };
}

export function adaptAzureOpenAiExport(text) {
  const contract = azureContract();
  const rows = azureRows(requireText(text));
  if (!claimsAzure(rows)) return incompatible(contract, UNSUPPORTED_CODES.WRONG_PROVIDER);
  const prohibited = prohibitedAmong(rows.flatMap((row) => Object.keys(row)));
  if (prohibited.length) {
    return incompatible(contract, UNSUPPORTED_CODES.PROMPT_CONTENT,
      { prohibitedFields: Object.freeze(prohibited) });
  }
  if (!rows.length) {
    return refusal(contract, HYPERSCALER_OUTCOME.INCOMPLETE, UNSUPPORTED_CODES.EMPTY,
      { missingFields: [], sourceRows: 0, skippedRows: 0 });
  }
  const missing = contract.requiredFields.map((field) => field.path)
    .filter((path) => !rows.some((row) => valueAt(row, path) !== undefined));
  if (missing.length) return incomplete(contract, missing);

  const canonical = [];
  for (const row of rows) {
    const meter = azureMeter(valueAt(row, pathFor(contract, FIELD_ROLES.MODEL)));
    const reading = canonicalRow({
      date: valueAt(row, pathFor(contract, FIELD_ROLES.TIMESTAMP)),
      scope: valueAt(row, pathFor(contract, FIELD_ROLES.SCOPE)),
      model: meter.model,
      amount: valueAt(row, pathFor(contract, FIELD_ROLES.COST)),
      currency: valueAt(row, pathFor(contract, FIELD_ROLES.CURRENCY)),
      usage: valueAt(row, pathFor(contract, FIELD_ROLES.UNITS)),
      unit: meter.unit,
      direction: meter.direction,
    });
    if (reading.ok) canonical.push(reading.row);
  }
  return finish(contract, "azure", canonical, rows.length);
}

// --- the registry ----------------------------------------------------------

/**
 * Declared order is the tie-break order, exactly as `PROVIDER_ADAPTERS` in the
 * intake contract does it. It is never exercised: the three `claims` predicates
 * are structurally disjoint and a test proves no fixture is claimed twice, so
 * the order is a determinism guarantee rather than a preference.
 */
export const HYPERSCALER_ADAPTERS = Object.freeze(
  BROWSER_COMPAT_MANIFEST.contracts.map((contract) => Object.freeze({
    providerId: contract.providerId,
    label: contract.displayName,
    format: contract.exportShape.format,
    signatureFields: contract.exportShape.signatureFields,
    adapt: Object.freeze({
      bedrock: adaptBedrockExport,
      "vertex-ai": adaptVertexExport,
      "azure-openai": adaptAzureOpenAiExport,
    }[contract.providerId]),
    claims: Object.freeze({
      bedrock: (text) => bedrockTable(text) !== null && claimsBedrock(text),
      "vertex-ai": (text) => claimsVertex(vertexRecords(text)),
      "azure-openai": (text) => claimsAzure(azureRows(text)),
    }[contract.providerId]),
  })),
);

/**
 * Which adapter, if any, claims this export.
 *
 * Deterministic and non-overlapping: dispatch is on the contract's declared
 * format and signature fields, never on the file name, the media type, or a
 * confidence score. A file no contract claims returns null and the caller's
 * existing routing is untouched.
 */
export function recognizeHyperscalerExport(text) {
  if (typeof text !== "string" || text === "") return null;
  return HYPERSCALER_ADAPTERS.find((adapter) => adapter.claims(text)) ?? null;
}

/**
 * The dispatching adapter: recognize, then convert. Returns null when no
 * contract claims the export, so a caller can fall through to its own routing
 * without having to know what these three exports look like.
 */
export function adaptHyperscalerExport(text) {
  const adapter = recognizeHyperscalerExport(text);
  return adapter ? adapter.adapt(text) : null;
}
