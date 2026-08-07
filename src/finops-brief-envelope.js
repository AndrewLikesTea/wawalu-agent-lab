// The one shape a shared AI FinOps brief travels in — link or file, same bytes.
//
// THE PROBLEM THIS SOLVES. #1206 put a sender's own retained periods into a
// link's fragment and #1210 proved the recipient reads the same figure. Both
// require the recipient to hold a URL. A brief that has to be re-sent, attached
// to a ticket, or read next quarter needs to be a FILE — and the moment a file
// exists, the product has two ways to say the same thing, which is one more than
// it can keep honest. A field the link carries and the file drops is a
// disclosure a recipient never sees, and neither side has any way to notice.
//
// So there is exactly one envelope, defined here, and both transports consume
// it. `finops-shared-briefing-link.js` base64url-encodes what `buildBriefEnvelope`
// returns; the file reader validates the same object through the same
// `validateBriefEnvelope`. `tests/finops-brief-envelope.test.js` asserts the
// link-decoded object and the file-parsed object are field-for-field equal for
// the same brief, so the two cannot drift apart without a red test.
//
// FIVE RULES THIS MODULE HOLDS.
//
//   1. **THE REQUIRED FIELDS ARE A LIST, NOT A PARAGRAPH.** `BRIEF_ENVELOPE_FIELDS`
//      is the contract: schema version, produced-at, the figure, the destination,
//      the confidence grade, the provenance, the Limits disclosures, and the
//      periods they were all derived from. Validation walks that list. A field
//      added to the envelope without being added there is a field no reader is
//      promised, and a field removed from there stops being required in one edit
//      rather than in five.
//
//   2. **ALL OR NOTHING.** `validateBriefEnvelope` returns a verdict for the
//      WHOLE envelope before any caller touches the DOM. There is no partial
//      brief: an envelope missing its Limits disclosures is refused entire, by
//      name, rather than rendered with a gap where the caveat was. A figure
//      shown without the sentence that bounds it is the defect this issue exists
//      to prevent, and it looks identical to a correct brief.
//
//   3. **EVERY REFUSAL IS NAMED AND FIXABLE.** `BRIEF_ENVELOPE_REASON` is a
//      closed set and `BRIEF_ENVELOPE_COPY` gives each one three sentences: what
//      is true of the file, what that means for this page, and the one thing the
//      reader can do. "Could not open" sends somebody looking for a broken disk.
//
//   4. **NOTHING IS TRUSTED AND NOTHING IS SPREAD.** Every value that survives
//      validation is copied out field by field onto a fresh object —
//      `projectBriefPeriod` for records, `readText`/`readList` for the
//      disclosures. An unknown key in a supplied file reaches no consumer,
//      because no consumer is ever handed the parsed object. That is the
//      untrusted-input boundary, and it is here rather than in a renderer so
//      every renderer inherits it.
//
//   4a. **WHICH `destination` IS WHICH.** Two fields on this envelope use that
//      word for different things, and conflating them is the one mistake a
//      reader of this contract can make. `destination` (required, below) is the
//      ORG UNIT the primary finding points at — "start with Atlas Platform".
//      `view.slug` (#1330, optional) is the WORKSPACE destination the sender was
//      reading — a `finops-destinations.js` slug, the same string `?destination=`
//      carries in a URL. One names a team, the other names a place on the page.
//
//   4b. **AN OPTIONAL BLOCK IS STILL PART OF THE CONTRACT.** `plan` (#1291) is
//      the sender's committed plan. It is optional, so it is NOT in
//      `BRIEF_ENVELOPE_FIELDS` and its absence refuses nothing; its schema, its
//      units, its allowed grades, its size ceiling and its three failure states
//      are written down in `finops-brief-plan.js`, which is where a reader of
//      this contract should go next. A block that fails validation is refused
//      whole and reported through `planNotice` — never by refusing the brief.
//
//   5. **NO CLOCK.** `producedAt` is an argument, never `new Date()`. Reading it
//      here would make two encodes of the same brief differ, and the parity
//      check in `finops-share-parity.js` compares an encode against a decode.
//      A producer with no clock passes null, and null is a legal value the
//      contract names — an absent stamp is a fact about the producer, not a
//      malformed file.
//
// Read-only and network-free on every path, including the failing ones: no
// storage is imported, so opening somebody else's brief cannot write to the
// reader's own retained records. `tests/finops-brief-envelope.test.js` asserts
// the workspace export is byte-identical across an open.

