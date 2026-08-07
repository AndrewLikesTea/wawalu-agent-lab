// "Is it worth going to procurement for my contract before I type anything?"
//
// THE DEFECT THIS CLOSES (#1262). The recoverable figure on /evolution.html is
// priced at published list prices, and the page said so in a sentence that never
// changed: "a ceiling to verify at list prices, before any committed-use
// discount". True, and useless as an instruction. A lead reading it cannot tell
// what they would have to state before the number becomes checkable, so they
// cannot decide whether the trip to procurement is worth an hour. This module
// names the inputs, grades what is declared, and hands the page ONE next action
// derived from the gap rather than a second copy of the wording.
//
// ---------------------------------------------------------------------------
// THE FOUR INPUTS, AND NOTHING ELSE
// ---------------------------------------------------------------------------
//
// The ladder below is defined on exactly four declarations, per destination
// model. A fifth input would be a fifth thing to chase before the number moves,
// and this page can already price a figure without any of them.
//
//   1. contractedInputRate    currency units per 1,000,000 input tokens
//   2. contractedOutputRate   currency units per 1,000,000 output tokens
//   3. committedUseDiscountPct  percent off both contracted rates
//   4. permitted              may this destination be used at all
//
// `currency` and `effectiveDate` are NOT rungs of their own: they qualify the
// two rates. A rate in an unknown currency, or a rate whose contract does not
// take effect until next quarter, is a rate this page may not price with today,
// so it counts as undeclared and says why in `missing`.
//
// ---------------------------------------------------------------------------
// THE TIER RULE, stated so two engineers compute it identically
// ---------------------------------------------------------------------------
//
// Only models that are permitted or undeclared are in scope: a model declared
// `permitted: false` contributes zero spend to the forecast, so it can neither
// hold the card back nor count as a missing input.
//
//   Illustrative / Low     Any in-scope model is missing a contracted input or
//                          output rate, OR every rate on the card still comes
//                          from `published-list`. The default state, and what an
//                          untouched DEFAULT_REFERENCE_CARD returns.
//   Declared / Medium      Every in-scope model has BOTH contracted rates
//                          declared, in a valid shared currency, with a real,
//                          non-future effective date — and at least one of
//                          {committed-use discount, permitted flag} is still
//                          undeclared on at least one of them.
//   Declared / High        All four inputs are declared for every model on the
//                          card: both rates, a discount percentage (an explicit
//                          0 counts), and an explicit permitted flag.
//
// A card that fails `validateRateCard` returns Illustrative / Low with the
// validation failure carried in `missing`. A card with no in-scope model returns
// Illustrative / Low too: an empty card supports no figure at all, and vacuous
// truth is the one way a ladder like this can lie.
//
// DECLARED IS NOT ZERO. `committedUseDiscountPct: 0` means "declared, no
// discount"; `null` or absent means "not declared". They are different answers
// to procurement and the module never collapses them. Same for `permitted:
// false` versus `permitted: null`.
//
// PURE. No clock, no I/O, no DOM, no randomness. `confidenceFor(card, { asOf })`
// takes the date it compares effective dates against; a caller that supplies no
// `asOf` gets the future-dating check skipped (and `asOf: null` recorded on the
// verdict) rather than a different answer on a different day.
//
// WHAT THIS MODULE IS NOT. It is not an editor, not storage, and not a
// procurement workflow: there is no way in this repository to enter a card, and
// nothing here reads or writes one. It defines what a card must carry, proves
// the ladder, and lets the answer region say what is missing.

import { DOWN_ROUTING_CONSTANTS } from "./down-routing-candidates.js";

/** Bump when a field, a range, or what a tier means changes. Copy may be reworded. */
export const RATE_CARD_CONTRACT_VERSION = "finops-rate-card/1.0.0";

/** Minor units in one currency unit. The repo's rate constants are held in minor units. */
const MINOR_PER_UNIT = 100;

/** A rate held as currency units per million tokens, from the repo's minor-unit constant. */
export const fromMinorPerMillion = (minor) => minor / MINOR_PER_UNIT;

/** The inverse, so a test can compare a card's rate with the constant it mirrors. */
export const toMinorPerMillion = (rate) => Math.round(rate * MINOR_PER_UNIT);

