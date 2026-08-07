// The sender's own prices travel with the brief, and the reader's never win (#1265).
//
// WHAT THESE ASSERTIONS ARE FOR.
//
//   1. THE ROUND TRIP IS BYTE-IDENTICAL. A brief exported with a declared rate
//      card, serialized, and reopened through the shipped reader must render the
//      SAME headline, the same next move and the same grade. Asserted on the
//      strings the region actually holds, not on a paraphrase of them.
//   2. PRECEDENCE. A recipient who has declared a rate card of their own must
//      not have it applied to somebody else's figures. The same reopened brief
//      is rendered twice — once with no local card, once with a local card that
//      prices everything differently — and every rendered string is compared
//      character for character. The only difference allowed anywhere is one
//      labelled comparison sentence.
//   3. THE LEGACY PATH. `tests/fixtures/finops-legacy-brief.json` is the schema
//      the page shipped before this field existed, FROZEN as an artifact: it is
//      not rebuilt from the current builder, so a later schema change cannot
//      quietly rewrite the brief this test claims to open. It must still open,
//      and it must price at the published reference card in the reference
//      wording.
//   4. NOTHING THAT NAMES AN ACCOUNT TRAVELS. A card's `cardId` is the one field
//      on it that could name a contract or a provider account, and a brief is a
//      file that gets forwarded. It is dropped in both directions.
//
// No clock and no network: every stamp is an argument, and both fixtures are read
// off disk. Assertions are on text, counts and attributes — never on element
// identity, and never through a descendant selector.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  BRIEF_ENVELOPE_REASON, BRIEF_ENVELOPE_SCHEMA, LEGACY_BRIEF_ENVELOPE_SCHEMA,
  briefPricingBasis, buildBriefEnvelope, readBriefEnvelopeText, serializeBriefEnvelope,
} from "../src/finops-brief-envelope.js";
import { RATE_CARD_CONTRACT_VERSION } from "../src/finops-rate-card-contract.js";
import {
  LOCAL_CARD_COMPARISON, PRICED_AT_DECLARED, PRICED_AT_PART, PRICED_AT_REFERENCE,
  RECIPIENT_BRIEF_IDS, renderRecipientBrief,
} from "../src/finops-recipient-brief.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const LEGACY_FIXTURE = new URL("./fixtures/finops-legacy-brief.json", import.meta.url);
const html = await readFile(PAGE, "utf8");
const STAMP = "2026-08-06T09:30:00.000Z";

const doc = () => parseHtml(html);
const byId = (document, id) => document.getElementById(id);

/** One valid retained period. Built in-test; the committed fixture is the legacy one. */
const period = (index) => ({
  periodId: `user:2026-0${index + 1}`,
  period: `2026-0${index + 1}`,
  dataset: "user",
  briefingContractVersion: "finops-briefing/1.0.0",
  derivedAt: "2026-08-01T00:00:00.000Z",
  analyzedSpendMinor: 15_450_000 + index * 10_000,
  attributedSpendMinor: 12_000_000,
  recoverableScenarioMinor: 3_141_500,
  recordsTotal: 900,
  recordsAnalyzed: 880,
  coverageRatioPpm: 977_777,
  confidence: "moderate",
  topDepartmentId: "dept-atlas-platform",
});

const periods = (count = 3) => Array.from({ length: count }, (_, index) => period(index));

/** The sender's contract: both rates, a discount, and one destination shut off. */
const SENDER_CARD = Object.freeze({
  contractVersion: RATE_CARD_CONTRACT_VERSION,
  cardId: "sender-negotiated-2026",
  source: "contracted",
  models: [
    {
      model: "premium-text",
      label: "the premium text tier",
      contractedInputRate: 12.5,
      contractedOutputRate: 18,
      currency: "USD",
      effectiveDate: "2026-04-01",
      committedUseDiscountPct: 15,
      permitted: true,
    },
    {
      model: "standard-text",
      label: "the standard text tier",
      contractedInputRate: 8,
      contractedOutputRate: 9.5,
      currency: "USD",
      effectiveDate: "2026-04-01",
      committedUseDiscountPct: 0,
      permitted: false,
    },
  ],
});

/** The reader's own contract. Cheaper, later, and irrelevant to anybody else's brief. */
const RECIPIENT_CARD = Object.freeze({
  contractVersion: RATE_CARD_CONTRACT_VERSION,
  cardId: "reader-own-2026",
  source: "contracted",
  models: [
    {
      model: "premium-text",
      label: "the premium text tier",
      contractedInputRate: 3,
      contractedOutputRate: 4,
      currency: "USD",
      effectiveDate: "2026-07-01",
      committedUseDiscountPct: 60,
      permitted: true,
    },
    {
      model: "standard-text",
      label: "the standard text tier",
      contractedInputRate: 2,
      contractedOutputRate: 2.5,
      currency: "USD",
      effectiveDate: "2026-07-01",
      committedUseDiscountPct: 60,
      permitted: true,
    },
  ],
});

