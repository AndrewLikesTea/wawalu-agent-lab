// Deterministic, browser-local adapters from a hyperscaler provider export —
// AWS Bedrock, Google Vertex AI, Azure OpenAI — into the canonical v1.1
// provider-usage-billing projection the rest of this product already reads.
//
// WHAT IT NEVER DOES. No fetch, no credential, no storage, no worker, no clock,
// and no randomness. Every identifier it emits is a digest of values that came
// out of the file, every date it stamps is a date the file stated, and the
// snapshot's `generated_at` is the period boundary rather than a reading of the
// host clock. The same input bytes therefore produce a byte-identical document
// on every machine on every day, which is the property the whole confidence
// story downstream rests on.
//
// WHAT IT REUSES RATHER THAN RESTATES.
//   • The provider shapes come from `browser-compat-contracts.js` (#934). This
//     module names no column: it asks the matched contract for the field paths
//     by ROLE, so a fourth published contract is adapted without editing here.
//     The one per-contract fact below is PROVIDER_BY_CONTRACT — which member of
//     the canonical `provider` enum a contract's export belongs to — because
//     that mapping is not derivable from a shape.
//   • Recognition comes from `export-recognition.js` (#938). There is no second
//     detector: which provider a file is, whether it is complete, and whether it
//     is confident enough to project are that module's answers, and this one
//     only decides what to do with them.
//   • The canonical envelope is validated by `parseLocalFinopsFile`. A document
//     this module builds is handed to the same reviewed validator every other
//     import path goes through, so "canonical" is checked rather than claimed.
//
// THE THREE RESULTS. Every call returns exactly one of `projected`,
// `incomplete`, or `incompatible`. Nothing throws a string, nothing returns
// null, and nothing returns a projection with a zero standing where a field was
// missing: a recognized export that cannot answer is `incomplete`, and a file
// that is not this provider's export at all is `incompatible`. The two are
// separate because the reader's next action is different — re-export with the
// missing columns, versus choose a different file.
//
// UNITS AND MONEY. Money is integer USD cents (`cost.amount_minor`), the unit
// the canonical contract already uses; no second currency and no float dollar
// total exists anywhere below. Usage is an integer count of a canonical unit.
// The three providers disagree about how they say which meter a row came from,
// so the disagreement is normalized here, at the adapter boundary, and each
// conversion is documented where it happens.

import {
  BROWSER_COMPAT_MANIFEST, FIELD_ROLES, UNSUPPORTED_CODES, contractById,
} from "./browser-compat-contracts.js";
import { parseExportText } from "./browser-compat-eligibility.js";
import {
  RECOGNITION_BANDS, RECOGNITION_OUTCOMES, recognizeExport,
} from "./export-recognition.js";
// The canonical month key, imported rather than restated: the verdict's month
// count must bucket exactly the way the period series buckets, or a check would
// promise a movement the series then declines to compute.
import { canonicalPeriod } from "./finops-imported-period-series.js";
import { LOCAL_KINDS, parseLocalFinopsFile } from "./local-finops.js";
import {
  ABSENT, PROVIDER_USAGE_SCHEMA_VERSION, usageDetail,
} from "./provider-usage-record.js";
import { orgUnitPseudonym, unitDigest, unitKey } from "./unit-pseudonym.js";

export const HYPERSCALER_ADAPTER_VERSION = "hyperscaler-export-adapter/1.0.0";

/**
 * Every export adapted here declares the same source instance, because that is
 * what it is: one local translation layer, not any provider's billing system.
 * Two adapted periods reconcile into a trend with each other, and the
 * multi-provider contract still separates them by provider identity.
 */
export const HYPERSCALER_SOURCE_INSTANCE_ID = "psn_hyperscaler_local_adapter_v1_0001";

/** The three discriminants. A caller branches on exactly these. */
export const HYPERSCALER_RESULT = Object.freeze({
  PROJECTED: "projected",
  INCOMPLETE: "incomplete",
  INCOMPATIBLE: "incompatible",
});

