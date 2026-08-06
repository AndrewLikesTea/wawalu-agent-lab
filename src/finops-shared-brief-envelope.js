// The shared-brief envelope: ONE shape, carried by a link and by a file (#1207).
//
// THE PROBLEM THIS SOLVES. #1206 gave a lead a link that carries their own
// figures in its fragment. A link is not always sendable — it is long, chat
// clients truncate it, and some recipients are handed a file and nothing else.
// So the same brief has to travel as a file a recipient opens locally. The
// failure mode that ends in two builds disagreeing about "the same figures" is
// a SECOND SHAPE: a file format authored beside the link codec, drifting a
// field at a time. This module is the single definition, and both paths go
// through it.
//
// HOW THE TWO PATHS STAY ONE SHAPE.
//
//   * The link token stays what #1206 made it: the compact operands (the
//     retained-period records) under the codec's own version. On the way in it
//     is put through `sharedBriefFromPeriods` here.
//   * The file IS this envelope, serialized. On the way in it is put through
//     `validateSharedBrief` here.
//
//   Same periods in, identical envelope out, whichever door it arrived by, and
//   `tests/finops-shared-brief-envelope.test.js` asserts exactly that against a
//   link payload and a file payload built from one brief. The builder is the
//   only place a field is chosen; adding one to the file without adding it to
//   the link is not possible from here.
//
// EVERYTHING BELOW IS PURE. No DOM, no fetch, no storage, no clock, no random
// source. `producedAt` is the analysis's own `derivedAt`, never a wall clock:
// a brief that stamps itself with the reader's clock claims to be current when
// it is a message about the past.
//
// A SHARED FILE IS UNTRUSTED INPUT, AND REFUSAL IS ALL-OR-NOTHING.
// The reader is total — it returns a named refusal, never throws — and it never
// half-accepts. Malformed JSON, a `schemaVersion` this build does not read, and
// a missing required disclosure are three different sentences naming three
// different fixes, because "could not open that" tells a recipient nothing they
// can act on. Unknown fields are DROPPED rather than carried: the envelope that
// leaves this module holds only the fields named below, so a future build
// cannot smuggle a slot past a view that renders whatever it is handed.

import { FINOPS_PERIOD_FIELDS } from "./finops-workspace-contract.js";

/**
 * The envelope's schema version. An INTEGER a reader compares, not prose it
 * parses. A file declaring anything else is refused by name — see
 * `SHARED_BRIEF_REASON.unsupportedVersion` — rather than read best-effort.
 */
export const SHARED_BRIEF_SCHEMA_VERSION = 1;

/** The closed top-level field list. Anything else in a file is dropped. */
export const SHARED_BRIEF_FIELDS = Object.freeze([
  "schemaVersion", "producedAt", "figure", "destination", "confidence",
  "provenance", "limits",
]);

/** The closed field list of each sub-object, in the same closed-by-default way. */
export const SHARED_BRIEF_SUBFIELDS = Object.freeze({
  figure: Object.freeze(["label", "valueMinor", "currency"]),
  destination: Object.freeze(["action", "savingMinor"]),
  confidence: Object.freeze(["grade", "coverageRatioPpm"]),
  provenance: Object.freeze(["designation", "analysisPeriod", "recordCount"]),
});

/**
 * The Limits disclosures a brief must carry, by id.
 *
 * These are the sentences that keep a figure from being read as more than it
 * is. A brief missing one is refused rather than shown without it: a recipient
 * who cannot see the bounds is the reader this whole path exists to protect.
 */
export const SHARED_BRIEF_LIMIT_IDS = Object.freeze([
  "locality", "coverage", "attribution",
]);

/** The confidence grades a brief may declare. A closed set, as the store's is. */
export const SHARED_BRIEF_GRADES = Object.freeze([
  "high", "moderate", "low", "insufficient",
]);

/** The largest shared-brief file this build will read, before it is parsed. */
export const MAX_SHARED_BRIEF_BYTES = 200_000;

/** The longest string any slot may carry, so a file cannot flood a view. */
export const MAX_SHARED_BRIEF_STRING = 400;

