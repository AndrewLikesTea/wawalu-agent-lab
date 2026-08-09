// The rate-card contract, its confidence ladder, and the sentence the answer
// region generates from it.
//
// Three groups, and they check different claims:
//
//   1. THE LADDER. A fully declared card grades High, a partially declared one
//      Medium, and the untouched reference card Low. The `missing` array is
//      pinned in order, because that array — not a second copy of the wording —
//      is what every sentence on the page is generated from.
//   2. THE NUMBERS DID NOT MOVE. The reference card's rates ARE the constants
//      the recoverable figure is computed from, compared against
//      down-routing-candidates.js rather than transcribed, so a future edit
//      cannot slide the headline while this suite stays green.
//   3. THE SURFACE. The shipped markup of src/evolution.html carries the
//      authored form of both generated sentences, and the real page entry paints
//      them. A test that only checked the module would pass on a page that
//      renders none of it.
//
// The cards are built here rather than committed: a variant's interesting part
// is the one field that differs from the last one.
//
// Nothing here reads a clock, a network, or a random source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { DOWN_ROUTING_CONSTANTS } from "../src/down-routing-candidates.js";
import {
  BUNDLED_RATE_CARD_CONFIDENCE, DEFAULT_REFERENCE_CARD, HEDGE_MAX_CHARS, LADDER_INPUTS,
  RATE_CARD_FIELDS, confidenceFor, isCalendarDate, rateCardHedge, rateCardMarker,
  rateCardNextStep, toMinorPerMillion, validateRateCard,
} from "../src/finops-rate-card-contract.js";
import { RATE_CARD_IDS, applyRateCardLadder } from "../src/finops-rate-card-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const SOURCE = await readFile(PAGE, "utf8");
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

/** The day every dated card below is graded against. Passed in, never read off a clock. */
const AS_OF = "2026-08-06";

/** One destination model with all four inputs declared. */
const declaredModel = (model, label, overrides = {}) => ({
  model,
  label,
  contractedInputRate: 12,
  contractedOutputRate: 36,
  currency: "USD",
  effectiveDate: "2026-01-01",
  committedUseDiscountPct: 15,
  permitted: true,
  ...overrides,
});

/** A card whose four inputs are all declared, for every model on it. */
const fullyDeclaredCard = (models = [
  declaredModel("premium-text", "the premium text tier"),
  declaredModel("standard-text", "the standard text tier", { committedUseDiscountPct: 0 }),
]) => ({ cardId: "test-declared", source: "contracted", models });

/** Contracted rates everywhere; the discount and the permitted flag still open. */
const partiallyDeclaredCard = () => fullyDeclaredCard([
  declaredModel("premium-text", "the premium text tier", { committedUseDiscountPct: null }),
  declaredModel("standard-text", "the standard text tier", { permitted: null }),
]);

const shape = (missing) => missing.map(({ model, field }) => ({ model, field }));

// ---------------------------------------------------------------------------
// 1. The ladder.
// ---------------------------------------------------------------------------

test("a card with all four inputs declared for every model grades Declared / High", () => {
  const verdict = confidenceFor(fullyDeclaredCard(), { asOf: AS_OF });
  assert.equal(verdict.tier, "declared");
  assert.equal(verdict.label, "High");
  assert.equal(verdict.marker, "Declared");
  assert.deepEqual(shape(verdict.missing), [], "nothing is outstanding at High");
  assert.equal(verdict.valid, true);
  assert.equal(verdict.asOf, AS_OF, "the verdict records the date it was graded against");
});

test("an explicit zero discount and an explicit false permit are declarations", () => {
  const card = fullyDeclaredCard([
    declaredModel("premium-text", "the premium text tier", { committedUseDiscountPct: 0 }),
    declaredModel("standard-text", "the standard text tier", { permitted: false }),
  ]);
  const verdict = confidenceFor(card, { asOf: AS_OF });
  assert.equal(verdict.label, "High", "0% off is an answer; a model nobody may use is an answer");
  // The unpermitted model is out of scope entirely: it holds nothing back and
  // it is not a missing input either.
  assert.deepEqual(shape(verdict.missing), []);
});