/** The `dd` stated under a given `dt` inside the region's one disclosure. */
function partBody(document, part) {
  const disclosure = byId(document, RECIPIENT_BRIEF_IDS.disclosure);
  const list = [...disclosure.children].find((child) => child.tagName === "DL");
  for (const row of list.children) {
    const term = [...row.children].find((child) => child.tagName === "DT");
    if (term && textOf(term) === part) {
      return [...row.children].find((child) => child.tagName === "DD") ?? null;
    }
  }
  return null;
}

/**
 * Every string the region publishes for one brief. The comparison unit of the
 * precedence test: if a local card moved any figure, one of these changes.
 */
function rendered(envelope, options = {}) {
  const document = doc();
  renderRecipientBrief(document, envelope, options);
  return {
    headline: textOf(byId(document, RECIPIENT_BRIEF_IDS.value)),
    label: textOf(byId(document, RECIPIENT_BRIEF_IDS.label)),
    action: textOf(byId(document, RECIPIENT_BRIEF_IDS.destination)),
    grade: textOf(byId(document, RECIPIENT_BRIEF_IDS.grade)),
    tier: textOf(byId(document, RECIPIENT_BRIEF_IDS.confidenceDetail)),
    pricedAt: textOf(partBody(document, PRICED_AT_PART)),
    focusables: byId(document, RECIPIENT_BRIEF_IDS.disclosure)
      .querySelectorAll("a,button,input,select,textarea,summary,[tabindex]").length,
  };
}

/** The sender's brief, exported with the sender's card and reopened from its bytes. */
const built = buildBriefEnvelope(periods(), { producedAt: STAMP, rateCard: SENDER_CARD });
assert.equal(built.ok, true, built.summary ?? "");
const reopened = readBriefEnvelopeText(serializeBriefEnvelope(built.envelope, { pretty: true }));
assert.equal(reopened.ok, true, reopened.summary ?? "");

// ---------------------------------------------------------------------------
// 1. The round trip.
// ---------------------------------------------------------------------------

test("a brief exported with a declared card reopens with the same rate basis", () => {
  assert.equal(built.envelope.v, BRIEF_ENVELOPE_SCHEMA);
  assert.deepEqual(
    JSON.parse(JSON.stringify(reopened.envelope.rateBasis)),
    JSON.parse(JSON.stringify(built.envelope.rateBasis)),
  );

  const basis = reopened.envelope.rateBasis;
  assert.equal(basis.declared, true);
  assert.equal(basis.effectiveDate, "2026-04-01");
  assert.equal(`${basis.marker} · ${basis.label}`, "Declared · High");
  // The rates, the discount and the permitted flag are the SENDER'S, per model.
  const premium = basis.models.find((model) => model.model === "premium-text");
  const standard = basis.models.find((model) => model.model === "standard-text");
  assert.deepEqual(
    [premium.contractedInputRate, premium.contractedOutputRate, premium.committedUseDiscountPct],
    [12.5, 18, 15]);
  assert.equal(premium.permitted, true);
  assert.equal(standard.permitted, false, "a destination the sender may not use travels as such");
});

test("the headline, the ranked action and the tier survive the round trip character for character", () => {
  const before = rendered(built.envelope);
  const after = rendered(reopened.envelope);
  assert.deepEqual(after, before);

  // Not vacuously equal: these are the sender's actual strings.
  assert.equal(after.headline, "$31,415");
  assert.equal(after.grade, "Confidence: moderate");
  assert.match(after.action, /^Start here: Act first in the named org unit/);
  assert.equal(after.pricedAt,
    "Priced at the sender's declared rate card, in effect from 2026-04-01, committed-use discount "
    + "applied. Rate confidence: Declared · High.");
});

// ---------------------------------------------------------------------------
// 2. Precedence: the reader's own card is a comparison and nothing else.
// ---------------------------------------------------------------------------

test("a recipient's own declared card changes no figure, no action and no tier", () => {
  const alone = rendered(reopened.envelope);
  const withLocal = rendered(reopened.envelope, { localRateCard: RECIPIENT_CARD });

  for (const slot of ["headline", "label", "action", "grade", "tier"]) {
    assert.equal(withLocal[slot], alone[slot],
      `${slot} was repriced at the reader's own card`);
  }
  // The rate basis itself is still the sender's, stated first and unchanged.
  assert.equal(withLocal.pricedAt.startsWith(alone.pricedAt), true,
    "the sender's basis must still open the line, unedited");
  assert.equal(briefPricingBasis(reopened.envelope, { localRateCard: RECIPIENT_CARD }).basis,
    reopened.envelope.rateBasis);
});

