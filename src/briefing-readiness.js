// The circulation decision for the bundled, static analysis.
//
// Question: "Is this bundled analysis ready to circulate?"
// Reading order: verdict, finding, benchmark, action, confidence and period,
// then exclusions or missing evidence. It deliberately contains no second
// finding, provider drill-down, prompt analysis, live-data claim, or storage.

export const READINESS_VERSION = "briefing-readiness/1.0.0";

export const READINESS_STATE = Object.freeze({
  complete: "complete",
  insufficientEvidence: "insufficient-evidence",
  unsupportedInput: "unsupported-input",
});

export const REQUIRED_EVIDENCE = Object.freeze([
  "headlineFinding",
  "benchmarkComparison",
  "recommendedAction",
  "confidence",
  "sourcePeriod",
  "exclusions",
]);

export const REQUIRED_EXCLUSIONS = Object.freeze(["prompts", "providerRows"]);
export const SUPPORTED_INPUT_MODEL = "bundled-static-analysis/1.0.0";

const CONFIDENCE_FIELDS = Object.freeze(["level", "basis"]);
const PERIOD_FIELDS = Object.freeze(["start", "end", "provenance"]);

const text = (value) => typeof value === "string" && value.trim().length > 0;
const validPeriod = (period) => text(period?.start) && text(period?.end)
  && /^\d{4}-\d{2}-\d{2}$/.test(period.start)
  && /^\d{4}-\d{2}-\d{2}$/.test(period.end)
  && period.start < period.end;

/**
 * The declared fields of a sub-record, trimmed and frozen — never a spread of
 * the caller's object. A spread would carry whatever else the seed happens to
 * hold into a result whose whole claim is that prompts and provider rows are
 * out of scope, and would leave the nested objects writable under a top-level
 * `Object.freeze` that reads as if the decision were immutable.
 */
const project = (source, fields) => Object.freeze(
  Object.fromEntries(fields.map((field) => [field, source[field].trim()])));

function missingEvidence(input) {
  const missing = [];
  if (!text(input?.headlineFinding)) missing.push("headlineFinding");
  if (!text(input?.benchmarkComparison)) missing.push("benchmarkComparison");
  if (!text(input?.recommendedAction)) missing.push("recommendedAction");
  if (!CONFIDENCE_FIELDS.every((key) => text(input?.confidence?.[key]))) missing.push("confidence");
  if (!validPeriod(input?.sourcePeriod) || !text(input?.sourcePeriod?.provenance)) missing.push("sourcePeriod");
  if (!REQUIRED_EXCLUSIONS.every((key) => text(input?.exclusions?.[key]))) missing.push("exclusions");
  return missing;
}

/**
 * Deterministic precedence:
 * 1. Unsupported whenever a record IS present and either declares a model that
 *    is not the bundled static one, or claims data that model excludes.
 * 2. Insufficient when no record arrived at all, or the model is supported but
 *    required evidence is absent.
 * 3. Complete only when every required element is present.
 *
 * A record that never arrived is missing evidence rather than an unsupportable
 * claim: nothing was asserted and there is no declared model to reject, so the
 * unsupported branch is guarded on having a record to read. The distinction is
 * load-bearing for the page — a failed seed fetch must not be reported as an
 * input that claimed live provider access.
 */
export function assessBriefingReadiness(input) {
  const record = typeof input === "object" && input !== null ? input : null;
  const unsupported = [];
  if (record) {
    if (record.inputModel !== SUPPORTED_INPUT_MODEL) unsupported.push("inputModel");
    if (record.claims?.liveProviderAccess) unsupported.push("liveProviderAccess");
    if (record.claims?.liveHrisAccess) unsupported.push("liveHrisAccess");
    if (record.claims?.promptContent) unsupported.push("promptContent");
    if (record.claims?.providerRows) unsupported.push("providerRows");
  }

  const missing = missingEvidence(record);
  const state = unsupported.length
    ? READINESS_STATE.unsupportedInput
    : missing.length ? READINESS_STATE.insufficientEvidence : READINESS_STATE.complete;

  return Object.freeze({
    contractVersion: READINESS_VERSION,
    question: "Is this bundled analysis ready to circulate?",
    state,
    readyToCirculate: state === READINESS_STATE.complete,
    headlineFinding: text(record?.headlineFinding) ? record.headlineFinding.trim() : null,
    benchmarkComparison: text(record?.benchmarkComparison) ? record.benchmarkComparison.trim() : null,
    recommendedAction: text(record?.recommendedAction) ? record.recommendedAction.trim() : null,
    confidence: missing.includes("confidence") ? null : project(record.confidence, CONFIDENCE_FIELDS),
    sourcePeriod: missing.includes("sourcePeriod") ? null : project(record.sourcePeriod, PERIOD_FIELDS),
    exclusions: missing.includes("exclusions") ? null : project(record.exclusions, REQUIRED_EXCLUSIONS),
    missingEvidence: Object.freeze(missing),
    unsupportedClaims: Object.freeze(unsupported),
  });
}