import { buildExecutiveBriefing } from "./executive-finops-briefing.js";
// The sender's committed plan (#1291): an OPTIONAL block on this envelope, whose
// schema, size ceiling and three failure states are stated in one place. It is
// not a second payload format and it does not move the version below — see that
// module's header for why an old reader opening a new brief is correct rather
// than broken.
import { BRIEF_PLAN_FIELD, buildBriefPlanBlock, readBriefPlanBlock } from "./finops-brief-plan.js";
// The destination the sender was reading (#1330): a SECOND optional block, on
// the same terms as the plan block above. Its schema, its version semantics and
// its dependency on the #1326 route parser are stated in that module's header;
// the envelope's own version does not move for it, and a brief that carries no
// destination is the state every brief written before it is already in.
import { BRIEF_VIEW_FIELD, buildBriefViewBlock, readBriefViewBlock } from "./finops-brief-view.js";
import {
  DEFAULT_REFERENCE_CARD, confidenceFor as rateCardConfidenceFor, resolveRateCard,
} from "./finops-rate-card-contract.js";
import { FINOPS_PERIOD_FIELDS } from "./finops-workspace-contract.js";
import { scanRetainedContent, validateRetainedPeriod } from "./finops-workspace.js";

/**
 * The envelope's schema version. An INTEGER a reader compares, not prose.
 *
 * 3, not 1 or 2. Schema 1 was `{ v, periods }` and carried no figure, no grade
 * and no disclosures; a build that read it under this contract would be guessing
 * at caveats it cannot see, so a schema-1 token is refused BY NAME rather than
 * upgraded in place — see `BRIEF_ENVELOPE_REASON.unsupportedVersion`.
 *
 * Schema 3 adds `rateBasis` (#1265): the card the sender's figures were priced
 * at, carried WITH them. Before it, a recipient reading a brief had no way to
 * tell whose prices they were looking at, and the only card any surface could
 * reach was the reader's own — which is the one card that must never re-price
 * somebody else's brief.
 */
export const BRIEF_ENVELOPE_SCHEMA = 3;

/**
 * The schema written before #1265. It carried no rate basis at all.
 *
 * Still read, and read as a STATED fact rather than as a gap: a schema-2 brief
 * was priced at the published reference card, because that is the only card the
 * build that wrote it had. See the version branch in `validateBriefEnvelope`.
 */
export const LEGACY_BRIEF_ENVELOPE_SCHEMA = 2;

/** Every schema this build reads, weakest-numbered first. */
export const SUPPORTED_BRIEF_ENVELOPE_SCHEMAS = Object.freeze([
  LEGACY_BRIEF_ENVELOPE_SCHEMA, BRIEF_ENVELOPE_SCHEMA,
]);

/**
 * The required fields, in the order the contract states them. Validation walks
 * this list, so the promise and the check cannot disagree.
 */
export const BRIEF_ENVELOPE_FIELDS = Object.freeze([
  "v", "producedAt", "figure", "destination", "confidence", "provenance", "limits", "periods",
]);

/**
 * The field schema 3 added, required from schema 3 on and absent before it.
 *
 * Kept out of `BRIEF_ENVELOPE_FIELDS` on purpose: that list is what EVERY schema
 * this build reads must carry, and demanding a field of a file written before it
 * existed would refuse a brief that is not malformed. `requiredFieldsFor` is the
 * one place the two lists are joined.
 */
export const BRIEF_RATE_BASIS_FIELD = "rateBasis";

/** The fields one schema requires. Version in, list out; no caller branches. */
export function requiredFieldsFor(version) {
  return version >= BRIEF_ENVELOPE_SCHEMA
    ? Object.freeze([...BRIEF_ENVELOPE_FIELDS, BRIEF_RATE_BASIS_FIELD])
    : BRIEF_ENVELOPE_FIELDS;
}

