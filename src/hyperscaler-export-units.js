// The one unit, rounding, and envelope layer the three hyperscaler adapters share.
//
// WHY IT IS ONE MODULE. The issue behind these adapters is cross-provider
// comparability: a Bedrock dollar, a Vertex AI dollar, and an Azure OpenAI
// dollar have to land in the same integer, and a token has to mean a token in
// all three. If each adapter scaled its own money, rounded its own tokens, and
// truncated its own timestamps, comparability would be a coincidence that holds
// until one of the three is edited. Here it is a property of the code: the
// adapters read contract fields and hand rows to `buildProviderProjection`,
// which is the only thing in this repository that turns a hyperscaler row into
// a v1 provider aggregate.
//
// NO SECOND IMPLEMENTATION. Money scaling (`toMinorUnits`), date resolution
// (`parseExportDate`), the service-category rule, the deterministic export id,
// and the pseudonym digest are imported from the modules that already own them.
// This module adds the three things none of them knows about: the token-unit
// vocabulary a hyperscaler meter is printed in, the rule that a contract
// declaring "ISO date" gets an ISO date and nothing else, and the fold from
// per-row readings to the aggregate grain the v1 contract declares.
//
// NO I/O AND NO CLOCK. Nothing here fetches, stores, or reads a wall clock.
// `generated_at` is derived from the latest usage date in the export itself, so
// the same bytes produce the same envelope on every machine on every day.

import {
  ANALYSIS_CURRENCY, exportId, mapServiceCategory, parseExportDate, toMinorUnits,
} from "./finops-tabular-import.js";
import { LOCAL_KINDS } from "./local-finops.js";
import {
  ABSENT, PROVIDER_USAGE_SCHEMA_VERSION, usageDetail,
} from "./provider-usage-record.js";
import { orgUnitPseudonym, unitDigest, unitKey } from "./unit-pseudonym.js";

export const HYPERSCALER_NORMALIZATION_VERSION = "hyperscaler-export-normalization/1.0.0";

/**
 * Every hyperscaler adapter declares the same source instance, because that is
 * what it is: one translation layer, not three billing systems. Two periods
 * from different hyperscalers therefore reconcile with each other and never
 * silently merge with a delimited import or a real provider export's source.
 */
export const HYPERSCALER_SOURCE_INSTANCE_ID = "psn_hyperscaler_export_v1_0001";

/** The date formats a contract that says "ISO date" is allowed to be printed in. */
const ISO_DATE_FORMATS = Object.freeze(["iso_date", "iso_datetime"]);

/**
 * THE TOKEN-UNIT VOCABULARY. Hyperscaler meters are not all counted in tokens:
 * Azure prices several deployments per 1,000 tokens and Vertex prints some SKUs
 * per million, so the printed amount is a *rate multiple*, not a count. Summing
 * those beside a raw token count is a 1,000× error that reads like a busy month.
 *
 * Keys are normalized unit strings (lower-cased, punctuation collapsed to a
 * single space). `scale` converts the printed amount into tokens; `unit` is the
 * v1 contract's usage unit the row lands in.
 */
export const USAGE_UNIT_SCALES = Object.freeze({
  "": Object.freeze({ unit: "tokens", scale: 1 }),
  token: Object.freeze({ unit: "tokens", scale: 1 }),
  tokens: Object.freeze({ unit: "tokens", scale: 1 }),
  "token count": Object.freeze({ unit: "tokens", scale: 1 }),
  "1k tokens": Object.freeze({ unit: "tokens", scale: 1_000 }),
  "1000 tokens": Object.freeze({ unit: "tokens", scale: 1_000 }),
  "thousand tokens": Object.freeze({ unit: "tokens", scale: 1_000 }),
  kilotokens: Object.freeze({ unit: "tokens", scale: 1_000 }),
  "1m tokens": Object.freeze({ unit: "tokens", scale: 1_000_000 }),
  "1000000 tokens": Object.freeze({ unit: "tokens", scale: 1_000_000 }),
  "million tokens": Object.freeze({ unit: "tokens", scale: 1_000_000 }),
  megatokens: Object.freeze({ unit: "tokens", scale: 1_000_000 }),
  // A bare count: the noun is not a token, so the row lands in the contract's
  // catch-all unit rather than being counted as one.
  count: Object.freeze({ unit: "provider-units", scale: 1 }),
  counts: Object.freeze({ unit: "provider-units", scale: 1 }),
  unit: Object.freeze({ unit: "provider-units", scale: 1 }),
  units: Object.freeze({ unit: "provider-units", scale: 1 }),
  request: Object.freeze({ unit: "requests", scale: 1 }),
  requests: Object.freeze({ unit: "requests", scale: 1 }),
  invocation: Object.freeze({ unit: "requests", scale: 1 }),
  invocations: Object.freeze({ unit: "requests", scale: 1 }),
});

