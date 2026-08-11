// Reader-facing vocabulary for the executive briefing. Machine identifiers stay
// available for audit, but none is allowed to become leadership copy.
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

/** Replace every known identifier and reject any unmapped identifier-shaped token. */
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