/**
 * The three fields that are disclosures rather than figures: how far to trust
 * the number, where it came from, and what it does not support. They are called
 * out separately because their absence has its own refusal — a brief that lost
 * its caveats is worse than one that failed to open.
 */
export const BRIEF_ENVELOPE_DISCLOSURE_FIELDS = Object.freeze([
  "confidence", "provenance", "limits",
]);

/** How many periods an envelope may carry: the most recent six. */
export const MAX_BRIEF_PERIODS = 6;

/** Every way an envelope is refused. A closed set; each renders its own copy. */
export const BRIEF_ENVELOPE_REASON = Object.freeze({
  notABrief: "not_a_brief",
  unsupportedVersion: "unsupported_token_version",
  missingDisclosures: "missing_limits_disclosures",
  rejectedRecords: "records_failed_contract",
  empty: "no_period_in_token",
});

/**
 * What each refusal says when the envelope arrived as a FILE.
 *
 * The link codec keeps its own wording for the same codes — "ask the sender to
 * copy the link again" is wrong advice for somebody holding a download — but the
 * codes are shared, so a refusal cannot exist on one transport and not the other.
 */
export const BRIEF_ENVELOPE_COPY = Object.freeze({
  [BRIEF_ENVELOPE_REASON.notABrief]: Object.freeze({
    summary: "That file is not a shared brief",
    statement: "The file opened and its text was read in this tab, but it is not a shared AI FinOps "
      + "brief: it is either not JSON at all, or it is JSON with none of this envelope's fields on it.",
    remedy: "Nothing was read from your browser, nothing was stored, and nothing is shown. Ask the "
      + "sender for the file they downloaded from the AI FinOps answer region.",
  }),
  [BRIEF_ENVELOPE_REASON.unsupportedVersion]: Object.freeze({
    summary: "That brief was made by a newer version of this page",
    statement: `The file declares a schema this build does not know; it reads versions `
      + `${SUPPORTED_BRIEF_ENVELOPE_SCHEMAS.join(" and ")} and reinterpreting another would mean `
      + "guessing at fields it cannot see.",
    remedy: "Nothing was changed and no figure is shown. Reloading after this site next updates is "
      + "what makes the file readable, or the sender can export a fresh one.",
  }),
  [BRIEF_ENVELOPE_REASON.missingDisclosures]: Object.freeze({
    summary: "That brief is missing the Limits disclosures",
    statement: "The file is a brief, but at least one of the confidence grade, the provenance and the "
      + "Limits disclosures is absent — the three things that say how far the figure can be trusted.",
    remedy: "No part of the brief is shown, because a figure without the sentences that bound it "
      + "reads as more certain than it is. Ask the sender to export the brief again.",
  }),
  [BRIEF_ENVELOPE_REASON.rejectedRecords]: Object.freeze({
    summary: "A period in that brief failed the retained-record contract",
    statement: "At least one period in the file was rejected by the same contract this browser holds "
      + "its own retained periods to, so briefing on the rest could publish a partial figure.",
    remedy: "No shared figure is shown and nothing of yours was read or changed. Ask the sender to "
      + "run their analysis again and export a fresh brief.",
  }),
  [BRIEF_ENVELOPE_REASON.empty]: Object.freeze({
    summary: "That brief carries no period",
    statement: "The file parsed, declared this build's schema, and holds no period, so there is no "
      + "month in it to brief on.",
    remedy: "Nothing of yours was read or changed. Ask the sender to analyze an export before "
      + "downloading the brief.",
  }),
});

/** An ISO-8601 UTC instant, to the millisecond. The only stamp shape accepted. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A string, or null. Never a number coerced, never an object stringified. */
const readText = (value) => (typeof value === "string" && value.trim() !== "" ? value : null);