/** Header and unit spellings collapse the same way everywhere: one rule. */
export function normalizeUnitName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A printed usage amount as a whole count in the v1 contract's own unit.
 *
 * Rounding is half-up on the scaled value, and it happens exactly once, here.
 * A unit string the vocabulary above does not declare is refused rather than
 * assumed to be tokens: guessing the scale is the error this table exists to
 * prevent, and an unreadable row is reported and skipped, never inferred.
 */
export function normalizeUsageAmount(amount, unit = "") {
  const declared = USAGE_UNIT_SCALES[normalizeUnitName(unit)];
  if (!declared) return { ok: false, reason: "unsupported_usage_unit" };
  const text = String(amount ?? "").trim().replace(/[\s,]/g, "");
  if (text === "") return { ok: false, reason: "empty" };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, reason: "not_a_number" };
  const scaled = Number(text) * declared.scale;
  if (!Number.isFinite(scaled) || !Number.isSafeInteger(Math.round(scaled))) {
    return { ok: false, reason: "out_of_range" };
  }
  return { ok: true, quantity: Math.round(scaled), unit: declared.unit, scale: declared.scale };
}

/**
 * A printed cost as integer minor units, or a reason it is not one.
 *
 * The scaling itself is `toMinorUnits`, which does it by string surgery and
 * BigInt rather than by multiplying a float. What this adds is the analysis
 * currency rule: the v1 analysis combines one currency and this layer holds no
 * exchange rate, so a foreign-currency row is refused with its own reason
 * instead of being added to a USD total behind the reader.
 */
export function normalizeCostAmount(amount, currency) {
  const code = String(currency ?? "").trim().toUpperCase();
  if (code === "") return { ok: false, reason: "currency_missing" };
  if (code !== ANALYSIS_CURRENCY) return { ok: false, reason: "unsupported_currency" };
  const money = toMinorUnits(amount, code);
  return money.ok
    ? { ok: true, amountMinor: money.amountMinor, currency: code }
    : { ok: false, reason: money.reason };
}

/**
 * One timestamp granularity for all three: the calendar day the charge is
 * recorded against, in UTC, as the contracts declare it.
 *
 * Strict on purpose. `parseExportDate` also reads `03/04/2026`, month-first, so
 * a spreadsheet round trip can move spend into the wrong month; a contract that
 * declares "ISO date" is held to an ISO date and any other printed form is a
 * reported reason rather than a guess.
 */
export function normalizeUsageDay(value) {
  const resolved = parseExportDate(value);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  if (!ISO_DATE_FORMATS.includes(resolved.format)) {
    return { ok: false, reason: `date_printed_as_${resolved.format}` };
  }
  return { ok: true, date: resolved.date };
}