/** Every way a shared brief is refused. Closed; each renders its own sentence. */
export const SHARED_BRIEF_REASON = Object.freeze({
  absent: "no_file_chosen",
  oversize: "file_over_size",
  malformed: "not_readable_json",
  unsupportedVersion: "unsupported_schema_version",
  missingField: "required_field_missing",
  invalidField: "field_failed_contract",
});

const MARKUP_PATTERN = /<\s*[a-z!/]/i;
const SCHEME_PATTERN = /(?:javascript|vbscript)\s*:/i;
// The two shapes the retained-period contract already writes: a month, and an
// explicit range. A pattern rather than "any string", so a brief cannot carry a
// period a reader has to interpret.
const PERIOD_PATTERN = /^\d{4}-\d{2}(?:-\d{2})?(?: to \d{4}-\d{2}(?:-\d{2})?)?$/;

/**
 * What a refusal says: what is true, what it means, and the fix.
 *
 * `field` and `detail` are filled at refusal time so the sentence NAMES the
 * thing — the field, or the version — rather than gesturing at the file.
 */
function refusalCopy(reason, field, detail) {
  switch (reason) {
    case SHARED_BRIEF_REASON.absent:
      return {
        summary: "No shared brief was chosen",
        statement: "Nothing was read from this browser and nothing was stored.",
        remedy: "Choose the .json brief file the sender exported.",
      };
    case SHARED_BRIEF_REASON.oversize:
      return {
        summary: "That file is too large to be a shared brief",
        statement: `A shared brief is a few aggregates; this build reads at most `
          + `${MAX_SHARED_BRIEF_BYTES} bytes, and this file is larger.`,
        remedy: "Nothing was read. Ask the sender to export the brief again — a provider "
          + "export is not a brief and will not open here.",
      };
    case SHARED_BRIEF_REASON.malformed:
      return {
        summary: "That file is not readable as a shared brief",
        statement: "Its bytes are not JSON this build can parse, and a partly parsed brief "
          + "would quote figures that are not in it.",
        remedy: "Nothing was read and nothing was shown. Ask the sender to send the brief "
          + "file again — a file copied out of a chat message is easily cut short.",
      };
    case SHARED_BRIEF_REASON.unsupportedVersion:
      return {
        summary: "That brief was written by a different build",
        statement: `The file declares schemaVersion ${detail}; this build reads `
          + `schemaVersion ${SHARED_BRIEF_SCHEMA_VERSION}, and reinterpreting another would `
          + "mean guessing at fields it cannot see.",
        remedy: "Nothing was shown. Reload this page after the site next updates, or ask "
          + "the sender to export the brief again from a current build.",
      };
    case SHARED_BRIEF_REASON.missingField:
      return {
        summary: `That brief is missing ${field}`,
        statement: `A shared brief must carry ${field}; this one does not, so nothing of it `
          + "was shown rather than a figure without the bound that qualifies it.",
        remedy: `Ask the sender to export the brief again — ${field} is written by the `
          + "export, so a file without it was edited or truncated after it was made.",
      };
    default:
      return {
        summary: `That brief's ${field} failed the contract`,
        statement: `${field} is present but is not a value this build will read, so the `
          + "whole file was refused rather than one slot shown blank.",
        remedy: `Ask the sender to export the brief again rather than editing ${field} by hand.`,
      };
  }
}

function refuse(reason, field = "", detail = "") {
  return Object.freeze({
    ok: false, reason, field, brief: null, ...refusalCopy(reason, field, detail),
  });
}

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function safeString(value, max = MAX_SHARED_BRIEF_STRING) {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && !MARKUP_PATTERN.test(value) && !SCHEME_PATTERN.test(value);
}

const isCount = (value) =>
  Number.isSafeInteger(value) && value >= 0;

/** Copy a sub-object onto its allowlist. Unknown keys are dropped, never spread. */
function project(source, fields) {
  const projected = {};
  for (const field of fields) {
    if (source?.[field] !== undefined) projected[field] = source[field];
  }
  return projected;
}

// ---------------------------------------------------------------------------
// Building — the one place a field is chosen
// ---------------------------------------------------------------------------

