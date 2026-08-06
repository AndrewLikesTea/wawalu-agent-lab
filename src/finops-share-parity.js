// Does the link a lead is about to send reproduce their brief on the other side?
//
// THE PROBLEM THIS SOLVES. #1206 put the sender's own retained periods into a
// link's fragment, so a colleague opening it reads those months rather than the
// bundled synthetic sample. What it could not tell the sender is whether the
// brief the recipient assembles from that token is the brief the sender is
// looking at. The failure mode is silent by construction: both sides render the
// same headings, the same layout and a plausible figure, so a field the codec
// dropped — or a ceiling the truncation to six periods moved — reaches the
// recipient as a confident number nobody flagged.
//
// So the page checks it before the copy, against the shipped codec rather than
// against a description of it: encode the analysis, read the result back through
// the SAME reader path a recipient's browser uses, rebuild the executive
// briefing from what came out, and compare.
//
// FOUR RULES THIS MODULE HOLDS.
//
//   1. **The compared fields are NAMED, and the list is short.** `PARITY_FIELDS`
//      is the whole comparison: the schema version, the headline figure, the
//      destination the finding points at, the confidence grade, and the period
//      they are all as of. A deep-equality check over two briefing objects would
//      pass or fail on fields nobody chose and could not name in a sentence —
//      and "something differs" is exactly the message this check exists to
//      replace. A field worth blocking a send over is a field worth listing here.
//
//   2. **An unsupported schema version is a NAMED failure, never a fallback.**
//      The check reads the version the token declares before it reads anything
//      else, and a version outside `SUPPORTED_SHARED_SCHEMAS` returns a refusal
//      that says which version was declared and which this build reads. No
//      decoded field is carried into the result on that path, because a stale
//      field rendered beside a current one is the defect, not the mitigation.
//
//   3. **No comparison without a token.** If the codec refuses to write the link
//      at all, there is nothing to compare and NO GRADE to show: `sender` and
//      `recipient` are both null. A grade shown beside a link that does not
//      exist is a grade a lead will quote.
//
//   4. **Nothing is computed twice.** The recipient side is
//      `buildExecutiveBriefing` — the same function `executive-briefing-page.js`
//      calls — over the decoded periods. This module reimplements no rule, holds
//      no threshold of its own, and therefore cannot disagree with the page it
//      is predicting.
//
// Deterministic and read-only: no clock, no random value, no storage, no
// network. Called twice with the same analysis it returns the same token and the
// same verdict, which is what makes the indicator reproducible in a dispute.

import { buildExecutiveBriefing } from "./executive-finops-briefing.js";
import {
  SHARED_BRIEFING_FRAGMENT_KEY, SHARED_BRIEFING_SCHEMA, SUPPORTED_SHARED_SCHEMAS,
  declaredSchemaVersion, encodeSharedBriefing, readSharedBriefingFragment,
} from "./finops-shared-briefing-link.js";

/**
 * The comparison, in full. Every entry is one field a recipient acts on, with
 * the words the page uses for it — the failure sentence is built from `label`,
 * so a field cannot be compared without also being nameable to a reader.
 */
export const PARITY_FIELDS = Object.freeze([
  Object.freeze({ name: "schemaVersion", label: "schema version" }),
  Object.freeze({ name: "headlineFigureMinor", label: "headline recoverable figure" }),
  Object.freeze({ name: "destinationOrgUnitId", label: "destination org unit" }),
  Object.freeze({ name: "confidenceGrade", label: "confidence grade" }),
  Object.freeze({ name: "reportingPeriod", label: "reporting period" }),
]);

/** Every verdict this check can reach. A closed set; each has its own sentence. */
export const PARITY_REASON = Object.freeze({
  match: "fields_match",
  diverged: "fields_diverged",
  unsupportedVersion: "unsupported_schema_version",
  notEncodable: "nothing_to_encode",
  notDecodable: "token_not_readable",
});

/** How the supported range reads in a sentence: "1", or "1–2" once there are two. */
export const SUPPORTED_SCHEMA_RANGE = SUPPORTED_SHARED_SCHEMAS.length === 1
  ? String(SUPPORTED_SHARED_SCHEMAS[0])
  : `${SUPPORTED_SHARED_SCHEMAS[0]}–${SUPPORTED_SHARED_SCHEMAS[SUPPORTED_SHARED_SCHEMAS.length - 1]}`;

/** What a passing check may claim. Three fields, named, and nothing further. */
export const PARITY_MATCH_STATEMENT =
  "Checked: whoever opens this link sees the same headline figure, the same destination and the same "
  + "confidence grade as you do.";

/**
 * The named projection both sides are reduced to.
 *
 * Reading it out of a built briefing rather than out of a period record is
 * deliberate: the grade a recipient reads is the executive briefing's, which
 * applies ceilings the stored period's own confidence knows nothing about.
 * Comparing the stored field would pass while the rendered grade differed.
 */