/**
 * The field spec. Ranges live here, as data the validator reads, so the prose
 * above and the checks below cannot drift apart.
 *
 * `min`/`max` are inclusive unless `exclusiveMin` says otherwise. `nullable`
 * marks the fields whose absence is a STATE — not declared — rather than a
 * malformed card.
 */
export const RATE_CARD_FIELDS = Object.freeze([
  Object.freeze({
    field: "contractedInputRate",
    kind: "number",
    unit: "currency units per 1,000,000 input tokens",
    min: 0,
    exclusiveMin: true,
    max: 1000,
    nullable: true,
    meaning: "what your contract charges for a million input tokens",
  }),
  Object.freeze({
    field: "contractedOutputRate",
    kind: "number",
    unit: "currency units per 1,000,000 output tokens",
    min: 0,
    exclusiveMin: true,
    max: 1000,
    nullable: true,
    meaning: "what your contract charges for a million output tokens",
  }),
  Object.freeze({
    field: "currency",
    kind: "currency-code",
    unit: "ISO 4217 alphabetic code, uppercase, three letters",
    nullable: true,
    meaning: "the currency both rates are stated in; one card, one currency",
  }),
  Object.freeze({
    field: "effectiveDate",
    kind: "calendar-date",
    unit: "ISO 8601 calendar date, YYYY-MM-DD",
    nullable: true,
    meaning: "the day these rates take effect; a future date prices nothing today",
  }),
  Object.freeze({
    field: "committedUseDiscountPct",
    kind: "number",
    unit: "percent off the contracted rates",
    min: 0,
    max: 100,
    nullable: true,
    meaning: "your committed-use discount; 0 declares that there is none",
  }),
  Object.freeze({
    field: "permitted",
    kind: "boolean",
    unit: "true, false, or undeclared",
    nullable: true,
    meaning: "whether this destination may be used at all",
  }),
]);

/** The four ladder inputs, MOST CONSEQUENTIAL FIRST. `missing` is ordered by this. */
export const LADDER_INPUTS = Object.freeze([
  "contractedInputRate", "contractedOutputRate", "committedUseDiscountPct", "permitted",
]);

/** Where a rate came from. `published-list` is a reference price, not a contract. */
export const RATE_SOURCES = Object.freeze(["published-list", "contracted"]);

/** The three rungs. `tier` is the marker beside the figure; `label` is the grade. */
export const CONFIDENCE_TIERS = Object.freeze([
  Object.freeze({ tier: "illustrative", marker: "Illustrative", label: "Low" }),
  Object.freeze({ tier: "declared", marker: "Declared", label: "Medium" }),
  Object.freeze({ tier: "declared", marker: "Declared", label: "High" }),
]);

const TIER = Object.freeze({
  low: CONFIDENCE_TIERS[0], medium: CONFIDENCE_TIERS[1], high: CONFIDENCE_TIERS[2],
});

const CURRENCY_CODE = /^[A-Z]{3}$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const absent = (value) => value === null || value === undefined;
const spec = (field) => RATE_CARD_FIELDS.find((entry) => entry.field === field);

/** A real calendar date, not merely a well-shaped string: 2026-02-30 is not one. */
export function isCalendarDate(value) {
  if (typeof value !== "string" || !CALENDAR_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= last;
}

function numberErrors(value, field, where) {
  const rule = spec(field);
  const errors = [];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ ...where, field, code: "not_a_number", detail: `${field} must be a number` });
    return errors;
  }
  const underMin = rule.exclusiveMin ? value <= rule.min : value < rule.min;
  if (underMin || value > rule.max) {
    errors.push({
      ...where,
      field,
      code: "out_of_range",
      detail: `${field} must be ${rule.exclusiveMin ? "over" : "at least"} ${rule.min} `
        + `and at most ${rule.max} (${rule.unit})`,
    });
  }
  return errors;
}