test("contracted rates with an open discount or permit grade Declared / Medium", () => {
  const verdict = confidenceFor(partiallyDeclaredCard(), { asOf: AS_OF });
  assert.equal(verdict.tier, "declared");
  assert.equal(verdict.label, "Medium");
  // ORDERED, most consequential first: the ladder's own input order, and within
  // one input the order the card declares its models in. The hero sentence is
  // generated from this array, so its order is part of the contract.
  assert.deepEqual(shape(verdict.missing), [
    { model: "premium-text", field: "committedUseDiscountPct" },
    { model: "standard-text", field: "permitted" },
  ]);
  assert.deepEqual(verdict.missing.map((entry) => entry.reason), ["not stated", "not stated"]);
});

test("the untouched reference card grades Illustrative / Low, with all four inputs open", () => {
  const verdict = confidenceFor(DEFAULT_REFERENCE_CARD);
  assert.equal(verdict.tier, "illustrative");
  assert.equal(verdict.label, "Low");
  assert.equal(verdict.marker, "Illustrative");
  assert.equal(verdict.valid, true, "a reference card is structurally valid; it is just not yours");
  assert.deepEqual(shape(verdict.missing), [
    { model: "premium-text", field: "contractedInputRate" },
    { model: "standard-text", field: "contractedInputRate" },
    { model: "premium-text", field: "contractedOutputRate" },
    { model: "standard-text", field: "contractedOutputRate" },
    { model: "premium-text", field: "committedUseDiscountPct" },
    { model: "standard-text", field: "committedUseDiscountPct" },
    { model: "premium-text", field: "permitted" },
    { model: "standard-text", field: "permitted" },
  ]);
  assert.equal(verdict.missing[0].reason, "a published list price, not your contract");
  assert.deepEqual(verdict, BUNDLED_RATE_CARD_CONFIDENCE, "one verdict, evaluated once");
});

test("a rate that is not yet in effect is not a declared rate", () => {
  const card = fullyDeclaredCard([
    declaredModel("premium-text", "the premium text tier", { effectiveDate: "2027-01-01" }),
  ]);
  const verdict = confidenceFor(card, { asOf: AS_OF });
  assert.equal(verdict.label, "Low", "a contract that starts next year prices nothing today");
  assert.equal(verdict.missing[0].reason, "not in effect yet");
  // Same card, same function, no clock: graded after the effective date it is
  // declared, and the module never decides that for itself.
  assert.equal(confidenceFor(card, { asOf: "2027-06-01" }).label, "High");
  assert.equal(confidenceFor(card).label, "High", "no asOf skips the check rather than guessing");
});

test("an invalid card never grades higher than the data supports", () => {
  const mixed = fullyDeclaredCard([
    declaredModel("premium-text", "premium", { currency: "EUR" }),
    declaredModel("standard-text", "standard"),
  ]);
  const verdict = confidenceFor(mixed, { asOf: AS_OF });
  assert.equal(verdict.label, "Low");
  assert.equal(verdict.valid, false);
  assert.ok(verdict.missing.some((entry) => entry.field === "currency"),
    "the validation failure is surfaced in missing, not swallowed");
  assert.ok(verdict.missing.every((entry) => entry.reason.startsWith("invalid: ")));
  for (const absent of [null, undefined, 42, [], {}, { models: [] }]) {
    const graded = confidenceFor(absent, { asOf: AS_OF });
    assert.equal(graded.label, "Low", "an unreadable card supports no confidence at all");
  }
});

test("a card whose every model is barred from use prices nothing", () => {
  const card = fullyDeclaredCard([
    declaredModel("premium-text", "premium", { permitted: false }),
  ]);
  const verdict = confidenceFor(card, { asOf: AS_OF });
  assert.equal(verdict.label, "Low", "vacuous truth is the one way this ladder could lie");
  assert.deepEqual(shape(verdict.missing), [{ model: null, field: "models" }]);
});