// ---------------------------------------------------------------------------
// The rate basis: whose prices these are (#1265).
// ---------------------------------------------------------------------------
//
// THE DEFECT THIS CLOSES. A brief carries a money figure. Until now it carried
// nothing about the card that figure was priced at, so a recipient reading one
// had exactly two ways to interpret it, and no way to tell them apart: the
// sender's contracted rates, or the published-list reference card. The moment
// this build can reach a card of the READER'S own, the ambiguity becomes a
// defect — the reader's discount would silently reprice a colleague's number,
// and the brief would look right while saying something nobody wrote.
//
// So the sender's card travels WITH the figures, and `briefPricingBasis` is the
// one answer to "which card priced this". A recipient's own card is never that
// answer; it is a comparison, and it is labelled as one.
//
// WHAT TRAVELS, AND WHAT DELIBERATELY DOES NOT. The five things a reader needs
// to check a price: the two contracted rates, the committed-use discount, which
// destinations are permitted, the effective date, and the confidence tier the
// rate-card ladder already grades. NOT the card's `cardId`: an id a lead typed
// is the one field on a card that could name a provider account or a contract,
// and a brief is a file that gets forwarded. It is dropped on the way in and on
// the way out.

/** The fields of one destination model on a carried card. The card's own names. */
export const BRIEF_RATE_MODEL_FIELDS = Object.freeze([
  "model", "label", "contractedInputRate", "contractedOutputRate", "currency",
  "effectiveDate", "committedUseDiscountPct", "permitted",
]);

/** A number in the card's own range, or null. Never a string coerced. */
const readRate = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Project one destination model onto the allowlist above. Copied, never spread. */
function projectRateModel(model) {
  return Object.freeze({
    model: readText(model?.model),
    label: readText(model?.label),
    contractedInputRate: readRate(model?.contractedInputRate),
    contractedOutputRate: readRate(model?.contractedOutputRate),
    currency: readText(model?.currency),
    effectiveDate: readText(model?.effectiveDate),
    committedUseDiscountPct: readRate(model?.committedUseDiscountPct),
    permitted: typeof model?.permitted === "boolean" ? model.permitted : null,
  });
}

/**
 * The day a whole card is in effect from: the LATEST date any of its models
 * declares, because a card is only fully in effect once its last rate is. Null
 * when no model states one, which is the reference card's own answer.
 */
function cardEffectiveDate(models) {
  const stated = models.map((model) => model.effectiveDate).filter((date) => date !== null);
  return stated.length === 0 ? null : stated.reduce((latest, date) => (date > latest ? date : latest));
}

/**
 * The rate basis for one card, graded by the rate-card contract's own ladder.
 *
 * No clock: `confidenceFor` is called without an `asOf`, so the tier a brief
 * carries is the tier the sender's build computed and not one that changes on
 * the day a recipient opens the file.
 *
 * @param card a declared rate card, or null for the published reference card.
 */
export function briefRateBasis(card = null) {
  const resolved = resolveRateCard(card);
  const verdict = rateCardConfidenceFor(resolved.card);
  const models = (resolved.card.models ?? []).map(projectRateModel);
  return Object.freeze({
    declared: resolved.declared,
    source: resolved.card.source ?? "published-list",
    effectiveDate: cardEffectiveDate(models),
    tier: verdict.tier,
    marker: verdict.marker,
    label: verdict.label,
    models: Object.freeze(models),
  });
}

/** The basis a brief that declared no card of its own was priced at. */
export const REFERENCE_RATE_BASIS = briefRateBasis(DEFAULT_REFERENCE_CARD);

/**
 * Read a supplied rate basis, or null when the value is not one.
 *
 * Untrusted input: every field is copied out by name and the tier is re-checked
 * against the ladder's own vocabulary, so a file claiming `tier: "audited"` is
 * refused rather than rendered beside a colleague's money.
 */
function readRateBasis(value) {
  if (!isPlainObject(value) || !Array.isArray(value.models) || value.models.length === 0) return null;
  if (typeof value.declared !== "boolean") return null;
  const models = value.models.map(projectRateModel);
  if (models.some((model) => model.model === null)) return null;
  const tier = readText(value.tier);
  const marker = readText(value.marker);
  const label = readText(value.label);
  if (tier === null || marker === null || label === null) return null;
  return Object.freeze({
    declared: value.declared,
    source: readText(value.source) ?? "published-list",
    effectiveDate: readText(value.effectiveDate),
    tier,
    marker,
    label,
    models: Object.freeze(models),
  });
}

