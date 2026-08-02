// Export recognition and confidence scoring (#928). Pure and side-effect free:
// a parsed export in, a structured recognition result out. No DOM, no network,
// no storage, no clock, no locale-sensitive comparison, and no randomness. The
// same parsed export scores the same number on every run.
//
// Every provider shape claim comes from browser-compat-contracts.js (#927).
// Nothing here re-declares a column name, a format, or a signature field, so a
// fourth published contract is scored by this module without editing it.
//
// HOW THE NUMBER IS BUILT — the whole rule, so a director who disputes a score
// can recompute it from the evidence list alone:
//   1. Pick the reference contract: the published contract with the most of its
//      signature columns present in the file. Ties go to the contract whose
//      declared format matches the file's format, then to manifest order. If no
//      contract has a single signature column present, there is no reference
//      contract, no signal can fire, and the confidence is 0.
//   2. Run the six signals below against it. Each either fires for its whole
//      weight or contributes nothing. There is no partial credit, no distance
//      metric, no fuzzy match, and no threshold other than the named ones here.
//   3. If the file carries a conversation body field, one disqualifier removes
//      every point accrued. That is a subtraction on the evidence list, not a
//      hidden branch: the contributions still sum to the reported confidence.
//   4. Compare the total against the two named band thresholds.

import {
  BROWSER_COMPAT_MANIFEST, FIELD_ROLES, PRIVACY_POLICY,
} from "./browser-compat-contracts.js";

export const RECOGNITION_BANDS = Object.freeze({
  ACCEPTED: "accepted",
  ATTENTION: "needs-attention",
  REJECTED: "rejected",
});

export const RECOGNITION_OUTCOMES = Object.freeze({
  RECOGNIZED: "recognized",
  AMBIGUOUS: "ambiguous",
  INCOMPLETE: "incomplete",
  INCOMPATIBLE: "incompatible",
});

// ASSUMPTION: three usage records is the smallest export that can show a trend
// rather than a single day, and every provider bills at least daily. Below it a
// file may be a valid export and is still not enough to reason about.
export const RECORD_FLOOR = 3;

// ASSUMPTION: 100 is the whole of the available evidence, so a confidence is
// read as "out of 100" and never as an unbounded score. The weights below sum
// to exactly this; the test suite asserts it rather than trusting the comment.
export const MAX_CONFIDENCE = 100;

// ASSUMPTION for 85: an export is usable as-is only when provider identity is
// settled (45 points) and the shape is complete (45 points). 85 is the highest
// floor that still tolerates the one 10-point signal a genuinely usable export
// can lack — a file whose extension did not name its format — while any missing
// identity or completeness signal costs 20 or more and falls out of the band.
export const ACCEPTED_MIN_CONFIDENCE = 85;

// ASSUMPTION for 50: below half the available evidence the file has not been
// identified well enough to correct. The next action stops being "fix this
// export" and becomes "export the right view again", which is a different job.
export const ATTENTION_MIN_CONFIDENCE = 50;

// ---------------------------------------------------------------- redaction

// What a reader's file may never put into an evidence string. Everything this
// module emits is built from module literals, contract-declared vocabulary, and
// integers; this function is the one gate any token that CAME FROM THE FILE has
// to pass, and it is an allowlist rather than a pattern so an unanticipated
// hostile string cannot be the thing that slips through.
export const REDACTED = "(withheld)";

const contractVocabulary = (manifest) => {
  const known = new Set();
  for (const contract of manifest.contracts) {
    known.add(contract.exportShape.format);
    for (const path of contract.exportShape.signatureFields) known.add(path);
    for (const field of [...contract.requiredFields, ...contract.optionalFields]) {
      known.add(field.path);
    }
  }
  for (const name of PRIVACY_POLICY.prohibitedFieldNames) known.add(name);
  return known;
};

const KNOWN_TOKENS = contractVocabulary(BROWSER_COMPAT_MANIFEST);