/**
 * Machine-readable reasons. The five shared with the published manifest keep the
 * manifest's own spelling so a caller branches once; the three below it are
 * states the manifest has no case for and are declared here rather than
 * smuggled into one of its codes.
 */
export const HYPERSCALER_CODES = Object.freeze({
  ...UNSUPPORTED_CODES,
  AMBIGUOUS_IDENTITY: "ambiguous_provider_identity",
  UNSUPPORTED_CURRENCY: "unsupported_currency",
  CANONICAL_REJECTED: "canonical_contract_rejected",
});

/**
 * Which member of the canonical `provider` enum each published contract's export
 * belongs to. The only per-contract fact in this module: a contract states a
 * shape, and no shape can state which vendor the canonical projection files it
 * under. A contract absent from this map is recognized and not adapted.
 */
const PROVIDER_BY_CONTRACT = Object.freeze({
  bedrock: "aws",
  "vertex-ai": "google",
  "azure-openai": "azure",
});

/** The one currency the canonical contract adds up. Nothing is converted. */
const ADAPTER_CURRENCY = "USD";

// ---------------------------------------------------------------- conversions

/**
 * A decimal cost as integer cents, or null when the cell is not a decimal
 * amount this adapter will read.
 *
 * String arithmetic, never `value * 100`: 4.815 in binary floating point is
 * slightly under 4.815, so multiplying rounds it down to 481 cents and a
 * reader's total is quietly a cent short per row. Digits are split instead and
 * the third decimal decides a half-up round, which is the rule every provider
 * console applies to its own displayed amount.
 */
