// Reader-facing confidence language for the FinOps executive surfaces.
//
// This file owns words, not scoring. A scoring module selects a stable key and
// every first paint, runtime render and destination reads the exact text below.
// Keeping the copy separate makes vocabulary review possible without hiding a
// threshold change inside a prose edit.

export const FINOPS_EXECUTIVE_CONFIDENCE = Object.freeze({
  high: Object.freeze({
    label: "High confidence",
    wording: "The pricing basis is independently checkable and complete enough to support a decision.",
    raise: "Keep the cited source, destination coverage, required fields, and effective dates current.",
  }),
  moderate: Object.freeze({
    label: "Moderate confidence",
    wording: "The pricing basis is usable with a material evidence limitation.",
    raise: "Resolve the largest weighted evidence gap named in the audit disclosure.",
  }),
  limited: Object.freeze({
    label: "Limited confidence",
    wording: "The pricing basis is directional and should be checked before committing spend.",
    raise: "Add a citable price source, then fill the uncovered destinations and required fields.",
  }),
  insufficient: Object.freeze({
    label: "Insufficient confidence",
    wording: "The pricing basis is not supported well enough for an executive decision.",
    raise: "Provide a citable rate card that covers the priced destinations and states its effective dates.",
  }),
});

// Machine identifiers have an audit purpose, but they are not leadership copy.
// Every identifier the forwardable briefing knows must be named here before it
// can enter the reader-facing body.
export const EXECUTIVE_PHRASES = Object.freeze({
  "executive-briefing/1.0.0": "Executive briefing payload",
  "finops-executive-projection/1.0.0": "The local executive briefing selection",
  "bundled-briefing-selection/1.0.0": "The bundled analysis selected for circulation",
  "bundled-static-analysis/1.0.0": "Bundled synthetic analysis",
  "evolution-demo-data": "Bundled AI FinOps example",
  "2026-07-25.1": "Published 25 July 2026",
  "literacy-mix/1.0.0": "the published workload-scoring method",
});

const INTERNAL_TOKEN = /\b(?:[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}(?:\/\d+\.\d+\.\d+)?|[a-z][\w-]*\/\d+\.\d+\.\d+)\b/gi;

/** Replace known identifiers and fail closed when reader copy contains an unknown one. */
export function executivePlainLanguage(value) {
  if (typeof value !== "string") return value;
  let result = value;
  for (const [identifier, phrase] of Object.entries(EXECUTIVE_PHRASES)) {
    result = result.replaceAll(identifier, phrase);
  }
  const remaining = result.match(INTERNAL_TOKEN) ?? [];
  if (remaining.length) throw new TypeError(`Unmapped executive identifier: ${remaining.join(", ")}`);
  return result;
}

export const executiveCopyIsPlainLanguage = (value) => {
  try { return executivePlainLanguage(value) === value; } catch { return false; }
};
