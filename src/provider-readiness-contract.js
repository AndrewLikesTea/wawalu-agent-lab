// The errand layer above the column layer (#1062): what a finance or platform
// lead has to ask their billing-account owner for, per provider, before this
// page has anything to read.
//
// `export-provider-detection.js` already knows which five exports this demo
// recognizes and which columns name each one. It knows nothing about where the
// file comes from: which console screen writes it, which period to pull, and
// what one accepted row actually looks like. That was the gap — a reader who
// has never pulled their own AI spend export could learn that we accept five
// providers only by dropping a file and being refused.
//
// THREE RULES HOLD HERE, and the third is the one that keeps this file honest:
//
//   1. No column name is written in this file. Every `requiredColumns` entry is
//      READ from PROVIDER_ORDER — the same declaration detection scores against
//      — so a contract revision reaches this module without editing it, and a
//      guidance card cannot name a column the importer does not accept.
//   2. No format is assumed. The five exports are NOT all CSV: Vertex AI arrives
//      as newline-delimited JSON and Azure OpenAI as a JSON envelope, so the
//      sample this module serializes is the shape that provider's adapter
//      parses, not a house shape with a provider's columns in it.
//   3. The provider id set is checked against the recognition source AT MODULE
//      LOAD. Adding a sixth provider to one and not the other throws on import
//      — the page fails to boot and the build fails — rather than shipping a
//      guidance list that quietly names four of five.
//
// Nothing here reaches a provider. There is no endpoint, no credential, and no
// redirect: the reader downloads their own export from their own console. Pure
// data plus pure functions — no DOM, no Blob, no clock, no I/O — so the exact
// bytes the download control hands a reader are unit-testable in Node.

import { DETECTABLE_PROVIDER_IDS, PROVIDER_ORDER } from "./export-provider-detection.js";
import { FIELD_ROLES, contractById } from "./browser-compat-contracts.js";

/** This module's own identity. Independent of any one provider's contract. */
export const PROVIDER_READINESS_VERSION = "provider-readiness/1.0.0";

/**
 * Said on the surface, not only here: the whole of what this page does with a
 * provider export. Kept beside the guidance so the page cannot word the promise
 * differently from the contract that makes it.
 */
export const STATIC_DEMO_DISCLOSURE = "This is a static demo. No credential is "
  + "requested, no provider account is connected, and no file is transmitted "
  + "anywhere: every sample below is generated in this tab, and an export you "
  + "choose is read in this tab and never leaves it.";

/**
 * The boundary, said once, in the one place both affordances can read it (#1067).
 *
 * STATIC_DEMO_DISCLOSURE above is about the SAMPLES: nothing is connected and
 * every download is generated here. This is about the reader's OWN file, and it
 * is a different promise — it covers the check and the full analysis together,
 * and it names retention, which a "nothing is uploaded" sentence does not.
 *
 * It lives here rather than in the surface that renders it so the page cannot
 * word the promise differently from the module that makes it, and so a test can
 * hold the rendered text and this constant to the same string. Kept to one
 * sentence: it is always visible, never folded, and a paragraph in that position
 * is a paragraph a reader skips.
 */
export const LOCAL_PROCESSING_STATEMENT = "The check and the analysis both run in "
  + "this browser: no network request is made, no credential is asked for, and the "
  + "file you drop is not retained.";

// The order columns are stated in — for a reader, for the CSV header, and for
// the JSON keys. Role order first because it is the order a person reads a
// billing row in; a signature column that carries no billing role (an account
// or organization identifier) follows, because it names the console rather than
// the charge.
const ROLE_SEQUENCE = Object.freeze([
  FIELD_ROLES.TIMESTAMP, FIELD_ROLES.MODEL, FIELD_ROLES.UNITS,
  FIELD_ROLES.COST, FIELD_ROLES.CURRENCY, FIELD_ROLES.SCOPE,
]);

const MEDIA_TYPES = Object.freeze({
  csv: "text/csv",
  json: "application/json",
  jsonl: "application/x-ndjson",
});