const GRADE_WORDS = Object.freeze({
  high: "measured across nearly every record",
  moderate: "measured across most records",
  low: "measured across a minority of records",
  insufficient: "not measured — no record was analyzed",
});

/**
 * Build the envelope from the sender's retained periods.
 *
 * The most recent period is the brief: a brief answers one month, and a link
 * that carries six of them still publishes one figure. The earlier periods are
 * what the executive briefing draws a trend from and are not part of this
 * envelope, which is why a file is small enough to email.
 *
 * @param periods retained-period records, newest last, as the workspace keeps them.
 * @returns the frozen envelope, or `null` when there is no period to brief on.
 *   Null rather than a throw: the caller is a control that has to say why it is
 *   offering nothing.
 */
export function sharedBriefFromPeriods(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const period = project(periods[periods.length - 1], FINOPS_PERIOD_FIELDS);
  if (!period.period || !period.derivedAt) return null;

  const grade = SHARED_BRIEF_GRADES.includes(period.confidence) ? period.confidence : "insufficient";
  const coverage = isCount(period.coverageRatioPpm) ? period.coverageRatioPpm : 0;
  const analyzed = isCount(period.recordsAnalyzed) ? period.recordsAnalyzed : 0;
  const total = isCount(period.recordsTotal) ? period.recordsTotal : analyzed;
  const attributed = isCount(period.attributedSpendMinor) ? period.attributedSpendMinor : 0;

  return Object.freeze({
    schemaVersion: SHARED_BRIEF_SCHEMA_VERSION,
    producedAt: period.derivedAt,
    figure: Object.freeze({
      label: "Analyzed AI spend",
      valueMinor: isCount(period.analyzedSpendMinor) ? period.analyzedSpendMinor : 0,
      currency: "USD",
    }),
    destination: Object.freeze({
      action: "Route the identified workload to a cheaper model and re-measure next month",
      savingMinor: isCount(period.recoverableScenarioMinor) ? period.recoverableScenarioMinor : 0,
    }),
    confidence: Object.freeze({ grade, coverageRatioPpm: coverage }),
    provenance: Object.freeze({
      designation: "The sender's own analyzed export",
      analysisPeriod: period.period,
      recordCount: analyzed,
    }),
    limits: Object.freeze([
      Object.freeze({
        id: "locality",
        text: "This brief was read in your browser only. Nothing was uploaded, and opening it "
          + "changed nothing this browser had already kept.",
      }),
      Object.freeze({
        id: "coverage",
        text: `The figure covers ${analyzed} of ${total} records the sender analyzed — `
          + `${GRADE_WORDS[grade]}.`,
      }),
      Object.freeze({
        id: "attribution",
        text: `${attributed} minor units of that spend could be attributed to a named team; `
          + "the rest is counted but unattributed, so any per-team reading is a bound, not a total.",
      }),
    ]),
  });
}

/**
 * Serialize an envelope to the bytes a shared-brief file carries.
 *
 * No replacer: the envelope reaching here has already been projected onto the
 * closed lists by the builder or the validator, so filtering again here would
 * only be a second place for the field list to drift.
 */