/**
 * WHICH CARD PRICED THIS BRIEF — the precedence rule, in one function (#1265).
 *
 * THE RULE. The basis is the OPENED BRIEF'S, always. A recipient's own declared
 * card is never the basis for a figure somebody else computed, however much
 * better it prices: the number on screen was derived in the sender's browser at
 * the sender's rates, and repricing it here would produce a figure that exists
 * in nobody's analysis. The local card comes back as `comparison`, for a surface
 * to label as a comparison, or as null when the reader has declared none.
 *
 * A caller cannot get the precedence wrong by accident, because it cannot ask
 * for the two cards separately: one call, one basis, one clearly-named other.
 *
 * @param envelope a VALIDATED envelope. Its `rateBasis` is always present —
 *   schema 2 is read as the reference card, see `validateBriefEnvelope`.
 * @param options.localRateCard the reader's own declared card, or null.
 */
export function briefPricingBasis(envelope, { localRateCard = null } = {}) {
  const basis = envelope?.rateBasis ?? null;
  const local = localRateCard === null ? null : briefRateBasis(localRateCard);
  return Object.freeze({
    basis,
    declared: basis?.declared === true,
    // An undeclared local card is the reference card, which is what the brief
    // would have been priced at anyway: nothing to compare, so nothing shown.
    comparison: local?.declared === true ? local : null,
  });
}

/** Project one record onto the contract's allowlist. Copied out, never spread. */
export function projectBriefPeriod(period) {
  const projected = {};
  for (const field of FINOPS_PERIOD_FIELDS) {
    if (period?.[field] !== undefined) projected[field] = period[field];
  }
  return projected;
}

/**
 * Hold a list of records to the retained-period contract in both directions.
 *
 * Building and reading call this with the same arguments, which is the point: a
 * record this build would refuse to read is a record it refuses to write.
 */
export function briefPeriodsViolateContract(periods) {
  if (!Array.isArray(periods)) return true;
  if (periods.length > MAX_BRIEF_PERIODS) return true;
  for (const period of periods) {
    if (!validateRetainedPeriod(period).ok) return true;
    for (const key of Object.keys(period)) {
      if (!FINOPS_PERIOD_FIELDS.includes(key)) return true;
    }
  }
  return !scanRetainedContent(periods, "periods").ok;
}

const refusal = (reason) => Object.freeze({
  ok: false,
  reason,
  envelope: null,
  periods: Object.freeze([]),
  // The plan block's own verdict, on every result shape: a caller reads one
  // field to find out what to say about the plan, refused brief or not.
  planNotice: null,
  // The destination block's verdict, on the same terms (#1330).
  viewNotice: null,
  ...BRIEF_ENVELOPE_COPY[reason],
});

/**
 * Build the envelope for a sender's own retained periods.
 *
 * Every derived field is read off `buildExecutiveBriefing` — the same function
 * the recipient view renders from — rather than recomputed here, so the figure
 * in the envelope is the figure the page would draw. This module holds no
 * threshold of its own and therefore cannot disagree with the page.
 *
 * @param periods retained-period records, newest last, as the workspace keeps them.
 * @param options `{ producedAt, rateCard, plan }` — an ISO-8601 UTC instant, or null
 *   when the producer has no clock (NEVER read from a clock in here; see rule
 *   5), and the SENDER'S declared rate card, or null for the published
 *   reference card. The card the sender's figures were priced at travels with
 *   them; a recipient's own card can then be told apart from it (#1265).
 *   `plan` is `planScope()`'s model, or null. A model with a committed move
 *   writes the optional plan block; a model with none writes NO key at all,
 *   because absence is how this contract says "nothing was committed" (#1291).
 * @returns `{ ok, reason, envelope, periods, planNotice, summary?, statement?,
 *   remedy? }`, frozen. `ok` is false with a named reason rather than a thrown
 *   error. `planNotice` names the plan block's own state and never makes `ok`
 *   false: a plan that could not be written must not stop a brief being shared.
 */