/**
 * Returns the token when it is vocabulary this codebase published, and the
 * withheld placeholder when it is anything else. A column name a reader
 * invented, a cell value, a prompt, and a key-shaped string all fail the
 * allowlist, so none of them can reach an evidence string or the surface.
 */
export function redactFileToken(token) {
  const text = String(token ?? "");
  return KNOWN_TOKENS.has(text) ? text : REDACTED;
}

// ---------------------------------------------------------------- helpers

const { contracts } = BROWSER_COMPAT_MANIFEST;

const lastSegment = (path) => String(path).split(/[./]/).pop().toLowerCase();

const finite = (value) => {
  if (typeof value === "number") return Number.isFinite(value);
  const text = String(value ?? "").trim();
  return text !== "" && Number.isFinite(Number(text));
};

const byRole = (contract, role) =>
  contract.requiredFields.find((field) => field.role === role) ?? null;

const presentCount = (names, paths) => paths.filter((path) => names.has(path)).length;

/**
 * The reference contract, by rule 1 above. Counts only — no distance metric and
 * no per-provider branch, so the choice is checkable by eye from the file's
 * column names and the published signature lists.
 */
function referenceContract(names, format) {
  let best = null;
  for (const contract of contracts) {
    const hits = presentCount(names, contract.exportShape.signatureFields);
    if (hits === 0) continue;
    const formatMatch = contract.exportShape.format === format;
    if (!best || hits > best.hits || (hits === best.hits && formatMatch && !best.formatMatch)) {
      best = { contract, hits, formatMatch };
    }
  }
  return best;
}

// ---------------------------------------------------------------- signals

// The weight table. Each entry states, in one line, the assumption that makes
// the signal worth that much. Weights are integers and sum to MAX_CONFIDENCE.
// A signal fires whole or not at all: there is no partial credit to argue about.
const SIGNALS = Object.freeze([
  Object.freeze({
    id: "format_matches_contract",
    label: "Declared format matches the contract",
    weight: 10,
    assumption: "Worth least of the six: format is the cheapest signal to get "
      + "right and the cheapest to get wrong, because a correct export saved "
      + "under the wrong extension is still a correct export.",
    evaluate: ({ reference, format }) => ({
      fired: Boolean(reference) && reference.contract.exportShape.format === format,
      statement: reference
        ? `File format is ${redactFileToken(format)}; the ${reference.contract.displayName} `
          + `contract declares ${reference.contract.exportShape.format}.`
        : "No reference contract, so there is no declared format to compare against.",
    }),
  }),
  Object.freeze({
    id: "signature_columns_present",
    label: "Every provider signature column is present",
    weight: 20,
    assumption: "The signature columns are the only thing that names the "
      + "provider; without all of them the file is being attributed on a guess, "
      + "so this carries a fifth of the score and nothing more.",
    evaluate: ({ reference }) => ({
      fired: Boolean(reference)
        && reference.hits === reference.contract.exportShape.signatureFields.length,
      statement: reference
        ? `${reference.hits} of ${reference.contract.exportShape.signatureFields.length} `
          + `${reference.contract.displayName} signature columns present.`
        : "No published contract has a single signature column present in this file.",
    }),
  }),
  Object.freeze({
    id: "required_columns_complete",
    label: "Every required column is present",
    weight: 25,
    assumption: "Worth the most, jointly with sole identity: a missing required "
      + "column is not a quality problem but a question the export cannot answer "
      + "at all, and the reader must re-export rather than accept a caveat.",
    evaluate: ({ reference, names }) => {
      if (!reference) {
        return { fired: false, statement: "No reference contract, so no required column set applies." };
      }
      const required = reference.contract.requiredFields.map((field) => field.path);
      const missing = required.filter((path) => !names.has(path));
      return {
        fired: missing.length === 0,
        missing,
        statement: `${required.length - missing.length} of ${required.length} required columns present`
          + (missing.length ? `; missing ${missing.join(", ")}.` : "."),
      };
    },
  }),
  Object.freeze({
    id: "unit_and_cost_parseable",
    label: "Unit count and cost amount parse as numbers",
    weight: 10,
    assumption: "A tenth, not more: unparseable numbers are usually a few bad "
      + "rows in an otherwise correct export, and the existing eligibility rules "
      + "already skip and report those rows rather than refusing the file.",
    evaluate: ({ reference, records }) => {
      if (!reference) {
        return { fired: false, statement: "No reference contract, so no unit or cost column is named." };
      }
      const units = byRole(reference.contract, FIELD_ROLES.UNITS);
      const cost = byRole(reference.contract, FIELD_ROLES.COST);
      const readable = records.filter((record) =>
        finite(record?.[units.path]) && finite(record?.[cost.path])).length;
      return {
        fired: readable > 0,
        statement: `${readable} of ${records.length} records carry a parseable unit count and cost amount.`,
      };
    },
  }),
  Object.freeze({
    id: "record_floor_met",
    label: "Record count is at or above the floor",
    weight: 10,
    assumption: "A tenth, matching the parse signal: a short export is real "
      + "data, just too little of it to trend, so it lowers confidence without "
      + "on its own moving the file out of the accepted band.",
    evaluate: ({ records }) => ({
      fired: records.length >= RECORD_FLOOR,
      statement: `${records.length} records, against a floor of ${RECORD_FLOOR}.`,
    }),
  }),
  Object.freeze({
    id: "sole_provider_signature",
    label: "No second provider's signature columns are present",
    weight: 25,
    assumption: "Worth the most, jointly with the required set: a file carrying "
      + "two providers' signature columns has been assembled by hand, so every "
      + "per-provider figure taken from it is attributed on the assembler's word.",
    evaluate: ({ reference, names }) => {
      if (!reference) {
        return { fired: false, statement: "No reference contract, so there is no sole identity to confirm." };
      }
      const contending = contracts.filter((contract) =>
        contract.providerId !== reference.contract.providerId
        && contract.exportShape.signatureFields.every((path) => names.has(path)));
      return {
        fired: contending.length === 0,
        contending,
        statement: contending.length
          ? `${contending.map((entry) => entry.displayName).join(" and ")} signature columns are `
            + "also present, so provider identity is contested."
          : "No other published contract's signature columns are present.",
      };
    },
  }),
]);