/** The half-open period's exclusive end: the day after the last usage day. */
export function nextDay(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Code-unit order. Host collation settings cannot change this answer. */
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const canonical = (value) => JSON.stringify(value);

/**
 * Fold accepted rows into the v1 provider envelope.
 *
 * Rows arrive already normalized — day, scope label, model string, integer
 * minor units, integer usage — so this function makes no unit decision at all.
 * It decides three things, once, for every hyperscaler:
 *
 *   1. THE GRAIN. One record per day × org unit × provider × service category,
 *      which is what `privacy.aggregation` declares, so the declaration is true
 *      by construction rather than by assertion.
 *   2. MODEL IDENTITY UNDER FOLDING. A model string survives a fold only while
 *      the folded rows agree; two models in one aggregate make it absent rather
 *      than whichever row came first.
 *   3. THE TOKEN SPLIT. Input and output totals are carried only when every
 *      accepted row said which direction it was. A partially directional export
 *      reports the combined count and leaves the split absent — nothing here
 *      derives a split from a ratio.
 *
 * `generated_at` comes from the export's own latest usage day. There is no
 * clock in this path, so the same bytes always produce the same envelope.
 */
export function buildProviderProjection({
  adapterId, provider, rows, skippedRows = 0,
}) {
  const groups = new Map();
  for (const row of rows) {
    const category = mapServiceCategory(row.model);
    const key = `${row.date}|${unitKey(row.scope)}|${provider}|${category}`;
    const group = groups.get(key) ?? {
      usage_date: row.date,
      org_unit_id: orgUnitPseudonym(row.scope),
      provider,
      service_category: category,
      amountMinor: 0,
      quantity: 0,
      unit: row.unit,
      model: row.model,
      inputTotal: 0,
      outputTotal: 0,
      directional: true,
    };
    group.amountMinor += row.amountMinor;
    group.quantity += row.quantity;
    // Two meters of different units inside one aggregate cannot be added into a
    // single count that means anything, so the aggregate falls back to the
    // contract's catch-all unit rather than claiming the first row's unit.
    if (group.unit !== row.unit) group.unit = "provider-units";
    if (group.model !== row.model) group.model = ABSENT;
    if (row.direction === "input") group.inputTotal += row.quantity;
    else if (row.direction === "output") group.outputTotal += row.quantity;
    else group.directional = false;
    groups.set(key, group);
  }

  const records = [...groups.values()]
    .sort((left, right) => compare(left.usage_date, right.usage_date)
      || compare(left.org_unit_id, right.org_unit_id)
      || compare(left.service_category, right.service_category))
    .map((group, index) => ({
      aggregate_id: `psn_agg_${unitDigest(`${group.usage_date}|${group.org_unit_id}|`
        + `${group.provider}|${group.service_category}`)}${String(index).padStart(4, "0")}`,
      revision: 0,
      usage_date: group.usage_date,
      org_unit_id: group.org_unit_id,
      provider: group.provider,
      service_category: group.service_category,
      usage: { quantity: group.quantity, unit: group.unit },
      cost: { amount_minor: group.amountMinor, currency: ANALYSIS_CURRENCY, status: "final" },
      ...usageDetail({
        model: group.model,
        // A billing export counts meters, not calls. Absent is the contract's
        // one spelling of "the export does not report this"; zero would be a
        // count these files never made.
        requestCount: ABSENT,
        inputTokens: group.directional ? group.inputTotal : ABSENT,
        outputTokens: group.directional ? group.outputTotal : ABSENT,
      }),
    }));
  if (!records.length) return null;

  const dates = records.map((record) => record.usage_date).sort(compare);
  const latest = dates.at(-1);
  return {
    schema_version: PROVIDER_USAGE_SCHEMA_VERSION,
    kind: LOCAL_KINDS.provider,
    // Seeded from the projected content rather than from the file name: the
    // same export renamed is the same export, and two different exports never
    // collide on one id.
    export_id: exportId(`${adapterId}|${unitDigest(canonical(records))}|${records.length}`),
    snapshot: {
      source_instance_id: HYPERSCALER_SOURCE_INSTANCE_ID,
      sequence: 0,
      // Derived from the export, never from the host clock.
      generated_at: `${latest}T00:00:00.000Z`,
      period_start: dates[0],
      period_end: nextDay(latest),
      completeness: skippedRows ? "partial" : "complete",
      omitted_record_count: skippedRows,
      issues: [],
    },
    privacy: {
      aggregation: "daily-org-unit-service",
      // The contract's k-anonymity floor is a property of the source, which a
      // billing export cannot prove. The adapters assert the declared minimum
      // and the import surface says so, exactly as the delimited path does.
      minimum_group_size: 10,
      direct_identifiers_included: false,
      content_included: false,
    },
    records,
  };
}