export function buildBriefEnvelope(
  periods, { producedAt = null, rateCard = null, plan = null, view = null } = {},
) {
  if (!Array.isArray(periods) || periods.length === 0) {
    return refusal(BRIEF_ENVELOPE_REASON.empty);
  }
  if (producedAt !== null && !(typeof producedAt === "string" && INSTANT.test(producedAt))) {
    return refusal(BRIEF_ENVELOPE_REASON.notABrief);
  }
  // The most recent six. `slice` from the end because the store appends.
  const shared = periods.slice(-MAX_BRIEF_PERIODS).map(projectBriefPeriod);
  if (briefPeriodsViolateContract(shared)) return refusal(BRIEF_ENVELOPE_REASON.rejectedRecords);

  let brief;
  try {
    brief = buildExecutiveBriefing(shared);
  } catch {
    return refusal(BRIEF_ENVELOPE_REASON.rejectedRecords);
  }
  const envelope = {
    v: BRIEF_ENVELOPE_SCHEMA,
    producedAt,
    figure: {
      valueMinor: brief.recoverable?.valueMinor ?? null,
      currency: brief.recoverable?.currency ?? null,
      unit: brief.recoverable?.unit ?? null,
      label: brief.recoverable?.label ?? null,
    },
    destination: {
      orgUnitId: brief.primaryFinding?.orgUnitId ?? null,
      statement: brief.primaryFinding?.statement ?? null,
    },
    confidence: {
      level: brief.confidence?.level ?? null,
      meaning: brief.confidence?.meaning ?? null,
    },
    provenance: {
      dataset: brief.provenance?.dataset ?? null,
      derivedAt: brief.provenance?.derivedAt ?? null,
      periodIds: [...(brief.provenance?.periodIds ?? [])],
      retainedPeriodCount: brief.provenance?.retainedPeriodCount ?? shared.length,
    },
    limits: (brief.limitations ?? []).map((entry) => ({
      code: entry.code, statement: entry.statement,
    })),
    periods: shared,
    // The sender's own prices, stated rather than assumed. A sender with no
    // declared card ships the reference basis, so every schema-3 brief says
    // what it was priced at instead of leaving a recipient to guess.
    rateBasis: briefRateBasis(rateCard),
  };
  // The sender's committed plan, built field by field by the plan contract from
  // the plan model's own known fields. Nothing is spread and nothing is
  // JSON-copied, so a plan state polluted with an extra key cannot carry it into
  // a payload. A refused block writes NO key: a brief with no plan and a brief
  // whose plan would not fit both say the same thing on the wire, and the
  // difference is reported to this caller instead.
  const planBlock = buildBriefPlanBlock(plan);
  if (planBlock.ok) envelope[BRIEF_PLAN_FIELD] = planBlock.block;
  // The destination the sender was reading, on the same terms (#1330): four
  // fields built by name from live page state, or NO key when there is nothing
  // to point at. A pointer that would not resolve is refused here, on the
  // sender's side, rather than shipped for a recipient to fail to open.
  const viewBlock = buildBriefViewBlock(view);
  if (viewBlock.ok) envelope[BRIEF_VIEW_FIELD] = viewBlock.block;
  // Built and then read back through the reader's own validator rather than
  // trusted because this module wrote it: a producer that can emit an envelope
  // its own reader refuses is the defect, and it should fail here, on the
  // sender's side, rather than in a recipient's browser.
  const built = validateBriefEnvelope(envelope);
  // A write-side plan refusal is reported over the read-side one, because it is
  // the more specific fact: "your plan was too large to carry" rather than "this
  // brief has no plan on it".
  // A write-side block refusal is reported over the read-side one, because it is
  // the more specific fact: "your plan was too large to carry" rather than "this
  // brief has no plan on it". The two blocks are independent; neither can make
  // `ok` false and neither hides the other.
  return Object.freeze({
    ...built,
    ...(planBlock.ok ? {} : { planNotice: planBlock.notice }),
    ...(viewBlock.ok ? {} : { viewNotice: viewBlock.notice }),
  });
}

/**
 * Validate a whole envelope and project it onto the contract.
 *
 * TOTAL, and it never throws. Callers get a verdict for the entire envelope
 * BEFORE anything is drawn, and the returned `envelope` is a fresh object built
 * field by field from the input — an unknown key on the supplied value reaches
 * no caller.
 *
 * @returns `{ ok, reason, envelope, periods, summary?, statement?, remedy? }`.
 */