export const RECOGNITION_SIGNALS = SIGNALS;

// The one disqualifier. It is a subtraction rather than an early return so the
// evidence list still adds up to the reported confidence.
const DISQUALIFIER_ID = "conversation_body_present";

// ---------------------------------------------------------------- scoring

/**
 * @param parsed  { ok, format, fieldNames, records } — the shape the existing
 *                adapters produce. Nothing else is read from it.
 * @returns a frozen recognition result:
 *   providerId, displayName, outcome, confidence, band, evidence[], nextAction.
 *   Every string in it is redacted by construction: it comes from this module,
 *   from a published contract, or from an integer count.
 */
export function recognizeExport(parsed) {
  const format = String(parsed?.format ?? "");
  // A Set, and iteration in contract order below, so the result cannot depend
  // on the order the file happened to list its columns in.
  const names = new Set((parsed?.fieldNames ?? []).map((name) => String(name)));
  const records = Array.isArray(parsed?.records) ? parsed.records : [];
  const reference = parsed?.ok === false ? null : referenceContract(names, format);
  const context = { reference, format, names, records };

  const evidence = [];
  let confidence = 0;
  const fired = new Set();
  const detail = new Map();
  for (const signal of SIGNALS) {
    const outcome = signal.evaluate(context);
    const contribution = outcome.fired ? signal.weight : 0;
    confidence += contribution;
    if (outcome.fired) fired.add(signal.id);
    detail.set(signal.id, outcome);
    evidence.push(Object.freeze({
      signalId: signal.id,
      label: signal.label,
      weight: signal.weight,
      contribution,
      statement: outcome.statement,
    }));
  }

  const bodyField = [...names]
    .map((name) => lastSegment(name))
    .find((segment) => PRIVACY_POLICY.prohibitedFieldNames.includes(segment)) ?? null;
  if (bodyField) {
    evidence.push(Object.freeze({
      signalId: DISQUALIFIER_ID,
      label: "Disqualified: the export carries conversation bodies",
      weight: -MAX_CONFIDENCE,
      contribution: -confidence,
      statement: `A ${redactFileToken(bodyField)} field is present. An export carrying prompt or `
        + "completion text is refused rather than stripped, so every point accrued is removed.",
    }));
    confidence = 0;
  }

  const outcome = classify({ bodyField, reference, fired });
  return Object.freeze({
    providerId: reference && fired.has("signature_columns_present")
      ? reference.contract.providerId : null,
    displayName: reference && fired.has("signature_columns_present")
      ? reference.contract.displayName : null,
    outcome,
    confidence,
    maxConfidence: MAX_CONFIDENCE,
    band: bandFor(confidence),
    evidence: Object.freeze(evidence),
    nextAction: nextActionFor(outcome, { reference, detail, bodyField }),
  });
}