export function sharedBriefFileText(brief) {
  return `${JSON.stringify(brief, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Reading — total, all-or-nothing, and never a partial render
// ---------------------------------------------------------------------------

function validateLimits(limits) {
  if (!Array.isArray(limits)) return refuse(SHARED_BRIEF_REASON.missingField, "limits");
  const seen = new Map();
  for (const limit of limits) {
    if (!isPlainObject(limit)) return refuse(SHARED_BRIEF_REASON.invalidField, "limits");
    if (!safeString(limit.text)) return refuse(SHARED_BRIEF_REASON.invalidField, "limits");
    if (typeof limit.id === "string") seen.set(limit.id, limit.text);
  }
  for (const id of SHARED_BRIEF_LIMIT_IDS) {
    if (!seen.has(id)) {
      return refuse(SHARED_BRIEF_REASON.missingField, `the "${id}" Limits disclosure`);
    }
  }
  // Projected in the contract's own order, so two files carrying the same
  // disclosures in a different order render the same brief.
  return Object.freeze({
    ok: true,
    limits: Object.freeze(SHARED_BRIEF_LIMIT_IDS.map((id) =>
      Object.freeze({ id, text: seen.get(id) }))),
  });
}

/**
 * Hold a candidate envelope to the contract.
 *
 * REFUSAL IS ALL-OR-NOTHING and every refusal names its field or its version.
 * Unknown fields are dropped — the returned `brief` carries only the closed
 * lists above — so a view can render what it is handed without deciding what
 * it is safe to show.
 *
 * @returns `{ ok, reason, field, brief, summary?, statement?, remedy? }`, frozen.
 */
export function validateSharedBrief(value) {
  if (!isPlainObject(value)) return refuse(SHARED_BRIEF_REASON.malformed);
  if (value.schemaVersion === undefined) {
    return refuse(SHARED_BRIEF_REASON.missingField, "schemaVersion");
  }
  // Version before shape. A file from a build that changed what `figure` means
  // must be refused as the wrong version, not as a broken figure.
  if (value.schemaVersion !== SHARED_BRIEF_SCHEMA_VERSION) {
    return refuse(SHARED_BRIEF_REASON.unsupportedVersion, "schemaVersion",
      JSON.stringify(value.schemaVersion));
  }
  for (const field of SHARED_BRIEF_FIELDS) {
    if (value[field] === undefined) return refuse(SHARED_BRIEF_REASON.missingField, field);
  }
  if (!safeString(value.producedAt, 40) || Number.isNaN(Date.parse(value.producedAt))) {
    return refuse(SHARED_BRIEF_REASON.invalidField, "producedAt");
  }

  const figure = project(value.figure, SHARED_BRIEF_SUBFIELDS.figure);
  if (!safeString(figure.label) || !isCount(figure.valueMinor) || !safeString(figure.currency, 8)) {
    return refuse(SHARED_BRIEF_REASON.invalidField, "figure");
  }
  const destination = project(value.destination, SHARED_BRIEF_SUBFIELDS.destination);
  if (!safeString(destination.action) || !isCount(destination.savingMinor)) {
    return refuse(SHARED_BRIEF_REASON.invalidField, "destination");
  }
  const confidence = project(value.confidence, SHARED_BRIEF_SUBFIELDS.confidence);
  if (!SHARED_BRIEF_GRADES.includes(confidence.grade) || !isCount(confidence.coverageRatioPpm)) {
    return refuse(SHARED_BRIEF_REASON.invalidField, "confidence");
  }
  const provenance = project(value.provenance, SHARED_BRIEF_SUBFIELDS.provenance);
  if (!safeString(provenance.designation) || !PERIOD_PATTERN.test(provenance.analysisPeriod ?? "")
    || !isCount(provenance.recordCount)) {
    return refuse(SHARED_BRIEF_REASON.invalidField, "provenance");
  }
  const limits = validateLimits(value.limits);
  if (!limits.ok) return limits;

  return Object.freeze({
    ok: true,
    reason: "read",
    field: "",
    brief: Object.freeze({
      schemaVersion: SHARED_BRIEF_SCHEMA_VERSION,
      producedAt: value.producedAt,
      figure: Object.freeze(figure),
      destination: Object.freeze(destination),
      confidence: Object.freeze(confidence),
      provenance: Object.freeze(provenance),
      limits: limits.limits,
    }),
  });
}

/**
 * Read a shared-brief file's text.
 *
 * READ-ONLY on every path, including the failing ones: nothing here touches
 * storage, and there is no import that could.
 *
 * @param text the file's text, or null when it could not be read.
 * @param byteSize the chosen file's size, checked BEFORE the bytes are parsed.
 */
export function readSharedBriefText(text, { byteSize } = {}) {
  if (Number.isFinite(byteSize) && byteSize > MAX_SHARED_BRIEF_BYTES) {
    return refuse(SHARED_BRIEF_REASON.oversize);
  }
  if (typeof text !== "string" || text.trim() === "") {
    return refuse(SHARED_BRIEF_REASON.absent);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse(SHARED_BRIEF_REASON.malformed);
  }
  return validateSharedBrief(parsed);
}
