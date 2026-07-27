// The provider-usage record contract: version, model identity, and call shape.
//
// This module is the single source of truth for the fields the v1.1
// provider-usage-billing record adds over v1.0, and for the tier vocabulary a
// model string may be classified into. The validator (`local-finops.js`), the
// delimited importer (`finops-tabular-import.js`), and any downstream consumer
// all read the vocabulary and the absent rule from here. There is deliberately
// no second copy of either.
//
// WHY THIS EXISTS. v1.0's aggregate grain is day × org unit × provider ×
// service category with a single blended `usage.quantity`. A reader whose own
// export names the model, counts the calls, and splits the tokens loses all
// three at the contract boundary, so every downstream question about *which*
// model costs what has to be answered by guessing or not at all. v1.1 carries
// those four facts, and carries them as absence when the export does not.
//
// ABSENCE IS A VALUE. The one representation of "the export does not report
// this" is `null` (`ABSENT`). It is never `0`, never `""`, never a key left
// off: a v1.1 record always carries all five keys, and a consumer that reads
// `request_count === 0` is reading a genuine zero the provider emitted. A v1.0
// record carries none of the keys and reads back as absent through
// `readUsageDetail`, which is what makes the migration additive.
//
// NO SYNTHESIS. Where a provider emits one combined token total and no split,
// the combined figure stays in `usage.quantity` where v1.0 already put it and
// `input_tokens`/`output_tokens` are absent. Nothing here derives a split from
// a ratio, a default, or a sibling row.
//
// PRIVACY. A model identifier is a vendor SKU string, not content and not a
// person: `model_raw` is carried verbatim so an unrecognized row is
// diagnosable. It is bounded (`MAX_MODEL_IDENTIFIER_LENGTH`) and rejected if it
// carries control characters, so no unbounded free text can enter the record
// through this door, and no validation message ever echoes a cell value.

/** The contract kind these records live in. */
export const PROVIDER_USAGE_CONTRACT_KIND = "wawalu.integration.provider-usage-billing";

/** The version this module produces. */
export const PROVIDER_USAGE_SCHEMA_VERSION = "1.1";

/** The version it succeeds. Still accepted, unchanged in meaning. */
export const PREVIOUS_PROVIDER_USAGE_SCHEMA_VERSION = "1.0";

/** Every version the validator accepts, oldest first. Additive only. */
export const SUPPORTED_PROVIDER_USAGE_SCHEMA_VERSIONS = Object.freeze([
  PREVIOUS_PROVIDER_USAGE_SCHEMA_VERSION, PROVIDER_USAGE_SCHEMA_VERSION,
]);

/** The one representation of "the export does not report this". Never 0. */
export const ABSENT = null;

/** True for the absent marker and for nothing else — 0 is not absent. */
export function isAbsent(value) {
  return value === ABSENT;
}

/**
 * THE TIER VOCABULARY. Closed, declared once, and including `unrecognized` as a
 * first-class member rather than as a failure. A record's tier is always one of
 * these four when a model string was carried.
 *
 * This is a *name-shape* vocabulary: it says what the vendor called the model,
 * not what the reader paid for it. The price-derived tier in
 * `down-routing-candidates.js` is a different question with a different answer,
 * and this field never overrides it.
 */
export const MODEL_TIERS = Object.freeze(["premium", "standard", "economy", "unrecognized"]);

/** The member every unmatched model string lands in. Never a nearest guess. */
export const UNRECOGNIZED_TIER = "unrecognized";

/**
 * THE RULES. Ordered; the first whose pattern matches the lower-cased model
 * string wins, and declaration order *is* the tie-break — there is no score, no
 * edit distance, and no nearest-looking match. A string that matches nothing
 * becomes `unrecognized` and keeps its raw value.
 *
 * NO SOURCE: these are naming conventions this repository observed in vendor
 * model identifiers, not a rate card. This repository ships no vendor price
 * list and reaches no vendor API. A reader who disagrees with a classification
 * can see the raw string beside it and say so.
 */
export const MODEL_TIER_RULES = Object.freeze([
  Object.freeze({
    id: "economy-suffixes",
    tier: "economy",
    pattern: /(^|[^a-z0-9])(mini|nano|lite|micro|flash|haiku|instant)([^a-z0-9]|$)/,
    note: "Vendors mark their cheapest variant with a size word, and mark it last: "
      + "`gpt-4o-mini` is economy even though `gpt-4o` is premium, so this rule is declared first.",
  }),
  Object.freeze({
    id: "premium-families",
    tier: "premium",
    pattern: /(^|[^a-z0-9])(opus|ultra|gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o1|o3)([^a-z0-9]|$)/,
    note: "Family names a vendor prices at the top of its own line.",
  }),
  Object.freeze({
    id: "standard-families",
    tier: "standard",
    pattern: /(^|[^a-z0-9])(sonnet|pro|gpt-4|gpt-3\.5)([^a-z0-9]|$)/,
    note: "Mid-line family names, matched only after the two rules above.",
  }),
]);

/**
 * The longest model identifier that may enter a record. Vendor SKUs are short;
 * the bound exists so a mis-mapped free-text column cannot smuggle a paragraph
 * into the contract under the name of a model.
 */
export const MAX_MODEL_IDENTIFIER_LENGTH = 200;