test("the validator reports structured errors and never throws", () => {
  assert.equal(validateRateCard(DEFAULT_REFERENCE_CARD).valid, true);
  const cases = [
    [{ contractedInputRate: 0 }, "contractedInputRate", "out_of_range"],
    [{ contractedOutputRate: 1001 }, "contractedOutputRate", "out_of_range"],
    [{ contractedInputRate: "12" }, "contractedInputRate", "not_a_number"],
    [{ committedUseDiscountPct: 101 }, "committedUseDiscountPct", "out_of_range"],
    [{ currency: "usd" }, "currency", "not_a_currency_code"],
    [{ effectiveDate: "2026-02-30" }, "effectiveDate", "not_a_calendar_date"],
    [{ permitted: "yes" }, "permitted", "not_a_boolean"],
  ];
  for (const [override, field, code] of cases) {
    const { valid, errors } = validateRateCard(
      fullyDeclaredCard([declaredModel("premium-text", "premium", override)]));
    assert.equal(valid, false, `${field} ${code} is a validation failure`);
    assert.ok(errors.some((error) => error.field === field && error.code === code),
      `${field}: expected ${code}, got ${JSON.stringify(errors)}`);
  }
  assert.equal(isCalendarDate("2026-02-29"), false, "2026 is not a leap year");
  assert.equal(isCalendarDate("2024-02-29"), true);
});

test("the field spec publishes every range the validator enforces", () => {
  const byField = new Map(RATE_CARD_FIELDS.map((entry) => [entry.field, entry]));
  for (const field of LADDER_INPUTS) assert.ok(byField.has(field), `${field} is specified`);
  for (const field of ["contractedInputRate", "contractedOutputRate"]) {
    assert.deepEqual(
      { min: byField.get(field).min, exclusiveMin: byField.get(field).exclusiveMin,
        max: byField.get(field).max },
      { min: 0, exclusiveMin: true, max: 1000 });
    assert.match(byField.get(field).unit, /per 1,000,000/);
  }
  assert.equal(byField.get("committedUseDiscountPct").min, 0);
  assert.equal(byField.get("committedUseDiscountPct").max, 100);
});

// ---------------------------------------------------------------------------
// 2. The numbers behind the headline did not move.
// ---------------------------------------------------------------------------

test("the reference card's rates ARE the constants the recoverable figure is priced at", () => {
  const rate = (model) => DEFAULT_REFERENCE_CARD.models.find((entry) => entry.model === model);
  assert.equal(toMinorPerMillion(rate("premium-text").contractedInputRate),
    DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS);
  assert.equal(toMinorPerMillion(rate("premium-text").contractedOutputRate),
    DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS);
  assert.equal(toMinorPerMillion(rate("standard-text").contractedInputRate),
    DOWN_ROUTING_CONSTANTS.STANDARD_TIER_REFERENCE_MINOR_PER_MILLION_TOKENS);
  assert.equal(toMinorPerMillion(rate("standard-text").contractedOutputRate),
    DOWN_ROUTING_CONSTANTS.STANDARD_TIER_REFERENCE_MINOR_PER_MILLION_TOKENS);
  // The published figures, stated once here so a review can read them: $20.00
  // and $15.00 per million tokens. If this line and the two above ever disagree,
  // the constants moved and the headline moved with them.
  assert.equal(rate("premium-text").contractedInputRate, 20);
  assert.equal(rate("standard-text").contractedInputRate, 15);
  assert.equal(DEFAULT_REFERENCE_CARD.source, "published-list",
    "a reference price is not a contract, however many decimal places it has");
});

// ---------------------------------------------------------------------------
// 3. The surface.
// ---------------------------------------------------------------------------

test("the sentences are generated, and the served markup carries what they generate", () => {
  const document = parseHtml(SOURCE);
  assert.equal(textOf(document.getElementById(RATE_CARD_IDS.hedge)).trim(),
    rateCardHedge(BUNDLED_RATE_CARD_CONFIDENCE));
  // THE TIER WORD IS NOT AUTHORED (#1480). The marker and the next ask are
  // resolved by the readiness contract and written into the served document by
  // scripts/seed-first-screen.mjs, so what the source carries is a placeholder
  // that states no tier at all. A hand-kept "Illustrative" here would be a
  // second answer to the question the contract already answers, so this asserts
  // its absence rather than its value; the seeded value is pinned against the
  // page's own paint in tests/finops-first-screen-seed.test.js.
  for (const id of [RATE_CARD_IDS.marker, RATE_CARD_IDS.nextStep]) {
    const authored = textOf(document.getElementById(id)).trim();
    for (const tier of [/Illustrative/i, /Declared/i, /Insufficient/i]) {
      assert.doesNotMatch(authored, tier, `#${id} authors a tier word the contract owns`);
    }
  }
});

