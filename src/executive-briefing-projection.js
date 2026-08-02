import { assessBriefingReadiness, READINESS_STATE, SUPPORTED_INPUT_MODEL } from "./briefing-readiness.js";

export const EXECUTIVE_BRIEFING_VERSION = "executive-briefing/1.0.0";
export const BUNDLED_SELECTION_VERSION = "bundled-briefing-selection/1.0.0";

const text = (value) => typeof value === "string" && value.trim().length > 0;
const FORBIDDEN_KEYS = new Set([
  "prompt", "prompts", "promptContent", "providerRow", "providerRows",
  "credential", "credentials", "customerData",
]);

export class BriefingProjectionError extends Error {
  constructor(code, paths) {
    super(`${code}: ${paths.join(", ")}`);
    this.name = "BriefingProjectionError";
    this.code = code;
    this.paths = Object.freeze([...paths]);
  }
}

function forbiddenPaths(value, path = "input", found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    const exclusionDeclaration = path === "input.exclusions"
      && (key === "prompts" || key === "providerRows");
    if (!exclusionDeclaration && FORBIDDEN_KEYS.has(key) && child !== false && child != null) {
      found.push(childPath);
    }
    if (typeof child === "object") forbiddenPaths(child, childPath, found);
  }
  return found;
}

function requiredSelection(input) {
  const missing = [];
  if (input?.selectionVersion !== BUNDLED_SELECTION_VERSION) missing.push("selectionVersion");
  if (!text(input?.projectionVersion)) missing.push("projectionVersion");
  if (!text(input?.fixture?.id)) missing.push("fixture.id");
  if (!text(input?.fixture?.version)) missing.push("fixture.version");
  if (!Array.isArray(input?.departmentEvidence) || input.departmentEvidence.length === 0) {
    missing.push("departmentEvidence");
  } else {
    input.departmentEvidence.forEach((row, index) => {
      for (const field of ["department", "evidence", "provenance"]) {
        if (!text(row?.[field])) missing.push(`departmentEvidence[${index}].${field}`);
      }
    });
  }
  return missing;
}

const clean = (value) => value.trim();
const frozenRecord = (source, fields) => Object.freeze(Object.fromEntries(
  fields.map((field) => [field, clean(source[field])]),
));

function generatedAt(clock) {
  if (typeof clock !== "function") throw new BriefingProjectionError("invalid-clock", ["clock"]);
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new BriefingProjectionError("invalid-clock", ["clock.result"]);
  return date.toISOString();
}

/** Project an allowlisted, immutable artifact; no source object is spread. */
export function projectExecutiveBriefing(input, { clock = () => new Date() } = {}) {
  if (!input || typeof input !== "object") {
    throw new BriefingProjectionError("incomplete-state", ["input"]);
  }
  const forbidden = forbiddenPaths(input);
  if (forbidden.length) throw new BriefingProjectionError("forbidden-state", forbidden);
  if (input.inputModel !== SUPPORTED_INPUT_MODEL) {
    throw new BriefingProjectionError("incompatible-state", ["inputModel"]);
  }
  const missing = requiredSelection(input);
  const readiness = assessBriefingReadiness(input);
  if (readiness.state !== READINESS_STATE.complete) {
    const paths = [...readiness.unsupportedClaims, ...readiness.missingEvidence];
    throw new BriefingProjectionError("not-ready", paths.length ? paths : ["readiness"]);
  }
  if (missing.length) throw new BriefingProjectionError("incomplete-state", missing);

  const departmentEvidence = Object.freeze(input.departmentEvidence.map((row) =>
    frozenRecord(row, ["department", "evidence", "provenance"])));
  const payload = {
    schemaVersion: EXECUTIVE_BRIEFING_VERSION,
    headlineAnswer: readiness.headlineFinding,
    materialBenchmarkOrTrend: readiness.benchmarkComparison,
    prioritizedNextAction: readiness.recommendedAction,
    confidence: readiness.confidence,
    departmentEvidence,
    period: readiness.sourcePeriod,
    projectionVersion: clean(input.projectionVersion),
    provenance: Object.freeze({
      inputModel: SUPPORTED_INPUT_MODEL,
      selectionVersion: BUNDLED_SELECTION_VERSION,
      fixtureId: clean(input.fixture.id),
      fixtureVersion: clean(input.fixture.version),
    }),
    generatedAt: generatedAt(clock),
  };
  return Object.freeze(payload);
}