/** C0 controls and DEL, tested by code point so no literal control character
 * has to appear in this file. A model identifier carries none of them. */
function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * The raw cell as a carryable model identifier, or `ABSENT`.
 *
 * Carryable means: non-empty after trimming the surrounding whitespace a CSV
 * writer adds, within the length bound, and free of control characters. The
 * value is otherwise preserved exactly — case, punctuation, version suffixes
 * and all — because the raw string is what makes an unrecognized row
 * diagnosable. Nothing is truncated: an over-long value is not carried at all
 * rather than carried wrong.
 */
export function carryableModelString(raw) {
  if (typeof raw !== "string") return ABSENT;
  const value = raw.trim();
  if (!value || value.length > MAX_MODEL_IDENTIFIER_LENGTH) return ABSENT;
  if (hasControlCharacter(value)) return ABSENT;
  return value;
}

/**
 * The declared tier for a model string. Always a `MODEL_TIERS` member: a value
 * that matches no rule — including one that could not be carried at all — is
 * `unrecognized`, never the nearest-looking tier and never a default.
 */
export function classifyModelTier(raw) {
  const value = carryableModelString(raw);
  if (value === ABSENT) return UNRECOGNIZED_TIER;
  const lowered = value.toLowerCase();
  return MODEL_TIER_RULES.find((rule) => rule.pattern.test(lowered))?.tier ?? UNRECOGNIZED_TIER;
}

/**
 * Model identity for a record: the verbatim string and its tier, or both
 * absent when no model string could be carried. The two travel together — a
 * tier without its raw string is an assertion a reader cannot check.
 */
export function modelIdentity(raw) {
  const value = carryableModelString(raw);
  return value === ABSENT
    ? { model_raw: ABSENT, model_tier: ABSENT }
    : { model_raw: value, model_tier: classifyModelTier(value) };
}

/** The five keys v1.1 adds to a record, in their declared order. */
export const USAGE_DETAIL_KEYS = Object.freeze([
  "model_raw", "model_tier", "request_count", "input_tokens", "output_tokens",
]);

/** Every new field absent. The shape a v1.0 record reads back as. */
export const ABSENT_USAGE_DETAIL = Object.freeze({
  model_raw: ABSENT, model_tier: ABSENT,
  request_count: ABSENT, input_tokens: ABSENT, output_tokens: ABSENT,
});

function count(value) {
  return Number.isFinite(value) && value >= 0 ? value : ABSENT;
}

/**
 * Build the v1.1 detail block for a record.
 *
 * Every argument defaults to absent, so a producer that knows only the model
 * says only the model. A count that is not a non-negative finite number is
 * absent rather than zero: the caller either counted or it did not.
 */
export function usageDetail({
  model = ABSENT, requestCount = ABSENT, inputTokens = ABSENT, outputTokens = ABSENT,
} = {}) {
  return Object.freeze({
    ...modelIdentity(model),
    request_count: count(requestCount),
    input_tokens: count(inputTokens),
    output_tokens: count(outputTokens),
  });
}

/**
 * Read the v1.1 fields off any accepted record, at either version.
 *
 * This is the migration: a v1.0 record has none of the keys and reads back as
 * `ABSENT_USAGE_DETAIL`, so a consumer written against v1.1 never has to ask
 * which version it was handed, and never sees an undefined.
 */
export function readUsageDetail(record) {
  if (!record || typeof record !== "object") return ABSENT_USAGE_DETAIL;
  return Object.freeze(Object.fromEntries(USAGE_DETAIL_KEYS.map((key) =>
    [key, record[key] === undefined ? ABSENT : record[key]])));
}

/**
 * Validate the v1.1 fields of one record.
 *
 * @returns {{code: string, field: string}|null} a machine-readable problem, or
 *   null. The field name is returned; the offending value never is.
 */
export function usageDetailProblem(record, schemaVersion) {
  if (schemaVersion !== PROVIDER_USAGE_SCHEMA_VERSION) {
    const carried = USAGE_DETAIL_KEYS.find((key) => key in record);
    return carried ? { code: "unknown_field", field: carried } : null;
  }
  const missing = USAGE_DETAIL_KEYS.find((key) => !(key in record));
  if (missing) return { code: "missing_field", field: missing };

  const { model_raw: rawModel, model_tier: tier } = record;
  if (rawModel !== ABSENT && carryableModelString(rawModel) !== rawModel) {
    return { code: "invalid_value", field: "model_raw" };
  }
  if (rawModel === ABSENT ? tier !== ABSENT : !MODEL_TIERS.includes(tier)) {
    return { code: "invalid_value", field: "model_tier" };
  }
  if (record.request_count !== ABSENT
    && (!Number.isInteger(record.request_count) || record.request_count < 0)) {
    return { code: "invalid_value", field: "request_count" };
  }
  for (const key of ["input_tokens", "output_tokens"]) {
    if (record[key] !== ABSENT && !(Number.isFinite(record[key]) && record[key] >= 0)) {
      return { code: "invalid_value", field: key };
    }
  }
  return null;
}

/**
 * How many records landed in the `unrecognized` tier. Carried through the
 * import result so a later screen can surface the number: a model this build
 * cannot name is a fact about the reader's export, not an error to swallow.
 */
export function countUnrecognizedModels(records) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => readUsageDetail(record).model_tier === UNRECOGNIZED_TIER).length;
}