test("the next action names what to state, for whom, and what it moves the figure to", () => {
  const sentence = rateCardNextStep(BUNDLED_RATE_CARD_CONFIDENCE);
  assert.match(sentence, /contracted input and output rates/);
  assert.match(sentence, /the premium text tier and the standard text tier/,
    "two models are named rather than counted");
  assert.match(sentence, /Declared · Medium/, "it says which tier the number moves to");
  assert.match(sentence, /stays illustrative/, "and that it is not a saving until then");
  // At Medium the outstanding inputs are the other two, and the sentence changes
  // with them: the copy is derived, not a second table of strings.
  const medium = rateCardNextStep(confidenceFor(partiallyDeclaredCard(), { asOf: AS_OF }));
  assert.match(medium, /committed-use discount/);
  assert.match(medium, /which destinations are permitted/);
  assert.match(medium, /Declared · High/);
  // And at High there is nothing left to ask for.
  const high = rateCardNextStep(confidenceFor(fullyDeclaredCard(), { asOf: AS_OF }));
  assert.match(high, /All four contracted inputs are declared/);
});

test("the hedge beside the money stays short, and says the three things it exists to say", () => {
  const hedge = rateCardHedge(BUNDLED_RATE_CARD_CONFIDENCE);
  assert.ok(hedge.length <= HEDGE_MAX_CHARS,
    `the hedge is ${hedge.length} characters; past ${HEDGE_MAX_CHARS} it belongs in the disclosure`);
  for (const term of [/list price/i, /committed-use/i, /ceiling/i]) assert.match(hedge, term);
  for (const verdict of [
    confidenceFor(partiallyDeclaredCard(), { asOf: AS_OF }),
    confidenceFor(fullyDeclaredCard(), { asOf: AS_OF }),
  ]) {
    assert.ok(rateCardHedge(verdict).length <= HEDGE_MAX_CHARS);
  }
  // No identifier, no version string and no field key ever reaches a reader.
  for (const text of [hedge, rateCardNextStep(BUNDLED_RATE_CARD_CONFIDENCE)]) {
    assert.doesNotMatch(text, /\/\d+\.\d+\.\d+/);
    assert.doesNotMatch(text, /contractedInputRate|committedUseDiscountPct|permitted:/);
  }
});

test("the view writes the three slots and leaves a document without them alone", () => {
  const document = parseHtml(SOURCE);
  const medium = confidenceFor(partiallyDeclaredCard(), { asOf: AS_OF });
  applyRateCardLadder(document, medium);
  assert.equal(textOf(document.getElementById(RATE_CARD_IDS.marker)).trim(), "Declared");
  assert.equal(textOf(document.getElementById(RATE_CARD_IDS.nextStep)).trim(),
    rateCardNextStep(medium));
  assert.doesNotThrow(() => applyRateCardLadder(null));
  assert.doesNotThrow(() => applyRateCardLadder({ getElementById: () => null }));
});

test("the real page paints the ladder, and the figure beside it does not move", async () => {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  const read = (id) => textOf(page.document.getElementById(id)).trim();
  assert.equal(read("finops-recoverable-value"), "$62,400",
    "the headline is byte-identical on first load with the default reference card");
  assert.equal(read(RATE_CARD_IDS.marker), "Illustrative");
  assert.equal(read(RATE_CARD_IDS.hedge), rateCardHedge(BUNDLED_RATE_CARD_CONFIDENCE));
  assert.equal(read(RATE_CARD_IDS.nextStep), rateCardNextStep(BUNDLED_RATE_CARD_CONFIDENCE));
  // The next action lives inside the disclosure the region already ships, and
  // adds no control: the region's links are still the one action anchor.
  const region = page.document.getElementById("finops-recoverable-answer");
  assert.equal([...region.querySelectorAll("a")].length, 1);
});