test("a recipient's own declared card appears once, labelled as a comparison", () => {
  const withLocal = rendered(reopened.envelope, { localRateCard: RECIPIENT_CARD });
  assert.match(withLocal.pricedAt, new RegExp(LOCAL_CARD_COMPARISON));
  assert.match(withLocal.pricedAt, /your card is graded Declared · High, in effect from 2026-07-01\./);
  // The sender's own effective date is the one beside the money's basis, and the
  // reader's is only ever inside the comparison clause.
  assert.equal(withLocal.pricedAt.indexOf("2026-04-01") < withLocal.pricedAt.indexOf("2026-07-01"), true);
  // No new tab stop: the comparison is a sentence in a row this disclosure
  // already has, not a control.
  assert.equal(withLocal.focusables, rendered(reopened.envelope).focusables);
});

test("an undeclared local card is no comparison at all", () => {
  // The reference card is what the brief would have been priced at anyway, so
  // there is nothing to compare and nothing is said.
  const plain = briefPricingBasis(reopened.envelope, { localRateCard: null });
  assert.equal(plain.comparison, null);
  assert.equal(rendered(reopened.envelope, { localRateCard: null }).pricedAt,
    rendered(reopened.envelope).pricedAt);
});

// ---------------------------------------------------------------------------
// 3. The frozen legacy artifact.
// ---------------------------------------------------------------------------

test("the committed legacy fixture is the pre-#1265 schema, and carries no card", async () => {
  const frozen = JSON.parse(await readFile(LEGACY_FIXTURE, "utf8"));
  assert.equal(frozen.v, LEGACY_BRIEF_ENVELOPE_SCHEMA);
  assert.equal(Object.hasOwn(frozen, "rateBasis"), false,
    "the frozen artifact must stay the brief this build shipped before the field existed");
});

test("a legacy brief opens, and prices at the published reference card", async () => {
  const legacy = readBriefEnvelopeText(await readFile(LEGACY_FIXTURE, "utf8"));
  assert.equal(legacy.ok, true, legacy.summary ?? "");
  assert.equal(legacy.envelope.v, LEGACY_BRIEF_ENVELOPE_SCHEMA);
  assert.equal(legacy.envelope.rateBasis.declared, false);

  const shown = rendered(legacy.envelope);
  assert.equal(shown.headline, "$31,415", "the sender's figure still opens");
  assert.equal(shown.pricedAt, `${PRICED_AT_REFERENCE} Rate confidence: Illustrative · Low.`);
  assert.equal(shown.pricedAt.includes(PRICED_AT_DECLARED), false,
    "a brief that declared no card must not claim one");
});

test("a reader's own card cannot promote a legacy brief to contracted prices", async () => {
  const legacy = readBriefEnvelopeText(await readFile(LEGACY_FIXTURE, "utf8"));
  const shown = rendered(legacy.envelope, { localRateCard: RECIPIENT_CARD });
  assert.equal(shown.pricedAt.startsWith(`${PRICED_AT_REFERENCE} Rate confidence: Illustrative · Low.`),
    true, "the legacy wording is unchanged by anything the reader declared");
  assert.equal(shown.headline, rendered(legacy.envelope).headline);
});

// ---------------------------------------------------------------------------
// 4. What a brief may not carry, and what a malformed basis costs.
// ---------------------------------------------------------------------------

test("no card id, account handle or provider identifier reaches the file", () => {
  const text = serializeBriefEnvelope(built.envelope);
  assert.equal(text.includes("cardId"), false);
  assert.equal(text.includes(SENDER_CARD.cardId), false);
  assert.equal(Object.hasOwn(built.envelope.rateBasis, "cardId"), false);
  for (const model of built.envelope.rateBasis.models) {
    assert.deepEqual(Object.keys(model).sort(), [
      "committedUseDiscountPct", "contractedInputRate", "contractedOutputRate", "currency",
      "effectiveDate", "label", "model", "permitted",
    ]);
  }
});

test("a schema-3 brief whose rate basis is malformed is refused, not demoted", () => {
  const value = JSON.parse(serializeBriefEnvelope(built.envelope));
  delete value.rateBasis;
  assert.equal(readBriefEnvelopeText(JSON.stringify(value)).reason, BRIEF_ENVELOPE_REASON.notABrief);

  const emptied = JSON.parse(serializeBriefEnvelope(built.envelope));
  emptied.rateBasis = { ...emptied.rateBasis, models: [] };
  assert.equal(readBriefEnvelopeText(JSON.stringify(emptied)).reason, BRIEF_ENVELOPE_REASON.notABrief);

  const untiered = JSON.parse(serializeBriefEnvelope(built.envelope));
  untiered.rateBasis = { ...untiered.rateBasis, marker: null };
  assert.equal(readBriefEnvelopeText(JSON.stringify(untiered)).reason, BRIEF_ENVELOPE_REASON.notABrief);
});