/**
 * The errand, per provider. Everything in here is what a CONSOLE does, not what
 * a column is called: console paths, periods, one plausible cell per billing
 * role, and — where the export is a JSON envelope — where its records sit.
 *
 * `roleValues` is keyed by role rather than by column name on purpose. Keying it
 * by column name would be retyping the column list this module refuses to
 * retype, and would let a sample drift from the contract one key at a time.
 * `signatureValues` fills the signature columns that carry no billing role, in
 * the order that provider declares them.
 */
const ERRANDS = Object.freeze({
  "azure-openai": Object.freeze({
    displayName: "Azure OpenAI",
    consoleLocation: "Azure portal → Cost Management + Billing → Cost Management → "
      + "Exports → Create export → scope the subscription your Azure OpenAI resource "
      + "lives in, choose type “Actual cost”, then download the file the export "
      + "writes to its storage container.",
    dateRangeGuidance: "One calendar month that has already closed — the 1st to the "
      + "last day of last month. Azure restates the current month until it closes, so "
      + "a month-to-date export changes under you.",
    // Declared here because it is a packaging fact, not a column: the contract's
    // recordLocation says the same thing in prose and a test holds the two together.
    recordPath: "properties.rows",
    roleValues: Object.freeze({
      [FIELD_ROLES.TIMESTAMP]: "2026-06-01",
      [FIELD_ROLES.MODEL]: "gpt-4o Input Tokens",
      [FIELD_ROLES.UNITS]: 1250000,
      [FIELD_ROLES.COST]: 18.75,
      [FIELD_ROLES.CURRENCY]: "USD",
      [FIELD_ROLES.SCOPE]: "/subscriptions/00000000-0000-0000-0000-000000000000"
        + "/resourceGroups/ai-platform/providers/Microsoft.CognitiveServices"
        + "/accounts/contoso-openai",
    }),
    signatureValues: Object.freeze([]),
  }),
  "vertex-ai": Object.freeze({
    displayName: "Google Vertex AI",
    consoleLocation: "Google Cloud console → Billing → your billing account → Billing "
      + "export → BigQuery export → Detailed usage cost. Query that table for the "
      + "Vertex AI service and export the result as newline-delimited JSON (JSONL).",
    dateRangeGuidance: "A full closed calendar month. Google finalizes a month a few "
      + "days after it ends, so pull last month rather than the one in progress.",
    recordPath: null,
    roleValues: Object.freeze({
      [FIELD_ROLES.TIMESTAMP]: "2026-06-01T00:00:00Z",
      [FIELD_ROLES.MODEL]: "gemini-2.5-pro",
      [FIELD_ROLES.UNITS]: 980000,
      [FIELD_ROLES.COST]: 21.4,
      [FIELD_ROLES.CURRENCY]: "USD",
      [FIELD_ROLES.SCOPE]: "ai-platform-prod",
    }),
    signatureValues: Object.freeze([]),
  }),
  bedrock: Object.freeze({
    displayName: "AWS Bedrock",
    consoleLocation: "AWS Billing and Cost Management console → Data Exports → Create "
      + "a standard data export (Cost and Usage Report 2.0) with the product and "
      + "resource columns included, then download the CSV it writes to S3 and keep "
      + "the rows whose service is Bedrock.",
    dateRangeGuidance: "One whole billing period — a calendar month. AWS restates a "
      + "period for several days after it closes, so pull the last period that has "
      + "finished rather than the open one.",
    recordPath: null,
    roleValues: Object.freeze({
      [FIELD_ROLES.TIMESTAMP]: "2026-06-01",
      [FIELD_ROLES.MODEL]: "anthropic.claude-sonnet-4",
      [FIELD_ROLES.UNITS]: 1420000,
      [FIELD_ROLES.COST]: 22.72,
      [FIELD_ROLES.CURRENCY]: "USD",
      [FIELD_ROLES.SCOPE]: "000000000001",
    }),
    signatureValues: Object.freeze([]),
  }),
  aws: Object.freeze({
    displayName: "AWS Cost and Usage Report",
    consoleLocation: "AWS Billing and Cost Management console → Data Exports → the "
      + "same standard data export as above, downloaded WITHOUT filtering to one "
      + "service. This is the whole-account report: it names a service per row and "
      + "no model, so it answers what AI cost, not which model did.",
    dateRangeGuidance: "One whole billing period — a calendar month — and the same "
      + "period for every account you export, so two accounts are never compared "
      + "across different windows.",
    recordPath: null,
    roleValues: Object.freeze({
      // Deliberately a non-Bedrock service: this report and the Bedrock slice
      // above are separated by whether a model is named, and a sample naming
      // Bedrock here would be the other provider's file with this one's label.
      [FIELD_ROLES.TIMESTAMP]: "2026-06-01",
      [FIELD_ROLES.MODEL]: "AmazonComprehend",
      [FIELD_ROLES.UNITS]: 1420000,
      [FIELD_ROLES.COST]: 22.72,
      [FIELD_ROLES.CURRENCY]: "USD",
      [FIELD_ROLES.SCOPE]: "000000000001",
    }),
    // Fills bill/BillingPeriodStartDate: the column that says this is a whole
    // report rather than a hand-cut slice of one.
    signatureValues: Object.freeze(["2026-06-01"]),
  }),
  openai: Object.freeze({
    displayName: "OpenAI",
    consoleLocation: "OpenAI platform → Settings → Organization → Usage → the Export "
      + "control on the costs view. Choose the export that carries a cost amount per "
      + "day, model, and project; a usage-only export has no money in it and is "
      + "refused for that reason.",
    dateRangeGuidance: "A complete month, or the two most recent complete months if "
      + "you want a period-over-period comparison. Leave today out: the current day "
      + "is still accruing.",
    recordPath: null,
    roleValues: Object.freeze({
      [FIELD_ROLES.TIMESTAMP]: "2026-06-01",
      [FIELD_ROLES.MODEL]: "gpt-4o",
      [FIELD_ROLES.UNITS]: 1250000,
      [FIELD_ROLES.COST]: 18.75,
      [FIELD_ROLES.CURRENCY]: "USD",
      [FIELD_ROLES.SCOPE]: "proj_ai_platform",
    }),
    // Fills organization_id: the column that names the OpenAI organization.
    signatureValues: Object.freeze(["org-demo0000000000"]),
  }),
});