// Ordered so each state has exactly one name: a body-carrying export is
// incompatible even though its columns are complete, and a contested identity is
// ambiguous even though nothing is missing.
function classify({ bodyField, reference, fired }) {
  if (bodyField) return RECOGNITION_OUTCOMES.INCOMPATIBLE;
  if (!reference || !fired.has("signature_columns_present")) {
    return RECOGNITION_OUTCOMES.INCOMPATIBLE;
  }
  if (!fired.has("sole_provider_signature")) return RECOGNITION_OUTCOMES.AMBIGUOUS;
  if (!fired.has("required_columns_complete") || !fired.has("unit_and_cost_parseable")
    || !fired.has("record_floor_met")) {
    return RECOGNITION_OUTCOMES.INCOMPLETE;
  }
  return RECOGNITION_OUTCOMES.RECOGNIZED;
}

export function bandFor(confidence) {
  if (confidence >= ACCEPTED_MIN_CONFIDENCE) return RECOGNITION_BANDS.ACCEPTED;
  if (confidence >= ATTENTION_MIN_CONFIDENCE) return RECOGNITION_BANDS.ATTENTION;
  return RECOGNITION_BANDS.REJECTED;
}

// One action, never a menu: the reader is told the single next thing to do.
function nextActionFor(outcome, { reference, detail, bodyField }) {
  const name = reference?.contract.displayName ?? null;
  if (outcome === RECOGNITION_OUTCOMES.RECOGNIZED) {
    return `Nothing to fix. Continue with the ${name} analysis in this tab.`;
  }
  if (outcome === RECOGNITION_OUTCOMES.AMBIGUOUS) {
    const contending = detail.get("sole_provider_signature")?.contending ?? [];
    return `Split this file so it carries ${name} records only — it also carries `
      + `${contending.map((entry) => entry.displayName).join(" and ")} signature columns — `
      + "then check it again.";
  }
  if (outcome === RECOGNITION_OUTCOMES.INCOMPLETE) {
    const missing = detail.get("required_columns_complete")?.missing ?? [];
    return missing.length
      ? `Re-export from ${name} with ${missing.join(", ")} included, then check it again.`
      : `Re-export from ${name} covering at least ${RECORD_FLOOR} usage records, then check it again.`;
  }
  if (bodyField) {
    return `Export the ${name ?? "provider"} usage or billing view rather than an invocation or `
      + "audit log; this check never accepts a file carrying prompt or completion text.";
  }
  if (reference) {
    return `Re-export from ${name}: only ${reference.hits} of its signature columns are present, `
      + "so this file cannot be attributed to it.";
  }
  return "Choose an export from one of the published contracts — "
    + `${contracts.map((entry) => entry.displayName).join(", ")} — `
    + "as none of their signature columns are present in this file.";
}
