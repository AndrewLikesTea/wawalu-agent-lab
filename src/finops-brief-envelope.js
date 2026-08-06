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
import { FINOPS_PERIOD_FIELDS } from "./finops-workspace-contract.js";
import { scanRetainedContent, validateRetainedPeriod } from "./finops-workspace.js";

/**
 * The envelope's schema version. An INTEGER a reader compares, not prose.
 *
 * 2, not 1: schema 1 was `{ v, periods }` and carried no figure, no grade and no
 * disclosures. A build that read it under this contract would be guessing at
 * caveats it cannot see, so a schema-1 token is refused BY NAME rather than
 * upgraded in place — see `BRIEF_ENVELOPE_REASON.unsupportedVersion`.
 */
export const BRIEF_ENVELOPE_SCHEMA = 2;

/** Every schema this build reads, weakest-numbered first. */
export const SUPPORTED_BRIEF_ENVELOPE_SCHEMAS = Object.freeze([BRIEF_ENVELOPE_SCHEMA]);

/**
 * The required fields, in the order the contract states them. Validation walks
 * this list, so the promise and the check cannot disagree.
 */
export const BRIEF_ENVELOPE_FIELDS = Object.freeze([
  "v", "producedAt", "figure", "destination", "confidence", "provenance", "limits", "periods",
]);

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
    statement: `The file declares a schema this build does not know; it reads version `
      + `${BRIEF_ENVELOPE_SCHEMA} and reinterpreting another would mean guessing at fields it cannot see.`,
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
 * @param options `{ producedAt }` — an ISO-8601 UTC instant, or null when the
 *   producer has no clock. NEVER read from a clock in here; see rule 5.
 * @returns `{ ok, reason, envelope, periods, summary?, statement?, remedy? }`,
 *   frozen. `ok` is false with a named reason rather than a thrown error.
 */
export function buildBriefEnvelope(periods, { producedAt = null } = {}) {
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
  };
  // Built and then read back through the reader's own validator rather than
  // trusted because this module wrote it: a producer that can emit an envelope
  // its own reader refuses is the defect, and it should fail here, on the
  // sender's side, rather than in a recipient's browser.
  return validateBriefEnvelope(envelope);
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
  for (const field of BRIEF_ENVELOPE_FIELDS) {
    if (!Object.hasOwn(value, field)) {
      return refusal(BRIEF_ENVELOPE_DISCLOSURE_FIELDS.includes(field)
        ? BRIEF_ENVELOPE_REASON.missingDisclosures
        : BRIEF_ENVELOPE_REASON.notABrief);
    }
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
  });
  return Object.freeze({
    ok: true,
    reason: "read",
    envelope,
    periods: envelope.periods,
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