function modelErrors(model, index) {
  const where = { model: typeof model?.model === "string" ? model.model : `models[${index}]` };
  if (!isRecord(model)) {
    return [{ model: where.model, field: null, code: "not_an_object", detail: "model is not an object" }];
  }
  const errors = [];
  if (typeof model.model !== "string" || model.model.trim() === "") {
    errors.push({ ...where, field: "model", code: "missing", detail: "model needs an identifier" });
  }
  for (const field of ["contractedInputRate", "contractedOutputRate"]) {
    if (!absent(model[field])) errors.push(...numberErrors(model[field], field, where));
  }
  if (!absent(model.committedUseDiscountPct)) {
    errors.push(...numberErrors(model.committedUseDiscountPct, "committedUseDiscountPct", where));
  }
  if (!absent(model.currency) && !CURRENCY_CODE.test(String(model.currency))) {
    errors.push({
      ...where, field: "currency", code: "not_a_currency_code",
      detail: "currency must be a three-letter uppercase ISO 4217 code",
    });
  }
  if (!absent(model.effectiveDate) && !isCalendarDate(model.effectiveDate)) {
    errors.push({
      ...where, field: "effectiveDate", code: "not_a_calendar_date",
      detail: "effectiveDate must be a real YYYY-MM-DD date",
    });
  }
  if (!absent(model.permitted) && typeof model.permitted !== "boolean") {
    errors.push({
      ...where, field: "permitted", code: "not_a_boolean",
      detail: "permitted must be true, false, or undeclared",
    });
  }
  if (!absent(model.source) && !RATE_SOURCES.includes(model.source)) {
    errors.push({
      ...where, field: "source", code: "unknown_source",
      detail: `source must be one of ${RATE_SOURCES.join(", ")}`,
    });
  }
  return errors;
}

/**
 * Validate a rate card against every rule in this file.
 *
 * @returns `{ valid, errors }`, never a throw: the caller is a page that must
 *   still render a labelled illustrative figure rather than nothing at all.
 *   Each error is a record — `{ model, field, code, detail }` — so a surface can
 *   sort or filter it instead of parsing a sentence.
 */
export function validateRateCard(card) {
  if (!isRecord(card)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze([
        Object.freeze({ model: null, field: null, code: "not_an_object", detail: "card is not an object" }),
      ]),
    });
  }
  const errors = [];
  if (!absent(card.source) && !RATE_SOURCES.includes(card.source)) {
    errors.push({
      model: null, field: "source", code: "unknown_source",
      detail: `source must be one of ${RATE_SOURCES.join(", ")}`,
    });
  }
  if (!Array.isArray(card.models) || card.models.length === 0) {
    errors.push({ model: null, field: "models", code: "missing", detail: "card declares no models" });
  } else {
    card.models.forEach((model, index) => errors.push(...modelErrors(model, index)));
    // One card, one currency. A card mixing USD and EUR rates sums to a figure
    // in no currency at all, which is worse than an unpriced one.
    const currencies = [...new Set(card.models
      .map((model) => model?.currency).filter((code) => !absent(code)))];
    if (currencies.length > 1) {
      errors.push({
        model: null, field: "currency", code: "mixed_currency",
        detail: `one card carries one currency; found ${currencies.join(", ")}`,
      });
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors.map((error) => Object.freeze(error))),
  });
}

// ---------------------------------------------------------------------------
// The reference card: the prices this page ALREADY charges its figure at.
// ---------------------------------------------------------------------------
//
// The two rates are not typed here. They are read off DOWN_ROUTING_CONSTANTS —
// the published-list tier prices the recoverable figure is computed from — and
// converted from the repo's minor units per million tokens. Retyping them would
// create a second copy that could move without the figure moving, which is the
// one failure this contract exists to make impossible.
//
// SUBSTITUTION, stated rather than hidden: the list this repository ships is a
// BLENDED price per million tokens with no input/output split (see
// DOWN_ROUTING_ASSUMPTIONS). So both rate fields on the reference card carry the
// same blended figure, and the card is marked `published-list`. That mark is
// precisely why the ladder cannot leave Illustrative: a reference price is not a
// contract, however many decimal places it has.

/** The published-list rate this page prices a premium-tier destination at. */
export const PREMIUM_LIST_RATE = fromMinorPerMillion(
  DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS);

/** The published-list rate this page prices the cheaper destination at. */
export const STANDARD_LIST_RATE = fromMinorPerMillion(
  DOWN_ROUTING_CONSTANTS.STANDARD_TIER_REFERENCE_MINOR_PER_MILLION_TOKENS);