export function centsFromDecimal(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  const digits = `${fraction}000`.slice(0, 3);
  const cents = Number(whole) * 100 + Number(digits.slice(0, 2)) + (digits[2] >= "5" ? 1 : 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * A usage amount as a non-negative integer count, or null.
 *
 * Providers meter AI usage in whole tokens, requests, and images. A fractional
 * meter reading is therefore a row this adapter does not understand, and it is
 * reported as a skipped row rather than rounded into a count that would then be
 * summed with real ones. Integer counts also mean the summed quantity is exact:
 * no accumulated float error can move a total between two runs.
 */
export function countFromCell(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!/^\d+$/.test(text)) return null;
  const count = Number(text);
  return Number.isSafeInteger(count) ? count : null;
}

/** The leading ISO calendar day of a date or timestamp cell, or null. */
function isoDay(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const day = match[1];
  return new Date(`${day}T00:00:00Z`).toISOString().startsWith(day) ? day : null;
}

/** The next calendar day, so the export period stays half-open. */
function nextDay(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * The canonical usage unit a meter description names.
 *
 * The three providers state the meter in three places — Bedrock in
 * `lineItem/UsageType`, Vertex in `usage.unit`, Azure inside `meterName` — and
 * all three write the unit as a word inside that string. Matching the word is
 * the normalization: it is the only thing the three spellings share, and a
 * string naming no known meter stays `provider-units` rather than being called
 * tokens on a guess.
 */
const UNIT_RULES = Object.freeze([
  Object.freeze([/token/i, "tokens"]),
  Object.freeze([/request|invocation|\bcall/i, "requests"]),
  Object.freeze([/image/i, "images"]),
]);

export function unitFromMeter(meter) {
  const text = String(meter ?? "");
  return UNIT_RULES.find(([pattern]) => pattern.test(text))?.[1] ?? "provider-units";
}

/**
 * Which direction a token meter counts, or null when the meter does not say.
 * Absence here becomes an absent input/output split downstream, never a zero.
 */
export function directionFromMeter(meter) {
  const text = String(meter ?? "");
  if (/input|prompt/i.test(text)) return "input";
  if (/output|completion|response/i.test(text)) return "output";
  return null;
}

/** The canonical service category a model identifier falls in. */
const CATEGORY_RULES = Object.freeze([
  Object.freeze([/embed/i, "embedding"]),
  Object.freeze([/image|imagen|dall|canvas|stable.?diffusion/i, "image-generation"]),
]);

function categoryFromModel(model) {
  const text = String(model ?? "");
  return CATEGORY_RULES.find(([pattern]) => pattern.test(text))?.[1] ?? "text-generation";
}

// ---------------------------------------------------------------- field paths

const byRole = (contract, role) =>
  contract.requiredFields.find((field) => field.role === role) ?? null;

/**
 * The six required paths, plus the meter path, read off the contract by role.
 *
 * The meter is the contract's optional unit-role field when it declares one
 * (Bedrock's `lineItem/UsageType`, Vertex's `usage.unit`); when it declares
 * none, the model field is where the meter is stated (Azure writes the
 * direction into `meterName`). That rule is derived from the contract's own
 * declarations, so it holds for a fourth contract without an edit here.
 */
function pathsFor(contract) {
  const model = byRole(contract, FIELD_ROLES.MODEL);
  const optionalUnit = contract.optionalFields.find((field) => field.role === FIELD_ROLES.UNITS);
  return {
    date: byRole(contract, FIELD_ROLES.TIMESTAMP)?.path ?? null,
    model: model?.path ?? null,
    units: byRole(contract, FIELD_ROLES.UNITS)?.path ?? null,
    cost: byRole(contract, FIELD_ROLES.COST)?.path ?? null,
    currency: byRole(contract, FIELD_ROLES.CURRENCY)?.path ?? null,
    scope: byRole(contract, FIELD_ROLES.SCOPE)?.path ?? null,
    meter: optionalUnit?.path ?? model?.path ?? null,
  };
}

// ---------------------------------------------------------------- results

function incompatible(code, { providerId = null, displayName = null, recognition = null,
  message, action }) {
  return Object.freeze({
    status: HYPERSCALER_RESULT.INCOMPATIBLE,
    adapterVersion: HYPERSCALER_ADAPTER_VERSION,
    providerId, displayName, code, message, action, recognition,
    confidence: recognition?.confidence ?? 0,
  });
}

function incomplete(code, { providerId, displayName, recognition, missingFields = [],
  message, action }) {
  return Object.freeze({
    status: HYPERSCALER_RESULT.INCOMPLETE,
    adapterVersion: HYPERSCALER_ADAPTER_VERSION,
    providerId, displayName, code,
    missingFields: Object.freeze([...missingFields]),
    message, action, recognition,
    confidence: recognition?.confidence ?? 0,
  });
}

// ---------------------------------------------------------------- projection

/**
 * Fold the file's records into canonical aggregates.
 *
 * The canonical grain is day × org unit × provider × service category, coarser
 * than a provider's own line item, so several rows land in one record. A row
 * this adapter cannot read whole — unreadable day, cost, or count, or a
 * currency the canonical contract does not add up — is skipped and counted; it
 * never contributes a partial aggregate.
 */
function foldRecords(records, contract, provider) {
  const paths = pathsFor(contract);
  const groups = new Map();
  let skipped = 0;
  let foreignCurrency = 0;
  for (const row of records) {
    const day = isoDay(row?.[paths.date]);
    const amountMinor = centsFromDecimal(row?.[paths.cost]);
    const quantity = countFromCell(row?.[paths.units]);
    const currency = String(row?.[paths.currency] ?? "").trim().toUpperCase();
    if (currency && currency !== ADAPTER_CURRENCY) {
      foreignCurrency += 1;
      skipped += 1;
      continue;
    }
    if (day === null || amountMinor === null || quantity === null) {
      skipped += 1;
      continue;
    }
    const model = String(row?.[paths.model] ?? "").trim();
    const meter = String(row?.[paths.meter] ?? "");
    const unit = unitFromMeter(meter);
    const direction = unit === "tokens" ? directionFromMeter(meter) : null;
    const category = categoryFromModel(model);
    const scope = row?.[paths.scope];
    const key = `${day}|${unitKey(scope)}|${provider}|${category}`;
    const group = groups.get(key) ?? {
      usage_date: day,
      org_unit_id: orgUnitPseudonym(scope),
      provider,
      service_category: category,
      amountMinor: 0,
      quantity: 0,
      unit,
      // Model identity survives folding only while the folded rows agree. Two
      // models in one aggregate make it absent, never whichever came first: the
      // canonical grain is coarser than the model, so a picked winner would read
      // as a fact about spend that no row supports.
      model,
      inputTokens: null,
      outputTokens: null,
      requests: null,
    };
    group.amountMinor += amountMinor;
    group.quantity += quantity;
    if (group.model !== model) group.model = "";
    // Rows metered in different units cannot be summed under one unit word, so
    // a mixed aggregate falls back to the provider's own units. That is honest:
    // the count is then a total of the provider's meters and is labelled as one.
    if (group.unit !== unit) group.unit = "provider-units";
    if (direction === "input") group.inputTokens = (group.inputTokens ?? 0) + quantity;
    if (direction === "output") group.outputTokens = (group.outputTokens ?? 0) + quantity;
    if (unit === "requests") group.requests = (group.requests ?? 0) + quantity;
    groups.set(key, group);
  }
  return { groups: [...groups.values()], skipped, foreignCurrency };
}

/** Code-unit order. Host collation settings cannot change this answer. */
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function buildDocument(groups, { providerId, skipped }) {
  const ordered = [...groups].sort((left, right) =>
    compare(left.usage_date, right.usage_date)
    || compare(left.org_unit_id, right.org_unit_id)
    || compare(left.provider, right.provider)
    || compare(left.service_category, right.service_category));
  const records = ordered.map((group, index) => ({
    aggregate_id: `psn_agg_${unitDigest(`${group.usage_date}|${group.org_unit_id}`
      + `|${group.provider}|${group.service_category}`)}${String(index).padStart(4, "0")}`,
    revision: 0,
    usage_date: group.usage_date,
    org_unit_id: group.org_unit_id,
    provider: group.provider,
    service_category: group.service_category,
    usage: { quantity: group.quantity, unit: group.unit },
    // A hyperscaler billing export states charges that have been metered, so the
    // canonical status is `final`. Nothing here promotes an estimate: an export
    // that carries no billed amount does not reach this point at all.
    cost: { amount_minor: group.amountMinor, currency: ADAPTER_CURRENCY, status: "final" },
    ...usageDetail({
      model: group.model || ABSENT,
      requestCount: group.requests ?? ABSENT,
      inputTokens: group.inputTokens ?? ABSENT,
      outputTokens: group.outputTokens ?? ABSENT,
    }),
  }));
  const days = records.map((record) => record.usage_date).sort(compare);
  const periodStart = days[0];
  const periodEnd = nextDay(days.at(-1));
  const totalMinor = records.reduce((sum, record) => sum + record.cost.amount_minor, 0);
  return {
    schema_version: PROVIDER_USAGE_SCHEMA_VERSION,
    kind: LOCAL_KINDS.provider,
    export_id: deterministicExportId(
      `${providerId}|${periodStart}|${periodEnd}|${records.length}|${totalMinor}`),
    snapshot: {
      source_instance_id: HYPERSCALER_SOURCE_INSTANCE_ID,
      sequence: 0,
      // The period boundary, never a clock. `generated_at` has to be a fact
      // about the export for the projection to be reproducible, and the latest
      // day the file covers is the only generation fact the file states.
      generated_at: `${periodEnd}T00:00:00Z`,
      period_start: periodStart,
      period_end: periodEnd,
      completeness: skipped > 0 ? "partial" : "complete",
      omitted_record_count: skipped,
      issues: [],
    },
    privacy: {
      aggregation: "daily-org-unit-service",
      // The contract's k-anonymity floor is a property of the SOURCE, which a
      // billing export cannot prove. The adapter asserts the declared minimum
      // and this comment is where that assumption is stated; no account, project
      // or resource name survives `orgUnitPseudonym` into the record.
      minimum_group_size: 10,
      direct_identifiers_included: false,
      content_included: false,
    },
    records,
  };
}

/** A UUID-shaped identifier derived from the export's own content. */
function deterministicExportId(seed) {
  const hex = `${unitDigest(seed)}${unitDigest(`${seed}:tail`)}`;
  return [
    hex.slice(0, 8), hex.slice(8, 12), `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`, hex.slice(20, 32),
  ].join("-");
}

// ---------------------------------------------------------------- entry point

const BODY_SIGNAL = "conversation_body_present";

/**
 * Adapt one hyperscaler export into the canonical projection.
 *
 * @param text      the file's own text, already read in the reader's tab.
 * @param fileName  used only to decide the file's format, never echoed back.
 * @param providerId optional. When a caller has already asserted which provider
 *   the reader chose, a file that recognizes as a different one is a wrong-
 *   provider rejection rather than a silent re-attribution.
 * @returns one frozen result whose `status` is a member of HYPERSCALER_RESULT.
 */
export function adaptHyperscalerExport({ text = "", fileName = "", providerId = null } = {}) {
  return adaptParsedExport(parseExportText(text, fileName), { providerId });
}

/**
 * The same adaptation from an already-parsed export — `{ ok, format, fieldNames,
 * records }`, the one shape the recognition pass and the eligibility evaluator
 * already agree on. Exported so a caller that has parsed the file once does not
 * parse it twice, and so the recognition fixtures drive this module directly.
 */
export function adaptParsedExport(parsed, { providerId = null } = {}) {
  const recognition = recognizeExport(parsed);
  const detected = recognition.providerId;
  const contract = detected ? contractById(detected) : null;
  const carriesBody = recognition.evidence.some((entry) => entry.signalId === BODY_SIGNAL);

  if (providerId && detected !== providerId) {
    const asked = contractById(providerId);
    return incompatible(HYPERSCALER_CODES.WRONG_PROVIDER, {
      providerId: detected, displayName: contract?.displayName ?? null, recognition,
      message: asked
        ? `This file does not match the ${asked.displayName} contract, so it was not adapted.`
        : "No published contract is named by that provider id, so nothing was adapted.",
      action: recognition.nextAction,
    });
  }

  if (recognition.outcome === RECOGNITION_OUTCOMES.INCOMPATIBLE || !contract) {
    return incompatible(
      carriesBody ? HYPERSCALER_CODES.PROMPT_CONTENT : HYPERSCALER_CODES.WRONG_PROVIDER, {
        providerId: detected, displayName: contract?.displayName ?? null, recognition,
        message: carriesBody
          ? "The export carries conversation bodies and was refused rather than stripped."
          : "No published provider contract claims this file, so nothing was adapted.",
        action: recognition.nextAction,
      });
  }

  if (recognition.outcome === RECOGNITION_OUTCOMES.AMBIGUOUS) {
    return incompatible(HYPERSCALER_CODES.AMBIGUOUS_IDENTITY, {
      providerId: detected, displayName: contract.displayName, recognition,
      message: `This file carries a second provider's signature columns beside `
        + `${contract.displayName}'s, so no figure in it can be attributed.`,
      action: recognition.nextAction,
    });
  }

  const fieldNames = new Set(parsed?.fieldNames ?? []);
  const rows = Array.isArray(parsed?.records) ? parsed.records : [];
  const missingFields = contract.requiredFields
    .map((field) => field.path)
    .filter((path) => !fieldNames.has(path));

  // The confidence gate is Theo's, applied rather than reimplemented: only an
  // export the recognition pass calls RECOGNIZED and lands in the accepted band
  // is projected. Everything short of that is the incomplete class, which the
  // caller surfaces — never a projection with zeros standing in for the answer.
  if (recognition.outcome !== RECOGNITION_OUTCOMES.RECOGNIZED
    || recognition.band !== RECOGNITION_BANDS.ACCEPTED) {
    return incomplete(HYPERSCALER_CODES.UNMODELED_VARIANT, {
      providerId: detected, displayName: contract.displayName, recognition, missingFields,
      message: missingFields.length
        ? `${contract.displayName} was recognized, but the export is missing `
          + `${missingFields.length} required field`
          + `${missingFields.length === 1 ? "" : "s"}: ${missingFields.join(", ")}. `
          + "No projection was produced."
        : `${contract.displayName} was recognized at confidence ${recognition.confidence} of `
          + `${recognition.maxConfidence}, below the accepted band. No projection was produced.`,
      action: recognition.nextAction,
    });
  }

  const provider = PROVIDER_BY_CONTRACT[detected] ?? null;
  if (!provider) {
    return incompatible(HYPERSCALER_CODES.UNMODELED_VARIANT, {
      providerId: detected, displayName: contract.displayName, recognition,
      message: `${contract.displayName} is a published contract with no canonical provider `
        + "mapping in this build, so it was recognized and not adapted.",
      action: "Choose an export from a provider this build adapts.",
    });
  }

  const { groups, skipped, foreignCurrency } = foldRecords(rows, contract, provider);
  if (!groups.length) {
    const currencyOnly = foreignCurrency > 0 && foreignCurrency === skipped;
    return currencyOnly
      ? incompatible(HYPERSCALER_CODES.UNSUPPORTED_CURRENCY, {
        providerId: detected, displayName: contract.displayName, recognition,
        message: `Every ${contract.displayName} row is priced in another currency. Amounts are `
          + "never converted for you, so nothing was adapted.",
        action: `Re-export ${contract.displayName} billed in ${ADAPTER_CURRENCY}, or analyze `
          + "that period on its own.",
      })
      : incomplete(HYPERSCALER_CODES.EMPTY, {
        providerId: detected, displayName: contract.displayName, recognition,
        message: `${contract.displayName} was recognized, but none of its ${skipped} record`
          + `${skipped === 1 ? "" : "s"} carried a readable day, amount, and count. `
          + "No projection was produced.",
        action: recognition.nextAction,
      });
  }

  const document = buildDocument(groups, { providerId: detected, skipped });
  let validated;
  try {
    // The same reviewed validator every other import path goes through. A
    // document this module builds wrong is refused here, in this tab, rather
    // than reaching the projection as a canonical-looking envelope.
    validated = parseLocalFinopsFile(
      JSON.stringify(document), "hyperscaler-export.json", "application/json");
  } catch (error) {
    return incompatible(HYPERSCALER_CODES.CANONICAL_REJECTED, {
      providerId: detected, displayName: contract.displayName, recognition,
      message: `The ${contract.displayName} export normalized into a document the v1 provider `
        + `contract refused (${error?.code ?? "invalid_value"}). No analysis was run.`,
      action: "Report this export shape; nothing about the file was retained.",
    });
  }

  const acceptedRows = rows.length - skipped;
  return Object.freeze({
    status: HYPERSCALER_RESULT.PROJECTED,
    adapterVersion: HYPERSCALER_ADAPTER_VERSION,
    providerId: detected,
    displayName: contract.displayName,
    contractVersion: contract.contractVersion,
    recognition,
    confidence: recognition.confidence,
    parsed: validated,
    document: validated.document,
    normalization: Object.freeze({
      sourceRows: parsed.records.length,
      acceptedRows,
      skippedRows: skipped,
      foreignCurrencyRows: foreignCurrency,
      aggregateCount: validated.document.records.length,
    }),
    message: `${contract.displayName} export adapted locally: ${acceptedRows} of `
      + `${rows.length} rows became ${validated.document.records.length} canonical `
      + `aggregate${validated.document.records.length === 1 ? "" : "s"}`
      + `${skipped ? `, ${skipped} skipped` : ""}.`,
  });
}

/** Which published contracts this build adapts, for a caller listing them. */
export const ADAPTED_PROVIDER_IDS = Object.freeze(BROWSER_COMPAT_MANIFEST.contracts
  .map((entry) => entry.providerId)
  .filter((id) => id in PROVIDER_BY_CONTRACT));

// ---------------------------------------------------------------- preflight
//
// CHECK ONLY. `preflight` answers "would this export analyze?" and does nothing
// else: it runs the SAME `recognizeExport` pass `adaptParsedExport` runs — there
// is still exactly one recognition code path — counts rows and periods, reads
// the matched contract's required columns, and returns a verdict. It builds no
// document, touches no storage, and reads no module-level state, so calling it
// is not a smaller import: it is not an import at all.
//
// It introduces NO scoring. Confidence, bands and outcomes stay where they are.

/**
 * Why the check answered as it did. The three refusals are the adapter's own
 * codes rather than a second vocabulary, so a caller that already branches on
 * `HYPERSCALER_CODES` branches on these without a translation table.
 */
export const PREFLIGHT_REASONS = Object.freeze({
  READY: "ready",
  UNRECOGNIZED_PROVIDER: HYPERSCALER_CODES.WRONG_PROVIDER,
  MISSING_REQUIRED_COLUMN: HYPERSCALER_CODES.UNMODELED_VARIANT,
  EMPTY_EXPORT: HYPERSCALER_CODES.EMPTY,
});

/**
 * Which missing column the one instruction names when several are missing.
 *
 * The money column outranks everything: an export with no amount answers no
 * FinOps question at all, while an export with no scope column answers a
 * narrower one. The rest follow how much of the analysis each removes.
 */
export const PREFLIGHT_COLUMN_PRIORITY = Object.freeze([
  FIELD_ROLES.COST, FIELD_ROLES.UNITS, FIELD_ROLES.TIMESTAMP,
  FIELD_ROLES.MODEL, FIELD_ROLES.CURRENCY, FIELD_ROLES.SCOPE,
]);

const SUPPORTED_CONSOLES = ADAPTED_PROVIDER_IDS
  .map((id) => contractById(id).displayName).join(", ");

/**
 * One export with no usage rows in it, whichever way it got there: a file with
 * no bytes has no columns to be unrecognized about, and a file with the right
 * columns and no rows has nothing to add up. Both need the same thing done.
 */
const EMPTY_ACTION = "Re-pull the export over a billing period that has usage in it: this file "
  + "carries no usage rows to check.";

const UNRECOGNIZED_ACTION = "Re-pull a usage export from one of the consoles this build adapts — "
  + `${SUPPORTED_CONSOLES} — as none of their signature columns are in this file.`;

/** The highest-priority missing required column, by role then contract order. */
function firstMissingColumn(contract, missing) {
  for (const role of PREFLIGHT_COLUMN_PRIORITY) {
    const field = contract.requiredFields.find(
      (entry) => entry.role === role && missing.includes(entry.path));
    if (field) return field.path;
  }
  return missing[0] ?? null;
}

/**
 * ONE instruction, never a list and never a paragraph. Highest priority first:
 * an unrecognized provider, then the missing required column, then an export
 * with no rows, then the ready case.
 */
function preflightAction(reason, { contract, missing }) {
  if (reason === PREFLIGHT_REASONS.UNRECOGNIZED_PROVIDER) return UNRECOGNIZED_ACTION;
  if (reason === PREFLIGHT_REASONS.MISSING_REQUIRED_COLUMN) {
    return `Re-pull the ${contract.displayName} export with the `
      + `${firstMissingColumn(contract, missing)} column included, then check it again.`;
  }
  if (reason === PREFLIGHT_REASONS.EMPTY_EXPORT) return EMPTY_ACTION;
  return `Nothing to fix. Import this ${contract.displayName} export to run the analysis.`;
}

/**
 * Check one already-parsed export without importing it.
 *
 * @param parsed `{ ok, format, fieldNames, records }` — the same shape
 *   `adaptParsedExport` takes and `parseExportText` produces. Never a File,
 *   never text this function has to parse itself.
 * @returns a FRESH frozen verdict every call — `{ provider, displayName,
 *   rowCount, periodCount, missingColumns, namedColumn, reason, nextAction }`.
 *   `provider` is null when no published contract claims the file. Nothing is
 *   shared between two calls and nothing in it is computed lazily.
 *
 *   `namedColumn` is the ONE column `nextAction` tells the reader to re-pull
 *   with, published beside the instruction rather than left to be read out of
 *   its sentence: a surface that names the missing column in its own words
 *   (#1064) must name the same one the instruction does, and ranking the
 *   missing columns a second time is how two surfaces come to name two.
 */
export function preflight(parsed) {
  const recognition = recognizeExport(parsed);
  const contract = recognition.providerId ? contractById(recognition.providerId) : null;
  const fieldNames = Array.isArray(parsed?.fieldNames) ? parsed.fieldNames.map(String) : [];
  const names = new Set(fieldNames);
  const records = Array.isArray(parsed?.records) ? parsed.records : [];
  const missing = contract
    ? contract.requiredFields.map((field) => field.path).filter((path) => !names.has(path))
    : [];

  // The periods the analysis would fold these rows into: the distinct calendar
  // days the file itself states, counted through the same reader the projection
  // uses. A row whose date cell is unreadable is in no period and is not one.
  const datePath = contract ? byRole(contract, FIELD_ROLES.TIMESTAMP)?.path ?? null : null;
  const periods = new Set();
  // The BILLING MONTHS those days fall in, counted in the same pass. A day count
  // and a month count are different answers to "how much of a range is this?" —
  // twenty daily rows are twenty days and one month — and the movement figure is
  // withheld or earned on the MONTH count (#1065). The key is
  // `canonicalPeriod`'s, so this counts the same buckets the series does.
  const months = new Set();
  if (datePath) {
    for (const row of records) {
      const day = isoDay(row?.[datePath]);
      if (day) periods.add(day);
      const month = canonicalPeriod(day);
      if (month) months.add(month);
    }
  }

  const reason = !contract
    ? (records.length === 0 && fieldNames.length === 0
      ? PREFLIGHT_REASONS.EMPTY_EXPORT : PREFLIGHT_REASONS.UNRECOGNIZED_PROVIDER)
    : missing.length ? PREFLIGHT_REASONS.MISSING_REQUIRED_COLUMN
      : records.length === 0 ? PREFLIGHT_REASONS.EMPTY_EXPORT
        : PREFLIGHT_REASONS.READY;

  return Object.freeze({
    provider: recognition.providerId,
    displayName: contract?.displayName ?? null,
    rowCount: records.length,
    periodCount: periods.size,
    monthCount: months.size,
    // The header the reader's own units are keyed on, so a caller can ask which
    // OTHER columns in this file could name them. Named rather than re-derived:
    // a second lookup of the scope role is a second answer waiting to happen.
    scopeColumn: contract ? byRole(contract, FIELD_ROLES.SCOPE)?.path ?? null : null,
    missingColumns: Object.freeze(missing),
    namedColumn: reason === PREFLIGHT_REASONS.MISSING_REQUIRED_COLUMN
      ? firstMissingColumn(contract, missing) : null,
    reason,
    nextAction: preflightAction(reason, { contract, missing }),
  });
}
