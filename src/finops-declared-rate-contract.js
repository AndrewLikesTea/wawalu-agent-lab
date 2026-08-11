// The declared-rate intake contract (#1481): a FinOps lead states the rates
// they are contracted to, and the pricing provenance beside the recoverable
// figure stops saying "list-price ceiling".
//
// WHAT THIS IS FOR. Since #1263 the page prices every destination at
// DEFAULT_REFERENCE_CARD — published list prices — and #1266 grades that
// honestly: `reference-published`, 66.8/100, Limited confidence, "the
// published-list reference card, not your contract". There was no way to move
// it, because there was no way to say
// what you actually pay. This module is that way in, and it is the ONLY new
// contract: what it produces is a rate card in the #1263 shape, handed to the
// SAME `scorePricingProvenance` and `confidenceFor` the first screen already
// renders. No second provenance scale exists, and none is invented here.
//
// ---------------------------------------------------------------------------
// THE SCHEMA, AND WHY IT CARRIES ITS VERSION
// ---------------------------------------------------------------------------
//
// A parse result carries `schemaVersion` — DECLARED_RATE_SCHEMA_VERSION —
// because a declaration is data a reader typed once and a later build reads
// again. A shape change that is not versioned is a shape change that is
// silently mis-read; a consumer compares the string and refuses what it does
// not know, rather than guessing at the field it cannot find.
//
// ONE RECORD IS FIVE FIELDS, and all five are required:
//
//   model         a destination identifier the loaded analysis prices
//   unit          one of DECLARED_RATE_UNITS — an enum, never free text
//   rate          US dollars, positive, at most RATE_MAX (the #1263 range)
//   effectiveDate an ISO 8601 calendar date, YYYY-MM-DD, real (not 2026-02-30)
//   sourceLabel   what a third party would go and check: an MSA, an order form
//
// Three input forms, one record shape out: a typed single entry (an object), a
// pasted JSON array, or a pasted line block — `model, unit, rate, date, label`,
// one per line, `#` comments and blank lines skipped, and everything after the
// fourth comma rejoined as the source label so "MSA 2026, Schedule B" survives.
//
// ---------------------------------------------------------------------------
// THE BOUNDARY: SYNTHETIC, LOCAL, AND NEITHER EVALUATED NOR STORED
// ---------------------------------------------------------------------------
//
// Nothing here fetches, evals, dynamically imports, or persists. JSON is read
// with `JSON.parse` inside a try, which builds data and never code. A field
// whose text reads like a credential (api key, token, secret, bearer,
// authorization) or like a person (an email address) is REFUSED with a message
// saying so — not stripped, not ignored. A rate card is a price list; a
// credential in one is a paste accident, and the honest response to a paste
// accident is to hand it back rather than to hold it.
//
// ---------------------------------------------------------------------------
// THE AWKWARD CASES, DECIDED HERE SO NO CALLER HAS TO GUESS
// ---------------------------------------------------------------------------
//
//   DUPLICATES — two records for one (model, unit). LAST EFFECTIVE DATE WINS:
//     a rate card is amended, and the amendment in force is the newest one that
//     has taken effect. The superseded record is reported, never dropped in
//     silence. A TIE — two records, same model, same unit, same effective date,
//     different rates — IS REJECTED as ambiguous: nothing in the submission says
//     which one is contracted, and picking either is a guess about money.
//   UNMATCHED — a record for a model the loaded analysis does not price. ACCEPTED
//     and REPORTED. A lead pasting their whole card is not making an error, and a
//     dropped line is a line they will believe was applied.
//   INCOMPLETE — a model with one of its two rates. NOT PRICED from the
//     declaration: half a contracted price is not a contracted price. The model
//     falls back to list, and is named in the fallback list, not hidden.
//   STALE — an old effective date. ACCEPTED, and surfaced: the #1266 age
//     criterion bands it and the attribution line states the date, so a reader
//     sees a two-year-old MSA rather than being refused one.
//   REORDERED — the same records in any order produce a byte-identical result.
//     Records are sorted by (model, unit) before anything reads them, so a paste
//     that came out of a spreadsheet in a different order is the same card.
//
// PURE. No clock, no I/O, no DOM. `asOf` is passed in; a caller that supplies
// none gets the `undated` age band, not a different answer on a different day.