export function validateBriefEnvelope(value) {
  if (!isPlainObject(value)) return refusal(BRIEF_ENVELOPE_REASON.notABrief);
  // Version before shape. An envelope from a build that changed what `figure`
  // MEANS must be refused as the wrong version, not as a malformed one.
  if (value.v === undefined || value.v === null) return refusal(BRIEF_ENVELOPE_REASON.notABrief);
  if (!SUPPORTED_BRIEF_ENVELOPE_SCHEMAS.includes(value.v)) {
    return refusal(BRIEF_ENVELOPE_REASON.unsupportedVersion);
  }
  for (const field of requiredFieldsFor(value.v)) {
    if (!Object.hasOwn(value, field)) {
      return refusal(BRIEF_ENVELOPE_DISCLOSURE_FIELDS.includes(field)
        ? BRIEF_ENVELOPE_REASON.missingDisclosures
        : BRIEF_ENVELOPE_REASON.notABrief);
    }
  }
  // THE VERSION BRANCH, written out rather than defaulted (#1265). What each
  // schema means for the prices, and nothing decided by a `??`:
  //
  //   2 — written before this field existed. That build had no way to declare a
  //       card, so its figures were priced at the published reference card. The
  //       reader states that as a fact, and the wording a legacy brief is shown
  //       with is the reference wording it always had.
  //   3 — carries the sender's own card, which may be a declared one or the
  //       reference card. It is required, and a schema-3 brief whose basis is
  //       malformed is refused rather than quietly demoted to the reference
  //       card: a brief that says "these are contracted rates" and cannot say
  //       which is not a weaker brief, it is an unreadable one.
  let rateBasis;
  if (value.v === LEGACY_BRIEF_ENVELOPE_SCHEMA) {
    rateBasis = REFERENCE_RATE_BASIS;
  } else {
    rateBasis = readRateBasis(value[BRIEF_RATE_BASIS_FIELD]);
    if (rateBasis === null) return refusal(BRIEF_ENVELOPE_REASON.notABrief);
  }
  if (value.producedAt !== null
    && !(typeof value.producedAt === "string" && INSTANT.test(value.producedAt))) {
    return refusal(BRIEF_ENVELOPE_REASON.notABrief);
  }
  if (!isPlainObject(value.figure) || !isPlainObject(value.destination)) {
    return refusal(BRIEF_ENVELOPE_REASON.notABrief);
  }
  if (!isPlainObject(value.confidence) || !isPlainObject(value.provenance)
    || !Array.isArray(value.limits)) {
    return refusal(BRIEF_ENVELOPE_REASON.missingDisclosures);
  }
  // A grade with no meaning beside it, or an empty Limits list, is the same
  // failure as an absent field: the reader is shown a figure and told nothing
  // about what bounds it.
  if (readText(value.confidence.level) === null || readText(value.confidence.meaning) === null) {
    return refusal(BRIEF_ENVELOPE_REASON.missingDisclosures);
  }
  const limits = value.limits
    .filter(isPlainObject)
    .map((entry) => ({ code: readText(entry.code), statement: readText(entry.statement) }))
    .filter((entry) => entry.code !== null && entry.statement !== null);
  if (limits.length === 0 || limits.length !== value.limits.length) {
    return refusal(BRIEF_ENVELOPE_REASON.missingDisclosures);
  }
  if (!Array.isArray(value.periods)) return refusal(BRIEF_ENVELOPE_REASON.notABrief);
  if (value.periods.length === 0) return refusal(BRIEF_ENVELOPE_REASON.empty);
  const periods = value.periods.map(projectBriefPeriod);
  if (briefPeriodsViolateContract(periods)) return refusal(BRIEF_ENVELOPE_REASON.rejectedRecords);

  // THE PLAN BLOCK IS OPTIONAL AND ITS FAILURES ARE ITS OWN (#1291). Absent is a
  // normal state — every brief written before this block existed is in it — and a
  // malformed or oversized block is refused WHOLE without refusing the brief
  // around it. Nothing below can set `ok` false: a recipient must still be able
  // to open the analysis they were sent.
  const planRead = readBriefPlanBlock(value[BRIEF_PLAN_FIELD]);
  // Same rule for the destination block (#1330): absent is normal, a block this
  // build cannot read is refused as a BLOCK and reported through `viewNotice`,
  // and neither outcome can set `ok` false. A recipient always keeps the
  // analysis and always has the front door.
  const viewRead = readBriefViewBlock(value[BRIEF_VIEW_FIELD]);

  // Rebuilt key by key. Nothing from `value` is spread, so an unknown field on a
  // hostile file is dropped here and can reach no renderer.
  const envelope = Object.freeze({
    v: value.v,
    producedAt: value.producedAt,
    figure: Object.freeze({
      valueMinor: Number.isFinite(value.figure.valueMinor) ? value.figure.valueMinor : null,
      currency: readText(value.figure.currency),
      unit: readText(value.figure.unit),
      label: readText(value.figure.label),
    }),
    destination: Object.freeze({
      orgUnitId: readText(value.destination.orgUnitId),
      statement: readText(value.destination.statement),
    }),
    confidence: Object.freeze({
      level: value.confidence.level,
      meaning: value.confidence.meaning,
    }),
    provenance: Object.freeze({
      dataset: readText(value.provenance.dataset),
      derivedAt: readText(value.provenance.derivedAt),
      periodIds: Object.freeze((Array.isArray(value.provenance.periodIds)
        ? value.provenance.periodIds : []).map(readText).filter((id) => id !== null)),
      retainedPeriodCount: Number.isFinite(value.provenance.retainedPeriodCount)
        ? value.provenance.retainedPeriodCount
        : periods.length,
    }),
    limits: Object.freeze(limits.map((entry) => Object.freeze(entry))),
    periods: Object.freeze(periods.map((period) => Object.freeze(period))),
    // Always present, on every schema this build reads: a consumer asking whose
    // prices these are gets an answer rather than an absence to interpret.
    rateBasis,
    // The projected plan block, or null on all three of its states. A view reads
    // this for the figures and `planNotice` below for the sentence; neither can
    // be half-set, so a rendered plan total always has a validated plan under it.
    plan: planRead.plan,
    // The projected destination block, or null on both of its refusals. A
    // surface reads this to resolve where the brief points and `viewNotice` for
    // the sentence to say when it cannot.
    view: viewRead.view,
  });
  return Object.freeze({
    ok: true,
    reason: "read",
    envelope,
    periods: envelope.periods,
    planNotice: planRead.notice,
    viewNotice: viewRead.notice,
  });
}