// ---------------------------------------------------------------- derivation

const detectionEntry = (id) => PROVIDER_ORDER.find((entry) => entry.provider === id) ?? null;

/**
 * One provider's required columns, read from the recognition source. Billing
 * roles first, then the signature columns that carry no role. Nothing is
 * spelled here: every string comes out of PROVIDER_ORDER.
 */
function requiredColumnsFor(entry) {
  const columns = [];
  for (const role of ROLE_SEQUENCE) {
    const path = entry.roles[role] ?? null;
    if (path && !columns.includes(path)) columns.push(path);
  }
  for (const path of entry.signature) if (!columns.includes(path)) columns.push(path);
  return columns;
}

/**
 * The columns the adapter tolerates but does not require, read from the
 * published browser-compat contract. The two providers with no published
 * contract — the general AWS report and the OpenAI costs export — declare NONE
 * rather than an invented list: an optional column nothing publishes is a claim
 * this module has no source for, and a reader acting on it would be acting on
 * our guess about their console.
 */
function optionalColumnsFor(id) {
  const contract = contractById(id);
  return contract ? contract.optionalFields.map((field) => field.path) : [];
}

// The role a column plays, inverted from the detection entry so a sample value
// can be looked up by column without the column being named here.
function roleByColumn(entry) {
  const byColumn = new Map();
  for (const role of ROLE_SEQUENCE) {
    const path = entry.roles[role] ?? null;
    if (path && !byColumn.has(path)) byColumn.set(path, role);
  }
  return byColumn;
}

function sampleRowFor(entry, errand, requiredColumns) {
  const roles = roleByColumn(entry);
  const row = {};
  let extra = 0;
  for (const column of requiredColumns) {
    const role = roles.get(column) ?? null;
    row[column] = role ? errand.roleValues[role] : errand.signatureValues[extra++];
  }
  return row;
}