import {
  DEFAULT_REFERENCE_CARD, RATE_CARD_CONTRACT_VERSION, confidenceFor, isCalendarDate,
} from "./finops-rate-card-contract.js";
import { PRICED_DESTINATIONS, scorePricingProvenance } from "./finops-pricing-provenance.js";

/** Bump when a field, an accepted unit, or what a record means changes. */
export const DECLARED_RATE_SCHEMA_VERSION = "finops-declared-rate/1.0.0";

/** The accepted units. An enum, so "per hour" is a rejection and not a guess. */
export const DECLARED_RATE_UNITS = Object.freeze([
  "usd-per-million-input", "usd-per-million-output",
]);

/** The five fields of one record, in the order a pasted line states them. */
export const DECLARED_RATE_FIELDS = Object.freeze([
  "model", "unit", "rate", "effectiveDate", "sourceLabel",
]);

/** The #1263 range, restated here so a rejection can name it before pricing does. */
export const RATE_MAX = 1000;

/** The one sentence every credential and contact refusal ends with. */
export const SYNTHETIC_BOUNDARY =
  "This boundary is synthetic and held locally only: no credential, no contact detail, and no "
  + "live provider connection.";

/** Text that reads like a credential. Whole words, so a source label may say "keys". */
const CREDENTIAL_PATTERNS = Object.freeze([
  /\bapi[\s_-]*keys?\b/i, /\btokens?\b/i, /\bsecrets?\b/i, /\bbearer\b/i, /\bauthorizations?\b/i,
]);

/** An email address, which is a person and not a price. */
const CONTACT_PATTERN = /[^\s@,]+@[^\s@,]+\.[^\s@,]+/;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value) => (value === null || value === undefined ? "" : String(value).trim());

/** Reader-facing names for the five fields. No field key ever reaches a reader. */
const FIELD_PHRASE = Object.freeze({
  model: "model", unit: "unit", rate: "rate",
  effectiveDate: "effective date", sourceLabel: "source label",
});

/** Where a problem is, in the words a reader can find it by. */
const at = (line, field) => (field
  ? `Line ${line}, ${FIELD_PHRASE[field] ?? field}:` : `Line ${line}:`);

// ---------------------------------------------------------------------------
// Reading the three input forms into raw, unvalidated records.
// ---------------------------------------------------------------------------

/** One pasted line into a raw record, or an error when it has too few fields. */
function readLine(line, lineNumber, errors) {
  const parts = line.split(",");
  if (parts.length < DECLARED_RATE_FIELDS.length) {
    errors.push({
      line: lineNumber, field: null, code: "wrong_field_count",
      message: `${at(lineNumber)} expected 5 comma-separated fields — model, unit, rate, `
        + `effective date, source label — but found ${parts.length}.`,
    });
    return null;
  }
  return {
    line: lineNumber,
    model: text(parts[0]),
    unit: text(parts[1]),
    rate: text(parts[2]),
    effectiveDate: text(parts[3]),
    // Everything past the fourth comma, so a label may carry one.
    sourceLabel: parts.slice(4).join(",").trim(),
  };
}