function paritySubject(periods, schemaVersion) {
  const briefing = buildExecutiveBriefing(periods);
  return Object.freeze({
    schemaVersion,
    headlineFigureMinor: briefing.recoverable?.valueMinor ?? null,
    destinationOrgUnitId: briefing.primaryFinding?.orgUnitId ?? null,
    confidenceGrade: briefing.confidence?.level ?? null,
    reportingPeriod: briefing.reportingPeriod?.period ?? null,
  });
}

const show = (value) => (value === null || value === undefined ? "none" : String(value));

function refused(reason, statement) {
  return Object.freeze({
    ok: false,
    reason,
    statement,
    fields: Object.freeze(PARITY_FIELDS.map((field) => field.name)),
    mismatches: Object.freeze([]),
    sender: null,
    recipient: null,
    token: "",
  });
}

/**
 * Check that a link reproduces this analysis on the recipient's side.
 *
 * @param periods the analysis as the sender holds it — the retained periods this
 *   browser would share, NOT the projected subset. Comparing against the raw
 *   list is the point: the codec keeps the most recent six, and a truncation
 *   that moved the grade has to surface as a divergence rather than as a match.
 * @param options `{ token }` — a token to check INSTEAD of encoding one, for the
 *   case a lead was handed a link written by another build. Everything else on
 *   this path is identical, including the refusal vocabulary.
 * @returns `{ ok, reason, statement, fields, mismatches, sender, recipient,
 *   token }`, frozen. `mismatches` is `[{ field, label, sender, recipient }]` and
 *   is empty on every path but `fields_diverged`. Total: it never throws.
 */
export function checkSharedBriefingParity(periods, options = {}) {
  const supplied = typeof options.token === "string" ? options.token : null;
  const encoded = supplied === null ? encodeSharedBriefing(periods) : null;
  if (encoded && !encoded.ok) {
    return refused(PARITY_REASON.notEncodable,
      `${encoded.summary}. There is no link to check, so no figure and no grade is claimed for a `
      + "recipient.");
  }
  const token = supplied ?? encoded.token;

  // Version first, and from the token rather than from what this build hoped to
  // write: a payload declaring a schema this reader does not know must be named,
  // not read best-effort. Nothing decoded travels out of this branch.
  // A token that declares nothing at all is not a version failure — it is a link
  // that was cut short or was never one, and the decoder below names that. Only
  // a payload that DOES declare a version this build cannot read lands here.
  const declared = declaredSchemaVersion(token);
  if (declared !== null && !SUPPORTED_SHARED_SCHEMAS.includes(declared)) {
    return refused(PARITY_REASON.unsupportedVersion,
      `Unsupported schema version ${show(declared)}; this page reads ${SUPPORTED_SCHEMA_RANGE}. `
      + "Nothing from the link is shown as current, because a field read under the wrong schema is a "
      + "figure nobody can check.");
  }

  // The recipient's own path, not a shortcut through the decoder: a reader gets
  // the token off a fragment, so that is where this check reads it from too.
  const decoded = readSharedBriefingFragment(`#${SHARED_BRIEFING_FRAGMENT_KEY}=${token}`);
  if (!decoded.ok) {
    return refused(PARITY_REASON.notDecodable,
      `${decoded.summary}. No figure and no grade is claimed for a recipient.`);
  }

  // The sender's side is stamped with the schema this build WRITES and the
  // recipient's with the one the token DECLARES, rather than both with the same
  // constant: a comparison whose two sides come from one source can never fail,
  // and the day this page reads two schemas is the day that matters.
  const sender = paritySubject(periods, SHARED_BRIEFING_SCHEMA);
  const recipient = paritySubject(decoded.periods, declared);
  const mismatches = PARITY_FIELDS
    .filter((field) => sender[field.name] !== recipient[field.name])
    .map((field) => Object.freeze({
      field: field.name,
      label: field.label,
      sender: sender[field.name],
      recipient: recipient[field.name],
    }));

  return Object.freeze({
    ok: mismatches.length === 0,
    reason: mismatches.length === 0 ? PARITY_REASON.match : PARITY_REASON.diverged,
    statement: mismatches.length === 0 ? PARITY_MATCH_STATEMENT : divergenceStatement(mismatches),
    fields: Object.freeze(PARITY_FIELDS.map((field) => field.name)),
    mismatches: Object.freeze(mismatches),
    sender,
    recipient,
    token,
  });
}

/**
 * The failure sentence, with every diverging field NAMED and both values in it.
 *
 * In the sentence, not in a console message and not in a title attribute: a lead
 * deciding whether to send this link cannot act on "parity failed".
 */
export function divergenceStatement(mismatches) {
  const named = mismatches
    .map((entry) => `${entry.label} (you: ${show(entry.sender)}, recipient: ${show(entry.recipient)})`)
    .join("; ");
  return `Do not send this link yet: the recipient would not read the same brief. Differs on `
    + `${named}.`;
}