/**
 * Serialize an envelope to bytes that depend only on its values.
 *
 * Keys are rebuilt in sorted order, so two envelopes that differ only in
 * insertion order serialize identically — the property the link/file parity
 * test rests on. Arrays keep their order: `periods` is chronological and
 * `limits` is the contract's own order, both stated properties.
 *
 * @param options `{ pretty }` — indented for a file a person may open in an
 *   editor, compact for a token that has to survive an address bar. Same object
 *   either way; only the whitespace differs.
 */
export function serializeBriefEnvelope(envelope, { pretty = false } = {}) {
  const sort = (key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const sorted = {};
    for (const name of Object.keys(value).sort()) sorted[name] = value[name];
    return sorted;
  };
  return pretty
    ? `${JSON.stringify(envelope, sort, 2)}\n`
    : JSON.stringify(envelope, sort);
}

/**
 * Read the text of a supplied file into a validated envelope.
 *
 * The whole path a hostile file takes: parse, then validate, then project.
 * Nothing is drawn by this function and nothing is stored by it — the caller
 * gets a verdict and decides. A parse failure is `notABrief` rather than a
 * thrown error, because "that file is not a shared brief" is the sentence the
 * reader needs and an exception is not one.
 */
export function readBriefEnvelopeText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return refusal(BRIEF_ENVELOPE_REASON.notABrief);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refusal(BRIEF_ENVELOPE_REASON.notABrief);
  }
  return validateBriefEnvelope(parsed);
}

/** What a downloaded brief is called and what it is. */
export const BRIEF_FILE_NAME = "shiplog-finops-shared-brief.json";
export const BRIEF_FILE_MEDIA_TYPE = "application/json";