/** Raw records out of whichever of the three forms arrived, plus any read errors. */
function readInput(input, errors) {
  if (isRecord(input)) return [{ line: 1, ...input }];
  if (Array.isArray(input)) return input.map((entry, index) => ({ line: index + 1, ...entry }));
  const source = text(input);
  if (source === "") return [];
  if (source.startsWith("[") || source.startsWith("{")) {
    let parsed = null;
    try {
      // JSON.parse builds data. No eval, no Function, no dynamic import, ever.
      parsed = JSON.parse(source);
    } catch {
      errors.push({
        line: 1, field: null, code: "unparseable_json",
        message: "Line 1: this starts like JSON but is not valid JSON, so no record could be read.",
      });
      return [];
    }
    return readInput(Array.isArray(parsed) || isRecord(parsed) ? parsed : "", errors);
  }
  const records = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const record = readLine(trimmed, index + 1, errors);
    if (record) records.push(record);
  });
  return records;
}

// ---------------------------------------------------------------------------
// Validation. Every problem, never only the first.
// ---------------------------------------------------------------------------

/** A refusal when any of a record's text reads like a credential or a person. */
function boundaryErrors(record, errors) {
  for (const field of DECLARED_RATE_FIELDS) {
    const value = text(record[field]);
    if (value === "") continue;
    const credential = CREDENTIAL_PATTERNS.find((pattern) => pattern.test(value));
    if (credential) {
      errors.push({
        line: record.line, field, code: "credential_shaped",
        message: `${at(record.line, field)} refused — this reads like a credential. `
          + SYNTHETIC_BOUNDARY,
      });
      continue;
    }
    if (CONTACT_PATTERN.test(value)) {
      errors.push({
        line: record.line, field, code: "contact_shaped",
        message: `${at(record.line, field)} refused — this reads like an email address. `
          + SYNTHETIC_BOUNDARY,
      });
    }
  }
}

/** One raw record, validated field by field. Returns the clean record, or null. */
function validateRecord(record, errors) {
  const before = errors.length;
  boundaryErrors(record, errors);
  const model = text(record.model);
  const unit = text(record.unit);
  const effectiveDate = text(record.effectiveDate);
  const sourceLabel = text(record.sourceLabel);
  const rate = Number(text(record.rate));
  if (model === "") {
    errors.push({
      line: record.line, field: "model", code: "missing_model",
      message: `${at(record.line, "model")} a destination model identifier is required.`,
    });
  }
  if (!DECLARED_RATE_UNITS.includes(unit)) {
    errors.push({
      line: record.line, field: "unit", code: "unknown_unit",
      message: `${at(record.line, "unit")} "${unit}" is not an accepted unit — state one of `
        + `${DECLARED_RATE_UNITS.join(" or ")}.`,
    });
  }
  if (text(record.rate) === "" || !Number.isFinite(rate) || rate <= 0 || rate > RATE_MAX) {
    errors.push({
      line: record.line, field: "rate", code: "unusable_rate",
      message: `${at(record.line, "rate")} "${text(record.rate)}" is not a usable rate — state a `
        + `positive number of US dollars, at most ${RATE_MAX}.`,
    });
  }
  if (!isCalendarDate(effectiveDate)) {
    errors.push({
      line: record.line, field: "effectiveDate", code: "not_a_calendar_date",
      message: `${at(record.line, "effectiveDate")} "${effectiveDate}" is not a real ISO calendar `
        + "date — state it as YYYY-MM-DD.",
    });
  }
  if (sourceLabel === "") {
    errors.push({
      line: record.line, field: "sourceLabel", code: "missing_source_label",
      message: `${at(record.line, "sourceLabel")} name the contract this rate comes from, so a `
        + "reader outside this browser can check it.",
    });
  }
  if (errors.length !== before) return null;
  return { line: record.line, model, unit, rate, effectiveDate, sourceLabel };
}