/** The card every surface starts from: reference prices, nothing declared. */
export const DEFAULT_REFERENCE_CARD = Object.freeze({
  contractVersion: RATE_CARD_CONTRACT_VERSION,
  cardId: "published-list-reference",
  source: "published-list",
  models: Object.freeze([
    Object.freeze({
      model: "premium-text",
      label: "the premium text tier",
      contractedInputRate: PREMIUM_LIST_RATE,
      contractedOutputRate: PREMIUM_LIST_RATE,
      currency: "USD",
      effectiveDate: null,
      committedUseDiscountPct: null,
      permitted: null,
    }),
    Object.freeze({
      model: "standard-text",
      label: "the standard text tier",
      contractedInputRate: STANDARD_LIST_RATE,
      contractedOutputRate: STANDARD_LIST_RATE,
      currency: "USD",
      effectiveDate: null,
      committedUseDiscountPct: null,
      permitted: null,
    }),
  ]),
});

// ---------------------------------------------------------------------------
// The ladder.
// ---------------------------------------------------------------------------

const sourceOf = (model, card) => model?.source ?? card?.source ?? "published-list";
const inScope = (model) => model?.permitted !== false;

/** Why a declared-looking rate still does not count, or null when it counts. */
function rateGap(model, card, field, asOf) {
  const value = model?.[field];
  if (absent(value)) return "not stated";
  if (sourceOf(model, card) !== "contracted") return "a published list price, not your contract";
  if (!CURRENCY_CODE.test(String(model?.currency ?? ""))) return "stated in no valid currency";
  if (!isCalendarDate(model?.effectiveDate)) return "carrying no effective date";
  if (typeof asOf === "string" && isCalendarDate(asOf) && model.effectiveDate > asOf) {
    return "not in effect yet";
  }
  return null;
}

const gapFor = (model, card, field, asOf) => {
  if (field === "contractedInputRate" || field === "contractedOutputRate") {
    return rateGap(model, card, field, asOf);
  }
  return absent(model?.[field]) ? "not stated" : null;
};

/**
 * Grade one rate card. One verdict out, always.
 *
 * @param card any value; a missing or malformed card is a card this page did not
 *   get, which is Illustrative / Low with the reason in `missing`, not a throw.
 * @param asOf ISO date the effective dates are compared against. Omit it and the
 *   future-dating check is skipped rather than answered by a clock.
 * @returns `{ version, tier, marker, label, valid, asOf, missing }` where
 *   `missing` is `{ model, label, field, reason }` records ordered by
 *   LADDER_INPUTS — the most consequential undeclared input first — and is the
 *   only thing any copy on the page is generated from.
 */
export function confidenceFor(card, { asOf = null } = {}) {
  const validation = validateRateCard(card);
  const verdict = (rung, missing) => Object.freeze({
    version: RATE_CARD_CONTRACT_VERSION,
    tier: rung.tier,
    marker: rung.marker,
    label: rung.label,
    valid: validation.valid,
    asOf: typeof asOf === "string" && isCalendarDate(asOf) ? asOf : null,
    missing: Object.freeze(missing.map((entry) => Object.freeze(entry))),
  });

  if (!validation.valid) {
    // Never a higher tier than the data supports: an unreadable card supports none.
    return verdict(TIER.low, validation.errors.map((error) => ({
      model: error.model,
      label: error.model,
      field: error.field,
      reason: `invalid: ${error.detail}`,
    })));
  }

  const models = card.models.filter(inScope);
  if (models.length === 0) {
    return verdict(TIER.low, [{
      model: null, label: null, field: "models",
      reason: "no destination model on this card may be used, so there is nothing to price",
    }]);
  }

  const missing = [];
  for (const field of LADDER_INPUTS) {
    for (const model of models) {
      const reason = gapFor(model, card, field, asOf);
      if (reason) {
        missing.push({ model: model.model, label: model.label ?? model.model, field, reason });
      }
    }
  }

  const ratesOutstanding = missing.some(
    (entry) => entry.field === "contractedInputRate" || entry.field === "contractedOutputRate");
  if (ratesOutstanding) return verdict(TIER.low, missing);
  return verdict(missing.length === 0 ? TIER.high : TIER.medium, missing);
}