function readinessFor(id) {
  const entry = detectionEntry(id);
  const errand = ERRANDS[id];
  const requiredColumns = requiredColumnsFor(entry);
  const format = entry.format;
  return Object.freeze({
    id,
    displayName: errand.displayName,
    consoleLocation: errand.consoleLocation,
    dateRangeGuidance: errand.dateRangeGuidance,
    requiredColumns: Object.freeze(requiredColumns),
    optionalColumns: Object.freeze(optionalColumnsFor(id)),
    sampleRow: Object.freeze(sampleRowFor(entry, errand, requiredColumns)),
    sampleFormat: format,
    sampleMediaType: MEDIA_TYPES[format],
    sampleFilename: `wawalu-sample-${id}.${format}`,
    recordPath: errand.recordPath,
  });
}

/**
 * The five recognized providers, in the recognition source's own order, each
 * with the errand a reader hands to whoever owns the billing account.
 */
export const PROVIDER_READINESS = Object.freeze(
  DETECTABLE_PROVIDER_IDS.map((id) => readinessFor(id)));

export const providerReadinessById = (id) =>
  PROVIDER_READINESS.find((entry) => entry.id === id) ?? null;

// ---------------------------------------------------------------- the guard

/**
 * The divergence check, run at module load so it cannot be forgotten.
 *
 * A sixth provider added to detection and not to ERRANDS, or the reverse, is a
 * guidance list that names some of the exports we accept — the exact failure
 * this module exists to remove. It throws on import: the page does not boot and
 * the build does not pass, which is louder and earlier than a silent gap.
 */
export function assertProviderSetsAgree(
  detectable = DETECTABLE_PROVIDER_IDS, described = Object.keys(ERRANDS)) {
  const missing = detectable.filter((id) => !described.includes(id));
  const extra = described.filter((id) => !detectable.includes(id));
  if (missing.length || extra.length) {
    throw new Error(`${PROVIDER_READINESS_VERSION}: the readiness contract and `
      + "export-provider-detection.js name different providers."
      + (missing.length ? ` Recognized but undescribed: ${missing.join(", ")}.` : "")
      + (extra.length ? ` Described but unrecognized: ${extra.join(", ")}.` : ""));
  }
  return true;
}

assertProviderSetsAgree();

// ---------------------------------------------------------------- serializing

// RFC 4180: a field is quoted when it carries a delimiter, a quote, or a line
// break, and an inner quote is doubled. Applied to headers as well as cells,
// because a column name is a field too.
const csvField = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// A dotted path is a nesting instruction in JSON and a literal name everywhere
// else: `sku.model_id` is an object inside an object, while a CSV column called
// `lineItem/UnblendedCost` is one column with a slash in it.
function assignPath(target, path, value) {
  const segments = String(path).split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== "object") cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
  return target;
}

const nestedRecord = (readiness) => {
  const record = {};
  for (const column of readiness.requiredColumns) {
    assignPath(record, column, readiness.sampleRow[column]);
  }
  return record;
};

/**
 * One provider's sample row as the exact file text its adapter parses.
 *
 * CSV gets a header row in `requiredColumns` order and one data row in the same
 * order. JSONL gets one complete object on one line. JSON gets the envelope the
 * provider's contract declares, with the record where that contract says
 * records live. No DOM, no Blob: the download control wraps this, it does not
 * reimplement it.
 *
 * @param readiness a PROVIDER_READINESS entry, or a provider id.
 * @returns the file text, always ending in a newline.
 */
export function serializeProviderSample(readiness) {
  const entry = typeof readiness === "string" ? providerReadinessById(readiness) : readiness;
  if (!entry) return "";
  if (entry.sampleFormat === "csv") {
    const header = entry.requiredColumns.map(csvField).join(",");
    const row = entry.requiredColumns.map((column) => csvField(entry.sampleRow[column])).join(",");
    return `${header}\n${row}\n`;
  }
  const record = nestedRecord(entry);
  if (entry.sampleFormat === "jsonl") return `${JSON.stringify(record)}\n`;
  const envelope = entry.recordPath ? assignPath({}, entry.recordPath, [record]) : record;
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