/** Last effective date wins; a tie is ambiguous and rejects the submission. */
function resolveDuplicates(records, errors) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.model}|${record.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const kept = [];
  const superseded = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const ordered = [...group].sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
    const winner = ordered.at(-1);
    const tied = ordered.filter((entry) => entry.effectiveDate === winner.effectiveDate);
    if (tied.length > 1) {
      const lines = tied.map((entry) => entry.line).sort((a, b) => a - b);
      errors.push({
        line: lines[0], field: "effectiveDate", code: "ambiguous_duplicate",
        message: `Lines ${lines.join(" and ")}, effective date: ${winner.model} `
          + `${winner.unit} is declared more than once as of ${winner.effectiveDate}, so which `
          + "rate is contracted is ambiguous. Remove one, or date them apart.",
      });
      continue;
    }
    kept.push(winner);
    superseded.push(...ordered.slice(0, -1));
  }
  return { kept, superseded };
}

const byModelAndUnit = (a, b) => (a.model === b.model
  ? a.unit.localeCompare(b.unit) : a.model.localeCompare(b.model));

/**
 * Parse one rate declaration into a versioned, validated structure.
 *
 * @param input a record, an array of records, a pasted JSON block, or a pasted
 *   line block. Anything unreadable is a rejection with a message, never a throw.
 * @returns a frozen `{ schemaVersion, valid, records, superseded, errors }`.
 *   ONE INVALID RECORD REJECTS THE WHOLE SUBMISSION — a half-applied rate card
 *   prices some destinations at a contract and some at a guess, and nothing on
 *   the page would say which. `errors` carries EVERY problem, so a reader fixes
 *   the paste once rather than once per line.
 */
export function parseRateDeclaration(input) {
  const errors = [];
  const raw = readInput(input, errors);
  const validated = raw.map((record) => validateRecord(record, errors)).filter(Boolean);
  const { kept, superseded } = errors.length === 0
    ? resolveDuplicates(validated, errors)
    : { kept: [], superseded: [] };
  const valid = errors.length === 0 && kept.length > 0;
  return Object.freeze({
    schemaVersion: DECLARED_RATE_SCHEMA_VERSION,
    valid,
    // Sorted, so a reordered paste is the same declaration byte for byte.
    records: Object.freeze(valid ? kept.sort(byModelAndUnit).map((r) => Object.freeze(r)) : []),
    superseded: Object.freeze(superseded.sort(byModelAndUnit).map((r) => Object.freeze(r))),
    errors: Object.freeze(errors.map((error) => Object.freeze(error))),
  });
}

// ---------------------------------------------------------------------------
// The rate card, and the provenance the existing surface then scores.
// ---------------------------------------------------------------------------

/** The rate for one model and unit, or null. */
const rateOf = (records, model, unit) =>
  records.find((entry) => entry.model === model && entry.unit === unit) ?? null;

/**
 * A #1263 rate card built from a parsed declaration, or null when there is
 * nothing usable in it. Only models with BOTH rates are on it — see the header.
 */
export function rateCardFromDeclaration(declaration, destinations = PRICED_DESTINATIONS) {
  const records = declaration?.valid ? declaration.records : [];
  const models = destinations
    .map((destination) => {
      const input = rateOf(records, destination, DECLARED_RATE_UNITS[0]);
      const output = rateOf(records, destination, DECLARED_RATE_UNITS[1]);
      if (!input || !output) return null;
      const reference = DEFAULT_REFERENCE_CARD.models.find((m) => m.model === destination) ?? null;
      return Object.freeze({
        model: destination,
        label: reference?.label ?? destination,
        source: "contracted",
        contractedInputRate: input.rate,
        contractedOutputRate: output.rate,
        currency: "USD",
        // The stalest of the two, because a pair of rates is only as current as
        // the older half of it.
        effectiveDate: input.effectiveDate < output.effectiveDate
          ? input.effectiveDate : output.effectiveDate,
        committedUseDiscountPct: null,
        permitted: null,
      });
    })
    .filter(Boolean);
  if (models.length === 0) return null;
  return Object.freeze({
    contractVersion: RATE_CARD_CONTRACT_VERSION,
    cardId: "declared-contracted-rates",
    source: "contracted",
    sourceLabel: [...new Set(records.map((entry) => entry.sourceLabel))].sort().join("; "),
    models: Object.freeze(models),
  });
}