/** The card this page's own figure is priced at, graded once, on the one path. */
export const BUNDLED_RATE_CARD_CONFIDENCE = confidenceFor(DEFAULT_REFERENCE_CARD);

// ---------------------------------------------------------------------------
// The copy. Generated from `missing`, so there is no second copy of the wording.
// ---------------------------------------------------------------------------

/**
 * How long the sentence beside the figure may be. Past about this, qualification
 * belongs one press away in the disclosure rather than beside the money —
 * tests/finops-how-we-know.test.js holds the whole page to it.
 */
export const HEDGE_MAX_CHARS = 100;

/** Models nameable in one sentence before a count reads better than a list. */
export const NAMEABLE_MODEL_LIMIT = 3;

/** Reader-facing names for the four inputs. No field key ever reaches a reader. */
const INPUT_PHRASE = Object.freeze({
  contractedInputRate: "contracted input rates",
  contractedOutputRate: "contracted output rates",
  committedUseDiscountPct: "your committed-use discount",
  permitted: "which destinations are permitted",
});

const list = (parts) => (parts.length <= 1 ? (parts[0] ?? "")
  : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/** The outstanding inputs at the top of the ladder, and who they are outstanding for. */
function nextRung(verdict) {
  const missing = verdict?.missing ?? [];
  if (missing.length === 0) return null;
  const rates = missing.filter((entry) => entry.field.startsWith("contracted"));
  const group = rates.length > 0 ? rates : missing;
  const fields = LADDER_INPUTS.filter((field) => group.some((entry) => entry.field === field));
  const models = [...new Map(group.map((entry) => [entry.model, entry.label])).values()]
    .filter((label) => typeof label === "string" && label !== "");
  return { fields, models, rates: rates.length > 0 };
}

/** "the premium text tier and the standard text tier", or "these 5 destination models". */
function whose(models) {
  if (models.length === 0) return "this card";
  if (models.length > NAMEABLE_MODEL_LIMIT) return `these ${models.length} destination models`;
  return list(models);
}

/** The same set, counted rather than named, for the sentence beside the money. */
const counted = (models) => (models.length === 1
  ? "1 destination model" : `${models.length} destination models`);

/**
 * The one prioritized next action, in the words a lead would use with
 * procurement: what to state, for which destinations, and what it buys.
 */
export function rateCardNextStep(verdict = BUNDLED_RATE_CARD_CONFIDENCE) {
  const rung = nextRung(verdict);
  if (!rung) {
    return "All four contracted inputs are declared for every destination model, so this "
      + "figure is checkable against your own contract.";
  }
  if (rung.fields.length === 1 && rung.fields[0] === "models") {
    return "No destination model on this card may be used, so there is nothing to price and "
      + "the figure stays illustrative.";
  }
  const asked = rung.rates && rung.fields.length === 2
    ? "contracted input and output rates" : list(rung.fields.map((field) => INPUT_PHRASE[field]));
  const declared = verdict.label === "Medium";
  const moves = declared ? "Declared · High" : "Declared · Medium";
  const until = declared
    ? "Until then the figure carries your rates but not your discount, so it is still a ceiling."
    : "Until then it stays illustrative: a list-price ceiling, not a saving.";
  return `State ${asked} for ${whose(rung.models)} — that moves this figure to ${moves}. ${until}`;
}

/**
 * The same fact beside the money, inside HEDGE_MAX_CHARS. Short enough to be
 * read with the figure; the full move is one press away in the disclosure.
 */
export function rateCardHedge(verdict = BUNDLED_RATE_CARD_CONFIDENCE) {
  const rung = nextRung(verdict);
  if (!rung) return "Priced at your contracted rates, discount applied, permitted destinations only.";
  if (rung.rates) {
    return `A ceiling at list prices until ${counted(rung.models)} state contracted rates `
      + "and committed-use.";
  }
  return `Rates are contracted; ${counted(rung.models)} still owe committed-use and permission.`;
}

/** The marker beside the figure. One word, and never a colour alone. */
export const rateCardMarker = (verdict = BUNDLED_RATE_CARD_CONFIDENCE) =>
  verdict?.marker ?? TIER.low.marker;