/** The three labels this surface may report, worst first. */
export const PROVENANCE_LABELS = Object.freeze(["List price", "Partial", "Declared"]);

const list = (parts) => (parts.length <= 1 ? (parts[0] ?? "")
  : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/** The attribution sentence: whose prices these are, from what, as of when. */
function attributionFor(card, fallback, unmatched, verdict) {
  const parts = [];
  if (!card) {
    parts.push("No contracted rate is declared for a destination this analysis prices, so every "
      + "one of them is priced at the published list — a ceiling, not your contract.");
  } else {
    const dates = [...new Set(card.models.map((model) => model.effectiveDate))].sort();
    parts.push(`Priced at declared contracted rates from ${card.sourceLabel}, effective `
      + `${list(dates)}.`);
  }
  if (card && fallback.length > 0) {
    parts.push(`${list(fallback)} ${fallback.length === 1 ? "is" : "are"} still priced at the `
      + "published list, because no complete pair of contracted rates was declared for "
      + `${fallback.length === 1 ? "it" : "them"}.`);
  }
  if (unmatched.length > 0) {
    parts.push(`${list(unmatched)} ${unmatched.length === 1 ? "was" : "were"} declared but `
      + "this analysis prices no such destination, so nothing was applied for "
      + `${unmatched.length === 1 ? "it" : "them"}.`);
  }
  if (card && ["stale", "expired"].includes(verdict.observed.ageBand)) {
    parts.push(`The oldest declared rate is ${verdict.observed.ageMonths} months old, which is `
      + "past the age at which a declaration still describes today's prices.");
  }
  return parts.join(" ");
}

/**
 * Recompute the first screen's pricing provenance from a parsed declaration.
 *
 * The score is `scorePricingProvenance`'s own 0–100 sub-score — the scale the
 * surface already publishes — taken over a card built from this declaration.
 * The label moves with it by construction: no declaration prices at the
 * reference card and scores what it always scored; a declaration covering some
 * destinations raises the source criterion and lowers coverage; one covering all
 * of them raises both.
 *
 * @param declaration a `parseRateDeclaration` result, or null.
 * @param destinations the models the loaded analysis prices.
 * @param asOf the analysis date, ISO `YYYY-MM-DD`, passed in and never read off
 *   a clock.
 * @returns a frozen record carrying the label, the score, the attribution line,
 *   the models still falling back to list price, the unmatched declarations, the
 *   #1263 confidence verdict the readiness blocker is written from, and the full
 *   #1266 verdict behind the score.
 */
export function recomputeProvenance(
  { declaration = null, destinations = PRICED_DESTINATIONS, asOf = null } = {}) {
  const priced = destinations.filter((id) => typeof id === "string" && id.trim() !== "");
  const card = rateCardFromDeclaration(declaration, priced);
  const declaredModels = card ? card.models.map((model) => model.model) : [];
  const fallback = priced.filter((id) => !declaredModels.includes(id));
  const unmatched = [...new Set((declaration?.records ?? [])
    .map((entry) => entry.model)
    .filter((model) => !priced.includes(model)))].sort();
  const verdict = scorePricingProvenance({ card, asOf, pricedDestinations: priced });
  const label = card === null ? PROVENANCE_LABELS[0]
    : (fallback.length === 0 ? PROVENANCE_LABELS[2] : PROVENANCE_LABELS[1]);
  return Object.freeze({
    schemaVersion: DECLARED_RATE_SCHEMA_VERSION,
    label,
    score: verdict.subScore,
    rating: verdict.rating,
    ratingLabel: verdict.ratingLabel,
    declared: Object.freeze(declaredModels),
    fallback: Object.freeze(fallback),
    unmatched: Object.freeze(unmatched),
    attribution: attributionFor(card, fallback, unmatched, verdict),
    confidence: confidenceFor(card ?? DEFAULT_REFERENCE_CARD, { asOf }),
    verdict,
  });
}
